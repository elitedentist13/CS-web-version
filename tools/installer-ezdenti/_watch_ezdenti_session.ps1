# tools/_watch_ezdenti_session.ps1
# Background observer for a FULL manual EzDent-i desktop session so we can
# copy the working gateway into Banana.
#
# Watches (copy-only — never moves/deletes originals):
#   1. Process create: every VTE* / EzDent / VTEzBridge / ReqAdmin exe
#      (full command line + working directory when available)
#   2. Filesystem: EzDent-i Bin\  — Linkage.xml, *.ini, *.cfg, *.txt, *.log,
#      *.dat, *.xml (Created/Changed)
#   3. Filesystem: %LOCALAPPDATA%\VirtualStore\...\EzDent-i\Bin\
#      (non-admin writes that ReqAdmin may not see)
#   4. Optional data roots (SCAN / Image) for new OPG file drops
#
# Click-through while this runs (desktop icon — NOT Banana):
#   A. Cold-start EzDent-i from the desktop shortcut
#   B. Search → open patient chart (e.g. 021474)
#   C. Acquisition → Panorama → take OPG
#   D. Note any study/file id that appears (e.g. 022194)
#   E. Quit EzDent-i when done (optional second pass from Banana later)
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\_watch_ezdenti_session.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\_watch_ezdenti_session.ps1 -DurationSec 900
#   Or double-click: tools\Watch EzDent-i Session.bat
#
# Outputs:
#   tools\_ezdenti_session_captures\<timestamp>\   copied files + session.log
#   tools\_ezdenti_session_watch_log.txt           append-only master log

param(
    [int]$DurationSec = 900,
    [string]$EzdentiBin = "C:\Program Files (x86)\VATECH\EzDent-i\Bin",
    [string[]]$ExtraWatchDirs = @(),
    [switch]$IncludeScanShares
)

$ErrorActionPreference = "Continue"
$toolsDir = $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$captureRoot = Join-Path $toolsDir "_ezdenti_session_captures"
$sessionDir = Join-Path $captureRoot $stamp
$filesDir = Join-Path $sessionDir "files"
$baselineDir = Join-Path $sessionDir "baseline"
$masterLog = Join-Path $toolsDir "_ezdenti_session_watch_log.txt"
$sessionLog = Join-Path $sessionDir "session.log"

New-Item -ItemType Directory -Path $filesDir -Force | Out-Null
New-Item -ItemType Directory -Path $baselineDir -Force | Out-Null

function Write-SessionLog([string]$Msg, [string]$Color = "Gray") {
    $line = "$(Get-Date -Format 'HH:mm:ss.fff')  $Msg"
    Write-Host $line -ForegroundColor $Color
    Add-Content -LiteralPath $sessionLog -Value $line -Encoding UTF8
    Add-Content -LiteralPath $masterLog -Value $line -Encoding UTF8
}

"=== EzDent-i session watch started $(Get-Date -Format o) ===" | Out-File -LiteralPath $masterLog -Append -Encoding UTF8
"Session folder: $sessionDir" | Add-Content -LiteralPath $masterLog -Encoding UTF8
"" | Out-File -LiteralPath $sessionLog -Encoding UTF8

