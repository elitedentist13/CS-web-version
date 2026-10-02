# OHIF sidecar (Banana)

Full [OHIF Viewer](https://github.com/OHIF/Viewers) as a same-origin window.

1. Consultation → X-ray → **CBCT viewer** (patient must be open).
2. Banana opens `/ohif/` and the sidecar lands on OHIF’s **Load files / Load folders** page (`/local`). Drop a DICOM zip or folder.
3. X-ray Helper starts in Banana — share **this** window (not a Chrome tab) and snip a view back to the chart.

`routerBasename` stays the `/ohif` folder even on `/ohif/local` or `/ohif/viewer`. First paint is always `/ohif/` (a real file) so GitHub Pages works; the hop to `/local` is `history.replaceState` only.

Build (git + node; source is cloned next to the repo, not inside it):

```
node scripts/build-ohif-sidecar.js
```

Uses tag `v3.11.1` by default (`OHIF_TAG` / `OHIF_SRC` env to override). After the build, `app-config.js` is replaced with `banana-app-config.js` (`dicomlocal` only).
