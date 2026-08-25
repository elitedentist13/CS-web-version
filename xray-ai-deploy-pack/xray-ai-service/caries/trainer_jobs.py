"""
Run and monitor a continual-training pass as a background subprocess.

Training is heavy and long, so it cannot run inside a request. This module owns
a single job at a time: `start` spawns `caries/train/train_continual.py` with
the service's own Python, streams its output to a log file, and `status`
reports progress and the final promote/reject outcome parsed from that log.

`preflight` is the honest gatekeeper: it checks the things that must be true for
training to even begin (ultralytics installed, some confirmed clinic labels
present) and the things that merely should be (a prepared public dataset for the
replay buffer), and reports exactly what is missing and how to fix it — so the
review screen never launches a doomed run.
"""

import glob
import importlib.util
import logging
import os
import subprocess
import sys
import threading
import time

log = logging.getLogger("xray-ai.caries.trainer")

_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TRAIN_SCRIPT = os.path.join(_SERVICE_ROOT, "caries", "train", "train_continual.py")
_LOG_PATH = os.path.join(_SERVICE_ROOT, "caries", "train", "continual_last.log")

_lock = threading.Lock()
_proc = None
_job = {
    "state": "idle",           # idle | running | done | error
    "outcome": None,           # promoted | rejected | failed | None
    "message": None,
    "started_at": None,
    "finished_at": None,
    "returncode": None,
}


def preflight(config):
    """Return (checks, ready) where ready means training can start."""
    checks = []

    has_ultra = importlib.util.find_spec("ultralytics") is not None
    checks.append({
        "check": "ultralytics_installed",
        "ok": has_ultra,
        "blocking": True,
        "detail": "ready" if has_ultra else
        "not installed — run: pip install -r caries/train/requirements-train.txt",
    })

    clinic_labels = _count_positive_labels(config.CARIES_CLINIC_DATA_DIR)
    checks.append({
        "check": "clinic_labels",
        "ok": clinic_labels > 0,
        "blocking": True,
        "detail": ("%d confirmed label file(s)" % clinic_labels) if clinic_labels
        else "no confirmed verdicts yet — confirm some caries hints first",
    })

    public_train = _count_images(os.path.join(config.CARIES_PUBLIC_DATA_DIR, "images", "train"))
    checks.append({
        "check": "public_replay_dataset",
        "ok": public_train > 0,
        "blocking": False,
        "detail": ("%d public training images for replay" % public_train) if public_train
        else "no prepared public dataset — replay buffer will be empty "
             "(run caries/train/prepare_dataset.py)",
    })

    weights = os.path.join(config.CARIES_WEIGHTS_DIR, "best.pt")
    checks.append({
        "check": "incumbent_weights",
        "ok": True,  # never blocking: absent weights just means train from base
        "blocking": False,
        "detail": "resuming from %s" % weights if os.path.exists(weights)
        else "no incumbent weights — will fine-tune from the base COCO model",
    })

    ready = all(c["ok"] for c in checks if c["blocking"])
    return checks, ready


def start(config, epochs=40, replay_frac=0.5):
    """Start a run if none is active. Returns the current status dict."""
    global _proc
    with _lock:
        _refresh_locked()
        if _job["state"] == "running":
            return dict(_job, already_running=True)

        checks, ready = preflight(config)
        if not ready:
            blockers = [c["detail"] for c in checks if c["blocking"] and not c["ok"]]
            _job.update(state="error", outcome=None,
                        message="cannot start: " + "; ".join(blockers),
                        started_at=None, finished_at=None, returncode=None)
            return dict(_job, preflight=checks)

        weights = os.path.join(config.CARIES_WEIGHTS_DIR, "best.pt")
        cmd = [
            sys.executable, _TRAIN_SCRIPT,
            "--public", config.CARIES_PUBLIC_DATA_DIR,
            "--clinic", config.CARIES_CLINIC_DATA_DIR,
            "--weights", weights,
            "--epochs", str(int(epochs)),
            "--replay-frac", str(float(replay_frac)),
        ]
        try:
            logf = open(_LOG_PATH, "w", encoding="utf-8")
            logf.write("$ %s\n\n" % " ".join(cmd))
            logf.flush()
            _proc = subprocess.Popen(
                cmd, cwd=_SERVICE_ROOT, stdout=logf, stderr=subprocess.STDOUT
            )
        except Exception as exc:
            log.exception("failed to launch continual training")
            _job.update(state="error", outcome="failed",
                        message="launch failed: %s" % exc)
            return dict(_job, preflight=checks)

        _job.update(state="running", outcome=None, message="training started",
                    started_at=_now(), finished_at=None, returncode=None)
        log.warning("continual training started: %s", " ".join(cmd))
        return dict(_job, preflight=checks)


def status():
    with _lock:
        _refresh_locked()
        return dict(_job, log_tail=_log_tail())


# ── internals ──────────────────────────────────────────────────────
def _refresh_locked():
    """Finalize the job record if the subprocess has exited."""
    global _proc
    if _job["state"] != "running" or _proc is None:
        return
    rc = _proc.poll()
    if rc is None:
        return  # still running
    _proc = None
    _job["returncode"] = rc
    _job["finished_at"] = _now()
    tail = _log_text()
    if rc != 0:
        _job["state"] = "error"
        _job["outcome"] = "failed"
        _job["message"] = "training exited with code %d" % rc
    elif "PROMOTED" in tail:
        _job["state"] = "done"
        _job["outcome"] = "promoted"
        _job["message"] = "new model promoted — restart the service to load it"
    elif "REJECTED" in tail:
        _job["state"] = "done"
        _job["outcome"] = "rejected"
        _job["message"] = "candidate regressed on the reference set; incumbent kept"
    else:
        _job["state"] = "done"
        _job["outcome"] = None
        _job["message"] = "finished (no promote/reject marker found)"


def _log_text():
    try:
        with open(_LOG_PATH, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def _log_tail(n=40):
    return "\n".join(_log_text().splitlines()[-n:])


def _count_positive_labels(clinic_dir):
    labels = os.path.join(clinic_dir, "labels")
    if not os.path.isdir(labels):
        return 0
    return sum(1 for p in glob.glob(os.path.join(labels, "*.txt"))
               if os.path.getsize(p) > 0)


def _count_images(images_dir):
    if not os.path.isdir(images_dir):
        return 0
    n = 0
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.tif", "*.tiff"):
        n += len(glob.glob(os.path.join(images_dir, "**", ext), recursive=True))
    return n


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
