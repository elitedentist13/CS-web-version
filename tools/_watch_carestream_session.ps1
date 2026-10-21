# tools/_watch_carestream_session.ps1
# Background observer for a FULL Clinic Solution -> Carestream / Trophy
# session so we can copy the working patient-handoff into Banana.
#
# Clinic Solution reference (captured 2026-09-27 on XRAY-MCP):
#   CS.exe launches:
#     TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{chart} -N{name} -F{name}
#   New chart with no films yet often uses chart 000000 and -NNEW -FNEW.
#   Consultation clients use Patient.exe (no -P); this session watcher
#   still records Patient.exe / CSDML / Monitor so client PCs are covered.
#
# Watches (copy-only — never moves/deletes originals):
#   1. Process create: TW.exe, Patient.exe, CS.exe, Trophy, CSDML*, Monitor
#   2. Filesystem: Carestream CSImaging / Patient Browser / CSDML folders
#      (small xml/ini/txt/log/dat/tmp/json handoff files)
#   3. SCAN share(s): new patient folders and small metadata under
#      \\RECEPTION_MCP\IMAGE\SCAN (and other known roots if reachable)
#
# Click-through while this runs (Clinic Solution — NOT Banana):
#   A. Open Clinic Solution (CS.exe) if not already running
#   B. Open a patient who ALREADY has Carestream films -> Carestream / F7
#   C. Open a patient with NO films (or a brand-new chart) -> Carestream / F7
#      (expect TW.exe -P...\SCAN\000000 -NNEW -FNEW or a real chart folder)
#   D. Optionally acquire a new x-ray in Trophy / CS Imaging
#   E. Press Ctrl+C here when finished
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\_watch_carestream_session.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\_watch_carestream_session.ps1 -DurationSec 1200
#   Or double-click: tools\Watch Carestream Session.bat
#
# Outputs:
#   tools\_carestream_session_captures\<timestamp>\   copied files + session.log
#   tools\_carestream_session_watch_log.txt           append-only master log

param(
    [int]$DurationSec = 1200,
    [string[]]$ExtraWatchDirs = @(),
    [switch]$SkipScanShares
)

$ErrorActionPreference = "Continue"
$toolsDir = $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$captureRoot = Join-Path $toolsDir "_carestream_session_captures"
$sessionDir = Join-Path $captureRoot $stamp
$filesDir = Join-Path $sessionDir "files"
$baselineDir = Join-Path $sessionDir "baseline"
$masterLog = Join-Path $toolsDir "_carestream_session_watch_log.txt"
$sessionLog = Join-Path $sessionDir "session.log"
$stopFile = Join-Path $sessionDir "STOP"

New-Item -ItemType Directory -Path $filesDir -Force | Out-Null
New-Item -ItemType Directory -Path $baselineDir -Force | Out-Null

function Write-SessionLog([string]$Msg, [string]$Color = "Gray") {
    $line = "$(Get-Date -Format 'HH:mm:ss.fff')  $Msg"
    Write-Host $line -ForegroundColor $Color
    Add-Content -LiteralPath $sessionLog -Value $line -Encoding UTF8
    Add-Content -LiteralPath $masterLog -Value $line -Encoding UTF8
}

function Test-CarestreamProcName([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name)) { return $false }
    return $Name -match '(?i)^(CS\.exe|CSStarter\.exe|Patient\.exe|TW\.exe|Trophy\.exe|CSImaging\.exe|CSDIA\.exe|CSBridge\.exe|PMSBridge\.exe|CSDMLite\.exe|CSDMLwdog\.exe|monitor\.exe)$'
}

