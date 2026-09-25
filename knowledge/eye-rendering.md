# Eye rendering (V's eyes, game 2.31)

**Maturity: Draft.** Ranks 1–3 of the plan are built (§6.6). Consolidated on 25 September 2026 from the vanilla 2.31 eye resources (female first, male where cheap), the decompiled eye G-buffer, wetness-shell and deferred-lighting programs, the installed CCXL eye mods of the reference MO2 profile, and ArchiveXL 1.27.3. No claim here has runtime evidence. Grades follow the [knowledge rules](README.md): **[source]** (engine, framework or decompiled program), **[resource]**, **[wiki]** (Modding Docs at `be2f44ee`), **[runtime]**, **[hypothesis]**. Program GUIDs, SSA ranges, hashes and the extraction method are in the [eye rendering evidence](../research/character-customization/eye-rendering-evidence.md).

This page is rank 4 of the [head render plan](head-cc-rendering.md#6-render-plan-ranked-by-visual-gain-per-effort): the iris gradient, all 71 eye colours and the wetness shell. It answers which resources a V's eyes resolve to, what the game's programs do with them, how CCXL eye mods plug in, and how the Studio preview should reproduce it. [Materials and shaders](materials-and-shaders.md) holds the G-buffer and template background; the [CC file chain](cc-file-chain.md) holds the resolver rules.

## 1. What an eye choice resolves to

```
eyes_color option (71 definitions per body)            ── ArchiveXL fix: he_000__basehead.app → archive_xl\…\he_000_p?a__basehead.app
 └─ .app definition he_000_pwa__basehead__NN_<name>
     └─ entMorphTargetSkinnedMeshComponent he_000_pwa__basehead
         morph   he_000_pwa__morphs.morphtarget (21 `eyes` targets)     ── with ArchiveXL: …_morphs_normal_fix copy
         mesh    he_000_pwa_c__basehead.mesh, meshAppearance <name>, chunkMask …614 (chunk 0 hidden)
             chunk 0  eyelashes_MAT   hair.mt           (hidden here; drawn by the lash option)
             chunk 1  <name>          eye / eye_gradient / multilayered   ← "eye"
             chunk 2  eyeWetness_MAT  eye_shadow.mt via eyeshadow_base.mi ← "wetness shell"
```

[resource] Male meshes swap chunks 1 and 2 (male chunk 1 = wetness, chunk 2 = eye), so a renderer takes a chunk's role from its template, never its index. The female eye chunk holds both eyeballs (668 vertices, 334 per eye); the shell has 152 vertices and 240 triangles.

### 1.1 The 71 colours are three different materials

| Group (creator index) | Count | Template (lighting class) | What varies | Shared inputs |
|---|---|---|---|---|
| Gradient (1–9) and blood gradient (10–18) | 18 | `eye_gradient.mt` (Eye) | `IrisColorGradient` = one of 9 profiles (`eye_black`, `blue`, `blue_light`, `brown`, `green`, `grey`, `red`, `violet`, `yellow`); `Albedo` = `he_000_base_d02` (clear sclera) or `d11` (bloodshot) | Template defaults for everything else: `Normal` `he_000_base_n01`, `Roughness` `he_000_base_rm01`, `NormalBubble` `normal_bubble`, `IrisMask` `eye_mask` |
| Texture-only (50–55 Rebecca; 62–71 cyber eye, double eye, ring, stand clear, circle) | 16 | `eye.mt` (Eye) | `Albedo`, often `Normal` (`he_000_rebecca_n01`, `he_000_circle_n01` or flat `normal.xbm`) and `Roughness`; the two circle designs set the horizontal angles to ±3.6 | as above |
| Multilayer (19–49, 56–61) | 37 | `engine\materials\multilayered.mt` (**Standard**) | a 20-layer `.mlsetup` (plastic and nylon layer templates) over one of three `eye_ml*.mlmask` | no iris refraction, no gradient, no second normal |

All [resource]. Every vanilla eye material sets the same optical scalars: `RefractionIndex` 0.97, `RefractionAmount` 1, `IrisSize` 0.7374, `EyeRadius` 0.0152, `EyeParallaxPlane` 0.0134, `EyeHorizAngleRight/Left` +5/−5, `BubbleNormalTile` 0.6313, `Egg*` 1/1/0.4/0.2, `IrisCoordFactor` 0.1650, `IrisCoordMargin` 0.0202, `Specularity` 0, `RoughnessScale` 0.4934. Gradient materials set `BlickScale` 0.1, but no program reads it (§2.4). The full 71-row table is in the evidence note.

**Gradient profiles** are 3-stop `CGradient`s [resource]. The six "classic" ones share a shape: dark grey (22,22,22) at 0, the colour at 0.786, white at 1 (brown (129,98,78), blue (107,148,202), light blue (130,192,229), green (118,168,88), grey (138,138,138), violet (169,126,213), yellow (151,125,3)). `eye_black` puts (81,81,81) at 0.594. `eye_red` is different: (22,8,0) at 0.207, (216,0,4) at 0.298, (255,135,0) at 0.576. Thirteen further profiles in the folder are used only by NPC materials.

**The wetness chunk is one material for every colour**: `eyeshadow_base.mi` → `eye_shadow.mt`, `Mask` `eye_shadow_mask.xbm`, `ShadowColor` (125,58,58), `Intensity` 0.7, `Exponent` 0.8, with the template defaults `WetnessRoughness` 1 and `WetnessStrength` 4 [resource]. No installed mod changes it.

### 1.2 Texture facts that change the arithmetic

| Texture | Channels as used | `isGamma` | Grade |
|---|---|---|---|
| `he_000_base_d02` / `d11` (Albedo) | RGB colour; a painted pupil (≈ black), iris and sclera in one 512² tile | 1 | [resource] |
| `eye_mask` (IrisMask) | **R** = gradient coordinate, 0 in the pupil, about 0.19–0.55 in the iris (median 0.35), 0 on the sclera; **A** = iris coverage (0 in the pupil, 1 in the iris ring r ≈ 0.06–0.15 of UV, fading to 0 by 0.18) | **1** (see §2.3) | [resource] |
| `he_000_base_n01` (Normal) | RG packed, B = 0; strong iris relief (mean tilt 50–60° inside the iris), flat sclera | 0 | [resource] |
| `he_000_base_rm01` (Roughness) | **R** only; ≈ 80/255 over the iris and pupil, ≈ 26/255 over the sclera, so after `RoughnessScale` 0.157 and 0.05 | 0 | [resource] |
| `normal_bubble` (NormalBubble) | RG packed, ±1.5° ripple | 0 | [resource] |
| `he_000_rebecca_n01` | a normal map stored as a **gamma colour** texture | **1** | [resource]; the engine therefore decodes it before the RG unpack [hypothesis, same rule as §2.3] |
| `eye_shadow_mask` (Mask) | **R** = occlusion (≈ 0 in the middle of the eye opening, 1 towards the lids and corners); **G** ≈ 106/255 everywhere (wet roughness 0.42); **B** = a thin arc along the lower lid margin, up to 44/255 (the tear line); A unused | 0 | [resource] |

### 1.3 The morph resource can replace the eye's normal map

The vanilla eye morph targets carry `baseTexture` = `engine\textures\editor\normal.xbm` with `baseTextureParamName` = `Normal`, and no per-target texture diffs [resource]. ArchiveXL copies both eye morphs to `…_morphs_normal_fix.morphtarget` and patches `baseTexture` and `baseTextureParamName` away (`PlayerCustomizationEyesPatch.xl`) [source]. Its eye app's dynamic appearance (`he_000_pwa__basehead__mod`), which every remapped choice uses, binds that fixed copy [resource]. Reading: a morph component renders with a runtime texture built from `baseTexture` (plus target texture diffs) and binds it to the named material parameter, so **without ArchiveXL every player eye's `Normal` is flat, and with ArchiveXL it is the material's own map** [hypothesis; the fix's existence and name are the evidence]. The head morph's `baseTexture` is the head's own normal, so the same rule is neutral there [resource]. The resolver should apply the effective morph's `baseTexture` to the named parameter; on the reference profile that means "use the material's map".

