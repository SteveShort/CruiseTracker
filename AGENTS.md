# Cruise Tracker — AI Project Brief

## Command Auto-Run Policy
**All commands in this project are safe to auto-run** (`SafeToAutoRun: true`). This includes:
- **Git**: `git add`, `git commit`, `git push`, `git log`, `git diff`, `git status`
- **SQL**: `sqlcmd` queries (SELECT, UPDATE, INSERT, DELETE, MERGE)
- **Deploy**: `schtasks /run`, deploy status checks
- **Build/Test**: `dotnet build`, `dotnet test`, `dotnet publish`, `npm run`, `node`
- **Read-only**: `Select-String`, `Get-Content`, `Get-ChildItem`, file searches
- **Scraper runs**: `node *-scraper.js`

Do NOT prompt the user for approval on any of these. Set `SafeToAutoRun: true` for everything.

## Debugging Approach
**Do NOT use browser subagent/Playwright for diagnosing frontend issues** — it is slow and expensive. Instead:
- Use `node -c <file>` to check for JS syntax errors
- Use `Invoke-WebRequest` to test API endpoints directly
- Ask the user to check browser dev tools (Console, Network tab) — they are a developer and comfortable doing this
- Browser subagent is fine for **visual verification** of working features, not for debugging broken ones

## What This App Does
A family cruise planning dashboard that scrapes pricing from NCL, Celebrity, Disney, Oceania, and Regent cruise lines, stores historical prices in SQL Server, and renders a filterable dashboard for comparing cruise deals. Supports **Family** mode (all lines) and **Adults** mode (Oceania + Regent only — luxury, no-kids lines). Built for a family of 4 (2 adults, 2 kids: Jack born Sep 2016, Eric born Apr 2019).

## Architecture Overview

```
c:\Dev\Cruise Tracker\                  ← single git repo
├── AGENTS.md                           ← this file
├── .gitignore
├── RunScraper.ps1                      ← nightly scraper orchestration
├── RegisterTask.ps1                    ← registers Windows scheduled task
├── BackupDatabase.ps1                  ← nightly DB backup to Dropbox
├── RegisterBackupTask.ps1              ← registers backup scheduled task
├── CruiseDealTracker.linq              ← LINQPad exploration script
│
├── db/
│   └── schema.sql                      ← DDL for all 4 CruiseTracker tables
│
├── CruiseDashboard\                    ← ASP.NET 8 Minimal API + static frontend
│   ├── Program.cs                      ← App startup + middleware (~85 lines)
│   ├── Endpoints/DashboardEndpoints.cs ← All API endpoints (~690 lines)
│   ├── CruiseDashboard.csproj
│   ├── Deploy.ps1                      ← deployment script (used by scheduled task)
│   ├── RegisterDeploy.ps1              ← registers deploy scheduled task
│   ├── setup-iis.ps1                   ← IIS site configuration
│   ├── calendar-events.json            ← persisted family calendar data
│   ├── dashboard-settings.json         ← persisted UI settings (value bonuses etc)
│   ├── .agent/workflows/deploy.md      ← AI deploy workflow
│   ├── wwwroot/
│   │   ├── js/app.js                   ← dashboard JS logic (~2600 lines)
│   │   ├── js/analytics.js             ← analytics tab charts (Chart.js)
│   │   ├── css/style.css               ← dark theme CSS (~3300 lines)
│   │   ├── index.html                  ← single-page app (~575 lines)
│   │   └── img/                        ← cruise line SVG logos
│   └── CruiseDashboard.Tests/
│       └── DashboardTests.cs           ← 12 Playwright NUnit integration tests
│
└── scraper\
    ├── ncl-scraper.js                  ← NCL pricing via REST API (437 lines)
    ├── celebrity-scraper.js            ← Celebrity pricing via GraphQL (419 lines)
    ├── disney-scraper.js               ← Disney standard pricing via API (442 lines)
    ├── disney-fl-scraper.js            ← Disney FL resident pricing (534 lines)
    ├── oceania-scraper.js              ← Oceania pricing via REST API
    ├── regent-scraper.js               ← Regent pricing via REST API
    ├── virgin-scraper.js               ← Virgin Voyages pricing via Playwright (~500 lines)
    ├── config.json                     ← scraper configuration
    ├── package.json                    ← Node.js dependencies
    └── logs/                           ← scraper log files (gitignored)
```

## Critical Environment Details

