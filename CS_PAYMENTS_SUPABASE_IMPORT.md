# Clinic Solution → Banana payment history (multi-branch workflow)

End-to-end pipeline for **each clinic branch** (TKO, PL, KT, …):

1. Export CS payments  
2. Normalize staging (**with treatment line items**)  
3. Match patients → insert `bills` / `bill_payments`  
4. (If needed) backfill items on already-imported bills  
5. Find & void CS duplicates that conflict with Banana’s newer payments  
6. Repair unmatched  

---

## Files

| File | Role |
|------|------|
| `export-cs-payments.ps1` | Extract master + items from CS SQL |
| `prepare-cs-payments-staging-csv.py` | Normalize + **`--items`** → `items_json` |
| `supabase_cs_payments_import.sql` | Staging / match / insert |
| `backfill-cs-bill-items.py` | Build items backfill CSV (legacy / repair) |
| `supabase_cs_payments_backfill_items.sql` | Apply items onto existing CS bills |
| `find-cs-bill-duplicates.py` | Detect CS vs Banana duplicate bills |
| `supabase_cs_payments_void_duplicates.sql` | Void CS duplicates (keep Banana) |
| `resolve-unmatched-payments.py` | Multi-branch unmatched repair (HKID+chart / SKW blank clinic) |
| `resolve-unmatched-payments-tko.py` | Legacy TKO-only helper (prefer `resolve-unmatched-payments.py`) |
| `supabase_cs_payments_resolve_insert.sql` | Resolve-insert for pre-linked rows (active `batch_id`) |
| `CS_PAYMENTS_EXPORT.md` | Export notes / CS schema |

---

## What maps where

| CS | Banana |
|----|--------|
| matched `patients.id` | `bills.patient_id` |
| `BillDate` | `bill_date` |
| `NetHkd` / `DiscountHkd` / `ReceivedHkd` / balance | `total` / `discount` / `amount_paid` / `balance` |
| `PAYMENTSLAVETABLE` lines | `bills.items` JSON `[{desc,qty,price,disc,tooth_no}]` |
| `TxnCode` | `notes` / `bill_payments.notes` = `CS_TXN:<code>` (idempotency) |
| — (method not on CS txn) | `bill_type` / payment `method` = **`CS Import`** |

**Not recoverable from CS history:** Cash / FPS / Visa per transaction.

---

## Safety rules (every branch)

| Rule | Why |
|------|-----|
| One branch = one `batch_id` | Avoid cross-clinic collisions |
| `require_clinic_scope = true` | Same chart no. exists at other clinics |
| Prefer `patient_no` = `<BRANCH>` + chart (e.g. `PL003826`) | Reliable fallback match |
| Idempotency via `CS_TXN:` | Safe re-runs (insert, not update) |
| `--active-only` | Skip cancelled CS bills |
| Skip `CHECKING` / `對數` | Already paid under real names in Banana |
| Never `TRUNCATE bills` | Only clear staging / void CS dups |
| Run **duplicate void** after insert | CS import does not update Banana bills |

---

## Per-branch checklist

Replace `PL` with the branch code and adjust Server if that clinic’s CS is not on `RECEPTION\CSX`.

### A — Export from Clinic Solution

```bat
%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File export-cs-payments.ps1 -Branch PL
```

Other server example:

```bat
... -File export-cs-payments.ps1 -Branch PL -Server "BRANCHPC\CSX" -Database CS6
```

Outputs (Downloads):

- `CS_PL_PaymentHistory_<stamp>_master.csv`
- `CS_PL_PaymentHistory_<stamp>_items.csv`

### B — Normalize staging (include treatment items)

```bat
python prepare-cs-payments-staging-csv.py ^
  --source "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_<stamp>_master.csv" ^
  --items  "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_<stamp>_items.csv" ^
  --branch PL --clinic-tag PL --active-only
```

Copy printed **`BATCH_ID`** (e.g. `PL_PAY_20260805_120000`).

### C — Supabase: staging objects + batch

SQL Editor → run **§0–1** of `supabase_cs_payments_import.sql` (once per project).

```sql
UPDATE public.cs_import_params
SET batch_id = 'PL_PAY_YYYYMMDD_HHMMSS',
    require_clinic_scope = true,
    updated_at = now()
WHERE id = 1;
```

Optional clear that batch only:

```sql
DELETE FROM public.cs_payments_staging WHERE batch_id = 'PL_PAY_YYYYMMDD_HHMMSS';
```

### D — Import staging CSV

Table Editor → `cs_payments_staging` → Import CSV (header on).  
Map `items_json` if prompted. Leave match columns empty.

### E — Match → preview → insert

Run **§3** (match), **§4** (preview), **§5** (insert bills + bill_payments), **§6** (report)  
from `supabase_cs_payments_import.sql`.

Expect mostly `inserted`; review `unmatched`.

> **Type casts already fixed in SQL:** `bill_date` → `date`, `items` → `jsonb`.

### F — Treatment items

**Preferred:** already done in step B via `--items` (inserted with real lines).

**If bills were inserted without items** (placeholder `CS imported bill`):

```bat
python backfill-cs-bill-items.py ^
  --branch PL ^
  --items "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_<stamp>_items.csv"
```

Then:

1. SQL → §0 of `supabase_cs_payments_backfill_items.sql`  
2. `TRUNCATE cs_bill_items_backfill;` (before each branch)  
3. Import `CS_PL_bill_items_backfill_for_supabase.csv`  
4. Run §1–2  

