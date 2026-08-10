# CS → Banana transfer-balance void (multi-branch)

Reusable pipeline for clinics where Softlink **open balances** were carried into Banana as **`JSM_PENDING` transfer bills**, then further **CS installments** still posted on the old CS plan.

This is a **second** void pass after exact-duplicate void (`find-cs-bill-duplicates.py`).  
**Banana wins** — void the CS twin only.

Guide siblings: `CS_PAYMENTS_SUPABASE_IMPORT.md` §G · `supabase_cs_payments_void_duplicates.sql`

---

## Pattern

| Side | Typical shape |
|------|----------------|
| CS | Old plan (`CS_TXN:…`), still `Partial`, open `balance` |
| Banana | Later **`JSM_PENDING:`** bill — transfer of the then-outstanding |
| Dates | **Usually different** — CS plan date ≠ Banana transfer date |
| Gap | Banana.total ≈ CS.balance + sum(CS payments with `paid_date` ≥ Banana.bill_date) |

Example (KT007657):

- CS plan 2025-08-17 → bal **$8,000** after last installment  
- Banana transfer 2026-06-28 total **$9,000**  
- CS still took **$1,000** on/after transfer → reconstruct 8000+1000 = 9000  

Auto reason code: `transfer_then_cs_installment` (also `transfer_plus_1000_final_cs`).

---

## Files

| File | Role |
|------|------|
| `find-cs-transfer-balance-duplicates.py` | Detect matches; write review + void CSV + **run log** |
| `CS_<BRANCH>_transfer_balance_conflicts.csv` | Full review |
| `CS_<BRANCH>_transfer_balance_void_staging_for_supabase.csv` | Import → `cs_bill_dup_void` |
| `CS_<BRANCH>_transfer_balance_void_<stamp>.log` | Per-run log (counts, reasons, sample rows) |
| `CS_TRANSFER_BALANCE_VOID_LOG.md` | Master clinic log (append after each branch) |
| `supabase_cs_payments_void_duplicates.sql` | §0 table · §1 preview · §2 void · §3 report |

---

## Per-branch checklist

Replace `KT` with the clinic tag / branch (`TKO`, `PL`, `OKT`, `CWB`, …).

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

- `is_jsm` usually `Y`  
- `cs_bill_date` ≠ `nat_bill_date` is normal  
- `reconstructed_bal_at_transfer` ≈ `nat_total`  

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

Copy a block into `CS_TRANSFER_BALANCE_VOID_LOG.md` (template at bottom of that file), or rely on the per-run `.log` written next to the CSVs.

---

## Safety

| Rule | Why |
|------|-----|
| Run **after** exact dup void (`find-cs-bill-duplicates.py`) | Different match rule |
| `TRUNCATE cs_bill_dup_void` before import | Avoid mixing branches |
| §2 only voids `notes LIKE '%CS_TXN:%'` | Never voids Banana |
| Prefer `JSM_PENDING` Banana bills | Transfer carry-overs |
| Do not require same bill_date | Transfer is usually later than CS plan |

---

## Order in full payment migration

1. Export / stage / insert CS payments (`CS_PAYMENTS_SUPABASE_IMPORT.md` A–F)  
2. Exact dup void — `find-cs-bill-duplicates.py` (**G**)  
3. **This transfer-balance void** (**G2**)  
4. Unmatched repair if needed (**H**)  

---

## Quick copy-paste

```bat
python find-cs-transfer-balance-duplicates.py --branch BRANCH --clinic-tag BRANCH --out-dir "C:\Users\ROOM 2\Downloads"
```

```sql
TRUNCATE public.cs_bill_dup_void;
-- import CS_BRANCH_transfer_balance_void_staging_for_supabase.csv
-- then §1 → §2 → §3 of supabase_cs_payments_void_duplicates.sql
```