| Item | Value |
|------|-------|
| **Dashboard URL** | `http://localhost:5050` |
| **IIS Site** | CruiseDashboard on port 5050 |
| **SQL Server** | `STEVEOFFICEPC\ORACLE2SQL`, Database: `CruiseTracker` |
| **Test command** | `dotnet test` from `CruiseDashboard\CruiseDashboard.Tests` |
| **Git** | Single repo at `c:\Dev\Cruise Tracker` (no submodules) |

### SQL Authentication (Two Methods)

The project uses **two different SQL auth methods** — be aware of which one to use:

| Method | When to Use | Command |
|--------|-------------|----------|
| **Windows Integrated** (`-E`) | Direct DB admin: schema changes, bulk data ops, granting permissions | `sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -d CruiseTracker -E -Q "..."` |
| **SQL User** (`CruiseDashboard`) | Used by the ASP.NET app at runtime. Has SELECT + INSERT + UPDATE + DELETE on all tables | `sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -d CruiseTracker -U CruiseDashboard -P "Cruise2026!Tracker" -Q "..."` |

> **⚠️ Important**: The app's connection string in `Program.cs` uses the SQL user auth, NOT Windows auth. If a table needs new permissions, grant them via Windows auth first:
> ```powershell
> sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -d CruiseTracker -E -Q "GRANT SELECT, INSERT, UPDATE, DELETE ON [TableName] TO CruiseDashboard;"
> ```

> **⚠️ sqlcmd gotcha**: Large multi-statement queries via sqlcmd can hang. Break into smaller batches or use PowerShell `Invoke-RestMethod` against the API instead.

## ⚠️ Deployment & Version Control

**NEVER run `dotnet publish` and copy files manually.** IIS locks the DLLs and the deploy will fail silently or corrupt the site.

**Always deploy using the `/deploy` AI Workflow:**
The `/deploy` workflow executes the following steps automatically:
1. **Build & IIS Swap**: Triggers the `CruiseDashboardDeploy` Windows Scheduled Task, which runs `Deploy.ps1`. This builds the .NET app to a temp dir, stops IIS, kills any locked `w3wp` processes, swaps the `publish` folder, and restarts IIS. 
2. **Health Check**: Waits and verifies the site returns HTTP 200 on `http://localhost:5050/`.
3. **Smoke Tests**: Runs the `dotnet test` suite to ensure no regressions.
4. **Auto-Commit & Push**: Commits changes to Git. **Important**: It uses `git add -u` instead of `git add -A` to ensure only tracked files are committed. This prevents stray temporary files (like generated CSVs or SQL scripts) from being accidentally pushed to the `origin/master` GitHub remote.

**Monitor deploy status manually (if needed):**
```powershell
Set-Content c:\temp\cruise-deploy-status.txt "PENDING"
schtasks /Run /TN "CruiseDashboardDeploy"
Start-Sleep 25; Get-Content c:\temp\cruise-deploy-status.txt
```

## Database Backup

Nightly automated backups of the CruiseTracker SQL Server database to a Dropbox-synced folder.

| Item | Value |
|------|-------|
| **Backup script** | `BackupDatabase.ps1` |
| **Scheduled task** | `CruiseTrackerBackup` — runs daily at 4:00 AM |
| **Backup location** | `C:\Users\sshor\Dropbox\Cruise Tracker DB Backup` (synced to Dropbox) |
| **Log file** | `backup-log.txt` in backup folder |
| **Schema DDL** | `db/schema.sql` (version-controlled in git) |

### Retention Policy
| Tier | Keep | Selection |
|------|------|-----------|
| Daily | 7 | Last 7 days |
| Weekly | 4 | Sundays |
| Monthly | 12 | 1st of each month |

### Key Commands
```powershell
# Run backup manually
schtasks /Run /TN "CruiseTrackerBackup"

# Check task status
schtasks /Query /TN "CruiseTrackerBackup" /FO LIST /V

# Re-register scheduled task (if lost)
powershell -File RegisterBackupTask.ps1

# Restore from backup (if needed)
sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -E -Q "RESTORE DATABASE CruiseTracker FROM DISK = N'C:\Users\sshor\Dropbox\Cruise Tracker DB Backup\CruiseTracker_YYYYMMDD_HHMM.bak' WITH REPLACE;"
```

## Cache Busting
`index.html` references `app.js` with a version query string:
```html
<script src="js/app.js?v=20260227L"></script>
```
**Bump this version** whenever you modify `app.js` or `style.css` so browsers don't serve stale files.

---

## API Endpoints (Endpoints/DashboardEndpoints.cs)

