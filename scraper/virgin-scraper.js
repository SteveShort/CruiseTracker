// ============================================================================
//  Virgin Voyages Price Scraper
//  Uses Playwright to bypass DataDome and extract voyage data from the
//  search results page including prices, ports, and itineraries.
//
//  Strategy: Render the search page, scroll to load all voyages, extract
//  voyage card data (price, ports, itinerary) from the DOM, then decode
//  ship/date/nights from the embedded voyageId links.
//
//  Usage:
//    node virgin-scraper.js                              # scrape all voyages
//    node virgin-scraper.js --ship "Scarlet Lady"        # filter to one ship
// ============================================================================

const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');
const { chromium } = require('playwright');

// ── SQL Server Config (Windows Integrated Security via ODBC) ───────────
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

// ── Constants ──────────────────────────────────────────────────────────
const SEARCH_URL = 'https://www.virginvoyages.com/book/voyage-planner/find-a-voyage?currencyCode=USD';

// Ship prefix → full name (from voyageId first 2 chars)
const SHIP_CODES = {
    SC: 'Scarlet Lady',
    VL: 'Valiant Lady',
    RS: 'Resilient Lady',
    BR: 'Brilliant Lady',
};

// ── Logging ────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_KEEP_DAYS = 7;

function setupLogging() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
        const fp = path.join(LOG_DIR, f);
        if (f.startsWith('virgin_') && fs.statSync(fp).mtimeMs < cutoff)
            fs.unlinkSync(fp);
    }

    const ts = () => new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(LOG_DIR, `virgin_${ts()}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const origLog = console.log, origWarn = console.warn, origErr = console.error;
    console.log = (...a) => { origLog(...a); logStream.write(a.join(' ') + '\n'); };
    console.warn = (...a) => { origWarn(...a); logStream.write('[WARN] ' + a.join(' ') + '\n'); };
    console.error = (...a) => { origErr(...a); logStream.write('[ERR] ' + a.join(' ') + '\n'); };
}

// ── CLI Args ───────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const shipFilter = cliArgs.includes('--ship') ? cliArgs[cliArgs.indexOf('--ship') + 1] : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Decode voyageId → structured data ──────────────────────────────────
function decodeVoyageId(id) {
    // Format: SC2603134NKW → Ship=SC, Date=2026-03-13, Nights=4, PkgCode=NKW
    const match = id.match(/^([A-Z]{2})(\d{2})(\d{2})(\d{2})(\d+)(N\w+)$/);
    if (!match) return null;
    const [, shipCode, yy, mm, dd, nights, pkgCode] = match;
    return {
        shipCode,
        shipName: SHIP_CODES[shipCode] || `Virgin ${shipCode}`,
        departureDate: `20${yy}-${mm}-${dd}`,
        nights: parseInt(nights),
        packageCode: `${nights}${pkgCode}`,
        voyageId: id,
    };
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    setupLogging();
    console.log('\n' + '='.repeat(70));
    console.log('  Virgin Voyages Price Scraper');
    console.log('  ' + new Date().toISOString());
    if (shipFilter) console.log(`  Ship filter: ${shipFilter}`);
    console.log('='.repeat(70));

    const runStartedAt = new Date();
    const runErrors = [];

    console.log(`\n🚢 Launching browser for Virgin Voyages...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    // Track graphql/API responses for pricing data
    const apiPricing = {};
    page.on('response', async (response) => {
        try {
            const url = response.url();
            if (url.includes('/graphql') && response.status() === 200) {
                const json = await response.json();
                // Capture any pricing data from GraphQL responses
                const data = json?.data;
                if (data) {
                    for (const [key, value] of Object.entries(data)) {
                        if (Array.isArray(value)) {
                            for (const item of value) {
                                if (item?.voyageId || item?.id) {
                                    apiPricing[item.voyageId || item.id] = item;
                                }
                            }
                        }
                    }
                }
            }
        } catch { /* skip non-JSON */ }
    });

    try {
        console.log(`\n  🌐 Navigating to search page...`);
        await page.goto(SEARCH_URL, { waitUntil: 'networkidle', timeout: 60000 });
        console.log(`  ✅ Search page loaded`);
        await sleep(3000);

        // Scroll down to trigger lazy loading of all voyage cards
        console.log(`  📜 Scrolling to load all voyages...`);
        let previousHeight = 0;
        for (let i = 0; i < 40; i++) {
            const height = await page.evaluate(() => document.body.scrollHeight);
            if (height === previousHeight) {
                await sleep(500);
                const h2 = await page.evaluate(() => document.body.scrollHeight);
                if (h2 === previousHeight) break;
            }
            previousHeight = height;
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await sleep(1500);
        }
        await sleep(2000);

        // ── Extract voyage card data from the DOM ──
        console.log(`  📊 Extracting voyage card data from DOM...`);
        const cardData = await page.evaluate(() => {
            const results = [];

            // Find all anchor links with voyageId params — these are the booking links
            const links = document.querySelectorAll('a[href*="voyageId"], a[href*="packageCode"]');
            const processed = new Set();

            links.forEach(link => {
                const href = link.href;
                if (processed.has(href)) return;
                processed.add(href);

                const url = new URL(href, window.location.origin);
                const voyageIds = (url.searchParams.get('voyageIds') || url.searchParams.get('voyageId') || '').split(',').filter(Boolean);
                const packageCode = url.searchParams.get('packageCode') || '';

                // Walk up the DOM to find the containing card/section
                let card = link.closest('section, article, [class*="card"], [class*="Card"], div[class*="voyage"], div[class*="Voyage"]');
                if (!card) card = link.parentElement?.parentElement?.parentElement;

                const cardText = card?.textContent || link.textContent || '';

                // Extract price from the card
                const priceMatch = cardText.match(/\$\s*([\d,]+)/);
                const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

                results.push({
                    voyageIds,
                    packageCode,
                    price,
                });
            });

            // ── Extract itinerary names from "Book Now" buttons with aria-labels ──
            const itineraryMap = {};  // packageCode → readable name
            const cruiseBtns = document.querySelectorAll('a.cruiseBtn[aria-label]');
            cruiseBtns.forEach(btn => {
                const label = btn.getAttribute('aria-label') || '';
                const name = label.replace(/^Book Now\s*/i, '').trim();
                if (!name) return;
                try {
                    const url = new URL(btn.href, window.location.origin);
                    const pkg = url.searchParams.get('packageCode') || '';
                    if (pkg) itineraryMap[pkg] = name;
                    // Also map by voyageIds
                    const vids = (url.searchParams.get('voyageIds') || url.searchParams.get('voyageId') || '').split(',').filter(Boolean);
                    vids.forEach(vid => { itineraryMap[vid] = name; });
                } catch { /* skip */ }
            });

            return { cards: results, itineraryMap };
        });

        const { cards, itineraryMap } = cardData;
        console.log(`  📋 Extracted ${cards.length} voyage cards from DOM`);
        console.log(`  🏷️  Found ${Object.keys(itineraryMap).length} itinerary name mappings`);
        console.log(`  📡 Intercepted ${Object.keys(apiPricing).length} items from API`);

        // ── Build price map from card data (packageCode → price) ──
        const pricedPackages = {};
        for (const card of cards) {
            if (card.price && card.packageCode) {
                pricedPackages[card.packageCode] = card.price;
            }
            // Also map individual voyageIds
            if (card.price) {
                for (const vid of card.voyageIds) {
                    pricedPackages[vid] = card.price;
                }
            }
        }

        // ── Collect unique voyageIds ──
        const allVoyageIds = new Set();
        for (const card of cards) {
            for (const vid of card.voyageIds) {
                allVoyageIds.add(vid);
            }
        }
        console.log(`  📋 Total unique voyage IDs: ${allVoyageIds.size}`);

        // ── Decode voyage IDs and build results ──
        const results = [];
        for (const vid of allVoyageIds) {
            const decoded = decodeVoyageId(vid);
            if (!decoded) continue;

            // Apply ship filter
            if (shipFilter && !decoded.shipName.toLowerCase().includes(shipFilter.toLowerCase())) continue;

            // Look up price: first from API data, then from card data, then from packageCode
            let price = null;
            const apiData = apiPricing[vid];
            if (apiData?.startingPrice) price = apiData.startingPrice;
            if (!price) price = pricedPackages[vid] || pricedPackages[decoded.packageCode] || null;

            // Determine port from card text or ship's known homeport
            let embarkPort = '';
            if (apiData?.departurePort?.name) embarkPort = apiData.departurePort.name;

            // Most Virgin ships have fixed homeports:
            if (!embarkPort) {
                if (decoded.shipCode === 'SC') embarkPort = 'Miami, Florida';
                else if (decoded.shipCode === 'VL') embarkPort = 'Miami, Florida';  // Also Barcelona for Med
                else if (decoded.shipCode === 'RS') embarkPort = 'Miami, Florida';
                else if (decoded.shipCode === 'BL') embarkPort = 'Miami, Florida';
            }

            // Build itinerary name — prefer aria-label name, then API title, then package code
            let itinerary = itineraryMap[vid] || itineraryMap[decoded.packageCode] || decoded.packageCode;
            if (apiData?.title) itinerary = apiData.title;

            results.push({
                shipName: decoded.shipName,
                departureDate: decoded.departureDate,
                nights: decoded.nights,
                itinerary,
                itineraryCode: vid,
                packageCode: decoded.packageCode,
                embarkPort,
                debarkPort: embarkPort,  // Virgin voyages are roundtrip
                balconyPrice: price,     // "Starting from" price is typically Sea Terrace (balcony equiv)
                suitePrice: null,        // Rockstar pricing requires per-voyage detail page
                insidePrice: null,
                oceanviewPrice: null,
            });
        }

        console.log(`\n  📋 Parsed ${results.length} unique sailings`);
        const withPrice = results.filter(r => r.balconyPrice);
        console.log(`  💰 ${withPrice.length} sailings with pricing data`);

        if (results.length === 0) {
            console.warn('  ⚠️ No valid sailings found. Exiting.');
            await browser.close();
            return;
        }

        // Save JSON
        const jsonPath = path.join(__dirname, 'virgin-latest.json');
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        console.log(`  💾 Saved to ${jsonPath}`);

        // Upsert to database
        await upsertToDatabase(results, runStartedAt, runErrors);

    } catch (err) {
        console.error(`\n  ❌ Fatal: ${err.message}`);
        runErrors.push(err.message);
    } finally {
        await browser.close();
    }

    console.log('\n  🏁 Virgin Voyages scraper run complete.\n');
}

