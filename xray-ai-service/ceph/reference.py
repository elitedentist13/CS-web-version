"""Clinic training traces for lateral ceph (coordinates only).
Kept separate from the read-only 1502 published ISBI + Aariz + PKU shapes.
"""
import json
from pathlib import Path

REF = Path(__file__).resolve().parent / "clinic_reference.json"
MAX_TRACES = 400
IDS = [
    "S", "N", "Or", "Po", "A", "B", "Pog", "Me", "Gn", "Go",
    "L1", "U1", "Ls", "Li", "Sn", "PogS", "PNS", "ANS", "Ar",
]


def load():
    empty = {"v": 1, "kind": "banana.ceph.clinicTrain", "traces": []}
    if not REF.exists():
        return empty
    try:
        data = json.loads(REF.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty
    if not isinstance(data, dict) or not isinstance(data.get("traces"), list):
        return empty
    data["kind"] = "banana.ceph.clinicTrain"
    return data


def stats(db=None):
    db = db if db is not None else load()
    traces = db.get("traces") or []
    points = 0
    for t in traces:
        inc = t.get("included") or []
        points += len(inc)
    return {"films": len(traces), "points": points}


def add(trace):
    if not isinstance(trace, dict) or not trace.get("id"):
        raise ValueError("trace needs an id")
    p = trace.get("p")
    if not isinstance(p, list) or len(p) != 38:
        raise ValueError("trace.p must be 38 bbox-normalized values (nulls allowed)")
    included = [i for i in (trace.get("included") or []) if i in IDS]
    if not included:
        raise ValueError("tick at least one ISBI landmark")
    db = load()
    rec = {
        "id": str(trace["id"])[:80],
        "ts": str(trace.get("ts") or ""),
        "fileName": str(trace.get("fileName") or "")[:180],
        "patientNo": str(trace.get("patientNo") or "")[:32],
        "included": included,
        "a": float(trace.get("a") or 1.0),
        "p": p,
        "clinic": True,
        "whole": True,
        "kind": "banana.ceph.clinicTrain",
    }
    db["kind"] = "banana.ceph.clinicTrain"
    existing = {t.get("id") for t in db["traces"]}
    if rec["id"] not in existing:
        db["traces"].append(rec)
        if len(db["traces"]) > MAX_TRACES:
            db["traces"] = db["traces"][-MAX_TRACES:]
        REF.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")
    st = stats(db)
    st["ok"] = True
    st["id"] = rec["id"]
    st["included"] = included
    return st
