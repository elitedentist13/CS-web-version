CS X-ray Assist — extras 2026-09-09
===================================

Additive pack for today's lightbox / Assist edits. The installer copies these
NEXT TO existing clinic files. It does not replace:

  - xray-ai-service\*.py already on the PC
  - style.css / app-xray.js / app-xray-ai.js / index.html bodies
  - trained weights, venv, or model_cache

What gets added
---------------
web\
  style-xray-ai-20260909.css   maximize toolbar stacking, crop-apply vs restore,
                               Assist prompt in front of max view, 3x loupe chrome
  app-xray-ai-20260909.js      "I understand" clickable in max view; skip EDJ line

service\
  boot + extras uvicorn entry  load overlay modules at process start
  modules\                     today's service edits (decay emphasis, no EDJ overlay)

Installed to (never overwrites a file that is already there)
------------------------------------------------------------
  <clinic>\xray-ai-extras\2026-09-09\     full payload copy
  <clinic>\style-xray-ai-20260909.css
  <clinic>\app-xray-ai-20260909.js
  <clinic>\xray-ai-service\xray_ai_extras_boot_20260909.py
  <clinic>\xray-ai-service\xray_ai_extras_main_20260909.py

index.html and start-xray-ai.bat are patched in place only if the extra
hooks are missing. A one-time backup is written first:

  index.html.bak-xray-ai-20260909
  start-xray-ai.bat.bak-xray-ai-20260909
