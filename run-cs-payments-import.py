"""
Clinic Solution → Banana payments (all-in-one via Supabase anon REST).

Pipeline:
  1) Optional: export from local CS SQL (32-bit PowerShell → master + items + income)
  2) Normalize staging CSV (treatment items + installment methods)
  3) Upload rows into public.cs_payments_staging
  4) Match patients → insert bills + bill_payments (installments)

Examples:
  # From already-exported CSVs:
  python run-cs-payments-import.py --branch PL ^
    --master CS_PL_PaymentHistory_..._master.csv ^
    --items  CS_PL_PaymentHistory_..._items.csv ^
    --income CS_PL_PaymentHistory_..._income.csv

  # Export from local CS then import:
  python run-cs-payments-import.py --branch PL --export ^
    --server "RECEPTION\\CSX" --database CS6 --uid sa --pwd ""

  # Dry-run (build staging CSV only, no Supabase writes):
  python run-cs-payments-import.py --branch PL --master ... --items ... --income ... --dry-run

Env (optional overrides):
  SUPABASE_URL, SUPABASE_ANON_KEY
"""
from __future__ import annotations

import argparse
import ast
import csv
import json
import os
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

DEFAULT_URL = "https://kprihawipljrltfzpfjd.supabase.co"
DEFAULT_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)


def run_prepare_staging(
    master: Path,
    items: Path | None,
    income: Path | None,
    branch: str,
    clinic_tag: str,
    out: Path | None,
    batch_id: str,
) -> tuple[Path, str, dict]:
    """Invoke prepare-cs-payments-staging-csv.py via subprocess; return (out, batch_id, stats)."""
    script = Path(__file__).resolve().parent / "prepare-cs-payments-staging-csv.py"
    cmd = [
        sys.executable,
        str(script),
        "--source",
        str(master),
        "--branch",
        branch,
        "--clinic-tag",
        clinic_tag or branch,
        "--active-only",
    ]
    if batch_id:
        cmd += ["--batch-id", batch_id]
    if items and items.exists():
        cmd += ["--items", str(items)]
    if income and income.exists():
        cmd += ["--income", str(income)]
    if out:
        cmd += ["--out", str(out)]
    print("PREPARE", " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    sys.stdout.write(proc.stdout or "")
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or "")
        raise SystemExit(f"prepare failed ({proc.returncode})")
    out_path = None
    bid = batch_id
    stats = {}
    for line in (proc.stdout or "").splitlines():
        if line.startswith("OUT "):
            out_path = Path(line[4:].strip())
        elif line.startswith("BATCH_ID "):
            bid = line[9:].strip()
        elif line.startswith("STATS "):
            try:
                stats = ast.literal_eval(line[6:].strip())
            except (ValueError, SyntaxError):
                stats = {"raw": line[6:]}
    if not out_path or not out_path.exists():
        raise SystemExit("prepare did not print a valid OUT path")
    return out_path, bid, stats