function Get-ScanRoots {
    $roots = New-Object System.Collections.Generic.List[string]
    $cfg = Join-Path $toolsDir "installer-carestream-mcp\xray-launcher-config.ps1"
    if (Test-Path -LiteralPath $cfg) {
        try {
            # Pull quoted UNC/local paths without executing the config (safe).
            $raw = Get-Content -LiteralPath $cfg -Raw -ErrorAction Stop
            foreach ($m in [regex]::Matches($raw, '"(\\\\[^"]+|C:\\[^"]+)"')) {
                $p = $m.Groups[1].Value
                if ($p -match '(?i)SCAN' -and -not $roots.Contains($p)) { $roots.Add($p) }
            }
        } catch {}
    }
    foreach ($share in @(
        "\\RECEPTION_MCP\IMAGE\SCAN",
        "\\CSMAIN\IMAGE\Scan",
        "\\RECEPTION\IMAGE\SCAN",
        "C:\Image\SCAN",
        "C:\Image\Scan"
    )) {
        if (-not $roots.Contains($share)) { $roots.Add($share) }
    }
    return $roots
}

"=== Carestream session watch started $(Get-Date -Format o) ===" | Out-File -LiteralPath $masterLog -Append -Encoding UTF8
"Session folder: $sessionDir" | Add-Content -LiteralPath $masterLog -Encoding UTF8
"" | Out-File -LiteralPath $sessionLog -Encoding UTF8

$meta = [ordered]@{
    started = (Get-Date).ToString("o")
    computer = $env:COMPUTERNAME
    user = $env:USERNAME
    duration_sec = $DurationSec
    stop_file = $stopFile
    purpose = "Observe Clinic Solution Carestream/Trophy patient handoff + SCAN activity (ready for new x-ray)"
    reference_cmdline = 'TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{chart} -N{name} -F{name}'
}
$meta | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sessionDir "session.json") -Encoding UTF8

# --- Shortcut + known Carestream paths ---
$shortcut = "C:\Users\Public\Desktop\CS Imaging Software.lnk"
$carestreamDirs = New-Object System.Collections.Generic.List[string]
foreach ($d in @(
    "C:\Program Files (x86)\Carestream\CSImaging",
    "C:\Program Files\Carestream\CSImaging",
    "C:\Program Files (x86)\Carestream\Patient Browser",
    "C:\Program Files\Carestream\Patient Browser",
    "C:\Program Files (x86)\Carestream\CSDML",
    "C:\Program Files\Carestream\CSDML"
)) {
    if (Test-Path -LiteralPath $d) { $carestreamDirs.Add($d) }
}

Write-SessionLog "Session capture dir: $sessionDir" "Cyan"
Write-SessionLog "Duration: $DurationSec sec  (Ctrl+C or create STOP file to end early)" "Cyan"
Write-SessionLog "STOP file: $stopFile" "DarkGray"

if (Test-Path -LiteralPath $shortcut) {
    try {
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($shortcut)
        Write-SessionLog "SHORTCUT target=$($lnk.TargetPath)" "Cyan"
        Write-SessionLog "SHORTCUT args=$($lnk.Arguments)" "Cyan"
        Write-SessionLog "SHORTCUT workdir=$($lnk.WorkingDirectory)" "Cyan"
        $scDir = Split-Path -Parent $lnk.TargetPath
        if ($scDir -and (Test-Path -LiteralPath $scDir) -and -not $carestreamDirs.Contains($scDir)) {
            $carestreamDirs.Add($scDir)
        }
    } catch {
        Write-SessionLog "SHORTCUT present but unreadable: $($_.Exception.Message)" "Yellow"
    }
} else {
    Write-SessionLog "SHORTCUT missing: $shortcut" "Yellow"
}

$twCandidates = @(
    "C:\Program Files (x86)\Carestream\CSImaging\TW.exe",
    "C:\Program Files\Carestream\CSImaging\TW.exe"
)
$twFound = $twCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($twFound) {
    Write-SessionLog "TW.exe found: $twFound" "Green"
} else {
    Write-SessionLog "TW.exe not found on this PC (consultation client may only have Patient.exe)" "Yellow"
}

