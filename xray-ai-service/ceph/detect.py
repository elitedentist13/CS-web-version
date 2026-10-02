"""ISBI 2015 empirical-mean fallback for POST /ceph/landmarks.

Uses the ISBI 400-film image-normalized senior mean written by
scripts/import-ceph-landmarks.py (Aariz + PKU shapes feed the browser box mean).
A trained detector can replace this.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAT = ROOT / "ceph" / "data" / "isbi2015.json"


def catalog():
    return json.loads(CAT.read_text(encoding="utf-8"))


def detect_landmarks(width, height):
    cat = catalog()
    pts = []
    n = cat.get("importedFilms") or cat.get("images") or 400
    for d in cat.get("landmarks") or []:
        nx = d.get("ix", d.get("nx"))
        ny = d.get("iy", d.get("ny"))
        pts.append({
            "id": d["id"],
            "i": d["i"],
            "name": d["name"],
            "x": float(nx) * float(width),
            "y": float(ny) * float(height),
        })
    return {
        "source": "isbi+aariz+pku-%s-imgmean" % n,
        "dataset": "ISBI2015-19",
        "films": n,
        "landmarks": pts,
        "mmPerPx": cat.get("mmPerPx", 0.1),
    }
