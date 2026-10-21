@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile Trophy (TW.exe) X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs ONLY Trophy / CS Imaging TW.exe support.
echo It will not open Carestream Patient Browser, NNT, Rayscan, or EzDent-i.
echo PCs that need both Carestream and Trophy should use the Carestream MCP
echo installer instead. Do not install both packages on the same PC.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-trophy.ps1"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
