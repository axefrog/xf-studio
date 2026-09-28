# Character-creator and mirror lighting (game 2.31)

**Maturity: Draft.** The scene, its lights, the camera, the display transform and the indirect light are read from the installed 2.31 resources and decompiled engine programs. Four things are not in any resource or shader: the CPU conversion of a light's lumens and cone angles into shader constants, the default light colour, the exposure scale that the camera's photographic settings produce, and how the preview camera is placed around V. Those are hypotheses. The [capture protocol](#8-capture-protocol) is designed to settle them. Two matched Studio/game captures have been compared region by region ([§12](#12-calibration-against-a-matched-pair)): the rig is not mirrored, the Studio lacked shadows, and the preset now carries shadows and a calibration fitted to both captures ([§12.6](#126-refit-from-two-captures-28-september)). Detailed provenance, hashes and reproduction commands are in the [evidence note](../research/character-customization/creator-lighting-evidence.md).

**Grades:** [resource] installed game or mod resources; [source] decompiled engine programs; [wiki] Cyberpunk Modding Docs at `be2f44ee`; [community] a mod's own files or documentation; [installed] the reference install's current state; [runtime] observed in game; [hypothesis] not established.

## In brief

- **One scene serves both screens.** The new-game creator and the mirror's appearance editor draw V through the same puppet-preview widget, the same camera entity and an identical 15-light rig (female; 14 for male). V stands in a 20 m box whose walls are pure black. Only the surrounding world differs: the pre-game menu world or Night City. [resource]
- **The image is a render-to-texture.** A dedicated camera (15° field of view) renders the box into an 8-bit sRGB texture the size of the screen, and the menu shows that texture. [resource]
- **The light is theatrical, not neutral.** A soft white key light comes from the front, above and to the left. A strong cyan-white rim light hits V's left side, a magenta rim light hits the back of the right side, and a cool cyan fill rises from below. Hair, especially at the crown and edges, is lit largely by the coloured rim lights. [resource geometry; relative strengths are hypothesis]
- **Nothing in the data lights V indirectly.** No reflection or light probe, baked GI, area environment or fog volume covers the box in either world. The walls are black, and every wall is beyond the camera's 9 m depth cut, so the menu shows through behind V. The mirror frames of session 2 bound any world-wide ambient to a few per cent of the key light, and session 3's noon and midnight frames match, so no time-dependent world ambient reaches V ([§10](#10-indirect-light-what-reaches-v)). [resource] [runtime]
- **The exposure is fixed.** The camera carries manual photographic settings (f/1.4, ISO 450, shutter value 1) and `automated` 0, read here as automatic exposure switched off. Session 3's mirror frames confirm it: 18 frames over about 20 seconds hold the hair's level within ±3 %, and noon and midnight give the same frame ([§4](#4-exposure)). The game then applies a LogC-encoded 3D grading LUT. The vanilla LUT gives neutral grey a warm cast. [resource] [source] [runtime]
- **The Studio has a matching preset.** Camera & light → Lighting → Character creator shows this rig, camera and display transform with the LUT the installation resolves to. The data-flagged lights cast shadows onto the V, and the strengths and exposure carry a provisional calibration fitted to two matched captures: the four cyan fills at a third of their data strength, Main_Face ×1.25 and exposure 1 ([§9](#9-the-studios-creator-lighting-preset), [§12.6](#126-refit-from-two-captures-28-september)).
- **The shading on V's face comes mostly from Main_Face.** In the matched pair, the key light low in front at V's left, aimed up, casts the nose's shadow up toward V's right inner eye. The magenta and cyan rims never reach the front of the face, because the head occludes them [runtime, one matched pair] [observed geometry].
- **The reference install replaces that LUT.** Two installed LUT mods replace the vanilla SDR LUT with neutral ones. The expected winner, Nova LUT 3.0, renders mid-grey neutral and darker than vanilla: sRGB about 117 against vanilla's warm (153, 137, 118), roughly a third less display luminance. [resource] [installed]

## 1. Where the screen comes from

| Step | New-game creator | Mirror (in game) | Grade |
|---|---|---|---|
| Menu resource | `base\gameplay\gui\fullscreen\main_menu\pregame_menu.inkmenu` | `base\gameplay\gui\fullscreen\menu.inkmenu` | [resource] |
| V's image | Entry `player_puppet` (depth 50) → `main_menu\character_creation_step_6.inkwidget` | Entry `player_puppet` (depth 0) → the **same** widget | [resource] |
| Controller | `gameuiCharacterCreationPuppetPreviewGameController`: scenes `character_creation_female`/`_male`, cameras `#character_creation_{female,male}_camera_edit_01`, `yawDefault` −125, `isRotatable` 1, `rotationSpeed` 30, `yawSpeed` 4 | same | [resource] |
| Scene spawner | (native pre-game flow) | `ingame_character_creation_menu.inkwidget`, `gameuiInGameCharacterCustomizationGameController`, puppet record `Character.Player_Puppet_Menu` at `#character_creation_{female,male}_marker`, prefab `#character_creation_{female,male}`, slot entity `main_menu\prefabs\empty_room_char_creation_{female,male}.ent` | [resource] |
| World box | `04_main_menu` world, prefab `character_creation_box` (sectors `quest_fc76e8948d75e8d4` female, `quest_a0f0cd2476942221` male) | `03_night_city` world, prefab `{character_creation_box}` under `c_westbrook`, at world height about −195 m (sectors `quest_a73ac4b55b3d6ec1` female, `quest_8cf966bb983a0158` male) | [resource] |
| Camera | `main_menu\target_face.ent`: `entRenderToTextureCameraComponent`, virtual camera `character_customization`, fov 15, near 0.1, far 1000 | same entity, placed by the in-game box | [resource] |
| Output | `main_menu\preview.dtex`: `RGBA_Uint8_SRGB`, `scaleToViewport` 1 (default 960×720), shown by an ink image through `preview.inkatlas` | same | [resource] |
| Behind V | `character_customization_background.inkwidget` (depth 0): a video at opacity 0.15 | no background entry | [resource] |

The widget's image is a render target, so the pixels of V on screen are the camera's graded 8-bit output drawn by the UI. Whether the texture's alpha lets the pre-game background video show through at hair edges has not been checked [hypothesis].

**Mirror versus creator.** Relative to its spawner, each light of the Night City box matches the pre-game box exactly: position, direction and every parameter, for both sexes [resource]. The differences are the world around the box:

- The world environment is `cp2077_master_env_nge_v002.env` before the game starts and `cp2077_master_env_ep1_v006.env` in Night City. Both use the same SDR and HDR LUTs and tone-mapping modes. Their bloom, chromatic aberration, vignette and minimum exposure differ [resource].
- In Night City, weather files (`24h_weather_*.envparam`) override only automatic-exposure settings. The creator camera switches automatic exposure off, so weather should not change the mirror [resource; the camera's override winning is hypothesis].
- Runtime mods can differ between the two. LUT Switcher applies its LUTs as effects on the player, which exists only in game. The Character Rendering Editor sets hair options; whether it already acts in the pre-game menu was not checked ([§5](#5-tone-mapping-and-grading)).

## 2. The box and its lights

**Room.** The box is six `base\items\quest\q110__misc\q110_black_box.mesh` panels scaled to 20 × 20 m. V's feet are at its centre, 10 m from every panel, floor included. The mesh's two materials are `metal_base.remt` with `engine\textures\editor\black.xbm` and `BaseColorScale` (0, 0, 0), and `starfield.mt` with both intensities 0. So the walls are black and give no bounce light. No probe, GI data, area environment or fog volume reaches the box, and from every creator framing the walls lie beyond the camera's depth cut, so they never appear in the image [resource]. [§10](#10-indirect-light-what-reaches-v) has the details and the one world-wide term that remains open.

**Frame used below.** Positions are metres from the scene marker (V's feet), converted to the Studio's Three.js frame: Y up, V facing −Z, V's anatomical right = +X. That frame assumes V's world yaw is −125°, the controller's `yawDefault`. The spawner nodes use −135°. If the real yaw differs by δ, rotate the whole rig by δ about Y. Directions are spot axes. A light's local +Y is its spot axis, which is the same convention as the Blender add-on's sector importer [resource geometry; yaw is hypothesis]. The designers named left and right from the camera's side, so "L_Rim_Left" hits V's right.

Female rig (`quest_fc76e8948d75e8d4`, head slot at 1.62 m). All lights are spot lights with `unit` lumen, `EV` 0, temperature off (−1), source radius 0.1 m (magenta rims 0.05 m) and softness 2 (Main_Eyes and Main_Top: 5):

| Light | Position (x, y, z) | Axis (x, y, z) | Lumen | Colour (sRGB 8-bit) | Outer / inner (°) | Falloff, radius (m) | Distance to head (m) | Notes |
|---|---|---|---:|---|---|---|---:|---|
| Main_Face | (−0.30, 1.00, −0.79) | (0.36, 0.71, 0.61) | 40 | unset | 45 / 15 | linear, 5 | 1.05 | key from front-left at chest height, aimed up at the face; contact shadows |
| Main_Eyes | (−0.78, 1.75, −3.61) | (0.16, 0.00, 0.99) | 40 | unset | 30 / 1 | linear, 5 | 3.69 | frontal catch light, 3.7° off the head |
| Main_Top | (−1.58, 4.00, −2.25) | (0.35, −0.73, 0.59) | 250 | unset | 50 / 25 | inverse square, 7.5 | 3.64 | high front-left |
| Main_Body | (−0.41, 0.95, −1.72) | (0.15, −0.05, 0.99) | 65 | unset | 60 / 30 | linear, 5 | 1.89 | shadows |
| Main_Feet | (−0.41, 0.65, −1.72) | (0.12, −0.31, 0.95) | 35 | unset | 30 / 15 | linear, 5 | 2.01 | misses the head |
| Fill_Upper | (0.55, 0.00, −0.94) | (−0.20, 0.93, 0.32) | 100 | 165, 228, 255 | 50 / 1 | linear, 5 | 1.95 | cyan fill from the floor, front-right; shadows |
| Fill_Base | (2.25, 0.00, −1.58) | (−0.84, 0.16, 0.52) | 10 | 165, 228, 255 | 40 / 1 | linear, 7.5 | 3.19 | |
| Fill_Left | (2.25, 3.00, −1.58) | (−0.59, −0.73, 0.35) | 10 | 165, 228, 255 | 90 / 30 | linear, 7.5 | 3.08 | |
| Fill_Lower | (0.99, 0.93, −0.33) | (−0.82, 0.26, 0.52) | 2.5 | 165, 228, 255 | 45 / 30 | linear, 3 | 1.25 | |
| Highlight_Right | (−2.05, 2.00, −1.01) | (0.86, −0.25, 0.45) | 50 | unset | 15 / 10 | linear, 5 | 2.31 | narrow side light on V's left; shadows |
| Highlight_Body | (−1.79, 0.00, −1.19) | (0.85, 0.29, 0.44) | 75 | unset | 55 / 1 | linear, 5 | 2.69 | shadows |
| Rim_Right | (−2.25, 1.50, 1.58) | (0.79, −0.16, −0.60) | 600 | 191, 254, 255 | 75 / 1 | inverse square, 5 | 2.75 | cyan-white rim, V's left-rear; contact shadows |
| Rim_Top | (−0.12, 3.00, 0.70) | (0.09, −0.87, −0.49) | 600 | 229, 247, 255 | 25 / 1 | linear, 1.65 | 1.55 | top-back rim on the crown; shadows, contact shadows |
| Rim_Left_Head | (0.66, 0.50, 1.98) | (−0.52, 0.68, −0.52) | 450 | 255, 25, 128 | 90 / 1 | inverse square, 5 | 2.37 | magenta rim, V's right-rear; roughness bias −8; contact shadows |
| Rim_Left_Body | (0.94, 0.78, 1.78) | (−0.67, 0.02, −0.74) | 450 | 255, 25, 128 | 60 / 1 | inverse square, 2.25 | 2.18 | magenta, body; roughness bias −8 |

"Unset" means the colour property is not stored in the resource, so it takes the class default. WolvenKit shows that default as (0, 0, 0, 0), but WolvenKit records no non-zero `Color` default for any class, while it does record non-zero `HDRColor` defaults. A 150-sector sample of Night City also shows unset colours on ordinary work lights and on temperature-driven lights. **Unset colour is taken to be white** [hypothesis, strongly supported]. If it were black, the rig's key lights would be dark and V's face would be lit only by cyan fill, which the first capture would show at once.

The male rig (`quest_a0f0cd2476942221`, head slot 1.67 m) has the same layout without Main_Feet. Its Main_Face and Main_Eyes sit elsewhere, and several intensities are lower: Fill_Upper 75, Highlight_Body 35, Main_Body 40 (outer 75°), Main_Face 35, Main_Eyes 25 (colour 229, 247, 255), Main_Top 200 (colour 229, 247, 255), magenta rims 250 [resource]. The controller picks the rig by the body sex, per its `gender` field; the rule for a V with a mixed voice and body was not traced.

### How the engine evaluates these lights

Decoded from the clustered local-light loop in `m_shaderLightsComputeGlobalLocalShadows_Clustered_00000001` (compute `10862954502888615639`) [source]:

| Term | Arithmetic | Grade |
|---|---|---|
| Inverse-square falloff (light flag 256) | `saturate(1 − (d/r)⁴)² / max(d², 1e−4)`, optionally clamped (flag 512) by a constant; the world config's `lightAttenuationClamp` is 12 | [source]; flag 256 ↔ `LA_InverseSquare` and the clamp pairing are [hypothesis] |
| Linear falloff | `1 − saturate(d/r)`, with **no** inverse-square term | [source] |
| Spot cone | `pow(saturate(a·cosθ + b), c)`, where `a`, `b` and `c` come from the CPU | [source]; `a`, `b` from inner/outer and `c` = softness are [hypothesis] |
| Cut-off | Contributions below `0.01 / (R+G+B)` of the light's premultiplied colour fade to zero | [source] |
| Intensity | The light record holds colour × intensity, already converted on the CPU; lumens to that value is not in any shader | [hypothesis] |

The wiki's lights page describes the two falloff modes in words only [wiki `for-mod-creators-theory/files-and-what-they-do/lights-explained.md`]. The inverse-square form is the same windowed falloff Three.js uses for physical lights.

**Strengths are the biggest unknown.** The table's parameters are exact, but the relative brightness of each light at the head depends on two unknown CPU conversions. One is lumens to intensity: Φ/4π, cone-normalised, or something else. The other is whether cone angles are full angles or half-angles. The analysis scripts compute both cone readings for Φ/4π. With full angles, the strongest contributions at the head centre are Rim_Right, then Fill_Upper, Rim_Top, the magenta head rim, Highlight_Right and Main_Face. With half-angles, the magenta head rim nearly doubles and Main_Body grows about fourfold. Either way V's left side gets more light than the face front, and the side facing the magenta rims is the darkest [hypothesis arithmetic].

## 3. Camera

| Property | Value | Grade |
|---|---|---|
| Camera entity | `target_face.ent` at marker + (−0.5, 0, 0) m (RED coordinates), camera component bound to a target point | [resource] |
| Field of view | 15° | [resource]; vertical axis is [hypothesis]: at 1.2 m it frames a 0.32 m high face, which fits the face pages |
| Near / far | 0.1 m / 1000 m | [resource] |
| Framing per category | Controller `cameraSetup` (slot, zoom, 1 s transition, 0.75 s delay): `UI_HeadPreview`, `UI_Eyes`, `UI_Nose`, `UI_Lips`, `UI_Jaw`, `UI_Teeth` 1.2; `UI_Hairs`, `UI_Skin` 2.0; `UI_FingerNails` 2.2; `Summary_Preview` 3.2; `UI_Preview` 8.3 | [resource] |
| Slot heights | Female: face and hair slots at (−0.03, 0, 1.62) m, nails and summary 1.45, full body 0.90. Male: 1.67, 1.45, 0.95 | [resource] |
| Zoom range | Preview camera settings: zoom 0.9 to 10, speed 0.47; rotation ±180°, default yaw 20° | [resource]; which of these the creator uses is [hypothesis] |
| Meaning of "zoom" | Camera distance in metres from the slot | [hypothesis]: 1.2 m, 2.0 m and 8.3 m at 15° give a face, a head-and-shoulders and a full-body frame |
| Direction | Looks at the slot from V's front; the exact yaw between V's facing and the camera axis is not recorded in any resource. Candidates: frontal, or turned by the preview settings' default 20° | [hypothesis]; the capture measures it |
| Output size | Screen size (`scaleToViewport`); the shape of V's frame follows the screen's aspect ratio | [resource] |

The player can turn V (`isRotatable`). Any comparison must use the default pose, before V is rotated.

## 4. Exposure

The creator camera carries its own `WorldRenderAreaSettings` [resource]:

- **CameraAreaSettings:** `automated` 0, f-stop 1.4, ISO 450, shutter time 1. The world environments use `automated` 1 with f/2, ISO 400, shutter 30 and automatic exposure (compensation −0.65 EV, clamps by hour).
- **DistantFogAreaSettings** and **VolumetricFogAreaSettings:** both with density 0, so there is no fog in the box.

Reading the settings as a physical camera with the shutter as 1/value seconds gives EV100 −1.2 for the creator against about +4.9 for the world default. That reading is [hypothesis]. The scale factor this gives in shader units cannot be derived without the CPU code, because lumen conversion is also unknown. **The preview therefore fits one global exposure factor to captures** ([§8](#8-capture-protocol), [§12.6](#126-refit-from-two-captures-28-september)).

**No automatic exposure** [runtime, session 3, mirror hair page, Vanilla hair options]. The arrival frame, two bursts of eight frames 150 ms apart and the first ladder frame span about 20 seconds. Their mean hair level, taken over every hair-coloured pixel so that it does not depend on the idle's pose, stays within 0.0207–0.0220 in scene-linear light (±3 %), and a neck patch stays within 206.7–209.1 in 8-bit sRGB. Frame-to-frame differences follow the idle's motion and nothing else. The noon and midnight frames also match ([§10.4](#104-what-reaches-v-by-path)). Across sessions, the key-lit forehead relative to the preview differs by about 14 % between the 27 September pair and session 3. The two Vs differ in skin type and head pose, so that spread is not evidence of a changing exposure.

## 5. Tone mapping and grading

**The SDR display transform, as the game builds it.** Each frame, `m_LUTGenerateLinear` (compute `7299616531647440496`) bakes a 3D LUT that the tone-mapping pass samples [source]:

1. It decodes a log2-spaced grid into scene-linear colour.
2. It applies the environment's grading controls: lift, gamma and gain, shadow, midtone and highlight offsets split at `lowRange` 0.1 and `highRange` 0.45, contrast, hue rotation and saturation. All are neutral in both master environments [resource], so this step is the identity there.
3. It encodes the colour per the LUT's `inputMapping`. `CMF_ArriLogC` is ARRI LogC3 at EI 800 (`0.247190·log10(5.555556x + 0.052272) + 0.385537`, linear below 0.010591), exactly as compiled. The alternatives are sRGB or linear, which also get a soft clip.
4. It samples the grading texture with `(R, G, B)` → `(u, v, w)` and decodes the output per `outputMapping` (`CMF_Linear`: none). Up to eight area LUTs are blended by weight.
5. The environment's SDR tone-mapping mode is `TonemappingModeLinear`, so the LUT carries the whole tone curve.

The wiki's LUT guides describe the same LogC3 input and 3D-texture format [wiki, nullfractal's `creating-a-lut-from-scratch` pages]. HDR output uses the HDR LUT and `TonemappingModeACES` (`maxStops` 9.6, `midGrayScale` 0.5, applied after the LUT), which is not covered here.

**Vanilla SDR LUT** `base\weather\24h_basic\luts\cp2077_gen_lut_nge_v017.xbm`: 32³, RGBA float, `TEXG_Generic_LUT`, no mips. Its neutral axis, read directly from the texture blob, is below [resource]. WolvenKit 9.0.1's DDS export of this 3D texture did not keep the raw texel order, so read the blob.

| Scene grey in | 0.05 | 0.10 | 0.18 | 0.30 | 0.50 | 1.0 | 2.0 |
|---|---|---|---|---|---|---|---|
| Vanilla out (sRGB 8-bit) | 51, 49, 40 | 101, 89, 77 | **153, 137, 118** | 195, 180, 161 | 224, 215, 197 | 247, 239, 226 | 255, 255, 246 |
| Nova LUT 3.0 | 51, 52, 51 | 80, 80, 80 | **117, 116, 116** | 161, 157, 158 | 202, 198, 197 | 237, 237, 237 | 252, 252, 252 |
| Preem LUT 3.0 | 53, 53, 53 | 98, 98, 98 | **135, 135, 135** | 169, 169, 169 | 198, 198, 198 | 228, 228, 228 | 243, 243, 243 |

The vanilla grade warms neutrals noticeably and lifts mid-tones. Both mod LUTs are neutral, and Nova is darker in the mid-tones.

**The reference install** [installed; all read-only]:

- **LUT mods.** "Nova LUT 3.0 (AgX - HDR Support)" (Nexus 11622) and "Preem LUT 3.0 (ACES - New HDR)" (Nexus 11510) are both enabled. Each ships a 64³ replacement for the vanilla SDR and HDR LUT paths. They sit in differently named archives, so the game's archive order decides, and first-alphabetical puts `#####-NovaLUT-3.archive` before `###-PreemLUT3.archive`. **Nova is the expected winner** (source-supported expectation, per the [mod-loading rules](mod-loading.md)).
- **LUT Switcher 2** (CyanideX) applies LUTs at runtime as player effects. Its saved settings have `disableLUTinMenus` true and active effect "Preem LUT 3: Main". Whether the mirror counts as a menu for it is [hypothesis].
- **Character Rendering Editor** runs its "Arkhe Balanced" hair preset ([hair shading §5](hair-shading.md#5-deferred-hair-light)).
- **Game settings:** SDR (`HDRModes` None), `Gamma` 1.0, `Brightness` 50. Ray tracing is on (lighting Ultra, local shadows, reflections), path tracing off, DLSS Auto. Film grain, chromatic aberration, depth of field, lens flares and vignette are on, and motion blur is High.
- **ReShade 6.7.1** is loaded. Its preset enables CinematicDOF, SoftMotion, qUINT Lightroom, PD80 Color Space Curves and Curved Levels, Prism chromatic aberration, Quark film grain, RealLongExposure and ArtisticVignette. Its screenshots are JPEG, quality 90, with `SaveBeforeShot` 0.

**Contamination of earlier comparisons.** The in-game portrait behind the [hair calibration](../research/eye-artistry/hair-calibration-2026-09-25.md) was taken with the ReShade preset active. Its colours are therefore graded twice, by the game LUT and by ReShade's Lightroom, curves and levels effects. They are not raw game output. According to the maintainer, the screenshots taken in the 25 September sessions had ReShade effects disabled, so this caveat applies only to comparisons against that portrait. Those comparisons also used the Nova or Preem LUT and possibly a LUT Switcher effect, not the vanilla grade.

**Settings the player controls.** These change screenshots [resource `r6\config\settings\options.json`, `platform\pc\options.json`]:

- Display: `HDRModes`, `Gamma`, `Brightness`, and in HDR `MaxMonitorBrightness`, `PaperWhiteLevel`, `TonemappingMidpoint` and `Saturation`.
- Post effects: `FilmGrain`, `ChromaticAberration`, `DepthOfField`, `LensFlares`, `MotionBlur` and `Vignette`. Whether the creator's render target applies them is [hypothesis]; its feature list names only anti-aliasing, contact and local shadows, reflections, decals, particles and SSAO.
- Lighting and upscaling: the ray-tracing and path-tracing options change how local lights shadow and bounce, and the upscaler and DLSS options change the image.

## 6. Hair under this rig

Every creator light is a local light. The local-light hair path is the decoded hair model of [hair shading §5](hair-shading.md#5-deferred-hair-light) evaluated per light, with the `LocalLight` intensities R 0.35, TRT 0.8 and MultiScatter 0.47, the executable's defaults [source]. With no ambient in the box, the hair environment path (the same section) adds nothing here, so the mirror isolates direct light on hair. The data give the box no ambient, and the mirror frames bound any world-wide ambient to a few per cent of the key light ([§10](#10-indirect-light-what-reaches-v)). Even that much would barely reach dark hair, whose ambient carries its albedo twice [resource] [runtime bound]. The brow decal and skin use the standard local-light model above. Because the magenta and cyan rims fall mostly on the crown, the back and the silhouette, hair on the creator screen can look cooler or more magenta at its edges than its albedo suggests. Measure hair patches on the front-lit lengths ([§8](#8-capture-protocol)).

**Qualitative runtime check (25 September 2026, maintainer).** Brightening the Studio's preview makes the hair colour look quite similar to the game, and the game is still a little darker [runtime, qualitative; not a measurement, and no capture on file]. Hue and saturation therefore look close, and the remaining gap is mostly overall light level. This supports putting the rig, exposure and display transform ahead of further hair-shader changes. It is also consistent with the Nova LUT's darker, neutral mid-tones.

## 7. What the preview needs

A "creator lighting" stage preset for the Studio, separate from the ordinary studio stage (ACES filmic at exposure 1.2, Three's `RoomEnvironment` image-based lighting and a key, fill and rim: the Soft studio setup of [§9](#lighting-setups)), none of which belongs in this preset. The table is the specification; [§9](#9-the-studios-creator-lighting-preset) records what the Studio implements and where it departs from it.

| Element | Specification | Confidence |
|---|---|---|
| Surround | `scene.environment = null`, no ambient or hemisphere light, black background. In game the walls are cut away and the menu shows behind V, so the background colour is a presentation choice, not a measurement. The UI stage gradient must not show in this preset. An optional uniform ambient cube, off by default, is specified in [§11](#11-an-environment-for-the-creator-preset-recommended). | High for "no probe, GI or area environment" [resource]; "no global ambient" is bounded to a few per cent by the mirror frames ([§10](#10-indirect-light-what-reaches-v)) |
| Lights | One `THREE.SpotLight` per row of the [female table](#2-the-box-and-its-lights) (male table for male V), positioned relative to V's floor origin in the Studio frame, `target` = position + axis. Colours are sRGB 8-bit, so use `color.setRGB(r/255, g/255, b/255, THREE.SRGBColorSpace)`; unset = white. | Positions, axes, colours and angles high [resource]; unset = white medium-high |
| Cone | `angle` = outer/2, `penumbra` = 1 − inner/outer (full-angle reading). Three's smoothstep cone differs from the engine's `pow(…, softness)`; the lights that matter aim within a few degrees of the head, so the difference there is small. | Medium [hypothesis] |
| Falloff | Inverse-square lights: `decay` 2, `distance` = radius; this is Three's physical falloff and matches the decoded form. Linear lights: Three has no linear falloff, so use `decay` 0, `distance` 0 and multiply the intensity by `1 − d_head/r`, measured to the head slot. For the 5 m and 7.5 m lights that stays within a few per cent across the head. It does not for Rim_Top (radius 1.65 m, 1.55 m from the head slot): its factor is 0.06 at the slot and about 0.13 at the crown, 1.44 m away, so the fold under-lights the crown about twofold. | High for the form [source]; the per-light fold is a preview approximation, poor for Rim_Top [arithmetic] |
| Intensity | Candela `I = Φ/4π` for every light as the starting hypothesis; keep a per-rig switch to the cone-normalised form `Φ/(2π(1 − cos(outer/2)))` so the capture can choose. | Low [hypothesis]; settled by the capture's left/right and front/rim ratios |
| Shadows | Shadow maps on Main_Body, Fill_Upper, Highlight_Right, Highlight_Body and Rim_Top. Contact shadows are character-only on Main_Face, Rim_Right, Rim_Top and the magenta head rim. The key's nose shadow and the head occluding the rims are the visible part ([§12](#12-calibration-against-a-matched-pair)). Hair strands cast by their coverage into the shadow-mapped lights' maps only (§9). | Flags high [resource]; implemented as head-scoped shadow maps (§9) |
| Specular | Roughness bias −8 on the magenta rims, meaning sharper highlights [hypothesis]; start without it. | Low |
| Hair lighting | Evaluate the decoded hair model per spot light, with the `LocalLight` intensities (R 0.35, TRT 0.8, MultiScatter 0.47) instead of `GlobalLight`, and drop the `EnvProbe` ambient term with the IBL. | High: path decoded and default values read from the executable [source] |
| Display transform | Replace ACES with the game's SDR transform: `out = sRGB_encode(clamp(LUT(LogC3(k·x))))` in a custom tone-mapping chunk. The LUT is a `Data3DTexture` (half float), sampled at `LogC3 · (N−1)/N + 0.5/N`. Load the **effective** LUT from the user's install through the generic resolver: vanilla, or the winning LUT mod (Nova on the reference install). Keep ACES for the ordinary studio stage. | High for the transform [source] [resource]; the render target using the world LUT is [hypothesis] |
| Exposure `k` | One scalar, fitted once so the Studio's forehead patch matches the capture, then frozen for this preset. | Fitted; checked for stability by the protocol |
| Camera | Vertical FOV 15°, target = head slot (female 1.62 m, male 1.67 m, x offset −0.03 m ignored), distance 1.2 m for face pages (eyes, brows, lashes) and 2.0 m for hair and skin. Yaw from the capture fit; start frontal. Near plane 0.1 m (the Studio's zoom-dependent near plane is fine). Aspect = the comparison screenshot's. | FOV and slots high [resource]; FOV axis, zoom as distance and yaw [hypothesis] |

**Order of confidence.** Where the lights are, and their colours and angles, can be trusted. The falloff shapes and the grading transform can also be trusted, because they are decoded. How bright each light is relative to the others, and the overall exposure, cannot yet be. The first capture should therefore fit one exposure scalar and test two binary switches: the intensity form and the cone reading. It should not tune individual lights by eye.

## 8. Capture protocol

This extends the fixed-camera patch method of the [hair calibration](../research/eye-artistry/hair-calibration-2026-09-25.md): mean display sRGB of pixel boxes, and luminance ratios to the mean of skin boxes. The mirror is the best place for the hair-colour ladder asked for there, because its lighting is fixed.

**Before the session**

1. Leave ReShade effects off, or turn on `SaveBeforeShot` so ReShade also saves the image before effects. Set ReShade's screenshot `FileFormat` to PNG instead of JPEG.
2. Record the game settings from §5 and keep SDR. Turn off film grain, chromatic aberration, depth of field, lens flares, vignette and motion blur, then record whether the creator image changed. Keep the ray-tracing settings as played and record them.
3. Record the MO2 profile and the LUT state:
   - which LUT mods are enabled;
   - LUT Switcher's active effect, with one frame taken with its effect toggled off (its "Toggle Active LUT" hotkey);
   - the Character Rendering Editor preset. Use "Vanilla" for the calibration frames, and add one frame with the usual preset.
4. Note the game time and weather.

**Frames (mirror, default pose, V not rotated)**

1. Hair page (`UI_Hairs`), current hair colour. Take it twice: once on arrival, and once after leaving the mirror, waiting one in-game hour and returning. Identical frames confirm the fixed exposure.
2. Eyebrows page and eyelashes page, current colours.
3. Skin page.
4. Hair ladder, all on the hair page with the same style: `38_ash_brown`, `39_ash_grey`, `74_steel_smoke` and `66_platinum_blonde`, plus a lash frame on `05_brown_liquorice`. These are the [refined capture request](../research/eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request) step 3, moved here.
5. Optional: the same hair-page frame from the new-game creator with any V that shares the hair style. The hair differs, but the skin and background patches test whether the two screens match.

Also collect the CET hair-option dump from that request and the session's logs.

Session 3 (28 September) took frames 1, 3 and 4 without the lash frame, the option dumps under both presets, and indirect-light step 1. The results are in [§4](#4-exposure), [§10.4](#104-what-reaches-v-by-path), [§12.6](#126-refit-from-two-captures-28-september) and [hair shading §8](hair-shading.md#creator-ladder-session-3).

**Studio side**

- Render the creator preset at the screenshot's resolution.
- Align the camera to each screenshot with a 2D similarity fit on landmarks: both eye centres, nose tip and chin. The fitted scale gives the distance, which tests "zoom = metres", and the nose offset gives the yaw.
- Fit `k` on the forehead patch only.

**Patches** (boxes of at least 8×8 px, clear of highlights and edges)

| Group | Patches |
|---|---|
| Skin | forehead centre, left cheek, right cheek, chin |
| Hair | crown, parting, front-lit lengths left and right; separately, a rim-lit edge on each side |
| Brow | inner and arch, each side |
| Lash | upper lash line centre, each eye |
| Controls | sclera (near-neutral); the side of the nose away from the key (indirect-light bound, §10). The background is the menu, not the box, so it is no black-level control |

**Measures and pass marks**

| Measure | Target | What it tests |
|---|---|---|
| Nose side away from the key, against the forehead (scene-linear, after inverting the LUT) | about 4 % or less, as in the session-2 frame | an upper bound on ambient (§10) |
| Left/right cheek luminance ratio | within 10 % of the game | rig strengths (intensity form, cone reading) and yaw |
| Hair/skin, brow/skin, lash/skin luminance ratio (front-lit patches, display-linear) | within 10 % | material and lighting together, independent of `k` |
| Hue of hair, brow and lash patches (OKLab hue angle) | within 5° | LUT, profile bake and rim colour |
| ΔE OKLab of skin patches after the `k` fit | at most 0.02 | display transform |
| The two hair-page frames | pixel difference under 1/255 on patches | fixed exposure |
| Ladder luminance ratios against `ash_brown` | compare with the [bake table](../research/eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request), after inverting the LUT | the whole colour chain (the profile bake is now decoded from the executable, [hair shading §3](hair-shading.md#3-base-colour)) |

Each pass mark is a first target for iteration, not evidence of parity. Record every run with the screenshot hashes, settings, profile and preset version, as the hair calibration note does.

### Indirect-light checks (same session, four short steps)

These settle what [§10](#10-indirect-light-what-reaches-v) leaves open and set the [§11](#11-an-environment-for-the-creator-preset-recommended) ambient. Use the mirror, the face page (`UI_HeadPreview`, 1.2 m) and the default pose throughout, with ReShade effects off.

1. **Day against night.** Take a frame at 12:00 and one at 00:00 game time, without leaving the screen if the bridge can set the clock (`world.time.set`), otherwise by leaving, waiting and returning. Identical patches, within 1/255, mean no time-dependent world ambient reaches V. They also confirm fixed exposure. A brighter noon frame means the sky's ambient cube reaches the box.
2. **A metal piercing.** Frame piercing style 1 in silver, then in gold. Measure the piercing's body between highlights. Near black (under about 10/255) keeps the preset's ambient at 0. A uniform grey or warm sheen measures the ambient; fit it in the Studio with `k` frozen. **Session 4:** the silver ring's body between highlights is a neutral-to-cool grey of about 58–95/255, not near black. Ultra+'s RT mode was on, so step 3 (ray tracing off, Ultra+ off) comes before fitting any ambient from it.
3. **Ray tracing off.** Repeat step 2's silver frame with ray-traced lighting and reflections off. Any difference is ray-traced self-bounce or reflection, which no raster preset models.
4. **Creator against mirror.** Take step 2's silver frame in a new game's creator (the menu world). A match means the surrounding world's environment does not matter.

## 9. The Studio's creator lighting preset

The Studio implements §7 as the built-in lighting setup **Character creator**: one of the flat list of [lighting setups](#lighting-setups) in **Camera & light**, the palette command "Lighting: Character creator", or the typed action `preview.selectLightingSetup` with `creator` (Soft studio stays the default). Choosing it is immediate and fully reversible: the room and the stage backdrop go and come back with the setup, nothing is rebuilt but the lights. The built-in is resolved from the rig table and the calibration for the body shown every time it draws, so a refit reaches it; it is never copied into a workspace until the person changes something, which forks it into a setup of their own (below). The setup shown and the diagnostic switches persist in the workspace (the view graph's lights node), never in recipes or look Undo. One matched pair has been compared ([§12](#12-calibration-against-a-matched-pair)); the setup is a calibrated preview, not evidence of parity.

| Part | Implementation | Departure from §7 |
|---|---|---|
| Rig | `src/creator-lighting.ts` holds the female (15) and male (14) tables of §2, generated by `rig_table.py` at yaw −125°. `creatorSetup` (`src/lighting-setups.ts`) turns each row into a spot light of the setup, and `src/lighting-setup-stage.ts` draws one `SpotLight` per light, as it draws every setup. The rig follows the loaded save's body sex (female without a save). | No roughness bias; Three's smoothstep cone, corrected at the head by the cone fold |
| Falloff and intensity | Inverse-square lights use Three's physical falloff (identical to the decoded form). Linear lights have `decay` 0 and their intensity folded by `1 − d/r` at the head slot. The **cone fold** does the same for the cone: each light's intensity is multiplied by the engine form `pow(saturate(a·cosθ + b), softness)` over Three's smoothstep, both taken at the head (`coneFold`). That matters for lights aimed 10–25° off the head: Fill_Upper ×0.68, Main_Face ×0.73, Main_Body ×0.49, the magenta head rim ×0.59. Candela from lumens is Φ/4π, or spread over the cone (`preview.setCreatorLighting` key `intensity`: `isotropic`, `cone`). Cone angles read as full or half angles (key `cone`: `full`, `half`); half angles are capped just below 90° for Three. Last comes the calibration gain (`CREATOR_CALIBRATION.gains`, §12). | The two switches are research tools under **Research: creator lighting calibration** and in the palette. The matched pair favoured neither over the defaults (§12) |
| Shadows | The lights the resource flags (`contactShadows` `CSR_CharacterOnly`, or `enableLocalShadows`) cast a PCF shadow map, at most six (`CREATOR_SHADOW.budget`, one texture unit each in every lit material). The character contact lights come first, then the shadow-map lights by strength at the head: Main_Face, Rim_Right, Rim_Top, Rim_Left_Head, Fill_Upper and Highlight_Right. Each map is aimed at the head slot rather than along the light (`aimShadowAtHead`: a square frustum covering 0.45 m around the head), so a 90° rim cone still spends every texel on the head and shoulders. The map size follows the preview quality (512, 1K, 2K; 4K uses 2048). The PCF radius keeps a 3 mm penumbra at the head [hypothesis: source radius 0.1 m at about 1 m over a 2–3 cm nose gap]. The skin, body, clothing and hair strands cast; eyes, decals and lashes don't. A contact-only light's map (Main_Face, Rim_Right, Rim_Left_Head: `contactShadows` without `enableLocalShadows`) is a stand-in for the game's short character march and holds the body's own shapes alone; hair strands draw no depth into it (`platform/scene/shadow-casters.ts`, PREV-171). With hair in those maps, the low rear rims grazing the side of the face printed the hair behind the ear across the cheek, jaw, ear and neck, centimetres from the hair, which a contact march cannot do; it read as hair seen through the face ([hair shading §8](hair-shading.md#hair-in-the-shadow-maps)). Hair lying on the skin still shadows it through the contact term below. Everything visible receives, makeup included. Casters draw their depth with all eight skin influences (`fullSkinDepthMaterial`): Three's stock depth material skins with four, which pulled the V toward the origin in the map and misplaced every shadow. The switch is `preview.setCreatorShadows` (research tools and palette), on by default; the person's **Face shadows** switch (Preview quality › Rendering, `preview.setFaceShadows`) turns every setup's shadow maps off without changing the setup. Measured cost on 27 September 2026, headless Chrome (ANGLE D3D11, RTX 4070), 990 × 648 viewport, 1K maps, default V with body and hair: 1.3 → 3.1 ms per frame on the face page and 0.8 → 2.8 ms on the hair page (six depth passes per drawn frame). The maps are cached: `shadowMap.autoUpdate` is off, and a frame redraws them only when `shadowState` changes. That fingerprint covers every visible shadow-casting light (identity, placement, map size) and every visible caster (identity, placement, bone poses, morph weights), but not the camera, so orbiting a static V reuses its maps. Measured on 27 September on the same GPU, 40 frames at a fixed camera. A head-only V drew 0.7–1.1 ms per frame against 0.6–0.9 ms with shadows off. The default V with her body drew 2.8 ms against 1.5 ms, because the maps are redrawn whenever a caster moves, for example during the blink. The filter is `src/shadow-filter.ts`: Ignacio Castaño's optimized PCF, a tent 3, 5 or 7 texels wide made of 4, 9 or 16 hardware-filtered comparison taps whose positions and weights follow the receiver inside its texel, the size nearest the PCF radius (7 at 1K; the widest, so 2K maps draw a sharper edge than the 3 mm target). It replaces Three's five taps rotated per pixel by interleaved gradient noise, which assumes temporal antialiasing and showed as a pixel dither across grazing penumbras, and the fixed 4 × 4 grid that followed it, whose taps sat 2.3–4.5 texels apart and stepped the penumbra (PREV-136; `tests/shadow-filter-tent.test.ts` simulates both across an edge). The maps are drawn again after a lost and restored context, and kept when the preview quality notifies without changing their size (PREV-131, PREV-132). Hair strands cast by their coverage: the alpha map's red channel, tested at 0.5. **Character contact shadows (PREV-148, 27 September).** The maps' 1.5 mm normal bias and 3 mm penumbra cannot shadow anything finer, so the lip parting took the low key (Main_Face shines up from chest height) and showed as a lit pink line. The lights the resource flags for contact shadows now also get a screen-space term (`platform/scene/contact-shadow.ts`, the shader term in `skin-material.ts`): the casters draw their depth alone before the forward scene, and every skin-lit program (skin, decals over it, the makeup plate) scales such a light's direct light by whether a 12 mm march toward it, 12 samples, stays in front of that depth (a caster 0.4–6 mm in front hides; the far half of the march fades). Lights are matched by their direction from the point, so Three's light order doesn't matter. Its length, steps and thickness are a Studio choice [hypothesis]: the game's march is not decoded. On the reference V's mouth corner (creator, scatter on) the parting band's mean luminance falls by 31 % and its peak by 20 %; a wide front view changes only the parting, the nostril rims, the nasolabial edge and the ears. Cost: +0.3–0.4 ms per frame at 957 × 875. The fold running out from the corner of the mouth stays lit: it faces the low key and the lower fill, and no caster lies toward either within 4 cm, so whether the game darkens it (screen-space occlusion, or a longer march) needs a game capture. | Contact shadows are drawn as full shadow maps plus a short screen-space march (below); beyond the six casters (Highlight_Body and Main_Body in the female rig) nothing shadows |
| Surround | The setup's room light is 0 (no `scene.environment`, no light probe) and its backdrop black. | None |
| Hair | Strands and lashes evaluate the decoded hair light per spot light with `LocalLight` intensities R 0.35, TRT 0.8, MultiScatter 0.47 (`HAIR_LOCAL_LIGHT` in `src/hair-shading.ts`). | None: the path and the three defaults are [source] |
| Skin | The game's screen-space scatter (`platform/scene/skin-scatter.ts`, [skin reference §11](../research/materials/shader-skin.md#11-screen-space-scatter-in-the-preview-threejs)) under both presets: the direct diffuse irradiance blurred with the resolved profile's kernel and the game's rules, the albedo applied after, specular unblurred, added before the grade. The skin light's wrap is the fallback without a half-float target. Verification switches (`window.xfStudioCreatorRig.scatter(false \| "bare")`, `scatterScale`) and `tools/creator-light-look.ts --scatter-ab` capture A/B frames; `tools/creator-pair-metrics.py` measures a matched pair in scene-linear light. | Screen scale [hypothesis] until skin test ask 4 |
| Display | `src/linear-display.ts` renders scene-linear into a half-float 4× MSAA target, then one pass writes `sRGB_encode(clamp(LUT(LogC3(k·x))))` with the LUT as a half-float `Data3DTexture` sampled at texel centres. `src/grading-lut.ts` has the same arithmetic on the CPU; on the vanilla, Nova and Preem LUTs it reproduces the §5 neutral-axis table exactly. The Studio stage shares the same target and applies its own ACES tone mapping and sRGB encoding at output (see below). | None beyond half-float storage of the LUT |
| Which LUT | `src/grading-lut-host.ts` opens the launch route with the generic resolver, reads the creator environment's `ldrLut` path, and takes the LUT from the archive that wins that path by archive precedence (`selectGradingLut`). No mod is named in code. If the winner can't be read, the base game's copy is used; if none can, the neutral grade, each with a plain note in the Lighting panel. WolvenKit runs through the shared runner (`wolvenkit-cli.ts`: a time limit per step, exit and log rules, cancellation when the installation changes, a plain missing-.NET note). The decoded cube is cached content-addressed in the host's private preview cache, keyed by the archive, the decoder version and the WolvenKit identity, and served at `/assets/grading-lut/`. A WolvenKit failure shows the neutral grade with a plain note and is prepared again on a request after 30 s; an undecodable LUT stays neutral until the installation changes. The browser asks again each time the creator preset turns on and every 20 s while it shows, and the host answers per installation fingerprint (the one the character details use), so a profile, route or LUT-mod change, or WolvenKit becoming ready, needs no restart. On the reference install it resolves to `#####-NovaLUT-3.archive` (64³), with `###-PreemLUT3.archive` and the vanilla archive recorded as losing alternatives. | The world → environment step is fixed to `cp2077_master_env_nge_v002.env`; both master environments name the same LUTs |
| Exposure `k` | One scalar (`preview.setCreatorLighting` key `exposure`, 0.01 to 20), default `CREATOR_CALIBRATION.exposure` = 1, fitted with the light gains to both matched captures (§12.6). The workspace stores untouched defaults as the token `{isotropic, full, 0.46}`, which is how every earlier build stored them, and reads that token back as the current calibration. A workspace that never touched the calibration therefore follows each refit, and keeps its bytes (`storedCreatorLighting`). The earlier synthetic value (0.46: a front-facing forehead of linear albedo 0.35 at scene grey 0.18, `defaultCreatorExposure`) is kept only as a reference. | Fitted to two captures; refit with the next |
| Camera | `camera.creatorFraming` with page `face` (1.2 m) or `hair` (2.0 m): vertical FOV 15°, target at the head slot (female 1.62 m, male 1.67 m), frontal. Buttons **Creator face** and **Creator hair** in Camera & light. | Yaw frontal until the capture fits it; the Studio's zoom-dependent near plane |

**One linear display for both presets** (PREV-50). The Studio stage draws through the same scene-linear target, so every blended pass (the face decals' square-root blend solve, the brows, the eye's wetness shell, the authored makeup plate) blends in linear light under both presets, as the game's passes do. Its output pass applies Three's own tone mapping and encoding (ACES filmic at the stage exposure, then sRGB), and the stage backdrop is drawn by Three beneath the scene, untoned, weighted by the target's coverage (alpha set to one wherever a surface wrote depth). Measured on 26 September 2026 in headless Chrome (ANGLE, D3D11) against the previous direct-to-canvas path, default V, face camera: opaque skin identical within one 8-bit level (forehead and cheek patches: max 1, mean under 0.1), the backdrop byte-identical, and the creator preset byte-identical. What changes: blended passes now match the linear solve (`tests/webgl-display.test.ts`: a dark liner over skin 98,70,57 against the solve's 97,70,57, where the old path showed 41,32,28), and sub-pixel coverage (hair strands, lash tips, silhouettes) is averaged in linear light, as the game's resolve does, so thin dark strands read lighter than before. The canvas itself has no multisampling or depth. Either `EXT_color_buffer_float` or `EXT_color_buffer_half_float` makes the half-float target renderable (Three.js enables both). A GPU with neither draws the Studio stage straight to a multisampled canvas as before, where the blends are approximate, with the room's diffuse light from a light probe of its spherical harmonics instead of the prefiltered environment (which needs a half-float target; without it the stage went dark), so its sharper reflections are missing; the creator preset renders into an 8-bit sRGB target, which blends in linear light like the half-float one but clips scene values at one before the grade (measured with both extensions hidden: the probe's decal blends within one 8-bit level of the half-float target's) (PREV-59). After a lost and restored WebGL context the environment is prefiltered again into the same texture and the makeup composite is redrawn (PREV-58).

**Calibration helper.** `bun tools/calibrate-creator-capture.ts --game <png> --studio <png> --patches <json> [--lut <bin>] [--k <number>] [--repeat <png>]` (in `projects/xf-studio/authoring`) samples the §8 patches from a screenshot and a Studio render at the matched camera, fits `k` on the forehead through the LUT's grey response, and prints every pass mark of §8 that the patches allow. Hue and skin ΔE are compared after the fit. The patch file declares its box units (`"units": "pixels"` or `"fractions"`); `--k` is the exposure the Studio render used, and without it the preset's default is assumed and printed. It is read-only and writes nothing; `--lut` takes the decoded cube from the private preview cache (`grading-lut/files/`). Its arithmetic is in `src/creator-calibration.ts`, tested on synthetic images.

**Before shadows (25 September 2026).** The magenta line along the jaw and nostril that the first look showed was the magenta head rim shining through the head (§12). Seen from behind, the hair's left side carries pale grey-cyan rim highlights and the right side strong magenta-red ones, as the rig geometry predicts.

**Calibration captures.** `bun tools/creator-light-look.ts <out dir> [port] [save copy|-] [--page face|hair] [--solo] [--variants] [--timing]` (in `projects/xf-studio/authoring`) renders the preset in an isolated `?verify=1` workspace at a creator page's camera, idle off, with the 3D view maximized. It writes the viewport as shipped, the same with shadows off and, with `--solo`, each rig light alone, for splitting a region into per-light shares. `--timing` writes the frame cost with shadows on and off. It uses a verification-only evidence object, `window.xfStudioCreatorRig` (lights, solo, frame cost, shadow-map size). Renders are private and stay in the ignored `evidence/screenshots/creator-light/`.

### Lighting setups

Every way the 3D preview can be lit is one flat list of **lighting setups** (`src/lighting-setups.ts`, drawn by `src/lighting-setup-stage.ts`). A setup is complete: its lights, each a directional or spot light with a position, what it points at, a linear colour, a strength, a cone and whether it casts a shadow map (at most six per setup, the texture-unit budget above); its surroundings (the room environment's strength, and the stage backdrop or black); its exposure; and its display transform (ACES, or the game's LogC and LUT). Every light sits about the setup's focus, the head, which the editor's placement (azimuth, elevation and distance about the head) and the shadow maps centre on.

- **Built-ins are read-only templates.** **Soft studio**, **Key light**, **Flat**, **Rim / dramatic** and **Mirror** are the studio stage's parametric rigs (`src/studio-lighting.ts`) turned into light lists with the arithmetic the old rig used, and **Character creator** is the game rig above. The first change to any value of a built-in forks it into a setup of the person's own, "Custom (from <base>)", holding the built-in's exact definition with the change, and shows it: nothing is lost by choosing another setup, and no built-in's name describes values it no longer has. Own setups can be made from any setup (New setup from…, which is also Duplicate), renamed, deleted without a prompt (Undo brings one back) and reset to their base built-in. They live in the view graph's lights node, so each workspace has its own; setup edits are View and lighting steps, a slider drag one step.
- **One drawing path, numeric parity.** A fork copies its built-in's resolved definition exactly (doubles survive JSON) and the stage draws every setup the same way, so an unedited fork of any built-in, for either body, gives Three the same lights, parameters and shadow cameras (`tests/lighting-setups.test.ts`). A creator fork is resolved for the body shown when it is made and keeps that rig.
- **The game's own values travel with creator lights.** Each light of Character creator carries an optional block of the resource's values (lumens, falloff and radius, softness, full cone angles, 8-bit colour, local and character contact shadows, roughness bias, and the Studio intensity when they were taken), kept through the edits they still describe, so a fork can be sent back to the game in its native units ([lighting mirror §9](../research/runtime/lighting-mirror-design.md#9-design-implications-for-the-lighting-setups-work)).
- **Soft studio** is the original authoring stage exactly and the default. It is not a model of any game rig; it exists to make shape and shine readable. The room carries more light than the key (about 1.05 × albedo of ambient against 0.8 × albedo × cos θ from the key), which is why the key's angle reads only as faint shading. The other studio built-ins trade the room for direct light: **Key light** (room 20 %, key 240 % from 305° and 35° up), **Flat** (room 140 %, a faint frontal key, untinted), **Rim / dramatic** (room 8 %, key 280 % from 285°, rim 250 %) and **Mirror** (room 50 %, key 160 % from the front and 20° up, untinted), each with exposure raised to keep skin near the same brightness. Every lit material follows the lights through Three's own light and environment uniforms, including the skin light and the authored plate's single lit pass; `tests/webgl-studio-lighting.test.ts` checks on a real GPU that the key's azimuth and elevation move a Metallic plate's highlight (standard and skin light) and a metal sphere's, that key strength scales the direct light linearly, and that the room's strength scales the ambient term with the prefiltered room and with its light probe. The studio key and rim cast shadows the same way as the creator rig's lights (a square orthographic map over the head and shoulders, the same filter, bias and map size), so **Rim / dramatic** shows the nose's and the hair's shadows.
- **Workspaces saved before setups** migrate losslessly: a stage that matches a built-in is that built-in and the workspace keeps its bytes; any other becomes one own setup, "Custom (from <the nearest built-in>)", holding the stage's exact rig; the creator preset shows Character creator with the adjusted studio stage kept beside it. The `preview` block keeps its legacy fields (preset, exposure, key angle, studio rig) as a mirror for older builds, exact while there are no own setups and approximated from an own studio setup's key, fill and rim; the setups themselves are stored (`lightingSetups`) only while the person has any. `tests/fixtures/workspace-before-lighting-setups.json` holds workspaces written by the build before setups.

**In the panel.** Camera & light shows the setups as one Choice list (Built-in, then Your setups) with New setup, Rename, Reset to <base> and Delete for the shown one; Surroundings (exposure in EV over the shown display's range, room light, backdrop, colour grade); and Lights: the Light list, Add light, and the chosen light's kind, Direction dial (a top view of V: angle round the dial, height from the centre, with a height scale beside it; while a light is dragged the other dots dim and a dashed radius shows, Shift keeps the angle, Alt snaps the angle around V to 15°, and Shift with Alt keeps the height; a bar under it resizes it, kept as a UI preference), distance, strength, colour, cone, cone softness and shadows. The calibration switches stay under Research.

The setups are an authoring aid, not evidence about the game's lighting.

## 10. Indirect light: what reaches V

**Answer, as far as the evidence goes.** The resources give V no source of indirect light on either screen. No probe, baked GI, area environment, fog or emissive surface covers the box, and its walls are black. The only path left open is a world-wide ambient term that the lighting pass takes from constants the CPU fills, which no resource records. The session-2 mirror frames bound that term to about 4 % of the key-lit forehead or less. The Studio's creator preset without an environment is therefore the right default ([§11](#11-an-environment-for-the-creator-preset-recommended)).

### 10.1 The render target and the box

| Fact | Grade |
|---|---|
| The creator camera's `entRenderToTextureCameraComponent` (`target_face.ent`) leaves `env`, a `worldEnvironmentAreaParameters` reference, unset. Its own `params` hold only `CameraAreaSettings` (manual exposure), `DistantFogAreaSettings` and `VolumetricFogAreaSettings` (density 0). It renders the world's `Default` scene layer with reflections, SSAO, contact and local shadows enabled (`RTFP_All`). | [resource] (RTTI: red-dump-json); that every other area setting comes from the world environment where the camera stands is [hypothesis] |
| `depthCutDistance` is 9 m, and `backgroundColor` (0, 0, 0, 0) is not overridden. | [resource] |
| V's feet are at the centre of the 20 m box. In Night City the spawner is at z −195.11 and the floor and ceiling panels at −205.11 and −185.11. From the creator's framings (1.2 to 8.3 m) every panel is more than 9 m from the camera, so the render target cuts every wall pixel away. The session-2 mirror frames show the menu's red backdrop around V, not black walls. | [resource] geometry; [runtime] frames |
| The pre-game world is the whole `basegame_2_mainmenu.archive`: 15 sectors, one environment and no `.envprobe` or `.gidata`. Its sectors hold acoustics, a few collision and mesh nodes, the markers and community areas, and the two box sectors. There is no `worldReflectionProbeNode`, GI node or GI space, trigger area with an environment notifier, fog volume or light-channel volume anywhere in that world. | [resource] |
| In Night City the box's sectors hold only the lights, panels, camera, spawner and collision. Three sectors have a grid cell containing the box: level-1 `exterior_-2_6_-2_1` (acoustics only), level-3 `exterior_-1_1_-1_3` and level-4 `interior_-1_1_-1_4` (proxy meshes). The level-3 cell's GI space, fog volume and light all lie at least 200 m away. That cell also places **a second black enclosure**: six 100 m panels of the same mesh around the box. | [resource]; a probe with a very large volume placed in another sector is not excluded |
| Every creator light has `scaleEnvProbes` and `scaleGI` 100 (it can feed probes and GI) and `scaleVolFog` 0. There is no probe or GI data here for them to feed. | [resource] |

### 10.2 The environment's indirect-light settings

Both master environments carry the same values, apart from the exposure minimum [resource]:

- **`AmbientOverrideAreaSettings`**: six colour curves, `enable` 0.
- **`GlobalIlluminationSettings`**: `localLightsScale` 1.1, `reflectionCompensation` 0.3, `lightScaleCompenensation` 0.025, `emissiveScale` 0.
- **`RenderFeaturesAreaSettings`**: GI, screen-space reflections and volumetric fog allowed.
- **`HACK_AREA_Settings`**: bottom-hemisphere tint 0.035 at strength 8.
- **`DistantIrradianceeSettings`**: enabled.
- **`ExposureAreaSettings`**: minimum −1.3 EV in the menu world and −1.2 in Night City; maximum 1 at night rising to 5.38 at noon.

The creator camera's manual exposure, EV100 −1.2 read as in [§4](#4-exposure), sits at the world's darkest clamp [hypothesis: the EV reading].

### 10.3 How the lighting-integrate pass adds indirect light

The full-screen pass after the deferred light comes in several techniques [observed programs]:

| Technique | Pixel program | Indirect light it adds |
|---|---|---|
| `m_shaderLightIntegrate` | `2291179555597019501` | The **env-probe path**. A 32 × 32 tile bitmask selects the probes. Each probe contributes box-projected reflections from a two-hemisphere array and its own six-colour ambient cube. Where the probe weights sum below 1, the rest comes from global six-colour cubes in `ENV_PROBES`: one picked by `ENV_PROBES[0].w`, and another at registers 449–454. A three-layer world-space map (world XY / 16,384 m) with height terms scales and blends them. A sky cubemap is also bound. |
| `m_shaderLightIntegrate_NoEnvProbes` (and `_CubeIBL`, whose pixel program is byte-identical) | `10393055107398307099` | **One global six-colour ambient cube** in `GlobalShaderConsts` registers 21–26. Diffuse takes it along the normal; hair takes it along the virtual light direction `L_e`. Specular takes it along the reflection vector bent toward the normal by `0.75·r²`, blended with a per-pixel reflection buffer by that buffer's weight. Two full-resolution buffers scaled by a per-draw factor, and two half-resolution buffers (×64) behind a flag, add screen-space or ray-traced terms. |
| `m_shaderLightIntegrate_NoAmbient` | `5858691682494776269` | The same bindings **without the ambient cube**; only the screen buffers remain. |

The earlier shader studies call `10393055107398307099` "the ambient composite". It is the `NoEnvProbes` variant. The "diffuse irradiance E" of the hair environment path ([hair shading §5](hair-shading.md#5-deferred-hair-light)) is, in that program, this global cube, plus the screen buffers. The name for each program comes from the static cache's technique descriptors: the program pair sits five entries before its technique name, consistently for all eight integrate techniques [observed layout; the name pairing is hypothesis, strongly supported].

Two things are not in the data [hypothesis]: which variant renders the creator's render target, and what the CPU writes into the global cubes. `AmbientOverrideAreaSettings`' six colours match the cube's shape, so when enabled they probably fill it. Both environments leave it disabled.

### 10.4 What reaches V, by path

| Path | New-game creator (menu world) | Mirror (Night City) | Grade |
|---|---|---|---|
| Reflection and light probes | none in the world | none in the cells holding the box | [resource] |
| Baked GI (`.gidata`, GI spaces) | none in the world | none in those cells | [resource] |
| Bounce off the box | 0: black panels, zero-intensity starfield | 0, inside a second black enclosure | [resource] |
| Fog in-scatter | 0: fog density 0 in the camera's settings | 0 | [resource] |
| Global ambient cube or distant irradiance | whatever the CPU writes; not in any resource | same; no time-dependent part (day against night, below) | [hypothesis]; bounded below; [runtime] no change from midnight to noon |
| Ray-traced bounce and reflections (the reference install runs ray-traced lighting and reflections) | rays inside black enclosures return about 0 apart from V's own body | same; none separable from the idle's motion (below) | [hypothesis]; whether the render target traces is not settled |

**Bound from the mirror frames** [runtime, one frame; arithmetic hypothesis]. The session-2 frame *Metal ramp · lifted* was taken at an early-morning game hour; the bridge log restores the clock to about 04:00 shortly before. In it, the side of the nose away from the key reads sRGB (41, 21, 17) against the forehead's (187, 176, 162). Through the installed Nova LUT's neutral axis ([§5](#5-tone-mapping-and-grading)), that is about 4 % of the forehead's scene-linear value. The patch is reddish, which suggests subsurface bleed of direct light rather than an ambient term. So any ambient lighting skin in that frame is at most about 4 % of the key-lit forehead. Two points of context on the time:

- **Night.** At that hour the world's automatic exposure is clamped to at most 1.4 EV, 2.6 EV above the creator's. So the world's own night-time ambient, if it reached V at full strength, would be about 6× brighter here than it looks in the street.
- **Daytime.** A daytime ambient would be up to 2^6.6 ≈ 97× brighter than it looks in the street (noon clamp 5.38 EV). The bound therefore does not cover noon; the day/night check below does.

**Day against night** [runtime, session 3, head page, bridge `world.time.set` to 12:00 and then 00:00 without leaving the screen]. The idle moves the head between the two frames, so a same-pixel comparison is not possible (mean absolute difference 14.6/255 over V, all of it at moved edges). Taken over every skin pixel and every hair pixel instead, the two frames agree:

| Measure (8-bit display luminance) | Noon | Midnight |
|---|---:|---:|
| Skin, 5th / 25th / 50th / 75th / 95th percentile | 67.3 / 126.2 / 164.9 / 183.6 / 194.2 | 67.2 / 128.5 / 165.7 / 185.2 / 194.8 |
| Skin, mean sRGB | 164.0, 148.6, 140.1 | 165.0, 149.8, 141.5 |
| Hair, 5th / 50th / 95th percentile | 6.8 / 17.1 / 42.1 | 6.7 / 17.0 / 41.8 |

The shadow tails, where an ambient term would show first, match within 0.1/255, and noon is not brighter anywhere. **No time-dependent world ambient reaches V**, so the preset's ambient stays at 0 ([§11](#11-an-environment-for-the-creator-preset-recommended) step 1). The same frames confirm the fixed exposure.

**Bounce off V's own hair** [runtime: not separable]. Light hair could reflect light onto the face if ray tracing runs in the render target. In the hair ladder the key-lit forehead reads 173–180/255 (display luminance) with the three light colours, but the dark ash brown reads 161–168/255 across the 16 burst frames and 174/255 on the arrival frame, so the idle's motion covers the whole range. The frames show no bounce that the pose cannot explain. Indirect-light step 3 (ray tracing off) remains the test.

## 11. An environment for the creator preset (recommended)

**What to emulate.** Use a **uniform six-colour ambient cube** (one neutral scalar `a`, all six faces equal), **off by default (`a` = 0)**. This is not a cubemap. It is the one term the game's data leave open (§10.3), in the form the `NoEnvProbes` pass applies it. A structured reflection would claim detail the data do not have: the studio `RoomEnvironment`, a capture of the creator backdrop or any HDRI.

- **In Three.js:** a six-face `CubeTexture` of constant colour through PMREM as `scene.environment`, with `environmentIntensity` = `a`. This gives Standard diffuse `albedo × a` and a featureless specular `a × (F0·A + B)` at every roughness. A hemisphere or ambient light is not enough, because it gives metals nothing.
- **Classes it reaches**, as in game:
  - Standard: `metal_base`, layered piercings, cyberware.
  - Subsurface: skin diffuse. In game that irradiance also goes through the SSS blur.
  - Eye: × 1.1 (`1 + cb6[9].w`) on the cornea normal.
  - Hair: through the environment path (`EnvProbe/R` 0.3, `/TRT` 0.8, `/MultiScatter` 0.47, albedo twice). The Studio's hair ambient differs today ([hair shading §8](hair-shading.md#8-browser-preview-mapping)).
  - Glass: its own probe loop falls back to a global probe.
  - Not the eye's wetness shell: its probe term is multiplied by 0.
- **Default and range.** Default 0, because the data give no ambient. A diagnostic range up to the §10.4 bound: `a × skin albedo` at most about 4 % of the forehead's direct light at the fitted `k`. Keep it with the other switches under **Advanced: creator lighting calibration**, stored in the workspace only.

**How things look.**

| Surface | At `a` = 0 (the data's reading) | At a small `a` (the bound) |
|---|---|---|
| Metals: piercings, `metal_base`, layered metals | Only the spot highlights, with a near-black body between them; silver and gold differ only in highlight colour | A flat, directionless sheen of `F0 × a`: warm for gold, grey for silver; no reflected features, and still dim |
| Metallic makeup (metalness 0.65) | Keeps colour from its 35 % diffuse part under the rig | Barely changes |
| Hair | Direct light only (the preset today) | Dark hair gains almost nothing (albedo twice); the R sheen takes the ambient's colour |
| Skin shadows | Only SSS bleed and the fills | A faint neutral lift in unlit areas |
| `glass_onesided` | No reflection at all: the program has no local lights, so only tint and distortion show (the Gorilla Arms glass reflects nothing in any case) | A uniform film of about `0.08 × a` at the default `FresnelBias` |

**What a capture or runtime check must confirm** (the §8 indirect-light checks):

1. Day and night frames match, so no sky term reaches V. **Done in session 3: they match (§10.4).**
2. The silver piercing's body between highlights is near black, so `a` stays 0. Otherwise its level fits `a`, after `k` is fitted and frozen.
3. Ray tracing off leaves the frame unchanged. Otherwise the preset lacks a ray-traced term and says so.
4. The new-game creator matches the mirror.

If step 1 fails, the preset needs a time-of-day ambient, which would contradict the fixed exposure. In that case trace the CPU fill of `GlobalShaderConsts` 21–26 through the runtime bridge before modelling it.

## 12. Calibration against a matched pair

27 September 2026. The maintainer captured the game's character creator (the face page) and a Studio render with the same V, makeup, hairstyle and face position (private captures, never committed). Regions were compared in scene-linear light: mean sRGB of boxes, inverted through the installed Nova LUT's full display transform. The regions are forehead, both nose flanks, under both eyes, both cheeks, chin, both halves of the philtrum, the screen-left jaw and both hair lengths. The per-light shares come from solo renders of the default V at the same camera (`tools/creator-light-look.ts --solo`), with the regions placed by landmark. The two Vs differ, so shares are a proxy for the maintainer's V.

### 12.1 What differed, and why

| Finding | Evidence | Grade |
|---|---|---|
| **The rig is not mirrored.** The side of the nose away from the key is V's right (screen-left) in both images: game 0.075 × forehead, Studio 0.40. The Studio's cyan rim and highlights fall on V's left and the magenta on V's right, as §2 predicts. The mesh export and the rig use the same (x, z, −y) map, so they cannot disagree in handedness. A wrong yaw sign would rotate the rig by about 110° rather than mirror it, and would move Main_* off the front. | Region values; `rig_table.py`, `native/mesh-glb.ts` | [observed] |
| **The Studio had no shadows, and they explain the nose and the magenta jaw.** The game's dark wedge runs from the nose tip up toward V's right inner eye. That is the nose's shadow from Main_Face (low, front-left, aimed up, flagged for character contact shadows). Rays from the Studio head surface to each light, against the V's own head and body, give these visibilities. The V-right nose flank sees Main_Face in 0 of 9 samples. The jaw sees the magenta Rim_Left_Head in 0 of 9, because it sits behind and below the head. Every front sample is hidden from Rim_Top, and the V-right side is hidden from Highlight_Right. In the preview all of these lit the face through the head. | Raycast visibility; solo renders | [observed geometry]; that the game shades them the same way is [runtime, one matched pair] |
| **With shadows, the relative strengths still differ.** The Studio's V-right side stays too bright. Cheek ratio V-right / V-left: game 0.41, Studio 0.65. After shadows, the shadow-side nose flank still gets 40 % of its light from the cyan floor fill Fill_Upper, which nothing on the face can occlude, and 19 % from Main_Top. | Per-light decomposition | [runtime, one matched pair] |
| **The warm, pink skin is the skin, not light colour or grade, and not subsurface scattering.** Hair hue matches (R/G 1.10 game, 1.12 Studio, scene-linear), but lit skin does not (forehead R/G 0.97 game; 1.17 in the pair's own Studio frame, 1.32 in the §12.3 render). With the screen-space scatter built ([skin reference §11](../research/materials/shader-skin.md#11-screen-space-scatter-in-the-preview-threejs)), the forehead reads 1.32 with the wrap, with the scatter and with neither: on a flat lit plane the blurred light equals the unblurred, in game as in the preview. The gap lies in the skin's albedo and tone (`TintColor` encoding), the light on skin, or a term the preview lacks (the combine's tinted `A`). | Region hues; scatter A/B | [runtime, one matched pair]; the wrap hypothesis is refuted, the remaining causes are [hypothesis] |

### 12.2 The fit and what the preset uses

The fit compares, per region relative to the forehead, the game over the Studio-before ratio with the ratio the re-weighted solo renders predict. It uses the rms of the log error over ten regions.

| Model | rms log error | Shadow-side nose flank (need 0.19) |
|---|---:|---:|
| Before (no shadows, Φ/4π, full cones) | 0.59 | 1.00 |
| Shadows only (raycast visibility applied to the solo renders) | 0.49 | 0.80 |
| Shadows + cone fold (rendered) | 0.49 | 0.82 |
| Intensity `cone`, or cone reading `half` (with shadows) | 0.55–0.63 | worse |
| + Main_Face ×3 (**adopted**) | 0.40 | 0.60 |
| + Main_Face ×4, Main_Top and Main_Eyes ×0.7, the four cyan fills ×0.3 | 0.27 | 0.39 |

Without the shadow-side flank, the error falls from 0.36 before to between 0.15 and 0.19 for every model with shadows. The remaining error is concentrated on that flank. Its game value is only SSS bleed (sRGB 46, 23, 17), and the preview's wrap and missing scatter can't match that yet.

**Adopted then (superseded by §12.3 and §12.6):** `CREATOR_CALIBRATION` in `src/creator-lighting.ts`, the one place that holds calibration factors: `gains` `{ Main_Face: 3 }` and `exposure` 0.50 [runtime, one matched pair]. §12.3 kept the gain and set the exposure to 0.53 and the yaw offset to +10°. Exposure assumes the pair's Studio frame used the preset's then default, 0.46; the game's forehead was 1.27× brighter in scene-linear. A luminance-only fit also wants the cyan fills far weaker (row 6). But removing cyan light raises the skin's R/G on the default V from 1.19 to 1.37, away from the game's 0.97, and warmth was one of the reported differences. So the fills keep their data strength until the scatter port removes the skin-shading confound. Neither diagnostic switch improved the fit, so both stay at their defaults (Φ/4π, full angles).

### 12.3 The same V (the pair's own save, skin type 5)

A second pass used the V from the save behind the pair, loaded read-only into a `?verify=1` workspace, with skin type 5 set there as in the game frame. Skin type 5 bakes contour makeup into the skin, darkening the side of the nose and the upper lip, and the Studio draws it too. The patches avoid the eye makeup; the under-eye patches sit on baked blush. The camera is **Creator face**.

Two further renderer changes landed in this pass: the scatter-scaled wrap and the macro diffuse normal (skin reference §8), and the 4 × 4 shadow filter. The trial yaws then fitted the rig's turn:

| Frame | Lit cheek (V's left) | Shadowed cheek (V's right) | Nose, shadow side | Nose, lit side | rms of all 10 regions (log) | Forehead, scene-linear (game 0.306) |
|---|---:|---:|---:|---:|---:|---:|
| Before this pass (shadows, Main_Face ×3, skin type 4) | 0.82 | 1.49 | 3.75 | 0.50 | 0.52 | 0.286 |
| Rig turned −10° | 0.81 | 1.54 | 2.95 | 0.49 | 0.47 | 0.333 |
| 0° | 0.84 | 1.46 | 1.91 | 0.46 | 0.37 | 0.316 |
| **+10° (adopted)** | **0.90** | **1.37** | **1.38** | **0.52** | **0.31** | **0.306** |
| +20° | 0.97 | 1.26 | 1.02 | 0.64 | 0.32 | 0.253 |

The values are Studio over game, each relative to its own forehead (1.00 is a match). **Adopted:** `yawOffset` +10°, matching the spawner nodes' −135° rather than the controller's −125° [resource: both yaws; runtime, one matched pair: the choice between them]. Exposure was 0.53, which put the forehead at the game's scene-linear value; §12.6 replaced the gain and the exposure and kept the yaw. A joint luminance-and-hue fit of the group gains on this V's solo renders changes little (rms 0.22 → 0.20 at fills ×0.7, highlights ×2), so no gain beyond Main_Face ×3 is adopted. The forehead and the lit cheek now sit within 15 % of the game. The shadowed cheek (+37 %), the shadow side of the nose (+38 %, where both values are very dark) and the lit side of the nose (−48 %) do not.

The game's hue says the cyan fills are strong: lit skin R/G relative to the key-lit cheek is 0.82 on the forehead and 0.81 on the shadowed cheek. So the game's shadowed cheek is lit largely by cyan light, not by a weaker key.

### 12.4 What remains

- **The lit side of the nose** read about half as bright as in the game (0.73 of it after §12.6). Part of the gap is the strands of this V's hair shadowing it: with shadows off it reaches 0.75. The rest is unexplained: possibly specular the preview underestimates, or the rig's height.
- **Non-flagged lights never shadow.** The reference install runs ray-traced local shadows. Whether they also shadow Main_Top and Main_Eyes, which the data don't flag, is unknown, and so is whether the render target traces at all (open question 5).
- **The shadow-side flank, the nose shadow and the cheek ratio** stay brighter than the game. With the scatter in place of the wrap (27 September), the nose shadow is 11 % of the forehead against the game's 8 %, and neutral (R/G 0.98) where the game's is orange (3.1). Profiles across it show the game's wedge lit almost only by scatter from the lit nose, and the Studio's lit mostly by the cyan fills, which nothing on the face occludes in the preview. Either the game's fills are weaker there or they are occluded (the reference install runs ray-traced shadows, and non-flagged lights may shadow too). Trial scatter scales up to 4× don't fix it: the wedge gets more orange but brighter (skin reference §11.6). Occlusion doesn't either. The wedge takes 54 % of its light from Fill_Upper (already casting, but from below) and 33 % from Fill_Left (unflagged), and casting Fill_Left, then Main_Top as well, leaves it at 0.11 of the forehead. So the game's fills are most likely weaker than their lumens say here, as §12.2's luminance fit found (×0.3). Refit that with the next pair, now that the scatter no longer confounds the skin's colour. The grey patch on the upper lip is the same: the nose's cast shadow filled by cyan fill over skin type 5's baked contour.
- **Warmth of the lit skin** (§12.1) is outside the scatter. The ranked candidates and their evidence are in [skin reference §11.8](../research/materials/shader-skin.md#118-checks-and-measurements): not the tone's encoding or the tinted term, but either the albedo's decode or the unset colour of the key lights, which the §8 silver-piercing frame separates.
- **Rim_Top's linear fold.** Its radius (1.65 m) barely exceeds its distance to the head slot (1.55 m), so the fold at the slot (0.06) under-lights the crown, 1.44 m away, about twofold (§7). A per-fragment linear falloff would remove the approximation. It may explain part of the crown's shortfall for light hair [hypothesis] ([hair shading §8](hair-shading.md#creator-ladder-session-3)).
- **The male rig** carries the same gains by light name, untested.

### 12.5 Refitting from new matched captures

1. The game: the creator or mirror face page, default pose (V not rotated), idle as it plays (note the phase if possible), ReShade effects off, PNG. Record the LUT mods and the LUT Switcher state.
2. The Studio, to match: the built-in **Character creator** lighting setup (not a fork), the **Creator face** camera (15° vertical field of view, 1.2 m from the head slot; **Creator hair** is 2 m), the same save, makeup and hairstyle, the default expression, the idle off, and the calibration switches at their defaults. Record the creator exposure it shows.
3. Solo renders of the same V: `bun tools/creator-light-look.ts <dir> 4396 <save copy> --head-only --choices <json> --solo`. Add `--yaws -10,0,10` for trial turns of the rig. A save's full V can exceed a 4 GB guard, and `--head-only` keeps it near 3.5 GB.
4. Measure the §12 regions in both captures, invert through the grade, split them into per-light shares, and refit `CREATOR_CALIBRATION`. Change nothing else, and record the new rms values in §12.3. `tools/creator-pair-metrics.py` measures the regions, chroma classes and contrast in scene-linear light; its region file for the 27 September pair is private.

**Next calibration step: hue.** The fills' strength was fitted in §12.6 on luminance alone. **The key lights read white:** in session 4's silver-piercing frame (plan ask 5.5), the ring's highlight cores are neutral within about 2 % (B/R 1.016), while its unclipped flanks are cyan (B/R about 1.14) where the cyan rim and fills reach it [offline, provisional; [experiment 029 §4.1](../experiments/029-session-4/README.md#41-n55-the-silver-highlight-and-the-metal-body)]. So the preset keeps white keys, and the lit skin's extra warmth points to the albedo's decode ([skin §11.8](../research/materials/shader-skin.md#118-checks-and-measurements)). A fit including hue can use this. The frames carried Ultra+'s RT skin tuning and CAS sharpening, which the next matched capture should avoid.

### 12.6 Refit from two captures (28 September)

**The second capture** [runtime, session 3]. The mirror's hair page (2.0 m) with the Character Rendering Editor's Vanilla preset, the reference V (skin type 4, hairstyle LONG PAK #011, `38_ash_brown`), ReShade off, Nova LUT 3.0 as the grade. V's head is turned about 25° to her left relative to the camera in every session-3 frame; what turned it was not recorded. The Studio matched it with the reference save, the camera orbited 25° toward V's right at 2.0 m, and eyes, nose, mouth and chin within about 10 px of the game's at 3840 × 1600.

**The rig turns with the camera, so V turned** [runtime]. With the camera orbited and the rig left alone, the region error (rms of the log ratios, lit cheek excluded as below) was 0.36. Turning the rig with the camera fits far better: rig offsets −5°, −15°, −25° and −35° gave 0.18, **0.14**, 0.29 and 0.43. The best, −15°, is the preset's +10° minus the camera's 25°: V turned inside a fixed rig and camera, and the preset's `yawOffset` of +10° holds on a second capture.

**The fit.** Per-light solo renders of both Vs (the 27 September V at the face camera, and this V at the hair-page framing with the rig at −15°) give each region's light as a sum of shares. The model scales the key, the four cyan fills and a single exposure shared by both captures, and minimises the rms of the log luminance ratios over both region sets. It is luminance only: the key lights' colour is still open, and fitting hue now would fold it into the fills (§12.5). The session-3 lit cheek (V's left, near the jaw) is left out: the game's is 3.3 times darker relative to the forehead than the preview's at every trial yaw, which no rig strength explains (a strand of hair or the idle's head pose in the game frame are possible causes).

| Model (both captures, one exposure) | rms, 27 Sep face page | rms, session 3 hair page |
|---|---:|---:|
| Before: Main_Face ×3, fills ×1, k 0.53 | 0.22 | 0.17 |
| Main_Face ×1.25, fills ×0.35, k 1.0 (**adopted**) | 0.14 | 0.08 |
| Key, mains, fills, highlights and rims all free | 0.14 | 0.08 |

Neighbouring values (Main_Face ×1.06–1.26, fills ×0.30–0.35, k 0.99–1.13) fit within 0.002. The free fit lands on the same structure: every light near its data strength except the fills at about a third. The first pair's own luminance fit had said ×0.3 (§12.2). Main_Face's gain falls from 3 to 1.25, so the key is now close to its data too. **Adopted** in `CREATOR_CALIBRATION`: `gains` Main_Face 1.25 and Fill_Upper, Fill_Base, Fill_Left and Fill_Lower 0.35 each; `exposure` 1; `yawOffset` +10° unchanged. The shadow casters are unchanged.

**Rendered before and after** (the preview with each calibration, the same matched frames, regions in scene-linear light through the Nova LUT):

| Measure | 27 Sep face page, before → after | Session 3 hair page, before → after |
|---|---|---|
| Region rms (log) | 0.25 → **0.19** | 0.14 → **0.11** |
| Forehead, preview/game (exposure) | 0.95 → 1.09 | 0.77 → 0.88 |
| Nose, shadow side / lit side (preview/game, relative to forehead) | 1.31 / 0.62 → 0.88 / 0.73 | 1.21 / 0.84 → 1.16 / 1.13 |
| Shadowed cheek | 1.28 → 1.08 | 1.18 → 1.04 |
| Jaw, V's right | 1.04 → 0.75 | 1.21 → 1.02 (jaw shadow) |
| Forehead R/G (game 0.97; 1.07) | 1.33 → 1.38 | 1.39 → 1.41 |

The exposure now sits between the two captures (−2 % on their geometric mean, against −14 % before); the 14 % spread between them stays and is the two Vs' difference ([§4](#4-exposure)). The cost is hue: with less cyan, lit skin is 1–4 % redder in R/G and hair about 7 % redder, where both were already warmer than the game. Hair gains more in lightness than it loses in hue on three of the four colours (OKLab ΔE on the four hair rungs 0.020, 0.053, 0.085, 0.052 → 0.025, 0.046, 0.075, 0.043; [hair shading §8](hair-shading.md#creator-ladder-session-3)). The game's hue said the cyan fills are strong (§12.3), and this fit says they are weak in luminance; a weaker fill whose colour is more saturated, or a cooler key, would reconcile the two, which is why hue waits for the key's colour.

## Open questions

1. The CPU conversions: lumens to shader intensity, and inner/outer/softness to the cone constants. A RED4ext or CET read of a spawned light's render proxy, or a decode of the light-upload code, would settle them without captures.
2. The default `Color` of `worldStaticLightNode`. A CET check such as reading a new node's `color` would confirm white.
3. How the puppet-preview camera is placed: yaw relative to V, "zoom" as distance, and FOV axis.
4. Whether the render target inherits the world's LUT, grain, vignette, chromatic aberration and depth of field. **Indirect light, partly answered ([§10](#10-indirect-light-what-reaches-v)):** no probe, GI, area environment, fog or bounce reaches the box [resource]. Still open: which lighting-integrate variant the render target uses, what the CPU writes into the global ambient cubes, and whether ray tracing runs in the render target. The §8 indirect-light checks settle what matters for the preview.
5. Whether LUT Switcher's menu rule covers the mirror, and whether ray-traced lighting changes the box's image.
6. The magenta rims' roughness bias. (The local-light hair path is decoded: [hair shading §5](hair-shading.md#5-deferred-hair-light).)
9. Why two captures want the cyan fills at about a third of their lumens under Φ/4π while every other light sits near its data ([§12.6](#126-refit-from-two-captures-28-september)). Main_Face and Fill_Upper are both linear-falloff spots with similar geometry, so no lumens or cone form alone separates them. Light colour or a CPU-side factor might. A render-proxy read through the runtime bridge would settle it.
7. Alpha of the preview texture at hair edges, and the pre-game background video behind it. Where there is no surface, the texture is transparent: the 9 m depth cut removes the walls, and the mirror frames show the menu's backdrop around V ([§10.1](#101-the-render-target-and-the-box)). The edge blend at hair tips is still unmeasured.
8. Both master environments set `forceHdrLut` 1 in their `ColorGradingAreaSettings` [resource]. §5 reads the SDR path as using `ldrLut`; if the flag makes SDR output use the HDR LUT instead, the preview's grade is wrong. The bake program was not read for this flag, and the preview follows `ldrLut` until a capture or decode says otherwise.

## Sources

- Installed 2.31 resources, extracted and serialized with WolvenKit CLI 9.0.1. The paths and SHA-256s are in the [evidence note](../research/character-customization/creator-lighting-evidence.md).
- Compiled programs from `staticshader_final.cache`, decompiled with dxil-spirv `f2d1b554` and SPIRV-Cross `aa217aeb` ([shader-system method](../research/materials/shader-system/README.md)): `m_shaderLightsComputeGlobalLocalShadows_Clustered_00000001` (`10862954502888615639`), `m_LUTGenerateLinear` (`7299616531647440496`) and three lighting-integrate programs (`2291179555597019501`, `10393055107398307099`, `5858691682494776269`; §10.3).
- The RTTI class dump red-dump-json at `a8e52990`: the fields of `entRenderToTextureCameraComponent`, `worldEnvironmentAreaParameters`, `worldReflectionProbeNode`, the GI node classes and the environment notifiers.
- The session-2 mirror frames (private captures, hashes in the evidence note), for the §10.4 bound and the transparent background.
- [wiki] at `be2f44ee`:
  - `modding-guides/textures-and-luts/creating-a-lut-from-scratch/README.md` and `archived/advanced-reverse-engineered-lut-pipeline.md` (nullfractal): 3D LUTs with an ARRI LogC3 input;
  - `for-mod-creators-theory/files-and-what-they-do/lights-explained.md`: the falloff modes, text only.
- Cyberpunk Blender add-on at `7a4ee79`, `importers/sector/services/lighting.py`: a spot light's local +Y axis, the cone as a full angle, and lumens/683 as watts; a community convention, not engine evidence.
- WolvenKit at `11720772`: class defaults (`worldStaticLightNode.cs`, `CColor.cs`).
- The Nova LUT 3.0, Preem LUT 3.0 and LUT Switcher 2 packages installed in the reference MO2 instance, read only.
