import json
import urllib.request

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"


def get(q: str):
    req = urllib.request.Request(
        BASE + "/" + q,
        headers={"apikey": ANON, "Authorization": "Bearer " + ANON},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


for q in [
    "bills?notes=like.*CS_TXN:MK:202410310012*&select=id,patient_id,patient_no,total,amount_paid,balance,notes&limit=3",
    "bills?notes=like.*CS_TXN:OKT:202207220012*&select=id,patient_id,patient_no,total,amount_paid,balance,notes&limit=3",
]:
    b = get(q)
    print("Q", q.split("?")[1][:60], "n=", len(b))
    if not b:
        continue
    print(json.dumps(b[0], indent=2)[:500])
    pid = b[0]["id"]
    p = get(f"bill_payments?bill_id=eq.{pid}&select=id,bill_id,paid_date,amount,method,notes,clinic_tag,created_at")
    print("payments", json.dumps(p, indent=2)[:1500])
    print("---")
