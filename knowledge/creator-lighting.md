# Character-creator and mirror lighting (game 2.31)

**Maturity: Draft.** The scene, its lights, the camera and the display transform are read from the installed 2.31 resources and two decompiled engine programs. Four things are not in any resource or shader: the CPU conversion of a light's lumens and cone angles into shader constants, the default light colour, the exposure scale that the camera's photographic settings produce, and how the preview camera is placed around V. Those are hypotheses. The [capture protocol](#8-capture-protocol) is designed to settle them in one session. Detailed provenance, hashes and reproduction commands are in the [evidence note](../research/character-customization/creator-lighting-evidence.md).

**Grades:** [resource] installed game or mod resources; [source] decompiled engine programs; [wiki] Cyberpunk Modding Docs at `be2f44ee`; [community] a mod's own files or documentation; [installed] the reference install's current state; [runtime] observed in game; [hypothesis] not established.

## In brief

- **One scene serves both screens.** The new-game creator and the mirror's appearance editor draw V through the same puppet-preview widget, the same camera entity and an identical 15-light rig (female; 14 for male). V stands in a 20 m box whose walls are pure black. Only the surrounding world differs: the pre-game menu world or Night City. [resource]
- **The image is a render-to-texture.** A dedicated camera (15° field of view) renders the box into an 8-bit sRGB texture the size of the screen, and the menu shows that texture. [resource]
- **The light is theatrical, not neutral.** A soft white key light comes from the front, above and to the left. A strong cyan-white rim light hits V's left side, a magenta rim light hits the back of the right side, and a cool cyan fill rises from below. Hair, especially at the crown and edges, is lit largely by the coloured rim lights. [resource geometry; relative strengths are hypothesis]
- **The exposure is fixed.** The camera carries manual photographic settings (f/1.4, ISO 450, shutter value 1) and `automated` 0, read here as automatic exposure switched off. The game then applies a LogC-encoded 3D grading LUT. The vanilla LUT gives neutral grey a warm cast. [resource] [source]; the manual-exposure reading is [hypothesis]
- **The Studio has a matching preset.** Camera & light → Lighting → Character creator shows this rig, camera and display transform with the LUT the installation resolves to; exposure and two strength switches wait on a capture ([§9](#9-the-studios-creator-lighting-preset)).
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

**Room.** The box is six `base\items\quest\q110__misc\q110_black_box.mesh` panels scaled to 20 × 20 m around V. Their first material is `metal_base.remt` with `engine\textures\editor\black.xbm` and `BaseColorScale` (0, 0, 0), so the walls are black and reflect nothing. The box's own sectors place no reflection probe and no geometry besides the walls; in the menu world the neighbouring sectors hold none either [resource]. The rig therefore has no bounce light. Whether the world's global ambient or GI reaches V is not established [hypothesis].

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

Reading the settings as a physical camera with the shutter as 1/value seconds gives EV100 −1.2 for the creator against about +4.9 for the world default. That reading, and the absence of automatic exposure, are [hypothesis]. The scale factor this gives in shader units cannot be derived without the CPU code, because lumen conversion is also unknown. **The preview must therefore fit one global exposure factor to a capture** ([§8](#8-capture-protocol)). The creator screen's exposure should then stay constant across sessions, which the protocol also tests.

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

Every creator light is a local light. The decoded hair model in [hair shading §5](hair-shading.md#5-deferred-hair-light) is the **global** light path. The local-light hair path uses its own options, `LocalLight` R 0.35 with TRT and MultiScatter per the Character Rendering Editor list [community], and it is not decoded. The brow decal and skin use the standard local-light model above. Because the magenta and cyan rims fall mostly on the crown, the back and the silhouette, hair on the creator screen can look cooler or more magenta at its edges than its albedo suggests. Measure hair patches on the front-lit lengths ([§8](#8-capture-protocol)).

**Qualitative runtime check (25 September 2026, maintainer).** Brightening the Studio's preview makes the hair colour look quite similar to the game, and the game is still a little darker [runtime, qualitative; not a measurement]. Hue and saturation therefore look close, and the remaining gap is mostly overall light level. This supports putting the rig, exposure and display transform ahead of further hair-shader changes. It is also consistent with the Nova LUT's darker, neutral mid-tones.

## 7. What the preview needs

A "creator lighting" stage preset for the Studio, separate from the ordinary studio stage (ACES filmic at exposure 1.2, Three's `RoomEnvironment` image-based lighting and two directional lights in `src/scene.ts`), none of which belongs in this preset. The table is the specification; [§9](#9-the-studios-creator-lighting-preset) records what the Studio implements and where it departs from it.

| Element | Specification | Confidence |
|---|---|---|
| Surround | `scene.environment = null`, no ambient or hemisphere light, black background (the walls are albedo 0). The UI stage gradient must not show in this preset. | High for the walls [resource]; medium for "no global ambient" [hypothesis] |
| Lights | One `THREE.SpotLight` per row of the [female table](#2-the-box-and-its-lights) (male table for male V), positioned relative to V's floor origin in the Studio frame, `target` = position + axis. Colours are sRGB 8-bit, so use `color.setRGB(r/255, g/255, b/255, THREE.SRGBColorSpace)`; unset = white. | Positions, axes, colours and angles high [resource]; unset = white medium-high |
| Cone | `angle` = outer/2, `penumbra` = 1 − inner/outer (full-angle reading). Three's smoothstep cone differs from the engine's `pow(…, softness)`; the lights that matter aim within a few degrees of the head, so the difference there is small. | Medium [hypothesis] |
| Falloff | Inverse-square lights: `decay` 2, `distance` = radius; this is Three's physical falloff and matches the decoded form. Linear lights: Three has no linear falloff, so use `decay` 0, `distance` 0 and multiply the intensity by `1 − d_head/r`, measured to the head slot. That stays within ±4 % across the head for these distances. | High for the form [source]; the per-light fold is a preview approximation |
| Intensity | Candela `I = Φ/4π` for every light as the starting hypothesis; keep a per-rig switch to the cone-normalised form `Φ/(2π(1 − cos(outer/2)))` so the capture can choose. | Low [hypothesis]; settled by the capture's left/right and front/rim ratios |
| Shadows | Shadow maps on Main_Body, Fill_Upper, Highlight_Right, Highlight_Body and Rim_Top. Contact shadows are character-only on Main_Face, Rim_Right, Rim_Top and the magenta head rim. Hair-on-face shadowing from Rim_Top and the key is the visible part. | Flags high [resource]; the Studio has no shadow maps today, so first release without and note it |
| Specular | Roughness bias −8 on the magenta rims, meaning sharper highlights [hypothesis]; start without it. | Low |
| Hair lighting | Evaluate the decoded hair model per spot light, with the `LocalLight` intensities (R 0.35, TRT and MultiScatter as listed) instead of `GlobalLight`, and drop the `EnvProbe` ambient term with the IBL. | Medium [community] values, undecoded path |
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
| Controls | sclera (near-neutral), background (black level) |

**Measures and pass marks**

| Measure | Target | What it tests |
|---|---|---|
| Background | at most 3/255 | no ambient in the box |
| Left/right cheek luminance ratio | within 10 % of the game | rig strengths (intensity form, cone reading) and yaw |
| Hair/skin, brow/skin, lash/skin luminance ratio (front-lit patches, display-linear) | within 10 % | material and lighting together, independent of `k` |
| Hue of hair, brow and lash patches (OKLab hue angle) | within 5° | LUT, profile bake and rim colour |
| ΔE OKLab of skin patches after the `k` fit | at most 0.02 | display transform |
| The two hair-page frames | pixel difference under 1/255 on patches | fixed exposure |
| Ladder luminance ratios against `ash_brown` | compare with the [bake table](../research/eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request), after inverting the LUT | profile bake curve, now independent of lighting |

Each pass mark is a first target for iteration, not evidence of parity. Record every run with the screenshot hashes, settings, profile and preset version, as the hair calibration note does.

## 9. The Studio's creator lighting preset

The Studio implements §7 as a selectable lighting preset: **Camera & light → Lighting → Character creator**, the palette command "Lighting: character creator (game)", or the typed action `preview.setLightingPreset` (`studio` stays the default). Switching is immediate and fully reversible: the studio stage's environment, backdrop and lights are hidden, not rebuilt, and restored exactly. The choice and the diagnostic switches persist in the workspace, never in recipes or Undo. Everything below is a preview of the specification, not evidence of parity; no capture has been compared yet.

| Part | Implementation | Departure from §7 |
|---|---|---|
| Rig | `src/creator-lighting.ts` holds the female (15) and male (14) tables of §2, generated by `rig_table.py` at yaw −125°. `src/creator-lighting-rig.ts` builds one `SpotLight` per row. The rig follows the loaded save's body sex (female without a save). | No shadow maps or contact shadows; no roughness bias; Three's smoothstep cone instead of `pow(…, softness)` |
| Falloff and intensity | Inverse-square lights use Three's physical falloff (identical to the decoded form). Linear lights have `decay` 0 and their intensity folded by `1 − d/r` at the head slot. Candela from lumens by Φ/4π, or spread over the cone (`preview.setCreatorLighting` key `intensity`: `isotropic`, `cone`). Cone angles read as full or half angles (key `cone`: `full`, `half`); half angles are capped just below 90° for Three. | The two switches are diagnostics under **Advanced: creator lighting calibration** and in the palette; the capture chooses |
| Surround | Black background, `scene.environment` null, studio key and fill hidden. | None |
| Hair | Strands and lashes evaluate the decoded hair light per spot light with `LocalLight` intensities R 0.35, TRT 0.8, MultiScatter 0.47 (`HAIR_LOCAL_LIGHT` in `src/hair-shading.ts`). | TRT and MultiScatter equal to `GlobalLight` [hypothesis]; the local-light hair path itself is not decoded |
| Display | `src/creator-display.ts` renders scene-linear into a half-float 4× MSAA target, then one pass writes `sRGB_encode(clamp(LUT(LogC3(k·x))))` with the LUT as a half-float `Data3DTexture` sampled at texel centres. `src/grading-lut.ts` has the same arithmetic on the CPU; on the vanilla, Nova and Preem LUTs it reproduces the §5 neutral-axis table exactly. | None beyond half-float storage of the LUT |
| Which LUT | `src/grading-lut-host.ts` opens the launch route with the generic resolver, reads the creator environment's `ldrLut` path, and takes the LUT from the archive that wins that path by archive precedence (`selectGradingLut`). No mod is named in code. If the winner can't be read, the base game's copy is used; if none can, the neutral grade, each with a plain note in the Lighting panel. The decoded cube is cached content-addressed in the host's private preview cache and served at `/assets/grading-lut/`. On the reference install it resolves to `#####-NovaLUT-3.archive` (64³), with `###-PreemLUT3.archive` and the vanilla archive recorded as losing alternatives. | The world → environment step is fixed to `cp2077_master_env_nge_v002.env`; both master environments name the same LUTs |
| Exposure `k` | One scalar (`preview.setCreatorLighting` key `exposure`, 0.01 to 20), default 0.46. The default is not measured: it puts a front-facing forehead of linear albedo 0.35 at scene grey 0.18 under the default rig (`defaultCreatorExposure`, pinned by a test). | To be fitted to a capture and frozen |
| Camera | `camera.creatorFraming` with page `face` (1.2 m) or `hair` (2.0 m): vertical FOV 15°, target at the head slot (female 1.62 m, male 1.67 m), frontal. Buttons **Creator face** and **Creator hair** in Camera & light. | Yaw frontal until the capture fits it; the Studio's zoom-dependent near plane |

**Calibration helper.** `bun tools/calibrate-creator-capture.ts --game <png> --studio <png> --patches <json> [--lut <bin>] [--k <number>] [--repeat <png>]` (in `projects/xf-studio/authoring`) samples the §8 patches from a screenshot and a Studio render at the matched camera, fits `k` on the forehead through the LUT's grey response, and prints every pass mark of §8 that the patches allow. Hue and skin ΔE are compared after the fit. The patch file declares its box units (`"units": "pixels"` or `"fractions"`); `--k` is the exposure the Studio render used, and without it the preset's default is assumed and printed. It is read-only and writes nothing; `--lut` takes the decoded cube from the private preview cache (`grading-lut/files/`). Its arithmetic is in `src/creator-calibration.ts`, tested on synthetic images.

**First look (browser, reference save, 25 September 2026; not a comparison).** Against black, the face is lit mainly from V's left and the front; V's right side is darker, with a thin magenta line along the jaw and nostril. On the hair page the lengths read darker and cooler than under the studio stage. Seen from behind, the hair's left side carries pale grey-cyan rim highlights and the right side strong magenta-red ones, as the rig geometry predicts. The Nova grade makes mid-tones neutral and darker than the studio stage's ACES. Screenshots stay in the ignored `evidence/screenshots/creator-lighting/`.

## Open questions

1. The CPU conversions: lumens to shader intensity, and inner/outer/softness to the cone constants. A RED4ext or CET read of a spawned light's render proxy, or a decode of the light-upload code, would settle them without captures.
2. The default `Color` of `worldStaticLightNode`. A CET check such as reading a new node's `color` would confirm white.
3. How the puppet-preview camera is placed: yaw relative to V, "zoom" as distance, and FOV axis.
4. Whether the render target inherits the world's LUT, grain, vignette, chromatic aberration and depth of field, and whether global ambient or GI reaches the box.
5. Whether LUT Switcher's menu rule covers the mirror, and whether ray-traced lighting changes the box's image.
6. The local-light hair path, and the magenta rims' roughness bias.
7. Alpha of the preview texture at hair edges, and the pre-game background video behind it.
8. Both master environments set `forceHdrLut` 1 in their `ColorGradingAreaSettings` [resource]. §5 reads the SDR path as using `ldrLut`; if the flag makes SDR output use the HDR LUT instead, the preview's grade is wrong. The bake program was not read for this flag, and the preview follows `ldrLut` until a capture or decode says otherwise.

## Sources

- Installed 2.31 resources, extracted and serialized with WolvenKit CLI 9.0.1. The paths and SHA-256s are in the [evidence note](../research/character-customization/creator-lighting-evidence.md).
- Compiled programs from `staticshader_final.cache`, decompiled with dxil-spirv `f2d1b554` and SPIRV-Cross `aa217aeb` ([shader-system method](../research/materials/shader-system/README.md)): `m_shaderLightsComputeGlobalLocalShadows_Clustered_00000001` (`10862954502888615639`) and `m_LUTGenerateLinear` (`7299616531647440496`).
- [wiki] at `be2f44ee`:
  - `modding-guides/textures-and-luts/creating-a-lut-from-scratch/README.md` and `archived/advanced-reverse-engineered-lut-pipeline.md` (nullfractal): 3D LUTs with an ARRI LogC3 input;
  - `for-mod-creators-theory/files-and-what-they-do/lights-explained.md`: the falloff modes, text only.
- Cyberpunk Blender add-on at `7a4ee79`, `importers/sector/services/lighting.py`: a spot light's local +Y axis, the cone as a full angle, and lumens/683 as watts; a community convention, not engine evidence.
- WolvenKit at `11720772`: class defaults (`worldStaticLightNode.cs`, `CColor.cs`).
- The Nova LUT 3.0, Preem LUT 3.0 and LUT Switcher 2 packages installed in the reference MO2 instance, read only.
