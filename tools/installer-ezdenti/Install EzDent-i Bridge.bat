@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile EzDent-i (Vatech) X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs ONLY EzDent-i support -- it will never open NNT/NEWTOM,
echo Carestream, or Ai-Dental, even if this script somehow ends up on a PC
echo that also has one of those installed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "ezdenti" -InstallPath "C:\BananaBridge-EzDenti" -ShortcutName "Joyful Smile EzDent-i Bridge.lnk" -PackageFolder "installer-ezdenti"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
