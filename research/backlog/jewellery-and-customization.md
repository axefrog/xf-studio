# Hair, piercings, jewellery and character customization roadmap

## Status (25 Sep 2026)

- **Preview context done (with documented fidelity gaps):** optional saved-V hair ([preview](../eye-artistry/saved-v-hair-preview.md)), vanilla female piercings with source palette tints for colours 8–16 ([preview](../jewellery/vanilla-piercing-preview.md)), and three private PRC slots ([slice](../jewellery/prc-preview-slice.md), [catalogue audit](../jewellery/prc-catalog-audit.md)). Hair colour/material is open under [preview fidelity](preview-fidelity.md) (track 2).
- **Awaiting the maintainer's review:** the [jewellery construction-set proposal](../jewellery/construction-set-design.md) and [earring reference inventory](../jewellery/earring-reference-inventory.md). Piercing/earring *authoring* is the first later feature and needs discussion before building.
- **Moved to its own track:** the data-driven character-creator editor below is now [CC controls and presets](cc-controls-and-presets.md) (track 3). Portable mod-source discovery below remains the shared requirement for tracks 2, 3 and 5.
- **Open:** CCXL vs EquipmentEx piercing export route (unproven either way); effective runtime winners for all preview assets.

Requests of 23 September 2026. These are part of the general XF Studio roadmap; "asap" expresses interest, not a demand to interrupt every active makeup checkpoint. Coordinate independent slices in worktrees and review outcomes before promoting them. Priorities are in the [ranked queue](README.md).

## Shared head-preview foundation

An early goal alongside eye makeup is a live, close-to-game rendering of **all saved head details**, each with its own preview visibility toggle. Inventory the saved V's actual component selections and their effective mod/vanilla providers, including hair, eyes, brows, lashes, piercings, skin overlays/cyberware and visible mouth/teeth details where present. Resolve meshes, morphs, rig attachments, textures, material parameters, colour profiles and draw order separately. A selected asset being found does not prove the browser render matches the game: compare shape, colour, opacity, movement and occlusion against supplied in-game frames and a batched runtime capture where offline evidence cannot settle it. Show missing or approximate bindings clearly.

The rendering adapters should be reusable context for later feature authoring, not temporary hardcoded scenery. Toggles alter visibility only, preserving the loaded saved-V selection and authored makeup. Keep diagnostic/resource lookup behind provider-neutral interfaces so a manual or Vortex installation can eventually render the same character.

## Preview context: hair and piercings

- Render the saved V's actual hairstyle as an optional head-preview detail, with a visibility toggle. Resolve the saved choice through its installed provider and report missing maps/material dependencies. A plausible placeholder must be labelled as such. This is preview context, not hair-design tooling.
- Render vanilla nose/ear piercing choices first, also optional. Maintain their rigging, morph alignment, occlusion and material provenance. Compare against a known save or character-creator choice before calling them accurate.
- Inventory `PRC`-named entries under MO2 `mods/` and inspect the older Piercing Resource Collection/framework technique. Installed resources and profile enablement are candidates, not proof of the effective in-game winner. Use PRC meshes/shape keys to understand attach points and style coverage before choosing a new export path.
- Probe whether CCXL can provide a clean piercing selector whose choice activates the needed components. If that fails or has a poorer user experience, evaluate ArchiveXL fashion items via inventory/EquipmentEx using the same owned geometry. Do not claim either route is proven until an offline package and a batched runtime test pass.

## Jewellery construction set — design before editor implementation

Research ordinary jewellery references and existing vanilla/community assets for hoops, studs, nose rings by size and gauge, septum designs, dangling earrings and combinations. Record source/creator and permission separately from visual inspiration; never trace photographs or distribute mod assets without rights.

Design a small compositional model: attachment site, anchor transform and orientation, gauge/diameter or post dimensions, reusable primitives (post, hoop, arc, chain, charm, setting, gem), material/finish, symmetry and optional paired/asymmetric use. Define which parameters are truly continuous and which require topology changes; test deformation/skin clearance, collision and scale at realistic character views. Keep authored component identities stable so presets can reuse them without a combinatorial material matrix. Prepare a reviewable baseline architecture and a few reference designs before building the full editor; discuss that architecture with the maintainer and refine it.

## Data-driven character customization preset editor

The studio should eventually edit choices normally available in the game's character creator. Discover options, definitions, groups and switchers from the user's effective vanilla + modded `.inkcharcustomization` resources rather than hardcoding the vanilla selector list. Display missing or ambiguous resources explicitly; never silently pick the first filename match. Round-trip a saved V's choices and preserve unknown custom entries on import/export. Separate selector data, visual UI construction, saved-value translation and game package generation so later CCXL changes do not require a UI rewrite.

Historical Eye Artistry choices in the reference save are ordinary mod-added references for this reader. They are not a content, identity or compatibility target for the new studio. If their archives are installed, a general resolver may surface them incidentally; no bespoke legacy implementation is required.

Current [CCXL capability research](ccxl-character-creator-capabilities.md) must establish what ArchiveXL actually merges, what native Ink/redscript controls render, and which reflected fields require runtime probes. The first vertical slice should enumerate one vanilla and one mod-added selector and show their choices, provenance and saved value without mutating a save. Only then add editing/export with versioned source snapshots and reversible validation.

## Portable mod-source discovery

Make asset discovery provider-neutral. A source inventory lists archives, loose files, manifests, profile/deployment state, priority and provenance; a separate resolver computes candidates and effective winners for a requested depot path/hash. The first providers are installed game/vanilla, manual `archive/pc/mod`, and the reference MO2 installation's profiles plus overwrite. Leave a typed Vortex provider boundary for later implementation. Keep ArchiveXL resource merges/patches as a distinct transformation layer: filesystem winners alone do not reveal the final character-creator option graph.

Do not bake `F:/Games/MO2` or other personal game paths into browser-facing recipes. User installations/configuration are local source adapters. Expose a conflict report explaining **where a choice came from**, why it won or why the winner is uncertain, and what a preview lacks. Store only portable references plus local binding configuration in the user's library; keep personal paths and extracted assets out of distributed collections.

## Acceptance and order

1. Makeup work comes first per the [ranked queue](README.md) (smoke test, then fidelity and finish adapters; plate clearance is paused pending in-game evidence). Current Glitter and Shimmer fixtures are offline studies, not production exports.
2. Optional saved hair, vanilla piercing and three PRC candidate slots now render as preview context with documented material/asset fidelity gaps; compare exact saved choices in a later matched game session.
3. PRC inventory and a private representative combined preview exist. Investigate CCXL and EquipmentEx export choices separately from that preview.
4. Review jewellery construction-set design with the maintainer before committing to its editor/export surface.
5. The read-only customization selector prototype now separates MO2/direct routes and can query selected archive hashes. Extend payload winner/ArchiveXL transformation coverage, then require round-trip and conflict tests before adding editable presets.

These tracks can overlap where their ownership and assets do not conflict. A working preview does not imply a working CCXL/inventory export or accurate runtime material order. Batch game-only uncertainties into one prepared capture session.
