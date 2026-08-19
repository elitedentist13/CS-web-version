# Banana X-Ray Bridge — NNT-NEWTOM only

Self-contained installer for **just** NNT-NEWTOM. Copy this whole folder
(not individual files) to any PC used to open NNT — e.g. the machine
attached to the CBCT/NewTom scanner, or a consultation-room PC that
browses a patient's existing x-rays — and it will never try to open
EzDent-i, Carestream, or Ai-Dental, even by accident. That isolation is
enforced by the bridge itself (`-EnabledSystems nntnewtom`), not just by
which files happen to be in this folder, so it's safe even if this folder
ever ends up copied onto a PC that also has one of those other programs
installed.

If a PC needs **more than one** imaging system's bridge, use the combined
`tools\install-xray-bridge.ps1` (see `..\README.md`) instead of this
folder — don't install both this and `..\installer-ezdenti\` on the same
PC (they'd fight over the same port, 17890).

## What's in this folder (and why it's more than just the engine + installer)

Unlike the EzDent-i package, this one also ships two **NNT-only companion
scripts** that `xray-local-launcher.ps1` looks for as siblings at runtime:

| File | Purpose |
|---|---|
| `_nnt_identity_guard.ps1` | Warns if NNT opens a different patient than the one Banana asked for (NNT's own DB isn't always in sync). |
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
  `install-xray-bridge.ps1 -EnabledSystems "nntnewtom" -Port <number>`
  directly and update `XRAY_LAUNCHER_PORT` near the top of `app-xray.js`
  in Banana to match.

Full development history / investigation notes: `..\CHANGELOG.md`.
