/**
 * Per-PC X-ray / Trophy settings — XRAY-MCP server workstation.
 * SCAN folders on RECEPTION_MCP; TW.exe runs on this PC.
 */
(function () {
  window.XRAY_PC_ROLE = 'xray-server';
  window.XRAY_PC_HOSTNAME = 'XRAY-MCP';
  window.XRAY_TROPHY_SCAN_ROOT = '\\\\RECEPTION_MCP\\IMAGE\\SCAN';
  window.XRAY_TROPHY_SUB_PATTERN = '{patient_no}';
  window.CLINIC_IMAGE_ROOT = 'C:\\Image';
  window.XRAY_LAUNCHER_PORTS = [17891, 17890];
  window.XRAY_LAUNCHER_HOSTS = ['127.0.0.1', 'localhost'];
})();
