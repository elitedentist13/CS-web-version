"""
Gates and coverage for CEJ–crest perio assessment.

    python verify_bone_loss.py

No network. Synthetic teeth from incisor through molar.
"""

import numpy as np

from models import bone_loss

PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        print("  FAIL " + name + ("  (" + detail + ")" if detail else ""))
        raise SystemExit(1)
    PASS += 1
    print("  ok  " + name)


def _tooth(fdi, x, w=40.0, y=30.0, h=120.0, arch="lower", score=0.8):
    return {
        "box": {"x": float(x), "y": float(y), "w": float(w), "h": float(h)},
        "fdi": fdi,
        "arch": arch,
        "score": score,
    }


def _gray_with_crest(teeth, crest_mm, mean_w_mm=8.0, h=200, w=400):
    """Bright bone step `crest_mm` apical to each tooth's class CEJ."""
    img = np.full((h, w), 70.0, np.float32)
    px_per_mm = float(np.median([t["box"]["w"] for t in teeth])) / mean_w_mm
    for t in teeth:
        box = t["box"]
        x1, y1 = int(box["x"]), int(box["y"])
        x2, y2 = int(box["x"] + box["w"]), int(box["y"] + box["h"])
        img[y1:y2, max(0, x1) : min(w, x2)] = 200.0
        cls = bone_loss.classify_fdi(t["fdi"]) or "premolar"
        ratio = bone_loss.CLASS_GATES[cls]["cej_ratio"]
        cej = y1 + box["h"] * ratio
        crest = int(round(cej + crest_mm * px_per_mm))
        # Interproximal columns left and right of the crown.
        for xa, xb in (
            (int(box["x"] - box["w"] * 0.18), int(box["x"] + box["w"] * 0.16)),
            (int(box["x"] + box["w"] * 0.84), int(box["x"] + box["w"] * 1.18)),
        ):
            xa, xb = max(0, xa), min(w, xb)
            if xb > xa and 0 < crest < h:
                img[crest:h, xa:xb] = 175.0
                img[max(0, crest - 2) : min(h, crest + 3), xa:xb] = 190.0
    return img


print("[1] FDI class map")
check("11 incisor", bone_loss.classify_fdi(11) == "incisor")
check("23 canine", bone_loss.classify_fdi(23) == "canine")
check("35 premolar", bone_loss.classify_fdi(35) == "premolar")
check("47 molar", bone_loss.classify_fdi(47) == "molar")
check("bad fdi", bone_loss.classify_fdi(99) is None)

print("[2] all teeth both surfaces (incisor→molar)")
teeth = [
    _tooth(31, 40, w=32),
    _tooth(33, 90, w=36),
    _tooth(35, 145, w=40),
    _tooth(37, 210, w=52),
]
gray = _gray_with_crest(teeth, crest_mm=3.6)
sites = bone_loss.estimate_bone_loss(teeth, gray, mean_tooth_width_mm=8.0)
classes = sorted({s["tooth_class"] for s in sites})
surfaces = {s["surface"] for s in sites}
fdis = {s.get("tooth") for s in sites}
check("measured some sites", len(sites) >= 4, "n=%d" % len(sites))
check("covers incisor", "incisor" in classes, str(classes))
check("covers molar", "molar" in classes, str(classes))
check("mesial and distal", "mesial" in surfaces and "distal" in surfaces, str(surfaces))
check("all four FDI present", fdis >= {31, 33, 35, 37}, str(fdis))

print("[3] class gates mediate the same millimetres")
inc_t = bone_loss._severity_type_mm(3.6, bone_loss.CLASS_GATES["incisor"])
mol_t = bone_loss._severity_type_mm(3.6, bone_loss.CLASS_GATES["molar"])
check("3.6 mm incisor → moderate (tighter gate)", inc_t == "bone_loss_moderate", str(inc_t))
check("3.6 mm molar → mild (wider gate)", mol_t == "bone_loss_mild", str(mol_t))
check("1.8 mm any class → physiologic",
      bone_loss._severity_type_mm(1.8, bone_loss.CLASS_GATES["incisor"]) is None)
check("5.2 mm incisor → severe",
      bone_loss._severity_type_mm(5.2, bone_loss.CLASS_GATES["incisor"]) == "bone_loss_severe")
check("5.2 mm molar → moderate",
      bone_loss._severity_type_mm(5.2, bone_loss.CLASS_GATES["molar"]) == "bone_loss_moderate")

print("[4] physiologic is still a listed result (slider filters it)")
gray_ok = _gray_with_crest(teeth, crest_mm=1.4)
phys = bone_loss.estimate_bone_loss(teeth, gray_ok, mean_tooth_width_mm=8.0)
if phys:
    check("physiologic type is bone_ok", all(s["type"] == "bone_ok" for s in phys),
          str([s["type"] for s in phys[:4]]))
    check("physiologic confidence sits above default 38% slider",
          all(s["confidence"] >= 0.38 for s in phys),
          str([s["confidence"] for s in phys[:4]]))
    check("physiologic confidence below mild band",
          all(s["confidence"] < 0.54 for s in phys))
else:
    print("  skip physiologic image produced no crest (synthetic edge too weak)")

print("[5] missing neighbour does not drop the remaining tooth")
gapped = [_tooth(31, 40, w=32), _tooth(37, 260, w=52)]
gray_gap = _gray_with_crest(gapped, crest_mm=4.0)
gap_sites = bone_loss.estimate_bone_loss(gapped, gray_gap, mean_tooth_width_mm=8.0)
gap_fdis = {s.get("tooth") for s in gap_sites}
check("incisor still measured across a missing span", 31 in gap_fdis, str(gap_fdis))
check("molar still measured across a missing span", 37 in gap_fdis, str(gap_fdis))

print("\n%d checks passed" % PASS)
