@echo off
setlocal
cd /d "%~dp0"
echo Uninstalling the Joyful Smile Carestream MCP X-Ray bridge.
echo If Windows asks for Administrator, click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-carestream-mcp.ps1" -Uninstall -InstallPath "C:\BananaBridge-Carestream-MCP"
echo.
echo Exit code: %ERRORLEVEL%  (0 = uninstalled OK)
pause
