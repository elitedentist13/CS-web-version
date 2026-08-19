@echo off
setlocal
cd /d "%~dp0"
echo Uninstalling the Joyful Smile EzDent-i X-Ray bridge.
echo If Windows asks for Administrator, click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -Uninstall -ShortcutName "Joyful Smile EzDent-i Bridge.lnk"
echo.
echo Exit code: %ERRORLEVEL%  (0 = uninstalled OK)
pause
