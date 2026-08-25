"""
The reasoning layer — precision over a candidate list.

Each public function is one "skill". `screen` runs them in order and returns
the surviving lesions with a calibrated confidence, a severity, and a full
audit trail (which zone, which evidence, which vetoes fired) so a reviewer can
see *why* something was surfaced or dropped.

Coordinates are absolute pixels throughout; pipeline.py normalizes on the way
out. A "candidate" is a dict:

    {"box": {x,y,w,h}, "score": float, "polygon": [[x,y]...]|None,
     "stage": int|None}   # stage: 0 sound,1 enamel,2 outer-dentin,3 inner-dentin

The staging convention matches the ACTA-Bw25-RefStd reference set, so a model
trained against it can pass depth straight through.
"""

import logging
import math

import numpy as np

from models import caries_refine, geometry

log = logging.getLogger("xray-ai.caries.reasoning")


class ReasoningConfig:
    """
    Thresholds for the reasoning layer.

    Target: classic interproximal enamel→dentin (EDJ) crossing caries.
    CEJ / bone-crest geometry belongs to bone-loss assessment, not this layer.
    Hard-veto empty interdental gap, alveolar bone, and pulp chamber.
    """

    # Fraction of a candidate that must lie inside some tooth box to be
    # considered "on a tooth" at all.
    min_tooth_containment = 0.50

    # Central pulp/canal column: even partial overlap is usually anatomy.
    pulp_veto_overlap = 0.35

    # How far apical of the geometric EDJ (in crown-height units, beyond the
    # outer-dentin span) a contact candidate may sit before it is treated as
    # deep root / bone. Caries gates on EDJ — not on the bone-loss CEJ.
    max_apical_of_edj_frac = 0.55

    # Outer mesiodistal rim treated as empty interdental space, not tissue.
    # Keep thin: true proximal lesions sit close to the contact surface.
    gap_edge_frac = 0.03
    # Contact-dentin column: inset from the outer edge, still on the side.
    # Wider inner bound so fused bitewing boxes still treat mid-contacts
    # as interproximal (not pulp) when they sit under a real contact.
    contact_inset_frac = 0.04
    contact_inner_frac = 0.42

    # Contrast: lesion must be at least this many grey levels darker than the
    # sound-tissue ring around it (0..255 scale). Subtle early contacts ~4–12.
    min_ring_contrast = 6.0
    # EDJ contact seeds may be fainter on bitewings — slightly softer floor.
    min_ring_contrast_edj = 4.0
    # Ring contrast that counts as "full" evidence when normalising to 0..1.
    ring_contrast_full = 36.0
    # Upper darkness vs local tooth: emptier than this → gap/air/bone, not caries.
    max_ring_contrast = 65.0

    # Margin sharpness: caries margins are diffuse-to-moderate. A margin much
    # sharper than this (relative to its own contrast) reads as a man-made edge
    # (restoration/filling) rather than demineralisation.
    max_margin_sharpness = 3.5

    # Pathology relay.
    restoration_overlap_veto = 0.55   # candidate ~is a restoration → drop
    restoration_adjacency_penalty = 0.25  # peri-restoration lucency → down-weight
    restoration_adjacency_px_frac = 0.06  # "adjacent" = within this frac of image diag
    burnout_width_frac = 0.55         # wide soft cervical bands → burnout
    machband_thinness = 0.14          # band thinner than this frac of tooth h

    # Calibration.
    confidence_ceiling = 0.85         # a screening aid never claims near-certainty
    accept_threshold = 0.18
    model_score_weight = 0.55
    classical_gain = 0.78
    classical_ceiling = 0.72

    # Primary target: classic enamel→dentin (EDJ) crossing caries.
    # Require BOTH enamel and dentin involvement — geometry alone is not enough.
    interproximal_min_dentin_pct = 15
    interproximal_min_enamel_pct = 12
    # Confidence bump when refine shows enamel+dentin (EDJ crossing).
    edj_crossing_boost = 0.26
    # Extra bump when two EDJ hits face each other across one contact.
    facing_pair_boost = 0.16
    edj_min_dentin_pct = 15
    edj_min_enamel_pct = 12
    # Geometric EDJ span can support a hit only when some enamel share exists.
    allow_geometric_edj_span = True

    # Classical proposer — contact-dentin search (sensitive to subtle contacts).
    classical_lucency_thresh = 7
    classical_min_area_frac = 0.003
    classical_max_area_frac = 0.22

    # Anatomical priors — contact dentin first.
    surface_prior = {
        "interproximal": 1.00,
        "occlusal": 0.65,
        "cervical": 0.45,
        "root": 0.30,
        "smooth": 0.40,
    }

    @classmethod
    def from_service_config(cls, conf_mod=None):
        """Overlay env-driven knobs from xray-ai-service config.py when present."""
        cfg = cls()
        try:
            conf_mod = conf_mod or __import__("config")
            if hasattr(conf_mod, "CARIES_ACCEPT_THRESHOLD"):
                cfg.accept_threshold = float(conf_mod.CARIES_ACCEPT_THRESHOLD)
        except Exception:
            pass
        return cfg


