@echo off
REM ============================================================
REM  Joyful Smile / Banana Clinic Manager - live reload server
REM  Auto-opens the browser and refreshes on HTML/CSS/JS changes.
REM ============================================================
cd /d "%~dp0"
echo.
echo Starting live-server (auto-reload)...
echo.
echo     http://127.0.0.1:5500/index.html
echo.
echo Press Ctrl+C to stop.
echo.
call npm start
pause
