// ============================================================================
//  Virgin Voyages Price Scraper
//  Uses Playwright to bypass DataDome, then extracts voyage data from the
//  client-rendered search page.
//
//  Strategy: Navigate to find-a-voyage, wait for data to render, then
//  extract structured voyage data from the DOM/analytics layer.
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
const DELAY_MS = 2000;

// Ship code mapping (from voyageId prefix)
const SHIP_CODES = {
    SC: 'Scarlet Lady',
    VL: 'Valiant Lady',
    RS: 'Resilient Lady',
    BL: 'Brilliant Lady',
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

// ── Step 1: Fetch all voyages via Playwright ───────────────────────────
async function fetchAllVoyages() {
    console.log(`\n🚢 Launching browser for Virgin Voyages...`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();
    const voyageData = [];

    // Intercept API responses that contain voyage/pricing data
    page.on('response', async (response) => {
        const url = response.url();
        try {
            if (url.includes('/graphql') && response.status() === 200) {
                const json = await response.json();
                // Look for voyage search results in GraphQL responses
                if (json?.data?.voyages || json?.data?.searchVoyages) {
                    const voyages = json.data.voyages || json.data.searchVoyages;
                    if (Array.isArray(voyages)) {
                        voyageData.push(...voyages);
                        console.log(`  📡 Intercepted ${voyages.length} voyages from GraphQL`);
                    }
                }
            }
            // Also look for the /api/ pricing/search endpoints
            if (url.includes('/book/api/') && response.status() === 200) {
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('json')) {
                    const json = await response.json();
                    if (json?.voyages || json?.data?.voyages || json?.packages) {
                        const items = json.voyages || json.data?.voyages || json.packages || [];
                        if (Array.isArray(items) && items.length > 0) {
                            voyageData.push(...items);
                            console.log(`  📡 Intercepted ${items.length} items from ${new URL(url).pathname}`);
                        }
                    }
                }
            }
        } catch { /* Ignore non-JSON responses */ }
    });

    console.log(`  🌐 Navigating to ${SEARCH_URL}`);
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle', timeout: 60000 });
    console.log(`  ✅ Page loaded`);

    // Wait for results to render
    await sleep(5000);

    // Try to extract data directly from the page's rendered DOM
    const domVoyages = await page.evaluate(() => {
        // Strategy 1: Look for __NEXT_DATA__ (may have loaded after hydration)
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
            try {
                const data = JSON.parse(nextDataEl.textContent);
                // Navigate the Next.js data structure to find voyage data
                const pageProps = data?.props?.pageProps;
                if (pageProps?.voyages) return { source: '__NEXT_DATA__', data: pageProps.voyages };
                if (pageProps?.initialData?.voyages) return { source: '__NEXT_DATA__', data: pageProps.initialData.voyages };
            } catch { }
        }

        // Strategy 2: Extract from rendered voyage cards in the DOM
        const cards = document.querySelectorAll('[data-testid*="voyage"], [class*="VoyageCard"], [class*="voyage-card"], [class*="itinerary-card"]');
        if (cards.length > 0) {
            const results = [];
            cards.forEach(card => {
                const text = card.textContent || '';
                const link = card.querySelector('a[href*="voyage"], a[href*="packageCode"]');
                results.push({
                    text: text.substring(0, 500),
                    href: link?.href || null,
                });
            });
            return { source: 'dom_cards', data: results };
        }

        // Strategy 3: Look for React fiber / state data
        const appEl = document.getElementById('__next');
        if (appEl?._reactRootContainer) {
            return { source: 'react_root', data: 'found_react_root' };
        }

        // Strategy 4: Collect all links with voyage/package codes
        const voyageLinks = Array.from(document.querySelectorAll('a[href*="packageCode"], a[href*="voyageId"]'));
        if (voyageLinks.length > 0) {
            return {
                source: 'links',
                data: voyageLinks.map(a => ({
                    href: a.href,
                    text: a.textContent?.trim()?.substring(0, 200),
                }))
            };
        }

        return { source: 'none', data: null };
    });

    console.log(`  📊 DOM extraction source: ${domVoyages.source}`);

    // If we got data from DOM/interceptors, great. Otherwise try scrolling to load more.
    if (voyageData.length === 0 && domVoyages.source === 'none') {
        console.log(`  🔄 No data yet — scrolling to trigger lazy loading...`);
        for (let i = 0; i < 20; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await sleep(1000);
        }
        await sleep(3000);
    }

    // Final attempt: extract all pricing/voyage data from the page's inner state
    const extractedVoyages = await page.evaluate(() => {
        // Find all elements that look like price containers
        const allText = document.body.innerText;
        // Look for structured voyage data in any script tags
        const scripts = Array.from(document.querySelectorAll('script'));
        const dataScripts = [];
        for (const s of scripts) {
            const text = s.textContent || '';
            if (text.includes('voyageId') || text.includes('packageCode') || text.includes('startingPrice')) {
                // Extract JSON-like objects
                const matches = text.match(/\{[^{}]*"voyageId"[^{}]*\}/g);
                if (matches) dataScripts.push(...matches);
            }
        }
        return { scriptData: dataScripts.slice(0, 50), bodyLength: allText.length };
    });

    console.log(`  📋 Found ${extractedVoyages.scriptData.length} voyage objects in scripts`);

    // Combine all data sources
    let allVoyages = [...voyageData];

    // Parse DOM card data if we need it
    if (domVoyages.source === 'links' && Array.isArray(domVoyages.data)) {
        for (const link of domVoyages.data) {
            if (link.href) {
                const urlObj = new URL(link.href);
                const packageCode = urlObj.searchParams.get('packageCode');
                const voyageId = urlObj.searchParams.get('voyageId') || urlObj.searchParams.get('voyageIds');
                if (packageCode || voyageId) {
                    allVoyages.push({ packageCode, voyageId, _source: 'link', _text: link.text });
                }
            }
        }
    }

    // Parse script-embedded data
    for (const jsonStr of extractedVoyages.scriptData) {
        try {
            const obj = JSON.parse(jsonStr);
            if (obj.voyageId) allVoyages.push(obj);
        } catch { }
    }

    // If still no data, try the GraphQL API directly with the browser's cookies
    if (allVoyages.length < 10) {
        console.log(`  🔄 Trying direct GraphQL query with browser session...`);
        const graphqlResult = await page.evaluate(async () => {
            try {
                const resp = await fetch('https://prod.virginvoyages.com/graphql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: `query SearchVoyages {
                            searchVoyages(input: { currencyCode: "USD" }) {
                                id voyageId packageCode shipCode
                                startDate endDate nights
                                departurePort { code name }
                                arrivalPort { code name }
                                title
                                cabins { type name startingPrice }
                            }
                        }`
                    }),
                });
                return await resp.json();
            } catch (e) { return { error: e.message }; }
        });

        if (graphqlResult?.data?.searchVoyages) {
            allVoyages.push(...graphqlResult.data.searchVoyages);
            console.log(`  📡 GraphQL direct query returned ${graphqlResult.data.searchVoyages.length} voyages`);
        } else {
            console.log(`  ⚠️ GraphQL direct query: ${JSON.stringify(graphqlResult?.errors || graphqlResult?.error || 'no data').substring(0, 200)}`);
        }
    }

    // If STILL limited data, try fetching individual ship pages which show all dates
    if (allVoyages.length < 50) {
        console.log(`  🔄 Trying per-ship voyage extraction...`);
        for (const [code, name] of Object.entries(SHIP_CODES)) {
            const shipUrl = `https://www.virginvoyages.com/book/voyage-planner/find-a-voyage?ship=${encodeURIComponent(name)}&currencyCode=USD`;
            console.log(`  🚢 Loading ${name}...`);
            await page.goto(shipUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await sleep(3000);

            // Extract voyage links from this filtered view
            const shipVoyages = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href*="packageCode"], a[href*="voyageId"]'));
                return links.map(a => ({
                    href: a.href,
                    text: a.textContent?.trim()?.substring(0, 300),
                }));
            });

            for (const link of shipVoyages) {
                try {
                    const urlObj = new URL(link.href);
                    const packageCode = urlObj.searchParams.get('packageCode');
                    const voyageId = urlObj.searchParams.get('voyageId') || urlObj.searchParams.get('voyageIds');
                    if (voyageId) {
                        allVoyages.push({
                            voyageId, packageCode, shipCode: code, shipName: name,
                            _source: 'ship_page', _text: link.text
                        });
                    }
                } catch { }
            }
            console.log(`    📋 ${name}: ${shipVoyages.length} voyage links found`);
        }
    }

    await browser.close();
    console.log(`  ✅ Browser closed. Total raw voyage data: ${allVoyages.length}`);

    // Save raw data for debugging
    const rawPath = path.join(__dirname, 'virgin-raw.json');
    fs.writeFileSync(rawPath, JSON.stringify(allVoyages, null, 2));
    console.log(`  💾 Raw data saved to ${rawPath}`);

    return allVoyages;
}

