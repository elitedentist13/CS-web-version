@echo off
REM ====================================================================
REM  CS X-ray Assist - local AI service launcher (port 8765)
REM
REM  First run creates a virtual environment, installs dependencies and
REM  downloads the model weights (a few GB, one time only). Later runs
REM  skip straight to starting the service.
REM
REM  Decision support only - not a diagnosis. See
REM  xray-ai-service\README.md for accuracy and licensing caveats.
REM ====================================================================
setlocal
cd /d "%~dp0xray-ai-service"

REM The venv and model cache live under %LOCALAPPDATA%, not inside the repo.
REM PyTorch ships deeply nested files, and a venv inside a folder like
REM "Downloads\CS-web-version-main (2)\CS-web-version-main\xray-ai-service"
REM pushes those past the Windows 260-character path limit, so pip fails with
REM "WinError 206: filename too long" partway through the install.
set "AI_HOME=%LOCALAPPDATA%\cs-xray-ai"
set "VENV_DIR=%AI_HOME%\venv"
set "MODEL_CACHE_DIR=%AI_HOME%\model_cache"

echo.
echo ============================================
echo   CS X-ray Assist  -  local AI service
echo ============================================
echo.
echo   Service files : %CD%
echo   Environment   : %AI_HOME%
echo.

REM ---- locate Python -------------------------------------------------
set "PY_CMD="
where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD (
    where py >nul 2>&1 && set "PY_CMD=py"
)
if not defined PY_CMD (
    echo [ERROR] Python was not found on this PC.
    echo.
    echo Install Python 3.10 or newer from https://www.python.org/downloads/
    echo IMPORTANT: tick "Add python.exe to PATH" in the installer.
    echo.
    echo The X-ray Assist button still works without this service - the app
    echo falls back to its built-in browser analysis, which is less accurate.
    echo.
    pause
    exit /b 1
)
echo [1/4] Using Python: %PY_CMD%

REM ---- free the port if a previous run is still listening ------------
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8765 .*LISTENING"') do (
    echo       Stopping previous service on port 8765 ^(PID %%P^)
    taskkill /F /PID %%P >nul 2>&1
)

REM ---- virtual environment ------------------------------------------
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [2/4] Creating virtual environment ^(one time^)...
    if not exist "%AI_HOME%" mkdir "%AI_HOME%"
    %PY_CMD% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [ERROR] Could not create the virtual environment.
        pause
        exit /b 1
    )
) else (
    echo [2/4] Virtual environment found.
)
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"

REM ---- dependencies -------------------------------------------------
if not exist "%VENV_DIR%\.deps-installed" (
    echo [3/4] Installing dependencies ^(one time, several minutes^)...
    "%VENV_PY%" -m pip install --upgrade pip
    "%VENV_PY%" -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed. See the messages above.
        pause
        exit /b 1
    )
    echo installed > "%VENV_DIR%\.deps-installed"
) else (
    echo [3/4] Dependencies already installed.
)

REM ---- model weights ------------------------------------------------
if not exist "%MODEL_CACHE_DIR%\.downloaded" (
    echo [4/4] Downloading AI models ^(one time, several GB^)...
    if not exist "%MODEL_CACHE_DIR%" mkdir "%MODEL_CACHE_DIR%"
    "%VENV_PY%" download_models.py
    if errorlevel 1 (
        echo.
        echo [WARN] One or more models failed to download.
        echo        The service will start in degraded mode. Check
        echo        http://127.0.0.1:8765/health for per-model status.
        echo.
    ) else (
        echo downloaded > "%MODEL_CACHE_DIR%\.downloaded"
    )
) else (
    echo [4/4] Models already downloaded.
)

echo.
echo ============================================
echo   Starting on http://127.0.0.1:8765
echo   Health check: http://127.0.0.1:8765/health
echo.
echo   Leave this window open while using
echo   X-ray Assist. Press Ctrl+C to stop.
echo ============================================
echo.

"%VENV_PY%" -m uvicorn main:app --host 127.0.0.1 --port 8765

echo.
echo Service stopped.
pause
endlocal
