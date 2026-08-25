"""
Radiograph modality classification (panoramic / bitewing / periapical).

This is a lightweight geometric prior, not a trained classifier. It exists so
the pipeline can keep the panoramic FDI detector for panoramics and route
intraoral images to the PA/bitewing tooth segmenter and caries path — without
changing panoramic behaviour.

Rules (measured against common clinic exports):
  * Panoramic: wide aspect (≥ ~1.7), or large wide frames.
  * Bitewing: intraoral and wider than tall (crowns of both arches).
  * Periapical: intraoral and square/portrait (full root length of 1–4 teeth).
"""

from __future__ import annotations


def detect_modality(width, height, gray=None):
    """
    Returns one of: 'panoramic', 'bitewing', 'periapical'.

    `gray` is optional; when present, a cheap brightness-band check can tip
    ambiguous aspect ratios toward bitewing (two horizontal tooth rows).
    """
    w = max(1, int(width))
    h = max(1, int(height))
    ar = w / float(h)

    if ar >= 1.70 or (w >= 1400 and ar >= 1.45):
        return "panoramic"

    # Ambiguous wide-ish frames: look for two bright horizontal bands.
    if 1.05 <= ar < 1.70 and gray is not None and _looks_like_bitewing(gray):
        return "bitewing"

    if ar >= 1.15:
        return "bitewing"
    return "periapical"


def is_intraoral(modality):
    return modality in ("bitewing", "periapical")


def _looks_like_bitewing(gray):
    """True when the upper and lower thirds are both brighter than the middle."""
    import numpy as np

    h = gray.shape[0]
    if h < 40:
        return False
    u = float(np.mean(gray[: h // 3]))
    m = float(np.mean(gray[h // 3 : 2 * h // 3]))
    l = float(np.mean(gray[2 * h // 3 :]))
    # Both arches bright, soft-tissue/contact zone darker between them.
    return u > m + 8 and l > m + 8
