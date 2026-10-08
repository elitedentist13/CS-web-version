# Joyful Smile / Banana - csxrayai:// handler.
#
# Chrome's local-network check blocks a hosted clinic page from calling
# http://127.0.0.1:8877. The page only opens csxrayai:// links:
#
#   csxrayai://start                         start the AI service if it is down
#   csxrayai://prepare?id=<uuid>&client=<id> install, register, then start
#   csxrayai://job?id=<uuid>&client=<id>     run that job (and later ones)
#   csxrayai://job?client=<id>               wake the worker for this browser
#
# One worker runs per Windows session. It claims xray_ai_jobs rows written
# by the browsers that launched it, talks to the AI service on loopback,
# writes the JSON result back, and exits after IdleExitSeconds with no work.
# While it is up the page does not open csxrayai:// again, because Chrome
# refuses repeated protocol launches that are not tied to a click.
#
#   powershell -File launch-xray-ai-protocol.ps1 -SelfTest
#   powershell -File launch-xray-ai-protocol.ps1 "csxrayai://job?id=00000000-0000-4000-8000-000000000000"

param(
    [Parameter(Position = 0)]
    [string]$Url = "",
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$SupabaseUrl = "https://kprihawipljrltfzpfjd.supabase.co"
$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi" +
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0." +
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"

$AiBase = "http://127.0.0.1:8877"
# The page treats the worker as alive for 8 minutes after its last answer.
$IdleExitSeconds = 600
$PollMilliseconds = 1000
# A row the page stopped waiting for must not be run minutes later.
$JobMaxAgeMinutes = 6
$WantedIdSeconds = 90
$MutexName = "Local\CsXrayAiProtocolWorker"

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $env:LOCALAPPDATA "cs-xray-ai"
$LogPath = Join-Path $LogDir "protocol.log"
$ClientsPath = Join-Path $LogDir "protocol-clients.txt"

function Write-ProtoLog([string]$Message) {
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $PID, $Message
        Add-Content -Path $LogPath -Value $line -Encoding UTF8
    } catch {}
}

function Get-UrlParam([string]$Raw, [string]$Name) {
    $s = ([string]$Raw).Trim().Trim('"').Trim("'")
    if ($s -match ('(?i)[?&]' + [regex]::Escape($Name) + '=([^&#"]+)')) {
        return [Uri]::UnescapeDataString($Matches[1])
    }
    return $null
}

function Get-JobId([string]$Raw) {
    $v = Get-UrlParam $Raw "id"
    if ($v -and $v -match '^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
        return $v.ToLower()
    }
    return $null
}

function Get-ClientId([string]$Raw) {
    $v = Get-UrlParam $Raw "client"
    if ($v -and $v -match '^[A-Za-z0-9-]{8,64}$') { return $v }
    return $null
}

function Test-StartUrl([string]$Raw) {
    $s = ([string]$Raw).Trim().Trim('"').Trim("'")
    return ($s -match '(?i)^csxrayai://start')
}

function Test-PrepareUrl([string]$Raw) {
    $s = ([string]$Raw).Trim().Trim('"').Trim("'")
    return ($s -match '(?i)^csxrayai://prepare')
}

function Get-SbHeaders([string]$Prefer) {
    $h = @{
        apikey = $AnonKey
        Authorization = "Bearer $AnonKey"
        "Content-Type" = "application/json"
    }
    if ($Prefer) { $h.Prefer = $Prefer }
    return $h
}

function ConvertTo-RowList($Rows) {
    if ($null -eq $Rows) { return @() }
    if ($Rows -is [string]) { return @() }
    return @($Rows | Where-Object { $_ -and $_.id })
}

function Update-Job([string]$Id, [hashtable]$Patch) {
    $uri = "$SupabaseUrl/rest/v1/xray_ai_jobs?id=eq.$Id"
    $json = $Patch | ConvertTo-Json -Depth 30 -Compress
    # return=minimal has an empty body; Invoke-RestMethod treats that as a parse error.
    Invoke-WebRequest -Method Patch -Uri $uri -Headers (Get-SbHeaders "return=minimal") -Body $json -UseBasicParsing | Out-Null
}

# The status=eq.pending filter makes the claim atomic: only one PATCH can
# move a row out of pending, so a second worker never runs the same job.
function Get-ClaimedJob([string]$Id) {
    $uri = "$SupabaseUrl/rest/v1/xray_ai_jobs?id=eq.$Id&status=eq.pending&select=*"
    $body = @{ status = "running"; error = $null } | ConvertTo-Json -Compress
    # @() because a one-row result comes back as a bare object, and in
    # Windows PowerShell 5.1 a bare JSON object has no .Count.
    $rows = @(ConvertTo-RowList (Invoke-RestMethod -Method Patch -Uri $uri -Headers (Get-SbHeaders "return=representation") -Body $body))
    if ($rows.Count -gt 0) { return $rows[0] }
    return $null
}

