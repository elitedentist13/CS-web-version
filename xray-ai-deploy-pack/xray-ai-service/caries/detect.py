"""
Caries orchestration: candidates -> reasoning layer -> findings.

Candidates come from the trained model when weights exist, and (by default)
also from a classical radiolucency generator. The classical path is restricted
to the crown EDJ contact band (pulp masked) so bone/canal lucencies are not proposed.
The reasoning layer still screens every candidate.
"""

import logging
import math

import numpy as np

from models import caries_refine, geometry
from . import edj_anatomy, reasoning

log = logging.getLogger("xray-ai.caries.detect")


def detect_caries(gray, rgb, teeth, restorations, model=None, cfg=None, union_classical=None):
    """
    Args:
        gray: float32 HxW, 0..255 (contrast-stretched by the pipeline).
        rgb:  HxWx3 uint8, for the model (which does its own preprocessing).
        teeth: Stage-1 tooth detections (with 'arch' annotated).
        restorations: px boxes for detected restorations (relay input).
        model: a ready CariesModel, or None.
        union_classical: if True, always merge classical proposals with the
            model. Defaults to config.CARIES_UNION_CLASSICAL (True).
    Returns:
        (findings, model_ready) — findings in the pipeline's internal shape;
        model_ready True when the trained model was engaged this run.
    """
    cfg = cfg or reasoning.ReasoningConfig.from_service_config()
    try:
        import config as conf_mod
    except Exception:
        conf_mod = None
    if union_classical is None:
        union_classical = bool(
            getattr(conf_mod, "CARIES_UNION_CLASSICAL", True) if conf_mod else True
        )
    use_anatomy = bool(
        getattr(conf_mod, "CARIES_ANATOMY_PIPELINE", True) if conf_mod else True
    )
    anatomy_hard_gate = bool(
        getattr(conf_mod, "CARIES_ANATOMY_HARD_GATE", True) if conf_mod else True
    )

    model_ready = model is not None and getattr(model, "ready", False)
    candidates = []

    # Expand tooth boxes toward facing contacts once, so proposer and reasoning
    # share the same anatomy (early proximal caries sits on the contact face).
    facing = _facing_sides(teeth or [])
    teeth = _expand_toward_contacts(teeth or [], facing)

    # Anatomy-first: enamel/dentin/pulp/EDJ masks, then EDJ-band shadows.
    if use_anatomy:
        edj_anatomy.prepare_teeth(gray, teeth)
        anatomy_cands = edj_anatomy.propose_candidates(gray, teeth, cfg=cfg)
        for c in anatomy_cands:
            c["from_model"] = False
            c["from_anatomy"] = True
        candidates.extend(anatomy_cands)

    if model_ready:
        model_cands = model.detect(rgb) or []
        for c in model_cands:
            c["from_model"] = True
        candidates.extend(model_cands)
        log.info("caries model proposed %d candidates", len(model_cands))

    run_classical = (not model_ready) or union_classical
    if run_classical:
        classical = _classical_candidates(gray, teeth, cfg)
        for c in classical:
            c["from_model"] = False
        candidates.extend(classical)
        log.info("caries classical proposer added %d candidates (union=%s)",
                 len(classical), union_classical)

    findings = reasoning.screen(
        gray,
        candidates,
        teeth,
        restorations,
        cfg=cfg,
        has_model=model_ready,
        anatomy_hard_gate=anatomy_hard_gate,
    )
    log.info("caries reasoning surfaced %d of %d candidates",
             len(findings), len(candidates))
    return findings, model_ready


