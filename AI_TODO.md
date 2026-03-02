# AI Task Board

This file tracks technical debt, minor feature ideas, and architectural improvements. When you start an AI session, you can simply instruct the AI to "complete the top task in AI_TODO.md" for quick, context-isolated pair programming.

## Value Algorithm Optimization (Audit March 2026)

Issues discovered via independent audit ([walkthrough](file:///C:/Users/sshor/.gemini/antigravity/brain/a7ca69b1-f47f-42ee-82a1-ab07d8e9ec60/walkthrough.md)). Ordered by impact. Re-run audit simulation after each fix to compare before/after.

- [x] **1. Percentile-Based Price Scoring** — Replace the fixed PPD cap normalization (`100 * (1 - ppd/cap)`) with percentile ranking within the filtered set. A $220 cruise in a pool where 90% are $300+ should score ~90, not 45. *Fixes: score compression, dead upper star range, budget scenario showing 85% at 1★.*
- [x] **2. Relative Star Brackets** — Map star ratings relative to the min/max scores of each computed set instead of using absolute thresholds (95→5★, 88→4.5★, etc.). Every scenario should naturally produce a 1–5★ distribution. *Fixes: max achievable being 3.5★ in balanced mode, useless star range.*
- [x] **3. Strengthen Line Bonus System** — Move the per-line bonus from `priceScore` (where it gets diluted to ~25% effect) to a direct addition on the final `valueScore`. A +20 Disney bonus should meaningfully boost Disney cruises, not get drowned out. *Fixes: Disney Devotee scenario showing zero Disney cruises in top 15.*
- [x] **4. ~~Fix Total Cost Normalization~~** — Investigated: `balconyPrice` is consistently per-person across all lines (ratio=1.0). Percentile-based scoring (fix #1) further makes this self-correcting. **Non-issue — resolved.**
- [x] **5. Per-Line Quality Score Normalization** — Applied diminishing returns curve on quality scores above 80, compressing the 80-100 range so a 98 vs 88 gap becomes ~5 effective points instead of 10. *Fixes: Aqua reduced from 5/8 to 3/8 scenario appearances.*
- [x] **6. Steeper Short-Cruise Sweet Spot Penalty** — The 0.85 multiplier for ≤3 nights doesn't offset the total-cost advantage. Either increase to 0.75 for ≤3n, or exclude `totalCostFactor` for cruises under 5 nights. *Fixes: 3-4n cruises over-rewarded by low absolute totals.*
- [x] **7. Departure Proximity Bonus (New Feature)** — Added ≤3 weeks: +8%, ≤6 weeks: +5% multiplier. Surfaces genuine last-minute deals. Capped at 100.

**After all fixes:** Re-run `C:\temp\value_audit_simulation.js` and compare against the baseline results in the audit walkthrough.

---

## Backlog

- [ ] **Extract Ship Data**: Move the `ShipInfo` dictionary from `Program.cs` into `Data/ShipReferenceData.cs` to reduce the Program.cs file size.
- [ ] **Create API Endpoint Extension Methods**: Refactor Minimal API endpoints out of `Program.cs` into separate files (e.g., `Endpoints/DashboardEndpoints.cs`, `Endpoints/CalendarEndpoints.cs`).
- [ ] **Automated Schema Generation**: Update the `.agent/workflows/deploy.md` workflow (and deploy scripts) to generate a `SCHEMA.md` file on deployment, providing the AI with up-to-date database context.
- [x] **Frontend Modularization**: Extract `app.js` into dedicated ES6 modules (`state.js`, `scoring.js`, UI modules) and wire up to `main.js`.
- [x] **Pure Logic Unit Tests**: Create a basic Node.js test file for the `computeValueStars` logic (now extracted in `scoring.js`) to ensure mathematical stability when tuning algorithms.
- [ ] **Extract Dapper Queries**: Move inline SQL queries from `Program.cs` into a `Repositories/CruiseRepository.cs` class.
- [ ] **SQL Backup Solution**: Set up automated nightly backups of the CruiseTracker database (Restaurants, PriceHistory, Cruises, ScraperRuns) so we don't lose data that isn't tracked in git.
- [ ] **Family Pricing**: Investigate how to add pricing for 2 adults and 2 children properly in the family mode, while keeping 2 people in Adult mode.
- [x] **Investigate New Cruise Lines**: Investigated Virgin Voyages, Holland America, Silversea, Seabourn, Cunard. Recommended Silversea, Virgin Voyages, Seabourn. See [investigation report](file:///C:/Users/sshor/.gemini/antigravity/brain/a7ca69b1-f47f-42ee-82a1-ab07d8e9ec60/cruise_line_investigation.md).

---

## New Cruise Line Scrapers

Each task: build scraper + add ship data to `Program.cs`, test live run, deploy, commit.

- [ ] **Silversea Scraper** — Algolia API (`ogg7av1jsp-dsn.algolia.net`), no browser needed. Direct REST POST returns all voyages with pricing in clean JSON. All-suite line → map fare to `SuitePrice`. CruiseLine = `"Silversea"`. Ships: Silver Dawn, Moon, Muse, Nova, Ray, Shadow, Spirit, Whisper, Wind, Endeavour. Follow `oceania-scraper.js` pattern.
- [ ] **Virgin Voyages Scraper** — GraphQL API (`prod.virginvoyages.com/graphql`), needs Playwright for DataDome bypass. Next.js `__NEXT_DATA__` has ~370 sailings pre-hydrated. Map: Insider→Inside, Sea View→OV, Sea Terrace→Balcony, Rockstar→Suite. CruiseLine = `"Virgin Voyages"`. Ships: Scarlet Lady, Valiant Lady, Resilient Lady, Brilliant Lady. Adults-only line (category `"adult"`).
- [ ] **Seabourn Scraper** — REST API at `/search/sbncruisesearch` + POST `/api/pricing/v1/cruises`. Needs Playwright for Akamai cookie. Carnival Corp infrastructure. All-suite → map fare to `SuitePrice`. CruiseLine = `"Seabourn"`. Ships: Odyssey, Sojourn, Quest, Ovation, Venture, Pursuit. Follow `oceania-scraper.js` pattern.

---

## Restaurant Scoring (New Lines)

Add restaurant ratings using the same dining preference criteria as existing ships. Insert via SQL, deploy to reload cache.

- [ ] **Silversea Restaurant Data** — ~10 ships. La Dame (Relais & Châteaux), Kaiseki, La Terrazza, S.A.L.T. Kitchen. All dining included.
- [ ] **Virgin Voyages Restaurant Data** — 4 ships. 20+ restaurants all included, no buffet. Test Kitchen, Razzle Dazzle, Gunbae, The Wake, Extra Virgin.
- [ ] **Seabourn Restaurant Data** — 6 ships. The Grill by Thomas Keller, The Restaurant, Earth & Ocean. All dining included.
