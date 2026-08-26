# Example: consultation-room client PC — copy to xray-launcher-config.ps1
# Client PCs may use CSMAIN share; Trophy/TW.exe may not be installed.

$script:NntScanRootsOverride = @(
    "\\CSMAIN\IMAGE\Scan",
    "\\RECEPTION_MCP\IMAGE\SCAN",
    "C:\Image\SCAN"
)