def _classical_candidates(gray, teeth, cfg):
    """
    Generate radiolucent blob candidates per tooth, interdental / EDJ-focused.

    Search is limited to the crown contact band around the EDJ (enamel→dentin).
    Primary seeds are mesial/distal contact columns straddling the EDJ.
    Pulp is masked; deep root / bone are out of the search band.
    Bone-loss CEJ geometry is not used here.
    """
    try:
        import cv2
    except Exception as exc:  # pragma: no cover - import guard
        log.debug("opencv unavailable; classical caries fallback disabled: %s", exc)
        return []
    if not teeth:
        return []

    lucency_thr = int(getattr(cfg, "classical_lucency_thresh", 10))
    min_area_frac = float(getattr(cfg, "classical_min_area_frac", 0.004))
    max_area_frac = float(getattr(cfg, "classical_max_area_frac", 0.22))

    h, w = gray.shape[:2]
    candidates = []
    # Teeth are already contact-expanded by detect_caries().
    for tooth in teeth:
        box = tooth.get("box")
        arch = tooth.get("arch")
        if not box or box["w"] < 6 or box["h"] < 6 or arch not in ("upper", "lower"):
            continue

        search = _crown_search_box(tooth)
        if search is None:
            continue
        x1 = int(max(0, math.floor(search["x"])))
        y1 = int(max(0, math.floor(search["y"])))
        x2 = int(min(w, math.ceil(search["x"] + search["w"])))
        y2 = int(min(h, math.ceil(search["y"] + search["h"])))
        if x2 - x1 < 6 or y2 - y1 < 6:
            continue

        roi = gray[y1:y2, x1:x2]
        u8 = np.clip(roi, 0, 255).astype(np.uint8)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
        eq = clahe.apply(u8)

        prefer_sides = tooth.get("contact_sides") or ("mesial", "distal")

        # Primary: dentin just under the interproximal contact (inset from gap).
        candidates.extend(
            _contact_dentin_seeds(
                eq, tooth, x1, y1, lucency_thr, prefer_sides, gray_full=gray
            )
        )
        # Fused bitewing boxes hide true mid-contacts; also seed intensity
        # valleys inside the crown band (classic EDJ sites live there).
        if box["w"] >= box["h"] * 0.70:
            candidates.extend(
                _interior_contact_valley_seeds(
                    eq, tooth, x1, y1, lucency_thr
                )
            )

        k = max(9, (min(roi.shape[:2]) // 3) | 1)
        bg = cv2.blur(eq, (k, k))
        diff = bg.astype(np.int16) - eq.astype(np.int16)
        lucent = np.clip(diff, 0, 255).astype(np.uint8)
        _, mask = cv2.threshold(lucent, lucency_thr, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        mask = _mask_out_pulp(mask, tooth, x1, y1)
        mask = _mask_out_gap_rim(mask, tooth, x1, y1)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        roi_area = float(roi.shape[0] * roi.shape[1])
        edge = geometry.crown_edge_y(tooth, arch)
        sign = geometry.crown_edge_sign(arch)
        crown_h = box["h"] * caries_refine.CROWN_RATIO
        junction = caries_refine.edj_y(tooth)
        dentin_span = crown_h * (1.0 - caries_refine.ENAMEL_BAND_RATIO)
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < min_area_frac * roi_area or area > max_area_frac * roi_area:
                continue
            cx, cy, cw, ch = cv2.boundingRect(c)
            abs_cx = cx + x1 + cw * 0.5
            abs_cy = cy + y1 + ch * 0.5
            # Drop deep root/bone: too far apical of the EDJ.
            if junction is not None:
                apical_of_edj = (abs_cy - junction) * sign
                if apical_of_edj > dentin_span + crown_h * 0.55:
                    continue
            rel_x = (abs_cx - box["x"]) / max(box["w"], 1e-6)
            if rel_x < 0.05 or rel_x > 0.95:
                continue
            in_contact_col = (0.06 <= rel_x <= 0.38) or (0.62 <= rel_x <= 0.94)
            if not in_contact_col:
                continue
            # Contact band around the EDJ (enamel side → outer dentin).
            apical_of_edj = (abs_cy - junction) * sign if junction is not None else 0.0
            if apical_of_edj < -crown_h * 0.20 or apical_of_edj > dentin_span + crown_h * 0.55:
                continue

            eps = 0.02 * cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, eps, True)
            polygon = None
            if approx is not None and len(approx) >= 3:
                polygon = [[float(p[0][0]) + x1, float(p[0][1]) + y1] for p in approx]
            blob = lucent[cy:cy + ch, cx:cx + cw]
            mean_luc = float(blob.mean()) if blob.size else float(lucency_thr)
            # Gap/air is usually much darker than contact-dentin caries.
            if mean_luc > 60:
                continue
            score = float(min(0.72, 0.36 + mean_luc / 85.0))
            box = {"x": cx + x1, "y": cy + y1, "w": float(cw), "h": float(ch)}
            candidates.append({
                "box": box,
                "core_box": dict(box),
                "score": score + 0.08,
                "polygon": polygon,
                "stage": None,
                "prefer_surface": "interproximal",
                "interproximal_seed": True,
                "edj_seed": True,
            })

    # Facing-neighbour junctions: seed the true contact even when tooth boxes
    # overlap or fuse (common on bitewings with deep proximal caries).
    candidates.extend(_facing_junction_seeds(gray, teeth, lucency_thr))
    return candidates


def _crown_search_box(tooth):
    """Occlusal edge through EDJ into outer dentin (caries contact band)."""
    box = tooth.get("box")
    arch = tooth.get("arch")
    if not box or arch not in ("upper", "lower"):
        return None
    edge = geometry.crown_edge_y(tooth, arch)
    sign = geometry.crown_edge_sign(arch)
    crown_h = box["h"] * caries_refine.CROWN_RATIO
    # Enamel + dentin around EDJ; not bone-loss CEJ depth.
    depth = crown_h * (caries_refine.ENAMEL_BAND_RATIO + 1.15)
    y_a = edge
    y_b = edge + sign * depth
    y1 = max(box["y"], min(y_a, y_b))
    y2 = min(box["y"] + box["h"], max(y_a, y_b))
    if y2 - y1 < 8:
        return None
    return {
        "x": float(box["x"]),
        "y": float(y1),
        "w": float(box["w"]),
        "h": float(y2 - y1),
    }


def _facing_sides(teeth):
    """
    For each tooth, which mesial/distal sides face a neighbour (interdental).

    Same-arch only — an upper tooth between two lowers in x-order must not
    hide the lower contact. Returns {id(tooth): (...sides...)}.
    """
    out = {}
    by_arch = {"upper": [], "lower": []}
    for t in teeth or []:
        if not t.get("box") or t.get("arch") not in by_arch:
            continue
        by_arch[t["arch"]].append(t)
    for arch, group in by_arch.items():
        ordered = sorted(
            group, key=lambda t: t["box"]["x"] + t["box"]["w"] * 0.5
        )
        for i, tooth in enumerate(ordered):
            sides = []
            tw = tooth["box"]["w"]
            if i > 0:
                prev = ordered[i - 1]
                gap = tooth["box"]["x"] - (prev["box"]["x"] + prev["box"]["w"])
                if gap < tw * 0.85:
                    sides.append("mesial")
            if i < len(ordered) - 1:
                nxt = ordered[i + 1]
                gap = nxt["box"]["x"] - (tooth["box"]["x"] + tooth["box"]["w"])
                if gap < tw * 0.85:
                    sides.append("distal")
            if not sides:
                sides = ["mesial", "distal"]
            out[id(tooth)] = tuple(sides)
    return out


def _expand_toward_contacts(teeth, facing):
    """Grow each tooth box a little into the facing interdental gap."""
    out = []
    for tooth in teeth:
        t = dict(tooth)
        box = dict(tooth.get("box") or {})
        sides = facing.get(id(tooth)) or ("mesial", "distal")
        t["contact_sides"] = sides
        if not box:
            out.append(t)
            continue
        pad = max(3.0, box["w"] * 0.10)
        if "mesial" in sides:
            box["x"] = box["x"] - pad
            box["w"] = box["w"] + pad
        if "distal" in sides:
            box["w"] = box["w"] + pad
        t["box"] = box
        out.append(t)
    return out


def _mask_out_pulp(mask, tooth, x1, y1):
    """Zero the central pulp/canal column inside the ROI mask."""
    pulp = reasoning._pulp_zone(tooth, tooth.get("arch"))
    if pulp is None:
        return mask
    h, w = mask.shape[:2]
    px1 = int(max(0, math.floor(pulp["x"] - x1)))
    py1 = int(max(0, math.floor(pulp["y"] - y1)))
    px2 = int(min(w, math.ceil(pulp["x"] + pulp["w"] - x1)))
    py2 = int(min(h, math.ceil(pulp["y"] + pulp["h"] - y1)))
    if px2 > px1 and py2 > py1:
        mask = mask.copy()
        mask[py1:py2, px1:px2] = 0
    return mask


def _mask_out_gap_rim(mask, tooth, x1, y1):
    """Zero the outermost mesial/distal rim (empty interdental space)."""
    box = tooth.get("box")
    if not box:
        return mask
    h, w = mask.shape[:2]
    # Thin rim only — proximal caries lives just inside the contact surface.
    rim = max(2, int(round(box["w"] * 0.05)))
    lx = int(max(0, math.floor(box["x"] - x1)))
    rx = int(min(w, math.ceil(box["x"] + box["w"] - x1)))
    mask = mask.copy()
    mask[:, lx:min(w, lx + rim)] = 0
    mask[:, max(0, rx - rim):rx] = 0
    return mask


def _contact_dentin_seeds(eq, tooth, x1, y1, lucency_thr, prefer_sides, gray_full=None):
    """
    Seeds in dentin just beneath the interproximal contact.

    Scans several short vertical stations around the EDJ on each facing
    proximal column. Keeps only compact darkest windows that are darker than
    mid-dentin but brighter than the empty interdental rim.
    """
    arch = tooth.get("arch")
    box = tooth.get("box")
    if not box or arch not in ("upper", "lower"):
        return []

    h_roi, w_roi = eq.shape[:2]
    sign = geometry.crown_edge_sign(arch)
    crown_h = box["h"] * caries_refine.CROWN_RATIO
    junction = caries_refine.edj_y(tooth)
    if junction is None:
        return []

    # Stations that STRADDLE the EDJ — classic enamel→dentin crossing target.
    # Include a deeper dentin station: on bitewings the dentin wedge often sits
    # clearly apical of the geometric EDJ while enamel breach is at the contact.
    focuses = [
        junction - sign * crown_h * 0.14,  # enamel side of EDJ
        junction,                            # on the EDJ
        junction + sign * crown_h * 0.22,  # outer dentin
        junction + sign * crown_h * 0.45,  # mid dentin wedge
        junction + sign * crown_h * 0.70,  # deeper dentin (progressed EDJ)
        junction + sign * crown_h * 0.95,  # deep dentin wedge
    ]
    band_half = max(5, int(0.18 * crown_h))
    inset = max(2, int(0.05 * w_roi))
    col_w = max(5, int(0.18 * w_roi))
    thr = max(3.0, float(lucency_thr) * 0.45)
    max_delta = 55.0
    seeds = []
    side_x = {
        "mesial": inset,
        "distal": max(inset, w_roi - col_w - inset),
    }
    for side in prefer_sides:
        x0 = side_x.get(side)
        if x0 is None:
            continue
        side_hits = []
        for focus_y in focuses:
            hit = _seed_at_column_station(
                eq, x0, col_w, focus_y, y1, band_half, inset, side,
                thr, max_delta, junction, sign, crown_h, x1,
                gray_full=gray_full,
            )
            if hit is not None:
                side_hits.append(hit)
        # Full-column sweep: catch EDJ wedges between fixed stations
        # (common when geometric EDJ is slightly off the true contact).
        sweep = _best_column_edj_seed(
            eq, x0, col_w, junction, sign, crown_h, y1, band_half,
            inset, side, thr, max_delta, x1,
            gray_full=gray_full,
        )
        if sweep is not None:
            side_hits.append(sweep)
        # Keep up to three vertically diverse stations (avoid three near-ties
        # at one y that crowd out the true EDJ wedge elsewhere on the column).
        side_hits.sort(key=lambda c: c["score"], reverse=True)
        diverse = []
        for hit in side_hits:
            cy = hit["box"]["y"] + hit["box"]["h"] * 0.5
            if any(
                abs(cy - (d["box"]["y"] + d["box"]["h"] * 0.5)) < 18
                for d in diverse
            ):
                continue
            diverse.append(hit)
            if len(diverse) >= 3:
                break
        seeds.extend(diverse)
    return seeds


def _seed_at_column_station(
    eq, x0, col_w, focus_y, y1, band_half, inset, side,
    thr, max_delta, junction, sign, crown_h, abs_x1, gray_full=None,
):
    h_roi, w_roi = eq.shape[:2]
    local_y = int(np.clip(focus_y - y1, band_half, h_roi - band_half - 1))
    strip = eq[local_y - band_half:local_y + band_half, x0:x0 + col_w]
    if strip.size < 8:
        return None
    mid0 = w_roi // 3
    mid1 = 2 * w_roi // 3
    mid = eq[local_y - band_half:local_y + band_half, mid0:mid1]
    if mid.size < 8:
        return None
    if side == "mesial":
        rim = eq[local_y - band_half:local_y + band_half, 0:max(2, inset)]
    else:
        rim = eq[
            local_y - band_half:local_y + band_half,
            max(0, w_roi - inset):w_roi,
        ]
    rim_mean = float(rim.mean()) if rim.size >= 4 else 0.0
    mid_mean = float(mid.mean())
    tissue_floor = max(rim_mean + 15.0, mid_mean - max_delta)
    sub = _best_tissue_lucency_window(
        strip, mid_mean, tissue_floor, min_w=4, min_h=5
    )
    if sub is None:
        return None
    sx, sy, sw, sh = sub
    # Slightly enlarge tiny cores so ring-contrast in gray space is stable.
    sw = max(sw, 6)
    sh = max(sh, 8)
    if sx + sw > strip.shape[1]:
        sx = max(0, strip.shape[1] - sw)
    if sy + sh > strip.shape[0]:
        sy = max(0, strip.shape[0] - sh)
    core = strip[sy:sy + sh, sx:sx + sw]
    if core.size < 4:
        return None
    delta = mid_mean - float(core.mean())
    if delta < thr or delta > max_delta:
        return None
    abs_box = {
        "x": float(abs_x1 + x0 + sx),
        "y": float(y1 + local_y - band_half + sy),
        "w": float(sw),
        "h": float(sh),
    }
    # CLAHE-relative hits must also be darker than a local gray ring.
    if gray_full is not None:
        g_ring = reasoning._ring_contrast(gray_full, abs_box, max(4.0, min(sw, sh) * 0.6))
        if g_ring < 3.5:
            return None
        score = float(min(0.88, 0.50 + delta / 40.0 + min(0.12, g_ring / 50.0)))
    else:
        score = float(min(0.85, 0.52 + delta / 40.0))
    apical_focus = (focus_y - junction) * sign
    if apical_focus >= -0.02 * crown_h:
        score = min(0.90, score + 0.06)
    cand = {
        "box": dict(abs_box),
        "score": score,
        "polygon": None,
        "stage": None,
        "prefer_surface": "interproximal",
        "interproximal_seed": True,
        "edj_seed": True,
        "contact_side": side,
    }
    cand["core_box"] = dict(cand["box"])
    return cand


def _best_column_edj_seed(
    eq, x0, col_w, junction, sign, crown_h, y1, band_half,
    inset, side, thr, max_delta, abs_x1, gray_full=None,
):
    """Strongest tissue lucency along the proximal column around the EDJ."""
    h_roi, w_roi = eq.shape[:2]
    y_a = junction - sign * crown_h * 0.20
    y_b = junction + sign * crown_h * 1.05
    y_lo = int(np.clip(min(y_a, y_b) - y1, band_half, h_roi - band_half - 1))
    y_hi = int(np.clip(max(y_a, y_b) - y1, band_half, h_roi - band_half - 1))
    if y_hi - y_lo < band_half:
        return None
    best = None
    step = max(2, band_half // 2)
    for local_y in range(y_lo, y_hi + 1, step):
        focus_y = y1 + local_y
        hit = _seed_at_column_station(
            eq, x0, col_w, focus_y, y1, band_half, inset, side,
            thr, max_delta, junction, sign, crown_h, abs_x1,
            gray_full=gray_full,
        )
        if hit is None:
            continue
        if best is None or hit["score"] > best["score"]:
            best = hit
    return best


def _best_tissue_lucency_window(strip, mid_mean, tissue_floor, min_w=3, min_h=3):
    """
    Window with strongest mid−local lucency that is still tooth tissue.

    Absolute-darkest windows sit in the empty interdental gap; classic EDJ
    caries is only moderately darker than mid-dentin and brighter than air.
    """
    h, w = strip.shape[:2]
    win_w = min(max(min_w, 5), w)
    win_h = min(max(min_h, 7), h)
    if h < win_h or w < win_w:
        return None
    best = None
    best_key = None
    for y in range(0, h - win_h + 1):
        for x in range(0, w - win_w + 1):
            m = float(strip[y:y + win_h, x:x + win_w].mean())
            if m < tissue_floor:
                continue
            delta = mid_mean - m
            if delta <= 0:
                continue
            # Stronger lucency wins; tie-break toward the proximal edge (x~0).
            key = (delta, -x)
            if best_key is None or key > best_key:
                best_key = key
                best = (x, y, win_w, win_h)
    return best


def _interior_contact_valley_seeds(eq, tooth, x1, y1, lucency_thr):
    """
    Seed EDJ columns at brightness valleys inside a wide (likely fused) tooth.

    Mesial/distal-only search misses the real contacts when segmentation merged
    neighbouring crowns — valleys in the crown band mark those contacts.
    """
    arch = tooth.get("arch")
    box = tooth.get("box")
    if not box or arch not in ("upper", "lower"):
        return []
    h_roi, w_roi = eq.shape[:2]
    if w_roi < 28 or h_roi < 16:
        return []

    sign = geometry.crown_edge_sign(arch)
    crown_h = box["h"] * caries_refine.CROWN_RATIO
    junction = caries_refine.edj_y(tooth)
    if junction is None:
        return []
    # Crown-band column mean (around EDJ).
    half = max(6, int(0.28 * crown_h))
    y0 = int(np.clip(junction - y1 - half, 0, h_roi - 1))
    y1b = int(np.clip(junction - y1 + half, 0, h_roi))
    if y1b - y0 < 6:
        return []
    band = eq[y0:y1b, :]
    col = band.mean(axis=0).astype(np.float32)
    # Smooth; find local minima that are not the outer gap rims.
    k = max(5, (w_roi // 12) | 1)
    try:
        import cv2
        sm = cv2.GaussianBlur(col.reshape(1, -1), (k, 1), 0).ravel()
    except Exception:
        sm = col
    margin = max(4, int(0.08 * w_roi))
    valleys = []
    for x in range(margin, w_roi - margin):
        if sm[x] <= sm[x - 1] and sm[x] <= sm[x + 1]:
            # Require a real notch vs local shoulders.
            left = float(sm[max(0, x - 6):x].max()) if x > 0 else sm[x]
            right = float(sm[x + 1:min(w_roi, x + 7)].max()) if x + 1 < w_roi else sm[x]
            depth = min(left, right) - float(sm[x])
            if depth >= 4.0:
                valleys.append((depth, x))
    valleys.sort(reverse=True)
    seeds = []
    thr = max(3.0, float(lucency_thr) * 0.45)
    focuses = [
        junction - sign * crown_h * 0.10,
        junction,
        junction + sign * crown_h * 0.28,
    ]
    band_half = max(5, int(0.18 * crown_h))
    col_w = max(5, int(0.10 * w_roi))
    used_x = []
    for depth, vx in valleys[:4]:
        if any(abs(vx - ux) < col_w for ux in used_x):
            continue
        used_x.append(vx)
        x0 = int(np.clip(vx - col_w // 2, 0, w_roi - col_w))
        mid0 = w_roi // 3
        mid1 = 2 * w_roi // 3
        for focus_y in focuses:
            local_y = int(np.clip(focus_y - y1, band_half, h_roi - band_half - 1))
            strip = eq[local_y - band_half:local_y + band_half, x0:x0 + col_w]
            mid = eq[local_y - band_half:local_y + band_half, mid0:mid1]
            if strip.size < 8 or mid.size < 8:
                continue
            mid_mean = float(mid.mean())
            tissue_floor = mid_mean - 55.0
            sub = _best_tissue_lucency_window(
                strip, mid_mean, tissue_floor, min_w=3, min_h=3
            )
            if sub is None:
                continue
            sx, sy, sw, sh = sub
            core = strip[sy:sy + sh, sx:sx + sw]
            delta = mid_mean - float(core.mean())
            if delta < thr or delta > 55.0:
                continue
            score = float(min(0.88, 0.55 + delta / 40.0 + min(0.08, depth / 40.0)))
            cand = {
                "box": {
                    "x": float(x1 + x0 + sx),
                    "y": float(y1 + local_y - band_half + sy),
                    "w": float(sw),
                    "h": float(sh),
                },
                "score": score,
                "polygon": None,
                "stage": None,
                "prefer_surface": "interproximal",
                "interproximal_seed": True,
                "edj_seed": True,
                "junction_seed": True,
            }
            cand["core_box"] = dict(cand["box"])
            seeds.append(cand)
            break
    return seeds


def _facing_junction_seeds(gray, teeth, lucency_thr):
    """
    Seed the contact face between neighbouring same-arch teeth.

    Uses the gap midpoint (or overlap midline) so classic mesial/distal EDJ
    wedges are proposed even when one tooth box swallowed the contact.
    """
    try:
        import cv2
    except Exception:
        return []
    h, w = gray.shape[:2]
    by_arch = {"upper": [], "lower": []}
    for t in teeth or []:
        if t.get("box") and t.get("arch") in by_arch:
            by_arch[t["arch"]].append(t)
    seeds = []
    thr = max(3.0, float(lucency_thr) * 0.45)
    u8 = np.clip(gray, 0, 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
    eq_full = clahe.apply(u8)

    for arch, group in by_arch.items():
        ordered = sorted(group, key=lambda t: t["box"]["x"] + t["box"]["w"] * 0.5)
        for i in range(len(ordered) - 1):
            a, b = ordered[i], ordered[i + 1]
            ab, bb = a["box"], b["box"]
            # Contact x: midpoint of the facing edges (handles overlap).
            a_right = ab["x"] + ab["w"]
            b_left = bb["x"]
            contact_x = 0.5 * (a_right + b_left)
            if abs(a_right - b_left) > max(ab["w"], bb["w"]) * 0.55:
                continue  # too far apart — not a contact
            # Anchor geometry on the tooth that owns more of the contact.
            tooth = a if abs(a_right - contact_x) <= abs(b_left - contact_x) else b
            box = tooth["box"]
            sign = geometry.crown_edge_sign(arch)
            crown_h = box["h"] * caries_refine.CROWN_RATIO
            junction = caries_refine.edj_y(tooth)
            if junction is None:
                continue
            col_w = max(5, int(0.12 * min(ab["w"], bb["w"])))
            x0 = int(np.clip(contact_x - col_w * 0.5, 0, w - col_w))
            focuses = [
                junction - sign * crown_h * 0.12,
                junction,
                junction + sign * crown_h * 0.25,
                junction + sign * crown_h * 0.42,
            ]
            band_half = max(5, int(0.18 * crown_h))
            mid_x0 = int(box["x"] + box["w"] * 0.35)
            mid_x1 = int(box["x"] + box["w"] * 0.65)
            mid_x0 = max(0, min(w - 1, mid_x0))
            mid_x1 = max(mid_x0 + 1, min(w, mid_x1))
            best = None
            for focus_y in focuses:
                cy = int(np.clip(focus_y, band_half, h - band_half - 1))
                strip = eq_full[cy - band_half:cy + band_half, x0:x0 + col_w]
                mid = eq_full[cy - band_half:cy + band_half, mid_x0:mid_x1]
                if strip.size < 8 or mid.size < 8:
                    continue
                mid_mean = float(mid.mean())
                sub = _best_tissue_lucency_window(
                    strip, mid_mean, mid_mean - 55.0, min_w=3, min_h=3
                )
                if sub is None:
                    continue
                sx, sy, sw, sh = sub
                core = strip[sy:sy + sh, sx:sx + sw]
                delta = mid_mean - float(core.mean())
                if delta < thr or delta > 55.0:
                    continue
                score = float(min(0.90, 0.58 + delta / 38.0))
                cand = {
                    "box": {
                        "x": float(x0 + sx),
                        "y": float(cy - band_half + sy),
                        "w": float(sw),
                        "h": float(sh),
                    },
                    "score": score,
                    "polygon": None,
                    "stage": None,
                    "prefer_surface": "interproximal",
                    "interproximal_seed": True,
                    "edj_seed": True,
                    "junction_seed": True,
                }
                cand["core_box"] = dict(cand["box"])
                if best is None or score > best["score"]:
                    best = cand
            if best is not None:
                seeds.append(best)
    return seeds
