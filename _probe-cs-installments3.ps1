# Probe ACCOUNTRECEIVABLE / INCOME / AUDIT for installment history
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
Write-Host "CONNECTED"

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

foreach ($t in @('ACCOUNTRECEIVABLETABLE','INCOMETABLE','AUDITTRAILTABLE','EXPENSESTABLE','QUOTATIONMASTERTABLE')) {
    Write-Host ""
    Write-Host "==== $t ===="
    $cols = Run-Sql ("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=N'{0}' ORDER BY ORDINAL_POSITION" -f $t)
    $cols | ForEach-Object { Write-Host ("{0}`t{1}" -f $_.COLUMN_NAME, $_.DATA_TYPE) }
    $n = Run-Sql ("SELECT COUNT(*) AS n FROM [{0}]" -f $t)
    Write-Host ("ROWCOUNT={0}" -f $n[0].n)
}

Write-Host ''
Write-Host '=== ACCOUNTRECEIVABLE sample 20 ==='
$ar = Run-Sql @"
SELECT TOP 20 *
FROM ACCOUNTRECEIVABLETABLE
ORDER BY TIMESTAMP DESC
"@
# print all props dynamically
if ($ar.Count -gt 0) {
    $names = $ar[0].PSObject.Properties.Name
    Write-Host ($names -join '|')
    foreach ($row in $ar) {
        $vals = @()
        foreach ($n in $names) { $vals += [string]$row.$n }
        Write-Host ($vals -join '|')
    }
}

Write-Host ''
Write-Host '=== Link AR to payment master for partial bill OKT004602 / 202503070001 ==='
$link = Run-Sql @"
SELECT ar.*
FROM ACCOUNTRECEIVABLETABLE ar
WHERE CAST(ar.P_CODE AS varchar(50)) LIKE '%OKT004602%'
   OR CAST(ar.T_CODE AS varchar(50)) LIKE '%202503070001%'
"@
# schema unknown - try common names first via info
Write-Host "AR rows for patient/txn (raw filter attempt): $($link.Count)"

# Discover which columns look like keys
$arCols = Run-Sql "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=N'ACCOUNTRECEIVABLETABLE'"
$colList = ($arCols | ForEach-Object { $_.COLUMN_NAME }) -join ','
Write-Host "AR_COLS=$colList"

Write-Host ''
Write-Host '=== INCOME sample 15 ==='
$incCols = Run-Sql "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=N'INCOMETABLE' ORDER BY ORDINAL_POSITION"
Write-Host ("INCOME_COLS=" + (($incCols | ForEach-Object { $_.COLUMN_NAME }) -join ','))
$inc = Run-Sql "SELECT TOP 15 * FROM INCOMETABLE ORDER BY 1 DESC"
if ($inc.Count -gt 0) {
    $names = $inc[0].PSObject.Properties.Name
    Write-Host ($names -join '|')
    foreach ($row in $inc) {
        $vals = @()
        foreach ($n in $names) { $vals += [string]$row.$n }
        Write-Host ($vals -join '|')
    }
}

Write-Host ''
Write-Host '=== AUDITTRAIL sample related to payment/receive ==='
$auCols = Run-Sql "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=N'AUDITTRAILTABLE' ORDER BY ORDINAL_POSITION"
Write-Host ("AUDIT_COLS=" + (($auCols | ForEach-Object { $_.COLUMN_NAME }) -join ','))
try {
    $au = Run-Sql @"
SELECT TOP 20 *
FROM AUDITTRAILTABLE
WHERE CAST(ACTION AS nvarchar(200)) LIKE '%PAY%'
   OR CAST(ACTION AS nvarchar(200)) LIKE '%RECEIV%'
   OR CAST(DESCRIPTION AS nvarchar(400)) LIKE '%PAY%'
   OR CAST(REMARKS AS nvarchar(400)) LIKE '%RECEIV%'
ORDER BY TIMESTAMP DESC
"@
    Write-Host "audit_filter_rows=$($au.Count)"
} catch {
    Write-Host ("audit_filter_err=" + $_.Exception.Message)
    $au = Run-Sql "SELECT TOP 10 * FROM AUDITTRAILTABLE ORDER BY TIMESTAMP DESC"
}
if ($au.Count -gt 0) {
    $names = $au[0].PSObject.Properties.Name
    Write-Host ($names -join '|')
    foreach ($row in $au) {
        $vals = @()
        foreach ($n in $names) { $vals += ([string]$row.$n).Substring(0, [Math]::Min(80, ([string]$row.$n).Length)) }
        Write-Host ($vals -join '|')
    }
}

Write-Host ''
Write-Host '=== For partial patient OKT004602: all payment masters ==='
$pm = Run-Sql @"
SELECT T_CODE, [DATE], CLINICCODE,
  CAST(TOTAL AS decimal(18,2))/100.0 AS TotalHkd,
  CAST(DISCOUNT AS decimal(18,2))/100.0 AS DiscHkd,
  CAST(NETAMOUNT AS decimal(18,2))/100.0 AS NetHkd,
  CAST(RECEIVED AS decimal(18,2))/100.0 AS RecvHkd,
  CAST((NETAMOUNT-RECEIVED) AS decimal(18,2))/100.0 AS BalHkd,
  CANCELSTATUS, REMARKS, CONVERT(varchar(23), TIMESTAMP, 121) AS Ts
FROM PAYMENTMASTERTABLE
WHERE P_CODE = 'OKT004602'
ORDER BY TIMESTAMP
"@
$pm | ForEach-Object {
    Write-Host ("{0} {1} net={2} recv={3} bal={4} cancel={5} rem=[{6}] ts={7}" -f `
        $_.T_CODE, $_.DATE, $_.NetHkd, $_.RecvHkd, $_.BalHkd, $_.CANCELSTATUS, $_.REMARKS, $_.Ts)
}

$conn.Close()
Write-Host 'DONE_PROBE3'
