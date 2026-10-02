# Builds dist/IntegrationReliability-portable (+ .zip): runs on any Windows PC with no install.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out  = Join-Path $root 'dist\IntegrationReliability-portable'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null

Copy-Item (Get-Command node).Source (Join-Path $out 'node.exe')
foreach ($p in 'server.js','checks.json','package.json','lib','public') {
  Copy-Item (Join-Path $root $p) $out -Recurse
}

@'
@echo off
cd /d "%~dp0"
echo Integration Reliability - close this window to stop.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node.exe server.js
pause
'@ | Set-Content (Join-Path $out 'Start.bat') -Encoding ASCII

@'
Integration Reliability (portable)
1. Double-click Start.bat  -> dashboard opens at http://localhost:3000
2. Edit checks.json to change the checks (restart to apply).
3. Phone on the same Wi-Fi: use http://<this-PC-IP>:3000 in the Android app.
Results are saved in the data folder next to this file.
'@ | Set-Content (Join-Path $out 'README.txt') -Encoding ASCII

$zip = "$out.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $out -DestinationPath $zip
"Built: $out"
"Zip:   $zip ({0:N1} MB)" -f ((Get-Item $zip).Length / 1MB)
