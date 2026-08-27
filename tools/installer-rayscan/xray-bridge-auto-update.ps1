# tools/xray-bridge-auto-update.ps1
# Joyful Smile / Banana Clinic Manager — background self-update checker for
# the local X-ray bridge (xray-local-launcher.ps1 and friends).
#
# WHY THIS EXISTS: a real clinic PC was found (2026-08-27) running a bridge
# build from BEFORE a real bug fix (stripping the clinic's chart-number
# prefix for Rayscan) even though the fix had existed in the source for
# days -- there was no mechanism for an already-installed bridge to ever
# notice a newer version existed except a person manually re-running the
# installer. This script closes that gap: it is registered as a recurring
# Windows Scheduled Task (see Install-UpdateScheduledTask in
# install-xray-bridge.ps1) that periodically checks the live Banana site
# for a newer copy of every file it manages, and -- only if the newer copy
# passes the exact same self-test gate a human would run by hand -- swaps
# it in and restarts the bridge automatically.
#
# SAFETY MODEL (deliberately conservative -- this touches a live clinic
# tool that must never end a check cycle worse off than it started):
#   1. Nothing is ever downloaded straight into the live install folder --
#      every fetch lands in an isolated temp folder first.
#   2. Every downloaded .ps1 is parse-checked (catches the exact class of
#      "file parses fine on my PC but not on this clinic's locale" bug
#      found 2026-08-27 -- see the UTF-8 BOM fix history in
#      xray-local-launcher.ps1) BEFORE anything is applied.
#   3. xray-local-launcher.ps1 (and each companion script that supports it)
#      must also pass "-SelfTest" from its temp location before anything is
#      applied.
#   4. The previously-installed copy of every file is backed up (last 3
#      kept) before being overwritten, so a human can always hand-restore.
#   5. After restarting the bridge with the new files, this script verifies
#      /status actually answers. If it does not, it automatically restores
#      the backups and restarts again with the OLD files, so an unattended
#      run can never leave the clinic with a dead bridge overnight.
#   6. Network failures (clinic PC offline, site unreachable) fail quietly
#      and leave the current bridge completely untouched -- just logged,
#      retried next scheduled cycle.
#
# Usage (normally only ever invoked by the Scheduled Task registered at
# install time -- see install-xray-bridge.ps1 -- with the same
# -InstallPath / -Port / -EnabledSystems / -ShortcutName it was installed
# with):
#   powershell -NoProfile -ExecutionPolicy Bypass -File xray-bridge-auto-update.ps1 `
#       -InstallPath "C:\BananaBridge-Rayscan" -Port 17890 -EnabledSystems "rayscan" `
#       -ShortcutName "Joyful Smile Rayscan Bridge.lnk" -PackageFolder "installer-rayscan"
#
param(
    [string]$InstallPath = "C:\NNT",
    [int]$Port = 17890,
    [string[]]$EnabledSystems = @(),
    [string]$ShortcutName = "Joyful Smile X-Ray Bridge.lnk",
    # Root of the live Banana deployment this clinic's bridges check
    # against. GitHub Pages serves the repo's tools\ folder as plain static
    # files (confirmed live 2026-08-27) -- whatever is pushed there IS the
    # update channel, there is no separate staging/release tier. If this
    # script is ever reused for a different clinic's own fork/deployment,
    # this default must be changed to that clinic's own site root.
    [string]$UpdateBaseUrl = "https://elitedentist13.github.io/CS-web-version",
    # Which tools\ subfolder to check against, e.g. "installer-rayscan" for
    # a Rayscan-only install, "installer-ezdenti" / "installer-nntnewtom"
    # for those, or "" (empty) for the shared, all-systems tools\ copy
    # itself. Must match how this PC was originally installed -- baked into
    # the Scheduled Task's own command line at install time, never guessed.
    [string]$PackageFolder = "",
    # Companion scripts (e.g. NNT's _nnt_identity_guard.ps1 /
    # _nnt_new_opg_watcher.ps1) that live alongside xray-local-launcher.ps1
    # on this PC and should also be kept in sync. Empty for installs that
    # don't use any (EzDent-i, Rayscan).
    [string[]]$CompanionScripts = @()
)

