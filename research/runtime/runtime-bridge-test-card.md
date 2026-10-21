# Runtime bridge test card

**Status: session 10 ran on 0.8.2 on 22 October 2026: no crash at launch, most of its rows passed, and its findings (the ink panel about 280 units too low, no XF mark on the world pin, the staged showroom not found, a smooth `player_look` too fast, emergency calls from a second process stuck, the XF box over the loading screen, and card fixes) are fixed offline in 0.8.3, whose [session-11 checks](#session-11-checks-bridge-083) come first in the next sitting. 0.8.3 also renamed two surfaces by appearance: the status label is the **CET line**, the overlay panel the **XF box** (older sections keep the names they were run with).** **Session 9 ran on 0.8.0 on 21 October 2026, because 0.8.1 crashed at every launch (a stale object file in its DLL, [game crashes §2.5](../../knowledge/game-crashes.md#25-a-stale-object-file-in-the-plugin-bridge-081)); 0.8.2 (offline only) fixes the crash, the re-check's six findings and session 9's bridge findings, and shows one status surface at a time; its [session-10 checks](#session-10-checks-bridge-082) come first in the next sitting.** **Session 8 ran on 0.7.0 on 30 September 2026 (write-up: `experiments/036-session-8`); 0.8.0's part A (offline only) fixes what it found and the UI review's list, 0.8.1 (offline only) adds the wave-4 review's safety fixes (RB-119..128 in the [code-health ledger](../authoring/code-health.md)), and the [session-9 checks](#session-9-checks-bridge-08-part-a) on the 0.8.1 build come first in the next sitting. Session 7 ran on 0.6.1 on 30 September 2026 (write-up: `experiments/035-session-7`); 0.7.0 (offline only) fixes its findings and adds the [ranked hooks](bridge-hook-inventory.md), in-game answers and the overlay host, and its [session-8 checks](#session-8-checks-bridge-07) come first in the next sitting.** Session 6 ran on 0.5.2 on 29 September 2026; 0.6.0 (offline only) fixes what it found (the wardrobe under Equipment-EX, the showroom's height) and adds the agent's own view of the game, the session log and handover, behaviours, player control phase 1 and the camera-preset route, and 0.6.1 (offline only) fixes deep review 6's bridge findings (RB-79..92). Its [session-7 checks](#session-7-checks-bridge-06) come first in the next sitting, on the 0.6.1 build, with the 0.5.3 ink demos folded in (group F) and [0.6.1's own rows](#061-additions-to-the-session-7-checks) (group G).** Session 5 ran on 0.5.1 on 29 September 2026 (its notes are private; the crash, the rate limit, the missing face table index, the showroom's height and pedestal and the hidden helmet are fixed in 0.5.2, offline only), and the next bridge build is 0.5.2. Its [session-6 checks](#session-6-checks-bridge-052) come first in the next sitting.** Session 4 ran on 0.4.1 (`911ad89`) on 28 September 2026 ([results](../../experiments/029-session-4/README.md#3-results); its bridge problems are listed there in §5); 0.4.2 fixed what session 4 found (framing drift and the default lens, `photo.open` taking the window's focus, `cc.open` half-opening the creator away from a mirror, the clock in photo mode, expression values and indices, `cc.apply` by label), 0.5.0 added XF Finish Showroom, and the next bridge build is 0.5.1, which fixes deep review 5's bridge findings (RB-66..75: `cc.open`'s edit mode as a parameter, the pause-menu redirect's edge cases, the photo-mode clock's undo, `photo.frame` restoring on every failure and its yaw units, `cc.apply`'s and the face index's checks). Its [session-5 checks](#session-5-checks-bridge-051) come first in the next sitting.** Session 3 ran on 0.3.0 the same day ([results](../../experiments/028-session-3/README.md#5-results-28-september-2026)); 0.4.0 fixed its six bridge problems and added a message line, clothing, save and load commands, and 0.4.1 fixed the deep review of 0.4 (RB-51..65). Session 3's plan was, on the 0.3.0 `-writes` build: a short preflight drawn from the checks below, session 2 continued, creator calibration frames, and R1 and R2 as a stretch. The first in-game runs of [XF Runtime Bridge](../../projects/xf-runtime-bridge/README.md) 0.2.0 on 26 September 2026 passed the [script-call check](#script-call-check-first) and the [first-session checks](#first-session-bridge-checks), and ran session 2 semi-manually ([results](../../experiments/020-session-2/README.md#results-26-september-2026-run-through-the-runtime-bridge-partial)). Since then the bridge can open photo mode with the player's own key, frame V without hand-tuned values, switch lights on, hide the cursor, keep the creator's row labels in step and press the creator's Confirm and Back, and it has two research commands for the [expression editor](../animation/expression-editor-design.md#8-runtime-questions-r1r5-through-the-bridge) (`face_rig_read`, `photo_expression_index`); batch 3 adds opening the creator (`cc_open`), its camera (`cc_page`), vanilla rows by label, the clock with the creator open and a settings record (`game_options_read`) ([checks](#batch-3-checks-the-creator-from-gameplay-and-the-settings-record)); batch 4 (0.3.0) fixes that batch's review findings, adds an in-game panel in the CET overlay (Reconnect after the kill switch without restarting the game, pause changes) and the live-posing experiment's first steps ([checks](#batch-4-checks-refusals-the-panel-and-live-posing-l0)); all of it is built and tested offline only. Design and citations: [runtime bridge design](runtime-bridge-design.md); photo mode and the creator from script: [knowledge/photo-mode.md](../../knowledge/photo-mode.md). **Every pending in-game ask, ranked into sittings of 20–30 minutes, is in the [next-sessions plan](next-sessions-plan.md)**; this card keeps the bridge's own checks, conventions and build records.

**Who does what.** The maintainer starts MO2 and the game, loads a save, keeps the game window in front, and opens the character creator when asked (a mirror, or F12 with Character Customization Anywhere). The coordinator drives everything else through the bridge (MCP tools or the command line) and takes the screenshots. Agents never launch the game or MO2; only the coordinator stages, and only the `XF Runtime Bridge` entry in the test profile.

| Part | Time | Needs |
|---|---|---|
| [Before the session](#before-the-session-coordinator) | offline | The coordinator restages the `XF Runtime Bridge` entry from a new build |
| [Finish showroom checks](#finish-showroom-checks-bridge-050) | 30-35 min | Only with the 0.5.0 -writes build, Codeware and XF Finish Showroom staged, and an XF Eye Artistry build of the same collection and commit; a dim interior at night with 4 m clear in front of V |
| [Session 11 checks](#session-11-checks-bridge-083) | about 38 min | Only with the 0.8.3 -writes build (`--allow-inventory`), Codeware, Equipment-EX and the two XF Finish Showroom mods (no restage of those); the game launched to its main menu (I loads the save), then a street in daylight, a public place with open space and a long straight street; two terminals for E |
| [Session 10 checks](#session-10-checks-bridge-082) | ran 22 October on 0.8.2 | Only with the 0.8.2 -writes build (`--allow-inventory`), Codeware, XF Finish Showroom and Equipment-EX; the game launched to its main menu (I loads the save), then V's apartment and a street; the HUD visible for S and B |
| [Session 9 checks](#session-9-checks-bridge-08-part-a) | ran 21 October on 0.8.0 | Only with the 0.8.1 -writes build (`--allow-inventory`), Codeware, XF Finish Showroom and Equipment-EX; the game launched to its main menu (C loads the save), then V's apartment and a street; frame generation offered for group J |
| [Session 8 checks](#session-8-checks-bridge-07) | about 45 min | Only with the 0.7.0 -writes build (`--allow-inventory`), Codeware, XF Finish Showroom and Equipment-EX; V's apartment, then a street with a door, a vending machine, an NPC and a car |
| [Session 7 checks](#session-7-checks-bridge-06) | about 40 min | Only with the 0.6.1 -writes build (`--allow-inventory`), Codeware, XF Finish Showroom and Equipment-EX; V in her apartment, then in the street; the game window in front |
| [Ink demo rows](#ink-demo-rows-bridge-053) | folded into session 7 (group F) | The 0.5.3 demos' detailed rows |
| [Session 6 checks](#session-6-checks-bridge-052) | 30-40 min | Only with the 0.5.2 -writes build with the inventory class (`--allow-inventory`), Codeware and a rebuilt XF Finish Showroom staged, and Character Customization Anywhere **disabled** in the test profile; V in the street, on foot; the game window in front |
| [Session 5 checks](#session-5-checks-bridge-051) | 25-30 min | Only with the 0.5.1 build staged; V in her apartment, on foot, then in the street; the game window in front |
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

## Finish showroom checks (bridge 0.5.0)

Only with the 0.5.0 -writes build and XF Finish Showroom staged ([pipeline guide](../authoring/studio-to-mod-pipeline.md#xf-finish-showroom-a-test-mod-of-mannequin-heads), [knowledge](../../knowledge/skin-on-spawned-objects.md)). **First the fidelity check**: one showroom head beside V, both wearing the same preset under the same light; only if the head is a fair stand-in does the lineup follow. C is the coordinator, M the maintainer; tool names are the MCP names. `<s2>` and `<gb>` stand for the two showroom build folders (session 2's collection and the Glitter board), as the coordinator's staging receipt names them.

**Stage first** (coordinator, MO2 closed; the dedicated test profile only):
- **Bridge:** replace the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.5.0-writes.zip`. Its manifest says `"version": "0.5.0"` and `"write_classes": ["photo", "world", "character", "save", "showroom"]`.
- **Codeware:** check that the profile loads Codeware 1.20 or newer, and report the version. The showroom spawns through it; nothing installs it for the maintainer.
- **XF Finish Showroom:** one new MO2 mod entry, `XF Finish Showroom`, holding both showroom archives in `archive/pc/mod/` (`xfs_showroom_4426018f…` from session 2's collection, `xfs_showroom_d11f5a7f…` from the Glitter board). Each archive stands alone and needs no `.archive.xl`. Place the entry after XF Eye Artistry; it shares no path with it.
- **XF Eye Artistry for V:** stage a build of `experiments/020-session-2/session-2.collection.json` (`--diagnostics`) from the same commit as the showroom, so that V and the heads carry byte-identical textures of the same compile. The staged session 2 build was compiled before today's finish defaults and the Shimmer grain. Record both archives' SHA-256.
- **Setting:** a disposable save in a dim interior at night, with about 4 m clear in front of V. Photo mode's lights stay off, ReShade effects off, Ultra+ off (as for session 4's repeats).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| F1 | M, C | M loads the save; V on foot in the clear spot; the game window in front. C: `bridge_info`, `showroom_state` | `plugin_version` 0.5.0; `showroom_state` answers `codeware: true` with no pieces | `codeware: false`: C reports it and stops the showroom rows |
| F2 | C, M | `cc_open`, `cc_apply {option: "XF", label: "Gloss A"}`, `cc_confirm` (M opens the creator with F12 if `cc_open` refuses) | V wears Gloss A · as before | — |
| F3 | C | In normal play: `showroom_spawn {manifest: "<s2>", presets: ["Gloss A · as before"], anchor: "v", distance_m: 1.5}`; then `capture_screenshot {}` | One head on a black pedestal 1.5 m in front of V, **facing her**, eyes at about her eye height, with lashes and eyes and **Gloss A on its lids**; `placed` 1 and `state.pending` 0 | Facing away: yaw sign wrong, so record it and use `showroom_rotate {yaw_deg: 180}`. Floating, sunk, collapsed or at the entity's origin: the rig pose is wrong (knowledge open question 3). Pink or black skin: a missing texture. No makeup: ArchiveXL expansion or the plate. Capture each case and stop the showroom rows |
| F4 | C | `photo_open`; `world_time_set {hours: 2}`; `photo_frame {target: "face"}`; note `distance_m`. Then `showroom_spawn {manifest: "<s2>", presets: ["Gloss A · as before"], anchor: "camera", distance_m: <distance_m>, lateral_m: 0.6}` | Spawned **in photo mode**: the head stands beside V at the same distance from the camera, both facing it | Nothing appears, or `pending` stays above 0: spawning waits for the world. Then `photo_exit`, spawn with `anchor: "v"`, `lateral_m: 0.6`, `distance_m: 0.8` and turn V, and record that spawning needs normal play |
| F5 | C | `photo_camera_set {fov: 20}`; `showroom_light {manifest: "<s2>", rig: "key", target: "piece", piece: 0}` and `showroom_light {manifest: "<s2>", rig: "key", target: "v", replace: false}`; `photo_hud_hide {}`; `capture_screenshot {}` | The same key light on both faces (0.6 m apart, neither key reaches the other face by the plan's estimate; at 0.45 m one would add about 20 %): V and the head side by side, **Gloss A reading the same** (sheen, colour, edges) | Record which differs. The head's skin is a neutral tone, so compare the makeup, not the skin |
| F6 | C | `showroom_light {manifest: "<s2>", rig: "creator", target: "v"}` (replaces the rigs), capture; then `showroom_light {manifest: "<s2>", rig: "creator", target: "piece", piece: 0}`, capture | The full creator rig on each in turn: V lit like the creator's mirror screen (cyan-white rim on her left, magenta behind her right, key low front-left), then the head lit the same way in its own frame | The rig lights the wrong side: spot axes or yaw sign (record). Much brighter or darker than the mirror: photo mode's exposure (compare with photo mode exposure −1 and +1) |
| F7 | C | With the head's creator rig: `showroom_rotate {sweep: {from_deg: -40, to_deg: 40, steps: 5, capture: true, region: "full", name: "fidelity-sweep"}}` | Five frames; the highlight moves across the head's lids and the head returns to 0 at the end | — |
| F8 | M | Verdict: does the head show Gloss A as V does (F5, F6)? | Yes: the showroom is a fair stand-in, go on to L1. No: record what differs, then run L1–L3 only as a relative comparison | — |
| L1 | C | `showroom_clear {}`; `showroom_spawn {manifests: ["<s2>", "<gb>"], presets: ["Gloss A · as before", "Gloss B · skin rough", "Gloss C · all rough", "Gloss D · rough +0.12", "Shimmer · strong", "Metal ramp · lifted", "Glitter A · base", "Glitter C · size", "Glitter E · accent"], anchor: "camera", distance_m: 2.5, spacing_m: 0.6}`; `photo_camera_set {fov: 45}`; capture | Nine heads on an arc, each facing the camera, in that order left to right | Fewer: `showroom_state` names the missing ones |
| L2 | C | `showroom_light {manifest: "<s2>", rig: "key"}`; capture; then `showroom_rotate {sweep: {from_deg: -60, to_deg: 60, steps: 9, capture: true, region: "full", name: "lineup-key"}}` | Identical key light on every head (`spill_worst` 0); the sweep moves each highlight the same way. Judge whether Gloss A–D separate, whether the Shimmer grain reads as a fine sheen with sparkle rather than dots, and whether Glitter points flash as the heads turn | — |
| L3 | C | For each of Gloss A, Gloss C, Shimmer · strong, Glitter A · base and Glitter E · accent, one at a time: `showroom_spawn {manifests: ["<s2>", "<gb>"], presets: ["<name>"], anchor: "camera", distance_m: 2.2}`, `showroom_light {manifest: "<s2>", rig: "creator"}`, `photo_camera_set {fov: 9}`, capture, then `showroom_rotate {sweep: {from_deg: -30, to_deg: 30, steps: 5, capture: true, region: "face", name: "<name>"}}` | The creator rig, the camera and the sweep identical for each preset: a like-for-like set of close-ups | — |
| L4 | C | `capture_burst {region: "face", frames: 10}` on Glitter A at 0°, then again with the head at +10° (`showroom_rotate {yaw_deg: 10}`) | Glitter points twinkle frame to frame or with the turn (the Glitter board's motion question) | — |
| K1 | C, M | `bridge_kill {}`; M looks | Every head and rig vanishes; the plugin log has `bridge.kill_cleared_showroom`. M presses Reconnect | Anything left: record it and load the save |
| K2 | C, M | `showroom_spawn {manifest: "<s2>", presets: ["Gloss A · as before"]}`, then M loads the save (or `game_load {latest: true, discard_unsaved: true}`); after the load, `showroom_state` | Nothing in the world after the load; `showroom_state` has no pieces | A head survives the load: record it (static entities should not persist) |

Evidence: every answer's JSON (spawn plans, spill estimates, sweep frames), the captures (F3–F7 as a fidelity sheet, L1–L3 as a lineup sheet and per-preset strips, L4's burst manifest), the plugin log's `showroom` lines, the Codeware version, and the three archives' SHA-256.

## Session 11 checks (bridge 0.8.3)

Only with the 0.8.3 -writes build built with `--allow-inventory` ([build record](#build-record-bridge-083-branch-build-not-staged)); Codeware, Equipment-EX and the two XF Finish Showroom mods staged as for session 10. This session proves session 10's fixes ([design §3.11](runtime-bridge-design.md#311-bridge-083-session-10s-findings)): the ink panel's placement at 3840 × 1600 and its readability over the game's HUD, the world pin's XF mark, the showroom found by itself (then G1–G3 and the head pin), a smooth `player_look` that takes its time, emergency calls from a second process, no XF surface on the loading screen, the bridge's own kill key, and session 10's corrected L1, L4 and L5. About 38 minutes in nine groups, in this order. C is the coordinator, M the maintainer; tool names are the MCP names, `cli` means `bun tools/bridge-client.ts run` in `projects/xf-runtime-bridge`.

**The four surfaces, by these names only** (0.8.3 renamed two of them by appearance). The **ink panel** is the game-style panel with the red edge. The **XF box** is the small dark box with the yellow "XF Runtime Bridge" heading. The **CET line** is CET's one line of text with a coloured dot at the far top left. The **XF Runtime Bridge window** is the window in CET's overlay, with its buttons. One status surface shows at a time (the ink panel while the game shows its HUD, the XF box in photo mode and menus, the CET line only when neither can draw), and none on a loading screen.

**How C asks.** As in session 10: `ask "…" [A, B]` is `ui_message {level: "ask", text: "…", choices: ["A", "B"]}`, then `session_wait {message_id}`; the answers are on F6, F7, F8, F11 in order and as buttons in the XF Runtime Bridge window; `ask "…"` alone shows one button, Done. **Every instruction to M goes in the game** (an ask, or `ui_message {level: "info"}`), never only in chat: M can't see the chat while the game is in front (session 10's A2). The loading screen shows no XF surface, so C gives its instruction before the load (I1). C waits about 10 s after an answer before the next message.

**Restage first** (C, MO2 closed): in the **`XF Studio diagnostic`** profile, **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.8.3-writes.zip` (manifest `"version": "0.8.3"`, `"inventory_writes": true`); its `config.ini` has the new `kill_key = End`. **The showroom needs no restage:** the two staged builds are byte for byte the newest builds in the primary checkout's `projects/xf-studio/dist`, and `showroom_spawn` matches them by their SHA-256 (run the tools from a checkout of this repository, so the primary checkout's dist is found). A later rebuild with builder 2 ships its manifest inside the mod and needs no local build at all.

**Z. The launch (2 min).**

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| Z1 | M, C | M launches the game from MO2 to the main menu; C: `bridge_info` | `plugin_version` 0.8.3, `build_commit` the build record's; `kill_key` `{enabled: true, label: "End"}`; `status_surface` xf_box or cet_line at the main menu (never ink_panel there) | A crash: as session 10's Z1 |

**I. The loading screen (4 min; at the main menu).**

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| I1 | C, M | `ask "Next I load your latest save. When the loading screen says PRESS [Space] TO CONTINUE, take a screenshot, then press Space."`; after Done `game_load {latest: true, discard_unsaved: true}`; while it waits, `bridge_info`; after M's key, `game_wait {phase: "gameplay"}` | M's screenshot shows the loading screen with **no XF surface** (session 10: the XF box drew over it); `bridge_info.status_surface` none while `script_layer.waiting_for_input` is true; gameplay after the key | Any XF surface on that screen: M's screenshot and `bridge_info` |
| I2 | C | `game_continue {}` | Still refused `no_safe_route` in plain words (0.8.3's research found no contained route inside the game: [runtime access](../../knowledge/runtime-access.md)) | — |

**B. The ink panel's placement and readability (9 min).** A street in daylight, the HUD visible, the minimap and the quest tracker showing an objective; captures hide the panel, so M takes the screenshots. Rows B2–B4 each move the panel with `ui_hud`; C then asks.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| B1 | C, M | `ui_hud {reset: true}`; 3 s later `session_log {tail: 50}` for the `panel geometry` line; `ask "Is the game-style XF panel at the top left, about a quarter of the way down, under the health bar, and easy to read? Screenshot." [Yes, Too low, Hard to read]` | Yes: its top about 360 px down (session 10: about 640 px), on a nearly opaque plate. The log line reads `root=3840x2160 screen=3840x1600 visible=3840x1600 at 0,0` with `from=measured` (and `model=3840x1600 at 0,0` beside it) or `from=model` | Too low: record the geometry line; it names what the panel measured |
| B2 | C, M | `ui_hud {anchor: "top_right", x: 60, y: 60}`; `ask "Is the XF panel whole at the top of the screen, just left of the minimap, 60 px from the top, and clear of the minimap and quest tracker? Screenshot." [Yes, Overlaps HUD, Cut off, Elsewhere]` | Yes (session 10: about 360 px down and over the minimap) | M's screenshot and the geometry line |
| B3 | C, M | The same for `top_center`, `center_left`, `center`, `center_right`, `bottom_left`, `bottom_center` and `bottom_right` (each `x: 60, y: 60`; `center` x 0, y 0), each with `ask "Is the XF panel whole on screen at the <place>, clear of the game's own HUD (minimap, quest tracker, icons, prompts, subtitles)? Screenshot." [Yes, Overlaps HUD, Cut off, Elsewhere]`. The places: top centre; middle of the left edge; screen centre; middle of the right edge, left of the quest tracker; bottom left, above the status and cyberware icons; bottom centre, above subtitles; bottom right, left of the weapon and prompt area. At the end `ui_hud {reset: true}` | Yes each time (session 10: bottom_left entirely below the screen) | M's screenshot of each one that isn't |
| B4 | C, M | `ui_hud {anchor: "top_right", x: 0, y: 60}`; `ui_message {text: "Readability check: a long line of text to read over the street behind the XF panel. Can you read every word easily?", level: "info", seconds: 30}`; `ask "Can you read every word of the XF panel easily over the street?" [Easily, With effort]`; `ui_hud {reset: true}` | Easily: the plate is nearly opaque (session 10: translucent, hard to read over the minimap) | M's screenshot |

**F. The world pin's XF mark (3 min).** The street, photo mode closed.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| F1 | C, M | `world_pin {at: "v", label: "V was here"}`; `ask "Walk about 5 m away and turn back. In the world, above the game's own marker, do you see a blue diamond with XF and the label V was here under it? Screenshot." [Diamond and label, Diamond only, Nothing]`; then `ui_state` | Diamond and label (session 10: nothing but the game's marker); `ui_state.pins[0].xf_mark.on_screen` true, `px` inside 3840 × 1600, `drawn_by` with `xf_overlay` | Nothing: record `pins[0].xf_mark` (shown, at, px) and M's screenshot |
| F2 | C | `world_pin_clear` | The pin and its mark gone | — |

**G. The showroom found by itself (7 min).** A public place with open space.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| G1 | C, M | `photo_open`; `ask "Fly the drone camera about 8 m from V, pointing at her, then press Done."`; `showroom_spawn {presets: ["Gloss A · as before"], distance_m: 1.5}` (no manifest) | `showroom_found.builds` names both staged archives, each `by: "matched_build"` with its manifest in the primary checkout's dist; `pieces[0].eyes_on_screen` near {0, 0}, `in_frame` true; the head appears (session 10: `showroom_manifest_missing`) | `showroom_manifest_missing`: record `unresolved` (it says why for each archive); give `manifest` the build folder it names and go on |
| G2 | C | `showroom_rotate {sweep: {steps: 3, capture: true}}` | Three frames, no XF surface in any | Record a frame |
| G3 | C, M | `photo_exit`; `ask "Stand facing a wall about 1.5 m away, then press Done."`; `showroom_spawn {presets: ["Gloss A · as before"], anchor: "v", distance_m: 2}`; `ask "Now face open space, then press Done."`; the same spawn | `space_check.checked` true both times; by the wall `moved_m` above 0 with a reason; in the open `clear` true | Record both answers |
| G4 | C, M | With the head from G3 in the open: `world_pin {piece: 0, label: "Gloss A"}`; `ask "Above the mannequin head, do you see the XF diamond with Gloss A just above its crown? Screenshot." [Yes, Elsewhere, Nothing]`; `world_pin_clear`; `showroom_clear` | Yes; `ui_state.pins[0].xf_mark.on_screen` true | M's screenshot and `ui_state.pins` |

**D. A smooth look that takes its time (2 min).** The street, V on foot.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| D1 | C, M | `ask "Press Done, then keep your hands off the mouse for ten seconds."`; after Done `player_look {yaw: 90, relative: true, mode: "smooth", duration_s: 5}` | The view turns smoothly for about 5 s; the answer has `took_s` about 5 (4.8–6), `stopped` false, `within_2_deg` true (session 10: 1.5 s) | Record the answer |
| D2 | C, M | `ask "Press Done, then keep your hands off the mouse."`; after Done the same look and, 1 s after sending it, `player_stop` from a **second** process (`cli player_stop`) | `player_stop` answers within about a second; the look's answer comes right after with `stopped` true and `took_s` about 1; the view stops and doesn't start again | Record both answers and the log |
| D3 | C, M | `ask "Press Done, then nudge the mouse gently as soon as the view starts turning, and let go."`; after Done the same look | The look ends at once with `took_over` naming the mouse (`CameraMouseX`, `raw:IK_MouseX` or similar), and the view doesn't start turning again after the nudge (the review: the next step used to start a new look-at) | Record the answer |

**E. Emergency calls from a second process (4 min).** The street, photo mode closed. Two terminals in `projects/xf-runtime-bridge`.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| E1 | C | Terminal 1: `cli game_wait '{"phase":"photo_mode","timeout_ms":60000}'` (it polls the main pipe). Terminal 2, while it waits: `cli session_handover '{"note":"E1"}'` | The handover answers `handed_over` true within 2 s (session 10's L2c: 20 s, then a timeout); the plugin log shows `bridge.client_connected ... pipe=control` (0.8.3 names the pipe) and `method=bridge.handover access=control` | Record both outputs and the log lines |
| E2 | C | Terminal 2: `cli session_resume`; then `cli player_stop` and `cli behave_stop '{"all":true}'`; Terminal 1's wait is still running | Each answers ok within a second or two (session 10: resume refused `bridge_busy`); `game_status.handed_over` false after the resume | Record the refusals |
| E3 | C | Let Terminal 1's wait end (or stop it with Ctrl+C) | No step of the handover or resume landed on the main pipe (the log's main-pipe connection carries only `game.status`) | — |
| E4 | C | Terminal 1: `cli session_handover '{"note":"E4"}'` and, at once, Terminal 2: `cli session_resume` | Both answer ok; the plugin log has the handover's steps (`behave.stop`, `game.status`, `bridge.handover` on, `ui.message`) all before the resume's `bridge.handover` off, and `game_status.handed_over` ends false (the handover lock keeps each whole across processes) | The resume's step between the handover's: record the log lines in order |

**K. The bridge's own kill key (5 min).** It works without CET. Each kill is followed by Reconnect.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| K1 | C, M | `ask "Open CET's overlay: next to Stop the bridge, does the XF Runtime Bridge window say or press End in the game? Then close CET's overlay and press Done." [Yes, No]` | Yes | M's screenshot of the window |
| K2 | M, C | In normal play: `ask "Press End now (the game's window in front, CET closed). Then open CET, press Reconnect in the XF Runtime Bridge window, close CET and press Done."`; C: `session_log {tail: 30}` | The log has `bridge.kill_key key=End` and the kill, then the reconnect; nothing else happened in the game (End has no game binding) | No kill: record `bridge_info.kill_key` and the log |
| K3 | M, C | `photo_open`; `ask "In photo mode, press End, then Reconnect as before, then Done."`; `photo_exit` | Killed and reconnected, as K2 (works in photo mode) | Record the log |
| K4 | M, C | `ask "Press Esc to open the pause menu, press End there, close the menu, press Reconnect as before, then Done."` | Killed and reconnected (works in menus) | Record the log |
| K5 | M, C | `ask "Open CET's overlay and, with it open, press End once. Then close CET and press Done."`; `bridge_info` | **Not** killed: the key is ignored while CET's overlay is open (typing must never stop the bridge; the window's Stop is there) | Killed: record it |
| K6 | M, C | `ask "Switch to another window (Alt+Tab), hold End down there, click back into the game while still holding it, wait two seconds, let go, then press Done."`; `bridge_info` | **Not** killed: a key held while the game wasn't in front never counts on returning; only a fresh press in the game does (the review) | Killed: record the log's `bridge.kill_key` line |

**L. Session 10's corrected L rows (8 min).** The street, V on foot, photo mode closed.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| L1 | C, M | The save prepare path (session 10's L1 never reached it: added cyberware is a blocking effect). A change the save lock covers that isn't one: `world_time_set {hours: <the hour now + 1>}`; `game_status` (`bridge_save_lock` true); then at once `game_save {override_lock: true, name: "L1"}` and `bridge_kill`; `ask "Open CET, press Reconnect in the XF Runtime Bridge window, close CET, then press Done."`; `game_status`; `game_save {name: "L1b"}` | The kill answers at once; the save answers refused `killed`, or saved (`L1` appears in the save list: a real save whose only change is the clock; delete it afterwards if wanted); the log has `game.save.relock` or `game.save_relock_deferred` then `game.save_relocked`. After Reconnect `bridge_save_lock` and `saving_locked` true, and L1b is refused `bridge_save_lock` | Saving unlocked after Reconnect: record both `game_status` answers and the log |
| L4 | C | Session 10's skipped jacket row (card row L6), now with V's own items: `inventory_list {slot: "OuterChest"}`; choose a jacket with `worn` false (if V wears none, first `inventory_equip` one listed); `inventory_equip {item: <its item>, id: <its id>}` over the jacket V wears; run the answer's undo; then `inventory_unequip {slot: "OuterChest"}` and its undo | `inventory_list` names V's jackets with ids; both undos carry the worn jacket's `id`, and running them answers `exact` true with that jacket back | `exact` false: record both answers |
| L5 | C, M | The far undo (card row L7; offsets stop at 50 m): `ask "Walk out to a long straight street with open road at least 60 m ahead, face along it, then press Done."`; `player_state` (position p, yaw); C works out t = p + 60 m along her facing (x − 60·sin yaw, y + 60·cos yaw, same z); `world_probe {points: [t], radius_m: 3, sight_from: [p.x, p.y, p.z + 1.6]}`; only if it answers walkable ground streamed in and a clear sight line: `player_teleport {position: <its nearest walkable point>, far: true}`; then its undo | The undo carries `far: true` and puts V back where she stood | The probe finds no ground or the sight line blocked: ask M to face another way and probe again. `too_far` on the undo: record it |

**Friction log (throughout).** Every point of friction met in passing, as AGENTS.md asks, with each surface by its name above.

Evidence: every answer's JSON, M's screenshots (I1, B1–B4, F1, G4, K1), the `panel geometry` lines, `session_log {tail: 500}` at the end and the plugin log copied **before** any relaunch.

## Session 10 checks (bridge 0.8.2)

**Ran 22 October 2026 on 0.8.2** (the session's notes are private). Passed: Z1–Z2 (no crash, twice), I1–I3, A1–A4, S1–S5, B3–B6, C1–C4, D1–D2, behave_stop during a five-second look (205 ms), L8 (captures refused while another window was in front) and the kill's speed during a forced save (206 ms). Failed or skipped, each fixed or reworked in 0.8.3 ([design §3.11](runtime-bridge-design.md#311-bridge-083-session-10s-findings)): B1 and B2 (every anchor about 280 units too low), F1 (no XF mark in the world), G1 (`showroom_manifest_missing`; G2, G3 and the head pin skipped), L2a (a five-second smooth look took 1.5 s), L2c (emergency calls from a second process stuck), the XF box over the press-any-key screen, and the rows that couldn't run (L1's prepare path, the jacket row, the 60 m teleport). I4's research: the press-any-key screen is the stretch before `XFBridgeSystem.OnPlayerAttach`.

Only with the 0.8.2 -writes build built with `--allow-inventory` ([build record](#build-record-bridge-082-branch-build-not-staged)); Codeware, XF Finish Showroom and Equipment-EX staged as for session 9. Session 9 ran on 0.8.0 because 0.8.1 crashed at every launch ([game crashes §2.5](../../knowledge/game-crashes.md#25-a-stale-object-file-in-the-plugin-bridge-081)); this session proves the fixed build, runs 0.8.1's group L (still unrun), the rows session 9 failed or skipped, and 0.8.2's fixes and surfaces rule ([design §3.10](runtime-bridge-design.md#310-bridge-082-the-crash-at-load-the-re-checks-findings-session-9-and-one-status-surface)). About 75 minutes in eleven groups; Z first, then A, S and B. C is the coordinator, M the maintainer; tool names are the MCP names.

**The four surfaces, by these names only.** The **status label** is CET's line at the top left. The **overlay panel** is the small XF panel drawn over the game, with the yellow "XF Runtime Bridge" heading. The **ink panel** is the game-style panel with the red edge. The **XF Runtime Bridge window** is the window in CET's overlay, with its buttons. 0.8.2 shows one status surface at a time: the ink panel while the game shows its HUD, the overlay panel in photo mode and menus, the status label only when neither can draw; the XF Runtime Bridge window is where M clicks.

**How C asks.** `ask "…" [A, B]` means `ui_message {level: "ask", text: "…", choices: ["A", "B"]}`, then `session_wait {message_id}`: the question shows only those answers, on F6, F7, F8, F11 in that order, on whichever status surface shows, and as buttons in the XF Runtime Bridge window. `ask "…"` with no list shows one button, Done. A new ask withdraws one still waiting (0.8.2), so C waits about 10 s after an answer before the next message, or the "Answered:" line is gone before M sees it. Each answer is at most 24 characters. M may comment from the XF Runtime Bridge window at any time: type in the comment box, then Ctrl+Enter or Send.

**Restage first** (C, MO2 closed): in the **`XF Studio diagnostic`** profile, **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.8.2-writes.zip` (manifest `"version": "0.8.2"`, `"inventory_writes": true`). The CET folder is now `XF_Runtime_Bridge` (it was `xf_runtime_bridge`): replacing the entry's files removes the old folder. The XF Finish Showroom entry stays staged as in session 9; `showroom_spawn` now finds it without a manifest, and says which build it used (`showroom_found`). If it refuses `showroom_not_staged`, give `manifest` the path it names.

**Z. The launch (3 min; first).**

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| Z1 | M, C | M launches the game from MO2 to the main menu; C: `bridge_info` | The main menu comes up (0.8.1 crashed 3 of 3 launches here); `plugin_version` 0.8.2, `build_commit` the build record's; the plugin log runs past `bridge.enabled` to `rtti.register_types … natives=19` | A crash: don't retry; C runs `python tools/minidump_summary.py` and copies `red4ext/logs/xfruntimebridge-*.log` and `red4ext-*.log`; stop the session |
| Z2 | M, C | M quits (Exit to desktop) and launches again; `bridge_info` | Main menu again, no crash report | As Z1 |

**I. Loading and saves (5 min; at the main menu).**

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| I1 | C | `game_saves {limit: 5}` | `count` the whole list, `names` exactly 5 (session 9: all 152), each save once (session 9: the newest twice), `location` and `quest` in English words with `location_key` and `quest_key` beside them (session 9: `LocKey#…`) | Record the answer |
| I2 | C, M | `game_load {latest: true, discard_unsaved: true}`; when it answers `continued.reached` press_any_key, C asks M to press a key in the game (in chat: no surface may show over the loading screen); `game_wait {phase: "gameplay"}` | The answer comes within 75 s with `continued.reached` press_any_key and `waiting_for_input` true while the game shows its press-any-key screen (or gameplay if the game shows none); the bridge presses nothing; after M's key, gameplay | `reached` loading after 75 s: `game_wait`; the answer came before the screen showed: record `game_status` (`waiting_for_input`, `script_layer`) and when the screen appeared |
| I2b | C | `game_continue {}` | Refused `no_safe_route` in plain words; nothing is sent to the game | — |
| I3 | C | `game_wait {phase: "gameplay"}` (one phase as text) | Answers at once with `phase` gameplay (session 9: refused, a list was required) | Record the refusal |
| I4 | C, M | Research, for a route that ends the press-any-key screen inside the game: quit to the main menu and `game_load {latest: true, discard_unsaved: true}` again; while the screen shows, M takes a screenshot of it and C reads `game_status` and the plugin log's lines since the load (the `script_layer`, `rs-player` and any loading-screen lines); M presses a key and C records which lines came after it | The screenshot (the screen's text and the key it names), `waiting_for_input` true while it shows, and the log lines before and after the key, for the next build's route through the loading screen's own controller | — |

**A. Preflight and wording (4 min).** V in the apartment, on foot, the HUD visible.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| A1 | C | `bridge_info`; `ui_state` | `status_surface` ink_panel; `status.connection` "XF Studio connected"; `ui_state.pins` an empty list | `status_surface` status_label with the HUD visible: record `ui_state` and the log's ink lines |
| A2 | C, M | Make no call for 30 s; `ask "During the last half minute, did any surface say XF Studio not connected?" [Never, It flickered]` | Never (0.8.2: the status follows the session: connected for three minutes after the last call, while a client is connected, or while a session runner holds the lock) | It flickered: note where and when |
| A3 | C, M | `ask "Press Done in the XF Runtime Bridge window: open CET, then click the Done button under the question."` | The wait returns Done (session 9's A3 said "Press it": the button is Done) | — |
| A4 | C | `session_wait {timeout_s: 20}` from one CLI process and, while it waits, `game_status` from another (a second terminal) | `game_status` answers within a second or two (0.8.2: the wait lets the pipe go between its polls; session 9: `bridge_busy`) | Record the refusal |

**S. One status surface at a time (8 min).** The maintainer's rule; each row names what must show and what mustn't.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| S1 | C, M | In the street, the HUD visible: `ask "Which surfaces show the bridge's status now?" [Ink panel only, More than one, Another one]` | Ink panel only: no status label, no overlay panel; `bridge_info.status_surface` ink_panel | M's screenshot |
| S2 | C, M | `photo_open`; `ask "In photo mode: which surfaces show the status and this question?" [Overlay panel only, More than one, Another one]`; M answers with the F6 key | Overlay panel only, with the yellow heading, the status line, this question and its keys ("F6 Overlay panel only   F7 More than one   F8 Another one", shown only while the keys work; otherwise "Answer in the XF Runtime Bridge window (CET overlay)." and M answers there); after the answer "Answered: Overlay panel only" in the overlay panel; no status label, the ink panel hidden with the HUD | M's screenshot; `bridge_info.status_surface` |
| S3 | C, M | In photo mode: M opens CET's overlay; `ask "With CET open: does anything but the XF Runtime Bridge window show the status?" [Only the window, Something else]`; M closes CET's overlay | Only the window (the overlay panel yields to CET; the status label never draws while CET's overlay is open) | M's screenshot |
| S4 | C, M | `photo_exit`; `ui_hud {show: false}`; `ask "With the ink panel switched off: where is the status now? Answer in the XF Runtime Bridge window." [Overlay panel, Status label, Nowhere]`; `ui_hud {reset: true}` | Overlay panel (the next surface in the rule), and under the question "Answer in the XF Runtime Bridge window (CET overlay)." with no F-keys (with the ink panel off no key answers); after the reset the ink panel again and the overlay panel gone | M's screenshot |
| S5 | C | `capture_screenshot {name: "S5"}` in the street, then in photo mode | Neither picture shows any XF surface; the status label doesn't appear for the capture | Record the frames |

**B. The ink panel's anchors and glyphs (10 min).** The street, the HUD visible; captures hide the panel, so M takes the screenshots.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| B1 | C, M | `ui_hud {reset: true}`; `ask "Is the ink panel whole, at the top left about 360 px down, on its dark plate with the red edge? Take a screenshot." [Whole there, Somewhere else, Cut off]` | Whole there (session 9: half way down the screen) | M's screenshot and the log's `panel geometry` line |
| B2 | C, M | For each of `top_center`, `top_right`, `center_left`, `center`, `center_right`, `bottom_left`, `bottom_center`, `bottom_right`: `ui_hud {anchor: <it>, x: 60, y: 60}` (`center`: x 0, y 0), then `ask "Is the ink panel whole on screen at the <place>, 60 units in from the edges? Take a screenshot." [Whole there, Cut off, Elsewhere]`; at the end `ui_hud {reset: true}` | Whole there each time (session 9: top_right a sliver at the right edge, bottom_left off screen) | M's screenshot of each one that isn't |
| B3 | C, M | `ask "Café crème, Łódź, żółć gęślą jaźń — 東京 🌆 ¤ — Åsa, Æther. Is each missing character a bullet (•), with no blank gaps?" [Bullets no gaps, Gaps, Other marks]` | Ink panel: Polish and the accents intact, one • for each Japanese character, the emoji and ¤, "Asa, AEther" (the font lacks Å and Æ); the status label (in photo mode, or with CET open the window): ¤ for the rest, "Lodz, zolc" | M's screenshots of the ink panel and the window |
| B4 | C, M | `ask "First question: press nothing yet."` then, 2 s later, `ask "Second question: press F6." [This one]`; M presses F6; 10 s later `session_wait {message_id: <the first>}` | Only the second question shows, the first withdrawn (session 9: they stacked); after F6 "Answered: This one" and no older question under it; the first's wait ends `question_gone` | M's screenshot of the stack |
| B5 | C, M | `ask "Press nothing." [Fine]`; 3 s later `ui_message {clear: true}`; `ask "Did the question go, and does the status label show no Answer line?" [Both gone, Something stayed]` (in photo mode for the label: `photo_open` first, `photo_exit` after) | Both gone (session 9: the clear left the question, and the label kept "Answer: F6 Done" after the last answer) | M's screenshot |
| B6 | C | `ui_message {level: "ask", text: "x", choices: ["An answer much longer than twenty-four"]}` | Refused before it is sent: the answer is 38 characters, at most 24, a button label | Record the message |

**C. The XF Runtime Bridge window and the hotkey (5 min).**

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| C1 | M, C | M opens the CET overlay, types "ctrl enter check" in the XF Runtime Bridge window's comment box and presses Ctrl+Enter; `session_wait {kinds: ["comment"]}` | The comment arrives and the box empties (session 9: the box only lost focus); Enter alone starts a new line | Record which keys did what |
| C2 | M | In CET's Bindings tab: the group heading, then M binds "Stop XF Runtime Bridge" to a free key and saves | The heading reads "XF Runtime Bridge" (session 9: "Xf Runtime Bridge"); the binding saves | — |
| C3 | M, C | M quits and launches again in the same profile; Bindings tab; `ask "Is Stop XF Runtime Bridge still bound to your key?" [Still bound, Unbound]` | Still bound. (Session 9's loss came from CET itself: it drops a mod's bindings at any launch without the mod, such as another profile; the hotkey's ID never changed.) | Unbound in the same profile: record CET's `bindings.json` entry for `XF_Runtime_Bridge` |
| C4 | M, C | M presses the bound key; `bridge_info`; M presses Reconnect in the XF Runtime Bridge window | `killed` true, then a new session after Reconnect | — |

**D. Looks (4 min).** The street, V on foot.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| D1 | C, M | `ask "Press Done, then keep your hands off the mouse."`; after Done `behave_look {turn: {yaw: 90}, duration_s: 4}`; `session_events {kinds: ["behaviour"]}` after 6 s; then the same with V looking steeply up first (`player_look {pitch: 70}`) and `behave_look {yaw: <her yaw + 180>, pitch: 0, duration_s: 4}` | Both views turn smoothly and each look ends `reached` with `took_s` about 4 (session 9: 1.2 s), never `user_took_over` without the mouse | Record the events |
| D2 | C, M | `ask "Press Done, then move the mouse as soon as the view starts turning."`; after Done `behave_look {turn: {yaw: 90}, duration_s: 4}` | Ends `user_took_over` (`raw:IK_MouseX`, `raw:IK_MouseY` or `camera_drift`) within a moment of the mouse, and the look doesn't fight the mouse afterwards | Record the events |

**G. The showroom found by itself (6 min).** A public place.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| G1 | C, M | `photo_open`; `ask "Fly the drone camera about 8 m from V, pointing at her, then press Done."`; `showroom_spawn {presets: [<one>], distance_m: 1.5}` (no manifest) | `showroom_found` names the staged build's manifest and archive; `pieces[0].eyes_on_screen` near {0, 0}, `in_frame` true | `showroom_not_staged` or `showroom_manifest_missing`: record the answer, give `manifest` the named path and go on |
| G2 | C | `showroom_rotate {sweep: {steps: 3, capture: true}}` | No XF surface in any of the three frames | Record a frame |
| G3 | C, M | `photo_exit`; `ask "Stand facing a wall about 1.5 m away, then press Done."`; `showroom_spawn {presets: [<one>], anchor: "v", distance_m: 2}`; again with V facing open space; `showroom_clear` | `space_check.checked` true both times; by the wall `moved_m` above 0 and a reason; in the open `clear` true | Record both answers |

**F. World pins (4 min).** The street, photo mode closed.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| F1 | C, M | `showroom_spawn {presets: [<one>], anchor: "v", distance_m: 2}`; `world_pin {piece: 0, label: "Gloss A"}`; `world_pin {at: "v", label: "V was here"}`; `ask "In the world: does each pin show the XF diamond with XF and its label above the game's marker?" [Both, One, Neither]`; 5 s later `ui_state` | Both: the diamond and the label sit above the marker, the head's pin just above its crown (session 9: only the game's marker); the placing answers say `drawn_by` fills in later; `ui_state.pins[].drawn_by` includes `xf_overlay`, `world`, `minimap` and `world_map` | M's screenshot; record `ui_state.pins` |
| F2 | C | `world_pin_clear`; `showroom_clear` | Both pins and the head gone | — |

**L. 0.8.1's safety fixes and 0.8.2's re-check fixes (10 min).** The street, V on foot, photo mode closed. Two calls "at once" means C sends the second without waiting for the first's answer (parallel MCP calls).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| L1 | C, M | `inventory_equip {item: <a jacket V owns>}`; `game_status` (`bridge_save_lock` true); at once `game_save {override_lock: true, name: "L1"}` and `bridge_kill`; `ask "Press Reconnect in the XF Runtime Bridge window, then Done."`; `game_status`; `game_save {name: "L1b"}` | The kill answers at once (the control pipe; `route` `kill_file` if that pipe was busy); after Reconnect `bridge_save_lock` and `saving_locked` true, and L1b is refused `bridge_save_lock` | Saving unlocked after Reconnect: record both `game_status` answers |
| L2 | C, M | `ask "Press Done, then don't touch the mouse for ten seconds."`; after Done `player_look {yaw: 90, relative: true, mode: "smooth", duration_s: 5}` and, a second later, `player_stop` | `player_stop` answers within about a second; the look's answer comes at once after it with `stopped` true; the view stops turning and doesn't start again (0.8.2) | The view turned again after the stop: record both answers and the log |
| L3 | C | At once `behave_stop {all: true}` and `player_stop` | Both answer ok (0.8.2: the second waited for the first's connection instead of failing) | Record both answers |
| L4 | C, M | `ask "Open the XF Runtime Bridge window. Press Done, then press Pause changes as soon as the first head appears."`; after Done `showroom_spawn {presets: <every preset>, anchor: "v", distance_m: 3}`; M presses Resume changes; `showroom_clear` | Refused `writes_paused` part-way, naming the heads already placed; no head appears after the press | A head appears after the pause: record the log lines in order |
| L5 | C | `showroom_spawn {presets: [<one>], anchor: "v", distance_m: 2}`; at once `showroom_light {rig: "creator"}` and `session_handover {lights: "clear", note: "L5"}`; `showroom_state`; `session_resume`; `showroom_clear` | After the handover `showroom_state.lights` is empty, and the light call answers `handed_over` or placed rigs that the handover cleared (0.8.2: the rigs are cleared after the write gate closed) | Rigs left after the handover: record `showroom_state` |
| L6 | C | `inventory_equip {item: <a jacket V owns>}` over the jacket V wears; the answer's undo; `inventory_unequip {slot: "OuterChest"}` and its undo | Both undos carry the worn jacket's `id`; running them answers `exact` true with the same jacket back | `exact` false: record both answers |
| L7 | C | `player_teleport {offset: {forward: 60}, far: true}`; its undo | The undo carries `far: true` and puts V back where she stood | `too_far`: record the undo |
| L8 | C, M | `ask "Press Done, then bring another window in front of the game for ten seconds."`; `capture_screenshot {route: "screen", name: "L8"}`; `capture_burst {frames: 5, interval_ms: 1000, route: "screen", name: "L8b"}` started with the game in front, M switches away during it | Both refused `capture_not_foreground`, nothing written, no picture of the other window | Any file shows the other window: delete it and record the answer |
| L9 | C, M | `photo_open`; `photo_light_set {light: 2, on: false}`; `ask "Press Pause changes in the XF Runtime Bridge window the moment you see this, then Done." [Done]` and at once `photo_light_set {light: 2, place: "camera"}`; M presses Resume changes; `photo_exit` | Light 2 stays off if the pause came during the placement (`writes_paused`), or is placed and on if the placement finished first; never switched on after the pause (0.8.2) | Light 2 on and moved after a `writes_paused` answer: record both answers |

**K. Friction log (throughout).** Everything met in passing (AGENTS.md), with each surface by its fixed name.

## Session 9 checks (bridge 0.8, part A)

Only with the 0.8.1 -writes build built with `--allow-inventory` ([build record](#build-record-bridge-081-branch-build-not-staged)); Codeware, XF Finish Showroom and Equipment-EX staged as for session 8. Each row proves one of session 8's findings or one of the UI review's fixes ([inventory, 0.8 part A](bridge-hook-inventory.md#session-8s-findings-bridge-08-part-a)); group L proves 0.8.1's safety fixes that show in the game. About 60 minutes in twelve groups, each standing alone; A, B and E first. C is the coordinator, M the maintainer; tool names are the MCP names. Evidence: every answer's JSON, the named captures, the maintainer's screenshots, `session_log {tail: 500}` at the end, the plugin log copied **before** any relaunch.

**How C asks.** `ask "…" [A, B]` means `ui_message {level: "ask", text: "…", choices: ["A", "B"]}`, then `session_wait {message_id}`: the question shows only those answers, on F6, F7, F8, F11 in that order and as buttons in the XF Runtime Bridge window (CET overlay). `ask "…"` with no list shows one Done button. M may comment from the window at any time (Ctrl+Enter sends).

**Restage first** (C, MO2 closed): in the **`XF Studio diagnostic`** profile, **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.8.1-writes.zip` (manifest `"version": "0.8.1"`, `"inventory_writes": true`, `"overlay_diagnostics": false`; the log's `natives=19` as for 0.8.0). The -diagnostic zip shows the overlay's diagnostic lines and moving bar; stage it instead only for J2's ghosting look. **Setup note:** another mod bound to F6, F7, F8 or F11 gets the key press too; if one is, change `[ui] answer_keys` in the staged `config.ini` (F9 is the game's quick load, so it is never used). Launch: M starts the game only; C loads the save from the main menu (group I runs first).

**I. The main menu (4 min; first, at the main menu).**

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| I1 | C | At the main menu: `game_status`; `game_saves {limit: 5}`; `game_load {latest: true, discard_unsaved: true}`; `game_wait {phase: "gameplay"}` | `phase` main_menu; five saves with type, location and `modded`; the load answers `route` `main_menu_continue` (and `modded` true for a modded save), the game loads the newest save as Continue would; no popup, or the game's own modded-save notice if it shows one (M answers it) | `unavailable` "the main menu isn't ready": wait a second and repeat; nothing loads: record the answer and the log's `game.load` lines |
| I2 | C, M | After I1: `ask "Quit to the main menu (pause menu, Exit to main menu), then press Done here or in the XF window."`; at the main menu `game_load {name: <the second newest save>, discard_unsaved: true}` | `route` `main_menu_load`, the named save loads; a `metadata_pending` wait of up to 3 s is normal | `timeout` naming the save's details: record it (the details didn't come) |

**A. Preflight and wording (5 min).** V in the apartment, on foot.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| A1 | C | `bridge_info`; `ui_state`; `overlay_state` | `plugin_version` 0.8.1; the log has `natives=19` and `overlay.init ok=true … proxy=none` (or `proxy=streamline` with frame generation on); `bridge_info.status.label` "XF Runtime Bridge · XF Studio connected · changes allowed" | `natives=18`: the old DLL is staged |
| A2 | C, M | `ask "Do the four status lines match: the top-left label, the XF panel, the small overlay panel and the XF window (open CET)? Amber means changes are allowed." [All match, One differs]` | All match: label "XF Runtime Bridge · XF Studio connected · changes allowed", overlay panel and ink panel "XF Studio connected · changes allowed", window "XF Studio connected." then "Changes allowed (XF test profile)."; no "listening", "writes ON" or "client" anywhere | M comments which differs |
| A3 | C, M | `ask "This question shows one answer. Press it."` | The ink panel shows only `[F6] Done`, the window one Done (F6) button; the wait returns Done | Ready, Yes and No show: the old tools answered (check `SERVER_VERSION` 0.8.1 in `bridge_info` from MCP) |
| A4 | C, M | `ask "Open the CET overlay and take a screenshot of the XF Runtime Bridge window with this question showing. Then press Sent." [Sent]` | M's screenshot: the question under the two status lines, above Pause changes and Mark this moment; the Sent (F6) button filled in the accent colour; Stop the bridge alone on a row below in red; the comment box as wide as the text; footer "XF Runtime Bridge 0.8.1" (the UI review's missing capture) | — |

**B. The XF panel on this screen (8 min).** The street, the HUD visible; captures hide the panel, so M looks.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| B1 | C, M | `ui_hud {}`; `ask "Is the XF panel whole on screen, top left below the small overlay panel, on a dark plate with a red edge?" [Whole with a plate, Whole without a plate, Cut off, Not there]` | Whole with a plate, at 40, 360 (about 360 px down at 3840 × 1600); `layers.status` has the ink layer's `panel geometry root=3840x2160 screen=3840x1600 visible=3840x1600 at 0,280` | Record the geometry line and M's screenshot |
| B2 | C, M | For each of `top_right`, `bottom_left`, `bottom_right`, `center`, `bottom_center`: `ui_hud {anchor: <it>, x: 60, y: 60}` (center: x 0, y 0), then `ask "Is the XF panel whole on screen at the <place>?" [Whole there, Cut off, Elsewhere]`; `ui_hud {reset: true}` | Whole there each time, kept inside the screen (session 8: top right cut off, bottom and centre not shown) | Record which, and M's screenshot of that one |
| B3 | C, M | M stands where a quest marker shows near the panel's corner; `ask "Does the XF panel draw over the marker?" [Panel on top, Marker covers it]` | Panel on top (the overlay keeps itself the HUD layer's last child), or the plate keeps the keys readable | Record it: the marker is on another layer |
| B4 | C, M | `ask "Café crème, Łódź, żółć gęślą jaźń — 東京 🌆 — résumé. Accents intact here, ¤ for the rest? Top-left label: plain letters (Lodz, zolc)?" [Both right, Panel wrong, Label wrong]` | Ink panel: Polish intact, one ¤ per Japanese character and emoji, no blank gaps; label and window: "Lodz, zolc gesla jazn - … - résumé", ¤ for the rest, no "?" | M's screenshot of both |
| B5 | C, M | `ask <a 600-character question ending "END OF QUESTION?"> [Shows the end everywhere, Cut somewhere]` with the CET overlay open for a moment, then closed | The panel, the label (when the panel is hidden, e.g. photo mode) and the XF window each show the whole text to "END OF QUESTION?" | M comments which surface cut it |
| B6 | C, M | `ask "Press F7." [Not this one, This one]`, M presses F7 | The key line becomes "Answered: This one" in the same place, the question stays, nothing below moves; it stays until C's next message | The line jumps or the question vanishes: M's screenshot |

**C. The label and the window (4 min).**

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| C1 | C, M | `ask "Look at the top-left label now: status and one Answer line only?" [Status and one line, The question too]`; then `photo_open`, the same ask in photo mode | In the street: the label shows its status and "Answer: F6 Status and one line · F7 The question too, or in the XF Runtime Bridge window."; in photo mode (the HUD, and the panel, hidden) the label shows the question too | Record `ui_state` and the frame's `inkask` (the log's ink lines) |
| C2 | M, C | M opens the CET overlay, types "ctrl enter check" in the comment box and presses Ctrl+Enter; `session_wait {kinds: ["comment"]}` | The comment arrives; the box empties; Send is greyed while the box is empty, with the tooltip "Ctrl+Enter sends" | Only Send works: record it |
| C3 | M | M looks at CET's Bindings tab; `ask "Is the hotkey called Stop XF Runtime Bridge, and the window's Stop button alone on its row in red?" [Both, No]` | Both | — |
| C4 | C, M | `ask "Answer with the Ready (F6) button in the window." [Ready]`, M clicks it | The question slot says "Sent: Ready. Waiting for the next question." in place of the buttons, nothing below it moves | M's screenshot |

**D. V's state and the look (4 min).** The street.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| D1 | C, M | `ask "Press Done, then jump a few times for ten seconds."`; meanwhile `player_state` and `player_teleport {turn: 10}` a few times | Mid-jump samples: `psm_detail.on_ground` false, `psm_on_ground` false, `locomotion_name` Jump; refusals read "V is busy (jumping; the game's state locomotion:Jump)…" | Record `psm_detail` samples |
| D2 | C, M | `ask "Press Done, then move the mouse right away: the view will start turning."`; after Done `behave_look {turn: {yaw: 90}, duration_s: 4}` | The look stops `user_took_over`, `input` `raw:IK_MouseX` (or `raw:IK_MouseY`, or `camera_drift`) (session 8: ran to reached) | Record `session_events {kinds: ["behaviour"]}` |

**E. Arm cyberware and photo mode (5 min).** The street, V on foot.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| E1 | C | `cyberware_equip {item: "Items.StrongArms", add_if_missing: true}`; `photo_open`; `photo_exit`; `cyberware_state {areas: ["ArmsCW"]}`; `cyberware_unequip {area: "ArmsCW"}` | After photo mode `arms.drawn` true (the weapon slot holds the arms, session 8's E4); the unequip answers `holstered_first: true` and empties the slot; its undo equips them again | `arms_drawn`: record the answer (the holster needs the player class) |
| E2 | C, M | `cyberware_equip {item: "Items.MantisBlades", add_if_missing: true}`; `photo_open`; `ask "Mantis Blades: deployed or holstered in the default pose?" [Deployed, Holstered]`; `photo_pose_set` to a pose from a non-weapon category; the same ask; `photo_exit`; the equip's undo | Records the game's behaviour for [photo mode §14](../../knowledge/photo-mode.md#14-arm-cyberware-vs-weapon-slot-and-the-cameras-projection): deployed in the default pose (session 8), holstered in a non-weapon pose if the stand-in follows its visual arm slot | — |

**F. World pins (3 min).** Photo mode closed, the street.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| F1 | C, M | `showroom_spawn {manifest, presets: [one], anchor: "v", distance_m: 2}`; `world_pin {piece: 0, label: "Gloss A"}`, `world_pin {at: "v", label: "V was here"}`; `ask "Do you see both pins in the world (the game's marker, an XF diamond above it, the label)?" [Both, One, Neither]`; `ask "On the minimap and on the map (M)?" [Both places, Minimap only, Map only, Neither]`; `world_pin {position: <any>, label: "x"}` for `drawn_by`; `showroom_clear` | Both, both places; the head's pin just above its crown; the latest answer's `pins[].drawn_by` names world, minimap and world_map, and the plugin log has `world.pin N … drawn by …` for each view | The game's marker without the XF diamond: the badge doesn't draw (record `drawn_by`); nothing at all: record `drawn_by` (empty means no view spawned it) |

**G. Photo mode's projection and captures (4 min).** A public place; photo mode.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| G1 | C, M | `ask "Fly the drone camera about 8 m from V, pointing at her, then press Done."`; `showroom_spawn {manifest, presets: [one], distance_m: 1.5}` | `pieces[0].eyes_on_screen` near {0, 0}, `by` "model (photo mode's camera …)", `in_frame` true (session 8: (−5.2, −48.5)) | Record `scene_read {parts: ["camera"]}` |
| G2 | C | `showroom_rotate {sweep: {steps: 3, capture: true}}` | Each frame's `overlay.overlay_host_hidden` true and the overlay panel absent from the three frames | Record a frame |
| G3 | C, M | Photo mode closed, `ask "Stand facing a wall about 1.5 m away, then press Done."`; `showroom_spawn {manifest, presets: [one], anchor: "v", distance_m: 2}`; again with V facing open space | `space_check.checked` true both times; by the wall `moved_m` above 0 and a reason; in the open `clear` true, `moved_m` 0 and `clearance_m` | Record both answers |

**H. Saves and Equipment-EX (2 min).** The street, Equipment-EX's outfit with a helmet on.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| H1 | C | `game_saves {limit: 5}` (in normal play, not the Load menu) | `with_metadata` 5: type, location, quest, level, time, `modded` (session 8: 0) | `with_metadata` 0: record the answer and the log |
| H2 | C | `wardrobe_state` | The Head area `shows` script_outfit, `hidden` false, `outfit_items` the helmet, `vanilla_hidden` true; areas the outfit leaves empty say `shown_by` EquipmentEx | Record the answer |

**J. The overlay with DLSS frame generation (5 min, at the end).** Needs frame generation offered (session 8: DLSS Super Resolution with frame generation).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| J1 | M, C | M turns frame generation on and restarts (the setting needs it); `overlay_state`; `ask "Is the small overlay panel (XF Runtime Bridge) drawing, and does its text ghost or flicker?" [Clean, Ghosts or flickers, Not there]` | `phase` drawing, `swap_chain_proxy` streamline, the log's `overlay.init … proxy=streamline`; Clean, or ghosting recorded as frame generation's effect on a pre-interpolation overlay | `phase` refused: record `refusal`; the label then says "XF overlay is off while frame generation is on." |
| J2 | M, C | With frame generation on: M changes the resolution once and back; `overlay_state`; M quits with Alt+F4 | `resizes` counts up and drawing goes on, or `failed` with the swap-chain reason; the quit ends with `overlay.shutdown … released its objects` and no crash report | A hang or crash: copy the log first |

**L. 0.8.1's safety fixes (8 min, after H).** The street, V on foot, photo mode closed, E's cyberware put back by its undo (a save refuses `bridge_effects_active` while the bridge's cyberware change stands). Two tool calls "at once" means C sends the second without waiting for the first's answer (parallel MCP calls).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| L1 | C, M | `inventory_equip {item: <a jacket V owns>}` (a change the save lock covers); `game_status` (`bridge_save_lock` true); at once `game_save {override_lock: true, name: "L1"}` and `bridge_kill`; `ask "Press Reconnect in the XF window (CET), then Done."`; `game_status`; `game_save {name: "L1b"}` | The kill answers at once (through the control pipe, beside the save; `route` `kill_file` if that pipe can't be reached); the save answers whatever it got to; after Reconnect `bridge_save_lock` and `saving_locked` true, and L1b is refused `bridge_save_lock`. The log has `game.save.relock` or `game.save_relock_deferred` then `game.save_relocked … "retaken":true` (RB-119: the relock is owned before the save's prepare, so a lost answer still takes the lock back) | `bridge_save_lock` false after Reconnect: the lock stayed off; copy the log, then load a save at once so no autosave keeps the changes |
| L2 | C, M | `ask "Press Done, then don't touch the mouse for ten seconds."`; after Done, at once `player_look {yaw: 90, relative: true, mode: "smooth", duration_s: 5}` and, a second later, `player_stop`; again with `behave_stop {all: true}` in place of `player_stop`; then `game_wait {phase: ["photo_mode"], timeout_ms: 600000}` and, 10 s later, `session_handover {note: "L2"}` and at once `session_resume`; last the same wait and `bridge_kill`; M presses Reconnect | `player_stop` and `behave_stop` each answer within about a second while the look is still turning (the bridge's control pipe; before 0.8.1 they waited for the look's five seconds), and the look stops where it is; the handover answers at once, the wait answers `superseded`, and the resume is done after it, so `game_status` ends with `handed_over` false; the kill answers at once, its wait `superseded` (RB-121) | A stop answers only when the look ends, or `handed_over` stays true: record the times from `logs/commands-*.jsonl` and the plugin log's `bridge.request` lines (a stop should show beside the look, on the control pipe) |
| L3 | C, M | `ask "Open the XF window (CET). Press Done, then Pause changes as soon as the first head appears."`; after Done `showroom_spawn {manifest, presets: <every preset>, anchor: "v", distance_m: 3}`; M resumes changes; `showroom_clear` | Refused `writes_paused` part-way, naming the heads already placed; no head appears after the press; in the log no `showroom` spawn line after `bridge.writes_paused paused=true` (RB-122: a step queued before the pause is checked again on the game thread) | A head appears after the pause: record the log lines in order |
| L4 | C | `inventory_equip {item: <a jacket V owns>}` over the jacket V wears; the answer's undo; `inventory_unequip {slot: "OuterChest"}` and its undo | Both undos carry the worn jacket's `id`, and running them answers `exact` true with the same jacket back (RB-125) | `exact` false: record both answers |
| L5 | C | `player_teleport {offset: {forward: 60}, far: true}`; its undo | The undo carries `far: true` and puts V back where she stood (RB-127; before 0.8.1 it was refused `too_far`) | `too_far`: record the undo |
| L6 | C, M | `ask "Press Done, then bring another window in front of the game for ten seconds."`; `capture_screenshot {route: "screen", name: "L6"}`; `capture_burst {frames: 5, interval_ms: 1000, route: "screen", name: "L6b"}` started with the game in front, M switches away during it | Both refused `capture_not_foreground`, nothing written, no picture of the other window anywhere in the capture folder (RB-120) | Any file shows the other window: delete it and record the answer |

**K. Friction log (throughout).** Everything met in passing (AGENTS.md), including anything about answering from the game.

## Session 8 checks (bridge 0.7)

Only with the 0.7.0 -writes build built with `--allow-inventory` ([build record](#build-record-bridge-070-branch-build-not-staged)); Codeware, XF Finish Showroom and Equipment-EX staged as for session 7. Each group proves one of 0.7's new hooks ([inventory](bridge-hook-inventory.md)), session 7's fixes or the 0.7.0 deep review's fixes (RB-96..118, [code-health ledger](../authoring/code-health.md)) in the game. About 55 minutes in ten groups; each stands alone, so a short sitting can stop between them (A, C and E first). C is the coordinator, M the maintainer; tool names are the MCP names. **New this session:** C asks with `ui_message {level: "ask"}` and waits with `session_wait`; M answers in the game with the keys the XF panel shows (F6 Ready, F7 Yes, F8 No by default) or the buttons in the XF window of the CET overlay, and can send a comment from that window at any time. Behaviours in rows that need M start only after M's Ready (session 7: keep_framed's time ran out before M began). Evidence: every answer's JSON, the named captures, `session_log {tail: 500}` at the end, the plugin log copied **before** any relaunch.

**Restage first** (coordinator, MO2 closed): **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.7.0-writes.zip` (manifest `"version": "0.7.0"`, `"inventory_writes": true`, `cet/.../theme.lua` present). Its `config.ini` has `[overlay] enabled = true` and `theme = dark`, and `[ui] answer_keys`. A save in V's apartment; a street with a door, a vending machine, an NPC and a parked car in reach; a save whose V can take arm cyberware (any V: `add_if_missing` adds it).

**A. Preflight and in-game answers (6 min).** V in her apartment, on foot.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| A1 | C | `bridge_info`; `ui_state`; `overlay_state` | `plugin_version` 0.7.0; the log has `natives=18` and `overlay.hook_attached present=true resize=true render_shutdown=true`; `bridge_info.overlay.theme` dark, `answer_keys` F6 F7 F8 F11; `ui_state.tier` `staged`, `cet_overlay` false or null | `natives=15`: the old DLL is staged. No `overlay.hook_attached`: record `overlay_state.missing` |
| A2 | C, M | `ui_message {text: "Press F6 when you can see this", level: "ask", seconds: 120}`; `session_wait {message_id: <its id>, timeout_s: 120}`; M presses F6 in the game | The XF panel shows the question and `[F6] Ready  [F7] Yes  [F8] No` under it; the wait returns `answer.label` Ready, `via` `ink_key`; the panel shows "Answered: Ready" briefly | Keys do nothing: record `ui_state.pending_ask` and the log's `answer key` lines (Codeware's key callback) |
| A3 | C, M | M opens the CET overlay; `ui_state`; `ui_message {text: "Pick one", level: "ask", choices: ["Key", "Fill", "Rim"], seconds: 120}`; M clicks **Fill** in the XF window; then types "comment check" in the comment box and presses **Send**; `session_wait {kinds: ["answer", "comment"]}` twice; M closes the overlay; `ui_state` | `cet_overlay` true while open, false after; the window is in the XF Studio dark theme (graphite panel, yellow question heading); the waits return `Fill` (`via` `cet_button`) and the comment | The window keeps CET's own colours: record the CET log's `panel` lines |
| A4 | C, M | `ui_message {level: "ask", text: <a 500-character question>, seconds: 90}`, then five `ui_message` info lines; M reads the CET label and the XF panel | Both wrap the whole question (600 characters shown at most); the question stays on screen while the info lines come and go (pinned) | The question is pushed out: record `ui_state.pending_ask` |
| A5 | C, M | `ui_message {text: "Press F7 now, before I wait", level: "ask", seconds: 120}`; M presses F7 at once; only then C calls `session_wait {message_id: <its id>}`; then `ui_message {text: "Stay for the capture", level: "ask", seconds: 120}`, `capture_screenshot {}`, `ui_state`; then `session_wait {message_id: <the second id>}` while C sends its undo (`ui_message {withdraw: <id>}`) | The first wait returns Yes at once with `answered_before_wait` (RB-96); after the capture `ui_state.pending_ask` is still the second question (RB-103); the second wait ends with `question_gone` | The first wait times out: record `session_events {kinds: ["answer"]}` |

**B. The XF panel on this screen (3 min).** The street (session 7: on 3840×1600 the panel sat off-screen).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| B1 | C, M | `ui_hud {}`, capture the whole window; `ui_hud {anchor: "bottom_left", x: 60, y: 200, scale: 1.3}`, capture; `ui_hud {anchor: "top_right", x: 2000}`, capture; `ui_hud {reset: true}` | Top right: the whole panel on screen, near the corner; bottom left: fully visible and larger; x 2000 is clamped (the panel stays on screen). The log's `overlay attached layer=hud size=W×H` line gives the layer's own size (record it) | Still off-screen: record the `size=` line and the captures |

**C. World objects are safe to look at (4 min).** Session 7 crashed on a door. The street.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| C1 | M, C | M looks at a door, then a vending machine, then an NPC, then a parked car; for each C calls `player_state` and `scene_report {include: ["subjects"]}` | No crash. `look_at` has `id`, `class` and `distance` for each; the NPC and the car also a `record`; `hud_prompt` shows the prompt's title (the door's Open, the machine's name). The NPCs in `scene_report` have `record`, not `name` | A crash: copy the plugin log before relaunching; its last `script.call` line names the call. Evidence into the session folder |

**D. Scene tiers (3 min).** V's apartment, then the street.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| D1 | C | Apartment: `player_state`; `player_teleport {offset: {forward: 1}}` and its undo; `player_look {yaw: 30, relative: true}` and its undo | `tier` `staged`, `busy` ""; `staged_scene` true or false (record it); the teleport and the look go through and back | Refused `in_scene`: record `psm` and `in_dialogue` |
| D2 | C, M | The street: `player_state`; then M starts a conversation with an NPC and C calls `player_teleport {turn: 10}` | `tier` `full`, `busy` ""; during the conversation the teleport is refused `in_scene` (dialogue) | — |
| D3 | C, M | M jumps repeatedly while C calls `player_state` and `player_teleport {turn: 10}` a few times | A refused teleport's message names the state (`player_busy: locomotion:Jump` or `falling`); `player_state.psm_detail` now shows `locomotion_name` and `on_ground` false in the air (session 7: all zeros at the same moments) | Record `psm_detail` samples |
| D4 | C, M | `ui_message {text: "Ready to move the mouse during a look?", level: "ask"}`, `session_wait`; after M's Ready: `behave_look {turn: {yaw: 90}, duration_s: 4}`; M moves the mouse at once | The look stops `user_took_over` naming `CameraMouseX` or `CameraMouseY` (session 7: it ran to `reached`) | Record `session_events {kinds: ["behaviour"]}` (camera input may not reach listeners during the game's look-at) |

**E. Arm cyberware (7 min).** The render study's capture C6 without a ripperdoc. The street, V on foot, then photo mode.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| E1 | C | `cyberware_state` | Every cyberware area with its slots; `arms.holster_state` `holstered_default` (no arm cyberware) or the installed one's; `right_arm_slot.appearance` the same name | `holster_state` empty: record `arms.chain` |
| E2 | C, M | `cyberware_equip {item: "Items.MantisBlades", add_if_missing: true}`; keep its undo; `cyberware_state`; `photo_open`; `photo_frame {target: "head-and-shoulders"}`; `photo_hud_hide {}`; capture both forearms (`e2-mantis-holstered`); `photo_exit` | `equipped` true; `arms.holster_state` `holstered_mantis`, `creator_group` `holstered_mantis_tpp`; the capture shows the holstered blades' plating on the forearms (M confirms) | Not equipped: record the answer's `note` and `cyberware_state` |
| E3 | C, M | `player_action {name: "weapon.arms"}`, capture (`e3-mantis-drawn`); its undo (`weapon.holster`) | The blades come out (M confirms); `cyberware_state.arms.weapon_right_slot` names the weapon while drawn; holstered again after | Nothing drawn: record `weapon_right_slot` and M's view |
| E3b | C | While the blades are drawn (E3, before its undo): `cyberware_unequip {area: "ArmsCW"}`; `cyberware_equip {item: "Items.StrongArms", add_if_missing: true}` | Both refused `arms_drawn`, nothing changed and nothing added (RB-112) | Record the answers and `cyberware_state` |
| E4 | C, M | E2's undo; then `cyberware_equip {item: "Items.StrongArms", add_if_missing: true}`, photo mode, the same framing and capture (`e4-gorilla`); photo light 1 on (`photo_light_set {light: 1, on: true}`), capture again (`e4-gorilla-light`); photo mode closed; its undo | After E2's undo `holstered_default` and the Mantis Blades gone from the inventory (`removed: true`); Gorilla Arms `holstered_strong`; both captures kept for C6 (the glass under the light is C6's question) | The undo leaves an item: record both answers |

**F. The world (4 min).** The street.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| F1 | C | `world_state {facts: ["tutorial_ripperdoc_eyes_passed"]}`; `world_probe {around_v: true, ring_m: 4}` | The clock, the rain, `weather.name` (with Codeware) and `weather.states`; the fact's value; nine probes with `navmesh_streamed`, `walkable`, `ground` (and `ceiling_m` under cover) | `weather.readable` false: Codeware isn't loaded |
| F2 | C, M | `world_weather_set {name: "24h_weather_rain", blend_s: 1}`, capture; `game_save {name: "xf weather hold", override_lock: true}`; its undo, capture; `cyberware_equip {item: "Items.MantisBlades", add_if_missing: true}`; `world_weather_set {name: "24h_weather_fog"}`, `bridge_kill`, M presses Reconnect; `world_state`; after two seconds `cyberware_state` | Rain within a few seconds; the save refused `bridge_effects_active` naming the weather, nothing saved (RB-102); back to the earlier weather after the undo; after the kill the log's `RestoreAfterKill` line has `weather_restored` and `cyberware_restored`, `weather.set_by_bridge` is false, the arms hold what they held before E-group's first change and the Mantis Blades copy is gone (RB-102) | The weather or the blades stay: record `world_state`, `cyberware_state` and the log's `kill-restore` lines |

**G. Photo mode's rows and framing (5 min).** A public place with people around; photo mode.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| G1 | C, M | `photo_open`; `photo_state {options: true}` (read keys 54 and 69's option labels); `photo_scene_set {npcs: {label: <the "off" option's label>}}`, capture; its undo | The surrounding NPCs vanish and come back (M confirms); the answer names `matched_by` | Record key 54's options and the answer |
| G2 | C, M | M flies the drone camera about 8 m from V; `photo_frame {target: "face"}` | Framed (no `framing_bound`); the answer has `reseated_camera.from_m` about 8 and a note | Record the refusal and `photo_subject` |
| G3 | C | `showroom_spawn {manifest, presets: [one], distance_m: 1.5}` under the drone camera | `pieces[0].eyes_on_screen` near {0, 0} by `game`, or by the model with the note that the game's projection disagreed with its camera (session 7's case); never −1.2 with `in_frame: false` for a centred head | Record `scene_read {parts: ["camera"]}` |
| G4 | C | `showroom_rotate {sweep: {steps: 3, capture: true}}`; `capture_sheet {sweep: <its answer>, title: "sweep"}`; `showroom_light {rig: "none"}` (no manifest) | One sheet with cells labelled -60, 0 and 60 deg; the rig-off call needs no manifest | — |
| G5 | C, M | `world_pin {piece: 0, label: "Gloss A", variant: "clothes"}`, `world_pin {at: "v", label: "V was here"}`; M looks at the head, at the minimap, and opens the map; `showroom_clear` | Both pins in the world as the cyan XF diamond with the label, the head's just above its eyes (session 7: the default circle, well above); both on the minimap and the map; clearing the heads removes the head's pin | The default icon: the world pin's controller isn't one of the four wrapped (record which views show what) |
| G6 | C, M | Photo mode closed, V facing a wall about 1.5 m away: `showroom_spawn {manifest, presets: [one], anchor: "v", distance_m: 2}` | The head stands clear of the wall: the answer's `moved_for_space` says how far it moved and why (session 7: half inside a wall and a bench) | Record the answer and a capture |

**H. Saves and Equipment-EX (3 min).** The street, Equipment-EX's outfit on.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| H1 | C | `game_saves {limit: 5}` | Five saves newest first with type, location, quest, level and time | `with_metadata` 0: record it (the details callback didn't come outside the Load menu) |
| H2 | C, M | `wardrobe_state`; `wardrobe_equip {item: "Items.Helmet_01_basic_01"}` (added first with `inventory_equip {…, add_if_missing: true}` if needed); its undo | `script_outfit.version` 1.2.9; the helmet shows on V (M confirms), or the refusal says which: EquipmentEx answered false, the call didn't run, or the item's outfit slot | Record the refusal's text |

**I. The XF overlay host, P0 (12 min, plus the three quits of I6 at the end).** Anywhere; the overlay is on in this build.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| I1 | C, M | `overlay_state`; M looks at the top left under the CET label | `phase` drawing, `back_buffer` format and size, `hdr_mode` disabled, `theme` dark; the diagnostic panel in the XF Studio dark theme (graphite, the yellow "XF RUNTIME BRIDGE", a cyan bar sweeping once a second), smooth, in gameplay, menus and photo mode | `refused`: record `refusal` (HDR, format, window). No panel with `drawing`: record `frames` (0 means the present hook never drew) |
| I2 | C | `capture_screenshot {}` | `overlay.overlay_host_hidden` true and the panel absent from the picture; it returns afterwards | The panel in the picture: record the answer |
| I3 | M, C | M opens and closes the CET overlay; `overlay_state` in between | The XF panel hides while CET's overlay is open (`cet_open` true) and returns | — |
| I4 | M, C | M switches windowed ↔ borderless and changes the resolution once; `overlay_state` | The panel returns at the new size; `resizes` counts up; the log has `overlay.reset` | A crash or a black screen: copy the log first |
| I5 | M, C | If the game offers it: frame generation on, watch the bar; HDR on (then restart) and `overlay_state` | Record ghosting or flicker of the bar with frame generation; in HDR `phase` refused with the HDR reason and nothing drawn | — |
| I5b | M, C | SDR, the panel drawing. M switches HDR on in the game's graphics options **without** restarting; `overlay_state`; M switches it off again | No crash, no black screen; `phase` refused with a reason starting "after a resize" (or naming the new format), nothing drawn from then on (RB-97); the log has `overlay.refused` | The panel keeps drawing in HDR: record `overlay_state.back_buffer` and a capture |
| I5c | M, C | If the game offers it: frame generation toggled on, then off; after each, M changes the resolution once; `overlay_state` after each step | No crash; either `phase` drawing with `frames` still climbing and `resizes` counting up, or `phase` failed with the swap-chain reason ("the game's swap chain changed", RB-105) and nothing drawn; record which | A hang or a crash: copy the log first |
| I6 | M | At the end of the evening, three quits to the desktop over three launches: one plain; one with the CET overlay open at the moment of quitting; one with frame generation on (if offered). Time each from the quit click until `Cyberpunk2077.exe` is gone from Task Manager | No crash dialog; the process gone within 10 s each time; each log ends with `overlay.shutdown ... released its objects` (RB-100) | A hang past 10 s: note which quit, copy the log and the crash report if any |
| I7 | C, M | `overlay_state` (note `cpu_ms_max`); `ui_message {level: "ask", seconds: 60, text: <about 400 characters mixing Polish, Japanese, emoji and accented Latin>}`; M watches the panel for 10 s; `overlay_state` | The panel shows the question with the accented Latin intact and the other characters as a replacement mark; `phase` still drawing; `cpu_ms_max` not above the first reading plus about 1 ms (no glyph upload on the render thread, RB-99) | `phase` failed with the upload reason, or a stall: record both `overlay_state` answers |

**J. Friction log (throughout).** Everything met in passing (AGENTS.md), including anything about answering from the game.

## Session 7 checks (bridge 0.6)

Only with the 0.6.0 -writes build built with `--allow-inventory` ([build record](#build-record-bridge-060-branch-build-not-staged)), Codeware and XF Finish Showroom staged. Each row proves one of 0.6's fixes or new layers (session 6's wardrobe and placement bugs, the agent's own view of the game, the session log and handover, behaviours, player control phase 1, the camera-preset route), and group F folds in the ink demos 0.5.3 added (temporary test features, never run yet). About 30 minutes in six groups; each group stands alone, so a short sitting can stop between them. C is the coordinator, M the maintainer; tool names are the MCP names. Evidence: every answer's JSON, the captures named in each row, `session_log {tail: 500}` at the end, and the plugin log copied **before** any relaunch.

**Restage first** (coordinator, MO2 closed): **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.6.1-writes.zip` ([build record](#build-record-bridge-061-branch-build-not-staged); manifest `"version": "0.6.1"`, `"inventory_writes": true`, `write_classes` ending in `player`). 0.6.1 replaces 0.6.0 for this session: every row below holds for it, A1 expects `plugin_version` 0.6.1 and `natives=15`, and group G adds its own fixes. Equipment-EX stays enabled (group B tests the bridge under it). A save in V's apartment and one in the street with 4 m clear in front of V.

**A. Preflight (4 min).** V in her apartment, on foot, unarmed, the game window in front.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| A1 | C | `bridge_info`; `input_probe`; `player_state`; `scene_report {}` | `plugin_version` 0.6.1; the log has `natives=15`. The probe lists `FunctionalTestsGameSystem`'s fake-input functions with `params` counts and `handler` offsets, `system_instance`, `game_in_front: true` and the pad import's DLL (record all: they feed the input-channel disassembly). `player_state`: position, yaw and pitch that match the view, `psm.high_level_name` `SceneTier2` (apartment), `busy: ""`, a `look_at` when M looks at the door. The report: `camera.mode` `gameplay`, `projection.by` `game` and its `fov_axis` (record it: it settles which axis the game's field of view is) | `script_layer_missing`: the Scripts folder is stale; record the log's `rtti.register` lines |

**B. The wardrobe under Equipment-EX (5 min).** V in the street wearing an Equipment-EX outfit (as in session 6).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| B1 | C | `wardrobe_state`; `inventory_equip {item: "Items.Helmet_01_basic_01", add_if_missing: true}` | `manager: "script"`, `managed_by: "EquipmentEx"`, `set: 0`, `script_outfit` with its parts; the equip answers `hidden_by_outfit` with an `outfit_note` naming Equipment-EX and `suspend` | `manager: "none"` with an outfit on: record `wardrobe_state` whole |
| B2 | C, M | `wardrobe_equip {item: "Items.Helmet_01_basic_01"}`; `photo_open`, capture the face; `photo_exit`; the answer's undo; `wardrobe_state` | `route: "EquipmentEx"`, `shown: true`, the helmet among `script_outfit.parts`; the capture shows the helmet on V (M confirms); after the undo the parts are exactly as in B1 | Not drawn: `wardrobe_state` and the plugin log's `wardrobe.equip` lines |
| B3 | C, M | `wardrobe_equip {suspend: true}`, capture; `wardrobe_equip {resume: true}`, capture; `wardrobe_equip {suspend: true}`, `bridge_kill`, M presses Reconnect, capture; `inventory_unequip {item: "Items.Helmet_01_basic_01", remove_added: true}` | Suspend: the outfit comes off and V shows her equipped clothes with the helmet (`manager: "none"`); resume: the outfit is back with its parts. The kill line has `wardrobe_resumed: true` and the outfit is on again | The outfit stays off after resume: record `wardrobe_state` (Equipment-EX's reactivation) |

**C. Showroom, the agent's view and captures (8 min).** The street, V on foot; then photo mode.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| C1 | C, M | `photo_open`; `photo_frame {target: "face"}`; `showroom_spawn {manifest, presets: [one], distance_m: 1.5}`; capture the whole window | `height_from: "camera_ray"`; `pieces[0].eyes_on_screen` about `{x: 0, y: 0}` `by: "game"`; the capture shows the head's eyes at the window's centre (session 6's 0.18 m error gone). Record `eyes_on_screen` and M's judgement | The eyes off-centre: record `eyes_on_screen`, the capture and `scene_read {parts: ["camera"]}` |
| C2 | C | `showroom_light {manifest, rig: "creator_face"}`; `scene_report {manifest, focus: "piece:0", include: ["camera", "subjects", "lights", "frame"]}` | Subjects V and `piece:0` with bounds, `in_frame` 1 and margins; lights: the rig's with shares summing to 1, photo mode's three with `found` and `to_face`; `frame` with a mean luminance; `warnings` empty (or naming a real problem) | A subject missing: record `scene_read` raw |
| C3 | C | `capture_screenshot {expect: {subject: "piece:0", in_frame_margin: 0.05, unoccluded: true, lit_by: "rig", luminance: [0.1, 0.9]}, manifest}`; then `{expect: {subject: "piece:0", in_frame_margin: 0.45}}` | The first captures with `expectations.ok: true` and `overlay.cleared: true` (no XF lines or panel in the picture); the second is refused `expectation_failed` and takes no picture | The overlay in the picture: record the capture and `ui_hud {}` |
| C4 | C, M | `showroom_rotate {sweep: {steps: 3, capture: true}}`; `capture_sheet {cells: [<the three sweep captures with labels -60, 0, 60>], title: "sweep"}`; `showroom_light {rig: "none"}` | One labelled sheet file with its manifest; the rigs go, the head stays | — |
| C5 | C, M | `behave_turntable {deg_per_s: 45, revolutions: 1}`; watch; `session_handover {lights: "keep", note: "judge by hand"}` part-way; M uses photo mode's own controls, then presses **Mark this moment** in the CET panel; `photo_camera_set {fov: 30}`; `session_resume`; `session_log {tail: 30}` | The head turns and stops, turned back (the handover stops it); during the handover the camera write is refused `handed_over`; the log shows the turntable's start and stop (`reason: "handed_over"`), the handover, the refusal, M's marker (`source: "game"`) and the resume | The head stays turned: record the stop event |

**D. Camera research (4 min).** Photo mode, the head from C1 still there.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| D1 | C | `photo_camera_preset {preset: 9, values: {dist: -2.5, fov: 20}}`, capture; the answer's undo, capture | Record `camera_moved_m`, `camera_after` and `written`: moved about 0.7 m or more means photo mode reads the preset's record when it is selected (the placement route). The undo puts the values and selection back | `tweakxl_missing`: TweakXL isn't loaded; `camera_moved_m` 0: photo mode caches presets when it opens (reopen photo mode and select 9 again, record) |
| D2 | C, M | `behave_keep_framed {subject: "piece", piece: 0, distance_m: 1.5}`; M moves photo mode's camera slowly with the mouse; `behave_stop`; then `behave_keep_framed {subject: "v", at: {x: 0.2, y: 0}}` for 10 s, `behave_stop` | The head follows the camera, staying centred at 1.5 m; V is steered to the right third; the stop events carry the undo (V's placement) | The head doesn't follow: record `behave_list` and `session_events {kinds: ["behaviour"]}` |

**E. Player control, phase 1 (6 min).** V in her apartment, on foot, unarmed; a fresh manual save first (`game_save`). The [player-control card](player-control-design.md#7-first-in-game-test-card-about-10-minutes), condensed.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| E1 | C | `player_teleport {offset: {forward: 2}, turn: 90}`, then its undo | V stands 2 m ahead turned left, then back; `held: true` both times | `no_ground`: record the target |
| E2 | C, M | `player_look {yaw: 45, pitch: -20}`; `player_look {at: <the door's position from scene_report>, mode: "smooth", duration_s: 2}`; `behave_look {turn: {yaw: 90}, duration_s: 3}` while M moves the mouse | The view jumps, then glides; both answer `within_2_deg: true`; M's mouse breaks the behaviour (`not_reached`) | Angles off: the answer and a capture |
| E3 | C, M | `behave_glide_path {offset: {forward: 3}}`; then a second `{offset: {forward: 6}, speed_m_s: 1}` and M presses the kill hotkey part-way; M presses Reconnect | V glides 3 m (`arrived`, `animated: false` in its summary); the kill stops the second, V walks with WASD again (`player_state.bridge_effects` empty) | V can't move afterwards: `player_stop`, record the effects |
| E4 | C, M | `player_action {name: "crouch"}`, then its undo; `{name: "weapon.draw"}` (if V has one), its undo; `{name: "menu.open", menu: "inventory"}`, then `{name: "menu.close"}`; `{name: "menu.open", menu: "wardrobe"}`, M closes it; `player_interact_list` in front of the door | V crouches and stands; draws and holsters; the inventory opens and closes; the wardrobe screen opens with no wardrobe device; the list shows the door's prompt with `Choice1` | Record which step; `menu.close` failing is a [hypothesis] in the design |

**F. The ink demos from 0.5.3 (4 min).** V on foot in the street, the head from C still spawned (or `showroom_spawn` one). The detailed [0.5.3 rows](#ink-demo-rows-bridge-053) keep their "If not" columns.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| F1 | C, M | `ui_hud {}`; `ui_message {text: "XF panel check", level: "ask", seconds: 30}`, capture; `ui_hud {anchor: "bottom_left", x: 60, y: 200, scale: 1.3}`, capture; its undo | `panel_attached: true`; the XF panel top right in the HUD's font and colours with the ask line (M: does it read like the game's HUD?); it moves and scales, then comes back (U1, U2) | No panel: the log's `ink` lines |
| F2 | C, M | `photo_open`, capture; `ui_hud {layer: "top"}`, capture; `ui_hud {reset: true}`; `photo_exit` | On `hud` the panel hides in photo mode; record whether `top` shows it (U3) | — |
| F3 | C, M | Walk around the head (M); `world_pin {piece: 0, label: "Gloss A", variant: "clothes"}`, `world_pin {at: "v", label: "V was here"}`; M opens the map and hovers each; `game_load {latest: true, discard_unsaved: true}`, `game_wait`; M checks the map | The pedestal shows its nameplate, gone past 15 m (U5); the pins show in the world, on the map with their tooltips and on the minimap (U7); after the load no XF pin and no head (U8) | A pin survives the load: record it |

### 0.6.1 additions to the session-7 checks

**G. What only the game can show of 0.6.1's fixes (about 10 min).** Deep review 6's bridge findings (RB-79..92, [code-health ledger](../authoring/code-health.md)) are fixed and tested offline; these rows check the parts the simulation can't: that the player's own input reaches the bridge's listener while a glide holds V, that a handover and the kill switch give V back, that saves refuse while the bridge holds something on her, Equipment-EX driven by reflection, and the state machine's busy values. G1 to G4 in V's apartment (on foot, unarmed; a fresh manual save first), G5 and G6 in the street with Equipment-EX's outfit on (as group B), G7 in photo mode with a showroom head. Friction log as always.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| G1 | C, M | `player_action {name: "crouch"}`; `session_handover {note: "stand V up"}`; M walks, crouches and stands with the keyboard; `player_state`; `session_resume` | V stands up as the handover answers (its `steps` include "give V back" with `removed` naming `GameplayRestriction.ForceCrouch`); M's own keys work at once; `bridge_effects` is empty (RB-82) | V stays crouched: `player_stop` frees her; record the handover answer and the plugin log's `bridge.handover` lines |
| G2 | C, M | `behave_glide_path {offset: {forward: 8}, speed_m_s: 1}`; about 2 s in, M taps W. Then again, and this time M only moves the mouse | The first glide stops within a frame of W with `reason: "user_took_over"` naming `MoveY` (or `MoveX`) in `session_events {kinds: ["behaviour"]}`; V walks at once, `bridge_effects` empty. Record whether the mouse alone stops the second (camera input counts by design §4.2; a mouse move of 3 units or more) (RB-81) | The glide runs on under W: the input listener sees nothing while `NoMovement` holds V; `behave_stop`, record the events. That is the input-channel question (player-control design §2.5) |
| G3 | C | `behave_glide_path {offset: {forward: 3}, max_s: 60}` | Refused `bad_params` (a glide runs at most 30 s) | — |
| G4 | C, M | `player_action {name: "crouch"}`; `game_save {override_lock: true}`; M opens the Load menu; `player_stop`; `game_save {override_lock: true, name: "0.6.1 check"}` | The first save is refused `bridge_effects_active` naming the crouch, and no new save appears; after `player_stop` the save goes through and the lock is back on (RB-83) | A save made with the crouch on: record it and delete it in the Load menu |
| G5 | C, M | M sits on the apartment's couch (its Sit prompt), then jumps a few times on the floor; meanwhile C calls `player_state` and `player_teleport {turn: 10}` | Sitting: `busy: "player_busy"`, `busy_state: "workspot"`, the teleport refused `player_busy`. Record `psm_detail` in each state (jump, fall, landing values); a teleport mid-jump refused. If a body or an NPC to take down is at hand, `busy_state` `carrying_body` / `takedown` too (RB-79) | `busy_state` empty while sitting: record `psm_detail` (the workspot flag this build reads) |
| G6 | C, M | In the street with Equipment-EX's outfit on: `wardrobe_state`; `wardrobe_equip {item: "Items.Helmet_01_basic_01"}` (add it first as in B1 if needed), keep its undo; `wardrobe_equip {suspend: true}`; apply the kept undo; `wardrobe_state`; `wardrobe_equip {resume: true}`. Then `wardrobe_equip {suspend: true}` and `bridge_kill`; about a second later M looks; M presses Reconnect | `script_outfit` shows `version` (1.2.9), `api: "checked"` and an `id` per part. The undo applied while suspended switches the outfit back on with exactly the parts before the helmet (`applied` starting `script:activated`; RB-84). The kill line has `wardrobe_restore: "after_resume"`, and the outfit comes back with its parts about half a second later (the log's "wardrobe restored after the resume") | `available: false`: record `why` (Codeware's reflection didn't find a function; RB-85); parts missing after the kill: record `wardrobe_state` |
| G7 | C, M | Photo mode, a showroom head spawned: `world_pin {piece: 0, label: "Gloss A"}`; `showroom_clear {what: "pieces"}`; M checks the minimap. Then `photo_camera_preset {preset: 9, values: {dist: -2.5}}`, `bridge_kill`, M presses Reconnect and selects camera preset 9 in photo mode's menu | The pin goes with the head (`removed_pins: 1`; RB-87). After the kill the log has `bridge.kill_restored_preset preset=9` and preset 9 frames as it did before the rewrite (RB-90) | Record the preset's framing with a capture |
| G8 | C | Normal play: `capture_screenshot {expect: {subject: "v", unoccluded: true}}`, then with `on_fail: "warn"` | The first is refused `expectation_failed` saying the sight line was not checked (rays run only in photo mode); the second captures with `expectations.not_checked: ["unoccluded"]`, never `ok: true` (RB-88) | — |

## Ink demo rows (bridge 0.5.3)

Folded into the [session-7 checks](#session-7-checks-bridge-06) as group F; the rows below keep the detail and the "If not" steps. Written for the 0.5.3 -writes build, Codeware and XF Finish Showroom staged. Proves the three ink demos, **temporary test features** ([route map](in-game-ui-design.md), [ink knowledge](../../knowledge/ink-ui.md)); every row also answers an open question there. Captures of the whole window (`capture_screenshot`), the plugin log before any relaunch. C is the coordinator, M the maintainer.

**Restage first** (coordinator, MO2 closed): **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.5.3-writes.zip` (manifest `"version": "0.5.3"`; with `--allow-inventory` if session 6's wardrobe rows are repeated). Its `config.ini` has a new `[ui]` section (`hud_panel`, `cet_label`, `nameplates`, all `true`). About 20 minutes, after the session-6 rows.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| U1 | M, C | M loads a save, V on foot in the street. C: `layers_status` (raw `call layers.status`), `ui_hud {}`, capture; `ui_message {text: "XF panel check", level: "ask", seconds: 60}`, capture | The plugin log has `overlay attached layer=hud size=…` (the `ink` layer announced); `panel_attached: true`. Top right: a dark panel with a red edge, "XF RUNTIME BRIDGE" in the HUD's red, a yellow status ("… changes allowed"), the ask line in yellow, in the game's font; M: does it read like the game's HUD? | No panel: record `layers_status` and the log's `ink` lines (Codeware missing, root never found) |
| U2 | C, M | `ui_hud {anchor: "bottom_left", x: 60, y: 200, scale: 1.3}`, capture; `ui_hud {cet_label: false}` (the CET label goes); the undo of each; `ui_hud {show: false}`, then `{show: true}` | The panel moves to bottom left at 1.3× within a second and keeps its shape on the 3840×1600 screen (not squashed); the undo puts it back; the CET label hides and returns | Wrong size or stretched: the HUD root isn't in screen pixels; record the capture and `size=` from U1 |
| U3 | C, M | Photo mode (`photo_open`), capture; `ui_hud {layer: "top"}`, capture; `ui_hud {layer: "notifications"}`, capture; open the pause menu (M), capture; `ui_hud {reset: true}` | On `hud` the panel hides in photo mode and menus (the game hides its HUD). Record for `top` and `notifications`: shown in photo mode? in the pause menu? | The panel never returns after a layer change: record the log's `ink overlay mounted` lines |
| U4 | C | Tick while hidden: `ui_message {text: "while hidden", seconds: 20}` during photo mode on `hud`, close photo mode | The line is there at once when the HUD returns (the tick ran or restarted) | Only after a few seconds: the tick stopped while hidden; note the delay |
| U5 | C, M | Nameplates: `showroom_spawn {manifest, presets: [three]}`; capture from V's eye (normal play); walk around them (M), then turn the camera fast | Each pedestal shows its number and preset name on its front, smaller further away, gone past 15 m; they follow the pedestals with no more than a slight lag | Labels in the wrong place (mirrored, offset): ProjectPoint's space was misread; record the capture and `photo_subject`'s `screen` values |
| U6 | C | `ui_hud {nameplates: false}`, then true; `showroom_clear` | The labels hide and return; clearing the showroom removes them | — |
| U7 | C, M | Pins: `world_pin {position: <a point 30 m ahead from game_status/showroom_anchor>, label: "XF test pin"}`; `world_pin {piece: 0, label: "Gloss A", variant: "clothes"}`; `world_pin {at: "v", label: "V was here"}`; capture the world; M opens the map, hovers each pin, captures; M looks at the minimap | In the world: a cyan XF diamond with its label over each point, through walls; the head's pin follows `showroom_rotate`. On the map: the badges and labels at the right places, the tooltip titled with the label and the "test pin" line; on the minimap the badge without a label. Record which views show the vanilla variant icon instead | No badge anywhere: the variant's controller isn't one of the four wrapped; record which views show a plain pin |
| U8 | C | `world_pin_clear {id: 1}`; `game_load {latest: true, discard_unsaved: true}`, `game_wait`; M checks the map; `world_pin {at: "v", label: "kill"}`, `bridge_kill`, M presses Reconnect | The pin goes; after the load no XF pin anywhere; the kill line has `bridge.kill_cleared_pins` with `removed` [n] and the pin disappears | A pin survives the load: record it (runtime pins persist; `world.pin` must then clear at detach) |
| U9 | C, M | **Finishes rework** ([experiment 033](../../experiments/033-finishes-rework/README.md)). Needs XF Finish Showroom **restaged** from `claude/finishes-rework`: session 2's archive (`60e5ed41…cc04`, *Shimmer · strong* now *shimmer-grain-2*) and board 2's (`998d4bf5…fe05d`). **Close-ups:** for each of *Shimmer · strong*, *Glitter A · reference*, *Glitter B · 1 vs 2*, *Glitter C · direct* and *Glitter D · clustered*, one at a time: `photo_open`; `showroom_spawn {manifest, presets: ["<name>"], anchor: "camera", height_m: 1.9}`; `showroom_light {manifest, rig: "creator"}`; `photo_camera_set {fov: 9}`; `showroom_rotate {sweep: {from_deg: -30, to_deg: 30, steps: 3, capture: true, region: "face", name: "<name>"}}`. **By hand:** respawn the same heads without a rig (`showroom_spawn` only, `photo_hud_hide`); M judges each with movable lights (CharLi or photo-mode lights), moving the light and turning the head. Last, *Glitter E · mips* pulled back to face framing and *Glitter F · accent* with the lights off | **Shimmer:** close up, a dense fine speckle across the lid that shifts as the light moves, over a soft, slightly tinted sheen, with no smooth glossy highlight; at face framing an even soft sheen, no dots. **Glitter:** on A, C and D, individual points switch on and off on their own as the light or head moves, pigment visible between them, nothing that looks printed; on B, the right lid (flakes-2 normals) does so more clearly than the left (board 1, session 6's). E: the nested left lid keeps points longer than the BOX right. F: accent points visible in the dark (or record "accent absent") | **Shimmer still glossy:** record it; the speck share or roughness is next. **Hard, plastic lid:** the specks' metalness (fallback 0.08). **Glitter still printed on A and B's right lid:** record which of A (small, dense) and B right (board 1's size) reads better; the flake size or the base's roughness is next. A crawl with everything still: the upscaler; one DLAA repeat |

## Session 6 checks (bridge 0.5.2)

Only with the 0.5.2 build ([build record](#build-record-bridge-052-branch-build-not-staged)). Each row proves one of 0.5.2's fixes or requests in the game. Tool names are the MCP names; C is the coordinator, M the maintainer.

**Restage first** (coordinator, MO2 closed): **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.5.2-writes.zip` built with `--allow-inventory` (manifest `"version": "0.5.2"`, `"inventory_writes": true`); rebuild and restage XF Finish Showroom from this commit (its column changed: `tools/build_showroom_package.ts`); **disable Character Customization Anywhere** in the test profile (T8).

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| T1 | M, C | M loads a save, V on foot in the street. C: `bridge_info`; `showroom_spawn {manifest, presets: [one]}`; `game_load {latest: true, discard_unsaved: true}` then at once `game_status` and `game_wait {phase: ["gameplay"]}`; then the same load **without** a head | `plugin_version` 0.5.2. **No crash.** During the load `game_status` answers `phase: "loading"`, `answered_by: "plugin"`; the wait ends in gameplay. The plugin log shows `script_layer.load_requested`, `.detached`, `.attached`, `.ready` in that order, and any call between them as `script_layer.call_refused` | A crash: fingerprint it (`tools/minidump_summary.py`), keep the plugin log **before** the next launch prunes it, and stop the load checks |
| T2 | C | `photo_open`; `photo_frame {target: "face", yaw_offset: <y>}` for y = 35, 55, 0, three times, **no pauses**; then `photo_frame {target: "eyes", lens: "wide", span_m: 2}` | No `rate_limited` answer; the refused frame (`framing_bound`) says what it put back with `restored: true` | `rate_limited`: record the cid and the command log's timings |
| T3 | C | `photo_state {options: true}`: key 28's `face_table` and option 56; `photo_expression_index {index: 60}` | `face_table` `listed` and `readable` about 207, `source: "names"`; option 56 `Static: Sleeping` with `table_index: 60`, `table_index_verified: true`; the index applies with `index_by: "label"` and the face sleeps | `readable: 0`: record `listed` and `source` (the records couldn't be read) |
| T4 | C, M | In a dim place: `photo_camera_set {exposure: 1}`, capture; the answer's undo; then `photo_camera_set {exposure: 3}` | The image brightens, the undo puts it back; 3 is refused as outside the menu's range (-2.2 to 2.2) | `unavailable`: record `photo_state {menu: true}`'s key 10 |
| T5 | C | Research: `showroom_spawn {manifest, presets: [one], lateral_m: 0.8}`; `photo_camera_place {piece: 0, distance_m: 1.2}`, capture; `photo_camera_place {target: "v", distance_m: 2, azimuth_deg: 30}`, capture; the answer's undo | Record `held` and `off_m` for each. If `held: true` the capture frames the head (then V) from the asked place | `held: false`: photo mode places its camera itself; record it (the preset route in [knowledge §4](../../knowledge/photo-mode.md#4-camera-placement) is next) |
| T6 | C, M | Height and pedestal: in photo mode `photo_frame {target: "face"}` (note `distance_m`), `showroom_spawn {manifest, presets: [one], distance_m: <that>, lateral_m: 0.6}`, capture the whole window; then `showroom_spawn {manifest, presets: [one], distance_m: 1.3}`, capture | The first head stands beside V at her scale (M judges); the answer says `height_from: "camera"`. The second faces the camera at its eye line (the face, not the crown). In both, the neck sits in its column with no gap | A gap: record its size against the head in the capture |
| T7 | C, M | The helmet: `wardrobe_state`. If no outfit is active and one is stored, `wardrobe_equip {set: <one that leaves Head empty>}`. `inventory_equip {item: "Items.Helmet_01_basic_01", add_if_missing: true}`; `wardrobe_equip {item: "Items.Helmet_01_basic_01"}`; `photo_open`, capture the face; then A13: an XF Eye Artistry look on, capture | The equip answers `hidden_by_outfit: true` naming the outfit (or, with no outfit, the helmet already draws); after `wardrobe_equip` the helmet draws; A13: the `hx_` makeup hides under the helmet | The helmet still doesn't draw: `wardrobe_state` and the plugin log's `wardrobe.equip` lines |
| T8 | C, M | CCA disabled (M: F12 does nothing). V in the street. C: `cc_open {edit_mode: "new_game"}`, `cc_back`; `cc_open {}`, `cc_back` | Both open fully (`route: "pause_menu"`), rows change, `cc_back` returns to gameplay: the bridge's route needs no CCA | Half open or stuck: M loads the save; record the plugin log's `cc.open` lines |
| T9 | C | Undo and kill: `wardrobe_equip` with T7's undo, then `inventory_unequip {item: "Items.Helmet_01_basic_01", remove_added: true}`; `wardrobe_equip {clear: true}`; `bridge_kill`; M presses Reconnect | The undo puts the outfit back exactly (`wardrobe_state` as before T7); the kill switch's log line has `wardrobe_restored` (the wardrobe before the bridge's first change) | — |

Evidence: every answer's JSON, the captures (T4 before and after, T5 per placement, T6 both, T7 helmet and A13), the plugin log copied **before** any relaunch (RED4ext prunes it; session 5's crash log was lost that way), and the command log.

## Session 5 checks (bridge 0.5.1)

Only with the 0.5.1 build ([build record](#build-record-bridge-051-branch-build-not-staged)); the [finish showroom checks](#finish-showroom-checks-bridge-050) run on the same build. Each row proves one fix from session 4 or deep review 5 in the game before a session script relies on it. Tool names are the MCP names; C is the coordinator, M the maintainer.

**Restage first** (coordinator, MO2 closed): **replace** the `XF Runtime Bridge` entry's files with `xf-runtime-bridge-0.5.1-writes.zip`. Check the zip's SHA-256 and its manifest: `"version": "0.5.1"`, `"write_classes": ["photo", "world", "character", "save", "showroom"]`, `"inventory_writes": false` unless the maintainer has approved inventory writes.

| # | Who | Do | Expect | If not |
|---|---|---|---|---|
| S1 | M, C | M loads a save in V's apartment, V on foot, **and keeps the game window in front**. C: `bridge_info`, then `photo_open` | `plugin_version` 0.5.1; photo mode opens; the answer says `focus: "require"`, `focused_by_bridge: false` and has no `warning` | Wrong version: stop and restage |
| S2 | C, M | `photo_exit`. M clicks into another window (for example a text editor) and **types there**; C: `photo_open` | Refused `not_foreground`; the game stays behind and nothing M types reaches it | The game came forward: stop, record, and keep to `focus: require` sessions only after a fix |
| S3 | C, M | Still with another window in front: `photo_open {route: "postmessage"}` (research: never changes focus) | Either photo mode opens behind the other window (then posted keys work: record it, a candidate default) or `photo_open_timeout` | — (both answers are results; open question 1 of the [knowledge page](../../knowledge/photo-mode.md#open-questions)) |
| S4 | M, C | M clicks into the game; C: `photo_open` if not open; then the drift sweep: `photo_frame {target: "face", yaw_offset: <y>}` for y = 35, 55, 0, repeated three times (9 frames) | Every answer `lens: "portrait"`, `converged: true`, `residual.facing_deg` within 3, `chosen.fov` about 9 and `chosen.subject.near_far` about -1.15 **the same each time**, `distance_m` about 2.2 | A refusal `framing_bound`: record its message (V's space) and the steps in its detail |
| S5 | C | `photo_frame {target: "face"}`, `photo_hud_hide {}`, `capture_screenshot {region: "face"}`; then `photo_frame {target: "face", lens: "wide"}` and the same capture; then `photo_frame {target: "eyes"}` + `capture_screenshot {region: "eyes"}` | Portrait about 9 degrees, wide about 66 (session 4's two sheets), eyes about 5, each `converged` | — |
| S6 | C | Refusal and restore (RB-68): `photo_subject {}` and `photo_state {menu: true}` (keys 2, 15, 23); then `photo_frame {target: "eyes", lens: "wide", span_m: 2, xf_preset: true, look_at: "off"}`; then both reads again | Refused `framing_bound` naming the field of view needed; its detail has `undo` (with `camera_preset` and `look_at`) and `restored: true`; field of view, placement, preset, roll and look-at read the same before and after | Anything left changed: record both readings and the detail |
| S7 | C, M | `photo_frame {target: "face", yaw_offset: 180}` and capture (the back of V's head); then 150 and -150. `photo_state {menu: true}`: key 7's range | Each `converged` with V facing away by that angle (`residual.facing_deg` within 3). Or `converged: false` with the note "can't turn V": the rotation slider's range covers less than a turn (RB-74) | Converged but V faces elsewhere: record key 7's range and the steps (units per degree) |
| S8 | C, M | Light frame: `photo_frame {target: "face", yaw_offset: 90}`; `photo_light_set {light: 1, on: true, brightness: 45, place: {azimuth: 90, elevation: 15, distance: 1}}`, capture; then `place: {azimuth: -90, ...}`, capture | Azimuth 90 (the camera's side, since the camera sits at azimuth `yaw_offset`) lights the face the camera sees; -90 lights the far side (rim only) | Opposite: the frame is the camera's, not V's: record, it changes the docs |
| S9 | C, M | Photo mode's clock (RB-67): `photo_exit`, `game_status` (note `world_time_seconds`, t0), `photo_open`; `world_time_set {hours: 2, minutes: 0}`, capture; the answer's undo; `photo_exit`; `game_status` (t1); the same undo again; `game_status` (t2) | `route: "photo_time"`, the scene turns to night; the undo has `target: "photo"` and puts photo mode's time back. **The question:** is t1 about t0 plus the minutes that passed (photo mode gave the world's clock back) or not? M confirms the sky. The replayed undo answers `changed: false`, and t2 equals t1 | `unavailable`: record the answer (attribute 70 not as expected) |
| S10 | C, M | `photo_open`; `photo_state {options: true}`: find key 28's option 56, count options with `table_index_verified: false`; `photo_expression_set {label: "static sleeping"}`, wait 1 s, capture the face; `photo_expression_index {index: 60}`; `photo_expression_index {index: 60, target: "head"}` | Option 56 is `Static: Sleeping` with `table_index: 60`, `table_index_by: "label"`, `table_index_verified: true`; the label sets it (`menu_value: 56`, `table_index: 60`); the index answers `index_by: "label"` and the face sleeps; the head target is refused `no_effect`. An unverified index is refused `unverified_index` (RB-72) | `table_index_by: "position"` for option 56: record (the display-name match failed) |
| S11 | C, M | `photo_exit`. V walks out of the apartment into the street (away from any mirror). C: `cc_open {edit_mode: "new_game"}` (CCA's F12 exactly, RB-66); `player_appearance {}` | Opens (`route: "pause_menu"`, `edit_mode: "NewGame"`); `game_status` `character_menu`; the creator is fully drawn and rows change; `menu.updating_finalized_state: true` | Half open or stuck: M backs out or loads the save; record the plugin log's `cc.open` lines, and skip S12's second open |
| S12 | C, M | `cc_back`; M presses Esc, then Esc again. C: `cc_open {}` (the default HairDresser tag), `player_appearance {}`, `cc_back` | `cc_back` closes cleanly to gameplay; M's Esc opens the ordinary pause menu (the redirect is only for the bridge's request); the default open answers `edit_mode: "HairDresser"`. **The question:** does it open fully in the street too, or stick as 0.4.1's did? Whichever of S11 and S12 stuck decides `cc.open`'s default | Stuck: M loads the save; record which edit mode, then continue S13-S15 with `edit_mode: "new_game"` |
| S13 | C | `player_appearance {}` (in gameplay) | `last_creator_reading` with `age_seconds` and the options read on the screen in S12 | null: the reading wasn't kept (record) |
| S14 | C, M | `cc_open` (the edit mode that worked); `cc_apply {option: "hairstyle", label: "valby curtain bob"}`; capture; then `cc_apply {option: "hairstyle", label: "long pak 011"}` | The first answers `index: 217`, `label: "VALBY CURTAIN BOB"`; the second `index: 142` (the original); neither `stale_match` | Ambiguous or no match: record the candidates |
| S15 | C | On the lips (`cc_page {page: "lips"}`): `cc_apply {option: "makeupLips_08", index: 6}`, then `cc_apply {option: "makeupLips_color", index: 6, expect_option: "makeupLips_08"}`, then `cc_apply {option: "makeupLips_color", index: 6}`; then `cc_back` | The first is refused, naming the row in use (`makeupLips_NN`) and the slot `makeupLips_color`; the second is refused `stale_match` naming the row in use (RB-71) unless style 08 is chosen; the third changes the colour | Both refused: record the answers |

Evidence: every answer's JSON, the captures (S5 as a portrait/wide/eyes sheet, S7-S8 crops, S9 before and after), `world_time_seconds` t0, t1 and t2 with the wall-clock times, the plugin log (`cc.open: the pause menu's scenario switched` with the edit mode, `cc.open_redirect decision=`, `world.time_photo`, `cc.apply … via`), and the command log's `photo.frame` entries for S4, S6 and S7.

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

## Build record (bridge 0.8.3, branch build, not staged)

Built 22 October 2026 on `claude/bridge-080a` at `12f416af21d6`, clean tree, after the fixes from the Sol review of 0.8.3 (`local/reviews/report-bridge-083.md`, all nine findings), from a clean build (`cmake --build build --config Release --clean-first`; manifest `"commit": "12f416af21d6f7c5c963de35cb45544d2c26547b"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed to -writes-no-inventory; the second rewrote the default and diagnostic zips, whose hashes below are the files it left): version 0.8.3, session 10's findings and the review's fixes ([design §3.11](runtime-bridge-design.md#311-bridge-083-session-10s-findings)). On that commit: `xfb_selftest --unit` UNIT OK (578 checks) in three runs, the first straight after the clean build (where 0.8.2's first run had failed the queue's timing checks); self-test 645 of 645; `bun test tools` 384 pass and 4 skipped (the opt-in on-screen capture tests); typecheck; the Lua lint, the world-object lint and the theme tables against XF Studio's tokens; the redscript lint without Codeware, with Codeware `v1.20.4`'s scripts, and with Codeware, the Equipment-EX stub and TweakXL `v1.11.4`'s scripts, each against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…ee86`; the lint was also shown to fail on a deliberate unknown enum value). The Studio's showroom builder 2: `tsc` for the authoring sources and tools, `tests/showroom.test.ts` 9 pass. Every run under `tools/memory_guard.py --limit 4` (peak 1.1 GB, the Studio's `tsc`; the Studio's checks ran on `02fcc9f4`, and its sources haven't changed since). Offline, the staged showroom mods' archives resolve to the primary checkout's newest builds by SHA-256 (`60e5ed41…cc04` session 2, 12 presets; `998d4bf5…fe05d` the Glitter board, 6), so they need no restage.

The plugin registers nineteen natives, as 0.8.2, and two new methods (`showroom.staged`, `inventory.list`); `status_surface` answers `ink_panel`, `xf_box`, `cet_line` or `none`, and the CET layer reads the new names, so the DLL, the scripts and the CET layer must be staged together, as the zip does. `config.ini` gains `[ui] kill_key = End`. Stage the -writes zip only into the `XF Studio diagnostic` profile. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.8.3.zip` (bridge off) | `46b0b3f3c257c02aa2f510120b53d48cdfa28abef4e7efc3528d20f2847c886b` |
| `xf-runtime-bridge-0.8.3-diagnostic.zip` (read-only) | `225b7a17d152a8f228838060ea0581fc99525a6028491807b9c91c2725dd6a5c` |
| `xf-runtime-bridge-0.8.3-writes-no-inventory.zip` (writes, no inventory class) | `380430864e420eb059563421861c79e5769245c0cdf82a39c4447fa4685d973f` |
| `xf-runtime-bridge-0.8.3-writes.zip` (writes with the inventory class: session 11's zip) | `768e14d5aabdcfdb1834af7cfb29e4ff846edbc259cb7f3779af415061f96d40` |
| (`XFRuntimeBridge.dll` inside each) | `6864c3aa498663e7dd0ff9b4908ab11b3cc42a9c7c4a0f074d77c22e339ad6d1` |

**Watch in the session:** `plugin_version` 0.8.3 and `kill_key` in `bridge_info` (Z1); `status_surface` none on the loading screen (I1); the `panel geometry` line with `from=measured` or `from=model` (B1); `ui_state.pins[].xf_mark` (F1, G4); `showroom_found.builds` (G1); `took_s` (D1) and `took_over` (D3); `bridge.client_connected … pipe=control` for the second process's calls (E1) and the handover's steps whole before the resume's (E4); `bridge.kill_key key=End` (K2–K4) and none in K5 and K6.

## Build record (bridge 0.8.2, branch build, not staged)

Built 21 October 2026 on `claude/bridge-080a` at `27206d07dcea`, clean tree, from a clean build (`cmake --build build --config Release --clean-first`; manifest `"commit": "27206d07dcea9cb55b793f86e0ce44aff9d380a2"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed to -writes-no-inventory; the second rewrote the default and diagnostic zips, whose hashes below are the files it left): version 0.8.2, the crash at load fixed (a stale object file, [game crashes §2.5](../../knowledge/game-crashes.md#25-a-stale-object-file-in-the-plugin-bridge-081)), the re-check's six findings, session 9's bridge findings, one status surface at a time ([design §3.10](runtime-bridge-design.md#310-bridge-082-the-crash-at-load-the-re-checks-findings-session-9-and-one-status-surface)), and the fixes from the 0.8.2 review (`local/reviews/report-bridge-082.md`: no synthetic key after a load, the cleanup lane's hand-off under the queue's lock, the light's settle inside its rollback, the great-circle look, answer keys only while they work, cancellation before every capture, showroom archives asked 16 at a time, the session lock's process identity). On that commit: `xfb_selftest --unit` UNIT OK (566 checks; the first run, straight after the clean build, failed QueueTests' two 50 ms timing checks, and three runs after it passed), self-test 633 of 633, `bun test tools` 365 pass and 4 skipped (the opt-in on-screen capture tests), typecheck, the Lua lint, the world-object lint, and the redscript lint without Codeware, with Codeware `v1.20.4`'s scripts, and with Codeware, the Equipment-EX stub and TweakXL `v1.11.4`'s scripts, each against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…ee86`); links and private paths clean. Every run under `tools/memory_guard.py --limit 4` (peak 0.9 GB).

The crash's checks, offline: every object file of the plugin, the core and the self-test carries the header stamp (`dumpbin /directives`), and `StartBridge` calls `Bridge::Create`; a `Main.obj` kept from before a header change, linked again, fails with LNK2038 (`mismatch detected for 'xfb_header_stamp'`). A self-test built with MSVC's AddressSanitizer (RelWithDebInfo, `/fsanitize=address /bigobj`, a separate build folder) on that commit ran `--unit` (UNIT OK), `--pipe-stress 200` (both pipes started and stopped 200 times with four clients racing them, a kill during the start every third round and two threads stopping at once every third: no report) and `--layout-repro` (the current `Bridge`, sizeof 0x440, constructed in a 0x2F8-byte block as 0.8.1's `Main.obj` did: `heap-buffer-overflow … WRITE of size 16` in `PipeServer::PipeServer` from `Bridge::Bridge`, the control pipe's member).

The plugin registers nineteen natives, as 0.8.1; `XFBridge_InkDrawn`'s `shown` means the ink panel is on screen and its `id` the question it holds with its answer keys, so the DLL and the scripts must be staged together, as the zip does. The CET folder is `XF_Runtime_Bridge` (it was `xf_runtime_bridge`): replace the MO2 entry's files. Stage the -writes zip only into the `XF Studio diagnostic` profile. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.8.2.zip` (bridge off) | `5821d529ccb37a8280875b0ee4511fde39a166e163fc7cba5e04cc2d71f6079c` |
| `xf-runtime-bridge-0.8.2-diagnostic.zip` (read-only) | `942377b306565d72a01701e645f40457c2b4cd87c9c622363a9d46963544b2fa` |
| `xf-runtime-bridge-0.8.2-writes-no-inventory.zip` (writes, no inventory class) | `a3cbf302b069d6d2513a76b8e43b9b1da38259aab8d5e95a6e9262f09b35f2bf` |
| `xf-runtime-bridge-0.8.2-writes.zip` (writes with the inventory class: session 10's zip) | `69ec4319a95602048e90af12618cde90da17cf62ac6ee01a2f0d494719c03107` |
| (`XFRuntimeBridge.dll` inside each) | `2b44e5804a1f613bc84f530062989780d379241295606d545d97aa456ddf9a8e` |

## Build record (bridge 0.8.1, branch build, not staged)

Built 21 October 2026 on `claude/bridge-080a` at `c9ed3f2e6cc6`, clean tree (manifest `"commit": "c9ed3f2e6cc68fe52e9022d74ff91114d6bd0dea"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed; the second rewrote the default and diagnostic zips, whose hashes below are the files it left): version 0.8.1, the wave-4 review's safety fixes (RB-119..128, [design §3.9](runtime-bridge-design.md#39-bridge-081-the-wave-4-reviews-safety-fixes)) and the fixes from its code review (the control pipe, explicit write steps, the emergency barrier, cancellation through local work, superseded answers keeping their details, exact-copy inventory waits) on top of 0.8.0's part A. On that commit: `xfb_selftest --unit` UNIT OK (538 checks), self-test 605 of 605, `bun test tools` 342 pass and 4 skipped (the opt-in on-screen capture tests), typecheck, the Lua lint, the world-object lint, the theme tables against XF Studio's tokens (`theme.ts --check`), and the redscript lint without Codeware, with Codeware `v1.20.4`'s scripts, and with Codeware, the Equipment-EX stub and TweakXL `v1.11.4`'s scripts, each against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…ee86`); links and private paths clean. Every run under `tools/memory_guard.py --limit 4` (peak 0.9 GB). The plugin registers nineteen natives, as 0.8.0, and serves a second pipe (`control_pipe` in session.json); `XFInventory.Equip` and `XFInventory.Slot` take one more parameter each, so the DLL and the scripts must be staged together, as the zip does. Stage the -writes zip only into the `XF Studio diagnostic` profile. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.8.1-writes.zip` (with inventory) | `6a07307c0b727cb8df50e6ee3f19a0cc1cc35c2eb9c6aaba8ed4d50353465676` |
| `xf-runtime-bridge-0.8.1-writes-no-inventory.zip` | `8ae5168770911a9920f34ebe3168341b5d819735c861c0d324daf4d7f99673d2` |
| `xf-runtime-bridge-0.8.1-diagnostic.zip` | `bc1bfabb4f98720b34e9a8232299ee822b2412f98ebbc5489f158fe8043c10f6` |
| `xf-runtime-bridge-0.8.1.zip` (default) | `999bb10250c33a0979da343937ab819927b98deb13b487a4021989e289d2ae1b` |
| (`XFRuntimeBridge.dll` inside each) | `1a1b925ff1b36868b31b0dae5e38e9479e203bd8818de89a222d2af67818baf7` |

**Watch in the session:** as for 0.8.0 below, plus `plugin_version` 0.8.1 and `control_pipe` in session.json (A1); `game.save.relock`, or `game.save_relock_deferred` then `game.save_relocked` with `"retaken":true` (L1); a `player.stop` request logged while the look's request is still open (L2); `bridge.writes_paused paused=true` with no write line after it (L3). Group L of the [session-9 checks](#session-9-checks-bridge-08-part-a) covers 0.8.1's fixes.

## Build record (bridge 0.8.0, part A, branch build, not staged)

Built 30 September 2026 on `claude/bridge-080a` at `b63ca9f2cd5b`, clean tree (manifest `"commit": "b63ca9f2cd5b949dd30c3928673317eb706ed60b"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed; the second rewrote the default and diagnostic zips, whose hashes below are the files it left): version 0.8.0, part A (session 8's findings, the UI review's fixes and the MCP work's follow-ups; [design §3.8](runtime-bridge-design.md#38-bridge-08-part-a-session-8s-findings)) on top of 0.7.0 and its review fixes (`claude/bridge-070`). On that commit: `xfb_selftest --unit` UNIT OK, self-test 584 of 584, `bun test tools` 318 pass and 4 skipped (the opt-in on-screen capture tests), typecheck, the Lua lint, the world-object lint, the theme tables against XF Studio's tokens (`theme.ts --check`), and the redscript lint without Codeware, with Codeware `v1.20.4`'s scripts, and with Codeware, the Equipment-EX stub and TweakXL `v1.11.4`'s scripts, each against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…`); links and private paths clean. The plugin registers nineteen natives (`XFBridge_InkDrawn` is new); the -diagnostic `config.ini` sets `[overlay] diagnostics = true` (manifest `overlay_diagnostics`), the -writes one keeps it off. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.8.0-writes.zip` (with inventory) | `59bd6b0913fdd58ffb15405a7768c1031e02de75f7e243f74e680ee729668299` |
| `xf-runtime-bridge-0.8.0-writes-no-inventory.zip` | `9e5989f6a3ecc1d3c62e72b40e910374d9cd85325a114c1f6e8542210ae1847c` |
| `xf-runtime-bridge-0.8.0-diagnostic.zip` | `981ffbd5c3fa08a8ea2fc67c3c5ff9abe56f14d9ad7ac404649e78e523232ce7` |
| `xf-runtime-bridge-0.8.0.zip` (default) | `a745a3fde2619cee4795f8e0c66981e89cb5301c67911db2934b06f0de4ffc50` |
| (`XFRuntimeBridge.dll` inside each) | `ce334710f557081efab06bdcaeef946748400d69165ca3510b67a2d076c8fa5c` |

**Watch in the session:** `rtti.register_types … natives=19` and `overlay.hook_attached` at load; `overlay.init ok=true … proxy=` (`none`, or `streamline` with frame generation) or `overlay.refused why=` at the first frame; the ink layer's `panel geometry root=… screen=… visible=… at …` (B1); `world.pin N … drawn by …` per view (F1); `game.load: the main menu …` (I1, I2); `answer key` lines. The [session-9 checks](#session-9-checks-bridge-08-part-a) cover each.

## Build record (bridge 0.7.0, branch build, not staged)

Built 30 September 2026 on `claude/bridge-070` at `5d8ec59dfbe1`, clean tree (manifest `"commit": "5d8ec59dfbe19ff95cedc6dd509578d4235a448f"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed; the second rewrote the default and diagnostic zips, whose hashes below are the files it left): version 0.7.0, session 7's findings, the [ranked hooks](bridge-hook-inventory.md), in-game answers and the overlay host P0 on top of 0.6.1 and main's two session-7 hot fixes, with the 0.7.0 deep review's fixes (RB-96..118, [code-health ledger](../authoring/code-health.md)) and `main` merged at `038945d`. On that commit: `xfb_selftest --unit` UNIT OK, self-test 545 of 545, `bun test tools` 306 pass and 4 skipped (the opt-in on-screen capture tests), typecheck, the Lua lint, the world-object lint (`tools/lint-world-objects.ts`), the theme tables against XF Studio's tokens (`theme.ts --check`), and the redscript lint without Codeware, with Codeware `v1.20.4`'s scripts, and with Codeware, the Equipment-EX stub and TweakXL `v1.11.4`'s scripts, each against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…`). The plugin registers eighteen natives and ships the same script files as the first 0.7.0 build; Dear ImGui is compiled with the bridge's `IM_ASSERT` (`native/src/plugin/imgui/xfb_imconfig.h`; the build fails without it) and is not otherwise patched; the -diagnostic and -writes `config.ini` set `[overlay] enabled = true` and carry the CET window's `theme.lua`. The first 0.7.0 build (`37ed4342b996`) is superseded. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.7.0-writes.zip` (with inventory) | `f09f31ac98a38fcff2976e5b3168e6ccc23ade88fdb7294bf271d456f060c47e` |
| `xf-runtime-bridge-0.7.0-writes-no-inventory.zip` | `6f4750990c40d77d0b567f29fd8cff3b4f40b6f0300352957fef8e7a5f600a48` |
| `xf-runtime-bridge-0.7.0-diagnostic.zip` | `219dc4bed015dbe5a00ba5689ffa1b2f38354aacf4b8a72c165ea9e66c990e8a` |
| `xf-runtime-bridge-0.7.0.zip` (default) | `980a4223a93f0e2a4605f301bd8e34dcb34cfc62e83a257cf9c06bda35105315` |
| (`XFRuntimeBridge.dll` inside each) | `ce9fb5dd4c039ed10535444c52926b3c0d0f7d8626acf435997809ed685b1e90` |

**Watch in the session:** `rtti.register_types … natives=18` and `overlay.hook_attached` at load, `overlay.init ok=true` (or `overlay.refused why=`) at the first frame; `answer key` lines (A2); `overlay attached layer=hud size=` (B1); no crash in C1, and the last `script.call` line if there is one; `overlay.reset` (I4), `overlay.refused why=after a resize` (I5b), `overlay.stopped` if the swap chain is recreated (I5c), `overlay.shutdown ... released its objects` (I6) and `RestoreAfterKill ... cyberware_restored` (F2). The [session-8 checks](#session-8-checks-bridge-07) cover each.

## Build record (bridge 0.6.1, branch build, not staged)

Built 29 September 2026 on `claude/cleanup-bridge-r6` at `4a604aecf0a1`, clean tree (manifest `"commit": "4a604aecf0a160a0ce050247c08839c66fd67a87"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed): version 0.6.1, deep review 6's bridge fixes (RB-79..92) on top of 0.6.0. On that commit: `xfb_selftest --unit` UNIT OK, self-test 464 of 464, `bun test tools` 277 of 277 in each of three runs (the two on-screen capture tests are opt-in, `XFB_ONSCREEN_TESTS=1`, and bun lists them as 4 skipped entries), typecheck, the Lua lint, and the redscript lint without Codeware, with Codeware `v1.20.4`'s scripts, and with Codeware, the Equipment-EX stub and TweakXL `v1.11.4`'s scripts, each against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…`). The plugin registers fifteen natives (`XFBridge_Live` is new); no new script files. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.6.1-writes.zip` (with inventory) | `0a789d1ce22abb4d7b9d1855d5d153d4b0fecd0fb477e24ae8c4c863df325e72` |
| `xf-runtime-bridge-0.6.1-writes-no-inventory.zip` | `cf9714008a1939e83a4d5bb2810ad730019893756c47a4032e79873ab53eeb8c` |
| `xf-runtime-bridge-0.6.1-diagnostic.zip` | `7fc6ea072e39195997fcaf1ead5678701f0a6639c5b67015cfc3e92e7144e07e` |
| `xf-runtime-bridge-0.6.1.zip` (default) | `b5ed863d775525cbf0375cfab7e589fae9f648c8a1017a25f7ab5a47e89de67c` |
| (`XFRuntimeBridge.dll` inside each) | `c3bdb655f6add02f33968391b580405c00bbb48947e18e5713af995af5117ef6` |

**Watch in the session:** `rtti.register_types … natives=15` at load; `behave.stopped … reason=user_took_over` (G2); `bridge.handover` with `player_released` (G1); `game.save` refusals `bridge_effects_active` (G4); `bridge.kill_restored_preset` (G7) and "wardrobe restored after the resume" (G6). The [0.6.1 rows](#061-additions-to-the-session-7-checks) cover each.

## Build record (bridge 0.6.0, branch build, not staged)

Built 29 September 2026 on `claude/bridge-060` at `35c4f34d95cc`, clean tree (manifest `"commit": "35c4f34d95cc2c7afdcfa4bd6f757128757f9d1d"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed): version 0.6.0. On that commit: `xfb_selftest --unit` UNIT OK, self-test 455 of 455, `bun test tools` 261 of 262 (the screen-route capture test needs its synthetic window uncovered on the desktop, and test windows stay off-screen), typecheck, the Lua lint, and the redscript lint without Codeware, with Codeware `v1.20.4`'s scripts (`613a1cb8`), and with the Equipment-EX stub and TweakXL `v1.11.4`'s scripts, each against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…`). The plugin registers fourteen natives (`XFBridge_Note` is new) and ships four more script files (`XFRuntimeBridgeScene.reds`, `XFRuntimeBridgePlayer.reds`, `XFRuntimeBridgeEquipmentEx.reds`, `XFRuntimeBridgePresets.reds`); the -writes `config.ini` lists the new `player` class. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.6.0-writes.zip` (with inventory) | `5f701bea65f5f750e06a6c1c8a0208473bb2a033aab3fba9122eb9f626cd276d` |
| `xf-runtime-bridge-0.6.0-writes-no-inventory.zip` | `a2497fa31881ebf1b64b4253af74511cd2ed6e44ce43d59118af5ce353453bcb` |
| `xf-runtime-bridge-0.6.0-diagnostic.zip` | `e1638f32c36c4febad6cc9cc0ed33d7874a7964edc5809061057a7f8b9d18a58` |
| `xf-runtime-bridge-0.6.0.zip` (default) | `d9909f3290af1e06220c0ebba8ecb53d162fdfeddc44ee5a3db63c968dfab342` |
| (`XFRuntimeBridge.dll` inside each) | `25e5b4bb0d430b1da21e33d2d23fb0b30fbe7cc7b4dc5b90aa0951c36037b084` |

**Watch in the session:** `rtti.register_types … natives=14` at load; `wardrobe.equip` lines naming the manager (group B); `behave.stopped … reason=` for every behaviour (groups C to E); `bridge.handover on=true/false` (C5); and, for the first photo-mode read, `scene read parts=` (C2). The [session-7 checks](#session-7-checks-bridge-06) cover each.

## Build record (bridge 0.5.3, branch build, not staged)

Built 29 September 2026 on `claude/rnd-ink` at `ed485a06330a`, clean tree (manifest `"commit": "ed485a06330af009cf474189f6289002f6efef2e"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the first run's -writes zip renamed): version 0.5.3, the ink demos (temporary test features) on top of 0.5.2. On that commit: `xfb_selftest --unit` UNIT OK, self-test 417 of 417, `bun test tools` 233 of 234 (the screen-route capture test needs its synthetic window uncovered on the desktop, and test windows stay off-screen), typecheck, the Lua lint, and the redscript lint both without Codeware and with Codeware `v1.20.4`'s scripts (`613a1cb8`) against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…`). The plugin registers thirteen natives (`XFBridge_Hud` is new) and ships two more script files (`XFRuntimeBridgeInk.reds`, `XFRuntimeBridgePins.reds`); `config.ini` has a new `[ui]` section. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.5.3-writes.zip` (with inventory) | `fdcad6f67ce42e43a43bdb2d1b08da83d34b38961cd199da22df3b4f05ad5539` |
| `xf-runtime-bridge-0.5.3-writes-no-inventory.zip` | `c2e0bb8e6352cb7f52498e18a39a9c914c3c85a78c8870d0e27fab9966cec709` |
| `xf-runtime-bridge-0.5.3-diagnostic.zip` | `0a9f62f134655a8911f52c7340e722ce74b23a9d22200be3d189f0a4e3edb598` |
| `xf-runtime-bridge-0.5.3.zip` (default) | `999ea8c53c62a9013e5c0cfe2e5d4f6a0a1122e336fb2aed0860d82be10e716f` |
| (`XFRuntimeBridge.dll` inside each) | `bab47fdc157d64003a814c243b8401340743fcfbe53a4efbd8d871b23f781837` |

**Watch in the session:** `rtti.register_types … natives=13` at load; the `ink` layer's `overlay attached layer=… size=…` announcement and `ink overlay mounted` line after the player attaches (U1); `panel_attached` in `ui_hud`'s answers; `world.pin placed` lines and `bridge.kill_cleared_pins` in the kill switch's restore (U8). The [ink demo rows](#ink-demo-rows-bridge-053) cover each (folded into session 7's group F).

## Build record (bridge 0.5.2, branch build, not staged)

Built 29 September 2026 on `claude/bridge-052` at `7b9c8647894f`, clean tree (manifest `"commit": "7b9c8647894f1fe66896bd84c5716f10c8b71d34"`, `"source_tree_clean": true`), by `bun tools/package.ts`, then `bun tools/package.ts --allow-inventory` (the second run rewrote the default and diagnostic zips with new timestamps; the hashes below are the files left in `dist/`): version 0.5.2, session 5's fixes and requests on top of 0.5.1. On that commit: `xfb_selftest --unit` UNIT OK (332 checks), self-test 399 of 399, `bun test tools` 223 of 224 (the screen-route capture test needs its synthetic window uncovered on the desktop), typecheck, the Lua lint, and the redscript lint both without Codeware and with Codeware `v1.20.4`'s scripts (`613a1cb8`) against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…`); the showroom build's own tests (`projects/xf-studio/authoring/tests/showroom.test.ts`) 9 of 9. The plugin registers twelve natives (`XFBridge_ScriptLayer` is new) and ships a sixth script file (`XFRuntimeBridgeWardrobe.reds`). **The wardrobe needs the inventory class**, so session 6 stages the `--allow-inventory` -writes zip (`"inventory_writes": true`, `allow_write_classes = photo, world, character, inventory, save, showroom`); the -writes zip without it is kept beside it. XF Finish Showroom must be rebuilt from this commit for its seated column. A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.5.2-writes.zip` (with inventory; session 6) | `181d562a5e1e2b500a8f912d05e837981b442e00261cc4bbe4399cbf6567f215` |
| `xf-runtime-bridge-0.5.2-writes-no-inventory.zip` (the first run's -writes, renamed) | `233e17ae6d3b3f6261578520b70d4c5840d935a90a4e7a26fbb9907cb4b56775` |
| `xf-runtime-bridge-0.5.2-diagnostic.zip` | `09e3babd27f6e3649b2dead0b9a2f2dfcd20be9ba5396d339abd4c9211787961` |
| `xf-runtime-bridge-0.5.2.zip` (default) | `1c537c9caed84616152c667109ff9ce446e811b32a2c206dfce1a5a3162213f9` |
| (`XFRuntimeBridge.dll` inside each) | `d238f1f53f4662584c90e75c437e50534c0f6a6f6135da82e249bc7cead5544e` |

**New in this build, watch in the session:** `rtti.register_types … natives=12` at load; `script_layer.attached`, `.ready`, `.detached`, `.load_requested` and any `.call_refused` in the plugin log around every load (T1); `game_status` answering `answered_by: "plugin"` while loading; no `rate_limited` answers (T2); `photo_state`'s `face_table` (T3); `photo_camera_set`'s `exposure` (T4); `photo_camera_place`'s `held` (T5); `showroom_spawn`'s `height_m`, `height_from` and `eyes` (T6); `inventory_equip`'s `hidden_by_outfit` and the `wardrobe_*` commands (T7, T9); `bridge.kill_restored` with `wardrobe_restored` (T9). The [session-6 checks](#session-6-checks-bridge-052) cover each.

## Build record (bridge 0.5.1, branch build, not staged)

Built 29 September 2026 on `claude/cleanup-review5-bridge` at `d15b4fdbeeb1`, clean tree (manifest `"commit": "d15b4fdbeeb19de4c62937ff4c92fb6cc84f941b"`, `"source_tree_clean": true`), by `bun tools/package.ts`: version 0.5.1, deep review 5's bridge fixes (RB-66..75) on top of 0.5.0. On that commit: `xfb_selftest --unit` UNIT OK (306 checks), self-test 373 of 373, `bun test tools` 209 of 210 (the screen-route capture test needs its synthetic window uncovered on the desktop), typecheck, the Lua lint, and the redscript lint both without Codeware and with Codeware `v1.20.4`'s scripts (`613a1cb8`) against a copy of the installed 2.31 `final.redscripts` (SHA-256 `2119046f…ee86`). The packages carry what 0.5.0's did (the -writes zip lists photo, world, character, save and showroom; **inventory writes are off**, `"inventory_writes": false`). The plugin registers one more native, `XFBridge_CreatorRedirect` (eleven). A rebuild after merging gives new hashes.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.5.1-writes.zip` | `66567cd6c5e120082dc29f23a6d950b400c6ad69d9a52414addd4c90054aa2c2` |
| `xf-runtime-bridge-0.5.1-diagnostic.zip` | `fc997c91f96a7cff6b0dd1b22344a243c33364e76706ba67a650269c3143f632` |
| `xf-runtime-bridge-0.5.1.zip` (default) | `d67525d820cb21246bd6a783009cbfbda60cfe07c4ec2505e9a0d0a7ad981d6e` |
| (`XFRuntimeBridge.dll` inside each) | `7e7a9d5408b1ed3e88a479d075996d8d82ab6bd4a1c50925b451c99c240a9583` |

**New in this build, watch in the session:** the plugin log's `cc.open_redirect decision=` line at every pause menu the bridge's request touches, and `rtti.register_types … natives=11` at load; `cc_open` answers the `edit_mode` it opened with (S11-S12); `world_time_set` in photo mode answers an undo with `target: "photo"`, and `game_status` reports `world_time_seconds` (S9); `photo_frame` refusals carry `undo` and `restored` in their detail (S6) and `residual.facing_deg` (S4, S7); `photo_state`'s expressions carry `table_index_verified` (S10); `cc_apply` can answer `stale_match` (S15). The [session-5 checks](#session-5-checks-bridge-051) cover each fix.

## Build record (bridge 0.5.0 and XF Finish Showroom, branch build, not staged)

Built 28 September 2026 on `claude/finish-showroom` at `a56457384407`, clean tree (manifest `"commit": "a56457384407872677b999db25108f82860fa944"`, `"source_tree_clean": true`), by `bun tools/package.ts`: version 0.5.0, the showroom commands on top of 0.4.2. On that commit: `xfb_selftest --unit` UNIT OK, self-test 346 of 346, `bun test tools` 195 of 196 (the screen-route capture test needs its synthetic window uncovered on the desktop), typecheck, the Lua lint, and the redscript lint both without Codeware (the fallback class) and with Codeware `v1.20.4`'s scripts (the spawning class) against a copy of the 2.31 bundle.

| File | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.5.0-writes.zip` (`write_classes` photo, world, character, save, showroom) | `2e955bac4c712d4debc3556b06c298fc775948891fdfc1ce5a15bfe4395879bb` |
| `xf-runtime-bridge-0.5.0-diagnostic.zip` | `3c363033ff31aac6e62a83db868513b9e60871eaebc02f443b152babec310961` |
| `xf-runtime-bridge-0.5.0.zip` (default) | `d909b0ba463faaa6a8eee6e7223ca01e6f469d50f4bba5cc75eb2583d1e7f3f2` |
| (`XFRuntimeBridge.dll` inside each) | `a9f697d2a4af14aa776ab56be4ea1174daed784676b5349946eb05615832254e` |
| XF Finish Showroom, session 2's collection: `xfs_showroom_4426018f6966620881cdcb78569544ab.archive` (12 heads) | `a5166b659a7000c2bf295bf452848ef9f2ae0f4603e78b081f8b0e31d818412c` |
| XF Finish Showroom, the Glitter board: `xfs_showroom_d11f5a7fd3192b9e4f6dd14f343578b8.archive` (6 heads) | `fef65ae8f843f45e9c2eac63ce8d882172c94514d297471d2c5c87712db0fb49` |

The showroom archives were built at `d5c9e34` by `projects/xf-studio/authoring/tools/build_showroom_package.ts --diagnostics` from the reference installation's cached plate, each independently verified, with their `xfs/showroom-package-1` manifests beside them in the Studio's ignored `dist/` ([pipeline guide](../authoring/studio-to-mod-pipeline.md#xf-finish-showroom-a-test-mod-of-mannequin-heads)). XF Eye Artistry for the fidelity check is built at staging time from the same commit. **New in this build, watch in the session:** everything in the [finish showroom checks](#finish-showroom-checks-bridge-050); nothing else changed from 0.4.2.

## Build record (bridge 0.4.2, branch build, not staged)

Built 28 September 2026 on `claude/bridge-042` at `f03657dd55e0`, clean tree (`XFB_BUILD=f03657dd55e0a9872880f9348f9924a8694d20b6;dirty=0`), by `bun tools/package.ts`: version 0.4.2, session 4's fixes on top of 0.4.1. On that commit: `xfb_selftest --unit` OK (265 checks), self-test 332 of 332, `bun test tools` 181 of 182 (the one failure, the screen-route capture test, needs its synthetic window uncovered on the desktop and passes on its own: 26 of 26 in `capture.test.ts`), typecheck, redscript lint (against a copy of the installed 2.31 `final.redscripts`, SHA-256 `2119046f…ee86`, as for 0.4.1) and Lua lint clean. The packages carry what 0.4.1's did: the default zip keeps the bridge off with every switch off and no presets or panel; the -diagnostic zip adds the presets and the panel, read-only; the -writes zip allows writes with the classes photo, world, character and save, with the creator and the live-pose carrier. **Inventory writes are off** (`"inventory_writes": false`). A rebuild after merging gives new hashes.

| Zip | SHA-256 |
|---|---|
| `xf-runtime-bridge-0.4.2-writes.zip` | `4e93b23567c0de09d1e4f971e9c0fe610dc2fba5802f3894004c9fef3bc3da01` |
| `xf-runtime-bridge-0.4.2-diagnostic.zip` | `b9e216062fe3ceed14000b7145891c8b73daa42faa9fc2c5b9795c5b5a095c1a` |
| `xf-runtime-bridge-0.4.2.zip` (default) | `a60472e1cd1fc7167dddc4f4ddf805666b46ab460f891f0616814b6bf45db768` |
| (`XFRuntimeBridge.dll` inside each) | `ed4f19054e91eab4abe69b0586e1371b4c95b251662544e68f8b1a033f94a40f` |

**New in this build, watch in the session:** `photo_open` refuses `not_foreground` unless the game window is already in front (S1-S3); `photo_frame` answers `lens`, `bounds` and `distance_m`, starts face and eyes frames from the portrait pose and refuses `framing_bound` (S4-S7); `cc_open` answers `route: "pause_menu"` and the plugin log says "the pause menu's scenario switched" (S11-S12); `world_time_set` in photo mode answers `route: "photo_time"` (S9). The [session-5 checks](#session-5-checks-bridge-051) cover each fix.

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
