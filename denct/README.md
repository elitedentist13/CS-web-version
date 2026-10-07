# Banana CBCT Viewer (DenCT sidecar)

Local sidecar of [ZoliQua/Dental-CBCT-Viewer](https://github.com/ZoliQua/Dental-CBCT-Viewer) (MIT, DenCT).

Opens from the X-ray tab **CBCT Viewer** button (next to Banana Dicom Reader). Features stay in DenCT: MPR, true-3D, panoramic OPG, implant planning, nerve/sinus safety, bone quality, surface-scan registration, and drill-guide STL. Parsing stays in the browser.

Build:

```
node scripts/build-denct-sidecar.js
```

Uses `../Dental-CBCT-Viewer` or `DENCT_SRC`. A GitHub fork needs `gh auth login` then `gh repo fork ZoliQua/Dental-CBCT-Viewer`.

Share this window in X-ray Helper to save a view to the current patient.
