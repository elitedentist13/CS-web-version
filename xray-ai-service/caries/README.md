# CS caries subsystem — our own bitewing caries screening

This is our answer to "if people can build Pearl, why can't we?". It is **not**
a Pearl clone and **not** a cleared device. It is a defensible, honest,
next-generation *screening aid* that references how the cleared systems work.

## The philosophy

The commercial systems are not magic, and their model architecture is not
secret. What separates them from a demo is **data + validation + regulatory
clearance**, not code. So we split the problem the way they effectively do:

```
trained model   →  recall     (find candidate lesions)
reasoning layer →  precision   (screen the errors out)
```

A fine-tuned instance-segmentation model proposes lesions. Then a reasoning
layer applies four independent **skills**, each able to *veto* a candidate:

| Skill | File | What it does | Can veto when… |
|-------|------|--------------|----------------|
| Anatomical correction | `reasoning.locate` | anchors the lesion to a tooth and names the surface (interproximal / occlusal / cervical / root) | it's on the pulp/canal, off the tooth, or below the apex |
| Contrast assessment | `reasoning.contrast_evidence` | measures radiolucency vs. the *same tooth's* sound tissue, and margin character | contrast is too low, or the edge is a hard man-made step |
| Pathology relay | `reasoning.relay` | cross-checks against known look-alikes | it *is* a restoration, is cervical burnout, or is a Mach band |
| Calibration | `reasoning.calibrate` | fuses evidence into a confidence the UI slider can read | (caps confidence; classical-only path is held below the trained band) |

The reasoning layer can only ever *lower* a model's confidence, never invent
certainty, and confidence is hard-capped because this is a screening aid.

## Why bitewings

Caries — especially interproximal — is genuinely hard to see on a panoramic,
even for a dentist. The cleared systems' headline caries numbers are on
**bitewings and periapicals**. So the model here targets bitewings. (The rest
of the service — tooth positions, bone loss — remains panoramic.)

## Datasets (public, to start)

All verified public. Check each licence before use; none may be redistributed
from this repo, so you download them yourself.

| Key | Source | Contents | Role here |
|-----|--------|----------|-----------|
| `mendeley` | Mendeley Data `10.17632/4fbdxs7s7w` — "Dental caries in bitewing radiographs" (2023) | 100 PNG bitewings, COCO **boxes** from 8 dentists | train/val (coarse, boxes→rectangles) |
| `acta` | Zenodo `10.48338/vu01-uhgi3k` — ACTA-Bw25-RefStd (2025) | 25 TIFF bitewings + lesion masks + **staging** CSV (sound/enamel/outer-dentin/inner-dentin), 3-radiologist consensus | held-out **test** reference standard — never trained on |
| `bwr` | An Ultralytics-exported YOLO-seg set (e.g. "Bwr", 2026) | ~55 bitewings, polygon masks, lesion sub-types | train/val (classes collapsed to `caries`) |

Public data is small and label quality varies (the Mendeley set is boxes only;
inter-annotator disagreement is real). This is enough to **prototype**, not to
validate. A real model needs far more data — realistically the clinic's own
de-identified bitewings, annotated to the ACTA staging convention. See the main
`README.md` for the Hong Kong PDPO obligations that come with that.

## Model choice

**YOLOv8-seg, fine-tuned from COCO weights.** This mirrors the 2025-2026
peer-reviewed bitewing-caries work (YOLOv8m-seg / YOLOv5x-seg via Ultralytics),
gives polygon masks (matching the Pearl-style overlay the client already draws),
exports to ONNX, and trains even on CPU — appropriate for a clinic box.

## Building the model

