# Eye shader reference: `eye.mt`, `eye_gradient.mt` and the wetness shell (game 2.31)

Third per-family reference of the [materials and shader study](../backlog/materials-shader-re.md), after [skin](shader-skin.md) and [hair](shader-hair.md). It gathers what the lab knows about the eye family in one place: the templates and their parameters, the player eye's material chains, texture packing and colour spaces, passes and render stages, the G-buffer program step by step (iris weight and mask, refraction and parallax, both normals, the gradient lookup), the Eye-class light, the wetness shell and its blendable sibling, and the cause of the preview's "waxy eye". The consolidated reading is [eye rendering](../../knowledge/eye-rendering.md) and [materials and shaders §4.2 and §4.4](../../knowledge/materials-and-shaders.md#42-eye-family-eyemt-eye_gradientmt-eye_blendablemt-eye_morphmt); this page is the evidence-level reference behind them. Which Studio code relies on which fact is in the [shader fact index](shader-fact-index.md).

**Labels.** **[observed]**: read directly in a compiled 2.31 program or an installed resource. **[source-supported]**: supported by tool or engine source, the wiki, a community tool, or a close structural match to a published technique. **[hypothesis]**: not established. Nothing here was observed in a running game; compiled-program evidence says what the programs compute, not which variant drew a given frame.

## 1. Pinned inputs

| Input | Identity |
|---|---|
| Game | 2.31 (`GameVersion 2310`) |
| `shader_final.cache` | SHA-256 `339145…3ccfa` (full hash in the [shader-system note](shader-system/README.md#inputs-read-only)) |
| `staticshader_final.cache` | SHA-256 `bff160…59ff` |
| `base\materials\eye.mt` | SHA-256 `c6eff77a…9e801e073e` |
| `base\materials\eye_gradient.mt` | SHA-256 `348ec8d2…4fdb0f36f5` |
| `base\materials\eye_shadow.mt` / `eye_shadow_blendable.mt` | SHA-256 `9b1480fd…9e418ad0` / `0a46a217…acb0e37982` |
| `base\materials\eye_blendable.mt` / `eye_morph.mt` | SHA-256 `4f338b7e…b1b7d93cf` / `18b000e5…e167559` |
| Disassembler / decompilers | Windows SDK 10.0.22621 `dxc -dumpbin`; dxil-spirv `f2d1b554` → SPIRV-Cross `aa217aeb` (GLSL with Vulkan semantics where HLSL output fails on wave intrinsics) |
| Method | [shader-system evidence note](shader-system/README.md#method-repeatable-in-minutes); earlier eye extractions and hashes in the [eye rendering evidence](../character-customization/eye-rendering-evidence.md) and [experiment 014](../../experiments/014-native-eye-gradient/compiled-shader-and-gaze.md). Outputs stay local and ignored |

| Program (MeshSkinned unless noted) | GUID | DXBC SHA-256 |
|---|---|---|
| `eye_gradient` `gbuffer_regular` pixel | `10020572278408962832` | `cf4b1423…e13fff533c7` |
| `eye_gradient` `gbuffer_velbuff_regular` pixel | `776001972724306108` | `3a1b5062…eaece7a4921` |
| `eye` `gbuffer_regular` pixel | `14845425953312192161` | `38cc7fb4…12926f42d3` |
| `eye` / `eye_gradient` `gbuffer_regular` vertex | `18370043470364590642` / `1226803013347725086` | both `6ea44d88…0cf6c21e` (byte-identical) |
| `eye_gradient` technique 4 pixel (editor pick pass) | `14382710511169564885` | `5dc22610…79457b8e26a` |
| `eye_blendable` `gbuffer_regular` pixel (MeshExtSkinned) | `14102086086643381623` | `5900632d…46bbd7a3e96` |
| `eye_morph` `gbuffer_regular` pixel | `14441431176120167924` | `4fdc71d8…6d3c57192f565` |
| `eye_shadow` `transparent_back_face` pixel / vertex | `14043594489545752539` / `10390499172143877202` | `54e65aa4…636266e0` / `f0a0826c…caf2` |
| `eye_shadow_blendable` `transparent_back_face` pixel / vertex (MeshExtSkinned) | `3738476467891587725` / `13188491157672890303` | `bd1fe338…1c96e07e` / `c2c989bf…3177` |
| static `…LightsComputeGlobalLocalShadows_Clustered_11111111` (all-class light) | `6606735909222169407` | `c0ce7b53…dac86` |
| static sun shadow-mask program (identified by content) | `1844879209050928149` | `f9b3e4c3…ed19e` |
| static ambient/integrate pixel program (identified by content) | `10393055107398307099` | `7df07e2d…3649b9` |

SSA numbers below (`%N`) are from that program's `.ll` (valid only in that program); where a decompiled listing is cited, its `_N` are SPIRV-Cross ids.

## 2. The templates

### 2.1 The family

| Template | Class, priority | Vertex factories | What it is [observed] |
|---|---|---|---|
| `eye.mt` | Eye (3), `EMP_Normal`, maskable | MeshStatic, MeshSkinned, MeshExtSkinned | Texture-only eyeball: the 16 creator "texture" eyes and every inspected CCXL eye |
| `eye_gradient.mt` | Eye, `EMP_Normal` | same | `eye.mt` plus `IrisMask` and `IrisColorGradient`: the 18 creator gradient eyes |
| `eye_blendable.mt` | Eye | same | `eye.mt` plus a braindance **Fresnel rim** added to the colour: `+ FresnelColor · 8·w · saturate((1 − N2·V)²)`, `w` a per-vertex fade (`_541`, `_525`–`_527` of `14102086086643381623`). No mask or gradient. Default albedo is an NPC eye |
| `eye_morph.mt` | Eye | + vehicle and garment factories | `eye_gradient` plus a **wipe**: the gradient weight is switched off where `u + v + abs(frac(20u) − ½) + abs(frac(20v) − ½) > 4·MaterialModifiersConsts[2].x` on the iris coordinate (`_562`), a diagonal saw-tooth reveal driven per draw. `Morph_Mask` is not read by the pixel program. Default gradient `eye_red` |
| `blackwall_blendable_eye*.mt` | Eye | + vehicle and garment | Effect variants; `IrisSize` default 0.85 on the texture one |
| `eye_shadow.mt` | Standard (0), **`EMP_Front`** | MeshStatic, MeshSkinned, MeshExtSkinned | The wetness/occlusion shell (§7) |
| `eye_shadow_blendable.mt` | Standard, `EMP_Front` | **MeshStatic, MeshExtSkinned only** | The same pixel program as `eye_shadow` (§7.1) with a braindance glitch/fade on the vertex side |
| `blackwall_blendable_eye_wet.mt` | Standard, `EMP_Front` | + vehicle and garment | `eye_shadow` parameters under a Blackwall name; not decompiled |

The player uses only `eye.mt`, `eye_gradient.mt`, `eye_shadow.mt` and `engine\materials\multilayered.mt` (§3). `eye_blendable` and `eye_morph` confirm the family's arithmetic: they differ from `eye`/`eye_gradient` only in the lines named above.

### 2.2 Parameters

Registers are `eye_gradient.mt`'s; `eye.mt` lacks registers 5 and 6, so every later register is two lower there (`RoughnessScale` 21, `Specularity` 20). All are pixel-stage. Defaults are the template's [observed].

| Reg | Parameter | Type, default | What the G-buffer program does with it |
|---:|---|---|---|
| 0 | `Albedo` | Texture, `white.xbm` | Base colour at the iris coordinate `uvC` (§5.3) |
| 1 | `Normal` | Texture, `he_000_base_n01.xbm` | **Iris normal N2**, RG at `uvC` |
| 2 | `Roughness` | Texture, `he_000_base_rm01.xbm` | **R** only, at the **raw** UV |
| 3 | `Blick` | Cube, `cube_blick_1.cubemap` | Not read by any eye-family or static program |
| 4 | `NormalBubble` | Texture, `normal_bubble.xbm` | Sclera ripple of the **cornea normal N1**, RG at `BubbleNormalTile · (fu, 1 − v)` |
| 5 | `IrisMask` (gradient only) | Texture, `eye_mask.xbm` | **R** position along the gradient row, **A** gradient weight, both at `uvC` |
| 6 | `IrisColorGradient` (gradient only) | Gradient, `default.gradient` | Bound by the engine as a **row index** into a 512-row atlas |
| 7 | `RefractionIndex` | 0.97 | Ratio `n₁/n₂` for HLSL `refract` |
| 8 | `RefractionAmount` | 1 | Scales the parallax depth |
| 9 | `IrisSize` | 0.737374 | Iris-plane millimetres to iris UV |
| 10, 11 | `EyeHorizAngleRight`, `…Left` | 5, −5 | Turn of each eye's optical axis, degrees |
| 12 | `EyeRadius` | 0.0152 | Virtual eyeball radius, metres |
| 13 | `EyeParallaxPlane` | 0.0134 | Iris-plane distance from the eye centre |
| 14 | `BubbleNormalTile` | 0.631313 | Bubble tiling |
| 15–18 | `EggFullRadius`, `EggMarginExponent`, `EggMarginFactor`, `EggSubFactor` | 1, 1, 0.4, 0.2 | Analytic cornea bulge (§5.5) |
| 19, 20 | `IrisCoordFactor`, `IrisCoordMargin` | 0.164983, 0.020202 | The analytic iris disc: full inside radius 0.145, none beyond 0.185 of mesh UV |
| 21 | `BlickScale` | 0.2 | Not read |
| 22 | `Specularity` | 0 | `saturate` → GBuffer2.x (metalness) |
| 23 | `RoughnessScale` | 0.493421 | × `Roughness.R` → GBuffer2.y |
| 24–26 | `SubsurfaceFactor`, `AntiLightbleedValue`, `AntiLightbleedUpOff` | 0.2, 0.5, 0 | Not read |

The inert five (`Blick`, `BlickScale`, `SubsurfaceFactor`, `AntiLightbleed*`) are read by no pixel program of `eye`, `eye_gradient`, `eye_blendable` or `eye_morph` in any pass or factory, and by none of the 845 static programs [observed]. A CPU-side consumer cannot be excluded, but a renderer should not add a baked catch-light cubemap or a subsurface term for them.

### 2.3 Passes and render stages

From the serialized templates [observed]; "flags" is the technique flag word.

| Stage (flags) | Depth | Cull | Pixel | Role |
|---|---|---|---|---|
| `gbuffer_regular` (1), `gbuffer_velbuff_regular` (33) | test `GreaterEqual`, write on (reversed Z), stencil on | back | yes | The eyeball's G-buffer write (§5). The velocity variant is the same arithmetic with the per-eye vectors four registers higher |
| `cascade_regular` (2) | `LessEqual` | back | none | **The eyeball casts sun shadows** |
| `depth` (4) and a pixel-less `gbuffer_regular` (8) | `GreaterEqual` | back | none | Depth prepass variants |
| `gbuffer_regular` (4) with a pixel program | `GreaterEqual` | back | yes | An editor **pick pass**: writes a per-draw ID from `MaterialModifiersConsts` and, inside a screen rectangle, appends pixel, depth and ID to a UAV (`14382710511169564885`, and `13700816098200741565` for the shell). Not a lighting path [observed structure; "editor picking" is the plausible purpose] |
| `velocitybuffer` (32), `highlights` (512), `wireframe*` (16) | | | | Motion vectors, the outline buffer, editor views |
| `eye_shadow` `transparent_back_face` (1) | test `GreaterEqual`, **write off** | **none** | yes | Blend `One / SrcAlpha` (colour and alpha): `out.rgb + dst·alpha` (§7). No cascade pass: the shell casts no shadow |

There is no `skin_translucency` pass in the family. The masked (`_discarded`) twins exist because the templates can be masked; no player eye material enables the mask [observed for the creator eyes].

## 3. Instance chains on the player

```
eyes_color option (71 definitions per body)     ── ArchiveXL remaps the app (knowledge: eye rendering §1)
 └─ he_000_pwa_c__basehead.mesh, meshAppearance <name>, chunk mask …614 (chunk 0, the lashes, hidden)
     chunk 1  <name>          → <colour>_eye_gradient.mi → base\materials\eye_gradient.mt     (1–18)
                              → rebecca_eye_<c>.mi / cybereye_eye.mi / … → base\materials\eye.mt   (50–55, 62–71)
                              → <design>_eye_multilayer.mi → engine\materials\multilayered.mt     (19–49, 56–61)
     chunk 2  eyeWetness_MAT  → eyeshadow_base.mi → base\materials\eye_shadow.mt                   (every colour)
 morph  he_000_pwa__morphs.morphtarget (ArchiveXL: …_morphs_normal_fix copy)
```

All [observed, resource] ([eye rendering evidence](../character-customization/eye-rendering-evidence.md#observations-recorded-here-in-detail)). The male mesh swaps chunks 1 and 2, so a renderer takes a chunk's role from its template.

**What each level sets** [observed]:

- **Gradient eyes** (one `.mi` straight over the template): `Albedo` (`he_000_base_d02`, or `d11` for the bloodshot set), `IrisColorGradient` (one of nine profiles) and, on 16 of 18, `BlickScale` 0.1 (inert). Everything else, including every optical scalar, `Normal`, `Roughness`, `NormalBubble` and `IrisMask`, is the template default.
- **Texture eyes**: `Albedo`, usually `Normal` (`he_000_rebecca_n01`, `he_000_circle_n01`, or the flat `engine\textures\editor\normal.xbm` on the cyber, double, ring and stand-clear designs), sometimes `Roughness` (`he_000_cybereye_r01`, `he_000_double_eye_r01` or `grey.xbm`). The two circle designs set `EyeHorizAngleRight/Left` to ±3.6; `ring_orange_eye` also flattens `NormalBubble`.
- **Shell**: `eyeshadow_base.mi` sets `Mask` `eye_shadow_mask.xbm`, `ShadowColor` (125, 58, 58), `Intensity` 0.7, `Exponent` 0.8; `WetnessRoughness` 1 and `WetnessStrength` 4 stay at the template's.
- **CCXL eyes** (every installed pack): an `@eyes` template entry or per-colour entry → `eye_base.mi` or a soft `.mi` → `eye.mt`, with soft or fixed texture paths. No inspected mod changes the shell, the gradients or a template [observed; resolver rules in [eye rendering §5](../../knowledge/eye-rendering.md#5-mod-eyes-how-ccxl-eyes-plug-in)].
- **The morph can override `Normal`.** The vanilla eye morph names `engine\textures\editor\normal.xbm` for `Normal`; ArchiveXL's fix copy clears that. So without ArchiveXL every player eye's iris normal N2 would be flat, and with it the material's own map applies [hypothesis on the binding; [eye rendering §1.3](../../knowledge/eye-rendering.md#13-the-morph-resource-can-replace-the-eyes-normal-map)]. A flat N2 is the same as the flat-normal designs above: the iris then takes its diffuse from the smooth sphere.

## 4. Texture packing and colour spaces

| Texture | XBM setup | Channels the program reads | Sampled at | Evidence |
|---|---|---|---|---|
| `Albedo` (`he_000_base_d02`, `d11`, texture-eye `_d01`s) | `TCM_QualityColor`, `isGamma` 1 | RGB | `uvC` | [observed] |
| `Normal` (`he_000_base_n01`) | `TCM_Normalmap`, `isGamma` 0, B stored 0 | **RG**, `z = √max(0, 1 − x² − y²)`, no Y flip | `uvC` | [observed] |
| `Normal` (`he_000_rebecca_n01`) | **`TCM_QualityColor`, `isGamma` 1**, stored flat 128/128/255 | RG as above | `uvC` | [observed]; see the gotcha below |
| `Roughness` (`he_000_base_rm01`) | `TCM_DXTNoAlpha`, `isGamma` 0 | **R** only: ≈ 80/255 over iris and pupil, ≈ 26/255 on the sclera, so 0.155 and 0.050 after `RoughnessScale` | raw UV, wrapping | [observed] |
| `NormalBubble` (`normal_bubble`) | `TCM_Normalmap`, `isGamma` 0 | RG, ±1.5° ripple | `0.6313 · (fu, 1 − v)` | [observed] |
| `IrisMask` (`eye_mask`) | **`TCM_QualityColor`, `isGamma` 1** | **R** gradient position (0 in the pupil, 0.19–0.55 in the iris, median 0.35 raw), **A** gradient weight (1 over UV radius 0.06–0.15, 0 by 0.18) | `uvC` | [observed] |
| gradient atlas (engine `t55`, sampler `s10`) | runtime, 512 rows | RGB at `(mask.R, (row + 0.5)/512)` | — | [observed read side] |
| `Mask` (`eye_shadow_mask`, shell) | `TCM_QualityColor`, `isGamma` **0** | **R** occlusion, **G** wet roughness (≈ 106/255), **B** tear line (up to 44/255); A unread | the shell's raw UV0 | [observed] |

All material textures are read through one sampler (`s0`) with implicit LOD [observed]; its filter and address states are set at run time and are not in the program. The eye UVs span several tiles, so the sampler must repeat.

**Gotchas:**

- **Two gamma-flagged data textures.** If the engine samples `isGamma` textures sRGB-decoded (the rule the skin adapter follows), then (a) the iris mask's R median 0.35 becomes 0.10, which would make gradient red near-black and light blue dark slate ([eye rendering §2.3](../../knowledge/eye-rendering.md#23-the-gradient-coordinate-raw-or-decoded)); and (b) the Rebecca normal's flat 128 becomes 0.216, an RG of (−0.57, −0.57): **a 54° tilt of the iris normal over the whole eye, sclera included**. Since N2 drives the eye's diffuse, the specular horizon and the sun-shadow cut (§6), that would shade all six Rebecca eyes lopsidedly under any directional light. Both resources argue that these textures reach the program raw, or that the engine does not create an sRGB view for them [hypothesis, now supported by two independent resources; runtime settles it: §12].
- **Roughness is not refracted and not flipped.** It belongs to the surface (cornea and sclera), while colour, normal and mask belong to the iris plane under it. An asymmetric roughness map therefore appears upside down relative to the albedo, and its iris region does not slide with the parallax [observed].
- **The Blender add-on samples eye roughness G** [source-supported]; the program reads R. Three.js's `roughnessMap` also reads G.

## 5. The G-buffer program, step by step

Program `10020572278408962832` (`eye_gradient`); `eye` (`14845425953312192161`) is the same without the mask and gradient lines. All steps [observed] unless marked; the formulas were checked line by line against the decompiled listing for this reference. Inputs from the vertex program: raw UV0 (not folded), world normal N, bitangent B, tangent T, world position; the pixel program adds the camera position (`CameraShaderConsts[36]`) and two per-eye vectors per side from `MaterialModifiersConsts`.

### 5.1 Side and fold

```hlsl
right = u > 0;                               // "Right" parameters, MaterialModifiersConsts[2], [3]
fu    = u + (u > 0 ? -1 : 1);                // folded U, pupil at 0.5 on both eyes
```

The pupil vertices sit at U 1.5 (`l_J_eye_JNT`, the character's **left** eye) and −0.5 (`r_J_eye_JNT`) [observed, resource]. So the template's **"Right" parameters (`EyeHorizAngleRight`, registers 2/3) drive the character's left eye**: "right" is the viewer's side when facing V [observed by combining the two].

The per-eye vector registers move with the variant: 2/3 and 6/7 in `gbuffer_regular`, 6/7 and 10/11 in the velocity variant, 3/4 and 7/8 in `eye_blendable` [observed]. They are slots in a per-draw modifier buffer that other modifiers (velocity, braindance fade) shift, which fits an engine-side per-eye modifier; that they carry each eye joint's frame is [hypothesis] (§11).

### 5.2 Two different "iris" regions

- **The analytic iris weight** `iris = saturate(1 − (r − (IrisCoordFactor − IrisCoordMargin)) / (2·IrisCoordMargin))`, `r = |(fu − 0.5, 0.5 − v)|` in **mesh UV**: 1 inside r 0.145, 0 beyond 0.185. It chooses where the refracted coordinate and the cornea bulge apply.
- **The mask** `IrisMask.A`, sampled at the **refracted** coordinate: where the gradient colour replaces the albedo (the ring 0.06–0.15, fading by 0.18).

So on a gradient eye the colour boundary is the mask's, drawn inside a disc whose geometry comes from the scalars. A texture eye has only the analytic disc.

### 5.3 Eye frame, refraction and parallax

```hlsl
a   = -EyeHorizAngle[side] * PI/180;
A   = cos(a)*Mod[3 or 7] + sin(a)*Mod[2 or 6];      // optical axis; with a = 0 it is Mod[3/7]
T2  = normalize(T - dot(T,A)*A);  S = cross(T2, A);   // eye frame {T2, A, S}
I   = normalize(P - camera);
R   = refract(I in frame, N in frame, RefractionIndex);   // 0 on total internal reflection
h   = max(0, EyeRadius*dot(N,A) - EyeParallaxPlane);       // height above the iris plane
t   = RefractionAmount * h / max(1e-4, |R.y|);
X   = R.x*t + EyeRadius*dot(N,T2);   Y = R.z*t + EyeRadius*dot(N,S);
uvC = lerp((fu, 1 - v), 0.5 + (X, Y)*IrisSize/(2*EyeRadius), iris);
```

What the numbers mean [observed arithmetic; magnitudes computed from the vanilla scalars and the measured eyeball]:

- **The surface is virtual.** Position on the eye comes from the vertex **normal** times `EyeRadius` (15.2 mm), not from the mesh position (a plain 13.7 mm sphere with no cornea bulge). The iris plane lies 13.4 mm from the centre, 1.8 mm under the virtual apex; the parallax height reaches zero at about UV radius 0.18.
- **The iris is a remap, not a texture on the sphere.** At a straight view the limbus (mesh UV radius 0.165) lands at iris UV 0.151: the iris texture is drawn about 9 % larger than the mesh UV would draw it. That comes from the `IrisSize/(2·EyeRadius)` scale, not from bending: the refraction shifts that point by 6 µm.
- **The "refraction" is almost pure parallax.** `RefractionIndex` 0.97 is `n₁/n₂`, an inner index of about 1.03 (a real cornea is about 1.38). At a 30° view the ray bends by about 1° (29.0° inside), so the iris under the pupil shifts by 1.0 mm, 0.024 iris UV, a sixth of the iris radius; with no refraction at all it would shift 1.04 mm. A renderer can treat the effect as parallax to within 4 % [observed arithmetic].
- **The ±5° turn** rotates each eye's axis about the lateral vector before the frame is built, shifting the iris sideways by about 0.03 UV if its sign is wrong. The direction depends on the sign of the engine's lateral vector [hypothesis; [eye rendering test ask 10](../../knowledge/head-cc-rendering.md#in-game-test-asks)]. On the exported female eye mesh each pupil's normal points 3.59° outward of the two pupils' mean direction [observed, resource], which is the circle designs' ±3.6: with an outward turn their axis lands on the pupil.
- **`S = T2 × A` runs against the mesh's V.** With A pointing out of the eye, {T2, S} seen from outside is a mirrored frame, while the mesh's (fold(u), 1 − v) is not: on the exported mesh the straight-view iris coordinate correlates +0.999 with fold(u) and −0.999 with 1 − v, so taken literally the iris is drawn mirrored in V against the sclera, and across the iris-weight blend the coordinate sweeps through the pupil (dark arcs at the top and bottom of the iris) [observed arithmetic on the exported frame]. The CCXL eye guide's in-game image shows an iris drawn the same way up as the rest of the eye [wiki: `ccxl-eye-textures.md`, `inverted_y_03.png`], so the engine's inputs must differ from the exported frame by a reflection here (the per-eye vectors, the tangent stream) [hypothesis for the cause]. The preview orients S along the mesh's bitangent (§10).

### 5.4 Iris normal N2

`N2 = normalize(x·T + y·B + z·N)` from `Normal(uvC)` RG with reconstructed z: the relief follows the refracted coordinate, so it belongs to the iris plane. The vanilla map has a mean tilt of 50–60° inside the iris and under 3° on the sclera [observed, resource]. Flat-normal designs (and a flat morph override) make N2 the sphere normal.

### 5.5 Cornea normal N1

```hlsl
s = EggFullRadius*EggSubFactor;  q = (fu - 0.5, 0.5 - v, s);
e = |q| < EggFullRadius ? normalize(q*(EggFullRadius/|q|) - q) + (0, 0, 0.5) : (0, 0, 1.5);   // z += 0.5 after normalising
e.xy *= pow(saturate(1 - EggMarginFactor*r/sqrt(EggFullRadius² - s²)), EggMarginExponent);
bubble = NormalBubble(BubbleNormalTile*(fu, 1 - v)).RG → (x, y, √(1 − x² − y²));
N1 = TBN * normalize(lerp(normalize(e), bubble, 1 - iris));
```

With the vanilla scalars the bulge normal is the direction of `(du, dv, 0.2)`, tilted back towards the pole by the `+0.5` and the margin: 0° at the pupil, about 25° at the limbus, on top of the sphere normal [observed arithmetic]. That is a cornea more curved than the eyeball, as in a real eye, so the catch light concentrates over the iris. Outside the disc, N1 is the sphere normal with the ±1.5° bubble ripple.

### 5.6 Colour and the gradient lookup

```hlsl
albedo = Albedo(uvC).rgb;                                  // sRGB-decoded (isGamma 1)
m      = IrisMask(uvC);
g      = t55.Sample(s10, float2(m.r, (IrisColorGradient + 0.5) / 512)).rgb;
base   = lerp(albedo, g, m.a);                             // in linear light
GBuffer0.rgb = sqrt(base);
```

**Gradient interpolation.** The program holds no stops and no interpolation loop: one hardware sample of a runtime atlas (`t55`, 512 rows) at the mask's R, on the row centre the engine binds for `IrisColorGradient` [observed]. Unlike the hair profile row, there is no sample-count texel or sample-index arithmetic: R addresses the row directly across its width [observed]. No static program builds gradients (the static index has no gradient technique besides RTXDI's), so the atlas is filled on the CPU [source-supported by absence]. Its width, texel format, colour space, stop interpolation and the `s10` filter are not in any shader [hypothesis]. The row is sampled at its centre, so a bilinear filter mixes along the row only.

`CGradient` stops are `{value, RGBA bytes}` [observed]. The Studio bakes the 8-bit stops interpolated linearly, clamped beyond the end stops, then decoded from sRGB by the sampler (the hair-profile model) [hypothesis; test ask 9].

### 5.7 Roughness and metalness

`GBuffer2.y = RoughnessScale · Roughness(u, v).R` (raw UV, not saturated; the light clamps to [0.04, 1]); `GBuffer2.x = saturate(Specularity)`, 0 in every vanilla and inspected mod material [observed].

### 5.8 Outputs

| Target | Written |
|---|---|
| GBuffer0 | rgb `sqrt(base)`; a = low 2 bits of N2's octahedral x |
| GBuffer1 | rgb **N1** (the cornea normal), `n / max(abs(n)) · 0.5 + 0.5`; a = low 2 bits of N2's octahedral y |
| GBuffer2 | x `saturate(Specularity)`; y roughness; z, w = high 8 bits of N2's 10-bit octahedral x and y |

Back faces reflect both normals about N (irrelevant under back-face culling). The class (3) sits in the stencil. The octahedral mapping is the standard one [source-supported: Cigolle et al. 2014].

## 6. Lighting: the Eye class

### 6.1 Direct light

The eye has its own BRDF in every clustered light variant that includes class 3; there is no Eye-only variant [observed; re-read for this reference in the decompiled `6606735909222169407`, sun `case 3u`]:

| Term | Eye class | Standard class, for contrast |
|---|---|---|
| Albedo | `GBuffer0²`, no boost | same |
| Diffuse | **Lambert on N2**: `albedo·(1 − m)² / π · C · saturate(N2·L)` | Burley on the one normal |
| Specular D | GGX on **N1**, α = r², r clamped to [0.04, 1] | same |
| Visibility | `0.25 / ((N1·V + N2·L)(1 − α/2) + α)`: a sum form, half a Standard lobe at normal incidence | height-correlated Smith |
| Fresnel | `F0 + (1 − F0)·2^((−5.55473·V·H − 6.98316)·V·H)` [the spherical-Gaussian Schlick approximation, source-supported: Karis 2013] | pow-5 Schlick |
| N·L on specular | **none**; the horizon enters only through N2·L in the visibility | yes, and a clamp at 100 |
| Sun | a point direction, no disk | a disk (representative point) |
| Specular scale | × `cb13[4].rgb` | same register |
| Local lights | the same BRDF per light; area and tube lights take their representative point from the reflection about N1; per-light roughness offset as for Standard [observed earlier, [eye rendering §3](../../knowledge/eye-rendering.md#3-how-the-deferred-light-shades-the-eye-class)] | Burley, Smith, pow 5 |

Consequences: the iris is a **matte, relief-lit disc** (Lambert on a steep normal), the cornea and sclera carry **all specular** as a smooth, sharp surface (roughness 0.155 over the iris, 0.050 on the sclera), and where the iris relief turns away from the light the cornea highlight **grows** (the visibility denominator shrinks) rather than fading, until the sun's shadow cut at `N2·L ≈ 0` removes it (§6.2) [observed arithmetic].

### 6.2 Shadows

- The sun's shadow mask is **zeroed where `sunDir·N2 < 1e-4`** (class 3 decodes N2; every other class except Foliage uses its GBuffer1 normal), which removes both the diffuse and the cornea highlight there [observed, `1844879209050928149` `%137`–`%145`].
- The eyeball casts cascade shadows; the shell does not (§2.3).

### 6.3 Ambient (probes)

In the ambient/integrate pass `10393055107398307099` [observed]:

- Diffuse and specular ambient both use **N1**; N2 is decoded but not used (the only N2-like read in that pass is the hair tangent).
- The occlusion terms are forced to 1 for Eye pixels when the integer flag `cb6[9].z` is zero (`%516`–`%520`; the select is `_1586` in the SPIRV-Cross listing): eyes then take **no ambient occlusion**.
- **New in this study:** the pass's whole indirect result for an Eye pixel is multiplied by **`1 + cb6[9].w`** (`%1298`–`%1305`: class-3 flag × `cb6[9].w` + 1, applied to all three channels). No other class gets it.

The character render options `Editor/Characters/Eyes` `UseAOOnEyes` and `DiffuseBoost` (vanilla 0.1) [community, Character Rendering Editor] match these two registers by role: `UseAOOnEyes` ↔ `cb6[9].z`, `DiffuseBoost` ↔ `cb6[9].w`, an eye ambient of 1.1× in vanilla [hypothesis for the pairing]. Nothing in the direct light boosts the eye.

### 6.4 What the eye does not get

- **No subsurface scattering.** The SSS setup, blur and combine act only on class-1 pixels (`(stencil & ~31) == 32`, taps only on class 1) [observed, [skin §6.2–6.3](shader-skin.md#62-setup)]. Eye pixels are lit once, by the deferred light and the ambient pass. This answers the earlier open question whether the blur skips eyes.
- **No transmission term**: the light forces the GBuffer2.z weight to 0 for class 3 [observed].
- **No rain wetness**: the eye program reads no wetness registers (unlike skin §5.7) [observed]. Wet eyes come only from the shell.

## 7. The wetness shell (`eye_shadow.mt`)

A second sheet just outside each eyeball (0–0.8 mm, median 0.2 mm), covering the eye opening and following the lids [observed, resource]. It is not cosmetic eyeshadow. Program `14043594489545752539` [observed; formulas re-checked against the decompiled listing]:

```hlsl
m      = Mask(uv0);                                    // raw UV, linear texture
shadow = saturate(Intensity * pow(m.r, Exponent));      // 0.7·R^0.8 in vanilla
lum    = dot(pow(ShadowColor.rgb, 2.2), 0.33);          // ShadowColor as passed (bytes/255): 0.094 in vanilla
alpha  = saturate(1 + fogT * shadow * (lum - 1));       // fogT: volumetric-fog transmittance at the pixel (t38), 1 without fog
rw     = clamp(WetnessRoughness * m.g, 0.04, 1);        // 0.42 in vanilla
spec   = Σ lights D_GGX(Nv·H, rw) · Vis_eye(rw) · C · shadowing;   // vertex normal, no Fresnel, no N·L
out    = float4(min(spec * exposure * WetnessStrength * m.b, 65000), alpha);   // final = out.rgb + dst·alpha
```

- The probe term is compiled as `exp2(log2(0)·4)`, i.e. **zero**: the shell adds no environment reflection [observed].
- Only the mean of `ShadowColor` after the program's own 2.2 power matters, so the darkening is **neutral grey** (to 37 % at a full mask in vanilla). That the program applies its own 2.2 suggests `Color` parameters arrive as bytes/255 [source-supported inference; [materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions)].
- Drawn after lighting in `transparent_back_face`, depth test on, depth write off, both sides, `EMP_Front`.

### 7.1 `eye_shadow_blendable.mt`

Its pixel program `3738476467891587725` is **instruction-for-instruction the `eye_shadow` program** (the lifted bodies differ in no line); `FresnelColor`, `FresnelColorIntensity` and `FresnelExponent` are declared but read by no program [observed]. The difference is on the vertex side (`13188491157672890303`): a braindance glitch that offsets vertices by `VectorField` noise with `GlitchChance`/`GlitchOffset`, and a fade by `FadeOutDistance`/`FadeOutOffset` [observed]. It has **no MeshSkinned compilation**, so it cannot draw on the player's skinned eye mesh [observed].

### 7.2 The shell as a gloss layer

The shell is the only stock forward pass that adds a second specular lobe over already-lit pixels ([materials §2.3](../../knowledge/materials-and-shaders.md#23-the-deferred-lighting-model)). With `Intensity` 0 it is a pure additive highlight: GGX at `WetnessRoughness·Mask.G`, strength `WetnessStrength·Mask.B`, no Fresnel, no environment, lit by the direct lights only. For a glossy-makeup shell (materials open question 6) the limits are now plain [observed]: it needs a MeshSkinned mesh (so `eye_shadow`, not the blendable), it never reflects the environment (a wet look shows only under direct lights), and it draws at `EMP_Front` without writing depth.

## 8. Render order in one frame

1. Depth prepass and cascades: the eyeball writes depth and shadow; the shell writes neither.
2. G-buffer: the eyeball writes class 3, both normals and roughness; face decals (`post_gbuffer`) blend over the skin afterwards.
3. Deferred light (§6.1) and the ambient pass (§6.3); SSS runs on skin pixels only.
4. Forward transparent: the shell multiplies what is behind it by `alpha` and adds its highlight.

[Observed for the stages and states; the exact frame sequence is the engine's usual deferred order, source-supported.]

## 9. The "waxy eye" preview artefact

**What was reported.** On 24 September 2026 the saved V's eyes looked waxy in the Studio preview ([optics audit](../eye-artistry/eye-lip-optics-audit.md)). The eyeball was then one stock `MeshStandardMaterial`: flat roughness 0.18, albedo at the raw UV (upside down against the game), no normal map, no shell, a `RoomEnvironment` plus two directional lights. Switching in the source roughness map (R × `RoughnessScale`) alone **did not** cure it ([roughness study](../eye-artistry/eye-roughness-preview.md)).

**Term by term** [observed for the game column and the preview code; the visual attribution is a hypothesis]:

| Term | Game | Preview then | Preview now (`eye-material.ts`, ranks 4–5) |
|---|---|---|---|
| Iris diffuse normal | **N2**, relief 50–60° | sphere normal | **N2** at the refracted coordinate |
| Specular normal | **N1**: bulge up to +25° at the limbus, bubble on the sclera | sphere | **N1** |
| Roughness | sclera **0.050**, iris 0.155 (α 0.0025 and 0.024) | 0.18 everywhere (α 0.032) | the source map by default; flat 0.18 is the switch's off |
| Specular energy at normal incidence | eye visibility 0.125, no N·L | Smith 0.25 × N·L | eye visibility, no N·L (half the energy at equal roughness, measured on the GPU) |
| Iris depth | parallax 1.8 mm under the cornea | painted on the sphere | the refracted iris coordinate |
| Corner occlusion, tear line | the shell | none | the shell (built) |
| Ambient | probes on N1 at the pixel's roughness, × (1 + `cb6[9].w`) | IBL on the sphere at 0.18 | IBL on N1 at the pixel's roughness, × 1.1 |
| Subsurface | none | none | none |

**Reading** [hypothesis, ranked]:

1. **A detail-free iris.** The iris's diffuse is lit on the smooth sphere, so its fibres never shade: it reads as a uniformly lit, painted layer. In the game the iris is lit only through its steep relief normal, which gives it contrast and makes it change with the light. The roughness-only trial leaving the look unchanged points here first.
2. **A soft sheen over a near-mirror.** At 0.18 the sclera's lobe is about 13 times wider in α than the game's 0.05, and twice as bright, so the preview spreads a milky sheen where the game shows a crisp, small catch light on a glassy sclera and cornea. "Waxy" is **too rough, not too glossy**: the preview's eye is less glossy than the game's, while its highlight carries more energy.
3. **No depth.** Without the parallax the iris sits on the surface instead of 1.8 mm under a clear cornea.

The earlier rendering order (upside-down albedo, no shell) is fixed; the shell removes the "stuck-on" look but not the three terms above. **Not an SSS problem:** the eye is outside the SSS passes, so a subsurface wrap or blur on the eye would move the preview away from the game.

**Fix path.** Ranks 4 and 5 of the [eye plan](../../knowledge/eye-rendering.md#65-ranked-plan-visual-gain-per-effort), in one change: the two-normal Eye light with the map's own roughness on by default, then the refracted coordinate. Built on 27 September ([eye rendering §6.6](../../knowledge/eye-rendering.md#66-implementation-status), with its before/after captures and GPU measurements); head CC test asks 10–12 in game remain the verification.

## 10. What the browser adapter reproduces

`projects/xf-studio/authoring/src/eye-material.ts`, wired by `character-material-adapters.ts` and `render-templates.ts` [observed by comparing the adapter with the decompiled programs]:

| Step | Adapter | Status |
|---|---|---|
| Side by raw U, fold, V-flip for colour/normal/mask, raw UV for roughness, fold with raw derivatives | `EYE_SURFACE`, `eyeSampleCoordinates` | Faithful |
| Gradient: mask R (raw by default) → ramp, blend by mask A in linear light | `XFS_EYE_GRADIENT`, `bakeGradientRamp`, `irisBaseColour` | Faithful to the read side; bake and mask encoding [hypothesis] |
| Roughness R × `RoughnessScale`, metalness `Specularity` | `roughnessmap_fragment` patch | Faithful; **on by default** (off: the earlier flat 0.18) |
| Analytic iris weight, refracted `uvC`, per-eye axis and ±5° | `EYE_SURFACE`, `xfsEyeIrisPlane`; per-eye vectors from the eyeball geometry (`eyeAxes`), skinned per vertex | Faithful arithmetic; the vectors' source and the outward turn [hypothesis]; S oriented along the mesh's bitangent (`IRIS_PLANE_ORIENTATION`, §5.3) |
| N2 and N1 (relief and cornea bulge + bubble) | `EYE_SURFACE`, `xfsEyeCornea`; a gamma-flagged `Normal` follows `IRIS_MASK_ENCODING` | Faithful |
| Eye-class light (Lambert on N2, GGX on N1, eye visibility, exp2 Fresnel, no N·L, sun cut on N2) | `RE_Direct_XfsEye`, `xfsEyeBRDF`; the cut on Three's sun and directional lights | Faithful (the Studio stage's directional lights stand for the sun) |
| Ambient on N1, no AO when the flag is off, × 1.1 | Three's IBL and probes on N1 at the pixel's roughness, × `1 + EYE_AMBIENT_BOOST` | Approximation (Three's IBL for the probes; the 0.1 [hypothesis]) |
| Shell: shadow, neutral darkening, wet GGX, no Fresnel, no environment, `One/SrcAlpha` | `createEyeShellMaterial` | Faithful (fog omitted: none in the studio) |
| Multilayer eyes | `layered-material.ts` | Separate adapter; no refraction, like the game |
| Not in SSS, no wetness | No wrap on eyes | Faithful |

**Browser follow-ups this study suggests** (separate reviewable changes with before/after evidence, per the backlog):

1. Done (27 September): ranks 4–5 together, the source roughness on by default, the gamma-flagged `Normal` on the mask's switch, and the eye-only ambient factor of 1 + 0.1 labelled with its hypothesis ([eye rendering §6.6](../../knowledge/eye-rendering.md#66-implementation-status)).

## 11. Open questions

1. `IrisMask` R and gamma-flagged normals: raw or sRGB-decoded (§4)? More generally, does `isGamma` on a `TCM_QualityColor` texture always produce sRGB sampling?
2. What exactly are the per-eye modifier vectors (the eye joints' forward and lateral axes, a look-at frame, something else), and which way does the ±5° turn? Which engine input makes the iris plane follow the mesh's orientation where the exported frame mirrors it (§5.3)?
3. How is the gradient atlas built (row width, stop interpolation space, format, `s10` filtering)? Is its row index shared with any other gradient consumer?
4. Is `cb6[9].w` the `DiffuseBoost` option and `cb6[9].z` `UseAOOnEyes` (§6.3)? What is `cb13[4]`?
5. Does the morph `baseTexture` really replace `Normal` at run time ([eye rendering §1.3](../../knowledge/eye-rendering.md#13-the-morph-resource-can-replace-the-eyes-normal-map))?
6. `eye_blendable`'s fade `w` and `eye_morph`'s wipe driver: which engine systems set them (not needed for V).

## 12. In-game test asks (batch into the prepared session)

The eye asks are head CC test asks 9–12 ([head CC rendering](../../knowledge/head-cc-rendering.md#in-game-test-asks)). This study adds one frame to ask 9:

- **Rebecca normal.** Creator eyes page, option 54 (Rebecca blue) beside gradient blue, one frame with the key light from the side. If the Rebecca eye's sclera shades lopsidedly (one side much darker than the gradient eye's) or loses its catch light on one side, gamma-flagged textures are decoded; if both shade alike, they are read raw. It must agree with the iris-colour result of ask 9.

Ask 10 now also takes the iris's orientation and depth (§5.3): see [head CC rendering](../../knowledge/head-cc-rendering.md#in-game-test-asks).

Related: [eye rendering](../../knowledge/eye-rendering.md) · [materials and shaders](../../knowledge/materials-and-shaders.md) · [eye rendering evidence](../character-customization/eye-rendering-evidence.md) · [experiment 014](../../experiments/014-native-eye-gradient/compiled-shader-and-gaze.md) · [optics audit](../eye-artistry/eye-lip-optics-audit.md) · [skin reference](shader-skin.md) · [hair reference](shader-hair.md) · [fact index](shader-fact-index.md).
