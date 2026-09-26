# Skin shader reference: `base\materials\skin.mt` (game 2.31)

First per-family reference of the [materials and shader study](../backlog/materials-shader-re.md). It gathers everything the lab knows about the skin template in one place: parameters and defaults, the player head and body instance chains, texture packing and colour spaces, compiled passes, the G-buffer program line by line, the wrinkle and wetness inputs, the subsurface-scattering (SSS) pipeline, the lip seam, and what the browser adapter reproduces. The consolidated reading is in [materials and shaders §4.1](../../knowledge/materials-and-shaders.md#41-basematerialsskinmt-and-skin_blendable-skin_morph); this page is the evidence-level reference behind it. Which Studio code relies on which fact is in the [shader fact index](shader-fact-index.md).

**Labels.** **[observed]**: read directly in a compiled 2.31 program or an installed resource (the knowledge base's [source]/[resource]). **[source-supported]**: supported by tool or engine source, the wiki, a community tool, or a close structural match to a published technique. **[hypothesis]**: not established. Nothing here was observed in a running game unless marked **[runtime]**; compiled-program evidence says what the programs compute, not which variant drew a given frame.

## 1. Pinned inputs

| Input | Identity |
|---|---|
| Game | 2.31 (`GameVersion 2310`) |
| `shader_final.cache` | SHA-256 `339145…3ccfa` (full hash in the [shader-system note](shader-system/README.md#inputs-read-only)) |
| `staticshader_final.cache` | SHA-256 `bff160…59ff` |
| `base\materials\skin.mt` | resource hash `41843641457625498`, SHA-256 `d7e50733acd1881805898078fd642a3fb9d70346e3ae23bcd4ebff4157ad4720` |
| Disassembler / decompilers | Windows SDK 10.0.22621 `dxc -dumpbin`; dxil-spirv `f2d1b554` → SPIRV-Cross `aa217aeb` |
| Method | [shader-system evidence note](shader-system/README.md#method-repeatable-in-minutes); outputs stay local and ignored |

| Program (MeshSkinned unless noted) | GUID | DXBC SHA-256 |
|---|---|---|
| `skin` `gbuffer_regular` pixel | `12806642364631437234` | `8040f820…a36053` |
| `skin` `gbuffer_regular` vertex | `7494393843130164436` | `789b74c4…d8f459b` |
| static `m_postfx_SubsurfaceScattering_Setup` | `18323727242039837728` | `a72893f1…26e708a` |
| static `…_Setup_UseTranslucency` (content-confirmed, below) | `11387959167119825062` | `5760e2dc…b425901` |
| static `…_Blur_Horizontal` | `13638945895069409584` | `296eb4a5…fb1372` |
| static `…_Blur_Vertical` | `1061893983243070248` | `65b9ed67…314ef1f` |
| static `…_Combine` | `7703933925853799832` | `1124fb96…dcbacf` |
| static `m_shaderLightsComputeGlobalLocalShadows_Clustered_11111111` (all-class light) | `6606735909222169407` | `c0ce7b53…dac86` |

SSA numbers below (`%N`) are from the lifted listing of that program's `.ll` (valid only in that program). Where a decompiled listing is cited, its `_N` are SPIRV-Cross ids, not SSA numbers.

## 2. The template

**Class** `RMT_Subsurface` (lighting class 1), priority `EMP_Normal`, `canBeMasked` 1 [observed]. **Vertex factories:** MeshStatic, MeshSkinned, MeshExtSkinned, GarmentMeshSkinned, GarmentMeshExtSkinned and the four `…LightBlockers` variants [observed]. The shader cache holds 23 MeshSkinned `skin` compilations [observed].

**Siblings** [observed, template parameter lists]:

- `skin_blendable.mt` adds the blendable set (`VectorField`, `FresnelColor`/`Intensity`/`Exponent`, `FadeOutDistance`/`Offset`) and drops `SecondaryAlbedo` and `EmissiveMask`.
- `skin_morph.mt` blends two looks: `Morph`, `Transition`, `Morph_Mask`, `MorphTiling`, and `AlbedoTarget`, `NormalTarget`, `TintColorTarget`, `TintScaleTarget`; no wrinkle or blood-flow inputs.
- `blackwall_blendable_skin.mt` is `skin_blendable` without the Fresnel set.

None of the three has been decompiled; the player head and body use plain `skin.mt`.

### 2.1 Parameters

Registers are the `cb4` / `usedParameters[2]` register; all parameters are pixel-stage [observed]. Defaults are the template's.

| Reg | Parameter | Type, default | What the G-buffer program does with it |
|---:|---|---|---|
| 0 | `Albedo` | Texture, `engine\textures\editor\white.xbm` | Base colour, UV0 |
| 1 | `SecondaryAlbedo` | Texture, white | Overlay colour; its **A** is the overlay's coverage |
| 2 | `SecondaryAlbedoInfluence` | Scalar 0 | Overlay weight (× `SecondaryAlbedo.A`) |
| 3 | `SecondaryAlbedoTintColorInfluence` | Scalar 0 | How far the overlay is multiplied by the toned base colour (§5.4) |
| 4 | `Normal` | Texture, `small_flat_normal.xbm` | Tangent normal, RG |
| 5 | `DetailNormal` | Texture, flat | Second tangent normal, RG; its **R** also feeds the cavity term |
| 6 | `DetailNormalInfluence` | Scalar 0 | Detail normal weight |
| 7 | `CavityIntensity` | Scalar 0.25 | Cavity darkening strength |
| 8 | `Roughness` | Texture, white | **R** roughness, **G** metalness slot and wetness mask, **B** detail mask (§4) |
| 9, 10 | `DetailRoughnessBiasMin`, `…Max` | Scalar 1, 0.68 | Range of the roughness bias; the program sorts the pair itself |
| 11 | `MicroDetail` | Texture, `base\characters\common\skin\face\microdetail_n.xbm` | Two RG micro-normal tiles side by side (a 2:1 atlas) |
| 12, 13 | `MicroDetailUVScale01`, `…02` | Scalar 10, 10 | Tiling of the left and right tile |
| 14 | `MicroDetailInfluence` | Scalar 1 | Micro-normal weight (× `Roughness.B`) |
| 15 | `TintColorMask` | Texture, `…\skin\torso\i0_000_base__tintcolormask.xbm` | **R** tone weight, **G** micro tile blend, **B** micro frequency |
| 16 | `TintColor` | Color (0, 0, 0, 0) | Tone colour |
| 17 | `TintScale` | Scalar 0 | Tone strength; sign selects multiply (+) or overlay (−) |
| 18 | `EmissiveMask` | Texture, black | **R** × `EmissiveEV` |
| 19 | `EmissiveEV` | Scalar 0 | Emissive intensity, packed into GBuffer2.w |
| 20 | `Detailmap_Stretch` | Texture, flat | Wrinkle normal (RG) for stretched skin |
| 21 | `Detailmap_Squash` | Texture, flat | Wrinkle normal (RG) for compressed skin |
| 22 | `Bloodflow` | Texture, white | **R** flush mask under squash, **G** under stretch |
| 23 | `BloodColor` | Color (0, 0, 0, 0) | Flush colour, **added** to the toned base |
| 24 | `SkinProfile` | SkinParameters, `engine\materials\defaults\default.sp` | Bound as a slot index 0–7 (§6) |

All of the table's program roles are [observed] in `12806642364631437234` except where §5 says otherwise.

### 2.2 Passes and render stages

From the serialized template [observed]; "flags" is the pass's technique flag word, which distinguishes the regular, velocity, preskinned and dismembered variants.

| Stage | Depth | Cull | Pixel program | Targets | Role |
|---|---|---|---|---|---|
| `gbuffer_regular` (and `gbuffer_velbuff_regular`) | test `GreaterEqual`, write on (reversed Z) | back | yes | 3 targets, blend off | The skin's G-buffer write (§5) |
| `skin_translucency` | test **`LessEqual`**, write on | **front** | **none** | `One/One`, write mask **R** | Depth of the **farthest back face**: front faces are culled and the reversed-Z `LessEqual` keeps the farthest depth. Read as the "back depth" of the translucency variant of the SSS setup (§6.4) [observed for the state; the binding is [source-supported] by that program's arithmetic] |
| `cascade_regular` | `LessEqual` | back | none | — | Shadow maps |
| `depth`, a pixel-less `gbuffer_regular` | `GreaterEqual` | back | none / yes | — | Depth-only and prepass variants |
| `highlights` | `GreaterEqual` | back | yes | — | Outline/highlight buffer (writes constants) |
| `wireframe`, `wireframe_solid` | | | | | Editor views |

The masked (`_discarded`) twins of the G-buffer stages exist because the template can be masked; no skin instance inspected enables the mask [observed for the reference chains].

## 3. Instance chains on the player

### 3.1 Head

Consolidated from the [saved-skin resource chain](../eye-artistry/saved-skin-resource-chain.md) and [head CC rendering §2](../../knowledge/head-cc-rendering.md#2-skin-type-tone-and-the-complexion-texture-set) [observed]:

```
h0_000_pwa_c__basehead.mesh  — 60 local materials, one per (tone, type); each sets only Albedo (type d0N) and Normal
  └─ female\head\female_head_<tone>.mi
      └─ …\female_head__parameters\default_female_head_<tone>.mi   Roughness (…_wa_c__basehead_rm01.xbm), DetailNormal,
          │                                                        Detailmap_Stretch/Squash, Bloodflow
          └─ …\head__parameters\default_head_<tone>.mi             MicroDetailUVScale01/02 = 20 / 8, TintColorMask
              └─ <tone>.mi                                         TintColor, TintScale, DetailRoughnessBiasMin/Max
                  │                                                (1 / 0.93), DetailNormalInfluence 0.8,
                  │                                                MicroDetailInfluence 0.8
                  └─ base\materials\skin.mt                        everything else, incl. SkinProfile = default.sp
```

So the creator's **skin type** swaps one albedo texture and the **tone** changes three numbers (the 12-tone table is in [head CC rendering §2](../../knowledge/head-cc-rendering.md#2-skin-type-tone-and-the-complexion-texture-set)). About half the head's `.mi` files are shared with NPCs [source-supported: wiki `cheat-sheet-head/README.md` L70-72], so none may be edited in place.

The **teeth** are `skin.mt` too (`teeth_base.mi`) with their own maps and `SkinProfile` = `customisation_teeth.sp` (blur size 1, zero falloff, lobe mix 1) [observed].

### 3.2 Body: one skin model

The body track's inventory (its knowledge page, `knowledge/body-rendering.md`, lands with that track) records [observed, resource]:

- every body skin part (torso `t0_000_pwa_base__full`, feet, arms and hands, genitals, plain nail colours) is `skin.mt` with a local material per tone over **the same four-level tone chain**, so a tone is again only `TintColor`, `TintScale` and the tint mask;
- the tone reaches the body through the creator's `skin color` link, which the body, arms, feet, nipples and genitals follow;
- the body has **no skin type**: every tone shares `base\4k\common\body\wa\textures\d02_naked.xbm`, `n02_naked.xbm` and `wa_base_rm02.xbm`, and a full-body `SecondaryAlbedo` overlay (`…\overlays\fullbody_overlay_d01.xbm`) that body tattoo frameworks replace.

**What the shader adds to that** [observed unless marked]:

- **Same arithmetic, same light.** Head and body run the same program family and are lit as Subsurface, so a tone that matches in the G-buffer matches in light too. Tone mismatch at the neck can only come from textures, masks or instance values, not from the shader.
- **Same profile slot, one blur.** Both default to `default.sp`. The SSS passes blur only across Subsurface pixels and weight each pixel by its own slot (§6), so the neck seam is blurred across head and body as one surface when both use one profile. A mod that gives head and body different profiles gives the seam two kernels [source-supported by the blur's per-pixel slot read].
- **No wrinkles on the body.** The wrinkle weights come from UV-rectangle regions sent per draw (§5.6); the body's draw has no facial tracks, so its stretch/squash/blood-flow inputs stay at rest [hypothesis for what the engine sends the body draw].
- **Wetness applies to both** (§5.7).

## 4. Texture packing and colour spaces

| Texture | Channels the program reads | Colour space | Evidence |
|---|---|---|---|
| `Albedo` | RGB | sRGB when the XBM's `isGamma` is set, decoded by the sampler; diffuse maps are gamma | [observed] program samples it as colour; convention [source-supported: wiki `textures/README.md` L60-62] |
| `SecondaryAlbedo` | RGB colour, **A** coverage | sRGB | [observed] |
| `Normal`, `DetailNormal`, `Detailmap_Stretch/Squash`, `MicroDetail` tiles | **RG only**, `x = 2r − 1`, `y = 2g − 1`, `z = √max(0, 1 − x² − y²)`; blue ignored; no Y flip in the program | linear | [observed] the same unpack at every normal sample; the head normal's blue is 0 in the decoded texture [observed] |
| `Roughness` | **R** base roughness; **G** written raw to GBuffer2.x (the light's **metalness**) and used to make a pixel non-porous when wet, `1 − saturate(2G)` (§5.7); **B** detail mask (roughness bias, micro-normal and cavity weight) | linear (`isGamma` 0, `TCM_DXTNoAlpha` on the head's `rm01`) | [observed]; vanilla head `rm01`: R 41–255 (median 165), **G ≡ 0**, B 115–255 |
| `TintColorMask` | **R** tone weight; **G** `floor(6g)/6` → smoothstep: blend between the two micro tiles; **B** `floor(5b)/5` → smoothstep: raises both micro frequencies | sRGB (`isGamma` 1), so G/B steps are taken on decoded values | [observed] (`%201`, `%207`) |
| `EmissiveMask` | **R** | per resource | [observed] |
| `Bloodflow` | **R** (squash flush), **G** (stretch flush) | per resource | [observed] |

**Gotchas** [observed]:

- **Roughness G is metalness.** Any skin texture whose G exceeds 0.1 turns that pixel metallic *and* switches off its SSS (§6.3); a complexion mod that packs something else into G breaks skin silently. The vanilla head map's G is zero.
- **Three.js reads roughness from G.** Feeding `rm01` to a stock `roughnessMap` reads zero everywhere.
- The Cyberpunk Blender add-on maps Roughness G to Metallic and marks its microdetail masking as uncertain [source-supported: `material_types/skin.py:341,626`].

## 5. The G-buffer program, step by step

Program `12806642364631437234`; all steps [observed] unless marked. UV is UV0 throughout. Inputs from the vertex program: the world tangent frame, UV0, world position, view depth, vertex colour RGBA, and the two wrinkle weights (§5.6).

### 5.1 Normal

1. **Base normal** from `Normal` (RG unpack).
2. **Wrinkles.** If the stretch weight `s > 0`: `n ← normalize(lerp(n, normalize(n + d_stretch), s))`, and likewise with `Detailmap_Squash` and the squash weight `q`. Both weights are zero at rest.
3. **Detail normal.** `n ← normalize(n + DetailNormalInfluence · (blend(n, d) − n))` with
   `blend(n, d) = (d.x·n.z + d.z·n.x, d.y·n.z + d.z·n.y, d.z·n.z)`, which is `n.z·d.z · (n.xy/n.z + d.xy/d.z, 1)`: **partial-derivative (slope-sum) blending** [observed arithmetic; the name is [source-supported], after Barré-Brisebois and Hill's survey].
4. **Micro-detail.** Two samples of the `MicroDetail` atlas: the left tile at `UV · MicroDetailUVScale01 · (1.4 + b)`, the right tile at `UV · MicroDetailUVScale02 · (1.0 + b)`, with `b` the smoothstepped `TintColorMask.B` step. Each wraps inside its half with a half-texel inset, and both use `SampleGrad` with the *unwrapped* derivatives, so no mip seam appears at the wrap. The micro normal is `lerp(right, left, g)` with `g` the smoothstepped `TintColorMask.G` step, blended by the same slope-sum rule at weight `MicroDetailInfluence · Roughness.B`.
5. **World normal** through the interpolated tangent frame (T, B, N normalized per pixel). On a back face the normal is reflected about the vertex normal (unused while the G-buffer pass culls back faces).
6. **Encoding.** `GBuffer1.rgb = n / max(|n.x|, |n.y|, |n.z|) · 0.5 + 0.5`.

### 5.2 Micro term, roughness and cavity

- **Micro term** `f = 0.2 + 2.5 · lerp(q₁, q₂, g)` with `q = (2x − 1)·2x + (2y − 1)·2y` of each micro sample's raw RG (`%378`). Note that the colour/roughness term lerps **left → right** while the normal lerps **right → left** by the same `g`; the preview keeps this asymmetry.
- **Roughness** `r = saturate(R · (1 + B · (lerp(lo, hi, f) − 1)))` with `lo`/`hi` the sorted `DetailRoughnessBiasMin/Max` (`%408`). With the head tones' 1 / 0.93, the bias moves roughness by at most 7 % where B is 1; with the template's 1 / 0.68 by up to 32 %.
- **Cavity signal** `c = B² · f + DetailNormal.x` (the detail map's raw unpacked red), then `k = saturate((c · CavityIntensity − 0.15) · −6.667)` and an additive grey offset `B · (0.01 · smoothstep-like(k) − 0.1 · CavityIntensity · c)` on every albedo channel before toning (`%390`, `%418`). At the default 0.25 it darkens by at most a few percent.

### 5.3 Tone

`w = |TintScale| · TintColorMask.R`; `t = TintScale ≥ 0 ? TintColor · a : overlay(a, TintColor)`; `a′ = a + w · (saturate(t) − a)` (`%424`–`%466`). Overlay is the standard `a < 0.5 ? 2at : 1 − 2(1 − a)(1 − t)` per channel. `TintColor`'s encoding into the program (byte/255 or sRGB-decoded) is [hypothesis] ([materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions)).

### 5.4 Blood flow and secondary albedo

- **Blood flow.** `b = saturate(BloodColor + a′)`; `a″ = lerp(a′, b, Bloodflow.R · q³)`, then `lerp(…, b, Bloodflow.G · s³)`, saturated (`%511`–`%524`). `BloodColor` is **added** (a flush), and it only acts where a wrinkle weight is non-zero, cubed. At rest (`q = s = 0`) the base is just `saturate(a′)`.
- **Secondary albedo.** `S′ = lerp(S, S · a′, w · SecondaryAlbedoTintColorInfluence)` (the overlay multiplied by the **toned base**, not by `TintColor`), then `base = lerp(a″, S′, SecondaryAlbedoInfluence · S.A)` (`%491`). Freckle and tattoo frameworks use this slot.

### 5.5 Outputs

| Target | Written |
|---|---|
| GBuffer0 | `sqrt(wetDarkening · base)`, A = 1 |
| GBuffer1 | normal (§5.1); A = `floor(slot / 2) / 3` (profile slot high bits) |
| GBuffer2 | x = `Roughness.G` raw; y = `wetRoughness · r`; z = `0.4 + 0.6 · vertexColour.G`; w = `(emissive ? 128 + uint(√saturate(EV/10)·63) : 0) + ((slot & 1) << 6)`, /255 (the program ORs the bit fields) |

`EV = EmissiveEV · EmissiveMask.R`, emissive when above 0.001. The non-emissive low 6 bits come from an interpolant the vertex program sets to the constant 0 [observed in `7494393843130164436`], so a non-emissive skin pixel stores only its slot bit in GBuffer2.w. `SkinProfile` is `min(uint(value), 7)`.

### 5.6 The wrinkle driver (vertex program)

The vertex program `7494393843130164436` computes the two wrinkle weights per vertex [observed, `%462`–`%547`, lines 146–258 of the lifted listing]:

```
for track i < MaterialModifiersConsts[2].y:                    // per-draw count
    region = TextureRegionsCB[9·i .. 9·i + 8]                  // cb9, 40 × 9 registers
    m = max over rect k < region[0].x of  ramp(u; outer_k.x, inner_k.x, inner_k.z, outer_k.z)
                                        · ramp(v; outer_k.y, inner_k.y, inner_k.w, outer_k.w)
    squash  += FloatTracksDataCB[i].x · m · region[0].y         // cb8, one float per track
    stretch += FloatTracksDataCB[i].x · m · region[0].z
squash, stretch = saturate(...)
```

`ramp` is a trapezoid in UV0: 1 inside the inner rectangle, falling linearly to 0 at the outer one. So each **animation float track** switches on the stretch or squash normal map (and its blood flush) inside a few UV rectangles of the face. The 33 wrinkle outputs of the facial solver ([facial expressions](../../knowledge/facial-expressions.md)) are the likely track source [hypothesis]; the region rectangles are CPU data not found in any resource yet [hypothesis].

The vertex program also passes vertex colour R/G/B/A straight through (G ends in GBuffer2.z) and the view depth used by the wetness LOD.

### 5.7 Wetness (rain)

Active only when `MaterialModifiersConsts[3].x + .y ≥ 0.001` (rain / wetness amounts) and the pixel is not occluded from the sky [observed, `%375`–`%1081`]:

- **Sky occlusion** from a 3D volume (`t54`) and a two-slice top-down depth array (`t48`, ±8000 units), plus an overhang test (`t57`, `t69`).
- **Porosity** `p = saturate((r − G8.x) / (G8.y · (1 − G8.x))) · (1 − saturate(2 · Roughness.G))` with `G8 = GlobalShaderConsts[8]` and `r` the dry roughness: rough skin is porous, and a Roughness G (metalness) of 0.5 or more makes a pixel non-porous.
- **Amount** `a = saturate(MaterialModifiersConsts[3].y − 1 + saturate(N.z + 0.5) · skyVisibility)`: up-facing normals get wetter.
- **Darkening** multiplies the colour (before the square root) by `1 − p · G8.w · a`; **gloss** multiplies roughness by `1 − (1 − p) · G8.z · a`. Porous parts darken, smooth parts turn glossy, the usual wet-surface split.
- **Distance bands** by view depth: nothing beyond 120 m; under 60 m animated drop ripples (`t58`, a 16-frame atlas) and a noise mask (`t60`); under 30 m time-scrolled streaks (`t59`) on steep surfaces; under 15 m drips on up-facing surfaces.

So wet skin is darker and glossier. A decal drawn over it replaces the wet colour at full coverage, because it blends after the skin wrote GBuffer0 [source-supported by the pass order]: opaque makeup on wet skin shows no wet darkening, and whether a decal's roughness write receives the wet gloss depends on whether the decal program applies its own wetness, which is not checked. Rain is irrelevant to the character creator and photo-mode indoors, and relevant to outdoor photo-mode tests: **record the weather** in test captures.

## 6. Lighting: the Subsurface class and the SSS pipeline

### 6.1 Direct light

In the tiled deferred light (`6606735909222169407`), class 1 [observed; [materials §2.3](../../knowledge/materials-and-shaders.md#23-the-deferred-lighting-model)]:

- **Diffuse** renormalised Burley at the G-buffer roughness, with **albedo forced to 1** when metalness < 0.1 and a global flag is set, so the diffuse output is irradiance, to be multiplied by albedo *after* the blur (§6.3).
- **Specular**: two GGX lobes at `r · roughness0` and `r · roughness1` from the pixel's profile slot (`cb6` registers 4–11, `SKernelDualSpecular`), summed and scaled by `(1 + lobeMix) / 2`; dielectric F0 0.04. The default profile (0.966, 1.597, 1) gives skin up to twice a Standard lobe.
- **Local lights** can shift roughness per light: `r′ = saturate(r + k · (byte/127.5 − 1))` from a byte of the light's data.
- Diffuse and specular go to separate targets.

### 6.2 Setup

`m_postfx_SubsurfaceScattering_Setup` (`18323727242039837728`), for pixels whose stencil class is 1 (`(stencil & ~31) == 32`): copies the light's diffuse output and writes linear depth `1 / (a·(b·z + c) + d)` from `cb12` registers 25–26 [observed].

### 6.3 Blur and combine

**Blur** (`13638945895069409584` horizontal, `1061893983243070248` vertical; the two differ only in axis and in `cb0[3].x` versus `.y`) [observed]:

- For a class-1 pixel with metalness ≤ 0.1: `slot = (GBuffer1.w·3) << 1 | bit 6 of GBuffer2.w·255`.
- A **kernel table** texture holds one row per slot. Column `cb6[0].y` is the centre weight (RGB); columns `cb6[0].y + 1 … + cb6[0].z − 1` are taps, RGB weight plus **A = offset**.
- Each tap is read at `± offset · cb6[0].x / (linearDepth · 100) · 3072 · cb0[3].x` pixels: a **world-space-constant radius**, narrower on screen as the face moves away.
- Taps count only if the neighbour is also class 1 and its copied diffuse (red) is positive; the result is normalised per channel by the weights of the taps that counted, so blur does not leak off the skin and renormalises at its edges. There is no depth-difference test.
- Metallic centre pixels (> 0.1) output zero and are handled by the combine's non-SSS path.

This is the structure of Jimenez et al.'s **separable subsurface scattering** (a per-profile kernel of RGB weights and offsets, applied horizontally then vertically, scaled by 1/depth) [source-supported by the structural match]. How `CSkinProfile.blurSize`, `falloff` and `diffuse` become the kernel rows is CPU-side and not in any shader [hypothesis: `blurSize` scales the offsets and `falloff` the per-channel spread, as width and falloff do in that paper's kernel].

**Combine** (`7703933925853799832`) [observed]:

```
metal > 0.1:  out = E · (specular + diffuse·k)                         // no SSS
otherwise:    D = diffuse·k, B = blurred·k,  P = profileTable[slot, column 0].rgb
              albedo = lerp(GBuffer0², cb6[0].rgb, cb6[0].w)
              out = E · ( lerp(D, B, P) · albedo  +  specular
                          + cb6[1].rgb · ambient·k  +  cb6[1].rgb · (luma709(ambient·k)·cb6[1].w − ambient·k) · cb6[2].x )
```

`E` and `k` are per-frame exposure scalars; `luma709` uses 0.2126/0.7152/0.0722. Consequences:

- **Post-scatter texturing.** The blur spreads *light*, then the pixel's own albedo multiplies it. Skin colour detail, freckles and **makeup colour stay sharp**; only shading softens [observed].
- **`P` is a per-channel strength** that lerps between unblurred and blurred light. That matches the role of a "strength" colour in the separable-SSS kernel and plausibly comes from `CSkinProfile.diffuse` (255, 255, 255 in the default profile: full blur) [hypothesis].
- **Specular is added unblurred.**
- The **ambient** term is added outside the scatter, tinted and partly desaturated by `cb6[1..2]`; the character `GameOptions` `SkinAmbientIntensity_Factor` (0.4) and `SkinAmbientMix_Factor` (1.0) are plausible sources of those registers [hypothesis; values [community]: [head CC rendering §2](../../knowledge/head-cc-rendering.md#2-skin-type-tone-and-the-complexion-texture-set)].
- A second output stores a weighted luminance of the scattered part (R ¼, G ½, B ¼); its consumer is unknown.

### 6.4 Translucency (the `UseTranslucency` setup)

`11387959167119825062` is the setup above plus a **sun transmission** term, added to the diffuse before the blur [observed]:

```
d = sceneDepth − backDepth                              // raw reversed-Z depths; backDepth from a second depth target
T = d ≥ 0 ? saturate(1.0111 − 15.128·d − 0.9598·d²) : 0
w = saturate((GBuffer2.z − 1/3) · 1.5)                  // skin: 0.1 + 0.9 · vertexColour.G
diffuse += sunColour · max(0, dot(cb1[41].xyz, sunDir)) · T · w · t3.y
```

- The back depth is most plausibly the `skin_translucency` pass (§2.2): farthest back faces of skin meshes [source-supported by that pass's state and this arithmetic].
- `cb1[41]` is a per-frame camera vector (so the term peaks when the camera looks toward the sun: back-lit ears and nostrils), and `t3.y` a per-pixel factor, most likely sun shadowing [hypothesis for both].
- **This corrects an earlier reading.** The knowledge page said skin's GBuffer2.z reaches no lighting and that both programs indexed as `Setup_UseTranslucency` were sun lights. The static index lists two GUIDs under that name. By content, `11387959167119825062` is the translucency setup and reads GBuffer2.z; `2220067148481019988` is a full sun-light program attributed to the name by the index's heuristic. The global and local light still read GBuffer2.z only for Foliage [observed].
- **When the variant runs** (a quality or feature setting, such as the character SSS toggle) is [hypothesis].
- **Makeup consequence.** A decal writing surface coverage blends GBuffer2.z toward 1/3, which removes this transmission where the decal covers. The thickness falls to zero within a small depth difference, so only thin parts (ears, nostril wings, fingers) transmit. Eyelid and lip makeup sit over thick geometry, so the effect is negligible there [source-supported by the arithmetic].

### 6.5 Skin profiles

`CSkinProfile` fields: `blurSize`, `diffuse`, `falloff`, `roughness0`, `roughness1`, `lobeMix` [source-supported: RED4ext `G/CSkinProfile.hpp:19-24`]. `default.sp` (2.31): `roughness0` 0.966366, `roughness1` 1.59684, `lobeMix` 1, `blurSize` 1.4, `diffuse` 255/255/255, `falloff` 255/178/165 [observed]. The engine keeps **8 slots** per frame (the `cb6` kernel array and the 3-bit slot) [observed]; what happens with more than 8 distinct profiles on screen is [hypothesis].

## 7. The lip seam artefact

**What was reported.** A bright white line along the lip parting in the Studio preview, in September 2026, when the preview drew the head with a Blender-master tile set on a stock `MeshStandardMaterial` ([eye and lip optics audit](../eye-artistry/eye-lip-optics-audit.md#why-the-lip-seam-is-a-separate-problem)). Uniform roughness removed it in a locked A/B; flat normals did not.

**What the game's own inputs say** [observed, vanilla female head `h0_000_wa_c__basehead_rm01.xbm` and `h0_000_pwa_c__basehead_d01.xbm`, three columns through the mouth at 1024²]:

- The **lip body** is the glossiest skin on the head: R 66–99 (roughness 0.26–0.39 before the bias) against about 0.65 on the cheeks, with B about 0.5 (so less micro-normal and bias).
- The **parting band** (the inner-lip strip where upper and lower lip meet in UV) is a flat, textureless R 99 (0.39), slightly *rougher* than the lip body, not a narrow glossy line.
- The albedo shows no white stroke.

So the game's texture set does not draw a white seam. Under skin's dual lobe the lips are expected to carry a broad highlight (lobes at about 0.25–0.37 and 0.4–0.6), not a thin line.

**Where a thin line can still come from** [hypothesis, ordered by likelihood for the current preview]:

1. **Image-based light on the crease normals.** Where the lips meet, the surface folds inward; a bright environment reflected through the glossy lobe along that fold draws a line. The game's deferred light has no probe term in the direct light (reflections come from probes/SSR), while the preview adds `RoomEnvironment` through both lobes.
2. **Geometry**: overlapping upper/lower lip triangles, or the parting band's squeezed UVs pulling a tangent-frame discontinuity.
3. **Missing inner-mouth components** (teeth, tongue, mouth interior), which in game darken what is seen through the parting.

**Status.** The current preview draws the resolved game head through `skin-material.ts`, so the old Blender-tile cause is gone; whether a seam remains has not been re-measured. The next check is the audit's five-way capture (preview; no environment; roughness override; flat normals; wireframe/depth) on the current preview, then game frames of the closed mouth under a moving light (§10).

## 8. What the browser adapter reproduces

`projects/xf-studio/authoring/src/skin-material.ts` ports §5.1–§5.4 line by line and approximates §6 [observed by comparing the adapter with the decompiled program]:

| Step | Adapter | Status |
|---|---|---|
| RG normal unpack, detail and micro slope-sum blends, micro atlas halves, `SampleGrad`, B/G selector steps, the left/right asymmetry | Same arithmetic | Faithful |
| Roughness bias, cavity, tone (multiply/overlay), secondary albedo | Same arithmetic | Faithful |
| Wrinkle normals and blood flow | Not drawn | Faithful **at rest** (both weights 0); animated wrinkles need §5.6's regions and tracks |
| Metalness = Roughness.G | Same | Faithful |
| Wetness | Not drawn | Faithful when dry |
| Emissive | Not drawn; reported when a mask would glow | Gap |
| Dual-lobe GGX, F0 0.04, Burley diffuse | Same | Faithful to the direct light |
| SSS | Per-channel diffuse **wrap** from `falloff` and `blurSize`, off above metalness 0.1 | Approximation: the game blurs irradiance in screen space and multiplies albedo afterwards (§6.3); a wrap softens the terminator but not texture-scale shading |
| Translucency | Not drawn | Gap for thin, back-lit parts |
| Ambient and reflections | Three's image-based light through both lobes | Approximation; the game's ambient bypasses the scatter and is tinted by `cb6[1]` |

**Browser follow-ups this study suggests** (separate reviewable changes with before/after evidence, per the backlog):

1. A screen-space separable blur of diffuse irradiance with post-scatter albedo would reproduce §6.3 more faithfully than the wrap. The kernel's CPU construction is still unknown, so a first version should take Jimenez's published kernel with `blurSize` as width and `falloff` as the per-channel falloff, labelled as an approximation.
2. The lip seam capture of §7 on the current preview.

## 9. Open questions

1. How the CPU turns `blurSize`, `falloff` and `diffuse` into the kernel table and the column-0 strength (a RED4ext read of the kernel texture, or a debug capture, would settle it).
2. Which setting selects the `UseTranslucency` setup, and what `cb1[41]` and the transmission's `t3.y` are.
3. The source of the wrinkle regions (`TextureRegionsCB`) and float tracks, and whether they come from the facial setup's wrinkle outputs.
4. `TintColor` encoding (byte/255 or sRGB-decoded): [materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions).
5. What happens with more than 8 skin profiles on screen.
6. The three siblings (`skin_blendable`, `skin_morph`, `blackwall_blendable_skin`) are not decompiled.

## 10. In-game test asks (batch into the prepared session)

1. **Back-lit ear** in photo mode, sun behind the head, with and without a decal over the ear: shows whether the translucency variant runs at the test's settings.
2. **Closed-mouth close-up** under a slowly moving key light: is there a thin bright line along the parting in the game at all?
3. **Neck seam**: head and body tone match at the neck under the creator light (with the body track's body test).

Related: [materials and shaders](../../knowledge/materials-and-shaders.md) · [head CC rendering](../../knowledge/head-cc-rendering.md) · [shader-system evidence](shader-system/README.md) · [annotation results](shader-system/annotation-results.md#basematerialsskinmt) · [hair reference](shader-hair.md) · [fact index](shader-fact-index.md).
