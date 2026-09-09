"""Uvicorn entry that applies 2026-09-09 extras, then the original main:app."""
from xray_ai_extras_boot_20260909 import apply

apply()

from main import app  # noqa: E402, F401
