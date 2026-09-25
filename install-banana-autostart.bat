@echo off
REM ============================================================
REM  Banana Clinic Manager - install silent Windows logon runner
REM  Adds a Startup shortcut that, after sign-in, runs
REM  start-banana-silent.ps1 hidden:
REM    - clinic web UI on :5500 (or :8123 if Windows reserved 5500)
REM    - tools\ensure-clinic-stack.ps1 -Logon: X-ray launcher :17890,
REM      X-ray AI :8877 (only if already installed)
REM    - opens the clinic page in the browser.
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
