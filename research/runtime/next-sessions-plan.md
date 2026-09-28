# Next in-game sessions: ranked plan

**Status (28 September 2026): session 4 ([experiment 029](../../experiments/029-session-4/README.md#3-results)) ran on bridge 0.4.1.**
- **Rows answered and removed** (results on the experiment page and the source pages, summarised under [results so far](#results-so-far)): all of N1 (the autonomy checks through the 0.4.1 preflight; the Gloss verdict), N13 (the cheek check), and from N5, N6 and N7 the rows that ran cleanly.
- **Rows that ran but must repeat** stay below with a note: Ultra+ confounded the skin rows, the tone rows used the wrong tones, and the headgear row was hidden by Thread Locker. Ultra+, Thread Locker and Body Toggles are now disabled in the test profile.
- **Next session** opens with an alpha.2-built export staged for N2's headgear row, then N3 (Glitter) and N4 (piercings).

This plan gathers every open in-game ask into sittings of 20–30 minutes, driven by the coordinator through the [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md). Sittings are ordered by value per minute and grouped by shared setup. When a sitting has run, record its results on the source pages and delete its rows here once their answers are there; rows that must repeat keep a note saying why. The bridge's conventions, failure handling and kill switch are on the [test card](runtime-bridge-test-card.md).

**Who does what.** The maintainer (**M**) starts MO2 and the game, loads the save, makes the safety save, opens the creator when asked (F12 with Character Customization Anywhere; the bridge's `cc.open` misbehaves away from a mirror), and does anything in MO2 or the game's settings. The coordinator (**C**) drives everything else with the bridge: MCP tools, or `bun tools/bridge-client.ts run <command>` (dotted names) in `projects/xf-runtime-bridge`. Scripted runs use `bun tools/session.ts <script> --out <folder> [--from <label>]`; run them in the foreground (a stopped background run kept driving the game in session 4). Agents never launch the game or MO2.

## Order at a glance

| # | Sitting | Min | Top asks | Needs beyond the staged setup |
|---|---|---:|---|---|
| [N2](#n2-finish-close-out-headgear-kill-switch) | Headgear, kill switch | 7 | 2.6 on the `hx_` build | **An alpha.2-built export staged** in place of the session 2 build; a mod item with `hide_Head` in V's inventory |
| [N3](#n3-glitter-board) | Glitter board | 25 | [Experiment 021](../../experiments/021-glitter-board/README.md#test-card) steps 1–9 | **Restage**: the Glitter board beside or in place of the export (after N2), relaunch |
| [N4](#n4-xf-piercings-probe) | XF Piercings Probe | 30 | [Experiment 024](../../experiments/024-ccxl-piercings/README.md#test-card-the-12-checks) checks 1–10, 12 | **Enable `XF Piercings Probe`** (staged, not enabled) |
| [N7](#n7-photo-mode-parity-eye-and-skin-light-the-repeats) | Photo mode: parity, eye and skin light (the repeats) | 20 | SSS quality without Ultra+; the light pair; cornea and iris | M changes SSS quality once |
| [N5](#n5-creator-sweep-a-colour-encoding-and-layered-materials) | Creator sweep A: the remaining colour checks | 20 | Tint encoding on the right tones; ray tracing off; decal order with XF Off | M turns ray tracing off once |
| [N6](#n6-creator-sweep-b-rows-links-hair-calibration-body-blink) | Creator sweep B: what remains | 25 | Hands on the tone link, lip colour carry-over, brows, bald style, lash frame, teeth, blink | M switches the Character Rendering Editor preset once |
| [N11](#n11-xf-expressions-set-in-photo-mode-r4r5) | XF Expressions set in photo mode (R4–R5) | 25 | Listed, plays as the preview, Mega Pack faces still work | **Stage** one expression-set build by hand (M, MO2 closed), relaunch; after the preview's switch to the male facial setup (R1) |
| [N14](#n14-xf-finish-showroom) | XF Finish Showroom: fidelity check, then the lineup | 30 | Does a showroom head show a preset as V does; then Gloss A–D, the Shimmer grain and Glitter side by side under identical light, with turntable sweeps | **Stage** bridge 0.5.0 -writes, XF Finish Showroom (two archives) and an XF Eye Artistry build of session 2's collection from the same commit; Codeware in the profile; relaunch |
| [N8](#n8-photo-mode-vanilla-finishes-under-a-sweep) | Photo mode: vanilla finishes under a sweep | 25 | Lip finishes, metallic blush, brow gloss, hair ambient | The reference save for 8.4 |
| [N9](#n9-relaunch-missing-mods-and-mod-over-base) | Relaunch: missing mods and mod-over-base | 20 + 2 launches | Probe missing-mod check, removed-colour fallback, `.hp` and complexion winners | Throwaway saves from N4 and N6; five mods toggled |
| [N10](#n10-inventory-cyberware-bare-body-clothing) | Inventory: cyberware, bare body, clothing | 30 | Gorilla Arms, holster state, garment hide tags | A save with Gorilla Arms; tagged mod garments |
| [N12](#n12-masculine-v-xf-eye-artistry-for-him) | Masculine V: XF Eye Artistry for him | 30 | Male V plan §6 checks 1–4 and 5–7 | **A masculine save made in a new game** (none exists yet; M makes and keeps it); a both-body build staged in place of the alpha.2 export |

**Why this order.**
- **N2** is the last open check on the alpha.2 export: its headgear row can finally run now that Thread Locker is off.
- **N3** decides the Glitter route, the next finish for XF Eye Artistry.
- **N4** answers the attachment questions for piercings, the next feature.
- **N7, N5 and N6** finish the preview-parity questions session 4 left open, mostly without player steps once the creator or photo mode is open.
- **N14** (after N3, on the same staging relaunch if possible) replaces per-finish creator visits with a lineup under one light; its fidelity check decides whether later finish verdicts can come from the showroom.
- **N11** waits for the preview to solve with the male player setup that R1 found live, so its "plays as the preview" comparison is fair.
- **N9, N10 and N12** cost the most player time, and N12 also needs a new-game masculine save.

**Launches.** One evening can hold N2, N4, N7, N5 and N6 on one launch. Enable the probe beforehand: it only adds two rows. N3 needs a restage and a relaunch. N9 is two launches by design.

## Before every sitting (C, offline)

1. **Bridge:** the profile holds **0.4.1 `-writes`** (`911ad89`; [build record](runtime-bridge-test-card.md#build-record-bridge-041-branch-build-not-staged)). Check that the plugin log shows `script_calls=on`. The inventory write class was approved for session 4 only; ask again.
2. **Profile `XF Studio diagnostic 2026-09-25`:**
   - **XF Eye Artistry** holds the session 2 diagnostic build until an alpha.2-built export replaces it for N2.
   - **XF Piercings Probe:** enabled in the profile, with hashes matching the build record (checked 27 September; [staging](../../experiments/024-ccxl-piercings/README.md#staging)).
   - **XF Expressions:** at most one set enabled. Session 4's "Cheek check" set is done; disable it before N11's set is staged.
   - These are already enabled: PRC's framework plus two item packs, Realistic Complexion III, the KS UV framework, Alliekat's Natural Hair Tones, the Photomode Facial Expression Mega Pack, Character Customization Anywhere, the Character Rendering Editor and Winterkissed.
   - **The confounders stay disabled:**
     - the legacy **XF Eye Artistry CCXL - Dev**;
     - **Ultra+**, which rewrites the SSS quality and the skin tuning per tier and mode and adds CAS sharpening and rim enhancement ([experiment 029 §1](../../experiments/029-session-4/README.md#1-setup));
     - **Thread Locker**, which hides equipped headwear;
     - **Hide Body Parts - Body Toggles**, whose head item doesn't hide the head and only confuses the headgear row.

     Check MO2's list for any other graphics or camera mod enabled since, and record it.
   - Re-run the [framework check](runtime-bridge-test-card.md#before-the-session-coordinator) if a sitting slips a day.
3. **Game settings:** ask M to read the **SSS quality** in the graphics menu at the start. Ultra+ wrote it per quality tier while it was enabled, so the value may not be what was last chosen by hand. Record it with the upscaler, the ray-tracing mode and the Character Rendering Editor preset.
4. **Evidence:**
   - Run `python tools/capture_session.py --label <sitting>-pre` before and `--label <sitting>-post` after, with `--profile "XF Studio diagnostic 2026-09-25"`.
   - Put one runner `--out` folder per sitting under a private, ignored location. Captures are never committed; copy them to `experiments/<id>/generated/captures/` afterwards.
   - Every result keeps its bridge JSON, and the manifest records the build commit.
5. **Scripts:**
   - N2 uses [`session-2.json`](../../projects/xf-runtime-bridge/tools/sessions/session-2.json); N3 uses [`session-3.json`](../../projects/xf-runtime-bridge/tools/sessions/session-3.json) part A.
   - The other sittings run as MCP calls from the tables below, or as scripts generated with `tools/sessions/make-sessions.py`: write those before the sitting.
6. **Tell M:**
   - Use borderless windowed mode, with the game window in front. Don't type into the game while the bridge opens photo mode: it sends the photo-mode key.
   - Stand V in the apartment's living room facing the room. Framing worked there; in the bathroom the camera sat in the wall.
   - Open the creator with F12.
   - Make a new manual safety save before the first change, and load it at the end.

**Index convention.** Creator labels in the source asks (style 5, colour 24, tone 3) are not always `cc_apply` indices, which count from 0. C reads each row with `player_appearance {option: …}` first and maps the label to its index.
- **Piercings:** for vanilla `piercings`, style *N* is index *N*.
- **Eye shape** (`eyes`): label `01` is index 0 (`None`), `02` is `h011`, `10` is `h091` and `12` is `h111`.
- **Skin tone** (`skin_color`): tone label *N* is index *N* − 1 (index 0 pale, 1 warm ivory, 2 limestone, 3 limestone beige, 4 senna, 5 senna amber). Session 4 applied labels as indices and photographed the wrong tones. Name a tone by its value (`03_ca_senna`) in a card.
- **Photo-mode expressions:** the menu selects by its option value, which is a list position, not the faceId (the table index). Read `photo_state {options: true}` key 28 and select by `data`.

A capture is `capture_screenshot {region, name}` after a 1.5 s wait, unless stated otherwise. The `eyes` region currently sits the eyes at its bottom edge, so use `face` or `full` plus a recrop for eyes until the bridge fixes it.

**Photo-mode framing.**
- Reset V's placement (`photo_camera_set`) before each `photo_frame`, so the framer doesn't drift.
- Seed face captures at a portrait lens (FOV 22, close/far −1.2, which converges near 9°) rather than the default, a selfie lens of about 66° at 35 cm.
- Place light 1 about V (`place: {azimuth, elevation, distance}`) at brightness 45 or less at 1 m; 60 overexposes.
- `world_time_set` refuses in photo mode: set the clock before opening it.

## N2. Finish close-out, headgear, kill switch

Opens the next session. Sources: [experiment 020 steps 2–4 and 6–8](../../experiments/020-session-2/README.md#test-card), [A13](runtime-bridge-test-card.md#next-session-autonomy-checks-expression-checks-then-session-2-continued), [clothing ask 4](../../knowledge/clothing.md#in-game-test-asks) and the [kill switch](runtime-bridge-test-card.md#kill-switch-and-wrap-up).

| # | Ask | Settles → unblocks | Drive | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 2.6 | **Session 4 couldn't test it:** the session 2 build was still staged, Thread Locker hid the vanilla helmet, and the Body Toggles head item isn't a `hide_Head` garment ([experiment 029 §3.3](../../experiments/029-session-4/README.md#33-headgear-plan-26)). Thread Locker is now off. Headgear over XF makeup, on an alpha.2-built (`hx_`) export | Whether the `hx_xfs_c<key>_makeup` component hides with the head under ArchiveXL's `hide_Head`, as the source says ([pipeline guide](../authoring/studio-to-mod-pipeline.md#how-those-maps-become-game-resources)); and that a vanilla helmet covers it | Needs the `hx_` build staged (the session 2 build still has `xfs_c<key>_makeup` and is expected to float). **Vanilla helmet:** in the CET console, `Game.AddToInventory("Items.Helmet_01_basic_01", 1)`, then M equips it (or the bridge 0.4 `inventory_equip {item: "Items.Helmet_01_basic_01", add_if_missing: true}` with the inventory class approved; its P13). **`hide_Head` item:** no vanilla item has one (neither the 2.31 TweakDB nor the cooked visual-tag preset holds the string), so M picks an installed mod item whose `.app` lists `hide_Head` and adds it the same way with its record name, `Game.AddToInventory("Items.<record>", 1)`. C: `photo_open`, `photo_frame {target:"face"}`, capture each, `photo_exit` | 4 | Two captures, the mod item's record name | Pass: the makeup hides with the head under the mod item and stays covered, not clipping, under the helmet. Fail: it floats; record the item and whether ArchiveXL logged the tag |
| 2.7 | Kill switch with the cursor hidden (card 20–22) | Kill switch restores the cursor | C: `photo_open`, `photo_hud_hide`, `bridge_kill`. M: leave photo mode, load the safety save, quit | 3 | Log `RestoreAfterKill … "cursor_shown":true`; `bridge-phase2-post` capture | Pass: the menu and cursor return, and the save lock is kept until the load |

After N2, results go to [clothing](../../knowledge/clothing.md#open-questions) question 5 and the [pipeline guide](../authoring/studio-to-mod-pipeline.md#how-those-maps-become-game-resources).

### Shimmer grain check

Shimmer's facet bake is replaced by *shimmer-grain-1*: a uniform pearly surface with a one-texel sparkle grain ([Shimmer design](../materials/finish-designs/shimmer.md), [experiment 030](../../experiments/030-shimmer-grain/README.md)). Run it with 1.5's controlled light, but only after 1.5's Gloss verdict: the rebuild also carries today's flat-finish values, so it cannot stand in for the session 2 build's Gloss A. **Build:** rebuild experiment 020's `session-2.collection.json` with the grain code (`--diagnostics`) and stage it in place of the session 2 build on the relaunch after N2. The preset is XF row **9, *Shimmer · strong***, with its recipe unchanged: each lid holds a Satin control, a fine Shimmer (density 0.65, tilt 0.65) and a strong Shimmer (density 0.8, tilt 1).

| # | Ask | Settles → unblocks | Drive | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 2.8 | *Shimmer · strong* on the grain build: face framing, then the eyes framing, then DLAA | Whether the grain reads as shimmer → Shimmer leaves experimental or falls back | C: `cc_apply {option:"XF",index:9}`, `photo_frame` face then eyes, `photo_frame {yaw_offset: ±15, ±30}` under the same light, `capture_burst {region:"eyes",frames:10}` at the eyes framing; M switches DLSS to DLAA and back for one repeat of the eyes burst | 8 | Face and eyes captures at 0° and ±15°/±30°, two eyes bursts (DLSS, DLAA) | **Pass:** at face framing neither Shimmer stripe shows any dots or grid; both read as a smooth sheen that is softer, brighter and slightly pigment-tinted beside the Satin stripe, and it moves with the light. At the eyes framing there is a fine, pinpoint sparkle that changes as the light turns, with nothing that stays put. **Fail:** dots at face framing means the build is not the grain (check the staged hashes). Shimmer identical to Satin means the grain or tint is too weak. A hard, plastic-looking lid is the SSS switch (fall back to metalness 0.08). A crawl while V and the light are still is the upscaler: compare with DLAA |

## N3. Glitter board

The coordinator stages [experiment 021](../../experiments/021-glitter-board/README.md)'s candidate after N2, replacing the session 2 pair, and records the promotion receipt; M relaunches. Script: `session-3.json` part `a` ([session 3 Part A](../../experiments/022-session-3/README.md#part-a-glitter-board)). M opens the creator 7 times, switches the upscaler to DLAA and back, and answers the dark-scene and motion verdicts. Winterkissed is enabled, so step 9 can run: C `cc_apply` Golden Girl instead of M equipping it.

| # | Ask | Settles → unblocks | Min | Evidence | Pass / fail |
|---|---|---|---:|---|---|
| 3.1 | Steps 1–4: flake points, nested against box mips | Flake size and mip scheme → the Glitter export route ([Glitter in game](../../knowledge/glitter-in-game.md)) | 10 | Sweep and orbit captures, pull-back bursts | Pass: points switch on and off on the left lid, and nested mips keep them longer than box |
| 3.2 | Step 5: DLSS against DLAA | Whether the upscaler eats the finest stripe | 5 | Same framings in both modes | Record where points vanish |
| 3.3 | Steps 6–8: shine, tilt, accent, clearing | Decal open question 1 (`MaterialModifiersConsts[2].x` on a CCXL component) | 8 | Captures in normal light and in the dark; E → A → Off | Pass: accent points visible in the dark and none left after Off. "Accent absent" is itself the answer |
| 3.4 | Step 9: Winterkissed Golden Girl | A community reference at the same framings | 2 | Two captures | — |

## N14. XF Finish Showroom

XF Finish Showroom sets mannequin heads wearing the presets side by side in front of the camera, each lit by the creator's own rig or its key light in its own frame, and turns them for highlight sweeps ([pipeline guide](../authoring/studio-to-mod-pipeline.md#xf-finish-showroom-a-test-mod-of-mannequin-heads), [knowledge](../../knowledge/skin-on-spawned-objects.md)). The steps, staging and fallbacks are the test card's [finish showroom checks](runtime-bridge-test-card.md#finish-showroom-checks-bridge-050). M loads the save and gives one verdict; C drives the rest.

| # | Ask | Settles → unblocks | Min | Evidence | Pass / fail |
|---|---|---|---:|---|---|
| 14.1 | F1–F4: the head spawns (in normal play, then in photo mode) and stands right | Whether static heads on the player head's rig draw at all; whether spawning works in photo mode | 6 | Captures of the first head; `showroom_state` | Pass: head on its pedestal, facing V or the camera, lashes and eyes present, the preset on its lids |
| 14.2 | F5–F8: fidelity, the head beside V under the same key and creator rig | Whether showroom verdicts stand in for verdicts on V → the lineup, and later finish work | 10 | The fidelity sheet and sweep | Pass: M judges Gloss A the same on both. Fail: record what differs (sheen, colour, edges, brightness) |
| 14.3 | L1–L4: the lineup, key-lit sweep, creator-lit close-ups, Glitter burst | Gloss A–D separation, the Shimmer grain, Glitter points, under identical light → the finish backlog | 12 | Lineup sheet, per-preset strips, burst manifest | Record per preset; the Shimmer and Glitter verdicts follow the Shimmer and Glitter rows' criteria |
| 14.4 | K1–K2: the kill switch and a load leave nothing | The showroom's cleanup promise | 2 | Before and after captures | Pass: nothing remains |

## N4. XF Piercings Probe

Female V, with the probe enabled. Run it after N2, on the same launch or a later one. Source: [experiment 024 test card](../../experiments/024-ccxl-piercings/README.md#test-card-the-12-checks); follow its order and exact commands. Record the ArchiveXL log lines that name `xfs_probe_piercings_pwa.inkcharcustomization`.

| # | Checks | Settles → unblocks | Drive | Min | Pass / fail (summary; full criteria on the card) |
|---|---|---|---|---:|---|
| 4.1 | 1 (registration) | Rows per area appear after Piercings; nothing replaced | M: F12. C: `player_appearance` for both XF rows and `piercings` | 2 | Off + 2 and Off + 3; vanilla Off + 14, with PRC's option 12 intact |
| 4.2 | 2, 3, 12 (layering, mix, PRC) | Own rows coexist with vanilla and PRC | C: `cc_apply` only | 4 | All pieces visible together; each row changes independently |
| 4.3 | 4, 5 (sliders; ear-only hoop against the jaw) | Rigid anchor copy against per-vertex transfer; which regions a piece needs → **attachment-solver defaults** | C: `cc_apply` ×25 with captures, then restore | 7 | Pieces stay seated; the ear-only hoop drifts under `jaw` |
| 4.4 | 6, 7, 8 (skinning, materials, photo mode) | Skinning through expressions; vanilla `.mi` on our UVs | C: `cc_confirm`, `photo_open`, `photo_frame` ±60°, `photo_expression_set` ×2, `photo_exit`; M reopens the creator once | 8 | No gap or penetration; gold and silver read like the vanilla metals |
| 4.5 | 9 (persistence, Off, Back) | Save round trip | M: save, reload, F12. C: reads, `cc_apply` Off, `cc_back` | 3 | Looks persist; Off clears both; Back discards |
| 4.6 | 10 (headgear) | Whether a visual-tag task is needed | M equips a helmet and then a mask; C frames and captures | 4 | Record whether the XF pieces hide when vanilla 06 hides |
| 4.7 | Prepare check 11 for N9 | — | M: a **throwaway** save with ears 1 and nose 3 | 1 | — |

Results go to experiment 024, the [feasibility study](../jewellery/ccxl-piercing-feasibility.md) and [jewellery resources](../../knowledge/jewellery-resources.md#in-game-test-asks).

## N5. Creator sweep A: colour encoding and layered materials

This sitting is one creator visit, driven by `cc_apply` and captures, and is never confirmed; it ends with `cc_back`. XF stays Off (set it Off first: session 4 left a look confirmed). Record the Character Rendering Editor preset. Sources: [head CC rendering](../../knowledge/head-cc-rendering.md#in-game-test-asks), [shader-eye §12](../materials/shader-eye.md#12-in-game-test-asks-batch-into-the-prepared-session), [creator lighting](../../knowledge/creator-lighting.md#indirect-light-checks-same-session-four-short-steps), [face makeup](../../knowledge/face-makeup.md#in-game-test-asks), [tattoos](../../knowledge/tattoos.md#in-game-test-asks), [brows](../../knowledge/brows.md#in-game-test-asks), [parity §4.1](../authoring/game-parity-measurement.md#41-five-minutes-in-the-next-bridge-session) and [skin §10](../materials/shader-skin.md#10-in-game-test-asks-batch-into-the-prepared-session).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 5.1 | Parity E0–E2 | Identity check, creator camera and exposure → the parity tooling's first data | M confirms the settings (SDR, ReShade effects off, grain, aberration, depth of field, vignette, lens flare and motion blur off). C: `player_appearance`, `cc_apply` XF 0, `capture_burst` full ×12, then the hair page ×8 twice | 3 | Bursts | C0 identity agrees. Two identical hair-page bursts confirm fixed exposure |
| 5.2 | **Repeat (session 4 used the wrong tones: labels applied as indices; Ultra+ on).** Use the values `01_ca_pale`, `03_ca_senna` and `01_ca_pale_00_warm_ivory` (indices 0, 4, 1). Head CC 8 and 1, skin 3: tone strength, warm ivory, neck seam | **`TintColor` encoding** (materials open question 11) for every `Color` parameter | `cc_apply` `skin_type` 1 with `skin_color` indices 0, 4, 1 (pale, senna, warm ivory); `skin_type` 3 with index 4; also `skin_type` 5 with index 1 as N9's complexion baseline. Ultra+ off | 3 | Face and head-and-shoulders captures | The preview now decodes `TintColor` as sRGB (the executable's `Color` packing, [materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions)), so this is a confirmation: senna should darken mid skin by about two fifths, as the preview's render of the same tones does. About a fifth would contradict the executable reading. Warm ivory should look warmer and a little brighter than pale |
| 5.4 | Head CC 10, first half: iris axis and orientation | Sign of the per-eye axis; texture-iris orientation | Light blue straight on; one graphic texture eye (options 62–71) | 2 | Eyes close-ups | Compare with the preview at 5° outward and 5° inward; the iris should be the same way up as in the preview |
| 5.6 | **Repeat with XF Off** (session 4 had XF Metal on V; tattoos drew over the blush, the lower lid and brow tail weren't readable). Decal order: head CC 3, tattoos 1, face makeup 2, brows 3 | Draw order within a priority → preview decal stacking | `makeupEyes` 5 black, `makeupCheeks` 10, `facial_tattoo` at both choice 2 and choice 8 (`facial_tattoo_02`; the two asks number it differently), brows 1 | 3 | Face and eyes captures | Record which draws on top at the lower lid, the cheekbone and the brow tail |
| 5.7 | **Blush half open:** cheek choice 1 is a freckle pattern, so pick two blush choices; tattoo 2 read slightly stronger than 9 in session 4. Face makeup 3 and tattoos 5: strength anchors | Preview alpha clamp and tattoo opacity | Blush 5 against blush 1 in one colour; face tattoos 9 and 2 on tone 1 and a dark tone | 3 | Face captures | Record the strengths. Both tattoos should look partly transparent, with 2 slightly stronger |
| 5.9 | **Now the metal step:** session 4's silver ring body read 58–95/255, not near black, with ray tracing and Ultra+ on. Creator lighting 3: ray tracing off (only if RT is on) | Ray-traced self-bounce on metal | M: RT off in the settings, then F12. C: 5.5's silver frame. M: RT back on | 3 | One capture | Any difference is ray-traced |

## N6. Creator sweep B: rows, links, hair calibration, body, blink

Again one creator visit, never confirmed, ending with `cc_back`. Sources: [CC file chain](../../knowledge/cc-file-chain.md#in-game-test-asks), [brows](../../knowledge/brows.md#in-game-test-asks), [hair colour §6](../hair/hair-colour-authoring-feasibility.md#6-in-game-checklist), [creator lighting §8](../../knowledge/creator-lighting.md#8-capture-protocol), [shader-hair §13](../materials/shader-hair.md#13-in-game-test-asks-batch-into-the-prepared-session), [render coverage §7](../character-customization/render-coverage.md#7-in-game-checks-for-the-drawn-groups), [body](../../knowledge/body-rendering.md#in-game-test-asks), [facial animation](../../knowledge/facial-animation.md#in-game-test-asks) and [session 3 Parts B–C](../../experiments/022-session-3/README.md#part-b-blink).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 6.2 | **Hands still open** (session 4 confirmed the body keeps tone 3; the creator framing hid the hands): CC file chain 1: link propagation | Link rule for tone followers | `skin_color` 3, `skin_type` 1 → 5, `facial_tattoo` 6 | 2 | Full-window captures (face and hands) | Every follower keeps tone 3 |
| 6.3 | **Colour still open** (session 4: the style position carries across finishes; the colour sub-row isn't settable from the lips page, so use the finish's own colour row): CC file chain 2 and 8: lip finish tree; EP1 colour carry-over | Switcher state rules | `makeupLips` 8 colour 6, finish regular → glossy → matte → none → glossy; eye makeup 5 teal → 25; `player_appearance` after each | 2 | JSON | Style and colour survive the finish switch; record whether teal carries over (possibly not) |
| 6.4 | **One style checked** (session 4: style 5, same hair at the same index); repeat at a position where the two lists differ: CC file chain 11 and session 3 C5: linked hairstyle | Switcher member mapping (CORE-61) | `hairstyle` 5, then a face cyberware that swaps to `hairstyle_cyberware` | 2 | Two captures and JSON | Same hair: the Studio's rule holds. Same position with different hair: change the rule |
| 6.5 | Brows 1: brow colour against hair colour | Brow and hair colour independence | Hair `brown_liquorice`, brows `blonde_platinum`, hair `black_carbon` | 1 | Eyes captures | Brows unchanged |
| 6.6 | Hair colour 6: bald style, brows Off | Side effect of exact-slot overlays | The bald hairstyle; brows Off. M glances at whether a colour grid shows | 1 | Full-window captures | Record it |
| 6.7 | **Mostly done in session 3 (D5); still to take: the lash frame and the hairstyle 1 and 5 frames** ([hair shading §8](../../knowledge/hair-shading.md#creator-ladder-session-3)). Calibration frames (creator lighting §8 frames 1–4, shader-hair 4, head CC 5, head CC 7 baseline) | The preset's `k`, exposure and hair bake chain (status "waiting on the maintainer" item 4); baselines for N9 | M: Character Rendering Editor to "Vanilla" in CET first. C: hair page on arrival; brows, lashes and skin pages; ladder `38_ash_brown`, `39_ash_grey`, `74_steel_smoke`, `66_platinum_blonde` on the `lm097_hair` style; lashes `05_brown_liquorice`; hairstyle 1 brown liquorice and 5 blonde platinum. M: back to the usual preset; C: one repeat frame | 8 | PNG captures plus bursts; settings noted | Ladder ratios against the [bake table](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request): 3.1/4.2/6.6 means the decoded bake holds. Lashes (59, 28, 0) means Alliekat wins; (172, 130, 15) means the base game wins |
| 6.8 | **Repeat the frames** (session 4's showed a closed mouth under the CET overlay; the labels are base, silver, gold, copper, pink): use the teeth page, overlay closed. Teeth, choices 0–4 (render coverage, new) | Teeth colour and metal against the preview | `cc_apply` `teeth` 0–4 | 2 | `face` captures | **Comparison waits for the teeth slot** (the head-completeness track); the captures can be taken now |
| 6.9 | **Captured in session 4, not yet compared** (breast choice 2; private); idle arms still to take: Body 2 and 3: underwear at the largest breast size; idle arms | Body open question 2; the rigid helpers | Body page: the breast option at its largest. Shoulder and wrist through `capture_screenshot` full plus `capture_recrop` | 3 | Captures | Underwear coverage as in the preview |
| 6.10 | Facial animation 1–3 (session 3 B1–B3): blink closure, lashes, makeup on closed lids | Per-shape eye seat against the base centre (`h011`) | `cc_apply {option:"eyes"}` 0, 9, 11, 1; per shape a `capture_burst {region:"cc-eyes",frames:40,interval_ms:100}` to catch a blink; then shape 12 with an XF upper-lid look | 5 | Contact sheets | No eye visible between the lids; lashes on the lid line; no bare skin between crease and lashes |

## N7. Photo mode: parity, eye and skin light (the repeats)

Use photo mode throughout, with XF Off. R1, R2, the back-lit ear and the parting line ran in session 4 ([results so far](#results-so-far)); these rows remain. Sources: [parity §4.1](../authoring/game-parity-measurement.md#41-five-minutes-in-the-next-bridge-session), [head CC 10–12](../../knowledge/head-cc-rendering.md#in-game-test-asks) and [skin §10](../materials/shader-skin.md#10-in-game-test-asks-batch-into-the-prepared-session).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 7.3 | **Repeat E5 and E7** (session 4 lost E5's light-on frame, overexposed at brightness 60, and ran under Ultra+ Auto quality): light pair at brightness 45, portrait lens. Parity E4–E7 | Photo-mode camera reconstruction and light position (photo-mode open question 5) | `world_time_set` 02:00, `photo_open`, `photo_hud_hide`, `photo_camera_set {grain:0,…}`, `photo_frame`, `photo_subject`, light off/on, yaw −30/0/+30, eyes framing | 5 | Captures with `photo_subject` JSON | Frames arrive with their readings; analysed offline (C1, C5, C7) |
| 7.4 | **Repeat** (session 4's eyes crop cut the eyes at its bottom edge, and a fringe covered the near eye): `full` plus a recrop. Head CC 12 and the second half of 10: cornea against iris; iris depth from the side | Catch-light size and a matte iris; parallax | Eyes framing, light 1 on, `yaw_offset` −30…30, then 45 | 3 | Captures | Catch light stays sharp and small; the iris darkens smoothly; the iris sits under the cornea |
| 7.5 | Head CC 11: wetness shell (**partial**) | Tear-line highlight | Yaw frames only: the ask needs the light moved from above the head to below the chin, which the bridge can't do (suggestion B5) | 1 | Captures | Corners darker than mid-sclera; the vertical half stays open |
| 7.6 | **Repeat with Ultra+ off** (session 4: High and Low within the noise, but Ultra+ managed the setting under Auto quality). Start each run from gameplay, not inside another photo-mode visit. Skin 4: scatter width and quality | Parity fit of the skin reference §11.6; 11 against 25 samples | Raking light (yaw ±60) at face framing. M: SSS quality Low in the settings. C: repeat. M: High. C: repeat at twice the distance | 6 | Captures; record the upscaler, RT mode and SSS quality | An identical Low/High pair suggests the stochastic blur |

## N8. Photo mode: vanilla finishes under a sweep

Three creator visits, each changing lips, cheeks and brows at once (they don't overlap), then `cc_confirm` → `photo_open` → face framing, light 1 on, yaw ±30, with lip, cheek and brow crops through `capture_recrop`. M presses F12 per visit. Sources: [head CC 4 and 13](../../knowledge/head-cc-rendering.md#in-game-test-asks), [face makeup 1](../../knowledge/face-makeup.md#in-game-test-asks), [brows 2](../../knowledge/brows.md#in-game-test-asks) and [shader-hair 3](../materials/shader-hair.md#13-in-game-test-asks-batch-into-the-prepared-session).

| # | Ask | Settles → unblocks | Drive | Min | Pass / fail |
|---|---|---|---|---:|---|
| 8.1 | Visit 1: lipstick 5 regular, blush 5 gold, brows 3 | Head CC 4, face makeup 1, brows 2 in one sweep | C: `cc_apply` ×3, `cc_confirm`, photo sequence | 4 | Regular keeps the skin's highlight; gold shows a moving highlight; a faint sheen shows on the brow hairs |
| 8.2 | Visit 2: lipstick glossy, blush silver | Same | Same | 3 | Glossy shares the highlight; silver highlights move |
| 8.3 | Visit 3: lipstick matte, blush brown | Same, plus the SSS seam at metalness 0.1 on the blush edge | Same | 3 | Matte dulls the highlight; brown shows none; record any seam at the soft edge |
| 8.4 | Hair ambient against direct: visits 4–5, hair 38 then 66, each confirmed | Whether albedo enters hair ambient twice (hair shading open question 3) | Photo mode in an interior at 02:00 with no photo-mode light. Hair three-quarter framing via `photo_frame` with head-and-shoulders | 6 | Ambient-only platinum/ash ratio about the square of N6's mirror ratio: the model holds. The same ratio means the composite doesn't light hair |
| 8.5 | Head CC 13: face decals on the reference save | Decal colour and strength against the preview's reference frames | M loads the reference save. C: photo mode, lips and left-cheek crops at 0° and ±30° (yaw replaces the ask's "light 45° up") | 5 | Lipstick keeps the gloss; blush covers the cheek and nose tip. The legacy XF layers can't be checked here (their build is disabled in this profile) |

## N9. Relaunch: missing mods and mod-over-base

This sitting needs two throwaway saves, T1 (probe looks, from 4.7) and T2 (a pack hair colour such as one from *Like totally - Pink*, plus a CCXL eye colour such as one from *Beautiful IRIS III*; M makes it at the end of N6 with `cc_confirm`). Never overwrite the originals. Quit, then M disables five mods in the test profile: **XF Piercings Probe**, that hair pack, Beautiful IRIS III, **Alliekat's Natural Hair Tones** and **Realistic Complexion III**. They touch separate resources. Relaunch. Sources: [experiment 024 check 11](../../experiments/024-ccxl-piercings/README.md#test-card-the-12-checks), [CC file chain 5](../../knowledge/cc-file-chain.md#in-game-test-asks), [hair colour 10](../hair/hair-colour-authoring-feasibility.md#6-in-game-checklist), [head CC 2 and 7](../../knowledge/head-cc-rendering.md#in-game-test-asks), [mod loading 1](../../knowledge/mod-loading.md#in-game-test-asks) and [shader-hair 2](../materials/shader-hair.md#13-in-game-test-asks-batch-into-the-prepared-session).

| # | Ask | Settles → unblocks | Drive | Min | Pass / fail |
|---|---|---|---|---:|---|
| 9.1 | Load T1: face and piercing rows, load warning | Whether the probe needs tombstones | M loads T1 and presses F12. C: `player_appearance` for `piercings` and both XF rows, then capture | 4 | Record what shows and any warning. A warning that doesn't name its mod means splitting the toggles next time |
| 9.2 | Load T2: eyes and hair, mirror state | Removed-colour fallback | Same, for `eyes_color` and `hair_color` | 4 | Record it (black, blonde or other) |
| 9.3 | Hairstyle 1 brown liquorice, 5 blonde platinum, lashes 05 brown liquorice | `.hp` mod-over-base in game | C: `cc_apply` and captures against 6.7's frames | 3 | A visible change confirms mod over base |
| 9.4 | Skin type 5, warm ivory (`skin_color` index 1) | Complexion replacer over base albedo | Against 5.2's frame at the same index | 1 | A visible change confirms it |
| 9.5 | Re-enable all five, relaunch, load T1 and T2 | Whether choices come back | M: MO2 and relaunch. C: read the rows | 5 | Record it |

## N10. Inventory: cyberware, bare body, clothing

This sitting needs the most player time. It needs a save whose V has Gorilla Arms, or a ripperdoc visit, plus Mantis Blades if available, mod garments tagged `hide_Chest` and `hide_Torso`, and an EquipmentEx outfit. Sources: [body 1 and 4](../../knowledge/body-rendering.md#in-game-test-asks), [shader-metal-glass §9](../materials/shader-metal-glass.md#9-in-game-test-asks-batch-into-the-prepared-session), [tattoos 2–4](../../knowledge/tattoos.md#in-game-test-asks), [clothing 1–3 and 5](../../knowledge/clothing.md#in-game-test-asks), [clothing backlog 6](../backlog/clothing-render.md#in-game-checks) and [render coverage (arm cyberware)](../character-customization/render-coverage.md#7-in-game-checks-for-the-drawn-groups).

| # | Ask | Settles → unblocks | Drive | Min | Pass / fail |
|---|---|---|---|---:|---|
| 10.1 | Gorilla Arms holstered and drawn; knuckle window with light 1 on and off; body tattoo 01 forearm ink | Holster-state meshes (body open question 4), glass under local light, arm decals, ink over cyberarms | M: equip, holster and draw. C: photo mode, head-and-shoulders framing ×2 with the light on and off | 8 | Plating shows while holstered; no highlight from the light on the glass; hard decal edges; record the ink |
| 10.2 | Body 1: bare body against the preview | Tone at the neck and wrists, feet, underwear | M strips every slot. C: photo mode front and side. There is no full-body preset (suggestion B8), so M frames by hand | 5 | Tones match; flat feet |
| 10.3 | Tattoos 2 and 4: body tattoo 01 over the KS UV overlay; garments tagged `hide_Chest` and `hide_Torso` | Overlay against decal order; hide tags on body ink | M: equip the garments. C: captures. Confirm an overlay is active first (the profile's tattoo overlays are disabled) | 6 | The decal draws over the overlay; `hide_Chest` keeps the leg and arm ink; `hide_Torso` removes it all |
| 10.4 | Clothing 1–3, 5 and backlog 6: an outfit per layer, a wardrobe set with an empty area, an EquipmentEx outfit, a body-mod refit, garment edges | Preview clothing against the game | M: dress. C: photo framings | 10 | Match against the Studio's render of the same save. The worn-item snapshot needs a new read (suggestion B7) |

## N11. XF Expressions set in photo mode (R4–R5)

Phase 3's first in-game test ([expression editor §6](../animation/expression-editor-design.md#6-export-route), [phase 3 status](../animation/expression-editor-design.md#phase-3-status), [pipeline](../authoring/studio-to-mod-pipeline.md#expression-sets-photo-mode-expression-mods)). It can run on the test profile as it is: the Mega Pack stays enabled, because working beside it is one of the questions. Best after 7.1–7.2, whose answers explain a failure here.

**Candidate (C, before the sitting).** In the Studio, a set **"XF session test"** built **For my game** on the test profile's route, holding in this order: (a) **"Happy copy"**, started from the game's `facial_happy` and saved unchanged; (b) **"Happy, jaw open"**, the same with Jaw open at 40 %; (c) the five Natural samples. Record the Build's archive SHA-256, the indices (the Mega Pack's 217 rows put them at faceIds 217–223; the menu lists them at lower option values, 207 onward on this install, so read `photo_state` key 28 to select them) and the Studio's own renders of (a), (b) and Warm smile at face framing. **M, MO2 closed:** Show in folder, then add its `archive` and `r6` folders as one new MO2 mod "XF Expressions - XF session test" in the test profile only, enabled. Nothing else changes. Note the installed ArchiveXL and TweakXL versions (the files are written for ArchiveXL 1.27.3 and TweakXL 1.11.4 or later).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 11.1 | Load lines | The patch and records load | After launch: ArchiveXL log lines naming `xfs_expressions_x…` added to both `h0_000_p?a__basehead__face_rig_photomode` appearances; TweakXL log free of errors for the XF file | 2 | Both logs | Both lines present, no TweakXL error. Missing ArchiveXL line: the patch route failed (R3 territory) |
| 11.2 | Listed | Records and `faceAnimations` | `photo_open`, `photo_state {options: true}` | 2 | Key 28's option JSON | Seven new entries after the Mega Pack's, labelled as saved, at faceIds 217–223 (menu values from 207) |
| 11.3 | R4: plays as the preview | The clip format and attachment; preview parity | Look-at off (`photo_camera_set {look_at: 0}`), `photo_frame {target: "face"}`, HUD hidden; for (a), (b), Warm smile: `photo_expression_set` with each entry's menu value (not its faceId), wait 2 s, capture; then vanilla Happy (menu value 7), capture; portrait lens (FOV 22, close/far −1.2) | 8 | Captures `n11-*` beside the Studio renders | (a) matches vanilla Happy; (b) differs only by the open jaw; Warm smile resembles the Studio's render (wrinkles aside). A neutral face means the clip wasn't found (the set isn't on the live face rig); no change at all means the row or record is wrong |
| 11.4 | R5: beside the Mega Pack | The superset table | `photo_expression_set` "Static: Sleeping" (menu value 56, faceId 60) and one of the pack's animated faces; capture | 3 | Captures | Both play as before the XF mod was added |
| 11.5 | Cycle and hold | Cross-fade and hold with XF clips | Select (c)'s five in turn, then back to (a); wait 5 s on the last | 3 | Captures | Each changes with the usual 1 s blend and holds |

Afterwards M disables the test mod (MO2 closed). Results go to the expression editor design (R4, R5) and [facial expressions](../../knowledge/facial-expressions.md#open-questions) (questions 3 and 4).

## N12. Masculine V: XF Eye Artistry for him

The first in-game test of the masculine selector ([male V plan §6](../character-customization/male-v-plan.md#6-in-game-checks-worth-batching), [pipeline: the masculine V's selector](../authoring/studio-to-mod-pipeline.md#the-masculine-vs-selector)). Everything in it is offline-verified only: his plate is the audited cut of the 2.31 male head, lifted 0.4 mm like hers; his selector is option index 541 in the masculine creator; the textures are hers. It also carries the creator-row and mirror asks that need a new-game start ([blocked list](#blocked-or-not-ready)).

**What M provides.** A **masculine V made in a new game** (body gender masculine, any voice), saved in the creator's last step or just after it, and kept. None of the 165 reference saves is masculine. For 7 below, a second throwaway masculine V with the **feminine** voice. The reference feminine save for 3.

**Candidate (C, before the sitting).** Build a both-body XF Eye Artistry from one collection with two presets: **"N12 Matte liner"** (one Matte upper-lid liner, black, crisp) and **"N12 Metal lid"** (one Metallic lid wash to the crease). Check first: its product line must end "for a feminine and a masculine V" with no warning under it, and the manifest's feature `audience` must say the same (`details.bodies` `["female", "male"]`). Record the archive and `.archive.xl` SHA-256, the masculine plate's mesh and morph SHA-256 (`details.masculinePlate`) and the Studio's renders of both presets on the Default V (masculine) and on the reference feminine V at the creator's eye framing. Then **M, MO2 closed**: **Add to my mod manager** into the test profile, replacing the staged alpha.2 export (one XF Eye Artistry at a time; two would add two rows). Note the installed game, ArchiveXL and TweakXL versions: the build is written for game 2.31 and ArchiveXL 1.27.3. Nothing else changes.

**Staging checklist.**
- [ ] The candidate's `.archive.xl` lists `female:` and `male:` and both `.app` files under `player_customization.app`.
- [ ] Exactly one XF Eye Artistry mod enabled in the test profile; the legacy `XF Eye Artistry CCXL - Dev` stays disabled.
- [ ] The Studio's renders of both presets on both V's are saved beside the session folder.
- [ ] The masculine save and the reference feminine save are both in the save list; the safety save made.
- [ ] Bridge staged and connected (for captures and `cc_apply`); ArchiveXL log cleared before launch.

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 12.1 | Load lines | ArchiveXL merges the `male:` customization | After launch: ArchiveXL log lines naming `xfs_collection_pma.inkcharcustomization` and `xfs_collection_pma.app` | 2 | The log | Both named, no error. Missing: the declaration or the scope failed |
| 12.2 | §6.1 Selector registration | Index 541, `face` group, Off first | **M** loads the masculine save and opens the creator; C reads the XF option (`player_appearance {option: "xfs_c<key>"}`) and captures the eye section (`cc_page {page: "eyes"}`); then gameplay and photo mode (`photo_open`, captures) | 6 | Captures, row list | One XF row between Teeth and Eye makeup, Off first, both preset names; it switches in the creator, gameplay and photo mode. Two XF rows, or none, fail |
| 12.3 | §6.2 Placement and depth | The masculine plate, lift and lids | Each preset in turn (`cc_apply`), creator eye framing, closest zoom; blink (wait for one, burst capture); eye shapes `None`, `h091`, `h201` | 8 | Captures `n12-2-*` beside the Studio renders | Liner on the lash line and wash on the lid, no breakup at the closest zoom, no edge in motion, clean closed lids on all three shapes. Makeup floating or buried: the plate or lift is wrong for him |
| 12.4 | §6.3 Same look, both bodies | The shared texture window | The Metal lid preset on the masculine V and (after **M** loads it) the feminine reference V, same framing | 5 | Paired captures | The wash reaches the same anatomical marks (lash line, crease) on both. A consistent shift on him means the shared UV rule needs a per-body window |
| 12.5 | §6.4 Save round trip | Save persistence on his app | Pick "N12 Matte liner", **M** saves and reloads, hands the save over | 3 | The save | The look is back after reloading; the save lists `xfs_collection_pma.app` with the preset's definition in `face` and `character_customization` |
| 12.6 | §6.5 Beard | Stubble strength and card colour | Beard 5, part 2, brown liquorice (`cc_apply`), creator framing | 2 | Capture beside the preview | Stubble strength and card colour against the preview |
| 12.7 | §6.6–6.7 Body and voice | Censored body, voice independence | Photo mode, all slots stripped (**M**); then the feminine-voice masculine V: the XF row and one preset | 4 | Captures | Bare chest and the underwear bottom, `nipples_02` when chosen; with the feminine voice nothing visible differs and the XF row behaves the same |

Afterwards M may leave the both-body build staged (it replaces the alpha.2 export for the feminine V too; her files are the same bytes). Results go to the [male V plan](../character-customization/male-v-plan.md) (§6 and phase status) and the pipeline guide's boundaries. The creator-row and mirror asks of the blocked list can run in the same new-game creator before 12.2.

## Results so far

Answered rows move here from their sittings, with one line each; the detail is on the linked pages.

**Session 4** (28 September 2026, bridge 0.4.1, [experiment 029](../../experiments/029-session-4/README.md#3-results)):
- **N1, bridge autonomy.** The 0.4.1 preflight passed P1–P3, P6 (a light placed about V holds and lights the face) and P11b. It failed P7 (a light re-placed at the camera) and P9 (`cc.open` away from a mirror); F12 opens a creator whose Confirm keeps the look ([photo mode §3.1](../../knowledge/photo-mode.md#31-how-character-customization-anywhere-opens-it)).
- **1.5, Gloss A–D** under a controlled neutral light. Gloss C is clearly the flattest, so the written roughness drives the shine. A, B and D look wet, and the stripes don't separate at face framing. Shimmer · strong is a regular grid of dots, far too large ([decal reference §13](../materials/shader-decal.md#13-in-game-test-asks-batch-into-the-prepared-session)).
- **N13, cheek check.** The smile lump shows in game where the preview puts it. Its size isn't settled (lens, light and facial setup differ). The raiser doesn't round the cheek. The bulge is a consistent trait of the game's rig ([facial animation §7](../../knowledge/facial-animation.md#7-why-smiles-bunch-beside-the-nose)).
- **7.1–7.2, R1 and R2.** The live `face_rig` is on the photo-mode stand-in and solves with the **male player setup**. faceId is the table index, not the menu value, and only the stand-in takes it ([facial expressions](../../knowledge/facial-expressions.md#which-facial-setup-v-actually-uses)).
- **7.7, back-lit ear.** Translucency runs, with the Character Subsurface Translucency toggle on ([skin §6.4](../materials/shader-skin.md#64-translucency-the-usetranslucency-setup)).
- **7.8, parting line.** No bright line along the closed mouth in game.
- **5.5, piercings and the heart eye.** Gold is gold, black plastic keeps its colour, and the heart is upright. The silver highlight cores are neutral, so the key lights read white ([creator lighting §12.5](../../knowledge/creator-lighting.md#125-refitting-from-new-matched-captures)).
- **6.1, 6.2 (body), 6.3 (style), 6.4 (style 5).** The creator's counts are the resources' plus Off. The body keeps tone 3 across skin types. The lip style position carries across finishes. The linked hairstyle keeps the same hair ([CC file chain](../../knowledge/cc-file-chain.md#in-game-results-session-4)).

## Blocked or not ready

| Ask | Source | Blocked on |
|---|---|---|
| Teeth comparison (6.8) | [Render coverage](../character-customization/render-coverage.md#7-in-game-checks-for-the-drawn-groups) | The **teeth slot** (head-completeness track, running). The captures can be taken now |
| Hair in ambient light in the preview (compare 8.4) | [Shader-hair §11](../materials/shader-hair.md) | The **hair bake and ambient** work in the same head-completeness track. The game captures can be taken now |
| "Add to my mod manager" hands-on test (a Studio test, not in game) | [Code health INSTALL-01](../authoring/code-health.md) | The **install fix** (cleanup-install track, running). Until it lands, nobody presses Add |
| Legacy makeup rows Off; legacy layers in head CC 13 | [CC file chain 12](../../knowledge/cc-file-chain.md#in-game-test-asks), [session 3 C4](../../experiments/022-session-3/README.md#part-c-creator-and-piercings) | The legacy build is disabled in the test profile (enabling it adds a second selector). Needs a decision: a separate profile, or drop the ask |
| Creator rows in a new game; creator against the mirror | [CC file chain 10](../../knowledge/cc-file-chain.md#in-game-test-asks), [creator lighting 4](../../knowledge/creator-lighting.md#indirect-light-checks-same-session-four-short-steps) | A new-game start (the bridge doesn't drive the new-game creator). Run them in [N12](#n12-masculine-v-xf-eye-artistry-for-him)'s new-game creator, before 12.2 |
| Brow and cheek build asks; the hair colour probe (items 1–5, 7–9, 11–13) | [Brow editor §7](../brows/brow-editor-design.md#7-open-facts-and-runtime-test-asks), [brows and cheeks brief](../backlog/brows-and-cheeks-brief.md#runtime-questions-to-batch-into-a-future-session), [hair colour §6](../hair/hair-colour-authoring-feasibility.md#6-in-game-checklist) | Their builds (not started; brows, cheeks and hair colour are awaiting discussion) |
| Expressions R3; R1 without the Mega Pack, and R1 in the creator and gameplay; R6–R8 | [Expression editor §8](../animation/expression-editor-design.md#8-runtime-questions-r1r5-through-the-bridge), [expressions brief](../backlog/expressions-and-idles-brief.md#runtime-questions-for-one-batched-session) | A test archive (R3; export no longer needs it) and a throwaway profile. R4–R5 are now [N11](#n11-xf-expressions-set-in-photo-mode-r4r5). Session 3 Part D's CET lines are superseded by the bridge's R1 and R2 (answered in session 4); keep them only as a fallback |
| CET hair-option dump | [Shader-hair 1](../materials/shader-hair.md#13-in-game-test-asks-batch-into-the-prepared-session) | Runnable now by M pasting into the CET console (2 min, add to N6 6.7), or by the bridge (suggestion B6) |
| Mod-against-mod order | [Mod loading 2](../../knowledge/mod-loading.md#in-game-test-asks) | A throwaway MO2 profile with a copied PRC archive; low value |
| Steam, Epic and Vortex detection | [Mod loading 3](../../knowledge/mod-loading.md#in-game-test-asks), [Vortex](../../knowledge/vortex.md#test-asks) | Community testers, not the maintainer |
| Debug views of the plate | [Materials 6](../../knowledge/materials-and-shaders.md#in-game-test-asks) | No debug-view toggle found yet |
| **Live posing L0**, with its **face-carrier variant** | [Pose editor §7.4](../animation/pose-editor-design.md#74-first-experiment-plan-one-supervised-session) (LP1–LP9, LP-F1–LP-F4), [test card L1–L6](runtime-bridge-test-card.md#batch-4-checks-refusals-the-panel-and-live-posing-l0) | Staging the *XF Live Pose (test)* package (M, MO2 closed) and M's approval of the carrier write (Q6). The face variant also needs an XF Expressions set staged as its carrier, and the bridge's live read and apply extended to a face clip's constant track keys (not built). It is the one agreed early step for live facial control ([backlog](../backlog/README.md)); the rest of that feature waits until the product reaches 1.0 |

## Bridge suggestions (for the [autonomy backlog](../backlog/bridge-autonomy.md#suggestions-from-the-sessions-plan))

Player steps this plan still needs, and what would remove them. B1, B2, B3, B6, B8 and B9 are built (bridge batch 3, offline only, B4 as a read; [status](../backlog/bridge-autonomy.md#suggestions-from-the-sessions-plan)); with that build staged, the rows below that ask M to open the creator or set a vanilla row become bridge steps, and the [batch 3 checks](runtime-bridge-test-card.md#batch-3-checks-the-creator-from-gameplay-and-the-settings-record) come first:

| # | Capability | Removes | Plan rows |
|---|---|---|---|
| B1 | **`cc.open`** (autonomy rank 4) | Every "open the creator" ask: about 30 across N1–N8 | 1.5, 2.1–2.4, N3, 4.4, 5.8, 8.1–8.5 |
| B2 | `world.time.set` while the appearance screen is open, or photo mode's time attribute (rank 7) | Leaving and reopening the creator twice | 5.8 |
| B3 | Session scripts use `cc_apply` for piercings, eye colour, eye shape and hairstyle (a script generator change only) | 12 hand asks in `session-2.json` p3 and `session-3.json` B–C | 5.5, 6.4, 6.10 |
| B4 | A read (then write) of graphics settings: upscaler, DLAA, RT and PT, SSS quality | The setup notes and the DLAA and SSS switches; E0 recorded automatically | 2.5, 3.2, 5.1, 5.9, 7.6 |
| B5 | A spawned key light that moves in elevation (rank 10) | Vertical light sweeps the photo-mode lights can't make | 7.5, 7.7, 8.5 |
| B6 | A read-only `game.options.list` for GameOptions groups | The CET console paste | Shader-hair 1 |
| B7 | `player.equipment` (worn items), then `item.equip`/`unequip` for test-profile items | Dressing, stripping and the helmet steps; the "worn-item snapshot" clothing 3 assumes | 2.6, 4.6, 10.2–10.4 |
| B8 | A full-body XF camera preset | Hand framing of the whole body | 10.2 |
| B9 | `cc.page` (creator page camera), if E2 shows that `cc_apply` doesn't move the camera | M clicking creator pages | 5.1, 6.7, 6.9 |
| B10 | Hide photo-mode NPCs (rank 7) | Clean frames in public spots | 7.3 |
