# Clinic Solution → Banana treatment history (`treatments`) — multi-branch

End-to-end pipeline for **each clinic branch** (TKO, PL, KT, …):

1. Export CS consultation notes  
2. Normalize staging (`batch_id` / `clinic_tag`)  
3. Match patients → insert `treatments`  
4. Resolve unmatched (prefixed chart / looser match)  
5. Spot-check  

Mirrors the payment package in `CS_PAYMENTS_SUPABASE_IMPORT.md`.

---

## Files

| File | Role |
|------|------|
| `export-cs-notes.ps1` | Extract notes (+ extend / patients) from CS SQL |
| `prepare-cs-staging-csv.py` | Normalize HKID + `branch` / `batch_id` / `banana_clinic_tag` |
| `supabase_cs_notes_import.sql` | Staging / clinic-scoped match / insert |
| `supabase_cs_notes_fix_unmatched.sql` | Inspect unmatched (active batch) |
| `resolve-unmatched-notes.py` | Build resolve staging for leftover unmatched |
| `supabase_cs_notes_resolve_insert.sql` | Insert pre-resolved unmatched notes |
| `CS_NOTES_EXPORT.md` | Export notes |
| `resolve-unmatched-tko.py` | Legacy TKO-only helper (prefer `resolve-unmatched-notes.py`) |

---

## What maps where

| CS | Banana |
|----|--------|
| matched `patients.id` | `treatments.patient_id` **(required)** |
| `ConsultationNote` (`TX`) | `treatments.notes` |
| `DoctorCode` | `treatments.dentist_name` |
| `VisitTimestamp` | `treatments.created_at` (Asia/Hong_Kong) |
| staging `banana_clinic_tag` | `treatments.clinic_tag` (backfill) |

Notes are **not** keyed by HKID in Banana — always resolve `patients.id` first.

---

## Safety rules (every branch)

| Rule | Why |
|------|-----|
| One branch = one `batch_id` | Avoid cross-clinic collisions |
| `require_clinic_scope = true` | Same chart no. exists at other clinics |
| Prefer `patient_no` = `<BRANCH>` + chart (e.g. `PL003826`) | Reliable fallback |
| Dedup on insert | Same `patient_id` + `notes` + `created_at` → `skipped_dup` |
| Do not `TRUNCATE cs_notes_staging` across branches | Delete only the active batch |
| Never wipe `treatments` | Only insert / resolve |

---

## Match order (clinic-scoped)

```text
active batch_id only
1) hkid_norm + clinic_tag
2) hkid_norm unique (blank clinic / scope off)
3) patient_no = chart_no + clinic_tag
4) patient_no = <clinic_tag> || chart_no + clinic_tag   ← e.g. TKO003826
5) patient_no stripped + clinic_tag
```

---

## Per-branch checklist

Replace `PL` with the branch code. Adjust `-Server` if that clinic’s CS is not on `RECEPTION\CSX`.

### A — Export from Clinic Solution

```bat
%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File export-cs-notes.ps1 -Branch PL
```

Output: `CS_PL_ConsultationNotes_<stamp>_notes.csv` (and extend/patients archives).

### B — Normalize staging

```bat
python prepare-cs-staging-csv.py ^
  --source "C:\Users\Doctor-1\Downloads\CS_PL_ConsultationNotes_<stamp>_notes.csv" ^
  --branch PL --clinic-tag PL
```

Copy printed **`BATCH_ID`** (e.g. `PL_20260805_120000`).

### C — Supabase: staging objects + batch

SQL Editor → run **§0–1** of `supabase_cs_notes_import.sql` (once per project).

```sql
UPDATE public.cs_import_params
SET batch_id = 'PL_YYYYMMDD_HHMMSS',
    require_clinic_scope = true,
    updated_at = now()
WHERE id = 1;
```

Optional clear that batch only:

```sql
DELETE FROM public.cs_notes_staging s
USING public.cs_import_params p
WHERE p.id = 1 AND s.batch_id = p.batch_id;
```

### D — Import staging CSV

Table Editor → `cs_notes_staging` → Import CSV (header on).  
Leave `matched_*` / `import_status` empty.

### E — Match → preview → insert

Run **§3** (match), **§4** (preview), **§5** (insert into `treatments`), **§6** (report)  
from `supabase_cs_notes_import.sql`.

### F — Inspect unmatched

Run queries in `supabase_cs_notes_fix_unmatched.sql` (scoped to active batch).

### G — Resolve unmatched (recommended)

```bat
python resolve-unmatched-notes.py ^
  --branch PL ^
  --batch-id PL_YYYYMMDD_HHMMSS ^
  --clinic-tag PL
```

Outputs (Downloads):

- `CS_PL_notes_resolve_staging_for_supabase.csv`
- `CS_PL_notes_resolve_patient_map.csv`
- `CS_PL_notes_still_unmatched_manual.csv`

Then:

1. Optional: `DELETE FROM cs_notes_staging WHERE batch_id LIKE 'PL_NOTES_RESOLVE_%';`  
2. Set `cs_import_params.batch_id` to the printed resolve `BATCH_ID`  
3. Import resolve staging CSV  
4. Run `supabase_cs_notes_resolve_insert.sql` §4–6  

Still-manual rows need a Banana patient created / linked first.

---

## Order vs other data

1. Patients in Banana for that `clinic_tag`  
2. **This notes / treatment-history workflow (A→G)**  
3. Payment history (`CS_PAYMENTS_SUPABASE_IMPORT.md`)  

---

## Quick checklist (copy per branch)

- [ ] `export-cs-notes.ps1 -Branch <X>`  
- [ ] `prepare-cs-staging-csv.py --branch <X> --clinic-tag <X>` → note `BATCH_ID`  
- [ ] `cs_import_params.batch_id` set; clinic scope on  
- [ ] Staging CSV imported  
- [ ] Match §3 → preview §4 → insert §5 → report §6  
- [ ] Fix unmatched SQL inspected  
- [ ] `resolve-unmatched-notes.py` + resolve insert (if needed)  
- [ ] Manual leftovers reviewed  
- [ ] Spot-check a few patient treatment histories in the app  

---

## Staging CSV columns

`import_key`, `batch_id`, `branch_code`, `banana_clinic_tag`, `hkid_raw`, `hkid_norm`, `chart_no`, `chart_no_stripped`, names/DOB/sex, `visit_date`, `visit_at`, `clinic_code`, `doctor_code`, `record_type`, `notes`

Resolve staging also includes `resolved_patient_id`, `resolve_method`.

`import_key` includes **batch + branch**, so re-imports and overlapping chart numbers across clinics do not collide.

---

## TKO reference (already done)

| Step | Approx. result |
|------|----------------|
| Main insert | ~4,724+ then rematch waves |
| Resolve batch | `TKO_RESOLVE_*` / `resolve-unmatched-notes.py --branch TKO` pattern |
| Leftovers | a few orphan notes without identity — manual only |

For new branches, use this guide — do not hard-code TKO batch ids.
