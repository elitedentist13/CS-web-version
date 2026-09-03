# Banana X-Ray Bridge — Ai-Dental (Woodpecker i-Sensor) only

Self-contained installer for **just** Ai-Dental-Client (the imaging hub
bundled with Woodpecker i-Sensor periapical/bitewing small-film sensors).
Copy this whole folder (not individual files) to any consultation-room PC
used to open Ai-Dental, and it will never try to open NNT-NEWTOM, EzDent-i,
Carestream, Rayscan, or Digirex, even by accident. That isolation is
enforced by the bridge itself (`-EnabledSystems aidental`), not just by
which files happen to be in this folder, so it's safe even if this folder
ever ends up copied onto a PC that also has one of those other programs
installed.

If a PC needs **more than one** imaging system's bridge, use the combined
`tools\install-xray-bridge.ps1` (see `..\README.md`) instead of this
folder — don't install both this and `..\installer-ezdenti\` /
`..\installer-rayscan\` / etc. on the same PC (they'd fight over the same
port, 17890). If a PC **already** has one of those dedicated bridges
installed, you do NOT need this folder at all: as long as Ai-Dental-Client
is on disk at its default install path, that PC's existing bridge
automatically serves `/open/aidental` too, as a sidecar — see "Sidecar on
other installs" below.

## Install

1. Copy this folder onto the target PC.
2. Double-click **`Test Ai-Dental Launcher.bat`** — should print
   `SELF-TEST PASSED` with no failures (side-effect-free; doesn't touch or
   launch Ai-Dental-Client itself).
3. Double-click **`Install Ai-Dental Bridge.bat`**. Click **Yes** if
   Windows asks for Administrator. Installs to `C:\BananaBridge-AiDental`,
   sets up auto-start at login, and starts the bridge immediately.
4. In Banana: patient → **Consultation → X-ray** tab → **Ai-Dental**. It
   should launch `Ai-Dental.exe` with the patient's chart number and name
   already on the command line — no re-typing. Full details are also
   copied to the clipboard as a backup, in case the chart doesn't
   auto-open (see "What's confirmed vs. best-effort" below).

To remove: double-click **`Uninstall Ai-Dental Bridge.bat`**.
Safe to re-run the installer any time (e.g. after a code update).

## Sidecar on other installs

Any PC already running one of the other dedicated bridges (EzDent-i, MyRay,
NNT-NEWTOM, Rayscan, Digirex) will automatically also serve
`/open/aidental` the moment Ai-Dental-Client is installed at one of its
known paths (`C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe`,
`C:\Program Files\Ai-Dental\Ai-Dental.exe`, or
`C:\Program Files (x86)\Ai-Dental\Ai-Dental.exe`) — no reinstall, no second
listener on :17890, no change to that installer's own `-EnabledSystems`.
Same additive pattern already used for Digirex on top of EzDent-i/MyRay.
Nothing to do here except make sure Banana's "Ai-Dental" button is enabled
for that clinic.

## How the patient handoff works

Ai-Dental.exe is launched with a single command-line argument:

```
Ai-Dental.exe "001287.HSIUNG.KWAN MING"
```

- One dot-joined token: **`PatNum.LName.FName`** — this is Open Dental's
  own documented "Ai-Dental Bridge" contract
  (opendental.com/site/bridgeaidental.html: "Optional command line
  arguments: Defaults to `[PatNum].[LName].[FName]`"), and its documented
  default install path (`C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe`)
  matches exactly what's already hardcoded in Banana's `XRAY_SYSTEMS.aidental`.
- **`PatNum`** — Banana's `patient_no` with any clinic letter prefix
  stripped (e.g. `MK001287` → `001287`), same helper (`Convert-NntPatientId`,
  wrapped as `Convert-AiDentalPatientId`) used by every other bridge here,
  so OLD Ai-Dental charts (created before Banana's multi-branch prefix
  existed) still match.
- **`LName` / `FName`** — Banana only stores one free-text name field.
  Split the same way as Rayscan (`Split-RayPatientName` /
  `Split-AiDentalPatientName`): the clinic's English names are
  surname-first (HK/Cantonese romanization), so the first word is sent as
  `LName` and everything after it as `FName`. There is no separate slot for
  the Chinese name in this contract (Open Dental itself has none either).
- Any literal `.` inside a name or chart number is stripped first — the
  period is the field separator in this format, with no documented escape
  syntax.
- Only `PatNum`/`LName`/`FName` are sent. Open Dental's page documents this
  as the *entire* default argument string, not a truncated example, so
  nothing beyond it (DOB, sex) is assumed here.

`Ai-Dental.exe` is resolved from (in order): the `Ai-Dental-Client.lnk`
desktop shortcut's own target folder, or the hardcoded fallback
`C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe` (confirmed live to be
Public Desktop → `C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe`, no
arguments on the shortcut itself — same "shortcut carries no args, caller
builds them fresh" pattern as NNTBridge/RAYBridge).

## What's confirmed vs. best-effort

Unlike Rayscan/Digirex, there was no way to fully confirm this contract
against a live, logged-in Ai-Dental session — but this clinic's own PC
really does have Ai-Dental-Client installed, so a real, live investigation
was possible on 2026-09-03:

**Confirmed live:**
- This is genuinely Woodpecker's software (`WOODDCMDLL.dll`, the bundled
  `WP_*.CHM` manuals), installed at exactly the path Open Dental's bridge
  page documents as the default.
- Its own `Config\YPBSetting.ini` points at
  `ip=192.168.50.140, port=8003` — the **same** central imaging-server IP
  this clinic's Rayscan deployment already uses
  (`local_server_config.xml`, `global_ip_address=192.168.50.140`), just a
  different port. Confirms this bridge and Rayscan's never collide, and
  that Ai-Dental doesn't need a listener on this consultation PC itself.
- The desktop shortcut (`C:\Users\Public\Desktop\Ai-Dental-Client.lnk`)
  really does point at `Ai-Dental.exe` with empty arguments.
- Launching `Ai-Dental.exe "001287.HSIUNG.KWAN MING"` starts cleanly on
  this PC — a visible "Ai-Dental" window opens, the process stays
  responsive, no crash or error dialog. Safe to always send.
- No listening port and no auto-start entry was found for Ai-Dental on
  this PC at idle — nothing here for this bridge (port 17890) to conflict
  with.

**Could NOT confirm:**
- Whether the launched instance actually opens/creates chart `001287` —
  the app requires an operator login first, and this environment has no
  login credentials for it. **The next real clinic visit should click the
  Banana "Ai-Dental" button and confirm the right chart opens.**
- The `[PatNum].[LName].[FName]` string contract itself, inside this exact
  build. Both an ASCII and a UTF-16 string scan of the installed
  `Ai-Dental.exe` found no `"PatNum"` or `"OpenDental"` literal text.
  Open Dental publishes this bridge for "Ai-Dental" generically, but this
  specific regional build may not have that exact code path compiled in.
- The bundled English user manual (`Documents\WP_UserManual_EN.CHM`)
  documents a **different**, native PMS-connection mechanism instead:
  **DICOM Modality Worklist** (Setting → DICOM Setting → WORKLIST — a
  configurable IP/PORT/AETitle, default AETitle `WOODPECKERPACS`). That's
  a proper DICOM C-FIND server, a fundamentally bigger integration than
  this CLI trick, and it was **not** implemented here — it would also
  require changing Ai-Dental's own DICOM settings on this PC, unlike this
  approach, which needs zero changes to Ai-Dental itself.

This was still shipped because it's zero-config, purely additive, and
confirmed harmless if the contract turns out to be wrong for this build
(same "pure upside if so, silently ignored if not" posture already used
for EzDent-i's `linkage.xml` — see `..\CHANGELOG.md`). The clipboard
fallback (chart no., Chinese name, English name, DOB, sex, HKID, phone) is
always copied too, so staff can search manually either way.

If a real clinic visit shows the chart truly doesn't auto-open, building a
DICOM Modality Worklist SCP into this bridge is the documented next step —
see `Start-AiDentalBridgePatient` in `xray-local-launcher.ps1` for where
that would replace/supplement the CLI-arg approach.

## Troubleshooting

- **"Could not start Ai-Dental from the browser"**: the bridge isn't
  running. Re-run `Start Ai-Dental Launcher.bat` (or re-run the installer).
- **Ai-Dental opens but shows the wrong patient / a blank screen**: log in
  to Ai-Dental first (it always requires a login), then click the Banana
  button again — the CLI argument may only take effect after login. If it
  still doesn't match, use the clipboard fallback (Ctrl+V into Ai-Dental's
  own search) and see "What's confirmed vs. best-effort" above.
- **Names come out in the wrong order**: this clinic's English names are
  surname-first; if a different clinic's names are given-name-first,
  `Split-AiDentalPatientName` in `xray-local-launcher.ps1` will need its
  token order swapped (same fix as `Split-RayPatientName`).
- **Port 17890 in use by something else**: close it, or re-run
  `install-xray-bridge.ps1 -EnabledSystems "aidental" -Port <number>`
  directly and update `XRAY_LAUNCHER_PORT` near the top of `app-xray.js`
  in Banana to match.

Full development history / investigation notes: `..\CHANGELOG.md`.
