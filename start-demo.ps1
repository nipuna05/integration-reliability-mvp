# Starts the server (guests can view/run; editing needs the password in .demo.env).
# .demo.env is git-ignored and holds APP_PASSWORD and PUBLIC_DEMO. Run: powershell -File start-demo.ps1
$dir = $PSScriptRoot
Get-Content (Join-Path $dir '.demo.env') | ForEach-Object { if ($_ -match '^(\w+)=(.*)$') { Set-Item "Env:$($Matches[1])" $Matches[2] } }
$env:PORT = '3000'
$old = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($old) { Stop-Process -Id $old.OwningProcess -Force }
Start-Process node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden
Write-Host 'Server running on http://localhost:3000 (editing needs the password in .demo.env)'
