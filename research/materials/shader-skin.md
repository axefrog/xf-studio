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
| SSS | **The game's screen-space scatter** (§11): the input variants write the irradiance, √albedo, metalness, class and slot; the two separable passes with the game's kernel and rules; the combine's delta added before the display transform. **Fallback** (no half-float target, study pages, switched off): a per-channel diffuse **wrap** from `falloff` and `blurSize`, off above metalness 0.1, scaled by the surface's curvature (`min(1, 5 mm × κ)`, κ from screen-space derivatives of the interpolated normal; it can step at triangle edges, PREV-137), with the diffuse on the **macro normal** (normal and detail maps, without the tiled microdetail) | Faithful in mechanism; the screen scale is [hypothesis] until test ask 4 (§11.6). The wrap fallback is an approximation |
| Translucency | Not drawn | Gap for thin, back-lit parts |
| Ambient and reflections | Three's image-based light through both lobes | Approximation; the game adds one ambient term (probably the reflections) outside the scatter, tinted by `SubsurfaceSpecularTint` (§6.3.5) |

**Browser follow-ups this study suggests** (separate reviewable changes with before/after evidence, per the backlog):

1. Fit the scatter's screen scale from test ask 4 and compile its variants in the background (§11.7 ranks 6 and 7).
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

## 11. Screen-space scatter in the preview (Three.js)

**Built (27 September 2026, claude/sss-port).** The preview draws the game's scatter (§6.3) in the WebGL 2 renderer (Three.js 0.186) under both lighting presets whenever the display's target is half float. The wrap of §8 is the fallback. Statements about the Studio's code are [observed] in the files named. Measurements are from headless Chrome (ANGLE D3D11, RTX 4070) on the maintainer's V from the 27 September matched pair (skin type 5, Creator face camera) and the default V. The game side keeps §6's grades.

### 11.1 The delta scheme

For a Subsurface pixel with blended metalness ≤ 0.1, the game outputs `lerp(E, B, P) · albedo + specular + tinted A`, where `E` is the direct diffuse irradiance (albedo 1), `B` its blurred copy, `P` the profile strength and `albedo` the pixel's final G-buffer colour after decals (§6.3.5). The preview's forward pass already writes `E · albedo + specular + ambient` for skin, decals and the plate, so the scatter is added as a **delta**:

```
Δ = (lerp(E, B, P) − E) · albedo        on class-1 pixels with metalness ≤ 0.1, else 0
final = forward scene + Δ               before the display transform
```

Specular and the image-based light never enter `E`, so they stay sharp, as in game. The forward skin diffuse must be the same `E` the scatter blurs, so while the scatter runs every skin-lit material's wrap is gated off (`xfsWrapGate` 0).

### 11.2 Targets

All targets are single-sample, at the drawing-buffer size, and are created on the first frame that scatters. They are released on the first frame with no skin left in the scene (the V removed) or no half-float target, so no V costs nothing (`tests/webgl-scene-host.test.ts`); a skin only hidden (the body switched off) keeps them, like its own resources, so showing it again is instant (`tests/webgl-body.test.ts`).

| Target | Format | Contents |
|---|---|---|
| **S0** | RGBA16F | RGB = `E`: Burley at the pixel's roughness, every direct light with its shadow, no wrap, no image-based light, times (1 − metalness), as the forward diffuse is before the albedo. A = the pixel's **view depth** on a Subsurface pixel and 0 elsewhere: the class-1 flag and the blur's depth in one channel |
| **S1** | RGBA8 | RGB = `√albedo`, blended by decals in that space, as GBuffer0 is. A = profile slot as (slot + 1)/8 |
| **S2** | RGBA8 | R = the blended metalness (the gate) |
| Depth | renderbuffer | the input pass's depth test only |
| **P0**, **P1** | RGBA16F | P0 = the horizontal pass (RGB, and the depth again in A); P1 = `Δ` |

