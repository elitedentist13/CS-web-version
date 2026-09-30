"""
Run and monitor a continual-training pass as a background subprocess.

Training is heavy and long, so it cannot run inside a request. This module owns
a single job at a time: `start` spawns `caries/train/train_continual.py` with
the service's own Python, streams its output to a log file, and `status`
reports progress and the final promote/reject outcome parsed from that log.

`preflight` is the honest gatekeeper: it checks the things that must be true for
training to even begin (train script present, ultralytics installed, some
confirmed clinic labels). A public replay dataset is optional — without it the
run trains on clinic labels only.
"""

import glob
import importlib.util
import json
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
_AUTO_STATE_PATH = os.path.join(_SERVICE_ROOT, "caries", "train", "continual_auto.json")

_lock = threading.Lock()
_proc = None
_log_file = None
_auto_config = None
_on_promoted = None
_auto_thread = None
_stop = threading.Event()
_wake = threading.Event()
_auto = {
    "pending_fingerprint": "",
    "accounted": None,
    "needs_reload": None,
    "reloaded_for": None,
    "message": "",
}
_job = {
    "state": "idle",           # idle | running | done | error
    "outcome": None,           # promoted | rejected | failed | None
    "message": None,
    "started_at": None,
    "finished_at": None,
    "returncode": None,
}


def clinic_fingerprint(clinic_dir):
    """Stable id of the confirmed label files. Empty when there is nothing to learn."""
    labels = os.path.join(clinic_dir or "", "labels")
    if not os.path.isdir(labels):
        return ""
    parts = []
    for path in sorted(glob.glob(os.path.join(labels, "*.txt"))):
        try:
            if os.path.getsize(path) <= 0:
                continue
            st = os.stat(path)
        except OSError:
            continue
        parts.append("%s:%d:%d" % (os.path.basename(path), st.st_size, int(st.st_mtime)))
    return "|".join(parts)


def should_autostart(fingerprint, auto_state, now_ts, cooldown_sec, enabled=True):
    """
    Decide whether a new unattended run should start.

    Returns (start, message). A run starts only when confirmed labels changed
    since the last finished pass and the cooldown (longer after failures) has
    elapsed.
    """
    if not enabled:
        return False, "auto-training off"
    if not fingerprint:
        return False, "auto-training on — waiting for a confirmed caries label"
    auto_state = auto_state or {}
    trained = auto_state.get("fingerprint") or ""
    if fingerprint == trained:
        return False, "auto-training on — up to date with confirmed labels"
    failures = int(auto_state.get("consecutive_failures") or 0)
    last = float(auto_state.get("finished_at_ts") or 0)
    if last:
        mult = (2 ** min(failures - 1, 4)) if failures else 1
        wait = float(cooldown_sec) * mult
        left = wait - (float(now_ts) - last)
        if left > 0:
            return False, "auto-training on — next run in %ds" % int(left)
    return True, "auto-training on — new confirmed labels, starting a run"


def incumbent_weights(weights_dir):
    """Checkpoint to resume from: ACTIVE generation, else best.pt (may be absent)."""
    active = os.path.join(weights_dir, "ACTIVE")
    if os.path.isfile(active):
        try:
            with open(active, "r", encoding="utf-8") as fh:
                lines = fh.read().strip().splitlines()
            name = lines[0].strip() if lines else ""
        except OSError:
            name = ""
        if name and os.path.basename(name) == name:
            path = os.path.join(weights_dir, name)
            if os.path.isfile(path):
                return path
    return os.path.join(weights_dir, "best.pt")


def describe_auto(config):
    """Status line for the review screen. Does not start a run."""
    enabled = bool(
        getattr(config, "ENABLE_CARIES_TRAINING", True)
        and getattr(config, "ENABLE_CARIES_AUTOTRAIN", False)
    )
    with _lock:
        running = _job["state"] == "running"
    if not enabled:
        return {"enabled": False, "message": "auto-training off"}
    if running:
        return {"enabled": True, "message": "auto-training on — a run is in progress"}
    checks, ready = preflight(config)
    if not ready:
        blockers = [c["detail"] for c in checks if c["blocking"] and not c["ok"]]
        return {
            "enabled": True,
            "message": "auto-training waiting — " + "; ".join(blockers),
        }
    fp = clinic_fingerprint(config.CARIES_CLINIC_DATA_DIR)
    state = _load_auto_state()
    cooldown = int(getattr(config, "CARIES_AUTOTRAIN_COOLDOWN_SEC", 900) or 0)
    _ok, msg = should_autostart(fp, state, time.time(), cooldown, True)
    return {
        "enabled": True,
        "message": msg,
        "last_outcome": state.get("last_outcome"),
    }


