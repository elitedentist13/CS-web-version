# tools/_nnt_new_opg_watcher.ps1
# Staff-gated "new panoramic -> Banana" bridge for the live NNT/NEWTOM launch
# path in xray-local-launcher.ps1.
#
# Spawned in the background (non-blocking, WindowStyle Hidden) by
# Start-NntNewOpgWatcher right alongside _nnt_identity_guard.ps1, whenever
# NNT/NEWTOM is opened for a patient from Banana -- for every patient, new
# or returning. It:
#   1. Watches ALL of the patient's candidate CS/NNT SCAN folders (the
#      bridge-documented folder if a 2D study already exists, plus every
#      root x id-candidate path from Get-NntScanFolderCandidatePaths in
#      xray-local-launcher.ps1 -- passed whether or not each one exists
#      yet on disk, so a brand-new patient with no scan folder at all is
#      still covered the instant NNT/CS create one) for any file written
#      AFTER this watcher started (i.e. captured during this session, not
#      something CS already had).
#   2. Waits for that file to stop changing size (avoids grabbing a
#      half-written capture).
#   3. Pops a Yes/No prompt asking staff whether to transfer + upload it to
#      Banana. This is deliberately asked EVERY time a new file is
#      detected -- no "don't ask again" / auto-upload, and no suppression
#      based on anything else (e.g. a concurrent identity-guard warning) --
#      see chat discussion 2026-08-19 ("the yes/no should be prompted every
#      time"). Staff always get the final say before anything leaves this
#      PC.
#   4. On Yes: screen-caps the live NNT viewer window (same crop box as
#      tools/_batch_screencap_nnt.ps1 -- preferred over decoding the raw
#      *.pan_ buffer directly, since that decode is only an approximation
#      of NNT's real rendering; see tools/_import_cs_opg.py header) and
#      uploads the JPEG straight into Supabase via the anon-key REST API,
#      using the exact same `xrays` bucket/table contract as
#      tools/_import_cs_opg.py and the web app's own app-xray.js upload
#      path.
#   5. Every outcome (detected / declined / uploaded / upload_error /
#      stopped_*) is appended as one JSON line to _nnt_new_opg_log.jsonl
#      next to this script, for later audit.
#
# Known limitation: even watching every candidate path (existing or not),
# it's not yet confirmed whether NNT writes a brand-new patient's very
# first-ever capture into one of these same network SCAN folders or
# somewhere purely internal to NNT -- if the latter, this watcher will
# simply never fire for that first-ever capture (all later captures, once
# any folder/study exists, are the confirmed/expected case). Needs a live
# trial with an actual brand-new patient to fully verify.
#
# Self-test (pure logic + temp-folder file detection only -- no real NNT
# process, no screen capture, no network access):
#     powershell -File _nnt_new_opg_watcher.ps1 -SelfTest
param(
    [string]$PatientId = "",
    [string]$PatientNo = "",
    [string]$PatientName = "",
    # Semicolon-separated list of candidate SCAN folders to watch (any/all
    # may not exist yet on disk -- see Get-NntScanFolderCandidatePaths in
    # xray-local-launcher.ps1). All are polled every cycle; the newest
    # relevant file across all of them wins.
    [string]$ChartFolders = "",
    [int]$TimeoutMinutes = 20,
    [switch]$SelfTest
)

$SUPABASE_URL = "https://kprihawipljrltfzpfjd.supabase.co"
$SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi" +
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0." +
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
$XRAY_BUCKET = "xrays"

$script:LogPath = Join-Path $PSScriptRoot "_nnt_new_opg_log.jsonl"

function Write-OpgLog([string]$Outcome, [hashtable]$Extra = @{}) {
    try {
        $entry = [ordered]@{
            timestamp    = (Get-Date).ToString("o")
            patient_no   = $PatientNo
            patient_name = $PatientName
            outcome      = $Outcome
        }
        foreach ($k in $Extra.Keys) { $entry[$k] = $Extra[$k] }
        ($entry | ConvertTo-Json -Compress) | Add-Content -LiteralPath $script:LogPath -Encoding UTF8
    } catch {}
}

