"""Legacy TKO entrypoint — prefer resolve-unmatched-notes.py for all branches.

Example (new):
  python resolve-unmatched-notes.py --branch TKO --batch-id TKO_20260805_000530 --clinic-tag TKO
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "resolve-unmatched-notes.py"

# Historical TKO source batch from first import wave; override via CLI if needed.
DEFAULT_BATCH = "TKO_20260805_000530"


def main() -> None:
    args = sys.argv[1:]
    if not any(a.startswith("--batch-id") or a == "--batch-id" for a in args):
        args = ["--batch-id", DEFAULT_BATCH, *args]
    if not any(a.startswith("--branch") or a == "--branch" for a in args):
        args = ["--branch", "TKO", *args]
    if not any(a.startswith("--clinic-tag") or a == "--clinic-tag" for a in args):
        args = ["--clinic-tag", "TKO", *args]
    raise SystemExit(subprocess.call([sys.executable, str(SCRIPT), *args]))


if __name__ == "__main__":
    main()
