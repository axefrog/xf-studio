# Shader fact index: which Studio code relies on which engine fact

The [materials and shader study](../backlog/materials-shader-re.md) asks for this index so that a corrected fact reaches every adapter that relies on it. Each row names one engine fact, its grade and where it is documented, then the preview material (browser) and the export compiler or verifier that depend on it. Paths are under `projects/xf-studio/authoring/src/`; "verify" means `features/eye-makeup/verify/`, "engine" means `engines/layered-makeup/`.

**When a fact changes:** update its source page, then every file in its row, then the tests those files name. Rows marked **changed in this study** are the ones the [skin](shader-skin.md) and [hair](shader-hair.md) references confirmed or corrected on 26 September 2026.

Grades: **[observed]** compiled 2.31 program or installed resource; **[source-supported]**; **[hypothesis]**.

## G-buffer and lighting (all families)

| Fact | Grade | Documented in | Preview | Export / verify |
|---|---|---|---|---|
| GBuffer0 stores `sqrt(linear albedo)`; `post_gbuffer` decals blend colour in that square-root space | [observed] | [materials §2.2, §2.4](../../knowledge/materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it) | `face-decal-material.ts` (`gbufferColour`, `forwardDecal`), `engine/render/plate-blend.ts`, `engine/render/plate-composite.ts`, `brow-material.ts`, `hair-colour-model.ts` (brow blend) | `engine/preset-compiler.ts` (√colour premultiplied, √coverage in alpha), `engine/flat-mip-chain.ts`, `engine/route-mip-chains.ts`; restated independently in `verify/texture-checks.ts` |
| A decal never changes the pixel's lighting class, profile slot or `.w` payloads: makeup on skin is lit as skin | [observed] | [materials §2.4](../../knowledge/materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it) | `face-decal-material.ts` and `engine/render/plate-blend.ts` light decals with `patchSkinLight` from `skin-material.ts`; `decal-underlay.ts` supplies the skin under each decal vertex | `engine/finish-export.ts` (finish calibration against skin) |
| Dielectric F0 fixed at 0.04; GGX with α = r²; renormalised Burley diffuse | [observed] | [materials §2.3](../../knowledge/materials-and-shaders.md#23-the-deferred-lighting-model) | `skin-material.ts` (`LIGHT`), `eye-material.ts`, `studio-environment.ts` | `engine/finish-export.ts` (roughness values per finish) |
| Subsurface specular = two GGX lobes at `r·roughness0`, `r·roughness1`, × (1 + `lobeMix`)/2 from the pixel's `.sp` slot | [observed] | [skin §6.1](shader-skin.md#61-direct-light) | `skin-material.ts` (`skinLobes`), profiles carried by `render-detail.ts` (`RenderSkinProfile`) from `character-detail-service.ts` | — |
| SSS is a screen-space separable blur of **irradiance**, with albedo applied after (post-scatter); per-channel strength `P` lerps unblurred → blurred; specular unblurred. **Changed in this study** (mechanism decoded; previously named only) | [observed]; kernel construction [hypothesis] | [skin §6.3](shader-skin.md#63-blur-and-combine) | `skin-material.ts` approximates it with a per-channel wrap from `falloff`/`blurSize`: **a stand-in, not the mechanism**; the fact now supports a screen-space follow-up | — |
| A pixel whose metalness exceeds 0.1 skips SSS entirely | [observed] | [materials §2.3](../../knowledge/materials-and-shaders.md#23-the-deferred-lighting-model), [skin §6.3](shader-skin.md#63-blur-and-combine) | `skin-material.ts` (wrap off above 0.1), used by `engine/render/plate-blend.ts` on the blended metalness | `engine/finish-export.ts` (Metallic at 0.65 crosses it) |
| Skin GBuffer2.z (`0.4 + 0.6·vertexColour.G`) weights a **sun transmission** term in the `UseTranslucency` SSS setup; the global and local light read GBuffer2.z only for Foliage. **Changed in this study** (was "reaches no lighting") | [observed]; variant selection [hypothesis] | [skin §6.4](shader-skin.md#64-translucency-the-usetranslucency-setup) | Not drawn (no adapter relies on it) | Decal surface coverage blends it toward 1/3, removing transmission under the decal; negligible on eyelids and lips (thick geometry) |
| Hair lighting class: Karis R/TRT/multiple-scatter model; sun intensities `cb0[12]`, local-light intensities `cb0[13]` with the same shape registers. **Changed in this study** (local-light path decoded) | [observed]; option pairing and values [hypothesis]/[community] | [hair §6](shader-hair.md#6-the-hair-light) | `hair-shading.ts` (`xfsHairDirect`, `HAIR_LIGHTING_VANILLA`, `HAIR_LOCAL_LIGHT`: structure confirmed, its "not decoded" comment is stale) | — |
| Character creator and mirror lights are all local; SDR display transform and grading LUT | [observed]/[source-supported] | [creator lighting](../../knowledge/creator-lighting.md) | `creator-lighting.ts`, `grading-lut.ts`, `linear-display.ts` | — |

## Resource model and textures

| Fact | Grade | Documented in | Preview | Export / verify |
|---|---|---|---|---|
| A template is identified by its own `CMaterialTemplate.name`, not its depot path | [observed] | [materials §3.1](../../knowledge/materials-and-shaders.md#31-where-they-are-and-how-templates-map-to-programs) | `render-templates.ts`, `character-material-adapters.ts` | `verify/resource-checks.ts` |
| Leaf-wins `.mi` chain over template defaults | [source-supported] | [materials §1.3](../../knowledge/materials-and-shaders.md#13-how-an-instance-chain-resolves) | `material-template.ts` (template defaults), `skin-material.ts` (`SKIN_TEMPLATE_DEFAULTS`), resolver output in `character-detail-service.ts` | `package-resources.ts` (instance values) |
| Whether a texture is sRGB-decoded follows the XBM's `isGamma` | [observed] | [materials §5](../../knowledge/materials-and-shaders.md#5-texture-conventions) | `character-detail-loader.ts` and `character-material-adapters.ts` (`textureColourSpace`), `skin-material.ts`, `hair-shading.ts` | `engine/preset-compiler.ts`, `package-resource-builder.ts`, `verify/resource-checks.ts` |
| Normal maps are RG with Z reconstructed; blue ignored; no Y flip in the programs | [observed] | [materials §5](../../knowledge/materials-and-shaders.md#5-texture-conventions), [skin §4](shader-skin.md#4-texture-packing-and-colour-spaces) | `skin-material.ts` (`xfsUnpackRG`), `face-decal-material.ts`, `eye-material.ts`, `layered-material.ts` | `engine/preset-compiler.ts` (facet normals), `engine/route-mip-chains.ts` |
| Mesh-local material entries, `@` template entries and `*` soft paths (ArchiveXL) | [source-supported] | [materials §1.4](../../knowledge/materials-and-shaders.md#14-mesh-side-binding) | — | `package-resources.ts`, `verify/resource-checks.ts` |

## Skin (`skin.mt`)

| Fact | Grade | Documented in | Preview | Export / verify |
|---|---|---|---|---|
| Roughness **R** base, **G** = metalness slot (and wet non-porosity), **B** detail mask; bias `saturate(R·(1 + B·(lerp(lo, hi, f) − 1)))`. **Confirmed in this study** | [observed] | [skin §4, §5.2](shader-skin.md#52-micro-term-roughness-and-cavity) | `skin-material.ts` (`skinRoughness`, `metalnessFactor = R.y`), `decal-underlay.ts` (skin roughness and metalness under decals) | `engine/finish-export.ts` (finish roughness calibrated against skin ≈ 0.6 under the lids) |
| Tone: `w = \|TintScale\|·Mask.R`, multiply (+) or overlay (−); `TintColor` encoding byte/255 | [observed]; encoding [hypothesis] | [skin §5.3](shader-skin.md#53-tone) | `skin-material.ts` (`tintChannel`, `SKIN_TINT_ENCODING`), `decal-underlay.ts` via `skinBaseTexels` | — |
| Detail and micro normals use slope-sum (partial-derivative) blending; micro atlas halves at `(1.4 + b)` and `(1.0 + b)`; micro normal lerps right→left, micro term left→right. **Confirmed in this study** | [observed] | [skin §5.1–5.2](shader-skin.md#51-normal) | `skin-material.ts` (`xfsBlendNormal`, `SURFACE`) | — |
| Secondary albedo is multiplied by the **toned base**, weighted by `w·SecondaryAlbedoTintColorInfluence` | [observed] | [skin §5.4](shader-skin.md#54-blood-flow-and-secondary-albedo) | `skin-material.ts` (`skinBaseColour`) | — |
| Wrinkle normals and blood flow are driven per vertex by UV-rectangle regions × animation float tracks, zero at rest. **New in this study** | [observed]; track source [hypothesis] | [skin §5.6](shader-skin.md#56-the-wrinkle-driver-vertex-program) | `skin-material.ts` leaves them undrawn (faithful at rest); an animated-wrinkle feature would need the regions | — |
| Wetness darkens porous and glosses smooth skin (`MaterialModifiersConsts[3]`). **New in this study** | [observed] | [skin §5.7](shader-skin.md#57-wetness-rain) | Not drawn (faithful when dry) | Test cards must record weather |
| Head and body share one skin model and tone chain; the body has no skin type | [observed] | [skin §3.2](shader-skin.md#32-body-one-skin-model) | `skin-material.ts` for body parts (body track) | — |

## Decals (`mesh_decal` family, the export route)

| Fact | Grade | Documented in | Preview | Export / verify |
|---|---|---|---|---|
| Colour and surface coverage = contrast-adjusted alpha **squared** × secondary mask; normal alpha not squared; target alphas default 0 | [observed] | [decal contract](mesh-decal-shader-contract.md) | `face-decal-material.ts`, `engine/render/plate-blend.ts` | `engine/preset-compiler.ts`, `engine/flat-mip-chain.ts`, `package-resources.ts` (target alphas); `verify/texture-checks.ts` |
| Roughness and metalness are separate R maps × scale + bias | [observed] | [decal contract](mesh-decal-shader-contract.md) | `face-decal-material.ts` | `engine/finish-export.ts` (`flatSurface`), `engine/preset-compiler.ts`, `verify/resource-checks.ts` |
| `NormalsBlendingMode` 1: reoriented composite with the G-buffer normal, alpha × `saturate(50 − 50z)` | [observed] | [materials §4.5](../../knowledge/materials-and-shaders.md#45-mesh_decal-family-post_gbuffer-all-standard-class-meshskinned-available) | `face-decal-material.ts`, `engine/render/plate-blend.ts` and `plate-composite.ts` (`MODE1_FULL_TILT`) | `engine/finish-export.ts` (faceted route), `engine/preset-compiler.ts`, `engine/route-mip-chains.ts`, `package-resources.ts` |
| `mesh_decal` transforms texture UVs by `UVScale`/`UVOffset`; the gradient-recolour template does not | [observed] | [materials §6](../../knowledge/materials-and-shaders.md#6-makeup-finish-implications) | `face-decal-material.ts` | `engine/plate-uv-window.ts`, `engine/finish-export.ts`; independently `verify/uv-window.ts` |
| `mesh_decal_gradientmap_recolor_blendable` adds a Fresnel tint before the square root; linear coverage; vertex distance fade | [observed] | [colour-shift design](finish-designs/colour-shifting.md) | `engine/render/fresnel-tint.ts`, `engine/render/plate-blend.ts` | `engine/finish-export.ts` (`fresnelMaterial`), `engine/preset-compiler.ts` |
| No specular antialiasing; the mip chain is the only filter a mod controls | [observed] | [glitter in game §1](../../knowledge/glitter-in-game.md#1-from-flake-texture-to-screen-pixel) | — | `engine/flat-mip-chain.ts`, `engine/route-mip-chains.ts`, `glitter-route.ts`; `verify/glitter-checks.ts` |
| Vanilla face decals sit 0.40 mm off the head along its normals, morphs included | [observed] | [materials §2.4](../../knowledge/materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it) | Face decal meshes carry their own lift | `plate-lift.ts`, `package-resource-builder.ts`, `export-diagnostics.ts`; `verify/plate-geometry.ts` |
| Draw order by `materialPriority` first; within a priority unknown | [observed] / [hypothesis] | [head CC rendering §3](../../knowledge/head-cc-rendering.md#3-the-head-decal-family) | `render-templates.ts`, `character-detail-plan.ts`, `platform/scene/character-renderer.ts` | `package-resources.ts` |

## Hair (`hair.mt`, `.hp`)

| Fact | Grade | Documented in | Preview | Export / verify |
|---|---|---|---|---|
| Truncated profile lookup, overlay with root-to-tip as base, vertex-red shadow, `\|c\|` | [observed] | [hair §3.3](shader-hair.md#33-colour) | `hair-colour-model.ts`, `hair-shading.ts` | — |
| `.hp` bake: interpolate 8-bit stops, then decode from sRGB | [hypothesis] (fit) | [hair §7](shader-hair.md#7-hp-profiles-and-their-resolution) | `hair-colour-model.ts` (`ProfileEncoding`, `sampleStopsEncoded`) | — |
| Dithered coverage with a shared per-pixel threshold (nested), remap by `AlphaCutoff`; 3-deep k-buffer, near-opaque (> 0.98) eviction | [observed] | [hair §3.1](shader-hair.md#31-hair_alpha_accum-2782105832921211528) | `hair-colour-model.ts` (`HAIR_DITHER`, `hairResolvedCoverage`), `hair-shading.ts` (alpha-to-coverage; no k-buffer) | — |
| Strand direction from `Flow` (sRGB) along bitangent/tangent | [observed] | [hair §5](shader-hair.md#5-strand-direction-flow-and-roughness) | `hair-shading.ts` | — |
| Lashes: constant ID and root-to-tip placeholders, so one profile entry pair sets the lash colour | [observed] inputs | [hair §9](shader-hair.md#9-lashes) | `hair-colour-model.ts`, `hair-shading.ts` | — |
| `Scattering` and `VertexColorStrength` have no effect on direct light | [observed] | [hair §6.3](shader-hair.md#63-what-the-light-does-not-read) | Not used (correct) | — |
| Cap: `mesh_decal_gradientmap_recolor` indexes a per-colour gradient by an ID map, square-root blend | [observed]; plain-template arithmetic [hypothesis] | [hair §8](shader-hair.md#8-the-scalp-cap) | `character-material-adapters.ts` (`hair-cap-decal`), linear blend (approximation) | — |

## Eyes and layered materials

| Fact | Grade | Documented in | Preview | Export / verify |
|---|---|---|---|---|
| Eye roughness is **R** × `RoughnessScale` at the raw UV; colour, normal and mask V-flipped; iris gradient row lookup | [observed] | [eye rendering](../../knowledge/eye-rendering.md) | `eye-material.ts` | — |
| `eye_shadow` is a forward `One/SrcAlpha` shell: Mask R shadow, G/B wet highlight | [observed] | [materials §4.4](../../knowledge/materials-and-shaders.md#44-eye_shadowmt--eye_shadow_blendablemt--the-eyes-occlusion-and-tear-shell-not-cosmetic-eyeshadow) | `eye-material.ts` | — |
| Multilayered: per-pixel front-to-back coverage shares, levels as clamped scale/bias, colour mask from the roughness map | [observed]; CPU mappings [hypothesis] | [multilayered evidence](multilayered-shader-evidence.md) | `layered-material.ts`, `layered-setup.ts` | — |

Related: [skin reference](shader-skin.md) · [hair reference](shader-hair.md) · [materials and shaders](../../knowledge/materials-and-shaders.md) · [backlog](../backlog/materials-shader-re.md).