# --- Watch directories ---
$watchDirs = New-Object System.Collections.Generic.List[string]
foreach ($d in $carestreamDirs) { $watchDirs.Add($d) }
foreach ($d in $ExtraWatchDirs) {
    if ($d -and (Test-Path -LiteralPath $d) -and -not $watchDirs.Contains($d)) { $watchDirs.Add($d) }
}

$reachableScan = New-Object System.Collections.Generic.List[string]
if (-not $SkipScanShares) {
    foreach ($share in Get-ScanRoots) {
        if (Test-Path -LiteralPath $share) {
            $reachableScan.Add($share)
            if (-not $watchDirs.Contains($share)) { $watchDirs.Add($share) }
            Write-SessionLog "SCAN root reachable: $share" "Green"
        } else {
            Write-SessionLog "SCAN root not reachable: $share" "DarkGray"
        }
    }
}

# --- Baseline: already-running imaging / CS processes ---
$procSnap = Join-Path $baselineDir "processes_at_start.txt"
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { (Test-CarestreamProcName $_.Name) -or ($_.CommandLine -match '(?i)Carestream|CSImaging|\\IMAGE\\SCAN') } |
    ForEach-Object {
        "pid=$($_.ProcessId) parent=$($_.ParentProcessId) name=$($_.Name) exe=$($_.ExecutablePath) cmdline=$($_.CommandLine)"
    } | Set-Content -LiteralPath $procSnap -Encoding UTF8
Write-SessionLog "Baseline processes -> baseline\processes_at_start.txt" "Green"

# --- FSW action ---
$fswAction = {
    $md = $Event.MessageData
    $path = $Event.SourceEventArgs.FullPath
    $changeType = [string]$Event.SourceEventArgs.ChangeType
    $name = $Event.SourceEventArgs.Name
    $ts = Get-Date -Format "HH:mm:ss.fff"
    $ext = [IO.Path]::GetExtension($name)

    if ($ext -match '(?i)\.(exe|dll|pdb|msi|cab|zip|7z|sys)$') { return }
    if ($name -match '(?i)^(ntdll|kernel|msvcrt)') { return }

    $line = "$ts  FSW [$($md.Label)] $changeType  $path"
    Write-Host $line
    Add-Content -LiteralPath $md.SessionLog -Value $line -Encoding UTF8
    Add-Content -LiteralPath $md.MasterLog -Value $line -Encoding UTF8

    # SCAN: also note new patient folders (chart digits)
    if ($md.IsScan -and $changeType -match 'Created|Renamed') {
        if ($name -match '^\d{4,8}$' -or $path -match '(?i)\\SCAN\\(\d{4,8})(?:\\|$)') {
            $chart = if ($Matches[1]) { $Matches[1] } else { $name }
            $peek = "$(Get-Date -Format 'HH:mm:ss.fff')  SCAN-CHART  $chart  path=$path"
            Write-Host $peek -ForegroundColor Yellow
            Add-Content -LiteralPath $md.SessionLog -Value $peek -Encoding UTF8
            Add-Content -LiteralPath $md.MasterLog -Value $peek -Encoding UTF8
        }
    }

    $copyExtOk = $ext -match '(?i)\.(xml|ini|cfg|txt|log|dat|json|tmp|csv)$'
    if (-not $copyExtOk) { return }

    for ($i = 0; $i -lt 25; $i++) {
        if (-not (Test-Path -LiteralPath $path)) {
            Start-Sleep -Milliseconds 40
            continue
        }
        try {
            $item = Get-Item -LiteralPath $path -ErrorAction Stop
            if ($item.PSIsContainer) { return }
            if ($item.Length -gt 512KB) { return }
            $safeLeaf = ($name -replace '[^\w\.\-]+', '_')
            $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_${changeType}_$safeLeaf"
            $dest = Join-Path $md.FilesDir $destName
            Copy-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
            $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [$($md.Label)/$changeType] $path -> $dest ($($item.Length) bytes)"
            Write-Host $msg -ForegroundColor Green
            Add-Content -LiteralPath $md.SessionLog -Value $msg -Encoding UTF8
            Add-Content -LiteralPath $md.MasterLog -Value $msg -Encoding UTF8

            if ($item.Length -lt 64KB) {
                try {
                    $text = [IO.File]::ReadAllText($path)
                    $hits = [regex]::Matches($text, '(?i)(-P\\\\?[^\s"]+|\\IMAGE\\SCAN\\\d+|patient|chart|NEW)[^\r\n]{0,100}')
                    $n = 0
                    foreach ($h in $hits) {
                        if ($n -ge 8) { break }
                        $peek2 = "$(Get-Date -Format 'HH:mm:ss.fff')  PEEK  $($h.Value)"
                        Write-Host $peek2 -ForegroundColor DarkYellow
                        Add-Content -LiteralPath $md.SessionLog -Value $peek2 -Encoding UTF8
                        $n++
                    }
                } catch {}
            }
            break
        } catch {
            Start-Sleep -Milliseconds 40
        }
    }
}

