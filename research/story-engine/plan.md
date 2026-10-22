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
8. **The player sets the mix:**
   - human-authored content only, procedural only, or both;
   - how proactive the procedural side is, down to switching it off;
   - which content packs play.
9. **No perceivable cost.** It meets the project's [load-time and responsiveness goal](../backlog/performance.md) in game and in the Studio.
10. **Coexistence.** It's additive, never breaks vanilla quests or other mods, and degrades in plain words when something is missing.

## 2. The system at first level

Everything here rests on the [foundation](foundation.md), the dimensional model that anchors every design: one uniform structure of dimensions, localities and contributions, the same at every scale. The layers below are ownership boundaries over that one model.

Four layers sit above the game. Each layer uses only the one below it, through a small typed interface. All four are plain data and deterministic code: content is data, and the engine interprets it.

| Layer | What it is | Holds |
|---|---|---|
| **4. Authored content** | What people write: quests, seeds, story fragments, characters, places and setting material, precise or vague. It ships as content packs and, later, is authored in the Studio | Content packs read by a generic loader, the authoring formats, and the player's choice of packs |
| **3. Procedural engine** | The narrative intelligence, with two roles:<br>- **Sowing (proactive):** it sifts the record for story-shaped patterns, proposes new seeds and grows engaged threads into arcs. How much it sows is a player setting, from off to high.<br>- **Fitting (in service of authors):** it fits authored seeds into the world and the story so far. It decides when, where, why now and through which channel, and supplies whatever connecting material the author left open. Fitting stays available when sowing is off.<br>In both roles it uses layer 4's material as its vocabulary | Sifting patterns, generators, escalation, the fitter, the director's choices |
| **2. Seeding layer** | The only way content enters the simulation, used by people and the procedural engine alike. It handles:<br>- a seed language that spans the binding spectrum, from a premise with loosely constrained roles to a fully scripted beat graph;<br>- casting, which resolves whatever a seed left open;<br>- the seed lifecycle: sown, waiting, materialised, resolved, withered;<br>- intersections between threads;<br>- scheduling of what surfaces when (pacing, tension budget, channel) | The seed language and its resolver, the scheduler, the record of what each seed did |
| **1. Simulation layer** | Sunk into the running game. It mirrors what the game owns (vanilla quests, people, police, streaming, time) and simulates only what the game doesn't. It holds the world model at levels of detail and moves it forward. It makes content present in the game and records what V perceives as canon. It persists the record with the save | World model, simulation, realisation, perception, persistence, and the game interface (senses and verbs) |
| *Game* | Cyberpunk 2077, with the player's other mods | |

Three consequences follow from the layering:
- **Authored content plays with sowing switched off.** Binding a seed's open roles to people and places is mechanical casting, in layer 2. Deciding when it should happen, in what context, and how it connects to the story so far takes judgement, and that judgement is layer 3's fitting role. Fitting serves authored content even when the procedural engine sows nothing of its own.
- **Authors say what they care about.** Each part of an authored seed is marked fixed, preferred (with a strength) or open, with optional notes on intent and fallbacks. Fitting must respect what is fixed, honour what is preferred where it can, and fill what is open.
- **Authored content sits above procedural content,** as its director and its source material, not beside it. An author can leave a thread open for layer 3 to grow ("let this develop"), or contribute fragments, characters and places that layer 3 then uses.

**Reference scenario R1.** An authored side quest with a romance option for a main-story character (Takemura, say). The author has fixed the character, the romance and the scenes they wrote, prefers some things (a quiet moment, a district), and leaves the rest open. Fitting has to work out several things from the game's own story state:
- the window in which he is alive, allied with V and free;
- a moment and a channel that suit the quest's intent;
- the hook and connecting material, with callbacks to what this V has done;
- what happens if the window closes before the quest fires.

The scenario tests layers 2–4 and the authoring tools from M2 onwards ([DS-41](design-seeds.md) to [DS-45](design-seeds.md)).

