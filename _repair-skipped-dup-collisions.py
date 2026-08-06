"""
Scan CS payment staging skipped_dup for cross-clinic CS_TXN collisions
and insert missing Softlink bills onto the matched patient.

Collision = existing bills.notes contains CS_TXN:<txn> but that bill belongs
to a DIFFERENT patient than staging.matched_patient_id.

Repaired notes use CS_TXN:<BRANCH>:<txn> so they won't collide again.
"""
from __future__ import annotations

import csv
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
OUT = Path(r"C:\Users\joyfu\Downloads")

# Softlink payment batches to repair
BATCHES = [
    ("OKT_PAY_20260806_141904", "OKT"),
    ("MK_PAY_20260806_173116", "MK"),
    # resolve batches that may have inserted some; also scan their skipped if any
    ("OKT_PAY_RESOLVE_20260806_175051", "OKT"),
    ("OKT_PAY_RESOLVE2_20260806_182110", "OKT"),
]


def get_all(q: str) -> list:
    rows = []
    offset = 0
    page = 1000
    while True:
        url = f"{BASE}/{q}&limit={page}&offset={offset}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": ANON,
                "Authorization": f"Bearer {ANON}",
                "Range": f"{offset}-{offset + page - 1}",
            },
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            chunk = json.loads(resp.read().decode())
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def api(method: str, path: str, body):
    data = json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(
        BASE + "/" + path,
        data=data,
        method=method,
        headers={
            "apikey": ANON,
            "Authorization": f"Bearer {ANON}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} {e.code} {e.read().decode()[:400]}") from e


def parse_date(d: str) -> str | None:
    s = (d or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return None


def txn_in_notes(notes: str, txn: str) -> bool:
    n = notes or ""
    # match CS_TXN:txn or CS_TXN:BRANCH:txn
    return f"CS_TXN:{txn}" in n or f"CS_TXN:{txn} " in n or n.endswith(f"CS_TXN:{txn}")


def main() -> None:
    t0 = time.time()
    skipped = []
    for batch_id, branch in BATCHES:
        rows = get_all(
            f"cs_payments_staging?batch_id=eq.{batch_id}"
            "&import_status=eq.skipped_dup"
            "&select=import_key,batch_id,branch_code,banana_clinic_tag,txn_code,bill_date,"
            "bill_timestamp,chart_no,hkid_raw,hkid_norm,name_en,doctor_code,"
            "net_hkd,discount_hkd,received_hkd,balance_hkd,items_json,"
            "matched_patient_id,matched_patient_no,resolved_patient_id,inserted_bill_id"
        )
        print(f"BATCH {batch_id} skipped_dup={len(rows)}")
        for r in rows:
            r["_branch"] = branch
            skipped.append(r)

    print("TOTAL_SKIPPED_DUP", len(skipped))

    # Unique txns to look up existing bills
    txns = sorted({(r.get("txn_code") or "").strip() for r in skipped if r.get("txn_code")})
    print("UNIQUE_TXNS", len(txns))

    # Load bills that mention these txns — query in chunks by ilike is hard;
    # instead load all CS Import bills notes containing CS_TXN (paginated)
    print("Loading CS Import bills…")
    cs_bills = get_all(
        "bills?notes=like.*CS_TXN:*&select=id,patient_id,bill_date,total,amount_paid,"
        "balance,notes,voided_at,items,bill_type"
    )
    print("CS_TXN_BILLS", len(cs_bills))

    bills_by_txn: dict[str, list] = defaultdict(list)
    for b in cs_bills:
        notes = b.get("notes") or ""
        # extract all txn-like tokens after CS_TXN:
        for m in re.finditer(r"CS_TXN:(?:[A-Z]+:)?([0-9]{8,})", notes):
            bills_by_txn[m.group(1)].append(b)

    # Patient cache
    need_pids = set()
    for r in skipped:
        pid = r.get("matched_patient_id") or r.get("resolved_patient_id")
        if pid:
            need_pids.add(pid)
    for lst in bills_by_txn.values():
        for b in lst:
            if b.get("patient_id"):
                need_pids.add(b["patient_id"])

    patients = {}
    pids = sorted(need_pids)
    for i in range(0, len(pids), 80):
        chunk = pids[i : i + 80]
        for p in get_all(
            f"patients?id=in.({','.join(chunk)})"
            "&select=id,patient_no,clinic_tag,full_name"
        ):
            patients[p["id"]] = p
    print("PATIENTS_CACHED", len(patients))

    # Existing bills per patient (to avoid double repair)
    # Check for CS_TXN:BRANCH:txn already on target
    collisions = []
    true_dups = []
    no_patient = []
    already_repaired = []

    for r in skipped:
        txn = (r.get("txn_code") or "").strip()
        branch = r["_branch"]
        target = r.get("matched_patient_id") or r.get("resolved_patient_id")
        if not target:
            no_patient.append(r)
            continue
        if not txn:
            continue

        existing = bills_by_txn.get(txn, [])
        # Also treat CS_TXN:BRANCH:txn as same logical softlink bill
        qual = f"{branch}:{txn}"
        on_target_unqual = [
            b
            for b in existing
            if b.get("patient_id") == target and not b.get("voided_at")
        ]
        # any bill on target with qualified marker
        target_bills_notes = []
        # lazy: search in cs_bills for this patient+txn
        on_target_qual = [
            b
            for b in cs_bills
            if b.get("patient_id") == target
            and not b.get("voided_at")
            and (
                f"CS_TXN:{branch}:{txn}" in (b.get("notes") or "")
                or (
                    f"CS_TXN:{txn}" in (b.get("notes") or "")
                    and b.get("patient_id") == target
                )
            )
        ]

        if on_target_unqual or on_target_qual:
            # true dup for this patient
            true_dups.append(r)
            continue

        # collision if some other patient has CS_TXN:txn (unqualified)
        other = [
            b
            for b in existing
            if b.get("patient_id") != target
            and not b.get("voided_at")
            and f"CS_TXN:{txn}" in (b.get("notes") or "")
            and f"CS_TXN:{branch}:{txn}" not in (b.get("notes") or "")
        ]
        # also if inserted_bill_id points to wrong patient
        ib = r.get("inserted_bill_id")
        if ib:
            for b in cs_bills:
                if b.get("id") == ib and b.get("patient_id") != target:
                    other.append(b)

        if other or (existing and not on_target_unqual):
            # If existing only on others → collision needing repair
            if other or (existing and all(b.get("patient_id") != target for b in existing)):
                collisions.append((r, other[:3]))
            else:
                true_dups.append(r)
        else:
            # skipped_dup but no existing bill found? still try insert
            collisions.append((r, []))

    print("TRUE_DUP_SAME_PATIENT", len(true_dups))
    print("COLLISION_OR_MISSING", len(collisions))
    print("NO_MATCHED_PATIENT", len(no_patient))

    audit = []
    inserted = 0
    payments = 0
    errors = 0
    skipped_zeroish = 0

    # Dedupe collisions by (branch, txn, target patient)
    seen = set()
    unique_collisions = []
    for r, others in collisions:
        txn = (r.get("txn_code") or "").strip()
        branch = r["_branch"]
        target = r.get("matched_patient_id") or r.get("resolved_patient_id")
        key = (branch, txn, target)
        if key in seen:
            continue
        seen.add(key)
        unique_collisions.append((r, others))
    print("UNIQUE_TO_REPAIR", len(unique_collisions))

    # Index already-qualified markers for O(1) resume
    qual_on_patient: set[tuple[str, str, str]] = set()
    for b in cs_bills:
        if b.get("voided_at"):
            continue
        notes = b.get("notes") or ""
        pid = b.get("patient_id") or ""
        for m in re.finditer(r"CS_TXN:([A-Z]+):([0-9]{8,})", notes):
            qual_on_patient.add((m.group(1), m.group(2), pid))

    work = []
    for r, others in unique_collisions:
        txn = (r.get("txn_code") or "").strip()
        branch = r["_branch"]
        target = r.get("matched_patient_id") or r.get("resolved_patient_id")
        p = patients.get(target) or {}
        notes = f"CS_TXN:{branch}:{txn}"
        if r.get("doctor_code"):
            notes += f" | Doctor: {r.get('doctor_code')}"

        if (branch, txn, target) in qual_on_patient:
            already_repaired.append(r)
            audit.append(
                {
                    "action": "already_repaired",
                    "branch": branch,
                    "txn_code": txn,
                    "chart_no": r.get("chart_no"),
                    "patient_no": p.get("patient_no"),
                    "net_hkd": r.get("net_hkd"),
                }
            )
            continue

        try:
            items_raw = r.get("items_json") or ""
            items = json.loads(items_raw) if items_raw.strip() else []
        except json.JSONDecodeError:
            items = []

        total = float(r.get("net_hkd") or 0)
        paid = float(r.get("received_hkd") or 0)
        bal = float(r.get("balance_hkd") or (total - paid))
        if total == 0 and paid == 0 and not items:
            skipped_zeroish += 1
            audit.append(
                {
                    "action": "skip_zero",
                    "branch": branch,
                    "txn_code": txn,
                    "chart_no": r.get("chart_no"),
                    "patient_no": p.get("patient_no"),
                }
            )
            continue

        if not items:
            items = [
                {
                    "desc": "CS imported bill",
                    "qty": 1,
                    "price": total,
                    "disc": 0,
                    "tooth_no": "-",
                }
            ]

        status = "Paid" if bal <= 0.009 else ("Partial" if paid > 0 else "Unpaid")
        bill_date = parse_date(r.get("bill_date") or "")
        other_pnos = []
        for b in others:
            op = patients.get(b.get("patient_id") or "")
            if op:
                other_pnos.append(
                    f"{op.get('patient_no')}/{op.get('clinic_tag')}"
                )

        work.append(
            {
                "r": r,
                "branch": branch,
                "txn": txn,
                "target": target,
                "p": p,
                "notes": notes,
                "items": items,
                "total": total,
                "paid": paid,
                "bal": bal,
                "status": status,
                "bill_date": bill_date,
                "other_pnos": other_pnos,
            }
        )

    print(f"TO_INSERT {len(work)} (already_repaired={len(already_repaired)})")

    def insert_one(w: dict) -> dict:
        bill = {
            "patient_id": w["target"],
            "patient_no": w["p"].get("patient_no"),
            "patient_name": (w["r"].get("name_en") or w["p"].get("full_name") or "").strip()
            or None,
            "bill_date": w["bill_date"],
            "bill_type": "CS Import",
            "items": w["items"],
            "discount": float(w["r"].get("discount_hkd") or 0),
            "total": w["total"],
            "amount_paid": w["paid"],
            "balance": w["bal"],
            "status": w["status"],
            "notes": w["notes"],
            "dentist_name": (w["r"].get("doctor_code") or "").strip() or None,
        }
        rows = api("POST", "bills", bill)
        bill_id = rows[0]["id"]
        pay_n = 0
        if w["paid"] > 0.005:
            api(
                "POST",
                "bill_payments",
                {
                    "bill_id": bill_id,
                    "paid_date": w["bill_date"],
                    "amount": w["paid"],
                    "method": "CS Import",
                    "notes": w["notes"],
                    "clinic_tag": w["branch"],
                },
            )
            pay_n = 1
        return {
            "action": "inserted",
            "branch": w["branch"],
            "txn_code": w["txn"],
            "chart_no": w["r"].get("chart_no"),
            "patient_no": w["p"].get("patient_no"),
            "clinic_tag": w["p"].get("clinic_tag"),
            "bill_date": w["bill_date"],
            "net_hkd": w["total"],
            "received_hkd": w["paid"],
            "new_bill_id": bill_id,
            "collided_with": ";".join(w["other_pnos"][:5]),
            "items_snip": " | ".join(
                str(i.get("desc") or "")[:40] for i in w["items"][:4]
            ),
            "_pay_n": pay_n,
        }

    workers = 8
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(insert_one, w): w for w in work}
        for fut in as_completed(futs):
            w = futs[fut]
            try:
                row = fut.result()
                payments += row.pop("_pay_n", 0)
                inserted += 1
                audit.append(row)
            except Exception as e:
                errors += 1
                audit.append(
                    {
                        "action": "error",
                        "branch": w["branch"],
                        "txn_code": w["txn"],
                        "chart_no": w["r"].get("chart_no"),
                        "patient_no": w["p"].get("patient_no"),
                        "error": str(e)[:300],
                    }
                )
            done += 1
            if done % 100 == 0 or done == len(work):
                print(f"  … progress {done}/{len(work)} ok={inserted} err={errors}")

    audit_path = OUT / "CS_skipped_dup_collision_repair_audit.csv"
    with audit_path.open("w", encoding="utf-8-sig", newline="") as f:
        fields = [
            "action",
            "branch",
            "txn_code",
            "chart_no",
            "patient_no",
            "clinic_tag",
            "bill_date",
            "net_hkd",
            "received_hkd",
            "new_bill_id",
            "collided_with",
            "items_snip",
            "error",
        ]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(audit)

    print("\n=== SUMMARY ===")
    print("INSERTED_BILLS", inserted)
    print("PAYMENTS", payments)
    print("ERRORS", errors)
    print("SKIP_ZERO", skipped_zeroish)
    print("ALREADY_REPAIRED", len(already_repaired))
    print("TRUE_DUP_LEFT", len(true_dups))
    print("ACTIONS", dict(Counter(a["action"] for a in audit)))
    print("AUDIT", audit_path)
    # ceramic spot
    ceramic = [a for a in audit if "CERAMIC" in (a.get("items_snip") or "").upper()]
    print("CERAMIC_REPAIRED", len(ceramic))
    for a in ceramic[:10]:
        print(" ", a.get("patient_no"), a.get("txn_code"), a.get("items_snip"))
    print(f"ELAPSED {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
