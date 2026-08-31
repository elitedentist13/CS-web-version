# Example: consultation-room client PC — copy to xray-launcher-config.ps1
# Client PCs may use CSMAIN share; Trophy/TW.exe may not be installed.

$script:NntScanRootsOverride = @(
    "\\CSMAIN\IMAGE\Scan",
    "\\RECEPTION_MCP\IMAGE\SCAN",
    "C:\Image\SCAN"
)

# Optional Apixia Digirex overrides (only if auto-detect misses a relocated install).
# $script:DigirexExePath = "C:\Program Files\Digirex\digirex.exe"
# $script:DigirexDataRoots = @("C:\Program Files\Digirex\DATA")
# $script:DigirexDentistId = "apixia"
# $script:DigirexDentistPassword = "digirex"
