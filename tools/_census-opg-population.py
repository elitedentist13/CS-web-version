"""Classify every chart folder under \\CSMAIN\IMAGE\SCAN into:
  A. has a plain top-level real-panoramic JPEG (easy Supabase upload, no
     decode needed)
  B. no plain JPEG, but has an NNT-proprietary 2D study (*.2dh under
     Document\...\2D Images collection\) -- live NNT view now fixed via
     /DIR; Supabase copy needs either a real NNT export or the
     approximate auto-decoder
  C. neither (no OPG available in CS for this chart at all)

Read-only. Prints counts + a sample of chart numbers per bucket, not full
patient details, to keep this safe to run/share.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
ROOT = r"\\CSMAIN\IMAGE\SCAN"
JPEG_EXT = {".jpg", ".jpeg", ".jpe"}


def jpeg_header(path: str):
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
                if mt in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
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


def is_a4(w, h):
    a, b = sorted((w, h))
    return (1600 <= a <= 1750 and 2250 <= b <= 2450) or (2400 <= a <= 2550 and 3400 <= b <= 3600)


def has_toplevel_pano_jpeg(chart_folder: str) -> bool:
    try:
        entries = list(os.scandir(chart_folder))
    except OSError:
        return False
    for ent in entries:
        if not ent.is_file():
            continue
        if os.path.splitext(ent.name)[1].lower() not in JPEG_EXT:
            continue
        hdr = jpeg_header(ent.path)
        if not hdr:
            continue
        w, h, nf = hdr
        if w <= 0 or h <= 0 or is_a4(w, h):
            continue
        aspect = w / float(h)
        if aspect >= 1.62 and w >= 700:
            return True
    return False


def has_nnt_2dh_study(chart_folder: str) -> bool:
    doc = os.path.join(chart_folder, "Document")
    if not os.path.isdir(doc):
        return False
    try:
        pattern = os.path.join(doc, "*", "*", "*", "*", "*", "2D Images collection")
        import glob
        hits = glob.glob(pattern)
        for h in hits:
            try:
                for fn in os.listdir(h):
                    if fn.lower().endswith(".2dh"):
                        return True
            except OSError:
                continue
    except OSError:
        pass
    return False


def main():
    buckets = Counter()
    samples = {"A": [], "B": [], "C": []}
    full_lists = {"A": [], "B": [], "C": []}
    try:
        charts = [e for e in os.scandir(ROOT) if e.is_dir()]
    except OSError as e:
        print(f"cannot list {ROOT}: {e}")
        return
    total = len(charts)
    print(f"chart folders={total}", flush=True)
    for i, chart in enumerate(charts, 1):
        if i % 100 == 0:
            print(f"  {i}/{total}  A={buckets['A']} B={buckets['B']} C={buckets['C']}", flush=True)
        chart_no = chart.name
        if has_toplevel_pano_jpeg(chart.path):
            buckets["A"] += 1
            full_lists["A"].append(chart_no)
            if len(samples["A"]) < 15:
                samples["A"].append(chart_no)
            continue
        if has_nnt_2dh_study(chart.path):
            buckets["B"] += 1
            full_lists["B"].append(chart_no)
            if len(samples["B"]) < 15:
                samples["B"].append(chart_no)
            continue
        buckets["C"] += 1
        full_lists["C"].append(chart_no)
        if len(samples["C"]) < 5:
            samples["C"].append(chart_no)

    print("\n=== RESULT ===")
    print(f"Total chart folders scanned: {total}")
    print(f"A. plain top-level pano JPEG (easy upload):        {buckets['A']}")
    print(f"B. NNT-proprietary-only 2D study (needs decode):   {buckets['B']}")
    print(f"C. no OPG found in CS for this chart:               {buckets['C']}")
    print("\nSample chart numbers per bucket (for spot-checking, not full list):")
    for k in ("A", "B", "C"):
        print(f"  {k}: {samples[k]}")

    out_dir = os.path.dirname(os.path.abspath(__file__))
    for k in ("A", "B", "C"):
        out_path = os.path.join(out_dir, f"_opg_population_{k}.txt")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("\n".join(full_lists[k]))
        print(f"wrote {len(full_lists[k])} chart numbers -> {out_path}")


if __name__ == "__main__":
    main()
