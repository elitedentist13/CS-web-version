# tools/banana-remote-agent.ps1
# Joyful Smile / Banana Clinic Manager — "Any Banana" remote support agent.
#
# Runs on a clinic PC that should be remotely viewable/controllable from
# another Banana browser tab anywhere with internet access (not just the
# same LAN). Unlike the X-ray bridge (tools/xray-local-launcher.ps1), which
# only ever talks to 127.0.0.1, this agent's screen/input/file traffic is
# relayed through Supabase (already this app's backend) so two clinic PCs
# in different physical locations can connect. The only thing served on
# 127.0.0.1 here is a small "what is my device ID" endpoint the Banana web
# app reads from the SAME PC this agent runs on.
#
# How pairing/consent works (deliberately simple, matches the design
# agreed with the clinic):
#   1. On first run this agent generates a persistent 6-digit Device ID,
#      registers it in the remote_devices table, and remembers it in
#      device-id.txt next to this script. The ID never changes after that.
#   2. Anyone with the ID can REQUEST a session (insert a remote_sessions
#      row) from a plain Banana browser tab -- no separate install needed
#      on the viewer's side, only the side being controlled needs this
#      agent running.
#   3. The ID alone is NOT enough to get in: this agent shows a native
#      "<viewer> wants to connect. Allow?" prompt and does nothing until
#      a person on THIS PC clicks Allow. That consent step is the actual
#      security boundary, not the ID.
#   4. Once accepted, this agent uploads a screenshot every
#      -PollIntervalMs (default 400ms => ~2.5fps) to Supabase Storage and
#      polls for queued mouse/keyboard commands to inject, using the same
#      Add-Type / user32.dll P-Invoke technique already proven in
#      xray-local-launcher.ps1's Start-RestoreRayViewerWindow.
#   5. Either side can drop a file in during the session; this agent picks
#      up anything queued for it and saves it straight into the logged-in
#      user's normal Downloads folder (falls back to
#      -InstallPath\Received only if Downloads can't be resolved/created),
#      so files "just show up" wherever clinic staff already expect
#      downloaded files to land -- no separate app-specific folder to hunt
#      for.
#
# Known v1 limitations (deliberate, to keep this a "basic simple" tool
# rather than a from-scratch AnyDesk clone -- see the design discussion
# that led to this file):
#   - Screenshot-polling, not real video: ~2-5fps with visible lag, not
#     smooth like a real remote-desktop product.
#   - Primary monitor only (GetSystemMetrics SM_CXSCREEN/SM_CYSCREEN) --
#     no multi-monitor support.
#   - No clipboard sync.
#
# Self-test (side-effect-free -- no network call, no screen capture, no
# input injection, nothing outside $env:TEMP touched):
#     powershell -NoProfile -ExecutionPolicy Bypass -File tools\banana-remote-agent.ps1 -SelfTest
#
param(
    [switch]$SelfTest,
    [string]$InstallPath = "C:\BananaRemote",
    [int]$Port = 17891,
    [string]$DeviceName = $env:COMPUTERNAME,
    [int]$PollIntervalMs = 400
)

$ErrorActionPreference = "Continue"
$AgentVersion = "1.0.0"

# Same public anon key already embedded in app.js's client-side bundle --
# no additional exposure by also embedding it here (RLS on the new tables
# is intentionally open, matching every other operational table in this
# app -- see any_banana_remote.sql's header comment for why).
$SUPABASE_URL = "https://kprihawipljrltfzpfjd.supabase.co"
$SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi" +
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0." +
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }

