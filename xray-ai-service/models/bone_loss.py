"""
Stage 3 - periodontal CEJ-to-alveolar-crest assessment.

WHAT THIS IS: a geometric heuristic anchored to Stage 1 tooth detections.
Every detected tooth from incisor through molar is measured on both proximal
surfaces (mesial and distal when FDI is known). The CEJ is estimated from
tooth-class geometry; the alveolar crest is the first convincing intensity
step from that CEJ toward the apex in the interproximal column.

WHAT THIS IS NOT: a trained or cleared bone-loss device. Pearl Second Opinion
BLE is a separately FDA-cleared CEJ-to-crest measurement. This remains an
estimate, mediated by class-specific gates so a molar sinus floor or a thin
incisor profile is not scored with the same rule.

SWAPPABLE BY DESIGN: `estimate_bone_loss()` is the only pipeline entry point.
"""

import logging

import numpy as np

from . import geometry

log = logging.getLogger("xray-ai.boneloss")

# Default CEJ as a fraction of tooth height from the occlusal edge toward the
# apex. Class-specific values override this in CLASS_GATES.
CEJ_RATIO = 0.34

# Fallback severity bands (used only if a class table is missing).
SEVERITY_MILD_MAX = 0.24
SEVERITY_MODERATE_MAX = 0.34

NORMAL_CEJ_TO_CREST_MM = 2.0
CREST_SEARCH_START_FRAC = 0.06
CREST_SEARCH_END_FRAC = 0.60
CREST_MIN_EDGE_ABS = 4.0
CREST_MIN_EDGE_REL = 0.25

# Per-class gates. Incisors have shorter roots and thinner septa (softer crest
# edge, tighter millimetre bands). Molars stop the crest search earlier so the
# maxillary sinus floor is not reported as severe loss.
CLASS_GATES = {
    "incisor": {
        "cej_ratio": 0.40,
        "physiologic_mm": 2.0,
        "mild_max_mm": 3.2,
        "moderate_max_mm": 5.0,
        "max_plausible_mm": 9.0,
        "crest_edge_abs": 3.0,
        "crest_edge_rel": 0.20,
        "crest_end_frac": 0.55,
        "min_root_px": 6.0,
    },
    "canine": {
        "cej_ratio": 0.36,
        "physiologic_mm": 2.0,
        "mild_max_mm": 3.5,
        "moderate_max_mm": 5.5,
        "max_plausible_mm": 11.0,
        "crest_edge_abs": 3.5,
        "crest_edge_rel": 0.22,
        "crest_end_frac": 0.58,
        "min_root_px": 8.0,
    },
    "premolar": {
        "cej_ratio": 0.34,
        "physiologic_mm": 2.0,
        "mild_max_mm": 3.5,
        "moderate_max_mm": 5.5,
        "max_plausible_mm": 12.0,
        "crest_edge_abs": 4.0,
        "crest_edge_rel": 0.25,
        "crest_end_frac": 0.60,
        "min_root_px": 8.0,
    },
    "molar": {
        "cej_ratio": 0.32,
        "physiologic_mm": 2.2,
        "mild_max_mm": 4.0,
        "moderate_max_mm": 6.0,
        "max_plausible_mm": 14.0,
        "crest_edge_abs": 4.5,
        "crest_edge_rel": 0.28,
        "crest_end_frac": 0.50,
        "min_root_px": 10.0,
    },
}


def estimate_bone_loss(teeth, gray, mean_tooth_width_mm=8.0):
    """
    Measure CEJ-to-crest on every tooth, both proximal surfaces.

    Physiologic sites (at or below the class gate) are still returned so the
    client can draw the line; only sites that pass every gate and exceed the
    class physiologic cutoff become bone-loss findings (`accepted=True`).
    """
    if gray is None or not teeth:
        return []

    px_per_mm = _estimate_px_per_mm(teeth, mean_tooth_width_mm)
    if px_per_mm <= 0:
        return []

    _assign_tooth_classes(teeth)
    upper, lower = _split_arches(teeth)
    results = []
    for arch_name, arch_teeth in (("upper", upper), ("lower", lower)):
        if not arch_teeth:
            continue
        ordered = sorted(arch_teeth, key=lambda t: t["box"]["x"])
        for idx, tooth in enumerate(ordered):
            left_n = ordered[idx - 1] if idx > 0 else None
            right_n = ordered[idx + 1] if idx + 1 < len(ordered) else None
            for side, neighbor in (("left", left_n), ("right", right_n)):
                site = _measure_surface(
                    tooth, neighbor, side, arch_name, gray, px_per_mm
                )
                if site is not None:
                    results.append(site)
    return results


