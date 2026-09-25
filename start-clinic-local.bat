@echo off
REM Coordinate the three local loopback services (no overlapping ports):
REM   1) Clinic web UI              http://127.0.0.1:5500
REM   2) X-ray software launcher    http://127.0.0.1:17890/status
REM   3) X-ray AI helper            http://127.0.0.1:8877/health
REM Reserved: 8765 (RayView). Fallback clinic page: 8123 only if 5500 is down.
REM
REM   start-clinic-local.bat          auto-check, start anything that is down
REM   start-clinic-local.bat check    report only (exit 0 if all three are up)
setlocal EnableExtensions
cd /d "%~dp0"

if /I "%~1"=="check" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-clinic-stack.ps1" -StatusOnly
    set "ERR=%ERRORLEVEL%"
    echo.
    if "%ERR%"=="0" (echo All three local services are up.) else (echo One or more local services are down. Run start-clinic-local.bat with no arguments.)
    pause
    exit /b %ERR%
)

echo.
echo Starting missing pieces only. Healthy listeners are left alone.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-clinic-stack.ps1" -StartApp
echo.
echo Clinic page : http://127.0.0.1:5500/index.html  (or :8123 if Windows reserved 5500 - see "Clinic page" above)
echo X-ray software : http://127.0.0.1:17890/status
echo X-ray AI : http://127.0.0.1:8877/health
echo.
pause
endlocal
