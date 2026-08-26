# Banana X-Ray Bridge — Rayscan (RAYBridge / SMARTDent V3) only

Self-contained installer for **just** Rayscan. Copy this whole folder
(not individual files) to any PC used to open RAYBridge / SMARTDent V3 —
either the **client-side** consultation-room PC (used to open a patient
and browse existing OPG/CT/Lateral Cephalometric x-rays already taken) or
the **server-side** PC next to the actual OPG/CT scanner — and it will
never try to open NNT-NEWTOM, EzDent-i, Carestream, or Ai-Dental, even by
accident. That isolation is enforced by the bridge itself
(`-EnabledSystems rayscan`), not just by which files happen to be in this
folder, so it's safe even if this folder ever ends up copied onto a PC
that also has one of those other programs installed.

If a PC needs **more than one** imaging system's bridge, use the combined
`tools\install-xray-bridge.ps1` (see `..\README.md`) instead of this
folder — don't install both this and `..\installer-nntnewtom\` /
`..\installer-ezdenti\` on the same PC (they'd fight over the same port,
17890).

## Install

1. Copy this folder onto the target PC.
2. Double-click **`Test Rayscan Launcher.bat`** — should print
   `SELF-TEST PASSED` with no failures (side-effect-free; doesn't touch or
   launch RAYBridge/SMARTDent itself).
3. Double-click **`Install Rayscan Bridge.bat`**. Click **Yes** if Windows
   asks for Administrator. Installs to `C:\BananaBridge-Rayscan`, sets up
   auto-start at login, and starts the bridge immediately.
4. In Banana: patient → **Consultation → X-ray** tab → **Rayscan**. It
   should launch `RAYBridge.exe` with the patient's ID, name, DOB and sex
   already passed on the command line — no re-typing.
5. When an OPG / CT / Lateral Cephalometric scan is taken on the
   server-side PC next to the scanner, click the same Banana **Rayscan**
   button again on the client-side PC to bring the newly captured image up
   in the Rayscan viewer. Rayscan's own client↔server sync (RAYBridge /
   RayView / the "Ray Local Server" Windows service talking to the imaging
   server next to the OPG/CT unit) handles pulling the actual image across
   the network — this bridge only ever needs to launch `RAYBridge.exe`
   locally on whichever PC the browser is open on.

To remove: double-click **`Uninstall Rayscan Bridge.bat`**.
Safe to re-run the installer any time (e.g. after a code update).

## How the patient handoff works

Confirmed live (2026-08-20, real clinic PC, chart `KT005455`) against
`RAYBridge.exe`'s own embedded usage string and this deployment's
`C:\Ray\RAYBridge\SYS\LocalConfig.xml` (`<SelectedFileFormat value="Command" />`,
i.e. this exact form is the one actually in effect, not the alternative
file-based settings the same binary also supports):

```
RAYBridge.exe "ID:KT005455" "LastName:TANG" "FirstName:PUI" "MiddleName:SHEUNG" "BirthDay:1966-09-15" "Sex:F"
```

- **`ID`** — Banana's `patient_no` with any clinic letter prefix stripped
  (e.g. `MK005455` → `005455`), same as NNT's `/PATID`. **Corrected
  2026-08-20** from an earlier assumption of "keep the prefix as-is": a
  real bug report showed OLD OPG records already in Rayscan's own
  database (entered before Banana's multi-branch prefix existed) are keyed
  on the bare chart number, so sending the full prefixed string never
  matched them. See `Convert-RayPatientId` in `xray-local-launcher.ps1`.
- **`LastName` / `FirstName` / `MiddleName`** — Banana only stores one
  free-text name field. The same `PatientInfo.ini` shows
  `Patient Name = TANG^PUI^SHEUNG` (caret-separated, surname first) — this
  clinic's English names follow the HK/Cantonese romanization convention
  of surname-first, matching RAYBridge's Last/First/Middle order. So the
  **first** word of `patient_name` is sent as `LastName`, not the last
  one. If a clinic's names are actually given-name-first, this mapping
  will need updating (see `Split-RayPatientName` in
  `xray-local-launcher.ps1`).
- **`BirthDay`** — ISO `yyyy-MM-dd`, which is exactly what Banana's
  `<input type="date">` already produces (no reformatting needed, unlike
  NNT which wants `dd/MM/yyyy`).
- **`Sex`** — `M` or `F`.

`RAYBridge.exe` is resolved from (in order): the `RAYBridge.lnk` desktop
shortcut's own target folder, or the hardcoded fallback
`C:\Ray\RAYBridge\RAYBridge.exe`.

## Network setup (client PC ↔ server PC next to the scanner)

This deployment's own `local_server_config.xml` files (both
`C:\Ray\RAYBridge\` and `C:\Ray\RayView\`) point
`global_ip_address=192.168.50.140, global_port=9876` — almost certainly
the server PC (e.g. `DESKTOP-CU5IQLC`) sitting next to the OPG/CT unit.
That client↔server sync is entirely Rayscan's own software; **this bridge
never talks across the network itself** — it only ever launches
`RAYBridge.exe` locally on whatever PC the browser is open on. Rayscan's
own local server/watcher services (and `local_server_console.exe`, serving
`local_port=8765` on the client PC) take care of pulling newly-captured
images from the server side once RAYBridge has the right patient open.

## What's confirmed vs. best-effort

- **Confirmed (2026-08-20, live investigation):** the exact `ID:` /
  `LastName:` / `FirstName:` / `MiddleName:` / `BirthDay:` / `Sex:`
  command-line contract, taken from `RAYBridge.exe`'s own embedded usage
  string and cross-checked against this clinic's `LocalConfig.xml` and a
  real `PatientInfo.ini` handoff file.
- **Best-effort:** the surname-first name split (`Split-RayPatientName`)
  assumes HK/Cantonese romanization convention (first word = surname).
  Correct for the clinic this was built against; may need adjusting for a
  clinic that enters English names given-name-first.

## Troubleshooting

- **"Could not start Rayscan from the browser"**: the bridge isn't
  running. Re-run `Start Rayscan Launcher.bat` (or re-run the installer).
- **RAYBridge opens the wrong patient / a blank new-patient screen**:
  double check the clinic's actual name order — if names are entered
  given-name-first rather than surname-first, `Split-RayPatientName` in
  `xray-local-launcher.ps1` will need its token order swapped.
- **Port 17890 in use by something else**: close it, or re-run
  `install-xray-bridge.ps1 -EnabledSystems "rayscan" -Port <number>`
  directly and update `XRAY_LAUNCHER_PORT` near the top of `app-xray.js`
  in Banana to match.
- **New scan doesn't appear after clicking Rayscan again**: that hand-off
  is Rayscan's own client↔server sync (see "Network setup" above), not
  something this bridge controls — confirm the Ray Local Server / RayView
  services are running and can reach the server PC next to the scanner
  (`192.168.50.140:9876` on this deployment).

Full development history / investigation notes: `..\CHANGELOG.md`.
