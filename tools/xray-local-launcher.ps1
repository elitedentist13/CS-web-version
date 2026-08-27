# tools/xray-local-launcher.ps1
# Joyful Smile / Banana Clinic Manager — local desktop bridge for X-ray systems.
#
# Runs on each clinic PC (started by "Start X-Ray Launcher.bat"). Listens on
# 127.0.0.1:17890 and lets the browser app open Carestream / Ai-Dental /
# NNT-NEWTOM / EzDent-i (Vatech) with the active patient's demographics
# pre-filled, without the browser ever touching the local filesystem or
# spawning processes directly.
#
# This is a versioned copy of the script deployed at C:\NNT\xray-local-launcher.ps1
# on clinic PCs. Deploy by copying this file (and "Start X-Ray Launcher.bat")
# to the clinic PC's launcher folder.
#
# Self-test (no listener started, nothing launched, nothing outside $env:TEMP
# touched): 
#     powershell -NoProfile -ExecutionPolicy Bypass -File tools\xray-local-launcher.ps1 -SelfTest
#
param(
    [switch]$SelfTest,
    # Self-test is side-effect-free by default. On a PC where NNT is actually
    # installed, Handle-Request's real /open/nntnewtom path (deliberately
    # shared with the live server, for genuine coverage) WILL launch the real
    # NNTBridge.exe / NNT.exe. Pass this switch only when you want that real,
    # visible launch as part of the check.
    [switch]$IncludeLiveLaunch,
    [int]$Port = 0,
    # Restricts this instance to only the listed $Systems key(s), e.g.
    # -EnabledSystems ezdenti. Unlisted systems are treated exactly like an
    # unknown key everywhere (Resolve-System returns null, /open/<key> 404s,
    # Status-Payload omits them) -- NOT just hidden from a menu. This is what
    # lets the separate installer-ezdenti / installer-nntnewtom packages
    # (see tools/README.md) share this one engine file without ever
    # "mixing": an EzDent-i-only PC's bridge genuinely does not know
    # NNT-NEWTOM exists, and vice versa, even if both scripts happen to be
    # byte-for-byte identical copies. Default (omitted/empty) = every system
    # in $Systems, i.e. today's behavior, used by the shared dev copy here
    # and by anyone who deliberately wants one bridge covering every system
    # installed on a given PC.
    [string[]]$EnabledSystems = @()
)

$ErrorActionPreference = "Continue"

