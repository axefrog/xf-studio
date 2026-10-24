# S3. Procedural engine specification

**Status:** v0.4, 24 October 2026. v0.4 says a pattern's kinds match by nominal compatibility (S0 v4.14 §2.2), so a resident counts as a person in a pattern without widening any query. v0.3, v0.3 adds a chronological buffer before the sifter, after GPT-6 Astra's review of S1 (E-07). v0.2: v0.2 answers GPT-6 Astra's review of v0.1. It narrows the core (no online player-model estimator, completed event patterns only, no loose-end growth, no automatic overflow withdrawal) and tightens identity, deadlines, reloads and saving.
- **Reviews.** Round 1, GPT-6 Astra, on v0.1: 18 findings and four cuts, all adopted (§15).
- **The core.** This version specifies the **core**: the layer-3 parts that the first implementation builds, narrowed to [S2's core](seeding.md#03-the-core-what-the-first-implementation-builds) (§0.2). Everything else in [P5](../p5-procedural-engine.md) is a **later capability** (§0.3). The first implementation rejects it plainly rather than half-doing it.
- **The additions to S2 and S0.** Layer 3 needed a few additions. S2 v1.1 and v1.2 and S0 v4.7 and v4.8 have taken them. §13 lists them.

This is the specification stage of [P5](../p5-procedural-engine.md) (work package [WP-13](../plan.md#82-work-packages)). It is exact enough to build layer 3 in the TypeScript reference model from this page, [S2](seeding.md) (v1.2) and the kernel specification [S0](kernel.md) (v4.8) alone.

Where this page and P5 differ, this page wins. P5 explains why; this page says exactly what. §14 lists the departures from P5, and the points where P5 disagrees with itself.

**Normative words, tunables and type notation** are as in [S0](kernel.md): MUST, SHOULD, MAY; **[tunable]** and **[calibrate]**; TypeScript notation with normative field names and free physical layout. Every **[tunable]** value lives in pack settings data (`Layer3Data`, §2.1), never in code.

## 0. Scope

### 0.1 What layer 3 does

Layer 3 is the narrative intelligence ([D-02](../decisions.md)). It has four parts:
- **The sifter** recognises story-shaped patterns in the simulated record and keeps a bounded pool of matches (§6).
- **The sower** chooses what to open, turns the choice into a seed through layer 2, and lets unseen seeds lapse (§7).
- **The fitter** weighs the choices that layer 2 draws, so that open parts of any seed fit the world. It serves authored and sown seeds by the same code, and keeps working with sowing off ([D-03](../decisions.md); §4).
- **The director** senses the moment, runs the pacing phases, keeps the thread view and budgets, answers the hooks layer 2 calls, and keeps the schedule that sowing follows (§5).

It does not own: the world and its processes (S0, S1); the seed language, casting, the lifecycle, the arbiter, the record and the exposure ledger (S2); pack format and settings screens (S4); the game port and the sense feed (S5); words (S7); the evaluation harness and the inspectors (P9, P10).

**Five rules run through everything below.**
1. **Two doors out.** Layer 3 changes the world only by sowing a seed, or withdrawing an unseen seed it sowed, through layer 2 (§1.3). It changes timing only through bounded hooks. The only nodes it mints itself are inert `meta:` events (§6.6).
2. **It selects; it never edits.** It chooses which recorded events to tell, when and in what form. It never changes a unit's strength, stakes, hostility or reward, and never rewrites a fragment's words.
3. **V is observed, never owned** ([D-09](../decisions.md)). In the core only the evidence of V's responses is logged, and it **reaches no hook, gate, draw or schedule** (§8, S3-I-4).
4. **Plain data, deterministic, explainable.** Every decision is a function of the record, the packs, the settings and keyed draws (§3). Each one logs why (§10).
5. **Sowing is optional; fitting is not.** With tempo `off`, the sifter and the sower stop. The fitter, the hooks, the thread view and the pacing state keep serving authored seeds ([D-03](../decisions.md)).

### 0.2 The core: what the first implementation builds

The core is the least that tests the idea: an authored seed fitted and paced with sowing off, then the same world with sowing on. It is built in the TypeScript reference model, beside layers 1 and 2.

| Area | In the core |
|---|---|
| Fitting (§4) | The **fit hook**: world-only weights on layer 2's draws (casting, variants, modes, alternates), from the seed's aesthetic intent, variety and yielding to live seeds. The **lead aim** for timing. Fit-report additions. **No `fits` record** (§4.1 says why) |
| Director (§5) | The sense feed; the pacing state `A`, `N`, `T`; the five phases with rest lengths; the **hold hook** (phase, headroom, climax rests, lead aim); the **joint hook**; the thread view and the opening budgets; the nested opportunity schedule for the `open` stream |
| Sifter (§6) | **Completed event patterns**: event clauses, `unless`, `within`, `once`; one telling and one kit per candidate; the bounded saved pool, whose entries keep their events alive; deadlines checked at every use; tombstones; features and gates; the inert `meta:story` event |
| Sower (§7) | The `open` stream; the source **match**; gates, banding, scores frozen once per slot, and the keyed draw; instantiation by a sowing request with an overlay; refusal and cooldown; idempotent sowing; one sow and its bookkeeping saved together; a **finite pending lifetime** with quiet withdrawal of seeds V never saw |
| Evidence (§8) | Canon offers and responses, with play timestamps, written to the decision log. **No estimator** |
| Persistence (§9) | One `SeedRecord` under its own id: the pool, tombstones, the schedule position, the arc lock, the pending list and the recent-sown ring |
| Determinism, log, audits (§3, §10, §11) | Keyed draws with exact keys; the decision log; static audits |

### 0.3 Later capabilities

The first implementation rejects these with a plain finding ("not supported yet"). Each returns only with a recorded contract that agrees with the reference model.

| Later capability | Why it waits |
|---|---|
| **The player model**: the online estimator and its shadow score; then feeding Score and Phase; the `director → v` beliefs; V's inferred frames | S2 §8.8 defers the preference hooks until option invariance has been shown. The core only logs the evidence (§8), to be judged offline first |
| **Sifter extras:** `dilemma`, `edge` and `frame` clauses; telling before completion; several tellings; intermediate promotion (`keep`); `meta:story-end` and composed patterns | A completed two-event match, one telling and one kit test sifting and sowing. Each extra needs lifetime and identity rules (D-11, D-14) |
| **Loose-end growth**: the `looseEnd` source, the `follow-up` form, `from` and `subject` on a kit, the ledger; loose ends of every kind | Growth can turn a rejected seed into a new invitation, so it needs lifetime and rejection rules first (D-07). The core tests match → seed → consequence |
| **Automatic overflow withdrawal** of engine-sown threads over a budget | Opening caps and the pending lifetime (§7.7) bound the first test, and risk no thread V cares about. Overflow needs a victim rule that can always withdraw, and a persisted rate cap (D-13) |
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
| **Strain, care-lengthened holds, the per-hour caps on class 2 actions** | The core has no class 2 action, and its only withdrawal (§7.7) touches seeds V never saw |
| **Tempo scaling of durations, lead times and thresholds; the soft sown-push rate** | The core scales the opening rate only. The arbiter's tempo effects (S2 §8.3 step 3) bound the rest |
| **Contest rules** (an authored seed waiting for a committed procedural seed; the uncontested-anchor check before sowing) | Need dry-run casting. The core yields softly (§4.3) and relies on S2's claim priority |
| **Selection extras:** the collision term, strata hints, the distinctiveness budget, the session tone curve, features F-2 and F-10 | Need history the core does not yet keep. The core ranks on four features and one diversity term (§7.4) |
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
| **Sifter** | On each relevance emission on a pattern frame, for that pattern only; at each simulation window boundary (the sweep) | Emissions, patterns, the kernel view | Pool entries; inert `meta:story` events |
| **Sower** | At a schedule slot (§5.9); at each refresh (pending lifetimes) | Pool, thread view, settings | `story.seed@1` and `story.withdraw@1` requests |
| **Fitter** | When layer 2 makes a draw (hook call); when the fit report runs | The seed document, a read-only kernel and layer-2 view | Raw weights; the lead aim |
| **Director** | Once per second of play (the tick); on hook calls; on seed events | The sense feed, the thread view | Hook outputs; holds; the evidence log |

**The tick order within one second of play:**
1. Layer 1 and layer 2 work for the second runs first (relevance dispatch, wake-ups, re-evaluation). The sifter handles its emissions in the kernel's delivery order as part of that, so every emission of the second is folded into the pool before step 2.
2. The director's tick (§5.2): pacing state, phase.
3. The thread view is refreshed (§5.7), then pending lifetimes are checked (§7.7) and the evidence is logged (§8).
4. The schedule's pending slot is resolved if it is due (§7.2).
5. The arbiter's release step runs and calls the hold and joint hooks.

All of layer 3 is single-threaded with the kernel in the reference model.

### 1.2 What layer 3 reads

Layer 3 reads the world and layer 2 only through two read-only views. Neither lets it write, and neither emits changes (S0 I-13).

```ts
interface KernelView {
  event(id: Id): EventView | undefined;     // undefined once the event is forgotten and cannot regenerate
  holds(p: Predicate, node: Id): 'yes' | 'no' | 'maybe';     // S0 §8.1
  isSpine(node: Id): boolean;               // registry read: the node is a canon character of the main story
  aesthetic(node: Id, feature: AestheticFeature): number | undefined;   // registry read, −1..1
  eventKind(name: string): { tags: string[]; producers: string[] } | undefined;   // the event-kind registry (S0 §10.5); producers are the layers that can produce the kind (S1, S5)
}
interface EventView {
  id: Id; kind: string;                     // the value of the `kind` slot of core:event (S0 §9.2)
  time: GameTime; place?: Id; creator: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  causes: Id[]; witnesses: Id[];
  outcome?: 'done' | 'failed' | 'prevented'; served?: Id;
}

interface Layer2View {                      // S2 §10.1a
  playTotal(): number;                      // the current cumulative play seconds in the branch, not the value last saved
  instances(): InstanceView[];              // every instance that has a record, in Id order
  instance(id: Id): InstanceView | undefined;
  sownBy(decision: Id): Id[];               // the instances whose source.decision is this
  global(): { offerCount: number; fragmentUses: Record<FragmentId, { count: number; lastAt: GameTime; lastOffer: number }> };
  exposedNode(node: Id, atLeast: ExposureGrade): boolean;     // the ledger names the node (note below)
  claimConflict(node: Id, span: 'seed' | 'beats'): boolean;   // another live seed holds the node in an overlapping claim that doesn't share
  settings(): Layer3Settings;               // §2.4
}
interface InstanceView {
  id: Id; template: { pack?: string; id: TemplateId; version: number };
  level: SeedLevel;
  source: { by: 'pack' | 'director' | 'plugin'; layer: Layer; decision?: Id };
  sowSeq: number;                           // immutable order of sowing in the branch
  state: SeedStateName;
  growsFrom?: GrowsFrom;
  roles: Record<RoleKey, { cast?: Id; committed: boolean; anchor: boolean }>;
  beats: Array<{ key: BeatKey; kind?: string; state: BeatState }>;
  displays: Array<{ delivery: Id; grade: ExposureGrade; playTotal: number }>;    // one per delivery, its highest grade
  responses: Array<{ kind: string; playTotal: number }>;                         // 'action:<id>', 'decline:<id>', 'null'
  draws: Record<string, { value: string; attempt: number; raw?: number; clamped?: number }>;
  closingPending: boolean;                  // a closing delivery has not yet been shown or expired
}
```

**`exposedNode`** is yes when any exposure-ledger entry ([S2 §10.2](seeding.md#102-the-exposure-ledger)) at `atLeast` or above has the node as a participant, a place, a cast node or a cited node. It is the one way layer 3 asks "has V met this?".

**Event kinds.** An event's kind is a value of the `kind` slot, not a schema `KindId`. Patterns and interests name kinds as registry names, and a selector tests the slot with a `where` predicate (S0 §10.5). The registry gives each kind its tags and its producers.

### 1.3 What layer 3 writes: the doors

| Door | Request | Notes |
|---|---|---|
| Sow | `story.seed@1` (§7.6) | Creator `director`; layer `procedural` (S2 §3.2). Idempotent |
| Withdraw | `story.withdraw@1` (§7.7) | Source withdrawal, T1, only for a seed V never saw. The closing trace plays if a delivery was shown just as it happened and the template has `closing` |
| Mint | The inert `meta:story` event (§6.6) | Creator `director`; causes the constituent events; no effects; no witnesses |
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

The release-step hooks (`hold`, `joint`, `onRelease`) receive only this ([S2 §8.8](seeding.md#88-the-player-models-boundary), S2-I-14):

```ts
interface HookCtx {
  playClock: number;                        // session play seconds
  playTotal: number;
  session: 'settling' | 'returning' | 'resituating' | 'normal';
  away: boolean;
  tempo: 'off' | 'calm' | 'steady' | 'restless';
  attention: AttentionAspect[];             // the active aspects
  jointLatched: boolean;                    // layer 2's latch (S2 §8.3)
  settings: Layer3Settings;
}
interface DeliveryView {                    // the delivery record, plus the window data layer 2 evaluates
  id: Id; seed: Id; authored: boolean; pull: boolean; atJoint: boolean;
  timing: TimingRequest;                    // class, importance, purpose, maxWait, intensity, category
  maxWaitPlay: number;                      // maxWait as play seconds (S2 §10.1a); arithmetic below uses this
  submitted: number;                        // play seconds
  features: Skeleton;                       // verb, stake, relationship, outcome, tone, channel
  window?: { lead?: 'early' | 'preferred' | 'late'; urgency: number };   // first-release deliveries only (S2 §8.8)
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
    arcNoNewThread: number;  // 1200 play seconds after a witnessed arc-or-larger outcome; kept as `openLockUntil` in the layer-3 record
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
    pendingLifetime: number; // 3600 play seconds: a sown seed V has not been shown is withdrawn after this (§7.7)
  };
  aim: {
    preferredUrgency: number;   // 0.35
    preferredWait: number;      // 300 play seconds, then the first latched joint
    lateUrgency: number;        // 0.7
    relaxAt: number;            // 0.7 of maxWaitPlay
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
    maxStages: number;       // 5: a short chain, at most four links
    defaultWithin: number;   // 518400 game seconds (6 game days)
    maxWithin: number;       // 2592000 (30 game days)
    candidateTtl: number;    // 259200 game seconds (3 game days) after completion
    tombstoneSpans: number;  // 2: a tombstone lasts two `within` periods
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
    featureWeights: Record<'F3' | 'F5' | 'F6' | 'F11', number>;   // all 1
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
}
```

### 2.2 Patterns

A **pattern** is pack data, versioned, read by a generic loader. It carries structure and tags only. Tellability weights live in code over matches (§7.4), never in a pack. In the core a pattern is a **completed event pattern**: an ordered run of event clauses, told once, when it is complete (§0.3).

```ts
interface SiftPattern {
  id: string; version: number;
  roles: Record<string, { kind: KindId; where?: Predicate[] }>;     // variable name (with its '?') → constraint
  stages: EventClause[];                                             // ordered; 1 to maxStages
  unless?: Array<{ between: [number, number]; clause: EventClause }>;   // stage indexes a < b
  within?: number;                                                   // game seconds from stage 0; default defaultWithin
  once?: string[];                                                   // variable names: a tombstone per binding set
  tags: string[];
  telling: Telling;                                                  // exactly one
}
interface EventClause {
  kind: string | { tag: string };                                    // an event kind of the registry, or one of its tags
  who?: Array<{ role: string; as: string }>;
  effects?: Array<{ on: string; effect: Effect | Effect[] }>;
  where?: Predicate[];
}
interface Telling {
  form: Form;                            // S2's forms; 'follow-up' is later (§0.3)
  kit?: TemplateId;                      // absent: any sowable template that serves `form` and has every role in `binds`
  binds: Record<RoleKey, string>;        // kit role ← a pattern variable, or '?story' or '?end'
}
```

A clause's `where` predicates are S0 §8.1 predicates evaluated on the **event node** of that stage. A role's `where` predicates are evaluated on the node once it is bound. A predicate that answers `maybe` counts as `no`. The reserved variable `?story` is the `meta:story` event of the match (§6.6). `?end` is the event of the last stage.

**Pattern load checks.** A pattern that fails any check is not loaded, with a finding naming the check. Other patterns load.

| # | Check |
|---|---|
| S3-L-1 | Every event kind in a clause is in the event-kind registry, and its `producers` are not empty |
| S3-L-2 | Every variable in a clause, `once` or `binds` is declared in `roles`, and a role's kind is compatible with every use. Every variable in `binds` is bound by some stage clause, so it is bound once the match is complete |
| S3-L-3 | `stages` has 1 to `maxStages` entries (5: the chain is short). Each `unless.between` is `[a, b]` with `0 ≤ a < b < stages.length` |
| S3-L-4 | `within`, if given, is positive and at most `maxWithin` |
| S3-L-5 | Stage 0 binds at least one variable of kind `core:person` or `core:group` (a human at the centre) |
| S3-L-6 | The telling's `kit`, if named, exists, is a sowable template that `serves` the telling's form. Each key of `binds` is a role of the kit whose kind accepts the variable's kind and whose template gives it no fixed identity (S2 §1.3 refuses an overlay that replaces one). `?story` binds only to a role of kind `core:event` that requires `kind = meta:story`; `?end` only to a role of kind `core:event` |
| S3-L-7 | A clause of another kind (`dilemma`, `edge`, `frame`, `belief`), an event clause naming a `meta:` kind, a `keep` field, or a form of `follow-up` is refused ("not supported yet") |
| S3-L-8 | Every variable in `once` is bound by stage 0, so a tombstone can be checked when a match starts |

### 2.3 Sowable templates

A seed template that layer 3 may sow carries a **sowable declaration**. S2 carries it opaque (§13) and S3 reads it.

```ts
interface Sowable {
  serves: Form[];                        // at least one
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
| S3-K-3 | A template that serves any form other than `rumour`, `recap` or `sighting` has `closing`, so that withdrawing it just as a delivery is shown always leaves a closing trace |
| S3-K-4 | `firstClass` equals the class of the first delivery that the template's start beats produce, by S2's registry |
| S3-K-5 | No role of the template has an `identity` that `isSpine` |

### 2.4 Settings read

Layer 3 reads these player settings (S4 owns the settings; S0 `SettingsSet` records the ones that change what is offered):

```ts
interface Layer3Settings {
  tempo: 'off' | 'calm' | 'steady' | 'restless';     // SettingsSet.tempo (S0 §14.2); layer 3 reads it for the schedule
  noticing: 'off' | 'acts' | 'full';                  // SettingsSet.noticing; 'full' behaves as 'acts'
  exclusions: Exclusion[];                            // SettingsSet.exclusions: explicit exclusions
  softExclusions: Exclusion[];                        // SettingsSet.content.softExclusions: added by a retract (S2 §7.4)
  modelFloor: GameTime;                               // SettingsSet.modelFloor, "start fresh"
  content: { ceiling: Record<ClassId, 0 | 1 | 2 | 3> };
}
```

```ts
interface Exclusion { kind: 'verb' | 'class' | 'tag' | 'npc'; value: string }   // a skeleton verb, a content class, a kit tag, an NPC node
```

**Exclusions are stated settings, not inference.** The sower reads `exclusions` and `softExclusions` as a hard filter (§7.3, gate 7). That is allowed under S2 §8.8 because the exclusion list is the player's own statement. It is never used to rank, and it is not the player model. S2 §5.2 step 4 applies the NPC exclusions to every role of a director-sown instance; gate 7 only saves a request that would fail.

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
| `rand("s3-kit", …)` | `cand.key: Id`, `kit: string` | Noise for choosing among kits |
| `H("tie", worldSeed, salt, …)` | the key name and arguments of the draw, then the option's key | Exact-tie break for the draw above (the lower hash wins, compared as S0 compares `Id`s) |

Identity hashes (no salt, no `rand`). An **occurrence** is one incident: the stage-0 event that began it. Its **occurrence id** is the `Id` of that event, which S0 v4.8 puts on every delivered envelope.

| Hash | Value |
|---|---|
| Binding key | `H("bind", worldSeed, pattern.id, v₁, id₁, v₂, id₂, …)` over the variables bound by **stage 0**, sorted by variable name (UTF-8 byte order). It finds an open match with the same bindings. It is **not** an identity |
| Match id | `H("match", worldSeed, pattern.id, bindingKey, occurrence)`: the binding key and the stage-0 occurrence id. Two incidents among the same people have different match ids, however far apart |
| Candidate key | `H("cand", worldSeed, "match", matchId, stage)`. In the core the stage is the pattern's last |
| Decision id | `H("sow3", worldSeed, cand.key)` |
| Withdraw decision | `H("wdraw3", worldSeed, seedId)` |
| `meta:story` event | `H("mint", director, matchId, "meta:story")` |
| Tombstone key | `H("tomb", worldSeed, pattern.id, v₁, id₁, …)` over the pattern's `once` variables, sorted by name. A tombstone is keyed by bindings, on purpose: `once` means once for these people |
| Pattern frame | `H("mint", director, director, "frame:" + pattern.id)` |
| Instance `localName` | the first 16 hexadecimal characters of `cand.key` |

### 3.3 The keyed choice

Layer 3 chooses among options with S0's draw arithmetic (§1.3, [§5.4](kernel.md#54-the-draw-flat-gumbel-max)). For options `F`, each with a `score(o)` and a noise key `keyArgs ∥ o.key`:

```
g(o)   = −ln(−ln(rand(keyName, worldSeed, salt, …keyArgs, o.key)))
choice = argmax over o ∈ F of (score(o) + g(o)); an exact tie goes to the lower H("tie", worldSeed, salt, keyName, …keyArgs, o.key)
```

The noise of an option depends only on its own key. **Scores are computed once and then frozen** (§7.4). Removing an option from `F` then changes the result only if it was the winner, because every remaining option keeps its score and its noise. §7 relies on this when a refused candidate or kit is dropped and the draw is run again. It does not hold if scores are recomputed after the removal.

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
- returns `0` for every option with layer 3 absent, and with `noticing: off` it is **unchanged** (fit weights are world-only, so `noticing` does not touch them; S2 §3.4 now says so).

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
- `r₁ = 1` if `o.id` (for a variant, mode or alternate) or `o.node` (for a cast) equals the value that the **immediately preceding instance of the same template** drew or cast for the same `choice.key`. "Preceding" is by `sowSeq`. Otherwise 0. The previous value is read from that instance's `draws` or, for a cast, its `roles[role].cast`;
- `r₂ = 1` if the option has a `fragment` that has been used and `layer2.global().offerCount − fragmentUses[fragment].lastOffer < fit.varietyOffers`. Otherwise 0.

**T_yield: yielding to live seeds.** Only for `kind: 'cast'` options with a `node`. `T_yield(o) = −1` if `layer2.claimConflict(node, span)` is yes: another live instance holds the node, tentatively or committed, in an overlapping claim that does not share ([S2 §9.1](seeding.md#91-detection), §10.1a), where `span` is the span of the role being cast. Otherwise 0. This is P5's "yield before contest", rule 1: prefer a candidate that no live seed holds. S2's claim priority ([§9.2](seeding.md#92-settling)) still decides a real conflict.

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

The aim relaxes at `aim.relaxAt` (0.7) of the delivery's `maxWaitPlay`, and the window's own hard close is S2's. An authored request keeps its hard deadline; the aim never moves it.

### 4.5 The fit report

The fit report ([S2 §11.2](seeding.md#112-the-fit-report)) is computed by the same hook and the same aim function. S2 adds one field (§13):

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
| locks | `noPushUntil`, `noHighUntil` (play clock seconds). The arc lock `openLockUntil` is not session state: it is in the layer-3 record, in `playTotal` seconds (§9.2) |

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
7. **Locks.** For each canon `seed-outcome` event minted since the last tick whose closure is `witnessed` ([S2 §6.4](seeding.md#64-closing-and-outcomes)): if the seed's level is `gig` or larger, set `noPushUntil = f.at + climaxNoPush` and `noHighUntil = f.at + climaxNoHigh`; if `arc` or larger, set `openLockUntil = max(openLockUntil, playNow + arcNoNewThread)` in the layer-3 record. A later value never shortens an earlier one.

**`onRelease(d)`** adds the declared intensity: `N = clamp(N + (d.timing.intensity ?? 0), −1, 1)`, at once. It does not wait for the next tick.

### 5.3 Phases and rest

At a **jump** (`f.jump` set, including a load, and the first frame of a session) the phase becomes `settling` with `settleStart = f.at`, whatever it was. This is checked before the table below. The pacing state's other quantities (`A`, `N`, `noPushUntil`, `noHighUntil`) are cleared at a load and kept across a sleep, wait or travel. `openLockUntil` is neither: it is saved.

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

**The phase machine only moves between phases. It does not create anything** (dossier 7, DIR-35). What it allows or holds is the hold hook's job (§5.4). The sower does not read the phase (§7.2).

### 5.4 The hold hook

`hold(ctx, queue)` returns the deliveries to hold this step. For each delivery `d` in the queue, in queue order, the first matching rule decides.

Let `waited = ctx.playClock − d.submitted`, `intensity = d.timing.intensity ?? 0`, `T` the current pacing `T`.

1. **Never held:** `d.pull`, a class-0 delivery, a delivery whose `timing.purpose` is `close`. (Rest never blocks pull; a closing message of a live thread is allowed in rest.)
2. **Authored relaxation:** `d.authored` and `waited ≥ aim.relaxAt × d.maxWaitPlay`: not held by anything below.
3. **Phase:**
   - `settling` or `rest`: held (`phase-settling`, `phase-rest`);
   - `peak` or `fade`: held (`phase-peak`, `phase-fade`) if `intensity > 0`;
   - `build`: held (`headroom`) if `intensity > 1 − T`.
4. **Climax rests:** held (`climax-rest`) if `ctx.playClock < noPushUntil`; or if `ctx.playClock < noHighUntil` and `intensity ≥ highIntensity`.
5. **Lead aim**, only if `d.timing.purpose` is `introduce` and `d.window` is present: apply §4.4's table with `waited`, `d.window.urgency` and `ctx.jointLatched`. Held as `lead-aim`. For a **sown** delivery the aim relaxes at `aim.relaxAt × maxWaitPlay`; for an authored one rule 2 has already done so.

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

There is no score hook and no form hook in the core. Layer 2 adds 0 to every score and uses `standard`. The evidence log (§8) is written beside the director and read by nothing in it.

### 5.7 The thread view

A **thread** is a view over layer 2's records ([S2 §2.13](seeding.md#213-scale-turns-threads-and-forms)). It is derived, never persisted. It is rebuilt from `Layer2View.instances()` at a refresh (once a second, and after any seed state change).

**Membership.** Take every instance that is live, or terminal with `closingPending`. Two instances are in the same thread when either of these holds:
- one names the other in `growsFrom` (`looseEnd.seed` or `parent`);
- they share a committed cast node in roles that are `anchor` in **both**.

A thread is a connected component under these links. Its `Id` is the lowest instance `Id` in it. A seed that has ended and has no closing delivery pending is in no thread.

**Fields**, from the instances (`now = playNow`):

| Field | Definition |
|---|---|
| `aware` | Some `displays` entry has grade `presented` or `confirmed` |
| `lastPresented` | The greatest `playTotal` among those entries; `−∞` if none |
| `engineSown` | Every instance's `source.by` is `director` |
| `live` | Some instance has a beat in state `running` |
| `climactic` | Some instance has a beat of kind `conclusion` in state `available` or `running` |

**Status:**

| Status | Rule |
|---|---|
| `attended` | `aware` and `now − lastPresented ≤ attendedWindow` |
| `simmering` | `aware`, not attended, and `now − lastPresented ≤ simmerWindow` |
| `dormant` | `aware`, and older than that |
| `unseen` | not `aware` |

Statuses are measured with `playTotal`, so they survive a load. None reads session length, time since load, a quit or a return.

### 5.8 Budgets

**Counts.** Over the threads:
- `A = #attended + #(unseen and engineSown)`;
- `L = #(aware and live) + #(unseen and engineSown)`;
- `C = #climactic`;
- `S = #simmering`.

An unseen engine-sown thread is a sown seed whose first delivery V has not been shown. It counts in both `A` and `L`, so the sower does not open a third seed while two wait. A thread with only a closing delivery pending counts in `A` or `S` by recency, and never in `L` or `C`.

**Budgets** are `maxAttended 4`, `maxLive 2`, `maxClimactic 1`, `maxSimmering 8` **[tunable]**. Authored, fitted and answered threads all count.

**Who the budgets bind.** Only the engine's own openings: the slot check of §7.2 and gate 8 of §7.3. Authored seeds are never refused or withdrawn for a budget. The engine's threads yield to them. **Nothing is withdrawn for exceeding a budget.** Automatic overflow withdrawal is a later capability (§0.3). In the core, opening caps and the finite pending lifetime (§7.7) keep the load bounded: an unseen seed that cannot proceed leaves within `pendingLifetime`, and a seen one is never withdrawn.

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

**Consequences.** A change of tempo takes effect at the next slot's time, never mid-beat. A reload shows the same schedule: the clock is `playTotal`. The first hour is gentler (§7.2 and §7.3, gate 6).

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
own.reactsTo: one selector per distinct event clause of the pattern and of its `unless` entries,
              the narrowest the kernel can express: a `where` predicate on the `kind` slot of core:event
              (S0 §10.5): the event kind, or the kinds that carry the tag
```

The frame's weight 1 and no parents give pull 1. A kind-level `reactsTo` match has `r = 1 × 0.6 × 0.5 = 0.3`, a bucket-level one `0.18`. Both clear `θ_react = 0.08` ([S0 §16.2](kernel.md#162-calibration-fixtures)). One frame per pattern keeps patterns from masking each other: the kernel emits at most one relevance event per (change, frame, interest type), so two patterns that share a first clause would collapse into one emission on a shared frame.

**What an emission carries.** The Change payload, the **occurrence id** and the occurrence's **game time** (S0 v4.8). The sifter tests the Change itself against the clauses of its pattern.

**Dispatch.** An emission is handled by **the pattern that owns its frame, and by no other**. A Change that matches the frames of two patterns gives two emissions, one for each. The cost is one stage-0 test plus one test per open entry of that pattern. No clause in the core is a dilemma, so the director has no dilemma interest. When dilemma clauses return (§0.3), a `Dilemma` will be fanned out once, in pattern order, to the patterns that have one.

**Pack changes.** On a pack activation or removal, the sifter opens the frames of newly loaded patterns and closes (`abandoned`) those of removed ones. Entries of a removed pattern, or of an older `version` of a loaded one, are dropped with a log entry (§9.3).

**What the sifter ignores.** A `contribution` Change. An event whose `creator` is `director` or whose kind starts `meta:` (S1's policies ignore them too; a pattern may not name them in the core, S3-L-7).

**The chronological buffer** (v0.3). Producers publish late: S1's simulated events appear only when their window's batch is applied, while mirrored events appear at once. So the sifter doesn't take emissions as they arrive. It holds them in a buffer and releases them **in order of occurrence time** (then occurrence id) once the **horizon** has passed: every producer has published up to that time. The horizon is the current boundary, less the longest publication lag among the loaded producers. S1 declares the lag per process (§9.4); in M3 it is one window, because S1 runs one window at a time. The buffer is bounded by the lag, and is persisted with the pool (§9.2), so a reload neither loses nor reorders it. A mixed mirror-and-simulation two-stage fixture (SF3-38) checks that a pattern whose stages arrive out of order still matches in chronological order.

### 6.2 The pool

The pool holds open and completed matches as **copied descriptors**: ids, times, bindings and event ids. It holds no live node references. It also **keeps the events alive**: the constituent events of every entry are retention roots of the layer-3 record (§9.2), so a non-canon event cannot be forgotten while a saved entry needs it.

```ts
interface PoolEntry {
  id: Id;                                   // the match id (§3.2): one per occurrence
  bindingKey: Id;                           // §3.2: finds an open match with the same bindings
  seq: number;                              // creation order, from nextSeq
  pattern: string; version: number;
  bindings: Record<string, Id>;             // variable → node
  stages: Array<{ event: Id; time: GameTime }>;   // one per stage matched; the event id is the occurrence id. `e.stage` is `stages.length − 1`
  firstTime: GameTime; lastTime: GameTime;
  complete: boolean;
  story?: Id;                               // the meta:story event, minted at completion (§6.6)
  seed?: Id;                                // the instance sown from it, once sown
  refusals: number; cooldownUntil: number;  // playTotal
}
```

| Bound | Value |
|---|---|
| Entries per pattern | `poolPerPattern` (32) |
| Entries overall | `poolTotal` (256) |
| Retained events | At most `poolTotal × (maxStages + 1)` ids in `nodes`; P7 measures what retention marks from them (§14.2) |
| Duplicates | One entry per match id. One **open** (incomplete) entry per binding key |
| Tombstones | One per `once` binding set, kept as §6.4 says |

**When a bound is hit,** a new match is not started if there is no room that can be freed. To free a slot the sifter evicts, in the same pattern (for the per-pattern bound) or overall (for the total), the **incomplete** entry with the earliest `firstTime`, then the lower `seq`. If there is none, the new match is refused. Either way the event logs `pool-full`. An evicted entry writes no tombstone, and its events are released.

### 6.3 Handling an emission

`onChange(emission)` runs once per emission, for the pattern that owns its frame. `now` is the emission's game time. The cost is counted in the kernel's tick budget: one unit for the stage-0 test and one per open entry advanced ([S0 §10.7](kernel.md#107-work-hard-limits-and-worklists)).

1. **Entries first.** For each **open** entry `e` of this pattern, in `seq` order (a snapshot taken before this change, so an entry started by this change is not in it):
   1. **Deadline.** If `now > e.firstTime + within`, the entry has expired: it ends as §6.4 says, and nothing else is tried for it.
   2. **Duplicate.** If the emission's occurrence id is already the event of one of `e.stages`, skip the entry. A redelivered Change can never advance a match.
   3. **Unless.** For each `unless` entry `u` with `u.between = [a, b]` and `a ≤ e.stage < b`: if `matchClause(u.clause, emission, e.bindings)` succeeds, the entry **dies**: it ends as §6.4 says, with `match-killed`. Nothing else is tried for it.
   4. **Advance.** Otherwise let `j = e.stage + 1`. If `matchClause(stages[j], emission, e.bindings)` succeeds with bindings `b'` and `time` is not earlier than `e.lastTime`: set `e.bindings = e.bindings ∪ b'`, append the stage, `e.stage = j`, `e.lastTime = time`. If `j` is the last stage, the entry **completes** (§6.6). Log `match-advanced` or `match-complete`.
2. **Start.** Then try `matchClause(stages[0], emission, {})`. If it succeeds with bindings `b0`:
   1. Compute the binding key and the match id (§3.2). If an entry with that match id exists, stop: it is the same occurrence.
   2. If an **open** entry with that binding key exists, stop: a match for these bindings is already forming.
   3. If the pattern has `once` variables and a tombstone with their tombstone key is in force (§6.4), stop.
   4. Apply the bound rules of §6.2.
   5. Create the entry at stage 0, with `seq = nextSeq++`. If the pattern has one stage it completes at once.

A change can advance entries and start a new one. **A Change advances an entry by at most one stage**, and one occurrence never serves two stages of an entry: the duplicate check (1.2) and the snapshot make that structural. The sifter does **not fork**: a later change that also fits an advanced stage is ignored for that entry. A completed entry never blocks a later incident among the same people, which has a new occurrence and so a new match id.

**`matchClause(clause, emission, bindings) → bindings' | null`** is deterministic. It never mutates `bindings`.

1. The Change is an event, and the clause's `kind` equals the event's kind, or, for `{ tag }`, the registry's tags for the kind contain the tag.
2. For each `who` item in order: take the first participant, in participant order, whose `role` equals `item.role` and who satisfies the variable. If `item.as` is already bound, the participant's `who` must equal it. Otherwise it binds if its kind accepts the role's `kind` and the role's `where` predicates are all `yes`.
3. For each `effects` item in order: find an event effect whose `effect` is in the item (a single value or a list) and whose `on` equals the bound variable `item.on`. If `item.on` is unbound, take the first such effect in order, and bind it by the same test as in 2.
4. Every `where` predicate is `yes` on the event node.

### 6.4 Deadlines, expiry and tombstones

**Deadlines are checked where they are used, before anything else.** A deadline has passed when `now > deadline`. At equality it has not.

| Deadline | Value | Checked |
|---|---|---|
| An open entry | `firstTime + within` | Before advancement (§6.3), and by the sweep |
| A completed entry | `lastTime + candidateTtl` | Before candidates are collected (§7.3, gate 1), and by the sweep |
| A tombstone | `until` | Before a match starts (§6.3, 2.3). A tombstone is **in force** while `now ≤ until` |

**The sweep** runs at each simulation window boundary ([S0 §9.4](kernel.md#94-evolution)), in `seq` order, **including at tempo `off`**. It only reclaims storage: it removes entries past their deadline (`match-expired`) and completed entries that have been sown, and prunes tombstones past `until`. No decision depends on it having run.

**A tombstone is written on every path that ends an entry of a pattern with `once`:**

| Path | `until` |
|---|---|
| Completion | `lastTime + tombstoneSpans × within` |
| Killed by `unless` | the killing event's time `+ tombstoneSpans × within` |
| An open entry expires | `firstTime + (1 + tombstoneSpans) × within` |
| Dropped for refusals (§7.6) | the game time of the drop `+ tombstoneSpans × within` |

A completed entry that expires unsown, or is removed once sown, already has its tombstone. An entry that is evicted, or dropped because its pattern changed, writes none. A pattern without `once` writes no tombstone.

**Tempo `off`.** The frames are closed, so no match starts or advances. The sweep still runs, so entries expire by their deadlines as usual. Matches that would have formed while `off` are lost.

### 6.5 Features and gates for a match

A completed pool entry is a **candidate**. The sower collects them (§7.2). The gates and features are defined here because they read the pool. Let `bound` be the entry's bound variables whose value is a person, group or place.

**Gates** (a fail removes the candidate for this slot and logs which gate):

| Gate | Test |
|---|---|
| F-1 reportable change | Some stage's event has at least one effect |
| F-4 a human at the centre | Some bound variable has kind `core:person` or `core:group` (guaranteed by S3-L-5), and the kernel still has it |
| F-12 a showable cause | For forms other than `rumour` and `sighting`: the last stage's event has non-empty `causes` |

The short chain (F-8) is a load check now (S3-L-3). The telling is single, so the form-dependent gate F-12 is evaluated once, on the candidate, before any kit is considered.

**Features** (kept raw in the log):

| # | Feature | Value |
|---|---|---|
| F-3 | stakes | The number of distinct `(on, effect)` pairs over the entry's stages with `effect ∈ sower.harmful` |
| F-5 | personal link | `#{ v ∈ bound : layer2.exposedNode(v, 'presented') }`, plus 2 if V is a participant of any stage's event |
| F-6 | irreversibility | the number of distinct `(on, effect)` pairs with `effect ∈ sower.irreversible` |
| F-11 | timeliness | `H / (H + max(0, now − e.lastTime))` with `H = timelyH` |

### 6.6 Completion and hand-over

**Completion.** When the last stage matches, the sifter:
1. mints the inert **`meta:story`** event (id in §3.2): creator `director`; `time` the entry's `lastTime`; participants the bound variables (`role` the variable name without `?`); `causes` the events of every stage; no effects; no witnesses;
2. sets `e.complete` and `e.story`;
3. writes the tombstone, if the pattern has `once` (§6.4).

There is no separate promotion step. The entry kept its events alive from the day it started (§6.2); completion adds the story event, which is kept alive the same way. Because retention marks every `Id` field of a root (S0 §7.3), a root on `meta:story` also keeps its causes. `meta:story-end`, `keep` and intermediate promotion are later capabilities (§0.3).

**What the hand-over carries to the seed.** The kit's roles bound by the telling's `binds`, as fixed identities in the overlay (§7.6). `?story` is the `meta:story` event and `?end` is the event of the last stage. Fragments read the story through ordinary role predicates; `trace` walks from the seed to every constituent event. A stake line and a lead line belong to staging, not to selection, and are not carried.

A seed sown from a match is a normal instance. When it casts `?story` or `?end`, its cast edge keeps the event alive (S2 §5.3), so the pool entry can be removed once the seed exists (§6.4, §7.6).

## 7. The sower

Sowing turns what the world already holds into seeds, at a rate the player sets. Its rule is **selection over generation**: the world is simulated, the record is sifted, and the sower chooses what to tell. It invents no content. Its vocabulary is the packs' sowable templates and patterns. The engine ships a small starter pack (S4, open question 11 of P5) so that a world with few packs still has rumours and recaps to tell.

### 7.1 The source in the core

The only source is a **match**: a completed pool entry (§6) and its one telling. It becomes a seed of a kit, with the entry's roles fixed. Other sources (loose ends, promotion subjects, fronts, ambient texture, pulls) are later (§0.3).

```ts
interface Candidate {
  key: Id;                                // §3.2
  entry: Id; pattern: string;             // the completed pool entry
  stage: number;                          // the last stage
  features: Record<'F3' | 'F5' | 'F6' | 'F11', number>;
  place?: Id;                             // the first bound place, in variable order
}
```

There is **one candidate per completed match**: per (match occurrence, stage), and the stage is always the last. Its alternatives are kits (§7.5).

### 7.2 The slot procedure

The schedule (§5.9) has one pending slot, `k = slots.open.next`. Each second, after the director's tick, the sower runs the procedure below. **It reads only branch-persisted state** (the record, the pool, settings, the thread counts, `playNow`) and **never the pacing phase or the play clock**. A slot is resolved once, at its time, and is never retried. So a load changes when a seed is *shown* (the hold hook, §5.4) and not which seed is sown.

```
while (k + 1) · I ≤ playNow:                   // the window ended unresolved: only when the pointer was behind
    log slot-lapsed(k); k += 1
if playNow < time(k): return                    // not yet
resolve slot k:
    if not live(k, tempo):                          log slot-passed
    else if time(k) < schedule.gentleFirst:         log slot-gentle           // first ten minutes
    else if playTotal < openLockUntil:              log slot-locked           // the arc lock (§5.2)
    else if counts violate the budgets (§5.8: A ≥ maxAttended or L ≥ maxLive or S ≥ maxSimmering): log slot-budget
    else run the slot (below)
k += 1                                           // with the sowing step's commit when it sowed (§7.6)
```

`tempo` is the setting in force when the slot is resolved.

**Run the slot.**
1. Collect the candidates and apply the gates (§7.3). If none remain: log `slot-empty(k)`; done.
2. Compute features, bands and scores **once** (§7.4). The scores are frozen for this slot.
3. Choose one candidate (§7.4). Try it (§7.5, §7.6).
4. If every kit tried was refused: the candidate gets the refusal (§7.6) and is removed from this slot's set. **The scores of the rest do not change.** Choose again among them. At most `maxCandidateTries` candidates are tried per slot.
5. On success: record it in `recent` (§9.2), log `sow`, done. A slot sows **at most one seed**.

A slot that finds nothing is spent: there are no owed pushes in the core.

### 7.3 Gates

**Gates come before scores.** A candidate that fails a gate is not ranked. The sower records which gate failed. `now` is the current game time. Gates 6 to 8 are tested per kit: a candidate whose kits all fail them fails gate 2, and the first gate that failed is logged.

| # | Gate | Why |
|---|---|---|
| 1 | **Alive.** The entry is complete, `now − lastTime ≤ candidateTtl` (§6.4), and every event of its stages is retrievable | A deadline is checked here, before ranking. The sweep is not relied on |
| 2 | The candidate has at least one eligible kit (§7.5) | Nothing to sow otherwise. Content ceilings and floors are layer 2's, applied by the sowing request itself (§7.6) |
| 3 | F-1 and F-12 (§6.5) | Causality |
| 4 | F-4 (§6.5) | A human at the centre |
| 5 | **V-link.** The V-link holds if V is a participant of a stage's event, or some variable in `bound` is `exposedNode(·, 'presented')`. Without it, the telling is eligible only if its form is `rumour`, `recap` or `sighting` | A chain about people V has never met stays world texture |
| 6 | **Stake, level and a gentle start.** The kit's `stakeScale` is at most `block`, its level at most `maxLevel`, and `firstClass` passes the first-hour rule: not `≥ 1` before `playTotal ≥ gentleFirst`, not `> 1` before `gentleHour` | Bounded dooms; a gentle start |
| 7 | **Exclusions.** No `exclusions` or `softExclusions` entry matches the kit's tags, its skeleton `verb`, a content class its envelope names, or any node the telling binds | A stated setting overrides everything |
| 8 | **Climax budget.** If the kit is `climactic`, `C < maxClimactic`. (The attended, live and simmering counts are checked once per slot, in §7.2.) | Pacing |
| 9 | **Spine.** The telling is ineligible if its `binds` would put a node with `isSpine` into a kit role | No process rewrites the main story's characters |
| 10 | **Not already sown.** `layer2.sownBy(decision)` is empty for `decision = H("sow3", worldSeed, cand.key)`, and `cand.cooldownUntil ≤ playTotal` | Idempotence; no re-offer after a decline |

Gates 7 and 9 look only at the nodes the telling binds. For roles that layer 2 fills by casting, S2 §5.2 step 4 removes spine characters and excluded NPCs from the candidates of **every** role of a director-sown instance, and ladders cannot relax it. The gates here only save a request that would fail.

A "betrayal" or "turn" seed counts against S1's betrayal budget when S1 defines one; that is S1's check, made at casting.

### 7.4 Ranking and the draw

At a live slot the sower ranks the candidates that passed, then draws. **All scores are computed once, here, and frozen for the slot.**

**1. Features to bands.** For each feature `F ∈ {F3, F5, F6, F11}`: if every candidate has the same value, the feature is **skipped**. Otherwise rank the candidates by value, descending, ties by `key` ascending: rank `r` = 0 for the best, `n−1` for the worst. The band is `band = 2 − floor(3·r / n)`, in {0, 1, 2}. The raw values stay in the log.

```
composite(c) = ( Σ_F w_F · band_F(c) ) / ( 2 · Σ_F w_F )          over the features not skipped; 0.5 if none
```

with `w_F = sower.featureWeights[F]`. The composite lies in [0, 1].

**2. Diversity.** `dup(c)` is the number of entries in `recent` whose `pattern` equals `c.pattern` plus the number whose `place` equals `c.place`.

```
score(c) = sower.lambda · composite(c) − sower.diversity · dup(c)
```

**3. The draw.** By §3.3, `keyName = "s3-pick"`, `keyArgs = ["open", k]`, `o.key = c.key`. The band composite only tilts the draw, so the top candidate does not win every time. No fitted formula decides an offer.

**4. After a refusal,** a refused candidate is removed and the draw is run again over the rest **with the same scores**. Bands are not recomputed. So a removed loser never changes the winner.

**5. Authored first.** If an authored seed and a sown one want the same node, S2's claim priority decides ([S2 §9.2](seeding.md#92-settling)) and the authored seed wins (S2-I-10). The sower never sows to contest.

### 7.5 Kit

The telling is single, so a candidate has one form. Its alternatives are the kits.

**Eligible kits** are:
- the telling's `kit`, if named; otherwise
- every sowable template whose `serves` includes the form and whose roles include every key of `binds`;
- filtered by the template's sowable load checks and by gates 6, 7 and 8.

**The bounded order.** Choose by §3.3 with `keyName = "s3-kit"`, `keyArgs = [cand.key]`, `o.key` the template id, and

```
score(kit) = ln(kit.weight ?? 1) − sower.kitDiversity · [kit ∈ the last recentKits kits sown]
```

Scores are frozen with the kit set. If the request for that kit is refused (§7.6), remove the kit and choose again. Try at most `maxKitTries` **distinct** kits, in the order the draws give. If the last attempt is refused, or no eligible kit is left, the candidate gets **one** refusal (§7.6). A candidate is therefore refused once per slot attempt, however many kits were tried.

### 7.6 Instantiation and the sowing request

1. **Choose the kit** (§7.5).
2. **Build the overlay.** Fix what the match already bound:

```ts
interface SeedOverlay {
  roles: Record<RoleKey, { identity: Id }>;     // each is a fixed identity (S2 §2.2)
}
```

   For each `binds` entry: `roles[kitRole] = { identity: bindings[variable] }`, with `?story` the entry's `meta:story` event and `?end` the event of its last stage. **The overlay can change nothing else:** no durations, `must` terms, persistence flags, timing, `growsFrom` or `stakeScale`. S2's defaults for persistence ([§2.5](seeding.md#25-facts-world-requirements-effects-and-dependencies)) and timing ([§2.12](seeding.md#212-timing-requests): `onExpire: 'unattended'` for procedural seeds) already do what P5 wanted. S2 refuses an overlay that replaces a fixed identity or a profile's fixed part with a different node (S2 §1.3).
3. **Fill the open parts.** Nothing is done here in the core. The seed's open parts are filled by layer 2's casting and draws, which call the fit hook (§4), and which apply the source filters of S2 §5.2 step 4. A sown seed is fitted exactly as an authored one is.
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

Layer 2 applies the overlay ([S2 §1.3](seeding.md#13-sowing-authored-templates)), **lints** the result at the template's maturity, and mints the instance or refuses it ([§3.1](seeding.md#31-the-steps)). The instance `Id` follows [S2 §1.2](seeding.md#12-instances): creator `director`, cause `decision`, name `"seed:" + template + ":" + localName`. **Sowing is idempotent:** the same request finds the same instance (`existing: true`).

**One sow, one commit.** The sowing step is one bounded operation. It runs inside a staged batch ([S0 §14.2a](kernel.md#142a-staged-batches-v46)), so that the instance and the layer-3 bookkeeping become visible and saved together:
1. open the batch;
2. send the request;
3. on `ok`: set `e.seed`; add `{ instance, sownAt: playTotal }` to `pending`; push `{ pattern, kit, place, at: playTotal }` onto `recent`, keeping the last `recentSown`; set `slots.open.next = k + 1`; then **commit** the batch;
4. on refusal: **discard** the batch, so nothing remains but this step's own log. When no kit is left (§7.5), the candidate gets its one refusal: `refusals += 1`, `cooldownUntil = playTotal + cooldown`.

At `maxRefusals` the entry is dropped for good, with a tombstone (§6.4). A save is never taken inside the step (§9.4). If S2 cannot run its side inside a batch, the repair of §9.3 gives the same guarantee afterwards.

Once the seed exists the entry has done its job, and the sweep removes it (§6.4). A decline stays a decline: the decision id names the occurrence, and `sownBy(decision)` stays non-empty (gate 10).

### 7.7 Pending lifetime and withdrawal

A director-sown instance is **pending** from its sowing until V is shown something of it. It may wait long, or for ever: sowing can succeed where casting later cannot fill a role, and a ladder with `wait: window` waits until the seed closes (S2 §5.4). So a pending seed has a **finite lifetime**, in cumulative play seconds.

At each refresh (§1.1), for each entry of `pending`, in order:
1. If the instance is gone, terminal, or has any `displays` entry: remove it from `pending`. It is no longer pending.
2. Otherwise, if `playNow − sownAt > pendingLifetime` (3600 play seconds **[tunable]**): withdraw it with `story.withdraw@1`, remove it from `pending`, and log `withdraw` with the reason `pending`.

```ts
interface WithdrawRequest {                      // story.withdraw@1
  seed: Id; reason: 'pending'; decision: Id;     // H("wdraw3", worldSeed, seedId)
}
```

Layer 2 treats it as a **source withdrawal**: T1, `withdrawn` ([S2 §1.3](seeding.md#13-sowing-authored-templates), [§6.2](seeding.md#62-transitions)). V never saw the seed, so it leaves no residue; a delivery shown just as it happens still gets its closing trace, which S3-K-3 guarantees. Only a seed with `source.by = 'director'` can be withdrawn this way. The core has **no other withdrawal**, so a seed V has seen is never withdrawn. The check runs at every tempo, `off` included.

### 7.8 What the dial does

| Part | `off` | `calm`, `steady`, `restless` |
|---|---|---|
| Sifter | Frames closed: no match starts or advances. The sweep runs | Runs |
| Sower | Stops. Slots are never live | Runs at the rate of §5.9 |
| Pending lifetime | Runs (it only withdraws seeds the engine sowed and V never saw) | Runs |
| Fitter, hooks, thread view, pacing state | Run | Run |
| Evidence log | Runs if `noticing` allows | Runs if `noticing` allows |

**The dial scales how much the engine sows. It never changes how a decline is handled.** For authored and already-sown seeds every rule on this page holds at every setting, `off` included.

## 8. Evidence for a later player model

**What the core does.** It estimates nothing about V. It writes down the evidence that a later estimator would fold, so that panels and offline tools can judge it first (the estimator is later, §0.3). V is observed, never owned ([D-09](../decisions.md)). No `director → v` belief is written. Nothing in layer 3 reads the log (S3-I-4).

**The evidence.** At each refresh (§1.1) the director compares each instance's `displays` and `responses` with what it has already logged this session, and writes one `evidence` entry (§10) for each new one:
- an **offer displayed**: the delivery, the offer's skeleton `features` (verb, stake, relationship, outcome, tone), its channel, class and purpose, and the `playTotal` at which it reached its grade;
- a **response**: its kind (`action:<id>`, `decline:<id>` or `null`), the delivery it answers, and its `playTotal`.

These are the canon offer and response events with the play timestamps that S2's record keeps. Nothing is inferred. The core logs **no** lapse, retraction or abandonment: S2 keeps lapses and retractions as record entries without events, and "accepted then abandoned" cannot be told from these inputs. A later estimator may read the record itself.

**What is left out.**
- With `noticing: off`: nothing is logged.
- Nothing before `settings.modelFloor` ([S2 §8.5](seeding.md#85-display-and-exposure)); nothing in a content class marked sensitive; nothing in a facet that `settings.exclusions` names. `full` behaves as `acts`.
- T0 to T3 signals beyond V's responses to displayed offers are never read.

**Privacy.** Local only, per session, and left out of exports and reports by default. Nothing needs saving: a tool can rebuild the entries from S2's saved records.

## 9. Persistence

### 9.1 What is state, and where it lives

| State | Persisted? | Rebuilt by |
|---|---|---|
| Pacing state (`A`, `N`, phase, episode, release locks) | No (session) | Restarts in `settling` at a load |
| The schedule position `slots.open.next`, and the arc lock | Yes, in the layer-3 record | Without them: `floor(playTotal / I)` and no lock |
| Thread view and statuses | No (derived) | Layer 2's records, stamped with `playTotal` |
| The pool, tombstones, the pending list, the recent-sown ring | Yes | A cache: a save without them loads with an empty pool |
| The evidence log | No | S2's records |
| Settings | Yes (S0 `SettingsSet`) | Replay |
| Draws made through the fit hook | Yes, in layer 2's draw records | |
| Why a seed was sown | Yes, in the instance's `source.decision` | |
| The decision log and the rivals ring | No (local, per session) | |

### 9.2 The layer-3 record

One `SeedRecord` under `layer3Id` ([S0 §14.1](kernel.md#141-what-is-persisted), V4-7), written as a `SeedState` op when it changed since the parent save, like S2's global record.

```ts
// SeedRecord.state for the layer-3 record
interface Layer3State {
  schema: 1;
  slots: { open: { next: number } };
  nextSeq: number;
  openLockUntil: number;                              // playTotal: the arc lock (§5.2); 0 if none
  pool: PoolEntry[];                                  // §6.2; in creation (seq) order; capped
  tombstones: Array<{ pattern: string; key: Id; until: GameTime }>;   // key: the tombstone key of §3.2
  pending: Array<{ instance: Id; sownAt: number }>;   // §7.7; playTotal at sowing
  recent: Array<{ pattern: string; kit: TemplateId; place?: Id; at: number }>;                         // last recentSown
}
```

| `SeedRecord` field | Value |
|---|---|
| `id` | `layer3Id` |
| `state` | `Layer3State` |
| `nodes` | The union of every pool entry's stage events and `story` events: the retention roots. An entry's events stay until the entry ends |
| `actor` | Omitted. Layer 3's record is not a demand root. Its pattern frames are the director's, a demand root already |

**Bounds.** The pool holds at most `poolTotal` entries, so `nodes` holds at most `poolTotal × (maxStages + 1)` ids. `pending` is bounded by `maxLive` and `recent` by `recentSown`; tombstones are pruned at `until`. P7 measures the save size and the **closure that retention marks** from `nodes` (participants, places, causes) before any cap is fixed.

### 9.3 Loading

After the kernel replays a save and layer 2 rebuilds ([S2 §12.2](seeding.md#122-loading)), layer 3:
1. Reads the layer-3 record. **If it is absent, layer 3 starts empty** (the pool is a cache). Nothing else is lost; no error is shown.
2. Reconciles with the loaded patterns: drops pool entries and tombstones of patterns no longer loaded, and entries whose `version` differs from the loaded one. Each drop logs `match-dropped`.
3. Opens the pattern frames (§6.1) for the loaded patterns.
4. Checks the pool against the clock and the events: an entry whose deadline has passed is expired as §6.4 says; an entry with an event that is not retrievable ends with `match-lost`. (Retention should make the second impossible. It covers a damaged record.)
5. **Repairs a split sow.** For each completed entry with no `seed` for which `sownBy(decision)` is not empty, set `e.seed` to that instance and add it to `pending` with `sownAt = playTotal`, logging `sow-repaired`. Drop a `pending` entry whose instance does not exist. The repair makes a half-recorded sow whole; it never sows.
6. Rebuilds the thread view from layer 2's records.
7. Starts the pacing state in `settling`. The schedule resumes from `slots.open.next`. **Settling is a delivery gate:** it holds shows (§5.4) and nothing else. Due slots are resolved from the state above (§7.2), exactly as in uninterrupted play.

**What is the same after a load:** the schedule, the pool and its candidates, the sowing decisions, the instances and their offer `Id`s, the pending lifetimes and the arc lock. **What may differ:** when the next push is shown, because pacing restarts in `settling` and the arbiter's timers restart. One divergence remains: a match still forming from events that only the lost session saw. The window is the time since the last save (compromise C-S3-6).

**Branches.** Layer 3 is branch-local. Loading a save and playing on is a **fork**: it inherits the selected save's **whole** layer-3 state (pool, tombstones, pending list, recent ring, schedule pointer, arc lock) and then evolves independently. Its earlier matches, refusals and cooldowns still happened, so none is cleared. Only a **new lineage** (a new world seed), or recovery from a missing record (step 1), starts empty. "Never read across branches" means never reading a sibling's later state; inherited history is the fork's own.

### 9.4 When a save is taken

The host serves a save request at a **tick boundary**: after step 5 of §1.1, when the sifter has handled every emission delivered in the tick and no sowing step is open. Two things follow.
- **No sift emission is pending in a save.** Each emission is folded into the pool within its tick, and the pool is in the record. Nothing needs persisting or replaying (kernel replay is silent, S0 I-13).
- **A sow is whole or absent.** The instance and its bookkeeping are in one committed batch (§7.6). Loading repairs a record that holds only the instance (§9.3, step 5).

## 10. The decision log

Every director action and every sowing, hold, fit, withdrawal and match event writes one entry to the **session ledger**: local, per session, never part of the save.

```ts
interface LogEntry {
  seq: number;
  kind: 'slot' | 'sow' | 'withdraw' | 'hold' | 'phase' | 'fit' | 'match' | 'budget' | 'evidence';
  at: { game: GameTime; playTotal: number; playClock: number };
  purpose: 'schedule' | 'rest' | 'protect-peak' | 'lead-aim' | 'headroom' | 'pending' | 'match' | 'fit' | 'evidence';
  class: 0 | 1 | 3;                          // the manipulativity class; class 4 does not exist
  rule: string;                              // the gate, hold rule, band or budget that fired
  inputs: Record<string, unknown>;           // only from the closed lists
  chain: Id[];                               // the explanation chain: record facts that justify it
  data: Record<string, unknown>;
}
```

| `kind` | Written when | `data` holds |
|---|---|---|
| `slot` | A slot is passed, lapsed, gentle, locked, budget-blocked, empty or run | `k`, `time(k)`, `u(k)`, the tempo, the reason |
| `sow` | A candidate is sown or refused | The pattern id and version, the bindings, the raw features, the bands, the composite, the scores with noise, the **rivals** (every candidate ranked, in a ring of the last 8 slots, not saved), the telling, the kit and its scores, the request and its result |
| `withdraw` | A pending seed is withdrawn | The seed, its `sownAt` and its age |
| `hold` | A (delivery, reason) pair first appears, and when it clears | The delivery, the reason, `T`, the phase |
| `phase` | A transition | The previous phase, the new one, `A`, `N`, `T`, `engaged`, `R` |
| `fit` | A fit hook call with a non-zero raw weight | The choice, each option's three terms, raw and clamped |
| `match` | A start, advance, completion, kill, expiry, loss, drop, `pool-full`, `sow-repaired` | The pattern, the stage, the bindings, the minted `meta:story` id |
| `budget` | A refresh finds a count over a budget | The four counts |
| `evidence` | A new display or response is seen (§8) | The delivery, its skeleton, channel, class and purpose, or the response kind, and the `playTotal` |

**Manipulativity classes.** Sowing a seed whose first delivery is class 0 is a `trace`, class 0. Sowing one whose first delivery is class 1 or above is an `offer`, class 1. A hold, a withdrawal and a rest are class 3. **Class 4, changing anything V has observed or could base a choice on, does not exist.** Any action that would change a unit's strength is a logged defect.

**Rendering.** Turning a log entry into one plain sentence is a later capability (P6). In the core the entry is the explanation.

## 11. Invariants

| # | Invariant |
|---|---|
| S3-I-1 | **Determinism.** The same inputs (§3.1) give identical sowing decisions, instance `Id`s, holds, joint reports, pool contents and layer-3 records |
| S3-I-2 | **Two doors.** Layer 3 changes the world only through `story.seed@1` and `story.withdraw@1`, and mints only inert `meta:` events. It writes no pin, belief, contribution or edge |
| S3-I-3 | **Bounded hooks.** `fit` is clamped by layer 2 to ±`fitCap`; `hold` only removes, and never holds a pull, class-0 or closing delivery; `joint` only reports; `onRelease` only adds to `N` |
| S3-I-4 | **The evidence has no exit.** The evidence log of §8 is read by nothing in layer 3. A static audit finds no read of it in any hook, gate, feature, draw, schedule or budget |
| S3-I-5 | **Closed inputs.** Hooks read only §1.5's list, the fit hook only §4.2's, the director only the sense feed. Perturbing session length, idle time, quit, save and load counts, time of day and the wall clock changes no hook output and no record, byte for byte |
| S3-I-6 | **Authored first.** The budgets, the schedule and the phase hold never refuse, withdraw or (past 70 per cent of `maxWaitPlay`) hold an authored seed. The engine's threads yield |
| S3-I-7 | **Nested schedule.** `time(k)` and `u(k)` depend only on `worldSeed`, `salt`, the stream and `k`. A slot live at a tempo is live at every higher tempo. Changing the tempo never changes `time(k)` or `u(k)` |
| S3-I-8 | **Idempotent sowing.** One candidate key gives one decision id and, for one template, one instance `Id`. Sowing twice finds the existing instance. A reload before a save re-sows the same seed |
| S3-I-9 | **Bounded state.** The pool, the pending list and the recent ring never exceed their caps. The pool holds only copied descriptors; `nodes` holds only the events of pool entries |
| S3-I-10 | **A cache, not a source.** A save without the layer-3 record loads without error. A save with it gives the same schedule, candidates and sowing decisions after a load |
| S3-I-11 | **Fitting is independent of sowing.** The fit hook and the lead aim give the same output with tempo `off` and with any other tempo, and with sowing on or off, from the same state |
| S3-I-12 | **Selection never edits.** No layer-3 action changes a unit's strength, stakes, hostility or reward, removes an event that happened, or rewrites a fragment. The overlay holds only role identities |
| S3-I-13 | **Session independence.** No draw key, `Id`, ordering, tie-break or sowing decision reads the session epoch, the pacing phase, the play clock, a load count or the wall clock ([S0 I-16](kernel.md#15-invariants)). The play clock drives only the pacing tick and the holds. Slots are resolved from branch-persisted state |
| S3-I-14 | **Inert meta events.** A `meta:` event has no effects and no witnesses, and the director is its creator. S1's policies ignore it |
| S3-I-15 | **Explained.** Every sowing, hold, withdrawal and phase transition writes a log entry with its rule and a chain to a recorded fact |
| S3-I-16 | **No spine, no doom.** A sown seed binds no spine node and casts none (S2 §5.2 step 4), has stake scale at most `block`, and level at most `gig` |
| S3-I-17 | **A decline stays a decline.** A candidate whose seed V declined, retracted or let lapse is never sown again: the decision id names the occurrence and `sownBy` stays non-empty. The dial never changes how a decline is handled |
| S3-I-18 | **Occurrences are distinct.** A match id names one occurrence: two incidents among the same people differ in match id, candidate key, decision id and `meta:story` id, however far apart. A redelivered Change never advances a match, and a Change advances an entry by at most one stage |
| S3-I-19 | **Deadlines first.** No entry advances, is ranked or starts a match past its deadline, whether or not a sweep has run. Sweeps reclaim storage only. Equality is not past |
| S3-I-20 | **One sow, one commit.** A sowing step's instance and bookkeeping are saved together or not at all. Saves are taken at tick boundaries, so none holds a pending sift emission |
| S3-I-21 | **Pending is finite.** Every director-sown instance leaves `pending` within `pendingLifetime` play seconds: shown, ended, or quietly withdrawn. A seed V has seen is never withdrawn |
| S3-I-22 | **Saved evidence is kept.** Every event of every saved pool entry is in `nodes` until the entry ends |

## 12. Fixtures

Every fixture uses `worldSeed = H("fixture", <id>)`, the fixture pack `xf.fixture`, the kernel's core schema plus S0 §20, S2's core, and `Layer3Data` at its defaults. As in S0, outcomes that depend on hashes are checked as properties, not numbers.

### 12.1 Unit fixtures

| # | Setup | Expected |
|---|---|---|
| SF3-1 | **Nested schedule.** For `k = 0 … 999`, compute `time(k)` and `u(k)`; evaluate `live(k, τ)` for each tempo | `time(k)` lies in `[k·I, (k+1)·I)`. `live(·, off)` is never true. The sets nest: calm ⊆ steady ⊆ restless, and restless is all 1000. The counts are within 5 standard deviations of 312.5 and 625 |
| SF3-2 | **Slot resolution.** Tempo `restless`, `playTotal` 0, three windows, once with the phase `rest` or `settling` throughout. Then load a save whose pointer is two windows behind | Each slot is resolved once, at `time(k)`, whatever the phase: `slot-gentle` before 600, `slot-passed` when thinned, `slot-locked` inside the arc lock. None is retried. The stale pointer logs `slot-lapsed` twice, then resumes |
| SF3-3 | **Pacing arithmetic.** Start in `build`, `A = N = 0`. Frames: ticks 0 to 99 quiet. Tick 100: health falls from 1.0 to 0.5, `downed` becomes true, `hostileAware` and `hostileAwareNear` become true. Ticks 101 to 129: engaged, nothing else. From tick 130: quiet, not engaged | `A(100) ≈ 0.9`; held at ≈ 0.9 through 129; `A(130) = 0.9 × decayA ≈ 0.8794`. Phase: `peak` at 100; `fade` at 140 (`A ≈ 0.6980`); `rest` at 170 (`A ≈ 0.3490`); `build` at 215. At 215, `A ≈ 0.1234`. Exactly one transition per tick |
| SF3-4 | **Rest length.** The SF3-3 episode lengths 10, 60 and 200 seconds | `R` = 45, 90 and 180 |
| SF3-5 | **Hold table.** In `rest`: a sown class-2 offer; a class-0 trace; a `pull` call; a `close` message; an authored class-2 offer having waited 0.7·`maxWaitPlay`; a sown class-2 offer having waited 0.7·`maxWaitPlay` | Held: the first (`phase-rest`) and the last (the phase hold does not relax for a sown delivery). Not held: the others |
| SF3-6 | **Peak, fade, headroom.** In `peak`: a delivery with intensity 0.2, and one with −0.2. In `build` with `T = 0.65`: intensity 0.4 and 0.2 | The 0.2 delivery is held (`phase-peak`); the −0.2 one is not. In build: 0.4 is held (`headroom`, 0.4 > 0.35); 0.2 is not |
| SF3-7 | **Climax rests.** A witnessed gig-level `seed-outcome` at play clock 1000, then a witnessed arc-level one | Until 1300 every delivery above class 0 except pull and close is held (`climax-rest`); until 2200 any with intensity ≥ 0.5. The arc outcome sets `openLockUntil = playTotal + 1200`: a slot inside it logs `slot-locked`, and the lock survives a save and load |
| SF3-8 | **Lead aim.** A first-release `introduce` delivery with `lead` of each value; urgency 0, then 0.4, then 0.8; joint latched or not; waited 0, 299, 300 | `early`: never held. `preferred`: held until urgency ≥ 0.35, or waited ≥ 300 with a latched joint. `late`: held until urgency ≥ 0.7. All relax at 0.7·`maxWaitPlay` |
| SF3-9 | **Joint.** Frames: V walks 150 m and stops for 3 s; a sleep jump ends; a `seed-outcome` with `witnessed`; a pull is queued; two at once | `arrived`, `woke`, `finished`, `asked` reported once each, at the second they happen. For two at once, the earlier in the list is reported. No report while engaged, driving or speaking |
| SF3-10 | **Thread view.** A (authored, presented 10 minutes ago), B (authored, presented 3 hours ago, `growsFrom` E), C (sown, presented 10 hours ago), D (sown, never shown), E (sown, terminal, closing pending, presented 1 hour ago), F (sown, terminal, nothing pending); A and C share an anchor cast node | A and C: one thread, attended. B and E: one thread, simmering. D is `unseen` and counts toward `A` and `L`. F is in no thread. E adds nothing to `L` or `C`. Statuses survive a save and load |
| SF3-11 | **Budgets gate.** `A = 4`; then `L = 2` from two unseen engine-sown seeds; then `S = 8`; then `C = 1` with a `climactic` kit | `slot-budget` for the first three; only climactic kits are ineligible (gate 8) for the fourth. An authored seed is sown in all four. Nothing is withdrawn |
| SF3-12 | **Pending lifetime.** A sown seed whose role cannot be filled (`wait: window`), so nothing is ever released; two of them; one shown at `sownAt + 100`; a save and load at `+3000`; tempo `off` | At `+3600` still pending (equality is not past). At `+3601` withdrawn by `story.withdraw@1` (`pending`), and V sees nothing. With two pending, `L = 2` and the sower logs `slot-budget` until one clears. The shown seed leaves `pending` and is never withdrawn. The load does not reset the clock. At `off` the withdrawal still happens |
| SF3-13 | **Pattern load.** Eight patterns, each failing one of S3-L-1 … L-8 (for L-7: one with a `dilemma` clause), and a good twin | Each bad pattern is refused with its check named; the twin loads; the others are unaffected |
| SF3-14 | **Sowable load.** Five templates, each failing one of S3-K-1 … K-5 (K-3: serves `offer` with no `closing`), and a good twin | Each bad one is not sowable by layer 3 (the pack may still sow it). The twin is |
| SF3-15 | **Matching.** *Order against kin* as events: roles `?m`, `?x`; stages `event order-given (actor ?m, target ?x; kill on ?x)` then `event act (actor ?m; on ?x in [harm, kill, protect, rescue, expose])`; `unless` between 0 and 1: `order-withdrawn` (target ?m); `once [?m, ?x]`. Run 1: `order-given`, then `act` with `protect` on X. Run 2: an `order-withdrawn` between. Run 3: an `order-given` with no `kill` | Run 1: stage 0, then complete; `meta:story` minted once with both events as causes; tombstone written. Run 2: killed; tombstone. Run 3: nothing starts |
| SF3-16 | **Incidents and duplicates.** `once [?a, ?b]`. Incident 1 (`I1a`, `I1b`) among (A, B) completes. Then: (a) `I1a` again; (b) a new `I2a` before the tombstone's `until`; (c) after `until`, `I2a` and `I2b`; (d) after `until`, `I1a` again. Repeat (a) and (c) without `once` | (a) a duplicate, ignored. (b) refused by the tombstone. (c) a new entry with a different match id, candidate key, decision id and `meta:story` id, sown on its own. (d) an entry with incident 1's match id forms; gate 10 refuses it, and the `meta:story` id is the one already minted. Without `once`, two completed entries for the same people coexist with distinct ids |
| SF3-17 | **Dispatch.** P1 and P2 both begin with `insult`; P3 has two successive `insult` stages. One `insult` event matches all three frames; then it is delivered again; then a second `insult` | Each pattern handles only the emission on its own frame. P1 and P2 each start an entry; P3 starts one at stage 0 and does not advance on the same event. The redelivery changes nothing. The second `insult` completes P3's entry. Work is one stage-0 test per pattern plus one per open entry of that pattern |
| SF3-18 | **Deadlines.** An open entry with `within` 600: an advancing event at `firstTime + 600`, and another's at `+601`, with no sweep between. A completed entry at `lastTime + candidateTtl` and `+1`. A tombstone at `until` and `+1`. Tempo `off` through a deadline, then on, before any sweep | Equality is not past: the first advances. The second is expired by the check (`match-expired`) and writes its tombstone. The completed entry is a candidate at equality and removed by gate 1 at `+1`. The tombstone is in force at `until`, not at `+1`. The overdue entry after `off` neither advances nor is ranked. The sweep run or skipped gives the same decisions |
| SF3-19 | **Pool bounds.** 33 distinct stage-0 matches of one pattern; then 257 across patterns, all incomplete | The 33rd evicts the oldest incomplete entry (`pool-full` logged), without a tombstone. Never more than 32 per pattern or 256 total. A pool of only complete entries refuses a new match |
| SF3-20 | **Own sowing ignored.** A `contribution` Change from a sown seed; a `meta:story` event; a pattern that tries to name `meta:story` | No pattern advances on the contribution or the event. The pattern naming `meta:story` is refused at load (S3-L-7) |
| SF3-21 | **Retained evidence.** An open entry with two non-canon stage events. Save, load in a fresh process, complete it. Let a second entry expire | After the load both events are retrievable and the entry completes as in the uninterrupted run. `nodes` equals the union of the pool's stage and story events. The expired entry's events are released at the next forgetting sweep. The log reports the retained closure |
| SF3-22 | **Gates.** Candidates failing, in turn, each of gates 1 to 10 (gate 1 by a completed entry past `candidateTtl` with no sweep run) | Each is removed with its gate logged. A passing candidate is ranked |
| SF3-23 | **V-link texture.** Two candidates over people V never met, from patterns whose tellings are `rumour` and `offer` | Only the `rumour` candidate passes gate 5. After V meets one of the people (`presented`), the `offer` candidate passes too |
| SF3-24 | **Banding and frozen scores.** Four candidates with distinct feature values. Draw; remove a non-winner and draw; remove the winner and draw. In a later slot raise one candidate's F-3 | Bands follow §7.4, computed once. With scores fixed, removing a non-winner never changes the winner, and removing the winner gives the runner-up by the same noise. Nothing is asserted across the later slot, whose bands are recomputed. A feature equal for all is skipped |
| SF3-25 | **Kits and refusals.** A candidate with three eligible kits: layer 2 refuses two and accepts the third. A candidate whose three kits are all refused. A named kit that is refused. Three refused slots for one entry | Distinct kits in the draw order, at most 3; success on the third gives no refusal. All refused gives **one** refusal (`refusals` + 1, cooldown 600), and the candidate leaves the slot's set without rescoring the rest; at most 3 candidates per slot. A named kit gets one try. The third refusal drops the entry with a tombstone |
| SF3-26 | **Idempotent sowing.** Sow a candidate; save; load; run the slot again | `existing: true`, the same instance `Id`, no second instance. `pending` holds the instance once |
| SF3-27 | **Reload at a slot boundary.** A ready candidate. (a) Save at `time(k) − 1`, load, run on. (b) A slot two seconds before its window ends: save one second before it, load, run on. (c) Save just after the sow, load. (d) Load into `settling` as a slot falls due | (a), (b): the same seed, instance `Id`, `pending` entry and pool as uninterrupted play; no slot lapses. (c): no second seed. (d): the slot is resolved at its time; only the show is held (`phase-settling`) |
| SF3-28 | **Save boundary.** A refused sow, then a successful one. Save and load at every tick boundary of SF3-15, 21 and 26. A hand-made save with the instance but not the bookkeeping. A save in the tick in which a stage event arrived | Refusal leaves no instance and no `seed`; only `refusals` changes. Success leaves instance, `seed`, `pending`, `recent` and the pointer together. The hand-made save loads repaired (`sow-repaired`), with no second instance. The stage event is already in the saved pool: no emission is pending or replayed |
| SF3-29 | **Forks and lineages.** Save S1 at play 1050 (an open entry, a tombstone, a pending seed, a cooldown); play on, save S2; load S1 and play on; start a new lineage | The fork has S1's pool, tombstones, pending list, recent ring, pointer, lock and cooldown, and none of S2's. Replaying the stage-1 event completes the entry. The new lineage starts empty |
| SF3-30 | **Tempo at run time.** Restless for a stretch, then `off`, then `steady` | While `off`: no new matches, no slots live, frames closed, the sweep running. Authored seeds still sown, fitted, held and released. Pending seeds still time out. On return: frames reopen and the schedule continues unchanged |
| SF3-31 | **The fit hook.** A cast with 4 candidates: one held by a live seed (through `claimConflict`), one cast last time by this template's previous instance (by `sowSeq`), one whose aesthetic readings match the intent exactly (`T_aes = 1`), one plain | Terms follow §4.3. Raw weights: the held one −0.3, the repeat −0.2, the match +0.3, the plain 0. Layer 2 clamps each to ±0.405 (ln 1.5). The draw records raw and clamped |
| SF3-32 | **Fitting independent of sowing.** The SF3-31 cast and the fit report under every tempo, and with layer 3 absent | Identical terms and `fit` field at every tempo; with layer 3 absent every raw weight is 0 |
| SF3-33 | **Hook perturbation.** Run SF3-37 and SF3-3 twice; perturb session length, idle time, quit and save counts, time of day, the wall clock | Byte-identical hook outputs and records |
| SF3-34 | **The evidence is inert.** Run SF3-37 with the evidence log off and on | Byte-identical decisions, holds, joint reports, pool and records; only `evidence` log entries differ. They hold offers and responses with `playTotal`, none for a lapse or retraction, and none with `noticing: off` |
| SF3-35 | **No layer-3 record.** Load a save made without the layer-3 record | Loads without error. Empty pool; schedule resumes from `floor(playTotal / I)`; a new match can start. No finding is shown to the player |
| SF3-38 | **Chronological buffer.** A two-stage pattern: stage 0 a simulated event at window 0, published at its batch; stage 1 a mirrored event at window 1, published at once | The emissions are released in occurrence order, and the match completes. With the buffer off, it would miss |

### 12.2 End-to-end fixtures

**The world.** The fixture pack `xf.fixture` holds:
- the authored seed `xf.fixture:r1`, the scenario R1 of [S2 Appendix A.3](seeding.md#a3-reference-scenario-r1), with `lead: 'early'` on its window and a first request of kind `message`, class 2, `maxWait` 1800, `intensity` 0.2;
- the pattern `xf.fixture:grudge`: roles `?a`, `?b` (persons); stages `event insult (who actor ?a, target ?b)` then `event assault (who actor ?a, target ?b; effects harm on ?b)`; `unless` between 0 and 1 an `apology` event by `?a`; `within` 600 game seconds; `once [?a, ?b]`; the telling `{ form recap, binds { subject ?a, other ?b } }`. The script mints each `assault` with the matching `insult` among its `causes`, so F-12 passes;
- the sowable template `xf.fixture:rumour-kit` (a glance; serves `rumour` and `recap`; `firstClass` 0; roles `subject` and `other`, with no fixed identity).

People Mara (`?a`) and Dex (`?b`) exist. V has met Mara: `exposedNode(Mara, 'presented')` is yes. The sense feed and the injected events are scripted, with the play clock starting after the load's settling. One game second passes per play second. No attention aspect is active (the fixture's firefight is only a sense-feed script, so S2's attention gate does not interfere).

**SF3-36. End to end, sowing off.** Tempo `off`. R1's facts are set at play clock 105, so its first request is submitted then. The sense feed is SF3-3's.

| Play clock | What happens | Expected |
|---|---|---|
| 100 | The firefight begins (SF3-3 frames) | Phase `peak` |
| 105 | R1's request is submitted; the arbiter's steps run each second | The hook holds it: `phase-peak` (intensity 0.2 > 0) |
| 140 | `fade` | Held: `phase-fade` |
| 170 | `rest`, `R = 45` | Held: `phase-rest` |
| 215 | `build` (the tick precedes the arbiter's step) | Not held: headroom 1 − 0.1234 ≥ 0.2. Released at 215 |
| after | V answers; R1 runs as in S2 Appendix A.3 | The same states and offer `Id` as the layer-3-absent run |

**Compared with a run with layer 3 absent** (same world, same frames): R1 is released at 105; the draws, the cast, the offer `Id`, the outcome and the closure record are identical; the only differences are the release time, the `fit` fields in the draw records (raw and clamped, all within ±0.405) and the log. In particular no `story.seed@1` is ever sent, no match starts, and the schedule never goes live.

**SF3-37. End to end, sowing on.** The same world and frames. Tempo `steady`. Additional script (play clock): at 1000 an `insult` event (Mara, Dex); at 1100 an `assault` event with effect `harm` on Dex; at 2200 another `insult`; at 2400 an `insult`, and at 2500 an `assault`, between the same two; at 2600 the first `insult` is delivered again; then the world runs on.

| Step | Expected |
|---|---|
| Play 1000 | An open entry for `(Mara, Dex)` at stage 0. `nodes` holds the insult. No tombstone yet |
| Play 1100 | The entry completes. `meta:story` is minted once, with the specified `Id` and both events as causes. The tombstone is written, `until` = 1100 + 2 × 600. One candidate |
| The first slot `k₁` that is live at steady and has `time(k₁) ≥ 1100` | It is resolved at `time(k₁)`, **whatever the phase**. The candidate passes gates 1 to 10 (V-link: Mara is met). It is the only candidate. One `story.seed@1` for `xf.fixture:rumour-kit` with overlay `subject = Mara`, `other = Dex`, `decision = H("sow3", worldSeed, cand.key)`; the instance `Id` follows S2 §1.2; the instance and its `pending` entry are committed together; the log has one `sow` entry with the raw features and the rivals (none) |
| Class 0 | The rumour glance is class 0: not held by any phase, not counted toward spacing or the cap. R1's release time and records are exactly those of SF3-36 |
| The glance is shown | It leaves `pending`. It closes. The next live slots log `slot-empty` |
| Play 2200 | Refused by the tombstone (still in force at 2300) |
| Play 2400 to 2500 | A new entry with a new match id completes. The next live slot sows a second glance: a different candidate key, decision id, `meta:story` id and instance `Id` |
| Play 2600 | The redelivered first `insult` makes an entry with incident 1's match id. At the next live slot gate 10 refuses it: no third seed |
| Property | Replay the whole run with a different `salt`: the same candidate set, a possibly different draw order, but the sowing remains idempotent and deterministic for that salt |
| Reload | Save at play 1050 (between the stages), load, replay the script: the entry and its insult event are intact across the load and every later step is identical to the uninterrupted run |
| Property | R1's draws, cast, offer `Id`, outcome and closure record are byte-identical to SF3-36's; the fit report for R1 is identical with sowing on and off |

### 12.3 Property tests

With the layer-3 implementation, the reference model also checks, over generated scripts and logged named streams, shrinking failures ([dossier 23](../craft/d23-evaluation-testing.md)):
- **S3-I-1 to S3-I-22** as properties, including random saves at tick boundaries and loads between any two ticks;
- **Schedule and pool:** nesting over random tempo walks; pool bounds under random Change streams and pack unloads;
- **Coupled draws, with scores fixed:** removing a non-winning candidate or kit never changes the winner. Nothing is asserted when features are perturbed and bands recomputed;
- **Occurrences and deadlines:** over random incident streams with redeliveries and tombstone expiries, match ids are distinct per occurrence, no occurrence advances an entry twice and no decision is sown twice; decisions are the same with the sweep run at random times, rarely, or never;
- **Perturbation:** random perturbation of every input not on the closed lists changes nothing;
- **Authored first** over random casting orders (with S2-I-10); **fit independence** under every tempo and with layer 3 absent;
- **Phase machine:** at most one transition per tick, rest lengths in bounds, `T` in [−1, 1];
- **Pending is finite** over random sowing and display times; **the evidence log is inert**.

## 13. What S2 and S0 have taken

Layer 3 needed additions to S2 and S0. They are now in S2 v1.1 and v1.2 and S0 v4.7 and v4.8. This page relies on them and does not propose them.

- **S2 v1.1** (A-1 to A-12 of v0.1): the sowing request with an overlay (§1.3); the read API (§10.1a); source withdrawal (§1.3); the hooks, their inputs and the joint latch (§2.13, §3.4, §8.3, §8.8; here §1.4 and §1.5); the fit hook independent of `noticing`, and the fit report's `fit` field (§3.4, §11.2; here §4.2 and §4.5); the opaque `sowable` field (§2.1; here §2.3); no `fits` field (§4.1).
- **S2 v1.2:**
  - *D-04.* §5.2 step 4: a director-sown instance excludes spine characters and excluded NPCs from the candidates of every role, at casting, re-casting and preparation, and ladders cannot relax it. Gates 7 and 9 only pre-check the bound nodes (§7.3).
  - *D-05.* §1.3 item 4: the overlay is compared with the document before it, and may not replace a fixed identity or a profile's fixed part. A refusal is a kit refusal (§7.5). S3-L-6 checks the static case.
  - *D-15.* §10.1a and §12.1: `sowSeq`, `claimConflict`, `playTotal()` as the current value, `maxWaitPlay`, `source.decision`, and the loose-end vocabulary (needed again when loose-end growth returns).
- **S0 v4.7 and v4.8:** pattern frames (V4-31; §6.1); the event-kind registry and kinds matched through the `kind` slot (V4-32; §1.2, §6.1); occurrence id and game time on delivered emissions (V4-33; §3.2, §6.3); `tempo` in `SettingsSet`, and soft exclusions in `SettingsSet.content.softExclusions` (V4-34; §2.4); staged batches, from v4.6 (§14.2a; §7.6).

**Still owed.**
- **The host** serves a save at a tick boundary, after the sifter has handled the tick's emissions and with no sowing step open (§9.4).
- **S2** keeps `sownBy(decision)` answering for every instance of the branch, compacted ones included (gate 10), and settles the exact form of `claimConflict` (§14.2).

**Other specifications owe layer 3** (as P5 §10): S1 events for the sifter, entries in the event-kind registry with their `producers`, the `isSpine` and `aesthetic` reads, and policies that ignore `meta:` kinds; S4 the pattern and sowable formats, the tempo settings, the closed vocabularies and the starter pack; S5 the `SenseFrame` of §5.1, the `jump` report and the quest-completion report; P6 the settings surface; P7 where the sower and sifter run, and the pool's cost; P9 and P10 the arms, measures and inspectors that read the decision log.

## 14. Compromises and open items

### 14.1 Compromises

Departures from the model, for the [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger):

| # | The model says | This specification does | Revisit when |
|---|---|---|---|
| C-S3-1 | The director is an actor whose drives are frames | Its drives are terms in its rules; in the core only phase adherence and care-free holds exist. Only pattern frames are kernel frames | A rule needs relevance matching through the director's drives |
| C-S3-2 | A partial story is a seed with its own interests | Open and completed matches are descriptors in a bounded, saved pool that keeps their events alive; one frame per pattern carries the interests | Pool measurements show seeds are cheap enough |
| C-S3-3 | Fitting is query, sample and contribution | Fitting weighs the options layer 2 already has. No search, no fills | Authors need bridges or fills (§0.3) |
| C-S3-4 | Every choice is explainable by kernel `trace` | Layer-3 choices are not kernel pins. The decision log holds them | A tool needs `explain` on a sowing decision |
| C-S3-5 | Fitted choices are recorded as fitted | No `fits` record: the draw records hold the weights (§4.1) | Fitting produces anything but weights |
| C-S3-6 | Reload leaves the world's future unchanged | Pacing restarts in `settling`, so show times differ; sowing decisions do not (§7.2). A match formed only in the lost session is lost | Players report reload-fishing, or measured divergence is above 10 per cent **[tunable]** |
| C-S3-7 | New threads open in a quiet moment (P5) | The sower resolves a slot at its time from saved state, in any phase. Delivery is gated by the hold hook, so a class-0 trace can still show in a firefight (§5.4, rule 1) | Players find sown traces badly timed; then a persisted quiet flag may gate selection |
| C-S3-8 | Simmering and retirement count sessions as well as play-hours (P5 §3.6) | Play-hours only. A session count is a load count, which the director never reads (S2-I-11; P5 §3.1) | Never: this is a correction of P5 |
| C-S3-9 | Urgency rises with time since the window opened and with V's distance from the closing place | Urgency is only what S2's `urgency` list says (§4.4) | A kit needs a ramp the list cannot say |
| C-S3-10 | An unfilled slot's push is owed | A slot is spent, empty or not | Starvation shows in the harness (P5 open question 12) |
| C-S3-11 | A thread joins on shared cast, frames, promises | Only `growsFrom` and shared anchor casts (§5.7) | Threads merge or split wrongly in practice |
| C-S3-12 | A match can be told at any stage, in several ways | A match is told once, when it completes, with one telling (§0.3, §2.2) | Authors want "any stage from n" or several tellings |
| C-S3-13 | The phase hold relaxes at 70 per cent of `maxWait` for every delivery (P5 §3.4) | Only for authored deliveries (P5 §2.4's hook table says authored; §3.4 says "everything but the phase hold"). The phase hold never relaxes for sown ones, since expiry already bounds them | Sown content starves under holds (P5 open question 12) |
| C-S3-14 | Threads over budget are withdrawn, lowest pull first (P5 §3.6) | Budgets only cap openings. A sown seed V never saw lapses after `pendingLifetime`; a seen one is never withdrawn (§5.8, §7.7) | Threads pile up in play; then overflow withdrawal (§0.3) |
| C-S3-15 | A completed match is a `meta:story-end` event, so that patterns compose (P5 §6.5) | One `meta:story` event at completion. No `meta:story-end` and no composition (§6.6) | Patterns compose (§0.3) |

### 14.2 Open items

1. **Pool cost, retained closure and save size.** What does a pool of 256 cost per Change in the native core? How large is the closure that retention marks from up to 1,536 retained events? Does persisting the pool hold up? (P7.)
2. **How many patterns and kits** a city needs before the sower starves: a first library of a few dozen, and a measure of coverage.
3. **Who writes the tellings.** Patterns name them; is that too much for authors, and should a default be derived from a pattern's shape? (S4, P6.)
4. **Calibration.** Every **[tunable]**: the sense weights, the thresholds, the lead aims, the attended window, the budgets, the band cuts, the diversity terms. P9 moves them.
5. **The `producers` and `aesthetic` reads.** S1 and S4 must define them before the patterns and the aesthetic term have anything to read.
6. **The tip-off.** (P5 open question 8, later with dread.) Whether an ordinary `expose` event lets a hostile thread find V.
7. **The salt.** The harness salts layer 3's draws only. Whether the "fresh draws" arm must also freshen layer 2's draws is open (S2 deferred a reserved salt).
8. **Where the sower runs.** On the companion's slow loop or at the simulation window cadence (P7). The spec fixes the order of steps (§1.1) and the cost counting, not the thread.
9. **The starter pack.** Which patterns and kits ship, so that a world with few packs still has rumours and recaps (S4).
10. **Pulls.** When S5 reports that V asked, pulled seeds join the budgets as aware threads; the exact report is S5's.
11. **The read contract's last details.** The exact form of `claimConflict` (whether the call carries the claim's sharing as well as its span), and that `sownBy` answers for compacted instances (S2).
12. **The pending lifetime.** 3600 play seconds is a first guess; P9 sets it against the slot gap and the live budget.

## 15. Review record

### Round 1: GPT-6 Astra, on v0.1

Eighteen findings and four over-engineering cuts, all adopted. The parts that touch S2 and S0 are in S2 v1.2 and S0 v4.8. The cuts are in §0.3: the online estimator, sifting beyond completed event patterns, loose-end growth, and automatic overflow withdrawal.

| # | Finding | What changed in v0.2 |
|---|---|---|
| D-01 | Repeated matches reuse identities | Match id holds the stage-0 occurrence; separate binding key (§3.2, §6.3, §6.4). SF3-16, S3-I-18 |
| D-02 | One Change advances a pattern repeatedly | Emission goes only to its owning pattern; duplicates cannot advance (§6.1, §6.3). SF3-17 |
| D-03 | Saved pool lacks its evidence | Pool entries' events are retention roots; closure measured (§6.2, §9.2). SF3-21, S3-I-22 |
| D-04 | Spine and NPC checks miss casting | Done in S2 v1.2 §5.2; S3 pre-checks bound nodes (§7.3) |
| D-05 | Overlay can replace a fixed identity | Done in S2 v1.2 §1.3; S3-L-6 checks the static case (§2.2, §7.5) |
| D-06 | Impossible openings stop sowing | Finite pending lifetime; unseen threads counted in `A` and `L` (§5.8, §7.7). SF3-12, S3-I-21 |
| D-07 | Loose-end growth invites again | Deferred, with the source, ledger and `follow-up` form (§0.3) |
| D-08 | Reload changes which seed is selected | Slots resolve from persisted state; settling gates shows only (§5.2, §7.2, §9.3). SF3-2, SF3-27, S3-I-13 |
| D-09 | Save boundary splits a sowing decision | One staged batch; saves at tick boundaries; load repairs (§7.6, §9.3, §9.4). SF3-28, S3-I-20 |
| D-10 | A fork must inherit saved state | Fork inherits the whole layer-3 state; only a new lineage starts empty (§9.3). SF3-29 |
| D-11 | Promotion has no complete lifetime | Intermediate promotion deferred; one lifecycle; no `maxPromoted` (§6.2, §6.6) |
| D-12 | Expiry used as eligibility | Deadlines checked at use; sweeps reclaim; equality and tombstone paths defined (§6.4). SF3-18, S3-I-19 |
| D-13 | Overflow picks threads it cannot withdraw | Overflow withdrawal deferred; closing-only threads counted (§0.3, §5.8) |
| D-14 | Candidate and telling cardinality disagree | One telling; one candidate per match; bounded kit order (§2.2, §7.1, §7.5). SF3-25 |
| D-15 | S2's read contract is insufficient | S3 uses S2 v1.2's additions; unused fields dropped (§1.2, §13) |
| D-16 | S0 needs more than a clarification | S3 uses S0 v4.8's registry, envelopes, `tempo`, soft exclusions (§1.2, §2.2, §2.4) |
| D-17 | Estimator asks for evidence S2 lacks | No estimator; offers and responses logged with play time (§8) |
| D-18 | Bands break the coupled-draw claim | Scores frozen per slot; no rebanding after removal (§3.3, §7.4). SF3-24 |
