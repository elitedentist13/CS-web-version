"""
Normalize Clinic Solution payment master CSV for Supabase staging (multi-branch).

Adds:
  - hkid_norm / chart_no_stripped / banana_clinic_tag / batch_id / import_key
  - items_json from --items (PAYMENTSLAVETABLE export) — recommended always
  - payments_json from --income (INCOMETABLE export) — installment receipts
  - skips CHECKING / 對數 placeholders by default

Guide: CS_PAYMENTS_SUPABASE_IMPORT.md
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def normalize_hkid(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").strip().upper())


def normalize_branch(raw: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (raw or "").strip().upper())


def chart_no_stripped(raw: str) -> str:
    s = (raw or "").strip().lstrip("0")
    return s or "0"


def flatten_text(raw: str) -> str:
    """One physical CSV line — Supabase Table Editor fails on multiline quoted fields."""
    s = (raw or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    parts = [p.strip() for p in s.split("\n") if p.strip() != ""]
    return " | ".join(parts)


def import_key(batch_id: str, txn: str, chart: str) -> str:
    payload = f"{batch_id}|{txn}|{chart}".encode("utf-8", errors="replace")
    return hashlib.sha256(payload).hexdigest()[:40]


# Placeholder walk-in / temp names in CS. Real patient + payment already live in Banana.
PLACEHOLDER_NAME_TOKENS = (
    "對數",
    "对数",  # simplified
    "CHECKING",
    "CHECK IN",
    "CHECKIN",
)


def is_placeholder_patient(name_en: str, name_other: str) -> bool:
    blob = f"{name_en or ''} {name_other or ''}".strip().upper()
    blob_raw = f"{name_en or ''} {name_other or ''}"
    if not blob and not blob_raw.strip():
        return False
    for tok in PLACEHOLDER_NAME_TOKENS:
        if tok.upper() in blob or tok in blob_raw:
            return True
    return False


def _fnum(v, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def slave_row_to_item(row: dict) -> dict | None:
    item = (row.get("Item") or row.get("item") or "").strip()
    sub = (row.get("SubItem") or row.get("sub_item") or "").strip()
    if not item and not sub:
        return None
    desc = item if not sub else (f"{item} - {sub}" if item else sub)
    qty = _fnum(row.get("Qty") or row.get("qty"), 0.0) or 1.0
    net = _fnum(row.get("NetHkd") or row.get("net_hkd"))
    disc_hkd = _fnum(row.get("DiscountHkd") or row.get("discount_hkd"))
    unit_amt = _fnum(row.get("UnitAmountHkd") or row.get("unit_amount_hkd"))
    gross = net + disc_hkd
    if gross <= 0 and unit_amt > 0:
        gross = unit_amt
        if net <= 0:
            net = unit_amt - disc_hkd
    if gross <= 0 and net > 0:
        gross = net
    unit_price = round(gross / qty, 2) if qty else round(gross, 2)
    disc_pct = round((disc_hkd / gross) * 100.0, 4) if gross > 0 and disc_hkd > 0 else 0.0
    return {
        "desc": desc,
        "qty": qty if qty != int(qty) else int(qty),
        "price": unit_price,
        "disc": disc_pct,
        "tooth_no": "-",
    }


def load_items_by_txn(items_path: Path, active_only: bool) -> dict[str, list]:
    by_txn: dict[str, list] = defaultdict(list)
    if not items_path or not items_path.exists():
        return by_txn
    with items_path.open("r", encoding="utf-8-sig", newline="", errors="replace") as fh:
        for row in csv.DictReader(fh):
            cancel = str(row.get("CancelStatus") or row.get("cancel_status") or "0").strip()
            if active_only and cancel not in ("0", ""):
                continue
            txn = (row.get("TxnCode") or row.get("txn_code") or "").strip()
            if not txn:
                continue
            it = slave_row_to_item(row)
            if it:
                by_txn[txn].append(it)
    return by_txn


def _parse_paid_date(raw: str) -> str:
    s = (raw or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return s


def load_income_by_txn_chart(income_path: Path) -> dict[tuple[str, str], list]:
    """INCOMETABLE export → (TxnCode, ChartNo) → [{paid_date, amount, method, notes_key}]."""
    by_key: dict[tuple[str, str], list] = defaultdict(list)
    if not income_path or not income_path.exists():
        return by_key
    with income_path.open("r", encoding="utf-8-sig", newline="", errors="replace") as fh:
        for row in csv.DictReader(fh):
            status = str(row.get("Status") or row.get("status") or "0").strip()
            if status not in ("0", ""):
                continue
            txn = (row.get("TxnCode") or row.get("txn_code") or "").strip()
            chart = (row.get("ChartNo") or row.get("chart_no") or "").strip()
            if not txn or not chart:
                continue
            amt = _fnum(row.get("AmountHkd") or row.get("amount_hkd"))
            if amt <= 0 and (row.get("AmountCents") or row.get("amount_cents")):
                amt = _fnum(row.get("AmountCents") or row.get("amount_cents")) / 100.0
            if amt <= 0.0005:
                continue
            paid = _parse_paid_date(row.get("PaidDate") or row.get("paid_date") or "")
            method = (row.get("Method") or row.get("method") or "CS Import").strip() or "CS Import"
            ts = (row.get("PaidTimestamp") or row.get("paid_timestamp") or "").strip()
            by_key[(txn, chart.upper())].append(
                {
                    "paid_date": paid,
                    "amount": round(amt, 2),
                    "method": method,
                    "paid_timestamp": ts,
                }
            )
    for lst in by_key.values():
        lst.sort(key=lambda x: (x.get("paid_timestamp") or "", x.get("paid_date") or "", x["amount"]))
    return by_key


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="Raw payment master CSV from export-cs-payments.ps1")
    ap.add_argument("--branch", required=True, help="Branch code e.g. TKO")
    ap.add_argument("--clinic-tag", default="")
    ap.add_argument("--batch-id", default="")
    ap.add_argument("--out", default="")
    ap.add_argument(
        "--items",
        default="",
        help="Optional PAYMENTSLAVE items CSV — fills items_json for Banana bill lines",
    )
    ap.add_argument(
        "--income",
        default="",
        help="Optional INCOMETABLE CSV — fills payments_json (installment receipts)",
    )
    ap.add_argument(
        "--active-only",
        action="store_true",
        help="Exclude cancelled bills (CancelStatus != 0)",
    )
    ap.add_argument(
        "--keep-placeholders",
        action="store_true",
        help="Do NOT skip CHECKING/對數 placeholder patients (default: skip — already in Banana)",
    )
    args = ap.parse_args()

    branch = normalize_branch(args.branch)
    src = Path(args.source)
    if not src.exists():
        raise SystemExit(f"Source not found: {src}")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_id = (args.batch_id or "").strip() or f"{branch}_PAY_{stamp}"
    clinic_tag = normalize_branch(args.clinic_tag) if args.clinic_tag else branch
    out = Path(args.out) if args.out else src.with_name(
        f"CS_{branch}_PaymentHistory_{stamp}_staging_for_supabase.csv"
    )

    fields = [
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

    items_by_txn = load_items_by_txn(
        Path(args.items) if args.items else Path(),
        active_only=True,
    )
    income_by_key = load_income_by_txn_chart(
        Path(args.income) if args.income else Path(),
    )

    skipped_path = out.with_name(out.stem + "_skipped_placeholders.csv")
    stats = {
        "total": 0,
        "written": 0,
        "cancelled_skipped": 0,
        "placeholder_skipped": 0,
        "with_hkid": 0,
        "with_items_json": 0,
        "with_payments_json": 0,
        "items_txns_loaded": len(items_by_txn),
        "income_groups_loaded": len(income_by_key),
    }

    skip_fields = [
        "TxnCode",
        "BillDate",
        "ChartNo",
        "HKID",
        "NameEn",
        "NameOther",
        "NetHkd",
        "ReceivedHkd",
        "DoctorCode",
        "ClinicCode",
        "reason",
    ]

    with src.open("r", encoding="utf-8-sig", newline="") as fin, out.open(
        "w", encoding="utf-8-sig", newline=""
    ) as fout, skipped_path.open("w", encoding="utf-8-sig", newline="") as fskip:
        reader = csv.DictReader(fin)
        writer = csv.DictWriter(fout, fieldnames=fields)
        writer.writeheader()
        skip_writer = csv.DictWriter(fskip, fieldnames=skip_fields, extrasaction="ignore")
        skip_writer.writeheader()
        for row in reader:
            stats["total"] += 1
            cancel = str(row.get("CancelStatus") or row.get("cancel_status") or "0").strip()
            if args.active_only and cancel not in ("0", ""):
                stats["cancelled_skipped"] += 1
                continue

            name_en = (row.get("NameEn") or row.get("name_en") or "").strip()
            name_other = (row.get("NameOther") or row.get("name_other") or "").strip()
            if not args.keep_placeholders and is_placeholder_patient(name_en, name_other):
                stats["placeholder_skipped"] += 1
                skip_writer.writerow(
                    {
                        "TxnCode": row.get("TxnCode") or "",
                        "BillDate": row.get("BillDate") or "",
                        "ChartNo": row.get("ChartNo") or "",
                        "HKID": row.get("HKID") or "",
                        "NameEn": name_en,
                        "NameOther": name_other,
                        "NetHkd": row.get("NetHkd") or "",
                        "ReceivedHkd": row.get("ReceivedHkd") or "",
                        "DoctorCode": row.get("DoctorCode") or "",
                        "ClinicCode": row.get("ClinicCode") or "",
                        "reason": "placeholder_CHECKING_or_對數_already_in_Banana",
                    }
                )
                continue

            chart = (row.get("ChartNo") or row.get("chart_no") or "").strip()
            hkid_raw = (row.get("HKID") or row.get("hkid_raw") or "").strip()
            hkid_norm = normalize_hkid(hkid_raw)
            txn = (row.get("TxnCode") or row.get("txn_code") or "").strip()
            clinic_code = (row.get("ClinicCode") or row.get("clinic_code") or clinic_tag).strip().upper() or branch

            if hkid_norm:
                stats["with_hkid"] += 1

            lines = items_by_txn.get(txn) or []
            items_json = (
                json.dumps(lines, ensure_ascii=False, separators=(",", ":")) if lines else ""
            )
            if items_json:
                stats["with_items_json"] += 1

            pays = income_by_key.get((txn, chart.upper())) or []
            payments_json = (
                json.dumps(pays, ensure_ascii=False, separators=(",", ":")) if pays else ""
            )
            if payments_json:
                stats["with_payments_json"] += 1

            writer.writerow(
                {
                    "import_key": import_key(batch_id, txn, chart),
                    "batch_id": batch_id,
                    "branch_code": branch,
                    "banana_clinic_tag": clinic_tag or clinic_code,
                    "txn_code": txn,
                    "bill_date": (row.get("BillDate") or "").strip(),
                    "bill_timestamp": (row.get("BillTimestamp") or "").strip(),
                    "chart_no": chart,
                    "chart_no_stripped": chart_no_stripped(chart),
                    "hkid_raw": hkid_raw,
                    "hkid_norm": hkid_norm,
                    "name_en": flatten_text(name_en),
                    "name_other": flatten_text(name_other),
                    "dob": (row.get("DOB") or "").strip(),
                    "sex": (row.get("Sex") or "").strip(),
                    "clinic_code": clinic_code,
                    "doctor_code": (row.get("DoctorCode") or "").strip(),
                    "cancel_status": cancel,
                    "cancel_label": (row.get("CancelLabel") or "").strip(),
                    "total_hkd": (row.get("TotalHkd") or "").strip(),
                    "discount_hkd": (row.get("DiscountHkd") or "").strip(),
                    "net_hkd": (row.get("NetHkd") or "").strip(),
                    "received_hkd": (row.get("ReceivedHkd") or "").strip(),
                    "balance_hkd": (row.get("BalanceHkd") or "").strip(),
                    "total_cents": (row.get("TotalCents") or "").strip(),
                    "received_cents": (row.get("ReceivedCents") or "").strip(),
                    "remarks": flatten_text(row.get("Remarks") or ""),
                    "diagnosis": flatten_text(row.get("Diagnosis") or ""),
                    "items_json": items_json.replace("\r", " ").replace("\n", " "),
                    "payments_json": payments_json.replace("\r", " ").replace("\n", " "),
                }
            )
            stats["written"] += 1

    print(f"OUT {out}")
    print(f"SKIPPED_PLACEHOLDERS {skipped_path}")
    print(f"BATCH_ID {batch_id}")
    print(f"STATS {stats}")


if __name__ == "__main__":
    main()
