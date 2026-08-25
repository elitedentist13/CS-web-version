"""
Stage 1 - tooth / FDI localization via ONNX Runtime.

Model: abychkov/dental-fdi-detection - an RT-DETR derivative (per the model's
own NOTICE, built on Lv et al., arXiv:2304.08069), trained on 4,000+ panoramic
radiographs, exported to ONNX for CPU inference.

Everything downstream is anchored to these boxes: condition detections get
per-tooth context, bone loss is measured between adjacent teeth, and the
enamel/dentin split for caries comes from tooth geometry.

LICENSE RESTRICTION - READ BEFORE DEPLOYING
    This model is released under a Proprietary Non-Commercial license that
    permits research, education and internal validation, but PROHIBITS
    commercial use and clinical/diagnostic use without a separate agreement
    (contact bychkov.tech@gmail.com). Using it on real patient radiographs in a
    live clinic is outside that grant. config.ENABLE_TOOTH_MODEL exists so the
    stage can be switched off; the service logs the restriction on every start.

VERIFIED TENSOR CONTRACT (measured against the real weights)
    input   "images"  float32 [batch, 3, height, width]  - dynamic H/W, but the
            model only performs well at 640x640, and RT-DETR's convention is a
            plain resize with NO aspect-ratio preservation and NO padding.
            Letterboxing measurably degrades results; feeding native resolution
            degrades them badly (30 detections -> 3 on a real panoramic).
    output  "output0" float32 [batch, 300, 36]
            columns 0-3   normalized cxcywh, relative to the source image
            columns 4-35  per-class scores, sigmoid already applied (32 classes,
                          one per permanent tooth)

FDI RELIABILITY CAVEAT
    The class index gives a tooth *type* reliably, but quadrant assignment is
    imperfect: on real radiographs this model labels mirror-image teeth with the
    same class (e.g. reporting 13 where 23 is expected). The author's model card
    states the "anatomical consistency engine" that resolves this is a separate
    proprietary module, not included here. Treat `fdi` as a grouping key, not as
    a tooth number to show a clinician.
"""

import glob
import logging
import os

import numpy as np

from . import geometry

log = logging.getLogger("xray-ai.tooth")

# Class index -> FDI number. Index order is the four quadrants in sequence.
# See the reliability caveat above before trusting these numbers.
_FDI_NUMBERS = (
    [11, 12, 13, 14, 15, 16, 17, 18]
    + [21, 22, 23, 24, 25, 26, 27, 28]
    + [31, 32, 33, 34, 35, 36, 37, 38]
    + [41, 42, 43, 44, 45, 46, 47, 48]
)

# The resolution the model was tuned for, used regardless of the dynamic axes.
_INFERENCE_SIZE = (640, 640)


class ToothDetector:
    def __init__(self, repo_id, cache_dir, min_score=0.30, enabled=True):
        self.repo_id = repo_id
        self.cache_dir = cache_dir
        self.min_score = min_score
        self.session = None
        self.input_name = None
        self.input_size = _INFERENCE_SIZE
        self.load_error = None
        if not enabled:
            self.load_error = (
                "disabled by configuration (ENABLE_TOOTH_MODEL=false): this "
                "model's licence prohibits commercial and clinical use"
            )
            log.warning("tooth detector %s", self.load_error)
            return
        self._load()

    # ── loading ────────────────────────────────────────────────────
    def _find_onnx(self):
        hits = sorted(glob.glob(os.path.join(self.cache_dir, "**", "*.onnx"),
                                recursive=True))
        if not hits:
            return None
        for hit in hits:
            if "dental" in os.path.basename(hit).lower():
                return hit
        return hits[0]

    def _load(self):
        try:
            import onnxruntime as ort
        except Exception as exc:  # pragma: no cover - import guard
            self.load_error = "onnxruntime unavailable: %s" % exc
            log.warning(self.load_error)
            return

        path = self._find_onnx()
        if not path:
            self.load_error = (
                "no .onnx file found under %s - run download_models.py first"
                % self.cache_dir
            )
            log.warning(self.load_error)
            return

        try:
            providers = ["CPUExecutionProvider"]
            available = getattr(ort, "get_available_providers", lambda: [])()
            if "CUDAExecutionProvider" in available:
                providers.insert(0, "CUDAExecutionProvider")
            self.session = ort.InferenceSession(path, providers=providers)
            self.input_name = self.session.get_inputs()[0].name
            log.warning(
                "tooth detector loaded from %s - LICENCE: non-commercial "
                "research/validation only, clinical use prohibited",
                os.path.basename(path),
            )
        except Exception as exc:
            self.load_error = "failed to load ONNX session: %s" % exc
            log.warning(self.load_error)
            self.session = None

    @property
    def ready(self):
        return self.session is not None

    # ── inference ──────────────────────────────────────────────────
    def _preprocess(self, image_rgb):
        """Plain resize to 640x640 (RT-DETR convention: no pad, no aspect keep)."""
        import cv2

        resized = cv2.resize(image_rgb, _INFERENCE_SIZE, interpolation=cv2.INTER_LINEAR)
        scaled = resized.astype(np.float32) / 255.0
        return np.transpose(scaled, (2, 0, 1))[None, ...]

    def detect(self, image_rgb):
        """Return [{'box': px dict, 'score': float, 'fdi': int|None}]."""
        if not self.ready or image_rgb is None:
            return []
        try:
            outputs = self.session.run(
                None, {self.input_name: self._preprocess(image_rgb)}
            )
        except Exception as exc:
            log.warning("tooth inference failed: %s", exc)
            return []

        src_h, src_w = image_rgb.shape[:2]
        try:
            dets = _decode(outputs, self.session.get_outputs(), src_w, src_h,
                           self.min_score)
        except Exception as exc:
            log.warning("tooth output decode failed: %s", exc)
            return []
        return geometry.nms(dets, thresh=0.55)


