import csv
import json
import urllib.request
from pathlib import Path

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
H = {"apikey": ANON, "Authorization": f"Bearer {ANON}", "Prefer": "count=exact"}


def head(q: str) -> str:
    req = urllib.request.Request(
        f"{BASE}/{q}&limit=1", headers={**H, "Range": "0-0"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.headers.get("Content-Range") or ""


p = Path(r"C:\Users\joyfu\Downloads\CS_TKO_bill_duplicate_conflicts.csv")
rows = list(csv.DictReader(p.open(encoding="utf-8-sig")))
print("review_rows", len(rows))
for r in rows:
    print(json.dumps(r, ensure_ascii=False))

print("voided_CS_DUP", head("bills?notes=like.*CS_DUP_VOID:*&select=id"))
print("active_CS_TXN", head("bills?notes=like.*CS_TXN:*&voided_at=is.null&select=id"))
print("voided_CS_TXN", head("bills?notes=like.*CS_TXN:*&voided_at=not.is.null&select=id"))
print(
    "active_CS_TXN_TKO_patients_approx_via_bill_type",
    head("bills?bill_type=eq.CS Import&voided_at=is.null&select=id"),
)
