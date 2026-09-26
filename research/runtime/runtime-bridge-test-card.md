# Runtime bridge: first session and session 2

**Status: staged, not yet run.** The first in-game run of [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md) 0.2.0 (phase 2: command catalogue, MCP server, session runner, write methods behind `allow_writes`), followed directly by [session 2](../../experiments/020-session-2/README.md) run through the bridge. Design and citations: [runtime bridge design](runtime-bridge-design.md).

**Who does what.** The maintainer starts MO2 and the game, loads a save and does the few things only a player can (open a mirror, confirm a look, press the photo-mode key if needed). The coordinator drives everything else through the bridge (MCP tools or the command line) and takes the screenshots. Agents never launch the game or MO2; only the coordinator stages, and only this one entry into the test profile.

| Part | Time | Needs |
|---|---|---|
| [Before the session](#before-the-session-coordinator) | offline | The coordinator stages one mod entry |
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

   **Build record** (26 September 2026, `main` at `fa2447295b48`, clean tree; self-test 95 of 95 and `bun test tools` 50 of 50 passed on that build). The staged zip is the `-writes` one:

   | Zip | SHA-256 |
   |---|---|
   | `-writes` | `0e30dd10b4a0c8144ed0c276d052aea05a63de9249c08e46f7e01345d00f56c3` |
   | `-diagnostic` | `387f7167721989987a532e0cb2989ad6520f1755b6a7559d190f563eb17a4bde` |
   | default | `cdf6ff5a7e730a39fafc917302314db838d3d9884ab8e7f2a1ea9db28802623d` |

   **Staged** on 26 September 2026: the `-writes` zip unpacked into the MO2 mod `XF Runtime Bridge`, enabled as the first row of the test profile's `modlist.txt`; nothing else changed. Baseline capture `bridge-phase2-pre` taken.

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

4. **Photo-mode mods in this profile** that meet the bridge: *Photo Mode Preferences* re-applies its saved settings each time photo mode opens, so wait about 2 s after photo mode opens before the first camera change (the session script's waits allow for this). *Photo Mode Unlocker XL* widens slider ranges; the bridge checks values against the ranges the menu reports, so wider ranges are simply accepted. *Photo Mode Pose Selector*, *Customisable Photo Mode UI* and *Equipment-EX* add menu items; the first `photo_state` dump records them. Photo Mode Ex is not in the profile (it would persist depth of field into saves; the scripts never write depth of field anyway).

5. **Runtime folder.** `%LOCALAPPDATA%\XFStudio\runtime-bridge\` must hold no `session.json` and no `KILL`; delete leftovers.

6. **Coordinator tooling.** In `projects/xf-runtime-bridge`: `bun install`, then register the MCP server (see the [README](../../projects/xf-runtime-bridge/README.md#mcp-server)) and restart the MCP client so it lists the `xf-runtime-bridge` tools. The CLI (`bun tools/bridge-client.ts run <command>`) is the fallback.

7. **Baseline capture:** `python tools/capture_session.py --label bridge-phase2-pre --profile "XF Studio diagnostic 2026-09-25"`.

8. **Tell the maintainer before the session:** use a save next to a mirror (V's apartment bathroom works); make a new manual save when asked, before the first change (this profile shares the save folder, and after the first change the bridge holds a save lock until a save is loaded); the game must run in **borderless windowed** or windowed mode for captures that include overlays, and the screenshot route is recorded either way.

## First session: bridge checks

Tool names are the MCP names; the CLI takes the dotted name (`bridge_ping` is `bun tools/bridge-client.ts run bridge.ping`). Every result carries a correlation id (`cid`) that also appears in the plugin log. Stop at the first unexpected result in steps 1–4 and send the red4ext logs.

| # | Who | Do | Expect | Undo |
|---|---|---|---|---|
| 1 | M | In MO2 select **XF Studio diagnostic 2026-09-25** and launch the game. Wait for the main menu. | No redscript error pop-up. An amber **"XF bridge: listening (writes ON)"** label at the top left once CET has loaded. | — |
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
| 13 | M, C | M turns light 1 on in the photo-mode menu. C: `photo_light_set {light: 1, brightness: 80, hue: 30}` | The light changes colour and brightness (the bridge selects the light, waits 150 ms, then sets it). | The result's `undo` |
| 14 | C | `photo_hud_hide`, wait 0.5 s, `capture_screenshot {region: "face"}`, `photo_hud_hide {hidden: false}` | The photo-mode menu fades out, the capture is clean, the menu returns. | `hidden: false`; reopening photo mode always shows it |
| 15 | C | `photo_expression_set {faceId: <a value from step 10's expression list>}` | V's expression changes; a value not in the list is refused with a plain message. | The result's `undo` |
| 16 | C | `cc_apply {option: "XF", index: 1}` (still in photo mode) | Refused in plain words: needs the appearance screen. Nothing changes. | — |
| 17 | C | `photo_exit` | Back in the world. | `photo_enter` |
| 18 | M, C | M opens the mirror's appearance screen. C: `game_wait {phase: ["character_menu"]}`, `player_appearance {option: "XF"}` | Phase `character_menu`; the XF row lists Off plus 12 with their names. | — |
| 19 | C | `cc_apply {option: "XF", index: 1}`, `capture_screenshot`, then `cc_apply {option: "XF", index: 0}` | Depth A appears on V in the preview and the XF row shows its name; then Off. The bridge never confirms. | Back in the appearance screen discards every change |

Session 2 continues from here, at the mirror. If a step fails:
- **Redscript error pop-up:** screenshot it, quit, disable `XF Runtime Bridge` in this profile; the coordinator reads `r6/logs/redscript_rCURRENT.log`.
- **Crash:** disable the entry; send the newest `red4ext/logs/*.log` (under MO2: `overwrite/red4ext/logs/`).
- **`rtti_missing` / `rtti_signature`:** a function differs on 2.31; the call was refused and nothing changed. Carry on; `evt=rtti.signature_mismatch` in the log says what differs.
- **`timeout_after_start`:** the game was slow to confirm; check the game before repeating.
- **`script_layer_missing`:** the redscript part didn't compile; check the redscript log.
- **Anything feels wrong:** `bridge_kill` (or the CET hotkey) switches the bridge off and undoes what it left on (freeze, hidden photo-mode menu, save lock). Loading the safety save restores everything else.

## Session 2 through the bridge

The script [`tools/sessions/session-2.json`](../../projects/xf-runtime-bridge/tools/sessions/session-2.json) follows the [session 2 test card](../../experiments/020-session-2/README.md) step for step (generated by `tools/sessions/make-sessions.py`):

- **p0:** bridge and game status; the maintainer confirms the safety save and notes the upscaler, resolution and ray or path tracing (card step 8); the mirror opens.
- **p1, at the mirror's fixed camera:** every option read once (for future scripting), the XF row's values, then the placement pair Lines · new / old / new (card step 2) and a **pause for the coordinator's placement check**: stop the session if the pair doesn't line up. Then Depth A–D, Gloss A–D, Shimmer and Metal, one capture each.
- **p2, photo mode, one confirmed preset at a time:** the bridge sets XF; the maintainer confirms and leaves the mirror; the bridge opens photo mode, frames `eyes` / `face` / `head-and-shoulders`, hides the menu and captures; for Gloss, Shimmer and Metal it turns V in 15° steps (150°–210°) as the light sweep; then it leaves photo mode and the maintainer opens the mirror again. Depth D adds the motion check (card step 4) at the mirror. A last pause collects the verdicts.
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
| 20 | C | `bridge_kill` (or M presses the CET hotkey *Kill XF Runtime Bridge*) | The label turns red "XF bridge: killed"; any freeze, hidden photo-mode menu and save lock are undone; later calls answer plainly that the bridge is off. |
| 21 | M | Load the safety save, then quit to desktop normally. | Clean exit; `session.json` is gone from `%LOCALAPPDATA%\XFStudio\runtime-bridge\`. |
| 22 | C | `python tools/capture_session.py --label bridge-phase2-post --profile "XF Studio diagnostic 2026-09-25"`; copy the session report folder and `logs/commands-*.jsonl` into the evidence. | |

Expected evidence (under MO2, logs sit in `overwrite/`):

| Log | Expected lines | Answers |
|---|---|---|
| `red4ext/logs/red4ext-<ts>.log` | `XF Runtime Bridge (version: 0.2.0 …) has been loaded`; no "incompatible" warning | RED4ext accepted the plugin |
| `red4ext/logs/xfruntimebridge-<ts>.log` | `evt=plugin.build XFB_BUILD=<manifest commit>;dirty=0`, `evt=plugin.config … bridge.enabled=true bridge.allow_writes=true`, `evt=plugin.scripts … added_to_redscript=true`, `evt=bridge.listen …`, `evt=game.state state=Running event=enter` | Load order, config, script registration |
| same | `layer=redscript … XFBridgeSystem.OnAttach`, `evt=layer.announce layer=redscript`, `layer=tweakxl … protocolVersion=1`, `layer=cet … onInit` | Every layer runs |
| same | `evt=bridge.request method=… access=write`, `evt=write.done method=… undo=…` per change, `save lock requested (reason XFRuntimeBridge)`, `evt=photo.enter_requested route=quest_node`, `photo attribute <key> (<label>) <before> -> <after>` | Each write with its reversal |
| same | `evt=bridge.killed`, `evt=bridge.kill_restored …`, `RestoreAfterKill …`, `evt=bridge.server_stopped stop_ms=<under 1000>`, `evt=plugin.unload` | Kill switch and clean shutdown |
| `r6/logs/redscript_rCURRENT.log` | Both `.reds` files from `red4ext/plugins/XFRuntimeBridge/Scripts`; `Compilation complete` | The plugin's script path under MO2 |

Afterwards, record outcomes in the [design page](runtime-bridge-design.md) (unverified rows become [runtime] with the capture id), in [knowledge/runtime-access.md](../../knowledge/runtime-access.md), and the session 2 answers in [experiment 020](../../experiments/020-session-2/README.md).
