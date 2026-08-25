"""
EDJ anatomy-first caries proposer and hard gate.

Pipeline (wrap-around for interproximal caries):

    tooth locators → enamel / dentin / pulp / EDJ masks
    → radiolucent shadows along the EDJ band
    → accept only shadows that extend into enamel and/or dentin
      with a caries-like shape (wedge / triangular / circular / dispersing)

Bone, empty interdental gaps, and pulp are hard exclusions.
CEJ / bone-crest geometry is never used here (that belongs to bone_loss).
"""

from __future__ import annotations

import logging
import math

import numpy as np

from models import geometry, intraoral_layers

log = logging.getLogger("xray-ai.caries.edj_anatomy")

# Relative lucency (mid-tissue − local) in CLAHE space.
_LUCENCY_THR = 8.0
_MAX_LUCENCY = 70.0
# Minimum EDJ-band overlap fraction for accept().
_MIN_EDJ_OVERLAP = 0.08
# Minimum enamel or dentin share of the shadow (of E+D total).
_MIN_TISSUE_SHARE = 0.18
# Contact column: fraction of tooth width from each side.
_CONTACT_FRAC = 0.38


def prepare_teeth(gray, teeth):
    """Ensure every tooth carries anatomy masks + EDJ band."""
    intraoral_layers.attach_anatomy(gray, teeth or [])
    return teeth


def propose_candidates(gray, teeth, cfg=None):
    """
    Propose interproximal caries candidates from EDJ-band shadows.

    Returns a list of candidate dicts compatible with reasoning.screen().
    """
    try:
        import cv2
    except Exception as exc:  # pragma: no cover
        log.debug("opencv unavailable; EDJ anatomy proposer disabled: %s", exc)
        return []

    prepare_teeth(gray, teeth)
    out = []
    for tooth in teeth or []:
        anatomy = tooth.get("anatomy")
        if not anatomy:
            continue
        out.extend(_propose_for_tooth(gray, tooth, anatomy, cv2))
    log.info("EDJ anatomy proposer added %d candidates", len(out))
    return out