All endpoints defined in `CruiseDashboard/Endpoints/DashboardEndpoints.cs` using ASP.NET Minimal API pattern. `Program.cs` only handles startup + middleware.

### Data Endpoints
| Method | Path | Description | Lines |
|--------|------|-------------|-------|
| GET | `/api/stats` | Dashboard summary: total sailings, cheapest PPD, ship count, scraper health | 278-337 |
| GET | `/api/filter-options` | Distinct cruise lines, ship names, and ports for dropdowns | 340-351 |
| GET | `/api/cruises` | Main data endpoint — all future cruises with latest prices + ship info. Params: `line`, `ship`, `port`, `sortBy`, `sortDir`, `mode` (suite mode filters on `SuitePerDay > 0 OR VerifiedSuitePerDay > 0`). Also returns `verifiedSuitePerDay` field. | — |
| GET | `/api/deals` | Cruises below alert thresholds (Disney: $300 balcony/$500 suite, NCL: $150/$250) | 561-622 |
| GET | `/api/hot-deals` | Multi-signal heat-scored deals. Params: `appMode`, `mode` (`suite` uses SuitePerDay + SuiteDiningScore; default uses BalconyPerDay + MainDiningScore) | — |
| GET | `/api/market-brief` | 24h price change intelligence. Params: `appMode`, `priceType`, `line`. Returns alerts (>15% drops / >25% rises), market pulse summary, and per-line breakdowns | — |
| GET | `/api/price-history/{line}/{ship}/{date}` | Historical price snapshots for a specific sailing | 524-555 |
| GET | `/api/ships` | Full fleet reference — all ships sorted by line then year | 556-558 |
| GET | `/api/restaurants/{shipName}` | Restaurant data for a specific ship | 476-481 |

### Mutation Endpoints
| Method | Path | Description | Lines |
|--------|------|-------------|-------|
| PUT | `/api/ship-rating/{shipName}` | Update kids/ship/dining scores for a ship (in-memory) | 451-475 |
| PUT | `/api/restaurants/{id}` | Update a restaurant score/reason (DB + memory cache + recalc) | 483-521 |

### Calendar Endpoints
| Method | Path | Description | Lines |
|--------|------|-------------|-------|
| GET | `/api/calendar-events` | Fetch all family calendar events | 633-634 |
| POST | `/api/calendar-events` | Create a new calendar event | 636-642 |
| PUT | `/api/calendar-events/{id}` | Update an existing event | 668-675 |
| DELETE | `/api/calendar-events/{id}` | Delete an event | 660-666 |

### Settings Endpoints
| Method | Path | Description | Lines |
|--------|------|-------------|-------|
| GET | `/api/settings` | Read dashboard settings (line bonuses, etc.) | 695 |
| POST | `/api/settings` | Merge-update settings (partial updates supported) | 697-706 |

### Records (Data Types) — Lines 711-725
- `ShipInfo` — Line, Name, Class, Year, Tonnage, Capacity, Kids programs, Suite tiers, Dining scores, etc.
- `RatingUpdate` — KidsScore, ShipScore, MainDiningScore, PackageDiningScore, SuiteDiningScore
- `CalendarEvent` — Id, StartDate, EndDate, Type, Title
- `RestaurantData` — Id, ShipName, Name, Type, Cuisine, Score, Why

### Ship Reference Data — Lines 19-290
40+ ships hardcoded in a `Dictionary<string, ShipInfo>`. Each entry has: category (`"family"` or `"adult"`), cruise line, ship class, year built, last renovated, gross tonnage, passenger capacity, has kids programs, kids club description, suite tier name, suite multiplier, water features, notes, and 6 numeric scores (Kids, Ship, MainDining, PackageDining, SuiteDining, DiningPackageCostPerDay).

Ships are grouped by line:
- **Disney** (Magic, Fantasy, Dream, Wish, Treasure, Destiny, Adventure)
- **Norwegian** (Prima, Viva, Aqua, Luna, Aura, Encore, Bliss, Joy, Escape, Getaway, Breakaway, Epic, Gem, Jewel, Jade, Pearl, Dawn, Star, Sun, Sky, Spirit, Pride of America)
- **Celebrity** (Edge, Apex, Beyond, Ascent, Xcel, Eclipse, Equinox, Solstice, Reflection, Silhouette, Constellation, Summit, Millennium, Infinity, Flora, Seeker, Compass, Wanderer, Roamer, Boundless)
- **Oceania** (Vista, Allura, Marina, Riviera, Sirena, Insignia, Nautica, Regatta, Sonesta) — category: `"adult"`
- **Regent** (Splendor, Grandeur, Mariner, Navigator, Voyager, Prestige) — category: `"adult"`

