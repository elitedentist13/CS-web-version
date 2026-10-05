"""Shim: Banana sidecar owns the ResNet-50 UNet (`ceph/unet/`).

Keep this file thin. Architecture, mapping, train, and infer live in the
sidecar so clinic Auto landmarks and Banana development share one tree.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_SIDECAR = Path(__file__).resolve().parents[2] / "ceph" / "unet"
_NAME = "banana_ceph_unet"


def _load():
    if _NAME in sys.modules:
        return sys.modules[_NAME]
    init = _SIDECAR / "__init__.py"
    if not init.is_file():
        raise ImportError("Banana UNet tree missing at %s" % _SIDECAR)
    spec = importlib.util.spec_from_file_location(
        _NAME, init, submodule_search_locations=[str(_SIDECAR)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_NAME] = mod
    spec.loader.exec_module(mod)
    return mod


_mod = _load()
AARIZ_SYMBOLS = _mod.AARIZ_SYMBOLS
ISBI_FROM_AARIZ = _mod.ISBI_FROM_AARIZ
EXTRA_FROM_AARIZ = _mod.EXTRA_FROM_AARIZ
detect = _mod.detect
ensure_weights = _mod.ensure_weights
map_aariz_xy = _mod.map_aariz_xy
points_sane = _mod.points_sane
status = _mod.status
unet_path = _mod.unet_path


def __getattr__(name):
    return getattr(_mod, name)
