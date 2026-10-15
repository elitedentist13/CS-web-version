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
   auto-start at login, starts the bridge, and registers `csxray://` for
   this Windows account. Re-run this once on a PC that was installed
   before that protocol existed.
4. In Banana: patient → **Consultation → X-ray** tab → **EzDent-i
   (Vatech)** for OPG/CT. Chrome asks once to open CS X-ray; choose Open.
   Digirex (Apixia) for periapical/bitewing uses the same `csxray://`
   path (login `apixia` / `digirex`). Film lists in the page still use
   port 17890.

To remove: double-click **`Uninstall EzDent-i Bridge.bat`**.
Safe to re-run the installer any time (e.g. after a code update).

## What's confirmed vs. best-effort

- **Confirmed (2026-08-19, live test):** the button reliably opens EzDent-i
  itself and copies the patient's name + chart no. to the clipboard —
  paste that into EzDent-i's own patient search to open or create the
  chart for OPG/CT.
- **Chart number matching (2026-08-24):** Banana's `patient_no` can carry
  a clinic letter prefix (Po Lam uses `PL`, e.g. `PL001287`). OLD EzDent-i
  charts are keyed on the bare digits (`001287`). The bridge strips any
  letter prefix before copying the chart no. to the clipboard, same as
  NNT `/PATID` and Rayscan `ID:`. Bare numbers (`001287`) are unchanged.
- **Chart + Acquisition fix (2026-10-16):** Banana writes Open Dental-style
  `Linkage.xml`, then launches the desktop **ReqAdmin** shortcut when the
  file is in real Program Files Bin (needed for the Vatech OPG device).
  It does **not** start `VTEzBridge32.exe`. If Bin is not writable,
  Linkage under VirtualStore uses the non-ReqAdmin loader (chart OK,
  Acquisition may be limited). Opt out of linkage with
  `$script:EzdentiSkipLinkageXml = $true`. Opt into VTEzBridge (view-only)
  with `$script:EzdentiUseLinkageBridge = $true` in `xray-launcher-config.ps1`.

## Capture a working desktop session (for Banana wiring)

When Acquisition works from the desktop icon but Banana opens the wrong
chart (or the recent acquisition list), run a background observer while
you click through EzDent-i manually:

1. Double-click **`Watch EzDent-i Session.bat`** in this folder (or
   `..\Watch EzDent-i Session.bat`).
2. Fully quit EzDent-i, then open it from the **desktop icon** (not Banana).
3. Search → open the patient chart → Acquisition → Panorama → take OPG.
4. Press Ctrl+C in the watcher window when finished.
5. Send the new folder under `..\_ezdenti_session_captures\` (especially
   `session.log` and any `Linkage.xml` / `.ini` copies).

Script: `..\_watch_ezdenti_session.ps1` (process command lines + Bin /
VirtualStore file copies; never modifies EzDent originals).

## Troubleshooting

- **Acquisition → Panorama does nothing after opening from Banana, but
  works from the desktop icon**: re-run **Install EzDent-i Bridge.bat**
  (or copy the updated `xray-local-launcher.ps1` and restart the bridge).
  Fully quit EzDent-i first. Do **not** set `EzdentiUseLinkageBridge` on
  a PC that takes OPGs (that fires `VTEzBridge32.exe`).
- **Banana shows recent chart (e.g. 022194) instead of 021474**: ensure
  the new default path is deployed (`mode=ezdenti-linkage-xml` on
  `/open/ezdenti`). Fully quit EzDent-i, then open again from Banana.
- **"Could not start EzDent-i from the browser"**: the bridge isn't
  running. Re-run `Start EzDent-i Launcher.bat` (or re-run the installer).
- **Port 17890 in use by something else**: close it, or re-run
  `install-xray-bridge.ps1 -EnabledSystems "ezdenti" -Port <number>`
  directly and update `XRAY_LAUNCHER_PORT` near the top of `app-xray.js`
  in Banana to match.

Full development history / investigation notes: `..\CHANGELOG.md`.
