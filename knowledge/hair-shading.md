# Hair shading (`hair.mt` family, game 2.31)

**Maturity: Draft.** The colour, coverage and G-buffer arithmetic of `base\materials\hair.mt` and the hair light (sun, local lights and environment) are decoded from compiled 2.31 programs. The CPU bake of `.hp` profiles and the default values of the lighting options, with the register each one feeds, are read from the 2.31 executable. The options are runtime GameOptions, so a CET mod can still change them in a session. The preview has been compared with a four-colour ladder in the mirror, under fixed light ([§8](#creator-ladder-session-3)): its rungs keep the decoded bake's spread, and the game's are 1.5–1.8 times further apart. An earlier comparison used an uncontrolled in-game portrait taken with a grading ReShade preset and a replacement LUT ([calibration note](../research/eye-artistry/hair-calibration-2026-09-25.md)). The creator and mirror screen stays the reference light ([creator lighting](creator-lighting.md)). For what is still open, see the [open questions](#open-questions) and the [capture request](../research/eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request).

This page covers hair cards, and lashes that use hair materials. How hair moves (its dangle joints and their simulation) is on [dangle physics](hair-physics.md). Every vanilla and inspected CCXL brow uses a post-G-buffer decal (`mesh_decal_double_diffuse.mt`), not `hair.mt` ([eyebrows](brows.md)). Lashes take one colour per profile (the [hair reference §9](../research/materials/shader-hair.md#9-lashes) has the sample positions). The last section covers that decal's colour blend. For material resources, G-buffer layout and other templates, see [materials and shaders](materials-and-shaders.md); the evidence-level [hair reference](../research/materials/shader-hair.md) lists every parameter, pass and program hash, the lash and cap specifics, and what still blocks correct hair and lash colour.

**Grades:** [source] compiled programs, the 2.31 executable, or tool/engine source; [resource] installed game or mod resources; [wiki] Cyberpunk Modding Docs at `be2f44ee`; [runtime] observed in game; [hypothesis] not established.

## 1. Inputs

| Input | Meaning | Grade |
|---|---|---|
| `Strand_ID` (reg 0) | Greyscale per-strand identity; its **red** channel indexes the profile's ID gradient. Templates and the inspected textures are `isGamma=0`, so the value is linear. | [source] [resource] |
| `Strand_Gradient` (reg 1) | Greyscale root(0)-to-tip(1) position; **red** indexes the root-to-tip gradient. | [source] [resource] |
| `Strand_Alpha` (reg 2) | Coverage; **red** channel. | [source] |
| `HairProfile` (reg 15) | `CHairProfile` (`.hp`): `gradientEntriesID`, `gradientEntriesRootToTip` (unsorted colour stops), `sampleCount` (127 in most vanilla profiles; `black_salt_n_pepper` stores 43, and `purple_ombre` and `liliac` omit it, so it is the class default, 64 [resource: native reads of game 2.31; the default from WolvenKit's generated class]). In the shader it is a row index into a runtime float texture. | [source] [resource] |
| `AlphaCutoff`, `RoughnessScale`, `RoughnessBias`, `ShadowStrength`, `ShadowMin`, `ShadowMax`, `ShadowRoughness`, `Flow`, `FlowStrength`, `Scattering`, `DebugHairColor` | See below. `VertexColorStrength` (reg 8) is declared but unused by the three pixel programs. | [source] |
| Vertex colour **red** | Baked self-shadow (red = inner, darker). The vertex program passes `COLOR.r` to the pixel programs (`TEXCOORD1.y`). | [source]; [wiki] runtime screenshot |

Template defaults [resource]: `AlphaCutoff` 0.33, `RoughnessScale` 1, `RoughnessBias` 0, `ShadowStrength` 0, `ShadowMin` −0.5, `ShadowMax` 1, `ShadowRoughness` 1, `FlowStrength` 1, `Scattering` 0.16. Each parameter occupies the `cb4` register equal to its template `register` [source].

## 2. Passes

`hair.mt` has three passes per technique. For `MeshSkinned`, the programs are `alpha_accum` `2782105832921211528`, `basecolor_blend` `7571795766366002052` and `gbuffer_solid` `2903833597335136032`. Their vertex program is `7115927943278841644`.

| Pass | What it does | Grade |
|---|---|---|
| `hair_alpha_accum` | Remaps `a = saturate(max(Strand_Alpha.r − AlphaCutoff, 0)/(1 − AlphaCutoff))`, times 1.33 when a global flag is set. Keeps the fragment when `a` exceeds the dither threshold below, and drops it behind the depth held in a fourth slice (the opaque scene, most plausibly). Inserts `depth \| round(saturate(Strand_Alpha.r)·63)` into a 3-deep k-buffer (atomic max, reverse-Z); a fragment with `Strand_Alpha.r` above 0.98 writes its key into all three slots, evicting the layers behind it. The colour target keeps transmittance `Π(1−Strand_Alpha.r)`. | [source] |
| `hair_basecolor_blend` | For fragments in the k-buffer, adds `(\|colour\|·w, w)` with `w = stored alpha/63` (additive blend). | [source] |
| `hair_gbuffer_solid` | Writes the G-buffer for the most opaque of the two front k-buffer layers, with the same dithered test. GBuffer0 = `sqrt(Σwc/Σw)`. GBuffer1 = packed strand tangent frame. GBuffer2 = `(0, roughness, 1/3 + 2/3·transmittance·thickness/Scattering, Strand_ID)`. | [source] |

**The dither.** Both passes compute, from the pixel centre `(x, y)` and a per-frame counter `f` (a camera-constant register; its meaning as a frame counter is [hypothesis]):

```
t = 0.16535948 · (5·frac(0.2·(x + 2y − 1.5 + f)) + frac(2.4084506·x + 3.2535212·y)) + offset
offset = 2/255 (alpha_accum), 0.0088431 (gbuffer_solid)
```

A fragment survives when `a > t` [source]. The threshold does not depend on the fragment, so **every layer in a pixel meets the same threshold**. Their coverage is nested rather than independent: the pixel is covered when its most opaque layer survives, not with probability `1 − Π(1−a)`. `t` is close to uniform on [0.0088, 0.8356), and the coarse term cycles every five frames. After TAA/DLSS, a pixel is therefore covered in the fraction `saturate((max a − 0.0088)/0.8268)`, and any layer with `a` above about 0.84 is opaque. This makes hair denser than its alpha values suggest [source arithmetic] ([coverage note](../research/eye-artistry/hair-coverage-2026-09-25.md)).

Hair is therefore opaque in the G-buffer, with dithered coverage that TAA/DLSS averages. Its base colour is the alpha-weighted average of the three nearest surviving layers. It is lit once by the deferred light.

## 3. Base colour

Per fragment, in `basecolor_blend` [source]:

```
N   = profile row texel 0               // sample count
id  = row[1 + uint((N−1)·Strand_ID.r)]            // truncation, no filtering
rt  = row[1 + N + uint((N−1)·Strand_Gradient.r)]
c   = luma601(rt) < 0.5 ? 2·id·rt : 1 − 2·(1−id)·(1−rt)   // overlay; rt is the base layer
s   = smoothstep(ShadowMin, ShadowMax, 1 − vertexColour.r)
c  += (saturate(c·s) − c) · ShadowStrength
c   = DebugHairColor ≥ 0.5 ? 1 : c;   c ·= wetness factor (1 when dry)
```

- **It is an overlay, not a multiply.** The branch uses the root-to-tip luminance (Rec.601 weights 0.3/0.59/0.11), so a mid-grey ID (0.5) leaves the root-to-tip colour unchanged. A saturated result can exceed 1 or go negative; the resolve stores `|c|` [source].
- **The profile is sampled, not filtered.** Indices are truncated. The `Strand_ID`/`Strand_Gradient` textures themselves use the material's linear anisotropic sampler, so a filtered ID at strand edges selects intermediate gradient entries [source].
- **The bake is CPU code** [source: executable]. When a profile loads, each stop list is sorted by position and **rescaled so its first stop sits at 0 and its last at 1**. The renderer then samples it at `t = k/N` for `k = 0 … N−1`, interpolates the stored 8-bit colours linearly, truncates each channel to a byte, and decodes it with the exact sRGB transfer function. Texel 0 of the row holds N, followed by the N ID texels and then the N root-to-tip texels. Two consequences: a profile whose stops do not span 0 to 1 is stretched, and the last sample sits at `(N−1)/N`, just short of a stop at 1.0. Redacted-c01's `ash_brown` starts its root-to-tip stops at 0.146, so its near-black first stop moves to the very root instead of forming a flat black band over the first 15 % of the length. The addresses, the exact loop and the comparison with the earlier model are in the [hair reference §7](../research/materials/shader-hair.md#7-hp-profiles-and-their-resolution). Against the 23 vanilla creator swatches that have a colour, the decoded bake matches the swatch hue at a median 4.2°. The earlier fitted model gave 4.7°; raw stop values give 19° and the Cyberpunk Blender add-on's empirical `id^2.2·rt^4.5` gives 9° ([`hair-profile-swatch-fit.py`](../projects/xf-studio/authoring/tools/hair-profile-swatch-fit.py), [calibration note](../research/eye-artistry/hair-calibration-2026-09-25.md#2-hypotheses)).
- `ShadowMin = ShadowMax` (as in the vanilla eyelash `.mi`) saturates to a factor of 1 for unpainted vertices [source arithmetic].
- The inspected hair strands of the reference save have all-zero vertex colour, so the shadow term is inert there. Its cap has red AO, but the cap uses `mesh_decal_gradientmap_recolor.mt` [resource].

## 4. Roughness, tangent and scattering

- **Roughness** = `saturate(RoughnessScale·Strand_ID.r + RoughnessBias)`, pulled toward `ShadowRoughness` by `(1−s)·ShadowStrength`. Each strand therefore gets its own roughness [source].
- **Strand direction** = `max(FlowStrength·(2·flow.g − 2) + 1, 0.01)·bitangent + max(FlowStrength·(2·flow.r − 1), 0.01)·tangent`, where bitangent is `cross(N, T)·w` from the mesh [source]. `Flow` textures are `isGamma=1` [resource], which the Blender add-on also notes. For the MELUMINARY flow (163, 255, 105), the decoded red term clamps to 0.01, so the strand follows the bitangent. On those cards the bitangent runs along UV V, the long axis [resource geometry measurement].
- **Scattering** scales a depth-difference thickness term written to GBuffer2.z [source]. Neither the sun nor the local-light hair path reads GBuffer2.z (the all-class light uses it only for Foliage), and the SSS passes skip Hair pixels, so `Scattering` has no effect on rasterised direct light [source] ([hair reference §6.3](../research/materials/shader-hair.md#63-what-the-light-does-not-read)). Ray-traced paths are not parsed.

## 5. Deferred hair light

The Hair branch (stencil class 4) of the global-light compute programs was decoded from `m_shaderLightsComputeGlobalOnly_Clustered_00010001` `7525818560587663624`, SHA-256 `07ebbaf9…c8e3` [source]. It is compared against the Standard-only `…_00000001` `11542214229456522081`. It matches the model published by Karis ("Physically Based Hair Shading in Unreal", SIGGRAPH 2016):

| Term | 2.31 arithmetic | Grade |
|---|---|---|
| Frame | T from GBuffer1 (strand); `sinθL = T·L`, `sinθV = T·V`, `cosθD = cos(\|asin sinθV − asin sinθL\|/2)`, `cosφ` between L and V projected normal to T | [source] |
| Colour | `C = clamp(albedo·(1−metal)·cb0[17].y, 1e−5, 1)` (albedo multiplier) | [source] |
| **Per-strand shift** | `ρ = cb0[17].z + (cb0[17].w − cb0[17].z)·frac(frac(ID·0.0729477)·52.98292)`, with ID the stored `Strand_ID` | [source] |
| **R** (white) | Gaussian `M((r/cb0[17].x)²·√2·cos(φ/2), sinθL + sinθV − 2 sin α (cos α cos(φ/2) cosθV + sin α sinθV))` with `α = cb0[16].x + ρ`. `N = cos(φ/2)/4`. Schlick F0 0.0466 at `√(½ + ½V·L)`. Scaled by `cb0[12].x` and the gate `clamp(wrap(N·L, cb0[19].y) + 1 − cb0[19].z)` | [source] |
| **TRT** (tinted) | `M(2r², sinθL + sinθV − ρ − cb0[16].z)`, `(1−f)²f` with f at `cosθD/2`, `C^(0.8/cosθD)`, `exp(cb0[20].x·cosφ − cb0[20].y)`, scaled by `cb0[12].z` | [source] |
| **TT** | Not present in this global path | [source] |
| **Diffuse** ("multiple scatter") | `C · (1/π) · lerp(w, 1 − \|sinθL\|, cb0[18].y) · clamp(w + 1 − cb0[18].w) · shadow · cb0[12].w · pow(C/luma601(C), 1 − shadow)`, with `w = wrap(N·L, cb0[18].x)` | [source] |
| wrap(x, k) | `saturate((x + k)/(1 + k)²)` | [source] |
| r | GBuffer2.y clamped to [0.04, 1] | [source] |

The `cb0` hair registers are runtime GameOptions (`Editor/Characters/Hair/…`). Their defaults, and the register each one feeds, are read from the 2.31 executable: static initialisers register each option with a default and a range, and one function copies the current values into `cb0` [source: executable] ([hair reference §6.4](../research/materials/shader-hair.md#64-option-values-and-registers-executable)). No shipped archive overrides them; the game would read overrides from `base\materials\config\config_override.ini`, and no archive of the reference install contains that path. The defaults equal the "Vanilla" list of Arkhe's Character Rendering Editor, a CET tool for 2.31:

| Register | Option | Default |
|---|---|---:|
| cb0[16].x, .z | `AlphaShifts/R`, `AlphaShifts/TRT` | −0.083, −0.5 |
| cb0[17].z, .w | `SpecularRandom_Min`, `_Max` | −0.2, 0.2 |
| cb0[17].x, .y | `RoughnessFactor`, `AlbedoMultiplier` | 1, 1 |
| cb0[12].x, .z, .w | `GlobalLight/R`, `/TRT`, `/MultiScatter` | 0.3, 0.8, 0.47 |
| cb0[18].x, .y, .w | `MultiScatter/Wrap`, `/DiffuseScatterFactor`, `/Mask_Intensity` | 0.35, 0, 1 |
| cb0[19].y, .z | `Specular/Wrap`, `/Mask_Intensity` | 0.3, 1 |
| cb0[20].x, .y | `TRT_Params/EXP_SCALE`, `/EXP_BIAS` | 1, 1.5 |
| cb0[13].x, .z, .w | `LocalLight/R`, `/TRT`, `/MultiScatter` | 0.35, 0.8, 0.47 |
| cb0[14].x, .z, .w | `EnvProbe/R`, `/TRT`, `/MultiScatter` (environment path, below) | 0.3, 0.8, 0.47 |
| cb0[19].x | `AdditionalAreaRoughness` (environment path) | 0.1 |
| cb0[15].w | `Debug/DebugSwitch1` (enables a per-light factor) | false |

The TT intensities, `AlphaShifts/TT`, the `ScatterDepth` options and `MultiScatter/ShadowFactorExp` are uploaded but no hair program reads them. CET mods can change these options at runtime. The reference install runs the Character Rendering Editor's "Arkhe Balanced" preset: AlbedoMultiplier 0.8091, RoughnessFactor 1.1968, Wrap 0.4364, EXP_BIAS 2.5795, AdditionalAreaRoughness 0.4 and ContactShadowClamp 0.4717. It also changes eye, skin and rim options: eye `DiffuseBoost` 0.2993 and `UseAOOnEyes` on, `SkinAmbientIntensity_Factor` 0.2062, `SubsurfaceSpecularTintWeight` 0.6955, `SubsurfaceSpecularTint_B` 0.375, `GlobalCharacterFresnel` 0.8086 and `LightBlockerInfluence` 1.0. Session 3 read every one of these options through the runtime bridge under both presets, and the tool's "Vanilla" preset reproduces the executable defaults exactly [runtime]. The Studio uses the defaults as `HAIR_LIGHTING_VANILLA`. Karis's published defaults, used before, are kept as `HAIR_LIGHTING_KARIS`.

**Local lights.** The tiled local-light loop of the all-class program `m_shaderLightsComputeGlobalLocalShadows_Clustered_11111111` (`6606735909222169407`) has its own Hair branch, and it is the model above evaluated per light: the same frame, per-strand shift, R and TRT lobes, gates and wrapped diffuse, from the same `cb0[16..20]` registers. Only the intensity triple differs: **`cb0[13]`**, the `LocalLight` options (R 0.35, TRT 0.8, MultiScatter 0.47), instead of `cb0[12]` [source]. Local lights do not apply the per-light roughness shift that Standard and Subsurface local lights have. When `DebugSwitch1` is set, a light's colour is also scaled by a half-float from its record. The CPU fills that value from a "modified local-light intensity" hack curve, which brightens mid-strength lights and dims strong ones, but the switch is off by default, so vanilla ignores it [source: executable] ([hair reference §6.2](../research/materials/shader-hair.md#62-local-lights)). Every light of the creator and mirror screen is local, so this is the path that shades hair and lashes there.

**Environment.** The ambient and reflection composite has a Hair branch too [source] ([hair reference §6.5](../research/materials/shader-hair.md#65-environment-path)). It evaluates the same model once, for a virtual light along the view direction with its along-strand part removed (`L_e = normalize(V − (V·T)T)`, so `sinθL = 0` and `cosφ = 1`), and scales it by `2π ×` the pixel's diffuse irradiance `E`, the value that lights other surfaces as `albedo × E`:

- R and TRT use `EnvProbe/R` 0.3 and `/TRT` 0.8, with both widths increased by `AdditionalAreaRoughness` (0.1). They are coloured by the irradiance, not by the reflection probe, so an overcast sky gives hair a cool sheen.
- The diffuse is `EnvProbe/MultiScatter` × C × the wrapped term and its gate, and the composite then multiplies it by the albedo again. Ambient diffuse on hair is therefore `2 · E · 0.47 · C · w² · albedo`, with `w` at most 0.74, about `0.52 · C` of what a Standard surface of the same albedo receives. Dark hair (C ≈ 0.1) gets about a twentieth, far darker than under direct light.

**Consequence.** Hair albedo is dark: the reference save's alpha-weighted mean under §3 is sRGB ≈ (74, 61, 54). The hair light is dim as well: its diffuse is 0.47 × a squared, tightly wrapped N·L, and its white R lobe is 0.3. In ambient light, hair's diffuse is scaled by its own albedo once more. Hair gets no card-normal dielectric specular or grazing Fresnel. A flat-card PBR material, or the published defaults, light the same albedo much brighter and greyer than the game.

## 6. Brow decal colour blend (`mesh_decal_double_diffuse.mt`)

The brow decal writes `sqrt(colour)` with `SrcAlpha/InvSrcAlpha` into GBuffer0, which holds `sqrt(albedo)` [source] ([materials and shaders §2.4](materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it)). The resulting albedo is `(a·√c + (1−a)·√skin)²`. For a dark brow over skin this acts like linear coverage `≈ 2a − a²`, so partial coverage looks denser and darker than a linear blend. The brow colour and coverage formula (gradient at (`GradientMapUV`, 0.5), 1 by default, through a clamping sampler, × intensity × primary RGB + secondary tint; coverage `(p + (1−p)·s·k)²` at default contrast, with `k` = `SecondaryDiffuseAlphaIntensity`: 0.6 in vanilla, 0.7 in the saved Arkhe brow) is in the [brow material study](../research/eye-artistry/brow-lash-fidelity.md) [source]. Vanilla brows also write a normal (0.4, mode 1) and roughness ≈ 0.50; the whole vanilla brow chain, and how brow colour relates to hair colour, is on [eyebrows](brows.md).

### 6.1 What a brow colour looks like, for a swatch

A brow colour's swatch is its **strand colour**: `saturate(gradient × GradientMapIntensity) × tone`, where the tone is the diffuse texture's linear RGB weighted by coverage **squared** (the program squares the filtered primary alpha) [source for the arithmetic; offline for the measurements below]. Three things make it easy to get wrong, all measured on the reference installation (27 September 2026, `tools/cc-swatches.ts` and a scratch probe through the resolver, native decoder):

- **The mip you read.** A mod's own mips can average its strands with the black RGB around them. Arkhe's Beautiful EYEBROWS II style 01 (uncompressed RGBA8 `_d`): coverage-weighted tone linear 0.17 at 64 px, 0.28 at 512, 0.37 at 2048; weighted by coverage squared 0.20, 0.36, 0.49. Vanilla `heb__base_d01` barely moves (0.27–0.32 from 32 to 512 px). The Studio reads a decal's diffuse at 512 px (about a creator close-up's sampling: the strip is 0.14 mm per texel there, [eyebrows §2](brows.md#2-geometry-deformation-and-placement)) with squared weighting. The older 64-px, linear-weighted read made that pack's 35 swatches near black. In game, the mip the GPU picks depends on distance, so a brow can look darker at a distance than close up, and that is real [hypothesis, not checked in game].
- **Intensity.** Arkhe's material (and its SET 01 "2K Material Edit" replacer, which rewrites the vanilla `eyebrows_grad__default.mi`) sets `GradientMapIntensity` 0.5 where vanilla has 2. So with that replacer installed, vanilla brows are also about 0.28 × the gradient colour rather than 0.6 ×. These brows really are darker than the vanilla creator's icons suggest.
- **Gradient replacers.** A hair-tone pack that ships `hh_cap_grad__<colour>.xbm` at the vanilla depot paths (Alliekat's Natural Hair Tones on the reference installation) recolours brows and hair caps alike ([eyebrows §3](brows.md#3-material-and-colour)). It remaps several vivid names to one natural tone: `cold_white`, `cyberpunk_yellow`, `goblin_green`, `liliac`, `mermaid_aquamarine` and `green_orange` all read the same flat auburn gradient (`#8d513e`), and `purple_blonde` a flat `#ab9081`. Those brow colours are **identical in game**, and the game's own creator icons (the vanilla colour icons, which CCXL brow packs reuse) show the old, vivid colours. This is why a swatch must come from the files that win, not from the option's name or icon: the Studio marks such a colour replaced and draws the derived colour instead of the icon.

The derived colour of a whole set can be dark and tightly clustered (the Arkhe pack over Alliekat's tones: OKLab L spread 0.10 against 0.20 for vanilla hair colours). The Character panel then spreads the set apart for legibility and keeps the true colour in the row's chip and the swatch card ([choice previews design §5.5](../research/character-customization/choice-previews-design.md#55-swatches)).

## 7. Resolving which `.hp` a material uses

The saved lash's material requests the dynamic path `…\hair_profiles\{material}.hp`. Both the base game and an installed mod archive provide `brown_liquorice.hp`, with very different stops ([overlap audit](../research/eye-artistry/brown-liquorice-profile-overlap.md)). Mod archives before base archives is a **source-supported expectation**: WolvenKit's lookup order, and ArchiveXL inserting `Mod` groups before base groups. It is not a runtime-proven REDengine rule. Several mod providers need the load-order resolver ([source discovery](../research/authoring/source-discovery-foundation.md); MO2's first `modlist.txt` row wins). Under §3 and the decoded bake, the base-game profile gives the lash an sRGB albedo of (172, 130, 15), a golden tan; the mod profile gives (59, 28, 0), a dark red-brown. An uncontrolled in-game portrait shows near-black lashes, which weakly favours the mod profile. The Studio applies the resolver's generic archive precedence (R1 in the [CC file chain](cc-file-chain.md#8-generic-resolver-specification)) and records the winning archive and the losing candidates in the character render record.

**One profile colours V and every NPC.** Vanilla hair meshes, the player's and NPCs' alike, bind each colour appearance to a shared `…\hair_profiles\{colour}__{long,short,curls,dread,braid,beard}.mi`. Its only override is `HairProfile = …\hair_profiles\{colour}.hp`, over `_master__{style}.mi`, which holds the shared strand textures (`hh_long01_*` and so on) [resource]. Citizen `.app` files use these colour appearances directly (for example `citizen__biker_ma.app` `biker_01`: `hh_112_ma__kicinski_common.mesh` in `brown_liquorice`). A same-path `.hp` replacer therefore recolours V and every NPC wearing that colour at once.

**What a colour replacer changes.** Alliekat's Natural Hair Tones replaces all 36 shared colour profiles. It keeps every stop position and its stored order and changes only colours, including 59 exact preset-palette colours [resource]. A replacer that keeps the positions keeps what they meant in the vanilla ramp, not in the new colours: vanilla `brown_liquorice` has a stop at 0.18 from the root, and the replacer's brightest colour (`#ffffcc`) sits there. The resulting albedo is pale yellow at the root and saturated brown at the tip, the reverse of the vanilla light direction. When hair looks wrongly tinted, diff the winning `.hp` stops against the base game before suspecting colour space or shader arithmetic: in this case, the stored colours alone explained the look ([yellow-hair investigation](../research/character-customization/yellow-hair-profile-override.md)). Many NPC hairdos in the reference installation show this yellow-to-brown look in game, which the vanilla profiles cannot produce. That is anecdotal support for mod-over-base on `.hp` resources: an in-game observation with no capture on file, so [hypothesis] until one is recorded.

The same replacer explains the blonde-to-orange gradient the preview shows on the default V with hairstyle 12 on the reference route (27 September). The default colour, `brown_liquorice`, resolves to the replacer's `.hp` for every hairstyle. Its root-to-tip stops are (153, 102, 0) at 0, `#ffffcc` at 0.182, (92, 52, 24) at 0.614 and (102, 51, 0) at 1, where the base game's are grey-browns lightening to (214, 197, 174) at the tip [resource]. Those stops already span 0 to 1, so the game's rescaling (§3) leaves them as they are, and the preview's earlier lack of it was not the cause. Only the ID stops (0.080 to 0.879) are stretched, which changes per-strand brightness, not hue; the preview has stretched them too since the bake landed (27 September, §8). Hairstyle 12 comes from a hair replacer pack whose meshes use the pack's own strand-gradient texture rather than the vanilla `hh_long01_grad01_r.xbm` the other hairstyles use. How far along the length its values reach the pale 0.18 stop decides how much of the band shows [hypothesis: the texture's values were not read].

**Additive colours** do not touch these shared profiles. A CCXL colour pack adds new-named colours to the player's creator rows, and ArchiveXL builds each colour's material from the hairstyle's own base material plus the pack's `.hp` ([CC file chain: hair-colour additions](cc-file-chain.md#hair-colour-additions)). NPCs keep the vanilla profiles. The installed packs mostly keep vanilla stop positions and repaint the colours, and many of their ramps don't span 0 to 1, so the bake stretches them. The [authoring study](../research/hair/hair-colour-authoring-feasibility.md#5-what-makes-a-hair-colour-look-good-in-game) collects what makes a profile read well in game, including a stop encoding whose baked texels equal the authored colours exactly [offline].

**Several colours on one hairstyle.** `hair.mt` has no region mask. The only per-card inputs are the `Strand_ID`, `Strand_Gradient` and `Strand_Alpha` textures and the vertex-red shadow term (§1). One profile can therefore vary colour along the length (root-to-tip) and between strands (the ID ramp, spread by the hairstyle's own `Strand_ID` texture), but never by region: bangs against lengths, or one side against the other [source]. Mods that give regions their own colours cut the hairstyle into separate meshes, each with its own material, profile and creator colour row. The Multicolored Hair framework does exactly this, with up to three parts ([CC file chain: multi-part hairstyles](cc-file-chain.md#multi-part-hairstyles-multicolored-hair)) [resource]. Each part binds its colour's `.hp` like any CCXL hair, and only the part that carries the cap chunk colours the scalp.

For the saved hair, `38_ash_brown` resolves to redacted-c01's `ash_brown.hp` through ArchiveXL's dynamic appearance. The game's own ArchiveXL log records that expansion for both saved meshes, and a single archive provides the profile. Its stops are light-to-mid warm browns with a black root band, so the in-game near-black look comes from lighting, not from a wrong profile ([calibration note](../research/eye-artistry/hair-calibration-2026-09-25.md#1-which-profile-the-save-uses)).

## 8. Browser preview mapping

Code: `src/hair-colour-model.ts` (pure, tested), `src/hair-shading.ts` and `src/brow-material.ts` (Three adapters), selected per chunk by its template in `src/character-material-adapters.ts`; `src/stage-backdrop.ts` and `src/viewport-backdrop.ts` (the opaque stage). Since P0 the inputs are the resolved chunk's own: effective `hair.mt` scalars (instance chain, then template defaults), the winning `.hp`, and each texture with its `isGamma` flag, for any vanilla or CCXL hair, lash or brow choice.

| Game step | Preview | Status |
|---|---|---|
| Profile bake | `bakeHairProfile` (27 September): stops sorted and rescaled to span 0 to 1 (even spacing under a 0.001 range), `t = k/N`, 8-bit interpolation truncated to a byte, sRGB decode; `sampleHairGradient` shows raw colours at the same rescaled positions | Faithful to §3 [source]. A single-stop profile colours the whole row (the game's 0/0 is undefined) |
| Truncated lookup, overlay, shadow term, `\|c\|` | Float profile texture (ID row, root-to-tip row), `texelFetch` | Faithful to §3 |
| Coverage | Remapped `Strand_Alpha.r`, stretched over the dither range (`hairResolvedCoverage`); strands and lashes are unblended, depth-writing, MSAA alpha-to-coverage with no alpha test (lashes still draw after the makeup layers) | Coverage fraction and its nesting faithful to §2 (see below); colour mixing within a pixel approximate (no 3-layer k-buffer) |
| Hair cap (`mesh_decal_gradientmap_recolor.mt`) | Mask-blended decal over the scalp (no depth write, no alpha test); gradient indexed by the mask | Linear "over" blend, lighter at partial coverage than the engine's sqrt-space blend |
| Lighting | Hair-class direct light (§5, gates and per-strand shift included) on the skinned bitangent: directional lights with the `GlobalLight` intensities, spot lights with the `LocalLight` intensities 0.35, 0.8, 0.47 ([creator lighting §9](creator-lighting.md#9-the-studios-creator-lighting-preset)); card specular off. Environment (27 September): the same model once for `L_e`, with the `EnvProbe` intensities and `AdditionalAreaRoughness`, lit by Three's ambient, hemisphere, light-probe and image-based irradiance taken along `L_e`; it replaces Three's indirect diffuse (albedo twice) and indirect specular. Every option value is in `HAIR_LIGHTING_VANILLA`, so a runtime preset can carry its own | Faithful to §5, structure and executable defaults [source]. The irradiance is Three's, not the game's six-colour cube; under the creator preset, which has no environment, the path adds nothing, as in the creator ([creator lighting §10](creator-lighting.md#10-indirect-light-what-reaches-v)). Without a tangent frame (none in practice) the ambient diffuse is only scaled by `EnvProbe/MultiScatter` |
| Brow decal | Per-vertex skin albedo under each brow vertex; solves an equivalent linear "over" blend | Faithful where the sampled skin albedo is right; the brow's normal and roughness writes are not drawn (fixed roughness 0.8) |

### Preview coverage

The engine's coverage (§2) is a shared per-pixel threshold, resolved over frames. The preview reproduces its two properties that matter for how dense hair looks:

- **Nesting.** MSAA alpha-to-coverage (`STRAND_COVERAGE_MATERIAL` in `src/hair-shading.ts`) gives each fragment a sample mask that grows with its alpha, so overlapping layers cover about as much as the most opaque one, as in the game. Stochastic or hashed alpha with an independent threshold per layer would give `1 − Π(1−a)` and make hair denser than the game. Alpha blending also combines layers independently, and it is order-dependent as well.
- **Range.** The fragment alpha is `hairResolvedCoverage(remapped alpha)`, which stretches coverage over the dither range, so strands above about 0.84 are solid.

Alpha-to-coverage is deterministic, so there is no grain to accumulate over frames and render-on-demand needs nothing extra. Its limits: four MSAA samples quantise coverage (the driver dithers the masks); colour within a pixel comes from whichever layer owns each sample, not from the alpha-weighted average of the three nearest layers; and TAA's temporal smoothing is not reproduced (the [Hair look](#hair-look) approximates it on request).

**The canvas is opaque.** Three.js always creates its WebGL context with an alpha channel (its `alpha: false` only clears alpha to one), and alpha-to-coverage and the cap wrote their partial alpha into it. The page's CSS stage then showed through the hair, most of all where strands cross the scalp, so saved hair looked much lighter in the light UI theme than in the dark one. The Studio now creates the context with `alpha: false` and draws the theme's stage gradient itself (`src/viewport-backdrop.ts`). The gradient is an untone-mapped background that does not light the scene. After the fix, hair over the character measures the same in both themes ([coverage note](../research/eye-artistry/hair-coverage-2026-09-25.md)).

### Hair look

The preview's faithful coverage (above) draws strands thinner and crisper than the game shows them: the game's dithered coverage is smoothed over frames by TAA or DLSS, and may be boosted by the ×1.33 flag (§2), neither of which the preview reproduces. **Hair look** (Preview quality › Rendering) is a viewing preference from **Crisp** (0, the default: exactly the coverage above) to **Game-like** (1). It blends three terms linearly with the slider, all in the strand coverage shader (`STRAND_COVERAGE_GLSL` in `src/hair-shading.ts`, mirrored by `hairLookCoverage` in `src/hair-colour-model.ts`, constants `HAIR_LOOK`):

| Term | At Game-like | Grade |
|---|---|---|
| Coverage boost | Remapped alpha × 1.33, the factor `hair_alpha_accum` applies when its global flag is set | The factor is [source]; whether the flag is set in game is **unconfirmed** (open question 4), and whether `hair_gbuffer_solid` applies it too is not decoded |
| Widening | The remap threshold lowered to 0.7 × `AlphaCutoff`, so a strand's soft edge counts | Approximation, no game counterpart |
| Smoothing | The strand alpha sampled with a mip bias of 1, a hair-only blur standing in for TAA's temporal smoothing | Approximation of TAA/DLSS, not a model of it |

Every strand of a scene reads one uniform, so moving the slider recompiles nothing, and each view keeps its own value (the view graph's display node). At 1920 × 1080 on an RTX 4070 (headless Chrome, ANGLE D3D11, the default masculine V, 27 September 2026, minimum of six alternations of 60 frames) a frame took 1.34 ms at Crisp and 1.37 ms at Game-like, within the timing's noise. The export is unaffected: the mod ships the game's own `hair.mt` data. A side-by-side capture against the creator's hair page in game would settle how far Game-like should go; until then its extent is a visual judgement.

### Hair in the shadow maps

Hair strands cast by their coverage (the alpha map's red channel, tested at 0.5), but only into the maps of lights the game shadow-maps (`enableLocalShadows`: Rim_Top, Fill_Upper, Highlight_Right among the head's casters). The creator's contact-only lights (Main_Face, Rim_Right and the magenta head rim: `contactShadows` `CSR_CharacterOnly` alone) get a head-scoped map in the preview as a stand-in for the game's short character march, and that map holds the skin, body and clothing but no hair (`platform/scene/shadow-casters.ts`, PREV-167) [resource for the flags; the game's march length is not decoded, [creator lighting §9](creator-lighting.md#9-the-studios-creator-lighting-preset)].

Why: with hair in the stand-in maps, the two low rear rims, which graze the side of the face, printed the hair hanging behind the ear across the cheek, jaw, ear and neck as soft reddish or cyan bands, centimetres from the hair. A report on 28 September described it as brown strands showing through the face (a save V wearing the CCXL Chevelle updo, Character creator lighting, a held smile). Reproduced in a `?verify=1` workspace with the same hairstyle: the bands went with Face shadows off and stayed with skin scattering or the contact term off; soloing the lights put them on Rim_Right and Rim_Left_Head [observed in the browser]. A contact march only reaches a few millimetres or centimetres along the screen, so the game cannot draw them from these lights [hypothesis until an in-game close-up of the same pose]. Hair lying on the skin still darkens it through the preview's own contact term. Captures (private): `local/captures/rendering/2026-09-28-cheek-hair/hair-*`.

### Creator ladder (session 3)

Session 3 photographed the mirror's hair page (2.0 m) with four of redacted-c01's hair colours on the `lm097_hair` style (LONG PAK #011). It used the Character Rendering Editor's Vanilla preset, with ReShade off and Nova LUT 3.0 as the grade. The Studio rendered the same V, hairstyle and colours under the Character creator preset at the matched framing, with the rig turned with V ([creator lighting §12.6](creator-lighting.md#126-refit-from-two-captures-28-september)).

**Method.** The mask keeps hair only, with no background. A pixel counts as hair where:

- the platinum frame is at least 1.8 times brighter than the ash-brown frame, and the ash-grey frame 1.3 times (display-linear);
- it is not backdrop-coloured in any frame;
- it lies outside the face.

The mask is then eroded by 7 px at 3840 × 1600, leaving 81,000 pixels in the game frame and 115,000 in the Studio's. Each pixel is inverted through the Nova LUT's full display transform and averaged in scene-linear light. An earlier quick attempt sampled the backdrop. A mask built from a display-linear difference alone keeps only the lit strands and gives much flatter ratios (2.1, 2.6, 2.9), so it is not used.

| Scene-linear luminance, ratio to `38_ash_brown` | `39_ash_grey` | `74_steel_smoke` | `66_platinum_blonde` |
|---|---:|---:|---:|
| Mean albedo, decoded bake ([calibration note](../research/eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request)) | 3.1 | 4.2 | 6.6 |
| Studio render (decoded bake), whole hair | 2.8 | 4.0 | 6.6 |
| **Game**, whole hair | **4.7** | **7.2** | **9.8** |
| Game / Studio: crown | 3.8 / 2.5 | 10.1 / 3.9 | 14.0 / 6.3 |
| Game / Studio: lengths on the screen-left side | 5.2 / 2.7 | 9.6 / 4.2 | 13.4 / 6.8 |
| Game / Studio: lengths on the screen-right side | 4.1 / 3.0 | 5.6 / 4.1 | 9.1 / 7.1 |

At the adopted calibration the preview's ash brown is 1.25 times the game's level, and the lighter colours are 0.69–0.84 of it. The hue per colour, as scene-linear R/G for the game against the preview, is 1.14 against 1.36, 0.91 against 1.05, 0.87 against 0.98 and 0.94 against 1.18. The game's hair is cooler than the preview's in every colour.

**Verdict** [runtime, one session]:

- **The bake holds as far as the preview can test it.** The Studio bakes the profiles exactly as the executable does (§3), and it renders the table's spread under the creator light.
- **The game's ladder is steeper, but the gap is not in the bake.** Its colours are 1.5–1.8 times further apart than the albedos predict. A bake that steepened the ladder, such as a second sRGB decode, would also saturate the colours. The game's colours are less saturated than the preview's, not more.
- **The missing light grows with albedo and is cool.** It is largest at the crown and on the lengths away from the key. It lifts the cool `steel_smoke` most and the warm `platinum_blonde` least, and no single term proportional to albedo fits all three colours.
- **Candidates** [hypothesis]:
  - ray-traced diffuse light reaching the hair through its ambient path, which carries albedo twice (§5); the reference install runs ray-traced lighting at Ultra;
  - the preview's Rim_Top fold, which under-lights the crown about twofold ([creator lighting §12.4](creator-lighting.md#124-what-remains));
  - the TRT lobe's response to the cool rims.

  The same ladder with ray-traced lighting off separates the first candidate from the others.

**The usual preset** [runtime, one frame each; pose-independent means over every hair pixel]. Arkhe Balanced renders the same ash-brown hair at 0.72 of the Vanilla level on average (median 0.88; upper quartile 0.63, where the highlights sit). AlbedoMultiplier alone would give 0.81. The rest comes from the wider roughness and the weaker TRT (`EXP_BIAS` 2.58). The Vanilla frames span 0.0207–0.0220 over 18 frames, so the drop is well outside the pose's noise. Skin keeps its luminance under both presets and reads about 6/255 bluer under Arkhe Balanced, from its specular tint.

The preview keeps `HAIR_LIGHTING_VANILLA`, because the calibration frames are Vanilla and the preview cannot read a session's options yet. The runtime bridge can read them (`game.options.read` produced the dumps), so a later step could pass a running game's hair options into the preview.

## Open questions

1. **Answered for session 3** [runtime]: the bridge's option dump under the Vanilla preset reproduces the executable defaults, and Arkhe Balanced changes the values listed in §5. Other CET mods were not isolated.
2. Which `brown_liquorice.hp` the game binds for the saved lashes. NPC hair in game weakly favours the mod copy (§7); a controlled with/without comparison is [head CC rendering test ask 7](head-cc-rendering.md). Expected: base (172, 130, 15), Alliekat (59, 28, 0).
3. Whether hair in ambient light really carries its albedo twice (§5): a ladder in the mirror (no ambient) against the same ladder lit only by ambient light should show roughly squared ratios ([hair reference test ask 3](../research/materials/shader-hair.md#13-in-game-test-asks-batch-into-the-prepared-session)).
4. The global flag that multiplies coverage by 1.33, and whether the dither's per-frame register is a plain frame counter. The preview's [Hair look](#hair-look) applies the factor at its Game-like end without knowing whether the game sets the flag.
5. Sign of the strand direction (root→tip) as stored in GBuffer1, which sets the direction of the R/TRT shifts.
6. How much self-shadowing, contact shadows, rain wetness and tone mapping darken hair in typical scenes. The base-colour pass alone scales colour by down to 0.25 when the character is wet. The game's SDR display transform (LogC3 into a 3D grading LUT) is decoded in [creator lighting §5](creator-lighting.md#5-tone-mapping-and-grading).
7. Which of the eight ambient-composite variants a frame uses, and the ray-traced and path-traced hair paths.

## Sources

- Compiled 2.31 programs from `shader_final.cache` (SHA-256 `339145…3ccfa`) and `staticshader_final.cache` (`bff160…59ff`), disassembled with Windows SDK `dxc` and decompiled with dxil-spirv and SPIRV-Cross.
- The 2.31 `Cyberpunk2077.exe` (SHA-256 `a7de8294…0991`), read with Capstone through [`exe_hair.py`](../research/materials/shader-system/exe_hair.py): option defaults and registers, the per-light factor, and the profile bake ([hair reference §6.4 and §7](../research/materials/shader-hair.md#64-option-values-and-registers-executable)). Method: [shader-system evidence note](../research/materials/shader-system/README.md); hashes: [evidence note](../research/eye-artistry/hair-colour-pipeline-2026-09-25.md).
- Installed `hair.mt`, the vanilla eyelash `.mi` chain, 72 vanilla `.hp` profiles and the female creator resource (private extractions with WolvenKit CLI 9.0.1).
- [wiki] `for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial/vertex-color-and-hair.md` (manavortex, based on redacted-c01's notes). Its screenshot `.gitbook/assets/hair_vertex_colour_1.png` shows red-painted cards rendering dark in game. `…/configuring-materials/hair-and-skin-material-properties.md` gives the parameter names and the `AlphaShifts` option.
- Cyberpunk Blender add-on at `7a4ee79`, `material_types/hair.py`: an empirical multiply-with-gamma importer, used here only as a comparison hypothesis.
- Arkhe's [Character Rendering Editor](https://www.nexusmods.com/cyberpunk2077/mods/32842) (installed package 3.0.0.0, `parameters.lua` and `presets.lua`, targeting 2.31): the hair GameOption names and its vanilla list, which the executable's defaults confirm, and the "Arkhe Balanced" preset the reference install runs [community].
- RED4ext SDK's generated `CHairProfile` and `rendGradientEntry` layouts, which located the bake in the executable.
- Alliekat's [Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787) 1.0.0.0: 36 replaced colour profiles, diffed against the base game.
- redacted-c01's Hair Profiles CCXL: its 45 `.hp` profiles and selector-icon atlas, used as a designer colour reference.
- B. Karis, "Physically Based Hair Shading in Unreal", SIGGRAPH 2016 course notes: the published model the decoded light matches.
- Earlier research: [lash material](../research/eye-artistry/lash-material-followup.md), [hair profile resolution](../research/eye-artistry/saved-hair-profile-resolution.md), [brow material](../research/eye-artistry/brow-lash-fidelity.md).
