@echo off
setlocal
cd /d "%~dp0"
echo Starting Joyful Smile EzDent-i local launcher (EzDent-i only)...
echo.
echo Keep this window open while using desktop X-ray links.
echo Browser bridge: http://127.0.0.1:17890/status
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -EnabledSystems "ezdenti"
echo.
echo Launcher stopped. Press any key to close.
pause >nul