# ── skill 1: anatomical correction ─────────────────────────────────
def locate(candidate, teeth, cfg):
    """
    Anchor a candidate to a tooth and name the surface it sits on.

    Returns (tooth|None, surface_name, veto_reason|None). A veto means the
    candidate is anatomy or off-tooth and must not be surfaced.
    """
    box = candidate["box"]
    if not teeth:
        # No tooth context: we cannot anatomically reason, so we cannot screen.
        # Better to withhold than to assert a lesion we can't localise.
        return None, "smooth", "no_tooth_context"

    tooth = geometry.find_enclosing_tooth(box, teeth)
    if tooth is None:
        return None, "smooth", "no_enclosing_tooth"

    contain = geometry.containment(box, tooth["box"])
    if contain < cfg.min_tooth_containment:
        return tooth, "smooth", "off_tooth"

    arch = tooth.get("arch")
    if arch not in ("upper", "lower"):
        return tooth, "smooth", None  # keep, but no surface-specific prior

    tb = tooth["box"]
    cx, cy = geometry.box_center(box)
    rel_x = (cx - tb["x"]) / max(tb["w"], 1e-6)

    # Empty interdental gap: centre in the outermost rim of the tooth box.
    # Contact / EDJ seeds are allowed on the rim — classic wedges sit on the
    # proximal face; empty-gap FPs are caught by ring-contrast instead.
    is_contact_seed = bool(
        candidate.get("prefer_surface") == "interproximal"
        or candidate.get("interproximal_seed")
        or candidate.get("edj_seed")
        or candidate.get("junction_seed")
    )
    if (
        not is_contact_seed
        and (rel_x < cfg.gap_edge_frac or rel_x > (1.0 - cfg.gap_edge_frac))
    ):
        return tooth, "smooth", "interdental_gap"

    # Pulp column veto: the central chamber/canal is a normal radiolucency.
    # Skip for tagged contact-junction seeds (true contacts can sit mid-box
    # when tooth segmentation fused neighbours). Prefer the darkened-core
    # pulp mask (real image evidence) over the crude geometric rectangle,
    # which can badly over-claim on tall tooth boxes (e.g. molars) where
    # CROWN_RATIO under/over-estimates crown height.
    if not candidate.get("junction_seed"):
        mask_pulp = _mask_pulp_overlap(box, candidate.get("polygon"), tooth)
        if mask_pulp is not None:
            if mask_pulp >= cfg.pulp_veto_overlap:
                return tooth, "pulp", "pulp_chamber"
        else:
            pulp_zone = _pulp_zone(tooth, arch)
            if pulp_zone is not None and geometry.containment(box, pulp_zone) >= cfg.pulp_veto_overlap:
                return tooth, "pulp", "pulp_chamber"
            if pulp_zone is not None and geometry.point_in_box(cx, cy, pulp_zone):
                return tooth, "pulp", "pulp_chamber"

    apex = geometry.apex_y(tooth, arch)
    edge = geometry.crown_edge_y(tooth, arch)
    if arch == "upper" and cy < apex - tb["h"] * 0.05:
        return tooth, "root", "beyond_apex"
    if arch == "lower" and cy > apex + tb["h"] * 0.05:
        return tooth, "root", "beyond_apex"

    crown_h = tb["h"] * caries_refine.CROWN_RATIO
    sign = geometry.crown_edge_sign(arch)
    junction = caries_refine.edj_y(tooth)
    dentin_span = crown_h * (1.0 - caries_refine.ENAMEL_BAND_RATIO)
    apical_of_edj = (cy - junction) * sign if junction is not None else 0.0
    # Deep root/bone relative to EDJ (caries landmark), not bone-loss CEJ.
    if junction is not None and crown_h > 1e-6:
        if apical_of_edj > dentin_span + crown_h * cfg.max_apical_of_edj_frac:
            return tooth, "root", "deep_root_or_bone"

    # Contact-dentin column (inset from gap, not pulp).
    in_contact_col = (
        cfg.contact_inset_frac <= rel_x <= cfg.contact_inner_frac
        or (1.0 - cfg.contact_inner_frac) <= rel_x <= (1.0 - cfg.contact_inset_frac)
    )
    # Classic contact caries: enamel side of EDJ → outer dentin (EDJ crossing).
    in_contact_dentin = (
        junction is not None
        and apical_of_edj >= -crown_h * 0.45
        and apical_of_edj <= dentin_span + crown_h * cfg.max_apical_of_edj_frac
    )

    prefer = candidate.get("prefer_surface")
    # Junction seeds sit on a detected contact face (possibly mid-fused-box).
    junction_ok = bool(candidate.get("junction_seed") and in_contact_dentin)
    if (
        prefer == "interproximal"
        or candidate.get("interproximal_seed")
        or candidate.get("edj_seed")
    ):
        if (in_contact_col and in_contact_dentin) or junction_ok:
            return tooth, "interproximal", None
        if not in_contact_col and not candidate.get("junction_seed"):
            return tooth, "smooth", "interdental_gap"
        if not in_contact_dentin:
            return tooth, "root", "deep_root_or_bone"

    if prefer == "cervical" or candidate.get("cej_seed"):
        # Secondary cervical path (not the primary EDJ caries target).
        crown_end = edge + sign * crown_h
        if abs(cy - crown_end) <= crown_h * 0.30 and in_contact_col:
            return tooth, "cervical", None
        return tooth, "cervical", "deep_root_or_bone"

    dist_from_edge = abs(cy - edge)
    crown_end = edge + sign * crown_h
    cervical_dist = abs(cy - crown_end)

    if in_contact_col and in_contact_dentin:
        surface = "interproximal"
    elif dist_from_edge <= crown_h * 0.40 and not in_contact_col:
        surface = "occlusal"
    elif in_contact_col and cervical_dist <= crown_h * 0.30:
        surface = "cervical"
    else:
        if apical_of_edj > dentin_span + crown_h * cfg.max_apical_of_edj_frac:
            return tooth, "root", "deep_root_or_bone"
        surface = "smooth"
    return tooth, surface, None


