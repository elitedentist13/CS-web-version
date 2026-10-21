@echo off
title Carestream / Clinic Solution session observer
cd /d "%~dp0"
echo.
echo Starting Carestream session observer (20 minutes default)...
echo Captures go under tools\_carestream_session_captures\
echo.
echo Click through Clinic Solution while this runs (NOT Banana):
echo   1. Open Clinic Solution (CS.exe) if needed
echo   2. Patient WITH existing Carestream films -^> Carestream / Trophy / F7
echo   3. Patient with NO films (or new chart) -^> same Carestream button
echo   4. Optionally take a NEW x-ray in Trophy / CS Imaging
echo   5. Press Ctrl+C here when finished
echo.
echo Reference handoff (Clinic Solution on XRAY-MCP):
echo   TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{chart} -N{name} -F{name}
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_watch_carestream_session.ps1" -DurationSec 1200
echo.
pause
