$ErrorActionPreference = 'Continue'
Write-Host ('PS bits: {0}' -f ([IntPtr]::Size * 8))

function Try-Open([string]$cs, [string]$label) {
    try {
        $c = New-Object System.Data.Odbc.OdbcConnection($cs)
        $c.Open()
        Write-Host ("OPEN_OK {0} Database={1} DataSource={2}" -f $label, $c.Database, $c.DataSource)
        $cmd = $c.CreateCommand()
        $cmd.CommandText = 'SELECT DB_NAME() AS dbname, @@SERVERNAME AS srv'
        $r = $cmd.ExecuteReader()
        while ($r.Read()) {
            Write-Host ('DB={0} SERVER={1}' -f $r.GetValue(0), $r.GetValue(1))
        }
        $r.Close()
        foreach ($t in @('PAYMENTMASTERTABLE', 'PAYMENTSLAVETABLE', 'INCOMETABLE', 'PATIENTTABLE')) {
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
    @{ l = 'DSN+sa+empty'; c = 'DSN=ClinicSolution;Uid=sa;Pwd=;' },
    @{ l = 'DSN+sa+sa'; c = 'DSN=ClinicSolution;Uid=sa;Pwd=sa;' },
    @{ l = 'DSN+sa+softlink'; c = 'DSN=ClinicSolution;Uid=sa;Pwd=softlink;' },
    @{ l = 'DSN+sa+Softlink'; c = 'DSN=ClinicSolution;Uid=sa;Pwd=Softlink;' },
    @{ l = 'DSN+sa+1234'; c = 'DSN=ClinicSolution;Uid=sa;Pwd=1234;' },
    @{ l = 'DSN+Trusted'; c = 'DSN=ClinicSolution;Trusted_Connection=Yes;' },
    @{ l = 'Reception\SOFTLINK sa empty'; c = 'Driver={SQL Server};Server=Reception\SOFTLINK;Database=CS6;Uid=sa;Pwd=;Connection Timeout=8;' },
    @{ l = 'Reception\SOFTLINK sa sa'; c = 'Driver={SQL Server};Server=Reception\SOFTLINK;Database=CS6;Uid=sa;Pwd=sa;Connection Timeout=8;' },
    @{ l = 'Reception\SOFTLINK Trusted'; c = 'Driver={SQL Server};Server=Reception\SOFTLINK;Database=CS6;Trusted_Connection=Yes;Connection Timeout=8;' },
    @{ l = '192.168.50.2\SOFTLINK sa empty'; c = 'Driver={SQL Server};Server=192.168.50.2\SOFTLINK;Database=CS6;Uid=sa;Pwd=;Connection Timeout=8;' },
    @{ l = '192.168.50.2\SOFTLINK Trusted'; c = 'Driver={SQL Server};Server=192.168.50.2\SOFTLINK;Database=CS6;Trusted_Connection=Yes;Connection Timeout=8;' }
)

foreach ($a in $attempts) {
    if (Try-Open $a.c $a.l) { break }
}
