# Canonical loopback ports for this clinic PC. Three services, three ports.
# Never reuse these for each other. 8765 is reserved for dental sensor software
# (RayView etc.) and must stay unused by Banana / the AI helper / the launcher.
#
#   5500  clinic web UI     start-banana-silent.ps1 (logon autostart) / start-server.bat
#   8123  clinic web fallback (when 5500 is down or reserved by Windows)
#   17890 X-ray software    start-xray-launcher.bat  (Carestream / Digirex / ...)
#   8877  X-ray AI helper   start-xray-ai.bat
#   8765  reserved          RayView / sensor bridges -- do not bind

$script:ClinicPorts = [ordered]@{
    App          = 5500
    AppFallback  = 8123
    XrayLauncher = 17890
    XrayAi       = 8877
    Reserved     = 8765
}

function Test-ClinicTcp([int]$Port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400)
        if ($ok -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
    } catch {}
    return $false
}

function Test-ClinicHttp([string]$Url) {
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
    } catch {
        return $false
    }
}

function Get-ClinicStackStatus {
    $appOk = Test-ClinicHttp 'http://127.0.0.1:5500/index.html'
    $appFb = Test-ClinicHttp 'http://127.0.0.1:8123/index.html'
    $launchOk = Test-ClinicHttp 'http://127.0.0.1:17890/status'
    $aiOk = Test-ClinicHttp 'http://127.0.0.1:8877/health'
    return [ordered]@{
        app            = $appOk
        appFallback    = $appFb
        xrayLauncher   = $launchOk
        xrayAi         = $aiOk
        appUrl         = $(if ($appOk) { 'http://127.0.0.1:5500/index.html' } elseif ($appFb) { 'http://127.0.0.1:8123/index.html' } else { $null })
    }
}

function Write-ClinicStackStatus {
    $s = Get-ClinicStackStatus
    Write-Host ""
    Write-Host "  Local clinic ports (do not overlap)"
    Write-Host "  -----------------------------------"
    Write-Host ("  {0,-28} :5500   {1}" -f "1) Clinic web UI", $(if ($s.app) { "UP" } elseif ($s.appFallback) { "down (using :8123 fallback)" } else { "down" }))
    Write-Host ("  {0,-28} :17890  {1}" -f "2) X-ray software launcher", $(if ($s.xrayLauncher) { "UP" } else { "down" }))
    Write-Host ("  {0,-28} :8877   {1}" -f "3) X-ray AI helper", $(if ($s.xrayAi) { "UP" } else { "down" }))
    if ($s.appFallback -and -not $s.app) {
        Write-Host ("  {0,-28} :8123   UP (fallback; prefer :5500)" -f "   Clinic web fallback")
    }
    Write-Host ("  {0,-28} :8765   reserved (RayView) -- never bind" -f "   Sensor software")
    Write-Host ""
    return $s
}
