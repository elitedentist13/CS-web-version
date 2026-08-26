# Carestream MCP Bridge Installer

**Unified package for x-ray SERVER and consultation CLIENT PCs**

This installer auto-detects your PC type and configures the correct SCAN paths:

| Detected role | Typical PC | Trophy (TW.exe) | SCAN path |
|---------------|------------|-------------------|-----------|
| **xray-server** | XRAY-MCP, Dr-1-MCP | Yes | `\\RECEPTION_MCP\IMAGE\SCAN` |
| **consultation-client** | DOCTOR-1, nurse PCs | Usually Patient.exe only | `\\CSMAIN\IMAGE\Scan` |

## What Gets Installed

1. Bridge files copied to: `C:\BananaBridge-Carestream-MCP`
2. Auto-generated **`xray-launcher-config.ps1`** (bridge SCAN roots for this PC)
3. Auto-generated **`xray-pc-config.js`** — copy to your Banana web app folder (same folder as `index.html`)
4. Auto-start shortcut: `Startup\Joyful Smile Carestream MCP Bridge.lnk`
5. Bridge runs on port: `17890` (http://127.0.0.1:17890)

## Installation Instructions

### Quick Install (Recommended)
1. Copy the entire `installer-carestream-mcp` folder (or extract the zip) to the target computer
2. Double-click **`Install Carestream MCP Bridge.bat`**
3. If Windows asks for Administrator, click **Yes**
4. Read **`C:\BananaBridge-Carestream-MCP\INSTALL-NOTES.txt`** for detected role and next steps
5. Copy **`xray-pc-config.js`** from the install folder into your Banana web app root (if not auto-updated)

### Manual Start (Testing Only)
1. Double-click **`Start Carestream MCP Launcher.bat`**
2. Keep the window open while testing — does NOT auto-start at login

## Uninstall

1. Double-click **`Uninstall Carestream MCP Bridge.bat`**
2. Removes auto-start shortcuts and stops the bridge
3. Files in `C:\BananaBridge-Carestream-MCP` remain (safe to delete manually)

## Features

### Auto-detection (NEW)
- Probes reachable SCAN shares: `RECEPTION_MCP`, `CSMAIN`, local `C:\Image\SCAN`
- Detects Carestream **Patient.exe** and **TW.exe**
- Writes per-PC config — one installer zip for all clinic PCs

### Trophy F7 Integration
- Same behavior as Clinic Solution's Trophy F7 button on server/MCP PCs
- Launches: `TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{patient_no} -NLUI "{name}" -FLUI "{name}"`

### Carestream Patient Browser
- Opens Patient.exe for the selected patient (all PCs with Carestream installed)

## Requirements

- **Carestream CS Imaging** (Patient.exe and/or TW.exe depending on PC role)
- Network access to the SCAN share detected for this PC
- Windows 7 or later, PowerShell pre-installed

## Troubleshooting

### Bridge Not Responding
1. Check: http://127.0.0.1:17890/status
2. Manual start: `Start Carestream MCP Launcher.bat`
3. Read `INSTALL-NOTES.txt` in `C:\BananaBridge-Carestream-MCP`

### Trophy Button Not Working (server PCs)
1. Verify TW.exe: `C:\Program Files (x86)\Carestream\CSImaging\TW.exe`
2. Verify SCAN share in Explorer (path shown in INSTALL-NOTES.txt)
3. Open Banana via `http://127.0.0.1:5500` — not `file://` or GitHub Pages

### Banana Says "Launcher Not Running"
1. Hard refresh **Ctrl+F5**
2. Chrome: allow local network access for localhost
3. Ensure `xray-pc-config.js` matches this PC (re-run installer if unsure)

## Files in This Package

```
installer-carestream-mcp/
├── Install Carestream MCP Bridge.bat    ← Run this (auto-detects server vs client)
├── install-carestream-mcp.ps1           ← Unified installer script
├── install-xray-bridge.ps1              ← Bridge file copy + auto-start
├── xray-local-launcher.ps1              ← Bridge engine
├── Start / Test / Uninstall *.bat
├── README.md
└── DEPLOYMENT.md
```

## Version

- **Last Updated:** 2026-08-27
- **Unified server + client installer**
- **Bridge Port:** 17890

