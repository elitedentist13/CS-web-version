# Probe Softlink CS6 for receipt / installment payment tables
param(
    [string]$Server = '192.168.50.2\SOFTLINK',
    [string]$Database = 'CS6',
    [string]$Uid = 'sa',
    [string]$Pwd = ''
)

$ErrorActionPreference = 'Stop'
$cs = 'Driver={{SQL Server}};Server={0};Database={1};Uid={2};Pwd={3};Connection Timeout=30;' -f `
    $Server, $Database, $Uid, $Pwd
$conn = New-Object System.Data.Odbc.OdbcConnection($cs)
$conn.Open()
Write-Host "CONNECTED $Server / $Database"

function Run-Sql([string]$sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 180
    $r = $cmd.ExecuteReader()
    $rows = New-Object System.Collections.Generic.List[object]
    while ($r.Read()) {
        $o = [ordered]@{}
        for ($i = 0; $i -lt $r.FieldCount; $i++) {
            if ($r.IsDBNull($i)) { $o[$r.GetName($i)] = '' }
            else { $o[$r.GetName($i)] = [string]$r.GetValue($i) }
        }
        $rows.Add([pscustomobject]$o)
    }
    $r.Close()
    return $rows
}

Write-Host ''
Write-Host '=== TABLES matching PAY/RECEIPT/INSTALL/SETTLE/CASH/TRAN/RECV/DEPOSIT ==='
$tables = Run-Sql @"
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
  AND (
    TABLE_NAME LIKE '%PAY%'
    OR TABLE_NAME LIKE '%RECEIPT%'
    OR TABLE_NAME LIKE '%INSTALL%'
    OR TABLE_NAME LIKE '%SETTLE%'
    OR TABLE_NAME LIKE '%CASH%'
    OR TABLE_NAME LIKE '%TRAN%'
    OR TABLE_NAME LIKE '%RECV%'
    OR TABLE_NAME LIKE '%DEPOSIT%'
    OR TABLE_NAME LIKE '%MONEY%'
    OR TABLE_NAME LIKE '%COLLECTION%'
  )
ORDER BY TABLE_NAME
"@
$tables | ForEach-Object { Write-Host $_.TABLE_NAME }

foreach ($t in @($tables | ForEach-Object { $_.TABLE_NAME })) {
    Write-Host ''
    Write-Host "-- $t --"
    $cols = Run-Sql ("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = N'{0}' ORDER BY ORDINAL_POSITION" -f $t)
    $cols | ForEach-Object { Write-Host ("{0}`t{1}" -f $_.COLUMN_NAME, $_.DATA_TYPE) }
    try {
        $cnt = Run-Sql ("SELECT COUNT(*) AS n FROM [{0}]" -f $t)
        Write-Host ("ROWCOUNT={0}" -f $cnt[0].n)
    } catch {
        Write-Host ("ROWCOUNT_ERR={0}" -f $_.Exception.Message)
    }
}

$conn.Close()
Write-Host ''
Write-Host 'DONE_PROBE'
