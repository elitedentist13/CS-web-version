"""Rewrite CS staging CSV for Supabase Table Editor (single-line rows)."""
from __future__ import annotations

import csv
import sys
from pathlib import Path


def sanitize_notes(notes: str) -> str:
    s = notes or ""
    s = s.replace("\x00", "")
    # Flatten newlines so each CSV record is one physical line
    # (Supabase Table Editor / spreadsheet importers choke on multiline fields)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re_sub_newlines(s)
    # Fancy quotes -> ASCII
    s = (
        s.replace("\u201c", "'")
        .replace("\u201d", "'")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201e", "'")
        .replace("\u201f", "'")
    )
    # Neutralize embedded double-quotes (csv will also double them if any remain)
    if '"' in s:
        s = s.replace('"', "''")
    return s.strip()


def re_sub_newlines(s: str) -> str:
    # Collapse blank lines; [[NL]] is restored to real newlines on SQL insert
    parts = [p.strip() for p in s.split("\n")]
    parts = [p for p in parts if p != ""]
    return "[[NL]]".join(parts)


def rewrite(src: Path, dst: Path) -> None:
    with src.open("r", encoding="utf-8-sig", newline="") as fin:
        reader = csv.DictReader(fin)
        fieldnames = list(reader.fieldnames or [])
        rows = []
        changed = 0
        for row in reader:
            before = row.get("notes") or ""
            after = sanitize_notes(before)
            if after != before:
                changed += 1
            row["notes"] = after
            for k in fieldnames:
                v = row.get(k)
                if isinstance(v, str):
                    row[k] = (
                        v.replace("\x00", "")
                        .replace("\r\n", " ")
                        .replace("\r", " ")
                        .replace("\n", " ")
                    )
            rows.append(row)

    with dst.open("w", encoding="utf-8-sig", newline="") as fout:
        writer = csv.DictWriter(
            fout,
            fieldnames=fieldnames,
            quoting=csv.QUOTE_MINIMAL,
            lineterminator="\n",
            doublequote=True,
        )
        writer.writeheader()
        writer.writerows(rows)

    # Verify: physical lines == rows + 1 header
    physical = sum(1 for _ in dst.open("r", encoding="utf-8-sig"))
    print(f"WROTE {dst}")
    print(f"ROWS {len(rows)}")
    print(f"NOTES_CHANGED {changed}")
    print(f"PHYSICAL_LINES {physical} (expect {len(rows) + 1})")
    if physical != len(rows) + 1:
        raise SystemExit("ERROR: still multiline — do not import")


def main() -> None:
    src = Path(
        r"C:\Users\joyfu\Downloads\CS_CWB_20260806_035904_staging_for_supabase.csv"
    )
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    dst = src.with_name(src.stem + "_fixed_nl.csv")
    rewrite(src, dst)
    # Spot-check around former problem area
    with dst.open("r", encoding="utf-8-sig", newline="") as f:
        lines = f.readlines()
    print("--- physical lines 578-582 ---")
    for i in range(577, min(582, len(lines))):
        print(i + 1, repr(lines[i][:180]))


if __name__ == "__main__":
    main()
