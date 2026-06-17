@echo off
REM ============================================================
REM  Joyful Smile / Banana Clinic Manager - local dev server
REM  Serves this folder with caching DISABLED so the browser
REM  always loads the latest HTML/CSS/JS (no stale-cache issues).
REM ============================================================
cd /d "%~dp0"
echo.
echo Starting local server with caching disabled...
echo Open this URL in your browser:
echo.
echo     http://127.0.0.1:8123/index.html
echo.
echo Press Ctrl+C to stop the server.
echo.
npx --yes http-server -p 8123 -c-1 "%~dp0"
pause
