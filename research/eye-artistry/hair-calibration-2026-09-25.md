# Hair colour calibration against an in-game portrait

25 September 2026. Why the preview's saved hair read warm and light when a supplied in-game portrait of the reference character shows near-black hair with a cool sheen, which hypotheses the data rules out, and what changed. The consolidated model is in [hair shading](../../knowledge/hair-shading.md); the earlier pipeline evidence is in the [colour pipeline note](hair-colour-pipeline-2026-09-25.md). No game launch took place. The portrait, extracted resources, renders and crops stay in ignored local folders; this note records names, hashes and measurements only. **Game parity is not claimed.**

Grades as in the [knowledge rules](../../knowledge/README.md): [source] compiled programs or executable strings; [resource] installed game or mod resources; [runtime-log] a game session's own log; [community] a third-party tool's documented values, not checked by us; [hypothesis].

## Result in brief

- **No data or interpretation bug in the colour chain.** The save selects `38_ash_brown`, which resolves to redacted-c01's `ash_brown.hp`; the game logged that expansion for both saved hair meshes. Its stops are light-to-mid warm browns with a near-black root band, not dark or cool. The root-to-tip direction, the ID channel, the texture colour spaces and the shader arithmetic all check out.
- **The lighting constants were the main error.** The preview used Karis's published defaults for the hair light. The game's own option values, listed for game 2.31 by a CET tool, differ a lot: multiple-scatter (diffuse) intensity 0.47 instead of 1, R 0.3 instead of 1, and a much tighter diffuse wrap. The preview also left out two gate terms that are in the compiled program. With both fixed, the preview hair's brightness relative to skin falls from 0.20 to 0.093. The portrait gives 0.060, under uncontrolled lighting.
- **The bake colour space stays sRGB-decoded.** Two designer colour sets agree with it on hue and show a roughly uniform brightness factor, not a steeper curve.
- **What remains is a calibration question.** The portrait's cool hue and its extra darkness need a controlled capture. The capture request is [below](#refined-capture-request).

## Inputs and their limits

