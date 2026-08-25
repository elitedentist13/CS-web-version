"""
Classical tooth-box segmentation for periapical and bitewing radiographs.

WHY THIS EXISTS
    The panoramic FDI ONNX detector (abychkov/dental-fdi-detection) was trained
    on panoramics. On PAs/bitewings its scores top out well below the 0.30 gate,
    so every tooth is discarded and the caries/bone stages short-circuit to
    empty. This module is the add-on that restores tooth boxes on those
    modalities without touching the panoramic path.

WHAT IT RETURNS
    The same contract as ToothDetector.detect:
        [{'box': {x,y,w,h} px, 'score': float, 'fdi': None, 'source': 'intraoral_classical'}]

    `fdi` is intentionally None — classical CV has no tooth-number classifier.
    Downstream stages that need FDI (bone site labels) tolerate a missing value.

METHOD (recall-oriented, not a diagnosis)
    CLAHE → bright-structure mask → distance transform + watershed to split
    fused crowns → size/aspect filters → NMS. Real PAs often fuse teeth into
    one Otsu component; watershed is what separates them.
"""

from __future__ import annotations

import logging

import numpy as np

from . import geometry

log = logging.getLogger("xray-ai.intraoral_teeth")


def segment(gray, modality="periapical", max_teeth=16):
    """
    Segment tooth boxes on an intraoral radiograph.

    Args:
        gray: float32 HxW, 0..255 (pipeline contrast-stretched).
        modality: 'bitewing' | 'periapical' — adjusts aspect/area priors.
        max_teeth: hard cap after NMS (clinic bitewings rarely exceed ~12).
    """
    try:
        import cv2
    except Exception as exc:  # pragma: no cover
        log.warning("opencv unavailable; intraoral tooth seg disabled: %s", exc)
        return []

    if gray is None or gray.size == 0:
        return []

    h, w = gray.shape[:2]
    u8 = np.clip(gray, 0, 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    eq = clahe.apply(u8)

    # Bitewings are often unevenly exposed — a softer bright mask recovers the
    # dimmer arch half that a p70 cut drops (and caries lives on those contacts).
    mask = _bright_mask(eq, cv2, soft=(modality == "bitewing"))
    if mask is None or not np.any(mask):
        return []

    # Split fused tooth masses. Without this, Otsu often yields one giant
    # component covering the whole dentition on real PAs.
    labels = _watershed_labels(mask, cv2, aggressive=(modality == "bitewing"))
    if labels is None:
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        components = range(1, n)
        get_stats = lambda i: stats[i]
    else:
        components = [i for i in np.unique(labels) if i > 0]
        get_stats = lambda i: _stats_from_label(labels, i)

    img_area = float(h * w)
    min_area, max_area, min_ar, max_ar = _priors(modality, img_area)

    candidates = []
    for i in components:
        x, y, bw, bh, area = get_stats(i)
        if area < min_area or area > max_area:
            continue
        if bw < 10 or bh < 16:
            continue
        ar = bw / float(bh)
        if ar < min_ar or ar > max_ar:
            continue
        if _is_border_strip(x, y, bw, bh, w, h):
            continue

        roi = eq[y : y + bh, x : x + bw]
        comp = labels[y : y + bh, x : x + bw] == i
        if not np.any(comp):
            continue
        tooth_mean = float(roi[comp].mean())
        ring = _ring_mean(eq, x, y, bw, bh, w, h)
        contrast = (tooth_mean - ring) / 255.0
        if contrast < 0.01:
            continue
        score = float(min(0.95, 0.35 + 0.9 * max(0.0, contrast)))
        candidates.append({
            "box": {"x": float(x), "y": float(y), "w": float(bw), "h": float(bh)},
            "score": score,
            "fdi": None,
            "source": "intraoral_classical",
        })

    # Column fallback: fill gaps left-to-right. On bitewings always merge —
    # watershed often keeps only the brighter arch half.
    if len(candidates) < 2 or modality == "bitewing":
        col_boxes = _column_boxes(eq, mask, modality, cv2)
        for box in col_boxes:
            candidates.append({
                "box": box,
                "score": 0.45,
                "fdi": None,
                "source": "intraoral_classical",
            })
        # Split lower/upper rows on bitewing so one tall column is not one tooth.
        if modality == "bitewing":
            candidates.extend(_bitewing_row_split(eq, mask, candidates, cv2))

    kept = geometry.nms(candidates, thresh=0.35)
    kept.sort(key=lambda d: d["box"]["x"])
    if len(kept) > max_teeth:
        kept = sorted(kept, key=lambda d: d["score"], reverse=True)[:max_teeth]
        kept.sort(key=lambda d: d["box"]["x"])

    log.info("intraoral tooth seg (%s): %d boxes", modality, len(kept))
    return kept


def annotate_arches_intraoral(teeth, modality, height):
    """
    Tag arch for PA/bitewing without the panoramic median split.

    Bitewing: teeth above image mid-line = upper, below = lower.
    Periapical: usually one arch — assign from the cluster centre.
    """
    if not teeth:
        return
    mid = height * 0.5
    if modality == "bitewing":
        for t in teeth:
            cy = geometry.box_center(t["box"])[1]
            t["arch"] = "upper" if cy < mid else "lower"
        return

    centers = [geometry.box_center(t["box"])[1] for t in teeth]
    cluster = float(sum(centers) / len(centers))
    arch = "upper" if cluster < mid else "lower"
    for t in teeth:
        t["arch"] = arch


# ── internals ──────────────────────────────────────────────────────
def _bright_mask(eq, cv2, soft=False):
    blur = cv2.GaussianBlur(eq, (5, 5), 0)
    # Soft tissue / background is darker; take the brighter half via Otsu, then
    # tighten with a percentile cut so bone sheet does not swallow everything.
    thr, _ = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    pct = 60.0 if soft else 70.0
    p_cut = float(np.percentile(blur, pct))
    cut = max(float(thr) * (0.90 if soft else 1.0), p_cut)
    _, mask = cv2.threshold(blur, cut, 255, cv2.THRESH_BINARY)
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_open, iterations=1)
    return mask


