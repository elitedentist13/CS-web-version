@echo off
REM ====================================================================
REM  Prepare this PC for panoramic, bitewing, and cephalometric AI.
REM
REM    1. install-xray-ai.bat              Python, packages, model files
REM    2. register-xray-ai-protocol.bat    csxrayai:// for the browser
REM    3. start-xray-ai.bat                only when port 8877 is down
REM
REM  start-xray-ai.bat replaces a service that is already listening, so
REM  this script leaves a healthy helper running.
REM  The X-ray tab "Prepare AI" button launches this with nopause.
REM ====================================================================
setlocal EnableExtensions
cd /d "%~dp0"
set "NOPAUSE="
if /I "%~1"=="nopause" set "NOPAUSE=1"

if not exist "%LOCALAPPDATA%\cs-xray-ai" mkdir "%LOCALAPPDATA%\cs-xray-ai"
set "STATUS=%LOCALAPPDATA%\cs-xray-ai\prepare-status.json"

echo.
echo ============================================
echo   Prepare AI
echo   1. install-xray-ai.bat
echo   2. register-xray-ai-protocol.bat
echo   3. start-xray-ai.bat
echo ============================================
echo.

set "INSTALL_ERR=1"
if not exist "%~dp0install-xray-ai.bat" goto :NoInstall
call "%~dp0install-xray-ai.bat" nopause
set "INSTALL_ERR=%ERRORLEVEL%"
goto :AfterInstall
:NoInstall
echo [ERROR] install-xray-ai.bat not found.
:AfterInstall

set "REG_ERR=1"
if not exist "%~dp0register-xray-ai-protocol.bat" goto :NoReg
call "%~dp0register-xray-ai-protocol.bat" nopause
set "REG_ERR=%ERRORLEVEL%"
goto :AfterReg
:NoReg
echo [ERROR] register-xray-ai-protocol.bat not found.
:AfterReg

set "SERVICE=down"
"%SystemRoot%\System32\curl.exe" -fsS -m 4 "http://127.0.0.1:8877/health" >nul 2>&1
if not errorlevel 1 goto :AlreadyUp
if not exist "%~dp0start-xray-ai.bat" goto :WriteStatus
echo Starting start-xray-ai.bat. Leave that window open.
start "CS X-ray AI" "%~dp0start-xray-ai.bat"
set "SERVICE=started"
goto :WriteStatus
:AlreadyUp
echo AI service already answering on port 8877. Left it running.
set "SERVICE=already"
:WriteStatus
> "%STATUS%" echo {"installExit":%INSTALL_ERR%,"registerExit":%REG_ERR%,"service":"%SERVICE%"}
echo.
echo Prepare status written to %STATUS%
echo.
if not defined NOPAUSE pause
endlocal & exit /b %INSTALL_ERR%