# Every previous crash of this agent (confirmed live 2026-08-27: an
# unhandled exception anywhere in the main loop -- screen capture, a
# Supabase call, the consent prompt, anything -- silently killed the whole
# process with NO trace anywhere except the heartbeat simply stopping in
# Supabase) left no way to diagnose what happened after the fact. The main
# loop below now catches per-tick and logs here instead of dying, so a
# single bad tick never takes down the whole agent, and there is always
# something to look at afterwards.
function Write-AgentLog([string]$Message) {
    try {
        $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
        Add-Content -LiteralPath (Join-Path $InstallPath "agent.log") -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

# ════════════════════════════════════════════════════════════════
# Pure helpers (covered by -SelfTest, no network/OS side effects)
# ════════════════════════════════════════════════════════════════
function New-DeviceCode {
    return ("{0:D6}" -f (Get-Random -Minimum 0 -Maximum 999999))
}

# Mouse coordinates travel over the wire as fractions of the viewer's
# displayed image (0..1), NOT raw pixels -- the two PCs' screen
# resolutions are generally different, and the viewer's <img> is itself
# scaled by CSS. This keeps the math correct regardless of either.
function ConvertTo-NormalizedCoord([double]$PixelPos, [double]$DimensionPx) {
    if ($DimensionPx -le 0) { return 0 }
    $frac = $PixelPos / $DimensionPx
    if ($frac -lt 0) { return 0 }
    if ($frac -gt 1) { return 1 }
    return $frac
}

function ConvertFrom-NormalizedCoord([double]$Fraction, [int]$DimensionPx) {
    $px = [int][Math]::Round($Fraction * $DimensionPx)
    if ($px -lt 0) { return 0 }
    if ($px -ge $DimensionPx) { return $DimensionPx - 1 }
    return $px
}

# Special/navigation keys only -- printable characters are sent via
# SendInput + KEYEVENTF_UNICODE instead (see Invoke-RemoteInputEvent),
# which needs no VK lookup table at all and works for any language/layout.
$script:VirtualKeyMap = @{
    "Enter"      = 0x0D
    "Backspace"  = 0x08
    "Tab"        = 0x09
    "Escape"     = 0x1B
    "Delete"     = 0x2E
    "ArrowLeft"  = 0x25
    "ArrowUp"    = 0x26
    "ArrowRight" = 0x27
    "ArrowDown"  = 0x28
    "Home"       = 0x24
    "End"        = 0x23
    "PageUp"     = 0x21
    "PageDown"   = 0x22
    "Control"    = 0x11
    "Shift"      = 0x10
    "Alt"        = 0x12
    " "          = 0x20
}

function Get-VirtualKeyCode([string]$KeyName) {
    if ($script:VirtualKeyMap.ContainsKey($KeyName)) { return $script:VirtualKeyMap[$KeyName] }
    return $null
}

# Windows has no classic CSIDL / [Environment]::GetFolderPath entry for
# "Downloads" (unlike Desktop/Documents/etc.), so the documented way to
# find it is this per-user registry value (Known Folder GUID for
# Downloads). Falls back to the conventional %USERPROFILE%\Downloads path
# -- correct on the overwhelming majority of PCs -- if that key is ever
# missing, and to -InstallPath\Received as a last resort so file transfer
# never simply fails outright.
function Get-DownloadsFolder {
    try {
        $key = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
        $val = (Get-ItemProperty -Path $key -Name '{374DE290-123F-4565-9164-39C4925E467B}' -ErrorAction Stop).'{374DE290-123F-4565-9164-39C4925E467B}'
        if ($val) {
            $expanded = [Environment]::ExpandEnvironmentVariables($val)
            if ($expanded) { return $expanded }
        }
    } catch {}
    if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE "Downloads") }
    return (Join-Path $InstallPath "Received")
}

# ════════════════════════════════════════════════════════════════
# Supabase REST helpers
# ════════════════════════════════════════════════════════════════
function Get-SupabaseHeaders($ExtraHeaders) {
    $headers = @{
        "apikey"        = $SUPABASE_ANON_KEY
        "Authorization" = "Bearer $SUPABASE_ANON_KEY"
        "Content-Type"  = "application/json"
    }
    if ($ExtraHeaders) { foreach ($k in $ExtraHeaders.Keys) { $headers[$k] = $ExtraHeaders[$k] } }
    return $headers
}

function Invoke-SupabaseRest($Method, $PathAndQuery, $Body, $ExtraHeaders) {
    $uri = "$SUPABASE_URL/rest/v1/$PathAndQuery"
    $headers = Get-SupabaseHeaders $ExtraHeaders
    try {
        if ($null -ne $Body) {
            return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -Body $Body -TimeoutSec 10 -ErrorAction Stop
        }
        return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    } catch {
        return $null
    }
}

function Now-Iso { return (Get-Date).ToUniversalTime().ToString("o") }

