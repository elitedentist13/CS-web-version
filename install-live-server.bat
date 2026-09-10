@echo off
REM ====================================================================
REM  install-live-server.bat -- Node.js / npm checker + installer for
REM  the Joyful Smile / Banana Clinic Manager static web app.
REM
REM  Why this exists: node_modules\ is never copied when the app folder
REM  is cloned/zipped onto another clinic PC (it's .gitignore'd and huge),
REM  so start-server.bat's "npx --no-install live-server" fails there
REM  until someone runs "npm install" once. This script checks for
REM  Node.js/npm, installs Node via winget if missing, then runs
REM  "npm install" so live-server/http-server land in node_modules --
REM  after that, start-server.bat / npm start work offline.
REM
REM  Usage:
REM    install-live-server.bat          check + install
REM    install-live-server.bat check    report only, install nothing
REM ====================================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "MODE=install"
if /I "%~1"=="check" set "MODE=check"

echo.
echo ============================================
echo   Banana Clinic Manager - live server setup
echo ============================================
echo.
echo   App folder : %CD%
echo.

call :FIND_NODE
if not defined NODE_EXE (
    echo   [MISS] Node.js / npm            not found on PATH or common install folders
    if /I "%MODE%"=="check" goto :SUMMARY
    echo.
    echo [1] Node.js not found. Trying winget install ^(LTS^) ...
    where winget >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] winget is not available on this PC.
        echo         Install Node.js LTS manually from https://nodejs.org/
        echo         then re-run this installer.
        pause
        exit /b 1
    )
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    call :FIND_NODE
    if not defined NODE_EXE (
        echo.
        echo [ERROR] Node.js may have just been installed, but this window's
        echo         PATH has not refreshed yet. Close this window, open a
        echo         NEW Command Prompt, and re-run install-live-server.bat.
        echo         If that still fails, install manually from https://nodejs.org/
        pause
        exit /b 1
    )
) else (
    echo   [OK]   Node.js / npm            %NODE_EXE%
)

for /f "delims=" %%V in ('"%NODE_EXE%" -v 2^>nul') do echo   [OK]   Node version              %%V

if /I "%MODE%"=="check" (
    if exist "node_modules\live-server\live-server.js" (
        echo   [OK]   live-server               node_modules\live-server present
    ) else (
        echo   [MISS] live-server               run "install-live-server.bat" ^(no "check"^) to install
    )
    goto :SUMMARY
)

echo.
echo [2] Installing project packages (live-server, http-server) ...
call npm install
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed - scroll up for the actual npm error.
    pause
    exit /b 1
)

if exist "node_modules\live-server\live-server.js" (
    echo   [OK]   live-server               installed
) else (
    echo   [MISS] live-server               still missing after npm install - see errors above
)

:SUMMARY
echo.
echo ============================================
echo   Done. Next steps:
echo     start-server.bat   ^(or: npm start^)
echo     http://127.0.0.1:5500/index.html
echo ============================================
echo.
pause
endlocal & exit /b 0

:FIND_NODE
set "NODE_EXE="
where node >nul 2>&1 && for /f "delims=" %%E in ('where node 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%E"
)
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
goto :eof
