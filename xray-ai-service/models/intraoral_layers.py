"""
Free-form enamel / dentin / pulp polygons for bitewing and periapical images.

Panoramics keep the geometric rectangle layers in caries_refine.anatomy_layers_for_tooth.
Intraoral films get the tooth silhouette from classical CV, then split that
silhouette into layer bands (same crown-fraction priors as the rectangle path)
and emit real contours — so lateral edges follow the tooth, not the AABB.
"""

from __future__ import annotations

import logging

import numpy as np

from . import caries_refine, geometry

log = logging.getLogger("xray-ai.intraoral_layers")

# Slightly finer than lesion refine — layer overlays are large and benefit
# from following the silhouette closely.
_EPS_FRAC = 0.006
_MAX_VERTS = 64


def layers_for_tooth(gray, tooth):
    """
    Return [{'tooth', 'layer', 'polygon'}] with free-form polygons, or [].

    Falls back to [] so the caller can use the rectangular geometry path.
    Also attaches tooth['anatomy'] (masks + EDJ) when successful.
    """
    anatomy = prepare_tooth_anatomy(gray, tooth)
    if anatomy is None:
        return []

    box = tooth.get("box")
    fdi = tooth.get("fdi")
    label = fdi if fdi is not None else int(round(box["x"]))
    ox, oy = anatomy["origin"]
    layers = []
    for name in ("enamel", "dentin", "pulp", "edj"):
        key = "edj_band" if name == "edj" else name
        mask = anatomy["masks"].get(key)
        if mask is None or not np.any(mask):
            continue
        try:
            import cv2
        except Exception:
            break
        poly = _mask_to_polygon(mask, ox, oy, cv2)
        if poly and len(poly) >= 3:
            layers.append({"tooth": label, "layer": name, "polygon": poly})
    return layers


def prepare_tooth_anatomy(gray, tooth):
    """
    Build enamel / dentin / pulp / tooth masks and an EDJ curve+band for one tooth.

    Stores the result on tooth['anatomy'] and returns it. Used by caries EDJ
    gating — CEJ / bone-crest are never used here.
    """
    try:
        import cv2
    except Exception as exc:  # pragma: no cover
        log.debug("opencv unavailable for tooth anatomy: %s", exc)
        return None

    box = tooth.get("box")
    arch = tooth.get("arch")
    if gray is None or not box or arch not in ("upper", "lower"):
        return None

    tooth_mask, origin = _tooth_mask(gray, tooth, cv2)
    if tooth_mask is None or not np.any(tooth_mask):
        return None
    # Dilate slightly so proximal contact faces (early EDJ caries) stay inside
    # the silhouette — Otsu often stops short of the contact edge.
    tooth_mask = cv2.dilate(
        tooth_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1
    )

    sil = _mask_to_polygon(tooth_mask, origin[0], origin[1], cv2)
    if sil and len(sil) >= 3:
        tooth["polygon"] = sil

    zones = caries_refine._crown_zones(tooth)
    if zones is None:
        return None
    enamel_zone, dentin_zone = zones
    pulp_zone = _pulp_zone(tooth)
    if pulp_zone is None:
        return None

    h, w = tooth_mask.shape[:2]
    ox, oy = origin
    enamel_m = tooth_mask & _zone_mask(enamel_zone, ox, oy, w, h)
    dentin_m = tooth_mask & _zone_mask(dentin_zone, ox, oy, w, h)
    pulp_m = tooth_mask & _zone_mask(pulp_zone, ox, oy, w, h)
    pulp_m = _darken_core(gray, pulp_m, ox, oy, cv2)

    edj_curve, edj_band = _edj_curve_and_band(
        tooth, tooth_mask, enamel_m, dentin_m, origin, cv2
    )
    anatomy = {
        "origin": (int(ox), int(oy)),
        "masks": {
            "tooth": tooth_mask,
            "enamel": enamel_m,
            "dentin": dentin_m,
            "pulp": pulp_m,
            "edj_band": edj_band,
        },
        "edj_curve": edj_curve,
    }
    tooth["anatomy"] = anatomy
    return anatomy


def attach_silhouettes(gray, teeth):
    """Attach free-form tooth outline polygons onto each tooth dict in-place."""
    try:
        import cv2
    except Exception:
        return
    for tooth in teeth or []:
        if tooth.get("polygon"):
            continue
        mask, origin = _tooth_mask(gray, tooth, cv2)
        if mask is None:
            continue
        poly = _mask_to_polygon(mask, origin[0], origin[1], cv2)
        if poly and len(poly) >= 3:
            tooth["polygon"] = poly


