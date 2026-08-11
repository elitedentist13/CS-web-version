"""
Export unmatched CS payments/notes, run resolve-*.py per batch, then
upload resolve staging + insert into Banana via anon REST.

Usage:
  python _export-and-resolve-unmatched.py
  python _export-and-resolve-unmatched.py --skip-insert
  python _export-and-resolve-unmatched.py --payments-only
  python _export-and-resolve-unmatched.py --notes-only
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = Path.home() / "Downloads" / f"CS_resolve_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def api(method: str, path: str, body=None, prefer: str = "return=minimal"):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": ANON,
        "Authorization": f"Bearer {ANON}",
        "Prefer": prefer,
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + "/" + path.lstrip("/"), data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode('utf-8', errors='replace')[:600]}") from e


def get_all(path_query: str, page: int = 1000) -> list:
    rows: list = []
    offset = 0
    while True:
        sep = "&" if "?" in path_query else "?"
        url = f"{BASE}/{path_query}{sep}limit={page}&offset={offset}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": ANON,
                "Authorization": f"Bearer {ANON}",
                "Prefer": "count=exact",
                "Range": f"{offset}-{offset + page - 1}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                chunk = json.loads(resp.read().decode("utf-8") or "[]")
        except urllib.error.HTTPError as e:
            # 416 = empty page / past end
            if e.code == 416:
                break
            raise
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    # union of keys
    keys: list[str] = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in keys})


def norm_tag(s: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (s or "").strip().upper())


def parse_bill_date(raw: str) -> str | None:
    s = (raw or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return None if not s else s[:10]


def fnum(v, default=0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def export_unmatched(out_dir: Path) -> tuple[list[dict], list[dict], list[dict]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    pay_um = get_all("cs_payments_staging?import_status=eq.unmatched&select=*&order=batch_id")
    pay_pending = get_all("cs_payments_staging?import_status=eq.pending&select=*&order=batch_id")
    notes_um = get_all("cs_notes_staging?import_status=eq.unmatched&select=*&order=batch_id")

    write_csv(out_dir / "export_payments_unmatched.csv", pay_um)
    write_csv(out_dir / "export_payments_pending.csv", pay_pending)
    write_csv(out_dir / "export_notes_unmatched.csv", notes_um)

    # summary
    summary = out_dir / "export_summary.txt"
    lines = [
        f"exported_at={datetime.now().isoformat(timespec='seconds')}",
        f"payments_unmatched={len(pay_um)}",
        f"payments_pending={len(pay_pending)}",
        f"notes_unmatched={len(notes_um)}",
        "",
        "payments_unmatched_by_batch:",
    ]
    for b, n in Counter(r.get("batch_id") or "?" for r in pay_um).most_common():
        lines.append(f"  {b}\t{n}")
    lines.append("payments_pending_by_batch:")
    for b, n in Counter(r.get("batch_id") or "?" for r in pay_pending).most_common():
        lines.append(f"  {b}\t{n}")
    lines.append("notes_unmatched_by_batch:")
    for b, n in Counter(r.get("batch_id") or "?" for r in notes_um).most_common():
        lines.append(f"  {b}\t{n}")
    summary.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(summary.read_text(encoding="utf-8"))
    print("EXPORT_DIR", out_dir)
    return pay_um, pay_pending, notes_um


# ---------------------------------------------------------------------------
# Run resolve scripts
# ---------------------------------------------------------------------------
def run_cmd(cmd: list[str]) -> str:
    print("RUN", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    sys.stdout.write(proc.stdout or "")
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or "")
        raise SystemExit(f"Command failed ({proc.returncode}): {' '.join(cmd)}")
    return proc.stdout or ""


def branch_from_batch(batch_id: str, row_branch: str | None = None) -> str:
    if row_branch and norm_tag(row_branch):
        return norm_tag(row_branch)
    b = (batch_id or "").strip()
    # e.g. TKO_PAY_..., OKT_20260806_..., KT_PAY_RESOLVE_...
    m = re.match(r"^([A-Z][A-Z0-9_-]*?)(?:_PAY|_RESOLVE|_20|_NOTES)", b, re.I)
    if m:
        return norm_tag(m.group(1))
    # first token
    return norm_tag(b.split("_")[0] if b else "XX")


def run_payment_resolves(pay_um: list[dict], out_dir: Path) -> list[tuple[str, Path]]:
    """Returns list of (new_batch_id, staging_csv_path)."""
    by_batch: dict[str, list] = defaultdict(list)
    for r in pay_um:
        by_batch[r.get("batch_id") or "?"].append(r)

    produced: list[tuple[str, Path]] = []
    script = ROOT / "resolve-unmatched-payments.py"
    for src_batch, rows in sorted(by_batch.items(), key=lambda x: -len(x[1])):
        if src_batch == "?" or not src_batch:
            print("SKIP payments batch with blank batch_id", len(rows))
            continue
        # Don't re-resolve an already-resolve batch that is unmatched leftovers
        branch = branch_from_batch(src_batch, rows[0].get("branch_code"))
        clinic = norm_tag(rows[0].get("banana_clinic_tag")) or branch
        out = run_cmd(
            [
                sys.executable,
                str(script),
                "--branch",
                branch,
                "--batch-id",
                src_batch,
                "--clinic-tag",
                clinic,
                "--out-dir",
                str(out_dir),
            ]
        )
        batch_id = ""
        staging = out_dir / f"CS_{branch}_PaymentHistory_resolve_staging_for_supabase.csv"
        for line in out.splitlines():
            if line.startswith("BATCH_ID "):
                batch_id = line[9:].strip()
            if line.startswith("STAGING "):
                # STAGING path (n)
                staging = Path(line[8:].split(" (")[0].strip())
        # rename staging to include batch stamp so branches don't overwrite each other
        if staging.exists() and batch_id:
            dest = out_dir / f"CS_{branch}_PaymentHistory_{batch_id}_resolve_staging.csv"
            if dest.resolve() != staging.resolve():
                dest.write_bytes(staging.read_bytes())
                # also keep map/still with batch id
                for kind in ("resolve_patient_map", "still_unmatched_manual"):
                    src = out_dir / f"CS_{branch}_PaymentHistory_{kind}.csv"
                    if src.exists():
                        (out_dir / f"CS_{branch}_PaymentHistory_{batch_id}_{kind}.csv").write_bytes(
                            src.read_bytes()
                        )
                staging = dest
            produced.append((batch_id, staging))
            print("PRODUCED_PAY", batch_id, staging)
    return produced


def run_notes_resolves(notes_um: list[dict], out_dir: Path) -> list[tuple[str, Path]]:
    by_batch: dict[str, list] = defaultdict(list)
    for r in notes_um:
        by_batch[r.get("batch_id") or "?"].append(r)

    produced: list[tuple[str, Path]] = []
    script = ROOT / "resolve-unmatched-notes.py"
    for src_batch, rows in sorted(by_batch.items(), key=lambda x: -len(x[1])):
        if src_batch == "?" or not src_batch:
            # try banana_clinic_tag grouping export only
            print("SKIP notes blank batch_id", len(rows), "- written in export only")
            write_csv(out_dir / "export_notes_unmatched_blank_batch.csv", rows)
            continue
        branch = branch_from_batch(src_batch, rows[0].get("branch_code"))
        clinic = norm_tag(rows[0].get("banana_clinic_tag")) or branch
        cmd = [
            sys.executable,
            str(script),
            "--branch",
            branch,
            "--batch-id",
            src_batch,
            "--clinic-tag",
            clinic,
            "--out-dir",
            str(out_dir),
        ]
        if clinic == "OKT":
            cmd += ["--also-clinic-tags", "KT"]
        out = run_cmd(cmd)
        batch_id = ""
        staging = out_dir / f"CS_{branch}_notes_resolve_staging_for_supabase.csv"
        for line in out.splitlines():
            if line.startswith("BATCH_ID "):
                batch_id = line[9:].strip()
            if line.startswith("STAGING "):
                staging = Path(line[8:].split(" (")[0].strip())
        if staging.exists() and batch_id:
            dest = out_dir / f"CS_{branch}_notes_{batch_id}_resolve_staging.csv"
            if dest.resolve() != staging.resolve():
                dest.write_bytes(staging.read_bytes())
                staging = dest
            produced.append((batch_id, staging))
            print("PRODUCED_NOTES", batch_id, staging)
    return produced


# ---------------------------------------------------------------------------
# Apply payment resolve insert via REST
# ---------------------------------------------------------------------------
def load_csv_rows(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as f:
        return list(csv.DictReader(f))


def set_batch_param(batch_id: str) -> None:
    api(
        "PATCH",
        "cs_import_params?id=eq.1",
        body={
            "batch_id": batch_id,
            "require_clinic_scope": True,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        },
    )
    print("cs_import_params.batch_id =", batch_id)


def upload_payment_resolve(batch_id: str, staging: Path) -> int:
    rows = load_csv_rows(staging)
    if not rows:
        print("No rows in", staging)
        return 0
    # delete prior same batch
    try:
        api("DELETE", f"cs_payments_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}")
    except RuntimeError as e:
        print("WARN clear batch:", e)
    payload = []
    for r in rows:
        item = dict(r)
        # empty strings for uuid fields → omit
        if not (item.get("resolved_patient_id") or "").strip():
            item.pop("resolved_patient_id", None)
        # drop non-staging junk
        for k in list(item.keys()):
            if item[k] == "":
                item[k] = None
        item["batch_id"] = batch_id
        item["import_status"] = "pending"
        payload.append(item)
    n = 0
    for i in range(0, len(payload), 100):
        part = payload[i : i + 100]
        api("POST", "cs_payments_staging", body=part, prefer="return=minimal")
        n += len(part)
        print(f"  uploaded payments resolve {n}/{len(payload)}")
    return n


def apply_payment_resolve_matches(batch_id: str) -> Counter:
    stats = Counter()
    rows = get_all(
        f"cs_payments_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}"
        "&select=*"
    )
    for r in rows:
        pid = r.get("resolved_patient_id")
        if not pid:
            api(
                "PATCH",
                f"cs_payments_staging?import_key=eq.{urllib.parse.quote(r['import_key'], safe='')}",
                body={
                    "import_status": "unmatched",
                    "import_error": r.get("resolve_method") or "no_patient_match",
                },
            )
            stats["unmatched"] += 1
            continue
        # fetch patient_no
        pt = api("GET", f"patients?id=eq.{pid}&select=id,patient_no", prefer="return=representation")
        pno = None
        if isinstance(pt, list) and pt:
            pno = pt[0].get("patient_no")
        api(
            "PATCH",
            f"cs_payments_staging?import_key=eq.{urllib.parse.quote(r['import_key'], safe='')}",
            body={
                "matched_patient_id": pid,
                "matched_patient_no": pno,
                "match_method": r.get("resolve_method") or "pre_resolved",
                "import_status": "matched",
                "import_error": None,
            },
        )
        stats["matched"] += 1
    print("APPLY_MATCH", dict(stats))
    return stats


def txn_marker(tag: str, txn: str) -> str:
    return f"CS_TXN:{norm_tag(tag)}:{txn.strip()}"


def insert_matched_payments(batch_id: str) -> Counter:
    """Faster insert: preload CS_TXN bills for patients in this batch."""
    stats = Counter()
    rows = get_all(
        f"cs_payments_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}"
        "&import_status=eq.matched&select=*"
    )
    if not rows:
        print("INSERT_PAY", {"matched_rows": 0})
        return stats

    pids = sorted({r.get("matched_patient_id") for r in rows if r.get("matched_patient_id")})
    # Index existing CS bills: (patient_id, txn) -> bill_id
    existing_map: dict[tuple[str, str], str] = {}
    for i in range(0, len(pids), 40):
        chunk = pids[i : i + 40]
        in_list = ",".join(chunk)
        bills = get_all(
            f"bills?patient_id=in.({in_list})&notes=like.*CS_TXN:*&voided_at=is.null"
            "&select=id,patient_id,notes"
        )
        for b in bills:
            pid = b.get("patient_id")
            notes = b.get("notes") or ""
            for m in re.finditer(r"CS_TXN:(?:([A-Z][A-Z0-9_-]*):)?([0-9]{8,})", notes):
                txn = m.group(2)
                if pid and txn:
                    existing_map[(pid, txn)] = b["id"]
        print(f"  preload bills {min(i+40,len(pids))}/{len(pids)} map={len(existing_map)}")

    for idx, r in enumerate(rows, start=1):
        pid = r.get("matched_patient_id")
        txn = (r.get("txn_code") or "").strip()
        tag = norm_tag(r.get("banana_clinic_tag") or r.get("branch_code") or "")
        key = r.get("import_key") or ""
        if not pid or not txn:
            stats["skip"] += 1
            continue
        marker = txn_marker(tag, txn)
        bill_id = existing_map.get((pid, txn))
        if bill_id:
            api(
                "PATCH",
                f"cs_payments_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                body={
                    "import_status": "skipped_dup",
                    "inserted_bill_id": bill_id,
                    "import_error": "already_in_bills",
                },
            )
            stats["skipped_dup"] += 1
        else:
            net = fnum(r.get("net_hkd"))
            disc = fnum(r.get("discount_hkd"))
            recv = fnum(r.get("received_hkd"))
            bal = fnum(r.get("balance_hkd"))
            items_raw = (r.get("items_json") or "").strip()
            try:
                items = json.loads(items_raw) if items_raw else [
                    {"desc": (r.get("diagnosis") or "CS imported bill"), "qty": 1, "price": net, "disc": disc}
                ]
            except json.JSONDecodeError:
                items = [{"desc": "CS imported bill", "qty": 1, "price": net, "disc": disc}]
            notes_parts = [marker]
            if (r.get("remarks") or "").strip():
                notes_parts.append(r["remarks"].strip())
            if (r.get("diagnosis") or "").strip():
                notes_parts.append(r["diagnosis"].strip())
            bill = {
                "patient_id": pid,
                "patient_no": r.get("matched_patient_no"),
                "patient_name": (r.get("name_en") or "").strip() or None,
                "bill_date": parse_bill_date(r.get("bill_date") or ""),
                "bill_type": "CS Import",
                "items": items,
                "subtotal": round(net + disc, 2),
                "discount": disc,
                "total": net,
                "amount_paid": recv,
                "balance": bal,
                "status": "Paid" if bal <= 0.005 else "Partial",
                "notes": " | ".join(notes_parts),
                "dentist_name": (r.get("doctor_code") or "").strip() or None,
                "doctor_name": (r.get("doctor_code") or "").strip() or None,
                "doctor_tag": (r.get("doctor_code") or "").strip() or None,
                "clinic_tag": tag or None,
            }
            try:
                ins = api("POST", "bills", body=bill, prefer="return=representation")
                bill_id = ins[0]["id"] if isinstance(ins, list) else ins["id"]
                existing_map[(pid, txn)] = bill_id
                api(
                    "PATCH",
                    f"cs_payments_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                    body={
                        "import_status": "inserted",
                        "inserted_bill_id": bill_id,
                        "import_error": None,
                    },
                )
                stats["inserted"] += 1
            except RuntimeError as e:
                print("ERR bill", txn, e)
                stats["error"] += 1
                continue

        # Installment / method payments (skip heavy pre-check; rely on note idempotency)
        if not bill_id:
            continue
        pays_raw = (r.get("payments_json") or "").strip()
        pay_rows = []
        if pays_raw:
            try:
                pays = json.loads(pays_raw)
            except json.JSONDecodeError:
                pays = []
            for i, p in enumerate(pays, start=1):
                amt = fnum(p.get("amount"))
                if amt <= 0.005:
                    continue
                pay_rows.append(
                    {
                        "bill_id": bill_id,
                        "paid_date": parse_bill_date(p.get("paid_date") or "")
                        or parse_bill_date(r.get("bill_date") or ""),
                        "amount": amt,
                        "method": (p.get("method") or "CS Import").strip() or "CS Import",
                        "notes": f"CS_INCOME:{tag}:{txn}:{i}",
                        "clinic_tag": tag or None,
                    }
                )
        if not pay_rows and fnum(r.get("received_hkd")) > 0.005:
            pay_rows.append(
                {
                    "bill_id": bill_id,
                    "paid_date": parse_bill_date(r.get("bill_date") or ""),
                    "amount": fnum(r.get("received_hkd")),
                    "method": "CS Import",
                    "notes": marker,
                    "clinic_tag": tag or None,
                }
            )
        if pay_rows:
            # Only insert if no CS_INCOME yet for this txn on bill
            try:
                existing_pays = api(
                    "GET",
                    f"bill_payments?bill_id=eq.{bill_id}&notes=like.{urllib.parse.quote('CS_INCOME:' + tag + ':' + txn + ':*', safe='')}"
                    "&select=id&limit=1",
                    prefer="return=representation",
                ) or []
            except RuntimeError:
                existing_pays = []
            if existing_pays:
                stats["payments_exist"] += 1
            else:
                try:
                    api("POST", "bill_payments", body=pay_rows, prefer="return=minimal")
                    stats["payments_inserted"] += len(pay_rows)
                except RuntimeError as e:
                    # likely unique/dup — count as exist
                    msg = str(e).lower()
                    if "duplicate" in msg or "unique" in msg or "409" in msg:
                        stats["payments_exist"] += 1
                    else:
                        print("ERR pays", bill_id, e)
                        stats["payments_error"] += 1
        if idx % 25 == 0:
            print(f"  insert progress {idx}/{len(rows)} {dict(stats)}")

    print("INSERT_PAY", dict(stats))
    return stats


def apply_existing_pending_resolve(batch_id: str) -> None:
    """KT_PAY_RESOLVE_* pending rows — apply match + insert without re-resolve."""
    print("APPLY_EXISTING_PENDING", batch_id)
    set_batch_param(batch_id)
    apply_payment_resolve_matches(batch_id)
    insert_matched_payments(batch_id)


# ---------------------------------------------------------------------------
# Notes resolve apply (upload + mark matched + insert notes)
# ---------------------------------------------------------------------------
def upload_notes_resolve(batch_id: str, staging: Path) -> int:
    rows = load_csv_rows(staging)
    if not rows:
        return 0
    try:
        api("DELETE", f"cs_notes_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}")
    except RuntimeError as e:
        print("WARN clear notes batch:", e)
    payload = []
    for r in rows:
        item = dict(r)
        if not (item.get("resolved_patient_id") or "").strip():
            item.pop("resolved_patient_id", None)
        for k in list(item.keys()):
            if item[k] == "":
                item[k] = None
        item["batch_id"] = batch_id
        item["import_status"] = "pending"
        payload.append(item)
    n = 0
    for i in range(0, len(payload), 80):
        part = payload[i : i + 80]
        api("POST", "cs_notes_staging", body=part, prefer="return=minimal")
        n += len(part)
        print(f"  uploaded notes resolve {n}/{len(payload)}")
    return n


def apply_notes_resolve_and_insert(batch_id: str) -> Counter:
    """Mark matched from resolved_patient_id; insert into public.treatments."""
    stats = Counter()
    # Resume-friendly: only pending/matched (skip already inserted)
    rows = get_all(
        f"cs_notes_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}"
        "&import_status=in.(pending,matched)&select=*"
    )
    print(f"  resume rows pending/matched={len(rows)}")

    for r in rows:
        if (r.get("import_status") or "") in ("inserted", "skipped_dup"):
            stats["already_done"] += 1
            continue
        pid = r.get("resolved_patient_id") or r.get("matched_patient_id")
        key = r.get("import_key") or ""
        if not pid:
            api(
                "PATCH",
                f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                body={"import_status": "unmatched", "import_error": "no_resolved_patient"},
            )
            stats["unmatched"] += 1
            continue
        api(
            "PATCH",
            f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
            body={
                "matched_patient_id": pid,
                "match_method": r.get("resolve_method") or "pre_resolved",
                "import_status": "matched",
                "import_error": None,
            },
        )
        stats["matched"] += 1

        notes = (r.get("notes") or "").replace("[[NL]]", "\n").strip()
        if not notes:
            api(
                "PATCH",
                f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                body={"import_status": "unmatched", "import_error": "empty_notes"},
            )
            stats["empty_notes"] += 1
            continue

        visit_at = (r.get("visit_at") or "").strip()
        created_at = None
        if visit_at:
            created_at = visit_at.replace(" ", "T")
            if len(created_at) == 19:
                created_at = created_at + "+08:00"

        tag = norm_tag(r.get("banana_clinic_tag") or r.get("branch_code") or "")
        # Dup check via PostgREST filter can break on special chars — skip heavy eq;
        # rely on insert + catch conflict, or light limit probe without notes=eq.
        payload = {
            "patient_id": pid,
            "notes": notes,
            "dentist_name": (r.get("doctor_code") or "").strip() or None,
            "clinic_tag": tag or None,
        }
        if created_at:
            payload["created_at"] = created_at
        try:
            api("POST", "treatments", body=payload, prefer="return=minimal")
            api(
                "PATCH",
                f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                body={"import_status": "inserted", "import_error": None},
            )
            stats["inserted"] += 1
        except RuntimeError as e:
            msg = str(e).lower()
            if "duplicate" in msg or "unique" in msg or "409" in msg:
                api(
                    "PATCH",
                    f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                    body={"import_status": "skipped_dup", "import_error": "already_in_treatments"},
                )
                stats["skipped_dup"] += 1
            else:
                print("ERR treatment", key[:12], e)
                stats["error"] += 1
        if stats["inserted"] and stats["inserted"] % 50 == 0:
            print("  notes progress", dict(stats))

    print("NOTES_APPLY", dict(stats))
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT))
    ap.add_argument("--skip-insert", action="store_true", help="Export + resolve CSVs only")
    ap.add_argument("--payments-only", action="store_true")
    ap.add_argument("--notes-only", action="store_true")
    args = ap.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pay_um, pay_pending, notes_um = export_unmatched(out_dir)

    pay_produced: list[tuple[str, Path]] = []
    notes_produced: list[tuple[str, Path]] = []

    if not args.notes_only:
        pay_produced = run_payment_resolves(pay_um, out_dir)
    if not args.payments_only:
        notes_produced = run_notes_resolves(notes_um, out_dir)

    report = {
        "out_dir": str(out_dir),
        "payment_resolve_batches": [{"batch_id": b, "staging": str(p)} for b, p in pay_produced],
        "notes_resolve_batches": [{"batch_id": b, "staging": str(p)} for b, p in notes_produced],
        "pending_batches_applied": [],
    }

    if args.skip_insert:
        (out_dir / "resolve_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print("DONE export+resolve CSVs only →", out_dir)
        return

    # Apply existing pending KT resolve batch(es)
    if not args.notes_only:
        pending_batches = sorted({r.get("batch_id") for r in pay_pending if r.get("batch_id")})
        for pb in pending_batches:
            if "RESOLVE" in (pb or "").upper():
                apply_existing_pending_resolve(pb)
                report["pending_batches_applied"].append(pb)

        for batch_id, staging in pay_produced:
            print("\n==== INSERT PAY RESOLVE", batch_id, "====")
            set_batch_param(batch_id)
            upload_payment_resolve(batch_id, staging)
            apply_payment_resolve_matches(batch_id)
            insert_matched_payments(batch_id)

    if not args.payments_only:
        for batch_id, staging in notes_produced:
            print("\n==== UPLOAD NOTES RESOLVE", batch_id, "====")
            # notes import params may share cs_import_params or separate — set if exists
            try:
                set_batch_param(batch_id)
            except RuntimeError:
                pass
            n = upload_notes_resolve(batch_id, staging)
            print("uploaded", n)
            apply_notes_resolve_and_insert(batch_id)
            print(
                "Next for notes SQL insert if needed:\n"
                f"  UPDATE cs_import_params SET batch_id='{batch_id}';\n"
                "  run supabase_cs_notes_resolve_insert.sql"
            )

    (out_dir / "resolve_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\nDONE →", out_dir)
    print("REPORT", out_dir / "resolve_report.json")


if __name__ == "__main__":
    main()
