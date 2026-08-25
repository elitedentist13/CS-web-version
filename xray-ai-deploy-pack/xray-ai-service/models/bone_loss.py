"""
Stage 3 - interproximal periodontal bone loss estimation.

WHAT THIS IS: a geometric heuristic anchored to the Stage 1 tooth detections.
For each adjacent tooth pair it estimates the CEJ level from tooth geometry,
locates the alveolar crest by searching the intensity profile in the
interproximal column, and expresses bone loss as the CEJ-to-crest distance as a
fraction of root length.

WHAT THIS IS NOT: a trained bone-loss model. Pearl's CEJ-to-bone-crest
measurement is a separately FDA-cleared device (Second Opinion BLE). No
equivalent pretrained checkpoint is publicly downloadable today - only training
code (e.g. YOLOv8-pose keypoint pipelines) and datasets such as BoneLoss-PAN769.
Being anchored to a real tooth detector makes this meaningfully better than
searching raw pixels blindly, but it remains an estimate.

SWAPPABLE BY DESIGN: `estimate_bone_loss()` is the only entry point the pipeline
calls, and it returns a plain list of measurement dicts. Training a keypoint
model later means reimplementing this one function; nothing upstream or in the
browser needs to change.
"""

import logging

import numpy as np

from . import geometry

log = logging.getLogger("xray-ai.boneloss")

# Bone-loss only: geometric CEJ as a fraction of tooth height from the
# occlusal edge toward the apex. Do not reuse for caries — caries keys off
# the EDJ in models/caries_refine.py (edj_y / ENAMEL_BAND_RATIO).
CEJ_RATIO = 0.34

# Severity bands mirror the thresholds the browser already uses
# (app-xray-ai.js: sev < 0.24 mild, < 0.34 moderate, else severe) so the
# service and the client never disagree about a finding's colour.
SEVERITY_MILD_MAX = 0.24
SEVERITY_MODERATE_MAX = 0.34

# A CEJ-to-crest distance up to about 2 mm is normal, so anything at or below
# this is not reported. Expressed in millimetres rather than as a fraction of
# root length because that is how the clinical cutoff is defined.
NORMAL_CEJ_TO_CREST_MM = 2.0

# Ignore the first slice of the scan: the crown/root junction sits right at the
# CEJ and produces a strong intensity step that is not the bone crest.
CREST_SEARCH_START_FRAC = 0.06

# The crest is not plausibly past this fraction of the way to the apex. Loss
# beyond ~60% of root length means the tooth is close to lost, and past that
# point the strongest edge in the column is usually anatomy rather than crest -
# on real panoramics an unbounded search locks onto the maxillary sinus floor in
# the posterior maxilla and reports 9-11 mm of "severe" loss at healthy sites.
CREST_SEARCH_END_FRAC = 0.60

# Minimum edge strength before a transition counts as the alveolar crest,
# measured as the intensity step across the candidate position. Both an absolute
# floor (8-bit grey levels) and a relative one are applied: measured over real
# panoramics, genuine crest edges step by 5-40 levels, while the profile's own
# standard deviation ranges from 4 to 32, so neither test alone is stable.
CREST_MIN_EDGE_ABS = 4.0
CREST_MIN_EDGE_REL = 0.25


