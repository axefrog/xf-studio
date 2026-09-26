# Hair shader reference: `base\materials\hair.mt` and `.hp` profiles (game 2.31)

Second per-family reference of the [materials and shader study](../backlog/materials-shader-re.md). It covers the hair template (strands and the lashes that use it), its three-pass transparency, the `.hp` profile ramps and the CPU bake that turns them into shader rows, strand direction and flow, the hair light (sun, local lights and environment), the option values that drive it, the scalp cap, and what still blocks correct hair and lash colour. The arithmetic of the colour and light is consolidated in [hair shading](../../knowledge/hair-shading.md); this page is the evidence-level reference around it. Which Studio code relies on which fact is in the [shader fact index](shader-fact-index.md).

**Labels** as in the [skin reference](shader-skin.md): **[observed]** (compiled 2.31 program, the 2.31 executable, or an installed resource), **[source-supported]** (tool/engine source, wiki, community tool, or a close match to a published model), **[hypothesis]**, **[runtime]** (seen in game).

## 1. Pinned inputs

| Input | Identity |
|---|---|
| Game, caches, tools | As in the [skin reference §1](shader-skin.md#1-pinned-inputs) |
| `base\materials\hair.mt` | SHA-256 `d64761b6364373d5c84c903c5193738295afc2aa2812f215bf605016835482d5` (9,377 bytes, from `memoryresident_1_general.archive`) |
| `bin\x64\Cyberpunk2077.exe` (2.31) | SHA-256 `a7de82945c03e041fc7339fcf9066224d98db2f5d80fea50f7947bb350a60991` (59,945,608 bytes); read with Capstone 5.0.9 through [`exe_hair.py`](shader-system/exe_hair.py) |

| Program (MeshSkinned) | GUID | DXBC SHA-256 |
|---|---|---|
| `hair` `hair_alpha_accum` pixel | `2782105832921211528` | `2b0f3597…4267a` |
| `hair` `hair_basecolor_blend` pixel | `7571795766366002052` | `7647ccdc…bbf23` |
| `hair` `hair_gbuffer_solid` pixel | `2903833597335136032` | `ade6c2a6…808cc` |
| `hair` vertex (all three passes) | `7115927943278841644` | `65b1b1b9…d07ae` |
| static `m_shaderLightsComputeGlobalOnly_Clustered_00010001` (sun; Standard + Hair) | `7525818560587663624` | `07ebbaf9…c8e3` |
| static `m_shaderLightsComputeGlobalLocalShadows_Clustered_11111111` (sun + local lights; all classes) | `6606735909222169407` | `c0ce7b53…dac86` |
| static, unnamed by the cache index: the ambient and reflection composite (§6.5) | `16447472454040542875` | `02b8959f…0488cb` |

The shader cache has 234 `hair` compilations [observed]; only the MeshSkinned, non-dismembered set above was read. The composite has seven siblings with the same hair arithmetic (`10393055107398307099`, `12830050800311994302`, `16956390879026470170`, `2291179555597019501`, `6108480345024026524`, `7431907285997982269`, `9669053744828965634`); which one a frame uses depends on features not traced [hypothesis].

## 2. The template

**Class** `RMT_Hair` (lighting class 4), priority `EMP_Normal`, `canBeMasked` 1. **Vertex factories:** MeshStatic, MeshSkinned, MeshExtSkinned, GarmentMeshSkinned, GarmentMeshExtSkinned [observed].

| Stage | Reg | Parameter | Default | Role |
|---|---:|---|---|---|
| vertex | 0 | `Strand_Gradient` | `base\materials\placeholder\grey.xbm` | Sway amplitude grows toward the tip (§4) |
| vertex | 1, 2 | `Animation_AmplitudeScale`, `Animation_PeriodScale` | 0, 0 | Strand sway; off by default (§4) |
| pixel | 0 | `Strand_ID` | grey placeholder | **R**: per-strand identity, indexes the profile's ID ramp; also hashed for the per-strand highlight shift |
| pixel | 1 | `Strand_Gradient` | grey placeholder | **R**: root (0) to tip (1), indexes the root-to-tip ramp |
| pixel | 2 | `Strand_Alpha` | grey placeholder | **R**: coverage |
| pixel | 3, 4 | `RoughnessScale`, `RoughnessBias` | 1, 0 | `roughness = saturate(scale · Strand_ID.R + bias)` |
| pixel | 5 | `AlphaCutoff` | 0.33 | Coverage remap floor |
| pixel | 6, 7 | `Flow`, `FlowStrength` | `engine\textures\editor\hairdefault_f.xbm`, 1 | Strand direction in the card's tangent plane (§5) |
| pixel | 8 | `VertexColorStrength` | 0 | **Read by none** of the three pixel programs |
| pixel | 9 | `Scattering` | 0.16 | Divides a thickness term into GBuffer2.z, which **no light reads for Hair** (§6.3) |
| pixel | 10–13 | `ShadowStrength`, `ShadowMin`, `ShadowMax`, `ShadowRoughness` | 0, −0.5, 1, 1 | Vertex-red self-shadow on colour and roughness |
| pixel | 14 | `DebugHairColor` | 0 | ≥ 0.5 forces white |
| pixel | 15 | `HairProfile` | `engine\materials\defaults\default.hp` | Row index into a runtime gradient texture |

All roles [observed] in the programs of §1.

**Siblings** [observed, parameter lists; not decompiled]: `hair_blendable.mt` adds the blendable Fresnel/fade set; `hair_hideable.mt` adds `Morph`, `MorphAlpha`, `SourceOrTarget`; `hair_cyberspace.mt` adds vector-field, Fresnel and Bayer-dither controls; `hair_proxy.mt` is an opaque stand-in (albedo, roughness, metalness, normal, `Scattering`) with no strand passes. `blackwall_blendable_hair.mt` is the Blackwall effect variant.

### 2.1 Texture packing and colour spaces

| Texture | Channel read | Colour space | Evidence |
|---|---|---|---|
| `Strand_ID`, `Strand_Gradient` | R | linear (`isGamma` 0 on the inspected textures and placeholders) | [observed] |
| `Strand_Alpha` | R | linear (the Soft Natural lash alpha is `TCM_QualityR`, `isGamma` 0) | [observed] |
| `Flow` | R, G | **sRGB** (`isGamma` 1), so flow values are decoded before `2x − 1` | [observed]; the Blender add-on notes the same [source-supported] |
| Vertex colour | R | — | Self-shadow (§3.3) |

The placeholders store no `isGamma` property, so they take the class default, false (WolvenKit's `STextureGroupSetup` constructor sets no gamma) [observed]. `grey.xbm` is (107, 105, 107), so a mesh that keeps it as `Strand_ID` reads the constant 107/255 ≈ 0.42 and every strand gets the **same** ID-ramp entry.

## 3. Passes: order-independent transparency in three steps

From the serialized template [observed]:

| Stage | Depth | Blend | Pixel program |
|---|---|---|---|
| `hair_alpha_accum` | test `GreaterEqual`, **no write** | colour `Zero/One`; alpha `Zero/InvSrcAlpha`; mask **A** | yes |
| `hair_basecolor_blend` | test `GreaterEqual`, no write | `One/One` additive, mask RGBA | yes |
| `hair_gbuffer_solid` (and `…_velbuff_solid`) | test `GreaterEqual`, **write** | off | yes |
| `cascade_regular` | `LessEqual` | — | **yes** (alpha-tested shadow casting; skin's cascade pass has none) |
| `depth`, `gbuffer_regular` (flag variants), `highlights`, wireframe | | | |

### 3.1 `hair_alpha_accum` (`2782105832921211528`)

[observed; decompiled listing]:

1. `a = saturate(max(Strand_Alpha.R − AlphaCutoff, 0) / (1 − AlphaCutoff))`, × 1.33 when a camera-constant flag is set.
2. Keep the fragment if `a` exceeds the per-pixel **dither threshold** `t(x, y, frame)` of [hair shading §2](../../knowledge/hair-shading.md#2-passes); this pass's offset is 2/255.
3. Drop it if it lies behind the depth stored in slice 3 of a per-pixel `uint` array (the opaque scene, most plausibly [hypothesis]).
4. Insert the key `depth bits (asuint(z) << 2, low 6 bits cleared) | round(saturate(Strand_Alpha.R)·63)` into a **3-deep k-buffer** with `InterlockedMax` in slices 0–2: a sorting network that keeps the three nearest fragments (reversed Z: larger is nearer). A fragment with `Strand_Alpha.R > 0.98` writes its key into all three slots, so a near-opaque strand evicts everything behind it.
5. The colour target keeps transmittance `Π(1 − Strand_Alpha.R)` through the alpha blend.

### 3.2 `hair_basecolor_blend` and `hair_gbuffer_solid`

- **Blend** (`7571795766366002052`): a fragment present in the k-buffer adds `(|colour| · w, w)` with `w` its stored alpha/63.
- **Solid** (`2903833597335136032`): writes the G-buffer for the most opaque of the two front k-buffer layers, behind the same dither (offset 0.0088431). GBuffer0 = `sqrt(Σ w·c / Σ w)`, GBuffer1 = the packed strand tangent frame, GBuffer2 = `(0, roughness, 1/3 + 2/3 · transmittance · thickness / Scattering, Strand_ID)`.

**Sorting.** There is no mesh or card sorting: order independence comes from the per-pixel k-buffer, and the lit result is **opaque** in the G-buffer with dithered coverage that temporal anti-aliasing (or DLSS/FSR/XeSS) averages. Every layer in a pixel meets the same threshold, so coverage nests (the pixel is covered as often as its most opaque layer survives) [observed arithmetic; consequences in [hair shading §2](../../knowledge/hair-shading.md#2-passes)].

### 3.3 Colour

Consolidated in [hair shading §3](../../knowledge/hair-shading.md#3-base-colour) [observed]:

```
N  = row[0]                                   // sample count, 127 in all but three vanilla profiles
id = row[1 + uint((N−1)·Strand_ID.R)]         // truncated, unfiltered
rt = row[1 + N + uint((N−1)·Strand_Gradient.R)]
c  = luma601(rt) < 0.5 ? 2·id·rt : 1 − 2(1−id)(1−rt)    // overlay, root-to-tip is the base
s  = smoothstep(ShadowMin, ShadowMax, 1 − vertexColour.R);  c += (saturate(c·s) − c)·ShadowStrength
```

A mid-grey ID leaves the root-to-tip colour unchanged; the result can exceed 1 or go negative, and the resolve stores `|c|`. How `row` is built is §7.

## 4. Vertex program (`7115927943278841644`)

[observed]:

- **Sway.** With `g = saturate(Strand_Gradient.R)` sampled at the vertex and `T` = animation time: `phase = T · g · Animation_PeriodScale`, `amp = g · 10⁻⁴ · Animation_AmplitudeScale`; the vertex moves by `amp · tri(phase)` along the vertex normal and by `amp · tri(phase/2 + 2.07)` along the tangent, where `tri` is a smoothed triangle wave in [−1, 1]. Roots do not move; tips move most. Both scales default to 0 (static).
- Passes `COLOR.R` (shadow), the world tangent frame and UV0 to the pixel programs.

## 5. Strand direction, flow and roughness

[observed; [hair shading §4](../../knowledge/hair-shading.md#4-roughness-tangent-and-scattering)]:

- **Direction** `= max(FlowStrength·(2·flow.g − 2) + 1, 0.01) · bitangent + max(FlowStrength·(2·flow.r − 1), 0.01) · tangent`, with `bitangent = cross(N, T) · w` from the mesh. The default `hairdefault_f.xbm` and typical flows put the strand along the card's bitangent (UV V).
- **GBuffer1** stores the strand tangent frame: RGB a normal-like vector and **A × 3** the index of the dropped axis, which the light uses to rebuild the frame [observed in the light's Hair branch].
- **Roughness** `= saturate(RoughnessScale · Strand_ID.R + RoughnessBias)`, pulled toward `ShadowRoughness` in shadowed parts: each strand gets its own roughness.
- **GBuffer2.w** stores `Strand_ID.R`, which the light hashes for the per-strand highlight shift.

## 6. The hair light

### 6.1 Sun (global) path

Decoded from `7525818560587663624` and present unchanged in `6606735909222169407` ([hair shading §5](../../knowledge/hair-shading.md#5-deferred-hair-light)): Karis's 2016 model [source-supported] with R (white), TRT (tinted `C^(0.8/cosθD)`), no TT, and a wrapped "multiple-scatter" diffuse; per-strand shift `ρ = lerp(cb0[17].z, cb0[17].w, frac(frac(ID·0.0729477)·52.98292))`. Intensities are **`cb0[12].x` (R), `.z` (TRT), `.w` (diffuse)** [observed], fed by `GlobalLight/R`, `/TRT`, `/MultiScatter` (§6.4) [observed].

### 6.2 Local lights

In `6606735909222169407` the tiled local-light loop has its own Hair branch (class 4 of its second switch, walking the per-tile light list) [observed; decompiled listing, identified by the per-strand hash constants `0.0671106`/`0.00583715` and `52.98292`, which occur exactly twice in the program, once per path]:

| Term | Local-light arithmetic | Compared with the sun path |
|---|---|---|
| Frame, angles | `sinθL = T·L`, `sinθV = T·V`, `cosθD`, `cos(φ/2)` from L and V projected normal to T | Same |
| Per-strand shift | Same hash of the stored `Strand_ID`, same `cb0[16..17]` registers | Same |
| R lobe | Same Gaussian, shift, `N = cos(φ/2)/4`, Schlick F0 0.0466 at `√(½ + ½ L·V)`, gated by `clamp(wrap(N·L, cb0[19].y) + 1 − cb0[19].z)`; scaled by **`cb0[13].x`** | Same shape; **intensity register differs** |
| TRT lobe | Same, scaled by **`cb0[13].z`** | Same shape |
| Diffuse | Same wrapped term with `cb0[18]`, × shadow × **`cb0[13].w`** × `saturate(pow(C / luma601(C), 1 − shadow))` | Same shape |
| Roughness | The G-buffer roughness, **without** the per-light roughness shift that Standard and Subsurface local lights apply | — |
| Light colour | × attenuation; × a half-float from bits 8–23 of the light record's dword 15 **only when `cb0[15].w ≠ 0`** | `cb0[15].w` is `Hair/Debug/DebugSwitch1`, false by default (§6.4), so vanilla never applies it |

So the local-light hair model **is the sun model evaluated per light**, with its own intensity triple `cb0[13]` = `LocalLight/R`, `/TRT`, `/MultiScatter`, whose defaults are **0.35, 0.8, 0.47** [observed, §6.4]. Every light of the character creator and mirror screen is local ([creator lighting](../../knowledge/creator-lighting.md)), so this is the path that shades hair and lashes there.

**The per-light factor.** On the CPU, a light's record gets a half-float factor from `f(x)` at RVA `0x23a220` (called from the light setup at `0x23b9ae` with `x` = the light's float at `+0xc4`, most plausibly its intensity [hypothesis]): `f = 1` unless `AAAA_HACK_hairModifiedLocalLightIntensity` (default **true**) and `x > 10`, in which case `f = (10 + Σᵢ HACK_Factorᵢ · (ln x / ln Tᵢ − 1)) / x` over the thresholds `Tᵢ = 10, 30, 50, 5000` that `x` reaches, with `HACK_Factor0..3` = 66, 95, 213, 450 [observed]. It is a curve that brightens mid-strength lights for hair (×1.47 at 100) and dims strong ones (×0.40 at 1000). Its result is packed into the light record; the shader reads a half from that record only under `DebugSwitch1`, so **in vanilla the rasterised hair light ignores it** [observed]. That the shader's half is this factor is [hypothesis]; the ray-traced paths are not parsed.

### 6.3 What the light does not read

- **GBuffer2.z (thickness / `Scattering`)**: the all-class light computes `saturate((z − 1/3)·1.5)` once and uses it only in the Foliage branch; the local-light loop never reads it; the SSS passes run only on Subsurface pixels [observed]. `Scattering` therefore has **no effect on direct lighting** in the rasterised path. Ray-traced paths are not parsed.
- **`VertexColorStrength`** is read by no hair pixel program [observed].
- **The TT intensities** (`cb0[12..14].y`), **`AlphaShifts/TT`** (`cb0[16].y`), the three **`ScatterDepth`** options (`cb0[15].xyz`), **`MultiScatter/ShadowFactorExp`** (`cb0[18].z`) and **`UseReferenceImplementation`** (`cb0[20].z`) are uploaded but read by neither light program nor the composite of §6.5 [observed].

### 6.4 Option values and registers (executable)

The hair options are float GameOptions registered by static initialisers in the executable (RVAs `0x1c300`–`0x1d4d0`), each with a default, a minimum and a maximum; a function at `0x2df4e0` copies their current values into `cb0` [observed; reproduce with `exe_hair.py options` and `exe_hair.py fill`]. The register of each option follows from where the copy stores it, anchored by `GlobalLight/R` at `cb0[12].x`; nine registers agree with their roles in the programs, so the whole table is [observed]:

| Register | x | y | z | w |
|---|---|---|---|---|
| `cb0[12]` | `GlobalLight/R` 0.3 | `GlobalLight/TT` 0.005 | `GlobalLight/TRT` 0.8 | `GlobalLight/MultiScatter` 0.47 |
| `cb0[13]` | `LocalLight/R` 0.35 | `LocalLight/TT` 0.005 | `LocalLight/TRT` 0.8 | `LocalLight/MultiScatter` 0.47 |
| `cb0[14]` | `EnvProbe/R` 0.3 | `EnvProbe/TT` 0.005 | `EnvProbe/TRT` 0.8 | `EnvProbe/MultiScatter` 0.47 |
| `cb0[15]` | `GlobalLight/ScatterDepth` 1.25 | `LocalLight/ScatterDepth` 0.8 | `EnvProbe/ScatterDepth` 1.3 | `Debug/DebugSwitch1` (false → 0) |
| `cb0[16]` | `AlphaShifts/R` −0.083 | `AlphaShifts/TT` 1 | `AlphaShifts/TRT` −0.5 | `Debug/DebugSwitch2` (false) |
| `cb0[17]` | `RoughnessFactor` 1 | `AlbedoMultiplier` 1 | `min(SpecularRandom_Min, _Max)` −0.2 | `max(…)` 0.2 |
| `cb0[18]` | `MultiScatter/Wrap` 0.35 | `/DiffuseScatterFactor` 0 | `/ShadowFactorExp` 0.37 | `/Mask_Intensity` 1 |
| `cb0[19]` | `AdditionalAreaRoughness` 0.1 | `Specular/Wrap` 0.3 | `Specular/Mask_Intensity` 1 | 0 |
| `cb0[20]` | `TRT_Params/EXP_SCALE` 1 | `/EXP_BIAS` 1.5 | `UseReferenceImplementation` (false) | 0 |

Group names are `Editor/Characters/Hair/…`. Other hair options: `ContactShadowClamp` 0.35, `UseGlobalContactShadowsOnHair` and `UseLocalContactShadowsOnHair` true, `Developer/FeatureToggles/Hair` true, and the `HACKS` set of §6.2 [observed].

**No shipped override.** At start-up the game reads `[Hair]` keys `cvHair…` (for example `cvHairR_Local`) from the depot file `base\materials\config\config_override.ini` and, if present, writes them into these options (loader at `0x28dbb04`) [observed]. No archive contains that path: a hash scan of the indices of the 57 base-game and EP1 archives and the 1,101 mod archives of the reference install (MO2 mods, overwrite and the game's own mod folders) found none [observed], so the executable defaults above are the vanilla values. They equal the "Vanilla" preset of Arkhe's Character Rendering Editor for every option it lists [community, now confirmed]; that tool does not list the `ScatterDepth`, `TT` and `ShadowFactorExp` options or the debug and hack switches. CET mods can still change any of them at runtime, as the reference install's "Arkhe Balanced" preset does.

### 6.5 Environment path

The ambient and reflection composite (§1; a full-screen pixel program that reads the G-buffer, the light accumulation, a diffuse-irradiance target, a reflection target and a split-sum lookup, and writes two HDR targets) has its own Hair branch [observed; decompiled with Vulkan-semantics GLSL output, as SPIRV-Cross cannot emit its wave operations as HLSL]:

- **A virtual light along the view.** For a hair pixel it evaluates the hair model once with `L_e = normalize(V − (V·T)T)`, the view direction with its along-strand part removed. So `sinθL = 0`, `cosφ = 1` and `cos(φ/2) = 1`, and `sinθV` and `cosθD` come from V as usual.
- **Radiance.** The model is scaled by `2π × E`, where `E` is the pixel's diffuse irradiance, the same value that lights Standard pixels as `albedo × E`. In the program read, `E` is the global six-colour ambient cube in `GlobalShaderConsts` registers 21–26, taken along `L_e`. That program is the `m_shaderLightIntegrate_NoEnvProbes` technique; the probe variant blends per-probe cubes instead ([creator lighting §10.3](../../knowledge/creator-lighting.md#103-how-the-lighting-integrate-pass-adds-indirect-light)). Hair does **not** read the reflection target or the split-sum lookup.
- **R and TRT** use `cb0[14].x` and `.z` (`EnvProbe/R` 0.3, `/TRT` 0.8). Both lobes are widened by `AdditionalAreaRoughness` (`cb0[19].x`, 0.1): R width `√2 · ((r/RoughnessFactor)² + ARR)`, TRT width `2r² + ARR`, each normalised as a Gaussian of that width. R keeps the specular gate on `N·L_e` and the Fresnel at `√(½ + ½ L_e·V)`, times `1 − saturate(−N'·V)`, which is 1 here.
- **Diffuse** is `EnvProbe/MultiScatter` (`cb0[14].w`, 0.47) × C × the wrapped term and its gate on `N·L_e`, where C is the clamped albedo × `AlbedoMultiplier`. The composite then multiplies it by the pixel's albedo like every other ambient diffuse. So hair ambient diffuse carries **albedo twice**: `2 · E · EnvMS · C · w² · albedo`, with `w = wrap(N·L_e, 0.35)` and at most 0.74 [observed arithmetic]. Direct light carries it once. Whether this is intended is not known; the effect is that dark hair falls far darker in ambient light than in direct light.
- **Occlusion.** Specular occlusion is `saturate(3 · GBuffer2.z)`, which is 1 for hair, since its z is at least 1/3. The extra ambient term the composite adds for other classes is zero for hair.

So a front-facing dark strand (linear albedo 0.1) receives about `0.52 × 0.1 = 0.05` of the ambient diffuse a Standard surface of the same albedo would, and a blonde one (0.5) about 0.26. The white R sheen takes the colour of the irradiance, so an overcast sky gives a cool sheen [observed arithmetic; magnitudes for `N·L_e = 1`].

## 7. `.hp` profiles and their resolution

- **Structure** [source-supported: RED4ext SDK `CHairProfile.hpp`; observed in 72 vanilla profiles]: `sampleCount` (`uint16` at `+0x40`), `gradientEntriesID` and `gradientEntriesRootToTip` (arrays at `+0x48`, `+0x58` of `rendGradientEntry`, 0x38 bytes: `value` float at `+0x30`, `color` RGBA bytes at `+0x34`). The stops are an unsorted list.
- **The bake** [observed in the executable]. On load (`0x20fd8d8`, `0xaebf10`) the resource copies each array, sorts it by `value` (introsort, not stable) and **rescales the positions to span 0 to 1** (`0xaec0b4`): `v' = (v − v_first) / (v_last − v_first)`, or `v' = i/(n−1)` when the range is under 0.001. The renderer (vtable slots `+0x1b8`/`+0x1c0` → `0x29276a0`) then bakes one row per profile (`0xaeb374`):

  ```
  for k in 0 … N−1:  t = k / N                       // not k/(N−1): the last sample is at (N−1)/N
      i: v'_i ≤ t < v'_{i+1}
      byte = trunc(clamp(c_i·(1−f) + c_{i+1}·f, 0, 255)),  f = (t − v'_i) / (v'_{i+1} − v'_i)
      texel = (EOTF(R), EOTF(G), EOTF(B), A/255)      // EOTF: IEC 61966-2-1, 12.92 below 0.04045, else ((x+0.055)/1.055)^2.4
  row = [(N, N, N, N)] + N ID texels + N root-to-tip texels   // RGBA float32; at most 64 profile rows (slot < 0x40)
  ```

  The EOTF is a 256-entry float table built at start-up (`0xf55d0`) [observed]. Interpolation is on the stored 8-bit values with truncation, then the decode, which is the order the Studio already assumed.
- **What this changes against the earlier model** (sample `k` at `t = k/(N−1)`, raw positions clamped outside the first and last stop, float interpolation). The rescaling matters most. Redacted-c01's `ash_brown` has root-to-tip stops from 0.146 to 1.0, so its near-black first stop moves to the very root: the root band is no longer flat black over the first 15 % but ramps up at once. The mean colour at 10 % of the length goes from sRGB (9, 5, 4) to (49, 40, 34); at 30 %, from (83, 69, 59) to (134, 115, 101). Vanilla `brown_liquorice` has ID stops from 0.080 to 0.879, which are likewise stretched. The shift to `k/N` and the truncation are small, at most about one sample and one 8-bit level.
- **Fit.** Against the 23 vanilla creator swatches, the decoded bake fits at a median 4.2° hue error (mean 8.9°, log-exposure spread 0.60, median exposure 1.04), against 4.7° (9.1°, 0.63, 0.95) for the earlier model [observed code; the fit is supporting evidence only].
- **Authoring rule for our own profiles.** Write stops at exactly 0 and 1, so the rescaling is the identity and the ramp means what it says. A profile with a single stop has a zero range and rescales to 0/0, which is undefined.
- **Which profile wins.** Vanilla hair and NPC hair bind a colour appearance to a shared `…\hair_profiles\{colour}__{style}.mi` whose only override is `HairProfile`, so a same-path `.hp` replacer recolours V and every NPC with that colour. Archive precedence (mods before base) decides between providers [source-supported, not runtime-proven]; see [hair shading §7](../../knowledge/hair-shading.md#7-resolving-which-hp-a-material-uses).

## 8. The scalp cap

Hairstyles draw a cap under the cards with **`mesh_decal_gradientmap_recolor.mt`**, a `post_gbuffer` decal [observed]:

- `DiffuseTexture` is an **ID map**: its R addresses a `GradientMap` texture, the per-colour `hh_cap_grad__<colour>.xbm` (sRGB, `isGamma` 1) [observed].
- `MaskTexture` gives the coverage; colour blends in **square-root space** like every decal ([materials §2.4](../../knowledge/materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it)).
- The cap therefore does not use the `.hp` at all: a hair-colour mod must ship matching cap gradients, or the scalp and strands disagree. The plain template's own program (`5232451138945967528`) has since been read: colour `DiffuseColor × GradientMap(saturate(DiffuseTexture.R), 0.5)` in square-root space, linear and unsaturated coverage from `DiffuseAlpha × gradient alpha × MaskTexture.R`, no UV transform [observed] ([decal reference §5.3](shader-decal.md#53-the-gradient-recolour-trio)).

## 9. Lashes

The eyelash chunk of the eye mesh uses `hair.mt` [observed]:

- **One colour per profile.** The vanilla eyelash `.mi` chain leaves the placeholders in place: `Strand_ID` the constant `grey.xbm` (R 107/255, linear) and `Strand_Gradient` the constant `white.xbm` (tip). So a lash's albedo is the overlay of ID sample `uint(126 · 0.4196) = 52` with root-to-tip sample 126, the last one, which the bake places at `t = 126/127` [observed inputs and bake]. Profile edits near the root never show on lashes; the last root-to-tip stop dominates (98 % of it for `brown_liquorice`).
- **The two candidate `brown_liquorice.hp` profiles** give, under the decoded bake, sRGB **(172, 130, 15)** for the base game (golden tan) and **(59, 28, 0)** for Alliekat's replacer (dark red-brown). The earlier model gave (177, 136, 44) and (62, 30, 0) [observed arithmetic].
- The lash `.mi` sets `RoughnessScale` 0 and `RoughnessBias` 1 (roughness 1), `AlphaCutoff` 0, and `ShadowMin = ShadowMax = 0`, which saturates the shadow term to 1 for unpainted vertices. `ShadowStrength` stays at its default of 0, so the term is inert anyway [observed arithmetic].
- The colour option `eyelash_color` selects the `.hp`; the reference save's lash requests `…\hair_profiles\{material}.hp`, which both the base game and an installed mod provide ([overlap audit](../eye-artistry/brown-liquorice-profile-overlap.md)).
- Lashes are lit by the hair light: on the creator screen by the local-light path of §6.2, and in the world also by the environment path of §6.5.
- **What the Studio should show.** The Studio needs no lash-specific model. The generic strand adapter reads the resolved chunk's own placeholders and the winning `.hp`, so the lash colour follows from the bake. A lash colour chip in a chooser should show that computed albedo, not the creator's selector swatch, and it should say when two providers of the profile disagree.

## 10. What blocks correct hair and lash colour

Ranked by how much each can move the colour a player sees:

1. **The winning `.hp`** (resolution, not shading). Two providers of one path give a golden tan or a near-black lash from the same shader ([hair shading §7](../../knowledge/hair-shading.md#7-resolving-which-hp-a-material-uses)). The Studio applies archive precedence and records the losers; the precedence itself needs one controlled in-game comparison [source-supported].
2. **The environment path in the preview** (§6.5, now decoded). Ambient light on hair is `≈ 0.52 × C` of what the preview gives it today (`0.47`), so ambient-lit dark hair in the Studio stage is several times too bright. It does not affect the creator preset, whose box has no ambient.
3. **The profile bake in the preview** (§7, now decoded). The preview still samples raw positions at `k/(N−1)`; any profile whose stops do not span 0 to 1 is shifted, which moves `ash_brown`'s root band most.
4. **Runtime option overrides.** The defaults are now read from the executable (§6.4); what remains is whether a CET preset changes them in a given session (the reference install's does). A capture must record them.
5. **Tone mapping and grading** ([creator lighting §5](../../knowledge/creator-lighting.md#5-tone-mapping-and-grading)), decoded for the creator screen.

**No longer blockers:** the local-light model (§6.2) and its intensities and register pairing (§6.4), the per-light factor (off in vanilla), and the bake's sample positions, interpolation and colour space (§7).

## 11. What the browser adapter reproduces

`hair-colour-model.ts` (pure) and `hair-shading.ts` (Three adapter), selected by template name in `character-material-adapters.ts` [observed by comparing the code with the programs]:

| Game step | Preview | Status |
|---|---|---|
| Profile bake | `bakeHairProfile`: raw positions, `t = k/(N−1)`, float interpolation, then the sRGB decode | **Differs from §7**: no rescaling to 0–1, different sample positions, no truncation |
| Truncated lookup, overlay, shadow term, `\|c\|` | Float profile texture, `texelFetch` | Faithful |
| Coverage: remap, dither range, nesting | Alpha-to-coverage with `hairResolvedCoverage` | Coverage faithful; colour within a pixel approximate (no k-buffer, no 0.98 eviction) |
| Sun hair light | `xfsHairDirect` with `GlobalLight` intensities | Faithful; constants now [observed] defaults |
| Local hair light | The same function per spot light with `HAIR_LOCAL_LIGHT` (0.35, 0.8, 0.47) | Faithful; values and pairing [observed]. The adapter's comment that the path is not decoded and that TRT and MultiScatter are hypotheses is stale |
| Per-light factor (`cb0[15].w`) | Not modelled | Correct for vanilla (`DebugSwitch1` off) |
| Environment | Three's ambient diffuse × `EnvProbe/MultiScatter`; no environment R/TRT | **Differs from §6.5**: missing the `2·C·w²` factor and the irradiance-lit R and TRT lobes |
| Sway animation | Not drawn | Static by default in the game too |
| Cap | Mask-blended gradient decal, linear "over" | Lighter at partial coverage than the game's square-root blend |

### 11.1 Recommended preview changes (for a code track)

1. **Bake** (`src/hair-colour-model.ts`, `bakeHairProfile` and `sampleStopsEncoded`): sort the stops, rescale positions to `(v − v_first)/(v_last − v_first)` (even spacing below a 0.001 range), sample `t = k/N`, interpolate the 8-bit values and truncate each channel, then decode with `srgbToLinear`. `profileIndex` stays `floor((N−1)·s)`. The `"stored-linear"` `ProfileEncoding` is no longer a live hypothesis. `sampleHairGradient` in `src/hair-shading.ts` (raw colours for display) should use the same rescaled positions. Add the bake as a hypothesis in `tools/hair-profile-swatch-fit.py`, and update the model's tests.
2. **Option values** (`src/hair-colour-model.ts`, `HAIR_LIGHTING_VANILLA`): the values are unchanged, but their grade becomes the executable defaults [observed]. Add `envR` 0.3, `envTRT` 0.8 and `additionalAreaRoughness` 0.1 for item 4.
3. **Local light** (`src/hair-shading.ts`, `HAIR_LOCAL_LIGHT`): keep `{ intensityR: 0.35, intensityTRT: 0.8, scatter: 0.47 }` and replace its comment: the executable defaults of `LocalLight/*`, fed to `cb0[13]` [observed]. Optionally move the triple into `HairLighting`, so a runtime preset such as Arkhe Balanced can carry it.
4. **Environment** (`src/hair-shading.ts`, `HAIR_LIGHT_GLSL`): replace `reflectedLight.indirectDiffuse *= xfsHairRandom.z` with the §6.5 model.
   - With `L_e = normalize(V − dot(V, T)·T)` and `w = xfsWrapped(dot(N, L_e), wrap)`, scale `reflectedLight.indirectDiffuse` by `2 · EnvMS · clamp(w + 1 − scatterMask) · mix(w, 1, kajiyaMix) · hairC`. Three's indirect diffuse is already `irradiance · albedo/π`, and the game's `E` is Three's `irradiance/π`, so this gives the game's `2·E·EnvMS·C·w²·albedo`.
   - Add `2 · (irradiance + iblIrradiance) · (EnvR · R_e + EnvTRT · TRT_e · C^(0.8/cosθD))` to `reflectedLight.indirectSpecular`. `R_e` and `TRT_e` are the `xfsHairDirect` lobes at `sinθL = 0` and `cosφ = 1`, with `AdditionalAreaRoughness` added to both widths as in §6.5.
5. **Per-light factor**: none (vanilla).

## 12. Open questions

1. Which of the eight composite variants runs in a given frame, and the ray-traced and path-traced hair paths.
2. The CPU meaning of the light's float at `+0xc4` that feeds the per-light factor (irrelevant while `DebugSwitch1` is off).
3. Slice 3 of the k-buffer array: the opaque depth, or something else.
4. The flag behind the ×1.33 coverage boost.
5. Whether the double albedo in the hair ambient diffuse (§6.5) is what players see: see test ask 3.

## 13. In-game test asks (batch into the prepared session)

1. **Record the options, do not rediscover them.** Run the CET dump from the [capture request](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request) with two more groups, `Editor/Characters/Hair/Debug` and `Developer/FeatureToggles`, once with the usual preset and once with the Character Rendering Editor's "Vanilla" preset. Expected for vanilla: every value in §6.4, and `DebugSwitch1` false.
2. **Lash colour with and without the mod `.hp`** (the controlled comparison for §10 item 1; [head CC rendering test asks](../../knowledge/head-cc-rendering.md#in-game-test-asks)). Expected albedo: base (172, 130, 15), a golden tan, against Alliekat (59, 28, 0), a dark red-brown.
3. **Ambient against direct, one ladder.** Take the same colour ladder (`38_ash_brown`, `66_platinum_blonde`) twice: in the mirror, which has local lights only and no ambient, and in photo mode in an interior lit only by ambient and sky, with no photo-mode light and no direct sun on the hair. Measure the luminance ratio of platinum to ash brown on the lengths in both. §6.5 predicts that the ambient-only ratio is roughly the square of the mirror ratio, because albedo enters ambient twice. A ratio that stays the same would mean the composite is not the path that lights hair.
4. **Creator-screen colour ladder** (the existing [capture request](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request)): with the bake decoded, it now validates the whole chain rather than choosing a bake.
5. Record the CET/GameOptions state and weather with every capture.

Related: [hair shading](../../knowledge/hair-shading.md) · [materials and shaders](../../knowledge/materials-and-shaders.md) · [brows](../../knowledge/brows.md) (brows use a decal, not `hair.mt`) · [skin reference](shader-skin.md) · [fact index](shader-fact-index.md).