# ── skill 2: contrast assessment ───────────────────────────────────
def contrast_evidence(gray, candidate, tooth, cfg):
    """
    Quantify radiolucency against the SAME tooth's sound tissue.

    Returns (score_0_1, ring_contrast, sharpness, veto_reason|None). Absolute
    darkness is deliberately not used: a correctly-exposed molar is darker than
    a thin incisor, so the only meaningful comparison is local.
    """
    box = candidate.get("core_box") or candidate["box"]
    pad = max(4.0, min(box["w"], box["h"]) * 0.6)
    ring = _ring_contrast(gray, box, pad)
    floor = cfg.min_ring_contrast
    if (
        candidate.get("edj_seed")
        or candidate.get("interproximal_seed")
        or candidate.get("junction_seed")
    ):
        floor = min(floor, cfg.min_ring_contrast_edj)
    if ring < floor:
        return 0.0, ring, 0.0, "low_contrast"
    # Very deep lucency vs local tooth usually means empty gap / bone, not caries.
    if ring > cfg.max_ring_contrast:
        return 0.0, ring, 0.0, "interdental_gap"

    sharpness = _margin_sharpness(gray, box, ring)
    if sharpness > cfg.max_margin_sharpness:
        # A near-step edge relative to its contrast is man-made, not carious.
        return 0.0, ring, sharpness, "hard_edge"

    score = geometry.clamp(ring / cfg.ring_contrast_full, 0.0, 1.0)
    return score, ring, sharpness, None


# ── skill 3: pathology relay ───────────────────────────────────────
def relay(candidate, tooth, surface, restorations, gray, sharpness, cfg, img_diag):
    """
    Screen against known false-positive sources.

    Returns (penalty_0_1, flags, veto_reason|None). A veto drops the candidate;
    a penalty survives but lowers confidence and is recorded in `flags`.
    """
    box = candidate["box"]
    flags = []
    penalty = 0.0

    # Restoration relay. Restorations are the class the condition model detects
    # WELL (mAP ~0.7), so this relay is trustworthy input, unlike its caries head.
    for r in restorations or []:
        overlap = geometry.containment(box, r)
        if overlap >= cfg.restoration_overlap_veto:
            # The candidate essentially *is* the restoration (or its radiolucent
            # base liner) — not primary caries.
            return 1.0, ["is_restoration"], "restoration"
        if _adjacent(box, r, img_diag * cfg.restoration_adjacency_px_frac):
            # A lucency hugging a filling margin is most often the classic
            # peri-restoration artifact; recurrent caries is possible but must
            # clear a higher bar, so down-weight and flag for the clinician.
            penalty = max(penalty, cfg.restoration_adjacency_penalty)
            flags.append("near_restoration")

    # Cervical burnout: a diffuse radiolucent band at the cervical region that
    # runs across most of the tooth width. Its own dedicated studies treat it as
    # a distinct class precisely because it mimics cervical caries.
    if tooth is not None and surface in ("cervical", "root"):
        tw = tooth["box"]["w"]
        if box["w"] >= tw * cfg.burnout_width_frac and sharpness < cfg.max_margin_sharpness * 0.6:
            return 1.0, ["cervical_burnout"], "cervical_burnout"

    # Mach band: a thin bright/dark band along a junction (enamel-dentin or a
    # restoration edge) is an optical artifact, not a lesion.
    if tooth is not None:
        th = tooth["box"]["h"]
        if box["h"] < th * cfg.machband_thinness and box["w"] > box["h"] * 4:
            return 1.0, ["mach_band"], "mach_band"

    return penalty, flags, None