function Get-PendingIds([string[]]$Clients) {
    $Clients = @($Clients | Where-Object { $_ })
    if ($Clients.Count -eq 0) { return @() }
    $since = (Get-Date).ToUniversalTime().AddMinutes(-$JobMaxAgeMinutes).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $list = ($Clients -join ",")
    $uri = "$SupabaseUrl/rest/v1/xray_ai_jobs?select=id&status=eq.pending" +
        "&created_at=gte.$since&payload->>client=in.($list)&order=created_at.asc&limit=10"
    $rows = @(ConvertTo-RowList (Invoke-RestMethod -Method Get -Uri $uri -Headers (Get-SbHeaders "")))
    return @($rows | ForEach-Object { [string]$_.id })
}

# Browsers on this PC that launched a worker. A launch that finds a worker
# already running only adds its client here; the running worker reads it.
function Add-KnownClient([string]$ClientId) {
    if (-not $ClientId) { return }
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        $lines = @()
        if (Test-Path -LiteralPath $ClientsPath) {
            $lines = @(Get-Content -LiteralPath $ClientsPath -ErrorAction SilentlyContinue |
                Where-Object { $_ -and $_ -ne $ClientId })
        }
        $lines = @($lines | Select-Object -Last 19) + $ClientId
        Set-Content -LiteralPath $ClientsPath -Value $lines -Encoding ASCII
    } catch {
        Write-ProtoLog "could not record client: $($_.Exception.Message)"
    }
}

function Get-KnownClients {
    if (-not (Test-Path -LiteralPath $ClientsPath)) { return @() }
    return @(Get-Content -LiteralPath $ClientsPath -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^[A-Za-z0-9-]{8,64}$' })
}

function Test-AiHealth {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$AiBase/health" -TimeoutSec 4
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
    } catch {
        return $false
    }
}

