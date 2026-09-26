# Measuring the preview against the running game

**Status: design, nothing built (27 September 2026).** How to measure, automatically and repeatably, how far the Studio's preview is from what the game draws, region by region. It serves track 2 of the [ranked queue](../backlog/README.md) ("parity with the game not yet measured") and the [preview fidelity backlog](../backlog/preview-fidelity.md). The design reuses what exists: the [runtime bridge](../runtime/runtime-bridge-design.md) (captures, `photo.subject`, `photo.frame`, photo-mode keys, `cc.apply`, the clock and the freeze), the Studio's [creator lighting preset](../../knowledge/creator-lighting.md#9-the-studios-creator-lighting-preset) with its resolved grading LUT, the calibration helper `projects/xf-studio/authoring/tools/calibrate-creator-capture.ts` and the Studio-against-Studio screenshot tool `projects/xf-studio/authoring/tools/scene-parity.ts`.

**Grades** follow the [knowledge rules](../../knowledge/README.md), with the bridge design's additions: **[source]** read in code or decompiled data, **[resource]** read in game or mod resources, **[offline]** exercised by our own build or tests, **[runtime]** seen in the game, **[hypothesis]** not established. Everything this page *proposes* is a design choice, not evidence.

**The one rule that shapes everything else.** A parity measurement compares one game frame, taken under recorded settings, with one Studio render. A good score is [runtime] evidence *for that measure under those settings*, nothing wider. It never proves that an exported XF mod renders correctly (that is the [session cards'](../../experiments/022-session-3/README.md) job), and an offline improvement measured against a stored game frame is still an offline change until the next session repeats the capture.

## In brief

- **Two scenes, two jobs.** The creator (mirror) screen has a known light rig, a fixed camera and fixed exposure, so it is the scene for **colour and light** ([creator lighting §2–§5](../../knowledge/creator-lighting.md#2-the-box-and-its-lights)). Photo mode has a still world and a camera the bridge can read exactly, so it is the scene for **geometry, camera and light direction** ([photo mode §4–§5](../../knowledge/photo-mode.md#4-camera-placement)).
- **Match the view in the head's own frame.** The bridge already reads the photo-mode camera's world position, axes, field of view and aspect ratio, V's head slot and V's facing, and the game's own projection of chosen points (`photo.subject`). Expressed relative to the head, the camera drops straight into the Studio's frame; the game's projected points then check the match without looking at a pixel.
- **Region masks come from the Studio, not from image analysis.** An ID render labels every pixel (skin sub-regions from a head-UV atlas, lips, sclera, iris, brows, lashes, hair, face decals, each makeup layer). After registration the same labels index the game frame.
- **Metrics are ratios and perceptual differences, robust to what can't be matched:** OKLab ΔE of region means after one exposure fit, region-to-skin luminance ratios and quantile curves, specular highlight position and size, sharpness and a fitted blur width. Differences the game makes on purpose (temporal antialiasing, screen-space subsurface scattering, ray-traced light, shadows the Studio doesn't draw) are listed with how each is controlled, recorded or modelled.
- **A five-minute first protocol** rides on the next bridge session: a settings record, two creator bursts, and a short photo-mode sequence (framing reads, light off/on/off, a three-step yaw sweep). Only opening the creator needs the player.
- **Captured frames become an offline regression corpus.** Once a game frame and its manifest are stored (privately), every later Studio build can be re-rendered and re-scored against it without a session.

## 1. Matching the view

### 1.1 Which scene for which question

| Scene | Light | Camera | Pose and motion | Exposure and grade | Best for |
|---|---|---|---|---|---|
| **Creator / mirror** | The 15-light box rig (14 for male V), black walls, no fog [resource] | Fixed: 15° FOV, 1.2 m (face pages) or 2.0 m (hair, skin) from the head slot; yaw, "zoom = metres" and the FOV axis are [hypothesis] | V plays the creator idle (`ui_closeup_shot`) continuously; blinks | Fixed (`automated` 0), then the LogC3 LUT the install resolves to [resource]; fixed-ness itself is [hypothesis] | Colour of skin, lips, eyes, brows, lashes, hair and makeup; the exposure `k` and the rig's two strength switches |
| **Photo mode** | The world at the chosen time plus up to three photo-mode lights (on/off, type, shadow, brightness, range, cone, colour) [runtime] | Read exactly through `photo.subject`; placed by `photo.frame` [source; unverified in game] | The world is paused; V holds a photo-mode pose and expression (attributes 5, 6, 28) | Automatic world exposure, photo-mode exposure/contrast/highlights, then the grade | Camera reconstruction, registration, light direction (turning V under a fixed light), specular positions, blur and sharpness |

The Studio's idle is the creator idle (the [brow idle audit](../animation/brow-idle-gap.md) warns against substituting the eyes clip), so the creator is also the closer match for the face's shape. Photo mode's default expression is not known to equal the Studio's neutral face [hypothesis]; the first protocol records one frame to find out (§4, step E6).

### 1.2 Camera

**Photo mode: reconstruct the camera relative to the head.** `photo.subject` returns, in game world coordinates, the photo-mode stand-in's `Head` slot position (or V's position + 1.62 m, flagged `approximate`), V's facing `f`, the active camera's position, forward, right and up vectors, `GetActiveCameraFOV()`, `GetAspectRatio()`, and `ProjectPoint` of the target, the head, a point 5 m ahead of the camera and points 10 cm along the camera's up and right [source] `projects/xf-runtime-bridge/redscript/XFRuntimeBridgeActions.reds` (`XFPhoto.Subject`), type `SubjectReading` in `tools/api/framing.ts`. The mapping:

1. Build V's frame in the game: origin at the head slot `h`, up = world Z, forward = `f` (flattened), right = `(f.y, −f.x, 0)`, exactly as the redscript builds its offsets.
2. Express the camera in it: `d = camera − h`, giving `(d·right, d·up, d·forward)`; likewise its forward and up vectors.
3. Place it in the Studio: the Studio's frame is Y up, V facing −Z, V's right = +X ([creator lighting §2](../../knowledge/creator-lighting.md#2-the-box-and-its-lights)), so Studio position = `H + (d·right, d·up, −d·forward)`, where `H` is the Studio's `Head` bone position (`src/platform/scene/head-rig.ts` finds it by name for the idle offset). The target is the position plus the mapped forward. The result is a `CameraState` `{position, target, fov}` (`src/workspace-state.ts`) for the existing `camera.restore` action (`src/preview-actions.ts`).
4. **Field of view from the projection, not the number.** Whether `GetActiveCameraFOV()` is vertical or horizontal is not established, and the creator's FOV axis is open too ([creator lighting §3](../../knowledge/creator-lighting.md#3-camera)). The projected up and right points settle it per frame: with the target at depth `z` along the camera forward, 0.1 m along camera-up spans `p` pixels, so the focal length is `f_px = p·z/0.1` and the vertical FOV is `2·atan(H_px / (2·f_px))`. Comparing that with the reported number gives the axis once; after that, both are recorded.
5. **Closed-loop check.** The Studio projects the same head-relative points with its reconstructed camera. The pixel distance to the game's `ProjectPoint` answers (after the screen-space detection `framing.ts` already performs) is the camera residual, measured before any image content is used.

Two things differ between the game's slot and the Studio's bone [hypothesis until measured]: the `Head` slot may carry an offset from the joint, and the head's own rotation (tilted by the pose) is not reported. Proposed bridge extension (P1, §4.3): `photo.subject` also returns the head slot's orientation and accepts a list of up to 16 head-relative points. With the orientation, the camera is expressed in the head's full local frame instead of the "upright V" frame, which removes the pose's head tilt from the comparison; with the point list, the residual check uses eye corners, nose tip, mouth corners and chin (fixed head-local coordinates taken from the Studio's head mesh). A constant slot-to-joint offset appears as a constant 3D residual and is fitted once (three parameters, declared, then frozen).

Photo-mode roll (attribute 2) must be 0: the Studio camera has no roll [source] `CameraState`. The first session's `photo.state` dump showed the camera-type list and FOV working with the full photo mode [runtime]; the projection path above is [unverified] in game.

**Creator: fit, then read.** The creator's render-to-texture camera (`target_face.ent`, `entRenderToTextureCameraComponent`) is not the game's active camera [hypothesis], so `photo.subject` doesn't apply. Until a bridge read exists (proposed `cc.subject`: the customisation puppet via Codeware's `PlayerSystem.GetCustomizationPuppet()`, its head slot, and the render-to-texture camera component's transform and FOV [hypothesis; P4]), the camera is fitted: start from the preset's `camera.creatorFraming` (`face` 1.2 m or `hair` 2.0 m, 15° vertical, frontal), then solve yaw, distance and a 2D offset from landmarks (§2.2). That answers creator-lighting open question 3 as a by-product. The Studio renders at the screenshot's full resolution and aspect: the game keeps its vertical FOV and widens sideways (Hor+), which the capture regions already assume [source] `projects/xf-runtime-bridge/tools/capture/regions.ts`.

### 1.3 The same V

- **Same save.** The Studio imports the save the session loaded ([save import](../eye-artistry/save-import.md)), resolved on the same launch route and mod profile. The capture manifest records the save's hash and the profile, and the report refuses a pair whose hashes differ.
- **Same options, checked in game.** While the mirror is open, `player.appearance` lists the options and values the game is using [source]. The report compares them with the Studio's decoded choices before any pixel is compared: a disagreement is a resolver bug, and pixel metrics on that pair are meaningless.
- **Same clothes and hair.** Headwear hides hair; the Studio's Clothing control must match what V wears in the frame (without headwear and face items for face pairs). Hair physics is at rest in the Studio; hair metrics are statistics, never per-strand (§3.1).
- **Same makeup.** For XF Eye Artistry pairs, the Studio loads the exact collection preset the staged mod was built from (the package manifest's identities), at 2K preview quality (the [preview quality contract](preview-quality-contract.md): generated textures only; source assets keep their resolution).

### 1.4 Pose and expression

| Factor | Creator | Photo mode | Studio |
|---|---|---|---|
| Body and head pose | Idle loop; head drifts about ±25 px sideways and ±15 px vertically at 3840×1600 on the eyes zoom [runtime] (`regions.ts`, three captures) | Frozen photo-mode pose; values of attributes 5, 6 read | Idle off (bind pose); head-relative camera (§1.2) absorbs head translation, and with the P1 orientation read, head rotation |
| Blink | Blinks during the idle | None while paused [hypothesis] | Blink off |
| Expression | The idle's facial motion | Attribute 28 (read, not changed) | Neutral |
| Gaze | Idle gaze | Look-at (15) set to off, so the eyes follow the head | Forward |

**Freezing the creator** (P4, [hypothesis]): individual time dilation 0 on the customisation puppet (`TimeDilationHelper.SetIndividualTimeDilation`, the technique Appearance Menu Mod and Photo Mode Pose Selector use, [photo mode §8.2](../../knowledge/photo-mode.md#82-world-npcs-and-v)) would stop the idle and the blink. Until then, a creator burst of 8–12 frames is taken and the frame with the widest eye opening and the smallest head offset from the burst's median is chosen automatically; the burst also measures the drift.

### 1.5 Light

- **Creator:** the Studio's **Character creator** preset (rig for V's body sex, black surround, hair lit through `LocalLight`), with its three declared free parameters: exposure `k`, the intensity form (`isotropic`/`cone`) and the cone reading (`full`/`half`) ([creator lighting §9](../../knowledge/creator-lighting.md#9-the-studios-creator-lighting-preset)). Nothing else is tuned from the captures.
- **Photo mode:** the world light can't be reproduced, so photo-mode frames are used **differentially**: a frame with photo-mode light 1 off and one with it on, taken seconds apart with the world paused. After both are decoded to scene-linear through the inverse of the grade (§1.6), their difference is that light's contribution alone. Its position is not readable ([photo mode §5.1](../../knowledge/photo-mode.md#51-photo-mode-lights), open question 5), so the analysis fits it: a point or spot light whose shading of the Studio's normals and albedo best explains the difference over skin pixels. That is also a runtime answer to where a photo-mode light starts. Exact placement comes later from a spawned light entity (P4, the CharLi and AMM technique of [photo mode §5.2](../../knowledge/photo-mode.md#52-spawned-lights-charli-and-amm)).
- **Neutral** has no game counterpart; the Studio's own stage presets are authoring aids, not models of any game rig, and are never compared.

### 1.6 Exposure, grade and post-processing

The game's SDR output is `sRGB_encode(clamp(LUT(LogC3(k·x))))` with a linear tone-mapping mode, so the LUT carries the whole tone curve [source] `m_LUTGenerateLinear`; the Studio's creator preset draws the same transform with the LUT resolved by archive precedence ([creator lighting §5](../../knowledge/creator-lighting.md#5-tone-mapping-and-grading)). Consequences for measurement:

- **Invert the grade before arithmetic that needs linear light** (differences, light fits). The LUT's neutral axis is monotonic for the vanilla, Nova and Preem LUTs [resource], so each 8-bit value maps back to scene-linear up to the clip; pixels at 0 or 255 in any channel are excluded.
- **Exposure is one scalar.** Creator: fit `k` once on the forehead with the existing helper (`src/creator-calibration.ts` `fitExposure`) and freeze it; the repeat frame tests that the creator's exposure is fixed. Photo mode: world exposure adapts automatically, so every photo-mode metric is a ratio to a skin reference region or is normalised by an unlit background patch visible in both frames of a light pair.
- **Everything else is switched off or recorded.** Photo-mode keys the bridge can already write: grain (25) 0, chromatic aberration (13) 0, look-at (15) off, roll (2) 0 [source] `native/src/core/Params.cpp` `ParseCamera`. Depth of field (26) is never written, because Photo Mode Ex persists it into saves ([runtime bridge §3.2](../runtime/runtime-bridge-design.md#32-protocol-1)); the manifest reads it and the report flags a frame with it on. Exposure (10), contrast (11), highlights (24), vignette (12) and colour balance (84–93) are read from `photo.state` and must be at their defaults; writing them needs a small extension (P1). Game-wide post effects, HDR, ReShade, LUT Switcher and the Character Rendering Editor preset are in §3.3.

## 2. Capture pairs and registration

### 2.1 The game side

- **Capture:** `capture.screenshot` with `region: full` (and `route: auto`) keeps the whole window at full resolution as `*.full.png`; `capture.burst` takes timed sequences with per-frame differences [source] `projects/xf-runtime-bridge/tools/api/catalogue.ts`. What is captured is the composited window after ReShade and overlays, 8-bit ([runtime bridge §7.1](../runtime/runtime-bridge-design.md#71-capture)); the before-effects ReShade add-on (§7.2 there) is the calibration-grade route once the maintainer accepts ReShade as an optional dependency.
- **A capture manifest per frame** (proposed schema `xfb/parity-capture-1`): the image's SHA-256, size and route; `game.status`; `photo.state` (every menu value) or `player.appearance`; `photo.subject` with the P1 points; a digest of the graphics settings (§3.3) read-only from the game's user settings file; the MO2 profile, the effective LUT winner, the Character Rendering Editor preset, time and weather; the bridge build. It holds numbers, names and hashes only.
- **Crop comes last.** Registration works on the full frame; region crops (`face`, `eyes`, `cc-eyes`) are only for viewing.

### 2.2 The Studio side

- **A still render at the capture's exact size.** Proposed typed action `preview.renderStill { width, height, camera, passes }` (P2): renders off-screen into a target of the capture's pixel size through the same linear display (`src/linear-display.ts`), without depending on the viewport's layout size, and returns the images with the projection matrix and the camera used. The existing `scene-parity.ts` screenshots the viewport canvas through Chrome's DevTools protocol in an isolated `?verify=1` workspace, which is the right harness but the wrong size for a 3840×1600 capture. Per the [architecture contract](architecture-contract.md), rendering and read-back live in the renderer adapter (`src/platform/scene/character-renderer.ts` already reads render-target pixels) and the action is added to the catalogue with its boundary test.
- **Passes:**
  - `beauty`: the normal render under the chosen preset, exposure and LUT;
  - `ids`: one flat label per pixel, no multisampling, alpha-tested cards at coverage 0.5 (label legend in §3.1);
  - `coverage`: the multisampled coverage of thin structures (lash tips, hair edges), for weighting;
  - `normal` and `depth`: view-space normals and linear depth, for the light fit and edge masks;
  - `albedo`: unlit surface colour, for the light fit.
  The lip ownership displays in `src/render-fidelity-study.ts` are the prior art for override-material passes.

### 2.3 Registration

1. **Geometric first.** Photo mode: the reconstructed camera (§1.2) and its projected-point residual. Creator: a fit of yaw, distance and image offset from the Studio's projected landmarks against the same landmarks found in the game frame (step 2), starting from the creator page's camera.
2. **Image refinement, small and constrained.** A similarity transform (translation, rotation, scale), limited to a few pixels and a percent of scale, found by intensity-based alignment of gradient-magnitude images inside the head's ID mask. Gradient images tolerate colour and exposure differences; the constraint stops the alignment from "explaining" a real rendering difference as motion. Chromatic aberration shifts channels radially, so alignment uses luminance only and the report flags frames where aberration was on.
3. **Residual and guard.** Report the residual at every landmark in pixels. A pair whose residual exceeds 2 px at the eyes framing (0.2 m spanning the window height) or 3 px at the face framing is kept but marked unregistered; region metrics then run only on eroded masks (§3.1) and spatial metrics (highlight position, profiles) are withheld.
4. **Not per-strand.** Hair and lashes are never registered locally. No optical flow is used for region metrics; a dense flow field is kept as a diagnostic image only.

## 3. Metrics, expected differences and controls

### 3.1 Regions

Labels come from the Studio's `ids` pass, then are warped into the game frame by the registration and eroded by `max(2 px, 2σ + residual)`, where σ is the fitted blur (§3.2).

| Group | Regions | How the label is made |
|---|---|---|
| Skin | forehead, cheek L/R, nose, chin, upper lip, upper lid L/R, under-eye L/R, neck | A label atlas in the head's UV space, drawn once per body gender; every V with that head mesh shares the UV layout, so the atlas is independent of V and pose [hypothesis: creator morphs move vertices, not UVs; [head CC rendering open question 9](../../knowledge/head-cc-rendering.md#open-questions) found that even the masculine head keeps the feminine plate region's UVs] |
| Lips | upper, lower | Same atlas |
| Eyes | sclera L/R, iris L/R, pupil L/R, cornea highlight | Eyeball and wetness-shell meshes; iris and pupil from the eye's own refracted iris coordinate |
| Brows | L/R | Brow decal mesh, coverage from its alpha |
| Lashes | upper L/R | Lash cards; coverage-weighted |
| Hair | front-lit lengths, crown, rim edge L/R | Hair mesh; sub-regions by the Studio's normal relative to the creator rig's key and rims |
| Face decals | each of V's own decals (vanilla makeup, lipstick, blush, freckles, tattoos) | Decal family meshes, labelled by resource |
| XF makeup | each authored layer | The plate's layer masks: label the dominant layer where its coverage exceeds 0.5 |
| Controls | background, specular-free skin reference | Background: nothing drawn; reference: forehead minus highlights |

### 3.2 Measures

All colour arithmetic decodes 8-bit sRGB to display-linear and converts to OKLab, as the calibration helper already does (`src/creator-calibration.ts`: `oklab`, `deltaE`, `hueDegrees`, `displayLuminance`, `patchMean`). Per region:

| Measure | Definition | Robust to | What it tests |
|---|---|---|---|
| Mean colour ΔE | OKLab ΔE between the region means, after the exposure fit, specular pixels (top 2 % luminance in either image) excluded | Blur, small misregistration | Albedo, material and grade together |
| Hue and chroma | Hue-angle difference and chroma ratio of the means | Exposure | LUT, profile bake, tint encoding |
| Luminance ratio | Region mean luminance over the skin reference's, game against Studio | Exposure, grade scale | Material and lighting balance (brow/skin, lash/skin, hair/skin as in [creator lighting §8](../../knowledge/creator-lighting.md#8-capture-protocol)) |
| Luminance quantile curve | The 5/25/50/75/95 % luminance quantiles of the region in both images, plotted against each other and as ratios | Registration | Contrast and tone within a region (texture strength, shading range, the SSS softening) |
| Shading profile | Luminance along fixed head-local paths (across both cheeks through the nose; down the forehead to the chin), normalised to the reference | Exposure | Light direction and falloff, the terminator width |
| Specular highlight | Connected components above the region's 98th percentile after subtracting a blurred copy: centroid (in head-local or iris-radius units), area, peak ratio, elongation | Exposure | Roughness, lobe shape, light position; on the cornea the `Main_Eyes` catch light ([eye rendering §6.4](../../knowledge/eye-rendering.md#64-acceptance-checks)) |
| Sharpness | Gradient-energy ratio inside the region, before and after blurring the Studio render with the fitted σ | — | Texture detail beyond the blur the game's antialiasing adds |
| Coverage contrast | For makeup, brows and lashes: ΔE and luminance ratio between the region and a ring of neighbouring skin, in each image | Exposure, grade, global light | Makeup strength and brow/lash density, independent of the skin's own error |

Per pair: the exposure fit `k` (creator) with its residual, the background black level, the registration residual, the fitted blur σ (edge-spread width at the head's silhouette and the limbus), and the idle drift from the burst.

Pass marks start from [creator lighting §8](../../knowledge/creator-lighting.md#8-capture-protocol) (skin ΔE ≤ 0.02 after the `k` fit, ratios within 10 %, hue within 5°) and extend to the new regions with the same shape. They are first targets for iteration. The noise floor comes from repeated game frames of the same scene (the creator repeat, the photo-mode off/off pair): a difference smaller than the frame-to-frame difference is not reported as a finding.

### 3.3 Differences the game makes on purpose, and how each is handled

| Source | Effect on the frame | Control | Model or metric | Grade |
|---|---|---|---|---|
| **Temporal antialiasing** | Softens edges and thin structures; clamps history to mean ± 1σ in PQ space, dimming isolated one-pixel highlights | Record the mode; prefer native-resolution antialiasing (DLAA or TAA) for calibration frames; a still world lets history converge | Fitted blur σ applied to the Studio render before sharpness and highlight-size metrics; region means unaffected | [source] [Glitter in game §1](../../knowledge/glitter-in-game.md#1-from-flake-texture-to-screen-pixel) |
| **Upscalers** (DLSS, FSR3, XeSS; frame generation; Ray Reconstruction) | Lower internal resolution, reconstruction, sharpening, a possible negative mip bias | Record upscaler, mode and sharpening; the reference setup runs DLSS Auto at 3840×1600 | As above; plus a DLAA-against-DLSS pair once, to size the difference | Closed binaries: [hypothesis] |
| **Dynamic resolution** | Frame-to-frame resolution changes | Record; off for calibration | Burst differences show it | [hypothesis] |
| **Screen-space subsurface scattering** | Blurs skin *light* (not albedo) with a world-space radius; widens and reddens the shadow terminator; makeup colour stays sharp | Nothing to switch off (settings for the translucency variant unknown) | Shading-profile width and a\* at the terminator; the Studio's wrap stand-in is expected to differ here, and the difference is reported, not fitted | [source] [skin reference §6.3](../materials/shader-skin.md#63-blur-kernel-and-combine) |
| **Shadows and contact shadows** | Brow ridge, nose, hair and lashes shadow the face; the creator rig marks five shadow-casting and four contact-shadow lights | None | The Studio draws none in the creator preset: regions next to occluders (upper lids, under the nose, the hairline) are flagged "shadow-affected" in the atlas and reported separately | [resource] [creator lighting §7](../../knowledge/creator-lighting.md#7-what-the-preview-needs) |
| **Ray-traced lighting and reflections; path tracing** | Local shadows, bounce light, reflections | Record every ray-tracing setting; the creator box's black walls keep bounce small [resource]; path tracing off for calibration frames | One pair with ray tracing off in a later session sizes the delta | [hypothesis] ([wgpu assessment](../backlog/wgpu-renderer-assessment.md)) |
| **Ambient occlusion** | Darkens creases (eye corners, nostrils, lips) | Record the setting | Crease regions flagged like shadow-affected ones | [hypothesis] |
| **Auto exposure** (world only) | Global scale that adapts | Creator: fixed; photo mode: ratios and the unlit background patch | §1.6 | [resource] creator settings; adaptation in photo mode [hypothesis] |
| **Grading LUT and LUT Switcher** | Whole tone curve; LUT Switcher applies its LUTs as player effects in game | The Studio resolves the archive winner; LUT Switcher toggled off for calibration frames, recorded otherwise | Inverse LUT for linear arithmetic | [resource] [installed] |
| **Film grain, chromatic aberration, vignette, depth of field, lens flare, motion blur, bloom** | Noise; channel shifts; edge darkening; blur; halos | Game settings off (the creator-lighting prep list) and photo-mode keys 25 and 13 at 0; depth of field read, never written; bloom has no switch | Grain raises the noise floor; bloom is sized from the halo around the cornea highlight | [resource] [runtime] keys |
| **HDR output** | A different transform (ACES after the HDR LUT) | SDR only | — | [resource] |
| **ReShade** | Any effect after the game | Effects off, or the before-effects add-on; record the state | — | [installed] |
| **Character Rendering Editor** | Runtime hair (and possibly skin) options | "Vanilla" for calibration frames, the usual preset recorded otherwise | — | [community] |
| **Texture streaming and mip bias** | Lower-resolution textures shortly after a change | Wait at least 2 s after any appearance change before capturing | Sharpness metric flags it | [hypothesis] |
| **Hair simulation, idle motion, blinks** | Strand positions, head drift, closed lids | Still world; burst selection in the creator | Statistics only for hair | [runtime] drift |

## 4. The first protocol and the tooling

### 4.1 Five minutes in the next bridge session

Proposed as **Part E** of [session 3](../../experiments/022-session-3/README.md) (after Part A, while the creator is still open), or the first part of session 4; the coordinator adds it to the session script with `projects/xf-runtime-bridge/tools/sessions/make-sessions.py`. It needs only commands built today. Everything but steps E0's confirmations and the creator's opening is bridge-driven.

| Step | Where | What | Commands | Time |
|---|---|---|---|---|
| E0 | Anywhere | Confirm in chat: SDR, ReShade effects off, the upscaler and mode, ray/path tracing, the Character Rendering Editor preset, LUT Switcher state; game-wide film grain, chromatic aberration, depth of field, lens flare, vignette and motion blur off (a one-time settings change, recorded) | `bridge.info`, `game.status` | 30 s |
| E1 | Creator, eyes zoom, XF row Off | Identity check, then a 12-frame burst of the whole window | `player.appearance`, `cc.apply` XF 0, wait 2 s, `capture.burst` (full, 12 frames, 150 ms) | 30 s |
| E2 | Creator, hair page | Move the creator camera to the hair page by re-applying the current hair value through its row (the row's own path moves the preview camera to its body region, [photo mode §7](../../knowledge/photo-mode.md#7-keeping-the-creators-rows-in-step-with-scripted-changes) [hypothesis]; if it doesn't move, the player clicks the hair page), then an 8-frame burst; then back to the eyes zoom and one more 8-frame burst for the exposure repeat | `cc.apply` (hair, current index), `capture.burst` ×2 | 45 s |
| E3 | Leave the creator (Back) | The player presses Back, or `cc.back` where allowed | `cc.back` | 10 s |
| E4 | Photo mode, a dim quiet spot, 02:00 | Open, hide the HUD and cursor, NPCs as found (attribute 54 off by hand if any are near), grain and aberration 0, look-at off, roll 0; frame the face | `world.time.set` 02:00, `photo.open`, `photo.hud.hide`, `photo.camera.set {grain: 0, chromatic_aberration: 0, look_at: 0, roll: 0}`, `photo.frame {target: face, look_at: off}`, `photo.state` | 45 s |
| E5 | Photo mode, face framing | Read the subject with the five default points; light 1 off → capture; on (spot, shadow on, brightness 60, range 20, white) → wait 1 s → capture; off → capture | `photo.subject`, `capture.screenshot` ×3, `photo.light.set` ×2 | 40 s |
| E6 | Photo mode | Yaw sweep with light 1 on: `yaw_offset` −30, 0, +30, each followed by `photo.subject` and a capture; the 0° frame also answers whether the photo-mode expression looks neutral | `photo.frame` ×3, `photo.subject` ×3, `capture.screenshot` ×3 | 60 s |
| E7 | Photo mode | Eyes framing, light on: subject and capture (catch-light position and size); light off; leave | `photo.frame {target: eyes}`, `photo.subject`, `capture.screenshot`, `photo.light.set`, `photo.exit` | 30 s |

About five minutes. What the frames answer, offline, the same day:

| Check | Frames | Answers |
|---|---|---|
| C0 identity | E1 | The Studio and the game agree on every creator option, or the pair is refused |
| C1 camera reconstruction | E5–E7 | Residual of the projected points (target, head, up, right) after mapping; the FOV axis of `GetActiveCameraFOV`; the handedness of the right vector |
| C2 creator camera | E1, E2 | Yaw, distance and FOV axis of the creator camera (creator-lighting open question 3) |
| C3 creator exposure and rig switches | E1, E2 repeat | `k`, the intensity form and cone reading, fixed exposure (the calibration helper's pass marks) |
| C4 region table | E1, E2 | ΔE, ratios and quantile curves for skin, lips, sclera, iris, brows, lashes and hair |
| C5 eye highlights | E1, E7 | `Main_Eyes` catch light on the cornea (creator), photo-mode light catch light (photo mode) against the Studio's (part of head CC test ask 12) |
| C6 blur and drift | E1 burst, E5 | Fitted σ; idle drift; burst-to-burst noise floor |
| C7 photo-mode light | E5, E6 | Light-only difference image; a fitted light position relative to the camera (photo-mode open question 5); shading-profile agreement for three light directions |

### 4.2 What each check needs before the session

Nothing new in the game. Offline, before the session: the session steps (S), and the manifest writer (P1, below), so the frames arrive with their readings. Everything else can be built after the frames exist; that is the point of storing them.

### 4.3 Tooling, phased

Effort as in the eye plan: **S** about a day of agent work, **M** a few days, **L** a week or more.

| Phase | Deliverable | Where | Effort |
|---|---|---|---|
| P0 | This design; Part E steps in the session script | `research/authoring/`, `tools/sessions/` | S |
| P1 | **Bridge reads for parity.** `photo.subject` gains `points` (up to 16 head-relative offsets) and the head slot's orientation; `game.settings.read` (local, read-only) digests the graphics and post settings from the user settings file; a `do: parity` session step bundles capture, `photo.state` or `player.appearance`, `photo.subject` and the settings digest into one `xfb/parity-capture-1` manifest; `photo.camera.set` gains exposure, contrast, highlights and vignette (validated like the others) | `projects/xf-runtime-bridge` (redscript, `tools/api`, `tools/sessions`) | M |
| P2 | **Studio still renders and ID passes.** Typed action `preview.renderStill` with `beauty`, `ids`, `coverage`, `normal`, `depth`, `albedo`; the head-UV label atlas per body gender (`data/parity-regions.json` plus a generated label texture); a pure `gameCameraToStudio(subject, headBone)` with unit tests on synthetic readings; the action in the catalogue with its boundary test | `projects/xf-studio/authoring/src` (domain function, renderer adapter, catalogue) | M |
| P3 | **Compare tool.** `bun tools/game-parity.ts render <manifest…>` drives an isolated `?verify=1` Studio through the DevTools harness `scene-parity.ts` uses; `compare` registers, measures (§3.2, reusing `creator-calibration.ts`) and writes a scorecard JSON plus a private contact sheet (game, Studio, labels, difference, per-region swatches); `replay` re-renders and re-scores every stored manifest | `projects/xf-studio/authoring/tools/`, `src/` (pure metric module, tested on synthetic images) | M |
| P4 | **Control and fidelity of the scene.** A spawned bridge light at an exact position (Codeware `DynamicEntitySystem` with a base-game light entity), `cc.subject` (creator puppet and render-to-texture camera), a creator puppet freeze, and the light-position fit of C7 as a tool | Bridge, Studio tools | L |
| P5 | **Calibration-grade capture.** The before-effects ReShade add-on (maintainer decision 4 of the bridge design) with float output where the swap chain is float | Bridge (optional layer) | M |

Captures, contact sheets and Studio renders are private renders of local game assets: they stay in ignored folders (`projects/xf-studio/authoring/evidence/screenshots/game-parity/<run>/` for Studio renders and reports, the bridge's own capture root for game frames). Only asset-free scorecards are committed.

## 5. How results feed back

1. **A scorecard per run** (committed, asset-free): the manifest hashes and settings digest, the Studio build commit, the preset and its three free parameters, and every metric with its pass mark and noise floor. Proposed home: an experiment folder allocated when P3 lands, with one results table in its README.
2. **The fidelity backlog** gets a measured column. Each row of [preview fidelity](../backlog/preview-fidelity.md) (brows, lashes, hair, skin, eyes, face details) cites its latest scorecard values; a failing measure becomes a numbered item whose diagnosis names the layer at fault: resolver (C0), camera (C1–C2), light or exposure (C3, C7), material (C4–C5), or post-processing (C6). The backlog's standing rule holds: diagnose each difference; never tune geometry or colour by eye to hide it.
3. **Knowledge pages** take the numbers as **[runtime]** evidence, citing the scorecard and the capture hash: the creator exposure and the two switches in [creator lighting](../../knowledge/creator-lighting.md) (and the preset's default `k` changes only through a normal reviewed change that cites the scorecard), the camera answers in [creator lighting §3](../../knowledge/creator-lighting.md#3-camera) and [photo mode](../../knowledge/photo-mode.md), the eye asks in [eye rendering](../../knowledge/eye-rendering.md) and [head CC rendering](../../knowledge/head-cc-rendering.md#in-game-test-asks), the hair ladder in [hair shading](../../knowledge/hair-shading.md). The claim is always "within X under settings Y", never "matches the game".
4. **Free parameters are declared before fitting.** Only `k`, the two rig switches, the creator camera's yaw and distance, and the slot-to-joint offset are fitted. Each is fitted on one frame set (the creator eyes zoom) and checked on another (the hair page, photo mode); a parameter that only fits its own frames is a finding, not a calibration.
5. **Replay is the regression test.** After any renderer or material change, `game-parity.ts replay` re-scores the stored corpus offline. A change that makes a region worse by more than the noise floor is flagged at review; a change that makes it better is reported as an [offline] improvement against a [runtime] reference until the next session repeats the frame.
6. **Questions that only the game can answer go to one prepared session**, as the working rules require; this protocol's checks are designed to be added to a session card, not to create sessions of their own.

## Open questions

1. Is `GetActiveCameraFOV()` vertical or horizontal, and does `ProjectPoint` answer in the rendered image's pixels at the window's size (C1)?
2. Does the `Head` slot sit on the head joint the Studio's rig calls `Head`, and do their local axes agree once the Studio's Y-up conversion is applied?
3. Does re-applying a creator option's current value move the creator camera to its region without changing the look (E2)?
4. Does automatic exposure keep adapting while photo mode pauses the world, and how fast (the light pair of E5)?
5. Does the photo-mode default expression equal the Studio's neutral face closely enough for face-region metrics (E6)?
6. Do all feminine heads share one UV layout, so one label atlas serves every V (and one more for masculine heads)?

Related: [creator lighting](../../knowledge/creator-lighting.md) · [photo mode](../../knowledge/photo-mode.md) · [runtime access](../../knowledge/runtime-access.md) · [runtime bridge design](../runtime/runtime-bridge-design.md) · [bridge autonomy](../backlog/bridge-autonomy.md) · [hair calibration](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request) · [preview quality contract](preview-quality-contract.md) · [preview fidelity](../backlog/preview-fidelity.md).

**Provisional decisions (coordinator, 27 September 2026, for the maintainer's review):** Part E runs as an optional last part of session 3, moved to session 4 if session 3 runs long; ray-tracing-off and DLAA comparison frames wait for a later session.

