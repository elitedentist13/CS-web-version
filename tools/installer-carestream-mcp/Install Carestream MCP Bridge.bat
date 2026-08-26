@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile Carestream MCP X-Ray bridge.
echo.
echo This ONE installer works on BOTH:
echo   - X-ray SERVER / MCP PCs  (e.g. XRAY-MCP, Dr-1-MCP) with TW.exe + RECEPTION_MCP SCAN
echo   - Consultation CLIENT PCs (e.g. DOCTOR-1) with Patient.exe + CSMAIN SCAN share
echo.
echo The installer auto-detects reachable SCAN shares and Carestream apps,
echo then writes xray-launcher-config.ps1 and xray-pc-config.js for THIS PC.
echo.
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-carestream-mcp.ps1" -InstallPath "C:\BananaBridge-Carestream-MCP"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
