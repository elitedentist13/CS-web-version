@echo off
REM ====================================================================
REM  One-time: register csxrayai:// so the web app "Run AI server" button
REM  can launch start-xray-ai.bat on this PC (no admin needed - HKCU).
REM
REM  Run this once per Windows user after copying the clinic app folder.
REM  The X-ray bridge updater also runs it with "nopause" after copying
REM  this file into the bridge folder. start-xray-ai.bat does not have
REM  to sit in that folder; the launcher finds it via xray-ai-home.txt.
REM  Then the lightbox "Run AI server" button works from the browser.
REM ====================================================================
setlocal
cd /d "%~dp0"

set "LAUNCHER=%~dp0launch-xray-ai-protocol.cmd"
if not exist "%LAUNCHER%" (
    echo [ERROR] launch-xray-ai-protocol.cmd not found next to this script.
    if /I not "%~1"=="nopause" pause
    exit /b 1
)
if not exist "%~dp0start-xray-ai.bat" (
    echo [WARN] start-xray-ai.bat is not in this folder.
    echo        csxrayai:// will still be registered.
    echo        The launcher starts the service from this folder, a parent folder,
    echo        or the folder recorded in xray-ai-home.txt.
    echo.
)

REM Registry command: "C:\...\launch-xray-ai-protocol.cmd" "%1"
reg add "HKCU\Software\Classes\csxrayai" /ve /d "URL:CS X-ray AI Protocol" /f >nul
reg add "HKCU\Software\Classes\csxrayai" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\csxrayai\DefaultIcon" /ve /d "%%SystemRoot%%\System32\cmd.exe,0" /f >nul
reg add "HKCU\Software\Classes\csxrayai\shell\open\command" /ve /d "\"%LAUNCHER%\" \"%%1\"" /f >nul
if errorlevel 1 (
    echo [ERROR] Could not write HKCU protocol registration.
    if /I not "%~1"=="nopause" pause
    exit /b 1
)

echo.
echo Registered protocol: csxrayai://
echo   csxrayai://start     starts the local AI service
echo   csxrayai://job?id=   runs one analysis on this PC
echo Launcher: %LAUNCHER%
echo.
echo The clinic page does not have to be opened from the local live server.
echo Analyze on this PC hands the radiograph to the local AI service.
echo Run xray_ai_jobs.sql once in the Supabase SQL editor if you have not.
echo.
if /I not "%~1"=="nopause" pause
endlocal