# ════════════════════════════════════════════════════════════════
# Device identity
# ════════════════════════════════════════════════════════════════
function Register-Device([string]$Id) {
    $body = @{
        id             = $Id
        device_name    = $DeviceName
        agent_version  = $AgentVersion
        last_seen_at   = (Now-Iso)
    } | ConvertTo-Json
    Invoke-SupabaseRest 'Post' "remote_devices?on_conflict=id" $body @{ Prefer = "resolution=merge-duplicates,return=minimal" } | Out-Null
}

function Get-OrCreateDeviceId {
    $idFile = Join-Path $InstallPath "device-id.txt"
    if (Test-Path -LiteralPath $idFile) {
        $existing = (Get-Content -LiteralPath $idFile -Raw -ErrorAction SilentlyContinue)
        if ($existing) { $existing = $existing.Trim() }
        if ($existing -match '^\d{6}$') {
            Register-Device $existing
            return $existing
        }
    }
    for ($i = 0; $i -lt 20; $i++) {
        $candidate = New-DeviceCode
        $check = Invoke-SupabaseRest 'Get' "remote_devices?id=eq.$candidate&select=id"
        if (-not $check -or $check.Count -eq 0) {
            Register-Device $candidate
            Set-Content -LiteralPath $idFile -Value $candidate -NoNewline -Encoding UTF8
            return $candidate
        }
    }
    throw "Could not allocate a unique device ID after 20 attempts."
}

function Send-Heartbeat([string]$DeviceId) {
    $body = @{ last_seen_at = (Now-Iso) } | ConvertTo-Json
    Invoke-SupabaseRest 'Patch' "remote_devices?id=eq.$DeviceId" $body @{ Prefer = "return=minimal" } | Out-Null
}

# ════════════════════════════════════════════════════════════════
# Sessions / consent
# ════════════════════════════════════════════════════════════════
function Get-PendingSession([string]$DeviceId) {
    $rows = Invoke-SupabaseRest 'Get' "remote_sessions?host_device_id=eq.$DeviceId&status=eq.pending&order=created_at.desc&limit=1"
    if ($rows -and $rows.Count -gt 0) { return $rows[0] }
    return $null
}

function Get-SessionById([string]$SessionId) {
    $rows = Invoke-SupabaseRest 'Get' "remote_sessions?id=eq.$SessionId&limit=1"
    if ($rows -and $rows.Count -gt 0) { return $rows[0] }
    return $null
}

function Set-SessionStatus([string]$SessionId, [string]$Status) {
    $body = @{ status = $Status; updated_at = (Now-Iso) } | ConvertTo-Json
    Invoke-SupabaseRest 'Patch' "remote_sessions?id=eq.$SessionId" $body @{ Prefer = "return=minimal" } | Out-Null
}

function Show-ConsentPrompt([string]$ViewerLabel) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $label = if ([string]::IsNullOrWhiteSpace($ViewerLabel)) { "Someone" } else { $ViewerLabel }
    $text = "$label wants to view and control this PC via Any Banana.`n`nAllow this session?"
    $result = [System.Windows.Forms.MessageBox]::Show(
        $text, "Any Banana - Incoming Connection",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button2
    )
    return ($result -eq [System.Windows.Forms.DialogResult]::Yes)
}

# ════════════════════════════════════════════════════════════════
# Screen capture + upload
# ════════════════════════════════════════════════════════════════
function Get-ScreenJpegBytes {
    Add-Type -AssemblyName System.Drawing | Out-Null
    $screenW = [BananaRemoteInput]::GetSystemMetrics(0)
    $screenH = [BananaRemoteInput]::GetSystemMetrics(1)
    if ($screenW -le 0 -or $screenH -le 0) { return $null }

    $full = New-Object System.Drawing.Bitmap $screenW, $screenH
    $g = [System.Drawing.Graphics]::FromImage($full)
    $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size $screenW, $screenH))
    $g.Dispose()

    $targetW = [Math]::Min(1280, $screenW)
    $targetH = [Math]::Max(1, [int]($screenH * ($targetW / $screenW)))
    $scaled = New-Object System.Drawing.Bitmap $full, $targetW, $targetH
    $full.Dispose()

    $stream = New-Object System.IO.MemoryStream
    $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
    $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]50)
    $scaled.Save($stream, $encoder, $encParams)
    $scaled.Dispose()
    return $stream.ToArray()
}

