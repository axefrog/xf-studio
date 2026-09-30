# Render gap plans

**Status: research and diagnosis, 30 September 2026, against `main` at `2d6752b`. Nothing here is built.** One implementation-ready plan per top gap of the refreshed [render coverage audit](render-coverage.md#6-ranked-gaps), each with its root cause or ranked hypotheses, the fix design, the effort and the test that would show it, and a batched [capture request](#8-capture-requests-one-prepared-session) for the gaps that need the game. Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[resource]**, **[source]**, **[runtime]**, **[offline]** (measured with the Studio's own code on game data, not seen in game), **[hypothesis]**. Offline measurements never prove game rendering ([AGENTS: evidence and honesty](../../AGENTS.md#evidence-and-honesty)). New measurements are in [experiment 034](../../experiments/034-render-coverage-refresh/README.md).

Effort: **S** about a day of agent work, **M** a few days, **L** a week or more.

## In brief

| Rank | Gap | Diagnosis | Confidence | Fix | Effort |
|---|---|---|---|---|---|
| 1 | [Teeth read as gritted when the idle parts the lips](#1-teeth-and-the-mouth-interior-prev-147) (PREV-147) | Geometry is the game data's under both facial setups and every open solver reading. The mouth interior is lit about three times brighter than the stand-in's own model says for the idle's 3 mm parting, where the game most likely shadows it per light [hypothesis] | Geometry: high. Lighting as the cause: medium, until the breath capture | Pose-aware interior occlusion (S), then per-light interior shadowing (M) | S + M |
| 2 | [Masculine V: beard cards and face motion](#6-masculine-v-beard-cards-and-face-motion) | The planner draws only decal chunks for face options, so the beard's `hair.mt` cards drop out; the face host serves only the feminine rig | High (source) | Face options plan every drawable chunk; masculine face rig and clips | M (cards), M–L (face) |
| 3 | [Lit skin reads warmer than the game](#4-lit-skin-hue) | Not subsurface scattering (refuted). Leads: the albedo's decode, or the effective albedo | Medium | None until the capture separates the leads | S after capture |
| 4 | [Arm cyberware](#5-arm-cyberware) | The body plan always reads `holstered_default_tpp`; the loadout reader keeps clothing areas only; `glass_onesided.mt` has no adapter and `metal_base` no alpha test (PREV-117) | High (resource, source) for the chain; the engine's last step is a hypothesis | Holster state from the save's `ArmsCW` item, two adapters | M |
| 5 | [Hair: the ladder's missing light](#2-hair-the-ladders-missing-light) | The decoded bake is done and holds (session 3). The game's ladder is 1.5–1.8× steeper and cooler: missing light, not the bake | Bake: high. Which light: low | Per-fragment linear falloff (removes a known approximation), a hair-only refit, then the RT-off capture | S–M |
| 6 | [Subsurface scattering](#3-subsurface-scattering) | Built (the game's kernel, blur and combine). Open: the screen scale, a first-frame hitch (PREV-142), local-light translucency | High for what is built | Fit the scale from the raking capture; compile variants in the background | S + S |
| 7 | [Smaller gaps](#7-smaller-gaps) | Brows' surface writes, decal residual light, heterochromia, wrinkles, emissive, the hair cap's blend | High (source) | Per item | S–M each |

## 1. Teeth and the mouth interior (PREV-147)

**What shows.** In the creator close-up idle V's lips part slightly, and the upper and lower teeth both show, meeting edge to edge, like gritted teeth; the game is not seen to do that (maintainer report, 28 September).

**Evidence so far.**

| Fact | Grade |
|---|---|
| Skinning (upper teeth on `Head`, lower on `mid_J_jaw_JNT`), binds, `mouth` shape and rest bite (1.9 mm overlap, 4.7 mm overjet) match the game files | [offline, 27 September] ([head CC rendering §6](../../knowledge/head-cc-rendering.md#6-render-plan-ranked-by-visual-gain-per-effort)) |
| The look is the loop's two breaths (about 2 s and 14 s): a lip funnel with the jaw almost closed | [offline, 27 September] |
| **Under the male player setup** (the preview's since 29 September) the breaths part the lips 2.75–2.91 mm at the outer lip (3.36–3.51 mm under the female setup) and 3.5–3.6 mm at the inner lip (4.9–5.0); the jaw is identical (0.65–0.88°) | [offline, 30 September] ([experiment 034 §1](../../experiments/034-render-coverage-refresh/README.md#1-the-idles-breaths-under-each-facial-setup-prev-147)) |
| **None of the solver's open alternatives** (E1, E2, C1, I1) changes the breaths | [offline, 30 September] |
| The lips are parted by 1 mm or more for 6.7 s of every 22 s loop | [offline, 30 September] |
| The mouth-interior stand-in (`src/mouth-occlusion.ts`) assumes a fixed 10 mm parting and floors at 0.3: the front teeth keep 0.36 of every light. Its own formula at the idle's parting gives 1.5 / √(1.5² + 13²) ≈ 0.11, so the preview lights the front teeth about **three times** brighter than its model predicts for the breaths | [source] |
| The teeth are lit by every creator light; only the four contact-flagged lights get the screen-space contact march, and the head-scoped shadow maps keep a 1.5 mm bias and a 3 mm penumbra, comparable to the slit | [source] (`platform/scene/contact-shadow.ts`, `CREATOR_SHADOW`) |
| The reference install runs ray-traced local shadows, which occlude a 3 mm slit exactly | [runtime, install state]; that the creator's render target traces is [hypothesis] ([creator lighting §12.4](../../knowledge/creator-lighting.md#124-what-remains)) |

**Hypotheses, ranked.**

1. **Light, not geometry** (likely). In game the interior behind a 3 mm slit gets little light: per-light shadows (ray-traced on the reference install), screen-space occlusion and the contact march all close it. The preview keeps 0.36 of every light there, so two bright incisal edges read against the dark parting and the eye takes them for a clenched bite. Consistent with everything measured; untested in game.
2. **The engine parts the lips less, or not at all, at the breaths** (possible). The paperdoll face graph (`player_woman_paperdoll_sermo.animgraph`) might blend `ui_closeup_shot` below full weight or over another pose; nothing offline shows it, and the solver's open readings are ruled out. The breath capture answers it directly: if the game's lips stay closed at 2 s and 14 s, the gap is the graph, not the light.
3. **Placement or jaw** (ruled out offline): the meshes, binds and jaw match; the setup switch shrank the window by about 0.6 mm but kept it centred on the bite.

**Fix design.**

- **Step A: a pose-aware interior term (S).** Keep the stand-in's geometric model, but feed it the real parting each frame instead of a constant:
  - **Aperture as derived data.** A pure function of the solved face (`mouthAperture(posedLips, restLips)`: the midline parting from the four `[lr]_J_mug_lip_(up|dn)_0_JNT` joints, change from rest, clamped at 0) and a node in the view graph that derives it from the face driver's posed joints. Joints are found by the facial setup's mouth region (`JointRegions` = 2) and their side and rest height, not by a name list, so a rig with other names works too.
  - **Per-vertex depth stays baked** (`interiorOcclusion` already computes `d` per vertex; store it as an attribute instead of the factor).
  - **The shader computes** `v = (h/2) / √((h/2)² + d²)` with `h` from a uniform the node writes, and a lower floor (0.05 rather than 0.3; a Studio choice until capture C1 gives the game's teeth-to-lip ratio). With the lips closed `h` = 0 and nothing shows; at the breaths the front teeth fall from 0.36 to about 0.11; at the teeth page's 15 mm, about 0.5; a wide smile is no longer too dark, which the fixed constant got wrong in the other direction.
  - Nothing names the teeth: the term applies to the slot's parts drawn inside the head, as today.
- **Step B: per-light interior shadowing (M), if the capture shows light leaking.** Extend the contact march to parts drawn inside the head: for those fragments march toward **every** light (not only the flagged ones) through the character's depth with a reach of about 25 mm, which resolves a 3 mm slit 13 mm deep. That removes the stand-in's lighting half (it keeps only the ambient share), and it also serves the tongue and any mouth-interior mod. Cost is bounded by the interior's screen footprint.
- **Step C, only if hypothesis 2 holds:** read the paperdoll face graph's weighting of the close-up loop offline (the graph reader exists for hair physics) and apply it to the idle's face track.

**Tests.**

- Unit: `mouthAperture` is 0 at rest and 2.75 ± 0.1 mm at 2.4 s of the loop under the male setup (experiment 034's numbers), and never negative.
- Real GPU (`tests/webgl-*`, headless): the reference V at 14.5 s under Character creator lighting; the mean teeth luminance inside the parting relative to the lower lip falls by at least half after step A, and is unchanged with the lips closed.
- Parity: capture C1 below, compared frame by frame after aligning the loop phase from the lip-motion curve; C2 for the teeth page. The acceptance mark is whether the game shows both rows at the breaths, and the teeth-to-lip luminance ratio within 30 %.

## 2. Hair: the ladder's missing light

**The decoded bake is done** (27 September) and session 3 confirmed it as far as the preview can: the Studio's render reproduces the bake's albedo spread under the creator light [runtime, one session] ([hair shading §8](../../knowledge/hair-shading.md#creator-ladder-session-3)). What remains is that the game's ladder is 1.5–1.8 times steeper than the albedos predict and cooler in every colour, with the shortfall largest at the crown and on the lengths away from the key.

**Hypotheses, ranked** (all [hypothesis]):

1. **The preview under-lights the crown: Rim_Top's linear fold.** The creator's Rim_Top uses the linear falloff, and the preview folds it into one intensity at the head slot (0.06 there), which under-lights the crown, 1.44 m from the light, about twofold ([creator lighting §12.4](../../knowledge/creator-lighting.md#124-what-remains)). It matches "largest at the crown". It doesn't explain the lengths.
2. **Ray-traced diffuse light through hair's ambient path.** Hair carries its albedo twice in ambient light ([hair shading §5](../../knowledge/hair-shading.md#5-deferred-hair-light)), so any bounce reaching it steepens the ladder with albedo, as seen. The reference install runs ray-traced lighting. The RT-off ladder separates it.
3. **The fills are a skin-side compromise.** The two-capture refit set the four cyan fills to ×0.35 on luminance over mostly skin regions ([creator lighting §12.6](../../knowledge/creator-lighting.md#126-refit-from-two-captures-28-september)). The game's hair is cooler than the preview's in every colour, which fits stronger cyan light on hair than the fit allows. If the skin's own shading takes less of the fills than the preview's (the skin program's per-light roughness shift and specular tint are not in the hair path), one global gain can't serve both.
4. **TRT under the cool rims** ([hair shading §8](../../knowledge/hair-shading.md#creator-ladder-session-3)). Least likely alone.

**Fix design.**

- **Step A: per-fragment linear falloff (S–M).** Replace the fold for linear-falloff lights with the decoded `1 − saturate(d/r)` per fragment: a per-light flag and radius the lighting stage passes, and a patch of Three's distance attenuation for flagged lights in the shared light chunk (every material that uses Three's lights, so hair, skin and metals agree). It removes a known approximation whatever the ladder says.
- **Step B: a hair-only refit (S, offline).** Render per-light solos on the session-3 V at the matched framing (`tools/creator-light-look.ts --solo`), fit gains on hair pixels only, and compare them with the skin fit. Fills wanting about 1 on hair while skin wants 0.35 supports hypothesis 3, and points at a skin-side term to decode (it would not justify per-class gains, which the game doesn't have).
- **Step C, after capture C3:** if the RT-off ladder matches the preview, the preset keeps its direct-only light and says in plain words that ray-traced bounce is not reproduced; if it doesn't, steps A and B carry on.

**Tests.** A unit test of the falloff patch against `linearFalloff` at 10 distances; the session-3 ladder re-rendered after each step with the region metrics of [hair shading §8](../../knowledge/hair-shading.md#creator-ladder-session-3) (crown and both length ratios per colour); the pass mark is the steps moving the Studio's ratios toward the game's without raising the skin regions' rms in [creator lighting §12.6](../../knowledge/creator-lighting.md#126-refit-from-two-captures-28-september).

## 3. Subsurface scattering

**State.** The game's screen-space scatter is built (27 September): the kernel from the `.sp` profiles, the input variants, the separable blur with the class rule and the combine, with the wrap as the fallback ([skin reference §11](../materials/shader-skin.md#11-screen-space-scatter-in-the-preview-threejs)). On the matched pair it moves shadows toward the game's colour and contrast but leaves the lit skin's hue alone, which is not a scatter effect ([§4](#4-lit-skin-hue)).

**What remains.**

| Item | Cause | Fix | Effort | Test |
|---|---|---|---|---|
| Screen scale (`SCATTER_SCREEN_SCALE`) | `w · cb0[3].x` is not decoded ([skin reference §6.3.3](../materials/shader-skin.md#633-quality-radius-and-scale)); the matched pair can't fit it because the nose wedge is dominated by the fills | Fit from capture C4's raking-light frames: one free scale, the terminator band's red spread across the cheek in scene-linear light | S after C4 | The fitted scale reproduces the band's red half-width within 20 % at two yaws; region rms not worse |
| First-frame hitch (PREV-142) | One input-variant program per material compiled synchronously (70–120 ms) | `compileAsync` of the variants while the wrap shows, then switch | S | A scripted V change shows no main-thread task over 50 ms from the scatter (the [performance budget](../backlog/performance.md)) |
| The combine's tinted `A` term | Unread which input it is | Decode (materials track) before modelling | Research | – |
| Translucency from local lights | Runs in game for a back light [runtime]; only the sun's path is decoded; every creator light is local | Decode the local-light path first ([skin reference §6.4](../materials/shader-skin.md#64-translucency-the-usetranslucency-setup)) | Research, then M | An ear back-lit by the magenta rim, preview against a creator frame |

## 4. Lit skin hue

Every V's lit skin reads warmer in the preview than in the game: forehead R/G 1.33–1.41 against the game's 0.97 and 1.07 on two captures of two Vs [runtime, two captures]. It belongs to the creator-lighting track; it is ranked here because it is the most visible difference left on a drawn part.

**Ruled out:** subsurface scattering (identical with the wrap, the scatter or neither), the `TintColor` encoding, the combine's tinted term (bounded at about 4 %), and a coloured key (the silver ring's highlight cores are neutral) ([skin reference §11.8](../materials/shader-skin.md#118-checks-and-measurements)).

**Leads** [hypothesis]:

1. **The albedo's decode** (the skin reference's lead): decoded once, as `isGamma` asks, the albedo gives the preview's R/G; undecoded it would be near the game's. Only the game's sampler state settles it.
2. **The effective albedo** (added here): both captures are of Vs on the reference install, whose complexion replacer the Studio draws (4096² albedos). If the game draws another winner or a lower mip of it, the hue differs without any shading difference. Head CC test ask 2 (the replacer on and off) separates it from lead 1.
3. **Fill colour against fill strength** ([creator lighting §12.6](../../knowledge/creator-lighting.md#126-refit-from-two-captures-28-september)): a weaker but more saturated cyan fill would cool lit skin without raising the shadows.

**Fix design.** None until capture C5: each lead predicts a different outcome (lead 1: the gap stays with the replacer off; lead 2: it closes with it off; lead 3: shadowed regions move more than lit ones). The change after it is a single constant or rule in one adapter (S).

## 5. Arm cyberware

**What the game does** [resource; source], read offline ([body rendering §1.1](../../knowledge/body-rendering.md#11-how-equipped-arm-cyberware-picks-the-holster-state)): the item in the `ArmsCW` equipment area names a `holsteredItem`, whose `appearanceName` is the creator group's name (`holstered_strong`, `…_mantis`, `…_nanowire`, `…_launcher`; `holstered_default` without arm cyberware); the third-person arms draw that name's `tpp` group (the feminine resource splits `_tpp`/`_fpp`; the masculine doesn't). The engine's own final step is native [hypothesis].

**What each state draws** [resource: the reference save's resolved groups, 25 September]. Each holster state is **two creator options that fill the same component names** with different mesh appearances and chunk masks: `h_<state>_arms_colors_base_tpp` (the skin-tone half: the arm's skin chunks) and `h_<state>_arms_colors_cyberware01_tpp` (the cyberware half):

| State | Components (per arm) | Templates in the cyberware half |
|---|---|---|
| Gorilla Arms (`holstered_strong_tpp`) | `a0_005_wa__strongarms_photo_mode_[lr]`, `…_cyberware_[lr]` | `multilayered.mt` 2–3, `skin.mt` 1, `mesh_decal.mt` 7, `metal_base.remt` 2, `glass_onesided.mt` 1 |
| Mantis Blades (`holstered_mantis_tpp`) | `a0_003_wa__mantisblade_photomode_left…` and `…_right`, `…_upperarm_left` and `…_right` | `skin.mt` 1, `metal_base.remt` 2, `multilayered.mt` 0–1 |
| Monowire (`holstered_nanowire_tpp`) | `a0_002_wa__monowire_whip_[lr]_cableless` | `skin.mt` 2, `mesh_decal.mt` 1–2, `multilayered.mt` 0–1 (one option only) |
| Projectile Launch System (`holstered_launcher_tpp`) | `a0_006_wa__launcher_holstered_photo_mode*`, `…_upperarm_photo_mode` | `skin.mt` 1, `multilayered.mt` 1, `mesh_decal.mt` 3 |

Every state also carries the personal link (`a0_001__personal_link_tpp4537`), and the nails option covers every state but Gorilla Arms. The body planner's de-duplication key includes the chunks and materials, so both halves of a state draw as the game draws them, and an identical personal link draws once [source].

**What the Studio lacks** [source]: `BODY_GROUPS.arms` is fixed to the default state; the save's loadout reader keeps only the clothing areas (`CLOTHING_AREAS` in `saved-v.ts`), so the `ArmsCW` item is never read; `glass_onesided.mt` has no adapter (the Gorilla Arms glass); `metal_base` ignores an instance's `enableMask`, so the decal and logo chunks of Gorilla Arms and Mantis Blades would draw opaque (PREV-117).

**Fix design (M, about 3–4 days).**

1. **Loadout** (S): read the `ArmsCW` area's active item beside the clothing areas (`SavedLoadout.arms`, a schema bump), with the vanilla semantics the clothing reader follows.
2. **Holster state** (S): on the host, item → `holsteredItem` → `appearanceName` through the TweakDB flats reader (TweakXL records included, as the clothing records are), then the `perspectiveInfo` entry whose `name` equals it gives the third-person group. No item, or an unreadable chain, means `holstered_default` with the reason recorded. Nothing names a cyberware: a mod that adds arm cyberware with its own holstered item and creator group works the same way.
3. **Body state** (S): `BodyState` gains the arms group; `bodyGroups("arms", state)` returns it; the character request carries it (a version bump), so the context, prefetch and the record follow it. The creator and the default V stay on the default state, as the creator puppet has no arm cyberware.
4. **Adapters** (S each): carry `enableMask` through the chain and alpha-test `metal_base` at `AlphaThreshold` (PREV-117); a `glass_onesided` adapter as the [metal and glass reference §7](../materials/shader-metal-glass.md#7-recommended-preview-adapters-ranked) specifies (tint and distortion, no local lights, which is what the creator shows).
5. **Coverage** (S): the holster-state options read "Shown when your V's equipped arm cyberware selects it" (`conditional`), settled from the plan like the face decals; the Body section says in one plain line which state is shown and why.

A viewer's choice of state (showing Gorilla Arms on a V who doesn't own them) would be a new feature; it is banked, not part of this plan.

**Tests.** Unit: the loadout reader on a save package fixture with and without `ArmsCW`; the TweakDB chain on a flats fixture (vanilla and a TweakXL-added item); the planner selecting each state's two options and drawing the personal link once. Offline render: the reference save with its state forced through a test seam, each state's chunks drawn with no `decal-template` or missing-adapter limit. In game: capture C6.

## 6. Masculine V: beard cards and face motion

**Beard cards** [source; offline coverage walk]. Face options (groups `TPP`, `face`, `beards`) are planned only through their decal-family chunks, so a beard part's stubble decal draws and its `hair.mt` cards are dropped. The 13 beard-part rows and 57 beard-colour rows are `conditional` ([experiment 034 §2](../../experiments/034-render-coverage-refresh/README.md#2-coverage-walk)), and once resolved they **overclaim**: the Character panel settles a conditional row from the options the V's details draw (`characterDetails.drawn`, `studio-ui/panels/character.ts`), and every beard part counts as drawn because its stubble is, so the row carries no "not shown" mark while its cards are missing [source]. (`refineCoverage` in `cc-render-coverage.ts`, written for this, is called only by its test.)

- **Fix (M).** Plan every drawable chunk of a face option, each through the adapter its template picks: decal-family chunks through the face-decal path as now, `hair.mt` chunks as strands with the hair adapter (their `.hp` from the chunk's own chain), in the face slot's draw order after the skin and before the lashes. The rule is by template, so a CCXL face option with strands (a mod beard, a moustache) draws the same way. The beard's colour controller (`beard_color`, 35 colours) needs nothing new: the resolver already picks each part's `<colour>__beard.mi`.
- **Coverage honesty (S, now).** Until the cards draw, the host's drawn list should say per option whether every drawable part was drawn, and the row should carry a "drawn in part" note naming what is missing (the cards), rather than no mark.
- **Test.** The default masculine V with beard 05: both card chunks (2,744 and 6,522 vertices) drawn two-sided, the coverage rows settling to drawn, and the colour following `beard_color`; before the cards land, a panel test that a beard part with its cards left out carries the "drawn in part" note.

**Face motion** [source]. A masculine V's face holds still: the idle, the blink and live expressions refuse his head (`IDLE_MASCULINE`, `FACE_MASCULINE`). His face rig, setup and clips are his own ([masculine V plan](male-v-plan.md#phase-status), phase 2). This is the motion track's work (M–L); it is ranked here because half of all Vs show it.

## 7. Smaller gaps

| Gap | Cause | Fix | Effort | Test |
|---|---|---|---|---|
| Brows' normal and roughness writes | `brow-material.ts` draws a fixed roughness 0.8 and no normal write | Route brows through the face-decal family's double-diffuse member, which draws both | S | Brow colour unchanged against the current adapter's goldens; highlight under a moving light |
| Face decals' residual light | Each decal is lit with an interpolated surface, not the one blended surface the plate uses | Light decals from the blended G-buffer-like surface | S | Plate parity tests re-run |
| Heterochromia | The planner reads `eyes_color` only; a second eye component (`eyes_color_2`) is not drawn | Plan the second component on its own eye | S–M | One heterochromia mod's two eyes drawn |
| Wrinkle maps | Not drawn; the region set and driver are located ([natural expressions §9.5](../animation/natural-expressions.md#95-plan-wrinkles-in-the-preview-scoped-not-built)) | As planned there | M | Close-up comparison of a smile and a squint |
| Emissive skin and decals | `EmissiveEV` unread; no vanilla feminine option emits | After the materials track decodes `EmissiveEV` | S–M | A mod complexion's glow |
| Hair cap blend | Linear "over", lighter at partial coverage than the engine's square-root-space blend | Blend the cap in the decal family's square-root space | S | Scalp line at partial coverage against the current render |
| Eyes-section idle switch (PREV-141) | The showcase starts the loop at phase 0 | A runtime two-clip blend | S | No jump at the switch |
| A CCXL option with no consumer group | The coverage walk found one hair pack's cap option with an empty group list; the preview doesn't draw it | Read how the game consumes it before changing the rule [hypothesis] | Research | An in-game look at that hairstyle's scalp |

## 8. Capture requests (one prepared session)

For the next prepared session, bridge-driven where the bridge can, in the style of the [parity measurement design](../authoring/game-parity-measurement.md#41-five-minutes-in-the-next-bridge-session). **Settings for every step** (§1.6 there): the test profile with Ultra+ disabled, the Character Rendering Editor on its **Vanilla** preset, ReShade effects off, SDR, the CET overlay closed while capturing (session 4's teeth frames were lost to it); record the SSS quality, ray tracing and path tracing, the upscaler and the LUT winner. The Studio side renders the same V under the **Character creator** lighting setup (not a fork) with the matched camera ([creator lighting §12.5](../../knowledge/creator-lighting.md#125-refitting-from-new-matched-captures)).

| Step | Where | What | Commands | Time |
|---|---|---|---|---|
| C0 | Anywhere | Confirm the settings above in chat | `bridge.info`, `game.status` | 30 s |
| **C1 Teeth breath** | Mirror, the reference save, default teeth | Move to the lips, let the lips' one-shot finish, then record a whole loop of the close-up idle, then the same at the head framing | `cc.page {page: "lips"}`, wait 6 s, `capture.burst {frames: 60, interval_ms: 400}` (24 s); `cc.page {page: "head"}`, wait 2 s, `capture.burst {frames: 60, interval_ms: 400}` | 1 min |
| **C2 Teeth page** | Mirror, same V | The teeth page's loop (`ui_expose_teeth`) parts the lips about 15 mm; one frame per choice | `cc.page {page: "teeth"}`; for index 0–4: `cc.apply {option: "teeth", index}`, wait 3 s, `capture.screenshot`; restore the saved index | 1 min |
| **C3 Hair ladder, RT off** | Mirror hair page, session 3's hairstyle and four colours | Session 3's ladder with ray-traced lighting (and path tracing) **off**, set once by the maintainer | `cc.page {page: "hair"}`; per colour `cc.apply` then `capture.burst {frames: 8, interval_ms: 150}`; restore | 2 min + the settings change |
| **C4 SSS scale** | Photo mode, a dim quiet spot, 02:00 | Skin test ask 4 again with Ultra+ off: one raking light (azimuth 90°, elevation 10°, 0.8 m), camera yaw −60, 0, +60 and the double-span frame, at SSS quality Low, then High (the maintainer changes the setting; restart if the menu asks) | `world.time.set`, `photo.open`, `photo.hud.hide`, `photo.light.set`, `photo.frame {yaw_offset}` ×3, `photo.subject`, `capture.screenshot` per frame | 4 min |
| **C5 Lit skin hue** | Mirror face page | A 12-frame burst of the reference V; then, with only the complexion replacer disabled in the test profile (the maintainer restarts), the same burst; then tones pale (`01_ca_pale`) and senna (`03_ca_senna`) on skin type 1 | `cc.page {page: "skin"}`, `capture.burst {frames: 12, interval_ms: 150}`; `cc.apply` skin tone by value, `capture.burst` each | 3 min + a restart |
| **C6 Arm cyberware** | A save where V has Gorilla Arms installed (a ripperdoc can install them; the bridge can't equip cyberware yet), then Mantis Blades | Photo mode, a neutral standing pose, both forearms and hands in frame, photo-mode light 1 on at its default; then the mirror at the ripperdoc, arms page | `photo.open`, `photo.pose.set` (idle stand), `photo.frame`, `capture.screenshot`; `player.appearance` (the holster state's options, if listed) | 3 min + the ripperdoc |

**What each answers.**

| Check | Frames | Answers |
|---|---|---|
| Teeth breath | C1 | Do the lips part at the breaths in game (hypothesis 2 of §1), and if so, do both rows show or only darkness; the teeth-to-lower-lip luminance ratio for step A's floor and for step B |
| Teeth colour | C2 | The default's colour, the metal finishes' highlight, gums and tongue inside a 15 mm parting (head CC test ask 15) |
| Hair light | C3 | Hypothesis 2 of §2: the ladder matches the preview's with RT off, or keeps its steepness |
| Scatter scale | C4 | `SCATTER_SCREEN_SCALE`; separable or stochastic blur (High against Low) |
| Skin hue | C5 | Lead 2 of §4 (the replacer on and off), then lead 1 or 3 by where the hue moves; `TintColor` strength (head CC test ask 8) |
| Arm cyberware | C6 | Which meshes show for each state (body open question 4); whether the glass and decal chunks read as §5 expects |

## Provenance

- Studio code at `2d6752b`: `src/character-detail-plan.ts` (`BODY_GROUPS`, `planBody`'s de-duplication key, face-detail planning), `src/render-templates.ts`, `src/mouth-occlusion.ts` (`MOUTH_OCCLUSION`), `src/platform/scene/contact-shadow.ts`, `src/saved-v.ts` (`CLOTHING_AREAS`), `src/save-loadout.ts`, `src/clothing-resolver.ts` (`ARMS_STATE`), `src/metal-base-material.ts`, `src/brow-material.ts`, `src/platform/scene/face-driver.ts` and `head-rig.ts` (the masculine gates), `src/engines/facial-rig/solver.ts` (`FacialCompat`).
- Measurements: [experiment 034](../../experiments/034-render-coverage-refresh/README.md) (the breaths under both setups and the solver's alternatives; the coverage walk over the host's cached catalogues).
- The holster-state table: the reference save's resolved character in the ignored resolver cache (`reports/reference-save.json`, 25 September), read only.
- No new third-party source informed this page; the sources it builds on are credited where the linked pages use them.

## Related pages

[Render coverage audit](render-coverage.md) · [Head CC rendering](../../knowledge/head-cc-rendering.md) · [Body rendering](../../knowledge/body-rendering.md) · [Hair shading](../../knowledge/hair-shading.md) · [Creator lighting](../../knowledge/creator-lighting.md) · [Skin shader reference](../materials/shader-skin.md) · [Metal and glass reference](../materials/shader-metal-glass.md) · [Masculine V plan](male-v-plan.md) · [Preview fidelity backlog](../backlog/preview-fidelity.md) · [Game parity measurement](../authoring/game-parity-measurement.md)
