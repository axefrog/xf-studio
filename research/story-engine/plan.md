# Story Engine: first-level plan

The plan follows the same principle as the system it plans: coarse first, with detail added where it's needed. This level fixes five things:
- the quality bar;
- the subsystems;
- the workstreams and their order;
- the milestones;
- the second-level plans.

Each second-level plan is written when its workstream is about to start. It absorbs the [design seeds](design-seeds.md) that bear on it. See the [hub](README.md) for where everything lives.

## 1. What "doesn't suck" means

The quality bar, as statements the evaluation workstream (§3, WS7) will turn into tests. This is a draft, and the research may add to it.

1. **Causality.** Everything that reaches V has real causes in the world's record, and its consequences persist.
2. **Relevance.** Content connects to V's own history, places and people. Callbacks to what V did earlier are the norm.
3. **Legibility.** V can tell what's going on and act on it. Discovery holds up even when the simulation drifts.
4. **Agency.** V's choices change outcomes that the world remembers. Content never offers a choice and then decides the result regardless.
5. **Perceptible variety.** Players notice the difference, not just a distinct seed number.
6. **Setting fidelity.** It reads as Night City: its factions, districts, economics, tone and themes.
7. **Pacing.** Tension builds and rests. There's never spam and never a dead city.
8. **No perceivable cost.** It meets the project's [load-time and responsiveness goal](../backlog/performance.md) in game and in the Studio.
9. **Coexistence.** It's additive, never breaks vanilla quests or other mods, and degrades in plain words when something is missing.

## 2. The system at first level

| Code | Subsystem | Responsibility |
|---|---|---|
| W | **World model** | People, places, groups, items and vehicles; their relations; facts with a level of detail and a provenance (seen by V, told, inferred, simulated, generated on demand); individual beliefs at fine levels; persistence and forgetting |
| S | **Simulation** | The processes that move the world forward at each level of detail: the city (factions, economy, crime pressure), the district, the block, the scene, and individuals (routines and concerns) |
| N | **Narrative layer** | Story fragments with roles, preconditions, effects and a scale. It casts them against the world, sifts the record for story-shaped patterns, escalates small hooks into arcs, and plays out intersections between threads |
| D | **Director** | Pacing and tension. It chooses what surfaces, when, and through which channel, and models what V engages with. It steers only through what V hasn't observed |
| R | **Realisation and perception** | Makes facts and story present in the game at the right level of detail (spawn, place, dress, direct, message, mark), and feeds what V perceived back into the world model |
| E | **Expression** | Words and signals: barks, messages, shard and scanner text, reused voice lines, the setting bible, and tone. Generated text renders fine detail; it never does the planning |
| G | **Game interface** | Senses and verbs in the running game, through the bridge and an XF Core plugin, or through a standalone mod where that fits better |
| Q | **Evaluation** | The quality criteria, offline playthroughs with synthetic players, adversarial critics, and the protocol for in-game sessions |
| T | **Tooling** | Views for agents and people: what the simulation knows, and why something happened. Later, authoring and live tuning in the Studio |

The loop at the heart of it:
1. S advances W.
2. N sifts W's record and casts seeds into it.
3. D selects and paces.
4. R makes the selected content present in the game.
5. Perception writes what V saw back into W as canon.

Everything else serves that loop.

## 3. Workstreams

| WS | Name | Produces | Depends on | Starts |
|---|---|---|---|---|
| 1 | **Craft research** | The research method; one dossier per discipline; composite graph v0 | Nothing | Now |
| 2 | **Game substrate research** | Knowledge pages on the game's quest, journal, facts, phone, spawning, crowd, scanner and gig systems; the quest corpus; decompositions of vanilla gigs and quests | The native reader, or WolvenKit, for extraction | Now, as desk research |
| 3 | **System design** | World model and levels-of-detail design; narrative layer and director design; runtime placement | WS1's composite v0 (for N and D); WS2 (for R and G) | After M1 |
| 4 | **Runtime liaison** | The [runtime requirements](runtime-requirements.md) ledger; an agreed plugin route; a current picture of the bridge | The runtime bridge chat | Now, ongoing |
| 5 | **Offline prototype** | Simulation, sifting, casting and director over a slice of the real city's data, with text output | WS3 v0 | M3 |
| 6 | **In game** | Small encounters, then gigs, then arcs | WS4's capabilities and WS5 | M4 |
| 7 | **Evaluation** | Criteria, the harness, critics and the session protocol | WS1 and WS5 | Grows from M2 |

## 4. Milestones

