# Carestream MCP Bridge Installer

**For: Dr-1-MCP, RECEPTION_MCP, and Cbct-pc computers using Carestream CS Imaging**

This installer package sets up the Banana X-Ray bridge for Carestream systems, including:
- **Carestream Patient Browser** (Patient.exe) - Opens from patient list
- **Trophy/TW.exe** (Clinic Solution "Trophy F7" equivalent) - Opens patient's SCAN folder

## What Gets Installed

1. Bridge files copied to: `C:\BananaBridge-Carestream-MCP`
2. Auto-start shortcut: `Startup\Joyful Smile Carestream MCP Bridge.lnk`
3. Bridge runs on port: `17890` (http://127.0.0.1:17890)

## Installation Instructions

### Option A: Quick Install (Recommended)
1. Copy the entire `installer-carestream-mcp` folder to the target computer
2. Double-click **`Install Carestream MCP Bridge.bat`**
3. If Windows asks for Administrator, click **Yes** (enables auto-start for all users)
4. Wait for "installed OK" message
5. Done! Bridge is running and will auto-start at every login

### Option B: Manual Start (Testing Only)
1. Copy the folder to the target computer
2. Double-click **`Start Carestream MCP Launcher.bat`**
3. Keep the window open while testing
4. This does NOT auto-start at login (for testing only)

## Uninstall

1. Double-click **`Uninstall Carestream MCP Bridge.bat`**
2. Removes auto-start shortcuts and stops the bridge
3. Files in `C:\BananaBridge-Carestream-MCP` remain (safe to delete manually)

## Features

### Trophy F7 Integration (NEW - 2026-08-27)
- **Same behavior as Clinic Solution's Trophy F7 button**
- Launches TW.exe with patient's SCAN folder from CS server
- Command line: `TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{patient_no} -NLUI "{name}" -FLUI "{name}"`
- Requires network access to `\\RECEPTION_MCP\IMAGE\SCAN`

### Carestream Patient Browser
- Opens Patient.exe for the selected patient
- Standard Carestream workflow

## Requirements

- **Carestream CS Imaging** installed (Patient.exe and/or TW.exe)
- Network access to `\\RECEPTION_MCP\IMAGE\SCAN` (for Trophy)
- Windows 7 or later
- PowerShell (pre-installed on Windows)

## Troubleshooting

### Bridge Not Responding
1. Check if running: http://127.0.0.1:17890/status
2. If not running, manually start: `Start Carestream MCP Launcher.bat`
3. Check for errors in the bridge window

### Trophy Button Not Working
1. Verify TW.exe is installed: `C:\Program Files (x86)\Carestream\CSImaging\TW.exe`
2. Check network access: Open `\\RECEPTION_MCP\IMAGE\SCAN` in Explorer
3. Check patient folder exists: `\\RECEPTION_MCP\IMAGE\SCAN\{patient_no}`

### Port Already in Use
- Another program is using port 17890
- Stop the other program or edit the bat file to use a different port
- Also update `XRAY_LAUNCHER_PORT` in `app-xray.js` to match

## Files in This Package

```
installer-carestream-mcp/
├── Install Carestream MCP Bridge.bat    ← Run this to install
├── Start Carestream MCP Launcher.bat    ← Manual start (testing)
├── Uninstall Carestream MCP Bridge.bat  ← Remove installation
├── xray-local-launcher.ps1              ← Bridge engine (with Trophy support)
├── install-xray-bridge.ps1              ← Installation script
└── README.md                            ← This file
```

## Deployment Notes

**For Dr-1-MCP / RECEPTION_MCP / Cbct-pc:**
- These are the primary computers with Carestream installed
- Trophy button requires the SCAN folder to be accessible
- Install on all computers that need to open X-ray images

**For Other Clinic PCs:**
- If they only VIEW images (don't need Trophy), use the Patient Browser only
- Or use the main `tools\` installer for multiple systems

## Version

- **Last Updated:** 2026-08-27
- **Trophy Integration:** Working
- **Bridge Port:** 17890 (standard)
- **Tested On:** Dr-1-MCP with Carestream CSImaging + TW.exe