# ---------------------------------------------------------------------------
# Supabase REST helpers
# ---------------------------------------------------------------------------
class SB:
    def __init__(self, url: str, anon: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.anon = anon

    def _headers(self, prefer: str | None = None, extra: dict | None = None) -> dict:
        h = {
            "apikey": self.anon,
            "Authorization": f"Bearer {self.anon}",
            "Content-Type": "application/json",
        }
        if prefer:
            h["Prefer"] = prefer
        if extra:
            h.update(extra)
        return h

    def request(self, method: str, path: str, body=None, prefer: str | None = None, extra=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self.base + "/" + path.lstrip("/"),
            data=data,
            method=method,
            headers=self._headers(prefer, extra),
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")[:800]
            raise RuntimeError(f"{method} {path} → {e.code}: {err}") from e

    def get_all(self, path_query: str, page: int = 1000) -> list:
        rows: list = []
        offset = 0
        while True:
            sep = "&" if "?" in path_query else "?"
            q = f"{path_query}{sep}limit={page}&offset={offset}"
            chunk = self.request(
                "GET",
                q,
                prefer="count=exact",
                extra={"Range": f"{offset}-{offset + page - 1}"},
            ) or []
            if not chunk:
                break
            rows.extend(chunk)
            if len(chunk) < page:
                break
            offset += page
        return rows

    def post_rows(self, table: str, rows: list, chunk: int = 200) -> int:
        n = 0
        for i in range(0, len(rows), chunk):
            part = rows[i : i + chunk]
            self.request("POST", table, body=part, prefer="resolution=merge-duplicates,return=minimal")
            n += len(part)
            print(f"  uploaded {n}/{len(rows)} → {table}")
        return n


def normalize_hkid(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").strip().upper())


def normalize_clinic_tag(raw: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (raw or "").strip().upper())


def normalize_patient_no(raw: str) -> str:
    s = (raw or "").strip().upper()
    s = re.sub(r"^0+", "", s) or "0"
    return s


def parse_bill_date(raw: str) -> str | None:
    s = (raw or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return None if not s else s[:10]


def fnum(v, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Export from local CS
# ---------------------------------------------------------------------------
def export_from_cs(
    branch: str,
    out_dir: Path,
    server: str,
    database: str,
    uid: str,
    pwd: str,
    script_dir: Path,
) -> tuple[Path, Path, Path]:
    ps1 = script_dir / "export-cs-payments.ps1"
    if not ps1.exists():
        raise SystemExit(f"Missing {ps1}")
    wow64 = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "SysWOW64" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    exe = str(wow64) if wow64.exists() else "powershell.exe"
    cmd = [
        exe,
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(ps1),
        "-Branch",
        branch,
        "-OutDir",
        str(out_dir),
        "-Server",
        server,
        "-Database",
        database,
        "-Uid",
        uid,
        "-Pwd",
        pwd or "",
    ]
    print("EXPORT", " ".join(cmd[:-1] + ["***"] if pwd else cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    sys.stdout.write(proc.stdout or "")
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or "")
        raise SystemExit(f"export-cs-payments.ps1 failed ({proc.returncode})")
    # Pick newest matching files for this branch
    br = branch.upper()
    masters = sorted(out_dir.glob(f"CS_{br}_PaymentHistory_*_master.csv"), key=lambda p: p.stat().st_mtime)
    items = sorted(out_dir.glob(f"CS_{br}_PaymentHistory_*_items.csv"), key=lambda p: p.stat().st_mtime)
    incomes = sorted(out_dir.glob(f"CS_{br}_PaymentHistory_*_income.csv"), key=lambda p: p.stat().st_mtime)
    if not masters or not items:
        raise SystemExit("Export finished but master/items CSV not found in OutDir")
    master, item = masters[-1], items[-1]
    income = incomes[-1] if incomes else Path()
    print("EXPORT_MASTER", master)
    print("EXPORT_ITEMS", item)
    print("EXPORT_INCOME", income if income.exists() else "(missing)")
    return master, item, income


# ---------------------------------------------------------------------------
# Staging CSV → rows
# ---------------------------------------------------------------------------
STAGING_COLS = [
    "import_key",
    "batch_id",
    "branch_code",
    "banana_clinic_tag",
    "txn_code",
    "bill_date",
    "bill_timestamp",
    "chart_no",
    "chart_no_stripped",
    "hkid_raw",
    "hkid_norm",
    "name_en",
    "name_other",
    "dob",
    "sex",
    "clinic_code",
    "doctor_code",
    "cancel_status",
    "cancel_label",
    "total_hkd",
    "discount_hkd",
    "net_hkd",
    "received_hkd",
    "balance_hkd",
    "total_cents",
    "received_cents",
    "remarks",
    "diagnosis",
    "items_json",
    "payments_json",
]


def load_staging_csv(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as fh:
        for r in csv.DictReader(fh):
            row = {k: (r.get(k) or "") for k in STAGING_COLS}
            row["import_status"] = "pending"
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Match + insert
# ---------------------------------------------------------------------------
def is_placeholder(name_en: str, name_other: str) -> bool:
    blob = f"{name_en or ''} {name_other or ''}".upper()
    raw = f"{name_en or ''} {name_other or ''}"
    for tok in ("CHECKING", "CHECK IN", "CHECKIN", "對數", "对数"):
        if tok.upper() in blob or tok in raw:
            return True
    return False


def build_patient_indexes(patients: list[dict], clinic_tag: str):
    by_hkid_clinic: dict[str, list] = defaultdict(list)
    by_hkid_blank: dict[str, list] = defaultdict(list)
    by_pno_clinic: dict[str, list] = defaultdict(list)
    by_pno_blank: dict[str, list] = defaultdict(list)
    by_pno_stripped: dict[str, list] = defaultdict(list)
    tag = normalize_clinic_tag(clinic_tag)
    for p in patients:
        pid = p.get("id")
        pno = (p.get("patient_no") or "").strip()
        hkid = normalize_hkid(p.get("hkid") or "")
        pt_tag = normalize_clinic_tag(p.get("clinic_tag") or "")
        if hkid and pt_tag == tag:
            by_hkid_clinic[hkid].append(p)
        if hkid and not pt_tag:
            by_hkid_blank[hkid].append(p)
        if pno and pt_tag == tag:
            by_pno_clinic[pno.upper()].append(p)
            by_pno_stripped[normalize_patient_no(pno)].append(p)
        if pno and not pt_tag:
            by_pno_blank[pno.upper()].append(p)
    return {
        "hkid_clinic": by_hkid_clinic,
        "hkid_blank": by_hkid_blank,
        "pno_clinic": by_pno_clinic,
        "pno_blank": by_pno_blank,
        "pno_stripped": by_pno_stripped,
        "tag": tag,
    }


def unique_hit(cands: list) -> tuple[dict | None, str | None]:
    if len(cands) == 1:
        return cands[0], None
    if len(cands) > 1:
        return None, "ambiguous"
    return None, None


def match_row(row: dict, idx: dict) -> tuple[str, str | None, str | None, str | None]:
    """Return (status, patient_id, patient_no, method_or_error)."""
    if is_placeholder(row.get("name_en") or "", row.get("name_other") or ""):
        return "skipped_placeholder", None, None, "placeholder_CHECKING_or_對數_already_in_Banana"

    hkid = (row.get("hkid_norm") or "").strip()
    chart = (row.get("chart_no") or "").strip()
    chart_u = chart.upper()
    stripped = (row.get("chart_no_stripped") or "").strip() or normalize_patient_no(chart)
    tag = idx["tag"]
    prefixed = f"{tag}{chart}" if tag and chart else ""

    # 3A HKID + clinic
    if hkid:
        hit, amb = unique_hit(idx["hkid_clinic"].get(hkid, []))
        if amb:
            return "unmatched", None, None, "ambiguous_hkid_norm+clinic_tag"
        if hit:
            return "matched", hit["id"], hit.get("patient_no"), "hkid_norm+clinic_tag"
        # 3A2 blank clinic
        hit, amb = unique_hit(idx["hkid_blank"].get(hkid, []))
        if amb:
            return "unmatched", None, None, "ambiguous_hkid_norm"
        if hit:
            return "matched", hit["id"], hit.get("patient_no"), "hkid_norm"

    # 3B exact chart + clinic
    if chart_u:
        hit, amb = unique_hit(idx["pno_clinic"].get(chart_u, []))
        if amb:
            return "unmatched", None, None, "ambiguous_patient_no_exact+clinic_tag"
        if hit:
            return "matched", hit["id"], hit.get("patient_no"), "patient_no_exact+clinic_tag"

    # 3B1 prefixed
    if prefixed:
        hit, amb = unique_hit(idx["pno_clinic"].get(prefixed.upper(), []))
        if amb:
            return "unmatched", None, None, "ambiguous_patient_no_prefixed+clinic_tag"
        if hit:
            return "matched", hit["id"], hit.get("patient_no"), "patient_no_prefixed+clinic_tag"

    # 3B2 blank clinic exact
    if chart_u:
        hit, amb = unique_hit(idx["pno_blank"].get(chart_u, []))
        if amb:
            return "unmatched", None, None, "ambiguous_patient_no_exact+blank_clinic"
        if hit:
            return "matched", hit["id"], hit.get("patient_no"), "patient_no_exact+blank_clinic"

    # 3C stripped + clinic
    if stripped:
        hit, amb = unique_hit(idx["pno_stripped"].get(stripped, []))
        if amb:
            return "unmatched", None, None, "ambiguous_patient_no_stripped+clinic_tag"
        if hit:
            return "matched", hit["id"], hit.get("patient_no"), "patient_no_stripped+clinic_tag"

    return "unmatched", None, None, "no_patient_match"


def txn_marker(clinic_tag: str, txn: str) -> str:
    return f"CS_TXN:{normalize_clinic_tag(clinic_tag)}:{txn.strip()}"


def find_existing_bill(sb: SB, patient_id: str, clinic_tag: str, txn: str) -> dict | None:
    marker = urllib.parse.quote(f"*CS_TXN:{normalize_clinic_tag(clinic_tag)}:{txn.strip()}*", safe="")
    legacy = urllib.parse.quote(f"*CS_TXN:{txn.strip()}*", safe="")
    for pattern in (marker, legacy):
        rows = sb.request(
            "GET",
            f"bills?patient_id=eq.{patient_id}&notes=like.{pattern}"
            "&voided_at=is.null&select=id,notes,patient_id&limit=5",
        ) or []
        for b in rows:
            notes = b.get("notes") or ""
            if f"CS_TXN:{normalize_clinic_tag(clinic_tag)}:{txn.strip()}" in notes or (
                f"CS_TXN:{txn.strip()}" in notes
            ):
                return b
    return None


def build_bill_payload(row: dict) -> dict:
    tag = normalize_clinic_tag(row.get("banana_clinic_tag") or row.get("branch_code") or "")
    txn = (row.get("txn_code") or "").strip()
    net = fnum(row.get("net_hkd"))
    disc = fnum(row.get("discount_hkd"))
    recv = fnum(row.get("received_hkd"))
    bal = fnum(row.get("balance_hkd"))
    items_raw = (row.get("items_json") or "").strip()
    if items_raw:
        try:
            items = json.loads(items_raw)
        except json.JSONDecodeError:
            items = [{"desc": row.get("diagnosis") or "CS imported bill", "qty": 1, "price": net, "disc": disc}]
    else:
        items = [{"desc": (row.get("diagnosis") or "").strip() or "CS imported bill", "qty": 1, "price": net, "disc": disc}]
    marker = txn_marker(tag, txn)
    notes_parts = [marker]
    if (row.get("remarks") or "").strip():
        notes_parts.append(row["remarks"].strip())
    if (row.get("diagnosis") or "").strip():
        notes_parts.append(row["diagnosis"].strip())
    if (row.get("doctor_code") or "").strip():
        notes_parts.append("Doctor: " + row["doctor_code"].strip())
    bill_date = parse_bill_date(row.get("bill_date") or "")
    payload = {
        "patient_id": row["matched_patient_id"],
        "patient_no": row.get("matched_patient_no"),
        "patient_name": (row.get("name_en") or "").strip() or None,
        "bill_date": bill_date,
        "bill_type": "CS Import",
        "items": items,
        "subtotal": round(net + disc, 2),
        "discount": disc,
        "total": net,
        "amount_paid": recv,
        "balance": bal,
        "status": "Paid" if bal <= 0.005 else "Partial",
        "notes": " | ".join(notes_parts),
        "dentist_name": (row.get("doctor_code") or "").strip() or None,
        "doctor_name": (row.get("doctor_code") or "").strip() or None,
        "doctor_tag": (row.get("doctor_code") or "").strip() or None,
        "clinic_tag": tag or None,
    }
    return payload


def build_payment_rows(row: dict, bill_id: str) -> list[dict]:
    tag = normalize_clinic_tag(row.get("banana_clinic_tag") or row.get("branch_code") or "")
    txn = (row.get("txn_code") or "").strip()
    pays_raw = (row.get("payments_json") or "").strip()
    out: list[dict] = []
    if pays_raw:
        try:
            pays = json.loads(pays_raw)
        except json.JSONDecodeError:
            pays = []
        for i, p in enumerate(pays, start=1):
            amt = fnum(p.get("amount"))
            if amt <= 0.005:
                continue
            paid = parse_bill_date(p.get("paid_date") or "") or parse_bill_date(row.get("bill_date") or "")
            method = (p.get("method") or "CS Import").strip() or "CS Import"
            out.append(
                {
                    "bill_id": bill_id,
                    "paid_date": paid,
                    "amount": amt,
                    "method": method,
                    "notes": f"CS_INCOME:{tag}:{txn}:{i}",
                    "clinic_tag": tag or None,
                }
            )
        if out:
            return out
    recv = fnum(row.get("received_hkd"))
    if recv > 0.005:
        out.append(
            {
                "bill_id": bill_id,
                "paid_date": parse_bill_date(row.get("bill_date") or ""),
                "amount": recv,
                "method": "CS Import",
                "notes": txn_marker(tag, txn),
                "clinic_tag": tag or None,
            }
        )
    return out


def set_batch_param(sb: SB, batch_id: str) -> None:
    try:
        sb.request(
            "PATCH",
            "cs_import_params?id=eq.1",
            body={"batch_id": batch_id, "require_clinic_scope": True, "updated_at": datetime.utcnow().isoformat() + "Z"},
            prefer="return=minimal",
        )
        print("BATCH_PARAM", batch_id)
    except RuntimeError as e:
        print("WARN set cs_import_params failed (continuing):", e)


def delete_batch_staging(sb: SB, batch_id: str) -> None:
    try:
        sb.request(
            "DELETE",
            f"cs_payments_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}",
            prefer="return=minimal",
        )
        print("CLEARED_STAGING", batch_id)
    except RuntimeError as e:
        print("WARN clear staging:", e)


def upload_staging(sb: SB, rows: list[dict]) -> None:
    # Only columns that exist on staging; omit match fields on insert
    payload = []
    for r in rows:
        payload.append({k: r.get(k, "") for k in STAGING_COLS})
    print(f"UPLOAD staging rows={len(payload)}")
    sb.post_rows("cs_payments_staging", payload, chunk=150)


def patch_staging_status(sb: SB, row: dict) -> None:
    key = row["import_key"]
    body = {
        "import_status": row.get("import_status"),
        "matched_patient_id": row.get("matched_patient_id"),
        "matched_patient_no": row.get("matched_patient_no"),
        "match_method": row.get("match_method"),
        "import_error": row.get("import_error"),
        "inserted_bill_id": row.get("inserted_bill_id"),
    }
    # drop Nones that should clear? keep as null
    sb.request(
        "PATCH",
        f"cs_payments_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
        body=body,
        prefer="return=minimal",
    )


def run_match_and_insert(sb: SB, rows: list[dict], clinic_tag: str, dry_run: bool) -> Counter:
    stats = Counter()
    tag = normalize_clinic_tag(clinic_tag)
    print("Loading patients for clinic_tag=", tag)
    patients_tag = sb.get_all(f"patients?clinic_tag=eq.{tag}&select=id,patient_no,hkid,clinic_tag")
    patients_blank = sb.get_all(
        "patients?clinic_tag=is.null&select=id,patient_no,hkid,clinic_tag"
    )
    by_id = {p["id"]: p for p in patients_tag}
    for p in patients_blank:
        by_id.setdefault(p["id"], p)
    patients = list(by_id.values())
    print("PATIENTS", len(patients), "(tag + blank clinic)")
    idx = build_patient_indexes(patients, tag)

    for row in rows:
        status, pid, pno, method = match_row(row, idx)
        row["import_status"] = status
        row["matched_patient_id"] = pid
        row["matched_patient_no"] = pno
        if status == "matched":
            row["match_method"] = method
            row["import_error"] = None
            stats["matched"] += 1
        elif status == "skipped_placeholder":
            row["match_method"] = None
            row["import_error"] = method
            stats["skipped_placeholder"] += 1
        else:
            row["match_method"] = None
            row["import_error"] = method
            stats["unmatched"] += 1

    print("MATCH", dict(stats))
    matched_n = stats["matched"]
    if not dry_run:
        print(
            f"INSERTING/checking {matched_n} matched bills "
            "(quiet until done — progress every 50)…"
        )
        sys.stdout.flush()

    processed = 0
    for row in rows:
        if row["import_status"] != "matched":
            if not dry_run:
                try:
                    patch_staging_status(sb, row)
                except RuntimeError as e:
                    print("WARN patch staging:", e)
            continue

        txn = (row.get("txn_code") or "").strip()
        if not txn:
            row["import_status"] = "unmatched"
            row["import_error"] = "missing_txn_code"
            stats["unmatched"] += 1
            stats["matched"] -= 1
            continue

        existing = None if dry_run else find_existing_bill(sb, row["matched_patient_id"], tag, txn)
        if existing:
            row["import_status"] = "skipped_dup"
            row["inserted_bill_id"] = existing["id"]
            row["import_error"] = "already_in_bills"
            stats["skipped_dup"] += 1
            stats["matched"] -= 1
            # Still ensure installment payments exist
            if not dry_run:
                pays = build_payment_rows(row, existing["id"])
                _ensure_payments(sb, existing["id"], tag, txn, pays, stats)
                try:
                    patch_staging_status(sb, row)
                except RuntimeError as e:
                    print("WARN patch staging:", e)
            processed += 1
            if processed % 50 == 0 or processed == matched_n:
                print(
                    f"  … {processed}/{matched_n}  "
                    f"inserted={stats['inserted']} skipped_dup={stats['skipped_dup']} "
                    f"error={stats['error']}"
                )
                sys.stdout.flush()
            continue

        bill = build_bill_payload(row)
        if dry_run:
            stats["would_insert"] += 1
            continue

        try:
            inserted = sb.request("POST", "bills", body=bill, prefer="return=representation")
            bill_row = inserted[0] if isinstance(inserted, list) and inserted else inserted
            bill_id = bill_row["id"]
            row["import_status"] = "inserted"
            row["inserted_bill_id"] = bill_id
            row["import_error"] = None
            stats["inserted"] += 1
            pays = build_payment_rows(row, bill_id)
            _ensure_payments(sb, bill_id, tag, txn, pays, stats)
        except RuntimeError as e:
            row["import_status"] = "error"
            row["import_error"] = str(e)[:400]
            stats["error"] += 1
            print("ERR insert bill", txn, e)

        try:
            patch_staging_status(sb, row)
        except RuntimeError as e:
            print("WARN patch staging:", e)

        processed += 1
        if processed % 50 == 0 or processed == matched_n:
            print(
                f"  … {processed}/{matched_n}  "
                f"inserted={stats['inserted']} skipped_dup={stats['skipped_dup']} "
                f"error={stats['error']}"
            )
            sys.stdout.flush()

    return stats


def _ensure_payments(sb: SB, bill_id: str, tag: str, txn: str, pays: list[dict], stats: Counter) -> None:
    if not pays:
        return
    existing = sb.request(
        "GET",
        f"bill_payments?bill_id=eq.{bill_id}&select=id,notes,method,amount",
    ) or []
    notes_set = {(p.get("notes") or "") for p in existing}
    has_income = any((n or "").startswith(f"CS_INCOME:{tag}:{txn}:") for n in notes_set)
    if has_income:
        stats["payments_already"] += 1
        return
    # If we have installment rows, remove lump CS_TXN / CS Import for this txn first
    if any((p.get("notes") or "").startswith("CS_INCOME:") for p in pays):
        for p in existing:
            n = p.get("notes") or ""
            if n == txn_marker(tag, txn) or n == f"CS_TXN:{txn}" or (
                (p.get("method") or "") == "CS Import" and "CS_INCOME:" not in n
            ):
                try:
                    sb.request("DELETE", f"bill_payments?id=eq.{p['id']}", prefer="return=minimal")
                    stats["payments_lump_removed"] += 1
                except RuntimeError:
                    pass
    to_add = [p for p in pays if (p.get("notes") or "") not in notes_set]
    if not to_add:
        return
    try:
        sb.request("POST", "bill_payments", body=to_add, prefer="return=minimal")
        stats["payments_inserted"] += len(to_add)
    except RuntimeError as e:
        print("ERR payments", bill_id, e)
        stats["payments_error"] += 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="CS payments → Banana via Supabase anon API")
    ap.add_argument("--branch", required=True, help="Branch code e.g. PL, TKO, KT")
    ap.add_argument("--clinic-tag", default="", help="Banana clinic_tag (default = branch)")
    ap.add_argument("--master", default="", help="Existing master CSV (skip --export)")
    ap.add_argument("--items", default="", help="Existing items CSV")
    ap.add_argument("--income", default="", help="Existing income/installments CSV")
    ap.add_argument("--staging", default="", help="Skip prepare; use this staging CSV")
    ap.add_argument("--export", action="store_true", help="Run export-cs-payments.ps1 first")
    ap.add_argument("--server", default=r"RECEPTION\CSX")
    ap.add_argument("--database", default="CS6")
    ap.add_argument("--uid", default="sa")
    ap.add_argument("--pwd", default="")
    ap.add_argument("--out-dir", default="", help="Downloads / work folder")
    ap.add_argument("--batch-id", default="")
    ap.add_argument("--dry-run", action="store_true", help="Build staging only / no writes")
    ap.add_argument("--skip-upload", action="store_true", help="Do not upload staging rows")
    ap.add_argument("--skip-insert", action="store_true", help="Upload staging only; no bill insert")
    ap.add_argument("--clear-batch", action="store_true", help="DELETE staging rows for this batch first")
    ap.add_argument("--supabase-url", default="")
    ap.add_argument("--anon-key", default="")
    args = ap.parse_args()

    branch = normalize_clinic_tag(args.branch)
    clinic_tag = normalize_clinic_tag(args.clinic_tag) or branch
    script_dir = Path(__file__).resolve().parent
    out_dir = Path(args.out_dir) if args.out_dir else Path.home() / "Downloads"
    out_dir.mkdir(parents=True, exist_ok=True)

    url = (args.supabase_url or os.environ.get("SUPABASE_URL") or DEFAULT_URL).rstrip("/")
    anon = args.anon_key or os.environ.get("SUPABASE_ANON_KEY") or DEFAULT_ANON
    sb = SB(url, anon)

    master = Path(args.master) if args.master else None
    items = Path(args.items) if args.items else None
    income = Path(args.income) if args.income else None

    if args.export:
        master, items, income = export_from_cs(
            branch, out_dir, args.server, args.database, args.uid, args.pwd, script_dir
        )
    elif args.staging:
        staging_path = Path(args.staging)
        batch_id = args.batch_id or ""
        if not batch_id:
            # read first row
            with staging_path.open(encoding="utf-8-sig", newline="") as fh:
                r0 = next(csv.DictReader(fh), {})
                batch_id = (r0.get("batch_id") or "").strip()
        print("STAGING", staging_path, "BATCH", batch_id)
    else:
        if not master or not master.exists():
            raise SystemExit("Provide --master CSV, or --staging, or --export")

    if not args.staging:
        if not items or not items.exists():
            print("WARN: --items missing; bills will use diagnosis placeholder lines")
        if not income or not income.exists():
            print("WARN: --income missing; installments/methods fall back to lump CS Import")
        staging_path, batch_id, prep_stats = run_prepare_staging(
            master=master,
            items=items,
            income=income,
            branch=branch,
            clinic_tag=clinic_tag,
            out=out_dir / f"CS_{branch}_PaymentHistory_staging_for_supabase.csv",
            batch_id=args.batch_id or "",
        )
        print("PREP_STATS", prep_stats)
    else:
        staging_path = Path(args.staging)
        batch_id = batch_id or args.batch_id

    rows = load_staging_csv(staging_path)
    print("STAGING_ROWS", len(rows), "BATCH_ID", batch_id)

    if args.dry_run:
        # Still run match locally for a report
        stats = run_match_and_insert(sb, rows, clinic_tag, dry_run=True)
        print("DRY_RUN_STATS", dict(stats))
        print("DONE (dry-run — staging CSV ready, no Supabase writes for insert)")
        print("STAGING_CSV", staging_path)
        return

    set_batch_param(sb, batch_id)
    if args.clear_batch:
        delete_batch_staging(sb, batch_id)

    if not args.skip_upload:
        upload_staging(sb, rows)

    if args.skip_insert:
        print("DONE (staging uploaded; skip-insert)")
        return

    stats = run_match_and_insert(sb, rows, clinic_tag, dry_run=False)
    print("FINAL_STATS", dict(stats))
    print("BATCH_ID", batch_id)
    print("STAGING_CSV", staging_path)
    print("DONE")


if __name__ == "__main__":
    main()
