# Banana X-Ray Bridge — EzDent-i (Vatech) only

Self-contained installer for **just** EzDent-i. Copy this whole folder
(not individual files) to any PC used to open EzDent-i — e.g. the
workstation next to the Vatech OPG unit, or a consultation-room PC that
browses existing OPG/CT there — and it will never try to open NNT-NEWTOM,
Carestream, or Ai-Dental, even by accident. That isolation is enforced by
the bridge itself (`-EnabledSystems ezdenti`), not just by which files
happen to be in this folder, so it's safe even if this folder ever ends up
copied onto a PC that also has one of those other programs installed.

If a PC needs **more than one** imaging system's bridge, use the combined
`tools\install-xray-bridge.ps1` (see `..\README.md`) instead of this
folder — don't install both this and `..\installer-nntnewtom\` on the same
PC (they'd fight over the same port, 17890).

**Digirex (Apixia) on the same Po Lam PC:** after this launcher is
updated, `/open/digirex` is served as a sidecar from **this same
process** when `digirex.exe` is on disk. Login is username `apixia` /
password `digirex`. Do not install `installer-digirex` alongside this
package.

## Install

1. Copy this folder onto the target PC.
2. Double-click **`Test EzDent-i Launcher.bat`** — should print
   `SELF-TEST PASSED` with no failures (side-effect-free; doesn't touch or
   launch EzDent-i itself).
3. Double-click **`Install EzDent-i Bridge.bat`**. Click **Yes** if Windows
   asks for Administrator. Installs to `C:\BananaBridge-EzDenti`, sets up
   auto-start at login, and starts the bridge immediately.
4. In Banana: patient → **Consultation → X-ray** tab → **EzDent-i
   (Vatech)** for OPG/CT, or **Digirex (Apixia)** for periapical/bitewing
   (same bridge; Digirex login is `apixia` / `digirex`).

To remove: double-click **`Uninstall EzDent-i Bridge.bat`**.
Safe to re-run the installer any time (e.g. after a code update).

## What's confirmed vs. best-effort

- **Confirmed (2026-08-19, live test):** the button reliably opens EzDent-i
  itself and copies the patient's name + chart no. to the clipboard —
  paste that into EzDent-i's own patient search to open or create the
  chart for OPG/CT.
- **Chart number matching (2026-08-24):** Banana's `patient_no` can carry
  a clinic letter prefix (Po Lam uses `PL`, e.g. `PL001287`). OLD EzDent-i
  charts are keyed on the bare digits (`001287`). The bridge now strips
  any letter prefix before writing `Linkage.xml` `ChartNumber` and before
  copying the chart no. to the clipboard, same as NNT `/PATID` and Rayscan
  `ID:`. Bare numbers (`001287`) are unchanged.
- **Best-effort, not guaranteed:** the bridge also writes a `Linkage.xml`
  file and fires `VTEzBridge32.exe` first, in case this clinic's specific
  EzDent-i/EzWebServer setup picks it up and auto-opens/creates the chart
  with zero typing. Investigation found hints this may actually be a
  server-side ("EzPicker") mechanism rather than anything a client PC can
  fully control — see `..\CHANGELOG.md` for the full trace. Treat the
  clipboard paste as the reliable path until Vatech support confirms
  otherwise for this deployment.

## Troubleshooting

- **"Could not start EzDent-i from the browser"**: the bridge isn't
  running. Re-run `Start EzDent-i Launcher.bat` (or re-run the installer).
- **Port 17890 in use by something else**: close it, or re-run
  `install-xray-bridge.ps1 -EnabledSystems "ezdenti" -Port <number>`
  directly and update `XRAY_LAUNCHER_PORT` near the top of `app-xray.js`
  in Banana to match.

Full development history / investigation notes: `..\CHANGELOG.md`.
