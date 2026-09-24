# CCXL and the character creator's unexplored capabilities

## Status (25 Sep 2026)

Queued explicit request from Nathan (23 September), **track 8** in the [ranked queue](README.md). Keep it; pull findings forward when they unblock [CC controls and presets](cc-controls-and-presets.md) (track 3) or the [CC file-chain study](cc-file-chain.md) (track 5).

- **Done:** source and resource merge boundary mapped for ArchiveXL 1.27.3 ([merge boundary](../character-customization/ccxl-merge-boundary.md), [wiki file-chain map](../character-customization/file-chain-map.md)); read-only [catalogue probe](../character-customization/catalog-prototype.md) normalises vanilla plus one mod-added customisation resource.
- **Open:** creator implementation trace (step 2), extension-hook audit (3), production-consumer study (4), capability matrix (5), prototypes (6), published conclusions (7). One-selector A/B/Off save and display behaviour needs the batched game probe (the first smoke test covers selector registration, clearing and persistence).

Preserve findings/prototypes in this headquarters; coordinate with XF Studio rather than postponing the eye-makeup pipeline.

## Objective

Explain precisely what CCXL adds to ArchiveXL and how the complete character creator is implemented. Find credible, useful capabilities that existing mods have not widely exposed. Separate things supported by resource data, game scripts, scripting extensions, native hooks and renderer/UI constraints. The intended outcome is discovery backed by working probes, not a speculative feature list.

Initial verified orientation: CCXL is ArchiveXL's character-customization feature family, not a separate scripting language. ArchiveXL is a native RED4ext plugin with a `Customization` extension and cooperating resource/mesh extensions. RED4ext is the native extension host/SDK; redscript is the game scripting/compiler layer; CET supplies a Lua runtime/observation interface; Codeware extends accessible scripting/runtime facilities. Trace actual paths before deciding which layer a feature needs.

The current 1.27.3 source merges sex-specific `.inkcharcustomization` declarations into existing native head/body/arms groups in two passes: named options first, then anonymous `uiSlot`/link overlays. Existing option overlays merge choice arrays, not all layout/visibility/default metadata. New options may carry such metadata, but the extension does not create a new top-level group. Native SDK fields are not evidence that ArchiveXL merges or the UI renders them. The [pinned merge-boundary note](../character-customization/ccxl-merge-boundary.md) and [wiki file-chain map](../character-customization/file-chain-map.md) give source and screenshot evidence. One-selector A/B/Off save and display behavior still needs the planned batched game probe.

## Investigation sequence

1. **Map the ownership and data flow.** From `.xl customizations` through `.inkcharcustomization`, option groups/switchers/appearance and morph definitions, `.app` components, resource scopes, mesh/material expansion and the final UI. Include localization, icons/atlases, TweakDB records, randomization, persistence and the difference between initial creation, mirrors/ripperdoc customization and NPC/photo-mode actors.
2. **Trace the creator implementation.** Locate native RTTI classes and current game script/UI classes, input contexts, controllers, data sources, widget layouts, update events and save serialization. Label evidence from actual game files versus SDK declarations and third-party examples. Obtain current game script dumps/decompilation only into research output; do not assume old May 2025 RTTI dumps match 2.31.
3. **Audit extension hooks.** ArchiveXL Customization/ResourceMeta/ResourceLink/Mesh/Garment, Codeware reflection/UI/resource/event facilities, redscript wrapping/replacement, CET observations and RED4ext hooks. Establish where native fields exist but are not script-accessible, where widgets can be injected, and where options are hard-coded or cached.
4. **Study production consumers.** Hair/eye colours, heterochromia, makeup/tattoos, body/skin switches, morph controls and any custom creator UI in the MO2 inventory. Compare mature mods with small examples; record exactly what has already been demonstrated.
5. **Build a capability matrix.** Each candidate gets a user benefit, required layer, confirmed APIs/fields, strongest evidence, likely compatibility/persistence risks, smallest offline experiment and a single-session runtime validation recipe.
6. **Prototype the most useful discoveries.** The current XF Studio priority is ONE selector switching complete authored presets: atomically select all components/materials, handle Off, and preserve stable save identities across collection updates. Independent design/colour/finish selectors are no longer its product target. Broader research into linked/conditional controls, grouping/paging, extra morphs and richer previews remains useful, but later feature implementations require discussion with Nathan first.
7. **Publish durable conclusions.** A navigable architecture map, evidence-backed capability matrix, reproducible probes and an explicitly ranked implementation backlog. Record negative findings too, including UI/save limits and conflicts with popular frameworks.

## Concrete questions

- Can design, colour and finish be independently represented without storing the complete CCXL option matrix, and without one selector resetting the others?
- Which option fields actually affect layout, grouping, dependencies, randomization and visibility? Which are ignored, version-specific or corrected by ArchiveXL?
- Can arbitrary custom selector state become a dynamic material/context attribute? If not, is a script bridge sufficient, or is a native extension necessary?
- Can the UI offer searchable/paged swatches, custom previews, reversible layer controls or presets while preserving save compatibility?
- Which character morphs already exist and are simply not exposed, and can they be safely enabled without inventing unavailable geometry?
- How are initial creation, later appearance editing, gender/body variants, NPCs and photo-mode representations different consumers of the same resources?
- Which apparently arbitrary constants/limits are true engine constraints versus UI design decisions?
- How can we observe selection changes and resource outcomes during one play session without per-frame log spam or repeated restarts?

## Starting evidence

- `D:/Dev/cp2077-archive-xl/src/App/Extensions/Customization/Extension.cpp` and `src/Red/CharacterCustomization.hpp`.
- ArchiveXL ResourceMeta/ResourceLink/Mesh/Garment extensions and `bundle/source/resources/PlayerCustomization*Scope.xl`.
- `D:/Dev/WolvenKit/WolvenKit.RED4`, RED4ext.SDK types, `D:/Dev/red-dump-json` (historical, date-limited).
- `D:/Dev/cp2077-codeware`, `redscript`, `CyberEngineTweaks`, `cp2077-cet-kit`.
- `research/consumers/inspection.json`, `inventory/mo2-mods.json`, `research/archive-xl/eye-artistry-strategy.md`.
- Local community wiki: CCXL theory, scopes/extensions, character creator file format, hair/eyes and resource patching guides. Cross-check with current official/author sources.

Completion means the major boundaries are explained with source references and the leading opportunities have bounded proofs or clearly recorded failure/unknown states. No broad rewrite of the game UI or new all-in-one toolbox is implied by this research request.
