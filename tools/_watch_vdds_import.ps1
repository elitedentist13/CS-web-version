# tools/_watch_vdds_import.ps1
# One-off reverse-engineering aid: capture CS's "NNT.exe -VDDS PATDATIMPORT
# <tmpfile>" handoff file before NNT consumes/deletes it.
#
# Earlier tracing (see CHANGELOG.md "confirmed correct by tracing CS's own
# launch") showed CS makes TWO calls when opening a patient in NNT:
#   NNTBridge.exe /DIR ... /PATID ... /NAME ... /SURNAME ... /DATEB ... /SEX ...
#     -> spawns: NNT.exe /DIR "..."
#     -> spawns: NNT.exe -VDDS PATDATIMPORT "...\Temp\NNTBxxxx.tmp"
# The second call silently syncs NNT's own patient database with CS's
# current demographics *before* the mismatch-prompting logic ever runs --
# that's why staff never see the "Patient record UPDATE?" dialog when
# launching via CS. We never captured what's actually inside that .tmp
# file. This script does two things in parallel to maximize the chance of
# grabbing it intact:
#   1. A FileSystemWatcher on %TEMP% for "NNTB*.tmp" Created events (fires
#      near-instantly, well before a 1s-interval WMI poll would).
#   2. A WMI process-creation watcher for NNT.exe / NNTBridge.exe, logging
#      the full command line (so we also reconfirm the exact call shape).
# Every captured .tmp file is immediately copied to _vdds_captures\ (copy,
# not move -- never touch the original so NNT's own read is undisturbed).
#
# Usage: powershell -File _watch_vdds_import.ps1 -DurationSec 300
param(
    [int]$DurationSec = 300
)

$ErrorActionPreference = "Continue"
$captureDir = Join-Path $PSScriptRoot "_vdds_captures"
if (-not (Test-Path $captureDir)) { New-Item -ItemType Directory -Path $captureDir -Force | Out-Null }
$logPath = Join-Path $PSScriptRoot "_vdds_watch_log.txt"
"=== watch started $(Get-Date -Format o) ===" | Out-File -LiteralPath $logPath -Encoding UTF8

function Log([string]$Msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss.fff')  $Msg"
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

# --- 1. Filesystem watcher on %TEMP% ---
$tempDir = $env:TEMP
Log "Watching temp dir: $tempDir"
$fsw = New-Object System.IO.FileSystemWatcher $tempDir, "NNTB*.tmp"
$fsw.IncludeSubdirectories = $false
$fsw.EnableRaisingEvents = $true

# NOTE: event action scriptblocks run in their own scope -- functions
# defined in the calling script aren't reliably visible there, so this
# inlines the same copy logic rather than calling Capture-TmpFile, and
# receives shared state via -MessageData -> $Event.MessageData.
$createdSub = Register-ObjectEvent -InputObject $fsw -EventName Created -MessageData @{ LogPath = $logPath; CaptureDir = $captureDir } -Action {
    $md = $Event.MessageData
    $path = $Event.SourceEventArgs.FullPath
    $ts = (Get-Date -Format 'HH:mm:ss.fff')
    Add-Content -LiteralPath $md.LogPath -Value "$ts  FSW created event: $path" -Encoding UTF8
    Write-Host "$ts  FSW created event: $path"
    for ($i = 0; $i -lt 20; $i++) {
        if (Test-Path -LiteralPath $path) {
            try {
                $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_$(Split-Path -Leaf $path)"
                $dest = Join-Path $md.CaptureDir $destName
                Copy-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
                $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [FileSystemWatcher] $path -> $dest ($((Get-Item $dest).Length) bytes)"
                Write-Host $msg
                Add-Content -LiteralPath $md.LogPath -Value $msg -Encoding UTF8
                break
            } catch {}
        }
        Start-Sleep -Milliseconds 50
    }
}

# --- 2. WMI process-creation watcher for NNT.exe / NNTBridge.exe ---
# NOTE: Register-CimIndicationEvent action scriptblocks run in their own
# runspace -- $using: (a remoting/job construct) does NOT resolve there.
# Pass shared state via -MessageData -> $Event.MessageData instead.
$wmiQuery = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND (TargetInstance.Name = 'NNT.exe' OR TargetInstance.Name = 'NNTBridge.exe')"
$wmiSub = Register-CimIndicationEvent -Query $wmiQuery -MessageData @{ LogPath = $logPath; CaptureDir = $captureDir } -Action {
    $md = $Event.MessageData
    $proc = $Event.SourceEventArgs.NewEvent.TargetInstance
    $cmdLine = $proc.CommandLine
    $ts = (Get-Date -Format 'HH:mm:ss.fff')
    $line = "$ts  PROCESS: $($proc.Name) (pid=$($proc.ProcessId)) cmdline=$cmdLine"
    Write-Host $line
    Add-Content -LiteralPath $md.LogPath -Value $line -Encoding UTF8
    if ($cmdLine -match '-VDDS\s+PATDATIMPORT\s+"?([^"]+\.tmp)"?') {
        $tmpPath = $Matches[1]
        for ($i = 0; $i -lt 20; $i++) {
            if (Test-Path -LiteralPath $tmpPath) {
                try {
                    $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_$(Split-Path -Leaf $tmpPath)"
                    $dest = Join-Path $md.CaptureDir $destName
                    Copy-Item -LiteralPath $tmpPath -Destination $dest -Force -ErrorAction Stop
                    $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [WMI] $tmpPath -> $dest ($((Get-Item $dest).Length) bytes)"
                    Write-Host $msg
                    Add-Content -LiteralPath $md.LogPath -Value $msg -Encoding UTF8
                    break
                } catch {}
            }
            Start-Sleep -Milliseconds 50
        }
    }
}

Log "Watchers registered. Waiting up to $DurationSec seconds. Trigger CS -> open a patient's NNT/NewTom now."
Log "(Any patient works -- we just need one live VDDS PATDATIMPORT call.)"

$deadline = (Get-Date).AddSeconds($DurationSec)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ((Get-ChildItem $captureDir -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
        Log "Capture found -- stopping early."
        break
    }
}

Unregister-Event -SourceIdentifier $createdSub.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $wmiSub.Name -ErrorAction SilentlyContinue
$fsw.Dispose()
Log "=== watch ended $(Get-Date -Format o) ==="
