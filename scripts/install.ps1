# Windows installer (no admin, no share): registers the manifest as a developer add-in for Word. Restart Word.
# Insert > My Add-ins > Developer Add-ins > Anonymiseur juridique
$ErrorActionPreference = "Stop"
$url = "https://github.com/A-N-O-D-E-R/legal-anonymiser-mvp/releases/latest/download/manifest.prod.xml"
$d = Join-Path $env:LOCALAPPDATA "Anonymiseur"
$k = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
New-Item -ItemType Directory -Force $d | Out-Null
New-Item -Force $k | Out-Null
$f = "$d\manifest.xml"
Invoke-WebRequest $url -OutFile $f -UseBasicParsing
$id = ([xml](Get-Content $f)).OfficeApp.Id
New-ItemProperty -Path $k -Name $id -Value $f -PropertyType String -Force | Out-Null
Write-Host "Done. Restart Word."
