# Session 7: bridge 0.6.1 checks, driven from inside the game

**Status:** run on 30 September 2026 through the runtime bridge (0.6.1 `-writes`, plus two script-only hot fixes made during the session). The coordinator drove the bridge through its command-line client (the MCP server was registered during the session and loads from the next one). The maintainer played; after the first half the session ran from inside the game, with instructions in the bridge's CET label and **Mark this moment** as the maintainer's "ready" signal.

**Evidence.** Private and ignored, never committed: every JSON answer, the plugin and CET logs, both crash reports and the captures (`local/sessions/2026-09-30-session7/`).

**Grades.** **Pass** and **Fail** answer the row's own criterion in the [session-7 card](../../research/runtime/runtime-bridge-test-card.md#session-7-checks-bridge-06). **Partial** means part of the criterion held; **Inconclusive** means the row ran but can't answer; **Not run** is said as such.

## 1. Setup

| Item | Value |
|---|---|
| Game | 2.31 (product 2.3.1, file 3.0.80.51928), borderless window 3840 × 1600, captures by `printwindow` |
| Bridge | 0.6.1 `-writes`, DLL `c3bdb655…`; `natives=15`, `script_calls=on` |
| Frameworks | ArchiveXL 1.27.3, TweakXL 1.11.4, Codeware 1.20.5, RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1 (all the latest releases on the day) |
| MO2 profile | The dedicated test profile. **Immersive Cyberware disabled mid-session**: it hides HUD elements (minimap, markers) until V owns matching cyberware, which confounded the pin checks |
| Save | Early game (The Pickup active); V's apartment, then the megabuilding's walkway |

## 2. Hot fixes during the session (script-only, restaged over 0.6.1, on `main`)

1. **Crash on `player_state` while V looked at her apartment door.** Access violation reading `0x14` on the game thread inside the `XFPlayer.State` script call. Reading the looked-at object's display name or interaction state is the suspect. Fix: `look_at` reads only its ID, class and distance. The same look then answered `Door` at 3.76 m.
2. **Every player move was refused as `in_scene`.** `IsEntityInScene(V)` answers true in ordinary play during The Pickup, on the walkway (`SceneTier1`) and in the apartment (`SceneTier2`). Fix: V counts as busy in a scene only by the state machine's scene tiers (3–5) or a dialogue. After the fix every player row ran.

A second crash (engine watchdog: the main thread hung for 120 s) came during a system-wide memory squeeze (commit charge down to 0.6 GB, from an unrelated background application). No bridge script call was pending and the bridge's requests at the time never reached the game thread, so it is attributed to the squeeze, with the Immersive Cyberware removal as an unlikely alternative.

## 3. Results

| Row | Grade | What happened |
|---|---|---|
| A1 | Pass | 0.6.1 with `natives=15`; `SceneTier2` in the apartment; the camera's field of view is **vertical**; the input probe lists the game's twelve fake-input functions |
| B1 | Pass | Equipment-EX detected (`manager: script`, parts with IDs, `api: checked`); the helmet equipped and reported `hidden_by_outfit` with an explanation and an undo. The outfit's version read `unknown` |
| B2 | Fail | Equipment-EX refused the basic helmet into its outfit. The photo-mode face framing also failed `framing_bound` (drone camera about 8 m away; the portrait lens stops at 4°) |
| B3 | Pass | Suspend took the outfit off and showed the helmet; resume put the outfit back exactly; the kill restored the outfit (`wardrobe_resumed: true`), confirmed in the inventory screen |
| C1 | Partial | The head spawned centred at a sensible height (`height_from: camera_ray`), but `eyes_on_screen` said x −1.2, off-screen, while the capture shows it centred (the projection ignores photo mode's drone camera) |
| C2 | Pass | Subjects, lights with shares and sight lines, and the head's frame region (mean luminance 0.48, nothing clipped) |
| C3 | Pass | The strict capture cleared the overlay and captured; an impossible margin was refused before any picture |
| C4 | Pass | A three-angle sweep and a labelled sheet; the sheet needs the sweep's paths re-shaped by hand (friction) |
| C5 | Pass | Turntable, handover, the refused camera write, the maintainer's marker and resume, all in the log |
| D1 | Pass | Selecting camera preset 9 moved the camera 0.738 m: photo mode reads the preset's record on selection (the placement route works); the undo restored it |
| D2 | Inconclusive | The behaviour's 60 s ran out before the maintainer began moving the camera |
| E1 | Pass | Teleport and turn; the undo returned V exactly (`off_m: 0`) |
| E2 | Partial | Jump and smooth look within 2°; a look turn was **not** broken by the maintainer's mouse (ended `reached`) |
| E3 | Pass | The glide arrived (3 m, unanimated); the kill stopped the second glide and freed V; the maintainer could walk |
| E4 | Pass (bridge side) | Crouch, stand, draw, holster, inventory open and close all answered with undos; nothing left holding V |
| F1 | Partial | The message lines read well in the CET label (they cap at 200 characters). The ink HUD panel draws **off the right edge** of the 3840 × 1600 screen, and disappears when moved to bottom left. The pedestal's nameplate shows |
| F3 | Fail | The head's pin drew as the game's default pulsing circle well above the head; the position pin didn't show; neither showed on the minimap. The head spawned half inside a wall |
| G1 | Pass | The handover lifted the forced crouch; the maintainer's keys worked at once |
| G2 | Pass | W took over the glide (`user_took_over`), and the mouse alone did too (`CameraMouseX`) |
| G3 | Pass | A 60 s glide refused (the limit is 30 s) |
| G4 | Pass | A save refused while V was held (`bridge_effects_active`); allowed after `player_stop` |
| G5 | Partial | Moves were refused mid-jump (`player_busy`), but `player_state` showed `busy: ""` and no fall or landing at the same moments. Sitting not run (benches aren't sittable in vanilla) |
| G6 | Partial | The outfit reports parts with IDs and `api: checked`; the undo-while-suspended step couldn't run (B2's refusal) |
| G7 | Partial | Clearing the head removed its pin (`removed_pins: 1`, the circle vanished); the preset restore after a kill not run |
| G8 | Pass | The sight-line expectation refused in normal play; the warn form captured without claiming `ok` |

## 4. Friction log

- The maintainer can't see the chat while the game is in front. The CET label plus **Mark this moment** as a "ready" signal worked; it needs proper Ready/Yes/No buttons, a comment text box and a blocking wait command (queued for 0.7).
- Behaviours that need the maintainer should start on their Ready, not before (D2).
- Messages longer than 200 characters are cut off.
- The ink panel is off-screen on ultrawide displays.
- The sweep and sheet commands don't fit together; turning the rig off demands a manifest it doesn't use.
- Spawning doesn't avoid walls.
- A visible console window and app windows from a parallel agent stole focus during the session (fixed: trials now launch hidden and never activate).
- A background application's memory spike exhausted the commit charge mid-session; parallel agents' heavy work was paused for the rest of the session.
- The bridge's MCP server had never been registered, so sessions used the command-line client; registered now.

All findings are queued for bridge 0.7 (`claude/bridge-070`), with a session-8 card to re-run the failed and not-run rows.
