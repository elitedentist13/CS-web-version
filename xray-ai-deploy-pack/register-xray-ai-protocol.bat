@echo off
REM ====================================================================
REM  One-time: register csxrayai:// so the web app "Run AI server" button
REM  can launch start-xray-ai.bat on this PC (no admin needed — HKCU).
REM
REM  Run this once per Windows user after copying the clinic app folder.
REM  Then the lightbox "Run AI server" button works from the browser.
REM ====================================================================
setlocal
cd /d "%~dp0"

set "LAUNCHER=%~dp0launch-xray-ai-protocol.cmd"
if not exist "%LAUNCHER%" (
    echo [ERROR] launch-xray-ai-protocol.cmd not found next to this script.
    pause
    exit /b 1
)
if not exist "%~dp0start-xray-ai.bat" (
    echo [ERROR] start-xray-ai.bat not found next to this script.
    pause
    exit /b 1
)

REM Registry command: "C:\...\launch-xray-ai-protocol.cmd" "%1"
reg add "HKCU\Software\Classes\csxrayai" /ve /d "URL:CS X-ray AI Protocol" /f >nul
reg add "HKCU\Software\Classes\csxrayai" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\csxrayai\DefaultIcon" /ve /d "%%SystemRoot%%\System32\cmd.exe,0" /f >nul
reg add "HKCU\Software\Classes\csxrayai\shell\open\command" /ve /d "\"%LAUNCHER%\" \"%%1\"" /f >nul
if errorlevel 1 (
    echo [ERROR] Could not write HKCU protocol registration.
    pause
    exit /b 1
)

echo.
echo Registered protocol: csxrayai://start
echo Launcher: %LAUNCHER%
echo.
echo Next: open the clinic app, open an X-ray, click Server (play button).
echo.
if /I not "%~1"=="nopause" pause
endlocal