def attach_anatomy(gray, teeth):
    """Attach enamel/dentin/pulp/EDJ anatomy onto each tooth (caries path)."""
    for tooth in teeth or []:
        if tooth.get("anatomy"):
            continue
        prepare_tooth_anatomy(gray, tooth)


# ── internals ──────────────────────────────────────────────────────
def _tooth_mask(gray, tooth, cv2):
    """Binary mask of the tooth body inside a padded AABB, plus ROI origin."""
    box = tooth.get("box")
    if not box or box["w"] < 6 or box["h"] < 6:
        return None, (0, 0)

    gh, gw = gray.shape[:2]
    pad_x = box["w"] * 0.06
    pad_y = box["h"] * 0.04
    x1 = int(max(0, np.floor(box["x"] - pad_x)))
    y1 = int(max(0, np.floor(box["y"] - pad_y)))
    x2 = int(min(gw, np.ceil(box["x"] + box["w"] + pad_x)))
    y2 = int(min(gh, np.ceil(box["y"] + box["h"] + pad_y)))
    if x2 - x1 < 6 or y2 - y1 < 6:
        return None, (0, 0)

    roi = np.clip(gray[y1:y2, x1:x2], 0, 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
    eq = clahe.apply(roi)
    blur = cv2.GaussianBlur(eq, (5, 5), 0)
    thr, _ = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Teeth are bright; bias a little above Otsu to drop soft tissue.
    cut = min(255, int(thr + 6))
    _, mask = cv2.threshold(blur, cut, 255, cv2.THRESH_BINARY)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)

    # Keep the component that best covers the box centre.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return None, (x1, y1)
    cx = int((box["x"] + box["w"] * 0.5) - x1)
    cy = int((box["y"] + box["h"] * 0.5) - y1)
    cx = int(np.clip(cx, 0, mask.shape[1] - 1))
    cy = int(np.clip(cy, 0, mask.shape[0] - 1))
    target = labels[cy, cx]
    if target <= 0:
        # Nearest centroid to centre.
        best_i, best_d = 1, None
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < 20:
                continue
            icx = stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] * 0.5
            icy = stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] * 0.5
            d = (icx - cx) ** 2 + (icy - cy) ** 2
            if best_d is None or d < best_d:
                best_d, best_i = d, i
        target = best_i

    out = np.where(labels == target, 255, 0).astype(np.uint8)
    # Fill small holes inside the tooth body.
    out = cv2.morphologyEx(out, cv2.MORPH_CLOSE,
                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
                           iterations=1)
    return out, (x1, y1)


def _zone_mask(zone, ox, oy, w, h):
    """Rasterise an axis-aligned zone into the ROI coordinate frame."""
    m = np.zeros((h, w), dtype=np.uint8)
    x1 = int(np.floor(zone["x"] - ox))
    y1 = int(np.floor(zone["y"] - oy))
    x2 = int(np.ceil(zone["x"] + zone["w"] - ox))
    y2 = int(np.ceil(zone["y"] + zone["h"] - oy))
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w, x2)
    y2 = min(h, y2)
    if x2 > x1 and y2 > y1:
        m[y1:y2, x1:x2] = 255
    return m


def _pulp_zone(tooth):
    box = tooth.get("box")
    arch = tooth.get("arch")
    if not box or arch not in ("upper", "lower"):
        return None
    sign = geometry.crown_edge_sign(arch)
    edge = geometry.crown_edge_y(tooth, arch)
    pulp_start = edge + sign * box["h"] * (caries_refine.CROWN_RATIO * 0.55)
    pulp_end = edge + sign * box["h"] * 0.86
    return {
        "x": box["x"] + box["w"] * 0.34,
        "y": min(pulp_start, pulp_end),
        "w": max(1.0, box["w"] * 0.32),
        "h": abs(pulp_end - pulp_start),
    }


def _darken_core(gray, pulp_m, ox, oy, cv2):
    """Keep only the darker portion of the pulp band (chamber), if present."""
    if pulp_m is None or not np.any(pulp_m):
        return pulp_m
    ys, xs = np.where(pulp_m > 0)
    if xs.size < 12:
        return pulp_m
    vals = gray[oy + ys, ox + xs]
    # Chamber is darker than surrounding dentin in the same band.
    cut = float(np.percentile(vals, 45))
    h, w = pulp_m.shape[:2]
    roi = gray[oy:oy + h, ox:ox + w]
    if roi.shape[:2] != pulp_m.shape[:2]:
        return pulp_m
    core = np.where((pulp_m > 0) & (roi <= cut), 255, 0).astype(np.uint8)
    core = cv2.morphologyEx(
        core, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1
    )
    if np.count_nonzero(core) < 0.15 * np.count_nonzero(pulp_m):
        return pulp_m  # too aggressive — keep the band∩tooth silhouette
    return core


