@echo off
REM ====================================================================
REM  Prepare this PC for panoramic, bitewing, and cephalometric AI.
REM
REM    1. install-xray-ai.bat              Python, packages, every model file
REM    2. register-xray-ai-protocol.bat    csxrayai:// for the browser
REM    3. start-xray-ai.bat                when Ceph UNet or CVM is not live
REM
REM  A process that only answers /health is not enough. Auto landmarks
REM  and Auto CVM have to be loaded too. start-xray-ai.bat replaces the
REM  listener on 8877, so this script restarts when either model is absent.
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
set "LMJSON=%TEMP%\cs-prepare-lm.json"
set "CVMJSON=%TEMP%\cs-prepare-cvm.json"
"%SystemRoot%\System32\curl.exe" -fsS -m 8 -o "%LMJSON%" "http://127.0.0.1:8877/ceph/landmarks"
if errorlevel 1 goto :NeedStart
"%SystemRoot%\System32\curl.exe" -fsS -m 8 -o "%CVMJSON%" "http://127.0.0.1:8877/ceph/cvm"
if errorlevel 1 goto :NeedStart
REM Match "unet":true and "unet": true. A health check alone is not enough.
findstr /R /C:"unet.: *true" "%LMJSON%" >nul
if errorlevel 1 goto :NeedStart
findstr /R /C:"classifier.: *true" "%CVMJSON%" >nul
if errorlevel 1 goto :NeedStart
goto :AlreadyUp
:NeedStart
if not exist "%~dp0start-xray-ai.bat" goto :WriteStatus
echo Ceph auto-landmarks or Ceph CVM is not live on port 8877.
echo Starting start-xray-ai.bat so every model is installed and loaded.
echo Leave that window open.
start "CS X-ray AI" "%~dp0start-xray-ai.bat"
set "SERVICE=started"
goto :WriteStatus
:AlreadyUp
echo AI service already has Ceph auto-landmarks and Ceph CVM. Left it running.
set "SERVICE=already"
:WriteStatus
> "%STATUS%" echo {"installExit":%INSTALL_ERR%,"registerExit":%REG_ERR%,"service":"%SERVICE%"}
echo.
echo Prepare status written to %STATUS%
echo.
if not defined NOPAUSE pause
endlocal & exit /b %INSTALL_ERR%
