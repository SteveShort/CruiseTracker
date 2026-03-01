---
description: Deploy CruiseDashboard to IIS (stop, publish, copy static files, start)
---
// turbo-all

1. Deploy via scheduled task (builds to temp dir, stops IIS, kills w3wp, swaps publish, restarts)
```powershell
schtasks /run /tn "CruiseDashboardDeploy"
```

2. Wait for deploy to complete and verify the site is up
```powershell
Start-Sleep -Seconds 15; (Invoke-WebRequest -Uri "http://localhost:5050/" -UseBasicParsing).StatusCode
```

3. Run Playwright smoke tests
```powershell
dotnet test "c:\Dev\Cruise Tracker\CruiseDashboard\CruiseDashboard.Tests" --logger "console;verbosity=detailed"
```

4. Commit changes locally and push to GitHub (only tracked files)
```powershell
git -C "c:\Dev\Cruise Tracker" add -u; git -C "c:\Dev\Cruise Tracker" commit -m "Deploy update"; git -C "c:\Dev\Cruise Tracker" push
```
