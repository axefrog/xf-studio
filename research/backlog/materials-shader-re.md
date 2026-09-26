# Materials system and shader reverse-engineering

**Status (26 Sep 2026): reference phase complete, 5 of 5 families referenced.** Track 4 in the [ranked queue](README.md). What remains is the ranked follow-up list below (separate reviewable changes) and the runtime questions each reference batches for the prepared sessions.

- **Done:** the [skin reference](../materials/shader-skin.md) (parameters, head and body chains, channel packing, passes, the G-buffer program, the wrinkle driver, wetness, the SSS blur/combine/translucency pipeline, the lip seam) the [hair reference](../materials/shader-hair.md) (template, three-pass transparency, profiles, flow, the sun and local-light hair paths, cap, lashes, colour blockers), the [eye reference](../materials/shader-eye.md) (the family and its siblings, player chains, packing and colour spaces, the G-buffer program with refraction, both normals and the gradient lookup, the Eye light, ambient and shadows, the wetness shell and its blendable twin, the waxy-eye diagnosis), the [decal reference](../materials/shader-decal.md) (all 16 `mesh_decal*` templates, passes and blend states per target, the common program step by step, every variant, what a decal leaves in the G-buffer over skin, coverage and mips, the export's dependence, the session-1 gloss and Shimmer reports) and the [multilayered reference](../materials/shader-multilayered.md) (the family, passes and variants, the layer stack, the per-pixel program, the clear coat, the baked surface cache, the face-plate verdict, the layered adapter), plus the [shader fact index](../materials/shader-fact-index.md).
- **What they changed:** skin GBuffer2.z does reach lighting (SSS translucency setup); the SSS mechanism is a separable screen-space blur of irradiance with post-scatter albedo; the local-light hair path is the sun model with its own intensities; `Scattering` does not reach direct light. The eye study found eyes outside SSS with an eye-only ambient factor `1 + cb6[9].w`, the refraction to be near-pure parallax, the template's "Right" parameters to drive the character's left eye, a second gamma-flagged data texture (the Rebecca normal) arguing for raw sampling, `eye_shadow_blendable` to be `eye_shadow` with a vertex glitch and no skinned compilation, and the waxy eye to be the preview's sphere-normal diffuse, too-rough flat 0.18 lobe and missing parallax, not a subsurface problem. The decal study found that a decal's roughness and metalness share one alpha; that mode 1 lerps the **encoded** normal, so facets under the 11.5° gate keep only about alpha × their tilt (the "Shimmer reads as soft gloss" report); that "Discarded" variants are a per-draw dither dissolve, not an alpha test; that `mesh_decal_blendable` has the Fresnel colour with squared coverage and the UV transform; that `mesh_decal_emissive_subsurface` multiplies its colour by `EmissiveEV` directly (0 is black) and gates it by an engine modifier; and, from CDPR's own makeup, that no vanilla finish writes one constant roughness at full weight as the flat route does. The multilayered study confirmed the family is opaque, depth-writing and Standard class in every G-buffer pass, found the clear coat's coat mask in GBuffer2.z and its depth-`Equal` coat pass, the baked template's virtual-texture cache and a per-material normal/microblend mip bias, and closed the face-plate question: mixed finishes stay on the decal route.
- **Ranked follow-ups** (the decal and multilayered items are argued in [decal §10](../materials/shader-decal.md#10-recommended-changes-ranked)):
  1. *Export, before the glitter board is staged:* raise the accent's `EmissiveEV` above 0 and add the modifier caveat to its test card.
  2. *Export:* Colour-shifting metalness 0.25 → ≤ 0.08, so the tint keeps the skin's SSS.
  3. *Export:* after reading *Shimmer · strong*, a tilt-floor Shimmer bake (facets 12–25°, gaps at roughness ≥ 0.6).
  4. *Export:* move Colour-shifting to `mesh_decal_blendable` (plate window, squared coverage, several pigments per preset under one shift colour), with its own board.
  5. *Export:* Matte roughness 0.88 → 1.0; after the *Gloss D* verdict, partial surface weight or grain for flat finishes if they still read "plastic".
  6. *Preview (eye):* ranks 4–5 of the eye plan with the source roughness on by default, one encoding switch for the mask and gamma-flagged normals, an eye ambient factor.
  7. *Preview (skin):* a screen-space SSS blur; the lip-seam capture on the current preview.
  8. *Preview (brows):* draw the brow's normal (0.4, mode 1) and roughness (≈ 0.50) writes through the face-decal family.
  9. *Preview (layered):* a clear-coat adapter for coated garments when clothing lands; honour the two DDXY multipliers if a part changes them.
  10. *Housekeeping:* update `HAIR_LOCAL_LIGHT`'s stale comment.

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
