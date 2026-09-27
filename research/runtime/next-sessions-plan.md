# Next in-game sessions: ranked plan

**Status (28 September 2026): session 3 ([experiment 028](../../experiments/028-session-3/README.md#5-results-28-september-2026)) ran in part.** It answered N2's Shimmer, Metal, Depth and Lines rows (removed below; results on the experiment page and the [pipeline guide](../authoring/studio-to-mod-pipeline.md#plate-lift-at-build)) and left the Gloss verdict inconclusive under the creator's light (1.5, now with a controlled light) and the headgear check unrun (2.6, now for the `hx_` build). N3 (Glitter) opens the next session, with an alpha.2-built export beside it. It gathers every open in-game ask into twelve sittings of 20–30 minutes, driven by the coordinator through the [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md). Sittings are ordered by value per minute and grouped by shared setup. When a sitting has run, record its results on the source pages and tick the row here with the date. Delete rows once their answers are on the source page. The bridge's conventions, failure handling and kill switch are on the [test card](runtime-bridge-test-card.md).

**Who does what.** The maintainer (**M**) starts MO2 and the game, loads the save, makes the safety save, opens the creator when asked (F12 with Character Customization Anywhere, or a mirror), and does anything in the inventory, MO2 or the game's settings. The coordinator (**C**) drives everything else with the bridge: MCP tools, or `bun tools/bridge-client.ts run <command>` (dotted names) in `projects/xf-runtime-bridge`. Scripted runs use `bun tools/session.ts <script> --out <folder> [--from <label>]`. Agents never launch the game or MO2.

## Order at a glance

| # | Sitting | Min | Top asks | Needs beyond the staged setup |
|---|---|---:|---|---|
| [N1](#n1-bridge-autonomy-and-the-gloss-verdicts) | Bridge autonomy and the Gloss verdicts | 30 | A1–A12; Gloss A–D | — |
| [N2](#n2-finish-close-out-headgear-kill-switch) | Headgear, kill switch | 7 | A13 on the `hx_` build | An alpha.2-built export staged; a vanilla helmet and a mod item with `hide_Head` in V's inventory |
| [N3](#n3-glitter-board) | Glitter board | 25 | [Experiment 021](../../experiments/021-glitter-board/README.md#test-card) steps 1–9 | **Restage**: the Glitter board replaces the session 2 build (after N2), relaunch |
| [N4](#n4-xf-piercings-probe) | XF Piercings Probe | 30 | [Experiment 024](../../experiments/024-ccxl-piercings/README.md#test-card-the-12-checks) checks 1–10, 12 | **Enable `XF Piercings Probe`** (staged, not enabled) |
| [N5](#n5-creator-sweep-a-colour-encoding-and-layered-materials) | Creator sweep A: colour encoding, layered materials | 30 | Tint encoding, iris mask, piercing metals, decal order | — |
| [N6](#n6-creator-sweep-b-rows-links-hair-calibration-body-blink) | Creator sweep B: rows, links, hair calibration, body, blink | 30 | Calibration frames, link rules, blink closure | M switches the Character Rendering Editor preset once |
| [N7](#n7-photo-mode-expressions-parity-eye-and-skin-light) | Photo mode: expressions, parity, eye and skin light | 30 | R1, R2; parity E4–E7; SSS width | M changes SSS quality once |
| [N8](#n8-photo-mode-vanilla-finishes-under-a-sweep) | Photo mode: vanilla finishes under a sweep | 25 | Lip finishes, metallic blush, brow gloss, hair ambient | The reference save for 8.4 |
| [N9](#n9-relaunch-missing-mods-and-mod-over-base) | Relaunch: missing mods and mod-over-base | 20 + 2 launches | Probe missing-mod check, removed-colour fallback, `.hp` and complexion winners | Throwaway saves from N4 and N6; five mods toggled |
| [N10](#n10-inventory-cyberware-bare-body-clothing) | Inventory: cyberware, bare body, clothing | 30 | Gorilla Arms, holster state, garment hide tags | A save with Gorilla Arms; tagged mod garments |
| [N11](#n11-xf-expressions-set-in-photo-mode-r4r5) | XF Expressions set in photo mode (R4–R5) | 25 | Listed, plays as the preview, Mega Pack faces still work | **Stage** one expression-set build by hand (M, MO2 closed), relaunch; best after N7's R1–R2 |
| [N12](#n12-masculine-v-xf-eye-artistry-for-him) | Masculine V: XF Eye Artistry for him | 30 | Male V plan §6 checks 1–4 (selector, placement and lids, same look on both, save) and 5–7 | **A new-game masculine V** (M makes and keeps the save); a both-body build staged in place of the alpha.2 export |

**Why this order.** N1 and N2 close [session 2](../../experiments/020-session-2/README.md): the Gloss verdict sets the finish defaults, and the headgear row checks the alpha.2 export's `hx_` component. Neither blocks `v0.1.0-alpha.2` any more. N1 also proves the autonomy features that every later sitting depends on. N3 decides the Glitter route, the next finish for XF Eye Artistry. N4 answers the attachment questions for piercings, the next feature. N5–N8 settle preview-parity questions, most of them without any player step once the creator or photo mode is open. N9 and N10 cost the most player time.

**Launches.** One evening can hold N1, N2 and N4–N8 on one launch. Enable the probe beforehand: it only adds two rows. N3 needs a restage and a relaunch. N9 is two launches by design.

## Before every sitting (C, offline)

1. **Bridge:** the profile still holds the 0.2.0 `-writes` build from `509f599` ([build record](runtime-bridge-test-card.md#build-record-staged)). The session scripts need `cc.open` (batch 3 or later), so **restage 0.3.0 `-writes`** first, with MO2 closed ([batch 4 build record](runtime-bridge-test-card.md#build-record-batch-4-branch-build-not-staged); steps in [experiment 028](../../experiments/028-session-3/README.md#before-the-session-c-offline-nothing-launches)). Check that the plugin log shows `script_calls=on`.
2. **Profile `XF Studio diagnostic 2026-09-25`:**
   - **XF Eye Artistry** holds the session 2 build until N3.
   - **XF Piercings Probe:** enabled in the profile, with hashes matching the build record (checked 27 September; [staging](../../experiments/024-ccxl-piercings/README.md#staging)).
   - These are already enabled: PRC's framework plus two item packs, Realistic Complexion III, the KS UV framework, Alliekat's Natural Hair Tones, the Photomode Facial Expression Mega Pack, Character Customization Anywhere, the Character Rendering Editor and Winterkissed.
   - The legacy **XF Eye Artistry CCXL - Dev** stays disabled.
   - Re-run the [framework check](runtime-bridge-test-card.md#before-the-session-coordinator) if a sitting slips a day.
3. **Evidence:**
   - Run `python tools/capture_session.py --label <sitting>-pre` before and `--label <sitting>-post` after, with `--profile "XF Studio diagnostic 2026-09-25"`.
   - Put one runner `--out` folder per sitting under a private, ignored location. Captures are never committed.
   - Every result keeps its bridge JSON, and the manifest records the build commit.
4. **Scripts:**
   - N1 and N2 use [`session-2.json`](../../projects/xf-runtime-bridge/tools/sessions/session-2.json); N3 uses [`session-3.json`](../../projects/xf-runtime-bridge/tools/sessions/session-3.json) part A.
   - N4–N10 run as MCP calls from the tables below, or as scripts generated with `tools/sessions/make-sessions.py`: write those before the sitting.
   - `session-2.json` p3 and `session-3.json` parts B–C ask the player to set piercings, eye colour, eye shape and hairstyle by hand. `cc_apply` can do all of those, so N5 and N6 do them through the bridge.
5. **Tell M:**
   - Use borderless windowed mode, with the game window in front.
   - Stand V in the apartment's living room facing the room. Framing worked there in the first session; in the bathroom the camera sat in the wall.
   - Open the creator with F12 there, if A10 shows that F12 opens the edit mode; otherwise use the mirror.
   - Make a new manual safety save before the first change, and load it at the end.

**Index convention.** Creator labels in the source asks (style 5, colour 24) are not always `cc_apply` indices. C reads each row with `player_appearance {option: …}` first and maps the label to its index. For vanilla `piercings`, style *N* is index *N*. For `eyes` (eye shape), label `01` is index 0 (`None`), `02` is `h011`, `10` is `h091` and `12` is `h111`. A capture is `capture_screenshot {region, name}` after a 1.5 s wait, unless stated otherwise.

## N1. Bridge autonomy and the Gloss verdicts

Setup: the standard setup. XF Eye Artistry is the session 2 build. Sources: [test card A1–A12](runtime-bridge-test-card.md#next-session-autonomy-checks-expression-checks-then-session-2-continued) and [experiment 020 step 5](../../experiments/020-session-2/README.md#test-card).

| # | Ask | Settles → unblocks | Drive | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 1.1 | A1–A3: build, photo mode by key, subject projection | The build is right; photo mode opens without M → no photo-mode key step in any later sitting | M: save, stand V. C: `bridge_info`, `game_status`, `photo_open`, `photo_subject` | 3 | JSON, including the raw `screen` block | Pass: commit `509f599`, `allow_writes`, photo mode opens by itself, `approximate: false`. Fail: `photo_open_timeout` means M presses the key; record it |
| 1.2 | A4–A7: light on, XF preset 7, `photo_frame`, cursor hidden | Photo-mode open questions 4–6 ([photo mode](../../knowledge/photo-mode.md#open-questions)) → no light, framing or cursor steps later | C: `photo_light_set {light:1,on:true,…}`, `photo_camera_set {camera_preset:7}`, `photo_frame` (face, eyes, head and shoulders), `photo_hud_hide` | 5 | Where light 1 appears relative to V and the camera; three framings | Pass: a warm light, the XF preset (1.8 m, FOV about 11), `converged: true` with the face filling its crop, no cursor. Fail: record the offsets and `cursor_controllers` |
| 1.3 | A8–A9: yaw sweep and still burst | The light sweep method used by every sweep below | C: `photo_frame {yaw_offset: ±15, ±30}`, `capture_burst {region:"eyes",frames:10}` | 2 | Four captures, contact sheet | Pass: V stays centred and the burst difference is near 0 |
| 1.4 | A10–A12: F12 mode, row label, Confirm | Photo-mode open question 2 → F12 anywhere replaces the mirror; `cc.open` design | M: `photo_exit` first, then F12. C: `game_wait`, `player_appearance {option:"XF"}`, `cc_apply {option:"XF",index:5}`, `cc_confirm` | 4 | `menu.updating_finalized_state`, `edit_mode`, `route` | Pass: edit mode is true, the row shows Gloss A, `kept: true`. Fail: F12 opened the new-game mode, so use the mirror from here on |
| 1.5 | Gloss A–D under a **controlled directional light** (020 step 5; carried from session 3, where the creator's soft light barely separated them and the photo-mode sweep was void) | Whether the written roughness is what the game shows → Matte, Satin, Glossy and Metallic defaults after alpha.2 ([decal reference §13](../materials/shader-decal.md#13-in-game-test-asks-batch-into-the-prepared-session)) | Photo mode with the bridge 0.4 light placed relative to V (session 3's light problem is fixed there), world time frozen, then `session-2.json` p1 per preset | 14 | Face captures at 0° and ±15°/±30° per preset under the same light | Pass: one of A–D reads as four distinct finishes (D expected). A and B alike means the roughness write isn't what shows. C still glossy means the shine comes from lights or reflections |

## N2. Finish close-out, headgear, kill switch

Continue from N1 in the same game. Sources: [experiment 020 steps 2–4 and 6–8](../../experiments/020-session-2/README.md#test-card), [A13](runtime-bridge-test-card.md#next-session-autonomy-checks-expression-checks-then-session-2-continued), [clothing ask 4](../../knowledge/clothing.md#in-game-test-asks) and the [kill switch](runtime-bridge-test-card.md#kill-switch-and-wrap-up).

| # | Ask | Settles → unblocks | Drive | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 2.6 | Headgear over XF makeup, on an alpha.2-built (`hx_`) export | Whether the `hx_xfs_c<key>_makeup` component hides with the head under ArchiveXL's `hide_Head`, as the source says ([pipeline guide](../authoring/studio-to-mod-pipeline.md#how-those-maps-become-game-resources)); and that a vanilla helmet covers it | Needs the `hx_` build staged (the session 2 build still has `xfs_c<key>_makeup` and is expected to float). **Vanilla helmet:** in the CET console, `Game.AddToInventory("Items.Helmet_01_basic_01", 1)`, then M equips it (or the bridge 0.4 `inventory_equip {item: "Items.Helmet_01_basic_01", add_if_missing: true}` with the inventory class approved; its P13). **`hide_Head` item:** no vanilla item has one (neither the 2.31 TweakDB nor the cooked visual-tag preset holds the string), so M picks an installed mod item whose `.app` lists `hide_Head` and adds it the same way with its record name, `Game.AddToInventory("Items.<record>", 1)`. C: `photo_open`, `photo_frame {target:"face"}`, capture each, `photo_exit` | 4 | Two captures, the mod item's record name | Pass: the makeup hides with the head under the mod item and stays covered, not clipping, under the helmet. Fail: it floats; record the item and whether ArchiveXL logged the tag |
| 2.7 | Kill switch with the cursor hidden (card 20–22) | Kill switch restores the cursor | C: `photo_open`, `photo_hud_hide`, `bridge_kill`. M: leave photo mode, load the safety save, quit | 3 | Log `RestoreAfterKill … "cursor_shown":true`; `bridge-phase2-post` capture | Pass: the menu and cursor return, and the save lock is kept until the load |

After N2, results go to [clothing](../../knowledge/clothing.md#open-questions) question 5 and the [pipeline guide](../authoring/studio-to-mod-pipeline.md#how-those-maps-become-game-resources); 1.5's Gloss verdict goes to [experiment 020](../../experiments/020-session-2/README.md) and [materials and shaders](../../knowledge/materials-and-shaders.md#in-game-test-asks) and sets the finish defaults after alpha.2.

## N3. Glitter board

The coordinator stages [experiment 021](../../experiments/021-glitter-board/README.md)'s candidate after N2, replacing the session 2 pair, and records the promotion receipt; M relaunches. Script: `session-3.json` part `a` ([session 3 Part A](../../experiments/022-session-3/README.md#part-a-glitter-board)). M opens the creator 7 times, switches the upscaler to DLAA and back, and answers the dark-scene and motion verdicts. Winterkissed is enabled, so step 9 can run: C `cc_apply` Golden Girl instead of M equipping it.

| # | Ask | Settles → unblocks | Min | Evidence | Pass / fail |
|---|---|---|---:|---|---|
| 3.1 | Steps 1–4: flake points, nested against box mips | Flake size and mip scheme → the Glitter export route ([Glitter in game](../../knowledge/glitter-in-game.md)) | 10 | Sweep and orbit captures, pull-back bursts | Pass: points switch on and off on the left lid, and nested mips keep them longer than box |
| 3.2 | Step 5: DLSS against DLAA | Whether the upscaler eats the finest stripe | 5 | Same framings in both modes | Record where points vanish |
| 3.3 | Steps 6–8: shine, tilt, accent, clearing | Decal open question 1 (`MaterialModifiersConsts[2].x` on a CCXL component) | 8 | Captures in normal light and in the dark; E → A → Off | Pass: accent points visible in the dark and none left after Off. "Accent absent" is itself the answer |
| 3.4 | Step 9: Winterkissed Golden Girl | A community reference at the same framings | 2 | Two captures | — |

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

This sitting is one creator visit, driven by `cc_apply` and captures, and is never confirmed; it ends with `cc_back`. XF stays Off. Record the Character Rendering Editor preset. Sources: [head CC rendering](../../knowledge/head-cc-rendering.md#in-game-test-asks), [shader-eye §12](../materials/shader-eye.md#12-in-game-test-asks-batch-into-the-prepared-session), [creator lighting](../../knowledge/creator-lighting.md#indirect-light-checks-same-session-four-short-steps), [face makeup](../../knowledge/face-makeup.md#in-game-test-asks), [tattoos](../../knowledge/tattoos.md#in-game-test-asks), [brows](../../knowledge/brows.md#in-game-test-asks), [parity §4.1](../authoring/game-parity-measurement.md#41-five-minutes-in-the-next-bridge-session) and [skin §10](../materials/shader-skin.md#10-in-game-test-asks-batch-into-the-prepared-session).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 5.1 | Parity E0–E2 | Identity check, creator camera and exposure → the parity tooling's first data | M confirms the settings (SDR, ReShade effects off, grain, aberration, depth of field, vignette, lens flare and motion blur off). C: `player_appearance`, `cc_apply` XF 0, `capture_burst` full ×12, then the hair page ×8 twice | 3 | Bursts | C0 identity agrees. Two identical hair-page bursts confirm fixed exposure |
| 5.2 | Head CC 8 and 1, skin 3: tone strength, warm ivory, neck seam | **`TintColor` encoding** (materials open question 11) for every `Color` parameter | `cc_apply` `skin_type` 1 with `skin_color` tones 1, 5, 2; `skin_type` 3 with tone 5; also `skin_type` 5 with tone 2 as N9's complexion baseline | 3 | Face and head-and-shoulders captures | Senna darkens mid skin by about a fifth: byte/255, the preview's reading holds. About two fifths: sRGB, change the preview. Warm ivory should look warmer and a little brighter than pale |
| 5.3 | Head CC 9 and Rebecca: iris gradient coordinate | Iris mask read raw or decoded, and with it every gamma-flagged mask, including the skin tint mask | `cc_apply` `eyes_color`: gradient red, light blue, brown, blood gradient red, then 54 (Rebecca) | 3 | `cc-eyes` captures | Raw (the preview's default holds): bright red-orange and mid sky blue irises, even Rebecca sclera. Decoded: near-black and slate irises, lopsided sclera |
| 5.4 | Head CC 10, first half: iris axis and orientation | Sign of the per-eye axis; texture-iris orientation | Light blue straight on; one graphic texture eye (options 62–71) | 2 | Eyes close-ups | Compare with the preview at 5° outward and 5° inward; the iris should be the same way up as in the preview |
| 5.5 | **High priority: run first in N5.** Head CC 14 and creator lighting 2: piercings and the heart eye | Colour mask (materials open question 10) and the preset's ambient; the silver piece's highlights also show the **key lights' colour** (Main_Face and the other lights that store none), which decides the lit skin's warmth question and gates the fill-strength refit ([skin §11.8](../materials/shader-skin.md#118-checks-and-measurements), [creator lighting §12.5](../../knowledge/creator-lighting.md#125-refitting-from-new-matched-captures)) | `cc_apply` `piercings` 9 and `piercings_color` black; style 1 in silver, then gold; `eyes_color` 24 | 3 | Face captures | Gold shows gold, not grey; black plastic keeps its colour; the heart is upright. Metal body between highlights under 10/255 keeps the ambient at 0. Record the silver highlight's colour at the face framing: neutral means the key lights are white and the skin's warmth lies in its albedo; cool means the unset light colour is not white |
| 5.6 | Decal order: head CC 3, tattoos 1, face makeup 2, brows 3 | Draw order within a priority → preview decal stacking | `makeupEyes` 5 black, `makeupCheeks` 10, `facial_tattoo` at both choice 2 and choice 8 (`facial_tattoo_02`; the two asks number it differently), brows 1 | 3 | Face and eyes captures | Record which draws on top at the lower lid, the cheekbone and the brow tail |
| 5.7 | Face makeup 3 and tattoos 5: strength anchors | Preview alpha clamp and tattoo opacity | Blush 5 against blush 1 in one colour; face tattoos 9 and 2 on tone 1 and a dark tone | 3 | Face captures | Record the strengths. Both tattoos should look partly transparent, with 2 slightly stronger |
| 5.8 | **Done in session 3 (D6): no world ambient.** Creator lighting 1: day against night | Whether world ambient reaches the creator box → the §11 environment | C: `cc_back`, `world_time_set` 12:00. M: F12. C: capture. Repeat at 00:00, then run the undo | 4 | Two face-page captures | Patches within 1/255: no world ambient reaches V. Brighter at noon: the sky's ambient reaches the box |
| 5.9 | Creator lighting 3: ray tracing off (only if RT is on) | Ray-traced self-bounce on metal | M: RT off in the settings, then F12. C: 5.5's silver frame. M: RT back on | 3 | One capture | Any difference is ray-traced |

## N6. Creator sweep B: rows, links, hair calibration, body, blink

Again one creator visit, never confirmed, ending with `cc_back`. Sources: [CC file chain](../../knowledge/cc-file-chain.md#in-game-test-asks), [brows](../../knowledge/brows.md#in-game-test-asks), [hair colour §6](../hair/hair-colour-authoring-feasibility.md#6-in-game-checklist), [creator lighting §8](../../knowledge/creator-lighting.md#8-capture-protocol), [shader-hair §13](../materials/shader-hair.md#13-in-game-test-asks-batch-into-the-prepared-session), [render coverage §7](../character-customization/render-coverage.md#7-in-game-checks-for-the-drawn-groups), [body](../../knowledge/body-rendering.md#in-game-test-asks), [facial animation](../../knowledge/facial-animation.md#in-game-test-asks) and [session 3 Parts B–C](../../experiments/022-session-3/README.md#part-b-blink).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 6.1 | CC file chain 9: visible choice counts | Which choices the creator shows → catalogue counts | `player_appearance` for eye makeup, lips (each finish), cheeks, face cyberware and facial tattoos | 1 | JSON | Record the counts; the resources list 36/38/24/16/15 and the wiki 20/20/14/8/11 |
| 6.2 | CC file chain 1: link propagation | Link rule for tone followers | `skin_color` 3, `skin_type` 1 → 5, `facial_tattoo` 6 | 2 | Full-window captures (face and hands) | Every follower keeps tone 3 |
| 6.3 | CC file chain 2 and 8: lip finish tree; EP1 colour carry-over | Switcher state rules | `makeupLips` 8 colour 6, finish regular → glossy → matte → none → glossy; eye makeup 5 teal → 25; `player_appearance` after each | 2 | JSON | Style and colour survive the finish switch; record whether teal carries over (possibly not) |
| 6.4 | CC file chain 11 and session 3 C5: linked hairstyle | Switcher member mapping (CORE-61) | `hairstyle` 5, then a face cyberware that swaps to `hairstyle_cyberware` | 2 | Two captures and JSON | Same hair: the Studio's rule holds. Same position with different hair: change the rule |
| 6.5 | Brows 1: brow colour against hair colour | Brow and hair colour independence | Hair `brown_liquorice`, brows `blonde_platinum`, hair `black_carbon` | 1 | Eyes captures | Brows unchanged |
| 6.6 | Hair colour 6: bald style, brows Off | Side effect of exact-slot overlays | The bald hairstyle; brows Off. M glances at whether a colour grid shows | 1 | Full-window captures | Record it |
| 6.7 | **Mostly done in session 3 (D5); still to take: the lash frame and the hairstyle 1 and 5 frames** ([hair shading §8](../../knowledge/hair-shading.md#creator-ladder-session-3)). Calibration frames (creator lighting §8 frames 1–4, shader-hair 4, head CC 5, head CC 7 baseline) | The preset's `k`, exposure and hair bake chain (status "waiting on the maintainer" item 4); baselines for N9 | M: Character Rendering Editor to "Vanilla" in CET first. C: hair page on arrival; brows, lashes and skin pages; ladder `38_ash_brown`, `39_ash_grey`, `74_steel_smoke`, `66_platinum_blonde` on the `lm097_hair` style; lashes `05_brown_liquorice`; hairstyle 1 brown liquorice and 5 blonde platinum. M: back to the usual preset; C: one repeat frame | 8 | PNG captures plus bursts; settings noted | Ladder ratios against the [bake table](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request): 3.1/4.2/6.6 means the decoded bake holds. Lashes (59, 28, 0) means Alliekat wins; (172, 130, 15) means the base game wins |
| 6.8 | Teeth, choices 0–4 (render coverage, new) | Teeth colour and metal against the preview | `cc_apply` `teeth` 0–4 | 2 | `face` captures | **Comparison waits for the teeth slot** (the head-completeness track); the captures can be taken now |
| 6.9 | Body 2 and 3: underwear at the largest breast size; idle arms | Body open question 2; the rigid helpers | Body page: the breast option at its largest. Shoulder and wrist through `capture_screenshot` full plus `capture_recrop` | 3 | Captures | Underwear coverage as in the preview |
| 6.10 | Facial animation 1–3 (session 3 B1–B3): blink closure, lashes, makeup on closed lids | Per-shape eye seat against the base centre (`h011`) | `cc_apply {option:"eyes"}` 0, 9, 11, 1; per shape a `capture_burst {region:"cc-eyes",frames:40,interval_ms:100}` to catch a blink; then shape 12 with an XF upper-lid look | 5 | Contact sheets | No eye visible between the lids; lashes on the lid line; no bare skin between crease and lashes |

## N7. Photo mode: expressions, parity, eye and skin light

Use photo mode throughout, with XF Off. Sources: [expression checks R1 and R2](runtime-bridge-test-card.md#expression-checks-r1-and-r2), [parity §4.1](../authoring/game-parity-measurement.md#41-five-minutes-in-the-next-bridge-session), [head CC 10–12](../../knowledge/head-cc-rendering.md#in-game-test-asks) and [skin §10](../materials/shader-skin.md#10-in-game-test-asks-batch-into-the-prepared-session).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 7.1 | R1a–R1b: `face_rig_read` on the head item and the puppet | Which facial setup, graph and sets are live (question D1) → expression export target | `face_rig_read {}`, `{target:"puppet"}` | 2 | Full JSON | `face_rig` found on the head item with its hashes and sets |
| 7.2 | R2a–R2g: faceId against index | Whether faceId is the table index, which entity takes it and whether it holds → R3–R5 designs | Card sequence (`photo_state`, `photo_expression_set`, `photo_expression_index` ×4, undo) | 8 | Captures `r2-*`; log `photo face index` | Sleeping at 60, then Skeptical at 56, holding for 5 s. Record which target worked |
| 7.3 | Parity E4–E7 | Photo-mode camera reconstruction and light position (photo-mode open question 5) | `world_time_set` 02:00, `photo_open`, `photo_hud_hide`, `photo_camera_set {grain:0,…}`, `photo_frame`, `photo_subject`, light off/on, yaw −30/0/+30, eyes framing | 5 | Captures with `photo_subject` JSON | Frames arrive with their readings; analysed offline (C1, C5, C7) |
| 7.4 | Head CC 12 and the second half of 10: cornea against iris; iris depth from the side | Catch-light size and a matte iris; parallax | Eyes framing, light 1 on, `yaw_offset` −30…30, then 45 | 3 | Captures | Catch light stays sharp and small; the iris darkens smoothly; the iris sits under the cornea |
| 7.5 | Head CC 11: wetness shell (**partial**) | Tear-line highlight | Yaw frames only: the ask needs the light moved from above the head to below the chin, which the bridge can't do (suggestion B5) | 1 | Captures | Corners darker than mid-sclera; the vertical half stays open |
| 7.6 | Skin 4: scatter width and quality | Parity fit of the skin reference §11.6; 11 against 25 samples | Raking light (yaw ±60) at face framing. M: SSS quality Low in the settings. C: repeat. M: High. C: repeat at twice the distance | 6 | Captures; record the upscaler, RT mode and SSS quality | An identical Low/High pair suggests the stochastic blur |
| 7.7 | Skin 1 and materials 5: back-lit ear | Whether the translucency variant runs | `photo_frame` with `yaw_offset` 150 and 165 (Photo Mode Ex clamps to ±180), light 1 on. Depends on where 1.2 found the light | 2 | Ear crops | Red transmission at the rim means translucency runs |
| 7.8 | Skin 2: closed-mouth parting line | Whether the preview's line is real | Face framing, neutral expression, yaw sweep; mouth crops through `capture_recrop` | 2 | Crops | Record whether any bright line shows |

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
| 9.4 | Skin type 5, tone 2 | Complexion replacer over base albedo | Against 5.2's frame | 1 | A visible change confirms it |
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

**Candidate (C, before the sitting).** In the Studio, a set **"XF session test"** built **For my game** on the test profile's route, holding in this order: (a) **"Happy copy"**, started from the game's `facial_happy` and saved unchanged; (b) **"Happy, jaw open"**, the same with Jaw open at 40 %; (c) the five Natural samples. Record the Build's archive SHA-256, the indices (the Mega Pack's 217 rows put them at 217–223) and the Studio's own renders of (a), (b) and Warm smile at face framing. **M, MO2 closed:** Show in folder, then add its `archive` and `r6` folders as one new MO2 mod "XF Expressions - XF session test" in the test profile only, enabled. Nothing else changes. Note the installed ArchiveXL and TweakXL versions (the files are written for ArchiveXL 1.27.3 and TweakXL 1.11.4 or later).

| # | Ask | Settles → unblocks | Drive (C unless stated) | Min | Evidence | Pass / fail |
|---|---|---|---|---:|---|---|
| 11.1 | Load lines | The patch and records load | After launch: ArchiveXL log lines naming `xfs_expressions_x…` added to both `h0_000_p?a__basehead__face_rig_photomode` appearances; TweakXL log free of errors for the XF file | 2 | Both logs | Both lines present, no TweakXL error. Missing ArchiveXL line: the patch route failed (R3 territory) |
| 11.2 | Listed | Records and `faceAnimations` | `photo_open`, `photo_state {options: true}` | 2 | Key 28's option JSON | Seven new entries after the Mega Pack's, labelled as saved, `faceId` 217–223 |
| 11.3 | R4: plays as the preview | The clip format and attachment; preview parity | Look-at off (`photo_camera_set {look_at: 0}`), `photo_frame {target: "face"}`, HUD hidden; for (a), (b), Warm smile: `photo_expression_set {faceId}`, wait 2 s, capture; then vanilla Happy (faceId 7), capture | 8 | Captures `n11-*` beside the Studio renders | (a) matches vanilla Happy; (b) differs only by the open jaw; Warm smile resembles the Studio's render (wrinkles aside). A neutral face means the clip wasn't found (the set isn't on the live face rig); no change at all means the row or record is wrong |
| 11.4 | R5: beside the Mega Pack | The superset table | `photo_expression_set` "Static: Sleeping" (60) and one of the pack's animated faces; capture | 3 | Captures | Both play as before the XF mod was added |
| 11.5 | Cycle and hold | Cross-fade and hold with XF clips | Select (c)'s five in turn, then back to (a); wait 5 s on the last | 3 | Captures | Each changes with the usual 1 s blend and holds |

Afterwards M disables the test mod (MO2 closed). Results go to the expression editor design (R4, R5) and [facial expressions](../../knowledge/facial-expressions.md#open-questions) (questions 3 and 4).

## N12. Masculine V: XF Eye Artistry for him

The first in-game test of the masculine selector ([male V plan §6](../character-customization/male-v-plan.md#6-in-game-checks-worth-batching), [pipeline: the masculine V's selector](../authoring/studio-to-mod-pipeline.md#the-masculine-vs-selector)). Everything in it is offline-verified only: his plate is the audited cut of the 2.31 male head, lifted 0.4 mm like hers; his selector is option index 541 in the masculine creator; the textures are hers. It also carries the creator-row and mirror asks that need a new-game start ([blocked list](#blocked-or-not-ready)).

**What M provides.** A **masculine V made in a new game** (body gender masculine, any voice), saved in the creator's last step or just after it, and kept. None of the 165 reference saves is masculine. For 7 below, a second throwaway masculine V with the **feminine** voice. The reference feminine save for 3.

**Candidate (C, before the sitting).** Build a both-body XF Eye Artistry from one collection with two presets: **"N12 Matte liner"** (one Matte upper-lid liner, black, crisp) and **"N12 Metal lid"** (one Metallic lid wash to the crease). Check first: its result must hold no "This mod is for a feminine V only" note, and the manifest's feature `details.bodies` must be `["female", "male"]`. Record the archive and `.archive.xl` SHA-256, the masculine plate's mesh and morph SHA-256 (`details.masculinePlate`) and the Studio's renders of both presets on the Default V (masculine) and on the reference feminine V at the creator's eye framing. Then **M, MO2 closed**: **Add to my mod manager** into the test profile, replacing the staged alpha.2 export (one XF Eye Artistry at a time; two would add two rows). Note the installed game, ArchiveXL and TweakXL versions: the build is written for game 2.31 and ArchiveXL 1.27.3. Nothing else changes.

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

## Blocked or not ready

| Ask | Source | Blocked on |
|---|---|---|
| Teeth comparison (6.8) | [Render coverage](../character-customization/render-coverage.md#7-in-game-checks-for-the-drawn-groups) | The **teeth slot** (head-completeness track, running). The captures can be taken now |
| Hair in ambient light in the preview (compare 8.4) | [Shader-hair §11](../materials/shader-hair.md) | The **hair bake and ambient** work in the same head-completeness track. The game captures can be taken now |
| "Add to my mod manager" hands-on test (a Studio test, not in game) | [Code health INSTALL-01](../authoring/code-health.md) | The **install fix** (cleanup-install track, running). Until it lands, nobody presses Add |
| Glitter board (N3) | [Experiment 021](../../experiments/021-glitter-board/README.md) | Restage after N2's verdicts |
| XF Piercings Probe (N4) | [Experiment 024](../../experiments/024-ccxl-piercings/README.md#staging) | Enabling the mod (MO2 closed) |
| Legacy makeup rows Off; legacy layers in head CC 13 | [CC file chain 12](../../knowledge/cc-file-chain.md#in-game-test-asks), [session 3 C4](../../experiments/022-session-3/README.md#part-c-creator-and-piercings) | The legacy build is disabled in the test profile (enabling it adds a second selector). Needs a decision: a separate profile, or drop the ask |
| Creator rows in a new game; creator against the mirror | [CC file chain 10](../../knowledge/cc-file-chain.md#in-game-test-asks), [creator lighting 4](../../knowledge/creator-lighting.md#indirect-light-checks-same-session-four-short-steps) | A new-game start (the bridge doesn't drive the new-game creator). Run them in [N12](#n12-masculine-v-xf-eye-artistry-for-him)'s new-game creator, before 12.2 |
| Brow and cheek build asks; the hair colour probe (items 1–5, 7–9, 11–13) | [Brow editor §7](../brows/brow-editor-design.md#7-open-facts-and-runtime-test-asks), [brows and cheeks brief](../backlog/brows-and-cheeks-brief.md#runtime-questions-to-batch-into-a-future-session), [hair colour §6](../hair/hair-colour-authoring-feasibility.md#6-in-game-checklist) | Their builds (not started; brows, cheeks and hair colour are awaiting discussion) |
| Expressions R3; R1 without the Mega Pack; R6–R8 | [Expression editor §8](../animation/expression-editor-design.md#8-runtime-questions-r1r5-through-the-bridge), [expressions brief](../backlog/expressions-and-idles-brief.md#runtime-questions-for-one-batched-session) | A test archive (R3; export no longer needs it) and a throwaway profile. R4–R5 are now [N11](#n11-xf-expressions-set-in-photo-mode-r4r5). Session 3 Part D's CET lines are superseded by 7.1–7.2; keep them only as a fallback |
| CET hair-option dump | [Shader-hair 1](../materials/shader-hair.md#13-in-game-test-asks-batch-into-the-prepared-session) | Runnable now by M pasting into the CET console (2 min, add to N6 6.7), or by the bridge (suggestion B6) |
| Mod-against-mod order | [Mod loading 2](../../knowledge/mod-loading.md#in-game-test-asks) | A throwaway MO2 profile with a copied PRC archive; low value |
| Steam, Epic and Vortex detection | [Mod loading 3](../../knowledge/mod-loading.md#in-game-test-asks), [Vortex](../../knowledge/vortex.md#test-asks) | Community testers, not the maintainer |
| Debug views of the plate | [Materials 6](../../knowledge/materials-and-shaders.md#in-game-test-asks) | No debug-view toggle found yet |

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
