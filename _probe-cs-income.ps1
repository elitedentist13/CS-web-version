# Validate INCOMETABLE as installment / receipt ledger
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

Write-Host '=== INCOME stats ==='
$stats = Run-Sql @"
SELECT
  COUNT(*) AS income_rows,
  COUNT(DISTINCT T_CODE) AS distinct_txn,
  SUM(CASE WHEN STATUS=0 THEN 1 ELSE 0 END) AS active_rows,
  SUM(CASE WHEN STATUS<>0 THEN 1 ELSE 0 END) AS other_status
FROM INCOMETABLE
"@
$stats | Format-List | Out-String | Write-Host

Write-Host '=== Txns with multiple income rows ==='
$multi = Run-Sql @"
SELECT
  SUM(CASE WHEN n=1 THEN 1 ELSE 0 END) AS txn_1pay,
  SUM(CASE WHEN n=2 THEN 1 ELSE 0 END) AS txn_2pay,
  SUM(CASE WHEN n=3 THEN 1 ELSE 0 END) AS txn_3pay,
  SUM(CASE WHEN n>=4 THEN 1 ELSE 0 END) AS txn_4plus,
  MAX(n) AS max_pays
FROM (
  SELECT T_CODE, COUNT(*) AS n
  FROM INCOMETABLE
  WHERE STATUS=0
  GROUP BY T_CODE
) x
"@
$multi | Format-List | Out-String | Write-Host

Write-Host '=== Sample multi-pay txns (top 12 by count) ==='
$tops = Run-Sql @"
SELECT TOP 12 T_CODE, P_CODE, COUNT(*) AS n,
  MIN([DATE]) AS first_date, MAX([DATE]) AS last_date,
  CAST(SUM(AMOUNT) AS decimal(18,2))/100.0 AS sum_hkd
FROM INCOMETABLE
WHERE STATUS=0
GROUP BY T_CODE, P_CODE
HAVING COUNT(*) >= 2
ORDER BY COUNT(*) DESC, SUM(AMOUNT) DESC
"@
$tops | ForEach-Object {
    Write-Host ("txn={0} chart={1} n={2} {3}->{4} sum={5}" -f $_.T_CODE, $_.P_CODE, $_.n, $_.first_date, $_.last_date, $_.sum_hkd)
}

