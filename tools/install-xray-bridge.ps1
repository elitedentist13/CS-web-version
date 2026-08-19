# tools/install-xray-bridge.ps1
# Joyful Smile / Banana Clinic Manager — installer for the local X-ray bridge.
#
# Works the same on any clinic PC — the machine attached to the CBCT scanner
# ("server side", e.g. Cbct-pc, used to push patient info into NNT before a
# scan) and any consultation-room PC ("client side", used to open NNT/NEWTOM
# to browse a patient's existing x-rays). The bridge code is identical either
# way; only what NNT itself does with the opened patient differs, and that is
# entirely NNT's own business logic.
#
# What this does:
#   1. Copies xray-local-launcher.ps1 AND its required companion scripts
#      (see $RequiredCompanionScripts below -- currently
#      _nnt_identity_guard.ps1 and _nnt_new_opg_watcher.ps1) into
#      -InstallPath (default C:\NNT). The launcher looks these up as
#      siblings via $PSScriptRoot at runtime, so if they aren't copied
#      alongside it, the patient-identity-mismatch warning and the new-OPG
#      upload prompt silently never fire -- no error, just missing safety
#      features. Discovered 2026-08-19 when this installer was found to
#      only ever copy the one main file. Any companion missing at the
#      source is a warning, not a hard failure (the base bridge still
#      works without it), but every companion actually copied is
#      self-tested (see step 2) just like the main script.
#   2. Self-tests every COPIED file (main script + each companion) before
#      enabling anything (fails fast if a copy is broken instead of
#      silently installing something that won't run).
#   3. Adds a Startup-folder shortcut so the bridge starts automatically
#      (minimized) at every login — no more remembering to double-click
#      "Start X-Ray Launcher.bat" by hand. Prefers the All Users Startup
#      folder (covers every Windows account on the PC) and falls back to
#      the current user's Startup folder if Administrator elevation is
#      declined. Uninstall removes both locations.
#   4. Starts the bridge immediately too, unless -NoAutoStart is passed, so
#      it's live right away without needing a logoff/logon cycle. If an
#      instance of our own bridge is already running, it is restarted (not
#      left alone) so it actually picks up the freshly-copied code --
#      PowerShell does not hot-reload a running script from disk, so
#      re-running this installer after a code fix previously looked
#      successful but silently kept the OLD code running in memory.
#   5. Refuses to stomp on a different program already using the port.
#
# Safe to re-run any time (e.g. after pulling a code update) -- every step
# above is idempotent: files are overwritten, the startup shortcut is
# recreated the same way, and an already-running bridge is restarted to
# pick up the new code rather than left stale.
#
# Usage (run from the same folder as xray-local-launcher.ps1, or anywhere —
# it locates its sibling files automatically):
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-xray-bridge.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-xray-bridge.ps1 -Uninstall
#
param(
    [string]$InstallPath = "C:\NNT",
    [int]$Port = 17890,
    [switch]$NoAutoStart,
    [switch]$Uninstall,
    [switch]$NoElevate
)

$ErrorActionPreference = "Stop"
$ShortcutName = "Joyful Smile X-Ray Bridge.lnk"

# Scripts xray-local-launcher.ps1 loads as siblings via $PSScriptRoot at
# runtime (Start-NntIdentityGuard / Start-NntNewOpgWatcher) -- must live
# next to it in -InstallPath or those safety/upload features silently
# no-op. Add any future companion script here so it gets installed and
# self-tested automatically too.
$RequiredCompanionScripts = @(
    "_nnt_identity_guard.ps1",
    "_nnt_new_opg_watcher.ps1"
)

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    WARNING: $msg" -ForegroundColor Yellow }
function Write-Err2($msg) { Write-Host "    ERROR: $msg" -ForegroundColor Red }

function Test-IsElevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-UserStartupShortcutPath {
    $wsh = New-Object -ComObject WScript.Shell
    return (Join-Path $wsh.SpecialFolders("Startup") $ShortcutName)
}

function Get-AllUsersStartupShortcutPath {
    $wsh = New-Object -ComObject WScript.Shell
    $folder = $wsh.SpecialFolders("AllUsersStartup")
    if ([string]::IsNullOrWhiteSpace($folder)) { return $null }
    return (Join-Path $folder $ShortcutName)
}

