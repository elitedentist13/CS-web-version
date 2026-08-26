/**
 * Example: consultation-room / client PC (views x-rays, may not have TW.exe).
 * Copy to xray-pc-config.js on each client PC and edit paths.
 */
(function () {
  window.XRAY_PC_ROLE = 'consultation-client';

  /* Client PCs often reach scans via CSMAIN, not RECEPTION_MCP */
  window.XRAY_TROPHY_SCAN_ROOT = '\\\\CSMAIN\\IMAGE\\Scan';
  window.XRAY_TROPHY_SUB_PATTERN = '{patient_no}';

  window.CLINIC_IMAGE_ROOT = 'C:\\Image';
  window.XRAY_LAUNCHER_PORTS = [17890];
})();
