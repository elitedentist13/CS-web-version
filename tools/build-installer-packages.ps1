# tools/build-installer-packages.ps1
# Joyful Smile / Banana Clinic Manager — assembles the dedicated,
# single-system installer packages from the one canonical engine source
# (xray-local-launcher.ps1 / install-xray-bridge.ps1 in this folder), and
# zips each into a standalone file ready to copy to a clinic PC.
#
# Why a build step instead of hand-maintaining two copies: xray-local-
# launcher.ps1 is genuinely shared code (routing, patient-context parsing,
# self-tests, etc.) across every imaging system it supports -- forking it
# into two independent files would mean every future bug fix has to be
# applied twice and could silently drift out of sync. Editing happens in
# exactly one place (this folder); this script is what turns that one
# source into the two folders/zips that actually get handed to clinic PCs,
# each restricted at runtime via -EnabledSystems so they never answer for
# the other system even though the underlying script is byte-for-byte
# identical.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File build-installer-packages.ps1
#
# Verifies each package by extracting its zip to a clean temp folder and
# running -SelfTest from there -- fails fast (non-zero exit) if a package
# isn't actually self-sufficient.

$ErrorActionPreference = "Stop"
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Err2($msg) { Write-Host "    ERROR: $msg" -ForegroundColor Red }

# Catches genuine syntax errors -- including the "parses fine here but not
# under this clinic PC's locale/codepage" class of bug found live
# 2026-08-27 (missing UTF-8 BOM on a file with non-ASCII characters) --
# without executing a single line of the file. Cheap enough to run on every
# shared file on every build, not just ones that happen to have a -SelfTest.
function Test-ScriptParses($Path) {
    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)
    return ($null -eq $parseErrors -or $parseErrors.Count -eq 0)
}

# key = subfolder name; sharedFiles are copied in from $toolsDir on every
# build (kept in sync automatically); ownFiles already live in the
# subfolder (the .bat wrappers + its own README.md) and are left alone.
$Packages = @(
    [ordered]@{
        name = "EzDenti"
        folder = "installer-ezdenti"
        zipName = "Banana-EzDenti-Bridge-Installer.zip"
        sharedFiles = @("xray-local-launcher.ps1", "install-xray-bridge.ps1", "xray-bridge-auto-update.ps1")
    },
    [ordered]@{
        name = "NNT-NEWTOM"
        folder = "installer-nntnewtom"
        zipName = "Banana-NNT-Bridge-Installer.zip"
        sharedFiles = @("xray-local-launcher.ps1", "install-xray-bridge.ps1", "xray-bridge-auto-update.ps1", "_nnt_identity_guard.ps1", "_nnt_new_opg_watcher.ps1")
    },
    [ordered]@{
        name = "Rayscan"
        folder = "installer-rayscan"
        zipName = "Banana-Rayscan-Bridge-Installer.zip"
        sharedFiles = @("xray-local-launcher.ps1", "install-xray-bridge.ps1", "xray-bridge-auto-update.ps1")
    },
    [ordered]@{
        name = "MyRay"
        folder = "installer-myray"
        zipName = "Banana-MyRay-Bridge-Installer.zip"
        sharedFiles = @("xray-local-launcher.ps1", "install-xray-bridge.ps1", "xray-bridge-auto-update.ps1", "_nnt_identity_guard.ps1", "_nnt_new_opg_watcher.ps1")
    },
    [ordered]@{
        name = "Digirex"
        folder = "installer-digirex"
        zipName = "Banana-Digirex-Bridge-Installer.zip"
        sharedFiles = @("xray-local-launcher.ps1", "install-xray-bridge.ps1", "xray-bridge-auto-update.ps1")
    },
    [ordered]@{
        name = "Ai-Dental"
        folder = "installer-aidental"
        zipName = "Banana-AiDental-Bridge-Installer.zip"
        sharedFiles = @("xray-local-launcher.ps1", "install-xray-bridge.ps1", "xray-bridge-auto-update.ps1")
    }
)

$failed = $false

foreach ($pkg in $Packages) {
    Write-Step "Building $($pkg.name) package ($($pkg.folder))"
    $pkgDir = Join-Path $toolsDir $pkg.folder
    if (-not (Test-Path -LiteralPath $pkgDir)) {
        Write-Err2 "Missing folder: $pkgDir"
        $failed = $true
        continue
    }

    foreach ($f in $pkg.sharedFiles) {
        $src = Join-Path $toolsDir $f
        if (-not (Test-Path -LiteralPath $src)) {
            Write-Err2 "Canonical source missing, cannot sync: $src"
            $failed = $true
            continue
        }
        if ($f -like '*.ps1' -and -not (Test-ScriptParses $src)) {
            Write-Err2 "Canonical source has a syntax error, refusing to sync: $src"
            $failed = $true
            continue
        }
        Copy-Item -LiteralPath $src -Destination (Join-Path $pkgDir $f) -Force
    }
    Write-Ok "Synced $($pkg.sharedFiles.Count) shared file(s) from tools\ into $($pkg.folder)\"

    $missingOwn = @("README.md") | Where-Object { -not (Test-Path -LiteralPath (Join-Path $pkgDir $_)) }
    if ($missingOwn) {
        Write-Err2 "Package-specific file(s) missing from $($pkg.folder): $($missingOwn -join ', ')"
        $failed = $true
        continue
    }

    $zipPath = Join-Path $toolsDir $pkg.zipName
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $pkgDir "*") -DestinationPath $zipPath
    Write-Ok "Zipped: $zipPath ($([math]::Round((Get-Item $zipPath).Length/1KB,1)) KB)"

    Write-Host "    Verifying package is self-sufficient (extract clean + -SelfTest)..."
    $verifyDir = Join-Path $env:TEMP ("banana-xray-verify-" + $pkg.folder + "-" + [Guid]::NewGuid().ToString("N"))
    try {
        Expand-Archive -Path $zipPath -DestinationPath $verifyDir
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $verifyDir "xray-local-launcher.ps1") -SelfTest | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Self-test passed from a clean extraction (no dependency on anything outside the zip)."
        } else {
            Write-Err2 "Self-test FAILED from a clean extraction (exit code $LASTEXITCODE) -- this package is not actually self-sufficient."
            $failed = $true
        }

        # xray-bridge-auto-update.ps1 has no -SelfTest mode of its own (it
        # always tries to reach the network) -- a post-extraction parse
        # check is the equivalent "did this actually make it into the zip
        # intact" guarantee for it.
        $updaterInZip = Join-Path $verifyDir "xray-bridge-auto-update.ps1"
        if (Test-Path -LiteralPath $updaterInZip) {
            if (Test-ScriptParses $updaterInZip) {
                Write-Ok "xray-bridge-auto-update.ps1 present and parses cleanly from a clean extraction."
            } else {
                Write-Err2 "xray-bridge-auto-update.ps1 failed to parse from a clean extraction -- auto-update would be broken on this package."
                $failed = $true
            }
        }
    } finally {
        Remove-Item -LiteralPath $verifyDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
if ($failed) {
    Write-Err2 "One or more packages failed to build/verify -- see above."
    exit 1
}
Write-Host "All installer packages built and verified." -ForegroundColor Green
foreach ($pkg in $Packages) {
    Write-Host "  $($pkg.zipName)  ->  copy to a clinic PC and extract, or hand over the $($pkg.folder)\ folder directly."
}
