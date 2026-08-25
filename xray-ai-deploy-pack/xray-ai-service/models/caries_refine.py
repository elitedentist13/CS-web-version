"""
Stage 4 - caries lesion polygon refinement and enamel/dentin overlap.

Pearl's recent FDA clearances replaced bounding boxes with polygon contours plus
enamel/dentin overlap percentages, which is what the browser overlay already
knows how to draw (polygon fill + an "E%/D%" tag).

WHAT THIS IS: classical computer vision applied *inside* an already-detected
lesion box. The radiolucent (darker) region is segmented with CLAHE contrast
normalization plus Otsu thresholding, reduced to its dominant contour, and
simplified into a polygon. Enamel and dentin proportions come from splitting the
enclosing tooth's crown geometry.

Interproximal refine is centred on the EDJ (enamel→dentin). A secondary
cervical path still uses a crown/root band helper; bone-loss CEJ geometry
lives only in models/bone_loss.py and must not gate caries.

WHAT THIS IS NOT: a trained instance-segmentation network. A true neural option
exists (ToothXpert integrates SAM) but needs roughly 15 GB of weights and a GPU,
which is impractical on a clinic desktop. Refining a validated ROI is a real
precision gain over drawing the raw box, without pretending to be segmentation.
"""

import logging

import numpy as np

from . import geometry

log = logging.getLogger("xray-ai.caries")

# ── Caries anatomy (EDJ) vs bone-loss anatomy (CEJ) ─────────────────
# Caries detection keys off the enamel–dentin junction (EDJ): classic
# interproximal lesions cross from enamel into dentin at the contact.
# Bone-loss assessment keys off the cementoenamel junction (CEJ) in
# models/bone_loss.py (CEJ_RATIO). Do not mix the two landmarks.

# Enamel shell as a fraction of crown height from the occlusal edge → EDJ.
ENAMEL_BAND_RATIO = 0.42

# Crown height as a fraction of the tooth box — used only to place the
# geometric EDJ and enamel/dentin zones for caries. Independent of
# bone_loss.CEJ_RATIO.
CROWN_RATIO = 0.48

# Deep/progressed EDJ caries can extend further root-ward (toward the pulp)
# than the nominal CROWN_RATIO band predicts, especially on tall tooth boxes
# (e.g. molars with long roots skew the crown estimate short). Pad the
# dentin zone's root-ward edge by this fraction of crown height so such
# lesions still register dentin overlap instead of falling in an untyped gap.
DENTIN_ROOT_PAD_RATIO = 0.28

# A lesion reaching this much dentin involvement is reported as progressed
# rather than incipient.
DENTIN_PROGRESSED_PCT = 20

# Cervical (non-EDJ) search helpers — secondary path only.
CEJ_BAND_FRAC = 0.55
CEJ_SIDE_FRAC = 0.42

# If a cervical mask spans more than this fraction of tooth width, treat it as
# burnout-like and keep only the darkest peak near the seed lesion.
BURNOUT_TRIM_WIDTH_FRAC = 0.48


