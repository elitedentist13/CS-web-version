@echo off
setlocal
cd /d "%~dp0"
echo Running Digirex bridge self-test (no listener started, nothing launched)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -SelfTest
echo.
echo Exit code: %ERRORLEVEL%  (0 = all checks passed)
pause
