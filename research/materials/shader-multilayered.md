# Multilayered shader reference: `multilayered*.mt` (game 2.31)

Fifth and last per-family reference of the [materials and shader study](../backlog/materials-shader-re.md), after [skin](shader-skin.md), [hair](shader-hair.md), [eye](shader-eye.md) and [decals](shader-decal.md). It gathers the family in one place: the templates and their passes, the layer stack and how its resources reach the program, the per-pixel arithmetic (masks, microblends, per-layer roughness, metalness, normal and colour scale), the variants (weather, dissolve, clear coat, the baked surface cache), what the family can and cannot do for mixed makeup finishes and transparency on a face plate, and how the Studio's layered adapter matches. The line-level evidence for the G-buffer program is the [multilayered shader evidence](multilayered-shader-evidence.md), which this page summarises and extends; the consolidated reading is [materials and shaders §4.6](../../knowledge/materials-and-shaders.md#46-multilayered-enginematerialsmultilayeredmt-multilayered_clear_coatmt). Which Studio code relies on which fact is in the [shader fact index](shader-fact-index.md#layered-materials).

**Labels.** **[observed]**: read directly in a compiled 2.31 program or an installed resource. **[source-supported]**: supported by tool or engine source, the wiki, a community tool, a developer publication, or a close structural match to a published technique. **[hypothesis]**: not established. Nothing here was observed in a running game.

## 1. Pinned inputs

