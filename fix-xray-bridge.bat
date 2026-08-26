@echo off
setlocal
cd /d "%~dp0"
echo.
echo Fix X-Ray bridge for Banana (Carestream + Trophy + SCAN strip)
echo ==============================================================
echo.
echo This starts the CORRECT bridge on port 17891 with:
echo   - Carestream Patient.exe
echo   - Trophy TW.exe
echo   - SCAN photo strip (/nnt/scans)
echo.
echo (An old carestream-only bridge may still be on 17890 — Banana tries 17891 first.)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\ensure-xray-launcher.ps1"
echo.
echo Next: open http://127.0.0.1:5500/index.html and press Ctrl+F5
echo.
pause
