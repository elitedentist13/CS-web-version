"""Aggregate JPEG dimension census on the CS IMAGE\\SCAN share.

Prints counts only (no patient names). Used to find real OPGs that are
timestamp-named and therefore missed by a PAN/OPG filename filter.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

ROOTS = [
    r"\\RECEPTION\IMAGE\SCAN",
    r"\\RECEPTION\IMAGE\IMGDOC",
]
JPEG_EXT = {".jpg", ".jpeg", ".jpe"}


def jpeg_size(path: str):
    try:
        with open(path, "rb") as f:
            if f.read(2) != b"\xff\xd8":
                return None
            while True:
                marker = f.read(2)
                if len(marker) < 2 or marker[0] != 0xFF:
                    return None
                mt = marker[1]
                if mt in (0xD8, 0xD9) or mt == 0x01 or 0xD0 <= mt <= 0xD7:
                    continue
                seglen = f.read(2)
                if len(seglen) < 2:
                    return None
                length = int.from_bytes(seglen, "big")
                if length < 2:
                    return None
                if mt in (
                    0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                    0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
                ):
                    data = f.read(length - 2)
                    if len(data) < 6:
                        return None
                    h = int.from_bytes(data[1:3], "big")
                    w = int.from_bytes(data[3:5], "big")
                    nf = data[5]
                    return w, h, nf
                f.seek(length - 2, os.SEEK_CUR)
    except OSError:
        return None


def classify(w: int, h: int) -> str:
    if w <= 0 or h <= 0:
        return "bad"
    aspect = w / h
    # Typical NewTom / dental panoramic: wide landscape, often ~1.8–2.8
    if w >= 900 and 1.65 <= aspect <= 3.6:
        return "pano_like"
    # Lateral ceph / PA skull: closer to square or mild landscape
    if min(w, h) >= 700 and 0.70 <= aspect < 1.65:
        return "ceph_or_square_xray"
    # Phone photo of a form: portrait, or small
    if aspect < 0.85:
        return "portrait_form_like"
    if w < 900 or h < 400:
        return "small_other"
    return "other_landscape"


def walk_jpegs(root: str):
    top = 0
    nested = 0
    dims = Counter()
    buckets = Counter()
    name_kw = Counter()
    missing = 0
    unreadable = 0
    chart_dirs = 0
    if not os.path.isdir(root):
        print(f"MISSING root {root}")
        return
    # CS Image JPEGs live at \\SCAN\\{chart}\\file.jpg — do not recurse into
    # NNT Document/RawData trees (those are huge and mostly proprietary).
    try:
        charts = [e for e in os.scandir(root) if e.is_dir()]
    except OSError as e:
        print(f"cannot list {root}: {e}")
        return
    chart_dirs = len(charts)
    print(f"listing {chart_dirs} chart folders under {root} ...", flush=True)
    for i, chart in enumerate(charts, 1):
        if i % 50 == 0:
            print(f"  scanned {i}/{chart_dirs} folders, jpegs={top}", flush=True)
        try:
            entries = list(os.scandir(chart.path))
        except OSError:
            continue
        for ent in entries:
            if not ent.is_file():
                if ent.is_dir() and ent.name.lower() in ("document", "rawdata"):
                    nested += 1  # marker only; not a jpeg count
                continue
            ext = os.path.splitext(ent.name)[1].lower()
            if ext not in JPEG_EXT:
                continue
            top += 1
            name = ent.name
            path = ent.path
            upper = name.upper()
            for kw in ("PAN", "OPG", "PANO", "CEPH", "DPT", "OPT", "FORM", "RAYSCAN"):
                if kw in upper:
                    name_kw[kw] += 1
            size = jpeg_size(path)
            if size is None:
                if not os.path.isfile(path):
                    missing += 1
                else:
                    unreadable += 1
                continue
            w, h = size
            dims[(w, h)] += 1
            buckets[classify(w, h)] += 1
    print(f"\n=== {root} ===")
    print(f"chart folders: {chart_dirs}")
    print(f"top-level JPEGs (chart folder only): {top}")
    print(f"folders with Document/RawData: {nested}")
    print(f"unreadable: {unreadable} missing: {missing}")
    print("filename keyword hits (top-level JPEG names):")
    for k, n in name_kw.most_common():
        print(f"  {k}: {n}")
    print("geometry buckets:")
    for k, n in buckets.most_common():
        print(f"  {k}: {n}")
    print("top dimensions:")
    for (w, h), n in dims.most_common(25):
        aspect = (w / h) if h else 0
        print(f"  {w}x{h}  n={n}  aspect={aspect:.2f}  class={classify(w, h)}")


def main():
    for root in ROOTS:
        walk_jpegs(root)


if __name__ == "__main__":
    main()
