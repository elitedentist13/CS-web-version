import csv
import json
from collections import Counter
from pathlib import Path

src = Path(
    r"C:\Users\Doctor-1\.cursor\projects\c-Users-Doctor-1-Downloads-CS-web-version-main-6-CS-web-version-main\agent-tools\7f1b08ff-5e4c-47ae-bcd2-cbde4a782191.txt"
)
out = Path(r"C:\Users\Doctor-1\Downloads\CS_TKO_unmatched_for_manual.csv")

data = json.loads(src.read_text(encoding="utf-8"))
print("unmatched_count", len(data))
print("errors", dict(Counter(r.get("import_error") for r in data)))

cols = [
    "chart_no",
    "hkid_raw",
    "hkid_norm",
    "name_en",
    "name_other",
    "dob",
    "sex",
    "visit_date",
    "visit_at",
    "clinic_code",
    "doctor_code",
    "import_error",
    "notes",
]
rows = sorted(data, key=lambda x: (x.get("chart_no") or "", x.get("visit_at") or ""))
with out.open("w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({c: (r.get(c) or "") for c in cols})

print("OUT", out)
for r in rows[:20]:
    note = (r.get("notes") or "").replace("\r", " ").replace("\n", " ")[:50]
    print(
        f"{r.get('chart_no')}\t{r.get('hkid_raw')}\t{r.get('name_en')}\t"
        f"{r.get('visit_date')}\t{r.get('doctor_code')}\t{r.get('import_error')}\t{note}"
    )
if len(rows) > 20:
    print(f"... and {len(rows) - 20} more (see CSV)")
