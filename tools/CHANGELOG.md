# X-Ray Bridge (NNT/NewTom) — Changelog

Log of fixes/changes to `xray-local-launcher.ps1` and the installer, kept for
future reference since this runs unattended on clinic machines.

## 2026-08-19 — Client NNT 2D scans + Chinese /SURNAME

Consultation-room PCs (this machine, CONSULTRM1) are for **fetching existing
2D x-ray photos** from the NNT SCAN share, not only opening NNT.exe.

**Launcher (`xray-local-launcher.ps1`):**
- `GET /nnt/scans?patient_no=` lists JPEG/PNG/GIF/BMP files in
  `\\RECEPTION\IMAGE\SCAN\{nnt_patid}` (same prefix-strip + optional 6-digit
  pad as `/PATID`). Path-restricted; does not recurse into NNT's proprietary
  Document/RawData tree.
- `GET /nnt/file?patient_no=&name=` serves one of those files to the browser
  (rejects `..` / slash names). Nothing is written to Supabase.
- `Start-NntBridgePatient` now also sends `/SURNAME {chinese_name}`, matching
  the original captured NNTBridge command line (`/SURNAME "熊關明"`).

**Banana:** `app-nnt-scans.js` shows those 2D scans as a strip on the X-ray
tab when a patient is selected. CBCT / `.pan_*` studies still open in NNT
via the NNT / NEWTOM button.

## 2026-08-19 — Reboot test + auto-start fine-tune (All Users Startup)

**Reboot test (CONSULTRM1):** Real Windows restart at 03:12:32. Logged back in as
`consultrm1\smileworks` with no manual click of the installer or launcher.
Bridge auto-started at 03:13:30 (PID 25892, new process — previous PID was
14292) and `http://127.0.0.1:17890/status` answered healthy
(`ok=True`, `nntnewtom_exists=True`) ~58 seconds after boot. Confirmed:
daily restarts do **not** require staff to re-run the installer or click
"Start X-Ray Launcher".

**Caveat that remained after the test:** the Startup shortcut was per-user
only (`%APPDATA%\...\Startup`), so a different Windows account on the same
PC would not get auto-start. All Users Startup (`ProgramData\...\Startup`)
needs Administrator to write.

**Fix:** `install-xray-bridge.ps1` now:
- Prompts for Administrator (UAC) so it can install into All Users Startup
  (covers every Windows account on the PC). If elevation is declined, it
  continues and installs the proven per-user shortcut instead.
- On a successful All Users install, removes any leftover per-user shortcut
  so the same account does not start two copies.
- `-Uninstall` removes both locations.
- `-NoElevate` skips the UAC prompt (used by automated tests).

`xray-local-launcher.ps1` now exits cleanly (no crash) if port 17890 is
already taken, so a double-start from overlapping shortcuts is harmless.

## 2026-08-19 — Fix: existing patients showed no x-rays in NNT ("PATID prefix mismatch")

**Symptom:** For patient WONG SHUM YING (and any patient whose clinic uses a
`patient_no_prefix` in Banana's Program Settings — currently `"PY"`), pressing
the NNT/NewTom button correctly relayed name/DOB/sex/phone into NNT, but NNT
showed a blank/new-patient view with no existing x-rays, even though the
patient already had scanned images on file.

**Root cause:** Banana formats `patient_no` as `prefix + zero-padded digits`
(see `patientNoPrefix()` / `formatPatientNoFromNumber()` in
`app-program-settings.js`), e.g. `PY002505`. NNT's own patient numbering has
no such prefix — confirmed by comparing against the real network share:

- `\\RECEPTION\IMAGE\SCAN\002505` — **exists**, contains her real scanned
  images (`002505_20260505112331.JPG`, etc.)
- `\\RECEPTION\IMAGE\SCAN\PY002505` — does **not** exist

The bridge was sending `/PATID PY002505` to `NNTBridge.exe`, which never
matched anything in NNT, so NNT silently fell back to "new patient" mode:
demographics pre-fill fine (that data comes straight from the command-line
args), but there is no matching record, hence no x-rays.

**Fix:** Added `Convert-NntPatientId` in `xray-local-launcher.ps1`, which
extracts the first run of digits from `patient_no` (regex `\d+`) before it is
used as `/PATID`. This works regardless of what prefix string a clinic has
configured (not hardcoded to `"PY"`), and only applies to the `patient_no`
path — the `patient_id` (UUID) fallback used when `patient_no` is blank is
left untouched, since digit-extraction on a UUID would risk a false-positive
match to an unrelated patient.

Covered by 6 new self-test assertions (`Convert-NntPatientId` section).
Verified end-to-end on CONSULTRM1 using WONG SHUM YING's real data: bridge now
sends `/PATID 002505` (bare digits, matches the real NNT record) instead of
`/PATID PY002505`.

**Deployed to:** CONSULTRM1 (client PC) — done, self-test 33/33 pass.
**Still needed:** Re-run `Install X-Ray Bridge.bat` on Cbct-pc (server PC) to
pick up this same fix — it runs the same script, so it has the same bug today.

## 2026-08-19 — Installer: auto-restart an already-running bridge

While deploying the fix above, discovered the installer only *started* the
bridge if nothing was listening on port 17890 — if the bridge was already
running, it left the old process alone, which meant it kept running the OLD
code in memory even after the `.ps1` file on disk was updated (PowerShell
doesn't hot-reload a running script). A plain re-install looked successful
but silently changed nothing until you also uninstalled and reinstalled.

**Fix:** `install-xray-bridge.ps1` now detects an already-running instance of
our own bridge and restarts it (stop, then start fresh from the
just-copied file) instead of leaving it alone. A single
`Install X-Ray Bridge.bat` run is now enough to deploy a code update on a
machine where the bridge is already live — no more manual
uninstall-then-reinstall needed. Verified: re-running the installer on
CONSULTRM1 printed "Found our bridge already running on port 17890 --
restarting it so it loads the code just installed." and came back healthy.

## 2026-08-18 — Initial installer + self-test suite

- Built `xray-local-launcher.ps1` self-test suite (`-SelfTest`, opt-in
  `-IncludeLiveLaunch`) covering date/sex conversion, query parsing, patient
  context building, file writes, and HTTP routing.
- Built `install-xray-bridge.ps1` (+ `.bat` wrappers) for one-click install:
  copies the script, self-tests before enabling, sets up a Startup-folder
  auto-start shortcut, and starts the bridge — with `-Uninstall` support and
  reliable port-conflict handling (via `Get-NetTCPConnection` to find the
  real PID listening on 17890, rather than unreliable `Get-CimInstance`
  command-line matching).
- Installed and verified on CONSULTRM1 (client PC).
- Handed off `tools/` folder + installer to be run on Cbct-pc (server PC).

## Pending

- Re-run `Install X-Ray Bridge.bat` on **Cbct-pc** so it picks up `/PATID`
  prefix-strip, `/SURNAME`, and the new `/nnt/scans` endpoints.
- All Users Startup still needs one elevated installer run on each PC if
  other Windows accounts log in.
- Same client/server bridge wiring for other x-ray systems (ezdenti, myray,
  Rayscan) — not started.
