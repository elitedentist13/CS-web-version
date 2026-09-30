"""
Deterministic tests for the continual-training job manager (caries/trainer_jobs.py).

Run from the service root:
    python -m caries.verify_trainer

No network, no models, no real training: the "training run" is a stand-in
script that prints a promote/reject marker, so the full launch → poll →
finalize path is exercised in milliseconds.
"""

import os
import shutil
import sys
import tempfile
import time
import types

from caries import feedback, trainer_jobs

PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        print("  FAIL " + name + ("  (" + detail + ")" if detail else ""))
        raise SystemExit(1)
    PASS += 1
    print("  ok  " + name)


def _config(tmp):
    cfg = types.SimpleNamespace()
    cfg.CARIES_CLINIC_DATA_DIR = os.path.join(tmp, "clinic")
    cfg.CARIES_PUBLIC_DATA_DIR = os.path.join(tmp, "public")
    cfg.CARIES_WEIGHTS_DIR = os.path.join(tmp, "weights")
    return cfg


def _wait_done(timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = trainer_jobs.status()
        if st["state"] != "running":
            return st
        time.sleep(0.2)
    raise SystemExit("timed out waiting for fake training run")


def _reset_job():
    trainer_jobs._job.update(state="idle", outcome=None, message=None,
                             started_at=None, finished_at=None, returncode=None)


tmp = tempfile.mkdtemp(prefix="cs-caries-train-")
real_script = trainer_jobs._TRAIN_SCRIPT
real_log = trainer_jobs._LOG_PATH
real_auto = trainer_jobs._AUTO_STATE_PATH
real_preflight = trainer_jobs.preflight
try:
    cfg = _config(tmp)

    print("[1] preflight on an empty machine")
    checks, ready = trainer_jobs.preflight(cfg)
    by_name = {c["check"]: c for c in checks}
    check("reports five checks", len(checks) == 5)
    check("no clinic labels -> blocking failure",
          not by_name["clinic_labels"]["ok"] and by_name["clinic_labels"]["blocking"])
    check("missing public dataset is optional, not a warning failure",
          by_name["public_replay_dataset"]["ok"] and not by_name["public_replay_dataset"]["blocking"])
    check("missing incumbent weights never block", by_name["incumbent_weights"]["ok"])
    check("not ready overall", not ready)

    print("[2] start refuses when preflight blocks")
    st = trainer_jobs.start(cfg)
    check("state is error", st["state"] == "error")
    check("message names the blockers", "cannot start" in (st["message"] or ""))
    check("preflight attached", isinstance(st.get("preflight"), list))
    _reset_job()

    print("[3] clinic labels flip the blocking check")
    labels = os.path.join(cfg.CARIES_CLINIC_DATA_DIR, "labels")
    os.makedirs(labels)
    with open(os.path.join(labels, "xid_1.txt"), "w") as fh:
        fh.write("0 0.1 0.1 0.2 0.1 0.2 0.2\n")
    checks, _ = trainer_jobs.preflight(cfg)
    by_name = {c["check"]: c for c in checks}
    check("clinic_labels now ok", by_name["clinic_labels"]["ok"])

    print("[4] full run: launch, poll, parse PROMOTED")
    fake = os.path.join(tmp, "fake_train.py")
    with open(fake, "w") as fh:
        fh.write("import sys\nprint('args:', sys.argv[1:])\nprint('PROMOTED candidate -> weights/best.pt')\n")
    trainer_jobs._TRAIN_SCRIPT = fake
    trainer_jobs._LOG_PATH = os.path.join(tmp, "run.log")
    trainer_jobs._AUTO_STATE_PATH = os.path.join(tmp, "continual_auto.json")
    trainer_jobs.preflight = lambda c: ([], True)

    st = trainer_jobs.start(cfg, epochs=3, replay_frac=0.25)
    check("run started", st["state"] in ("running", "done"))
    st = _wait_done()
    check("run finished cleanly", st["state"] == "done", st.get("message") or "")
    check("outcome parsed as promoted", st["outcome"] == "promoted")
    check("log tail captured", "--epochs 3" in st["log_tail"] or "args:" in st["log_tail"])

    print("[5] REJECTED marker is recognised")
    with open(fake, "w") as fh:
        fh.write("print('REJECTED candidate: reference F1 regressed')\n")
    _reset_job()
    st = trainer_jobs.start(cfg)
    st = _wait_done()
    check("outcome parsed as rejected", st["outcome"] == "rejected")

    print("[6] non-zero exit becomes failed")
    with open(fake, "w") as fh:
        fh.write("import sys\nprint('boom')\nsys.exit(2)\n")
    _reset_job()
    st = trainer_jobs.start(cfg)
    st = _wait_done()
    check("state error on crash", st["state"] == "error")
    check("outcome failed", st["outcome"] == "failed")
    check("returncode kept", st["returncode"] == 2)

    print("[7] double start is refused while running")
    with open(fake, "w") as fh:
        fh.write("import time\ntime.sleep(3)\nprint('PROMOTED candidate')\n")
    _reset_job()
    st = trainer_jobs.start(cfg)
    check("first start running", st["state"] == "running")
    st2 = trainer_jobs.start(cfg)
    check("second start reports already_running", st2.get("already_running") is True)
    st = _wait_done()
    check("long run still finalises", st["outcome"] == "promoted")

    print("[8] feedback.recent returns newest first")
    from PIL import Image
    img = Image.new("RGB", (100, 80), (100, 100, 100))
    for i in range(3):
        feedback.record(img, {"type": "caries_incipient",
                              "box": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}},
                        "confirm" if i % 2 == 0 else "reject",
                        {"xray_id": "x%d" % i}, cfg.CARIES_CLINIC_DATA_DIR)
    rec = feedback.recent(cfg.CARIES_CLINIC_DATA_DIR, limit=2)
    check("limit respected", len(rec) == 2)
    check("newest first", rec[0]["xray_id"] == "x2" and rec[1]["xray_id"] == "x1")

    print("[9] auto-start waits for new labels and a cooldown")
    fp = trainer_jobs.clinic_fingerprint(cfg.CARIES_CLINIC_DATA_DIR)
    check("fingerprint sees the confirmed label", bool(fp))
    start, msg = trainer_jobs.should_autostart("", {}, 1000, 900, True)
    check("no labels does not start", start is False and "waiting" in msg)
    start, msg = trainer_jobs.should_autostart(fp, {}, 1000, 900, False)
    check("switch off does not start", start is False)
    start, msg = trainer_jobs.should_autostart(fp, {}, 1000, 900, True)
    check("first new labels start immediately", start is True, msg)
    start, msg = trainer_jobs.should_autostart(fp, {"fingerprint": fp}, 1000, 900, True)
    check("same labels stay idle", start is False and "up to date" in msg)
    start, msg = trainer_jobs.should_autostart(
        fp + "|extra", {"fingerprint": fp, "finished_at_ts": 1000}, 1100, 900, True
    )
    check("cooldown holds a new label", start is False and "next run" in msg)
    start, msg = trainer_jobs.should_autostart(
        fp + "|extra", {"fingerprint": fp, "finished_at_ts": 1000}, 2000, 900, True
    )
    check("cooldown expiry starts", start is True, msg)

    print("[10] a promoted run reloads once, then does not retrain the same labels")
    reloads = []
    trainer_jobs._on_promoted = lambda: reloads.append(1)
    cfg.ENABLE_CARIES_TRAINING = True
    cfg.ENABLE_CARIES_AUTOTRAIN = True
    cfg.CARIES_AUTOTRAIN_EPOCHS = 1
    cfg.CARIES_AUTOTRAIN_COOLDOWN_SEC = 0
    cfg.CARIES_AUTOTRAIN_REPLAY = 0
    # Forget the passes the earlier tests already finished.
    try:
        os.remove(trainer_jobs._AUTO_STATE_PATH)
    except OSError:
        pass
    trainer_jobs._auto["accounted"] = None
    trainer_jobs._auto["needs_reload"] = None
    trainer_jobs._auto["reloaded_for"] = None
    trainer_jobs._auto["pending_fingerprint"] = ""
    _reset_job()
    with open(fake, "w") as fh:
        fh.write("print('PROMOTED candidate -> gen.pt')\n")
    trainer_jobs.service_tick(cfg)
    st = _wait_done()
    check("auto tick launched a run", st["outcome"] == "promoted", st.get("message") or "")
    trainer_jobs.service_tick(cfg)
    check("promoted model reload ran once", len(reloads) == 1, str(len(reloads)))
    trainer_jobs.service_tick(cfg)
    check("second tick does not reload again", len(reloads) == 1)
    check("same labels are not trained again",
          "up to date" in (trainer_jobs._auto.get("message") or ""),
          trainer_jobs._auto.get("message") or "")
    saved = trainer_jobs._load_auto_state()
    check("finished labels were remembered", saved.get("fingerprint") == fp)

    print("[11] ACTIVE pointer is what the caries loader reads")
    from caries.model import CariesModel
    wdir = os.path.join(tmp, "wptr")
    os.makedirs(wdir)
    gen = os.path.join(wdir, "gen-test.pt")
    with open(gen, "wb") as fh:
        fh.write(b"not a real checkpoint")
    with open(os.path.join(wdir, "best.pt"), "wb") as fh:
        fh.write(b"old")
    with open(os.path.join(wdir, "ACTIVE"), "w", encoding="utf-8") as fh:
        fh.write("gen-test.pt\n")
    loader = CariesModel(wdir, enabled=False)
    chosen = loader._find_weights()
    check("loader follows ACTIVE", chosen == gen, chosen or "")

    print("\nAll %d checks passed." % PASS)
finally:
    trainer_jobs._TRAIN_SCRIPT = real_script
    trainer_jobs._LOG_PATH = real_log
    trainer_jobs._AUTO_STATE_PATH = real_auto
    trainer_jobs.preflight = real_preflight
    trainer_jobs._on_promoted = None
    trainer_jobs._auto_config = None
    trainer_jobs.stop_autotrain()
    shutil.rmtree(tmp, ignore_errors=True)
