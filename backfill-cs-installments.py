"""
Backfill CS bill_payments from Clinic Solution INCOMETABLE (installments).

Replaces the single lump-sum 'CS Import' payment row with one bill_payments
row per income receipt (date + amount + method).

Usage:
  # 1) Export income (32-bit PowerShell):
  #    .\\_export-cs-income.ps1 -Server '192.168.50.2\\SOFTLINK' -OutDir C:\\Users\\joyfu\\Downloads
  # 2) Backfill Softlink MK + OKT:
  python backfill-cs-installments.py ^
    --income-csv C:\\Users\\joyfu\\Downloads\\CS_SOFTLINK_Income_....csv ^
    --clinic-map "MK=MK;KAI TAK=OKT" ^
    --out-dir C:\\Users\\joyfu\\Downloads

Idempotent: skips bills that already have CS_INCOME: payment notes (unless --force).
"""
from __future__ import annotations

import argparse
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


def get_all(q: str) -> list:
    rows: list = []
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


def api(method: str, path: str, body=None, prefer: str = "return=representation"):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    headers = {
        "apikey": ANON,
        "Authorization": f"Bearer {ANON}",
        "Prefer": prefer,
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + "/" + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} {e.code} {e.read().decode()[:400]}") from e


def parse_clinic_map(raw: str) -> dict[str, str]:
    out = {}
    for part in (raw or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip().upper()] = re.sub(r"[^A-Z0-9_-]", "", v.strip().upper())
    return out


