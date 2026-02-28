# ── CruiseDashboard Deploy Script ─────────────────────────────────────
# Builds the project to a temp folder, swaps the IIS publish directory,
# and restarts IIS. Designed to run as a scheduled task (no UAC prompt).
# ──────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
$projectDir = 'c:\Dev\Cruise Tracker\CruiseDashboard'
$publishDir = Join-Path $projectDir 'publish'
$tempDir = 'c:\temp\cruise-deploy'
$statusFile = 'c:\temp\cruise-deploy-status.txt'

function Log-Message([string]$msg) {
    Add-Content -Path $statusFile -Value $msg
}

Set-Content -Path $statusFile -Value 'RUNNING'
Log-Message '── [1/5] Building...'

Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
$buildOutput = & dotnet publish "$projectDir" -c Release -o $tempDir 2>&1
if ($LASTEXITCODE -ne 0) {
    Log-Message "BUILD FAILED:"
    $buildOutput | ForEach-Object { Log-Message $_ }
    Log-Message 'FAILED: BUILD'
    exit 1
}
Log-Message '       Build OK'

Log-Message '── [2/5] Stopping IIS...'
& iisreset /stop | Out-Null
Start-Sleep -Seconds 5

Log-Message '── [3/5] Swapping publish folder...'
# Kill any lingering worker processes
Stop-Process -Name w3wp -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item $publishDir -Recurse -Force -ErrorAction SilentlyContinue
if (!(Test-Path $publishDir)) { New-Item -ItemType Directory -Path $publishDir | Out-Null }
Copy-Item "$tempDir\*" "$publishDir" -Recurse -Force

Log-Message '── [4/5] Starting IIS...'
& iisreset /start | Out-Null
Start-Sleep -Seconds 2

Log-Message '── [5/5] Cleanup...'
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Log-Message '── Deploy complete ✓'
Log-Message 'DONE'
