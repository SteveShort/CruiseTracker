// ============================================================================
//  NCL Verified Price Scraper
//  Uses playwright-extra + stealth to bypass bot detection
//  Navigates NCL.com → opens "View Dates" flyouts → reads Balcony & Haven
//  prices per sailing date → saves to verified-prices.json
//
//  Usage:
//    node ncl-scraper.js                          # scrape all known ships
//    node ncl-scraper.js --ship "Norwegian Aqua"  # scrape one ship
//    node ncl-scraper.js --headed                  # show browser window
// ============================================================================

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const fs = require('fs');
const path = require('path');

// ── CLI Args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const shipArgIdx = args.indexOf('--ship');
const SHIP_FILTER = shipArgIdx >= 0 ? args[shipArgIdx + 1] : null;
const OUTPUT_FILE = path.join(__dirname, 'verified-prices.json');

// NCL ship codes
const NCL_SHIPS = [
    { name: 'Norwegian Aqua', code: 'AQUA' },
    { name: 'Norwegian Prima', code: 'PRIMA' },
    { name: 'Norwegian Viva', code: 'VIVA' },
    { name: 'Norwegian Encore', code: 'ENCORE' },
    { name: 'Norwegian Bliss', code: 'BLISS' },
    { name: 'Norwegian Escape', code: 'ESCAPE' },
    { name: 'Norwegian Breakaway', code: 'BREAKAWAY' },
    { name: 'Norwegian Getaway', code: 'GETAWAY' },
];

// Florida departure ports we care about
const FLORIDA_PORTS = ['miami', 'port canaveral', 'orlando', 'tampa', 'fort lauderdale', 'jacksonville', 'florida'];

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  NCL Verified Price Scraper (Florida ports)             ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    if (SHIP_FILTER) console.log(`  🔸 Filtering to: ${SHIP_FILTER}`);

    const shipsToScrape = SHIP_FILTER
        ? NCL_SHIPS.filter(s => s.name.toLowerCase().includes(SHIP_FILTER.toLowerCase()))
        : NCL_SHIPS;

    if (shipsToScrape.length === 0) {
        console.log(`  ❌ No matching ship for "${SHIP_FILTER}"`);
        return;
    }

    const browser = await chromium.launch({
        headless: !HEADED,
        channel: 'chrome',
    });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
    });

    const allResults = [];

    for (const ship of shipsToScrape) {
        console.log(`\n🚢 ${ship.name}`);
        try {
            const results = await scrapeShip(context, ship);
            allResults.push(...results);
            console.log(`   ✅ Collected ${results.length} FL sailings with prices`);
            if (results.length === 0) {
                console.warn(`   ⚠️ WARNING: 0 results for ${ship.name} — check if selectors broke!`);
            }
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
        }

        // Random delay between ships (30-90s) to look human
        if (shipsToScrape.indexOf(ship) < shipsToScrape.length - 1) {
            const delay = 30 + Math.random() * 60;
            console.log(`   ⏳ Waiting ${Math.round(delay)}s before next ship...`);
            await new Promise(r => setTimeout(r, delay * 1000));
        }
    }

    await browser.close();

    // Save results
    if (allResults.length > 0) {
        const output = {
            scrapedAt: new Date().toISOString(),
            count: allResults.length,
            results: allResults,
        };
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
        console.log(`\n  💾 Saved ${allResults.length} results to ${OUTPUT_FILE}`);
    }

    // Summary table
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Ship                  | Dep Date   | Nts | Balcony/pp | Haven/pp');
    console.log('  ─────────────────────────────────────────────────────────');
    for (const r of allResults) {
        const bal = r.balconyPP ? `$${r.balconyPP.toLocaleString()}` : 'N/A';
        const hav = r.havenPP ? `$${r.havenPP.toLocaleString()}` : 'N/A';
        console.log(`  ${r.shipName.padEnd(22)} | ${r.departureDate} | ${String(r.nights).padEnd(3)} | ${bal.padEnd(10)} | ${hav}`);
    }
    console.log(`\n  Total: ${allResults.length} sailings verified`);
    console.log('══════════════════════════════════════════════════════════\n');
}

