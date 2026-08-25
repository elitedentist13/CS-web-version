"""
Deterministic tests for the caries reasoning layer.

Run from the service root:
    python -m caries.verify_reasoning

Needs only numpy (opencv is optional; polygon refinement degrades to None
without it, which these tests tolerate). No trained weights, no network.

The point is to prove the *reasoning* — every veto fires on a case built to
trigger it, a genuine lesion survives, and calibration keeps the classical path
below the trained band and under the ceiling.
"""

import sys

import numpy as np

from caries import reasoning
from models import caries_refine

CROWN = caries_refine.CROWN_RATIO

# A single lower tooth: crown at the top (small y), apex below.
TOOTH = {"box": {"x": 100.0, "y": 40.0, "w": 60.0, "h": 130.0}, "arch": "lower", "fdi": 46}
TEETH = [TOOTH]
H, W = 220, 320


def _canvas(bg=60):
    """Background dark, tooth body bright — like enamel/dentin over bone."""
    g = np.full((H, W), float(bg), dtype=np.float32)
    b = TOOTH["box"]
    g[int(b["y"]):int(b["y"] + b["h"]), int(b["x"]):int(b["x"] + b["w"])] = 180.0
    return g


def _darken(g, x, y, w, h, depth, rim=None):
    x, y, w, h = int(x), int(y), int(w), int(h)
    g[y:y + h, x:x + w] -= depth
    if rim is not None:
        # A bright 1px rim just outside the box → a hard, man-made-looking edge.
        g[max(0, y - 1), x:x + w] = rim
        g[min(H - 1, y + h), x:x + w] = rim
        g[y:y + h, max(0, x - 1)] = rim
        g[y:y + h, min(W - 1, x + w)] = rim
    return {"x": float(x), "y": float(y), "w": float(w), "h": float(h)}


def cand(box, score=0.7, stage=None):
    return {"box": box, "score": score, "polygon": None, "stage": stage}


PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        print("  FAIL " + name + ("  (" + detail + ")" if detail else ""))
        raise SystemExit(1)
    PASS += 1
    print("  ok  " + name)


def only_vetoes(candidate, expect_empty_output=True, **screen_kw):
    g = screen_kw.pop("gray")
    out = reasoning.screen(g, [candidate], TEETH, screen_kw.pop("rest", []),
                           **screen_kw)
    return out


print("anatomical correction")

# Classic EDJ-crossing wedge under mesial contact (spans enamel→dentin).
EDGE = int(TOOTH["box"]["y"])
EDJ = int(EDGE + TOOTH["box"]["h"] * CROWN * caries_refine.ENAMEL_BAND_RATIO)
# x=108 → rel_x≈0.18; box deliberately straddles the EDJ line.
CONTACT_DENTIN = (108, EDJ - 6, 10, 16)

g = _canvas()
lesion = _darken(g, *CONTACT_DENTIN, 55)
out = reasoning.screen(
    g,
    [cand(lesion) | {"prefer_surface": "interproximal",
                     "interproximal_seed": True, "edj_seed": True}],
    TEETH, [], has_model=True,
)
check("genuine contact-dentin lesion is surfaced", len(out) == 1, str(out))
check("surface classified interproximal", out and out[0]["surface"] == "interproximal",
      out[0]["surface"] if out else "none")

g = _canvas()
pulp = _darken(g, 122, 95, 14, 20, 55)  # inside the central pulp column
out = reasoning.screen(g, [cand(pulp)], TEETH, [], has_model=True)
check("pulp-chamber lucency is vetoed", len(out) == 0)

g = _canvas()
# Deep root / bone well apical of the EDJ contact band (not a caries target).
bone = _darken(g, 108, 145, 12, 14, 55)
out = reasoning.screen(g, [cand(bone)], TEETH, [], has_model=True)
check("deep root / bone lucency is vetoed", len(out) == 0)

g = _canvas()
# Empty interdental gap — outermost mesial rim of the tooth box.
gap = _darken(g, 100, EDJ + 2, 4, 12, 80)
out = reasoning.screen(
    g,
    [cand(gap) | {"prefer_surface": "interproximal", "interproximal_seed": True}],
    TEETH, [], has_model=True,
)
check("empty interdental gap is vetoed", len(out) == 0)

g = _canvas()
# Box straddling EDJ with clear E+D shares after refine/fractions.
edj = _darken(g, 108, EDJ - 6, 10, 16, 55)
c_edj = cand(edj, score=0.75) | {
    "prefer_surface": "interproximal",
    "interproximal_seed": True,
    "edj_seed": True,
    "core_box": {"x": 108.0, "y": float(EDJ - 6), "w": 10.0, "h": 16.0},
}
out = reasoning.screen(g, [c_edj], TEETH, [], has_model=True)
check("contact-dentin EDJ lesion is surfaced", len(out) == 1, str(out))
check("contact-dentin surface is interproximal",
      out and out[0]["surface"] == "interproximal",
      out[0]["surface"] if out else "none")
