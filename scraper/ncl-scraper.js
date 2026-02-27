// ============================================================================
//  NCL Verified Price Scraper — API Edition
//  Uses NCL's internal JSON APIs (no browser automation required)
//
//  Step 1: Discovery — GET /api/v2/vacations/search?embPorts=...
//          Finds all Florida-departing itineraries across all ships
//  Step 2: Sailings  — GET /api/vacations/sailings/{itineraryCode}
//          Gets every departure date + prices for all stateroom types
//
//  Usage:
//    node ncl-scraper.js                          # scrape all FL ports
//    node ncl-scraper.js --ship "Norwegian Aqua"  # filter to one ship
// ============================================================================

const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');

// ── SQL Server Config (Windows Integrated Security via ODBC) ───────────
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

// ── Constants ──────────────────────────────────────────────────────────
const FLORIDA_PORTS = 'MIA,JAX,PCV,TPA';         // Miami, Jacksonville, Port Canaveral, Tampa
const DISCOVERY_URL = 'https://www.ncl.com/api/v2/vacations/search';
const SAILINGS_URL = 'https://www.ncl.com/api/vacations/sailings';
const PAGE_SIZE = 100;
const DELAY_MS = 500;  // polite delay between sailings API calls

// Port code → friendly name mapping
const PORT_NAMES = {
    MIA: 'Miami',
    JAX: 'Jacksonville',
    PCV: 'Port Canaveral',
    TPA: 'Tampa',
    FLL: 'Fort Lauderdale',
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
    const logFile = path.join(LOG_DIR, `ncl-${today}.log`);
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

// ── CLI Args ───────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const shipArgIdx = cliArgs.indexOf('--ship');
const SHIP_FILTER = shipArgIdx >= 0 ? cliArgs[shipArgIdx + 1] : null;

// ── Helper: polite delay ───────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Step 1: Discover all Florida itineraries ───────────────────────────
async function fetchAllItineraries() {
    const itineraries = [];
    let offset = 0;
    let total = Infinity;

    console.log(`  🔍 Discovering itineraries for ports: ${FLORIDA_PORTS}`);

    while (offset < total) {
        const url = `${DISCOVERY_URL}?embPorts=${FLORIDA_PORTS}&limit=${PAGE_SIZE}&offset=${offset}`;
        console.log(`  📄 Fetching page offset=${offset}...`);

        const resp = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        if (!resp.ok) {
            throw new Error(`Discovery API returned ${resp.status}: ${resp.statusText}`);
        }

        const data = await resp.json();
        total = data.total || 0;

        if (!data.itineraries || data.itineraries.length === 0) break;

        for (const r of data.itineraries) {
            itineraries.push({
                code: r.code,
                title: r.title || '',
                shipName: r.ship?.title || '',
                shipCode: r.ship?.code || '',
                duration: r.duration?.days || 0,
                embarkPort: r.startingLocation || 'Unknown',
                portsOfCall: (r.portsOfCall || []).map(p => p.title || p.name || '').join(', '),
            });
        }

        offset += PAGE_SIZE;
    }

    console.log(`  ✅ Found ${itineraries.length} itineraries (API reports ${total} total)`);
    return itineraries;
}

// ── Step 2: Fetch per-date pricing for one itinerary ───────────────────
async function fetchSailings(itineraryCode) {
    const url = `${SAILINGS_URL}/${itineraryCode}`;
    const resp = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
    });

    if (!resp.ok) {
        throw new Error(`Sailings API returned ${resp.status} for ${itineraryCode}`);
    }

    const data = await resp.json();
    return data.pricingStateRooms || [];
}

// ── Build per-sailing records from API data ────────────────────────────
function buildSailingRecords(itinerary, pricingRooms) {
    // Group by (sailDate) — each date has multiple stateroom types
    const byDate = {};

    for (const room of pricingRooms) {
        const dateKey = room.vacationStartDate; // e.g. "2026-03-09T00:00"
        if (!dateKey) continue;

        if (!byDate[dateKey]) {
            byDate[dateKey] = {
                shipName: itinerary.shipName,
                departureDate: dateKey.split('T')[0], // "2026-03-09"
                itinerary: itinerary.title,
                itineraryCode: itinerary.code,
                nights: itinerary.duration,
                port: itinerary.embarkPort,
                endDate: room.sailEndDate?.split('T')[0] || null,
                prices: {},
            };
        }

        // Map stateroom type to price (per-person combined = includes tax)
        const type = room.stateroomType;
        const price = room.combinedPrice || null;
        const status = room.status;

        if (price && status === 'AVAILABLE') {
            byDate[dateKey].prices[type] = price;
        }
    }

    return Object.values(byDate);
}

