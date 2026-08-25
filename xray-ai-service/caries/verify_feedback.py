"""
Deterministic tests for the continual-learning capture (caries/feedback.py).

Run from the service root:
    python -m caries.verify_feedback

Needs only Pillow. No network, no models. Writes to a throwaway temp dir.
"""

import json
import os
import shutil
import tempfile

from PIL import Image

from caries import feedback

PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        print("  FAIL " + name + ("  (" + detail + ")" if detail else ""))
        raise SystemExit(1)
    PASS += 1
    print("  ok  " + name)


def _img():
    return Image.new("RGB", (200, 150), (128, 128, 128))


def _lines(path):
    if not os.path.exists(path):
        return []
    return [ln for ln in open(path, encoding="utf-8").read().splitlines() if ln.strip()]


tmp = tempfile.mkdtemp(prefix="cs-caries-fb-")
try:
    img = _img()
    meta = {"xray_id": "abc123", "created_by": "Dr Test", "model_version": "v1", "consent": True}

    print("confirm accumulates positive labels")
    f1 = {"type": "caries_incipient", "box": {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1},
          "confidence": 0.6, "surface": "interproximal", "source": "cs-caries-workflow"}
    r = feedback.record(img, f1, "confirm", meta, tmp)
    label_path = os.path.join(tmp, "labels", r["stem"] + ".txt")
    img_path = os.path.join(tmp, "images", r["stem"] + ".png")
    check("image written once", os.path.exists(img_path))
    check("one positive label line", len(_lines(label_path)) == 1)
    check("label is class 0 with a polygon", _lines(label_path)[0].startswith("0 ") and
          len(_lines(label_path)[0].split()) >= 7)

    f2 = {"type": "caries_progressed", "polygon": [[0.5, 0.5], [0.6, 0.5], [0.6, 0.6], [0.5, 0.6]],
          "confidence": 0.7, "surface": "occlusal"}
    feedback.record(img, f2, "confirm", meta, tmp)
    check("second confirm on same image accumulates", len(_lines(label_path)) == 2)

    print("reject is a hard negative, not an empty label")
    fr = {"type": "caries_incipient", "box": {"x": 0.2, "y": 0.2, "w": 0.08, "h": 0.08},
          "confidence": 0.5, "surface": "cervical"}
    feedback.record(img, fr, "reject", meta, tmp)
    check("positive labels unchanged by a reject", len(_lines(label_path)) == 2)
    neg = _lines(os.path.join(tmp, "negatives.jsonl"))
    check("reject recorded in negatives.jsonl", len(neg) == 1)
    check("negative carries the region", json.loads(neg[0]).get("box") is not None)

    print("manifest + stats")
    man = _lines(os.path.join(tmp, "manifest.jsonl"))
    check("manifest has one line per verdict", len(man) == 3)
    check("manifest records consent + author",
          json.loads(man[0]).get("consent") is True and json.loads(man[0]).get("created_by") == "Dr Test")
    s = feedback.stats(tmp)
    check("stats count verdicts", s["confirm"] == 2 and s["reject"] == 1 and s["total"] == 3)
    check("stats count one image", s["images"] == 1)

    print("guards")
    try:
        feedback.record(img, f1, "banana", meta, tmp)
        check("invalid verdict raises", False)
    except ValueError:
        check("invalid verdict raises", True)

    # No xray_id → falls back to a content hash, still stable across calls.
    r_a = feedback.record(_img(), f1, "confirm", {"consent": False}, tmp)
    r_b = feedback.record(_img(), f2, "confirm", {"consent": False}, tmp)
    check("hash-keyed image is stable without xray_id", r_a["stem"] == r_b["stem"] and
          r_a["stem"].startswith("img_"))

    print("\n%d checks passed" % PASS)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
