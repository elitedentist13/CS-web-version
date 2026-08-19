# Joyful Smile / Banana X-Ray Bridge — installer package

This folder holds the **local X-ray bridge**: a small background helper
that lets the Banana web app (running in a normal browser) open desktop
imaging software — **NNT-NEWTOM**, **EzDent-i (Vatech)**, **Carestream CS
Imaging**, or **Ai-Dental** — with the current patient's chart no., name,
DOB and gender already sent across, instead of a doctor/assistant
re-typing everything by hand.

## Two ways to deploy it

**Most clinic PCs only ever need one imaging system.** For that case, use
one of the two dedicated, single-system packages instead of anything in
this top-level folder — each is a fully self-contained folder/zip that can
be copied to a different PC without dragging any other system's files or
branding along, and each is restricted **at runtime** to its own system
(not just by which files happen to be present), so there is no risk of
mixing them up even if someone later copies the wrong folder to the wrong
PC:

| Package | Use for |
|---|---|
| [`installer-ezdenti/`](installer-ezdenti/README.md) (`Banana-EzDenti-Bridge-Installer.zip`) | Any PC that only needs **EzDent-i (Vatech)**. |
| [`installer-nntnewtom/`](installer-nntnewtom/README.md) (`Banana-NNT-Bridge-Installer.zip`) | Any PC that only needs **NNT-NEWTOM**. |

Each has its own install path (`C:\BananaBridge-EzDenti` vs. `C:\NNT`), its
own startup-shortcut name, and its own README with system-specific
troubleshooting. Don't install both packages on the same PC — Banana
always talks to a bridge on the same port (17890), so only one can run on
a given PC at a time.

Only use **this** top-level folder's `install-xray-bridge.ps1` /
`Install X-Ray Bridge.bat` directly if a specific PC genuinely needs
**more than one** imaging system's bridge running together (e.g. a
multi-purpose PC with both NNT and EzDent-i installed) — it covers every
system in one process, same as it always has.

Both dedicated packages and this top-level copy share the exact same
underlying engine (`xray-local-launcher.ps1`); `build-installer-packages.ps1`
is what keeps the two subfolders in sync with it and rebuilds their zips —
run that after editing `xray-local-launcher.ps1` or `install-xray-bridge.ps1`
here, rather than hand-editing the copies inside `installer-ezdenti/` or
`installer-nntnewtom/`.

## The combined (multi-system) bridge in this folder

It installs identically on any clinic PC, whether that PC is:

- the **"server side"** machine sitting next to the actual scanner (e.g. a
  CBCT/NewTom machine, or an EzDent-i workstation next to the Vatech OPG
  unit) — used to open/fill in a new patient just before taking a scan, or
- a **"client side"** consultation-room PC — used to browse a patient's
  *existing* x-rays/OPG/CT that were already taken elsewhere.

The bridge code is identical either way. Only what the imaging software
itself does with the opened patient (create new vs. open existing) is the
imaging software's own business logic, driven by whether that chart number
already exists in *its* database.

## What's in this folder