// ── Save to SQL Server CruiseTracker DB ────────────────────────────────
async function upsertToDatabase(results, runStartedAt, runErrors = []) {
    console.log('\n  🗄️  Connecting to SQL Server...');

    let pool;
    try {
        pool = await new sql.ConnectionPool(SQL_CONFIG).connect();
    } catch (err) {
        console.error(`  ❌ DB connection failed: ${err.message}`);
        console.log('  💡 Prices saved to JSON only. DB update skipped.');
        return;
    }

    console.log('  ✅ Connected to CruiseTracker');

    let upserted = 0, inserted = 0;
    const now = new Date();

    for (const r of results) {
        // Virgin fares are per-person ("per Sailor"); multiply by 2 for couple price
        const bp = r.balconyPrice ? r.balconyPrice * 2 : null;
        const sp = r.suitePrice ? r.suitePrice * 2 : null;       // Rockstar Quarters
        const ip = r.insidePrice ? r.insidePrice * 2 : null;
        const ovp = r.oceanviewPrice ? r.oceanviewPrice * 2 : null;
        const primaryPrice = bp || sp || ovp || ip || 0;
        const ppd = (r.nights > 0 && primaryPrice > 0)
            ? Math.round(primaryPrice / r.nights * 100) / 100 : 0;

        try {
            // 1. MERGE into Cruises table
            await pool.request()
                .input('line', sql.NVarChar, 'Virgin Voyages')
                .input('ship', sql.NVarChar, r.shipName)
                .input('date', sql.Date, r.departureDate)
                .input('itin', sql.NVarChar, r.itinerary)
                .input('itinCode', sql.NVarChar, r.itineraryCode || null)
                .input('nights', sql.Int, r.nights || 0)
                .input('port', sql.NVarChar, r.embarkPort)
                .query(`
                    MERGE Cruises AS tgt
                    USING (SELECT @line AS CruiseLine, @ship AS ShipName, @date AS DepartureDate) AS src
                       ON tgt.CruiseLine = src.CruiseLine AND tgt.ShipName = src.ShipName AND tgt.DepartureDate = src.DepartureDate
                    WHEN MATCHED THEN
                        UPDATE SET Itinerary = @itin, Nights = @nights, DeparturePort = @port, ItineraryCode = @itinCode
                    WHEN NOT MATCHED THEN
                        INSERT (CruiseLine, ShipName, DepartureDate, Itinerary, Nights, DeparturePort, ItineraryCode)
                        VALUES (@line, @ship, @date, @itin, @nights, @port, @itinCode);
                `);
            upserted++;

            // 2. INSERT price history row
            if (primaryPrice > 0) {
                const req = pool.request()
                    .input('line', sql.NVarChar, 'Virgin Voyages')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('sat', sql.DateTime2, now);

                if (bp) { req.input('bp', sql.Decimal(10, 2), bp); req.input('bpd', sql.Decimal(10, 2), r.nights > 0 ? Math.round(bp / r.nights * 100) / 100 : 0); }
                if (sp) { req.input('sp', sql.Decimal(10, 2), sp); req.input('spd', sql.Decimal(10, 2), r.nights > 0 ? Math.round(sp / r.nights * 100) / 100 : 0); }
                if (ip) { req.input('ip', sql.Decimal(10, 2), ip); }
                if (ovp) { req.input('ovp', sql.Decimal(10, 2), ovp); }

                const cols = ['CruiseLine', 'ShipName', 'DepartureDate', 'ScrapedAt'];
                const vals = ['@line', '@ship', '@date', '@sat'];
                if (bp) { cols.push('BalconyPrice', 'BalconyPerDay'); vals.push('@bp', '@bpd'); }
                if (sp) { cols.push('SuitePrice', 'SuitePerDay'); vals.push('@sp', '@spd'); }
                if (ip) { cols.push('InsidePrice'); vals.push('@ip'); }
                if (ovp) { cols.push('OceanviewPrice'); vals.push('@ovp'); }

                await req.query(`INSERT INTO PriceHistory (${cols.join(', ')}) VALUES (${vals.join(', ')})`);
                inserted++;
            }
        } catch (err) {
            console.error(`  ⚠️ DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    // ── Record scraper run ──
    try {
        await pool.request()
            .input('name', sql.NVarChar, 'Virgin Voyages')
            .input('started', sql.DateTime2, runStartedAt || new Date())
            .input('completed', sql.DateTime2, new Date())
            .input('found', sql.Int, results.length)
            .input('updated', sql.Int, inserted)
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

    await pool.close();
    console.log(`  📊 DB: ${upserted} cruises upserted, ${inserted} price snapshots inserted`);
}

// ── Run ────────────────────────────────────────────────────────────────
main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
