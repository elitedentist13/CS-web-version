# X-Ray Bridge (NNT/NewTom) — Changelog

Log of fixes/changes to `xray-local-launcher.ps1` and the installer, kept for
future reference since this runs unattended on clinic machines.

## 2026-08-19 — Staff-gated "new OPG -> Banana" upload (`_nnt_new_opg_watcher.ps1`)

Added a background watcher, spawned alongside `_nnt_identity_guard.ps1` on
every live NNT/NEWTOM launch (`Start-NntNewOpgWatcher` in
`xray-local-launcher.ps1`), that offers to transfer a *newly captured*
panoramic straight into Banana without waiting for CS. Applies to every
patient the "NNT / NEWTOM" button is used for, new or returning (see the
"apply to every OPG taken" follow-up below).

Flow: watches the patient's own `\\RECEPTION\IMAGE\SCAN\{chart}\` tree for
any file written after the watcher started (a fresh `*.pan_<guid>`/`*.2dh`
NNT study, or a plain JPEG) — i.e. something captured *this session*, not
something CS already had. Once that file's size stops changing (avoids a
half-written capture), it pops a Yes/No prompt. This prompt is intentionally
asked **every single time** a new file is detected — no "don't ask again",
no silent auto-upload, no suppression for any reason (including a
concurrent identity-guard mismatch warning) — staff always get the final
say before anything leaves the PC.