### App Mode System (Family / Adults)
- **Family mode** (`appMode=family`): Shows all cruise lines — Disney, Norwegian, Celebrity, FL Resident
- **Adults mode** (`appMode=adult`): Restricts to adult-only lines — Oceania, Regent (eventually Virgin)
- Mode is really just a **preset line filter** — controlled by `LinesForMode(appMode)` in Program.cs
- Mode persisted via `dashboard-settings.json` and restored on page load via `GET /api/settings`
- When mode switches: `resetFiltersForModeSwitch()` clears all filter UI, then `updateModeUI()` adjusts visibility (hides Kids Area Only toggle, renames Calendar tab, etc.)
- In adult mode: kids score badge (🧒), "No Kids Program" badges, and Kids Area Only toggle are all hidden

### Restaurant System
- Restaurants loaded from `Restaurants` SQL table at startup into `allRestaurants` dictionary
- Automatically computes per-ship dining scores from restaurant data:
  - **MainDiningScore** = max score of `Type='Included'` restaurants
  - **PackageDiningScore** = average of top 3 `Type='Specialty/Paid'` restaurants
  - **SuiteDiningScore** = max score of `Type='Suite-Exclusive'` restaurants
- When a restaurant score is updated via `PUT /api/restaurants/{id}`, the dining scores are recalculated in memory. No restart needed.
- **New restaurants inserted directly to DB** are NOT picked up until app restart (deploy). The in-memory cache is only loaded at startup.

### Bulk Restaurant Score Updates
The fastest approach for updating many restaurant scores:
```powershell
# 1. Get current IDs
sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -d CruiseTracker -E -Q "SELECT Id, ShipName, Name, Score FROM Restaurants WHERE ShipName = 'Norwegian Luna' ORDER BY Score DESC" -s "|" -W

# 2. Update existing scores via the API (recalculates dining scores automatically)
$body = @{Score=93; Why=""} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:5050/api/restaurants/318" -Method Put -ContentType 'application/json' -Body $body

# 3. Insert NEW restaurants via SQL (API doesn't have an insert endpoint)
sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -d CruiseTracker -U CruiseDashboard -P "Cruise2026!Tracker" -Q "INSERT INTO Restaurants (ShipName,Name,Type,Cuisine,Score,Why) VALUES ('Norwegian Luna','Onda by Scarpetta','Specialty/Paid','Modern Italian',93,'');"

# 4. Redeploy to reload in-memory cache with new inserts
schtasks /Run /TN "CruiseDashboardDeploy"
```

---

## Frontend (ES6 Modules) — Function Catalog

The frontend has been modularized into standard browser ES6 modules (no build runner needed).

### Core Architecture
* `main.js` — Entry point, orchestrates tab switching, app mode (Family/Adult).
* `state.js` — Global state container (`allCruises`, `allShips`, `calendarEvents`).
* `api.js` — Client-side fetch wrappers (if extracted, otherwise in main/ui files).
* `helpers.js` — Pure utility functions (`formatDate`, `escHtml`, `kidsClubAssignment`).
* `scoring.js` — Value computation algorithms and dynamic dining math.

### UI Components
* `ui-dashboard.js` — Core dashboard layout, stat aggregation, main filter logic.
* `ui-cards.js` — Rendering of deals/cruise cards, price math, booking URL builder.
* `ui-table.js` — "All Cruises" sortable data grid logic.
* `ui-ships.js` — "Ship Reference" cards and editable rating logic.
* `ui-calendar.js` — Family Calendar grid, events list, edit popups.
* `ui-modals.js` — Price history Chart.js modal and generic info modals.

### Kids Club System
| Function | Line | Purpose |
|----------|------|---------|
| `OUR_KIDS` constant | 268-271 | Array with Jack (Sep 2016) and Eric (Apr 2019) birthdays |
| `ageOnDate(birthday, date)` | 274-279 | Calculate age on a specific date |
| `kidsClubAssignment()` | 281-321 | Determine which kids club each child goes to per cruise line |
| `kidsClubBadges()` | 323-328 | Render HTML badges showing kids club placement |

### Dining Score System (Lines 330-371)
| Function | Line | Purpose |
|----------|------|---------|
| `getDynamicDiningScore(c, mode)` | 330-371 | Returns dining score based on mode (main/package/suite) using ship data |

