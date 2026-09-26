# Glitter in game: what can sparkle on a face decal (game 2.31)

**Maturity: Draft.** Every engine step between a flake texture and a screen pixel is traced from compiled programs, installed templates and one installed community glitter mod, and a proposed route is measured offline ([experiment 018](../experiments/018-glitter-route/README.md)) and built as a verified diagnostic board ([experiment 021](../experiments/021-glitter-board/README.md)). Runtime evidence is limited to Shimmer: in the first photo-mode session (25 September) the default faceted Shimmer read as a diffused gloss, not sparkle. No glitter route has been seen in game.

This page answers three questions for XF Eye Artistry:

1. Which game mechanisms can show discrete sparkles that respond to light and view on the eye plate?
2. Which route should Glitter export use, and what exactly goes into its material?
3. What must the Studio's preview do to match it?

Engine basics (G-buffer, decal blending, skin lighting) are in [materials and shaders](materials-and-shaders.md); this page cites them rather than repeating them.

**Evidence grades:** **[source]** compiled programs or tool source; **[resource]** installed game or mod files; **[wiki]** Cyberpunk Modding Docs; **[runtime]** seen in game; **[offline]** measured here on generated maps; **[hypothesis]** not established.

## Summary

- **A sparkle is one pixel whose single normal happens to mirror the light.** The G-buffer holds one normal, roughness and metalness per pixel, and nothing in the decal or skin programs widens roughness for lost normal detail. So a flake can only sparkle if it covers whole pixels at the viewing distance. Sub-pixel glints cannot be drawn [source].
- **The plate's texture density was the first bottleneck, and the fix is now in Build.** The plate uses the head's UVs, so a 1024 atlas gives about 0.4–0.56 mm per texel on the lids; vanilla eye makeup has its own UV layout that is about 7 times denser. `mesh_decal` has UV scale and offset constants, so a plate-local window in a non-square texture spends every texel on the plate. The flat and faceted export routes now use a 2048×512 window (today's texel count, about 0.13 × 0.12 mm per texel), with the V sign verified offline ([experiment 019](../experiments/019-uv-window/README.md)); 4096×1024 would reach about 0.06 mm for a Glitter route [source] [resource] [offline]. Shimmer's default facets are still about 1.4 mm wide because that is their authored cell size.
- **Temporal antialiasing removes one-pixel glints.** The decoded temporal program clamps history to the 5-tap mean ± 1σ in PQ space. That dims an isolated one-pixel glint by roughly an order of magnitude but keeps glints of 2×2 pixels or more [source]. So every flake has to be at least 2 texels wide at every mip level. DLSS, FSR3 and XeSS are closed binaries whose behaviour is [hypothesis].
- **Recommended primary route: resolved glint flakes in `mesh_decal`.** The window texture carries strongly tilted, low-roughness, high-metalness flakes, with a separate flake mask and dilated normals. A *nested* mip chain re-draws flakes at at least 2 texels on every level instead of averaging them. Offline, this keeps 3 times more sparkling pixels after the temporal clamp at the face-framing mip, and 30 times more one level further, than a plain BOX chain [offline]. Build now has it as a **diagnostic** route that only a prepared collection's `glitter` knob reaches; the Glitter finish itself is still omitted from ordinary exports. On the built board, block compression keeps the flakes (BC5 normals within 1° at the 95th percentile, BC4 flake edges within 0.055) and WolvenKit keeps the supplied nested chains [offline] ([experiment 021](../experiments/021-glitter-board/README.md#offline-checks-before-a-session)). The look is still [hypothesis].
- **Fallback: the same maps plus an emissive sparkle accent** on a second plate chunk (`mesh_decal_emissive_subsurface`). It stays visible at any distance, but it is light-independent, so it must be labelled as stylised [source].
- **Community precedent.** The installed glitter eyeshadow mod (Limerence × AllieKat *Winterkissed*, Nexus file "Limerence AXL Glitter Eyeshadows") uses plain `mesh_decal`. It has 4096² maps on the vanilla eye-makeup UVs, embossed shape outlines as normals, metalness near 1 and roughness 0–0.25 [resource].

## 1. From flake texture to screen pixel

Each row is one stage a sparkle has to survive, in draw order.

| Stage | What it does to a flake | Grade and evidence |
|---|---|---|
| **UV mapping** | The plate uses head UV0: U 0.273–0.727, V 0.676–0.821 as stored (authored glTF v = 1 − V), covering 4 % of the atlas. Along the surface, one unit of UV is about 569 mm (U) and 405 mm (V) (area-weighted medians over the plate), so a 1024 atlas gives 0.56 × 0.40 mm texels. The vanilla eye-makeup mesh has its own layout (66 mm per UV unit; both eyes overlap in UV), giving 0.065 mm texels at 1024. | [resource] built-in plate and `winterkissed_w.mesh` (vanilla eye-makeup geometry, byte for byte per [experiment 017](../experiments/017-plate-depth/README.md)); [experiment 018](../experiments/018-glitter-route/README.md#texel-density) |
| **Decal UV transform** | `mesh_decal` computes t = `UVScale`·(u − 0.5) + 0.5 + `UVOffset` (with `UVRotation`) for every texture it samples, from the UV as stored (the vertex program passes it through), then wraps with sign(t)·frac(\|t\|). A window mapping only the plate's UV rectangle to [0,1] is two constants per axis; the flat and faceted export routes use one. | [source] decompiled `16098255505177109230`, vertex `11128168794837425370`; [experiment 019](../experiments/019-uv-window/README.md) |
| **Texture format** | XBMs may be non-square; the game ships 2048×1024 brow textures. | [resource] `ark_heb__base_d18.xbm` |
| **Sampler** | One sampler `s0`: `TA_Wrap`, `TFMin_Anisotropic`, `TFMag_Linear`, `TFMip_Linear` (template `samplerStates[2]`). Every decal texture is read with `Sample` (hardware LOD from derivatives); the program has no `SampleBias`, `SampleGrad` or `SampleLevel`. Any LOD bias, for example the negative bias upscalers usually want, can therefore come only from the engine's sampler descriptor. The test setup's saved settings use anisotropy 16. | [resource] `mesh_decal.mt`; [source] decompiled program; whether the engine applies an upscaler mip bias is [hypothesis] |
| **Mip chain** | This is the only filter we control. The faceted route's plain BOX average shortens the averaged flake normals; in `NormalsBlendingMode` 1 the shorter normals are gated out by saturate(50 − 50z). | [source]; [Shimmer design](../research/materials/finish-designs/shimmer.md) |
| **Decal program** | Writes one normal (mode 1: reoriented onto the skin normal; mode 0: plate normal plus map), with alpha `NormalAlpha` × (`NormalAlphaTex`.R or diffuse alpha) × gate. Roughness and metalness are `R`×scale+bias at alpha `RoughnessMetalnessAlpha`×coverage². Nothing derives roughness from normal variance: no Toksvig and no specular antialiasing. The skin writer has none either (its only `SampleGrad` is the micro-detail atlas). | [source] `16098255505177109230`, skin `12806642364631437234` |
| **Deferred light** | Skin pixels get two GGX lobes at the written roughness × 0.966 and × 1.597 (default skin profile). F0 = lerp(0.04, albedo, metalness); roughness is clamped to ≥ 0.04; specular is clamped at 100. A flake at roughness 0.22 has lobe widths α ≈ 0.045 and 0.12, so its highlight sits within about 4–5° of mirror geometry. | [source] `…_11111111`, [materials and shaders §2.3](materials-and-shaders.md#23-the-deferred-lighting-model) |
| **SSS combine** | Blurs diffuse only and adds specular unchanged. Flake texels with metalness above 0.1 skip SSS entirely, which suits flakes. | [source] `7703933925853799832` |
| **Reflections** | Environment reflections come from separate passes. With ray tracing on, the NRD denoisers (REBLUR/RELAX temporal accumulation, present in the static cache) filter them, so crisp glints come from analytic lights (sun, photo-mode lights), not from the environment. | [source] for the programs' presence; effect on flakes [hypothesis] |
| **Temporal AA** | `m_simpleTemporal` (static `525406595650312948`) PQ-encodes the colour (SMPTE ST 2084 constants), clamps the Catmull-Rom history to mean ± 1σ of the 5-tap cross neighbourhood, blends 5 % current / 95 % history, and decodes. A stable glint of value g with dark neighbours settles at 0.05g + 0.95·0.6g ≈ 0.62g of its PQ code. For a 1×2 glint the figure is ≈ 0.9g, and a 2×2 glint keeps all of it. That the main anti-aliasing (the `m_postTXAA` names carry no attributed program in our index) behaves the same way is [hypothesis]. | [source] decompiled; [experiment 018](../experiments/018-glitter-route/README.md#taa-and-upscalers) |
| **Upscalers** | The game ships DLSS (including Ray Reconstruction and frame generation), FSR3 and XeSS as closed DLLs. The engine's FSR2/XeSS reactivity masks are max(two engine inputs) plus a stencil category (low 5 bits = 18); the DLSS colour-bias mask is a binary copy of one engine input. Decals write with stencil disabled, so makeup cannot mark itself reactive. The test setup runs DLSS "Auto" (Transformer model) at 3840×1600, with ray-traced lighting and reflections on and path tracing off. | [resource] `bin/x64`; [source] `881371692195232951`, `15039989337359667650`, `7261057323686950841`; upscaler behaviour on glints [hypothesis] |
| **Variable-rate shading** | Every template declares `shadingRateMode`: 364 use `MSRM_Default`, 8 disable variable-rate shading (holograms, cloaks, `decal.remt`) and one forces 2×2. `mesh_decal` is `Default`, so if the engine's variable-rate shading is active it may shade the decal coarsely. | [resource] 373 templates; engine policy [hypothesis] |

**Consequences for any glitter design:**

1. Flakes must be **at least 2 texels wide at every mip level** and at least 2 internal pixels on screen. Flakes smaller than that can only become sheen.
2. Only the **mip chain and per-texel values** are ours to shape. There is no per-pixel flake distribution, no second lobe and no specular antialiasing to lean on.
3. Glints come from **analytic lights**. Photo-mode lights and the sun make them; environment-only lighting mostly will not.

## 2. Candidate mechanisms

| Mechanism | What the compiled programs say | Light- and view-dependent? | Verdict |
|---|---|---|---|
| **Resolved flakes in `mesh_decal`**: flake normals plus a flake mask, and per-flake roughness, metalness and colour | Covered in §1. Per-texel normal, roughness, metalness and colour; separate normal mask; mode 1 composes with skin; one sampler, implicit LOD. | Yes, where flakes cover at least 2 pixels | **Primary** (§3) |
| **The faceted Shimmer route pushed further** (fewer cells, more tilt) | The same program. The facets are UV-cell discs in the head-UV atlas: 1.4 mm wide at the default 128 cells, 2.8 mm for 017's *Shimmer · strong*, and about 5.6 mm for Board 2's coarse "glitter proxy". Tilts are at most 15° or 23°, partly gated below 11.5°. | Yes, but as millimetre-scale patches | Sequins or hammered metal, not glitter; it cannot get finer without the UV window |
| **`mesh_decal_particles`**, and the flipbook built into plain `mesh_decal` | Samples ordinary maps at flipbook UVs driven by `GlobalShaderConsts[0].x` (time). The `highlights` pass writes constants. | Only through normal maps; animation is time-driven | Rejected: time flicker is not glitter ([audit](../experiments/009-glitter-game-fixture/particle-decal-audit.md)) |
| **`mesh_decal_emissive_subsurface`** | Masks and constants only; no normal, light or view input. There is no UV transform either, so its mask uses the head-UV atlas. | No | **Fallback accent** (§4), labelled stylised |
| **`mesh_decal_emissive`** | Its target 2 is additive into GBuffer2 B/A. Over skin that would add into the skin-profile and emissive bits. | No | Avoid on skin |
| **`mesh_decal_gradientmap_recolor_blendable`** Fresnel | Its Fresnel term uses the *normal-mapped* normal. Per-flake normals would therefore brighten individual flakes by view angle, but only in albedo (diffusely lit, at most white) and with one shift colour per draw. | View only | A possible later "twinkle" variant, not glitter |
| **Multilayered / clear coat** | Opaque and depth-writing; replaces the surface and skin's lighting class. The runtime surface cache resolves one surface. | — | Rejected ([assessment](../research/materials/multilayered-makeup-assessment.md)) |
| **`metal_base_glitter.mt`** | Noise- and time-driven emission in an opaque, depth-writing pass | No | Rejected ([investigation](../research/materials/glitter-shader-investigation.md)) |
| **Vanilla search** | None of the 373 templates has a glint, sparkle, flake or sequin parameter. The "glitter" resources are an FX flipbook texture, a quest inhaler's multilayer flake microblend and car-paint setups. | — | No vanilla glint material exists [resource] |
| **Community: *Winterkissed* (Limerence × AllieKat)** | Six looks, all `mesh_decal` in mode 0. They use 4096² diffuse/normal/roughness/metalness maps on the vanilla eye-makeup UVs (≈ 0.016 mm per texel) and a full 13-level chain (how it was made is not recorded). In the three looks measured, normals are **embossed outlines** of stars, circles and hexagons: tilted rims around flat interiors. Metalness is ≈ 1 and roughness 0–0.25 over the covered area. `NormalAlpha` 10, `RoughnessMetalnessAlpha` 10 and `UseNormalAlphaTex` 10 over-drive the alphas so they saturate. The normal mask points at a separate noise-band texture that overlaps only part of the coverage (full normal weight on about 1–3 % of covered texels). | Yes, as a metallic foil with glinting outlines | Evidence that the community ships glitter through the same template. Its outline normals give rings, not flat flakes, the pattern our reference review rejected. A useful in-game reference |

The *Winterkissed* figures come from its installed 1.1.0 archive ([experiment 018](../experiments/018-glitter-route/README.md#community-glitter-winterkissed)); what it looks like in game is not recorded here.

## 3. Primary route: resolved glint flakes (`mesh_decal`, plate-local window)

One draw per preset on the lifted plate, as today, with a new material entry (the UV constants are per material). The recipe below is the [board's](../experiments/018-glitter-route/README.md#diagnostic-board) *Glitter A* default.

| Part | Specification | Grade |
|---|---|---|
| Template | `base\materials\mesh_decal.mt`, MeshSkinned `post_gbuffer` | [source] |
| UV window | The production window Build derives from the plate: its stored UV0 bounds widened by 1/64 of the span per side (stored U 0.2659–0.7339, V 0.6739–0.8236 for the built-in plate). `UVScaleX` 2.136780, `UVOffsetX` 0.000261, `UVScaleY` 6.680135, `UVOffsetY` −1.661879. The negative V offset follows from WolvenKit's bottom-to-top row storage and is checked on every build ([experiment 019](../experiments/019-uv-window/README.md)). The diagnostic Glitter route uses the same constants at 4096×1024, and its decoded maps land in place with the same sign ([experiment 021](../experiments/021-glitter-board/README.md)). | [source] formula; sign [offline]; placement in game [hypothesis] |
| Texture size | 4096×1024 (0.064 × 0.060 mm per texel), about 8 times the linear density of today's 1024 atlas. The budget option is 2048×512 (0.13 × 0.12 mm). | [resource] measured |
| Constants | `DiffuseAlpha` 1, `NormalAlpha` 1, `UseNormalAlphaTex` 1, `NormalsBlendingMode` 1, `RoughnessMetalnessAlpha` 1, scales 1, biases 0, `AlphaMaskContrast` 0 | [source] |
| `DiffuseTexture` | sRGB RGBA (`isGamma` 1). RGB is the pigment, or the flake colour on flake texels (linear mix by flake coverage). A is √(pigment coverage), with the flat route's coverage-space mip chain. | [source] |
| `NormalTexture` | Linear RG (`TCM_Normalmap`): each flake's tangent x, y, **dilated** 2 texels beyond its edge so bilinear and trilinear taps never average a flake with flat. Flat (0.5, 0.5) elsewhere. | [source] sampling; dilation [offline] |
| `NormalAlphaTex` | Linear R: flake coverage, antialiased. This carries each flake's shape; between flakes the skin normal is untouched. | [source] |
| `RoughnessTexture` | Linear R: flake roughness (0.22) on flakes and pigment roughness (0.50, the calibrated Satin candidate) elsewhere. At coarse levels the background widens toward ((r_f²)² + E[sin²θ])^¼ in proportion to the flake area no longer represented. | [source] channel; sheen [offline] |
| `MetalnessTexture` | Linear R: flake metalness (0.85) on flakes. Elsewhere 0 plus the unrepresented share × flake metalness. | [source] |
| Flake statistics | Width: log-normal, median 0.2 mm, σ 0.35 (about 3 texels at level 0). Covered area 15 %. Tilt \|N(0, 25°)\| truncated at 50°, azimuth uniform. Each flake is a flat hexagon-like facet with one constant normal and no bevel rim. Colour, roughness and metalness are per flake. | Design choice; [offline] |
| **Mip strategy: nested flake mips** | Level L re-draws each flake at width max(w, 2 texels of L). It keeps the prefix, in a stable per-flake key order, whose enlarged area covers 15 % × 0.7^(L − L*), where L* is the first level that enlarges the median flake. No representative wider than 1.2 mm is drawn (level 4 and beyond at 4096); that energy becomes sheen. Lower keys draw on top at every level, so the flakes kept at a coarse level are the same flakes, at the same places, as at finer levels. | [offline] ([results](../experiments/018-glitter-route/README.md#results)) |
| Per-flake variation encoding | Orientation goes in normal RG, shape in `NormalAlphaTex`, colour in diffuse RGB, highlight sharpness in roughness R, and reflectance in metalness R (F0 = lerp(0.04, colour, m)). Identity is the catalogue key that orders nesting. | [source] |
| Memory | Five maps at 4096×1024, block-compressed, with mips: about 19 MiB per glitter preset. *Winterkissed* uses five 4096² maps per look, about 100 MiB, over five times as much. | Estimate |

**Offline result [offline]:** the share of lid pixels that sparkle for a given light (more than 20 times the plain pigment's own highlight peak), averaged over 60 light directions, after the temporal clamp. Each level is measured at the framing where one texel is about one pixel.

| Mip level (texel) | Nested chain | Plain BOX of the same base | Today's faceted rule |
|---|---:|---:|---:|
| 0 (0.06 mm) | 0.78 % | 0.78 % | 0.78 % |
| 1 (0.12 mm) | 0.59 % | 0.50 % | 0.50 % |
| 2 (0.25 mm), about face framing | 0.41 % | 0.13 % | 0.13 % |
| 3 (0.50 mm) | 0.28 % | 0.009 % | 0.008 % |

Today's 1024 atlas has level-3-sized texels at its *base*. That is why the Shimmer bake's facets are millimetres wide.

**Screen scale (test setup, assumed DLSS render scale ≈ 0.58):**

| Framing | Internal pixels per mm | Expected mip at 4096×1024 | Representative flake |
|---|---:|---:|---|
| Close-up, eyes fill frame | ≈ 16 | 0 | 0.2 mm ≈ 3 px |
| Face framing | ≈ 3 | ≈ 2.4 | 0.5 mm ≈ 1.5–2 px |
| Gameplay, about 1 m | ≈ 0.7 | ≈ 4.5 | Sheen only |

The framings are estimates. A negative upscaler mip bias would move every row one level finer and shrink the representatives toward 1 pixel.

## 4. Fallback: the primary maps plus an emissive sparkle accent

This covers the case where glints of analytic lights prove too rare, or are suppressed by DLSS at face framing. A second plate render chunk carries the accent, using the multi-chunk mechanism already built for [experiment 017](../experiments/017-plate-depth/README.md#pipeline-changes-for-review). Its material is `base\materials\mesh_decal_emissive_subsurface.mt`:

| Part | Specification | Grade |
|---|---|---|
| `EmissiveMask` | R holds the accent flakes: the lowest-key 8 % of the same catalogue, drawn at least 2 texels wide in a **head-UV 2048 atlas** (≈ 0.28 × 0.20 mm texels; the template has no UV transform), with nested mips | [resource] parameters; [source] sampling |
| Other parameters | `EmissiveMaskChannel` (1, 0, 0, 0), `EmissiveColor` = flake colour, `AlphaThreshold` 0; leave `SecondaryMask` at its default white. **`EmissiveEV` must be above 0**: this program writes `EmissiveEV × EmissiveColor` as a plain product, not `2^EV`, so 0 is black. Experiment 021 uses 1, which writes the flake colour itself: the brightest value that keeps every channel in the colour's 0–1 range, so it should be visible without an over-range glow; the knob and the verifier refuse 0 or below | [source] ([decal reference §5.4](../research/materials/shader-decal.md#54-emissive-decals)) |
| Behaviour | Constant glow, independent of light and view. It is sparse, so it reads as always-lit points. Its opacity is `MaterialModifiersConsts[2].x` × mask, a per-draw engine modifier: if the engine leaves it at 0 on a CCXL head component, the accent draws nothing at any `EmissiveEV`. The visible result of the `subsurface_emissive` stage over skin, and whether it blooms, are unknown. | [source]; modifier value and look [hypothesis] |

Label it in the Studio as a stylised sparkle, never as reflective glitter. The primary maps stay in the preset, so real glints still appear where lights allow.

## 5. What the Studio preview must match

A **game-matched Glitter model** (like Shimmer's, recipe `optics`) has to:

1. **Upload the export's own textures**: the window maps with their exact nested mip chains, bound through the same UV transform. Do not use Three's automatic mips. Sample trilinear and anisotropic.
2. **Compose one normal per pixel the way the decal does**: RNM onto the skin normal, alpha = mask × saturate(50 − 50z), and a lerp in the encoded normal. Roughness, metalness and colour blend at coverage², with colour in square-root space.
3. **Light it like the game**: Burley diffuse plus the skin class's two GGX lobes (×0.966 and ×1.597, summed), F0 = lerp(0.04, albedo, metalness), roughness ≥ 0.04.
4. **Not evaluate glints per fragment.** The browser direct-light, clustered and fine-speckle models (recipes 8–10) compute sub-pixel glints the game cannot draw; they stay preview-only studies.
5. **State the known gap.** The browser has no temporal clamp, so one-pixel sparkles look stronger in the preview than in game. The maps avoid sub-2-texel flakes by construction, which keeps the gap small at the level being sampled.

The recipe fields should be physical, and each maps one-to-one onto the catalogue: flake colour, width (mm), covered area (%), tilt spread, sharpness (roughness) and reflectance (metalness).

## 6. What the next sessions should show

- **Session 2 (pending), *Shimmer · strong*.** Its facets are about 2.8 mm discs tilted at most 23°. Prediction: coarse, hammered-metal highlight patches close up and a broader gloss at face framing, not point sparkle. If it does show points, the facet contrast is doing more than this analysis expects.
- **The glitter board** (designed in [experiment 018](../experiments/018-glitter-route/README.md#diagnostic-board), built and verified offline in [experiment 021](../experiments/021-glitter-board/README.md), not yet staged): six presets that separate the base recipe, nested against BOX mips, flake width, flake surface, tilt spread and the emissive accent, with a DLSS-against-DLAA check.

## Open questions

1. Which program is the main anti-aliasing when no upscaler runs? Does it clamp like `m_simpleTemporal`?
2. Does the engine apply a negative texture LOD bias when an upscaler is active, and how large?
3. How do DLSS (the Transformer model), FSR3, XeSS and Ray Reconstruction treat stable 2–3 pixel glints and moving ones?
4. Does variable-rate shading, if enabled, coarsen `mesh_decal` pixels on the face?
5. What roughness shift do photo-mode lights apply per light (the per-light roughness byte)?
6. Do metal flakes' environment reflections survive the RT reflection denoisers at all?
7. At what brightness do glints start to bloom?
8. What does `mesh_decal_emissive_subsurface` look like over skin, and does it bloom? Does the engine set its opacity modifier (`MaterialModifiersConsts[2].x`) on a CCXL head component at all?
9. Does a lower Texture Quality setting drop the top mip of mod textures? The nested chain is designed so every level stands alone.
10. What precision do GBuffer1 (normal) and GBuffer2 have? This affects small tilts only.

---

Related: [materials and shaders](materials-and-shaders.md) · [Glitter design](../research/materials/finish-designs/glitter.md) · [Shimmer design](../research/materials/finish-designs/shimmer.md) · [glitter backlog](../research/backlog/glitter-material.md) · [experiment 018](../experiments/018-glitter-route/README.md) · [experiment 009](../experiments/009-glitter-game-fixture/README.md) · [glint feasibility](../research/materials/redengine-glint-feasibility.md) · [filtering research](../research/materials/glitter-filtering-research.md). Community sources are acknowledged in the [community credits](../docs/community-credits.md).
