# Glitter game route: evidence, measured map design and a diagnostic board

**Status:** research design, 25 September 2026. The route is traced from compiled programs and installed files; the map design is measured offline with an asset-free generator. The board below is now built through the production pipeline as a diagnostic candidate and verified offline in [experiment 021](../021-glitter-board/README.md); it is not staged, the production Glitter export guard is unchanged, and no glitter route has been seen in game. The consolidated answer is in [Glitter in game](../../knowledge/glitter-in-game.md); this page holds the evidence, the method and the board.

Evidence grades as in the knowledge base: **[source]** compiled programs or tool source; **[resource]** installed game or mod files; **[offline]** measured here; **[runtime]** seen in game; **[hypothesis]** not established.

## Question

Session 1 (25 September, photo mode) showed the default faceted Shimmer (128 cells, tilt 0.65) as a diffused gloss rather than sparkle. Can any game mechanism show discrete sparkles that respond to light and view on the eye plate, at face distance and close up? If so, what exactly should the Glitter export write?

## Texel density

The plate's UVs are the head's own UV0, so it samples only a 0.453 × 0.145 rectangle (4 % of the atlas).

Measured over the built-in plate's 3,010 triangles with the Jacobian of each triangle's UV-to-surface map [resource] (method: `redmesh.py` from [experiment 017](../017-plate-depth/README.md) plus a per-triangle least-squares Jacobian):

| Mesh | World length per UV unit (area-weighted median; q10–q90) | Texel at 1024 | Texel at 4096 |
|---|---|---|---|
| XF plate, head UV0 | 569 mm along U (396–656), 405 mm along V (339–606) | 0.56 × 0.40 mm | 0.14 × 0.10 mm |
| Vanilla eye makeup (`winterkissed_w.mesh`, byte-identical vanilla geometry) | 66 mm (52–81), isotropic; both eyes overlap in UV (UV area 1.13) | 0.065 mm | 0.016 mm |

**Consequence for Shimmer.** `bakeFlakes` doubles the cell count for Shimmer, and a facet's radius is 0.39 cell. At the packaged 1024 atlas the default facets (256 effective cells) are 3.1 texels, about **1.4 mm**, wide. 017's *Shimmer · strong* (128 effective cells) makes 2.8 mm facets, and Board 2's coarse "glitter proxy" (`cells: 32`, 64 effective) makes 5.6–6 mm facets. Their tilts are at most 15° (default) or 23°, and mode 1 gates tilts under 11.5°. Session 1's "diffused gloss" is what millimetre-wide, weakly tilted, partly gated facets should look like.

**The window.** `mesh_decal` applies `UVScale`/`UVOffset` to every texture it samples [source]. The UV rectangle U 0.2686–0.7312, V 0.6733–0.8243 (mesh convention: the plate bounds plus a margin) maps to [0,1] with:

| Constant | Value |
|---|---|
| `UVScaleX` | 2.161695 |
| `UVOffsetX` | 0.000216 |
| `UVScaleY` | 6.622517 |
| `UVOffsetY` | −1.647682 |