// ── Scrape a single ship ───────────────────────────────────────────────
async function scrapeShip(context, ship) {
    const page = await context.newPage();
    const results = [];

    try {
        // Block Adobe Target & analytics scripts that create the marketing popup
        await page.route('**/*', route => {
            const url = route.request().url();
            if (url.includes('adobe') || url.includes('target') || url.includes('demdex')
                || url.includes('omtrdc') || url.includes('everesttech')
                || url.includes('doubleclick') || url.includes('googletag')
                || url.includes('facebook') || url.includes('tiktok')) {
                return route.abort();
            }
            return route.continue();
        });

        // Safety net: auto-remove any modal/dialog overlays via MutationObserver
        await page.addInitScript(() => {
            const observer = new MutationObserver(() => {
                // Remove any fixed overlays with high z-index
                document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="overlay"]').forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.position === 'fixed' && parseInt(style.zIndex) > 100) {
                        el.remove();
                        document.body.style.overflow = '';
                    }
                });
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });

        const url = `https://www.ncl.com/vacations?ships=${ship.code}`;
        console.log(`   🌐 ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(8000);

        // Dismiss cookie banner (separate from marketing modal)
        await dismissCookies(page);

        // Take debug screenshot
        await page.screenshot({ path: path.join(__dirname, `debug-${ship.code}.png`) });

        // Wait for View Dates buttons
        await page.waitForSelector('a[aria-label="View Dates"]', { timeout: 10000 }).catch(() => { });

        // Step 1: Read ALL itinerary card info in one pass
        const cards = await page.evaluate(() => {
            const viewDateLinks = document.querySelectorAll('a[aria-label="View Dates"]');
            const cardInfos = [];

            for (const link of viewDateLinks) {
                // Walk up to find the full card — go up until we find a substantial block
                let node = link;
                let text = '';
                for (let i = 0; i < 10 && node.parentElement; i++) {
                    node = node.parentElement;
                    text = node.textContent || '';
                    // Stop when we hit a block with the title pattern (X-Day)
                    if (/\d+-Day/.test(text)) break;
                }

                const nightsMatch = text.match(/(\d+)-Day/i);
                const title = text.match(/\d+-Day[^\n]*/)?.[0] || '';
                cardInfos.push({
                    fullText: text.substring(0, 500),
                    nights: nightsMatch ? parseInt(nightsMatch[1]) : 0,
                    title: title.substring(0, 100),
                });
            }
            return cardInfos;
        });

        console.log(`   📦 Found ${cards.length} itinerary cards`);

        // Step 2: Identify which cards are Florida departures
        const floridaIndices = [];
        for (let i = 0; i < cards.length; i++) {
            const textLower = cards[i].fullText.toLowerCase();
            const isFL = FLORIDA_PORTS.some(p => textLower.includes(p));
            if (isFL) {
                floridaIndices.push(i);
                console.log(`   🏖️ [${i}] FL: ${cards[i].title} (${cards[i].nights}N)`);
            } else {
                console.log(`   ⏭️ [${i}] Non-FL: ${cards[i].title} (${cards[i].nights}N)`);
            }
        }

        if (floridaIndices.length === 0) {
            console.log(`   ℹ️ No Florida departures found for ${ship.name}`);
            return results;
        }

        // Step 3: Click View Dates on each FL itinerary and extract prices
        for (const idx of floridaIndices) {
            console.log(`\n   📋 Processing FL itinerary [${idx}]: ${cards[idx].title}`);

            try {
                // Re-find buttons
                const buttons = await page.$$('a[aria-label="View Dates"]');
                if (idx >= buttons.length) { console.log('      ⚠️ Button not found'); continue; }

                // Click via JS to avoid overlay issues
                await buttons[idx].scrollIntoViewIfNeeded();
                await buttons[idx].evaluate(el => el.click());
                await page.waitForTimeout(4000);

                // Debug: screenshot after clicking View Dates
                await page.screenshot({ path: path.join(__dirname, `debug-flyout-${idx}.png`) });
                console.log(`      📸 debug-flyout-${idx}.png`);

                const nights = cards[idx].nights;

                // Log available stateroom type pills
                const pillNames = await page.evaluate(() => {
                    const pills = document.querySelectorAll('button');
                    const names = [];
                    for (const p of pills) {
                        const t = p.textContent.trim();
                        if (t.includes('From') && t.includes('$')) names.push(t.replace(/\s+/g, ' '));
                    }
                    return names;
                });
                console.log(`      🏷️ Pills: ${pillNames.join(' | ')}`);

                // ── BALCONY prices ──
                const balconyPrices = await readPricesForCategory(page, 'Balcony');
                console.log(`      💰 Balcony: ${balconyPrices.length} dates`);

                // ── HAVEN / SUITE prices ──
                // Haven may require scrolling the pill bar — try multiple selectors
                let havenPrices = await readPricesForCategory(page, 'The Haven');
                if (havenPrices.length === 0) {
                    havenPrices = await readPricesForCategory(page, 'Haven');
                }
                if (havenPrices.length === 0) {
                    havenPrices = await readPricesForCategory(page, 'Suite');
                }
                console.log(`      💰 Haven: ${havenPrices.length} dates`);

                // Merge by departure date
                const merged = {};
                for (const p of balconyPrices) {
                    merged[p.departureDate] = {
                        shipName: ship.name, departureDate: p.departureDate,
                        nights, itinerary: cards[idx].title,
                        balconyPP: p.price, balconyTotal: p.price * 2,
                        balconyPPD: nights > 0 ? Math.round(p.price * 2 / nights) : null,
                    };
                }
                for (const p of havenPrices) {
                    if (!merged[p.departureDate]) {
                        merged[p.departureDate] = {
                            shipName: ship.name, departureDate: p.departureDate,
                            nights, itinerary: cards[idx].title,
                        };
                    }
                    merged[p.departureDate].havenPP = p.price;
                    merged[p.departureDate].havenTotal = p.price * 2;
                    merged[p.departureDate].havenPPD = nights > 0 ? Math.round(p.price * 2 / nights) : null;
                }

                results.push(...Object.values(merged));

                // Close flyout via JS
                await page.evaluate(() => {
                    const btn = document.querySelector('button[aria-label="Close"]')
                        || document.querySelector('[class*="close-btn"]');
                    if (btn) btn.click();
                });
                await page.waitForTimeout(1000);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);

            } catch (err) {
                console.log(`      ⚠️ Error: ${err.message.substring(0, 80)}`);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
            }
        }

    } catch (err) {
        console.error(`   ❌ Ship error: ${err.message}`);
    } finally {
        await page.close();
    }

    return results;
}

// ── Dismiss OneTrust cookie banner ─────────────────────────────────────
async function dismissCookies(page) {
    try {
        const btn = await page.$('#onetrust-accept-btn-handler');
        if (btn && await btn.isVisible()) {
            await btn.click();
            await page.waitForTimeout(500);
            console.log(`   🍪 Dismissed cookies`);
        }
    } catch (_) { }
}

// ── Close the "Get Cruise Offers" marketing modal ──────────────────────
async function closeMarketingModal(page) {
    // Targeted removal — only remove the specific marketing modal, not cards
    await page.evaluate(() => {
        // Find the "Get Cruise Offers" text and remove its ancestor modal
        const allH2 = document.querySelectorAll('h2, h3, p, div');
        for (const el of allH2) {
            if (el.textContent.trim() === 'Get Cruise Offers') {
                // Found the modal content — walk up to find the outermost overlay
                let modal = el;
                for (let i = 0; i < 10 && modal.parentElement; i++) {
                    modal = modal.parentElement;
                    const style = window.getComputedStyle(modal);
                    if (style.position === 'fixed' || style.position === 'absolute') {
                        modal.remove();
                        return;
                    }
                }
                // If no fixed parent, remove the closest container
                el.closest('[role="dialog"]')?.remove();
                return;
            }
        }

        // Also try: remove any role=dialog elements
        document.querySelectorAll('[role="dialog"]').forEach(el => el.remove());

        // Reset body scroll
        document.body.style.overflow = '';
    });
}

// ── Click a stateroom category pill and read the flyout sail date prices ──
async function readPricesForCategory(page, categoryName) {
    // Click the pill — search buttons, anchors, and divs since NCL uses various elements
    const found = await page.evaluate((name) => {
        // Search broader set of elements
        const els = document.querySelectorAll('button, a, div, span, [role="tab"], [role="button"]');
        for (const el of els) {
            const text = el.textContent.trim();
            if (name === 'Balcony') {
                if (text.includes('Balcony') && !text.includes('Club') && text.includes('From')) {
                    el.click();
                    return text.replace(/\s+/g, ' ').substring(0, 50);
                }
            } else if (text.includes(name) && text.includes('From')) {
                el.click();
                return text.replace(/\s+/g, ' ').substring(0, 50);
            }
        }
        return null;
    }, categoryName);

    if (!found) {
        console.log(`      ⚠️ No "${categoryName}" pill found`);
        return [];
    }
    console.log(`      🔘 Clicked: "${found}"`);

    await page.waitForTimeout(2000);

    // Read prices from the page — the flyout date rows update when a pill is clicked
    const allSailings = await page.evaluate(() => {
        const results = [];
        const allEls = document.body.querySelectorAll('*');

        for (const el of allEls) {
            if (el.children.length > 5) continue;
            const text = el.textContent || '';

            // Match: "Mon DD - Mon DD, YYYY"
            const dateMatch = text.match(/(\w{3}\s+\d{1,2})\s*[-–]\s*(\w{3}\s+\d{1,2}),?\s*(\d{4})/);
            if (!dateMatch) continue;

            const priceMatch = text.match(/\$(\d{1,3}(?:,\d{3})*)/);
            const soldOut = /sold\s*out/i.test(text);

            if (dateMatch && (priceMatch || soldOut)) {
                results.push({
                    depText: dateMatch[1].trim(),
                    year: dateMatch[3],
                    price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
                    soldOut: soldOut && !priceMatch,
                });
            }
        }
        return results;
    });

    const prices = [];
    for (const s of allSailings) {
        if (s.soldOut || !s.price) continue;
        const depDate = parseNCLDate(s.depText, s.year);
        if (depDate) prices.push({ departureDate: depDate, price: s.price });
    }

    // Deduplicate — take lowest price per date
    const deduped = {};
    for (const p of prices) {
        if (!deduped[p.departureDate] || p.price < deduped[p.departureDate].price) {
            deduped[p.departureDate] = p;
        }
    }
    return Object.values(deduped);
}

// ── Parse "Mar 22" + year → "2026-03-22" ───────────────────────────────
function parseNCLDate(text, year) {
    const months = {
        Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
        Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    const m = text.match(/(\w{3})\s+(\d{1,2})/);
    if (!m || !months[m[1]]) return null;
    return `${year}-${months[m[1]]}-${m[2].padStart(2, '0')}`;
}

// ── Run ────────────────────────────────────────────────────────────────
main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
