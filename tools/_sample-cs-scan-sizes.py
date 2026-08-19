"""Print one example path per common JPEG size (no patient names in summary)."""
from __future__ import annotations

import os
import sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
ROOT = r"\\RECEPTION\IMAGE\SCAN"
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
                    if len(data) < 5:
                        return None
                    h = int.from_bytes(data[1:3], "big")
                    w = int.from_bytes(data[3:5], "big")
                    return w, h
                f.seek(length - 2, os.SEEK_CUR)
    except OSError:
        return None


WANT = {
    (2481, 3507),
    (1252, 681),
    (1200, 1600),
    (1654, 2338),
    (2000, 2250),
    (1600, 839),
    (1600, 900),
    (1600, 1200),
    (2338, 1654),
    (974, 861),
    (1422, 1600),
    (2114, 1189),
    (1022, 556),
    (799, 435),
    (1280, 984),
    (2040, 1530),
}

found = {}
aspect_ge_15 = 0
aspect_ge_16 = 0
aspect_ge_17 = 0
a4_portrait = 0
a4_landscape = 0
phone_43_portrait = 0

for chart in os.scandir(ROOT):
    if not chart.is_dir():
        continue
    try:
        ents = os.scandir(chart.path)
    except OSError:
        continue
    for ent in ents:
        if not ent.is_file():
            continue
        if os.path.splitext(ent.name)[1].lower() not in JPEG_EXT:
            continue
        size = jpeg_size(ent.path)
        if not size:
            continue
        w, h = size
        aspect = w / h if h else 0
        if 1.5 <= aspect <= 3.6:
            aspect_ge_15 += 1
        if 1.6 <= aspect <= 3.6:
            aspect_ge_16 += 1
        if 1.7 <= aspect <= 3.6:
            aspect_ge_17 += 1
        if (w, h) in ((2480, 3508), (2481, 3507), (2479, 3507), (1654, 2338), (1653, 2339)):
            a4_portrait += 1
        if (w, h) in ((3507, 2481), (3508, 2480), (2338, 1654)):
            a4_landscape += 1
        if (w, h) in ((1200, 1600), (1536, 2048), (1530, 2040), (768, 1024), (480, 640)):
            phone_43_portrait += 1
        if (w, h) in WANT and (w, h) not in found:
            found[(w, h)] = ent.path

print("aspect>=1.5:", aspect_ge_15)
print("aspect>=1.6:", aspect_ge_16)
print("aspect>=1.7:", aspect_ge_17)
print("a4_portrait_exact:", a4_portrait)
print("a4_landscape_exact:", a4_landscape)
print("phone_43_portrait_exact:", phone_43_portrait)
print("SAMPLES")
for k in sorted(found, key=lambda x: (-x[0] * x[1], x)):
    print(f"{k[0]}x{k[1]}\t{found[k]}")
