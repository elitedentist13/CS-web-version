# Banana X-Ray Bridge — NNT/NewTom + MyRay (CEFLA)

Self-contained installer for the **CEFLA** stack: **NNT/NewTom and MyRay**
share one bridge on port **17890** (`-EnabledSystems nntnewtom,myray`).
They do not fight each other. Copy this whole folder to any PC used to
open NNT or MyRay — scanner PC or consultation room.

It will not answer for EzDent-i, Carestream, Rayscan, or Ai-Dental.
Do **not** also install those packages as exclusive rivals on the same
PC (they'd fight over port 17890). MyRay support lives in this same
CEFLA bridge — see also `..\installer-myray\` (same install path `C:\NNT`).

## What's in this folder (and why it's more than just the engine + installer)

Unlike the EzDent-i package, this one also ships two **CEFLA companion
scripts** that `xray-local-launcher.ps1` looks for as siblings at runtime:

| File | Purpose |
|---|---|
| `_nnt_identity_guard.ps1` | Warns if NNT/MyRay opens a different patient than the one Banana asked for (NNT's own DB isn't always in sync). |
| `_nnt_new_opg_watcher.ps1` | Watches for a newly-saved OPG/CT in NNT and offers to upload it back into Banana. |

If either is missing from this folder when you copy it, the installer
will still work, but that specific safety/upload feature silently won't
run on that PC — keep both files alongside `xray-local-launcher.ps1` and
`install-xray-bridge.ps1` when copying.

## Install

1. Copy this folder onto the target PC.
2. Double-click **`Test NNT-NEWTOM Launcher.bat`** — should print
   `SELF-TEST PASSED` with no failures (side-effect-free; doesn't touch or
   launch NNT itself).
3. Double-click **`Install NNT-NEWTOM Bridge.bat`**. Click **Yes** if
   Windows asks for Administrator. Installs to `C:\NNT`, self-tests the
   companion scripts too, sets up auto-start at login, and starts the
   bridge immediately.
4. In Banana: patient → **Consultation → X-ray** tab → **NNT-NEWTOM**. It
   should open NNT with `/PATID`, `/NAME`, `/SURNAME`, `/DATEB`, `/SEX`
   already filled in — no manual typing.

To remove: double-click **`Uninstall NNT-NEWTOM Bridge.bat`**.
Safe to re-run the installer any time (e.g. after a code update — an
already-running bridge is automatically restarted to pick up the new
code).

## Confirmed working

This is the one bridge here confirmed end-to-end against a live capture of
Clinic Solution's own handoff to NNT (see `..\CHANGELOG.md`, "Decoded CS's
`-VDDS PATDATIMPORT` sync file format" and "`/DIR` fix, confirmed correct
by tracing CS's own launch").

## Troubleshooting

- **"Could not start NNT from the browser"**: the bridge isn't running.
  Re-run `Start NNT-NEWTOM Launcher.bat` (or re-run the installer).
- **Wrong patient opens in NNT**: confirm `_nnt_identity_guard.ps1` was
  actually copied alongside the other files — the installer warns at the
  end if it wasn't found when you ran it.
- **Port 17890 in use by something else**: close it, or re-run
  `install-xray-bridge.ps1 -EnabledSystems "nntnewtom,myray" -Port <number>`
  directly and update `XRAY_LAUNCHER_PORT` near the top of `app-xray.js`
  in Banana to match.

Full development history / investigation notes: `..\CHANGELOG.md`.

## Auto-check / auto-update

After install, Windows Task Scheduler runs:

`Joyful Smile NNT-NEWTOM Bridge - Auto Update`

- First run ~3 minutes after install, then every **6 hours** while logged in
- Fetches from `https://elitedentist13.github.io/CS-web-version/tools/installer-nntnewtom/`
- Safe apply: temp download → parse → `-SelfTest` → backup → restart → `/status`; rollback on failure
- Log: `C:\NNT\xray-bridge-update.log`
- State: `C:\NNT\xray-bridge-update-state.json`

Manual check: **`Check NNT-NEWTOM Updates.bat`** (same channel as `installer-myray` CEFLA install).
