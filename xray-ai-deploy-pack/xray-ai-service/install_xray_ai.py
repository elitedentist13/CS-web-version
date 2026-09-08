"""
Clinic installer / auditor for the local X-ray Assist service.

    python install_xray_ai.py
    python install_xray_ai.py --check
    python install_xray_ai.py --start
    python install_xray_ai.py --root C:\\banana\\CS-web-version-main

Default install path is C:\\banana\\CS-web-version-main. Double-click
install-xray-ai.bat (do not use BioTime Python 3.7). Internet is required
the first time.
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Clinic app lives here unless the user passes --root / INSTALL_ROOT.
DEFAULT_INSTALL_ROOT = Path(r"C:\banana\CS-web-version-main")

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
AI_HOME = Path(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")) / "cs-xray-ai"
VENV_DIR = AI_HOME / "venv"
VENV_PY = VENV_DIR / "Scripts" / "python.exe"
CACHE = Path(os.environ.get("MODEL_CACHE_DIR") or (AI_HOME / "model_cache"))
REQS = HERE / "requirements.txt"
TOOTH_REPO = "abychkov/dental-fdi-detection"
COND_REPO = "Mobe1/argos-dentsight-stage2-conditions-v1"
HEALTH = "http://127.0.0.1:8877/health"
APP_URL = "http://127.0.0.1:8123/index.html"


def configure(root=None):
    """Point the installer at the clinic folder (default C:\\banana\\CS-web-version-main)."""
    global HERE, REPO, REQS, CACHE
    env_root = (os.environ.get("INSTALL_ROOT") or "").strip()
    chosen = Path(root or env_root or DEFAULT_INSTALL_ROOT)
    if not (chosen / "xray-ai-service" / "install_xray_ai.py").is_file():
        fallback = Path(__file__).resolve().parent.parent
        if (fallback / "xray-ai-service" / "install_xray_ai.py").is_file():
            chosen = fallback
    REPO = chosen.resolve()
    HERE = REPO / "xray-ai-service"
    REQS = HERE / "requirements.txt"
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
    os.environ.setdefault("MODEL_CACHE_DIR", str(CACHE))


configure()


def out(msg=""):
    print(msg, flush=True)


def ok(name, detail=""):
    out("  [OK]   %-28s %s" % (name, detail))


def miss(name, detail=""):
    out("  [MISS] %-28s %s" % (name, detail))


def warn(name, detail=""):
    out("  [WARN] %-28s %s" % (name, detail))


def run(cmd, cwd=None, check=False):
    out("        > %s" % " ".join(str(c) for c in cmd))
    return subprocess.run(list(map(str, cmd)), cwd=cwd or str(HERE)).returncode


def venv_import(mod):
    if not VENV_PY.is_file():
        return False
    r = subprocess.run(
        [str(VENV_PY), "-c", "import %s" % mod],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return r.returncode == 0


def repo_dir(repo_id):
    return CACHE / ("models--" + repo_id.replace("/", "--"))


def has_onnx():
    return bool(glob.glob(str(CACHE / "**" / "*.onnx"), recursive=True))


def has_condition():
    root = repo_dir(COND_REPO)
    return bool(
        glob.glob(str(root / "**" / "model.safetensors"), recursive=True)
        and glob.glob(str(root / "**" / "config.json"), recursive=True)
    )


def caries_weights():
    hits = sorted(
        glob.glob(str(HERE / "caries" / "weights" / "**" / "*.pt"), recursive=True)
        + glob.glob(str(HERE / "caries" / "weights" / "**" / "*.onnx"), recursive=True)
    )
    return hits[0] if hits else None


def protocol_registered():
    if os.name != "nt":
        return False
    try:
        import winreg
    except ImportError:
        return False
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\csxrayai")
        winreg.CloseKey(key)
        return True
    except OSError:
        return False


def health_json():
    try:
        with urllib.request.urlopen(HEALTH, timeout=4) as resp:
            import json

            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


def app_wired():
    index = REPO / "index.html"
    if not index.is_file():
        return False, "index.html missing"
    text = index.read_text(encoding="utf-8", errors="replace")
    if "127.0.0.1:8877" not in text:
        return False, "XRAY_AI_API_URL is not 8877"
    return True, "points at http://127.0.0.1:8877"


def audit():
    """Return a list of (key, status, detail) and print the table."""
    out()
    out("============================================================")
    out("  X-ray Assist — current status on this PC")
    out("============================================================")
    out("  Install path   : %s" % REPO)
    out("  Service folder : %s" % HERE)
    out("  Venv / cache   : %s" % AI_HOME)
    out()

    rows = []

    def rec(key, status, detail):
        rows.append((key, status, detail))
        if status == "ok":
            ok(key, detail)
        elif status == "warn":
            warn(key, detail)
        else:
            miss(key, detail)

    if (HERE / "main.py").is_file() and REQS.is_file():
        rec("service files", "ok", str(HERE))
    else:
        rec("service files", "miss", "xray-ai-service\\main.py or requirements.txt missing")

    wired, wdetail = app_wired()
    rec("clinic app wiring", "ok" if wired else "miss", wdetail)

    if sys.version_info >= (3, 10):
        rec("host Python", "ok", sys.executable + "  " + sys.version.split()[0])
    else:
        rec("host Python", "miss", "need 3.10+, got %s (%s)" % (sys.version.split()[0], sys.executable))

    if VENV_PY.is_file():
        rec("virtual env", "ok", str(VENV_PY))
    else:
        rec("virtual env", "miss", "will create %s" % VENV_DIR)

    core = ("fastapi", "uvicorn", "numpy", "PIL", "cv2", "onnxruntime", "torch", "transformers", "huggingface_hub")
    missing_core = [m for m in core if not venv_import(m)]
    if not missing_core and VENV_PY.is_file():
        rec("core packages", "ok", "fastapi / torch / onnxruntime / transformers")
    else:
        rec("core packages", "miss", "need: " + (", ".join(missing_core) or "venv first"))

    if venv_import("ultralytics"):
        rec("ultralytics", "ok", "caries YOLO runtime")
    else:
        rec("ultralytics", "miss", "required for trained caries head")

    if has_onnx():
        rec("tooth ONNX", "ok", TOOTH_REPO)
    else:
        rec("tooth ONNX", "miss", "download %s" % TOOTH_REPO)

    if has_condition():
        rec("condition weights", "ok", COND_REPO)
    else:
        rec("condition weights", "miss", "download %s" % COND_REPO)

    cw = caries_weights()
    if cw:
        rec("caries weights", "ok", cw)
    else:
        rec(
            "caries weights",
            "warn",
            "no caries\\weights\\best.pt — classical caries fallback still works",
        )

    if protocol_registered():
        rec("csxrayai:// protocol", "ok", "HKCU registered")
    else:
        rec("csxrayai:// protocol", "miss", "needed for the lightbox Server button")

    hj = health_json()
    if hj and hj.get("ok"):
        models = hj.get("models") or {}
        bits = []
        for name in ("tooth_detector", "condition_detector", "caries_model"):
            m = models.get(name) or {}
            bits.append("%s=%s" % (name, "ready" if m.get("ready") else "down"))
        rec("service :8877", "ok", "; ".join(bits) or "ok")
    else:
        rec("service :8877", "warn", "not listening — start after install")

    out()
    return rows


def ensure_venv():
    if VENV_PY.is_file():
        r = subprocess.run(
            [str(VENV_PY), "-c", "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)"]
        )
        if r.returncode == 0:
            return True
        out("[install] Existing venv is too old — recreating")
        shutil.rmtree(VENV_DIR, ignore_errors=True)
    AI_HOME.mkdir(parents=True, exist_ok=True)
    out("[install] Creating virtual environment at %s" % VENV_DIR)
    if run([sys.executable, "-m", "venv", str(VENV_DIR)]) != 0:
        out("[ERROR] Could not create the virtual environment.")
        return False
    return VENV_PY.is_file()


def ensure_deps():
    if not VENV_PY.is_file():
        return False
    need = not (VENV_DIR / ".deps-installed").is_file()
    for mod in ("uvicorn", "fastapi", "ultralytics", "onnxruntime", "transformers", "torch"):
        if not venv_import(mod):
            need = True
            break
    if not need:
        out("[install] Packages already present.")
        return True

    out("[install] Installing Python packages (several minutes, CPU torch)...")
    run([str(VENV_PY), "-m", "pip", "install", "--upgrade", "pip"])
    code = run(
        [
            str(VENV_PY),
            "-m",
            "pip",
            "install",
            "--extra-index-url",
            "https://download.pytorch.org/whl/cpu",
            "-r",
            str(REQS),
        ]
    )
    if code != 0:
        out("[WARN] Full requirements install reported an error — trying ultralytics without opencv-python.")

    if not venv_import("ultralytics"):
        # opencv-python-headless already provides cv2; ultralytics' opencv-python
        # wheel often fails with WinError 5 while uvicorn has cv2.pyd locked.
        run([str(VENV_PY), "-m", "pip", "install", "ultralytics>=8.3", "--no-deps"])
        run(
            [
                str(VENV_PY),
                "-m",
                "pip",
                "install",
                "cloudpickle",
                "matplotlib",
                "requests>=2.23",
                "psutil",
                "polars>=0.20",
                "nvidia-ml-py",
                "ultralytics-thop>=2.1.6",
                "ultralytics-platform>=0.1.32",
            ]
        )

    if venv_import("uvicorn") and venv_import("fastapi"):
        (VENV_DIR / ".deps-installed").write_text("installed\n", encoding="ascii")
        if not venv_import("ultralytics"):
            out("[WARN] ultralytics still missing — caries trained head will stay off.")
        return True
    out("[ERROR] Core packages failed to install.")
    return False


def ensure_models():
    CACHE.mkdir(parents=True, exist_ok=True)
    if has_onnx() and has_condition():
        (CACHE / ".downloaded").write_text("downloaded\n", encoding="ascii")
        out("[install] Model weights already on disk.")
        return True
    out("[install] Downloading Hugging Face models into %s" % CACHE)
    out("           tooth ONNX: %s" % TOOTH_REPO)
    out("           conditions: %s" % COND_REPO)
    code = run([str(VENV_PY), str(HERE / "download_models.py")], cwd=str(HERE))
    if has_onnx() and has_condition():
        (CACHE / ".downloaded").write_text("downloaded\n", encoding="ascii")
        return True
    if has_onnx() or has_condition():
        out("[WARN] Partial model download (exit %s). Service can start degraded." % code)
        return True
    out("[ERROR] Model download failed. If a repo is gated, set HF_TOKEN and re-run.")
    return False


def ensure_protocol():
    bat = REPO / "register-xray-ai-protocol.bat"
    if not bat.is_file():
        out("[WARN] register-xray-ai-protocol.bat missing — skip protocol.")
        return False
    code = run(["cmd", "/c", str(bat), "nopause"], cwd=str(REPO))
    return code == 0 or protocol_registered()


def start_service():
    if not VENV_PY.is_file():
        return False
    env = os.environ.copy()
    env["MODEL_CACHE_DIR"] = str(CACHE)
    env["HF_HUB_DISABLE_SYMLINKS"] = "1"
    env["PORT"] = "8877"
    env["HOST"] = "127.0.0.1"
    out("[start] Launching uvicorn on http://127.0.0.1:8877 ...")
    if os.name == "nt":
        subprocess.Popen(
            [str(VENV_PY), "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8877"],
            cwd=str(HERE),
            env=env,
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
        )
    else:
        subprocess.Popen(
            [str(VENV_PY), "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8877"],
            cwd=str(HERE),
            env=env,
        )
    for _ in range(20):
        time.sleep(2)
        if health_json():
            out("[start] Health check OK: %s" % HEALTH)
            return True
    out("[WARN] Service started but /health is not up yet — wait and retry in a browser.")
    return False


def start_app_server():
    out("[start] Local clinic page: %s" % APP_URL)
    if os.name == "nt":
        subprocess.Popen(
            [sys.executable, "-m", "http.server", "8123", "--bind", "127.0.0.1"],
            cwd=str(REPO),
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
        )
    else:
        subprocess.Popen(
            [sys.executable, "-m", "http.server", "8123", "--bind", "127.0.0.1"],
            cwd=str(REPO),
        )


def needs_work(rows):
    return any(status == "miss" for _, status, _ in rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Install / audit local X-ray Assist")
    parser.add_argument(
        "--root",
        default=None,
        help="Clinic app folder (default: C:\\banana\\CS-web-version-main)",
    )
    parser.add_argument("--check", action="store_true", help="report only, do not download")
    parser.add_argument("--start", action="store_true", help="start AI + local web server after install")
    args = parser.parse_args(argv)
    configure(args.root)

    if sys.version_info < (3, 10):
        out("[ERROR] This installer must run on Python 3.10 or newer.")
        out("        Do not use BioTime Python 3.7. Install Python 3.12 from python.org")
        out("        (or winget install Python.Python.3.12) then re-run install-xray-ai.bat.")
        return 1

    rows = audit()
    if args.check:
        return 0 if not needs_work(rows) else 2

    if not needs_work(rows) and has_onnx() and has_condition() and venv_import("uvicorn"):
        out("Nothing missing. Models and packages are ready.")
    else:
        out("------------------------------------------------------------")
        out("  Installing missing pieces (internet required)")
        out("------------------------------------------------------------")
        if not ensure_venv():
            return 1
        if not ensure_deps():
            return 1
        if not ensure_models():
            return 1
        ensure_protocol()

    if args.start:
        start_service()
        start_app_server()

    out()
    out("============================================================")
    out("  Recheck after install")
    out("============================================================")
    audit()
    out("Next:")
    out("  1. Leave start-xray-ai.bat running  (or this installer --start)")
    out("  2. Open  %s" % APP_URL)
    out("  3. Confirm  %s" % HEALTH)
    out("  4. Hard-refresh the clinic page (Ctrl+F5), then Analyze")
    if not caries_weights():
        out()
        out("Note: trained caries weights are optional. Without best.pt the")
        out("      service still runs (classical caries + CEJ–crest perio).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
