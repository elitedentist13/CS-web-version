@echo off
REM Invoked by the csxrayai:// URL protocol from the web app.
REM   csxrayai://start          starts start-xray-ai.bat
REM   csxrayai://job?id=<uuid>  runs that job against 127.0.0.1:8877
setlocal
cd /d "%~dp0"
set "URL=%~1"
echo %URL% | findstr /I "://job" >nul
if not errorlevel 1 (
    if not exist "%~dp0launch-xray-ai-protocol.ps1" (
        echo [ERROR] launch-xray-ai-protocol.ps1 missing in %~dp0
        exit /b 1
    )
    powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0launch-xray-ai-protocol.ps1" "%URL%"
    exit /b %errorlevel%
)
call :FindStartBat
if not exist "%AI_BAT%" (
    echo [ERROR] start-xray-ai.bat was not found next to this launcher, in a parent folder, or via xray-ai-home.txt.
    pause
    exit /b 1
)
start "CS X-ray AI" "%AI_BAT%"
endlocal
exit /b 0

:FindStartBat
set "AI_BAT=%~dp0start-xray-ai.bat"
if exist "%AI_BAT%" exit /b 0
if exist "%~dp0..\start-xray-ai.bat" (
    set "AI_BAT=%~dp0..\start-xray-ai.bat"
    exit /b 0
)
if exist "%~dp0..\..\start-xray-ai.bat" (
    set "AI_BAT=%~dp0..\..\start-xray-ai.bat"
    exit /b 0
)
if exist "%~dp0xray-ai-home.txt" call :ReadAiHome
if defined AI_HOME set "AI_BAT=%AI_HOME%\start-xray-ai.bat"
exit /b 0

:ReadAiHome
set /p AI_HOME=<"%~dp0xray-ai-home.txt"
exit /b 0
