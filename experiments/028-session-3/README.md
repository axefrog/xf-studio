# Session 3: alpha.2 export confirmation, calibration frames, then features

**Status:** run on 28 September 2026 (partly; results in [§5](#5-results-28-september-2026)). Prepared 27 September 2026. This is the next in-game session with the maintainer. It replaces the earlier [session 3 card](../022-session-3/README.md): that card's Glitter board needs a restage and a relaunch, so it moves to the next session, and its blink and creator checks are folded in below. Every other open in-game ask is ranked in the [next-sessions plan](../../research/runtime/next-sessions-plan.md). This session takes the highest-value rows from that plan that fit one launch.

**Who does what.** The maintainer (**M**) runs MO2 and the game, loads the save, answers the judgement questions and does anything in the inventory or the CET overlay. The coordinator (**C**) drives everything else through the [runtime bridge](../../projects/xf-runtime-bridge/README.md): MCP tools, or the session runner (`bun tools/session.ts` in `projects/xf-runtime-bridge`). Agents never launch the game or MO2.

## 1. Goal and scope

**Goal:** confirm the XF Eye Artistry export so `v0.1.0-alpha.2` can ship, then take the rendering-calibration frames the preview is waiting on, then feature probes if there is time.

**Budget:** about 80 minutes of the maintainer's time for the core (parts 0–D and the wrap-up), about 90 minutes with the stretch part E. The bridge does nearly all of the work. The maintainer's own steps are the setup, five judgement answers, equipping two helmets, one CET preset switch, 50 seconds of hovering creator rows, and loading the safety save at the end.

### Ranked asks

Ranked by what each result unblocks. The run order in §3 groups these by screen to save travel and reloads, so it differs from the rank. Ranks 1–8 still run first.

| Rank | Ask | Unblocks | Step | Min |
|---:|---|---|---|---:|
| 0 | Bridge 0.3.0 preflight (build, settings record, photo mode by key, framing, cursor, creator from gameplay) | Every automated step below | A1–A6 | 6 |
| 1 | **Gloss A–D** under a light sweep | The Matte, Satin, Glossy and Metallic defaults for alpha.2 | B1 | 14 |
| 2 | **Shimmer · strong**: do points flash? | Keep Shimmer experimental, or bake the tilt floor | B2 | 3 |
| 3 | **Metal ramp · lifted**: angular highlights and the seam at metalness 0.1 | The Metallic finish and the SSS-switch reading | B3 | 3 |
| 4 | **Depth C** at extreme close-up; **Depth D in motion** | Closes the plate-lift ask; confirms 0.4 mm while blinking and turning | B4 | 5 |
| 5 | **Lines · new against old**: sharpness | Whether the 4× texture density shows a gain (its placement already passed) | B5 | 4 |
| 6 | **Headgear over XF makeup** (`hide_Head`) | Whether the export's component prefix needs a rename before alpha.2 | B7 | 4 |
| 7 | **Closed lids and eyelid contact** on four eye shapes with the 0.4 mm plate | The eyelid-contact gates of experiments 006/012 (resume or close the clearance work); blink seat per eye shape | C1 | 5 |
| 8 | **Silver-piercing highlight**, piercing metals, heart eye | Key-light colour against skin albedo (gates the creator-lighting refit); the colour-mask question | D1 | 3 |
| 9 | **Tint encoding** (skin tone strength) | How every `Color` parameter is decoded (materials open question 11) | C2 | 3 |
| 10 | **Iris gradient coordinate** and Rebecca's sclera | Raw or decoded gamma-flagged masks, the skin tint mask included | D3 | 3 |
| 11 | **Multilayer eye designs**: arasaka (19) and target (36) | The reciprocal microblend-contrast fix (PREV-127) on designs not yet seen in game | D2 | 2 |
| 12 | **Calibration frames**: hair ladder, lashes, creator light frames | The hair bake chain and the preset's exposure; brow, lash and hair colour parity | D5 | 8 |
| 13 | **Creator at noon and midnight** | Whether world ambient reaches the creator box | D6 | 2 |
| 14 | **Creator feet** on the first and second skin tone | Resolver rule R7 (part-scoped overrides); flat feet under the creator clip | C3 | 2 |
| 15 | **Eyes-section brow showcase** (facial animation ask 5) | Confirms or rejects the Studio's reading of the creator's brow motion | D4 | 3 |
| 16 | *Stretch:* expression probes R1 and R2 | The expression editor's export target and face-index route | E1–E2 | 10 |
| 17 | *Stretch:* pose list and placement (G1, G7) | Pose library counts and the offset axes | E3–E4 | 4 |

### Next time (does not fit, or is not ready)

| Ask | Why not now | Source |
|---|---|---|
| **Glitter board** (Glitter in game) | Replaces this session's XF Eye Artistry build, so it needs a restage and a relaunch. It also reads better after the Gloss verdict. **Opens the next session.** | [Experiment 021](../021-glitter-board/README.md#test-card), [Glitter in game §6](../../knowledge/glitter-in-game.md#6-what-the-next-sessions-should-show) |
| An alpha.2-built export in game | Not needed to publish alpha.2 (see §4). The next session opens with one alongside the Glitter board | §4 below |
| XF Piercings Probe, checks 1–12 | A full 30-minute sitting of its own. The probe is already enabled and adds two harmless rows | [Experiment 024](../024-ccxl-piercings/README.md#test-card-the-12-checks), plan N4 |
| Bridge batch 4 checks D2, D3, D5–D7; live posing L1–L6 | Research, not blocking. L needs the separate *XF Live Pose (test)* package staged, and the maintainer's OK for the carrier write | [Test card](../../research/runtime/runtime-bridge-test-card.md#batch-4-checks-refusals-the-panel-and-live-posing-l0) |
| Hair physics P4 (H1–H6) | Needs 60 fps video and gameplay movement. Calibration is fidelity work, after the export | [Hair physics](../../knowledge/hair-physics.md#in-game-test-asks), [plan §8](../../research/animation/hair-physics-plan.md#8-in-game-checks) |
| Pose checks G2–G6 (G4 outfit filter) | G4 needs a coat, G5 needs V undressed. G1 and G7 are stretch items here | [Pose library §10](../../research/animation/pose-library-design.md#10-in-game-checks-for-the-prepared-session) |
| Photo-mode snapshot session and the look-at setting | S0–S1 are not built. A reduced "what the vanilla slot loses" check using `photo_state` dumps could run earlier if wanted | [Snapshot design §7](../../research/runtime/photo-snapshots-design.md#7-first-game-session-test-plan), [photo mode open questions 8–9](../../knowledge/photo-mode.md#open-questions) |
| Lighting mirror session | L1 and L2 are not built | [Lighting mirror §6](../../research/runtime/lighting-mirror-design.md#6-the-first-game-session-test-plan) |
| Lip-sync visibility | Check 1 needs a trip to the Wellsprings ripperdoc's dialogue. Checks 2–6 need the phase 2 test package | [Lip-sync design §5](../../research/animation/lipsync-design.md#5-in-game-checks-one-prepared-session) |
| The rest of plan N5–N10 (parity E0–E7, iris axis, decal order, strength anchors, RT off, rows and links, teeth, body, vanilla finishes, relaunch, inventory) | Lower value per minute, or they need their own setup | [Next-sessions plan](../../research/runtime/next-sessions-plan.md) |
| Legacy makeup rows, masculine V, new-game rows | Blocked (the legacy build is disabled; no masculine build; a new-game start) | [Plan, blocked](../../research/runtime/next-sessions-plan.md#blocked-or-not-ready) |
| Session 3 Part D (CET console) | Superseded by the bridge's R1 and R2. Kept only as a fallback | [Experiment 022](../022-session-3/README.md#part-d-expression-console-checks-optional) |

## 2. Setup

### Candidate and profile

MO2 profile **`XF Studio diagnostic 2026-09-25`**, on game 2.31 (3.0.80.51928). Only our own entries change. The maintainer's everyday profile, frameworks and mod order are not touched.

| Entry | Build | Check | State on 27 September |
|---|---|---|---|
| **XF Eye Artistry** | The session 2 diagnostic build: Off plus 12 presets ([experiment 020](../020-session-2/README.md#build-record-25-september-2026)). XF row indices: Off 0, Depth A–D 1–4, Gloss A–D 5–8, Shimmer 9, Metal 10, Lines · new 11, Lines · old 12 | `xfs_c0200a5e52e554c029d0b0000000000d0.archive` SHA-256 begins `d2dda83f2336f76b`; `.archive.xl` begins `f261ddc2af33e8f8` | Staged and enabled. Hashes re-checked. **Keep it**: its Gloss A is the reference the verdicts need |
| **XF Runtime Bridge** | **0.3.0 `-writes`** (`xf-runtime-bridge-0.3.0-writes.zip`, batch 4, commit `f194020394e9`, which is on `main`) | Zip SHA-256 `56f1aff69c165120d57843d3eda72e64e3cf2380477b898fed5e6ca297436519`; DLL `de489a4c…1789`; manifest `"version": "0.3.0"`, `"variant": "writes"`, `allow_creator_leave` and `allow_live_pose` true ([build record](../../research/runtime/runtime-bridge-test-card.md#build-record-batch-4-branch-build-not-staged)) | The profile still holds **0.2.0** (`509f599`). **Restage required**, and MO2 must be closed first (below) |
| XF Piercings Probe | Experiment 024's run `20260926T132240` | `.archive` `a52853e2…6ff7`, `.archive.xl` `2bf9a071…43ae` | Enabled. Hashes re-checked. Leave it: it only adds two rows after Piercings |
| XF Eye Artistry CCXL - Dev (legacy) | — | — | Stays **disabled** (it would add a second selector) |
| XF Live Pose (test) | — | — | Not staged this session |

The profile already has the mods these steps rely on enabled: Character Customization Anywhere, the Character Rendering Editor, the KS UV framework, Realistic Complexion III, Alliekat's Natural Hair Tones, the Photomode Facial Expression Mega Pack, Photo Mode Ex and Winterkissed.

### Before the session (C, offline; nothing launches)

1. **MO2 closed.** Ask the maintainer to close MO2 and the game. MO2 rewrites profile and mod state while it runs.
2. **Restage the bridge.**
   - Check the zip's SHA-256 and its `red4ext/plugins/XFRuntimeBridge/manifest.json`, as in the table above.
   - Back up the current `PATH_TO_MO2/mods/XF Runtime Bridge/` folder to `local/mo2-backups/<date>-bridge-0.3.0/`.
   - Replace the folder's `bin/`, `r6/` and `red4ext/` with the zip's contents, and keep MO2's `meta.ini`. The entry's row in `modlist.txt` stays as it is, so nothing else moves.
   - Empty `%LOCALAPPDATA%\XFStudio\runtime-bridge\` (no `session.json`, no `KILL`).
3. **Verify the other entries:** re-hash XF Eye Artistry and XF Piercings Probe as in the table, and confirm the legacy build is still disabled.
4. **Framework check.** Run the read-only `projects/xf-studio/authoring/tools/framework-check.ts` against the profile, and look up the latest stable releases on GitHub the same day. These were installed and current on 26 September, and match what 0.3.0 was built for: RED4ext 1.30.0, redscript 0.5.31, Cyber Engine Tweaks 1.37.1, TweakXL 1.11.4, Codeware 1.20.5 and ArchiveXL 1.27.3. If one has released since, tell the maintainer which one, which version and where to get it. Never update it ourselves.
5. **Tooling.** In `projects/xf-runtime-bridge`, run `bun install`, check the MCP server is registered and lists the `xf-runtime-bridge` tools, then run `bun tools/session.ts tools/sessions/session-2.json --dry-run`.
6. **Baseline capture:** `python tools/capture_session.py --label s3-pre --profile "XF Studio diagnostic 2026-09-25"`.

### Tell the maintainer (one message, before the session)

- Close MO2 so the bridge can be restaged. Say when it's closed; you'll hear when it's done.
- Put these in V's inventory beforehand: **a full helmet or mask that hides the head** (one with `hide_Head`) and **a vanilla helmet**.
- Start MO2 on **XF Studio diagnostic 2026-09-25** and launch the game in **borderless windowed** mode. Keep the game window in front during the session.
- Load the **reference character's latest save** (the same V as sessions 1 and 2), stand V in **the apartment's living room**, facing the room with a few metres clear in front of her. Not the bathroom: the camera ended up in the wall there. No combat, not in a vehicle.
- When asked, make a **new manual safety save**. This profile shares your save folder, and after the first change the bridge blocks saving until a save is loaded.
- Check the kill hotkey is still bound in CET's Bindings. The CET overlay now has an **XF Runtime Bridge** window with Reconnect and Pause buttons.
- Leave the upscaler, ray tracing and SSS settings as they are. The bridge records them.

### Evidence layout (private, ignored, versioned)

```text
local/sessions/<YYYY-MM-DD>-session-3/
  a-preflight/        MCP answers (JSON) and captures for A1–A6
  b-alpha2/           session runner --out folder for session-2.json p0–p2 (manifest.json, xfb/session-report-2) + B7 captures
  c-ripperdoc/        C1–C3 bursts, captures and answers
  d-mirror/           session runner --out for p3, then D2–D6 captures and answers
  e-photo/            stretch: R1/R2 JSON and captures, G1/G7 dumps
  logs/               after quitting: red4ext/logs (plugin log), r6/logs/redscript_rCURRENT.log,
                      the CET mod log and scripting.log, the ArchiveXL log (MO2 overwrite/ or the game folder)
  commands-*.jsonl    the command API's audit log for the day
  notes.md            M's verdicts, word for word, with step numbers
captures/<ts>-s3-pre, captures/<ts>-s3-post   (capture_session.py, also ignored)
```

Every runner manifest records the bridge's build commit, and `game_options_read` records the graphics settings. Keep the `.full.png` of every capture. Nothing from these folders is committed. Only the numbers and verdicts go into the docs listed in §4.

## 3. The checklist

**Drive:** **Auto** means the bridge or the session runner does it and M only watches; **M** means the maintainer does it; **Ask** means the maintainer gives a verdict in chat. A capture is `capture_screenshot {region, name}` after a 1.5 s wait, unless stated otherwise. Before `cc_apply` on a vanilla row, C reads it with `player_appearance {option: …}` and maps the label to its index ([index convention](../../research/runtime/next-sessions-plan.md#before-every-sitting-c-offline)). If a bridge step fails, the fallback noted in the step applies; otherwise record the answer and carry on.

### Part 0: arrive (M, 5 min)

| # | Drive | Do | Record |
|---|---|---|---|
| 0.1 | M | Start MO2 on the test profile, launch, load the save, stand V in the living room | — |
| 0.2 | M | Make the manual safety save. Say "ready" | The save's name, in `notes.md` |

### Part A: bridge 0.3.0 preflight (gameplay, then photo mode; Auto, 6 min)

| # | Drive | Do | Capture | Pass / fail |
|---|---|---|---|---|
| A1 | Auto | `bridge_info`, `game_status`, `game_options_read` | JSON | `plugin_version` 0.3.0, commit `f194020…`, `allow_writes` and `allow_live_pose` true, phase `gameplay`. The plugin log shows `script_calls=on` and `live_pose=on`. The options summary gives upscaler and mode, RT/PT, SSS quality, HDR and camera effects. **Fail on the wrong build or `script_calls=off`: stop and send the log** |
| A2 | Auto | `photo_open`, wait 2 s, `photo_subject {}` | JSON | Photo mode opens by itself (`route: "sendinput"`), `approximate: false`. If it times out, M presses the photo-mode key; record that |
| A3 | Auto | `photo_light_set {light: 1, on: true, type: "spot", brightness: 60, hue: 35, saturation: 15}` | `a3-light` (face) | Light 1 on and warm. Record where it appears relative to V and the camera (photo-mode open question 5) |
| A4 | Auto | `photo_frame {target: "face", look_at: "off", xf_preset: true}`, `photo_hud_hide {}`, capture. Repeat for `eyes` | `a4-face`, `a4-eyes` | `converged: true`. The face fills its crop, both eyes and brows sit in theirs, and there is **no cursor or menu** |
| A5 | Auto | `capture_burst {region: "eyes", frames: 10, interval_ms: 100}`, then `photo_hud_hide {hidden: false}`, `photo_exit` | contact sheet | Frame difference near 0. Photo mode closes |
| A6 | Auto | `cc_open`, `player_appearance {option: "XF"}`, `cc_back` | JSON | Opens within about 2 s (`opened: true`, `edit_mode: "HairDresser"`). The XF row lists Off + 12. Back closes it. If it times out, M opens the creator with F12 whenever a later step's note asks |

### Part B: session 2 close-out, the alpha.2 export confirmation (creator ⇄ photo mode; Auto with three Asks, about 35 min)

Run `bun tools/session.ts tools/sessions/session-2.json --out local/sessions/<date>-session-3/b-alpha2 --until p2-verdicts`. The script opens the creator, sets the XF row, photographs the `cc-eyes` zoom and confirms. It then opens photo mode, turns off grain and aberration, switches light 1 on, frames the face, and sweeps the light by turning V (0°, ±15°, ±30°, look-at off), before moving to the next preset. Criteria come from [experiment 020's test card](../020-session-2/README.md#test-card) and the [decal reference §13](../../research/materials/shader-decal.md#13-in-game-test-asks-batch-into-the-prepared-session).

| # | Drive | Presets (XF index) | Capture | Pass / what it means |
|---|---|---|---|---|
| B1 | Auto; C checks at `p1-check` | Gloss A–D (5–8) | `cc-eyes` creator crop; face captures at 0°, ±15°, ±30° per preset | **One of A–D reads as four distinct finishes (D expected: Matte 1.00, Satin 0.50, Glossy 0.24, Metallic 0.39).** If A and B look alike, the written roughness isn't what shows. If C is still glossy, the shine comes from lights or reflections. If A's Matte is no glossier than C's, the session 1 "glossy Matte" report was the breakup. If D separates the finishes but all still look coated, the next lever is surface weight or grain (§10 rank 6), not roughness |
| B2 | Auto | Shimmer · strong (9) | sweep captures and a 10-frame eyes burst | Points flash as V turns, and it still differs from Satin at face distance. The strong stripes flash but the fine one doesn't: the gate reading holds, so bake the tilt floor. Nothing flashes at close framing: suspect DLSS or temporal filtering first |
| B3 | Auto | Metal ramp · lifted (10) | sweep captures | No angular highlight shapes. **Record where a seam appears**: expected between the 0.098 and 0.149 steps (the SSS switch at metalness 0.1) |
| B4 | Auto, then **Ask** at `p2-depth-d-motion-check` | Depth C (3) at the extreme close-up; Depth D (4) in motion | 5-frame burst (C); 20-frame burst (D) | C holds at the distance where A broke up on 26 September. **M:** in the creator, zoom out, watch a few blinks and rotate V slowly. Any visible edge, lifted look, or skin through at the inner corners by the lash line? |
| B5 | Auto | Lines · new (11), Lines · old (12) | eyes framing and extreme close-up, both | Same place (already passed), and new is visibly sharper at extreme close-up. No visible difference means the density gain is *not established*; placement still stands |
| B6 | **Ask** at `p2-verdicts` | — | `notes.md` | M's one-line verdicts: which Gloss; Shimmer flash yes/no; Metal highlights and seam; Lines sharper yes/no |
| B7 | M, then Auto | Any XF look still on from the script (for example Lines · old) | `b7-hide-head`, `b7-helmet` (face) | **M** equips the `hide_Head` item. **C:** `photo_open`, `photo_frame {target: "face", xf_preset: true}`, `photo_hud_hide {}`, capture, `photo_exit`. **M** swaps to the vanilla helmet; C captures again. **M** removes both. Pass: the makeup hides with the head. If it floats, the `xfs_c<key>_makeup` prefix isn't covered by ArchiveXL's `hide_Head`: record it for the rename decision ([clothing](../../knowledge/clothing.md#41-where-visual-tags-come-from-source-wiki)) |

### Part C: creator, ripperdoc mode (Auto; about 10 min)

The ripperdoc mode offers the eye-shape, skin and body rows that the mirror mode hides. Open it once: `cc_open {mode: "ripperdoc"}`. The visit is never confirmed and ends with `cc_back`.

| # | Drive | Do | Capture | Pass / record |
|---|---|---|---|---|
| C1 | Auto | **Closed lids and eyelid contact.** `cc_apply {option: "XF", index: 4}` (Depth D, the shipping 0.4 mm lift over the upper lid). For eye shapes `01`, `02` (`h011`), `10` (`h091`) and `12` (`h111`), which are indices 0, 1, 9 and 11: `cc_apply {option: "eyes", index: n}`, `cc_page {page: "eyes"}`, then `capture_burst {region: "cc-eyes", frames: 40, interval_ms: 100}` to catch a blink | four contact sheets (`c1-eyes-<label>`) | On the fully closed frame: **no eye visible between the lids**; upper lashes on the closed lid line; **no bare skin between the crease and the lashes**; **the plate doesn't poke through or fold at the lid margin**. Record any shape that fails, and on which frame. `h011` decides between the per-shape seat and the base centre ([facial animation asks 1–3](../../knowledge/facial-animation.md#in-game-test-asks)). The 006/012 contact gates turn on the last criterion |
| C2 | Auto | **Tint encoding.** `cc_apply {option: "XF", index: 0}`, `cc_page {page: "skin"}`. Then `skin_type` 1 with `skin_color` tones 1 (pale), 5 (senna) and 2 (warm ivory); `skin_type` 3 with tone 5; `skin_type` 5 with tone 2 (the relaunch sitting's complexion baseline). Capture each | `c2-t<type>-c<tone>` (full window) | Senna darkens a mid skin by about a fifth: byte/255, and the preview is right. About two fifths: sRGB, so change the preview. Warm ivory should look warmer and a little brighter than pale ([head CC asks 1 and 8](../../knowledge/head-cc-rendering.md#in-game-test-asks)) |
| C3 | Auto | **Creator feet.** `cc_page {page: "body"}` (full body, barefoot). `skin_color` tone 1, capture; tone 2, capture | `c3-feet-tone1`, `c3-feet-tone2` | **Record whether the lower shins and feet show on tone 1.** Expected from the files: missing on the first tone, present on the second. If they show on the first, the engine keeps a cooked component's own chunk mask, so the resolver's rule R7 must apply part-scoped overrides only to that part's own components. Also check that the feet stand flat ([body animation asks 3 and 5](../../knowledge/body-animation.md#in-game-test-asks)) |
| C4 | Auto | `cc_back` | — | Nothing kept |

### Part D: creator, mirror mode (Auto with two M steps; about 21 min)

Run `bun tools/session.ts tools/sessions/session-2.json --out local/sessions/<date>-session-3/d-mirror --from p3-open-creator --until p3-check`. It opens the creator (`cc.open`, mirror mode), sets XF Off, and photographs piercing style 9 in black, style 1 in silver and in gold, and eye colour 24. **Keep the creator open** afterwards for D2–D6, then run `cc_back`.

| # | Drive | Do | Capture | Pass / record |
|---|---|---|---|---|
| D1 | Auto (script p3) + one extra frame | After p3: `cc_apply {option: "piercings", value: "01"}`, `cc_apply {option: "piercings_color", value: "silver"}`, `cc_page {page: "head"}`, then a full-window capture at the creator's **face** framing | p3 shots; `d1-silver-face` | Gold shows gold, not grey. Black plastic keeps its colour and a narrow highlight. The heart sits upright. **The silver highlight's colour at face framing:** neutral means the key lights are white and the skin's warmth is in its albedo; cool means the unset light colour isn't white. Metal body between highlights under 10/255 keeps the ambient at 0 ([creator lighting §12.5](../../knowledge/creator-lighting.md#125-refitting-from-new-matched-captures), [skin §11.8](../../research/materials/shader-skin.md#118-checks-and-measurements)) |
| D2 | Auto | `cc_apply {option: "eyes_color", value: "19"}` (arasaka), `cc_page {page: "eyes"}`, capture; then `36` (target) | `d2-eye-19`, `d2-eye-36` (`cc-eyes`) | Crisp design edges, no translucent smear over the whole eye. Compare with the preview's frames after the PREV-127 fix ([head CC ask 14](../../knowledge/head-cc-rendering.md#in-game-test-asks), [eye rendering §6.6](../../knowledge/eye-rendering.md#66-implementation-status)) |
| D3 | Auto | **Iris gradient coordinate.** `eyes_color`: gradient red, gradient light blue, gradient brown, blood gradient red, then 54 (Rebecca). Capture each | `d3-<name>` (`cc-eyes`) | Raw reading (the preview's default holds): bright red-orange and mid sky-blue irises, and an even Rebecca sclera. Decoded: near-black and slate irises, and a lopsided sclera or a missing catch light ([eye rendering §2.3](../../knowledge/eye-rendering.md#23-the-gradient-coordinate-raw-or-decoded)) |
| D4 | **M** hovers; Auto captures | **Brow showcase.** `cc_page {page: "head"}`. **M:** 25 s hovering only the skin row, while C runs `capture_burst {region: "full", frames: 50, interval_ms: 500}`. **M:** then 25 s moving back and forth between the XF row and the eyebrows row, while C runs the same burst | two contact sheets | Do the brows lower and the lids narrow **only in the second**? That confirms the Studio's *Creator close-up, eyes section* reading ([facial animation ask 5](../../knowledge/facial-animation.md#in-game-test-asks), [brow idle gap](../../research/animation/brow-idle-gap.md)) |
| D5 | **M** once, then Auto | **Calibration frames.** **M:** in the CET overlay, set the Character Rendering Editor preset to "Vanilla". **C:** on the hair page, take one frame on arrival. Then one frame each on the brows, lashes and skin pages. Then the hair ladder on the `lm097_hair` style: `38_ash_brown`, `39_ash_grey`, `74_steel_smoke`, `66_platinum_blonde`. Then lashes `05_brown_liquorice`; hairstyle 1 in brown liquorice and hairstyle 5 in blonde platinum. Take an 8-frame hair-page burst twice (fixed exposure). **M:** switch back to the usual preset; **C:** one repeat frame | `d5-*` PNGs and bursts | Ladder ratios against the [bake table](../../research/eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request): about 3.1 / 4.2 / 6.6 means the decoded bake holds. Lashes near (59, 28, 0) means Alliekat wins; (172, 130, 15) means the base game wins. Two identical bursts confirm the exposure is fixed ([creator lighting §8](../../knowledge/creator-lighting.md#8-capture-protocol)). Record the preset used for each frame |
| D6 | Auto | **Noon and midnight.** Face page. `world_time_set {hours: 12}`, wait 2 s, capture; `world_time_set {hours: 0}`, capture; run the undo | `d6-noon`, `d6-midnight` | Patches within 1/255 mean no world ambient reaches V in the creator. Brighter at noon means the sky's ambient reaches the box |
| D7 | Auto | `cc_back` (the script's `p4-back`). Restore nothing else: the safety save restores the look | — | The creator closes |

### Part E (stretch, only if the core ran on time): photo mode (Auto; about 14 min)

`photo_open`, `photo_frame {target: "face", look_at: "off", xf_preset: true}`, `photo_hud_hide {}`.

| # | Drive | Do | Pass / record |
|---|---|---|---|
| E1 | Auto | **R1:** `face_rig_read {}` then `face_rig_read {target: "puppet"}` | `face_rig` found on the head item with its facial-setup, graph and rig hashes and its sets. Keep the full JSON; question D1 asks which facial setup it is ([R1 and R2](../../research/runtime/runtime-bridge-test-card.md#expression-checks-r1-and-r2)) |
| E2 | Auto | **R2:** R2a–R2g as on the test card (`photo_state`, `photo_expression_set` 60 and 0, `photo_expression_index` 60 on the stand-in then the head, 56 on whichever worked, a 5 s hold, the undo); face captures `r2-*` | Sleeping at index 60, Skeptical at 56, holding for 5 s. Record which target took it |
| E3 | Auto | **G1:** `photo_state {options: true}` with each pose category selected (attributes 5 and 6) | Counts, order and labels per category, for the pose library's catalogue comparison |
| E4 | Auto | **G7:** `photo_pose_set` a swim pose (`positionOffset` z 0.35 / 0.85), then a standing pose; `photo_frame {target: "full-body", yaw_offset: 90}` and capture each; then run the undo | Record the direction and size of the offset seen from the side ([pose library §10](../../research/animation/pose-library-design.md#10-in-game-checks-for-the-prepared-session)) |

### Wrap-up (M and Auto, 4 min)

| # | Drive | Do | Pass / record |
|---|---|---|---|
| W1 | Auto | In photo mode (`photo_open` if it's closed): `photo_hud_hide {}`, then `bridge_kill` | The label turns red. The menu **and the cursor** come back (`RestoreAfterKill … "cursor_shown":true`). The save lock is kept |
| W2 | M, then Auto | **M:** in the CET overlay's XF Runtime Bridge window, press **Reconnect**. **C:** `bridge_ping`, `bridge_info` | "Reconnected" within a second or two. A new `sid`, `bridge.rearms: 1`, and no `KILL` file. This is the panel's check D4 |
| W3 | M | Leave photo mode, **load the safety save**, quit to desktop | A clean exit. `session.json` is gone from the runtime folder |
| W4 | C | `python tools/capture_session.py --label s3-post --profile "XF Studio diagnostic 2026-09-25"`. Copy the logs, the `commands-*.jsonl` and the runner folders into the evidence folder | — |

## 4. After the session

### What gets decided

- **alpha.2 ships** (`v0.1.0-alpha.2` from `main`, published without asking per the release decisions) when:
  - B1 names a winner, and its roughness values become the finish defaults. Matte is already 1.0; with D they are Satin 0.50, Glossy 0.24, Metallic 0.39. Update the ordinary-package golden and the changelog in the same change.
  - B7 shows no floating makeup, or the rename fix has landed first. It is small, and floating makeup under a helmet is a visible bug.
  - The alpha.2 export differs from the staged build only in values pinned by that golden, so it doesn't need its own in-game run before publishing. The next session opens with one.
- **These don't block alpha.2; they set the finish menu:**
  - *Shimmer fails* (B2): Shimmer stays experimental, and the tilt-floor bake becomes the next faceted candidate.
  - *Metal seam* (B3): Metallic keeps the SSS switch and says so in its help text.
  - *Lines not sharper* (B5): keep the UV window. Its placement is proven and it costs nothing.
  - *Gloss inconclusive* (A ≈ B, or everything coated): alpha.2 ships with the current defaults, the Satin and Matte limitation is written into the changelog's known limitations, and a surface-weight board is built for the next session.
- **Plate clearance** (C1): if no contact or bare skin shows on any of the four shapes, close the 006/012 eyelid-contact gates as "not visible in game" and keep the clearance work paused. If one shows, resume it for that shape, morph-aware and finite-contact-aware, keeping the skin-byte rule.
- **Preview changes** by result: C2 (tint decode), D3 (mask decode), D1 (the key-light colour, then the fill-strength refit), C3 (resolver rule R7), D5 (the hair bake chain and exposure).

### Which docs each result updates

| Result | Update |
|---|---|
| B1–B6 | [Experiment 020](../020-session-2/README.md) results table (steps 2–8); [decal reference §10 and §13](../../research/materials/shader-decal.md#10-recommended-changes-ranked); [materials and shaders](../../knowledge/materials-and-shaders.md#in-game-test-asks) ask 4; [Glitter in game §6](../../knowledge/glitter-in-game.md#6-what-the-next-sessions-should-show) (Shimmer) |
| B7 | [Clothing](../../knowledge/clothing.md) (visual tags); the [pipeline guide](../../research/authoring/studio-to-mod-pipeline.md) if the component prefix changes, with its diagrams re-inspected |
| C1 | [Facial animation](../../knowledge/facial-animation.md#in-game-test-asks) asks 1–3; experiments [006](../006-plate-clearance/README.md) and [012](../012-native-plate-bootstrap/README.md); the backlog's plate-clearance line; [status](../../docs/status.md) "Close-up rendering" |
| C2, D1–D3 | [Head CC rendering](../../knowledge/head-cc-rendering.md#in-game-test-asks) asks 1, 8, 9 and 14; [eye rendering](../../knowledge/eye-rendering.md); [materials](../../knowledge/materials-and-shaders.md) open questions 10 and 11; [creator lighting §12](../../knowledge/creator-lighting.md#12-calibration-against-a-matched-pair); [skin §11.8](../../research/materials/shader-skin.md#118-checks-and-measurements) |
| C3 | [Body animation](../../knowledge/body-animation.md#in-game-test-asks) asks 3 and 5; the resolver's R7 note in [body rendering](../../knowledge/body-rendering.md) |
| D4 | [Facial animation §6](../../knowledge/facial-animation.md#6-the-idles-upper-face) (its reading loses the hypothesis grade or is revised); [brow idle gap](../../research/animation/brow-idle-gap.md) |
| D5, D6 | [Hair calibration](../../research/eye-artistry/hair-calibration-2026-09-25.md); [hair shading](../../knowledge/hair-shading.md); [creator lighting](../../knowledge/creator-lighting.md) (§8 frames, day and night) |
| A1–A6, W1–W2 | The [bridge test card](../../research/runtime/runtime-bridge-test-card.md) (batch 3 and 4 results; the staged build record becomes 0.3.0); [runtime access](../../knowledge/runtime-access.md); [photo mode](../../knowledge/photo-mode.md) open questions 5 and 6 |
| E1–E4 | The [expression editor design](../../research/animation/expression-editor-design.md) and [facial expressions](../../knowledge/facial-expressions.md); the [pose library design](../../research/animation/pose-library-design.md) and [poses](../../knowledge/poses.md) |
| Every row | Tick or delete its row in the [next-sessions plan](../../research/runtime/next-sessions-plan.md); add a results section here; refresh [status](../../docs/status.md) and backlog row 1; stage the Glitter board for the next session |

## 5. Results (28 September 2026)

Run on the test profile with bridge 0.3.0 `-writes` (`f194020`), game 2.31, DLSS Performance, ray-traced lighting Ultra, path tracing off, SSS High. The session ran through a fallback runner because of the bridge problems below; the private evidence (captures, runner logs, the command audit, the plugin log and notes with verdicts word for word) is kept locally with the session.

| Step | Result |
|---|---|
| A1–A2 preflight | **Pass**: the right build, script calls and live pose on; photo mode opens by key |
| A3 light | Light 1 switches on, but its type can't be set: setting 45 isn't in 2.31's menu |
| A4 framing | **Fail**: `photo.frame` stops with `no_response`, and the XF camera presets 6–9 carry a 90° roll. A vertical-only fallback (preset, roll 0, V's height offset and the field of view from `photo.subject`) framed correctly |
| B1 Gloss A–D | The photo-mode light sweep is **void**: light 1 lit V only once, because it's placed where the camera was when it switched on, and the world clock advanced between presets. Judged by eye in the creator's eye framing instead: **no stripes visible on A, B or C; only an ambiguous edge on D**. The finishes barely separate under the creator's soft light; the verdict needs a controlled directional light |
| B2 Shimmer · strong | **Fail**: a static field of dots, no flash or sparkle as V moves. Shimmer stays experimental and its facet route needs rework |
| B3 Metal ramp · lifted | **Pass** for highlights: no angular shapes; the ramp's steps show as three faint stripes, with no single hard seam |
| B4 Depth D in motion | **Pass**: no edge, no lifted look, no skin at the inner corners while blinking and turning. 0.4 mm stays |
| B5 Lines new against old | **Pass**: new is visibly sharper than old at the creator's eye framing. The density gain is established |
| B7 headgear | Not run (no full-head item in the inventory). The source already says the `xfs_c<key>_makeup` prefix isn't covered by `hide_Head` ([clothing](../../knowledge/clothing.md)) |
| C1 closed lids, Depth D | **Pass** on eye shapes 01, 02, 10 and 12: at full closure the lid is covered, no eye shows between the lids, the lashes sit on the lid line, no bare skin shows between crease and lashes, and nothing pokes through. The creator's eye crop can't resolve sub-millimetre contact |
| C2 tint, C3 feet | Not usable: after the first skin-type change the creator stayed busy and refused every later change |
| D2, D3 eye designs and iris gradients | **Pass** (offline comparison, 28 September): the iris mask is read raw, and arasaka and target draw crisp and in place, consistent with PREV-127. The preview's layered eyes read about half as bright as the game's relative to the skin ([eye rendering §2.3, §6.6](../../knowledge/eye-rendering.md#23-the-gradient-coordinate-raw-or-decoded)) |
| D5 calibration | Captured under the Character Rendering Editor's Vanilla preset (confirmed through the game options): page frames, the four-colour hair ladder on the reference hairstyle, and two 8-frame bursts. The exposure is fixed (±3 % over 18 frames). The ladder reads 4.7, 7.2 and 9.8 against the bake's 3.1, 4.2 and 6.6, and the Studio renders 2.8, 4.0 and 6.6: the bake is reproduced, and the game's steeper, cooler spread is a lighting gap ([hair shading §8](../../knowledge/hair-shading.md#creator-ladder-session-3)). The frame refit the creator calibration with the 27 September pair ([creator lighting §12.6](../../knowledge/creator-lighting.md#126-refit-from-two-captures-28-september)). Lash colour frames not taken |
| D6 noon and midnight | **Pass**: the frames match within the idle's motion, so no world ambient reaches the creator ([creator lighting §10.4](../../knowledge/creator-lighting.md#104-what-reaches-v-by-path)) |
| D1, D4, E, W | Not run |

**Bridge problems for the next build:** `photo.frame`'s left/right probe (a zero Jacobian); the XF camera presets' 90° roll; placing light 1 relative to V rather than the camera; `cc.open` refusing at scene tier 2 in V's apartment (the check should accept it); the creator staying busy after a skin-type change; `cc.confirm` refusing when nothing changed.

**Requested for the next build:** a message line in the in-game bridge label (so the maintainer can read the coordinator without leaving the game), and commands for equipping an item and for saving and loading, so fewer steps need the maintainer.