// ── Step 2: Parse voyages into normalized records ──────────────────────
function parseVoyages(rawVoyages) {
    const results = [];
    const seen = new Set();  // Deduplicate by voyageId

    for (const v of rawVoyages) {
        const voyageId = v.voyageId || v.id || null;
        if (!voyageId || seen.has(voyageId)) continue;
        seen.add(voyageId);

        // Determine ship name
        let shipName = v.shipName || v.ship?.name || null;
        if (!shipName && voyageId) {
            const prefix = voyageId.substring(0, 2);
            shipName = SHIP_CODES[prefix] || null;
        }
        if (!shipName && v.shipCode) {
            shipName = SHIP_CODES[v.shipCode] || `Virgin ${v.shipCode}`;
        }
        if (!shipName) continue;

        // Apply ship filter
        if (shipFilter && !shipName.toLowerCase().includes(shipFilter.toLowerCase())) continue;

        // Parse departure date
        let departureDate = v.startDate || v.start_date || v.departureDate || null;
        if (!departureDate && voyageId) {
            // Try to extract from voyageId format like "SC2612034NKW" → 2026-12-03
            const match = voyageId.match(/^[A-Z]{2}(\d{2})(\d{2})(\d{2})/);
            if (match) {
                departureDate = `20${match[1]}-${match[2]}-${match[3]}`;
            }
        }
        if (!departureDate) continue;
        departureDate = departureDate.slice(0, 10);

        const nights = v.nights || v.duration || 0;
        const packageCode = v.packageCode || v.package_code || null;

        // Parse pricing
        let insidePrice = null, oceanviewPrice = null, balconyPrice = null, suitePrice = null;

        // From structured cabin data
        if (v.cabins && Array.isArray(v.cabins)) {
            for (const c of v.cabins) {
                const type = (c.type || c.name || '').toLowerCase();
                const price = c.startingPrice || c.price || 0;
                if (type.includes('insider') || type.includes('inside')) insidePrice = price;
                else if (type.includes('sea view') || type.includes('oceanview')) oceanviewPrice = price;
                else if (type.includes('terrace') || type.includes('balcony')) balconyPrice = price;
                else if (type.includes('rockstar') || type.includes('suite') || type.includes('mega')) suitePrice = price;
            }
        }

        // From flat price field (fallback)
        if (!balconyPrice && !suitePrice) {
            const price = v.price || v.startingPrice || v.starting_price || 0;
            if (price > 0) balconyPrice = price;  // Default "from" price is typically Sea Terrace
        }

        // Parse ports
        const embarkPort = v.departurePort?.name || v.departurePort?.code || v.embarkPort || '';
        const debarkPort = v.arrivalPort?.name || v.arrivalPort?.code || v.debarkPort || embarkPort;

        // Parse itinerary
        const itinerary = v.title || v.name || v.itinerary || v.category || `${embarkPort} to ${debarkPort}`;

        // Extract text-based price if from link extraction
        if (v._text && !balconyPrice && !suitePrice) {
            const priceMatch = v._text.match(/\$[\d,]+/);
            if (priceMatch) {
                balconyPrice = parseFloat(priceMatch[0].replace(/[$,]/g, ''));
            }
        }

        results.push({
            shipName,
            departureDate,
            nights,
            itinerary,
            itineraryCode: voyageId,
            packageCode,
            embarkPort,
            debarkPort,
            insidePrice,
            oceanviewPrice,
            balconyPrice,
            suitePrice,   // Rockstar Quarters!
        });
    }

    return results;
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

    try {
        const rawVoyages = await fetchAllVoyages();
        const results = parseVoyages(rawVoyages);
        console.log(`\n  📋 Parsed ${results.length} unique sailings`);

        if (results.length === 0) {
            console.warn('  ⚠️ No valid sailings found. Exiting.');
            return;
        }

        // Save parsed JSON
        const jsonPath = path.join(__dirname, 'virgin-latest.json');
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
        console.log(`  💾 Saved to ${jsonPath}`);

        await upsertToDatabase(results, runStartedAt, runErrors);

    } catch (err) {
        console.error(`\n  ❌ Fatal: ${err.message}`);
        runErrors.push(err.message);
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
        const primaryPrice = sp || bp || ovp || ip || 0;
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

            // 2. INSERT price history row with ALL cabin tiers
            if (primaryPrice > 0) {
                const req = pool.request()
                    .input('line', sql.NVarChar, 'Virgin Voyages')
                    .input('ship', sql.NVarChar, r.shipName)
                    .input('date', sql.Date, r.departureDate)
                    .input('sat', sql.DateTime2, now);

                // Add available price tiers
                if (bp) { req.input('bp', sql.Decimal(10, 2), bp); req.input('bpd', sql.Decimal(10, 2), r.nights > 0 ? Math.round(bp / r.nights * 100) / 100 : 0); }
                if (sp) { req.input('sp', sql.Decimal(10, 2), sp); req.input('spd', sql.Decimal(10, 2), r.nights > 0 ? Math.round(sp / r.nights * 100) / 100 : 0); }
                if (ip) { req.input('ip', sql.Decimal(10, 2), ip); }
                if (ovp) { req.input('ovp', sql.Decimal(10, 2), ovp); }

                // Build dynamic INSERT
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
