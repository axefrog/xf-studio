# Session 10: bridge 0.8.2, launched without a crash

**Status:** run on 22 October 2026, about 07:45–08:20, on bridge 0.8.2 (`-writes` with the inventory class, branch build, commit `27206d0`). Its first job was to show that 0.8.2 fixed 0.8.1's crash at launch, and it did: two launches, no crash. Most rows passed. The findings went into 0.8.3. The coordinator drove the session through the command-line client, with questions and answers in the game.

**Evidence.** Private and ignored, never committed:
- every JSON answer and the command log;
- the plugin log;
- the maintainer's screenshots;
- the running findings list for 0.8.3.

All of it is in `local/sessions/2026-10-22-session10/`.

**Grades.** **Pass** and **Fail** answer the row's criterion in the [session-10 card](../../research/runtime/runtime-bridge-test-card.md#session-10-checks-bridge-082). **Partial** means part held. **Not run** means the row was skipped, with the reason. Rows the running findings list doesn't mention are left out. The card's L rows are named by their card number; the findings list numbered them differently.

**Names.** As in [session 9](../040-session-9/README.md), the session used the *status label* (now the **CET line**) and the *overlay panel* (now the **XF box**).

## 1. Setup

| Item | Value |
|---|---|
| Game | 2.31, borderless window 3840 × 1600, SDR; DLSS with frame generation (`proxy=streamline`) |
| Bridge | 0.8.2 `-writes` with inventory, `natives=19`; the overlay host on, theme dark |
| Frameworks (installed) | ArchiveXL 1.27.5, TweakXL 1.11.5 and Codeware 1.20.6 (updated in place the day before); RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1 |
| MO2 profile | `XF Studio diagnostic`, with XF Finish Showroom (two builds) and Equipment-EX staged |

## 2. Results

