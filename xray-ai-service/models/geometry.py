"""
Shared geometry helpers.

Boxes are dicts with absolute pixel coordinates:
    {"x": left, "y": top, "w": width, "h": height}

The client expects normalized 0..1 coordinates, so normalization happens once
in pipeline.py when the response is composed.
"""


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def box_center(box):
    return (box["x"] + box["w"] / 2.0, box["y"] + box["h"] / 2.0)


def box_area(box):
    return max(0.0, box["w"]) * max(0.0, box["h"])


def intersection_area(a, b):
    ix1 = max(a["x"], b["x"])
    iy1 = max(a["y"], b["y"])
    ix2 = min(a["x"] + a["w"], b["x"] + b["w"])
    iy2 = min(a["y"] + a["h"], b["y"] + b["h"])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    return (ix2 - ix1) * (iy2 - iy1)


def iou(a, b):
    inter = intersection_area(a, b)
    if inter <= 0:
        return 0.0
    union = box_area(a) + box_area(b) - inter
    return inter / union if union > 0 else 0.0


def point_in_box(x, y, box):
    """True when point (x, y) lies inside the axis-aligned box."""
    if not box:
        return False
    return (
        box["x"] <= x <= box["x"] + box["w"]
        and box["y"] <= y <= box["y"] + box["h"]
    )


def containment(inner, outer):
    """Fraction of `inner` that lies inside `outer`."""
    area = box_area(inner)
    if area <= 0:
        return 0.0
    return intersection_area(inner, outer) / area


def nms(items, thresh=0.45):
    """Greedy non-maximum suppression over items carrying 'box' and 'score'."""
    ordered = sorted(items, key=lambda d: d.get("score", 0.0), reverse=True)
    kept = []
    for item in ordered:
        if any(iou(item["box"], k["box"]) > thresh for k in kept):
            continue
        kept.append(item)
    return kept


def find_enclosing_tooth(box, teeth):
    """Tooth whose box best contains the given detection box."""
    best = None
    best_score = 0.0
    for tooth in teeth:
        score = containment(box, tooth["box"])
        if score > best_score:
            best_score = score
            best = tooth
    if best is not None and best_score >= 0.15:
        return best
    # Fall back to nearest centre, so a lesion sitting on a tooth edge still
    # gets anatomical context.
    cx, cy = box_center(box)
    nearest = None
    nearest_dist = None
    for tooth in teeth:
        tx, ty = box_center(tooth["box"])
        dist = (tx - cx) ** 2 + (ty - cy) ** 2
        if nearest_dist is None or dist < nearest_dist:
            nearest_dist = dist
            nearest = tooth
    return nearest


def polygon_from_box(box, inset=0.0):
    """Rectangular polygon, optionally inset by a fraction of each dimension."""
    dx = box["w"] * inset
    dy = box["h"] * inset
    x1 = box["x"] + dx
    y1 = box["y"] + dy
    x2 = box["x"] + box["w"] - dx
    y2 = box["y"] + box["h"] - dy
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def normalize_point(pt, width, height):
    return [clamp(pt[0] / width), clamp(pt[1] / height)]


def normalize_polygon(poly, width, height):
    return [normalize_point(p, width, height) for p in poly]


def normalize_box(box, width, height):
    x = clamp(box["x"] / width)
    y = clamp(box["y"] / height)
    w = clamp(box["w"] / width, 0.0, 1.0 - x)
    h = clamp(box["h"] / height, 0.0, 1.0 - y)
    return {
        "x": round(x, 5),
        "y": round(y, 5),
        "w": round(max(w, 0.004), 5),
        "h": round(max(h, 0.004), 5),
    }


def crown_edge_sign(arch):
    """
    Direction from crown toward root apex, in image y.

    On a panoramic radiograph the occlusal plane runs through the middle:
    upper teeth have crowns low (larger y) and apices high (smaller y), lower
    teeth are the reverse. Returns -1 when the apex is above the crown.
    """
    return -1 if arch == "upper" else 1


def crown_edge_y(tooth, arch):
    """Image y of the occlusal/incisal edge of the tooth."""
    box = tooth["box"]
    return box["y"] + box["h"] if arch == "upper" else box["y"]


def apex_y(tooth, arch):
    """Image y of the root apex."""
    box = tooth["box"]
    return box["y"] if arch == "upper" else box["y"] + box["h"]
