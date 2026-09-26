# One-click "prepare idle and blink" in the desktop app

**Status: open, not started.** Raised by the game-blink code-health review (UI-62, 26 September 2026). Falls under the "It just works" policy in [AGENTS.md](../../AGENTS.md): the app does what it can for the user, asks consent before downloading, and otherwise gives one friendly next step.

## Why

The Motion panel's **Character-creator idle** and **Blink** are made once from the player's own game files and are never shipped. Today the only way to make them is a developer checkout: WolvenKit extraction, the `anim-export` tool, the IO Suite solver checkout at the pinned commit, then `prepare_idle.py`, `bake_idle_face.py` and `bake_game_blink.py` ([idle guide](../../docs/idle-animation-guide.md#the-blink), [cc-idle](../animation/cc-idle.md), [the game's blink](../animation/game-blink.md)). An installed desktop app has none of these, so its Motion panel always says the blink isn't prepared and links a guide the user can't follow.

## The flow

One button in the Motion panel's note (and a matching Help entry), shown only while the idle or the blink is missing:

1. **Explain and ask.** Plain words: what is made (the creator idle and the game's normal blink, a few MB, kept on this computer), from what (their own game files), and what is needed. Nothing happens without a yes.
2. **Use what the app already detects.** Game folder and WolvenKit come from the existing install detection and WolvenKit fetch; don't ask for paths the app knows.
3. **Consent-gated download of the solver.** The Cyberpunk Blender Add-on (IO Suite) at the pinned, reviewed commit (`PIN` in `tools/bake_idle_face.py`), from its official GitHub source archive, verified by hash, stored under the app's tools folder. It is GPL-3.0: download and run it unmodified as a separate program, never copy its code into XF Studio, and show its licence and credit in the consent step.
4. **Run the bake.** Extract the needed resources, export the clips, solve, and write the local assets where the preview reads them. Show progress, allow Cancel, and report the result in plain words ("The idle and blink are ready"), refreshing the Motion panel without a restart.
5. **Recover.** A damaged or stale asset (the blink's own messages already say "prepare it again") offers the same button. A failure says what went wrong and the one next step.

## Open questions

- **Python.** The bakes are Python (numpy plus the add-on's solver modules); the desktop app is otherwise Python-free. Options: a pinned embeddable Python fetched with consent, or running the solver some other way. The solver's code must not be ported into the MIT codebase.
- **`anim-export`** is a .NET tool referencing WolvenKit CLI assemblies; it needs a packaged build or an equivalent path through the WolvenKit the app already uses.
- **Where assets live** in the desktop app (per-user data, not the install folder) and how the preview server serves them.
- **Versioning.** Record the game version, rig, setup and solver commit with the assets so a game update or a different head can prompt a rebake (the blink asset already records its rig and setup).
- **Body types.** Only the female head is prepared today; a male head needs its own intake and bake.

## Done when

On a clean desktop install with the game and WolvenKit present, one consented action makes the idle and blink, the Motion panel enables both without a restart, and a deliberately damaged asset leads back to the same action.
