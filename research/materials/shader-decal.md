# Decal shader reference: the `mesh_decal` family (game 2.31)

Fourth per-family reference of the [materials and shader study](../backlog/materials-shader-re.md), after [skin](shader-skin.md), [hair](shader-hair.md) and [eye](shader-eye.md). It consolidates the earlier [mesh-decal shader contract](mesh-decal-shader-contract.md), the [glossy](glossy-decal-feasibility.md) and [colour-shift](colour-shift-game-feasibility.md) feasibility notes and the [finish designs](finish-designs/README.md), and adds a reading of every MeshSkinned `post_gbuffer` program of the family: the templates and their passes, blend states and write masks per target, the common pixel program step by step, what each variant changes, how a decal's colour, roughness, metalness and normal combine with the skin under it, coverage and mips, and how XF Eye Artistry's exports depend on each fact. §9 applies the facts to the first photo-mode session's "Matte and Satin read glossy" and "Shimmer reads as a soft gloss". The consolidated reading is [materials and shaders §2.4 and §4.5](../../knowledge/materials-and-shaders.md#45-mesh_decal-family-post_gbuffer-all-standard-class-meshskinned-available); which Studio code relies on which fact is in the [shader fact index](shader-fact-index.md#decals-mesh_decal-family-the-export-route).

**Labels.** **[observed]**: read directly in a compiled 2.31 program or an installed resource. **[source-supported]**: supported by tool or engine source, the wiki, a community tool, or a close structural match to a published technique. **[hypothesis]**: not established. **[runtime]**: seen in the running game (sessions 1 and 2, 25 and 26 September 2026). Compiled-program evidence says what the programs compute, not which variant drew a given frame.

## 1. Pinned inputs

