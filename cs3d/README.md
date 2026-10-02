# Banana Dicom Reader (Cornerstone3D sidecar)

Independent of the OHIF CBCT window. Banana only opens `/cs3d/` and starts X-ray Helper; this page loads a zip/folder, shows a volume with three planes, and draws its own measures. Save-back is still Helper (share **this** window).

1. Consultation → X-ray → **Banana Dicom Reader** (patient must be open).
2. Banana opens `/cs3d/` and hops to `/cs3d/local` with `history.replaceState` (GitHub Pages–safe, same idea as `/ohif/`).
3. Use **Load zip** / **Load folder** / **Load files** (or drop). A `.zip` is unpacked here.
4. X-ray Helper starts in Banana — share **this** window (not a Chrome tab) and snip a view back to the chart.

`BANANA_CS3D_BASE` stays the `/cs3d` folder even on `/cs3d/local`. First paint is always `/cs3d/` (a real file).

Build the Cornerstone3D vendor bundle (git + node; install happens next to the repo, not inside `node_modules` of Banana):

```
node scripts/build-cs3d-sidecar.js
```

OHIF stays at `/ohif/` and is not rebuilt or rewritten by this script.
