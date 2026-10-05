"""Lateral-ceph landmark detect: Banana sidecar UNet when weights exist, else 1502 mean.

Uses the ISBI 400-film image-normalized senior mean written by
scripts/import-ceph-landmarks.py (Aariz + PKU shapes feed the browser box mean).
The published 1502 library is never mutated.
"""
import json
import logging
from pathlib import Path

log = logging.getLogger("xray-ai.ceph.detect")

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
        "ok": True,
        "source": "isbi+aariz+pku-%s-imgmean" % n,
        "dataset": "ISBI2015-19",
        "films": n,
        "landmarks": pts,
        "mmPerPx": cat.get("mmPerPx", 0.1),
        "via": "mean",
    }


def _pack_unet(uni, cat):
    by_id = {d["id"]: d for d in (cat.get("landmarks") or [])}
    pts = []
    for d in cat.get("landmarks") or []:
        p = (uni.get("pts") or {}).get(d["id"])
        if not p:
            continue
        pts.append({
            "id": d["id"],
            "i": d["i"],
            "name": d["name"],
            "x": float(p["x"]),
            "y": float(p["y"]),
        })
    extras = []
    for eid, p in (uni.get("extra") or {}).items():
        extras.append({"id": eid, "x": float(p["x"]), "y": float(p["y"])})
    return {
        "ok": True,
        "source": uni.get("source") or "dental_001-unet-29",
        "dataset": "Aariz-29→ISBI-19",
        "films": cat.get("importedFilms") or 1502,
        "landmarks": pts,
        "extra": extras,
        "mmPerPx": cat.get("mmPerPx", 0.1),
        "via": "unet",
        "model": uni.get("model") or "unet",
        "note": uni.get("note"),
        "catalogIds": list(by_id.keys()),
    }


def detect_image(image):
    """Prefer Banana sidecar UNet; fall back to the published image-mean."""
    w, h = image.size
    cat = catalog()
    try:
        from ceph import unet
        uni = unet.detect(image)
        if uni and uni.get("ok") and uni.get("pts"):
            packed = _pack_unet(uni, cat)
            if len(packed["landmarks"]) >= 19:
                return packed
            log.info("UNet returned %s ISBI points; using 1502 mean", len(packed["landmarks"]))
    except Exception as exc:
        log.warning("UNet landmark detect failed: %s", exc)
    return detect_landmarks(w, h)