**Cross-cutting concerns:**
- **Expression:** words and signals. Authored text comes from layer 4, generated text from layer 3, and layer 1 renders both through the game's channels. Generated text renders fine detail; it never does the planning.
- **Player configuration:** the content mix, proactivity, scale caps, tone and content controls, and how much the simulation remembers.
- **Evaluation:** the quality criteria, synthetic players, critics and the session protocol.
- **Tooling:** views for agents and people of what each layer knows, and why something happened.

The loop at the heart of it:
1. Layer 1 advances the world and records what V perceives.
2. Layers 3 and 4 sow seeds through layer 2.
3. Layer 2 casts them, schedules them and plays out their intersections.
4. Layer 1 makes the scheduled content present in the game.
5. What V perceives becomes canon, and the loop repeats.

## 3. Workstreams

| WS | Name | Produces | Depends on | Starts |
|---|---|---|---|---|
| 1 | **Craft research** | The research method; one dossier per discipline; composite graph v0 | Nothing | Now |
| 2 | **Game substrate research** | Knowledge pages on the game's quest, journal, facts, phone, spawning, crowd, scanner and gig systems; the quest corpus; decompositions of vanilla gigs and quests | The native reader, or WolvenKit, for extraction | Now, as desk research |
| 3 | **System design** | A design for each layer, the authoring formats and player configuration, and runtime placement | WS1's composite v0 (for layers 2–4); WS2 (for layer 1) | After M1 |
| 4 | **Runtime liaison** | The [runtime requirements](runtime-requirements.md) ledger; an agreed plugin route; a current picture of the bridge | The runtime bridge chat | Now, ongoing |
| 5 | **Offline prototype** | All four layers over a slice of the real city's data, with text output: an authored seed played with layer 3 off, then with it on | WS3 v0 | M3 |
| 6 | **In game** | Small encounters, then gigs, then arcs | WS4's capabilities and WS5 | M4 |
| 7 | **Evaluation** | Criteria, the harness, critics and the session protocol | WS1 and WS5 | Grows from M2 |

## 4. Milestones

| Milestone | Scope | Done when |
|---|---|---|
| **M0. Set-up** | Locations, this plan, registration on the coordination board, bridge liaison opened | Done 22 October 2026 |
| **M1. Method and maps** | The research method (P1) and the game substrate plan (P2) written; the map of disciplines drawn; runtime requirements and the XF Core plugin API needs sent to the bridge chat | Done 22 October 2026 |
| **M2. Understanding v0** | Core dossiers; composite v0; decompositions of a sample of vanilla gigs and quests; designs v0 for the four layers, with the seed language first; runtime placement decided; evaluation criteria v1 | The composite can express what separates the sample's strong quests from its weak ones, and the seed language can express both a precise and a vague version of one of them |
| **M3. Offline prototype** | One district built from real game data at coarse and medium detail. Seeds are sown through layer 2: an authored seed (scenario R1) fitted on several story states with sowing off, then layer 3's own hooks at several proactivity settings. Output is text. Synthetic-player playthroughs and an adversarial critic pass | Generated hooks beat a Radiant-style baseline on the quality bar, judged blind; the authored seed plays with sowing off, fitted the same way as with it on |
| **M4. First encounters in game** | Small encounters near V through the bridge in the test profile; perception fed back; a friction log | One prepared in-game session passes its checklist |
| **M5. Gigs** | Fixer-delivered jobs with a cast, a place, complications and consequences, authored and procedural | A session's gigs meet the quality bar |
| **M6. Arcs** | Engaged threads escalate into multi-part stories; intersections play out; the record persists across saves and reloads | A multi-session arc holds together across saves |
| **Later** | Studio authoring and live tuning; a release-flavour plugin; content packs from other authors; coexistence with other mods; a public release | Discussed when M6 lands |

Each milestone ends with a short report to the maintainer covering three things, with no spoilers:
- what was achieved;
- what to look at;
- what needs testing.

## 5. Second-level plans

Written roughly in this order. Each one names the design seeds it absorbs.

