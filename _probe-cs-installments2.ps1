# Dig deeper: all tables, RECEIVED columns, partial-pay patterns, reserve fields
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
Write-Host '=== ALL TABLES ==='
$all = Run-Sql "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
$all | ForEach-Object { Write-Host $_.TABLE_NAME }
Write-Host ("TOTAL_TABLES={0}" -f $all.Count)

Write-Host ''
Write-Host '=== Columns named RECEIVED / PAID / AMOUNT+DATE-ish across DB ==='
$cols = Run-Sql @"
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%RECEIV%'
   OR COLUMN_NAME LIKE '%PAID%'
   OR COLUMN_NAME LIKE '%INSTALL%'
   OR COLUMN_NAME LIKE '%SETTLE%'
   OR COLUMN_NAME LIKE '%PAYMENT%'
   OR COLUMN_NAME LIKE '%RECEIPT%'
   OR COLUMN_NAME LIKE '%BALANCE%'
ORDER BY TABLE_NAME, COLUMN_NAME
"@
$cols | ForEach-Object { Write-Host ("{0}.{1}`t{2}" -f $_.TABLE_NAME, $_.COLUMN_NAME, $_.DATA_TYPE) }

Write-Host ''
Write-Host '=== PAYMENTMASTER reserve field fill rates ==='
$res = Run-Sql @"
SELECT
  COUNT(*) AS n,
  SUM(CASE WHEN ISNULL(RESERVE_1_INT,0)<>0 THEN 1 ELSE 0 END) AS r1i,
  SUM(CASE WHEN ISNULL(RESERVE_2_INT,0)<>0 THEN 1 ELSE 0 END) AS r2i,
  SUM(CASE WHEN ISNULL(RESERVE_3_INT,0)<>0 THEN 1 ELSE 0 END) AS r3i,
  SUM(CASE WHEN ISNULL(RESERVE_4_INT,0)<>0 THEN 1 ELSE 0 END) AS r4i,
  SUM(CASE WHEN ISNULL(RESERVE_5_INT,0)<>0 THEN 1 ELSE 0 END) AS r5i,
  SUM(CASE WHEN ISNULL(RESERVE_6_INT,0)<>0 THEN 1 ELSE 0 END) AS r6i,
  SUM(CASE WHEN ISNULL(RESERVE_1_STR,'')<>'' THEN 1 ELSE 0 END) AS r1s,
  SUM(CASE WHEN ISNULL(RESERVE_2_STR,'')<>'' THEN 1 ELSE 0 END) AS r2s,
  SUM(CASE WHEN ISNULL(RESERVE_3_STR,'')<>'' THEN 1 ELSE 0 END) AS r3s,
  SUM(CASE WHEN ISNULL(RESERVE_4_STR,'')<>'' THEN 1 ELSE 0 END) AS r4s,
  SUM(CASE WHEN ISNULL(RESERVE_5_STR,'')<>'' THEN 1 ELSE 0 END) AS r5s,
  SUM(CASE WHEN ISNULL(RESERVE_6_STR,'')<>'' THEN 1 ELSE 0 END) AS r6s
FROM PAYMENTMASTERTABLE
"@
$res | ForEach-Object { $_ | Format-List | Out-String | Write-Host }

Write-Host '=== Sample reserve-filled masters ==='
$samp = Run-Sql @"
SELECT TOP 15
  T_CODE, [DATE], P_CODE, CLINICCODE,
  CAST(NETAMOUNT AS decimal(18,2))/100.0 AS NetHkd,
  CAST(RECEIVED AS decimal(18,2))/100.0 AS RecvHkd,
  CAST((NETAMOUNT-RECEIVED) AS decimal(18,2))/100.0 AS BalHkd,
  RESERVE_1_INT, RESERVE_2_INT, RESERVE_3_INT, RESERVE_4_INT, RESERVE_5_INT, RESERVE_6_INT,
  RESERVE_1_STR, RESERVE_2_STR, RESERVE_3_STR, RESERVE_4_STR, RESERVE_5_STR, RESERVE_6_STR,
  REMARKS
