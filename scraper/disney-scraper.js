// ============================================================================
//  Disney Standard Pricing Scraper
//  Uses Playwright to auto-acquire __pa cookie, then Disney's internal APIs
//  to fetch standard pricing for all Disney cruise sailings from Florida.
//
//  Captures: Inside, Oceanview, Verandah (Balcony), Concierge (Suite)
//
//  Flow:
//    1. Playwright → visit Disney site → extract fresh __pa cookie
//    2. POST /dcl-apps-productavail-vas/available-products/ (discovery)
//    3. POST /dcl-apps-productavail-vas/available-sailings/ (per-date pricing)
//    4. MERGE Cruises + upsert PriceHistory
//
//  Usage:
//    node disney-scraper.js
// ============================================================================

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');

// ── SQL Server Config ──────────────────────────────────────────────────
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

// ── Constants ──────────────────────────────────────────────────────────
const BASE_URL = 'https://disneycruise.disney.go.com';
const PRODUCTS_URL = `${BASE_URL}/dcl-apps-productavail-vas/available-products/`;
const SAILINGS_URL = `${BASE_URL}/dcl-apps-productavail-vas/available-sailings/`;
const DELAY_MS = 300;

// Florida departure ports — matched against productId and productName
const FL_PORT_PATTERNS = ['port_canaveral', 'port canaveral', 'fort_lauderdale', 'fort lauderdale',
    'ft_lauderdale', 'ft lauderdale', 'miami', 'tampa', 'jacksonville'];

function isFloridaProduct(product) {
    const id = (product.productId || '').toLowerCase();
    const name = (product.productName || product.productDisplayName || '').toLowerCase();
    return FL_PORT_PATTERNS.some(p => id.includes(p) || name.includes(p));
}

function extractPort(product) {
    const id = (product.productId || '').toLowerCase();
    const name = (product.productName || '').toLowerCase();
    if (id.includes('port_canaveral') || name.includes('port canaveral')) return 'Port Canaveral';
    if (id.includes('fort_lauderdale') || id.includes('ft_lauderdale') || name.includes('fort lauderdale')) return 'Ft. Lauderdale';
    if (id.includes('miami') || name.includes('miami')) return 'Miami';
    if (id.includes('tampa') || name.includes('tampa')) return 'Tampa';
    if (id.includes('jacksonville') || name.includes('jacksonville')) return 'Jacksonville';
    return '';
}

// ── Logging ────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_KEEP_DAYS = 7;

function setupLogging() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
        const fp = path.join(LOG_DIR, f);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch (_) { }
    }
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `disney-${today}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const origLog = console.log, origWarn = console.warn, origError = console.error;
    const ts = () => new Date().toISOString().slice(11, 19);
    console.log = (...a) => { const m = a.join(' '); origLog(m); logStream.write(`[${ts()}] ${m}\n`); };
    console.warn = (...a) => { const m = a.join(' '); origWarn(m); logStream.write(`[${ts()}] WARN: ${m}\n`); };
    console.error = (...a) => { const m = a.join(' '); origError(m); logStream.write(`[${ts()}] ERROR: ${m}\n`); };
    return logStream;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Step 0: Acquire fresh __pa cookie ──────────────────────────────────
async function acquireCookie() {
    console.log('  🌐 Launching browser to acquire __pa cookie...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    try {
        await page.goto(`${BASE_URL}/cruises-destinations/list/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        let cookies = await context.cookies(BASE_URL);
        let paCookie = cookies.find(c => c.name === '__pa');
        if (!paCookie) {
            await page.waitForTimeout(5000);
            cookies = await context.cookies(BASE_URL);
            paCookie = cookies.find(c => c.name === '__pa');
        }
        if (!paCookie) throw new Error('__pa cookie not found after page load');
        console.log(`  ✅ Got fresh __pa cookie (${paCookie.value.slice(0, 30)}...)`);
        return paCookie.value;
    } finally {
        await browser.close();
        console.log('  🔒 Browser closed');
    }
}

// ── API Headers ────────────────────────────────────────────────────────
const PARTY_MIX = [{
    accessible: false, adultCount: 2, childCount: 0,
    nonAdultAges: [], partyMixId: '0'
}];

