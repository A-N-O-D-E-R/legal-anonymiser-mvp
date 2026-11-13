# Windows installer (no admin, no share): downloads the release manifest, VERIFIES it (RSA-3072/SHA-256 signature over
# SHA256SUMS, then the manifest's hash), then registers it as a developer add-in for Word. Restart Word.
# Insert > My Add-ins > Developer Add-ins > Anonymiseur juridique
# Usage: .\install.ps1 [-Tag vX.Y.Z]   (default: latest release; pin a tag to avoid silent upgrades)
param([string]$Tag = "latest")
$ErrorActionPreference = "Stop"
$repo = "A-N-O-D-E-R/legal-anonymiser-mvp"
# Release public key (RSA XML), pinned in this script (written by scripts/keygen.mjs).
$pub = '__RELEASE_PUBKEY__'
function Die($m) { throw "REFUSING TO INSTALL: $m" }
if ($pub -notlike "<RSAKeyValue>*") { Die "no release signing key is pinned in this script" }

$base = if ($Tag -eq "latest") { "https://github.com/$repo/releases/latest/download" } else { "https://github.com/$repo/releases/download/$Tag" }
$t = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory $t | Out-Null
try {
  foreach ($n in "SHA256SUMS", "SHA256SUMS.sig", "manifest.prod.xml") { Invoke-WebRequest "$base/$n" -OutFile "$t\$n" -UseBasicParsing }
  $rsa = [Security.Cryptography.RSA]::Create(); $rsa.FromXmlString($pub)
  $sums = [IO.File]::ReadAllBytes("$t\SHA256SUMS"); $sig = [IO.File]::ReadAllBytes("$t\SHA256SUMS.sig")
  if (-not $rsa.VerifyData($sums, $sig, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)) { Die "bad signature on SHA256SUMS" }
  $want = (Get-Content "$t\SHA256SUMS" | Where-Object { $_ -match '\smanifest\.prod\.xml$' } | ForEach-Object { ($_ -split '\s+')[0] })
  $got = (Get-FileHash -Algorithm SHA256 "$t\manifest.prod.xml").Hash
  if (-not $want -or $want -ine $got) { Die "manifest.prod.xml hash does not match the signed SHA256SUMS" }

  $d = Join-Path $env:LOCALAPPDATA "Anonymiseur"
  $k = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
  New-Item -ItemType Directory -Force $d | Out-Null
  New-Item -Force $k | Out-Null
  $f = "$d\manifest.xml"
  Copy-Item "$t\manifest.prod.xml" $f -Force
  $id = ([xml](Get-Content $f)).OfficeApp.Id
  New-ItemProperty -Path $k -Name $id -Value $f -PropertyType String -Force | Out-Null
  Write-Host "Signature and hash verified ($Tag). Done. Restart Word."
} finally { Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue }
