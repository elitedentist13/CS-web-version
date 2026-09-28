# Joyful Smile / Banana — csxray:// handler for EzDent-i.
#
# Chrome's local-network permission blocks the page from calling
# http://127.0.0.1:17890. This script is registered as the csxray://
# protocol so the browser only has to open a link. Windows starts this
# process, which talks to the bridge on loopback itself (no browser
# permission) and asks it to open EzDent-i.
#
# EzDent-i only. Any other key is ignored so this first cut cannot
# launch a different imaging program by mistake.
#
#   powershell -File launch-csxray-protocol.ps1 -SelfTest
#   powershell -File launch-csxray-protocol.ps1 -DryRun "csxray://open/ezdenti?patient_no=PL001287"

param(
    [Parameter(Position = 0)]
    [string]$Url = "",
    [int]$Port = 17890,
    [switch]$DryRun,
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

function Convert-CsxrayUrl([string]$Raw) {
    $s = [string]$Raw
    if ($null -eq $s) { return $null }
    $s = $s.Trim().Trim('"').Trim("'")
    if (-not $s) { return $null }
    if ($s -match '^(?i)csxray:(?://)?open/([a-z0-9_-]+)/?(\?.*)?$') {
        $query = [string]$Matches[2]
        if ($query.StartsWith("?")) { $query = $query.Substring(1) }
        return @{
            key   = $Matches[1].ToLowerInvariant()
            query = $query
        }
    }
    return $null
}

function Get-EzdentiOpenUri([string]$Query, [int]$TargetPort) {
    $uri = "http://127.0.0.1:$TargetPort/open/ezdenti"
    if ($Query) { $uri += "?" + $Query }
    return $uri
}

function Write-ProtocolLog([string]$Line) {
    try {
        $path = Join-Path $env:TEMP "csxray-ezdenti-last.log"
        $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -LiteralPath $path -Value ("$stamp $Line") -Encoding ASCII
    } catch {}
}

function Show-ProtocolError([string]$Message) {
    Write-ProtocolLog ("ERROR " + $Message)
    if ($DryRun -or $SelfTest) { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            "EzDent-i",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
    } catch {
        Write-Host $Message
    }
}

function Test-BridgePort([int]$TargetPort) {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $wait = $client.BeginConnect("127.0.0.1", $TargetPort, $null, $null)
        $opened = $wait.AsyncWaitHandle.WaitOne(400, $false)
        if (-not $opened) { return $false }
        $client.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        if ($client) { $client.Close() }
    }
}

function Start-EzdentiBridgeProcess([int]$TargetPort) {
    $launcher = Join-Path $PSScriptRoot "xray-local-launcher.ps1"
    if (-not (Test-Path -LiteralPath $launcher)) {
        throw "xray-local-launcher.ps1 is not next to this handler ($PSScriptRoot). Re-run Install EzDent-i Bridge.bat."
    }
    $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$launcher`" -Port $TargetPort -EnabledSystems `"ezdenti`""
    Start-Process -FilePath "powershell.exe" -ArgumentList $arg -WindowStyle Minimized | Out-Null
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        if (Test-BridgePort $TargetPort) { return }
        Start-Sleep -Milliseconds 300
    }
    throw "The EzDent-i bridge did not start on port $TargetPort."
}

function Invoke-SelfTest {
    $script:passed = 0
    $script:failed = New-Object System.Collections.Generic.List[string]
    function Assert-Equal($Label, $Expected, $Actual) {
        if ("$Expected" -eq "$Actual") {
            $script:passed++
            Write-Host "  [PASS] $Label"
        } else {
            $script:failed.Add("$Label -- expected [$Expected] got [$Actual]")
            Write-Host "  [FAIL] $Label -- expected [$Expected] got [$Actual]"
        }
    }
    $a = Convert-CsxrayUrl "csxray://open/ezdenti?patient_no=PL001287&patient_name=TANG%20PUI"
    Assert-Equal "ezdenti key" "ezdenti" $a.key
    Assert-Equal "query kept encoded" "patient_no=PL001287&patient_name=TANG%20PUI" $a.query
    Assert-Equal "open uri" "http://127.0.0.1:17890/open/ezdenti?patient_no=PL001287&patient_name=TANG%20PUI" (Get-EzdentiOpenUri $a.query 17890)
    $quoted = Convert-CsxrayUrl '"csxray://open/ezdenti?patient_no=1"'
    Assert-Equal "quoted url" "ezdenti" $quoted.key
    $other = Convert-CsxrayUrl "csxray://open/nntnewtom?patient_no=1"
    Assert-Equal "other key is parsed but not ezdenti" "nntnewtom" $other.key
    $bad = Convert-CsxrayUrl "https://example.com"
    Assert-Equal "non-protocol rejected" "" $(if ($bad) { $bad.key } else { "" })
    if ($script:failed.Count -gt 0) {
        Write-Host "SELF-TEST FAILED: $($script:failed.Count)"
        exit 1
    }
    Write-Host "SELF-TEST PASSED: $($script:passed)"
    exit 0
}

if ($SelfTest) {
    Invoke-SelfTest
}

$parsed = Convert-CsxrayUrl $Url
if (-not $parsed) {
    Show-ProtocolError "This PC received a csxray link it did not understand. Re-run Install EzDent-i Bridge.bat, then click EzDent-i again."
    exit 1
}
if ($parsed.key -ne "ezdenti") {
    Write-ProtocolLog ("SKIP key=" + $parsed.key)
    exit 0
}

$openUri = Get-EzdentiOpenUri $parsed.query $Port
if ($DryRun) {
    Write-Output ("CSXRAY_OPEN " + $openUri)
    exit 0
}

try {
    if (-not (Test-BridgePort $Port)) {
        Start-EzdentiBridgeProcess $Port
    }
    $resp = Invoke-RestMethod -Uri $openUri -TimeoutSec 25 -ErrorAction Stop
    if ($resp -and $resp.ok -eq $true) {
        Write-ProtocolLog "OK ezdenti"
        exit 0
    }
    Show-ProtocolError "The EzDent-i bridge answered but did not open the program. Check that EzDent-i is installed, then click the button again."
    exit 1
} catch {
    Show-ProtocolError ("Could not open EzDent-i on this PC.`r`n`r`n" + $_.Exception.Message + "`r`n`r`nRe-run Install EzDent-i Bridge.bat if this keeps happening.")
    exit 1
}