function makeHeaders(cookie) {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/cruises-destinations/list/`,
        'Cookie': `__pa=${cookie}`,
        'x-conversation-id': crypto.randomUUID(),
        'x-correlation-id': crypto.randomUUID(),
        'x-disney-internal-is-cast': 'false',
        'x-use-voyage-svc': 'true',
    };
}

// ── Step 1: Discover products ──────────────────────────────────────────
async function fetchProducts(cookie) {
    const products = [];
    let pageNum = 1;
    let totalPages = 1;

    console.log('  🔍 Discovering Disney products...');

    while (pageNum <= totalPages) {
        const payload = {
            currency: 'USD', filters: [],
            partyMix: PARTY_MIX, region: 'INTL', storeId: 'DCL',
            affiliations: [],          // no FL Resident filter
            page: pageNum, pageHistory: false,
            includeAdvancedBookingPrices: true,
            exploreMorePage: 1, exploreMorePageHistory: false,
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
            let shipName = '', nights = 0, itineraryName = '';

            itineraryName = product.title || product.productName || product.productDisplayName || productId;
            const departurePort = extractPort(product);

            if (product.itineraries) {
                for (const itin of product.itineraries) {
                    if (itin.sailings) {
                        for (const s of itin.sailings) {
                            if (s.ship?.name) shipName = s.ship.name;
                            if (s.numberOfNights) nights = s.numberOfNights;
                            if (!departurePort && s.embarkPort?.name) { }
                            if (shipName && nights > 0) break;
                        }
                    }
                    if (shipName && nights > 0) break;
                }
            }

            if (shipName && nights > 0 && !products.find(p => p.productId === productId)) {
                const isFL = isFloridaProduct(product);
                products.push({ productId, itineraryId: itinId, shipName, nights, itineraryName, departurePort, isFL });
            }
        }

        console.log(`  📄 Products page ${pageNum}/${totalPages}: ${products.length} products collected`);
        pageNum++;
        if (pageNum <= totalPages) await sleep(500);
    }

    // Filter to FL-only
    const flProducts = products.filter(p => p.isFL);
    const nonFL = products.length - flProducts.length;
    console.log(`  ✅ Found ${flProducts.length} FL departure products (${nonFL} non-FL filtered out)`);
    return flProducts;
}

// ── Step 2: Fetch per-date pricing ─────────────────────────────────────
async function fetchSailings(cookie, product) {
    const payload = {
        currency: 'USD', filters: [],
        partyMix: PARTY_MIX, region: 'INTL', storeId: 'DCL',
        affiliations: [],
        productId: product.productId,
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

// ── Parse all stateroom prices ─────────────────────────────────────────
function parseSailingPrices(product, sailings) {
    const results = [];

    for (const sailing of sailings) {
        const dateStr = sailing.sailDateFrom || sailing.departureDate || sailing.sailDate || '';
        if (!dateStr) continue;
        const depDate = new Date(dateStr);
        if (isNaN(depDate.getTime())) continue;

        const shipName = sailing.ship?.name || product.shipName;
        const nights = sailing.numberOfNights || product.nights;
        const port = product.departurePort || '';

        if (!sailing.travelParties?.['0']) continue;

        let bestInside = 0, bestOceanview = 0, bestBalcony = 0, bestSuite = 0;

        for (const stateroom of sailing.travelParties['0']) {
            if (!stateroom.available) continue;
            const stType = (stateroom.stateroomType || '').toUpperCase();

            let adultPrice = 0;
            try {
                adultPrice = stateroom.price?.breakdownByGuest?.['1']?.total || 0;
            } catch (_) { }
            if (adultPrice <= 0) continue;

            if (stType.includes('INSIDE')) {
                if (bestInside === 0 || adultPrice < bestInside) bestInside = adultPrice;
            } else if (stType.includes('OCEANVIEW') || stType.includes('OCEAN VIEW')) {
                if (bestOceanview === 0 || adultPrice < bestOceanview) bestOceanview = adultPrice;
            } else if (stType.includes('VERANDAH')) {
                if (bestBalcony === 0 || adultPrice < bestBalcony) bestBalcony = adultPrice;
            } else if (stType.includes('CONCIERGE')) {
                if (bestSuite === 0 || adultPrice < bestSuite) bestSuite = adultPrice;
            }
        }

        if (bestInside > 0 || bestOceanview > 0 || bestBalcony > 0 || bestSuite > 0) {
            const n = nights > 0 ? nights : 1;
            const ppd = (price) => price > 0 ? Math.round(price / n * 100) / 100 : 0;
            results.push({
                shipName,
                departureDate: depDate.toISOString().split('T')[0],
                nights: n,
                itinerary: product.itineraryName || '',
                port,
                insidePrice: bestInside, insidePerDay: ppd(bestInside),
                oceanviewPrice: bestOceanview, oceanviewPerDay: ppd(bestOceanview),
                balconyPrice: bestBalcony, balconyPerDay: ppd(bestBalcony),
                suitePrice: bestSuite, suitePerDay: ppd(bestSuite),
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
    console.log('║  Disney Standard Pricing Scraper                       ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    // Step 0: Cookie
    let cookie;
    try {
        cookie = await acquireCookie();
    } catch (err) {
        console.error(`  ❌ Cookie acquisition failed: ${err.message}`);
        runErrors.push(`Cookie: ${err.message}`);
        await recordRun(0, 0, runStartedAt, runErrors);
        return;
    }

    // Step 1: Discover products
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
        console.warn('  ⚠️ No Disney FL products found');
        runErrors.push('No products found');
        await recordRun(0, 0, runStartedAt, runErrors);
        return;
    }

    // Build port/itinerary metadata from products, keyed by ship+nights
    const portMap = {};
    const itinMap = {};
    for (const prod of products) {
        const key = `${prod.shipName}|${prod.nights}`;
        if (prod.departurePort && !portMap[key]) portMap[key] = prod.departurePort;
        if (prod.itineraryName && !itinMap[key]) itinMap[key] = prod.itineraryName;
    }

    // Step 2: Fetch ALL sailings from a single product (Disney API returns all dates)
    console.log(`\n  📅 Fetching all sailings (using product: ${products[0].productId})...`);
    let allSailings;
    try {
        allSailings = await fetchSailings(cookie, products[0]);
        console.log(`  ✅ Got ${allSailings.length} raw sailings`);
    } catch (err) {
        console.error(`  ❌ Sailings fetch failed: ${err.message}`);
        runErrors.push(`Sailings: ${err.message}`);
        await recordRun(0, 0, runStartedAt, runErrors);
        return;
    }

    // Parse all prices with a dummy product (we'll enrich with metadata after)
    const dummyProd = { shipName: '', nights: 0, itineraryName: '', departurePort: '' };
    const rawPrices = parseSailingPrices(dummyProd, allSailings);

    // Enrich with port/itinerary metadata and filter to FL departures
    const flShips = new Set(products.map(p => p.shipName));
    const finalResults = [];
    for (const r of rawPrices) {
        if (!flShips.has(r.shipName)) continue; // Skip non-FL ships
        const key = `${r.shipName}|${r.nights}`;
        r.port = portMap[key] || '';
        r.itinerary = itinMap[key] || '';
        finalResults.push(r);
    }

    // Show sample
    for (const r of finalResults.slice(0, 5)) {
        const parts = [];
        if (r.insidePerDay > 0) parts.push(`I:$${r.insidePerDay}`);
        if (r.oceanviewPerDay > 0) parts.push(`O:$${r.oceanviewPerDay}`);
        if (r.balconyPerDay > 0) parts.push(`V:$${r.balconyPerDay}`);
        if (r.suitePerDay > 0) parts.push(`C:$${r.suitePerDay}`);
        console.log(`    ${r.shipName.padEnd(18)} ${r.departureDate}  ${r.nights}N  ${parts.join('  ')}`);
    }
    if (finalResults.length > 5) console.log(`    ... +${finalResults.length - 5} more`);

    console.log(`\n  ── Total: ${finalResults.length} Disney FL sailings ──`);

    // Save backup JSON
    const outputFile = path.join(__dirname, 'disney-prices.json');
    fs.writeFileSync(outputFile, JSON.stringify(finalResults, null, 2));
    console.log(`  💾 Saved to ${outputFile}`);

    // Save to SQL Server
    await upsertToDatabase(finalResults, runStartedAt, runErrors);
}

// ── Database Upsert ────────────────────────────────────────────────────
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

    let updated = 0, created = 0;
    const now = new Date();

    for (const r of results) {
        try {
            // 1. MERGE into Cruises
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
                        VALUES (@line, @ship, @date, @itin, @nights, @port)
                    WHEN MATCHED THEN
                        UPDATE SET Itinerary = COALESCE(NULLIF(@itin,''), tgt.Itinerary),
                                   Nights = CASE WHEN @nights > 0 THEN @nights ELSE tgt.Nights END,
                                   DeparturePort = COALESCE(NULLIF(@port,''), tgt.DeparturePort);
                `);

            // 2. Try UPDATE latest PriceHistory row
            const result = await pool.request()
                .input('line', sql.NVarChar, 'Disney')
                .input('ship', sql.NVarChar, r.shipName)
                .input('date', sql.Date, r.departureDate)
                .input('ip', sql.Decimal(10, 2), r.insidePrice || 0)
                .input('ipd', sql.Decimal(10, 2), r.insidePerDay || 0)
                .input('op', sql.Decimal(10, 2), r.oceanviewPrice || 0)
                .input('opd', sql.Decimal(10, 2), r.oceanviewPerDay || 0)
                .input('bp', sql.Decimal(10, 2), r.balconyPrice || 0)
                .input('bpd', sql.Decimal(10, 2), r.balconyPerDay || 0)
                .input('sp', sql.Decimal(10, 2), r.suitePrice || 0)
                .input('spd', sql.Decimal(10, 2), r.suitePerDay || 0)
                .input('sat', sql.DateTime2, now)
                .query(`
                    UPDATE TOP (1) PriceHistory
                    SET InsidePrice = @ip, InsidePerDay = @ipd,
                        OceanviewPrice = @op, OceanviewPerDay = @opd,
                        BalconyPrice = @bp, BalconyPerDay = @bpd,
                        SuitePrice = @sp, SuitePerDay = @spd,
                        ScrapedAt = @sat
                    WHERE CruiseLine = @line AND ShipName = @ship AND DepartureDate = @date
                      AND Id = (
                          SELECT TOP 1 Id FROM PriceHistory
                          WHERE CruiseLine = @line AND ShipName = @ship AND DepartureDate = @date
                          ORDER BY ScrapedAt DESC
                      )
                `);

            if (result.rowsAffected[0] > 0) {
                updated++;
            } else {
                // 3. No PriceHistory row — INSERT new one
                await pool.request()
                    .input('line', sql.NVarChar, 'Disney')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('ip', sql.Decimal(10, 2), r.insidePrice || 0)
                    .input('ipd', sql.Decimal(10, 2), r.insidePerDay || 0)
                    .input('op', sql.Decimal(10, 2), r.oceanviewPrice || 0)
                    .input('opd', sql.Decimal(10, 2), r.oceanviewPerDay || 0)
                    .input('bp', sql.Decimal(10, 2), r.balconyPrice || 0)
                    .input('bpd', sql.Decimal(10, 2), r.balconyPerDay || 0)
                    .input('sp', sql.Decimal(10, 2), r.suitePrice || 0)
                    .input('spd', sql.Decimal(10, 2), r.suitePerDay || 0)
                    .input('sat', sql.DateTime2, now)
                    .query(`
                        INSERT INTO PriceHistory
                            (CruiseLine, ShipName, DepartureDate,
                             InsidePrice, InsidePerDay, OceanviewPrice, OceanviewPerDay,
                             BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay, ScrapedAt)
                        VALUES
                            (@line, @ship, @date,
                             @ip, @ipd, @op, @opd,
                             @bp, @bpd, @sp, @spd, @sat)
                    `);
                created++;
            }
        } catch (err) {
            console.error(`  ⚠️ DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    console.log(`  📊 DB: ${updated} updated, ${created} new sailings created`);

    await recordRunToDb(pool, results.length, updated + created, runStartedAt, runErrors);
    await pool.close();
}

// ── Record Scraper Run ─────────────────────────────────────────────────
async function recordRun(found, updated, startedAt, errors) {
    let pool;
    try {
        pool = await new sql.ConnectionPool(SQL_CONFIG).connect();
        await recordRunToDb(pool, found, updated, startedAt, errors);
        await pool.close();
    } catch (_) { }
}

async function recordRunToDb(pool, found, updated, startedAt, errors) {
    try {
        await pool.request()
            .input('name', sql.NVarChar, 'Disney')
            .input('started', sql.DateTime2, startedAt || new Date())
            .input('completed', sql.DateTime2, new Date())
            .input('found', sql.Int, found)
            .input('updated', sql.Int, updated)
            .input('errors', sql.NVarChar, errors.length > 0 ? errors.join('; ') : null)
            .input('status', sql.NVarChar, errors.length > 0 ? 'Partial' : 'Success')
            .query(`
                INSERT INTO ScraperRuns (ScraperName, StartedAt, CompletedAt, SailingsFound, SailingsUpdated, Errors, Status)
                VALUES (@name, @started, @completed, @found, @updated, @errors, @status);
            `);
        console.log('  📋 Scraper run recorded');
    } catch (err) {
        console.error(`  ⚠️ Failed to record run: ${err.message}`);
    }
}

// ── Run ────────────────────────────────────────────────────────────────
main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