FROM PAYMENTMASTERTABLE
WHERE ISNULL(RESERVE_1_INT,0)<>0 OR ISNULL(RESERVE_2_INT,0)<>0
   OR ISNULL(RESERVE_3_INT,0)<>0 OR ISNULL(RESERVE_4_INT,0)<>0
   OR ISNULL(RESERVE_5_INT,0)<>0 OR ISNULL(RESERVE_6_INT,0)<>0
   OR ISNULL(RESERVE_1_STR,'')<>'' OR ISNULL(RESERVE_2_STR,'')<>''
   OR ISNULL(RESERVE_3_STR,'')<>'' OR ISNULL(RESERVE_4_STR,'')<>''
   OR ISNULL(RESERVE_5_STR,'')<>'' OR ISNULL(RESERVE_6_STR,'')<>''
ORDER BY [TIMESTAMP] DESC
"@
$samp | ForEach-Object {
    Write-Host ("{0} {1} {2} net={3} recv={4} bal={5} r1i={6} r2i={7} r3i={8} r1s=[{9}] r2s=[{10}] r3s=[{11}] remarks=[{12}]" -f `
        $_.T_CODE, $_.DATE, $_.P_CODE, $_.NetHkd, $_.RecvHkd, $_.BalHkd, `
        $_.RESERVE_1_INT, $_.RESERVE_2_INT, $_.RESERVE_3_INT, `
        $_.RESERVE_1_STR, $_.RESERVE_2_STR, $_.RESERVE_3_STR, $_.REMARKS)
}

Write-Host ''
Write-Host '=== Partial balance bills (recv>0 and bal>0) count + samples ==='
$partial = Run-Sql @"
SELECT
  SUM(CASE WHEN RECEIVED>0 AND (NETAMOUNT-RECEIVED)>0 AND CANCELSTATUS=0 THEN 1 ELSE 0 END) AS partial_n,
  SUM(CASE WHEN RECEIVED=0 AND NETAMOUNT>0 AND CANCELSTATUS=0 THEN 1 ELSE 0 END) AS unpaid_n,
  SUM(CASE WHEN RECEIVED>=NETAMOUNT AND NETAMOUNT>0 AND CANCELSTATUS=0 THEN 1 ELSE 0 END) AS paid_n,
  SUM(CASE WHEN CANCELSTATUS=0 THEN 1 ELSE 0 END) AS active_n
FROM PAYMENTMASTERTABLE
"@
$partial | ForEach-Object { $_ | Format-List | Out-String | Write-Host }

$psamp = Run-Sql @"
SELECT TOP 10
  T_CODE, [DATE], P_CODE, CLINICCODE,
  CAST(NETAMOUNT AS decimal(18,2))/100.0 AS NetHkd,
  CAST(RECEIVED AS decimal(18,2))/100.0 AS RecvHkd,
  CAST((NETAMOUNT-RECEIVED) AS decimal(18,2))/100.0 AS BalHkd,
  REMARKS, DIAGNOSIS
FROM PAYMENTMASTERTABLE
WHERE CANCELSTATUS=0 AND RECEIVED>0 AND (NETAMOUNT-RECEIVED)>0
ORDER BY (NETAMOUNT-RECEIVED) DESC
"@
$psamp | ForEach-Object {
    Write-Host ("{0} {1} chart={2} clinic={3} net={4} recv={5} bal={6} rem=[{7}]" -f `
        $_.T_CODE, $_.DATE, $_.P_CODE, $_.CLINICCODE, $_.NetHkd, $_.RecvHkd, $_.BalHkd, $_.REMARKS)
}

Write-Host ''
Write-Host '=== Same patient: multiple masters same day (possible installment pattern?) ==='
$multi = Run-Sql @"
SELECT TOP 15 P_CODE, [DATE], COUNT(*) AS n,
  SUM(NETAMOUNT) AS net_cents, SUM(RECEIVED) AS recv_cents
FROM PAYMENTMASTERTABLE
WHERE CANCELSTATUS=0
GROUP BY P_CODE, [DATE]
HAVING COUNT(*) >= 3
ORDER BY COUNT(*) DESC
"@
$multi | ForEach-Object {
    Write-Host ("chart={0} date={1} n={2} net={3} recv={4}" -f $_.P_CODE, $_.DATE, $_.n, ([decimal]$_.net_cents/100), ([decimal]$_.recv_cents/100))
}

Write-Host ''
Write-Host '=== Views matching pay/receipt ==='
$views = Run-Sql @"
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS
WHERE TABLE_NAME LIKE '%PAY%' OR TABLE_NAME LIKE '%RECEIPT%' OR TABLE_NAME LIKE '%TRAN%'
ORDER BY TABLE_NAME
"@
$views | ForEach-Object { Write-Host $_.TABLE_NAME }

$conn.Close()
Write-Host 'DONE_PROBE2'
