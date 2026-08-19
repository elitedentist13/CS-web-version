"""Extract a CS/NNT panoramic OPG for one patient and upload it into
Banana's Supabase `xrays` bucket + table, via the same anon-key REST
contract the web app itself uses (see app.js SB client + app-xray.js
uploadSingleXrayFile).

Two source cases per chart folder under \\RECEPTION\IMAGE\SCAN\{chart}\:
  1. Plain top-level JPEG already classified as a real panoramic by
     _classify-cs-scan-jpegs.py (aspect >= 1.62, grayscale/color, not A4).
     -> uploaded as-is.
  2. NNT-proprietary study only: {chart}\Document\...\2D Images collection\
     *.2dh + *.pan_<guid> raw 16-bit buffers (no plain JPEG anywhere).
     -> the primary *.pan_<guid> (SUB_IMG_INDEX=0 in the doc's own
        .last_scenario cache when present, else the file whose GUID
        matches the FIRST one referenced in that cache; falls back to the
        first *.pan_ file found if no cache exists) is decoded:
          width x height determined by matching declared byte length in
          the CNNTImg header against IMG_WIDTH_MICRON/IMG_HEIGHT_MICRON in
          .last_scenario at 10 px/mm; verified for chart 002505 as
          2114x1150, 16-bit little-endian, needs a vertical-only flip to
          read right-side-up (confirmed against the "NewTom"/side-marker
          watermark baked into the pixels).
        Windowed to 8-bit, then CLAHE + a mild unsharp pass (see
        decode_pan_to_jpeg_bytes) to approximate NNT's own display
        rendering, saved as JPEG quality 92. This is only an
        approximation of NNT's real (proprietary, unknown) rendering --
        for patients where quality matters, prefer
        _bulk_upload_nnt_exports.py fed with a real NNT
        Print/Export/Save-as-image output instead of this decoder.

Usage:
    python _import_cs_opg.py <CHART_NO> [--dry-run]

Requires SUPABASE_URL / SUPABASE_ANON_KEY as used by app.js, and a
Supabase `patients` row with patient_no matching CHART_NO (with or
without the clinic's patient_no_prefix).
"""
from __future__ import annotations

import argparse
import datetime
import json
import mimetypes
import os
import random
import re
import struct
import sys
import urllib.error
import urllib.request

import cv2
import numpy as np
from PIL import Image, ImageFilter

SCAN_ROOT = r"\\RECEPTION\IMAGE\SCAN"
SUPABASE_URL = "https://kprihawipljrltfzpfjd.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
XRAY_BUCKET = "xrays"
JPEG_EXT = {".jpg", ".jpeg", ".jpe"}


def sb_get(path_and_query: str):
    req = urllib.request.Request(
        SUPABASE_URL + path_and_query,
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + SUPABASE_ANON_KEY},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def sb_storage_upload(path: str, data: bytes, content_type: str):
    url = f"{SUPABASE_URL}/storage/v1/object/{XRAY_BUCKET}/{path}"
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": content_type,
            "x-upsert": "false",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"storage upload failed [{e.code}]: {body}")


def sb_table_insert(table: str, row: dict):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    body = json.dumps([row]).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"table insert failed [{e.code}]: {err_body}")


def find_patient(chart_no: str):
    digits = re.sub(r"\D", "", chart_no).zfill(6)
    q = f"/rest/v1/patients?select=id,patient_no,full_name&or=(patient_no.eq.{digits},patient_no.eq.PY{digits})"
    rows = sb_get(q)
    if not rows:
        return None
    return rows[0]


# --- .pan_ raw buffer decode (validated against chart 002505) -------------

def jpeg_header(path: str):
    try:
        with open(path, "rb") as f:
            if f.read(2) != b"\xff\xd8":
                return None
            while True:
                marker = f.read(2)
                if len(marker) < 2 or marker[0] != 0xFF:
                    return None
                mt = marker[1]
                if mt in (0xD8, 0xD9) or mt == 0x01 or 0xD0 <= mt <= 0xD7:
                    continue
                seglen = f.read(2)
                if len(seglen) < 2:
                    return None
                length = int.from_bytes(seglen, "big")
                if length < 2:
                    return None
                if mt in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    data = f.read(length - 2)
                    if len(data) < 6:
                        return None
                    h = int.from_bytes(data[1:3], "big")
                    w = int.from_bytes(data[3:5], "big")
                    nf = data[5]
                    return w, h, nf
                f.seek(length - 2, os.SEEK_CUR)
    except OSError:
        return None


