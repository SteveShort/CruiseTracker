// ============================================================================
//  Regent Seven Seas Cruises Price Scraper
//  Uses RSSC's public REST API (same parent company as Oceania — NCLH)
//
//  API: GET https://www.rssc.com/api/browse/v1/cruises
//       Returns all voyages in a single page (no pagination needed)
//       Duration/fare embedded in tripDescription[] array
//
//  Usage:
//    node regent-scraper.js                                # scrape all voyages
//    node regent-scraper.js --ship "Seven Seas Splendor"   # filter to one ship
// ============================================================================

const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');

// ── SQL Server Config (Windows Integrated Security via ODBC) ───────────
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

// ── Constants ──────────────────────────────────────────────────────────
const API_URL = 'https://www.rssc.com/api/browse/v1/cruises';

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
    const logFile = path.join(LOG_DIR, `regent-${today}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const origLog = console.log, origWarn = console.warn, origError = console.error;
    const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log = (...a) => { const m = `[${ts()}] ${a.join(' ')}`; logStream.write(m + '\n'); origLog(...a); };
    console.warn = (...a) => { const m = `[${ts()}] WARN: ${a.join(' ')}`; logStream.write(m + '\n'); origWarn(...a); };
    console.error = (...a) => { const m = `[${ts()}] ERROR: ${a.join(' ')}`; logStream.write(m + '\n'); origError(...a); };
}

// ── CLI Args ───────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const shipFilter = cliArgs.includes('--ship') ? cliArgs[cliArgs.indexOf('--ship') + 1] : null;

// ── Helper: extract field from tripDescription array ───────────────────
function getTripField(tripDesc, id) {
    if (!Array.isArray(tripDesc)) return null;
    const item = tripDesc.find(d => d.descriptionId === id);
    return item ? item.primaryInfo : null;
}

// ── Step 1: Fetch all voyages (single request — API returns all) ───────
async function fetchAllVoyages() {
    console.log('\n🚢 Fetching Regent Seven Seas voyages...');
    const url = `${API_URL}?page=1&pageSize=1000&sort=price:asc`;
    const resp = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
        }
    });
    if (!resp.ok) throw new Error(`API returned ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();
    console.log(`  📊 Total voyages: ${data.total || data.results.length}`);
    return data.results || [];
}

// ── Step 2: Parse voyages into normalized records ──────────────────────
function parseVoyages(voyages) {
    const results = [];
    for (const v of voyages) {
        const shipName = v.shipName || 'Unknown';
        if (shipFilter && !shipName.toLowerCase().includes(shipFilter.toLowerCase())) continue;

        // Parse departure date (ISO format: "2026-01-12")
        const departureDate = v.departureDate;
        if (!departureDate || departureDate.length < 10) {
            console.warn(`  ⚠️ Skipping ${v.voyageId}: no departure date`);
            continue;
        }

        // Extract duration and fare from tripDescription array
        const nights = parseInt(getTripField(v.tripDescription, 'duration')) || 0;
        const fareStr = getTripField(v.tripDescription, 'ebsFare') || '';
        const fare = parseFloat(fareStr.replace(/[$,]/g, ''));

        if (!fare || fare <= 0) {
            // Waitlisted or sold out — skip
            console.log(`  ⏭️ Skipping ${v.voyageId} (${shipName}): ${fareStr || 'no fare'}`);
            continue;
        }

        const embarkPort = v.fromDestination || '';
        const debarkPort = v.toDestination || '';
        const itinerary = v.voyageName || `${embarkPort} to ${debarkPort}`;

        results.push({
            shipName,
            departureDate,
            nights,
            itinerary,
            itineraryCode: v.voyageId || null,
            embarkPort,
            debarkPort,
            fare,  // Per-person all-inclusive fare
        });
    }
    return results;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    setupLogging();
    console.log('\n' + '='.repeat(70));
    console.log('  Regent Seven Seas Cruises Price Scraper');
    console.log('  ' + new Date().toISOString());
    if (shipFilter) console.log(`  Ship filter: ${shipFilter}`);
    console.log('='.repeat(70));

    const runStartedAt = new Date();
    const runErrors = [];

    try {
        const voyages = await fetchAllVoyages();
        const results = parseVoyages(voyages);
        console.log(`\n  📋 Parsed ${results.length} valid sailings`);

        if (results.length === 0) {
            console.warn('  ⚠️ No valid sailings found. Exiting.');
            return;
        }

        const jsonPath = path.join(__dirname, 'regent-latest.json');
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        console.log(`  💾 Saved to ${jsonPath}`);

        await upsertToDatabase(results, runStartedAt, runErrors);
    } catch (err) {
        console.error(`\n  ❌ Fatal: ${err.message}`);
        runErrors.push(err.message);
    }

    console.log('\n  🏁 Regent scraper run complete.\n');
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
        // Regent fares are per-person all-inclusive; ×2 for couple
        const totalPrice = r.fare * 2;
        const ppd = (r.nights > 0 && totalPrice > 0)
            ? Math.round(totalPrice / r.nights * 100) / 100 : 0;

        try {
            await pool.request()
                .input('line', sql.NVarChar, 'Regent')
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

            // Regent is all-inclusive luxury — map fare to SuitePrice (since these are suite-level fares)
            if (totalPrice > 0) {
                await pool.request()
                    .input('line', sql.NVarChar, 'Regent')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('sp', sql.Decimal(10, 2), totalPrice)
                    .input('spd', sql.Decimal(10, 2), ppd)
                    .input('bp', sql.Decimal(10, 2), totalPrice)
                    .input('bpd', sql.Decimal(10, 2), ppd)
                    .input('sat', sql.DateTime2, now)
                    .query(`
                        INSERT INTO PriceHistory
                            (CruiseLine, ShipName, DepartureDate,
                             BalconyPrice, BalconyPerDay,
                             SuitePrice, SuitePerDay,
                             ScrapedAt)
                        VALUES
                            (@line, @ship, @date,
                             @bp, @bpd,
                             @sp, @spd,
                             @sat)
                    `);
                inserted++;
            }
        } catch (err) {
            console.error(`  ⚠️ DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    try {
        await pool.request()
            .input('name', sql.NVarChar, 'Regent')
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
