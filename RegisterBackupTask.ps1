# ================================================================
#  Register CruiseTracker nightly DB backup as a scheduled task
#  Runs daily at 4:00 AM (after scrapers finish ~3 AM)
# ================================================================

$TaskName = "CruiseTrackerBackup"
$ScriptPath = Join-Path $PSScriptRoot "BackupDatabase.ps1"

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task: $TaskName"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At "4:00AM"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType S4U

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Nightly CruiseTracker database backup to Dropbox with tiered retention"

Write-Host ""
Write-Host "Scheduled task '$TaskName' registered successfully!"
Write-Host "  Runs daily at 4:00 AM"
Write-Host "  Script: $ScriptPath"
Write-Host "  Backups: C:\Users\sshor\Dropbox\Cruise Tracker DB Backup"
Write-Host ""
Write-Host "To run manually:  schtasks /Run /TN `"$TaskName`""
Write-Host "To view status:   schtasks /Query /TN `"$TaskName`" /FO LIST /V"
