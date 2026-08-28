@echo off
setlocal
cd /d "%~dp0"
echo Installing / updating the Joyful Smile CEFLA X-Ray bridge (MyRay + NNT/NewTom).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This UPDATES the shared bridge at C:\NNT (same install as NewTom).
echo It enables BOTH myray and nntnewtom on port 17890 — it does NOT
echo install a second rival launcher that would clash with the others.
echo.
echo Also registers auto-update: every 6 hours the PC checks
echo   https://elitedentist13.github.io/CS-web-version/tools/installer-myray/
echo and safely applies newer bridge files (self-test + backup + rollback).
echo Manual check anytime: "Check MyRay Updates.bat"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "nntnewtom,myray" -InstallPath "C:\NNT" -ShortcutName "Joyful Smile NNT-NEWTOM Bridge.lnk" -PackageFolder "installer-myray" -UpdateCheckIntervalHours 6
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
