# Joyful Smile / Banana — csxrayai:// handler.
#
# Chrome's local-network check blocks a hosted clinic page from calling
# http://127.0.0.1:8877. The page only opens csxrayai://job?id=<uuid>.
# This process talks to the AI service on loopback and writes the JSON
# result back to the xray_ai_jobs row the page is waiting on.
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

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $env:LOCALAPPDATA "cs-xray-ai"
$LogPath = Join-Path $LogDir "protocol.log"

function Write-ProtoLog([string]$Message) {
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
        Add-Content -Path $LogPath -Value $line -Encoding UTF8
    } catch {}
}

function Get-JobId([string]$Raw) {
    $s = [string]$Raw
    if (-not $s) { return $null }
    $s = $s.Trim().Trim('"').Trim("'")
    if ($s -match '(?i)[?&]id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
        return $Matches[1].ToLower()
    }
    return $null
}

function Get-SbHeaders {
    return @{
        apikey = $AnonKey
        Authorization = "Bearer $AnonKey"
        "Content-Type" = "application/json"
        Prefer = "return=minimal"
    }
}

function Update-Job([string]$Id, [hashtable]$Patch) {
    $uri = "$SupabaseUrl/rest/v1/xray_ai_jobs?id=eq.$Id"
    $json = $Patch | ConvertTo-Json -Depth 30 -Compress
    # return=minimal has an empty body; Invoke-RestMethod treats that as a parse error.
    Invoke-WebRequest -Method Patch -Uri $uri -Headers (Get-SbHeaders) -Body $json -UseBasicParsing | Out-Null
}

function Get-Job([string]$Id) {
    $uri = "$SupabaseUrl/rest/v1/xray_ai_jobs?id=eq.$Id&select=*"
    $headers = Get-SbHeaders
    $headers.Remove("Prefer")
    $rows = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
    if ($rows -is [System.Array]) {
        if ($rows.Count -lt 1) { return $null }
        return $rows[0]
    }
    return $rows
}

function Test-AiHealth {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8877/health" -TimeoutSec 4
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
        $home = (Get-Content -LiteralPath $homeFile -TotalCount 1 -ErrorAction SilentlyContinue)
        if ($home) { $home = $home.Trim().Trim('"') }
        if ($home) { $candidates.Add((Join-Path $home "start-xray-ai.bat")) }
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

function Wait-AiHealth([int]$Seconds) {
    if (Test-AiHealth) { return $true }
    $bat = Resolve-StartBat
    if ($bat) {
        Write-ProtoLog "starting $bat"
        Start-Process -FilePath $bat -WorkingDirectory (Split-Path -Parent $bat) | Out-Null
    } else {
        Write-ProtoLog "start-xray-ai.bat not found next to the launcher or via xray-ai-home.txt"
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
    $url = "http://127.0.0.1:8877$path"

    $imageUrl = [string]$Job.image_url
    $tmp = $null
    if ($imageUrl) {
        $tmp = Join-Path $env:TEMP ("cs-xray-ai-" + $Job.id + ".jpg")
        Invoke-WebRequest -UseBasicParsing -Uri $imageUrl -OutFile $tmp -TimeoutSec 60
    }

    if ($method -eq "GET" -and -not $tmp) {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 120
        return @{ http_status = [int]$resp.StatusCode; body_json = [string]$resp.Content }
    }

    $curl = Join-Path $env:SystemRoot "System32\curl.exe"
    if (-not (Test-Path $curl)) { throw "curl.exe is not available" }
    # Keep the response bytes as text. PowerShell's JSON parser collapses a
    # one-element array, which would drop a single finding on the way back.
    $curlArgs = @("-sS", "-m", "180", "-w", "`n%{http_code}", "-X", $method)
    if ($tmp) {
        $curlArgs += @("-F", "file=@$tmp;type=image/jpeg;filename=xray.jpg")
    }
    if ($payload -and $payload.fields) {
        $payload.fields.PSObject.Properties | ForEach-Object {
            $curlArgs += @("-F", ("{0}={1}" -f $_.Name, $_.Value))
        }
    }
    $curlArgs += $url
    $raw = & $curl @curlArgs
    if ($tmp) { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
    $text = [string]$raw
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

function Invoke-Job([string]$Id) {
    Write-ProtoLog "job $Id"
    $job = $null
    for ($i = 0; $i -lt 8; $i++) {
        $job = Get-Job $Id
        if ($job) { break }
        Start-Sleep -Milliseconds 400
    }
    if (-not $job) { throw "job $Id was not found in xray_ai_jobs" }
    Update-Job $Id @{ status = "running"; error = $null }
    if (-not (Wait-AiHealth 180)) {
        throw "AI service did not answer on http://127.0.0.1:8877/health"
    }
    $result = Invoke-LocalApi $job
    Update-Job $Id @{ status = "done"; result = $result; error = $null }
    Write-ProtoLog "job $Id done HTTP $($result.http_status)"
}

if ($SelfTest) {
    $id = Get-JobId 'csxrayai://job?id=00000000-0000-4000-8000-000000000001'
    if ($id -ne "00000000-0000-4000-8000-000000000001") { throw "parse failed: $id" }
    $quoted = Get-JobId '"csxrayai://job?id=00000000-0000-4000-8000-000000000002"'
    if (-not $quoted) { throw "quoted parse failed" }
    if (Get-JobId "csxrayai://start") { throw "start URL must not look like a job" }
    Write-Output "protocol self-test ok"
    exit 0
}

$jobId = Get-JobId $Url
if (-not $jobId) {
    Write-ProtoLog "not a job URL, ignored by ps1: $Url"
    exit 0
}

try {
    Invoke-Job $jobId
    exit 0
} catch {
    $msg = $_.Exception.Message
    Write-ProtoLog "job $jobId failed: $msg"
    try { Update-Job $jobId @{ status = "error"; error = $msg } } catch {}
    exit 1
}