function Send-ScreenFrame([string]$SessionId, [byte[]]$JpegBytes) {
    if (-not $JpegBytes -or $JpegBytes.Length -eq 0) { return $false }
    $uri = "$SUPABASE_URL/storage/v1/object/remote-screens/$SessionId/frame.jpg"
    $headers = @{
        "apikey"        = $SUPABASE_ANON_KEY
        "Authorization" = "Bearer $SUPABASE_ANON_KEY"
        "x-upsert"      = "true"
    }
    try {
        Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -ContentType "image/jpeg" -Body $JpegBytes -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop | Out-Null
    } catch {
        return $false
    }
    $body = @{ last_frame_at = (Now-Iso) } | ConvertTo-Json
    Invoke-SupabaseRest 'Patch' "remote_sessions?id=eq.$SessionId" $body @{ Prefer = "return=minimal" } | Out-Null
    return $true
}

# ════════════════════════════════════════════════════════════════
# Input injection (P-Invoke, same technique as
# xray-local-launcher.ps1's Start-RestoreRayViewerWindow)
# ════════════════════════════════════════════════════════════════
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BananaRemoteInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    // dwData is declared int, not uint, even though the real Win32 signature
    // says DWORD -- for MOUSEEVENTF_WHEEL this value is a SIGNED wheel delta
    // (negative = scroll down) reinterpreted as a bit pattern, and PowerShell's
    // [uint32] cast is a *checked* conversion that throws on any negative
    // input (confirmed live 2026-08-27: every single wheel-scroll event threw
    // "value was either too large or too small for a UInt32", which -- before
    // per-event try/catch was added below -- silently wedged the ENTIRE input
    // queue forever the moment anyone touched their scroll wheel, since the
    // poisoned event's id never advanced past it). Marshaling as int carries
    // the exact same 4 bytes across the P/Invoke boundary with no such check.
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    // KEYEVENTF_UNICODE lets us type any character (any language/layout)
    // without needing a virtual-key lookup table -- the standard trick for
    // "type this exact text" automation.
    public static void SendUnicodeChar(char c) {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = 1; // INPUT_KEYBOARD
        inputs[0].U.ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = 0x0004, time = 0, dwExtraInfo = IntPtr.Zero };
        inputs[1].type = 1;
        inputs[1].U.ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = 0x0004 | 0x0002, time = 0, dwExtraInfo = IntPtr.Zero };
        SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
}
"@

$script:MouseFlags = @{
    left_down   = 0x0002
    left_up     = 0x0004
    right_down  = 0x0008
    right_up    = 0x0010
    middle_down = 0x0020
    middle_up   = 0x0040
    wheel       = 0x0800
}

function Invoke-RemoteInputEvent($Event) {
    $screenW = [BananaRemoteInput]::GetSystemMetrics(0)
    $screenH = [BananaRemoteInput]::GetSystemMetrics(1)
    switch ($Event.event_type) {
        "mousemove" {
            $x = ConvertFrom-NormalizedCoord ([double]$Event.x) $screenW
            $y = ConvertFrom-NormalizedCoord ([double]$Event.y) $screenH
            [BananaRemoteInput]::SetCursorPos($x, $y) | Out-Null
        }
        "mousedown" {
            $x = ConvertFrom-NormalizedCoord ([double]$Event.x) $screenW
            $y = ConvertFrom-NormalizedCoord ([double]$Event.y) $screenH
            [BananaRemoteInput]::SetCursorPos($x, $y) | Out-Null
            $flag = if ($Event.button -eq "right") { $script:MouseFlags.right_down } elseif ($Event.button -eq "middle") { $script:MouseFlags.middle_down } else { $script:MouseFlags.left_down }
            [BananaRemoteInput]::mouse_event([uint32]$flag, 0, 0, 0, [UIntPtr]::Zero)
        }
        "mouseup" {
            $flag = if ($Event.button -eq "right") { $script:MouseFlags.right_up } elseif ($Event.button -eq "middle") { $script:MouseFlags.middle_up } else { $script:MouseFlags.left_up }
            [BananaRemoteInput]::mouse_event([uint32]$flag, 0, 0, 0, [UIntPtr]::Zero)
        }
        "wheel" {
            $delta = [int]([double]$Event.delta)
            [BananaRemoteInput]::mouse_event([uint32]$script:MouseFlags.wheel, 0, 0, [int](-1 * $delta), [UIntPtr]::Zero)
        }
        "keydown" {
            $vk = Get-VirtualKeyCode $Event.key
            if ($null -ne $vk) {
                [BananaRemoteInput]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
            } elseif ($Event.key -and $Event.key.Length -eq 1) {
                [BananaRemoteInput]::SendUnicodeChar($Event.key[0])
            }
        }
        "keyup" {
            $vk = Get-VirtualKeyCode $Event.key
            if ($null -ne $vk) {
                [BananaRemoteInput]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
            }
            # Printable characters are sent as a single down+up pair by
            # SendUnicodeChar on keydown already -- keyup is a no-op for them.
        }
    }
}

