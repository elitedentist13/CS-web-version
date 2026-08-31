@echo off
setlocal
cd /d "%~dp0"
echo Installing the Joyful Smile Digirex (Apixia) X-Ray bridge (auto-start at login).
echo If Windows asks for Administrator, click Yes so auto-start
echo works for every Windows account on this PC, not just this one.
echo.
echo This installs ONLY Digirex support -- it will never open EzDent-i,
echo MyRay, NNT/NEWTOM, Carestream, or Rayscan.
echo.
echo If this PC ALREADY has the EzDent-i or MyRay bridge on port 17890,
echo cancel and update THAT installer instead (Digirex is a sidecar).
echo Do not install two bridges on the same PC.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-xray-bridge.ps1" -EnabledSystems "digirex" -InstallPath "C:\BananaBridge-Digirex" -ShortcutName "Joyful Smile Digirex Bridge.lnk" -PackageFolder "installer-digirex"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
