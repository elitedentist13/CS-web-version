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
    _check_crop()
    _check_dataset_frame()
    print("ok banana unet clone", len(isbi), "extra", sorted(extra.keys()),
          "home", st["home"], "status", st["available"])


def _check_dataset_frame():
    # ISBI mean box sits inside the film, not on the edges.
    minx, miny, maxx, maxy = infer.dataset_landmark_frame()
    assert 0.25 < minx < 0.40, minx
    assert 0.35 < miny < 0.48, miny
    assert 0.75 < maxx < 0.90, maxx
    assert 0.80 < maxy < 0.92, maxy
    # A 800×900 skull at (400, 500) is placed on that frame; the crop origin can be off the film.
    box = (400.0, 500.0, 800.0, 900.0)
    crop = infer.dataset_crop(box, 2000, 2250)
    assert crop is not None
    crop_x, crop_y, crop_w, crop_h = crop
    assert abs((400.0 - crop_x) / crop_w - minx) < 1e-6
    assert abs((500.0 - crop_y) / crop_h - miny) < 1e-6
    assert abs(800.0 / crop_w - (maxx - minx)) < 1e-6
    assert abs(900.0 / crop_h - (maxy - miny)) < 1e-6
    # Menton in the collar does not enlarge the box used for that resize.
    skull = {
        "S": {"x": 662, "y": 507}, "N": {"x": 1253, "y": 376}, "Or": {"x": 1142, "y": 682},
        "Po": {"x": 459, "y": 713}, "A": {"x": 1269, "y": 994}, "B": {"x": 1227, "y": 1409},
        "Pog": {"x": 1166, "y": 1459}, "Me": {"x": 1183, "y": 1622}, "Gn": {"x": 1156, "y": 1483},
        "Go": {"x": 624, "y": 1318}, "L1": {"x": 1209, "y": 1289}, "U1": {"x": 1234, "y": 1297},
        "Ls": {"x": 1288, "y": 1244}, "Li": {"x": 1272, "y": 1358}, "Sn": {"x": 1255, "y": 1174},
        "PogS": {"x": 1216, "y": 1484}, "PNS": {"x": 955, "y": 1136}, "ANS": {"x": 1200, "y": 1144},
        "Ar": {"x": 499, "y": 773},
    }
    tight = infer.patient_landmark_box(skull)
    skull["Me"] = {"x": 30, "y": 2200}
    far = infer.patient_landmark_box(skull)
    assert tight and far
    assert far[3] < tight[3] * 1.15, (tight, far)
    assert far[1] + far[3] < 1900, far


def _check_crop():
    # A fifth of a 2000×2250 film, centred, stays on the plate.
    x0, y0, x1, y1 = infer.crop_box(1000, 1125, 2000, 2250)
    assert x1 - x0 == 400, (x0, x1)
    assert y1 - y0 == 450, (y0, y1)
    assert x0 == 800 and y0 == 900, (x0, y0)
    # A peak a few pixels off the coarse point is kept; a jump to the far edge is not.
    assert infer.accept_refined(210, 230, 1000, 1125, 800, 900, 400, 450)
    assert not infer.accept_refined(10, 10, 1000, 1125, 800, 900, 400, 450)
    # A point on the left border shifts the window onto the film.
    bx0, by0, bx1, by1 = infer.crop_box(10, 1125, 2000, 2250)
    assert bx0 == 0 and bx1 - bx0 == 400, (bx0, bx1, by0, by1)


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
