// celebrity-scraper.js
//  Celebrity Cruises Verified Price Scraper - GraphQL API
//  Fetches all FL-departing sailings with per-stateroom pricing
//  from Celebrity's own GraphQL API. No browser needed.

const sql = require('mssql/msnodesqlv8');
const path = require('path');
const fs = require('fs');

// -- Config --
const SQL_CONFIG = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=STEVEOFFICEPC\\ORACLE2SQL;Database=CruiseTracker;Trusted_Connection=Yes;',
};

const GRAPHQL_URL = 'https://www.celebritycruises.com/cruises/graph';

// FL departure port codes
const FL_PORTS = ['FLL', 'MIA', 'TPA', 'PCN'];
const FL_PORT_FILTER = `departurePort:${FL_PORTS.join(',')}`;

// Port code -> friendly name
const PORT_NAMES = {
    FLL: 'Fort Lauderdale',
    MIA: 'Miami',
    TPA: 'Tampa',
    PCN: 'Port Canaveral',
};

const PAGE_SIZE = 50;

// -- GraphQL Query (captured from Celebrity's website) --
const CRUISE_SEARCH_QUERY = `query cruiseSearch_CruisesRiver($filters: String, $qualifiers: String, $sort: CruiseSearchSort, $pagination: CruiseSearchPagination, $nlSearch: String, $enableNewCasinoExperience: Boolean = false) {
  cruiseSearch(
    filters: $filters
    qualifiers: $qualifiers
    sort: $sort
    pagination: $pagination
    nlSearch: $nlSearch
  ) {
    results {
      cruises {
        id
        masterSailing {
          itinerary {
            name
            code
            sailingNights
            totalNights
            portSequence
            departurePort {
              code
              name
              __typename
            }
            ship {
              code
              name
              __typename
            }
            __typename
          }
          __typename
        }
        sailings {
          id
          sailDate
          startDate
          endDate
          stateroomClassPricing {
            price {
              value
              originalAmount @include(if: $enableNewCasinoExperience)
              taxesAndFeesAmount @include(if: $enableNewCasinoExperience)
              areTaxesAndFeesIncluded @include(if: $enableNewCasinoExperience)
              currency {
                code
                __typename
              }
              __typename
            }
            stateroomClass {
              id
              content {
                code
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
      total
      __typename
    }
    __typename
  }
}`;

