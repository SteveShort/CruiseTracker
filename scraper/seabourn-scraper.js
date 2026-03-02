// ============================================================================
//  Seabourn Price Scraper
//  Uses Playwright to bypass Akamai Bot Manager, then makes API calls
//  to Seabourn's Solr-based search from within the browser session.
//
//  Strategy:
//  1. Launch Playwright, navigate to seabourn.com to establish Akamai cookies
//  2. Use page.evaluate(fetch) to call /search/sbncruisesearch with session
//  3. Parse results, upsert to CruiseTracker database
//
//  Usage:
//    node seabourn-scraper.js                             # scrape all voyages
//    node seabourn-scraper.js --ship "Seabourn Venture"   # filter to one ship
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
const SEABOURN_HOME = 'https://www.seabourn.com/en/us/find-a-cruise';
const SEARCH_API = 'https://www.seabourn.com/search/sbncruisesearch';
const PAGE_SIZE = 100;

const SEARCH_FIELDS = [
    'cruiseId', 'itineraryId', 'tourId', 'entityId', 'name',
    'shipId', 'shipName', 'departDate', 'arrivalDate', 'duration',
    'embarkPortCode', 'embarkPortName', 'disembarkPortCode', 'disembarkPortName',
    'destinationIds', 'cruiseType', 'contentPath', 'soldOut',
    'price_USD_anonymous', 'price_USD_FLEXIBLE',
    'fare_USD_anonymous', 'fare_USD_FLEXIBLE',
    'taxesAndFeesCombined_USD_anonymous', 'taxesAndFeesCombined_USD_FLEXIBLE',
    'roomCategoryId_USD_anonymous', 'roomCategoryId_USD_FLEXIBLE',
].join(',');

// ── Logging ────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_KEEP_DAYS = 7;

function setupLogging() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
        const fp = path.join(LOG_DIR, f);
        if (f.startsWith('seabourn_') && fs.statSync(fp).mtimeMs < cutoff)
            fs.unlinkSync(fp);
    }

    const ts = () => new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(LOG_DIR, `seabourn_${ts()}.log`);
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

