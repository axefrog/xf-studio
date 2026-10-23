# P3. The simulation layer beyond the kernel

**Status:** design v0, 23 October 2026. This is second-level plan P3 of the [first-level plan](plan.md#5-second-level-plans), the design stage for layer 1 beyond the kernel ([WP-11](plan.md#82-work-packages)). The normative specification, S1, follows from it. It builds on:
- the [foundation](foundation.md), especially [§5](foundation.md#5-context-and-relevance) and [§9](foundation.md#9-the-reference-model-and-the-compromise-ledger);
- the kernel specification [S0 v4.7](spec/kernel.md), which defines the mechanism and the hooks S1 fills;
- the two specifications that read S1's outputs: [S2 v1.1](spec/seeding.md) and [S3 v0.1](spec/procedural.md);
- the S1 and P3 requirement lists of the dossiers: [1](craft/d01-motivation-drives.md#8-catalogue-v1-individual-drives), [2](craft/d02-relationships.md#11-requirements-for-the-simulation-layer-p3), [6](craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged), [10](craft/d10-change-theme-payoff.md#112-the-procedural-engine-p5), [11](craft/d11-saves-memory-forgetting.md#111-s0-and-s1-kernel-and-simulation), [14](craft/d14-city-events.md#111-s1-the-simulation-layer), [15](craft/d15-people-networks-order.md#111-s1-the-simulation-layer), [17](craft/d17-setting-tone.md#133-s1-world-data-that-seeds-the-simulation), plus the S1 rows of dossiers [12](craft/d12-player-model-trust.md), [18](craft/d18-content-boundaries.md), [20](craft/d20-staging-legibility.md), [21](craft/d21-words-dialogue.md) and the simulation-validation part of [23](craft/d23-evaluation-testing.md). Each is traced in [§20](#20-requirements-trace);
- the game-substrate knowledge pages: [places](../../knowledge/places.md), [population and affiliations](../../knowledge/population-and-affiliations.md), [open-world activities](../../knowledge/open-world-activities.md), [game events](../../knowledge/game-events.md), [main-story state](../../knowledge/main-story-state.md) and [save identity](../../knowledge/save-identity.md).

It absorbs design seeds DS-03, DS-04, DS-06, DS-07, DS-15, DS-29, DS-32, DS-34, DS-47 to DS-51, DS-54, DS-55, DS-57 to DS-60, DS-64 and DS-66. The shapes follow [P4](p4-seeding-layer.md) and [P5](p5-procedural-engine.md).

**How to read it.** This page says what the simulation layer is, why it is shaped this way and how it meets the other layers. S1 will say exactly how. Numbers are the dossiers' starting values, marked **[tunable]**. They live in pack data, never in code, and the evaluation work moves them. Where this page and a dossier differ, this page wins, and [§17](#17-where-the-dossiers-differ-and-the-compromises) says why. Nothing here is proof of in-game behaviour: the game-side facts are graded on the knowledge pages, and offline simulation proves nothing about the running game ([README](README.md#conventions)).

## 1. What layer 1 beyond the kernel is

The kernel holds the mechanism: identity, resolution, pins, queries, events, summaries, frames, beliefs and the record. S1 is the **content and policy** that make it a city. It decides who exists, what they do, what happens in the streets, how groups hold together, who believes what about whom, what each actor wants and how people change. It also mirrors the game, so that none of that contradicts what the game itself owns.

| S1 owns | S1 doesn't own |
|---|---|
| **The people:** population recipes, residents, households, spells, traits, archetypes, the protected set | The mechanism: draws, pins, queries, frames, the record, retention ([S0](spec/kernel.md)) |
| **The city's events:** routines, incident kinds, hot spots, aftershocks, spread, regimes | Seed language, casting, the lifecycle, the arbiter, the exposure ledger, the lint ([S2](spec/seeding.md)) |
| **Groups and order:** membership dynamics, group decisions, norms, the protection market, reputation, contracts | Sowing, sifting, fitting and the director ([S3](spec/procedural.md)) |
| **Beliefs:** attribution, telling and lying, rumour reach, the fade of what isn't kept | The game port, the senses and the verbs ([S5](runtime-requirements.md)); realising anything in game (P8) |
| **Minds:** drive urgency, importance, concerns, goals, dilemmas, NPC change | Words and rendering (S7); content-pack format and settings screens (S4, P6) |
| **The mirror:** what the game owns, read into the model; how game truth overrides simulation | Persistence bytes and save keys (S6); where S1 runs and its budgets (P7: this page gives targets) |
| **The reads, events and pins** that S2 and S3 consume ([§10](#10-what-is-minted-for-the-sifter), [§12](#12-what-s1-exposes)) | Evaluation and inspection tools (P9, P10: S1 supplies their logs and reads) |
| **The production gate** for new occurrences ([§11](#11-the-production-gate)) | Authored content (layer 4): it is S1's vocabulary and its overrides |

**Eight principles run through everything below.**
1. **The game is ground truth** ([DS-34](design-seeds.md)). S1 mirrors what the game owns and simulates only what the game doesn't. Where they disagree, the game wins and the record reconciles ([§3](#3-mirroring-the-game)).
2. **Counts first, items on demand.** Every incident starts as a count in a summary. Detail is the lazy opening of its items. One generator serves every tier, so counts agree at every tier and across reloads ([S0 §9.3](spec/kernel.md#93-summaries-and-their-refinement)).
3. **A policy is a registered function or a data table.** Packs supply tables and parameters, never code. Every constant that is a judgement is **[tunable]** and lives in pack data.
4. **The city never aims at V.** No S1 process names V as the target of a harmful effect. V is observed, never owned ([D-09](decisions.md); kernel I-12). A group's grudge against V is a belief that may raise an offer through layer 2 ([S2 §2.16](spec/seeding.md#216-city-events-as-material)). V's acts are history and change the record. V's position and attention change nothing coarse (demand independence).
5. **Built to be read, not watched.** At the dossiers' rates, an average cell sees a small incident about once in three game weeks ([dossier 14 §5.8](craft/d14-city-events.md#58-what-is-minted-where-and-when)). Most of what S1 simulates is read as news, traces, rumour and the cause of the few events that arrive. S1 keeps only what can be explained and read.
6. **Deterministic by construction.** Every draw is keyed by what it is about. No `exp`, `pow` or gamma in any decision. Windows are computed one at a time, so the period is only a batching choice ([§15](#15-determinism-and-reload)).
7. **No atoms, and nothing is modelled until something asks.** Residents are drawn, not simulated. Ties are implicit. Beliefs exist for the observed and the focal. A coarse tier holds counts, fractions and stocks ([§13](#13-tiers-demand-and-catch-up)).
8. **Simple first.** One shared period, one tie function, one mirror table, one gate. Phases 2 and 3 of the dossiers wait until phase 1's measures pass ([§19](#19-simplicity-check-and-the-first-implementation)).

## 2. The parts and their interfaces

### 2.1 Processes

A **process** is periodic, has tier and `ProcessState`, and runs under the kernel's rules ([S0 §9.4](spec/kernel.md#94-evolution)): one shared window `W_sim` (600 s **[tunable]**), run every `n`-th window, outputs applied at the end of the span, no process sees another's outputs within a span.

**Phase** says when it is built: **1** is the M3 core; 2 and 3 follow the dossiers' own first-cut orders ([S14-S1-27](craft/d14-city-events.md#111-s1-the-simulation-layer), [S15-S1-28](craft/d15-people-networks-order.md#111-s1-the-simulation-layer)). **Owes** is the `coarseFine` declaration ([S0 §9.4](spec/kernel.md#94-evolution), V4-24): the agreement between the process's coarse state and the fine state generated from it. *Exact*, *count* (a summary's count equals its items) or *distribution* with a tolerance. Reload, partition and regeneration are exact for every process, whatever it owes ([S0 I-1, I-3, I-15](spec/kernel.md#15-invariants)).

| Process | Tier | n | Phase | What it does | Owes | Patterns it must reproduce (calibrate and validate on different seeds) |
|---|---|---|---|---|---|---|
| `city.shape` | 0 | 6 | 1 | Hour and weekday shapes (pure functions of time); exogenous regime arrivals; the city budget gate for m4 events; service-point status; the flow matrix when populations change | exact | Spacing and budget of m4 (M14-18) |
| `city.events` | 1, 2 | 6 | 1 | Incidents: opportunity, propensity, counts, scopes, sizes, summaries, events, offspring and the pending calendar, heat and bands | count | M14-01, -03, -04, -05, -06, -07, -08, -09, -10, -16, -23, -24 |
| `city.tension` | 1 | 6 | 2 | Pair tension, group strength stocks, grievance along ties, suppression, police pressure, unrest, slow district variables | distribution (±10 %) | M14-11, -12, -15, -19 |
| `city.flow` | 0, 1 | 6 | 2 | Rumour fractions per district and item, reach, the feed lag, infrastructure loads (first cut: none), standing rumours, outlets' reach | distribution (±5 points) | M14-13, -14 |
| `city.mirror` | 1 | 1 | 1 | Maps the game's raw events to the city's event vocabulary; sets nothing it cannot read from the game ([§3](#3-mirroring-the-game)) | exact | M14-22 |
| `people.shape` | 0, 1 | 6 | 1 | Refits each district's joint table when a field moves past a threshold; publishes it as a `Table` contribution with provenance | distribution (marginals within 3σ) | M15-01, -02, -03 |
| `order.norms` | 1 | 6 | 1 | Norm state per district: private support, behaviour, perceived behaviour; band pins; enforcement events | distribution | M15-11, -12, -13 |
| `order.stocks` | 0, 1 | 6 | 1 | Efficacy, cynicism, police legitimacy; the protection market; regimes (shared with `city.shape`) | exact | M15-14, -20, -21 |
| `order.ledger` | 1 to 4 | 6 | 1 | The gist step for districts; reputation pins on band change. Event-driven parts run as policies ([§2.2](#22-policies)) | distribution (aggregate against residents) | M15-15 to -19, -22 |
| `order.contracts` | 2 to 4 | 6 | 2 | Hazard of deviation for opened or storied contracts; counts for the rest as summaries | count | M15-23, -24 |
| `order.members` | 1, 2 | 6 | 2 | Joiners, drift, exits, defections and cascades, succession; strength update | distribution | M15-25 |
| `group.decide` | 0 to 2 | 6 | 1 (two groups) | Group drive urgency, operative weights, leadership decisions, orders ([§8.6](#86-group-decisions)) | exact | Drive fixtures D-a to D-n ([dossier 1 §13.7](craft/d01-motivation-drives.md#137-calibration-fixtures)) |
| `scene.acts` | 3, 4 | 1 | 1 | The fine tier: opens summary items inside a root's focus into events with people and acts; routine acts of focal people. Runs only where demand reaches ([G-7](craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged)) | count | M14-16 (items in focus equal the summary's) |

`city.mirror` and `scene.acts` run every window. The rest run once per game hour, each computing its six windows one at a time. The period is a lineage constant. A coupling between processes has a one-span lag (an hour), and for `city.mirror` ten minutes.

### 2.2 Policies

A **policy** is event-driven. It runs behind a kernel hook, a relevance emission or a worklist, and it keeps no schedule of its own.

| Policy | Driven by | Tier | What it does |
|---|---|---|---|
| `urgency` | Resolution of a `core:drive-state` window | 1 to 4 | Derived urgency from timestamped facts and the query time ([§8.3](#83-urgency)) |
| `frames` | Demand: a root's focus reaches an actor | 2 to 4 | Opens drive, concern, goal and situation frames for that actor and closes them when demand leaves ([§8.1](#81-drives-as-data-and-frames-on-demand)) |
| `v.frames` | The mirror | 3, 4 | Opens V's situation and game-tracked goal frames; never V's drives ([§8.8](#88-vs-frames)) |
| `concerns` | Relevance emissions on drive and concern frames | 3, 4 | The seven concern generators, with hysteresis ([§8.4](#84-concerns-and-goals)) |
| `goals` | A concern opening; frame worklist | 3, 4 | Choose a means, commit, reconsider ([§8.4](#84-concerns-and-goals)) |
| `dilemma` | `Dilemma` emissions | 3, 4 | Resolves by one of four strategies; the option prior for orders ([§8.5](#85-dilemmas-and-the-conflict-table)) |
| `witness` (`onWitness`) | Observation of an event | 3, 4 | Perception, salience, memorable-by-rule, attribution ([§7.1](#71-witnessing-and-attribution)) |
| `social` (`onSocial`) | A telling | 3, 4 | What is told, with what change; mints the telling event ([§7.2](#72-telling-and-lying)) |
| `fade` (`onTick`) | Every processed boundary, per believer | 3, 4 | Drops non-memorable beliefs after their hold time ([§7.5](#75-forgetting)) |
| `aggregate` | A read | any | Reputation over carriers' beliefs ([§6.5](#65-reputation)) |
| `change` | Relevance on a held-view frame; `Dilemma`s | 3, 4 | NPC change: pressure, thresholds, `turning` events ([§9](#9-npc-change)) |
| `ties` | Pair queries; casting | 2 to 4 | `tie`, `neighbours`, `bridge`; materialisation ([§6.1](#61-ties-and-bonds)) |
| `reconcile` | A load, a jump, a mirror correction | 0 to 2 | Reconciles the record with the game ([§3.4](#34-reconciling-on-load-and-on-a-jump)) |

### 2.3 The doors

**In to S1:**

| From | What | Where defined |
|---|---|---|
| S5 (the game port) | The twelve event kinds and their ring, the facts watch list, V's state, the district and interior reads, the NPC read for people V can see, the community slot read, the session lifecycle ([game events §12](../../knowledge/game-events.md#12-recommended-minimal-hook-set-for-a-first-event-feed)) | S5; [runtime requirements S1 to S6](runtime-requirements.md) |
| The world index (W1) | The 32 place dimensions as `game`-layer contributions and mirrored nodes, built offline from the installed game and mods ([places §12](../../knowledge/places.md#12-place-dimensions-for-the-world-index-w1)) | W1; [§3.2](#32-what-is-mirrored-and-how) |
| S4 packs | The kind registry, drive catalogue, ethos vectors, archetypes, norms, ladders, means library, name lists, outlets, tone-neutral registries ([dossier 17 §13.2](craft/d17-setting-tone.md)) | S4 |
| Settings | `cityScale`, `classExclusions`, `content`, `memoryScale`, `resetScale` in force at each op ([S0 §14.2](spec/kernel.md#142-records-and-branching)) | S0; P6 |
| The kernel | Snapshots at each boundary, relevance emissions, dilemmas, belief hook calls ([S0 §9.4, §10.5, §11.2](spec/kernel.md#94-evolution)) | S0 |
| S2 | Live casts (`core:cast` edges from live seeds): the protected set. V's accepted offers and responses arrive as observed events | S2 |

**Out of S1:**

| To | What |
|---|---|
| S2, S3 | Events and pins (the Change stream, [§10](#10-what-is-minted-for-the-sifter)); the registered reads ([§12](#12-what-s1-exposes)); the registries `producers`, `isSpine`, `aesthetic` |
| The kernel | The belief hooks, the process registrations with `coarseFine`, the conflict table, the perception policy |
| S7 | `commonGround`, the `witnessed` and `told` sets, event `reportability` inputs, intent records for focal people |
| P8 | Realisation candidates: (kind, place, period) to route classes, with a cause on each |
| P9, P10 | The decision log, the pattern register, per-process counters, the "why" traces |

### 2.4 One convention between processes

Processes never see each other's outputs inside a span. After the boundary they read the snapshot. To make that cheap, each process **publishes a digest** in its `ProcessState` when its batch applies: counts per (scope, kind, size), the ids of its m2-and-above events, the band changes, the stock values. Other S1 processes read digests, never raw nodes, and never another process's private state. The digest is plain data, versioned with the process. This needs one small kernel clarification ([§16](#16-what-the-kernel-and-the-other-specifications-still-need), K-2).

### 2.5 What S1 writes, at which precedence

| What S1 writes | Form | Layer and precedence |
|---|---|---|
| Anything a seed, an author or the game may override: routines, presence, places, propensities, population tables | `Table`, `Set` or `Field` **contribution** | `simulation`, 200 |
| Time-windowed state that only S1 writes: urgency, bands, labels, stocks, regime flags | **Pins** on simulated temporal slots, written by a process | reason `committed`, 300 ([SPEC-NOTES 18](../../projects/xf-story-engine/reference/SPEC-NOTES.md)) |
| Ties and memberships | Edges with a cause | edges carry no precedence |
| Beliefs | Belief records through the hooks | beliefs never constrain the world |
| Events and summaries | Minted nodes with a cause | n/a |

The split is deliberate. A process pin at 300 would tie with a seed's commitment at 300 and the lower `Id` would win, which is arbitrary. So S1 pins only on slots that no other layer writes, and uses 200-level contributions for everything else.

## 3. Mirroring the game

The game owns a great deal of what S1 would otherwise invent. The foundation says the game arrives as pins and contributions with the game as their source ([foundation §7](foundation.md#7-how-the-layers-map-onto-it)). This section says which parts of the world are the game's, which are only partly the game's, and how a disagreement ends.

### 3.1 Three ownership classes

| Class | What it is | Examples (graded on the knowledge pages) | S1's part |
|---|---|---|---|
| **G. Game-owned** | The game holds it, and the game's value is the value | Time and weather; V's state; quest facts and journal states; heat; the district V is in; named, fixer, vendor and quest characters (spawn sets, `quest` priority, `savable`); the game's own incidents (gigs, hustles, combat events, police response); street cred ([main-story state](../../knowledge/main-story-state.md), [population §8](../../knowledge/population-and-affiliations.md#8-persistent-and-ephemeral), [open-world §6 to §7](../../knowledge/open-world-activities.md)) | Mirror it. Never write it |
| **H. Hybrid** | The game holds the slot; S1 supplies the person | Street population: a community entry says how many, where, when, which faction and look pool, and the game re-rolls the bodies on each sector load ([population §8](../../knowledge/population-and-affiliations.md#8-persistent-and-ephemeral)) | Draw a resident consistent with the slot; bind by key; pin `observed` on notice ([§3.5](#35-binding-people-to-bodies)) |
| **S. Simulation-owned** | The game records nothing about it | Off-screen incidents; ties; beliefs; norms; reputation; group strength; routines of unplaced people; rumours; tension; price level; the slow district variable | Simulate it, from game data where the game gives any trace ([places §8](../../knowledge/places.md#8-how-a-places-character-is-recorded)) |

The partition does most of the work. If S1 never writes class G and never contradicts what the game places in class H, there is little left to reconcile.

### 3.2 What is mirrored, and how

| Source | Becomes | Mechanism | Feed or data |
|---|---|---|---|
| Time, weather | `GameTime`; a mirrored `weather` slot on the city node | Readings ([S0 §6.3](spec/kernel.md#63-time-varying-slots)) | `time` feed kind; a poll |
| Quest facts | `core:game-fact` nodes, `H("game", "fact:" + n)`; the main-story table's 93 facts and about 25 watched by default ([main-story state §8](../../knowledge/main-story-state.md#8-evaluating-a-story-window-on-a-save), [facts table](main-story-facts.json)) | Readings. A fact never set reads 0, so "alive" read as `_dead == 0` is also true before the event: windows use the guards of [S2 §2.7](spec/seeding.md) | `fact` |
| Journal and gig state | Facts, and mirrored journal-entry nodes keyed by path hash | Readings; outcome events (`*_finished`, `*_failed`) | `journal`, `fact` |
| V | The root node `v`: mirrored slots for position, district, vehicle, wanted level, health, street cred, money, appearance tags | Readings. V's choices enter only as observed events ([I-12](spec/kernel.md#15-invariants)) | `session`, polls |
| Districts and places | The place tree, polygons with vertical bands, place keys, presets, services, points of interest, spot supply | `game`-layer contributions and mirrored nodes, built offline by W1 with the smallest-area-with-z rule ([places §3.2](../../knowledge/places.md#32-how-the-game-knows-where-v-is)) | W1; `district` for V's own position |
| Population slots | Community instances and entries as casting types per cell and period: faction class, kind, gender suffix, look pool | `game` contributions on the block's residents table ([§4.2](#42-cells-and-the-population-recipe)) | W1 (registry, TweakDB) |
| Named and persistent characters | Mirrored nodes `H("game", gameKey)`; mirrored `position`, `alive`, `affiliation`. S1 holds beliefs about them and ties, nothing the game records | Readings; the protected set | `death`, `fact`, NPC read |
| Heat and police | The `wanted_level` fact; the district's prevention preset | Readings; `police-action` events by rule | `heat` |
| Deaths and combat | Raw game events, then derived city events ([§3.3](#33-two-levels-of-event-and-what-the-gate-does-to-them)) | External events, then `city.mirror` | `death`, `combat` |
| Gigs, hustles | Outcome events and district counters | Facts through the journal and fact hooks | `journal`, `fact` |
| Services | Vendors, ripperdocs, fast-travel points; refuge status derived ([§5.3](#53-regimes-the-slow-variable-and-service-status)) | Static contributions; status pins | W1 |
| Save and load | The load class, then replacement of branch-local state | [S0 §14.3](spec/kernel.md#143-loading-is-replacement); the pin from the [save key](../../knowledge/save-identity.md#the-story-engines-save-key) | `session` |

**Mods and frameworks.** Other mods' places, characters, communities and records take part through the same readers: the generic resolver, the world index with its mod overlay (dimension 32) and TweakDB. S1 holds no per-mod code, table or branch ([AGENTS.md](../../AGENTS.md#architecture-contract)). NPCs that mods spawn are ephemeral unless a spec asks otherwise ([population §8](../../knowledge/population-and-affiliations.md#8-persistent-and-ephemeral)), so S1 treats them as class G and unmodelled until observed. A missing record or hook never raises an error: the read answers `maybe`, and the user sees plain words through S2's capability report.

### 3.3 Two levels of event, and what the gate does to them

The port submits **raw game events** as external events of kinds the game defines (`game.death`, `game.combat`, `game.heat`, `game.district`, `game.journal`). They are records of what the game did. They are kept as they are, never filtered or edited ([S0 §9.2](spec/kernel.md#92-events)).

`city.mirror` reads those and mints **derived city events** in the city's own vocabulary, by one table:

| Raw game event | Derived event, kind and size by rule **[tunable]** |
|---|---|
| A death (victim record, `by_v`, district, affiliations) | `assault` or `gang-clash` by the affiliations involved; m1 for an anonymous civilian or fighter; m2 where a named group loses members or there are witnesses |
| A heat change (stage, reason) | `police-action`; m2 at stage 3 and above |
| Combat start and end near V | `gang-clash` of the factions fighting; m1 to m2 |
| A gig or hustle outcome | An outcome event with the district; the district's counters mirrored |
| A district entry | Not an event. Demand and context only |

A derived event cites its raw event as `cause`. It carries the tag `mirrored`. The production gate does not refuse it, because it re-describes something the game did, not a new occurrence. What V is shown of it is filtered at display, as for any event ([S2 §2.19](spec/seeding.md#219-content-classes-ceilings-and-floors)). The sifter reads both levels and can tell them apart.

### 3.4 Reconciling on load and on a jump

A load is replacement ([S0 §14.3](spec/kernel.md#143-loading-is-replacement)): branch-local state is dropped, the branch's ops are replayed silently, and the game's own state is read and becomes `game` readings at the current time. `reconcile` then runs, in this order:

1. **Diff** each assumption S1 holds against the game's readings. An assumption is a frame of a mirrored actor, a membership of a mirrored person, a pending-calendar child at a cell, or a routine pin on a mirrored node.
2. **Supersede what the game now contradicts.** A mirrored person the game says is dead gets their frames set `abandoned` and their edges ended. A pending child whose cell the game now covers by its own event is thinned, with the reason recorded.
3. **Leave beliefs alone.** A belief is not truth. People may still believe the dead person lives. That divergence is story material, not an error ([foundation §5.4](foundation.md#54-perspectives-everyone-has-their-own-model)).
4. **Log** every correction in a bounded ring of `mirror.correction` records. They are for the friction log and P10, and they never reach V.

After a **jump** (a sleep, a time skip, a fast travel, a long absence) the coarse tiers replay every missed boundary in order, and fine tiers regenerate from the coarse state ([§13](#13-tiers-demand-and-catch-up)). A jump reads the game's clock; it is a session input, never a draw key.

### 3.5 Binding people to bodies

The game never creates a street person from nothing. It switches on communities that already exist and draws bodies from their entries and spots, and it re-rolls them on every sector load. S1's resident is therefore a **model person** that a body may stand for.

- **Binding is by key.** `(community instance, entry, spot, ordinal)` selects a resident of the block whose casting type fits, by a keyed draw ([S15-S1-05](craft/d15-people-networks-order.md#111-s1-the-simulation-layer)). The same key gives the same resident after a reload.
- **A resident is pinned `observed` when V notices them**: a scan, a conversation, a hit, a name heard. Until then no body is identified.
- **S1 hands P8 a stable `look key`** for each resident, so that the realiser can choose among the casting type's looks the same way each time. Whether the game lets it is P8's question. The identity is S1's.
- **If the key is unreadable or unstable across loads,** the binding falls back to the session: the port's runtime entity id maps to a resident until the next load, and the resident is re-found only when V meets them again. This is [open question 3](#18-open-questions-for-s1), and the first in-game session settles it ([dossier 15 §12.3](craft/d15-people-networks-order.md#123-in-the-game-one-prepared-session-the-maintainer-runs-it)).

### 3.6 Where game truth overrides simulation

| Situation | Rule | Why it holds |
|---|---|---|
| Both have a value for a mirrored slot | The game's reading wins; mirrored slots are never sampled | [S0 §5.1](spec/kernel.md#51-the-order-of-steps) step 2 |
| A simulation contribution conflicts with a game-derived one | Arbitration rejects the lower | `game` 500 against `simulation` 200 ([S0 §4.1](spec/kernel.md#41-the-contribution-record)) |
| S1 would produce a harm to a game-owned or protected person | The gate refuses it | [§11](#11-the-production-gate) |
| The game later contradicts something S1 put in the record | `reconcile` ends S1's assumption; history stays history | [§3.4](#34-reconciling-on-load-and-on-a-jump) |
| The game covers a kind of incident in a place by its own content | The sim's rate there is scaled down by a **static** coverage factor from the world index | Below |
| The game's own incident happens | The mirror mints it; S1's pending children in that cell are thinned | [§5.2](#52-incidents) |
| Time moves backwards (an older save) | A load, so replacement; no rollback logic in S1 | [S0 §14.3](spec/kernel.md#143-loading-is-replacement) |

**Coverage is static, and ownership now is not read by the coarse tiers.** Dossier 14 marked a cell "game-owned while its community is active". That depends on where V is, which would make the coarse history depend on V and break demand independence (M14-20). So S1 splits it:
- `gameCoverage(cell, kind)` is a static figure from the world index (dynamic events, combat-event communities, hustle pins, guard areas: dimensions 16, 21 and 27). It lowers the rate for that kind in that cell, whoever is near. It is the share of the kind the game already covers.
- `gameOwnedNow(cell)` is a dynamic read ("the game's community there is active"). Only realisation (P8) and `scene.acts` read it, to avoid showing a simulated incident where the game is already running its own. A lint forbids any coarse process from reading it.

**One more rule: the simulation never needs the game to be present.** With no feed (the offline prototype, or a game without the hooks), S1 runs on its own schedule with `gameOwnedNow` unknown, and the mirror simply has less to mirror. The same code runs against the offline port ([D-18](decisions.md)).

## 4. Who exists

Nobody is simulated until something asks. A resident is a pure function of the world seed, the block's recipe and the resident's identity, so a person can be dropped and drawn again unchanged ([S0 I-3](spec/kernel.md#15-invariants)). Only pins, observed facts and committed seeds persist ([DS-48](design-seeds.md)).

### 4.1 The world index slice

S1 reads the place dimensions that carry people, danger and time. It reads them as `game`-layer contributions and mirrored nodes, built offline once per installed game and mod set.

| Dimension ([places §12](../../knowledge/places.md#12-place-dimensions-for-the-world-index-w1)) | Used for |
|---|---|
| 3, 4, 5: district path, polygon with vertical band, place key | The place tree; which leaf a point belongs to; joins by name key |
| 16: gang presence by area | Offenders, and the pair index for group violence. From the cast of the communities and dynamic events whose spots lie in the area, never from the region's gang list ([places §9.3](../../knowledge/places.md#93-gang-presence-by-area)) |
| 17, 18: style and wealth, population by period | Targets; the resident mix; the hour shapes |
| 10, 11, 20, 27: police preset and suppression, security installations, ambient staging | Guardians; response lag |
| 21, 24, 26: points of interest, services, spot supply | Targets, propensity, the cast of a cell |
| 7, 8: indoor flag and restrictions | Who can witness; venue cells |
| 22, 23, 29: quest footprint, home district, gig tiers | Which cells the game's own content covers; price anchors |
| **Not used:** 12 crime multiplier, 15 region gang list, 28 level scaling | The multiplier scores V's crimes and is 1.0 almost everywhere; the list feeds only the map's panel; enemy level is V's ([dossier 14 §5.3](craft/d14-city-events.md#53-opportunity-the-three-fields-from-the-place-dimensions)) |

There is no field called wealth, danger or influence in the game ([places §8](../../knowledge/places.md#8-how-a-places-character-is-recorded)). S1 derives them, each with its rule recorded and its source marked `derived`. The same rule applies to any district, a mod's included.

### 4.2 Cells and the population recipe

**Cells.** A cell is the finest place S1 counts incidents in: block-sized (about 200 m **[tunable]**), nested under a leaf area, with each venue (an interior area with a venue record) cut out as its own cell. The cut is made by the index, not at run time: a grid clipped to the leaf's polygon and vertical band, then the venues. A cell's id is `H("gen", leaf, "cells", i)` in a fixed grid order, so it never moves while the polygon and the constants hold. The dossier's citywide count of about 7,000 cells is a guess ([dossier 14 §1](craft/d14-city-events.md#1-scope-and-why-it-matters-here)). The index build gives the real figure.

**The recipe.** For each district S1 holds a joint table over a few attributes (age band, role, income band, affiliation class: about 2,300 cells, below `N_enum`). It is fitted by iterative proportional fitting with a fixed 20 iterations and a floor on every cell, to marginals the index supplies: age structure, role and income shares, the district's affiliation shares. `people.shape` refits only when a field moves past a threshold, at most once a game day, and publishes the table as a `Table` contribution with provenance. The refit costs about 184,000 operations per district, which the process budget counts ([dossier 15 §5.2](craft/d15-people-networks-order.md#52-the-population-recipe-and-the-residents)). A household table sits beside it. The role table carries a share of independents per sector, with their own foci. A fit that would exceed `N_enum` is refused at load.

**Headcount.** The game's entry quantities count authored slots, not people met ([places §9.3](../../knowledge/places.md#93-gang-presence-by-area)). A block's headcount is its share of the district's entry quantity times a district scale `ρ` **[tunable]**. Both the scale and the block shares are index data, so they can be changed without code.

**Casting types are constraints.** A community entry says faction class, kind (crowd, street, story), gender through the template suffix, and whether the character is a child ([population §7](../../knowledge/population-and-affiliations.md#7-what-a-character-record-tells-us)). For a resident bound to that slot ([§3.5](#35-binding-people-to-bodies)) these are `game`-layer constraints. For the unbound, the recipe's marginals are built from the same shares, so the distribution agrees with the game's without any per-resident rule.

### 4.3 Residents, households, spells and traits

- **A resident** is member `i` of a block's `residents` slot, `H("gen", block, "residents", i)`. Its slots are drawn by the flat draw over the block's table ([S0 §5.4](spec/kernel.md#54-the-draw-flat-gumbel-max)). A household is drawn first, and its members are drawn under constraints on ages, kin edges and headcount. Dependants are a count that a pack kind opens when a story needs one.
- **Spells.** A life is a set of overlapping spell tracks (residence, work, partner, health). Each is a renewal sequence from keyed inverse-cumulative tables, so there is no `exp`. State at `t` is a cached walk of at most a dozen steps. A story event, such as a death, pins over it. A 20-day wait therefore costs nothing ([dossier 15 §5.3](craft/d15-people-networks-order.md#53-lifetimes-as-keyed-spells)).
- **Age** is a sampled integer and does not advance with `t`. Across a playthrough of months that rarely matters. A derived `age-at(t)` replaces it only if a lineage needs it ([open question 11](#18-open-questions-for-s1)).
- **`ageClass`** is `adult` or `minor`: derived from age for generated people (adult at 18), mirrored from the game's child flag for mirrored people, declared for pack people. A missing reading counts as `minor` in every floor check ([S0 §2.6](spec/kernel.md#26-the-core-schema)).
- **Traits drawn from the persistent id,** three coarse levels each, keyed `("trait", person, name)`: `stability` (most NPCs high), `memory` (most typical), `sociability` (scales far ties). An author may fix any of them for a named person ([S10-S2-15](craft/d10-change-theme-payoff.md#111-the-seed-language-s2)).
- **Archetype** is chosen by weighted sampling from the actor's affiliation class, district and community entry, with authored overrides. It is a role in the world model, never a demographic. The game's look tags (`StreetVendor`, `Corporat`, `Gangster`) are hints for the mapping, which is a hypothesis ([population §7](../../knowledge/population-and-affiliations.md#7-what-a-character-record-tells-us)).
- **Names** come from the pack's registry: an `origin` drawn by district and affiliation shares, then `given` and `family` conditioned on it (`enum-by`). Origin feeds no drive and no policy ([§4.5](#45-source-lint-and-the-representation-audit)).

### 4.4 The protected set, canon people and the spine

**The protected set** is what harm events and absences choose outside of:
- the cast of every live seed (the `core:cast` edges S2 holds);
- canon characters V has met, or that the game's facts need;
- pinned entities, and anyone a pack flags essential.

It is read from the kernel, not stored: cast edges, `observed` pins, mirrored spine flags. The gate enforces it ([§11](#11-the-production-gate)).

**Canon people** are mirrored nodes. S1 holds beliefs about them and ties with V, and nothing the game records about them. The change engine moves only what they believe about V and their ties with V, unless an author declares a turn ([S10-P5-23](craft/d10-change-theme-payoff.md#112-the-procedural-engine-p5)).

**`isSpine(node)`** answers whether a node is a canon character of the main story. Its data are the characters whose fate the game's final boards read ([main-story state §4](../../knowledge/main-story-state.md#4-characters-whose-state-the-game-tracks)), joined to the mirrored nodes.

### 4.5 Source lint and the representation audit

- **Source lint.** Attributes that feed `core:drive-state` come only from affiliation shares, ethos, circumstance and spells. The age prior is a modifier on importance priors, never a gate. Heritage, gender and name origin are never inputs ([DRV-11](craft/d01-motivation-drives.md); [S15-S1-06](craft/d15-people-networks-order.md#111-s1-the-simulation-layer)).
- **The audit** tabulates who is cast as offender, informer or victim, and openness, bid rates and loyalty, by every tag, and counts authored relationship rules per kind, over sampled populations, and reports to dossier 18 (M15-27, M18-06 to M18-10). It runs on the first S1 population, to set thresholds from data.

## 5. Routines and the city's events

### 5.1 Routines

- **Game-placed people keep the game's position.** The game puts a vendor at a workspot at stated times. S1 holds that person's concerns and beliefs, not their position. The tracked-person schema (anchors, radius, motif, `gamePlaced`, `protected`) has an engine routine only for ids the game does not place ([S14-S1-19](craft/d14-city-events.md#111-s1-the-simulation-layer)).
- **Everyone else's whereabouts are derived, not stored.** `where(person, t)` is a pure function of the person's spells, an archetype schedule class, the period shape and a keyed absence draw per visit-day, `rand("absent", person, day)`, with a cause taken from state (an illness spell, a closed stall). Nothing is ticked.
- **Pulses** are a calendar of recurring things (kind, scope, period, time of day, jitter) with a declared consequence for a miss: a Friday protection collection, a market delivery, a shift change.
- **`reachable(from, t1, to, t2, mode)`** works over polygon centroids, vertical bands, metro and fast-travel nodes, with mode speeds as data and a district speed field. It lets casting and fitting ask whether someone can be there, and lets an alibi be checked.
- **Routine baselines for wrongness.** For nodes the engine will use as wrongness material (a stall's hours, a corner's crowd), S1 exposes the routine and a deviation flag with a recorded cause ([S17-S1-10](craft/d17-setting-tone.md#133-s1-world-data-that-seeds-the-simulation)).
- **Time constants are in game time.** The ratio of game time to real time is unmeasured ([dossier 14 open question 1](craft/d14-city-events.md#10-open-questions)). Measuring it is the first row of the in-game session ([§18](#18-open-questions-for-s1)).

### 5.2 Incidents

`city.events` is the heart of the city's life. Its design is [dossier 14 §5](craft/d14-city-events.md#5-models-the-engine-could-run). P3 fixes what S1 takes from it and what it changes.

| Part | Rule | Notes |
|---|---|---|
| **Kind registry** | Event kinds are pack data: tags, effects from [S0 §10.8](spec/kernel.md#108-effects-and-cross-pressure), size range, driver weights over place dimensions, the four-period hour shape, the interaction-matrix row, offspring tables, carriers and durations, realisation routes, spread reach by size, and **content class and intensity by form** ([§11](#11-the-production-gate)). S1 ships the ten-kind core catalogue (`theft`, `assault`, `gang-clash`, `shakedown`, `police-action`, `psycho-break`, `disorder`, `accident`, `outage`, `commerce`) | Lints: no ambient kind with mean offspring at 0.9 or above; no kind without a producer, a carrier or a class listing; no driver naming an absent dimension or the crime multiplier |
| **Opportunity** | `A = targets × (base + offenders) × (1 − guardians) × propensity`, for a cell, kind and period. One citywide rate per kind sets the pace. The fields set where | The offender term comes from affiliation roles and the flat base term, never from status tags or demographics |
| **Game coverage** | `A` is multiplied by `(1 − gameCoverage(cell, kind))`, a static figure ([§3.6](#36-where-game-truth-overrides-simulation)) | Replaces dossier 14's "game-owned while active" |
| **Propensity** | A keyed log-normal quantile table, spread about 1.6 **[tunable]**, times a bounded weighting of the cell's features. The persistent hot list is the top cells, at most 64 per district. A function of (world seed, place `Id`, features) only | Constants computed offline, so no `exp` at run time |
| **Counts** | Per window, district and kind: cumulative `−ln` spacings from `Λ·W` (a Poisson count by `ln` and addition only), capped at 64 and split across scopes first. Scope by inverse-cumulative shares; size by the ladder table | A larger mean than the cap is split, never dropped |
| **Summaries and events** | One summary per (scope, kind) with a non-zero count, scoped to a cell for persistent and live hot cells and to the district for the remainder. Events are minted individually from size m2 up, and for children of an m2 parent | Size is the reach of consequence, not severity |
| **Offspring and the calendar** | Offspring drawn at birth from tables (mean by size, dispersion about 0.3, at most 8 children, bin then window, kind from the matrix, size, place, roles); the calendar is ordered by (due window, parent `Id`, index), capped at 256 per district; thinning at fire time; a child never fires before the window after its parent's | Overflow folds the lowest-size children into counts in `Id` order and logs a defect |
| **Heat and bands** | Read off the calendar and the ring, not tracked beside them. Four bands (quiet, elevated, hot, flashpoint) with enter and leave thresholds and a one-game-day minimum dwell. A band pin is written only on change; heat numbers never leave the process | The band is the S2 predicate ([S2 §2.16](spec/seeding.md#216-city-events-as-material)) |
| **The ring** | The last seven game days of event and summary descriptors with their parent links **[tunable]**, so a re-minted summary and a cause chain of at most four links can be recovered | In `ProcessState` ([§15](#15-determinism-and-reload)) |

**The size ladder** ([dossier 14 §5.2](craft/d14-city-events.md#52-event-kinds-and-their-drivers)) gives the Change volume. m1 incidents are items of a summary and produce no Change. m2 and above are events with causes and a Change. The ladder's citywide rates are starting values **[tunable]**: about 300, 45, 6 and under 1 per game day for m1 to m4. m5 is authored only. S1 keeps the Change stream to about ten per game hour for the whole city ([S14-S2-03](craft/d14-city-events.md#113-s2-p5-and-p9)).

**Offenders and targets come from the cell's cast.** The people of an event are drawn from the cell's residents and the game's community cast for that cell, by role (aggressor, victim, witness, responder). Named persons are used only where the protected set allows. V is never drawn as a target ([§11](#11-the-production-gate)).

**A group's goals reach the city by weight.** A group's active goal, such as collecting a payment, adds a weighted contribution to the offender term of the matching kind for that group in its cells. That is how `group.decide` ([§8.6](#86-group-decisions)) and `city.events` meet, with no special mechanism.

### 5.3 Regimes, the slow variable and service status

- **Regimes** are nodes with a kind, scope, start, planned end, size, an effect table and an exit hazard that rises with age and a maximum dwell. They arise from exogenous keyed arrivals, a flashpoint band held for a set time, unrest and cascades. Every regime kind declares its exit. Dossier 15's three-flag regime label per (district, group) uses the same node ([S14-S1-14](craft/d14-city-events.md#111-s1-the-simulation-layer), [S15-S1-18](craft/d15-people-networks-order.md#111-s1-the-simulation-layer)).
- **The slow district variable** runs from decay to gentrification as a slow temporal slot, with a per-week step cap and a declared marker per change. Authored identities are `game` pins and never drift. It is phase 3.
- **Corporate procedure load** per leaf is a count of the permits, waivers and checkpoints that affect it, from the zone and institution registries. Phase 3.
- **Price level** is a district multiplier anchored to the gig pay medians and street-cred tiers, banded for reads ([S17-S1-05](craft/d17-setting-tone.md#133-s1-world-data-that-seeds-the-simulation)).
- **Service status** is a banded status (open, quiet, watched, closed) for service points and safehouses V used, with substitutes. It follows regimes and events at that cell. Home is never changed ([S17-S1-11](craft/d17-setting-tone.md#133-s1-world-data-that-seeds-the-simulation)).

### 5.4 Tension, suppression, police and unrest (phases 2 and 3)

| Part | Rule | Phase |
|---|---|---|
| Pair tension and strength | `T` per group pair with border contact: raised by a table step per event and by grievance, retained by a directly set constant per window, a slow input to the clash rate. A strength stock per group and district: casualties deplete it, recruitment refills it, clash productivity follows the smaller side. Wars end by exhaustion or an exit rule | 2 |
| Grievance | Passes along membership and kin edges, 0.5 per hop to two hops, after a lag of one to several game days | 2 |
| Suppression | Thins pending children at the cell and its neighbours for a lull, lowers the pair tension by a step, draws displacement (26 %), diffusion (27 %) or none **[tunable]**; displaced weight is always below the suppressed weight | 2 |
| Police pressure and reports | A district state that returns to its preset, moved by reported minus expected incidents. A report is a separate keyed draw from an occurrence, using the report chance ([§6.4](#64-order)). The record feeds only a bounded dial | 2 |
| Unrest | An active share per district through a fixed number of iterations of a table-driven threshold curve, with hysteresis; entry and exit as a regime | 3 |
| Infrastructure | **First cut: exogenous `outage` events with district modulators, and no graph.** Load and capacity graphs come only if the sifter shows they matter | 3 |

### 5.5 Realisation candidates

S1 does not spawn anyone. It publishes, for each (kind, place type, period), the **routes** by which an incident could arrive in view, and P8 chooses and executes. The routes are few, because the game never creates a person from nothing: it switches on communities and spawners by node reference ([open-world §7](../../knowledge/open-world-activities.md#7-how-activities-spawn-their-people)). They are the scanner-hustle pins, the combat-event and dynamic-event communities, city-scene vignettes, chase vehicles by faction, and the bridge's own spawn route. The default route is **none**: offscreen, with a trace.

Each row names its route class, a cost class, a safe radius and view test, and a budget per game hour **[tunable]**, and every realised event cites its cause. S1 owns the **table's data**. P8 owns running it and the spawn budget. The table is the same one dossier 20 calls the stage-kit family table (STG-01), so there is one table, not two. A retaliation aimed at V is never realised from this layer.

## 6. Ties, groups, norms, order and reputation

### 6.1 Ties and bonds

**The tie function.** Most ties between ordinary people are never stored. A tie is a symmetric keyed draw on a pair ([dossier 15 §5.4](craft/d15-people-networks-order.md#54-the-implicit-tie-function-and-its-foci)):
- `p_geo`: by walking-order rank over cumulative headcount, made symmetric;
- `p_foci`: `1 − Π(1 − p_f)` over shared foci, `p_f = min(1, k_f / (n_f − 1))`, with `k_f` a table by focus type (a household gives near-certainty, a crew cell about 0.3 of the cell, a market row a few neighbours);
- `p_far`: far ties by a keyed involution. **Phase 3.** The first cut has none and lets city-wide foci supply the bridges.

`tie(a, b) = rand("tie", min, max) < p`. **Foci** are rosters the engine already has: a household, a `core:member-of` group, a workplace or a market row, a clinic, a bar. **Layers** follow the strongest shared focus, with opened-tie budgets of about 5, 15, 50 and 150 per person. These cap how many ties are *opened* for one person, not how many exist. `neighbours(a, layer, cap)` enumerates `a`'s foci rosters, each capped, then blocks outward by rank. Every call counts in the shared allowance and has a hard cap per roster.

**Triadic closure needs no rule.** Shared foci give closure: a person who knows two members of a crew is likely to know a third because they share the crew's focus. S1 adds no closure process. The sifter finds unbalanced triads as patterns ([§17](#17-where-the-dossiers-differ-and-the-compromises), declined).

**Materialisation.** A tie becomes an edge when V observes it, a belief about it is formed or told, a goal frame uses it, or a seed casts through it. It is a pack tie edge with cause `sampled`, keyed by the pair, `H("edge", type, min, max)`. A per-person cap of about 20 materialised ties keeps retention bounded. Kernel implicit edge types are deferred ([S0 §0.2](spec/kernel.md#02-the-first-implementation)), so S1 ships `tie` and `neighbours` as pure registered functions, exposes `tied(a, b, type)` and the foci rosters as reads, and S2's casting opens a bounded candidate set first ([S2 §2.17](spec/seeding.md#217-people-order-and-reputation-as-material)). The tie function never reads a reputation ledger.

**Position.** For a person with contact shares `s_f` over foci, `bridge(p) = 1 − Σ s_f²`: near 0 inside one cluster, large across several. A fixer is a person with high `bridge` across at least three clusters of different class. **Covert effects** (phase 3): a secret edge counts for the tie function only inside its cell, the reach of items carried by secret ties is scaled down, and a cell's size is capped by the group's `secrecy` drive.

**The tie record** is [dossier 2 §8](craft/d02-relationships.md#8-the-tie-record-a-proposal), reduced for the first cut:
- **Coarse:** `{ kind, status, strength, last_contact }`. Kinds are non-exclusive. Opening a tie derives the four parts of strength (time, emotional intensity, intimacy, reciprocal services) and the full record from the history. Closing keeps the pins.
- **Two directed regard records.** For a tie with V, **only the NPC's side exists**. S1 holds no record of V's regard or desire (D-09, I-12).
- **Quality and currency are derived** from timestamped facts, with a pin only when a bucket changes. Jump and tick agree.
- **History and novelty.** The tie keeps a list of event ids with salience and reason. Salience rises for acts that touched the NPC's concerns and for acts V returned to, and trivial entries fade. A `last_novel` time lets S3 prefer a novel shared activity for a flagging tie. A `via` field names the memberships a tie runs through.
- **Rivalry and mentorship.** Rivalry salience is derived from similarity, proximity and contest history, and may be one-sided. Mentor phases and functions are tie-kind data, and separation is an expected exit. Phase 2.
- **Trust** is three scalars with an evidence count, an attribution on each breach event and repair rules by attribution. **Commitment** is derived from satisfaction, investment and alternatives, with alternatives computed from the NPC's other ties.
- **Status is kept apart** from the private variables. A status change involving V needs an observed V act and the NPC's own acceptance, a function of the NPC's state and V's act, with randomness keyed so a reload reproduces it: `rand("accept", tie, event)`.
- **Bids** are generated at a low trait rate from a library by tie kind. A reply is classified from acts; no reply within a window is "no answer", never a rebuff when V had no chance to answer. A gift is an act read through the NPC's concern, with no flat bonus per item.
- **Absence and reunion.** An absence has a cost only through an open commitment. A reunion policy depends on elapsed time, the expected interval, intervening events and open commitments, and defaults to warm. A decay and maintenance profile per kind (slow for kin, faster for friends) carries a per-tie maintenance style that is never keyed to gender.
- **Consent and pursuit.** Boundaries are persistent pins with reasons, and no attempt count enters an acceptance function. A pursuit budget allows one romantic bid per rung per window and none after a decline or silence. A one-input retract soft-excludes a thread and keeps it visible and editable.
- **Borrowed results are marked.** Each tie-kind policy that borrows a result from the couples literature is marked as such and has a calibration fixture ([dossier 2 open question 6](craft/d02-relationships.md)): cold-reunion share, bids per tie per week, share of ties with a surfaced moment, share of declines that continue as friendships.
- **Forbidden in policy:** scheduling offers for retention, any loss by absence alone, any guilt or streak effect, and any intimate scene content. S1 reads the player's content settings before a tagged scene is offered. Intimacy is never generated.
- **Loss, exit and betrayal propagate** through ties above a commitment threshold into dependants' concerns (grief, vengeance, atonement). Ties above that threshold also contribute `protects` interests to the actor's frames, so the dilemma check finds cross-pressure ([§8.5](#85-dilemmas-and-the-conflict-table)).

### 6.2 Groups and membership

- **Groups are actors** with drives, concerns and goals ([D-08](decisions.md)). A group is a node of kind `core:group`, with a `leaders` slot (members whose own contexts bend the group: principal and agent). Parents and cells nest: a gang is a parent of cells, each a group with its own record. Family and household are groups. A fixer's roster is a group.
- **Membership** is the `core:member-of` edge: role, strength, visibility (open, secret, deniable), terms (standing, or contract with `until`), obligations and exit cost. `strength` follows satisfaction, investment and alternatives ([DRV-38](craft/d01-motivation-drives.md)).
- **Dynamics (`order.members`, phase 2).** Joiners, drift, staged exit (withdraw, leave, residual ties; `strength` falls first), defection by a keyed threshold histogram per group (eight bins, a fixed number of iterations, a public failure adds a step for one window), and succession: the discipline slot is set low for 12 periods **[tunable]** after a leader's removal, the `succession` drive is raised, pair tension rises, and the group splits if no successor is accepted.
- **Groups join groups.** A deniable job from one group to another is a contract edge with `terms: contract`, temporary and `deniable`. It uses the same edge type.
- **The turn budget.** A betrayal is a declared seed ([S2 §2.17](spec/seeding.md#217-people-order-and-reputation-as-material)). S1 enforces a turn budget per cast and per campaign window **[tunable]**, and the protected set blocks turns on live casts. No S1 process turns an ally against V.

### 6.3 Norms

A norm is pack data: a behaviour selector, the sector, enforcer group selectors, empirical and normative threshold histograms, a cost, and a sanction ladder. `order.norms` keeps three slow slots per district and norm: `priv` (share who privately support), `beh` (share who comply) and `perc` (the typical resident's belief about `beh`: a perspective on the district, not world truth). Four fixed iterations per period:
1. `q_e = (1 − φ)·local(beh) + φ·signal`, with `φ` the public-signal weight, 0.1 **[tunable]**, raised to 0.6 for one window after a public event;
2. `q_n` from `perc` and the enforcers' visibility;
3. `beh` is the share of resident types whose thresholds are met (eight bins);
4. `perc ← perc + η(q_e − perc)`, `η` about 0.3.

A **public act** is one in a public place, with enough witnesses who saw each other. Only that sets `φ` high, so a private act moves only its witnesses' beliefs ([S0 F-25](spec/kernel.md#161-acceptance-fixtures)). Enforcers draw partly from compliers with low `priv`. Each rung's use is a minted `enforcement` event with causes. Sanction ladders start with a cheap, public rung, and a lint refuses a ladder with no low rung. **Tipping** needs both embeddedness and enforcer clustering above a threshold. A band pin is written on change. The norm's gap band is the S2 window predicate.

### 6.4 Order

- **Efficacy and cynicism** are two stocks per district, updated by retention and gains with no clock decay: `E ← ρ_E·E + gains − losses`, and the same for `Y`, with `ρ` near 0.98 and 0.99 **[tunable]**. `reportChance = r0 × (1 − Y) × (0.5 + 0.5E) × (1 − fear) × (1 − noSnitch) × (1 + 0.1·witnessBonus)`. Dossier 14 owns the report draw. This is the policy it calls. A fair, visible remedy lowers cynicism, a seen failure raises it, and both are events ([S15-S1-12](craft/d15-people-networks-order.md#111-s1-the-simulation-layer)).
- **The protection market.** For a district and sector: demand `D = T·(1 − trust)`, state supply `S = presence × responsiveness × legitimacy`, gap `G = max(0, D − S)`, supplier shares proportional to strength times presence. Payment edges `xf:protection` (payer to group, kind sought or imposed) are counts per block at coarse tiers and edges when opened. The effect of more policing on governance carries a pack-set sign by rent level. Phase 2.
- **Order kinds** (gang cell, collective, police, corporation in its zone, fixer network) are pack data over the group drive catalogue. Phase 3 adds group governance records (cells under parents with a contract term, ledgers, sanction ladders, articles in `terms` and `obligations`), a police style per prevention preset, corporate zones as a `private` order type and a three-term corruptibility index used only as a prior.

### 6.5 Reputation

**The ledger is the set of carriers' beliefs.** There is no second store. A carrier is a node whose beliefs stand for an audience: a group, a district, or a pack circle (a market row, a crew's regulars). One evidence item is one `Belief` held by the carrier about the subject on the path `rep-<axis>[i]`, with the originating event in `evidence`, the channel's confidence, salience at formation and the teller in `source` when it is hearsay. Items per (subject, axis, carrier) are capped at 32, keeping the memorable and the most diagnostic. `aggregate` is then a pure read over the carriers' beliefs, as [S0 §11.2](spec/kernel.md#112-kernel-rules) says. [Open question 7](#18-open-questions-for-s1) records the path scheme.

**The verdict of an act** is `judge(act, audience's view of the target) × diagnosticity`, where `diagnosticity = clamp(−ln p_district(act kind))`, so a rare act weighs more than a common one. `judge` is a table with the standing rule as a parameter: harm to a bad-standing target reads differently from harm to a good one.

**The aggregate** for audience `A`, subject `s`, axis `a` is a beta form:
```
for each item e in (time, Id) order:
    scale = 1 − reach_A(e) × (1 − λ)          // expected displacement of older items; λ = 0.9 [tunable]
    r, s  = r × scale, s × scale
    r += w_e × max(0, v_e);   s += w_e × max(0, −v_e)
E = (r + 1) / (r + s + 2);   mass = r + s
label = little known if mass < m0 (2 [tunable]), else band(E)   // bands: at least 0.7, 0.4 to 0.7, below 0.4 [tunable]
```
`w_e = salience × channel × tellerDiscount × reach_A(e)`. `reach_A(e)` is the district's reach for the item (the share who know it), so the aggregate estimates the audience's mean belief without visiting residents. A resident's own belief is the same sum over the items they know, with `knows(resident, item)` from [§7.3](#73-rumour-and-reach). The two agree in expectation (M15-18).

**The rules that matter:**
- **A chain adds nothing.** A rumour retold by three tellers weighs as its origin, because telling passes `evidence` on unchanged. Only independent evidence adds ([S0 F-24](spec/kernel.md#161-acceptance-fixtures)).
- **Standing does not decay by absence.** The label changes by new evidence or supersession, never by time alone, never by V's real-time absence, never by game time V spent waiting (CTY-06). Detail slots may widen. The label stays.
- **It reaches V through behaviour.** Prices, greetings, access, a witness's remark after three recorded acts. `aggregate` returns numbers only inside traces. S2's reads expose bands ([§12](#12-what-s1-exposes)).
- **Asymmetry is per domain.** Morality and competence weigh evidence differently, scaled by the district's base rate for the act kind ([S10-P5-13](craft/d10-change-theme-payoff.md#112-the-procedural-engine-p5)). A V who changes course is seen to have changed, by independent new evidence, and is not trapped by the old label.
- **Help and credit** are offered at rates scaled by reach against cost and benefit. An offer between unknowns includes a signal stage (a test, collateral or a shared risk); the stage type is S2's. Phase 2.
- **The firewall.** NPC beliefs about V reach the director only as aggregates, never as evidence about V's taste ([S15-S1-25](craft/d15-people-networks-order.md#111-s1-the-simulation-layer); [dossier 12](craft/d12-player-model-trust.md)). S1's policies read no model of V ([§7.6](#76-the-honesty-lints)).

### 6.6 Contracts, hazards and the fixer chain (phase 2)

A contract is a `core:member-of` edge with `terms: contract` and `until`, plus data: principal, agent, task, pay, monitoring, bond, sanction ladder, expected repeats, visibility. The hazard of deviation per window is saturating and uses no `exp`. With gain `G`, detection `P = m + (1 − m)·cover`, loss `L = P·sanction + continuation + bond` and `x = max(0, G − L)`, then `h = h_max·x / (x + κ)` (`h_max` 0.3, `κ` 0.5 **[tunable]**). A job through a fixer is two contracts. Unopened contracts are counted as summaries and open lazily. Informants are contracts with the police as principal. A betrayal grievance multiplier within `[1, 1.3]` applies only to attributed intent. A fixer's offer set is a function of position (`bridge`, owed favours, interest alignment, and one withheld fact per offer), so two fixers with one pool differ ([S15-S1-09](craft/d15-people-networks-order.md#111-s1-the-simulation-layer)).

## 7. Beliefs, telling and forgetting

The kernel gives beliefs their record and four hooks ([S0 §11](spec/kernel.md#11-beliefs-and-perspectives)). S1 writes the policies behind them. Beliefs exist only at fine tiers. Coarse tiers hold aggregates ([DS-07](design-seeds.md)).

### 7.1 Witnessing and attribution

**Who witnesses.** At fine tiers, the persons present in the event's cell at its time: open-air events reach the cell, interior events only the venue's cell. At coarse tiers, witnesses are a count taken from the cell's population by period and visibility, and only individuated persons appear in an event's `witnesses` slot. A `secret` or `deniable` membership is never perceived ([S0 §11.4](spec/kernel.md#114-knowing)).

**The perception policy.** `knows` reads a mirrored slot only where S1 marks its dimension visible. The first policy marks: appearance tags and outfit, the alive or dead state of a seen body, whether someone is armed, position for those present, and **affiliation where the look carries it** (the game's gang looks are named for the gang, so colours are visible). It does not mark drives, money or secret memberships.

**Salience** is rated at formation, 0 to 3, from four sources: the stakes to the witness's concerns (the strength of the frame match), the emotional pulse of the event class, whether V's act touched a tie, and whether V showed it mattered (the rule S3 owns). Class 3 is memorable by rule: harm to a core concern, an unpaid debt, an open promise, a betrayal ([MEM-13](craft/d11-saves-memory-forgetting.md)).

**Attribution** has one policy for self and other ([DRV-47, DRV-48](craft/d01-motivation-drives.md)). An observed intentional act forms a belief about the actor's reasons (path `reason`, `at` the event's time, a region over reason classes). An unintentional event forms a causal belief. The weight on disposition against situation is 0.65 **[tunable]**, lowered when a constraint is visible and the observer is not under load, and tilted by the observer's attitude to the target's group. Every such belief has `source: inferred`, rule `attr@1`, and the event in `from`, so `trace` is complete. Errors are recoverable by evidence and show on the surface, in speech and avoidance. An NPC may voice its own belief about V's motive only as [D-22](decisions.md) allows. S1 supplies the belief and nothing else.

### 7.2 Telling and lying

`onSocial(event, teller, listener)` chooses what is told and what changes in the telling ([dossier 15 §5.9](craft/d15-people-networks-order.md#59-telling-blacklists-and-testimony), [dossier 11 MEM-10](craft/d11-saves-memory-forgetting.md)):
- **Selection:** `score = protectiveRelevance(item, listener's frames) × severity × closeness(tie)`, and `p_tell = base × max score`. Protective relevance is the kernel's own `protects` and `threatenedBy` match.
- **One operator at most per hop:** `level` (lose detail), `sharpen` (keep and exaggerate) or `assimilate` (bend to what the listener expects), or none. Rates and a hop limit (4) are **[tunable]**.
- **The telling is a minted event** carrying its operator. The listener's belief names it in `source`. Its `evidence` stays the teller's, unchanged, so a rumour never corroborates itself ([S0 F-9](spec/kernel.md#161-acceptance-fixtures); [§17](#17-where-the-dossiers-differ-and-the-compromises)).
- **Lies** are items whose content differs from the world and whose teller knows it. They keep the teller's lineage and are down-weighted when independent evidence contradicts them. **Blacklists** are high-severity, high-reach items told across a group's allied set. They lower `reliable` and `discreet` in every audience of the set, and the event is minted so the street can see it.
- **New kinds** for deceit, betrayal, promise, refusal, threat and confession are pack event kinds with tags. The eleven effects stay as the conflict table needs them ([G-4](craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged)).

**Volume rule.** A telling is minted as an event only when (a) the teller or the listener is in a root's focus at tier 3 or finer, (b) the belief is about V, a live seed's cast or a canon person, or (c) it is a blacklist or a lie bearing on a protected interest. Otherwise spread is coarse and appears as reach ([§7.3](#73-rumour-and-reach)). Outside focus S1 keeps social Changes to about ten per game hour for the whole city **[tunable]**.

### 7.3 Rumour and reach

`city.flow` (phase 2) keeps, per district and item, three fractions (unaware, spreading, stifled) by mean-field recurrences that use only arithmetic ([dossier 14 §5.6](craft/d14-city-events.md#56-the-four-channels-of-spread)). Items are tagged simple or complex: a complex one needs several independent sources inside a cluster and parallel bridges between clusters. Reach is capped by size, and the feed lags by 30 to 120 game minutes for m3 and above **[tunable]**.

`knows(resident, item) = rand("knows", resident, item) < reach(district, item, t)`. Reach is non-decreasing until forgetting lowers it. A resident's answer therefore never changes across a reload, and the fraction who know matches the reach (M14-14). **Told beliefs are minted lazily**, when someone asks, with the confidence of the channel. S2 reads `reach` ([§12](#12-what-s1-exposes)).

**Standing rumours and outlets.** A district's unsubstantiated claims are a slot. A claim resolves, is substantiated, is refuted or lapses at a rate **[tunable]**. An outlet is an actor with a bias function. Its published version of an event is a belief it holds, formed from the event record at a lag, and a correction is a further belief. There is no separate media model ([S17-S1-12](craft/d17-setting-tone.md#133-s1-world-data-that-seeds-the-simulation)). Civic memory has three channels with three lifetimes: people (spoken), media and records (written), places (traces). An event's civic memory is the longest of its carriers, and traces declare carriers and durations in S2's `cosmetic` schema ([CTY-01, CTY-04](craft/d11-saves-memory-forgetting.md)).

### 7.4 Common ground and perspective reads

For dossiers 20 and 21, S1 supplies read-only views over the belief and event records:
- `commonGround(a, b)`: what both hold, both witnessed or both were told;
- `witnessed(a)` and `told(a)`: the sets, so text can be limited to what a speaker could know;
- `reportability(kind)`: the kind's frequency and welfare effect;
- `intent(person, t)` for **focal people only**: the top active goal and step with the goal it serves, read from frames and stored nowhere;
- every event keeps `causes`, `served`, `witnesses`, `place` and `outcome` for each kind a stage kit can depict.

### 7.5 Forgetting

**The first implementation follows [S0 §0.2](spec/kernel.md#02-the-first-implementation).** The memory machinery (accessibility, widening, recall, the sweep) is deferred. Beliefs are kept exactly, and non-memorable beliefs follow the fading hook:
- `fade` (`onTick`) drops a non-memorable belief when `t − refreshed` exceeds a hold of 14 game days **[tunable]**. The hold uses the value the most generous memory setting would keep, so the sweep's floor property ([S0 §11.2](spec/kernel.md#112-kernel-rules)) holds from the start and a later setting never needs what was already dropped. `memoryScale` is recorded in the settings op and inert until the machinery lands.
- A belief is **memorable** by rule (salience class 3), or when S3's return rule sets it. The cap of about 40 memorable beliefs per believer **[tunable]** is kept by not promoting further low-salience beliefs. A belief V returned to is never dropped.
- Arrivals take their district's gist as told beliefs of lower confidence, minted lazily ([CTY-03](craft/d11-saves-memory-forgetting.md)). Group beliefs carry an institutional flag, for the longer time constant the machinery will use.
- **No policy reads a load, a quit, the wall clock or the load class.** `fade` reads only the boundary's game time.

**When the machinery lands** it plugs into the same hooks: a registered `Widen` per slot class, an error allowlist that never touches the slots carrying V's act, its valence, its target or any promise or debt (MEM-11), memory trait classes scaling the time term (MEM-14), faster fade for hearsay from a source V never met, and coalescing of similar memorable beliefs into one pattern belief. A fixture asks each to leave events, pins and exposures unchanged (S0 F-17 to F-20).

### 7.6 The honesty lints

Static audits run at every build, over S1's registry and packs:

| Audit | Checks |
|---|---|
| **V-exclusion** | No S1 function emits a harmful effect (`harm`, `kill`, `take`, `expose`) or a victim or target role naming V; the gate backs it at run time ([§11](#11-the-production-gate)) |
| **Firewall** | The declared read set of every S1 registry function excludes the director's beliefs about V and any orientation or bond evidence ([S12-P5-11](craft/d12-player-model-trust.md), [M12-11](craft/d12-player-model-trust.md)) |
| **No load reads** | No S1 function reads the load class, a load count, the epoch, the play clock or the wall clock |
| **Coarse independence** | No coarse process reads `gameOwnedNow`, V's position or V's demand |
| **`meta:` is inert** | S1 policies ignore `meta:` kinds ([S3-I-14](spec/procedural.md)) |
| **Source lint** | [§4.5](#45-source-lint-and-the-representation-audit) |
| **Kind listings** | Every event kind has producers, a carrier, a duration and a content class listing |

## 8. Drives, urgency and decisions

### 8.1 Drives as data, and frames on demand

**The catalogue is pack data** (S4). Catalogue v1 is 39 individual drives in ten families (`body`, `survival`, `resources`, `bonds`, `standing`, `power`, `self`, `pleasure`, `justice`, `legacy`) and 14 group drives, each tagged with the individual family it belongs to, so the kernel's group inheritance can match a member's frame to a group's concern of the same family ([dossier 1 §8](craft/d01-motivation-drives.md#8-catalogue-v1-individual-drives), [§11](craft/d01-motivation-drives.md#11-drives-of-groups)). A drive definition carries its family, kind (deficit, growth or latent), floor `φ`, horizon, scope, importance parameters, urgency model and parameters, satisfiers and threats.

**Frames open on demand, top-down, only as far as the demanded tier asks.** `frames` builds an actor's frames when a root's focus reaches it:

| Demanded tier | Frames opened |
|---|---|
| 0 to 2 (groups, blocks) | Drive frames for groups, from `group.decide`. Counts for people |
| 3 (a scene) | Drive frames, then a concern frame for those whose concern is active |
| 4 (an individual) | The full chain: drive, concern, goal, step, situation, with memberships' concerns as extra parents ([S0 §12](spec/kernel.md#12-groups-and-membership)) |

When demand leaves, frames close. The first three levels persist for persons V has met. Steps and situations are short-lived. Frame weight is `w = I × (φ + (1 − φ) × U)` (importance `I`, urgency `U`), so a deficit drive at rest weighs a tenth of its importance and a latent drive matters only once triggered.

### 8.2 Importance

Importance is the slow variable, a **derived slot**: a pure function of identity, archetype, circumstance and memberships. It is built in layers:

```
I = clamp( I0_d × A(archetype, d) × exptab( σ_s·(L1_d·z1 + L2_d·z2) + σ_e·e )
           × exptab( κ_d · ln(H / H0) ) × M(a, d), 0, 1 )
```

- `I0` is the population baseline, `A` the archetype multiplier (judgement, by role never demographic), and the `exptab` term the personal profile: two latent axes `z1`, `z2` and a per-drive noise `e`, each a keyed normal drawn from the persistent id (`σ_s` 0.35, `σ_e` 0.25 **[tunable]**).
- `H` is the perceived horizon, from age, health and local hazard, and `H0 = 30` years. Deprivation enters twice, through `H` and through the urgency of `money`, `debt`, `shelter` and `serenity`.
- `M(a, d) = 1 + Σ strength × (ethos_d − 1) × identification`, clamped to [0.25, 3]. A coerced member takes on less of a group's ethos than a believer. This is how a member of one gang differs from a member of another with no faction-specific code.
- **`exptab` replaces `exp` and `pow`.** `pow(a, b)` is `exptab(b × ln a)`, using the allowed `ln` ([S0 §1.3](spec/kernel.md#13-arithmetic)). `exptab(x)` is a registered table function, `e^x` on a fixed grid (step 1/16 from −16 to 4 **[tunable]**) by linear interpolation. Its constants are computed offline and versioned with the function. It needs only multiplication, addition, subtraction and `floor`, so every implementation gives the same bits. The error is under 0.05 %.
- Importance changes only by recorded contributions: a major event (bereavement, betrayal, windfall, initiation) shifts named drives by a stated amount. Within a window it is constant, so "why did she change?" traces one contribution.
- Ethos vectors for the game's own factions are **judgement in pack data**. The records hold class and attitude, not ethos ([dossier 1 §11.3](craft/d01-motivation-drives.md#113-ethos-vectors-for-the-games-own-factions)). A faction without one takes its class default.

### 8.3 Urgency

Urgency is the fast variable, **derived and never ticked** ([DS-66](design-seeds.md)). It is a pure function of timestamped facts and the query time `t` (the V4-1 derive).

| Model | Form (no `exp`) | Input facts |
|---|---|---|
| R, rising deficit | `1 − exptab(−Δ/τ)`, `Δ` scaled by relief | Last-satisfied time |
| S, state ratio | `clip(1 − available / required)` over a lookahead | Stocks and what is due |
| D, deadline | `1 / (1 + κ·max(T − t, 0) / τ_d)`; at `t ≥ T`, 1, and the overdue ladder starts | Due time |
| P, pulse | `u0·s·exptab(−(t − t_e)/τ)`, held at a fraction while latched | Event time and severity; release event |
| X, proximity | `sev × p × exptab(−d/λ)`, `p` the actor's belief that the threat is real | Threat position, belief |
| C, constant | `c`, lifted by a cue or trigger | Trait and context |
| O, opportunity | `b + (1 − b)·A` for the best visible affordance `A` | Nearby satisfiers (phase 2) |
| Y, cycle | A multiplier on another model by phase | Time of day |

Alternatives within a drive combine by maximum, independent sources by `1 − Π(1 − Uᵢ)`. A satisfier gives relief that acts on the model's input facts, not on `U`. Partial relief is normal, relief is capped when `U` is already low, and `craving` carries a tolerance ratchet. **Most people are never observed**, so for drives met by routine (`sustenance`, `rest`, `pleasure`, `friendship`, `curiosity`) the default urgency of an unpinned actor is a function of time of day and schedule type, and nothing is stored. A pinned fact replaces it.

`urgency` evaluates on demand, for actors in an open frame, and at window boundaries for tiers 0 to 2. It writes a pin only when the 1/64 bucket changes. Tick and jump agree by construction: 12 windows as one tick or twelve give identical histories (D-b), and a slow-rising drive cannot stall at the quantum.

### 8.4 Concerns and goals

A drive becomes a concern when a generator fires, and a goal when a means is chosen. The generators read the kernel's own changes ([dossier 1 §13](craft/d01-motivation-drives.md#13-from-drive-to-concern-to-goal)):

| Generator | Fires when | Phase |
|---|---|---|
| O1 Deficit | A drive frame's weight crosses `θ_open` = 0.35 rising, and no routine will meet it. Closes below `θ_close` = 0.2 **[tunable]** | 1 |
| O2 Blocked want | An approach concern's `blockedBy` interest matches a change | 1 |
| O3 Loss | A `protects` interest is violated | 1 |
| O4 Aversive presence | A `threatenedBy` interest matches | 1 |
| O5 Order or duty | A group's goal frame is assigned to the member, or an obligation falls due | 1 |
| O6 Opportunity | A high-importance, low-urgency drive meets a visible satisfier | 2 |
| O7 Cue | A learned cue matches a sensitised drive | 2 |

Hysteresis stops a drive wobbling between 0.30 and 0.40 from opening and closing a concern each time (D-d). An actor has room for a few open concerns beyond routine, three **[tunable]**. Each concern records its origin and cause, so "why is this person here?" always has an answer.

**Goals.** A concern needs a **means** from a library the pack supplies: `serves`, `requires`, `legitimacy`, `cost`, `risk`, `duration`, norm tags and a step template. S1 scores candidates with these terms: progress on this concern weighted by its pull; progress on other active concerns at half weight (multifinality); minus harm to protected interests (counterfinality, which the kernel reports as a `Dilemma`); minus cost and risk; minus a norm penalty scaled by honour, integrity and the group's norms; plus a persistence margin for the current means. The pick is a flat draw keyed `("goal", actor, concern, decisionWindow)`. It is a window index, never an epoch, so a reload reproduces it ([S11-S0-01](craft/d11-saves-memory-forgetting.md#111-s0-and-s1-kernel-and-simulation)). Legitimate means come first, and illegal ones are candidates only when every legitimate means fails the capability gate. **Scoring runs only for actors in an open frame.** Others take the highest-scoring means coarsely.

A committed goal has a commitment, a deadline, a persistence margin (0.15 **[tunable]**) and a level of interest that decays (about 6 game hours with no progress **[tunable]**). It is reconsidered when blocked beyond a horizon-based limit, when a new concern's pull exceeds it by 1.5, when an alternative scores clearly better, when interest falls below 0.2, or when it succeeds or fails. One decision in about eight goes to the best lower-pull concern, which keeps upkeep alive without dithering.

**Outcomes are events with causes** (satisfied, failed, dropped, superseded). `goal-met`, `goal-abandoned` and `goal-blocked` are minted with the frame as cause ([G-2](craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged)). A relief event pins the last-satisfied fact. A failure fires O2 or O3 on what remains and attributes blame: an agent blamed raises `vengeance`, otherwise stress load rises.

### 8.5 Dilemmas and the conflict table

A `Dilemma` reaches S1. It resolves by one of four strategies weighted by pull: an alternative resource, an alternative plan, a modified goal, or abandoning one. Unresolved dilemmas add stress load. When the dilemma comes from an **order**, the member's options are drawn from a prior and modulated, then drawn with the key `("defect", member, window)`:

| Option | Prior **[tunable]** | Option | Prior **[tunable]** |
|---|---|---|---|
| Delay | 0.30 | Warn the target | 0.12 |
| Avoid or be absent | 0.20 | Comply | 0.10 |
| Fake compliance | 0.20 | Refuse openly | 0.04 |
| Betray the group | 0.02 | Run or leave | 0.02 |

Raising and lowering terms are in [dossier 15 §5.13](craft/d15-people-networks-order.md#513-defection-and-exit). Delay, fake compliance and quiet exit are the usual outcomes by design.

**The conflict table's contents.** S1 adopts the kernel's first version as complete for the first implementation ([S0 §10.8](spec/kernel.md#108-effects-and-cross-pressure)): `protects X` is violated by `harm`, `kill`, `take` or `expose` on X, and `wants Y` by `conceal` or `take` on Y. `help`, `protect`, `rescue`, `give` and `meet` violate nothing. The table is a registry function over pack data, so it can grow without code. Reasoning about opposite effects is deferred ([S0 §0.2](spec/kernel.md#02-the-first-implementation)). Betrayal, deceit and refusal are event kinds, not effects ([§7.2](#72-telling-and-lying)).

### 8.6 Group decisions

`group.decide` runs per period for each group:
1. **Group drive urgency** from the 14 group models (runway for `treasury`, latched pulses for `retribution`, and so on).
2. **Operative weights:** `W(d) = normalise(0.4·ethos + 0.4·U + 0.2·leaders)` **[tunable]**. `ethos` is the declared character, `U` what the books say, `leaders` the leaders' own weight on the matching drive. **Divergence** `D_g = ½ Σ |ethos − W|` is exposed as a read. Where someone can witness the gap, it is hypocrisy-seed material.
3. **Concerns** open when a group drive crosses its threshold or an event matches its interests, exactly as for an individual.
4. **Leadership decisions** are the only way a group's concerns change. They go through the kernel's `decide(leader, group, decision)`: open a frame, set a status or weight, change interests ([S0 §10.3](spec/kernel.md#103-inheritance-and-pull)). The leader is a member with the role; a coarse group draws leaders by `H("gen", group, "leaders", i)` when one is needed.
5. **Orders** make a goal frame on a member, with parent the group's goal frame and `pressure = clip(0.3·rank_gap + 0.4·strength + 0.3·fear)` **[tunable]**. They are made **only for members whose frames are in demand**. Otherwise the order is a rate contribution ([§5.2](#52-incidents)) or a count.
6. **Retaliation passes a situation check** before an act: `hazard = h0 × (1 + a_audience + a_weak) × (1 − a_arbiter)` per window, `h0` about 0.02 **[tunable]**. A retribution latch releases by retaliation, an arbiter's settlement or exhaustion.

Group beliefs carry the institutional flag. A group's grudge against V is a belief that may raise an offer through S2. It is never an act aimed at V.

### 8.7 What S1 hosts for other layers

The director's drives (`tension`, `variety`, `relevance`, `care`, `continuity`) and a seed's (`occur`, `fit`, `fresh`, `exclusive`) belong to S3 and S2, with their weights set by the player's settings and the authors' priorities ([dossier 1 §12](craft/d01-motivation-drives.md#12-the-director-and-seeds)). S1 supplies only the shared derive functions they use (R, D, P, S), through the same registry.

### 8.8 V's frames

The kernel asks S1 to open V's frames from the game's story state ([S0 §10.4](spec/kernel.md#104-lifecycle)). `v.frames` does so, and no further:
- **A situation frame** for where V is now: V's cell at tier 3, its neighbours at tier 2, always open. V's cell, district and interior come from the mirror.
- **Goal frames for what the game tracks.** A tracked journal objective becomes a goal frame that wants its target and place, active or blocked by its journal state. It carries `source: game` and the journal record as cause. It says what the game asked, not what V feels.
- **A step frame** for the person V is speaking to, from the dialogue feed (tier 4 on that person).
- **Nothing else.** Inferred frames come from the director's beliefs ([S0 §11.3](spec/kernel.md#113-the-directors-beliefs-about-v)). No process pins V's drives ([I-12](spec/kernel.md#15-invariants), D-l).

## 9. NPC change

People change by belief revision under pressure, and mostly they don't. The policy ([dossier 10 §5.1](craft/d10-change-theme-payoff.md#51-an-npcs-change)):

| Part | Rule |
|---|---|
| **Held view** | A `Belief` in the NPC. Its subject may be the NPC itself, a group, a place or V |
| **Stability** | The three-level class drawn from the persistent id ([§4.3](#43-residents-households-spells-and-traits)); most NPCs high; an author may fix it |
| **Pressure** | (a) Events independent of evidence already counted that contradict the view; (b) `Dilemma`s between frames of different origin, weighted by severity. Pressure citing evidence already counted adds nothing |
| **Threshold** | The account of pressure on a view reaches the NPC's threshold (about `3 × (0.5 + stability)` weight units **[tunable]**). One or two independent events almost never turn a stable NPC, and four or five usually do (toy 1) |
| **Revision** | Normally the view moves towards the evidence. If the move would violate a protected frame with high pull, it moves to the nearest view that spares that frame. That is a **rationalisation**, and each accepted one lowers the cost of the next by a gain `g` **[tunable]**. No single step exceeds a third of the total change |
| **Turn** | S1 mints a `turning` event, `{ who, kind (revision, refusal, exit or tie), from, to, causes, served }`. A membership change is an `exit` turn with its exit cost. Importance drifts by a bounded step on a few event kinds only, role transitions first |
| **Refusal** | When a decision frame resolves in favour of the held view while the account is at or above a share of the threshold, S1 mints a `refusal`. It changes nothing in the NPC. It is a recorded choice under pressure that V can see |
| **Reversal** | Decays with absence and with contrary evidence. Fixtures from toy 2 |
| **Drift** | Moves an NPC towards its group and role, never towards V or the population mean (M10-06) |
| **Caps** | The NPCs with a pending turn inside a root's demand focus are capped **[tunable]**. This is the kernel's focus, not S3's attended set, which S1 can't see |
| **Canon** | Generated and open NPCs run the full policy. Canon NPCs change only beliefs about V and ties with V, unless an author declares a turn ([§4.4](#44-the-protected-set-canon-people-and-the-spine)) |

Arcs gather where one thread touches the same NPC several times. Across a city with a thin spread of pressure almost everyone stays as they are. That is the flat arc by default, and it is the right default.

## 10. What is minted for the sifter

The sifter reads the Change stream, and its ceiling is the simulation's detail ([GEN-07](craft/d06-sifting-tellability.md)). S1 therefore produces events with people, intents, causes and outcomes where stories are wanted, and keeps the volume bounded.

**The kinds S1 mints** (pack data; each lists producers, tags, effects, participants with roles, a carrier and a content class):

| Family | Kinds | Tier | Volume |
|---|---|---|---|
| City | `theft`, `assault`, `gang-clash`, `shakedown`, `police-action`, `psycho-break`, `disorder`, `accident`, `outage`, `commerce` | 1, 2; items at 3 | m1 items: no Change. m2 and above: about 10 Changes per game hour citywide |
| Order | `regime-start`, `regime-end`, `enforcement` (a rung used), `skim`, `deviation`, `default`, `collector-visit`, `recruit`, `exit`, `defection`, `split` | 1 to 4 | By cause; bounded by the calendar caps |
| Minds | `goal-met`, `goal-abandoned`, `goal-blocked`, `turning`, and the tie events: `bid`, `reply`, `disclosure`, `favour`, `conflict`, `repair`, `joint-activity`, `novel-activity`, `crisis` | 3, 4 | Only for actors in a root's focus, and for the cast of live seeds |
| Social | `tell`, `lie`, `rumour` (district level, m3 and above), `overhear`, `blacklist`, `expose`, `conceal`, `confess`, `threat`, `promise`, `refusal`, `betrayal` | 3, 4; coarse for `rumour` | The volume rule of [§7.2](#72-telling-and-lying) |
| Mirror | The derived city events of [§3.3](#33-two-levels-of-event-and-what-the-gate-does-to-them), and the raw `game.*` events | 1 | As the game's own rate |

Every event carries `causes`, `served`, `outcome` and `witnesses` where they exist ([S0 §9.2](spec/kernel.md#92-events)). A cause never follows its effect: a child's time is at least one window after its parent's. S1 supplies the `producers(kind)` registry the sifter reads at pattern load, so a pattern naming a kind nothing produces is refused.

**Dossier 6's gaps and S1's route for each** (kernel unchanged):

| Gap | S1's route |
|---|---|
| G-1 beliefs are not Changes | Telling, lying and overhearing mint events with the listener as a participant and `expose` or `conceal` effects ([§7.2](#72-telling-and-lying)). Divergence between belief and truth is a query the sifter makes |
| G-2 frame status changes | `goal-met`, `goal-abandoned`, `goal-blocked` with the frame as cause. The kernel also reports `frame` Changes (V4-4) |
| G-3 outcome and intent | S1 sets `outcome` and `served` on every act event it mints (S0 v4 fields) |
| G-4 no betrayal, deceit, promise, refusal, threat, confession | Pack kinds with tags; the eleven effects stay |
| G-6 non-canon events are forgotten | The sifter copies descriptors. S1 keeps the seven-day ring so a descriptor can be re-minted ([§5.2](#52-incidents)) |
| G-7 fine-tier events are silent | `scene.acts` mints act events wherever a root's focus reaches tier 3 or finer; coarse patterns read summary counts |

**Fine-tier volume.** `scene.acts` mints at most a bounded number of events per game hour per focused scene **[tunable 20]**, from the summary's items in focus and from focal people's routine acts. It never catches up, and it never writes outside the focus.

## 11. The production gate

Everything S1 *produces*, as new occurrences, passes one choke point, `produce(occurrence)`, before it is published ([S0 §9.2](spec/kernel.md#92-events), V4-23 and V4-28). Gates sit at choke points, not on each feature ([ENF-03](craft/d18-content-boundaries.md)).

**Order of checks:**
1. **Class exclusion.** If the occurrence's content class is excluded by `SettingsSet.classExclusions` or a content ceiling of 0, **in force at production time**, it is not produced, with reason `excluded`. The same applies to everything that depends on it: its summary count, its items, its children.
2. **The floors.** Roles `aggressor`, `victim`, `target` and `hostile` bind only persons with `ageClass = adult`. A missing class counts as minor. Persons marked as real are never bound. No occurrence carries a sexual tag unless a pack scene supplied it through an action V accepted ([S2 §2.19](spec/seeding.md#219-content-classes-ceilings-and-floors)).
3. **V-exclusion.** No harmful effect and no victim or target role names V.
4. **The protected set.** Harm, kill, take and expose do not choose a protected person ([§4.4](#44-the-protected-set-canon-people-and-the-spine)); absences do not remove one.
5. **Budget gates.** The city budget for m4 events and the cap per window.

A refusal is logged with its reason and never silent.

**Lines are exclusion at production, not thinning.** A class at ceiling 0 gets a **zero rate** for its kinds, and its offspring tables are renormalised without it, so the world holds none of it. The gate is the backstop. Thinning small events instead would distort the size law ([AFT-09](craft/d14-city-events.md)). The `cityScale` dial scales the citywide rates and the mean offspring together, and is recorded in the settings op.

**What the gate does not touch:**
- records of what the game itself did, and the derived mirror events ([§3.3](#33-two-levels-of-event-and-what-the-gate-does-to-them));
- replayed history, which is never re-filtered;
- veils (ceilings 1 to 3), which act at display and are not S1's.

**Kinds carry classes.** Every event kind lists `(class, intensity by form)`, the form shown and the form reported. A kind with no listing is an error in a pack ([S18-S4-02](craft/d18-content-boundaries.md)). The kinds below are illustrative; S4 owns the registry.

| Kind | Class and intensity (shown / reported) |
|---|---|
| `theft` | `property` 1 / 1 |
| `assault` | `harm.residents` 2 / 1 |
| `gang-clash` | `harm.residents` 3 / 2; `harm.groups` 2 / 1 |
| `enforcement`, top rung | `harm.sanction` 3 / 2; a ladder always keeps its lowest rungs, which are talk and exclusion |

The player's dials for violence against residents, informing and sanction severity are read as lenses: a ladder cap follows them, and S1 never produces a rung whose class is at ceiling 0.

## 12. What S1 exposes

**Registered reads for S2** ([S2 §2.16, §2.17](spec/seeding.md#216-city-events-as-material)). Each declares its dependencies and invalidation, so interests and wake-ups follow. None exposes a raw number. Each is `maybe` until S1 has a reading for its scope.

| Read | Answers | Depends on |
|---|---|---|
| `band(cell)` | quiet, elevated, hot or flashpoint | The cell's band pin |
| `heatRank(district)` | The district's rank among districts | Band pins |
| `tension(a, b)` | A pair's band | `city.tension` digest |
| `regime(scope)` | The live regimes | Regime nodes |
| `reach(district, item)` | Whether an item or service reaches a district | `city.flow` digest, price level, the product registry |
| `protected(node)` | Whether a place or person is under protection | Payment edges, the protected set |
| `presence(leaf, faction)`, `priceLevel(district)`, `refuge(leaf)` | Banded setting values | World index, slow variable, status pins |
| `label(audience, subject, axis)` | A reputation band | `aggregate` |
| `bridge(who)` | How much a person brokers between groups | Foci rosters |
| `normGap(norm, scope)` | The gap between private and perceived support | Norm slots |
| `contract(id)` | Due, at risk or broken | Contract state |
| `tied(a, b, type)` | Whether a tie exists | The tie function |
| `divergence(believer, subject)` | How far a belief is from the truth, banded | Belief and world |
| `depth(node)` | Whether a person can be opened to individual detail now | Tier and caches |

**Registries for S3:** `producers(kind)`, `isSpine(node)` ([§4.4](#44-the-protected-set-canon-people-and-the-spine)) and `aesthetic(node, feature)`. For people and places `aesthetic` is derived from the look tags and the style index; the feature library is S4's ([open question 14](#18-open-questions-for-s1)).

**Hooks for the kernel:** `onWitness`, `onSocial`, `onTick`, `aggregate` (with the S0 v4.3 contract `{ value, mass, items }`), the conflict table, the perception policy, and the process registrations with `coarseFine`. **For S7:** [§7.4](#74-common-ground-and-perspective-reads). **For P8:** realisation candidates ([§5.5](#55-realisation-candidates)). **For P9 and P10:** the decision log (every gate refusal, every correction, every keyed decision with its key), the pattern register ([§19](#19-simplicity-check-and-the-first-implementation)), per-process counters, and the "why" traces: every minted event's cause chain to an immigrant or authored cause in at most four links (M14-24).

## 13. Tiers, demand and catch-up

S1 reads the kernel's six tiers ([S0 §10.6](spec/kernel.md#106-demand-and-tiers)) like this:

| Tier | Scope | What S1 holds there | Runs |
|---|---|---|---|
| 0 | City | Hour and weekday shapes, regimes, flow matrix, citywide rates, group labels | Everywhere, always, and catches up |
| 1 | District (leaf area) | Joint table, rates, hot list and bands, tension and stocks, norm slots, labels, rumour fractions, group drives | Everywhere, always, and catches up |
| 2 | Cell or block | Residents as a count, households as a table, foci rosters, summaries per window, the pending calendar, payment counts | Everywhere, always, and catches up |
| 3 | Scene | The persons present, opened; the summary items in focus as events; their witnesses | Only where demand reaches. Never catches up |
| 4 | Individual | One person's spells, ties by layer, beliefs, contracts, frames | Only where demand reaches. Never catches up |
| 5 | Fine detail | The game's: positions and animation. S1 holds nothing | The game |

**How a fact is refined between tiers.** Each step is the kernel's ordinary open, and the coarse value constrains the fine:

| Thing | Tier 0 or 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| An incident | A rate `Λ` per kind | A count in a cell's summary | An item with time, place, size | Participants with roles; their acts and beliefs |
| A resident | The joint table | A headcount and a household table | A drawn person, consistent with the slot | Spells, ties, drive frames, beliefs |
| A norm | District `priv`, `beh`, `perc` | Local `beh` where hot or opened | Who would enforce, who is watching | A person's thresholds |
| Reputation | A label per audience and axis | Which carriers a block has | Who knows V's acts | A person's own items and beliefs |
| A drive | Group urgency from books and board | Default urgency by schedule | Urgency from observed facts | Concerns, goals, steps |

**Demand.** The roots are V, the director and live seeds. V's frames come from `v.frames`. A root's focus reaches a node at a tier, and a node's demand tier is the highest among eligible frames focusing on it or its owner chain ([S0 §10.6](spec/kernel.md#106-demand-and-tiers)). Fine-tier processes run only at boundaries that demand covered, judged from recorded history. When V arrives, fine state is generated from the coarse state, consistent with the pins.

**Catch-up.** After an absence, tiers 0 to 2 replay every missed boundary in order, each within the hard limits, and read no demand ([S0 §9.4](spec/kernel.md#94-evolution)). **When the work exceeds the budget, S1 lags and does not change a period.** The kernel stops between boundaries and resumes, and reads during catch-up answer as of the last processed boundary, flagged `catchingUp`. A period fixed per lineage keeps history identical on every machine.

**The city's reply to V's act has a floor.** V's act at time `t` in window `k` is applied at the boundary ending `k`, first processed in window `k + 1`, and its earliest child is due at `k + 2`. That is 10 to 20 minutes at the default window, and the delay bins make most answers slower ([dossier 14 §5.9](craft/d14-city-events.md#59-the-reload-and-partition-contract)).

## 14. Performance and memory budgets

These are **targets for P7**, not measurements. P7 measures a simulated session and sets the numbers ([S0 §17](spec/kernel.md#17-compromises-and-open-items) open item 2). The first implementation is the TypeScript reference model. Hot loops may move to the native core through `bun:ffi` after measuring, with the TypeScript version as the oracle ([D-05](decisions.md)). Every figure is **[tunable]**.

| Item | Target, native core | TypeScript reference | Basis |
|---|---|---|---|
| An hourly boundary, all S1 processes, whole city, steady state | 5 ms | 100 ms | Counts, small tables and a handful of due children ([dossier 14 §5.8](craft/d14-city-events.md#58-what-is-minted-where-and-when)) |
| A window boundary with nothing due | 0.2 ms | 5 ms | |
| Catch-up of one game night (24 hourly runs) | 150 ms | 3 s | |
| Catch-up of 30 game days (720 runs), in the companion, never on the game's frame | 4 s | 60 s | No perceivable wait: reads answer at once, flagged ([§13](#13-tiers-demand-and-catch-up)) |
| Opening a scene (tier 3, one cell, up to 60 persons) | 5 ms | 50 ms | V arrives and everything is ready |
| Opening one person (tier 4) | 1 ms | 10 ms | |
| `aggregate`, cached by revision and `t` | 20 µs | 200 µs | A cost bound of 2,000 allowance units per call |
| `tie(a, b)` | 50 units | 50 units | `neighbours`: hard cap 5,000 units per call |
| A concern generator per relevance emission | 500 units | 500 units | |
| S1's share of one hourly run | 40,000 allowance units | 40,000 | P7 sets the kernel total |
| World index load from the install cache | 300 ms | 1 s | Everything loaded at first paint ([load-time goal](../backlog/performance.md)) |
| Replay from the nearest snapshot on load | 1 s | 10 s | Snapshots every 10,000 ops ([S0 §14.2](spec/kernel.md#142-records-and-branching)) |

| Memory and size | Target |
|---|---|
| S1 resident set, whole city, native / TypeScript | 24 MB / 120 MB (static index about 6 MB; process state, rings and calendars under 8 MB; ledger and beliefs under 6 MB; open persons under 2 MB) |
| Pending calendar | At most 256 per district. About 500 citywide in steady state |
| Ring | Seven game days. The cap is 5 MB, with headroom for hot days |
| Hot list | At most 64 live cells per district |
| Open persons | At most 300 at once (V's scene and the focal set), each with at most 40 memorable beliefs |
| Ledger | At most 32 items per (subject, axis, carrier); at most 100,000 in all |
| Change stream | About 10 per game hour from `city.events`; about 10 more social ones outside focus |
| S1's part of a save | A process snapshot of at most 2 MB; growth of at most 100 KB per game day of continuous play. P7 measures before it fixes these |

The expensive part of the city is the **one-off world-index build**, which is static data and happens offline. The per-window work is the drawn counts, the due children and the hot-list refresh.

## 15. Determinism and reload

**Keys.** `rand(key…) = toUnit(H("rng", key…))`. Every S1 key starts with the family name and the world seed, and **no key reads the session epoch, the load count, the play clock or the wall clock** ([I-16](spec/kernel.md#15-invariants)). The only non-causal discriminator is an `attempt` counter.

| Family | Key after the world seed |
|---|---|
| Process draws | `"proc", processId, window, scope, kind, role, index` |
| Offspring | `"child", parentId, index, aspect` |
| Ties, far ties | `"tie", min, max`; `"far", j, a` |
| Spells and lifetime | `"spell", person, track, k`; `"life", person` |
| Traits, profile | `"trait", person, name`; `"prof", person, drive` |
| Knowledge | `"knows", resident, item` |
| Absence | `"absent", person, day` |
| Goals | `"goal", actor, concern, decisionWindow` |
| Options under orders | `"defect", member, window` |
| Contracts | `"contract", id, window` |
| Acceptance | `"accept", tie, event` |
| Telling | `"tell", teller, listener, item, window` |

**Arithmetic.** Only `+ − × ÷`, `sqrt`, comparisons, `floor` and the kernel's `ln`. Curves are rational functions or tables (`exptab`). Loops run in a fixed order. Counts use cumulative `−ln` spacings. Tables are computed offline, stored as binary64 constants, and versioned with the function versions in the lineage record ([S0 §14.4](spec/kernel.md#144-compatibility)). A bit-for-bit fixture holds the native core to the TypeScript oracle ([D-06](decisions.md)).

**Order.** Evidence is processed by `(time, Id)`. Contracts in `Id` order. Patterns, partial matches and processes in `id` order. Ties go to the lower `Id`.

**What S1 persists, and what regenerates.**

| Persisted | Regenerates, identically |
|---|---|
| `ProcessState` per process: calendar, ring, tensions, stocks, norm slots, regime data, digests, recipe tables with their versions, flow-matrix version, and each process's outstanding batches | Residents, households, spells, names |
| Pins on temporal slots that were observed or retained (bands, labels, urgency windows) | Implicit ties, routines, the persistent hot list (from `ε`) |
| Materialised ties and memberships | Urgency (a derive), `where(person, t)`, unobserved beliefs |
| Memorable beliefs; carriers' retained items | Events that are not canon (re-minted from the ring) |
| Canon events and summaries' canon sets | Items of a summary, from its descriptor |
| Frames of demand roots and live seeds, with ancestors | Frames of everyone else |
| `SettingsSet` ops in force | |

**Reload.** Outstanding batches are state: restored, then applied at their boundary without re-running the process. A cascade saved mid-way and reloaded under another epoch, play clock and wall clock has the same future (S0 F-22). A pack update that changes a kind registry mid-lineage uses the S2 policy `continue`: in-flight children keep their kinds, and new draws use the new registry under its version. **Twin runs** compare coarse and fine against each process's `coarseFine`, over at least 20 world seeds and several vantage pairs (S23-P9-06).

## 16. What the kernel and the other specifications still need

**Kernel (S0).** No new mechanism. Four clarifications to the process interface, found by reading the reference model, which gives a process a read of the world but no state and no frame operations ([`evolution.ts`](../../projects/xf-story-engine/reference/src/evolution.ts)):

| # | Need | Why |
|---|---|---|
| K-1 | **A process reads its own state and returns a replacement with its batch.** The state is applied atomically with the batch and double-buffered like any output | The calendar, ring, tensions and stocks are state ([§15](#15-determinism-and-reload)). Today `ProcessState.state` exists but `run` cannot read or write it |
| K-2 | **A process reads the published digests of other processes** as of the boundary snapshot, read-only | [§2.4](#24-one-convention-between-processes) |
| K-3 | **A fine-tier process is given the demanded nodes**: `demanded(tier)` returns nodes, tier and claim | `scene.acts` and the fine-tier policies need to know where to run. Today only "demand reaches tier T anywhere" is known |
| K-4 | **The process operation set grows** to cover frame operations (open, status, weight, interests), group `decide` and `order`, `observe`, `tell` and belief-set | `group.decide`, `scene.acts` and `order.ledger` write through these. Today they are separate calls outside the batch |

**Reference-model alignment, not S0 changes.** The reference model's stub `aggregate(audience: Id[], …)` returns `{ value, confidence }`. S0 v4.3 states `aggregate(audience: Id | Selector, …) → { value, mass, items }`. The stub follows S0 v3 and needs updating before S1's reputation policy runs on it. `coarseFine` and declared read sets (for the firewall audit) are optional fields on `ProcessDef`.

**Not needed:** implicit edge types (S1 ships the pure functions; casting opens a bounded set); the memory machinery (deferred, [§7.5](#75-forgetting)); function-specific query bounds (queries return `maybe` over compound regions in the first implementation, and a district of a few thousand residents is a complete traversal).

**Schema (a pack, not the kernel).** S1 ships a core world pack `xf.core.world`: kinds for cells, blocks, households, regimes, norms, tie edges and payment edges, and the slots [§4](#4-who-exists) names. The kernel's core schema is unchanged.

**S2.** The `city`, `social` and `fn` read mechanism is S2's ([§12](#12-what-s1-exposes) lists S1's side). S2 owes S1 the live casts and a way to report V's accepted offers as observed events.

**S3.** Owes S1 the `memorable` rule for returns, and the stated rule that S3 never reads inside S1's private state.

**S4.** The pack formats for kinds, drives, ethos, archetypes, norms, ladders, means, names and outlets, and the content-class listing per kind (S18-S4-02).

**S5, P8.** The feed kinds, the community-slot read for people V can see, a `community active` read per cell for `gameOwnedNow`, the routes table's execution and spawn budget.

## 17. Where the dossiers differ, and the compromises

**Where this page departs from a dossier, and why:**

| # | Dossier says | This design does | Reason |
|---|---|---|---|
| 1 | Dossier 14 §5.10: a cell is game-owned while the game's community there is active, and S1 mints no incident there | A **static** `gameCoverage` lowers the rate; `gameOwnedNow` is read only by realisation | A V-dependent flag breaks demand independence (M14-20) ([§3.6](#36-where-game-truth-overrides-simulation)) |
| 2 | S14-S1-01: every process has a period of six windows | `city.mirror` and `scene.acts` run every window | A game event should enter the record within ten minutes, not an hour |
| 3 | S14-S1-24 and S15-S1-27: over budget, a lower tier's period lengthens | Periods are lineage constants. Work lags | A period change changes history (I-1) ([§13](#13-tiers-demand-and-catch-up)) |
| 4 | Dossier 1 §9, §10: `exp` and `pow` in urgency and importance | `exptab` and `pow = exptab(b × ln a)` | `ln` is the only transcendental in a decision ([S0 §1.3](spec/kernel.md#13-arithmetic)) |
| 5 | Dossier 1 §13.3: the goal draw is keyed on `decisionEpoch(now)` | Keyed on `decisionWindow` | "Epoch" means the session only (S11-S0-01, I-16) |
| 6 | S11-S0-07: the listener's belief cites the telling event "in `evidence` and `source`" | In `source` only; `evidence` stays the teller's | Else a chain of tellings is independent evidence and F-9 fails |
| 7 | Dossier 15 §5.8: a ledger of evidence items | The items are carriers' beliefs; there is no second store | `aggregate` is a read over beliefs ([S0 §11.2](spec/kernel.md#112-kernel-rules)) |
| 8 | S10-P5-07: a cap on pending turns in V's attended set | A cap inside the kernel's demand focus | S1 can't see S3's attended set |
| 9 | D2 BND-31: a closure rule creates NPC to NPC ties | No closure rule. Shared foci give closure; the sifter detects the triads | One tie function is simpler ([§6.1](#61-ties-and-bonds)) |
| 10 | S14-S1-21: S1 holds the realisation table and runs it | S1 owns the table's data. P8 runs it | One table with the stage-kit family table (STG-01) ([§5.5](#55-realisation-candidates)) |
| 11 | S14-S1-20: `city.mirror` reads the game feed | The port submits raw events; `city.mirror` reads those from the snapshot | A process can only read the kernel, and raw events stay as the game's record ([§3.3](#33-two-levels-of-event-and-what-the-gate-does-to-them)) |

**New compromises, for the [ledger](foundation.md#9-the-reference-model-and-the-compromise-ledger):**

| # | The model says | S1 does | Revisit when |
|---|---|---|---|
| C-S1-01 | Every person is a full bundle | Residents are drawn from a recipe and opened on demand | A story needs a resident's history before V met them, beyond spells |
| C-S1-02 | Rumour travels person to person | Mean-field fractions per district, with a keyed quantile `knows` | M14-13 or M14-14 fail, or a story needs who told whom for unfocused people |
| C-S1-03 | Beliefs everywhere | Beliefs only at fine tiers; aggregates above | The sifter lacks divergence material (open question 5) |
| C-S1-04 | Every telling is an event | Minted only in focus, for V, live casts and canon people | Same trigger |
| C-S1-05 | Ownership is checked against the game as it is now | A static coverage figure, and a dynamic read only for realisation | A session shows simulated and game incidents colliding |
| C-S1-06 | Memory follows use and importance | A hold time with the generous floor, until the machinery lands | Transcripts read as forgetting or recalling unnaturally (dossier 11 T11-10) |
| C-S1-07 | `e^x` exactly | A table with linear interpolation, under 0.05 % error | A distribution test shows the error |
| C-S1-08 | Attribution is a full inference | Two beliefs and one disposition weight | NPC speech reads as wrong-minded |
| C-S1-09 | Ties are queryable without opening | Pure functions, with casting opening a bounded set | Casting through ties misses or costs too much |
| C-S1-10 | Ethos and archetype from the setting | Judgement tables in pack data | A review by someone who knows the lore, or calibration fixtures |

## 18. Open questions for S1

1. **Cell size and grid.** About 200 m clipped to the leaf, venues as own cells. The index build gives the count. How cells relate to streaming cells is open.
2. **The game-time ratio and the hours behind the period names.** Unmeasured. Every time constant depends on it. It is row 1 of [dossier 14's in-game session](craft/d14-city-events.md#123-in-the-game-one-prepared-session-the-maintainer-runs-it).
3. **Binding keys.** Is `(community instance, entry, spot, ordinal)` readable and stable across loads? [Dossier 15's session](craft/d15-people-networks-order.md#123-in-the-game-one-prepared-session-the-maintainer-runs-it) row 1 settles it. The fallback is session-only binding.
4. **Concern capacity and thresholds.** Three open concerns, `θ_open` 0.35, `θ_close` 0.2: calibrate on fixtures D-a to D-n.
5. **Is the minted-telling volume enough for the sifter?** Measure on the M3 transcripts.
6. **`city.mirror`'s period and the feed's latency and ordering,** with S5 and the bridge.
7. **Belief paths for ledger items.** `rep-<axis>[i]` with an index, or the event id? It must satisfy I-9 and the cap of 32. The carriers' node kinds (district, group, circle) need the same answer.
8. **How many audiences per subject.** District and nearest group, or also the subject's own group ([dossier 15 open question 12](craft/d15-people-networks-order.md#10-open-questions)).
9. **The headcount scale `ρ`** from entry quantities, which count slots and not people.
10. **Ethos and archetype tables** are judgement and need a lore review. They are pack data.
11. **Age advance.** Whether a lineage needs `age-at(t)`.
12. **Mod-added places and communities mid-lineage.** How the index overlay re-derives presence, and which pack-update policy applies.
13. **Native hot loops.** The refit, the opportunity fields and catch-up are the candidates. Measure first (P7).
14. **`aesthetic` reads.** Where the feature values for people and places come from, beyond look tags.
15. **How institutions decide.** Corporations and the police are authored-heavy. The first cut gives them drives, ethos and orders, and no deeper policy.
16. **S5 reads.** A `community active` read per cell, and the community slot for a person V can see.
17. **Whether `scene.acts` needs positions.** If it does, P8 supplies them. If not, S1 stays position-free.

## 19. Simplicity check and the first implementation

### 19.1 What was cut, merged or deferred

Every part traces to a requirement ([§20](#20-requirements-trace)). Several are one mechanism, not many:

| Merged or cut | Into |
|---|---|
| Media model, rumour model, reputation store | Outlets are actors holding beliefs. The ledger is carriers' beliefs. Rumour reach feeds both |
| A separate game-ownership system | One partition of three classes, and static coverage |
| A closure process | The tie function's shared foci |
| Per-process lengthening under load | Lag |
| A second precedence for S1 | Contributions at 200 for what others may override; pins at 300 only on slots S1 alone writes |
| Infrastructure graphs, far ties, covert effects, group governance records, police styles, the slow variable, unrest | Phase 3 |
| Tension, suppression, the protection market, rumour reach, contracts, defection, outlets | Phase 2 |
| The memory machinery | Deferred with S0 V4-30, with a hold-time fade until then |
| Opportunity (O6) and cue (O7) concern generators | Phase 2 |

**What S1 never builds:** a per-resident simulation; V's drives; any act aimed at V; a model of what V feels; pathfinding or animation (P8); text (S7).

### 19.2 The first implementation, sized for milestone M3

M3 is one district, built from real game data, at coarse and medium detail ([plan §4](plan.md#4-milestones)). **The district is Kabuki** (Watson). It is small, mixed in its gangs, and the dossiers' running example. It gives S1 enough to test every phase 1 process and the R1 reads.

**The data, from the knowledge pages** ([places §3.6, §9.3](../../knowledge/places.md#36-the-area-table)): the leaf area is 0.49 km² with a vertical band of −20 to 200 m. It holds 153 fixed, 251 streamed and 272 background communities, 7,497 AI spots, 47 points of interest and 11 fast-travel points. Its entry quantity is 2,964, of which 79 % civilian and 2 % NCPD. Its gangs are Tyger Claws (205), The Mox (112), Scavengers (48), Militech (41) and Animals (18). Its police preset is the standard NCPD one. A cut at 200 m gives about 12 grid cells and a few venue cells, 15 to 30 in all. Residents number about 3,000 at `ρ = 1` **[tunable]**. Two neighbouring leaf areas that touch Kabuki's polygon stand as **tier 1 stubs** with counts only, so border pair indices exist.

| In M3 | Out of M3 |
|---|---|
| Processes `city.shape`, `city.events`, `city.mirror`, `people.shape`, `order.norms`, `order.stocks`, `order.ledger`, `group.decide` (Tyger Claws and The Mox), `scene.acts` | `city.tension`, `city.flow`, `order.contracts`, `order.members` (phase 2) |
| The ten-kind catalogue, opportunity fields, propensity, counts, summaries, events, offspring, the calendar, heat and bands, regime arrivals (exogenous only) | Suppression, police pressure as a dial, unrest, infrastructure graphs, slow variable |
| The recipe, residents, households, spells, traits, archetypes (about eight), names | Far ties, covert effects, governance records |
| The tie function with materialisation; the tie record's reduced form; one norm pair (pay the Friday fee, do not talk to the uniforms) with the public tag, efficacy, cynicism and the report chance | Rumour reach; outlets; blacklists; the protection market |
| Reputation: carriers, ledger, `aggregate`, labels for V among Kabuki's stallholders and Tyger Claws | Informants, the fixer chain, defection cascades |
| Policies `urgency` (R, S, D, P, X, C, Y), `frames`, `v.frames`, `concerns` O1 to O5, `goals` with a means library of about ten, `dilemma`, `witness`, `social` for focal people, `fade`, `change` for the focal set, `ties`, `reconcile` | O6 and O7; the memory machinery |
| The mirror against the **offline replay port**: the facts table's 93 facts and the twelve event kinds, from hand-authored story states ([D-18](decisions.md)) | A live game |
| The production gate | |
| The focal set: the R1 character as a mirrored canon node with beliefs about V, two vendors, one fixer. Tier 4 for about 100 persons at most | Tier 5 |

**Deliverables:** S1 itself, written with each process described in the ODD order (purpose and patterns, entities and scales, scheduling, design concepts, initialisation, input, submodels), with the three validity tests named on each page (VLD-01); the TypeScript reference implementation of the above; the replay feed; the fixtures below; the phase 1 pattern battery; and a template-written week in Kabuki, shown to readers who know the game, for panel P-C (M14-17, P15-01). The panel decides whether phases 2 and 3 are needed at all.

**New fixtures (S1-F)**, beside S0's F-1 to F-25 and the drive fixtures D-a to D-n:

| # | Fixture | Expected |
|---|---|---|
| S1-F-1 | A mirrored person dies in the game | Their frames are abandoned and edges ended; beliefs about them stand; one correction record |
| S1-F-2 | Two runs with V in different cells, and with `gameOwnedNow` toggled | Identical coarse histories. A covered cell has the lower rate |
| S1-F-3 | Load an older save after the game's state changed | `reconcile` supersedes only what the game contradicts; history is intact |
| S1-F-4 | A class at ceiling 0; 10,000 sampled events; a person with no age class | Zero counts and zero children for the class; no minor or unclassed person in a victim, target or hostile role; V never a target |
| S1-F-5 | A raw death event | One derived event with the raw event as cause, exempt from the gate, identical after a reload |
| S1-F-6 | `city.mirror` under 12 ticks and under one | Identical |
| S1-F-7 | One binding key across a reload | The same resident; an observed pin persists |
| S1-F-8 | `exptab` in two implementations; `pow` by `ln` | Bit-identical; error under 0.05 % |
| S1-F-9 | F-9 with minted telling events | The last listener's `evidence` is the origin's |
| S1-F-10 | Fade at the hold; a memory setting raised | Non-memorable dropped at the hold, memorable kept; the raised setting changes nothing already dropped by a stricter run |
| S1-F-11 | The audits of [§7.6](#76-the-honesty-lints) | Zero findings |
| S1-F-12 | Two processes in one span | Neither's output depends on the other's within the span |

**The measures for phase 1:** M14-01, -03 to -10, -14, -16, -20, -22 to -24 and M15-01 to -05, -11, -14 to -18, -24, -27, on at least 20 world seeds, with calibration and validation seeds apart (VLD-09). The 100-game-year soak on 20 seeds under the memory guard (S23-S0-12) runs from phase 2. It carries the feedback-loop test of dossier 18's REP-06: whether violence per district rises with a district's demographic share beyond what the declared variables explain. **Phase 2 starts only after phase 1's measures pass** ([S14-S1-27](craft/d14-city-events.md#111-s1-the-simulation-layer), [S15-S1-28](craft/d15-people-networks-order.md#111-s1-the-simulation-layer)). One S1 process, `city.events`, is reimplemented from its written page by someone who has not seen the code, and the disagreements are filed as specification gaps (VLD-08).

**What M3 asks of the game:** nothing. The in-game rows ([§18](#18-open-questions-for-s1)) are batched into one prepared session with a friction log, run by the maintainer when M4 starts, and none of them blocks M3.

## 20. Requirements trace

**Disposition:** **M3** is built for milestone M3 ([§19.2](#192-the-first-implementation-sized-for-milestone-m3)). **P2** and **P3** are phases 2 and 3 of the dossiers' own first-cut orders. **Deferred** waits on something named. **Shared** is split with another owner. **Elsewhere** belongs to another layer, and its row says which. **Declined** is not adopted, and [§17](#17-where-the-dossiers-differ-and-the-compromises) says why.

### 20.1 The kernel's hand-off and the plan

| Requirement | Where | Disposition |
|---|---|---|
| S0 §0.1: drive urgency | [§8.3](#83-urgency) | M3 |
| S0 §0.1: attribution | [§7.1](#71-witnessing-and-attribution) | M3 |
| S0 §0.1: rumour telling and distortion | [§7.2](#72-telling-and-lying), [§7.3](#73-rumour-and-reach) | M3 (focal), P2 (reach) |
| S0 §0.1: reputation aggregation | [§6.5](#65-reputation) | M3 |
| S0 §0.1: group decisions | [§8.6](#86-group-decisions) | M3 (two groups) |
| S0 §0.1: the conflict table's contents | [§8.5](#85-dilemmas-and-the-conflict-table) | M3 |
| S0 §17 item 4: the visible-slot perception policy | [§7.1](#71-witnessing-and-attribution) | M3 |
| S0 §9.4, V4-24: `coarseFine` on every process | [§2.1](#21-processes) | M3 |
| S0 §9.2, V4-23, V4-28: the production gate | [§11](#11-the-production-gate) | M3 |
| Plan P3: entities, facts, provenance, beliefs | [§4](#4-who-exists), [§2.5](#25-what-s1-writes-at-which-precedence), [§7](#7-beliefs-telling-and-forgetting) | M3 |
| Plan P3: tiers and how a fact is refined between them | [§13](#13-tiers-demand-and-catch-up) | M3 |
| Plan P3: mirroring, canon | [§3](#3-mirroring-the-game), [§3.5](#35-binding-people-to-bodies) | M3 |
| Plan P3: forgetting, persistence, save branching, determinism | [§7.5](#75-forgetting), [§15](#15-determinism-and-reload) | M3 |
| Design seeds DS-03, 04, 06, 07, 15, 29, 32, 34 | [§3.5](#35-binding-people-to-bodies), [§15](#15-determinism-and-reload), [§2.5](#25-what-s1-writes-at-which-precedence), [§7](#7-beliefs-telling-and-forgetting), [§13](#13-tiers-demand-and-catch-up), [§5.2](#52-incidents), [§3.2](#32-what-is-mirrored-and-how), [§3](#3-mirroring-the-game) | M3 |
| Design seeds DS-47 to 51, 54, 55, 57 to 60, 64, 66 | [§4.1](#41-the-world-index-slice), [§4.2](#42-cells-and-the-population-recipe), [§13](#13-tiers-demand-and-catch-up), [§8](#8-drives-urgency-and-decisions), [§4.3](#43-residents-households-spells-and-traits), [§6.2](#62-groups-and-membership), [§7](#7-beliefs-telling-and-forgetting), [§8.3](#83-urgency) | M3 |

### 20.2 Dossier 1: motivation, drives and goals (sections, no numbered list)

| Requirement | Where | Disposition |
|---|---|---|
| §8 catalogue v1, §8.8 the catalogue as data | [§8.1](#81-drives-as-data-and-frames-on-demand) | M3 |
| §9.1 frame weight from importance and urgency | [§8.1](#81-drives-as-data-and-frames-on-demand) | M3 |
| §9.2 the urgency model families | [§8.3](#83-urgency) | M3 except O (P2); `exp` replaced ([§17](#17-where-the-dossiers-differ-and-the-compromises) 4) |
| §9.3 relief; §9.4 the unpinned default; §9.5 evaluation and pins | [§8.3](#83-urgency) | M3 |
| §10 importance in layers; §10.6 change only by contribution | [§8.2](#82-importance) | M3 |
| §11.1 and §11.2 group drives, operative weights, divergence | [§8.6](#86-group-decisions) | M3 |
| §11.3 ethos vectors | [§8.2](#82-importance) (pack data) | M3; lore review open |
| §11.4 how a group's wants reach members; pressure | [§8.6](#86-group-decisions) | M3 |
| §11.5 households | [§6.2](#62-groups-and-membership), [§4.3](#43-residents-households-spells-and-traits) | M3 |
| §12 the director's and seeds' drives | [§8.7](#87-what-s1-hosts-for-other-layers) | Elsewhere (S2, S3) |
| §13.1 and §13.2 the chain and the seven generators | [§8.4](#84-concerns-and-goals) | M3 (O1 to O5), P2 (O6, O7) |
| §13.3 and §13.4 choosing a goal; commitment | [§8.4](#84-concerns-and-goals) | M3 |
| §13.5 outcomes as events; §13.6 intent to act | [§8.4](#84-concerns-and-goals), [§8.6](#86-group-decisions), [§10](#10-what-is-minted-for-the-sifter) | M3 |
| §13.7 fixtures D-a to D-n | [§19.2](#192-the-first-implementation-sized-for-milestone-m3) | M3 |
| §14 Night City's pressures | [§5](#5-routines-and-the-citys-events), [§6](#6-ties-groups-norms-order-and-reputation) | M3 (no special mechanism) |
| DRV-47, DRV-48 attribution | [§7.1](#71-witnessing-and-attribution) | M3 |
| DRV-46 `care`; DRV-49 the model of V | [§8.7](#87-what-s1-hosts-for-other-layers) | Elsewhere (S3) |

### 20.3 Dossier 2: relationships (P3 list, 1 to 31)

| # | Requirement | Where | Disposition |
|---|---|---|---|
| 1 | Two directed regard records, a shared tie edge, beliefs | [§6.1](#61-ties-and-bonds) | M3 (focal ties) |
| 2 | No record of V's regard or desire | [§6.1](#61-ties-and-bonds) | M3 |
| 3 | Coarse tie `{kind, status, strength, last_contact}`; open and close | [§6.1](#61-ties-and-bonds) | M3 |
| 4 | Commitment from satisfaction, investment, alternatives | [§6.1](#61-ties-and-bonds) | M3 |
| 5 | Trust as three scalars with evidence count and attribution | [§6.1](#61-ties-and-bonds) | M3 (focal ties) |
| 6 | Status apart from private variables; V-involving change needs an observed act and acceptance | [§6.1](#61-ties-and-bonds) | M3 |
| 7 | Typed interaction events citing their cause | [§6.1](#61-ties-and-bonds), [§10](#10-what-is-minted-for-the-sifter) | M3 (focal ties) |
| 8 | Reply classification; no answer is not a rebuff | [§6.1](#61-ties-and-bonds) | M3 |
| 9 | A gift is an act read through the NPC's concern | [§6.1](#61-ties-and-bonds) | M3 |
| 10 | Bids at a low trait rate from a library | [§6.1](#61-ties-and-bonds) | P2 |
| 11 | Novelty tracking as a hint for S3 | [§6.1](#61-ties-and-bonds) | P2 |
| 12 | Quality and currency derived; pin on bucket change | [§6.1](#61-ties-and-bonds) | M3 |
| 13 | Decay and maintenance profile per kind | [§6.1](#61-ties-and-bonds) | P2 |
| 14 | `expected_interval` belief about V's rhythm | [§6.1](#61-ties-and-bonds) | P2 |
| 15 | Reunion policy, warm by default | [§6.1](#61-ties-and-bonds) | M3 (focal ties) |
| 16 | Evidence list with salience; half-memory allowed | [§6.1](#61-ties-and-bonds), [§7.5](#75-forgetting) | M3 list; half-memory deferred with the machinery |
| 17 | Acceptance keyed so a reload reproduces it | [§6.1](#61-ties-and-bonds), [§15](#15-determinism-and-reload) | M3 |
| 18 | Forbid retention scheduling, loss by absence alone, guilt and streak effects | [§6.1](#61-ties-and-bonds) | M3 |
| 19 | Boundaries as persistent pins | [§6.1](#61-ties-and-bonds) | M3 |
| 20 | Pursuit budget | [§6.1](#61-ties-and-bonds) | M3 |
| 21 | One-input retract, soft exclusion | [§6.1](#61-ties-and-bonds) | M3 |
| 22 | Never generate intimate content; read content settings | [§6.1](#61-ties-and-bonds), [§11](#11-the-production-gate) | M3 |
| 23 | Closure rule for NPC to NPC ties; unbalanced triads | [§6.1](#61-ties-and-bonds), [§17](#17-where-the-dossiers-differ-and-the-compromises) 9 | **Declined** as a rule: shared foci give closure; the sifter detects triads (S3) |
| 24 | Rivalry salience, possibly one-sided | [§6.1](#61-ties-and-bonds) | P2 |
| 25 | Mentor phases and functions; separation as an expected exit | [§6.1](#61-ties-and-bonds) | P2 |
| 26 | `via` on a tie; `protects` interests above a commitment threshold | [§6.1](#61-ties-and-bonds) | M3 |
| 27 | Propagate loss, exit and betrayal into dependants' concerns | [§6.1](#61-ties-and-bonds) | P2 |
| 28 | Audit openness, bid rates and loyalty by tag; count authored rules per kind | [§4.5](#45-source-lint-and-the-representation-audit) | M3 |
| 29 | Mark each tie-kind policy that borrows a couples result, with a fixture | [§6.1](#61-ties-and-bonds) | M3 |
| 30 | Numbers quiet on the surface, open to traces | [§6.5](#65-reputation), [§12](#12-what-s1-exposes) | M3 |
| 31 | Calibration fixtures: cold-reunion share, bids per tie per week, surfaced moments, declines that continue as friendships | [§19.2](#192-the-first-implementation-sized-for-milestone-m3) | P2 (bids), M3 (the rest) |

### 20.4 Dossier 6: the gaps that route through S1

| Requirement | Where | Disposition |
|---|---|---|
| G-1 beliefs are not Changes | [§7.2](#72-telling-and-lying), [§10](#10-what-is-minted-for-the-sifter) | M3 (focal) |
| G-2 frame status changes | [§8.4](#84-concerns-and-goals), [§10](#10-what-is-minted-for-the-sifter) | M3 |
| G-3 outcome and intent on events | [§10](#10-what-is-minted-for-the-sifter) | M3 |
| G-4 betrayal, deceit, promise, refusal, threat, confession | [§7.2](#72-telling-and-lying) | M3 (kinds), P2 (policies) |
| G-5 delivery to S3; G-8 the sifter's persisted state | S3 and S0 | Elsewhere |
| G-6 non-canon events are forgotten | [§5.2](#52-incidents) (the ring) | M3 |
| G-7 fine-tier events are silent | [§2.1](#21-processes) (`scene.acts`), [§10](#10-what-is-minted-for-the-sifter) | M3 |
| R-30 the eight gaps go to the owners with a route | [§10](#10-what-is-minted-for-the-sifter) | M3 |
| MAP-05 belief and truth divergence needs a trigger | [§7.2](#72-telling-and-lying) | M3 |

### 20.5 Dossier 10: NPC change, and the S1 rows of S10-P5

| Requirement | Where | Disposition |
|---|---|---|
| S10-P5-07 NPC change policy | [§9](#9-npc-change) | M3 (focal set); cap per [§17](#17-where-the-dossiers-differ-and-the-compromises) 8 |
| S10-P5-08 rationalisation and reversal | [§9](#9-npc-change) | M3 |
| S10-P5-13 reputation aggregation by domain | [§6.5](#65-reputation) | M3 |
| S10-P5-23 canon NPCs | [§4.4](#44-the-protected-set-canon-people-and-the-spine), [§9](#9-npc-change) | M3 |
| S10-S2-15 `stability` class | [§4.3](#43-residents-households-spells-and-traits) | M3 |
| S10-S2-08 the `turning` event, minted by S1 | [§9](#9-npc-change), [§10](#10-what-is-minted-for-the-sifter) | M3 |

### 20.6 Dossier 11: saves, memory and forgetting

| Requirement | Where | Disposition |
|---|---|---|
| S11-S0-01 session independence; no epoch in a key | [§15](#15-determinism-and-reload), [§8.4](#84-concerns-and-goals) | M3 |
| S11-S0-02 the load class is bookkeeping and no policy reads it | [§7.6](#76-the-honesty-lints) | M3 |
| S11-S0-03 to -05 belief fields, lazy accessibility, widening | [§7.5](#75-forgetting) | Deferred with S0 V4-30 |
| S11-S0-06 settings in the ledger | [§7.5](#75-forgetting) (S0 V4-12) | M3: recorded; `memoryScale` inert |
| S11-S0-07 telling carries its operator | [§7.2](#72-telling-and-lying) | M3; `source` not `evidence` ([§17](#17-where-the-dossiers-differ-and-the-compromises) 6) |
| S11-S0-08 the commit window | S6 and P7 | Elsewhere |
| S11-S0-09 coalesce, cap and floor | [§7.5](#75-forgetting) | M3: floor and cap by non-promotion. Coalescing deferred |
| S11-S0-10 the recall hook | [§7.5](#75-forgetting) | Deferred with S0 V4-30 |
| S11-S0-11 fixtures | [§19.2](#192-the-first-implementation-sized-for-milestone-m3) (S1-F-10 and S0 F-16 to F-20) | M3 |
| S11-S0-12 the S1 policy list: salience rating | [§7.1](#71-witnessing-and-attribution) | M3 |
| S11-S0-12: memory trait classes | [§4.3](#43-residents-households-spells-and-traits) | M3: class drawn. Effect deferred |
| S11-S0-12: institutional belief flag, arrivals' gist | [§7.5](#75-forgetting) | M3 |
| S11-S0-12: telling rates and hop limits | [§7.2](#72-telling-and-lying) | M3 |
| S11-S0-12: faster fade for hearsay from an unmet source; the error allowlist | [§7.5](#75-forgetting) | Deferred |
| MEM-13 harms, debts and promises persist by class | [§7.1](#71-witnessing-and-attribution) | M3 |
| CTY-01 three channels, three lifetimes; CTY-04 traces | [§7.3](#73-rumour-and-reach) | P2 |
| CTY-02 reputation is a gist; CTY-06 standing does not decay by absence | [§6.5](#65-reputation) | M3 |
| CTY-03 turnover; CTY-05 groups remember differently | [§7.5](#75-forgetting) | M3 |

### 20.7 Dossier 14: city events

| # | Requirement | Where | Disposition |
|---|---|---|---|
| S14-S1-01 | The five processes | [§2.1](#21-processes) | M3 (`shape`, `events`, `mirror`); P2 (`tension`, `flow`). Mirror at period 1 |
| -02 | The kind registry and its lints | [§5.2](#52-incidents) | M3 |
| -03 | Opportunity fields from the world index | [§5.2](#52-incidents), [§4.1](#41-the-world-index-slice) | M3 |
| -04 | Stable propensity; the hot list | [§5.2](#52-incidents) | M3 |
| -05 | Counts, scopes and sizes | [§5.2](#52-incidents) | M3 |
| -06 | Summaries and events | [§5.2](#52-incidents), [§10](#10-what-is-minted-for-the-sifter) | M3 |
| -07 | Offspring and the calendar | [§5.2](#52-incidents) | M3 |
| -08 | Heat, hot lists and bands | [§5.2](#52-incidents) | M3 |
| -09 | The interaction matrix and modifiers | [§5.2](#52-incidents), [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3) | M3 (matrix), P2 (modifiers) |
| -10 | Pair tension and strength | [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3) | P2 |
| -11 | Ties and grievance | [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3) | P2 |
| -12 | Suppression | [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3) | P2 |
| -13 | Police pressure and reports | [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3), [§6.4](#64-order) | P2 (the report chance is M3) |
| -14 | Regimes | [§5.3](#53-regimes-the-slow-variable-and-service-status) | M3 (exogenous arrivals), P2 (the rest) |
| -15 | Unrest | [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3) | P3 |
| -16 | Infrastructure | [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3) | P3, first cut: exogenous outages |
| -17 | Rumour and knowledge | [§7.3](#73-rumour-and-reach) | P2 |
| -18 | Flows | [§2.1](#21-processes), [§7.3](#73-rumour-and-reach) | P3 |
| -19 | Routines | [§5.1](#51-routines) | M3 |
| -20 | The mirror | [§3.3](#33-two-levels-of-event-and-what-the-gate-does-to-them) | M3 |
| -21 | Realisation | [§5.5](#55-realisation-candidates) | **Shared** with P8 |
| -22 | Arithmetic and keys | [§15](#15-determinism-and-reload) | M3 |
| -23 | State and persistence | [§15](#15-determinism-and-reload) | M3 |
| -24 | Catch-up and budget | [§13](#13-tiers-demand-and-catch-up), [§14](#14-performance-and-memory-budgets) | M3; lag, not period change |
| -25 | Slow variables and residuals | [§5.3](#53-regimes-the-slow-variable-and-service-status) | P3 |
| -26 | The protected set | [§4.4](#44-the-protected-set-canon-people-and-the-spine) | M3 |
| -27 | First-cut order | [§19](#19-simplicity-check-and-the-first-implementation) | M3 |
| S14-S0-01 to -04 | Arithmetic scope, summaries, settings, fixtures F-21 and F-22 | Adopted in S0 v4.2 (V4-14 to V4-17); [§15](#15-determinism-and-reload) relies on them | M3 |
| S14-S2-01 | Predicate atoms from hot state | [§12](#12-what-s1-exposes) | M3 (`band`), P2 (the rest) |
| S14-S2-03 | Sifter inputs: about ten Changes an hour | [§5.2](#52-incidents), [§10](#10-what-is-minted-for-the-sifter) | M3 |
| S14-S2-04, -05 | Occurrence is not the director's; grudges are offers | [§1](#1-what-layer-1-beyond-the-kernel-is) principle 4, [§8.6](#86-group-decisions) | M3 |
| S14-S2-06 | One carrier schema | [§7.3](#73-rumour-and-reach) | P2 |
| S14-S2-07 | The return digest | [§5.2](#52-incidents) (the ring), [§7.3](#73-rumour-and-reach) | S1 supplies the ring and the beliefs; S2 builds the digest |
| S14-S2-08 | Game-owned incidents are fixed material | [§3.3](#33-two-levels-of-event-and-what-the-gate-does-to-them), [§3.6](#36-where-game-truth-overrides-simulation) | M3 |
| S14-S2-10 | Author tooling: a week in a district | [§12](#12-what-s1-exposes) (the data) | S1 supplies; P10 builds |

### 20.8 Dossier 15: people, networks, order

| # | Requirement | Where | Disposition |
|---|---|---|---|
| S15-S1-01 | The processes | [§2.1](#21-processes) | M3 and P2 |
| -02 | Population recipes | [§4.2](#42-cells-and-the-population-recipe) | M3 |
| -03 | Residents and households | [§4.3](#43-residents-households-spells-and-traits) | M3 |
| -04 | Spells and lifetimes | [§4.3](#43-residents-households-spells-and-traits) | M3 |
| -05 | Identity binding | [§3.5](#35-binding-people-to-bodies) | M3 (replay port); S5 read open |
| -06 | Source lint and the representation audit | [§4.5](#45-source-lint-and-the-representation-audit) | M3 |
| -07 | The implicit tie function | [§6.1](#61-ties-and-bonds) | M3 (no far ties) |
| -08 | Materialisation | [§6.1](#61-ties-and-bonds) | M3 |
| -09 | Position and brokerage | [§6.1](#61-ties-and-bonds), [§6.6](#66-contracts-hazards-and-the-fixer-chain-phase-2) | P2 |
| -10 | Covert effects | [§6.1](#61-ties-and-bonds) | P3 |
| -11 | Norms | [§6.3](#63-norms) | M3 |
| -12 | Efficacy, cynicism, report chance | [§6.4](#64-order) | M3 |
| -13 | Enforcement events and ladders | [§6.3](#63-norms) | M3 |
| -14 | The ledger and `aggregate` | [§6.5](#65-reputation) | M3 |
| -15 | Telling and blacklists | [§7.2](#72-telling-and-lying) | M3 (telling), P2 (blacklists) |
| -16 | Help rates and signal stages | [§6.5](#65-reputation) | P2 (the stage type is S2's) |
| -17 | The protection market | [§6.4](#64-order) | P2 |
| -18 | Regimes | [§5.3](#53-regimes-the-slow-variable-and-service-status) | P2 |
| -19 | Group governance records | [§6.4](#64-order) | P3 |
| -20 | Independents | [§4.2](#42-cells-and-the-population-recipe) | M3 (a share in the role table) |
| -21 | Succession and removal | [§6.2](#62-groups-and-membership) | P2 |
| -22 | Police style, corporate zones, corruptibility | [§6.4](#64-order) | P3 |
| -23 | Contracts and hazards | [§6.6](#66-contracts-hazards-and-the-fixer-chain-phase-2) | P2 |
| -24 | Dilemmas, defection, exit | [§8.5](#85-dilemmas-and-the-conflict-table), [§6.2](#62-groups-and-membership) | M3 (options), P2 (cascades, informants) |
| -25 | Interfaces to other dossiers, the firewall | [§6.5](#65-reputation), [§5.4](#54-tension-suppression-police-and-unrest-phases-2-and-3) | M3 |
| -26 | Arithmetic and keys | [§15](#15-determinism-and-reload) | M3 |
| -27 | State, catch-up and budget | [§13](#13-tiers-demand-and-catch-up), [§15](#15-determinism-and-reload) | M3 |
| -28 | First-cut order | [§19](#19-simplicity-check-and-the-first-implementation) | M3 |
| S15-S0-01 to -03 | Implicit edge types (deferred), the `aggregate` contract, fixtures F-23 to F-25 | Adopted in S0 v4.3; [§6.1](#61-ties-and-bonds), [§6.5](#65-reputation), [§16](#16-what-the-kernel-and-the-other-specifications-still-need) | M3 |
| S15-S2-01 to -03, -05, -08 | The reads S1 supplies; fixer offers; casting through ties; the betrayal budget; reflection by behaviour | [§12](#12-what-s1-exposes), [§6.6](#66-contracts-hazards-and-the-fixer-chain-phase-2), [§6.1](#61-ties-and-bonds), [§6.2](#62-groups-and-membership), [§6.5](#65-reputation) | M3 and P2 |
| S15-S2-10, -11 | Author tooling; content dials as lenses | [§12](#12-what-s1-exposes), [§11](#11-the-production-gate) | S1 supplies data; M3 |

### 20.9 Dossier 17: setting data

| # | Requirement | Where | Disposition |
|---|---|---|---|
| S17-S1-01 | Leaf-keyed dimensions | [§4.1](#41-the-world-index-slice) | M3 |
| -02 | Derived indices from game traces | [§4.1](#41-the-world-index-slice) | M3 |
| -03 | Faction presence by leaf | [§4.1](#41-the-world-index-slice) | M3 |
| -04 | A slow district variable | [§5.3](#53-regimes-the-slow-variable-and-service-status) | P3 |
| -05 | Price level | [§5.3](#53-regimes-the-slow-variable-and-service-status) | P3 |
| -06 | Standing rumours | [§7.3](#73-rumour-and-reach) | P2 |
| -07 | Media reach and ad mix | [§7.3](#73-rumour-and-reach) | P3 |
| -08 | Corporate procedure load per leaf | [§5.3](#53-regimes-the-slow-variable-and-service-status) | P3 |
| -09 | Product availability feeding `reach` | [§12](#12-what-s1-exposes) | P3 |
| -10 | Routine baselines | [§5.1](#51-routines) | M3 |
| -11 | Refuge status | [§5.3](#53-regimes-the-slow-variable-and-service-status) | P2 |
| -12 | Outlets as actors | [§7.3](#73-rumour-and-reach) | P2 |

### 20.10 Other dossiers' rows that name S1

| Requirement | Where | Disposition |
|---|---|---|
| D18 S18-S4-02 event kinds carry classes | [§11](#11-the-production-gate) | M3 |
| D18 S18-S0-02 person `ageClass` mirrored from the child flag | [§4.3](#43-residents-households-spells-and-traits) | M3 |
| D18 S18-S0-03, TAX-03, ENF-03 lines refuse events at production | [§11](#11-the-production-gate) | M3 |
| D18 floors on minors and real people | [§11](#11-the-production-gate) | M3 |
| D18 M18-06 to M18-10 population audit; REP-06 feedback-loop test | [§4.5](#45-source-lint-and-the-representation-audit), [§19.2](#192-the-first-implementation-sized-for-milestone-m3) (the soak run) | M3 |
| D20 keep `causes`, `served`, `witnesses`, `place`; intent records for focal people | [§7.4](#74-common-ground-and-perspective-reads) | M3 |
| D20 STG-01 one table for realisation and stage kits | [§5.5](#55-realisation-candidates) | Shared with P8 |
| D20 XPL-04 the "why" answer reads causes | [§12](#12-what-s1-exposes) | M3 |
| D21 common ground, `witnessed` and `told`, reportability | [§7.4](#74-common-ground-and-perspective-reads) | M3 |
| D12 S12-P5-11, LIN-10 the firewall | [§6.5](#65-reputation), [§7.6](#76-the-honesty-lints) | M3 |
| D8 S8-P5-18 "depth ready" | [§12](#12-what-s1-exposes) (`depth`) | M3 |
| D22 asks S1 for nothing beyond D21's | [§7.4](#74-common-ground-and-perspective-reads) | M3 |

### 20.11 Dossier 23: validating the simulation

| Requirement | Where | Disposition |
|---|---|---|
| VLD-01 describe each process in ODD order; name the three validity tests on each page | S1 follows this page's table and the ODD order per process | M3 |
| VLD-02, S23-P9-05 declare the patterns before calibrating | [§2.1](#21-processes) (the last column), [§19.2](#192-the-first-implementation-sized-for-milestone-m3) | M3 |
| VLD-03, S23-S0-07 every process declares its agreement | [§2.1](#21-processes) | M3 |
| VLD-04, S23-P9-06 twin runs over many worlds | [§15](#15-determinism-and-reload) | M3 |
| VLD-05 elaboration agrees with the abstract past | [§13](#13-tiers-demand-and-catch-up), [§3.4](#34-reconciling-on-load-and-on-a-jump) | M3 |
| VLD-06, VLD-07 partition, reload and regeneration are exact | [§15](#15-determinism-and-reload) | M3 |
| VLD-08 reimplement one process from its page | [§19.2](#192-the-first-implementation-sized-for-milestone-m3) (`city.events`) | M3 |
| VLD-09, S23-P9-07 sweep the judgement constants; keep calibration and validation apart | [§19.2](#192-the-first-implementation-sized-for-milestone-m3) | M3 |
| VLD-10 believability is judged by people | [§19.2](#192-the-first-implementation-sized-for-milestone-m3) (panel P-C) | M3 |
| VLD-11, S23-S0-12 long runs and runaways | [§14](#14-performance-and-memory-budgets), [§19.2](#192-the-first-implementation-sized-for-milestone-m3) | P2 (the 100-year soak) |

