@echo off
setlocal
cd /d "%~dp0"
echo Installing the Any Banana remote support agent (auto-start at login).
echo If Windows asks for Administrator, click Yes -- it is needed both for
echo auto-start to cover every Windows account AND for the required
echo Windows Defender exclusion (see banana-remote-agent.ps1's header for why
echo a legitimate remote-support script needs one).
echo.
echo This PC will get a persistent Device ID that other clinic PCs can use to
echo request a connection. Nothing happens without YOUR consent -- a native
echo Allow/Deny popup appears here on THIS PC every time someone tries to
echo connect, before anything is visible or controllable.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-banana-remote.ps1"
echo.
echo Exit code: %ERRORLEVEL%  (0 = installed OK)
pause
