# Bring up the three local loopback services without colliding.
# Called by start-clinic-local.bat (manual / "check") and by start-banana-silent.ps1 at
# Windows logon (-Logon -SkipApp; installed via install-banana-autostart.bat). Starts only
# what is down instead of starting a second listener or killing a healthy peer.
#
#   :5500  clinic web UI            (:8123 when Windows has reserved 5500)
#   :17890 X-ray software launcher
#   :8877  X-ray AI helper
#
#   -Logon   unattended: only start the AI helper if it is already installed (never
#            trigger the multi-GB first-time setup), and re-check the launcher port after
#            a short wait so a bridge's own autostart is not duplicated.
#
# Never binds 8765. Never stops a process on a port it does not own.

param(
    [switch]$StatusOnly,
    [switch]$StartApp,
    [switch]$SkipApp,
    [switch]$SkipLauncher,
    [switch]$SkipAi,
    [switch]$Logon
)

$ErrorActionPreference = 'Continue'
$toolsDir = $PSScriptRoot
$root = Split-Path $toolsDir -Parent
. (Join-Path $toolsDir 'clinic-local-ports.ps1')

function Start-IfMissingApp {
    if ($SkipApp -or -not $StartApp) { return }
    $s = Get-ClinicStackStatus
    if ($s.app -or $s.appFallback) {
        Write-Host "Clinic web already up ($($s.appUrl)). Not starting a second server." -ForegroundColor Green
        return
    }
    $silent = Join-Path $root 'start-banana-silent.ps1'
    if (Test-Path -LiteralPath $silent) {
        Write-Host "Starting clinic web UI (hidden; :5500, or :8123 if 5500 is reserved) ..." -ForegroundColor Cyan
        & $silent -ServerOnly
        return
    }
    $bat = Join-Path $root 'start-server.bat'
    if (Test-Path -LiteralPath $bat) {
        Write-Host "Starting clinic web UI on :5500 ..." -ForegroundColor Cyan
        Start-Process -FilePath $bat -WorkingDirectory $root -WindowStyle Normal
    }
}

function Start-IfMissingLauncher {
    if ($SkipLauncher) { return }
    $s = Get-ClinicStackStatus
    if (-not $s.xrayLauncher -and $Logon) {
        Start-Sleep -Seconds 8
        $s = Get-ClinicStackStatus
    }
    if ($s.xrayLauncher) {
        Write-Host "X-ray software launcher already on :17890. Leaving it." -ForegroundColor Green
        return
    }
    # The launcher is single-threaded, so /status can time out while it is busy.
    if (Test-ClinicTcp 17890) {
        Write-Host "Something is listening on :17890 (launcher busy?). Not starting a second one." -ForegroundColor Yellow
        return
    }
    $ensure = Join-Path $toolsDir 'ensure-xray-launcher.ps1'
    if (Test-Path -LiteralPath $ensure) {
        & $ensure
        return
    }
    $bat = Join-Path $root 'start-xray-launcher.bat'
    if (Test-Path -LiteralPath $bat) {
        Start-Process -FilePath $bat -WorkingDirectory $root
    }
}

# Mirrors the checks in start-xray-ai.bat that decide whether setup is still needed.
function Test-XrayAiInstalled {
    $aiHome = Join-Path $env:LOCALAPPDATA 'cs-xray-ai'
    return (Test-Path -LiteralPath (Join-Path $aiHome 'venv\Scripts\python.exe')) -and
           (Test-Path -LiteralPath (Join-Path $aiHome 'venv\.deps-installed')) -and
           (Test-Path -LiteralPath (Join-Path $aiHome 'model_cache\.downloaded'))
}

function Start-IfMissingAi {
    if ($SkipAi) { return }
    $s = Get-ClinicStackStatus
    if ($s.xrayAi) {
        Write-Host "X-ray AI helper already on :8877. Not restarting (would interrupt analysis)." -ForegroundColor Green
        return
    }
    $bat = Join-Path $root 'start-xray-ai.bat'
    if (-not (Test-Path -LiteralPath $bat)) {
        Write-Host "[WARN] start-xray-ai.bat missing -- skip AI helper." -ForegroundColor Yellow
        return
    }
    if ($Logon -and -not (Test-XrayAiInstalled)) {
        Write-Host "X-ray AI helper not installed on this PC -- skipped at logon (run install-xray-ai.bat once)." -ForegroundColor Yellow
        return
    }
    Write-Host "Starting X-ray AI helper on :8877 ..." -ForegroundColor Cyan
    $style = if ($Logon) { 'Minimized' } else { 'Normal' }
    Start-Process -FilePath $bat -ArgumentList 'nopause' -WorkingDirectory $root -WindowStyle $style
}

$st = Write-ClinicStackStatus
if ($StatusOnly) {
    if (($st.app -or $st.appFallback) -and $st.xrayLauncher -and $st.xrayAi) { exit 0 }
    exit 2
}

Start-IfMissingLauncher
Start-IfMissingAi
Start-IfMissingApp
Start-Sleep -Seconds 2
$final = Write-ClinicStackStatus
if ($final.appUrl) {
    Write-Host "  Clinic page: $($final.appUrl)" -ForegroundColor Green
}
exit 0