$ErrorActionPreference = "Continue"

if ($EnabledSystems.Count -eq 1 -and $EnabledSystems[0] -match ',') {
    $EnabledSystems = @($EnabledSystems[0] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
if ($CompanionScripts.Count -eq 1 -and $CompanionScripts[0] -match ',') {
    $CompanionScripts = @($CompanionScripts[0] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$logPath = Join-Path $InstallPath "xray-bridge-update.log"
$statePath = Join-Path $InstallPath "xray-bridge-update-state.json"

function Write-UpdateLog($line) {
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$stamp] $line"
    try {
        Add-Content -LiteralPath $logPath -Value "[$stamp] $line" -Encoding UTF8 -ErrorAction Stop
        $item = Get-Item -LiteralPath $logPath -ErrorAction SilentlyContinue
        if ($item -and $item.Length -gt 512KB) {
            $tail = Get-Content -LiteralPath $logPath -Tail 300
            Set-Content -LiteralPath $logPath -Value $tail -Encoding UTF8
        }
    } catch {}
}

function Write-UpdateState($result, $details) {
    $state = [ordered]@{
        last_checked = (Get-Date).ToString("o")
        result       = $result
        details      = $details
    }
    try {
        ($state | ConvertTo-Json -Depth 8 -Compress) | Set-Content -LiteralPath $statePath -Encoding UTF8 -ErrorAction Stop
    } catch {}
}

function Get-FileSha256($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash } catch { return $null }
}

# Catches genuine syntax errors (including the "file tokenizes fine under
# UTF-8 but not under this PC's ANSI codepage" class of bug found live
# 2026-08-27) WITHOUT executing a single line of the downloaded file.
function Test-ScriptParses($Path) {
    $tokens = $null
    $errors = $null
    try {
        [void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
        return ($null -eq $errors -or $errors.Count -eq 0)
    } catch {
        return $false
    }
}

function Invoke-SelfTestOnFile($Path) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Path -SelfTest | Out-Null
    return $LASTEXITCODE
}

function Get-RemoteFile($Url, $DestPath) {
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20 -OutFile $DestPath -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Test-BridgeAlive($TargetPort) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/status" -TimeoutSec 5 -ErrorAction Stop
        return ($null -ne $resp -and $resp.ok -eq $true)
    } catch {
        return $false
    }
}

function Backup-InstalledFile($Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
    $backupPath = "$Path.bak-$stamp"
    try {
        Copy-Item -LiteralPath $Path -Destination $backupPath -Force -ErrorAction Stop
    } catch {
        return $null
    }
    $dir = Split-Path -Parent $Path
    $base = Split-Path -Leaf $Path
    Get-ChildItem -LiteralPath $dir -Filter "$base.bak-*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    return $backupPath
}

# Invoked synchronously (not Start-Process) so this script can wait for it
# to finish before checking /status -- array-based argument passing avoids
# all the string-quoting pitfalls of building one big -Command string by
# hand (see install-xray-bridge.ps1's own Get-EnabledSystemsArgs, which
# only needs that approach because IT hands its args to Start-Process for a
# separate detached window; a direct "&" call can just splat an array).
function Invoke-BridgeRestart {
    $installerPath = Join-Path $InstallPath "install-xray-bridge.ps1"
    if (-not (Test-Path -LiteralPath $installerPath)) { return $false }
    $argsList = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installerPath,
        "-InstallPath", $InstallPath,
        "-Port", $Port,
        "-ShortcutName", $ShortcutName,
        "-NoElevate",
        "-UpdateBaseUrl", $UpdateBaseUrl,
        "-PackageFolder", $PackageFolder
    )
    if ($EnabledSystems -and $EnabledSystems.Count -gt 0) {
        $argsList += "-EnabledSystems"
        $argsList += $EnabledSystems
    }
    # Not passing -CompanionScripts here: install-xray-bridge.ps1 has no such
    # parameter, it re-derives $RequiredCompanionScripts from -EnabledSystems
    # itself (see its own header). This script's own -CompanionScripts only
    # controls which companion files THIS script checks/fetches/self-tests.
    & powershell @argsList | Out-Null
    $installerExitCode = $LASTEXITCODE
    Start-Sleep -Seconds 2
    # Require BOTH a clean installer exit AND a live /status -- checking
    # only /status is not enough: if install-xray-bridge.ps1 itself errors
    # out partway through (confirmed live 2026-08-27: a bad file it was
    # asked to apply can make it crash before actually restarting anything),
    # the PREVIOUS bridge process may simply still be sitting there
    # answering on the port, which would otherwise be misread as "the new
    # version came up fine" and skip the rollback that's actually needed.
    return ($installerExitCode -eq 0 -and (Test-BridgeAlive $Port))
}

