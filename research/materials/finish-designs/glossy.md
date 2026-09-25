# Glossy / wet look

**Status:** experimental export (single lobe), game-matched model only. Not seen in game.

## Intended look

A smooth, wet-looking reflection over colour: a sharp, bright highlight that moves with the light and view, with the pigment still visible underneath ([finish taxonomy](../makeup-finish-taxonomy.md)). Real glosses are a clear film over pigment, so in life there are two reflections: the film's sharp one and the pigment's own. Gloss is not metallic: its reflection is white, not tinted by the pigment.

## Engine routes, ranked

| Rank | Route | Evidence | What it can and cannot do |
|---|---|---|---|
| **1 (implemented)** | Flat `base/materials/mesh_decal.mt`, `renderstage_post_gbuffer`, roughness 0.12, metalness 0 | Pixel program `16098255505177109230` (DXBC SHA-256 `35e8c18f…c3d`): GBuffer2.y = saturate(Roughness.R × scale + bias), surface alpha = `RoughnessMetalnessAlpha` × squared colour coverage. The deferred light clamps roughness to [0.04, 1] and uses GGX with α = r², F0 = 0.04 for dielectrics ([knowledge §2.3](../../../knowledge/materials-and-shaders.md#23-the-deferred-lighting-model)). [source] | One sharp dielectric reflection that replaces the skin's roughness under the makeup. Its brightness equals skin's (same F0); only its sharpness changes. No second lobe. The route is exactly the one Matte/Satin/Metallic already use, so it adds no new resource risk. |
| 2 | A second, coincident skinned shell with `base/materials/eye_shadow.mt`, `Intensity` 0 | Program `14043594489545752539` (SHA-256 `54e65aa4…6e0`): pass `transparent_back_face`, blend `One/SrcAlpha`. Output alpha = saturate(1 + shadow·(luminance − 1)) with shadow = saturate(`Intensity`·R^`Exponent`), so `Intensity` 0 leaves the lit pixel untouched; RGB adds a forward-lit highlight with roughness `Mask.G`·`WetnessRoughness` scaled by `Mask.B`·`WetnessStrength`. [source] | The only stock skinned pass found that **adds** a second specular lobe after lighting: a true wet film over the lit makeup. Needs a second component and mesh, a different pass (`EMP_Front` sorting against lashes and brows), and the extracted compilation above is labelled `MeshExtSkinned; Dismembered`, so the plain `MeshSkinned` variant must be re-checked. Not built. |
| 3 | `mesh_decal_blendable.mt` | Program `3004271728282315156`: same single-lobe surface write plus a Fresnel colour term. [source] | No benefit over rank 1 for gloss. |
| — | `mesh_decal_wet_character.mt` | Writes surface alpha = 1.0 everywhere ([glossy feasibility](../glossy-decal-feasibility.md)). [source] | Would overwrite roughness across the whole plate. Rejected. |
| — | `multilayered_clear_coat.mt` | Opaque, depth-writing base pass. [resource] | Replaces the skin rather than overlaying it. Rejected. |

Why roughness 0.12: the earlier browser study used a 0.16 base under a 0.08 clear coat. One lobe at 0.12 sits between them, reads as clearly glossier than Satin (0.38) and stays above the 0.04 clamp. It is a provisional choice, to be tuned from the board capture.

## What the preview does

The game-matched model renders Glossy as that one lobe: roughness 0.12, metalness 0, **no clear coat** (the earlier study's clear coat was a lobe the game cannot draw). Older layers keep the clear-coat study until switched.

## Risks

- A single sharp lobe can look like "shiny skin" rather than a film over colour, especially over dark pigments where the reflection is the same white as skin's.
- Replacing skin roughness also replaces the pore-level roughness variation of the skin map under the mark.
- Screen-space reflections and probes make low roughness look different in dim or probe-poor scenes.

## Single most informative in-game test

On the finish board, **Board 1**: rotate the key light across the left lid (Matte | Satin | Glossy stripes of one pigment) with the camera fixed, then orbit the camera with the light fixed. Glossy passes if its highlight is visibly sharper and smaller than Satin's and moves with the light, without looking metallic. If it only reads as "shiny skin", route 2 (the `eye_shadow` shell) becomes the next build.
