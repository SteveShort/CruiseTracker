# ─────────────────────────────────────────────────────────────
#  RunScraper.ps1 — Nightly Cruise Deal Tracker runner
#  Called by Windows Task Scheduler at 3:00 AM daily
# ─────────────────────────────────────────────────────────────

# ── LOGGING FLAG ── Set to $true to log output to file ──────
$EnableLogging = $false
# ─────────────────────────────────────────────────────────────

$lprun = "C:\Program Files\LINQPad8\lprun8.exe"
$script = "c:\Dev\Cruise Tracker\CruiseDealTracker.linq"
$logDir = "c:\Dev\Cruise Tracker\logs"
$logFile = Join-Path $logDir ("scrape_{0:yyyy-MM-dd_HHmmss}.log" -f (Get-Date))

# ── Mark departed cruises before scraping ────────────────────
sqlcmd -S "STEVEOFFICEPC\ORACLE2SQL" -d CruiseTracker -E -Q "UPDATE Cruises SET IsDeparted = 1 WHERE DepartureDate < CAST(GETDATE() AS DATE) AND IsDeparted = 0" -b 2>$null

if ($EnableLogging) {
    if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    & $lprun $script *> $logFile
    # Keep only the last 30 log files
    Get-ChildItem $logDir -Filter "scrape_*.log" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 |
    Remove-Item -Force
}
else {
    & $lprun $script *> $null
}
