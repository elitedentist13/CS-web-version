# tools/_nnt_identity_guard.ps1
# Safety net for the NNT/NEWTOM launch path in xray-local-launcher.ps1.
#
# Discovered 2026-08-19 while trialling a batch screen-capture pipeline for
# population-B (NNT-proprietary-only) patients: NNT's own internal patient
# database is NOT reliably in sync with Supabase/CS for a large fraction of
# chart numbers. /PATID <chart> matches whatever identity NNT itself has
# stored under that numeric ID -- for many older charts that's a
# completely different, unrelated person (confirmed on a random sample:
# 5 of 6 chart numbers opened showed the WRONG patient's name/DOB inside
# NNT, one even popping NNT's own "Patient record UPDATE?" conflict
# dialog). This is a live patient-misidentification risk, not just a
# batch-script bug -- it affects the "NNT / NEWTOM" button in Banana's
# X-ray tab for any chart where NNT's stale record disagrees with Banana.
#
# This script runs in the background (spawned by Handle-Request right
# after Start-NntBridgePatient, non-blocking) and:
#   1. Waits for the NNT window to appear.
#   2. Reads the patient name NNT itself is displaying, straight out of
#      its own window title (e.g. "NNT - Patient name: 王芯盈 WONG SHUM
#      YING - Birthdate: ... - SSN/Fiscal code: ...").
#   3. Compares it against the patient Banana asked to open.
#   4. If there is zero name overlap (i.e. NNT is very likely showing an
#      unrelated person), pops a blocking Windows warning dialog on the
#      clinic PC so staff catch it immediately, before treating whatever
#      is on screen as that patient's real OPG.
#
# This does NOT fix the underlying identity-matching problem (that needs
# either a real /PATID data-integrity audit or replicating CS's "VDDS
# PATDATIMPORT" sync step, now decoded -- see CHANGELOG.md 2026-08-19
# "Decoded CS's -VDDS PATDATIMPORT sync file format" -- but deliberately
# NOT wired in yet: it would auto-overwrite NNT's own database on every
# launch, which is dangerous given known Supabase patient_no collisions)
# -- it only makes sure a mismatch can never silently pass as "the right
# patient's X-ray".
#
# Every run (real, non-self-test) appends one line to a local JSONL log
# next to this script (so it lands in C:\NNT in production) recording the
# outcome -- match / mismatch_dialog / mismatch_title / undetermined --
# so real-world hit rate can be audited later instead of just trusting a
# silent pass/warn in the moment. See _summarize_identity_guard_log.py.
#
# Self-test (pure comparison logic only, no real NNT/process access):
#     powershell -File _nnt_identity_guard.ps1 -SelfTest
param(
    [string]$ExpectedName = "",
    [string]$ExpectedChineseName = "",
    [string]$ChartNo = "",
    [int]$TimeoutSec = 20,
    [switch]$SelfTest
)

$script:LogPath = Join-Path $PSScriptRoot "_nnt_identity_guard_log.jsonl"

function Write-GuardLog([string]$Outcome, [string]$FoundRaw = "") {
    try {
        $entry = [ordered]@{
            timestamp             = (Get-Date).ToString("o")
            chart_no              = $ChartNo
            expected_name         = $ExpectedName
            expected_chinese_name = $ExpectedChineseName
            outcome               = $Outcome
            found_raw             = $FoundRaw
        }
        ($entry | ConvertTo-Json -Compress) | Add-Content -LiteralPath $script:LogPath -Encoding UTF8
    } catch {}
}

