@echo off
setlocal
cd /d "%~dp0"
echo Running Trophy bridge self-test (quiet; dry_run only - no TW.exe popup)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -SelfTest
echo.
echo Exit code: %ERRORLEVEL%  (0 = all checks passed)
pause
