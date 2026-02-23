---
description: Deploy CruiseDashboard to IIS (stop, publish, copy static files, start)
---
// turbo-all

1. Stop IIS
```powershell
iisreset /stop
```

2. Publish the project
```powershell
dotnet publish -c Release -o "c:\Dev\Cruise Tracker\CruiseDashboard\publish" "c:\Dev\Cruise Tracker\CruiseDashboard\CruiseDashboard.csproj"
```

3. Copy static files (wwwroot) to ensure they're up-to-date
```powershell
Copy-Item "c:\Dev\Cruise Tracker\CruiseDashboard\wwwroot\js\app.js" "c:\Dev\Cruise Tracker\CruiseDashboard\publish\wwwroot\js\app.js" -Force
Copy-Item "c:\Dev\Cruise Tracker\CruiseDashboard\wwwroot\css\style.css" "c:\Dev\Cruise Tracker\CruiseDashboard\publish\wwwroot\css\style.css" -Force
Copy-Item "c:\Dev\Cruise Tracker\CruiseDashboard\wwwroot\index.html" "c:\Dev\Cruise Tracker\CruiseDashboard\publish\wwwroot\index.html" -Force
```

4. Start IIS
```powershell
iisreset /start
```

5. Verify the site is up
```powershell
(Invoke-WebRequest -Uri "http://localhost:5050/" -UseBasicParsing).StatusCode
```
