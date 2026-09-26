# Hair shader reference: `base\materials\hair.mt` and `.hp` profiles (game 2.31)

Second per-family reference of the [materials and shader study](../backlog/materials-shader-re.md). It covers the hair template (strands and the lashes that use it), its three-pass transparency, the `.hp` profile ramps, strand direction and flow, the hair light (sun and, new here, local lights), the scalp cap, and what still blocks correct hair and lash colour. The arithmetic of the colour and light is consolidated in [hair shading](../../knowledge/hair-shading.md); this page is the evidence-level reference around it. Which Studio code relies on which fact is in the [shader fact index](shader-fact-index.md).

**Labels** as in the [skin reference](shader-skin.md): **[observed]** (compiled 2.31 program or installed resource), **[source-supported]** (tool/engine source, wiki, community tool, or a close match to a published model), **[hypothesis]**, **[runtime]** (seen in game).

## 1. Pinned inputs

| Input | Identity |
|---|---|
| Game, caches, tools | As in the [skin reference §1](shader-skin.md#1-pinned-inputs) |
| `base\materials\hair.mt` | SHA-256 `d64761b6364373d5c84c903c5193738295afc2aa2812f215bf605016835482d5` (9,377 bytes, from `memoryresident_1_general.archive`) |

| Program (MeshSkinned) | GUID | DXBC SHA-256 |
|---|---|---|
| `hair` `hair_alpha_accum` pixel | `2782105832921211528` | `2b0f3597…4267a` |
| `hair` `hair_basecolor_blend` pixel | `7571795766366002052` | `7647ccdc…bbf23` |
| `hair` `hair_gbuffer_solid` pixel | `2903833597335136032` | `ade6c2a6…808cc` |
| `hair` vertex (all three passes) | `7115927943278841644` | `65b1b1b9…d07ae` |
| static `m_shaderLightsComputeGlobalOnly_Clustered_00010001` (sun; Standard + Hair) | `7525818560587663624` | `07ebbaf9…c8e3` |
| static `m_shaderLightsComputeGlobalLocalShadows_Clustered_11111111` (sun + local lights; all classes) | `6606735909222169407` | `c0ce7b53…dac86` |

The shader cache has 234 `hair` compilations [observed]; only the MeshSkinned, non-dismembered set above was read.

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

A mid-grey `Strand_ID` placeholder (for example the lashes' 107/105/107) is a constant ID, so every strand of such a mesh reads the **same** ID-ramp entry.

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

A mid-grey ID leaves the root-to-tip colour unchanged; the result can exceed 1 or go negative, and the resolve stores `|c|`.

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

Decoded from `7525818560587663624` and present unchanged in `6606735909222169407` ([hair shading §5](../../knowledge/hair-shading.md#5-deferred-hair-light)): Karis's 2016 model [source-supported] with R (white), TRT (tinted `C^(0.8/cosθD)`), no TT, and a wrapped "multiple-scatter" diffuse; per-strand shift `ρ = lerp(cb0[17].z, cb0[17].w, frac(frac(ID·0.0729477)·52.98292))`. Intensities are **`cb0[12].x` (R), `.z` (TRT), `.w` (diffuse)** [observed], paired with the `GlobalLight/*` GameOptions by role [hypothesis for the pairing; vanilla values 0.3, 0.8, 0.47 [community]].

### 6.2 Local lights: decoded here

In `6606735909222169407` the tiled local-light loop has its own Hair branch (class 4 of its second switch, walking the per-tile light list) [observed; decompiled listing, identified by the per-strand hash constants `0.0671106`/`0.00583715` and `52.98292`, which occur exactly twice in the program, once per path]:

| Term | Local-light arithmetic | Compared with the sun path |
|---|---|---|
| Frame, angles | `sinθL = T·L`, `sinθV = T·V`, `cosθD`, `cos(φ/2)` from L and V projected normal to T | Same |
| Per-strand shift | Same hash of the stored `Strand_ID`, same `cb0[16..17]` registers | Same |
| R lobe | Same Gaussian, shift, `N = cos(φ/2)/4`, Schlick F0 0.0466 at `√(½ + ½ L·V)`, gated by `clamp(wrap(N·L, cb0[19].y) + 1 − cb0[19].z)`; scaled by **`cb0[13].x`** | Same shape; **intensity register differs** |
| TRT lobe | Same, scaled by **`cb0[13].z`** | Same shape |
| Diffuse | Same wrapped term with `cb0[18]`, × shadow × **`cb0[13].w`** × `saturate(pow(C / luma601(C), 1 − shadow))` | Same shape |
| Roughness | The G-buffer roughness, **without** the per-light roughness shift that Standard and Subsurface local lights apply | — |
| Light colour | × attenuation; × a half-float from the light's data when `cb0[15].w ≠ 0` | Per-light factor of unknown meaning [hypothesis] |

So the local-light hair model **is the sun model evaluated per light**, with its own intensity triple in `cb0[13]`. Pairing `cb0[13]` with the `LocalLight/R`, `/TRT`, `/MultiScatter` GameOptions (R 0.35 in the third-party vanilla list) is by analogy [hypothesis]. Every light of the character creator and mirror screen is local ([creator lighting](../../knowledge/creator-lighting.md)), so this is the path that shades hair and lashes there.

### 6.3 What the light does not read

- **GBuffer2.z (thickness / `Scattering`)**: the all-class light computes `saturate((z − 1/3)·1.5)` once and uses it only in the Foliage branch; the local-light loop never reads it; the SSS passes run only on Subsurface pixels [observed]. `Scattering` therefore has **no effect on direct lighting** in the rasterised path. Ray-traced paths are not parsed.
- **`VertexColorStrength`** is read by no hair pixel program [observed].
- **Environment light**: neither light program has a probe term. The `EnvProbe/R`, `/TRT`, `/MultiScatter` options imply a separate hair path in the ambient/reflection passes, not yet located [hypothesis].

## 7. `.hp` profiles and their resolution

- **Structure** [source-supported: RED4ext `G/CHairProfile.hpp:20-23`; observed in 72 vanilla profiles]: `gradientEntriesID` and `gradientEntriesRootToTip`, each an unsorted list of `{value, Color}` stops, and `sampleCount`.
- **Bake** into one row of a runtime float texture (the static cache names `HairProfilesGradients`): row texel 0 holds N, then N ID samples and N root-to-tip samples [observed on the read side]. How the CPU builds the row is in no shader. The Studio's model (sample `k` at `t = k/(N−1)`, interpolate the 8-bit stops, then decode from sRGB) fits vanilla creator swatches at a median 4.7° hue error, best of the tested models [hypothesis, supported by fit; [calibration](../eye-artistry/hair-calibration-2026-09-25.md)].
- **Which profile wins.** Vanilla hair and NPC hair bind a colour appearance to a shared `…\hair_profiles\{colour}__{style}.mi` whose only override is `HairProfile`, so a same-path `.hp` replacer recolours V and every NPC with that colour. Archive precedence (mods before base) decides between providers [source-supported, not runtime-proven]; see [hair shading §7](../../knowledge/hair-shading.md#7-resolving-which-hp-a-material-uses).

## 8. The scalp cap

Hairstyles draw a cap under the cards with **`mesh_decal_gradientmap_recolor.mt`**, a `post_gbuffer` decal [observed]:

- `DiffuseTexture` is an **ID map**: its R addresses a `GradientMap` texture, the per-colour `hh_cap_grad__<colour>.xbm` (sRGB, `isGamma` 1) [observed].
- `MaskTexture` gives the coverage; colour blends in **square-root space** like every decal ([materials §2.4](../../knowledge/materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it)).
- The cap therefore does not use the `.hp` at all: a hair-colour mod must ship matching cap gradients, or the scalp and strands disagree. The plain template's own program (`5232451138945967528`) has since been read: colour `DiffuseColor × GradientMap(saturate(DiffuseTexture.R), 0.5)` in square-root space, linear and unsaturated coverage from `DiffuseAlpha × gradient alpha × MaskTexture.R`, no UV transform [observed] ([decal reference §5.3](shader-decal.md#53-the-gradient-recolour-trio)).

## 9. Lashes

The eyelash chunk of the eye mesh uses `hair.mt` [observed]:

- **Constant ID and root-to-tip.** The vanilla eyelash `.mi` chain leaves the placeholders in place: `Strand_ID` a constant mid-grey (107/105/107, about 0.42) and `Strand_Gradient` a constant white (tip). So **a lash's colour is one number per profile**: the overlay of ID entry `uint(126·0.42) = 52` with the **last** root-to-tip entry of the chosen `.hp` [observed inputs; the bake is [hypothesis]]. Profile edits near the root never show on lashes.
- `ShadowMin = ShadowMax` in the vanilla eyelash `.mi` saturates the shadow term to 1 for unpainted vertices [observed arithmetic].
- The colour option `eyelash_color` selects the `.hp`; the reference save's lash requests `…\hair_profiles\{material}.hp`, which both the base game and an installed mod provide with very different stops ([overlap audit](../eye-artistry/brown-liquorice-profile-overlap.md)).
- Lashes are lit by the hair light, so on the creator screen by the local-light path of §6.2.

## 10. What blocks correct hair and lash colour

Ranked by how much each can move the colour a player sees:

1. **The winning `.hp`** (resolution, not shading). Two providers of one path give a golden tan or a near-black lash from the same shader ([hair shading §7](../../knowledge/hair-shading.md#7-resolving-which-hp-a-material-uses)). The Studio applies archive precedence and records the losers; the precedence itself needs one controlled in-game comparison [source-supported].
2. **The profile bake** (CPU): sample positions, interpolation and colour space. The fitted model is the best available; an in-game colour ladder would settle it ([capture request](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request)) [hypothesis].
3. **Runtime GameOptions.** The hair light's intensities and shape (`cb0[12..20]`) are runtime options; the vanilla values come from a third-party list, and the reference install runs a CET preset that changes them (albedo multiplier 0.81, roughness factor 1.20) [community]. A capture must record them; a RED4ext/CET dump would replace the third-party list.
4. **The environment path** (§6.3), not decoded: it sets how hair reads in shade.
5. **Tone mapping and grading** ([creator lighting §5](../../knowledge/creator-lighting.md#5-tone-mapping-and-grading)), decoded for the creator screen.

What is **no longer** a blocker: the local-light hair model (§6.2), which the preview already evaluates per spot light, now has source-level structure; only its intensities remain third-party.

## 11. What the browser adapter reproduces

`hair-colour-model.ts` (pure) and `hair-shading.ts` (Three adapter), selected by template name in `character-material-adapters.ts` [observed by comparing the code with the programs]:

| Game step | Preview | Status |
|---|---|---|
| Profile bake, truncated lookup, overlay, shadow term, `\|c\|` | Float profile texture, `texelFetch` | Faithful to the shader; bake [hypothesis] |
| Coverage: remap, dither range, nesting | Alpha-to-coverage with `hairResolvedCoverage` | Coverage faithful; colour within a pixel approximate (no k-buffer, no 0.98 eviction) |
| Sun hair light | `xfsHairDirect` with `GlobalLight` intensities | Faithful structure; constants [community] |
| Local hair light | The same function per spot light with `HAIR_LOCAL_LIGHT` | **Structure now confirmed** by §6.2; the adapter's comment that the path is not decoded is stale (a follow-up edit). R 0.35 [community]; TRT and diffuse taken equal to the global values [hypothesis] |
| Per-light factor (`cb0[15].w`) | Not modelled | Unknown meaning |
| Environment | Three's ambient diffuse × `EnvProbe/MultiScatter` | Approximation |
| Sway animation | Not drawn | Static by default in the game too |
| Cap | Mask-blended gradient decal, linear "over" | Lighter at partial coverage than the game's square-root blend |

## 12. Open questions

1. The `cb0[13]` ↔ `LocalLight/*` pairing and values, and the `cb0[15].w` per-light factor: one GameOptions dump plus a light-data read.
2. The hair environment/ambient path.
3. The CPU bake of `.hp` rows (as [hair shading open question 2](../../knowledge/hair-shading.md#open-questions)).
4. Slice 3 of the k-buffer array: the opaque depth, or something else.
5. The flag behind the ×1.33 coverage boost.
6. The plain `mesh_decal_gradientmap_recolor` program (the cap), not yet decompiled.

## 13. In-game test asks (batch into the prepared session)

1. **Creator-screen colour ladder** of one hair pack (the existing [capture request](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request)): now known to exercise the local-light path of §6.2.
2. **Lash colour with and without the mod `.hp`**: the controlled comparison for §10 item 1 ([head CC rendering test asks](../../knowledge/head-cc-rendering.md#in-game-test-asks)).
3. Record the CET/GameOptions state and weather with every capture.

Related: [hair shading](../../knowledge/hair-shading.md) · [materials and shaders](../../knowledge/materials-and-shaders.md) · [brows](../../knowledge/brows.md) (brows use a decal, not `hair.mt`) · [skin reference](shader-skin.md) · [fact index](shader-fact-index.md).
