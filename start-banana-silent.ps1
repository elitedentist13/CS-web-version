# Silent Banana autostart: keep http://127.0.0.1:5500 serving, then open index.html.
# Called hidden at Windows logon via start-banana-hidden.vbs (Startup folder shortcut).
param(
    [switch]$InstallStartup,
    [switch]$UninstallStartup
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'http://127.0.0.1:5500/index.html'
$port = 5500
$shortcutName = 'Banana Clinic.lnk'
$logPath = Join-Path $env:TEMP 'banana-autostart.log'

function Write-Log([string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch {}
}

function Get-StartupShortcutPath {
    $wsh = New-Object -ComObject WScript.Shell
    return (Join-Path $wsh.SpecialFolders('Startup') $shortcutName)
}

function Install-StartupShortcut {
    $vbs = Join-Path $root 'start-banana-hidden.vbs'
    if (-not (Test-Path -LiteralPath $vbs)) {
        throw "Missing silent launcher: $vbs"
    }
    $path = Get-StartupShortcutPath
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($path)
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $shortcut.Arguments = '"' + $vbs + '"'
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Start Banana local server and open index.html'
    $shortcut.Save()
    Write-Log "Installed Startup shortcut: $path"
    return $path
}

if ($UninstallStartup) {
    $path = Get-StartupShortcutPath
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
        Write-Log "Removed Startup shortcut: $path"
        Write-Host "Removed: $path"
    } else {
        Write-Host "No Startup shortcut to remove."
    }
    return
}

if ($InstallStartup) {
    $path = Install-StartupShortcut
    Write-Host "Startup shortcut installed:"
    Write-Host "  $path"
    Write-Host "Banana will open at $url after the next Windows sign-in."
    return
}

function Test-PortOpen {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
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

function Wait-UntilServing([int]$Seconds = 25) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) { return $true }
        } catch {}
        Start-Sleep -Milliseconds 400
    }
    return (Test-PortOpen)
}

function Find-NodeExe {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'nodejs\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Start-BananaServer {
    $node = Find-NodeExe
    $liveServer = Join-Path $root 'node_modules\live-server\live-server.js'
    $serveStatic = Join-Path $root 'tools\serve-static.ps1'

    if ($node -and (Test-Path -LiteralPath $liveServer)) {
        $nodeDir = Split-Path -Parent $node
        $env:Path = "$nodeDir;$env:Path"
        $args = @(
            $liveServer,
            "--port=$port",
            '--host=127.0.0.1',
            '--no-browser',
            '--quiet',
            '--ignore=node_modules,.git',
            '--ignorePattern=xray-ai-service'
        )
        Write-Log "Starting live-server with $node"
        Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden | Out-Null
        return
    }

    if (Test-Path -LiteralPath $serveStatic) {
        Write-Log "live-server/node unavailable; starting PowerShell static server"
        Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') `
            -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $serveStatic, '-Port', "$port") `
            -WorkingDirectory $root -WindowStyle Hidden | Out-Null
        return
    }

    Write-Log 'No local server available (missing node/live-server and serve-static.ps1).'
}

# Give Explorer a moment after logon so the browser window lands on the desktop.
Start-Sleep -Seconds 2

if (-not (Test-PortOpen)) {
    Start-BananaServer
    $ready = Wait-UntilServing
    Write-Log $(if ($ready) { "Server ready at $url" } else { "Timed out waiting for $url" })
} else {
    Write-Log "Port $port already in use; opening $url"
}

try {
    Start-Process $url
    Write-Log "Opened $url"
} catch {
    Write-Log "Failed to open browser: $($_.Exception.Message)"
}