def is_a4(w, h):
    a, b = sorted((w, h))
    return (1600 <= a <= 1750 and 2250 <= b <= 2450) or (2400 <= a <= 2550 and 3400 <= b <= 3600)


def find_toplevel_pano_jpeg(chart_folder: str):
    """Case 1: a plain top-level JPEG that geometry-classifies as a real pano."""
    try:
        entries = list(os.scandir(chart_folder))
    except OSError:
        return None
    best = None
    for ent in entries:
        if not ent.is_file():
            continue
        if os.path.splitext(ent.name)[1].lower() not in JPEG_EXT:
            continue
        hdr = jpeg_header(ent.path)
        if not hdr:
            continue
        w, h, nf = hdr
        if w <= 0 or h <= 0 or is_a4(w, h):
            continue
        aspect = w / float(h)
        if aspect >= 1.62 and w >= 700:
            if best is None or ent.stat().st_mtime > best[1]:
                best = (ent.path, ent.stat().st_mtime)
    return best[0] if best else None


def find_2dh_and_pans(chart_folder: str):
    doc = os.path.join(chart_folder, "Document")
    if not os.path.isdir(doc):
        return None
    hit_2dh = None
    for root, dirs, files in os.walk(doc):
        for fn in files:
            if fn.lower().endswith(".2dh"):
                hit_2dh = os.path.join(root, fn)
                break
        if hit_2dh:
            break
    if not hit_2dh:
        return None
    folder = os.path.dirname(hit_2dh)
    base = os.path.splitext(os.path.basename(hit_2dh))[0]
    pans = [
        os.path.join(folder, fn)
        for fn in os.listdir(folder)
        if fn.startswith(base + ".pan_")
    ]
    scenario = os.path.join(folder, base + ".last_scenario")
    return hit_2dh, pans, (scenario if os.path.isfile(scenario) else None)


def pick_primary_pan(pans: list, scenario_path: str | None):
    if scenario_path:
        try:
            with open(scenario_path, "rb") as f:
                buf = f.read()
            text = buf.decode("utf-16-le", errors="ignore")
            m = re.search(r"IMAGE_GUID\s*=\s*\{([0-9A-Fa-f-]{36})\}", text)
            if m:
                guid = m.group(1).upper().replace("-", "")
                for p in pans:
                    fname_guid = re.sub(r"[^0-9A-Fa-f]", "", os.path.basename(p).split(".pan_", 1)[1]).upper()
                    # filenames double every GUID nibble with a literal
                    # "02" separator (mangled encoding) -- match on the
                    # first 8 hex chars, which survive untouched.
                    if fname_guid[:8] == guid[:8]:
                        return p
        except OSError:
            pass
    return sorted(pans)[0] if pans else None


def read_cnntimg_header(buf: bytes):
    off = 4  # FF FF 11 00
    name_len = struct.unpack_from("<H", buf, off)[0]
    off += 2
    off += name_len
    off += 4  # 07 00 00 00
    data_len = struct.unpack_from("<I", buf, off)[0]
    off += 4
    return off, data_len


def img_dims_from_scenario(scenario_path: str | None, pixel_count: int):
    if scenario_path:
        try:
            with open(scenario_path, "rb") as f:
                buf = f.read()
            text = buf.decode("utf-16-le", errors="ignore")
            mw = re.search(r"IMG_WIDTH_MICRON\s*=\s*(\d+)", text)
            mh = re.search(r"IMG_HEIGHT_MICRON\s*=\s*(\d+)", text)
            if mw and mh:
                w_um, h_um = int(mw.group(1)), int(mh.group(1))
                for px_per_mm in (10, 8, 12, 6, 4):
                    w = round(w_um / 1000 * px_per_mm)
                    h = round(h_um / 1000 * px_per_mm)
                    if w * h == pixel_count:
                        return w, h
        except OSError:
            pass
    # Fallback: brute-force factor pairs in a plausible pano range.
    for w in range(700, 4000):
        if pixel_count % w == 0:
            h = pixel_count // w
            if 300 <= h <= 4000 and 1.3 <= (max(w, h) / min(w, h)) <= 3.5:
                if w > h:
                    return w, h
    return None


