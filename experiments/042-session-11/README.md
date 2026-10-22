# Session 11: bridge 0.8.3 proves session 10's fixes

**Status:** run on 22 October 2026, about 12:15–12:45, on bridge 0.8.3 (`-writes` with the inventory class, branch build, commit `12f416a`, kill key End). Every row that ran passed, apart from one the card itself couldn't reach (L1). The ink panel sat where it should at all nine anchors, the world pin showed its XF mark, the staged showroom was found without naming its build, the smooth look took its time, emergency calls worked from a second process, and the bridge's own kill key worked in play, photo mode and the pause menu. The new findings are small and go into 0.8.4. The coordinator drove the session through the command-line client, with every instruction in the game.

**Evidence.** Private and ignored, never committed:
- every JSON answer and the command log;
- the plugin log;
- the maintainer's screenshots;
- the running findings list for 0.8.4.

All of it is in `local/sessions/2026-10-22-session11/`.

**Grades.** **Pass** and **Fail** answer the row's criterion in the [session-11 card](../../research/runtime/runtime-bridge-test-card.md#session-11-checks-bridge-083). **Not reached** means the row ran but couldn't reach what it tests. The surface names are 0.8.3's: the **ink panel**, the **XF box**, the **CET line** and the **XF Runtime Bridge window**.

## 1. Setup

| Item | Value |
|---|---|
| Game | 2.31, borderless window 3840 × 1600, SDR; DLSS with frame generation (`proxy=streamline`) |
| Bridge | 0.8.3 `-writes` with inventory, `natives=19`; the overlay host on, theme dark; `kill_key` End |
| Frameworks (installed) | ArchiveXL 1.27.5, TweakXL 1.11.5, Codeware 1.20.6, RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1 |
| MO2 profile | `XF Studio diagnostic`, with the two XF Finish Showroom mods (not restaged) and Equipment-EX |

## 2. Results

| Row | Grade | What happened |
|---|---|---|
| Z1 | Pass | 0.8.3 at `12f416a`, `kill_key` End, `status_surface` xf_box at the main menu |
| I1 | Pass | No XF surface on the press-any-key screen (the maintainer's screenshot; session 10: the XF box drew over it), `status_surface` none while it waited |
| I2 | Pass | `game_continue` refused `no_safe_route` |
| B1 | Pass | Top left about a quarter of the way down, readable. The geometry line read `visible=3840x1600 at 0,0 from=measured`, and the model agreed |
| B2 | Pass | `top_right` at the top edge, left of the minimap, clear of the HUD |
| B3 | Pass | All other anchors whole and clear of the game's HUD: `bottom_left` above the status icons, `bottom_right` well in from the corner, `center` dead centre, `center_left`, `center_right` just clear of the quest tracker's last line (tight), `bottom_center`. `top_center` sat slightly right because the card sent x 60, which shifts centre anchors too: the card should send x 0 there |
| B4 | Pass | The plate is nearly opaque and the text readable in every screenshot |
| F1 | Pass | The XF diamond with "V WAS HERE" above the game's marker; `xf_mark.on_screen` true, `drawn_by` world, minimap and xf_overlay |
| F2 | Pass | The pin and its mark cleared |
| G1 | Pass | `showroom_spawn` with no manifest found both staged archives (`by: matched_build`); `eyes_on_screen` (0, 0), in frame (session 10: `showroom_manifest_missing`) |
| G2 | Pass | Three sweep frames with no XF surface. The game's photo-mode menu stays in sweep captures; hiding it as `photo_hud_hide` does would make sweeps cleaner |
| G3 | Pass | In the open, clear and not moved. By the wall the check answered clear with the head placed at 2 m; a retry with the maintainer watching showed the head standing in front of the wall, which was a little farther than 2 m away, so the check was right |
| G4 | Pass, with a finding | The XF diamond with "Gloss A" above the head. Both the game's marker and the XF diamond float well above the crown, near the ceiling, rather than just above it (the design says 0.25 m above the eyes) |
| D1 | Pass | `player_look` smooth took 5.05 s, within 2°, not stopped (session 10: 1.5 s) |
| E1, E2 | Pass | From a second process during another's `game_wait`: handover in 255 ms, resume 214 ms, `player_stop` 211 ms, `behave_stop` 206 ms (session 10: 20 s, then refused). The plugin log shows `pipe=control` |
| E4 | Pass | A handover and a resume sent at once from two processes ended with `handed_over` false: the handover lock kept each whole |
| K1 | Pass | The XF Runtime Bridge window names End beside Stop |
| K2 | Pass | End in normal play: `bridge.kill_key key=End`, then the kill; Reconnect rearmed |
| K3 | Pass | End killed the bridge in photo mode |
| K4 | Pass | End killed the bridge in the pause menu |
| K5 | Pass | End with CET's overlay open was ignored |
| K6 | Pass (retry) | End held across a focus change into the game didn't kill. The first try was invalid: End wasn't held |
| L1 | Not reached | The forced save (`override_lock`) finished in 334 ms, before the kill arrived 0.3 s later, so the prepare-timeout path wasn't exercised. The lock was retaken after the save. A real manual save "L1" was written with the test's clock change (30 minutes of game time); the maintainer was told and may delete it |
| L4 | Pass | `inventory_list` named two vests with ids; the equip's and the unequip's undos both carried the worn vest's id and answered `exact` true; the state was restored |
| L5 | Pass | A 60 m teleport to a point `world_probe` found walkable and streamed, with `far` true; the undo carried `far: true` and returned V within 3 cm horizontally, standing normally |

## 3. Findings for 0.8.4

- **`game_wait` holds the main pipe.** An ordinary `game_status` from a second process was refused `bridge_busy` for 8 s while another process's `game_wait` polled. `game_wait` should let the pipe go between polls as `session_wait` does, or the main pipe should take several clients.
- **The head pin sits too high.** The game's marker floats about a head's height above the crown and the XF diamond higher still; both belong just above the crown.
- **L1 can't be reached by racing.** A save takes about 300 ms, too fast to kill during its prepare step. The row needs a way to hold the save in prepare, such as a test gate in the -writes build.
- **`player_state`'s height.** After L5's undo, `player_state` read z 19.59 against 17.99 before, 1.6 m higher, while V stood normally. Check what `z` measures (feet or eyes) and whether an exact-ground teleport restores the same reference.
- **The comment box doesn't wrap.** Long text in the XF Runtime Bridge window's comment box scrolls sideways out of view. It needs a word-wrapping multi-line input.
- **Card fix:** `top_center` and `bottom_center` should be sent with x 0.

## 4. Friction log

- **Sweeps keep photo mode's menu.** Hiding it during a sweep, as `photo_hud_hide` does, would give cleaner frames.
- **A row that wrote a real save.** L1's race left a manual save with the test's clock change. A test gate that holds the save would avoid writing one at all.
- **Invalid first tries.** K6 and G3 each needed a second try, because the step wasn't done as asked (End not held) or not watched (the head cleared before the maintainer looked). Questions should say what to keep doing until the next message.

The findings are queued for bridge 0.8.4, and then the XF Core plugin host ([XF Core architecture](../../research/runtime/xf-core-architecture.md)).
