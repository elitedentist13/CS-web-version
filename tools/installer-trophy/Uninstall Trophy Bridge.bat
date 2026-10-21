@echo off
setlocal
cd /d "%~dp0"
echo Uninstalling the Joyful Smile Trophy X-Ray bridge.
echo If Windows asks for Administrator, click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-trophy.ps1" -Uninstall -InstallPath "C:\BananaBridge-Trophy"
echo.
echo Exit code: %ERRORLEVEL%  (0 = uninstalled OK)
pause
