"""Train Banana’s ResNet-50 UNet on an Aariz-layout folder.

This is the sidecar development entry. Weights write to ceph/unet/weights/
and are never merged into the published 1502 library.

  %LOCALAPPDATA%\\cs-xray-ai\\venv\\Scripts\\python.exe train.py --dataset PATH --epochs 20

Needs torch, torchvision, numpy, opencv-python, albumentations.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from config import BATCH_SIZE, IMAGE_SIZE, VALID_BATCH_SIZE, WEIGHTS_DIR
from model import UNetHeatmapModel


def main(argv=None):
    p = argparse.ArgumentParser(description="Train Banana sidecar ResNet-50 UNet")
    p.add_argument("--dataset", required=True, help="Aariz-layout folder (train/valid/Cephalograms)")
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--batch", type=int, default=BATCH_SIZE)
    p.add_argument("--valid-batch", type=int, default=VALID_BATCH_SIZE)
    p.add_argument("--out", default=str(WEIGHTS_DIR / "banana_unet.pth"))
    p.add_argument("--pretrained", action="store_true", help="ImageNet encoder + freeze first")
    p.add_argument("--unfreeze-after", type=int, default=5, help="Unfreeze encoder after N epochs (0=never)")
    args = p.parse_args(argv)

    try:
        import torch
        from torch.utils.data import DataLoader
    except Exception as exc:
        print("torch is required:", exc)
        return 2

    from dataset import HeatmapDataset

    root = Path(args.dataset)
    if not (root / "train" / "Cephalograms").is_dir():
        print("dataset needs train/Cephalograms — see dataset.py header")
        return 2

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_ds = HeatmapDataset(str(root), "TRAIN", IMAGE_SIZE)
    loaders = {
        "train": DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=0),
    }
    if (root / "valid" / "Cephalograms").is_dir():
        loaders["valid"] = DataLoader(
            HeatmapDataset(str(root), "VALID", IMAGE_SIZE),
            batch_size=args.valid_batch, shuffle=False, num_workers=0,
        )

    model = UNetHeatmapModel(pretrained=args.pretrained).to(device)
    opt = torch.optim.Adam((q for q in model.parameters() if q.requires_grad), lr=args.lr)
    loss_fn = torch.nn.MSELoss()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    best = float("inf")

    for epoch in range(1, args.epochs + 1):
        if args.pretrained and args.unfreeze_after and epoch == args.unfreeze_after + 1:
            model.unfreeze_backbone()
            opt = torch.optim.Adam(model.parameters(), lr=args.lr * 0.1)
            print("unfroze ResNet-50 encoder")
        model.train()
        running = 0.0
        n = 0
        for images, heatmaps, _pts in loaders["train"]:
            images = images.to(device)
            heatmaps = heatmaps.to(device)
            pred = model(images)
            if pred.shape[-2:] != heatmaps.shape[-2:]:
                pred = torch.nn.functional.interpolate(pred, size=heatmaps.shape[-2:], mode="bilinear", align_corners=False)
            loss = loss_fn(pred, heatmaps)
            opt.zero_grad()
            loss.backward()
            opt.step()
            running += float(loss.item()) * images.size(0)
            n += images.size(0)
        train_loss = running / max(n, 1)
        msg = "epoch %s train_mse=%.6f" % (epoch, train_loss)
        val_loss = train_loss
        if "valid" in loaders:
            model.eval()
            running = 0.0
            n = 0
            with torch.no_grad():
                for images, heatmaps, _pts in loaders["valid"]:
                    images = images.to(device)
                    heatmaps = heatmaps.to(device)
                    pred = model(images)
                    if pred.shape[-2:] != heatmaps.shape[-2:]:
                        pred = torch.nn.functional.interpolate(pred, size=heatmaps.shape[-2:], mode="bilinear", align_corners=False)
                    loss = loss_fn(pred, heatmaps)
                    running += float(loss.item()) * images.size(0)
                    n += images.size(0)
            val_loss = running / max(n, 1)
            msg += " valid_mse=%.6f" % val_loss
        print(msg)
        if val_loss <= best:
            best = val_loss
            torch.save(model.state_dict(), str(out))
            print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
