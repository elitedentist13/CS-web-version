"""
Pipeline orchestration for CS X-ray Assist.

Runs the four stages and composes the exact JSON shape the browser already
consumes in app-xray-ai.js (xrayAiAnalyzeApi -> xrayAiApplyResults):

    {
      "findings": [
        {"type", "x", "y", "w", "h", "confidence",
         "polygon"?, "cej"?, "crest"?, "measurement"?,
         "enamel_pct"?, "dentin_pct"?}
      ],
      "anatomy_layers": [{"tooth", "layer", "polygon"}],
      "bone_measurements": [{"cej", "crest", "measurement_mm", "tooth", "gap"}],
      "summary": {finding_type: count},
      "model": "...", "backend": "...",
      "width": int, "height": int
    }

Coordinates are emitted normalized to 0..1 (the client also accepts pixels and
divides by width/height, but sending normalized values avoids relying on that
fallback). Confidence is deliberately NOT filtered to the display threshold
here: the browser owns an adjustable confidence slider, so the service returns
everything above config.CONFIDENCE_FLOOR and lets the UI decide what to show.
"""

import logging
import time

import numpy as np

import config
from caries import detect_caries
from models import (
    bone_loss,
    caries_refine,
    geometry,
    intraoral_layers,
    intraoral_teeth,
    modality as modality_mod,
)
from models.condition_detector import is_pathology, map_label

log = logging.getLogger("xray-ai.pipeline")

MODEL_VERSION = "cs-xray-assist-onnx-dfine-v1"

CARIES_TYPES = ("caries", "caries_incipient", "caries_progressed")