$watchers = New-Object System.Collections.Generic.List[object]
$subs = New-Object System.Collections.Generic.List[object]

foreach ($dir in $watchDirs) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $isScan = $false
    foreach ($s in $reachableScan) {
        if ($dir -eq $s) { $isScan = $true; break }
    }
    Write-SessionLog "FSW watching: $dir$(if ($isScan) { '  [SCAN]' })" "Cyan"
    try {
        $fsw = New-Object System.IO.FileSystemWatcher $dir
        $fsw.Filter = "*.*"
        $fsw.IncludeSubdirectories = $true
        $fsw.NotifyFilter = [IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size, CreationTime'
        $fsw.EnableRaisingEvents = $true
        $md = @{
            Label      = $dir
            SessionLog = $sessionLog
            MasterLog  = $masterLog
            FilesDir   = $filesDir
            IsScan     = $isScan
        }
        $subs.Add((Register-ObjectEvent -InputObject $fsw -EventName Created -MessageData $md -Action $fswAction))
        $subs.Add((Register-ObjectEvent -InputObject $fsw -EventName Changed -MessageData $md -Action $fswAction))
        $subs.Add((Register-ObjectEvent -InputObject $fsw -EventName Renamed -MessageData $md -Action $fswAction))
        $watchers.Add($fsw)
    } catch {
        Write-SessionLog "FSW failed on $dir : $($_.Exception.Message)" "Yellow"
    }
}

# --- WMI process creation (Clinic Solution + Carestream family) ---
$wmiQuery = @"
SELECT * FROM __InstanceCreationEvent WITHIN 1
WHERE TargetInstance ISA 'Win32_Process'
AND (
    TargetInstance.Name = 'CS.exe' OR
    TargetInstance.Name = 'CSStarter.exe' OR
    TargetInstance.Name = 'Patient.exe' OR
    TargetInstance.Name = 'TW.exe' OR
    TargetInstance.Name = 'Trophy.exe' OR
    TargetInstance.Name = 'CSImaging.exe' OR
    TargetInstance.Name = 'CSDIA.exe' OR
    TargetInstance.Name = 'CSBridge.exe' OR
    TargetInstance.Name = 'PMSBridge.exe' OR
    TargetInstance.Name = 'CSDMLite.exe' OR
    TargetInstance.Name = 'CSDMLwdog.exe' OR
    TargetInstance.Name = 'monitor.exe'
)
"@

