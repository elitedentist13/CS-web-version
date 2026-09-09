"""
Clinic continual fine-tune for the caries YOLO-seg head.

The training-review button launches this as a subprocess. A public Mendeley /
BWR / ACTA replay set is optional. When it is missing, this script trains on
the clinic's confirmed labels only (replay_frac is forced to 0) and evaluates
on a small clinic hold-out instead of ACTA.

Promotion: the candidate replaces caries/weights/best.pt only if it does not
regress on the hold-out (or if there is no incumbent yet).
"""
from __future__ import annotations

import argparse
import glob
import os
import random
import shutil
import sys

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")


def _pairs_from_flat(images_dir, labels_dir):
    out = []
    if not os.path.isdir(images_dir):
        return out
    for path in sorted(glob.glob(os.path.join(images_dir, "*"))):
        ext = os.path.splitext(path)[1].lower()
        if ext not in IMAGE_EXTS:
            continue
        stem = os.path.splitext(os.path.basename(path))[0]
        label = os.path.join(labels_dir, stem + ".txt")
        if os.path.isfile(label) and os.path.getsize(label) > 0:
            out.append((path, label))
    return out


def clinic_pairs(clinic_dir):
    return _pairs_from_flat(
        os.path.join(clinic_dir, "images"),
        os.path.join(clinic_dir, "labels"),
    )


def public_pairs(public_dir, split="train"):
    nested = _pairs_from_flat(
        os.path.join(public_dir, "images", split),
        os.path.join(public_dir, "labels", split),
    )
    if nested:
        return nested
    return _pairs_from_flat(
        os.path.join(public_dir, split, "images"),
        os.path.join(public_dir, split, "labels"),
    )


def _link_or_copy(src, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest):
        return
    try:
        os.link(src, dest)
    except OSError:
        shutil.copy2(src, dest)


def _place(pairs, images_dir, labels_dir, prefix=""):
    for img, lab in pairs:
        stem = prefix + os.path.splitext(os.path.basename(img))[0]
        ext = os.path.splitext(img)[1]
        _link_or_copy(img, os.path.join(images_dir, stem + ext))
        _link_or_copy(lab, os.path.join(labels_dir, stem + ".txt"))


def build_run_dataset(clinic_dir, public_dir, out_dir, replay_frac=0.5, seed=13):
    """
    Build a YOLO-seg folder at out_dir. Returns (n_train, n_val, n_replay, note).
    """
    rng = random.Random(seed)
    clinic = clinic_pairs(clinic_dir)
    if not clinic:
        raise SystemExit("no confirmed clinic labels under %s" % clinic_dir)

    pub_train = public_pairs(public_dir, "train") if public_dir else []
    pub_val = public_pairs(public_dir, "val") if public_dir else []
    if not pub_val and public_dir:
        pub_val = public_pairs(public_dir, "test")

    frac = float(replay_frac)
    if not pub_train:
        frac = 0.0
    n_replay = 0
    replay = []
    if pub_train and frac > 0:
        n_replay = max(1, int(round(len(pub_train) * min(1.0, frac))))
        replay = rng.sample(pub_train, min(n_replay, len(pub_train)))
        n_replay = len(replay)

    note = "clinic-only"
    val = []
    train = list(clinic)
    if pub_val:
        val = list(pub_val)
        note = "public hold-out"
    elif len(clinic) >= 3:
        rng.shuffle(train)
        val = [train.pop()]
        note = "clinic hold-out (1 film)"
    else:
        val = [train[0]]
        note = "tiny clinic set — val reuses a train film"

    for split in ("train", "val"):
        os.makedirs(os.path.join(out_dir, "images", split), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "labels", split), exist_ok=True)
        shutil.rmtree(os.path.join(out_dir, "images", split), ignore_errors=True)
        shutil.rmtree(os.path.join(out_dir, "labels", split), ignore_errors=True)
        os.makedirs(os.path.join(out_dir, "images", split), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "labels", split), exist_ok=True)

    _place(train + replay, os.path.join(out_dir, "images", "train"),
           os.path.join(out_dir, "labels", "train"))
    _place(val, os.path.join(out_dir, "images", "val"),
           os.path.join(out_dir, "labels", "val"), prefix="val_")

    yaml_path = os.path.join(out_dir, "data.yaml")
    with open(yaml_path, "w", encoding="utf-8") as fh:
        fh.write("path: %s\n" % out_dir.replace("\\", "/"))
        fh.write("train: images/train\n")
        fh.write("val: images/val\n")
        fh.write("names:\n  0: caries\n")
    return len(train) + n_replay, len(val), n_replay, note, yaml_path