# Same idea as tools/_import_cs_opg.py's two source cases (plain top-level
# JPEG vs. *.2dh + *.pan_<guid> NNT-proprietary study) -- but here we only
# need to recognize "this looks like a freshly written capture", not decode
# it (the upload path always screen-caps the live viewer instead).
function Test-RelevantNewFile([System.IO.FileInfo]$File) {
    if (-not $File) { return $false }
    $name = $File.Name.ToLowerInvariant()
    if ($name -like "*.pan_*") { return $true }
    if ($name.EndsWith(".2dh")) { return $true }
    if ($name.EndsWith(".last_scenario")) { return $false }
    $ext = $File.Extension.ToLowerInvariant()
    if ($ext -in @(".jpg", ".jpeg", ".png", ".bmp", ".gif")) { return $true }
    return $false
}

function Find-NewestRelevantFile([string]$Folder, [datetime]$SinceUtc) {
    if ([string]::IsNullOrWhiteSpace($Folder) -or -not (Test-Path -LiteralPath $Folder)) { return $null }
    try {
        $candidates = Get-ChildItem -LiteralPath $Folder -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTimeUtc -gt $SinceUtc -and (Test-RelevantNewFile $_) }
        if (-not $candidates) { return $null }
        return ($candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
    } catch {
        return $null
    }
}

# Same as Find-NewestRelevantFile but across every folder in the list --
# folders that don't exist (yet) are silently skipped, not an error, since
# a brand-new patient's folder may not be created until NNT/CS write to it.
function Find-NewestRelevantFileAcrossFolders([string[]]$Folders, [datetime]$SinceUtc) {
    $best = $null
    foreach ($folder in $Folders) {
        $hit = Find-NewestRelevantFile $folder $SinceUtc
        if ($hit -and (-not $best -or $hit.LastWriteTimeUtc -gt $best.LastWriteTimeUtc)) {
            $best = $hit
        }
    }
    return $best
}

function Wait-FileStable([string]$Path, [int]$Retries = 6, [int]$DelayMs = 700) {
    $lastSize = -1
    for ($i = 0; $i -lt $Retries; $i++) {
        try {
            $size = (Get-Item -LiteralPath $Path -ErrorAction Stop).Length
        } catch { return $false }
        if ($size -eq $lastSize -and $size -gt 0) { return $true }
        $lastSize = $size
        Start-Sleep -Milliseconds $DelayMs
    }
    return $false
}

function New-RandomToken([int]$Length = 11) {
    -join ((97..122) | Get-Random -Count $Length | ForEach-Object { [char]$_ })
}

function Build-XrayStoragePath([string]$PatId) {
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    return "$PatId/${ts}_$(New-RandomToken).jpg"
}

