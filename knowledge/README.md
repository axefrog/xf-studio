# XF Studio knowledge base

This is the R&D lab's distilled reference for how Cyberpunk 2077's engine, resources and modding frameworks fit together. It is written primarily for agents: CP2077 modding knowledge is thin in training data, so every agent should be able to start here instead of rediscovering it. The project's standing mandate is that R&D runs permanently alongside product work, like a research lab beside a commercial team. The knowledge built here is what makes body customisation, world integration and quest tooling possible later.

## How this differs from `research/`

`research/` holds investigations: studies, audits, dated evidence and decisions tied to a task. `knowledge/` holds the **current, consolidated answer** to "how does X work?", with each claim citing the research, source code, wiki page or runtime capture that supports it. When research changes our understanding, update the knowledge page in the same checkpoint.

## Rules for knowledge pages

- **State current truth, organised by concept.** Don't write a dated log. Replace wrong statements, and note superseded beliefs only when the correction is itself instructive.
- **Grade every non-trivial claim:**
  - **[source]** read in engine/framework/tool source or decompiled data;
  - **[resource]** observed in extracted game or mod resources;
  - **[wiki]** documented in the Modding Docs, text or image (cite the commit and path);
  - **[runtime]** observed in the running game (cite the capture);
  - **[hypothesis]** not yet established.
- **Cite precisely:** file paths, commits and versions. Link the research page that holds the evidence rather than duplicating it.
- **Prefer diagrams and tables** of resource relationships over prose. Check that diagrams render legibly.
- **Keep it asset-free.** Record names, paths, hashes, structures and parameter semantics, never extracted game or mod payloads.
- **Credit what you learned from.** Community sources that teach us something need an entry in the [community credits](../docs/community-credits.md).
- **Mark open questions** explicitly at the end of each page. They become R&D backlog items.

## Topics

Each page's maturity is **Seed** (only pointers to existing research), **Draft** (consolidated but with significant gaps) or **Solid** (consolidated, cited and cross-checked).

| Topic | Page | Maturity | Existing research to consolidate |
|---|---|---|---|
| Resource formats and the character-customisation file chain (`.inkcharcustomization` → `.app` → `.ent` → `.mesh` / `.morphtarget` → materials) | [cc-file-chain.md](cc-file-chain.md) | Draft (resolver phase 1 implemented) | [Resolver validation](../research/character-customization/resolver-validation.md), [file-chain map](../research/character-customization/file-chain-map.md), [CCXL merge boundary](../research/character-customization/ccxl-merge-boundary.md), [catalogue prototype](../research/character-customization/catalog-prototype.md), [mod source resolution](../research/character-customization/mod-source-resolution.md), [head details](../research/eye-artistry/head-details.md), [built-in eye plate](../experiments/012-native-plate-bootstrap/README.md#built-in-production-plate) (byte-level `.mesh` render-blob and `.morphtarget` diff/mapping layout as used by [`eye-plate-cut.ts`](../projects/xf-studio/authoring/src/eye-plate-cut.ts)), legacy xf-omega / `xf-eye-artistry-ccxl` code (reference only) |
| Materials and shaders (`.mt` / `.remt` / `.mi` chains, shader templates, G-buffer channels; skin, hair, eye, decals, multilayered) | [materials-and-shaders.md](materials-and-shaders.md) | Draft | [Mesh decal shader contract](../research/materials/mesh-decal-shader-contract.md), [multilayered assessment](../research/materials/multilayered-makeup-assessment.md), [skin shader audit](../research/eye-artistry/saved-skin-shader-and-winner.md), [eye/lip optics](../research/eye-artistry/eye-lip-optics-audit.md), [lash material](../research/eye-artistry/lash-material-followup.md), [hair profile](../research/eye-artistry/saved-hair-profile-resolution.md), [glitter shader investigation](../research/materials/glitter-shader-investigation.md), [shader cache index](../research/materials/evidence/shader-cache-index.json) |
| Hair shading (`hair.mt` passes, `.hp` profile lookup and overlay, deferred Marschner-style hair light, brow decal `sqrt` blend) | [hair-shading.md](hair-shading.md) | Draft | [Colour pipeline evidence](../research/eye-artistry/hair-colour-pipeline-2026-09-25.md), [lash material](../research/eye-artistry/lash-material-followup.md), [hair profile resolution](../research/eye-artistry/saved-hair-profile-resolution.md), [brown liquorice overlap](../research/eye-artistry/brown-liquorice-profile-overlap.md) |
| Mod loading and resource precedence (MO2 VFS, archive mount groups and order, ArchiveXL `.xl` discovery, scopes, fixes, patches, copies/links, dynamic materials) | [mod-loading.md](mod-loading.md) | Draft | [Resolver validation](../research/character-customization/resolver-validation.md), [source discovery and MO2 precedence](../research/authoring/source-discovery-foundation.md), [MO2 source resolution](../research/character-customization/mod-source-resolution.md), [brown liquorice overlap](../research/eye-artistry/brown-liquorice-profile-overlap.md), [ArchiveXL strategy](../research/archive-xl/eye-artistry-strategy.md), [framework diagnostic profile](../research/authoring/framework-diagnostic-profile-2026-09-25.md), [framework check and MO2 placement](../research/authoring/framework-version-check.md) |
| Animation, rigs and facial deformation | `animation-and-rigs.md` (to write) | Seed | [CC idle](../research/animation/cc-idle.md), [brow idle gap](../research/animation/brow-idle-gap.md), [idle guide](../docs/idle-animation-guide.md), experiments [012](../experiments/012-native-plate-bootstrap/README.md) and [015](../experiments/015-native-eye-assembly/README.md) |
| Save format and appearance data | `save-format.md` (to write) | Seed | [Save import](../research/eye-artistry/save-import.md) |
| Piercings and jewellery resources | `jewellery-resources.md` (to write) | Seed | [PRC inventory](../research/jewellery/prc-inventory.md), [vanilla piercing preview](../research/jewellery/vanilla-piercing-preview.md) |
| Tooling (WolvenKit CLI, Blender add-on, conversion round trips) | `tooling.md` (to write) | Seed | [Toolchain](../docs/toolchain.md), [WolvenKit 9 round trip](../research/authoring/wolvenkit-9-roundtrip-2026-09-24.md) |
| Runtime access (RED4ext, CET, redscript, Codeware; live data capture) | `runtime-access.md` (to write) | Seed | [Validation](../docs/validation.md); future work |