function Get-NewInputEvents([string]$SessionId, [long]$SinceId) {
    $rows = Invoke-SupabaseRest 'Get' "remote_input_events?session_id=eq.$SessionId&id=gt.$SinceId&order=id.asc&limit=200"
    if ($rows) { return $rows }
    return @()
}

function Remove-InputEvents([string]$SessionId, [long]$MaxId) {
    Invoke-SupabaseRest 'Delete' "remote_input_events?session_id=eq.$SessionId&id=lte.$MaxId" $null @{ Prefer = "return=minimal" } | Out-Null
}

# Live-trial finding (2026-08-27): fetching+applying input, uploading a
# screen frame, and checking for files are all separate real network round
# trips to Supabase -- over an actual internet connection (not localhost)
# each one can take a few hundred ms, so doing them serially made a single
# mouse move/keypress measurably lag by more than one whole tick even
# though the coordinate math itself was pixel-exact. Pulled into its own
# function so the main loop (below) can call it BOTH before and after the
# comparatively slow screen-frame upload each tick -- mouse/keyboard stay
# responsive even while a frame is mid-upload, at zero extra Start-Sleep
# cost.
function Invoke-PendingInputEvents([string]$SessionId) {
    $events = Get-NewInputEvents $SessionId $script:lastEventId
    if ($events.Count -eq 0) { return }
    $injectFailures = 0
    foreach ($ev in $events) {
        try {
            Invoke-RemoteInputEvent $ev
        } catch {
            $injectFailures++
        }
        if ([long]$ev.id -gt $script:lastEventId) { $script:lastEventId = [long]$ev.id }
    }
    if ($injectFailures -gt 0) {
        Write-AgentLog "Skipped $injectFailures of $($events.Count) input event(s) this tick (injection error)."
    }
    Remove-InputEvents $SessionId $script:lastEventId
}

# ════════════════════════════════════════════════════════════════
# File transfer (incoming, viewer -> this host)
# ════════════════════════════════════════════════════════════════
function Get-IncomingFiles([string]$SessionId) {
    $rows = Invoke-SupabaseRest 'Get' "remote_files?session_id=eq.$SessionId&direction=eq.to_host&delivered=eq.false&order=created_at.asc"
    if ($rows) { return $rows }
    return @()
}

function Save-IncomingFile($FileRow) {
    $destDir = Get-DownloadsFolder
    if (-not (Test-Path -LiteralPath $destDir)) {
        try {
            New-Item -ItemType Directory -Path $destDir -Force -ErrorAction Stop | Out-Null
        } catch {
            $destDir = Join-Path $InstallPath "Received"
            New-Item -ItemType Directory -Path $destDir -Force -ErrorAction SilentlyContinue | Out-Null
        }
    }
    $safeName = [IO.Path]::GetFileName($FileRow.file_name)
    $destPath = Join-Path $destDir $safeName
    # Never silently overwrite an existing file of the same name -- very
    # plausible now that everything lands in the same shared Downloads
    # folder. Numbers it instead, the same convention browsers themselves
    # use for repeat downloads.
    if (Test-Path -LiteralPath $destPath) {
        $base = [IO.Path]::GetFileNameWithoutExtension($safeName)
        $ext = [IO.Path]::GetExtension($safeName)
        $n = 1
        do {
            $destPath = Join-Path $destDir ("{0} ({1}){2}" -f $base, $n, $ext)
            $n++
        } while (Test-Path -LiteralPath $destPath)
    }
    $url = "$SUPABASE_URL/storage/v1/object/public/remote-files/$($FileRow.storage_path)"
    try {
        Invoke-WebRequest -Uri $url -OutFile $destPath -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
        $body = @{ delivered = $true } | ConvertTo-Json
        Invoke-SupabaseRest 'Patch' "remote_files?id=eq.$($FileRow.id)" $body @{ Prefer = "return=minimal" } | Out-Null
        Write-AgentLog "Saved incoming file '$safeName' -> $destPath"
        return $true
    } catch {
        Write-AgentLog "Failed to save incoming file '$safeName': $($_.Exception.Message)"
        return $false
    }
}

