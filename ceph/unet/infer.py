"""Banana UNet inference: load weights, sub-pixel heatmap peaks, map Aariz → ISBI.

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
        INPUT_SIZE, ISBI_FROM_AARIZ, PEAK_BETA, PEAK_RADIUS,
        SERVICE_WEIGHTS_DIR, UNET_NAMES, WEIGHTS_DIR,
    )
except ImportError:
    from config import (
        AARIZ_SYMBOLS, EXTRA_FROM_AARIZ, HEATMAP_SIZE, HF_REPO, HF_UNET_REPO,
        INPUT_SIZE, ISBI_FROM_AARIZ, PEAK_BETA, PEAK_RADIUS,
        SERVICE_WEIGHTS_DIR, UNET_NAMES, WEIGHTS_DIR,
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
        "decode": "local-soft-argmax",
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


def local_soft_argmax(heatmaps, radius=PEAK_RADIUS, beta=PEAK_BETA):
    """Sub-pixel peak per channel. heatmaps (B, C, H, W) → xy (B, C, 2).

    Argmax picks the cell, then a softmax over the local window takes the
    expected coordinate. A symmetric spike stays on that pixel; a gaussian
    whose mode sits between pixels shifts toward the mass. Gradients flow
    through the window values (the window index itself is discrete).
    """
    import torch
    import torch.nn.functional as F

    b, c, h, w = heatmaps.shape
    radius = int(radius)
    k = radius * 2 + 1
    flat = heatmaps.reshape(b, c, -1)
    idx = flat.argmax(dim=-1)
    py = idx // w
    px = idx % w
    padded = F.pad(heatmaps, (radius, radius, radius, radius), mode="constant", value=0)
    windows = padded.unfold(2, k, 1).unfold(3, k, 1)
    bb = torch.arange(b, device=heatmaps.device)[:, None]
    cc = torch.arange(c, device=heatmaps.device)[None, :]
    win = windows[bb, cc, py, px]
    peak = win.amax(dim=(-1, -2), keepdim=True)
    yy = torch.arange(k, device=heatmaps.device)
    xx = torch.arange(k, device=heatmaps.device)
    gy = py[:, :, None, None] + (yy[None, None, :, None] - radius)
    gx = px[:, :, None, None] + (xx[None, None, None, :] - radius)
    valid = (gy >= 0) & (gy < h) & (gx >= 0) & (gx < w)
    logits = (win - peak) * float(beta)
    logits = logits.masked_fill(~valid, -1e4)
    prob = torch.softmax(logits.reshape(b, c, -1), dim=-1).reshape(b, c, k, k)
    exp_y = (prob * gy.to(heatmaps.dtype)).sum(dim=(-1, -2))
    exp_x = (prob * gx.to(heatmaps.dtype)).sum(dim=(-1, -2))
    return torch.stack((exp_x, exp_y), dim=-1)


def _coords_from_heatmaps(heatmaps, width: int, height: int) -> List[Tuple[float, float]]:
    _, n, h, w = heatmaps.shape
    xy = local_soft_argmax(heatmaps)
    # Heatmap pixel → original image. INPUT_SIZE cancels: hm * width / heatmap_w.
    xs = xy[0, :, 0] * (float(width) / float(w))
    ys = xy[0, :, 1] * (float(height) / float(h))
    return [(float(xs[i]), float(ys[i])) for i in range(n)]


# Second-stage window is one fifth of each film side, centred on the coarse point.
CROP_FRAC = 0.20
# A refined peak may move at most this fraction of the half-window.
REFINE_REACH = 0.45


def crop_box(cx: float, cy: float, width: int, height: int, frac: float = CROP_FRAC) -> Tuple[int, int, int, int]:
    """Axis-aligned window around a coarse landmark, shifted to stay on the film."""
    side_w = max(32, int(round(float(width) * float(frac))))
    side_h = max(32, int(round(float(height) * float(frac))))
    side_w = min(side_w, int(width))
    side_h = min(side_h, int(height))
    x0 = int(round(float(cx) - side_w / 2.0))
    y0 = int(round(float(cy) - side_h / 2.0))
    x1 = x0 + side_w
    y1 = y0 + side_h
    if x0 < 0:
        x1 -= x0
        x0 = 0
    if y0 < 0:
        y1 -= y0
        y0 = 0
    if x1 > width:
        x0 -= x1 - width
        x1 = width
    if y1 > height:
        y0 -= y1 - height
        y1 = height
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(int(width), max(x1, x0 + 1))
    y1 = min(int(height), max(y1, y0 + 1))
    return x0, y0, x1, y1


def accept_refined(lx: float, ly: float, cx: float, cy: float, x0: int, y0: int, crop_w: int, crop_h: int) -> bool:
    """Keep a crop peak when it is inside the window and near the coarse point."""
    if crop_w < 8 or crop_h < 8:
        return False
    margin_x = crop_w * 0.06
    margin_y = crop_h * 0.06
    if lx < margin_x or ly < margin_y or lx > crop_w - margin_x or ly > crop_h - margin_y:
        return False
    ox = float(cx) - float(x0)
    oy = float(cy) - float(y0)
    reach = REFINE_REACH * 0.5 * float(max(crop_w, crop_h))
    dx = float(lx) - ox
    dy = float(ly) - oy
    return dx * dx + dy * dy <= reach * reach


def _output_channels() -> List[int]:
    channels = []
    for i, sym in enumerate(AARIZ_SYMBOLS):
        if ISBI_FROM_AARIZ.get(sym) or EXTRA_FROM_AARIZ.get(sym):
            channels.append(i)
    return channels


def refine_coords(rgb, model, tf, coords: List[Tuple[float, float]], width: int, height: int) -> List[Tuple[float, float]]:
    """Second pass: one fifth-film crop per output landmark, peak mapped back."""
    import torch

    refined = list(coords)
    device = next(model.parameters()).device
    crops = []
    meta = []
    for chan in _output_channels():
        if chan >= len(coords):
            continue
        cx, cy = coords[chan]
        if not (0.0 <= cx < width and 0.0 <= cy < height):
            continue
        x0, y0, x1, y1 = crop_box(cx, cy, width, height)
        if x1 - x0 < 32 or y1 - y0 < 32:
            continue
        crops.append(rgb.crop((x0, y0, x1, y1)))
        meta.append((chan, cx, cy, x0, y0, x1, y1))
    if not crops:
        return refined
    step = 8
    for start in range(0, len(crops), step):
        chunk = crops[start:start + step]
        rows = meta[start:start + step]
        batch = torch.stack([tf(crop) for crop in chunk]).to(device)
        with torch.no_grad():
            heatmaps = model(batch)
        xy = local_soft_argmax(heatmaps)
        hm_h = float(heatmaps.shape[-2])
        hm_w = float(heatmaps.shape[-1])
        for b, (chan, cx, cy, x0, y0, x1, y1) in enumerate(rows):
            crop_w = float(x1 - x0)
            crop_h = float(y1 - y0)
            lx = float(xy[b, chan, 0]) * (crop_w / hm_w)
            ly = float(xy[b, chan, 1]) * (crop_h / hm_h)
            if not accept_refined(lx, ly, cx, cy, x0, y0, int(crop_w), int(crop_h)):
                continue
            fx = min(max(float(x0) + lx, 0.0), float(width) - 1.0)
            fy = min(max(float(y0) + ly, 0.0), float(height) - 1.0)
            refined[chan] = (fx, fy)
    return refined


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
    refined = coords
    try:
        refined = refine_coords(rgb, model, tf, coords, w, h)
    except Exception as exc:
        log.warning("UNet crop refine failed: %s", exc)
        refined = coords
    isbi, extra = map_aariz_xy(refined)
    used_crop = any(
        abs(refined[i][0] - coords[i][0]) > 0.5 or abs(refined[i][1] - coords[i][1]) > 0.5
        for i in range(min(len(refined), len(coords)))
    )
    if not points_sane(isbi, w, h):
        isbi, extra = map_aariz_xy(coords)
        used_crop = False
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
        "refine": "crop" if used_crop else "",
        "note": "Banana ResNet-50 UNet (cloned from Dental_001 / Aariz 29). "
                "A second pass refines each point on a one-fifth crop. Staff can drag. Not mixed into published 1502.",
    }
