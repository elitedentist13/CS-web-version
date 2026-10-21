# Banana X-Ray Bridge — Trophy (TW.exe) only

Self-contained installer for **just** Trophy / Carestream CS Imaging
`TW.exe`. Copy this whole folder (or `Banana-Trophy-Bridge-Installer.zip`)
to a PC that opens SCAN charts in TW.exe — the capture PC next to the
panoramic unit, or a consultation PC that has `TW.exe` installed — and the
bridge will answer `/open/trophy` only.

It does **not** open Carestream Patient Browser, NNT, Rayscan, EzDent-i,
MyRay, or Digirex. That limit is `-EnabledSystems trophy` on the bridge
process, not just which files are in this folder.

MCP PCs that need **both** the Carestream button (Patient.exe) and the
Trophy button should keep using
[`../installer-carestream-mcp/`](../installer-carestream-mcp/README.md).
Do not install this package and the Carestream MCP package on the same PC.
Both listen on port **17890**.

## Install

1. Copy this folder onto the target PC.
2. Double-click **`Test Trophy Launcher.bat`**. It should print
   `SELF-TEST PASSED` and does not launch TW.exe.
3. Double-click **`Install Trophy Bridge.bat`**. Click **Yes** if Windows
   asks for Administrator. Installs to `C:\BananaBridge-Trophy`, writes
   SCAN roots for this PC, sets auto-start at login, and starts the bridge.
4. Read `C:\BananaBridge-Trophy\INSTALL-NOTES.txt`.
5. Copy `xray-pc-config.js` from that folder into the Banana web app root
   (same folder as `index.html`) if it was not updated automatically.
6. In Banana: patient → **X-ray** → **Trophy**. Existing SCAN charts open
   in TW.exe. A chart that is not on disk yet is seeded (`SCAN\{chart}\`
   + `FILEDATA.TXT`) and then opened, same order as Clinic Solution.

To remove: double-click **`Uninstall Trophy Bridge.bat`**.
Safe to re-run the installer after a code update.

## Patient handoff reference (this system only)

Owned contract sample:
[`reference/patient-handoff.reference.xml`](reference/patient-handoff.reference.xml)
(TW.exe `-P` `-N` `-F` plus `FILEDATA.TXT` for new charts). Independent of
the Carestream Patient.exe contract in `installer-carestream-mcp`. Index:
[`../xray-system-references.md`](../xray-system-references.md).

## How the handoff works

```
TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\009999 -NSMOKE QUIET -FSMOKE QUIET
```

- **`-P`** — SCAN folder for the chart. Clinic Solution leaves it unquoted
  when the path has no spaces. The chart id is the 6-digit form Banana
  already uses for Trophy (`PL001287` → `001287`, padded when needed).
- **`-N` / `-F`** — glued to the UI label (English, then Chinese when both
  exist), no space and no quotes.
- **New chart** — if that SCAN folder does not exist, the bridge creates it
  and writes `FILEDATA.TXT` (`NUMERO`, `NOM`, `PRENOM`, `DATE`, `EXTNUM`)
  before starting TW.exe. An existing folder is left alone.

`TW.exe` is expected at
`C:\Program Files (x86)\Carestream\CSImaging\TW.exe`
(or the 64-bit `Program Files` path).

## Requirements

- Windows with PowerShell
- Carestream CS Imaging `TW.exe` on this PC
- Network access to the SCAN share detected at install time
  (default fallback `\\RECEPTION_MCP\IMAGE\SCAN` when none is reachable)

## Troubleshooting

- **Trophy button says the launcher is not running**: re-run
  `Start Trophy Launcher.bat` or the installer, then hard-refresh Banana
  (Ctrl+F5). Status: http://127.0.0.1:17890/status — `enabled_systems`
  should be `trophy`.
- **TW.exe not found**: INSTALL-NOTES.txt says so. This package does not
  fall back to Patient.exe. Install CS Imaging, or use the Carestream MCP
  installer on a Patient Browser PC.
- **Wrong SCAN share**: re-run the installer on that PC so
  `xray-launcher-config.ps1` is rewritten from the shares it can actually
  see.
- **Port 17890 already in use**: another bridge is running. Uninstall that
  package before installing this one.
