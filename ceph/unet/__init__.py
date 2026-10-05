"""Banana-owned ResNet-50 UNet for the lateral-ceph sidecar.

Development lives here (`ceph/unet/`). The AI service re-exports this
package so Auto landmarks keeps using POST /ceph/landmarks.

`model.py` is imported lazily so mapping/status checks work without torch.
"""
from .config import (
    AARIZ_SYMBOLS, EXTRA_FROM_AARIZ, HEATMAP_SIZE, INPUT_SIZE,
    ISBI_FROM_AARIZ, NUM_LANDMARKS, WEIGHTS_DIR,
)
from .infer import (
    detect, ensure_weights, map_aariz_xy, points_sane, status, unet_path, weight_dirs,
)

__all__ = [
    "AARIZ_SYMBOLS", "EXTRA_FROM_AARIZ", "HEATMAP_SIZE", "HeatmapModel",
    "INPUT_SIZE", "ISBI_FROM_AARIZ", "NUM_LANDMARKS", "UNetHeatmapModel",
    "WEIGHTS_DIR", "detect", "ensure_weights", "map_aariz_xy", "points_sane",
    "status", "unet_path", "weight_dirs",
]


def __getattr__(name):
    if name in ("UNetHeatmapModel", "HeatmapModel"):
        from .model import HeatmapModel, UNetHeatmapModel
        return UNetHeatmapModel if name == "UNetHeatmapModel" else HeatmapModel
    raise AttributeError(name)
