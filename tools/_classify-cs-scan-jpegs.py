"""Classify CS SCAN top-level JPEGs. Prints counts only."""
from __future__ import annotations

import os
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
ROOT = r"\\RECEPTION\IMAGE\SCAN"
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


def is_a4(w, h):
    a, b = sorted((w, h))
    # A4 @ 200dpi ~1654x2338, @300dpi ~2480x3508
    return (1600 <= a <= 1750 and 2250 <= b <= 2450) or (
        2400 <= a <= 2550 and 3400 <= b <= 3600
    )


def classify(w, h, nf):
    if w <= 0 or h <= 0:
        return "bad"
    aspect = w / float(h)
    gray = nf == 1
    if is_a4(w, h):
        return "a4_scan_form"
    # typical NewTom / PaX-i panoramic
    if aspect >= 1.62 and w >= 700:
        return "pano_gray" if gray else "pano_colorjpeg"
    # lateral ceph-ish
    if 0.75 <= aspect <= 1.15 and min(w, h) >= 700:
        return "ceph_gray" if gray else "ceph_or_photo_color"
    if aspect < 0.85:
        return "portrait_other_gray" if gray else "portrait_photo_or_form"
    return "other_gray" if gray else "other_color"


def main():
    buckets = Counter()
    nf_counts = Counter()
    dim_pano = Counter()
    n = 0
    charts = [e for e in os.scandir(ROOT) if e.is_dir()]
    print(f"chart folders={len(charts)}", flush=True)
    for i, chart in enumerate(charts, 1):
        if i % 200 == 0:
            print(f"  {i}/{len(charts)} jpegs={n}", flush=True)
        try:
            ents = os.scandir(chart.path)
        except OSError:
            continue
        for ent in ents:
            if not ent.is_file():
                continue
            if os.path.splitext(ent.name)[1].lower() not in JPEG_EXT:
                continue
            hdr = jpeg_header(ent.path)
            if not hdr:
                buckets["unreadable"] += 1
                continue
            w, h, nf = hdr
            n += 1
            nf_counts[nf] += 1
            cls = classify(w, h, nf)
            buckets[cls] += 1
            if cls.startswith("pano"):
                dim_pano[(w, h, nf)] += 1
    print(f"jpeg_total={n}")
    print("SOF components (1=grayscale jpeg, 3=color jpeg):")
    for k, v in nf_counts.most_common():
        print(f"  nf={k}: {v}")
    print("classes:")
    for k, v in buckets.most_common():
        print(f"  {k}: {v}")
    pano = buckets["pano_gray"] + buckets["pano_colorjpeg"]
    print(f"PANO CANDIDATES (wide landscape, not A4) = {pano}")
    print("pano dimension x nf:")
    for (w, h, nf), c in dim_pano.most_common(20):
        print(f"  {w}x{h} nf={nf} n={c} aspect={w/h:.2f}")


if __name__ == "__main__":
    main()
