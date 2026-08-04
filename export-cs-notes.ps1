# Fast CSV extract from Clinic Solution CS6 (32-bit ODBC)
$ErrorActionPreference = 'Stop'
$outDir = 'C:\Users\Doctor-1\Downloads'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$base = Join-Path $outDir "ClinicSolution_ConsultationNotes_by_HKID_$stamp"
$notesCsv = "$base`_notes.csv"
$extCsv   = "$base`_extend.csv"
$patCsv   = "$base`_patients.csv"
$metaTxt  = "$base`_meta.txt"

function Get-Conn {
    $c = New-Object System.Data.Odbc.OdbcConnection('Driver={SQL Server};Server=RECEPTION\CSX;Database=CS6;Uid=sa;Pwd=;Connection Timeout=30;')
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

Write-Host 'Connecting...'
$conn = Get-Conn

$sqlNotes = @"
SELECT
  ISNULL(p.HKID,'') AS HKID,
  p.P_CODE AS ChartNo,
  ISNULL(p.NAME,'') AS NameEn,
  ISNULL(p.ONAME,'') AS NameOther,
  ISNULL(p.DOB,'') AS DOB,
  CASE p.SEX WHEN 1 THEN 'M' WHEN 2 THEN 'F' ELSE CAST(p.SEX AS varchar(10)) END AS Sex,
  d.[DATE] AS VisitDate,
  CONVERT(varchar(23), d.[TIMESTAMP], 121) AS VisitTimestamp,
  ISNULL(d.CLINICCODE,'') AS ClinicCode,
  ISNULL(d.DOCTORCODE,'') AS DoctorCode,
  d.RECORDTYPE AS RecordType,
  ISNULL(CAST(d.TX AS nvarchar(max)),'') AS ConsultationNote
FROM DENTALRECORDTABLE d
LEFT JOIN PATIENTTABLE p ON p.P_CODE = d.P_CODE
ORDER BY ISNULL(p.HKID,''), d.[DATE], d.[TIMESTAMP]
"@

$sqlExt = @"
SELECT
  ISNULL(p.HKID,'') AS HKID,
  e.P_CODE AS ChartNo,
  ISNULL(p.NAME,'') AS NameEn,
  ISNULL(e.CATEGORY,'') AS Category,
  ISNULL(CAST(e.DATA AS nvarchar(max)),'') AS DataText
FROM PATIENTEXTENDMEDICALRECORDTABLE e
LEFT JOIN PATIENTTABLE p ON p.P_CODE = e.P_CODE
ORDER BY ISNULL(p.HKID,''), e.CATEGORY
"@

$sqlPat = @"
SELECT
  ISNULL(HKID,'') AS HKID,
  P_CODE AS ChartNo,
  ISNULL(NAME,'') AS NameEn,
  ISNULL(ONAME,'') AS NameOther,
  ISNULL(DOB,'') AS DOB,
  CASE SEX WHEN 1 THEN 'M' WHEN 2 THEN 'F' ELSE CAST(SEX AS varchar(10)) END AS Sex,
  ISNULL(MOBILE,'') AS Mobile,
  ISNULL(TEL,'') AS Tel
FROM PATIENTTABLE
ORDER BY ISNULL(HKID,''), P_CODE
"@

Write-Host 'Exporting consultation notes...'
$nNotes = Export-QueryToCsv $conn $sqlNotes $notesCsv
Write-Host "Notes: $nNotes -> $notesCsv"

Write-Host 'Exporting extend medical data...'
$nExt = Export-QueryToCsv $conn $sqlExt $extCsv
Write-Host "Extend: $nExt -> $extCsv"

Write-Host 'Exporting patients...'
$nPat = Export-QueryToCsv $conn $sqlPat $patCsv
Write-Host "Patients: $nPat -> $patCsv"

$conn.Close()

@"
base=$base
notes_csv=$notesCsv
extend_csv=$extCsv
patients_csv=$patCsv
notes_rows=$nNotes
extend_rows=$nExt
patients_rows=$nPat
"@ | Set-Content -LiteralPath $metaTxt -Encoding UTF8

Write-Host "META $metaTxt"
Write-Host "DONE_CSV"
