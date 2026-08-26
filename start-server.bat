@echo off
REM ============================================================
REM  Joyful Smile / Banana Clinic Manager - local live server
REM  Prefers live-server (auto-reload). Falls back to http-server.
REM ============================================================
cd /d "%~dp0"
echo.
echo Starting local live server...
echo Open this URL in your browser:
echo.
echo     http://127.0.0.1:5500/index.html
echo.
echo Press Ctrl+C to stop the server.
echo.
if exist "node_modules\live-server\live-server.js" (
  call npm start
) else (
  where npm >nul 2>&1
  if errorlevel 1 (
    echo npm not found — using PowerShell static server on port 5500.
    echo Run "npm install" once if you want live-reload via live-server.
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve-static.ps1" -Port 5500
  ) else (
    echo live-server not found — using http-server fallback.
    echo Run "npm install" once to enable auto-reload.
    echo.
    npx --yes http-server -p 5500 -c-1 "%~dp0"
  )
)
pause
