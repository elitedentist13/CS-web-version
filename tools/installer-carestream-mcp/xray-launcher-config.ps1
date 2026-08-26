# Per-PC bridge config — loaded automatically by xray-local-launcher.ps1
# XRAY-MCP server: Trophy TW.exe runs here; SCAN data on RECEPTION_MCP share.

$script:NntScanRootsOverride = @(
    "\\RECEPTION_MCP\IMAGE\SCAN"
)

# Optional: restrict which /open/* keys this bridge handles (installer sets via -EnabledSystems)
# $EnabledSystems = @("carestream", "trophy")
