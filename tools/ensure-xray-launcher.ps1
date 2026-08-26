# Start the X-ray bridge if nothing is listening on port 17890.
param([int]$Port = 17890)

$scriptDir = $PSScriptRoot
$launcher = Join-Path $scriptDir "xray-local-launcher.ps1"
$config = Join-Path $scriptDir "xray-launcher-config.ps1"

function Test-LauncherUp {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/status" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

if (Test-LauncherUp) {
    Write-Host "X-Ray bridge already running on port $Port." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path -LiteralPath $launcher)) {
    Write-Host "[ERROR] Missing: $launcher" -ForegroundColor Red
    exit 1
}

Write-Host "Starting X-Ray bridge on port $Port ..." -ForegroundColor Cyan
$args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$launcher`"", "-Port", $Port)
if (Test-Path -LiteralPath $config) { $args += @("-Command", "& { . `"$config`"; & `"$launcher`" -Port $Port }") }

Start-Process powershell -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $launcher,
    "-Port", $Port
) -WindowStyle Normal

Start-Sleep -Seconds 2
if (Test-LauncherUp) {
    Write-Host "X-Ray bridge started: http://127.0.0.1:$Port/status" -ForegroundColor Green
    exit 0
}

Write-Host "[WARN] Bridge window opened but /status not ready yet — wait a few seconds." -ForegroundColor Yellow
exit 0
