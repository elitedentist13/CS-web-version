# ============================================================================
#  check-ascii-bat.ps1 -- fail if any tracked/staged .bat or .cmd file
#  contains a non-ASCII byte (e.g. an em-dash "-", curly quotes).
#
#  Why this exists: cmd.exe decodes .bat/.cmd files using the PC's active
#  OEM/ANSI code page (via chcp), not UTF-8. A file saved with a UTF-8
#  em-dash reads back as garbage on a non-Western code page (e.g. 950 /
#  Traditional Chinese Big5), which corrupts cmd's parser and cascades into
#  "'X' is not recognized as an internal or external command" errors on
#  clinic PCs -- even though the exact same file runs perfectly on a
#  Western-code-page dev machine. Keep every .bat/.cmd file strictly
#  ASCII-only (use "-" instead of "-", straight quotes instead of curly
#  ones) so behaviour never depends on the code page of the PC running it.
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-ascii-bat.ps1            (check all tracked .bat/.cmd)
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-ascii-bat.ps1 -Staged     (check only staged files, for pre-commit)
#
#  Exit code 0 = clean, 1 = non-ASCII bytes found (details printed).
# ============================================================================
param(
    [switch]$Staged
)

$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    Write-Error "Not inside a git repository."
    exit 1
}
Set-Location $repoRoot

if ($Staged) {
    $files = git diff --cached --name-only --diff-filter=ACM -- "*.bat" "*.cmd"
} else {
    $files = git ls-files -- "*.bat" "*.cmd"
}

if (-not $files) {
    Write-Output "[ascii-guard] No .bat/.cmd files to check. OK."
    exit 0
}

$failed = $false

foreach ($rel in $files) {
    $full = Join-Path $repoRoot $rel
    if (-not (Test-Path $full)) { continue }   # staged-but-deleted files

    $bytes = [System.IO.File]::ReadAllBytes($full)
    $lineNum = 1
    $col = 0
    $hits = New-Object System.Collections.Generic.List[string]

    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $b = $bytes[$i]
        if ($b -eq 0x0A) { $lineNum++; $col = 0; continue }
        $col++
        if ($b -ge 0x80) {
            $hits.Add("line $lineNum, col $col (byte 0x{0:X2})" -f $b)
        }
    }

    if ($hits.Count -gt 0) {
        $failed = $true
        Write-Output ""
        Write-Output "[ascii-guard] FAIL: $rel has $($hits.Count) non-ASCII byte(s):"
        foreach ($h in ($hits | Select-Object -First 5)) {
            Write-Output "    $h"
        }
        if ($hits.Count -gt 5) {
            Write-Output "    ... and $($hits.Count - 5) more"
        }
    }
}

if ($failed) {
    Write-Output ""
    Write-Output "[ascii-guard] One or more .bat/.cmd files contain non-ASCII characters."
    Write-Output "              Replace them with plain ASCII (e.g. '-' instead of an em-dash,"
    Write-Output "              straight quotes instead of curly ones) -- see the comment at"
    Write-Output "              the top of tools\check-ascii-bat.ps1 for why this matters."
    exit 1
}

Write-Output "[ascii-guard] All .bat/.cmd files are ASCII-only. OK."
exit 0
