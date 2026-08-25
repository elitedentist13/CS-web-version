"""
Stage 2 - pathology / condition detection via HuggingFace transformers.

Model: Mobe1/argos-dentsight-stage2-conditions-v1 (D-FINE-Large fine-tuned from
ustc-community/dfine-large-coco), 13 condition classes on panoramic radiographs.
Licence: Apache-2.0, inherited from the base model.

MEASURED BEHAVIOUR - READ BEFORE TRUSTING THIS STAGE
    Running the real weights on real panoramic radiographs, the highest sigmoid
    score across all 300 queries and 13 classes is ~0.04. That is not a bug
    here: the model card's Limitations section documents a classification-head
    bias collapse ("inference on real OPGs caps at ~0.034 sigmoid score"), which
    means the head never learned class-specific scores. Consequences:

      * Absolute confidence is meaningless. The scores encode a usable ordinal
        ranking only, so a confidence threshold cannot be interpreted as
        probability for this stage.
      * The pathology classes are far below their own acceptance gates:
        caries mAP@0.5:0.95 = 0.037 (gate 0.30), calculus 0.014 (gate 0.10),
        periapical-radiolucency 0.073 (gate 0.25). The model card marks all
        three as FAIL and explicitly lists "any clinical decision-making" as
        out of scope.
      * The classes that do perform (crown 0.74, implant 0.74, bridge 0.69,
        RC-treated 0.68) are restorative hardware, not disease.

    config.ENABLE_PATHOLOGY_CLASSES therefore defaults to False: only the
    gate-passing classes are emitted unless an operator opts in for evaluation.

PREPROCESSING NOTE
    The model card specifies 1280x704 with aspect-preserving fit + padding, but
    the repository's preprocessor_config.json ships a 640x640 square resize.
    They disagree, so this module follows the model card and overrides the size,
    which is the resolution the weights were actually trained at.
"""

import logging

import numpy as np

from . import geometry

log = logging.getLogger("xray-ai.condition")

# Maps the model's condition vocabulary onto the taxonomy the browser already
# renders (FINDING_TYPES_ORDER in app-xray-ai.js). Anything mapped to None is
# intentionally dropped because the client has no overlay style for it.
LABEL_MAP = {
    "caries": "caries",  # split into incipient/progressed by lesion depth
    "calculus": "calculus",
    "periapical-radiolucency": "periapical_radiolucency",
    "restoration": "restoration",
    "crown": "restoration",
    "bridge": "restoration",
    "implant": "restoration",
    "rc-treated": "restoration",
    # Real classes the client has no overlay style for, dropped deliberately.
    "impacted": None,
    "missing": None,
    "root-stump": None,
    "tooth-bud": None,
    "other-finding": None,
}

# Classes that failed the model's own per-class acceptance gates. Emitted only
# when config.ENABLE_PATHOLOGY_CLASSES is set, and always with the caveat above.
PATHOLOGY_CLASSES = {"caries", "calculus", "periapical-radiolucency"}

# Per-class mAP@0.5:0.95 from the model card, reported alongside findings so the
# provenance of a detection travels with it.
CLASS_MAP50_95 = {
    "crown": 0.7437,
    "implant": 0.7405,
    "bridge": 0.6884,
    "rc-treated": 0.6797,
    "tooth-bud": 0.6159,
    "impacted": 0.5421,
    "root-stump": 0.4563,
    "restoration": 0.2117,
    "missing": 0.2033,
    "other-finding": 0.0934,
    "periapical-radiolucency": 0.0728,
    "caries": 0.0372,
    "calculus": 0.0143,
}


# Resolution from the model card (D-FINE stride-32 constraint), overriding the
# 640x640 that the repository's preprocessor_config.json ships.
CARD_INPUT_SIZE = {"height": 704, "width": 1280}