def accept(candidate, tooth, gray=None):
    """
    Hard gate: True when the candidate is an EDJ-anchored tissue shadow.

    Used to filter YOLO / classical interproximal proposals. Returns
    (ok: bool, reason: str|None, meta: dict).
    """
    if tooth is None:
        return False, "no_tooth", {}
    anatomy = tooth.get("anatomy")
    if not anatomy:
        # Cannot hard-gate without masks (e.g. panoramic / failed seg) — fail open.
        return True, None, {}

    box = candidate.get("box")
    if not box:
        return False, "no_box", {}

    masks = anatomy["masks"]
    ox, oy = anatomy["origin"]
    tooth_m = masks.get("tooth")
    enamel_m = masks.get("enamel")
    dentin_m = masks.get("dentin")
    pulp_m = masks.get("pulp")
    edj_m = masks.get("edj_band")
    if tooth_m is None or edj_m is None:
        return False, "no_masks", {}

    h, w = tooth_m.shape[:2]
    comp = _rasterize_box(box, ox, oy, w, h)
    if candidate.get("polygon"):
        poly_m = _rasterize_polygon(candidate["polygon"], ox, oy, w, h)
        if poly_m is not None and np.any(poly_m):
            comp = poly_m

    area = float(np.count_nonzero(comp))
    if area < 4:
        return False, "tiny", {}

    in_tooth = float(np.count_nonzero(comp & (tooth_m > 0))) / area
    # Silhouette can still miss the outer contact face; AABB containment rescues
    # true proximal seeds that sit on the dilated rim.
    in_box = geometry.containment(box, tooth.get("box") or box)
    if in_tooth < 0.35 and in_box < 0.55:
        return False, "outside_tooth", {"in_tooth": in_tooth, "in_box": in_box}
    if in_tooth < 0.35 and in_box >= 0.55:
        in_tooth = max(in_tooth, 0.55)

    if pulp_m is not None:
        in_pulp = float(np.count_nonzero(comp & (pulp_m > 0))) / area
        if in_pulp >= 0.45:
            return False, "pulp", {"in_pulp": in_pulp}

    edj_overlap = float(np.count_nonzero(comp & (edj_m > 0))) / area
    if edj_overlap < _MIN_EDJ_OVERLAP:
        # Also allow if centroid is near EDJ curve or geometric EDJ line.
        near_curve = _near_edj_curve(box, anatomy.get("edj_curve"), max_dist=18.0)
        near_geo = _near_geometric_edj(box, tooth, max_apical_frac=0.85)
        if not (near_curve or near_geo):
            return False, "not_on_edj", {"edj_overlap": edj_overlap}

    e_px = float(np.count_nonzero(comp & (enamel_m > 0))) if enamel_m is not None else 0.0
    d_px = float(np.count_nonzero(comp & (dentin_m > 0))) if dentin_m is not None else 0.0
    tissue = e_px + d_px
    if tissue >= 4:
        e_frac = e_px / tissue
        d_frac = d_px / tissue
    else:
        # Proximal face often sits outside a tight silhouette mask — fall back
        # to geometric enamel/dentin zones for the candidate box.
        from models import caries_refine
        ge, gd = caries_refine.enamel_dentin_fractions(tooth, box)
        if ge is None or gd is None:
            return False, "no_enamel_dentin", {}
        e_frac, d_frac = ge / 100.0, gd / 100.0
    # Must involve enamel and/or dentin with EDJ as base — classic crossing
    # prefers both; single-tissue allowed if still on the EDJ band.
    if e_frac < _MIN_TISSUE_SHARE and d_frac < _MIN_TISSUE_SHARE:
        return False, "weak_tissue", {"enamel_frac": e_frac, "dentin_frac": d_frac}
    if e_frac < 0.08 and d_frac < 0.35:
        return False, "not_edj_extension", {"enamel_frac": e_frac, "dentin_frac": d_frac}
    if d_frac < 0.08 and e_frac < 0.35:
        return False, "not_edj_extension", {"enamel_frac": e_frac, "dentin_frac": d_frac}

    if not _in_contact_column(box, tooth):
        return False, "not_contact_column", {}

    shape = _classify_shape(comp, tooth)
    if shape == "strip":
        return False, "pulp_or_gap_strip", {"shape": shape}

    meta = {
        "enamel_pct": int(round(100.0 * e_frac)),
        "dentin_pct": int(round(100.0 * d_frac)),
        "edj_overlap": round(edj_overlap, 3),
        "shape": shape,
        "edj_crossing": bool(e_frac >= 0.12 and d_frac >= 0.15) or edj_overlap >= 0.20,
    }
    return True, None, meta


