@echo off
setlocal
cd /d "%~dp0"
echo.
echo Testing the Joyful Smile Carestream MCP X-Ray bridge...
echo This verifies the script works before installing it.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -SelfTest
echo.
if %ERRORLEVEL% EQU 0 (
    echo Test PASSED - ready to install!
) else (
    echo Test FAILED - check the errors above
)
echo.
pause
