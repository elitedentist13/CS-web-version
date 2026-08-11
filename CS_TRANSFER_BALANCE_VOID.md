# CS → Banana transfer-balance void (multi-branch)

Reusable pipeline for clinics where Softlink **open balances** were carried into Banana as **`JSM_PENDING` / balance-transfer bills**, then the old CS plan still shows an unpaid balance (and sometimes further CS installments).

This is a **second** void pass after exact-duplicate void (`find-cs-bill-duplicates.py`).  
**Banana wins** — void the CS twin only.

Guide siblings: `CS_PAYMENTS_SUPABASE_IMPORT.md` §G · `supabase_cs_payments_void_duplicates.sql`

---

## Pattern

| Side | Typical shape |
|------|----------------|
| CS | Old plan (`CS_TXN:…`), still open `balance` > 0 |
| Banana | Later **`JSM_PENDING:`** / transfer / balance bill |
| Dates | **Usually different** — CS plan date ≠ Banana transfer date |
| Gap | `Banana.total − CS.balance` (often $1000, or = first Banana payment) |

Example (KT007657 — reconstruction via later CS pay):

- CS plan 2025-08-17 → bal **$8,000** after last installment  
- Banana transfer 2026-06-28 total **$9,000**  
- CS still took **$1,000** on/after transfer → reconstruct 8000+1000 = 9000  

Example (clinic gap rule — Softlink / PY):

- CS open bal **$8,000**  
- Banana balance-transfer total **$9,000**  
- Gap = **$1,000** → void CS even if no later CS installment is on file  
- Or gap = first payment on the Banana bill (any amount, e.g. $500 / $2000)

---

## Auto void reasons (`find-cs-transfer-balance-duplicates.py`)

| Reason | Condition | Later CS pay required? |
|--------|-----------|------------------------|
| `transfer_equal_balance` | Banana.total ≈ CS.balance | No |
| `transfer_then_cs_installment` | Banana.total ≈ CS.balance + sum(CS pays with `paid_date` ≥ Banana.bill_date) | Yes (sum > 0) |
| `transfer_plus_1000_final_cs` | Banana.total ≈ CS.balance + 1000 **and** a CS pay of $1000 on/after transfer | Yes ($1000) |
| `transfer_gap_1000` | Banana.total − CS.balance ≈ **1000** (CS unpaid is $1000 smaller than Banana bill) | **No** |
| `transfer_gap_eq_first_banana_pay` | Banana.total − CS.balance ≈ **first payment** on the Banana bill | **No** |

Prefer Banana bills labelled `JSM_PENDING` / transfer / balance when scoring, but **gap rules D/E also match unlabelled Banana bills** (e.g. PY002224 — Banana `bill_type=Alipay HK`, empty notes, total = CS.bal + 1000).

**Finder bugfix (2026-08-11):** loading Banana via `notes=not.like.*CS_TXN:*` skipped empty/null notes. Finder now loads all bills and splits in Python so those Banana carry-over bills are included.

§2 void SQL still only voids rows whose `bills.notes` contain `CS_TXN:`.

---

## Files

| File | Role |
|------|------|
| `find-cs-transfer-balance-duplicates.py` | Detect matches; write review + void CSV + **run log** |
| `CS_<BRANCH>_transfer_balance_conflicts.csv` | Full review (includes `gap_nat_total_minus_cs_bal`, `first_banana_pay`) |
| `CS_<BRANCH>_transfer_balance_void_staging_for_supabase.csv` | Import → `cs_bill_dup_void` |
| `CS_<BRANCH>_transfer_balance_void_<stamp>.log` | Per-run log (counts, reasons, sample rows) |
| `CS_TRANSFER_BALANCE_VOID_LOG.md` | Master clinic log (append after each branch) |
| `supabase_cs_payments_void_duplicates.sql` | §0 table · §1 preview · §2 void · §3 report |

---

## Softlink → Banana tag **PY**

