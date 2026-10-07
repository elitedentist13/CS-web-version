@echo off
REM Invoked by the csxrayai:// URL protocol from the web app.
REM   csxrayai://start          starts start-xray-ai.bat if 8877 is down
REM   csxrayai://job?id=<uuid>  runs that job against 127.0.0.1:8877
REM The URL holds "&", so it is only ever expanded inside quotes.
setlocal
cd /d "%~dp0"
if exist "%~dp0launch-xray-ai-protocol.ps1" (
    powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0launch-xray-ai-protocol.ps1" "%~1"
    exit /b %errorlevel%
)
call :FindStartBat
if not exist "%AI_BAT%" (
    echo [ERROR] start-xray-ai.bat was not found next to this launcher, in a parent folder, via xray-ai-home.txt, or via %%LOCALAPPDATA%%\cs-xray-ai\xray-ai-home.txt.
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
if exist "%~dp0xray-ai-home.txt" call :ReadAiHome "%~dp0xray-ai-home.txt"
if defined AI_HOME set "AI_BAT=%AI_HOME%\start-xray-ai.bat"
if exist "%AI_BAT%" exit /b 0
if exist "%LOCALAPPDATA%\cs-xray-ai\xray-ai-home.txt" call :ReadAiHome "%LOCALAPPDATA%\cs-xray-ai\xray-ai-home.txt"
if defined AI_HOME set "AI_BAT=%AI_HOME%\start-xray-ai.bat"
exit /b 0

:ReadAiHome
set /p AI_HOME=<"%~1"
exit /b 0
