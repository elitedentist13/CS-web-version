@echo off
REM Invoked by the csxrayai:// URL protocol from the web app.
REM Ignores the URL argument and starts the normal AI service launcher
REM in a new console window (venv / models / uvicorn on port 8877).
setlocal
cd /d "%~dp0"
if not exist "%~dp0start-xray-ai.bat" (
    echo [ERROR] start-xray-ai.bat missing in %~dp0
    pause
    exit /b 1
)
start "CS X-ray AI" "%~dp0start-xray-ai.bat"
endlocal
