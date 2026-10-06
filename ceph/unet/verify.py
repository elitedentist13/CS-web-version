"""Lightweight Banana UNet checks (mapping + package home; weights optional)."""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import infer
from config import AARIZ_SYMBOLS, ISBI_FROM_AARIZ, NUM_LANDMARKS
from dataset import render_heatmaps


def main():
    assert NUM_LANDMARKS == 29
    assert len(AARIZ_SYMBOLS) == 29
    assert len(ISBI_FROM_AARIZ) == 19
    coords = [(10.0 + i, 20.0 + i * 2) for i in range(29)]
    isbi, extra = infer.map_aariz_xy(coords)
    assert isbi["A"]["x"] == 10.0
    assert isbi["L1"]["x"] == coords[17][0]
    assert isbi["U1"]["x"] == coords[21][0]
    assert isbi["PogS"]["x"] == coords[27][0]
    assert extra["U1a"]["x"] == coords[20][0]
    assert extra["L1a"]["x"] == coords[23][0]
    assert extra["Pn"]["x"] == coords[8][0]
    assert len(isbi) == 19
    assert infer.points_sane({
        "S": {"x": 400, "y": 400}, "N": {"x": 900, "y": 350},
        "Or": {"x": 800, "y": 420}, "Po": {"x": 380, "y": 450},
        "A": {"x": 920, "y": 700}, "B": {"x": 880, "y": 900},
        "Pog": {"x": 870, "y": 980}, "Me": {"x": 850, "y": 1050},
        "Gn": {"x": 860, "y": 1020}, "Go": {"x": 420, "y": 950},
        "L1": {"x": 900, "y": 850}, "U1": {"x": 910, "y": 800},
        "Ls": {"x": 940, "y": 780}, "Li": {"x": 930, "y": 860},
        "Sn": {"x": 930, "y": 720}, "PogS": {"x": 890, "y": 1000},
        "PNS": {"x": 520, "y": 680}, "ANS": {"x": 900, "y": 680},
        "Ar": {"x": 390, "y": 520},
    }, 2000, 2250)
    assert not infer.points_sane({"S": {"x": 1, "y": 1}}, 100, 100)
    st = infer.status()
    assert st["source"] == "dental_001"
    assert st["home"] == "ceph/unet"
    assert st["owned"] == "banana"
    assert st["model"] == "resnet50-unet-heatmap-29"
    assert st["decode"] == "local-soft-argmax"
    _check_subpixel()
    _check_fractional_heatmap()
    print("ok banana unet clone", len(isbi), "extra", sorted(extra.keys()),
          "home", st["home"], "status", st["available"])


def _check_fractional_heatmap():
    # Label between pixels must peak on that fraction, not on the floor cell.
    hm = render_heatmaps([(20.8, 40.3)], (64, 64), (64, 64), sigma=1.5)
    assert hm.shape == (1, 64, 64)
    flat = hm[0].reshape(-1)
    idx = int(flat.argmax())
    py, px = divmod(idx, 64)
    assert abs(px - 20.8) < 0.6, px
    assert abs(py - 40.3) < 0.6, py


def _check_subpixel():
    try:
        import torch
    except ImportError:
        print("skip subpixel (no torch)")
        return
    h = w = 64
    cy, cx = 20.35, 11.7
    yy = torch.arange(h).float()[:, None]
    xx = torch.arange(w).float()[None, :]
    sigma = 1.5
    g = torch.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma * sigma))
    heatmaps = g.view(1, 1, h, w)
    coords = infer._coords_from_heatmaps(heatmaps, w, h)
    assert abs(coords[0][0] - cx) < 0.2, coords
    assert abs(coords[0][1] - cy) < 0.2, coords
    spike = torch.zeros(1, 1, h, w)
    spike[0, 0, 15, 8] = 1
    coords = infer._coords_from_heatmaps(spike, w, h)
    assert abs(coords[0][0] - 8) < 1e-3, coords
    assert abs(coords[0][1] - 15) < 1e-3, coords
    # Original-image scale: heatmap 256, film 1935×2400, peak at heatmap (10, 20).
    film = torch.zeros(1, 1, 32, 32)
    film[0, 0, 20, 10] = 1
    coords = infer._coords_from_heatmaps(film, 1935, 2400)
    assert abs(coords[0][0] - 10 * (1935 / 32.0)) < 0.05, coords
    assert abs(coords[0][1] - 20 * (2400 / 32.0)) < 0.05, coords


if __name__ == "__main__":
    main()
