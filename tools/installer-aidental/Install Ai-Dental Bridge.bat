@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile Ai-Dental (Woodpecker i-Sensor) X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs ONLY Ai-Dental support -- it will never open NNT/NEWTOM,
echo EzDent-i, Carestream, Rayscan, or Digirex, even if this script somehow
echo ends up on a PC that also has one of those installed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "aidental" -InstallPath "C:\BananaBridge-AiDental" -ShortcutName "Joyful Smile Ai-Dental Bridge.lnk" -PackageFolder "installer-aidental"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
