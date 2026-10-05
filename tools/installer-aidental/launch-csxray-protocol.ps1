# Joyful Smile / Banana — csxray:// handler for every local X-ray bridge.
#
# Chrome's local-network permission blocks the page from calling
# http://127.0.0.1:17890. This script is registered as the csxray://
# protocol so the browser only has to open a link. Windows starts this
# process, which talks to the bridge on loopback itself and asks it to
# open the named program (ezdenti, digirex, nntnewtom, myray, rayscan,
# carestream, trophy, aidental).
#
# If the bridge is not already listening, this starts the launcher that
# lives in the same folder, using csxray-bridge.txt written by the
# installer (which systems this PC is allowed to serve, and which port).
#
#   powershell -File launch-csxray-protocol.ps1 -SelfTest
#   powershell -File launch-csxray-protocol.ps1 -DryRun "csxray://open/digirex?patient_no=PL001287"

param(
    [Parameter(Position = 0)]
    [string]$Url = "",
    [int]$Port = 17890,
    [switch]$DryRun,
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$AllowedKeys = @(
    "ezdenti", "digirex", "nntnewtom", "myray",
    "rayscan", "carestream", "trophy", "aidental"
)

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

function Get-OpenUri([string]$Key, [string]$Query, [int]$TargetPort) {
    $uri = "http://127.0.0.1:$TargetPort/open/$Key"
    if ($Query) { $uri += "?" + $Query }
    return $uri
}

function Read-BridgeConfig {
    $result = @{ port = $Port; enabled = @() }
    $cfg = Join-Path $PSScriptRoot "csxray-bridge.txt"
    if (-not (Test-Path -LiteralPath $cfg)) { return $result }
    foreach ($line in (Get-Content -LiteralPath $cfg)) {
        $text = ([string]$line).Trim()
        if ($text -match '^port=(\d+)$') {
            $result.port = [int]$Matches[1]
        } elseif ($text -match '^enabled=(.*)$') {
            $result.enabled = @($Matches[1] -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
        }
    }
    return $result
}

function Write-ProtocolLog([string]$Line) {
    try {
        $path = Join-Path $env:TEMP "csxray-protocol-last.log"
        $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -LiteralPath $path -Value ("$stamp $Line") -Encoding ASCII
    } catch {}
}

function Read-HttpErrorBody($ErrorRecord) {
    try {
        $resp = $ErrorRecord.Exception.Response
        if (-not $resp) { return "" }
        $stream = $resp.GetResponseStream()
        if (-not $stream) { return "" }
        $reader = New-Object System.IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
        $reader.Close()
        return [string]$text
    } catch {
        return ""
    }
}

function Start-EzdentiFallback {
    # The listener on :17890 may be an older process whose /open/ezdenti
    # returns 404 (fixed install path only). This handler is started fresh
    # on every click, so it can still open the loader the bridge missed.
    $launcher = Join-Path $PSScriptRoot "xray-local-launcher.ps1"
    if (-not (Test-Path -LiteralPath $launcher)) { return "" }
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -FindEzdenti
    $exe = ""
    foreach ($line in @($out)) {
        $text = ([string]$line).Trim()
        if ($text -match '(?i)\.exe$') { $exe = $text }
    }
    if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { return "" }
    $work = Split-Path -Parent $exe
    Start-Process -FilePath $exe -WorkingDirectory $work | Out-Null
    return $exe
}

function Show-ProtocolError([string]$Message) {
    Write-ProtocolLog ("ERROR " + $Message)
    if ($DryRun -or $SelfTest) { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            "X-ray bridge",
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

function Start-InstalledBridge([int]$TargetPort, [string[]]$EnabledSystems) {
    $launcher = Join-Path $PSScriptRoot "xray-local-launcher.ps1"
    if (-not (Test-Path -LiteralPath $launcher)) {
        throw "xray-local-launcher.ps1 is not next to this handler ($PSScriptRoot). Re-run this PC's X-ray bridge installer."
    }
    $arg = "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$launcher`" -Port $TargetPort"
    foreach ($sys in @($EnabledSystems)) {
        if ($sys) { $arg += " -EnabledSystems `"$sys`"" }
    }
    Start-Process -FilePath "powershell.exe" -ArgumentList $arg -WindowStyle Minimized | Out-Null
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        if (Test-BridgePort $TargetPort) { return }
        Start-Sleep -Milliseconds 300
    }
    throw "The X-ray bridge did not start on port $TargetPort."
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
    Assert-Equal "ezdenti uri" "http://127.0.0.1:17890/open/ezdenti?patient_no=PL001287&patient_name=TANG%20PUI" (Get-OpenUri $a.key $a.query 17890)
    $dig = Convert-CsxrayUrl "csxray://open/digirex?patient_no=PL001287"
    Assert-Equal "digirex key" "digirex" $dig.key
    Assert-Equal "digirex uri" "http://127.0.0.1:17890/open/digirex?patient_no=PL001287" (Get-OpenUri $dig.key $dig.query 17890)
    $nnt = Convert-CsxrayUrl '"csxray://open/nntnewtom?patient_no=1"'
    Assert-Equal "quoted nnt key" "nntnewtom" $nnt.key
    foreach ($key in @("myray", "rayscan", "carestream", "trophy", "aidental")) {
        $parsed = Convert-CsxrayUrl ("csxray://open/" + $key + "?patient_no=1")
        Assert-Equal ($key + " allowed") $key $parsed.key
        Assert-Equal ($key + " in allow list") $true ($AllowedKeys -contains $parsed.key)
    }
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
    Show-ProtocolError "This PC received a csxray link it did not understand. Re-run this PC's X-ray bridge installer, then click the button again."
    exit 1
}
if ($AllowedKeys -notcontains $parsed.key) {
    Write-ProtocolLog ("SKIP key=" + $parsed.key)
    Show-ProtocolError ("This X-ray link (" + $parsed.key + ") is not one of the bridge programs.")
    exit 0
}

$settings = Read-BridgeConfig
$targetPort = [int]$settings.port
if ($targetPort -le 0) { $targetPort = $Port }
$openUri = Get-OpenUri $parsed.key $parsed.query $targetPort
if ($DryRun) {
    $enabledNote = if (@($settings.enabled).Count -gt 0) { $settings.enabled -join "," } else { "all" }
    Write-Output ("CSXRAY_OPEN " + $openUri)
    Write-Output ("CSXRAY_ENABLED " + $enabledNote)
    exit 0
}

try {
    if (-not (Test-BridgePort $targetPort)) {
        Start-InstalledBridge $targetPort @($settings.enabled)
    }
    $resp = Invoke-RestMethod -Uri $openUri -TimeoutSec 25 -ErrorAction Stop
    if ($resp -and $resp.ok -eq $true) {
        Write-ProtocolLog ("OK " + $parsed.key)
        exit 0
    }
    Show-ProtocolError "The X-ray bridge answered but did not open the program. Check that it is installed on this PC, then click the button again."
    exit 1
} catch {
    $detail = $_.Exception.Message
    $body = Read-HttpErrorBody $_
    if ($body) {
        try {
            $parsedBody = $body | ConvertFrom-Json
            if ($parsedBody.error) { $detail = [string]$parsedBody.error }
        } catch {
            $detail = $body.Trim()
        }
    }
    if ($parsed.key -eq "ezdenti") {
        $opened = Start-EzdentiFallback
        if ($opened) {
            Write-ProtocolLog ("OK ezdenti fallback " + $opened)
            exit 0
        }
        $detail = $detail + " EzDent-i was not found under Program Files, VATECH, the Start Menu, or the uninstall registry. Set EzdentiExePath in xray-launcher-config.ps1 if it is installed somewhere else."
    }
    Show-ProtocolError ("Could not open the X-ray program on this PC.`r`n`r`n" + $detail + "`r`n`r`nRe-run this PC's X-ray bridge installer if this keeps happening.")
    exit 1
}
