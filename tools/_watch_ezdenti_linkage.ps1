# tools/_watch_ezdenti_linkage.ps1
# One-off reverse-engineering aid: capture CS's real "linkage.xml" the
# instant it is written to EzDent-i's own program folder, before it can be
# overwritten by a later launch. Mirrors _watch_vdds_import.ps1's approach
# for the NNT "-VDDS PATDATIMPORT" handoff file, adapted for EzDent-i:
#   1. A FileSystemWatcher on the EzDent-i Bin folder for
#      "linkage.xml" Created/Changed events (fires near-instantly).
#   2. A WMI process-creation watcher for the EzDent-i loader/bridge exes
#      (VTE2Loader32.exe, VTE2Loader_ReqAdmin32.exe, VTEzBridge32.exe,
#      VTE232.exe), logging the full command line CS uses to launch it.
# Every captured linkage.xml is immediately copied to _ezdenti_captures\
# (copy, not move -- never touch the original).
#
# Usage: powershell -File _watch_ezdenti_linkage.ps1 -DurationSec 300
param(
    [int]$DurationSec = 300,
    [string]$EzdentiDir = "C:\Program Files (x86)\VATECH\EzDent-i\Bin"
)

$ErrorActionPreference = "Continue"

if (-not (Test-Path -LiteralPath $EzdentiDir)) {
    Write-Host "EzDent-i folder not found: $EzdentiDir" -ForegroundColor Red
    Write-Host "Pass the real folder with -EzdentiDir `"C:\path\to\EzDent-i\Bin`"" -ForegroundColor Yellow
    exit 1
}

$captureDir = Join-Path $PSScriptRoot "_ezdenti_captures"
if (-not (Test-Path $captureDir)) { New-Item -ItemType Directory -Path $captureDir -Force | Out-Null }
$logPath = Join-Path $PSScriptRoot "_ezdenti_watch_log.txt"
"=== watch started $(Get-Date -Format o) ===" | Out-File -LiteralPath $logPath -Encoding UTF8
"Watching: $EzdentiDir" | Add-Content -LiteralPath $logPath -Encoding UTF8

function Log([string]$Msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss.fff')  $Msg"
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

# --- 1. Filesystem watcher on the EzDent-i Bin folder ---
Log "Watching EzDent-i folder: $EzdentiDir"
$fsw = New-Object System.IO.FileSystemWatcher $EzdentiDir, "linkage.xml"
$fsw.IncludeSubdirectories = $false
$fsw.NotifyFilter = [IO.NotifyFilters]'FileName, LastWrite, Size'
$fsw.EnableRaisingEvents = $true

# NOTE: event action scriptblocks run in their own scope -- functions
# defined in the calling script aren't reliably visible there, so this
# inlines the same copy logic rather than calling Capture-Linkage, and
# receives shared state via -MessageData -> $Event.MessageData.
$fswAction = {
    $md = $Event.MessageData
    $path = $Event.SourceEventArgs.FullPath
    $changeType = $Event.SourceEventArgs.ChangeType
    $ts = (Get-Date -Format 'HH:mm:ss.fff')
    Add-Content -LiteralPath $md.LogPath -Value "$ts  FSW $changeType event: $path" -Encoding UTF8
    Write-Host "$ts  FSW $changeType event: $path"
    for ($i = 0; $i -lt 20; $i++) {
        if (Test-Path -LiteralPath $path) {
            try {
                $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_linkage.xml"
                $dest = Join-Path $md.CaptureDir $destName
                Copy-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
                $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [FileSystemWatcher-$changeType] $path -> $dest ($((Get-Item $dest).Length) bytes)"
                Write-Host $msg
                Add-Content -LiteralPath $md.LogPath -Value $msg -Encoding UTF8
                break
            } catch {}
        }
        Start-Sleep -Milliseconds 50
    }
}
$createdSub = Register-ObjectEvent -InputObject $fsw -EventName Created -MessageData @{ LogPath = $logPath; CaptureDir = $captureDir } -Action $fswAction
$changedSub = Register-ObjectEvent -InputObject $fsw -EventName Changed -MessageData @{ LogPath = $logPath; CaptureDir = $captureDir } -Action $fswAction

# --- 2. WMI process-creation watcher for the EzDent-i loader/bridge exes ---
# NOTE: Register-CimIndicationEvent action scriptblocks run in their own
# runspace -- $using: (a remoting/job construct) does NOT resolve there.
# Pass shared state via -MessageData -> $Event.MessageData instead.
$wmiQuery = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND (TargetInstance.Name = 'VTE2Loader32.exe' OR TargetInstance.Name = 'VTE2Loader_ReqAdmin32.exe' OR TargetInstance.Name = 'VTEzBridge32.exe' OR TargetInstance.Name = 'VTE232.exe' OR TargetInstance.Name = 'VTE2_ReqAdmin32.exe')"
$wmiSub = Register-CimIndicationEvent -Query $wmiQuery -MessageData @{ LogPath = $logPath; CaptureDir = $captureDir; EzdentiDir = $EzdentiDir } -Action {
    $md = $Event.MessageData
    $proc = $Event.SourceEventArgs.NewEvent.TargetInstance
    $cmdLine = $proc.CommandLine
    $ts = (Get-Date -Format 'HH:mm:ss.fff')
    $line = "$ts  PROCESS: $($proc.Name) (pid=$($proc.ProcessId)) cmdline=$cmdLine"
    Write-Host $line
    Add-Content -LiteralPath $md.LogPath -Value $line -Encoding UTF8
    # Grab whatever linkage.xml exists at the moment this process spawns --
    # this is CS's own launch, so if a file is present, this is it.
    $xmlPath = Join-Path $md.EzdentiDir "linkage.xml"
    for ($i = 0; $i -lt 20; $i++) {
        if (Test-Path -LiteralPath $xmlPath) {
            try {
                $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_linkage.xml"
                $dest = Join-Path $md.CaptureDir $destName
                Copy-Item -LiteralPath $xmlPath -Destination $dest -Force -ErrorAction Stop
                $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED [WMI-at-launch] $xmlPath -> $dest ($((Get-Item $dest).Length) bytes)"
                Write-Host $msg
                Add-Content -LiteralPath $md.LogPath -Value $msg -Encoding UTF8
                break
            } catch {}
        }
        Start-Sleep -Milliseconds 50
    }
}

Log "Watchers registered. Waiting up to $DurationSec seconds. Trigger CS -> open a patient's EzDent-i/OPG button now."
Log "(Any patient with a chart number, name, DOB, and gender works.)"

$deadline = (Get-Date).AddSeconds($DurationSec)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ((Get-ChildItem $captureDir -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
        Log "Capture found -- stopping early."
        break
    }
}

Unregister-Event -SourceIdentifier $createdSub.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $changedSub.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $wmiSub.Name -ErrorAction SilentlyContinue
$fsw.Dispose()
Log "=== watch ended $(Get-Date -Format o) ==="