# ── proposer internals ─────────────────────────────────────────────
def _propose_for_tooth(gray, tooth, anatomy, cv2):
    masks = anatomy["masks"]
    ox, oy = anatomy["origin"]
    tooth_m = masks["tooth"]
    enamel_m = masks.get("enamel")
    dentin_m = masks.get("dentin")
    pulp_m = masks.get("pulp")
    edj_m = masks.get("edj_band")
    if edj_m is None or not np.any(edj_m):
        return []

    h, w = tooth_m.shape[:2]
    # Search ROI = EDJ band ∩ tooth − pulp − gap rim (already inset in band).
    search = (edj_m > 0) & (tooth_m > 0)
    if pulp_m is not None:
        search = search & (pulp_m == 0)
    if not np.any(search):
        return []

    roi = np.clip(gray[oy:oy + h, ox:ox + w], 0, 255).astype(np.uint8)
    if roi.shape[:2] != (h, w):
        return []
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
    eq = clahe.apply(roi)

    # Mid-tissue reference from dentin (fallback enamel) outside the darkest tips.
    ref_m = None
    if dentin_m is not None and np.count_nonzero(dentin_m) > 20:
        ref_m = (dentin_m > 0) & (pulp_m == 0 if pulp_m is not None else True)
    elif enamel_m is not None:
        ref_m = enamel_m > 0
    if ref_m is None or not np.any(ref_m):
        return []
    mid = float(eq[ref_m].mean())

    k = max(7, (min(h, w) // 5) | 1)
    bg = cv2.blur(eq, (k, k))
    lucent = np.clip(bg.astype(np.int16) - eq.astype(np.int16), 0, 255).astype(np.uint8)
    lucent = np.where(search, lucent, 0)

    # Relative to mid-tissue: keep moderately dark tissue, not air-gap black.
    # Gap floor from OUTSIDE the tooth silhouette (air / soft tissue in the ROI),
    # not from the EDJ band — the band already contains the lesion dark tip.
    outside = tooth_m == 0
    if np.count_nonzero(outside) >= 16:
        gap_floor = float(np.percentile(eq[outside], 75))
    else:
        gap_floor = 40.0
    _, mask = cv2.threshold(lucent, int(_LUCENCY_THR), 255, cv2.THRESH_BINARY)
    # Drop pixels that are as dark as empty gap / air.
    mask = np.where(
        (mask > 0) & (eq >= gap_floor + 10.0) & (eq <= mid - 3.0),
        255,
        0,
    ).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, connectivity=8)
    cands = []
    img_area = float(h * w)
    for i in range(1, n):
        area = float(stats[i, cv2.CC_STAT_AREA])
        if area < max(6.0, 0.0008 * img_area) or area > 0.12 * img_area:
            continue
        x, y, bw, bh = (
            stats[i, cv2.CC_STAT_LEFT],
            stats[i, cv2.CC_STAT_TOP],
            stats[i, cv2.CC_STAT_WIDTH],
            stats[i, cv2.CC_STAT_HEIGHT],
        )
        abs_box = {
            "x": float(ox + x),
            "y": float(oy + y),
            "w": float(bw),
            "h": float(bh),
        }
        if not _in_contact_column(abs_box, tooth):
            continue
        comp = (labels == i).astype(np.uint8) * 255
        # Gap / pulp / outside checks via accept path pieces.
        mean_luc = float(lucent[comp > 0].mean()) if np.any(comp) else 0.0
        if mean_luc > _MAX_LUCENCY:
            continue
        e_px = float(np.count_nonzero(comp & (enamel_m > 0))) if enamel_m is not None else 0.0
        d_px = float(np.count_nonzero(comp & (dentin_m > 0))) if dentin_m is not None else 0.0
        tissue = e_px + d_px
        if tissue < 4:
            continue
        e_frac = e_px / tissue
        d_frac = d_px / tissue
        if e_frac < 0.08 and d_frac < 0.20:
            continue
        if d_frac < 0.08 and e_frac < 0.20:
            continue
        shape = _classify_shape(comp, tooth)
        if shape == "strip":
            continue
        poly = _comp_polygon(comp, ox, oy, cv2)
        score = float(min(0.90, 0.55 + mean_luc / 45.0))
        if e_frac >= 0.12 and d_frac >= 0.15:
            score = min(0.92, score + 0.08)
        if shape in ("wedge", "triangular"):
            score = min(0.94, score + 0.06)
        cand = {
            "box": abs_box,
            "core_box": dict(abs_box),
            "score": score,
            "polygon": poly,
            "stage": None,
            "prefer_surface": "interproximal",
            "interproximal_seed": True,
            "edj_seed": True,
            "junction_seed": True,
            "anatomy_seed": True,
            "shape": shape,
            "enamel_pct": int(round(100.0 * e_frac)),
            "dentin_pct": int(round(100.0 * d_frac)),
            "edj_crossing": bool(e_frac >= 0.12 and d_frac >= 0.15),
        }
        cands.append(cand)
    return cands


def _in_contact_column(box, tooth):
    tb = tooth.get("box")
    if not tb or not box:
        return False
    cx = box["x"] + box["w"] * 0.5
    rel = (cx - tb["x"]) / max(tb["w"], 1e-6)
    return (0.04 <= rel <= _CONTACT_FRAC) or ((1.0 - _CONTACT_FRAC) <= rel <= 0.96)


def _near_edj_curve(box, curve, max_dist=10.0):
    if not curve or not box:
        return False
    cx, cy = geometry.box_center(box)
    best = min((cx - p[0]) ** 2 + (cy - p[1]) ** 2 for p in curve)
    return best <= max_dist * max_dist


def _near_geometric_edj(box, tooth, max_apical_frac=0.85):
    """True when the box centre sits from enamel-side EDJ through outer dentin."""
    from models import caries_refine

    arch = tooth.get("arch")
    tb = tooth.get("box")
    junction = caries_refine.edj_y(tooth)
    if not box or not tb or junction is None or arch not in ("upper", "lower"):
        return False
    cx, cy = geometry.box_center(box)
    sign = geometry.crown_edge_sign(arch)
    crown_h = tb["h"] * caries_refine.CROWN_RATIO
    apical = (cy - junction) * sign
    # Allow enamel side of EDJ through deep outer dentin (classic wedge).
    return -0.45 * crown_h <= apical <= max_apical_frac * crown_h


def _classify_shape(comp_mask, tooth):
    """
    Rough morphology: wedge/triangular, circular/ovoid, dispersing, or strip.

    Strip = tall thin component resembling pulp horn / gap bleed → reject.
    """
    try:
        import cv2
    except Exception:
        return "ovoid"
    ys, xs = np.where(comp_mask > 0)
    if xs.size < 6:
        return "ovoid"
    w = float(xs.max() - xs.min() + 1)
    h = float(ys.max() - ys.min() + 1)
    if h > 2.8 * max(w, 1.0) and w < 8:
        return "strip"
    area = float(xs.size)
    extent = area / max(w * h, 1.0)
    # Compact → circular/ovoid; broad along x near EDJ → dispersing; else wedge.
    if extent > 0.55 and 0.6 <= w / max(h, 1.0) <= 1.7:
        return "circular"
    if w >= 1.6 * h and extent > 0.35:
        return "dispersing"
    # Apex direction toward pulp (tooth centre).
    tb = tooth.get("box") or {}
    tcx = tb.get("x", 0) + tb.get("w", 0) * 0.5
    cx = float(xs.mean())
    # Proximal wedge: wider at outer edge, tip inward.
    if abs(cx - tcx) > 0.05 * max(tb.get("w", 1.0), 1.0):
        return "wedge"
    return "triangular"


def _rasterize_box(box, ox, oy, w, h):
    m = np.zeros((h, w), dtype=np.uint8)
    x1 = int(max(0, math.floor(box["x"] - ox)))
    y1 = int(max(0, math.floor(box["y"] - oy)))
    x2 = int(min(w, math.ceil(box["x"] + box["w"] - ox)))
    y2 = int(min(h, math.ceil(box["y"] + box["h"] - oy)))
    if x2 > x1 and y2 > y1:
        m[y1:y2, x1:x2] = 255
    return m


def _rasterize_polygon(polygon, ox, oy, w, h):
    if not polygon or len(polygon) < 3:
        return None
    try:
        import cv2
    except Exception:
        return None
    pts = np.array(
        [[[int(round(p[0] - ox)), int(round(p[1] - oy))]] for p in polygon],
        dtype=np.int32,
    )
    m = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(m, [pts], 255)
    return m


def _comp_polygon(comp, ox, oy, cv2):
    contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 4:
        return None
    eps = max(0.8, 0.02 * cv2.arcLength(largest, True))
    approx = cv2.approxPolyDP(largest, eps, True)
    if approx is None or len(approx) < 3:
        return None
    return [[float(p[0][0]) + ox, float(p[0][1]) + oy] for p in approx]
