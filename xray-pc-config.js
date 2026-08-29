/**
 * Per-PC X-ray / Trophy settings (this file is machine-specific).
 *
 * XRAY-MCP = Carestream server workstation (TW.exe + Patient.exe on this PC).
 * SCAN folders live on RECEPTION_MCP, not C:\Image on this machine.
 *
 * Consultation-room PCs: copy xray-pc-config.example-consultation-client.js
 * and adjust paths for that PC's network.
 */
(function () {
  window.XRAY_PC_ROLE = 'xray-server';
  window.XRAY_PC_HOSTNAME = 'XRAY-MCP';

  /* Carestream Trophy F7 — CS SCAN share (on RECEPTION_MCP, not local C:\Image) */
  window.XRAY_TROPHY_SCAN_ROOT = '\\\\RECEPTION_MCP\\IMAGE\\SCAN';
  window.XRAY_TROPHY_SUB_PATTERN = '{clinic_no_numbers_only}';

  /* Banana import folder for this PC (only if you store JPEG exports locally) */
  window.CLINIC_IMAGE_ROOT = 'C:\\Image';

  /* Local bridge — must match tools/xray-local-launcher.ps1 (17890) */
  window.XRAY_LAUNCHER_PORTS = [17890];
  window.XRAY_LAUNCHER_HOSTS = ['127.0.0.1', 'localhost'];
})();
