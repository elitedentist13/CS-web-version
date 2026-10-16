# X-ray system patient-handoff references (independent)

Each imaging system owns **one** XML reference file under its installer
package. These are **not** copies of each other and are **not** overwritten
when `build-installer-packages.ps1` syncs the shared engine scripts.

| System | Package folder | Reference (edit here only) |
|---|---|---|
| EzDent-i (Vatech) | [`installer-ezdenti/`](installer-ezdenti/) | [`reference/patient-handoff.reference.xml`](installer-ezdenti/reference/patient-handoff.reference.xml) |
| Rayscan (RAYBridge) | [`installer-rayscan/`](installer-rayscan/) | [`reference/patient-handoff.reference.xml`](installer-rayscan/reference/patient-handoff.reference.xml) |
| NNT-NEWTOM | [`installer-nntnewtom/`](installer-nntnewtom/) | [`reference/patient-handoff.reference.xml`](installer-nntnewtom/reference/patient-handoff.reference.xml) |
| MyRay | [`installer-myray/`](installer-myray/) | [`reference/patient-handoff.reference.xml`](installer-myray/reference/patient-handoff.reference.xml) |
| Digirex (Apixia) | [`installer-digirex/`](installer-digirex/) | [`reference/patient-handoff.reference.xml`](installer-digirex/reference/patient-handoff.reference.xml) |
| Carestream MCP | [`installer-carestream-mcp/`](installer-carestream-mcp/) | [`reference/patient-handoff.reference.xml`](installer-carestream-mcp/reference/patient-handoff.reference.xml) |

## Rules for independent development

1. **Change only that system's reference** when its vendor contract changes.
2. **Do not** copy EzDent `Linkage.xml` fields into Rayscan / Digirex / NNT.
3. Runtime isolation stays `-EnabledSystems <key>` on port `17890`.
4. Prefer `?dry_run=1` in tests so desktop apps do not pop.
5. Shared engine (`tools/xray-local-launcher.ps1`) may still implement several
   handlers; the **contract source of truth for docs/samples** is each
   package's `reference/` file above.

## Verify

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-xray-system-references.ps1
node scripts/xray-system-references-smoke.js
```

Smoke layers: source + HTTP spot + HTML + API (`dry_run=1` only) + CDP `Runtime.evaluate` + live `:5500`.
