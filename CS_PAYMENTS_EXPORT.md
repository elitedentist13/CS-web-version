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
| `*_meta.txt` | Row counts / paths |

## Normalize for Supabase (include items)

```bat
python prepare-cs-payments-staging-csv.py ^
  --source "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_*_master.csv" ^
  --items  "C:\Users\Doctor-1\Downloads\CS_PL_PaymentHistory_*_items.csv" ^
  --branch PL --clinic-tag PL --active-only
```

Always pass **`--items`** so `bills.items` get real treatment names on insert.

## Notes

- Payment **method** is not stored per CS txn → Banana uses `CS Import`.
- Placeholder patients `CHECKING` / `對數` are skipped by default (see import guide).
- After import, run duplicate detection / void (see import guide §G).
