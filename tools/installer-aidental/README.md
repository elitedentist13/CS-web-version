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
   launches `Ai-Dental.exe` with the patient's **name** already pre-filled
   — no re-typing that. Chart no., sex, and DOB are **not** carried by this
   launch (confirmed — see "What's confirmed vs. best-effort" below); type
   those in by hand from the clipboard, which always gets the full details.

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
Ai-Dental.exe "001287.KWAN MING.HSIUNG"
```

- One dot-joined token, **`PatNum.<given name>.<surname>`**. Open Dental's
  own documented "Ai-Dental Bridge" page
  (opendental.com/site/bridgeaidental.html) calls this
  `[PatNum].[LName].[FName]` (i.e. surname 2nd, given name 3rd) — but a
  **live, logged-in test against this exact install on 2026-09-03 found
  the opposite**: whichever value is 2nd lands in the on-screen "Name\*"
  field and whichever is 3rd lands in "SurName". So this bridge sends the
  given name 2nd and the surname 3rd, matching what those field labels
  actually mean rather than what Open Dental's page calls them. See
  "What's confirmed vs. best-effort" below for the exact test.
- **`PatNum`** — Banana's `patient_no` with any clinic letter prefix
  stripped (e.g. `MK001287` → `001287`), same helper (`Convert-NntPatientId`,
  wrapped as `Convert-AiDentalPatientId`) used by every other bridge here.
  **Confirmed this token is parsed but then discarded on create** — see
  below — so prefix-stripping only matters if/when a future Ai-Dental
  update starts using it as a real match key; it does no harm either way.
- **Given name / surname** — Banana only stores one free-text name field.
  Split the same way as Rayscan (`Split-RayPatientName` /
  `Split-AiDentalPatientName`): the clinic's English names are
  surname-first (HK/Cantonese romanization), so the first word is treated
  as the surname and everything after it as the given name. There is no
  separate slot for the Chinese name in this contract (Open Dental itself
  has none either).
- Any literal `.` inside a name or chart number is stripped first — the
  period is the field separator in this format, with no documented escape
  syntax.
- **Only the name is sent.** Chart no., sex, and DOB are confirmed *not*
  deliverable through this launch mechanism at all (see below) — they are
  only ever sent via the clipboard fallback for staff to type in by hand.

`Ai-Dental.exe` is resolved from (in order): the `Ai-Dental-Client.lnk`
desktop shortcut's own target folder, or the hardcoded fallback
`C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe` (confirmed live to be
Public Desktop → `C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe`, no
arguments on the shortcut itself — same "shortcut carries no args, caller
builds them fresh" pattern as NNTBridge/RAYBridge).

## What's confirmed vs. best-effort

This clinic's own PC really does have Ai-Dental-Client installed, so a
real, live investigation was possible — first on 2026-09-03 without a
login (couldn't see the result of a launch), then again on 2026-09-03
with a full logged-in session, which resolved every open question below
except the DICOM Worklist path.

**Confirmed live (logged-in test, 2026-09-03):**
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
- Launching `Ai-Dental.exe "<PatNum>.<token2>.<token3>"` **does** open the
  app and create/select a patient with `token2`/`token3` pre-filled into
  the on-screen "Name\*"/"SurName" fields respectively — confirmed with two
  clean tests using distinct dummy values in each slot
  (`777777.FIRSTVALUE.LASTVALUE` → Name\*=`FIRSTVALUE`,
  SurName=`LASTVALUE`). This is the **opposite** field order from what
  Open Dental's docs call `[LName].[FName]` — fixed in
  `New-AiDentalArgument` to send `<given>.<surname>` instead so "SurName"
  actually holds the surname.
- **Chart no., sex, and DOB are confirmed NOT to transfer, ever, through
  this launch, no matter the argument format.** Across both tests, the
  on-screen "Chart No." field (a real field — confirmed present via the
  app's own "More Detail" view) stayed completely blank, and
  "Gender\*"/"Birthday\*" always showed this build's hardcoded new-patient
  defaults (Male / 1 Jan 2000), never anything derived from `PatNum` or
  the launch. An ASCII string scan of `Ai-Dental.exe` found the actual
  internal route this argument reaches — a local dispatch table entry
  `/patient/cmdline` (`service.cpp`) — and it is a genuinely narrower
  handler than the app's own "Add Patient" form's `/patient/add` route
  (which does have `idCard`/`gender`/`birthday` fields): `/patient/cmdline`
  only extracts what becomes Name\*/SurName. `PatNum` is read (the launch
  behaves differently with vs. without it) but never surfaces anywhere in
  the UI, consistent with Open Dental's own model where `PatNum` is *its*
  internal patient number, meaningless as a lookup key for any other
  system's chart numbers.
- No listening port and no auto-start entry was found for Ai-Dental on
  this PC at idle — nothing here for this bridge (port 17890) to conflict
  with.

**Still not confirmed:**
- The bundled English user manual (`Documents\WP_UserManual_EN.CHM`)
  documents a **different**, native PMS-connection mechanism:
  **DICOM Modality Worklist** (Setting → DICOM Setting → WORKLIST — a
  configurable IP/PORT/AETitle, default AETitle `WOODPECKERPACS`). Unlike
  the CLI argument, DICOM MWL's standard attributes *do* include
  PatientID, PatientSex, and PatientBirthDate — this would be the only way
  to auto-fill those fields — but it's a proper DICOM C-FIND server, a
  fundamentally bigger integration than this CLI trick (this bridge would
  need to become a DICOM SCP), and it was **not** implemented here. It
  would also require changing Ai-Dental's own DICOM settings on every PC,
  unlike the CLI approach, which needs zero changes to Ai-Dental itself.

Given the confirmed hard limit on chart no./sex/DOB, this bridge's value is
name-only auto-fill plus a complete clipboard fallback (chart no., Chinese
name, English name, DOB, sex, HKID, phone) for everything else — genuinely
useful (no re-typing the name, which is the most error-prone field to
copy by hand), but staff should expect to type the rest in manually every
time, not just when something goes wrong.

## Troubleshooting

- **"Could not start Ai-Dental from the browser"**: the bridge isn't
  running. Re-run `Start Ai-Dental Launcher.bat` (or re-run the installer).
- **Chart no., sex, or DOB don't show up in Ai-Dental**: this is expected,
  not a bug — see "What's confirmed vs. best-effort" above. Paste them in
  from the clipboard (always copied alongside every launch).
- **Ai-Dental opens but shows the wrong patient**: click the Banana
  button again to re-send; if it still doesn't match, use the clipboard
  fallback (Ctrl+V into Ai-Dental's own search) instead.
- **Names come out in the wrong order**: this clinic's English names are
  surname-first; if a different clinic's names are given-name-first,
  `Split-AiDentalPatientName` in `xray-local-launcher.ps1` will need its
  token order swapped (same fix as `Split-RayPatientName`).
- **Port 17890 in use by something else**: close it, or re-run
  `install-xray-bridge.ps1 -EnabledSystems "aidental" -Port <number>`
  directly and update `XRAY_LAUNCHER_PORT` near the top of `app-xray.js`
  in Banana to match.

Full development history / investigation notes: `..\CHANGELOG.md`.
