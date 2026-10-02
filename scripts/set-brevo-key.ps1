# Replaces BREVO_API_KEY in .demo.env without ever showing the key on screen.
# Usage: powershell -File scripts\set-brevo-key.ps1
# (-EnvFile and -Value exist only so the script can be tested without typing.)
param(
  [string]$EnvFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.demo.env'),
  [string]$Value
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $EnvFile)) { throw "Settings file not found: $EnvFile" }

if (-not $Value) {
  $secure = Read-Host 'Paste the NEW Brevo API key (nothing will show as you paste), then press Enter' -AsSecureString
  $Value = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
$Value = $Value.Trim()
if ($Value.Length -lt 30 -or $Value -match '\s') { throw 'That does not look like a Brevo key (too short, or it contains spaces). Nothing was changed.' }
if (-not $Value.StartsWith('xkeysib-')) { Write-Warning 'Brevo keys normally start with "xkeysib-". Check that you copied the whole key.' }

$lines = Get-Content $EnvFile
$old = ($lines | Where-Object { $_ -match '^BREVO_API_KEY=' } | Select-Object -First 1)
if ($old -and $old.Substring('BREVO_API_KEY='.Length) -eq $Value) { throw 'That is the SAME key as before. Create a NEW key in Brevo (after deleting the old one) and paste that.' }

$kept = $lines | Where-Object { $_ -notmatch '^BREVO_API_KEY=' }
Set-Content $EnvFile ($kept + "BREVO_API_KEY=$Value")
Write-Host "Done: BREVO_API_KEY updated ($($Value.Length) characters). The key was not displayed anywhere."
