@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile Rayscan (RAYBridge / SMARTDent V3) X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs ONLY Rayscan support -- it will never open NNT/NEWTOM,
echo EzDent-i, Carestream, or Ai-Dental, even if this script somehow ends up
echo on a PC that also has one of those installed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "rayscan" -InstallPath "C:\BananaBridge-Rayscan" -ShortcutName "Joyful Smile Rayscan Bridge.lnk"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
