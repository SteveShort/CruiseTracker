// ============================================================================
//  Disney FL Resident Pricing Scraper
//  Uses Playwright to auto-acquire __pa cookie, then Disney's internal APIs
//  to fetch FL Resident promotional pricing for all Disney cruise sailings.
//
//  Flow:
//    1. Playwright → visit Disney site → extract fresh __pa cookie
//    2. POST /dcl-apps-productavail-vas/available-products/ (discovery)
//    3. POST /dcl-apps-productavail-vas/available-sailings/ (per-date pricing)
//    4. Upsert FL Resident prices to PriceHistory table
//
//  Usage:
//    node disney-fl-scraper.js
// ============================================================================

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');

// ── SQL Server Config (Windows Integrated Security via ODBC) ───────────
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

// ── Constants ──────────────────────────────────────────────────────────
const BASE_URL = 'https://disneycruise.disney.go.com';
const FL_RESIDENT_URL = `${BASE_URL}/cruises-destinations/list/?offer=FL_RESIDENT`;
const PRODUCTS_URL = `${BASE_URL}/dcl-apps-productavail-vas/available-products/`;
const SAILINGS_URL = `${BASE_URL}/dcl-apps-productavail-vas/available-sailings/`;
const DELAY_MS = 300;

// ── Logging ────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_KEEP_DAYS = 7;