S0–S2 are one three-target draw (`WebGLRenderTarget` `count: 3`; Three.js 0.186 takes each attachment's own type, so S1 and S2 are 8-bit). A decal blends every target with colour factors `SrcAlpha/OneMinusSrcAlpha` and alpha factors `Zero/One`, so each target takes that output's own alpha as its weight and the class, depth and slot underneath never change: the game's RGB write mask.

Memory: 36 bytes per drawing-buffer pixel (S0 8, S1 4, S2 4, depth 4, P0 8, P1 8), as estimated. Measured by the scatter's own evidence: 23.1 MB at 990 × 648, 73.8 MB at 1920 × 1068, 143.8 MB at 2600 × 1536 (pixel ratio 2). 3200 × 2000 would take 230 MB. None of this counts toward the preview-quality contract's 1 GiB generated-texture budget, which excludes framebuffers.

### 11.3 Passes

1. **Forward scene** (unchanged), with the wrap gated off. `platform/scene/skin-scatter.ts` `prepare` decides before the forward pass: the scatter runs when it is switched on, the target is half float and some drawn mesh declares itself skin.
2. **Input** into S0–S2 (`platform/scene/pass-variants.ts`, the input-variant swap). Every visible mesh draws once more through a *variant* of its own material: the forward material seen through a prototype, so maps, uniforms, side and polygon offset are read live, with the pass's define, blend state and program key of its own. A material declares its role through the scene port (`declarePass`, `platform/api/scene.ts`), and the variant's program is its own forward shader with `XFS_SCATTER_INPUT` defined:
   - **Skin** (`skin-material.ts`, role `skin`): `E` accumulated in the skin light, the depth, `√albedo`, the slot and the metalness; opaque. The teeth's interior occlusion scales `E` too (`mouth-occlusion.ts`).
   - **Face decals lit as skin** (`face-decal-material.ts`, role `decal`): S1 = √ of the decal's own colour (not the forward solve's) at the colour alpha, so the hardware blend *is* the game's square-root blend; S2 = the decal's metalness at the surface alpha; S0 = `E` of the forward's lit blend at the forward's drawn alpha, so S0 mixes exactly as the forward light does.
   - **Brows** (`brow-material.ts`, role `decal`): S1 only (√colour at the coverage). They are lit as a standard surface, so they write no irradiance, and the skin's `E` and metalness stay under them.
   - **Authored plate** (`engines/layered-makeup/render/plate-blend.ts`, role `decal` while it is lit as skin): S0 in the residual form it uses for light, `(E(G) − (1 − A)·E(S)) / A` at the drawn alpha A, with the skin's `E(S)` kept apart in its under-light block; S1 and S2 = the merged decal's √colour and metalness at the coverage.
   - **Everything that declares nothing** follows the host's rules: a blended, non-depth-writing material is forward-only and left out (the eye's wetness shell, glitter and per-layer plates, the hair cap); every other built-in surface occludes (class 0, no irradiance), alpha-tested at half coverage when it draws by alpha-to-coverage or an alpha map (hair strands and lashes, as the parity design's `ids` pass wants); a custom shader or a surface without a depth test is left out. Lines, points and sprites are hidden.
3. **Horizontal blur** S0 → P0 and 4. **vertical blur and combine** P0 → P1 = `Δ`: the §6.3.1 loop with the game's kernel and rules, less one test. A tap counts on a Subsurface pixel (its source's A: S0's depth, then P0's copy of it), with no depth or normal test. Taps are whole pixels (`int()`, `texelFetch`), weights renormalise per channel, and only the centre's metalness gates. A pixel the first pass skipped (outside class 1, or metallic) is excluded in the second, as in game. The decoded `red > 0` neighbour test is left out (`SCATTER_RED_GATE` keeps it as an option): see the departures below.
5. **Display** (`linear-display.ts`): the display pass adds `Δ` at the same pixel before the creator's exposure and grade, or, in the studio path, to the coverage-divided scene value before tone mapping.

Details:

- **Kernel.** `platform/scene/skin-scatter-kernel.ts` (pure) ports `0xae35f4` and §6.3.2's table: per slot the strength `P` and the `n` stored entries with offsets × `blurSize`, packed as a uniform array (8 slots × 14 `vec4`). It reproduces §6.3.2's 25-sample `default.sp` table to 1e-4. It is written from the decoded routine, which is Jimenez et al.'s published algorithm, so the release notices carry their notice ([community credits](../../docs/community-credits.md#jimenez-et-al-2015)).
- **Slots.** The distinct resolved `.sp` profiles among the drawn skin, in first-seen order, up to 8, written to each skin material's slot uniform every drawn frame. A ninth falls back to slot 0 and is counted in the scatter's evidence. The maintainer's V fills two slots: the skin's profile (blur size 2.5, falloff 255/155/119) and the teeth's.
- **Scissor.** The full-screen passes and the input draw are scissored to the projected bounds of the skin meshes: their bind-pose bounding spheres with a 15 cm margin for the idle. At the creator's face framing that is the whole frame; it pays off at body framings.
- **Diffuse normal.** While the scatter runs the skin's Burley uses the full normal (microdetail included), as the game's G-buffer normal is; the macro normal (§8) stood in for the blur and stays with the wrap fallback.
- **Screen scale** [hypothesis, §11.6]: one kernel unit is `blurSize` millimetres (`SCATTER_SCREEN_SCALE` 1), so a stored offset lands `offset · 1e-3 · focal / depth` pixels away. At the Creator face camera (1.2 m, 15°) that is about 2 px per millimetre, and the maintainer's profile reaches 15 px.
- **Quality.** The game's High (25 samples) at every preview-quality size (`scatterQualityFor`): the cost below does not follow the generated-texture size, and whole-pixel taps make resolution part of the look, so a smaller canvas is not the first step down. Medium (17) and Low (11) are wired and tested.

Departures from the earlier plan, each for a reason:

| Plan | Built | Why |
|---|---|---|
| A separate `DepthTexture`, and the class flag in S0.A | The view depth in S0.A is both the flag and the depth | One fetch per tap gives class, red and depth; saves the depth texture |
| P0 plain | P0 keeps the depth in A | The second pass also reads one texture per tap |
| A decal's S0 at its normal or surface alpha | At the forward's drawn alpha | S0 then mixes as the forward light does, which the delta assumes |
| Brows as decals with irradiance | Colour only | They are lit as a standard surface; there is no skin irradiance to write |
| Macro-normal diffuse kept | Full normal while the scatter runs | The game's diffuse uses the G-buffer normal; the scatter does the smoothing now |
| The decoded `red > 0` neighbour test | Every class-1 tap counts | The test is discontinuous at exactly zero light. Where a shadow gets no direct light at all (the Studio's **Rim / dramatic**, which has no fill), an unlit pixel renormalises over its lit taps alone and takes most of their light: about 94 % of the red at a hard edge in the CPU reference, with energy added. The least light in the shadow (1e-4) turns it back into an ordinary, energy-conserving blur (36 % at the edge, an equal loss on the lit side). So across a penumbra the result flipped between the two. That drew axis-aligned streaks, a hard outer edge where the kernel ran out, and speckle (the first Rim / dramatic captures, 27 September). Without the test the blur is the conserving limit of the same rule, which is what the game's rule gives wherever any light reaches the shadow. `tests/skin-scatter-kernel.test.ts` checks conservation, continuity and the old rule's jump |

### 11.4 How it meets the existing materials

- **Post-scatter albedo.** `Δ` multiplies S1², the *final* colour after decals and the plate, so makeup and freckle colour stay sharp while the shading under them softens.
- **Decals scatter with the skin under them.** A decal never changes S0.A or S1.A, so it takes the skin's class, depth and kernel.
- **Metalness > 0.1.** S2 carries the blended metalness, so a Metallic decal or plate switches the scatter off at the same coverage as the wrap's gate. Colour-shifting's 0.08 never crosses it.
- **The wrap stays the fallback**: without a renderable half-float target (the `direct` and `srgb8` paths), in study pages (their own renderers), and when the verification switch turns the scatter off.
- **Parity passes share the swap.** `createPassVariants(spec)` takes any `PassSpec` (defines, draw state, an occluder patch); the parity measurement's `albedo`, `ids` and `depth` passes (phase P2) are further specs over the same swap.
- **The no-bleed rule** is the game's class mask ([preview fidelity](../backlog/preview-fidelity.md) row 4), tested on a real GPU (§11.8).

### 11.5 Performance

Measured on 27 September 2026 (RTX 4070, ANGLE D3D11, headless Chrome). Each figure is the minimum of six alternations of 60 frames (frames) or 30 runs (passes), because other work on the shared machine only ever adds time:

| Canvas | Frame, scatter off → on | The scatter's passes alone | First scatter frame (compiles the variants) |
|---|---:|---:|---:|
| 990 × 648, default V head only | 0.42 → 0.90 ms | 0.25 ms | 82 ms |
| 1920 × 1068, default V head only | 0.41 → 0.73 ms | 0.21 ms | 80 ms |
| 2600 × 1536 (pixel ratio 2), default V head only | 0.38 → 0.64 ms | 0.22 ms | 80 ms |
| 990 × 648, the maintainer's V (head) | 0.50 → 0.88 ms | 0.32 ms | 71 ms |
| 990 × 648, default V with body and clothes | 0.71 → 1.46 ms | 0.44 ms | 122 ms |

- **Cheap per frame, a one-off compile.** The passes cost a few tenths of a millisecond at every size measured. They barely grow with pixels on this GPU, so the figures are near the timing's own floor. The extra frame time beyond the passes is the input draw of the whole V. Integrated graphics are not measured. The first frame that scatters compiles one variant program per distinct drawn material: 19 on the maintainer's V (3 skin, 11 decal, 5 occluder) take 70–120 ms. Compiling them in the background while the wrap shows is the candidate fix ([performance track](../backlog/performance.md)).
- **Only drawn frames pay.** The viewport renders on change, and continuously only while the idle plays.
- **3200 × 2000 at pixel ratio 2 was not reached** under the 4 GB guard: the headless Chrome with the V passed it before the scene drew. The 2600 × 1536 run stands in for it.

### 11.6 Unknowns a parity capture must settle

1. **The screen scale `w · cb0[3].x`** (§6.3.3). The matched pair cannot fit it. Trial scales of 1.5, 2, 3 and 4 × on the pair's V raise the nose shadow's R/G toward the game's (1.0 → 2.3 against 3.1), but also its luminance (0.11 → 0.17 of the forehead, against the game's 0.084). They lower the face's contrast and worsen the per-region fit (rms 0.228 → 0.316). The wedge already holds too much light in the Studio, cyan fill that the game's wedge doesn't show (§11.8), so more scatter makes it brighter, not more like the game. Test ask 4 (§10) fits the scale free of that confound.
2. **Separable or stochastic**, and the pass order (edge-only).
3. **The tinted `A` term** (§6.3.5).
4. **The game's SSS quality at the test profile**, recorded with every capture.
5. **Shadows with no direct light.** With the `red > 0` test the game's rule jumps at exactly zero light (§11.3, departures). In the game some light almost always reaches a shadow, so the preview uses the conserving limit. If test ask 4's single-light frame shows a saturated band with a hard outer edge along the terminator, the game applies the test at zero, and `SCATTER_RED_GATE` would go back on for that case only.

### 11.7 Ranked work

| Rank | Step | State |
|---|---|---|
| 1 | Kernel builder and table as a pure module | **Done** (`tests/skin-scatter-kernel.test.ts`) |
| 2 | Input-variant swap and the S0–S2 target, with resize, release and dispose | **Done** |
| 3 | Blur, combine and display integration for both presets; wrap off while active; fallback kept | **Done** |
| 4 | Decal, brow and plate input variants | **Done** |
| 5 | Scissor, quality, slot diagnostics, GPU timing | **Done** (§11.5) |
| 6 | Fit the scale from test ask 4; update `SCATTER_SCREEN_SCALE` and this page | Open |
| 7 | Compile the variants in the background while the wrap shows, so a V's first frame doesn't pay 70–120 ms | Open |

### 11.8 Checks and measurements

- **Unit** (`tests/skin-scatter-kernel.test.ts`): the 25-sample table to 1e-4, channel sums, offsets and ranges, the teeth profile, sRGB decoding, the packed table, slot assignment and overflow, whole-pixel truncation, and the CPU reference blur (spread into the unlit side, lit pixels never darkened, the metalness gate, collapse at distance).
- **Real GPU** (`tests/webgl-skin-scatter.test.ts`, headless Chrome). A folded skin strip with a hard terminator, a Standard occluder in front of part of it and a Metallic decal band:
  - the GPU passes match the CPU reference run on the GPU's own input targets;
  - **no scatter outside the class-1 mask**: the occluder's pixels, taken from an independent mask render, carry neither class 1 nor `Δ`, while the unlit skin beside them scatters;
  - the Metallic band gates `Δ` off, writes its √colour and keeps the skin's class and slot;
  - red reaches furthest;
  - the wrap gate is 0 while the scatter runs and 1 after it is switched off, and every mesh gets its material back after the pass;
  - Low and High differ;
  - the display adds `Δ` only where it is non-zero.
- **Matched pair** (`tools/creator-pair-metrics.py`: regions carried from the game frame by a landmark affine; scene-linear through the installed Nova LUT; the eyes excluded). "Before" is the creator-lighting evidence (`v8-final-creator`), identical in every figure to this branch with the scatter off:

| Measure | Game | Before (wrap) | After (scatter) | Bare (no wrap, no scatter) |
|---|---:|---:|---:|---:|
| Forehead R/G (the metric set on 27 September) | 0.97 | 1.32 | 1.32 | 1.32 |
| Lit planes R/G, B/G (≥ 0.5 × forehead) | 1.08, 0.84 | 1.39, 0.80 | 1.41, 0.80 | 1.41, 0.79 |
| Terminator band R/G, B/G (0.12–0.5) | 1.24, 0.80 | 1.38, 0.83 | 1.33, 0.85 | 1.27, 0.85 |
| Shadow R/G, B/G (< 0.12) | 2.73, 0.67 | 0.96, 0.94 | 1.12, 0.95 | 0.88, 0.97 |
| Nose shadow R/G, luminance / forehead | 3.11, 0.084 | 0.95, 0.119 | 0.98, 0.111 | 0.85, 0.107 |
| Contrast, 95th / 5th percentile luminance of the face | 9.9 | 4.6 | 6.0 | 6.4 |
| Per-region luminance, rms of log ratios (10 regions) | – | 0.241 | 0.228 | 0.222 |

The creator-lighting pass reported 0.31 on its own boxes; 0.241 is the same frame on these boxes.

**What the pair says** [runtime, one matched pair]:

- **The lit skin's warmth is not subsurface scattering.** The forehead's R/G is 1.32 with the wrap, with the scatter and with neither. On a flat lit plane `B = E`, in game as in the preview, so no scatter changes it. The 27 September hypothesis that the wrap caused it is refuted. The gap lies in what reaches the G-buffer or the light: the skin's albedo and tone (`TintColor` encoding, materials open question 11), the light's colour on skin, or a term missing from the lit skin (such as the combine's tinted `A`). Hair still matches, which points at the skin.
- **The scatter moves the shadows the right way, a little.** The shadow side gains red (R/G 0.96 → 1.12) and the terminator band loses the wrap's red (1.38 → 1.33, toward the game's 1.24). Contrast rises toward the game's (4.6 → 6.0), and the region fit improves slightly (0.241 → 0.228).
- **The nose shadow shows the real gap.** The game's wedge is orange (R/G 3.1) at 8 % of the forehead; the Studio's is neutral (R/G 0.98) at 11 %. Profiles across it show the game's wedge lit almost only by scatter, and the Studio's lit mostly by the cyan fills, which nothing on the face occludes in the preview. So the fills, or their occlusion (the reference install runs ray-traced shadows, [creator lighting §12.4](../../knowledge/creator-lighting.md#124-what-remains)), are the next suspect. The grey patch on the upper lip is the same: the nose's cast shadow filled with cyan fill over skin type 5's baked contour, where the game shows scatter.
- **Rim / dramatic**, after the energy fix, softens the key's terminator smoothly, with a slight warm edge and no streaks or speckle (`sss-grid-rim.png`, private). The creator frames are unchanged by that fix (their fills keep `E` above zero), so the figures above stand.
- **The fills are not blocked where the game blocks them.** The Studio's nose wedge takes 54 % of its light from Fill_Upper and 33 % from Fill_Left (solo renders, scene-linear). Fill_Upper already casts (the six-light budget drops only Highlight_Body and Main_Body, both body lights), but it shines from below, where the nose can't block it. Fill_Left, never flagged, was tried as a seventh caster, and Main_Top as an eighth. The wedge stayed at 0.11 of the forehead and the region fit at 0.227–0.228. Both fills see the wedge geometrically, so occlusion doesn't explain the game's dark, orange wedge; weaker fills would (the luminance-only fit of [creator lighting §12.2](../../knowledge/creator-lighting.md#122-the-fit-and-what-the-preset-uses) wanted them ×0.3). Nine casters exceed the skin program's 16 texture units on this GPU, which is what the budget of six guards.
- **The lit skin's warmth, ranked:**
  1. `TintColor` encoding: ruled out. This V's tone overlays (255, 245, 181) at −0.15, which moves R/G by 2 % or less under either encoding.
  2. The combine's tinted term: bounded by [creator lighting §10.4](../../knowledge/creator-lighting.md#104-what-reaches-v-by-path) at about 4 % of the forehead's light, too small to move R/G by 27 %.
  3. Albedo decode: the served albedo is the raw texture (median sRGB 171, 141, 123), decoded once as its `isGamma` asks, which is how §4 reads the program. Its decoded R/G (1.54) is what the white key gives on the forehead (1.50). Undecoded it would be 1.22, and the forehead about 1.05, near the game's 0.97, but only if the game samples it without decoding.
  4. The key lights' colour: Main_Face, Main_Top, Main_Eyes and Highlight_Right store none, and the preview reads white ([creator lighting §2](../../knowledge/creator-lighting.md#2-the-box-and-its-lights)). A cooler default would cool the face, and the sclera reads about as much cooler in game (R/G ×0.7, small noisy samples). But the hair is lit 61–88 % by the same lights and matches, unless its profile decoding absorbed the difference.

  One game frame separates 3 from 4: the silver piercing from the [creator lighting §8](../../knowledge/creator-lighting.md#indirect-light-checks-same-session-four-short-steps) checks, whose highlights show the key light's colour directly.

Related: [materials and shaders](../../knowledge/materials-and-shaders.md) · [head CC rendering](../../knowledge/head-cc-rendering.md) · [shader-system evidence](shader-system/README.md) · [annotation results](shader-system/annotation-results.md#basematerialsskinmt) · [hair reference](shader-hair.md) · [fact index](shader-fact-index.md).
