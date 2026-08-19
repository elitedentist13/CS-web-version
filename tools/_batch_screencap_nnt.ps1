# tools/_batch_screencap_nnt.ps1
# For each patient in _screencap_manifest.json: launch NNT via the real
# local-launcher HTTP endpoint (same one Banana calls), open the PAN
# thumbnail into NNT's own viewer, dismiss the filter dialog, screen-cap
# the window, crop to the image region (fixed offsets measured against
# the maximized 1296x992 window -- see CHANGELOG for the pixel scan),
# save a JPEG per chart, then close NNT and move to the next patient.
#
# This is real desktop GUI automation: it takes over the mouse/screen for
# the whole run. Do not touch the mouse/keyboard on this PC while it runs.
#
# Usage: powershell -File _batch_screencap_nnt.ps1 -ManifestPath _screencap_manifest.json -OutDir _screencaps
param(
    [string]$ManifestPath = (Join-Path $PSScriptRoot "_screencap_manifest.json"),
    [string]$OutDir = (Join-Path $PSScriptRoot "_screencaps"),
    [int]$LauncherPort = 17890
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name Win32c -Namespace NntCap2 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
[DllImport("user32.dll")] public static extern int SetProcessDPIAware();
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
[NntCap2.Win32c]::SetProcessDPIAware() | Out-Null

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# Fixed crop box measured against the maximized NNT viewer window (1296x992,
# window rect starting at screen -8,-8) by scanning pixel colors for the
# blue frame lines around the image canvas -- see CHANGELOG 2026-08-19.
# Left/top/right/bottom are relative to the captured window bitmap.
$CropLeft = 36
$CropTop = 196
$CropRight = 1250
$CropBottom = 873

function Test-LauncherUp {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$LauncherPort/status" -Method GET -TimeoutSec 3
        return [bool]$resp.ok
    } catch { return $false }
}

function Ensure-Launcher {
    if (Test-LauncherUp) { return }
    $scriptPath = Join-Path $PSScriptRoot "xray-local-launcher.ps1"
    Start-Process powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath) -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        if (Test-LauncherUp) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Local launcher did not come up on port $LauncherPort"
}

function Stop-AllNnt {
    foreach ($name in @("NNTBridge", "NNT_SID", "NNT")) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        $left = @(Get-Process -Name "NNT", "NNT_SID", "NNTBridge" -ErrorAction SilentlyContinue)
        if ($left.Count -eq 0) { return }
        Start-Sleep -Milliseconds 300
    }
}

