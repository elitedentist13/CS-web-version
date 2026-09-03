# Banana X-Ray Bridge — Apixia Digirex only

Self-contained installer for **just** Apixia Digirex (periapical / bitewing
PSP). Copy this whole folder to a PC that only needs Digirex.

**Po Lam (EzDent-i already installed) and Kwun Tong (MyRay already
installed): do not run this installer.** Those PCs already have a bridge
listening on port 17890. After their existing bridge auto-updates (or you
re-run their own installer so it picks up the new `xray-local-launcher.ps1`),
Digirex is served as a **sidecar** on that same process — `/open/digirex`
works without a second listener and without touching EzDent-i or MyRay.

Only use this folder on a PC that has Digirex and does **not** already
run another Banana X-ray bridge.

## What it does

1. Writes the documented Apixia `Switch.ini` next to `digirex.exe`
   (`[Patient]` ID / name / DOB / gender + `[Dentist]` username `apixia`
   / password `digirex`), then launches Digirex so it opens the matching
   chart or creates a new one. Banana doctor tags are never sent as the
   Digirex login (that caused "Wrong Username or password").
2. Strips Banana's clinic letter prefix (`PL001287` → `001287`, also
   `MK…` / `KT…`) so OLD Digirex records match. If the local `DATA`
   folder has a zero-stripped folder (`1287`), that id is preferred.
3. Writes `Switch.ini` using this PC's own ANSI code page (Big5/950 on
   HK-locale Windows), not UTF-8, so the Traditional Chinese chart name
   (`Last=`) displays correctly in Digirex instead of as garbled text or a
   blank field. See `xray-launcher-config.example.ps1` if a specific PC's
   Digirex build needs a different code page (`$script:DigirexIniEncoding`).
4. Auto-detects `digirex.exe` from desktop shortcuts, Program Files,
   `DIGIREX_HOME`, and Windows uninstall registry keys (future version /
   relocated installs).
5. Auto-starts at Windows login (same Startup-shortcut pattern as
   EzDent-i / MyRay). Registers the existing auto-update scheduled task
   so later `xray-local-launcher.ps1` fixes land without a manual copy.

## Install on the next PC

Confirmed live (2026-08-31): Digirex logs in as **username `apixia` / password `digirex`**. That is baked into this package — no extra config step.

1. Copy **`Banana-Digirex-Bridge-Installer.zip`** (or this whole folder) onto the PC.
2. Extract it, then double-click **`Test Digirex Launcher.bat`**. Expect `SELF-TEST PASSED`.
3. Double-click **`Install Digirex Bridge.bat`**. Click **Yes** if Windows asks for Administrator.
4. In Banana: patient → **Consultation → X-ray** → **Digirex (Apixia)**.

If this PC **already** runs the EzDent-i or MyRay bridge on port 17890, **stop** — do not run this installer. Copy the matching updated package instead (`Banana-EzDenti-Bridge-Installer.zip` or the MyRay folder) and re-run **that** Install bat. Digirex is then a sidecar on the same process.

To remove: double-click **`Uninstall Digirex Bridge.bat`**.

## Do not mix installers on one PC

Banana always talks to `http://127.0.0.1:17890`. Installing this
package **and** `installer-ezdenti` / `installer-myray` on the same
machine will fight over that port. Use one bridge process:

| PC | Use |
|---|---|
| PL consultation (EzDent-i + Digirex) | Keep **EzDent-i** installer; update its launcher. Digirex is a sidecar. |
| KT consultation (MyRay + Digirex) | Keep **MyRay** installer; update its launcher. Digirex is a sidecar. |
| Digirex-only PC | This folder. |

## Troubleshooting

- **Traditional Chinese chart name shows as garbled text / mojibake / a
  blank field in Digirex**: fixed 2026-09-03 -- `Switch.ini` was being
  written as UTF-8, but Digirex's own INI reader has no Unicode awareness
  and reads it back using the PC's ANSI code page (Big5 on this clinic's
  Windows installs), corrupting multi-byte characters. Re-run this
  installer (or wait for the next auto-update cycle) to pick up the fix --
  no config changes needed on a standard HK-locale PC.
