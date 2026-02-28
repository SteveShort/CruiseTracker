// ============================================================================
//  Oceania Cruises Price Scraper
//  Uses Oceania's public REST API (no browser automation required)
//
//  API: GET https://www.oceaniacruises.com/api/cruise-details/v1/cruises
//       Returns paginated JSON with voyage data and promotional fares
//
//  Usage:
//    node oceania-scraper.js                           # scrape all voyages
//    node oceania-scraper.js --ship "Oceania Vista"    # filter to one ship
// ============================================================================

const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');

// ── SQL Server Config (Windows Integrated Security via ODBC) ───────────
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

// ── Constants ──────────────────────────────────────────────────────────
const API_URL = 'https://www.oceaniacruises.com/api/cruise-details/v1/cruises';
const PAGE_SIZE = 50;
const DELAY_MS = 300;  // polite delay between pages

// Ship code → full name mapping
const SHIP_NAMES = {
    ALU: 'Oceania Allura',
    MNA: 'Oceania Marina',
    SIR: 'Oceania Sirena',
    VIS: 'Oceania Vista',
    RVA: 'Oceania Riviera',
    INS: 'Oceania Insignia',
    NAU: 'Oceania Nautica',
    SON: 'Oceania Sonesta',
    REG: 'Oceania Regatta',
};

// ── Logging ────────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_KEEP_DAYS = 7;

function setupLogging() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

    // Rotate: delete logs older than LOG_KEEP_DAYS
    const cutoff = Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(LOG_DIR)) {
        const fp = path.join(LOG_DIR, f);
        try {
            if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch (_) { }
    }

    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `oceania-${today}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

    console.log = (...args) => {
        const msg = `[${ts()}] ${args.join(' ')}`;
        logStream.write(msg + '\n');
        origLog(...args);
    };
    console.warn = (...args) => {
        const msg = `[${ts()}] WARN: ${args.join(' ')}`;
        logStream.write(msg + '\n');
        origWarn(...args);
    };
    console.error = (...args) => {
        const msg = `[${ts()}] ERROR: ${args.join(' ')}`;
        logStream.write(msg + '\n');
        origError(...args);
    };
}

// ── CLI Args ───────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const shipFilter = cliArgs.includes('--ship') ? cliArgs[cliArgs.indexOf('--ship') + 1] : null;

// ── Helper: polite delay ───────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Step 1: Fetch all voyages with pagination ──────────────────────────
async function fetchAllVoyages() {
    const allResults = [];
    let page = 1;
    let totalRecords = null;

    console.log(`\n🚢 Fetching Oceania Cruises voyages...`);

    while (true) {
        const url = `${API_URL}?page=${page}&pageSize=${PAGE_SIZE}&sort=price:asc`;
        const resp = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'application/json',
            }
        });

        if (!resp.ok) {
            throw new Error(`API returned ${resp.status}: ${resp.statusText}`);
        }

        const data = await resp.json();

        if (totalRecords === null) {
            totalRecords = data.pagination.totalRecords;
            console.log(`  📊 Total voyages available: ${totalRecords}`);
        }

        if (!data.results || data.results.length === 0) break;

        allResults.push(...data.results);
        console.log(`  📄 Page ${page}: ${data.results.length} voyages (${allResults.length}/${totalRecords})`);

        if (allResults.length >= totalRecords) break;
        page++;
        await sleep(DELAY_MS);
    }

    console.log(`  ✅ Fetched ${allResults.length} total voyages`);
    return allResults;
}

// ── Step 2: Parse voyages into normalized records ──────────────────────
function parseVoyages(voyages) {
    const results = [];

    for (const v of voyages) {
        const shipName = v.shipName || SHIP_NAMES[v.shipCode] || `Oceania ${v.shipCode}`;

        // Apply ship filter if specified
        if (shipFilter && !shipName.toLowerCase().includes(shipFilter.toLowerCase())) {
            continue;
        }

        // Parse embark date (format: "March 10, 2026")
        const embarkDate = new Date(v.embarkDate);
        if (isNaN(embarkDate.getTime())) {
            console.warn(`  ⚠️ Skipping ${v.id}: invalid embark date "${v.embarkDate}"`);
            continue;
        }

        // Parse fare (format: "$1,650")
        const fareStr = v.minPromotionalFare || v.minCruiseOnlyFare || v.faresFrom || '';
        const fareMatch = fareStr.replace(/[$,]/g, '');
        const fare = parseFloat(fareMatch);

        if (!fare || fare <= 0) {
            console.warn(`  ⚠️ Skipping ${v.id} (${shipName}): no valid fare`);
            continue;
        }

        // Build itinerary string from port names
        const embarkPort = v.embarkPortName || '';
        const debarkPort = v.debarkPortName || '';
        const itinerary = v.voyageName || `${embarkPort} to ${debarkPort}`;

        results.push({
            shipName,
            departureDate: embarkDate.toISOString().slice(0, 10),
            nights: v.duration || 0,
            itinerary,
            itineraryCode: v.id || null,
            embarkPort,
            debarkPort,
            fare,           // Total per-person promotional fare
            brochureFare: parseFloat((v.minBrochureFare || '').replace(/[$,]/g, '')) || null,
        });
    }

    return results;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    setupLogging();
    console.log('\n' + '='.repeat(70));
    console.log('  Oceania Cruises Price Scraper');
    console.log('  ' + new Date().toISOString());
    if (shipFilter) console.log(`  Ship filter: ${shipFilter}`);
    console.log('='.repeat(70));

    const runStartedAt = new Date();
    const runErrors = [];

    try {
        // Fetch all voyages
        const voyages = await fetchAllVoyages();

        // Parse into normalized records
        const results = parseVoyages(voyages);
        console.log(`\n  📋 Parsed ${results.length} valid sailings`);

        if (results.length === 0) {
            console.warn('  ⚠️ No valid sailings found. Exiting.');
            return;
        }

        // Save raw JSON for debugging
        const jsonPath = path.join(__dirname, 'oceania-latest.json');
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        console.log(`  💾 Saved to ${jsonPath}`);

        // Upsert to database
        await upsertToDatabase(results, runStartedAt, runErrors);

    } catch (err) {
        console.error(`\n  ❌ Fatal: ${err.message}`);
        runErrors.push(err.message);
    }

    console.log('\n  🏁 Oceania scraper run complete.\n');
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
        // Oceania fares are per-person; multiply by 2 for couple price
        const totalPrice = r.fare * 2;
        const ppd = (r.nights > 0 && totalPrice > 0)
            ? Math.round(totalPrice / r.nights * 100) / 100 : 0;

        try {
            // 1. MERGE into Cruises table
            await pool.request()
                .input('line', sql.NVarChar, 'Oceania')
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
            // Oceania's "from" price maps to BalconyPrice (their standard verandah stateroom)
            if (totalPrice > 0) {
                await pool.request()
                    .input('line', sql.NVarChar, 'Oceania')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('bp', sql.Decimal(10, 2), totalPrice)
                    .input('bpd', sql.Decimal(10, 2), ppd)
                    .input('sat', sql.DateTime2, now)
                    .query(`
                        INSERT INTO PriceHistory
                            (CruiseLine, ShipName, DepartureDate,
                             BalconyPrice, BalconyPerDay,
                             ScrapedAt)
                        VALUES
                            (@line, @ship, @date,
                             @bp, @bpd,
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
            .input('name', sql.NVarChar, 'Oceania')
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
