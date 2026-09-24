# Materials system and shader reverse-engineering

**Status (25 Sep 2026): open — never properly begun as a systematic study.** Track 4 in the [ranked queue](README.md). Existing work is finish-specific or follows one saved resource chain at a time; no shader has a complete, reusable reference.

## Requirement (long-standing directive)

Research the game's main shaders so we understand how materials **actually** render, rather than approximating from names and thumbnails. This grounds two things:

- **Preview fidelity** (track 2): skin, eyes, lips/mouth, brows, lashes and hair in the browser viewport.
- **New materials** (track 6): the remaining makeup finish export adapters (Shimmer, Glitter, Glossy, Colour-shifting) and any mixed-finish or multilayered approach.

## Scope

For each shader/template: material template (`.mt`/`.remt`) parameters and defaults, instance (`.mi`) inheritance, texture channel packing and colour space, compiled pass(es) and render stage (G-buffer vs post-G-buffer decal), blend/depth state, the pixel-program dataflow for the relevant vertex factory (skinned), and what a browser adapter can and cannot reproduce. Record game version (currently 2.31), cache/template hashes and tool versions.

Priority order (adjust with the maintainer):

1. **Skin** (`base\materials\skin.mt`) — SSS, detail/micro normals, roughness, tone/gradient inputs; lip seam artefact.
2. **Hair** (`base\materials\hair.mt`, `.hp` profiles) — strand-ID/root-tip gradients, flow, cap/mask, anisotropic response. Blocks correct hair and lash colour.
3. **Eye** (`eye.mt`, `eye_gradient.mt`, cornea/refraction, `eye_shadow_blendable.mt`) — iris mask, gradient interpolation, waxy-eye artefact.
4. **Decals** — `mesh_decal`, `mesh_decal_double_diffuse` (brows), `mesh_decal_blendable`, gradient-map recolour, emissive/subsurface and particle variants. Current makeup exports rely on `mesh_decal`.
5. **Multilayered** (`multilayered*.mt`) — whether mixed cosmetic finishes can be expressed faithfully.

## Existing evidence to build on

| Area | Documents |
|---|---|
| Decal family | [mesh-decal shader contract](../materials/mesh-decal-shader-contract.md), [flat preset compiler](../materials/preset-compiler-contract.md), [mip filtering](../materials/flat-preset-mip-filtering.md), [glossy decal feasibility](../materials/glossy-decal-feasibility.md), [colour-shift feasibility](../materials/colour-shift-game-feasibility.md), [particle-decal audit](../../experiments/009-glitter-game-fixture/particle-decal-audit.md) |
| Glitter/optics | [glitter shader investigation](../materials/glitter-shader-investigation.md), [REDengine glint feasibility](../materials/redengine-glint-feasibility.md) |
| Multilayered | [multilayered makeup assessment](../materials/multilayered-makeup-assessment.md) |
| Skin | [saved skin resource chain](../eye-artistry/saved-skin-resource-chain.md), [skin shader channels and winner](../eye-artistry/saved-skin-shader-and-winner.md) |
| Eye/lip | [eye and lip optics audit](../eye-artistry/eye-lip-optics-audit.md), [eye roughness study](../eye-artistry/eye-roughness-preview.md), [native eye gradient](../../experiments/014-native-eye-gradient/README.md) and its compiled-shader checkpoint |
| Brow/lash/hair | [brow/lash preview diagnostic](../eye-artistry/brow-lash-preview-diagnostic.md), [brow/lash study](../eye-artistry/brow-lash-fidelity.md), [lash material follow-up](../eye-artistry/lash-material-followup.md), [hair profile resolution](../eye-artistry/saved-hair-profile-resolution.md) |
| Renderer reference | [CharacterCreator rendering reference](../eye-artistry/charactercreator-rendering-reference.md), [wgpu assessment](wgpu-renderer-assessment.md) |
| Taxonomy | [makeup finish taxonomy](../materials/makeup-finish-taxonomy.md) |

## Deliverables

- One reference document per shader family under `research/materials/` (name suggestion `shader-<family>.md`), each with the scope above and explicit **observed / source-supported / hypothesis** labels.
- A short index of which Studio adapters (preview materials, export compilers) rely on which shader facts, so a fact correction propagates.
- Browser adapter changes only as separate, reviewable follow-ups with before/after evidence.

## Rules

- Compiled-shader and template inspection is offline evidence; it does not prove what a running game rendered. Batch any runtime question into the maintainer's prepared session.
- Extracted shaders, templates and textures stay local and ignored; commit only findings, hashes and project-authored tools.
- Credit community sources (wiki pages, tools, mod authors) in [community credits](../../docs/community-credits.md) as lessons accumulate.