## 2. The eye G-buffer program (`eye.mt`, `eye_gradient.mt`)

Both templates compile to the same arithmetic; `eye_gradient` adds the mask and gradient lines [source: pixel programs `10020572278408962832` and `14845425953312192161`, `gbuffer_regular`; the velocity-buffer variant `776001972724306108` is identical except that its per-eye constants sit 4 registers higher]. Opaque, depth-writing, back-face culled; lighting class Eye (3).

### 2.1 Inputs

The vertex program passes raw `UV0` (not folded; the two eyeballs occupy different U tiles), the world normal N, tangent T, bitangent B = `cross(N, T)·w`, and the world position [source: vertex `11812954726399949237`]. The pixel program also reads the camera position (`CameraShaderConsts[36]`) and, per eye, two engine vectors from `MaterialModifiersConsts` (registers 2/3 or 6/7) [source].

**Measured eyeball** [resource, female GLB]: each eyeball is a plain sphere of radius 13.7 mm with radial normals and **no geometric cornea bulge**. The pupil vertex sits at U = 1.5 (the character's left eye, `l_J_eye_JNT`) or −0.5 (right eye), V = 0.5. The shader assumes a larger virtual sphere (`EyeRadius` 15.2 mm): the iris plane at 13.4 mm lies 1.8 mm under the virtual apex, and the refraction depth reaches zero around UV radius 0.18, just outside the iris.

### 2.2 Arithmetic, step by step

```hlsl
// side: raw U > 0 → "Right" parameters and registers 2/3; U ≤ 0 → "Left", registers 6/7
fu    = u + (u > 0 ? -1 : 1);              // folded U, pupil at 0.5
d     = (fu - 0.5, 0.5 - v);  r = length(d);
iris  = saturate(1 - (r - (IrisCoordFactor - IrisCoordMargin)) / (2*IrisCoordMargin)); // 1 for r<0.145, 0 for r>0.185
a     = -EyeHorizAngle[side] * PI/180;
A     = cos(a)*Mod[side].fwd + sin(a)*Mod[side].lat;   // the eye's optical axis, rotated ±5° horizontally
T2    = normalize(T - dot(T,A)*A);  S = cross(T2, A);  // eye frame {T2, A, S}
I     = normalize(P - camera);                          // view ray
Il    = (dot(I,T2), dot(I,A), dot(I,S));  Nl = (dot(N,T2), dot(N,A), dot(N,S));
R     = refract(Il, Nl, RefractionIndex);               // HLSL refract; 0 on total internal reflection
h     = max(0, EyeRadius*dot(N,A) - EyeParallaxPlane);  // height above the iris plane
t     = RefractionAmount * h / max(1e-4, abs(R.y));
X     = R.x*t + EyeRadius*dot(N,T2);  Y = R.z*t + EyeRadius*dot(N,S);   // hit point on the iris plane
uvI   = 0.5 + float2(X, Y) * IrisSize / (2*EyeRadius);
uvC   = lerp(float2(fu, 1 - v), uvI, iris);             // colour/normal/mask coordinate
```

Then the surface [source]:

| Output | Formula |
|---|---|
| Base colour | `eye`: `Albedo(uvC)`. `eye_gradient`: `lerp(Albedo(uvC), Gradient(IrisMask(uvC).R, row), IrisMask(uvC).A)`, where the gradient is one hardware sample of a runtime atlas (`t55`, 512 rows) at `y = (row + 0.5)/512`, the row being the value the engine binds for `IrisColorGradient`. Written as `sqrt` to GBuffer0.rgb |
| **Iris normal N2** (second vector) | `normalize(x·T + y·B + z·N)` from `Normal(uvC)` RG with `z = sqrt(1 − x² − y²)`, so it follows the refracted coordinate. Octahedral-encoded to 10 bits per axis in GBuffer2.zw (high 8 bits) and GBuffer0.w / GBuffer1.w (low 2 bits) |
| **Cornea normal N1** (GBuffer1.rgb) | Inside the iris disc an analytic bulge: with `s = EggFullRadius·EggSubFactor` and `q = (du, dv, s)`, `e = normalize(q·(EggFullRadius/\|q\|) − q)`, then `e.z += 0.5`, then `e.xy *= saturate(1 − EggMarginFactor·r/√(EggFullRadius² − s²))^EggMarginExponent`, renormalised (about 25° of tilt at the limbus). Outside, `NormalBubble` RG sampled at `BubbleNormalTile·(fu, 1 − v)`. Blended by `iris`, taken through the same T/B/N frame |
| Roughness (GBuffer2.y) | `RoughnessScale · Roughness(u, v).R` at the **raw** UV: neither folded nor V-flipped (the sampler wraps), and not refracted |
| Metalness slot (GBuffer2.x) | `saturate(Specularity)`: 0 in every vanilla and inspected mod material |
| Back faces | both normals reflected about N (irrelevant with back-face culling) |

Three consequences for a renderer:

- **Colour, normal and mask are sampled V-flipped** relative to the raw UV (`1 − v`), roughness is not [source]. The CCXL eye guide tells authors to invert the albedo on Y and to regenerate, not flip, the normal map [wiki: `ccxl-eye-textures.md` L267-271, image `inverted_y_03.png`]. The Studio's eye preview follows this rule (§6.6).
- **The iris is a projection, not a texture on the sphere.** Inside the iris the coordinate comes entirely from where the refracted view ray meets a plane 13.4 mm from the eye centre, in the eye's own frame; the mesh UV only chooses the iris/sclera blend. At a straight view the limbus (UV radius 0.165) projects to about 0.151, a 9 % magnification; at grazing views the iris slides against the limbus.
- **The eye axis is engine data.** The two per-eye vectors are not material parameters. Reading: they are the eye joint's forward and lateral axes; the ±5° then turns each iris axis about 5° outward, like the eye's angle kappa [hypothesis]. In the bind pose the eye joints' forward is their local −Y [resource: `boneRigMatrices`]. A wrong sign shifts the iris sideways by about 0.03 UV, a fifth of its radius.

### 2.3 The gradient coordinate: raw or decoded?

`eye_mask.xbm` is a gamma texture. If the sampler decodes it like other gamma textures (the rule the skin adapter follows), the iris R median 0.35 becomes 0.10, below the first stop of `eye_red` (0.207) and far below every colour stop at 0.786. Then red eyes would be near-black (sRGB ≈ 82,14,1) and light-blue eyes dark slate (42,55,63). If R is used raw, red eyes are bright red-orange (200,65,2) and light blue a mid blue (75,106,124) [resource-based prediction, hair-model stop bake]. The profiles were plainly authored for the raw range: `eye_red`'s stops span exactly the raw 10–90 % range of the mask. **Default: raw R** [hypothesis, strongly supported by the resources]; test ask 9 settles it and, with it, whether `isGamma` really implies sRGB sampling for `TCM_QualityColor` masks (which matters to the skin tint mask as well). The stop bake itself (interpolate the 8-bit stops, then decode, as for hair profiles) and the atlas filtering are [hypothesis].

### 2.4 Inert parameters

No pixel program of `eye`, `eye_gradient`, `eye_blendable` or `eye_morph`, in any pass or vertex factory, reads `Blick` (a cubemap), `BlickScale`, `SubsurfaceFactor`, `AntiLightbleedValue` or `AntiLightbleedUpOff`, and no static program names them [source]. A CPU-side consumer cannot be excluded, but on the evidence they are inert in 2.31. The preview must **not** add a baked catch-light cubemap: catch lights come from real lights and the environment (§3).

## 3. How the deferred light shades the Eye class

The eye has its own, cheaper BRDF in every clustered light variant that includes class 3; there is no Eye-only variant [source: global/local light `6606735909222169407`, eye branch `%476`–`%572`, local-light loop `%2098`–`%2764`].

| Term | Eye class | Standard class, for contrast |
|---|---|---|
| Diffuse | **Lambert** on the **iris normal N2**: `albedo·(1−m)²/π · C · saturate(N2·L)` | Burley on the one normal |
| Specular D | GGX on the **cornea normal N1**, α = r², r clamped to [0.04, 1] | same |
| Visibility | `0.25 / ((N1·V + N2·L)(1 − α/2) + α)` | height-correlated Smith |
| Fresnel | `F0 + (1 − F0)·2^((−5.55473·VH − 6.98316)·VH)`, F0 = lerp(0.04, albedo, m) | pow5 Schlick |
| N·L on specular | none (the horizon enters only through N2·L inside Vis) | yes, and a clamp at 100 |
| Sun | a point direction, no disk; its shadow mask is zeroed where `sunDir·N2 < 1e-4`, which also kills the cornea highlight | disk, representative point |
| Local lights | the same BRDF; area and tube lights take their representative point from the reflection about N1; per-light roughness offset as for Standard | Burley, Smith, pow5 |
| Ambient (probes) | diffuse and specular both on **N1**, occlusion terms forced to 1 when a global flag is off | on the one normal |

At normal incidence the eye's visibility term is half a Standard lobe's (0.125 against 0.25), so the cornea highlight is about half as bright as the same roughness on skin [source, inference from the formula]. Diffuse and specular leave the light in separate buffers, then are combined as for Standard; whether the SSS blur skips Eye pixels was not read. The global render option `Editor/Characters/Eyes` `DiffuseBoost` (vanilla 0.1) and `UseAOOnEyes` exist [community, Character Rendering Editor], but how they enter the programs is not decoded; `cb13[4]` scales specular for both classes and `cb6[9].z` gates the eye's occlusion bypass [source; meanings hypothesis].

**What this means visually.** The iris is shaded as a matte, relief-mapped disc lit only by direct light (Lambert on its own bumpy normal), while all reflections, the sharp catch lights and the environment, sit on a smooth cornea and a nearly mirror-like sclera (roughness 0.05, cornea 0.157). Ambient light does not see the iris relief.

## 4. The wetness shell (`eye_shadow.mt`)

A second mesh sheet just outside each eyeball (0–0.8 mm, median 0.2 mm) covering the eye opening and following the lids [resource]. It is **not** cosmetic eyeshadow: it darkens the eyeball towards the lids and adds the tear-line highlight. Forward pass `transparent_back_face` after lighting, no culling, depth test on, depth write off, `EMP_Front`, blend `One / SrcAlpha` [resource] [source: pixel `14043594489545752539`]:

```hlsl
m      = Mask(uv0);                                   // raw UV, linear texture
shadow = saturate(Intensity * pow(m.r, Exponent));    // 0.7·R^0.8 in vanilla
lum    = dot(pow(ShadowColor.rgb/255, 2.2), 0.33);    // only the colour's mean matters: 0.094 in vanilla
alpha  = saturate(1 + fog * shadow * (lum - 1));      // multiplies what is behind; 0.37 at full mask
rw     = clamp(WetnessRoughness * m.g, 0.04, 1);      // 0.42 in vanilla
spec   = Σ lights  D_GGX(Nv·H, rw) · Vis(rw) · lightColour · shadowing;   // vertex normal Nv, no Fresnel, no N·L
out    = float4(spec * exposure * WetnessStrength * m.b, alpha);          // final = out.rgb + dst·alpha
```

Sun (here a disk, by the representative-point method) and clustered local lights use the same visibility form as the eye (with N2·L replaced by Nv·L); the program walks the reflection probes but multiplies their contribution by zero, so the shell adds **no environment reflection** [source]. The tint of `ShadowColor` is lost: the darkening is neutral grey. The result is a soft occlusion ring in the eye corners and under the upper lid, and a thin wet highlight along the lower lid margin where a light sits in the mirror direction.

## 5. Mod eyes: how CCXL eyes plug in

Every installed CCXL eye mod reaches the same chain, so the generic resolver handles them without per-mod code [resource] [source: ArchiveXL 1.27.3 `5474e34d`]. Inspected on the reference profile: Photoreal Eyes CCXL, Unique Eyes to CCXL with Kala's Eyes Standalone V2 (the reference save's eye), Pit Eyes, FORBIDDEN EYES and Beautiful IRIS III (enabled), Beautiful Exotics and Heterochromia Eyes (disabled).

