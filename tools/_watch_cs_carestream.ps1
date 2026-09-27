# tools/_watch_cs_carestream.ps1
# Background observer for Clinic Solution's Carestream handoff.
# Same method as _watch_vdds_import.ps1 and _watch_ezdenti_linkage.ps1:
# log the process command line CS uses, and copy any small handoff file
# named on that command line. Does not launch Carestream and does not
# change the files CS writes.
#
# Leave it running, then in Clinic Solution:
#   1. Open a patient who already has Carestream films and click the
#      Carestream / CS Imaging button.
#   2. Open a patient with no films and click the same button.
# Stop early by creating the STOP file printed at startup.
param(
    [int]$DurationSec = 1200
)

$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$traceDir = Join-Path $PSScriptRoot ("_cs_carestream_traces\" + $stamp)
$captureDir = Join-Path $traceDir "captures"
New-Item -ItemType Directory -Path $captureDir -Force | Out-Null
$logPath = Join-Path $traceDir "watch.log"
$stopFile = Join-Path $traceDir "STOP"

$meta = [ordered]@{
    started = (Get-Date).ToString("o")
    computer = $env:COMPUTERNAME
    user = $env:USERNAME
    temp = $env:TEMP
    duration_sec = $DurationSec
    stop_file = $stopFile
    purpose = "Observe Clinic Solution launching Carestream CS Imaging"
}
$meta | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $traceDir "session.json") -Encoding UTF8

function Log([string]$Msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss.fff')  $Msg"
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Test-ImagingName([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name)) { return $false }
    return $Name -match '(?i)^(CS\.exe|Patient\.exe|TW\.exe|Trophy\.exe|CSImaging\.exe|CSDIA\.exe|CSBridge\.exe|PMSBridge\.exe)$'
}

function Copy-HandoffPaths([string]$CmdLine, $CaptureDir, $LogPath) {
    if ([string]::IsNullOrWhiteSpace($CmdLine)) { return }
    $matches = [regex]::Matches($CmdLine, '(?i)(?:"([^"]+\.(?:tmp|xml|ini|txt|json|dat))"|(\S+\.(?:tmp|xml|ini|txt|json|dat)))')
    foreach ($m in $matches) {
        $path = if ($m.Groups[1].Success -and $m.Groups[1].Value) { $m.Groups[1].Value } else { $m.Groups[2].Value }
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        if ($path -match '(?i)\.(jpg|jpeg|png|bmp|tif|tiff|dcm)$') { continue }
        for ($i = 0; $i -lt 25; $i++) {
            if (Test-Path -LiteralPath $path) {
                try {
                    $item = Get-Item -LiteralPath $path -ErrorAction Stop
                    if ($item.Length -gt 512000) { break }
                    $destName = "$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_$(Split-Path -Leaf $path)"
                    $dest = Join-Path $CaptureDir $destName
                    Copy-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
                    $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED $path -> $dest ($($item.Length) bytes)"
                    Write-Host $msg
                    Add-Content -LiteralPath $LogPath -Value $msg -Encoding UTF8
                } catch {}
                break
            }
            Start-Sleep -Milliseconds 40
        }
    }
}

Log "=== Carestream workflow watch started ==="
Log "Trace folder: $traceDir"
Log "Stop early by creating: $stopFile"
Log "Click in Clinic Solution: (1) existing films, then (2) a patient with no films. Use the Carestream / CS Imaging button each time."

$shortcut = "C:\Users\Public\Desktop\CS Imaging Software.lnk"
if (Test-Path -LiteralPath $shortcut) {
    try {
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($shortcut)
        Log "SHORTCUT target=$($lnk.TargetPath)"
        Log "SHORTCUT args=$($lnk.Arguments)"
        Log "SHORTCUT workdir=$($lnk.WorkingDirectory)"
    } catch {
        Log "SHORTCUT present but unreadable: $($_.Exception.Message)"
    }
} else {
    Log "SHORTCUT missing: $shortcut"
}

Log "--- processes already running ---"
try {
    Get-CimInstance Win32_Process | ForEach-Object {
        if (Test-ImagingName $_.Name) {
            Log ("ALREADY {0} pid={1} parent={2} exe={3} cmdline={4}" -f $_.Name, $_.ProcessId, $_.ParentProcessId, $_.ExecutablePath, $_.CommandLine)
        }
    }
} catch {
    Log "Could not list current processes: $($_.Exception.Message)"
}

$seenFile = Join-Path $traceDir "seen-pids.txt"
"" | Set-Content -LiteralPath $seenFile -Encoding ASCII

$wmiQuery = @"
SELECT * FROM __InstanceCreationEvent WITHIN 1
WHERE TargetInstance ISA 'Win32_Process'
AND (
    TargetInstance.Name = 'CS.exe' OR
    TargetInstance.Name = 'Patient.exe' OR
    TargetInstance.Name = 'TW.exe' OR
    TargetInstance.Name = 'Trophy.exe' OR
    TargetInstance.Name = 'CSImaging.exe' OR
    TargetInstance.Name = 'CSDIA.exe' OR
    TargetInstance.Name = 'CSBridge.exe' OR
    TargetInstance.Name = 'PMSBridge.exe'
)
"@