def classify_fdi(fdi):
    """Map a permanent FDI number to incisor / canine / premolar / molar."""
    try:
        n = int(fdi)
    except (TypeError, ValueError):
        return None
    pos = n % 10
    if n < 11 or n > 48 or pos < 1 or pos > 8:
        return None
    if pos <= 2:
        return "incisor"
    if pos == 3:
        return "canine"
    if pos <= 5:
        return "premolar"
    return "molar"


def _assign_tooth_classes(teeth):
    have_fdi = any(t.get("fdi") is not None for t in teeth)
    for tooth in teeth:
        named = classify_fdi(tooth.get("fdi"))
        if named:
            tooth["tooth_class"] = named
        elif have_fdi:
            tooth["tooth_class"] = _infer_class_from_neighbors(tooth, teeth)
        else:
            tooth["tooth_class"] = _infer_class_shape_or_span(tooth, teeth)


def _infer_class_from_neighbors(tooth, teeth):
    # Isolated missing FDI: use position among numbered neighbours.
    return _infer_class_shape_or_span(tooth, teeth)


def _infer_class_shape_or_span(tooth, teeth):
    """
    When FDI is missing (intraoral classical boxes), infer class from
    crown shape and where the tooth sits on the film.

    Wide span + many teeth → panoramic-like: midline = incisors, edges = molars.
    Short span (PA / bitewing) → aspect and width vs the local median.
    """
    xs = [t["box"]["x"] + t["box"]["w"] / 2.0 for t in teeth]
    min_x, max_x = min(xs), max(xs)
    span = max(max_x - min_x, 1.0)
    widths = [t["box"]["w"] for t in teeth if t["box"]["w"] > 0]
    heights = [t["box"]["h"] for t in teeth if t["box"]["h"] > 0]
    med_w = float(np.median(widths)) if widths else tooth["box"]["w"]
    med_h = float(np.median(heights)) if heights else tooth["box"]["h"]
    box = tooth["box"]
    ar = box["w"] / float(max(box["h"], 1.0))
    rel = ((box["x"] + box["w"] / 2.0) - min_x) / span
    dist_mid = abs(rel - 0.5)

    # Full-arch film: position dominates.
    if len(teeth) >= 8 and span > 6.0 * med_w:
        if dist_mid < 0.12:
            return "incisor"
        if dist_mid < 0.20:
            return "canine"
        if dist_mid < 0.36:
            return "premolar"
        return "molar"

    # Intraoral crop: molars are wide; incisors are tall and narrow.
    if ar >= 0.62 or box["w"] > 1.22 * med_w:
        return "molar"
    if ar <= 0.38 or box["h"] > 1.22 * med_h:
        return "incisor"
    if box["w"] < 0.88 * med_w:
        return "premolar"
    return "premolar"


def _estimate_px_per_mm(teeth, mean_tooth_width_mm):
    widths = [t["box"]["w"] for t in teeth if t["box"]["w"] > 0]
    if not widths or mean_tooth_width_mm <= 0:
        return 0.0
    return float(np.median(widths)) / mean_tooth_width_mm


def _split_arches(teeth):
    annotated_upper = [t for t in teeth if t.get("arch") == "upper"]
    annotated_lower = [t for t in teeth if t.get("arch") == "lower"]
    if annotated_upper or annotated_lower:
        return annotated_upper, annotated_lower

    centers = [geometry.box_center(t["box"])[1] for t in teeth]
    if not centers:
        return [], []
    split_y = float(np.median(centers))
    upper = [t for t in teeth if geometry.box_center(t["box"])[1] <= split_y]
    lower = [t for t in teeth if geometry.box_center(t["box"])[1] > split_y]
    if not upper or not lower:
        return (teeth, []) if upper else ([], teeth)
    return upper, lower


