# S3. Procedural engine specification

**Status:** v0.1, 23 October 2026.
- **Reviews.** None yet (§15).
- **The core.** This version specifies the **core**: the layer-3 parts that the first implementation builds, narrowed to [S2 v1.0's core](seeding.md#03-the-core-what-the-first-implementation-builds) (§0.2). Everything else in [P5](../p5-procedural-engine.md) is a **later capability** (§0.3). The first implementation rejects it plainly rather than half-doing it.
- **The additions to S2.** Layer 3 needs a few additions to S2 v1.0. They are collected, as exact text, in §13.

This is the specification stage of [P5](../p5-procedural-engine.md) (work package [WP-13](../plan.md#82-work-packages)). It is exact enough to build layer 3 in the TypeScript reference model from this page, [S2](seeding.md) (v1.0 plus §13 here) and the kernel specification [S0](kernel.md) alone.

Where this page and P5 differ, this page wins. P5 explains why; this page says exactly what. §14 lists the departures from P5, and the points where P5 disagrees with itself.

**Normative words, tunables and type notation** are as in [S0](kernel.md): MUST, SHOULD, MAY; **[tunable]** and **[calibrate]**; TypeScript notation with normative field names and free physical layout. Every **[tunable]** value lives in pack settings data (`Layer3Data`, §2.1), never in code.

## 0. Scope

### 0.1 What layer 3 does

Layer 3 is the narrative intelligence ([D-02](../decisions.md)). It has four parts:
- **The sifter** recognises story-shaped patterns in the simulated record and keeps a bounded pool of partial matches (§6).
- **The sower** chooses what to open, turns the choice into a seed through layer 2, and grows closed seeds' loose ends into follow-ups (§7).
- **The fitter** weighs the choices that layer 2 draws, so that open parts of any seed fit the world. It serves authored and sown seeds by the same code, and keeps working with sowing off ([D-03](../decisions.md); §4).
- **The director** senses the moment, runs the pacing phases, keeps the thread view and budgets, answers the hooks layer 2 calls, and keeps the schedule that sowing follows (§5).

It does not own: the world and its processes (S0, S1); the seed language, casting, the lifecycle, the arbiter, the record and the exposure ledger (S2); pack format and settings screens (S4); the game port and the sense feed (S5); words (S7); the evaluation harness and the inspectors (P9, P10).

**Five rules run through everything below.**
1. **Two doors out.** Layer 3 changes the world only by sowing a seed, or withdrawing a seed it sowed, through layer 2 (§1.3). It changes timing only through bounded hooks. The only nodes it mints itself are inert `meta:` events (§6.6).
2. **It selects; it never edits.** It chooses which recorded events to tell, when and in what form. It never changes a unit's strength, stakes, hostility or reward, and never rewrites a fragment's words.
3. **V is observed, never owned** ([D-09](../decisions.md)). In the core the player model is computed and logged and **reaches no hook, gate, draw or schedule** (§8, S3-I-4).
4. **Plain data, deterministic, explainable.** Every decision is a function of the record, the packs, the settings and keyed draws (§3). Each one logs why (§10).
5. **Sowing is optional; fitting is not.** With tempo `off`, the sifter and the sower stop. The fitter, the hooks, the thread view and the pacing state keep serving authored seeds ([D-03](../decisions.md)).

### 0.2 The core: what the first implementation builds

The core is the least that tests the idea: an authored seed fitted and paced with sowing off, then the same world with sowing on. It is built in the TypeScript reference model, beside layers 1 and 2.

| Area | In the core |
|---|---|
| Fitting (§4) | The **fit hook**: world-only weights on layer 2's draws (casting, variants, modes, alternates), from the seed's aesthetic intent, variety and yielding to live seeds. The **lead aim** for timing. Fit-report additions. **No `fits` record** (S2 v1.1 needs no `InstanceState.fits`; §4.1 says why) |
| Director (§5) | The sense feed; the pacing state `A`, `N`, `T`; the five phases with rest lengths; the **hold hook** (phase, headroom, climax rests, lead aim); the **joint hook**; the thread view; thread budgets and overflow withdrawal; the nested opportunity schedule for the `open` stream |
| Sifter (§6) | Patterns with event, edge, dilemma and frame clauses; the bounded saved pool; first-clause matching on one frame per pattern; expiry and tombstones; features and gates; **promotion** of a match to a retained record with inert `meta:story` and `meta:story-end` events |
| Sower (§7) | The `open` stream; sources **match** and **loose end** (kinds `cast` and `unreadTurn`); gates, banding and the keyed draw; instantiation by a sowing request with an overlay; refusal and cooldown; idempotent sowing; withdrawal for overflow |
| Player model (§8) | Folded from canon `offer` and `response` events by dossier 12's estimator, written to the decision log with a shadow score. It feeds nothing |
| Persistence (§9) | One `SeedRecord` under its own id: the pool, promoted matches, tombstones, the schedule position, the loose-end ledger and the recent-sown ring |
| Determinism, log, audits (§3, §10, §11) | Keyed draws with exact keys; the decision log; static audits |

### 0.3 Later capabilities

The first implementation rejects these with a plain finding ("not supported yet"). Each returns only with a recorded contract that agrees with the reference model.

| Later capability | Why it waits |
|---|---|
| **The player model feeding Score and Phase** (deferral on evidence, ranking of formed offers), the `director → v` beliefs, V's inferred frames | S2 §8.8 defers the preference hooks until option invariance has been shown. The core logs the model first, so panels can judge it |
| **Score hook, form hook, channel hook** | Score is model-fed. Forms are a later S2 capability (§2.13). The game port already reports channel availability and S2's core uses one carrier with a fallback |
| **Fills, bridges, stand-ins, history hooks, constructed causes (the cause hook), the `fits` record** | S2's core has no fill step and no constructed causes. A `fits` record is needed once there is something besides draw weights to record |
| **Fronts, clocks, projections, the band hook, outlets, street forms** | S2's clocks are sugar over counts and signs; projections are later (§2.14). Needs S1's city events |
| **Arcs and seasons; `district` and `city` stake scales; ancestry gates** (two found ancestors) | S2's core omits scale ancestry (L-37). The core sower sows only up to gig level and `block` scale |
| **The subject promotion ladder** (rungs, return and outcome counters, the focal set, the `memorable` rule) | Needs S1 routines and tie-specific moments, and the memory machinery, which is deferred (S0 V4-9 to V4-11) |
| **Baton, nudges, refresh traces, the plant planner, glances** | Need `cue` on seeds (N-4), plants and traces (S2 §2.15), and the staging contracts |
| **Thread cadence, the lead thread, composition rules beyond one climactic thread, release jitter, the breakpoint rule** | Polish on a working loop. The arbiter's own gates bound the push rate in the meantime |
| **Staged beats** (warn, standby, `warm`), **jump cues**, **return-view ranking**, **the first-forgetting guard** | Need N-8 and N-9, and S2's full return view (§8.7), which is a later capability |
| **Dread rules** (caps, uncertainty band, tip beats, handles) | Need hostile kits, clocks and S1's threat knowledge. Stage caps are kit data checked by lint (N-10) |
| **Premises, the stance quota, argument profiles, reward-policy audit, arc recogniser** | S2 premises are metadata until a director uses them |
| **T2 counters, the orientation index, the landing check, the noticed page and disclosure, "why this?"** | Need the model to have run in the prototype, and the settings surface (P6) |
| **Pulls as a source, `grow` invitations (N-3), sifter `belief` clauses, belief-divergence candidates** | Pulls need S5's report of V asking. Belief clauses need S1 events for telling and lying (dossier 6, G-1) |
| **Loose ends of kinds `fact`, `promise`, `change`** | A growth kit needs a node to bind. The core grows from `cast` and `unreadTurn` entries only |
| **Strain, care-lengthened holds, the per-hour caps on class 2 actions** | The core has no class 2 action. The only class 3 actions with a cap are withdrawals |
| **Tempo scaling of durations, lead times and promotion thresholds; the soft sown-push rate** | The core scales the opening rate only. The arbiter's tempo effects (S2 §8.3 step 3) bound the rest |
| **Contest rules** (an authored seed waiting for a committed procedural seed; the uncontested-anchor check before sowing) | Need dry-run casting. The core yields softly (§4.3) and relies on S2's claim priority |
| **Selection extras:** the collision term, strata hints, the distinctiveness budget, the session tone curve, features F-2 and F-10 | Need history the core does not yet keep. The core ranks on six features and one diversity term (§7.4) |
| **The `fitting` setting, the time budget** | They change what is offered, so they are recorded ops (K-1 in P5). Nothing in the core reads them |
| **Evaluation services** (argument profile, branch-diff harness, reload-divergence and forgetting lints), pattern `preview()` | P9 and P10 build them on the decision log |

### 0.4 Words that mislead

- **"The director off"** in S2 means *no layer 3 at all*. It is the control arm. Then `fitWeight` is 0, no delivery is held, no joint is reported, and nothing is sown. This page calls it **layer 3 absent**.
- **Tempo `off`** is the player's setting. The fitter, the hooks, the thread view and the pacing state still run.
- **Sowing** means the sower putting a seed into the world. **Fitting** never does.

### 0.5 Conventions

- **Time.** `GameTime` is game seconds ([S0 §9.1](kernel.md#91-time)). The **play clock** is the session's seconds of unpaused play ([S2 §8.2](seeding.md#82-the-play-clock-and-session-states)). `playTotal` is cumulative play seconds in the branch, saved with it ([S2 §8.7](seeding.md#87-the-return-view)). Layer 3 uses the play clock only for the director's one-second tick (§5.2). Everything that must survive a load uses `playTotal`. During a session, `playNow = playTotalAtLoad + playClock`.
- **Ids.** `director = H("root", worldSeed, "director")`. The layer-3 record is `layer3Id = H("root", worldSeed, "layer3")`.
- **Draw keys.** `rand(key…)` is S0's ([§1.4](kernel.md#14-random-streams)): `toUnit(H("rng", key…))`. In every key below, `worldSeed` is passed as an `Id`, strings as strings, indexes as `i64`.
- **Arithmetic** is S0's [§1.3](kernel.md#13-arithmetic) only: binary64 `+ − × ÷`, `sqrt`, comparisons, and fdlibm `ln`. There is **no `exp`**. Decay therefore multiplies by a fixed per-second constant (§2.1).
- **Sums** run in the order written. Where a set is summed, it is summed in `Id` order.

## 1. Interfaces

### 1.1 The parts and the tick

| Part | Runs | Reads | Produces |
|---|---|---|---|
| **Sifter** | On each relevance emission or dilemma delivered on a pattern frame; at each simulation window boundary (expiry) | Changes, `Dilemma`s, patterns, the kernel view | Pool entries; inert `meta:` events |
| **Sower** | At a schedule slot (§5.9); on seed events (loose ends) | Pool, closure entries, thread view, settings | `story.seed@1` and `story.withdraw@1` requests |
| **Fitter** | When layer 2 makes a draw (hook call); when the fit report runs | The seed document, a read-only kernel and layer-2 view | Raw weights; the lead aim |
| **Director** | Once per second of play (the tick); on hook calls; on seed events | The sense feed, the thread view | Hook outputs; holds; overflow withdrawals |

**The tick order within one second of play:**
1. Layer 1 and layer 2 work for the second runs first (relevance dispatch, wake-ups, re-evaluation). The sifter handles its emissions in the kernel's delivery order as part of that.
2. The director's tick (§5.2): pacing state, phase.
3. The thread view is refreshed (§5.7), then overflow is checked (§5.8).
4. The schedule's pending slot is tried (§7.2).
5. The arbiter's release step runs and calls the hold and joint hooks.

All of layer 3 is single-threaded with the kernel in the reference model.

### 1.2 What layer 3 reads

Layer 3 reads the world and layer 2 only through two read-only views. Neither lets it write, and neither emits changes (S0 I-13).

```ts
interface KernelView {
  event(id: Id): EventView | undefined;     // undefined once the event is forgotten and cannot regenerate
  kindOf(id: Id): KindId;
  kindTags(kind: KindId): string[];
  holds(p: Predicate, node: Id): 'yes' | 'no' | 'maybe';     // S0 §8.1
  isSpine(node: Id): boolean;               // registry read: the node is a canon character of the main story
  aesthetic(node: Id, feature: AestheticFeature): number | undefined;   // registry read, −1..1
  producers(kind: KindId): string[];        // the layers that can produce this kind (S1, S5); used at pattern load
}
interface EventView {
  id: Id; kind: KindId; time: GameTime; place?: Id; creator: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  causes: Id[]; witnesses: Id[];
  outcome?: 'done' | 'failed' | 'prevented'; served?: Id;
}

interface Layer2View {
  playTotal(): number;
  instances(): InstanceView[];              // every instance that has a record, in Id order
  instance(id: Id): InstanceView | undefined;
  sownBy(decision: Id): Id[];               // the instances whose source.decision is this
  global(): { offerCount: number; fragmentUses: Record<FragmentId, { count: number; lastAt: GameTime; lastOffer: number }> };
  exposedNode(node: Id, atLeast: ExposureGrade): boolean;     // the ledger names the node (§1.2 note)
  settings(): Layer3Settings;               // §2.4
}
interface InstanceView {
  id: Id; template: { pack?: string; id: TemplateId; version: number };
  level: SeedLevel;
  source: { by: 'pack' | 'director' | 'plugin'; layer: Layer; decision?: Id };
  state: SeedStateName; since: GameTime;
  growsFrom?: GrowsFrom;
  roles: Record<RoleKey, { cast?: Id; committed: boolean; anchor: boolean }>;
  beats: Array<{ key: BeatKey; kind?: string; state: BeatState }>;
  releaseWindow?: { lead?: 'early' | 'preferred' | 'late'; urgency: number };   // urgency evaluated now
  displays: Array<{ delivery: Id; grade: ExposureGrade; playTotal: number }>;    // one per delivery, its highest grade
  responses: Array<{ kind: string; playTotal: number }>;                         // 'action:<id>', 'decline:<id>', 'null'
  draws: Record<string, { value: string; attempt: number; raw?: number; clamped?: number }>;
  closure?: { event: Id; at: GameTime; status: 'resolved' | 'transformed' | 'abandoned'; witnessed: boolean; looseEnds: LooseEnd[] };
  closingPending: boolean;                  // a closing delivery has not yet been shown or expired
}
interface LooseEnd { n: number; kind: 'fact' | 'cast' | 'promise' | 'unreadTurn' | 'change'; node?: Id }
```

**`exposedNode`** is yes when any exposure-ledger entry ([S2 §10.2](seeding.md#102-the-exposure-ledger)) at `atLeast` or above has the node as a participant, a place, a cast node or a cited node. It is the one way layer 3 asks "has V met this?".

### 1.3 What layer 3 writes: the doors

| Door | Request | Notes |
|---|---|---|
| Sow | `story.seed@1` (§7.6) | Creator `director`; layer `procedural` (S2 §3.2). Idempotent |
| Withdraw | `story.withdraw@1` (§7.8) | Source withdrawal, T1. The closing trace plays if V saw the seed and the template has `closing` |
| Mint | Inert `meta:story` and `meta:story-end` events (§6.6) | Creator `director`; causes the constituent events; no effects; no witnesses |
| Frames | One root frame per loaded pattern on the actor `director` (§6.1) | Opened and closed as packs load and unload |
| Save | The layer-3 record (§9) | One `SeedRecord` under `layer3Id` |
| Tools | The decision log (§10) | Local, per session, never part of the save |

There is no other write. In particular layer 3 never writes a pin, a belief, a contribution or an edge.

### 1.4 The hooks

Layer 2 calls three hooks in the core. Every hook is a pure function of its inputs and of the director's own state, which is itself a function of the sense feed (§5). Every output has a bound, and layer 2 enforces it.

```ts
interface Layer3Hooks {
  fit(req: FitRequest): number[];                          // weigh: one raw weight per option
  hold(ctx: HookCtx, queue: DeliveryView[]): HoldDecision[];   // remove
  joint(ctx: HookCtx): JointKind | null;                   // report
  onRelease(ctx: HookCtx, d: DeliveryView): void;          // notify: a delivery was released (updates N)
}
```

| Hook | Called in | Kind | Output | Bound |
|---|---|---|---|---|
| **fit** | [S2 §3.4](seeding.md#34-layer-2-draws), for every layer-2 draw with more than one option | weigh | `rawWeight[i]` for option `i` | Layer 2 clamps each to ±`fitCap` (ln 1.5) and records raw and clamped in the draw record. Zero with layer 3 absent. **Reads no player model** |
| **hold** | [S2 §8.3](seeding.md#83-the-release-step) step 4, once per release step | remove | Deliveries to hold this step, each with a reason | Removal only. Layer 2 ignores a hold on a `pull` delivery, a class-0 delivery or a closing delivery |
| **joint** | S2 §8.3, joints | report | `'arrived' \| 'woke' \| 'finished' \| 'asked' \| null` | Reads game state only. Layer 2 latches an occurrence (S2 §8.3) |
| **onRelease** | After a release | notify | none | Adds the delivery's declared intensity to `N` (§5.2) |

In the core there is **no score hook** (layer 2 adds 0), **no form hook** (the form is `standard`), **no channel hook**, **no cause hook** and **no band hook** (§0.3). Layer 2 treats a missing hook as its "layer 3 absent" behaviour.

```ts
type JointKind = 'arrived' | 'woke' | 'finished' | 'asked';
type HoldReason = 'phase-settling' | 'phase-rest' | 'phase-peak' | 'phase-fade' | 'headroom' | 'climax-rest' | 'lead-aim';
interface HoldDecision { delivery: Id; reason: HoldReason }
```

### 1.5 Hook inputs: the closed list

The release-step hooks (`hold`, `joint`, `onRelease`) receive only this ([S2 §8.8](seeding.md#88-the-player-models-boundary), S2-I-14, with the additions of §13):

```ts
interface HookCtx {
  playClock: number;                        // session play seconds
  playTotal: number;
  session: 'settling' | 'returning' | 'resituating' | 'normal';
  away: boolean;
  tempo: 'off' | 'calm' | 'steady' | 'restless';
  attention: AttentionAspect[];             // the active aspects
  jointLatched: boolean;                    // layer 2's latch (§13, A-6)
  settings: Layer3Settings;
}
interface DeliveryView {                    // the delivery record, plus the window data layer 2 evaluates
  id: Id; seed: Id; authored: boolean; pull: boolean; atJoint: boolean;
  timing: TimingRequest;                    // class, importance, purpose, maxWait, intensity, category
  submitted: number;                        // play seconds
  features: Skeleton;                       // verb, stake, relationship, outcome, tone, channel
  window?: { lead?: 'early' | 'preferred' | 'late'; urgency: number };   // first-release deliveries only (§13, A-6)
}
```

Nothing about quitting, menus, saving, idle time, session length, time of day, load counts or how often the player returns reaches a hook. The **sense feed** (§5.1) is the director's own, second input; it is also closed.

The **fit hook** has its own inputs (§4.2): the seed document, the kernel and layer-2 views, and game time. It takes no session state and no play clock.

## 2. Data

### 2.1 `Layer3Data` and the tunables

All tunables are one record in pack settings data. The values below are the defaults; P9 moves them.

```ts
interface Layer3Data {
  pacing: {
    decayA: number;          // per second of play: 0.9771599684342459, the binary64 nearest 2^(−1/30). Half-life 30 s
    decayN: number;          // 0.9942404238175473, the nearest 2^(−1/120). Half-life 120 s
    thetaPeak: number;       // 0.7
    thetaFade: number;       // 0.35
    peakHold: number;        // 5 s
    settle: number;          // 90 s
    restFactor: number;      // 1.5
    restMin: number;         // 45 s (also the least rest before a district change ends it)
    restMax: number;         // 180 s
    highIntensity: number;   // 0.5: a "high-intensity" push
    climaxNoPush: number;    // 300 s after a witnessed gig-or-larger outcome
    climaxNoHigh: number;    // 1200 s
    arcNoNewThread: number;  // 1200 s after a witnessed arc-or-larger outcome
    engagedMetres: number;   // 40
    senseWeights: SenseWeights;      // §5.2
  };
  threads: {
    attendedWindow: number;  // 2700 play seconds
    simmerWindow: number;    // 28800 play seconds
    maxAttended: number;     // 4
    maxLive: number;         // 2
    maxClimactic: number;    // 1
    maxSimmering: number;    // 8
    withdrawCap: number;     // 2 per play-hour
  };
  aim: {
    preferredUrgency: number;   // 0.35
    preferredWait: number;      // 300 play seconds, then the first latched joint
    lateUrgency: number;        // 0.7
    relaxAt: number;            // 0.7 of maxWait
  };
  joint: { arrivedMetres: number; /* 100 */ stationarySeconds: number; /* 3 */ };
  schedule: {
    slotGap: number;         // I = 4500 s of playTotal: the mean gap at restless (0.8 an hour)
    theta: Record<'off' | 'calm' | 'steady' | 'restless', number>;   // 0, 0.3125, 0.625, 1
    gentleFirst: number;     // 600: no sown push (first class ≥ 1) before this playTotal
    gentleHour: number;      // 3600: no sown first class above 1 before this playTotal
  };
  sifter: {
    poolPerPattern: number;  // 32
    poolTotal: number;       // 256
    maxStages: number;       // 8
    defaultWithin: number;   // 518400 game seconds (6 game days)
    maxWithin: number;       // 2592000 (30 game days)
    candidateTtl: number;    // 259200 game seconds (3 game days) after completion
    promotedTtl: number;     // 604800 game seconds (7 game days) without a live sown seed
    maxPromoted: number;     // 32
    tombstoneSpans: number;  // 2: a tombstone lasts two `within` periods
    minDilemma: number;      // 0.3: the least severity that makes a dilemma stage a reportable change
    maxChain: number;        // 5 stages: at most four links
  };
  sower: {
    lambda: number;          // 1.0: how far the band composite tilts the draw
    diversity: number;       // 0.5 per recent duplicate
    recentSown: number;      // 6
    recentKits: number;      // 3
    kitDiversity: number;    // 1.0 for a kit among the recent kits
    maxCandidateTries: number;   // 3 candidates per slot
    maxKitTries: number;     // 3 kits per candidate
    cooldown: number;        // 600 play seconds after a refused sowing
    maxRefusals: number;     // 3
    ledgerCap: number;       // 64
    featureWeights: Record<'F3' | 'F5' | 'F6' | 'F7' | 'F9' | 'F11', number>;   // all 1
    timelyH: number;         // 21600 game seconds
    irreversible: Effect[];  // ['kill', 'expose']
    harmful: Effect[];       // ['harm', 'kill', 'take', 'expose', 'protect', 'rescue']
    maxLevel: SeedLevel;     // 'gig'
  };
  fit: {
    aesthetic: number;       // 0.3
    variety: number;         // 0.2
    yield: number;           // 0.3
    varietyOffers: number;   // 3: "recently used" means within this many offers
  };
  model: { H: number; /* 36000 */ cap: number; /* 12 */ c: number; /* 1.5 */ e: number; /* 0.15 */ window: number; /* 2000 events */ };
}
```

### 2.2 Patterns

A **pattern** is pack data, versioned, read by a generic loader. It carries structure and tags only. Tellability weights live in code over matches (§7.4), never in a pack.

```ts
interface SiftPattern {
  id: string; version: number;
  roles: Record<string, { kind: KindId; where?: Predicate[] }>;     // variable name (with its '?') → constraint
  stages: Clause[];                                                  // ordered; one Change or Dilemma each; 1 to maxStages
  unless?: Array<{ between: [number, number]; clause: Clause }>;     // stage indexes a < b
  within?: number;                                                   // game seconds from stage 0; default defaultWithin
  once?: string[];                                                   // variable names: a tombstone per binding
  tags: string[];
  keep?: number;                                                     // promote at this stage (§6.6)
  tellings: Telling[];
}
type Clause =
  | { c: 'event'; kind: KindId | { tag: string }; who?: Array<{ role: string; as: string }>;
      effects?: Array<{ on: string; effect: Effect | Effect[] }>; where?: Predicate[] }
  | { c: 'edge'; type: EdgeTypeId; from?: string; to?: string; ended?: boolean }
  | { c: 'dilemma'; actor: string; target?: string; effect?: Effect; minSeverity?: number }
  | { c: 'frame'; actor: string; status: 'satisfied' | 'abandoned' | 'blocked' };
interface Telling {
  form: Form;
  atStage: number;                       // usable only while the match is exactly at this stage
  kit?: TemplateId;                      // absent: any sowable template that serves `form` and has every role in `binds`
  binds: Record<RoleKey, string>;        // kit role ← a pattern variable, or '?story' or '?end'
}
type Form = 'recap' | 'rumour' | 'sighting' | 'foreshadow' | 'offer' | 'aftermath' | 'follow-up';
```

A `belief` clause is **not supported yet** (§0.3). A clause's `where` predicates are S0 §8.1 predicates evaluated on the **event node** of that stage. A role's `where` predicates are evaluated on the node once it is bound. A predicate that answers `maybe` counts as `no`.

**Pattern load checks.** A pattern that fails any check is not loaded, with a finding naming the check. Other patterns load.

| # | Check |
|---|---|
| S3-L-1 | Every event kind and edge type in a clause exists in the schema, and `producers(kind)` is not empty |
| S3-L-2 | Every variable in a clause, `once`, `keep` or a telling is declared in `roles`. A role's kind is compatible with every use |
| S3-L-3 | `stages` has 1 to `maxStages` entries. Each `unless.between` is `[a, b]` with `0 ≤ a < b < stages.length`. `keep` is a valid stage index |
| S3-L-4 | `within`, if given, is positive and at most `maxWithin` |
| S3-L-5 | Stage 0 binds at least one variable of kind `core:person` or `core:group` (a human at the centre) |
| S3-L-6 | There is at least one telling. Each `atStage` is a valid stage. Each named `kit` exists, is a sowable template that `serves` the telling's form, and each key of `binds` is a role of the kit whose kind accepts the variable's kind. `?story` and `?end` bind only to roles of kind `meta:story` and `meta:story-end` |
| S3-L-7 | A `belief` clause is refused ("not supported yet") |
| S3-L-8 | Every variable in `once` is bound by stage 0, so a tombstone can be checked when a match starts |

### 2.3 Sowable templates

A seed template that layer 3 may sow carries a **sowable declaration**. S2 carries it opaque (§13, A-9) and S3 reads it.

```ts
interface Sowable {
  serves: Form[];                        // at least one
  from?: Array<'cast' | 'unreadTurn'>;   // for 'follow-up': which loose ends it can grow from
  subject?: RoleKey;                     // for 'follow-up': the role bound to the loose end's node
  firstClass: 0 | 1 | 2 | 3 | 4;         // the class of its first delivery
  weight?: number;                       // kit weight, default 1
  climactic?: boolean;                   // the seed opens with a conclusion beat available (counts toward maxClimactic)
  tags?: string[];
}
```

**Sowable load checks.** A template that fails is not sowable by layer 3. It may still be sown by its pack.

| # | Check |
|---|---|
| S3-K-1 | `maturity` is `ready` ([S2 §1.3](seeding.md#13-sowing-authored-templates)) |
| S3-K-2 | `level` is at most `maxLevel`. `stakeScale` is `person`, `crew` or `block`, or absent (default `block`) |
| S3-K-3 | A template that serves any form other than `rumour`, `recap` or `sighting` has `closing`, so that withdrawing it after V saw it always leaves a closing trace |
| S3-K-4 | `firstClass` equals the class of the first delivery that the template's start beats produce, by S2's registry |
| S3-K-5 | No role of the template has an `identity` that `isSpine` |
| S3-K-6 | A template serving `follow-up` has `from` and `subject`, and `subject` names a role of a kind that the `from` entries can bind |

### 2.4 Settings read

Layer 3 reads these player settings (S4 owns the settings; S0 `SettingsSet` records the ones that change what is offered):

```ts
interface Layer3Settings {
  tempo: 'off' | 'calm' | 'steady' | 'restless';     // S2 §8.3 step 3; layer 3 reads it for the schedule
  noticing: 'off' | 'acts' | 'full';                  // 'full' behaves as 'acts' (T2 is later)
  exclusions: Exclusion[];                            // explicit exclusions
  softExclusions: Exclusion[];                        // added by a retract (S2 §7.4)
  modelFloor: GameTime;                               // "start fresh"
  content: { ceiling: Record<ClassId, 0 | 1 | 2 | 3> };
}
```

```ts
interface Exclusion { kind: 'verb' | 'class' | 'tag' | 'npc'; value: string }   // a skeleton verb, a content class, a kit tag, an NPC node
```

**Exclusions are stated settings, not inference.** The sower reads `exclusions` and `softExclusions` as a hard filter on candidates (§7.3, gate 6). That is allowed under S2 §8.8 because the exclusion list is the player's own statement. It is never used to rank, and it is not the player model.

## 3. Determinism and draws

### 3.1 Rules

1. **Same inputs, same outputs.** The inputs are the documents, the packs, the world seed, the kernel operations, V's responses, the timestamped session inputs (the sense feed, display reports, settings) and `Layer3Data`.
2. **Keyed randomness only.** Every random choice uses a key in §3.2. Nothing reads the session epoch, a load count, the play clock as a draw input, or the wall clock ([S0 I-16](kernel.md#15-invariants)).
3. **Order.** Patterns run in `id` order, pool entries in creation order, candidates in `key` order, instances in `Id` order. Ties go to the lower `Id`, or the lower tie hash where a rule says so.
4. **The salt.** Layer 3's draw keys carry a `salt`, a string, empty by default. The harness sets a non-empty salt to get a "fresh draws" arm. A player's game never sets it. The salt is not recorded as an op; it is not part of any `Id`.
5. **Hook outputs are computed at release and stored.** The release log records what a hook said at the step that released. Nothing is recomputed at display ([S2 §8.8](seeding.md#88-the-player-models-boundary)).
6. **Sowing is idempotent.** Its identity is the candidate's key (§7.6), not the pool's order or the pacing state.

### 3.2 The keys

`salt` follows `worldSeed` in every key.

| Key | Arguments after `worldSeed, salt` | Used for |
|---|---|---|
| `rand("s3-slot", …)` | `stream: string`, `k: i64` | The time of slot `k` inside its window (§5.9) |
| `rand("s3-live", …)` | `stream`, `k` | The liveness draw `u` of slot `k` |
| `rand("s3-pick", …)` | `stream`, `k`, `cand.key: Id` | Noise for choosing among candidates (§7.4) |
| `rand("s3-tell", …)` | `cand.key: Id`, `i: i64` | Noise for choosing among a candidate's tellings; `i` is the telling's index in the pattern |
| `rand("s3-kit", …)` | `cand.key: Id`, `kit: string` | Noise for choosing among kits |
| `H("tie", worldSeed, salt, …)` | the key name and arguments of the draw, then the option's key | Exact-tie break for the draw above (the lower hash wins, compared as S0 compares `Id`s) |

Identity hashes (no salt, no `rand`):

| Hash | Value |
|---|---|
| Match id | `H("match", worldSeed, pattern.id, v₁, id₁, v₂, id₂, …)` over the variables bound by **stage 0**, sorted by variable name (UTF-8 byte order). Variable names are strings; ids are `Id`s |
| Candidate key, match | `H("cand", worldSeed, "match", matchId, stage)` |
| Candidate key, loose end | `H("cand", worldSeed, "looseEnd", seedId, n)` |
| Decision id | `H("sow3", worldSeed, cand.key)` |
| Withdraw decision | `H("wdraw3", worldSeed, seedId)` |
| `meta:story` event | `H("mint", director, matchId, "meta:story")` |
| `meta:story-end` event | `H("mint", director, matchId, "meta:story-end")` |
| Tombstone key | `H("tomb", worldSeed, pattern.id, v₁, id₁, …)` over the pattern's `once` variables, sorted by name |
| Pattern frame | `H("mint", director, director, "frame:" + pattern.id)` |
| Instance `localName` | the first 16 hexadecimal characters of `cand.key` |

### 3.3 The keyed choice

Layer 3 chooses among options with S0's draw arithmetic (§1.3, [§5.4](kernel.md#54-the-draw-flat-gumbel-max)). For options `F`, each with a `score(o)` and a noise key `keyArgs ∥ o.key`:

```
g(o)   = −ln(−ln(rand(keyName, worldSeed, salt, …keyArgs, o.key)))
choice = argmax over o ∈ F of (score(o) + g(o)); an exact tie goes to the lower H("tie", worldSeed, salt, keyName, …keyArgs, o.key)
```

The noise of an option depends only on its own key. Removing an option from `F` therefore changes the result only if it was the winner. §7 relies on this when a refused candidate is dropped and the draw is run again.

## 4. The fitting service

### 4.1 What the fitter does in the core

Fitting is a service ([D-03](../decisions.md)). In the core it does **three** things, all from the world and the record, none from the player model:
1. **It weighs layer 2's draws.** When layer 2 draws a mode, a variant, an alternate or a cast, the fit hook returns a raw weight for each option (§4.2). Layer 2 clamps it and adds it to the draw's score ([S2 §3.4](seeding.md#34-layer-2-draws)). This is how "who, where and which variant" are fitted.
2. **It aims the timing.** For a seed's first release, the lead aim (§4.4) turns the window's `lead` and `urgency` into holds.
3. **It reports.** The fit report gains the terms and the aim (§4.5).

**What it does not do, and why that is safe.** The core fitter adds no material. It never fills a hook, never builds a bridge, never swaps a place. It only weighs options that the seed's own document and layer 2's casting already offer. So a fitted result **cannot** break the author's intent, a prohibition, a window, a role requirement or a content ceiling: every option was already valid. That is why the core has no verifier.

**Why there is no `fits` record (P5 N-1 not kept).** The fitter's only output that layer 2 consumes is a weight per option. Layer 2 already records every draw with its raw and clamped fit weight and reuses it after a load ([S2 §3.4](seeding.md#34-layer-2-draws)). From the first release the casts are committed. So the choice is write-once already, and a second record would repeat the draw record. The aim is a pure function of the window state, recomputed each second and applied at release. A `fits` record becomes necessary when the fitter produces something that is not a weight (fills, bridges, edits): that is a later capability (§0.3).

### 4.2 The fit hook

```ts
interface FitRequest {
  seed: InstanceView & { document: Seed };       // the instance and its expanded document
  choice: { key: string; kind: 'mode' | 'variant' | 'alternate' | 'cast'; role?: RoleKey; beat?: BeatKey };
  options: Array<{ id: string; node?: Id; fragment?: FragmentId }>;
  kernel: KernelView; layer2: Layer2View;
  at: GameTime;                                   // the game time of the draw
}
```

`fit(req)` returns `raw[i]` for `options[i]`, in order. The hook:
- is called only when `options.length > 1`;
- is a pure function of `req`;
- reads nothing about V's preferences, the director's pacing state, the play clock or the session;
- returns `0` for every option with layer 3 absent, and with `noticing: off` it is **unchanged** (fit weights are world-only, so `noticing` does not touch them; this is a deliberate correction of S2 §3.4's "or with the player's `noticing` setting off", see §13, A-7).

### 4.3 The terms

```
raw(o) = fit.aesthetic · T_aes(o) + fit.variety · T_var(o) + fit.yield · T_yield(o)        (summed in this order)
```

Each term lies in [−1, 1]. Layer 2 clamps `raw(o)` to ±`fitCap` ([tunable ln 1.5]).

**T_aes: aesthetic fit.** Only for `kind: 'cast'` options that have a `node`, and only if `seed.document.intent.aesthetic` is non-empty. Let `a_k` be the intent's weight for feature `k` and `f_k = kernel.aesthetic(node, k)`, skipping features with no reading:

```
T_aes(o) = ( Σ_k a_k · f_k ) / ( Σ_k |a_k| )          over the features with a reading; 0 if there is none
```

**T_var: variety.** `T_var(o) = −max(r₁, r₂)`, with:
- `r₁ = 1` if `o.id` (for a variant, mode or alternate) or `o.node` (for a cast) equals the value that the **immediately preceding instance of the same template** drew or cast for the same `choice.key`. "Preceding" is by `since`, then `Id`. Otherwise 0. The previous value is read from that instance's `draws` or, for a cast, its `roles[role].cast`;
- `r₂ = 1` if the option has a `fragment` that has been used and `layer2.global().offerCount − fragmentUses[fragment].lastOffer < fit.varietyOffers`. Otherwise 0.

**T_yield: yielding to live seeds.** Only for `kind: 'cast'` options with a `node`. `T_yield(o) = −1` if any other live instance (state not terminal) holds the node, tentatively or committed, through a role whose claim does not share ([S2 §9.1](seeding.md#91-detection)). Otherwise 0. This is P5's "yield before contest", rule 1: prefer a candidate that no live seed holds. S2's claim priority ([§9.2](seeding.md#92-settling)) still decides a real conflict.

### 4.4 The lead aim

The lead aim says when a seed's first delivery should come out, inside its window. It is a function of the window, not of the player.

```ts
function leadAim(w: { lead?: 'early' | 'preferred' | 'late'; urgency: number }): { release: 'early' | 'preferred' | 'late'; urgency: number } {
  return { release: w.lead ?? 'early', urgency: w.urgency };
}
```

`urgency` is S2's evaluated level of the release window (S2 §2.7: the highest `level` whose `when` is yes; 0 if no list). It comes from V's position in the story, never from a calendar. The hold hook applies the aim (§5.4, rule 5):

| `release` | The delivery is held until |
|---|---|
| `early` | never held by the aim |
| `preferred` | `urgency ≥ aim.preferredUrgency` (0.35), **or** it has waited `aim.preferredWait` (300 play seconds) **and** a joint is latched |
| `late` | `urgency ≥ aim.lateUrgency` (0.7) |

The aim relaxes at `aim.relaxAt` (0.7) of the delivery's `maxWait`, and the window's own hard close is S2's. An authored request keeps its hard deadline; the aim never moves it.

### 4.5 The fit report

The fit report ([S2 §11.2](seeding.md#112-the-fit-report)) is computed by the same hook and the same aim function. S2 v1.1 adds one field (§13, A-8):

```ts
interface FitReportFit {
  policy: 'world';
  terms: Record<string, Array<{ option: string; aes: number; var: number; yield: number; raw: number; clamped: number }>>;   // by choice key
  aim?: { release: 'early' | 'preferred' | 'late'; urgency: number; wouldHold: boolean };    // first delivery, on this sample: would the aim alone hold it at once?
  notFitted: Array<{ part: 'why-now' | 'bridge' | 'stand-in' | 'constructed-cause' | 'channel' | 'form'; reason: 'later-capability' }>;
}
```

`notFitted` lists the parts that the seed's `latitude` or `adapt` asks for and the core cannot do. This is the core's "no fit, and why": it is plain and listed, never silent. `connectingMaterial` stays empty.

**Fitting is independent of sowing.** The same hook and the same inputs give the same terms with tempo `off` and with tempo `restless` (S3-I-11). The report may be run over several settings vectors; in the core only `tempo` and `noticing` vary, and neither changes a term.

## 5. The director

The director runs second by second. It decides nothing about content. It senses the moment, keeps the books on threads, answers the hooks and keeps the schedule.

### 5.1 Senses

The director reads two closed lists: the hook inputs (§1.5) and its own **sense feed**. The feed is one `SenseFrame` per second of unpaused play, from the game port (S5). If the play clock does not advance, no frame arrives and the director does not tick.

```ts
interface SenseFrame {
  at: number;                       // the play clock, a whole second
  health: number;                   // V's health as a fraction of its maximum, 0..1 (polled)
  downed: boolean;                  // V is downed or near death
  hostileAware: boolean;            // a hostile is aware of V
  hostileAwareNear: boolean;        // a hostile is aware of V within engagedMetres
  hostileDeaths: number[];          // distance in metres of each hostile killed or defeated since the last frame
  civilianDeaths: number[];         // as above, civilians seen
  heatStage: number;                // integer 0..5
  pursuit: boolean;
  collision: boolean;               // a vehicle collision at speed since the last frame
  stims: number;                    // gunshot or explosion stimuli since the last frame
  specialEncounter: boolean;        // a special encounter started since the last frame
  district: Id | null;
  moving: boolean;                  // S5's threshold, 1.5 m/s
  metresMoved: number;              // since the last frame
  jump?: 'load' | 'sleep' | 'wait' | 'travel';    // on the first frame after a jump
  questCompleted?: boolean;         // a vanilla quest completed since the last frame
}
```

**Never read:** menu use, idle time, input silence, time of day, session length, saves, quits, load counts, return counts, the wall clock. ([S0 I-16](kernel.md#15-invariants); S2-I-12.) The `jump` field reports an event in the game (a load, a sleep), not a count of them.

The director also reads, from the kernel, canon `seed-outcome` events (§5.2, climax rests; §5.5, joints).

### 5.2 Pacing state and the tick

The pacing state is **session state**. It is not persisted, and it restarts in `settling` at a load.

| Quantity | What it is |
|---|---|
| `A` | Sensed situation intensity, 0 to 1. It describes the game's moment, never V's feelings |
| `N` | The intensity effect of released deliveries, −1 to 1 |
| `T` | `max(A, N)` |
| `engaged` | A hostile is aware of V within `engagedMetres`, or a pursuit is active |
| phase | `settling`, `build`, `peak`, `fade`, `rest` |
| episode | A maximal run of `engaged` seconds. `episodeStart`, and `lastEpisode` (its length in seconds, 0 if none) |
| locks | `noPushUntil`, `noHighUntil`, `noNewThreadUntil` (play clock seconds) |

```ts
interface SenseWeights {
  healthLost: number;      // 1.0 × the fraction of maximum health lost since the last frame
  lowHealth: number;       // 0.15, once per episode, when health first falls below 0.25 while engaged
  downed: number;          // 0.30, on entering downed
  combatEntered: number;   // 0.10, when hostileAware becomes true
  hostileDeath: number;    // 0.05 × (1 − d/10), for d ≤ 10 m
  civilianDeath: number;   // 0.10 × (1 − d/15), for d ≤ 15 m
  heatRise: number;        // 0.10 per stage risen
  collision: number;       // 0.05
  stim: number;            // 0.03 each, at most 0.15 over any 10 consecutive frames
  special: number;         // 0.20
}
```

**One tick, for frame `f`** (all arithmetic in the order written; `prev` is the state after the previous tick):

1. `engaged = f.hostileAwareNear || f.pursuit`.
2. **Episodes.** If `engaged` and not `prev.engaged`: `episodeStart = f.at`, `lowHealthPaid = false`. If not `engaged` and `prev.engaged`: `lastEpisode = f.at − episodeStart`.
3. **Decay.** If not `engaged`: `A = A × decayA`. Always: `N = N × decayN`.
4. **Inputs.** `s = 0`, then add in this order:
   1. `healthLost × max(0, prev.health − f.health)`;
   2. `lowHealth` if `engaged`, `f.health < 0.25` and not `lowHealthPaid` (then set `lowHealthPaid`);
   3. `downed` if `f.downed` and not `prev.downed`;
   4. `combatEntered` if `f.hostileAware` and not `prev.hostileAware`;
   5. for each `d` in `f.hostileDeaths`, in order, if `d ≤ 10`: `hostileDeath × (1 − d/10)`;
   6. for each `d` in `f.civilianDeaths`, if `d ≤ 15`: `civilianDeath × (1 − d/15)`;
   7. `heatRise × (f.heatStage − prev.heatStage)` if positive;
   8. `collision` if `f.collision`;
   9. stims: `x = min(stim × f.stims, 0.15 − Σ of the stim amounts added in the previous 9 frames)`, floored at 0. Add `x` and remember it;
   10. `special` if `f.specialEncounter`.

   Then `A = clamp(A + s, 0, 1)`. At the first frame of a session, `prev.health = f.health`.
5. `T = max(A, N)`.
6. **Phase** (§5.3). At most one transition per tick.
7. **Locks.** For each canon `seed-outcome` event minted since the last tick whose closure is `witnessed` ([S2 §6.4](seeding.md#64-closing-and-outcomes)): if the seed's level is `gig` or larger, set `noPushUntil = f.at + climaxNoPush` and `noHighUntil = f.at + climaxNoHigh`; if `arc` or larger, set `noNewThreadUntil = f.at + arcNoNewThread`. A later value never shortens an earlier one.

**`onRelease(d)`** adds the declared intensity: `N = clamp(N + (d.timing.intensity ?? 0), −1, 1)`, at once. It does not wait for the next tick.

### 5.3 Phases and rest

At a **jump** (`f.jump` set, including a load, and the first frame of a session) the phase becomes `settling` with `settleStart = f.at`, whatever it was. This is checked before the table below. The pacing state's other quantities (`A`, `N`, locks) are cleared at a load and kept across a sleep, wait or travel.

| Phase | Leaves when | To |
|---|---|---|
| `settling` | `f.at − settleStart ≥ settle` | `build` |
| `build` | `T ≥ thetaPeak` | `peak` (`peakSince = f.at`) |
| `peak` | `f.at − peakSince ≥ peakHold` and `T < thetaPeak` | `fade` |
| `fade` | `T ≥ thetaPeak` | `peak` (`peakSince = f.at`) |
| `fade` | not `engaged` and `T < thetaFade` | `rest` (`restStart = f.at`, `restDistrict = f.district`) |
| `rest` | `T ≥ thetaPeak` | `peak` |
| `rest` | `f.at − restStart ≥ R`, or `f.district ≠ restDistrict` and `f.at − restStart ≥ restMin` | `build` |

The first listed row whose condition holds fires. **Rest length** `R = clamp(restMin, restFactor × lastEpisode, restMax)`, fixed when `rest` begins. A rest that follows no episode (an `N`-driven peak) has `R = restMin`.

**Settling acts as rest.** The 90 seconds of settling after a load duplicate S2's own settling session state for a load; the director's `settling` also follows a sleep, a wait or fast travel, which S2's does not.

**The phase machine only moves between phases. It does not create anything** (dossier 7, DIR-35). What it allows or holds is the hold hook's job (§5.4). The sower reads the phase too (§7.2).

### 5.4 The hold hook

`hold(ctx, queue)` returns the deliveries to hold this step. For each delivery `d` in the queue, in queue order, the first matching rule decides.

Let `waited = ctx.playClock − d.submitted`, `intensity = d.timing.intensity ?? 0`, `T` the current pacing `T`.

1. **Never held:** `d.pull`, a class-0 delivery, a delivery whose `timing.purpose` is `close`. (Rest never blocks pull; a closing message of a live thread is allowed in rest.)
2. **Authored relaxation:** `d.authored` and `waited ≥ aim.relaxAt × d.timing.maxWait`: not held by anything below.
3. **Phase:**
   - `settling` or `rest`: held (`phase-settling`, `phase-rest`);
   - `peak` or `fade`: held (`phase-peak`, `phase-fade`) if `intensity > 0`;
   - `build`: held (`headroom`) if `intensity > 1 − T`.
4. **Climax rests:** held (`climax-rest`) if `ctx.playClock < noPushUntil`; or if `ctx.playClock < noHighUntil` and `intensity ≥ highIntensity`.
5. **Lead aim**, only if `d.timing.purpose` is `introduce` and `d.window` is present: apply §4.4's table with `waited`, `d.window.urgency` and `ctx.jointLatched`. Held as `lead-aim`. For a **sown** delivery the aim relaxes at `aim.relaxAt × maxWait`; for an authored one rule 2 has already done so.

Not held otherwise. The phase hold of rule 3 does **not** relax for a sown delivery; `maxWait` expiry still applies, and a sown seed's `onExpire` is `unattended` (S2 §2.12).

Each distinct (delivery, reason) pair logs once when it first appears, not every second (§10).

### 5.5 The joint hook

`joint(ctx)` reports, at the second it happens, one of:
- `arrived`: V has been stationary (`moving` false) for `joint.stationarySeconds` (3) consecutive frames; the `metresMoved` summed over the frames since V's previous stationary spell is at least `joint.arrivedMetres` (100); and V is not `engaged` and no attention aspect `driving` or `speaking` is active. The distance counter then restarts. A `jump` of `travel` also reports `arrived` at its frame;
- `woke`: the frame carries a `jump` of `sleep` or `wait`;
- `finished`: a canon `seed-outcome` with `witnessed` was minted this second, or `questCompleted` is true;
- `asked`: layer 2 has just queued a `pull` delivery.

A load is not a joint: a session opens by orienting ([S2 §8.2](seeding.md#82-the-play-clock-and-session-states)). If several things happen in one second, the order above decides which is reported. The hook reads game state only. Layer 2 holds the latch ([S2 §8.3](seeding.md#83-the-release-step)). After a jump the director is in `settling`, so a latched joint is released only when the hold hook allows it.

### 5.6 What is absent

There is no score hook and no form hook in the core. Layer 2 adds 0 to every score and uses `standard`. The model (§8) is computed beside the director and read by nothing in it.

### 5.7 The thread view

A **thread** is a view over layer 2's records ([S2 §2.13](seeding.md#213-scale-turns-threads-and-forms)). It is derived, never persisted. It is rebuilt from `Layer2View.instances()` at a refresh (once a second, and after any seed state change).

**Membership.** Take every instance that is live, or terminal with `closingPending`, or closed within `threads.simmerWindow` play seconds (by its `displays` and `closure.at`). Two instances are in the same thread when any of these holds:
- one names the other in `growsFrom` (`looseEnd.seed` or `parent`);
- they share a committed cast node in roles that are `anchor` in **both**;
- they are listed together in one `promoted[·].seeds` of the layer-3 record (§9.2): they were sown from the same match.

A thread is a connected component under these links. Its `Id` is the lowest instance `Id` in it.

**Fields**, from the instances (`now = playNow`):

| Field | Definition |
|---|---|
| `aware` | Some `displays` entry has grade `presented` or `confirmed` |
| `lastPresented`, `lastConfirmed` | The greatest `playTotal` among those entries (the second for `confirmed` only); `−∞` if none |
| `engineSown` | Every instance's `source.by` is `director` |
| `live` | Some instance has a beat in state `running` |
| `climactic` | Some instance has a beat of kind `conclusion` in state `available` or `running` |
| `closed` | Every instance is terminal and none has `closingPending` |
| `answered` | Some instance has a response whose kind starts `action:` |

**Status:**

| Status | Rule |
|---|---|
| `attended` | `aware`, not `closed`, and `now − lastPresented ≤ attendedWindow` |
| `simmering` | `aware`, not `closed`, not attended, and `now − lastPresented ≤ simmerWindow` |
| `dormant` | `aware`, not `closed`, and older than that |
| `closed` | `closed` |
| `unseen` | not `aware` and not `closed` |

Attended is measured with `playTotal`, so it survives a load. No status reads session length, time since load, a quit or a return.

### 5.8 Budgets and overflow

**Counts.** `A = #attended + #(unseen and engineSown)`; `L = #live` among aware threads plus unseen engine-sown ones; `C = #climactic`; `S = #simmering`. A freshly sown seed counts as attended and live until V has been shown something, so that the sower does not over-open.

**Budgets** are `maxAttended 4`, `maxLive 2`, `maxClimactic 1`, `maxSimmering 8` **[tunable]**. Authored, fitted and answered threads all count.

**Who the budgets bind.** Only the engine's own openings (§7.2 and §7.3, gate 7) and overflow withdrawal. Authored seeds are never refused or withdrawn for a budget. The engine's threads yield to them.

**Overflow withdrawal.** After each refresh, if `A > maxAttended` or `S > maxSimmering`, and fewer than `withdrawCap` withdrawals have been made in the last 3600 play seconds, the director withdraws **one** thread:
1. Candidates are threads that are `engineSown`, not `closed`, not `answered`, and (for `A`) attended or unseen, (for `S`) simmering.
2. The victim has the smallest `lastConfirmed` (`−∞` first), then the smallest `lastPresented`, then the lower thread `Id`.
3. Every non-terminal instance in the thread is withdrawn by `story.withdraw@1` (§7.8) with reason `overflow`.

A thread that V answered with an action is never withdrawn; it is simmered. At most one thread is withdrawn per tick.

### 5.9 The opportunity schedule and tempo

The only stream in the core is `open` (new threads). The schedule is **nested**: moving the dial thins or fills one schedule and never re-rolls it.

```
I          = schedule.slotGap                         (4500 s: the mean gap at restless, 0.8 an hour)
slot k     covers playTotal seconds [k·I, (k+1)·I)
time(k)    = k·I + floor( rand("s3-slot", worldSeed, salt, "open", k) × I )
u(k)       = rand("s3-live", worldSeed, salt, "open", k)
live(k, τ) = u(k) < schedule.theta[τ]                 θ = 0, 0.3125, 0.625, 1 for off, calm, steady, restless
```

The ratios 0.3125 and 0.625 are the thinning rates: calm 0.25 an hour, steady 0.5, restless 0.8, each over 0.8. Every slot live at calm is live at steady, and every slot live at steady is live at restless (S3-I-7).

**Consequences.** A change of tempo takes effect at the next slot's time, never mid-beat. A reload shows the same schedule: the clock is `playTotal`. The first hour is gentler (§7.2 and §7.3, gate 5).

**The slot pointer** `slots.open.next` is persisted (§9.2). It is the index of the one pending slot. Its handling is §7.2.

## 6. The sifter

Sifting asks "what story is in the record?". The sifter finds and keeps; the sower chooses.

### 6.1 Frames and input

The sifter's input is the **live Change stream**, plus what it chose to keep. It is not a log to scan later: replay and regeneration are silent ([S0 I-13](kernel.md#15-invariants)), and non-canon events can be forgotten.

**Pattern frames.** Each loaded pattern has one frame on the actor `director`:

```
id: H("mint", director, director, "frame:" + pattern.id)
level: 'situation', weight: 1, parents: [], origin: director, status: 'active'
focus: { nodes: [], tier: 0 }, payload: {}
own.reactsTo: one selector per event, edge and frame clause of the pattern and of its `unless` entries,
              the narrowest the kernel can express: an event kind or tag; an edge type; a frame status change
```

A `dilemma` clause has no interest: dilemmas are delivered to the director directly ([S0 §10.8](kernel.md#108-effects-and-cross-pressure)).

The frame's weight 1 and no parents give pull 1. A kind-level `reactsTo` match has `r = 1 × 0.6 × 0.5 = 0.3`, a bucket-level one `0.18`. Both clear `θ_react = 0.08` ([S0 §16.2](kernel.md#162-calibration-fixtures)). One frame per pattern keeps patterns from masking each other: the kernel emits at most one relevance event per (change, frame, interest type), so two patterns that share a first clause would collapse into one emission on a shared frame.

**What the emission carries.** The emission carries the **Change payload** (§13, the S0 clarification). The sifter tests the Change itself against every clause of the pattern, since the emission says only that some interest matched.

**Pack changes.** On a pack activation or removal, the sifter opens the frames of newly loaded patterns and closes (`abandoned`) those of removed ones. Pool entries of a removed pattern, or of an older `version` of a loaded one, are dropped with a log entry (§9.3).

**What the sifter ignores.** A `contribution` Change. An event whose `creator` is `director`, or whose kind starts `meta:`, is delivered only to a pattern that names a `meta:` kind in some clause.

### 6.2 The pool

The pool holds partial and completed matches as **copied descriptors**: ids, kinds, times, roles and tags. It holds no live node references, because a non-canon event can be forgotten.

```ts
interface PoolEntry {
  id: Id;                                   // the match id (§3.2)
  seq: number;                              // creation order, from nextSeq
  pattern: string; version: number;
  bindings: Record<string, Id>;             // variable → node
  stage: number;                            // the last stage matched; 0-based
  stages: Array<{ stage: number; event?: Id; time: GameTime; kind?: KindId;
                  dilemma?: { actor: Id; target?: Id; effect?: Effect; severity: number } }>;
  firstTime: GameTime; lastTime: GameTime;
  complete: boolean;
  told: number[];                           // stages for which a telling has already been sown
  promoted: boolean;
  refusals: number; cooldownUntil: number;  // playTotal
}
```

| Bound | Value |
|---|---|
| Entries per pattern | `poolPerPattern` (32) |
| Entries overall | `poolTotal` (256) |
| Duplicates | None: one entry per match id (the pattern and its stage-0 bindings) |
| Tombstones | One per `once` binding set, kept `tombstoneSpans × within` after the entry ends |

**When a bound is hit,** a new match is not started if there is no room that can be freed. To free a slot the sifter evicts, in the same pattern (for the per-pattern bound) or overall (for the total), the **incomplete, unpromoted** entry with the earliest `firstTime`, then the lower `seq`. If there is none, the new match is refused. Either way the event logs `pool-full`.

### 6.3 Handling a change

`onChange(change)` and `onDilemma(d)` run for each delivered emission. The cost is counted in the kernel's tick budget: one unit per pattern's stage-0 clause tested and one per partial entry advanced ([S0 §10.7](kernel.md#107-work-hard-limits-and-worklists)).

For each loaded pattern in `id` order:

1. **Entries first.** For each entry `e` of this pattern, in `seq` order, that is not complete (a snapshot taken before this change):
   1. **Unless.** For each `unless` entry `u` with `u.between = [a, b]` and `a ≤ e.stage < b`: if `matchClause(u.clause, change, e.bindings)` succeeds, the entry **dies**: it is removed, a tombstone is written (same `until`), and the log gets `match-killed`. Nothing else is tried for it.
   2. **Advance.** Otherwise let `j = e.stage + 1`. If `matchClause(stages[j], change, e.bindings)` succeeds with bindings `b'` and the stage's time is not earlier than `e.lastTime`: set `e.bindings = e.bindings ∪ b'`, append the stage, `e.stage = j`, `e.lastTime = time`. If `j` is the last stage, the entry is **complete**: mint `meta:story-end` (§6.6), write the tombstone (`until = lastTime + tombstoneSpans × within`), and set `e.complete`. If `j` equals the pattern's `keep`, apply §6.6's promotion rule. Log `match-advanced` or `match-complete`.
2. **Start.** Then try `matchClause(stages[0], change, {})`. If it succeeds with bindings `b0`:
   1. Compute the match id. If an entry with that id exists, stop (duplicate).
   2. If the pattern has `once` variables and a tombstone with their tombstone key (§3.2) exists, stop.
   3. Apply the bound rules of §6.2.
   4. Create the entry at stage 0, with `seq = nextSeq++`. If the pattern has one stage it is complete at once (as above). If `keep = 0`, apply §6.6's promotion rule.

A change can advance entries and start a new one. A change advances an entry by **at most one stage**. The sifter does **not fork**: a later change that also fits an already advanced stage is ignored for that entry. Different stage-0 bindings are different entries.

**`matchClause(clause, change, bindings) → bindings' | null`** is deterministic. It never mutates `bindings`.

- **event** (the change is `c: 'event'`):
  1. The clause's `kind` equals the event's kind, or, for `{ tag }`, `kindTags(kind)` contains the tag.
  2. For each `who` item in order: take the first participant, in participant order, whose `role` equals `item.role` and who satisfies the variable. If `item.as` is already bound, the participant's `who` must equal it. Otherwise it binds if its kind accepts the role's `kind` and the role's `where` predicates are all `yes`.
  3. For each `effects` item in order: find an event effect whose `effect` is in the item (a single value or a list) and whose `on` equals the bound variable `item.on`. If `item.on` is unbound, take the first such effect in order, and bind it by the same test as in 2.
  4. Every `where` predicate is `yes` on the event node.
  5. For stage `j > 0`, the event's `time` is not earlier than `e.lastTime`.
- **edge** (`c: 'edge'`): the edge's type equals `type`; `from` and `to`, if named, bind or match the edge's endpoints; `ended` (default false) equals the change's `ended`.
- **dilemma** (a delivered `Dilemma`): `actor` binds or matches `d.actor`; `target`, if named, matches `d.target`; `effect`, if named, equals `d.effect`; `d.severity ≥ minSeverity` (default 0).
- **frame** (`c: 'frame'`): the change's `new` status equals `status`; `actor` binds or matches the change's actor.

A dilemma stage and a frame stage have no event. They record `time = the delivery's game time`.

### 6.4 Expiry

At each simulation window boundary ([S0 §9.4](kernel.md#94-evolution)), for each pool entry, in `seq` order:
- An **incomplete** entry with `now − firstTime > within` expires: it is removed, a tombstone is written, and `match-expired` is logged.
- A **complete, unsown** entry with `now − lastTime > candidateTtl` expires the same way. A complete entry that has had every one of its tellings sown is removed.
- A **promoted** entry that has no live sown seed and `now − promotedAt > promotedTtl` is un-promoted and removed; its retention roots are released.
- Tombstones past their `until` are pruned.

Also at the boundary, an entry whose constituent events are no longer retrievable (`kernel.event(id)` is `undefined` for a stage's event) ends: it is removed, with `match-lost` logged. That is the only check; it is also made at promotion (§6.6).

At tempo `off` the sifter does not process changes (its frames are closed), and expiry is **skipped**. When the tempo leaves `off`, the frames reopen and the next boundary's expiry runs as usual. Matches that formed while `off` are lost.

### 6.5 Features and gates for a match

A pool entry becomes a **candidate** for each telling whose `atStage` equals `e.stage` and whose stage is not in `e.told`. The sower computes these when it collects candidates (§7.2). They are defined here because they read the pool. Let `bound` be the entry's bound variables whose value is a person, group or place.

**Gates** (a fail removes the candidate for this slot and logs which gate):

| Gate | Test |
|---|---|
| F-1 reportable change | Some stage is an `event` stage with at least one effect, or a `dilemma` stage with `severity ≥ minDilemma` (0.3) |
| F-4 a human at the centre | Some bound variable has kind `core:person` or `core:group` (guaranteed by S3-L-5), and the kernel still has it |
| F-8 a short chain | The entry has at most `maxChain` (5) stages: at most four links |
| F-12 a showable cause | For forms other than `rumour` and `sighting`: the latest `event` stage's event has a non-empty `causes`. A dilemma-only entry passes |

**Features** (kept raw in the log):

| # | Feature | Value |
|---|---|---|
| F-3 | stakes | Σ over the entry's event stages of the number of distinct `(on, effect)` pairs with `effect ∈ sower.harmful`, plus Σ over dilemma stages of `severity` |
| F-5 | personal link | `#{ v ∈ bound : layer2.exposedNode(v, 'presented') }`, plus 2 if `v` (V) is a participant of any event stage |
| F-6 | irreversibility | the number of distinct `(on, effect)` pairs with `effect ∈ sower.irreversible` |
| F-7 | a live gap | 1 if the entry is not complete, else 0 |
| F-9 | closure | `(e.stage + 1) / pattern.stages.length` |
| F-11 | timeliness | `H / (H + max(0, now − e.lastTime))` with `H = timelyH` |

### 6.6 Promotion and hand-over

**Promotion** retains a match so that its events survive, and gives a seed something to read.

**When.** An entry is promoted:
- when it reaches the pattern's `keep` stage, if `promoted` is false, fewer than `maxPromoted` matches are promoted, and the V-link test holds (some variable in `bound` has `exposedNode(v, 'presented')`, or V is a participant of a stage's event); or
- when the sower selects its candidate and the entry is not yet promoted (§7.6).

**How.** `promote(e)`:
1. For every event stage, `kernel.event(id)` must exist. If one does not, the entry ends with `match-lost`. Nothing is minted.
2. Mint the inert **`meta:story`** event (Id in §3.2): `creator director`; `time` the `lastTime` of the entry; participants the bound variables (`role` the variable name without `?`); `causes` the entry's event stages' events; no effects; no witnesses.
3. Create `promoted[e.id] = { events, story, seeds: [], promotedAt }` (§9.2). Its events and the story event become `nodes` of the layer-3 record, so they are retention roots until the match ends.
4. Set `e.promoted = true`.

**A completed match** mints **`meta:story-end`** (Id in §3.2) at completion, with `time` the last event's time and `causes` the first and the last event stages' events (one event if there is only one). It is not a promotion: it is a record for patterns that compose, and for tools. S1's policies ignore `meta:` kinds.

**What the hand-over carries to the seed.** The kit's roles bound by the telling's `binds`, as fixed identities in the overlay (§7.6). The reserved variables `?story` (the `meta:story` event) and `?end` (the `meta:story-end` event, if complete) bind like any other. Fragments read the story through ordinary role predicates; `trace` walks from the seed to every constituent event. A stake line and a lead line belong to staging, not to selection, and are not carried.

Promoted matches persist as part of the layer-3 record (§9). A seed sown from a match is a normal instance: it is a retention root of its own, and the match record is released when it ends (§9.3).

## 7. The sower

Sowing turns what the world already holds into seeds, at a rate the player sets. Its rule is **selection over generation**: the world is simulated, the record is sifted, and the sower chooses what to tell. It invents no content. Its vocabulary is the packs' sowable templates and patterns. The engine ships a small starter pack (S4, open question 11 of P5) so that a world with few packs still has rumours and recaps to tell.

### 7.1 Sources in the core

| Source | Supplies | Becomes |
|---|---|---|
| **match** | A pool entry and one of its tellings (§6.5) | A seed of the telling's kit, with the entry's roles fixed |
| **looseEnd** | A closure entry of a closed seed with kind `cast` or `unreadTurn` ([S2 §6.4](seeding.md#64-closing-and-outcomes)) | A `follow-up` child naming the entry in `growsFrom` |

```ts
interface Candidate {
  key: Id;                                // §3.2
  source: 'match' | 'looseEnd';
  pattern?: string; entry?: Id;           // match: the pool entry
  stage?: number;                         // match: the stage the entry has reached
  looseEnd?: { seed: Id; n: number; kind: 'cast' | 'unreadTurn'; node: Id };
  features: Record<'F3' | 'F5' | 'F6' | 'F7' | 'F9' | 'F11', number>;
  place?: Id;                             // the first bound place, in variable order
  expires: GameTime;
}
```

Other sources (promotion subjects, fronts, ambient texture, pulls) are later (§0.3).

### 7.2 The slot procedure

The schedule (§5.9) has one pending slot, `k = slots.open.next`. Each second, after the director's tick, the sower runs:

```
while (k + 1) · I ≤ playNow:                   // the window has ended
    log slot-lapsed(k); k += 1
if playNow < time(k): return                    // not yet
if not live(k, tempo): log slot-passed(k); k += 1; return        // thinned out by the dial
gate the slot:
    if time(k) < schedule.gentleFirst: log slot-gentle(k); k += 1; return    // first ten minutes
    if phase ≠ 'build' or playClock < noNewThreadUntil: return               // wait; retry next second
    if counts violate the budgets (§5.8: A ≥ 4 or L ≥ 2 or S ≥ 8): log slot-budget(k); k += 1; return
run the slot (below)
k += 1
```

`tempo` is the setting in force at this attempt. A slot that waits (`return` without `k += 1`) is retried every second until its window ends, when it lapses.

**Run the slot.**
1. Collect candidates (§7.1) and apply the gates (§7.3). If none remain: log `slot-empty(k)`; done.
2. Rank them and choose one (§7.4). Resolve its telling and kit (§7.5). Sow (§7.6).
3. If sowing was refused for every kit tried: the candidate gets the refusal (§7.6) and is removed from this slot's set. Run the choice again on the rest. At most `maxCandidateTries` candidates are tried per slot.
4. On success: record it in `recent` (§9.2), log `sow`, done. A slot sows **at most one seed**.

A slot that finds nothing is spent: there are no owed pushes in the core.

### 7.3 Gates

**Gates come before scores.** A candidate that fails a gate is not ranked. The sower records which gate failed.

| # | Gate | Why |
|---|---|---|
| 1 | The candidate has at least one eligible telling and kit (§7.5) | Nothing to sow otherwise. Content ceilings and floors are layer 2's, applied by the sowing request itself (§7.6) |
| 2 | **Match:** F-1 and F-12 (§6.5). **Loose end:** none | Causality |
| 3 | **Match:** F-4 and F-8 (§6.5). **Loose end:** none | A human at the centre; a short chain |
| 4 | **V-link.** The V-link holds if V is a participant of a stage's event, or some variable in `bound` (match) is `exposedNode(·, 'presented')`, or (loose end) `closure.witnessed` or the `node` is `exposedNode(·, 'presented')`. Without it, only tellings of form `rumour`, `recap` or `sighting` are eligible | A chain about people V has never met stays world texture |
| 5 | **Stake, level and a gentle start.** The kit's `stakeScale` is at most `block`, its level at most `maxLevel`, and `firstClass` passes the first-hour rule: not `≥ 1` before `playTotal ≥ gentleFirst`, not `> 1` before `gentleHour` | Bounded dooms; a gentle start |
| 6 | **Exclusions.** No `exclusions` or `softExclusions` entry matches the kit's tags, its skeleton `verb`, a content class its envelope names, or any node of the overlay | A stated setting overrides everything |
| 7 | **Climax budget.** If the kit is `climactic`, `C < maxClimactic`. (The attended, live and simmering counts are checked once per slot, in §7.2.) | Pacing |
| 8 | **Spine.** A telling is ineligible if its `binds` would put a node with `isSpine` into a kit role | No process rewrites the main story's characters |
| 9 | **Not already sown.** `layer2.sownBy(decision)` is empty for `decision = H("sow3", worldSeed, cand.key)`. The candidate is not in cooldown (`cooldownUntil ≤ playTotal`). A loose end's ledger entry is neither `grown` nor `refused` | Idempotence; no re-offer after a decline |

A "betrayal" or "turn" seed counts against S1's betrayal budget when S1 defines one; that is S1's check, made at casting.

### 7.4 Ranking and the draw

At a live slot the sower ranks the candidates that passed, then draws.

**1. Features to bands.** For each feature `F ∈ {F3, F5, F6, F7, F9, F11}`: if every candidate has the same value, the feature is **skipped**. Otherwise rank the candidates by value, descending, ties by `key` ascending: rank `r` = 0 for the best, `n−1` for the worst. The band is `band = 2 − floor(3·r / n)`, in {0, 1, 2}. The raw values stay in the log.

```
composite(c) = ( Σ_F w_F · band_F(c) ) / ( 2 · Σ_F w_F )          over the features not skipped; 0.5 if none
```

with `w_F = sower.featureWeights[F]`. The composite lies in [0, 1].

**2. Diversity.** `dup(c)` is the number of entries in `recent` whose `pattern` equals `c.pattern` plus the number whose `place` equals `c.place`. (A loose end has no pattern; only the place counts.)

```
score(c) = sower.lambda · composite(c) − sower.diversity · dup(c)
```

**3. The draw.** By §3.3, `keyName = "s3-pick"`, `keyArgs = ["open", k]`, `o.key = c.key`. The band composite only tilts the draw, so the top candidate does not win every time. No fitted formula decides an offer.

**4. Authored first.** If an authored seed and a sown one want the same node, S2's claim priority decides ([S2 §9.2](seeding.md#92-settling)) and the authored seed wins (S2-I-10). The sower never sows to contest.

### 7.5 Telling and kit

**Telling.** For a match candidate, the eligible tellings are those with `atStage = e.stage`, not in `e.told`, passing gate 4 (the form allowed) and with at least one eligible kit. If more than one, choose by §3.3 with `keyName = "s3-tell"`, `keyArgs = [cand.key]`, option `i` = the telling's index in the pattern, `score = 0`. For a loose end the one telling is `{ form: 'follow-up' }`.

**Kit.** The eligible kits for a telling are:
- the telling's `kit`, if named; otherwise
- every sowable template whose `serves` includes the form and whose roles include every key of `binds` (for a loose end: whose `from` includes the entry's kind, with `subject` as the role to bind);
- filtered by the template's sowable load checks and by gates 5, 6 and 7.

Choose by §3.3 with `keyName = "s3-kit"`, `keyArgs = [cand.key]`, `o.key` the template id, and

```
score(kit) = ln(kit.weight ?? 1) − sower.kitDiversity · [kit ∈ the last recentKits kits sown]
```

If the kit is refused (§7.6), run the choice again without it, at most `maxKitTries` times.

### 7.6 Instantiation and the sowing request

Instantiation has four steps in the core.
1. **Choose the kit** (§7.5).
2. **Build the overlay.** Fix what the match already bound:

```ts
interface SeedOverlay {
  roles?: Record<RoleKey, { identity: Id }>;     // each is a fixed identity (S2 §2.2)
  growsFrom?: GrowsFrom;                          // a loose end: { looseEnd: { seed, entry } }
  stakeScale?: 'person' | 'crew' | 'block';       // default: the template's, else 'block'
}
```

   For a match: `roles[kitRole] = { identity: bindings[variable] }` for each `binds` entry, with `?story` and `?end` as the minted events. Promote the entry first if it is not promoted (§6.6); if promotion fails (`match-lost`), the candidate is dropped. For a loose end: `roles[template.sowable.subject] = { identity: node }` and `growsFrom = { looseEnd: { seed, entry: n } }`. **The overlay can change nothing else:** no durations, no `must` terms, no persistence flags, no timing. S2's defaults for persistence ([§2.5](seeding.md#25-facts-world-requirements-effects-and-dependencies)) and for timing ([§2.12](seeding.md#212-timing-requests): `onExpire: 'unattended'` for procedural seeds) already do what P5 wanted.
3. **Fill the open parts.** Nothing is done here in the core. The seed's open parts are filled by layer 2's casting and draws, which call the fit hook (§4). A sown seed is fitted exactly as an authored one is.
4. **Sow** with the request below.

```ts
interface SowRequest {                           // story.seed@1, from the procedural engine
  template: TemplateId; pack?: string;
  overlay: SeedOverlay;
  localName: string;                             // the first 16 hex characters of cand.key
  decision: Id;                                  // H("sow3", worldSeed, cand.key)
}
type SowResult = { ok: true; instance: Id; existing: boolean } | { ok: false; findings: Finding[] };
```

Layer 2 applies the overlay to the expanded template (after profile expansion and the variant merge), **lints** the result at the template's maturity, and either mints the instance or refuses it ([S2 §3.1](seeding.md#31-the-steps), [§13](#13-what-s2-v11-must-add), A-1). The instance `Id` follows [S2 §1.2](seeding.md#12-instances): creator `director`, cause `decision`, name `"seed:" + template + ":" + localName`. **Sowing is idempotent:** the same request finds the same instance (`existing: true`).

**On success.**
- A match: append the stage to `e.told`; add the instance to `promoted[e.id].seeds`.
- A loose end: set its ledger entry to `grown`.
- Push `{ pattern, kit, place, at: playTotal }` onto `recent`, keeping the last `recentSown`.

**On refusal.** The findings are logged. For the candidate: `refusals += 1`, `cooldownUntil = playTotal + cooldown`. At `maxRefusals` the candidate is dropped for good: a match entry is removed with a tombstone and a loose-end ledger entry becomes `refused`.

### 7.7 Loose-end growth

When a seed closes, layer 2 mints a `seed-outcome` event with a `closure` record ([S2 §6.4](seeding.md#64-closing-and-outcomes)). The sower reads `InstanceView.closure.looseEnds` for entries of kind `cast` and `unreadTurn` (both carry the node). It makes one candidate per entry that has no ledger entry, or whose ledger entry is `cooling`. Other kinds are ignored with a `loose-end-unsupported` log entry.

- The candidate's features are those of §6.5 with: F-3 = 0, F-5 = (1 if `closure.witnessed`) + (1 if the node is `exposedNode(node, 'presented')`), F-6 = 0, F-7 = 0, F-9 = 1, F-11 = `H / (H + max(0, now − closure.at))`.
- `expires = closure.at + candidateTtl`.
- **Each loose end grows at most once.** The ledger records `grown` and survives reloads.
- **Generated seeds never hold roles on the spine** (gate 8).
- The slot-level budget check of §7.2 applies to a child as to any opening. A thread V engaged with gains a follow-up; an ignored one fades, because the sower never forces it.

### 7.8 Withdrawal

```ts
interface WithdrawRequest {                      // story.withdraw@1
  seed: Id; reason: 'overflow'; decision: Id;    // H("wdraw3", worldSeed, seedId)
}
```

Layer 2 treats it as a **source withdrawal**: T1, `withdrawn` ([S2 §6.2](seeding.md#62-transitions)). A seed that was ever released closes and queues its closing trace if the template has `closing`; S3-K-3 guarantees it has one unless it was a `rumour`, `recap` or `sighting`. A seed that was never released leaves no residue. Only a seed with `source.by = 'director'` can be withdrawn this way. Withdrawal is a class 3 action, capped by `withdrawCap` (§5.8). It is the only withdrawal in the core.

### 7.9 What the dial does

| Part | `off` | `calm`, `steady`, `restless` |
|---|---|---|
| Sifter | Stops. Frames closed; the pool is kept, unchanged | Runs |
| Sower | Stops. Slots are never live | Runs at the rate of §5.9 |
| Overflow withdrawal | Runs (it only withdraws seeds the engine sowed) | Runs |
| Fitter, hooks, thread view, pacing state | Run | Run |
| Model fold and log | Run if `noticing` allows | Run if `noticing` allows |

**The dial scales how much the engine sows. It never changes how a decline is handled.** For authored and already-sown seeds every rule on this page holds at every setting, `off` included.

## 8. The player model in the core

**What it is.** The engine's belief about V's taste in what it is offered. It is not a belief about V's character, feelings or motives ([D-09](../decisions.md)). In the core it is **computed and logged, and read by nothing**. No hook, gate, feature, draw or schedule reads it (S3-I-4). No `director → v` belief is written. The fold is rebuilt from canon events, so nothing of it is saved.

**The fold.** Let the inputs be canon `offer` and `response` events after `settings.modelFloor` ([S2 §8.5](seeding.md#85-display-and-exposure)), less events carrying a content class marked sensitive, less events in an excluded facet (`settings.exclusions`). With `noticing: off` there is no fold and no log entry. `full` behaves as `acts`. At load the fold is rebuilt over at most the latest 2000 such events **[tunable]**.

The signal is T1 only ([P5 §3.9](../p5-procedural-engine.md#39-the-player-model)): V's responses to displayed offers. T0 would feed the orientation facet, which is later. T2 and T3 are never read.

**Facets** (a closed set; a pack cannot add one):
- *response rate by skeleton value*: one facet per (`verb`, `stake`, `relationship`, `outcome`, `tone`) value of the offer's `features`;
- *response rate by channel and class*: the (`channel`, `class`, `purpose`) of the offer.

**Evidence** per response (`(s, t)`, dossier 12 INF-02): accepted and carried on `(1, 0)`; accepted then abandoned within 120 play seconds `(0.5, 0.5)`; explicit decline `(0, 1)`; lapse after perceived `(0, 0.5)`; retract `(0, 1)` and an exclusion; counter-offer `(0.5, 0)`; not displayed, nothing.

**The estimator** ([dossier 12 §5.3](../craft/d12-player-model-trust.md#53-the-estimator)), with `model.H = 36000`, `model.cap = 12`, `model.c = 1.5`, `model.e = 0.15`. For a facet `f`, over its displayed offers `i`, with `Δ(i)` the play seconds since the response:

```
w(i)  = H / (H + Δ(i))
a, b  = Σ w(i)·s(i), Σ w(i)·t(i)           both scaled by cap/(a+b) if a + b > cap
n     = a + b
p     = (1 + a) / (2 + n)
p0    = the same estimate over all displayed offers in the same channel class
g(n)  = clamp((n − 3) / 5, 0, 1)
u(n)  = 1 / sqrt(n + 1)
m(o)  = 1 + ( c · Σ_{f ∈ F(o)} g(n_f)·(p_f − p0) + e · Σ_{f ∈ F(o), n_f < 3} u(n_f) ) / |F(o)|
shadow(o) = ln( clamp(m(o), 1/1.5, 1.5) )
```

**The shadow score.** When a delivery is released, the director computes `shadow(d)` for it and writes it to the decision log (`kind: 'model'`). It is **not** returned to layer 2, and layer 2 adds 0. Panels can then compare what Score would have done with what happened. The shadow is computed after the release is decided, from events that exist then, so it cannot influence the release.

**Privacy.** Local only. The model starts empty on a new branch and is never read across branches. The log leaves the model out of exports and reports by default.

## 9. Persistence

### 9.1 What is state, and where it lives

| State | Persisted? | Rebuilt by |
|---|---|---|
| Pacing state (`A`, `N`, phase, episode, locks) | No (session) | Restarts in `settling` at a load |
| The schedule position `slots.open.next` | Yes, in the layer-3 record | Without it: derived as `floor(playTotal / I)` |
| Thread view and statuses | No (derived) | Layer 2's records, stamped with `playTotal` |
| The pool, promoted matches, tombstones | Yes | A cache: a save without them loads with an empty pool |
| The loose-end ledger, the recent-sown ring | Yes | A cache |
| The player model | No | A fold over canon events |
| Settings | Yes (S0 `SettingsSet`) | Replay |
| Draws made through the fit hook | Yes, in layer 2's draw records | |
| Why a seed was sown | Yes, in the instance's `source.decision` (A-1) | |
| The decision log and the rivals ring | No (local, per session) | |

### 9.2 The layer-3 record

One `SeedRecord` under `layer3Id` ([S0 §14.1](kernel.md#141-what-is-persisted), V4-7), written as a `SeedState` op when it changed since the parent save, like S2's global record.

```ts
// SeedRecord.state for the layer-3 record
interface Layer3State {
  schema: 1;
  slots: { open: { next: number } };
  nextSeq: number;
  pool: PoolEntry[];                                  // §6.2; in creation (seq) order; capped
  promoted: Record<Id, PromotedMatch>;                // keyed by match id
  tombstones: Array<{ pattern: string; key: Id; until: GameTime }>;   // key: the tombstone key of §3.2
  ledger: Array<{ seed: Id; entry: number; state: 'grown' | 'refused' | 'cooling'; refusals: number; cooldownUntil: number }>;   // capped at ledgerCap, oldest first
  recent: Array<{ pattern?: string; kit: TemplateId; place?: Id; at: number }>;                        // last recentSown
}
interface PromotedMatch {
  events: Id[];                                       // the constituent events
  story: Id;                                          // the meta:story event
  end?: Id;                                           // the meta:story-end event, once complete
  seeds: Id[];                                        // instances sown from this match
  promotedAt: GameTime;
}
```

| `SeedRecord` field | Value |
|---|---|
| `id` | `layer3Id` |
| `state` | `Layer3State` |
| `nodes` | The union of every promoted match's `events`, `story` and `end`: the retention roots |
| `actor` | Omitted. Layer 3's record is not a demand root. Its pattern frames are the director's, a demand root already |

**Bounds.** The pool is at most `poolTotal` entries. A descriptor has at most `maxStages` stages of a few tens of bytes, so the cap is tens of kilobytes. `ledger` is at most `ledgerCap`; when full, the oldest `grown` or `refused` entry is dropped first. P7 measures the save size before any cap is fixed.

### 9.3 Loading

After the kernel replays a save and layer 2 rebuilds ([S2 §12.2](seeding.md#122-loading)), layer 3:
1. Reads the layer-3 record. **If it is absent, layer 3 starts empty** (the pool is a cache). Nothing else is lost; no error is shown.
2. Reconciles with the loaded patterns: drops pool entries and tombstones of patterns no longer loaded, and entries whose `version` differs from the loaded one. Each drop logs `match-dropped`.
3. Opens the pattern frames (§6.1) and reopens any frames whose pattern is loaded.
4. For each promoted match: drops it if its events are gone (`match-lost`), or if every instance in `seeds` is terminal and every telling has been sown, or if it has expired (§6.4). Otherwise it stays a retention root.
5. Rebuilds the thread view from layer 2's records.
6. Starts the pacing state in `settling`. The schedule resumes from `slots.open.next`.
7. Rebuilds the model fold (§8) if the log is enabled.

**What is the same after a load:** the schedule, the pool and its candidates, the sowing decisions, the instances and their offer `Id`s. **What may differ:** when the next push is released, because pacing restarts in `settling` and the arbiter's timers restart. One divergence remains: a match that was still forming from events that only the lost session had seen. The pool is saved at each save, so the window is the time since the last save (compromise C-S3-6).

Layer 3 is **branch-local**. The pool, the ledger and the model start empty on a new branch and are never read across branches.

## 10. The decision log

Every director action and every sowing, hold, fit, withdrawal and match event writes one entry to the **session ledger**: local, per session, never part of the save.

```ts
interface LogEntry {
  seq: number;
  kind: 'slot' | 'sow' | 'withdraw' | 'hold' | 'phase' | 'fit' | 'match' | 'promote' | 'budget' | 'model';
  at: { game: GameTime; playTotal: number; playClock: number };
  purpose: 'schedule' | 'follow-up' | 'rest' | 'protect-peak' | 'lead-aim' | 'headroom' | 'overflow' | 'match' | 'fit' | 'model';
  class: 0 | 1 | 3;                          // the manipulativity class; class 4 does not exist
  rule: string;                              // the gate, hold rule, band or budget that fired
  inputs: Record<string, unknown>;           // only from the closed lists
  chain: Id[];                               // the explanation chain: record facts that justify it
  data: Record<string, unknown>;
}
```

| `kind` | Written when | `data` holds |
|---|---|---|
| `slot` | A slot is passed, lapsed, gentle, budget-blocked, empty or run | `k`, `time(k)`, `u(k)`, the tempo, the reason |
| `sow` | A candidate is sown or refused | The pattern id and version, the bindings, the raw features, the bands, the composite, the scores with noise, the **rivals** (every candidate ranked, in a ring of the last 8 slots, not saved), the telling, the kit and its scores, the request and its result |
| `withdraw` | A thread is withdrawn | The counts, the victim and why it was the lowest |
| `hold` | A (delivery, reason) pair first appears, and when it clears | The delivery, the reason, `T`, the phase |
| `phase` | A transition | The previous phase, the new one, `A`, `N`, `T`, `engaged`, `R` |
| `fit` | A fit hook call with a non-zero raw weight | The choice, each option's three terms, raw and clamped |
| `match` | A start, advance, completion, kill, expiry, loss, drop, `pool-full` | The pattern, the stage, the bindings |
| `promote` | A promotion | The match id, the minted ids |
| `budget` | A refresh finds a count over a budget | The four counts |
| `model` | A shadow score; a facet's update | The delivery, `m`, the shadow, the facets and their `n` |

**Manipulativity classes.** Sowing a seed whose first delivery is class 0 is a `trace`, class 0. Sowing one whose first delivery is class 1 or above is an `offer`, class 1. A hold, a withdrawal and a rest are class 3. **Class 4, changing anything V has observed or could base a choice on, does not exist.** Any action that would change a unit's strength is a logged defect.

**Rendering.** Turning a log entry into one plain sentence is a later capability (P6). In the core the entry is the explanation.

## 11. Invariants

| # | Invariant |
|---|---|
| S3-I-1 | **Determinism.** The same inputs (§3.1) give identical sowing decisions, instance `Id`s, holds, joint reports, pool contents and layer-3 records |
| S3-I-2 | **Two doors.** Layer 3 changes the world only through `story.seed@1` and `story.withdraw@1`, and mints only inert `meta:` events. It writes no pin, belief, contribution or edge |
| S3-I-3 | **Bounded hooks.** `fit` is clamped by layer 2 to ±`fitCap`; `hold` only removes, and never holds a pull, class-0 or closing delivery; `joint` only reports; `onRelease` only adds to `N` |
| S3-I-4 | **The model has no entrance.** The fold of §8 is read by the decision log only. A static audit finds no read of it in any hook, gate, feature, draw, schedule or budget |
| S3-I-5 | **Closed inputs.** Hooks read only §1.5's list, the fit hook only §4.2's, the director only the sense feed. Perturbing session length, idle time, quit, save and load counts, time of day and the wall clock changes no hook output and no record, byte for byte |
| S3-I-6 | **Authored first.** The budgets, the schedule and the phase hold never refuse, withdraw or (past 70 per cent of `maxWait`) hold an authored seed. The engine's threads yield |
| S3-I-7 | **Nested schedule.** `time(k)` and `u(k)` depend only on `worldSeed`, `salt`, the stream and `k`. A slot live at a tempo is live at every higher tempo. Changing the tempo never changes `time(k)` or `u(k)` |
| S3-I-8 | **Idempotent sowing.** One candidate key gives one decision id and, for one template, one instance `Id`. Sowing twice finds the existing instance. A reload before a save re-sows the same seed |
| S3-I-9 | **Bounded state.** The pool, the ledger and the recent ring never exceed their caps. The pool holds only copied descriptors, never live node references |
| S3-I-10 | **A cache, not a source.** A save without the layer-3 record loads without error. A save with it gives the same schedule, candidates and sowing decisions after a load |
| S3-I-11 | **Fitting is independent of sowing.** The fit hook and the lead aim give the same output with tempo `off` and with any other tempo, and with sowing on or off, from the same state |
| S3-I-12 | **Selection never edits.** No layer-3 action changes a unit's strength, stakes, hostility or reward, removes an event that happened, or rewrites a fragment. The overlay holds only role identities, `growsFrom` and `stakeScale` |
| S3-I-13 | **Session independence.** No draw key, `Id`, ordering or tie-break reads the session epoch, the play clock, a load count or the wall clock ([S0 I-16](kernel.md#15-invariants)). The play clock drives only the pacing tick |
| S3-I-14 | **Inert meta events.** A `meta:` event has no effects and no witnesses, and the director is its creator. S1's policies ignore it |
| S3-I-15 | **Explained.** Every sowing, hold, withdrawal and phase transition writes a log entry with its rule and a chain to a recorded fact |
| S3-I-16 | **No spine, no doom.** A sown seed binds no spine node, has stake scale at most `block`, and level at most `gig` |
| S3-I-17 | **A decline stays a decline.** A candidate whose seed V declined, retracted or let lapse is never sown again (idempotent decision id; the ledger; tombstones). The dial never changes how a decline is handled |

## 12. Fixtures

Every fixture uses `worldSeed = H("fixture", <id>)`, the fixture pack `xf.fixture`, the kernel's core schema plus S0 §20, S2's core, and `Layer3Data` at its defaults. As in S0, outcomes that depend on hashes are checked as properties, not numbers.

### 12.1 Unit fixtures

| # | Setup | Expected |
|---|---|---|
| SF3-1 | **Nested schedule.** For `k = 0 … 999`, compute `time(k)` and `u(k)`; evaluate `live(k, τ)` for each tempo | `time(k)` lies in `[k·I, (k+1)·I)`. `live(·, off)` is never true. The sets nest: calm ⊆ steady ⊆ restless, and restless is all 1000. The counts are within 5 standard deviations of 312.5 and 625 |
| SF3-2 | **Slot handling.** A branch at `playTotal` 0 with tempo `restless`; run 3 slot windows. Then the same with the sower's pending slot blocked by phase `rest` through a whole window | A slot with `time(k) < 600` logs `slot-gentle`. A blocked slot is retried each second and, when its window ends, logs `slot-lapsed` and the pointer advances. Reloading from a save at any point resumes at the saved `next` |
| SF3-3 | **Pacing arithmetic.** Start in `build`, `A = N = 0`. Frames: ticks 0 to 99 quiet. Tick 100: health falls from 1.0 to 0.5, `downed` becomes true, `hostileAware` and `hostileAwareNear` become true. Ticks 101 to 129: engaged, nothing else. From tick 130: quiet, not engaged | `A(100) ≈ 0.9`; held at ≈ 0.9 through 129; `A(130) = 0.9 × decayA ≈ 0.8794`. Phase: `peak` at 100; `fade` at 140 (`A ≈ 0.6980`); `rest` at 170 (`A ≈ 0.3490`); `build` at 215. At 215, `A ≈ 0.1234`. Exactly one transition per tick |
| SF3-4 | **Rest length.** The SF3-3 episode lengths 10, 60 and 200 seconds | `R` = 45, 90 and 180 |
| SF3-5 | **Hold table.** In `rest`: a sown class-2 offer; a class-0 trace; a `pull` call; a `close` message; an authored class-2 offer having waited 0.7·`maxWait`; a sown class-2 offer having waited 0.7·`maxWait` | Held: the first (`phase-rest`) and the last (the phase hold does not relax for a sown delivery). Not held: the others |
| SF3-6 | **Peak, fade, headroom.** In `peak`: a delivery with intensity 0.2, and one with −0.2. In `build` with `T = 0.65`: intensity 0.4 and 0.2 | The 0.2 delivery is held (`phase-peak`); the −0.2 one is not. In build: 0.4 is held (`headroom`, 0.4 > 0.35); 0.2 is not |
| SF3-7 | **Climax rests.** A witnessed gig-level `seed-outcome` at play clock 1000 | Until 1300 every delivery above class 0 except pull and close is held (`climax-rest`); until 2200 any with intensity ≥ 0.5 is held. An arc-level outcome also sets `noNewThreadUntil = +1200` and the sower waits |
| SF3-8 | **Lead aim.** A first-release `introduce` delivery with `lead` of each value; urgency 0, then 0.4, then 0.8; joint latched or not; waited 0, 299, 300 | `early`: never held. `preferred`: held until urgency ≥ 0.35, or waited ≥ 300 with a latched joint. `late`: held until urgency ≥ 0.7. All relax at 0.7·`maxWait` |
| SF3-9 | **Joint.** Frames: V walks 150 m and stops for 3 s; a sleep jump ends; a `seed-outcome` with `witnessed`; a pull is queued; two at once | `arrived`, `woke`, `finished`, `asked` reported once each, at the second they happen. For two at once, the earlier in the list is reported. No report while engaged, driving or speaking |
| SF3-10 | **Thread view.** Seeds A (authored, presented 10 minutes ago), B (sown, presented 3 hours ago), C (sown, presented 10 hours ago), D (sown, never shown), E (closed, closing shown); B is a loose-end child of E; A and C share an anchor cast node | A and C are one thread (attended). B and E are one thread (simmering). D is `unseen` and counts toward `A` and `L`. E's thread is not closed while B is live. Statuses survive a save and load unchanged |
| SF3-11 | **Budgets gate.** Counts `A = 4`; then `L = 2`; then `S = 8`; then `C = 1` with a `climactic` kit | The sower logs `slot-budget` for each of the first three; for the fourth only climactic kits are ineligible. An authored seed is sown in all four cases |
| SF3-12 | **Overflow.** Five attended threads: three authored, two engine-sown (one answered with an action) | One withdrawal: the unanswered engine-sown thread with the smallest `lastConfirmed`. The answered one stays. The authored ones stay. A second overflow within an hour that already holds 2 withdrawals withdraws nothing |
| SF3-13 | **Pattern load.** Eight patterns, each failing one of S3-L-1 … L-8, and a good twin | Each bad pattern is refused with its check named; the twin loads; the others are unaffected |
| SF3-14 | **Sowable load.** Seven templates, each failing one of S3-K-1 … K-6 (K-3: serves `offer` with no `closing`), and a good twin | Each bad one is not sowable by layer 3 (the pack may still sow it). The twin is |
| SF3-15 | **Matching.** The pattern *order against kin* ([P5 §6.2](../p5-procedural-engine.md#62-the-pattern-form)), written out: roles `?m`, `?x` (persons); stages `dilemma(actor ?m, target ?x, effect kill, minSeverity 0.3)` then `event(kind act, who [{actor as ?m}], effects [{on ?x, effect [harm, kill, protect, rescue, expose]}])`; `unless` between 0 and 1: `event(kind order-withdrawn, who [{target as ?m}])`; `once [?m, ?x]`. Scripted stream: a dilemma with severity 0.4 for (M, X); then an `act` event with effect `protect` on X. In a second run, an `order-withdrawn` event for M between the two | First run: an entry at stage 0, then complete at stage 1; `meta:story-end` minted once, with the one event as its cause; tombstone written. Second run: killed by `unless`; tombstone; no completion. A dilemma with severity 0.2 starts nothing |
| SF3-16 | **Once and duplicates.** The same stage-0 bindings arrive twice; then again after completion; then after the tombstone's `until` | The second is a duplicate (ignored). The third is refused by the tombstone. The fourth starts a new entry |
| SF3-17 | **Expiry.** An entry older than `within`; a completed entry older than `candidateTtl`; a promoted entry with no live seed older than `promotedTtl` | Each is removed at the next window boundary with its log entry. The promoted one releases its retention roots |
| SF3-18 | **Pool bounds.** 33 distinct stage-0 matches of one pattern; then 257 across patterns, all incomplete | The 33rd evicts the oldest incomplete entry (`pool-full` logged). Never more than 32 per pattern or 256 total. A pool of only complete entries refuses a new match |
| SF3-19 | **Own sowing ignored.** A `contribution` Change from a sown seed; a `meta:story` event; a pattern that names `meta:story` and one that does not | No pattern advances on the contribution. Only the pattern naming `meta:story` sees the event |
| SF3-20 | **Promotion.** An entry reaches `keep` with V-link; then one whose event is forgotten before promotion | The first mints `meta:story` with the specified `Id`, `causes` and no effects, and the event ids join `nodes`. Reloading mints the same `Id`. The second ends with `match-lost`, mints nothing |
| SF3-21 | **Gates.** Candidates failing, in turn, each of gates 1 to 9 | Each is removed with its gate logged. A passing candidate is ranked |
| SF3-22 | **V-link texture.** Two candidates over people V never met, with tellings `rumour` and `offer` | Only the `rumour` telling is eligible. After V meets one of the people (`presented`), the `offer` telling is eligible too |
| SF3-23 | **Banding and the draw.** Four candidates with distinct feature values; run the draw. Then raise one candidate's F-3 | Bands follow §7.4. The composite lies in [0, 1]. The draw is deterministic. Raising a loser's score changes the winner only if it becomes the winner (coupled draws). A feature equal for all is skipped |
| SF3-24 | **Draw after refusal.** The winner's sowing is refused | The draw is re-run without it: the runner-up (by the same noise) is tried. At most 3 candidates per slot |
| SF3-25 | **Refusal and cooldown.** A kit that fails layer 2's lint, three times | After each: `refusals` + 1 and a cooldown of 600 play seconds. After the third the entry is removed with a tombstone. The log has each finding |
| SF3-26 | **Idempotent sowing.** Sow a candidate; save; load; run the slot again | `existing: true`, the same instance `Id`, no second instance. `told` and `seeds` are not duplicated |
| SF3-27 | **Loose-end growth.** A closed seed with `cast` and `unreadTurn` loose ends and one `fact` | Two candidates, one `loose-end-unsupported` log. A chosen one sows a follow-up with `growsFrom.looseEnd`. Its ledger entry is `grown`. After a reload no second child is sown for it |
| SF3-28 | **Tempo at run time.** Restless for a stretch, then `off`, then `steady` | While `off`: no new pool entries, no slots live, frames closed, pool kept. Authored seeds still sown, fitted, held and released. On return: frames reopen, expiry resumes, the schedule continues unchanged |
| SF3-29 | **The fit hook.** A cast with 4 candidates: one held by a live seed, one cast last time by this template's previous instance, one whose aesthetic readings match the intent exactly (`T_aes = 1`), one plain | Terms follow §4.3. Raw weights: the held one −0.3, the repeat −0.2, the match +0.3, the plain 0. Layer 2 clamps each to ±0.405 (ln 1.5). The draw records raw and clamped |
| SF3-30 | **Fitting independent of sowing.** The SF3-29 cast and SF3-27's report under every tempo | Identical terms, identical report `fit` field. With layer 3 absent: every raw weight 0 |
| SF3-31 | **Hook perturbation.** Run SF3-27 and SF3-3 twice; perturb session length, idle time, quit and save counts, time of day, the wall clock | Byte-identical hook outputs and records |
| SF3-32 | **The model, worked.** The dossier 12 example: 6 displayed `verb: infiltrate` offers in channel class C with responses 4 accepted, 1 declined, 1 lapsed; 5 `verb: wet work` offers in C, each lapsed after perceived; every response at the current play second. Candidate offer with `F(o) = { verb: infiltrate }` | `a = 4, b = 1.5, n = 5.5, p = 0.6667`. Over the channel class `A = 4, B = 4`, so `p0 = 0.5`. `g = 0.5`. `m = 1.125`. `shadow = ln 1.125` (to the fdlibm value) |
| SF3-33 | **The model is inert.** Run SF3-27 with the fold disabled, enabled, and with its constants changed | Byte-identical sowing decisions, holds, joint reports, pool and records. Only `model` log entries differ |
| SF3-34 | **No layer-3 record.** Load a save made without the layer-3 record | Loads without error. Empty pool; schedule resumes from `floor(playTotal / I)`; a new match can start. No finding is shown to the player |
| SF3-35 | **Crash points.** Save and load between every pair of adjacent steps of SF3-15, SF3-20, SF3-26 and SF3-27 | After each load the pool, ledger, promoted matches and instances equal those of an uninterrupted run, except for a match whose events were seen only by the lost session (C-S3-6) |

### 12.2 End-to-end fixtures

**The world.** The fixture pack `xf.fixture` holds:
- the authored seed `xf.fixture:r1`, the scenario R1 of [S2 Appendix A.3](seeding.md#a3-reference-scenario-r1), with `lead: 'early'` on its window and a first request of kind `message`, class 2, `maxWait` 1800, `intensity` 0.2;
- the pattern `xf.fixture:grudge`: roles `?a`, `?b` (persons); stages `event insult (who actor ?a, target ?b)` then `event assault (who actor ?a, target ?b; effects harm on ?b)`; `unless` between 0 and 1 an `apology` event by `?a`; `within` 3 game days; `once [?a, ?b]`; tellings `{ atStage 0, form rumour, binds { subject ?a, other ?b } }` and `{ atStage 1, form recap, binds { subject ?a, other ?b } }`;
- the sowable templates `xf.fixture:rumour-kit` (a glance; serves `rumour`, `recap`; `firstClass` 0; roles `subject` and `other`; `subject` has a goal, so closing the seed changes its frame and yields a `cast` loose end for `subject`) and `xf.fixture:follow-kit` (an encounter; serves `follow-up`; `from ['cast']`; `subject` role `who`; `firstClass` 1; with `closing`).

People Mara (`?a`) and Dex (`?b`) exist. V has met Mara: `exposedNode(Mara, 'presented')` is yes. The sense feed and the injected events are scripted, with the play clock starting after the load's settling. One game second passes per play second. No attention aspect is active (the fixture's firefight is only a sense-feed script, so S2's attention gate does not interfere).

**SF3-36. End to end, sowing off.** Tempo `off`. R1's facts are set at play clock 105, so its first request is submitted then. The sense feed is SF3-3's.

| Play clock | What happens | Expected |
|---|---|---|
| 100 | The firefight begins (SF3-3 frames) | Phase `peak` |
| 105 | R1's request is submitted; the arbiter's steps run each second | The hook holds it: `phase-peak` (intensity 0.2 > 0) |
| 140 | `fade` | Held: `phase-fade` |
| 170 | `rest`, `R = 45` | Held: `phase-rest` |
| 215 | `build` (the tick precedes the arbiter's step) | Not held: headroom 1 − 0.1234 ≥ 0.2. Released at 215 |
| after | V answers; R1 runs as SF3-7 | The same states and offer `Id` as the layer-3-absent run |

**Compared with a run with layer 3 absent** (same world, same frames): R1 is released at 105; the draws, the cast, the offer `Id`, the outcome and the closure record are identical; the only differences are the release time, the `fit` fields in the draw records (raw and clamped, all within ±0.405) and the log. In particular no `story.seed@1` is ever sent, the pool stays empty, and the schedule never goes live.

**SF3-37. End to end, sowing on.** The same world and frames. Tempo `steady`. Additional script (play clock): at 1000 an `insult` event (Mara, Dex) is minted; at 1100 an `assault` event with effect `harm` on Dex; the world then runs on.

| Step | Expected |
|---|---|
| Play 1000 | A pool entry for `(Mara, Dex)` at stage 0. A tombstone is not yet written |
| Play 1100 | The entry is complete. `meta:story-end` is minted once, with the specified `Id`. The tombstone is written. One candidate for telling 1 (`recap`) |
| The first slot `k₁` that is live at steady, has `time(k₁) ≥ 1100`, and finds phase `build` | The candidate passes gates 1 to 9 (V-link: Mara is met). It is the only candidate. The entry is promoted (`meta:story` minted). One `story.seed@1` for `xf.fixture:rumour-kit` with overlay `subject = Mara`, `other = Dex`, `decision = H("sow3", worldSeed, cand.key)`; the instance `Id` follows S2 §1.2; the log has one `sow` entry with the raw features and the rivals (none) |
| Class 0 | The rumour glance is class 0: not held by any phase, not counted toward spacing or the cap. R1's release time and records are exactly those of SF3-36 |
| The glance seed closes | A `seed-outcome`, `witnessed` true if V was shown it, with a `cast` loose end for `subject` |
| The next live slot | A `follow-up` candidate from that loose end: `follow-kit` sown with `subject = Mara` and `growsFrom.looseEnd`; ledger `grown` |
| The slot after | No second child for that entry. No candidate: `slot-empty` |
| Property | Replay the whole run with a different `salt`: the same candidate set, a possibly different draw order, but the sowing remains idempotent and deterministic for that salt |
| Reload | Save at play 1050 (between the stages), load, replay the script: the pool holds the stage-0 entry across the load and every later step is identical to the uninterrupted run |
| Property | R1's draws, cast, offer `Id`, outcome and closure record are byte-identical to SF3-36's; the fit report for R1 is identical with sowing on and off |

### 12.3 Property tests

With the layer-3 implementation, the reference model also checks, over generated scripts and logged named streams, shrinking failures ([dossier 23](../craft/d23-evaluation-testing.md)):
- **S3-I-1 to S3-I-17** as properties, including random save and load points between any two adjacent steps;
- **Nested schedule** over random tempo walks;
- **Pool bounds** under random Change streams, and with random pack unloads;
- **Coupled draws:** removing a non-winning candidate never changes the winner;
- **Hook and sense perturbation:** random perturbation of every input not on the closed lists changes nothing;
- **Authored first:** over random casting orders (with S2-I-10);
- **Fit independence:** the fit report under every tempo and with layer 3 absent (all zero);
- **Phase machine:** over random sense feeds, at most one transition per tick, rest lengths in bounds, `T` in [−1, 1];
- **Inertness of the model:** random model constants change only the log.

## 13. What S2 v1.1 must add

S2 v1.0's core governs the first implementation. Layer 3 needs the following. They are exact proposed additions; the coordinator folds them into S2. Items marked *clarification* change no behaviour of S2's reference implementation. P5 §10's labels are shown where they apply.

**A-1. A sowing request with an overlay** (P5 N-2, narrowed). In §1.2 and §3.1, `story.seed@1` takes:

```ts
interface SowRequest {
  template: TemplateId; pack?: string;
  overlay?: { roles?: Record<RoleKey, { identity: Id }>; growsFrom?: GrowsFrom; stakeScale?: 'person' | 'crew' | 'block' };
  localName: string; decision: Id;
}
type SowResult = { ok: true; instance: Id; existing: boolean } | { ok: false; findings: Finding[] };
```

Layer 2 merges the overlay over the expanded template **after** profile expansion and the variant merge and **before** the lint at step 3. Each `roles[k].identity` replaces that role's `identity` with a fixed `Part`. `growsFrom` and `stakeScale` replace the template's. Nothing else can be overlaid. The lint then runs on the merged document; an error refuses the request and sends `findings`. An overlay naming a role the template lacks, or a node whose kind the role does not accept, is refused. The instance state `source` becomes `{ by, layer, decision? }`, with `decision` set for a request from the procedural engine, and the expanded document stores the merged result. Sowing is idempotent: a request that finds the instance named by §1.2 returns `existing: true`.

**A-2. The read-only view API** (P5 N-6). Layer 2 exposes `Layer2View` of S3 §1.2 as its read API for layer 3 and tools, with: `instances()`, `instance(id)`, `sownBy(decision)`, `global()`, `exposedNode(node, atLeast)` and `playTotal()`. The `InstanceView` fields are read-only projections of `InstanceState` (§12.1) and the record (§10.1). `displays` is one entry per delivery with its highest grade and the `playTotal` at which it reached it, kept in the compacted receipts after a seed ends. Each element of a `closure` entry's `looseEnds` carries a stable `n`, a `kind` (`fact`, `cast`, `promise`, `unreadTurn`, `change`) and, for `cast` and `unreadTurn`, the node's `Id`.

**A-3. Withdrawal by the source** (P5 N-7). `story.withdraw@1 { seed, reason, decision }` is a **source withdrawal** for T1 (§6.2). It is accepted only for an instance with `source.by = 'director'`. A seed that was released closes as §6.4 says, so its closing trace is queued if the template has `closing`. The record entry is `transition` with `cause` the decision. A request for an unknown or terminal seed is ignored with a `source-withdraw-ignored` entry.

**A-4. Hooks, named and typed** (P5 N-5, narrowed; S2 §2.13, §3.4, §8.3). §8.8's exit table is replaced by S3 §1.4's table for the core: `fit`, `hold` (the "phase hook" of §8.3 step 4), `joint`, `onRelease`; with the score, form, channel, cause and band hooks absent in the core. Layer 2 enforces the bounds: it clamps each fit weight to ±`fitCap`, ignores a hold on a pull, class-0 or closing delivery, and treats a missing hook as "layer 3 absent".

**A-5. §0.3's row "the player-preference hooks" is split.** (*Clarification.*) The deferred row reads: "The hooks that use the player model: the score hook, the phase hook's deferral on evidence, and the form hook's use of engagement. They wait until option invariance has been shown." The **fit hook** (world weights), the **hold hook** (pacing only: it reads no model) and the **joint hook** (game state only) are in the core. The deferral in §8.8 is unchanged.

**A-6. Hook inputs** (S2-I-14 and §8.8's list). The delivery view passed to hooks gains: `timing.intensity` and `maxWait` (already in `timing`), `submitted`, and, for a first-release delivery, `window: { lead, urgency }`, where `urgency` is the release window's evaluated level (§2.7). The context gains `jointLatched`, layer 2's own latch. All are world, document or arbiter values, not session behaviour. The "closed list" statement is amended to include them.

**A-7. The fit hook does not depend on `noticing`** (*correction* to §3.4). "It is 0 with the director off, or with the player's `noticing` setting off" becomes "It is 0 with layer 3 absent." The fit hook reads the world only, so `noticing` has no bearing on it; keeping the clause would make the fit report differ by a setting that cannot change it. SF-37 is amended to: "`noticing: off`: score deltas 0 and no model-dependent exit; fit weights unchanged."

**A-8. The fit report gains `fit: FitReportFit`** (S3 §4.5). `connectingMaterial` stays empty in the core. The report runs with layer 3 present or absent; under "absent" every weight is 0 and the `aim` is omitted.

**A-9. An opaque `sowable` field on `Seed`.** `sowable?: unknown`, carried in the template, the expanded document and the semantic closure. Layer 2 ignores it except that a template with `sowable` is subject to S3's load checks S3-K-1 … K-6, which the pack loader runs. (S4 owns the field's final shape.)

**A-10. Joint hook semantics** (*clarification*, §8.3). The joint hook reports an **occurrence** each step; layer 2 owns the latch, clears it as §8.3 says, and passes `jointLatched` back to the hooks (A-6).

**A-11. Exclusions are not the model** (*clarification*, §8.8). The sower reads the player's explicit `exclusions` and `softExclusions` as a hard filter on what it sows. That is a read of a stated setting, not of the model. Neither list is used to rank anything.

**A-12. `InstanceState` and `GlobalState` gain nothing else.** In particular **no `fits` field** (P5 N-1 is not kept; S3 §4.1) and no `cue`, `grow`, `warm` or jump-cue fields (P5 N-3, N-4, N-8, N-9, later).

**S0 (one clarification, P5 K-2).** In [§10.5](kernel.md#105-changes-and-matching): a frame MAY carry many interests for one pattern; the `Relevance` emission carries the Change payload, not only its id; and a root actor's frames may be opened and closed as packs load and unload. Also in §10.8 and §11.3: the recipients of a `Dilemma` include the director (already stated in v4). K-1 of P5 (`fitting`, `timeBudget` in `SettingsSet`) is not needed by the core.

**Other specifications owe layer 3** (as P5 §10): S1 events for the sifter and a registry of `producers`, `isSpine` and `aesthetic` reads, and policies that ignore `meta:` kinds; S4 the pattern and sowable formats, the tempo settings, the closed vocabularies and the starter pack; S5 the `SenseFrame` of §5.1, the `jump` report and the quest-completion report; P6 the settings surface; P7 where the sower and sifter run, and the pool's cost; P9 and P10 the arms, measures and inspectors that read the decision log.

## 14. Compromises and open items

### 14.1 Compromises

Departures from the model, for the [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger):

| # | The model says | This specification does | Revisit when |
|---|---|---|---|
| C-S3-1 | The director is an actor whose drives are frames | Its drives are terms in its rules; in the core only phase adherence and care-free holds exist. Only pattern frames are kernel frames | A rule needs relevance matching through the director's drives |
| C-S3-2 | A partial story is a seed with its own interests | Partial matches are descriptors in a bounded, saved pool; one frame per pattern carries the interests | Pool measurements show seeds are cheap enough |
| C-S3-3 | Fitting is query, sample and contribution | Fitting weighs the options layer 2 already has. No search, no fills | Authors need bridges or fills (§0.3) |
| C-S3-4 | Every choice is explainable by kernel `trace` | Layer-3 choices are not kernel pins. The decision log holds them | A tool needs `explain` on a sowing decision |
| C-S3-5 | Fitted choices are recorded as fitted | No `fits` record: the draw records hold the weights (§4.1) | Fitting produces anything but weights |
| C-S3-6 | Reload leaves the world's future unchanged | Pacing restarts in `settling`, so release times differ. A match formed only in the lost session is lost | Players report reload-fishing, or measured divergence is above 10 per cent **[tunable]** |
| C-S3-7 | The lead thread and the victim of overflow follow kernel pull from V's frames | The core uses recency of `confirmed` exposure (§5.8), because "pull on a seed" is not a defined kernel read | S0 defines a pull read, or panels show overflow choosing badly |
| C-S3-8 | Simmering and retirement count sessions as well as play-hours (P5 §3.6) | Play-hours only. A session count is a load count, which the director never reads (S2-I-11; P5 §3.1) | Never: this is a correction of P5 |
| C-S3-9 | Urgency rises with time since the window opened and with V's distance from the closing place | Urgency is only what S2's `urgency` list says (§4.4) | A kit needs a ramp the list cannot say |
| C-S3-10 | An unfilled slot's push is owed | A slot is spent, empty or not | Starvation shows in the harness (P5 open question 12) |
| C-S3-11 | A thread joins on shared cast, frames, promises | Only `growsFrom`, shared anchor casts and a shared match (§5.7) | Threads merge or split wrongly in practice |
| C-S3-12 | Telling a match at any later stage is possible | A telling is usable only at exactly its `atStage` (§6.5), once | Authors want "any stage from n" |
| C-S3-13 | The phase hold relaxes at 70 per cent of `maxWait` for every delivery (P5 §3.4) | Only for authored deliveries (P5 §2.4's hook table says authored; §3.4 says "everything but the phase hold"). The phase hold never relaxes for sown ones, since expiry already bounds them | Sown content starves under holds (P5 open question 12) |

### 14.2 Open items

1. **Pool cost and save size.** What does a pool of 256 cost per Change in the native core? Does persisting it hold up? (P7.)
2. **How many patterns and kits** a city needs before the sower starves: a first library of a few dozen, and a measure of coverage.
3. **Who writes the tellings.** Patterns name them; is that too much for authors, and should a default be derived from a pattern's shape? (S4, P6.)
4. **Calibration.** Every **[tunable]**: the sense weights, the thresholds, the lead aims, the attended window, the budgets, the band cuts, the diversity terms. P9 moves them.
5. **The `producers` and `aesthetic` reads.** S1 and S4 must define them before the patterns and the aesthetic term have anything to read.
6. **The tip-off.** (P5 open question 8, later with dread.) Whether an ordinary `expose` event lets a hostile thread find V.
7. **The salt.** The harness salts layer 3's draws only. Whether the "fresh draws" arm must also freshen layer 2's draws is open (S2 deferred a reserved salt).
8. **Where the sower runs.** On the companion's slow loop or at the simulation window cadence (P7). The spec fixes the order of steps (§1.1) and the cost counting, not the thread.
9. **The starter pack.** Which patterns and kits ship, so that a world with few packs still has rumours and recaps (S4).
10. **Pulls.** When S5 reports that V asked, pulled seeds join the budgets as `answered` threads; the exact report is S5's.

## 15. Review record

*No reviews yet.*