def parse_date(d: str) -> str | None:
    s = (d or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return None


def chart_lookup_keys(chart: str, branch: str) -> list[str]:
    """Ordered candidate patient_no keys for a CS chart within a banana branch.

    Never returns bare digits alone — those collide across MK/OKT.
    """
    c = (chart or "").strip().upper()
    if not c:
        return []
    keys: list[str] = []

    def add(k: str) -> None:
        if k and k not in keys:
            keys.append(k)

    add(c)
    m = re.match(r"^([A-Z]+)(\d+)$", c)
    if m:
        pref, digits_raw = m.group(1), m.group(2)
        digits = digits_raw.lstrip("0") or "0"
        add(pref + digits_raw)
        add(pref + digits)
        for w in (4, 5, 6, len(digits_raw)):
            add(pref + digits.zfill(w))
        return keys

    # Numeric Softlink chart (typical MK) → MK001557 etc.
    digits = c.lstrip("0") or "0"
    if branch:
        add(branch + c)
        add(branch + digits)
        for w in (4, 5, 6, max(len(c), len(digits))):
            add(branch + c.zfill(w))
            add(branch + digits.zfill(w))
    return keys


def extract_txn_markers(notes: str) -> list[tuple[str | None, str]]:
    """Return list of (branch_or_None, txn)."""
    out = []
    for m in re.finditer(r"CS_TXN:(?:([A-Z][A-Z0-9_-]*):)?([0-9]{8,})", notes or ""):
        out.append((m.group(1), m.group(2)))
    return out


def income_note(branch: str, txn: str, paid_date: str, ts: str, cents: int, method: str, seq: int) -> str:
    # Stable idempotency key in notes
    ts_compact = re.sub(r"[^0-9]", "", ts or "")[:14] or paid_date.replace("-", "")
    meth = re.sub(r"[^A-Z0-9]+", "", (method or "CS").upper())[:20] or "CS"
    return f"CS_INCOME:{branch}:{txn}:{ts_compact}:{cents}:{meth}:{seq}"


def load_income(path: Path, clinic_map: dict[str, str]) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            status = str(r.get("Status") or "0").strip()
            if status not in ("", "0"):
                continue
            clinic_raw = (r.get("ClinicCode") or r.get("MasterClinicCode") or "").strip().upper()
            branch = clinic_map.get(clinic_raw)
            if not branch and clinic_raw in clinic_map.values():
                branch = clinic_raw
            if not branch:
                # try fuzzy: contains
                for k, v in clinic_map.items():
                    if k in clinic_raw or clinic_raw in k:
                        branch = v
                        break
            if not branch:
                continue
            txn = (r.get("TxnCode") or "").strip()
            chart = (r.get("ChartNo") or "").strip()
            if not txn or not chart:
                continue
            try:
                cents = int(float(r.get("AmountCents") or 0))
            except ValueError:
                cents = int(round(float(r.get("AmountHkd") or 0) * 100))
            amt = cents / 100.0
            if amt <= 0.0005:
                continue
            rows.append(
                {
                    "branch": branch,
                    "txn": txn,
                    "chart": chart,
                    "paid_date": parse_date(r.get("PaidDate") or "") or parse_date(r.get("BillDate") or ""),
                    "paid_ts": (r.get("PaidTimestamp") or "").strip(),
                    "method": (r.get("Method") or "CS Import").strip() or "CS Import",
                    "amount": amt,
                    "cents": cents,
                    "clinic_raw": clinic_raw,
                }
            )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--income-csv", required=True)
    ap.add_argument(
        "--clinic-map",
        default="MK=MK;KAI TAK=OKT",
        help="CS CLINICCODE=BananaTag;...",
    )
    ap.add_argument("--out-dir", default=r"C:\Users\joyfu\Downloads")
    ap.add_argument("--force", action="store_true", help="Re-expand even if CS_INCOME already present")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    t0 = time.time()
    clinic_map = parse_clinic_map(args.clinic_map)
    branches = sorted(set(clinic_map.values()))
    print("CLINIC_MAP", clinic_map)
    print("BRANCHES", branches)

    income = load_income(Path(args.income_csv), clinic_map)
    print("INCOME_ROWS", len(income))
    by_key: dict[tuple[str, str, str], list] = defaultdict(list)
    for r in income:
        by_key[(r["branch"], r["txn"], r["chart"].upper())].append(r)
    for lst in by_key.values():
        lst.sort(key=lambda x: (x.get("paid_ts") or "", x.get("paid_date") or "", x["cents"]))
    print("INCOME_GROUPS", len(by_key))
    multi = sum(1 for lst in by_key.values() if len(lst) >= 2)
    print("MULTI_PAY_GROUPS", multi)

    # Patients for target clinics
    patients = []
    for b in branches:
        patients.extend(
            get_all(
                f"patients?clinic_tag=eq.{b}&select=id,patient_no,clinic_tag"
            )
        )
    print("PATIENTS", len(patients))
    # Exact patient_no → pid only (safe). Lookup builds branch-qualified keys.
    pid_by_pno: dict[str, str] = {}
    pno_by_pid: dict[str, str] = {}
    for p in patients:
        pid = p["id"]
        pno = (p.get("patient_no") or "").strip().upper()
        if not pno:
            continue
        pno_by_pid[pid] = pno
        pid_by_pno.setdefault(pno, pid)

    # CS bills for these patients (and any with qualified markers)
    print("Loading CS bills…")
    cs_bills = get_all(
        "bills?notes=like.*CS_TXN:*&voided_at=is.null&select=id,patient_id,patient_no,"
        "total,amount_paid,balance,notes"
    )
    # Keep bills for our branches (patient clinic or qualified note)
    branch_set = set(branches)
    bills = []
    for b in cs_bills:
        notes = b.get("notes") or ""
        markers = extract_txn_markers(notes)
        pno = (b.get("patient_no") or "").strip().upper()
        keep = False
        for br, _txn in markers:
            if br in branch_set:
                keep = True
                break
        if not keep and pno:
            for br in branches:
                if pno.startswith(br):
                    keep = True
                    break
        if keep:
            bills.append(b)
    print("CS_BILLS_IN_SCOPE", len(bills), "of", len(cs_bills))

    # Index bills: (branch, txn) -> list; (patient_id, txn) -> bill
    by_branch_txn: dict[tuple[str, str], list] = defaultdict(list)
    by_pid_txn: dict[tuple[str, str], list] = defaultdict(list)
    for b in bills:
        markers = extract_txn_markers(b.get("notes") or "")
        pid = b.get("patient_id")
        for br, txn in markers:
            if br:
                by_branch_txn[(br, txn)].append(b)
            if pid and txn:
                by_pid_txn[(pid, txn)].append(b)

    # Existing payments for these bills (to detect CS_INCOME / lump)
    bill_ids = [b["id"] for b in bills]
    print("Loading bill_payments…")
    pays_by_bill: dict[str, list] = defaultdict(list)
    for i in range(0, len(bill_ids), 80):
        chunk = bill_ids[i : i + 80]
        for p in get_all(
            f"bill_payments?bill_id=in.({','.join(chunk)})"
            "&select=id,bill_id,paid_date,amount,method,notes,clinic_tag"
        ):
            pays_by_bill[p["bill_id"]].append(p)
    print("PAYMENT_ROWS_LOADED", sum(len(v) for v in pays_by_bill.values()))

    audit = []
    stats = Counter()

    work = []
    for (branch, txn, chart), receipts in by_key.items():
        # resolve patient via branch-safe chart keys
        pid = None
        for k in chart_lookup_keys(chart, branch):
            if k in pid_by_pno:
                pid = pid_by_pno[k]
                break
        bill = None
        cands = by_branch_txn.get((branch, txn), [])
        if pid:
            cands_pid = [b for b in cands if b.get("patient_id") == pid]
            if cands_pid:
                bill = cands_pid[0]
            else:
                cands2 = by_pid_txn.get((pid, txn), [])
                if cands2:
                    bill = cands2[0]
                elif cands:
                    # Qualified CS_TXN:BRANCH:txn exists on another patient — do not attach
                    stats["skip_txn_patient_mismatch"] += 1
                    audit.append(
                        {
                            "action": "skip_txn_patient_mismatch",
                            "branch": branch,
                            "txn": txn,
                            "chart": chart,
                            "n_income": len(receipts),
                        }
                    )
                    continue
        elif cands and len(cands) == 1:
            bill = cands[0]
        if bill is None:
            stats["skip_no_bill"] += 1
            continue

        existing = pays_by_bill.get(bill["id"], [])
        has_income = any("CS_INCOME:" in (p.get("notes") or "") for p in existing)
        if has_income and not args.force:
            stats["skip_already"] += 1
            continue

        # Only expand when useful (2+ receipts) OR 1 receipt with better method/date than lump
        # Always expand when 2+; for 1 receipt still replace lump so method is preserved
        lump = [
            p
            for p in existing
            if "CS_INCOME:" not in (p.get("notes") or "")
            and (
                (p.get("notes") or "").startswith("CS_TXN:")
                or (p.get("method") or "") == "CS Import"
            )
        ]
        work.append(
            {
                "branch": branch,
                "txn": txn,
                "chart": chart,
                "bill": bill,
                "receipts": receipts,
                "lump": lump,
                "existing_income": [p for p in existing if "CS_INCOME:" in (p.get("notes") or "")],
            }
        )

    print("TO_EXPAND", len(work))
    print(
        "SKIP",
        {
            k: stats[k]
            for k in (
                "skip_already",
                "skip_no_bill",
                "skip_txn_patient_mismatch",
            )
        },
    )

    if args.dry_run:
        for w in work[:15]:
            print(
                "DRY",
                w["branch"],
                w["txn"],
                w["bill"].get("patient_no"),
                f"n={len(w['receipts'])}",
                f"lump={len(w['lump'])}",
            )
        print("DRY_RUN_DONE", len(work))
        return

    def expand_one(w: dict) -> dict:
        bill = w["bill"]
        branch = w["branch"]
        txn = w["txn"]
        # delete prior income if force
        for p in w["existing_income"]:
            api("DELETE", f"bill_payments?id=eq.{p['id']}", prefer="return=minimal")
        # delete lump CS Import rows
        for p in w["lump"]:
            api("DELETE", f"bill_payments?id=eq.{p['id']}", prefer="return=minimal")

        inserted = 0
        for seq, r in enumerate(w["receipts"], start=1):
            note = income_note(
                branch, txn, r["paid_date"] or "", r["paid_ts"], r["cents"], r["method"], seq
            )
            body = {
                "bill_id": bill["id"],
                "paid_date": r["paid_date"],
                "amount": r["amount"],
                "method": r["method"],
                "notes": note,
                "clinic_tag": branch,
            }
            if r.get("paid_ts"):
                # store HK timestamp if column accepts timestamptz via created_at only — skip if not in schema
                pass
            api("POST", "bill_payments", body)
            inserted += 1

        income_sum = round(sum(r["amount"] for r in w["receipts"]), 2)
        return {
            "action": "expanded",
            "branch": branch,
            "txn": txn,
            "chart": w["chart"],
            "patient_no": bill.get("patient_no"),
            "bill_id": bill["id"],
            "n_income": inserted,
            "income_sum": income_sum,
            "bill_amount_paid": bill.get("amount_paid"),
            "removed_lump": len(w["lump"]),
        }

    done = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = {ex.submit(expand_one, w): w for w in work}
        for fut in as_completed(futs):
            w = futs[fut]
            try:
                row = fut.result()
                audit.append(row)
                stats["expanded"] += 1
                if len(w["receipts"]) >= 2:
                    stats["expanded_multi"] += 1
            except Exception as e:
                errors += 1
                stats["error"] += 1
                audit.append(
                    {
                        "action": "error",
                        "branch": w["branch"],
                        "txn": w["txn"],
                        "chart": w["chart"],
                        "patient_no": w["bill"].get("patient_no"),
                        "error": str(e)[:300],
                    }
                )
            done += 1
            if done % 100 == 0 or done == len(work):
                print(f"  … progress {done}/{len(work)} ok={stats['expanded']} err={errors}")

    out = Path(args.out_dir) / "CS_installment_backfill_audit.csv"
    fields = [
        "action",
        "branch",
        "txn",
        "chart",
        "patient_no",
        "bill_id",
        "n_income",
        "income_sum",
        "bill_amount_paid",
        "removed_lump",
        "error",
    ]
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(audit)

    print("\n=== SUMMARY ===")
    print(dict(stats))
    print("AUDIT", out)
    print(f"ELAPSED {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