# ── skill 4: calibration ───────────────────────────────────────────
def calibrate(model_score, prior, contrast_score, penalty, cfg, has_model):
    """
    Fuse the evidence into a single confidence in [0, ceiling].

    With a trained model, its (uncalibrated) score is blended with the
    reasoning evidence; the reasoning layer can only ever *lower* the result,
    never invent certainty. Without a model, confidence rests on evidence alone
    and is held further below the ceiling because recall is unknown.
    """
    evidence = prior * contrast_score
    if has_model:
        base = cfg.model_score_weight * float(model_score) + (1.0 - cfg.model_score_weight) * evidence
        cap = cfg.confidence_ceiling
    else:
        # Classical-only: no trained likelihood, unknown recall. Rest on
        # evidence alone and hold the whole path below the model's band so the
        # slider and the clinician can tell the two apart.
        base = cfg.classical_gain * evidence
        cap = min(cfg.confidence_ceiling, cfg.classical_ceiling)
    conf = base * (1.0 - penalty)
    return geometry.clamp(conf, 0.0, cap)


def severity(candidate, refinement):
    """
    caries_incipient vs caries_progressed.

    Prefer the model's ACTA-style stage when present (1 = enamel → incipient,
    2/3 = dentin → progressed); otherwise fall back to the enamel/dentin depth
    from the classical refinement.
    """
    stage = candidate.get("stage")
    if stage is not None:
        return "caries_progressed" if int(stage) >= 2 else "caries_incipient"
    return "caries_progressed" if caries_refine.is_progressed(refinement) else "caries_incipient"