```bash
# 1. install training deps (ideally on a GPU machine)
python -m pip install -r caries/train/requirements-train.txt

# 2. download the datasets yourself, then convert each into YOLO-seg form
cd caries/train
python prepare_dataset.py --source mendeley --root /path/to/mendeley --out ./dataset
python prepare_dataset.py --source bwr      --root /path/to/bwr      --out ./dataset
python prepare_dataset.py --source acta     --root /path/to/acta     --out ./dataset  # test only

# 3. fine-tune (image-level split + mild aug are baked in to avoid leakage)
python train.py --data data.yaml --model yolov8m-seg.pt --epochs 150 --imgsz 640

# 4. publish the checkpoint where the service looks for it
python export_onnx.py --weights runs/segment/cs-caries-bitewing/weights/best.pt --onnx
```

On the next service start (`ENABLE_CARIES_SCREENING=true`,
`ENABLE_CARIES_MODEL=true`) the trained model is picked up automatically; until
then the subsystem runs the classical proposer at lower confidence.

## Guardrails against the literature's known traps

The referenced studies flagged three ways bitewing-caries models flatter
themselves; we build against each:

- **Augmentation leakage** — the train/val split happens in `prepare_dataset.py`
  at the image level, *before* any augmentation, so augmented copies of a
  training image cannot appear in validation.
- **Class imbalance / early-lesion recall** — recall on enamel-only lesions is
  the weak spot; the confidence slider and the honest `screening` cap keep the
  tool from over-claiming there.
- **No external validation** — ACTA is held out as a test set, and even that is
  a reference standard (expert consensus), not histological ground truth. Real
  trust needs evaluation on the clinic's own cases.

## Trust level

| Output | How produced | Trust |
|--------|--------------|-------|
| Caries lesion + polygon (model present) | fine-tuned YOLOv8-seg → reasoning layer | screening aid, confidence-capped, **unvalidated on your data** |
| Caries lesion (no model) | classical radiolucency proposer → reasoning layer | weaker; capped further below the trained band |
| incipient vs progressed | model stage if available, else enamel/dentin depth | indicative |
| `relay_flags` (e.g. `near_restoration`) | pathology relay | provenance for the clinician |

Every finding carries `source: "cs-caries-workflow"`, `screening: true`, the
`surface`, and an internal `audit` trail (which zone, contrast, sharpness, which
vetoes considered) so any result is explainable.

## Continual learning (the data flywheel)

The trained model is only as good as its data, and public data is thin. The
system that keeps improving is the one that learns from the clinic's own cases.
So each caries hint in the browser carries a confirm (✓) / dismiss (✗) control
(shown only when the service is running and feedback capture is on). Each
verdict is sent to the service and becomes a labelled example.

```
browser: clinician taps ✓/✗ on a caries hint
   │  POST /analyze image + finding + verdict
   ▼
service: caries/feedback.py → clinic_data/
   images/<stem>.png              the radiograph (written once per image)
   labels/<stem>.txt              YOLO-seg polygons for CONFIRMED lesions
   negatives.jsonl                dismissed regions, kept as hard negatives
   manifest.jsonl                 who / when / consent, per verdict
   │
   ▼
periodically: caries/train/train_continual.py
   resume from weights/best.pt
   + all clinic positives  + a replay sample of the public train set
   → evaluate on the ACTA reference set
   → PROMOTE only if it did not regress; else keep the incumbent
```

Run a continual pass once enough verdicts have accumulated:

```bash
cd caries/train
python train_continual.py --public ./dataset --clinic ../clinic_data \
    --weights ../weights/best.pt --epochs 40 --replay-frac 0.5 --margin 0.01
```

### Modality routing (panoramic kept intact)

The inference pipeline classifies each image as `panoramic` / `bitewing` /
`periapical` (`models/modality.py`) and then:

| Modality | Tooth boxes | Bone heuristic | Caries screening |
|---|---|---|---|
| Panoramic | FDI ONNX (`abychkov/dental-fdi-detection`) | yes | off by default (`ENABLE_CARIES_ON_PANORAMIC`) |
| Bitewing / PA | classical intraoral segmenter add-on (`models/intraoral_teeth.py`) | yes (`ENABLE_INTRAORAL_BONE`) | **on** (trained weights if present, else classical + reasoning) |

