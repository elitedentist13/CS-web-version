"""Lightweight CVM fork checks (no weights required)."""
from ceph import cvm


def main():
    box = cvm.fallback_bbox(2000, 2250, {
        "Po": {"x": 420, "y": 900},
        "Ar": {"x": 380, "y": 980},
        "Go": {"x": 400, "y": 1500},
    })
    assert box[0] < box[2] and box[1] < box[3]
    assert box[2] <= 2000 and box[3] <= 2250
    empty = cvm.fallback_bbox(1000, 1000, None)
    assert empty == [20, 260, 400, 740]
    assert cvm.parse_landmarks('{"Po":{"x":1,"y":2}}')["Po"]["x"] == 1
    st = cvm.status()
    assert st["source"] == "dental_001"
    assert st["stages"] == "CS1-CS6"
    print("ok fallback bbox", box, "status", st["available"])


if __name__ == "__main__":
    main()
