"""Build Banana ceph mean-shape catalogs from public landmark dumps.

Sources (coordinates only — no radiographs are written into the repo):
  - Hugging Face YongchengYAO/Ceph-Biometrics-400 Landmarks.zip
    (ISBI 2015 400_senior, 400 films × 19 points)
  - GitHub mariam-bebawy/SBME_CV_CephalometricLandmarks data_csv
    (ISBI 2015 senior train + Test1, 300 films × 19 points)

Aariz / CEPHA29 (1000 × 29) is documented but shipped as a 2 GB image zip;
only the 19 shared ISBI names would be used if a landmarks-only dump appears.
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import os
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp-ceph-import"
OUT_CAT = ROOT / "ceph" / "data" / "isbi2015.json"
OUT_SHAPES = ROOT / "ceph" / "data" / "shapes.json"

IDS = ["S", "N", "Or", "Po", "A", "B", "Pog", "Me", "Gn", "Go",
       "L1", "U1", "Ls", "Li", "Sn", "PogS", "PNS", "ANS", "Ar"]
NAMES = {
    "S": "Sella", "N": "Nasion", "Or": "Orbitale", "Po": "Porion",
    "A": "A-point (Subspinale)", "B": "B-point (Supramentale)",
    "Pog": "Pogonion", "Me": "Menton", "Gn": "Gnathion", "Go": "Gonion",
    "L1": "Incision inferius", "U1": "Incision superius",
    "Ls": "Upper lip", "Li": "Lower lip", "Sn": "Subnasale",
    "PogS": "Soft-tissue pogonion", "PNS": "Posterior nasal spine",
    "ANS": "Anterior nasal spine", "Ar": "Articulare",
}
P_TO_ID = {f"P{i}": IDS[i - 1] for i in range(1, 20)}
ISBI_W, ISBI_H = 1935.0, 2400.0


def parse_csv(path: Path) -> dict[str, dict[str, tuple[float, float]]]:
    out = {}
    with path.open(encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            name = (row.get("image_path") or "").strip()
            if not name:
                continue
            stem = Path(name).stem
            pts = {}
            ok = True
            for i, lid in enumerate(IDS, start=1):
                try:
                    x = float(row[f"{i}_x"])
                    y = float(row[f"{i}_y"])
                except (KeyError, ValueError):
                    ok = False
                    break
                pts[lid] = (x, y)
            if ok:
                out[stem] = pts
    return out


def parse_hf(folder: Path) -> dict[str, dict[str, tuple[float, float, float]]]:
    out = {}
    for fp in sorted(folder.glob("*.json.gz")):
        with gzip.open(fp, "rt", encoding="utf-8") as f:
            j = json.load(f)
        sl = (j.get("slice_landmarks_x") or [None])[0]
        if not sl:
            continue
        raw = sl.get("landmarks") or {}
        pts = {}
        for p, lid in P_TO_ID.items():
            xyz = raw.get(p)
            if not xyz or len(xyz) < 3:
                continue
            pts[lid] = (float(xyz[0]), float(xyz[1]), float(xyz[2]))
        if len(pts) == 19:
            out[fp.name.split(".")[0]] = pts
    return out


def convert_hf(xyz: tuple[float, float, float], mode: str) -> tuple[float, float]:
    _s, a, b = xyz
    if mode == "a_x_b_y":
        return a, b
    if mode == "a_x_flip_b":
        return a, ISBI_H - 1.0 - b
    if mode == "b_x_a_y":
        return b, a
    if mode == "b_x_flip_a":
        return b, ISBI_H - 1.0 - a
    raise ValueError(mode)


def rmse(a: dict, b: dict) -> float:
    keys = [k for k in IDS if k in a and k in b]
    if not keys:
        return 1e9
    return math.sqrt(sum((a[k][0] - b[k][0]) ** 2 + (a[k][1] - b[k][1]) ** 2 for k in keys) / len(keys))


def bbox_norm(pts: dict[str, tuple[float, float]], pad: float = 0.06):
    xs = [p[0] for p in pts.values()]
    ys = [p[1] for p in pts.values()]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    bw = max(1.0, maxx - minx)
    bh = max(1.0, maxy - miny)
    x0 = minx - bw * pad
    y0 = miny - bh * pad
    w = bw * (1 + 2 * pad)
    h = bh * (1 + 2 * pad)
    n = {k: ((p[0] - x0) / w, (p[1] - y0) / h) for k, p in pts.items()}
    return n, (x0, y0, w, h)


def mean_std(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    m = statistics.fmean(values)
    s = statistics.pstdev(values) if len(values) > 1 else 0.0
    return m, s


def sna(pts: dict[str, tuple[float, float]]) -> float | None:
    S, N, A = pts.get("S"), pts.get("N"), pts.get("A")
    if not (S and N and A):
        return None

    def ang(a, b, c):
        v1x, v1y = a[0] - b[0], a[1] - b[1]
        v2x, v2y = c[0] - b[0], c[1] - b[1]
        n1 = math.hypot(v1x, v1y)
        n2 = math.hypot(v2x, v2y)
        if not n1 or not n2:
            return None
        cos = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / (n1 * n2)))
        return math.degrees(math.acos(cos))

    return ang(S, N, A)


def main() -> None:
    hf_dir = TMP / "hf-landmarks" / "Landmarks"
    csv_train = parse_csv(TMP / "train_senior.csv")
    csv_test1 = parse_csv(TMP / "test1_senior.csv")
    github = {**csv_train, **csv_test1}
    hf = parse_hf(hf_dir)
    print(f"GitHub CSVs: {len(github)}  HF: {len(hf)}")

    modes = ["a_x_b_y", "a_x_flip_b", "b_x_a_y", "b_x_flip_a"]
    best_mode, best_err, n_ov = None, 1e9, 0
    overlap = sorted(set(github) & set(hf))
    for mode in modes:
        errs = []
        for stem in overlap:
            conv = {k: convert_hf(hf[stem][k], mode) for k in IDS}
            errs.append(rmse(conv, github[stem]))
        err = statistics.fmean(errs) if errs else 1e9
        print(f"  align {mode}: n={len(errs)} RMSE={err:.2f}px")
        if err < best_err:
            best_mode, best_err, n_ov = mode, err, len(errs)
    print(f"chosen HF transform: {best_mode}  RMSE={best_err:.2f}px on {n_ov} overlapping films")

    films: dict[str, dict] = {}
    for stem, raw in hf.items():
        pts = {k: convert_hf(raw[k], best_mode) for k in IDS}
        films[f"isbi-{stem}"] = {"src": "isbi2015-hf-senior", "w": ISBI_W, "h": ISBI_H, "pts": pts}
    for stem, pts in github.items():
        key = f"isbi-{stem}"
        if key not in films:
            films[key] = {"src": "isbi2015-github-senior", "w": ISBI_W, "h": ISBI_H, "pts": pts}

    # Image-normalized and landmark-bbox-normalized stats.
    img_xs = {k: [] for k in IDS}
    img_ys = {k: [] for k in IDS}
    box_xs = {k: [] for k in IDS}
    box_ys = {k: [] for k in IDS}
    aspects = []
    snas = []
    shapes = []
    for rec in films.values():
        pts = rec["pts"]
        w, h = rec["w"], rec["h"]
        bn, box = bbox_norm(pts)
        aspects.append(box[2] / box[3])
        s = sna(pts)
        if s is not None:
            snas.append(s)
        row = []
        for k in IDS:
            img_xs[k].append(pts[k][0] / w)
            img_ys[k].append(pts[k][1] / h)
            box_xs[k].append(bn[k][0])
            box_ys[k].append(bn[k][1])
            row.extend([round(bn[k][0], 4), round(bn[k][1], 4)])
        shapes.append({"a": round(box[2] / box[3], 4), "p": row})

    landmarks = []
    for i, k in enumerate(IDS, start=1):
        nx, sx = mean_std(box_xs[k])
        ny, sy = mean_std(box_ys[k])
        ix, isx = mean_std(img_xs[k])
        iy, isy = mean_std(img_ys[k])
        landmarks.append({
            "id": k,
            "i": i,
            "name": NAMES[k],
            "nx": round(nx, 4),
            "ny": round(ny, 4),
            "sx": round(sx, 4),
            "sy": round(sy, 4),
            "ix": round(ix, 4),
            "iy": round(iy, 4),
            "isx": round(isx, 4),
            "isy": round(isy, 4),
        })

    catalog = {
        "id": "isbi2015",
        "name": "ISBI 2015 Automatic Cephalometric Landmark Detection",
        "citation": "Wang et al., IEEE ISBI 2015 Grand Challenge. 400 lateral cephalograms, 19 landmarks, 0.1 mm/pixel, 1935×2400. Senior coordinates via Hugging Face YongchengYAO/Ceph-Biometrics-400 and GitHub mariam-bebawy/SBME_CV_CephalometricLandmarks.",
        "images": 400,
        "importedFilms": len(films),
        "train": 150,
        "test1": 150,
        "test2": 100,
        "mmPerPx": 0.1,
        "nativeWidth": 1935,
        "nativeHeight": 2400,
        "meanSna": round(statistics.fmean(snas), 2) if snas else None,
        "meanBoxAspect": round(statistics.fmean(aspects), 4) if aspects else None,
        "bboxPad": 0.06,
        "hfAlign": {"mode": best_mode, "rmsePx": round(best_err, 3), "overlap": n_ov},
        "sources": {
            "challenge": "http://www-o.ntust.edu.tw/~cweiwang/ISBI2015/challenge1/",
            "figshare": "https://figshare.com/s/37ec464af8e81ae6ebbf",
            "huggingface": "https://huggingface.co/datasets/YongchengYAO/Ceph-Biometrics-400",
            "githubCsv": "https://github.com/mariam-bebawy/SBME_CV_CephalometricLandmarks/tree/main/data_csv",
            "cepha29": "https://github.com/manwaarkhd/CEPHA29",
            "aariz": "https://github.com/manwaarkhd/aariz-cephalometric-dataset",
            "cephtrace": "https://github.com/sidwiz/cephtrace-research",
        },
        "landmarks": landmarks,
    }
    OUT_CAT.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    OUT_SHAPES.write_text(json.dumps({
        "id": "isbi2015-bbox-shapes",
        "ids": IDS,
        "n": len(shapes),
        "pad": 0.06,
        "note": "Each shape.p is 19 (nx,ny) pairs, landmark-bbox normalized with 6% pad. shape.a is the original landmark-box aspect. No images.",
        "shapes": shapes,
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT_CAT}  films={len(films)}  mean SNA={catalog['meanSna']}")
    print(f"wrote {OUT_SHAPES}  bytes={OUT_SHAPES.stat().st_size}")
    print("bbox mean nx,ny:")
    for d in landmarks:
        print(f"  {d['id']:4}  {d['nx']:.3f},{d['ny']:.3f}  img {d['ix']:.3f},{d['iy']:.3f}")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
