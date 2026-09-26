# Metal and glass shader reference: `metal_base.remt` and `glass_onesided.mt` (game 2.31)

Sixth per-family reference of the [materials and shader study](../backlog/materials-shader-re.md), after [skin](shader-skin.md), [hair](shader-hair.md), [eye](shader-eye.md), [decals](shader-decal.md) and [multilayered](shader-multilayered.md). The [render coverage audit](../character-customization/render-coverage.md#6-ranked-gaps) found these two templates on arm cyberware, on the teeth mesh's unused `default` appearance and on many clothing items, and the preview has an adapter for neither. This page gives each template's parameters and defaults, its passes and compiled programs, what reaches the G-buffer or the screen, its lighting, how far the preview is from it, and a ranked adapter plan a code track can implement. The consolidated reading is [materials and shaders §4.7](../../knowledge/materials-and-shaders.md#47-enginematerialsmetal_baseremt-and-glass_onesidedmt); which Studio code relies on which fact is in the [shader fact index](shader-fact-index.md#metal-and-glass).

**Labels.** **[observed]**: read directly in a compiled 2.31 program, the 2.31 TweakDB or scripts, or an installed resource. **[source-supported]**: tool or engine source, the wiki, a community tool, or a close match to a published technique. **[hypothesis]**: not established. Nothing here was observed in a running game.

## 1. Pinned inputs

| Input | Identity |
|---|---|
| Game, caches, tools | As in the [shader-system note](shader-system/README.md#inputs-read-only): 2.31 (`GameVersion 2310`), `shader_final.cache` `339145…3ccfa`, `staticshader_final.cache` `bff160…59ff`, WolvenKit CLI 8.17.4, Windows SDK `dxc` |
| `engine\materials\metal_base.remt` | SHA-256 `4785fa1376ce01f82a89d0636571e7f7ada65cc6273bb4e8cabc3c92aba2a5ba` (9,028 bytes, `memoryresident_1_general.archive`) |
| `base\materials\glass_onesided.mt` | SHA-256 `a34691d1d714160f144d6b9ddb34bb6bd4f119a289faf87824efe11510c93b97` (8,206 bytes) |
| `base\materials\glass.mt` (for comparison) | SHA-256 `86c17b52535765cb4f73c8dec71604bdc493b0778a48a9e05867483a69d98646` |
| Character resources | The Studio's resolver cache (WolvenKit 8.17.4 JSON of the 2.31 archives), read-only |
| Method | [shader-system method](shader-system/README.md#method-repeatable-in-minutes): `shader_cache.py find`, `shader_annotate.py annotate --decompile`; listings stay local and ignored |

| Program (MeshSkinned unless noted) | GUID | DXBC SHA-256 |
|---|---|---|
| `metal_base` `gbuffer_regular` Index 1 (shared by every vertex factory) | `4684655453878116559` | `efc4e75b…7d673275` |
| same, Discarded (alpha test) | `6427363791120029564` | `8c5a09de…ff041e6cb5` |
| same, Index 2 (pass flag `0x80000`, weather) | `1846801220589112223` | `6b59ca6d…2f457caf0be9` |
| `metal_base` `post_gbuffer` | `14174891702035234925` | `73993e24…c5d591517` |
| `glass_onesided` `transparent` (MeshSkinned and MeshExtSkinned) | `4256218839974653439` | `bbb82d43…9daa5564` |
| `glass_onesided` `distortion` | `16640676567101803185` | `7a1ca915…f9067fc8` |
| `glass_onesided` `transparent_mark_rt` | `15548066001076791090` | `425f1b4a…a4e970d` |
| static ambient and emissive composite (pixel) | `10393055107398307099` | `7df07e2d…3649b9` |

SSA numbers below (`%N`) are valid only in the named program.

## 2. The families

| Template | Class | Vertex factories | Where characters meet it [observed, resource] |
|---|---|---|---|
| `engine\materials\metal_base.remt` | Standard, maskable | 14, the broadest list (skinned, garment, vehicle, destructible, light-blocker, window proxy) | Gorilla Arms and Mantis Blades decal and logo chunks, the Gorilla Arms inner shell, Mantis Blade nails, the personal-link cable, the teeth mesh's `default` appearance, the head's seam-fix shadow proxy, many clothing items |
| `base\materials\glass_onesided.mt` | Standard (a forward material: it writes no G-buffer) | 8 (static, skinned, extended-skinned, vehicle, garment, single-bone) | The Gorilla Arms knuckle window, in every Gorilla Arms mesh (holstered, drawn, photo mode) |

Relatives, not read line by line: `metal_base` has 17 siblings (`_det`, `_dithered`, `_parallax`, `_vertexcolored`, `_gradientmap_recolor`, `_garment`, `_packed`, `_blendable`, the fx `_blackbody` used by the Gorilla Arms thermal mod, `_glitter` [glitter investigation](glitter-shader-investigation.md)); `glass.mt` is the two-sided form (§4.6); `glass_deferred.mt` is an opaque G-buffer glass with its own `Reflection` cubemap [observed, template].

In the cached female (`_wa_`) cyberware meshes, `metal_base.remt` appears only on Gorilla Arms and Mantis Blades chunks and `glass_onesided.mt` only on Gorilla Arms; the Monowire and Projectile Launch System meshes use neither (they are `multilayered.mt`, `mesh_decal.mt` and skin) [observed, resource: 41 meshes; 35 `metal_base` and 6 `glass_onesided` material entries that an appearance uses].

## 3. `metal_base.remt`

### 3.1 Parameters and defaults [observed, template]

| Reg | Parameter | Type | Default | Use in the G-buffer program |
|---|---|---|---|---|
| 0 | `BaseColor` | Texture | `engine\textures\editor\grey.xbm` | RGB colour; A only for the alpha test (§3.3) and the `post_gbuffer` coverage (§3.5) |
| 1 | `BaseColorScale` | Vector | (1, 1, 1, 0) | `saturate(BaseColor.rgb × scale.rgb)`; `.w` unused |
| 2–4 | `Metalness`, `MetalnessScale`, `MetalnessBias` | Texture, Scalar, Scalar | `black.xbm`, 1, 0 | `saturate(Metalness.R × scale + bias)` |
| 5–7 | `Roughness`, `RoughnessScale`, `RoughnessBias` | Texture, Scalar, Scalar | `white.xbm`, 1, 0 | `saturate(Roughness.R × scale + bias)` |
| 8–9 | `Normal`, `NormalStrength` | Texture, Scalar | `normal.xbm`, 1 | RG normal, Z reconstructed, XY × strength, renormalised |
| 10–16 | `Emissive`, `EmissiveColor` (0, 0, 0), `EmissiveEV` 0, `EmissiveEVRaytracingBias` 0, `EmissiveLift` 0, `EmissiveDirectionality` 0, `EnableRaytracedEmissive` 1 | | | Emission only when `EmissiveEV > 0` (§3.6); the ray-tracing and directionality inputs are unused by the raster programs |
| 17 | `AlphaThreshold` | Scalar | 0.38 | Alpha test in the Discarded variant |
| 18 | `LayerTile` | Scalar | 1 | Multiplies the UV of every texture except `Emissive` |
| vertex 0 | `VehicleDamageInfluence` | Scalar | 1 | Vertex program only |

With the defaults, an instance that sets nothing (the teeth `default` appearance, the personal-link cable) is a dielectric in the grey editor texture's colour at roughness 1 with the mesh's own normals [observed arithmetic].

### 3.2 Passes [observed, template]

| Stage (flags) | Depth | Blend | Notes |
|---|---|---|---|
| `depth_prepass` (2097152) | test and write | — | No pixel program |
| `gbuffer_regular` (1) and (524289 = `0x80001`) | `GreaterEqual`, write, stencil on, `CULL_Back` | off | Index 1 is the surface program; Index 2 adds weather, as in the multilayered family |
| `gbuffer_velbuff_regular` (33, 524321) | same | off | Motion vectors |
| `post_gbuffer` (256) | test, no write | `SrcAlpha/InvSrcAlpha`, alpha `Zero/One`, mask RGB on three targets | A decal mode (§3.5) |
| `cascade_regular` (2), `highlights` (512) | | | Sun shadows, outline |

### 3.3 The G-buffer program [observed]

Program `4684655453878116559`, lifted and checked against the disassembly:

```
uv  = LayerTile · uv0                                         // %19–%20
c   = saturate(BaseColor(uv).rgb · BaseColorScale.rgb)        // %25–%38
m   = saturate(Metalness(uv).r · MetalnessScale + MetalnessBias)
r   = saturate(Roughness(uv).r · RoughnessScale + RoughnessBias)
t   = 2·Normal(uv).rg − 1;  n_t = normalize(t · NormalStrength, sqrt(max(1 − t·t, 0)))   // %74–%88
n   = TBN · n_t;  back faces reflect it through the vertex normal        // %144–%161
GBuffer0 = (sqrt(c′), MaterialModifiersConsts[0].y / 3)       // c′: c, or the emissive lerp (§3.6)
GBuffer1 = (n / max|n| · 0.5 + 0.5, 0)
GBuffer2 = (m, r, 1/3, emissive byte)
```

- **Channels.** Metalness and roughness are each the **R** channel of their own map, like the decal family and unlike Three's default (roughness G, metalness B) [observed]. Normals are two-channel with Z reconstructed and no Y flip in the program [observed], as in every family read so far.
- **Standard class.** GBuffer1.w = 0 and GBuffer2.z = 1/3, so the deferred light takes its Standard branch and the transmission term is zero (shader-system note) [observed].
- **No per-pixel dielectric specular.** Only metalness and roughness reach the light; F0 is 0.04 for dielectrics [observed, deferred light].
- **The Discarded variant is the alpha test.** `6427363791120029564` adds the per-draw dither dissolve every Discarded variant carries (`t67` noise × `MaterialModifiersConsts[0].z` + `.w` < 0) and, when `MaterialModifiersConsts[0].x ≠ 0`, `discard` where `BaseColor.a < AlphaThreshold` [observed]. The cyberware decal and logo chunks all set the instance's `enableMask` 1 [observed, resource], and the wiki says transparency needs `enableMask` [source-supported: wiki `textured-material-properties.md`]; that `enableMask` is what sets `[0].x` and selects this variant is [hypothesis].
- **Weather.** Index 2 (`1846801220589112223`) samples the same maps and adds rain textures (`t57`–`t60`) and occlusion volumes driven by `MaterialModifiersConsts[2]`, like multilayered Index 2 [observed]; a dry preview uses Index 1.

### 3.4 Lighting [observed, from the Standard path already read]

A `metal_base` pixel is lit like every Standard pixel ([shader-system note](shader-system/README.md#g-buffer-decode-in-the-deferred-light-_00000001-ssa-in-that-program)):

- **Direct:** diffuse `albedo·(1−m)` with renormalised Burley; F0 `lerp(0.04, albedo, m)`; one GGX lobe (α = r², roughness clamped to [0.04, 1]), height-correlated Smith visibility, Schlick Fresnel with F90 = 1; the sun is a disk (representative point).
- **Ambient and reflections:** the full-screen lighting-integrate pass adds `albedo × E` and a reflection through a split-sum lookup texture, with specular occlusion `saturate(3·GBuffer2.z)`, which is 1 for Standard ([hair reference §6.5](shader-hair.md#65-environment-path)) [observed]. Its variants differ in the source of both [observed programs; [creator lighting §10.3](../../knowledge/creator-lighting.md#103-how-the-lighting-integrate-pass-adds-indirect-light)]:
  - the probe variant: per-probe box-projected reflections and six-colour cubes, with global fallbacks;
  - `NoEnvProbes`: one global six-colour cube, taken along the normal and along the bent reflection, blended with a per-pixel reflection buffer;
  - `NoAmbient`: neither.

  What fills the per-pixel buffers (screen-space or ray-traced reflections) is not traced [hypothesis].

So `metal_base` has no lighting of its own: the preview can light it with the same Standard model as the layered parts.

### 3.5 The `post_gbuffer` decal mode [observed]

`14174891702035234925` blends a `metal_base` surface onto the G-buffer under it: the same colour, metalness and roughness; the normal composed onto the stored normal (`t74`) with reoriented normal mapping (`%129`–`%192`); and one coverage `(BaseColor.a − AlphaThreshold) × TEXCOORD3.y` on all three targets (`%211`), a per-vertex factor from the vertex program. With write mask RGB the class and `.w` payloads stay. Which draws take this pass instead of the G-buffer pass is [hypothesis]: no character chunk read here is marked in a way that selects it (their chunk flags are only `MCF_RenderInScene`/`MCF_RenderInShadows`), so the cyberware decals are taken to be alpha-tested G-buffer draws (§3.3).

### 3.6 Emission [observed]

Only when `EmissiveEV > 0` (`%92`–`%131`):

```
e    = lerp(Emissive(uv0).r, 1, EmissiveLift)                 // uv0: LayerTile is not applied
c′   = lerp(c, EmissiveColor.rgb · BaseColor(uv).rgb, saturate(e))   // the unscaled texture colour
EV   = max(log2(e) + EmissiveEV, 0)
GBuffer2.w = EV > 0.001 ? (128 | trunc(sqrt(saturate(EV/10))·127)) / 255 : 0
```

The static composite `10393055107398307099` decodes `x = (bits/127)² = EV/10` (`%95`–`%105`) and adds the pixel's albedo (with a colour tint and saturation from `cb[47]`) times `lerp(k₂·x⁴, exp(k₁·x)·saturate(32x)·k₃, cb[48].z)` (`%1260`–`%1297`), where `k₁` and `k₃` are per-frame buffer values [observed structure]. With `k₁ = 10·ln 2` the main term is `2^EV`, the value the parameter's name suggests [hypothesis]. No cyberware or teeth instance read here sets `EmissiveEV` above 0 [observed, resource]; the Gorilla Arms thermal chunks use `metal_base_blackbody` at `EmissiveEV` 10 instead.

## 4. `glass_onesided.mt`

### 4.1 Parameters and defaults [observed, template]

Vertex parameters (`usedParameters[1]`): `Opacity`, `UvTilingX/Y` (1, 1), `UvOffsetX/Y` (0, 0), `RoughnessTileAndOffset`, `NormalTileAndOffset`, `GlassTintTileAndOffset` (each (1, 1, 0, 0)); they build `TEXCOORD5`/`TEXCOORD6` [observed, pixel inputs]. Pixel parameters:

| Reg | Parameter | Default | Transparent pass | Distortion pass |
|---|---|---|---|---|
| 0 | `Opacity` | 1 | Scales radiance and transmittance | Scales the offset |
| 1–3 | `GlassTint` (`placeholder\white.xbm`), `TintColor` (229, 229, 229), `TintFromVertexPaint` 0 | | Transmittance colour | — |
| 4 | `FrontFacesReflectionPower` | 1 | Reflection multiplier | — |
| 5–6 | `IOR` 1, `RefractionDepth` 2.5 | | **unused** | Screen offset |
| 7 | `FresnelBias` | 1 | Glass F0 and the tint's grazing curve | — |
| 8 | `GlassSpecularColor` | (255, 255, 255) | Reflection colour | — |
| 9–10 | `NormalStrength` 1, `NormalMapAffectsSpecular` 1 | | Normal | `NormalStrength` only |
| 11, 15 | `MaskTexture` (`white.xbm`), `MaskOpacity` 0 | | An opaque "dirt" layer (§4.3) | — |
| 12, 16, 17 | `Roughness` (`white.xbm`), `GlassRoughnessBias` −1, `MaskRoughnessBias` 0 | | `saturate(bias + Roughness.R)` | Blur by roughness |
| 13 | `SurfaceMetalness` | 0 | Mask layer's metalness | — |
| 14 | `Normal` | `normal.xbm` | | |
| 18–19 | `BlurRadius` 0, `BlurByRoughness` 0 | | **unused** | Blur radius |

Defaults give a perfectly smooth (roughness `saturate(−1 + 1) = 0`, clamped to 0.04 in the light) clear pane that transmits about 0.9 and reflects.

### 4.2 Passes [observed, template]

| Stage | Depth | Blend | What it does |
|---|---|---|---|
| `transparent` | test `GreaterEqual`, no write, `CULL_Back` | `One/Src1Color` (dual source), alpha `One/InvSrcAlpha` | The lit glass: `out = radiance + background × T` per channel (§4.3) |
| `distortion` | same | `One/One` on two targets | Adds a screen-space offset and a blur radius to distortion buffers (§4.4) |
| `transparent_mark_rt` | test and **write** | off | Writes the glass normal and roughness (§4.5) |
| `highlights` | | | Outline |

There is no G-buffer pass: glass is drawn after the deferred lighting with its own forward light, like `eye_shadow` and the clear coat.

### 4.3 The transparent program [observed]

Program `4256218839974653439`:

**Surface** (`%101`–`%344`):

```
n_t   = normal map as §3.3 (NormalStrength); n = TBN·n_t
n_s   = normalize(lerp(n_geo, n, NormalMapAffectsSpecular))            // the normal the light uses
tint  = GlassTint.rgb · lerp(1, vertexColour.rgb, TintFromVertexPaint) · TintColor.rgb
f     = saturate((1 − saturate(n·V)) · 1.25) ^ p,  p = 0.5 + b + saturate(fb − 1)·(3.5 − b),  b = saturate(fb)
tint′ = lerp(tint, 0.75 · saturate(tint)^1.5, f)                        // darker, more saturated at grazing angles
F0_g  = 0.25 − 0.17·b + (−0.21 + 0.17·b)·saturate(fb − 1)               // fb = FresnelBias: 0 → 0.25, 1 → 0.08, 2 → 0.04
r_g   = saturate(GlassRoughnessBias + Roughness.R)
// mask layer, only when MaskOpacity > 0:
w     = MaskOpacity · Mask.a;  F0_m = lerp(0.04, Mask.rgb, SurfaceMetalness);  r_m = saturate(MaskRoughnessBias + Roughness.R)
F0    = lerp(F0_g, F0_m, w);  r = lerp(r_g, r_m, w)
diffuse = lerp(1, Mask.rgb, w) · w²·(1 − SurfaceMetalness)             // zero without a mask
T     = lerp(1, tint′·(1 − w), Opacity)                                // per-channel transmittance
```

- **Glass F0 is set by `FresnelBias`, not by `IOR`.** `IOR` is not read by this program. At the default `FresnelBias` 1, F0 = 0.08 (what an index of about 1.8 would give), twice a Standard dielectric's 0.04 [observed arithmetic].
- **Transmission ignores Fresnel.** `T` does not fall as the reflection rises; the only angle term on the transmitted light is the tint's grazing darkening [observed].
- **`Opacity` 0** makes the pane invisible (`T` = 1 and the radiance is scaled by 0) [observed arithmetic].

**Light** (`%1582`–`%2634`):

- **Sun only, specular only.** The sun is a disk (representative point, as in the deferred light); D is GGX with α = r², Fresnel is Schlick with the spherical-Gaussian exponent `exp2((−5.55473·v·h − 6.98316)·v·h)`, and visibility is `0.25 / ((n·V + n·L)(1 − α/2) + α)` with no separate `n·L` factor (`%1622`–`%1718`) [observed]. Shadows come from the sun cascades (Poisson-filtered compares) and a top-down world-space occlusion texture (`t64`) [observed structure; the texture's meaning is hypothesis].
- **No local lights.** The program has no light list: its only loops are the cascade search and the probe loop, and none of the deferred light's clustered-light buffers is bound [observed]. Point and spot lights, including photo-mode lights, do not reflect in this glass [observed for this variant; that no other variant draws it is hypothesis].
- **Environment.** For every probe covering the pixel's 32 × 32 tile (a bitmask from `t45`), the program blends a box-projected reflection sample (`t44`, a 2D array holding a two-hemisphere parameterisation) at mip `5·r·(2 − r)` along the reflection vector bent toward the normal by `0.75·r²`, and a six-direction **ambient cube** (six colours weighted by the squared, clamped normal components) for the diffuse, falling back to a global probe (`ENV_PROBES[0].w`) [observed structure]. The reflection is weighted by Karis's analytic environment BRDF, `F0·A + B` with `a = 1.04·(min((1 − r)², exp2(−9.28·n·V))·(1 − r) + 0.0425 − 0.0275r)`, `A = 1.04 − 0.572r − a` and `B = 0.022r − 0.04 + a` (`%1823`–`%1835`) [observed; recognised from the published approximation, source-supported], not by the lookup texture the deferred composite uses. When a flag in `SharedPixelConsts[97]` is set, a screen-space buffer (`t56`) whose depth matches the pixel supplies the reflection and the sun visibility instead [observed structure; that it holds screen-space or ray-traced results is hypothesis].
- **Output** (`%2666`–`%2790`):

  ```
  L        = sun + ambient·diffuse + saturate(F0·A + B)·reflection
  radiance = lerp(FrontFacesReflectionPower, 1, w) · lerp(GlassSpecularColor, 1, w) · L · exposure
  out0.rgb = lerp(Opacity, 1, w) · (radiance · fogT − fogInscatter · (T − 1))    // fog in front of the pane
  out0.a   = 1 − luminance(T);   out1 = (T, 1)
  ```

  With the blend `One/Src1Color` the frame becomes `out0 + background × T`. Volumetric fog in front of the pane is added in proportion to what the pane blocks [observed].

A depth-compare `discard` against a texture (`t63`) runs when `MaterialModifiersConsts[2].x > 0.5` and a global mode is set; its purpose is [hypothesis] (the same test opens the distortion program).

### 4.4 The distortion program [observed]

`16640676567101803185` writes `(Δx, Δy, weight)` to one target and a blur radius to another, both added (`One/One`), and marks 16 × 16 tiles in two UAVs. The weight is `Opacity` when `IOR > 1` or `BlurRadius > 0`, else 0, so a default pane distorts nothing.

- **Offset.** With `RefractionDepth` 0 it refracts the view ray by 1/`IOR` about the normal-mapped normal and projects a point 50 units along it; otherwise it offsets the exit point sideways by a slab of thickness `RefractionDepth`. If the scene depth at the target is nearer than the glass, the offset is dropped [observed].
- **Blur.** `sqrt(BlurRadius) / max(1, sqrt(depth / 3.5)) × lerp(1, saturate((Roughness.R − 0.05)/0.45), BlurByRoughness)`, using the raw roughness map, not `GlassRoughnessBias` [observed].
- The full-screen pass that applies the buffers was not read; that it offsets and blurs the already-lit frame under the pane is [hypothesis].

### 4.5 `transparent_mark_rt` [observed]

`15548066001076791090` writes the glass's world normal and roughness (mask-blended as above) to one target with depth writes on, and evaluates the probe weights without using them. It marks where reflections on transparent surfaces must be traced [hypothesis, from the name and the outputs].

### 4.6 How `glass.mt` differs [observed, template]

`glass.mt` adds `OpacityBackFace` 0 and `BackFacesReflectionPower` 1 and draws its transparent pass twice, back faces (`CULL_Front`) then front faces; everything else, defaults included, matches `glass_onesided`. Its programs were not read.

## 5. What the character assets set [observed, resource]

| Chunk | Template | Values that differ from the defaults | Result |
|---|---|---|---|
| Gorilla Arms `glass` (all six meshes) | `glass_onesided` | `TintColor` (240, 235, 228), `IOR` 1.32, **`GlassSpecularColor` (0, 0, 0)**, `NormalStrength` 4.45, `Roughness` `grey.xbm`, `GlassRoughnessBias` 0, `BlurRadius` 1 | **No reflection at all**: the pane only tints (about 0.94/0.92/0.89 if colours arrive as byte/255, 0.87/0.83/0.78 if sRGB-decoded) and distorts and blurs what is behind it |
| Gorilla Arms `inside_layer` | `metal_base` | its own normal map only | Grey rough dielectric behind the glass |
| Gorilla Arms `dec_end_1`, `decal_end_01` | `metal_base`, `enableMask` 1 | `garment_decals_d02`, `BaseColorScale` 0.448, metalness `black × 0.955 + 0.425`, roughness `white × 0.733 + 0.439` | Alpha-tested decal, metalness 0.425, roughness 0.87 |
| Gorilla Arms `dec_end_2`, `decal_5`, `decals_dark_spots1`, `decal_interior` | `metal_base`, `enableMask` 1 | decal atlases; `dark_spots` metalness 0.33 and roughness 0 (scale 0) | Alpha-tested decals |
| Mantis Blades `mantis_decals`, `mantis_logos` | `metal_base`, `enableMask` 1 | `mantisblade_holstered_d01`, metalness bias 0.80, roughness `white × 0.067 + 0.189` | Alpha-tested metallic decals, roughness 0.26 |
| Mantis Blades `lambert1` (nails) | `metal_base` | the base arm nail maps, roughness `× 0.559 + 0.223` | Opaque nails |
| Teeth `default` | `metal_base` | none | Grey dielectric, roughness 1 (unreached by the creator) |

## 6. How far the preview is

`render-templates.ts` lists neither template, so every such chunk is recorded and hidden [observed, source]. The nearest existing code:

| Engine behaviour | Nearest preview code | Gap |
|---|---|---|
| `metal_base` G-buffer inputs | `layered-material.ts` lights a baked Standard surface with `MeshStandardMaterial` | Channel mapping (R for metalness and roughness, scale and bias, `BaseColorScale`), `LayerTile`, RG normals with Z reconstructed (helpers exist in `skin-material.ts`, `eye-material.ts`, `face-decal-material.ts`), the alpha test, emission |
| Standard direct light | Three's standard lighting: Lambert diffuse, the same GGX and height-correlated Smith, F0 0.04 | Burley diffuse, shared with every Standard part |
| Standard environment | Studio preset: `RoomEnvironment` through PMREM, Three's DFG lookup with multiple-scattering compensation | Three's rough metals are somewhat brighter (the game's split sum has no multiple scattering) [source-supported: Three.js 0.186 `lights_physical_pars_fragment`] |
| | **Creator preset: no environment** (`lighting-preset-stage.ts` sets `scene.environment = null`) | Every metal (these parts and the layered piercings) shows only the spot lights' highlights and is otherwise near black. This matches the game's data: the creator box has no probe, GI or bounce, and only a world-wide ambient cube remains, bounded to a few per cent of the key light ([creator lighting §10](../../knowledge/creator-lighting.md#10-indirect-light-what-reaches-v)) [resource] [runtime bound] |
| `glass_onesided` | No forward transparent adapter; the eye shell (`eye-material.ts`) is the pattern for a custom-blended forward pass | Everything: per-channel transmittance, the reflection with its own F0 and Karis environment term, sun-only highlights, distortion and blur |

## 7. Recommended preview adapters (ranked)

Effort: **S** under a day, **M** one to three days, each with unit tests of the channel arithmetic against the formulas above.

1. **`metal_base` opaque adapter (S).** A `metal-base` entry in `render-templates.ts` (textures `BaseColor`, `Metalness`, `Roughness`, `Normal`, `Emissive`; none required, since every input has a neutral default) and a `MeshStandardMaterial` adapter:
   - `map` = `BaseColor` (colour, honouring `isGamma`) × `BaseColorScale.rgb`, saturated in the shader;
   - roughness and metalness from their own maps' **R**, `saturate(x·scale + bias)`, by replacing `roughnessmap_fragment` and `metalnessmap_fragment` as the layered adapter does;
   - normal: RG with Z reconstructed, XY × `NormalStrength`, renormalised, orientation as the other adapters;
   - every UV × `LayerTile` except `Emissive`;
   - `enableMask` 1 → `alphaTest = AlphaThreshold` on the colour map's alpha (Three's `alphaTest` compares the same value); `side` front only.
   This draws the cyberware decals and logos, the Gorilla Arms inner shell, the Mantis nails, the cable and the teeth `default`, and most `metal_base` clothing. Emission can wait (no character instance uses it); when added, `emissive = c′ × 2^EV × k` with `k` calibrated [hypothesis].
2. **An environment for the creator preset (S), now specified.** Not a structured environment: the data give the box none. Add a uniform six-colour ambient cube, off by default and fitted only if the piercing check finds a sheen ([creator lighting §11](../../knowledge/creator-lighting.md#11-an-environment-for-the-creator-preset-recommended)). Near-black metals between highlights are the expected look in that preset. This is a lighting-stage change, not an adapter, and affects every Standard part.
3. **`glass_onesided` transmission pass (S).** A forward, depth-test-only, back-culled pass after the opaque parts with custom blending `Zero/SrcColor`, writing `T` per channel (tint × `TintColor` × optional vertex colour, the grazing darkening curve, `Opacity`, the mask's `1 − w`). WebGL has no dual-source blending, so transmittance and reflection become two passes (the second in rank 4). For the Gorilla Arms pane, whose reflection is zero, this pass alone is the whole look apart from the distortion.
4. **`glass_onesided` reflection pass (S–M).** An additive (`One/One`) pass on the same geometry: the environment sample at the game's F0 (`FresnelBias` → 0.25/0.08/0.04), roughness `saturate(GlassRoughnessBias + R)` clamped to 0.04, the reflection vector bent by `0.75·r²`, Karis's analytic environment BRDF, and a sun (directional) GGX lobe with the visibility above; **no spot or point lights**, so under the creator rig only the environment reflects. Multiply by `FrontFacesReflectionPower` and `GlassSpecularColor`; add the mask layer's ambient diffuse when `MaskOpacity > 0`.
5. **Refraction and blur (M, optional).** Three's `MeshPhysicalMaterial` transmission (`ior`, `thickness`, `roughness`, with `specularIntensity` 0 when `GlassSpecularColor` is black) samples a mip-blurred copy of the opaque scene, a structural stand-in for the distortion pass. The mapping is approximate (the game uses a fixed 50-unit or slab offset and its own blur radius); treat it as a look, not a match, and add it only if the Gorilla Arms window reads wrong without it.
6. **Defer:** the `post_gbuffer` decal mode (no known selector), the weather variant, `glass.mt`'s back-face pass, Burley diffuse for Standard parts (a shared change, already listed for the layered adapter).

Ranks 1 and 3 together make the arm cyberware of the [render coverage](../character-customization/render-coverage.md#6-ranked-gaps) rank 5 drawable once the holster state is chosen ([body rendering §1](../../knowledge/body-rendering.md#1-which-parts-make-the-third-person-body) now records the rule).

## 8. Open questions

1. How do `Color` parameters reach the shaders (byte/255 or sRGB-decoded)? It sets the Gorilla Arms tint (§5); the same question is [materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions).
2. Does `enableMask` set `MaterialModifiersConsts[0].x` and select the Discarded variant? Which draws use `metal_base`'s `post_gbuffer` pass?
3. What are the per-frame emissive constants (`k₁`, `k₃`, `cb[47]`, `cb[48]`), and is the main term `2^EV`?
4. What fills the deferred reflection target for Standard pixels, and what does the glass's `t56` buffer hold?
5. How does the full-screen distortion pass apply the offset and blur buffers?
6. Does any other glass variant (ray-traced, path-traced) see local lights?

## 9. In-game test asks (batch into the prepared session)

1. **Gorilla Arms window.** Third person, photo mode, a close frame of the knuckle window under a photo-mode point light moved across it: no highlight from that light on the glass (§4.3), a warm tint and a blurred view of the inner mechanism. One frame each with the light on and off answers the local-light question for the preview.
2. **A `metal_base` decal edge.** The same frame shows whether the Gorilla Arms end decals have hard alpha-tested edges (§3.3) rather than soft blended ones.

Related: [multilayered reference](shader-multilayered.md) · [decal reference](shader-decal.md) · [shader-system evidence](shader-system/README.md) · [materials and shaders](../../knowledge/materials-and-shaders.md) · [fact index](shader-fact-index.md) · [render coverage](../character-customization/render-coverage.md) · [body rendering](../../knowledge/body-rendering.md).
