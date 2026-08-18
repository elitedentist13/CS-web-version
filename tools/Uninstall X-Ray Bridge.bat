@echo off
setlocal
cd /d "%~dp0"
echo Removing Joyful Smile X-Ray bridge auto-start and stopping it...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -Uninstall
echo.
pause
