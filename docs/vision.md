# Where XF Studio is going

**Status:** a statement of direction, not a list of promises. Nothing here has a date. Each area is discussed before anything is built, and the current product (eye makeup, the character preview, the desktop app and the runtime bridge) reaches a finished, polished 1.0 before new features start. Current state lives in [status](status.md); the ranked work is in the [backlog](../research/backlog/README.md).

## The idea

Cyberpunk 2077 shipped with a fixed set of player-facing features, but the engine underneath does far more than those features use. Photo mode offers a long list of preset expressions, yet each one is a fixed setting of a face rig with 141 artist-meaningful controls. The character creator is a menu over a general system for resolving appearances. The world streams in blocks that mods can add to, trim and change without replacing anything. The game already swaps who the player is in some flashback sequences.

XF Studio's approach to each of these systems is the same:

1. **Understand it offline** well enough to reproduce it: how the files chain together, how the engine resolves them, what its solvers compute.
2. **Preview it faithfully** in the Studio, so people design against something close to the real result.
3. **Drive it live** in the running game through the [runtime bridge](../projects/xf-runtime-bridge/README.md), so the result can be tried in place immediately.
4. **Export it as an ordinary mod** that anyone can install, following the engine's and the core frameworks' own rules rather than special cases.

Taken together, that makes XF Studio the kind of live editor for the game that players were never given.

## Foundations that already exist

| Foundation | What it gives later work |
|---|---|
| A data-driven resolver that reads the installed game and mods the way the engine does | Every creator option, including other mods' additions, without per-mod code |
| A clean-room reimplementation of the game's facial solver | Faithful expression previews, and a base for animation tools |
| A native archive and resource reader | Fast, direct access to the game's files |
| The runtime bridge, scriptable by people and by AI assistants | Automated test sessions today; live editing later |
| A verified export and install pipeline | Results that reach the game as normal mods |

## Directions

- **V, fully authored.** Makeup, piercings, brows, hair, tattoos and the body, and later sculpting beyond the creator's fixed shapes and new skin and material finishes the game's shaders support but never offered.
- **Photo mode as a film set.** Lighting that matches the Studio's, proper lenses, live posing, a live face, other characters in the shot, and timelines that turn a pose into a short sequence.
- **A V who acts.** Subtle expression layers, breathing, eyes that follow things, expressions that respond to what is happening, lip sync for new lines, and a more natural face where the vanilla rig overdoes it.
- **A living city.** Opening the locked scenery doors, filling and populating buildings, and giving people routines and reactions; the engine has the building blocks, and vanilla uses them thinly.
- **Quests without friction.** A visual editor for quests and scenes, tested live in the running game (jump to any step, set its conditions, spawn its actors), with an AI co-author.
- **More than one protagonist.** New stories with new player characters, which the engine already supports in principle. Voices come from consenting performers, never from cloned voices.
- **An AI that can operate the game.** A photo director, an automated mod tester, or a companion that stages scenes, built on the same bridge the test sessions use.

The idea registers hold the detail: [bringing V and the world to life](../research/backlog/alive-ideas.md) and [world and interactive ideas](../research/backlog/world-and-interactive-ideas.md).

## Two kinds of mod

Most of what XF Studio makes stays **compatible**: additive mods that sit beside the rest of a player's setup, built with ArchiveXL, TweakXL and the engine's own rules. That remains the default.

Some directions above may grow into an **overhaul**: large, interlocking changes that can't promise compatibility with every other mod. That is a legitimate kind of project, and one people can contribute to. If it happens, it will be opt-in, clearly labelled, and set up in its own isolated installation, possibly managed by an optional XF mod manager that exists to reduce development friction. Nobody will be required to use it. Existing mod setups, whichever manager they use, are never modified or reshaped.

## Limits we accept

- The game's source code isn't available, so native work relies on careful reverse engineering, and a game update can break it.
- The game is single-player, and so is everything here.
- Some ideas will hit real engine limits. Each one starts as a research question, recorded in the [knowledge base](../knowledge/README.md), before it becomes a feature.
- Everything stays within CD PROJEKT RED's rules for fan content, and credits the community work it learns from ([community credits](community-credits.md)).