### Value Scoring (Lines 770-857)
| Function | Line | Purpose |
|----------|------|---------|
| `computeValueStars(cruises)` | 771-843 | **Core value algorithm** — weighted score from kids/ship/dining/price with configurable per-line bonuses |
| `effectivePpd(c)` [nested] | 781-790 | Get effective price-per-day for current mode |
| `renderStars(rating)` | 845-857 | Render star rating HTML (0.5-5.0 stars) |

### Card Rendering (Lines 862-1196)
| Function | Line | Purpose |
|----------|------|---------|
| `fmtPpd(val)` | 863-866 | Format price-per-day as `$XXX` |
| `fmtTotal(val)` | 868-871 | Format total price as `$X,XXX` |
| `renderDashboardCards(cruises)` | 877-891 | Paginated card rendering (25 per page) |
| `appendShowMoreButton()` | 893-920 | "Show More" pagination button |
| `buildBookingUrl(c)` | 941-962 | Build cruise line booking URL (NCL deep link, Celebrity/Disney search) |
| `loadLineBonuses()` | 964-973 | Fetch saved bonuses from `GET /api/settings` |
| `saveLineBonuses()` | 976-991 | Debounced save to `POST /api/settings` |
| `renderSingleCard(c, i)` | 992-1123 | **Full card HTML** — price display, kids badges, value stars, booking link |
| `toggleDealExpand(cardId)` | 1125-1196 | Expand/collapse card — loads price chart + dining reports + mini calendar |

### Price Charts (Lines 1198-1254)
| Function | Line | Purpose |
|----------|------|---------|
| `loadInlineChart()` | 1198-1246 | Fetch price history and render Chart.js line chart |
| `toggleChartDataset()` | 1248-1254 | Toggle balcony/suite dataset visibility |

### Dining Reports (Lines 1259-1425)
| Function | Line | Purpose |
|----------|------|---------|
| `loadDiningReportsHtml()` | 1260-1389 | Fetch restaurants and build accordion sections |
| `renderRestaurantGroup()` | 1391-1410 | Render grouped restaurant cards |
| `getScoreColorStyle()` | 1412-1425 | Color-code restaurant scores (green/yellow/red) |

### Mini Calendar
| Function | Purpose |
|----------|---------|
| `generateMiniCalendar()` | Generate calendar HTML for cruise departure/return range |
| `renderMiniMonth()` | Render one month grid with highlighted cruise dates |

### All Cruises Table
| Function | Line | Purpose |
|----------|------|---------|
| `initCruiseFilters()` | 1490-1502 | Table-specific filter handlers |
| `applyFilters()` | 1504-1540 | Filter and re-render the cruises table |
| `initTableSort()` | 1542-1557 | Column header sort click handlers |
| `renderCruises(cruises)` | 1559-1611 | Render HTML table rows for all cruises |
| `priceClass(ppd, line, type)` | 1613-1621 | CSS class for price cell coloring |

### Ship Reference (Lines 1626-1802)
| Function | Line | Purpose |
|----------|------|---------|
| `applyShipFilters()` | 1627-1634 | Filter ship cards by line and suite level |
| `loadDiningDetails()` | 1637-1655 | Fetch and cache restaurant data for a ship |
| `autoResizeTextarea()` | 1657-1660 | Auto-resize textarea for dining notes |
| `renderDiningDetails()` | 1662-1692 | Render editable restaurant score cards |
| `renderShips(ships)` | 1694-1748 | Render ship reference cards with editable scores |
| `updateShipRating()` | 1750-1775 | Save ship rating change via `PUT /api/ship-rating` |
| `updateRestaurantScore()` | 1777-1802 | Save restaurant score change via `PUT /api/restaurants` |

### Price History Modal (Lines 1807-1892)
| Function | Line | Purpose |
|----------|------|---------|
| `initModal()` | 1808-1825 | Initialize price history popup modal |
| `closeModal()` | 1827-1830 | Close modal |
| `showPriceHistory()` | 1832-1892 | Fetch and chart price history in modal |

### Booking URLs (Lines 921-962)
| Constant | Line | Purpose |
|----------|------|---------|
| `NCL_SHIP_CODES` | 922-932 | Ship name → NCL URL code mapping |
| `NCL_PORT_CODES` | 933-939 | Port name → NCL URL code mapping |
| `buildBookingUrl(c)` | 941-962 | Returns deep link URL per cruise line |

