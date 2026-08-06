# Export Clinic Solution INCOMETABLE (per-receipt / installment payments)
# Requires 32-bit PowerShell for SQL Server ODBC.
#
# Example (Softlink MK + Kai Tak):
#   .\ _export-cs-income.ps1 -Branch SOFTLINK -Server '192.168.50.2\SOFTLINK' -OutDir 'C:\Users\joyfu\Downloads'
param(
    [string]$Branch = 'SOFTLINK',
    [string]$OutDir = 'C:\Users\joyfu\Downloads',
    [string]$Server = '192.168.50.2\SOFTLINK',
    [string]$Database = 'CS6',
    [string]$Uid = 'sa',
    [string]$Pwd = ''
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$branch = ($Branch.Trim().ToUpper() -replace '[^A-Z0-9_-]', '')
if (-not $branch) { throw 'Branch is required' }

$incomeCsv = Join-Path $OutDir ("CS_{0}_Income_{1}.csv" -f $branch, $stamp)
$metaTxt = Join-Path $OutDir ("CS_{0}_Income_{1}_meta.txt" -f $branch, $stamp)

$cs = 'Driver={{SQL Server}};Server={0};Database={1};Uid={2};Pwd={3};Connection Timeout=30;' -f `
    $Server, $Database, $Uid, $Pwd
$conn = New-Object System.Data.Odbc.OdbcConnection($cs)
$conn.Open()
Write-Host "CONNECTED $Server / $Database"

$sql = @"
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

$cmd = $conn.CreateCommand()
$cmd.CommandText = $sql
$cmd.CommandTimeout = 600
$reader = $cmd.ExecuteReader()
$sw = New-Object System.IO.StreamWriter($incomeCsv, $false, [Text.UTF8Encoding]::new($true))
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
} finally {
    $reader.Close()
    $sw.Close()
    $conn.Close()
}

@"
branch=$branch
server=$Server
database=$Database
income_csv=$incomeCsv
income_rows=$count
notes=INCOMETABLE active STATUS=0; join to PAYMENTMASTER by TxnCode+ChartNo; Softlink CLINICCODE MK->MK, KAI TAK->OKT
"@ | Set-Content -LiteralPath $metaTxt -Encoding UTF8

Write-Host "Income: $count -> $incomeCsv"
Write-Host "META $metaTxt"
Write-Host 'DONE_INCOME'