# If -EnabledSystems was passed as a single comma-separated string (from a bat file),
# split it into an array. PowerShell command-line parsing doesn't auto-split.
if ($EnabledSystems.Count -eq 1 -and $EnabledSystems[0] -match ',') {
    $EnabledSystems = @($EnabledSystems[0] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

if (-not $Port -or $Port -le 0) {
    $Port = if ($env:XRAY_LAUNCHER_PORT) { [int]$env:XRAY_LAUNCHER_PORT } else { 17890 }
}

# Optional per-PC overrides (SCAN share roots, etc.) — see xray-launcher-config.example-*.ps1
$configPath = Join-Path $PSScriptRoot "xray-launcher-config.ps1"
if (Test-Path -LiteralPath $configPath) {
    try { . $configPath } catch {
        Write-Warning "Could not load xray-launcher-config.ps1: $($_.Exception.Message)"
    }
}
if (-not $EnabledSystems -or $EnabledSystems.Count -eq 0) {
    if ($env:XRAY_ENABLED_SYSTEMS) {
        $EnabledSystems = @($env:XRAY_ENABLED_SYSTEMS -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
}
function Test-SystemEnabled($Key) {
    if (-not $EnabledSystems -or $EnabledSystems.Count -eq 0) { return $true }
    return [bool]($EnabledSystems -contains $Key)
}
$PublicDesktop = Join-Path ($env:PUBLIC -replace '/','\') "Desktop"
$UserDesktop = [Environment]::GetFolderPath("Desktop")

function Test-PathSafe($Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    try { return Test-Path -LiteralPath $Path } catch { return $false }
}

function First-Existing($Paths) {
    foreach ($p in $Paths) {
        if (Test-PathSafe $p) { return $p }
    }
    return ""
}

function Resolve-Shortcut($ShortcutPath) {
    if (-not (Test-PathSafe $ShortcutPath)) { return $null }
    try {
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($ShortcutPath)
        return [ordered]@{
            shortcut = $ShortcutPath
            target = $lnk.TargetPath
            arguments = $lnk.Arguments
            workingDirectory = $lnk.WorkingDirectory
        }
    } catch {
        return $null
    }
}

$Systems = @{
    carestream = @{
        shortcuts = @(
            (Join-Path $PublicDesktop "CS Imaging Software.lnk"),
            (Join-Path $UserDesktop "CS Imaging Software.lnk")
        )
        executables = @(
            "C:\Program Files (x86)\Carestream\Patient Browser\Patient.exe",
            "C:\Program Files\Carestream\Patient Browser\Patient.exe"
        )
    }
    # Trophy F7 in Clinic Solution (Carestream CSImaging / TW.exe). Traced live
    # 2026-08-27 on Dr-1-MCP: CS.exe spawns TW.exe with the patient's CS SCAN
    # folder and bilingual UI labels, e.g.
    #   TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\001074 -NLUI HOI TING  雷凱婷 -FLUI HOI TING  雷凱婷
    trophy = @{
        shortcuts = @()
        executables = @(
            "C:\Program Files (x86)\Carestream\CSImaging\TW.exe",
            "C:\Program Files\Carestream\CSImaging\TW.exe"
        )
    }
    aidental = @{
        shortcuts = @(
            (Join-Path $PublicDesktop "Ai-Dental-Client.lnk"),
            (Join-Path $UserDesktop "Ai-Dental-Client.lnk")
        )
        executables = @(
            "C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe",
            "C:\Program Files\Ai-Dental\Ai-Dental.exe",
            "C:\Program Files (x86)\Ai-Dental\Ai-Dental.exe"
        )
    }
    nntnewtom = @{
        shortcuts = @(
            (Join-Path $PublicDesktop "NNT.lnk"),
            (Join-Path $UserDesktop "NNT.lnk"),
            (Join-Path $PublicDesktop "NEWTOM.lnk"),
            (Join-Path $UserDesktop "NEWTOM.lnk"),
            (Join-Path $PublicDesktop "NewTom.lnk"),
            (Join-Path $UserDesktop "NewTom.lnk"),
            (Join-Path $PublicDesktop "NNT Viewer.lnk"),
            (Join-Path $UserDesktop "NNT Viewer.lnk")
        )
        executables = @(
            "C:\NNT\NNT.exe",
            "C:\Program Files\NNT\NNT.exe",
            "C:\Program Files (x86)\NNT\NNT.exe",
            "C:\Program Files\NewTom\NNT\NNT.exe",
            "C:\Program Files (x86)\NewTom\NNT\NNT.exe",
            "C:\Program Files\QR\NNT\NNT.exe",
            "C:\Program Files (x86)\QR\NNT\NNT.exe",
            "C:\Program Files\CEFLA\NNT\NNT.exe",
            "C:\Program Files (x86)\CEFLA\NNT\NNT.exe"
        )
    }
    # Rayscan / SMARTDent V3 (RAY Co.). Confirmed live on a real clinic PC
    # (2026-08-20, hostname "Doctor-1", chart KT005455): Public Desktop has
    # "RAYBridge.lnk" -> C:\Ray\RAYBridge\RAYBridge.exe (empty Arguments --
    # same "shortcut carries no args, caller builds them fresh" pattern as
    # NNTBridge.exe above) and "SMARTDent V3.lnk" -> C:\Ray\RayView\SMARTDent.exe.
    # This PC is the CLIENT: RAYBridge / RayView / the "Ray Local Server"
    # Windows service all run locally and talk to the clinic's imaging
    # server (C:\Ray\RAYBridge\local_server_config.xml and
    # C:\Ray\RayView\local_server_config.xml both point
    # global_ip_address=192.168.50.140, global_port=9876 -- almost certainly
    # DESKTOP-CU5IQLC next to the OPG/CT unit; local_port=8765 is served by
    # local_server_console.exe on THIS pc). That client<->server sync is
    # entirely Ray's own software -- this bridge only ever needs to launch
    # RAYBridge.exe on whatever PC the browser is open on, exactly like the
    # NNTBridge/EzDent-i pattern above.
    rayscan = @{
        shortcuts = @(
            (Join-Path $PublicDesktop "RAYBridge.lnk"),
            (Join-Path $UserDesktop "RAYBridge.lnk"),
            (Join-Path $PublicDesktop "SMARTDent V3.lnk"),
            (Join-Path $UserDesktop "SMARTDent V3.lnk")
        )
        executables = @(
            "C:\Ray\RAYBridge\RAYBridge.exe",
            "C:\Ray\RayView\SMARTDent.exe"
        )
    }
    ezdenti = @{
        shortcuts = @(
            (Join-Path $PublicDesktop "EzDent-i.lnk"),
            (Join-Path $UserDesktop "EzDent-i.lnk"),
            (Join-Path $PublicDesktop "EZDent-i.lnk"),
            (Join-Path $UserDesktop "EZDent-i.lnk"),
            (Join-Path $PublicDesktop "Ezdent-i.lnk"),
            (Join-Path $UserDesktop "Ezdent-i.lnk")
        )
        # VTE2Loader32.exe (EzDent-i 3.0.0+) is tried first -- confirmed live
        # (2026-08-19) to actually open the visible EzDent-i window (spawns
        # VTE232.exe). VTEzBridge32.exe is deliberately NOT in this list --
        # unlike the loader, it was confirmed (same live test) to exit in
        # well under 500ms with no window at all, so it must never be the
        # thing this script treats as "the app to open" -- see
        # Resolve-EzdentiBridge / Start-EzdentiBridgePatient below for how
        # it's actually used (fired best-effort, in addition to, not
        # instead of, one of the exes below).
        executables = @(
            "C:\Program Files (x86)\VATECH\EzDent-i\Bin\VTE2Loader32.exe",
            "C:\Program Files\VATECH\EzDent-i\Bin\VTE2Loader32.exe",
            "C:\Program Files (x86)\VATECH\EzDent-i\Bin\VTE2Loader_ReqAdmin32.exe",
            "C:\Program Files\VATECH\EzDent-i\Bin\VTE2Loader_ReqAdmin32.exe",
            "C:\Program Files (x86)\VATECH\EzDent-i\Bin\VTEzDent-iLoader32.exe",
            "C:\Program Files\VATECH\EzDent-i\Bin\VTEzDent-iLoader32.exe",
            # Last resort: the app itself, same as CS's own (blind) launch --
            # guarantees a window opens even if no loader exe is found.
            "C:\Program Files (x86)\VATECH\EzDent-i\Bin\VTE232.exe",
            "C:\Program Files\VATECH\EzDent-i\Bin\VTE232.exe"
        )
    }
}

function Resolve-System($Key, $PreferredExecutable) {
    if (-not (Test-SystemEnabled $Key)) { return $null }
    $cfg = $Systems[$Key]
    if (-not $cfg) { return $null }

    $preferred = ""
    if (Test-PathSafe $PreferredExecutable) { $preferred = $PreferredExecutable }
    $shortcut = First-Existing $cfg.shortcuts
    $shortcutInfo = Resolve-Shortcut $shortcut
    $exe = First-Existing $cfg.executables
    $target = if ($preferred) { $preferred } elseif ($shortcutInfo -and (Test-PathSafe $shortcutInfo.target)) { $shortcutInfo.target } elseif ($exe) { $exe } else { $shortcut }
    $type = if ($preferred) { "configured" } elseif ($shortcutInfo -and (Test-PathSafe $shortcutInfo.target)) { "shortcut-target" } elseif ($exe) { "executable" } elseif ($shortcut) { "shortcut" } else { "" }
    $arguments = if ($shortcutInfo) { $shortcutInfo.arguments } else { "" }
    $workingDirectory = if ($shortcutInfo -and $shortcutInfo.workingDirectory) { $shortcutInfo.workingDirectory } elseif ($target) { Split-Path -Parent $target } else { "" }

    return [ordered]@{
        key = $Key
        exists = [bool]$target
        target = $target
        type = $type
        arguments = $arguments
        workingDirectory = $workingDirectory
        shortcut = $shortcut
    }
}

function UrlDecode($Value) {
    if ($null -eq $Value) { return "" }
    return [Uri]::UnescapeDataString(($Value -replace '\+', ' '))
}

function Parse-Query($RawPath) {
    $out = @{}
    $idx = $RawPath.IndexOf("?")
    if ($idx -lt 0) { return $out }
    $query = $RawPath.Substring($idx + 1)
    foreach ($part in ($query -split "&")) {
        if (-not $part) { continue }
        $kv = $part -split "=", 2
        $k = UrlDecode $kv[0]
        $v = if ($kv.Count -gt 1) { UrlDecode $kv[1] } else { "" }
        $out[$k] = $v
    }
    return $out
}

function Status-Payload {
    # Only reports on systems this instance actually serves (see
    # -EnabledSystems / Test-SystemEnabled above) -- an EzDent-i-only
    # install's /status genuinely has no opinion on NNT-NEWTOM, rather than
    # just reporting it as "not found".
    $payload = [ordered]@{ ok = $true }
    $systemsOut = [ordered]@{}
    foreach ($key in $Systems.Keys) {
        if (-not (Test-SystemEnabled $key)) { continue }
        $resolved = Resolve-System $key ""
        $payload["${key}_exists"] = [bool]$resolved.exists
        $systemsOut[$key] = $resolved
    }
    $payload["systems"] = $systemsOut
    $payload["enabled_systems"] = if ($EnabledSystems -and $EnabledSystems.Count -gt 0) { @($EnabledSystems) } else { @($Systems.Keys) }
    return $payload
}

function Get-HttpStatusText($StatusCode) {
    switch ([int]$StatusCode) {
        200 { "OK" }
        204 { "No Content" }
        400 { "Bad Request" }
        404 { "Not Found" }
        default { "Error" }
    }
}

function Send-Http($Client, $StatusCode, $ContentType, $Bytes) {
    if ($null -eq $Bytes) { $Bytes = [byte[]]@() }
    $statusText = Get-HttpStatusText $StatusCode
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

function Send-Bytes($Client, $StatusCode, $ContentType, $Bytes) {
    Send-Http $Client $StatusCode $ContentType $Bytes
}

function Start-ResolvedProgram($Resolved) {
    if (-not $Resolved -or -not $Resolved.target) {
        throw "No target to launch."
    }
    $args = @{
        FilePath = $Resolved.target
    }
    if ($Resolved.workingDirectory -and (Test-PathSafe $Resolved.workingDirectory)) {
        $args.WorkingDirectory = $Resolved.workingDirectory
    }
    if ($Resolved.arguments) {
        $args.ArgumentList = $Resolved.arguments
    }
    Start-Process @args
}

function Resolve-NntBridge($Resolved) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($Resolved -and $Resolved.workingDirectory) {
        $candidates.Add((Join-Path $Resolved.workingDirectory "NNTBridge.exe"))
    }
    if ($Resolved -and $Resolved.target) {
        $targetDir = Split-Path -Parent $Resolved.target
        if ($targetDir) { $candidates.Add((Join-Path $targetDir "NNTBridge.exe")) }
    }
    $candidates.Add("C:\NNT\NNTBridge.exe")
    $candidates.Add("C:\Program Files\NNT\NNTBridge.exe")
    $candidates.Add("C:\Program Files (x86)\NNT\NNTBridge.exe")
    return First-Existing $candidates
}

function Quote-ProcessArg($Value) {
    $s = [string]$Value
    if ($s -match '[\s"]') {
        return '"' + ($s -replace '"', '\"') + '"'
    }
    return $s
}

# Banana's <input type="date"> always yields yyyy-MM-dd; the other formats
# are kept as a safety net for hand-typed or legacy-imported values.
function Convert-NntBirthDate($Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    $formats = @("yyyy-MM-dd", "yyyy/M/d", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy")
    foreach ($fmt in $formats) {
        try {
            $dt = [DateTime]::ParseExact($Value, $fmt, [Globalization.CultureInfo]::InvariantCulture)
            return $dt.ToString("dd/MM/yyyy")
        } catch {}
    }
    try {
        $dt = [DateTime]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture)
        return $dt.ToString("dd/MM/yyyy")
    } catch {
        return $Value
    }
}

# Banana's <select id="sex"> only ever sends "M", "F", or "" — the extra
# Male/Female matches are kept for any other caller of this bridge.
function Convert-NntSex($Value) {
    $s = ([string]$Value).Trim().ToUpperInvariant()
    if ($s -match '^(M|MALE)$') { return "M" }
    if ($s -match '^(F|FEMALE)$') { return "F" }
    return ""
}

# EzDent-i's linkage.xml <Gender> element wants the full word, not a
# single-letter code (see Open Dental's own bridge sample: "Male").
function Convert-GenderWord($Value) {
    $s = ([string]$Value).Trim().ToUpperInvariant()
    if ($s -match '^(M|MALE)$') { return "Male" }
    if ($s -match '^(F|FEMALE)$') { return "Female" }
    return ""
}

function Escape-Xml($Value) {
    $s = [string]$Value
    if ([string]::IsNullOrEmpty($s)) { return "" }
    return $s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace('"', "&quot;").Replace("'", "&apos;")
}

# Banana's patient_no can carry a clinic-configurable letter prefix (Program
# Settings -> "patient_no_prefix", e.g. "PY002505"), but NNT's own chart
# numbers are always bare digits -- confirmed against a real scanned record
# on \\RECEPTION\IMAGE\SCAN\002505 that has no matching "PY002505" folder at
# all. Without this, /PATID never matches an existing NNT patient for anyone
# whose clinic uses a prefix, so NNT silently falls back to "new patient"
# mode (info fills in fine, but no x-rays show, since NNT never found them).
# Extract the first run of digits so /PATID matches regardless of prefix.
function Convert-NntPatientId($Value) {
    $s = [string]$Value
    if ([string]::IsNullOrWhiteSpace($s)) { return "" }
    $m = [regex]::Match($s, '\d+')
    if ($m.Success) { return $m.Value }
    return $s.Trim()
}

# 2D JPEG/PNG scans live on the Clinic Solution server's share keyed by bare
# NNT chart number. CORRECTED 2026-08-20 (live investigation from a real
# consultation-room PC, "DOCTOR-1"): the original "\\RECEPTION\..." hostname
# below was never actually confirmed reachable from a client PC -- it came
# from an earlier assumption baked in before this was checked live. On this
# clinic's real network, "RECEPTION" does not resolve at all (Resolve-DnsName
# / net view both fail), while the CS desktop shortcut's own ODBC DSN
# ("ClinicSolution", HKLM\SOFTWARE\WOW6432Node\ODBC\ODBC.INI\ClinicSolution)
# points at SQL Server host 192.168.50.2, whose NetBIOS name is "CSMAIN" --
# and \\CSMAIN\IMAGE\Scan\{chart} is the share that actually holds the scans
# (confirmed live: \\CSMAIN\IMAGE\Scan\006681 held patient MK006681's 2 real
# OPG JPEGs, matching Banana's own "MK" chart-prefix once stripped by
# Convert-NntPatientId below). Consultation-room PCs fetch these into Banana
# without writing anything to Supabase. Volumetric / .pan_* files stay inside
# NNT.exe — the browser cannot decode them.
$script:NntScanRootsOverride = $null
$script:NntScanImageExts = @(".jpg", ".jpeg", ".png", ".gif", ".bmp")

function Get-NntScanRoots {
    if ($null -ne $script:NntScanRootsOverride) { return $script:NntScanRootsOverride }
    return @(
        "\\RECEPTION_MCP\IMAGE\SCAN",
        "\\CSMAIN\IMAGE\Scan",
        "C:\Image\SCAN",
        "C:\IMAGE\SCAN"
    )
}

# NNT 2D panoramics on the CS IMAGE share are stored as *.2dh under
# SCAN\{chart}\Document\...\2D Images collection\. These are NNT-proprietary
# (not JPEGs). NNTBridge /DOCID <id> looks the id up in its own database and
# fails with "SELECTPATIENT: Err = 12 - Unable to open document" for these --
# use /DIR pointed at the chart's own SCAN folder instead (see
# Start-NntBridgePatient). Also used to locate the file for the JPEG
# export/import path into Supabase (see tools/_import_cs_opg.py).
function Find-Nnt2dDocFile($PatientNo) {
    $folder = Find-NntScanFolder $PatientNo
    if (-not $folder) { return "" }
    $doc = Join-Path $folder "Document"
    if (-not (Test-PathSafe $doc)) { return "" }
    try {
        $pattern = Join-Path $doc "*\*\*\*\*\2D Images collection\*.2dh"
        $hit = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $hit) {
            $hit = Get-ChildItem -LiteralPath $doc -Recurse -Filter "*.2dh" -File -ErrorAction SilentlyContinue |
                Select-Object -First 1
        }
        if ($hit) { return [string]$hit.FullName }
    } catch {}
    return ""
}

function Find-Nnt2dDocId($PatientNo) {
    $path = Find-Nnt2dDocFile $PatientNo
    if ([string]::IsNullOrWhiteSpace($path)) { return "" }
    return [IO.Path]::GetFileNameWithoutExtension($path)
}

# /DIR is ignored if NNT.exe is already running (confirmed live by tracing
# CS's own launch: CS closes/relaunches around this same constraint).
function Stop-NntProcessesForDir {
    foreach ($name in @("NNTBridge", "NNT_SID", "NNT")) {
        Get-Process -Name $name -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        $left = @(Get-Process -Name "NNT", "NNT_SID", "NNTBridge" -ErrorAction SilentlyContinue)
        if ($left.Count -eq 0) { return }
        Start-Sleep -Milliseconds 400
    }
}

function Get-NntScanIdCandidates($PatientNo) {
    $id = Convert-NntPatientId $PatientNo
    $list = New-Object System.Collections.Generic.List[string]
    if ([string]::IsNullOrWhiteSpace($id)) { return $list }
    $list.Add($id)
    if ($id -match '^\d+$' -and $id.Length -lt 6) {
        $padded = $id.PadLeft(6, '0')
        if ($padded -ne $id) { $list.Add($padded) }
    }
    return $list
}

function Test-PathIsUnder($Child, $Parent) {
    if ([string]::IsNullOrWhiteSpace($Child) -or [string]::IsNullOrWhiteSpace($Parent)) { return $false }
    try {
        $c = [IO.Path]::GetFullPath($Child)
        $p = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        return $c.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

# All root x id-candidate combinations, in priority order, REGARDLESS of
# whether the folder exists yet -- used so a brand-new patient (no scan
# folder on disk at all yet) can still have its would-be folder(s) watched
# for creation, rather than only ever resolving to "" until CS/NNT first
# creates it. Find-NntScanFolder (existence-based) and
# Start-NntNewOpgWatcher (watch-for-creation) both build on this.
function Get-NntScanFolderCandidatePaths($PatientNo) {
    $roots = Get-NntScanRoots
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($id in Get-NntScanIdCandidates $PatientNo) {
        foreach ($root in $roots) {
            if ([string]::IsNullOrWhiteSpace($root)) { continue }
            $out.Add((Join-Path ([string]$root) ([string]$id)))
        }
    }
    return $out
}

function Find-NntScanFolder($PatientNo) {
    foreach ($folder in Get-NntScanFolderCandidatePaths $PatientNo) {
        if (Test-PathSafe $folder) { return $folder }
    }
    return ""
}

function Get-NntScanContentType($Extension) {
    switch ($Extension.ToLowerInvariant()) {
        ".jpg"  { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".png"  { "image/png" }
        ".gif"  { "image/gif" }
        ".bmp"  { "image/bmp" }
        default { "application/octet-stream" }
    }
}

function Get-NntScanFiles($PatientNo) {
    $folder = Find-NntScanFolder $PatientNo
    $patId = Convert-NntPatientId $PatientNo
    if (-not $folder) {
        return @{
            ok = $true
            found = $false
            nnt_patid = "$patId"
            folder = ""
            files = @()
        }
    }
    $files = New-Object System.Collections.Generic.List[object]
    Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue | ForEach-Object {
        $ext = $_.Extension
        if ($script:NntScanImageExts -notcontains $ext.ToLowerInvariant()) { return }
        $files.Add([pscustomobject]@{
            name = $_.Name
            size = [int64]$_.Length
            taken = $_.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss")
            content_type = [string](Get-NntScanContentType $ext)
        })
    }
    return @{
        ok = $true
        found = $true
        nnt_patid = "$patId"
        folder = "$folder"
        files = @($files.ToArray())
    }
}

function Get-NntScanFileBytes($PatientNo, $Name) {
    $name = [string]$Name
    if ([string]::IsNullOrWhiteSpace($name) -or $name -match '[\\/]' -or $name.Contains("..")) {
        return $null
    }
    $folder = Find-NntScanFolder $PatientNo
    if (-not $folder) { return $null }
    $full = Join-Path $folder $name
    if (-not (Test-PathSafe $full)) { return $null }
    if (-not (Test-PathIsUnder $full $folder)) { return $null }
    $ext = [IO.Path]::GetExtension($full)
    if ($script:NntScanImageExts -notcontains $ext.ToLowerInvariant()) { return $null }
    try {
        return [ordered]@{
            bytes = [IO.File]::ReadAllBytes($full)
            content_type = Get-NntScanContentType $ext
            name = [IO.Path]::GetFileName($full)
        }
    } catch {
        return $null
    }
}

function Build-PatientContext($Query) {
    return [ordered]@{
        patient_id = $Query["patient_id"]
        patient_no = $Query["patient_no"]
        patient_name = $Query["patient_name"]
        chinese_name = $Query["chinese_name"]
        dob = $Query["dob"]
        sex = $Query["sex"]
        phone = $Query["phone"]
        mobile_phone = $Query["mobile_phone"]
        hkid = $Query["hkid"]
        email = $Query["email"]
        address = $Query["address"]
        medical_alerts = $Query["medical_alerts"]
        folder_path = $Query["folder_path"]
    }
}

function Patient-ContextText($Patient) {
    $lines = New-Object System.Collections.Generic.List[string]
    if ($Patient.patient_no) { $lines.Add("Patient No: $($Patient.patient_no)") }
    if ($Patient.patient_id) { $lines.Add("Patient ID: $($Patient.patient_id)") }
    if ($Patient.patient_name) { $lines.Add("Name: $($Patient.patient_name)") }
    if ($Patient.chinese_name) { $lines.Add("Chinese Name: $($Patient.chinese_name)") }
    if ($Patient.dob) { $lines.Add("DOB: $($Patient.dob)") }
    if ($Patient.sex) { $lines.Add("Sex: $($Patient.sex)") }
    if ($Patient.phone) { $lines.Add("Phone: $($Patient.phone)") }
    if ($Patient.mobile_phone) { $lines.Add("Mobile: $($Patient.mobile_phone)") }
    if ($Patient.hkid) { $lines.Add("HKID: $($Patient.hkid)") }
    if ($Patient.email) { $lines.Add("Email: $($Patient.email)") }
    if ($Patient.address) { $lines.Add("Address: $($Patient.address)") }
    if ($Patient.medical_alerts) { $lines.Add("Alerts: $($Patient.medical_alerts)") }
    if ($Patient.folder_path) { $lines.Add("X-Ray Folder: $($Patient.folder_path)") }
    return ($lines -join [Environment]::NewLine)
}

function Save-PatientContext($Patient) {
    $folder = $Patient.folder_path
    if ([string]::IsNullOrWhiteSpace($folder)) {
        return ""
    }
    try {
        if (-not (Test-Path -LiteralPath $folder)) {
            New-Item -ItemType Directory -Path $folder -Force | Out-Null
        }
        $jsonPath = Join-Path $folder "nnt-patient-info.json"
        $txtPath = Join-Path $folder "nnt-patient-info.txt"
        ($Patient | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $jsonPath -Encoding UTF8
        (Patient-ContextText $Patient) | Set-Content -LiteralPath $txtPath -Encoding UTF8
        return $jsonPath
    } catch {
        return ""
    }
}

function Copy-PatientContextToClipboard($Patient) {
    try {
        $text = Patient-ContextText $Patient
        if ($text) { Set-Clipboard -Value $text }
    } catch {}
}

# For nntnewtom: prefer NNTBridge.exe (CEFLA's PMS-integration tool) over a
# plain shortcut double-click, since it accepts patient demographics on the
# command line and both searches-by-ID and offers a pre-filled new-patient
# form when no match is found (single unified call — see tools/README.md).
function Start-NntBridgePatient($Resolved, $Patient) {
    $bridge = Resolve-NntBridge $Resolved
    # Only patient_no goes through prefix-stripping (it's Banana's clinic-formatted
    # chart number). The patient_id UUID fallback is left as-is: it will never
    # coincidentally match a real NNT record, which is the safe/intended behavior
    # when patient_no is missing entirely.
    $patId = if ($Patient.patient_no) { Convert-NntPatientId $Patient.patient_no } else { $Patient.patient_id }
    if (-not $bridge -or [string]::IsNullOrWhiteSpace($patId)) {
        return $null
    }

    $workDir = if ($Resolved.workingDirectory) { $Resolved.workingDirectory } else { Split-Path -Parent $bridge }
    $appPath = if ($Resolved.target -and (Test-PathSafe $Resolved.target)) { $Resolved.target } else { Join-Path $workDir "NNT.exe" }

    # /DIR fix, confirmed by tracing CS's own NNTBridge invocation live
    # (2026-08-19, chart 002505): CS passes /DIR pointing at the PATIENT'S
    # OWN chart folder (\\CSMAIN\IMAGE\Scan\{chart}), NOT the shared
    # SCAN root. NNT then looks for "<DIR>\Document\..." directly under
    # that -- which is exactly the per-chart SCAN folder layout, and why
    # an earlier attempt with /DIR = the shared SCAN root never worked
    # (wrong level, not a wrong mechanism). NNTBridge also still requires
    # no NNT.exe instance already running for /DIR to take effect.
    $docPath = Find-Nnt2dDocFile $patId
    $docId = if ($docPath) { [IO.Path]::GetFileNameWithoutExtension($docPath) } else { "" }
    $dirRoot = if ($docPath) { Find-NntScanFolder $patId } else { "" }

    if ($dirRoot) {
        Stop-NntProcessesForDir
    }

    $argList = New-Object System.Collections.Generic.List[string]
    if ($dirRoot) {
        $argList.Add("/DIR")
        $argList.Add((Quote-ProcessArg $dirRoot))
    }
    $argList.Add("/PATID")
    $argList.Add((Quote-ProcessArg $patId))
    if ($Patient.patient_name) {
        $argList.Add("/NAME")
        $argList.Add((Quote-ProcessArg $Patient.patient_name))
    }
    # Original NNTBridge_CmdLine evidence used /SURNAME for the Chinese name
    # (e.g. /SURNAME "熊關明"). NNTBridge.exe documents it as "PAT LASTNAME".
    if ($Patient.chinese_name) {
        $argList.Add("/SURNAME")
        $argList.Add((Quote-ProcessArg $Patient.chinese_name))
    }
    $dob = Convert-NntBirthDate $Patient.dob
    if ($dob) {
        $argList.Add("/DATEB")
        $argList.Add((Quote-ProcessArg $dob))
    }
    $sex = Convert-NntSex $Patient.sex
    if ($sex) {
        $argList.Add("/SEX")
        $argList.Add($sex)
    }
    if ($Patient.hkid) {
        $argList.Add("/SSNM")
        $argList.Add((Quote-ProcessArg $Patient.hkid))
    }
    if ($appPath -and (Test-PathSafe $appPath)) {
        $argList.Add("/APPPATH")
        $argList.Add((Quote-ProcessArg $appPath))
    }
    if ($workDir -and (Test-PathSafe $workDir)) {
        $argList.Add("/WORKDIR")
        $argList.Add((Quote-ProcessArg $workDir))
    }
    $argList.Add("/OPENPATIENT")

    $startArgs = @{ FilePath = $bridge; ArgumentList = ($argList -join " ") }
    if ($workDir -and (Test-PathSafe $workDir)) {
        $startArgs.WorkingDirectory = $workDir
    }
    Start-Process @startArgs
    return [ordered]@{
        bridge = $bridge
        target = $appPath
        workingDirectory = $workDir
        patient_id = $patId
        dir = $dirRoot
        docid = $docId
        docpath = $docPath
        chinese_name = $Patient.chinese_name
        mode = "nntbridge"
        argList = ($argList -join " ")
    }
}

function Resolve-RayBridge($Resolved) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($Resolved -and $Resolved.workingDirectory) {
        $candidates.Add((Join-Path $Resolved.workingDirectory "RAYBridge.exe"))
    }
    if ($Resolved -and $Resolved.target) {
        $targetDir = Split-Path -Parent $Resolved.target
        if ($targetDir) { $candidates.Add((Join-Path $targetDir "RAYBridge.exe")) }
    }
    $candidates.Add("C:\Ray\RAYBridge\RAYBridge.exe")
    return First-Existing $candidates
}

# RAYBridge's own usage example (found embedded in RAYBridge.exe's string
# table, confirmed against this clinic's C:\Ray\RAYBridge\SYS\LocalConfig.xml
# which has <Integration><SelectedFileFormat value="Command" />, i.e. this
# exact CLI form is the one actually in effect here -- not the alternative
# -VDDS/-CSV file-based settings the same binary also supports):
#   RayBridge.exe "ID:PID2020-00001" "LastName:Smith" "FirstName:Tom" "MiddleName:middle" "BirthDay:1993-07-28" "Sex:M"
# Wants ISO yyyy-MM-dd (Banana's <input type=date> already gives exactly
# that), unlike NNT's dd/MM/yyyy above.
function Convert-RayBirthDate($Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    $formats = @("yyyy-MM-dd", "yyyy/M/d", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy")
    foreach ($fmt in $formats) {
        try {
            $dt = [DateTime]::ParseExact($Value, $fmt, [Globalization.CultureInfo]::InvariantCulture)
            return $dt.ToString("yyyy-MM-dd")
        } catch {}
    }
    try {
        $dt = [DateTime]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture)
        return $dt.ToString("yyyy-MM-dd")
    } catch {
        return $Value
    }
}

# Banana stores one free-text "full_name" field. Confirmed against a real
# scanned record on this PC (C:\Ray\RayView\Temp\Integration\Save\
# KT005455_19660915\...\PatientInfo.ini, "Patient Name = TANG^PUI^SHEUNG"):
# this clinic's English names are surname-first (HK/Cantonese romanization
# convention), matching RAYBridge's LastName/FirstName/MiddleName order --
# so the FIRST token is taken as the surname, not the last one.
function Split-RayPatientName($FullName) {
    $s = [string]$FullName
    $tokens = @($s.Trim() -split '\s+' | Where-Object { $_ })
    $result = [ordered]@{ last = ""; first = ""; middle = "" }
    if ($tokens.Count -ge 1) { $result.last = $tokens[0] }
    if ($tokens.Count -ge 2) { $result.first = $tokens[1] }
    if ($tokens.Count -ge 3) { $result.middle = ($tokens[2..($tokens.Count - 1)] -join " ") }
    return $result
}

# CORRECTED 2026-08-20 (real bug report from a live clinic PC): the
# original assumption below -- keep patient_no AS-IS, prefix included --
# was based on a single freshly-created PatientInfo.ini sample. A brand-new
# patient has no pre-existing Rayscan record to fail to match against, so
# that sample never actually exercised this path. In practice, OLD/existing
# OPG records already sitting in Rayscan's own database were entered before
# Banana's multi-branch "patient_no_prefix" existed (e.g. this clinic's "MK"
# / Mongkok prefix), so they're keyed on the bare chart number. Sending the
# full "MK..." string as RAYBridge's ID: therefore fails to match those old
# records -- RAYBridge/SMARTDent falls back to an unmatched/new-patient
# state instead of surfacing the existing OPG history. Same root cause as
# NNT's own /PATID prefix stripping above, so it reuses the exact same
# fix: Convert-NntPatientId's generic "extract the first run of digits"
# already strips ANY clinic letter prefix (not just literally "MK"),
# regardless of which branch/clinic this is deployed at.
function Convert-RayPatientId($Value) {
    return Convert-NntPatientId $Value
}

# Banana's X-ray bridge itself runs as a minimized PowerShell window
# (install-xray-bridge.ps1 starts it with -WindowStyle Minimized so staff
# never see a console). Windows then treats any GUI that process launches
# as "not allowed to steal foreground": RAYBridge.exe starts SMARTDent
# minimized, and the taskbar button just flashes (orange/red) until a
# human clicks it. Confirmed live 2026-08-20 on a consultation-room PC.
# Fix: after launching RAYBridge, fire a tiny hidden helper that waits for
# SMARTDent's real window, restores it from minimized, and force-focuses
# it (AttachThreadInput + a dummy Alt keypress -- the standard way around
# Windows' SetForegroundWindow lock for background processes). Non-blocking
# so Banana's HTTP /open/rayscan call is not delayed.
function Start-RestoreRayViewerWindow {
    $helper = @'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RayWin {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
}
"@
$SW_RESTORE = 9
$SW_SHOW = 5
$deadline = (Get-Date).AddSeconds(15)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
    foreach ($n in @("SMARTDent", "RayView", "RAYBridge")) {
        $p = Get-Process -Name $n -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Select-Object -First 1
        if ($p) { $hwnd = $p.MainWindowHandle; break }
    }
    if ($hwnd -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 300
}
if ($hwnd -eq [IntPtr]::Zero) { exit 0 }
if ([RayWin]::IsIconic($hwnd)) {
    [RayWin]::ShowWindow($hwnd, $SW_RESTORE) | Out-Null
} else {
    [RayWin]::ShowWindow($hwnd, $SW_SHOW) | Out-Null
}
[RayWin]::ShowWindow($hwnd, $SW_RESTORE) | Out-Null
$fg = [RayWin]::GetForegroundWindow()
$dummy = [uint32]0
$fgTid = [RayWin]::GetWindowThreadProcessId($fg, [ref]$dummy)
$curTid = [RayWin]::GetCurrentThreadId()
$dummy2 = [uint32]0
$winTid = [RayWin]::GetWindowThreadProcessId($hwnd, [ref]$dummy2)
if ($fgTid -ne $curTid) { [RayWin]::AttachThreadInput($curTid, $fgTid, $true) | Out-Null }
if ($winTid -ne $curTid -and $winTid -ne $fgTid) { [RayWin]::AttachThreadInput($curTid, $winTid, $true) | Out-Null }
[RayWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[RayWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[RayWin]::BringWindowToTop($hwnd) | Out-Null
[RayWin]::SetForegroundWindow($hwnd) | Out-Null
if ($fgTid -ne $curTid) { [RayWin]::AttachThreadInput($curTid, $fgTid, $false) | Out-Null }
if ($winTid -ne $curTid -and $winTid -ne $fgTid) { [RayWin]::AttachThreadInput($curTid, $winTid, $false) | Out-Null }
'@
    try {
        $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))
        Start-Process -FilePath "powershell" -WindowStyle Hidden -ArgumentList @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $enc
        ) | Out-Null
    } catch {}
}

# CS Trophy F7 -> TW.exe (Carestream CSImaging). Traced live 2026-08-27 Dr-1-MCP.
function Build-TrophyTwUiLabel($Patient) {
    $en = [string]$Patient.patient_name
    $zh = [string]$Patient.chinese_name
    $en = $en.Trim()
    $zh = $zh.Trim()
    if ($en -and $zh) { return ($en + "  " + $zh) }
    if ($en) { return $en }
    if ($zh) { return $zh }
    return ""
}

function Get-TrophyScanFolderPath($PatientNo) {
    if ([string]::IsNullOrWhiteSpace($PatientNo)) { return "" }
    $found = Find-NntScanFolder $PatientNo
    if ($found) { return $found }
    $ids = Get-NntScanIdCandidates $PatientNo
    if ($ids.Count -eq 0) { return "" }
    foreach ($root in Get-NntScanRoots) {
        foreach ($id in $ids) {
            return (Join-Path $root $id)
        }
    }
    return ""
}

function Start-TrophyTwPatient($Resolved, $Patient) {
    $tw = if ($Resolved -and (Test-PathSafe $Resolved.target)) { $Resolved.target } else { "" }
    if (-not $tw) { $tw = First-Existing $Systems.trophy.executables }
    $patNo = [string]$Patient.patient_no
    $scanPath = Get-TrophyScanFolderPath $patNo
    if (-not $tw -or [string]::IsNullOrWhiteSpace($scanPath)) {
        return $null
    }
    $uiLabel = Build-TrophyTwUiLabel $Patient
    if ([string]::IsNullOrWhiteSpace($uiLabel)) { return $null }

    $workDir = if ($Resolved.workingDirectory) { $Resolved.workingDirectory } else { Split-Path -Parent $tw }
    $argList = New-Object System.Collections.Generic.List[string]
    # CS passes -P attached directly to the UNC path (no space after -P).
    $argList.Add("-P" + $scanPath)
    $argList.Add("-NLUI")
    $argList.Add((Quote-ProcessArg $uiLabel))
    $argList.Add("-FLUI")
    $argList.Add((Quote-ProcessArg $uiLabel))

    $startArgs = @{ FilePath = $tw; ArgumentList = ($argList -join " "); WindowStyle = "Normal" }
    if ($workDir -and (Test-PathSafe $workDir)) {
        $startArgs.WorkingDirectory = $workDir
    }
    Start-Process @startArgs
    return [ordered]@{
        bridge = $tw
        target = $tw
        workingDirectory = $workDir
        patient_id = Convert-NntPatientId $patNo
        scan_path = $scanPath
        ui_label = $uiLabel
        mode = "trophy_tw"
        argList = ($argList -join " ")
    }
}

function Start-RayBridgePatient($Resolved, $Patient) {
    $bridge = Resolve-RayBridge $Resolved
    $patId = if ($Patient.patient_no) { Convert-RayPatientId $Patient.patient_no } else { $Patient.patient_id }
    if (-not $bridge -or [string]::IsNullOrWhiteSpace($patId)) {
        return $null
    }

    $workDir = if ($Resolved.workingDirectory) { $Resolved.workingDirectory } else { Split-Path -Parent $bridge }
    $name = Split-RayPatientName $Patient.patient_name
    $dob = Convert-RayBirthDate $Patient.dob
    $sex = Convert-NntSex $Patient.sex

    $argList = New-Object System.Collections.Generic.List[string]
    $argList.Add((Quote-ProcessArg ("ID:" + $patId)))
    if ($name.last) { $argList.Add((Quote-ProcessArg ("LastName:" + $name.last))) }
    if ($name.first) { $argList.Add((Quote-ProcessArg ("FirstName:" + $name.first))) }
    if ($name.middle) { $argList.Add((Quote-ProcessArg ("MiddleName:" + $name.middle))) }
    if ($dob) { $argList.Add((Quote-ProcessArg ("BirthDay:" + $dob))) }
    if ($sex) { $argList.Add((Quote-ProcessArg ("Sex:" + $sex))) }

    $startArgs = @{ FilePath = $bridge; ArgumentList = ($argList -join " "); WindowStyle = "Normal" }
    if ($workDir -and (Test-PathSafe $workDir)) {
        $startArgs.WorkingDirectory = $workDir
    }
    Start-Process @startArgs
    Start-RestoreRayViewerWindow
    return [ordered]@{
        bridge = $bridge
        target = $bridge
        workingDirectory = $workDir
        patient_id = $patId
        mode = "raybridge"
        argList = ($argList -join " ")
    }
}

# EzDent-i (Vatech) has no documented command-line patient API -- unlike
# NNTBridge.exe above, there is no /PATID-style switch. The generic,
# publicly documented PMS bridge (Open Dental, Carestack, MOGO, GoodDrs)
# writes a "linkage.xml" file into EzDent-i's own program folder immediately
# before launching it, and EzDent-i is documented to read that file on
# startup: opening the matching chart if the Chart Number exists, or
# creating a new profile from the same fields if it doesn't.
#
# LIVE INVESTIGATION, 2026-08-19 (real clinic PC, EzDent-i 3.0.10.0, client
# of a centralized EzWebServer at 192.168.50.100 -- see CHANGELOG.md for the
# full trace): this generic mechanism could NOT be confirmed working on
# this deployment, and CS itself is not using it either:
#   - CS's own "EzDent-i" button launches VTE232.exe with a completely
#     empty command line -- no patient context passed at all today. This
#     is NOT a regression from any recent PC relocation: the exact same
#     "CExternalLink::LoadLinkageSetting - External Link Info: Invalid
#     value" warning fires on every single logged launch going back to the
#     earliest available log entry (July 2024), so this specific install
#     has most likely never had a working file-based bridge.
#   - VTEzBridge32.exe -- named like the obvious bridge entry point, and
#     confirmed (via binary string extraction) to reference "Linkage.xml",
#     "strChartNo", "strFirstName", "strLastName", "dtBirthdate",
#     "strGender" (exactly the E2_PAT database columns) -- was launched
#     live with a real linkage.xml sibling file present, and exits in well
#     under 500ms with no window, no VTDebug.txt entry, and the file left
#     untouched. It does not spawn the visible app itself.
#   - Binary strings show "Linkage.xml" is actually one label in an enum
#     of recognized patient *import source types* (alongside "EzPicker",
#     "EzBridge", "ESSyncro", "Migration", "EzMobile", ...) baked into the
#     E2_PAT/E2_IMG schema -- not necessarily a file this client-side exe
#     watches by itself. VTServerConfig.ini's "[ezpicker] ip_address =
#     192.168.50.100" points at the same central DB server seen in
#     VTDebug.txt, suggesting the real consumer (if any) of this import
#     path is a server-side "EzPicker" service, not this client PC.
#
# Given that, Start-EzdentiBridgePatient below does NOT depend on this
# working. It always does the two things confirmed to work today (open the
# real app so staff see a window; copy patient info to clipboard so they
# can paste it into EzDent-i's own patient search -- same fallback already
# used for Carestream/Ai-Dental), and ALSO best-effort writes this XML +
# fires VTEzBridge32.exe first, in case EzPicker or some other
# build/config really does pick it up -- pure upside if so, silently
# ignored if not. Confirming that one way or the other needs either
# Vatech support/docs for a centralized EzWebServer deployment, or access
# to the server (192.168.50.100) itself -- out of scope for a client PC
# script.
#
# CORRECTED 2026-08-24 (Po Lam / "PL" clinic): Banana's patient_no carries
# a clinic letter prefix (Program Settings -> patient_no_prefix, here
# "PL"), but OLD EzDent-i charts were entered before that prefix existed
# and are keyed on the bare digits. Sending ChartNumber="PL001287" (or
# pasting "PL001287" into EzDent-i's own search) never matches those
# existing records, so EzDent-i falls back to a new/unmatched patient
# instead of the old OPG/CT. Same root cause as NNT /PATID and Rayscan
# ID: -- reuse Convert-NntPatientId so ANY clinic letter prefix is
# stripped, not just the literal "PL" this report named.
function Convert-EzdentiPatientId($Value) {
    return Convert-NntPatientId $Value
}

function New-EzdentiLinkageXml($Patient) {
    $chartNo = if ($Patient.patient_no) { Convert-EzdentiPatientId $Patient.patient_no } else { $Patient.patient_id }
    # Chinese-name clinics: mirrors the NNT /NAME (English) + /SURNAME
    # (Chinese) split above. EzDent-i's LastName/FirstName attributes are a
    # Western given/family-name pair, so this is a best-effort mapping, not
    # a confirmed one -- see the caveat above.
    $firstName = [string]$Patient.patient_name
    $lastName  = if ($Patient.chinese_name) { [string]$Patient.chinese_name } else { "" }
    $birthday  = Convert-NntBirthDate $Patient.dob
    $gender    = Convert-GenderWord $Patient.sex

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('<?xml version="1.0" encoding="utf-8"?>' + [Environment]::NewLine)
    [void]$sb.Append('<LinkageParameter>' + [Environment]::NewLine)
    [void]$sb.Append('  <Patient LastName="' + (Escape-Xml $lastName) + '" FirstName="' + (Escape-Xml $firstName) + '" ChartNumber="' + (Escape-Xml $chartNo) + '">' + [Environment]::NewLine)
    if ($birthday) { [void]$sb.Append('    <Birthday>' + (Escape-Xml $birthday) + '</Birthday>' + [Environment]::NewLine) }
    if ($Patient.address) { [void]$sb.Append('    <Address>' + (Escape-Xml $Patient.address) + '</Address>' + [Environment]::NewLine) }
    if ($Patient.phone) { [void]$sb.Append('    <Phone>' + (Escape-Xml $Patient.phone) + '</Phone>' + [Environment]::NewLine) }
    if ($Patient.mobile_phone) { [void]$sb.Append('    <Mobile>' + (Escape-Xml $Patient.mobile_phone) + '</Mobile>' + [Environment]::NewLine) }
    if ($Patient.hkid) { [void]$sb.Append('    <SocialID>' + (Escape-Xml $Patient.hkid) + '</SocialID>' + [Environment]::NewLine) }
    if ($gender) { [void]$sb.Append('    <Gender>' + $gender + '</Gender>' + [Environment]::NewLine) }
    [void]$sb.Append('  </Patient>' + [Environment]::NewLine)
    [void]$sb.Append('</LinkageParameter>' + [Environment]::NewLine)
    return $sb.ToString()
}

# VTEzBridge32.exe lives next to the loader/app exe. Resolved separately
# from $Systems.ezdenti.executables (the "what to open" list) because it is
# NOT something this script should ever treat as "the app" -- see the
# comment above New-EzdentiLinkageXml for why (no window, exits instantly).
function Resolve-EzdentiBridge($Resolved) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($Resolved -and $Resolved.workingDirectory) {
        $candidates.Add((Join-Path $Resolved.workingDirectory "VTEzBridge32.exe"))
    }
    if ($Resolved -and $Resolved.target) {
        $targetDir = Split-Path -Parent $Resolved.target
        if ($targetDir) { $candidates.Add((Join-Path $targetDir "VTEzBridge32.exe")) }
    }
    $candidates.Add("C:\Program Files (x86)\VATECH\EzDent-i\Bin\VTEzBridge32.exe")
    $candidates.Add("C:\Program Files\VATECH\EzDent-i\Bin\VTEzBridge32.exe")
    return First-Existing $candidates
}

function Start-EzdentiBridgePatient($Resolved, $Patient) {
    if (-not $Resolved -or -not $Resolved.target -or -not (Test-PathSafe $Resolved.target)) {
        return $null
    }
    $chartNo = if ($Patient.patient_no) { Convert-EzdentiPatientId $Patient.patient_no } else { $Patient.patient_id }
    $workDir = if ($Resolved.workingDirectory -and (Test-PathSafe $Resolved.workingDirectory)) { $Resolved.workingDirectory } else { Split-Path -Parent $Resolved.target }

    # Best-effort only -- see the caveat above New-EzdentiLinkageXml. Never
    # blocks or fails the rest of this function if it doesn't pan out.
    $xmlPath = ""
    if (-not [string]::IsNullOrWhiteSpace($chartNo) -and $workDir -and (Test-PathSafe $workDir)) {
        try {
            $candidatePath = Join-Path $workDir "Linkage.xml"
            [IO.File]::WriteAllText($candidatePath, (New-EzdentiLinkageXml $Patient), [Text.Encoding]::UTF8)
            $xmlPath = $candidatePath
        } catch {}
    }

    $bridgeExe = Resolve-EzdentiBridge $Resolved
    if ($bridgeExe) {
        try {
            Start-Process -FilePath $bridgeExe -WorkingDirectory (Split-Path -Parent $bridgeExe)
            # Observed live to exit in well under 500ms -- give it a beat to
            # do whatever it does (e.g. touch the DB) before the app below
            # potentially reads the same state.
            Start-Sleep -Milliseconds 400
        } catch {}
    }

    # Always open the real app -- confirmed live to work (VTE2Loader32.exe
    # spawns the visible VTE232.exe window), and the caller
    # (Copy-PatientContextToClipboard in Handle-Request) already copies the
    # patient's name/no. to the clipboard as the reliable fallback for
    # manual search inside EzDent-i, same pattern as Carestream/Ai-Dental.
    try {
        $appArgs = @{ FilePath = $Resolved.target }
        if ($workDir -and (Test-PathSafe $workDir)) { $appArgs.WorkingDirectory = $workDir }
        Start-Process @appArgs
    } catch {
        return $null
    }

    # Overwrite the generic Handle-Request clipboard copy: that still has
    # Banana's prefixed patient_no (e.g. "PL001287"). EzDent-i's own search
    # and Linkage.xml ChartNumber must use the bare digits so OLD charts
    # match. Staff paste this into EzDent-i search.
    $clipPatient = [ordered]@{}
    foreach ($k in $Patient.Keys) { $clipPatient[$k] = $Patient[$k] }
    $clipPatient.patient_no = $chartNo
    Copy-PatientContextToClipboard $clipPatient

    return [ordered]@{
        target = $Resolved.target
        workingDirectory = $workDir
        bridge_exe = $bridgeExe
        linkage_xml = $xmlPath
        chart_number = $chartNo
        mode = "ezdenti-open-plus-besteffort-linkage"
    }
}

# Fires off _nnt_identity_guard.ps1 in the background (non-blocking --
# Handle-Request returns to the browser immediately either way). See that
# script's header comment for why this exists: NNT's own internal patient
# database is not reliably in sync with Supabase/CS, so /PATID can silently
# open a completely different, unrelated patient for a large fraction of
# older chart numbers. The guard script pops a warning dialog on this PC
# if what NNT actually displays doesn't match who Banana asked for.
function Start-NntIdentityGuard($Patient) {
    $guardScript = Join-Path $PSScriptRoot "_nnt_identity_guard.ps1"
    if (-not (Test-PathSafe $guardScript)) { return }
    $argList = New-Object System.Collections.Generic.List[string]
    $argList.Add("-NoProfile")
    $argList.Add("-ExecutionPolicy")
    $argList.Add("Bypass")
    $argList.Add("-File")
    $argList.Add((Quote-ProcessArg $guardScript))
    $argList.Add("-ExpectedName")
    $argList.Add((Quote-ProcessArg $Patient.patient_name))
    if ($Patient.chinese_name) {
        $argList.Add("-ExpectedChineseName")
        $argList.Add((Quote-ProcessArg $Patient.chinese_name))
    }
    if ($Patient.patient_no) {
        $argList.Add("-ChartNo")
        $argList.Add((Quote-ProcessArg $Patient.patient_no))
    }
    try {
        Start-Process powershell -ArgumentList ($argList -join " ") -WindowStyle Hidden
    } catch {}
}

# Fires off _nnt_new_opg_watcher.ps1 in the background (non-blocking) right
# alongside the identity guard. Watches this patient's SCAN folder(s) for a
# freshly written file during this session (i.e. a NEW panoramic actually
# captured in NNT just now, not one CS already had) and -- every single
# time, by design, no "don't ask again" -- pops a Yes/No prompt asking
# staff whether to screen-cap the NNT viewer and upload the result into
# Banana's Supabase `xrays` bucket/table. See that script's header comment
# for the full flow.
#
# Applies to every patient, new or old: the bridge-documented folder (if a
# 2D study already exists) is watched first, but EVERY root x id-candidate
# path from Get-NntScanFolderCandidatePaths is passed too, whether or not
# it exists yet on disk -- so a brand-new patient with no scan folder at
# all is still covered the moment NNT/CS create one. Duplicates across
# both sources are removed; the watcher itself tolerates non-existent
# folders (just keeps polling until one appears).
function Start-NntNewOpgWatcher($Patient, $BridgeLaunch) {
    $watcherScript = Join-Path $PSScriptRoot "_nnt_new_opg_watcher.ps1"
    if (-not (Test-PathSafe $watcherScript)) { return }
    if (-not $Patient.patient_id -or -not $Patient.patient_no) { return }

    $patId = Convert-NntPatientId $Patient.patient_no
    $folders = New-Object System.Collections.Generic.List[string]
    if ($BridgeLaunch -and $BridgeLaunch.dir) { $folders.Add($BridgeLaunch.dir) }
    foreach ($candidate in (Get-NntScanFolderCandidatePaths $patId)) {
        if ($folders -notcontains $candidate) { $folders.Add($candidate) }
    }
    if ($folders.Count -eq 0) { return }

    $argList = New-Object System.Collections.Generic.List[string]
    $argList.Add("-NoProfile")
    $argList.Add("-ExecutionPolicy")
    $argList.Add("Bypass")
    $argList.Add("-File")
    $argList.Add((Quote-ProcessArg $watcherScript))
    $argList.Add("-PatientId")
    $argList.Add((Quote-ProcessArg $Patient.patient_id))
    $argList.Add("-PatientNo")
    $argList.Add((Quote-ProcessArg $Patient.patient_no))
    if ($Patient.patient_name) {
        $argList.Add("-PatientName")
        $argList.Add((Quote-ProcessArg $Patient.patient_name))
    }
    $argList.Add("-ChartFolders")
    $argList.Add((Quote-ProcessArg ($folders -join ";")))
    try {
        Start-Process powershell -ArgumentList ($argList -join " ") -WindowStyle Hidden
    } catch {}
}

function Handle-Request($RawPath) {
    $pathOnly = ($RawPath -split "\?", 2)[0]
    if ($pathOnly -eq "/status") {
        return @{ status = 200; body = (Status-Payload) }
    }
    if ($pathOnly -eq "/nnt/scans") {
        $query = Parse-Query $RawPath
        $patientNo = $query["patient_no"]
        if ([string]::IsNullOrWhiteSpace($patientNo)) {
            return @{ status = 400; body = [ordered]@{ ok = $false; error = "patient_no is required." } }
        }
        return @{ status = 200; body = (Get-NntScanFiles $patientNo) }
    }
    if ($pathOnly -eq "/nnt/file") {
        $query = Parse-Query $RawPath
        $patientNo = $query["patient_no"]
        $name = $query["name"]
        if ([string]::IsNullOrWhiteSpace($patientNo) -or [string]::IsNullOrWhiteSpace($name)) {
            return @{ status = 400; body = [ordered]@{ ok = $false; error = "patient_no and name are required." } }
        }
        $file = Get-NntScanFileBytes $patientNo $name
        if (-not $file) {
            return @{ status = 404; body = [ordered]@{ ok = $false; error = "Scan image not found." } }
        }
        return @{ status = 200; contentType = $file.content_type; bytes = $file.bytes }
    }
    if ($pathOnly -match "^/open/([^/]+)$") {
        $key = (UrlDecode $Matches[1]).ToLowerInvariant()
        $query = Parse-Query $RawPath
        $resolved = Resolve-System $key $query["app_path"]
        if (-not $resolved -or -not $resolved.exists) {
            return @{ status = 404; body = [ordered]@{ ok = $false; error = "X-ray program shortcut/executable not found."; key = $key } }
        }
        $patientContext = Build-PatientContext $query
        $patientInfoPath = Save-PatientContext $patientContext
        Copy-PatientContextToClipboard $patientContext
        $bridgeLaunch = $null
        if ($key -eq "nntnewtom") {
            $bridgeLaunch = Start-NntBridgePatient $resolved $patientContext
        } elseif ($key -eq "ezdenti") {
            $bridgeLaunch = Start-EzdentiBridgePatient $resolved $patientContext
        } elseif ($key -eq "rayscan") {
            $bridgeLaunch = Start-RayBridgePatient $resolved $patientContext
        } elseif ($key -eq "trophy") {
            $bridgeLaunch = Start-TrophyTwPatient $resolved $patientContext
        }
        if (-not $bridgeLaunch) {
            Start-ResolvedProgram $resolved
        }
        if ($bridgeLaunch -and $key -eq "nntnewtom" -and $patientContext.patient_name) {
            Start-NntIdentityGuard $patientContext
        }
        if ($bridgeLaunch -and $key -eq "nntnewtom" -and $patientContext.patient_id -and $patientContext.patient_no) {
            Start-NntNewOpgWatcher $patientContext $bridgeLaunch
        }
        return @{
            status = 200
            body = [ordered]@{
                ok = $true
                key = $key
                target = if ($bridgeLaunch) { $bridgeLaunch.target } else { $resolved.target }
                type = $resolved.type
                workingDirectory = $resolved.workingDirectory
                bridge = $bridgeLaunch
                patient_info_path = $patientInfoPath
                patient_no = $query["patient_no"]
                nnt_patid = if ($bridgeLaunch) { $bridgeLaunch.patient_id } else { Convert-NntPatientId $query["patient_no"] }
                patient_name = $query["patient_name"]
            }
        }
    }
    return @{ status = 404; body = [ordered]@{ ok = $false; error = "Not found" } }
}

# ════════════════════════════════════════════════════════════════
# SELF-TEST — exercises the functions above with no listener, no real
# NNT/Carestream/Ai-Dental process, and no writes outside $env:TEMP.
# ════════════════════════════════════════════════════════════════
function Invoke-SelfTest {
    # Script-scoped (not local) so Assert-Equal's $script: writes land in the
    # same variables this function reads at the end — a plain local $passed
    # here would silently desync from $script:passed and could even mask
    # real failures in the final verdict.
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

    Write-Host "== Convert-NntBirthDate (Banana sends yyyy-MM-dd from <input type=date>) ==" -ForegroundColor Cyan
    Assert-Equal "ISO date"            "23/05/1969" (Convert-NntBirthDate "1969-05-23")
    Assert-Equal "ISO date, single digits" "05/01/2001" (Convert-NntBirthDate "2001-01-05")
    Assert-Equal "Empty stays empty"   ""            (Convert-NntBirthDate "")
    Assert-Equal "Null stays empty"    ""            (Convert-NntBirthDate $null)
    Assert-Equal "Slash legacy format" "09/06/1958"  (Convert-NntBirthDate "1958/6/9")

    Write-Host "== Convert-NntSex (Banana <select id=sex> only ever sends M / F / '') ==" -ForegroundColor Cyan
    Assert-Equal "Male"          "M" (Convert-NntSex "M")
    Assert-Equal "Female"        "F" (Convert-NntSex "F")
    Assert-Equal "lowercase m"   "M" (Convert-NntSex "m")
    Assert-Equal "word Male"     "M" (Convert-NntSex "Male")
    Assert-Equal "Empty"         ""  (Convert-NntSex "")
    Assert-Equal "Garbage value" ""  (Convert-NntSex "unknown")

    Write-Host "== Convert-RayBirthDate (Rayscan/RAYBridge wants ISO yyyy-MM-dd) ==" -ForegroundColor Cyan
    Assert-Equal "ISO date passes through"  "1969-05-23" (Convert-RayBirthDate "1969-05-23")
    Assert-Equal "ISO date, single digits"  "2001-01-05" (Convert-RayBirthDate "2001-01-05")
    Assert-Equal "Empty stays empty"        ""           (Convert-RayBirthDate "")
    Assert-Equal "Null stays empty"         ""           (Convert-RayBirthDate $null)
    Assert-Equal "Slash legacy format"      "1958-06-09" (Convert-RayBirthDate "1958/6/9")

    Write-Host "== Split-RayPatientName (HK surname-first English names, evidence: real PatientInfo.ini) ==" -ForegroundColor Cyan
    $n1 = Split-RayPatientName "TANG PUI SHEUNG"
    Assert-Equal "3 tokens: last"   "TANG"        $n1.last
    Assert-Equal "3 tokens: first"  "PUI"         $n1.first
    Assert-Equal "3 tokens: middle" "SHEUNG"      $n1.middle
    $n2 = Split-RayPatientName "HSIUNG KWAN MING EXTRA"
    Assert-Equal "4 tokens: middle joins the rest" "MING EXTRA" $n2.middle
    $n3 = Split-RayPatientName "SMITH"
    Assert-Equal "1 token: last only" "SMITH" $n3.last
    Assert-Equal "1 token: first empty" "" $n3.first
    $n4 = Split-RayPatientName ""
    Assert-Equal "Empty name: last empty" "" $n4.last
    $n5 = Split-RayPatientName "  TANG   PUI  "
    Assert-Equal "Extra whitespace collapses" "TANG" $n5.last
    Assert-Equal "Extra whitespace collapses (first)" "PUI" $n5.first

    Write-Host "== Convert-RayPatientId (strip Banana's clinic prefix, e.g. 'MK', so RAYBridge's ID: matches OLD Rayscan records) ==" -ForegroundColor Cyan
    Assert-Equal "Real bug report: MK-prefixed chart number" "005455" (Convert-RayPatientId "MK005455")
    Assert-Equal "Lowercase prefix"                            "005455" (Convert-RayPatientId "mk005455")
    Assert-Equal "No prefix, digits only"                      "005455" (Convert-RayPatientId "005455")
    Assert-Equal "Different clinic's letter prefix"            "013524" (Convert-RayPatientId "ABC013524")
    Assert-Equal "Empty stays empty"                           ""       (Convert-RayPatientId "")
    Assert-Equal "Null stays empty"                            ""       (Convert-RayPatientId $null)

    Write-Host "== Start-RestoreRayViewerWindow (helper exists; does not wait on SMARTDent) ==" -ForegroundColor Cyan
    Assert-Equal "helper is a function" $true ($null -ne (Get-Command Start-RestoreRayViewerWindow -ErrorAction SilentlyContinue))

    Write-Host "== Start-RayBridgePatient (no real launch -- negative paths only) ==" -ForegroundColor Cyan
    $rayPatient = [ordered]@{ patient_no = "KT005455"; patient_name = "TANG PUI SHEUNG"; dob = "1966-09-15"; sex = "F" }
    # Deliberately NOT testing "RAYBridge.exe missing -> returns null" here:
    # Resolve-RayBridge's hardcoded C:\Ray\RAYBridge\RAYBridge.exe fallback
    # genuinely exists on a real Rayscan PC (confirmed live, 2026-08-20), so
    # that path can't be forced to "not found" without actually depending on
    # what's installed on whatever PC runs -SelfTest -- same reasoning as
    # Resolve-EzdentiBridge's own real hardcoded fallback path below. The
    # only deterministic negative, regardless of what's on disk, is a
    # missing patient_no/patient_id (checked before Start-Process is ever
    # reached). Genuine coverage of the real launch is opt-in only via
    # -IncludeLiveLaunch (see Handle-Request checks near the bottom).
    $noPatId = Start-RayBridgePatient ([ordered]@{ workingDirectory = $env:TEMP; target = "" }) ([ordered]@{ patient_name = "NO ID" })
    Assert-Equal "No patient_no/id -> returns null" $true ($null -eq $noPatId)
    $noResolvedRay = Start-RayBridgePatient $null $rayPatient
    Assert-Equal "Null resolved -> still safe (no throw)" $true ($true)

    Write-Host "== Convert-GenderWord (EzDent-i linkage.xml wants Male/Female words) ==" -ForegroundColor Cyan
    Assert-Equal "Male"          "Male"   (Convert-GenderWord "M")
    Assert-Equal "Female"        "Female" (Convert-GenderWord "F")
    Assert-Equal "lowercase f"   "Female" (Convert-GenderWord "f")
    Assert-Equal "word Female"   "Female" (Convert-GenderWord "Female")
    Assert-Equal "Empty"         ""       (Convert-GenderWord "")
    Assert-Equal "Garbage value" ""       (Convert-GenderWord "unknown")

    Write-Host "== Escape-Xml ==" -ForegroundColor Cyan
    Assert-Equal "Ampersand" "Tom &amp; Jerry"          (Escape-Xml "Tom & Jerry")
    Assert-Equal "Quote"     "He said &quot;hi&quot;"   (Escape-Xml 'He said "hi"')
    Assert-Equal "Empty stays empty" "" (Escape-Xml "")
    Assert-Equal "Null stays empty"  "" (Escape-Xml $null)

    Write-Host "== Convert-NntPatientId (strip clinic-configured patient_no_prefix for /PATID) ==" -ForegroundColor Cyan
    Assert-Equal "Real case: PY-prefixed chart number" "002505" (Convert-NntPatientId "PY002505")
    Assert-Equal "No prefix, digits only"              "002505" (Convert-NntPatientId "002505")
    Assert-Equal "Multi-letter prefix"                 "013524" (Convert-NntPatientId "ABC013524")
    Assert-Equal "Empty stays empty"                   ""       (Convert-NntPatientId "")
    Assert-Equal "Null stays empty"                    ""       (Convert-NntPatientId $null)
    Assert-Equal "No digits at all falls back to raw"  "NOPE"   (Convert-NntPatientId "NOPE")

    Write-Host "== Get-NntScanIdCandidates (prefix strip + 6-digit pad) ==" -ForegroundColor Cyan
    $c1 = Get-NntScanIdCandidates "PY002505"
    Assert-Equal "PY002505 yields one id" "002505" ($c1 -join ",")
    $c2 = Get-NntScanIdCandidates "PY2505"
    Assert-Equal "Short digits also try 6-pad" "2505,002505" ($c2 -join ",")
    $c3 = Get-NntScanIdCandidates ""
    Assert-Equal "Empty patient_no yields no candidates" "0" ([string]$c3.Count)

    Write-Host "== NNT SCAN folder list + file serve (temp tree only) ==" -ForegroundColor Cyan
    $scanRoot = Join-Path $env:TEMP ("xray-nnt-scan-" + [Guid]::NewGuid().ToString("N"))
    $scanFolder = Join-Path $scanRoot "002505"
    $prevRoots = $script:NntScanRootsOverride
    try {
        New-Item -ItemType Directory -Path $scanFolder -Force | Out-Null
        $jpgPath = Join-Path $scanFolder "002505_20260505112331.JPG"
        [IO.File]::WriteAllBytes($jpgPath, [byte[]](0xFF, 0xD8, 0xFF, 0xD9))
        $twoD = Join-Path $scanFolder "Document\Pa\Pb\Pc\Pd\Pe\2D Images collection"
        New-Item -ItemType Directory -Path $twoD -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $twoD "20.1231213163838006.1208.2dh") -Value "nnt" -Encoding ASCII
        $script:NntScanRootsOverride = @($scanRoot)
        $listed = Get-NntScanFiles "PY002505"
        Assert-Equal "SCAN folder found for PY-prefixed no" $true $listed.found
        Assert-Equal "SCAN nnt_patid is bare digits" "002505" $listed.nnt_patid
        Assert-Equal "SCAN lists the JPEG" "002505_20260505112331.JPG" $listed.files[0].name
        Assert-Equal "2dh document id from SCAN tree" "20.1231213163838006.1208" (Find-Nnt2dDocId "PY002505")
        $docFile = Find-Nnt2dDocFile "PY002505"
        Assert-Equal "2dh file ends with collection name" $true ($docFile -like "*2D Images collection*20.1231213163838006.1208.2dh")
        Assert-Equal "Unknown chart has no 2dh" "" (Find-Nnt2dDocId "PY999999")
        $missing = Get-NntScanFiles "PY999999"
        Assert-Equal "Unknown chart number is found=false" $false $missing.found
        $scanResp = Handle-Request "/nnt/scans?patient_no=PY002505"
        Assert-Equal "/nnt/scans returns 200" 200 $scanResp.status
        Assert-Equal "/nnt/scans found=true" $true $scanResp.body.found
        $badScan = Handle-Request "/nnt/scans"
        Assert-Equal "/nnt/scans without patient_no is 400" 400 $badScan.status
        $fileResp = Handle-Request "/nnt/file?patient_no=PY002505&name=002505_20260505112331.JPG"
        Assert-Equal "/nnt/file returns 200" 200 $fileResp.status
        Assert-Equal "/nnt/file is JPEG" "image/jpeg" $fileResp.contentType
        Assert-Equal "/nnt/file has bytes" "4" ([string]$fileResp.bytes.Length)
        $escapeResp = Handle-Request "/nnt/file?patient_no=PY002505&name=..%5CWindows%5Cwin.ini"
        Assert-Equal "/nnt/file rejects path escape" 404 $escapeResp.status
    } catch {
        Assert-Equal "SCAN self-test threw" "no-throw" $_.Exception.Message
    } finally {
        $script:NntScanRootsOverride = $prevRoots
        if (Test-Path -LiteralPath $scanRoot) { Remove-Item -LiteralPath $scanRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }

    Write-Host "== Parse-Query / UrlDecode round-trip (Chinese name, spaces, symbols) ==" -ForegroundColor Cyan
    $rawName = "HSIUNG KWAN MING"
    $rawChinese = "熊關明"
    $qs = "/open/nntnewtom?patient_no=" + [Uri]::EscapeDataString("001287") +
          "&patient_name=" + [Uri]::EscapeDataString($rawName) +
          "&chinese_name=" + [Uri]::EscapeDataString($rawChinese) +
          "&dob=" + [Uri]::EscapeDataString("1969-05-23") +
          "&sex=" + [Uri]::EscapeDataString("M") +
          "&hkid=" + [Uri]::EscapeDataString("A123456(7)")
    $parsed = Parse-Query $qs
    Assert-Equal "patient_no round-trip"   "001287"     $parsed["patient_no"]
    Assert-Equal "patient_name round-trip" $rawName     $parsed["patient_name"]
    Assert-Equal "chinese_name round-trip" $rawChinese  $parsed["chinese_name"]
    Assert-Equal "hkid with symbols"       "A123456(7)" $parsed["hkid"]

    Write-Host "== Build-PatientContext + Patient-ContextText ==" -ForegroundColor Cyan
    $ctx = Build-PatientContext $parsed
    $text = Patient-ContextText $ctx
    Assert-Equal "Context text has patient no" $true ($text -like "*Patient No: 001287*")
    Assert-Equal "Context text has EN name"    $true ($text -like "*Name: $rawName*")
    Assert-Equal "Context text has ZH name"    $true ($text -like "*Chinese Name: $rawChinese*")
    Assert-Equal "Context text omits blank fields" $false ($text -like "*Alerts:*")

    Write-Host "== Save-PatientContext (writes only under a temp folder) ==" -ForegroundColor Cyan
    $tempFolder = Join-Path $env:TEMP ("xray-launcher-selftest-" + [Guid]::NewGuid().ToString("N"))
    try {
        $ctxWithFolder = Build-PatientContext (Parse-Query ($qs + "&folder_path=" + [Uri]::EscapeDataString($tempFolder)))
        $jsonPath = Save-PatientContext $ctxWithFolder
        Assert-Equal "JSON info file created" $true (Test-Path -LiteralPath $jsonPath)
        Assert-Equal "TXT info file created"  $true (Test-Path -LiteralPath (Join-Path $tempFolder "nnt-patient-info.txt"))
        $savedJson = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
        Assert-Equal "Saved JSON has correct patient_no" "001287" $savedJson.patient_no
    } finally {
        if (Test-Path -LiteralPath $tempFolder) { Remove-Item -LiteralPath $tempFolder -Recurse -Force -ErrorAction SilentlyContinue }
    }

    Write-Host "== Convert-EzdentiPatientId (strip Banana's clinic prefix, e.g. 'PL', so EzDent-i ChartNumber / search matches OLD records) ==" -ForegroundColor Cyan
    Assert-Equal "Real case: PL-prefixed chart number" "001287" (Convert-EzdentiPatientId "PL001287")
    Assert-Equal "Lowercase prefix"                    "001287" (Convert-EzdentiPatientId "pl001287")
    Assert-Equal "No prefix, digits only"              "001287" (Convert-EzdentiPatientId "001287")
    Assert-Equal "Different clinic's letter prefix"    "013524" (Convert-EzdentiPatientId "MK013524")
    Assert-Equal "Empty stays empty"                   ""       (Convert-EzdentiPatientId "")
    Assert-Equal "Null stays empty"                    ""       (Convert-EzdentiPatientId $null)

    Write-Host "== New-EzdentiLinkageXml (Vatech PMS-bridge linkage.xml contract) ==" -ForegroundColor Cyan
    $ezQs = $qs + "&address=" + [Uri]::EscapeDataString("1 Main St") +
            "&phone=" + [Uri]::EscapeDataString("21234567") +
            "&mobile_phone=" + [Uri]::EscapeDataString("91234567")
    $ezPatient = Build-PatientContext (Parse-Query $ezQs)
    $ezXml = New-EzdentiLinkageXml $ezPatient
    Assert-Equal "Root element"        $true ($ezXml -like "*<LinkageParameter>*")
    Assert-Equal "ChartNumber attr"    $true ($ezXml -like '*ChartNumber="001287"*')
    Assert-Equal "FirstName attr (EN)" $true ($ezXml -like "*FirstName=`"$rawName`"*")
    Assert-Equal "LastName attr (ZH)"  $true ($ezXml -like "*LastName=`"$rawChinese`"*")
    Assert-Equal "Birthday dd/MM/yyyy" $true ($ezXml -like "*<Birthday>23/05/1969</Birthday>*")
    Assert-Equal "Gender word"         $true ($ezXml -like "*<Gender>Male</Gender>*")
    Assert-Equal "SocialID (HKID)"     $true ($ezXml -like "*<SocialID>A123456(7)</SocialID>*")
    Assert-Equal "Address"             $true ($ezXml -like "*<Address>1 Main St</Address>*")
    Assert-Equal "Phone"               $true ($ezXml -like "*<Phone>21234567</Phone>*")
    Assert-Equal "Mobile"              $true ($ezXml -like "*<Mobile>91234567</Mobile>*")
    $ezXmlNoDob = New-EzdentiLinkageXml (Build-PatientContext (Parse-Query "/open/ezdenti?patient_no=999999"))
    Assert-Equal "Missing DOB omits Birthday tag" $false ($ezXmlNoDob -like "*<Birthday>*")
    $ezXmlPl = New-EzdentiLinkageXml (Build-PatientContext (Parse-Query "/open/ezdenti?patient_no=PL001287"))
    Assert-Equal "PL prefix stripped from ChartNumber" $true ($ezXmlPl -like '*ChartNumber="001287"*')
    Assert-Equal "PL prefix not left on ChartNumber"   $false ($ezXmlPl -like '*ChartNumber="PL001287"*')
    $ezClip = Build-PatientContext (Parse-Query "/open/ezdenti?patient_no=PL001287&patient_name=TEST")
    $ezClip.patient_no = Convert-EzdentiPatientId $ezClip.patient_no
    $ezClipText = Patient-ContextText $ezClip
    Assert-Equal "Clipboard paste uses bare chart" $true ($ezClipText -like "*Patient No: 001287*")
    Assert-Equal "Clipboard paste drops PL prefix" $false ($ezClipText -like "*Patient No: PL001287*")

    Write-Host "== Start-EzdentiBridgePatient / Resolve-EzdentiBridge (no real launch) ==" -ForegroundColor Cyan
    # Start-EzdentiBridgePatient now opens $Resolved.target itself (confirmed
    # live that VTE2Loader32.exe is the thing that actually shows a window --
    # VTEzBridge32.exe does not), so unlike the old version it REQUIRES a
    # real, existing target and always bails out before touching the
    # filesystem or Resolve-EzdentiBridge (which has real hardcoded
    # fallback paths, e.g. this very PC has a real VTEzBridge32.exe) if the
    # target is missing. Deliberately only exercised with a non-existent
    # target here so this can never pop up a real EzDent-i/bridge process
    # on a PC where it happens to actually be installed -- genuine
    # end-to-end coverage of the success path is opt-in only, alongside
    # NNT's own live-launch check below (-IncludeLiveLaunch).
    $noTarget = Start-EzdentiBridgePatient ([ordered]@{ workingDirectory = $env:TEMP; target = (Join-Path $env:TEMP "does-not-exist.exe") }) $ezPatient
    Assert-Equal "Missing target returns null" $true ($null -eq $noTarget)
    $noResolved = Start-EzdentiBridgePatient $null $ezPatient
    Assert-Equal "Null resolved returns null" $true ($null -eq $noResolved)
    # Resolve-EzdentiBridge only resolves a path string -- never launches
    # anything -- so it's safe to call directly even if a real
    # VTEzBridge32.exe happens to exist on this PC.
    $bridgeGuess = Resolve-EzdentiBridge ([ordered]@{ workingDirectory = (Join-Path $env:TEMP ("xray-ez-" + [Guid]::NewGuid().ToString("N"))); target = "" })
    Assert-Equal "Returns a string (found or not)" $true ($bridgeGuess -is [string])

    Write-Host "== Resolve-System (works whether or not NNT is actually installed on this PC) ==" -ForegroundColor Cyan
    $nnt = Resolve-System "nntnewtom" ""
    Assert-Equal "nntnewtom.exists is a boolean" $true ($nnt.exists -is [bool])
    $ezResolveCheck = Resolve-System "ezdenti" ""
    Assert-Equal "ezdenti.exists is a boolean" $true ($ezResolveCheck.exists -is [bool])
    $rayResolveCheck = Resolve-System "rayscan" ""
    Assert-Equal "rayscan.exists is a boolean" $true ($rayResolveCheck.exists -is [bool])
    Assert-Equal "unknown system key returns null" $true ((Resolve-System "does-not-exist" "") -eq $null)

    Write-Host "== -EnabledSystems (installer-ezdenti / installer-nntnewtom isolation) ==" -ForegroundColor Cyan
    # Temporarily overrides the script-scope $EnabledSystems the same way
    # passing -EnabledSystems on the command line would, then restores it, so
    # this works whether -SelfTest itself was run restricted or not.
    $savedEnabledSystems = $EnabledSystems
    try {
        $EnabledSystems = @("ezdenti")
        Assert-Equal "ezdenti enabled -> Resolve-System finds it (or legitimately not-installed)" $true ((Resolve-System "ezdenti" "") -ne $null)
        Assert-Equal "nntnewtom NOT enabled -> Resolve-System returns null" $true ((Resolve-System "nntnewtom" "") -eq $null)
        # Status-Payload returns a raw [ordered]@{} here (no JSON round-trip
        # like a real HTTP client would see), so membership is checked with
        # .Contains(key) -- an OrderedDictionary's .PSObject.Properties are
        # the .NET dictionary type's own members (Count, Keys, ...), not its
        # entries, and would silently pass/fail this check for the wrong
        # reason either way.
        $restrictedStatus = Status-Payload
        Assert-Equal "Restricted /status has ezdenti_exists" $true ($restrictedStatus.Contains("ezdenti_exists"))
        Assert-Equal "Restricted /status omits nntnewtom_exists entirely" $false ($restrictedStatus.Contains("nntnewtom_exists"))
        Assert-Equal "Restricted /status omits nntnewtom from systems map" $false ($restrictedStatus.systems.Keys -contains "nntnewtom")
        Assert-Equal "Restricted /status reports enabled_systems" "ezdenti" ($restrictedStatus.enabled_systems -join ",")

        $EnabledSystems = @()
        Assert-Equal "Empty EnabledSystems = unrestricted (nntnewtom resolvable again)" $true ((Resolve-System "nntnewtom" "") -ne $null)
    } finally {
        $EnabledSystems = $savedEnabledSystems
    }

    Write-Host "== Handle-Request (HTTP-less integration test of routing) ==" -ForegroundColor Cyan
    $statusResp = Handle-Request "/status"
    Assert-Equal "/status returns 200"        200  $statusResp.status
    Assert-Equal "/status body ok=true"       $true $statusResp.body.ok
    $missingResp = Handle-Request "/open/does-not-exist"
    Assert-Equal "/open/<unknown key> returns 404" 404 $missingResp.status
    if ($IncludeLiveLaunch) {
        # Opt-in only: if NNT is actually installed here, this really does invoke
        # NNTBridge.exe / NNT.exe with the fabricated patient below
        # (patient_no=001287, "HSIUNG KWAN MING"). Genuine end-to-end coverage,
        # but a real, visible launch -- not a mock. Skipped unless requested so
        # that routine "-SelfTest" runs never surprise anyone with a popped-up
        # NNT window.
        $nntOpenResp = Handle-Request ("/open/nntnewtom?" + $qs.Split('?')[1])
        if ($nnt.exists) {
            Assert-Equal "/open/nntnewtom returns 200 and launches the real bridge" 200 $nntOpenResp.status
        } else {
            Assert-Equal "/open/nntnewtom returns 404 when NNT not installed on this PC" 404 $nntOpenResp.status
        }
        # Same opt-in trade-off as NNT above: if EzDent-i is actually installed
        # here, this really does open it (VTE2Loader32.exe -> visible VTE232.exe
        # window) and best-effort fire VTEzBridge32.exe, with the fabricated
        # patient above. Confirmed live (2026-08-19) to open the app; the
        # linkage.xml/VTEzBridge32.exe half is best-effort and unconfirmed --
        # see the comment above New-EzdentiLinkageXml.
        $ezOpenResp = Handle-Request ("/open/ezdenti?" + $ezQs.Split('?')[1])
        if ($ezResolveCheck.exists) {
            Assert-Equal "/open/ezdenti returns 200 and opens the real app" 200 $ezOpenResp.status
        } else {
            Assert-Equal "/open/ezdenti returns 404 when EzDent-i not installed on this PC" 404 $ezOpenResp.status
        }
        # Same opt-in trade-off: if RAYBridge.exe is actually installed here,
        # this really does launch it with the fabricated patient above
        # (patient_no=001287, "HSIUNG KWAN MING").
        $rayQs = "/open/rayscan?" + $qs.Split('?')[1]
        $rayOpenResp = Handle-Request $rayQs
        if ($rayResolveCheck.exists) {
            Assert-Equal "/open/rayscan returns 200 and launches the real bridge" 200 $rayOpenResp.status
        } else {
            Assert-Equal "/open/rayscan returns 404 when Rayscan not installed on this PC" 404 $rayOpenResp.status
        }
    } else {
        Write-Host "  [SKIP] /open/nntnewtom, /open/ezdenti, /open/rayscan live-launch checks (pass -IncludeLiveLaunch to run them)" -ForegroundColor DarkYellow
    }

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
# SERVER — only reached in normal (non -SelfTest) operation.
# ════════════════════════════════════════════════════════════════
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse("127.0.0.1"), $Port)
try {
    $listener.Start()
} catch {
    Write-Host "X-Ray launcher bridge is already running on port $Port (or the port is taken). Exiting." -ForegroundColor Yellow
    exit 0
}
Write-Host "X-Ray launcher bridge ready: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "Leave this window open while using CS Imaging / Ai-Dental / NNT-NEWTOM links." -ForegroundColor Cyan

while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $stream = $client.GetStream()
        $buffer = New-Object byte[] 8192
        $read = $stream.Read($buffer, 0, $buffer.Length)
        $request = [Text.Encoding]::ASCII.GetString($buffer, 0, $read)
        $firstLine = ($request -split "`r?`n")[0]
        $parts = $firstLine -split " "
        $method = if ($parts.Count -gt 0) { $parts[0] } else { "" }
        $rawPath = if ($parts.Count -gt 1) { $parts[1] } else { "/" }

        if ($method -eq "OPTIONS") {
            Send-Json $client 204 @{}
        } else {
            $result = Handle-Request $rawPath
            if ($null -ne $result.bytes) {
                Send-Bytes $client $result.status $result.contentType $result.bytes
            } else {
                Send-Json $client $result.status $result.body
            }
        }
    } catch {
        try {
            Send-Json $client 500 ([ordered]@{ ok = $false; error = $_.Exception.Message })
        } catch {}
    } finally {
        $client.Close()
    }
}