$wmiSub = Register-CimIndicationEvent -Query $wmiQuery -MessageData @{
    LogPath = $logPath
    CaptureDir = $captureDir
} -Action {
    $md = $Event.MessageData
    $proc = $Event.SourceEventArgs.NewEvent.TargetInstance
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    $line = "$ts  PROCESS: $($proc.Name) pid=$($proc.ProcessId) parent=$($proc.ParentProcessId) exe=$($proc.ExecutablePath) cmdline=$($proc.CommandLine)"
    Write-Host $line
    Add-Content -LiteralPath $md.LogPath -Value $line -Encoding UTF8
    $cmd = [string]$proc.CommandLine
    if (-not [string]::IsNullOrWhiteSpace($cmd)) {
        $rx = [regex]'(?i)(?:"([^"]+\.(?:tmp|xml|ini|txt|json|dat))"|(\S+\.(?:tmp|xml|ini|txt|json|dat)))'
        foreach ($m in $rx.Matches($cmd)) {
            $path = if ($m.Groups[1].Success -and $m.Groups[1].Value) { $m.Groups[1].Value } else { $m.Groups[2].Value }
            if ([string]::IsNullOrWhiteSpace($path)) { continue }
            for ($i = 0; $i -lt 25; $i++) {
                if (Test-Path -LiteralPath $path) {
                    try {
                        $item = Get-Item -LiteralPath $path -ErrorAction Stop
                        if ($item.Length -le 512000) {
                            $dest = Join-Path $md.CaptureDir ("$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')_" + (Split-Path -Leaf $path))
                            Copy-Item -LiteralPath $path -Destination $dest -Force -ErrorAction Stop
                            $msg = "$(Get-Date -Format 'HH:mm:ss.fff')  CAPTURED $path -> $dest ($($item.Length) bytes)"
                            Write-Host $msg
                            Add-Content -LiteralPath $md.LogPath -Value $msg -Encoding UTF8
                        }
                    } catch {}
                    break
                }
                Start-Sleep -Milliseconds 40
            }
        }
    }
}

Log "WMI watcher registered. Also polling children of CS.exe so an unknown bridge exe is still recorded."
Log "Waiting up to $DurationSec seconds."

$deadline = (Get-Date).AddSeconds($DurationSec)
$nextBeat = (Get-Date).AddSeconds(30)
$csNames = @{ 'cs.exe' = $true }

while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $stopFile) {
        Log "STOP file found."
        break
    }
    try {
        $procs = @(Get-CimInstance Win32_Process)
        $byId = @{}
        foreach ($p in $procs) { $byId[[int]$p.ProcessId] = $p }
        $seen = @{}
        if (Test-Path -LiteralPath $seenFile) {
            Get-Content -LiteralPath $seenFile | ForEach-Object {
                if ($_ -match '^\d+$') { $seen[[int]$_] = $true }
            }
        }
        foreach ($p in $procs) {
            $procId = [int]$p.ProcessId
            if ($seen.ContainsKey($procId)) { continue }
            $name = [string]$p.Name
            $cmd = [string]$p.CommandLine
            $parent = $null
            if ($byId.ContainsKey([int]$p.ParentProcessId)) { $parent = $byId[[int]$p.ParentProcessId] }
            $parentName = if ($parent) { [string]$parent.Name } else { "" }
            $fromCs = $csNames.ContainsKey($parentName.ToLowerInvariant())
            $imaging = (Test-ImagingName $name) -or ($cmd -match '(?i)Carestream|Patient Browser|CSImaging|\\TW\.exe|\\Patient\.exe|\\IMAGE\\SCAN')
            if ($imaging -or $fromCs) {
                $why = if ($fromCs -and -not $imaging) { "CS-CHILD" } else { "IMAGING" }
                Log ("POLL {0}: {1} pid={2} parent={3} ({4}) exe={5} cmdline={6}" -f $why, $name, $procId, $p.ParentProcessId, $parentName, $p.ExecutablePath, $cmd)
                if ($fromCs -or (Test-ImagingName $name)) {
                    Copy-HandoffPaths $cmd $captureDir $logPath
                }
            }
            Add-Content -LiteralPath $seenFile -Value "$procId" -Encoding ASCII
        }
    } catch {
        Log "Poll error: $($_.Exception.Message)"
    }
    if ((Get-Date) -ge $nextBeat) {
        Log "still watching"
        $nextBeat = (Get-Date).AddSeconds(30)
    }
    Start-Sleep -Milliseconds 400
}

Unregister-Event -SourceIdentifier $wmiSub.Name -ErrorAction SilentlyContinue
Log "=== watch ended $(Get-Date -Format o) ==="
Log "Read: $logPath"
