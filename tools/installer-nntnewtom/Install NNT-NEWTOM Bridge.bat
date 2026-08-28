@echo off
setlocal
cd /d "%~dp0"
echo Installing / updating the Joyful Smile CEFLA X-Ray bridge (NNT/NewTom + MyRay).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo One bridge on port 17890 serves BOTH NewTom and MyRay (same CEFLA
echo stack). It does not install a second launcher that would clash.
echo.
echo Also registers auto-update: every 6 hours the PC checks
echo   https://elitedentist13.github.io/CS-web-version/tools/installer-nntnewtom/
echo and safely applies newer bridge files (self-test + backup + rollback).
echo Manual check anytime: "Check NNT-NEWTOM Updates.bat"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "nntnewtom,myray" -InstallPath "C:\NNT" -ShortcutName "Joyful Smile NNT-NEWTOM Bridge.lnk" -PackageFolder "installer-nntnewtom" -UpdateCheckIntervalHours 6
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause