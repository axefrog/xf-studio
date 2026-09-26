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
| `bin\x64\Cyberpunk2077.exe` (2.31) | SHA-256 `a7de8294…a60991` (full hash in the [hair reference](shader-hair.md#1-pinned-inputs)); read with Capstone 5.0.9 through `exe_hair.py dis` at the RVAs in §6.3 |
| Method | [shader-system evidence note](shader-system/README.md#method-repeatable-in-minutes); outputs stay local and ignored |

| Program (MeshSkinned unless noted) | GUID | DXBC SHA-256 |
|---|---|---|
| `skin` `gbuffer_regular` pixel | `12806642364631437234` | `8040f820…a36053` |
| `skin` `gbuffer_regular` vertex | `7494393843130164436` | `789b74c4…d8f459b` |
| static `m_postfx_SubsurfaceScattering_Setup` | `18323727242039837728` | `a72893f1…26e708a` |
| static `…_Setup_UseTranslucency` (content-confirmed, below) | `11387959167119825062` | `5760e2dc…b425901` |
| static `…_Blur_Horizontal` | `13638945895069409584` | `296eb4a5…fb1372` |
| static `…_Blur_Vertical` | `1061893983243070248` | `65b9ed67…314ef1f` |
| static `…_Blur_Stochastic` | `5799281617917762538` | `8f0ad92c…4bec45` |
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

The body track's inventory ([body rendering](../../knowledge/body-rendering.md)) records [observed, resource]:

- every body skin part (torso `t0_000_pwa_base__full`, feet, arms and hands, genitals, plain nail colours) is `skin.mt` with a local material per tone over **the same four-level tone chain**, so a tone is again only `TintColor`, `TintScale` and the tint mask;
- the tone reaches the body through the creator's `skin color` link, which the body, arms, feet, nipples and genitals follow;
- the body has **no skin type**: every tone shares `base\characters\common\base_bodies\woman_average\textures\t0_000_wa__c_base_d02.xbm`, `…_n02.xbm` and `…_rm02.xbm`, with no `SecondaryAlbedo` in the vanilla chain. The `base\4k\common\body\wa\textures\d02_naked.xbm`, `n02_naked.xbm`, `wa_base_rm02.xbm` maps and the full-body `SecondaryAlbedo` overlay (`…\overlays\fullbody_overlay_d01.xbm`) seen on the reference profile belong to the KS UV framework's player-only chain ([tattoos §8](../../knowledge/tattoos.md#8-how-mods-add-tattoos)).

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

`m_postfx_SubsurfaceScattering_Setup` (`18323727242039837728`), for pixels whose stencil class is 1 (`(stencil & ~31) == 32`): copies the light's diffuse output as `.xyzx` (so its alpha is the red irradiance) and writes linear depth `1 / (a·(b·z + c) + d)` from `cb12` registers 25–26 [observed].

All SSS programs are compute shaders with 8 × 8 threads that walk a list of 16 × 16-pixel tiles (`t11`), so only tiles holding skin are processed [observed]; the tile list is most plausibly the per-tile class mask of `m_classifyMaterials` ([shader-system note](shader-system/README.md#g-buffer-decode-in-the-deferred-light-_00000001-ssa-in-that-program)) [hypothesis].

### 6.3 Blur, kernel and combine

The GPU side is read from the compiled blur and combine programs. The kernel itself is built on the CPU, and was read from the executable (RVAs of the 2.31 build; `exe_hair.py dis <start> <end>` reproduces each listing).

#### 6.3.1 The separable blur (GPU)

`13638945895069409584` (horizontal) and `1061893983243070248` (vertical) are identical except for the axis and `cb0[3].x` versus `.y` [observed, decompiled listings compared]. Their only constant register is `cb6[0]` = (width scale `w`, first kernel column `c₀`, tap count `n`, frame index). For each class-1 pixel [observed]:

```
if GBuffer2.x (metalness) > 0.1:  out = 0                                    // handled by the combine's non-SSS path
slot = uint(GBuffer1.w·3) << 1 | (uint(GBuffer2.w·255) >> 6) & 1
s    = w / (linearDepth · 100)                                               // linearDepth from the setup (§6.2)
K₀   = table[slot, c₀]                                                       // centre weight, RGB
num  = K₀.rgb · C(p);   den = K₀.rgb + 1e-5
for i in 1 … n−1:
    K = table[slot, c₀ + i]                                                  // RGB weight, A = offset
    for each side ±:
        q = p ± int(K.a · s · 3072 · cb0[3].x) along the axis                // truncated to whole pixels, unfiltered load
        if class(q) == 1 and C(q).a > 0:  num += K.rgb · C(q).rgb;  den += K.rgb
out.rgb = num / den (per channel);  out.a = out.r
```

`C` is the pass input: the setup's copy for the first pass, the first pass's output for the second. Because the setup and each pass write alpha = red, a neighbour counts when its red irradiance is positive.

Consequences [observed arithmetic unless marked]:

- **The only rejection is the lighting class.** There is no depth or normal test. The blur crosses any Subsurface pixels that touch on screen: the two lips across the parting, skin and **teeth** (the teeth are `skin.mt`, §3.1), a hand in front of the face. Eyes (class 3), hair (class 4) and everything Standard are excluded, and the weights renormalise at their edges.
- **Shadow does not darken light.** An unlit neighbour (red 0) is excluded and the rest renormalise, so light spreads into a shadowed pixel from its lit neighbours, but a lit pixel is not darkened by shadowed ones. Ambient light is not in this buffer (the combine adds it), so a hard sun terminator softens only towards its dark side [visual consequence source-supported by the arithmetic].
- **Whole-pixel taps.** Offsets are truncated towards zero and read without filtering. Taps closer than one pixel land on the centre pixel, so a distant face gets less blur than the kernel's width suggests, and the kernel steps as the face moves instead of scaling smoothly.
- **Only the centre is gated by metalness.** A metallic neighbour's irradiance still counts.
- **One kernel per pixel, from its own slot.** A neighbour is weighted with the *centre's* row, whatever its own profile.
- **Order** is not in the programs. Horizontal first, as in the published technique, is a [hypothesis]; the order matters only at mask and shadow edges, where each pass renormalises differently.

#### 6.3.2 The kernel table (CPU)

Built by `0xae31e8` whenever the profile list changes; the getter `0xae3188` rebuilds a dirty table, then `0xae3a5c` copies the dual-specular kernels of §6.1 [observed]:

- **Profiles.** At most 8 (`min(count, 8)`). Each render-side record is 32 bytes: +0 `blurSize` (float), +4 `diffuse` (RGBA8), +8 `falloff` (RGBA8), +0xC `roughness0`, +0x10 `roughness1`, +0x14 `lobeMix` [observed use of each offset; field names by `CSkinProfile`'s field order, source-supported].
- **Colours are sRGB-decoded.** RGB goes through the engine's 256-entry sRGB-to-linear table (built at `0xf55d0` from 0.04045, 1/12.92, 1/1.055 and 2.4); A is byte/255. Strength = `srgb(diffuse)` clamped to [0, 1]; falloff = `srgb(falloff)` clamped to [0.009, 1]. This covers profile colours only; it does not settle the encoding of material `Color` parameters ([materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions)).
- **Table 1: 32 × 8 texels, one row per slot.** Column 0 = strength (the combine's `P`), column 1 = falloff (read by no program examined), columns 2–14 the 25-sample kernel (`n` = 13), 15–23 the 17-sample kernel (`n` = 9), 24–29 the 11-sample kernel (`n` = 6).
- **Table 2: 256 × 8** holds one 511-sample kernel per slot (`n` = 256) for the stochastic blur (§6.3.4), with the RGB weights multiplied by 536.
- **Offsets carry `blurSize`.** Every entry's A is multiplied by `blurSize / 3072` (a 1/3 in the vector constant and a 1/1024 scalar); RGB is left alone. So `blurSize` scales the radius and nothing else, and the shader's 3072 undoes the constant.

**The kernel of `n` stored entries** (`0xae35f4`, with `profile` at `0xae389c` and `gaussian` at `0xae39b0`) [observed]:

```
N = 2n − 1;  range = N > 20 ? 3 : 2;  step = 2·range / (N − 1)
x_i = sign(o_i) · o_i² / range,  o_i = −range + i·step                  // offsets, dense near 0
area_i = (|x_i − x_{i−1}| + |x_{i+1} − x_i|) / 2                          // a missing neighbour contributes 0
K_i.rgb = area_i · profile(x_i),  K_i.a = x_i
profile(r) = 0.100·G(0.0484, r) + 0.118·G(0.187, r) + 0.113·G(0.567, r) + 0.358·G(1.99, r) + 0.078·G(7.41, r)
G(v, r).c = exp(−(r / (falloff.c + 0.001))² / (2v)) / (2πv)             // per channel c
move the centre entry first; divide each channel by its sum over all N; store the centre and the n − 1 positive offsets
```

This is **Jimenez et al.'s reference kernel** (`calculateKernel`, `profile` and `gaussian` of the published Separable SSS code, exponent 2) line for line [source-supported: a constant-for-constant match]. Its profile is d'Eon and Luebke's six-Gaussian skin fit without the narrowest term (variance 0.0064), as in the reference, and with that fit's red-channel weights for all three channels: **colour enters only through `falloff`**. One difference: the reference bakes the strength into the kernel (centre lerped towards 1, the others scaled); the game stores it in column 0 and applies it once, in the combine.

The default profile (`default.sp`: falloff 255/178/165 → (1.000, 0.445, 0.376); strength (1, 1, 1)) gives this 25-sample kernel. Offsets are before the `blurSize` scale; the two taps of a pair share each weight, so centre + 2 × the rest = 1 per channel [observed construction, computed]:

| Offset | 0 | 0.021 | 0.083 | 0.188 | 0.333 | 0.521 | 0.750 | 1.021 | 1.333 | 1.688 | 2.083 | 2.521 | 3.000 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R | 0.0221 | 0.0440 | 0.0839 | 0.1028 | 0.0855 | 0.0549 | 0.0373 | 0.0268 | 0.0197 | 0.0146 | 0.0104 | 0.0070 | 0.0020 |
| G | 0.0480 | 0.0944 | 0.1492 | 0.1008 | 0.0543 | 0.0332 | 0.0213 | 0.0126 | 0.0062 | 0.0025 | 0.0010 | 0.0004 | 0.0001 |
| B | 0.0564 | 0.1103 | 0.1595 | 0.0907 | 0.0493 | 0.0296 | 0.0177 | 0.0090 | 0.0036 | 0.0013 | 0.0005 | 0.0002 | 0.0000 |

Red keeps weight out to the full range; green and blue fall off within about a third of it. The teeth profile (`customisation_teeth.sp`, zero falloff, clamped to 0.009) puts essentially all weight on the centre, so teeth pixels are not blurred, though neighbouring skin pixels still gather light from them.

#### 6.3.3 Quality, radius and scale

- **The quality setting picks the kernel** [observed]. The blur's `c₀` and `n` come from two static arrays, {0, 2, 15, 24} and {2, 13, 9, 6}, indexed by a value (`0x3462c2c`) that the `SubsurfaceScatteringQuality` setting writes (`0x18bcca4`, `0x20403d2`): setting 0 → 11 samples, 1 → 17, 2 → 25. That settings 0–2 are the menu's Low, Medium and High is a [hypothesis] from their order. Index 0 (columns 0–1, the strength and falloff colours) is presumably never used [hypothesis]. These are the three sample counts the Separable SSS demo offers.
- **Screen radius.** A tap at stored offset `x` lands `x · blurSize · w · cb0[3].x / (100 · d)` pixels away, with `d` the linear depth [observed formula]. It is world-space-constant if `cb0[3].x` is the focal length in pixels, which the per-axis `.x`/`.y` use suggests [hypothesis].
- **`w`** (`cb6[0].x`) is a float from the frame's render settings times 1/6 (`0x621822`); its source is not identified [observed arithmetic, unknown input]. `cb6[0].w` is a frame counter, the stochastic blur's seed.
- **Units.** The profile is evaluated at `r = x`, so `x` is in the units of d'Eon and Luebke's variances (mm²). If one unit maps to `blurSize` millimetres, `default.sp` reaches 4.2 mm at High [hypothesis]. The true product `w · cb0[3].x` is the first thing a parity capture must measure (§11.6).

#### 6.3.4 The stochastic blur

`5799281617917762538` replaces the two passes with **one random tap per pixel per frame** [observed]:

- a hash of the pixel and the frame counter gives a position `u ∈ [0, 256)` along table 2 (interpolating two entries) and an angle uniform in [0, 2π);
- the tap is `3 · 1024 · x · s` pixels away along that angle (`cb0[3].x` horizontally, `.y` vertically), the same radius as the separable passes;
- the output is the tap's irradiance times the interpolated weight, or zero if the tap is not a lit Subsurface pixel. There is no normalisation, so the result is only right after temporal accumulation (TAA or an upscaler) [source-supported].

The blur node binds table 2 in its mode 2 (`0x62164b` → `0x292757c`) [observed]. Which setting selects it (the executable names a `CharacterSubsurfaceStochastic` option) is a [hypothesis]. Accumulated, it approximates a 2D radial kernel, not the separable product.

#### 6.3.5 Combine

`7703933925853799832` [observed]:

```
metal > 0.1:  out = E · (specular + diffuse·k)                         // no SSS
otherwise:    D = diffuse·k, B = blurred·k,  P = table[slot, column 0].rgb
              albedo = lerp(GBuffer0², cb6[0].rgb, cb6[0].w)
              out = E · ( lerp(D, B, P) · albedo  +  specular
                          + cb6[1].rgb · A  +  cb6[1].rgb · (luma709(A)·cb6[1].w − A) · cb6[2].x ),   A = ambient·k
```

`E` and `k` are per-frame exposure scalars; `luma709` uses 0.2126/0.7152/0.0722. The constants come from `0x6209e8` [observed in the executable; that this 4-register block is the combine's `cb6` is source-supported by its size and by the kernel-table getter it calls]:

- `cb6[0]` = 0 in normal rendering, so albedo is simply GBuffer0². Three debug view modes set it to 18 % grey or white.
- `cb6[1]` = (`SubsurfaceSpecularTint` R, G, B, 1 / luma709(tint)), built at `0xcedab4`; defaults (0.21, 0.26, 0.29) and 3.98.
- `cb6[2].x` = `SubsurfaceSpecularTintWeight` (0.3); `.y` is a flag; `.zw` are two values scaled by 2/width and 2/height. `cb6[3]` holds three integers × 2⁻¹⁷ and 1 (roles unknown).

Consequences:

- **Post-scatter texturing.** The blur spreads *light*, then the pixel's own albedo multiplies it. Skin colour detail, freckles and **makeup colour stay sharp**; only shading softens [observed].
- **`P` is the profile's `diffuse` colour, sRGB-decoded** (§6.3.2) [observed]: 255/255/255 in the default profile, so full blur.
- **Specular is added unblurred.**
- **The `A` term is tinted, outside the scatter.** It becomes `tint · (0.7·A + 0.3 · luma(A)/luma(tint))`, about (0.40, 0.49, 0.55) × a grey `A` at the defaults: halved and cooled. The option's name suggests `A` is the skin's environment specular (reflections) [hypothesis]. `SkinAmbientIntensity_Factor` and `SkinAmbientMix_Factor` do not feed these registers; they are read elsewhere (`0x154610`, not traced).
- A second output stores a weighted luminance of the scattered part (R ¼, G ½, B ¼); its consumer is unknown.
- `CombineRTXDI_RELAX` and `CombineRTXDI_REBLUR` variants exist for the ray-traced direct-light paths and are not read.

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

`CSkinProfile` fields: `blurSize`, `diffuse`, `falloff`, `roughness0`, `roughness1`, `lobeMix` [source-supported: RED4ext `G/CSkinProfile.hpp:19-24`]. `default.sp` (2.31): `roughness0` 0.966366, `roughness1` 1.59684, `lobeMix` 1, `blurSize` 1.4, `diffuse` 255/255/255, `falloff` 255/178/165 [observed]. The engine keeps **8 slots** per frame (the `cb6` kernel array, the 3-bit slot and the 8-row kernel tables, filled from at most 8 profiles) [observed]; what happens with more than 8 distinct profiles on screen is [hypothesis].

What each field does [observed, §6.1 and §6.3.2]:

| Field | Reaches | As |
|---|---|---|
| `blurSize` | Every kernel offset | A radius multiplier; the weights do not change |
| `diffuse` (RGB, sRGB-decoded) | Kernel table column 0 → combine `P` | Per-channel strength: 0 keeps the unblurred light, 1 takes the blurred |
| `falloff` (RGB, sRGB-decoded, clamped to ≥ 0.009) | The kernel's Gaussians | Per-channel width: `r / (falloff + 0.001)`, so a smaller value keeps that channel's light closer |
| `roughness0`, `roughness1`, `lobeMix` | `cb6` registers 4–11 of the light | The dual specular lobe |
| The colours' alpha | Columns 0–1's A | Scaled like an offset; read by no program examined |

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
| SSS | Per-channel diffuse **wrap** from `falloff` and `blurSize`, off above metalness 0.1 | Approximation: the game blurs irradiance in screen space with a decoded kernel and multiplies albedo afterwards (§6.3); a wrap softens the terminator but not texture-scale shading. The port is planned in §11 |
| Translucency | Not drawn | Gap for thin, back-lit parts |
| Ambient and reflections | Three's image-based light through both lobes | Approximation; the game adds one ambient term (probably the reflections) outside the scatter, tinted by `SubsurfaceSpecularTint` (§6.3.5) |

**Browser follow-ups this study suggests** (separate reviewable changes with before/after evidence, per the backlog):

1. Port the screen-space scatter with the game's own kernel (§11).
2. The lip seam capture of §7 on the current preview.

## 9. Open questions

1. **The kernel's screen scale.** The kernel table, the strength and the quality mapping are decoded (§6.3.2–6.3.3); the product `w · cb0[3].x` that turns kernel units into pixels is not. The source of `w` (a render-settings float × 1/6) and the meaning of `cb0[3]` would settle it (a RED4ext read), or a parity capture can fit it (§11.6).
2. **Which blur runs.** Separable or stochastic, under which setting (`CharacterSubsurfaceStochastic`, the upscaler, ray tracing), and whether the separable passes run horizontal first.
3. **The combine's tinted term.** Whether the `A` input (`t6`) is the environment specular or the ambient diffuse, and where `SkinAmbientIntensity_Factor` and `SkinAmbientMix_Factor` act.
4. Which setting selects the `UseTranslucency` setup, and what `cb1[41]` and the transmission's `t3.y` are.
5. The source of the wrinkle regions (`TextureRegionsCB`) and float tracks, and whether they come from the facial setup's wrinkle outputs.
6. `TintColor` encoding (byte/255 or sRGB-decoded): [materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions).
7. What happens with more than 8 skin profiles on screen.
8. The three siblings (`skin_blendable`, `skin_morph`, `blackwall_blendable_skin`) are not decompiled.

## 10. In-game test asks (batch into the prepared session)

1. **Back-lit ear** in photo mode, sun behind the head, with and without a decal over the ear: shows whether the translucency variant runs at the test's settings.
2. **Closed-mouth close-up** under a slowly moving key light: is there a thin bright line along the parting in the game at all?
3. **Neck seam**: head and body tone match at the neck under the creator light (with the body track's body test).
4. **Scatter width and quality.** Photo mode, one hard key light raking across the cheek so its shadow terminator crosses the face, camera fixed: frames at Subsurface Scattering Quality Low and High, then High again at a second camera distance (about twice as far). Record the upscaler, ray-tracing mode and SSS quality. This gives the parity fit of §11.6 its data, and shows the 11- versus 25-sample difference. A Low/High pair that looks identical would suggest the stochastic blur, which ignores the quality setting.

## 11. Preview port plan: screen-space scatter in Three.js

A plan for a code track, ranked; nothing here is built yet. It replaces the wrap stand-in (§8) with the game's mechanism (§6.3) in the WebGL 2 renderer (Three.js 0.186). Grades on the game side are those of §6; statements about the Studio's code are [observed] in the files named, and costs are estimates to be measured.

### 11.1 What to reproduce, and the shortcut that makes it cheap

For a Subsurface pixel with blended metalness ≤ 0.1, the game outputs `lerp(E, B, P) · albedo + specular + tinted A`, where `E` is the direct diffuse irradiance (albedo 1), `B` its blurred copy, `P` the profile strength and `albedo` the pixel's final G-buffer colour after decals (§6.3.5). The preview's forward pass already writes `E · albedo + specular + ambient` for skin, decals and the plate. So the scatter can be added as a **delta**:

```
Δ = (lerp(E, B, P) − E) · albedo        on class-1 pixels with metalness ≤ 0.1, else 0
final = forward scene + Δ               before the display transform
```

Specular and the image-based light never enter `E`, so they stay sharp exactly as in game, and the forward materials keep their outputs. The one requirement is that the forward skin diffuse is the same `E` that the scatter pass sees: the wrap must be off (`xfsWrap = 0`) whenever the scatter runs.

### 11.2 Render targets

All targets are single-sample, at the display target's drawing-buffer size (`linear-display.ts` `ensureTarget`), created and resized with it.

| Target | Format | Contents |
|---|---|---|
| **S0** scatter input | RGBA16F | RGB = `E`, the direct diffuse irradiance with albedo 1: Burley at the pixel's roughness, all direct lights with their shadows, no wrap, no image-based light. A = the pixel's **class-1 flag**, written opaque by skin and never changed by decals |
| **S1** surface | RGBA8 (RGBA16F if Three.js 0.186 cannot mix attachment types) | RGB = `sqrt(albedo)`, blended by decals in that space exactly like GBuffer0. A = profile slot, (slot + 1)/8 |
| **S2** metalness | same type as S1 | R = the blended metalness (the SSS gate) |
| Depth | `DepthTexture` (float) | Linear view depth for the radius, from the camera's near/far |
| **P0**, **P1** | RGBA16F | Blur ping-pong: P0 = horizontal result, P1 = `Δ` |

S0–S2 are one multiple-render-target (`count: 3`) target. Blending uses each attachment's own output alpha, so a decal can blend S1 at its colour alpha and S0 at its normal alpha in one draw. With colour factors `SrcAlpha/OneMinusSrcAlpha` and alpha factors `Zero/One`, the class flag and slot are never touched, which matches the game's RGB write mask and untouched stencil (§6.3.1, [decal reference](shader-decal.md)).

Memory is about 36 bytes per drawing-buffer pixel (S0–S2 and depth 20–28, P0–P1 16): about 75 MB at 1920 × 1080 and about 230 MB at 3200 × 2000 (a large canvas at pixel ratio 2). This is outside the preview-quality contract's 1 GiB generated-texture budget, which excludes framebuffers.

### 11.3 Passes

1. **Forward scene** (unchanged), with the wrap off when the scatter is on.
2. **Scatter input** into S0–S2. Every mesh draws with an *input variant* of its material, swapped in for this pass:
   - **Skin** (`skin-material.ts`): the same surface arithmetic; outputs `E`, `sqrt(albedo)`, metalness, class flag and slot.
   - **Face decals and brows** (`face-decal-material.ts`, `brow-material.ts`): S1 = `sqrt(decal colour)` at the colour alpha, so the hardware blend *is* the game's square-root blend, with no underlay solve. S0 = `E` of the blended surface at the normal/surface alpha (the decal's normal and roughness change `E`). S2 = metalness at the surface alpha.
   - **Authored plate** (`engine/render/plate-blend.ts`): it already forms the blended surface G and the skin under it S per fragment. S0 takes the same residual form it uses for light, `Y = (E(G) − (1 − A)·E(S)) / A` at alpha A. S1 and S2 take G's √colour and metalness at the colour and surface alphas.
   - **Everything else that the game draws into the G-buffer** (eyes, hair and lash cards where their alpha test passes, clothing, piercings) writes class flag 0 and depth, so it occludes and is excluded. Forward-only passes (the `eye_shadow` shell, glitter plates) are skipped, as they come after the game's SSS.
   - The teeth, once drawn (coverage audit rank 1), are skin with their own profile slot.
3. **Horizontal blur**: S0 → P0, the §6.3.1 loop with the game's kernel.
4. **Vertical blur and combine**: P0 → P1 = `Δ`, reading S1 (squared), S2 (gate), the slot's `P` and the unblurred `E` from S0.
5. **Display**: the creator and studio passes (`linear-display.ts`) add `Δ` to the scene value they read, before exposure and grade; in the studio path `Δ` is weighted by coverage like the scene colour.

Details to keep:

- **Kernel data.** A pure domain module (for example `skin-scatter-kernel.ts`) ports `0xae35f4` and the table layout of §6.3.2 and returns, per slot, the strength and the `n` entries for the chosen quality. The blur takes them as a uniform array (8 slots × 14 `vec4`, within WebGL 2's fragment uniform minimum), not a texture. It reimplements Jimenez et al.'s reference algorithm; if the code follows their published source, their licence notice goes into the release's third-party notices ([community credits](../../docs/community-credits.md#jimenez-et-al-2015)).
- **Slots.** The adapter assigns slots to the distinct resolved `.sp` profiles among drawn skin chunks, in first-seen order, up to 8. A ninth profile falls back to slot 0 and is reported in diagnostics, since the game's behaviour there is unknown.
- **The game's rules, not stricter ones.** Class mask and `red > 0` only, no depth test; whole-pixel taps (truncate, `texelFetch`); per-channel renormalisation; only the centre's metalness gates. The whole-pixel rule matters: it is why a distant face shows less scatter.
- **Scissor** the full-screen passes to the projected bounds of the skin meshes: the WebGL stand-in for the game's tile list.

### 11.4 How it meets the existing materials

- **Strength `P` and post-scatter albedo.** `P` is the profile's `diffuse` colour, sRGB-decoded (§6.3.2); `RenderSkinProfile` already carries it. The albedo is the *final* surface colour after decals and the plate (S1), so makeup and freckle colour stay sharp while shading under them softens, as in game.
- **Decals are lit as skin.** A post-G-buffer decal never changes the class or slot. Under the delta scheme, decal pixels scatter with the skin's kernel because S0.A and S1.A come from the skin underneath. The forward decal and plate materials already light with `patchSkinLight`; their wrap goes to zero with the skin's.
- **Metalness > 0.1.** S2 carries the blended metalness, so Metallic makeup switches the scatter off at the same coverage as the current wrap gate (about 15 % for the Metallic finish; [fact index](shader-fact-index.md)). Colour-shifting's 0.08 never crosses it.
- **The wrap stays as the fallback**: without a renderable half-float target (the `direct` / `srgb8` paths), in study pages, and when the scatter is switched off.
- **Parity passes share the machinery.** The input variant swap and the S1/depth targets are the `albedo`, `ids` and `depth` passes of the [parity measurement design](../authoring/game-parity-measurement.md) (phase P2). Build the swap once for both.
- **The ownership gate changes.** The [diffuse SSS gate](../../projects/xf-studio/authoring/evidence/diffuse-sss-gate-2026-09-24.md) asked for a semantic lip partition and depth rejection before any blur. The game has neither: it blurs across the lip parting and onto the teeth wherever they are Subsurface (§6.3.1). Parity means matching the game's class mask, so the gate's no-bleed test is now "no scatter outside the class-1 mask" (adopted 27 September 2026; [preview fidelity](../backlog/preview-fidelity.md) row 4).

### 11.5 Performance

- **Cost follows drawing-buffer pixels, not the preview quality presets.** The 512–4K presets size generated makeup textures ([preview quality contract](../authoring/preview-quality-contract.md)); the scatter's cost scales with canvas size × pixel ratio (at most 2) and the fraction covered by skin.
- **Per pixel**, at High: 25 taps per pass with one fetch each (S0 carries the class flag, so no second fetch), plus 5 fetches for the combine: about 55 fetches. At Medium 17 + 17 + 5, at Low 11 + 11 + 5.
- **Estimate** [hypothesis, to measure]: about 1–3 ms per frame on a mid-range discrete GPU at 1920 × 1080, and several times that at 3200 × 2000 or on integrated graphics. The input pass costs about one more draw of the skin with its full surface arithmetic.
- **Only drawn frames pay.** The viewport renders on change, and continuously only while the idle plays.
- **Default quality** follows the game's own setting; High (25 samples) is the default until the game-side default is known. Offer it as a viewing preference beside the lighting presets, not as a recipe property. If High costs too much at pixel ratio 2, Medium is the first step down, not a half-resolution blur: whole-pixel taps make resolution part of the look.

### 11.6 Unknowns a parity capture must settle

1. **The screen scale `w · cb0[3].x`** (§6.3.3). Until then the preview uses one kernel unit = `blurSize` mm [hypothesis]. Fit: in-game test ask 4 (§10) gives a hard terminator at two distances and two qualities. Registered against the Studio's depth pass, the red fringe width versus depth fits the scale in one parameter, and the Low/High pair checks the kernel.
2. **Separable or stochastic**, and the pass order (edge-only).
3. **The tinted `A` term** (§6.3.5): whether the skin's image-based light in the preview should be multiplied by the `SubsurfaceSpecularTint` blend. A separate, small change once the input is known.
4. **The game's SSS quality at the test profile**, recorded with every capture.

### 11.7 Ranked work

| Rank | Step | Effort | Depends on |
|---|---|---|---|
| 1 | Kernel builder and table as a pure module, tested against §6.3.2's 25-sample table (to 1e-4), the channel sums and the offsets | S | – |
| 2 | Input-variant swap and the S0–S2 + depth target, with resize and dispose; shared with parity P2 | M | – |
| 3 | Blur, combine and display integration for both presets; wrap off while active; fallback kept | M | 1, 2 |
| 4 | Decal, brow and plate input variants (√-space colour, `E` at the normal alpha, metalness) | M | 2 |
| 5 | Scissor, quality setting, slot diagnostics, GPU timing at pixel ratio 1 and 2 | S | 3 |
| 6 | Fit the scale from the parity capture; update `w` and this page | S | test ask 4 |

Total **M–L**, as the coverage audit ranks it. Ranks 1–3 alone give a correct scatter on bare skin; rank 4 is needed before made-up faces are compared.

### 11.8 Checks that validate it

- **Unit**: the kernel table (rank 1); a TypeScript reference blur on a small synthetic class mask and irradiance image, compared with a GPU readback of the same passes, including renormalisation at mask edges, the `red > 0` rule and whole-pixel truncation.
- **Browser, in a `?verify=1` workspace**:
  - `Δ` is zero outside class 1 (against the ID pass) and on a Metallic plate above the threshold;
  - makeup colour sharpness is unchanged (the high-pass of the albedo-normalised image matches scatter off);
  - with diffuse light off, the frame is identical to scatter off (specular untouched);
  - the scatter fades out as the camera pulls away (whole-pixel collapse);
  - Low, Medium and High differ.
- **Parity**: test ask 4 fits the scale (§11.6), then the terminator's red fringe on cheek, nose wing and ear is compared per region with the [parity metrics](../authoring/game-parity-measurement.md#32-measures).
- **In game**: test asks 2 and 4 (closed mouth; terminator at two qualities) are the acceptance frames.

Related: [materials and shaders](../../knowledge/materials-and-shaders.md) · [head CC rendering](../../knowledge/head-cc-rendering.md) · [shader-system evidence](shader-system/README.md) · [annotation results](shader-system/annotation-results.md#basematerialsskinmt) · [hair reference](shader-hair.md) · [fact index](shader-fact-index.md).
