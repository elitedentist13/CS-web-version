# X-Ray Bridge (NNT/NewTom) — Changelog

Log of fixes/changes to `xray-local-launcher.ps1` and the installer, kept for
future reference since this runs unattended on clinic machines.

## 2026-09-03 — New: Ai-Dental (Woodpecker i-Sensor) bridge — auto-fill, auto-update, clinic-prefix stripping

Ai-Dental (small film / periapical / bitewing) previously had no real
connection to Banana at all: `app-xray.js` had substantial "aidental"-named
UI plumbing (`aidentalMode`, `aidental_running`, `new_patient_prepared`, a
function literally named `xrayWoodpeckerPatientSummary`) built toward some
kind of "auto-fill Woodpecker's Create Patient form" flow, but
`tools\xray-local-launcher.ps1` never implemented any backend for it —
`/open/aidental` just launched the exe with zero patient data, identical to
Carestream's "manual search" fallback. Worse, `tryLaunchDesktopAppViaLocalBridge`
hard-coded `bridgeOk = !!body.aidental_running` for this key, a field the
bridge never set — so even that bare launch always reported as "failed" to
the user. New cases were entirely hand-typed into Ai-Dental as a result,
exactly as reported.

Researched what Ai-Dental-Client actually is (Woodpecker i-Sensor's bundled
imaging hub) and found Open Dental publishes an official "Ai-Dental Bridge"
(opendental.com/site/bridgeaidental.html): default path
`C:\Ai-Dental\Ai-Dental-Client\Ai-Dental.exe` (already hardcoded in
Banana's `XRAY_SYSTEMS.aidental` before this research) and a documented
command-line contract, `Ai-Dental.exe [PatNum].[LName].[FName]` — one
dot-joined argument.

Unlike Rayscan/Digirex, this was researched from documentation alone at
first — but this development PC turned out to actually have Ai-Dental-Client
installed, so a real live investigation was possible too:

- Confirmed genuinely Woodpecker's software (`WOODDCMDLL.dll`, bundled
  `WP_*.CHM` manuals), installed at exactly Open Dental's documented
  default path.
- Confirmed its `Config\YPBSetting.ini` points at the same central imaging
  server IP as this clinic's existing Rayscan deployment
  (`192.168.50.140`), on a different port (`8003` vs Rayscan's `9876`) —
  no collision between the two, and no local listening port for this
  consultation-PC bridge to conflict with.
- Confirmed the desktop shortcut (`Ai-Dental-Client.lnk`) points straight
  at `Ai-Dental.exe` with empty arguments — same "shortcut carries no args,
  caller builds them fresh" pattern as NNTBridge/RAYBridge.
- Confirmed launching `Ai-Dental.exe "001287.HSIUNG.KWAN MING"` starts
  cleanly (visible window, stays responsive, no crash/error dialog) — safe
  to always send.
- Could **not** confirm the `[PatNum].[LName].[FName]` string contract
  itself inside this exact binary (ASCII + UTF-16 string scans found no
  `"PatNum"`/`"OpenDental"` literals), and could not confirm the launched
  instance actually opens the intended chart (the app requires an operator
  login first; this environment has no credentials for it). The bundled
  English manual documents a **different** native mechanism instead — DICOM
  Modality Worklist (Setting → DICOM Setting → WORKLIST) — a proper DICOM
  C-FIND server, a much bigger integration, not implemented here. Full
  writeup: `installer-aidental\README.md` "What's confirmed vs.
  best-effort".

Implementation (same shared-engine pattern as every other system):

- `Convert-AiDentalPatientId` (wraps `Convert-NntPatientId`) strips the
  clinic prefix so OLD Ai-Dental charts still match.
- `Split-AiDentalPatientName` reuses `Split-RayPatientName`'s surname-first
  convention (same clinic, same evidence) to build `LName`/`FName` from
  Banana's one free-text name field.
- `New-AiDentalArgument` builds the dot-joined string, stripping stray
  literal periods from the ID/name first (the field separator has no
  documented escape syntax).
- `Start-AiDentalBridgePatient` launches `Ai-Dental.exe` with that single
  argument — always, even if already running, matching Open Dental's own
  documented usage (its bridge button re-invokes on every click; Ai-Dental
  is built on Qt's single-instance app pattern, confirmed via RTTI strings
  in the binary, so a second invocation is expected to signal the already-
  running instance rather than open a duplicate window).
- Wired into `Handle-Request`'s `/open/aidental` dispatch; added as a
  sidecar in `Test-SystemEnabled`/`Status-Payload` (same additive pattern
  as Digirex on top of EzDent-i/MyRay) so any PC already running one of the
  other dedicated bridges gains Ai-Dental support automatically once it's
  installed on disk, with zero changes to that installer.
- Fixed the frontend's `bridgeOk` bug and removed the dead "fill Woodpecker
  Create Patient form" code path (`aidentalMode`, `aidental_running`,
  `xrayWoodpeckerPatientSummary`, `xrayAiDentalLaunchMessageKey`,
  `xrayBridgeFieldsFilledLabel`, `xrayBridgeDebugLabel`, and the six
  matching now-unused i18n keys) — Ai-Dental now goes through the exact
  same generic open/launch/needed message flow as every other system,
  with a richer clipboard-fallback summary (chart no., Chinese name,
  English name, DOB, sex, HKID, phone) since its own CLI contract can't
  carry all of that.
