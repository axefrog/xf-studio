# P4. The seeding layer and the seed language

**Status:** design v0.1, 25 October 2026. v0.1 records what [S2 v1.11](spec/seeding.md) changed in the design: patterns generate seeds (§2), nudges, the promise an accepted offer leaves, unvoiced lines for the protagonist ([D-29](decisions.md)) and the two sources of harm ([D-30](decisions.md)) (§3.7), the job and heist shape (§3.8), and layering (§4.5). Design v0, 22 October 2026. This is second-level plan P4 of the [first-level plan](plan.md#5-second-level-plans), the design stage for layer 2. The normative specification, S2, follows from it. It builds on:
- the [foundation](foundation.md);
- the kernel specification [S0 v3.1](spec/kernel.md);
- the requirement lists of dossiers [2](craft/d02-relationships.md#10-requirements-for-the-seed-language-p4), [3](craft/d03-fitting-casting.md#9-requirements-for-the-seed-language-p4), [4](craft/d04-quest-structure.md#10-requirements-for-the-seed-language-p4), [5](craft/d05-units-variety.md#9-requirements-for-the-seed-language-p4), [7](craft/d07-direction-pacing.md#9-requirements-for-the-procedural-engine-p5) and [9](craft/d09-agency-consequence.md#11-requirements-for-the-procedural-engine-p5-and-authored-content-p6), each traced in §9.

It absorbs design seeds DS-02, DS-05, DS-12, DS-13, DS-14, DS-20, DS-27, DS-28, DS-35, DS-40, DS-41 to DS-44, DS-67 and DS-68, and the layer-2 half of DS-69.

## 1. What layer 2 is

Layer 2 is **the only way content enters the simulation** ([D-02](decisions.md)). Human authors (layer 4) and the procedural engine (layer 3) use the same door, and other plugins use it through `story.seed@1` ([DS-40](design-seeds.md)).

| Layer 2 owns | Layer 2 doesn't own |
|---|---|
| The seed language and its compiler | Proactive sowing, sifting and fitting judgement (layer 3, P5) |
| Casting (binding roles to the world) | The world model and simulation (layer 1, S0 and P3) |
| The seed lifecycle and its record | Rendering words and channels (P8) |
| Intersections between seeds | Authoring tools and pack format (P6) |
| The **arbiter**: every push to the player passes through it ([DS-69](design-seeds.md)) | The director's choice of what to propose and when (layer 3) |
| The exposure ledger: what V has been shown | |

## 2. A seed is a partly resolved quest

The foundation says a quest is a bundle and a seed is a partly resolved one ([foundation §6](foundation.md#6-story-in-the-same-space)). The language makes that literal. A **seed is a node of kind `core:seed`** whose slots hold its roles, windows, beats and intent. Compiling a seed produces ordinary kernel material:

| The author writes | It compiles to (S0) |
|---|---|
| A part marked **fixed** | A pin or a `constrain` contribution at precedence 400, reason `authored` |
| A part marked **preferred**, strength 1–3 | A `weight` contribution with that strength |
| A part left **open** | Nothing; fitting (layer 3) may contribute within the seed's latitude (§3.9) |
| A role | A `ref` slot on the seed node with a candidate query (§4.2) |
| A window | A frame interest on the seed's own actor frame (§3.5) |
| A beat | A fragment node; links are edges (§3.6) |
| A commitment ("this happened") | A pin, reason `committed` (precedence 300) |

A seed is also **an actor**: its context frame is "what this seed needs in order to happen" ([foundation §5](foundation.md#5-context-and-relevance)). So its windows, roles and needs are ordinary interests. The kernel's matching (§10.5) tells the seed when the world moves towards or away from it. There's no separate polling.

**Patterns generate seeds** ([D-27](decisions.md), [D-28](decisions.md); [S2 §2.24](spec/seeding.md#224-patterns-in-seeds)). The composite's [pattern language](composite/pattern-language.md) adds a level above the seed. A **story pattern** is a partial causal graph of junctures, which layer 3 matches against the record; a live instance of it is the story, and a seed is one scene of it that V plays or sees. Junctures the world fills need no seed. A juncture that must reach V is realised by a seed layer 3 sows; one that needs only an off-screen reason or opportunity, by a **nudge**, a seed that never reaches V ([S2 §2.25](spec/seeding.md#225-nudges-seeds-that-never-reach-the-protagonist)). A seed may declare the junctures it realises, and every seed has an implicit pattern derived from its beat graph, so even a fully authored story shares junctures with procedural ones, through the world events its beats leave. The two documents stay distinct: a seed's graph is about V's offers, stances and exits, and a pattern's about the world's causes.

**One representation at every scale** ([DS-28](design-seeds.md)): a passing encounter, a gig and an arc are all seeds made of fragments. They differ in level, cast depth and the distance between setup and payoff.

## 3. The language

The language is declarative data, with no code ([DS-38](design-seeds.md)). It is versioned and lintable, and every construct has a defined compile target. This section lists its constructs. S2 gives the exact schema.

### 3.1 Identity, purpose and intent

- **Identity:** `id`, `version`, `pack`, `level` (phrase, exchange, beat, encounter, job, arc), `parent` (with its purpose), `children`.
- **Purpose:** tags from the composite's closed vocabulary, plus one sentence.
- **Context:** a required field, so nothing selects behaviour by type alone.
- **The intent record:**
  - an **end state** as predicates;
  - **prohibitions** as predicates;
  - **theme and tone** tags, each with a role (supports, opposes, complicates);
  - **aesthetic preferences** as a few coarse weights on a closed library of features.

  Fitting works towards the end state and never crosses a prohibition.
- **Binding status on every part:** fixed, preferred (strength 1, 2 or 3) or open. Unstated parts are open. Each part can carry an intent note, and a `withdraw-if-rejected` mark (§4.3).

### 3.2 Roles

A role is a typed slot:
- **Kind and identity or constraints.** Each constraint is graded required, preferred or free.
- **Anchor or open.** An anchor role is cast first; the others follow it.
- **`on-unfilled`.** A ladder: wait, relax in a declared order, use a stand-in, shrink the seed, withdraw. There is a default.
- **Exclusivity:** a claim over a span of game time, with sharing declared.
- **Memberships** that pull on the character, so cross-pressure can be found (kernel §10.8).
- **Tie kind** for roles defined by their relation to someone (companion, rival, mentor, kin), with its exits.
- **Authored grievances, beliefs and debts,** per direction, each with a reason. These compile to beliefs and edges.
- **Repertoire use:** casting prefers people whose repertoire holds a fragment the seed wants.
- **Text attributes:** text may refer to role attributes, and a checker verifies each reference against the role's required constraints.

**The client and the stake.** A job-like seed names its **client as a blocked goal** (a reference to a frame), and says what the client stands to lose. It also carries an **unattended plan**: what happens if V never engages ([dossier 9](craft/d09-agency-consequence.md)). A decline is the stake resolving without V.

### 3.3 Places and times

Places are roles of place kind, cast like any role. They use the 32 place dimensions from [P2](p2-game-substrate.md) area D ([places](../../knowledge/places.md) §12) and the world index. Wealth, danger and gang presence are derived there, not stored, and "public" is nine separate switches rather than one flag. So a place constraint such as `public == quiet` compiles to a derived predicate, not to a single game field. Times are windows (§3.5) or spans within them.

### 3.4 Effects

- **Declared effects only.** A seed writes its own namespace and commits pins.
- **Game-owned state** (facts, money, items, street cred) is written only through a declared capability, under the bridge's write class for vanilla state ([requirements H3](runtime-requirements.md)).
- **Rewards** are a reference to a policy table (by tier and route), never a literal.
- **Dependencies:** a seed declares the people, places and facts it needs to stay as they are, so the world can hold them or substitute for them.
- **Cadence limits:** how often it may recur, and how often a reaction may fire.

### 3.5 Windows

A **window** is a three-valued predicate (yes, no, maybe) over facts, with **reading guards** ([DS-68](design-seeds.md)). A negative condition such as "not dead" holds only once the quest that decides it has run.

- **Timing.** Windows declare `opens` and `closes`, and a seed may have several. They name game facts from the [main-story facts table](main-story-facts.json) or the seed's own namespace.
- **Closes the player controls.** For windows the player closes, such as the point of no return, the seed declares a **lead-time preference** and an **urgency signal**. Urgency comes from V's position and time, never from a calendar.
- **On close:** withdraw, degrade, coda or memory. There is a default.

Windows compile to interests on the seed's actor frame, `wants` and `blockedBy`, so the kernel reports their changes.

### 3.6 Fragments and beats

There is **one fragment type at every level**. A fragment:
- **declares its fit:** its `level`, its **needs** (facts it presupposes), its **leaves** (facts it establishes) and the slot roles it can fill;
- **declares its reuse:** applicability criteria (the most specific match wins, falling back to the general), **alternates** that are equal in function and grouped by tone, repeatability (never, n times, free), a minimum gap in time and in offers, a salience tier (foreground, background, oddity), and **scale forms** (short, standard, full);
- **declares its delivery:** a channel ladder (preferred channel, lowest acceptable) and a **rendering contract** (several phrasings; which may be reused);
- **reads only facts.** It never reads another fragment's internals, and keeps only the order constraints that are truly fixed.

Beats form a **graph with typed links:**
- `because` cites a record entry;
- `obstructed-by`;
- `then`, for texture beats only.

A validator rejects a seed whose only links are orderings. **Reconvergence** is explicit: graphs have joins, a variant is a condition on one graph rather than a copy, and live paths are bounded. Chains declare how to rejoin and how to skip.

**Structural constructs** from [dossier 4](craft/d04-quest-structure.md):
- **Route variables,** set by player acts. Each needs at least one declared consumer (a debrief, a reward, a consequence); a route with none is rejected.
- **Objectives** with states (active, succeeded, failed, inactive), plus **condition objectives** (stay unseen, don't kill).
- **A promise ledger:** typed promises with states (open, paid, retired). A seed can't resolve while an unmarked promise is open.
- **Failure forms:** a warning state comes before any failure from distance, time or neglect, and every failure leads to a consequence.
- **An aftermath stage** with a delay, a signpost and a cancel condition, reading the **exposure ledger** (§4.6).
- **Obstacles and affordances:** at least two affordances per obstacle, each a capability predicate with a cost and an exposure. No hidden roll decides an outcome. At least one resolution mode outside combat is reachable by any V.
- **Conclusions** need at least three independent clue routes ([DS-12](design-seeds.md)), with consistency per clue.
- **A decision beat** with a named person at stake, tagged so evaluation can count it.

### 3.7 Offers and choices

Every player-facing fragment is an **offer** with these parts ([dossier 9](craft/d09-agency-consequence.md)):
- the stakes, and who bears them;
- the supported actions, with a foresight hint per option;
- the **null path** as an authored option;
- a **lapse form**;
- the decline forms and their responses;
- **retract by one input**, with a quiet withdrawal.

**Choices** are marked flavour, consequential or unchoice. Each consequential option writes a distinct record with a declared consumer. Decisions declare their **stance span** (help, bargain, refuse, oppose, ignore), and fewer than three stances, or none that refuses, is linted.

**Honesty constructs** ([D-09](decisions.md)):
- the language has **no construct that asserts V's inner state**;
- response templates have a required `because` slot naming the NPC's concern that V's act touched;
- callbacks name V's **acts**, never V's reasons;
- a static check rejects text that evaluates V in the second person, reproaches, or claims V's feelings.

**Since S2 v1.11:**
- an offer names its **asker**, and accepting it with a stance that helps or bargains leaves a `promise` in the world, so an accepted plan is a fact others can learn of;
- an option shows **the exact words V says**: a recorded line, a splice of recorded lines, or new words left unvoiced, as text ([D-29](decisions.md)). Only a line the player picks is said;
- **harm or loss to V has two sources only:** a stake V accepted when an offer named it, faced as an obstacle with affordances; or a group's own decision to act against V under [D-30](decisions.md), which a seed may carry, and stage only as an encounter S1 authorised and still authorises whenever it plays, writing no harm itself: the game records any harm ([S2 §2.16a](spec/seeding.md#216a-groups-acting-against-the-protagonist)).

### 3.8 Profiles: shapes as data

Common shapes are **profiles**: data templates whose slots carry the same bindings as any seed. Profiles are data, not code.

| Profile | Shape | Source |
|---|---|---|
| **Gig** | Its eight parts (id and pin, unlock, brief and debrief, objectives, encounter, finish and fail facts, reward by route, retaliation) are produced, not hand-written | [Dossier 4](craft/d04-quest-structure.md); the game's gig wiring |
| **Job and heist** | **No longer a profile** (S2 v1.11): it is the composite's `heist` shape, a recogniser over smaller pattern instances that layer 3 never runs as a whole plot ([D-28](decisions.md)). What follows is the design those child patterns and authored heists draw on. Ordered stages, each with `requires`, an interference attachment and a failure modifier for the next stage. Crew roles combine capability and membership. The plan is a **belief** held by its planners, and a **reveal** pins the truth. Preparation is state, with a **flashback** operation that settles the crew's preparation late, at a cost. It is never used for V without the player's acceptance | Dossier 4; kernel §11 |
| **Con** | Long escalation around one mark, with an optional cooler role | Dossier 4 |
| **Four-beat** | Introduce, develop, twist, conclude | Dossier 4 |
| **Relationship ladder** | Named rungs as states of a closeness fact; at least **three exits** of distinct kind (decline, stay as now, lapse), each with authored content and equal status; offers and not-now paths at each rung; pacing counted from V's acts, never the clock; bids by kind; `on-long-absence` (reunion by default); boundaries as persistent pins only an authored event revises; an `intimate` scene class that only a human-authored pack scene can fill, with a content tag, a fade or veil alternative and no choices inside | [Dossier 2](craft/d02-relationships.md) |

### 3.9 Adaptation, variation and latitude

- **Adaptation points.** A seed lists them, each with a cost class, and has an explicit **cannot adapt** outcome.
- **Latitude** limits fitting's connecting material: which kinds are allowed, which are forbidden, and which parts stay authored-only.
- **A history-linked hook** may be requested, stating what kinds of V's history count.
- **Variation** ([dossier 5](craft/d05-units-variety.md)):
  - **declared axes:** situation, structure and slots;
  - **modes,** drawn first;
  - **discrete named variants;**
  - **rare variants,** which need a precondition;
  - **stratification hints;**
  - **computed skeleton features** (verb class, stake type, relationship, outcome class, tone, channel), exposed read-only for the arbiter and the tests;
  - **variety provenance** on every offer.

### 3.10 Timing requests

A seed states its **timing request** for the arbiter: priority, relevance window, attention cost, interrupt tolerance, expiry and the preferred scale form ([dossier 7](craft/d07-direction-pacing.md) §5.5).

### 3.11 Versions and migration

Every seed carries a version, and a policy for in-flight state when its pack updates: continue, migrate or withdraw.

## 4. The machinery

### 4.1 Compiling

The compiler turns a seed into the material of §2. It runs the lint (§4.8) first and refuses a seed that fails it. Compiled material is **pack contribution** (reloaded with the pack, never persisted, S0 §14.1). Run-time commitments are persisted pins.

### 4.2 Casting

Casting is a **read-only search until commit** ([DS-02](design-seeds.md)):
1. **Order.** Anchor roles first, then the declared order hint, then fail-first: the role with the fewest candidates.
2. **Search.** Each role is a kernel **query** (S0 §8): `must` from the fixed and required constraints, `prefer` from the preferred ones, with the role's scope.
3. **Record.** The result is a ranked list with reasons and candidate counts, recorded for the fit report.
4. **Exclusivity.** Claims are checked against bindings already held by live seeds.
5. **On failure.** A role that can't be filled runs its `on-unfilled` ladder.
6. **Commit.** Casting **commits** by pinning the bindings (reason `committed`) once the arbiter releases the first offer. Until then nothing in the world changes, so a trial cast needs no fork.
7. **At play time,** a committed cast is re-checked against **required** constraints only.

Casting is deterministic given the seed, the state and the kernel's hashed draws. Ties are explicit.

### 4.3 Fixed parts that lose

An authored fixed part (precedence 400) loses to game state (500) without the kernel reporting a contradiction ([DS-67](design-seeds.md)). Layer 2 therefore traces every fixed part after compiling, and again whenever its slots change. A rejected fixed part makes the seed **unsatisfiable**, and the seed's per-part policy applies:
- withdraw;
- degrade to a fallback;
- or, if the author allowed it, re-fit.

It is never silent: the event goes to the record and the fit report.

### 4.4 The lifecycle

| State | Meaning | Leaves by |
|---|---|---|
| `sown` | Compiled and live, windows not yet evaluated | Window evaluation |
| `waiting` | A window is shut, or a role can't yet be cast | A window opening and a successful cast |
| `cast` | Roles bound tentatively, read-only | The arbiter releasing the first offer, which commits the cast |
| `offered` | V has been offered it | Engaging, declining, lapsing or retracting |
| `running` | Its beats are unfolding | Resolution, failure forms or interruption |
| `resolved` | Its end state was reached, with or without V | — |
| `withered` | A window closed or a cast failed; its close form played | — |
| `withdrawn` | Its author or pack withdrew it, or a fixed part was rejected under `withdraw` | — |

- **Persistence.** Each transition writes a `SeedState` op (S0 §14.2).
- **Determinism.** Offer ids derive from the seed and the saved state, so a reload shows the same offer.
- **Declining.** A decline moves the seed to its unattended plan, and the client's goal goes on by its own urgency.

### 4.5 Intersections

Two live seeds **intersect** in any of three ways:
- they claim the same role or place for overlapping spans;
- one's effects touch another's needs or window;
- their memberships set up a cross-pressure dilemma (S0 §10.8).

Layer 2 detects intersections at cast and on every relevant change, through the seeds' own interests. It records each one. How it's resolved:
1. **Authored before procedural.** A procedural seed yields or re-casts.
2. **Two authored seeds:** the earlier-committed one keeps its binding, and the other runs its `on-unfilled` ladder. Unless both declared sharing, in which case they share.
3. **Cross-pressure** is never resolved away. It becomes story material for layer 3 to sift, and, since S2 v1.11, the entry of the composite's divided-loyalty pattern ([DS-11](design-seeds.md)).

**Layering is layer 3's.** Two pattern instances that share a filler (one theft that is both a loss for a courier and a strike for a rival crew) are layered. Layer 3 records it where it finds it ([S3 §6.6](spec/procedural.md#66-composition-story-events-chains-layers-and-shapes)); layer 2 has no intersection kind for it, because it reads no instance and has nothing to settle. Contests between seeds over a node stay claims, settled as above.

### 4.6 The record and the exposure ledger

Layer 2 keeps a **record** of what each seed did: its cast, its offers, V's responses, its transitions and its intersections. It also keeps the **exposure ledger** ([dossier 9](craft/d09-agency-consequence.md)): what V was actually **shown**. The ledger is built from the kernel's observed pins and events where V is a witness.

The ledger decides:
- whether an offer was declined or merely missed;
- whether a hard step may fire, because V must have seen its portent;
- whether a callback may cite an event.

### 4.7 The arbiter

**Everything that reaches V passes through the arbiter** ([DS-69](design-seeds.md)). It runs on a **session-local play clock** read from the event feed, never game time. So a night's sleep in game never releases a backlog.

For each **request** (§3.10) it applies **hard gates**:
- attention aspects (combat, driving, dialogue);
- vanilla UI states;
- spacing;
- a rolling cap;
- expiry;
- breakpoints.

It **holds, delays or withdraws**; it never adds content. Every offer is **retractable by one input**. Scheduling rules are contributions on the offer slot, not code ([dossier 5](craft/d05-units-variety.md)): separation as `constrain`; bags and growing chances as `weight` reading counts from the record. They relax by the kernel's own precedence.

The **tempo setting** (off, calm, steady, restless) scales the arbiter's cadence. "Off" means pull only, plus fitting of authored seeds ([D-02](decisions.md), [D-03](decisions.md)).

### 4.8 The lint and the fit report

These are layer 2 functions; P6 owns their interface.

**The static checks:**
- undeclared facts, and facts with several writers;
- roles that can't be filled in the sample states;
- conclusions with a single route, and route variables with no consumer;
- ladders with fewer than three exits, and exits with no content;
- gates on a partner fact;
- text asserting V's feelings, or second-person reproach;
- guilt, streak or countdown effects;
- `intimate` scenes with generated filler;
- delayed consequences with no early cue;
- stakes landing on V's resources without V's acceptance;
- text attributes beyond a role's guarantee;
- a check against the game port's capability report, in plain English.

**The fit report** runs a seed over sample states with fixed seeds. It gives:
- the verdict, the cast with reasons, the timing and the chosen channel;
- the connecting material;
- "no fit, and why";
- each exit and where it leads;
- a decline preview, and a replay with two policies.

Authors can pin any fitted choice back as fixed ([DS-43](design-seeds.md)).

## 5. Reference scenario R1 in this language

A sketch, not the schema. It is the authored romance side quest for a main-story character, as [dossiers 2](craft/d02-relationships.md) and [3](craft/d03-fitting-casting.md) worked it out.

```yaml
seed: xf.example:takemura-quiet-hour   # an illustrative pack id
level: arc
turns: [ { level: concern, what: tie(V, takemura).rung changed } ]   # S2 §2.13: an arc turns a concern
closing: pack:quiet-hour-closing
purpose: { tags: [bond, aftermath, loyalty], sentence: "Two people who survived the same betrayal find out what they are to each other." }
intent:
  end_state: [ tie(V, takemura).kind in {friend, partner} or seed.exit in {decline, lapse} ]
  prohibitions: [ asserts_v_feeling, gate_on_partner_fact ]
  tone: [ { tag: restraint, role: supports }, { tag: grief, role: complicates } ]
roles:
  takemura: { fixed: { identity: game:takemura }, anchor: true, on_unfilled: withdraw }
  place:    { preferred: { strength: 2, where: [ public == quiet, district == japantown ] } }
windows:
  - opens:  [ guard(q112_done) and q112_takemura_dead == 0 and allied(takemura) ]
    closes: [ q115_point_of_no_return == 1 ]
    lead_time: preferred
    on_close: coda
profile: relationship-ladder
  rungs: [ acquainted, confided, close, partner ]
  exits: [ decline, stay-as-friends, lapse ]   # each with authored content
  intimate: { scene: pack:quiet-hour-intimate, fade_alternative: pack:quiet-hour-fade, content_tag: romance-intimate }
  pacing: { from: v_act, min_gap: "one shared activity", backoff: after_decline }
  on_long_absence: reunion
fixed_parts: [ takemura, rungs, exits, intimate.scene ]   # withdraw-if-rejected on takemura
open: [ moment, channel, hook, connecting_material ]      # for fitting, within latitude
latitude: { allow: [ callback, holocall_hook ], forbid: [ new_named_character ], authored_only: [ intimate ] }
```

Fitting (layer 3) chooses the moment, the channel (a holocall is in character) and the hook, with callbacks to this V's history. Layer 2 casts the place, evaluates the window with its reading guards, watches the fixed `takemura` binding (§4.3), and releases offers through the arbiter.

If the window closes first, the coda plays. If V declines at any rung, the decline exit plays, and nothing presumes V's feelings.

## 6. What the kernel needs

Changes to fold into S0 v4, from this design and the dossiers:
1. **Derive functions take the query time as an input** ([DS-66](design-seeds.md)), for urgency and for windows.
2. **The `core:seed` kind and its facets.** A seed is an actor with frames, and its roles are `ref` slots.
3. **Three-valued predicates with guards,** for windows. They're evaluated in layer 2 over kernel reads, so the kernel needs no change unless S2 chooses to push them down.
4. **The eight kernel gaps** found by [dossier 6](craft/d06-sifting-tellability.md), reviewed together with these.

## 7. Open questions for S2

1. The closed vocabularies (purpose tags, theme and tone, aesthetic features, effect kinds, act vocabulary for callbacks) are to be seeded from the composite (P1 phase D). Until then, S2 ships a small starter set marked provisional.
2. The pack scene format for `intimate` and other authored scenes depends on P8 (channels) and the bridge's scene capability.
3. How much of the arbiter's gate logic lives in the companion versus the game-side plugin depends on the event feed's latency (P7).
4. Precedence between a procedural seed and the procedural engine's own re-casting needs one more rule, in P5.

## 8. Simplicity check

Every construct above traces to at least one dossier requirement (§9). Several constructs are **profiles** (data) rather than language features, so the core language stays small:
- parts with binding status;
- roles, windows and fragments with typed links;
- offers, effects and timing requests;
- intent.

Ladders, stage scripts, gigs and cons are all profiles.

## 9. Requirements trace

Dossier requirements and the sections that carry them. Every listed requirement is covered. Several dossier requirements belong to P5 or P6, and the last row says where they go.

| Dossier list | Covered in |
|---|---|
| D3 1–3 (status, identity, notes) | §3.1 |
| D3 4–9 (needs, effects, variants, repeatability, progress) | §3.4, §3.6 |
| D3 10–17 (roles and casting) | §3.2, §4.2 |
| D3 18–23 (windows, timing, fallback, channels) | §3.5, §3.6, §3.10 |
| D3 24–28 (robust fragments, three routes, rejoin, parents) | §3.6, §3.1 |
| D3 29–35 (intent, taste, adaptation, latitude) | §3.1, §3.9 |
| D3 36–41 (honesty, lint, fit report, determinism, migration) | §3.7, §4.8, §4.2, §3.11 |
| D4 R-1 to R-30 | R-1, R-2: §3.1. R-3: §3.2. R-4 to R-6, R-9, R-10, R-12 to R-18, R-30: §3.6. R-7, R-24: §3.4, §3.10. R-8, R-19 to R-23, R-25, R-28, R-29: §3.8. R-11: §3.4. R-26: §3.8 (reveal). R-27: §3.1 (parent and children) |
| D2 1–26 | Ladders, exits, boundaries, intimacy, pacing, bids, absence: §3.8. Honesty, `because`, callbacks: §3.7. Ties, memberships, grievances: §3.2. Reload stability: §4.4. Reports and checks: §4.8 |
| D5 SL-1 to SL-19 | SL-1, SL-2: §2, §3.6. SL-3 to SL-5, SL-11, SL-13, SL-17: §3.6. SL-6 to SL-10, SL-15, SL-18, SL-19: §3.9. SL-12: §3.2. SL-14, SL-16: §4.7 |
| D7 PR-1, PR-3, PR-8, PR-12, PR-13, PR-22 (layer-2 parts) | §4.7, §4.4 |
| D9 R6-01 to R6-20 (P6) and the P5 list | Offer anatomy, choice marks, honesty, unattended plan: §3.2, §3.7. Portents, delay cues, stakes, naming marks: §4.8 lint plus the exposure ledger (§4.6). Player settings, pack budget, clock presentation: **P6**. The P5 list: **P5** |