| Row | Grade | What happened |
|---|---|---|
| Z1, Z2 | Pass | Two launches to the main menu, no crash (0.8.1: three of three crashed) |
| I1 | Pass | `game_saves {limit: 5}`: five names, each once, locations and quests in words |
| I2 | Pass | `game_load` reached the press-any-key screen after 11 s and said so (`waiting_for_input` true); the bridge pressed nothing |
| I2b | Pass | `game_continue` refused `no_safe_route` in plain words |
| I3 | Pass | `game_wait` took one phase as text |
| I4 | Research | The screen read "PRESS [Space] TO CONTINUE." at the top right, the scene pillarboxed; the bridge read `phase` loading, `player_present` false, the script layer attached, `waiting_for_input` true. After Space the player attached, the script layer became ready and the ink panel mounted: the press-any-key screen is the stretch before the player attaches. **The XF box drew over this screen**, where it shouldn't show |
| A1 | Pass | `status_surface` ink_panel, connected, no pins |
| A2 | Pass (retry) | Never "not connected" in 30 s of silence. The first try failed on the protocol: the instruction was only in chat, which the maintainer can't see with the game in front |
| A3 | Pass | |
| A4 | Pass | `game_status` answered in 208 ms while another process's `session_wait` was pending |
| S1 | Pass | The ink panel only |
| S2 | Pass | The overlay panel only in photo mode; F6 answered |
| S3 | Pass | With CET's overlay open, only the XF Runtime Bridge window |
| S4 | Pass | With the ink panel off, the overlay panel only, with "Answer in the XF Runtime Bridge window (CET overlay)." and no keys; no status label |
| S5 | Pass | Gameplay and photo-mode captures showed no XF surface |
| B1 | Fail | `top_left` still vertically centred at the left, as in session 9: the geometry line still read `visible=3840x1600 at 0,280` |
| B2 | Partial | `top_right` was whole and right-aligned (session 9: a sliver), so horizontal anchoring was fixed, but it sat about 22–35 % down instead of 60 units from the top, over the minimap and quest tracker, and the translucent plate was hard to read there. `bottom_left` was below the screen. The vertical offset was applied in the wrong direction; the other anchors were skipped |
| B3 | Pass | Missing characters showed as small bullets, with no gaps; Polish and accents intact. Æ drew as Æ, so the font has it and the missing-glyph list is slightly over-cautious |
| B4 | Pass | The first question was withdrawn (`question_gone`); only the second showed; the "Answered:" line was clean |
| B5 | Pass | `clear` removed the question |
| B6 | Pass | A 38-character answer was refused in plain words |
| C1 | Pass | Ctrl+Enter sent the comment and emptied the box; plain Enter starts a new line |
| C2 | Pass | The Bindings heading read "XF Runtime Bridge"; the kill hotkey bound and saved |
| C3 | Pass | The binding survived a relaunch in the same profile |
| C4 | Pass | The hotkey stopped the bridge; Reconnect started a new session |
| D1 | Pass | `behave_look` took 3.66 s for 90° (session 9: 1.2 s); a steep case (pitch 70° to level, yaw +180°) took 3.63 s without a false takeover |
| D2 | Pass (retry) | `user_took_over` (`CameraMouseX`) at 0.50 s. The first try ran to `reached`: the instruction was buried in the previous question |
| G1 | Fail | `showroom_spawn` without a manifest answered `showroom_manifest_missing`, although both XF Finish Showroom mods were staged: discovery looked only for build manifests on this machine, and the tools' checkout had none |
| G2, G3 | Not run | They need G1's head; the head pin was skipped too |
| F1 | Partial | The pin showed on the minimap and the map, with its label and description in the tooltip; in the world only the game's marker, still with no XF mark or label above it |
| L1 | Partial | The kill answered in 206 ms during a forced save, but the save was refused `bridge_effects_active` (added cyberware counts as a live effect, even with `override_lock`), so the save's prepare path wasn't reached. After Reconnect the kill had restored the cyberware, and the save lock and saving lock were on. Safe, but the row needs a change the save lock covers that isn't a blocking effect |
| L2 | Partial | `player_look {mode: "smooth", duration_s: 5}` finished in about 1.5 s, so `player_stop` during it couldn't be tested. `behave_stop {all: true}` answered in 205 ms during a 5 s `behave_look` |
| L2 (second process) | Fail | With a command-line `game_wait` polling from one process, `session_handover` from a second process never reached the plugin and timed out after 20 s, and `session_resume` was then refused `bridge_busy`. Nothing changed in the game |
| L6 | Not run | No jacket V owned was known, and nothing could list them. The two-copy case is covered offline |
| L7 | Not run | Offsets stop at 50 m, and a 60 m absolute teleport from that corridor could have put V inside geometry |
| L8 | Pass | Screen capture and burst refused `capture_not_foreground` with another window in front; nothing written |

## 3. Friction log

- **Every instruction belongs in the game.** The maintainer can't see the chat while the game is in front. Instructions go in `ui_message`, never only in chat (A2's first try).
- **One instruction per question.** D2's first try failed because its instruction was buried in the previous question.
- **The names still blurred.** "Status label" and "overlay panel" were indistinguishable by name: both are ImGui-looking boxes at the top. Name them by appearance, or make them look distinct; one surface at a time makes this matter less.
- **Ambiguous answers.** "Bullets no gaps / Gaps" was hard to answer: word each question as one yes-or-no claim.
- **Card fixes:**
  - L1 needs a change the save lock covers that isn't a blocking effect (the card named a jacket, with no way to list V's items);
  - L7 should use an absolute target known to be open, and say where to stand;
  - the showroom rows need the staged showroom found without naming its build.

## 4. What changed for 0.8.3

Every finding went into 0.8.3 ([design §3.11](../../research/runtime/runtime-bridge-design.md#311-bridge-083-session-10s-findings)):
- the ink panel's mapping, from the game's own layout;
- a nearly opaque plate and floors clear of the game's HUD blocks;
- the world pin's XF mark in a fixed-size canvas;
- the staged showroom found through the game's own `archive/pc/mod`;
- a smooth `player_look` that takes its duration;
- emergency calls from any process, decided by the command's canonical name;
- no XF surface on a loading screen;
- the bridge's own kill key, End by default;
- `inventory_list`;
- the surfaces renamed by appearance.

Its [session-11 checks](../../research/runtime/runtime-bridge-test-card.md#session-11-checks-bridge-083) prove them ([session 11](../042-session-11/README.md)).
