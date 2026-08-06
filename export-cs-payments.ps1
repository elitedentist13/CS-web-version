# Export Clinic Solution payment history (PAYMENTMASTER + PAYMENTSLAVE) to CSV
# Requires 32-bit PowerShell for System DSN / SQL Server ODBC driver.
#
# Examples:
#   .\export-cs-payments.ps1 -Branch TKO
#   .\export-cs-payments.ps1 -Branch PL -Server 'BRANCHPC\CSX' -Database CS6
#
param(
    [string]$Branch = 'TKO',
    [string]$OutDir = 'C:\Users\Doctor-1\Downloads',
    [string]$Server = 'RECEPTION\CSX',
    [string]$Database = 'CS6',
    [string]$Uid = 'sa',
    [string]$Pwd = ''
)

$ErrorActionPreference = 'Stop'

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$branch = ($Branch.Trim().ToUpper() -replace '[^A-Z0-9_-]', '')
if (-not $branch) { throw 'Branch is required (e.g. TKO, PL, KT)' }

$masterCsv = Join-Path $OutDir ("CS_{0}_PaymentHistory_{1}_master.csv" -f $branch, $stamp)
$itemsCsv  = Join-Path $OutDir ("CS_{0}_PaymentHistory_{1}_items.csv" -f $branch, $stamp)
$incomeCsv = Join-Path $OutDir ("CS_{0}_PaymentHistory_{1}_income.csv" -f $branch, $stamp)
$metaTxt   = Join-Path $OutDir ("CS_{0}_PaymentHistory_{1}_meta.txt" -f $branch, $stamp)

function Get-Conn {
    $cs = 'Driver={{SQL Server}};Server={0};Database={1};Uid={2};Pwd={3};Connection Timeout=30;' -f `
        $Server, $Database, $Uid, $Pwd
    $c = New-Object System.Data.Odbc.OdbcConnection($cs)
    $c.Open()
    return $c
}

function Export-QueryToCsv($conn, $sql, $path) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 600
    $reader = $cmd.ExecuteReader()
    $sw = New-Object System.IO.StreamWriter($path, $false, [Text.UTF8Encoding]::new($true))
    try {
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        $sw.WriteLine((($cols | ForEach-Object { '"' + $_.Replace('"', '""') + '"' }) -join ','))
        $count = 0
        while ($reader.Read()) {
            $vals = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                if ($reader.IsDBNull($i)) { $s = '' }
                else {
                    $s = [string]$reader.GetValue($i)
                    $s = $s -replace "`0", ''
                    $s = $s -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', ''
                }
                $vals += ('"' + $s.Replace('"', '""') + '"')
            }
            $sw.WriteLine(($vals -join ','))
            $count++
            if (($count % 2000) -eq 0) { Write-Host ("  ... $count rows") }
        }
        return $count
    } finally {
        $reader.Close()
        $sw.Close()
    }
}

Write-Host 'Connecting to RECEPTION\CSX / CS6 ...'
$conn = Get-Conn

# Amounts in CS are stored in cents (integer). Export both raw cents and HKD.
$sqlMaster = @"
SELECT
  m.T_CODE AS TxnCode,
  m.[DATE] AS BillDate,
  CONVERT(varchar(23), m.[TIMESTAMP], 121) AS BillTimestamp,
  m.P_CODE AS ChartNo,
  ISNULL(p.HKID, '') AS HKID,
  ISNULL(p.NAME, '') AS NameEn,
  ISNULL(p.ONAME, '') AS NameOther,
  ISNULL(p.DOB, '') AS DOB,
  CASE p.SEX WHEN 1 THEN 'M' WHEN 2 THEN 'F' ELSE CAST(p.SEX AS varchar(10)) END AS Sex,
  ISNULL(m.CLINICCODE, '') AS ClinicCode,
  ISNULL(m.DOCTORCODE, '') AS DoctorCode,
  m.CANCELSTATUS AS CancelStatus,
  CASE WHEN m.CANCELSTATUS = 0 THEN 'Active' ELSE 'Cancelled' END AS CancelLabel,
  m.TOTAL AS TotalCents,
  CAST(m.TOTAL AS decimal(18,2)) / 100.0 AS TotalHkd,
  m.DISCOUNT AS DiscountCents,
  CAST(m.DISCOUNT AS decimal(18,2)) / 100.0 AS DiscountHkd,
  m.NETAMOUNT AS NetCents,
  CAST(m.NETAMOUNT AS decimal(18,2)) / 100.0 AS NetHkd,
  m.RECEIVED AS ReceivedCents,
  CAST(m.RECEIVED AS decimal(18,2)) / 100.0 AS ReceivedHkd,
  CAST((m.NETAMOUNT - m.RECEIVED) AS decimal(18,2)) / 100.0 AS BalanceHkd,
  ISNULL(m.REMARKS, '') AS Remarks,
  ISNULL(m.DIAGNOSIS, '') AS Diagnosis