def refine_caries(gray, lesion_box, tooth, surface=None, seed_polygon=None):
    """
    Refine one caries detection.

    Args:
        gray: full-resolution single-channel float32 image.
        lesion_box: px dict for the detected lesion.
        tooth: enclosing Stage 1 tooth detection, or None.
        surface: optional surface label from the reasoning layer
            ('cervical' / 'root' triggers the CEJ-local path).
        seed_polygon: optional proposer polygon; used only as a centre prior
            when trimming burnout-like masks.

    Returns:
        {'polygon': [[x, y], ...] px or None,
         'enamel_pct': int|None, 'dentin_pct': int|None,
         'refine_mode': str}
    """
    search_box = lesion_box
    mode = "box_otsu"
    if tooth is not None and surface == "interproximal":
        band = _edj_search_box(tooth, lesion_box)
        if band is not None:
            search_box = band
            mode = "edj_band"
    elif tooth is not None and surface in ("cervical", "root"):
        band = _cej_search_box(tooth, lesion_box)
        if band is not None:
            search_box = band
            mode = "cej_band"

    # Prefer the original seed centre when ranking contours (not the expanded
    # EDJ search window centre — that drifts polygons toward the geometric EDJ).
    seed_for_rank = seed_polygon or _box_as_quad(lesion_box)
    polygon = _segment_lesion(
        gray, search_box, tooth=tooth, surface=surface, seed_polygon=seed_for_rank
    )
    # If the constrained search found nothing, fall back to the plain box
    # so we never delete a lesion that the proposer already accepted.
    if polygon is None and mode in ("cej_band", "edj_band"):
        polygon = _segment_lesion(
            gray, lesion_box, tooth=tooth, surface=None, seed_polygon=seed_for_rank
        )
        mode = "box_otsu_fallback"

    # Drop polygons that jumped far from the seed or ballooned far beyond it.
    if polygon is not None and lesion_box is not None:
        pb = _bounds_of(polygon)
        pcx, pcy = _seed_centre(pb, None)
        scx = lesion_box["x"] + lesion_box["w"] * 0.5
        scy = lesion_box["y"] + lesion_box["h"] * 0.5
        max_jump = max(14.0, max(lesion_box["w"], lesion_box["h"]) * 2.2)
        max_h = max(22.0, lesion_box["h"] * 3.5)
        max_w = max(18.0, lesion_box["w"] * 3.5)
        drifted = (
            abs(pcx - scx) > max_jump
            or abs(pcy - scy) > max_jump
            or pb["h"] > max_h
            or pb["w"] > max_w
        )
        if drifted:
            polygon = _segment_lesion(
                gray, lesion_box, tooth=tooth, surface=None, seed_polygon=seed_for_rank
            )
            mode = "seed_reanchor"
            if polygon is not None:
                pb = _bounds_of(polygon)
                pcx, pcy = _seed_centre(pb, None)
                if (
                    abs(pcx - scx) > max_jump
                    or abs(pcy - scy) > max_jump
                    or pb["h"] > max_h
                    or pb["w"] > max_w
                ):
                    # Grow the seed box slightly across the EDJ for the outline.
                    outline = (
                        expand_box_across_edj(lesion_box, tooth)
                        if tooth is not None
                        else lesion_box
                    )
                    polygon = _box_as_quad(outline)
                    mode = "seed_box_poly"

    if polygon is not None and tooth is not None:
        polygon = _clip_polygon_to_box(polygon, tooth["box"])

    result = {
        "polygon": polygon,
        "enamel_pct": None,
        "dentin_pct": None,
        "refine_mode": mode,
    }
    if tooth is None or polygon is None:
        return result

    zones = _crown_zones(tooth)
    if zones is None:
        return result

    enamel_zone, dentin_zone = zones
    # Measure overlap against the refined polygon's bounds when available, since
    # that tracks the lesion more tightly than the detector's box.
    target = _bounds_of(polygon)
    enamel_frac = geometry.containment(target, enamel_zone)
    dentin_frac = geometry.containment(target, dentin_zone)
    total = enamel_frac + dentin_frac

    if total <= 0:
        return result

    enamel_pct = int(round(100.0 * enamel_frac / total))
    dentin_pct = int(round(100.0 * dentin_frac / total))
    if enamel_pct + dentin_pct != 100:
        dentin_pct = max(0, 100 - enamel_pct)

    result["enamel_pct"] = enamel_pct
    result["dentin_pct"] = dentin_pct
    return result


def is_progressed(refinement):
    """True when the lesion involves enough dentin to warrant the darker style."""
    dentin = refinement.get("dentin_pct")
    if dentin is None:
        return False
    return dentin >= DENTIN_PROGRESSED_PCT


def expand_box_across_edj(box, tooth):
    """
    Grow a contact core box so it straddles the geometric EDJ.

    Classic proximal caries is an enamel→dentin wedge; a tiny dark dentin core
    must still be measured against both tissues for E%/D%. Bounded by the
    EDJ ± enamel/dentin band — not by the bone-loss CEJ landmark.
    """
    arch = tooth.get("arch")
    tb = tooth.get("box")
    if not box or not tb or arch not in ("upper", "lower"):
        return box
    edge = geometry.crown_edge_y(tooth, arch)
    sign = geometry.crown_edge_sign(arch)
    crown_h = tb["h"] * CROWN_RATIO
    junction = edj_y(tooth)
    if junction is None:
        return box
    half = max(6.0, crown_h * 0.22)
    y1 = min(box["y"], junction - half)
    y2 = max(box["y"] + box["h"], junction + half)
    # Keep within enamel + outer dentin around the EDJ (not root/bone).
    dentin_end = junction + sign * crown_h * (1.0 - ENAMEL_BAND_RATIO) * 1.15
    enamel_start = edge
    y1 = max(y1, min(enamel_start, dentin_end))
    y2 = min(y2, max(enamel_start, dentin_end))
    y1 = max(tb["y"], y1)
    y2 = min(tb["y"] + tb["h"], y2)
    if y2 - y1 < box["h"]:
        return dict(box)
    out = dict(box)
    out["y"] = float(y1)
    out["h"] = float(y2 - y1)
    return out