On "Yes": screen-caps the live NNT viewer window using the same crop box as
`_batch_screencap_nnt.ps1` (preferred over decoding the raw `*.pan_` buffer
directly — that decode in `_import_cs_opg.py` is only an approximation of
NNT's real rendering), then uploads the JPEG directly from PowerShell via
`Invoke-RestMethod` against Supabase's anon-key REST API — same
`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`xrays` bucket+table contract as
`_import_cs_opg.py` and the web app's own `app-xray.js` upload path, so
these show up identically in the X-ray tab. Every outcome (`detected`,
`declined`, `uploaded`, `upload_error`, `stopped_*`) is logged as one JSON
line to `_nnt_new_opg_log.jsonl` for audit.

### Follow-up same day — extended to brand-new patients too

Initial version only watched a single folder resolved via
`Find-NntScanFolder`/the bridge's own `/DIR` value, both of which require
the folder to already exist — so a brand-new patient (no prior CS/NNT
folder at all) would resolve to no folder to watch, and the feature would
silently never fire for their very first capture. Per instruction ("the
xray transfer to Banana shall better apply to every OPG taken, new or old
patients"), this was widened:

- Added `Get-NntScanFolderCandidatePaths` in `xray-local-launcher.ps1` —
  every root x id-candidate combination (previously only used internally
  by `Find-NntScanFolder` to find the first *existing* match), now exposed
  so callers can also get the full candidate list regardless of existence.
- `Start-NntNewOpgWatcher` now passes the bridge-documented folder (if any)
  plus **every** candidate path — existing or not — to the watcher via a
  new semicolon-separated `-ChartFolders` parameter (renamed from the
  single-folder `-ChartFolder`).
- `_nnt_new_opg_watcher.ps1` polls all of them every cycle via
  `Find-NewestRelevantFileAcrossFolders`, silently skipping any that don't
  exist yet (not an error) — so the moment NNT/CS creates the patient's
  folder and writes the first capture into it, the watcher picks it up on
  its very next poll.

Remaining known limitation: this maximizes *where* the watcher looks, but
it's still not confirmed whether NNT's own internal patient database
writes a brand-new patient's first-ever capture into one of these network
SCAN folders at all, or purely into its own internal store with no
filesystem trace there until CS later exports it. Needs a live trial with
an actual brand-new patient to fully verify; all other cases (any prior
scan/study already on file, which covers essentially every existing
patient) are the confirmed/expected case today.

### Follow-up same day — installer was silently leaving both new scripts uninstalled

While answering a deployment question ("do I need to transfer the
installer files to the CBCT-CT computer?") found that
`install-xray-bridge.ps1` only ever copied `xray-local-launcher.ps1` into
`-InstallPath` (default `C:\NNT`) — never `_nnt_identity_guard.ps1` or
`_nnt_new_opg_watcher.ps1`. Since the launcher looks those up as siblings
via `$PSScriptRoot` at runtime, any PC set up (or re-installed) with just
the old installer behavior would have BOTH the identity-mismatch warning
and the new-OPG upload prompt silently do nothing — no error, no popup,
just missing safety/upload features, with nothing in the install output
hinting at it.

Fixed for good, not just as a one-off manual copy: `install-xray-bridge.ps1`
now has a `$RequiredCompanionScripts` list (currently the two scripts
above) that it copies into `-InstallPath` alongside the main launcher,
self-tests each one that got copied (same fail-fast-before-enabling-
anything philosophy as the main script's own self-test), warns clearly
(without hard-failing the whole install) if a companion is missing at the
source, and reports how many companions ended up installed in the final
summary. Any future companion script just needs to be added to that one
list. Re-running this installer on any existing install (including the
CBCT-CT PC) now brings it fully up to date in one step — no manual file
copying required, today or for any future companion script.

## 2026-08-19 — Decoded CS's `-VDDS PATDATIMPORT` sync file format (not yet wired in)

Follow-up to the identity-mismatch discovery (`_nnt_identity_guard.ps1`):
traced exactly what CS's second call (`NNT.exe -VDDS PATDATIMPORT <tmpfile>`)
actually writes, using a live capture (`tools/_watch_vdds_import.ps1` —
a `FileSystemWatcher` on `%TEMP%\NNTB*.tmp` + a WMI process-creation watcher,
copying the file the instant it appears since NNT consumes/deletes it fast).

**Format** (plain text, UTF-16LE with BOM, CRLF line endings, INI-style):

```
[PATIENT]
PVS=NNTBRIDGE
BVS=NNT
PATID=<chart number, e.g. 002509>
LASTNAME=<native/Chinese name>
FIRSTNAME=<English full name>
BIRTHDAY=<YYYYMMDD>
SEX=<M|W>          (German VDDS convention — "W" = female, NOT "F")
READY=0
```

This is CS's real "richer demographic sync" step: it writes this file, then
launches `NNT.exe -VDDS PATDATIMPORT "<path>"`, which pushes these fields
directly into NNT's own patient database for that `PATID` — silently
performing the same merge a human would do by clicking "ACCEPT NEW data" on
NNTBridge's conflict dialog. That's why staff never see that dialog when
opening a chart via CS: by the time NNTBridge's own mismatch check runs,
NNT's stored record has already been freshly overwritten to agree.

**Not implemented yet, deliberately.** Blindly replicating this in
`xray-local-launcher.ps1` would mean every NNT/NEWTOM launch silently
force-overwrites NNT's own database with whatever Banana/Supabase has for
that chart number — the exact same risk `_nnt_identity_guard.ps1` was built
to flag rather than auto-resolve, and actively dangerous given the
Supabase-side `patient_no` collisions already found (e.g. chart `000001`
matching two different Banana patients depending on `PY` prefix handling).
Auto-syncing on an unverified identity would silently corrupt a real
patient's NNT record instead of just misreading it. Needs a product decision
before wiring in (see CHANGELOG "Pending" / chat discussion).

Capture tooling (`_watch_vdds_import.ps1`) is kept for future reference;
the actual captured `.tmp` file (real patient PII) was deleted immediately
after decoding the format.

## 2026-08-19 — `_import_cs_opg.py`: CS panoramic OPG → Supabase `xrays` (trial: WONG SHUM YING / 002505)

Given the previous entry concludes standalone NNT can never be driven to
show a CS-only OPG, this is the actual fix: extract the real image once
and upload it to Banana's `xrays` bucket/table with the exact same
contract the web app uses (`app.js` SB client, `app-xray.js`
`uploadSingleXrayFile`), so it's visible from Banana (and survives CS
retirement) without any NNT automation at all.

**Two source cases per `SCAN\{chart}\`:**
1. Plain top-level real-panoramic JPEG (same geometry test as
   `_classify-cs-scan-jpegs.py`) → uploaded as-is. This covers the
   ~210–220 patients found by that script.
2. NNT-proprietary-only study (`Document\...\2D Images collection\*.2dh`
   + `*.pan_<guid>` raw buffers, no plain JPEG anywhere) → decoded from
   the raw 16-bit buffer. This is WONG SHUM YING's case and is presumably
   why standalone NNT never showed anything for her — the JPEG export
   was simply never made.

**Decoding the `.pan_<guid>` raw buffer (chart 002505, validated by eye):**
- Each `.pan_` file starts with a small `CNNTImg` header: 2 bytes `FF FF`,
  2 bytes `11 00`, a 2-byte length + ASCII class name (`CNNTImg`), 4 bytes
  `07 00 00 00`, then a `u32` little-endian declared pixel-buffer byte
  length, then that many bytes of raw `u16` little-endian pixels, then a
  UTF-16LE metadata footer (`...,type=PAN,white_level=65535`).
- Width/height aren't in the `.pan_` file itself. The sibling
  `.last_scenario` cache (only written after someone actually views the
  document in NNT — not present for most charts) has
  `IMG_WIDTH_MICRON` / `IMG_HEIGHT_MICRON`, which divide out to exactly
  10 px/mm for chart 002505 (2114 × 1150, matching the declared buffer
  length exactly: 2114×1150×2 bytes). Falls back to brute-force
  factor-pair search in a plausible pano aspect range when no
  `.last_scenario` exists.
- Orientation: confirmed empirically against the "NewTom" / side-marker
  ("L") watermark baked into the pixels — a **vertical-only** flip
  (`img[::-1, :]`) is correct. (A full 180° rotation was tried first and
  is wrong — it leaves the watermark text mirrored left-right.)
- `.last_scenario`'s `IMAGE_GUID` (per `SUB_IMG_INDEX`) also identifies
  which of the (usually 5) `.pan_` files is the primary/index-0 image —
  the other 4 are alternate filter/processing passes of the same
  exposure. Falls back to the alphabetically-first `.pan_` file when no
  cache exists (untested — most patients likely won't have one).
- Windowed to 8-bit via a 0.5–99.5 percentile stretch, **then CLAHE
  (`cv2.createCLAHE`, clipLimit=3.0, tileGridSize=24×24) + a mild unsharp
  pass (`ImageFilter.UnsharpMask`, radius=1.5, percent=200, threshold=2)**,
  saved as JPEG q92. The plain percentile stretch alone looked visibly
  soft/flat compared to CS's own exported copy of the same study (no bone
  trabecular texture, no crisp root edges — confirmed by decoding all 5
  `.pan_` variants for chart 002505: they're all equally soft, so it
  wasn't a wrong-variant problem, NNT's own display pipeline genuinely
  applies local adaptive contrast + sharpening that a global stretch
  can't reproduce). CLAHE + unsharp isn't a byte-exact match of NNT's
  proprietary rendering but got close enough by eye against the CS
  reference for chart 002505. Needs `opencv-python-headless` (`pip
  install opencv-python-headless numpy Pillow`).

**Upload contract (must match `app-xray.js` exactly or Banana won't
recognize the record correctly):**
- Storage: bucket `xrays`, path `{patients.id UUID}/{epoch_ms}_{rand}.jpg`
  — the *Supabase* patient UUID, not the CS chart number.
- Table `xrays` insert: `patient_id, patient_no, patient_name, file_path,
  file_url (public URL), file_name, file_size, xray_type: "Panoramic",
  taken_date (from the source file's mtime), notes, uploaded_by`.
- Uses the same anon URL/key as `app.js`'s `SB` client over plain REST
  (`storage/v1/object/{bucket}/{path}` POST, `rest/v1/xrays` POST) — no
  new credentials needed, same RLS policies the web app already relies on.

**Trial result:** WONG SHUM YING (PY002505) uploaded successfully,
downloaded back from the public URL and confirmed byte-for-byte, visually
confirmed as a normal, correctly-oriented OPG. Next: locate the full
population of NNT-proprietary-only charts (case 2) across
`\\RECEPTION\IMAGE\SCAN` and batch-run this same script.

## 2026-08-19 — `/DIR` fix, confirmed correct by tracing CS's own launch (supersedes the entry below)

The entry directly below this one concluded `/DIR` was an IPC-only switch
and gave up on it, based on NNTBridge's own embedded error strings. That
conclusion was **wrong** — proven by literally tracing what CS itself
launches (a scoped process-start watcher, filtered to only log process
names matching `NNT|CS.exe|NewTom|Bridge`, while opening WONG SHUM YING
in CS → NNT):

```
NNTBridge.exe /DIR \\RECEPTION\IMAGE\SCAN\002505 /PATID 002505 /NAME "WONG SHUM YING" /SURNAME "..." /DATEB 25,09,1982 /SEX F
  -> spawns: NNT.exe /DIR "\\RECEPTION\IMAGE\SCAN\002505"
  -> spawns: NNT.exe -VDDS PATDATIMPORT "...\Temp\NNTBA0E.tmp"
```

`/DIR` **is** a real archive-root override — the earlier attempt used
the wrong level. It must point at the **patient's own chart folder**
(`\\RECEPTION\IMAGE\SCAN\{chart}`), not the shared `SCAN` root. NNT then
looks for `<DIR>\Document\...` directly underneath, which is exactly the
per-chart layout CS's image share uses. Pointing `/DIR` at the shared
root (one level too high) meant NNT never found `Document\...` under it,
which is why that attempt showed nothing and looked like `/DIR` was
inert. It still requires no `NNT.exe` instance already running to take
effect, exactly as its own error strings say — that part of the earlier
analysis was correct, just not the "IPC-only, not a data path" part.

**Current fix** (`Start-NntBridgePatient`): when `Find-Nnt2dDocFile`
finds a `.2dh` study for the patient (NNT-proprietary-only case), close
any running NNT process, then pass `/DIR <patient's own SCAN\{chart}
folder>` before `/PATID ...`. Patients with no NNT-only study skip `/DIR`
entirely (no disruption, no NNT close).

Not replicated: CS's second call, `NNT.exe -VDDS PATDATIMPORT <tmpfile>`
(a VDDS patient-data-import handoff). `/PATID` already reliably
pre-fills/opens the patient without it; this is CS's own richer
demographic sync, not required for the OPG to show.

## 2026-08-19 — Standalone NNT cannot be driven to open a specific old OPG (reverted `/DIR` attempt) — SUPERSEDED, see above

**Symptom (WONG SHUM YING / PY002505):** Banana → NNT / NEWTOM opened NNT
but showed no OPG. CS → NNT showed the OPG.

**What her study actually is:** NNT.ini on consultation PCs points the
archive at `\\Cbct-pc\nnt\Documents\` (hashed `Pxx` folders + Shared
PatDocDB). Her study is not there — it only exists as NNT-proprietary
`*.pan_*` / `*.2dh` files under CS's image share:

`\\RECEPTION\IMAGE\SCAN\002505\Document\...\2D Images collection\`

**Three attempts tried and reverted, in order, with evidence:**

1. `/DIR \\RECEPTION\IMAGE\SCAN` before `/PATID`, assuming `/DIR` retargets
   NNT's archive root (CS appeared to use it). **Reverted** — NNTBridge's
   own embedded strings show `/DIR` is an IPC *working-directory* switch for
   the bridge↔NNT handshake ("`/DIR` option terminates prematurely",
   "`/DIR` option timeout", "requires that there isn't any NNT instance
   running"), not a study/archive path. It does not change what NNT can see,
   and pointing it at a UNC share risked exactly those IPC timeout/prematurely
   errors.
2. `/DOCID <id> /NOTCREATE` using the `.2dh` filename as the document id.
   **Reverted** — NNTBridge looks the id up in its own (Cbct-pc-backed)
   database and returns a real dialog: `SELECTPATIENT: Err = 12 - Unable to
   open document`.
3. Launching `NNT.exe` directly with the full `.2dh` UNC path as a bare
   argument. **Reverted** — NNT.exe silently ignores unrecognized arguments
   and falls back to its default patient-search screen; nothing opens.

**Current state:** `Start-NntBridgePatient` is back to the original, known-good
`/PATID /NAME /SURNAME /DATEB /SEX /SSNM /APPPATH /WORKDIR /OPENPATIENT` call
(no `/DIR`, no `/DOCID`, no direct file launch, NNT is no longer force-closed).
This reliably pre-fills demographics and opens/creates the patient in NNT's
own Cbct-pc-backed database, same as before this investigation — it just does
not, and per the evidence above cannot via NNTBridge's public CLI, jump
straight to a historical CS-only OPG.

`Find-Nnt2dDocFile` / `Find-Nnt2dDocId` (locating the `.2dh` file for a
chart) are kept — they're needed for the JPEG export/import path into
Supabase, not for driving NNT's UI.

**Practical takeaway:** for patients like her, standalone NNT will never
show this specific OPG without CS unless someone manually opens it once
inside NNT (File/Open on that `.2dh` path) and exports/screenshots it as a
JPEG. That JPEG import into Banana's `xrays` bucket is the reliable
long-term path for "still visible after CS retires," not further NNTBridge
CLI automation.

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