# ════════════════════════════════════════════════════════════════
# Local HTTP endpoint -- ONLY for "what is my device ID" / status,
# read by the Banana web app running on this SAME PC. Same CORS +
# Local Network Access headers already proven working for the X-ray
# bridge (see xray-local-launcher.ps1) so this works from the hosted
# GitHub Pages origin too, not just a local dev server.
# ════════════════════════════════════════════════════════════════
function Send-Http($Client, $StatusCode, $ContentType, [byte[]]$Bytes) {
    $statusText = if ($StatusCode -eq 200) { "OK" } elseif ($StatusCode -eq 204) { "No Content" } else { "Error" }
    $headers = @(
        "HTTP/1.1 $StatusCode $statusText",
        "Content-Type: $ContentType",
        "Access-Control-Allow-Origin: *",
        "Access-Control-Allow-Methods: GET, OPTIONS",
        "Access-Control-Allow-Headers: Content-Type",
        "Access-Control-Allow-Private-Network: true",
        "Cache-Control: no-store",
        "Content-Length: $($Bytes.Length)",
        "Connection: close",
        "",
        ""
    ) -join "`r`n"
    $stream = $Client.GetStream()
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Bytes.Length -gt 0) { $stream.Write($Bytes, 0, $Bytes.Length) }
}

function Send-Json($Client, $StatusCode, $Body) {
    $json = if ($null -eq $Body) { "" } else { $Body | ConvertTo-Json -Depth 8 -Compress }
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    Send-Http $Client $StatusCode "application/json; charset=utf-8" $bytes
}

function Handle-LocalRequest($Method, $Path, $DeviceId, $HasActiveSession) {
    if ($Method -eq "OPTIONS") { return @{ status = 204; body = $null } }
    switch -Regex ($Path) {
        "^/status" { return @{ status = 200; body = @{ ok = $true; device_id = $DeviceId; device_name = $DeviceName; agent_version = $AgentVersion; active_session = [bool]$HasActiveSession } } }
        "^/device-id" { return @{ status = 200; body = @{ device_id = $DeviceId; device_name = $DeviceName } } }
        default { return @{ status = 404; body = @{ ok = $false; error = "not_found" } } }
    }
}