| Input | Identity | Limits |
|---|---|---|
| In-game portrait | 2000×1600 JPEG, SHA-256 `13094bfd…6776747` (listed in `research/backlog/preview-fidelity-references.json`) | Uncontrolled overcast street, depth of field, legacy eye makeup. The file carries Photoshop export metadata, so tone edits cannot be excluded. It was also taken with the install's colour-grading ReShade preset active and with a replacement grading LUT installed ([creator lighting §5](../../knowledge/creator-lighting.md#5-tone-mapping-and-grading)). Its last write (11 September 2026, 03:53 UTC) predates `AutoSave-12` (13 September); saves from that day use hairstyle `logan_hair`, not `lm097_hair`. |
| Saves | The twelve newest local saves, decoded read-only | Every one from June to 13 September selects hair colour `38_ash_brown`. The hairstyle changed from `logan_hair` to `lm097_hair` between 11 and 12 September. The lashes are `05_brown_liquorice` except in `QuickSave-0`. |
| Resolver | Generic character resolver (`tools/resolve-character.ts`, branch `claude/cc-resolver` at `d92d68a`), MO2 profile `2025 (again)`, reference save | Tool-source precedence rules, described in the resolver's `knowledge/mod-loading.md` (same branch). |
| ArchiveXL log | `ArchiveXL-2026-09-13-19-27-56.log` in the MO2 overwrite, the session that wrote `AutoSave-12` | Logs patches and expansions, not material instantiation. |
| Character Rendering Editor | Arkhe, [Nexus 32842](https://www.nexusmods.com/cyberpunk2077/mods/32842), installed package 3.0.0.0, `parameters.lua`/`presets.lua` targeting game 2.31; enabled in the reference profile | Its "Vanilla" preset is the author's record of the defaults [community]. Its active preset in the reference install is "Arkhe Balanced", per its saved state file. |

## 1. Which profile the save uses

| Step | Evidence | Grade |
|---|---|---|
| Saved choice | `lm097_hair` = `38_ash_brown`, tag `ash_brown`, in all twelve saves | [resource] |
| Definition provider | redacted-c01's `id_pwa__hair_profiles_ccxl.inkcharcustomization` (the only provider of that definition); option from MELUMINARY's `lm097_hair.inkcharcustomization` | [resource] via resolver |
| Expansion | Resolver: `38_ash_brown` → mesh appearance `ash_brown`, expanded from the MEL `black_carbon` chunks; `ash_brown@long` instantiates `template__long.mi` → `HairProfile = redacted-c01\id_hair_profiles_ccxl\hair_profiles\ash_brown.hp` | [source] ArchiveXL rules |
| Runtime | 13 September session log: *Appearance "ash_brown" from redacted-c01 patch.mesh added to* `lm127_hair_pt1.mesh` and `lm097_hair_pt2.mesh`, then *has been expanded using "black_carbon"* for both. No errors mention these meshes, the templates or the profile. | [runtime-log] |
| Provider of `ash_brown.hp` | Single provider (`id_hair_profiles_ccxl.archive`), so no mod-over-base or mod-versus-mod rule is involved | [resource] |

Stops of `ash_brown.hp` (sampleCount 127), as stored:

| | Stops (position: RGB) |
|---|---|
| Root to tip | 0.146: (16,10,8) · 0.411: (186,165,142) · 0.568: (143,123,110) · 0.831: (65,47,41) · 1.0: (193,168,149) |
| ID | 0.116: (129,122,106) · 0.552: (173,168,180) · 0.996: (94,94,94) · 1.0: (255,255,255) ×2 |

These are warm light-to-mid browns with a black root band. Under any monotone colour transform they are no darker than the vanilla `brown_liquorice` stops, whose creator swatch is (50,44,40).

**Also checked:** the saved hair appearance adds a `hair_shadow` component (`base\mel_ccxl_hair\meshes\hair_shadow.mesh`, glass material with tint 5/5/5). Its render blob holds two chunks of 3 vertices and 3 indices each, inside a 16 cm box at eye height. It is a stubbed mesh that draws nothing visible, not a darkening shell [resource]. Its SHA-256 `653522de…` is identical in the MEL provider archives checked.

## 2. Hypotheses

| Hypothesis | Test | Verdict |
|---|---|---|
| (a) Stop colour space: decoded / raw / add-on formula | The shader: the profile row is a float texture read with `Load` (texel 0 holds the sample count), `basecolor_blend` applies no gamma, `pow` or clamp beyond `|c|`, and `gbuffer_solid` writes `sqrt(avg)` [source]. Designer references, via `tools/hair-profile-swatch-fit.py`: see the table below. | Keep sRGB-decoded [hypothesis, best supported] |
| (b) Wrong profile | Section 1 | Rejected |
| (c) Gradient direction or ID channel | Of the 910 connected strand cards of `lm097_hair_pt2` with a clear scalp end, that end has the lower `Strand_Gradient` value on 868 and the higher on 42 [resource geometry]. `hair_lm60_id` is greyscale (R = G = B in every texel), so the channel does not matter. Both are `isGamma=0`. | Rejected |
| (c′) Mipmapping of index textures | The strand maps have `hasMipchain=0`, so the game samples level 0. The preview generates mips. Averaging before the truncated lookup shifts the coverage-weighted mean by at most 7 sRGB levels (74 → 81 at mip 4) | Minor; not changed |
| (d) Vertex-red darkening, AlbedoMultiplier, tint | Strand vertex colour is zero, so the shadow term is inert. AlbedoMultiplier is 1.0 in vanilla [community]. The reference install runs "Arkhe Balanced", which sets it to 0.8091. Separately, the base-colour pass multiplies by a rain-wetness factor down to 0.25 when the character is wet [source] | Explains at most 0.81× (plus wetness, if it rained); calibration |
| (e) Lash profile: base or Alliekat | Under the model, base `brown_liquorice.hp` gives golden tan (177,136,44) and Alliekat's gives dark red-brown (62,30,0). The portrait's darkest lash-box decile is 3 % of skin luminance, close to the mod candidate after the same lighting factor as the hair. The base candidate would need about 28× darkening. The box also contains near-black legacy eyeliner. | Weakly favours Alliekat, as the resolver picks. Not proof |
| Lighting constants | Section 3 | **Error found and fixed** |

Designer-reference fits (uniform ID × gradient grid; exposure is reference luminance / model luminance):

| Hypothesis | Vanilla creator swatches (24): median angle, median exposure, log-exposure spread | redacted-c01 selector icons (45) |
|---|---|---|
| Overlay, stops sRGB-decoded (preview) | 5.2°, 0.93, 0.64 | 7.5°, 0.61, **0.32** |
| Overlay, stops raw | 19.1°, 0.40, 0.92 | 16.3°, 0.30, 0.41 |
| Overlay, stops³ | 6.4°, 1.45, 0.55 | 6.9°, 0.95, 0.39 |
| Overlay decoded, squared | 9.1°, 1.71, 0.58 | 10.2°, 1.05, 0.54 |
| Overlay, stops decoded twice | 9.6°, 3.45, 0.64 | 11.5°, 2.56, 0.64 |
| Blender add-on `id^2.2·rt^4.5` | 9.0°, 3.86, 0.60 | 10.7°, 2.74, 0.51 |

The decoded model has the best or near-best hue on both sets and the tightest brightness spread on the icon set. Its icon exposure of about 0.6 is a common factor, the kind a lighting response produces, not a curve. The `ash_brown` icon is a dark ash brown: mean sRGB (62,46,43), from (99,69,66) at the top to (25,16,5) at the bottom. A steeper curve fits the natural-colour swatches' brightness better, but it spreads the icon set more and worsens hue. The Blender add-on's formula is an empirical match to NPC hair in Blender lighting; its author calls the root-to-tip exponent a workaround.

## 3. Hair light constants

The 2.31 executable contains the option groups `Editor/Characters/Hair`, `…/AlphaShifts`, `…/TRT_Params`, `…/MultiScatter`, `…/Specular`, `…/GlobalLight`, `…/LocalLight`, `…/EnvProbe` and `…/HACKS`. It also holds the value names `R`, `TRT`, `MultiScatter`, `EXP_SCALE`, `EXP_BIAS`, `Wrap`, `Mask_Intensity`, `DiffuseScatterFactor`, `ShadowFactorExp`, `AlbedoMultiplier`, `RoughnessFactor`, `AdditionalAreaRoughness`, `SpecularRandom_Min/Max`, `ContactShadowClamp`, `UseLocal/GlobalContactShadowsOnHair`, and the config variables `cvHairR_EnvProbe`, `cvHairScatter_EnvProbe` … [source strings].

Re-reading the Hair branch of `m_shaderLightsComputeGlobalOnly_Clustered_00010001` (decompiled with dxil-spirv/SPIRV-Cross) shows two terms the preview had left out:

- The **R lobe** is multiplied by `clamp(clamp((N·L + cb0[19].y)/(1 + cb0[19].y)²) + 1 − cb0[19].z)`.
- The **diffuse** is multiplied by `clamp(w + 1 − cb0[18].w)`, where `w` is its own wrapped N·L.
- The R-lobe width uses `r / cb0[17].x`.
- A per-strand shift `frac(frac(ID·0.0729477)·52.98292)`, scaled into `[cb0[17].z, cb0[17].w]`, is added to the R angle and subtracted in the TRT lobe.

The register-to-option pairing below follows each register's role in the program and the option names [hypothesis]. The values are the Character Rendering Editor's "Vanilla" preset [community].

| Register | Role in program | Option | Vanilla | Karis (old preview) | Arkhe Balanced (reference install) |
|---|---|---|---:|---:|---:|
| cb0[16].x | R shift angle | AlphaShifts/R | −0.083 | −0.07 | same |
| cb0[16].z | TRT shift | AlphaShifts/TRT | −0.5 | 0.14 | same |
| cb0[17].z/w | per-strand random shift range | SpecularRandom_Min/Max | −0.2 / 0.2 | 0 | same |
| cb0[17].x | R width divisor | RoughnessFactor | 1.0 | 1 | 1.1968 |
| cb0[17].y | albedo multiplier | AlbedoMultiplier | 1.0 | 1 | **0.8091** |
| cb0[12].x/z/w | R / TRT / diffuse intensity | GlobalLight/{R,TRT,MultiScatter} | 0.3 / 0.8 / **0.47** | 1 / 1 / 1 | same |
| cb0[18].x/y/w | diffuse wrap / Kajiya mix / gate | MultiScatter/{Wrap,DiffuseScatterFactor,Mask_Intensity} | 0.35 / 0 / 1 | 1 / 0.33 / (absent) | 0.4364 / 0 / 1 |
| cb0[19].y/z | R wrap / gate | Specular/{Wrap,Mask_Intensity} | 0.3 / 1 | (absent) | same |
| cb0[20].x/y | TRT azimuth `exp(x·cosφ − y)` | TRT_Params/{EXP_SCALE,EXP_BIAS} | 1 / 1.5 | 17 / 16.78 | 1 / 2.5795 |
| — | environment-probe path (not decoded) | EnvProbe/{MultiScatter,R,TRT} | 0.47 / 0.3 / 0.8 | — | same |

The preview now defaults to the vanilla column (`HAIR_LIGHTING_VANILLA`) and implements the two gates and the per-strand shift. It also scales Three's ambient diffuse on hair by `EnvProbe/MultiScatter`, which approximates an undecoded path [hypothesis]. It does not read the Arkhe preset: GameOptions are per-install runtime state, and the Studio has no generic way to read them yet.

## 4. Before and after (fixed cameras, isolated `?verify=1`)

Captured with `tools/hair-colour-look.ts` (reference save, exposure 1.2, key angle 0; the same three cameras as the pipeline note) and measured with `tools/hair-colour-stats.py`. Values are the mean display sRGB of the pixels each detail changes. Ratios are luminance relative to the mean of three skin boxes in the face view.

| View | Hair before → after | Lashes before → after |
|---|---|---|
| Face | (109,94,87) → (77,64,58); hair/skin 0.201 → 0.093 | (128,90,84) → (114,83,82) |
| Eye | (123,101,93) → (92,74,68) | (111,73,64) → (91,63,60) |
| Hair ¾ | (103,88,82) → (68,56,50) | (126,91,84) → (113,84,81) |

Portrait, same measures (private crops of the scalp, the part and the lengths either side of the face, versus forehead and cheeks): hair (35,38,43), hair/skin **0.060**. The portrait's skin is near-neutral (blue/red 0.83 in linear), while the skin albedo is warm (0.46). The scene light or grade is therefore strongly cool. After white-balancing by skin, the portrait's hair is roughly neutral-warm (blue/red 0.80). It is consistent with a dark diffuse term plus a neutral specular term that takes the colour of the cool environment.

Visual inspection at normal and enlarged size:

- The lengths changed from pale beige-brown with a silvery sheen to a mid-dark ash brown close to the pack's own `ash_brown` icon.
- The roots stay near-black.
- The highlights are softer and spread by the per-strand shift.
- The lashes are slightly darker.
- The browser reported no new shader errors. One existing precision warning is unchanged.

## 5. Evidence grade of each factor in the chosen model

| Factor | Model | Grade |
|---|---|---|
| Profile selection | `ash_brown.hp` from Hair Profiles CCXL | [runtime-log] expansion, [resource] single provider |
| Profile sampling | Truncated lookup, overlay with root-to-tip as base, `|c|` | [source] |
| Stop bake | Linear interpolation of 8-bit stops at `k/(N−1)`, then sRGB decode | [hypothesis], best of the tested set on two designer sets |
| Direction, channel, texture colour space | Root = 0; red channel; `isGamma=0` | [resource] |
| Vertex-red shadow | Inert for these strands | [resource] |
| Light structure (R, TRT, gated diffuse, per-strand shift) | As decoded | [source] |
| Light constants | Vanilla option values | [community] values, [hypothesis] register pairing |
| Environment lighting | Three ambient × EnvProbe/MultiScatter; no hair environment specular | [hypothesis] |
| Wetness, contact shadows, self-shadowing, tone mapping | Not modelled | Open |

## Remaining uncertainty

- **Brightness.** The portrait's hair is still about 1.5× darker relative to skin than the preview. Candidates are the reference install's AlbedoMultiplier of 0.81, self-shadowing and contact shadows the preview lacks, rain wetness (up to 4× darker), the undecoded environment-probe path, the game's tone curve and grading, and any Photoshop edit.
- **Hue.** The portrait's cool sheen is most likely environment specular (EnvProbe R/TRT), which the preview does not model.
- **Unconfirmed values.** The option values come from a third-party list, and the register pairing is inferred. Neither has been confirmed by a dump from our own game session.
- **Lash winner.** The runtime winner for `brown_liquorice.hp` has only weak photographic support.

## Refined capture request

One session, current stable ArchiveXL/TweakXL/CET, the usual MO2 profile. Steps 1 and 2 settle the constants; step 3 settles the bake curve independently of lighting.

1. **CET console dump (highest value).** Run each group below and paste the console output:

   ```lua
   for _, g in ipairs({ "Editor/Characters/Hair", "Editor/Characters/Hair/AlphaShifts", "Editor/Characters/Hair/TRT_Params",
     "Editor/Characters/Hair/MultiScatter", "Editor/Characters/Hair/Specular", "Editor/Characters/Hair/GlobalLight",
     "Editor/Characters/Hair/LocalLight", "Editor/Characters/Hair/EnvProbe", "Editor/Characters/Hair/HACKS" }) do
     GameOptions.List(g)
   end
   ```

   Run it twice. The first run uses the Character Rendering Editor's active preset, as normally played. For the second, select its "Vanilla" preset (or disable the mod and restart). This records the values in play and checks the mod's vanilla list.
2. **Photo mode under a known neutral light.** V's apartment or another interior with no sky in view. Clear weather: no rain or wet hair, since wetness darkens hair up to 4×. Fixed time of day. Use one CharLi or photo-mode light in plain white. Turn off depth of field, vignette, grain and camera effects; HDR off. Save PNGs straight from the game with no editing. Take three frames without moving the camera between them: face front (about 30° vertical FOV), left-eye close-up, and hair three-quarter.
3. **Character-editor colour ladder (removes lighting).** Keep the `lm097_hair` style and the same framing, and take one frame for each of these redacted-c01 colours, all single-provider: `38_ash_brown`, `39_ash_grey`, `74_steel_smoke` and `66_platinum_blonde`. Expected luminance ratio of the lengths to `ash_brown` (scene-linear; the game's tone curve compresses displayed ratios):

   | Bake | ash_grey | steel_smoke | platinum_blonde |
   |---|---:|---:|---:|
   | Raw stops | 1.5 | 2.1 | 2.3 |
   | sRGB-decoded (preview) | 2.2 | 4.9 | 6.4 |
   | Stops³ | 2.7 | 7.5 | 10.8 |

   Add one frame with the lashes on `05_brown_liquorice`. Alliekat's profile gives dark red-brown and the base profile gives golden tan, which settles that winner visually.
4. The session's `red4ext/logs/*.log` and `ArchiveXL-*.log`, and the game and framework versions from those logs.

## Reproduction

In `projects/xf-studio/authoring`:

```powershell
# Designer-reference fits (private inputs)
python tools/hair-profile-swatch-fit.py <vanilla .hp.json dir> <female_cco.inkcharcustomization.json>
python tools/hair-profile-swatch-fit.py <pack .hp.json dir> --icons <pack atlas.png> <pack .inkatlas.json>
# Fixed-camera captures and their colour measures (ignored folder)
bun tools/hair-colour-look.ts <private save copy> evidence/screenshots/hair-calibration/after 4396
python tools/hair-colour-stats.py evidence/screenshots/hair-calibration/before evidence/screenshots/hair-calibration/after
```

The portrait crops, card-direction test and white-balance arithmetic were run as one-off scripts on private inputs. The measured numbers above are what they produced.

`bun test`, `bun run check` and `bun run build` passed on this checkpoint. Community sources used: redacted-c01's Hair Profiles CCXL (profiles and selector icons), Arkhe's Character Rendering Editor (option list and vanilla values), MELUMINARY's hair, the Cyberpunk Blender add-on (comparison formula) and WolvenKit; see the [community credits](../../docs/community-credits.md).

*Redaction: `redacted-c01` stands for a creator who asked not to be named. Resource paths written `redacted-c01\...` are that mod's real folder with its name redacted, so they won't match the files as written.*
