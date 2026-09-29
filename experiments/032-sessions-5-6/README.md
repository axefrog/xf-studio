# Sessions 5 and 6: bridge 0.5.1 and 0.5.2 checks, XF Finish Showroom, finish close-ups

**Status:** run on 29 September 2026 through the runtime bridge, session 5 on bridge 0.5.1 and, about two hours later after a restage, session 6 on bridge 0.5.2. The coordinator drove the bridge; the maintainer was at the game, loaded saves, answered the judgement rows and lit the Shimmer and Glitter heads by hand for the final verdicts. Session 5 ran the test card's [session-5 checks](../../research/runtime/runtime-bridge-test-card.md#session-5-checks-bridge-051) (S1–S15) and [finish showroom checks](../../research/runtime/runtime-bridge-test-card.md#finish-showroom-checks-bridge-050) (plan N14); session 6 ran the [session-6 checks](../../research/runtime/runtime-bridge-test-card.md#session-6-checks-bridge-052) (T1–T9) and a set of showroom close-ups that gave the finish verdicts. Structure follows [session 4](../029-session-4/README.md).

**Evidence.** Private and ignored, never committed: the notes with the verdicts word for word and the full bridge logs with every JSON answer (`local/sessions/2026-09-29-session-5/` and `local/sessions/2026-09-29-session-6/`), and the 324 capture files (full frames, crops and JSON sidecars) copied to their canonical home `experiments/032-sessions-5-6/generated/captures/`, with the contact sheets in `generated/sheets/s5/` and `generated/sheets/s6/`. This page names captures by capture name only (`s6-close-gloss-a--as-before-01` is `<timestamp>-s6-close-gloss-a--as-before-01.full.png`) and sheets by file name.

**Grades.** **Pass** and **Fail** answer the step's own criterion. **Partial** means part of the criterion held. **Inconclusive** means the step ran but can't answer. Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[runtime]** seen in the game, **[offline]** measured from captures or our own tools, **[hypothesis]** not established.

## 1. Setup