Panoramic behaviour is unchanged. PA/bitewing are add-ons so a missing or
weak pano FDI detector no longer zeroes out the whole Assist panel on
intraoral films.

Public training data pull:

```bash
cd caries/train
python download_public.py --out ./raw
python prepare_dataset.py --source mendeley --root ./raw/mendeley/unpacked --out ./dataset
python train.py --model yolov8n-seg.pt --epochs 50 --batch 4 --device cpu
python export_onnx.py --weights runs/segment/cs-caries-bitewing/weights/best.pt
```

Or drive it from the app: the X-ray Assist panel shows a **Training** button
(when the service is up and feedback is enabled) that opens a review screen
backed by three endpoints:

| Endpoint | What it does |
|---|---|
| `GET /caries/dataset` | verdict counts, the 50 most recent verdicts, and a training-readiness preflight |
| `POST /caries/train` | launches `train_continual.py` as a background subprocess (one at a time; refused with reasons if preflight fails) |
| `GET /caries/train/status` | run state, log tail, and the parsed PROMOTED / REJECTED outcome |

The preflight is honest about what is missing (ultralytics not installed, no
confirmed verdicts, no prepared public replay set) so the button never starts a
doomed run. A promoted model is written to `weights/best.pt`; restart the
service to load it. Set `ENABLE_CARIES_TRAINING=0` to remove the trigger
entirely (e.g. on front-desk machines). Job management lives in
`caries/trainer_jobs.py`; tests in `caries/verify_trainer.py`.

Why it is built this way:

- **A dismiss is not an empty image.** Turning a rejected hint into a "no
  lesions here" label would teach the model to ignore other, real lesions on
  that film. Dismissals are stored as hard-negative *regions* instead.
- **Replay prevents forgetting.** Training only on the handful of new clinic
  images would overfit them and erase the public-data knowledge, so a random
  slice of the original training set is always mixed in.
- **Promotion is gated.** A bad run of labels can make the model worse. The new
  candidate is measured on the held-out ACTA reference set and only replaces the
  live model if it does not regress beyond `--margin`. Otherwise the incumbent
  stays and the recent labels get a second look.

### This stores patient radiographs — treat it as PHI

`clinic_data/` contains real images. It is git-ignored, but that is not enough:

- Get **patient consent** for retaining images as training data before enabling
  capture in a live clinic. The client sends `consent=false` unless the
  deployment sets `window.XRAY_AI_FEEDBACK_CONSENT = true`; the manifest records
  the flag per verdict so an auditor can see it.
- Keep `clinic_data/` on **encrypted storage**, access-controlled, and covered
  by the same PDPO handling as the rest of the record (see the main README).
- Set `ENABLE_CARIES_FEEDBACK=false` to turn capture off entirely.

## Config

| Env var | Default | Meaning |
|---------|---------|---------|
| `ENABLE_CARIES_SCREENING` | `true` | master switch for the subsystem |
| `ENABLE_CARIES_MODEL` | `true` | try to load trained weights (else classical fallback) |
| `CARIES_WEIGHTS_DIR` | `caries/weights` | where `export_onnx.py` publishes the model |
| `CARIES_MODEL_MIN_SCORE` | `0.25` | model proposal floor (reasoning + slider do the real filtering) |
| `CARIES_IMGSZ` | `640` | inference resolution |
| `ENABLE_CARIES_FEEDBACK` | `true` | capture clinician verdicts as training data |
| `CARIES_CLINIC_DATA_DIR` | `caries/clinic_data` | where verdicts accumulate (PHI — encrypt) |

Thresholds for the reasoning layer live in `reasoning.ReasoningConfig` as named
attributes precisely so they can be swept during calibration — they are
precision-biased defaults, not validated settings.