def _surface_name(tooth, side):
    fdi = tooth.get("fdi")
    try:
        n = int(fdi)
    except (TypeError, ValueError):
        return side
    quad = n // 10
    if quad in (1, 4):
        return "distal" if side == "left" else "mesial"
    if quad in (2, 3):
        return "mesial" if side == "left" else "distal"
    return side


def _neighbor_ok(tooth, neighbor, side):
    """
    Neighbour gate: a close contact is preferred, but a missing neighbour
    must not skip the tooth. Far neighbours are ignored so the column stays
    on this tooth's own proximal wall (not the empty gap / sinus).
    """
    if neighbor is None:
        return True, None
    tw = max(tooth["box"]["w"], neighbor["box"]["w"])
    spacing = abs(
        geometry.box_center(neighbor["box"])[0] - geometry.box_center(tooth["box"])[0]
    )
    if spacing > 2.4 * tw:
        return True, None
    return True, neighbor


def _proximal_column(tooth, neighbor, side):
    box = tooth["box"]
    if side == "left":
        if neighbor is not None:
            nbox = neighbor["box"]
            gap_x1 = nbox["x"] + nbox["w"] * 0.72
            gap_x2 = box["x"] + box["w"] * 0.28
        else:
            gap_x2 = box["x"] + box["w"] * 0.14
            gap_x1 = box["x"] - box["w"] * 0.16
    else:
        if neighbor is not None:
            nbox = neighbor["box"]
            gap_x1 = box["x"] + box["w"] * 0.72
            gap_x2 = nbox["x"] + nbox["w"] * 0.28
        else:
            gap_x1 = box["x"] + box["w"] * 0.86
            gap_x2 = box["x"] + box["w"] * 1.16
    if gap_x2 <= gap_x1:
        mid = box["x"] if side == "left" else box["x"] + box["w"]
        half = max(2.0, box["w"] * 0.12)
        gap_x1, gap_x2 = mid - half, mid + half
    return gap_x1, gap_x2


def _measure_surface(tooth, neighbor, side, arch, gray, px_per_mm):
    tooth_class = tooth.get("tooth_class") or "premolar"
    gates = dict(CLASS_GATES.get(tooth_class, CLASS_GATES["premolar"]))
    neighbor_ok, use_neighbor = _neighbor_ok(tooth, neighbor, side)
    gap_x1, gap_x2 = _proximal_column(tooth, use_neighbor, side)

    cej_y = _cej_y_for(tooth, arch, gates["cej_ratio"])
    apex = geometry.apex_y(tooth, arch)
    root_len = abs(apex - cej_y)
    root_ok = root_len >= gates["min_root_px"]
    if not root_ok:
        return None

    crest_y, edge = _find_crest_y(
        gray,
        gap_x1,
        gap_x2,
        cej_y,
        apex,
        arch,
        end_frac=gates["crest_end_frac"],
        min_edge_abs=gates["crest_edge_abs"],
        min_edge_rel=gates["crest_edge_rel"],
    )
    crest_ok = crest_y is not None
    if not crest_ok:
        return None

    sign = geometry.crown_edge_sign(arch)
    displacement = (crest_y - cej_y) * sign
    if displacement <= 0:
        return None

    mm = displacement / px_per_mm
    range_ok = 0.4 <= mm <= gates["max_plausible_mm"]
    if not range_ok:
        return None

    severity = float(np.clip(displacement / root_len, 0.0, 1.0))
    finding_type = _severity_type_mm(mm, gates)
    physiologic = finding_type is None
    accepted = (
        neighbor_ok
        and root_ok
        and crest_ok
        and range_ok
        and not physiologic
    )

    cx = (gap_x1 + gap_x2) / 2.0
    surface = _surface_name(tooth, side)
    fdi = tooth.get("fdi")

    return {
        "cej": (cx, cej_y),
        "crest": (cx, crest_y),
        "measurement_mm": round(float(mm), 1),
        "severity": severity,
        "type": finding_type or "bone_ok",
        "confidence": _site_confidence(tooth, finding_type or "bone_ok", edge),
        "box": {
            "x": min(gap_x1, gap_x2),
            "y": min(cej_y, crest_y),
            "w": max(2.0, abs(gap_x2 - gap_x1)),
            "h": max(2.0, abs(crest_y - cej_y)),
        },
        "teeth": [fdi],
        "tooth": fdi,
        "tooth_class": tooth_class,
        "surface": surface,
        "accepted": accepted,
        "gates": {
            "neighbor": neighbor_ok,
            "root": root_ok,
            "crest_edge": crest_ok,
            "range": range_ok,
            "class_norm": finding_type or "physiologic",
        },
    }


