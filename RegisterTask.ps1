# Run this script as Administrator to register the scheduled task
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-ExecutionPolicy Bypass -File "c:\Dev\Cruise Tracker\RunScraper.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At "3:00AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask -TaskName "CruiseDealTracker" `
    -Description "Nightly cruise deal scraper - runs at 3:00 AM" `
    -Action $action -Trigger $trigger -Settings $settings `
    -RunLevel Highest -Force

Write-Host "Scheduled task 'CruiseDealTracker' registered successfully"