const HEADERS = {
    'Content-Type': 'application/json',
    'apollographql-client-name': 'cel-NextGen-Cruise-Search',
    'brand': 'C',
    'country': 'USA',
    'currency': 'USD',
    'language': 'en',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// -- Fetch sailings page --
async function fetchPage(skip, qualifiers) {
    const body = {
        operationName: 'cruiseSearch_CruisesRiver',
        variables: {
            enableNewCasinoExperience: true,
            filters: `voyageType:OCEAN;${FL_PORT_FILTER}`,
            qualifiers: qualifiers,
            sort: { by: 'SAILDATE' },
            pagination: { count: PAGE_SIZE, skip },
        },
        query: CRUISE_SEARCH_QUERY,
    };

    const resp = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`GraphQL returned ${resp.status}: ${text.substring(0, 200)}`);
    }

    const json = await resp.json();
    if (json.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).substring(0, 300)}`);
    }

    const searchData = json.data?.cruiseSearch?.results || {};
    return {
        total: searchData.total || 0,
        cruises: searchData.cruises || [],
    };
}

// -- Parse pricing from stateroom classes --
function parsePricing(stateroomClassPricing, nights) {
    const prices = {
        insidePrice: 0, insidePerDay: 0,
        oceanviewPrice: 0, oceanviewPerDay: 0,
        balconyPrice: 0, balconyPerDay: 0,
        suitePrice: 0, suitePerDay: 0,
    };

    if (!stateroomClassPricing) return prices;

    for (const cat of stateroomClassPricing) {
        const classId = cat.stateroomClass?.id;
        const ppPrice = cat.price?.value || 0;  // per-person price
        if (ppPrice <= 0) continue;

        // Convert to 2-person total and per-day
        const total2 = Math.round(ppPrice * 2 * 100) / 100;
        const perDay = nights > 0 ? Math.round(total2 / nights * 100) / 100 : 0;

        switch (classId) {
            case 'INTERIOR':
                prices.insidePrice = total2;
                prices.insidePerDay = perDay;
                break;
            case 'OUTSIDE':
                prices.oceanviewPrice = total2;
                prices.oceanviewPerDay = perDay;
                break;
            case 'BALCONY':
            case 'CONCIERGE':
            case 'AQUA':
                // Use cheapest veranda-type as "Balcony"
                if (prices.balconyPrice === 0 || total2 < prices.balconyPrice) {
                    prices.balconyPrice = total2;
                    prices.balconyPerDay = perDay;
                }
                break;
            case 'DELUXE':
                // Suite / The Retreat
                prices.suitePrice = total2;
                prices.suitePerDay = perDay;
                break;
        }
    }

    return prices;
}

// -- Format ship name (CELEBRITY REFLECTION -> Celebrity Reflection) --
function formatShipName(raw) {
    if (!raw) return '';
    return raw.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

// -- Flatten into individual sailings with pricing --
function flattenCruises(allCruises) {
    const results = [];
    for (const cruise of allCruises) {
        const itin = cruise.masterSailing?.itinerary;
        const itinName = itin?.name || '';
        const nights = itin?.sailingNights || itin?.totalNights || 0;
        const shipName = formatShipName(itin?.ship?.name || '');
        const portCode = itin?.departurePort?.code || '';
        const portName = PORT_NAMES[portCode] || itin?.departurePort?.name || portCode;

        if (!cruise.sailings) continue;

        for (const sailing of cruise.sailings) {
            const sailDate = sailing.sailDate;
            if (!sailDate) continue;

            const prices = parsePricing(sailing.stateroomClassPricing, nights);

            // Skip if no pricing at all
            if (prices.insidePrice === 0 && prices.balconyPrice === 0 &&
                prices.oceanviewPrice === 0 && prices.suitePrice === 0) continue;

            results.push({
                shipName,
                departureDate: sailDate,
                nights,
                itinerary: itinName,
                port: portName,
                ...prices,
            });
        }
    }
    return results;
}

// -- Main --
async function main() {
    console.log('===========================================================');
    console.log('  Celebrity Cruises Verified Price Scraper                  ');
    console.log('===========================================================');

    const runStartedAt = new Date();
    const runErrors = [];

    async function fetchAll(qualifiers) {
        const allCruises = [];
        let skip = 0;
        let totalCount = 0;
        let pageNum = 0;

        try {
            do {
                pageNum++;
                const data = await fetchPage(skip, qualifiers);
                totalCount = data.total || totalCount;

                if (!data.cruises || data.cruises.length === 0) break;
                allCruises.push(...data.cruises);

                console.log(`  Page ${pageNum}: ${allCruises.length}/${totalCount} cruise products`);
                skip += PAGE_SIZE;
                if (skip < totalCount) await sleep(500);
            } while (skip < totalCount);
        } catch (err) {
            console.error(`  API error: ${err.message}`);
            runErrors.push(`API: ${err.message}`);
            if (allCruises.length === 0) throw err;
        }
        return allCruises;
    }

    console.log(`  Fetching Celebrity FL sailings for 2 Adults...`);
    let adultCruises = [];
    try {
        adultCruises = await fetchAll('');
        console.log(`  Got ${adultCruises.length} cruise products (Adult)`);
    } catch {
        await recordRun(0, 0, runStartedAt, runErrors);
        return;
    }

    console.log(`\n  Fetching Celebrity FL sailings for Family (2A+2K)...`);
    let familyCruises = [];
    try {
        familyCruises = await fetchAll('offers:accessible:false,guestAges:30,30,8,10');
        console.log(`  Got ${familyCruises.length} cruise products (Family)`);
    } catch {
        console.warn('  Failed to get family prices, proceeding with only adult prices');
    }

    const adultResults = flattenCruises(adultCruises);
    const familyResults = flattenCruises(familyCruises);

    const results = adultResults.map(adult => {
        const fam = familyResults.find(f => f.shipName === adult.shipName && f.departureDate === adult.departureDate);
        return {
            ...adult,
            familyInsidePrice: fam?.insidePrice || 0,
            familyInsidePerDay: fam?.insidePerDay || 0,
            familyOceanviewPrice: fam?.oceanviewPrice || 0,
            familyOceanviewPerDay: fam?.oceanviewPerDay || 0,
            familyBalconyPrice: fam?.balconyPrice || 0,
            familyBalconyPerDay: fam?.balconyPerDay || 0,
            familySuitePrice: fam?.suitePrice || 0,
            familySuitePerDay: fam?.suitePerDay || 0,
        };
    });

    // Show sample
    for (const r of results.slice(0, 5)) {
        const parts = [];
        if (r.insidePerDay > 0) parts.push(`I:$${r.insidePerDay}`);
        if (r.oceanviewPerDay > 0) parts.push(`O:$${r.oceanviewPerDay}`);
        if (r.balconyPerDay > 0) parts.push(`V:$${r.balconyPerDay}`);
        if (r.suitePerDay > 0) parts.push(`S:$${r.suitePerDay}`);
        console.log(`    ${r.shipName.padEnd(22)} ${r.departureDate}  ${r.nights}N  ${parts.join('  ')}`);
    }
    if (results.length > 5) console.log(`    ... +${results.length - 5} more`);

    console.log(`\n  Total: ${results.length} Celebrity FL sailings`);

    // Save to JSON
    const outputFile = path.join(__dirname, 'celebrity-prices.json');
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`  Saved to ${outputFile}`);

    // Step 3: Upsert to database
    await upsertToDb(results, runStartedAt, runErrors);
}

// -- Database upsert --
async function upsertToDb(results, runStartedAt, runErrors) {
    console.log('\n  Connecting to SQL Server...');
    let pool;
    try {
        pool = await new sql.ConnectionPool(SQL_CONFIG).connect();
    } catch (err) {
        console.error(`  SQL connection failed: ${err.message}`);
        runErrors.push(`DB: ${err.message}`);
        return;
    }
    console.log('  Connected to CruiseTracker');

    let inserted = 0;
    const now = new Date();

    for (const r of results) {
        try {
            // 1. MERGE into Cruises table
            await pool.request()
                .input('line', sql.NVarChar, 'Celebrity')
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

            // 2. Always INSERT a new PriceHistory row
            await pool.request()
                .input('line', sql.NVarChar, 'Celebrity')
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
                .input('vbp', sql.Decimal(10, 2), r.balconyPrice > 0 ? r.balconyPrice : null)
                .input('vbpd', sql.Decimal(10, 2), r.balconyPerDay > 0 ? r.balconyPerDay : null)
                .input('vsp', sql.Decimal(10, 2), r.suitePrice > 0 ? r.suitePrice : null)
                .input('vspd', sql.Decimal(10, 2), r.suitePerDay > 0 ? r.suitePerDay : null)
                .input('vat', sql.DateTime2, now)

                // Family columns
                .input('fip', sql.Decimal(10, 2), r.familyInsidePrice || 0)
                .input('fipd', sql.Decimal(10, 2), r.familyInsidePerDay || 0)
                .input('fop', sql.Decimal(10, 2), r.familyOceanviewPrice || 0)
                .input('fopd', sql.Decimal(10, 2), r.familyOceanviewPerDay || 0)
                .input('fbp', sql.Decimal(10, 2), r.familyBalconyPrice || 0)
                .input('fbpd', sql.Decimal(10, 2), r.familyBalconyPerDay || 0)
                .input('fsp', sql.Decimal(10, 2), r.familySuitePrice || 0)
                .input('fspd', sql.Decimal(10, 2), r.familySuitePerDay || 0)
                .input('fvsp', sql.Decimal(10, 2), r.familySuitePrice > 0 ? r.familySuitePrice : null)
                .input('fvspd', sql.Decimal(10, 2), r.familySuitePerDay > 0 ? r.familySuitePerDay : null)
                .query(`
                    INSERT INTO PriceHistory
                        (CruiseLine, ShipName, DepartureDate,
                         InsidePrice, InsidePerDay, OceanviewPrice, OceanviewPerDay,
                         BalconyPrice, BalconyPerDay, SuitePrice, SuitePerDay,
                         VerifiedBalconyPrice, VerifiedBalconyPerDay,
                         VerifiedSuitePrice, VerifiedSuitePerDay,
                         FamilyInsidePrice, FamilyInsidePerDay, FamilyOceanviewPrice, FamilyOceanviewPerDay,
                         FamilyBalconyPrice, FamilyBalconyPerDay, FamilySuitePrice, FamilySuitePerDay,
                         FamilyVerifiedSuitePrice, FamilyVerifiedSuitePerDay,
                         VerifiedAt, ScrapedAt)
                    VALUES
                        (@line, @ship, @date,
                         @ip, @ipd, @op, @opd,
                         @bp, @bpd, @sp, @spd,
                         @vbp, @vbpd, @vsp, @vspd,
                         @fip, @fipd, @fop, @fopd,
                         @fbp, @fbpd, @fsp, @fspd,
                         @fvsp, @fvspd,
                         @vat, @sat)
                `);
            inserted++;
        } catch (err) {
            console.error(`  DB error for ${r.shipName} ${r.departureDate}: ${err.message}`);
        }
    }

    console.log(`  DB: ${inserted} price snapshots inserted`);

    await recordRunToDb(pool, results.length, inserted, runStartedAt, runErrors);
    await pool.close();
}

// -- Record Scraper Run --
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
            .input('name', sql.NVarChar, 'Celebrity')
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
        console.log('  Scraper run recorded');
    } catch (err) {
        console.error(`  Failed to record run: ${err.message}`);
    }
}

// -- Run --
main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