Write-Host ''
Write-Host '=== Detail for richest multi-pay txn ==='
if ($tops.Count -gt 0) {
    $t = $tops[0].T_CODE
    $det = Run-Sql @"
SELECT T_CODE, P_CODE, [DATE], BDATE, METHOD,
  CAST(AMOUNT AS decimal(18,2))/100.0 AS AmtHkd,
  CONVERT(varchar(23), TIMESTAMP, 121) AS Ts,
  CLINICCODE, REMARKS, STATUS
FROM INCOMETABLE
WHERE T_CODE = '$t'
ORDER BY TIMESTAMP, AMOUNT
"@
    $det | ForEach-Object {
        Write-Host ("  {0} date={1} bdate={2} method={3} amt={4} clinic={5} ts={6} rem=[{7}]" -f `
            $_.T_CODE, $_.DATE, $_.BDATE, $_.METHOD, $_.AmtHkd, $_.CLINICCODE, $_.Ts, $_.REMARKS)
    }
    $m = Run-Sql @"
SELECT T_CODE,
  CAST(NETAMOUNT AS decimal(18,2))/100.0 AS NetHkd,
  CAST(RECEIVED AS decimal(18,2))/100.0 AS RecvHkd,
  CAST((NETAMOUNT-RECEIVED) AS decimal(18,2))/100.0 AS BalHkd
FROM PAYMENTMASTERTABLE WHERE T_CODE='$t'
"@
    $m | ForEach-Object { Write-Host ("  MASTER net={0} recv={1} bal={2}" -f $_.NetHkd, $_.RecvHkd, $_.BalHkd) }
}

Write-Host ''
Write-Host '=== Compare income sum vs master RECEIVED (mismatches) ==='
$cmp = Run-Sql @"
SELECT
  COUNT(*) AS compared,
  SUM(CASE WHEN ABS(i.sum_amt - m.RECEIVED) <= 1 THEN 1 ELSE 0 END) AS match_n,
  SUM(CASE WHEN ABS(i.sum_amt - m.RECEIVED) > 1 THEN 1 ELSE 0 END) AS mismatch_n
FROM PAYMENTMASTERTABLE m
JOIN (
  SELECT T_CODE, SUM(AMOUNT) AS sum_amt
  FROM INCOMETABLE
  WHERE STATUS=0
  GROUP BY T_CODE
) i ON i.T_CODE = m.T_CODE
WHERE m.CANCELSTATUS=0
"@
$cmp | Format-List | Out-String | Write-Host

$mm = Run-Sql @"
SELECT TOP 10 m.T_CODE, m.P_CODE,
  CAST(m.RECEIVED AS decimal(18,2))/100.0 AS MasterRecv,
  CAST(i.sum_amt AS decimal(18,2))/100.0 AS IncomeSum,
  CAST((m.NETAMOUNT-m.RECEIVED) AS decimal(18,2))/100.0 AS Bal
FROM PAYMENTMASTERTABLE m
JOIN (
  SELECT T_CODE, SUM(AMOUNT) AS sum_amt
  FROM INCOMETABLE WHERE STATUS=0 GROUP BY T_CODE
) i ON i.T_CODE = m.T_CODE
WHERE m.CANCELSTATUS=0 AND ABS(i.sum_amt - m.RECEIVED) > 1
ORDER BY ABS(i.sum_amt - m.RECEIVED) DESC
"@
Write-Host 'mismatch samples:'
$mm | ForEach-Object {
    Write-Host ("  {0} chart={1} masterRecv={2} incomeSum={3} bal={4}" -f $_.T_CODE, $_.P_CODE, $_.MasterRecv, $_.IncomeSum, $_.Bal)
}

Write-Host ''
Write-Host '=== Masters with RECEIVED>0 but no income rows ==='
$orphan = Run-Sql @"
SELECT COUNT(*) AS n
FROM PAYMENTMASTERTABLE m
WHERE m.CANCELSTATUS=0 AND m.RECEIVED>0
  AND NOT EXISTS (SELECT 1 FROM INCOMETABLE i WHERE i.T_CODE=m.T_CODE AND i.STATUS=0)
"@
Write-Host ("masters_recv_no_income={0}" -f $orphan[0].n)

Write-Host ''
Write-Host '=== Partial bill OKT004602 / 202503070001 income rows ==='
$p = Run-Sql @"
SELECT T_CODE, P_CODE, [DATE], BDATE, METHOD,
  CAST(AMOUNT AS decimal(18,2))/100.0 AS AmtHkd,
  CONVERT(varchar(23), TIMESTAMP, 121) AS Ts, REMARKS
FROM INCOMETABLE
WHERE T_CODE='202503070001' OR P_CODE='OKT004602'
ORDER BY TIMESTAMP
"@
$p | ForEach-Object {
    Write-Host ("  {0} chart={1} date={2} method={3} amt={4} ts={5}" -f $_.T_CODE, $_.P_CODE, $_.DATE, $_.METHOD, $_.AmtHkd, $_.Ts)
}

Write-Host ''
Write-Host '=== Multi-pay with DIFFERENT dates (true installment over time) ==='
$diff = Run-Sql @"
SELECT TOP 15 T_CODE, P_CODE, COUNT(*) AS n,
  COUNT(DISTINCT [DATE]) AS distinct_dates,
  MIN([DATE]) AS first_date, MAX([DATE]) AS last_date,
  CAST(SUM(AMOUNT) AS decimal(18,2))/100.0 AS sum_hkd
FROM INCOMETABLE
WHERE STATUS=0
GROUP BY T_CODE, P_CODE
HAVING COUNT(DISTINCT [DATE]) >= 2
ORDER BY COUNT(DISTINCT [DATE]) DESC, SUM(AMOUNT) DESC
"@
Write-Host ("multi_date_txn_sample_count_shown={0}" -f $diff.Count)
$cntDiff = Run-Sql @"
SELECT COUNT(*) AS n FROM (
  SELECT T_CODE FROM INCOMETABLE WHERE STATUS=0
  GROUP BY T_CODE HAVING COUNT(DISTINCT [DATE]) >= 2
) x
"@
Write-Host ("txns_with_multi_dates={0}" -f $cntDiff[0].n)
$diff | ForEach-Object {
    Write-Host ("txn={0} chart={1} n={2} dates={3} {4}->{5} sum={6}" -f $_.T_CODE, $_.P_CODE, $_.n, $_.distinct_dates, $_.first_date, $_.last_date, $_.sum_hkd)
}

if ($diff.Count -gt 0) {
    $t2 = $diff[0].T_CODE
    Write-Host ""
    Write-Host "=== Detail installment history for $t2 ==="
    $d2 = Run-Sql @"
SELECT [DATE], BDATE, METHOD,
  CAST(AMOUNT AS decimal(18,2))/100.0 AS AmtHkd,
  CONVERT(varchar(23), TIMESTAMP, 121) AS Ts, REMARKS
FROM INCOMETABLE WHERE T_CODE='$t2' AND STATUS=0
ORDER BY TIMESTAMP
"@
    $d2 | ForEach-Object {
        Write-Host ("  date={0} method={1} amt={2} ts={3} rem=[{4}]" -f $_.DATE, $_.METHOD, $_.AmtHkd, $_.Ts, $_.REMARKS)
    }
}

Write-Host ''
Write-Host '=== Payment methods used ==='
$methods = Run-Sql @"
SELECT ISNULL(METHOD,'(blank)') AS METHOD, COUNT(*) AS n,
  CAST(SUM(AMOUNT) AS decimal(18,2))/100.0 AS sum_hkd
FROM INCOMETABLE WHERE STATUS=0
GROUP BY METHOD
ORDER BY COUNT(*) DESC
"@
$methods | ForEach-Object { Write-Host ("{0}`t{1}`t{2}" -f $_.METHOD, $_.n, $_.sum_hkd) }

$conn.Close()
Write-Host 'DONE_INCOME'
