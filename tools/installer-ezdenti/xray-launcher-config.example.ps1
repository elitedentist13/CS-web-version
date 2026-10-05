# Optional. Copy to xray-launcher-config.ps1 next to the installed
# EzDent-i launcher (C:\BananaBridge-EzDenti) only if you need overrides.
# Digirex is a sidecar on this same bridge when digirex.exe is on disk.

# Confirmed live 2026-08-31 (Apixia NETWORK 3.0):
$script:DigirexDentistId = "apixia"
$script:DigirexDentistPassword = "digirex"

# $script:DigirexExePath = "C:\DIGIREX\digirex.exe"
# $script:DigirexDataRoots = @("C:\DIGIREX\DATA")

# EzDent-i loader, if it is not under Program Files\VATECH\EzDent-i\Bin
# and there is no Start Menu shortcut. File or install folder both work.
# $script:EzdentiExePath = "D:\VATECH\EzDent-i\Bin\VTE2Loader32.exe"
