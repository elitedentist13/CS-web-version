"""
Copy dated X-ray Assist extras into a clinic folder without replacing originals.

    python apply_xray_ai_extras.py
    python apply_xray_ai_extras.py --root C:\\banana\\CS-web-version-main
    python apply_xray_ai_extras.py --check
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

EXTRA_ID = "2026-09-09"
CSS_NAME = "style-xray-ai-20260909.css"
JS_NAME = "app-xray-ai-20260909.js"
BOOT_NAME = "xray_ai_extras_boot_20260909.py"
MAIN_NAME = "xray_ai_extras_main_20260909.py"
CSS_NEEDLE = "['style.css', 'style-mobile.css'"
CSS_INJECT = "['style.css', 'style-xray-ai-20260909.css', 'style-mobile.css'"
JS_MARKER = "app-xray-ai-20260909.js"
UVICORN_NEEDLE = '"%VENV_PY%" -m uvicorn main:app --host 127.0.0.1 --port 8877'
UVICORN_BLOCK = (
    "set \"UVICORN_APP=main:app\"\n"
    "if exist \"%~dp0xray-ai-service\\xray_ai_extras_main_20260909.py\" (\n"
    "  set \"UVICORN_APP=xray_ai_extras_main_20260909:app\"\n"
    ")\n"
    "\"%VENV_PY%\" -m uvicorn %UVICORN_APP% --host 127.0.0.1 --port 8877"
)


def out(msg=""):
    print(msg, flush=True)


def find_source_extras(repo: Path) -> Path | None:
    here = Path(__file__).resolve().parent
    candidates = [
        repo / "xray-ai-deploy-pack" / "extras" / EXTRA_ID,
        here.parent / "xray-ai-deploy-pack" / "extras" / EXTRA_ID,
        repo / "extras" / EXTRA_ID,
        here / "extras" / EXTRA_ID,
        repo / "xray-ai-extras" / EXTRA_ID,
    ]
    for path in candidates:
        if (path / "manifest.json").is_file() or (path / "web" / CSS_NAME).is_file():
            return path
    return None


def copy_no_overwrite(src: Path, dest: Path, added: list, skipped: list):
    if src.is_dir():
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            if child.name in ("__pycache__", ".DS_Store"):
                continue
            copy_no_overwrite(child, dest / child.name, added, skipped)
        return
    if dest.exists():
        skipped.append(str(dest))
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    added.append(str(dest))


def backup_once(path: Path, suffix: str):
    bak = path.with_name(path.name + suffix)
    if path.is_file() and not bak.exists():
        shutil.copy2(path, bak)
        out("  [bak]  %s" % bak.name)
        return True
    return False


def inject_index(index: Path) -> str:
    if not index.is_file():
        return "missing"
    text = index.read_text(encoding="utf-8", errors="replace")
    changed = False
    if CSS_NAME not in text and CSS_NEEDLE in text:
        text = text.replace(CSS_NEEDLE, CSS_INJECT, 1)
        changed = True
    if JS_MARKER not in text:
        needle = None
        for line in text.splitlines():
            if "app-xray-ai.js" in line and "app-xray-ai-20260909" not in line:
                needle = line
                break
        if needle:
            indent = needle[: len(needle) - len(needle.lstrip())]
            insert = indent + "'app-xray-ai-20260909.js',"
            text = text.replace(needle, needle + "\n" + insert, 1)
            changed = True
    if not changed:
        return "already"
    backup_once(index, ".bak-xray-ai-20260909")
    index.write_text(text, encoding="utf-8")
    return "patched"


def patch_start_bat(bat: Path) -> str:
    if not bat.is_file():
        return "missing"
    text = bat.read_text(encoding="utf-8", errors="replace")
    if "xray_ai_extras_main_20260909" in text:
        return "already"
    if UVICORN_NEEDLE not in text:
        return "no-uvicorn-line"
    backup_once(bat, ".bak-xray-ai-20260909")
    bat.write_text(text.replace(UVICORN_NEEDLE, UVICORN_BLOCK, 1), encoding="utf-8")
    return "patched"


def apply(root: Path, check_only=False):
    repo = root.resolve()
    src = find_source_extras(repo)
    out()
    out("============================================================")
    out("  X-ray Assist extras %s (additive, no overwrite)" % EXTRA_ID)
    out("============================================================")
    out("  Clinic folder : %s" % repo)
    out("  Extras source : %s" % (src or "(not found)"))
    if src is None:
        out("  [WARN] extras payload missing — skip")
        return 0 if check_only else 0

    dest_tree = repo / "xray-ai-extras" / EXTRA_ID
    web_src = src / "web"
    svc_src = src / "service"
    added, skipped = [], []

    if check_only:
        css = repo / CSS_NAME
        js = repo / JS_NAME
        boot = repo / "xray-ai-service" / BOOT_NAME
        index = repo / "index.html"
        out("  css extra     : %s" % ("ok" if css.is_file() else "miss"))
        out("  js extra      : %s" % ("ok" if js.is_file() else "miss"))
        out("  service boot  : %s" % ("ok" if boot.is_file() else "miss"))
        wired = index.is_file() and CSS_NAME in index.read_text(encoding="utf-8", errors="replace")
        out("  index wired   : %s" % ("ok" if wired else "miss"))
        return 0 if css.is_file() and js.is_file() and boot.is_file() and wired else 2

    copy_no_overwrite(src, dest_tree, added, skipped)

    if web_src.is_dir():
        for name in (CSS_NAME, JS_NAME):
            copy_no_overwrite(web_src / name, repo / name, added, skipped)

    svc_dir = repo / "xray-ai-service"
    if svc_src.is_dir() and svc_dir.is_dir():
        for name in (BOOT_NAME, MAIN_NAME):
            copy_no_overwrite(svc_src / name, svc_dir / name, added, skipped)

    idx_status = inject_index(repo / "index.html")
    bat_status = patch_start_bat(repo / "start-xray-ai.bat")
    pack_bat = repo / "xray-ai-deploy-pack" / "start-xray-ai.bat"
    pack_bat_status = patch_start_bat(pack_bat) if pack_bat.is_file() else "n/a"

    out("  added files   : %d" % len(added))
    for p in added:
        out("    + %s" % p)
    out("  skipped exist : %d (left untouched)" % len(skipped))
    out("  index.html    : %s" % idx_status)
    out("  start-xray-ai : %s" % bat_status)
    if pack_bat_status != "n/a":
        out("  pack starter  : %s" % pack_bat_status)
    out("  Original service/web files were not replaced.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Install additive X-ray Assist extras")
    parser.add_argument("--root", default=None, help="Clinic app folder")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    root = Path(args.root) if args.root else Path(__file__).resolve().parent.parent
    if args.root is None:
        env = (__import__("os").environ.get("INSTALL_ROOT") or "").strip()
        if env:
            root = Path(env)
        elif not (root / "index.html").is_file():
            root = Path(r"C:\banana\CS-web-version-main")
    return apply(root, check_only=args.check)


if __name__ == "__main__":
    sys.exit(main())
