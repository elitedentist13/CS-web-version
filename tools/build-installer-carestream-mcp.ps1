# Sync canonical bridge files into installer-carestream-mcp and zip for deployment.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File build-installer-carestream-mcp.ps1

$ErrorActionPreference = "Stop"
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgDir = Join-Path $toolsDir "installer-carestream-mcp"
$zipName = "Banana-Carestream-MCP-Bridge-Installer.zip"
$zipPath = Join-Path $toolsDir $zipName

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Err2($msg) { Write-Host "    ERROR: $msg" -ForegroundColor Red }

$sharedFiles = @("xray-local-launcher.ps1", "install-xray-bridge.ps1")

Write-Step "Syncing canonical files into installer-carestream-mcp\"
foreach ($f in $sharedFiles) {
    $src = Join-Path $toolsDir $f
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Err2 "Missing source: $src"
        exit 1
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $pkgDir $f) -Force
    # Windows PowerShell 5.1 requires UTF-8 BOM for scripts containing non-ASCII self-test strings.
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    $text = [System.IO.File]::ReadAllText((Join-Path $pkgDir $f))
    [System.IO.File]::WriteAllText((Join-Path $pkgDir $f), $text, $utf8Bom)
}
Write-Ok "Synced $($sharedFiles.Count) file(s)"

$required = @(
    "Install Carestream MCP Bridge.bat",
    "Uninstall Carestream MCP Bridge.bat",
    "Start Carestream MCP Launcher.bat",
    "Test Carestream MCP Launcher.bat",
    "install-carestream-mcp.ps1",
    "README.md",
    "DEPLOYMENT.md"
)
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $pkgDir $_)) })
if ($missing.Count -gt 0) {
    Write-Err2 "Package file(s) missing: $($missing -join ', ')"
    exit 1
}

Write-Step "Creating $zipName"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $pkgDir "*") -DestinationPath $zipPath
Write-Ok "Zipped: $zipPath ($([math]::Round((Get-Item $zipPath).Length/1KB, 1)) KB)"

Write-Host "    Verifying package (clean extract + -SelfTest)..."
$verifyDir = Join-Path $env:TEMP ("banana-carestream-verify-" + [Guid]::NewGuid().ToString("N"))
try {
    Expand-Archive -Path $zipPath -DestinationPath $verifyDir
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $verifyDir "xray-local-launcher.ps1") -SelfTest | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Err2 "Self-test FAILED (exit $LASTEXITCODE)"
        exit 1
    }
    Write-Ok "Self-test passed from clean extraction"
} finally {
    Remove-Item -LiteralPath $verifyDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Carestream MCP installer package ready:" -ForegroundColor Green
Write-Host "  $zipPath"
Write-Host "  Folder: $pkgDir"
exit 0