function Resolve-StartBat {
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add((Join-Path $Here "start-xray-ai.bat"))
    $homeFile = Join-Path $Here "xray-ai-home.txt"
    if (Test-Path -LiteralPath $homeFile) {
        # Not $home: that is PowerShell's read-only $HOME and assigning it throws.
        $aiHome = (Get-Content -LiteralPath $homeFile -TotalCount 1 -ErrorAction SilentlyContinue)
        if ($aiHome) { $aiHome = $aiHome.Trim().Trim('"') }
        if ($aiHome) { $candidates.Add((Join-Path $aiHome "start-xray-ai.bat")) }
    }
    $savedHome = Join-Path $env:LOCALAPPDATA "cs-xray-ai\xray-ai-home.txt"
    if (Test-Path -LiteralPath $savedHome) {
        $aiHome = (Get-Content -LiteralPath $savedHome -TotalCount 1 -ErrorAction SilentlyContinue)
        if ($aiHome) { $aiHome = $aiHome.Trim().Trim('"') }
        if ($aiHome) { $candidates.Add((Join-Path $aiHome "start-xray-ai.bat")) }
    }
    $parent = Split-Path -Parent $Here
    if ($parent) {
        $candidates.Add((Join-Path $parent "start-xray-ai.bat"))
        $grand = Split-Path -Parent $parent
        if ($grand) { $candidates.Add((Join-Path $grand "start-xray-ai.bat")) }
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Resolve-PrepareBat {
    $start = Resolve-StartBat
    if (-not $start) { return $null }
    $prep = Join-Path (Split-Path -Parent $start) "prepare-xray-ai.bat"
    if (Test-Path -LiteralPath $prep) { return $prep }
    return $null
}

function Wait-JobExists([string]$Id, [int]$Seconds) {
    if (-not $Id) { return $false }
    $deadline = (Get-Date).AddSeconds($Seconds)
    $uri = "$SupabaseUrl/rest/v1/xray_ai_jobs?id=eq.$Id&select=id"
    while ((Get-Date) -lt $deadline) {
        try {
            $rows = @(ConvertTo-RowList (Invoke-RestMethod -Method Get -Uri $uri -Headers (Get-SbHeaders "")))
            if ($rows.Count -gt 0) { return $true }
        } catch {
            Write-ProtoLog "prepare job lookup: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Read-LocalJson([string]$Path) {
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri "$AiBase$Path" -TimeoutSec 30
        $text = ([string]$resp.Content).Trim()
        if ($text.StartsWith("{")) { return $text }
    } catch {}
    return "null"
}

# Runs install, protocol registration, and (only if needed) the AI service.
# The page inserts the checklist row as status=running so a worker that is
# already up does not claim it and answer before the installer finishes.
function Invoke-Prepare([string]$RawUrl) {
    $jobId = Get-JobId $RawUrl
    $clientId = Get-ClientId $RawUrl
    Add-KnownClient $clientId
    if ($jobId) {
        Write-ProtoLog "prepare waiting for checklist row $jobId"
        [void](Wait-JobExists $jobId 45)
    }
    $bat = Resolve-PrepareBat
    if (-not $bat) {
        Write-ProtoLog "prepare-xray-ai.bat not found"
        if ($jobId) {
            try { Update-Job $jobId @{ status = "error"; error = "prepare-xray-ai.bat not found" } } catch {}
        }
        return
    }
    Write-ProtoLog "prepare $bat"
    $arg = '/c "' + $bat + '" nopause'
    $proc = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList $arg -WorkingDirectory (Split-Path -Parent $bat) -WindowStyle Normal -PassThru -Wait
    $exitCode = 1
    if ($proc) { $exitCode = [int]$proc.ExitCode }
    Write-ProtoLog "prepare bat exit $exitCode"

    $installExit = $exitCode
    $registerExit = 1
    $service = "down"
    $statusPath = Join-Path $LogDir "prepare-status.json"
    if (Test-Path -LiteralPath $statusPath) {
        try {
            $meta = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $meta.installExit) { $installExit = [int]$meta.installExit }
            if ($null -ne $meta.registerExit) { $registerExit = [int]$meta.registerExit }
            $svc = [string]$meta.service
            if ($svc -match '^(already|started|down)$') { $service = $svc }
        } catch {
            Write-ProtoLog "prepare status unreadable: $($_.Exception.Message)"
        }
    }
    if ($service -eq "started") { $script:AiStartRequested = $true }
    if (-not (Test-AiHealth)) { [void](Wait-AiHealth 180) }
    $health = Read-LocalJson "/health"
    $landmarks = Read-LocalJson "/ceph/landmarks"
    $cvm = Read-LocalJson "/ceph/cvm"
    $body = '{"installExit":' + $installExit + ',"registerExit":' + $registerExit + ',"service":"' + $service + '","health":' + $health + ',"landmarks":' + $landmarks + ',"cvm":' + $cvm + '}'
    if (-not $jobId) { return }
    try {
        Update-Job $jobId @{ status = "done"; result = @{ http_status = 200; body_json = $body }; error = $null }
        Write-ProtoLog "prepare checklist posted for $jobId"
    } catch {
        Write-ProtoLog "prepare checklist post failed: $($_.Exception.Message)"
        try { Update-Job $jobId @{ status = "error"; error = $_.Exception.Message } } catch {}
    }
}

# start-xray-ai.bat stops whatever service is already on 8877 before it
# starts, so it is only run when /health does not answer.
function Start-AiIfDown {
    if (Test-AiHealth) { return $true }
    $bat = Resolve-StartBat
    if ($bat) {
        Write-ProtoLog "starting $bat"
        Start-Process -FilePath $bat -WorkingDirectory (Split-Path -Parent $bat) | Out-Null
    } else {
        Write-ProtoLog "start-xray-ai.bat not found next to the launcher, via xray-ai-home.txt, or via %LOCALAPPDATA%\cs-xray-ai\xray-ai-home.txt"
    }
    return $false
}

$script:AiStartRequested = $false

function Wait-AiHealth([int]$Seconds) {
    if (Test-AiHealth) { return $true }
    if (-not $script:AiStartRequested) {
        $script:AiStartRequested = $true
        if (Start-AiIfDown) { return $true }
    }
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-AiHealth) { return $true }
    }
    return $false
}