def estimate_bone_loss(teeth, gray, mean_tooth_width_mm=8.0):
    """
    Estimate bone loss for each adjacent tooth pair.

    Only sites whose CEJ-to-crest distance exceeds NORMAL_CEJ_TO_CREST_MM are
    returned, so a healthy dentition yields an empty list rather than a screen
    full of "mild" findings.

    Args:
        teeth: Stage 1 detections, each {'box': px dict, 'score', 'fdi'}.
        gray:  full-resolution single-channel image as a float32 numpy array.
        mean_tooth_width_mm: calibration constant for pixel-to-millimetre
            conversion. Panoramic radiographs carry no pixel spacing, so scale
            is inferred from median detected tooth width.

    Returns:
        List of dicts: {
            'cej': (x, y) px, 'crest': (x, y) px, 'measurement_mm': float,
            'severity': float fraction, 'type': client finding type,
            'confidence': float, 'box': px dict, 'teeth': [fdi, fdi],
        }
    """
    if gray is None or len(teeth) < 2:
        return []

    px_per_mm = _estimate_px_per_mm(teeth, mean_tooth_width_mm)
    if px_per_mm <= 0:
        return []

    upper, lower = _split_arches(teeth)
    results = []
    for arch_name, arch_teeth in (("upper", upper), ("lower", lower)):
        if len(arch_teeth) < 2:
            continue
        ordered = sorted(arch_teeth, key=lambda t: t["box"]["x"])
        for left, right in zip(ordered, ordered[1:]):
            site = _measure_site(left, right, arch_name, gray, px_per_mm)
            if site is not None:
                results.append(site)
    return results


def _estimate_px_per_mm(teeth, mean_tooth_width_mm):
    widths = [t["box"]["w"] for t in teeth if t["box"]["w"] > 0]
    if not widths or mean_tooth_width_mm <= 0:
        return 0.0
    return float(np.median(widths)) / mean_tooth_width_mm


def _split_arches(teeth):
    """
    Separate maxillary from mandibular teeth.

    Prefers the `arch` annotation the pipeline attaches (so Stage 3 and Stage 4
    always agree on crown orientation), and falls back to a median split on
    vertical position when the annotation is absent.
    """
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
    # A single crowded arch can skew the median; require both groups to look
    # plausible before trusting the split.
    if not upper or not lower:
        return (teeth, []) if upper else ([], teeth)
    return upper, lower


def _measure_site(left, right, arch, gray, px_per_mm):
    lbox = left["box"]
    rbox = right["box"]

    # Interproximal column: the strip between the two crowns.
    gap_x1 = lbox["x"] + lbox["w"] * 0.72
    gap_x2 = rbox["x"] + rbox["w"] * 0.28
    if gap_x2 <= gap_x1:
        # Overlapping detections - fall back to the midpoint between centres.
        mid = (geometry.box_center(lbox)[0] + geometry.box_center(rbox)[0]) / 2.0
        half = max(2.0, min(lbox["w"], rbox["w"]) * 0.18)
        gap_x1, gap_x2 = mid - half, mid + half

    # Adjacent teeth should be neighbours, not opposite ends of the arch.
    spacing = abs(geometry.box_center(rbox)[0] - geometry.box_center(lbox)[0])
    if spacing > 2.6 * max(lbox["w"], rbox["w"]):
        return None

    cej_y = (
        _cej_y_for(left, arch) + _cej_y_for(right, arch)
    ) / 2.0
    apex = (geometry.apex_y(left, arch) + geometry.apex_y(right, arch)) / 2.0
    root_len = abs(apex - cej_y)
    if root_len < 4:
        return None

    crest_y = _find_crest_y(gray, gap_x1, gap_x2, cej_y, apex, arch)
    if crest_y is None:
        return None

    sign = geometry.crown_edge_sign(arch)
    # Positive displacement means the crest has receded toward the apex.
    displacement = (crest_y - cej_y) * sign
    if displacement <= 0:
        # Crest at or coronal to the CEJ: not bone loss.
        return None

    mm = displacement / px_per_mm
    if mm <= NORMAL_CEJ_TO_CREST_MM:
        return None

    severity = float(np.clip(displacement / root_len, 0.0, 1.0))
    cx = (gap_x1 + gap_x2) / 2.0

    return {
        "cej": (cx, cej_y),
        "crest": (cx, crest_y),
        "measurement_mm": round(float(mm), 1),
        "severity": severity,
        "type": _severity_type(severity),
        # Confidence reflects how cleanly the crest edge was found, scaled down
        # to signal that this is a heuristic rather than a model prediction.
        "confidence": _site_confidence(left, right, severity),
        "box": {
            "x": gap_x1,
            "y": min(cej_y, crest_y),
            "w": max(2.0, gap_x2 - gap_x1),
            "h": max(2.0, abs(crest_y - cej_y)),
        },
        "teeth": [left.get("fdi"), right.get("fdi")],
    }