def _mask_to_polygon(mask, ox, oy, cv2):
    if mask is None or not np.any(mask):
        return None
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 24:
        return None
    epsilon = max(1.0, _EPS_FRAC * cv2.arcLength(largest, True))
    approx = cv2.approxPolyDP(largest, epsilon, True)
    if approx is None or len(approx) < 3:
        return None
    points = [[float(p[0][0]) + ox, float(p[0][1]) + oy] for p in approx]
    if len(points) > _MAX_VERTS:
        stride = int(np.ceil(len(points) / float(_MAX_VERTS)))
        points = points[::stride]
    return points if len(points) >= 3 else None


def _edj_curve_and_band(tooth, tooth_mask, enamel_m, dentin_m, origin, cv2):
    """
    EDJ curve (absolute px) and a band mask in ROI coords.

    Prefer the enamel∩dentin interface; fall back to geometric edj_y sampled
    across the tooth width. Band is inset from the outer proximal rim so empty
    interdental gap is excluded.
    """
    h, w = tooth_mask.shape[:2]
    ox, oy = origin
    box = tooth.get("box")
    curve = []

    # Interface: dilate enamel and dentin, take overlap inside the tooth.
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    e_d = cv2.dilate(enamel_m, k, iterations=1)
    d_d = cv2.dilate(dentin_m, k, iterations=1)
    interface = ((e_d > 0) & (d_d > 0) & (tooth_mask > 0)).astype(np.uint8) * 255

    if np.count_nonzero(interface) >= 8:
        ys, xs = np.where(interface > 0)
        # Sample a polyline left→right (median y per x bucket).
        buckets = {}
        for x, y in zip(xs.tolist(), ys.tolist()):
            buckets.setdefault(x, []).append(y)
        for x in sorted(buckets):
            curve.append([float(ox + x), float(oy + float(np.median(buckets[x])))])
    else:
        # Geometric EDJ horizontal sample across the crown.
        junction = caries_refine.edj_y(tooth)
        if junction is not None and box is not None:
            x0 = max(0, int(round(box["x"] - ox + box["w"] * 0.08)))
            x1 = min(w - 1, int(round(box["x"] + box["w"] * 0.92 - ox)))
            yi = int(np.clip(round(junction - oy), 0, h - 1))
            for x in range(x0, x1 + 1, max(1, (x1 - x0) // 24 or 1)):
                if tooth_mask[yi, x] > 0:
                    curve.append([float(ox + x), float(oy + yi)])

    # Band: dilate interface (or a wider geometric strip) ∩ tooth, inset gap rim.
    if np.count_nonzero(interface) >= 8:
        band = cv2.dilate(interface, cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (7, 7)
        ), iterations=3)
    else:
        band = np.zeros((h, w), dtype=np.uint8)
        junction = caries_refine.edj_y(tooth)
        if junction is not None:
            yi = int(np.clip(round(junction - oy), 0, h - 1))
            # Wide enough for progressed dentin wedges apical of the EDJ.
            half = max(8, int(round(h * 0.18)))
            y1 = max(0, yi - half)
            y2 = min(h, yi + half + 1)
            band[y1:y2, :] = 255
    # Also union a geometric EDJ strip so band covers deep contact dentin
    # when the enamel∩dentin interface is sparse.
    junction = caries_refine.edj_y(tooth)
    if junction is not None:
        yi = int(np.clip(round(junction - oy), 0, h - 1))
        half = max(8, int(round(h * 0.16)))
        geo = np.zeros((h, w), dtype=np.uint8)
        geo[max(0, yi - half): min(h, yi + half + 1), :] = 255
        band = np.maximum(band, geo)
    band = ((band > 0) & (tooth_mask > 0)).astype(np.uint8) * 255

    # Thin inset only — proximal EDJ caries sits near the contact face.
    rim = max(1, int(round(w * 0.035)))
    band[:, :rim] = 0
    band[:, max(0, w - rim):] = 0

    if len(curve) > _MAX_VERTS:
        stride = int(np.ceil(len(curve) / float(_MAX_VERTS)))
        curve = curve[::stride]
    return curve, band