Hard-refresh the Banana app (jsonb items parse fix in `app-appt.js`).

Bills with **no CS slave lines** stay as a single summary line — normal.

### G — Void CS duplicates of Banana bills (**required** — Banana wins)

CS import **inserts** only. It never updates an existing Banana bill.

If the same visit already has a Banana bill (manual / `JSM_PENDING:…` / newer payments taken in Banana) **and** CS import adds a second bill (`CS_TXN:…`) with the same patient + date + total:

| Keep (shows in app) | Void (hidden) |
|---------------------|---------------|
| **Newer / existing Banana bill** (no `CS_TXN:`) | CS transfer copy (`CS_TXN:…`) |

Rule of thumb: **Banana prevails**; void the old CS-imported duplicate so balances do not double-count.

```bat
python find-cs-bill-duplicates.py --branch CWB --clinic-tag CWB --out-dir "C:\Users\joyfu\Downloads"
```

Optional: also list same-day different totals for manual review:

```bat
python find-cs-bill-duplicates.py --branch CWB --clinic-tag CWB --include-related-review --out-dir "C:\Users\joyfu\Downloads"
```

The script includes:
- patients with `clinic_tag = <branch>`
- plus patients linked from `cs_payments_staging` for that branch (covers SKW charts with blank `clinic_tag`)

Outputs:

- `CS_<BRANCH>_bill_duplicate_conflicts.csv` — full review  
- `CS_<BRANCH>_bill_dup_void_staging_for_supabase.csv` — auto void list  

Auto-void reasons:
- `banana_ahead` — Banana paid more / lower balance / Paid vs CS Partial  
- `identical_duplicate` — same paid & balance (still void CS to stop double-count)  

Manual only (not in void CSV): `review_cs_more_paid`, `same_day_different_total`.

Then SQL (`supabase_cs_payments_void_duplicates.sql`):

1. §0 create `cs_bill_dup_void`  
2. `TRUNCATE cs_bill_dup_void;`  
3. Import void staging CSV  
4. §1 preview → §2 void → §3 report  

§2 only voids rows where `bills.notes` contains `CS_TXN:` — **never** voids the Banana bill. Voided CS notes get `CS_DUP_VOID:superseded_by_Banana_bill`.

Manually review `same_day_different_total` / split-total cases (add extra `cs_bill_id` rows to void staging if confirmed).

### G2 — Transfer-balance void (**JSM_PENDING** carry-over; multi-branch)

After **G**, find CS open plans whose outstanding was carried into Banana as a later transfer bill, then CS still took further installments:

```bat
python find-cs-transfer-balance-duplicates.py ^
  --branch KT --clinic-tag KT ^
  --out-dir "C:\Users\ROOM 2\Downloads" ^
  --append-master-log
```

Full checklist + log: **`CS_TRANSFER_BALANCE_VOID.md`** · **`CS_TRANSFER_BALANCE_VOID_LOG.md`**.

Match (bill dates usually **differ**):

`Banana.total ≈ CS.balance + sum(CS payments on/after Banana.bill_date)`

Then same void SQL as **G** (`TRUNCATE cs_bill_dup_void` → import transfer void CSV → §1–2).

### H — Unmatched repair (optional)

Same idea as notes resolve:

```bat
python resolve-unmatched-payments.py ^
  --branch CWB --batch-id CWB_PAY_YYYYMMDD_HHMMSS --clinic-tag CWB
```

Then set `cs_import_params.batch_id` to the printed `*_PAY_RESOLVE_*`, import resolve staging CSV, run `supabase_cs_payments_resolve_insert.sql` §4–8.

---

## Order vs other data

1. Patients in Banana for that `clinic_tag`  
2. Consultation / treatment history — `CS_NOTES_SUPABASE_IMPORT.md`  
3. **This payment history workflow (A→G)**  
4. Spot-check a few patients who had open balances in Banana before the import  

---

## Quick checklist (copy per branch)

- [ ] `export-cs-payments.ps1 -Branch <X>`  
- [ ] `prepare-… --branch <X> --items … --active-only` → note `BATCH_ID`  
- [ ] `cs_import_params.batch_id` set; clinic scope on  
- [ ] Staging CSV imported (`items_json` mapped)  
- [ ] Match §3 → preview §4 → insert §5 → report §6  
- [ ] Items OK (via `--items` or backfill F)  
- [ ] **G — Banana wins:** `find-cs-bill-duplicates.py --branch <X> --clinic-tag <X>`  
- [ ] Void staging imported → void SQL §1–2 (void CS `CS_TXN:` only; keep Banana)  
- [ ] **G2 — Transfer-balance void:** `find-cs-transfer-balance-duplicates.py --branch <X> --clinic-tag <X> --append-master-log`  
- [ ] Transfer void CSV imported → void SQL §1–2 again; log in `CS_TRANSFER_BALANCE_VOID_LOG.md`  
- [ ] Unmatched reviewed / repaired  
- [ ] App hard-refresh; sample patient balances look correct (no double bills)  

---

## TKO reference (already done)

| Step | Result |
|------|--------|
| Insert | ~9,454 bills (`TKO_PAY_20260805_040017`) |
| Items backfill | ~8,693 with real lines; ~764 no CS slave lines |
| Dup void | Use **G** (`find-cs-bill-duplicates.py --branch TKO`). If it reports **0** void rows, exact duplicates are already cleared. |

Re-run **G** any time after later Banana payments if new overlaps appear.
