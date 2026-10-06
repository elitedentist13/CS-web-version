"""Banana UNet landmark vocabulary.

Aariz channel order is the insertion order of Dental_001
`src/config.ANATOMICAL_LANDMARKS` (29 heatmaps). Banana maps 19 of those
onto the sidecar ISBI ids and keeps U1a / L1a / Pn as extra handles.
"""
from pathlib import Path

NUM_LANDMARKS = 29
INPUT_SIZE = 512
HEATMAP_SIZE = 256
IMAGE_SIZE = (INPUT_SIZE, INPUT_SIZE)
# Gaussian std on the 256 heatmap. 1.5 is sharper than Dental_001's sigma=2
# so the mode sits closer to the labelled point.
HEATMAP_SIGMA = 1.5
# Local soft-argmax window. Radius 5 covers a sigma≈2 blob from older weights.
PEAK_RADIUS = 5
PEAK_BETA = 16.0
BATCH_SIZE = 8
VALID_BATCH_SIZE = 8

HOME = Path(__file__).resolve().parent
WEIGHTS_DIR = HOME / "weights"
SERVICE_WEIGHTS_DIR = HOME.parents[1] / "xray-ai-service" / "ceph" / "weights"

HF_REPO = "chemahc94/Cephalometric-Landmark-CVM"
HF_UNET_REPO = "chemahc94/dental-unet"
UNET_NAMES = (
    "best_unet_transfer_model_512px.pth",
    "best_model.pth",
    "resnet50_unet.pth",
    "banana_unet.pth",
)

# Insertion order of Dental_001 src/config.ANATOMICAL_LANDMARKS (channel 0..28).
AARIZ_SYMBOLS = (
    "A", "ANS", "B", "Me", "N", "Or", "Pog", "PNS", "Pn", "R",
    "S", "Ar", "Co", "Gn", "Go", "Po", "LPM", "LIT", "LMT", "UPM",
    "UIA", "UIT", "UMT", "LIA", "Li", "Ls", "N`", "Pog`", "Sn",
)

AARIZ_TITLES = {
    "A": "A-point",
    "ANS": "Anterior Nasal Spine",
    "B": "B-point",
    "Me": "Menton",
    "N": "Nasion",
    "Or": "Orbitale",
    "Pog": "Pogonion",
    "PNS": "Posterior Nasal Spine",
    "Pn": "Pronasale",
    "R": "Ramus",
    "S": "Sella",
    "Ar": "Articulare",
    "Co": "Condylion",
    "Gn": "Gnathion",
    "Go": "Gonion",
    "Po": "Porion",
    "LPM": "Lower 2nd PM Cusp Tip",
    "LIT": "Lower Incisor Tip",
    "LMT": "Lower Molar Cusp Tip",
    "UPM": "Upper 2nd PM Cusp Tip",
    "UIA": "Upper Incisor Apex",
    "UIT": "Upper Incisor Tip",
    "UMT": "Upper Molar Cusp Tip",
    "LIA": "Lower Incisor Apex",
    "Li": "Labrale inferius",
    "Ls": "Labrale superius",
    "N`": "Soft Tissue Nasion",
    "Pog`": "Soft Tissue Pogonion",
    "Sn": "Subnasale",
}

ISBI_FROM_AARIZ = {
    "S": "S", "N": "N", "Or": "Or", "Po": "Po", "A": "A", "B": "B",
    "Pog": "Pog", "Me": "Me", "Gn": "Gn", "Go": "Go",
    "LIT": "L1", "UIT": "U1", "Ls": "Ls", "Li": "Li", "Sn": "Sn",
    "Pog`": "PogS", "PNS": "PNS", "ANS": "ANS", "Ar": "Ar",
}
EXTRA_FROM_AARIZ = {"UIA": "U1a", "LIA": "L1a", "Pn": "Pn"}
