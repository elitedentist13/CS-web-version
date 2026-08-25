# CS X-ray Assist — local AI service

Local inference backend for the X-ray Assist overlay in the clinic app. It
implements the contract `app-xray-ai.js` already expects on port **8765**:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Reachability + per-model load status |
| `POST /analyze` | Multipart field `file` (JPEG) → findings JSON |

---

## ⚠ Two blocking issues found during validation

These were measured by running the real weights on real panoramic radiographs.
Read both before deploying anything to a clinic.

### 1. The tooth detector's licence prohibits clinical and commercial use

`abychkov/dental-fdi-detection` ships a **Proprietary Non-Commercial licence**:

> **PROHIBITED USE:** Any commercial use without a separate license · Clinical or
> diagnostic use · Redistribution, sublicensing, or derivative works

Permitted use is academic research, education and internal technical validation.
Running it on patients in a live clinic is outside that grant. Commercial
licensing: `bychkov.tech@gmail.com`.

This matters because Stage 1 is load-bearing: bone-loss measurement and the
enamel/dentin split are both anchored to its tooth boxes. Set
`ENABLE_TOOTH_MODEL=false` to run without it and lose those outputs. The service
logs the restriction on every start and reports it in `GET /health`.

The condition detector (`Mobe1/…`) is Apache-2.0 and has no such restriction.

### 2. The condition detector cannot detect caries

Its own model card documents a **classification-head bias collapse**: the class
logits never moved off their focal-loss prior, so "inference on real OPGs caps at
~0.034 sigmoid score." Measured here on real panoramics, the highest score across
all 300 queries and 13 classes was **0.043** — matching the card exactly. Two
consequences:

- **Confidence is uncalibrated.** The scores are a usable *ranking* only. A
  percentage threshold cannot be read as probability for this stage.
- **The pathology classes are far below their own acceptance gates**, per the
  card's own evaluation table:

| Class | mAP@0.5:0.95 | Gate | Verdict |
|-------|-------------:|-----:|---------|
| crown | 0.744 | — | strong |
| implant | 0.741 | — | strong |
| bridge | 0.688 | — | strong |
| RC-treated | 0.680 | — | strong |
| restoration | 0.212 | — | acceptable |
| periapical-radiolucency | 0.073 | 0.25 | **FAIL** |
| **caries** | **0.037** | **0.30** | **FAIL** |
| calculus | 0.014 | 0.10 | **FAIL** |

The classes that work are restorative hardware; the disease classes are close to
noise. The card lists "any clinical decision-making" as out of scope and says
caries/calculus/periapical must not be surfaced without explicit low-confidence
framing.

**Therefore `ENABLE_PATHOLOGY_CLASSES` defaults to `false`.** Out of the box this
service reports restorations, tooth positions and bone-loss geometry — not
caries. Set it to `true` only for evaluation, and read the scores as a ranking.

If caries detection is the goal, no currently-available open checkpoint delivers
it at clinical quality. The realistic routes are a commercial API (Pearl,
Overjet, VideaHealth), a licensed model from one of the authors above, or
training on annotated data.

---

## What this is and is not

**This is decision support, not a diagnosis, and not a cleared medical device.**
A clinician must review every image and make the determination. The output
categories have genuinely different levels of rigour behind them, and the service
reports which is which in the `advisory` block of every response.

| Output | How it is produced | Trust level |
|--------|--------------------|-------------|
| Tooth positions | Trained RT-DETR ONNX detector | **Works well** — 30/32 teeth, both arches, on real panoramics |
| FDI tooth *numbers* | Same detector's class head | Unreliable — see below |
| Restoration / crown / implant | Trained transformer detector | Reasonable (mAP 0.68–0.74) |
| Caries / calculus / periapical | Same detector | **Near-noise, off by default** |
| Caries polygon + enamel/dentin % | Classical CV inside a detected box | Refinement, not segmentation |
| Periodontal bone loss | Geometric heuristic on tooth boxes | Plausible but unvalidated estimate |

### When this service is not running, the browser does far less

`app-xray-ai.js` has an offline fallback that runs in the browser with no model
at all — it thresholds pixel darkness and contrast. It used to report
`caries_progressed` at up to 94% confidence from that alone, which meant a
clinician saw *more* caries markings, asserted *more* confidently, precisely
when the trained models were unavailable.

