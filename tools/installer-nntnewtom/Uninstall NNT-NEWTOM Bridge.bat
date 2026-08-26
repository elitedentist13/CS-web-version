@echo off
setlocal
cd /d "%~dp0"
echo Uninstalling the Joyful Smile NNT-NEWTOM X-Ray bridge.
echo If Windows asks for Administrator, click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -Uninstall -ShortcutName "Joyful Smile NNT-NEWTOM Bridge.lnk"
echo.
echo Exit code: %ERRORLEVEL%  (0 = uninstalled OK)
pause