class Pipeline:
    def __init__(self, tooth_detector, condition_detector, caries_model=None):
        self.tooth_detector = tooth_detector
        self.condition_detector = condition_detector
        self.caries_model = caries_model

    def status(self):
        return {
            "tooth_detector": {
                "repo": config.TOOTH_MODEL_REPO,
                "ready": bool(self.tooth_detector and self.tooth_detector.ready),
                "error": getattr(self.tooth_detector, "load_error", None),
            },
            "condition_detector": {
                "repo": config.CONDITION_MODEL_REPO,
                "ready": bool(self.condition_detector and self.condition_detector.ready),
                "error": getattr(self.condition_detector, "load_error", None),
                "device": getattr(self.condition_detector, "device", None),
            },
            "caries_model": {
                "enabled": config.ENABLE_CARIES_SCREENING,
                "ready": bool(self.caries_model and getattr(self.caries_model, "ready", False)),
                "weights": getattr(self.caries_model, "weights_path", None),
                "error": getattr(self.caries_model, "load_error", None),
            },
        }

    def analyze(self, pil_image):
        started = time.time()
        rgb = np.asarray(pil_image.convert("RGB"))
        gray = _to_gray(rgb)
        height, width = gray.shape[:2]

        modality = modality_mod.detect_modality(width, height, gray)
        teeth, tooth_source = self._detect_teeth(rgb, gray, modality, height)

        conditions = []
        if self.condition_detector and self.condition_detector.ready:
            conditions = self.condition_detector.detect(pil_image)

        findings = []
        cond_findings = self._condition_findings(conditions, teeth, gray)

        # Caries: open for bitewing / PA; panoramic is opt-in (default off)
        # so the pano path stays focused on tooth/bone/restoration.
        run_caries = config.ENABLE_CARIES_SCREENING and (
            modality_mod.is_intraoral(modality) or config.ENABLE_CARIES_ON_PANORAMIC
        )
        caries_used_model = False
        if run_caries:
            # The general condition classifier runs at a very permissive
            # CONDITION_MIN_SCORE (advisory-only classes are meant to be
            # surfaced even when unsure). That is fine for display, but an
            # unfiltered near-zero-confidence "restoration" box can span most
            # of the frame and, if fed straight into the caries relay veto,
            # would treat the whole image as "near a restoration" and blank
            # out every caries candidate. Require real confidence and a
            # plausible (tooth-sized, not frame-sized) box before trusting a
            # restoration for that purpose.
            img_area = float(width * height) or 1.0
            restorations = [
                f["box"] for f in cond_findings
                if f["type"] == "restoration"
                and f.get("confidence", 0.0) >= config.CONFIDENCE_FLOOR
                and (f["box"]["w"] * f["box"]["h"]) <= img_area * 0.20
            ]
            cond_findings = [f for f in cond_findings if f["type"] not in CARIES_TYPES]
            caries_findings, caries_used_model = detect_caries(
                gray, rgb, teeth, restorations, model=self.caries_model
            )
            findings.extend(caries_findings)

        findings.extend(cond_findings)

        run_bone = True
        if modality_mod.is_intraoral(modality) and not config.ENABLE_INTRAORAL_BONE:
            run_bone = False
        bone_sites = []
        if run_bone:
            mean_w = (
                config.MEAN_TOOTH_WIDTH_MM
                if modality == "panoramic"
                else getattr(config, "MEAN_INTRAORAL_TOOTH_WIDTH_MM", 7.0)
            )
            bone_sites = bone_loss.estimate_bone_loss(
                teeth, gray, mean_tooth_width_mm=mean_w
            )
            findings.extend(self._bone_findings(bone_sites))

        findings = [f for f in findings if f["confidence"] >= config.CONFIDENCE_FLOOR]
        findings.sort(key=lambda f: f["confidence"], reverse=True)
        findings = findings[: config.MAX_FINDINGS]

        anatomy_layers = []
        anatomy_mode = "disabled"
        if config.EMIT_ANATOMY_LAYERS:
            anatomy_layers, anatomy_mode = self._anatomy_layers(
                teeth, width, height, gray=gray, modality=modality
            )

        response = {
            "findings": [_normalize_finding(f, width, height) for f in findings],
            "anatomy_layers": anatomy_layers,
            "bone_measurements": _normalize_bone_sites(bone_sites, width, height),
            "summary": _summarize(findings),
            "model": MODEL_VERSION,
            "backend": config.SERVICE_VERSION,
            "width": width,
            "height": height,
            "modality": modality,
            "teeth_detected": len(teeth),
            "elapsed_ms": int((time.time() - started) * 1000),
            # Machine-readable honesty flags so the UI (or an auditor) can tell
            # which outputs came from a trained model vs. a heuristic.
            "advisory": {
                "modality": modality,
                "tooth_stage": tooth_source,
                "anatomy_layers": anatomy_mode,
                "bone_loss": (
                    "geometric_heuristic"
                    if run_bone
                    else "disabled_for_intraoral"
                ),
                "caries": (
                    _caries_provenance(caries_used_model) if run_caries else "disabled_for_modality"
                ),
                "condition_classes": (
                    "research_grade_uncalibrated_pathology_enabled"
                    if config.ENABLE_PATHOLOGY_CLASSES
                    else "research_grade_pathology_withheld"
                ),
            },
        }
        log.info(
            "analyzed %dx%d %s: %d teeth (%s), %d findings, %d bone sites in %dms",
            width,
            height,
            modality,
            len(teeth),
            tooth_source,
            len(response["findings"]),
            len(response["bone_measurements"]),
            response["elapsed_ms"],
        )
        return response

    def _detect_teeth(self, rgb, gray, modality, height):
        """
        Panoramic → FDI ONNX (unchanged).
        Bitewing / PA → classical intraoral segmenter add-on.
        """
        if modality == "panoramic":
            teeth = []
            if self.tooth_detector and self.tooth_detector.ready:
                teeth = self.tooth_detector.detect(rgb)
            _annotate_arches(teeth)
            return teeth, ("pano_fdi_onnx" if teeth else "pano_fdi_onnx_empty")

        teeth = []
        source = "intraoral_none"
        if config.ENABLE_INTRAORAL_TOOTH_SEG:
            teeth = intraoral_teeth.segment(gray, modality=modality)
            if teeth:
                source = "intraoral_classical_seg"
                intraoral_teeth.annotate_arches_intraoral(teeth, modality, height)
            else:
                source = "intraoral_classical_empty"
        return teeth, source

    # ── stage composition ──────────────────────────────────────────
    def _condition_findings(self, conditions, teeth, gray):
        out = []
        for det in conditions:
            raw = det.get("raw_label")
            mapped = map_label(raw, allow_pathology=config.ENABLE_PATHOLOGY_CLASSES)
            if mapped is None:
                continue

            finding = {
                "type": mapped,
                "box": det["box"],
                "confidence": round(float(det["score"]), 3),
                "raw_label": raw,
                # Carried through so a reviewer can see how well this class
                # actually scored in the model's own evaluation.
                "class_map50_95": det.get("class_map"),
                # Marks the classes that failed their acceptance gates and whose
                # scores are uncalibrated.
                "advisory_only": is_pathology(raw),
            }

            if mapped in CARIES_TYPES:
                tooth = geometry.find_enclosing_tooth(det["box"], teeth) if teeth else None
                refinement = caries_refine.refine_caries(gray, det["box"], tooth)
                if refinement.get("polygon"):
                    finding["polygon"] = refinement["polygon"]
                if refinement.get("enamel_pct") is not None:
                    finding["enamel_pct"] = refinement["enamel_pct"]
                    finding["dentin_pct"] = refinement["dentin_pct"]
                # The model exposes a single "caries" class, so severity is
                # inferred from how far the lesion reaches into dentin.
                if mapped == "caries":
                    finding["type"] = (
                        "caries_progressed"
                        if caries_refine.is_progressed(refinement)
                        else "caries_incipient"
                    )
                if tooth is not None and tooth.get("fdi") is not None:
                    finding["tooth"] = tooth["fdi"]

            out.append(finding)
        return out

    def _bone_findings(self, bone_sites):
        out = []
        for idx, site in enumerate(bone_sites):
            out.append(
                {
                    "type": site["type"],
                    "box": site["box"],
                    "confidence": site["confidence"],
                    "cej": site["cej"],
                    "crest": site["crest"],
                    "measurement": site["measurement_mm"],
                    # Shared key with bone_measurements[].gap so the client can
                    # hide a measurement row when its finding falls below the
                    # confidence slider. Findings get reordered and capped, so
                    # array position alone is not a reliable link.
                    "gap": idx,
                }
            )
        return out

    def _anatomy_layers(self, teeth, width, height, gray=None, modality=None):
        """
        Panoramic → geometric rectangle bands (unchanged).
        Bitewing / PA → free-form contours from the tooth silhouette.
        """
        layers = []
        use_freeform = (
            modality_mod.is_intraoral(modality) and gray is not None
        )
        mode = "geometric_rectangles"
        freeform_count = 0

        if use_freeform:
            intraoral_layers.attach_silhouettes(gray, teeth)

        for tooth in teeth:
            tooth_layers = []
            if use_freeform:
                tooth_layers = intraoral_layers.layers_for_tooth(gray, tooth)
                if tooth_layers:
                    freeform_count += 1
            if not tooth_layers:
                tooth_layers = caries_refine.anatomy_layers_for_tooth(tooth)

            for layer in tooth_layers:
                layers.append(
                    {
                        "tooth": layer["tooth"],
                        "layer": layer["layer"],
                        "polygon": [
                            [round(p[0], 5), round(p[1], 5)]
                            for p in geometry.normalize_polygon(
                                layer["polygon"], width, height
                            )
                        ],
                    }
                )
            # The client keeps at most 120 layer polygons.
            if len(layers) >= 120:
                break

        if use_freeform and freeform_count:
            mode = "intraoral_freeform"
        elif use_freeform:
            mode = "geometric_rectangles_fallback"
        return layers[:120], mode


