"""
Tests for the EDJ anatomy-first caries pipeline.

Run from the service root:
    python -m caries.verify_edj_anatomy
"""

import numpy as np

from caries import edj_anatomy
from models import intraoral_layers


H, W = 220, 320
TOOTH = {
    "box": {"x": 100.0, "y": 40.0, "w": 60.0, "h": 130.0},
    "arch": "lower",
    "fdi": 46,
}


def _canvas():
    g = np.full((H, W), 50.0, dtype=np.float32)
    b = TOOTH["box"]
    g[int(b["y"]): int(b["y"] + b["h"]), int(b["x"]): int(b["x"] + b["w"])] = 180.0
    return g


PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        print("  FAIL " + name + (("  (" + detail + ")") if detail else ""))
        raise SystemExit(1)
    PASS += 1
    print("  ok  " + name)


print("EDJ anatomy pipeline")

g = _canvas()
# Classic mesial EDJ wedge: darken enamel→dentin near contact.
from models import caries_refine, geometry
edge = geometry.crown_edge_y(TOOTH, "lower")
edj = caries_refine.edj_y(TOOTH)
x0, y0 = 108, int(edj - 6)
g[y0:y0 + 16, x0:x0 + 10] -= 55

anatomy = intraoral_layers.prepare_tooth_anatomy(g, TOOTH)
check("anatomy attached", anatomy is not None and TOOTH.get("anatomy") is not None)
check("has enamel mask", np.any(anatomy["masks"]["enamel"]))
check("has dentin mask", np.any(anatomy["masks"]["dentin"]))
check("has pulp mask", np.any(anatomy["masks"]["pulp"]))
check("has EDJ band", np.any(anatomy["masks"]["edj_band"]))
check("has EDJ curve", len(anatomy.get("edj_curve") or []) >= 2)

cands = edj_anatomy.propose_candidates(g, [TOOTH])
check("proposer finds EDJ shadow", len(cands) >= 1, str(len(cands)))

ok, reason, meta = edj_anatomy.accept(cands[0], TOOTH, g)
check("accepts EDJ wedge", ok, str(reason))
check("meta has shape", bool(meta.get("shape")))

# Bone / outside tooth
bone = {"box": {"x": 10.0, "y": 180.0, "w": 14.0, "h": 14.0}, "score": 0.8}
ok, reason, _ = edj_anatomy.accept(bone, TOOTH, g)
check("rejects off-tooth bone lucency", not ok, str(reason))

# Empty gap on outer rim
gap = {"box": {"x": 100.0, "y": float(edj), "w": 4.0, "h": 12.0}, "score": 0.8,
       "prefer_surface": "interproximal", "interproximal_seed": True}
# Darken gap
g[int(edj): int(edj) + 12, 100:104] = 20
ok, reason, _ = edj_anatomy.accept(gap, TOOTH, g)
check("rejects empty interdental gap", not ok or reason in (
    "not_on_edj", "outside_tooth", "no_enamel_dentin", "weak_tissue",
    "not_edj_extension", "not_contact_column", "tiny",
), str(reason))

# Pulp centre
pulp_box = {
    "box": {
        "x": TOOTH["box"]["x"] + TOOTH["box"]["w"] * 0.40,
        "y": TOOTH["box"]["y"] + TOOTH["box"]["h"] * 0.45,
        "w": 12.0,
        "h": 16.0,
    },
    "score": 0.8,
}
ok, reason, _ = edj_anatomy.accept(pulp_box, TOOTH, g)
check("rejects pulp-chamber candidate", not ok, str(reason))

print()
print("%d checks passed" % PASS)