// ── Normalize port name ────────────────────────────────────────────────
function normalizePort(portName) {
    if (!portName) return 'Unknown';
    if (/port canaveral|orlando/i.test(portName)) return 'Port Canaveral';
    if (/fort lauderdale|ft\.?\s*lauderdale/i.test(portName)) return 'Fort Lauderdale';
    if (/miami/i.test(portName)) return 'Miami';
    if (/tampa/i.test(portName)) return 'Tampa';
    if (/jacksonville/i.test(portName)) return 'Jacksonville';
    return portName;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    const logStream = setupLogging();
    const runStartedAt = new Date();
    const runErrors = [];

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  NCL Price Scraper — API Edition (Florida ports)        ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    if (SHIP_FILTER) console.log(`  🔸 Filtering to ship: ${SHIP_FILTER}`);

    // ── Step 1: Discover itineraries ──
    let itineraries;
    try {
        itineraries = await fetchAllItineraries();
    } catch (err) {
        console.error(`  ❌ Discovery failed: ${err.message}`);
        runErrors.push(`Discovery: ${err.message}`);
        await upsertToDatabase([], runStartedAt, runErrors);
        return;
    }

    // Apply ship filter if specified
    if (SHIP_FILTER) {
        itineraries = itineraries.filter(it =>
            it.shipName.toLowerCase().includes(SHIP_FILTER.toLowerCase())
        );
        console.log(`  🔸 After ship filter: ${itineraries.length} itineraries`);
    }

    // Log unique ships found
    const ships = [...new Set(itineraries.map(it => it.shipName))].sort();
    console.log(`  🚢 Ships with FL sailings: ${ships.join(', ')} (${ships.length} ships)`);

    // ── Step 2: Fetch per-date pricing for each itinerary ──
    const allResults = [];
    let itinCount = 0;

    for (const itin of itineraries) {
        itinCount++;
        console.log(`\n  [${itinCount}/${itineraries.length}] ${itin.shipName} — ${itin.title}`);

        try {
            const pricingRooms = await fetchSailings(itin.code);
            const sailings = buildSailingRecords(itin, pricingRooms);

            console.log(`    📅 ${sailings.length} sailing dates found`);

            for (const s of sailings) {
                const prices = s.prices;
                const balcony = prices.BALCONY || null;
                const inside = prices.INSIDE || null;
                const oceanview = prices.OCEANVIEW || null;
                const suite = prices.MINISUITE || null; // Club Balcony Suite
                const haven = prices.HAVEN || null;

                allResults.push({
                    shipName: s.shipName,
                    departureDate: s.departureDate,
                    itinerary: s.itinerary,
                    itineraryCode: s.itineraryCode,
                    nights: s.nights,
                    port: normalizePort(s.port),
                    insidePP: inside,
                    oceanviewPP: oceanview,
                    balconyPP: balcony,
                    suitePP: suite,
                    havenPP: haven,
                });
            }
        } catch (err) {
            console.error(`    ⚠️ Failed: ${err.message}`);
            runErrors.push(`${itin.shipName}/${itin.code}: ${err.message}`);
        }

        // Polite delay between API calls
        if (itinCount < itineraries.length) {
            await sleep(DELAY_MS);
        }
    }

    console.log(`\n  ── Total: ${allResults.length} sailings across ${ships.length} ships ──`);

    // ── Save to JSON (backup) ──
    const outputFile = path.join(__dirname, 'verified-prices.json');
    fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2));
    console.log(`  💾 Saved ${allResults.length} records to ${outputFile}`);

    // ── Save to SQL Server ──
    await upsertToDatabase(allResults, runStartedAt, runErrors);
}