# ════════════════════════════════════════════════════════════════
# 1. Build the set of managed files: main launcher + installer (kept in
#    sync so future restart/registration logic ships too) + this updater
#    itself (self-sustaining) + any companion scripts this install uses.
# ════════════════════════════════════════════════════════════════
$prefix = if ($PackageFolder) { "tools/$PackageFolder" } else { "tools" }

$managed = New-Object System.Collections.Generic.List[object]
$managed.Add([ordered]@{ name = "xray-local-launcher.ps1"; required = $true; selfTest = $true })
$managed.Add([ordered]@{ name = "install-xray-bridge.ps1"; required = $true; selfTest = $false })
$managed.Add([ordered]@{ name = "xray-bridge-auto-update.ps1"; required = $false; selfTest = $false })
foreach ($c in $CompanionScripts) {
    $managed.Add([ordered]@{ name = $c; required = $false; selfTest = $true })
}

$tempDir = Join-Path $env:TEMP ("xray-bridge-update-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    $fetchFailed = $false
    foreach ($m in $managed) {
        $url = "$UpdateBaseUrl/$prefix/$($m.name)"
        $dest = Join-Path $tempDir $m.name
        $ok = Get-RemoteFile $url $dest
        $m.tempPath = if ($ok) { $dest } else { $null }
        $m.fetched = $ok
        if (-not $ok -and $m.required) { $fetchFailed = $true }
    }

    if ($fetchFailed) {
        Write-UpdateLog "Fetch failed for a required file (site unreachable or path changed) -- leaving current bridge untouched."
        Write-UpdateState "fetch_failed" ([ordered]@{ update_base_url = $UpdateBaseUrl; package_folder = $PackageFolder })
        exit 0
    }

    # ════════════════════════════════════════════════════════════
    # 2. Parse-check every fetched file BEFORE looking at hashes/self-test --
    #    a corrupt/half-downloaded file must never be treated as "identical"
    #    or "different", it must just be rejected outright.
    # ════════════════════════════════════════════════════════════
    $parseFailed = @()
    foreach ($m in $managed) {
        if (-not $m.fetched) { continue }
        if (-not (Test-ScriptParses $m.tempPath)) { $parseFailed += $m.name }
    }
    if ($parseFailed.Count -gt 0) {
        Write-UpdateLog "Downloaded file(s) failed to parse, aborting: $($parseFailed -join ', ')"
        Write-UpdateState "parse_error" ([ordered]@{ failed = $parseFailed })
        exit 1
    }

    # ════════════════════════════════════════════════════════════
    # 3. Hash-compare against what's actually installed. Nothing to do if
    #    every fetched file is byte-identical to what's already running.
    # ════════════════════════════════════════════════════════════
    $changed = New-Object System.Collections.Generic.List[object]
    foreach ($m in $managed) {
        if (-not $m.fetched) { continue }
        $installedPath = Join-Path $InstallPath $m.name
        $before = Get-FileSha256 $installedPath
        $after = Get-FileSha256 $m.tempPath
        if ($before -ne $after) {
            $m.installedPath = $installedPath
            $m.beforeHash = $before
            $m.afterHash = $after
            $changed.Add($m)
        }
    }

    if ($changed.Count -eq 0) {
        Write-UpdateLog "Up to date -- no changes found at $UpdateBaseUrl/$prefix/"
        Write-UpdateState "up_to_date" ([ordered]@{
            launcher_hash = (Get-FileSha256 (Join-Path $InstallPath "xray-local-launcher.ps1"))
        })
        exit 0
    }

    Write-UpdateLog "Change(s) detected: $(($changed | ForEach-Object { $_.name }) -join ', ')"

    # ════════════════════════════════════════════════════════════
    # 4. Self-test every changed file that supports it, from its TEMP
    #    location -- the live install is not touched unless every one of
    #    these passes.
    # ════════════════════════════════════════════════════════════
    $selfTestFailed = @()
    foreach ($m in $changed) {
        if (-not $m.selfTest) { continue }
        $exitCode = Invoke-SelfTestOnFile $m.tempPath
        if ($exitCode -ne 0) { $selfTestFailed += $m.name }
    }
    if ($selfTestFailed.Count -gt 0) {
        Write-UpdateLog "Self-test FAILED for downloaded file(s), NOT applying anything: $($selfTestFailed -join ', ')"
        Write-UpdateState "self_test_failed" ([ordered]@{ failed = $selfTestFailed })
        exit 1
    }
    Write-UpdateLog "Self-test passed for all changed file(s) that support it."

    # ════════════════════════════════════════════════════════════
    # 5. Apply: back up what's there now, then copy the new files in.
    # ════════════════════════════════════════════════════════════
    $backups = @{}
    foreach ($m in $changed) {
        $backups[$m.name] = Backup-InstalledFile $m.installedPath
        Copy-Item -LiteralPath $m.tempPath -Destination $m.installedPath -Force
    }
    Write-UpdateLog "Applied $($changed.Count) file(s). Restarting bridge..."

    # ════════════════════════════════════════════════════════════
    # 6. Restart on the new code, then verify it actually came up. If it
    #    didn't, restore backups and restart again on the OLD code so an
    #    unattended cycle can never leave the clinic with a dead bridge.
    # ════════════════════════════════════════════════════════════
    $alive = Invoke-BridgeRestart
    if ($alive) {
        Write-UpdateLog "Updated successfully -- bridge is responding on port $Port."
        Write-UpdateState "updated" ([ordered]@{
            changed = @($changed | ForEach-Object { [ordered]@{ name = $_.name; before = $_.beforeHash; after = $_.afterHash } })
        })
    } else {
        Write-UpdateLog "New version did NOT come up after restart -- rolling back to the previous version."
        foreach ($m in $changed) {
            $backupPath = $backups[$m.name]
            if ($backupPath -and (Test-Path -LiteralPath $backupPath)) {
                Copy-Item -LiteralPath $backupPath -Destination $m.installedPath -Force
            }
        }
        $recovered = Invoke-BridgeRestart
        if ($recovered) {
            Write-UpdateLog "Rollback succeeded -- bridge is back on the previous version and responding."
            Write-UpdateState "rollback_applied" ([ordered]@{ attempted = @($changed | ForEach-Object { $_.name }) })
        } else {
            Write-UpdateLog "ROLLBACK FAILED -- bridge is not responding even on the previous version. Needs a person to check this PC."
            Write-UpdateState "rollback_failed_bridge_down" ([ordered]@{ attempted = @($changed | ForEach-Object { $_.name }) })
        }
    }
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
