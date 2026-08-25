"""
CS X-ray Assist inference service.

Implements the contract app-xray-ai.js already expects:
    GET  /health   -> 200 when reachable (client only checks response.ok)
    POST /analyze  -> multipart form field "file" (JPEG), returns findings JSON

Run locally:
    python -m uvicorn main:app --host 127.0.0.1 --port 8765

The service is stateless: it takes an image and returns JSON. Nothing is stored
here (the audit row is written client-side to Supabase xray_ai_runs), which is
what makes relocating this to a cloud container a one-line change of
window.XRAY_AI_API_URL in index.html.

DECISION SUPPORT ONLY - not a diagnosis, and not a cleared medical device.
See README.md for the per-class accuracy and licensing caveats.
"""

import inspect
import io
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

import config
from caries import feedback as caries_feedback
from caries import trainer_jobs
from caries.model import CariesModel
from models.condition_detector import ConditionDetector
from models.tooth_detector import ToothDetector
from pipeline import MODEL_VERSION, Pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("xray-ai")

# Pillow guards against decompression bombs at ~89M pixels by default. Dental
# panoramics are well under that; keep the guard but raise it enough that a
# large-format sensor image is not rejected outright.
Image.MAX_IMAGE_PIXELS = 120_000_000

_state = {"pipeline": None}


@asynccontextmanager
async def lifespan(_app):
    """
    Load models at startup so the first clinical click is not the slow one.
    Failures are logged rather than fatal: the browser falls back to its own
    heuristic when this service is unavailable or degraded.
    """
    _log_licence_notice()
    try:
        get_pipeline()
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("model warmup failed, service will run degraded: %s", exc)
    yield


def _log_licence_notice():
    """
    Print the licence constraints on every start. The tooth detector's terms
    prohibit clinical and commercial use, which is a decision the operator has
    to make consciously rather than discover after rollout.
    """
    log.warning("=" * 68)
    log.warning("CS X-ray Assist - DECISION SUPPORT ONLY, NOT A DIAGNOSIS")
    log.warning("Not a cleared medical device. A clinician must review every image.")
    for repo, terms in config.MODEL_LICENSES.items():
        log.warning("  %s", repo)
        log.warning("      licence: %s | commercial: %s | clinical: %s",
                    terms["license"], terms["commercial_use"], terms["clinical_use"])
    if config.ENABLE_TOOTH_MODEL:
        log.warning(
            "The tooth detector is ENABLED. Its licence permits research and "
            "internal validation only - obtain a commercial licence before "
            "clinical rollout, or set ENABLE_TOOTH_MODEL=false."
        )
    else:
        log.warning(
            "The tooth detector is DISABLED: bone-loss measurement and the "
            "enamel/dentin split are unavailable (both need tooth geometry)."
        )
    log.warning("=" * 68)


app = FastAPI(
    title="CS X-ray Assist",
    version="1.0.0",
    description="Decision-support inference for dental radiographs. Not a diagnosis.",
    lifespan=lifespan,
)

_cors_kwargs = {
    "allow_origins": ["*"] if config.ALLOW_ANY_ORIGIN else config.ALLOWED_ORIGINS,
    "allow_origin_regex": None if config.ALLOW_ANY_ORIGIN else r"https://.*\.github\.io",
    "allow_credentials": False,
    "allow_methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["*"],
    "max_age": 3600,
}

# Chrome's Private Network Access rules require an explicit opt-in on the
# preflight when a secure-context page (e.g. a GitHub Pages deployment) calls a
# service on localhost. Recent Starlette validates this itself and rejects such
# preflights with 400 unless the flag is set; older versions ignore PNA entirely
# and need the response header added by hand.
_PNA_NATIVE = "allow_private_network" in inspect.signature(
    CORSMiddleware.__init__
).parameters
if _PNA_NATIVE:
    _cors_kwargs["allow_private_network"] = True

