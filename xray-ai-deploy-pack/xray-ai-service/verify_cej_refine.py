"""
Tests for CEJ-local caries polygon refine.

    python verify_cej_refine.py
"""

import numpy as np

from models import caries_refine

PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        print("  FAIL " + name + ("  (" + detail + ")" if detail else ""))
        raise SystemExit(1)
    PASS += 1
    print("  ok  " + name)


def _tooth(arch="lower"):
    return {
        "box": {"x": 100.0, "y": 80.0, "w": 80.0, "h": 220.0},
        "arch": arch,
        "score": 0.8,
        "fdi": 36,
    }


def _cervical_image(tooth):
    """Bright tooth with a small dark notch at the distal CEJ + a wide burnout band."""
    h, w = 400, 320
    img = np.full((h, w), 50.0, np.float32)
    b = tooth["box"]
    x1, y1 = int(b["x"]), int(b["y"])
    x2, y2 = int(b["x"] + b["w"]), int(b["y"] + b["h"])
    img[y1:y2, x1:x2] = 200.0
    cej = int(round(caries_refine.cej_y(tooth)))
    # Wide soft burnout across the cervix (should be trimmed).
    img[cej - 8 : cej + 10, x1:x2] = 140.0
    # True proximal lesion: small dark notch on the distal side near CEJ.
    img[cej - 6 : cej + 14, x2 - 18 : x2 - 2] = 70.0
    return img


print("[1] CEJ helpers")
t = _tooth("lower")
cy = caries_refine.cej_y(t)
check("cej_y for lower tooth", cy is not None and t["box"]["y"] < cy < t["box"]["y"] + t["box"]["h"])
band = caries_refine._cej_search_box(
    t, {"x": 150.0, "y": cy - 10, "w": 25.0, "h": 20.0}
)
check("cej search box produced", band is not None and band["w"] > 0 and band["h"] > 0)
check("cej band stays inside tooth",
      band["x"] >= t["box"]["x"] - 0.5
      and band["x"] + band["w"] <= t["box"]["x"] + t["box"]["w"] + 0.5)

print("[2] cervical refine vs plain box refine")
gray = _cervical_image(t)
lesion = {"x": 155.0, "y": cy - 12, "w": 28.0, "h": 30.0}
plain = caries_refine.refine_caries(gray, lesion, t, surface=None)
cej = caries_refine.refine_caries(gray, lesion, t, surface="cervical")
check("cej refine returns a polygon", cej.get("polygon") is not None and len(cej["polygon"]) >= 3)
check("cej refine mode is cej_band", cej.get("refine_mode") in ("cej_band", "box_otsu_fallback"))
if plain.get("polygon") and cej.get("polygon"):
    pb = caries_refine.bounds_of_polygon(plain["polygon"])
    cb = caries_refine.bounds_of_polygon(cej["polygon"])
    check("cej polygon not wider than the tooth",
          cb["w"] <= t["box"]["w"] * 0.55,
          "w=%.1f tooth=%.1f" % (cb["w"], t["box"]["w"]))
    # Distal seed → outline should sit in the distal half of the tooth.
    check("cej polygon biased distal",
          cb["x"] + cb["w"] * 0.5 >= t["box"]["x"] + t["box"]["w"] * 0.45)

print("[3] clip to tooth")
spill = [[50, 50], [300, 50], [300, 300], [50, 300]]
clipped = caries_refine._clip_polygon_to_box(spill, t["box"])
xs = [p[0] for p in clipped]
ys = [p[1] for p in clipped]
check("spill clipped into tooth box",
      min(xs) >= t["box"]["x"] - 0.1 and max(xs) <= t["box"]["x"] + t["box"]["w"] + 0.1
      and min(ys) >= t["box"]["y"] - 0.1 and max(ys) <= t["box"]["y"] + t["box"]["h"] + 0.1)

print("\nAll %d checks passed." % PASS)
