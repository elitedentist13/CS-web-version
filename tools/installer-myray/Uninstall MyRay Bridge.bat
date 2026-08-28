@echo off
setlocal
cd /d "%~dp0"
echo Removing the Joyful Smile CEFLA bridge auto-start shortcut
echo and the auto-update Scheduled Task
echo (shared with NNT/NewTom: "Joyful Smile NNT-NEWTOM Bridge.lnk").
echo.
echo NOTE: This does NOT delete C:\NNT bridge files. To restore NNT-only
echo auto-start afterwards, re-run installer-nntnewtom\Install *.bat.
echo If Windows asks for Administrator, click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -Uninstall -ShortcutName "Joyful Smile NNT-NEWTOM Bridge.lnk" -PackageFolder "installer-myray"
echo.
echo Exit code: %ERRORLEVEL%  (0 = uninstalled OK)
pause