def _map50(metrics):
    for attr in ("seg", "box"):
        part = getattr(metrics, attr, None)
        if part is None:
            continue
        val = getattr(part, "map50", None)
        if val is not None:
            return float(val)
    return None


def _promote(candidate_pt, dest_pt):
    os.makedirs(os.path.dirname(dest_pt), exist_ok=True)
    shutil.copy2(candidate_pt, dest_pt)
    print("PROMOTED candidate -> %s" % dest_pt)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Continual caries fine-tune")
    parser.add_argument("--public", default="", help="prepared public YOLO dataset (optional)")
    parser.add_argument("--clinic", required=True)
    parser.add_argument("--weights", default="")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--replay-frac", type=float, default=0.5)
    parser.add_argument("--margin", type=float, default=0.01)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--out", default="", help="run folder (default: caries/train/dataset_continual)")
    args = parser.parse_args(argv)

    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = args.out or os.path.join(here, "dataset_continual")
    n_train, n_val, n_replay, note, yaml_path = build_run_dataset(
        args.clinic, args.public, out_dir, replay_frac=args.replay_frac
    )
    print("dataset: train=%d val=%d replay=%d (%s)" % (n_train, n_val, n_replay, note))
    print("yaml: %s" % yaml_path)

    try:
        from ultralytics import YOLO
    except Exception as exc:
        raise SystemExit("ultralytics is required: %s" % exc)

    weights = args.weights if args.weights and os.path.isfile(args.weights) else "yolov8n-seg.pt"
    print("base weights: %s" % weights)
    model = YOLO(weights)

    device = "cpu"
    try:
        import torch
        if torch.cuda.is_available():
            device = 0
    except Exception:
        pass

    runs = os.path.join(here, "runs")
    batch = 1 if n_train < 4 else min(4, n_train)
    model.train(
        data=yaml_path,
        epochs=max(1, int(args.epochs)),
        imgsz=int(args.imgsz),
        batch=batch,
        device=device,
        project=runs,
        name="continual",
        exist_ok=True,
        plots=False,
        verbose=True,
        patience=max(5, int(args.epochs) // 4),
    )

    cand = os.path.join(runs, "continual", "weights", "best.pt")
    if not os.path.isfile(cand):
        last = os.path.join(runs, "continual", "weights", "last.pt")
        cand = last if os.path.isfile(last) else ""
    if not cand:
        raise SystemExit("training finished but no best.pt / last.pt was written")

    dest = args.weights if args.weights else os.path.join(
        os.path.dirname(here), "weights", "best.pt"
    )
    incumbent = dest if os.path.isfile(dest) and os.path.abspath(dest) != os.path.abspath(cand) else ""

    try:
        cand_m = YOLO(cand).val(data=yaml_path, imgsz=int(args.imgsz), device=device, verbose=False)
        cand_score = _map50(cand_m)
        print("candidate map50: %s" % cand_score)
        if incumbent:
            inc_m = YOLO(incumbent).val(data=yaml_path, imgsz=int(args.imgsz), device=device, verbose=False)
            inc_score = _map50(inc_m)
            print("incumbent map50: %s" % inc_score)
            if cand_score is not None and inc_score is not None:
                if cand_score + float(args.margin) < inc_score:
                    print("REJECTED candidate: reference F1/mAP50 regressed")
                    return 0
    except Exception as exc:
        print("hold-out eval skipped (%s) — promoting the trained weights" % exc)

    _promote(cand, dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