On Softlink clinic PCs, CS `CLINICCODE` / export branch is often **TKO**, but Banana patients are tagged **PY**.

```bat
python find-cs-transfer-balance-duplicates.py ^
  --branch TKO --clinic-tag PY ^
  --out-dir "%USERPROFILE%\Downloads" --append-master-log
```

Staging for payments import uses the same mapping: `--branch TKO --clinic-tag PY`.

---

## Per-branch checklist

Replace `KT` with the clinic tag / branch (`TKO`+`PY`, `PL`, `OKT`, `CWB`, …).

### 1) Find

```bat
python find-cs-transfer-balance-duplicates.py ^
  --branch KT --clinic-tag KT ^
  --out-dir "C:\Users\ROOM 2\Downloads"
```

Printed:

- `REVIEW_CSV` / `VOID_STAGING_CSV`  
- `LOG` path  
- `REASONS` counts  

If void rows = **0**, nothing to do for this pass.

### 2) Review (spot-check)

Open `CS_<BRANCH>_transfer_balance_conflicts.csv`. Confirm:

- `is_jsm` usually `Y` (or notes/bill_type look like transfer/balance)  
- `cs_bill_date` ≠ `nat_bill_date` is normal  
- For gap rules: `gap_nat_total_minus_cs_bal` ≈ 1000 **or** ≈ `first_banana_pay`  
- For reconstruct rules: `reconstructed_bal_at_transfer` ≈ `nat_total`  

### 3) Void in Supabase

```sql
-- Once per project if needed:
-- run §0 of supabase_cs_payments_void_duplicates.sql

TRUNCATE public.cs_bill_dup_void;
```

Table Editor → `cs_bill_dup_void` → Import  
`CS_<BRANCH>_transfer_balance_void_staging_for_supabase.csv` (header on).

Then SQL Editor:

1. **§1** preview  
2. **§2** void (only `CS_TXN:` bills)  
3. **§3** report  

### 4) App spot-check

Open 1–2 patients from the void list: Banana transfer active; CS open plan voided (`CS_DUP_VOID:…`).

### 5) Append master log

Copy a block into `CS_TRANSFER_BALANCE_VOID_LOG.md` (template at bottom of that file), or rely on the per-run `.log` written next to the CSVs. Prefer:

```bat
python find-cs-transfer-balance-duplicates.py ... --append-master-log
```

---

## Safety

| Rule | Why |
|------|-----|
| Run **after** exact dup void (`find-cs-bill-duplicates.py`) | Different match rule |
| `TRUNCATE cs_bill_dup_void` before import | Avoid mixing branches |
| §2 only voids `notes LIKE '%CS_TXN:%'` | Never voids Banana |
| Prefer `JSM_PENDING` / transfer / balance Banana bills | Transfer carry-overs |
| Do not require same bill_date | Transfer is usually later than CS plan |
| Gap rules do not require later CS pays | Softlink often stopped taking installments after Banana transfer |

---

## Order in full payment migration

1. Export / stage / insert CS payments (`CS_PAYMENTS_SUPABASE_IMPORT.md` A–F)  
2. Exact dup void — `find-cs-bill-duplicates.py` (**G**)  
3. **This transfer-balance void** (**G2**) — including gap-$1000 / first-Banana-pay rules  
4. Unmatched repair if needed (**H**)  

---

## Quick copy-paste

```bat
python find-cs-transfer-balance-duplicates.py --branch BRANCH --clinic-tag BRANCH --out-dir "%USERPROFILE%\Downloads" --append-master-log

rem Softlink / PY:
python find-cs-transfer-balance-duplicates.py --branch TKO --clinic-tag PY --out-dir "%USERPROFILE%\Downloads" --append-master-log
```

```sql
TRUNCATE public.cs_bill_dup_void;
-- import CS_BRANCH_transfer_balance_void_staging_for_supabase.csv
-- then §1 → §2 → §3 of supabase_cs_payments_void_duplicates.sql
```
