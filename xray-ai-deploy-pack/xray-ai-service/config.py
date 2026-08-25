"""
Configuration for CS X-ray Assist inference service.

Every value is environment-driven with local-friendly defaults, so the same
code (and the same Docker image) runs unchanged on a clinic PC or on a cloud
container host. Moving to cloud is then only a matter of pointing
window.XRAY_AI_API_URL in index.html at the new base URL.
"""

import os


def _env_str(name, default):
    val = os.environ.get(name)
    return val.strip() if val and val.strip() else default


def _env_float(name, default):
    try:
        return float(os.environ[name])
    except (KeyError, TypeError, ValueError):
        return default


def _env_int(name, default):
    try:
        return int(os.environ[name])
    except (KeyError, TypeError, ValueError):
        return default


def _env_bool(name, default):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


HOST = _env_str("HOST", "127.0.0.1")
PORT = _env_int("PORT", 8765)

# Where HuggingFace weights are cached. Mount this as a volume in Docker to
# avoid re-downloading models on every container rebuild.
MODEL_CACHE_DIR = _env_str(
    "MODEL_CACHE_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "model_cache"),
)

TOOTH_MODEL_REPO = _env_str("TOOTH_MODEL_REPO", "abychkov/dental-fdi-detection")
CONDITION_MODEL_REPO = _env_str(
    "CONDITION_MODEL_REPO", "Mobe1/argos-dentsight-stage2-conditions-v1"
)

# The tooth detector's licence (Proprietary Non-Commercial) permits research,
# education and internal validation but prohibits commercial use and
# clinical/diagnostic use without a separate agreement. Set this to false to run
# without it; the pipeline then loses bone-loss measurement and the
# enamel/dentin split, because both are anchored to tooth geometry.
ENABLE_TOOTH_MODEL = _env_bool("ENABLE_TOOTH_MODEL", True)

ENABLE_CONDITION_MODEL = _env_bool("ENABLE_CONDITION_MODEL", True)

# Classical tooth-box segmentation for periapical / bitewing images. The
# panoramic FDI ONNX model does not fire reliably on these modalities; this
# add-on restores tooth boxes so bone heuristics and caries screening have
# anatomy to anchor to. Panoramics never use it.
ENABLE_INTRAORAL_TOOTH_SEG = _env_bool("ENABLE_INTRAORAL_TOOTH_SEG", True)

# Bone-level heuristic on PA/bitewing once intraoral tooth boxes exist.
# Panoramic bone estimation is unchanged (always on when teeth are present).
ENABLE_INTRAORAL_BONE = _env_bool("ENABLE_INTRAORAL_BONE", True)

# ── Our own caries subsystem (bitewing / PA targeted) ──────────────
# A fine-tuned instance-segmentation model proposes lesions; a reasoning layer
# (anatomical correction + contrast assessment + pathology relay) screens out
# false positives. See caries/ and caries/README.md.
#
# Master switch. When on, the subsystem runs on bitewing and periapical images
# (and optionally panoramics — see ENABLE_CARIES_ON_PANORAMIC). If no trained
# weights are present it uses a classical radiolucency proposer with confidence
# held well below the trained band.
ENABLE_CARIES_SCREENING = _env_bool("ENABLE_CARIES_SCREENING", True)

# Caries screening is clinically for bitewings/PAs. Panoramics keep their
# existing tooth/bone path; caries on pano is opt-in (classical only is weak).
ENABLE_CARIES_ON_PANORAMIC = _env_bool("ENABLE_CARIES_ON_PANORAMIC", False)

# Whether to attempt loading trained weights at all. Independent of the master
# switch so the classical fallback can be exercised on its own for testing.
ENABLE_CARIES_MODEL = _env_bool("ENABLE_CARIES_MODEL", True)

# Where caries/train/export writes the trained checkpoint / ONNX export.
CARIES_WEIGHTS_DIR = _env_str(
    "CARIES_WEIGHTS_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "caries", "weights"),
)

# Model-proposal floor. The reasoning layer and the client slider do the real
# thresholding, so this only trims the model's lowest-ranked proposals.
# Proposal floor for the YOLO caries head. Kept low so early / faint hits still
# reach the reasoning layer; the client confidence slider does the filtering.
CARIES_MODEL_MIN_SCORE = _env_float("CARIES_MODEL_MIN_SCORE", 0.10)

# When true (default), classical radiolucency proposals are merged with the
# trained model's — important while the bitewing weights are still early, and
# for PAs the model was not trained on. False = model-only when weights load.
CARIES_UNION_CLASSICAL = _env_bool("CARIES_UNION_CLASSICAL", True)

# Reasoning accept gate. Align with CONFIDENCE_FLOOR so the UI slider owns
# display filtering rather than the service silently dropping mid-band hits.
CARIES_ACCEPT_THRESHOLD = _env_float("CARIES_ACCEPT_THRESHOLD", 0.18)

# Anatomy-first EDJ pipeline: tooth → enamel/dentin/pulp/EDJ → EDJ-band
# shadows. When on, proposes interproximal candidates from EDJ shadows.
CARIES_ANATOMY_PIPELINE = _env_bool("CARIES_ANATOMY_PIPELINE", True)

# Hard gate: every interproximal finding must pass EDJ-anatomy accept()
# (on EDJ band, enamel/dentin extension, not pulp/bone/gap).
CARIES_ANATOMY_HARD_GATE = _env_bool("CARIES_ANATOMY_HARD_GATE", True)

