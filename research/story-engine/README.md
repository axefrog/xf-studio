# Story Engine

**Status:** an R&D vertical, started 22 October 2026. It is at the research and design stage, with no code yet. It runs at its own pace beside XF Studio's 1.0 work: the finish-first rule governs the Studio product, not this research. The practical dependency is the [runtime bridge](../../projects/xf-runtime-bridge/README.md) and its successor, [XF Core](../runtime/xf-core-architecture.md).

## Start here

Anyone picking up this work, including an agent that has lost its earlier context, reads these in order:

1. This page: what the Story Engine is and where everything lives.
2. [Decisions](decisions.md): everything settled, with sources.
3. [Foundation](foundation.md): the anchoring theory every design maps onto.
4. [Plan](plan.md), especially [§8](plan.md#8-plan-of-action): the current state of every work package and what comes next.
5. [Design seeds](design-seeds.md): the fine points, and the plan or spec that absorbed each one.
6. For any area being specified or built: its specification in `spec/`, and its second-level plan for the reasoning behind it.
7. For anything that touches the game: [runtime requirements](runtime-requirements.md).

Then read the private coordination board, `local/coordination.md`: this vertical's row and notes, the agreements, and the claimed namespaces.

Standing rules that are easy to lose:
- Never read the live DM's story folder.
- No story content in messages, board entries or commit messages.
- Research agents run a few at a time, with each one's burn logged.
- Doc-only checkpoints land under Agreement 4.
- Repository documents never name the maintainer.

## What it is

The Story Engine generates gigs, quests and encounters that don't feel generated, at every scale from a passing moment on the street to a multi-part heist. It sits on top of a world simulated at different levels of detail. At the coarsest level there are only facts about the whole city. At the finest, the simulation knows what's written on the bag beside V and what the person next to her is worried about.

Story content enters that world in two ways:
- **Top-down:** content is seeded into the world from above.
- **Bottom-up:** content grows out of what the simulation already holds.

When threads collide, the outcome is played out and recorded. Whatever doesn't matter to V can be forgotten.

The work has two halves:

1. **A method for building the design knowledge.** Find every discipline that bears on good interactive storytelling, including the ones a task-focused agent would miss. Gather what each one knows, and how it fails. Merge it all into one graph that a procedural system can be built from.
2. **The system:** four layers above the game.
   1. A **simulation layer** sunk into the running game. It mirrors what the game is doing, simulates the rest at levels of detail, makes content present, and records what V perceives.
   2. A **seeding layer**, the only way content enters the simulation. It provides a seed language from vague to precise, casting, scheduling and intersections.
   3. A **procedural engine** with two roles. It sows content proactively, as much as the player wants, down to none. It also fits authored content into the world and the story so far, which stays available with sowing switched off.
   4. **Human-authored content** written as data, precisely or vaguely. It plays through the seeding layer on its own, or feeds the procedural engine.

The [first-level plan](plan.md) breaks this down.

## Where the work lives

| What | Location | Notes |
|---|---|---|
| Hub, plans, designs | `research/story-engine/` | This folder |
| Craft research, one dossier per discipline | `research/story-engine/craft/` | Created by the research method (plan P1) |
| The composite: the unified design graph | `research/story-engine/composite/` | Graph data plus its explanation |
| How the game's own systems work (quests, journal, facts, phone, spawning, scanner, crowds) | [`knowledge/`](../../knowledge/README.md) pages | The shared knowledge base; its rules and grades apply |
| Extracted game quest data (the corpus) | `research/consumers/quest-corpus/` | Payloads ignored, as for every consumer folder; manifest and notes tracked |
| Experiments and prototypes | `experiments/<NNN>-story-<slug>/` | Numbering is shared with the other verticals |
| Code, from the first prototype on | `projects/xf-story-engine/` (proposed) | Engine, content tools and evaluation harness. Where the game-side plugin lives is agreed with the runtime bridge |
| What we need in the running game | [Runtime requirements](runtime-requirements.md) | Decided by need first, then matched to what exists |
| Idea register entry | [Bringing V and the world to life](../backlog/alive-ideas.md) | Points here |
| Generated stories meant for the maintainer to play | `local/story-engine/` (ignored) | Kept out of view, like the live DM's script |

Work happens on the `claude/story-engine` branch in a worktree under `%USERPROFILE%/xfs-worktrees/story-engine`. Checkpoints reach `main` under the coordination rules in [AGENTS.md](../../AGENTS.md#cross-chat-coordination).

## Documents

| Document | What it holds |
|---|---|
| [Decisions](decisions.md) | Every settled decision, with its source |
| [Foundation](foundation.md) | The anchoring theory: the dimensional model every design maps onto, and the compromise ledger |
| [First-level plan](plan.md) | Quality bar, subsystems, workstreams, milestones and the second-level plans |
| [P1. Research method](p1-research-method.md) | How the craft research finds every relevant discipline and merges it into the composite |
| [P2. Game substrate research](p2-game-substrate.md) | What the engine must learn about the game itself, and how |
| [S0. Kernel specification](spec/kernel.md) | Exactly how the dimensional model works: data, algorithms, invariants, test vectors |
| [Quest corpus statistics](quest-corpus-statistics.md) | Node types, phase sizes, fact usage, branching, scenes per quest and graph shape of the game's authored quests, generated from the corpus database ([how it is built](../consumers/quest-corpus/scripts/README.md)) |
| [Design seeds](design-seeds.md) | Fine-grained design points, each waiting for the plan that will absorb it |
| [Runtime requirements](runtime-requirements.md) | The senses and verbs the system needs in game, and their status |

## Conventions

- **Want first, then work backwards.** Each subsystem decides what it needs without regard to what exists today. The [runtime requirements](runtime-requirements.md) then work out whether the bridge, an XF Core plugin or a standalone mod should provide it.
- **Evidence.** Knowledge about the game follows the [knowledge base grades](../../knowledge/README.md#rules-for-knowledge-pages). Craft research uses grades defined by the research method. Offline simulation never proves in-game behaviour.
- **Credits.** Every published work, practitioner, mod or tool that teaches us something gets an entry in the [community credits](../../docs/community-credits.md) during the work that used it.
- **The engine's concepts are first-party.** Its core concepts (context and relevance, the dimensional model, groups and perspectives) are the project's own. Outside systems and research may be cited as comparisons, never as sources, and are not credited for them. The public documents describe only what has been shared for publication.
- **No spoilers for the player.** Design documents describe mechanisms and use made-up examples. Stories generated for the maintainer to play stay in `local/story-engine/`, out of chat reports and commit messages.
- **Write current truth.** Plans are revised in place as decisions land. The design seeds register shows where each fine point went.
