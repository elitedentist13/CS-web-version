# DEPLOYMENT - Trophy Bridge (TW.exe only)

Use this package when the PC should open **Trophy / TW.exe** and should
not serve the Carestream Patient Browser button.

| PC | Installer | enabled_systems |
|----|-----------|-----------------|
| Capture PC with TW.exe only | **this folder** | `trophy` |
| MCP PC that needs Carestream and Trophy | `installer-carestream-mcp` | `carestream,trophy` |

Do not install both on one PC. Port 17890 can host one bridge.

## Deploy

1. Copy `tools\installer-trophy\` (or the zip from
   `build-installer-packages.ps1`) to the PC.
2. Run `Test Trophy Launcher.bat` — expect self-test passed.
3. Run `Install Trophy Bridge.bat`. Accept Administrator if asked.
4. Open http://127.0.0.1:17890/status and confirm `trophy` is enabled.
5. Copy `C:\BananaBridge-Trophy\xray-pc-config.js` into the Banana web
   root if the installer did not update it.
6. Hard-refresh Banana and click **Trophy** on a patient.

Install path: `C:\BananaBridge-Trophy`  
Startup shortcut: `Joyful Smile Trophy Bridge.lnk`

## Remove

`Uninstall Trophy Bridge.bat` stops the bridge and removes the shortcut.
Files under `C:\BananaBridge-Trophy` stay until deleted by hand.
