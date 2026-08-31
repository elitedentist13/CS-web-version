@echo off
setlocal
cd /d "%~dp0"
echo Starting Joyful Smile Digirex local launcher (Digirex only)...
echo.
echo Keep this window open while using desktop X-ray links.
echo Browser bridge: http://127.0.0.1:17890/status
echo.
echo If a bridge is already running on 17890 (EzDent-i or MyRay),
echo this window will exit without fighting it -- use the existing
echo bridge after it has the updated xray-local-launcher.ps1.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -EnabledSystems "digirex"
echo.
echo Launcher stopped. Press any key to close.
pause >nul
