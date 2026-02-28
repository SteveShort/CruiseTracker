# Cruise Tracker — AI Project Brief

## What This App Does
A family cruise planning dashboard that scrapes pricing from NCL, Celebrity, and Disney cruise lines, stores historical prices, and renders a filterable dashboard for comparing cruise deals. The goal is finding the best family cruise value across all three lines, factoring in kids programs, ship quality, dining, and price.

## Architecture

```
c:\Dev\Cruise Tracker\
├── CruiseDashboard\          ← ASP.NET 8 Minimal API + static frontend
│   ├── Program.cs            ← API endpoints, ship data, SQL queries
│   ├── wwwroot\
│   │   ├── js\app.js         ← All dashboard JS (filters, cards, charts, value scoring)
│   │   ├── css\style.css     ← Dark theme CSS
│   │   └── index.html        ← Single-page app
│   ├── Deploy.ps1            ← Deployment script (used by scheduled task)
│   └── CruiseDashboard.Tests\
│       └── DashboardTests.cs ← Playwright-based NUnit integration tests
├── scraper\
│   ├── ncl-scraper.js        ← NCL pricing via internal JSON APIs
│   ├── disney-scraper.js     ← Disney pricing via API
│   ├── disney-fl-scraper.js  ← Disney FL resident pricing
│   └── celebrity-scraper.js  ← Celebrity pricing via GraphQL
└── RunScraper.ps1            ← Nightly scraper orchestration
```

## Critical Environment Details

| Item | Value |
|------|-------|
| **Dashboard URL** | `http://localhost:5050` |
| **IIS Site** | CruiseDashboard on port 5050 |
| **SQL Server** | `STEVEOFFICEPC\ORACLE2SQL`, Database: `CruiseTracker` |
| **SQL Auth** | Windows Integrated (Trusted_Connection) |
| **Test command** | `dotnet test` from `CruiseDashboard\CruiseDashboard.Tests` |
| **Git** | Single repo at `c:\Dev\Cruise Tracker` (no submodules) |

## ⚠️ Deployment — MUST USE SCHEDULED TASK

**NEVER run `dotnet publish` and copy files manually.** IIS locks the DLLs and the deploy will fail silently or corrupt the site.

**Always deploy via the scheduled task:**
```powershell
schtasks /Run /TN "CruiseDashboardDeploy"
```

The task runs `Deploy.ps1` which: builds → stops IIS site → kills w3wp → swaps publish folder → restarts IIS.

**Monitor deploy status:**
```powershell
# Write status file before triggering
Set-Content c:\temp\cruise-deploy-status.txt "PENDING"
schtasks /Run /TN "CruiseDashboardDeploy"
# Wait and check
Start-Sleep 25; Get-Content c:\temp\cruise-deploy-status.txt
```

## Cache Busting
The `index.html` references `app.js` with a version query string:
```html
<script src="js/app.js?v=20260227j"></script>
```
**Bump this version** whenever you modify `app.js` so browsers don't serve stale JS.

## Key Conventions

### Frontend (app.js)
- `getDiningMode()` returns `'main'`, `'package'`, or `'suite'` — controls which prices display
- `computeValueStars()` scores cruises 0-100 using weighted kids/ship/dining/price components
- `effectivePpd(c)` returns the price-per-day for the current mode
- `applyDashboardFilters()` is the main re-render function — call after any filter/mode change
- `renderSingleCard()` builds card HTML — one card per cruise sailing
- Cards are clickable to expand (shows price chart, dining reports, mini calendar)

### Backend (Program.cs)
- Ship data is hardcoded in a `Dictionary<string, ShipInfo>` — add new ships here
- `/api/cruises` — main endpoint, returns all non-departed cruises with latest prices
- `/api/price-history/{line}/{ship}/{date}` — historical price data for charts
- Suite mode filter (`?mode=suite`) excludes cruises without suite pricing server-side

### Database Tables
- `Cruises` — one row per sailing (CruiseLine + ShipName + DepartureDate = PK)
- `PriceHistory` — price snapshots over time (new row each scraper run)
- `ScraperRuns` — scraper execution log

### Scrapers
- All scrapers use `mssql/msnodesqlv8` with Windows auth
- NCL scraper stores `ItineraryCode` for deep booking links
- Run individual scraper: `node ncl-scraper.js` (optionally `--ship "Norwegian Aqua"`)
- Run all: `powershell RunScraper.ps1`

## Common Gotchas
1. **Forgotten cache bust** — if JS changes don't appear, bump the `?v=` in index.html
2. **IIS file locks** — always use the scheduled task deploy, never manual file copy
3. **Suite mode** — many cruises lack suite pricing; the API filters these out in suite mode
4. **Test failures after schema changes** — if you add/remove DB columns, the API mapping in Program.cs must match or tests will fail with 500 errors
5. **Port 5050** — the dashboard runs on port 5050, not the default 5000
6. **Price sliders** — slider ranges are fixed in HTML; reset to max when switching modes
7. **Encoding** — app.js uses UTF-8; be careful with emoji/Unicode characters in template literals