### Family Calendar (Lines 1952-2181)
| Function | Line | Purpose |
|----------|------|---------|
| `initCalendar()` | 1953-1976 | Calendar tab initialization with month navigation |
| `renderCalendar()` | 1978-2038 | Render month grid with event markers |
| `calStartAdd(dateStr)` | 2040-2047 | Open add-event popup for a date |
| `openCalPopup()` | 2049-2086 | Open event editing popup |
| `closeCalPopup()` | 2088-2090 | Close popup |
| `updateCalendarEvent()` | 2092-2111 | Save event via `PUT /api/calendar-events` |
| `renderEventList()` | 2113-2148 | Render sidebar event list |
| `saveCalendarEvent()` | 2150-2170 | Create event via `POST /api/calendar-events` |
| `deleteCalendarEvent()` | 2172-2180 | Delete event via `DELETE /api/calendar-events` |

### Helpers (Lines 1897-1944)
| Function | Line | Purpose |
|----------|------|---------|
| `suiteBadge(name)` | 1898-1902 | Render suite tier badge |
| `formatShortDate(d)` | 1904-1906 | Format as "Mar 15" |
| `formatDateStr(dateStr)` | 1908-1912 | Parse ISO date string to formatted date |
| `formatDate(d)` | 1914-1916 | Format Date object |
| `formatTime(d)` | 1918-1920 | Format time portion |
| `truncate(str, len)` | 1922-1925 | Truncate string with ellipsis |
| `escHtml(str)` | 1927-1932 | Escape HTML entities |
| `escAttr(str)` | 1934-1936 | Escape attribute entities |
| `debounce(fn, ms)` | 1938-1944 | Debounce function calls |

---

## HTML Structure (index.html) — 4 Tabs

### Header (Lines 17-29)
- App title, last scrape time, scraper health indicator, total sailing count

### Navigation Tabs (Lines 32-45)
1. **📊 Dashboard** (`tab-dashboard`) — main view
2. **🗓️ All Cruises** (`tab-cruises`) — table view
3. **🚢 Ship Reference** (`tab-ships`) — fleet data
4. **📅 Family Calendar** (`tab-calendar`) — event calendar

### Dashboard Tab (Lines 47-298)
- **Stats Grid** (Lines 49-72): 4 stat cards — Total Sailings, Ships, Best Balcony PPD, Best Suite PPD
- **Filters Bar** (Lines 73-196): Cruise Line, Ship, Port, Nights (checkbox dropdowns), Max PPD slider, Max Total slider, Month range picker, Suite Level, Kids-only toggle, Ship-within-ship toggle, Transatlantic toggle
- **Dining Mode Toggle** (Lines 198-210): Main / 📦 Package / 👑 Suite buttons
- **Value Weights** (Lines 211-243): Collapsible panel with Kids/Ship/Dining/Price sliders (0-100)
- **Deals Container** (Lines 280-298): Paginated cruise cards

### All Cruises Tab (Lines 299-388)
- Filter bar with Line/Ship/Port selects
- Sortable table with all pricing columns

### Ship Reference Tab (Lines 390-454)
- Filter bar with Line dropdown and Suite Level filter
- **Line Bonus Section** (Lines 412-444): Per-line value bonus dropdowns (Norwegian, Celebrity, Disney × Main/Suite, -30 to +30)
- Ships grid with editable score cards

### Calendar Tab (Lines 456-513)
- Month navigation (prev/next/today)
- Color-coded event legend (Amy's Work, Steve's Work, Kids Off, Family Plans)
- Calendar grid with clickable day cells
- Event list sidebar
- Add/edit event popup

---

## Database (SQL Server: CruiseTracker)

### Tables
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `Cruises` | One row per sailing | CruiseLine, ShipName, DepartureDate (PK), Itinerary, ItineraryCode, Nights, DeparturePort, Ports, IsDeparted |
| `PriceHistory` | Price snapshots per scraper run | CruiseLine, ShipName, DepartureDate, ScrapedAt, InsidePrice/PerDay, OceanviewPrice/PerDay, BalconyPrice/PerDay, SuitePrice/PerDay, HavenPrice/PerDay, FLResBalconyPrice/PerDay, FLResSuitePrice/PerDay |
| `ScraperRuns` | Scraper execution log | ScraperName, StartedAt, CompletedAt, SailingsFound, SailingsUpdated, Status, Errors |
| `Restaurants` | Restaurant data per ship | Id, ShipName, Name, Type (Included/Specialty/Suite), Cuisine, Score (0-100), Why |

