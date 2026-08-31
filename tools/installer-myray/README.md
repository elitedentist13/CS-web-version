# Banana X-Ray Bridge — MyRay (shares CEFLA bridge with NNT/NewTom)

Adds **MyRay** support to the **same** local bridge used by NNT/NewTom.
One process listens on **port 17890** and can open both systems — MyRay does
**not** install a second exclusive launcher that would overwrite or fight
the others.

## Coexistence model

| Rule | Detail |
|---|---|
| One port | Always `127.0.0.1:17890` |
| One install folder | `C:\NNT` (same as NewTom) |
| One auto-start shortcut | `Joyful Smile NNT-NEWTOM Bridge.lnk` |
| Enabled systems | `nntnewtom,myray` together |
| Auto-update task | `Joyful Smile NNT-NEWTOM Bridge - Auto Update` (every 6 h) |

Do **not** run a myray-only bridge and an nnt-only bridge at the same time —
they would fight over 17890. Re-run **Install** below to refresh the shared
bridge so both buttons work.

Carestream / EzDent-i / Rayscan / Trophy keep their own installers; those
packages should not be mixed as exclusive rivals on the same port either.
Use this CEFLA package for NewTom + MyRay.

**Digirex (Apixia) on the same Kwun Tong PC:** after this launcher is
updated, `/open/digirex` is served as a sidecar from **this same
process** when `digirex.exe` is on disk. Login is username `apixia` /
password `digirex`. Do not install `installer-digirex` alongside this
package.

## What's in this folder

| File | Purpose |
|---|---|
| `xray-local-launcher.ps1` | Bridge engine — `/open/myray` and `/open/nntnewtom` |
| `install-xray-bridge.ps1` | Installer (copies engine, auto-start, self-test, registers updater) |
| `xray-bridge-auto-update.ps1` | Auto-check + safe apply from live Banana site |
| `_nnt_identity_guard.ps1` | Patient identity mismatch warning (CEFLA) |
| `_nnt_new_opg_watcher.ps1` | New OPG/CT upload prompt |
| `Install MyRay Bridge.bat` | Install/update shared CEFLA bridge + schedule auto-update |
| `Check MyRay Updates.bat` | Run one update check immediately (manual) |
| `Uninstall MyRay Bridge.bat` | Removes shared auto-start + auto-update task |
| `Start MyRay Launcher.bat` | Manual start (`nntnewtom,myray`) |
| `Test MyRay Launcher.bat` | Side-effect-free self-test |

## Install

1. Copy this folder onto the target PC (or use `..\installer-nntnewtom\` — same CEFLA bridge).
2. Double-click **`Test MyRay Launcher.bat`** — expect `SELF-TEST PASSED`.
3. Double-click **`Install MyRay Bridge.bat`**. Click **Yes** if Windows asks for Administrator.
4. Confirm the install summary shows **Auto-update: every 6 hour(s)**.
5. In Banana: patient → **Consultation → X-ray** → **MyRay** or **NNT / NEWTOM**, and **Digirex (Apixia)** if Apixia is installed on this PC (same bridge; login `apixia` / `digirex`).

### Auto-check / auto-update

After install, Windows Task Scheduler runs:

`Joyful Smile NNT-NEWTOM Bridge - Auto Update`

- First run ~3 minutes after install, then every **6 hours** while the user is logged in
- Fetches from `https://elitedentist13.github.io/CS-web-version/tools/installer-myray/`
- Downloads to temp → parse-check → `-SelfTest` → backup (last 3) → apply → restart → verify `/status`
- On failure: auto-rollback to previous files; network errors leave the live bridge untouched
- Log: `C:\NNT\xray-bridge-update.log`
- State: `C:\NNT\xray-bridge-update-state.json`

Manual check anytime: double-click **`Check MyRay Updates.bat`**.

If an older **myray-only** install at `C:\BananaBridge-MyRay` is still set to
auto-start, remove that startup shortcut so it cannot grab port 17890 first.

## How the patient handoff works

MyRay is CEFLA (same family as NNT/NewTom). Open priority on this clinic
(CS retiring):

1. **MyRay PatDocDB** (`C:\NNT\Shared\PatDocDB.mdb`, chart = `PMSPatientID`)
2. **MyRay files** on `\\CT-PC\IMAGE\Scan\{chart}` (Hyperion main archive)
3. **CS leftovers** only if needed: `\\CSMAIN\IMAGE\Scan` / `\\RECEPTION\IMAGE\SCAN`

It uses `NNTBridge.exe` or `MyRayBridge.exe` with:

```
NNTBridge.exe  /PATID <id>  /NAME <english_name>  /SURNAME <chinese_name>
               /DATEB dd/MM/yyyy  /SEX M|F  /SSNM <hkid>
               /APPPATH <viewer.exe>  /WORKDIR <dir>  /OPENPATIENT
```

| Parameter | Source | Notes |
|---|---|---|
| `/PATID` | Banana `patient_no` | **Clinic prefix stripped** (e.g. `MK005455` → `005455`) |
| `/NAME` | `full_name` | English |
| `/SURNAME` | `chinese_name` | Chinese name in CEFLA surname field |
| `/DATEB` | `dob` | `dd/MM/yyyy` |
| `/SEX` | `sex` | `M` / `F` |
| `/SSNM` | `hkid` | Optional |
| `/DIR` | CEFLA SCAN folder | **Required for existing x-rays** — chart folder e.g. `\\CSMAIN\IMAGE\Scan\005455`. Without this, MyRay/NNT opens the patient but images stay disconnected. |

**New patients:** fields pre-filled. **Old patients:** bare chart number matches, and `/DIR` attaches the on-disk Document / OPG store. Close any already-open NNT/MyRay window first (the bridge does this automatically).

### Bridge executable search order

1. `MyRayBridge.exe` next to the resolved viewer
2. `NNTBridge.exe` in the same folder (typical when `MyRay.lnk` → `C:\NNT\NNT.exe`)
3. Common `C:\MyRay\…` / `C:\Program Files\…\MyRay\…` paths

## Troubleshooting

- **Patient opens but x-rays blank**: usually `/DIR` was pointed at an **empty**
  `SCAN\{chart}\Document` folder (NNT then shows a blank archive). The bridge now
  only passes `/DIR` when `.2dh`/image studies exist; otherwise it opens by
  `/PATID` from NNT's own database. Restart the launcher after updating, then
  retry. Also confirm `http://127.0.0.1:17890/status` lists `nntnewtom,myray`.
- **Port 17890 in use**: another bridge is already up. Check
  `http://127.0.0.1:17890/status` — `enabled_systems` should include both
  `myray` and `nntnewtom`. If only one is listed, re-run Install.
- **`/workstation` 404**: normal — that path is for the audit agent, not this bridge.
- **MyRay button no response in browser**: open `index.html` (not a standalone diag page), hard-refresh, select a patient first.
