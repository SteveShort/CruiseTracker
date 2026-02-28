# Run this script as Administrator to set up the CruiseDashboard IIS site
# Right-click PowerShell -> Run as Administrator, then run this script

Import-Module WebAdministration

$siteName = "CruiseDashboard"
$publishPath = "c:\Dev\Cruise Tracker\CruiseDashboard\publish"
$port = 5050

# Remove existing site/pool if they exist
if (Test-Path "IIS:\Sites\$siteName") {
    Remove-Website -Name $siteName
    Write-Host "Removed existing site: $siteName"
}
if (Test-Path "IIS:\AppPools\$siteName") {
    Remove-WebAppPool -Name $siteName
    Write-Host "Removed existing app pool: $siteName"
}

# Create Application Pool (No Managed Code for ASP.NET Core)
New-WebAppPool -Name $siteName
Set-ItemProperty "IIS:\AppPools\$siteName" -Name managedRuntimeVersion -Value ""
Set-ItemProperty "IIS:\AppPools\$siteName" -Name processModel.identityType -Value "ApplicationPoolIdentity"
Write-Host "Created app pool: $siteName (No Managed Code)"

# Create Website
New-Website -Name $siteName -PhysicalPath $publishPath -Port $port -ApplicationPool $siteName
Write-Host "Created website: $siteName on port $port"

# Grant IIS_IUSRS read access to the publish folder
$acl = Get-Acl $publishPath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("IIS_IUSRS", "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow")
$acl.AddAccessRule($rule)
Set-Acl $publishPath $acl
Write-Host "Granted IIS_IUSRS read access to $publishPath"

# Start the site
Start-Website -Name $siteName
Write-Host ""
Write-Host "Done! CruiseDashboard is running at http://localhost:$port"
Write-Host "Open your browser to http://localhost:$port to view the dashboard."
