"""
Capture clinician verdicts as training data (the continual-learning flywheel).

When a clinician confirms or rejects a caries hint, `record` writes it into a
growing YOLO-seg dataset on disk, keyed by the image so repeated verdicts on the
same radiograph accumulate into one label file:

    clinic_data/
      images/<stem>.png            the radiograph (written once)
      labels/<stem>.txt            YOLO-seg polygons for CONFIRMED lesions
      negatives.jsonl              rejected regions, kept as hard negatives
      manifest.jsonl               one line per verdict: full provenance + consent

A confirmed finding becomes a positive label. A rejected finding is NOT turned
into an empty label (the image may hold other, real lesions) — it is recorded
as a hard-negative region the continual trainer can use to punish that specific
false positive. Every line carries who/when/consent so the dataset is auditable
and PDPO-defensible.
"""

import hashlib
import json
import logging
import os
import time

log = logging.getLogger("xray-ai.caries.feedback")

VALID_VERDICTS = ("confirm", "reject", "correct")


def record(pil_image, finding, verdict, meta, data_dir):
    """
    Persist one verdict.

    Args:
        pil_image: the radiograph (PIL Image).
        finding: dict with normalized (0..1) 'box' and optional 'polygon',
                 plus 'type', 'confidence', 'surface'.
        verdict: 'confirm' | 'reject' | 'correct'.
        meta: dict — xray_id, patient_ref, created_by, model_version, consent.
        data_dir: root of the clinic dataset.
    Returns:
        dict summary (stem, verdict, positives_for_image, path).
    """
    verdict = (verdict or "").strip().lower()
    if verdict not in VALID_VERDICTS:
        raise ValueError("invalid verdict: %r" % verdict)

    images_dir = os.path.join(data_dir, "images")
    labels_dir = os.path.join(data_dir, "labels")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    stem = _stem_for(pil_image, meta)
    img_path = os.path.join(images_dir, stem + ".png")
    if not os.path.exists(img_path):
        pil_image.convert("L").save(img_path)  # radiographs are greyscale

    w, h = pil_image.size
    polygon_px = _polygon_px(finding, w, h)

    positives = 0
    if verdict in ("confirm", "correct") and polygon_px:
        _append_label(os.path.join(labels_dir, stem + ".txt"), polygon_px, w, h)
        positives = _count_label_lines(os.path.join(labels_dir, stem + ".txt"))
    elif verdict == "reject":
        _append_jsonl(os.path.join(data_dir, "negatives.jsonl"), {
            "stem": stem,
            "box": finding.get("box"),
            "surface": finding.get("surface"),
            "was_confidence": finding.get("confidence"),
            "ts": _now(),
        })

    entry = {
        "stem": stem,
        "verdict": verdict,
        "type": finding.get("type"),
        "surface": finding.get("surface"),
        "confidence": finding.get("confidence"),
        "source": finding.get("source"),
        "xray_id": meta.get("xray_id"),
        "patient_ref": meta.get("patient_ref"),
        "created_by": meta.get("created_by"),
        "model_version": meta.get("model_version"),
        "consent": bool(meta.get("consent")),
        "ts": _now(),
    }
    _append_jsonl(os.path.join(data_dir, "manifest.jsonl"), entry)
    log.info("caries feedback recorded: %s verdict=%s (%d positive labels)",
             stem, verdict, positives)
    return {"stem": stem, "verdict": verdict, "positives_for_image": positives,
            "image": img_path}


def recent(data_dir, limit=50):
    """Most-recent verdicts (newest first) for the review screen."""
    manifest = os.path.join(data_dir, "manifest.jsonl")
    if not os.path.exists(manifest):
        return []
    entries = []
    for line in _read_lines(manifest):
        try:
            entries.append(json.loads(line))
        except ValueError:
            continue
    return entries[-limit:][::-1]


def stats(data_dir):
    """Counts for the /health surface and the trainer's sanity checks."""
    manifest = os.path.join(data_dir, "manifest.jsonl")
    counts = {"confirm": 0, "reject": 0, "correct": 0, "images": 0, "total": 0}
    if os.path.exists(manifest):
        seen = set()
        for line in _read_lines(manifest):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            counts["total"] += 1
            counts[e.get("verdict", "")] = counts.get(e.get("verdict", ""), 0) + 1
            seen.add(e.get("stem"))
        counts["images"] = len(seen)
    return counts


# ── helpers ────────────────────────────────────────────────────────
def _stem_for(pil_image, meta):
    """
    Stable per-image key. Prefer the xray_id so verdicts on the same radiograph
    accumulate; otherwise hash the pixels so re-uploads still collapse together.
    """
    xid = meta.get("xray_id")
    if xid:
        return "xid_" + _safe(str(xid))
    digest = hashlib.sha1(pil_image.convert("L").tobytes()).hexdigest()[:16]
    return "img_" + digest


def _polygon_px(finding, w, h):
    poly = finding.get("polygon")
    if isinstance(poly, list) and len(poly) >= 3:
        return [[_to_px(p[0], w), _to_px(p[1], h)] for p in poly if len(p) >= 2]
    box = finding.get("box")
    if not box:
        return None
    x, y = _to_px(box.get("x", 0), w), _to_px(box.get("y", 0), h)
    bw, bh = _to_px(box.get("w", 0), w), _to_px(box.get("h", 0), h)
    if bw <= 0 or bh <= 0:
        return None
    return [[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]]


def _to_px(v, dim):
    v = float(v)
    # Accept either normalized 0..1 or already-pixel coordinates.
    return v * dim if v <= 1.5 else v


def _append_label(path, polygon_px, w, h):
    coords = []
    for x, y in polygon_px:
        coords.append("%.6f" % min(1.0, max(0.0, x / w)))
        coords.append("%.6f" % min(1.0, max(0.0, y / h)))
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("0 " + " ".join(coords) + "\n")


def _count_label_lines(path):
    if not os.path.exists(path):
        return 0
    return sum(1 for ln in _read_lines(path) if ln.strip())


def _append_jsonl(path, entry):
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _read_lines(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.readlines()


def _safe(s):
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in s)[:64]


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
