// ============================================================================
//  Silversea Cruises Price Scraper
//  Uses Silversea's Algolia search API (no browser automation required)
//
//  API: POST https://ogg7av1jsp-dsn.algolia.net/1/indexes/*/queries
//       Returns cruise data with pricing in clean JSON via Algolia InstantSearch
//
//  Usage:
//    node silversea-scraper.js                            # scrape all voyages
//    node silversea-scraper.js --ship "Silver Nova"       # filter to one ship
// ============================================================================

const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');

// ── SQL Server Config (Windows Integrated Security via ODBC) ───────────
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

// ── Algolia Config ─────────────────────────────────────────────────────
const ALGOLIA_URL = 'https://ogg7av1jsp-dsn.algolia.net/1/indexes/*/queries';
const ALGOLIA_APP_ID = 'OGG7AV1JSP';
const ALGOLIA_API_KEY = '4d498c12cbd77b674c5d672621bbad43';
const INDEX_NAME = 'prod_cruises_north-america';
const HITS_PER_PAGE = 200;   // Algolia max is 1000, 200 is safe per request

// ── Logging ────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_KEEP_DAYS = 7;

function setupLogging() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
        const fp = path.join(LOG_DIR, f);
        if (f.startsWith('silversea_') && fs.statSync(fp).mtimeMs < cutoff)
            fs.unlinkSync(fp);
    }

    const ts = () => new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(LOG_DIR, `silversea_${ts()}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const origLog = console.log, origWarn = console.warn, origErr = console.error;
    console.log = (...a) => { origLog(...a); logStream.write(a.join(' ') + '\n'); };
    console.warn = (...a) => { origWarn(...a); logStream.write('[WARN] ' + a.join(' ') + '\n'); };
    console.error = (...a) => { origErr(...a); logStream.write('[ERR] ' + a.join(' ') + '\n'); };
}

// ── CLI Args ───────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const shipFilter = cliArgs.includes('--ship') ? cliArgs[cliArgs.indexOf('--ship') + 1] : null;

// ── Step 1: Fetch all voyages via Algolia ───────────────────────────────
async function fetchAllVoyages() {
    const allHits = [];
    let page = 0;
    let totalHits = null;
    const nowMs = Date.now();

    console.log(`\n🚢 Fetching Silversea voyages via Algolia...`);

    while (true) {
        const body = JSON.stringify({
            requests: [{
                indexName: INDEX_NAME,
                params: [
                    `filters=(departureTimestamp > ${nowMs}) AND (visible:true)`,
                    `hitsPerPage=${HITS_PER_PAGE}`,
                    `page=${page}`,
                    `facets=["*"]`,
                ].join('&'),
            }],
        });

        const resp = await fetch(ALGOLIA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-algolia-application-id': ALGOLIA_APP_ID,
                'x-algolia-api-key': ALGOLIA_API_KEY,
                'Referer': 'https://www.silversea.com/',
                'Origin': 'https://www.silversea.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
            body,
        });

        if (!resp.ok) {
            throw new Error(`Algolia API returned ${resp.status}: ${resp.statusText}`);
        }

        const data = await resp.json();
        const result = data.results[0];

        if (totalHits === null) {
            totalHits = result.nbHits;
            console.log(`  📊 Total voyages available: ${totalHits}`);
        }

        if (!result.hits || result.hits.length === 0) break;

        allHits.push(...result.hits);
        console.log(`  📄 Page ${page + 1}: ${result.hits.length} hits (${allHits.length}/${totalHits})`);

        if (allHits.length >= totalHits) break;
        page++;
    }

    console.log(`  ✅ Fetched ${allHits.length} total voyages`);
    return allHits;
}

// ── Step 2: Parse voyages into normalized records ──────────────────────
function parseVoyages(hits) {
    const results = [];

    for (const h of hits) {
        const shipName = h.content?.shipName || 'Unknown';

        // Apply ship filter if specified
        if (shipFilter && !shipName.toLowerCase().includes(shipFilter.toLowerCase())) {
            continue;
        }

        // Parse departure date
        const depDateStr = h.departurePort?.itineraryDate;
        if (!depDateStr) {
            console.warn(`  ⚠️ Skipping ${h.objectID}: no departure date`);
            continue;
        }
        const departureDate = depDateStr.slice(0, 10); // "2026-05-25"

        // Parse pricing (US pricing)
        const usPricing = h.countries?.US?.p;
        if (!usPricing) {
            console.warn(`  ⚠️ Skipping ${h.objectID} (${shipName}): no US pricing`);
            continue;
        }

        const fare = usPricing.a || usPricing.oa || 0;  // current price, fallback to original
        if (!fare || fare <= 0) {
            console.warn(`  ⚠️ Skipping ${h.objectID} (${shipName}): zero fare`);
            continue;
        }

        const nights = h.days ? h.days - 1 : 0;  // Silversea shows "days" not "nights"
        const embarkPort = h.departurePort?.city?.en || '';
        const debarkPort = h.arrivalPort?.city?.en || '';

        // Build itinerary name
        const itinerary = h.content?.title?.en
            || h.content?.voyageName?.en
            || `${embarkPort} to ${debarkPort}`;

        results.push({
            shipName: `Silver ${shipName.replace(/^Silver\s*/i, '')}`,  // Normalize: "Silver Nova"
            departureDate,
            nights,
            itinerary,
            itineraryCode: h.objectID || null,
            embarkPort,
            debarkPort,
            fare,                    // Per-person fare (all-inclusive, all-suite)
            originalFare: usPricing.oa || null,
        });
    }

    return results;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    setupLogging();
    console.log('\n' + '='.repeat(70));
    console.log('  Silversea Cruises Price Scraper');
    console.log('  ' + new Date().toISOString());
    if (shipFilter) console.log(`  Ship filter: ${shipFilter}`);
    console.log('='.repeat(70));

    const runStartedAt = new Date();
    const runErrors = [];

    try {
        // Fetch all voyages
        const hits = await fetchAllVoyages();

        // Parse into normalized records
        const results = parseVoyages(hits);
        console.log(`\n  📋 Parsed ${results.length} valid sailings`);

        if (results.length === 0) {
            console.warn('  ⚠️ No valid sailings found. Exiting.');
            return;
        }

        // Save raw JSON for debugging
        const jsonPath = path.join(__dirname, 'silversea-latest.json');
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        console.log(`  💾 Saved to ${jsonPath}`);

        // Upsert to database
        await upsertToDatabase(results, runStartedAt, runErrors);

    } catch (err) {
        console.error(`\n  ❌ Fatal: ${err.message}`);
        runErrors.push(err.message);
    }

    console.log('\n  🏁 Silversea scraper run complete.\n');
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
        // Silversea fares are per-person all-inclusive; multiply by 2 for couple price
        const totalPrice = r.fare * 2;
        const ppd = (r.nights > 0 && totalPrice > 0)
            ? Math.round(totalPrice / r.nights * 100) / 100 : 0;

        try {
            // 1. MERGE into Cruises table
            await pool.request()
                .input('line', sql.NVarChar, 'Silversea')
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
            // Silversea is all-suite → map to SuitePrice (their standard stateroom IS a suite)
            if (totalPrice > 0) {
                await pool.request()
                    .input('line', sql.NVarChar, 'Silversea')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('sp', sql.Decimal(10, 2), totalPrice)
                    .input('spd', sql.Decimal(10, 2), ppd)
                    .input('sat', sql.DateTime2, now)
                    .query(`
                        INSERT INTO PriceHistory
                            (CruiseLine, ShipName, DepartureDate,
                             SuitePrice, SuitePerDay,
                             ScrapedAt)
                        VALUES
                            (@line, @ship, @date,
                             @sp, @spd,
                             @sat)
                    `);
                inserted++;
            }
        } catch (err) {
            console.error(`  ⚠️ DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    // ── Record scraper run ──
    try {
        await pool.request()
            .input('name', sql.NVarChar, 'Silversea')
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
