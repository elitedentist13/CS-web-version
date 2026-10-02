"""ISBI 2015 mean-shape fallback for POST /ceph/landmarks.

A trained detector can replace `detect_landmarks`. Until then this returns
the same 19-point template the browser uses, scaled to the image size.
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
    for d in cat.get("landmarks") or []:
        pts.append({
            "id": d["id"],
            "i": d["i"],
            "name": d["name"],
            "x": float(d["nx"]) * float(width),
            "y": float(d["ny"]) * float(height),
        })
    return {
        "source": "isbi2015-mean",
        "dataset": "ISBI2015-19",
        "landmarks": pts,
        "mmPerPx": cat.get("mmPerPx", 0.1),
    }
