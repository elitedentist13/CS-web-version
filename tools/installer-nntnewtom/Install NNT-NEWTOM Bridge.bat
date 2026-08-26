@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile NNT-NEWTOM X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs ONLY NNT-NEWTOM support -- it will never open EzDent-i,
echo Carestream, or Ai-Dental, even if this script somehow ends up on a PC
echo that also has one of those installed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "nntnewtom" -InstallPath "C:\NNT" -ShortcutName "Joyful Smile NNT-NEWTOM Bridge.lnk"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
