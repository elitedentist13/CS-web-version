@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile EzDent-i (Vatech) X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs EzDent-i on port 17890.
echo If Apixia Digirex is also installed on this PC, the SAME bridge
echo will open Digirex too -- do NOT run Install Digirex Bridge.bat here.
echo It will never open NNT/NEWTOM, Carestream, or Ai-Dental.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "ezdenti" -InstallPath "C:\BananaBridge-EzDenti" -ShortcutName "Joyful Smile EzDent-i Bridge.lnk" -PackageFolder "installer-ezdenti"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
