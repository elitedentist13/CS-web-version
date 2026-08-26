@echo off
setlocal
cd /d "%~dp0"
echo Installing Joyful Smile X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