# ── orchestration ──────────────────────────────────────────────────
def screen(
    gray,
    candidates,
    teeth,
    restorations,
    cfg=None,
    has_model=False,
    anatomy_hard_gate=None,
):
    """
    Run all skills over every candidate and return surfaced lesions.

    Each result carries an `audit` dict so the decision is fully explainable.
    When anatomy_hard_gate is True, interproximal candidates must also pass
    the EDJ anatomy accept() filter (bone / gap / pulp excluded).
    """
    cfg = cfg or ReasoningConfig.from_service_config()
    if anatomy_hard_gate is None:
        try:
            import config as conf_mod
            anatomy_hard_gate = bool(getattr(conf_mod, "CARIES_ANATOMY_HARD_GATE", True))
        except Exception:
            anatomy_hard_gate = True
    h, w = gray.shape[:2]
    img_diag = math.hypot(w, h)
    out = []

    # Ensure anatomy masks exist when hard-gating (idempotent).
    if anatomy_hard_gate:
        try:
            from . import edj_anatomy
            edj_anatomy.prepare_teeth(gray, teeth)
        except Exception as exc:
            log.debug("anatomy prepare skipped: %s", exc)

    for cand in candidates:
        audit = {"vetoes": [], "flags": []}
        # Per-candidate: classical proposals in a union must not inherit the
        # trained-model calibration path just because a model also ran.
        cand_from_model = bool(cand.get("from_model", has_model))

        tooth, surface, veto = locate(cand, teeth, cfg)
        if veto:
            audit["vetoes"].append(veto)
            log.debug("caries candidate vetoed at locate: %s", veto)
            continue

        # Hard EDJ-anatomy gate for interproximal (wrap-around filter).
        if anatomy_hard_gate and surface == "interproximal" and tooth is not None:
            try:
                from . import edj_anatomy
                ok, reason, meta = edj_anatomy.accept(cand, tooth, gray)
            except Exception as exc:
                log.debug("anatomy accept failed: %s", exc)
                ok, reason, meta = True, None, {}
            if not ok:
                audit["vetoes"].append("anatomy_" + (reason or "reject"))
                continue
            if meta.get("shape"):
                audit["flags"].append("shape_" + str(meta["shape"]))
            if meta.get("edj_crossing"):
                audit["flags"].append("anatomy_edj")
            # Prefer anatomy E/D when refine later under-reports.
            if meta.get("enamel_pct") is not None:
                cand.setdefault("anatomy_enamel_pct", meta["enamel_pct"])
                cand.setdefault("anatomy_dentin_pct", meta["dentin_pct"])
            if meta.get("shape"):
                cand.setdefault("shape", meta["shape"])

        c_score, ring, sharp, veto = contrast_evidence(gray, cand, tooth, cfg)
        if veto:
            audit["vetoes"].append(veto)
            continue

        penalty, flags, veto = relay(
            cand, tooth, surface, restorations, gray, sharp, cfg, img_diag
        )
        if veto:
            audit["vetoes"].append(veto)
            continue
        audit["flags"].extend(flags)

        # Refine from the tight dark core (seed-anchored). Expand across EDJ
        # only for E%/D% measurement — not as the Otsu search window.
        core_box = dict(cand.get("core_box") or cand["box"])
        refine_box = dict(core_box)
        if surface == "interproximal" and tooth is not None:
            refine_box = caries_refine.expand_box_across_edj(core_box, tooth)
        refinement = caries_refine.refine_caries(
            gray,
            core_box,
            tooth,
            surface=surface,
            seed_polygon=cand.get("polygon"),
        )
        # Prefer local refine polygons for contact / EDJ surfaces.
        use_refine_poly = (
            surface in ("cervical", "root", "interproximal")
            and refinement.get("polygon")
        )
        if use_refine_poly:
            polygon = refinement["polygon"]
            tight_box = caries_refine.bounds_of_polygon(polygon)
        else:
            polygon = cand.get("polygon") or refinement.get("polygon")
            tight_box = dict(cand["box"])
            if polygon and surface == "interproximal":
                tight_box = caries_refine.bounds_of_polygon(polygon)

        post_veto = _post_refine_anatomy_veto(tight_box, tooth, cfg, polygon=polygon)
        if post_veto:
            audit["vetoes"].append(post_veto)
            continue

        enamel_pct = refinement.get("enamel_pct")
        dentin_pct = refinement.get("dentin_pct")
        # For EDJ-crossing decisions, prefer fractions on the EDJ-spanning
        # refine box — Otsu polygons often sit only in the dentin half of the
        # wedge and under-report enamel.
        if tooth is not None and surface == "interproximal":
            box_e, box_d = caries_refine.enamel_dentin_fractions(tooth, refine_box)
            if box_e is not None and box_d is not None:
                if enamel_pct is None or (
                    box_e >= cfg.edj_min_enamel_pct
                    and box_d >= cfg.edj_min_dentin_pct
                    and (enamel_pct < cfg.edj_min_enamel_pct or dentin_pct is None
                         or dentin_pct < cfg.edj_min_dentin_pct)
                ):
                    enamel_pct, dentin_pct = box_e, box_d
        if enamel_pct is None and tooth is not None:
            enamel_pct, dentin_pct = caries_refine.enamel_dentin_fractions(
                tooth, tight_box
            )
        if (
            cand.get("anatomy_enamel_pct") is not None
            and (
                enamel_pct is None
                or enamel_pct < cfg.edj_min_enamel_pct
                or dentin_pct is None
                or dentin_pct < cfg.edj_min_dentin_pct
            )
        ):
            enamel_pct = cand.get("anatomy_enamel_pct", enamel_pct)
            dentin_pct = cand.get("anatomy_dentin_pct", dentin_pct)
        geo_edj = bool(tooth and (
            _spans_edj(tight_box, tooth) or _spans_edj(refine_box, tooth)
        ))
        # True EDJ crossing = enamel AND dentin shares (the classic wedge).
        tissue_edj = (
            enamel_pct is not None
            and dentin_pct is not None
            and enamel_pct >= cfg.edj_min_enamel_pct
            and dentin_pct >= cfg.edj_min_dentin_pct
        )
        # Geometry may rescue a near-miss only if enamel is at least detectable.
        geo_rescue = (
            cfg.allow_geometric_edj_span
            and geo_edj
            and enamel_pct is not None
            and enamel_pct >= max(5, cfg.edj_min_enamel_pct // 2)
            and dentin_pct is not None
            and dentin_pct >= cfg.interproximal_min_dentin_pct
        )
        edj_crossing = (
            tissue_edj
            or geo_rescue
            or bool(cand.get("edj_crossing") and cand.get("anatomy_seed"))
        )

        # Primary target gate: enamel→dentin crossing at the contact.
        if surface == "interproximal":
            if not edj_crossing:
                audit["vetoes"].append("not_edj_crossing")
                continue
            _, _, zone_veto = locate(
                {"box": tight_box, "prefer_surface": "interproximal"},
                teeth,
                cfg,
            )
            if zone_veto:
                audit["vetoes"].append(zone_veto)
                continue

        prior = cfg.surface_prior.get(surface, 0.6)
        if cand.get("interproximal_seed") or cand.get("edj_seed"):
            prior = min(1.0, prior + 0.08)
        conf = calibrate(
            cand.get("score", 0.0), prior, c_score, penalty, cfg, cand_from_model
        )
        if edj_crossing and surface == "interproximal":
            conf = geometry.clamp(
                conf + cfg.edj_crossing_boost, 0.0, cfg.confidence_ceiling
            )
            audit["flags"].append("edj_crossing")
            if geo_edj:
                audit["flags"].append("spans_edj")
            # Progressed dentin involvement (classic deep EDJ wedge) shortlists up.
            if dentin_pct is not None and dentin_pct >= 55:
                conf = geometry.clamp(conf + 0.08, 0.0, cfg.confidence_ceiling)
                audit["flags"].append("deep_dentin_edj")
        # Facing-contact junction: boost real contacts, soft-penalise lone
        # proximal hits so marked contact lesions shortlist cleanly.
        jboost = _contact_junction_boost(tight_box, teeth, cfg)
        if surface == "interproximal":
            if jboost > 0:
                conf = geometry.clamp(conf + jboost, 0.0, cfg.confidence_ceiling)
                audit["flags"].append("facing_contact")
            elif not edj_crossing:
                conf *= 0.72
                audit["flags"].append("no_facing_contact")
            else:
                conf *= 0.90
                audit["flags"].append("no_facing_contact")
        if conf < cfg.accept_threshold:
            audit["vetoes"].append("below_accept_threshold")
            continue

        finding = {
            "type": severity(cand, refinement),
            "box": tight_box,
            "confidence": round(conf, 3),
            "surface": surface,
            "source": "cs-caries-workflow",
            "screening": True,
            "proposer": "model" if cand_from_model else "classical",
        }
        if polygon:
            finding["polygon"] = polygon
        if enamel_pct is not None:
            finding["enamel_pct"] = enamel_pct
            finding["dentin_pct"] = dentin_pct
        if edj_crossing:
            finding["edj_crossing"] = True
        if refinement.get("refine_mode"):
            audit["refine_mode"] = refinement["refine_mode"]
        if tooth is not None and tooth.get("fdi") is not None:
            finding["tooth"] = tooth["fdi"]
        if flags:
            finding["relay_flags"] = flags
        if "edj_crossing" in audit["flags"]:
            finding.setdefault("relay_flags", [])
            if "edj_crossing" not in finding["relay_flags"]:
                finding["relay_flags"].append("edj_crossing")
        audit["surface"] = surface
        audit["ring_contrast"] = round(ring, 2)
        audit["margin_sharpness"] = round(sharp, 2)
        audit["penalty"] = round(penalty, 3)
        finding["audit"] = audit
        out.append(finding)

    # Facing EDJ pair: classic bitewing pattern (distal of one + mesial of the
    # neighbour). Boost both so they shortlist together.
    _boost_facing_edj_pairs(out, cfg)

    # Two skills can localise overlapping candidates to the same lesion; keep
    # the most confident.
    return _dedupe(out)


# ── helpers ────────────────────────────────────────────────────────
def _boost_facing_edj_pairs(findings, cfg):
    """Raise confidence when two EDJ lesions sit on opposite sides of a contact."""
    boost = float(getattr(cfg, "facing_pair_boost", 0.12))
    if boost <= 0 or len(findings) < 2:
        return
    edj = [
        f for f in findings
        if f.get("edj_crossing") and f.get("surface") == "interproximal" and f.get("box")
    ]
    pairs = []
    for i, a in enumerate(edj):
        ab = a["box"]
        acx, acy = geometry.box_center(ab)
        for j in range(i + 1, len(edj)):
            bb = edj[j]["box"]
            bcx, bcy = geometry.box_center(bb)
            dx = abs(acx - bcx)
            dy = abs(acy - bcy)
            # Same-arch neighbour contact only (tight y, contact-scale x gap).
            if dy > 36:
                continue
            if dx < 28 or dx > 95:
                continue
            # Prefer vertically aligned contacts (classic facing EDJ pair).
            pairs.append((dy + dx * 0.15, i, j))
    pairs.sort()
    used = set()
    for _, i, j in pairs:
        if i in used or j in used:
            continue
        used.add(i)
        used.add(j)
        for f in (edj[i], edj[j]):
            f["confidence"] = round(
                geometry.clamp(float(f["confidence"]) + boost, 0.0, cfg.confidence_ceiling),
                3,
            )
            flags = f.setdefault("relay_flags", [])
            if "facing_edj_pair" not in flags:
                flags.append("facing_edj_pair")
            audit = f.setdefault("audit", {})
            aflags = audit.setdefault("flags", [])
            if "facing_edj_pair" not in aflags:
                aflags.append("facing_edj_pair")


def _spans_edj(box, tooth):
    """True when the lesion box crosses the geometric enamel–dentin junction."""
    tb = tooth.get("box")
    junction = caries_refine.edj_y(tooth)
    if not box or not tb or junction is None:
        return False
    crown_h = tb["h"] * caries_refine.CROWN_RATIO
    y1, y2 = box["y"], box["y"] + box["h"]
    # Require the EDJ line to fall inside the box (with a small tolerance).
    tol = max(2.0, crown_h * 0.06)
    return (y1 - tol) <= junction <= (y2 + tol)


def _contact_junction_boost(box, teeth, cfg):
    """
    Extra confidence when a lesion sits at a facing interdental contact.

    Returns 0..~0.18. Clinical contact caries is almost always at these
    junctions; boosting them is what lets the marked bitewing lesion shortlist.
    """
    if not box or not teeth:
        return 0.0
    cx, cy = geometry.box_center(box)
    best = 0.0
    by_arch = {"upper": [], "lower": []}
    for t in teeth:
        if t.get("box") and t.get("arch") in by_arch:
            by_arch[t["arch"]].append(t)
    for group in by_arch.values():
        ordered = sorted(group, key=lambda t: t["box"]["x"] + t["box"]["w"] * 0.5)
        for i in range(len(ordered) - 1):
            a, b = ordered[i], ordered[i + 1]
            ab, bb = a["box"], b["box"]
            # Contact x ≈ meeting of distal a / mesial b (allow small gap/overlap).
            contact_x = 0.5 * ((ab["x"] + ab["w"]) + bb["x"])
            # Vertical: EDJ ± outer-dentin band of the shorter crown.
            arch = a.get("arch")
            if arch not in ("upper", "lower"):
                continue
            crown_h = min(ab["h"], bb["h"]) * caries_refine.CROWN_RATIO
            sign = geometry.crown_edge_sign(arch)
            # Union of both teeth's EDJ contact bands (bitewing contacts are
            # often vertically offset between neighbours).
            bands = []
            for t in (a, b):
                j = caries_refine.edj_y(t)
                if j is None:
                    continue
                half = crown_h * 0.55
                bands.append((j - half, j + half))
            if not bands:
                continue
            y_lo = min(b[0] for b in bands) - crown_h * 0.15
            y_hi = max(b[1] for b in bands) + crown_h * 0.20
            dx = abs(cx - contact_x) / max(0.5 * (ab["w"] + bb["w"]), 1e-6)
            if cy < y_lo or cy > y_hi:
                continue
            if dx > 0.35:
                continue
            # Closer to the junction → stronger boost.
            boost = 0.20 * (1.0 - dx / 0.35)
            best = max(best, boost)
    return best


def _post_refine_anatomy_veto(box, tooth, cfg, polygon=None):
    """Drop refined outlines that drifted into pulp or deep bone."""
    if not tooth or not box:
        return None
    arch = tooth.get("arch")
    if arch not in ("upper", "lower"):
        return None
    cx, cy = geometry.box_center(box)
    # Prefer the darkened-core pulp mask (real image evidence) over the crude
    # geometric pulp rectangle, which can badly over-claim on tall tooth boxes
    # (e.g. molars) where CROWN_RATIO under/over-estimates crown height.
    mask_pulp = _mask_pulp_overlap(box, polygon, tooth)
    if mask_pulp is not None:
        if mask_pulp >= cfg.pulp_veto_overlap:
            return "pulp_after_refine"
    else:
        pulp_zone = _pulp_zone(tooth, arch)
        if pulp_zone is not None:
            if geometry.containment(box, pulp_zone) >= cfg.pulp_veto_overlap:
                return "pulp_after_refine"
            if geometry.point_in_box(cx, cy, pulp_zone):
                return "pulp_after_refine"
    junction = caries_refine.edj_y(tooth)
    crown_h = tooth["box"]["h"] * caries_refine.CROWN_RATIO
    sign = geometry.crown_edge_sign(arch)
    dentin_span = crown_h * (1.0 - caries_refine.ENAMEL_BAND_RATIO)
    if junction is not None and crown_h > 1e-6:
        apical_of_edj = (cy - junction) * sign
        if apical_of_edj > dentin_span + crown_h * cfg.max_apical_of_edj_frac:
            return "bone_after_refine"
    contain = geometry.containment(box, tooth["box"])
    if contain < cfg.min_tooth_containment:
        return "off_tooth_after_refine"
    return None


def _mask_pulp_overlap(box, polygon, tooth):
    """
    Fraction of box (or polygon, if given) inside the tooth's darkened-core
    pulp mask. Returns None when anatomy masks are unavailable so callers can
    fall back to the geometric pulp zone.
    """
    anatomy = tooth.get("anatomy") if tooth else None
    if not anatomy:
        return None
    masks = anatomy.get("masks") or {}
    pulp_m = masks.get("pulp")
    if pulp_m is None:
        return None
    try:
        from . import edj_anatomy
    except Exception:
        return None
    ox, oy = anatomy["origin"]
    h, w = pulp_m.shape[:2]
    comp = edj_anatomy._rasterize_box(box, ox, oy, w, h)
    if polygon:
        poly_m = edj_anatomy._rasterize_polygon(polygon, ox, oy, w, h)
        if poly_m is not None and np.any(poly_m):
            comp = poly_m
    area = float(np.count_nonzero(comp))
    if area < 4:
        return None
    return float(np.count_nonzero(comp & (pulp_m > 0))) / area


def _pulp_zone(tooth, arch):
    """Wider central chamber/canal column — anatomy, not caries."""
    box = tooth.get("box")
    if not box or box["h"] <= 0 or arch not in ("upper", "lower"):
        return None
    sign = geometry.crown_edge_sign(arch)
    edge = geometry.crown_edge_y(tooth, arch)
    # Start below the occlusal enamel shell; end well short of the apex tip.
    start = edge + sign * box["h"] * (caries_refine.CROWN_RATIO * 0.40)
    end = edge + sign * box["h"] * 0.90
    return {
        "x": box["x"] + box["w"] * 0.30,
        "y": min(start, end),
        "w": max(1.0, box["w"] * 0.40),
        "h": abs(end - start),
    }


def _ring_contrast(gray, box, pad):
    """Mean(surrounding ring) - mean(box). Positive => box is radiolucent."""
    h, w = gray.shape[:2]
    x1 = int(max(0, math.floor(box["x"] - pad)))
    y1 = int(max(0, math.floor(box["y"] - pad)))
    x2 = int(min(w, math.ceil(box["x"] + box["w"] + pad)))
    y2 = int(min(h, math.ceil(box["y"] + box["h"] + pad)))
    bx1 = int(max(0, math.floor(box["x"])))
    by1 = int(max(0, math.floor(box["y"])))
    bx2 = int(min(w, math.ceil(box["x"] + box["w"])))
    by2 = int(min(h, math.ceil(box["y"] + box["h"])))
    if bx2 <= bx1 or by2 <= by1 or x2 <= x1 or y2 <= y1:
        return 0.0

    outer = gray[y1:y2, x1:x2]
    inner = gray[by1:by2, bx1:bx2]
    inner_mean = float(inner.mean())
    outer_sum = float(outer.sum()) - float(inner.sum())
    outer_cnt = outer.size - inner.size
    if outer_cnt <= 0:
        return 0.0
    ring_mean = outer_sum / outer_cnt
    return ring_mean - inner_mean


def _margin_sharpness(gray, box, ring):
    """
    Ratio of the peak intensity step across the box border to the box's own
    contrast. A carious margin is gradual (low ratio); a filling edge is a step
    (high ratio). Normalised by `ring` so it measures edge *character*, not
    just magnitude.
    """
    if ring <= 1e-6:
        return 0.0
    h, w = gray.shape[:2]
    bx1 = int(max(1, math.floor(box["x"])))
    by1 = int(max(1, math.floor(box["y"])))
    bx2 = int(min(w - 1, math.ceil(box["x"] + box["w"])))
    by2 = int(min(h - 1, math.ceil(box["y"] + box["h"])))
    if bx2 <= bx1 or by2 <= by1:
        return 0.0

    steps = []
    for x in range(bx1, bx2):
        steps.append(abs(float(gray[by1, x]) - float(gray[by1 - 1, x])))
        steps.append(abs(float(gray[by2 - 1, x]) - float(gray[min(h - 1, by2), x])))
    for y in range(by1, by2):
        steps.append(abs(float(gray[y, bx1]) - float(gray[y, bx1 - 1])))
        steps.append(abs(float(gray[y, bx2 - 1]) - float(gray[y, min(w - 1, bx2)])))
    if not steps:
        return 0.0
    peak = float(np.percentile(np.asarray(steps), 90))
    return peak / abs(ring)


def _adjacent(a, b, gap):
    """True when boxes are within `gap` px of touching (or overlapping)."""
    dx = max(0.0, max(a["x"] - (b["x"] + b["w"]), b["x"] - (a["x"] + a["w"])))
    dy = max(0.0, max(a["y"] - (b["y"] + b["h"]), b["y"] - (a["y"] + a["h"])))
    return dx <= gap and dy <= gap


def _dedupe(findings, iou_thresh=0.4):
    ordered = sorted(findings, key=lambda f: f["confidence"], reverse=True)
    kept = []
    for f in ordered:
        if any(geometry.iou(f["box"], k["box"]) > iou_thresh for k in kept):
            continue
        kept.append(f)
    return kept
