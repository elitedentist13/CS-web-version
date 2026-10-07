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
REM Remember the clinic folder that actually contains the AI service.
REM A later csxrayai:// registration from the X-ray bridge folder does not
REM contain start-xray-ai.bat; the handler reads this path and still starts it.
REM Do not overwrite that record when this copy has no service launcher.
if exist "%~dp0start-xray-ai.bat" (
    call :WriteAiHome
) else (
    echo [WARN] start-xray-ai.bat is not in this folder.
    echo        csxrayai:// will still be registered.
    echo        The launcher starts the service from this folder, a parent folder,
    echo        xray-ai-home.txt, or %%LOCALAPPDATA%%\cs-xray-ai\xray-ai-home.txt.
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
echo Local live page: http://127.0.0.1:5500/index.html
echo GitHub site and that page both reach this PC through csxrayai://.
echo The browser does not call port 8877 itself.
echo Run xray_ai_jobs.sql once in the Supabase SQL editor if you have not.
echo.
if /I not "%~1"=="nopause" pause
endlocal
exit /b 0

:WriteAiHome
set "AI_HOME_DIR=%~dp0"
if not exist "%LOCALAPPDATA%\cs-xray-ai" mkdir "%LOCALAPPDATA%\cs-xray-ai"
>"%LOCALAPPDATA%\cs-xray-ai\xray-ai-home.txt" echo %AI_HOME_DIR%
exit /b 0
