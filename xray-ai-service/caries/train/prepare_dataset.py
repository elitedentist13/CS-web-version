"""
Stage images into the YOLO-seg layout used as a continual-training replay set.

Public Mendeley / BWR / ACTA downloads are optional and must be fetched by the
operator (they are not redistributed). On a clinic PC the usual path is to
stage this clinic's own confirmed labels:

    python prepare_dataset.py --source clinic --root ../clinic_data --out ./dataset

The training-review button no longer requires this step: with no public
dataset it trains on clinic labels only. This script is for operators who
want an explicit replay folder.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_continual import build_run_dataset, clinic_pairs


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare caries YOLO dataset")
    parser.add_argument("--source", default="clinic",
                        choices=("clinic", "mendeley", "bwr", "acta"))
    parser.add_argument("--root", default="", help="source folder")
    parser.add_argument("--out", default="./dataset")
    args = parser.parse_args(argv)

    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.abspath(os.path.join(here, args.out) if not os.path.isabs(args.out) else args.out)

    if args.source != "clinic":
        print("Public source %r is not bundled." % args.source)
        print("Download it yourself, then convert into YOLO-seg folders:")
        print("  %s/images/train  +  %s/labels/train" % (out, out))
        print("See caries/README.md for Mendeley / BWR / ACTA notes.")
        return 2

    root = args.root or os.path.join(os.path.dirname(here), "clinic_data")
    root = os.path.abspath(root)
    pairs = clinic_pairs(root)
    if not pairs:
        print("No confirmed clinic labels in %s" % root)
        print("Confirm some caries hints in X-ray Assist first.")
        return 2

    n_train, n_val, n_replay, note, yaml_path = build_run_dataset(
        root, public_dir="", out_dir=out, replay_frac=0.0
    )
    print("Wrote %d train / %d val labelled films (%s)" % (n_train, n_val, note))
    print(yaml_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