// ── Step 1: Fetch all voyages via in-browser API calls ─────────────────
async function fetchAllVoyages() {
    console.log(`\n🚢 Launching browser for Seabourn...`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    // Navigate to lightweight page to establish Akamai cookies
    console.log(`  🌐 Establishing session at seabourn.com...`);
    await page.goto('https://www.seabourn.com/en/us', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`  ✅ Session established`);
    await sleep(2000);

    // Now make API calls from within the browser context
    let allDocs = [];
    let start = 0;
    let totalFound = 0;

    do {
        const result = await page.evaluate(async ({ searchApi, fields, pageSize, startOffset }) => {
            const params = new URLSearchParams({
                start: startOffset.toString(),
                rows: pageSize.toString(),
                country: 'us',
                language: 'en',
                fq: 'departDate:[NOW/DAY+1DAY TO *]',
                soldOut: 'false',
                fl: fields,
            });

            const resp = await fetch(`${searchApi}?${params.toString()}`, {
                headers: {
                    'accept': 'application/json',
                    'clientid': 'WEB',
                    'brand': 'sbn',
                    'locale': 'en_US',
                    'currencycode': 'USD',
                },
            });

            if (!resp.ok) return { error: resp.status };
            const json = await resp.json();
            return {
                docs: json?.response?.docs || [],
                numFound: json?.response?.numFound || 0,
            };
        }, { searchApi: SEARCH_API, fields: SEARCH_FIELDS, pageSize: PAGE_SIZE, startOffset: start });

        if (result.error) {
            console.error(`  ❌ HTTP ${result.error} at start=${start}`);
            break;
        }

        allDocs.push(...result.docs);
        totalFound = result.numFound;
        console.log(`  📄 Page ${Math.floor(start / PAGE_SIZE) + 1}: ${result.docs.length} voyages (${allDocs.length}/${totalFound})`);

        start += PAGE_SIZE;
        await sleep(500);
    } while (start < totalFound);

    await browser.close();
    console.log(`  ✅ Fetched ${allDocs.length} total voyages`);
    return allDocs;
}

// ── Step 2: Parse voyages into normalized records ──────────────────────
function parseVoyages(rawDocs) {
    const results = [];
    const seen = new Set();

    for (const doc of rawDocs) {
        const cruiseId = doc.cruiseId || '';
        const departDate = doc.departDate ? doc.departDate.substring(0, 10) : null;
        if (!departDate) continue;

        const dedup = `${cruiseId}_${departDate}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);

        // Parse ship name — "Seabourn Sojourn#@#SJ"
        let shipName = doc.shipName || '';
        if (shipName.includes('#@#')) shipName = shipName.split('#@#')[0].trim();
        if (!shipName) continue;

        if (shipFilter && !shipName.toLowerCase().includes(shipFilter.toLowerCase())) continue;

        // Parse ports — "Fremantle (Perth), Australia#@#PER"
        let embarkPort = doc.embarkPortName || '';
        if (embarkPort.includes('#@#')) embarkPort = embarkPort.split('#@#')[0].trim();

        let debarkPort = doc.disembarkPortName || '';
        if (debarkPort.includes('#@#')) debarkPort = debarkPort.split('#@#')[0].trim();

        const nights = doc.duration || 0;
        const itinerary = doc.name || `${embarkPort} to ${debarkPort}`;

        // Seabourn is all-suite → map to SuitePrice
        const suitePrice = doc.price_USD_anonymous || doc.price_USD_FLEXIBLE || 0;

        results.push({
            shipName,
            departureDate: departDate,
            nights,
            itinerary,
            itineraryCode: cruiseId,
            embarkPort,
            debarkPort,
            suitePrice,
        });
    }

    return results;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    setupLogging();
    console.log('\n' + '='.repeat(70));
    console.log('  Seabourn Price Scraper');
    console.log('  ' + new Date().toISOString());
    if (shipFilter) console.log(`  Ship filter: ${shipFilter}`);
    console.log('='.repeat(70));

    const runStartedAt = new Date();
    const runErrors = [];

    try {
        const rawDocs = await fetchAllVoyages();
        const results = parseVoyages(rawDocs);
        console.log(`\n  📋 Parsed ${results.length} unique sailings`);

        if (results.length === 0) {
            console.warn('  ⚠️ No valid sailings found. Exiting.');
            return;
        }

        // Save JSON
        const rawPath = path.join(__dirname, 'seabourn-raw.json');
        fs.writeFileSync(rawPath, JSON.stringify(rawDocs, null, 2));

        const jsonPath = path.join(__dirname, 'seabourn-latest.json');
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        console.log(`  💾 Saved to ${jsonPath}`);

        await upsertToDatabase(results, runStartedAt, runErrors);

    } catch (err) {
        console.error(`\n  ❌ Fatal: ${err.message}`);
        runErrors.push(err.message);
    }

    console.log('\n  🏁 Seabourn scraper run complete.\n');
}

// ── Save to SQL Server CruiseTracker DB ────────────────────────────────
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

    let upserted = 0, inserted = 0;
    const now = new Date();

    for (const r of results) {
        // Seabourn prices are per-guest; multiply by 2 for couple price
        const sp = r.suitePrice ? r.suitePrice * 2 : null;
        const ppd = (r.nights > 0 && sp > 0) ? Math.round(sp / r.nights * 100) / 100 : 0;

        try {
            await pool.request()
                .input('line', sql.NVarChar, 'Seabourn')
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

            if (sp > 0) {
                await pool.request()
                    .input('line', sql.NVarChar, 'Seabourn')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('sat', sql.DateTime2, now)
                    .input('sp', sql.Decimal(10, 2), sp)
                    .input('spd', sql.Decimal(10, 2), ppd)
                    .query(`
                        INSERT INTO PriceHistory (CruiseLine, ShipName, DepartureDate, ScrapedAt, SuitePrice, SuitePerDay)
                        VALUES (@line, @ship, @date, @sat, @sp, @spd)
                    `);
                inserted++;
            }
        } catch (err) {
            console.error(`  ⚠️ DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    try {
        await pool.request()
            .input('name', sql.NVarChar, 'Seabourn')
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
