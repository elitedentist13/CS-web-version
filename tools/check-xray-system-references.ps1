# tools/check-xray-system-references.ps1
# Ensures each X-ray installer package has its OWN independent handoff
# XML reference (not missing, not byte-identical across systems).
$ErrorActionPreference = "Stop"
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$packages = @(
    "installer-ezdenti",
    "installer-rayscan",
    "installer-nntnewtom",
    "installer-myray",
    "installer-digirex",
    "installer-carestream-mcp"
)
$hashes = @{}
$failed = $false
foreach ($pkg in $packages) {
    $path = Join-Path $toolsDir (Join-Path $pkg "reference\patient-handoff.reference.xml")
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host "MISSING  $pkg\reference\patient-handoff.reference.xml" -ForegroundColor Red
        $failed = $true
        continue
    }
    $text = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if ($text -notmatch 'BananaXrayHandoffReference') {
        Write-Host "INVALID  $pkg (missing BananaXrayHandoffReference root)" -ForegroundColor Red
        $failed = $true
        continue
    }
    if ($text -notmatch 'independent="true"') {
        Write-Host "INVALID  $pkg (missing independent=true)" -ForegroundColor Red
        $failed = $true
        continue
    }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($hashes.ContainsKey($hash)) {
        Write-Host "COLLISION  $pkg shares identical reference bytes with $($hashes[$hash]) — references must stay independent" -ForegroundColor Red
        $failed = $true
        continue
    }
    $hashes[$hash] = $pkg
    Write-Host "OK  $pkg\reference\patient-handoff.reference.xml" -ForegroundColor Green
}
if ($failed) { exit 1 }
Write-Host "All $($packages.Count) X-ray system XML references present and independent." -ForegroundColor Green
exit 0