def service_tick(config):
    """Finalize a finished run, reload a promoted model, maybe start the next one."""
    global _auto_config
    _auto_config = config
    token = None
    with _lock:
        _refresh_locked()
        if _auto.get("needs_reload") and _auto.get("needs_reload") != _auto.get("reloaded_for"):
            token = _auto["needs_reload"]
            _auto["reloaded_for"] = token
        running = _job["state"] == "running"
    if token and _on_promoted:
        try:
            _on_promoted()
        except Exception:
            log.exception("reload after promote failed")
    if running:
        _auto["message"] = "auto-training on — a run is in progress"
        return
    enabled = bool(
        getattr(config, "ENABLE_CARIES_TRAINING", True)
        and getattr(config, "ENABLE_CARIES_AUTOTRAIN", False)
    )
    if not enabled:
        _auto["message"] = "auto-training off"
        return
    checks, ready = preflight(config)
    if not ready:
        blockers = [c["detail"] for c in checks if c["blocking"] and not c["ok"]]
        _auto["message"] = "auto-training waiting — " + "; ".join(blockers)
        return
    fp = clinic_fingerprint(config.CARIES_CLINIC_DATA_DIR)
    state = _load_auto_state()
    cooldown = int(getattr(config, "CARIES_AUTOTRAIN_COOLDOWN_SEC", 900) or 0)
    ok, msg = should_autostart(fp, state, time.time(), cooldown, True)
    _auto["message"] = msg
    if not ok:
        return
    epochs = int(getattr(config, "CARIES_AUTOTRAIN_EPOCHS", 8) or 8)
    replay = float(getattr(config, "CARIES_AUTOTRAIN_REPLAY", 0.5) or 0)
    start(config, epochs=epochs, replay_frac=replay)


def start_autotrain(config, on_promoted=None):
    """Background loop. Safe to call once at process start."""
    global _auto_config, _on_promoted, _auto_thread
    _auto_config = config
    _on_promoted = on_promoted
    if _auto_thread and _auto_thread.is_alive():
        _wake.set()
        return
    _stop.clear()
    _auto_thread = threading.Thread(
        target=_auto_loop, name="caries-autotrain", daemon=True
    )
    _auto_thread.start()
    log.warning(
        "caries auto-training loop started (epochs=%s cooldown=%ss)",
        getattr(config, "CARIES_AUTOTRAIN_EPOCHS", 8),
        getattr(config, "CARIES_AUTOTRAIN_COOLDOWN_SEC", 900),
    )


def stop_autotrain():
    _stop.set()
    _wake.set()


