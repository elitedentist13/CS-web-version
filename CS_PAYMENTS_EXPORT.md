# Clinic Solution → payment history export

Full import workflow (all branches): **`CS_PAYMENTS_SUPABASE_IMPORT.md`**.

## Source tables (CS6)

| Table | Role |
|-------|------|
| `PAYMENTMASTERTABLE` | Bill header (`T_CODE`, totals, received, cancel) |
| `PAYMENTSLAVETABLE` | Treatment / fee line items |
| `PATIENTTABLE` | HKID / name via `P_CODE` |

Amounts in DB are **integer cents** → CSV also exports **HKD** (`/ 100`).  
`CANCELSTATUS`: `0` = active, `1` = cancelled.

## Export (per branch)

32-bit PowerShell:

```bat
%SystemRoot%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass ^
  -File export-cs-payments.ps1 -Branch PL
```

Other CS host:

```bat
... -File export-cs-payments.ps1 -Branch PL -Server "BRANCHPC\CSX" -Database CS6
```

| Output | Contents |
|--------|----------|
| `CS_<BRANCH>_PaymentHistory_<stamp>_master.csv` | One row per bill + patient |
| `CS_<BRANCH>_PaymentHistory_<stamp>_items.csv` | Fee / treatment lines |
| `CS_<BRANCH>_PaymentHistory_<stamp>_income.csv` | Installment receipts (`INCOMETABLE`) with **Method** |
| `*_meta.txt` | Row counts / paths |

## Normalize for Supabase (items + installments)

```bat
python prepare-cs-payments-staging-csv.py ^
  --source "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_*_master.csv" ^
  --items  "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_*_items.csv" ^
  --income "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_*_income.csv" ^
  --branch PL --clinic-tag PL --active-only
```

Always pass **`--items`** (treatment lines) and **`--income`** (installments + payment methods).

## All-in-one (anon API → Banana)

```bat
python run-cs-payments-import.py --branch PL --export ^
  --server "RECEPTION\CSX" --database CS6

rem Or from existing CSVs:
python run-cs-payments-import.py --branch PL ^
  --master "..._master.csv" --items "..._items.csv" --income "..._income.csv"
```

Uses Supabase **anon** key (env `SUPABASE_ANON_KEY` or built-in project key) to upload `cs_payments_staging` and insert `bills` / `bill_payments`.

## Notes

- Payment **method** comes from `INCOMETABLE.METHOD` via `--income` / `payments_json`. Without income CSV, Banana falls back to lump `CS Import`.
- Placeholder patients `CHECKING` / `對數` are skipped by default (see import guide).
- After import, run duplicate detection / void (see import guide §G).
