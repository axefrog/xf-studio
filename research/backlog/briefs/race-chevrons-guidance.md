# Research brief: race-track chevrons as in-world guidance

Requested by XF · Runtime bridge on 23 October 2026, through the [research queue](../research-queue.md). Priority: low to medium.

## Why

The maintainer, quoted word for word: "there's a system for races that shows chevrons on the ground to tell you where to drive to stay on track. I wouldn't be surprised if there are primitives underneath it that you could engage. What if you used them to tell me where to go when you want me to do something specific? Could also teach you something useful you could leverage in other contexts too." He has seen a mod surface it, but which one is not yet known.

**Purpose:** bridge sessions could guide the maintainer with an in-world marker instead of written directions (session 15's directions were wrong). Later, the Story Engine could use the same thing for its guidance.

## Questions

1. What draws the race chevrons and checkpoints? Script classes, entities or effects, and the records or quest nodes that place them.
2. Can a mod spawn and clear them along an arbitrary path, on foot as well as by car?
3. How do they relate to the GPS route line, and to custom map pins with routes?

## The lead to start from

The maintainer's MO2 has In-World Navigation 0.1.20 (Nexus 4583, by Jack Humbert, MIT licensed), with its source at `https://github.com/jackhumbert/in_world_navigation`. It draws holographic arrows in the world that follow the minimap's navigation path. It's built from a RED4ext DLL, redscript (`packed.reds`, `module.reds`) and an archive. Names it uses: `navPathFXs`, `navPathTransforms`, `UpdateNavPath`, and the `navPath*Resource` effects (White, Yellow, Teal, Blue, Cyan, FastTravelMetro).

Its source is public, so read it first, and credit it if we use what it teaches. Then compare it with what the race quests do.

## Existing material

Nothing in the knowledge base covers race guidance or the GPS route. Related pages:
- [player channels](../../../knowledge/player-channels.md) (map pins: `MappinSystem.RegisterMappin`);
- [places](../../../knowledge/places.md);
- [quests and story](../../../knowledge/quests-and-story.md);
- [player control](../../../knowledge/player-control.md).

## Sources

- **The race quests:** the street races are side quests. Their phases and scenes are in the local quest corpus, `research/consumers/quest-corpus/quest-corpus.sqlite`; see the "How to query" section of [quest corpus statistics](../../story-engine/quest-corpus-statistics.md).
- **The decompiled 2.31 scripts**, for the script classes.
- **Mods that surface the system,** studied for technique only, never their code, and credited:
  - the local mod-study set;
  - Nexus search.
- **The modding wiki and framework sources** (Codeware, ArchiveXL, TweakXL).

## Output

- A knowledge page (or a section of [player control](../../../knowledge/player-control.md)) answering the three questions, with graded claims.
- A recommended route for "show the player where to go" from the bridge, on foot and by car.
- Session-card rows in the bridge's format `| # | Who | Do | Expect | If not |`.
- Credits for any mod or guide learned from.

## Done when

Each question is answered or marked as needing the game, and the recommended route names the classes, records or nodes involved.
