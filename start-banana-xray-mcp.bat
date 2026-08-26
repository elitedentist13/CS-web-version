@echo off
setlocal
cd /d "%~dp0"
title Banana + X-Ray Bridge (XRAY-MCP)
echo.
echo ============================================================
echo  Banana Clinic Manager + Carestream Trophy bridge
echo ============================================================
echo.
echo  1. Starting X-Ray launcher (port 17890) if not already running...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-xray-launcher.ps1"
echo.
echo  2. Starting web app on http://127.0.0.1:5500/index.html
echo     IMPORTANT: use 127.0.0.1 in Chrome (not file:// or GitHub Pages)
echo.
start "" "http://127.0.0.1:5500/index.html"
where npm >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve-static.ps1" -Port 5500
) else if exist "node_modules\live-server\live-server.js" (
  call npm start
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve-static.ps1" -Port 5500
)
