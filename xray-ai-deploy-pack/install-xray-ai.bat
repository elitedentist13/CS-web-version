@echo off
REM ====================================================================
REM  CS X-ray Assist — clinic installer
REM
REM  Checks this PC, lists every piece the local AI helper needs, then
REM  downloads anything missing:
REM    - Python 3.10+  (never BioTime 3.7)
REM    - venv under %LOCALAPPDATA%\cs-xray-ai
REM    - pip packages (torch CPU, onnxruntime, transformers, ultralytics)
REM    - Hugging Face tooth ONNX + condition weights
REM    - csxrayai:// protocol for the lightbox Server button
REM
REM  Default install / app folder:
REM    C:\banana\CS-web-version-main
REM
REM  Usage:
REM    install-xray-ai.bat           check + install that folder
REM    install-xray-ai.bat check     report only
REM    install-xray-ai.bat start     install + start AI (8877) and app (8123)
REM    install-xray-ai.bat D:\other  use another clinic folder
REM ====================================================================
setlocal EnableExtensions

set "INSTALL_ROOT=C:\banana\CS-web-version-main"
set "MODE="
if /I "%~1"=="check" set "MODE=--check"
if /I "%~1"=="start" set "MODE=--start"
if not "%~1"=="" if /I not "%~1"=="check" if /I not "%~1"=="start" (
    if exist "%~1\xray-ai-service\install_xray_ai.py" set "INSTALL_ROOT=%~1"
    if /I "%~2"=="check" set "MODE=--check"
    if /I "%~2"=="start" set "MODE=--start"
)

if not exist "%INSTALL_ROOT%\xray-ai-service\install_xray_ai.py" (
    if exist "%~dp0xray-ai-service\install_xray_ai.py" set "INSTALL_ROOT=%~dp0"
)

cd /d "%INSTALL_ROOT%"

set "AI_HOME=%LOCALAPPDATA%\cs-xray-ai"
set "MODEL_CACHE_DIR=%AI_HOME%\model_cache"
set "HF_HUB_DISABLE_SYMLINKS=1"
set "SCRIPT=%INSTALL_ROOT%\xray-ai-service\install_xray_ai.py"

echo.
echo ============================================
echo   CS X-ray Assist  -  installer
echo ============================================
echo.
echo   Install path : %INSTALL_ROOT%
echo   AI home      : %AI_HOME%
echo.

if not exist "%SCRIPT%" (
    echo [ERROR] Missing %SCRIPT%
    echo         Expected the clinic app at C:\banana\CS-web-version-main
    echo         ^(with xray-ai-service\install_xray_ai.py inside^).
    pause
    exit /b 1
)

REM ---- locate Python 3.10+ (never trust PATH `python` first) ----------
set "PY_CMD="
for %%P in (
    "%LocalAppData%\Programs\Python\Python312\python.exe"
    "%LocalAppData%\Programs\Python\Python313\python.exe"
    "%LocalAppData%\Programs\Python\Python311\python.exe"
    "%LocalAppData%\Programs\Python\Python310\python.exe"
    "%ProgramFiles%\Python312\python.exe"
    "%ProgramFiles%\Python313\python.exe"
    "%ProgramFiles%\Python311\python.exe"
) do (
    if not defined PY_CMD if exist "%%~P" (
        "%%~P" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
        if not errorlevel 1 set "PY_CMD=%%~P"
    )
)
if not defined PY_CMD if exist "%LocalAppData%\Programs\Python\Launcher\py.exe" (
    for /f "delims=" %%E in ('"%LocalAppData%\Programs\Python\Launcher\py.exe" -3.12 -c "import sys; print(sys.executable)" 2^>nul') do (
        if exist "%%E" set "PY_CMD=%%E"
    )
)
if not defined PY_CMD (
    where py >nul 2>&1 && (
        for /f "delims=" %%E in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do (
            if exist "%%E" set "PY_CMD=%%E"
        )
    )
)

if not defined PY_CMD (
    echo [1] Python 3.10+ not found. Trying winget Python 3.12 ...
    echo     This does NOT change Machine PATH ^(BioTime 3.7 can stay^).
    echo.
    where winget >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] winget is not available.
        echo         Install Python 3.12 from https://www.python.org/downloads/
        echo         Tick "Add python.exe to PATH", then re-run this installer.
        pause
        exit /b 1
    )
    winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
        set "PY_CMD=%LocalAppData%\Programs\Python\Python312\python.exe"
    )
)

if not defined PY_CMD (
    echo [ERROR] Still no Python 3.10+. Install 3.12 from python.org and re-run.
    pause
    exit /b 1
)

echo Using Python: %PY_CMD%
echo.

"%PY_CMD%" "%SCRIPT%" --root "%INSTALL_ROOT%" %MODE%
set "ERR=%ERRORLEVEL%"

REM Dated extras sit beside originals. Never replace existing clinic files.
if /I not "%MODE%"=="--check" (
    if exist "%INSTALL_ROOT%\xray-ai-service\apply_xray_ai_extras.py" (
        "%PY_CMD%" "%INSTALL_ROOT%\xray-ai-service\apply_xray_ai_extras.py" --root "%INSTALL_ROOT%"
    ) else if exist "%~dp0apply_xray_ai_extras.py" (
        "%PY_CMD%" "%~dp0apply_xray_ai_extras.py" --root "%INSTALL_ROOT%"
    )
)

echo.
if "%ERR%"=="0" (
    echo Installer finished.
    echo   AI health : http://127.0.0.1:8877/health
    echo   Clinic app: http://127.0.0.1:8123/index.html
    echo.
    echo If the AI window is not running, double-click start-xray-ai.bat
    echo and leave it open. Then open the clinic app and press Ctrl+F5.
) else (
    echo Installer exited with code %ERR%.
    echo Scroll up for [MISS] / [ERROR] lines.
)
echo.
pause
endlocal & exit /b %ERR%
