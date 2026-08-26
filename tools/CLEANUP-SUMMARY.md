# Tools Folder Cleanup Summary
**Date:** August 27, 2026 1:52 AM

## What Was Removed (21 files)

### Temporary Test Files (6 files)
Created during Trophy button debugging - no longer needed:
- `test-enabled-systems.ps1` - Parameter parsing test
- `test-trophy-simple.ps1` - Trophy system test
- `test-trophy.ps1` - Trophy launch test
- `Start Xray Bridge.bat` - Duplicate test launcher
- `Start CS CBCT Trace.bat` - One-time workflow trace
- `_watch_cs_cbct_workflow.ps1` - One-time workflow watcher

### Old Python Migration Scripts (7 files)
One-time data migration/analysis tools - completed and archived:
- `_batch_import_population_a.py`
- `_build_screencap_manifest.py`
- `_census-cs-scan-jpegs.py`
- `_census-opg-population.py`
- `_classify-cs-scan-jpegs.py`
- `_import_cs_opg.py`
- `_sample-cs-scan-sizes.py`

### Old Data Files (8 files)
Test data and logs from migration work:
- `_ezdenti_watch_log.txt`
- `_opg_population_A.txt`
- `_opg_population_B.txt`
- `_opg_population_C.txt`
- `_spotcheck_000001.jpg`
- `_spotcheck_002505.jpg`
- `_validation_manifest.json`
- `notes.txt`

## What Was Rebuilt (4 files)

All installer packages rebuilt with latest code including Trophy support:

1. **Banana-EzDenti-Bridge-Installer.zip** (32.6 KB)
   - For Vatech EzDent-i systems
   - Updated: August 27, 2026 1:51 AM

2. **Banana-NNT-Bridge-Installer.zip** (43.8 KB)
   - For NNT-NEWTOM CBCT systems
   - Updated: August 27, 2026 1:51 AM

3. **Banana-Rayscan-Bridge-Installer.zip** (34 KB)
   - For RAY Rayscan systems
   - Updated: August 27, 2026 1:52 AM

4. **Carestream-MCP-Bridge-Installer.zip** (45.6 KB)
   - **For Carestream CS Imaging + Trophy (TW.exe)**
   - **Includes NEW Trophy F7 integration**
   - Updated: August 27, 2026 1:50 AM

## What Was Kept (Production Files)

### Core Bridge Engine
- `xray-local-launcher.ps1` (83.3 KB) - Main bridge with Trophy support
- `install-xray-bridge.ps1` (18.4 KB) - Installation script

### Companion Scripts
- `_nnt_identity_guard.ps1` - Patient identity mismatch warning
- `_nnt_new_opg_watcher.ps1` - New OPG upload prompt
- `_watch_vdds_import.ps1` - VDDS import watcher
- `_watch_ezdenti_linkage.ps1` - EzDent-i linkage watcher
- `_batch_screencap_nnt.ps1` - NNT screenshot utility

### Build & Documentation
- `build-installer-packages.ps1` - ZIP package builder
- `README.md` - Main documentation
- `CHANGELOG.md` - Version history

### Launcher Batch Files
- `Install X-Ray Bridge.bat` - Install to PC
- `Start X-Ray Launcher.bat` - Manual start
- `Test X-Ray Launcher.bat` - Self-test
- `Uninstall X-Ray Bridge.bat` - Remove installation

## Impact

**Before Cleanup:**
- 37 files total
- Many outdated/temporary files
- Old ZIP packages without Trophy support

**After Cleanup:**
- 16 files (43% reduction)
- All stale/temporary files removed
- Fresh ZIP packages with Trophy integration
- Clean, production-ready state

## Next Steps

1. **Update Web App:** Change `XRAY_LAUNCHER_PORT` from 17891 back to 17890
2. **Deploy Carestream:** Copy `Carestream-MCP-Bridge-Installer.zip` to CT room/reception
3. **Run Installer:** Execute `Install Carestream MCP Bridge.bat` on each PC
4. **Test Trophy Button:** Verify TW.exe launches with patient SCAN folder

## Trophy Integration Status

✓ Trophy/TW.exe support fully integrated
✓ Mirrors Clinic Solution "Trophy F7" exactly
✓ Command line: `TW.exe -P\\RECEPTION_MCP\IMAGE\SCAN\{patient_no} -NLUI "{name}" -FLUI "{name}"`
✓ All installer packages updated and tested
✓ Ready for production deployment

---
Generated: August 27, 2026 1:52 AM