Write-SessionLog "WMI process watcher: CS.exe / TW.exe / Patient.exe / CSDML* / Monitor" "Cyan"
$wmiSub = Register-CimIndicationEvent -Query $wmiQuery -MessageData @{
    SessionLog = $sessionLog
    MasterLog  = $masterLog
    FilesDir   = $filesDir
} -Action {
    $md = $Event.MessageData
    $proc = $Event.SourceEventArgs.NewEvent.TargetInstance
    $ts = Get-Date -Format "HH:mm:ss.fff"
    $cmd = [string]$proc.CommandLine
    $line = "$ts  PROCESS START  name=$($proc.Name) pid=$($proc.ProcessId) parent=$($proc.ParentProcessId) exe=$($proc.ExecutablePath) cmdline=$cmd"
    Write-Host $line -ForegroundColor Magenta
    Add-Content -LiteralPath $md.SessionLog -Value $line -Encoding UTF8
    Add-Content -LiteralPath $md.MasterLog -Value $line -Encoding UTF8

    # Highlight Clinic Solution Trophy handoff (the contract Banana copies)
    if ($cmd -match '(?i)TW\.exe' -or ($proc.Name -match '(?i)^TW\.exe$')) {
        $hl = "$ts  HANDOFF  Clinic Solution style TW.exe launch captured"
        Write-Host $hl -ForegroundColor Green
        Add-Content -LiteralPath $md.SessionLog -Value $hl -Encoding UTF8
        Add-Content -LiteralPath $md.MasterLog -Value $hl -Encoding UTF8
        if ($cmd -match '(?i)-P\\?"?([^"\s]+)') {
            $scanArg = $Matches[1]
            $peek = "$ts  HANDOFF -P path = $scanArg"
            Write-Host $peek -ForegroundColor Yellow
            Add-Content -LiteralPath $md.SessionLog -Value $peek -Encoding UTF8
        }
        if ($cmd -match '(?i)-N([^\s-][^\r\n]*)') {
            $nArg = $Matches[1].Trim()
            $peekN = "$ts  HANDOFF -N/-F label = $nArg"
            Write-Host $peekN -ForegroundColor Yellow
            Add-Content -LiteralPath $md.SessionLog -Value $peekN -Encoding UTF8
        }
    }

    # Copy any small handoff file named on the command line
    $rx = [regex]'(?i)(?:"([^"]+\.(?:tmp|xml|ini|txt|json|dat))"|(\S+\.(?:tmp|xml|ini|txt|json|dat)))'
    foreach ($m in $rx.Matches($cmd)) {
        $path = if ($m.Groups[1].Success -and $m.Groups[1].Value) { $m.Groups[1].Value } else { $m.Groups[2].Value }
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        if ($path -match '(?i)\.(jpg|jpeg|png|bmp|tif|tiff|dcm)$') { continue }
        for ($i = 0; $i -lt 25; $i++) {
            if (Test-Path -LiteralPath $path) {
                try {
                    $item = Get-Item -LiteralPath $path -ErrorAction Stop
                    if ($item.Length -le 512000) {
                        $dest = Join-Path $md.FilesDir ("$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_at_process_" + (Split-Path -Leaf $path))
                        Copy-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
                        $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [WMI-at-launch] $path -> $dest ($($item.Length) bytes)"
                        Write-Host $msg -ForegroundColor Green
                        Add-Content -LiteralPath $md.SessionLog -Value $msg -Encoding UTF8
                        Add-Content -LiteralPath $md.MasterLog -Value $msg -Encoding UTF8
                    }
                } catch {}
                break
            }
            Start-Sleep -Milliseconds 40
        }
    }
}
$subs.Add($wmiSub)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " Carestream session observer is RUNNING" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " Do this in Clinic Solution (NOT Banana), in order:" -ForegroundColor White
Write-Host "   1. Open / focus Clinic Solution (CS.exe)" -ForegroundColor White
Write-Host "   2. Patient WITH existing Carestream films -> Carestream / Trophy / F7" -ForegroundColor White
Write-Host "   3. Patient with NO films (or new chart) -> same Carestream button" -ForegroundColor White
Write-Host "      (expect TW.exe -P...\SCAN\{chart|000000} -N... -F...)" -ForegroundColor DarkGray
Write-Host "   4. Optionally take a NEW x-ray in Trophy / CS Imaging" -ForegroundColor White
Write-Host "   5. Press Ctrl+C here, or create the STOP file, when finished" -ForegroundColor White
Write-Host ""
Write-Host " Captures: $sessionDir" -ForegroundColor Cyan
Write-Host " STOP file: $stopFile" -ForegroundColor Cyan
Write-Host " Waiting up to $DurationSec seconds." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""