def _watershed_labels(mask, cv2, aggressive=False):
    """Return a label map with fused masses split, or None on failure."""
    try:
        dist = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
        if dist.max() < 4:
            return None
        # Seeds at distance peaks; bitewings need a lower peak cut so the
        # dimmer arch half still gets markers.
        peak = 0.28 if aggressive else 0.35
        retry = 0.16 if aggressive else 0.22
        _, sure_fg = cv2.threshold(dist, peak * dist.max(), 255, 0)
        sure_fg = np.uint8(sure_fg)
        n_markers, markers = cv2.connectedComponents(sure_fg)
        if n_markers <= 2:
            _, sure_fg = cv2.threshold(dist, retry * dist.max(), 255, 0)
            sure_fg = np.uint8(sure_fg)
            n_markers, markers = cv2.connectedComponents(sure_fg)
            if n_markers <= 2:
                return None
        # Unknown region = mask minus sure foreground.
        sure_bg = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
        unknown = cv2.subtract(sure_bg, sure_fg)
        markers = markers + 1
        markers[unknown == 255] = 0
        color = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        cv2.watershed(color, markers)
        # watershed marks boundaries as -1; shift labels so background is 0.
        labels = markers.copy()
        labels[labels <= 1] = 0
        labels[labels > 1] = labels[labels > 1] - 1
        return labels
    except Exception as exc:
        log.debug("watershed failed: %s", exc)
        return None


