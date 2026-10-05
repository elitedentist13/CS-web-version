"""Banana UNet inference: load weights, argmax heatmaps, map Aariz → ISBI.

Clinic Auto landmarks calls this through the AI service shim. The published
1502 mean is never written here.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from .config import (
        AARIZ_SYMBOLS, EXTRA_FROM_AARIZ, HEATMAP_SIZE, HF_REPO, HF_UNET_REPO,
        INPUT_SIZE, ISBI_FROM_AARIZ, SERVICE_WEIGHTS_DIR, UNET_NAMES, WEIGHTS_DIR,
    )
except ImportError:
    from config import (
        AARIZ_SYMBOLS, EXTRA_FROM_AARIZ, HEATMAP_SIZE, HF_REPO, HF_UNET_REPO,
        INPUT_SIZE, ISBI_FROM_AARIZ, SERVICE_WEIGHTS_DIR, UNET_NAMES, WEIGHTS_DIR,
    )

log = logging.getLogger("banana.ceph.unet")
_state: Dict[str, Any] = {"model": None, "kind": "", "tried": False}


def weight_dirs() -> List[Path]:
    return [WEIGHTS_DIR, SERVICE_WEIGHTS_DIR]


def unet_path() -> Optional[Path]:
    for folder in weight_dirs():
        for name in UNET_NAMES:
            p = folder / name
            if p.is_file():
                return p
    return None


def ensure_weights() -> Dict[str, Any]:
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    if unet_path():
        return {"unet": True}
    try:
        from huggingface_hub import hf_hub_download
    except Exception as exc:
        log.info("huggingface_hub unavailable for UNet weights: %s", exc)
        return {"unet": False}
    for repo, fname in (
        (HF_REPO, "best_unet_transfer_model_512px.pth"),
        (HF_REPO, "best_model.pth"),
        (HF_UNET_REPO, "resnet50_unet.pth"),
    ):
        try:
            hf_hub_download(repo_id=repo, filename=fname, local_dir=str(WEIGHTS_DIR))
            if unet_path():
                return {"unet": True}
        except Exception as exc:
            log.info("UNet download %s/%s failed: %s", repo, fname, exc)
    return {"unet": bool(unet_path())}


def status() -> Dict[str, Any]:
    path = unet_path()
    return {
        "available": bool(path),
        "unet": bool(path),
        "source": "dental_001",
        "home": "ceph/unet",
        "owned": "banana",
        "fork": "HyunchanAn/Dental_001",
        "model": "resnet50-unet-heatmap-29",
        "stages": "19 ISBI from 29 Aariz",
        "weightsDir": str(WEIGHTS_DIR),
        "weightsFile": str(path) if path else "",
        "heatmap": HEATMAP_SIZE,
    }


def map_aariz_xy(coords: List[Tuple[float, float]]) -> Tuple[Dict[str, Dict[str, float]], Dict[str, Dict[str, float]]]:
    isbi: Dict[str, Dict[str, float]] = {}
    extra: Dict[str, Dict[str, float]] = {}
    for i, sym in enumerate(AARIZ_SYMBOLS):
        if i >= len(coords):
            break
        x, y = coords[i]
        bid = ISBI_FROM_AARIZ.get(sym)
        if bid:
            isbi[bid] = {"x": float(x), "y": float(y)}
        eid = EXTRA_FROM_AARIZ.get(sym)
        if eid:
            extra[eid] = {"x": float(x), "y": float(y)}
    return isbi, extra


def points_sane(pts: Dict[str, Dict[str, float]], width: int, height: int) -> bool:
    if len(pts) < 19:
        return False
    w = max(int(width or 1), 1)
    h = max(int(height or 1), 1)
    xs, ys = [], []
    for p in pts.values():
        x, y = p.get("x"), p.get("y")
        if x is None or y is None:
            return False
        if x < -2 or y < -2 or x > w + 2 or y > h + 2:
            return False
        xs.append(float(x))
        ys.append(float(y))
    s, n, me, go, pog = pts.get("S"), pts.get("N"), pts.get("Me"), pts.get("Go"), pts.get("Pog")
    if not (s and n and me):
        return False
    if not (s["x"] < n["x"]):
        return False
    if not (me["y"] > n["y"] + h * 0.12):
        return False
    if go and pog and not (go["x"] < pog["x"]):
        return False
    if (max(xs) - min(xs)) < w * 0.18 or (max(ys) - min(ys)) < h * 0.18:
        return False
    return True


def _device():
    import torch
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _strip_blob(blob):
    if isinstance(blob, dict):
        for key in ("state_dict", "model", "net"):
            if key in blob and isinstance(blob[key], dict):
                blob = blob[key]
                break
        blob = {k.replace("module.", "", 1): v for k, v in blob.items()}
    return blob


def _load():
    if _state["tried"]:
        return
    _state["tried"] = True
    ensure_weights()
    path = unet_path()
    if not path:
        log.warning("UNet landmark weights missing in %s (also checked %s)", WEIGHTS_DIR, SERVICE_WEIGHTS_DIR)
        return
    import torch
    device = _device()
    try:
        blob = torch.load(str(path), map_location=device, weights_only=True)
    except TypeError:
        blob = torch.load(str(path), map_location=device)
    blob = _strip_blob(blob)
    try:
        from .model import HeatmapModel, UNetHeatmapModel
    except ImportError:
        from model import HeatmapModel, UNetHeatmapModel
    for kind, factory in (("unet", UNetHeatmapModel), ("legacy", HeatmapModel)):
        model = factory(pretrained=False).to(device)
        try:
            model.load_state_dict(blob, strict=True)
        except Exception:
            try:
                model.load_state_dict(blob, strict=False)
            except Exception as exc:
                log.info("UNet %s load failed: %s", kind, exc)
                continue
        model.eval()
        _state["model"] = model
        _state["kind"] = kind
        log.info("Banana UNet loaded (%s) from %s", kind, path)
        return
    log.warning("UNet weights did not match ResNet-50 heatmap heads")


def _coords_from_heatmaps(heatmaps, width: int, height: int) -> List[Tuple[float, float]]:
    import torch
    _, n, h, w = heatmaps.shape
    flat = heatmaps.reshape(1, n, -1)
    idx = torch.argmax(flat, dim=2)
    ys = (idx // w).float()
    xs = (idx % w).float()
    scale_512 = float(INPUT_SIZE) / float(w)
    xs = xs * scale_512 * (float(width) / float(INPUT_SIZE))
    ys = ys * scale_512 * (float(height) / float(INPUT_SIZE))
    return [(float(xs[0, i]), float(ys[0, i])) for i in range(n)]


def detect(image) -> Dict[str, Any]:
    """Run the Banana UNet on a PIL image. Returns ok=False if weights or sanity fail."""
    _load()
    model = _state.get("model")
    if model is None:
        st = status()
        st.update({"ok": False, "error": "weights"})
        return st
    from torchvision import transforms
    import torch

    rgb = image.convert("RGB")
    w, h = rgb.size
    if min(w, h) < 32:
        return {"ok": False, "error": "tiny", "available": True}
    tf = transforms.Compose([
        transforms.Resize((INPUT_SIZE, INPUT_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    tensor = tf(rgb).unsqueeze(0).to(next(model.parameters()).device)
    with torch.no_grad():
        heatmaps = model(tensor)
    coords = _coords_from_heatmaps(heatmaps, w, h)
    isbi, extra = map_aariz_xy(coords)
    if not points_sane(isbi, w, h):
        return {"ok": False, "available": True, "error": "sane", "source": "dental_001-unet-29"}
    return {
        "ok": True,
        "available": True,
        "pts": isbi,
        "extra": extra,
        "source": "dental_001-unet-29",
        "model": _state.get("kind") or "unet",
        "home": "ceph/unet",
        "note": "Banana ResNet-50 UNet (cloned from Dental_001 / Aariz 29). Staff can drag. Not mixed into published 1502.",
    }