function Wait-NntWindow([int]$TimeoutSec = 25) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $p = Get-Process -Name "NNT" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($p) { return $p }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function Send-DoubleClick([int]$X, [int]$Y) {
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $X, $Y
    Start-Sleep -Milliseconds 150
    for ($i = 0; $i -lt 2; $i++) {
        [NntCap2.Win32c]::mouse_event(0x0002, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 60
        [NntCap2.Win32c]::mouse_event(0x0004, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 90
    }
}

function Send-Click([int]$X, [int]$Y) {
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $X, $Y
    Start-Sleep -Milliseconds 150
    [NntCap2.Win32c]::mouse_event(0x0002, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 60
    [NntCap2.Win32c]::mouse_event(0x0004, 0, 0, 0, 0)
}

function Find-CancelRect($Hwnd) {
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($Hwnd)
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Cancel")
        $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        if ($el) { return $el.Current.BoundingRectangle }
    } catch {}
    return $null
}

function Capture-Window($Hwnd, [string]$OutPath, [switch]$Crop) {
    $rect = New-Object NntCap2.Win32c+RECT
    [NntCap2.Win32c]::GetWindowRect($Hwnd, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { return $false }
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
    $g.Dispose()
    if ($Crop) {
        $cw = $CropRight - $CropLeft
        $ch = $CropBottom - $CropTop
        if ($CropRight -le $width -and $CropBottom -le $height -and $cw -gt 0 -and $ch -gt 0) {
            $cropRectObj = New-Object System.Drawing.Rectangle $CropLeft, $CropTop, $cw, $ch
            $cropped = $bmp.Clone($cropRectObj, $bmp.PixelFormat)
            $bmp.Dispose()
            $bmp = $cropped
        }
    }
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
    return $true
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Ensure-Launcher

$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "Loaded $($manifest.Count) patients from $ManifestPath"

$results = New-Object System.Collections.Generic.List[object]

foreach ($p in $manifest) {
    $chart = $p.chart_no
    $outFile = Join-Path $OutDir ("$chart.jpg")
    if (Test-Path $outFile) {
        Write-Host "[$chart] already captured, skipping"
        $results.Add([ordered]@{ chart_no = $chart; status = "already_captured" })
        continue
    }

    Write-Host "[$chart] $($p.patient_name) -- launching..."
    try {
        Stop-AllNnt

        $uri = "http://127.0.0.1:$LauncherPort/open/nntnewtom?" +
            "patient_no=" + [Uri]::EscapeDataString([string]$p.patient_no) +
            "&patient_name=" + [Uri]::EscapeDataString([string]$p.patient_name) +
            "&chinese_name=" + [Uri]::EscapeDataString([string]$p.chinese_name) +
            "&dob=" + [Uri]::EscapeDataString([string]$p.dob) +
            "&sex=" + [Uri]::EscapeDataString([string]$p.sex)
        $launchResp = Invoke-RestMethod -Uri $uri -Method GET -TimeoutSec 10

        $proc = Wait-NntWindow -TimeoutSec 25
        if (-not $proc) {
            Write-Host "[$chart] FAILED: NNT window never appeared"
            $results.Add([ordered]@{ chart_no = $chart; status = "no_window" })
            continue
        }
        Start-Sleep -Milliseconds 1500

        [NntCap2.Win32c]::ShowWindowAsync($proc.MainWindowHandle, 3) | Out-Null
        Start-Sleep -Milliseconds 600
        [NntCap2.Win32c]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 800

        # PAN thumbnail: fixed offset within the maximized patient-record
        # screen (measured on chart 002505). Population-B charts all have
        # the same "2D scenario" + "PAN" thumbnail layout since they were
        # selected for having a 2D Images collection *.2dh study.
        Send-DoubleClick -X 816 -Y 488
        Start-Sleep -Milliseconds 2500

        $cancelRect = Find-CancelRect $proc.MainWindowHandle
        if ($cancelRect) {
            $cx = [int]($cancelRect.X + $cancelRect.Width / 2)
            $cy = [int]($cancelRect.Y + $cancelRect.Height / 2)
            Send-Click -X $cx -Y $cy
            Start-Sleep -Milliseconds 1500
        }

        $rawOut = Join-Path $OutDir ("$chart" + "_raw.png")
        Capture-Window $proc.MainWindowHandle $rawOut | Out-Null
        $ok = Capture-Window $proc.MainWindowHandle $outFile -Crop
        Remove-Item -LiteralPath $rawOut -ErrorAction SilentlyContinue

        if ($ok) {
            Write-Host "[$chart] captured -> $outFile"
            $results.Add([ordered]@{ chart_no = $chart; status = "captured"; file = $outFile })
        } else {
            Write-Host "[$chart] FAILED: capture returned false"
            $results.Add([ordered]@{ chart_no = $chart; status = "capture_failed" })
        }
    } catch {
        Write-Host "[$chart] ERROR: $($_.Exception.Message)"
        $results.Add([ordered]@{ chart_no = $chart; status = "error"; message = $_.Exception.Message })
    } finally {
        Stop-AllNnt
        Start-Sleep -Milliseconds 500
    }
}

$logPath = Join-Path $OutDir "_run_log.json"
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $logPath -Encoding UTF8
Write-Host "`n=== DONE. Log written to $logPath ==="
$results | ForEach-Object { Write-Host "  $($_.chart_no): $($_.status)" }
