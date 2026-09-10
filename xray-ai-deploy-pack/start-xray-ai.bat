@echo off
REM ====================================================================
REM  CS X-ray Assist - local AI service launcher (port 8877)
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
REM Hugging Face defaults to cache symlinks; Windows without Developer Mode
REM then fails with WinError 1314 ("missing file") even after the weights land.
set "HF_HUB_DISABLE_SYMLINKS=1"

echo.
echo ============================================
echo   CS X-ray Assist  -  local AI service
echo ============================================
echo.
echo   Service files : %CD%
echo   Environment   : %AI_HOME%
echo.

REM ---- locate Python 3.10+ (shared, tested detector) -------------------
REM Do NOT trust `python` on PATH first: clinic PCs often have BioTime 3.7
REM ahead of a real 3.12 install. See find-python.bat for the full search
REM order (per-user/machine folders, C:\PythonXY, py-launcher, PATH last).
set "PY_CMD="
if exist "%~dp0find-python.bat" call "%~dp0find-python.bat"
if not defined PY_CMD (
    echo [ERROR] Python 3.10 or newer was not found on this PC.
    echo.
    echo Install Python 3.12 from https://www.python.org/downloads/
    echo IMPORTANT: tick "Add python.exe to PATH" in the installer.
    echo.
    echo The X-ray Assist button still works without this service - the app
    echo falls back to its built-in browser analysis, which is less accurate.
    echo.
    pause
    exit /b 1
)
echo [1/4] Using Python: %PY_CMD%

REM ---- free the port if a previous run of THIS service is still --------
REM ---- listening (only ever kill python.exe - never someone else's ----
REM ---- unrelated software that happens to be sat on the same port) ----
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8877 .*LISTENING"') do (
    for /f %%N in ('tasklist /FI "PID eq %%P" /FI "IMAGENAME eq python.exe" /NH 2^>nul ^| findstr /I "python.exe"') do (
        echo       Stopping previous service on port 8877 ^(PID %%P^)
        taskkill /F /PID %%P >nul 2>&1
    )
)

REM ---- virtual environment ------------------------------------------
if exist "%VENV_DIR%\Scripts\python.exe" (
    "%VENV_DIR%\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
    if errorlevel 1 (
        echo [2/4] Existing venv is too old - recreating with %PY_CMD%...
        rmdir /s /q "%VENV_DIR%"
    )
)
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [2/4] Creating virtual environment ^(one time^)...
    if not exist "%AI_HOME%" mkdir "%AI_HOME%"
    "%PY_CMD%" -m venv "%VENV_DIR%"
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
set "NEED_DEPS=0"
if not exist "%VENV_DIR%\.deps-installed" set "NEED_DEPS=1"
"%VENV_PY%" -c "import uvicorn, fastapi, ultralytics" >nul 2>&1
if errorlevel 1 set "NEED_DEPS=1"
if "%NEED_DEPS%"=="1" (
    echo [3/4] Installing dependencies ^(one time, several minutes^)...
    "%VENV_PY%" -m pip install --upgrade pip
    "%VENV_PY%" -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt
    "%VENV_PY%" -c "import ultralytics" >nul 2>&1
    if errorlevel 1 (
        echo       ultralytics via --no-deps ^(opencv-python-headless already provides cv2^)
        "%VENV_PY%" -m pip install "ultralytics>=8.3" --no-deps
        "%VENV_PY%" -m pip install cloudpickle matplotlib "requests>=2.23" psutil "polars>=0.20" nvidia-ml-py "ultralytics-thop>=2.1.6" "ultralytics-platform>=0.1.32"
    )
    "%VENV_PY%" -c "import uvicorn, fastapi" >nul 2>&1
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
set "NEED_MODELS=0"
if not exist "%MODEL_CACHE_DIR%\.downloaded" set "NEED_MODELS=1"
dir /s /b "%MODEL_CACHE_DIR%\*.onnx" >nul 2>&1
if errorlevel 1 set "NEED_MODELS=1"
if "%NEED_MODELS%"=="1" (
    echo [4/4] Downloading AI models ^(tooth ONNX + condition weights^)...
    if not exist "%MODEL_CACHE_DIR%" mkdir "%MODEL_CACHE_DIR%"
    "%VENV_PY%" download_models.py
    if errorlevel 1 (
        echo.
        echo [WARN] One or more models failed to download ^(missing file^).
        echo        The service will start in degraded mode. Check
        echo        http://127.0.0.1:8877/health for per-model status.
        echo        If a Hugging Face repo is gated, set HF_TOKEN and re-run.
        echo.
    ) else (
        echo downloaded > "%MODEL_CACHE_DIR%\.downloaded"
    )
) else (
    echo [4/4] Models already downloaded.
)

echo.
echo ============================================
echo   Starting on http://127.0.0.1:8877
echo   Health check: http://127.0.0.1:8877/health
echo.
echo   Leave this window open while using
echo   X-ray Assist. Press Ctrl+C to stop.
echo ============================================
echo.

set "PORT=8877"
set "HOST=127.0.0.1"
set "UVICORN_APP=main:app"
if exist "%~dp0xray-ai-service\xray_ai_extras_main_20260909.py" (
  set "UVICORN_APP=xray_ai_extras_main_20260909:app"
)
"%VENV_PY%" -m uvicorn %UVICORN_APP% --host 127.0.0.1 --port 8877

echo.
echo Service stopped.
pause
endlocal