def _fdi_from_class(idx):
    if idx is None:
        return None
    idx = int(idx)
    if 0 <= idx < len(_FDI_NUMBERS):
        return _FDI_NUMBERS[idx]
    return None


def _decode(outputs, output_meta, src_w, src_h, min_score):
    """
    Decode the detection head.

    Primary path is this model's verified layout: one tensor of shape
    [batch, queries, 4 + num_classes] holding normalized cxcywh plus per-class
    sigmoid scores. The secondary path covers exports that emit `logits` and
    `pred_boxes` as separate tensors, which is what the plain HuggingFace
    RT-DETR / D-FINE export produces - kept so a re-export of the same model
    family does not silently break this stage.
    """
    arrays = [np.asarray(o) for o in outputs]
    names = [o.name.lower() for o in output_meta]

    for arr in arrays:
        squeezed = arr[0] if arr.ndim == 3 and arr.shape[0] == 1 else arr
        if squeezed.ndim == 2 and squeezed.shape[-1] > 5:
            return _from_box_plus_classes(squeezed, src_w, src_h, min_score)

    logits_idx = _first_index(names, ("logit", "score", "class"))
    boxes_idx = _first_index(names, ("box", "bbox"))
    if logits_idx is not None and boxes_idx is not None:
        logits = arrays[logits_idx]
        boxes = arrays[boxes_idx]
        logits = logits[0] if logits.ndim == 3 else logits
        boxes = boxes[0] if boxes.ndim == 3 else boxes
        scores = _sigmoid(logits)
        merged = np.concatenate([boxes[:, :4], scores], axis=1)
        return _from_box_plus_classes(merged, src_w, src_h, min_score)

    raise ValueError("unrecognized ONNX output layout: %s shapes=%s"
                     % (names, [a.shape for a in arrays]))


def _from_box_plus_classes(rows, src_w, src_h, min_score):
    boxes = rows[:, :4]
    class_scores = rows[:, 4:]
    scores = class_scores.max(axis=1)
    classes = class_scores.argmax(axis=1)

    keep = np.nonzero(scores >= min_score)[0]
    dets = []
    for i in keep:
        cx, cy, bw, bh = (float(v) for v in boxes[i])
        # Normalized output is the RT-DETR convention; absolute pixel values are
        # passed through unchanged for exports that skip normalization.
        if max(abs(cx), abs(cy), bw, bh) <= 1.5:
            cx *= src_w
            bw *= src_w
            cy *= src_h
            bh *= src_h
        if bw <= 0 or bh <= 0:
            continue
        x1 = geometry.clamp(cx - bw / 2.0, 0, src_w)
        y1 = geometry.clamp(cy - bh / 2.0, 0, src_h)
        x2 = geometry.clamp(cx + bw / 2.0, 0, src_w)
        y2 = geometry.clamp(cy + bh / 2.0, 0, src_h)
        if x2 <= x1 or y2 <= y1:
            continue
        dets.append({
            "box": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
            "score": float(scores[i]),
            "fdi": _fdi_from_class(classes[i]),
        })
    return dets


def _first_index(names, keywords):
    for i, name in enumerate(names):
        if any(k in name for k in keywords):
            return i
    return None


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -60, 60)))
