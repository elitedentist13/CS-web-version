@echo off
title EzDent-i session observer
cd /d "%~dp0"
echo.
echo Starting EzDent-i session observer (15 minutes default)...
echo Captures go under tools\_ezdenti_session_captures\
echo.
echo Click through EzDent-i from the DESKTOP icon while this runs:
echo   1. Quit EzDent-i if open
echo   2. Open from desktop shortcut
echo   3. Search patient / open chart
echo   4. Acquisition -^> Panorama -^> take OPG
echo   5. Press Ctrl+C here when finished
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_watch_ezdenti_session.ps1" -DurationSec 900
echo.
pause
