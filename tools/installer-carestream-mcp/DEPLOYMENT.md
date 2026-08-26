# DEPLOYMENT CHECKLIST - Carestream MCP Bridge (unified server + client)

## One installer for all PCs

**`Install Carestream MCP Bridge.bat`** auto-detects:

- Reachable SCAN shares (`\\RECEPTION_MCP\IMAGE\SCAN`, `\\CSMAIN\IMAGE\Scan`, etc.)
- Installed Carestream apps (Patient.exe, TW.exe)
- PC role: **xray-server** vs **consultation-client**

It writes **`xray-launcher-config.ps1`** and **`xray-pc-config.js`** for that PC.

See **`tools/XRAY_SERVER_VS_CLIENT.md`** for the full path map.

| PC role | Example hostname | Trophy (TW.exe) | Typical SCAN path |
|---------|------------------|-----------------|-------------------|
| **X-ray server / MCP** | XRAY-MCP, Dr-1-MCP | Yes | `\\RECEPTION_MCP\IMAGE\SCAN` |
| **Consultation client** | DOCTOR-1, nurse PCs | Usually no | `\\CSMAIN\IMAGE\Scan` |

---

## Before Deploying

### 1. Web app

- Load **`xray-pc-config.js`** before `app-xray.js` (already wired in `index.html`)
- Open via **`http://127.0.0.1:5500`** — not `file://` or GitHub Pages
- Hard refresh: **Ctrl+F5**

### 2. Deploy the installer package

**Hand to clinic PCs (either):**
- `tools\Banana-Carestream-MCP-Bridge-Installer.zip` (extract, then install)
- `tools\installer-carestream-mcp\` folder directly

**On each target PC:**
1. `Install Carestream MCP Bridge.bat` → Yes to Administrator
2. Read `C:\BananaBridge-Carestream-MCP\INSTALL-NOTES.txt`
3. Copy `xray-pc-config.js` to Banana web app root if not auto-updated

**Rebuild zip after code changes:**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-installer-carestream-mcp.ps1
```

### 3. Verify Installation

1. Bridge: http://127.0.0.1:17890/status → `"enabled_systems": "carestream,trophy"`
2. Startup shortcut: `Joyful Smile Carestream MCP Bridge.lnk`
3. Banana X-ray tab → Carestream / Trophy buttons

## What This Installer Does

### Auto-detection
- Probes SCAN shares; only configures paths that exist on **this** PC
- Generates per-PC bridge + web app config

### Trophy (server/MCP PCs)
- `TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{patient_no} -NLUI "{name}" -FLUI "{name}"`

### Carestream Patient Browser (all PCs with Patient.exe)

### Installation Details
- Installs to: `C:\BananaBridge-Carestream-MCP`
- Port: 17890
- Auto-starts at login; safe to re-run

## Files in Installer Package

```
installer-carestream-mcp/
├── Install Carestream MCP Bridge.bat
├── install-carestream-mcp.ps1           ← unified auto-detect installer
├── install-xray-bridge.ps1
├── xray-local-launcher.ps1
├── Start / Test / Uninstall *.bat
├── README.md
└── DEPLOYMENT.md
```

## Version Info

- **Updated:** 2026-08-27 — unified server + client auto-detect installer
- **Zip output:** `tools\Banana-Carestream-MCP-Bridge-Installer.zip`

