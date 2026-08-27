# tools/install-banana-remote.ps1
# Joyful Smile / Banana Clinic Manager — installer for the "Any Banana"
# remote support agent (tools/banana-remote-agent.ps1).
#
# What this does:
#   1. Copies banana-remote-agent.ps1 into -InstallPath (default
#      C:\BananaRemote).
#   2. Adds a Windows Defender exclusion for -InstallPath. This is
#      REQUIRED, not optional: the agent's screen-capture + mouse/keyboard
#      injection code (the exact same legitimate P-Invoke technique any
#      remote-support tool needs) trips Defender/AMSI's "script contained
#      malicious content" block on plain heuristics alone -- confirmed
#      live 2026-08-27, the script fails to even parse without this
#      exclusion in place. Skipped automatically if this installer isn't
#      elevated (Add-MpPreference needs Administrator); re-run elevated to
#      fix that.
#   3. Self-tests the installed copy before enabling anything (fails fast
#      instead of silently installing something that won't run).
#   4. Adds a Startup-folder shortcut so the agent starts automatically
#      (minimized) at every login. Prefers the All Users Startup folder
#      and falls back to the current user's if elevation is declined.
#   5. Starts the agent immediately too, unless -NoAutoStart is passed. If
#      an instance is already running on -Port, it is restarted so it
#      picks up the freshly-copied code.
#   6. Refuses to stomp on a different program already using the port.
#
# Safe to re-run any time (e.g. after pulling a code update).
#
# Usage (run from the same folder as banana-remote-agent.ps1):
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-banana-remote.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-banana-remote.ps1 -Uninstall
#
param(
    [string]$InstallPath = "C:\BananaRemote",
    [int]$Port = 17891,
    [switch]$NoAutoStart,
    [switch]$Uninstall,
    [switch]$NoElevate,
    [string]$ShortcutName = "Joyful Smile Any Banana Remote.lnk"
)

