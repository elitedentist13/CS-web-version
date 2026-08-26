# X-Ray bridge: server vs consultation client

This clinic uses **two different PC roles**. Paths are **not** the same on every computer.

## This PC: XRAY-MCP (Carestream server workstation)

| Item | Path / value |
|------|----------------|
| Hostname | `XRAY-MCP` (192.168.50.221) |
| TW.exe | `C:\Program Files (x86)\Carestream\CSImaging\TW.exe` |
| Patient Browser | `C:\Program Files (x86)\Carestream\Patient Browser\Patient.exe` |
| Trophy SCAN share | `\\RECEPTION_MCP\IMAGE\SCAN\{patient_no}` |
| SCAN server | `RECEPTION_MCP` (192.168.50.114) — **not** local `C:\Image` |
| Bridge port | `17890` → http://127.0.0.1:17890/status |
| Install path | `C:\BananaBridge-Carestream-MCP` |

**Browser config:** `xray-pc-config.js` (already set for this server)

**Bridge config:** `tools\xray-launcher-config.ps1`

## Consultation-room / client PCs

| Item | Typical path |
|------|----------------|
| Role | View x-rays; may **not** have TW.exe |
| SCAN share | Often `\\CSMAIN\IMAGE\Scan` (check from that PC in Explorer) |
| Local import folder | `C:\Image\Xrays\{patient_no}` |
| Bridge | Same port 17890, install `tools\installer-carestream-mcp\` **or** full `tools\` |

Copy and edit on each client PC:

- `xray-pc-config.example-consultation-client.js` → `xray-pc-config.js`
- `tools\xray-launcher-config.example-consultation-client.ps1` → `tools\xray-launcher-config.ps1`

## Daily workflow (XRAY-MCP server)

1. **Start bridge** (once per login, or use installed auto-start):
   - Double-click `start-xray-launcher.bat` in the web app folder, **or**
   - `tools\Start X-Ray Launcher.bat`, **or**
   - Startup shortcut: `Joyful Smile Carestream MCP Bridge.lnk`
2. **Start Banana:** `npm start` → http://127.0.0.1:5500/index.html
3. **Hard refresh** after updates: Ctrl+F5
4. Open patient → **X-ray** tab → **Trophy**
   - Confirms launcher running → TW.exe opens with `\\RECEPTION_MCP\IMAGE\SCAN\{no}`

## Install / re-install bridge on this server

```
tools\installer-carestream-mcp\Install Carestream MCP Bridge.bat
```

(Carestream + Trophy only; port 17890; copies config alongside launcher.)

## Verify

```powershell
Invoke-WebRequest http://127.0.0.1:17890/status -UseBasicParsing
# trophy_exists: true, carestream_exists: true

Test-Path "\\RECEPTION_MCP\IMAGE\SCAN"
# True on XRAY-MCP
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Launcher not running" | Run `start-xray-launcher.bat`; check http://127.0.0.1:17890/status |
| Browser can't reach bridge | Chrome → Allow **local network access** for this site; Ctrl+F5 |
| Trophy opens wrong folder | Edit `xray-pc-config.js` + `tools\xray-launcher-config.ps1`; clear `localStorage` key `jsm_xray_local_paths_v1` |
| Client PC has no TW.exe | Use **Carestream** button only; Trophy is for MCP/server PCs with CSImaging |
