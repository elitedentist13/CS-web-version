"""
Smoke tests for modality routing + intraoral tooth segmentation.

    python verify_intraoral.py

No network. Uses synthetic images sized like clinic exports.
"""

import sys

import numpy as np
from PIL import Image, ImageDraw

from models import intraoral_teeth, modality as modality_mod
from pipeline import Pipeline


PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        print("  FAIL " + name + ("  (" + detail + ")" if detail else ""))
        raise SystemExit(1)
    PASS += 1
    print("  ok  " + name)


class _Stub:
    ready = False

    def detect(self, *_a, **_k):
        return []


def _pano_like():
    # Wide panoramic frame with a bright arch band.
    arr = np.full((600, 1400), 40, np.uint8)
    arr[180:420, 80:1320] = 170
    return Image.fromarray(arr, "L")


def _pa_like():
    # Portrait PA with 3 bright tooth-shaped blobs.
    arr = np.full((800, 600), 55, np.uint8)
    img = Image.fromarray(arr, "L")
    d = ImageDraw.Draw(img)
    for x0 in (110, 250, 390):
        d.ellipse([x0, 140, x0 + 110, 620], fill=210)
    return img


def _bw_like():
    # Landscape bitewing: upper + lower crown rows.
    arr = np.full((500, 700), 50, np.uint8)
    img = Image.fromarray(arr, "L")
    d = ImageDraw.Draw(img)
    for x0 in (80, 200, 320, 440):
        d.ellipse([x0, 40, x0 + 90, 200], fill=205)   # upper
        d.ellipse([x0, 300, x0 + 90, 460], fill=205)  # lower
    return img


print("[1] modality classifier")
check("wide frame -> panoramic", modality_mod.detect_modality(1400, 600) == "panoramic")
check("portrait -> periapical", modality_mod.detect_modality(600, 800) == "periapical")
check("landscape intraoral -> bitewing", modality_mod.detect_modality(700, 500) == "bitewing")
check("is_intraoral helper", modality_mod.is_intraoral("bitewing") and not modality_mod.is_intraoral("panoramic"))

print("[2] intraoral tooth segmenter")
pa = np.asarray(_pa_like(), dtype=np.float32)
teeth = intraoral_teeth.segment(pa, modality="periapical")
check("PA finds multiple tooth boxes", len(teeth) >= 2, "got %d" % len(teeth))
check("boxes carry score + null fdi", all("box" in t and t.get("fdi") is None for t in teeth))
intraoral_teeth.annotate_arches_intraoral(teeth, "periapical", pa.shape[0])
check("PA arch tagged", all(t.get("arch") in ("upper", "lower") for t in teeth))

bw = np.asarray(_bw_like(), dtype=np.float32)
bw_teeth = intraoral_teeth.segment(bw, modality="bitewing")
check("bitewing finds multiple boxes", len(bw_teeth) >= 3, "got %d" % len(bw_teeth))
intraoral_teeth.annotate_arches_intraoral(bw_teeth, "bitewing", bw.shape[0])
arches = {t["arch"] for t in bw_teeth}
check("bitewing sees both arches", arches == {"upper", "lower"}, str(arches))

print("[3] pipeline routing (stubs — no real ONNX)")
pipe = Pipeline(_Stub(), _Stub(), caries_model=None)
r_pa = pipe.analyze(_pa_like().convert("RGB"))
check("PA modality labelled", r_pa["modality"] == "periapical")
check("PA uses intraoral tooth stage", "intraoral" in r_pa["advisory"]["tooth_stage"])
check("PA caries path open", "disabled" not in r_pa["advisory"]["caries"] or "classical" in r_pa["advisory"]["caries"] or "trained" in r_pa["advisory"]["caries"])
# caries advisory when screening on should not be disabled_for_modality
check("PA caries not modality-disabled", r_pa["advisory"]["caries"] != "disabled_for_modality")

r_pano = pipe.analyze(_pano_like().convert("RGB"))
check("pano modality labelled", r_pano["modality"] == "panoramic")
check("pano tooth stage is fdi path", "pano_fdi" in r_pano["advisory"]["tooth_stage"])
check("pano caries default off", r_pano["advisory"]["caries"] == "disabled_for_modality")

print("\nAll %d checks passed." % PASS)
