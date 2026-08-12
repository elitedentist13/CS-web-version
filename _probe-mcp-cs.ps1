# Probe MCP Clinic Solution ODBC (must run under 32-bit PowerShell)
$ErrorActionPreference = 'Continue'
Write-Host ('PS bits: {0}' -f ([IntPtr]::Size * 8))

function Try-Open([string]$cs, [string]$label) {
    try {
        $c = New-Object System.Data.Odbc.OdbcConnection($cs)
        $c.Open()
        Write-Host ("OPEN_OK {0} Database={1} DataSource={2}" -f $label, $c.Database, $c.DataSource)
        $cmd = $c.CreateCommand()
        $cmd.CommandText = "SELECT DB_NAME() AS dbname, @@SERVERNAME AS srv"
        $r = $cmd.ExecuteReader()
        while ($r.Read()) {
            Write-Host ('DB={0} SERVER={1}' -f $r.GetValue(0), $r.GetValue(1))
        }
        $r.Close()
        foreach ($t in @('DENTALRECORDTABLE', 'PATIENTTABLE', 'PATIENTEXTENDMEDICALRECORDTABLE')) {
            try {
                $cmd.CommandText = "SELECT COUNT(*) FROM $t"
                $n = $cmd.ExecuteScalar()
                Write-Host ("COUNT {0} = {1}" -f $t, $n)
            } catch {
                Write-Host ("COUNT {0} FAIL {1}" -f $t, $_.Exception.Message)
            }
        }
        $c.Close()
        return $true
    } catch {
        Write-Host ("FAIL {0}: {1}" -f $label, $_.Exception.Message)
        return $false
    }
}

$attempts = @(
    @{ l = 'DSN ClinicSolution sa empty'; c = 'DSN=ClinicSolution;Uid=sa;Pwd=;' },
    @{ l = 'DSN ClinicSolution Trusted'; c = 'DSN=ClinicSolution;Trusted_Connection=Yes;' },
    @{ l = 'Reception_MCP\SOFTLINK sa empty'; c = 'Driver={SQL Server};Server=Reception_MCP\SOFTLINK;Database=CS6;Uid=sa;Pwd=;Connection Timeout=12;' },
    @{ l = 'Reception_MCP\SOFTLINK Trusted'; c = 'Driver={SQL Server};Server=Reception_MCP\SOFTLINK;Database=CS6;Trusted_Connection=Yes;Connection Timeout=12;' },
    @{ l = 'Reception_MCP\SOFTLINK sa sa'; c = 'Driver={SQL Server};Server=Reception_MCP\SOFTLINK;Database=CS6;Uid=sa;Pwd=sa;Connection Timeout=12;' }
)

$ok = $false
foreach ($a in $attempts) {
    if (Try-Open $a.c $a.l) { $ok = $true; break }
}
if (-not $ok) { exit 1 }
exit 0
