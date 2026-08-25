"""
One-time model download into the local cache.

    python download_models.py

Re-running is safe: huggingface_hub skips files that are already present.

Note on gated repositories: if a model requires accepting terms or an access
token, export HF_TOKEN before running. The script reports which repo failed
rather than aborting silently, because the service can still run in a degraded
mode with only one of the two stages available.
"""

import os
import sys

import config


def download(repo_id, cache_dir):
    from huggingface_hub import snapshot_download

    print("[download] %s -> %s" % (repo_id, cache_dir))
    path = snapshot_download(
        repo_id=repo_id,
        cache_dir=cache_dir,
        token=os.environ.get("HF_TOKEN") or None,
    )
    print("[ok] %s" % path)
    return path


def main():
    os.makedirs(config.MODEL_CACHE_DIR, exist_ok=True)
    targets = [
        ("tooth/FDI detector (ONNX)", config.TOOTH_MODEL_REPO),
        ("condition detector (transformers)", config.CONDITION_MODEL_REPO),
    ]

    failures = []
    for label, repo in targets:
        print("\n== %s ==" % label)
        try:
            download(repo, config.MODEL_CACHE_DIR)
        except Exception as exc:
            print("[FAIL] %s: %s" % (repo, exc), file=sys.stderr)
            failures.append((repo, str(exc)))

    print("\n" + "=" * 60)
    if failures:
        print("Completed with %d failure(s):" % len(failures))
        for repo, err in failures:
            print("  - %s: %s" % (repo, err))
        print(
            "\nIf a repo is gated, set HF_TOKEN and retry:\n"
            "  setx HF_TOKEN hf_xxxxx   (Windows, new shell required)\n"
            "  export HF_TOKEN=hf_xxxxx (Linux/macOS)"
        )
        print(
            "\nThe service still starts with whichever stage loaded; check\n"
            "GET /health to see per-model status."
        )
        return 1

    print("All models downloaded. Start the service with:")
    print("  python -m uvicorn main:app --host %s --port %d" % (config.HOST, config.PORT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