| Input | Identity |
|---|---|
| Game | 2.31 (`GameVersion 2310`) |
| `shader_final.cache` / `staticshader_final.cache` | SHA-256 `339145…3ccfa` / `bff160…59ff` ([shader-system note](shader-system/README.md#inputs-read-only)) |
| `base\materials\multilayered_clear_coat.mt` | SHA-256 `0893221f…3518` ([glossy feasibility](glossy-decal-feasibility.md)) |
| Method | [shader-system method](shader-system/README.md#method-repeatable-in-minutes); the annotator names this family's cb4 registers from the wrong namespace (see [evidence](multilayered-shader-evidence.md#programs-read)), so registers are read from the listings' own offsets. Listings stay local and ignored |

| Program (MeshSkinned unless noted) | GUID | DXBC SHA-256 |
|---|---|---|
| `multilayered` `gbuffer_regular` Index 1 (MeshSkinned and MeshStatic) | `4792354088802328889` | `284dcd76…5046a3fc` |
| same, Index 2 (pass flag `0x80000`, weather) | `4972527321905975234` | `e0932778…5eff23e1` |
| same, Index 2, Discarded (dissolve) | `11355571133397203527` | `54064901…7baad5c3` |
| `multilayered_clear_coat` `gbuffer_regular` | `3911537533623547427` | `3e58f161…bbb31ccc` |
| `multilayered_clear_coat` `unlit` (the coat) | `5403688829342147459` | `2d4cb586…addad5` |
| `multilayered_baked` `gbuffer_regular` | `9875025106086992270` | `2db643c1…2acf680` |
| static `m_surfaceCache_GenerateMultilayer` (compute) | `7318179378413828262` | `a750b9cf…dc7a15` |

## 2. The family

| Template | Class, masking | Vertex factories | What it is [observed] |
|---|---|---|---|
| `engine\materials\multilayered.mt` | Standard, **`canBeMasked` 0** | 12, including MeshSkinned, garment and LightBlockers factories | The layered surface: earrings and piercings, 37 graphic eye designs, most clothing, weapons and props |
| `multilayered_clear_coat.mt` | Standard, maskable | MeshStatic, MeshSkinned, MeshExtSkinned, garments | The same layers plus a forward coat lobe over a chosen layer range (§6) |
| `engine\materials\internal\multilayered_baked.mt` | Standard | 7 | Reads a runtime virtual texture of already-composited layers (§7) |
| `multilayered_cable_swing.mt` | Standard | 7 | Layers plus wind-driven vertex swing (cables) |
| `multilayered_terrain.mt` | Standard | MeshStatic, Terrain | Terrain splatting with its own tiling, variation and foliage mask |
| `multilayered_debug.mt` | Standard | 7 | No parameters; an editor view |

All are Standard class: none writes the Subsurface, Eye or Hair class [observed].

## 3. Passes and variants

From the serialized templates [observed]:

| Template | Stage (flags) | Depth | Blend | Notes |
|---|---|---|---|---|
| `multilayered` | `depth_prepass` (2097152) | test and write | — | No pixel program: **the surface is in the depth prepass** |
| | `gbuffer_regular` (1) and (524289 = `0x80001`) | `GreaterEqual`, write on, stencil on, `CULL_Back` | **off** on all targets | Index 1 is the layer program; Index 2 adds weather (§5.5) |
| | `gbuffer_velbuff_regular` (33, 524321), `cascade_regular` (2), `highlights` (512) | | | Motion vectors, sun shadows, outline |
| `multilayered_clear_coat` | `gbuffer_regular`, `gbuffer_velbuff_regular` | write on | off | The base layers; GBuffer2.z carries the coat mask (§6) |
| | `unlit` (1, 33) | test **`Equal`**, write off, `CULL_Back` | `One/Src1Color`, alpha `One/InvSrcAlpha`, RGBA | The coat, dual-source |
| | `transparent_mark_rt` (1, 33) | write on | off | [hypothesis: marks the pixels for ray-traced transparency or reflections] |
| `multilayered_baked` | `gbuffer_regular`, `cascade_regular`, `velocitybuffer` | write on | off | |

- **Opaque and depth-writing, with no blend on any target, in every multilayered G-buffer pass** [observed]. The multilayered G-buffer program writes GBuffer0.a = `MaterialModifiersConsts[0].y / 3` and GBuffer1.a = GBuffer2.w = 0 [observed]; the class is Standard.
- **The Discarded variants are a whole-draw dissolve.** `11355571133397203527` is the Index 2 program plus the same temporal-dither discard the decal family's Discarded variants carry (`t67` noise × `MaterialModifiersConsts[0].z` + `[0].w` < 0), compiled even though the template cannot be masked [observed] ([decal §2.3](shader-decal.md#23-what-the-discarded-variants-are)). It fades a whole draw in or out under engine control; it is not per-texel transparency.

## 4. Inputs: the layer stack

Resources ([evidence, serialized shapes](multilayered-shader-evidence.md#serialized-shapes-resource)) [observed]:

- **`.mlsetup`** (`MultilayerSetup`): an ordered list of up to 20 layers ([wiki] `multilayered/README.md`), each naming a **`.mltemplate`** (colour, normal, roughness and metalness maps, `tilingMultiplier`, colour-mask levels, override tables) and choosing `colorScale`, `normalStrength` and `rough/metalLevelsIn/Out` **by name** from that template's tables, plus numeric `opacity`, `matTile`, `mbTile`, `microblend` (a texture), `microblendContrast`, `microblendNormalStrength` and offsets.
- **`.mlmask`** (`MultilayerMask`): one mask per layer, stored as a BC4 tile atlas with full- and low-resolution tile tables.
- **Runtime buffers** the engine fills from those [observed read side]: `Layers` (`StructuredBuffer<MultilayerLayerParam>`, stride 128), `MaskTiles` (a byte buffer of `{firstEntry, layerBits}` tiles), `MaskAtlas`, `LayersStartIndex`, `SetupLayerMask` and the mask dimensions. The byte layout of `MultilayerLayerParam` and the likely field mapping are in the [evidence](multilayered-shader-evidence.md#findings), item 2.
- Mesh-wide: `GlobalNormal` with `GlobalNormalIntensity`, `GlobalNormalUVScale`/`Bias`, and **`NormalsTextureDDXYMultiplier` / `MicroblendsTextureDDXYMultiplier`** (§5.4).

Colour maps are sRGB (`isGamma`), roughness, metalness, normals and microblends linear [observed, resource].

## 5. The G-buffer program

Program `4792354088802328889`; the arithmetic is [observed] and checked line by line in the [evidence](multilayered-shader-evidence.md#findings), items 3–5. In brief:

### 5.1 Masks and the stack order

- A pixel's candidate layers are the OR of its full- and low-resolution tiles' layer bits, masked by `SetupLayerMask`; a **wave-wide OR** makes all pixels of a wave loop over the union.
- Layers are visited **front to back**, from the highest index down; the bottom layer (the lowest bit) ignores its mask. A masked layer with no data at the pixel is skipped.
- Mask `m` is bilinear at `(frac(u), frac(1 − v))` in the atlas tile.

### 5.2 Coverage and shares

```
mb = Microblend(offset_mb + mbTile·frac(uv));  k = 1 − mb.a
mp = saturate(k + (m − k)·c)                 // c: the layer's contrast factor
a  = mp · opacity
w  = min(remaining, a);  remaining −= w       // each layer takes a share of what is left
```

**Not a lerp stack**: two half-covering layers over a base give 0.5 / 0.5 / 0, and coverage left at the end is black with zero roughness and metalness [observed]. The microblend crossfades the mask edge with its own alpha, so a layer's boundary follows the microblend's pattern (scratches, chips, fibre) at a tiling independent of the mask's resolution.

### 5.3 Per-layer values

| Quantity | Per layer | Accumulated |
|---|---|---|
| Roughness | the template map's R through `saturate(saturate(x·in₀ + in₁)·out₀ + out₁)` (the stored level pairs are scale/bias) | Σ w·r |
| Metalness | the same chain on its own map | Σ w·m |
| Colour | colour map × `lerp(1, colorScale, cm)`, `cm` the same chain on the **roughness** map through the template's colour-mask levels | Σ w·colour |
| Normal | the layer map's RG × `normalStrength` | Σ w·n, plus microblend normals weighted at the mask edge |

`colorScale` is multiplied raw; templates storing `colorMaskLevelsOut = (0, 0)` must tint everywhere for vanilla gold and paint to look right, so the CPU mapping of that pair is [hypothesis] ([evidence](multilayered-shader-evidence.md#what-the-studio-bakes)).

### 5.4 Sampling: explicit gradients with two LOD multipliers

Every layer texture is read with **`SampleGrad`** at gradients of the base UV scaled by the layer's tiling [observed]. The normal map's gradients are further multiplied by `NormalsTextureDDXYMultiplier` and the microblend's by `MicroblendsTextureDDXYMultiplier` (template defaults 1) [observed]. A value above 1 pushes those two maps to coarser mips (less normal aliasing, softer detail); below 1 sharpens them. It is a per-material mip bias for exactly the maps that cause specular aliasing, and the only one in the character-relevant templates; neither the decal family nor skin has an equivalent ([decal §4.7](shader-decal.md#47-no-discard-no-specular-antialiasing)).

### 5.5 Normals and outputs

The layer and microblend normals mix by the strongest microblend weight, then lay over `GlobalNormal` (strengthened by its intensity) with reoriented normal mapping and go to world space. Outputs: GBuffer0 `sqrt(Σ w·colour)`, GBuffer1 the normal, GBuffer2 `(Σ w·m, Σ w·r, 1/3)`; roughness is clamped only by the deferred light [observed]. The Index 2 variant adds rain: a rain-occlusion volume, puddle, ripple and streak textures that darken albedo, lower roughness and perturb the normal, driven by `MaterialModifiersConsts[2]` [observed]; it is weather, not material.

**One surface per pixel.** However many layers overlap, the G-buffer receives one colour, one roughness, one metalness and one normal per pixel, lit by the Standard light (Burley diffuse, one GGX lobe, F0 0.04 for dielectrics) [observed].

## 6. The clear coat (`multilayered_clear_coat`)

The only stock way to put a second specular lobe on a layered surface [observed]:

1. **Base pass.** The layer program as above, plus a per-pixel **coat amount**: the summed shares of the layers whose index lies in `[CoatLayerMin, CoatLayerMax]` (defaults −1 and 21, i.e. all). It is stored in **GBuffer2.z = 1/3 + ⅔·coat** (`3911537533623547427`), the channel Standard materials otherwise leave at 1/3.
2. **Coat pass** (`unlit`, `5403688829342147459`), drawn with depth test **`Equal`** so it lands only on the base pass's own pixels: coat weight `saturate((GBuffer2.z − 1/3)·1.5) × Opacity`; a forward-lit coat reflection (`CoatRoughnessBase`, clamped to ≥ 0.04; `CoatFresnelBias`; `CoatTintFwd`/`Side` blended by a Fresnel power set by `CoatTintFresnelBias`; `CoatSpecularColor`; `CoatReflectionPower`; `CoatNormalStrength`) goes to output 0 and a per-channel transmittance to output 1, so the dual-source blend computes `coat + base · transmittance` [observed].

So the coat is a true second lobe with its own roughness and Fresnel, but it is bound to its own opaque base: the depth-`Equal` test and the GBuffer2.z mask both come from the base pass [observed]. A decal drawn over a coated surface blends GBuffer2.z towards 1/3 and so removes the coat under it [observed arithmetic].

## 7. The baked surface cache (`multilayered_baked`)

`9875025106086992270` is a **virtual-texture** reader [observed]: from the UV and its derivatives it picks a mip (0–7) of a 15,360-texel virtual surface, reads a page entry from an `Indirection` texture, and samples `BaseColorRough` and `NormalMetal` inside 120-texel pages (4-texel borders) of a physical atlas of 64 × 64 pages; every second pixel in each axis writes a feedback word (`SurfaceID`, mip, Morton-ordered page) to a UAV. The static `m_surfaceCache_GenerateMultilayer` fills those pages with the **same layer arithmetic** (linear albedo with roughness in alpha, normal ×½+½ with metalness in alpha) [observed] ([evidence](multilayered-shader-evidence.md#findings), item 1). This is the runtime preparation of visible layers that CD PROJEKT RED describe in [A World Full of Substance](https://magazine.substance3d.com/cyberpunk-2077-a-world-full-of-substance/) [source-supported]. When the engine switches a mesh from the per-pixel program to the cache is [hypothesis]; since both evaluate the same formula, one bake reproduces either.

## 8. What this means for makeup on a face plate

The question the backlog asks is whether mixed cosmetic finishes, or transparency, can be expressed faithfully with multilayered on the eye plate. The programs answer it [observed arithmetic; the visual consequences are hypothesis until seen]:

| Requirement | Multilayered | `mesh_decal` (the current route) |
|---|---|---|
| Mixed finishes in one draw | Yes: per-pixel shares of layers with their own roughness, metalness, normal and colour | Yes: per-texel maps from the compiler's bake |
| Two reflections at one pixel | No (one surface per pixel); only `…_clear_coat` adds a coat, over its own opaque base | No |
| Soft coverage over skin | **No**: opaque, depth-writing, blending off, in the depth prepass; coverage left over is black | Yes: three alpha-blended targets |
| Keeping the skin's lighting | **No**: writes the Standard class, so the plate would lose SSS, the skin's two lobes, its tone, wrinkles and blood flow | Yes: the class and profile bits are untouched |
| Keeping the skin's normal and pores | No: the plate's own normal replaces it | Yes where normal alpha is 0, or mode 1 |
| Transparency | Only the engine's whole-draw dissolve (§3) | Per texel |
| Fine edge detail | Microblends at their own tiling; masks are low-resolution tiles | Texel density of the map (0.13 mm through the plate window) |
| Specular antialiasing | Per-material mip bias for normals and microblends (§5.4) | None: the mip chain only |

**Conclusion.** Multilayered can express mixed finishes, but only as an opaque Standard surface that replaces the skin; on a face plate that means a painted mask with hard edges and no skin shading. It adds nothing a decal cannot already do for makeup: both are limited to one surface per pixel, and the decal keeps the skin under it. The clear coat's second lobe would be the one real gain, and it cannot sit over skin. This replaces the [earlier assessment](multilayered-makeup-assessment.md), which reached the same answer from the pass states alone; the XF Eye Artistry export stays on the decal family. Where multilayered does matter is on parts that **are** their own surfaces: piercings, jewellery, graphic eye designs and, later, clothing.

## 9. How the Studio's layered adapter matches

`projects/xf-studio/authoring/src/layered-material.ts` (with `layered-setup.ts`, wired through `render-templates.ts` and `character-material-adapters.ts`) bakes a chunk's stack once per material and lights it as a standard metal/rough surface ([evidence, what the Studio bakes](multilayered-shader-evidence.md#what-the-studio-bakes)):

| Step | Adapter | Status |
|---|---|---|
| Tile bits, front-to-back shares, bottom layer unmasked, black leftover | `accumulateLayer` / `LAYER_ACCUMULATE_GLSL` | Faithful; real-GPU test within 0.004 of the CPU reference |
| Microblend crossfade, edge-weighted microblend normals | same | Faithful; `microblendContrast` → factor [hypothesis] |
| Levels chains, colour mask from the roughness map | same | Faithful; `(0, 0)` colour-mask levels read as "tint everywhere" [hypothesis] |
| `GlobalNormal` and reoriented normal mapping | `resolveSurface` | Faithful |
| UV frac, mask V flip, `matTile × tilingMultiplier`, ratio | bake coordinates | Faithful to the program; the `tilingMultiplier` fold is [hypothesis] |
| `SampleGrad` with the two DDXY multipliers | The bake samples each texel at its base level; Three builds the mips of the baked maps | Approximation: correct at the defaults (1); an instance that changes a multiplier is not honoured, and mips average the composited result rather than each layer |
| Standard lighting (Burley, height-correlated Smith) | Three's standard material (Lambert) | Approximation, shared with every Standard part |
| Weather variant, dissolve | not drawn | Faithful for a dry, fully shown part |
| Clear coat | not mapped (`multilayered_clear_coat` has no adapter) | Gap: coated garments or accessories would draw nothing; needs the coat mask and a second lobe (Three's `clearcoat` is a close structural match) |
| `multilayered_baked`, `cable_swing`, `terrain` | not mapped | Not needed for characters so far; `baked` is the same formula |
| Layered eyes | the same bake on the eyeball | Faithful: the game draws them Standard, without refraction or the Eye light ([eye reference §10](shader-eye.md#10-what-the-browser-adapter-reproduces)) |

**Clothing.** The adapter is generic over any `multilayered.mt` chunk; the scene draws it for piercings and the eye designs today. Clothing adds garment vertex factories (skinning, not the pixel program), the clear-coat gap above and larger stacks (the wiki's 20-layer cap is enforced in `layered-setup.ts`).

## 10. Open questions

1. The CPU mappings behind the layer buffer: `colorMaskLevelsOut (0, 0)`, `microblendContrast`, `colorScale` linearisation, `matTile × tilingMultiplier`, `SurfaceTexAspectRatio`, `useNormal` and offset 112 ([evidence](multilayered-shader-evidence.md#open-questions-runtime-test-candidates)).
2. When does the engine draw a mesh through `multilayered_baked` instead of the per-pixel program?
3. What `MaterialModifiersConsts[0].y` (written to GBuffer0.a) carries, and which engine state drives the dissolve?
4. What `transparent_mark_rt` marks for the clear coat.
5. How the engine places a rigid (unskinned) mesh in a morph-target component (carried from the evidence).

## 11. In-game test asks

None new for makeup: §8 settles the face-plate question offline. For the piercing and clothing preview, the evidence's open questions 1–3 are runtime-test candidates; a vanilla gold earring and a painted garment beside their preview captures, under fixed light, would check the colour-mask and contrast mappings in one frame each.

Related: [decal reference](shader-decal.md) · [multilayered evidence](multilayered-shader-evidence.md) · [earlier assessment](multilayered-makeup-assessment.md) · [materials and shaders](../../knowledge/materials-and-shaders.md) · [fact index](shader-fact-index.md).