if out:
    check("EDJ crossing flagged", bool(out[0].get("edj_crossing") or
          "edj_crossing" in (out[0].get("audit", {}).get("flags") or [])))

g = _canvas()
off = {"x": 5.0, "y": 5.0, "w": 12.0, "h": 12.0}  # nowhere near the tooth
out = reasoning.screen(g, [cand(off)], TEETH, [], has_model=True)
check("off-tooth candidate is vetoed", len(out) == 0)

print("contrast assessment")

g = _canvas()
faint = _darken(g, *CONTACT_DENTIN, 3)  # barely darker than surroundings
out = reasoning.screen(
    g, [cand(faint) | {"prefer_surface": "interproximal", "interproximal_seed": True}],
    TEETH, [], has_model=True,
)
check("low-contrast candidate is vetoed", len(out) == 0)

g = _canvas()
hard = _darken(g, *CONTACT_DENTIN, 12, rim=250)  # bright rim → step edge
out = reasoning.screen(
    g, [cand(hard) | {"prefer_surface": "interproximal", "interproximal_seed": True}],
    TEETH, [], has_model=True,
)
check("hard man-made edge is vetoed", len(out) == 0)

print("pathology relay")

g = _canvas()
les = _darken(g, *CONTACT_DENTIN, 55)
resto = {"x": float(CONTACT_DENTIN[0] - 1), "y": float(CONTACT_DENTIN[1] - 1),
         "w": 16.0, "h": 16.0}
out = reasoning.screen(
    g, [cand(les) | {"prefer_surface": "interproximal", "interproximal_seed": True}],
    TEETH, [resto], has_model=True,
)
check("candidate that IS a restoration is vetoed", len(out) == 0)

g = _canvas()
les = _darken(g, *CONTACT_DENTIN, 55)
near = {"x": float(CONTACT_DENTIN[0] + 14), "y": float(CONTACT_DENTIN[1]),
        "w": 12.0, "h": 12.0}
out = reasoning.screen(
    g, [cand(les) | {"prefer_surface": "interproximal", "interproximal_seed": True}],
    TEETH, [near], has_model=True,
)
check("peri-restoration lucency survives but is flagged", len(out) == 1 and
      "near_restoration" in (out[0].get("relay_flags") or []), str(out))

g = _canvas()
# Wide, diffuse, cervical band spanning most of the tooth width → burnout.
burn = _darken(g, 103, 88, 44, 8, 40)
out = reasoning.screen(g, [cand(burn)], TEETH, [], has_model=True)
check("cervical burnout band is vetoed", len(out) == 0)

print("severity + calibration")

g = _canvas()
les = _darken(g, *CONTACT_DENTIN, 55)
hint = {"prefer_surface": "interproximal", "interproximal_seed": True, "edj_seed": True}
inc = reasoning.screen(g, [cand(les, stage=1) | hint], TEETH, [], has_model=True)
prog = reasoning.screen(g, [cand(les, stage=3) | hint], TEETH, [], has_model=True)
check("stage 1 → incipient", inc and inc[0]["type"] == "caries_incipient")
check("stage 3 → progressed", prog and prog[0]["type"] == "caries_progressed")

cfg = reasoning.ReasoningConfig()
trained = reasoning.calibrate(0.7, 1.0, 1.0, 0.0, cfg, has_model=True)
classical = reasoning.calibrate(0.7, 1.0, 1.0, 0.0, cfg, has_model=False)
check("confidence respects the ceiling", trained <= cfg.confidence_ceiling + 1e-9)
check("classical path stays below the trained band", classical < trained,
      "classical=%.3f trained=%.3f" % (classical, trained))
check("classical path respects its own cap", classical <= cfg.classical_ceiling + 1e-9)
check("penalty lowers confidence",
      reasoning.calibrate(0.7, 1.0, 1.0, 0.4, cfg, True) < trained)

print("provenance + dedupe")

g = _canvas()
les = _darken(g, *CONTACT_DENTIN, 55)
hint = {"prefer_surface": "interproximal", "interproximal_seed": True, "edj_seed": True}
out = reasoning.screen(g, [cand(les) | hint], TEETH, [], has_model=True)
check("finding carries screening provenance",
      out and out[0]["source"] == "cs-caries-workflow" and out[0]["screening"] is True)
check("finding carries an audit trail", out and "audit" in out[0])

g = _canvas()
les = _darken(g, CONTACT_DENTIN[0], CONTACT_DENTIN[1], 12, 14, 55)
dupe = {"x": float(CONTACT_DENTIN[0] + 1), "y": float(CONTACT_DENTIN[1] + 1),
        "w": 12.0, "h": 14.0}
out = reasoning.screen(
    g,
    [cand(les, score=0.8) | hint, cand(dupe, score=0.6) | hint],
    TEETH, [], has_model=True,
)
check("overlapping candidates are de-duplicated", len(out) == 1, str(len(out)))

print("\n%d checks passed" % PASS)