# ════════════════════════════════════════════════════════════════
# Self-test
# ════════════════════════════════════════════════════════════════
function Invoke-SelfTest {
    $script:passed = 0
    $script:failures = New-Object System.Collections.Generic.List[string]

    function Assert-Equal($Label, $Expected, $Actual) {
        if ("$Expected" -eq "$Actual") {
            $script:passed++
            Write-Host "  [PASS] $Label" -ForegroundColor Green
        } else {
            $script:failures.Add("$Label -- expected [$Expected] got [$Actual]")
            Write-Host "  [FAIL] $Label -- expected [$Expected] got [$Actual]" -ForegroundColor Red
        }
    }

    Write-Host "== New-DeviceCode (6-digit, human-typeable) ==" -ForegroundColor Cyan
    $code = New-DeviceCode
    Assert-Equal "Is exactly 6 characters" 6 $code.Length
    Assert-Equal "Is all digits" $true ($code -match '^\d{6}$')

    Write-Host "== ConvertTo/From-NormalizedCoord (mouse coordinate round-trip) ==" -ForegroundColor Cyan
    Assert-Equal "Midpoint fraction"     0.5   (ConvertTo-NormalizedCoord 640 1280)
    Assert-Equal "Clamps below 0"        0     (ConvertTo-NormalizedCoord -50 1280)
    Assert-Equal "Clamps above 1"        1     (ConvertTo-NormalizedCoord 9999 1280)
    Assert-Equal "Zero-width dimension is safe" 0 (ConvertTo-NormalizedCoord 100 0)
    Assert-Equal "Fraction back to pixel"   960  (ConvertFrom-NormalizedCoord 0.5 1920)
    Assert-Equal "Fraction 1.0 clamps to last pixel" 1919 (ConvertFrom-NormalizedCoord 1.0 1920)
    Assert-Equal "Round-trip stays close" $true ([Math]::Abs((ConvertFrom-NormalizedCoord (ConvertTo-NormalizedCoord 400 1280) 1280) - 400) -le 1)

    Write-Host "== Get-VirtualKeyCode (special key lookup) ==" -ForegroundColor Cyan
    Assert-Equal "Enter maps to 0x0D"     13  (Get-VirtualKeyCode "Enter")
    Assert-Equal "Backspace maps to 0x08"  8  (Get-VirtualKeyCode "Backspace")
    Assert-Equal "Unknown key returns null" $true ($null -eq (Get-VirtualKeyCode "SomeUnknownKey"))
    Assert-Equal "Printable char is not in the VK map" $true ($null -eq (Get-VirtualKeyCode "a"))

    Write-Host "== Get-DownloadsFolder (incoming files land somewhere real) ==" -ForegroundColor Cyan
    $downloads = Get-DownloadsFolder
    Assert-Equal "Returns a non-empty path" $true (-not [string]::IsNullOrWhiteSpace($downloads))
    Assert-Equal "Path name ends with Downloads or Received" $true ($downloads -match '(Downloads|Received)$')

    Write-Host "== Handle-LocalRequest (routing only, no real device/session state) ==" -ForegroundColor Cyan
    $statusResp = Handle-LocalRequest "GET" "/status" "123456" $false
    Assert-Equal "/status returns 200"        200    $statusResp.status
    Assert-Equal "/status reports device id"  "123456" $statusResp.body.device_id
    $idResp = Handle-LocalRequest "GET" "/device-id" "654321" $false
    Assert-Equal "/device-id returns 200"     200    $idResp.status
    $unknownResp = Handle-LocalRequest "GET" "/nope" "123456" $false
    Assert-Equal "Unknown path returns 404"   404    $unknownResp.status
    $optionsResp = Handle-LocalRequest "OPTIONS" "/status" "123456" $false
    Assert-Equal "OPTIONS returns 204"        204    $optionsResp.status

    Write-Host ""
    $total = $script:passed + $script:failures.Count
    if ($script:failures.Count -eq 0) {
        Write-Host "SELF-TEST PASSED: $($script:passed) / $total checks" -ForegroundColor Green
        return 0
    } else {
        Write-Host "SELF-TEST FAILED: $($script:failures.Count) of $total checks failed" -ForegroundColor Red
        $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        return 1
    }
}

if ($SelfTest) {
    exit (Invoke-SelfTest)
}

