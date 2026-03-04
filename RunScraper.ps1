# ─────────────────────────────────────────────────────────────
#  RunScraper.ps1 — Nightly Cruise Deal Tracker runner
#  Called by Windows Task Scheduler at 3:00 AM daily
#
#  Runs:
#    1. CruiseDealTracker.linq (Disney, Disney-FL, NCL, Celebrity, Oceania, Regent)
#    2. silversea-scraper.js   (Algolia API, no browser)
#    3. virgin-scraper.js      (Playwright, DataDome bypass)
#    4. seabourn-scraper.js    (Playwright, Akamai bypass)
# ─────────────────────────────────────────────────────────────

# ── LOGGING FLAG ── Set to $true to log output to file ──────
$EnableLogging = $false
# ─────────────────────────────────────────────────────────────

$lprun = "C:\Program Files\LINQPad8\lprun8.exe"
$script = "c:\Dev\Cruise Tracker\CruiseDealTracker.linq"
$scraperDir = "c:\Dev\Cruise Tracker\scraper"
$logDir = "c:\Dev\Cruise Tracker\logs"
$logFile = Join-Path $logDir ("scrape_{0:yyyy-MM-dd_HHmmss}.log" -f (Get-Date))

# ── Mark departed cruises before scraping ────────────────────
sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -d CruiseTracker -E -Q "UPDATE Cruises SET IsDeparted = 1 WHERE DepartureDate < CAST(GETDATE() AS DATE) AND IsDeparted = 0" -b 2>$null

# ── Run LINQPad scrapers (Disney, Disney-FL, NCL, Celebrity, Oceania, Regent) ──
if ($EnableLogging) {
    if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    & $lprun $script *> $logFile
}
else {
    & $lprun $script *> $null
}

# ── Run Node.js scrapers (Silversea, Virgin Voyages, Seabourn) ──
$nodeScrapers = @(
    "silversea-scraper.js",
    "virgin-scraper.js",
    "seabourn-scraper.js"
)

foreach ($scraper in $nodeScrapers) {
    $scraperPath = Join-Path $scraperDir $scraper
    try {
        if ($EnableLogging) {
            & node $scraperPath *>> $logFile
        }
        else {
            & node $scraperPath *> $null
        }
    }
    catch {
        # Log error but continue with other scrapers
        if ($EnableLogging) {
            "ERROR running ${scraper}: $_" | Add-Content $logFile
        }
    }
}

# ── Cleanup old logs ──
if ($EnableLogging -and (Test-Path $logDir)) {
    Get-ChildItem $logDir -Filter "scrape_*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force
}