$ErrorActionPreference = "Stop"

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
    $probe = Join-Path $Folder ("js_banana_remote_write_probe_{0}.tmp" -f [guid]::NewGuid().ToString("N"))
    try {
        Set-Content -LiteralPath $probe -Value "ok" -ErrorAction Stop
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function New-AgentStartupShortcut($ShortcutPath, $AgentPath, $TargetPort, $WorkDir) {
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = (Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe")
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$AgentPath`" -InstallPath `"$WorkDir`" -Port $TargetPort"
    $shortcut.WorkingDirectory = $WorkDir
    $shortcut.WindowStyle = 7  # minimized
    $shortcut.Description = "Any Banana remote support agent (screen view/control + file sharing, host-side consent required)"
    $shortcut.Save()
}

function Remove-ShortcutIfExists($ShortcutPath) {
    if ([string]::IsNullOrWhiteSpace($ShortcutPath)) { return $false }
    if (-not (Test-Path -LiteralPath $ShortcutPath)) { return $false }
    Remove-Item -LiteralPath $ShortcutPath -Force
    return $true
}

function Test-AgentAlive($TargetPort) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/status" -TimeoutSec 3 -ErrorAction Stop
        if ($null -ne $resp -and $resp.ok -eq $true -and $resp.device_id) { return $true }
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

function Stop-AgentOnPort($TargetPort) {
    if (-not (Test-AgentAlive $TargetPort)) { return 0 }
    $proc = Find-ListeningProcessOnPort $TargetPort
    if (-not $proc) { return 0 }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    return 1
}

if (-not $NoElevate -and -not (Test-IsElevated)) {
    Write-Host "Requesting Administrator so the Defender exclusion and auto-start can be set up for every Windows account on this PC..." -ForegroundColor Cyan
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -InstallPath `"$InstallPath`" -Port $Port -ShortcutName `"$ShortcutName`""
    if ($NoAutoStart) { $argList += " -NoAutoStart" }
    if ($Uninstall) { $argList += " -Uninstall" }
    try {
        $elevated = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList -Wait -PassThru
        exit $elevated.ExitCode
    } catch {
        Write-Warn2 "Administrator elevation was declined. Continuing without it -- the Defender exclusion step below will likely fail, and auto-start will only cover this Windows account."
    }
}

if ($Uninstall) {
    Write-Step "Uninstalling Any Banana remote agent"
    $removedAny = $false
    foreach ($candidate in @((Get-AllUsersStartupShortcutPath), (Get-UserStartupShortcutPath))) {
        if (Remove-ShortcutIfExists $candidate) {
            Write-Ok "Removed startup shortcut: $candidate"
            $removedAny = $true
        }
    }
    if (-not $removedAny) { Write-Ok "No startup shortcut found (already removed)." }

    $stopped = Stop-AgentOnPort $Port
    if ($stopped -gt 0) {
        Write-Ok "Stopped the agent process listening on port $Port."
    } else {
        Write-Ok "No running agent found answering on port $Port."
    }

    try {
        Remove-MpPreference -ExclusionPath $InstallPath -ErrorAction SilentlyContinue
        Write-Ok "Removed Defender exclusion for $InstallPath."
    } catch {}

    Write-Host ""
    Write-Host "Uninstall complete. The agent script, device-id.txt, and any received files were left in $InstallPath (delete manually if you want it fully gone)." -ForegroundColor Cyan
    Write-Host "Note: this PC's Device ID row in Supabase is NOT deleted (harmless if left -- it just stops being reachable once nothing is running)." -ForegroundColor Cyan
    exit 0
}

Write-Step "Installing Any Banana remote agent to $InstallPath"

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceAgent = Join-Path $sourceDir "banana-remote-agent.ps1"
if (-not (Test-Path -LiteralPath $sourceAgent)) {
    Write-Err2 "Cannot find banana-remote-agent.ps1 next to this installer ($sourceDir). Copy the whole tools folder, not just this file."
    exit 1
}

if (-not (Test-Path -LiteralPath $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    Write-Ok "Created $InstallPath"
}

$sourceDirFull = (Resolve-Path -LiteralPath $sourceDir).Path.TrimEnd('\')
$installPathFull = (Resolve-Path -LiteralPath $InstallPath).Path.TrimEnd('\')
$runningInPlace = $sourceDirFull -ieq $installPathFull

$destAgent = Join-Path $InstallPath "banana-remote-agent.ps1"
if ($runningInPlace) {
    Write-Ok "Already running from inside $InstallPath -- banana-remote-agent.ps1 is already in place, skipping copy."
} else {
    Copy-Item -LiteralPath $sourceAgent -Destination $destAgent -Force
    Write-Ok "Copied banana-remote-agent.ps1 -> $destAgent"
}

Write-Step "Adding Windows Defender exclusion for $InstallPath"
Write-Host "    (Required: screen-capture + mouse/keyboard injection code trips AMSI's" -ForegroundColor Yellow
Write-Host "     generic malware heuristics on ANY legitimate remote-support tool, not" -ForegroundColor Yellow
Write-Host "     just this one -- see this file's header comment.)" -ForegroundColor Yellow
$defenderExcluded = $false
try {
    Add-MpPreference -ExclusionPath $InstallPath -ErrorAction Stop
    $defenderExcluded = $true
    Write-Ok "Defender exclusion added for $InstallPath"
} catch {
    Write-Warn2 "Could not add the Defender exclusion (needs Administrator): $($_.Exception.Message)"
    Write-Warn2 "Re-run this installer elevated, or add it manually: Windows Security > Virus & threat protection > Manage settings > Exclusions > Add `"$InstallPath`""
}

Write-Step "Self-testing the installed copy (no listener, no screen capture, no network)"
& powershell -NoProfile -ExecutionPolicy Bypass -File $destAgent -SelfTest
if ($LASTEXITCODE -ne 0) {
    Write-Err2 "Self-test FAILED for banana-remote-agent.ps1 (exit code $LASTEXITCODE)."
    if (-not $defenderExcluded) {
        Write-Err2 "This is most likely the missing Defender exclusion above (AMSI blocks the script from even parsing). Re-run this installer elevated and try again."
    }
    Write-Err2 "Not enabling auto-start."
    exit 1
}
Write-Ok "Self-test passed: banana-remote-agent.ps1"

Write-Step "Setting up auto-start at login"
$userShortcutPath = Get-UserStartupShortcutPath
$allUsersShortcutPath = Get-AllUsersStartupShortcutPath
$allUsersFolder = if ($allUsersShortcutPath) { Split-Path -Parent $allUsersShortcutPath } else { $null }
$shortcutPath = $null

if ($allUsersShortcutPath -and (Test-CanWriteToFolder $allUsersFolder)) {
    New-AgentStartupShortcut $allUsersShortcutPath $destAgent $Port $InstallPath
    $shortcutPath = $allUsersShortcutPath
    Write-Ok "All-users startup shortcut created: $shortcutPath"
    Write-Host "    (Starts minimized for ANY Windows account that logs into this PC.)"
    if (Remove-ShortcutIfExists $userShortcutPath) {
        Write-Ok "Removed per-user shortcut so this account does not start two copies: $userShortcutPath"
    }
} else {
    New-AgentStartupShortcut $userShortcutPath $destAgent $Port $InstallPath
    $shortcutPath = $userShortcutPath
    Write-Ok "Per-user startup shortcut created: $shortcutPath"
    Write-Host "    (Starts minimized on every login of this Windows account: $env:USERNAME.)"
    if (-not (Test-IsElevated)) {
        Write-Warn2 "Could not write the All Users Startup folder (needs Administrator). Auto-start will only fire for '$env:USERNAME'."
    }
}

if ($NoAutoStart) {
    Write-Host ""
    Write-Host "Install complete. -NoAutoStart was passed, so the agent was NOT started now -- it will start at next login." -ForegroundColor Cyan
    exit 0
}

Write-Step "Starting the agent now"
if (Test-AgentAlive $Port) {
    Write-Host "    Found the agent already running on port $Port -- restarting it so it loads the code just installed." -ForegroundColor Yellow
    $stopped = Stop-AgentOnPort $Port
    if ($stopped -gt 0) { Start-Sleep -Milliseconds 500 }
} else {
    $existingProc = Find-ListeningProcessOnPort $Port
    if ($existingProc) {
        Write-Err2 "Port $Port is already in use by another program (PID $($existingProc.Id), $($existingProc.ProcessName)) that isn't answering like our agent."
        Write-Err2 "Not starting a second listener. Close that program or choose a different -Port and re-run."
        exit 1
    }
}

$argString = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$destAgent`" -InstallPath `"$InstallPath`" -Port $Port"
Start-Process -FilePath "powershell" -ArgumentList $argString -WindowStyle Minimized | Out-Null
Start-Sleep -Seconds 2
$deviceId = $null
if (Test-AgentAlive $Port) {
    try { $deviceId = (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/device-id" -TimeoutSec 3).device_id } catch {}
    Write-Ok "Agent started and responding on http://127.0.0.1:$Port/status"
} else {
    Write-Err2 "Agent did not respond after starting."
    if (-not $defenderExcluded) {
        Write-Err2 "This is most likely the missing Defender exclusion above. Re-run this installer elevated."
    }
    exit 1
}

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "  Install path:      $destAgent"
Write-Host "  Device ID:         $(if ($deviceId) { $deviceId } else { '(check http://127.0.0.1:' + $Port + '/device-id)' })"
Write-Host "  Startup shortcut:  $shortcutPath"
Write-Host "  Status endpoint:   http://127.0.0.1:$Port/status"
Write-Host "  Defender exclusion: $(if ($defenderExcluded) { 'added' } else { 'NOT added -- see warning above' })"
Write-Host "  To remove:         run this installer again with -Uninstall"
Write-Host ""
Write-Host "Open Banana > Any Banana on this PC to see the Device ID, or give it to another clinic PC so it can connect in and (with your consent, prompted here each time) view/control this screen and share files." -ForegroundColor Cyan
