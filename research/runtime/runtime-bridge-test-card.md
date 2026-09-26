# Runtime bridge test card

**Status: the next session is [autonomy checks, the expression checks R1 and R2, then session 2 continued](#next-session-autonomy-checks-expression-checks-then-session-2-continued).** The first in-game runs of [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md) 0.2.0 on 26 September 2026 passed the [script-call check](#script-call-check-first) and the [first-session checks](#first-session-bridge-checks), and ran session 2 semi-manually ([results](../../experiments/020-session-2/README.md#results-26-september-2026-run-through-the-runtime-bridge-partial)). Since then the bridge can open photo mode with the player's own key, frame V without hand-tuned values, switch lights on, hide the cursor, keep the creator's row labels in step and press the creator's Confirm and Back, and it has two research commands for the [expression editor](../animation/expression-editor-design.md#8-runtime-questions-r1r5-through-the-bridge) (`face_rig_read`, `photo_expression_index`); all of it is built and tested offline only. Design and citations: [runtime bridge design](runtime-bridge-design.md); photo mode and the creator from script: [knowledge/photo-mode.md](../../knowledge/photo-mode.md).

**Who does what.** The maintainer starts MO2 and the game, loads a save, keeps the game window in front, and opens the character creator when asked (a mirror, or F12 with Character Customization Anywhere). The coordinator drives everything else through the bridge (MCP tools or the command line) and takes the screenshots. Agents never launch the game or MO2; only the coordinator stages, and only the `XF Runtime Bridge` entry in the test profile.

| Part | Time | Needs |
|---|---|---|
| [Before the session](#before-the-session-coordinator) | offline | The coordinator restages the `XF Runtime Bridge` entry from a new build |
| [Next session: autonomy checks](#next-session-autonomy-checks-expression-checks-then-session-2-continued) | 15–20 min | V in the world in an open, quiet spot; the game window in front |
| [Expression checks R1 and R2](#expression-checks-r1-and-r2) | 10–15 min | Directly after the autonomy checks, in photo mode; the photo-mode expression list (the Mega Pack's) as in the first session |
| [Session 2 continued](#session-2-through-the-bridge) | about 40 min | Directly after the expression checks, same game |
| [Kill switch and wrap-up](#kill-switch-and-wrap-up) | 3 min | End of the evening |
| [Script-call check](#script-call-check-first), [first session](#first-session-bridge-checks) | done | Results kept below |

## Before the session (coordinator)

A staging checklist. Nothing here launches anything; the maintainer's everyday profile, frameworks and mod list are never touched.

1. **Build under test.** Use the zips from `projects/xf-runtime-bridge/dist/`, built by `bun tools/package.ts` (it refuses a dirty tree or a DLL not built from `HEAD`):

   | Zip | Bridge | Use |
   |---|---|---|
   | `xf-runtime-bridge-0.2.0-writes.zip` | on, **writes allowed** | **This session**, in the test profile only |
   | `xf-runtime-bridge-0.2.0-diagnostic.zip` | on, read-only | Any other diagnostic profile |
   | `xf-runtime-bridge-0.2.0.zip` | off | Distribution default |

   **Next build:** the autonomy batch and batch 2 (below), rebuilt from the `main` commit that merges `claude/bridge-batch2`; record its zip and DLL hashes here before staging (the DLL embeds the commit, so they differ from the branch build recorded below). What it adds to the staged zips: the -writes zip sets `allow_creator_leave = true`, and the -diagnostic and -writes zips carry `r6/tweaks/XFRuntimeBridge/xf_photo_mode_presets.yaml` (XF camera presets 7-9; the default zip doesn't). Check the -writes manifest for `"allow_creator_leave": true` and `"photo_mode_presets"`.

   **Branch build of batch 2** (`claude/bridge-batch2`, recorded at the end of this page under [build record](#build-record-staged)): the checks there passed on that commit; restaging uses the `main` rebuild.

   **New in this build, watch in the next session:** the plugin log's load lines now include `evt=script.addresses_resolved … script_calls=on`; `script_calls=off` (or any answer `script_calls_unavailable`) means RED4ext's address library lacks an address the calls need: stop and send the log. The cursor hide works only in photo mode and clears itself in any other phase or after a 120 s idle disconnect. `photo_open` re-checks the game after bringing the window forward, refuses an unbound or unreadable key binding and punctuation keys, and sends only to `Cyberpunk2077.exe`. `face_rig_read` and `photo_expression_index` are new ([expression checks](#expression-checks-r1-and-r2)).

   **Build record of the first sessions** (26 September 2026, `main` at `c31156aaf29b`, clean tree: the script-call fix, RB-29..31, and every earlier review fix; `xfb_selftest --unit` OK, self-test 157 of 157, `bun test tools` 65 of 65, redscript and Lua lint passed on that build). The zip to stage is the `-writes` one:

   | Zip | SHA-256 |
   |---|---|
   | `-writes` | `56cea1a0a50a67b79515b8951e59a6a07c46a664ce639e0bf2f3069cb5673fc9` |
   | `-diagnostic` | `31abda27640d916a3836b43875546bf8c92fcce678b07dd4b4d107b15e3342c2` |
   | default | `aa20435b83d9834e3c2f6a942b7b1e77c9b366414d666b49e71517d2993d2c3b` |
   | (`XFRuntimeBridge.dll` inside each) | `b7b9ef32eb51ef95602904d6c4f86697ae5ee9edce1f3c845e7d76e461e3f824` |

   **New in this build, watch in the first session:** a photo-mode write whose value the menu then reports differently fails with `write_mismatch` and is put back (RB-19). If camera writes fail that way at step 11, note the requested and reported values; the comparison tolerance is one slider step. A light change waits three game ticks between selecting and setting (RB-20). Every game and script call now carries a caller frame and a context (the crash fix; the [script-call check](#script-call-check-first) proves it first), and `photo_camera_set {reset: true}` may answer `partial: true` with `errors` and an undo when a key fails (RB-29).

   **Staged** on 26 September 2026: the build above, unpacked into the MO2 mod `XF Runtime Bridge` (first row of the test profile's `modlist.txt`; nothing else changed), with `%LOCALAPPDATA%\XFStudio\runtime-bridge\` emptied. Baseline capture `bridge-phase2-pre`.

   A rebuild after merging gives new hashes (the DLL embeds the commit); record them here if the staged zip is rebuilt. Check the zip's SHA-256 against the build record, and that its `red4ext/plugins/XFRuntimeBridge/manifest.json` says `"variant": "writes"`, `"allow_writes": true` and the expected `commit`. The self-test (`bun tools/selftest.ts`) and `bun test tools` must pass on that commit.

2. **Stage one mod entry** in MO2 profile **`XF Studio diagnostic 2026-09-25`** only:
   - Create the mod **`XF Runtime Bridge`** from `xf-runtime-bridge-0.2.0-writes.zip` (MO2 *Install a new mod from an archive*, name it exactly that). The zip's root is the game folder: `bin/`, `r6/`, `red4ext/`.
   - Enable it in this profile only. Never enable it in the everyday profile; the `-writes` build must never reach a profile used for play.
   - Placement, by the [placement rule](../authoring/framework-version-check.md#mo2-placement-rule) (rule 3, no related entry): the bottom of the left pane, which is where MO2 puts a newly installed mod anyway (inside the `UNCATEGORISED` section, the first row of `modlist.txt`). Move nothing else. Its files overlap no other mod, so MO2's conflict view should show none.
   - Leave the profile's other entries as they are, including **XF Eye Artistry** (the session 2 build, already staged and enabled) and the frameworks.

3. **Framework versions** (read-only `projects/xf-studio/authoring/tools/framework-check.ts` against this profile, 26 September 2026; latest releases checked on GitHub the same day):

   | Framework | Installed in the profile | Latest stable | Needed by the bridge |
   |---|---|---|---|
   | RED4ext | 1.30.0 (game folder) | 1.30.0 | The plugin |
   | redscript | 0.5.31 | 0.5.31 | The script layer |
   | Cyber Engine Tweaks | 1.37.1 (game folder) | 1.37.1 | The status label and kill hotkey |
   | TweakXL | 1.11.4 | 1.11.4 | Optional data marker |
   | Codeware | 1.20.5 | 1.20.5 | `photo.enter` only |
   | ArchiveXL | 1.27.3 | 1.27.3 | Not needed by the bridge (XF Eye Artistry needs it) |

   **Nothing needs updating.** Re-run the check if the session slips and a framework has released since.

4. **Photo-mode mods in this profile** that meet the bridge: *Photo Mode Preferences* re-applies its saved settings each time photo mode opens, so wait about 2 s after photo mode opens before the first camera change (the session scripts wait 2 s after every `game_wait` for photo mode). *Photo Mode Unlocker XL* widens slider ranges; the bridge checks values against the ranges the menu reports, so wider ranges are simply accepted. *Photo Mode Pose Selector*, *Customisable Photo Mode UI* and *Equipment-EX* add menu items; the first `photo_state` dump records them. *Photo Mode Ex* (MO2 mod `PhotoMode-EX`) **is enabled** in this profile: it clamps V's rotation (key 7) to −180…180, so the scripts' light sweep uses 150°, 165°, −165° and −150° rather than 195° and 210°, and it persists depth of field into saves, which the scripts never write.

5. **Runtime folder.** `%LOCALAPPDATA%\XFStudio\runtime-bridge\` must hold no `session.json` and no `KILL`; delete leftovers.

6. **Coordinator tooling.** In `projects/xf-runtime-bridge`: `bun install`, then register the MCP server (see the [README](../../projects/xf-runtime-bridge/README.md#mcp-server)) and restart the MCP client so it lists the `xf-runtime-bridge` tools. The CLI (`bun tools/bridge-client.ts run <command>`) is the fallback.

7. **Baseline capture:** `python tools/capture_session.py --label bridge-phase2-pre --profile "XF Studio diagnostic 2026-09-25"`.

8. **Tell the maintainer before the session:** use a save next to a mirror (V's apartment bathroom works); make a new manual save when asked, before the first change (this profile shares the save folder, and after the first change the bridge holds a save lock until a save is loaded; the kill switch does not release it); bind the kill hotkey once the game is at the main menu (first-session step 1); the game must run in **borderless windowed** or windowed mode for captures that include overlays, and the screenshot route is recorded either way.

## Next session: autonomy checks, expression checks, then session 2 continued

Each check proves one new bridge feature in the game before session 2's script relies on it. Tool names are the MCP names. Restage first (above), and tell the maintainer: borderless windowed, the game window in front (`photo_open` presses the photo-mode key in it, and refuses if another window is in front), V standing in an open, quiet spot with a few metres in front of her (the XF camera presets put the camera 1.8 m from V), and a new manual safety save before the first change. The kill hotkey stays bound from last time.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| A1 | M, C | M loads the save, stands V in the open spot and makes the safety save. C: `bridge_info`, `game_status` | The new build's commit; `allow_writes: true`, phase `gameplay` | Stop: wrong build |
| A2 | C | `photo_open` | Photo mode opens by itself within about a second; the result names the key (`IK_N` unless rebound), `route: "sendinput"` and whether the bridge brought the window to the front | `not_foreground`: M clicks the game, C repeats. `photo_open_timeout`: M presses the photo-mode key; record it (the posted route is `photo_open {route: "postmessage"}`, worth one try) |
| A3 | C | Wait 2 s. `photo_subject {}` | `slot: "Head"`, `approximate: false`, `subject: "photo_puppet"`; `screen.center` near (0, 0), (0.5, 0.5) or the window centre in pixels. Record the raw `screen` block | `approximate: true` or no stand-in: `photo_frame` still works but coarser; record |
| A4 | C | `photo_light_set {light: 1, on: true, type: "spot", brightness: 60, hue: 35, saturation: 15}` | Light 1 switches on (warm); note where it appears relative to V and the camera. The undo switches it off | `write_mismatch` on `on` or `type`: record the menu values (`photo_state {options: true}`) |
| A5 | C | `photo_camera_set {camera_preset: 7}`, then `capture_screenshot {region: "face"}` | The camera jumps to about 1.8 m in front of V at eye level, field of view about 11 (the XF face preset). If it matches Portrait Enhancer's preset 7 instead, our file loaded first | Record which preset values took effect |
| A6 | C | `photo_frame {target: "face", look_at: "off", xf_preset: true}`, `photo_hud_hide {}`, wait 0.5 s, `capture_screenshot {region: "face"}`; then `photo_frame {target: "eyes", xf_preset: true}` + `capture_screenshot {region: "eyes"}`; then `head-and-shoulders` + its region | Each `method: "project"`, `converged: true`, a handful of steps. The face fills the face crop from chin to hairline, the eyes crop holds both eyes and brows, centred | Off-centre vertically: the anatomical offsets need tuning; note by how much (the result's `offset` and the capture). `method: "capture"`: record the note |
| A7 | M, C | M moves the mouse so the pointer sits over V's face and leaves it. C: `photo_hud_hide {}`, wait 0.5 s, `capture_screenshot {region: "face"}`, then `photo_hud_hide {hidden: false}` | No cursor and no menu in the capture (`cursor_controllers` ≥ 1); the menu and cursor come back and the mouse still works in the menu | Cursor visible: record `cursor_controllers`; the next try is the menu-layer event (knowledge/photo-mode.md §6) |
| A8 | C | `photo_frame {target: "face", yaw_offset: -30}` then `-15`, `15`, `30`, a face capture after each | V turns (head with the body, look-at off), stays centred and sized; the light meets the face from changing sides | — |
| A9 | C | `capture_burst {region: "eyes", frames: 10, interval_ms: 100}` | A contact sheet; `diff_previous` means near 0 (the scene is still), timings near 100 ms | Large differences in a still scene: record (flicker) |
| A10 | C | `photo_exit`. M opens the creator with F12 (Character Customization Anywhere) and goes to the XF row. C: `game_wait {phase: ["character_menu"]}`, `player_appearance {option: "XF"}` | Record `menu.updating_finalized_state` and `menu.edit_mode` ([photo-mode open question 2](../../knowledge/photo-mode.md#open-questions)): `true` means F12 opens the edit-V's-look mode and Confirm keeps a look | `game_wait` times out: F12 opened the new-game mode (the bridge treats only the edit mode as `character_menu`); M closes it and uses a mirror instead; record |
| A11 | C | `cc_apply {option: "XF", index: 5}`, wait 1.5 s, `capture_screenshot {region: "cc-eyes"}` | The preview changes and **the XF row shows Gloss A's name** (`route: "row"`); the `cc-eyes` crop frames both eyes and brows | Row still shows the old name: record `route` |
| A12 | C | `cc_confirm` | The creator closes and V keeps Gloss A in the world (`kept: true`); `game_status` shows `bridge_save_lock: true` | `creator_leave_disabled`: wrong build. `not_in_character_menu`: M presses Confirm |
| A13 | M, C | With an XF Eye Artistry look on, M equips a full-head item that hides V's head in first person or all views (a full helmet or mask with `hide_Head`). C: `capture_screenshot {region: "face"}` in photo mode | The makeup hides with the head. If it floats in the air, the export's component prefix (`xfs_c<key>_makeup`) isn't covered by ArchiveXL's `hide_Head` rule ([clothing knowledge](../../knowledge/clothing.md)); record it for a rename decision | Record and carry on |

Then run the [expression checks](#expression-checks-r1-and-r2), then session 2 continued (below). The kill-switch check with the cursor hidden is at the [wrap-up](#kill-switch-and-wrap-up).

## Expression checks R1 and R2

The [expression editor design](../animation/expression-editor-design.md#8-runtime-questions-r1r5-through-the-bridge) needs two answers only the running game gives: **R1**, which facial setup, graph and animation sets photo mode's `face_rig` uses after ArchiveXL, and **R2**, whether the photo-mode `faceId` is the face database's index and which entity takes the face input. Both use this profile as it is (the Photomode Facial Expression Mega Pack enabled; 207 expressions in the first session). `face_rig_read` only reads. `photo_expression_index` is a write-photo research command: it feeds a face index straight to the photo-mode face animation (`AnimFeature_PhotomodeFacial`, then the `updateFacialPose` event, the game's own input for it) on V's stand-in or its head item; its undo selects the menu's expression again, and leaving photo mode resets the face. "Static: Sleeping" is 57th in the menu (position 56) with faceId 60, and the face table's row 56 is "Static: Skeptical", so the two faces tell faceId and position apart ([facial expressions](../../knowledge/facial-expressions.md)).

Start in photo mode after A13 (take the helmet off), or `photo_open`. Set up once: `photo_frame {target: "face", look_at: "off", xf_preset: true}`, `photo_hud_hide {}`. Every capture below is `capture_screenshot {region: "face", name: "<step>"}` after a 1.5 s wait (the face cross-fades over 1 s).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| R1a | C | `face_rig_read {}` (the head item, the default components) | `class` the head item, `record` `Items.PlayerWaPhotomodeHead`; `face_rig` found, `kind: "animated"`, with `facial_setup`, `graph` and `rig` hashes; `man_face_base_animations` and `PhotomodeAnimations` found with their `gameplay` sets and priorities. Keep the whole JSON: the Studio labels the hashes (the male player setup or the female head's own is question D1) | `face_rig` not found: record the answer and try `components` with the names from the photo-mode `.app`. `unreadable` entries: record them (a layout differs on 2.31). Any refusal: record its code |
| R1b | C | `face_rig_read {target: "puppet"}` | The stand-in's own components; `face_rig` probably not found there | Record |
| R2a | C | `photo_state {options: true}` | Record key 28's option list: the position and value of "Static: Sleeping" (expected 56 and 60) and "Static: Skeptical" | Different numbers: use the recorded ones below |
| R2b | C | `photo_expression_set {faceId: 60}`, capture `r2-menu-60`; then `photo_expression_set {faceId: 0}`, capture `r2-neutral` | Sleeping, then neutral: the menu's own route, as references | — |
| R2c | C | `photo_expression_index {index: 60}` (the stand-in), capture `r2-puppet-60` | Sleeping, if the stand-in takes the face input and faceId is the database index | Neutral still: go on with R2d |
| R2d | C | `photo_expression_index {index: 60, target: "head"}`, capture `r2-head-60` | Sleeping, if the head item takes it | Neutral on both targets: the input needs another route; record and stop R2 |
| R2e | C | On the target that worked: `photo_expression_index {index: 56, target: …}` (add `unlisted: true` if refused), capture `r2-index-56` | Skeptical: the index is the table's `Index` column (row 56), confirming faceId 60 = index 60 above. Sleeping would mean the menu position | Record which face |
| R2f | C | Wait 5 s, capture `r2-hold` | The face from R2e holds (photo mode doesn't re-apply its own index) | Back to the menu's face: record; the bridge's face lasts only moments |
| R2g | C | Run R2e's result's `undo` (`photo_expression_set` with the menu's value), capture `r2-undo` | The menu's expression (neutral) again | Pick an expression in the menu; record |

Evidence: the JSON of R1a, R1b and R2a–R2g, the captures, and the plugin log's `photo face index …` lines. Afterwards the answers go into the [expression editor design](../animation/expression-editor-design.md) (R1, R2, question D1) and [facial expressions](../../knowledge/facial-expressions.md). R1's second half (the same read with the Mega Pack disabled) needs a throwaway profile and waits for a later session.

## Script-call check (first)

The first in-game run (26 September) crashed the game whenever the bridge called redscript that reached TweakDB or `TDBID` natives: the plugin started scripts with no context ([design §3.5](runtime-bridge-design.md#35-calling-game-and-script-functions-from-native-code)). The build under test calls every game and script function the way CET does. This check proves that with **at most one crash**: reads first, then one write and its undo, then the kill switch. Everything else on this card waits until it passes.

Before it, the coordinator restages the `-writes` zip from the build record below (replace the `XF Runtime Bridge` mod's files; nothing else changes) and empties `%LOCALAPPDATA%\XFStudio\runtime-bridge\`. Every script call now leaves a `script.call fn=…` line before it and `script.returned` after it in `xfruntimebridge-<ts>.log`, and the redscript layer adds a `step: … next` line before each call that crashed last time, so after a crash the last lines name the call. If the game crashes at any step: stop, don't retry, run `python tools/minidump_summary.py`, and send the plugin log.

| # | Who | Do | Expect |
|---|---|---|---|
| S1 | M | Launch the test profile; wait for the main menu. | No redscript pop-up; the amber CET label. |
| S2 | C | `bridge_ping`, `game_status` | Phase `main_menu`. The log's first `script.call` is preceded by one `evt=script.call_context context=entEntity caller=$XFBridge route=InternalExecute tweakdb_getint=native_member tdbid_tostringdebug=native_member` (if either says `native_static`, record it). |
| S3 | C | `bun tools/bridge-client.ts call script.describe` | The call that crashed: JSON with `"tweak_marker":1`, `"has_player":false`. Log: `DescribeJson step: TweakDBInterface.GetInt next`, then `script.returned fn=XFRuntimeBridge.XFBridgeQuery.DescribeJson ok=true`. |
| S4 | M | Load the save next to the mirror; **make a new manual save** (the safety save). | — |
| S5 | C | `script.describe` again, then `player_appearance`, then `photo_state` | `has_player: true` with a position; body, brain and `life_path` (the second call that crashed, `TDBID.ToStringDEBUG`); photo mode inactive. |
| S6 | C | `world_time_set {hours: 21, minutes: 0}`, then its `undo` (`world_time_set {total_seconds: …}`) | Night, then the original time; `game_status` shows `bridge_save_lock: true`. |
| S7 | C | `world_pause {paused: true}` and leave the world frozen; then `bridge_kill` | The world freezes, then moves again when the kill switch's restore runs (`RestoreAfterKill … "world_unfrozen":true … "save_lock_kept":true` and `evt=bridge.kill_restored` in the log); the CET label turns red. |
| S8 | M | Load the safety save, quit to desktop. | Clean exit. Report "script-call check passed" (or the crash) to the coordinator, who then continues with the first session below in a new game start. |

**Result, 26 September 2026 (build `c31156a`, game 2.31): passed.**

| Step | Outcome |
|---|---|
| S2 | `script.call_context context=entEntity caller=$XFBridge route=InternalExecute tweakdb_getint=native_member tdbid_tostringdebug=native_member`: 2.31 registers both natives that crashed as member functions [runtime]. |
| S3 | `script.describe` at the main menu returned `tweak_marker: 1`; the log shows `DescribeJson step: TweakDBInterface.GetInt next` then `script.returned … ok=true`. `has_player` was `true` at the main menu (the main menu has a player puppet at about `(0.01, 3.62, 0.01)`), not `false` as expected above. |
| S5 | `script.describe`, `player_appearance` (female body and brain, `LifePaths.Corporate`, hair tag `Short`) and `photo_state` (91 menu items seen, FOV 43.0) all answered. |
| S6 | `world_time_set` 21:00 moved the clock from 705,706 s to 766,800 s and took the save lock (`saving_locked: true`); the undo restored 705,706 s exactly. `capture.screenshot` worked through `printwindow` on the 3840×1600 window (downscaled to 1280×533). |
| S7 | `world_pause` reported `frozen: true`; `bridge.kill` ran `RestoreAfterKill` once (`world_unfrozen: true`, `save_lock_kept: true`, `evt=bridge.kill_restored`); the CET label turned red. The freeze itself wasn't visible: nothing moved in view indoors. **Next time, check freeze and unfreeze with NPCs or traffic in view.** |

## First session: bridge checks

Tool names are the MCP names; the CLI takes the dotted name (`bridge_ping` is `bun tools/bridge-client.ts run bridge.ping`). Every result carries a correlation id (`cid`) that also appears in the plugin log. Stop at the first unexpected result in steps 1–4 and send the red4ext logs.

| # | Who | Do | Expect | Undo |
|---|---|---|---|---|
| 1 | M | In MO2 select **XF Studio diagnostic 2026-09-25** and launch the game. Wait for the main menu. Open the CET overlay, go to **Bindings** and bind **Kill XF Runtime Bridge (stop the local pipe)** to a free key (CET can't give a mod's hotkey a default key, so it has none until bound; CET remembers it afterwards). Close the overlay. | No redscript error pop-up. An amber **"XF bridge: listening (writes ON)"** label at the top left once CET has loaded. The hotkey shows in Bindings. | — |
| 2 | C | `bridge_ping`, `bridge_info`, `game_status` | `pong: true`, `plugin_version` 0.2.0; `allow_writes: true` and the manifest's commit; phase `main_menu`. | — |
| 3 | C | `bun tools/bridge-client.ts smoke` | The baseline reads answer; `game.version` shows `3.0.80.51928`; `layers.status` lists `redscript`, `tweakxl`, `cet` (note whether already at the main menu). | — |
| 4 | M | Load the save next to the mirror and stand in the world. **Make a new manual save now** (the safety save). | — | — |
| 5 | C | `game_status`, `player_appearance`, `photo_state` | Phase `gameplay`, `player_present: true`, `saving_locked: false`, `bridge_save_lock: false`; body, voice and life path; photo mode `active: false`, `can_open: true`. | — |
| 6 | C | `capture_screenshot` (full), then with `region: "center-16x9"` | A preview no wider than 1280 px that shows the game, not black; the full-resolution file path; the sidecar records the route (`printwindow` or `screen`) and window size 3840×1600. | — |
| 7 | C | `world_time_set` `{hours: 21, minutes: 0}` | Night lighting within a second or two. Result has `before_total_seconds` and `undo`. `game_status` now shows `saving_locked: true`, `bridge_save_lock: true` (the save lock taken before the first change). | `world_time_set` with the result's `total_seconds` |
| 8 | C | `world_pause` `{paused: true}`, look, then `{paused: false}` | The world stops (V too: the freeze copies the mirror screen's, which also holds the player), then moves again. | `world_pause {paused: false}` (the kill switch also unfreezes) |
| 9 | C | `photo_enter` | Photo mode opens by itself (Codeware quest node, a [hypothesis] outside quests). If it answers but nothing opens, or refuses: M presses the photo-mode key; C runs `game_wait {phase: ["photo_mode"]}`. Record which. | `photo_exit` |
| 10 | C | Wait 2 s. `photo_state {options: true}` | Every menu item with its key, label, range or options and current value. Record: whether keys 1 (field of view), 26 (depth of field), 28 (expression), 37 (up/down) and 43–53 (lights) match the [research keys](runtime-bridge-design.md#73-photo-mode); the light on/off key; film grain and chromatic aberration keys. | — |
| 11 | C | `photo_camera_set {fov: 30}`, then `{reset: true}` | The view widens or narrows, then returns. `applied` lists each change with its before value. | The result's `undo`, or `reset` |
| 12 | C | Calibrate: `photo_camera_set {preset: "face"}` and `capture_screenshot {region: "face"}`; adjust `fov` and `subject.yaw` / `up_down` until the face fills the `face` region and faces the camera; same for `eyes` and `head-and-shoulders`. | The presets are uncalibrated guesses; record the working values and put them in `tools/api/presets.ts` (and the region shapes in `tools/capture/regions.ts` if the face sits off-centre) before session 2. | `reset: true` |
| 13 | M, C | M turns light 1 on in the photo-mode menu. C: `photo_light_set {light: 1, brightness: 80, hue: 30}` | The light changes colour and brightness (the bridge selects the light, waits three game ticks for photo mode to load it, then sets it). | The result's `undo` |
| 14 | C | `photo_hud_hide`, wait 0.5 s, `capture_screenshot {region: "face"}`, `photo_hud_hide {hidden: false}` | The photo-mode menu fades out, the capture is clean, the menu returns. | `hidden: false`; reopening photo mode always shows it |
| 15 | C | `photo_expression_set {faceId: <a value from step 10's expression list>}` | V's expression changes; a value not in the list is refused with a plain message. | The result's `undo` |
| 16 | C | `cc_apply {option: "XF", index: 1}` (still in photo mode) | Refused in plain words: needs the appearance screen. Nothing changes. | — |
| 17 | C | `photo_exit` | Back in the world. | `photo_enter` |
| 18 | M, C | M opens the mirror's appearance screen. C: `game_wait {phase: ["character_menu"]}`, `player_appearance {option: "XF"}` | Phase `character_menu`; the XF row lists Off plus 12 with their names. | — |
| 19 | C | `cc_apply {option: "XF", index: 1}`, `capture_screenshot`, then `cc_apply {option: "XF", index: 0}` | Depth A appears on V in the preview and the XF row shows its name; then Off. The bridge never confirms. | Back in the appearance screen discards every change |


**Result, 26 September 2026 (build `c31156a`, new game start after the script-call check).**

| Step | Outcome |
|---|---|
| 9 | `photo.enter` opened photo mode through the Codeware quest node, but **a restricted photo mode**: camera type first-person only, no V tab, no field of view; camera writes were accepted by the menu and changed nothing. Photo mode opened with the player's key has the full menu (camera type Drone), and there FOV, V placement, look-at, light, HUD and expression writes all work. **Don't use the quest-node route**; the bridge needs another way to open photo mode. `photo.exit` works. |
| 10 | 92 menu items. Every researched key matches; new: **light on/off is key 44 (STATE)**, chromatic aberration 13, film grain 25, shadow 46, light type 45 (Spot/Ambient), camera type 16, character visible 27, V pose-tab offsets 7/8/9/37 (±180°, ±5 m). 207 expressions. |
| 11 | FOV writes apply (visible zoom); no `write_mismatch`. After a write the FOV row stops showing its number box (cosmetic). |
| 12 | Framing depends on where the drone camera spawns relative to V, so fixed presets can't be universal: in the bathroom the camera sat in the wall; in the living room with V facing the room, face close-up = FOV 7, look-at camera, V left/right +1.57, up/down −0.80 (eyes: FOV 1–2, +1.61, −0.81). Offsets scale with FOV around the frame centre. The photo-mode **mouse cursor is drawn into captures** (the HUD hide doesn't hide it). |
| 13 | Light 1 switched on by the player (the bridge has no on/off parameter yet); brightness 80, hue 30 applied visibly (warm key light). Photo-mode lights reset each time photo mode opens. |
| 14–15 | HUD hide gives clean captures; expression 1 (Charm) applied visibly. |
| 16–17 | `cc.apply` refused in photo mode in plain words; `photo.exit` back to gameplay. |
| 18–19 | The character creator (reached by the mirror or the Character Customisation Anywhere mod's F12) detected as `character_menu`; the XF row read (Off + 12); `cc.apply` changed the preview; the named `face` crop suits it, the `eyes` crop is sized for photo mode and lands on the forehead there. |
| Session 2 | Run semi-manually: the player opened the creator with F12 and photo mode with the key; the bridge applied presets, framed, captured and restored. Results in [experiment 020](../../experiments/020-session-2/README.md#results-26-september-2026-run-through-the-runtime-bridge-partial). |
| 20–22 | The kill switch was proven in the script-call check; the game quit cleanly and removed `session.json`; post-session capture `bridge-phase2-post`. |

If a step fails, in any part of this card:
- **Redscript error pop-up:** screenshot it, quit, disable `XF Runtime Bridge` in this profile; the coordinator reads `r6/logs/redscript_rCURRENT.log`.
- **Crash:** disable the entry; send the newest `red4ext/logs/*.log` (under MO2: `overwrite/red4ext/logs/`). The last `script.call` or `step` line names the call; `python tools/minidump_summary.py` gives the crash's fingerprint ([game crashes](../../knowledge/game-crashes.md)).
- **`rtti_missing` / `rtti_signature`:** a function differs on 2.31; the call was refused and nothing changed. Carry on; `evt=rtti.signature_mismatch` in the log says what differs.
- **`timeout_after_start`:** the game was slow to confirm; check the game before repeating.
- **`script_layer_missing`:** the redscript part didn't compile; check the redscript log.
- **Anything feels wrong:** stop the bridge with any one of: the CET hotkey bound in step 1; `bridge_kill` (MCP; while a scripted session holds the connection it writes the `KILL` file below instead) or `bun tools/bridge-client.ts kill`; or, if neither answers, an empty file named `KILL` created in `%LOCALAPPDATA%\XFStudio\runtime-bridge\` (the bridge checks for it twice a second). Each cancels any write still queued and undoes a freeze or a hidden photo-mode menu. The save lock stays on purpose, because other changes may still be live; loading the safety save releases it and restores everything else. Delete `KILL` afterwards, or the bridge won't start next time.

## Session 2 through the bridge

The script [`tools/sessions/session-2.json`](../../projects/xf-runtime-bridge/tools/sessions/session-2.json) runs the parts of the [session 2 card](../../experiments/020-session-2/README.md) still open after 26 September (generated by `tools/sessions/make-sessions.py`). About 300 steps, 19 of them asks; each creator visit is one ask, marked `replaced_by: cc.open` for when the bridge can open the creator itself.

- **p0:** bridge and game status; the maintainer confirms the safety save, notes the game version, upscaler, resolution and ray or path tracing (card step 8) and stands V in the open spot.
- **p1, Gloss A–D, Shimmer and Metal (card steps 5–7):** for each preset the maintainer opens the creator; the bridge sets XF, photographs the creator's eyes zoom (`cc-eyes`), presses Confirm, opens photo mode with the photo-mode key, turns grain and aberration off, switches light 1 on, frames the face (XF preset, then `photo_frame`), hides the menu and cursor, captures, and sweeps the light by turning V −30°, −15°, 15° and 30° with look-at off, then leaves photo mode. Shimmer adds the eyes framing and a 10-frame burst. After Gloss A the session **pauses for the coordinator's check** that framing, cursor and sweep look right.
- **p2:** Depth C at the extreme close-up (span 0.08 m) with a 5-frame burst; Depth D in motion in the creator (a 20-frame burst of the eyes zoom, then the maintainer's verdict, card step 4); Lines · new and old at the eyes framing and the extreme close-up (the sharpness the first run couldn't establish); a last pause for the verdicts.
- **p3, optional (card step 9):** XF Off, then piercings and the heart eye by hand in the creator, one creator capture each.
- **p4:** Back through the bridge (`cc_back`), then the maintainer loads the safety save (the kept looks and the save lock go with it).

If `cc_confirm` is refused, a note asks the maintainer to press Confirm; if `photo_open` fails, a note asks for the photo-mode key; `game_wait` then continues. Run it one of two ways, never together with MCP tool calls (the bridge takes one client at a time):

```powershell
cd projects/xf-runtime-bridge
bun tools/session.ts tools/sessions/session-2.json --dry-run          # check the plan; sends nothing
bun tools/session.ts tools/sessions/session-2.json                    # interactive: shows each ask, waits for Enter
bun tools/session.ts tools/sessions/session-2.json --out <folder> --from <label>   # harness: stops at each ask
```

Run by the coordinator (no terminal), the runner stops at each *ask* and prints the `--from` label that continues after it; the coordinator relays the ask, then continues into the same `--out` folder. *Notes* print while the next `game_wait` waits up to 10 minutes for the player. Every run appends to the folder's `manifest.json` with each step's input, result, undo note, timings and screenshots (`.full.png` at full resolution, `.png` at viewing size, `.json` sidecar; bursts add a contact sheet and a `.burst.json`).

## Kill switch and wrap-up

| # | Who | Do | Expect |
|---|---|---|---|
| 20 | M, C | M opens photo mode (or C: `photo_open`) and leaves the pointer over V. C: `photo_hud_hide {}`, then `bridge_kill` (or M presses the CET hotkey *Kill XF Runtime Bridge*; fallback: the `KILL` file, see above) | The label turns red "XF bridge: killed"; the hidden photo-mode menu **and the cursor** come back (`RestoreAfterKill … "photo_ui_shown":true … "cursor_shown":true`); the save lock is still held (saving stays blocked until step 21's load; `save_lock_kept`); later calls answer plainly that the bridge is off. M leaves photo mode with its own key. |
| 21 | M | Load the safety save (this releases the save lock), then quit to desktop normally. | Clean exit; `session.json` is gone from `%LOCALAPPDATA%\XFStudio\runtime-bridge\`; delete a `KILL` file there if one was used. |
| 22 | C | `python tools/capture_session.py --label bridge-phase2-post --profile "XF Studio diagnostic 2026-09-25"`; copy the session report folder and `logs/commands-*.jsonl` into the evidence. | |

Expected evidence (under MO2, logs sit in `overwrite/`):

| Log | Expected lines | Answers |
|---|---|---|
| `red4ext/logs/red4ext-<ts>.log` | `XF Runtime Bridge (version: 0.2.0 …) has been loaded`; no "incompatible" warning | RED4ext accepted the plugin |
| `red4ext/logs/xfruntimebridge-<ts>.log` | `evt=plugin.build XFB_BUILD=<manifest commit>;dirty=0`, `evt=plugin.config … bridge.enabled=true bridge.allow_writes=true`, `evt=plugin.scripts … added_to_redscript=true`, `evt=bridge.listen …`, `evt=game.state state=Running event=enter` | Load order, config, script registration |
| same | `layer=redscript … XFBridgeSystem.OnAttach`, `evt=layer.announce layer=redscript`, `layer=tweakxl … protocolVersion=1`, `layer=cet … onInit` | Every layer runs |
| same | `evt=bridge.request method=… access=write-photo` (or `write-world`, `write-character`), `evt=write.done method=… undo=…` per change, `save lock requested (reason XFRuntimeBridge)`, `evt=photo.enter_requested route=quest_node`, `photo attribute <key> (<label>) <before> -> <after>` | Each write with its reversal |
| same | `evt=bridge.killed`, `evt=bridge.kill_restored …`, `RestoreAfterKill …`, `evt=bridge.server_stopped stop_ms=<under 1000>`, `evt=plugin.unload` | Kill switch and clean shutdown |
| `r6/logs/redscript_rCURRENT.log` | Both `.reds` files from `red4ext/plugins/XFRuntimeBridge/Scripts`; `Compilation complete` | The plugin's script path under MO2 |

Afterwards, record outcomes in the [design page](runtime-bridge-design.md) (unverified rows become [runtime] with the capture id), in [knowledge/runtime-access.md](../../knowledge/runtime-access.md), and the session 2 answers in [experiment 020](../../experiments/020-session-2/README.md).

## Build record (staged)

Built 26 September 2026 from `main` at `509f5995f681`, clean tree (`XFB_BUILD=509f5995f681c46ed0be3939185327f9f9e92040;dirty=0`), by `bun tools/package.ts`: bridge batch 2 (RB-32..41, `face.rig.read`, `photo.expression.index`) on top of the autonomy batch. On that commit: `xfb_selftest --unit` OK, self-test 188 of 188, `bun test tools` 90 of 91 (the on-screen capture test needs a visible window), typecheck, redscript and Lua lint clean. The default zip carries no camera presets and keeps `allow_creator_leave = false`, `allow_writes = false` and the bridge off.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.2.0-writes.zip` (**staged**) | `7a978ed5eb0238fe7a6497575291347897038b76f432ebe0f77b20c3db6305be` |
| `xf-runtime-bridge-0.2.0-diagnostic.zip` | `4fe6952cfb2cf3d7899b96330dfa7772e2650996503c624df98b7c2683b809ba` |
| `xf-runtime-bridge-0.2.0.zip` (default) | `d14ea085985af92a803bbf66d7012380de84562f46e2c5fe937aea9b4572b8a9` |
| (`XFRuntimeBridge.dll` inside each) | `6f386846bcc6e3fb180f2bc091f7cb34ff79e980d7812b8e60fe7df0fcc43dca` |

Staged on 26 September 2026 into the MO2 mod `XF Runtime Bridge` in the test profile (first row of its `modlist.txt`; nothing else changed), with `%LOCALAPPDATA%\XFStudio\runtime-bridge\` emptied. The plugin log must show `evt=script.addresses_resolved … script_calls=on` at start.