def decode_pan_to_jpeg_bytes(pan_path: str, scenario_path: str | None) -> bytes:
    with open(pan_path, "rb") as f:
        buf = f.read()
    off, data_len = read_cnntimg_header(buf)
    pixel_bytes = buf[off:off + data_len]
    pixels = np.frombuffer(pixel_bytes, dtype="<u2")
    dims = img_dims_from_scenario(scenario_path, pixels.size)
    if not dims:
        raise RuntimeError(f"could not determine image dimensions for {pan_path}")
    w, h = dims
    img = pixels.reshape(h, w)
    img = img[::-1, :]  # vertical flip -- confirmed correct orientation

    # Plain global percentile stretch looks visibly softer/flatter than
    # NNT/CS's own display (compared side-by-side on chart 002505 -- no
    # bone trabecular texture, no crisp tooth-root edges). NNT's rendering
    # is proprietary and not fully reproducible, but CLAHE (local adaptive
    # contrast) + a mild unsharp pass gets close to the same read: local
    # detail is pulled out per-tile instead of one global window, then a
    # light sharpen recovers edge crispness. Parameters tuned by eye
    # against the CS-exported copy for chart 002505.
    lo, hi = np.percentile(img, [0.5, 99.5])
    if hi <= lo:
        hi = lo + 1
    norm = np.clip((img.astype(np.float32) - lo) / (hi - lo), 0, 1)
    out8 = (norm * 255).astype(np.uint8)

    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(24, 24))
    eq = clahe.apply(out8)
    pil = Image.fromarray(eq, mode="L").filter(
        ImageFilter.UnsharpMask(radius=1.5, percent=200, threshold=2)
    )
    import io
    buf_out = io.BytesIO()
    pil.save(buf_out, format="JPEG", quality=92)
    return buf_out.getvalue()


def extract_opg(chart_no: str):
    """Returns (jpeg_bytes, source_description, taken_date_iso) or raises."""
    chart_folder = os.path.join(SCAN_ROOT, chart_no)
    if not os.path.isdir(chart_folder):
        raise RuntimeError(f"no SCAN folder for chart {chart_no}: {chart_folder}")

    top = find_toplevel_pano_jpeg(chart_folder)
    if top:
        with open(top, "rb") as f:
            data = f.read()
        mtime = os.path.getmtime(top)
        taken = datetime.datetime.fromtimestamp(mtime).date().isoformat()
        return data, f"top-level JPEG: {top}", taken

    found = find_2dh_and_pans(chart_folder)
    if not found:
        raise RuntimeError(f"no top-level pano JPEG and no NNT 2D study found for chart {chart_no}")
    doc_2dh, pans, scenario = found
    if not pans:
        raise RuntimeError(f"found .2dh {doc_2dh} but no .pan_ files alongside it")
    primary = pick_primary_pan(pans, scenario)
    data = decode_pan_to_jpeg_bytes(primary, scenario)
    mtime = os.path.getmtime(primary)
    taken = datetime.datetime.fromtimestamp(mtime).date().isoformat()
    return data, f"NNT proprietary study: {primary}", taken


def upload_opg(patient: dict, jpeg_bytes: bytes, taken_date: str, notes: str, dry_run: bool):
    patient_id = patient["id"]
    patient_no = patient["patient_no"]
    patient_name = patient["full_name"]

    ts = int(datetime.datetime.now().timestamp() * 1000)
    rand = "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(11))
    storage_path = f"{patient_id}/{ts}_{rand}.jpg"

    print(f"  storage path: {storage_path}")
    print(f"  bytes: {len(jpeg_bytes)}")
    if dry_run:
        print("  DRY RUN -- not uploading")
        return

    sb_storage_upload(storage_path, jpeg_bytes, "image/jpeg")
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{XRAY_BUCKET}/{storage_path}"

    row = {
        "patient_id": patient_id,
        "patient_no": patient_no,
        "patient_name": patient_name,
        "file_path": storage_path,
        "file_url": public_url,
        "file_name": os.path.basename(storage_path),
        "file_size": len(jpeg_bytes),
        "xray_type": "Panoramic",
        "taken_date": taken_date,
        "notes": notes,
        "uploaded_by": "CS import script",
    }
    result = sb_table_insert("xrays", row)
    print("  inserted xrays row:", json.dumps(result, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("chart_no")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    patient = find_patient(args.chart_no)
    if not patient:
        print(f"No Supabase patient found for chart {args.chart_no}")
        sys.exit(1)
    print(f"patient: {patient['patient_no']}  {patient['full_name']}  id={patient['id']}")

    jpeg_bytes, source, taken_date = extract_opg(args.chart_no)
    print(f"source: {source}")
    print(f"taken_date: {taken_date}")

    upload_opg(
        patient,
        jpeg_bytes,
        taken_date,
        notes=f"Imported from CS ({source})",
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