def nudge():
    """Wake the loop early (a new verdict just landed)."""
    _wake.set()


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

    has_script = os.path.isfile(_TRAIN_SCRIPT)
    checks.append({
        "check": "train_script",
        "ok": has_script,
        "blocking": True,
        "detail": "ready" if has_script else
        "missing caries/train/train_continual.py",
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
    if public_train <= 0:
        public_train = _count_images(os.path.join(config.CARIES_PUBLIC_DATA_DIR, "train", "images"))
    checks.append({
        "check": "public_replay_dataset",
        "ok": True,
        "blocking": False,
        "detail": ("%d public training images for replay" % public_train) if public_train
        else "clinic labels only — public replay set not installed (optional)",
    })

    weights = incumbent_weights(config.CARIES_WEIGHTS_DIR)
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
    global _proc, _log_file
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

        weights = incumbent_weights(config.CARIES_WEIGHTS_DIR)
        public_train = _count_images(os.path.join(config.CARIES_PUBLIC_DATA_DIR, "images", "train"))
        if public_train <= 0:
            public_train = _count_images(os.path.join(config.CARIES_PUBLIC_DATA_DIR, "train", "images"))
        frac = 0.0 if public_train <= 0 else float(replay_frac)
        cmd = [
            sys.executable, _TRAIN_SCRIPT,
            "--public", config.CARIES_PUBLIC_DATA_DIR,
            "--clinic", config.CARIES_CLINIC_DATA_DIR,
            "--weights", weights,
            "--epochs", str(int(epochs)),
            "--replay-frac", str(frac),
        ]
        try:
            _close_log_locked()
            os.makedirs(os.path.dirname(_LOG_PATH), exist_ok=True)
            logf = open(_LOG_PATH, "w", encoding="utf-8")
            logf.write("$ %s\n\n" % " ".join(cmd))
            logf.flush()
            _log_file = logf
            popen_kw = dict(
                cwd=_SERVICE_ROOT,
                stdout=logf,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
            )
            if sys.platform == "win32":
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                if flags:
                    popen_kw["creationflags"] = flags
            _proc = subprocess.Popen(cmd, **popen_kw)
        except Exception as exc:
            _close_log_locked()
            log.exception("failed to launch continual training")
            _job.update(state="error", outcome="failed",
                        message="launch failed: %s" % exc)
            return dict(_job, preflight=checks)

        _auto["pending_fingerprint"] = clinic_fingerprint(config.CARIES_CLINIC_DATA_DIR)
        _job.update(state="running", outcome=None, message="training started",
                    started_at=_now(), finished_at=None, returncode=None)
        log.warning("continual training started: %s", " ".join(cmd))
        return dict(_job, preflight=checks)


def status():
    with _lock:
        _refresh_locked()
        st = dict(_job, log_tail=_log_tail())
        cfg = _auto_config
    if cfg is not None:
        st["auto"] = describe_auto(cfg)
    return st


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
    _close_log_locked()
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
        _job["message"] = "new model promoted — loaded for the next analysis"
    elif "REJECTED" in tail:
        _job["state"] = "done"
        _job["outcome"] = "rejected"
        _job["message"] = "candidate regressed on the reference set; incumbent kept"
    else:
        _job["state"] = "done"
        _job["outcome"] = None
        _job["message"] = "finished (no promote/reject marker found)"
    finish_id = _job.get("finished_at")
    if finish_id and _auto.get("accounted") != finish_id:
        _auto["accounted"] = finish_id
        _remember_finish_locked()
        _wake.set()


def _remember_finish_locked():
    """Remember which labels this pass already saw, and ask for a reload on promote."""
    state = _load_auto_state()
    fp = _auto.get("pending_fingerprint") or ""
    if _job.get("outcome") == "failed":
        state["consecutive_failures"] = int(state.get("consecutive_failures") or 0) + 1
    else:
        if fp:
            state["fingerprint"] = fp
        state["consecutive_failures"] = 0
    state["finished_at_ts"] = time.time()
    state["last_outcome"] = _job.get("outcome")
    _save_auto_state(state)
    if _job.get("outcome") == "promoted":
        _auto["needs_reload"] = _job.get("finished_at")


def _close_log_locked():
    global _log_file
    fh = _log_file
    _log_file = None
    if fh is None:
        return
    try:
        fh.close()
    except OSError:
        pass


def _load_auto_state():
    try:
        with open(_AUTO_STATE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return {}


def _save_auto_state(state):
    try:
        folder = os.path.dirname(_AUTO_STATE_PATH)
        if folder:
            os.makedirs(folder, exist_ok=True)
        tmp = _AUTO_STATE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, _AUTO_STATE_PATH)
    except OSError:
        log.exception("could not save autotrain state")


def _auto_loop():
    while not _stop.is_set():
        cfg = _auto_config
        if cfg is not None:
            try:
                service_tick(cfg)
            except Exception:
                log.exception("autotrain tick failed")
        poll = 30
        if cfg is not None:
            try:
                poll = int(getattr(cfg, "CARIES_AUTOTRAIN_POLL_SEC", 30) or 30)
            except (TypeError, ValueError):
                poll = 30
        _wake.wait(timeout=max(5, poll))
        _wake.clear()


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