| Plan | Covers | When |
|---|---|---|
| **F. [Foundation](foundation.md)** | The anchoring theory: dimensions, localities, bundles, contributions, the operations and rules, story in the same space, the reference model and the compromise ledger. Every plan below maps onto it | Drafted (v0) |
| **P1. [Research method](p1-research-method.md)** | WS1: how disciplines are found (several independent lenses), the dossier template, evidence grades for craft knowledge, the composite's schema, the adversarial loop, credits | Drafted |
| **P2. Game substrate research** | WS2: the main story's progression as facts and phases (so authored seeds can name windows such as "after the parade" and fitting can test them), the quest file chain, facts, journal and its limits, phone, map pins, communities and spawners, workspots and AI spots, the scanner, the open-world activities and the fixers' gig structure, save data; the corpus extraction | Next ([WP-04](#82-work-packages)) |
| **P3. Simulation layer** | Layer 1: the world as sampled fields over dimensions ([DS-47](design-seeds.md) to [DS-51](design-seeds.md)), entities, facts, provenance, beliefs, the detail tiers and how a fact is refined between them, mirroring what the game owns, canon, forgetting, persistence and save branching, determinism | M2 |
| **P4. Seeding layer and seed language** | Layer 2: the seed language across the binding spectrum, casting, the seed lifecycle, intersections, scheduling and the tension budget, the record | M2, first of the layer designs |
| **P5. Procedural engine** | Layer 3: sowing (sifting, proactive seeding, escalation, the proactivity dial) and fitting (timing, context, channel, connecting material, fallbacks), the director's steering rules, how it uses authored material | M2 |
| **P6. Authored content and player configuration** | Layer 4 and the settings: authoring formats, author priorities (fixed, preferred, open), content packs and their loader, the fit report and pinning loop, how authored seeds ask layer 3 for help, the authoring workflow (files first, the Studio later), every player setting | M2 |
| **P7. Runtime placement** | Where each layer runs (the companion process XF Core launches, redscript, the Studio host, a native part if needed), language, budgets, saves, one engine shared by the offline preview and the game | M2 |
| **P8. Realisation, perception and expression** | Layer 1's game-facing side and expression: channels, materialisation and restaging, perception capture, text and voice, tone and content controls | M2–M3 |
| **P9. Evaluation** | Criteria, synthetic players, critics, blind comparisons, in-game session protocol | M2 |
| **P10. Tooling and inspection** | Agent-readable state and "why" traces for every layer, then Studio views | M3 |

## 6. Principles at every level

- **The foundation anchors everything.** Each design states how it realises the [dimensional model](foundation.md). A pragmatic departure goes in the compromise ledger with a revisit trigger, so a compromise that stops serving us is replaced by something closer to the model, not by a new special case. A slow generic reference model is the oracle that faster implementations must agree with.
- **Want first.** Decide what the system needs, then work out what the bridge, XF Core or a standalone mod must provide.
- **Follow the [architecture contract](../authoring/architecture-contract.md):**
  - plain, versioned data with explicit state transitions;
  - deterministic and seeded, with the clock and randomness injected;
  - one owner per subsystem;
  - everything inspectable.
- **Content is data.** Authored quests, seeds and packs are data that a generic loader reads, never code per pack, just as other mods' content reaches the Studio through the generic resolver.
- **Read the world the way the game does.** The world model builds on the generic resolver, the world index and TweakDB, so other mods' places and people take part without per-mod code.
- **Additive by default.** An overhaul-scale version would be opt-in and isolated, as [AGENTS.md](../../AGENTS.md#mod-pipeline-and-packaging) requires.
- **Keep kinds of evidence separate.** Offline simulation is never presented as in-game proof.
- **Voices:** reuse the game's own lines or use consenting performers. Nothing is cloned.

## 7. First-level risks

| Risk | Answer |
|---|---|
| Too ambitious to land anything | The offline prototype comes before the game, and small encounters come first in game |
| Runtime limits: journal entries can't be created from script, voiced lines, navigation, spawn budgets, frame time, the bridge's save lock | The runtime requirements ledger, P7 and P8; aim at procedural strengths rather than cinematic quests |
| It still feels generated | The quality bar, adversarial critics and blind comparisons from M3 on |
| Dependence on the bridge's and XF Core's timelines | The ledger, early agreement on the plugin route, and a host-side prototype route that needs nothing new |
| Saves: reloads, branching, save-file growth | P3 and P7; the record is keyed to the save and branches with it |
| Other mods that change crowds, reactions or gigs | Detect them and step aside or layer, decided in P8 |
| Quota | Research agents kept few and focused; this chat's budget is recorded on the coordination board |

## 8. Plan of action

Work moves through four stages, and every area goes through all four ([D-11](decisions.md)):
1. **Theory and research:** what is true, and what is known.
2. **Design:** the second-level plans, P1 to P10.
3. **Specification:** normative documents in `spec/` that say exactly how the engine works. Each one ends with test vectors.
4. **Implementation:** first the TypeScript reference model, which is the oracle, then the native core.

A specification must be complete enough that an agent with no memory of any discussion can implement it from the page.

### 8.1 Areas and their stages

| Area | Theory and research | Design | Specification | Implementation |
|---|---|---|---|---|
| Kernel: the dimensional model | [Foundation](foundation.md) v0; formal grounding (P3) | The foundation | S0 [kernel](spec/kernel.md) | Reference model, then native core |
| Simulation layer: processes, tiers, mirroring the game | P2 | P3 | S1 simulation | |
| Seeding layer and seed language | P1 | [P4](p4-seeding-layer.md) | [S2](spec/seeding.md) seed language | |
| Procedural engine: sowing, fitting, director | P1 | P5 | S3 procedural engine | |
| Authored content and player configuration | P1 | P6 | S4 content packs and settings | |
| Runtime: companion process, game port, persistence | [Requirements](runtime-requirements.md), the bridge | P7 | S5 game port and companion protocol; S6 persistence format | |
| Realisation, perception and expression | P2 | P8 | S7 | |
| Evaluation | P1 | P9 | S8 | The harness |
| Tooling and inspection | | P10 | S9 | |

### 8.2 Work packages

Status values:
- **done**;
- **running:** in progress;
- **next:** starts as soon as capacity allows;
- **waiting:** blocked on something named in the row;
- **later**.

Update a row in the same checkpoint as the work it describes.

| WP | Work | Output | Depends on | Status |
|---|---|---|---|---|
| 01 | Safeguards against lost context: decisions register, "start here" path, this plan of action | [decisions](decisions.md), [README](README.md#start-here), §8 | | done |
| 02 | Credits for every work the design has drawn on so far | Entries in the [community credits](../../docs/community-credits.md) | | done: 38 entries (a Story and game design section, and additions to Research papers) |
| 03 | P1 phase A, the lens runs:<br>1. L1 and L2 first;<br>2. then L3, L6, L7 and L8;<br>3. then L4, L5, L9, L10 and L11;<br>4. then second-model runs, until saturation | `craft/lenses/` (committed with the map) | | done: 12 lenses (L1–L12), raw outputs in `craft/lenses/` |
| 04 | P2, the game substrate research plan | [p2-game-substrate.md](p2-game-substrate.md) | | done: [P2](p2-game-substrate.md) v1 |
| 05 | S0, the kernel specification v0: the foundation made exact | [spec/kernel.md](spec/kernel.md) | 04 (for the game-mirror parts) | done: [S0](spec/kernel.md) v3.1: three review rounds, then the reference model's decisions adopted; first-implementation scope final ([D-19](decisions.md)) |
| 06 | P1 phase B, the discipline map, then the maintainer checkpoint | `craft/map.md` | 03 | done: [discipline map](craft/map.md): 182 fields, 23 dossiers; broad lenses stop; the coordinator decides, and the map lists its judgement calls for the maintainer to overrule if wanted |
| 07 | P2 desk research:<br>- the main story's progression as facts;<br>- the gig system;<br>- population;<br>- channels;<br>- event hooks;<br>- saves | Knowledge pages and research notes | 04 | done: areas A–H ([save identity](../../knowledge/save-identity.md) is G, [places](../../knowledge/places.md) is D, with 32 place dimensions); H's sample decompositions continue under 12 |
| 08 | The reference model v0, implementing S0, with its test vectors. Code lives in `projects/xf-story-engine/reference/` and lands through XF · Meta-coordinator, which owns `main` with a code review | Code and tests | 05 | done: on `main` (`dceceef0`): 261 tests, three Sol rounds with nothing left open, CI on every change; its 57 notes adopted as S0 v3.1 ([§19](spec/kernel.md#19-decisions-adopted-from-the-reference-model)) |
| 09 | P1 phase C, the dossiers, starting with motivation and drives | `craft/*.md` | 06 | done: all 23 dossiers landed, each with its credits and with source corrections where verification found errors. Dossiers 1–6 ([d01](craft/d01-motivation-drives.md), [d02](craft/d02-relationships.md), [d03](craft/d03-fitting-casting.md), [d04](craft/d04-quest-structure.md), [d05](craft/d05-units-variety.md), [d06](craft/d06-sifting-tellability.md)), 7 to 23 landed ([d07](craft/d07-direction-pacing.md), [d08](craft/d08-scale-threads-time.md), [d09](craft/d09-agency-consequence.md), [d10](craft/d10-change-theme-payoff.md), [d11](craft/d11-saves-memory-forgetting.md), [d12](craft/d12-player-model-trust.md), [d13](craft/d13-perception-curiosity.md), [d14](craft/d14-city-events.md), [d15](craft/d15-people-networks-order.md), [d16](craft/d16-authoring-tools.md), [d17](craft/d17-setting-tone.md), [d18](craft/d18-content-boundaries.md), [d19](craft/d19-rights-platforms.md), [d20](craft/d20-staging-legibility.md), [d21](craft/d21-words-dialogue.md), [d22](craft/d22-language-models.md), [d23](craft/d23-evaluation-testing.md)). Their requirements are folded into S0 v4.5 and S2 v0.16; S1, S3 to S9 and P10 lists wait in the dossiers |
| 10 | P4, the seed language design, then S2. Scenario R1 is its first test | Design and spec | 05, 09 | running: [P4](p4-seeding-layer.md) design v0 from dossiers 2–5, 7 and 9; [S2](spec/seeding.md) v0.3: one Astra review (25 findings adopted), the ladder profile in full, dossiers 10 to 23 folded in (v0.16); S0 v4.5 adds memory, forgetting, city settings, implicit ties, content floors and the property-test plan. [S0 v4](spec/kernel.md#20-version-4-additions) adds what it needs. Next: layer 2 and the v4 additions in the reference model |
| 11 | P3, the simulation layer beyond the kernel, then S1 | Design and spec | 05, 07 | later |
| 12 | Quest corpus extraction (memory-guarded), then sample decompositions | `research/consumers/quest-corpus/`, decompositions | 07; the composite schema from 16 | later |
| 13 | P5 and P6, then S3 and S4 | Designs and specs | 10 | later |
| 14 | P7, then S5 and S6; a hello-world companion with the bridge's C1 work | Design, specs, proof | 05; bridge C1 | later |
| 15 | P8, P9 and P10, then S7, S8 and S9 | Designs and specs | 11, 13 | later |
| 16 | Composite v0, then the attempts to break it (P1 phases D and E) | `composite/` | 09, 12 | later |
| 17 | The offline prototype (milestone M3) | Code, results | 08, 10, 11, 13 | later |
| 18 | Early staging check: a handful of small encounters generated offline are staged host-side in one booked session, to confirm that they can be expressed in game and read well there, while the design is still cheap to change | Session results, friction log | 17's first output; the bridge's NPC branch proven | later |
| 19 | A perceivable sandbox: the engine running on a schematic slice of Night City (real districts, gangs and crime presets), showing level-of-detail drill-down, observation pins, determinism, influence fields, "why" traces and relevance. It's for the maintainer to gauge what is built. Secondary to the engine itself | A page the maintainer can open | 17 (it shows the offline prototype, not only the kernel) | later |