| Input | Identity |
|---|---|
| Game | 2.31 (`GameVersion 2310`) |
| `shader_final.cache` | SHA-256 `339145…3ccfa` (full hash in the [shader-system note](shader-system/README.md#inputs-read-only)) |
| `base\materials\mesh_decal.mt` | SHA-256 `b1b181b7…` ([head CC render evidence](../character-customization/head-cc-render-evidence.md)) |
| `mesh_decal_double_diffuse.mt` / `mesh_decal_blendable.mt` / `mesh_decal_wet_character.mt` | `8546e261…fb7` / `ddfacaf5…bbe` / `2613b74f…c89` |
| `mesh_decal_gradientmap_recolor.mt` / `…_recolor_blendable.mt` | `dbcb59a0…e176` / `13ec8047…d1cc` |
| Disassembler / decompilers | Windows SDK 10.0.22621 `dxc -dumpbin`; dxil-spirv `f2d1b554` → SPIRV-Cross `aa217aeb` |
| Method | [shader-system method](shader-system/README.md#method-repeatable-in-minutes) (`shader_annotate.py annotate <template> --guid <GUID> --decompile`); template passes from `template_summary.py`. Listings stay local and ignored |

Programs read (MeshSkinned `renderstage_post_gbuffer`, the plain variant unless noted; the pixel program is shared with the PreSkinned and Dismembered contexts):

| Template | Pixel GUID | DXBC SHA-256 |
|---|---|---|
| `mesh_decal` | `16098255505177109230` | `35e8c18f…2a905c3d` |
| `mesh_decal` Discarded variant | `5614144548384496387` | `d2cd7ed6…65ad45d` |
| `mesh_decal_double_diffuse` | **`7624081209775720613`** | `15b4d277…ba8e550` |
| `mesh_decal_double_diffuse` Discarded variant (the program earlier brow studies cite) | `8834363738920290566` | `8397be36…ae73133` |
| `mesh_decal_blendable` / its MeshSkinned vertex | `3004271728282315156` / `13171349059403238141` | `3126455c…5d866d50c` / `77e887ec…24fdcb3` |
| `mesh_decal_gradientmap_recolor` | `5232451138945967528` | `43718f02…385391` |
| `mesh_decal_gradientmap_recolor_2` | `13292453303177655632` | `23974d99…bcbf45de` |
| `mesh_decal_gradientmap_recolor_blendable` / vertex | `3456408455936683438` / `7066617541061519457` | `f20c757c…e1167f` / `77e887ec…24fdcb3` |
| `mesh_decal_gradientmap_recolor_emissive` | `6714007623731301689` | `fae317de…bf771f6` |
| `mesh_decal_emissive` | `9453098283293843067` | `8099da16…fdea3229` |
| `mesh_decal_emissive_subsurface` (`subsurface_emissive` stage) | `8986576764202126900` | `39e758c6…70df3dc` |
| `mesh_decal_wet_character` | `17388524518779931857` | `e8c589f5…c9ea4641135` |
| `mesh_decal_parallax` | `13887708964992876960` | `ef16302f…58ebf7` |
| `mesh_decal_particles` | `1688064767334184205` | `804801d3…eac354a5` |
| `mesh_decal_multitinted` | `12680699086337052733` | `7492df65…24fc57` |
| `mesh_decal_morph` / `mesh_decal_revealed` | `7449292646156817489` / `6766005304427206345` | `4ad14986…637bfda` / `0c149998…e045e3ab` |
| `mesh_decal__blackbody` | `3236176651483732111` | `643d5621…4e2c70cd` |

The two blendable templates' vertex programs are **byte-identical** (same SHA-256), so `mesh_decal_blendable` has exactly the Fresnel fade the colour-shift export already handles [observed].

## 2. The family

### 2.1 Templates

All 16 compiled `mesh_decal*` templates are Standard class, `EMP_Normal`, `canBeMasked` 1, with MeshSkinned among their vertex factories [observed]. The projected box decals (`decal*.remt`, `decal_*.mt`) are a different family: they compile for `MVF_Decal`, not for skinned meshes, and cannot draw on the plate [observed, [glossy feasibility](glossy-decal-feasibility.md)].

| Template | What it is [observed] | Coverage curve | UV transform | Surface write |
|---|---|---|---|---|
| `mesh_decal` | The base set: colour, normal, roughness and metalness per texel, flipbook animation | **squared** | yes | coverage-masked |
| `mesh_decal_double_diffuse` | Brows, 36 lip styles. A second, "powder" alpha and colour, and an optional one-colour gradient tint (§5.1) | **squared** (after the two alphas combine) | yes | coverage-masked |
| `mesh_decal_blendable` | `mesh_decal` plus the Fresnel colour of §5.2 and a braindance glitch/fade on the vertex side | **squared** | yes | coverage-masked |
| `mesh_decal_gradientmap_recolor` | Colour = `DiffuseColor` × a gradient texture indexed by `DiffuseTexture.R` (hair caps) | **linear** | no | coverage-masked |
| `mesh_decal_gradientmap_recolor_2` | The same indexed into the engine's runtime gradient atlas by a `.gradient` resource | **linear** | no | coverage-masked |
| `mesh_decal_gradientmap_recolor_blendable` | `…_recolor` plus the Fresnel colour; the Colour-shifting export | **linear** | no | coverage-masked |
| `mesh_decal_gradientmap_recolor_emissive` | `…_recolor` plus an emissive gradient into GBuffer2.w | **linear** | no | none (target 2 writes only `.w`) |
| `mesh_decal_emissive` | Colour plus emission; scrolls, two-state colour | linear (colour-map alpha) | yes | none (target 2 writes only `.w`) |
| `mesh_decal_emissive_subsurface` | Emission only, in its own `subsurface_emissive` stage (§5.4) | mask, alpha-tested | no | none |
| `mesh_decal_wet_character` | Rain streaks: V scrolls with time; **surface alpha is 1** | **squared** colour, surface 1 | yes | **everywhere the plate draws** |
| `mesh_decal_parallax` | A height-map ray search offsets every texture lookup (§5.5); roughness and metalness raw R, no scale or bias | **squared** | yes | coverage-masked |
| `mesh_decal_particles` | The `mesh_decal` arithmetic under another name (flipbook atlas) | **squared** | yes | coverage-masked |
| `mesh_decal_multitinted` | Eight tint colours, one chosen per vertex (`TEXCOORD2.w × 8`), weighted by a tint mask | **linear** (raw alpha) | no | coverage-masked |
| `mesh_decal_morph`, `mesh_decal_revealed` | Double-diffuse and flow-map reveals driven by a per-draw modifier (`MaterialModifiersConsts[2].x`) | linear | morph yes, revealed no | coverage-masked |
| `mesh_decal__blackbody`, `blackwall_blendable_mesh_decal*` | FX: heat glow into GBuffer2.w; braindance variants | — | — | — |

No template in the family has a clear coat, a second specular lobe, a specular level or an anisotropy input: every one writes the same three G-buffer targets (§4.8) [observed]. There is no dedicated gloss template, and the "wet" one is animated rain, not a gloss finish.

### 2.2 Passes, depth and blend states per target

From the serialized templates [observed]; "flags" is the technique flag word, targets are GBuffer0, 1, 2.

| Stage (flags) | Depth | Stencil | Cull | Target 0 | Target 1 | Target 2 |
|---|---|---|---|---|---|---|
| `post_gbuffer` (1), most templates | test `GreaterEqual`, **write off** | off | `CULL_Front` | `SrcAlpha/InvSrcAlpha`, alpha `Zero/One`, mask **RGB** | same | same |
| `post_gbuffer`, `…_emissive`, `…__blackbody` | same | off | front | as above | as above | **`One/One`, mask BA** (additive into GBuffer2.z/.w) |
| `post_gbuffer`, `…_recolor_emissive` | same | off | front | as above | as above | **`One/One`, mask A** |
| `subsurface_emissive` (1), `…_emissive_subsurface` | test on, write off | off | front | `SrcAlpha/InvSrcAlpha`, alpha `One/InvSrcAlpha`, RGB | off | `One/One` BA (the program writes only target 0) |
| `gbuffer_regular` (8), no pixel program | test and **write on** | on | front | — | — | — |
| `highlights` (512) | write off | on | front | outline buffer; no lighting ([particle-decal audit](../../experiments/009-glitter-game-fixture/particle-decal-audit.md)) | | |

- The pixel-less, depth-writing `gbuffer_regular` technique is a depth-only variant [observed]. Vanilla face decals sit 0.40 mm in front of the skin and would hide it if that pass drew with them; they do not, so it is not part of the normal decal draw [hypothesis for its role].
- `OFFSET_DecalBias` on the rasterizer adds an engine-side depth bias whose values are unknown [observed field; values unknown] ([materials §2.4 item 5](../../knowledge/materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it)).

### 2.3 What the "Discarded" variants are

Every template's `…Discarded` compilation (for example `mesh_decal` `5614144548384496387`, double-diffuse `8834363738920290566`) is **the plain program plus one line** [observed by diffing the decompiled listings]:

```hlsl
discard if (t67.Load(int3(x & 63, y & 63, frame & 63)).x * MaterialModifiersConsts[0].z + MaterialModifiersConsts[0].w) < 0;
```

`t67` is a texture array addressed modulo 64 by pixel position and frame: a temporal dither pattern. So "Discarded" is a **per-draw dithered dissolve** driven by two engine modifiers, not an alpha test on the material's own alpha [observed arithmetic]; `multilayered.mt`, which cannot be masked (`canBeMasked` 0), has the same line in its Discarded variants ([multilayered §3](shader-multilayered.md#3-passes-and-variants)). Which draws the engine sends through it (fades of appearing, dismembered or camera-near meshes) is [hypothesis]. Consequences: the brow arithmetic cited from `8834363738920290566` holds for the plain program `7624081209775720613` too, and no decal template offers per-texel alpha-testing; soft coverage is always the blend in §4.

## 3. Instance chains on the player

| Face decal | Template | What the vanilla instances write [observed, resource] |
|---|---|---|
| Eye makeup (36 options) | `mesh_decal` | Colour; roughness 0.50 (`roughmetal.xbm`) at surface alpha 1; coverage broken by a noise `SecondaryMask` (`noise_decal_d01`, ×30 UV, influence 1) ([experiment 017 §2](../../experiments/017-plate-depth/README.md#2-uniform-gloss-the-roughness-reaches-the-lighting-the-finish-values-are-glossier-than-skin)) |
| Lipstick (114 styles) | 78 `mesh_decal`, 36 `mesh_decal_double_diffuse` | Regular and glossy styles write **no** roughness; glossy styles 21–38 add a white metalness map at surface alpha **0.05**; matte styles write white roughness (1.0) at surface alpha **0.35–0.4** ([head CC render evidence](../character-customization/head-cc-render-evidence.md)) |
| Cheeks (24) | `mesh_decal` | Colour; gold and silver blush write white metalness at surface alpha 0.1–1 with roughness 0.51 read raw ([face makeup §1](../../knowledge/face-makeup.md#1-vanilla-cheek-makeup)) |
| Brows (13) | `mesh_decal_double_diffuse` | Gradient tint, powder alpha, normal 0.4 in mode 1, roughness ≈ 0.50 at surface alpha 1 ([eyebrows §3](../../knowledge/brows.md#3-material-and-colour)) |
| Scars, face cyberware | `mesh_decal` | Normals at `NormalAlpha` 0.2–1 in mode 1, small surface alphas |
| XF Eye Artistry (flat, faceted) | `mesh_decal`, local entries `@preset` / `@faceted` | Every channel at alpha 1 through √-encoded coverage (§8) |
| XF Eye Artistry (Colour-shifting) | `mesh_decal_gradientmap_recolor_blendable`, `@fresnel_<preset>` | Uniform base, Fresnel tint, roughness 0.32 and metalness 0.25 by bias (§8) |

These are CDPR's own calibration points for makeup on skin: **matte is a partial push toward roughness 1, gloss keeps the skin's roughness (at most a trace of metalness), metallic is metalness 1 at roughness ≈ 0.5, and eye makeup sits at 0.50 with noise-broken coverage** [observed values; the reading as a calibration is ours].

## 4. The common pixel program, step by step

Program `16098255505177109230` (`mesh_decal`); the other templates share these steps except where §5 says. All steps [observed]; formulas checked line by line against the decompiled listing. Inputs from the vertex program: UV0 exactly as stored, the plate's normal, tangent and bitangent, and the fragment's view depth.

### 4.1 Depth threshold

```hlsl
if (DepthThreshold > 0) discard if |linearDepth(sceneDepth t33) − fragmentDepth| > DepthThreshold;
```

A decal pixel more than `DepthThreshold` (template default 0.5 m, freckles 0.9975; **0 in `mesh_decal_double_diffuse`, which turns the test off**) from the opaque surface behind it is dropped. It rejects decals floating far off the surface; at the plate's 0.4 mm it never triggers, and it does not decide coincident surfaces [observed].

### 4.2 UV transform and flipbook

```hlsl
t = R(UVRotation·π) · (UVScale · (uv − 0.5)) + 0.5 + UVOffset;       // rotation in half-turns
f = floor(AnimationFramesWidth · frac(AnimationSpeed · time) · AnimationFramesHeight);
u' = (f + sign(t.x)·frac(|t.x|)) / AnimationFramesWidth;
v' = (sign(t.y)·frac(|t.y|) − floor(f / AnimationFramesWidth)) / AnimationFramesHeight;
```

Every texture (colour, secondary mask at `SecondaryMaskUVScale · (u', v')`, normal, normal alpha, blending-mode alpha, roughness, metalness) is sampled at `(u', v')` with implicit LOD through one sampler `s0` [observed]. The `sign·frac` fold keeps coordinates continuous inside (−1, 1) and jumps at every non-zero integer, where implicit derivatives would spike to the smallest mip; the Studio's plate window maps the plate into [0, 1] with a 1/64 margin, so no plate triangle crosses a jump [observed for the window, `plate-uv-window.ts`]. The gradient-recolour, multitinted and emissive-subsurface templates apply **no** UV transform: only the flipbook (or nothing) [observed].

### 4.3 Coverage

```hlsl
a        = DiffuseTexture.a;                                              // filtered sample
adjusted = saturate((a − 0.5) · tan((AlphaMaskContrast + 1)·π/4) + 0.5);  // contrast 0: unchanged
coverage = adjusted² · (1 − SecondaryMaskInfluence · SecondaryMask.R);
```

**Squared after filtering** [observed]. The colour target's alpha is `DiffuseAlpha · coverage` and the surface target's `RoughnessMetalnessAlpha · coverage`; neither is saturated in the program, so values above 1 (vanilla blush uses `DiffuseAlpha` 0.5–4) rely on the blender clamping alpha for a fixed-point target [hypothesis: the target formats are unrecovered, [materials open question 8](../../knowledge/materials-and-shaders.md#7-open-questions)]. All three target alphas default to 0.

### 4.4 Colour

```hlsl
GBuffer0.rgb = sqrt(DiffuseColor.rgb · DiffuseTexture.rgb);   // alpha = DiffuseAlpha · coverage
```

`DiffuseColor` is used as passed, with no decoding in the program; the texture is sRGB-decoded by its view when `isGamma` is set [observed for the program; the view rule is [materials §5](../../knowledge/materials-and-shaders.md#5-texture-conventions)]. The blender then lerps **square-root colour**: the stored result is `(α·√c + (1 − α)·√skin)²` after the light squares it.

### 4.5 Normal

```hlsl
n  = (NormalTexture.rg·2 − 1, z = sqrt(max(0, 1 − x² − y²)));   // blue ignored, no Y flip
na = UseNormalAlphaTex > 0.5 ? NormalAlphaTex.R : DiffuseTexture.a;   // raw alpha: no contrast, not squared, no secondary mask
if (NormalsBlendingMode > 0.5) {                                  // mode 1
    g   = normalize(t74.Load(pixel).rgb − 0.5);                   // the G-buffer normal under the decal
    b   = (dot(T, g), dot(B, g), dot(N, g) + 1);                  // in the plate's tangent frame, + (0, 0, 1)
    d   = (−n.x, −n.y, n.z);
    rnm = normalize(b·dot(b, d) − d·b.z);                         // reoriented normal mapping, skin as base
    out = normalize(lerp(TBN·(−n.x, −n.y, n.z), TBN·rnm, NormalsBlendingModeAlpha.R));
    alpha = NormalAlpha · na · saturate(50 − 50·n.z);
} else {                                                          // mode 0
    out = normalize(TBN·n);  alpha = NormalAlpha · na;
}
GBuffer1.rgb = out / max(|out|) · 0.5 + 0.5;
```

- Mode 1 is Barré-Brisebois and Hill's reoriented normal mapping with the **existing G-buffer normal as the base** and the decal as the detail [source-supported: structural match]. A flat texel (z = 1) writes nothing; full weight needs z ≤ 0.98, a tilt of **11.5°** [observed].
- **`NormalsBlendingModeAlpha` must stay white.** Below 1 it does not fade towards the plain decal normal but towards the decal normal **mirrored** in X and Y (the RNM detail's sign convention without the RNM) [observed arithmetic]. Every XF instance leaves it at the template's white default [observed, `preset-compiler.ts`]; vanilla instances were not surveyed for it.
- Mode 0 replaces the normal with the plate's normal plus the map, erasing the skin's pores and wrinkles under the covered area [observed].
- `t74` is a copy of the G-buffer normal bound for the decal stage. Whether it is refreshed between two decal draws, so that a mode-1 decal composes with an earlier decal's normal rather than the skin's, is [hypothesis]; it matters only where two normal-writing decals overlap.

### 4.6 Roughness and metalness

```hlsl
GBuffer2.x = saturate(MetalnessScale · MetalnessTexture.R + MetalnessBias);
GBuffer2.y = saturate(RoughnessScale · RoughnessTexture.R + RoughnessBias);
GBuffer2.z = 1/3;                                     // alpha = RoughnessMetalnessAlpha · coverage
```

Separate single-channel maps, red only [observed]. **Roughness, metalness and GBuffer2.z share one alpha**: a decal cannot write roughness without also blending metalness (towards its own value) and GBuffer2.z towards 1/3 [observed]. Over skin that is harmless (the vanilla head's metalness slot is 0), but a roughness-only decal over a metallic one lowers the metal.

### 4.7 No discard, no specular antialiasing

Besides the depth threshold (and the Discarded variants' dither), the program never discards; soft edges are pure blending. It derives no roughness from normal variance, so a texture's mip chain is the only filter a mod controls ([Glitter in game §1](../../knowledge/glitter-in-game.md#1-from-flake-texture-to-screen-pixel)) [observed].

### 4.8 Outputs

| Target | RGB written | Alpha (the blend weight) | Blend | Not touched (write mask RGB) |
|---|---|---|---|---|
| GBuffer0 | `sqrt(colour)` | `DiffuseAlpha · coverage` | lerp in √ space | `.a`: the eye's normal bits, skin's 1 |
| GBuffer1 | encoded normal | `NormalAlpha · na` (× the mode-1 gate) | lerp of the **encoded** normal | `.a`: skin-profile high bits |
| GBuffer2 | metalness, roughness, 1/3 | `RoughnessMetalnessAlpha · coverage` | linear lerp | `.w`: skin-profile low bit, emissive bits |

The stencil is off, so the lighting class stays the one written by the surface underneath [observed].

## 5. What each variant changes

### 5.1 `mesh_decal_double_diffuse` (brows, 36 lip styles)

Program `7624081209775720613`, registers by the template's order (`GradientMap` 3 … `DepthThreshold` 35) [observed]:

```hlsl
p = contrast(DiffuseTexture.a);  s = contrast(SecondaryDiffuseAlpha.a);        // SecondaryDiffuseAlpha: its own texture
coverage = (p + (1 − p)·s·SecondaryDiffuseAlphaIntensity)² · (1 − influence·SecondaryMask.R);
secondary = SecondaryDiffuseColor·s·(1 − DiffuseTexture.a)·SecondaryDiffuseAlphaIntensity;   // raw a, not p
colour = UseGradientMap > 0.5
       ? secondary + saturate(GradientMapIntensity · GradientMap(s1, (GradientMapUV, 0.5)).rgb) · DiffuseTexture.rgb
       : secondary + DiffuseColor · DiffuseTexture.rgb;
```

- **The brows' squared coverage** is the combined primary-plus-powder alpha, squared after both are filtered [observed]; [eyebrows §3](../../knowledge/brows.md#3-material-and-colour) had it right.
- **The gradient tint is saturated per channel after the intensity**: at the vanilla `GradientMapIntensity` 2, any gradient channel above 0.5 clips to 1, so bright colours (platinum, pastel ombrés) lose their tint and fall back to the texture's RGB [observed]. The gradient uses a second sampler, `s1`, at the constant coordinate `(GradientMapUV, 0.5)`.
- The colour is a sum, not a mix normalised by coverage: the powder term is premultiplied by its own alpha, the primary term is not [observed].
- The UV transform applies to all textures as in `mesh_decal` (answers [eyebrows open question 3](../../knowledge/brows.md#open-questions)); template defaults: `MetalnessTexture` `black.xbm`, `NormalAlphaTex` `white.xbm`, `DepthThreshold` 0 (answers question 4) [observed].
- Normal and surface as §4.5–4.6 [observed].

### 5.2 The Fresnel colour (`mesh_decal_blendable`, `…_gradientmap_recolor_blendable`)

```hlsl
w  = TEXCOORD3.w = max(1 + MaterialModifiersConsts[2].x − saturate((d − FadeOutOffset)/FadeOutDistance), 0);  // vertex; d: horizontal camera distance
fr = saturate(|1 − dot(Nout, V)|^FresnelExponent);         // Nout: the normal §4.5 writes
GBuffer0.rgb = sqrt(base + FresnelColor · FresnelColorIntensity · w · fr);
```

[observed in both programs; both vertex programs are byte-identical.] The difference between the two templates is everything else: **`mesh_decal_blendable` keeps `mesh_decal`'s squared coverage, UV transform and per-texel base colour (`DiffuseColor × DiffuseTexture.rgb`)**; the gradient-recolour one uses a linear `MaskTexture` coverage, no UV transform and a base colour from a gradient indexed by `DiffuseTexture.R`. For the Colour-shifting export this matters (§10, rank 4): the plain blendable template could carry the shift on the plate-local window and with any number of base pigments per preset, still with one shift colour per draw.

### 5.3 The gradient-recolour trio

- **Plain** (`5232451138945967528`; hair caps): `colour = DiffuseColor · GradientMap(s1, (saturate(DiffuseTexture.R), 0.5)).rgb`; coverage `contrast(a + (SecondaryMask.R·a − a)·influence)` with `a = DiffuseAlpha · gradient.a · MaskTexture.R`, **not squared and not saturated**; normal alpha `NormalAlpha × coverage` (× the gate in mode 1) [observed]. This settles the cap arithmetic the [hair reference §8](shader-hair.md#8-the-scalp-cap) held as a hypothesis.
- **`_2`** (`13292453303177655632`): the gradient is a `.gradient` resource read from the engine's **runtime gradient atlas** (`t55`, row `(Gradient + 0.5)/512`, sampler `s10`), the same atlas the eye's iris gradient uses ([eye §5.6](shader-eye.md#56-colour-and-the-gradient-lookup)). Unlike the eye, this program raises the atlas sample to **0.45** in all four channels, alpha included, before use [observed]. A consumer undoing a 2.2 power on alpha suggests the atlas stores every channel with a 2.2 power applied, which would make the eye's direct read equal to a gamma-2.2 decode of the stops (close to the Studio's sRGB-decode bake) [hypothesis; eye open question 3].
- **`_emissive`** (`6714007623731301689`): adds `EmissiveGradientMap`; emission `max(log2(E^tan(π/4 − contrast·π/4)) + EmissiveEV, 0) × coverage` is packed into GBuffer2.w as `sqrt(saturate(ev/10))·127 | 128` and **added** (`One/One`, mask A); roughness and metalness are not written [observed].

### 5.4 Emissive decals

- **`mesh_decal_emissive`** (`9453098283293843067`): colour `sqrt(texture · colour)` with a scripted two-colour wipe driven by `MaterialModifiersConsts[2].x`; emission `max(log2(alpha·pulse) + EmissiveEV, 0)` packed into GBuffer2.w and **added**, together with 1/3 into GBuffer2.z (`One/One`, BA) [observed]. Over skin, the addition lands on bits that hold the skin-profile low bit and skin's own emissive field, so the result there is not a clean emissive flag [hypothesis for the visible effect].
- **`mesh_decal_emissive_subsurface`** (`8986576764202126900`, stage `subsurface_emissive`): no UV transform, no lighting input.

  ```hlsl
  m = max over channels of (SecondaryMask.R · EmissiveMask · EmissiveMaskChannel);
  discard if m < AlphaThreshold;
  out.rgb = EmissiveEV · EmissiveColor.rgb;          // EmissiveEV is a plain multiplier here, not exp2
  out.a   = MaterialModifiersConsts[2].x · m;        // blend SrcAlpha/InvSrcAlpha
  ```

  [observed, checked against the disassembly.] Two consequences for the glitter accent (§8): **with `EmissiveEV` 0 the accent's colour is black**, and its opacity is a per-draw engine modifier times the mask. Where `MaterialModifiersConsts[2].x` is 0, the accent draws nothing at any `EmissiveEV`; what drives it on a character component (a cyberware-glow state, say) and what the `subsurface_emissive` target feeds are [hypothesis].

### 5.5 Other variants

- **`mesh_decal_wet_character`** (`17388524518779931857`): V scrolls with time in a direction set per vertex (running water); surface alpha is the constant 1, so roughness and metalness are written wherever the plate rasterises; normal alpha × (1 − `MaterialModifiersConsts[2].x`); no depth threshold [observed]. Rejected for makeup, as before ([glossy feasibility](glossy-decal-feasibility.md)).
- **`mesh_decal_parallax`** (`13887708964992876960`): a height-map search along the view ray (a linear march in 2–8 steps by view angle, then a binary refinement of up to 10 steps, depth `HeightStrength · 0.075`) offsets every texture lookup; roughness and metalness are the raw R with no scale or bias [observed; the search is the relief-mapping technique of Policarpo et al., source-supported]. It gives embossed depth to printed patterns (rhinestone or sequin prints), not a lighting change.
- **`mesh_decal_particles`** (`1688064767334184205`): the `mesh_decal` arithmetic; its name refers to its flipbook content [observed] ([particle-decal audit](../../experiments/009-glitter-game-fixture/particle-decal-audit.md)).
- **`mesh_decal_multitinted`**: eight constant tints, one per vertex by `TEXCOORD2.w`, as a multiply weighted by the tint's alpha and `TintMaskTexture.R`; linear coverage [observed]. Per-texel colour is already in the flat route's diffuse map, so it adds nothing for makeup.
- **`mesh_decal_morph`, `mesh_decal_revealed`**: coverage lerped from `StartAlpha` to `FinalAlpha` or revealed along a flow map, by a per-draw modifier [observed]. Scripted transitions.

## 6. What the pixel under a decal ends up with

Putting §4 together with the skin writer ([skin §5](shader-skin.md#5-the-g-buffer-program-step-by-step)) and the deferred light ([skin §6](shader-skin.md#6-lighting-the-subsurface-class-and-the-sss-pipeline)); the arithmetic is [observed], its visual reading [hypothesis]:

| Channel | Result over skin | Then in lighting |
|---|---|---|
| Base colour | `(α_c·√c + (1 − α_c)·√skin)²`: dark partial coverage darkens about `2α − α²` of the way, not `α` | Post-scatter albedo: SSS blurs light, not colour, so makeup edges stay sharp |
| Roughness | `lerp(skin r, decal r, α_s)`; the skin's per-pore roughness (R biased by B) is **replaced** in proportion to α_s | The Subsurface light sums **two GGX lobes at 0.966 r and 1.597 r**, each at full weight with the default profile: up to twice a Standard surface's specular |
| Metalness | `lerp(skin G (0), decal m, α_s)` | F0 = lerp(0.04, albedo, m); **above 0.1 the pixel leaves SSS** (blur and combine) with a hard switch |
| Normal | mode 0: encoded lerp towards the plate normal (pores lost); mode 1: RNM onto the skin normal, tilts under 11.5° faded (§4.5) | Diffuse and both lobes on that normal |
| GBuffer2.z | → 1/3 | Removes sun transmission (ears, nostrils; not under eye makeup) |
| Class, profile, emissive bits | unchanged | Makeup on skin is lit as skin |

Where several decals overlap (eye makeup, cheeks, brows, the XF plate), each blends over the previous result in draw order; their order within `EMP_Normal` is unknown ([head CC rendering open question 2](../../knowledge/head-cc-rendering.md#open-questions)).

## 7. Alpha, coverage and mips

- **Encode √coverage.** Because colour and surface coverage are squared after filtering, a texture storing `√C` in alpha shows coverage `C` at texel centres; a mip chain must store `√(mean C)` per level (premultiplied destination averages), which the flat and faceted compilers build ([flat mip filtering](flat-preset-mip-filtering.md)) [observed arithmetic; bilinear and trilinear blending between √ texels remain nonlinear].
- **Normal alpha is the raw texture alpha**, so with `UseNormalAlphaTex` 0 a √-encoded map writes its normal at `√C`, slightly more than the colour's `C` at soft edges [observed]; a separate linear `NormalAlphaTex` gives exact control.
- **The gradient-recolour, multitinted and morph templates are linear**: their masks store coverage directly [observed].
- **Brows**: `(p + (1 − p)·s·I)²`, squared after filtering both maps; a brow texture set's mips thin the brow at distance unless built as `√(mean C)` ([eyebrows §6](../../knowledge/brows.md#6-what-this-means-for-a-brow-designer)).
- **The mode-1 gate reads the filtered normal**: averaging facets shortens XY, raises z and fades them (§9.2). The gate is on the sampled z, so mips fade facets faster than they lose tilt.
- **One sampler**: all material textures go through `s0` (anisotropic, trilinear, wrapping at run time) with implicit LOD; the gradient of the double-diffuse and recolour templates uses `s1` ([Glitter in game §1](../../knowledge/glitter-in-game.md#1-from-flake-texture-to-screen-pixel)).

## 8. How XF Eye Artistry's exports depend on these facts

Routes from [`finish-export.ts`](../../projects/xf-studio/authoring/src/engines/layered-makeup/finish-export.ts); one preset is one decal draw on the plate lifted 0.4 mm.

| Finish | Template, entry | Values | Facts it relies on | Risk the facts expose |
|---|---|---|---|---|
| **Matte** | `mesh_decal`, `@preset` | roughness 0.88, metal 0, surface alpha 1 | §4.3 squared coverage (√ alpha), §4.6 surface write, §6 dual lobe | Replaces skin's pore-level roughness with a constant; vanilla matte goes to 1.0 at partial weight (§3) |
| **Satin** | same | 0.38, 0 | same | 0.38 is sharper than bare lid skin (≈ 0.6) and vanilla eye makeup (0.50); the dual lobe makes it read glossy (§9.1) |
| **Metallic** | same | 0.27, 0.65 | §6 metalness > 0.1 leaves SSS, F0 from pigment | The SSS switch is crossed at 15 % coverage: hard, non-scattering skin under the whole mark; its reflection through both skin lobes |
| **Glossy** | same | 0.12, 0 | §2.1 no second lobe exists in the family | One very sharp lobe at dielectric F0: "shiny skin", no film |
| **Shimmer** | `mesh_decal`, `@faceted`, mode 1 | per-texel facets, roughness ≈ 0.42, variance-widened mips | §4.5 RNM and the 11.5° gate, §4.8 encoded-normal lerp, §7 gate on filtered z | Most default facets fall under the gate (§9.2) |
| **Colour-shifting** | `…_gradientmap_recolor_blendable`, `@fresnel_<preset>` | uniform base, `FresnelColor` linear-normalised, roughness 0.32, **metal 0.25**, fade pushed to 1000 m | §5.2 Fresnel before √, linear coverage, no UV transform | **Metalness 0.25 takes every fully covered pixel out of SSS** (linear coverage crosses 0.1 at 40 %), the "Metallic" hardness on a finish that doesn't need it |
| **Glitter** (diagnostic board) | `mesh_decal` mode 1 + `NormalAlphaTex`; accent on `mesh_decal_emissive_subsurface` | flakes tilted to 50°, `EmissiveEV` 0 on the accent | §4.5, §7; §5.4 for the accent | **The accent as built is black and opacity-gated by an engine modifier** (§5.4) |

The compiler writes colour, roughness and metalness through the √-coverage encoding with all three target alphas at 1 and `SecondaryMaskInfluence` 0 [observed in `preset-compiler.ts` and `package-resources.ts`]; no route writes grain into coverage or surface.

## 9. The session-1 observations

On 25 September Board 1 read "uniformly glossy, almost plastic-like", with Matte and Satin not matte or satin, and Board 2's Shimmer read as a diffused gloss [runtime] ([finish board](../../experiments/016-finish-board/README.md#runtime-results)). [Experiment 017](../../experiments/017-plate-depth/README.md) fixed one cause (the coincident plate) and packaged the gloss controls *Gloss A–D* and *Shimmer · strong*; they are staged as [session 2](../../experiments/020-session-2/README.md), whose first run (26 September) confirmed the depth fix (the 0 mm control breaks up at extreme close-up, +0.1 and +0.4 mm stay clean) [runtime] and left the gloss, Shimmer and metal verdicts for a session with a light sweep.

### 9.1 "Matte and Satin read glossy"

Ranked; the decal-side arithmetic is [observed], each attribution a [hypothesis] until the *Gloss A–D* frames:

1. **Satin is sharper than skin, and skin doubles it.** The decal writes 0.38 straight into GBuffer2.y (§4.6); the Subsurface light draws lobes at 0.37 and 0.61, both at full weight. The sharp lobe's GGX peak (∝ 1/r⁴) is about **six times** that of bare lid skin's sharp lobe (r ≈ 0.6 → 0.58). Vanilla eye makeup writes 0.50. *Gloss D*'s Satin 0.50 is the calibrated value.
2. **Matte cannot be glossier than skin under direct light.** At 0.88 its lobes are 0.85 and 1.41, dimmer than the skin's. If Matte still reads glossy in *Gloss A*, the cause is not its written roughness: *Gloss B* and *C* then separate the remaining suspects (close-up breakup showing skin through, fixed by the lift and confirmed in session 2 [runtime]; photo-mode lights' per-light roughness shift; probe and screen-space reflections, not traced).
3. **"Plastic" is uniformity, which the decal enforces.** A flat preset writes one constant roughness at full surface weight over the whole mark, replacing the skin's pore-level roughness variation (the skin writer's R biased by B), while the skin normals stay. Vanilla never does this: eye makeup breaks both coverages with a ×30 noise mask, matte lipstick writes 1.0 at only 35–40 % surface weight, glossy lipstick keeps the skin's roughness (§3). A uniform reflectance over varying normals is the classic "coated" look [hypothesis for the perception; the data difference is observed].
4. **Metallic's plastic read is the SSS switch**, not its roughness: every pixel above 0.1 blended metalness takes unblurred, unscattered diffuse (§6), so skin under the mark reads hard. No roughness value changes that; only metalness ≤ 0.1 (then it is not metallic) does.

### 9.2 "Shimmer reads as a soft gloss"

1. **The mode-1 gate crushes small tilts** [observed arithmetic]. The facet's normal is written at alpha `saturate(50·(1 − cos θ))` and blended as an **encoded** normal, so the stored tilt is about alpha × θ:

   | Facet tilt θ | Mode-1 alpha | Tilt left in the G-buffer (≈) | Highlight moved by (2 × tilt) |
   |---:|---:|---:|---:|
   | 5° | 0.19 | 1.0° | 2° |
   | 8° | 0.49 | 3.9° | 8° |
   | 10° | 0.76 | 7.6° | 15° |
   | ≥ 11.5° | 1 | θ | 2θ |

   The default bake tilts facets up to 15° with a mean alpha of 0.19 ([Shimmer design](finish-designs/shimmer.md)): most facets are 5° or less and survive as 1° ripples that move their highlight by about 2°, which reads as texture in a gloss, not as flashes.
2. **What survives is the base lobe.** Between and under the faded facets, the preset's roughness (≈ 0.42) goes through the skin's two lobes like Satin's: a soft gloss.
3. **Mips fade faster than they average.** The gate reads the filtered z, so at face framing the averaged facets fall under 11.5° and vanish before their slope variance becomes the widened roughness [observed arithmetic; the widening is the export's].

*Shimmer · strong* (tilt up to 23°) moves most facets above the gate and is the right session test. The fix the arithmetic points to is a **tilt floor**: bake every facet between about 12° and 25° so the gate always passes, and give the gaps between facets a roughness at or above the skin's (≈ 0.6) so the flashes read against a non-glossy ground (§10, rank 3).

## 10. Recommended changes, ranked

Decisions on defaults are the maintainer's; each item names what it depends on.

**Before the Gloss, Shimmer and Metal verdict session.** Nothing here invalidates the staged session-2 build: its *Gloss A–D*, *Shimmer · strong* and *Metal ramp* presets are the right controls, and §13 says how to read them. Two findings change what the verdicts can mean: Metallic's hardness is the SSS switch, which no roughness value removes (§9.1 item 4), and Shimmer's facets need to clear the 11.5° gate, which *Shimmer · strong* mostly does and the default does not (§9.2). If the build is redone before the session anyway, ranks 2, 5 and a tilt-floor Shimmer stripe (rank 3) are cheap to add.

1. **Glitter accent (before the glitter board is staged).** Set the accent's `EmissiveEV` above 0: this template multiplies `EmissiveColor` by it (§5.4), so 0 is black. Add to the test card that the accent's opacity is `MaterialModifiersConsts[2].x` × mask, so "no accent at any EV" means the engine does not drive that modifier on a CCXL component, not that the mask is wrong.
2. **Colour-shifting metalness 0.25 → ≤ 0.08.** The tint is added to albedo and needs no metalness; below 0.1 the covered area keeps the skin's SSS instead of turning hard like Metallic, and no seam appears at 40 % coverage. Safe before the verdict session: Colour-shifting is not among the finishes it judges.
3. **Shimmer bake: a tilt floor and a rough ground.** Facets between about 12° and 25° (all through the mode-1 gate), gaps at roughness ≥ 0.6. A new faceted candidate; read *Shimmer · strong* first.
4. **Colour-shifting on `mesh_decal_blendable`.** Same Fresnel term and fade, but squared coverage (the flat compiler's √ encoding), the plate-local UV window (0.13 mm texels instead of 0.56 mm) and per-texel base colour, so a colour-shift preset could hold several pigments sharing one shift colour. A route change with its own board.
5. **Matte 0.88 → 1.0** whatever the *Gloss D* verdict: nothing in the light rewards 0.88 over 1.0, and vanilla matte lipstick writes 1.0.
6. **After the verdict, consider partial surface weight or grain for flat finishes** (item 3 of §9.1): either `RoughnessMetalnessAlpha` below 1 so the skin's roughness variation shows through, as vanilla matte lipstick does, or a fine noise in the surface coverage like vanilla eye makeup's. Only if *Gloss D* still reads "plastic".
7. **Preview**: draw brows' normal (0.4, mode 1) and roughness (≈ 0.50) writes through the face-decal family (already the [eyebrows §5](../../knowledge/brows.md#5-what-the-studio-draws-today) gap), and the double-diffuse gradient clip at intensity 2 (the preview already clamps; keep a test).

## 11. What the browser adapters reproduce

| Step | Adapter | Status |
|---|---|---|
| √-space colour blend, squared coverage, three target alphas, secondary mask, contrast | `face-decal-material.ts` (`decalCoverage`, `decalTargets`), `engine/render/plate-blend.ts` | Faithful; alpha saturated as the blender is assumed to |
| Double-diffuse coverage and colour, gradient clip | `brow-material.ts`, `face-decal-material.ts` (`doubleDiffuseCoverage`) | Faithful; brows draw a fixed roughness 0.8 and no normal (gap) |
| UV transform and `sign·frac` fold | `face-decal-material.ts`; export `plate-uv-window.ts`, verifier `verify/uv-window.ts` | Faithful; flipbook frames not drawn (static makeup uses one) |
| Mode-1 gate and tilt fade | `route-mip-chains.ts` (`previewFacetChains`), `plate-blend.ts` (`MODE1_FULL_TILT`), `plate-composite.ts` | Faithful to the gate; the preview composes in tangent space rather than RNM on the per-pixel skin normal |
| `NormalsBlendingModeAlpha` < 1 | not modelled | Faithful for every XF instance (white) |
| Fresnel colour before √, linear recolour coverage | `engine/render/fresnel-tint.ts`, `plate-blend.ts` | Faithful; `Color` encoding [hypothesis] |
| Gradient-recolour caps | `character-material-adapters.ts` (`hair-cap-decal`) | Linear blend: an approximation of the now-observed √-space arithmetic |
| Emissive, emissive-subsurface, parallax, multitinted, morph, revealed, wet, blackbody | `render-templates.ts` records them as placeholders | Not drawn |
| Discarded dissolve | not modelled | Correct: no draw the Studio renders is dissolving |

## 12. Open questions

1. What drives `MaterialModifiersConsts[2].x` (and `[0].z/.w`, the dissolve) on a CCXL head component? It gates the emissive-subsurface accent and scales the Fresnel fade.
2. Does the blender clamp alpha above 1 (target formats), and are GBuffer1/2 8- or 10-bit (small tilts, √ colour)?
3. Is `t74` refreshed between decal draws?
4. What does the `subsurface_emissive` target feed (added to the SSS input, or to lighting after it)?
5. Does the gradient atlas store its channels with a 2.2 power, as `…_recolor_2`'s 0.45 on alpha suggests?
6. `OFFSET_DecalBias` values and the draw order of two `EMP_Normal` decals (carried from [materials](../../knowledge/materials-and-shaders.md#7-open-questions)).

## 13. In-game test asks (batch into the prepared session)

The decal asks are already on the [session 2 test card](../../experiments/020-session-2/README.md#test-card) (the presets of [experiment 017](../../experiments/017-plate-depth/README.md#in-game-test-card)); this study sharpens how to read them:

- **Gloss (step 5).** If *Gloss A*'s Matte reads no glossier than *Gloss C*, the Matte report was the breakup; if *Gloss D* separates Matte, Satin and Glossy but all still look "coated", §9.1 item 3 (uniform surface) is the next lever, not further roughness.
- **Metal ramp (step 7).** A hard-looking, "plastic" skin under the Metallic stripe in *Gloss A* and *D* alike is the SSS switch at blended metalness 0.1, not a roughness problem; on the ramp it should begin where the blend crosses 0.1 (between the 0.098 and 0.149 steps).
- **Shimmer (step 6).** If the strong stripes flash and the fine stripe does not, the gate explanation holds and the tilt-floor bake (§10 rank 3) is the fix. If neither flashes at close framing, look for DLSS or temporal filtering first ([Glitter in game](../../knowledge/glitter-in-game.md#open-questions)).
- **Glitter board, step E (when staged)**: with the accent's `EmissiveEV` raised, "no points at all, even in the dark" answers open question 1.

Related: [multilayered reference](shader-multilayered.md) · [materials and shaders](../../knowledge/materials-and-shaders.md) · [face makeup](../../knowledge/face-makeup.md) · [eyebrows](../../knowledge/brows.md) · [Glitter in game](../../knowledge/glitter-in-game.md) · [finish designs](finish-designs/README.md) · [mesh-decal contract](mesh-decal-shader-contract.md) · [fact index](shader-fact-index.md).