if ($SelfTest) {
    $passed = 0
    $failed = New-Object System.Collections.Generic.List[string]
    function Assert-Eq($label, $expected, $actual) {
        if ("$expected" -eq "$actual") {
            $script:passed++
            Write-Host "  [PASS] $label" -ForegroundColor Green
        } else {
            $script:failed.Add("$label -- expected [$expected] got [$actual]")
            Write-Host "  [FAIL] $label -- expected [$expected] got [$actual]" -ForegroundColor Red
        }
    }

    Write-Host "== Test-RelevantNewFile ==" -ForegroundColor Cyan
    $tmpDir = Join-Path $env:TEMP ("nnt_opg_watcher_selftest_" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    try {
        $panFile = Join-Path $tmpDir "20.123.pan_ABCDEF0102030405"
        Set-Content -LiteralPath $panFile -Value "x" -Encoding ASCII
        Assert-Eq "*.pan_<guid> is relevant" $true (Test-RelevantNewFile (Get-Item -LiteralPath $panFile))

        $twoDh = Join-Path $tmpDir "20.123.2dh"
        Set-Content -LiteralPath $twoDh -Value "x" -Encoding ASCII
        Assert-Eq "*.2dh is relevant" $true (Test-RelevantNewFile (Get-Item -LiteralPath $twoDh))

        $scenario = Join-Path $tmpDir "20.123.last_scenario"
        Set-Content -LiteralPath $scenario -Value "x" -Encoding ASCII
        Assert-Eq ".last_scenario is metadata, not relevant" $false (Test-RelevantNewFile (Get-Item -LiteralPath $scenario))

        $jpg = Join-Path $tmpDir "002505_20260819.JPG"
        Set-Content -LiteralPath $jpg -Value "x" -Encoding ASCII
        Assert-Eq "*.JPG (any case) is relevant" $true (Test-RelevantNewFile (Get-Item -LiteralPath $jpg))

        $txt = Join-Path $tmpDir "readme.txt"
        Set-Content -LiteralPath $txt -Value "x" -Encoding ASCII
        Assert-Eq "*.txt is not relevant" $false (Test-RelevantNewFile (Get-Item -LiteralPath $txt))

        Write-Host "== Find-NewestRelevantFile (old files ignored, newest relevant file wins) ==" -ForegroundColor Cyan
        $sinceUtc = (Get-Date).ToUniversalTime()
        Start-Sleep -Milliseconds 50
        $oldRelevantButBeforeSince = Get-Item -LiteralPath $jpg
        # jpg/pan_/2dh were all written before $sinceUtc -- none should match.
        $none = Find-NewestRelevantFile $tmpDir $sinceUtc
        Assert-Eq "No file newer than 'since' -- returns null" $true ($null -eq $none)

        Start-Sleep -Milliseconds 50
        $freshPan = Join-Path $tmpDir "30.456.pan_1122334455667788"
        Set-Content -LiteralPath $freshPan -Value "yy" -Encoding ASCII
        $freshTxt = Join-Path $tmpDir "notes.txt"
        Set-Content -LiteralPath $freshTxt -Value "yy" -Encoding ASCII
        $hit = Find-NewestRelevantFile $tmpDir $sinceUtc
        $hitName = if ($hit) { $hit.Name } else { "" }
        Assert-Eq "Newest relevant file after 'since' is the fresh .pan_ (irrelevant .txt skipped)" `
            ([IO.Path]::GetFileName($freshPan)) $hitName

        Assert-Eq "Missing folder returns null" $true ($null -eq (Find-NewestRelevantFile (Join-Path $tmpDir "does-not-exist") $sinceUtc))
    } finally {
        Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "== Find-NewestRelevantFileAcrossFolders (covers brand-new patients with no folder yet) ==" -ForegroundColor Cyan
    $realDir = Join-Path $env:TEMP ("nnt_opg_multi_selftest_" + [Guid]::NewGuid().ToString("N"))
    $missingDir1 = Join-Path $env:TEMP ("nnt_opg_missing1_" + [Guid]::NewGuid().ToString("N"))
    $missingDir2 = Join-Path $env:TEMP ("nnt_opg_missing2_" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $realDir -Force | Out-Null
    try {
        $sinceUtc2 = (Get-Date).ToUniversalTime()
        Start-Sleep -Milliseconds 50
        $newPan = Join-Path $realDir "40.789.pan_AABBCCDD11223344"
        Set-Content -LiteralPath $newPan -Value "z" -Encoding ASCII
        $result = Find-NewestRelevantFileAcrossFolders @($missingDir1, $realDir, $missingDir2) $sinceUtc2
        $resultName = if ($result) { $result.Name } else { "" }
        Assert-Eq "Finds the file in the one real folder among two non-existent candidates" `
            ([IO.Path]::GetFileName($newPan)) $resultName
        $noneAtAll = Find-NewestRelevantFileAcrossFolders @($missingDir1, $missingDir2) $sinceUtc2
        Assert-Eq "All-missing folder list returns null (no throw)" $true ($null -eq $noneAtAll)
    } finally {
        Remove-Item -LiteralPath $realDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "== Wait-FileStable ==" -ForegroundColor Cyan
    $stableFile = Join-Path $env:TEMP ("nnt_opg_stable_" + [Guid]::NewGuid().ToString("N") + ".txt")
    try {
        Set-Content -LiteralPath $stableFile -Value "constant" -Encoding ASCII
        Assert-Eq "Unchanging file reports stable" $true (Wait-FileStable $stableFile -Retries 3 -DelayMs 100)
        Assert-Eq "Missing file reports not stable" $false (Wait-FileStable (Join-Path $env:TEMP "does-not-exist.txt") -Retries 2 -DelayMs 50)
    } finally {
        Remove-Item -LiteralPath $stableFile -ErrorAction SilentlyContinue
    }

    Write-Host "== Build-XrayStoragePath (matches _import_cs_opg.py's {patient_id}/{ts}_{rand}.jpg shape) ==" -ForegroundColor Cyan
    $path1 = Build-XrayStoragePath "abc-123-uuid"
    Assert-Eq "Storage path starts with patient id" $true ($path1 -like "abc-123-uuid/*")
    Assert-Eq "Storage path matches {id}/{13-digit-ms}_{11 lowercase letters}.jpg" $true `
        ($path1 -match '^abc-123-uuid/\d{13}_[a-z]{11}\.jpg$')
    $path2 = Build-XrayStoragePath "abc-123-uuid"
    Assert-Eq "Two calls do not collide" $false ($path1 -eq $path2)

    Write-Host ""
    $total = $passed + $failed.Count
    if ($failed.Count -eq 0) {
        Write-Host "SELF-TEST PASSED: $passed / $total checks" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "SELF-TEST FAILED: $($failed.Count) of $total checks failed" -ForegroundColor Red
        $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        exit 1
    }
}

# ── Real (non-test) run below ──

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name Win32Cap -Namespace NntNewOpg -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern int SetProcessDPIAware();
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
[NntNewOpg.Win32Cap]::SetProcessDPIAware() | Out-Null

# Fixed crop box measured against the maximized NNT viewer window
# (1296x992) -- see tools/_batch_screencap_nnt.ps1 / CHANGELOG 2026-08-19
# for how this was derived by scanning pixel colors for the blue frame
# lines around the image canvas.
$CropLeft = 36
$CropTop = 196
$CropRight = 1250
$CropBottom = 873

function Get-NntProcess {
    return Get-Process -Name "NNT" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

function Capture-NntWindowCropped([IntPtr]$Hwnd, [string]$OutPath) {
    [NntNewOpg.Win32Cap]::ShowWindowAsync($Hwnd, 3) | Out-Null
    Start-Sleep -Milliseconds 500
    [NntNewOpg.Win32Cap]::SetForegroundWindow($Hwnd) | Out-Null
    Start-Sleep -Milliseconds 600

    $rect = New-Object NntNewOpg.Win32Cap+RECT
    [NntNewOpg.Win32Cap]::GetWindowRect($Hwnd, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { return $false }

    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $width, $height))
    $g.Dispose()

    $cw = $CropRight - $CropLeft
    $ch = $CropBottom - $CropTop
    if ($CropRight -le $width -and $CropBottom -le $height -and $cw -gt 0 -and $ch -gt 0) {
        $cropRectObj = New-Object System.Drawing.Rectangle $CropLeft, $CropTop, $cw, $ch
        $cropped = $bmp.Clone($cropRectObj, $bmp.PixelFormat)
        $bmp.Dispose()
        $bmp = $cropped
    }
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
    return $true
}

function Show-UploadPrompt([string]$Name, [string]$ChartNo) {
    $display = if ($Name) { $Name } else { "this patient" }
    $result = [System.Windows.Forms.MessageBox]::Show(
        "A new panoramic X-ray was just detected for $display (chart $ChartNo).`n`n" +
        "Transfer and upload this OPG to Banana now?",
        "Banana X-Ray Launcher -- New OPG Detected",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    return $result -eq [System.Windows.Forms.DialogResult]::Yes
}

function Show-InfoMessage([string]$Title, [string]$Body, [string]$Icon) {
    [System.Windows.Forms.MessageBox]::Show(
        $Body, $Title, [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::$Icon
    ) | Out-Null
}

function Invoke-SupabaseUpload([byte[]]$Bytes, [string]$StoragePath) {
    $uri = "$SUPABASE_URL/storage/v1/object/$XRAY_BUCKET/$StoragePath"
    Invoke-RestMethod -Method Post -Uri $uri `
        -Headers @{ apikey = $SUPABASE_ANON_KEY; Authorization = "Bearer $SUPABASE_ANON_KEY"; "x-upsert" = "false" } `
        -ContentType "image/jpeg" -Body $Bytes | Out-Null
}

function Invoke-SupabaseXrayInsert([hashtable]$Row) {
    $uri = "$SUPABASE_URL/rest/v1/xrays"
    $body = "[" + ($Row | ConvertTo-Json -Compress) + "]"
    Invoke-RestMethod -Method Post -Uri $uri `
        -Headers @{ apikey = $SUPABASE_ANON_KEY; Authorization = "Bearer $SUPABASE_ANON_KEY"; Prefer = "return=representation" } `
        -ContentType "application/json" -Body $body | Out-Null
}

if ([string]::IsNullOrWhiteSpace($PatientNo) -or [string]::IsNullOrWhiteSpace($PatientId)) {
    Write-OpgLog "aborted_missing_params"
    exit 0
}

$folderList = @($ChartFolders -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
if ($folderList.Count -eq 0) {
    Write-OpgLog "aborted_no_folders"
    exit 0
}

$sinceUtc = (Get-Date).ToUniversalTime()
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
Write-OpgLog "watching_started" @{ chart_folders = ($folderList -join ";"); timeout_minutes = $TimeoutMinutes }

$alreadyPrompted = New-Object System.Collections.Generic.HashSet[string]
$lastSeenNnt = $null

while ((Get-Date) -lt $deadline) {
    $proc = Get-NntProcess
    if ($proc) {
        $lastSeenNnt = Get-Date
    } elseif ($lastSeenNnt -and ((Get-Date) - $lastSeenNnt).TotalSeconds -gt 60) {
        Write-OpgLog "stopped_nnt_closed"
        exit 0
    }

    $hit = Find-NewestRelevantFileAcrossFolders $folderList $sinceUtc
    if ($hit -and -not $alreadyPrompted.Contains($hit.FullName)) {
        if (-not (Wait-FileStable $hit.FullName)) {
            Start-Sleep -Milliseconds 1000
            continue
        }
        $alreadyPrompted.Add($hit.FullName) | Out-Null
        Write-OpgLog "detected" @{ file = $hit.FullName }

        # Every single detected file gets its own prompt -- deliberately no
        # "don't ask again" and no auto-upload, regardless of outcome.
        $proceed = Show-UploadPrompt $PatientName $PatientNo
        if (-not $proceed) {
            Write-OpgLog "declined" @{ file = $hit.FullName }
            Start-Sleep -Milliseconds 1500
            continue
        }

        try {
            $captureProc = Get-NntProcess
            if (-not $captureProc) { throw "NNT window not found at upload time" }

            $tmpJpeg = Join-Path $env:TEMP ("nnt_new_opg_" + [Guid]::NewGuid().ToString("N") + ".jpg")
            $captured = Capture-NntWindowCropped $captureProc.MainWindowHandle $tmpJpeg
            if (-not $captured) { throw "screen capture failed" }

            $bytes = [IO.File]::ReadAllBytes($tmpJpeg)
            $storagePath = Build-XrayStoragePath $PatientId
            Invoke-SupabaseUpload $bytes $storagePath
            $publicUrl = "$SUPABASE_URL/storage/v1/object/public/$XRAY_BUCKET/$storagePath"

            $row = @{
                patient_id   = $PatientId
                patient_no   = $PatientNo
                patient_name = $PatientName
                file_path    = $storagePath
                file_url     = $publicUrl
                file_name    = Split-Path -Leaf $storagePath
                file_size    = $bytes.Length
                xray_type    = "Panoramic"
                taken_date   = (Get-Date -Format "yyyy-MM-dd")
                notes        = "Live NNT capture via xray-local-launcher (staff-confirmed)"
                uploaded_by  = "xray-local-launcher (auto, staff-confirmed)"
            }
            Invoke-SupabaseXrayInsert $row
            Remove-Item -LiteralPath $tmpJpeg -ErrorAction SilentlyContinue

            Write-OpgLog "uploaded" @{ file = $hit.FullName; storage_path = $storagePath }
            Show-InfoMessage "Banana X-Ray Launcher" "Uploaded to Banana successfully." "Information"
        } catch {
            Write-OpgLog "upload_error" @{ file = $hit.FullName; message = $_.Exception.Message }
            Show-InfoMessage "Banana X-Ray Launcher -- Upload Failed" `
                ("Could not upload the new OPG to Banana:`n`n" + $_.Exception.Message) "Error"
        }
    }

    Start-Sleep -Milliseconds 1500
}

Write-OpgLog "stopped_timeout"