# ════════════════════════════════════════════════════════════════
# MAIN — only reached in normal (non -SelfTest) operation.
# ════════════════════════════════════════════════════════════════
if (-not (Test-Path -LiteralPath $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

Write-Step "Starting Any Banana remote agent"
$deviceId = Get-OrCreateDeviceId
Write-Ok "Device ID: $deviceId (this is what the other PC types into Any Banana to connect)"

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse("127.0.0.1"), $Port)
try {
    $listener.Start()
} catch {
    Write-Host "Any Banana agent is already running on port $Port (or the port is taken). Exiting." -ForegroundColor Yellow
    exit 0
}
Write-Host "Any Banana agent ready: http://127.0.0.1:$Port  (device $deviceId)" -ForegroundColor Green
Write-Host "Leave this window open (or let it run minimized) to allow incoming connections." -ForegroundColor Cyan

$lastHeartbeat = [DateTime]::MinValue
$lastEventId = 0
$lastFileCheck = [DateTime]::MinValue
$activeSessionId = $null
Write-AgentLog "Agent started (device $deviceId, port $Port)."

while ($true) {
    # Everything in this tick is wrapped so ONE bad iteration (a flaky
    # Supabase call, a screen-capture hiccup, whatever) gets logged and
    # skipped instead of silently killing the whole agent -- see
    # Write-AgentLog's comment above for why this matters.
    try {
        if ($listener.Pending()) {
            $client = $listener.AcceptTcpClient()
            try {
                $stream = $client.GetStream()
                $buffer = New-Object byte[] 4096
                $read = $stream.Read($buffer, 0, $buffer.Length)
                $request = [Text.Encoding]::ASCII.GetString($buffer, 0, $read)
                $firstLine = ($request -split "`r?`n")[0]
                $parts = $firstLine -split " "
                $method = if ($parts.Count -gt 0) { $parts[0] } else { "" }
                $path = if ($parts.Count -gt 1) { $parts[1] } else { "/" }
                $resp = Handle-LocalRequest $method $path $deviceId ($null -ne $activeSessionId)
                Send-Json $client $resp.status $resp.body
            } catch {
            } finally {
                $client.Close()
            }
        }

        $now = Get-Date
        if (($now - $lastHeartbeat).TotalSeconds -ge 15) {
            Send-Heartbeat $deviceId
            $lastHeartbeat = $now
        }

        if (-not $activeSessionId) {
            $pending = Get-PendingSession $deviceId
            if ($pending) {
                Write-AgentLog "Pending session $($pending.id) from '$($pending.viewer_label)' -- showing consent prompt."
                # Isolated from the outer try/catch on purpose: if the consent
                # UI itself is what's misbehaving (no interactive desktop,
                # blocked window station, whatever), default to DENY rather
                # than leaving the session stuck in limbo until the viewer's
                # own client-side timeout eventually gives up.
                $allowed = $false
                try {
                    $allowed = Show-ConsentPrompt $pending.viewer_label
                } catch {
                    Write-AgentLog "Show-ConsentPrompt threw: $($_.Exception.GetType().FullName) - $($_.Exception.Message) -- defaulting to deny."
                    $allowed = $false
                }
                if ($allowed) {
                    Set-SessionStatus $pending.id "accepted"
                    $activeSessionId = $pending.id
                    $lastEventId = 0
                    Write-AgentLog "Session $($pending.id) accepted."
                } else {
                    Set-SessionStatus $pending.id "denied"
                    Write-AgentLog "Session $($pending.id) denied."
                }
            }
        } else {
            $sessionRow = Get-SessionById $activeSessionId
            if (-not $sessionRow -or $sessionRow.status -ne "accepted") {
                Write-AgentLog "Session $activeSessionId ended (status: $(if ($sessionRow) { $sessionRow.status } else { 'not found' }))."
                $activeSessionId = $null
            } else {
                # Input FIRST: applying a queued mouse/keyboard event is what
                # "feels laggy" if delayed, whereas the screen frame below is
                # already expected to be a few hundred ms stale (screenshot
                # polling, not video) -- so control latency should never be
                # made to wait behind screen-upload latency.
                Invoke-PendingInputEvents $activeSessionId

                $jpeg = Get-ScreenJpegBytes
                if ($jpeg) { Send-ScreenFrame $activeSessionId $jpeg | Out-Null }

                # Check again right after the upload (the slowest single
                # network call in this tick) so anything the viewer sent
                # while it was in flight still lands in THIS tick instead of
                # waiting for a whole extra Start-Sleep cycle -- doubles
                # input responsiveness at no extra network cost when the
                # queue is already empty (Get-NewInputEvents returning zero
                # rows is cheap).
                Invoke-PendingInputEvents $activeSessionId

                # Files matter far less for "does this feel responsive" than
                # mouse/keyboard do, so this REST round trip is throttled
                # rather than paid on every single tick.
                if (($now - $lastFileCheck).TotalSeconds -ge 2) {
                    $incomingFiles = Get-IncomingFiles $activeSessionId
                    foreach ($f in $incomingFiles) { Save-IncomingFile $f | Out-Null }
                    $lastFileCheck = $now
                }
            }
        }
    } catch {
        Write-AgentLog "Main loop error (tick skipped, agent keeps running): $($_.Exception.GetType().FullName) - $($_.Exception.Message)"
    }

    Start-Sleep -Milliseconds $PollIntervalMs
}