if (-not (Test-Path -LiteralPath $EzdentiBin)) {
    $alt = "C:\Program Files\VATECH\EzDent-i\Bin"
    if (Test-Path -LiteralPath $alt) {
        $EzdentiBin = $alt
    } else {
        Write-Host "EzDent-i Bin not found: $EzdentiBin" -ForegroundColor Red
        Write-Host "Pass -EzdentiBin `"C:\path\to\EzDent-i\Bin`"" -ForegroundColor Yellow
        exit 1
    }
}

$vsBin = Join-Path $env:LOCALAPPDATA "VirtualStore\Program Files (x86)\VATECH\EzDent-i\Bin"
$vsBinAlt = Join-Path $env:LOCALAPPDATA "VirtualStore\Program Files\VATECH\EzDent-i\Bin"

$watchDirs = New-Object System.Collections.Generic.List[string]
$watchDirs.Add($EzdentiBin)
# Real session activity (search / acquire) lands here — Bin alone is quiet.
$ezRoot = Split-Path -Parent $EzdentiBin
foreach ($sub in @("Log", "Setting", "Cache", "Cache\Thumbnails")) {
    $p = Join-Path $ezRoot $sub
    if (Test-Path -LiteralPath $p) { $watchDirs.Add($p) }
}
if (Test-Path -LiteralPath $vsBin) { $watchDirs.Add($vsBin) }
if (Test-Path -LiteralPath $vsBinAlt) { $watchDirs.Add($vsBinAlt) }
foreach ($d in $ExtraWatchDirs) {
    if ($d -and (Test-Path -LiteralPath $d)) { $watchDirs.Add($d) }
}
if ($IncludeScanShares) {
    foreach ($share in @(
        "\\CSMAIN\IMAGE\Scan",
        "\\RECEPTION_MCP\IMAGE\SCAN",
        "\\RECEPTION\IMAGE\SCAN",
        "C:\Image\SCAN",
        "C:\Image"
    )) {
        if (Test-Path -LiteralPath $share) { $watchDirs.Add($share) }
    }
}

Write-SessionLog "Session capture dir: $sessionDir" "Cyan"
Write-SessionLog "Duration: $DurationSec sec  (Ctrl+C to stop early)" "Cyan"
Write-SessionLog "EzDent Bin: $EzdentiBin" "Cyan"

# --- Baseline snapshot of Bin (small text-ish files only) ---
Write-SessionLog "Taking Bin baseline snapshot..." "Yellow"
$baselineMeta = Join-Path $baselineDir "bin_listing.txt"
Get-ChildItem -LiteralPath $EzdentiBin -File -ErrorAction SilentlyContinue |
    Sort-Object Name |
    ForEach-Object {
        "{0}`t{1}`t{2}" -f $_.Name, $_.Length, $_.LastWriteTime.ToString("o")
    } | Set-Content -LiteralPath $baselineMeta -Encoding UTF8

Get-ChildItem -LiteralPath $EzdentiBin -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Length -lt 512KB -and
        $_.Extension -match '\.(xml|ini|cfg|txt|log|dat|json)$'
    } |
    ForEach-Object {
        try {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $baselineDir $_.Name) -Force -ErrorAction Stop
        } catch {}
    }

# Snapshot already-running EzDent processes
$procSnap = Join-Path $baselineDir "processes_at_start.txt"
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '(?i)^(VTE|VTEz|EzDent)' } |
    ForEach-Object {
        "pid=$($_.ProcessId) name=$($_.Name) cmdline=$($_.CommandLine)"
    } | Set-Content -LiteralPath $procSnap -Encoding UTF8
Write-SessionLog "Baseline done. Already-running VTE/EzDent processes listed in baseline\processes_at_start.txt" "Green"

# --- Capture helper (used from event runspaces via MessageData) ---
$fswAction = {
    $md = $Event.MessageData
    $path = $Event.SourceEventArgs.FullPath
    $changeType = [string]$Event.SourceEventArgs.ChangeType
    $name = $Event.SourceEventArgs.Name
    $ts = Get-Date -Format "HH:mm:ss.fff"
    $ext = [IO.Path]::GetExtension($name)

    # Skip huge binaries / noise
    if ($ext -match '(?i)\.(exe|dll|pdb|msi|cab|zip|7z)$') { return }
    if ($name -match '(?i)^(ntdll|kernel|msvcrt)') { return }

    $line = "$ts  FSW [$($md.Label)] $changeType  $path"
    Write-Host $line
    Add-Content -LiteralPath $md.SessionLog -Value $line -Encoding UTF8
    Add-Content -LiteralPath $md.MasterLog -Value $line -Encoding UTF8

    # Only copy small-ish text-ish / handoff files
    $copyExtOk = $ext -match '(?i)\.(xml|ini|cfg|txt|log|dat|json|tmp|csv)$' -or $name -match '(?i)linkage'
    if (-not $copyExtOk) { return }

    for ($i = 0; $i -lt 25; $i++) {
        if (-not (Test-Path -LiteralPath $path)) {
            Start-Sleep -Milliseconds 40
            continue
        }
        try {
            $item = Get-Item -LiteralPath $path -ErrorAction Stop
            if ($item.Length -gt 2MB) { return }
            $safeLeaf = ($name -replace '[^\w\.\-]+', '_')
            $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_${changeType}_$safeLeaf"
            $dest = Join-Path $md.FilesDir $destName
            Copy-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
            $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [$($md.Label)/$changeType] $path -> $dest ($($item.Length) bytes)"
            Write-Host $msg -ForegroundColor Green
            Add-Content -LiteralPath $md.SessionLog -Value $msg -Encoding UTF8
            Add-Content -LiteralPath $md.MasterLog -Value $msg -Encoding UTF8

            # Quick peek for chart / study ids in small text files
            if ($item.Length -lt 64KB -and $ext -match '(?i)\.(xml|ini|cfg|txt|log|json)$') {
                try {
                    $text = [IO.File]::ReadAllText($path)
                    $hits = [regex]::Matches($text, '(?i)(ChartNumber|Patient|021474|022194|Linkage|External\s*Link)[^\r\n]{0,80}')
                    foreach ($h in $hits) {
                        $peek = "$(Get-Date -Format 'HH:mm:ss.fff')  PEEK  $($h.Value)"
                        Write-Host $peek -ForegroundColor DarkYellow
                        Add-Content -LiteralPath $md.SessionLog -Value $peek -Encoding UTF8
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
    Write-SessionLog "FSW watching: $dir" "Cyan"
    $fsw = New-Object System.IO.FileSystemWatcher $dir
    $fsw.Filter = "*.*"
    $fsw.IncludeSubdirectories = $true
    $fsw.NotifyFilter = [IO.NotifyFilters]'FileName, LastWrite, Size, CreationTime'
    $fsw.EnableRaisingEvents = $true
    $md = @{
        Label      = $dir
        SessionLog = $sessionLog
        MasterLog  = $masterLog
        FilesDir   = $filesDir
    }
    $subs.Add((Register-ObjectEvent -InputObject $fsw -EventName Created -MessageData $md -Action $fswAction))
    $subs.Add((Register-ObjectEvent -InputObject $fsw -EventName Changed -MessageData $md -Action $fswAction))
    $subs.Add((Register-ObjectEvent -InputObject $fsw -EventName Renamed -MessageData $md -Action $fswAction))
    $watchers.Add($fsw)
}

# --- Process creation watcher (broad VTE / EzDent family) ---
# WITHIN 1 = poll every second. Names cover loaders, ReqAdmin, bridge, app.
$wmiQuery = @"
SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process'
AND (
  TargetInstance.Name LIKE 'VTE%.exe'
  OR TargetInstance.Name LIKE 'VTEz%.exe'
  OR TargetInstance.Name LIKE 'EzDent%.exe'
  OR TargetInstance.Name = 'VTEzBridge32.exe'
  OR TargetInstance.Name = 'VTEzBridge.exe'
)
"@

Write-SessionLog "WMI process watcher: VTE* / VTEz* / EzDent* / VTEzBridge*" "Cyan"
$wmiSub = Register-CimIndicationEvent -Query $wmiQuery -MessageData @{
    SessionLog = $sessionLog
    MasterLog  = $masterLog
    FilesDir   = $filesDir
    EzdentiBin = $EzdentiBin
    VsBin      = $vsBin
} -Action {
    $md = $Event.MessageData
    $proc = $Event.SourceEventArgs.NewEvent.TargetInstance
    $ts = Get-Date -Format "HH:mm:ss.fff"
    $line = "$ts  PROCESS START  name=$($proc.Name) pid=$($proc.ProcessId) cmdline=$($proc.CommandLine)"
    Write-Host $line -ForegroundColor Magenta
    Add-Content -LiteralPath $md.SessionLog -Value $line -Encoding UTF8
    Add-Content -LiteralPath $md.MasterLog -Value $line -Encoding UTF8

    # Snapshot Linkage.xml from Bin + VirtualStore at process spawn
    foreach ($dir in @($md.EzdentiBin, $md.VsBin)) {
        if ([string]::IsNullOrWhiteSpace($dir)) { continue }
        foreach ($leaf in @("Linkage.xml", "linkage.xml")) {
            $xmlPath = Join-Path $dir $leaf
            for ($i = 0; $i -lt 15; $i++) {
                if (Test-Path -LiteralPath $xmlPath) {
                    try {
                        $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_at_process_$($proc.Name)_$leaf"
                        $dest = Join-Path $md.FilesDir $destName
                        Copy-Item -LiteralPath $xmlPath -Destination $dest -Force -ErrorAction Stop
                        $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [WMI-at-launch] $xmlPath -> $dest"
                        Write-Host $msg -ForegroundColor Green
                        Add-Content -LiteralPath $md.SessionLog -Value $msg -Encoding UTF8
                        Add-Content -LiteralPath $md.MasterLog -Value $msg -Encoding UTF8
                        break
                    } catch {}
                }
                Start-Sleep -Milliseconds 50
            }
        }
    }
}
$subs.Add($wmiSub)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " EzDent-i session observer is RUNNING" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host " Do this on the DESKTOP icon (not Banana), in order:" -ForegroundColor White
Write-Host "   1. Fully quit EzDent-i if it is already open" -ForegroundColor White
Write-Host "   2. Double-click the EzDent-i desktop shortcut" -ForegroundColor White
Write-Host "   3. Search and open patient chart 021474 (or your test chart)" -ForegroundColor White
Write-Host "   4. Acquisition -> Panorama -> take a new OPG" -ForegroundColor White
Write-Host "   5. Note any study/file id that appears (e.g. 022194)" -ForegroundColor White
Write-Host "   6. Optionally quit EzDent-i when finished" -ForegroundColor White
Write-Host ""
Write-Host " Captures: $sessionDir" -ForegroundColor Cyan
Write-Host " Press Ctrl+C when done, or wait $DurationSec seconds." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""

Write-SessionLog "Watchers armed. Begin desktop click-through now." "Green"

$deadline = (Get-Date).AddSeconds($DurationSec)
try {
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
    Write-SessionLog "Duration elapsed — stopping." "Yellow"
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

    # End-of-session process list + Bin listing delta hint
    $procEnd = Join-Path $sessionDir "processes_at_end.txt"
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)^(VTE|VTEz|EzDent)' } |
        ForEach-Object {
            "pid=$($_.ProcessId) name=$($_.Name) cmdline=$($_.CommandLine)"
        } | Set-Content -LiteralPath $procEnd -Encoding UTF8

    $endListing = Join-Path $sessionDir "bin_listing_at_end.txt"
    Get-ChildItem -LiteralPath $EzdentiBin -File -ErrorAction SilentlyContinue |
        Sort-Object Name |
        ForEach-Object {
            "{0}`t{1}`t{2}" -f $_.Name, $_.Length, $_.LastWriteTime.ToString("o")
        } | Set-Content -LiteralPath $endListing -Encoding UTF8

    $fileCount = @(Get-ChildItem -LiteralPath $filesDir -File -ErrorAction SilentlyContinue).Count
    $readme = @"
EzDent-i session capture $stamp
================================
Duration requested: $DurationSec sec
Bin: $EzdentiBin
Captured file copies: $fileCount
Log: session.log

Click-through checklist
-----------------------
[ ] Cold-start from desktop EzDent-i icon
[ ] Search / open patient chart (note chart no.)
[ ] Acquisition -> Panorama -> take OPG
[ ] Note study/file id shown (e.g. 022194)
[ ] Quit EzDent-i

What to send back for Banana wiring
-----------------------------------
1. session.log (process command lines + FSW events)
2. Any Linkage.xml copies under files\
3. Changed *.ini / VTDebug*.txt under files\
4. Which exe actually started (from PROCESS START lines)
5. Whether Acquisition worked in this desktop session

Banana copy target: tools\xray-local-launcher.ps1 Start-EzdentiBridgePatient
"@
    Set-Content -LiteralPath (Join-Path $sessionDir "README.txt") -Value $readme -Encoding UTF8

    Write-SessionLog "=== watch ended $(Get-Date -Format o) === captured_files=$fileCount folder=$sessionDir" "Cyan"
    Write-Host ""
    Write-Host "Done. Open: $sessionDir" -ForegroundColor Green
    Write-Host "File copies: $fileCount" -ForegroundColor Green
}
