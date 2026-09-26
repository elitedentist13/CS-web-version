# Rebuilds docs\xray-helper-manual.pdf from docs\xray-helper-manual.html (English / Traditional / Simplified Chinese).
# Run after editing docs\xray-helper-manual.js:  powershell -ExecutionPolicy Bypass -File tools\build-manual-pdf.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'docs\xray-helper-manual.html'
$out = Join-Path $root 'docs\xray-helper-manual.pdf'

$browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$exe = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $exe) { throw 'Chrome or Edge not found.' }

$url = 'file:///' + ($src -replace '\\', '/')
$pdfProfile = Join-Path $env:TEMP 'banana-manual-pdf-profile'
$before = if (Test-Path $out) { (Get-Item $out).LastWriteTime } else { [datetime]::MinValue }

# A separate profile lets this run while the clinic's normal Chrome window is open.
Start-Process -FilePath $exe -Wait -WindowStyle Hidden -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=3000',
    "`"--user-data-dir=$pdfProfile`"", "`"--print-to-pdf=$out`"", "`"$url`""
)

if (-not (Test-Path $out) -or (Get-Item $out).LastWriteTime -le $before) { throw 'PDF was not written.' }
$kb = [math]::Round((Get-Item $out).Length / 1KB)
Write-Host "OK  $out  ($kb KB)"
