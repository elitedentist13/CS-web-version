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

from config import (
    BATCH_SIZE, HEATMAP_SIGMA, IMAGE_SIZE, INPUT_SIZE, VALID_BATCH_SIZE, WEIGHTS_DIR,
)
from model import UNetHeatmapModel


def landmark_loss(pred, target, landmarks):
    """Peak-weighted heatmap MSE plus a soft-argmax coordinate penalty.

    Returns (loss, mean radial error in resized-image pixels). The radial
    error is what checkpointing uses: a low heatmap MSE can still sit a
    pixel off the label.
    """
    import torch
    import torch.nn.functional as F
    from infer import local_soft_argmax

    if pred.shape[-2:] != target.shape[-2:]:
        pred = F.interpolate(
            pred, size=target.shape[-2:], mode="bilinear", align_corners=False)
    pos = (target > 0.2).to(pred.dtype)
    weight = 1.0 + 24.0 * pos
    mse = ((pred - target).pow(2) * weight).sum() / weight.sum().clamp(min=1.0)
    xy = local_soft_argmax(pred)
    hm_h = float(pred.shape[-2])
    hm_w = float(pred.shape[-1])
    tgt = torch.empty_like(xy)
    tgt[..., 0] = landmarks[..., 0] * (hm_w / float(IMAGE_SIZE[1]))
    tgt[..., 1] = landmarks[..., 1] * (hm_h / float(IMAGE_SIZE[0]))
    present = (target.amax(dim=(-1, -2)) > 1e-3).to(pred.dtype)
    diff = (xy - tgt).pow(2).sum(dim=-1)
    denom = present.sum().clamp(min=1.0)
    coord = (diff * present).sum() / denom
    radial = (diff.clamp(min=0).sqrt() * (float(INPUT_SIZE) / hm_w) * present).sum() / denom
    return mse + 0.01 * coord, radial.detach()


def evaluate(model, loader, device):
    import torch
    model.eval()
    loss_sum = 0.0
    mre_sum = 0.0
    n = 0
    with torch.no_grad():
        for images, heatmaps, pts in loader:
            images = images.to(device)
            heatmaps = heatmaps.to(device)
            pts = pts.to(device)
            loss, mre = landmark_loss(model(images), heatmaps, pts)
            bs = int(images.size(0))
            loss_sum += float(loss.item()) * bs
            mre_sum += float(mre.item()) * bs
            n += bs
    return {"loss": loss_sum / max(n, 1), "mre": mre_sum / max(n, 1)}


def main(argv=None):
    p = argparse.ArgumentParser(description="Train Banana sidecar ResNet-50 UNet")
    p.add_argument("--dataset", required=True, help="Aariz-layout folder (train/valid/Cephalograms)")
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--sigma", type=float, default=HEATMAP_SIGMA,
                   help="heatmap gaussian std in 256-px units (smaller = sharper peaks)")
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
    train_ds = HeatmapDataset(str(root), "TRAIN", IMAGE_SIZE, sigma=args.sigma)
    loaders = {
        "train": DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=0),
    }
    if (root / "valid" / "Cephalograms").is_dir():
        loaders["valid"] = DataLoader(
            HeatmapDataset(str(root), "VALID", IMAGE_SIZE, sigma=args.sigma),
            batch_size=args.valid_batch, shuffle=False, num_workers=0,
        )

    model = UNetHeatmapModel(pretrained=args.pretrained).to(device)
    opt = torch.optim.Adam((q for q in model.parameters() if q.requires_grad), lr=args.lr)
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
        for images, heatmaps, pts in loaders["train"]:
            images = images.to(device)
            heatmaps = heatmaps.to(device)
            pts = pts.to(device)
            pred = model(images)
            loss, _mre = landmark_loss(pred, heatmaps, pts)
            opt.zero_grad()
            loss.backward()
            opt.step()
            running += float(loss.item()) * images.size(0)
            n += images.size(0)
        train_loss = running / max(n, 1)
        msg = "epoch %s train_loss=%.6f" % (epoch, train_loss)
        score = train_loss
        if "valid" in loaders:
            stats = evaluate(model, loaders["valid"], device)
            score = stats["mre"]
            msg += " valid_loss=%.6f valid_mre=%.3fpx" % (stats["loss"], stats["mre"])
        print(msg)
        if score <= best:
            best = score
            torch.save(model.state_dict(), str(out))
            print("wrote", out, "(best valid radial error)" if "valid" in loaders else "(best train loss)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