In a non-square texture the texels come out nearly square: 4096×1024 gives 0.064 × 0.060 mm, and 2048×512 gives 0.13 × 0.12 mm. The game ships non-square XBMs, for example the 2048×1024 brow textures [resource]. The V constants assume the mesh's V; the export's image-row convention (WolvenKit's vertical flip) must be checked on one decoded export before any game test [hypothesis].

## TAA and upscalers

The static programs below were extracted from `staticshader_final.cache` (SHA-256 `bff16094…59ff`) with [`shader_cache.py`](../../research/materials/shader-system/README.md), then decompiled with dxil-spirv `f2d1b554` and SPIRV-Cross `aa217aeb`:

| Program | DXBC SHA-256 | Reading [source] |
|---|---|---|
| `m_simpleTemporal` `525406595650312948` | `a0723f70…1b17` | Loads 5 cross taps of the current colour and encodes them with the SMPTE ST 2084 (PQ) curve (m1 0.1593, m2 78.84, c1 0.8359, c2 18.85, c3 18.69). It takes their mean and population σ, samples history with a 9-tap Catmull-Rom at the reprojected UV (velocity from the closest depth in a 3×3), clamps history to mean ± σ, blends 5 % current (100 % when a reset flag is set) and decodes. |
| `m_postfxFSR2_prepare_reactivity_mask` `881371692195232951` | `d401e64a…ffad` | reactivity = clamp(max(input0, half-res input1) + [stencil low 5 bits = 18], floor, 0.9) |
| `m_postfxXESS2_prepare_reactivity_mask` `15039989337359667650` | `bfdbfcf8…8346` | The same without the stencil term |
| `m_dlssConvertColorBiasMask` `7261057323686950841` | `8edbebf4…5859` | colour-bias mask = (input ≠ 0) |

**What the temporal clamp does to one glint.** A stable glint of PQ value g, with dark neighbours, has a cross mean of 0.2g and σ of 0.4g. The history clamps to 0.6g and settles at 0.05g + 0.95·0.6g ≈ 0.62g. Because PQ is close to logarithmic, that is roughly an order of magnitude dimmer in linear light (the scale the engine feeds the curve is unknown). A 1×2 glint settles at ≈ 0.9g, and a 2×2 glint keeps its full value.

The `m_postTXAA*` technique names have no attributed program in our index, so that the main anti-aliasing behaves like `m_simpleTemporal` is [hypothesis]. DLSS (`nvngx_dlss.dll`, Ray Reconstruction `nvngx_dlssd.dll`), FSR3 (`ffx_fsr3upscaler_x64.dll`) and XeSS (`libxess.dll`) are closed [resource].

Decals write with stencil disabled, so a makeup decal cannot raise the reactivity mask [source].

Every decal texture is read with `Sample` through one sampler (`TA_Wrap`, anisotropic min, linear mag and mip). Any upscaler LOD bias is therefore engine-side and invisible offline [source].

The test setup's saved settings are DLSS "Auto" (Transformer model) at 3840×1600, ray-traced lighting (Ultra) and reflections on, path tracing off, anisotropy 16, texture quality High, with film grain, chromatic aberration, depth of field and motion blur on [resource].

## Community glitter: Winterkissed

*Limerence X AllieKat Winterkissed AXL Eyeshadows* 1.1.0 (Nexus mod 18323; install file "Limerence AXL Glitter Eyeshadows") is installed in MO2. It was unbundled read-only with WolvenKit CLI 9.0.1 into the ignored `research/consumers/glitter-route/raw/winterkissed/`, then serialized and exported to PNG. It is an equipment item in the eyes slot, not a character-creator option [resource]:

- **Materials.** Six looks (black_ice, first_snow, frost, frost_queen, golden_girl, starry_eyed), each a `.mi` over `base\materials\mesh_decal.mt` with only these values: `DiffuseAlpha` 1, `NormalAlpha` 10, `RoughnessMetalnessAlpha` 10, `UseNormalAlphaTex` 10, and the textures `_d01` (diffuse), `_n01` (normal), `_r01` (roughness), `_m01` (metalness) and `_d02` (as `NormalAlphaTex`). `NormalsBlendingMode` is left at 0 (replace).
- **Textures.** All are 4096², with a 13-level mip chain and `TCM_QualityColor`, except the normal maps (`TCM_Normalmap`). Diffuse maps are gamma; the other maps are linear.
- **Maps** (measured on starry_eyed, golden_girl and frost). Over the covered area metalness averages 0.98–1.0 and roughness 0.003–0.25. Normals are embossed outlines: stars (starry_eyed, golden_girl) or circles and hexagons (frost), with tilted rims and flat interiors. Tilt within coverage: median 0.7–2.5°, 90th percentile 18–38°, 99th percentile 46–60°.
- **The normal mask.** `_d02` is a noise band that overlaps only the upper part of the coverage. With `NormalAlpha` 10, the normal is written at full weight on 1–3 % of covered texels and at a mean weight of 0.26.
- **Reading.** A metallic foil with glinting shape outlines, on UVs about 7 times denser than our plate's. It is proof that the community ships "glitter" through plain `mesh_decal`. It is not a flat-flake glint design, and its outline normals produce the ring pattern our [reference review](../../research/materials/glitter-reference-review.md) rejected.

## Method: the generator

[`make_maps.py`](make_maps.py) needs numpy and Pillow and reads no game files. For each preset of the board below, it:

1. **Builds a flake catalogue in millimetres** for each region: log-normal widths, flat hexagon-like facets with a random aspect ratio and rotation, tilt |N(0, σ)| truncated at a maximum, uniform azimuth, and a stable rank key.
2. **Draws a nested chain.** Level L re-draws flakes at width max(w, 2 texels of L), keeping the key-ordered prefix that covers 15 % × 0.7^(L − L*), with none wider than 1.2 mm. Normals are dilated 2 texels (a flake's own footprint always wins over a neighbour's dilation); the mask carries the shape. Unrepresented flake area becomes sheen: roughness toward ((r_f²)² + E[sin²θ])^¼, and metalness and colour toward the flake's by that share.
3. **Builds two comparison chains from the same level 0:** the plain BOX chain, and "today's rule" (flake normal × coverage, BOX-averaged, gated only by mode 1, as `route-mip-chains.ts` does for Shimmer).
4. **Lights every level** as if one texel were one pixel. The normal is lerp(flat, flake, mask × gate). Specular is the skin class's two GGX lobes (×0.966, ×1.597), with F0 = lerp(0.04, luminance, metalness), for 60 light directions 10–50° off the normal and a frontal view. A pixel "sparkles" above 20 times the plain pigment's own highlight peak. The decoded temporal clamp is then applied at steady state.

`result.json` records every level's texel size, flakes represented, minimum width, mask mean and sparkle share (before and after the clamp) for the shipped, BOX and today's-rule chains.

```powershell
python experiments/018-glitter-route/make_maps.py            # all presets, 4096x1024 -> result.json (about 2 minutes)
python experiments/018-glitter-route/make_maps.py --preset A --png   # PNG chains into ignored generated/A/
```

## Results

[offline] Share of lid pixels that sparkle for a given light, **after the temporal clamp**, averaged over 60 lights (from [result.json](result.json)):

| Preset / region | L0 (0.06 mm) | L1 (0.12 mm) | L2 (0.25 mm) | L3 (0.5 mm) |
|---|---:|---:|---:|---:|
| A: base recipe, nested | 0.78 % | 0.59 % | 0.41 % | 0.28 % |
| A: same base, plain BOX | 0.78 % | 0.50 % | 0.13 % | 0.009 % |
| A: today's faceted rule | 0.78 % | 0.50 % | 0.13 % | 0.008 % |
| C: 0.12 / 0.25 / 0.5 mm, nested (left lid) | 0.71 / 0.91 / 0.92 % | 0.46 / 0.72 / 0.82 % | 0.26 / 0.42 / 0.62 % | 0.17 / 0.40 / 0.51 % |
| D: roughness 0.12 / 0.22 / 0.35 (metalness 0.85) | 0.37 / 0.81 / 0.65 % | 0.33 / 0.64 / 0.35 % | 0.23 / 0.41 / 0.18 % | 0.18 / 0.37 / 0.15 % |
| D: metalness 1.0 / 0.6 / 0.25 (roughness 0.22) | 0.86 / 0.65 / 0.17 % | 0.68 / 0.38 / 0.11 % | 0.45 / 0.23 / 0.06 % | 0.27 / 0.13 / 0.03 % |
| F: tilt 10°/20° · 25°/50° · 40°/70° (frontal view) | 1.44 / 0.90 / 0.57 % | 1.09 / 0.71 / 0.42 % | 0.69 / 0.46 / 0.25 % | 0.49 / 0.44 / 0.22 % |

Reading:

- **Nested mips matter from level 1, decisively at level 2 and beyond.** At about face framing they keep 3 times the sparkling pixels of BOX; one level further, 30 times.
- **At level 0 the window's resolution does all the work.** All three chains agree there.
- **Level 4 and beyond are sheen only** (representatives would exceed 1.2 mm).
- **Low tilt spreads sparkle more often under frontal light and view.** Wide tilt spreads sparkle at more extreme angles, which the fixed frontal view here under-samples.
- **The narrowest lobe (roughness 0.12) sparkles on fewer pixels, but each is brighter;** this metric counts pixels, not brightness.

**Limits.** The lighting model omits visibility, NdotL weighting beyond a cut-off, SSS, reflections and bloom. "One texel = one pixel" ignores trilinear blending between levels and anisotropy. The temporal clamp is `m_simpleTemporal`'s, not DLSS's. The regions are the finish board's lid rectangles converted with median mm-per-UV, not exact lid geometry. These are forecasts to make the session informative, not a validation.

## Diagnostic board

Six presets plus Off in the XF selector. Names are at most 24 characters (all 16–19), and every patch uses one plum pigment (`#6d4a7e`, background roughness 0.50) and gold flakes (`#e8c46a`). Lid rectangles are the [finish board's](../016-finish-board/README.md) (glTF UV0; left lid u 0.300–0.444, v 0.211–0.248, three stripes outer to inner, right lid mirrored). Every preset uses the primary route (§3 of the knowledge page) with the window material. *Glitter E* adds the accent chunk.

| # | Preset | Left lid | Right lid | Tests |
|---|---|---|---|---|
| 1 | **Glitter A · base** | Base recipe: 0.2 mm, 15 %, tilt 25°/50°, roughness 0.22, metalness 0.85, nested mips | Same pigment, no flakes (Satin control) | Does it read as glitter: points that flash and go dark with the light close up, some points at face framing, a sheen far away? |
| 2 | **Glitter B · mips** | Base recipe, nested mips | The same flakes mirrored, identical level 0, plain BOX mips | Does the nested chain keep points to face framing where BOX turns to mottle? |
| 3 | **Glitter C · size** | 0.12 · 0.25 · 0.5 mm | Mirrored (another seed) | Is the 2-pixel rule real under DLSS? The 0.12 mm stripe should lose points first close up. At face framing all three converge by design (representatives ≥ 0.5 mm). |
| 4 | **Glitter D · surface** | Roughness 0.12 · 0.22 · 0.35 | Metalness 1.0 · 0.6 · 0.25 | Sharp and rare against broad and frequent glints; do metal 1.0 flakes read as dark dots when unlit? |
| 5 | **Glitter E · accent** | Base recipe plus an emissive accent (8 % of flakes, `mesh_decal_emissive_subsurface`, second chunk) | Base recipe only | Does the accent add readable sparkle at face framing? How does it look in dim light (it will glow)? |
| 6 | **Glitter F · tilt** | Tilt σ/max 10°/20° · 25°/50° · 40°/70° | Mirrored (another seed) | How glint frequency and orbit behaviour depend on tilt spread |

**Before building it (all offline; all done in [experiment 021](../021-glitter-board/README.md#offline-checks-before-a-session)):**

- Add the window material entry and non-square maps to a *diagnostic* route. Do not change the production Glitter guard.
- Check the V sign on one decoded export.
- Confirm the BC5 decode error on 3-texel flakes, and that WolvenKit keeps the supplied chains (proven for square maps in [flat mip filtering](../../research/materials/flat-preset-mip-filtering.md)).
- Run the independent verifier.

### Test card (for the session after the board is built)

1. **Record the setup.** Game version; upscaler and mode (DLSS Auto, Transformer); ray tracing and path tracing state; resolution. In photo mode, turn film grain, chromatic aberration and depth of field **off** for the captures. Keep the ArchiveXL log. Stage the board; the XF selector lists Off plus six presets with the names readable.
2. **A, close-up** (eyes fill the frame, fixed camera). Sweep one photo-mode key light slowly across the lids and take three screenshots at different light angles; a short clip if possible. Then orbit the camera with the light fixed. *Expect:* individual gold points on the left lid that switch on and off as the light moves, with the right lid smooth.
3. **A, face framing, then about 1 m.** *Expect:* a handful of points at face framing, sheen only at 1 m.
4. **B.** From close-up, pull back slowly to face framing. Note when each lid's points disappear. *Expect:* the left (nested) keeps points longer. The right (BOX) turns to a mottled sheen.
5. **C**, close-up and face framing, first with DLSS as set, then with **DLAA** (or the highest-quality mode) at the same framings. *Expect:* the 0.12 mm stripe loses points first under DLSS; DLAA narrows the gap.
6. **D and F**, close-up light sweep. Note which stripes give crisp points, broad patches or dark dots.
7. **E**, face framing under normal light, then in a dark scene or with lights off. *Expect:* the left lid's accent points stay visible even in the dark. Is that acceptable as a labelled stylised option?
8. **A**, blink and slow head turn. Then switch E → A → Off to check that the accent chunk clears.
9. **Optional reference.** If *Winterkissed* is already enabled in the profile (do not change the mod list for this), equip "Golden Girl" and take the same close-up and face-framing shots.

## Reproduce the source evidence

- **Plate density:** serialize the built-in plate mesh into the ignored `research/consumers/plate-depth/raw/platejson/`, then compute each triangle's UV-to-surface Jacobian with `redmesh.decode_blob`.
- **Static programs:** run `python research/materials/shader-system/shader_cache.py extract 525406595650312948 881371692195232951 15039989337359667650 7261057323686950841`, then `dxil-spirv` and `spirv-cross --hlsl --shader-model 60`.
- **Winterkissed:** `WolvenKit.CLI unbundle "<mod>/archive/pc/mod/Winterkissed Cyberware XL.archive" -o research/consumers/glitter-route/raw/winterkissed`, then `convert serialize` and `export --uext png -gp <game>`.
- **Template sampler and shading-rate fields:** the serialized `.mt` JSON under `research/consumers/shader-system/raw/templates/`.

No game, mod or extracted bytes are tracked here; only the generator, this page and `result.json`.

## Provenance

- **Game resources.** CD PROJEKT RED's installed game resources and caches, read-only.
- **Tools.** WolvenKit CLI 9.0.1, used for unbundling, serialization and export; dxil-spirv and SPIRV-Cross, used as decompilers.
- **Community mod.** *Winterkissed* by Limerence with AllieKat, studied from the local MO2 installation. None of its files, maps or values are reused; it informed the comparison and is credited in the [community credits](../../docs/community-credits.md).
- **Flake model.** Independently written. island_dancer's lesson that facets need visibly varied tilts (already credited) shaped the tilt distribution.
