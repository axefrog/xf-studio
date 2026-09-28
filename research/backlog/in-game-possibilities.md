# In-game possibilities: a register of proofs of concept

**Status:** an ambition register (29 September 2026), not a plan or a promise. The maintainer asked what the game could become if its systems were fully wired, and pre-approved any in-game experiment. Each entry is a proof of concept that teaches something new about the engine. Product features still follow the finish-before-widening rule ([AGENTS.md](../../AGENTS.md)); these run as R&D and as small side experiments bundled into test sessions. The direction behind them is in the [vision](../../docs/vision.md). Related registers: [bringing V and the world to life](alive-ideas.md) and [world and interactive ideas](world-and-interactive-ideas.md). The route map (which engine system each needs) is `research/runtime/in-game-ui-design.md`, written by the ink research track.

## The interface

1. An XF HUD panel in the game's own style (replacing the CET status label). *First demo, bridge 0.5.3.*
2. World-space ink: nameplates and holographic labels floating over objects. *First demo: showroom pedestal nameplates.*
3. Our own map pins and on-screen markers, like quest markers: a navigation layer for the showroom, quests and points of interest. *First demo: `world.pin`.*
4. A holographic V damage display: the inventory paperdoll's 3D preview of V with a holo material and glowing damaged regions (or an ink vector body).
5. A new phone app, with the game's phone as our UI surface.
6. A terminal or computer program: an in-game XF control panel on V's apartment computer.
7. Widgets injected into the character creator: a live XF preview strip, controls beyond the vanilla ones.
8. A custom menu screen of our own, opened from the pause menu (a Studio hub inside the game).
9. A radial wheel of XF quick actions: photo presets, expressions, lighting.
10. Diegetic UI on V's optics (the scanner layer) for our overlays.

## The camera and presentation

11. Scripted cinematic camera moves (orbit, dolly, rack focus) for photo mode and cutscene-like shots.
12. Portrait lighting rigs that follow V in normal play.
13. A virtual photo studio: a stage with backdrops and our lighting, reachable from anywhere.

## V and characters

14. A live face in the running game: the carrier clip driven from the Studio's expression sliders.
15. Live posing with joint gizmos drawn over the game.
16. Custom idles and micro-motion in normal play.
17. NPCs that notice V's look (the reaction layer; see the mod survey's NPC batch).
18. Spawned characters directed like actors: walk here, look there, play this expression.

## The world

19. Opening a locked door and furnishing an interior, live, from the Studio.
20. A lived-in room: NPCs with routines in a space we built.
21. Weather, time and colour grading directed per scene.
22. Interactive props: a working arcade game, or a TV channel of our own.

## Quests and systems

23. A micro-quest authored in a visual editor and hot-tested through the bridge: a phone message, a map pin, an objective, a reward.
24. Dialogue choices with our own lines (text first; voices later, only from consenting performers).
25. A per-limb damage system as a real gameplay mechanic.
26. Persistent world state of our own, saved with the game.

## Control and tooling

27. Full player control: walking, the camera, interacting (the player control research, `research/runtime/player-control-design.md` once merged).
28. An in-game recorder: log and replay V's route, the camera path and actions, for repeatable tests and machinima.
29. The director assistant: a described shot ("rooftop, golden hour, three-quarter portrait") set up end to end.
30. An in-game note hotkey that timestamps observations and captures into the session log.
31. An XF mod manager built for scripted and AI use ([vision](../../docs/vision.md#two-kinds-of-mod)).

## What the game could be for the player

The entries above lean towards tools. These are the player's side: what the game itself could offer, with the Studio as the workshop behind it.

### A city you live in

32. NPCs with daily routines (home, work, a bar at night), shops that open and close, regulars who recognise V.
33. Enterable buildings with things to do: bars with pool, darts and arcades; clubs where V can dance; diners where V eats and drinks, animated.
34. Apartments as homes: furniture and decor placement, rent and eviction consequences, visitors, a partner who is actually there.
35. City events: blackouts, acid rain, Badlands sandstorms, street festivals, gang turf that shifts over time.
36. In-world media that reacts to V: news, TV and radio segments about V's jobs; ads and graffiti that change.

### A life, not just missions

37. Jobs and careers: taxi and delivery runs, bartending shifts, netrunning contracts, fixer gigs generated to fit V's reputation.
38. Relationships that continue: dates, texts, companions who ride along and comment, romance past the credits.
39. Owning things: a bar or garage V runs, property, income, a crew.
40. Survival and the body: needs, per-limb injuries with trauma and ripperdoc recovery, cyberware with real trade-offs.
41. Style that matters: dress codes, NPCs reacting to V's look, clubs that turn V away.

### Play as more

42. Side stories starring other characters, the way the flashback sequences swap the player.
43. Braindance creation: record V's own play as a braindance, edit it and watch it back.
44. Photography as a career: shots for news outlets or fixers, with photo mode as a job skill.
45. Deeper netrunning and hacking; vehicle life (tuning, races, garages).

## How entries move

An entry becomes an experiment when a session can bundle a small demo, and becomes a product feature only after discussion and after the current product reaches 1.0. Record each demo's result here with a link to its experiment.