def _cej_y_for(tooth, arch, cej_ratio):
    box = tooth["box"]
    edge = geometry.crown_edge_y(tooth, arch)
    return edge + geometry.crown_edge_sign(arch) * box["h"] * cej_ratio


def _find_crest_y(
    gray,
    x1,
    x2,
    cej_y,
    apex_y_val,
    arch,
    end_frac=CREST_SEARCH_END_FRAC,
    min_edge_abs=CREST_MIN_EDGE_ABS,
    min_edge_rel=CREST_MIN_EDGE_REL,
):
    """
    Locate the alveolar crest along the interproximal column.

    Returns (y, edge_strength) or (None, 0). Bone is radiopaque; the crest is
    the step from darker periodontal space into that bone, scanned crown→apex.
    """
    h, w = gray.shape[:2]
    xa = int(max(0, min(w - 1, round(min(x1, x2)))))
    xb = int(max(0, min(w, round(max(x1, x2)) + 1)))
    if xb <= xa:
        return None, 0.0

    y_start = int(max(0, min(h - 1, round(cej_y))))
    y_end = int(max(0, min(h - 1, round(apex_y_val))))
    if abs(y_end - y_start) < 12:
        return None, 0.0
    step = 1 if y_end >= y_start else -1

    column = gray[:, xa:xb]
    if column.size == 0:
        return None, 0.0
    profile_idx = np.arange(y_start, y_end, step)
    profile = column[profile_idx].mean(axis=1).astype(np.float32)
    if profile.size < 12:
        return None, 0.0

    k = max(3, int(profile.size * 0.08))
    lo = max(k, int(np.floor(profile.size * CREST_SEARCH_START_FRAC)))
    hi = min(profile.size - k, int(np.ceil(profile.size * end_frac)))
    if hi <= lo:
        return None, 0.0

    cumulative = np.concatenate([[0.0], np.cumsum(profile, dtype=np.float64)])

    def window_mean(start, end):
        return (cumulative[end] - cumulative[start]) / float(end - start)

    positions = np.arange(lo, hi)
    steps = np.array(
        [window_mean(j, j + k) - window_mean(j - k, j) for j in positions],
        dtype=np.float32,
    )
    if steps.size == 0:
        return None, 0.0

    best = int(np.argmax(steps))
    spread = float(np.std(profile))
    threshold = max(min_edge_abs, min_edge_rel * spread)
    strength = float(steps[best])
    if strength < threshold:
        return None, strength

    return float(profile_idx[positions[best]]), strength


def _severity_type_mm(mm, gates):
    if mm <= gates["physiologic_mm"]:
        return None
    if mm < gates["mild_max_mm"]:
        return "bone_loss_mild"
    if mm < gates["moderate_max_mm"]:
        return "bone_loss_moderate"
    return "bone_loss_severe"


def _severity_type(severity):
    if severity < SEVERITY_MILD_MAX:
        return "bone_loss_mild"
    if severity < SEVERITY_MODERATE_MAX:
        return "bone_loss_moderate"
    return "bone_loss_severe"


def _site_confidence(tooth, finding_type, edge):
    """
    Spread confidence so the default 38% slider shows every measured tooth,
    and raising it filters physiologic → mild → moderate → severe.
    """
    score = float(tooth.get("score", 0.5) or 0.5)
    edge_term = 0.04 if edge >= 8 else 0.0
    bands = {
        "bone_ok": 0.42,
        "bone_loss_mild": 0.54,
        "bone_loss_moderate": 0.66,
        "bone_loss_severe": 0.78,
    }
    base = bands.get(finding_type, 0.42)
    return round(float(min(0.88, base + 0.06 * score + edge_term)), 3)