- New `tools\installer-aidental\` package (Install/Uninstall/Test/Start
  `.bat` + auto-update + auto-start-at-login), added to
  `build-installer-packages.ps1`. Self-tests: 201/201 pass, including 12
  new Ai-Dental-specific checks (prefix stripping, name split, argument
  construction, negative-path launch safety, sidecar isolation).

## 2026-09-03 — Fix: Digirex (Po Lam / "PL" clinic) fails to display Traditional Chinese patient names

Real bug report from Po Lam: opening a patient's Digirex record from
Banana showed the Traditional Chinese chart name as garbled text /
mojibake (or, depending on the exact byte collisions, an apparently blank
name field) instead of the correct characters. English names and all
other fields (chart no., DOB, gender) were unaffected.

Root cause: `Write-DigirexSwitchIni` wrote `Switch.ini` as plain UTF-8 (no
BOM, `New-Object System.Text.UTF8Encoding $false`). Apixia's own
`Switch.ini` reader is a legacy Win32 INI parser with no Unicode
awareness — exactly like every other non-BOM text file on this fleet (see
the 2026-08-20 "`xray-local-launcher.ps1` lost its UTF-8 BOM" entry
below), it decodes bytes using the PC's system ANSI code page, which on
every one of this clinic's Windows installs is Traditional Chinese Big5
(950). Decoding UTF-8's multi-byte sequences as single/double-byte Big5
turns the Chinese name into garbage — this bug never affected the
English-name path because ASCII bytes are identical in UTF-8 and Big5.

Fix: added `Get-DigirexIniEncoding` (defaults to
`[System.Text.Encoding]::Default`, i.e. Windows PowerShell 5.1's OS ANSI
code page — Big5 here, but adapts automatically to whatever locale a
given clinic PC runs, matching the same page Digirex itself reads with)
and switched `Write-DigirexSwitchIni` to use it instead of hardcoded
UTF-8. Overridable per-PC via `$script:DigirexIniEncoding` in
`xray-launcher-config.ps1` (e.g. explicit code page 936/GBK for a
Simplified-Chinese install) — see
`installer-digirex\xray-launcher-config.example.ps1`.

Added a self-test that writes `Switch.ini` with a real Traditional
Chinese chart name and reads it back through the same encoding path
Digirex uses, so a future regression (e.g. someone reverting to UTF-8) is
caught automatically (183/183 checks pass on all 5 affected packages).
Synced the fix into every package that ships this shared engine file:
`tools\xray-local-launcher.ps1` and `installer-digirex` /
`installer-ezdenti` / `installer-myray` / `installer-nntnewtom` /
`installer-rayscan` (all Digirex-capable via the shared :17890 sidecar).
Clinics with an existing bridge pick this up on their next auto-update
cycle; no re-install needed.

## 2026-09-03 — Fix: Rayscan button missing from Consultation → X-ray tab

The **Rayscan** button never made it into `index.html`'s x-ray systems bar
even though `XRAY_SYSTEMS.rayscan` (config), the full RAYBridge command-line
contract, and the dedicated `tools\installer-rayscan\` package were already
built and documented (see the 2026-08-20 entries below). It silently
"disappeared" from staff's point of view the moment the Digirex button was
added next to where Rayscan should have been, because it was never actually
there in the HTML to begin with. Restored:

- `index.html` — added the `xray-sys-rayscan` button (between Digirex and
  Trophy) calling `openXraySystem('rayscan')`, same pattern as Carestream /
  Ai-Dental / NNT-NEWTOM (no dedicated JS wrapper needed; the generic
  `openDesktopXrayApp('rayscan')` path already handles the confirm dialog,
  bridge ping, and launch).
- `app-i18n-extra.js` — added the missing `media.sys.rayscan` /
  `media.sys.rayscan.info` / `media.sys.rayscan.desktopHint` and
  `media.local.rayscanOpen` / `rayscanLaunched` / `rayscanLauncherNeeded`
  translation keys (EN / zh-CN / zh-Hant). Without these the button would
  have rendered with a blank label even once added back.
- `app-xray.js` — `XRAY_SYSTEMS.rayscan` was also missing `launcherBat`, so
  the "could not start" message pointed staff at the generic, wrong
  `tools\Start X-Ray Launcher.bat` instead of
  `tools\installer-rayscan\Start Rayscan Launcher.bat`. Fixed to match the
  same pattern as `digirex`.
- `style.css` — added `.xray-sys-rayscan` / `:hover` color rules (indigo,
  `#4f46e5`) so the new button isn't unstyled.