function setupLogging() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
        const fp = path.join(LOG_DIR, f);
        try {
            if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch (_) { }
    }

    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `disney-fl-${today}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const ts = () => new Date().toISOString().slice(11, 19);

    console.log = (...args) => {
        const msg = args.join(' ');
        origLog(msg);
        logStream.write(`[${ts()}] ${msg}\n`);
    };
    console.warn = (...args) => {
        const msg = args.join(' ');
        origWarn(msg);
        logStream.write(`[${ts()}] WARN: ${msg}\n`);
    };
    console.error = (...args) => {
        const msg = args.join(' ');
        origError(msg);
        logStream.write(`[${ts()}] ERROR: ${msg}\n`);
    };

    return logStream;
}

// ── Helper ─────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Step 0: Acquire fresh __pa cookie via Playwright ───────────────────
async function acquireCookie() {
    console.log('  🌐 Launching browser to acquire __pa cookie...');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
        await page.goto(FL_RESIDENT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Wait for the __pa cookie to be set (Disney sets it via JS)
        await page.waitForTimeout(5000);

        const cookies = await context.cookies(BASE_URL);
        const paCookie = cookies.find(c => c.name === '__pa');

        if (!paCookie) {
            // Try waiting a bit longer
            await page.waitForTimeout(5000);
            const cookies2 = await context.cookies(BASE_URL);
            const paCookie2 = cookies2.find(c => c.name === '__pa');
            if (!paCookie2) {
                throw new Error('__pa cookie not found after page load');
            }
            console.log(`  ✅ Got fresh __pa cookie (${paCookie2.value.slice(0, 30)}...)`);
            return paCookie2.value;
        }

        console.log(`  ✅ Got fresh __pa cookie (${paCookie.value.slice(0, 30)}...)`);
        return paCookie.value;
    } finally {
        await browser.close();
        console.log('  🔒 Browser closed');
    }
}

// ── Shared request payload fields ──────────────────────────────────────
const PARTY_MIX = [{
    accessible: false, adultCount: 2, childCount: 0,
    nonAdultAges: [], partyMixId: '0'
}];
const AFFILIATIONS = [{ affiliationType: 'FL_RESIDENT' }];
const PROMO_CODE = 'FLR;entityType=marketing-offer;destination=dcl';

function makeHeaders(cookie) {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': BASE_URL,
        'Referer': FL_RESIDENT_URL,
        'Cookie': `__pa=${cookie}`,
        'x-conversation-id': crypto.randomUUID(),
        'x-correlation-id': crypto.randomUUID(),
        'x-disney-internal-is-cast': 'false',
        'x-use-voyage-svc': 'true',
    };
}

// ── Step 1: Discover FL Resident products ──────────────────────────────
async function fetchProducts(cookie) {
    const products = [];
    let pageNum = 1;
    let totalPages = 1;

    console.log('  🔍 Discovering FL Resident products...');

    while (pageNum <= totalPages) {
        const payload = {
            currency: 'USD', filters: [],
            partyMix: PARTY_MIX, region: 'INTL', storeId: 'DCL',
            affiliations: AFFILIATIONS,
            page: pageNum, pageHistory: false,
            includeAdvancedBookingPrices: true,
            exploreMorePage: 1, exploreMorePageHistory: false,
            promoCode: PROMO_CODE,
        };

        const resp = await fetch(PRODUCTS_URL, {
            method: 'POST',
            headers: makeHeaders(cookie),
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            if (resp.status === 401 || resp.status === 403) {
                throw new Error(`Auth failed (${resp.status}) — cookie acquisition may have failed`);
            }
            throw new Error(`Products API returned ${resp.status}: ${resp.statusText}`);
        }

        const data = await resp.json();
        if (data.totalPages) totalPages = data.totalPages;
        if (!data.products || data.products.length === 0) break;

        for (const product of data.products) {
            const productId = product.productId;
            if (!productId) continue;

            const itinId = product.productItineraryData?.itineraryId || '';

            let shipName = '';
            let nights = 0;
            let itineraryName = '';
            let departurePort = '';

            // Get product title as itinerary name
            itineraryName = product.title || product.name || productId;

            // Get departure port from itinerary data
            if (product.productItineraryData?.departurePort?.name) {
                departurePort = product.productItineraryData.departurePort.name;
            }

            if (product.itineraries) {
                for (const itin of product.itineraries) {
                    if (itin.sailings) {
                        for (const s of itin.sailings) {
                            if (s.ship?.name) shipName = s.ship.name;
                            if (s.numberOfNights) nights = s.numberOfNights;
                            if (!departurePort && s.embarkPort?.name) departurePort = s.embarkPort.name;
                            if (shipName && nights > 0) break;
                        }
                    }
                    if (shipName && nights > 0) break;
                }
            }

            if (shipName && nights > 0 && !products.find(p => p.productId === productId)) {
                products.push({ productId, itineraryId: itinId, shipName, nights, itineraryName, departurePort });
            }
        }

        console.log(`  📄 Products page ${pageNum}/${totalPages}: ${products.length} products collected`);
        pageNum++;
        if (pageNum <= totalPages) await sleep(500);
    }

    console.log(`  ✅ Found ${products.length} FL Resident products`);
    return products;
}

// ── Step 2: Fetch per-date pricing for one product ─────────────────────
async function fetchSailings(cookie, product) {
    const payload = {
        currency: 'USD', filters: [],
        partyMix: PARTY_MIX, region: 'INTL', storeId: 'DCL',
        affiliations: AFFILIATIONS,
        productId: product.productId,
        promoCode: PROMO_CODE,
        includeAdvancedBookingPrices: true,
    };
    if (product.itineraryId) payload.itineraryId = product.itineraryId;

    const resp = await fetch(SAILINGS_URL, {
        method: 'POST',
        headers: makeHeaders(cookie),
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        throw new Error(`Sailings API returned ${resp.status} for ${product.productId}`);
    }

    const data = await resp.json();
    return data.sailings || [];
}

// ── Parse sailing dates and prices ─────────────────────────────────────
function parseSailingPrices(product, sailings) {
    const results = [];

    for (const sailing of sailings) {
        const dateStr = sailing.sailDateFrom || sailing.departureDate || sailing.sailDate || '';
        if (!dateStr) continue;

        const depDate = new Date(dateStr);
        if (isNaN(depDate.getTime())) continue;

        const shipName = sailing.ship?.name || product.shipName;
        const nights = sailing.numberOfNights || product.nights;

        if (!sailing.travelParties?.['0']) continue;

        let bestBalcony = 0, bestSuite = 0;

        for (const stateroom of sailing.travelParties['0']) {
            if (!stateroom.available) continue;
            const stType = (stateroom.stateroomType || '').toUpperCase();

            let adultPrice = 0;
            try {
                adultPrice = stateroom.price?.breakdownByGuest?.['1']?.total || 0;
            } catch (_) { }
            if (adultPrice <= 0) continue;

            if (stType.includes('VERANDAH')) {
                if (bestBalcony === 0 || adultPrice < bestBalcony) bestBalcony = adultPrice;
            } else if (stType.includes('CONCIERGE')) {
                if (bestSuite === 0 || adultPrice < bestSuite) bestSuite = adultPrice;
            }
        }

        if (bestBalcony > 0 || bestSuite > 0) {
            const effNights = nights > 0 ? nights : 1;
            results.push({
                shipName,
                departureDate: depDate.toISOString().split('T')[0],
                nights: effNights,
                itinerary: product.itineraryName || '',
                port: product.departurePort || '',
                balconyPrice: bestBalcony,
                balconyPerDay: bestBalcony > 0 ? Math.round(bestBalcony / effNights * 100) / 100 : 0,
                suitePrice: bestSuite,
                suitePerDay: bestSuite > 0 ? Math.round(bestSuite / effNights * 100) / 100 : 0,
            });
        }
    }

    return results;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    const logStream = setupLogging();
    const runStartedAt = new Date();
    const runErrors = [];

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  Disney FL Resident Pricing Scraper                     ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    // ── Step 0: Get fresh cookie ──
    let cookie;
    try {
        cookie = await acquireCookie();
    } catch (err) {
        console.error(`  ❌ Cookie acquisition failed: ${err.message}`);
        runErrors.push(`Cookie: ${err.message}`);
        await recordRun(0, 0, runStartedAt, runErrors);
        return;
    }

    // ── Step 1: Discover products ──
    let products;
    try {
        products = await fetchProducts(cookie);
    } catch (err) {
        console.error(`  ❌ Discovery failed: ${err.message}`);
        runErrors.push(`Discovery: ${err.message}`);
        await recordRun(0, 0, runStartedAt, runErrors);
        return;
    }

    if (products.length === 0) {
        console.warn('  ⚠️ No FL Resident products found');
        runErrors.push('No FL Resident products found');
        await recordRun(0, 0, runStartedAt, runErrors);
        return;
    }

    // ── Step 2: Fetch per-date pricing ──
    const allResults = [];
    let prodCount = 0;

    for (const prod of products) {
        prodCount++;
        console.log(`\n  [${prodCount}/${products.length}] ${prod.shipName} ${prod.nights}N (${prod.productId})`);

        try {
            const sailings = await fetchSailings(cookie, prod);
            const prices = parseSailingPrices(prod, sailings);
            console.log(`    📅 +${prices.length} sailings with FL pricing`);
            allResults.push(...prices);
        } catch (err) {
            console.error(`    ⚠️ Failed: ${err.message}`);
            runErrors.push(`${prod.shipName}/${prod.productId}: ${err.message}`);
        }

        if (prodCount < products.length) await sleep(DELAY_MS);
    }

    // Deduplicate by (shipName, departureDate) — keep best (lowest) price
    const deduped = {};
    for (const r of allResults) {
        const key = `${r.shipName}|${r.departureDate}`;
        if (!deduped[key] || (r.balconyPrice > 0 && r.balconyPrice < (deduped[key].balconyPrice || Infinity))) {
            deduped[key] = r;
        }
    }
    const finalResults = Object.values(deduped);

    console.log(`\n  ── Total: ${finalResults.length} FL Resident sailings ──`);

    // ── Save to JSON (backup) ──
    const outputFile = path.join(__dirname, 'fl-resident-prices.json');
    fs.writeFileSync(outputFile, JSON.stringify(finalResults, null, 2));
    console.log(`  💾 Saved ${finalResults.length} records to ${outputFile}`);

    // ── Save to SQL Server ──
    await upsertToDatabase(finalResults, runStartedAt, runErrors);
}

// ── Save FL Resident prices to DB ──────────────────────────────────────
async function upsertToDatabase(results, runStartedAt, runErrors = []) {
    console.log('\n  🗄️  Connecting to SQL Server...');

    let pool;
    try {
        pool = await new sql.ConnectionPool(SQL_CONFIG).connect();
    } catch (err) {
        console.error(`  ❌ DB connection failed: ${err.message}`);
        return;
    }

    console.log('  ✅ Connected to CruiseTracker');

    // Clear stale FL Resident data first
    try {
        await pool.request().query(`
            UPDATE PriceHistory
            SET FLResBalconyPrice = NULL, FLResBalconyPerDay = NULL,
                FLResSuitePrice = NULL, FLResSuitePerDay = NULL
            WHERE CruiseLine = 'Disney'
              AND FLResBalconyPrice IS NOT NULL
        `);
        console.log('  🧹 Cleared stale FL Resident prices');
    } catch (err) {
        console.error(`  ⚠️ Failed to clear stale data: ${err.message}`);
    }

    let updated = 0, created = 0;
    const now = new Date();

    for (const r of results) {
        try {
            // 1. MERGE into Cruises (create new sailings not yet in DB)
            await pool.request()
                .input('line', sql.NVarChar, 'Disney')
                .input('ship', sql.NVarChar, r.shipName)
                .input('date', sql.Date, r.departureDate)
                .input('itin', sql.NVarChar, r.itinerary)
                .input('nights', sql.Int, r.nights || 0)
                .input('port', sql.NVarChar, r.port)
                .query(`
                    MERGE Cruises AS tgt
                    USING (SELECT @line AS CruiseLine, @ship AS ShipName, @date AS DepartureDate) AS src
                       ON tgt.CruiseLine = src.CruiseLine AND tgt.ShipName = src.ShipName AND tgt.DepartureDate = src.DepartureDate
                    WHEN NOT MATCHED THEN
                        INSERT (CruiseLine, ShipName, DepartureDate, Itinerary, Nights, DeparturePort)
                        VALUES (@line, @ship, @date, @itin, @nights, @port);
                `);

            // 2. Try UPDATE FL Resident prices on existing PriceHistory row
            const result = await pool.request()
                .input('ship', sql.NVarChar, r.shipName)
                .input('date', sql.Date, r.departureDate)
                .input('flBal', sql.Decimal(10, 2), r.balconyPrice > 0 ? r.balconyPrice : null)
                .input('flBpd', sql.Decimal(10, 2), r.balconyPerDay > 0 ? r.balconyPerDay : null)
                .input('flSuite', sql.Decimal(10, 2), r.suitePrice > 0 ? r.suitePrice : null)
                .input('flSpd', sql.Decimal(10, 2), r.suitePerDay > 0 ? r.suitePerDay : null)
                .query(`
                    UPDATE PriceHistory
                    SET FLResBalconyPrice = @flBal,
                        FLResBalconyPerDay = @flBpd,
                        FLResSuitePrice = @flSuite,
                        FLResSuitePerDay = @flSpd
                    WHERE CruiseLine = 'Disney' AND ShipName = @ship AND DepartureDate = @date
                      AND Id = (
                          SELECT TOP 1 Id FROM PriceHistory
                          WHERE CruiseLine = 'Disney' AND ShipName = @ship AND DepartureDate = @date
                          ORDER BY ScrapedAt DESC
                      )
                `);

            if (result.rowsAffected[0] > 0) {
                updated++;
            } else {
                // 3. No PriceHistory row exists — INSERT one with FL Resident prices
                await pool.request()
                    .input('line', sql.NVarChar, 'Disney')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('bp', sql.Decimal(10, 2), r.balconyPrice > 0 ? r.balconyPrice : 0)
                    .input('bpd', sql.Decimal(10, 2), r.balconyPerDay > 0 ? r.balconyPerDay : 0)
                    .input('sp', sql.Decimal(10, 2), r.suitePrice > 0 ? r.suitePrice : 0)
                    .input('spd', sql.Decimal(10, 2), r.suitePerDay > 0 ? r.suitePerDay : 0)
                    .input('flBal', sql.Decimal(10, 2), r.balconyPrice > 0 ? r.balconyPrice : null)
                    .input('flBpd', sql.Decimal(10, 2), r.balconyPerDay > 0 ? r.balconyPerDay : null)
                    .input('flSuite', sql.Decimal(10, 2), r.suitePrice > 0 ? r.suitePrice : null)
                    .input('flSpd', sql.Decimal(10, 2), r.suitePerDay > 0 ? r.suitePerDay : null)
                    .input('sat', sql.DateTime2, now)
                    .query(`
                        INSERT INTO PriceHistory
                            (CruiseLine, ShipName, DepartureDate,
                             BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay,
                             FLResBalconyPrice, FLResBalconyPerDay,
                             FLResSuitePrice, FLResSuitePerDay, ScrapedAt)
                        VALUES
                            (@line, @ship, @date,
                             @bp, @bpd, @sp, @spd,
                             @flBal, @flBpd,
                             @flSuite, @flSpd, @sat)
                    `);
                created++;
            }
        } catch (err) {
            console.error(`  ⚠️ DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    console.log(`  📊 DB: ${updated} updated, ${created} new sailings created`);

    // Record scraper run
    await recordRunToDb(pool, results.length, updated, runStartedAt, runErrors);
    await pool.close();
}

