"""
Load 2026-09-09 X-ray Assist extras without replacing files in xray-ai-service.

Original modules stay on disk. Overlay copies are imported into sys.modules
before uvicorn constructs the pipeline.
"""
from __future__ import annotations

import sys
from pathlib import Path


EXTRA_ID = "2026-09-09"


def extra_modules_dir():
    here = Path(__file__).resolve().parent
    repo = here.parent
    env = ( __import__("os").environ.get("CS_XRAY_AI_EXTRAS") or "").strip()
    candidates = []
    if env:
        candidates.append(Path(env) / "service" / "modules")
    candidates.extend(
        [
            repo / "xray-ai-extras" / EXTRA_ID / "service" / "modules",
            repo / "xray-ai-deploy-pack" / "extras" / EXTRA_ID / "service" / "modules",
            here / "extras" / EXTRA_ID / "service" / "modules",
        ]
    )
    for path in candidates:
        if (path / "pipeline.py").is_file() or (path / "caries" / "detect.py").is_file():
            return path
    return None


def _overlay(fullname, file_path):
    import importlib.util

    file_path = Path(file_path)
    if not file_path.is_file():
        return None
    spec = importlib.util.spec_from_file_location(fullname, str(file_path))
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules[fullname] = module
    spec.loader.exec_module(module)
    parent, _, child = fullname.rpartition(".")
    if parent and parent in sys.modules:
        setattr(sys.modules[parent], child, module)
    return module


def apply():
    if getattr(apply, "_done", False):
        return True
    modules = extra_modules_dir()
    try:
        import config
        config.CARIES_INTRAORAL_DECAY_EMPHASIS = True
    except Exception:
        pass
    if modules is None:
        apply._done = True
        return False

    import caries  # noqa: F401 — original package, then replace submodules
    import models  # noqa: F401

    _overlay("caries.edj_anatomy", modules / "caries" / "edj_anatomy.py")
    _overlay("caries.reasoning", modules / "caries" / "reasoning.py")
    detect = _overlay("caries.detect", modules / "caries" / "detect.py")
    if detect is not None and hasattr(detect, "detect_caries"):
        caries.detect_caries = detect.detect_caries
    _overlay("models.intraoral_layers", modules / "models" / "intraoral_layers.py")
    _overlay("models.modality", modules / "models" / "modality.py")
    _overlay("pipeline", modules / "pipeline.py")
    apply._done = True
    return True