| Item | Session 5 | Session 6 |
|---|---|---|
| Game | 2.31 (product 2.3.1, file 3.0.80.51928), borderless window 3840 × 1600, captures by `printwindow` | Same |
| Bridge | **0.5.1 `-writes`**, build commit `d15b4fdbeeb19de4c62937ff4c92fb6cc84f941b` (not dirty); write classes photo, world, character, inventory, save and showroom | **0.5.2 `-writes` with inventory**, build commit `7b9c8647894f1fe66896bd84c5716f10c8b71d34` (not dirty); the same six write classes ([build record](../../research/runtime/runtime-bridge-test-card.md#build-record-bridge-052-branch-build-not-staged)) |
| MO2 profile | The dedicated test profile, with **Ultra+, Thread Locker and Hide Body Parts - Body Toggles disabled** (session 4's confounders) | The same, plus the maintainer's changes after session 5 (below) and **Character Customization Anywhere disabled** for T8 |
| XF Finish Showroom | The two 0.5.0 archives: session 2's collection (`xfs_showroom_4426018f…`, 12 heads) and the Glitter board (`xfs_showroom_d11f5a7f…`, 6 heads), built at `d5c9e34` ([build record](../../research/runtime/runtime-bridge-test-card.md#build-record-bridge-050-and-xf-finish-showroom-branch-build-not-staged)); both carry the Shimmer grain | Rebuilt from the 0.5.2 commit for the seated pedestal, as the card asked; same archive names. Their hashes are not in the session notes |
| Codeware | Present (`showroom.state` answered `codeware: true`); version not recorded in the session | Same |
| XF Eye Artistry on V | Selector `xfs_c0200a5e52e554c029d0b0000000000d0`, session 2's collection. The save started with the XF row Off; F2 put Gloss A on V | Same selector |
| Photo-mode lighting | Photo mode's lights off; the showroom's key or creator rig | The showroom's creator rig for the close-ups; for the Shimmer and Glitter verdicts the maintainer lit the heads by hand with CharLi's photo-mode lights, the showroom rig off |

**The maintainer's profile changes after session 5** (while investigating the hidden helmet), all disabled in the test profile: Immersive Third Person - True Camera-Oriented Controls; Immersive Third Person - Best Of Both Worlds; Shattered Chrome; Chrome Plating; Street Sense; Flesh And Chrome; Hot-Sampled Photomode Renders (IGPT); Sun Moon And Stars Tattoo. The modlist after these changes is backed up privately under `local/mo2-backups/`.

**Not recorded, so unknown:** whether V's XF Eye Artistry was rebuilt from the showroom's commit as the card asked, or was still session 2's diagnostic build (the selector key is the collection's, the same either way); and whether Character Customization Anywhere was re-enabled after session 6. If V still wore the older compile, a small difference between V's Gloss A and the head's can't be ruled out; the fidelity verdict (F8) found them a match regardless.

## 2. Run order

**Session 5:** S1–S3 (focus), S4–S8 (framing and light), S9 (photo mode's clock), S10 (expressions), S11–S15 (the creator from the street), F1–F8 (showroom fidelity), L1–L3 (lineup and close-ups), A13 (helmet), K1 (kill switch), K2 (load with a head spawned: the crash).

**Session 6:** T1 (load with a head, the crash fix), T2 (pacing), T3 (face table), T4 (exposure), T5 (camera placement), T6 (head height and pedestal), the finish close-ups and hand-lit verdicts, T7 (helmet through the wardrobe), T8 (creator without CCA), T9 (wardrobe undo and kill switch).

## 3. Session 5 results

### 3.1 Bridge checks (S1–S15)

| # | Result | Grade |
|---|---|---|
| S1 | `photo.open` with the game in front opened photo mode; the answer said `focus: "require"`, `focused_by_bridge: false` | Pass |
| S2 | With the maintainer typing in another window, `photo.open` was refused `not_foreground`; nothing reached the game | Pass |
| S3 | `photo.open {route: "postmessage"}` with another window in front → `photo_open_timeout`: **keys posted to a background window don't reach the game.** The maintainer observed that every other command works with the game in the background; only opening photo mode needs it in front | Fail (the route); answered |
| S4 | Drift sweep, yaw 35/55/0 three times: 9 frames, all converged and identical (portrait lens about 9°, about 2.26 m, facing within 0.1°), no drift. The first try, without `xf_preset`, was refused `framing_bound` (the field of view needed, 3.53°, below the lens's 4° floor) with `restored: true`; back-to-back frames then hit `rate_limited`, and the camera restore itself was rate-limited (bug B1, §6) (`s5-S5-*` sheet `s5-s7-s8.png`) | Pass (after `xf_preset`) |
| S5 | Portrait 9.1°, wide 57.9° at 0.33 m, eyes 5.1°, each converged (`s5-S5-portrait`, `s5-S5-wide`, `s5-S5-eyes`) | Pass |
| S6 | The wide lens with a 2 m span converged, so there was no refusal to test; S4's accidental refusal had already shown the refusal-and-restore path | Inconclusive (repeated as T2) |
| S7 | Yaw 180, 150 and −150 converged, V facing within 1°; photo-mode key 7 runs −180 to 180 (`s5-S7-yaw180`, `s5-S7-yaw150`, `s5-S7-yaw-150`) | Pass |
| S8 | At yaw offset 90, a light at azimuth 90 lit the face the camera sees, −90 the far side: the placement frame is V's (`s5-S8-az90`, `s5-S8-az-90`) | Pass |
| S9 | Photo mode's time set to 02:00 (`route: "photo_time"`, undo target `photo`) (`s5-S9-2am`, `s5-S9-undone`). The world clock moved only by elapsed time (706051 → 706544 → 706555 s), so photo mode gives the world's clock back on exit; the replayed undo after exit answered `changed: false` | Pass |
| S10 | `photo.expression.set {label: "static sleeping"}` chose Static: Sleeping (menu value 56); the head target was refused `no_effect`. **In game, `photo.state`'s expression options carried no `table_index` at all** (only `data` and `text`), so `photo.expression.index {index: 60}` was refused as unlisted; with `unlisted: true`, index 60 was Sleeping (`s5-S10-sleeping-label`, `s5-S10-index60`, `s5-S10-index60-unlisted`). The enrichment worked only in the self-test (bug B2, §6) | Partial (fixed in 0.5.2; T3 Pass) |
| S11 | `cc.open {edit_mode: "new_game"}` from the megabuilding corridor, away from any mirror: `route: "pause_menu"`, the creator fully drawn, `edit_mode` NewGame, `busy` false (`s5-S11-creator`) | Pass |
| S12 | `cc.back` closed cleanly; the maintainer's Esc then opened the ordinary pause menu. `cc.open {}` (the default HairDresser tag) **also opened fully**, and the menu reported **NewGame** anyway: its `player.appearance` listed the same 860 editable options of 1,209 as S11's, skin tone and face shape included, which a HairDresser edit wouldn't allow (`s5-S12-creator-default`). **Through the pause-menu route the game ignores the edit tag.** So session 4's stuck creator was caused by the old idle-scenario route, not the edit mode | Pass |
| S13 | `player.appearance` in gameplay kept `last_creator_reading` (age 21.5 s) | Pass |
| S14 | `cc.apply` by label: "valby curtain bob" → 217 VALBY CURTAIN BOB, "long pak 011" → 142; no `stale_match` (`s5-S14-valby`) | Pass |
| S15 | `makeupLips_08` was refused, naming the row in use (`makeupLips_glossy_08`) and the slot `makeupLips_color`; `expect_option: "makeupLips_08"` → `stale_match`; `makeupLips_color` alone changed the colour 5 → 6 (red → violet, 14 colours on that row) (`s5-S15-lips`) | Pass |

The maintainer asked the bridge to **subsume Character Customization Anywhere fully**; `cc.open` already used neither F12 nor CCA, and session 6's T8 proved it with CCA disabled.

### 3.2 XF Finish Showroom (N14)

| # | Result | Grade |
|---|---|---|
| F1 | `showroom.state` answered `codeware: true` | Pass |
| F2 | Gloss A · as before applied to V by label and confirmed | Pass |
| F3 | In normal play the head spawned 1.5 m in front of V, facing her, with eyes, lashes and makeup (`f3.txt`'s answer: `placed` 1, `pending` 0). **Flaw:** the head floated above its pedestal, a visible gap under the neck | Pass, with the gap recorded |
| F4 | Spawned in photo mode beside V (anchor camera, lateral 0.6 m); it looked slightly larger than V's head | Pass |
| F5–F7 | The shared key light, the creator rig on each in turn, and the five-frame sweep captured (`s5-F5-key`, `s5-F6-creator-v`, `s5-F6-creator-head`, `s5-F7-fidelity-sweep-01`…`05`; sheet `fidelity.png`) | Captured |
| **F8** | **The maintainer: "you pretty well nailed the mannequin head's materials."** The showroom head is a fair stand-in for V, so finish verdicts can come from it | **Pass** |
| L1 | Nine heads at 1.6 m didn't fit the frame; at 2.8 m with the camera pushed back they fit (`s5-L1-lineup`) | Fail at the card's distance |
| L2 | The key light was too dark to judge the lineup (the maintainer: "not sure what you hope to gauge"), and the camera looked at the pedestals (`s5-L2-lineup-key`, `s5-L2b-lineup-key`, `s5-L2-lineup-sweep-01`…`09`). The bridge could set neither photo mode's exposure nor the camera's position: `up_down` moves V, not the camera (`s5-L2c-*`, `s5-L2d-*`, `s5-L2e-*`; sheets `l2d.png`, `l2e.png`). A row of three beside V at V's distance under the `creator_face` rig worked: three heads visible and lit (`s5-L2f`, sheet `l2f.png`) | Inconclusive |
| L3 | Heads spawned 1.3 m in front of the camera stood below its eye line, so the close-ups showed their crowns (`s5-L3-*`, two passes; sheet `l3-closeups.png`). The maintainer: "why don't you just raise the mannequin heads" → `height_m`, defaulting to the camera's eye line (0.5.2) | Fail (framing) |
| L4 | — | Not run |
| K1 | `bridge.kill` removed the head and the pedestal; Reconnect worked (`s5-K1-before`, `s5-K1-after`; sheet `k1.png`) | Pass |
| K2 | `game.load {latest: true}` with a head spawned **crashed the game** (§5) | Fail (fixed in 0.5.2; T1 Pass) |

### 3.3 Headgear (A13)

`inventory.equip Items.Helmet_01_basic_01` with `add_if_missing` put the helmet into the Head slot (`added`, `equipped`), but it didn't draw on V in photo mode, with Thread Locker off this time (`s5-A13-helmet-yaw0`, `s5-A13-helmet-yaw30`; sheet `a13.png`). **Inconclusive again.** After the session the maintainer found that **the helmet draws when equipped from the wardrobe screen**: an active outfit overrides what the slots show. That became 0.5.2's wardrobe commands and T7.

## 4. Session 6 results

### 4.1 Bridge checks (T1–T9)

| # | Result | Grade |
|---|---|---|
| T1 | A showroom head spawned, then `game.load {latest: true}`: six `game.status` polls during the load were answered `phase: "loading"`, `answered_by: "plugin"`, with the script layer gate closed; `game.wait` reached gameplay in 5.6 s; **no crash**; no showroom pieces after the load (K2's cleanup question answered too). The second load, without a head, wasn't run | Pass |
| T2 | Nine back-to-back frames: no `rate_limited`. The eyes framing with the wide lens and a 2 m span was refused `framing_bound` with every field put back (`restored: true`) | Pass |
| T3 | `face_table` listed 210, readable 210, `source: "names"`. Verified by label: Sleeping 56 → 60, Skeptical 52 → 56, Glee 207 → 217, the cheek-check pair 208/209 → 218/219; `photo.expression.index {index: 60}` applied by label, eyes closed (`s6-T3-index60`; sheet `t3.png`) | Pass |
| T4 | `photo.camera.set {exposure: 1}` (key 10, applied 0.99) raised the frame's mean luminance from 18.5 to 34.1; the undo put exposure 0 back; exposure 3 was refused `bad_params` (`s6-T4-exp1`, `s6-T4-exp-undo`) | Pass |
| T5 | `photo.camera.place` at a head and then at V: `held: false` both times (`off_m` 1.3 and 1.165); photo mode puts its camera back itself. The preset-rewrite route is next (`s6-T5-piece`, `s6-T5-v`; sheet `t5.png`) | Fail (research answer: direct placement doesn't hold) |
| T6 | **The neck now sits in its pedestal, with no gap.** The default height (`height_from: "camera"`) put the head's eyes at 2.074 m above its base, about 0.18 m too high: the frame showed the neck (`s6-T6-beside`, `s6-T6-front`). At 1.3 m in front of the camera, 1.75 was too low, 1.6 off-frame and **1.9 correct** (`s6-T6-h1.75`, `s6-T6-h1.6`, `s6-T6-h1.9`; sheets `t6.png`, `t6b.png`, `t6c.png`). The default probably counts the eye offset twice (bug B4, §6) | Partial: pedestal Pass, default height Fail |
| T7 | `wardrobe.state` answered `active: true`, `set: 0`, `sets: []`, and every area hidden with an empty `outfit_item`: a blank outfit, which is why equipped gear never drew. `inventory.equip` answered `hidden_by_outfit: true`, but `wardrobe.equip {item}` was refused `no_active_outfit`, contradicting that state. `wardrobe.equip {area: "Head", show: "equipped"}` answered `changed: true` (`shown: false` within its wait), after which the state showed Head `shows: "outfit"`, `hidden: false`, and the helmet still didn't draw in photo mode (`s6-T7-helmet-front`, `s6-T7-helmet-35`; sheet `t7.png`). The A13 half (XF makeup under the helmet) couldn't run | Fail (bugs B5, B6, §6) |
| T8 | With Character Customization Anywhere disabled, `cc.open {edit_mode: "new_game"}` and `cc.open {}` both opened fully (`route: "pause_menu"`, NewGame, `busy` false), and `cc.back` returned to gameplay cleanly each time (`s6-T8-open1`, `s6-T8-open2`). **`cc.open` needs no CCA** | Pass |
| T9 | The wardrobe undo didn't restore exactly: Head went from `hidden: true`, `shows: "hidden"` to `hidden: false`, `shows: "outfit"` (`t9-state-after.txt`). The helmet was unequipped and removed; `bridge.kill` ran. Whether its log line carried `wardrobe_restored` wasn't checked before the maintainer reconnected and loaded the latest save | Partial (fail on the exact undo; bug B7, §6) |

### 4.2 Finish close-ups in the showroom

With T6's height (1.9 m, 1.3 m from the camera), one head at a time under the showroom's creator rig, swept to −30°, 0° and +30° (`s6-close-gloss-a--as-before-01`…`03`, `s6-close-gloss-c--all-rough-01`…`03`, `s6-close-shimmer--strong-01`…`03`, `s6-close-glitter-a--base-01`…`03`; sheet `finish-closeups.png`). What the frames show [runtime]:

- **Gloss A (wet streaks) and Gloss C (flat) now separate clearly**, the question session 4 couldn't answer at face framing. Gloss B and D weren't close-upped.
- **Shimmer · strong** (the grain build, *shimmer-grain-1*) shows a pearly sheen with a pink-white glint and **no dot grid**: session 4's oversized dots are gone.
- **Glitter A · base** (the Glitter board's candidate A) shows a fine sparkle grain.

The coordinator's reading of the frames was not the verdict. The maintainer then judged Shimmer and Glitter with the heads unlit by the showroom rig, lighting them by hand with CharLi's photo-mode lights.

### 4.3 Finish verdicts (the maintainer's words)

| Finish | Verdict | Grade |
|---|---|---|
| **Gloss A against Gloss C** | Separate clearly at the close-up framing: A reads wet with streaked highlights, C flat | Pass: roughness separates finishes at a framing that resolves the lid |
| **Shimmer · strong (shimmer-grain-1)** | "reads more like a glossy vinyl than a shimmer." The maintainer suggests a highly speckled normal distribution (fine white noise), and taking inspiration from a Studio glitter preset that was close to what shimmer should look like | **Fail** |
| **Glitter A · base (the board)** | Three hand-lit close-ups: "doesn't seem much like glitter. The flecks just look printed on top of the purple base and don't have any significant light response the way glitter does... some variance... very limited." The maintainer suggests layering, and a strategic distribution of randomised normals for metallic flecks. **The Studio's glitter preview is much better** (not every model: the maintainer's "Glitterati" preset uses a good one, and a couple of others also look good) | **Fail** |

**Diagnosis of Shimmer** [offline, from the build's values]: the uniform covered surface (roughness 0.32, metalness 0.3) dominates the sparse grain (0.4 × density), so the lid reads as one glossy sheet. **Direction agreed in conversation:** a dense speckle on almost every texel, each tilt above the decal shader's normal fade (about 11.5°), a rougher satin base between specks and glossy or metallic specks, modelled on the Studio glitter model the maintainer liked, finer and denser.

**Glitter direction:** reproduce the Studio's good glitter models in the export; keep flake tilts above the ~11.5° fade; per-fleck metalness and roughness; layering over the base; read the Glitterati preset's model and settings (read only) as the target.

**Working physical definitions** agreed in conversation: **shimmer** is dense, fine pearl platelets lying mostly flat (a coherent sliding sheen, faint pinpoints, an interference tint); **glitter** is sparse, larger flakes at random angles (distinct flashes).

**Studio UX found on the way:** the good glitter models are hidden behind "Show research tools", and the default visible model (classic) is the weakest. The Glitter rework makes the good models the visible default; the classic macro dots become the [banked Pattern finish](../../research/backlog/README.md#banked-pattern-finish-an-xf-original-makeup-finish-29-september-2026-waits-until-the-current-product-reaches-10).

**The normal fade.** The maintainer asked where the ~11.5° normal fade lives, whether it can change, and whether a change can be isolated. The answer given, from offline analysis [offline; not seen in game]: it is in the decal mode's shader. The isolated route is another material template for our own plate (a candidate is car paint's metallic flake layer); a global shader change would touch every decal; the deeper routes are per-material constant hooks and custom shaders, queued as the [custom shader R&D](../../research/backlog/README.md#queued-rd-custom-material-shaders-in-redengine-29-september-2026).

These verdicts are handed to the finishes rework, which owns the Shimmer and Glitter designs ([finish designs](../../research/materials/finish-designs/README.md), [Glitter in game](../../knowledge/glitter-in-game.md)).

## 5. The load crash and its fix

**What happened** [runtime] (session 5, K2): with a showroom head spawned, `game.load {latest: true}` asked the game to load and returned. The bridge log shows `XFBridgeSystem.OnDetach` at 07:03:12.143, then `game.wait`'s queued `game.status` running the script call `XFBridgeActions.Status` at 07:03:12.268, then the crash on the main thread: `EXCEPTION_ACCESS_VIOLATION` reading `0x48` at `Cyberpunk2077.exe+0x28b9b75` (report `…-20260929-070312-…`). The most likely cause: a script call after the scripting layer detached for the load; the spawned head may be incidental.

**The fix** (bridge 0.5.2, RB-76): the redscript layer reports attach, player attach and detach to the plugin; the gate closes the moment `game.load` asks for a load; every script call is refused `game_loading` while it is closed; and `game.status` answers from the plugin's side during a load.

**Retest** [runtime] (session 6, T1): the same load with a head spawned, six status polls during it answered by the plugin, gameplay after 5.6 s, **no crash**. The mechanism and the rule for native plugins are on [game crashes §2.3](../../knowledge/game-crashes.md#23-calling-scripts-while-a-save-loads).

## 6. Bugs found

| # | Found | Bug | State |
|---|---|---|---|
| B1 | S4 | Back-to-back frames hit `rate_limited`, and the framer's camera restore was rate-limited too ("Putting the camera back failed (Too many requests)") | Fixed in 0.5.2 (RB-77: paced bursts, retried restores); T2 Pass |
| B2 | S10 | In game, the expression options carried no `table_index`; the enrichment worked only in the self-test | Fixed in 0.5.2 (RB-78: indices read from the records' names); T3 Pass |
| B3 | K2 | A script call after the scripting layer detached for a load crashed the game (High) | Fixed in 0.5.2 (RB-76); T1 Pass |
| B4 | T6 | The showroom's default height puts the head about 0.18 m too high (probably the eye offset counted twice); 1.9 m was right at 1.3 m from the camera | Open (bridge 0.6 track) |
| B5 | T7 | `wardrobe.equip {item}` refuses `no_active_outfit` while `wardrobe.state` says `active: true`, `set: 0`: set 0 is probably treated as "no set" | Open (bridge 0.6 track) |
| B6 | T7 | `wardrobe.equip {area, show: "equipped"}` answers `changed`, but the state then shows `shows: "outfit"` and the helmet doesn't draw; the mode write doesn't take. Verify against the route the wardrobe screen takes, which does draw the helmet | Open (bridge 0.6 track) |
| B7 | T9 | The wardrobe undo leaves Head `hidden: false`, `shows: "outfit"` instead of `hidden: true`, `shows: "hidden"` | Open (bridge 0.6 track) |

**A possible common cause of B5–B7** [hypothesis]: EquipmentEx is enabled in the test profile. While its outfit is active it clears every base area's visuals, locks visual changes and makes the vanilla wardrobe calls no-ops ([worn clothing §2.4](../../knowledge/clothing.md#24-equipmentex-outfits-source)), which fits a "blank outfit" with no vanilla sets (`sets: []`) and vanilla writes that don't take. The "wardrobe screen" that made the helmet draw would then be EquipmentEx's outfit screen. Not yet tested; [worn clothing](../../knowledge/clothing.md#in-game-results-sessions-5-and-6) says how.

Not bugs, but limits found: photo mode opens only with the game window in front (S3); photo mode keeps its own camera placement (T5); the showroom's rigs can't be moved with photo mode's light controls.

## 7. Friction logs

What cost time, and what would remove it. Items marked 0.5.2 were built for session 6.

**Session 5** (written after the session):
- Photo mode needs the game in front, and the maintainer had to click into the game for each photo-mode open → an in-engine open with no focus (0.5.2 item 7, research), and a bridge "open when focused" watcher so the maintainer never announces focus.
- The camera can't be placed, only V moved → a camera placement command (0.5.2 item 4; T5 showed photo mode keeps its own placement).
- No exposure control → 0.5.2 item 5 (T4 Pass).
- Showroom heads below the eye line and floating above their pedestals → 0.5.2 item 6 (T6: pedestal fixed, default height still wrong).
- The rate limit blocked restores → 0.5.2 item 2 (T2 Pass).
- `game.wait` during a load crashed the game → 0.5.2 item 1 (T1 Pass).
- The helmet hidden by an outfit → wardrobe commands, 0.5.2 item 9 (T7 Fail).
- Expression table indices missing → 0.5.2 item 3 (T3 Pass).
- The coordinator hand-builds contact sheets and polls in shell loops → a bridge-side `capture.sheet` (a labelled grid of named captures) and a `session.log` stream.
- The maintainer relays in-game observations by typing in chat → an in-game "note" hotkey or panel button that posts a timestamped note, with a capture, into the session log.
- `ui.message` lines stack and linger in captures → clear them before captures, or a capture option that hides the XF label.
- Finding hairstyle and option indices needed probing → `cc.apply` by label (done in 0.5.1); also a `cc.options` listing labels per switcher.
- Manual MO2 staging while MO2 must be closed → a staging command that checks MO2 isn't running, backs up, stages and diffs (our own mods, test profile only).
- A light that wasn't on and subjects partly out of frame were noticed late or not at all → a `scene.report` and pre-capture assertions.

**Session 6:**
- Photo mode's own light controls are limited and fiddly; the maintainer uses CharLi because it rotates all lights together as a group → an XF light-rig controller (a group orbit around a subject, per-light tweaks, saved rigs including the Studio's setups) in our own overlay, superseding the vanilla lights ([in-game possibilities](../../research/backlog/in-game-possibilities.md) 12a).
- The showroom head's height took trial and error, but the camera's pose, frustum and the model's dimensions are all readable → compute placement exactly and verify by projecting into the frame (the maintainer's point).
- Handing photo mode to the maintainer took several manual steps (clear the rigs, respawn unlit, show the HUD, pause automation) → `session.handover` and `session.resume`: pause bridge automation, restore the UI, optionally hand over the lights, and log the handover.
- The showroom rigs seemed impossible to switch off without clearing the heads → `showroom.light {rig: "none"}`. The catalogue already has `showroom.clear {what: "lights"}`, which removes the rigs and keeps the heads; it wasn't used in the session, so the gap is discoverability.
- The showroom lights are fixed rigs the maintainer can't move with photo mode's light controls → spawn them as photo-mode-controllable lights, or let the in-game UI orbit them.
- The coordinator still hand-builds every comparison sheet → `capture.sheet`.

## 8. Where the results went

- The crash and its fix: [game crashes §2.3](../../knowledge/game-crashes.md#23-calling-scripts-while-a-save-loads).
- The creator from the street, the ignored edit tag, no CCA: [runtime access §5](../../knowledge/runtime-access.md#5-phase-2-commands-writes-and-captures) and [CC file chain](../../knowledge/cc-file-chain.md#in-game-results-sessions-5-and-6).
- The blank outfit and the wardrobe screen: [worn clothing](../../knowledge/clothing.md#in-game-results-sessions-5-and-6).
- The showroom's fidelity and placement: [skin and makeup on spawned objects](../../knowledge/skin-on-spawned-objects.md#43-the-fidelity-check).
- What is settled and what's next: the [next-sessions plan](../../research/runtime/next-sessions-plan.md) and [status](../../docs/status.md).
- The finish verdicts: the finishes rework ([finish designs](../../research/materials/finish-designs/README.md)).
