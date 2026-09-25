# Research index

Research notes, contracts and evidence for XF Studio and related Cyberpunk 2077 modding work. **Start with the [ranked work queue](backlog/README.md)**, which links each track to its owner document. Extracted game/mod resources stay local and ignored; tracked notes record paths, hashes, tool versions and conclusions only. Offline evidence is never presented as in-game proof.

## Folders

| Folder | Contents |
|---|---|
| [backlog/](backlog/README.md) | Ranked queue and per-track requirement documents (open vs done). The source of truth for what has been requested. |
| [authoring/](authoring/) | XF Studio contracts, architecture/UI boundary, editor feature contracts, packaging pipeline, desktop packaging, acceptance records. |
| [materials/](materials/) | Makeup finish taxonomy, REDengine shader/material studies, preset compiler contract, glitter/glossy/colour-shift studies. |
| [eye-artistry/](eye-artistry/) | Saved-V import and resource resolution (eyes, brows, lashes, hair, skin), preview fidelity audits, Eye Artistry lineage. |
| [character-customization/](character-customization/) | CC file-chain map, CCXL merge boundary, read-only catalogue probe, portable mod-source resolution. |
| [animation/](animation/) | Character-creator idle playback, idle control design, brow idle gap. |
| [jewellery/](jewellery/) | Vanilla piercing preview, PRC inventory/preview/catalogue audit, jewellery construction-set proposal, earring references. |
| [runtime/](runtime/runtime-bridge-design.md) | Runtime access: base mods per mod type, the local bridge design, the agent autonomy capability matrix and the bridge test card. |
| [archive-xl/](archive-xl/) | ArchiveXL expansion strategy (legacy matrix lessons) and pinned upstream source notes. |
| [consumers/](consumers/README.md) | Locally extracted third-party resources for research (payloads ignored; manifests/notes tracked). |

## Key contract documents

These are maintained contracts: update them in the same checkpoint as the code they describe.

| Contract | Document |
|---|---|
| XF Studio architecture (domain / device / presentation boundary) | [authoring/architecture-contract.md](authoring/architecture-contract.md) |
| Current boundary state, recorded exceptions and open API gaps | [authoring/ui-architecture-boundary.md](authoring/ui-architecture-boundary.md) |
| Action and capability catalogue | [authoring/ui-action-catalogue.md](authoring/ui-action-catalogue.md), [authoring/ui-capability-inventory.md](authoring/ui-capability-inventory.md) |
| UI workspace preferences (theme, dock layout envelope, recovery) | [authoring/ui-workspace-preferences.md](authoring/ui-workspace-preferences.md) |
| UI overhaul delivery record and audit | [authoring/ui-overhaul-2026-09-24.md](authoring/ui-overhaul-2026-09-24.md) |
| Studio → mod pipeline (Check/Build, verification, manifest, promotion) | [authoring/studio-to-mod-pipeline.md](authoring/studio-to-mod-pipeline.md) |
| Partial export / finish filter | [authoring/partial-mod-export-checkpoint.md](authoring/partial-mod-export-checkpoint.md) |
| First in-game smoke test card | [authoring/first-makeup-runtime-preflight-2026-09-25.md](authoring/first-makeup-runtime-preflight-2026-09-25.md) |
| Preview quality | [authoring/preview-quality-contract.md](authoring/preview-quality-contract.md) |
| Raster performance and scheduling | [authoring/raster-performance.md](authoring/raster-performance.md) |
| Directional softness (recipe-6) | [authoring/directional-softness-contract.md](authoring/directional-softness-contract.md) |
| Whole-shape gestures and UV navigation | [authoring/shape-gesture-contract.md](authoring/shape-gesture-contract.md) |
| Projected Bézier tangent controls | [authoring/projected-tangent-controls.md](authoring/projected-tangent-controls.md) |
| Desktop packaging and updater gate | [authoring/desktop-packaging.md](authoring/desktop-packaging.md), [authoring/desktop-update-ab-gate.md](authoring/desktop-update-ab-gate.md) |
| Flat preset compiler and mesh-decal shader contract | [materials/preset-compiler-contract.md](materials/preset-compiler-contract.md), [materials/mesh-decal-shader-contract.md](materials/mesh-decal-shader-contract.md) |
| Makeup finish families | [materials/makeup-finish-taxonomy.md](materials/makeup-finish-taxonomy.md) |
| Glitter implementation contract | [materials/glitter-implementation-contract.md](materials/glitter-implementation-contract.md) |
| CC file chain | [character-customization/file-chain-map.md](character-customization/file-chain-map.md) |

Related top-level documents: [repository README](../README.md), [project status](../docs/status.md), [developer orientation](../docs/developer-orientation.md), [validation](../docs/validation.md), [community credits](../docs/community-credits.md). Experiments live under [experiments/](../experiments/).