The fallback is now restricted to the things it can actually support:
restorations (radiopaque hardware) and bone levels (CEJ-to-crest geometry). It
withholds caries, calculus, periapical radiolucency and defective margins — the
same classes this service gates behind `ENABLE_PATHOLOGY_CLASSES` — and the
panel shows an explicit offline notice so that missing caries markings are not
read as a negative finding. `PATHOLOGY_TYPES` in `app-xray-ai.js` is the
client-side counterpart to that flag; keep the two lists in step.

Run `node xray-ai-service/verify_client_gate.js` from the repo root to check
that gate. It needs no Python, no models and no network.

### FDI numbering is not reliable

The tooth detector localizes teeth well but its quadrant assignment is imperfect:
on real radiographs it labels mirror-image teeth with the same class (reporting
13 where 23 is expected). The model card states the "anatomical consistency
engine" that resolves this is a **separate proprietary module**, not included.
Treat `fdi` as a grouping key, never as a tooth number to show a clinician.

### Bone loss is a heuristic, not a model

Pearl's CEJ-to-bone-crest measurement is a **separately FDA-cleared device**
(Second Opinion BLE). No equivalent pretrained checkpoint is publicly
downloadable — only training code (YOLOv8-pose keypoint pipelines) and datasets
such as BoneLoss-PAN769 (PhysioNet). `models/bone_loss.py` therefore estimates
bone loss geometrically, anchored to real tooth detections. That anchoring makes
it better than scanning raw pixels, but it is still an estimate, and its
confidence is deliberately capped at 0.80 so it never presents as a
high-certainty model output.

To upgrade later, reimplement `estimate_bone_loss()` — it is the only function
the pipeline calls, so nothing else (including the browser) needs to change.

**What it does on real radiographs.** Across the two panoramics used for
validation it measured 47 interproximal sites, with a median CEJ-to-crest
distance of ~1.2 mm — physiologically normal, and correctly not reported. Eleven
sites exceeded the 2 mm cutoff and were reported, at 2.3–5.8 mm. That is a
believable distribution, but it has **not** been checked against clinician
ground truth, so it is an indicator for review, not a measurement.

**Known confound: the posterior maxilla.** The maxillary sinus floor produces a
strong bright edge in the same column the crest search scans, so molar sites can
over-read. `CREST_SEARCH_END_FRAC` caps the search at 60% of root length to
suppress this (uncapped, it reported 9–11 mm of "severe" loss at healthy molar
sites). Occasional over-reading in that region remains.

---

## Setup

### Option A — Windows launcher (simplest)

From the repo root, double-click **`start-xray-ai.bat`**. It creates a virtual
environment, installs dependencies, downloads the weights on first run, and
starts the service. Leave the window open while using X-ray Assist.

If Python is missing it tells you so and exits cleanly — the app still works,
falling back to its in-browser heuristic.

The launcher deliberately puts the environment in
`%LOCALAPPDATA%\cs-xray-ai\` rather than inside the repo. PyTorch ships very
deeply nested files, and a venv under a path like
`Downloads\CS-web-version-main (2)\CS-web-version-main\xray-ai-service\` pushes
them past the Windows 260-character limit — pip then fails partway through with
`WinError 206: filename too long`, leaving a half-installed torch. Total download
is roughly 1 GB of packages plus 256 MB of weights.

### Option B — manual

```bash
cd xray-ai-service
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # Linux/macOS

pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt
python download_models.py         # one time, ~256 MB
python -m uvicorn main:app --host 127.0.0.1 --port 8765
```

On Windows, create that venv somewhere with a short path (e.g. `C:\cs-xray-ai\`)
for the `MAX_PATH` reason above, and point `MODEL_CACHE_DIR` at it.

### Option C — Docker (the portable path)

```bash
cd xray-ai-service
docker build -t cs-xray-ai .
docker run --rm -p 8765:8765 -v cs-xray-models:/app/model_cache cs-xray-ai
```

Then run `download_models.py` once inside the container, or uncomment the bake
step in the `Dockerfile` for an immutable image.

### Gated models

If a repository requires an access token:

```bat
setx HF_TOKEN hf_xxxxx
```

Open a new shell afterwards so the variable is picked up.

---

## Verifying it works

```bash
curl http://127.0.0.1:8765/health
```

`ready: true` means at least one stage loaded. The `models` block reports each
stage separately, including the load error when a stage failed:

```json
{
  "ok": true,
  "ready": true,
  "models": {
    "tooth_detector":     { "ready": true,  "error": null },
    "condition_detector": { "ready": true,  "error": null, "device": "cpu" }
  }
}
```

In the app: open a patient's X-ray, click **🦷 AI**. The panel footer shows
whether results came from this service or the browser fallback.

> **Sanity check on first run.** `teeth_detected` should be roughly 20–32 on a
> full panoramic. If it is 0, the ONNX output layout was not decoded — check the
> startup log for a decode error.

### The ONNX tensor contract, as measured

Third-party ONNX exports have no guaranteed layout, so this one was determined by
inspecting the real graph rather than assumed:

```
input   images   float32 [batch, 3, height, width]   dynamic H/W
output  output0  float32 [batch, 300, 36]
                 cols 0–3    normalized cxcywh, relative to the source image
                 cols 4–35   per-class scores, sigmoid already applied
                             (32 classes, one per permanent tooth)
```

Despite the dynamic height/width axes, the model only performs well at
**640×640 with a plain resize** — no aspect-ratio preservation and no padding,
which is the RT-DETR convention (the model's `NOTICE` confirms an RT-DETR
lineage). This was verified against real radiographs: a plain resize found 30
teeth, letterboxing found 29, and feeding native resolution found 3.

---

## Performance expectations

Measured on this machine, CPU-only, on a 2027×940 panoramic:

| Stage | CPU | GPU (expected) |
|-------|-----|----------------|
| Tooth detection (RT-DETR ONNX) | ~0.2 s | ~20 ms |
| Condition detection (D-FINE Large) | ~0.4 s | ~0.2 s |
| Bone loss + caries refinement | < 0.1 s | same |
| **Total `POST /analyze`** | **~0.8–1.0 s** | — |

One-off load cost at startup: ~0.7 s for the ONNX session, ~5 s for the
transformer. Models load at startup, so the first clinical click is not the slow
one. The browser allows up to 120 s per analysis, so CPU-only operation is
comfortable. Set `DEVICE=cuda` to use a GPU when present (`auto` detects it).

---

## Configuration

All settings are environment variables (see `config.py`), which is what makes
the same code run locally or in cloud unchanged.

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST` / `PORT` | `127.0.0.1` / `8765` | Bind address |
| `MODEL_CACHE_DIR` | `./model_cache` | Weight cache (mount as a volume) |
| `DEVICE` | `auto` | `auto` / `cpu` / `cuda` |
| `CONFIDENCE_FLOOR` | `0.15` | Lowest score returned — see note below |
| `TOOTH_MIN_SCORE` | `0.30` | Stage 1 cutoff |
| `CONDITION_MIN_SCORE` | `0.02` | Stage 2 cutoff — low because that model's scores cap near 0.04 |
| `ENABLE_TOOTH_MODEL` | `true` | Set `false` to comply with the Stage 1 licence |
| `ENABLE_CONDITION_MODEL` | `true` | Set `false` to skip Stage 2 entirely |
| `ENABLE_PATHOLOGY_CLASSES` | `false` | Emit caries/calculus/periapical (evaluation only) |
| `CONDITION_USE_CARD_RESOLUTION` | `true` | Use the card's 1280×704 over the repo's 640×640 |
| `MAX_FINDINGS` | `60` | Server-side cap |
| `EMIT_ANATOMY_LAYERS` | `true` | Emit geometric enamel/dentin/pulp overlays |
| `MEAN_TOOTH_WIDTH_MM` | `8.0` | mm calibration constant |
| `ALLOWED_ORIGINS` | local servers | Comma-separated CORS allowlist |
| `ALLOW_ANY_ORIGIN` | `true` | Set `false` for cloud deployments |

The condition model's repository ships a `preprocessor_config.json` specifying a
640×640 square resize, but its model card documents training at **1280×704 with
aspect-preserving fit + padding**. They disagree; this service follows the card,
since that is the resolution the weights were actually trained at. Set
`CONDITION_USE_CARD_RESOLUTION=false` to fall back to the shipped config.

**Do not raise `CONFIDENCE_FLOOR` to hide noise.** The browser owns the
user-facing threshold via the confidence slider; raising the floor here silently
caps the slider's range so clinicians cannot widen the search.

### Millimetre values are approximate

