# Bringing V and the world to life: idea register

**Status:** a standing direction, not a feature request (27 September 2026). The maintainer wants V, and later the world around V, to feel more alive and real than the rigid vanilla systems allow. That covers more idles, freer posing and freestyle animation, and more dynamic surroundings. Ideas are collected here as they come up during the work. Each is discussed before anything is built. Ideas that become features move to their own backlog pages.

## What we already know the engine can do

| Capability | Evidence |
|---|---|
| Photo-mode body graph with head/chest rotation, look-at (eyes, head, chest, hands) and two-bone IK on all limbs | [poses](../../knowledge/poses.md) |
| A facial rig of 141 artist-meaningful main poses, additive clips and many NPC emotion idles | [facial expressions](../../knowledge/facial-expressions.md), [facial animation](../../knowledge/facial-animation.md) |
| Dangle physics declared per hairstyle and per item, with a particle solver and collision capsules | [hair physics](../../knowledge/hair-physics.md) |
| A live bridge into the running game (RED4ext, redscript, CET) | [runtime access](../../knowledge/runtime-access.md) |
| Additive world content through ArchiveXL blocks and World Builder | [world and streaming](../../knowledge/world-and-streaming.md) |

## Ideas (unranked, for discussion)

### V

- **An idle wardrobe:** authored idles (pose editor plus animated poses) that the game plays as variants of V's standing idle, with a mood setting (relaxed, tired, confident, restless). The game already picks between idle variants in several graphs.
- **Micro-motion layer:** breathing, small weight shifts, blink-rate variety and eye saccades (tiny, constant eye movements), layered additively over any pose or idle. This is where much of "alive" comes from, and the facial rig and look-at channels already exist.
- **Eyes that look at things:** point of interest for the eyes and head, taken from the camera, nearby NPCs, a light or a moving object, using the graph's own look-at channels. That works in photo mode and possibly in gameplay.
- **Expressions that react to context:** subtle emotion additives driven by state, such as low health, rain, combat just ended or a friend nearby, through redscript feeding the facial clip additives.
- **Skin that responds:** wetness in rain, flushed cheeks after sprinting, sweat or grime building up and washing off, scars that stay. These are material parameters driven live, building on the skin and decal shader study.
- **Physics on everything that should move:** hair (planned), earrings, jewellery, coat tails and straps, all through the same solver.
- **Photo-mode direction:** live posing from the Studio, look-at targets, expression and pose timelines. "Directing" V rather than choosing presets.

### The world

- **Ambient life:** new ambient NPC behaviours and scenes at chosen places (workspots, community spawns), authored in the Studio's world tools (phases W4–W5 in [world ideas](world-and-interactive-ideas.md)).
- **Reactive surroundings:** NPCs noticing V's look, weather-reactive crowds, and time-of-day routines.
- **Places that remember:** persistent, player-driven changes to locations (decor, props left behind), stored in the save generically, as the [save editor study](../save/save-editor-design.md) shows the save can describe mod data.

## Related

[Pose editor](../animation/pose-editor-design.md) · [Pose library](../animation/pose-library-design.md) · [Expressions and idles brief](expressions-and-idles-brief.md) · [Hair physics plan](../animation/hair-physics-plan.md) · [World and interactive ideas](world-and-interactive-ideas.md)