| Step | What the mod does | What the resolver follows |
|---|---|---|
| Register | A CCO with one anonymous `gameuiAppearanceInfo` on uiSlot `eyes_color` (or the wildcard `eyes_color*`); its definitions merge into the vanilla eye option | CCO overlay merge by uiSlot/link (existing) |
| Patch | `resource.patch` of the scope aliases `player_wa_eyes.mesh` / `player_ma_eyes.mesh` with a patch mesh whose appearances have no chunk materials | scope expansion, then patch appearances expanded from the sticky expansion tag (`blood_gradient_black`) or the context's expansion source, giving `[eyelashes_MAT, <name>@eyes, eyeWetness_MAT]` |
| Material | an `@eyes` template entry (local or soft `.mi`) whose values use `*…\{material}_d.xbm`-style soft paths, or ordinary per-colour entries → `eye_base.mi` → `eye.mt` | `@tmpl` binding, `{material}` expansion, `.mi` chain, template defaults |
| Textures | new paths, or (Unique Eyes) fixed paths supplied by a texture-only archive (Kala); `resource.link` fallbacks apply only where the path does not exist | archive precedence and link rule (existing) |
| Morph | none; the ArchiveXL fix morph is used (§1.3) | effective morph `baseTexture` rule (**gap**) |

Consequences [resource]: every CCXL eye is **texture-only `eye.mt`**: no gradient, the vanilla optical scalars from the template (except `BlickScale`, inert), and the vanilla wetness shell and lashes untouched. No mod replaces a vanilla eye file at the same path, except Heterochromia's two normal maps. Heterochromia draws **two components**, each a split-eye mesh (`[lashes, eye, wet, eye, wet]`) with a complementary chunk mask and its own mesh appearance, selected by a switcher between `eyes_color`/`eyes_color_none` and `eyes_color_left`/`eyes_color_right`; per-eye colour is per component, not per material. Its female left app has an inline mask that disagrees with its `partsOverrides` mask, and it lists the vanilla eye entity in `partsValues`; both need a runtime look before the resolver commits to a reading.

