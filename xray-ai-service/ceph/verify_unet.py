"""Lightweight UNet landmark fork checks (no weights required)."""
from ceph import unet
from ceph import detect


def main():
    coords = [(10.0 + i, 20.0 + i * 2) for i in range(29)]
    isbi, extra = unet.map_aariz_xy(coords)
    assert isbi["A"]["x"] == 10.0
    assert isbi["L1"]["x"] == coords[17][0]
    assert isbi["U1"]["x"] == coords[21][0]
    assert isbi["PogS"]["x"] == coords[27][0]
    assert extra["U1a"]["x"] == coords[20][0]
    assert extra["L1a"]["x"] == coords[23][0]
    assert extra["Pn"]["x"] == coords[8][0]
    assert len(isbi) == 19
    assert unet.points_sane({
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
    assert not unet.points_sane({"S": {"x": 1, "y": 1}}, 100, 100)
    st = unet.status()
    assert st["source"] == "dental_001"
    assert st["model"] == "resnet50-unet-heatmap-29"
    mean = detect.detect_landmarks(1000, 2000)
    assert mean["via"] == "mean"
    assert len(mean["landmarks"]) == 19
    print("ok unet map", len(isbi), "extra", sorted(extra.keys()), "status", st["available"])


if __name__ == "__main__":
    main()