function Normalize-NameWords([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    $upper = $Value.ToUpperInvariant()
    $clean = ($upper -replace '[^A-Z0-9\s]', ' ')
    $words = ($clean -split '\s+') | Where-Object { $_.Length -ge 2 }
    return @($words)
}

function Get-EnglishPortion([string]$RawTitleName) {
    if ([string]::IsNullOrWhiteSpace($RawTitleName)) { return "" }
    # Titles are typically "<Chinese chars><space><ENGLISH NAME>" -- strip
    # any leading run of non-ASCII characters, keep the rest.
    $stripped = ($RawTitleName -replace '^[^\x00-\x7F]+\s*', '').Trim()
    if ($stripped) { return $stripped }
    return $RawTitleName.Trim()
}

# Returns $true when the two names are consistent enough to trust (share
# at least one real word, or the Chinese name matches), $false when they
# look like two unrelated people.
function Test-NntNameConsistent([string]$Expected, [string]$ExpectedChinese, [string]$FoundRaw) {
    $foundEnglish = Get-EnglishPortion $FoundRaw
    $expectedWords = Normalize-NameWords $Expected
    $foundWords = Normalize-NameWords $foundEnglish

    if ($expectedWords.Count -eq 0 -or $foundWords.Count -eq 0) {
        # Can't meaningfully compare -- don't block on missing data.
        return $true
    }

    $overlap = @($expectedWords | Where-Object { $foundWords -contains $_ })
    if ($overlap.Count -gt 0) { return $true }

    if ($ExpectedChinese -and $FoundRaw -and $FoundRaw.Contains($ExpectedChinese)) {
        return $true
    }

    return $false
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

    Write-Host "== Get-EnglishPortion ==" -ForegroundColor Cyan
    Assert-Eq "Chinese + English title fragment" "WONG SHUM YING" (Get-EnglishPortion "王芯盈 WONG SHUM YING")
    Assert-Eq "English only" "LEUNG KIN WAH" (Get-EnglishPortion "LEUNG KIN WAH")
    Assert-Eq "Empty stays empty" "" (Get-EnglishPortion "")

    Write-Host "== Test-NntNameConsistent (the real safety check) ==" -ForegroundColor Cyan
    Assert-Eq "Exact match"        $true  (Test-NntNameConsistent "WONG SHUM YING" "" "王芯盈 WONG SHUM YING")
    Assert-Eq "Real mismatch (000006 case)" $false (Test-NntNameConsistent "JESSICA WATSON LYNN" "" "葉俊邦 YIP CHUN PONG")
    Assert-Eq "Real mismatch (000010 case)" $false (Test-NntNameConsistent "LUI MING FUNG MELVIN" "" "ERNAWATI")
    Assert-Eq "Real mismatch (000011 case)" $false (Test-NntNameConsistent "LOU NGAI FONG VIVIANA" "" "關月娥 KWAN YUET NGOR")
    Assert-Eq "Partial name overlap still OK" $true (Test-NntNameConsistent "LEUNG KIN WAH" "" "梁健華 LEUNG KIN WAH")
    Assert-Eq "Chinese name matches even if English differs" $true (Test-NntNameConsistent "SOME OTHER SPELLING" "王芯盈" "王芯盈 WONG SHUM YING")
    Assert-Eq "No expected name -- do not block" $true (Test-NntNameConsistent "" "" "ANYONE AT ALL")
    Assert-Eq "No found name -- do not block" $true (Test-NntNameConsistent "SOMEONE" "" "")

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

function Show-MismatchWarning([string]$MessageBody) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $MessageBody,
        "Banana X-Ray Launcher -- Patient Mismatch Warning",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
}

# Detects NNT's own "Patient record UPDATE?" conflict dialog (a distinct
# UI Automation Window element by that exact name) -- this pops up
# whenever the /NAME, /DATEB, /SEX we sent disagree with what NNT already
# has stored for that chart number, i.e. direct, first-party evidence of
# an identity mismatch, even before the main window title ever updates.
function Test-NntUpdateDialogPresent($Hwnd) {
    try {
        Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
        Add-Type -AssemblyName UIAutomationTypes -ErrorAction SilentlyContinue
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($Hwnd)
        $cond = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, "Patient record UPDATE?")
        $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        return [bool]$el
    } catch {
        return $false
    }
}

# ── Real (non-test) run: wait for NNT, watch for either signal, warn ──
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$proc = $null
$resolved = $false
while ((Get-Date) -lt $deadline) {
    $proc = Get-Process -Name "NNT" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
    if (-not $proc) {
        Start-Sleep -Milliseconds 500
        continue
    }

    if (Test-NntUpdateDialogPresent $proc.MainWindowHandle) {
        $expectedDisplay = $ExpectedName
        if ($ExpectedChineseName) { $expectedDisplay = "$ExpectedName ($ExpectedChineseName)" }
        Show-MismatchWarning (
            "NNT flagged a PATIENT RECORD CONFLICT for this chart number.`n`n" +
            "Banana asked to open: $expectedDisplay`n`n" +
            "NNT's own 'Patient record UPDATE?' dialog is on screen -- its saved " +
            "name/birthdate/sex for this chart number does not match what Banana " +
            "sent. This chart number very likely belongs to a DIFFERENT person in " +
            "NNT's own records.`n`nDo NOT click Accept/Reject on that dialog " +
            "assuming it's for the intended patient -- check the 'Previous data' " +
            "column against the intended patient first, and verify the chart " +
            "number in CS before proceeding."
        )
        Write-GuardLog "mismatch_dialog"
        $resolved = $true
        break
    }

    if ($proc.MainWindowTitle) {
        $m = [regex]::Match($proc.MainWindowTitle, 'Patient name:\s*(.*?)\s*-\s*Birthdate')
        if ($m.Success) {
            $foundRaw = $m.Groups[1].Value.Trim()
            if (Test-NntNameConsistent $ExpectedName $ExpectedChineseName $foundRaw) {
                Write-GuardLog "match" $foundRaw
            } else {
                $expectedDisplay = $ExpectedName
                if ($ExpectedChineseName) { $expectedDisplay = "$ExpectedName ($ExpectedChineseName)" }
                Show-MismatchWarning (
                    "NNT is showing a DIFFERENT patient than Banana requested.`n`n" +
                    "Banana asked for: $expectedDisplay`n" +
                    "NNT is displaying: $foundRaw`n`n" +
                    "This is very likely the WRONG patient's record/X-ray. Do not " +
                    "treat what is on screen as belonging to the intended patient. " +
                    "Close NNT and double-check the chart number in CS."
                )
                Write-GuardLog "mismatch_title" $foundRaw
            }
            $resolved = $true
            break
        }
    }

    Start-Sleep -Milliseconds 500
}

if (-not $resolved) {
    if ($proc) {
        Write-GuardLog "undetermined_no_title_signal"
    } else {
        Write-GuardLog "undetermined_no_window"
    }
}