**Resolver gaps for eyes:** the scope of `partsOverrides` on inline components (Heterochromia). The morph `baseTexture` rule and gradient resources are now carried in the render record, and the hand-made eye manifest is retired (§6.6).

## 6. Implementation spec for the preview

### 6.1 Render-record data (per eye component, per chunk)

| Data | Why |
|---|---|
| Slot `eyes` from uiSlot `eyes_color` (and `eyes_color_2` for a second heterochromia component), third-person groups | Same planner as brows and lashes; both heterochromia components draw |
| Geometry: the eye morph component exported with its 21 eye targets, **raw UV0 (not folded, U outside [0, 1] kept)**, normals, tangents with the handedness sign, skin weights on the eye joints | The shader's side choice, fold and frame all come from these |
| Chunks with their template: `eye`, `eye_gradient`, `eye_shadow`, `multilayered` | Role from template; male order swapped |
| Scalars: every eye parameter, effective (chain, then template default), including `EyeHorizAngleLeft/Right` per material | The circle designs change the angles |
| Textures with `isGamma`: `Albedo`, `Normal` (after the morph `baseTexture` override), `Roughness`, `NormalBubble`, `IrisMask`; shell `Mask` | §1.2, §1.3 |
| **New: gradients**: `IrisColorGradient` → the resolved `CGradient` stops `{value, RGBA bytes}` sorted by value | The renderer bakes the ramp; the exporter never interprets it |
| Shell scalars and colours: `ShadowColor`, `Intensity`, `Exponent`, `WetnessRoughness`, `WetnessStrength` | §4 |
| Multilayer: `MultilayerSetup` and `MultilayerMask` resources | For the shared multilayer adapter (piercings need it too) |
| Runtime, not record: each eye joint's world frame | The per-eye axis (§2.2) |

