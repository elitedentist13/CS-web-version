@echo off
setlocal
cd /d "%~dp0"
echo Starting Joyful Smile CEFLA local launcher (MyRay + NNT/NewTom).
echo Digirex sidecar is included if digirex.exe is on this PC.
echo.
echo Keep this window open while using desktop X-ray links.
echo Browser bridge: http://127.0.0.1:17890/status
echo.
echo If a bridge is already running on 17890, this window will exit
echo without fighting it — use the existing bridge (re-install if it
echo was an older myray-only / nnt-only exclusive install).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -EnabledSystems "nntnewtom,myray"
echo.
echo Launcher stopped. Press any key to close.
pause >nul