// ── Save to SQL Server CruiseTracker DB ────────────────────────────────
async function upsertToDatabase(results, runStartedAt, runErrors = []) {
    console.log('\n  🗄️  Connecting to SQL Server...');

    let pool;
    try {
        pool = await new sql.ConnectionPool(SQL_CONFIG).connect();
    } catch (err) {
        console.error(`  ❌ DB connection failed: ${err.message}`);
        console.log('  💡 Verified prices saved to JSON only. DB update skipped.');
        return;
    }

    console.log('  ✅ Connected to CruiseTracker');

    let upserted = 0, inserted = 0;
    const now = new Date();

    for (const r of results) {
        // Calculate per-person total (×2) and per-day rates
        const balconyTotal = r.balconyPP ? r.balconyPP * 2 : 0;
        const balconyPPD = (r.nights && r.nights > 0 && balconyTotal > 0)
            ? Math.round(balconyTotal / r.nights * 100) / 100 : 0;

        const insideTotal = r.insidePP ? r.insidePP * 2 : 0;
        const insidePPD = (r.nights && r.nights > 0 && insideTotal > 0)
            ? Math.round(insideTotal / r.nights * 100) / 100 : 0;

        const oceanviewTotal = r.oceanviewPP ? r.oceanviewPP * 2 : 0;
        const oceanviewPPD = (r.nights && r.nights > 0 && oceanviewTotal > 0)
            ? Math.round(oceanviewTotal / r.nights * 100) / 100 : 0;

        const suiteTotal = r.suitePP ? r.suitePP * 2 : 0;
        const suitePPD = (r.nights && r.nights > 0 && suiteTotal > 0)
            ? Math.round(suiteTotal / r.nights * 100) / 100 : 0;

        const havenTotal = r.havenPP ? r.havenPP * 2 : 0;
        const havenPPD = (r.nights && r.nights > 0 && havenTotal > 0)
            ? Math.round(havenTotal / r.nights * 100) / 100 : 0;

        try {
            // 1. MERGE into Cruises table (insert new / update existing)
            await pool.request()
                .input('line', sql.NVarChar, 'Norwegian')
                .input('ship', sql.NVarChar, r.shipName)
                .input('date', sql.Date, r.departureDate)
                .input('itin', sql.NVarChar, r.itinerary)
                .input('itinCode', sql.NVarChar, r.itineraryCode || null)
                .input('nights', sql.Int, r.nights || 0)
                .input('port', sql.NVarChar, r.port)
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

            // 2. Always INSERT a new PriceHistory row (for price tracking over time)
            if (balconyTotal > 0 || insideTotal > 0) {
                await pool.request()
                    .input('line', sql.NVarChar, 'Norwegian')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('ip', sql.Decimal(10, 2), insideTotal > 0 ? insideTotal : 0)
                    .input('ipd', sql.Decimal(10, 2), insidePPD > 0 ? insidePPD : 0)
                    .input('op', sql.Decimal(10, 2), oceanviewTotal > 0 ? oceanviewTotal : 0)
                    .input('opd', sql.Decimal(10, 2), oceanviewPPD > 0 ? oceanviewPPD : 0)
                    .input('bp', sql.Decimal(10, 2), balconyTotal > 0 ? balconyTotal : 0)
                    .input('bpd', sql.Decimal(10, 2), balconyPPD > 0 ? balconyPPD : 0)
                    .input('sp', sql.Decimal(10, 2), suiteTotal > 0 ? suiteTotal : 0)
                    .input('spd', sql.Decimal(10, 2), suitePPD > 0 ? suitePPD : 0)
                    .input('vbp', sql.Decimal(10, 2), balconyTotal > 0 ? balconyTotal : null)
                    .input('vbpd', sql.Decimal(10, 2), balconyPPD > 0 ? balconyPPD : null)
                    .input('vsp', sql.Decimal(10, 2), havenTotal > 0 ? havenTotal : null)
                    .input('vspd', sql.Decimal(10, 2), havenPPD > 0 ? havenPPD : null)
                    .input('vat', sql.DateTime2, now)
                    .input('sat', sql.DateTime2, now)
                    .query(`
                        INSERT INTO PriceHistory
                            (CruiseLine, ShipName, DepartureDate,
                             InsidePrice, InsidePerDay, OceanviewPrice, OceanviewPerDay,
                             BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay,
                             VerifiedBalconyPrice, VerifiedBalconyPerDay,
                             VerifiedSuitePrice, VerifiedSuitePerDay,
                             VerifiedAt, ScrapedAt)
                        VALUES
                            (@line, @ship, @date,
                             @ip, @ipd, @op, @opd,
                             @bp, @bpd, @sp, @spd,
                             @vbp, @vbpd, @vsp, @vspd,
                             @vat, @sat)
                    `);
                inserted++;
            }
        } catch (err) {
            // Log but continue — don't let one bad row kill the whole run
            console.error(`  ⚠️ DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    // ── Record scraper run in ScraperRuns table ──
    try {
        await pool.request()
            .input('name', sql.NVarChar, 'NCL')
            .input('started', sql.DateTime2, runStartedAt || new Date())
            .input('completed', sql.DateTime2, new Date())
            .input('found', sql.Int, results.length)
            .input('updated', sql.Int, inserted)
            .input('errors', sql.NVarChar, runErrors.length > 0 ? runErrors.join('; ') : null)
            .input('status', sql.NVarChar, runErrors.length > 0 ? 'Partial' : 'Success')
            .query(`
                IF OBJECT_ID('ScraperRuns', 'U') IS NULL
                    CREATE TABLE ScraperRuns (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        ScraperName NVARCHAR(50) NOT NULL,
                        StartedAt DATETIME2 NOT NULL,
                        CompletedAt DATETIME2 NOT NULL,
                        SailingsFound INT NOT NULL DEFAULT 0,
                        SailingsUpdated INT NOT NULL DEFAULT 0,
                        Errors NVARCHAR(MAX) NULL,
                        Status NVARCHAR(20) NOT NULL DEFAULT 'Success'
                    );
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
