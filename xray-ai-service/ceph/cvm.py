"""Dental_001 CVM fork: YOLO C2-C4 ROI + EfficientNet-B0 CORAL classifier.

Adapted from HyunchanAn/Dental_001 (tools/api.py, tools/inference.py;
Aariz / Baccetti CS1-CS6). Weights stay out of git — see ensure_weights().
The 19 ISBI landmarks never classify CVM; they only seed a fallback crop
when the YOLO detector is missing.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

log = logging.getLogger("xray-ai.ceph.cvm")

WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"
HF_REPO = "chemahc94/Cephalometric-Landmark-CVM"
HF_YOLO_REPO = "chemahc94/dental-yolo"
CLASSIFIER_NAME = "best_cvm_v2_768px.pth"
YOLO_NAMES = (
    "best.pt",
    "cvm_detector.pt",
    "yolov8m_custom.pt",
    os.path.join("cvm_detector", "weights", "best.pt"),
)
CVM_SIZE = 768
NUM_CLASSES = 6
STAGES = {
    1: "CVM-S1",
    2: "CVM-S2",
    3: "CVM-S3",
    4: "CVM-S4",
    5: "CVM-S5",
    6: "CVM-S6",
}

_state: Dict[str, Any] = {"classifier": None, "detector": None, "tried": False}


def _pt(pts: Optional[Dict[str, Any]], *ids: str) -> Optional[Tuple[float, float]]:
    if not pts:
        return None
    for i in ids:
        p = pts.get(i)
        if isinstance(p, dict) and p.get("x") is not None and p.get("y") is not None:
            try:
                return float(p["x"]), float(p["y"])
            except (TypeError, ValueError):
                continue
    return None


def fallback_bbox(width: int, height: int, pts: Optional[Dict[str, Any]] = None):
    """Posterior-inferior C2-C4 crop. Face-right films put the spine on the left."""
    w = max(int(width or 1), 1)
    h = max(int(height or 1), 1)
    po = _pt(pts, "Po", "Ar")
    go = _pt(pts, "Go")
    ar = _pt(pts, "Ar", "Po")
    if po and go and ar:
        cx = min(po[0], ar[0])
        cy = (ar[1] + go[1]) / 2.0
        bw = w * 0.24
        bh = h * 0.30
        x1 = cx - bw * 0.85
        y1 = cy - bh * 0.35
        x2 = cx + bw * 0.35
        y2 = cy + bh * 0.75
    else:
        x1, x2 = w * 0.02, w * 0.40
        y1, y2 = h * 0.26, h * 0.74
    x1 = max(0, min(w - 2, int(x1)))
    y1 = max(0, min(h - 2, int(y1)))
    x2 = max(x1 + 2, min(w, int(x2)))
    y2 = max(y1 + 2, min(h, int(y2)))
    return [x1, y1, x2, y2]


def parse_landmarks(raw: Any) -> Optional[Dict[str, Any]]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw) if isinstance(raw, (str, bytes)) else None
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def classifier_path() -> Optional[Path]:
    p = WEIGHTS_DIR / CLASSIFIER_NAME
    return p if p.is_file() else None


def yolo_path() -> Optional[Path]:
    for name in YOLO_NAMES:
        p = WEIGHTS_DIR / name
        if p.is_file():
            return p
    return None


def ensure_weights() -> Dict[str, Any]:
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    got = {"classifier": bool(classifier_path()), "detector": bool(yolo_path())}
    if got["classifier"] and got["detector"]:
        return got
    try:
        from huggingface_hub import hf_hub_download
    except Exception as exc:
        log.info("huggingface_hub unavailable for CVM weights: %s", exc)
        return got
    if not got["classifier"]:
        try:
            hf_hub_download(
                repo_id=HF_REPO,
                filename=CLASSIFIER_NAME,
                local_dir=str(WEIGHTS_DIR),
            )
        except Exception as exc:
            log.warning("CVM classifier download failed: %s", exc)
    if not got["detector"]:
        for repo, fname in (
            (HF_REPO, "best.pt"),
            (HF_YOLO_REPO, "yolov8m_custom.pt"),
        ):
            try:
                hf_hub_download(repo_id=repo, filename=fname, local_dir=str(WEIGHTS_DIR))
                break
            except Exception as exc:
                log.info("CVM YOLO download %s/%s failed: %s", repo, fname, exc)
    return {"classifier": bool(classifier_path()), "detector": bool(yolo_path())}


def status() -> Dict[str, Any]:
    return {
        "available": bool(classifier_path()),
        "classifier": bool(classifier_path()),
        "detector": bool(yolo_path()),
        "source": "dental_001",
        "fork": "HyunchanAn/Dental_001",
        "stages": "CS1-CS6",
        "weightsDir": str(WEIGHTS_DIR),
    }


def _make_classifier():
    import torch
    import torch.nn as nn
    from torchvision import models

    class CoralEfficientNet(nn.Module):
        """Dental_001 CVM V2 CORAL head (ordinal CS1-CS6)."""

        def __init__(self, num_classes=NUM_CLASSES):
            super().__init__()
            self.backbone = models.efficientnet_b0(weights=None)
            n = self.backbone.classifier[1].in_features
            self.backbone.classifier = nn.Identity()
            self.fc = nn.Linear(n, num_classes - 1, bias=False)
            self.bias = nn.Parameter(torch.zeros(num_classes - 1))

        def forward(self, x):
            return self.fc(self.backbone(x)) + self.bias

    return CoralEfficientNet()


def _device():
    import torch
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _load():
    if _state["tried"]:
        return
    _state["tried"] = True
    ensure_weights()
    cp = classifier_path()
    if not cp:
        log.warning("CVM classifier weights missing in %s", WEIGHTS_DIR)
        return
    import torch
    device = _device()
    model = _make_classifier().to(device)
    try:
        blob = torch.load(str(cp), map_location=device, weights_only=True)
    except TypeError:
        blob = torch.load(str(cp), map_location=device)
    if isinstance(blob, dict) and "state_dict" in blob:
        blob = blob["state_dict"]
    model.load_state_dict(blob)
    model.eval()
    _state["classifier"] = model
    yp = yolo_path()
    if yp:
        try:
            from ultralytics import YOLO
            _state["detector"] = YOLO(str(yp))
        except Exception as exc:
            log.warning("CVM YOLO failed to load: %s", exc)
            _state["detector"] = None


def _yolo_box(rgb, conf=0.45):
    det = _state.get("detector")
    if det is None:
        return None
    try:
        results = det.predict(rgb, conf=conf, verbose=False)
    except Exception as exc:
        log.info("CVM YOLO predict failed: %s", exc)
        return None
    if not results or not results[0].boxes or len(results[0].boxes) == 0:
        return None
    x1, y1, x2, y2 = results[0].boxes[0].xyxy[0].cpu().numpy().tolist()
    return [int(x1), int(y1), int(x2), int(y2)]


def _proba_to_stage(logits) -> int:
    import torch
    levels = torch.sigmoid(logits) > 0.5
    idx = int(torch.sum(levels, dim=1).item())
    return max(1, min(6, idx + 1))


def classify_crop(rgb_crop) -> Optional[int]:
    model = _state.get("classifier")
    if model is None or rgb_crop is None:
        return None
    from PIL import Image
    from torchvision import transforms
    import torch

    ok = False
    if hasattr(rgb_crop, "size") and isinstance(rgb_crop.size, tuple):
        ok = min(rgb_crop.size) >= 8
    else:
        try:
            ok = min(int(rgb_crop.shape[0]), int(rgb_crop.shape[1])) >= 8
        except Exception:
            ok = False
    if not ok:
        return None
    tf = transforms.Compose([
        transforms.Resize((CVM_SIZE, CVM_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    if hasattr(rgb_crop, "mode"):
        pil = rgb_crop.convert("RGB")
    else:
        pil = Image.fromarray(rgb_crop)
    tensor = tf(pil).unsqueeze(0).to(next(model.parameters()).device)
    with torch.no_grad():
        logits = model(tensor)
    return _proba_to_stage(logits)


def detect_cvm(image, pts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Run the Dental_001 C2-C4 pipeline on a PIL image."""
    _load()
    if _state.get("classifier") is None:
        st = status()
        st.update({"ok": False, "available": False, "error": "weights"})
        return st
    import numpy as np

    rgb = image.convert("RGB")
    w, h = rgb.size
    arr = np.array(rgb)
    bbox = _yolo_box(arr)
    via = "yolo"
    if not bbox:
        bbox = fallback_bbox(w, h, pts)
        via = "landmarks" if pts else "heuristic"
    x1, y1, x2, y2 = bbox
    crop = rgb.crop((x1, y1, x2, y2))
    stage = classify_crop(crop)
    if not stage:
        return {"ok": False, "available": True, "error": "classify", "bbox": bbox, "roi": via}
    return {
        "ok": True,
        "available": True,
        "stage": stage,
        "id": "CS" + str(stage),
        "title": STAGES[stage],
        "bbox": bbox,
        "roi": via,
        "source": "dental_001-c2c4",
        "note": "C2-C4 model (Dental_001 / Aariz). Staff can override. Not a treatment plan.",
    }
