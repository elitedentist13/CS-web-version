@echo off
REM ============================================================
REM  Banana Clinic Manager - install silent Windows logon runner
REM  Adds a Startup shortcut that starts the local server and
REM  opens http://127.0.0.1:5500/index.html after sign-in.
REM ============================================================
cd /d "%~dp0"
echo.
echo Installing Banana silent autostart...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-banana-silent.ps1" -InstallStartup
echo.
echo To remove later, run uninstall-banana-autostart.bat
echo.
pause
