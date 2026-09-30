# Session 8: bridge 0.7.0, driven from inside the game

**Status:** run on 30 September 2026 on bridge 0.7.0 (`-writes`, branch build, DLL `ce9fb5dd…`, commit `5d8ec59`). The coordinator drove it through 0.7's command-line client. The main checkout's MCP catalogue still carries 0.6, so 0.7's commands weren't available through MCP yet. For the first time the whole session ran from inside the game: questions in the XF panels, answers through the CET window's buttons, and free-text comments from the maintainer.

**Evidence.** Private and ignored, never committed:
- every JSON answer;
- the plugin logs of the three launches;
- the captures;
- the maintainer's screenshots;
- the running findings list for 0.8.

All of it is in `local/sessions/2026-09-30-session8/`.

**Grades.** **Pass** and **Fail** answer the row's criterion in the [session-8 card](../../research/runtime/runtime-bridge-test-card.md) on the 0.7 branch. **Partial** means part held. **N/A** means the setup can't run the row.

## 1. Setup

| Item | Value |
|---|---|
| Game | 2.31, borderless window 3840 × 1600, SDR (the display offers no HDR); DLSS Super Resolution, frame generation off, then on from the second launch |
| Bridge | 0.7.0 `-writes` with inventory; `natives=18`; the overlay host on, theme dark |
| Frameworks | ArchiveXL 1.27.3, TweakXL 1.11.4, Codeware 1.20.5, RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1, Equipment-EX 1.2.9 |
| MO2 profile | The dedicated test profile, with Immersive Cyberware disabled (it hides HUD elements) |

## 2. Results

| Row | Grade | What happened |
|---|---|---|
| A1 | Pass | 0.7.0, `natives=18`, overlay hooks attached, theme dark, `tier: staged` in the apartment |
| A2 | Pass | A question answered with the CET window's button (`via: cet_button`) |
| A3 | Pass | The maintainer's free-text comments arrived from the game (several, throughout the session) |
| A5 | Pass | An answer given before the wait began came back at once (`waited_s: 0`), which fixes RB-96 |
| B1 | Partial | The ink panel is fully visible top-left (moved there with `ui_hud`), but still clipped at top-right on 21:9. The HUD layer reports a 3840 × 2160 design canvas against the 3840 × 1600 screen. The "center" anchor doesn't move it, and the panel's background plate isn't drawn |
| C1 | Pass | A door, a vending machine, an NPC and a car all read safely (class, record, prompt title); session 7's crash is fixed |
| D1 | Pass | Teleport and look inside the apartment (`tier: staged`, not busy) and their undos |
| D3 | Pass (partial detail) | `busy` reads `player_busy` / `Jump`; 13 of 18 mid-jump moves were refused. `on_ground` stays true in the air, and the refusal doesn't name the state |
| D4 | Fail | A look turn wasn't broken by the maintainer's mouse (ended `reached`) |
| E1–E3b | Pass | Arm cyberware read, Mantis Blades equipped (`holstered_mantis`) and drawn, both changes refused while drawn (`arms_drawn`) |
| E2 capture | Note | Photo mode's default pose shows the blades deployed rather than holstered |
| E4 | Pass | Gorilla Arms (`holstered_strong`), captured with and without a photo-mode light for the render study's C6. Undo needed a holster first: the drawn flag was stale after photo mode |
| F1 | Pass | Clock, weather (readable), a story fact, nine navmesh probes |
| F2 | Pass | Rain on command; the save refused while the weather was held; after the kill, the log shows the weather and cyberware restored and the added blades gone |
| G1 | Pass | Photo mode's surrounding NPCs off and back |
| G2 | Pass | Face framing from a drone camera 10.5 m away (the camera reseated) |
| G3 | Fail | `eyes_on_screen` still reads (−5.2, −48.5) for a centred head under the drone camera |
| G4 | Pass | A sheet built straight from the sweep's answer; the rig turned off without a manifest. The sweep's captures show the overlay host (it isn't hidden on that path) |
| G5 | Fail | World pins: no XF diamond in the world, nothing on the minimap or the map; clearing the head removed its pin |
| G6 | Pass | A head spawned in front of a wall stood clear of it (`moved_for_space` reported null) |
| H1 | Fail | `game_saves` returns no saves outside the Load menu |
| H2 | Pass | The helmet shows on V under an active Equipment-EX outfit (session 7's B2 fixed); `wardrobe_state` still says the Head slot is hidden |
| I1 | Pass | Drawing, 3840 × 1600 SDR, dark theme, the diagnostic panel smooth |
| I2 | Pass | Hidden for `capture_screenshot` |
| I3 | Pass | Steps aside while CET's overlay is open (`cet_open` true) and returns |
| I4 | Pass | Windowed/borderless and resolution changes: four resets, drawing throughout |
| I5, I5b | N/A | No HDR on this display |
| I5c | Pass (refusal) | With DLSS frame generation active from launch, the host refused cleanly ("the swap chain doesn't belong to the engine's device": Streamline's proxy) and drew nothing |
| I6 | Pass | Three quits (Alt+F4; the menu; Alt+F4 with frame generation on): each log ends with a clean overlay shutdown or plugin unload, and no crash report. Quitting with CET's overlay open isn't possible (it blocks input and Alt+F4) |
| I7 | Pass | Accented Latin and Polish intact in the overlay, other scripts as "?", and no rise in its worst frame time (no glyph upload). The CET label turns Polish into "?" (CET's font); the ink panel leaves blank gaps |

## 3. Friction log

- **Chat queued behind waits.** The maintainer's chat messages queued behind the coordinator's long waits, so he couldn't flag an unclear request. Waits are now short (about 80 s per call) and end on any in-game comment.
- **Asks showed irrelevant buttons.** Questions showed Ready/Yes/No regardless; callers now pass only the relevant choices.
- **A question assumed a restart.** One question assumed frame generation was already active when it needed a restart.
- **A scripting bug made questions flash past.** The coordinator's script read the wrong question ID, so a run of questions flashed by, and the stale ones confused the maintainer.
- **Requests from the maintainer:**
  - Ctrl+Enter sends a comment;
  - loading a save from the main menu, so the maintainer only has to launch the game.
- **Ink panel:** it looks right in the game's style, but needs its background and ultrawide placement.

Every finding is queued for bridge 0.8.
