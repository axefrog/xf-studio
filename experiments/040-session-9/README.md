# Session 9: bridge 0.8.0, after 0.8.1 crashed at launch

**Status:** run on 21 October 2026, about 18:20–19:10, on bridge 0.8.0 (`-writes` with the inventory class, branch build, commit `b63ca9f`). The card was written for 0.8.1, but 0.8.1 crashed the game at every launch, so the session ran its rows on 0.8.0 and skipped the ones only 0.8.1 could answer (group L). The coordinator drove it through the bridge's command-line client; questions and answers went through the game (the ink panel's keys and the XF Runtime Bridge window's buttons).

**Evidence.** Private and ignored, never committed:
- every JSON answer and the command log;
- the plugin logs, those of the three crashed 0.8.1 launches included;
- the maintainer's screenshots;
- the running findings list for 0.8.2.

All of it is in `local/sessions/2026-09-30-session9/` (the folder's name carries the wrong date; its files are from 21 October).

**Grades.** **Pass** and **Fail** answer the row's criterion in the [session-9 card](../../research/runtime/runtime-bridge-test-card.md#session-9-checks-bridge-08-part-a). **Partial** means part held. **N/A** means the build or setup couldn't run the row. Rows the running findings list doesn't mention are left out: the list recorded a row only when something needed saying.

**Names.** This session used the surface names of its time: the *status label* (now the **CET line**), the *overlay panel* (now the **XF box**), the **ink panel** and the **XF Runtime Bridge window**. 0.8.3 renamed the first two by appearance.

## 1. Setup

| Item | Value |
|---|---|
| Game | 2.31, borderless window 3840 × 1600, SDR; DLSS with frame generation (the overlay drew through Streamline's proxy) |
| Bridge | 0.8.0 `-writes` with inventory, `natives=19`; the overlay host on, theme dark |
| MO2 profile | The dedicated test profile, with Codeware, XF Finish Showroom and Equipment-EX staged |

## 2. The crash at launch

0.8.1 crashed the game in three of three launches, with heap corruption (`0xc0000374`) in `ntdll`: once while loading the plugin, twice moments after both of its pipes (the main one and the new control pipe) started. 0.8.0 with the same frameworks launched cleanly, so the session went back to it. The cause, found offline afterwards, was a stale object file: 0.8.1's DLL linked a `Main.obj` that allocated the bridge at its old size, and the constructor wrote past the block. 0.8.2 adds three guards against it ([game crashes §2.5](../../knowledge/game-crashes.md#25-a-stale-object-file-in-the-plugin-bridge-081), [design §3.10](../../research/runtime/runtime-bridge-design.md#310-bridge-082-the-crash-at-load-the-re-checks-findings-session-9-and-one-status-surface)).

## 3. Results

| Row | Grade | What happened |
|---|---|---|
| I1 | Partial | Loading the newest save from the main menu worked (`route: main_menu_continue`), but it took about 87 s to reach gameplay and then waited on the game's press-any-key screen. `game_saves` ignored `limit` for its `names` (all 152 listed), listed the newest save twice, and gave the location and quest as untranslated `LocKey#…` keys. `game_wait` refused a phase given as one string |
| A3 | Pass (wording) | The one-answer question worked, but the card's "Press it" was unclear: name the button ("Press Done") |
| B1 | Fail | The ink panel was whole, with its plate and red edge, but at the left edge and **vertically centred** (about 40–55 % down) instead of top left about 360 px down. Its geometry line read `visible=3840x1600 at 0,280` |
| B2 | Fail | The anchors placed the panel's top-left corner on the anchor point without allowing for its size: `top_right` showed a sliver past the right edge, `bottom_left` was entirely below the screen. The other anchors were skipped |
| B4 | Partial | Polish and accents were intact in the ink panel, but the replacement mark ¤ is itself missing from the game's ink font, so Japanese text, the emoji and even a literal ¤ left blank gaps |
| B6 | Fail | Pending questions formed a stack: one answered only by a comment stayed pending, the next one appeared under it, answering the newest revealed the older one with its own keys, and `ui_message {clear: true}` didn't withdraw it. The "Answered:" line therefore never showed |
| C2 | Fail | Ctrl+Enter in the XF Runtime Bridge window's comment box didn't send: the box lost focus instead, and only Send worked |
| C3 | Partial | The hotkey was named "Stop XF Runtime Bridge", but it was unbound: CET had dropped the earlier binding. The Bindings group read "Xf Runtime Bridge" (CET capitalises the mod's folder name) |
| D2 | Fail | `behave_look {turn: {yaw: 90}, duration_s: 4}` ended `reached` after 1.18 s, so the duration wasn't honoured. Whether the mouse took over at the tail was inconclusive |
| E2 | Note | The Mantis Blades showed **holstered** in photo mode's default pose (session 8, on 0.7: deployed), recorded in [photo mode §14](../../knowledge/photo-mode.md#14-arm-cyberware-vs-weapon-slot-and-the-cameras-projection) |
| F1 | Partial | The pin showed in the world, on the minimap and on the map, with its label and description (session 8: nowhere). In the world it was only the game's marker, with no XF diamond or label above it, and `drawn_by` read empty in the placing answer |
| G1–G3 | N/A | No showroom manifest was at hand (the card didn't name one), so the showroom rows and the head pin were skipped |
| H1 | Pass | Five saves with their details in normal play (session 8: none). No save was written while a bridge change was live |
| H2 | Pass | The Head area hidden, `shown_by` Equipment-EX |
| J1 | Pass | The overlay drew cleanly with frame generation (`proxy=streamline`) |
| J2 | Pass | Two resizes, drawing kept; Alt+F4 quit with a clean overlay shutdown and plugin unload, no crash report |
| L1–L6 | N/A | 0.8.1's safety fixes, which 0.8.0 doesn't have |

## 4. Friction log

- **Three surfaces, one name.** "The XF panel" was ambiguous with three XF surfaces on screen, and "the XF window" was unclear too. The card, the questions and the docs need fixed names for each.
- **Four surfaces at once are confusing.** The status showed in the status label, the overlay panel and the ink panel together, beside the XF Runtime Bridge window.
- **"Not connected" between calls.** The status said "XF Studio not connected" whenever the command-line client wasn't connected, which is most of the time between calls. During a session the status should follow the session, not each connection.
- **A waiting call blocked every other.** The pipe takes one client at a time, so a pending `session_wait` made every other call answer `bridge_busy`.
- **The answer line was replaced too soon.** After an answer, the coordinator should wait about 10–15 s before the next message, or the "Answered:" line is gone before the maintainer sees it.
- **A stale answer stayed.** After the last answer, the status label still showed "Answer: F6 Done".
- **Small things:** answer labels are capped at 24 characters and the tools didn't say so before sending; the window's text showed faintly through where it overlapped the ink panel (acceptable to the maintainer); two queue timing checks failed once right after a build.
- **Requests from the maintainer:**
  - `game_load` should get past the press-any-key screen by itself (0.8.2 sends no key: a synthetic key can't be kept to the game's window and that screen, and no route inside the game has been found);
  - photo mode is ink, and mods add to its UI, so the ink panel could live inside photo mode (research, not 0.8.2).

## 5. Decision

After the session the maintainer settled the surfaces: "The CET one is always a good fallback I agree, and allows additional things (diagnostics, for example) that the main game screen wouldn't really be an appropriate venue for. The ink overlay is by far the most beautiful just from its consistency with the game. The IMGUI overlay with the yellow heading is very XF brand coherent, so I like that too (when appropriate to show)." The resulting rule, one status surface at a time, is [design §9 item 7](../../research/runtime/runtime-bridge-design.md#9-maintainer-decisions).

Every finding went into bridge 0.8.2, with the re-check of 0.8.1's review; its [session-10 checks](../../research/runtime/runtime-bridge-test-card.md#session-10-checks-bridge-082) prove them ([session 10](../041-session-10/README.md)).
