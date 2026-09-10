@echo off
REM ====================================================================
REM  install-clinic-pc.bat -- one-click setup for a brand new clinic PC
REM
REM  Runs, in order:
REM    1) install-live-server.bat   (Node.js/npm + live-server for the
REM                                  static web app on port 5500)
REM    2) install-xray-ai.bat start (Python + X-ray Assist AI service on
REM                                  port 8877, plus the csxrayai:// protocol)
REM
REM  Safe to re-run any time -- both installers skip work that is
REM  already done and only report status.
REM ====================================================================
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ############################################################
echo   Banana Clinic Manager - full clinic PC setup
echo ############################################################
echo.

echo ==== Step 1 of 2: web app / live server =====================
call "%~dp0install-live-server.bat" %*
set "ERR1=%ERRORLEVEL%"

echo.
echo ==== Step 2 of 2: X-ray Assist AI service ====================
call "%~dp0install-xray-ai.bat" start
set "ERR2=%ERRORLEVEL%"

echo.
echo ############################################################
echo   Setup summary
echo ############################################################
if "%ERR1%"=="0" (
    echo   [OK]   Web app / live server
) else (
    echo   [FAIL] Web app / live server  ^(exit %ERR1%^) - see Step 1 output above
)
if "%ERR2%"=="0" (
    echo   [OK]   X-ray Assist AI service
) else (
    echo   [FAIL] X-ray Assist AI service ^(exit %ERR2%^) - see Step 2 output above
)
echo.
echo   Clinic app : http://127.0.0.1:5500/index.html
echo   AI health  : http://127.0.0.1:8877/health
echo.
echo Day-to-day, staff only need to double-click start-server.bat.
echo Everything below that is already installed and cached.
echo.
pause
endlocal & exit /b 0