def _cej_y_for(tooth, arch):
    box = tooth["box"]
    edge = geometry.crown_edge_y(tooth, arch)
    return edge + geometry.crown_edge_sign(arch) * box["h"] * CEJ_RATIO


def _find_crest_y(gray, x1, x2, cej_y, apex_y_val, arch):
    """
    Locate the alveolar crest along the interproximal column.

    Bone appears radiopaque (bright) and the crest is the transition from the
    darker periodontal space into that bright bone, scanning from the crown side
    toward the apex. Returns None when no convincing edge exists, so an
    unmeasurable site is skipped rather than assigned an invented crest.
    """
    h, w = gray.shape[:2]
    xa = int(max(0, min(w - 1, round(min(x1, x2)))))
    xb = int(max(0, min(w, round(max(x1, x2)) + 1)))
    if xb <= xa:
        return None

    y_start = int(max(0, min(h - 1, round(cej_y))))
    y_end = int(max(0, min(h - 1, round(apex_y_val))))
    if abs(y_end - y_start) < 12:
        return None
    step = 1 if y_end >= y_start else -1

    column = gray[:, xa:xb]
    if column.size == 0:
        return None
    profile_idx = np.arange(y_start, y_end, step)
    profile = column[profile_idx].mean(axis=1).astype(np.float32)
    if profile.size < 12:
        return None

    # Detect the crest as a step in intensity rather than a single-pixel
    # gradient: the crest edge is several pixels wide, so a per-pixel difference
    # is dominated by trabecular speckle. Comparing the mean of a window after
    # the candidate against the mean before it is both scale-appropriate and
    # robust. (A smoothed np.diff with mode='same' is actively wrong here: its
    # zero-padded boundary fabricates a huge first-sample gradient that always
    # wins the argmax, which pins the crest to the CEJ and reports zero loss
    # everywhere.)
    k = max(3, int(profile.size * 0.08))
    lo = max(k, int(np.floor(profile.size * CREST_SEARCH_START_FRAC)))
    hi = min(profile.size - k, int(np.ceil(profile.size * CREST_SEARCH_END_FRAC)))
    if hi <= lo:
        return None

    cumulative = np.concatenate([[0.0], np.cumsum(profile, dtype=np.float64)])

    def window_mean(start, end):
        return (cumulative[end] - cumulative[start]) / float(end - start)

    positions = np.arange(lo, hi)
    steps = np.array([window_mean(j, j + k) - window_mean(j - k, j)
                      for j in positions], dtype=np.float32)
    if steps.size == 0:
        return None

    best = int(np.argmax(steps))
    spread = float(np.std(profile))
    threshold = max(CREST_MIN_EDGE_ABS, CREST_MIN_EDGE_REL * spread)
    if float(steps[best]) < threshold:
        return None

    return float(profile_idx[positions[best]])


def _severity_type(severity):
    if severity < SEVERITY_MILD_MAX:
        return "bone_loss_mild"
    if severity < SEVERITY_MODERATE_MAX:
        return "bone_loss_moderate"
    return "bone_loss_severe"


def _site_confidence(left, right, severity):
    # Anchored on how confident the tooth detector was about both neighbours,
    # then capped: a geometric estimate should never present as a high-certainty
    # model detection.
    base = min(left.get("score", 0.5), right.get("score", 0.5))
    scaled = 0.35 + 0.35 * base + 0.15 * min(severity / SEVERITY_MODERATE_MAX, 1.0)
    return round(float(min(scaled, 0.80)), 3)
