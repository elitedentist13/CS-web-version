# Optional per-PC overrides. Copy to xray-launcher-config.ps1 next to the
# installed launcher (C:\BananaBridge-Digirex) only if you need to change
# the Digirex login or exe path. Defaults already match this clinic.

# Confirmed live 2026-08-31 (Apixia NETWORK 3.0):
$script:DigirexDentistId = "apixia"
$script:DigirexDentistPassword = "digirex"

# $script:DigirexExePath = "C:\DIGIREX\digirex.exe"
# $script:DigirexDataRoots = @("C:\DIGIREX\DATA")

# Switch.ini is written using this PC's own ANSI code page by default
# (Big5/950 on HK-locale Windows -- matches Apixia's legacy, non-Unicode
# INI reader). Only set this if a specific clinic's Digirex build needs a
# different code page for Traditional/Simplified Chinese chart names:
# $script:DigirexIniEncoding = [System.Text.Encoding]::GetEncoding(950)   # Big5 (explicit)
# $script:DigirexIniEncoding = [System.Text.Encoding]::GetEncoding(936)   # GBK / Simplified Chinese
