---
description: Deploy CruiseDashboard to IIS (stop, publish, copy static files, start)
---
// turbo-all

## Steps

1. Run the deploy scheduled task:
```powershell
schtasks /run /tn "CruiseDashboardDeploy"
```

2. Wait for deploy to complete (check status file):
```powershell
Start-Sleep -Seconds 20; Get-Content "c:\temp\cruise-deploy-status.txt"
```

3. Verify the site is responding:
```powershell
Invoke-RestMethod -Uri "http://localhost:5050/api/stats" | ConvertTo-Json
```
