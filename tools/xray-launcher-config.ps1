# Per-PC bridge config — loaded automatically by xray-local-launcher.ps1
# This clinic's CS SCAN share is \\RECEPTION\IMAGE\SCAN (not RECEPTION_MCP).

$script:NntScanRootsOverride = @(
    "\\RECEPTION\IMAGE\SCAN",
    "\\RECEPTION_MCP\IMAGE\SCAN",
    "\\CSMAIN\IMAGE\Scan"
)