| Milestone | Scope | Done when |
|---|---|---|
| **M0. Set-up** | Locations, this plan, registration on the coordination board, bridge liaison opened | Done 22 October 2026 |
| **M1. Method and maps** | The research method (P1) and the game substrate plan (P2) are approved; the map of disciplines is drawn; runtime requirements v0 have been sent to the bridge chat | The maintainer has read P1 and P2 |
| **M2. Understanding v0** | Core dossiers; composite v0; decompositions of a sample of vanilla gigs and quests; world model, narrative and director designs v0; runtime placement decided; evaluation criteria v1 | The composite can express what separates the sample's strong quests from its weak ones |
| **M3. Offline prototype** | One district built from real game data at coarse and medium detail; sifting, casting and a director; small hooks rendered as text; synthetic-player playthroughs; an adversarial critic pass | Generated hooks beat a Radiant-style baseline on the quality bar, judged blind |
| **M4. First encounters in game** | Small encounters near V through the bridge in the test profile; perception fed back; a friction log | One prepared in-game session passes its checklist |
| **M5. Gigs** | Fixer-delivered jobs with a cast, a place, complications and consequences | A session's gigs meet the quality bar |
| **M6. Arcs** | Engaged threads escalate into multi-part stories; intersections play out; the record persists across saves and reloads | A multi-session arc holds together across saves |
| **Later** | Studio authoring and live tuning; a release-flavour plugin; coexistence with other mods; a public release | Discussed when M6 lands |

Each milestone ends with a short report to the maintainer covering three things, with no spoilers:
- what was achieved;
- what to look at;
- what needs testing.

## 5. Second-level plans

Written in this order. Each one names the design seeds it absorbs.

| Plan | Covers | When |
|---|---|---|
| **P1. Research method** | WS1: how disciplines are found (several independent lenses), the dossier template, evidence grades for craft knowledge, the composite's schema, the adversarial loop, credits | Next |
| **P2. Game substrate research** | WS2: the quest file chain, facts, journal and its limits, phone, map pins, communities and spawners, workspots and AI spots, the scanner, the open-world activities and the fixers' gig structure, save data; the corpus extraction | Next, beside P1 |
| **P3. World model and levels of detail** | W and S: entities, facts, provenance, beliefs, the detail tiers and how a fact is refined between them, canon, forgetting, persistence and save branching, determinism | M2 |
| **P4. Narrative layer and director** | N and D: the fragment representation at every scale, casting, sifting, escalation, intersections, pacing and the tension budget, steering rules | M2 |
| **P5. Runtime placement** | Where each subsystem runs (Studio host, in-game native part, redscript), language, budgets, one engine shared by the offline preview and the game | M2 |
| **P6. Realisation, perception and expression** | R and E: channels, materialisation and restaging, perception capture, text and voice, tone and content controls | M2–M3 |
| **P7. Evaluation** | Q: criteria, synthetic players, critics, blind comparisons, in-game session protocol | M2 |
| **P8. Tooling and inspection** | T: agent-readable state and "why" traces, then Studio views | M3 |

## 6. Principles at every level

- **Want first.** Decide what the system needs, then work out what the bridge, XF Core or a standalone mod must provide.
- **Follow the [architecture contract](../authoring/architecture-contract.md):**
  - plain, versioned data with explicit state transitions;
  - deterministic and seeded, with the clock and randomness injected;
  - one owner per subsystem;
  - everything inspectable.
- **Read the world the way the game does.** The world model builds on the generic resolver, the world index and TweakDB, so other mods' places and people take part without per-mod code.
- **Additive by default.** An overhaul-scale version would be opt-in and isolated, as [AGENTS.md](../../AGENTS.md#mod-pipeline-and-packaging) requires.
- **Keep kinds of evidence separate.** Offline simulation is never presented as in-game proof.
- **Voices:** reuse the game's own lines or use consenting performers. Nothing is cloned.

## 7. First-level risks

| Risk | Answer |
|---|---|
| Too ambitious to land anything | The offline prototype comes before the game, and small encounters come first in game |
| Runtime limits: journal entries can't be created from script, voiced lines, navigation, spawn budgets, frame time | The runtime requirements ledger, P5 and P6; aim at procedural strengths rather than cinematic quests |
| It still feels generated | The quality bar, adversarial critics and blind comparisons from M3 on |
| Dependence on the bridge's and XF Core's timelines | The ledger, early agreement on the plugin route, and a host-side prototype route that needs nothing new |
| Saves: reloads, branching, save-file growth | P3 and P5; the record is keyed to the save and branches with it |
| Other mods that change crowds, reactions or gigs | Detect them and step aside or layer, decided in P6 |
| Quota | Research agents kept few and focused; this chat's budget is recorded on the coordination board |
