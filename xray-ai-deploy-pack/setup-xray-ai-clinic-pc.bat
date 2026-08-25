@echo off
REM ====================================================================
REM  One-time setup for THIS clinic PC to run X-ray Assist at full strength.
REM
REM  Assumes:
REM    - Python 3.10+ on PATH ("Add python.exe to PATH" ticked)
REM    - This folder contains start-xray-ai.bat + xray-ai-service\
REM
REM  What it does:
REM    1) Registers csxrayai:// so the web app "▶ Server" button can start AI
REM    2) Starts start-xray-ai.bat (creates venv, installs deps, downloads
REM       models on first run — internet needed once; leave window open)
REM ====================================================================
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   CS X-ray Assist  -  clinic PC setup
echo ============================================
echo.

if not exist "%~dp0start-xray-ai.bat" (
    echo [ERROR] start-xray-ai.bat not found in:
    echo   %~dp0
    echo Copy the full clinic app / deploy pack folder first.
    pause
    exit /b 1
)

echo [1/2] Registering browser protocol csxrayai:// ...
call "%~dp0register-xray-ai-protocol.bat" nopause
if errorlevel 1 (
    echo [WARN] Protocol registration failed — you can still double-click start-xray-ai.bat.
)

echo.
echo [2/2] Starting AI server (first run may take several minutes)...
echo       Leave the next window open while using X-ray Assist.
echo.
start "CS X-ray AI" "%~dp0start-xray-ai.bat"

echo.
echo Done. In the clinic app lightbox: click "▶ Server" (or wait for this
echo first boot), then "Analyze".
echo Health check: http://127.0.0.1:8877/health
echo.
pause
endlocal
