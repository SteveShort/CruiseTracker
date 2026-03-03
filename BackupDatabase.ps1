<#
.SYNOPSIS
  CruiseTracker - Nightly Database Backup
  Backs up CruiseTracker DB to Dropbox-synced folder with
  tiered retention: 7 daily, 4 weekly (Sun), 12 monthly (1st)
#>

$ErrorActionPreference = "Stop"

# -- Configuration -------------------------------------------------------
$SqlServer = "STEVEOFFICEPC\ORACLE2SQL"
$Database = "CruiseTracker"
$BackupDir = "C:\Users\sshor\Dropbox\Cruise Tracker DB Backup"
$TempDir = "C:\temp"
$LogFile = Join-Path $BackupDir "backup-log.txt"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmm"
$BakFileName = "CruiseTracker_$Timestamp.bak"
$TempBackupFile = Join-Path $TempDir $BakFileName
$FinalBackupFile = Join-Path $BackupDir $BakFileName

# Retention settings
$KeepDailyDays = 7
$KeepWeeklyCount = 4    # Sundays
$KeepMonthlyCount = 12   # 1st of month

# -- Helpers --------------------------------------------------------------
function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $Message"
    Write-Host $line
    try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
}

# -- Ensure directories exist --------------------------------------------
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}
if (-not (Test-Path $TempDir)) {
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
}

Write-Log "=== Starting CruiseTracker backup ==="

# -- 1. Run SQL Server backup to temp dir ---------------------------------
# SQL Server service writes to temp dir (avoids Dropbox permission issues)
try {
    Write-Log "Backing up to temp: $TempBackupFile"

    $sql = "BACKUP DATABASE [$Database] TO DISK = N'$TempBackupFile' WITH FORMAT, INIT, NAME = N'CruiseTracker-Full', COMPRESSION, STATS = 10;"
    sqlcmd -S $SqlServer -E -Q $sql

    if (-not (Test-Path $TempBackupFile)) {
        throw "Backup file was not created!"
    }

    $sizeMB = [math]::Round((Get-Item $TempBackupFile).Length / 1MB, 2)
    Write-Log "Backup complete: $sizeMB MB"
}
catch {
    Write-Log "ERROR: Backup failed - $($_.Exception.Message)"
    exit 1
}

# -- 2. Copy to Dropbox folder -------------------------------------------
try {
    Write-Log "Copying to Dropbox: $FinalBackupFile"
    Copy-Item -Path $TempBackupFile -Destination $FinalBackupFile -Force
    Remove-Item -Path $TempBackupFile -Force
    Write-Log "Copy to Dropbox complete"
}
catch {
    Write-Log "ERROR: Copy to Dropbox failed - $($_.Exception.Message)"
    Write-Log "Backup remains at: $TempBackupFile"
    exit 1
}

# -- 3. Verify backup ----------------------------------------------------
try {
    Write-Log "Verifying backup integrity..."
    $verifySql = "RESTORE VERIFYONLY FROM DISK = N'$FinalBackupFile';"
    sqlcmd -S $SqlServer -E -Q $verifySql
    Write-Log "Backup verified OK"
}
catch {
    Write-Log "WARNING: Backup verification failed - $($_.Exception.Message)"
}

# -- 4. Retention cleanup ------------------------------------------------
Write-Log "Applying retention policy..."

$allBackups = Get-ChildItem -Path $BackupDir -Filter "CruiseTracker_*.bak" |
Sort-Object Name -Descending

$keepFiles = @{}

foreach ($bak in $allBackups) {
    # Parse date from filename: CruiseTracker_YYYYMMDD_HHMM.bak
    if ($bak.Name -match 'CruiseTracker_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\.bak') {
        $bakDate = [datetime]::ParseExact("$($Matches[1])$($Matches[2])$($Matches[3])", "yyyyMMdd", $null)
        $daysOld = (Get-Date).Date - $bakDate.Date

        # Rule 1: Keep last N days of dailies
        if ($daysOld.Days -le $KeepDailyDays) {
            $keepFiles[$bak.FullName] = "daily"
            continue
        }

        # Rule 2: Keep weekly backups (Sundays)
        if ($bakDate.DayOfWeek -eq [DayOfWeek]::Sunday) {
            $sundayCount = ($keepFiles.Values | Where-Object { $_ -eq "weekly" }).Count
            if ($sundayCount -lt $KeepWeeklyCount) {
                $keepFiles[$bak.FullName] = "weekly"
                continue
            }
        }

        # Rule 3: Keep monthly backups (1st of month)
        if ($bakDate.Day -le 1) {
            $monthlyCount = ($keepFiles.Values | Where-Object { $_ -eq "monthly" }).Count
            if ($monthlyCount -lt $KeepMonthlyCount) {
                $keepFiles[$bak.FullName] = "monthly"
                continue
            }
        }
    }
}

# Always keep today's backup
$keepFiles[$FinalBackupFile] = "today"

# Delete backups not in the keep list
$deleted = 0
foreach ($bak in $allBackups) {
    if (-not $keepFiles.ContainsKey($bak.FullName)) {
        Write-Log "  Deleting: $($bak.Name)"
        Remove-Item $bak.FullName -Force
        $deleted++
    }
}

$kept = $allBackups.Count - $deleted
Write-Log "Retention: kept $kept, deleted $deleted (of $($allBackups.Count) total)"

# -- Summary --------------------------------------------------------------
Write-Log "=== Backup complete ==="
Write-Log ""