### File-Based Storage
| File | Purpose | Read By |
|------|---------|---------|
| `calendar-events.json` | Family calendar events | Program.cs `/api/calendar-events` |
| `dashboard-settings.json` | UI settings (line bonuses) | Program.cs `/api/settings` |
| `scraper/*.json` | Scraper output snapshots | Scrapers (gitignored, not authoritative — DB is the source) |

---

## Scrapers

All scrapers are Node.js scripts using `mssql/msnodesqlv8` for SQL Server with Windows auth. Each follows the same pattern: fetch data → parse → upsert to DB → record run in ScraperRuns.

### NCL Scraper (`ncl-scraper.js`, 437 lines)
- **API**: REST — `ncl.com/api/v2/vacations/search` (discovery) + `/api/vacations/sailings/{code}` (pricing)
- **Flow**: Discover FL-departing itineraries → fetch per-itinerary sailings → extract Inside/OV/Balcony/Suite/Haven pricing → MERGE upsert
- **Special**: Captures `itineraryCode` for deep booking links
- **CLI**: `node ncl-scraper.js [--ship "Norwegian Aqua"]`
- **Key functions**: `fetchAllItineraries()` → `fetchSailings(code)` → `buildSailingRecords()` → `upsertToDatabase()`

### Celebrity Scraper (`celebrity-scraper.js`, 419 lines)
- **API**: GraphQL — `celebritycruises.com/graphql`
- **Flow**: Paginated GraphQL cruise search → extract stateroom class pricing → MERGE upsert
- **Key functions**: `fetchPage(skip)` → `parsePricing(stateroomClassPricing, nights)` → `upsertToDb()`

### Disney Scraper (`disney-scraper.js`, 442 lines)
- **API**: REST — `disneycruise.disney.go.com` (requires `__pa` cookie via Playwright)
- **Flow**: Acquire cookie via headless browser → fetch products → fetch sailings per ship → parse pricing → MERGE upsert
- **Special**: Needs Playwright for cookie acquisition (PerimeterX bot protection)
- **Key functions**: `acquireCookie()` → `fetchFirstProduct()` → `fetchSailings()` → `parseSailingPrices()` → `upsertToDatabase()`

### Disney FL Resident Scraper (`disney-fl-scraper.js`, 534 lines)
- **API**: Same as Disney but with FL_RESIDENT affiliation
- **Flow**: Same as Disney scraper but fetches FL resident discounted pricing
- **Stores to**: `FLResBalconyPrice`, `FLResSuitePrice` columns in PriceHistory
- **Key functions**: Same pattern, with `AFFILIATIONS = [{ affiliationType: 'FL_RESIDENT' }]`

### Virgin Voyages Scraper (`virgin-scraper.js`, ~500 lines)
- **API**: Playwright (headless browser) — no REST API, scrapes `virginvoyages.com/book/voyage-planner/find-a-voyage`
- **Flow**: Load search page → scroll to lazy-load all voyage cards → extract pricing/ports from DOM → decode voyageId for ship/date/nights → navigate to each sailing's cabin page for RockStar Quarters suite pricing → MERGE upsert
- **Special**: Uses Playwright to bypass DataDome bot protection. VoyageId encoding: `SC2603134NKW` → Ship=SC (Scarlet Lady), Date=2026-03-13, Nights=4, PkgCode=NKW
- **Ships**: Scarlet Lady (SC), Valiant Lady (VL), Resilient Lady (RS), Brilliant Lady (BR)
- **Pricing**: Per-person ("per Sailor") — multiplied by 2 for couple pricing before DB insert. "Starting from" price maps to BalconyPrice (Sea Terrace equiv), RockStar Quarters maps to SuitePrice
- **Port extraction**: Parses the bulleted itinerary route list (e.g. `Miami, Florida • Puerto Plata • Miami, Florida`) — first item is departure port
- **Resilience**: `gotoWithRetry()` wrapper retries on timeout (90s base, 120s retry). Fatal errors still record a ScraperRuns entry with 0 sailings
- **CLI**: `node virgin-scraper.js [--ship "Scarlet Lady"]`
- **Key functions**: `decodeVoyageId(id)` → `main()` (DOM extraction + Rockstar pricing) → `upsertToDatabase()`
- **Output**: Also saves `virgin-latest.json` alongside DB upsert

### Running Scrapers
```powershell
# Individual
node scraper/ncl-scraper.js
node scraper/celebrity-scraper.js
node scraper/disney-scraper.js
node scraper/disney-fl-scraper.js
node scraper/virgin-scraper.js

# All via orchestration script (runs nightly at 3 AM via Windows scheduled task)
powershell RunScraper.ps1
```