| File | Purpose |
|---|---|
| `xray-local-launcher.ps1` | The bridge itself. Listens on `http://127.0.0.1:17890` for requests from the browser and launches the right desktop program. |
| `install-xray-bridge.ps1` | Installer/uninstaller: copies the files below to `C:\NNT` (default — the name is historical, it hosts the bridge for *every* system, not just NNT), self-tests them, and sets up auto-start at login. |
| `_nnt_identity_guard.ps1` | Companion script (NNT only): pops a warning if NNT opens a different patient than the one Banana asked for. |
| `_nnt_new_opg_watcher.ps1` | Companion script (NNT only): watches for a newly-saved OPG/CT and offers to upload it back into Banana. |
| `Install X-Ray Bridge.bat` | Double-click wrapper for `install-xray-bridge.ps1`. |
| `Start X-Ray Launcher.bat` | Double-click wrapper to run the bridge in the foreground (for manual testing — the installer sets up automatic background start, so you normally won't need this). |
| `Test X-Ray Launcher.bat` | Double-click wrapper for `-SelfTest` (77+ automated checks, nothing is launched or written outside a temp folder). |
| `Uninstall X-Ray Bridge.bat` | Double-click wrapper to remove the auto-start shortcut and stop the bridge. |
| `installer-ezdenti/`, `installer-nntnewtom/` | The two dedicated single-system packages described above — each deployable on its own. |
| `build-installer-packages.ps1` | Syncs `xray-local-launcher.ps1` / `install-xray-bridge.ps1` into the two subfolders above and rebuilds their zips. Run after editing either canonical file. |
| `CHANGELOG.md` | Full development history and investigation notes — useful background if you're extending this, not needed to just deploy it. |

Files starting with `_` other than the two NNT companions above (e.g.
`_watch_vdds_import.ps1`, `_census-*.py`) are one-off investigation/tracing
tools used while reverse-engineering these integrations. They are **not**
needed to deploy the bridge and don't have to be copied to a clinic PC.

## Deploying to a new PC

1. Copy this whole `tools` folder onto the target PC (USB stick, shared
   drive, whatever's convenient) — `install-xray-bridge.ps1` looks for its
   sibling files (`xray-local-launcher.ps1`, the two `_nnt_*.ps1`
   companions) next to itself, so copy the folder, not a single file.
2. Double-click **`Test X-Ray Launcher.bat`** first. It should print
   `SELF-TEST PASSED: NN / NN checks` with no failures — this only proves
   the scripts themselves aren't broken; it doesn't touch or launch any
   real imaging software.
3. Double-click **`Install X-Ray Bridge.bat`**. Click **Yes** if Windows
   asks for Administrator — that lets the bridge auto-start for *every*
   Windows account on the PC, not just the one you're logged in as. This:
   - copies the bridge + companions to `C:\NNT`,
   - self-tests every copied file again,
   - adds a startup shortcut so it starts automatically (minimized) at
     every login,
   - starts it immediately too, so it's live right away.
4. In Banana, open a patient → **Consultation → X-ray** tab, and click the
   button for whichever imaging software is actually installed on that PC
   (e.g. "EzDent-i (Vatech)" or "NNT-NEWTOM"). It should open with the
   patient's details already sent across.
5. Leave it be — it re-starts itself on every login from then on. To move
   it to a different PC or reinstall after a code update, just re-run step
   3 (safe to re-run any time; every step is idempotent).

To remove it from a PC, double-click **`Uninstall X-Ray Bridge.bat`**.

## What's confirmed vs. best-effort, per system

- **NNT-NEWTOM**: confirmed against a live capture of Clinic Solution's own
  handoff (see `CHANGELOG.md`, "Decoded CS's -VDDS PATDATIMPORT sync file
  format"). `NNTBridge.exe /PATID ... /NAME ... /DATEB ... /SEX ...` opens
  the matching chart, or NNT's own new-patient screen pre-filled, if it
  doesn't exist yet.
- **EzDent-i (Vatech)**: confirmed live (2026-08-19) that this reliably
  **opens EzDent-i itself** (`VTE2Loader32.exe` → the real `VTE232.exe`
  window) and copies the patient's name + chart no. to the clipboard, so
  staff can paste it straight into EzDent-i's own patient search — same
  fallback already used for Carestream/Ai-Dental below. It *also*
  best-effort writes a `Linkage.xml` file and fires `VTEzBridge32.exe`
  first, on the chance that some component on this specific deployment
  (there are hints it may be a server-side "EzPicker" service rather than
  anything on the client PC — see `CHANGELOG.md`) picks it up and
  auto-opens/creates the chart with zero typing. That last part is
  **not guaranteed** — treat the clipboard paste as the reliable path
  until/unless Vatech support confirms the exact mechanism for a given
  clinic's EzWebServer setup.
- **Carestream / Ai-Dental**: no known command-line/file bridge exists for
  either. The button opens the desktop shortcut and copies the patient's
  name + chart no. to the clipboard for manual search inside the app.

## Troubleshooting

- **Button says "Could not start ... from the browser"**: the bridge isn't
  running on that PC. Re-run `Start X-Ray Launcher.bat` (or re-run the
  installer) and try again.
- **Wrong patient opens in NNT**: `_nnt_identity_guard.ps1` should already
  warn about this — if it doesn't, confirm it was actually copied
  alongside `xray-local-launcher.ps1` into `C:\NNT` (the installer warns at
  the end if it wasn't found next to itself when you ran the installer).
- **Port 17890 already in use**: the installer refuses to start a second
  listener on top of an unrelated program. Close whatever else is using
  that port, or re-run with `-Port <number>` and update
  `XRAY_LAUNCHER_PORT` near the top of `app-xray.js` to match.