function Invoke-LocalApi($Job) {
    $payload = $Job.payload
    $method = "GET"
    $path = "/health"
    if ($payload -and $payload.method) { $method = [string]$payload.method }
    if ($payload -and $payload.path) { $path = [string]$payload.path }
    if ($path -notmatch '^/') { $path = "/$path" }
    $url = "$AiBase$path"

    $imageUrl = [string]$Job.image_url
    $tmp = $null
    if ($imageUrl) {
        $tmp = Join-Path $env:TEMP ("cs-xray-ai-" + $Job.id + ".jpg")
        Invoke-WebRequest -UseBasicParsing -Uri $imageUrl -OutFile $tmp -TimeoutSec 60
    }
    $jsonBody = ""
    if ($payload -and $payload.json) { $jsonBody = [string]$payload.json }
    $jsonFile = $null

    if ($method -eq "GET" -and -not $tmp -and -not $jsonBody) {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 120
        return @{ http_status = [int]$resp.StatusCode; body_json = [string]$resp.Content }
    }

    $curl = Join-Path $env:SystemRoot "System32\curl.exe"
    if (-not (Test-Path $curl)) { throw "curl.exe is not available" }
    # Keep the response bytes as text. PowerShell's JSON parser collapses a
    # one-element array, which would drop a single finding on the way back.
    $curlArgs = @("-sS", "-m", "180", "-w", "`n%{http_code}", "-X", $method)
    if ($jsonBody -and -not $tmp) {
        $jsonFile = Join-Path $env:TEMP ("cs-xray-ai-" + $Job.id + "-body.json")
        $utf8Body = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($jsonFile, $jsonBody, $utf8Body)
        $curlArgs += @("-H", "Content-Type: application/json", "--data-binary", "@$jsonFile")
    }
    if ($tmp) {
        $curlArgs += @("-F", "file=@$tmp;type=image/jpeg;filename=xray.jpg")
    }
    # Form values (the finding JSON especially) contain quotes and can be
    # longer than the Windows command line. Curl reads each one from a file
    # so the verdict is not truncated into an unreadable field.
    $fieldFiles = @()
    if ($payload -and $payload.fields) {
        $utf8 = New-Object System.Text.UTF8Encoding $false
        foreach ($prop in @($payload.fields.PSObject.Properties)) {
            $safe = [regex]::Replace([string]$prop.Name, '[^A-Za-z0-9_-]', '_')
            $fieldPath = Join-Path $env:TEMP ("cs-xray-ai-" + $Job.id + "-" + $safe + ".txt")
            [System.IO.File]::WriteAllText($fieldPath, [string]$prop.Value, $utf8)
            $fieldFiles += $fieldPath
            $curlArgs += @("-F", ([string]$prop.Name + "=<" + $fieldPath))
        }
    }
    $curlArgs += $url
    $raw = & $curl @curlArgs
    if ($tmp) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
    if ($jsonFile) { Remove-Item -Force $jsonFile -ErrorAction SilentlyContinue }
    foreach ($fieldPath in $fieldFiles) {
        Remove-Item -Force $fieldPath -ErrorAction SilentlyContinue
    }
    # A native program's stdout arrives as one string per line. Casting that
    # array to [string] joins with spaces and glues the HTTP status onto the
    # JSON, which the page then cannot read (findings look empty).
    if ($null -eq $raw) { $text = "" }
    elseif ($raw -is [System.Array]) { $text = ($raw -join "`n") }
    else { $text = [string]$raw }
    $idx = $text.LastIndexOf("`n")
    $code = 0
    $doc = $text
    if ($idx -ge 0) {
        $doc = $text.Substring(0, $idx).Trim()
        $codeText = $text.Substring($idx + 1).Trim()
        [void][int]::TryParse($codeText, [ref]$code)
    }
    if (-not $code) { $code = 200 }
    return @{ http_status = $code; body_json = $doc }
}

function Invoke-ClaimedJob($Job) {
    $id = [string]$Job.id
    $path = ""
    if ($Job.payload -and $Job.payload.path) { $path = [string]$Job.payload.path }
    Write-ProtoLog "job $id $path"
    try {
        if (-not (Wait-AiHealth 180)) {
            throw "AI service did not answer on $AiBase/health"
        }
        $result = Invoke-LocalApi $Job
        Update-Job $id @{ status = "done"; result = $result; error = $null }
        Write-ProtoLog "job $id done HTTP $($result.http_status)"
    } catch {
        $msg = $_.Exception.Message
        Write-ProtoLog "job $id failed: $msg"
        try { Update-Job $id @{ status = "error"; error = $msg } } catch {}
    }
}

function Get-NextJob([string[]]$WantedIds) {
    foreach ($id in @($WantedIds)) {
        if (-not $id) { continue }
        $job = Get-ClaimedJob $id
        if ($job) { return $job }
    }
    foreach ($id in @(Get-PendingIds @(Get-KnownClients))) {
        $job = Get-ClaimedJob $id
        if ($job) { return $job }
    }
    return $null
}