def enamel_dentin_fractions(tooth, box):
    """
    Estimate enamel/dentin overlap percentages for a lesion box.

    Used when polygon refine is unavailable, and to gate interproximal
    findings that must sit in dentin under the contact.
    """
    zones = _crown_zones(tooth)
    if zones is None or not box:
        return None, None
    enamel_zone, dentin_zone = zones
    enamel_frac = geometry.containment(box, enamel_zone)
    dentin_frac = geometry.containment(box, dentin_zone)
    total = enamel_frac + dentin_frac
    if total <= 0:
        return None, None
    enamel_pct = int(round(100.0 * enamel_frac / total))
    dentin_pct = max(0, 100 - enamel_pct)
    return enamel_pct, dentin_pct


def bounds_of_polygon(polygon):
    """Public wrapper: axis-aligned box of a polygon (px)."""
    return _bounds_of(polygon)


def edj_y(tooth):
    """
    Image y of the geometric enamel–dentin junction (caries landmark).

    Measured from the occlusal edge through the enamel band. This is the
    primary vertical anchor for interproximal caries — not the CEJ.
    """
    arch = tooth.get("arch")
    box = tooth.get("box")
    if not box or arch not in ("upper", "lower"):
        return None
    edge = geometry.crown_edge_y(tooth, arch)
    sign = geometry.crown_edge_sign(arch)
    crown_h = box["h"] * CROWN_RATIO
    return edge + sign * crown_h * ENAMEL_BAND_RATIO


def cej_y(tooth):
    """
    Approximate crown/root boundary inside the tooth box.

    Kept for the secondary cervical path only. Bone-loss CEJ lives in
    models/bone_loss.py (CEJ_RATIO) and must not drive caries EDJ gating.
    """
    arch = tooth.get("arch")
    box = tooth.get("box")
    if not box or arch not in ("upper", "lower"):
        return None
    edge = geometry.crown_edge_y(tooth, arch)
    sign = geometry.crown_edge_sign(arch)
    return edge + sign * box["h"] * CROWN_RATIO


def _edj_search_box(tooth, lesion_box):
    """
    Restrict refine ROI to the seed contact column around the EDJ.

    Anchored on the proposer seed (not the whole geometric EDJ strip) so Otsu
    cannot jump to a different occlusal/cervical lucency in the same tooth.
    Vertically expanded just enough to include the EDJ for enamel→dentin
    crossing polygons.
    """
    box = tooth.get("box")
    arch = tooth.get("arch")
    if not box or arch not in ("upper", "lower") or box["h"] <= 0 or box["w"] <= 0:
        return None
    if not lesion_box:
        return None

    crown_h = box["h"] * CROWN_RATIO
    junction = edj_y(tooth)
    lcx = lesion_box["x"] + lesion_box["w"] * 0.5
    lcy = lesion_box["y"] + lesion_box["h"] * 0.5

    # Proximal column around the seed (narrow — keeps facing contacts apart).
    inset = box["w"] * 0.08
    side_w = max(10.0, min(box["w"] * 0.32, lesion_box["w"] * 4.0 + 10.0))
    side_x1 = lcx - side_w * 0.5
    side_x2 = lcx + side_w * 0.5
    side_x1 = max(box["x"] + inset, side_x1)
    side_x2 = min(box["x"] + box["w"] - inset, side_x2)

    # Vertical: seed-centred window that still reaches the EDJ line.
    half = max(10.0, crown_h * 0.32, lesion_box["h"] * 1.8)
    band_y1 = lcy - half
    band_y2 = lcy + half
    if junction is not None:
        # Pull window to cover EDJ without abandoning the seed.
        band_y1 = min(band_y1, junction - max(6.0, crown_h * 0.12))
        band_y2 = max(band_y2, junction + max(6.0, crown_h * 0.12))
        # Cap drift: stay within ~0.45 crown-h of the seed centre.
        max_drift = max(14.0, crown_h * 0.45)
        band_y1 = max(band_y1, lcy - max_drift)
        band_y2 = min(band_y2, lcy + max_drift)

    x1 = max(box["x"] + inset, side_x1)
    x2 = min(box["x"] + box["w"] - inset, side_x2)
    y1 = max(box["y"], band_y1)
    y2 = min(box["y"] + box["h"], band_y2)

    if x2 - x1 < 6 or y2 - y1 < 6:
        return None
    return {"x": float(x1), "y": float(y1), "w": float(x2 - x1), "h": float(y2 - y1)}


