"""
Free-form anatomy layer polygons for bitewing / PA.

    python verify_intraoral_layers.py
"""

import numpy as np
from PIL import Image, ImageDraw

from models import intraoral_layers, modality as modality_mod
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


def _pa_image():
    arr = np.full((800, 600), 45, np.uint8)
    img = Image.fromarray(arr, "L")
    d = ImageDraw.Draw(img)
    # Three bright teeth with a darker pulp-ish core.
    for x0 in (110, 250, 390):
        d.ellipse([x0, 140, x0 + 110, 620], fill=210)
        d.ellipse([x0 + 35, 280, x0 + 75, 480], fill=120)
    return img


print("[1] free-form layers on a synthetic PA tooth")
img = _pa_image()
gray = np.asarray(img, dtype=np.float32)
tooth = {
    "box": {"x": 250.0, "y": 140.0, "w": 110.0, "h": 480.0},
    "arch": "lower",
    "score": 0.8,
    "fdi": None,
}
layers = intraoral_layers.layers_for_tooth(gray, tooth)
by_name = {L["layer"]: L for L in layers}
check("emits enamel + dentin", "enamel" in by_name and "dentin" in by_name)
check("tooth silhouette attached", isinstance(tooth.get("polygon"), list) and len(tooth["polygon"]) >= 6)
for name in ("enamel", "dentin"):
    poly = by_name[name]["polygon"]
    check("%s is free-form (>4 verts)" % name, len(poly) > 4, "verts=%d" % len(poly))
# Rectangle AABB would have all x on only two values; free-form should vary.
xs = sorted(set(round(p[0], 1) for p in by_name["enamel"]["polygon"]))
check("enamel x coords vary (not a rectangle)", len(xs) >= 3, str(xs[:8]))

print("[2] pipeline advisory mode")
pipe = Pipeline(_Stub(), _Stub(), caries_model=None)
resp = pipe.analyze(img.convert("RGB"))
check("modality periapical", resp["modality"] == "periapical")
check("anatomy mode freeform or fallback",
      resp["advisory"]["anatomy_layers"] in (
          "intraoral_freeform", "geometric_rectangles_fallback"
      ),
      resp["advisory"].get("anatomy_layers"))
if resp["anatomy_layers"]:
    verts = [len(L["polygon"]) for L in resp["anatomy_layers"]]
    check("pipeline layers include free-form polys", max(verts) > 4, str(verts))

print("[3] panoramic still uses rectangles")
pano = Image.fromarray(np.full((600, 1400), 40, np.uint8), "L")
d = ImageDraw.Draw(pano)
d.rectangle([80, 180, 1320, 420], fill=170)
# Force modality path: wide image → panoramic; no teeth from stub → empty layers OK
r_pano = pipe.analyze(pano.convert("RGB"))
check("pano modality", r_pano["modality"] == "panoramic")
check("pano anatomy mode not freeform",
      r_pano["advisory"]["anatomy_layers"] != "intraoral_freeform")

print("\nAll %d checks passed." % PASS)