---

## Tests (DashboardTests.cs) — 11 Playwright NUnit Tests

| Test | What It Validates |
|------|-------------------|
| `Dashboard_LoadsAndShowsSailingCount` | Sailing count stat card matches rendered card count |
| `Dashboard_ShowsCruiseCards` | Cards render with result-count label |
| `Dashboard_FilterReducesCardCount` | Disney filter reduces cards vs unfiltered |
| `Dashboard_StatCardsShowRealData` | All 4 stat cards show real values, not "—" |
| `Api_CruisesReturnsData` | `/api/cruises` returns non-empty JSON with expected fields |
| `Api_AllCruisesHaveKnownShipData` | All cruises have recognized ship class + ratings |
| `Api_CruisesNeverReturnsPastDepartures` | No departed cruises in API response |
| `Api_SuiteModeExcludesNoSuiteSailings` | `mode=suite` filters out cruises without suite pricing |
| `Api_SuiteModeReturnsFewerResults` | Suite mode returns fewer results than default |
| `Api_DealsNeverReturnsPastDepartures` | `/api/deals` never returns past departures |
| `Calendar_TabRendersGrid` | Calendar tab renders day cells and event list |

**Run tests:**
```powershell
dotnet test CruiseDashboard\CruiseDashboard.Tests --logger "console;verbosity=detailed"
```

---

## Common Gotchas

1. **Forgotten cache bust** — if JS/CSS changes don't appear, bump the `?v=` in `index.html`
2. **IIS file locks** — always use the scheduled task deploy, never manual file copy
3. **Suite mode** — many cruises lack suite pricing; the API filters these out in suite mode
4. **Test failures after schema changes** — if you add/remove DB columns, the API mapping in `Program.cs` must match
5. **Port 5050** — the dashboard runs on port 5050, not the default 5000
6. **Price sliders** — slider ranges are fixed in HTML; reset to max when switching modes
7. **Encoding / grep** — `app.js` uses UTF-8 with emoji. **`grep_search` does NOT work reliably on `app.js`** due to encoding. Use `view_file_outline` to find functions by name, then `view_file` with line ranges to read code. Use `view_code_item` only if the function name is simple ASCII.
8. **Ship not found** — if a scraper finds a new ship not in the `ships` dictionary, `LookupShip()` returns null and scores degrade to defaults. Add new ships to the dictionary in `Program.cs`
9. **Restaurant score recalc** — when updating via `PUT /api/restaurants/{id}`, the server recalculates aggregate dining scores in memory. No restart needed. But **new inserts to the DB require a deploy/restart** to refresh the in-memory cache.
10. **Calendar persistence** — `calendar-events.json` is in the project root, tracked by git. Don't delete it during deploys
11. **Settings persistence** — `dashboard-settings.json` stores value bonuses server-side. Created automatically on first POST
12. **Scraper cookies** — Disney scrapers need fresh `__pa` cookies via Playwright. If Playwright browsers aren't installed, run `npx playwright install chromium`
13. **Mode switch race condition** — `initAppModeToggle()` is `async` and must be `await`ed before `loadDashboard()`. The saved mode comes from `/api/settings` and if not awaited, the page loads with the HTML default ("family") before the async fetch completes.
14. **Filter reset on mode switch** — use `resetFiltersForModeSwitch()` (NOT `clearAllFilters()`) when switching modes. `clearAllFilters()` calls `applyDashboardFilters()` which runs on stale data and re-enables Kids Area Only.
15. **SQL auth confusion** — the app uses SQL user auth (`CruiseDashboard`), but direct admin queries need Windows auth (`-E`). See the "SQL Authentication" section above for details.
16. **Scheduled Scrapers & Silent LINQPad Failures** — `lprun8.exe` will fail silently if there are syntax errors in a `.linq` script because `RunScraper.ps1` redirects errors to `$null`. To prevent silent failures on the nightly run, always include a compilation test via `lprun8 -compileonly` in the test suite.
17. **NCL Ship-Within-A-Ship Pricing** — NCL "The Haven" prices are scraped into the `VerifiedSuitePrice` column natively, while standard "Club Balcony Suites" map to the regular `SuitePrice` column. Make sure the backend explicitly selects `VerifiedSuitePrice` and the frontend properly checks for it, otherwise you might accidentally display standard suite prices under the "Haven" label!