FROM PAYMENTMASTERTABLE m
LEFT JOIN PATIENTTABLE p ON p.P_CODE = m.P_CODE
ORDER BY m.[TIMESTAMP], m.T_CODE
"@

$sqlItems = @"
SELECT
  s.T_CODE AS TxnCode,
  s.ITEMCOUNT AS LineNumber,
  ISNULL(m.[DATE], '') AS BillDate,
  CONVERT(varchar(23), s.[TIMESTAMP], 121) AS LineTimestamp,
  s.P_CODE AS ChartNo,
  ISNULL(p.HKID, '') AS HKID,
  ISNULL(p.NAME, '') AS NameEn,
  ISNULL(s.CLINICCODE, '') AS ClinicCode,
  ISNULL(s.DOCTORCODE, '') AS DoctorCode,
  ISNULL(CAST(s.ITEM AS nvarchar(200)), '') AS Item,
  ISNULL(CAST(s.SUBITEM AS nvarchar(200)), '') AS SubItem,
  s.AMOUNT AS UnitAmountCents,
  CAST(s.AMOUNT AS decimal(18,2)) / 100.0 AS UnitAmountHkd,
  s.QTY AS QtyRaw,
  CAST(s.QTY AS decimal(18,2)) / 100.0 AS Qty,
  s.DISCOUNT AS DiscountCents,
  CAST(s.DISCOUNT AS decimal(18,2)) / 100.0 AS DiscountHkd,
  s.NETAMOUNT AS NetCents,
  CAST(s.NETAMOUNT AS decimal(18,2)) / 100.0 AS NetHkd,
  ISNULL(m.CANCELSTATUS, 0) AS CancelStatus
FROM PAYMENTSLAVETABLE s
LEFT JOIN PAYMENTMASTERTABLE m ON m.T_CODE = s.T_CODE
LEFT JOIN PATIENTTABLE p ON p.P_CODE = s.P_CODE
ORDER BY s.T_CODE, s.ITEMCOUNT
"@

Write-Host 'Exporting payment master (bills)...'
$nMaster = Export-QueryToCsv $conn $sqlMaster $masterCsv
Write-Host "Master: $nMaster -> $masterCsv"

Write-Host 'Exporting payment line items...'
$nItems = Export-QueryToCsv $conn $sqlItems $itemsCsv
Write-Host "Items: $nItems -> $itemsCsv"

# Per-receipt / installment ledger (may have multiple rows per T_CODE+P_CODE)
$sqlIncome = @"
SELECT
  i.T_CODE AS TxnCode,
  i.P_CODE AS ChartNo,
  i.[DATE] AS PaidDate,
  i.BDATE AS BillDate,
  CONVERT(varchar(23), i.[TIMESTAMP], 121) AS PaidTimestamp,
  ISNULL(i.MCLINICCODE, '') AS MasterClinicCode,
  ISNULL(i.CLINICCODE, '') AS ClinicCode,
  i.STATUS AS Status,
  ISNULL(i.METHOD, '') AS Method,
  ISNULL(i.DOCTORCODE, '') AS DoctorCode,
  i.AMOUNT AS AmountCents,
  CAST(i.AMOUNT AS decimal(18,2)) / 100.0 AS AmountHkd,
  ISNULL(i.REMARKS, '') AS Remarks
FROM INCOMETABLE i
WHERE i.STATUS = 0
ORDER BY i.T_CODE, i.P_CODE, i.[TIMESTAMP], i.AMOUNT
"@

Write-Host 'Exporting income / installment receipts...'
$nIncome = Export-QueryToCsv $conn $sqlIncome $incomeCsv
Write-Host "Income: $nIncome -> $incomeCsv"

$conn.Close()

@"
branch=$branch
server=$Server
database=$Database
master_csv=$masterCsv
items_csv=$itemsCsv
income_csv=$incomeCsv
master_rows=$nMaster
items_rows=$nItems
income_rows=$nIncome
amount_unit=cents_in_db_exported_also_as_hkd_div_100
notes=PAYMENTMASTERTABLE=bill header; PAYMENTSLAVETABLE=line items; INCOMETABLE=per-receipt installments (join TxnCode+ChartNo); CANCELSTATUS 0=active 1=cancelled
"@ | Set-Content -LiteralPath $metaTxt -Encoding UTF8

Write-Host "META $metaTxt"
Write-Host 'DONE_PAYMENTS'
