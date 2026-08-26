# Minimal static server for Banana when Node/npm is unavailable.
param([int]$Port = 5500, [string]$Root = (Split-Path $PSScriptRoot -Parent))

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Banana static server: http://127.0.0.1:$Port/index.html" -ForegroundColor Green
Write-Host "Root: $Root" -ForegroundColor Cyan

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
        $path = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath)
        if ($path -eq '/') { $path = '/index.html' }
        $file = Join-Path $Root ($path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar))
        $file = [IO.Path]::GetFullPath($file)
        if (-not $file.StartsWith([IO.Path]::GetFullPath($Root), [StringComparison]::OrdinalIgnoreCase)) {
            $ctx.Response.StatusCode = 403
            $buf = [Text.Encoding]::UTF8.GetBytes('Forbidden')
            $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
            continue
        }
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            $ctx.Response.StatusCode = 404
            $buf = [Text.Encoding]::UTF8.GetBytes('Not found')
            $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
            continue
        }
        $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
        $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache, no-store, must-revalidate')
        $bytes = [IO.File]::ReadAllBytes($file)
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        try { $ctx.Response.StatusCode = 500 } catch {}
    } finally {
        $ctx.Response.Close()
    }
}
