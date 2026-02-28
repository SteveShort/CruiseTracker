# ── Run this ONCE as Administrator to register the deploy task ────────
# After this, Deploy.ps1 can run without UAC prompts via:
#   Start-ScheduledTask -TaskName "CruiseDashboardDeploy"
# ─────────────────────────────────────────────────────────────────────

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument '-ExecutionPolicy Bypass -File "c:\Dev\Cruise Tracker\CruiseDashboard\Deploy.ps1"'

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask -TaskName "CruiseDashboardDeploy" `
    -Description "Build and deploy CruiseDashboard to IIS" `
    -Action $action -Settings $settings `
    -RunLevel Highest -Force

Write-Host "Task 'CruiseDashboardDeploy' registered successfully" -ForegroundColor Green
