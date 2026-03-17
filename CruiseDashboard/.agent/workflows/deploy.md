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

3. Fast API smoke tests (replaces slow Playwright suite for routine deploys)
```powershell
$ok = 0; $fail = 0; @('http://localhost:5050/', 'http://localhost:5050/api/cruises', 'http://localhost:5050/api/market-brief?appMode=family&priceType=balcony', 'http://localhost:5050/api/ships') | ForEach-Object { try { $r = Invoke-WebRequest -Uri $_ -UseBasicParsing -TimeoutSec 10; if ($r.StatusCode -eq 200) { Write-Host "  PASS $_" -ForegroundColor Green; $ok++ } else { Write-Host "  FAIL $_ ($($r.StatusCode))" -ForegroundColor Red; $fail++ } } catch { Write-Host "  FAIL $_ ($_)" -ForegroundColor Red; $fail++ } }; Write-Host "`nSmoke: $ok passed, $fail failed"; if ($fail -gt 0) { throw "Smoke tests failed!" }
```

4. Commit changes locally and push to GitHub (only tracked files)
```powershell
git -C "c:\Dev\Cruise Tracker" add -u; git -C "c:\Dev\Cruise Tracker" commit -m "Deploy update"; git -C "c:\Dev\Cruise Tracker" push
```

5. **(OPTIONAL — only for major releases)** Run full Playwright test suite
```powershell
dotnet test "c:\Dev\Cruise Tracker\CruiseDashboard\CruiseDashboard.Tests" --logger "console;verbosity=detailed"
```