app.add_middleware(CORSMiddleware, **_cors_kwargs)

if not _PNA_NATIVE:

    @app.middleware("http")
    async def private_network_access(request, call_next):
        response = await call_next(request)
        if request.method == "OPTIONS" and request.headers.get(
            "access-control-request-private-network"
        ):
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response


def get_pipeline():
    """Lazily build the pipeline so the first request pays the model load cost."""
    if _state["pipeline"] is None:
        log.info("loading models (first request)...")
        tooth = ToothDetector(
            config.TOOTH_MODEL_REPO,
            config.MODEL_CACHE_DIR,
            min_score=config.TOOTH_MIN_SCORE,
            enabled=config.ENABLE_TOOTH_MODEL,
        )
        condition = ConditionDetector(
            config.CONDITION_MODEL_REPO,
            config.MODEL_CACHE_DIR,
            device=config.DEVICE,
            min_score=config.CONDITION_MIN_SCORE,
            enabled=config.ENABLE_CONDITION_MODEL,
            use_card_resolution=config.CONDITION_USE_CARD_RESOLUTION,
        )
        caries_model = CariesModel(
            config.CARIES_WEIGHTS_DIR,
            min_score=config.CARIES_MODEL_MIN_SCORE,
            enabled=config.ENABLE_CARIES_SCREENING and config.ENABLE_CARIES_MODEL,
            imgsz=config.CARIES_IMGSZ,
        )
        _state["pipeline"] = Pipeline(tooth, condition, caries_model=caries_model)
    return _state["pipeline"]


