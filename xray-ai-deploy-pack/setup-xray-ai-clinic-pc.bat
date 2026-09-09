@echo off
REM Thin wrapper — installs against C:\banana\CS-web-version-main by default.
if /I "%~1"=="" (
    call "%~dp0install-xray-ai.bat" start
) else (
    call "%~dp0install-xray-ai.bat" %*
)
