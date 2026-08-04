# Clinic Solution → consultation notes export

Full import workflow (all branches): **`CS_NOTES_SUPABASE_IMPORT.md`**.

## Source

| CS table | Role |
|----------|------|
| `DENTALRECORDTABLE` | Consultation notes (`TX`) keyed by `P_CODE` |
| `PATIENTTABLE` | HKID / name / DOB via `P_CODE` |
| `PATIENTEXTENDMEDICALRECORDTABLE` | Optional extend medical text (exported; not auto-imported) |

## Export (per branch)

32-bit PowerShell:

```bat
%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File export-cs-notes.ps1 -Branch PL
```

Other CS host:

```bat
... -File export-cs-notes.ps1 -Branch PL -Server "BRANCHPC\CSX" -Database CS6
```

| Output | Contents |
|--------|----------|
| `CS_<BRANCH>_ConsultationNotes_<stamp>_notes.csv` | Notes + patient (use this for staging) |
| `*_extend.csv` | Extend medical (optional / archive) |
| `*_patients.csv` | Patient list snapshot |
| `*_meta.txt` | Counts / paths |

## Normalize for Supabase

```bat
python prepare-cs-staging-csv.py ^
  --source "C:\Users\Doctor-1\Downloads\CS_PL_ConsultationNotes_*_notes.csv" ^
  --branch PL --clinic-tag PL
```

Copy printed **`BATCH_ID`**, then follow `CS_NOTES_SUPABASE_IMPORT.md`.