No changes were needed to the bridge/installer itself for auto-update,
auto-start-at-login, or clinic-prefix stripping — `tools\installer-rayscan\`
already ships byte-identical `install-xray-bridge.ps1` /
`xray-bridge-auto-update.ps1` copies to every other per-system installer
(Startup-folder shortcut + a recurring Scheduled Task that hash-checks the
live GitHub Pages site every 6 hours and safely swaps in updates), and
`Convert-RayPatientId` already strips any clinic letter prefix (e.g. "MK")
down to the bare digit chart number — see the 2026-08-20 / 08-27 entries
below for that history. Clinics with an existing Rayscan bridge install will
pick this UI-only fix up automatically once it's live and their next
auto-update cycle runs; no re-install needed.

## 2026-08-31 — EzDent-i / MyRay installers co-run Digirex on the same port

Po Lam and Kwun Tong consultation PCs run panoramic software and Apixia
on one machine. Re-running **Install EzDent-i Bridge** or **Install MyRay
Bridge** (updated zip) is enough: `/open/digirex` is a sidecar on the
same `127.0.0.1:17890` process when `digirex.exe` is on disk. Login is
`apixia` / `digirex`. Do not install `installer-digirex` on those PCs.

## 2026-08-31 — Fix: Digirex "Wrong Username or password" on NETWORK 3.0

Launching Digirex from Banana wrote `[Dentist] ID=` the Banana consultation
doctor tag (often `ignore`) and that is not a DigirexServer user. Apixia
NETWORK 3.0 then showed "Wrong Username or password, please try again."

Clinic login is username `apixia` / password `digirex`. The launcher now
always writes those credentials (overridable via `$script:DigirexDentistId`
/ `$script:DigirexDentistPassword`) and ignores Banana `dentist_id`.

Installer packages rebuilt for the next PC: run
`tools\build-installer-packages.ps1` (or use the zips it writes). Copy
`Banana-Digirex-Bridge-Installer.zip` to a Digirex-only PC; on a PC that
already has EzDent-i or MyRay, re-run **that** installer instead so
Digirex stays a sidecar.

## 2026-08-31 — Add: Apixia Digirex (periapical / bitewing) sidecar on the existing :17890 bridge

Clinic Solution / Banana Consultation → X-ray tab now has a **Digirex
(Apixia)** button. Digirex is the small-film PSP program (periapical /
bitewing), separate from EzDent-i (PL OPG) and MyRay (KT panoramic).

Contract (same as Open Dental's Apixia Bridge): write `Switch.ini` next
to `digirex.exe` (`[Patient]` ID / First / Last / Gender / Year / Month
/ Day + `[Dentist]` ID + password `digirex`), then launch Digirex. That
opens an existing chart or creates a new one from the same fields.

Chart matching: Banana `patient_no` carries a clinic prefix (`PL001287`
at Po Lam). OLD Digirex records are keyed on bare digits. Reuses
`Convert-NntPatientId` so any prefix (PL / MK / KT / …) is stripped.
If the local Digirex `DATA` folder (Program Files or VirtualStore) has
a matching folder, that id is used so existing films open.

Coexistence: Digirex is a **sidecar** on the already-running bridge.
EzDent-i-only and MyRay-only installers still refuse to open each
other. They do serve `/open/digirex` when `digirex.exe` is detected, so
PL and KT do **not** install a second listener. Dedicated
`installer-digirex` is only for Digirex-only PCs.

Auto-detect: desktop shortcuts, well-known paths, `DIGIREX_HOME`,
uninstall registry (DisplayName Digirex / Apixia). Override via
`xray-launcher-config.ps1` (`$script:DigirexExePath` /
`$script:DigirexDataRoots` / `$script:DigirexDentistId`).

Auto-start and auto-update stay on the existing installer scheduled
task / Startup shortcut. Re-run the PC's current installer (EzDent-i
or MyRay) so the new engine is copied; do not add a second bridge.

## 2026-08-24 — Fix: EzDent-i did not match OLD charts when Banana's patient_no has a clinic prefix (e.g. "PL")

Reported as: opening EzDent-i from Banana for a Po Lam patient (chart
`PL…`) does not find the existing patient already in EzDent-i.

Root cause: Banana's `patient_no` carries a clinic-configurable letter
prefix (`patient_no_prefix`, here `"PL"`). OLD EzDent-i records were
entered before that prefix existed and are keyed on the bare digits.
`New-EzdentiLinkageXml` sent `ChartNumber="PL001287"` as-is, and the
clipboard paste-into-search fallback copied the same prefixed string, so
EzDent-i never matched the old chart.

Fix: added `Convert-EzdentiPatientId` (same digit-extraction as NNT
`/PATID` and Rayscan `ID:` — strips ANY clinic letter prefix, not only
the literal `"PL"` this report named). Used for:

- `Linkage.xml` `ChartNumber`
- `Start-EzdentiBridgePatient`'s returned `chart_number`
- the clipboard text staff paste into EzDent-i's own search (overwrites
  the generic Handle-Request copy, which still holds Banana's full
  prefixed number)

Bare numbers (`001287`) are unchanged. Applied to the canonical
`tools\xray-local-launcher.ps1`, then rebuilt all three installer
packages via `build-installer-packages.ps1`. Re-run **Install EzDent-i
Bridge.bat** on the clinic PC to pick this up.

## 2026-08-20 — Fix: SMARTDent stays minimized / taskbar-flashing when Banana launches it via RAYBridge

Reported as: clicking the Banana X-ray Rayscan button starts SMARTDent, but
the window stays minimized and the taskbar button blinks red/orange until
staff click it.

Root cause: the local bridge PowerShell process is itself started
minimized (`-WindowStyle Minimized` in `install-xray-bridge.ps1`). Windows
then treats RAYBridge/SMARTDent as a background launch that is not allowed
to steal foreground focus, so SMARTDent opens iconic and only flashes.

Fix: `Start-RayBridgePatient` now launches RAYBridge with `WindowStyle
Normal`, then fires a non-blocking helper (`Start-RestoreRayViewerWindow`)
that waits up to 15s for the SMARTDent window, restores it from minimized,
and force-focuses it (AttachThreadInput + Alt keypress, the usual
workaround for `SetForegroundWindow` from a background process). Banana's
`/open/rayscan` HTTP reply is not delayed.

## 2026-08-20 — Fix: NNT scan strip hardcoded the wrong server hostname (`RECEPTION` instead of `CSMAIN`), breaking the X-ray tab's mini-thumbnail strip for this clinic

Reported as: the NNT scan strip (separate from the Rayscan bridge work --
the small header thumbnail strip in the X-ray tab that reads straight from
the CS SCAN share) stopped showing patient MK006681's two existing JPEGs
after unrelated changes.

Root cause: `Get-NntScanRoots` in `tools\xray-local-launcher.ps1` had
`\\RECEPTION\IMAGE\SCAN` listed first. On this clinic's actual network,
`RECEPTION` does not resolve at all (`Resolve-DnsName` / `net view` both
fail). Live diagnostics from a real consultation-room PC found: the CS
desktop shortcut's own ODBC DSN (`ClinicSolution`,
`HKLM\SOFTWARE\WOW6432Node\ODBC\ODBC.INI\ClinicSolution`) points at SQL
Server host `192.168.50.2`, whose NetBIOS name is `CSMAIN` -- and
`\\CSMAIN\IMAGE\Scan\{chart}` is the real share holding the scans (confirmed
live: `\\CSMAIN\IMAGE\Scan\006681` held MK006681's 2 real OPG JPEGs, matching
Banana's own "MK" chart prefix once stripped by `Convert-NntPatientId`).

Fix: `Get-NntScanRoots` now uses `\\CSMAIN\IMAGE\Scan` (this clinic's
confirmed CS IMAGE share). The old `\\RECEPTION\IMAGE\SCAN` hostname was
removed — it never resolved here and only added a failed-lookup delay.
Applied to:
- The canonical `tools\xray-local-launcher.ps1` (shared source for all three
  installer packages -- EzDenti, NNT-NEWTOM, Rayscan).
- The already-running bridge on this PC (`C:\BananaBridge-Rayscan\
  xray-local-launcher.ps1`), copied over and the bridge process restarted;
  verified live that `/nnt/scans?patient_no=MK006681` returns the 2 files
  again.
- All three rebuilt installer zips (`Banana-EzDenti-Bridge-Installer.zip`,
  `Banana-NNT-Bridge-Installer.zip`, `Banana-Rayscan-Bridge-Installer.zip`),
  each re-verified 105/105 self-test checks pass from a clean extraction.
- The read-only census/import Python scripts under `tools\` that point at
  this same clinic's CS SCAN share for offline analysis/backfill work
  (`_census-cs-scan-jpegs.py`, `_census-opg-population.py`,
  `_classify-cs-scan-jpegs.py`, `_sample-cs-scan-sizes.py`,
  `_import_cs_opg.py`, `_batch_import_population_a.py`): `RECEPTION` ->
  `CSMAIN` in their hardcoded `ROOT`/`SCAN_ROOT` paths and docstrings.
- `app-nnt-scans.js`'s header comment, updated to describe the real
  `CSMAIN` path (with the `RECEPTION` fallback noted).

Deliberately NOT touched: `run-cs-payments-import.py`, `export-cs-notes.ps1`,
`export-cs-payments.ps1`, and their companion `CS_*_IMPORT.md` /
`CS_PAYMENTS_EXPORT.md` docs. Their `RECEPTION\CSX` defaults are documented
examples for *other* clinic branches (`--branch PL`, `-Branch TKO`), not this
Mongkok/`CSMAIN` site -- renaming those would risk pointing a different
branch's export at the wrong server. Left as-is; flagged for manual review
if those branches also turn out to be misnamed.

## 2026-08-20 — Fix: `xray-local-launcher.ps1` lost its UTF-8 BOM, which would have made a fresh install on any HK/TW Big5-locale PC (e.g. the server PC next to the OPG machine) fail to even start

Discovered while preparing to hand the Rayscan package over to the server
computer: `tools\build-installer-packages.ps1`'s own clean-zip-extraction
verification step started failing with confusing cascading parser errors
("Missing expression after '/'", "'&' operator reserved for future use")
around the self-test's Chinese-name round-trip line -- for ALL THREE
packages (EzDenti, NNT-NEWTOM, Rayscan), not just Rayscan.

Root cause: `xray-local-launcher.ps1` contains a few non-ASCII (Chinese)
characters in self-test fixtures, encoded as UTF-8. Windows PowerShell 5.1
(Desktop edition -- confirmed via `$PSVersionTable` on this PC) only
recognizes a file as UTF-8 if it starts with a UTF-8 byte-order-mark
(`EF BB BF`); otherwise it decodes the file using the OS's legacy ANSI code
page (Big5/950 on this HK-locale Windows install). Decoding UTF-8 bytes as
Big5 turns the Chinese test string into garbage that, by coincidence,
contains a byte value matching a double-quote -- closing the PowerShell
string literal early and desyncing the parser for everything after it,
breaking the *entire script* (parsing happens before any code runs, so this
is not limited to the self-test path).

The canonical `tools\xray-local-launcher.ps1` had silently lost its BOM at
some point (very likely during an earlier same-day text edit/save), and
every installer package's copy inherited that via the normal sync step.
Confirmed the *already-running* bridge on this PC (`C:\BananaBridge-Rayscan\
xray-local-launcher.ps1`, installed earlier from an older, still-BOM'd
build) was unaffected and kept working throughout -- but re-installing from
the current dev-folder source, or shipping the built zip to a fresh PC
(such as the server computer next to the OPG machine), would have silently
failed to start with no obvious explanation, since the file *looks*
completely normal in any UTF-8-aware editor/reader.

Fix: re-saved `xray-local-launcher.ps1` and `installer-nntnewtom\_nnt_new_opg_watcher.ps1`
with a proper UTF-8 BOM (content otherwise byte-for-byte unchanged -- verified
via diff). Rebuilt and re-verified all three installer zips from a clean
extraction with `-SelfTest`: all 105/105 checks now pass for every package.
Going forward, any new non-ASCII content added to these shared scripts is
safe as long as the BOM is preserved (avoid tools that silently re-save as
BOM-less UTF-8).

## 2026-08-20 — Fix: browser-side fetch() timeouts raced Chrome's Local Network Access permission popup, so the FIRST Rayscan click (and any click before permission was granted) always failed with "launcher needed" even though the backend worked fine

Follow-up to the "browser can't link to X-ray" report, after confirming
via a live clinic PC that the backend hand-off (bridge -> `RAYBridge.exe`
-> `SMARTDent.exe`) succeeded every single time when called directly over
HTTP (bypassing the browser) -- ruling out the initial "SmartDent needs to
be preloaded" theory. Ruled in instead: `app-xray.js`'s `pingXrayLauncher()`
and `tryLaunchDesktopAppViaLocalBridge()` each raced their `fetch()` call
against a hardcoded client-side timeout (2000ms / 2800ms). Chrome's Local
Network Access permission prompt (see the `XRAY_LAUNCHER_FETCH_OPTS`
comment in `app-xray.js`) is a real, human-clickable popup that the
`fetch()` call waits on indefinitely -- but on a PC where that permission
was still in its default "prompt" (undecided) state, Banana's own timer
fired long before a human could notice and click Allow, so the code
silently reported "offline" and gave up with a generic "Rayscan launcher
needed" alert, before the fetch itself ever had a chance to succeed.

Fix: added `xrayLoopbackPermissionState()`, which uses
`navigator.permissions.query({name:'loopback-network'})` (Chrome-only;
falls back to `'local-network-access'` then `'unsupported'` for other
browsers, which never show this popup) to check whether the permission is
already decided *before* picking a timeout. If it's still `'prompt'`, both
functions now wait up to 30s instead of ~2-3s. Also threaded a
`permissionPrompt` / `permissionDenied` flag back through the callbacks so
the alert the user sees is specific ("click Allow on the popup, then click
this button again" vs. "access was denied in Chrome settings") instead of
the generic "is the launcher running?" message, which was actively
misleading in this case since the launcher was running the whole time.
New i18n keys: `media.local.launcherPermissionPrompt` /
`media.local.launcherPermissionDenied` in `app-i18n-extra.js`.

## 2026-08-20 — Fix: Rayscan/RAYBridge didn't match OLD OPG records for chart numbers with a clinic prefix (e.g. "MK")

Real bug report from a live clinic PC: existing/old OPG records already
sitting in Rayscan's own database were entered before Banana's
multi-branch `patient_no_prefix` setting existed (this clinic uses "MK" /
Mongkok), so they're keyed on the bare chart number. `Start-RayBridgePatient`
was sending the full `"MK..."` string as RAYBridge's `ID:` argument, which
never matched those old records -- RAYBridge/SMARTDent fell back to an
unmatched/new-patient state instead of surfacing the existing OPG history.

This corrects the 2026-08-20 "keep patient_no AS-IS" assumption from the
entry below, which was based on a single freshly-created `PatientInfo.ini`
sample -- a brand-new patient has no pre-existing record to fail to match
against, so that sample never actually exercised this path.

Added `Convert-RayPatientId` (thin wrapper around the existing
`Convert-NntPatientId`, which already generically extracts the first run
of digits, stripping ANY clinic letter prefix -- not hardcoded to "MK")
and wired it into `Start-RayBridgePatient`'s `ID:` argument. Added
matching self-test coverage. Rebuilt `installer-rayscan/` and re-ran the
installer on the already-live bridge on this PC so it picked up the fix
immediately (installer detects an already-running bridge and restarts it,
since PowerShell doesn't hot-reload a running script from disk).

## 2026-08-20 — Added Rayscan (RAYBridge / SMARTDent V3) support + its own installer package (`installer-rayscan/`)

Investigated live on a real clinic PC (chart `KT005455`, hostname
"Doctor-1"): `C:\Users\Public\Desktop` has `RAYBridge.lnk` ->
`C:\Ray\RAYBridge\RAYBridge.exe` and `SMARTDent V3.lnk` ->
`C:\Ray\RayView\SMARTDent.exe`. Decoded the actual patient handoff
mechanism from three independent pieces of evidence, all pointing at the
same contract:

- `RAYBridge.exe`'s own embedded usage string (extracted from the binary):
  `RayBridge.exe "ID:PID2020-00001" "LastName:Smith" "FirstName:Tom" "MiddleName:middle" "BirthDay:1993-07-28" "Sex:M"`.
- `C:\Ray\RAYBridge\SYS\LocalConfig.xml` on this PC has
  `<Integration><SelectedFileFormat value="Command" />`, confirming the
  command-line form (not the alternative -VDDS/-CSV file-based settings
  the same binary also supports) is the one actually in effect here.
- A real captured handoff file,
  `C:\Ray\RayView\Temp\Integration\Save\KT005455_19660915\...\PatientInfo.ini`,
  showing `Patient ID = KT005455` (full patient_no, prefix kept -- unlike
  NNT) and `Patient Name = TANG^PUI^SHEUNG` (caret-separated,
  surname-first HK/Cantonese convention -- confirms which end of the free
  text `patient_name` field maps to `LastName`).

Added to `xray-local-launcher.ps1`: `Resolve-RayBridge`,
`Convert-RayBirthDate` (ISO `yyyy-MM-dd`, unlike NNT's `dd/MM/yyyy`),
`Split-RayPatientName` (surname-first split), and
`Start-RayBridgePatient`, wired into `Handle-Request`'s `/open/rayscan`
dispatch exactly like the existing NNT/EzDent-i bridges. Added matching
self-tests (pure-function coverage always runs; the real
`RAYBridge.exe`-launching path is opt-in via `-IncludeLiveLaunch`, same
pattern as NNT/EzDent-i).

This PC is the **client**: RAYBridge / RayView / the "Ray Local Server"
Windows service all run locally and talk to the clinic's imaging server
over the network (`local_server_config.xml` on this PC points
`global_ip_address=192.168.50.140, global_port=9876` -- the PC next to the
OPG/CT unit, e.g. `DESKTOP-CU5IQLC`). That client<->server sync is
entirely Rayscan's own software; this bridge never talks across the
network itself, it only ever launches `RAYBridge.exe` locally on whatever
PC the browser is open on -- same as every other system in this file.

Requested explicitly: keep the Rayscan installer in its own folder,
separate from NNT-NEWTOM's and EzDent-i's. Built `installer-rayscan/`
following the exact same pattern as `installer-ezdenti/` (dedicated
`-EnabledSystems "rayscan"`, own install path `C:\BananaBridge-Rayscan`,
own shortcut name, own `Install/Start/Test/Uninstall Rayscan *.bat`
wrappers, own `README.md`), and added it as a third entry in
`build-installer-packages.ps1`'s package list so it stays in sync with the
canonical engine automatically.

(Corrects the "not started" note below from 2026-08-19 -- Rayscan is now
implemented; `myray` is still unstarted.)

## 2026-08-19 — Split into separate per-system installer packages (`installer-ezdenti/`, `installer-nntnewtom/`)

Requested explicitly: keep the EzDent-i installer in a fully separate
folder from NNT-NEWTOM's, so the two can be copied to different clinic
PCs without any risk of mixing files/branding up.

Rather than fork `xray-local-launcher.ps1` into two independent copies
(which would mean every future fix has to be applied twice and could
silently drift), added a `-EnabledSystems` param to the engine itself:

- `Resolve-System` returns `$null` for any key not in `-EnabledSystems`
  (when set) -- byte-for-byte identical to an unrecognized key, not just
  "hidden". `/open/<key>` 404s exactly like it does for a made-up key.
- `Status-Payload` now builds its response dynamically and only reports
  `<key>_exists` / `systems.<key>` for enabled systems, plus a new
  `enabled_systems` field.
- Default (no `-EnabledSystems` passed, or empty) = every system, i.e. the
  shared `tools\` copy's behavior is completely unchanged for anyone
  already relying on one bridge covering multiple systems on the same PC.

`install-xray-bridge.ps1` grew matching `-EnabledSystems` and
`-ShortcutName` params, threaded through the startup shortcut's Arguments,
the immediate post-install `Start-Process`, and the elevation re-invoke.
`Test-BridgeAlive` (used by install/uninstall to confirm the bridge is
really ours before touching it) was also made generic -- it used to check
specifically for `nntnewtom_exists` in `/status`, which no longer exists
at all on an EzDent-i-restricted instance.

Built two new self-contained folders, each with its own `Install/Start/
Test/Uninstall *.bat` wrappers (passing their own fixed `-EnabledSystems`)
and its own `README.md`:

- `installer-ezdenti/` -- EzDent-i only, installs to
  `C:\BananaBridge-EzDenti` (deliberately NOT `C:\NNT`, to avoid an
  EzDent-i-only PC ending up with an NNT-named folder on it), shortcut
  "Joyful Smile EzDent-i Bridge.lnk". Does not ship the two NNT companion
  scripts at all.
- `installer-nntnewtom/` -- NNT-NEWTOM only, installs to `C:\NNT` (kept as
  the existing default -- real PCs, e.g. CONSULTRM1/Cbct-pc, already use
  this path), shortcut "Joyful Smile NNT-NEWTOM Bridge.lnk". Ships the two
  NNT companion scripts (`_nnt_identity_guard.ps1`,
  `_nnt_new_opg_watcher.ps1`).

Added `build-installer-packages.ps1` to sync the canonical engine/installer
files into both subfolders and rebuild `Banana-EzDenti-Bridge-Installer.zip`
/ `Banana-NNT-Bridge-Installer.zip` -- run this after editing
`xray-local-launcher.ps1` or `install-xray-bridge.ps1` in this folder,
rather than hand-editing the subfolder copies. Each build extracts its own
zip to a clean temp folder and runs `-SelfTest` from there before
declaring success, so a package that isn't actually self-sufficient fails
the build instead of shipping broken. Removed the old single combined
`Banana-XRay-Bridge-Installer.zip` (superseded by the two dedicated ones).

Verified live (not just via self-test): started
`installer-ezdenti\xray-local-launcher.ps1 -EnabledSystems "ezdenti"` on a
throwaway port, confirmed `/status` has `ezdenti_exists` but no
`nntnewtom_exists` key at all, and `GET /open/nntnewtom` returns a genuine
404 -- the restriction holds at runtime, not just in the test harness.

Self-test: +7 checks for `-EnabledSystems` isolation, 82/82 passing.

## 2026-08-19 — EzDent-i live investigation: CS never wired it up either; redesigned the bridge to not depend on `linkage.xml` working, and shipped `tools/README.md` as the installer package doc

Set out to *confirm* the `linkage.xml` design from the entry directly below
this one, on a real clinic PC with both Clinic Solution and EzDent-i
3.0.10.0 installed (client of a centralized EzWebServer at
`192.168.50.100`). Findings, most important first:

- **CS's own "EzDent-i" button is a blind launch, and always has been.**
  Ran `_watch_ezdenti_linkage.ps1` (modeled on `_watch_vdds_import.ps1`)
  while clicking CS's own EzDent-i button: it launches `VTE232.exe` with a
  **completely empty command line** — no arguments, no `linkage.xml`
  written anywhere first. `VTDebug.txt` shows the same
  `CExternalLink::LoadLinkageSetting - External Link Info: Invalid value`
  warning on **every single logged launch going back to the earliest
  available log entry (July 2024)** — this is not something that broke
  when the PC was relocated between clinics; this specific install has
  most likely never had a working file-based bridge, independent of
  Banana/CS entirely.
- **`VTEzBridge32.exe` (the obvious bridge entry point) does not open a
  window and does not read a sibling `linkage.xml`.** String-extracted its
  binary: it does reference `Linkage.xml`, `strChartNo`, `strFirstName`,
  `strLastName`, `dtBirthdate`, `strGender` — exactly the `E2_PAT`/`E2_IMG`
  database columns seen in its SQL strings — so it's clearly *aware* of
  this data shape. But launching it live, with a real `linkage.xml`
  sibling file already in place in `Bin`, it exits in well under 500ms
  with **no window, no `VTDebug.txt` entry, and the file left completely
  untouched**. It does not spawn `VTE232.exe` either.
- **"Linkage.xml" turned out to be an enum label, not (necessarily) a
  filename this exe reads.** The string sits inside a table of patient
  *import source types* — `Linkage.xml`, `EzPicker`, `EzBridge`,
  `ESSyncro`, `EzDent-i`, `Ez3D-i`, `Migration`, `EzMobile`,
  `DentalServiceWeb` — immediately followed by the same patient field name
  list above. `VTServerConfig.ini` on this same PC has
  `[ezpicker] ip_address = 192.168.50.100` — the *same* central server
  seen throughout `VTDebug.txt`'s DB connection lines — which points at
  "EzPicker" being a **server-side** service, not anything running on a
  client PC. If a `Linkage.xml`-style import path is genuinely wired up
  anywhere on this deployment, the folder it watches is most likely on
  that server, not reachable or knowable from a client-only vantage point.
  Confirming this needs either Vatech support/docs for a centralized
  EzWebServer setup, or direct access to `192.168.50.100` itself.

**Design change as a result** — `Start-EzdentiBridgePatient` no longer
assumes the `linkage.xml` mechanism works:

- It now always opens the real app itself (`$Resolved.target`, e.g.
  `VTE2Loader32.exe` — confirmed live to reliably spawn the visible
  `VTE232.exe` window), the same way `Start-NntBridgePatient` opens NNT.
  Previously it silently did nothing visible if you only looked at the
  screen (by design, matching a "just drop the file, let EzDent-i's own
  loader do the rest" theory) — but since nothing on this deployment
  reads that file, that theory couldn't be relied on. New executables
  fallback order in `$Systems.ezdenti.executables`: `VTE2Loader32.exe` →
  `VTE2Loader_ReqAdmin32.exe` → `VTEzDent-iLoader32.exe` → `VTE232.exe`
  itself as a last resort (matches what CS's own blind launch does, so at
  minimum nothing regresses).
- `VTEzBridge32.exe` was fixed (previously guessed as `VTEzBridge.exe`,
  no `32` suffix — never would have matched on a real install) and moved
  out of the "app to open" list into its own `Resolve-EzdentiBridge`, since
  it must never be treated as "the app" (no window). It's still fired
  best-effort, non-blocking, before the real app opens — pure upside if
  some component really does consume it, silently ignored if not.
- The one thing proven to work every time regardless — copying the
  patient's name + chart no. to the clipboard for manual paste into
  EzDent-i's own search — is unchanged and is now the *primary* documented
  path in the UI text (`app-i18n-extra.js`), with the automatic
  open/create framed honestly as "best-effort, not guaranteed" rather than
  promised outright.
- Self-test: removed the old happy-path unit test for
  `Start-EzdentiBridgePatient` (it used to write a real `linkage.xml` and
  was safe only because the fake target didn't exist; now that the
  function also resolves+fires a *real* `VTEzBridge32.exe` via hardcoded
  fallback paths whenever the target **does** resolve, running that
  end-to-end on a PC where EzDent-i is actually installed — like this one
  — would have popped a real, if invisible, process every routine
  `-SelfTest` run). Replaced with negative-path checks (missing/null
  target → `null`, `Resolve-EzdentiBridge` never launches anything) plus
  an opt-in `-IncludeLiveLaunch` check mirroring NNT's own live-launch
  test. 75/75 passing without `-IncludeLiveLaunch`.

**Also added `tools/README.md`** — the "server side installer package" doc
requested for this: what's in the folder, which files actually need to be
copied to a clinic PC (vs. the internal `_watch_*`/`_census_*`/etc.
investigation-only scripts that don't), step-by-step deploy instructions,
and an honest confirmed-vs-best-effort table per imaging system. The
installer script (`install-xray-bridge.ps1`) itself needed no functional
changes — it already copies whatever's in `xray-local-launcher.ps1`
wholesale and self-tests it, so it covers EzDent-i automatically; only
cosmetic mentions (shortcut description, header comment) were updated to
name it explicitly alongside NNT-NEWTOM.

## 2026-08-19 — EzDent-i (Vatech) bridge: same pattern as NNT, via `linkage.xml`

Wired the "EzDent-i (Vatech)" button in the X-ray tab into the local bridge,
replacing the old `ezdenti://` protocol stub that never actually launched
anything real. Same shape as `nntnewtom`'s `NNTBridge.exe` integration, but
EzDent-i has no documented command-line patient API — every publicly known
PMS bridge (Open Dental, Carestack, MOGO, GoodDrs) instead writes a
`linkage.xml` file into EzDent-i's own program folder (next to
`VTE2Loader32.exe` / `VTEzDent-iLoader32.exe` / `VTEzBridge.exe`)
immediately before launching it. EzDent-i reads that file on startup and
opens the matching chart if the Chart Number already exists, or creates a
new profile from the same fields if it doesn't — no manual typing either
way, for both a brand-new patient and one with existing OPG/CT history on
EzDent-i's own server (Banana never transfers image bytes itself).