// ── Record scraper run ─────────────────────────────────────────────────
async function recordRun(found, updated, runStartedAt, runErrors) {
    let pool;
    try {
        pool = await new sql.ConnectionPool(SQL_CONFIG).connect();
        await recordRunToDb(pool, found, updated, runStartedAt, runErrors);
        await pool.close();
    } catch (_) { }
}

async function recordRunToDb(pool, found, updated, runStartedAt, runErrors) {
    try {
        await pool.request()
            .input('name', sql.NVarChar, 'Disney-FL')
            .input('started', sql.DateTime2, runStartedAt || new Date())
            .input('completed', sql.DateTime2, new Date())
            .input('found', sql.Int, found)
            .input('updated', sql.Int, updated)
            .input('errors', sql.NVarChar, runErrors.length > 0 ? runErrors.join('; ') : null)
            .input('status', sql.NVarChar, runErrors.length > 0 ? 'Partial' : 'Success')
            .query(`
                INSERT INTO ScraperRuns (ScraperName, StartedAt, CompletedAt, SailingsFound, SailingsUpdated, Errors, Status)
                VALUES (@name, @started, @completed, @found, @updated, @errors, @status);
            `);
        console.log('  📋 Scraper run recorded to ScraperRuns table');
    } catch (err) {
        console.error(`  ⚠️ Failed to record scraper run: ${err.message}`);
    }
}

// ── Run ────────────────────────────────────────────────────────────────
main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