@app.get("/")
async def root():
    """
    Browser-friendly landing page. The service itself is an API — the CS web
    app talks to /health and /analyze; opening / in a browser used to 404.
    """
    from fastapi.responses import HTMLResponse

    html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>CS X-ray AI service</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5;color:#1a1a1a}
  code,a{color:#0b5fff} .ok{color:#0a7a2f;font-weight:600}
</style></head><body>
<h1>CS X-ray AI service</h1>
<p class="ok">Running</p>
<p>This is the local API backend (not the clinic web UI). Use the Joyful Smile /
CS web app to load radiographs — it calls this service automatically.</p>
<ul>
  <li><a href="/health"><code>/health</code></a> — readiness JSON</li>
  <li><a href="/docs"><code>/docs</code></a> — interactive API docs</li>
  <li><code>POST /analyze</code> — radiograph upload (used by the app)</li>
</ul>
</body></html>"""
    return HTMLResponse(html)


@app.get("/health")
async def health():
    pipeline = _state["pipeline"]
    status = pipeline.status() if pipeline else {"loaded": False}
    ready = bool(
        pipeline
        and (
            status.get("tooth_detector", {}).get("ready")
            or status.get("condition_detector", {}).get("ready")
        )
    )
    return {
        "ok": True,
        "ready": ready,
        "model": MODEL_VERSION,
        "backend": config.SERVICE_VERSION,
        "device": config.DEVICE,
        "confidence_floor": config.CONFIDENCE_FLOOR,
        "models": status,
        "caries_feedback": {
            "enabled": bool(config.ENABLE_CARIES_SCREENING and config.ENABLE_CARIES_FEEDBACK),
            "training_enabled": bool(config.ENABLE_CARIES_SCREENING and config.ENABLE_CARIES_TRAINING),
            "dataset": caries_feedback.stats(config.CARIES_CLINIC_DATA_DIR)
            if config.ENABLE_CARIES_FEEDBACK else None,
        },
        "licenses": config.MODEL_LICENSES,
        "disclaimer": (
            "Decision support only. Not a diagnosis and not a cleared medical "
            "device. Caries findings come from our bitewing screening workflow "
            "(a trained model where weights exist, otherwise a classical "
            "proposer) filtered by a precision-biased reasoning layer, with "
            "confidence capped as a screening aid. Bone loss is a geometric "
            "heuristic; condition classes are research-grade. The tooth detector "
            "is licensed for non-commercial research and internal validation "
            "only - see 'licenses'."
        ),
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=415, detail="unreadable image: %s" % exc)

    if image.width < 64 or image.height < 64:
        raise HTTPException(status_code=422, detail="image too small to analyze")

    pipeline = get_pipeline()
    status = pipeline.status()
    if not status["tooth_detector"]["ready"] and not status["condition_detector"]["ready"]:
        # Nothing loaded: tell the client explicitly so it falls back to its own
        # in-browser heuristic instead of rendering an empty result as "clean".
        return JSONResponse(
            status_code=503,
            content={
                "error": "no models loaded",
                "models": status,
                "hint": "run download_models.py, then restart the service",
            },
        )

    try:
        result = pipeline.analyze(image)
    except Exception as exc:
        log.exception("analysis failed")
        raise HTTPException(status_code=500, detail="analysis failed: %s" % exc)

    return result


@app.post("/feedback")
async def feedback(
    file: UploadFile = File(...),
    verdict: str = Form(...),
    finding: str = Form(...),
    xray_id: str = Form(None),
    patient_ref: str = Form(None),
    created_by: str = Form(None),
    model_version: str = Form(None),
    consent: str = Form("false"),
):
    """
    Record a clinician verdict on a caries hint as a training example.

    The client sends the same image it analyzed plus the finding (normalized
    coords) and the verdict. Nothing here blocks the clinical UI: failures are
    reported but never raise into the reviewer's workflow.
    """
    if not (config.ENABLE_CARIES_SCREENING and config.ENABLE_CARIES_FEEDBACK):
        raise HTTPException(status_code=403, detail="caries feedback capture is disabled")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=415, detail="unreadable image: %s" % exc)
    try:
        finding_obj = json.loads(finding)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="finding is not valid JSON: %s" % exc)

    meta = {
        "xray_id": xray_id,
        "patient_ref": patient_ref,
        "created_by": created_by,
        "model_version": model_version,
        "consent": str(consent).strip().lower() in ("1", "true", "yes", "on"),
    }
    try:
        summary = caries_feedback.record(
            image, finding_obj, verdict, meta, config.CARIES_CLINIC_DATA_DIR
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        log.exception("feedback capture failed")
        raise HTTPException(status_code=500, detail="feedback capture failed: %s" % exc)

    stats = caries_feedback.stats(config.CARIES_CLINIC_DATA_DIR)
    return {"ok": True, "recorded": summary, "dataset": stats}


@app.get("/caries/dataset")
async def caries_dataset():
    """Accumulated verdicts + a training-readiness preflight, for the review screen."""
    if not config.ENABLE_CARIES_SCREENING:
        raise HTTPException(status_code=403, detail="caries subsystem is disabled")
    checks, ready = trainer_jobs.preflight(config)
    return {
        "stats": caries_feedback.stats(config.CARIES_CLINIC_DATA_DIR),
        "recent": caries_feedback.recent(config.CARIES_CLINIC_DATA_DIR, limit=50),
        "training_enabled": bool(config.ENABLE_CARIES_TRAINING),
        "preflight": checks,
        "ready_to_train": ready,
    }


@app.post("/caries/train")
async def caries_train(epochs: int = Form(40), replay_frac: float = Form(0.5)):
    """Kick off a continual-training pass (one at a time)."""
    if not (config.ENABLE_CARIES_SCREENING and config.ENABLE_CARIES_TRAINING):
        raise HTTPException(status_code=403, detail="caries training is disabled")
    return trainer_jobs.start(config, epochs=epochs, replay_frac=replay_frac)


@app.get("/caries/train/status")
async def caries_train_status():
    if not config.ENABLE_CARIES_SCREENING:
        raise HTTPException(status_code=403, detail="caries subsystem is disabled")
    return trainer_jobs.status()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="info")