def _cej_search_box(tooth, lesion_box):
    """
    Restrict the refine ROI to the mesial or distal CEJ band of the tooth.

    Intersects the geometric CEJ strip with the lesion box (slightly padded) and
    the tooth box so burnout in the mid-cervix and bone outside the tooth cannot
    dominate Otsu.
    """
    box = tooth.get("box")
    arch = tooth.get("arch")
    if not box or arch not in ("upper", "lower") or box["h"] <= 0 or box["w"] <= 0:
        return None

    cy_cej = cej_y(tooth)
    if cy_cej is None:
        return None

    crown_h = box["h"] * CROWN_RATIO
    half = max(6.0, crown_h * CEJ_BAND_FRAC)
    band_y1 = cy_cej - half
    band_y2 = cy_cej + half

    # Mesial vs distal column from where the lesion sits in the tooth.
    lcx = lesion_box["x"] + lesion_box["w"] * 0.5
    tcx = box["x"] + box["w"] * 0.5
    side_w = max(8.0, box["w"] * CEJ_SIDE_FRAC)
    if lcx <= tcx:
        side_x1 = box["x"]
        side_x2 = box["x"] + side_w
    else:
        side_x1 = box["x"] + box["w"] - side_w
        side_x2 = box["x"] + box["w"]

    # Keep a little of the original lesion box so a slightly mis-centred
    # detection is not cut off entirely.
    pad_x = lesion_box["w"] * 0.15
    pad_y = lesion_box["h"] * 0.20
    lx1 = lesion_box["x"] - pad_x
    ly1 = lesion_box["y"] - pad_y
    lx2 = lesion_box["x"] + lesion_box["w"] + pad_x
    ly2 = lesion_box["y"] + lesion_box["h"] + pad_y

    x1 = max(box["x"], side_x1, lx1)
    y1 = max(box["y"], band_y1, ly1)
    x2 = min(box["x"] + box["w"], side_x2, lx2)
    y2 = min(box["y"] + box["h"], band_y2, ly2)

    if x2 - x1 < 6 or y2 - y1 < 6:
        return None
    return {"x": float(x1), "y": float(y1), "w": float(x2 - x1), "h": float(y2 - y1)}


