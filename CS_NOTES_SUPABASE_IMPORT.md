# Clinic Solution notes → Supabase `treatments` (multi-branch)

## Files

| File | Purpose |
|------|---------|
| `prepare-cs-staging-csv.py` | Normalize HKID + tag `branch` / `batch_id` / `banana_clinic_tag` |
| `CS_<BRANCH>_*_staging_for_supabase.csv` | Per-branch upload file |
| `supabase_cs_notes_import.sql` | Staging + clinic-scoped match + insert |

## Per-branch pipeline

```bat
REM 1) Extract raw notes CSV from that branch's Clinic Solution SQL
REM    (DENTALRECORDTABLE ⋈ PATIENTTABLE on P_CODE)

REM 2) Normalize + tag branch
python prepare-cs-staging-csv.py ^
  --source "C:\path\CS_PL_notes.csv" ^
  --branch PL ^
  --clinic-tag PL

REM Script prints BATCH_ID=PL_YYYYMMDD_HHMMSS — copy it
```

### Supabase steps (repeat per branch)

1. Run SQL **§0–1** once (helpers, `cs_import_params`, `cs_notes_staging`).
2. **§2** — set active batch:
   ```sql
   UPDATE public.cs_import_params
   SET batch_id = 'PL_YYYYMMDD_HHMMSS',   -- from script output
       require_clinic_scope = true,
       updated_at = now()
   WHERE id = 1;
   ```
3. Import that branch’s staging CSV into `cs_notes_staging` (do **not** truncate other batches).
4. Run **§3** match (active batch only).
5. Preview **§4**.
6. Insert **§5** (writes `treatments` + backfills `clinic_tag`).
7. Report **§6**.

## Match logic (multi-branch safe)

```text
batch_id filter (only active batch)

1) hkid_norm + patients.clinic_tag = banana_clinic_tag   ← preferred
2) hkid_norm alone (legacy blank clinic_tag / if scope disabled)
3) patient_no = chart_no + clinic_tag                    ← never cross-clinic
4) stripped patient_no + clinic_tag
        ↓
treatments.patient_id = patients.id
treatments.notes / created_at / dentist_name
treatments.clinic_tag ← banana_clinic_tag
```

Keep `require_clinic_scope = true` so chart numbers like `000028` at TKO and PL cannot merge.

## Staging CSV columns

`import_key`, `batch_id`, `branch_code`, `banana_clinic_tag`, `hkid_raw`, `hkid_norm`, `chart_no`, `chart_no_stripped`, names/DOB/sex, visit fields, `clinic_code`, `doctor_code`, `record_type`, `notes`

`import_key` includes **branch**, so the same chart/note text at two clinics do not collide on the primary key.

## Tips

- One branch = one CSV = one `batch_id`.
- Prefer deleting only that batch before re-import:
  ```sql
  DELETE FROM cs_notes_staging s
  USING cs_import_params p
  WHERE p.id = 1 AND s.batch_id = p.batch_id;
  ```
- Ensure Banana `patients.clinic_tag` uses the same codes as `--clinic-tag` / CS `ClinicCode` (`TKO`, `PL`, …).
- Archive each branch’s raw + staging CSV and §6 report.
