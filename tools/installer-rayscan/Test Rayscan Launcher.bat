@echo off
setlocal
cd /d "%~dp0"
echo Running Rayscan bridge self-test (quiet; dry_run only — no RAYBridge/SMARTDent popup)...
echo Tip: pass -IncludeLiveLaunch only when you intentionally want visible app launches.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0xray-local-launcher.ps1" -SelfTest
echo.
echo Exit code: %ERRORLEVEL%  (0 = all checks passed)
pause
