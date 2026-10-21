@echo off
setlocal
cd /d "%~dp0"
echo Starting Joyful Smile Trophy local launcher (TW.exe only)...
echo.
echo Keep this window open while using desktop X-ray links.
echo Browser bridge: http://127.0.0.1:17890/status
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -Port 17890 -EnabledSystems "trophy"
echo.
echo Launcher stopped. Press any key to close.
pause >nul