function Invoke-Worker([string]$FirstJobId) {
    $wanted = @()
    if ($FirstJobId) { $wanted += $FirstJobId }
    $wantedUntil = (Get-Date).AddSeconds($WantedIdSeconds)
    $lastWork = Get-Date
    Write-ProtoLog "worker up"
    while ($true) {
        if ($wanted.Count -gt 0 -and (Get-Date) -gt $wantedUntil) { $wanted = @() }
        $job = $null
        try {
            $job = Get-NextJob $wanted
        } catch {
            Write-ProtoLog "poll failed: $($_.Exception.Message)"
            Start-Sleep -Seconds 3
        }
        if ($job) {
            $wanted = @($wanted | Where-Object { $_ -ne [string]$job.id })
            Invoke-ClaimedJob $job
            $lastWork = Get-Date
            continue
        }
        if (((Get-Date) - $lastWork).TotalSeconds -ge $IdleExitSeconds) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    }
    Write-ProtoLog "worker idle, exiting"
}

if ($SelfTest) {
    $id = Get-JobId 'csxrayai://job?id=00000000-0000-4000-8000-000000000001'
    if ($id -ne "00000000-0000-4000-8000-000000000001") { throw "parse failed: $id" }
    $quoted = Get-JobId '"csxrayai://job?id=00000000-0000-4000-8000-000000000002"'
    if (-not $quoted) { throw "quoted parse failed" }
    if (Get-JobId "csxrayai://start") { throw "start URL must not look like a job" }
    $both = 'csxrayai://job?id=00000000-0000-4000-8000-000000000003&client=11111111-2222-4333-8444-555555555555'
    if ((Get-JobId $both) -ne "00000000-0000-4000-8000-000000000003") { throw "id with client failed" }
    if ((Get-ClientId $both) -ne "11111111-2222-4333-8444-555555555555") { throw "client parse failed" }
    if (Get-JobId 'csxrayai://job?client=11111111-2222-4333-8444-555555555555') { throw "wake URL must not carry a job id" }
    if (Get-ClientId 'csxrayai://job?client=bad;id') { throw "client must be a plain token" }
    if (-not (Test-StartUrl '"csxrayai://start"')) { throw "start URL not recognised" }
    if (Test-StartUrl $both) { throw "job URL must not look like start" }
    $prep = 'csxrayai://prepare?id=00000000-0000-4000-8000-000000000004&client=11111111-2222-4333-8444-555555555555'
    if (-not (Test-PrepareUrl $prep)) { throw "prepare URL not recognised" }
    if (Test-StartUrl $prep) { throw "prepare URL must not look like start" }
    if (Test-PrepareUrl $both) { throw "job URL must not look like prepare" }
    if ((Get-JobId $prep) -ne "00000000-0000-4000-8000-000000000004") { throw "prepare job id failed" }
    if ((Get-ClientId $prep) -ne "11111111-2222-4333-8444-555555555555") { throw "prepare client failed" }
    Write-Output "protocol self-test ok"
    exit 0
}

if (Test-PrepareUrl $Url) {
    $prepClient = Get-ClientId $Url
    try { Invoke-Prepare $Url } catch { Write-ProtoLog "prepare failed: $($_.Exception.Message)" }
    # The checklist row is already done. Stay up as the normal job worker
    # without trying to claim that row again.
    if ($prepClient) { $Url = "csxrayai://job?client=$prepClient" }
}

if (Test-StartUrl $Url) {
    [void](Start-AiIfDown)
    exit 0
}

$jobId = Get-JobId $Url
$clientId = Get-ClientId $Url
if (-not $jobId -and -not $clientId) {
    Write-ProtoLog "not a job URL, ignored: $Url"
    exit 0
}
Add-KnownClient $clientId

$mutex = New-Object System.Threading.Mutex($false, $MutexName)
$owned = $false
try {
    # A worker that is about to idle out releases the mutex within a poll
    # cycle, so waiting a little lets this launch take over instead of
    # leaving the new row unclaimed.
    $owned = $mutex.WaitOne(20000)
} catch [System.Threading.AbandonedMutexException] {
    $owned = $true
}
if (-not $owned) {
    Write-ProtoLog "worker already running; it will pick up job $jobId"
    $mutex.Dispose()
    exit 0
}

try {
    Invoke-Worker $jobId
    exit 0
} catch {
    Write-ProtoLog "worker failed: $($_.Exception.Message)"
    if ($jobId) {
        try { Update-Job $jobId @{ status = "error"; error = $_.Exception.Message } } catch {}
    }
    exit 1
} finally {
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
}
