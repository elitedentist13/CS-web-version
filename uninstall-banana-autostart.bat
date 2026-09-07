@echo off
REM ============================================================
REM  Banana Clinic Manager - remove silent Windows logon runner
REM ============================================================
cd /d "%~dp0"
echo.
echo Removing Banana silent autostart...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-banana-silent.ps1" -UninstallStartup
echo.
pause