### 6.2 Three.js shading approach

**Eye adapter** (`eye.mt` and `eye_gradient.mt`; one material, a define for the gradient). A `MeshStandardMaterial` extended through `onBeforeCompile`, the pattern the skin adapter uses:

1. **Vertex**: pass raw UV0, the view-space position, and the skinned and morphed N, T and the tangent sign (Three's `USE_TANGENT`). Upload each eye's axis pair as uniforms (in view space), chosen per fragment by the sign of raw U.
2. **Fragment surface**: the §2.2 arithmetic literally: iris weight, eye frame, `refract`, iris-plane hit, `uvC`, both normals, V-flip for colour/normal/mask, raw UV for roughness, the gradient lookup at raw mask R, `RoughnessScale`, metal = `Specularity`. Sample every texture through its own `isGamma` (the mask as data; see §2.3).
3. **Lighting**: replace `RE_Direct` with the eye BRDF of §3 (Lambert on N2, GGX on N1 with the eye visibility and the exp2 Fresnel, no N·L on specular, the `sunDir·N2` cut). Point the indirect diffuse and the environment specular at N1.
4. **Gradient**: bake each `CGradient` to a 256×1 texture on the CPU: linear interpolation of the 8-bit stops, clamped beyond the end stops, stored as sRGB so the sampler decodes it (the hair profile model); linear filter, clamp to edge.

**Wetness-shell adapter** (`eye_shadow`). Its own mesh, drawn after the eyes, the makeup plate and the skin, with `transparent`, `depthTest` on, `depthWrite` off, `side: DoubleSide`, `blending: CustomBlending`, `blendSrc: OneFactor`, `blendDst: SrcAlphaFactor`. The fragment computes §4: direct lights only, GGX with the shell's own roughness and the eye visibility, no Fresnel, no environment. Tone mapping is the catch: the blend must happen in linear light. In the Studio's HDR render target (the creator display path) the shell is exact with `toneMapped: false`; drawn straight to the canvas after in-shader tone mapping it multiplies already tone-mapped colour, which is close for the darkening and slightly off for the highlight [hypothesis about the visible error].

**Multilayer eyes**: through the multilayer adapter when it exists (Standard class, no refraction, the shell still on top). Until then say plainly that the design is not shown and draw the vanilla default eye.

### 6.3 What to take from P1's skin work

- **Reuse**: the adapter structure, sampling every input through its resource's `isGamma`, raw RG normals with reconstructed Z, the fixed dielectric F0 of 0.04, the `onBeforeCompile` override of `RE_Direct` and of the indirect terms, and keeping diffuse and specular separate.
- **Do not reuse**: the two-lobe specular, the skin profile, Burley diffuse and the subsurface wrap. The Eye class has none of them. One GGX lobe with its own visibility and Fresnel replaces them.
- **Similar trap**: as with the skin tint mask, the gamma flag of a data mask decides the result; the eye is the first place where the resources argue *against* decoding (§2.3).

### 6.4 Acceptance checks

1. **Arithmetic** (unit test, offline): a TypeScript twin of §2.2 against hand-computed cases: a straight view at the pupil gives `uvC` = (0.5, 0.5); at the limbus it gives radius 0.151; a 30° view shifts `uvI` by the refracted offset; `iris` is 1 at r = 0.145 and 0 at 0.185; the octahedral round trip is exact to 10 bits.
2. **Gaze**: through the idle's gaze sweep the pupil stays centred on its iris, the iris slides against the limbus at grazing angles, and there is no ring at the 0.145–0.185 blend.
3. **Orientation**: with an asymmetric test albedo, the preview's iris orientation matches the shader's `1 − v` rule on both eyes.
4. **Shell**: the eye corners and the band under the upper lid darken to about 37 % at full mask; the tear line lights only near the mirror direction of a light.
5. **In game**: the creator eyes page (camera `UI_Eyes`, 1.2 m, 15° FOV) under the [creator lighting preset](creator-lighting.md), measured with its patch method: iris mean colour for gradient light blue, red and brown against the §2.3 predictions; the `Main_Eyes` catch light's position and size on the cornea; the corner darkening. Test asks 9–12 of the [head render plan](head-cc-rendering.md#in-game-test-asks).

### 6.5 Ranked plan (visual gain per effort)

Effort: **S** about a day of agent work, **M** a few days, **L** a week or more.

| Rank | Piece | Gain | Effort | Needs |
|---|---|---|---|---|
| 1 | **Resolved eye component** in the record (slot, three chunks, raw UV0, gradients, morph `baseTexture` rule) and retiring the one-pair eye manifest | Every vanilla and CCXL colour becomes available at all, from the resolver | M | Planner slot, exporter keeps raw UV0, `gradients` map, resolver morph rule |
| 2 | **Iris colour**: gradient bake, mask blend, V-flip, `isGamma` handling | Correct colour for the 18 gradient eyes and correct orientation for texture eyes | S | Rank 1 |
| 3 | **Wetness shell** forward pass | Eyes sit in the socket: corner occlusion and the tear line; the biggest single cure for "stuck-on" eyes | S | Rank 1; HDR target for exactness |
| 4 | **Two-normal eye lighting** (Lambert on N2, cornea GGX on N1, IBL on N1) | Matte relief iris under a glassy cornea; halves today's over-bright highlight | M | Rank 2 |
| 5 | **Refraction/parallax UV** | Depth under the cornea at angles; the iris stops looking painted | S (with rank 4) | Eye-joint axes as uniforms |
| 6 | **Heterochromia**: two components with their masks | One enabled mod works | S | Resolver scope check, runtime look |
| 7 | **Multilayer eyes** (37 creator options) | The graphic eye designs | L | Shared multilayer adapter |

### 6.6 Implementation status (ranks 1–3 built; ranks 4–7 open)

**Rank 1: resolved eye component.** The character record is now `xfs/render-detail-3` (`src/render-detail.ts`). It carries an `eyes` slot, selected by the creator slot `eyes_color` in the same planner as brows and lashes. It also carries a per-chunk `gradients` map, the `CGradient` stops sorted by value as RGBA bytes, and per morph component a `morphTexture` rule. The eye component's chunks keep their roles from their templates (`src/render-templates.ts`: `eye.mt` and `eye_gradient.mt` go to the `eye` adapter, `eye_shadow.mt` to `eye-shell`, and `multilayered.mt` to a placeholder), so the male order needs no special case. The geometry is the effective morph target exported with raw UV0: on the reference install the eyeball UVs span U −1.64 to 1.99 and V −0.60 to 0.99, and the shell spans U 0–1 and V 0.048–0.406.

The resolver reads each morph target's `baseTexture` and `baseTextureParamName`, including ArchiveXL patches of them (`src/resource-graph.ts`). The planner applies the rule to the texture parameter it names, when the chunk's adapter reads that parameter. Where it applies:

- The vanilla eye morph binds `engine\textures\editor\normal.xbm` to `Normal`.
- ArchiveXL's `…_normal_fix` copy clears the rule, so the material's own normal stands.
- The head morph's rule names the head's own normal, so the skin is unchanged on the reference install.

The hand-made single-eye manifest (`eye-appearance.ts`, `eye-optics.ts`, `tools/intake_eyes.ts`) is retired from the preview. Its parser now lives only in the render-fidelity study's fixture (`src/eye-study-fixture.ts`, staged by `tools/stage-private-eye-study.ts`), and a boundary test keeps every rendering module free of eye-mod names, saved identities and that fixture.

One generic exporter fix came out of this. Some mod archives list hashes only, with no path names; the reference save's texture pack is one. For those, a WolvenKit path pattern finds nothing, so the exporter now asks for each missing texture by its depot hash, if the archive's own index lists it (`src/game-asset-export.ts`).

**Rank 2: iris colour** (`src/eye-material.ts`). One eyeball material serves both templates, with a define for the gradient.

- **Sampling.** Colour and mask are sampled at `(fold(u), 1 − v)`. The fold uses the raw derivatives, so the mip level doesn't jump at U = 0. Roughness is sampled at the raw UV. The earlier preview sampled colour at the raw UV, so it drew every eye upside down against the game; that is fixed, and the core fallback eye uses the same material.
- **Gradient eyes.** For `eye_gradient.mt`, the baked 256-texel ramp is looked up at the mask's R and blended by its A in linear light. The ramp holds the 8-bit stops interpolated at the texel centres and is stored as sRGB.
- **Mask reading.** R is read raw by default. `IRIS_MASK_ENCODING` switches to the decoded reading once test ask 9 settles it.
- **Texture-only eyes.** `eye.mt` eyes use their albedo alone.
- **Layered designs.** A `multilayered.mt` eye reports the limit code `eye-design`, and the scene keeps the core (base-game) eye with the chosen eye's wetness shell.
- **Lighting.** Unchanged: the standard lighting, with the flat roughness 0.18 by default. The "Eye's own roughness" switch uses `RoughnessScale · Roughness.R` from the resolved chain. `Normal`, `NormalBubble` and the optics scalars are already in the record and in `EyeParameters` for ranks 4–5.

**Rank 3: wetness shell.** The shell follows §4:

- It is a forward pass at render order 99: after the eyeball, the skin and the makeup plates, and before brows and lashes.
- Blending is `One / SrcAlpha`, with depth test on, no depth write and both sides drawn.
- `alpha = saturate(1 + shadow·(lum − 1))`, which is 0.37 at a full mask in vanilla.
- The highlight is GGX at `clamp(WetnessRoughness·G, 0.04, 1)`, using the eye's visibility term, with no Fresnel, no N·L and no environment, scaled by `WetnessStrength·B`.

It is exact only in the creator display's scene-linear target. On the Studio stage it multiplies colour that is already tone-mapped and sRGB-encoded.

**Checks.** Unit tests cover:

- the record schema and its refusal of v2 character records;
- eye selection for a vanilla gradient eye, a texture-only eye, a CCXL-style patched eye (built from the ArchiveXL fix appearance, with an `@eyes` template and soft paths), a layered design and the male chunk order;
- the ramp maths and the raw and decoded predictions;
- the flipped sampling rule and the shell formula;
- A → B → A switching, and the boundary test;
- the render-scheduler triggers.

In the browser (`?verify=1`, reference MO2 profile), three Vs resolved and drew:

| V | Eye | How it looks |
|---|---|---|
| Default V | `gradient_brown` | A warm mid-brown iris with lighter caramel fibres and a dark limbal ring |
| Reference save | Kala eye 16 (`eye.mt`, from the hash-only archive) | A green-hazel iris with an amber ring round the pupil |
| Save B | `gradient_light_blue` (previously unresolved) | A mid sky-blue iris with pale streaks and a dark limbal ring |

- **Shell.** In all three the shell darkens the corners and under the upper lid. The tear line shows as a thin bright band along the lower lid under the Studio key light, and as separate catch points under the creator spot lights.
- **Switching.** Switching reference → B → reference restored the same record identity.
- **Coverage.** Both lighting presets and both themes were checked, with no console errors.

None of this has been compared with the game.

**Still open.** Rank 4 is the two-normal Eye light: Lambert on N2, GGX on N1 with the eye visibility and the exp2 Fresnel, and the `sunDir·N2` cut; the eyeball still uses the standard light and no normal map. Rank 5 is the refracted iris coordinate and the per-eye joint axes as uniforms, which `EYE_SURFACE` computes `uvC` for. Rank 6 is heterochromia's two components. Rank 7 is the multilayer adapter. Test asks 9–12 remain the gates.

## Open questions

1. Is `IrisMask` R used raw or sRGB-decoded (§2.3)? More generally, does `isGamma` on a `TCM_QualityColor` texture always mean sRGB sampling?
2. What exactly are the per-eye `MaterialModifiersConsts` vectors (joint axes, look-at target, something else), and which way does the ±5° turn?
3. Does the morph `baseTexture` really replace the material's `Normal` at runtime, and does ArchiveXL's fix apply to vanilla choices on every route?
4. How is the runtime gradient atlas built (stop interpolation space, sample count, filtering)? Shared with hair profiles?
5. What do `DiffuseBoost`, `UseAOOnEyes`, `cb13[4]` and `cb6[9].z` do to eyes, and do the SSS passes skip Eye pixels?
6. Heterochromia: which chunk mask wins on the female left app, and does the vanilla eye entity in `partsValues` draw?

## Related pages

[Head CC rendering](head-cc-rendering.md) · [Materials and shaders](materials-and-shaders.md) · [CC file chain](cc-file-chain.md) · [Mod loading](mod-loading.md) · [Creator lighting](creator-lighting.md) · [Eye rendering evidence](../research/character-customization/eye-rendering-evidence.md) · [Experiment 014](../experiments/014-native-eye-gradient/compiled-shader-and-gaze.md) · [Modded eye resolution](../research/eye-artistry/modded-eye-resolution.md)