class ConditionDetector:
    def __init__(self, repo_id, cache_dir, device="auto", min_score=0.15,
                 enabled=True, use_card_resolution=True):
        self.repo_id = repo_id
        self.cache_dir = cache_dir
        self.min_score = min_score
        self.use_card_resolution = use_card_resolution
        self.processor = None
        self.model = None
        self.device = "cpu"
        self.id2label = {}
        self.load_error = None
        if not enabled:
            self.load_error = "disabled by configuration (ENABLE_CONDITION_MODEL=false)"
            log.warning("condition detector %s", self.load_error)
            return
        self._load(device)

    def _resolve_device(self, requested):
        if requested and requested != "auto":
            return requested
        try:
            import torch

            return "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            return "cpu"

    def _load(self, requested_device):
        try:
            import torch  # noqa: F401
            from transformers import AutoImageProcessor, AutoModelForObjectDetection
        except Exception as exc:
            self.load_error = "transformers/torch unavailable: %s" % exc
            log.warning(self.load_error)
            return

        self.device = self._resolve_device(requested_device)
        try:
            proc_kwargs = {}
            if self.use_card_resolution:
                proc_kwargs["size"] = dict(CARD_INPUT_SIZE)
            self.processor = AutoImageProcessor.from_pretrained(
                self.repo_id, cache_dir=self.cache_dir, **proc_kwargs
            )
            self.model = AutoModelForObjectDetection.from_pretrained(
                self.repo_id, cache_dir=self.cache_dir
            )
            self.model.eval()
            if self.device == "cuda":
                self.model.to("cuda")
            cfg_labels = getattr(self.model.config, "id2label", {}) or {}
            self.id2label = {int(k): str(v) for k, v in cfg_labels.items()}
            log.info(
                "condition detector loaded on %s with %d classes",
                self.device,
                len(self.id2label),
            )
        except Exception as exc:
            self.load_error = "failed to load condition model: %s" % exc
            log.warning(self.load_error)
            self.processor = None
            self.model = None

    @property
    def ready(self):
        return self.model is not None and self.processor is not None

    def detect(self, pil_image):
        """Return [{'box': px dict, 'score': float, 'raw_label': str}]."""
        if not self.ready:
            return []
        try:
            import torch

            inputs = self.processor(images=pil_image, return_tensors="pt")
            if self.device == "cuda":
                inputs = {k: v.to("cuda") for k, v in inputs.items()}
            with torch.no_grad():
                outputs = self.model(**inputs)
            target_sizes = torch.tensor([[pil_image.height, pil_image.width]])
            if self.device == "cuda":
                target_sizes = target_sizes.to("cuda")
            processed = self.processor.post_process_object_detection(
                outputs, threshold=self.min_score, target_sizes=target_sizes
            )[0]
        except Exception as exc:
            log.warning("condition inference failed: %s", exc)
            return []

        dets = []
        scores = processed.get("scores")
        labels = processed.get("labels")
        boxes = processed.get("boxes")
        if scores is None or boxes is None:
            return []

        scores = _to_numpy(scores)
        boxes = _to_numpy(boxes)
        labels = _to_numpy(labels) if labels is not None else np.zeros(len(scores), dtype=int)

        for i in range(len(scores)):
            score = float(scores[i])
            if score < self.min_score:
                continue
            x1, y1, x2, y2 = [float(v) for v in boxes[i][:4]]
            if x2 <= x1 or y2 <= y1:
                continue
            raw = self.id2label.get(int(labels[i]), str(int(labels[i])))
            dets.append(
                {
                    "box": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
                    "score": score,
                    "raw_label": raw,
                    "class_map": CLASS_MAP50_95.get(_norm(raw)),
                }
            )
        return geometry.nms(dets, thresh=0.5)


def _to_numpy(tensor):
    if hasattr(tensor, "detach"):
        return tensor.detach().cpu().numpy()
    return np.asarray(tensor)


def _norm(raw_label):
    """Canonical form of a model label: lowercase, hyphen-separated."""
    return str(raw_label).strip().lower().replace(" ", "-").replace("_", "-")


def is_pathology(raw_label):
    return _norm(raw_label) in PATHOLOGY_CLASSES


def map_label(raw_label, allow_pathology=False):
    """
    Normalize a model label to the client taxonomy, or None to drop it.

    Pathology classes are withheld unless explicitly allowed, because all three
    failed the model's own per-class accuracy gates (see the module docstring).
    """
    if raw_label is None:
        return None
    key = _norm(raw_label)
    if key in PATHOLOGY_CLASSES and not allow_pathology:
        return None
    if key in LABEL_MAP:
        return LABEL_MAP[key]
    # Unknown labels are dropped rather than guessed at, so a model update
    # cannot silently mislabel a lesion as something the UI colours as caries.
    log.debug("dropping unmapped condition label: %s", raw_label)
    return None
