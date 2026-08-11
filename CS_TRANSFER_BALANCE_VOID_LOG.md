# Transfer-balance void — clinic run log

Append one block per branch after completing `CS_TRANSFER_BALANCE_VOID.md`.  
Per-run machine logs: `CS_<BRANCH>_transfer_balance_void_<stamp>.log` (written by the finder).

---

## Template (copy per branch)

```md
### YYYY-MM-DD — BRANCH (clinic_tag=…)

| Field | Value |
|-------|-------|
| Operator | |
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch BRANCH --clinic-tag BRANCH --out-dir …` |
| Open CS bills (bal>0) scanned | |
| Void rows | |
| Reasons | `transfer_then_cs_installment`: N |
| Void staging CSV | `CS_BRANCH_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_BRANCH_transfer_balance_conflicts.csv` |
| Run log | `CS_BRANCH_transfer_balance_void_YYYYMMDD_HHMMSS.log` |
| Supabase void | §1 preview → §2 void → §3 report |
| Spot-check patients | |
| Notes | |
```

---

## Runs

### 2026-08-11 — TKO (clinic_tag=PY)

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch TKO --clinic-tag PY` |
| Open CS bills (bal>0) scanned | 70 |
| Active Banana bills in scope | 368 |
| Void rows | **4** |
| Reasons | `{'transfer_then_cs_installment': 3, 'transfer_gap_eq_first_banana_pay': 1}` |
| Void staging CSV | `CS_TKO_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_TKO_transfer_balance_conflicts.csv` |
| Run log | `CS_TKO_transfer_balance_void_20260811_220155.log` |
| Patients | PY002047, PY002062, PY002139, PY002224 |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |



### 2026-08-11 — TKO (clinic_tag=PY)

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch TKO --clinic-tag PY` |
| Open CS bills (bal>0) scanned | 70 |
| Active Banana bills in scope | 367 |
| Void rows | **4** |
| Reasons | `{'transfer_then_cs_installment': 3, 'transfer_gap_eq_first_banana_pay': 1}` |
| Void staging CSV | `CS_TKO_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_TKO_transfer_balance_conflicts.csv` |
| Run log | `CS_TKO_transfer_balance_void_20260811_215550.log` |
| Patients | PY002047, PY002062, PY002139, PY002224 |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |



### 2026-08-11 — TKO (clinic_tag=PY)

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch TKO --clinic-tag PY` |
| Open CS bills (bal>0) scanned | 70 |
| Active Banana bills in scope | 334 |
| Void rows | **0** |
| Reasons | `{}` |
| Void staging CSV | `CS_TKO_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_TKO_transfer_balance_conflicts.csv` |
| Run log | `CS_TKO_transfer_balance_void_20260811_215146.log` |
| Patients | (none) |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |



### 2026-08-11 — TKO (clinic_tag=PY)

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch TKO --clinic-tag PY` |
| Open CS bills (bal>0) scanned | 77 |
| Active Banana bills in scope | 334 |
| Void rows | **7** |
| Reasons | `{'transfer_equal_balance': 6, 'transfer_then_cs_installment': 1}` |
| Void staging CSV | `CS_TKO_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_TKO_transfer_balance_conflicts.csv` |
| Run log | `CS_TKO_transfer_balance_void_20260811_213230.log` |
| Patients | PY000157, PY000974, PY001314, PY001647, PY001842, PY002505, TKO003500 |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |



### 2026-08-10 — MK (clinic_tag=MK)

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch MK --clinic-tag MK` |
| Open CS bills (bal>0) scanned | 41 |
| Active Banana bills in scope | 59 |
| Void rows | **0** |
| Reasons | `{}` |
| Void staging CSV | `CS_MK_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_MK_transfer_balance_conflicts.csv` |
| Run log | `CS_MK_transfer_balance_void_20260810_083235.log` |
| Patients | (none) |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |



### 2026-08-10 — MK (clinic_tag=MK)

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch MK --clinic-tag MK` |
| Open CS bills (bal>0) scanned | 41 |
| Active Banana bills in scope | 59 |
| Void rows | **0** |
| Reasons | `{}` |
| Void staging CSV | `CS_MK_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_MK_transfer_balance_conflicts.csv` |
| Run log | `CS_MK_transfer_balance_void_20260810_083007.log` |
| Patients | (none) |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |



### 2026-08-10 — TKO (clinic_tag=TKO)

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch TKO --clinic-tag TKO` |
| Open CS bills (bal>0) scanned | 50 |
| Active Banana bills in scope | 226 |
| Void rows | **5** |
| Reasons | `{'transfer_then_cs_installment': 5}` |
| Void staging CSV | `CS_TKO_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_TKO_transfer_balance_conflicts.csv` |
| Run log | `CS_TKO_transfer_balance_void_20260810_082111.log` |
| Patients | TKO002933, TKO003500, TKO003538, TKO004090, TKO004419 |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |



### 2026-08-10 — KT (clinic_tag=KT)

| Field | Value |
|-------|-------|
| Operator | clinic migration (Softlink NTK → Banana KT) |
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch KT --clinic-tag KT --out-dir "C:\Users\ROOM 2\Downloads"` |
| Open CS bills (bal>0) scanned | 110 |
| Active Banana bills in scope | 251 |
| Void rows | **11** |
| Reasons | `transfer_then_cs_installment`: 11 |
| Void staging CSV | `CS_KT_transfer_balance_void_staging_for_supabase.csv` |
| Review CSV | `CS_KT_transfer_balance_conflicts.csv` |
| Example | **KT007657** — CS 2025-08-17 bal 8000 + after-pay 1000 → Banana 2026-06-28 tot 9000 (`JSM_PENDING`) |
| Patients voided | KT000696, KT005662, KT007276, KT008061, KT002497, KT005811, KT006362, KT007099, KT007467, KT007602, KT007657 |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | CS bill_date ≠ Banana transfer date by design. Run **after** exact dup void (`find-cs-bill-duplicates.py`). Pipeline reusable: see `CS_TRANSFER_BALANCE_VOID.md`. |