def _to_gray(rgb):
    """Luma-weighted grayscale, contrast-stretched to 0..255 float32."""
    gray = (
        rgb[:, :, 0] * 0.299 + rgb[:, :, 1] * 0.587 + rgb[:, :, 2] * 0.114
    ).astype(np.float32)
    lo = float(gray.min())
    hi = float(gray.max())
    if hi - lo < 1e-6:
        return gray
    return (gray - lo) / (hi - lo) * 255.0


def _annotate_arches(teeth):
    """
    Tag each tooth as upper/lower so crown orientation is consistent across
    stages. On a panoramic the occlusal plane runs mid-image: upper crowns point
    down, lower crowns point up.
    """
    if not teeth:
        return
    centers = [geometry.box_center(t["box"])[1] for t in teeth]
    split_y = float(np.median(centers))
    for tooth in teeth:
        cy = geometry.box_center(tooth["box"])[1]
        tooth["arch"] = "upper" if cy <= split_y else "lower"


def _normalize_finding(finding, width, height):
    box = geometry.normalize_box(finding["box"], width, height)
    out = {
        "type": finding["type"],
        "x": box["x"],
        "y": box["y"],
        "w": box["w"],
        "h": box["h"],
        "confidence": finding["confidence"],
    }
    if finding.get("polygon"):
        out["polygon"] = [
            [round(p[0], 5), round(p[1], 5)]
            for p in geometry.normalize_polygon(finding["polygon"], width, height)
        ]
    if finding.get("enamel_pct") is not None:
        out["enamel_pct"] = finding["enamel_pct"]
    if finding.get("dentin_pct") is not None:
        out["dentin_pct"] = finding["dentin_pct"]
    if finding.get("cej") is not None:
        out["cej"] = [
            round(v, 5) for v in geometry.normalize_point(finding["cej"], width, height)
        ]
    if finding.get("crest") is not None:
        out["crest"] = [
            round(v, 5) for v in geometry.normalize_point(finding["crest"], width, height)
        ]
    if finding.get("measurement") is not None:
        out["measurement"] = finding["measurement"]
    if finding.get("gap") is not None:
        out["gap"] = finding["gap"]
    if finding.get("tooth") is not None:
        out["tooth"] = finding["tooth"]
    if finding.get("raw_label"):
        out["raw_label"] = finding["raw_label"]
    if finding.get("class_map50_95") is not None:
        out["class_map50_95"] = finding["class_map50_95"]
    if finding.get("advisory_only"):
        out["advisory_only"] = True
    # Caries subsystem provenance, so the UI/auditor can see this came from our
    # screened workflow and on which tooth surface.
    if finding.get("source"):
        out["source"] = finding["source"]
    if finding.get("screening"):
        out["screening"] = True
    if finding.get("surface"):
        out["surface"] = finding["surface"]
    if finding.get("proposer"):
        out["proposer"] = finding["proposer"]
    if finding.get("relay_flags"):
        out["relay_flags"] = finding["relay_flags"]
    if finding.get("edj_crossing"):
        out["edj_crossing"] = True
    return out


def _caries_provenance(used_model):
    union = bool(getattr(config, "CARIES_UNION_CLASSICAL", True))
    if used_model and union:
        return "trained_model_union_classical_plus_reasoning_layer"
    if used_model:
        return "trained_bitewing_model_plus_reasoning_layer"
    return "classical_proposer_plus_reasoning_layer_no_trained_weights"


def _normalize_bone_sites(bone_sites, width, height):
    out = []
    for idx, site in enumerate(bone_sites):
        teeth = [t for t in (site.get("teeth") or []) if t is not None]
        out.append(
            {
                "cej": [
                    round(v, 5)
                    for v in geometry.normalize_point(site["cej"], width, height)
                ],
                "crest": [
                    round(v, 5)
                    for v in geometry.normalize_point(site["crest"], width, height)
                ],
                "measurement_mm": site["measurement_mm"],
                "severity": round(site["severity"], 3),
                "gap": idx,
                "tooth": teeth[0] if teeth else None,
                "teeth": teeth,
            }
        )
    return out


def _summarize(findings):
    summary = {}
    for f in findings:
        summary[f["type"]] = summary.get(f["type"], 0) + 1
    return summary
