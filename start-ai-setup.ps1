# Joyful Smile — one-click AI proxy + web server
# Double-click or: powershell -ExecutionPolicy Bypass -File start-ai-setup.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Tools = Join-Path $Root "tools"
$EnvFile = Join-Path $Tools ".env"

Write-Host ""
Write-Host "=== Joyful Smile AI setup ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $Tools "env.example") $EnvFile
    Write-Host "Created tools\.env — you must add your QWE_API key once." -ForegroundColor Yellow
    Write-Host "Opening Notepad now. Paste your sk-... key after QWE_API=" -ForegroundColor Yellow
    Write-Host "Save the file, close Notepad, then run this script again." -ForegroundColor Yellow
    Write-Host ""
    notepad $EnvFile
    exit 0
}

$envContent = Get-Content $EnvFile -Raw
if ($envContent -notmatch 'QWE_API=sk-[^\s#]+') {
    Write-Host "tools\.env still missing a real QWE_API=sk-... line." -ForegroundColor Red
    notepad $EnvFile
    exit 1
}

# Stop old listeners on our ports (ignore errors)
foreach ($port in 8787, 3000) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

Write-Host "Starting AI proxy on http://127.0.0.1:8787 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Tools'; node ai-local-proxy.mjs"
) -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host "Starting clinic app on http://127.0.0.1:3000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Tools'; node static-server.mjs"
) -WindowStyle Normal

Start-Sleep -Seconds 4

Write-Host ""
Write-Host "Opening browser ..." -ForegroundColor Green
Start-Process "http://127.0.0.1:3000"

Write-Host ""
Write-Host "Done. Keep BOTH black windows open (proxy + web server)." -ForegroundColor Cyan
Write-Host "Log in -> AI Helper -> Generate draft." -ForegroundColor Cyan
Write-Host "Proxy URL is auto-set to http://127.0.0.1:8787" -ForegroundColor Cyan
Write-Host ""
