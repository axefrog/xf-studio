# Multilayered shader: how `.mlsetup`, `.mltemplate` and `.mlmask` combine (game 2.31)

Evidence note behind [materials and shaders §4.6](../../knowledge/materials-and-shaders.md#46-multilayered-enginematerialsmultilayeredmt-multilayered_clear_coatmt) and the Studio's layered adapter (`projects/xf-studio/authoring/src/layered-material.ts`). It records the programs read, the arithmetic recovered from them, how the community tools differ, and what stays open. Grades follow the [knowledge rules](../../knowledge/README.md): **[source]** read in the compiled program, **[resource]** read in serialized game files, **[wiki]**/**[community]** from a guide or tool, **[hypothesis]** inferred. Nothing here was observed in a running game. Listings stay in the git-ignored `research/consumers/shader-system/raw/annotated/`, made with the [shader-system method](shader-system/README.md).

## Programs read

| Program | Role | DXBC SHA-256 |
|---|---|---|
| `multilayered` `gbuffer_regular` Index 1, pixel `4792354088802328889` | The G-buffer writer. One program serves MeshSkinned (vertex `17554150852145961124`) and MeshStatic (vertex `261625994745290027`) | `284dcd76f158a7cf7272146d727b572c19703633a21ae72bfe91036b5046a3fc` |
| same, Index 2 (pass flag `0x80000`), MeshSkinned pixel `4972527321905975234` | The same layer code plus a weather block (rain-occlusion volume, puddle, ripple and streak textures that darken albedo, lower roughness and perturb the normal) | `e0932778da6a6a3925488e9d537ddac51277a39e5582f7788b5b69745eff23e1` |
| same, Index 2, pixel `595481826853760735` | Static/vehicle twin of the row above; differs only in the `MaterialModifiersConsts` register | `6cb46f9f81a651f291c8cfadfc6cc61c15bffaef82dafdf917eb6a538299a4b3` |
| static `m_surfaceCache_GenerateMultilayer`, compute `7318179378413828262` | The same layer arithmetic written into 128×128 cache pages (120 texels plus a 4-texel border): linear albedo with roughness in alpha, and the tangent normal ×½+½ with metalness in alpha | `a750b9cfa5069760d8907d2fce46b11421c48fbf0a028ebd8a2198fcd9dc7a15` |
| static `…GenerateMultilayerProxy` `10843767734813517802`, `…Proxy_Simple` `14269843964377580993` | Extracted, not read in detail | `18c0a3bf…`, `6a86e76c…` |

Line references below are to the lifted listing `4792354088802328889.hlsl` (`_N` = SSA `%N`, valid in that program only). The key loads and samples were checked against the `.ll` disassembly, and the wave-wide OR against the decompiled listing (`WaveActiveBitOr`).

The annotator names cb4 registers 0, 2 and 3 of this template `MultilayerMask`, `MaskTiles` and `Layers`. They are really `GlobalNormal` (a texture), `GlobalNormalUVScale` and `GlobalNormalUVBias`: the StructBuffer and `MultilayerMask` parameters live in a separate register namespace. `MaskTiles` is `t2` (a ByteAddressBuffer), `Layers` is `t3` (`StructuredBuffer<MultilayerLayerParam>`), and `MaskAtlas` is a `Texture2D<float>` in `space4`.

## Findings

1. **Per pixel, not a cache sample [source].** Every `multilayered.mt` G-buffer program loops over the layers per pixel and reads the mask atlas and layer textures bindlessly. Nothing in them samples a surface cache. The cache program repeats the same arithmetic for another consumer, most likely the internal `engine\materials\internal\multilayered_baked.mt` (`Indirection`, `BaseColorRough`, `NormalMetal`) [resource]; when the engine switches to it is unknown. One bake formula therefore covers both paths. The weather variant is runtime state, not material, and is not part of a bake.
2. **Per-layer parameters [source for the layout; hypothesis for the field mapping].** `MultilayerLayerParam` (stride 128) is read at `Layers[i + LayersStartIndex]`:

   | Offset | Use in the program | Likely authored field |
   |---|---|---|
   | 0 (float3) | albedo tint | resolved `colorScale.v` |
   | 12 | multiplies the mask; scales the microblend-normal weight | `opacity` |
   | 16–28 (4 floats) | `saturate(saturate(R·a + b)·c + d)` on the roughness texture | `roughLevelsIn.v`, `roughLevelsOut.v` |
   | 32–44 | the same chain on the metalness texture | `metalLevelsIn/Out.v` |
   | 48–60 | the same chain on the **roughness** texture's R, as the colour-mask weight | template `colorMaskLevelsIn/Out` |
   | 64 | material UV scale | `matTile` (whether `tilingMultiplier` is folded in on the CPU is unseen) |
   | 68 | microblend UV scale | `mbTile` |
   | 72 | mask-contrast factor | a function of `microblendContrast` |
   | 76 | microblend normal scale | `microblendNormalStrength` |
   | 80, 88 (float2) | microblend and material UV offsets | `microblendOffsetU/V`, `offsetU/V` |
   | 96 | layer normal scale | resolved `normalStrength.v` |
   | 100–108 | bindless indices: microblend; colour and normal (lo/hi 16 bits); roughness and metalness | the template's maps |
   | 112 (float4) | unused in the three pixel programs read | ? |

   The stored level pairs look like precomputed Photoshop levels in scale/bias form [resource]: `roughLevelsIn "null"` = (1.342, −0.1578) is the input range 30/255 to 220/255; out pairs such as (0.9216, 0.0784) cover 20/255 to 1; `metalLevelsOut` (−1, 1) inverts. So the pairs are most likely copied straight into the shader's four floats.
3. **Masks and tiles [source].** `MaskTiles` holds 8-byte tiles `{u32 firstEntry, u32 layerBits}`, the full-resolution grid (`ceil(W/T)` × `ceil(H/T)`) first, then the low-resolution grid; each entry is a u32 with atlas x in bits 0–9, y in 10–19, and width/height mip shifts in 20–23 and 24–27. The atlas is BC4 with a one-texel border (the earring mask: atlas 256×272, tile 14) [resource]. A pixel's layers are `(fullTile.bits | lowTile.bits) & SetupLayerMask`. WolvenKit's `.mlmask` export decodes the same tables and writes zero where a layer has no tile (`MlmaskTools.cs`) [community], which the adapter reads as "no coverage", as the program does.
4. **Per-pixel arithmetic [source, L74–350].**

   ```
   fu = frac(u); fv = frac(v); fvm = frac(1 − v)                     // L74-77, L99
   remaining = 1; A = R = M = 0; Nl = Nmb = 0; mbMix = 0; sumA = 0
   for each layer bit i from the HIGHEST down to the second-lowest:     // L119-127, loop L254-268
     if remaining <= 0 or the pixel's tile lacks bit i: continue
     m = bilinear(mask_i at (fu, fvm))                                  // L128-130
     if m <= 0: continue                                               // L131
     matUV = offset + matTile·(fu·SurfaceTexAspectRatio, fv); mbUV likewise with mbTile
     mb = Microblend(mbUV); k = 1 − mb.a
     mp = saturate(k + (m − k)·c72); a = mp·opacity                     // L157-160
     e  = saturate(saturate(sqrt(1 − 2|mp − ½|))·opacity − sumA)        // L159
     Nmb = lerp(Nmb, (mb.rg·2 − 1)·mbN, e); mbMix = max(mbMix, |mbN|·e); sumA += a
     w = min(remaining, a); remaining −= w                              // L165, L181
     if w > 0:
       R += w·levels(rough.r, rough in/out);  M += w·levels(metal.r, metal in/out)
       cm = levels(rough.r, colour-mask in/out)
       A += w·colour.rgb·lerp(1, colorScale, cm);  Nl += w·(normal.rg·2 − 1)·normalStrength
   bottom layer (the lowest bit): the same with m = 1 (its tile bit is not tested)   // L286-350
   ```

   Layers composite **front to back**, each taking an additive share of the coverage still remaining, not as a lerp stack: two layers at 0.5 over a base give 0.5 / 0.5 / 0 (a lerp stack gives 0.5 / 0.25 / 0.25). Coverage left over contributes black albedo and zero roughness and metalness.
5. **Into the G-buffer [source, L57–66 and L386–429].** `g` = `GlobalNormal` at `uv·GlobalNormalUVScale + GlobalNormalUVBias`, strengthened by `GlobalNormalIntensity` as `normalize(I·x, I·y, I·(z − 1) + 1)`; the layer normal `nl` and microblend normal `nm` get their Z rebuilt, `d = lerp(nl, nm, mbMix)`, and the result is `RNM(base g, detail d)`, then taken to world space by the tangent frame. GBuffer0 = `sqrt(A)`, GBuffer1 the encoded normal, GBuffer2 = (M, R, ⅓). No clamp here; the deferred light clamps roughness to [0.04, 1]. The class is Standard: no emissive, no dielectric specular control.
6. **Texture formats [resource].** Colour maps are `TEXG_Multilayer_Color`, BC1, `isGamma` set (sRGB); roughness and metalness `TEXG_Multilayer_Grayscale` BC4, linear; normals RG only, linear; microblends `TEXG_Multilayer_Microblend` BC7, linear, alpha used. The program treats albedo as linear (it writes `sqrt`), consistent with an sRGB view of the colour maps [hypothesis that `isGamma` selects that view].
7. **UV orientation [source + community].** Material and microblend UVs are the frac of the mesh UV, unflipped, in the game's own rows; masks use `frac(1 − v)`. WolvenKit writes glTF UVs as `1 − v` and flips `.xbm` images on export but not mask images, so both sample correctly with the glTF UV and `flipY = false`; only a tiled or offset read needs the explicit mapping `(offset + tile·frac(u), 1 − (offset + tile·frac(1 − v)))`. The first in-browser check (a "heart" eye design, below) shows the design the right way up.

## What the Studio bakes

`layered-material.ts` reproduces items 1–7 once per material in a WebGL 2 bake: one pass per drawn layer in the program's order (masked layers with data from the highest index down, then the bottom layer), into three float accumulation targets (colour and remaining coverage; roughness, metalness, Σa and microblend mix; layer and microblend normals), then a resolve pass with `GlobalNormal` and RNM into three half-float maps over the mesh's own UV range. The lit material is a standard metal/rough material over those maps; the game's tangent normal is read with Y negated because the exported UV's V runs opposite the game's. `accumulateLayer`/`resolveSurface` are the CPU reference; the real-GPU test (`tests/webgl-display.test.ts`) bakes a three-layer stack exercising every term and matches the reference within 0.004. Choices where the program's input is unknown, each marked in the code:

| Input | Choice | Why |
|---|---|---|
| Colour-mask levels with `Out = (0, 0)` | tint everywhere (`cm = 1`) | 263 of 386 vanilla templates, every earring template among them, store (0, 0); a straight copy would never tint, yet vanilla gold is a grey map tinted by `colorScale` and car paint a flat map [hypothesis] |
| `microblendContrast` → offset 72 | the value itself | makes contrast a crossfade between mask and microblend, as the wiki describes, and makes contrast 0 hide a layer under an opaque microblend, as the wiki warns [wiki: `multilayered-material-properties.md`, "microblendContrast" and the page's warning] [hypothesis] |
| `colorScale` | uploaded raw | the program multiplies it raw; any CPU linearisation is unseen [hypothesis] |
| `matTile` | × template `tilingMultiplier` | as the Blender add-on does; unseen on the CPU [community, hypothesis] |
| `SurfaceTexAspectRatio` | the setup's `ratio` (1 in every setup seen) | [hypothesis] |
| A name the template's table lacks | the template's `defaultOverrides` name, then `null`, then a neutral value | the engine's miss is unread; all 420 earring lookups and every `defaultOverrides` name resolve [resource] |
| Layers without a mask image | skipped (bottom layer excepted) | as a tile without that layer's bit |

## How community tools differ

- **Cyberpunk Blender add-on** (commit `7a4ee793`, `i_scene_cp77_gltf/material_types/multilayered.py` and its node groups) [community]: stacks layers bottom-up with a lerp (611–640) instead of front-to-back shares; ignores layer 0's mask and opacity (1072, 1089, 1446); uses a different contrast curve `saturate((m − (1 − c)(1 − a))/c)` (398–517); zeroes microblend normals inside the mask (459) instead of the edge weight; sums normals in XY and rebuilds Z (736–742) instead of weighted groups plus RNM, and flips G; runs the levels chains without the clamps (520–554); always tints (never reads `colorMaskLevels`, 845–907); scales UVs by `tilingMultiplier · matTile` with no frac or ratio; never reads `defaultOverrides`.
- **WolvenKit** (commit `11720772`) [community]: no shader model. Its mesh-preview bake (`RDTMeshViewModel.cs` 1829–2169) paints flat `colorScale` values over each other by mask × opacity, uses layer 0's real mask and ignores textures, microblends and input levels. Its `.mlmask` exporter (`MlmaskTools.cs`) samples the atlas nearest-neighbour, writes `<stem>_layers/<stem>_<i>.png` from layer 0 at full or low resolution, and does not flip.

## Serialized shapes [resource]

WolvenKit CLI 9.0.1, JSON header `GameVersion` 2310. A `.mlsetup` is `{layers[], ratio, useNormal}`; each layer carries `matTile, mbTile, microblend, microblendContrast, microblendNormalStrength, microblendOffsetU/V, opacity, offsetU/V, material` (the `.mltemplate`), `overrides` and the six CNames `colorScale, normalStrength, rough/metalLevelsIn/Out`. A `.mltemplate` carries `colorTexture, normalTexture, roughnessTexture, metalnessTexture, tilingMultiplier, colorMaskLevelsIn/Out` (`{Elements: [a, b]}`), `defaultOverrides` (six CNames) and `overrides`, a table of lists: `colorScale` `{n, v: {Elements: [r, g, b]}}`, levels `{n, v: {Elements: [a, b]}}`, `normalStrength` `{n, v}`. Colour names are `<hex>_<hex>` with `null` in either half; `null_null` and `null` are ordinary keys present in all 386 templates. The earring setups have 3–6 layers, layers 1 and 2 usually at opacity 0. The earring materials are `…\earrings\i1_000_base_01__<look>.mi` → `multilayered.mt`, setting only `MultilayerMask` and `MultilayerSetup`; `plastic_red.mi` sets no mask and falls back to the template's default mask (`multilayer_default.mlmask`, one layer).

## Checked in the browser (26 September 2026, `?verify=1`, the reference MO2 profile)

- A new-game save with style-09 black piercings: five layered chunks (brow and lip studs, ear bars and a lobe spinner) baked at 1024², only the bottom (paint) layer drawn; glossy black plastic under the Studio stage, picking up the rig's coloured light under the Character creator preset.
- Trying style 12 gold resolves the jewellery framework that replaces that style's `.app`: the kept vanilla part, a nose stud (its second chunk silver through its own material) and two nostril rings from their item archives, one of them a rigid (unskinned) linked mesh.
- A "heart" eye design (forced through the request for this check only): layers 19, 10 and 0 baked at 2048² over the eyeball's UV range (U −1.65…2.01, V −0.60…1.00); the heart shows the right way up, the default eye hidden, the wetness shell on top.

## Open questions (runtime-test candidates)

1. The CPU mapping of `colorMaskLevelsOut` (0, 0) to full tint: special case or general transform?
2. `microblendContrast` → offset 72: direct copy, reciprocal or something else?
3. Whether `colorScale` is linearised, and whether `matTile` is multiplied by `tilingMultiplier`, on the CPU.
4. What `SurfaceTexAspectRatio`, `useNormal` and offset 112 carry.
5. When the engine switches to `multilayered_baked` and the surface cache.
6. How the engine places a rigid (unskinned) mesh in a morph-target component; the preview keeps it where the export placed it.