Write-SessionLog "Watchers armed. Begin Clinic Solution click-through now." "Green"
Write-SessionLog "READY - observer is live; click Carestream / F7 in Clinic Solution." "Green"

$deadline = (Get-Date).AddSeconds($DurationSec)
$nextBeat = (Get-Date).AddSeconds(30)
try {
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $stopFile) {
            Write-SessionLog "STOP file found." "Yellow"
            break
        }
        if ((Get-Date) -ge $nextBeat) {
            Write-SessionLog "still watching" "DarkGray"
            $nextBeat = (Get-Date).AddSeconds(30)
        }
        Start-Sleep -Milliseconds 500
    }
    if ((Get-Date) -ge $deadline -and -not (Test-Path -LiteralPath $stopFile)) {
        Write-SessionLog "Duration elapsed — stopping." "Yellow"
    }
} catch {
    Write-SessionLog "Stopped: $($_.Exception.Message)" "Yellow"
} finally {
    foreach ($s in $subs) {
        try { Unregister-Event -SourceIdentifier $s.Name -ErrorAction SilentlyContinue } catch {}
        try { $s | Remove-Job -Force -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($w in $watchers) {
        try { $w.EnableRaisingEvents = $false; $w.Dispose() } catch {}
    }

    $procEnd = Join-Path $sessionDir "processes_at_end.txt"
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { (Test-CarestreamProcName $_.Name) -or ($_.CommandLine -match '(?i)Carestream|CSImaging|\\IMAGE\\SCAN') } |
        ForEach-Object {
            "pid=$($_.ProcessId) parent=$($_.ParentProcessId) name=$($_.Name) exe=$($_.ExecutablePath) cmdline=$($_.CommandLine)"
        } | Set-Content -LiteralPath $procEnd -Encoding UTF8

    $fileCount = @(Get-ChildItem -LiteralPath $filesDir -File -ErrorAction SilentlyContinue).Count
    $readme = @"
Carestream / Clinic Solution session capture $stamp
====================================================
Duration requested: $DurationSec sec
Captured file copies: $fileCount
Log: session.log
STOP file was: $stopFile

Clinic Solution reference handoff
---------------------------------
TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{chart} -N{name} -F{name}
New chart without films often uses 000000 + -NNEW -FNEW
(Banana: Start-TrophyTwPatient / Build-TrophyTwCommandLine)

Click-through checklist
-----------------------
[ ] CS.exe open
[ ] Existing-films patient -> Carestream / F7 (capture TW.exe cmdline)
[ ] No-films / new patient -> Carestream / F7 (000000 or new SCAN folder)
[ ] Optional: take new x-ray in Trophy
[ ] Note chart no. and -N/-F label from HANDOFF lines in session.log

What to send back for Banana wiring
-----------------------------------
1. session.log (PROCESS START + HANDOFF + SCAN-CHART lines)
2. Any small xml/ini/tmp copies under files\
3. Whether -P path was quoted or unquoted on this PC
4. SCAN root that actually received the chart folder

Banana copy target: tools\xray-local-launcher.ps1
  Start-TrophyTwPatient / Start-CarestreamImagingPatient
"@
    Set-Content -LiteralPath (Join-Path $sessionDir "README.txt") -Value $readme -Encoding UTF8

    Write-SessionLog "=== watch ended $(Get-Date -Format o) === captured_files=$fileCount folder=$sessionDir" "Cyan"
    Write-Host ""
    Write-Host "Done. Read: $sessionLog" -ForegroundColor Cyan
}
