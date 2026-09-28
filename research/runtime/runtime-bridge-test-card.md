# Runtime bridge test card

**Status: session 4 ran on 0.4.1 (`911ad89`) on 28 September 2026 ([results](../../experiments/029-session-4/README.md#3-results); its bridge problems are listed there in §5); the next bridge build is 0.4.2, which fixes what session 4 found (framing drift and the default lens, `photo.open` taking the window's focus, `cc.open` half-opening the creator away from a mirror, the clock in photo mode, expression values and indices, `cc.apply` by label). Its [session-5 checks](#session-5-checks-bridge-042) come first in the next sitting.** Session 3 ran on 0.3.0 the same day ([results](../../experiments/028-session-3/README.md#5-results-28-september-2026)); 0.4.0 fixed its six bridge problems and added a message line, clothing, save and load commands, and 0.4.1 fixed the deep review of 0.4 (RB-51..65). Session 3's plan was, on the 0.3.0 `-writes` build: a short preflight drawn from the checks below, session 2 continued, creator calibration frames, and R1 and R2 as a stretch. The first in-game runs of [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md) 0.2.0 on 26 September 2026 passed the [script-call check](#script-call-check-first) and the [first-session checks](#first-session-bridge-checks), and ran session 2 semi-manually ([results](../../experiments/020-session-2/README.md#results-26-september-2026-run-through-the-runtime-bridge-partial)). Since then the bridge can open photo mode with the player's own key, frame V without hand-tuned values, switch lights on, hide the cursor, keep the creator's row labels in step and press the creator's Confirm and Back, and it has two research commands for the [expression editor](../animation/expression-editor-design.md#8-runtime-questions-r1r5-through-the-bridge) (`face_rig_read`, `photo_expression_index`); batch 3 adds opening the creator (`cc_open`), its camera (`cc_page`), vanilla rows by label, the clock with the creator open and a settings record (`game_options_read`) ([checks](#batch-3-checks-the-creator-from-gameplay-and-the-settings-record)); batch 4 (0.3.0) fixes that batch's review findings, adds an in-game panel in the CET overlay (Reconnect after the kill switch without restarting the game, pause changes) and the live-posing experiment's first steps ([checks](#batch-4-checks-refusals-the-panel-and-live-posing-l0)); all of it is built and tested offline only. Design and citations: [runtime bridge design](runtime-bridge-design.md); photo mode and the creator from script: [knowledge/photo-mode.md](../../knowledge/photo-mode.md). **Every pending in-game ask, ranked into sittings of 20–30 minutes, is in the [next-sessions plan](next-sessions-plan.md)**; this card keeps the bridge's own checks, conventions and build records.

**Who does what.** The maintainer starts MO2 and the game, loads a save, keeps the game window in front, and opens the character creator when asked (a mirror, or F12 with Character Customization Anywhere). The coordinator drives everything else through the bridge (MCP tools or the command line) and takes the screenshots. Agents never launch the game or MO2; only the coordinator stages, and only the `XF Runtime Bridge` entry in the test profile.

| Part | Time | Needs |
|---|---|---|
| [Before the session](#before-the-session-coordinator) | offline | The coordinator restages the `XF Runtime Bridge` entry from a new build |
| [Session 5 checks](#session-5-checks-bridge-042) | 20-25 min | Only with the 0.4.2 build staged; V in her apartment, on foot, then in the street; the game window in front |
| [Session 4 preflight](#session-4-preflight-bridge-041) | 20-30 min | Only with the 0.4.1 build staged; V in her apartment, on foot; the maintainer's answer on inventory writes |
| [Next session: autonomy checks](#next-session-autonomy-checks-expression-checks-then-session-2-continued) | 15–20 min | V in the world in an open, quiet spot; the game window in front |
| [Batch 3 checks](#batch-3-checks-the-creator-from-gameplay-and-the-settings-record) | 10–15 min | Only with the batch 3 build staged; V in normal play, no combat |
| [Batch 4 checks](#batch-4-checks-refusals-the-panel-and-live-posing-l0) | 15–20 min | Only with the 0.3.0 build staged (and, for L1–L6, the XF Live Pose test package); a parked car nearby |
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

   **Staged build:** the autonomy batch and batch 2 (below), rebuilt from `main` at `509f599`; its zip and DLL hashes are in the [build record](#build-record-staged). What it adds to the staged zips: the -writes zip sets `allow_creator_leave = true`, and the -diagnostic and -writes zips carry `r6/tweaks/XFRuntimeBridge/xf_photo_mode_presets.yaml` (XF camera presets 7-9; the default zip doesn't). Check the -writes manifest for `"allow_creator_leave": true` and `"photo_mode_presets"`.

   The earlier branch build of batch 2 (`claude/bridge-batch2`) passed the same checks; the staged build is the `main` rebuild.

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

## Session 5 checks (bridge 0.4.2)

Only with the 0.4.2 build ([build record](#build-record-bridge-042-branch-build-not-staged)). Each row proves one fix from session 4 in the game before a session script relies on it. Tool names are the MCP names; C is the coordinator, M the maintainer.

**Restage first** (coordinator, MO2 closed): **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.4.2-writes.zip`, as for 0.4.1. Check the zip's SHA-256 and its manifest: `"version": "0.4.2"`, `"write_classes": ["photo", "world", "character", "save"]`, `"inventory_writes": false` unless the maintainer has approved inventory writes.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| S1 | M, C | M loads a save in V's apartment, V on foot, **and keeps the game window in front**. C: `bridge_info`, then `photo_open` | `plugin_version` 0.4.2; photo mode opens; the answer says `focus: "require"`, `focused_by_bridge: false` and has no `warning` | Wrong version: stop and restage |
| S2 | C, M | `photo_exit`. M clicks into another window (for example a text editor) and **types there**; C: `photo_open` | Refused `not_foreground`; the game stays behind and nothing M types reaches it | The game came forward: stop, record, and keep to `focus: require` sessions only after a fix |
| S3 | C, M | Still with another window in front: `photo_open {route: "postmessage"}` (research: never changes focus) | Either photo mode opens behind the other window (then posted keys work: record it, a candidate default) or `photo_open_timeout` | — (both answers are results; open question 1 of the [knowledge page](../../knowledge/photo-mode.md#open-questions)) |
| S4 | M, C | M clicks into the game; C: `photo_open` if not open; then the drift sweep: `photo_frame {target: "face", yaw_offset: <y>}` for y = 35, 55, 0, repeated three times (9 frames) | Every answer `lens: "portrait"`, `converged: true`, `chosen.fov` about 9 and `chosen.subject.near_far` about -1.15 **the same each time** (session 4 walked to 92 degrees, then -4.7 and 3 degrees), `distance_m` about 2.2 | A refusal `framing_bound`: record its message (V's space) and the steps in its detail |
| S5 | C | `photo_frame {target: "face"}`, `photo_hud_hide {}`, `capture_screenshot {region: "face"}`; then `photo_frame {target: "face", lens: "wide"}` and the same capture; then `photo_frame {target: "eyes"}` + `capture_screenshot {region: "eyes"}` | Portrait about 9 degrees, wide about 66 (session 4's two sheets), eyes about 5, each `converged` | — |
| S6 | C | Refusal check: `photo_subject {}`, then `photo_frame {target: "eyes", lens: "wide", span_m: 2}`, then `photo_subject {}` again | Refused `framing_bound` naming the field of view needed; the two `photo_subject` readings show the same field of view and placement (everything put back) | The camera was left changed: record both readings |
| S7 | C, M | `photo_frame {target: "face", yaw_offset: 180}` and capture (the back of V's head); then 150 and -150 | Each converges with V facing away by that angle | — |
| S8 | C, M | Light frame: `photo_frame {target: "face", yaw_offset: 90}`; `photo_light_set {light: 1, on: true, brightness: 45, place: {azimuth: 90, elevation: 15, distance: 1}}`, capture; then `place: {azimuth: -90, ...}`, capture | Azimuth 90 (the camera's side, since the camera sits at azimuth `yaw_offset`) lights the face the camera sees; -90 lights the far side (rim only) | Opposite: the frame is the camera's, not V's: record, it changes the docs |
| S9 | C, M | `world_time_set {hours: 2, minutes: 0}` in photo mode; capture; then the answer's undo; then `photo_exit` | `route: "photo_time"`, the scene turns to night; the undo puts photo mode's time back; after `photo_exit` M confirms the world's time of day is as before photo mode (open question: does photo mode give the clock back?) | `unavailable`: record the answer (attribute 70 not as expected) |
| S10 | C, M | `photo_open`; `photo_state {options: true}`: find key 28's option 56; `photo_expression_set {label: "static sleeping"}`, wait 1 s, capture the face; `photo_expression_index {index: 60, target: "head"}` | Option 56 is `Static: Sleeping` with `table_index: 60`, `table_index_by: "label"`; the label sets it (`menu_value: 56`, `table_index: 60`) and the face sleeps; the head target is refused `no_effect` | `table_index_by: "position"` or no `table_index`: record (the display-name match failed) |
| S11 | C, M | `photo_exit`. V walks out of the apartment into the street (away from any mirror). C: `cc_open` | Opens (`route: "pause_menu"`); `game_status` `character_menu`; the creator is fully drawn (no half-open backdrop) and rows change | Half open or stuck: M backs out or loads the save; record the plugin log's `cc.open` lines |
| S12 | C, M | `cc_back`; then M presses Esc | `cc_back` closes cleanly to gameplay; M's Esc opens the ordinary pause menu (the redirect is only for the bridge's request) | The creator opened on Esc: stop, record |
| S13 | C | `player_appearance {}` (in gameplay) | `last_creator_reading` with `age_seconds` and the options read on the screen in S11 | null: the reading wasn't kept (record) |
| S14 | C, M | `cc_open`; `cc_apply {option: "hairstyle", label: "valby curtain bob"}`; capture; then `cc_apply {option: "hairstyle", label: "long pak 011"}` | The first answers `index: 217`, `label: "VALBY CURTAIN BOB"`; the second `index: 142` (the original) | Ambiguous or no match: record the candidates |
| S15 | C | On the lips (`cc_page {page: "lips"}`): `cc_apply {option: "makeupLips_08", index: 6}`, then `cc_apply {option: "makeupLips_color", index: 6}`; then `cc_back` | The first is refused, naming the row in use (`makeupLips_NN` for the chosen style) and the slot `makeupLips_color`; the second changes the colour | Both refused: record the answers |

Evidence: every answer's JSON, the captures (S5 as a portrait/wide/eyes sheet, S7-S8 crops, S9 before and after), the plugin log (`cc.open: the pause menu's scenario switched`, `photo-mode time of day`, `cc.apply … via`), and the command log's `photo.frame` entries for S4.

## Session 4 preflight (bridge 0.4.1)

**Run in session 4** ([results](../../experiments/029-session-4/README.md#31-preflight-bridge-041)):
- **Pass:** P1, P2 (the message line is readable), P3 (converged first try, level), P6 (`held: true`, the face well lit) and P11b.
- **Fail:** P7 (a light re-placed at the camera doesn't light the face) and P9 (`cc.open` away from a mirror leaves the backdrop half-open and the menu busy until a save loads; use Character Customization Anywhere's route).
- **Void:** P13 (the helmet equipped into the Head slot but Thread Locker hid it; the test profile now has Thread Locker disabled).
- **Not recorded:** the other rows.

Only with the 0.4.1 build ([build record](#build-record-bridge-041-branch-build-not-staged)). Each row proves one session-3 fix, one review fix (RB-51..65) or one new command in the game before a session script relies on it. Tool names are the MCP names; the coordinator drives, the maintainer watches and answers.

**Restage first** (coordinator, MO2 closed; RB-65): **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.4.1-writes.zip` rather than copying over them, and make sure the old `r6/tweaks/XFRuntimeBridge/xf_photo_mode_presets.yaml` from 0.3.x is gone (0.4.0 renamed it to `^xf_photo_mode_presets.yaml`; with both present TweakXL reads the old one in directory order and the new one last, so the new values still win, but the leftover is confusing). The `^` file is read after every other tweak file, so for the whole profile it overrides any other mod's `photo_mode.std_preset_6..9` (Portrait Enhancer's among them): stage it only in the dedicated test profile. Check the zip's SHA-256 and its manifest: `"version": "0.4.1"`, `"write_classes": ["photo", "world", "character", "save"]`, `"inventory_writes": false`, and `staging_notes` saying the same two things.

**Ask the maintainer before the session:** may the bridge write to V's inventory (add a test item, equip and unequip clothing; `inventory_equip`/`inventory_unequip`)? Only with a yes does the coordinator add `inventory` to the staged `config.ini`'s `allow_write_classes` (or stage a zip built with `bun tools/package.ts --allow-inventory`); otherwise skip P13. Saving and loading (`game_save`, `game_load`) are allowed in this build, as requested after session 3; P12 saves only with the maintainer's go-ahead.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| P1 | M, C | M loads a save in V's apartment, V on foot. C: `bridge_info`, `game_status` | The build record's commit, `plugin_version` 0.4.1; `write_classes` photo, world, character, save; the plugin log's load lines say `natives=10` | Stop: wrong build |
| P2 | C, M | `ui_message {text: "XF: session 4 preflight starting", level: "info", seconds: 30}`, then `ui_message {text: "XF asks: say when you can read this line", level: "ask", seconds: 60}` | M reads both lines under the "XF bridge: listening" label, top-left, white then amber, wrapped, clear of the middle of the screen; they fade after their seconds | Nothing shows: record `ui_message`'s answer (`note` names a missing CET layer) and the CET mod log |
| P3 | C | `photo_open`; `photo_frame {target: "face", xf_preset: true, look_at: "off"}`; `photo_hud_hide {}`; wait 0.5 s; `capture_screenshot {region: "face"}` | `method: "project"`, `converged: true`, `axis` left_right or near_far, every step's `reads` 2 or more; the face fills the crop, upright (not rolled). If a note says the preset rolled the camera, the preset file still loses to Portrait Enhancer (record which preset values arrived: `photo_state {menu: true}`, keys 1 and 2) | `no_response` or not converged: keep the answer and the command log line (its `detail` has the steps), then `photo_frame {target: "face", xf_preset: true, look_at: "off", max_steps: 12}` once |
| P4 | C | `photo_frame {target: "eyes", xf_preset: true}` + `capture_screenshot {region: "eyes"}`, then `head-and-shoulders` and `full-body` with their regions | Each converged and centred; `axis` recorded per framing | `axis: "vertical-only"`: record it with the capture (V's placement axes ran along the view) |
| P5 | C | `photo_light_set {light: 1, on: true, type: "spot", brightness: 60, hue: 35, saturation: 15}` | Succeeds; `skipped: [{name: "type"}]` with the note that the light keeps its type; light 1 on | `unavailable` for anything but type: record |
| P6 | C, M | `photo_light_set {light: 1, place: {azimuth: 45, elevation: 20, distance: 1.2}}`; wait 1 s; `capture_screenshot {region: "face"}`; `capture_burst {region: "face", frames: 10, interval_ms: 200}` | `placement.route: "moved"`, `held: true`; V's face lit from V's left front (warm), steady across the burst (the light stays where it was put). M says where the light's indicator arrow points. The undo's `place.world` is where the light was (RB-60) | `unavailable` naming a class other than a photo-mode light, two lights sharing one entity, or the indicator showing another light (RB-57's checks): record the message and M's view of the light tab; nothing was moved. `held: false` or the light visibly jumps back: photo mode re-places its lights; go to P7 |
| P7 | C, M | `photo_frame {target: "face", xf_preset: true}`, then `photo_light_set {light: 1, place: {camera: true}}`; capture the face; then the answer's undo; capture again | `placement.route: "switched_again"` with `placement.before` (RB-59); V lit from the front (the camera's side); after the undo (`place: {world}`, the earlier position) the light is back where it was (M: the indicator) | Not lit: record the capture; the light sweep needs a spawned light (lighting mirror design). No `before`: record `before_unknown` |
| P8 | C | If P6 held: the sweep. For azimuth -60, 0 and 60: `photo_light_set {light: 1, place: {azimuth: <a>, elevation: 15, distance: 1.2}}`, wait 0.5 s, `capture_screenshot {region: "face"}`; then the last answer's undo | The light meets the face from V's right, the front and V's left in turn; the undo puts it back | Record |
| P9 | C | `photo_exit`; wait 2 s; `cc_open` (still in the apartment) | Opens (`opened: true`): scene tier 2 is accepted now. `game_status`: `character_menu` | `not_safe_now`: record the `detail` (the tier, or another reason) |
| P10 | C | `player_appearance {option: "skin_type"}`; `cc_apply {option: "skin_type", index: <its current index>}`; then `cc_apply {option: "skin_type", index: <another>}`, wait 2 s, `player_appearance {option: "skin_type"}`; then `cc_apply` back to the first index | The first apply answers `changed: false`, `route: "none"`; the second changes the skin and `menu.busy` is false again within 2 s; the third succeeds | `busy` that doesn't clear: record `menu.change_pending`. With a change pending the bridge never forces it (RB-54): after 12 s the plugin log says "still in flight; not forcing it" and `cc_back` leaves. With nothing pending, a flag set for 8 s with no completion event is cleared as stale on the next call (the log says so) |
| P11 | C | `cc_back`; `cc_open`; `cc_confirm` straight away (nothing changed) | Either `closed_with: "back"` with the note "nothing to confirm" (`kept: false`, `changed: false`), or `closed_with: "confirm"` if the screen reported a change event while setting itself up (record `changes`); both leave V's look as it was. The creator closes | Refused `busy`: record |
| P11b | C, M | RB-51: `cc_open`; `cc_apply {option: "skin_type", index: <another>}` (note its `route`), wait 2 s; `cc_confirm`; `player_appearance {option: "skin_type"}`. If a row the screen isn't showing is to hand (the answer says `route: "system"`), repeat with it | `closed_with: "confirm"`, `kept: true`, `changes` 1 or more; the new skin is kept after the screen closes (never discarded), by either route | `closed_with: "back"` after a change: **stop**, the fix failed; record the answer and the plugin log's `cc.confirm` line. Put the skin back afterwards with `cc_open`, `cc_apply` and `cc_confirm`, or by the safety save's load at P14 |
| P12 | C, M | `game_save {name: "session 4 preflight"}` | Refused `bridge_save_lock` (the bridge changed things since the load), in plain words naming `override_lock` | — |
| P12a | C, M | RB-53: M presses **Pause changes** in the XF panel; C: `game_save {name: "paused", override_lock: true}`; M presses **Resume changes** | Refused `writes_paused`; nothing saved; `game_status` still `bridge_save_lock: true` | Saved: record |
| P12b | C, M | Only with M's go-ahead: `game_save {name: "session 4 preflight", override_lock: true}` | `saved: true`, `lock_overridden: true`; M sees a new manual save at the top of the Load menu; `game_status` shows `bridge_save_lock: true` again (RB-52: the plugin's last step retakes it, the log's "save lock requested" line after the save) | `save_uncertain` or `saving_locked`: record the answer; M checks the Load menu; `game_status` must still show `bridge_save_lock: true` (RB-52 on those paths too) |
| P13 | C, M | Only with the inventory approval and the class enabled: `inventory_equip {item: "Items.Helmet_01_basic_01", add_if_missing: true}`; `photo_open`, `photo_frame {target: "face", xf_preset: true}`, capture; `photo_exit`; then the equip's undo | `equipped: true` (`added` says whether the helmet was new); the helmet on V's head over the makeup, covering it without clipping through. A vanilla helmet doesn't hide the head (no vanilla item carries `hide_Head`), so this is only the helmet half of session 3's B7; the `hide_Head` half needs a mod item ([next-sessions plan](next-sessions-plan.md#n2-finish-close-out-headgear-kill-switch) 2.6); the undo takes it off and, if added, out of the inventory: the very copy the bridge added, by its own item ID, and `equipped` decided by record ID, not by name (RB-63) | `not_safe_now` or `not_in_gameplay`: record; `bad_params`: the record isn't clothing on this install |
| P14 | C, M | RB-56: `game_load {latest: true}` (without `discard_unsaved`) is refused in plain words. RB-58: `game_load {name: "ManualSave-99999", discard_unsaved: true}` is refused `save_not_found` and lists names; then `game_load {name: <the newest ManualSave in that list, the safety save or P12b's>, discard_unsaved: true}`; `game_wait {phase: ["gameplay"], timeout_ms: 90000}`; `game_status` | The first is refused `bad_input` naming `discard_unsaved: true`, nothing loads; the named save loads (M checks it is the one named, by its time in the Load menu); `bridge_save_lock: false` | Another save loaded: **stop**, record both answers and the plugin log's `game.load` line (its position); M loads by hand. Fallback: `game_load {latest: true, discard_unsaved: true}` |
| P15 | C, M | `bun tools/session.ts <a two-step script: a note, then an ask>` (interactive); then run it again and press Ctrl+C once at the ask; then once more with `--no-ask` | After Enter, the ask disappears and "XF session complete" shows. After Ctrl+C (RB-64), the ask disappears and "XF session stopped" shows. With `--no-ask` the run pauses and one amber line says where it waits (`XF session paused at "<label>": <the ask>`) | Record the step records' `echoed` and what stayed on screen |
| P16 | C, M | `ui_message {text: "XF: kill switch next", seconds: 120}`; M presses the kill hotkey | The label turns red and the message disappears at once; M presses Reconnect in the panel | The line stays: record |

Evidence: every answer's JSON, the captures and bursts, the plugin log (`photo light 1 moved`, `cc.apply … already`, `busy flag was stale`, `still in flight`, `nothing to confirm`, `cc.confirm: the look is kept`, `game.save`, `save lock requested`, `game.save_relock`, `game.load`, `inventory.equip` lines), the CET mod log, and the command log (`logs/commands-<day>.jsonl`, whose failed `photo.frame` lines now carry the steps). Afterwards: [photo mode](../../knowledge/photo-mode.md) and [photo-mode lights](../../knowledge/photo-mode-lights.md) (open questions 5 and 6), and this card's results.

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
| A13 | M, C | With an XF Eye Artistry look on, M equips a mod item whose `.app` carries `hide_Head` (no vanilla item does). C: `capture_screenshot {region: "face"}` in photo mode | The makeup hides with the head. Needs a build with the `hx_xfs_c<key>_makeup` component (28 September); older builds' `xfs_c<key>_makeup` is expected to float. If an `hx_` build floats, ArchiveXL's prefix rule isn't what the source says ([clothing knowledge](../../knowledge/clothing.md#open-questions)); record it | Record and carry on |

Then run the [expression checks](#expression-checks-r1-and-r2), then session 2 continued (below). The kill-switch check with the cursor hidden is at the [wrap-up](#kill-switch-and-wrap-up). With the batch 3 build staged, run its [checks](#batch-3-checks-the-creator-from-gameplay-and-the-settings-record) after A12, and A10 may open the creator with `cc_open` instead of F12.

## Batch 3 checks: the creator from gameplay and the settings record

Only with the batch 3 build ([build record](#build-record-batch-3-branch-build-not-staged)). Each check proves one new command before the session scripts rely on it; the scripts fall back to the player (a note, then `game_wait`) wherever a check fails.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| C1 | C | `game_options_read` | A `summary` with the upscaler and its mode, ray and path tracing, SSS quality, HDR and the camera effects matching the game's settings menu; `render_options.available: true` with values for the hair, skin, rim and eye options (a short `missing` list at most) | `available: false`: record the reason; the CET layer's log line `render options answered` shows whether CET saw the request |
| C2 | C | V in normal play, no combat: `cc_open` | The creator opens by itself within about 2 s: `opened: true`, `edit_mode: "HairDresser"`, `saving_locked: true`; `game_status` shows `character_menu` and `bridge_save_lock: true`; the plugin log has `cc.open requested` then `switched to MenuScenario_CharacterCustomizationMirror`. Note whether V stands in the creator's own lit box, as at a mirror | `save_lock_not_held`: repeat once. `creator_open_timeout`: record the phase; M opens the creator with F12 |
| C3 | C | `player_appearance {option: "piercings"}` | `menu.updating_finalized_state: true`, `edit_mode: "HairDresser"`; the bottom buttons show the mirror's labels (Back and Confirm, not Next) | Record the labels |
| C4 | C | `cc_apply {option: "piercings", value: "09"}`, wait 1.5 s, `cc_apply {option: "piercings_color", value: "gold"}`, then `cc_page {page: "eyes"}`, wait 1 s, `capture_screenshot {region: "cc-eyes"}` | Style 9 in gold (`matched_by: "value"`, `value_label` names it); the camera moves to the head, then to the eyes zoom, and the `cc-eyes` crop frames both eyes and brows | A colour refused: read `player_appearance {option: "piercings_color"}` and note the value names. The zoom differs: record it |
| C5 | C | `world_time_set {hours: 0}`, wait 2 s, `capture_screenshot {region: "cc-eyes"}`, then the result's undo | The clock changes with the screen open (`phase: "character_menu"`); the screen stays open and responsive. Compare the two captures (next-sessions plan 5.8) | Anything odd (flicker, the screen closing): run the undo, record it |
| C6 | C | `cc_back`; `cc_open {mode: "ripperdoc"}`; `cc_apply {option: "eyes", value: "10"}`, capture; `cc_back` | The ripperdoc mode offers the eye-shape row (`edit_mode: "Ripperdoc"`, the apply succeeds); Back discards | `can't be changed on this screen`: record `edit_mode` |
| C7 | C | `photo_open`, `photo_frame {target: "full-body", xf_preset: true}`, `photo_hud_hide {}`, wait 0.5 s, `capture_screenshot {region: "full-body"}`, then `photo_hud_hide {hidden: false}`, `photo_exit` | V from head to feet, centred (`converged: true`); preset 6 put the camera well back | Record the framing result and whether the camera moved lower or higher than V's middle |


## Batch 4 checks: refusals, the panel and live posing (L0)

Only with the 0.3.0 build ([build record](#build-record-batch-4-branch-build-not-staged)). D1–D7 prove batch 4's fixes and the CET panel; L1–L6 are the live-posing experiment's first steps ([pose editor design §7.4](../animation/pose-editor-design.md#74-first-experiment-plan-one-supervised-session), LP1–LP3 and LP7) and need the separate **XF Live Pose (test)** package staged as its own MO2 entry in the test profile (`xf-live-pose-test-0.3.0.zip`; it needs ArchiveXL and TweakXL, both installed). **Before L3, ask the maintainer to confirm the carrier write** (the design's question Q6: a new kind of write, into the memory of our own loaded clip; the -writes build allows it through `allow_live_pose`). Stop the L steps at the first unexpected answer and keep it.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| D1 | C | `bridge_info`, `game_status` | `plugin_version` 0.3.0 and the build record's commit; `allow_live_pose: true`. Plugin log: `evt=live_pose.addresses_resolved … live_pose=on` beside `script_calls=on` | `live_pose=off`: the L steps will answer `live_pose_unavailable`; record the log line |
| D2 | M, C | M gets V into a parked car and stays still. C: `cc_open` | Refused in plain words, `not_safe_now` with "V is in a vehicle" in `detail`; nothing opens, and `game_status` shows `bridge_save_lock` unchanged (the refusal comes before the save lock). M gets out | Anything opens: `cc_back`, stop and send the log |
| D3 | M, C | V on foot. C: `cc_open`; as soon as the creator shows, M presses the kill hotkey | The creator stays open for the player (by design); the label turns red; the plugin log has `bridge.kill_restored` (`save_lock_kept: true`). A request still waiting at the kill would be withdrawn (`creator_open_withdrawn`; the offline test proves that path, which can't be caught by hand). M presses Back in the creator | The creator closes by itself, or the game freezes: record |
| D4 | M, C | M opens the CET overlay: the **XF Runtime Bridge** window says "Stopped by the kill switch" with a **Reconnect** button. M presses it | Within a second or two: "Reconnected. XF tools connect again by themselves."; the label is amber again. C: `bridge_ping` works without restarting anything; `bridge_info` shows a new `sid` and `bridge.rearms: 1`; `game_status` still `bridge_save_lock: true`; no `KILL` file in the runtime folder | "Couldn't reconnect: …": record the message and `bridge_info`'s `last_rearm`; restart the game as before |
| D5 | M, C | In photo mode (`photo_open`). M presses **Pause changes** in the window. C: `photo_camera_set {fov: 30}`, `game_status` | Refused, `writes_paused`, in plain words; the label says "writes paused"; `game_status.writes_paused: true`. M presses **Resume changes**; C repeats: the field of view changes | — |
| D6 | C | `game_options_read` | As C1; `render_options` has no `too_long` or `skipped` list (or a short one, named) | `available: false` with a reason: record it (no longer "didn't answer within 3 s" when CET's answer was refused) |
| D7 | C | `cc_open {mode: "ripperdoc"}`; `cc_apply {option: "piercings_color", value: "gol"}`, then `cc_apply {option: "eyes", value: "12"}`; `cc_back` | The colour answers `matched_by: "partial"` (a word's partial match, named); the eye shape answers `matched_by: "value"` with position 12's label (a number never matches inside another name) | Record the answers |
| L1 | C | In photo mode: `photo_state {options: true}`; `photo_pose_set {record: "xfs_live_carrier"}`; `photo_frame {target: "full-body", xf_preset: true}`, `photo_hud_hide {}`, `capture_screenshot {region: "full-body", name: "l1-carrier"}` | Key 5 lists "XF Live" and, with it selected, key 6 lists "XF Live Carrier"; the pose answer names both with an undo; V stands in the rig's reference pose (arms out) | Not listed: ArchiveXL or TweakXL didn't load the package (their logs); `photo_pose_set`'s refusal says which step failed |
| L2 | C | `pose_live_read {expect_hash: "<keys_hash from the build record>"}` | `layout: "ok"`, `carrier_contract: "ok"`, 142 keys with joint names, `matches_offline: true`. Keep the whole answer | `layout_unrecognised`, `carrier_not_loaded` or `matches_offline: false`: **stop the L steps** and keep the answer (it lists every mismatch) |
| L3 | M, C | After the maintainer's OK: `pose_live_apply {joints: [{joint: "RightForeArm", rotation: [0, 0, 0.3827, 0.9239]}]}` (45° about the forearm's own Z from its reference, which is nearly the identity), at once `capture_burst {region: "full-body", frames: 10, interval_ms: 50}` | Whether the right forearm bends, and on which frame: the experiment's question (the engine sampling the carrier's keys live) | No change: go on with L4 |
| L4 | C | Only if L3 changed nothing: `pose_live_read` (expect `bridge_wrote: true`), then `photo_pose_set` the previous pose (L1's undo) and `photo_pose_set {record: "xfs_live_carrier"}` again, capture; then `photo_exit`, `photo_open`, the carrier again, capture | Re-selecting shows the bent arm (cached per selection) or only a new photo mode does (cached per load; the carrier then loads with its own keys, so expect the reference pose) | Record which |
| L5 | C | `pose_live_apply {restore: true}`, capture; then the L3 apply again and `bridge_kill` | The reference pose returns (`restored: true`); after the kill the plugin log has `bridge.kill_restored_pose` with `restored: true`. M presses Reconnect (D4) | Record |
| L6 | M | Leave photo mode, load the safety save | Nothing persists | — |

Evidence: every answer's JSON (L2's in full), the captures and bursts, the plugin log (`live_pose.*`, `bridge.rearm*`, `bridge.writes_paused` lines) and the CET mod log (`panel:` lines). Afterwards the answers go into the [pose editor design](../animation/pose-editor-design.md) (L0's result) and [poses](../../knowledge/poses.md) (open question 7).

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

## Build record (bridge 0.4.2, branch build, not staged)

Built 28 September 2026 on `claude/bridge-042` at `f03657dd55e0`, clean tree (`XFB_BUILD=f03657dd55e0a9872880f9348f9924a8694d20b6;dirty=0`), by `bun tools/package.ts`: version 0.4.2, session 4's fixes on top of 0.4.1. On that commit: `xfb_selftest --unit` OK (265 checks), self-test 332 of 332, `bun test tools` 181 of 182 (the one failure, the screen-route capture test, needs its synthetic window uncovered on the desktop and passes on its own: 26 of 26 in `capture.test.ts`), typecheck, redscript lint (against a copy of the installed 2.31 `final.redscripts`, SHA-256 `2119046f…ee86`, as for 0.4.1) and Lua lint clean. The packages carry what 0.4.1's did: the default zip keeps the bridge off with every switch off and no presets or panel; the -diagnostic zip adds the presets and the panel, read-only; the -writes zip allows writes with the classes photo, world, character and save, with the creator and the live-pose carrier. **Inventory writes are off** (`"inventory_writes": false`). A rebuild after merging gives new hashes.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.4.2-writes.zip` | `4e93b23567c0de09d1e4f971e9c0fe610dc2fba5802f3894004c9fef3bc3da01` |
| `xf-runtime-bridge-0.4.2-diagnostic.zip` | `b9e216062fe3ceed14000b7145891c8b73daa42faa9fc2c5b9795c5b5a095c1a` |
| `xf-runtime-bridge-0.4.2.zip` (default) | `a60472e1cd1fc7167dddc4f4ddf805666b46ab460f891f0616814b6bf45db768` |
| (`XFRuntimeBridge.dll` inside each) | `ed4f19054e91eab4abe69b0586e1371b4c95b251662544e68f8b1a033f94a40f` |

**New in this build, watch in the session:** `photo_open` refuses `not_foreground` unless the game window is already in front (S1-S3); `photo_frame` answers `lens`, `bounds` and `distance_m`, starts face and eyes frames from the portrait pose and refuses `framing_bound` (S4-S7); `cc_open` answers `route: "pause_menu"` and the plugin log says "the pause menu's scenario switched" (S11-S12); `world_time_set` in photo mode answers `route: "photo_time"` (S9). The [session-5 checks](#session-5-checks-bridge-042) cover each fix.

## Build record (bridge 0.4.1, branch build, not staged)

Built 28 September 2026 on `claude/cleanup-bridge-0.4` at `911ad89941ac`, clean tree (`XFB_BUILD=911ad89941accdbe34500f1db1b2dfd603efad14;dirty=0`), by `bun tools/package.ts`: version 0.4.1, the fixes of the deep review of 0.4 (RB-51..65, [code-health ledger](../authoring/code-health.md#fixed-in-claudecleanup-bridge-04)) on top of 0.4.0. On that commit: `xfb_selftest --unit` OK (261 checks), self-test 328 of 328, `bun test tools` 164 of 164, typecheck, redscript lint (against a copy of the installed 2.31 `final.redscripts`, SHA-256 `2119046f…ee86`) and Lua lint clean. The packages are as 0.4.0's: the default zip keeps the bridge off with every switch off and carries no presets or panel; the -diagnostic zip adds the presets (`^xf_photo_mode_presets.yaml`) and the panel, read-only; the -writes zip allows writes with the classes photo, world, character and save, with the creator and the live-pose carrier. **Inventory writes are off** (`"inventory_writes": false`). The -diagnostic and -writes manifests now carry `staging_notes` (RB-65). A rebuild after merging gives new hashes.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.4.1-writes.zip` | `28254d395c8e0e7d56f38cda48b7b544c932fef6ee096b0f0a54a0eeb64a2d45` |
| `xf-runtime-bridge-0.4.1-diagnostic.zip` | `490e74632e73e9da121d53c30928300b1d28bfc4107949ee25d639b3f00f8e0b` |
| `xf-runtime-bridge-0.4.1.zip` (default) | `9e3e3520383015aa22489bbf67cd1d580205f748874b5ca08d43830103167fc9` |
| (`XFRuntimeBridge.dll` inside each) | `9ede14831e5e91c7195829a4f606152619066e69d05e496a6bee8bc1f9a81abf` |

**New in this build, watch in the session:** everything 0.4.0 listed (`natives=10`, the message line, failed `photo.frame` steps in the command log, the renamed presets file), plus: `cc_confirm` answers `closed_with` (`back` only when certainly nothing changed; P11, P11b); `game_load` needs `discard_unsaved: true` (P14); a save with `override_lock` leaves `bridge_save_lock: true` whatever happens (P12b); `photo_light_set`'s `place` refuses, with the reason, to move an entity it can't prove is that light (P6). The [session-4 preflight](#session-4-preflight-bridge-041) checks each fix.

## Build record (bridge 0.4.0, branch build, not staged)

Built 28 September 2026 on `claude/bridge-0.4` at `82574b7e8345`, clean tree (`XFB_BUILD=82574b7e8345c4628b9bf43e491426081d98fb80;dirty=0`), by `bun tools/package.ts`: version 0.4.0, session 3's six fixes (framing waits for each change and picks its axis, presets read last and the camera levelled, light placement and the missing type row, scene tier 2 accepted, the creator's busy flag, `cc.confirm` with nothing to confirm) and the requested `ui.message`, `inventory.equip`/`inventory.unequip` and `game.save`/`game.load`. On that commit: `xfb_selftest --unit` OK (241 checks), self-test 308 of 308, `bun test tools` 155 of 155, typecheck, redscript lint (against the installed 2.31 `final.redscripts`, SHA-256 `2119046f…ee86`) and Lua lint clean. The default zip keeps the bridge off with every switch off and carries no presets or panel; the -diagnostic zip adds the presets (`^xf_photo_mode_presets.yaml`) and the panel, read-only; the -writes zip allows writes with the classes photo, world, character and **save**, leaving the creator and the live-pose carrier. **Inventory writes are off** (`"inventory_writes": false`): add `inventory` to the staged `allow_write_classes` only after the maintainer approves, or rebuild with `--allow-inventory`. A rebuild after merging gives new hashes.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.4.0-writes.zip` | `be3f588db383a82e2e488763be93443e22af5b02fa43d20cec0d75cd1faccc0d` |
| `xf-runtime-bridge-0.4.0-diagnostic.zip` | `c425b719e80169e8d296fd2069d59770f898ac343ae44d8bd221a31123c68429` |
| `xf-runtime-bridge-0.4.0.zip` (default) | `23feb9f9faaf96f94e52dccf1ab55c4e69b75a5debb9bf3a8347172019c21927` |
| (`XFRuntimeBridge.dll` inside each) | `8c76afd0b07f12dd87447ac2093667e219066c44a68a40fd30453a02bb488a4c` |

Superseded by 0.4.1 before it was staged: the deep review found `cc.confirm` could discard a change and `game.save` with `override_lock` could leave the save lock off (RB-51, RB-52).

## Build record (batch 4, branch build, not staged)

Built 27 September 2026 on `claude/bridge-batch4` at `f194020394e9`, clean tree (`XFB_BUILD=f194020394e9ab003414365af3986b203eca04b7;dirty=0`), by `bun tools/package.ts`: version 0.3.0, batch 4 (RB-42..49, the CET panel with Reconnect and the write pause, `photo.pose.set`, `pose.live.read`, `pose.live.apply`) on top of batch 3. On that commit: `xfb_selftest --unit` OK (196 checks), self-test 263 of 263, `bun test tools` 119 of 119, typecheck, redscript lint (against the installed 2.31 `final.redscripts`, SHA-256 `2119046f…ee86`) and Lua lint clean. The default zip carries no camera presets, no CET panel and no carrier, and keeps the bridge off with `allow_writes`, `allow_creator_leave` and `allow_live_pose` false; the -diagnostic zip adds the presets and the panel, read-only; the -writes zip also allows writes, leaving the creator and the live-pose carrier. A rebuild after merging gives new hashes.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.3.0-writes.zip` | `56f1aff69c165120d57843d3eda72e64e3cf2380477b898fed5e6ca297436519` |
| `xf-runtime-bridge-0.3.0-diagnostic.zip` | `64f0bb501b1635dbae200753595393f4e643b07728022541aeb8c998ed306dd8` |
| `xf-runtime-bridge-0.3.0.zip` (default) | `5d16529654c99afa6d904e146c046c9a99b9e4a2226ab606ac47bba365e42f04` |
| (`XFRuntimeBridge.dll` inside each) | `de489a4c1726eeea1a7023f4085dcb5a52a094d049c43374d78f27f26fa41789` |

**The live-pose test package**, built from the same commit by `bun tools/live-pose/build-carrier.ts` with WolvenKit 9.0.1 from the development PC's own `woman_base.rig` (a separate MO2 entry, the test profile only; its build is not byte-reproducible, WolvenKit's archive differs per run):

| File | SHA-256 |
|---|---|
| `xf-live-pose-test-0.3.0.zip` | `4087ea3006658070a24af6ac75f770c4c212628b2fa59de8d8a21aa90de0803e` |
| keys hash (`pose_live_read`'s `keys_hash`; pass as `expect_hash` in L2) | `0946bdcce29c7220` |

The verifier read the built set back through WolvenKit: one clip, `xfs_live_carrier`, 71 joints, 142 constant keys (a rotation and a translation per joint, every one equal to the plan), 13 constant track keys, no animated keys and no fallback frames; the archive holds only `xf\live_pose\xfs_live_carrier_female.anims`.

**New in this build, watch in the session:** the plugin log's load lines add `evt=live_pose.addresses_resolved … live_pose=on`; the CET overlay shows the **XF Runtime Bridge** window with Reconnect, Pause changes and Stop the bridge (test builds); `cc_open` refuses in a vehicle or a Johnny section, and a timed-out request the menu took answers `creator_open_uncertain`; `game_options_read` may list `too_long` or `skipped` render options.

## Build record (batch 3, branch build, not staged)

Built 27 September 2026 on `claude/bridge-batch3` at `5915567530378c42`, clean tree (`XFB_BUILD=5915567530378c42b16c1179e41e13bc0fc843af;dirty=0`), by `bun tools/package.ts`: batch 3 (`cc.open`, `cc.page`, `cc.apply` by value and slot, the clock with the creator open, `game.options.read`, XF camera preset 6) on top of the staged batch 2. On that commit: `xfb_selftest --unit` OK (150 checks), self-test 217 of 217, `bun test tools` 100 of 100, typecheck, redscript lint (against the installed 2.31 `final.redscripts`, SHA-256 `2119046f…ee86`) and Lua lint clean. The default zip carries no camera presets and keeps the bridge off, `allow_writes = false` and `allow_creator_leave = false`. A rebuild after merging gives new hashes.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.2.0-writes.zip` | `a4375e8e6875a925e05025909a81daa38fb49fe6e9d661cd350ffe190b3fbb5d` |
| `xf-runtime-bridge-0.2.0-diagnostic.zip` | `a1495145c64e5ca0842f98e654cff62ca7f4cf58741c426de0bfb93983fbaaf0` |
| `xf-runtime-bridge-0.2.0.zip` (default) | `bc6583acf93f844e1a29e43a108c54bf0bb4358c5da83aef1fd2abfe8d4fcd47` |
| (`XFRuntimeBridge.dll` inside each) | `1c949d05645b620b08b5d44e839b75516a26c17be2a83dc4e166c3eb9f341977` |

**New in this build, watch in the session:** the CET layer polls the plugin four times a second for render-option requests (a `render options answered` debug line in the CET mod log per request); `cc_open` writes `cc.open requested` and, a frame or two later, `switched to MenuScenario_CharacterCustomizationMirror` into the plugin log; the session scripts no longer ask the player to open the creator or set vanilla rows.

## Build record (staged)

Built 26 September 2026 from `main` at `509f5995f681`, clean tree (`XFB_BUILD=509f5995f681c46ed0be3939185327f9f9e92040;dirty=0`), by `bun tools/package.ts`: bridge batch 2 (RB-32..41, `face.rig.read`, `photo.expression.index`) on top of the autonomy batch. On that commit: `xfb_selftest --unit` OK, self-test 188 of 188, `bun test tools` 90 of 91 (the on-screen capture test needs a visible window), typecheck, redscript and Lua lint clean. The default zip carries no camera presets and keeps `allow_creator_leave = false`, `allow_writes = false` and the bridge off.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.2.0-writes.zip` (**staged**) | `7a978ed5eb0238fe7a6497575291347897038b76f432ebe0f77b20c3db6305be` |
| `xf-runtime-bridge-0.2.0-diagnostic.zip` | `4fe6952cfb2cf3d7899b96330dfa7772e2650996503c624df98b7c2683b809ba` |
| `xf-runtime-bridge-0.2.0.zip` (default) | `d14ea085985af92a803bbf66d7012380de84562f46e2c5fe937aea9b4572b8a9` |
| (`XFRuntimeBridge.dll` inside each) | `6f386846bcc6e3fb180f2bc091f7cb34ff79e980d7812b8e60fe7df0fcc43dca` |

Staged on 26 September 2026 into the MO2 mod `XF Runtime Bridge` in the test profile (first row of its `modlist.txt`; nothing else changed), with `%LOCALAPPDATA%\XFStudio\runtime-bridge\` emptied. The plugin log must show `evt=script.addresses_resolved … script_calls=on` at start.
