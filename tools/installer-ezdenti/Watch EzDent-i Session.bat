@echo off
title EzDent-i session observer
cd /d "%~dp0"
echo.
echo Starting EzDent-i session observer (15 minutes default)...
echo Captures go under _ezdenti_session_captures\ next to this folder's parent tools\,
echo or under %%TEMP%%\ezdenti_session_captures if that path is unavailable.
echo.
echo Click through EzDent-i from the DESKTOP icon while this runs:
echo   1. Quit EzDent-i if open
echo   2. Open from desktop shortcut
echo   3. Search patient / open chart
echo   4. Acquisition -^> Panorama -^> take OPG
echo   5. Press Ctrl+C here when finished
echo.
if exist "%~dp0_watch_ezdenti_session.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_watch_ezdenti_session.ps1" -DurationSec 900
) else if exist "%~dp0..\_watch_ezdenti_session.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\_watch_ezdenti_session.ps1" -DurationSec 900
) else (
  echo ERROR: _watch_ezdenti_session.ps1 not found next to this bat or in parent tools\.
  pause
  exit /b 1
)
echo.
pause