# Inference resolution for the caries model (bitewing training default).
CARIES_IMGSZ = _env_int("CARIES_IMGSZ", 640)

# Continual learning. When a clinician confirms or rejects a caries hint, the
# image + verdict can be captured as a labelled example that later fine-tunes
# the model (the data flywheel the cleared systems rely on). This writes
# radiographs to disk, so it carries the same patient-data obligations as any
# storage — see caries/README.md and the main README's PDPO section. Set to
# false to disable capture entirely.
ENABLE_CARIES_FEEDBACK = _env_bool("ENABLE_CARIES_FEEDBACK", True)

# Where confirmed/rejected examples accumulate, in YOLO-seg layout, ready for
# caries/train/train_continual.py. Keep this on encrypted storage.
CARIES_CLINIC_DATA_DIR = _env_str(
    "CARIES_CLINIC_DATA_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "caries", "clinic_data"),
)

# Allow triggering a continual-training run from the review screen. Training is
# heavy and runs a subprocess on this machine, so an operator opts in. The run
# is still gated: it only promotes a new model if it does not regress on the
# reference set (see train_continual.py).
ENABLE_CARIES_TRAINING = _env_bool("ENABLE_CARIES_TRAINING", True)

# Prepared public dataset (replay buffer + val/test) that continual training
# mixes with the clinic data. Produced by caries/train/prepare_dataset.py.
CARIES_PUBLIC_DATA_DIR = _env_str(
    "CARIES_PUBLIC_DATA_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "caries", "train", "dataset"),
)

# The condition model's caries / calculus / periapical-radiolucency classes all
# failed its own per-class acceptance gates (caries mAP 0.037 against a 0.30
# floor), and its classification head collapsed so scores cap near 0.04 with no
# calibration. They are withheld by default; enable only for evaluation.
ENABLE_PATHOLOGY_CLASSES = _env_bool("ENABLE_PATHOLOGY_CLASSES", False)

# Follow the model card's documented 1280x704 input rather than the 640x640 in
# the repository's preprocessor_config.json, which disagrees with it.
CONDITION_USE_CARD_RESOLUTION = _env_bool("CONDITION_USE_CARD_RESOLUTION", True)

# Licence position of each stage, reported by /health so the constraint is
# visible at runtime rather than buried in a README.
MODEL_LICENSES = {
    TOOTH_MODEL_REPO: {
        "license": "Proprietary Non-Commercial",
        "commercial_use": "prohibited without a separate agreement",
        "clinical_use": "prohibited",
        "permitted": "academic research, education, internal validation",
        "contact": "bychkov.tech@gmail.com",
    },
    CONDITION_MODEL_REPO: {
        "license": "Apache-2.0",
        "commercial_use": "permitted",
        "clinical_use": "not a cleared device; advisory only",
        "permitted": "commercial and research use under Apache-2.0",
    },
}

# "auto" resolves to cuda when torch reports it available, else cpu.
DEVICE = _env_str("DEVICE", "auto")

# The client owns the user-facing confidence threshold (adjustable slider), so
# the service returns everything above a deliberately low floor and lets the UI
# filter. Raising this floor here would silently cap the slider's range.
CONFIDENCE_FLOOR = _env_float("CONFIDENCE_FLOOR", 0.15)

# Per-stage minimum scores before a detection is considered at all.
TOOTH_MIN_SCORE = _env_float("TOOTH_MIN_SCORE", 0.30)

# Deliberately low: the condition model's head collapse caps its scores near
# 0.04, so a conventional threshold would reject every detection. See
# models/condition_detector.py for the measurement behind this number.
CONDITION_MIN_SCORE = _env_float("CONDITION_MIN_SCORE", 0.02)

# Hard cap on returned findings. The client applies its own cap as well.
MAX_FINDINGS = _env_int("MAX_FINDINGS", 60)

# Anatomy layers are geometric approximations derived from tooth boxes, not a
# trained segmentation model. Set to false to omit them entirely.
EMIT_ANATOMY_LAYERS = _env_bool("EMIT_ANATOMY_LAYERS", True)

# Approximate scale calibration. Panoramic radiographs have no embedded pixel
# spacing, so millimetre output is estimated from mean tooth width. Documented
# as an approximation in the API response and the README.
MEAN_TOOTH_WIDTH_MM = _env_float("MEAN_TOOTH_WIDTH_MM", 8.0)

# Intraoral sensors show teeth larger in the frame; a slightly smaller assumed
# physical width keeps CEJ–crest millimetre estimates in a plausible band.
MEAN_INTRAORAL_TOOTH_WIDTH_MM = _env_float("MEAN_INTRAORAL_TOOTH_WIDTH_MM", 7.0)

# Origins allowed to call this service. Covers the local static server
# (start-server.bat serves 8123) and a GitHub Pages deployment.
_DEFAULT_ORIGINS = ",".join(
    [
        "http://127.0.0.1:8123",
        "http://localhost:8123",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ]
)
ALLOWED_ORIGINS = [
    o.strip() for o in _env_str("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()
]

# When true, any origin is accepted. Convenient for local dev / LAN testing;
# should be false for a cloud deployment.
ALLOW_ANY_ORIGIN = _env_bool("ALLOW_ANY_ORIGIN", True)

SERVICE_VERSION = "xray-ai-service-v1"
