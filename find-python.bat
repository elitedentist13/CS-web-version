@echo off
REM ============================================================
REM  find-python.bat -- locate a Python 3.10+ interpreter reliably
REM  across differently set-up clinic PCs, and set PY_CMD to it.
REM
REM  Why this file exists: install-xray-ai.bat and start-xray-ai.bat
REM  used to each carry their own copy of this detection logic, and
REM  it only checked a short, hardcoded list of install folders
REM  (LocalAppData\...\Python312/313/311/310 and ProgramFiles\...
REM  Python312/313/311). Any PC where Python lives somewhere else --
REM  C:\PythonXY (common on IT-imaged machines), Program Files (x86)
REM  32-bit installs, a newer Python not yet in the list (3.14+), or
REM  just plain "python" already correct on PATH -- was invisible to
REM  the installer, which then reported the venv/packages/models as
REM  [MISS] even though a perfectly good Python was sitting right
REM  there. This single shared file replaces both copies so a fix
REM  here helps every script that calls it, on every PC.
REM
REM  Usage:
REM    call "%~dp0find-python.bat"
REM    if not defined PY_CMD ( ...not found... ) else ( ...use %PY_CMD%... )
REM
REM  Never touches the network and never installs anything -- it only
REM  looks. Kept identical between the repo root and
REM  xray-ai-deploy-pack\ -- if you fix a detection gap in one, copy
REM  the same fix to the other.
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
set "_FP_RESULT="

REM ---- 1) Known per-user install folders, newest first ----------------
for %%V in (313 312 311 310) do (
    if not defined _FP_RESULT if exist "%LocalAppData%\Programs\Python\Python%%V\python.exe" (
        call :FP_CHECK "%LocalAppData%\Programs\Python\Python%%V\python.exe"
    )
)

REM ---- 2) Known machine-wide install folders (64-bit) ------------------
for %%V in (313 312 311 310) do (
    if not defined _FP_RESULT if exist "%ProgramFiles%\Python%%V\python.exe" (
        call :FP_CHECK "%ProgramFiles%\Python%%V\python.exe"
    )
)

REM ---- 3) Machine-wide install folders (32-bit Python on 64-bit Windows)
if defined ProgramFiles(x86) (
    for %%V in (313 312 311 310) do (
        if not defined _FP_RESULT if exist "%ProgramFiles(x86)%\Python%%V\python.exe" (
            call :FP_CHECK "%ProgramFiles(x86)%\Python%%V\python.exe"
        )
    )
)

REM ---- 4) Root-of-drive installs some IT images/installers use ---------
for %%V in (313 312 311 310 314 315 316) do (
    if not defined _FP_RESULT if exist "C:\Python%%V\python.exe" (
        call :FP_CHECK "C:\Python%%V\python.exe"
    )
)

REM ---- 5) py launcher: try newest-first, then generic latest -3 --------
if not defined _FP_RESULT (
    set "_FP_PYLAUNCHER="
    if exist "%LocalAppData%\Programs\Python\Launcher\py.exe" set "_FP_PYLAUNCHER=%LocalAppData%\Programs\Python\Launcher\py.exe"
    if not defined _FP_PYLAUNCHER (
        where py >nul 2>&1 && set "_FP_PYLAUNCHER=py"
    )
    if defined _FP_PYLAUNCHER (
        for %%V in (-3.13 -3.12 -3.11 -3.10 -3) do (
            if not defined _FP_RESULT (
                for /f "delims=" %%E in ('"!_FP_PYLAUNCHER!" %%V -c "import sys; print(sys.executable)" 2^>nul') do (
                    if exist "%%E" call :FP_CHECK "%%E"
                )
            )
        )
    )
)

REM ---- 6) Last resort: whatever "python" resolves to on PATH -----------
REM      Clinic PCs sometimes have an old BioTime 3.7 python first, so
REM      this is checked last and still version-gated to 3.10+.
if not defined _FP_RESULT (
    where python >nul 2>&1 && (
        for /f "delims=" %%E in ('where python 2^>nul') do (
            if not defined _FP_RESULT call :FP_CHECK "%%E"
        )
    )
)

endlocal & set "PY_CMD=%_FP_RESULT%"
if defined PY_CMD (
    exit /b 0
) else (
    exit /b 1
)

:FP_CHECK
"%~1" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
if not errorlevel 1 set "_FP_RESULT=%~1"
goto :eof