function Test-CanWriteToFolder($Folder) {
    if ([string]::IsNullOrWhiteSpace($Folder)) { return $false }
    if (-not (Test-Path -LiteralPath $Folder)) { return $false }
    $probe = Join-Path $Folder ("js_xray_write_probe_{0}.tmp" -f [guid]::NewGuid().ToString("N"))
    try {
        Set-Content -LiteralPath $probe -Value "ok" -ErrorAction Stop
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function New-BridgeStartupShortcut($ShortcutPath, $LauncherPath, $TargetPort, $WorkDir) {
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe")
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$LauncherPath`" -Port $TargetPort"
    $shortcut.WorkingDirectory = $WorkDir
    $shortcut.WindowStyle = 7  # minimized
    $shortcut.Description = "Joyful Smile X-Ray local bridge (Carestream / Ai-Dental / NNT-NEWTOM)"
    $shortcut.Save()
}

function Remove-ShortcutIfExists($ShortcutPath) {
    if ([string]::IsNullOrWhiteSpace($ShortcutPath)) { return $false }
    if (-not (Test-Path -LiteralPath $ShortcutPath)) { return $false }
    Remove-Item -LiteralPath $ShortcutPath -Force
    return $true
}

function Test-BridgeAlive($TargetPort) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/status" -TimeoutSec 3 -ErrorAction Stop
        if ($null -ne $resp -and ($resp.PSObject.Properties.Name -contains 'nntnewtom_exists')) {
            return $true
        }
        return $false
    } catch {
        return $false
    }
}

function Find-ListeningProcessOnPort($TargetPort) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        }
    } catch {}
    return $null
}

function Stop-BridgeOnPort($TargetPort) {
    # Deliberately NOT using Get-CimInstance Win32_Process / WMI command-line
    # matching here: it has proven unreliable in the field (silently returns
    # nothing even for a directly-queried, confirmed-alive PID on at least one
    # real machine). Get-NetTCPConnection -> Get-Process by PID is the same
    # mechanism Find-ListeningProcessOnPort already uses successfully, so
    # uninstall re-uses it: find whoever is actually listening on our port,
    # confirm it answers like our bridge (so we never kill an unrelated
    # program), then stop that specific PID.
    if (-not (Test-BridgeAlive $TargetPort)) {
        return 0
    }
    $proc = Find-ListeningProcessOnPort $TargetPort
    if (-not $proc) {
        return 0
    }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    return 1
}

if (-not $NoElevate -and -not (Test-IsElevated)) {
    Write-Host "Requesting Administrator so auto-start can cover every Windows account on this PC..." -ForegroundColor Cyan
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -InstallPath `"$InstallPath`" -Port $Port"
    if ($NoAutoStart) { $argList += " -NoAutoStart" }
    if ($Uninstall) { $argList += " -Uninstall" }
    try {
        $elevated = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList -Wait -PassThru
        exit $elevated.ExitCode
    } catch {
        Write-Warn2 "Administrator elevation was declined. Continuing with per-user auto-start only (this Windows account: $env:USERNAME)."
    }
}

if ($Uninstall) {
    Write-Step "Uninstalling Joyful Smile X-Ray bridge"
    $removedAny = $false
    foreach ($candidate in @((Get-AllUsersStartupShortcutPath), (Get-UserStartupShortcutPath))) {
        if (Remove-ShortcutIfExists $candidate) {
            Write-Ok "Removed startup shortcut: $candidate"
            $removedAny = $true
        }
    }
    if (-not $removedAny) {
        Write-Ok "No startup shortcut found (already removed)."
    }

    $launcherPath = Join-Path $InstallPath "xray-local-launcher.ps1"
    $stopped = Stop-BridgeOnPort $Port
    if ($stopped -gt 0) {
        Write-Ok "Stopped the bridge process listening on port $Port."
    } else {
        Write-Ok "No running bridge found answering on port $Port."
    }

    Write-Host ""
    Write-Host "Uninstall complete. The launcher script and its companion scripts were left in $InstallPath (delete manually if you want it fully gone: $launcherPath and $($RequiredCompanionScripts -join ', '))." -ForegroundColor Cyan
    exit 0
}

Write-Step "Installing Joyful Smile X-Ray bridge to $InstallPath"

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceLauncher = Join-Path $sourceDir "xray-local-launcher.ps1"
if (-not (Test-Path -LiteralPath $sourceLauncher)) {
    Write-Err2 "Cannot find xray-local-launcher.ps1 next to this installer ($sourceDir). Copy the whole tools folder, not just this file."
    exit 1
}

if (-not (Test-Path -LiteralPath $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    Write-Ok "Created $InstallPath"
}

$destLauncher = Join-Path $InstallPath "xray-local-launcher.ps1"
Copy-Item -LiteralPath $sourceLauncher -Destination $destLauncher -Force
Write-Ok "Copied xray-local-launcher.ps1 -> $destLauncher"

$installedCompanions = New-Object System.Collections.Generic.List[string]
foreach ($name in $RequiredCompanionScripts) {
    $srcCompanion = Join-Path $sourceDir $name
    $destCompanion = Join-Path $InstallPath $name
    if (-not (Test-Path -LiteralPath $srcCompanion)) {
        Write-Warn2 "Companion script not found next to installer, skipping: $name (the safety/upload feature that depends on it will silently do nothing until this is fixed and the installer is re-run)."
        continue
    }
    Copy-Item -LiteralPath $srcCompanion -Destination $destCompanion -Force
    Write-Ok "Copied $name -> $destCompanion"
    $installedCompanions.Add($destCompanion)
}

Write-Step "Self-testing the installed copies (no listener, nothing launched)"
& powershell -NoProfile -ExecutionPolicy Bypass -File $destLauncher -SelfTest
if ($LASTEXITCODE -ne 0) {
    Write-Err2 "Self-test FAILED for xray-local-launcher.ps1 (exit code $LASTEXITCODE). Not enabling auto-start. Fix the script and re-run this installer."
    exit 1
}
Write-Ok "Self-test passed: xray-local-launcher.ps1"

foreach ($destCompanion in $installedCompanions) {
    $companionName = Split-Path -Leaf $destCompanion
    & powershell -NoProfile -ExecutionPolicy Bypass -File $destCompanion -SelfTest
    if ($LASTEXITCODE -ne 0) {
        Write-Err2 "Self-test FAILED for $companionName (exit code $LASTEXITCODE). Not enabling auto-start. Fix the script and re-run this installer."
        exit 1
    }
    Write-Ok "Self-test passed: $companionName"
}

Write-Step "Setting up auto-start at login"
$userShortcutPath = Get-UserStartupShortcutPath
$allUsersShortcutPath = Get-AllUsersStartupShortcutPath
$allUsersFolder = if ($allUsersShortcutPath) { Split-Path -Parent $allUsersShortcutPath } else { $null }
$shortcutPath = $null

if ($allUsersShortcutPath -and (Test-CanWriteToFolder $allUsersFolder)) {
    New-BridgeStartupShortcut $allUsersShortcutPath $destLauncher $Port $InstallPath
    $shortcutPath = $allUsersShortcutPath
    Write-Ok "All-users startup shortcut created: $shortcutPath"
    Write-Host "    (Starts minimized for ANY Windows account that logs into this PC.)"
    if (Remove-ShortcutIfExists $userShortcutPath) {
        Write-Ok "Removed per-user shortcut so this account does not start two copies: $userShortcutPath"
    }
} else {
    New-BridgeStartupShortcut $userShortcutPath $destLauncher $Port $InstallPath
    $shortcutPath = $userShortcutPath
    Write-Ok "Per-user startup shortcut created: $shortcutPath"
    Write-Host "    (Starts minimized on every login of this Windows account: $env:USERNAME.)"
    if (-not (Test-IsElevated)) {
        Write-Warn2 "Could not write the All Users Startup folder (needs Administrator). Auto-start will only fire for '$env:USERNAME'. Re-run this installer and approve the UAC prompt to cover every account on this PC."
    }
}

if ($NoAutoStart) {
    Write-Host ""
    Write-Host "Install complete. -NoAutoStart was passed, so the bridge was NOT started now -- it will start at next login." -ForegroundColor Cyan
    exit 0
}

Write-Step "Starting the bridge now"
if (Test-BridgeAlive $Port) {
    Write-Host "    Found our bridge already running on port $Port -- restarting it so it loads the code just installed." -ForegroundColor Yellow
    $stopped = Stop-BridgeOnPort $Port
    if ($stopped -gt 0) {
        Start-Sleep -Milliseconds 500
    }
} else {
    $existingProc = Find-ListeningProcessOnPort $Port
    if ($existingProc) {
        Write-Err2 "Port $Port is already in use by another program (PID $($existingProc.Id), $($existingProc.ProcessName)) that isn't answering like our bridge."
        Write-Err2 "Not starting a second listener. Close that program or choose a different -Port and re-run."
        exit 1
    }
}

$argString = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$destLauncher`" -Port $Port"
Start-Process -FilePath "powershell" -ArgumentList $argString -WindowStyle Minimized | Out-Null
Start-Sleep -Seconds 2
if (Test-BridgeAlive $Port) {
    Write-Ok "Bridge started and responding on http://127.0.0.1:$Port/status"
} else {
    Write-Err2 "Bridge did not respond after starting. Check for errors by running Start-X-Ray-Launcher manually."
    exit 1
}

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "  Install path:      $destLauncher"
if ($installedCompanions.Count -gt 0) {
    $companionNames = @($installedCompanions | ForEach-Object { Split-Path -Leaf $_ })
    Write-Host "  Companion scripts: $($installedCompanions.Count) / $($RequiredCompanionScripts.Count) installed ($($companionNames -join ', '))"
} else {
    Write-Warn2 "No companion scripts installed -- identity-mismatch warnings and new-OPG upload prompts will NOT run on this PC. Re-run from a folder that also has $($RequiredCompanionScripts -join ', ')."
}
Write-Host "  Startup shortcut:  $shortcutPath"
Write-Host "  Status endpoint:   http://127.0.0.1:$Port/status"
Write-Host "  To remove:         run this installer again with -Uninstall"