def _segment_lesion(gray, box, tooth=None, surface=None, seed_polygon=None):
    """Extract the dominant radiolucent contour inside the search box."""
    try:
        import cv2
    except Exception as exc:  # pragma: no cover - import guard
        log.debug("opencv unavailable, skipping refinement: %s", exc)
        return None

    h, w = gray.shape[:2]
    pad_x = box["w"] * 0.08
    pad_y = box["h"] * 0.08
    x1 = int(max(0, np.floor(box["x"] - pad_x)))
    y1 = int(max(0, np.floor(box["y"] - pad_y)))
    x2 = int(min(w, np.ceil(box["x"] + box["w"] + pad_x)))
    y2 = int(min(h, np.ceil(box["y"] + box["h"] + pad_y)))
    if x2 - x1 < 6 or y2 - y1 < 6:
        return None

    roi = gray[y1:y2, x1:x2]
    if roi.size == 0:
        return None

    try:
        roi_u8 = np.clip(roi, 0, 255).astype(np.uint8)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
        equalized = clahe.apply(roi_u8)
        blurred = cv2.GaussianBlur(equalized, (5, 5), 0)
        # Caries is radiolucent, so invert before Otsu to segment dark regions.
        _, mask = cv2.threshold(
            255 - blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        mask = cv2.morphologyEx(
            mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1
        )

        if surface in ("cervical", "root") and tooth is not None:
            mask = _trim_cervical_burnout(
                mask, blurred, tooth, x1, y1, seed_polygon, box
            )

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        # Prefer the contour closest to the seed centre when several remain
        # after burnout trim; otherwise the largest.
        seed_cx, seed_cy = _seed_centre(box, seed_polygon)
        best = None
        best_key = None
        roi_area = float(roi.shape[0] * roi.shape[1])
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < 0.03 * roi_area or area > 0.90 * roi_area:
                continue
            m = cv2.moments(c)
            if m["m00"] <= 1e-3:
                continue
            cx = m["m10"] / m["m00"] + x1
            cy = m["m01"] / m["m00"] + y1
            dist = (cx - seed_cx) ** 2 + (cy - seed_cy) ** 2
            # Rank: nearer to seed, then larger.
            key = (dist, -area)
            if best_key is None or key < best_key:
                best_key = key
                best = c
        if best is None:
            return None

        # Finer approx near CEJ so the V-shaped proximal notch is not squared off.
        eps_frac = 0.008 if surface in ("cervical", "root") else 0.012
        epsilon = eps_frac * cv2.arcLength(best, True)
        approx = cv2.approxPolyDP(best, epsilon, True)
        if approx is None or len(approx) < 3:
            return None

        points = [
            [float(p[0][0]) + x1, float(p[0][1]) + y1] for p in approx
        ]
        if len(points) > 48:
            stride = int(np.ceil(len(points) / 48.0))
            points = points[::stride]
        return points if len(points) >= 3 else None
    except Exception as exc:
        log.debug("lesion segmentation failed: %s", exc)
        return None


def _trim_cervical_burnout(mask, blurred, tooth, ox, oy, seed_polygon, search_box):
    """
    If the dark mask spans most of the tooth width, keep only the darkest
    peak near the seed — cervical burnout is wide and soft; proximal caries
    near the CEJ is a local notch.
    """
    try:
        import cv2
    except Exception:
        return mask

    tbox = tooth.get("box")
    if not tbox or tbox["w"] <= 0:
        return mask

    ys, xs = np.where(mask > 0)
    if xs.size < 8:
        return mask
    span = float(xs.max() - xs.min() + 1)
    if span < tbox["w"] * BURNOUT_TRIM_WIDTH_FRAC:
        return mask

    # Seed in ROI coordinates.
    seed_cx, seed_cy = _seed_centre(search_box, seed_polygon)
    sx = int(np.clip(seed_cx - ox, 0, mask.shape[1] - 1))
    sy = int(np.clip(seed_cy - oy, 0, mask.shape[0] - 1))

    # Local darkness: higher value => darker on the inverted scale.
    dark = (255 - blurred).astype(np.float32)
    # Suppress pixels far from the seed in x (keep a proximal column).
    col_half = max(3, int(0.22 * tbox["w"]))
    x0 = max(0, sx - col_half)
    x1 = min(mask.shape[1], sx + col_half + 1)
    local = np.zeros_like(mask)
    local[:, x0:x1] = mask[:, x0:x1]

    if not np.any(local):
        # Fall back: keep the connected component that contains the seed, or
        # the one whose centroid is nearest.
        n, labels = cv2.connectedComponents(mask)
        if n <= 1:
            return mask
        target = labels[sy, sx] if mask[sy, sx] else 0
        if target <= 0:
            best_i, best_d = 1, None
            for i in range(1, n):
                ys_i, xs_i = np.where(labels == i)
                if xs_i.size == 0:
                    continue
                d = (xs_i.mean() - sx) ** 2 + (ys_i.mean() - sy) ** 2
                if best_d is None or d < best_d:
                    best_d, best_i = d, i
            target = best_i
        return np.where(labels == target, 255, 0).astype(np.uint8)

    # Within the proximal column, keep the darkest connected component.
    n, labels = cv2.connectedComponents(local)
    if n <= 1:
        return local
    best_i, best_score = 1, -1.0
    for i in range(1, n):
        sel = labels == i
        if not np.any(sel):
            continue
        score = float(dark[sel].mean()) - 0.01 * float(np.hypot(
            np.where(sel)[1].mean() - sx, np.where(sel)[0].mean() - sy
        ))
        if score > best_score:
            best_score, best_i = score, i
    return np.where(labels == best_i, 255, 0).astype(np.uint8)


def _seed_centre(box, seed_polygon):
    if seed_polygon and len(seed_polygon) >= 3:
        xs = [p[0] for p in seed_polygon]
        ys = [p[1] for p in seed_polygon]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    return box["x"] + box["w"] * 0.5, box["y"] + box["h"] * 0.5


def _box_as_quad(box):
    """Axis-aligned rectangle as a 4-point polygon (seed fallback outline)."""
    if not box:
        return None
    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    return [
        [float(x), float(y)],
        [float(x + w), float(y)],
        [float(x + w), float(y + h)],
        [float(x), float(y + h)],
    ]


def _clip_polygon_to_box(polygon, box):
    """Clamp vertices into the tooth box so outlines cannot spill into bone."""
    x1, y1 = box["x"], box["y"]
    x2, y2 = box["x"] + box["w"], box["y"] + box["h"]
    clipped = [
        [float(min(x2, max(x1, p[0]))), float(min(y2, max(y1, p[1])))]
        for p in polygon
    ]
    # Degenerate after clamp → drop.
    xs = [p[0] for p in clipped]
    ys = [p[1] for p in clipped]
    if max(xs) - min(xs) < 1.5 or max(ys) - min(ys) < 1.5:
        return polygon
    return clipped


def _crown_zones(tooth):
    """
    Split the enclosing tooth into enamel and dentin bands.

    Uses the same crown/apex orientation convention as bone_loss: on a panoramic
    radiograph upper crowns face down and lower crowns face up.
    """
    box = tooth.get("box")
    if not box or box["h"] <= 0:
        return None

    arch = tooth.get("arch")
    if arch not in ("upper", "lower"):
        return None

    crown_h = box["h"] * CROWN_RATIO
    enamel_h = crown_h * ENAMEL_BAND_RATIO
    edge = geometry.crown_edge_y(tooth, arch)
    sign = geometry.crown_edge_sign(arch)

    enamel_y1 = min(edge, edge + sign * enamel_h)
    enamel_zone = {
        "x": box["x"],
        "y": enamel_y1,
        "w": box["w"],
        "h": abs(enamel_h),
    }
    dentin_start = edge + sign * enamel_h
    dentin_end = edge + sign * crown_h * (1.0 + DENTIN_ROOT_PAD_RATIO)
    dentin_zone = {
        "x": box["x"],
        "y": min(dentin_start, dentin_end),
        "w": box["w"],
        "h": abs(dentin_end - dentin_start),
    }
    if enamel_zone["h"] <= 0 or dentin_zone["h"] <= 0:
        return None
    return enamel_zone, dentin_zone


def _bounds_of(polygon):
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return {
        "x": min(xs),
        "y": min(ys),
        "w": max(1e-3, max(xs) - min(xs)),
        "h": max(1e-3, max(ys) - min(ys)),
    }


def anatomy_layers_for_tooth(tooth):
    """
    Geometric enamel/dentin/pulp approximations for the anatomy overlay.

    These are derived from the tooth bounding box, NOT from segmentation. They
    exist because the client already renders per-tooth layer polygons; set
    EMIT_ANATOMY_LAYERS=false to omit them entirely.
    """
    box = tooth.get("box")
    arch = tooth.get("arch")
    if not box or arch not in ("upper", "lower"):
        return []

    zones = _crown_zones(tooth)
    if zones is None:
        return []
    enamel_zone, dentin_zone = zones

    fdi = tooth.get("fdi")
    label = fdi if fdi is not None else int(round(box["x"]))

    layers = [
        {"tooth": label, "layer": "enamel", "polygon": geometry.polygon_from_box(enamel_zone)},
        {"tooth": label, "layer": "dentin", "polygon": geometry.polygon_from_box(dentin_zone)},
    ]

    sign = geometry.crown_edge_sign(arch)
    edge = geometry.crown_edge_y(tooth, arch)
    pulp_start = edge + sign * box["h"] * (CROWN_RATIO * 0.55)
    pulp_end = edge + sign * box["h"] * 0.86
    pulp_zone = {
        "x": box["x"] + box["w"] * 0.38,
        "y": min(pulp_start, pulp_end),
        "w": max(1.0, box["w"] * 0.24),
        "h": abs(pulp_end - pulp_start),
    }
    if pulp_zone["h"] > 0:
        layers.append(
            {"tooth": label, "layer": "pulp", "polygon": geometry.polygon_from_box(pulp_zone)}
        )
    return layers