Panoramic radiographs carry no pixel-spacing metadata, so `measurement_mm` is
derived from median detected tooth width against `MEAN_TOOTH_WIDTH_MM`. Treat it
as a relative indicator, not a calibrated measurement.

---

## Moving to cloud later

The service is stateless — it takes an image and returns JSON, and the audit row
is written client-side to Supabase `xray_ai_runs`. To relocate it:

1. Deploy this same image to a container host (Fly.io, Railway, Modal, HF
   Inference Endpoints). **Supabase Edge Functions cannot host it** — they run
   Deno and cannot execute PyTorch.
2. Set `HOST=0.0.0.0`, `ALLOW_ANY_ORIGIN=false`, and `ALLOWED_ORIGINS` to your
   app origin.
3. Change one line in `index.html`:

```js
window.XRAY_AI_API_URL = 'https://your-service.example.com';
```

**Validate before spending on cloud GPU.** Run locally against a real sample of
your own radiographs and confirm the caries and bone-loss output is clinically
useful first — given the per-class caveats above, that check decides whether
hosted infrastructure is worth paying for at all.

### Note on a shared LAN box

Serving one AI machine to several workstations at `http://192.168.x.x:8765`
works when staff open the app from the local server (`http://127.0.0.1:8123`),
but a browser on an **HTTPS** GitHub Pages page blocks it as mixed content.
Plain `127.0.0.1` is exempt (browsers treat localhost as a secure context),
which is why the default is loopback. A LAN box needs HTTPS on that machine, or
http-only staff access.

---

## Response shape

```jsonc
{
  "findings": [
    { "type": "caries_progressed", "x": 0.41, "y": 0.33, "w": 0.04, "h": 0.05,
      "confidence": 0.62, "polygon": [[0.41,0.34], ...],
      "enamel_pct": 35, "dentin_pct": 65, "tooth": 26 },
    { "type": "bone_loss_moderate", "x": 0.22, "y": 0.55, "w": 0.02, "h": 0.06,
      "confidence": 0.68, "cej": [0.23,0.55], "crest": [0.23,0.61],
      "measurement": 2.4 }
  ],
  "anatomy_layers":     [ { "tooth": 26, "layer": "enamel", "polygon": [...] } ],
  "bone_measurements":  [ { "cej": [...], "crest": [...], "measurement_mm": 2.4,
                            "severity": 0.28, "gap": 0, "teeth": [25, 26] } ],
  "summary":  { "caries_progressed": 2, "bone_loss_moderate": 3 },
  "model":    "cs-xray-assist-onnx-dfine-v1",
  "backend":  "xray-ai-service-v1",
  "width":    2800,
  "height":   1400,
  "teeth_detected": 28,
  "elapsed_ms": 3120,
  "advisory": {
    "bone_loss":         "geometric_heuristic",
    "caries_polygon":    "classical_cv_refinement",
    "condition_classes": "research_grade_advisory"
  }
}
```

All coordinates are normalized to 0..1. Finding types match the taxonomy in
`app-xray-ai.js`: `caries_incipient`, `caries_progressed`, `calculus`,
`periapical_radiolucency`, `defective_margin`, `restoration`,
`bone_loss_mild`, `bone_loss_moderate`, `bone_loss_severe`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Panel says results came from the browser | Service unreachable — check the console window and `/health` |
| `503 no models loaded` | Run `download_models.py`, then restart |
| `teeth_detected: 0` on a clear panoramic | ONNX layout not decoded — check startup logs for a decode error |
| No caries findings ever | Expected: `ENABLE_PATHOLOGY_CLASSES` is `false` by default, for the accuracy reason above |
| No bone-loss findings | Expected on a healthy mouth — only sites over 2 mm CEJ-to-crest are reported |
| `WinError 206: filename too long` during install | Venv path too deep — use `%LOCALAPPDATA%\cs-xray-ai\`, as the launcher does |
| `AutoImageProcessor requires torchvision` | `pip install torchvision` — transformers 5.x needs it |
| Preflight rejected with `Disallowed CORS private-network` | Starlette ≥ 0.42 needs `allow_private_network`; already handled in `main.py` |
| Very slow first analysis | Models loading; subsequent runs are faster |
| Browser blocks the request | Origin not allowed — add it to `ALLOWED_ORIGINS`, or check the mixed-content note above |
