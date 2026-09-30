"""
Loader for the fine-tuned bitewing caries segmentation model.

The training side (caries/train/) produces a YOLOv8-seg checkpoint and an ONNX
export. Here we load it through the ultralytics runtime, which owns all of the
seg post-processing (proto-mask matmul, NMS, polygon extraction) so we don't
reimplement it by hand.

Everything is optional and fail-soft: if ultralytics is not installed, or no
weights have been trained yet, `ready` is False and the caller falls back to
the classical candidate generator. The service never hard-fails because the
model is absent — it just has lower recall and says so.
"""

import glob
import logging
import os
import threading

log = logging.getLogger("xray-ai.caries.model")

# Class-name substrings that imply lesion depth, mapped to the ACTA staging
# convention (1 enamel, 2 outer dentin, 3 inner dentin). A model whose classes
# are only "caries" leaves stage None and severity is inferred downstream.
_STAGE_HINTS = (
    ("inner", 3), ("deep", 3), ("d3", 3),
    ("dentin", 2), ("outer", 2), ("d2", 2), ("advanced", 2),
    ("enamel", 1), ("incipient", 1), ("initial", 1), ("d1", 1),
)


class CariesModel:
    def __init__(self, weights_dir, min_score=0.25, enabled=True, imgsz=640):
        self.weights_dir = weights_dir
        self.min_score = min_score
        self.imgsz = imgsz
        self.model = None
        self.weights_path = None
        self.load_error = None
        self._infer_lock = threading.Lock()
        self._enabled = bool(enabled)
        if not enabled:
            self.load_error = "disabled by configuration (ENABLE_CARIES_MODEL=false)"
            log.info("caries model %s", self.load_error)
            return
        self._load()

    def _find_weights(self):
        # Continual training publishes the live file via ACTIVE so we never
        # overwrite the checkpoint this process already has open (Windows
        # rejects that replace). The pointer is a bare filename.
        active = os.path.join(self.weights_dir, "ACTIVE")
        if os.path.isfile(active):
            try:
                with open(active, "r", encoding="utf-8") as fh:
                    name = fh.read().strip().splitlines()[0].strip()
            except (OSError, IndexError):
                name = ""
            if name and os.path.basename(name) == name:
                pointed = os.path.join(self.weights_dir, name)
                if os.path.isfile(pointed):
                    return pointed
        for pattern in ("*.pt", "*.onnx"):
            hits = sorted(glob.glob(os.path.join(self.weights_dir, "**", pattern),
                                    recursive=True))
            if hits:
                # Prefer a file that looks like a deliberate export.
                for h in hits:
                    if "best" in os.path.basename(h).lower():
                        return h
                return hits[0]
        return None

    def _load(self):
        path = self._find_weights()
        if not path:
            self.load_error = (
                "no trained caries weights under %s — train one with "
                "caries/train/train.py (public bitewing data), or run with the "
                "classical fallback" % self.weights_dir
            )
            log.info("caries model: %s", self.load_error)
            return
        try:
            from ultralytics import YOLO
        except Exception as exc:  # pragma: no cover - import guard
            self.load_error = (
                "ultralytics not installed (%s); install caries/train/"
                "requirements-train.txt to run the trained model" % exc
            )
            log.info("caries model: %s", self.load_error)
            return
        try:
            self.model = YOLO(path)
            self.weights_path = path
            log.info("caries model loaded from %s", os.path.basename(path))
        except Exception as exc:
            self.load_error = "failed to load caries weights: %s" % exc
            log.warning(self.load_error)
            self.model = None

    @property
    def ready(self):
        return self.model is not None

    def reload(self):
        """Drop the loaded checkpoint and read ACTIVE / weights again."""
        if not self._enabled:
            return False, self.weights_path, self.load_error
        with self._infer_lock:
            self.model = None
            self.weights_path = None
            self.load_error = None
            self._load()
            return self.ready, self.weights_path, self.load_error

    def detect(self, rgb):
        """
        Run the model and return candidates in the reasoning-layer format:
        [{"box": {x,y,w,h}, "score": float, "polygon": [[x,y]..]|None,
          "stage": int|None}]  (all pixel coords).
        """
        if rgb is None:
            return []
        with self._infer_lock:
            if not self.ready:
                return []
            try:
                results = self.model.predict(
                    rgb, imgsz=self.imgsz, conf=self.min_score, verbose=False
                )
            except Exception as exc:
                log.warning("caries model inference failed: %s", exc)
                return []
            return self._candidates_from_results(results)
    def _candidates_from_results(self, results):
        if not results:
            return []

        res = results[0]
        names = getattr(res, "names", {}) or {}
        boxes = getattr(res, "boxes", None)
        masks = getattr(res, "masks", None)
        if boxes is None or len(boxes) == 0:
            return []

        xyxy = boxes.xyxy.cpu().numpy()
        conf = boxes.conf.cpu().numpy()
        cls = boxes.cls.cpu().numpy().astype(int)
        polys = masks.xy if masks is not None else None

        out = []
        for i in range(len(xyxy)):
            x1, y1, x2, y2 = (float(v) for v in xyxy[i][:4])
            if x2 <= x1 or y2 <= y1:
                continue
            label = str(names.get(int(cls[i]), "")).lower()
            polygon = None
            if polys is not None and i < len(polys) and len(polys[i]) >= 3:
                polygon = [[float(p[0]), float(p[1])] for p in polys[i]]
            out.append({
                "box": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
                "score": float(conf[i]),
                "polygon": polygon,
                "stage": _stage_from_label(label),
            })
        return out


def _stage_from_label(label):
    for hint, stage in _STAGE_HINTS:
        if hint in label:
            return stage
    return None