Added `New-EzdentiLinkageXml` / `Start-EzdentiBridgePatient` to
`xray-local-launcher.ps1`, wired into `/open/ezdenti` in `Handle-Request`
the same way `nntnewtom` wires into `Start-NntBridgePatient`. `app-xray.js`
now routes `openXraySystem('vatech')` through `openDesktopXrayApp` (the
same local-bridge path as Carestream/Ai-Dental/NNT) with
`launcherKey: 'ezdenti'`, instead of the old `sys.url` protocol-navigation
branch.

**Caveat, same as every other bridge here:** the `LinkageParameter`/`Patient`
XML shape and field mapping (which name goes in `FirstName` vs `LastName`,
chart-number format) is the publicly documented Open Dental contract, not
yet confirmed against a live CS → EzDent-i capture the way NNTBridge's
`/PATID` contract was (see "Decoded CS's `-VDDS PATDATIMPORT`..." below).
Re-verify on a clinic PC where CS → EzDent-i is known-good before trusting
this for patients who already have EzDent-i history — same
`_watch_vdds_import.ps1`-style live trace, watching for `linkage.xml`
instead of a `.tmp` file.

Self-test: 17 new checks (`Convert-GenderWord`, `Escape-Xml`,
`New-EzdentiLinkageXml`, `Start-EzdentiBridgePatient`, `Resolve-System
"ezdenti"`) — 77/77 passing.

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
- EzDent-i (ezdenti): the "open the app + clipboard" half is confirmed
  working live; the automatic `Linkage.xml`/`VTEzBridge32.exe` chart
  open/create is unconfirmed on a centralized-EzWebServer deployment (see
  the 2026-08-19 live-investigation entry above) and needs either Vatech
  support/docs, or access to the EzWebServer machine (`192.168.50.100`
  on the test PC) to pin down where the real import folder/service lives,
  if one exists at all.
- Package this `tools/` folder for actual clinic deployment (README done —
  see entry above); still need to physically run
  `Install X-Ray Bridge.bat` on whichever PC(s) are used to open EzDent-i
  for OPG/CT, and confirm the button in Banana behaves as expected there.
- Same client/server bridge wiring for other x-ray systems (myray,
  Rayscan) — not started.

## 2026-08-24 — CS bill item unit-price spot check (50 cases)

- **Verdict:** REPAIR VERIFIED
- **PASS:** 43/50 (items sum matches bill total within $0.05)
- **Still fixable:** 0 | **Other gap:** 1 | **Warn over:** 5
- **Log:** `tools/logs/cs-bill-item-unit-price-spotcheck.log`
- **CSV:** `tools/logs/cs-bill-item-unit-price-spotcheck.csv`
- **Final cleanup:** +4 bills patched; full scan now **0** auto-fixable remaining
- **Grand total patched:** 7,662 bills (unit-price bug); script: `spot-check-cs-bill-items.py`
