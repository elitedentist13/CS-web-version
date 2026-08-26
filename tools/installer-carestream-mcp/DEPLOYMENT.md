# DEPLOYMENT CHECKLIST - Carestream MCP Bridge with Trophy Support

## Before Deploying to CT Room / Reception Computers

### 1. Update Web App to Use Standard Port (IMPORTANT!)

The web app is currently set to port **17891** for testing. Change it back to **17890** for deployment:

**File:** `app-xray.js` (line ~2223)

```javascript
// Change this:
var XRAY_LAUNCHER_PORT = 17891;  // Temporarily using 17891...

// Back to this:
var XRAY_LAUNCHER_PORT = 17890;
```

**Also update:** `index.html` BUILD variable (refresh cache)

### 2. Deploy the Installer Package

**Copy this folder to target computers:**
```
tools\installer-carestream-mcp\
```

**Run on each target PC:**
1. `Install Carestream MCP Bridge.bat`
2. Click "Yes" if Windows asks for Administrator
3. Wait for "installed OK" message

**Target computers:**
- Dr-1-MCP (CT room)
- RECEPTION_MCP (reception desk)
- Any consultation PC with Carestream

### 3. Verify Installation

**On each PC, check:**
1. Bridge status: http://127.0.0.1:17890/status
2. Should show: `"enabled_systems": "carestream,trophy"`
3. Auto-start shortcut exists: `Startup\Joyful Smile Carestream MCP Bridge.lnk`

**In Banana web app:**
1. Hard refresh (Ctrl+F5)
2. Open a patient
3. Go to X-ray tab
4. Click **Trophy** button
5. TW.exe should launch with patient's SCAN folder

## What This Installer Does

### Trophy Integration (NEW)
- Replicates Clinic Solution's "Trophy F7" button exactly
- Launches: `TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{patient_no} -NLUI "{name}" -FLUI "{name}"`
- Requires network access to `\\RECEPTION_MCP\IMAGE\SCAN`

### Carestream Patient Browser
- Opens Patient.exe for selected patient
- Standard Carestream workflow

### Installation Details
- Installs to: `C:\BananaBridge-Carestream-MCP`
- Port: 17890 (matches `XRAY_LAUNCHER_PORT` in web app)
- Auto-starts at login for all users
- Safe to re-run (updates files without breaking anything)

## Troubleshooting

### Port 17890 Already in Use
If you see "port already in use" error:
1. Check what's using it: `netstat -ano | findstr :17890`
2. Stop the old process
3. Re-run the installer

### Trophy Button Not Responding
1. Check TW.exe exists: `C:\Program Files (x86)\Carestream\CSImaging\TW.exe`
2. Test network access: Open `\\RECEPTION_MCP\IMAGE\SCAN` in Explorer
3. Check bridge: http://127.0.0.1:17890/status
4. Look for errors in bridge window

### Web App Still Using Port 17891
- Remember to change `XRAY_LAUNCHER_PORT = 17890` in `app-xray.js`
- Hard refresh browser (Ctrl+F5) after updating

## Files in Installer Package

```
installer-carestream-mcp/
├── Install Carestream MCP Bridge.bat      ← Run this to install
├── Test Carestream MCP Launcher.bat       ← Test before installing
├── Start Carestream MCP Launcher.bat      ← Manual start (testing only)
├── Uninstall Carestream MCP Bridge.bat    ← Remove installation
├── xray-local-launcher.ps1                ← Bridge engine (85KB, with Trophy)
├── install-xray-bridge.ps1                ← Installation script
├── _nnt_identity_guard.ps1                ← Companion script
├── _nnt_new_opg_watcher.ps1               ← Companion script
└── README.md                              ← User documentation
```

## Testing Before Deployment

**On your development PC (optional):**
1. `Test Carestream MCP Launcher.bat` - should show "SELF-TEST PASSED"
2. This verifies the scripts have no syntax errors

## Version Info

- **Created:** 2026-08-27 1:33 AM
- **Trophy Support:** Working
- **Tested On:** Dr-1-MCP with Carestream CSImaging + TW.exe
- **Command Line:** Traced from live Clinic Solution workflow
