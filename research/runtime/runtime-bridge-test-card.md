# Runtime bridge: first session and session 2

**Status: first run on 26 September 2026 stopped at script calls (a crash, since fixed offline); the [script-call check](#script-call-check-first) comes first next time.** The first in-game run of [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md) 0.2.0 (phase 2: command catalogue, MCP server, session runner, write methods behind `allow_writes`), followed directly by [session 2](../../experiments/020-session-2/README.md) run through the bridge. Design and citations: [runtime bridge design](runtime-bridge-design.md).

**Who does what.** The maintainer starts MO2 and the game, loads a save and does the few things only a player can (open a mirror, confirm a look, press the photo-mode key if needed). The coordinator drives everything else through the bridge (MCP tools or the command line) and takes the screenshots. Agents never launch the game or MO2; only the coordinator stages, and only this one entry into the test profile.

| Part | Time | Needs |
|---|---|---|
| [Before the session](#before-the-session-coordinator) | offline | The coordinator stages one mod entry |
| [Script-call check](#script-call-check-first) | 10 min | A save next to a mirror; proves the crash fix |
| [First session](#first-session-bridge-checks) | 15–20 min | A save next to a mirror |
| [Session 2 through the bridge](#session-2-through-the-bridge) | about 25 min | Directly after the first session, same game |
| [Kill switch and wrap-up](#kill-switch-and-wrap-up) | 2 min | End of the evening |

## Before the session (coordinator)

A staging checklist. Nothing here launches anything; the maintainer's everyday profile, frameworks and mod list are never touched.

1. **Build under test.** Use the zips from `projects/xf-runtime-bridge/dist/`, built by `bun tools/package.ts` (it refuses a dirty tree or a DLL not built from `HEAD`):

   | Zip | Bridge | Use |
   |---|---|---|
   | `xf-runtime-bridge-0.2.0-writes.zip` | on, **writes allowed** | **This session**, in the test profile only |
   | `xf-runtime-bridge-0.2.0-diagnostic.zip` | on, read-only | Any other diagnostic profile |
   | `xf-runtime-bridge-0.2.0.zip` | off | Distribution default |

   **Build record** (26 September 2026, `main` at `c31156aaf29b`, clean tree: the script-call fix, RB-29..31, and every earlier review fix; `xfb_selftest --unit` OK, self-test 157 of 157, `bun test tools` 65 of 65, redscript and Lua lint passed on that build). The zip to stage is the `-writes` one:

   | Zip | SHA-256 |
   |---|---|
   | `-writes` | `56cea1a0a50a67b79515b8951e59a6a07c46a664ce639e0bf2f3069cb5673fc9` |
   | `-diagnostic` | `31abda27640d916a3836b43875546bf8c92fcce678b07dd4b4d107b15e3342c2` |
   | default | `aa20435b83d9834e3c2f6a942b7b1e77c9b366414d666b49e71517d2993d2c3b` |
   | (`XFRuntimeBridge.dll` inside each) | `b7b9ef32eb51ef95602904d6c4f86697ae5ee9edce1f3c845e7d76e461e3f824` |

   **New in this build, watch in the first session:** a photo-mode write whose value the menu then reports differently fails with `write_mismatch` and is put back (RB-19). If camera writes fail that way at step 11, note the requested and reported values; the comparison tolerance is one slider step. A light change waits three game ticks between selecting and setting (RB-20). Every game and script call now carries a caller frame and a context (the crash fix; the [script-call check](#script-call-check-first) proves it first), and `photo_camera_set {reset: true}` may answer `partial: true` with `errors` and an undo when a key fails (RB-29).

   **Staged** on 26 September 2026: the build above, unpacked into the MO2 mod `XF Runtime Bridge` (first row of the test profile's `modlist.txt`; nothing else changed), with `%LOCALAPPDATA%\XFStudiountime-bridge\` emptied. Baseline capture `bridge-phase2-pre`.

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

Session 2 continues from here, at the mirror. If a step fails:
- **Redscript error pop-up:** screenshot it, quit, disable `XF Runtime Bridge` in this profile; the coordinator reads `r6/logs/redscript_rCURRENT.log`.
- **Crash:** disable the entry; send the newest `red4ext/logs/*.log` (under MO2: `overwrite/red4ext/logs/`). The last `script.call` or `step` line names the call; `python tools/minidump_summary.py` gives the crash's fingerprint ([game crashes](../../knowledge/game-crashes.md)).
- **`rtti_missing` / `rtti_signature`:** a function differs on 2.31; the call was refused and nothing changed. Carry on; `evt=rtti.signature_mismatch` in the log says what differs.
- **`timeout_after_start`:** the game was slow to confirm; check the game before repeating.
- **`script_layer_missing`:** the redscript part didn't compile; check the redscript log.
- **Anything feels wrong:** stop the bridge with any one of: the CET hotkey bound in step 1; `bridge_kill` (MCP; while a scripted session holds the connection it writes the `KILL` file below instead) or `bun tools/bridge-client.ts kill`; or, if neither answers, an empty file named `KILL` created in `%LOCALAPPDATA%\XFStudio\runtime-bridge\` (the bridge checks for it twice a second). Each cancels any write still queued and undoes a freeze or a hidden photo-mode menu. The save lock stays on purpose, because other changes may still be live; loading the safety save releases it and restores everything else. Delete `KILL` afterwards, or the bridge won't start next time.

## Session 2 through the bridge

The script [`tools/sessions/session-2.json`](../../projects/xf-runtime-bridge/tools/sessions/session-2.json) follows the [session 2 test card](../../experiments/020-session-2/README.md) step for step (generated by `tools/sessions/make-sessions.py`):

- **p0:** bridge and game status; the maintainer confirms the safety save and notes the upscaler, resolution and ray or path tracing (card step 8); the mirror opens.
- **p1, at the mirror's fixed camera:** every option read once (for future scripting), the XF row's values, then the placement pair Lines · new / old / new (card step 2) and a **pause for the coordinator's placement check**: stop the session if the pair doesn't line up. Then Depth A–D, Gloss A–D, Shimmer and Metal, one capture each.
- **p2, photo mode, one confirmed preset at a time:** the bridge sets XF; the maintainer confirms and leaves the mirror; the bridge opens photo mode, frames `eyes` / `face` / `head-and-shoulders`, hides the menu and captures; for Gloss, Shimmer and Metal it turns V in 15° steps either side of facing the camera (150°, 165°, −165°, −150°; Photo Mode Ex clamps rotation to −180…180) as the light sweep; then it leaves photo mode and the maintainer opens the mirror again. Depth D adds the motion check (card step 4) at the mirror. A last pause collects the verdicts.
- **p3, optional (card step 9):** XF Off, then piercings and the heart eye set by hand, one capture each.
- **p4:** Back in the appearance screen, then load the safety save.

Run it in either of two ways, never together with MCP tool calls (the bridge takes one client at a time):

```powershell
cd projects/xf-runtime-bridge
bun tools/session.ts tools/sessions/session-2.json --dry-run          # check the plan; sends nothing
bun tools/session.ts tools/sessions/session-2.json                    # interactive: shows each ask, waits for Enter
bun tools/session.ts tools/sessions/session-2.json --out <folder> --from <label>   # harness: stops at each ask
```

Run by the coordinator (no terminal), the runner stops at each *ask* and prints the `--from` label that continues after it; the coordinator relays the ask, then continues into the same `--out` folder. *Notes* (for example "Confirm and leave the mirror") print while the next `game_wait` waits up to 10 minutes for the player. Every run appends to the folder's `manifest.json` with each step's input, result, undo note, timings and screenshots (`.full.png` at full resolution, `.png` at viewing size, `.json` sidecar). The camera presets used here must be the values calibrated in step 12.

## Kill switch and wrap-up

| # | Who | Do | Expect |
|---|---|---|---|
| 20 | C | `bridge_kill` (or M presses the CET hotkey *Kill XF Runtime Bridge*; fallback: the `KILL` file, see above) | The label turns red "XF bridge: killed"; any freeze and hidden photo-mode menu are undone; the save lock is still held (saving stays blocked until step 21's load; the log's `RestoreAfterKill` line shows `save_lock_kept`); later calls answer plainly that the bridge is off. |
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
