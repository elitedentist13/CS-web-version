# CS X-ray Assist — clinic clone pack

This is a trimmed copy of the local X-ray AI backend (`xray-ai-service`), meant
to be dropped onto another clinic Windows PC so it gets the same trained
caries model and detection logic running locally at `http://127.0.0.1:8877`
(same port as this project's web app `XRAY_AI_API_URL`).

It deliberately does **not** include:

- The Python virtual environment or the pretrained third-party model cache
  (both are large and machine-specific — they get created/downloaded fresh on
  first run instead, see below).
- Training scripts/datasets/run artifacts (`caries/train/`, `caries/_model_backups/`).
- This clinic's patient feedback data (`caries/clinic_data/` — images, labels,
  manifest of clinician verdicts). That data is specific to this clinic's
  patients and consent, and should not travel with the code.

What **is** included: all backend code plus the one thing that's actually this
clinic's own trained asset — `xray-ai-service/caries/weights/best.pt` (the
caries segmentation model), plus the Windows launchers below.

---

## 1. Read this before deploying to a live clinic

The service loads two third-party pretrained models in addition to your own
`best.pt`. One of them has a licence that matters:

- **Tooth/FDI detector** (`abychkov/dental-fdi-detection`) — **Proprietary,
  Non-Commercial licence**. It explicitly **prohibits clinical or diagnostic
  use, commercial use without a separate licence, and redistribution**.
  Permitted use is academic research, education, and internal technical
  validation only. Using it on real patients in a live clinic is outside that
  grant unless you've obtained a separate commercial/clinical licence from the
  author (contact in `xray-ai-service/README.md`).
  - If you don't have that licence, set `ENABLE_TOOTH_MODEL=false` as an
    environment variable before starting the service. You'll lose bone-loss
    measurement and the enamel/dentin split, but the caries model and the
    condition detector (Apache-2.0, no restriction) still work.
- The caries model (`best.pt`) is loaded through the **Ultralytics YOLO**
  runtime (it's a YOLOv8-seg checkpoint). Ultralytics' code is AGPL-3.0;
  closed/commercial deployments generally need an Ultralytics **Enterprise
  licence**. Worth confirming your status there too before wider rollout.
- **Do not** re-upload the pretrained `model_cache/` contents anywhere
  (GitHub, shared drives, etc.) — that would likely count as "redistribution"
  under the tooth detector's licence. Let each clinic PC download it directly
  from Hugging Face via `download_models.py` (see below), which is that
  model's own sanctioned distribution channel.

Full detail: `xray-ai-service/README.md`.

---

## 2. Install on the new clinic PC (align with other branches)

Requirements: Windows, Python 3.10+ on PATH, internet access (for the
one-time dependency + model download — a few GB total, only needed once).

### Recommended (one-shot)

1. Copy this whole `xray-ai-deploy-pack` folder onto the target PC (or place
   `start-xray-ai.bat` + `xray-ai-service\` next to that clinic's web app copy).
2. Double-click **`setup-xray-ai-clinic-pc.bat`**.
   - Registers the `csxrayai://` protocol so the web app **▶ Server** button
     can start the AI service from the browser.
   - Starts `start-xray-ai.bat` (creates `%LOCALAPPDATA%\cs-xray-ai\venv`,
     installs deps, downloads models on first run).
3. Open `http://127.0.0.1:8877/health` — expect `"ok": true` and models ready.
4. In the clinic web app lightbox: **▶ Server** (if needed) → **Analyze**.

### Manual (same pieces, separate steps)

1. Double-click `register-xray-ai-protocol.bat` once per Windows user.
2. Double-click `start-xray-ai.bat` (or use **▶ Server** in the app after step 1).
3. Leave the AI console window open while staff use X-ray Assist.

Later runs skip install/download and go straight to uvicorn.

### If the clinic PC has slow/limited internet

The one-time download in step 2 is the only part that needs bandwidth. To
avoid it entirely:

- Copy this machine's `%LOCALAPPDATA%\cs-xray-ai\model_cache` folder onto a
  USB drive and drop it into `%LOCALAPPDATA%\cs-xray-ai\model_cache` on the
  target PC *before* running `start-xray-ai.bat` (then create an empty file
  named `.downloaded` inside that folder so the script knows to skip the
  download step).
- For the Python dependencies, you can instead run, on a machine with good
  bandwidth:
  `pip download -r xray-ai-service\requirements.txt -d wheelhouse`
  then copy the `wheelhouse` folder to the clinic PC and install offline with:
  `python -m pip install --no-index --find-links=wheelhouse -r xray-ai-service\requirements.txt`

---

## 3. Updating the model later

If you retrain and want to push a better model to other clinics, you only
need to replace one small file:
`xray-ai-service\caries\weights\best.pt` (a few MB). Copy the new file over
the old one on each clinic PC and restart `start-xray-ai.bat` — no
reinstall needed.