def _bitewing_row_split(eq, mask, candidates, cv2):
    """
    On bitewings a left-to-right column can span upper+lower crowns.

    Split any tall box that crosses the image mid-line into upper/lower
    halves when both halves still look like tooth tissue.
    """
    h, w = eq.shape[:2]
    mid = h * 0.5
    out = []
    for c in list(candidates):
        b = c["box"]
        if b["h"] < 0.45 * h:
            continue
        if not (b["y"] < mid < b["y"] + b["h"]):
            continue
        for y1, y2 in ((b["y"], mid), (mid, b["y"] + b["h"])):
            bh = y2 - y1
            if bh < 0.12 * h:
                continue
            x1, x2 = int(b["x"]), int(b["x"] + b["w"])
            yi1, yi2 = int(y1), int(y2)
            patch = mask[yi1:yi2, x1:x2]
            if patch.size == 0 or float(patch.mean()) < 40:
                continue
            rows = np.where(patch.any(axis=1))[0]
            if rows.size < 12:
                continue
            yy1 = yi1 + int(rows[0])
            yy2 = yi1 + int(rows[-1]) + 1
            out.append({
                "box": {
                    "x": float(b["x"]),
                    "y": float(yy1),
                    "w": float(b["w"]),
                    "h": float(yy2 - yy1),
                },
                "score": float(c.get("score", 0.45)) * 0.95,
                "fdi": None,
                "source": "intraoral_classical",
            })
    return out


def _column_boxes(eq, mask, modality, cv2):
    """Split the dentition into left-to-right tooth columns via projection."""
    h, w = eq.shape[:2]
    col = (mask > 0).sum(axis=0).astype(np.float32)
    if col.max() < h * 0.05:
        return []
    # Smooth and find valleys between peaks.
    k = max(5, (w // 40) | 1)
    sm = cv2.GaussianBlur(col.reshape(1, -1), (k, 1), 0).ravel()
    thr = 0.25 * float(sm.max())
    active = sm >= thr
    # Find contiguous active runs (= tooth columns).
    boxes = []
    i = 0
    min_w = max(12, int(0.04 * w))
    max_w = int(0.35 * w)
    while i < w:
        if not active[i]:
            i += 1
            continue
        j = i
        while j < w and active[j]:
            j += 1
        bw = j - i
        if min_w <= bw <= max_w:
            strip = mask[:, i:j]
            rows = np.where(strip.any(axis=1))[0]
            if rows.size > 16:
                y1, y2 = int(rows[0]), int(rows[-1]) + 1
                bh = y2 - y1
                ar = bw / float(bh)
                min_ar, max_ar = _priors(modality, float(h * w))[2:]
                if min_ar <= ar <= max_ar:
                    boxes.append({
                        "x": float(i), "y": float(y1),
                        "w": float(bw), "h": float(bh),
                    })
        i = j
    return boxes


def _stats_from_label(labels, idx):
    ys, xs = np.where(labels == idx)
    if xs.size == 0:
        return 0, 0, 0, 0, 0
    x, y = int(xs.min()), int(ys.min())
    bw, bh = int(xs.max() - x + 1), int(ys.max() - y + 1)
    return x, y, bw, bh, int(xs.size)


def _priors(modality, img_area):
    if modality == "bitewing":
        # Slightly smaller min area so premolars on dimmer half survive.
        return (
            0.004 * img_area,
            0.35 * img_area,
            0.28,
            1.60,
        )
    return (
        0.006 * img_area,
        0.45 * img_area,
        0.14,
        1.10,
    )


def _is_border_strip(x, y, bw, bh, w, h):
    on_border = x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1
    return on_border and (bw < 0.08 * w or bh < 0.08 * h)


def _ring_mean(eq, x, y, bw, bh, w, h):
    pad = max(4, int(0.15 * max(bw, bh)))
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(w, x + bw + pad)
    y2 = min(h, y + bh + pad)
    ring = eq[y1:y2, x1:x2].copy()
    ix1, iy1 = x - x1, y - y1
    ring[iy1 : iy1 + bh, ix1 : ix1 + bw] = 0
    vals = ring[ring > 0]
    if vals.size < 8:
        return float(eq.mean())
    return float(vals.mean())
