@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile Carestream MCP X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs ONLY Carestream + Trophy (TW.exe) support for this MCP --
echo CS Imaging Patient.exe and Clinic Solution Trophy F7 handoff.
echo It will not open NNT, Rayscan, EzDent-i, or Ai-Dental.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -InstallPath "C:\BananaBridge-Carestream-MCP" -ShortcutName "Joyful Smile Carestream MCP Bridge.lnk"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
