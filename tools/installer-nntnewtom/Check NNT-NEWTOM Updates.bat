@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  Joyful Smile CEFLA bridge — check for updates now
echo  (NNT/NewTom + MyRay shared launcher at C:\NNT)
echo ============================================================
echo.
echo This compares the installed bridge against:
echo   https://elitedentist13.github.io/CS-web-version/tools/installer-nntnewtom/
echo.
echo Safe: downloads to a temp folder, self-tests, backs up, and
echo rolls back automatically if /status fails after restart.
echo.

if not exist "%~dp0xray-bridge-auto-update.ps1" (
  echo ERROR: xray-bridge-auto-update.ps1 missing next to this bat.
  echo Re-copy the whole installer-nntnewtom folder and try again.
  pause
  exit /b 1
)

REM Prefer the installed copy under C:\NNT when present (same files the
REM Scheduled Task runs); fall back to this folder for first-time checks.
set "UPDATER=%~dp0xray-bridge-auto-update.ps1"
if exist "C:\NNT\xray-bridge-auto-update.ps1" set "UPDATER=C:\NNT\xray-bridge-auto-update.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -File "%UPDATER%" ^
  -InstallPath "C:\NNT" ^
  -Port 17890 ^
  -EnabledSystems "nntnewtom" "myray" ^
  -ShortcutName "Joyful Smile NNT-NEWTOM Bridge.lnk" ^
  -PackageFolder "installer-nntnewtom" ^
  -CompanionScripts "_nnt_identity_guard.ps1" "_nnt_new_opg_watcher.ps1"

echo.
echo Exit code: %ERRORLEVEL%
echo   0 = up to date, updated OK, or site unreachable (left alone)
echo   1 = downloaded files failed parse/self-test (nothing applied)
echo.
echo Log:  C:\NNT\xray-bridge-update.log
echo State: C:\NNT\xray-bridge-update-state.json
pause
