# S3. Procedural engine specification

**Status:** v0.6, 25 October 2026. v0.6 makes layer 3 run the composite's [pattern language](../composite/pattern-language.md) ([D-27](../decisions.md), [D-28](../decisions.md), [DS-70](../design-seeds.md)). Patterns become graphs of junctures, events and states alike, matched by **one matcher** (the sifter, renamed) whose live instances are candidates before they complete (§6). The director realises a ready juncture by an **offer** or a **nudge** behind new gates: legibility debt, the **escalation gate**, and nudge legality, which nudges only the unobserved ([DS-05](../design-seeds.md)) (§7). Instances compose by chaining through `meta:story` events, by layering on shared fillers, and by growing into shapes, which only recognise (§6.6). A legibility ledger (§6.7) and a persisted ring of recent thread skeletons with a diversity term (§6.8, §7.4) serve M3's iteration 3. A group may act against the protagonist under [D-30](../decisions.md); the director waits for it and never nudges it (§7.10). Back-fill (constructed causes) and open (refinement) are specified and stay later capabilities (§7.11). §15 records what was adopted, changed and rejected; §13 the interfaces assumed from the parallel S0 v4.17 and S1 v0.6 pass. v0.5 says what SF3-36's sowing-off identity covers in general (the fit report), from the M3 run. v0.4, 24 October 2026. v0.4 says a pattern's kinds match by nominal compatibility (S0 v4.14 §2.2), so a resident counts as a person in a pattern without widening any query. v0.3, v0.3 adds a chronological buffer before the sifter, after GPT-6 Astra's review of S1 (E-07). v0.2: v0.2 answers GPT-6 Astra's review of v0.1. It narrows the core (no online player-model estimator, completed event patterns only, no loose-end growth, no automatic overflow withdrawal) and tightens identity, deadlines, reloads and saving.
- **Reviews.** Round 1, GPT-6 Astra, on v0.1: 18 findings and four cuts, all adopted (§15).
- **The core.** This version specifies the **core**: the layer-3 parts that the first implementation builds, narrowed to [S2's core](seeding.md#03-the-core-what-the-first-implementation-builds) (§0.2). Everything else in [P5](../p5-procedural-engine.md) is a **later capability** (§0.3). The first implementation rejects it plainly rather than half-doing it.
- **The additions to S2 and S0.** Layer 3 needed a few additions. S2 v1.1, v1.2 and v1.11 and S0 v4.7 and v4.8 have taken them; v0.6 also assumes interfaces from the parallel S0 v4.17 and S1 v0.6 pass. §13 lists both.

This is the specification stage of [P5](../p5-procedural-engine.md) (work package [WP-13](../plan.md#82-work-packages)). It is exact enough to build layer 3 in the TypeScript reference model from this page, [S2](seeding.md) (v1.11) and the kernel specification [S0](kernel.md) (v4.16), with the interfaces of §13.3 assumed from S0 v4.17 and S1 v0.6. The pattern language explains the design; this page says exactly what is built.

Where this page and P5 differ, this page wins. P5 explains why; this page says exactly what. §14 lists the departures from P5, and the points where P5 disagrees with itself.

**Normative words, tunables and type notation** are as in [S0](kernel.md): MUST, SHOULD, MAY; **[tunable]** and **[calibrate]**; TypeScript notation with normative field names and free physical layout. Every **[tunable]** value lives in pack settings data (`Layer3Data`, §2.1), never in code.

## 0. Scope

### 0.1 What layer 3 does

Layer 3 is the narrative intelligence ([D-02](../decisions.md)). It has four parts:
- **The matcher** (the sifter) reads story patterns against the simulated record and keeps a bounded pool of their **instances**. An instance's matched junctures are its past; its ready ones are its future. Sifting and sowing read the same pool (§6).
- **The sower** chooses what to do at each opportunity: tell an instance, surface a juncture the protagonist hasn't seen, or realise a ready juncture by an offer or a nudge. It turns the choice into a seed through layer 2, and lets unseen seeds lapse (§7).
- **The fitter** weighs the choices that layer 2 draws, so that open parts of any seed fit the world. It serves authored and sown seeds by the same code, and keeps working with sowing off ([D-03](../decisions.md); §4).
- **The director** senses the moment, runs the pacing phases, keeps the thread view and budgets, answers the hooks layer 2 calls, and keeps the schedule that sowing follows (§5).

It does not own: the world and its processes (S0, S1); the seed language, casting, the lifecycle, the arbiter, the record and the exposure ledger (S2); pack format and settings screens (S4); the game port and the sense feed (S5); words (S7); the evaluation harness and the inspectors (P9, P10).

**Six rules run through everything below.**
1. **Two doors out.** Layer 3 changes the world only by sowing a seed, or withdrawing an unseen seed it sowed, through layer 2 (§1.3). It changes timing only through bounded hooks. The only nodes it mints itself are inert `meta:` events (§6.6).
2. **It selects; it never edits.** It chooses which recorded events to tell, when and in what form. It never changes a unit's strength, stakes, hostility or reward, and never rewrites a fragment's words.
3. **V is observed, never owned** ([D-09](../decisions.md)). In the core only the evidence of V's responses is logged, and it **reaches no hook, gate, draw or schedule** (§8, S3-I-4).
4. **Plain data, deterministic, explainable.** Every decision is a function of the record, the packs, the settings and keyed draws (§3). Each one logs why (§10).
5. **Sowing is optional; fitting is not.** With tempo `off`, the matcher and the sower stop. The fitter, the hooks, the thread view and the pacing state keep serving authored seeds ([D-03](../decisions.md)).
6. **It steers only through the unobserved** ([DS-05](../design-seeds.md)). A nudge touches only what the protagonist hasn't observed and couldn't base a choice on, never names the protagonist, and every fill it causes is logged as an adaptation, never presented as a consequence (§7.6).

### 0.2 The core: what the first implementation builds

The core is the least that tests the idea: an authored seed fitted and paced with sowing off, then the same world with sowing on. It is built in the TypeScript reference model, beside layers 1 and 2.

| Area | In the core |
|---|---|
| Fitting (§4) | The **fit hook**: world-only weights on layer 2's draws (casting, variants, modes, alternates), from the seed's aesthetic intent, variety and yielding to live seeds. The **lead aim** for timing. Fit-report additions. **No `fits` record** (§4.1 says why) |
| Director (§5) | The sense feed; the pacing state `A`, `N`, `T`; the five phases with rest lengths; the **hold hook** (phase, headroom, climax rests, lead aim); the **joint hook**; the thread view over seeds and instances, and the opening budgets; the nested opportunity schedule for the `open` stream |
| Matcher (§6) | **Patterns as graphs of junctures** (v0.6): event and state junctures over the function vocabulary; fills from the event-kind registry and registered state rules; bounded state queries; multi-function advancement; link tests; `unless`, `within`, `once`; outcomes, `after` and aftermath; the relevance gate; the bounded saved pool of instances, whose filler events stay alive; deadlines checked at every use and endings applied at the boundary step; tombstones. **Composition:** `meta:story` events at outcomes and parking, chaining, layering with cross-causal marks, shapes as recognisers. The **legibility ledger** and **thread skeletons** with their persisted ring. The v0.5 stage form, read as a chain |
| Sower (§7) | The `open` stream; three kinds of candidate: **told** (an instance at its outcome), **surface** (a matched juncture the protagonist hasn't perceived) and **realise** (a ready juncture, by **offer** or **nudge**); gates 1 to 13, the escalation gate among them; banding over eight features, the skeleton diversity term, scores frozen once per slot, and the keyed draw; kits chosen by the function they fill; instantiation by a sowing request with an overlay; refusal and cooldown; idempotent sowing; one sow and its bookkeeping saved together; a **finite pending lifetime**, a nudge lifetime, and closings for instances that counted as threads |
| Evidence (§8) | Canon offers and responses, with play timestamps, written to the decision log. **No estimator** |
| Persistence (§9) | One `SeedRecord` under its own id: the instance pool, tombstones, the schedule position, the arc lock, the pending and nudge lists, the recent-sown ring and the skeleton ring |
| Determinism, log, audits (§3, §10, §11) | Keyed draws with exact keys; the decision log; static audits |

### 0.3 Later capabilities

The first implementation rejects these with a plain finding ("not supported yet"). Each returns only with a recorded contract that agrees with the reference model.

| Later capability | Why it waits |
|---|---|
| **The player model**: the online estimator and its shadow score; then feeding Score and Phase; the `director → v` beliefs; V's inferred frames | S2 §8.8 defers the preference hooks until option invariance has been shown. The core only logs the evidence (§8), to be judged offline first |
| **Matcher extras:** forking matches; several tellings per pattern; intermediate promotion (`keep`); relations S1 marks phase 2 (they answer `maybe`, so their terms count as no) | v0.6 brings dilemma, edge, frame and belief junctures, telling before completion and composed patterns into the core (§6). The rest needs evidence that the first-filler rule misses stories ([pattern language §16](../composite/pattern-language.md#16-open-questions), question 2) |
| **Open** (refinement: a juncture filled by a child instance, §7.11) | The v0 library has one refinement that meets the contract. Children need lifetimes, depth and closing rules of their own; until then the juncture is filled coarsely, by the world or a nudge |
| **Loose-end growth**: the `looseEnd` source, the `follow-up` form, `from` and `subject` on a kit, the ledger; loose ends of every kind, a parked juncture of an instance included | Growth can turn a rejected seed into a new invitation, so it needs lifetime and rejection rules first (D-07). S2 v1.11 already names a loose end's instance juncture (S2 §6.4) |
| **Automatic overflow withdrawal** of engine-sown threads over a budget | Opening caps and the pending lifetime (§7.7) bound the first test, and risk no thread V cares about. Overflow needs a victim rule that can always withdraw, and a persisted rate cap (D-13) |
| **Score hook, form hook, channel hook** | Score is model-fed. Forms are a later S2 capability (§2.13). The game port already reports channel availability and S2's core uses one carrier with a fallback |
| **Fills, bridges, stand-ins, history hooks, constructed causes (the cause hook, and back-fill of a past juncture, §7.11), the `fits` record** | S2's core has no fill step and no constructed causes. A `fits` record is needed once there is something besides draw weights to record |
| **Fronts, clocks, projections, the band hook, outlets, street forms** | S2's clocks are sugar over counts and signs; projections are later (§2.14). Needs S1's city events |
| **Arcs and seasons; `district` and `city` stake scales; ancestry gates** (two found ancestors) | S2's core omits scale ancestry (L-37). The core sower sows only up to gig level and `block` scale |
| **The subject promotion ladder** (rungs, return and outcome counters, the focal set, the `memorable` rule) | Needs S1 routines and tie-specific moments, and the memory machinery, which is deferred (S0 V4-9 to V4-11) |
| **Baton, staging pointers (P5's earlier sense of "nudge"), refresh traces, the plant planner, glances** | Need `cue` on seeds (N-4), plants and traces (S2 §2.15), and the staging contracts |
| **Thread cadence, the lead thread, composition rules beyond one climactic thread, release jitter, the breakpoint rule** | Polish on a working loop. The arbiter's own gates bound the push rate in the meantime |
| **Staged beats** (warn, standby, `warm`), **jump cues**, **return-view ranking**, **the first-forgetting guard** | Need N-8 and N-9, and S2's full return view (§8.7), which is a later capability |
| **Dread rules** (caps, uncertainty band, tip beats, handles) | Need hostile kits, clocks and S1's threat knowledge. Stage caps are kit data checked by lint (N-10) |
| **Premises, the stance quota, argument profiles, reward-policy audit, arc recogniser** | S2 premises are metadata until a director uses them |
| **T2 counters, the orientation index, the landing check, the noticed page and disclosure, "why this?"** | Need the model to have run in the prototype, and the settings surface (P6) |
| **Pulls as a source; pull signals beyond V's answers and recorded acts (approaching, scanning, returning); `grow` invitations (N-3); belief-divergence candidates** | Pulls and approach signals need S5's reports. Belief junctures are in the core, through S0-3 (§2.2a) |
| **Strain, care-lengthened holds, the per-hour caps on class 2 actions** | The core has no class 2 action, and its only withdrawal (§7.7) touches seeds V never saw |
| **Tempo scaling of durations, lead times and thresholds; the soft sown-push rate** | The core scales the opening rate only. The arbiter's tempo effects (S2 §8.3 step 3) bound the rest |
| **Contest rules** (an authored seed waiting for a committed procedural seed; the uncontested-anchor check before sowing) | Need dry-run casting. The core yields softly (§4.3) and relies on S2's claim priority |
| **Selection extras:** collisions beyond F-13's cross-causal layers, strata hints, the distinctiveness budget, the session tone curve, features F-2 and F-10 | Need history the core does not yet keep. The core ranks on four features and one diversity term (§7.4) |
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
| **Matcher** | On each relevance emission on a pattern frame, and each `Dilemma`, for the patterns that read it; at each simulation window boundary (the boundary step, then the sweep) | Emissions, patterns, the vocabulary, the kernel and layer-2 views | Instances; inert `meta:story` events |
| **Sower** | At a schedule slot (§5.9); at each refresh (pending and nudge lifetimes, closings) | Pool, thread view, skeleton ring, settings | `story.seed@1` and `story.withdraw@1` requests |
| **Fitter** | When layer 2 makes a draw (hook call); when the fit report runs | The seed document, a read-only kernel and layer-2 view | Raw weights; the lead aim |
| **Director** | Once per second of play (the tick); on hook calls; on seed events | The sense feed, the thread view | Hook outputs; holds; the evidence log |

**The tick order within one second of play:**
1. Layer 1 and layer 2 work for the second runs first (relevance dispatch, wake-ups, re-evaluation). The matcher handles its emissions in the kernel's delivery order as part of that, so every emission of the second is folded into the pool before step 2.
2. The director's tick (§5.2): pacing state, phase.
3. The **refresh**: the legibility ledger's perception stamps (§6.7), the thread view (§5.7), the skeleton ring (§6.8), then pending and nudge lifetimes and closings (§7.7), and the evidence log (§8).
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
  // v0.6, for the matcher (§2.2a; the interfaces assumed in §13.3)
  fills(kind: string): KindFill[];          // what an event kind fills (S0-2, S1-1)
  stateRules(fn: FnId): StateRule[];        // the registered state rules of a state function (S0-2)
  relation(rel: RelId, args: Id[], t: GameTime): 'yes' | 'no' | 'maybe';   // a relation of the vocabulary, as a registered read
  causesOf(f: FillerRef): Id[];             // an event's causes and its served frame's cause; a frame's, edge's or intention's cause; a belief's evidence
  vocabulary(): Vocabulary;                 // pack data (§2.2a)
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
  // v0.6: S2 v1.11 §10.1a
  exposure(event: Id): { grade: ExposureGrade; at: GameTime; play?: number } | undefined;
  exposedNodeAt(node: Id, atLeast: ExposureGrade): GameTime | undefined;
  responseOf(event: Id): { seed: Id; beat: BeatKey; kind: string; stance?: Stance } | undefined;
  realisedBy(event: Id): Array<{ fn: FnId; args: Record<string, Id> }>;
  mintedBy(event: Id): { seed: Id; by: BeatKey | 'action' | 'decline' | 'unattended' } | undefined;
  realising(pattern: string, juncture: JunctureKey): Array<{ seed: Id; binds: Record<Var, Id | 'v'> }>;
  beatFunction(seed: Id, beat: BeatKey): { fn: FnId; args: Record<string, Id | 'v'> } | undefined;
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
  displays: Array<{ delivery: Id; grade: ExposureGrade; playTotal: number;        // one per delivery, its highest grade
                    at: GameTime; beat?: BeatKey; channel: ChannelId; cites: Id[] }>;   // v0.6 (S2 v1.11 §10.2)
  responses: Array<{ kind: string; playTotal: number }>;                         // 'action:<id>', 'decline:<id>', 'null'
  draws: Record<string, { value: string; attempt: number; raw?: number; clamped?: number }>;
  closingPending: boolean;                  // a closing delivery has not yet been shown or expired
  nudge: boolean;                           // v0.6: a nudge (S2 §2.25)
}
```

**`exposedNode`** is yes when any exposure-ledger entry ([S2 §10.2](seeding.md#102-the-exposure-ledger)) at `atLeast` or above has the node as a participant, a place, a cast node or a cited node. It is the one way layer 3 asks "has V met this?".

**Event kinds.** An event's kind is a value of the `kind` slot, not a schema `KindId`. Patterns and interests name kinds as registry names, and a selector tests the slot with a `where` predicate (S0 §10.5). The registry gives each kind its tags and its producers.

### 1.3 What layer 3 writes: the doors

| Door | Request | Notes |
|---|---|---|
| Sow | `story.seed@1` (§7.6) | Tellings, offers, nudges and closings. Creator `director`; layer `procedural` (S2 §3.2). Idempotent |
| Withdraw | `story.withdraw@1` (§7.7) | Source withdrawal, T1, only for a seed V never saw (a pending seed, or a nudge that never started). The closing trace plays if a delivery was shown just as it happened and the template has `closing` |
| Mint | The inert `meta:story` event (§6.6) | At an instance's outcome or parking. Creator `director`; causes the instance's filler events; the S0-1 `story` slot; no effects; no witnesses |
| Frames | One root frame per loaded pattern on the actor `director` (§6.1) | Opened and closed as packs load and unload |
| Save | The layer-3 record (§9) | One `SeedRecord` under `layer3Id` |
| Tools | The decision log (§10) | Local, per session, never part of the save |

There is no other write. In particular layer 3 never writes a pin, a belief, a contribution or an edge. A nudge's goal frames, contributions and events are written by layer 2, from a seed, through the sowing door (S2 §2.25).

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
  matcher: {                 // v0.6: `sifter` before
    poolPerPattern: number;  // 32
    poolTotal: number;       // 256
    maxStages: number;       // 5: the v0.5 stage form's short chain, at most four links (§2.2b)
    maxJunctures: number;    // 8 (S2 L-144)
    maxEdges: number;        // 12
    maxFills: number;        // 8: the most fills one kind may declare
    defaultWithin: number;   // 518400 game seconds (6 game days)
    maxWithin: number;       // 2592000 (30 game days)
    candidateTtl: number;    // 259200 game seconds (3 game days) after an outcome
    tombstoneSpans: number;  // 2: a tombstone lasts two `within` periods
    stateCandidates: number; // 8: records a bounded state query lists (§6.4)
    causeHops: number;       // 3: the longest cause walk a link test takes (§6.4)
    causeWalkMax: number;    // 64: the most records one cause walk visits
    lineageDepth: number;    // 4: the deepest chain of story events (§6.6)
    aftermathDays: number;   // 7: an outcome's default aftermath window, in game days
    maxLiveShapes: number;   // 8
    maxLayers: number;       // 8: layer entries kept per instance
    maxSurface: number;      // 2: surface candidates per instance (§7.1)
    relevanceGate: boolean;  // true; fixtures of v0.5's stage form may switch it off (§6.3)
  };
  sower: {
    lambda: number;          // 1.0: how far the band composite tilts the draw
    diversity: number;       // 0.5 per recent duplicate
    recentSown: number;      // 6
    recentKits: number;      // 3
    kitDiversity: number;    // 1.0 for a kit among the recent kits
    maxCandidateTries: number;   // 3 candidates per slot
    maxKitTries: number;     // 3 kits per candidate
    kitJunctures: number;    // 2: the most non-protagonist junctures a sowable kit's implicit pattern may have (S3-K-6)
    cooldown: number;        // 600 play seconds after a refused sowing
    maxRefusals: number;     // 3
    featureWeights: Record<'F3' | 'F5' | 'F6' | 'F11' | 'F13' | 'F14' | 'F15' | 'F16', number>;   // all 1 but F14, 2 (D-27)
    skeleton: number;        // 0.5 per recent thread whose skeleton the candidate's would continue (§7.4)
    skeletonCap: number;     // 4
    skeletonRing: number;    // 32 entries (§6.8)
    skeletonTokens: number;  // 8: tokens kept per ring entry
    nudgeAfter: number;      // 21600 game seconds a juncture is ready before a nudge may realise it (§7.1)
    maxNudges: number;       // 3 live nudges
    nudgeLifetime: number;   // 3600 play seconds for a nudge to start (§7.7)
    portentLead: number;     // 120 play seconds between a portent shown and the rung it warns of (§7.9)
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

A **pattern** is pack data, versioned, read by a generic loader ([DS-38](../design-seeds.md)). It is a **partial causal graph** (v0.6): it names **junctures** (things that happen, or conditions that hold), each a **function** of the vocabulary applied to the pattern's **roles**, and the **causal edges** the world must bear out between them. It never fixes a sequence of scenes or a cast. The design, the library and the reasons are in the [pattern language](../composite/pattern-language.md); this section is the contract the matcher reads. Tellability weights live in code over instances (§7.4), never in a pack.

```ts
type Var = `?${string}`;
type JunctureKey = string;
type PatternId = string;                       // '<namespace>:<name>', e.g. 'xf.composite:debt'
type RoleKind = 'person' | 'group' | 'actor' | 'place' | 'item' | 'fact' | 'event';
type FnId = string;                            // a function of the vocabulary (§2.2a)
type RelId = string;                           // a relation of the vocabulary
type LinkId = 'because' | 'motive' | 'enables' | 'but' | 'reveals' | 'answers' | 'forecloses';

interface Pattern {
  id: PatternId; version: number;
  family: 'tension' | 'turn' | 'closure' | 'shape';
  use?: 'library' | 'authored';                // default library (S2 L-154)
  scale: 'situation' | 'step' | 'goal' | 'concern' | 'drive' | 'standing';   // the context level its outcomes turn (S2 §2.13)
  roles: Record<Var, PatternRole>;
  junctures: Record<JunctureKey, Juncture>;
  edges: CausalEdge[];
  entry: JunctureKey[];                        // where an instance may start
  outcomes: Record<string, Outcome>;           // checked in declaration order
  unless?: Array<{ between: [JunctureKey, JunctureKey]; juncture: Juncture }>;
  within?: { clock: 'game'; days: number };    // default defaultWithin
  once?: Var[];                                // a tombstone per binding set (§6.5)
  show: { junctures: JunctureKey[]; edges: number };   // the least the protagonist must perceive (§6.7)
  escalation?: JunctureKey[];                  // junctures that raise the stake scale or the class of harm (§7.9)
  latitude?: { nudge: boolean; construct: boolean };   // default both true for a library pattern; authors narrow it
  tell?: Telling;                              // told at an outcome (§7.1); absent: never told whole
  summary?: string; links?: unknown; traces?: string[]; risks?: unknown;   // for authors, tools and evaluation; the matcher never reads them
}

interface PatternRole {
  kind: RoleKind | RoleKind[];
  identity?: Part<Id | GameKey>;               // S2 §2.2; default open
  must?: RelReq[];
  prefer?: Array<{ r: RelReq; strength: 1 | 2 | 3 }>;   // steers only what the director realises, never matching
  v?: 'never' | 'may';                         // may the protagonist fill it? default never
}

interface Juncture {
  fn: FnId;
  args: Record<string, Var | JunctureKey>;     // the function's arguments; a juncture key stands for that juncture's filler
  form?: 'event' | 'state';                    // default the function's form
  requires?: RelReq[];
  changes?: Change[];                          // what filling it changes: expectations the world bears out (§6.3)
  fill?: Part<Filler[]>;                       // default open: anything that fills `fn`
  realise?: Realisation[];                     // how an open juncture may come about, in preference order (§7.5)
  v?: 'never' | 'offer';                       // may the protagonist's act fill it? Only through an offer
  optional?: boolean;                          // may be skipped without failing the pattern
  park?: boolean;                              // still open at closing: a loose end
  join?: 'all' | 'any' | { all: JunctureKey[]; any: JunctureKey[] };   // over incoming edges other than `forecloses`; default all
  binds?: Record<Var | 'anyParticipant', Var>; // a `story` juncture: the child pattern's roles that are this pattern's
}

type Filler =
  | { kinds: string[] } | { tags: string[] }               // event kinds, or kind tags
  | { seed: TemplateId; by: BeatKey | 'end' }              // an event a beat of that seed minted, or its seed-outcome (S2 mintedBy)
  | { pattern: PatternId; outcome?: string };              // a story event of that pattern (§6.6)

type Realisation =
  | { wait: true } | { offer: { kit?: TemplateId } } | { nudge: { kit?: TemplateId } }
  | { construct: true }                                    // back-fill: a later capability (§7.11)
  | { refine: { pattern: PatternId; outcome: string; binds: Record<Var, Var> } };   // open: a later capability (§7.11)

interface CausalEdge { from: JunctureKey; to: JunctureKey; link: LinkId; shown?: 'must' | 'should' }
type RelReq = { rel: RelId; args: Array<Var | JunctureKey | string> } | { not: RelReq };
interface Outcome {
  reached: JunctureKey[]; foreclosed?: JunctureKey[];
  after?: { clock: 'game'; days: number };     // applies once `reached` has held this long with no other outcome (§6.5)
  produces?: Array<{ fn: FnId; args: Record<string, Var> }>;   // what the outcome establishes together (§7.11)
  aftermath?: { junctures: JunctureKey[]; days?: number };     // consequences that can match only after it
  kind: 'resolved' | 'failed' | 'parked'; next?: PatternId[];  // `next` is a hint for authors and tests; the matcher never reads it
}
type Change = (
  | { begins: FnId; args: Record<string, Var> } | { ends: FnId; args: Record<string, Var> }
  | { frame: { of: Var; toward: Var | JunctureKey; status: 'opens' | 'blocked' | 'satisfied' | 'abandoned' } }
  | { tie: { a: Var; b: Var }; move: 'up' | 'down' | 'ends' }
  | { standing: { audience: Var; of: Var }; move: 'up' | 'down' }
  | { member: { who: Var; of: Var }; move: 'joins' | 'strained' | 'exits' }
  | { belief: { who: Var; about: Var | JunctureKey }; move: 'forms' | 'revised' }
  | { exposure: { to: Var; of: Var | JunctureKey } }
) & { when?: { npc: Var } | { protagonist: Var } };

interface Telling {                            // v0.5's single telling, now told at an outcome
  form: Form;                                  // S2's forms; 'follow-up' is later (§0.3)
  kit?: TemplateId;                            // absent: any sowable template that serves `form` and has every role in `binds`
  binds: Record<RoleKey, Var | '?story' | '?end'>;   // kit role ← a variable, the story event, or the latest filler event by time
}
```

**Meaning, briefly** (the pattern language §3 has the full account):
- **Roles** are variables that junctures share. Kinds match by S0's nominal compatibility (v0.4: a resident counts as a person). The protagonist (`v`) may fill a role only where it says `v: 'may'`, and only through an act of the protagonist's (§2.2a), never by assumption ([D-09](../decisions.md)).
- **Junctures** name a function and its arguments. One of form `event` is filled by an occurrence. One of form `state` is filled by a record that holds over an interval (an edge, a frame, a group intention, a norm's mark, a belief), or by an event that begins the state.
- **Edges** carry the cascade. Each link must be borne out in the record before the later juncture counts as matched (§6.4). `forecloses` is an effect only: when its source matches, its target is foreclosed.
- **Outcomes** are named end states. `aftermath` names the consequences that can match only after the outcome.
- **Shapes** (`family: 'shape'`) are patterns whose junctures include `story` junctures, filled by smaller instances. They only recognise: none of their junctures has a `realise` list (S2 L-151, §6.6).
- **Changes** are not match conditions. Most of them are S1's response to the filler (a tie moving after a repayment), so the matcher doesn't wait for them. The harness measures how often a juncture's declared changes were recorded (P9).

**Load checks.** A pattern loads only if it passes the pattern lint ([S2 §11.1](seeding.md#111-lint), L-144 to L-159) and these. A pattern that fails is not loaded, with a finding naming the check; other patterns load.

| # | Check |
|---|---|
| S3-L-9 | Every kind that a fixed `fill` names, or whose fills give a juncture's function, is in the event-kind registry with non-empty `producers`. Every function a `state` juncture uses has a state rule, or the juncture is filled only by events |
| S3-L-10 | A `Filler` of the `seed` form names a template of a loaded pack, and one of the `pattern` form a loaded pattern (at load time, or as the pack loads) |
| S3-L-11 | `construct` and `refine` entries of a `realise` list are later capabilities (§7.11). The pattern loads; those entries are skipped, with one load finding |

S3-L-1 to S3-L-8 are the stage form's (§2.2b).

### 2.2a The vocabulary and what fills it

The **vocabulary** is pack data. S4 owns its format; the M3 vocabulary is [`composite/vocabulary.json`](../composite/vocabulary.json).

```ts
interface Vocabulary {
  functions: Record<FnId, { form: 'event' | 'state'; args: Record<string, RoleKind | RoleKind[]>; searchFrom?: string[] }>;   // args in declared order
  relations: Record<RelId, { args: string[] }>;   // each answered by a registered read (KernelView.relation)
  tokenPrecedence: FnId[];                        // every function once: the order that names a token (§6.8)
}
```

The seven links are this page's (§6.4), not the vocabulary's.

**What fills a function is declared by the world, not by the patterns.** Two registries say it (the assumed interfaces S0-2 and S1-1, §13.3), so a new event kind in a pack fills the patterns it should the moment it declares its fills, and no pattern names it.

```ts
interface KindFill {                              // on each event-kind registry entry, as `fills`
  fn: FnId;
  args: Record<string, string>;                   // the function's argument → a participant role of the kind, or 'place'
  when?: { outcome?: Array<'done' | 'failed' | 'prevented'>;   // the event's outcome; an absent outcome reads as 'done'
           stance?: Array<Stance | 'decline'> };  // S2's `response` only, read through Layer2View.responseOf
}

type FillerRef =
  | { event: Id } | { edge: Id } | { frame: Id } | { belief: Id }
  | { intent: { group: Id; id: string; since: GameTime } }      // an S1 group intention
  | { norm: { norm: Id; who: Id } }                               // a norm's mark on a resident (S1 order.norms)
  | { dilemma: Id };                                              // a kernel Dilemma, by its occurrence id

interface StateFill { filler: FillerRef; args: Record<string, Id>; at: GameTime }   // `at`: when the state began

interface StateRule {                             // registered per state function: by S0 for edges, frames and beliefs; by S1 for intentions, norms and reads
  fn: FnId; id: string;                           // e.g. 'obligate.member-of'
  changes: Selector[];                            // the Changes that can make the state true: interests for the pattern frames (§6.1)
  fromChange(c: Change, view: KernelView): StateFill[];        // the states this Change makes true, in record Id order
  search(arg: string, node: Id, t: GameTime, view: KernelView): StateFill[];   // only from an argument in the function's searchFrom; record Id order
  holdsAt(f: FillerRef, t: GameTime, view: KernelView): 'yes' | 'no' | 'maybe';
}
```

- **A filler's identity.** `fillerId(f)` is the event's `Id` for an event, and otherwise `H("filler", <the form's name>, <its fields in declared order>)`. Instances key on it (§3.2).
- **Events.** An event fills each `KindFill` of its kind whose `when` holds, its participants mapped to the function's arguments. A kind declares at most `maxFills` (8). An argument whose participant role is absent from the event stays unbound.
- **States in the core:** membership, tie and holder edges (`core:member-of`, `xf:tie`, `xf:held-by` of S1-4); context frames by level, status and interests (`want`, `pursue`, `protect`, and `threaten` from a frame's goal effects); S1's group intentions (`want`, `pursue`, `protect`, `decide`, the intention against the protagonist of S1-10 included); norms' marks (`obligate`, `want`); a `Dilemma` (`demand`, as the vocabulary maps it); and beliefs (`blame`, `conceal` by belief, `learn` by observation), through S0-3's belief Change. **Until S0-3 is built, the belief rules fill nothing:** those junctures wait, and `learn` is filled only by `tell` events and by an event's `witnesses`. A read that S1 marks phase 2 (`city.protected`, `social.contract`) answers `maybe`, so it fills nothing.
- **`story`** is filled by a `meta:story` event (§6.6). Its S0-1 slot gives the pattern and the outcome; the juncture's `binds` maps the story's participants onto this pattern's roles.
- **The protagonist's acts.** An event in which `v` takes part as `actor` (a response, an act the game reports) fills like any other, and binds `v` only to a role with `v: 'may'`. Every link into a juncture it fills is tested as `answers` (§6.4): the engine never reads the protagonist's reasons.

### 2.2b The v0.5 stage form

A pattern in v0.5's form (`SiftPattern` below: ordered `stages` of event clauses and one `telling`) still loads, and runs through the same matcher. It is read as a **chain**:
- each stage `i` is a juncture `s<i>` of form `event` whose fill test is v0.5's `matchClause` (below) for that stage, and whose function is the internal `@stage`, which no kind fills and which gives no token;
- consecutive stages are joined by an internal `order` link: the later filler's time is not earlier than the earlier's, and nothing else is tested. Only this form may use it, because a link that reads only as "then" is a defect elsewhere ([QST-01](../craft/d04-quest-structure.md));
- the entry is `s0`; the one outcome, `complete`, of kind `resolved`, is reached by the last stage; each `unless` keeps its stage indexes; `within` (in game seconds) and `once` are as written; `show` is `{ junctures: [the last stage], edges: 0 }`; the `telling` is the `tell`;
- the instance identity, binding key and candidate key are v0.5's (§3.2), so v0.5's fixtures keep their meaning. They run with `relevanceGate: false`.

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
```

A clause's `where` predicates are S0 §8.1 predicates evaluated on the **event node** of that stage. A role's `where` predicates are evaluated on the node once it is bound. A predicate that answers `maybe` counts as `no`. The reserved variable `?story` is the `meta:story` event of the instance (§6.6). `?end` is the event of the last stage.

**`matchClause(clause, emission, bindings) → bindings' | null`** is deterministic and never mutates `bindings`:
1. The Change is an event, and the clause's `kind` equals the event's kind, or, for `{ tag }`, the registry's tags for the kind contain the tag.
2. For each `who` item in order: take the first participant, in participant order, whose `role` equals `item.role` and who satisfies the variable. If `item.as` is already bound, the participant's `who` must equal it. Otherwise it binds if its kind accepts the role's `kind` and the role's `where` predicates are all `yes`.
3. For each `effects` item in order: find an event effect whose `effect` is in the item (a single value or a list) and whose `on` equals the bound variable `item.on`. If `item.on` is unbound, take the first such effect in order, and bind it by the same test as in 2.
4. Every `where` predicate is `yes` on the event node.

**Load checks of the stage form.** A pattern that fails any check is not loaded, with a finding naming the check.

| # | Check |
|---|---|
| S3-L-1 | Every event kind in a clause is in the event-kind registry, and its `producers` are not empty |
| S3-L-2 | Every variable in a clause, `once` or `binds` is declared in `roles`, and a role's kind is compatible with every use. Every variable in `binds` is bound by some stage clause, so it is bound once the match is complete |
| S3-L-3 | `stages` has 1 to `maxStages` entries (5: the chain is short). Each `unless.between` is `[a, b]` with `0 ≤ a < b < stages.length` |
| S3-L-4 | `within`, if given, is positive and at most `maxWithin` |
| S3-L-5 | Stage 0 binds at least one variable of kind `core:person` or `core:group` (a human at the centre) |
| S3-L-6 | The telling's `kit`, if named, exists, is a sowable template that `serves` the telling's form. Each key of `binds` is a role of the kit whose kind accepts the variable's kind and whose template gives it no fixed identity (S2 §1.3 refuses an overlay that replaces one). `?story` binds only to a role of kind `core:event` that requires `kind = meta:story`; `?end` only to a role of kind `core:event` |
| S3-L-7 | A clause of another kind (`dilemma`, `edge`, `frame`, `belief`), an event clause naming a `meta:` kind, a `keep` field, or a form of `follow-up` is refused. They are written as graph patterns now (§2.2) |
| S3-L-8 | Every variable in `once` is bound by stage 0, so a tombstone can be checked when an instance starts |

### 2.3 Sowable templates

A seed template that layer 3 may sow carries a **sowable declaration**. S2 carries it opaque (§13) and S3 reads it.

```ts
interface Sowable {
  serves: Array<Form | 'nudge'>;         // at least one; 'nudge' only for a nudge (S2 §2.25)
  firstClass: 0 | 1 | 2 | 3 | 4;         // the class of its first delivery; 0 and unread for a nudge
  weight?: number;                       // kit weight, default 1
  climactic?: boolean;                   // the seed opens with a conclusion beat available (counts toward maxClimactic)
  tags?: string[];
  fills?: Array<{ fn: FnId; args: Record<string, RoleKey | 'v'>; cause?: RoleKey }>;   // v0.6: the functions it can realise (§7.5)
  tells?: RoleKey;                       // v0.6: the role, of kind core:event, that a surfaced filler binds (§7.5)
}
```

- **`fills`** (v0.6, the composite's S2-9, changed). Each entry is a function the kit can realise for a juncture, with the kit role that takes each of the function's arguments (`'v'` for an argument the protagonist fills) and, optionally, the role of kind `core:event` that takes the cause: the filler the juncture continues (§7.6). A list of function ids alone could not tell the sower which kit role takes which person.
- **`tells`** names the event role a **surface** telling binds to the filler it shows (§7.1).

**Sowable load checks.** A template that fails is not sowable by layer 3. It may still be sown by its pack.

| # | Check |
|---|---|
| S3-K-1 | `maturity` is `ready` ([S2 §1.3](seeding.md#13-sowing-authored-templates)) |
| S3-K-2 | `level` is at most `maxLevel`. `stakeScale` is `person`, `crew` or `block`, or absent (default `block`) |
| S3-K-3 | A template that serves any form other than `rumour`, `recap` or `sighting` has `closing`, so that withdrawing it just as a delivery is shown always leaves a closing trace |
| S3-K-4 | `firstClass` equals the class of the first delivery that the template's start beats produce, by S2's registry |
| S3-K-5 | No role of the template has an `identity` that `isSpine` |
| S3-K-6 | (v0.6) **No whole plots.** The template's implicit pattern ([S2 §2.24](seeding.md#224-patterns-in-seeds)) has at most `kitJunctures` **[tunable 2]** junctures whose functions are other than `ask`, `comply`, `refuse` and `choose`. A template that lays out more is a plot in miniature, which D-28 rules out as procedural material; its pack may still sow it |
| S3-K-7 | (v0.6) A template serves `nudge` if and only if it is a nudge (S2 §2.25), and then serves nothing else. A nudge is exempt from S3-K-3 and S3-K-4 |
| S3-K-8 | (v0.6) Each `fills` entry names a function of the vocabulary; each of its `args` keys is an argument of that function, mapped to a role of the template whose kind accepts the argument's kind and whose template gives it no fixed identity, or to `'v'`; a `cause` or `tells` role has kind `core:event`. A nudge maps no argument to `'v'` |

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
3. **Order.** Patterns run in `id` order, pattern instances in creation (`seq`) order, junctures and outcomes in key and declaration order, fills in their registry order, state-query candidates in record `Id` order, candidates in `key` order, seed instances in `Id` order. Ties go to the lower `Id`, or the lower tie hash where a rule says so. No matching choice uses a draw: the matcher takes the first filler that passes, in these orders.
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

Identity hashes (no salt, no `rand`). An **occurrence** is one incident: the event, or the state record, that filled an instance's first entry juncture. Its **occurrence id** is that filler's `fillerId` (§2.2a): for an event, the event's `Id`, which S0 v4.8 puts on every delivered envelope.

| Hash | Value |
|---|---|
| Binding key | `H("bind", worldSeed, pattern.id, v₁, id₁, v₂, id₂, …)` over the variables bound by the **entry juncture's fill**, before any state query, sorted by variable name (UTF-8 byte order). It finds an open instance with the same bindings. It is **not** an identity |
| Instance id (the match id) | `H("match", worldSeed, pattern.id, bindingKey, occurrence)`: the binding key and the occurrence id. Two incidents among the same people have different ids, however far apart. The pattern's version is not in it: an instance of another version is dropped at load (§9.3) |
| Candidate key, **told** | `H("cand", worldSeed, "match", instanceId, n − 1)`, with `n` the pattern's number of junctures (for the stage form, v0.5's key: the last stage) |
| Candidate key, **surface** | `H("cand", worldSeed, "surface", instanceId, juncture)` |
| Candidate key, **realise** | `H("cand", worldSeed, "juncture", instanceId, juncture)` |
| Decision id | `H("sow3", worldSeed, cand.key)` |
| Closing decision | `H("close3", worldSeed, instanceId)` (§7.7) |
| Withdraw decision | `H("wdraw3", worldSeed, seedId)` |
| `meta:story` event | `H("mint", director, instanceId, "meta:story")` |
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

A **thread** is a view over layer 2's records ([S2 §2.13](seeding.md#213-scale-turns-threads-and-forms)) and, from v0.6, layer 3's pattern instances: the unit the director budgets and the unit evaluation judges ([pattern language §11.2](../composite/pattern-language.md#112-threads)). It is derived, never persisted. It is rebuilt at a refresh (once a second, and after any seed state change or instance match) from `Layer2View.instances()` and the pool.

**Members.** Every seed instance that is live, or terminal with `closingPending`, except a nudge; and every pattern instance in the pool that is not `lapsed`. Nudges join no thread, so they never make one aware, live or unseen.

**Links.** Two members are in the same thread when any of these holds:
- **seed and seed:** one names the other in `growsFrom` (`looseEnd.seed` or `parent`), or they share a committed cast node in roles that are `anchor` in **both**;
- **seed and instance:** the seed's `growsFrom` names the instance; or a live seed realises a juncture of the instance: `Layer2View.realising(pattern, juncture)` lists it with casts equal to the instance's bindings for every variable both bind;
- **instance and instance:** a **chain**, where one matched the other's `meta:story` event, or one's entry filler is the filler of a juncture the other's fixed outcome reached (§6.6); or a **cross-causal layer** (§6.6). A layer that is not cross-causal joins nothing: co-occurrence alone is two stories.

A thread is a connected component under these links. Its `Id` is the lowest member `Id` in it, seeds and instances alike.

**Fields**, from the members (`now = playNow`):

| Field | Definition |
|---|---|
| `aware` | Some seed's `displays` entry has grade `presented` or `confirmed`, or some instance **counts as a thread** (§6.7) |
| `lastPresented` | The greatest `playTotal` among those seed entries and the perception stamps of the instances' perceived junctures (§6.7); `−∞` if none |
| `engineSown` | Every seed member's `source.by` is `director`, and the thread has at least one seed |
| `live` | Some seed has a beat in state `running` |
| `climactic` | Some seed has a beat of kind `conclusion` in state `available` or `running` |
| `pulls` | The game times of the protagonist's pulls on the thread (§7.9): an action answering an offer of a seed member; a `pull` delivery of a seed member; an event with V as `actor` among whose participants, place or effect targets is a node bound by an instance member or cast by a seed member |

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

An unseen engine-sown thread is a sown seed whose first delivery V has not been shown. It counts in both `A` and `L`, so the sower does not open a third seed while two wait. A thread with only a closing delivery pending counts in `A` or `S` by recency, and never in `L` or `C`. A thread of instances alone, aware because it showed (§6.7), counts in `A` or `S` by recency.

**Budgets** are `maxAttended 4`, `maxLive 2`, `maxClimactic 1`, `maxSimmering 8` **[tunable]**. Authored, fitted and answered threads all count.

**Who the budgets bind.** Only the engine's own **openings**: a candidate opens a thread when its thread is not `aware` (§7.1). The slot check of §7.2 and gate 8 of §7.3 apply the budgets to openings only; a candidate that **continues** an aware thread is held only to the climax budget. Authored seeds are never refused or withdrawn for a budget. The engine's threads yield to them. **Nothing is withdrawn for exceeding a budget.** Automatic overflow withdrawal is a later capability (§0.3). In the core, opening caps and the finite pending lifetime (§7.7) keep the load bounded: an unseen seed that cannot proceed leaves within `pendingLifetime`, and a seen one is never withdrawn. Nudges have their own bound (`maxNudges`, §7.7).

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

## 6. The matcher

Matching asks "what story is in the record, and what is it waiting for?". The matcher finds and keeps; the sower chooses. It is v0.5's sifter generalised three ways ([pattern language §6](../composite/pattern-language.md#6-matching)): junctures form a graph rather than a list of stages, a juncture may be a state as well as an event, and an instance is a candidate before it completes. Frames per pattern, the chronological buffer, the bounded saved pool, tombstones and determinism are kept as v0.5 had them.

### 6.1 Frames and input

The matcher's input is the **live Change stream**, plus what it chose to keep. It is not a log to scan later: replay and regeneration are silent ([S0 I-13](kernel.md#15-invariants)), and non-canon events can be forgotten.

**Pattern frames.** Each loaded pattern has one frame on the actor `director`:

```
id: H("mint", director, director, "frame:" + pattern.id)
level: 'situation', weight: 1, parents: [], origin: director, status: 'active'
focus: { nodes: [], tier: 0 }, payload: {}
own.reactsTo: one selector per distinct filler of every juncture of the pattern and of its `unless` entries,
              the narrowest the kernel can express:
              - for an event juncture: a `where` predicate on the `kind` slot of core:event (S0 §10.5) for each kind whose
                fills give the juncture's function, or each kind or tag a fixed `fill` names;
              - for a state juncture: the `changes` selectors of the function's state rules (§2.2a);
              - for a `story` juncture: kind `meta:story`;
              - for a pattern with a role in an acting argument: the kinds that carry a `kill` effect, and `game.death` (§6.5)
```

The frame's weight 1 and no parents give pull 1. A kind-level `reactsTo` match has `r = 1 × 0.6 × 0.5 = 0.3`, a bucket-level one `0.18`. Both clear `θ_react = 0.08` ([S0 §16.2](kernel.md#162-calibration-fixtures)). One frame per pattern keeps patterns from masking each other: the kernel emits at most one relevance event per (change, frame, interest type), so two patterns that share a filler would collapse into one emission on a shared frame. The frames are recomputed when the event-kind registry or the loaded patterns change.

**What an emission carries.** The Change payload, the **occurrence id** and the occurrence's **game time** (S0 v4.8). The matcher tests the Change itself.

**Dilemmas.** The kernel delivers every `Dilemma` to layer 3 with the relevance emissions ([S0 §10.8](kernel.md#108-effects-and-cross-pressure)). Each is offered, in pattern `id` order, to the patterns with a juncture that a `Dilemma` fills (the vocabulary maps it to `demand`), as an occurrence whose id is the dilemma's occurrence id. This is how a `pressure` becomes the entry of divided loyalty ([S2 §9](seeding.md#92-settling)).

**Dispatch.** An emission is handled by **the pattern that owns its frame, and by no other**. A Change that matches the frames of two patterns gives two emissions, one for each. The cost is one entry test per entry juncture plus one test per ready juncture of each open instance of that pattern, counted in the kernel's tick budget ([S0 §10.7](kernel.md#107-work-hard-limits-and-worklists)).

**Pack changes.** On a pack activation or removal, the matcher opens the frames of newly loaded patterns and closes (`abandoned`) those of removed ones. Instances of a removed pattern, or of an older `version` of a loaded one, are dropped with a log entry (§9.3).

**What the matcher ignores.** A `contribution` Change. An event whose `creator` is `director`, and any `meta:` kind, **except** a `meta:story` event, which only `story` junctures read (S1's policies ignore all of them, S3-I-14). Events that seeds mint (S2 §2.5) are world events and are matched like any other.

**The chronological buffer** (v0.3). Producers publish late: S1's simulated events appear only when their window's batch is applied, while mirrored events appear at once. So the matcher doesn't take emissions as they arrive. It holds them in a buffer and releases them **in order of occurrence time** (then occurrence id) once the **horizon** has passed: every producer has published up to that time. The horizon is the current boundary, less the longest publication lag among the loaded producers. S1 declares the lag per process (§9.4 there); in M3 it is one window. Dilemmas go through the same buffer. The buffer is bounded by the lag, and is persisted with the pool (§9.2), so a reload neither loses nor reorders it (SF3-38).

### 6.2 Instances and the pool

An **instance** is one reading of a pattern against the world. The pool holds instances as **copied descriptors**: ids, times, bindings, juncture states and filler descriptors. It holds no live node references. It **keeps its filler events alive**: every filler event and story event of a pooled instance is a retention root of the layer-3 record (§9.2), so a non-canon event can't be forgotten while an instance needs it.

```ts
interface Instance {
  id: Id;                                   // the match id (§3.2): one per occurrence
  bindingKey: Id;                           // §3.2
  seq: number;                              // creation order, from nextSeq
  pattern: string; version: number;
  state: 'forming' | 'live' | 'aftermath' | 'resolved' | 'parked' | 'lapsed';
  bindings: Record<Var, Id | 'v'>;
  junctures: Record<JunctureKey, JState>;
  used: Array<{ occurrence: Id; fns: FnId[] }>;   // which functions each consumed occurrence gave (§6.3); at most maxJunctures entries
  firstTime: GameTime; lastTime: GameTime;  // the first and latest filler times
  outcome?: { name: string; kind: 'resolved' | 'failed' | 'parked'; at: GameTime; story: Id };
  armed?: { outcome: string; since: GameTime };   // an outcome with `after`, waiting (§6.5)
  aftermathUntil?: GameTime;
  depth: number;                            // 1 + the deepest story event among its fillers (§6.6)
  layers: Array<{ with: Id; juncture: JunctureKey; filler: Id; cross?: { juncture: JunctureKey; at: GameTime } }>;   // at most maxLayers (§6.6)
  closing?: 'needed' | 'sown' | 'none';     // §7.7
  seeds: Array<{ seed: Id; for: 'told' | 'closing' | JunctureKey }>;   // the seeds sown from it (§7.6), at most maxJunctures + 2
  refusals: Record<string, { n: number; until: number }>;   // per candidate: 'told', 'surface:<juncture>', 'realise:<juncture>'; `until` in playTotal (§7.6)
}
interface JState {
  state: 'open' | 'ready' | 'pending' | 'matched' | 'refined' | 'foreclosed' | 'skipped';
  filler?: { ref: FillerRef; id: Id; fn: FnId; at: GameTime; args: Record<string, Id | 'v'>;
             source: 'found' | 'offered' | 'nudged' | 'constructed' | 'refined'; by?: Id };   // `by`: the seed behind an offered or nudged fill
  pending?: Id;                             // the seed working towards it (§7.6)
  readySince?: GameTime;
  perceived?: { at: GameTime; play: number };   // the legibility ledger (§6.7)
}
```

**Juncture states:**

| State | Meaning |
|---|---|
| `open` | Not filled, and its join over incoming edges (not counting `forecloses`) isn't satisfied |
| `ready` | Not filled; its join is satisfied (a juncture with no such incoming edge is ready from the start), so it may be filled next |
| `pending` | A seed the director sowed, or a live seed that realises it (§5.7), is working towards it |
| `matched` | Filled by a recorded event or state, with its incoming links borne out |
| `refined` | Filled by a child instance's outcome (§7.11; a later capability) |
| `foreclosed` | Can no longer be filled: a `forecloses` edge fired, a bound acting person died, or an `unless` struck |
| `skipped` | Optional, and the instance closed without it |

**The lifecycle of an instance:**

| State | Meaning | Becomes |
|---|---|---|
| `forming` | Only its entry juncture is matched; not a candidate | `live` when a second juncture matches, or when a bound person is `exposedNode(·, 'presented')` (checked at each match and at the boundary step) |
| `live` | Has a past and a future: a candidate for the sower | `aftermath`, `resolved`, `parked` or `lapsed` |
| `aftermath` | An outcome was fixed and its story event minted; only that outcome's aftermath junctures may still match | `resolved` (or `parked`, for a parked outcome) when they have all matched or `aftermathUntil` passes |
| `resolved` | An outcome was reached, and its aftermath has run | Terminal |
| `parked` | Ended with `park` junctures still open, by a parked outcome or by ending without an outcome after it was perceived (§6.5) | Terminal; its parked junctures are loose ends (later growth, §0.3) |
| `lapsed` | Ended before the protagonist perceived any of it | Terminal; leaves nothing but a tombstone if `once` |

The matched junctures are the instance's **past**, what sifting finds; the ready and pending ones are its **future**, what the director can wait for, offer or nudge towards (§7). "Open" below means `forming` or `live`.

**Bounds:**

| Bound | Value |
|---|---|
| Instances per pattern | `poolPerPattern` (32) |
| Instances overall | `poolTotal` (256) |
| Retained events | At most `poolTotal × (maxJunctures + 1)` ids in `nodes`; P7 measures what retention marks from them (§14.2) |
| Duplicates | One instance per instance id. One **open** instance per binding key. One occurrence starts at most one instance of a pattern |
| Live shapes | `maxLiveShapes` (8) (§6.6) |
| Tombstones | One per `once` binding set, kept as §6.5 says |

**When a bound is hit,** a new instance is not started unless a slot can be freed. To free one the matcher evicts, in the same pattern (for the per-pattern bound) or overall (for the total), the `forming` instance with the earliest `firstTime`, then the lower `seq`; failing that, a `live` instance with no perceived juncture and no pending seed, by the same order. It never evicts an instance with a perceived juncture or a pending seed. If none can go, the new instance is refused. Either way the event logs `pool-full`. An evicted instance writes no tombstone and mints no story event, and its events are released.

### 6.3 Handling a Change

`onChange(emission)` runs once per emission, for the pattern that owns its frame (and once per pattern for a `Dilemma`, §6.1). `now` is the occurrence's game time. Let `F(c)` be the **fills of the occurrence**: for an event, each `KindFill` of its kind whose `when` holds (§2.2a), with its arguments mapped, in registry order; for a state Change, every `StateFill` that a state rule of this pattern's functions returns from `fromChange`, in rule then record order; for a `Dilemma`, its `demand`; for a `meta:story` event, its `story` fill. Each fill is a function with an argument map.

1. **Open instances first**, in `seq` order, from a snapshot taken before this Change (an instance this Change starts is not in it):
   1. **Deadline at use.** If `now > firstTime + within`, the instance has expired: nothing is tried for it. Its ending is applied at the boundary step (§6.5).
   2. **Duplicate.** If the instance has a `used` entry for this occurrence and no fill in `F(c)` has a function that entry doesn't hold, skip it. A redelivered Change can never advance an instance.
   3. **Unless.** For each `unless` entry with `between: [a, b]`, while `a` is matched and `b` is not: if the fill test (below) succeeds for the `unless` juncture, the instance **dies** (§6.5, `match-killed`). Nothing else is tried for it.
   4. **Advance (multi-function).** Repeat: for each `ready` juncture `j`, in key order, and each fill in `F(c)` whose function is `j.fn` and is not yet in this occurrence's `used` entry, in `F(c)` order: if the fill test succeeds and every incoming link of `j` tests yes (§6.4), `j` is `matched` with that filler; its new bindings join the instance's; the function is added to the `used` entry; `forecloses` edges fire; the ready set is recomputed; bounded state queries run for the new bindings (§6.4); layers are recorded (§6.6); the outcomes are checked (§6.5); and the loop restarts. It stops when no juncture matches. **A Change fills at most one juncture of an instance through each function its record fills**, so an occurrence that fills several functions (a paid shakedown is a demand, a compliance, a transfer and a wrong) may fill several junctures, one per function, in the order they become ready. Links between junctures that one occurrence fills hold by construction. The loop runs at most `maxFills` times.
2. **Start.** For each entry juncture, in key order, until one starts an instance: for each fill in `F(c)` whose function is the juncture's, in order, try the fill test with no bindings. On the first success:
   1. **The relevance gate** (if `relevanceGate`). The instance starts only if the entry filler: (a) involves the protagonist, or a node with `exposedNode(·, 'presented')`, among its arguments, participants or place; or (b) has as its place a cell whose `depth` read is `open` (S1 §9.1); or (c) belongs to a group-level pattern, one whose `scale` is `concern`, `drive` or `standing` and whose entry juncture binds only groups; or (d) is a `meta:story` event at least one of whose cause events has `exposure` at `presented` or above. Everything else is world texture the matcher ignores ([pattern language §10.2](../composite/pattern-language.md#102-the-relevance-gate)). Off-screen stories cost only what group-level events cost.
   2. Compute the binding key and the instance id (§3.2). If an instance with that id exists, stop: it is the same occurrence. If an **open** instance with that binding key exists, stop: one is already forming among these people.
   3. If the pattern has `once` variables and a tombstone with their key is in force (§6.5), stop.
   4. Apply the bounds of §6.2.
   5. Create the instance with the entry juncture matched, `seq = nextSeq++`, state `forming`, its `used` entry, and the ready set computed. Then run the advancement of step 1.4 for it with the same occurrence, the bounded state queries (§6.4) and the outcome check.
3. **States later.** A state juncture also matches when a later Change makes it true (an edge added, a frame opened, an intention started): that is an ordinary fill of `F(c)` in step 1.4.

**The fill test** for juncture `j`, a fill `f` and the instance's bindings:
1. `f.fn` is `j.fn`, and the filler's form is accepted: an event for an `event` juncture; for a `state` juncture, a state record or an event whose kind fills the function (the event begins the state).
2. Every argument of `j` already bound equals the mapped value. Every unbound argument binds if the value's kind fits the role and the role's `must` terms are yes. The protagonist binds only to a role with `v: 'may'`, and only from an event in which it takes part as `actor`, or from an S2 fill (an offer's `participant`, a response's `actor`, a promise's `promiser`).
3. Every `requires` term is yes; a term with unbound variables binds them by a bounded state query (§6.4). A `maybe` counts as no.
4. If `j.fill` is fixed, the filler is one it names: of a named kind or tag; minted by the named seed's beat or its end (`mintedBy`); or a story event of the named pattern and outcome. A preferred `fill` doesn't restrict matching: the world may fill a juncture in a way nobody preferred. Preferences steer only what the director realises.
5. For a `story` juncture: the story event's pattern is the one named, it is not the instance's own and not in its lineage, and its depth is below `lineageDepth` (§6.6).

**Where a filler came from** (`source`, kept with the filler; the pattern language §8.1). Let `s` be the seed behind the filler: the event's creator, if it is a seed; else the seed whose role frame is the parent of the event's `served` frame (S1-3); else none.
- `nudged`, if `s` is a nudge (S2 §2.25);
- `offered`, if `s` was sown by the director for a juncture (`growsFrom.instance`), or the filler is the protagonist's response to one of its offers;
- `found`, otherwise: the world's own act, an authored seed's event, or the protagonist's own act.

`found` and `offered` fills are **consequences**; `nudged` and `constructed` fills are **adaptations**, logged as such and never presented as consequences ([dossier 9](../craft/d09-agency-consequence.md) R5-23, AGY-42).

**Death.** When an event reports a death (a `kill` effect, or `game.death`) of a person bound in the acting argument (the first argument of kind `actor` or `person`) of an unfilled juncture of an open instance, that juncture is foreclosed.

The matcher **does not fork**. A juncture takes the first filler that passes, in the orders of §3.1, and alternatives a forking matcher would keep are lost ([pattern language §12](../composite/pattern-language.md#12-alternatives-considered); C-S3-16).

### 6.4 State queries and link tests

**Bounded state queries** ([pattern language §6.2a](../composite/pattern-language.md#62a-bounded-state-queries)). A state juncture, or a `requires` term, may name variables nothing has bound yet: `squeeze.rule` requires `member(?col, ?pw)` when only the collector is in the event. A bounded state query binds them.
1. **When.** At instance start, after the advancement; and again whenever a match binds a new variable. It covers every unfilled state juncture, and every `requires` term, with at least one bound argument.
2. **Where it may look.** Only along an index the kernel or S1 keeps from a bound argument: a state rule's `search` from an argument in the function's `searchFrom`; a relation from its first bound argument, where its read keeps an index (membership, ties, holders, a frame's actor, a group's intention). A term with no searchable bound argument is `maybe`, so no: its variables must come from an entry or an earlier juncture.
3. **Candidates and choice.** The query lists at most `stateCandidates` records **[tunable 8]**, in record `Id` order. The first for which every other requirement of the juncture or term holds binds the variables (and, for a state juncture, fills it, with its incoming links tested). The order is total, so the choice is deterministic and needs no draw. If none passes, the juncture stays as it was, or the term is no.
4. **Cost.** One bounded read per term per binding event, counted in the tick budget.

A debt that existed before its demand is a legitimate past, and the query finds it from the debtor; the guard of a struck ward is found along the ward's membership.

**Link tests.** Each link other than `forecloses` is tested when its later juncture is tried, against the recorded filler of the earlier one. `walk(f)` is the breadth-first walk over `causesOf` (§1.2) from filler `f`, at most `causeHops` steps **[tunable 3]** and `causeWalkMax` records.

| Link | Holds when |
|---|---|
| `because` | `walk(later)` reaches the earlier filler |
| `motive` | The later filler's acting argument held a frame or belief whose `cause` or `evidence` is the earlier filler, or reaches it within `causeHops`: the later event's `served` frame, the later state filler's frame, or one of the actor's beliefs (at most `stateCandidates`, by its believer index) |
| `enables` | The earlier filler is a state and `holdsAt(earlier, later.at)` is yes; or it is an event no later than the later filler, and `walk(later)` reaches it, or a record that a `requires` term of the later juncture read has the earlier event as its cause |
| `but` | The earlier filler served a frame (an event's `served` frame, or a frame filler itself), and an effect of the later filler violates an interest of that frame under the conflict table ([S0 §10.8](kernel.md#108-effects-and-cross-pressure)) |
| `reveals` | The later filler's acting argument witnessed the earlier event, or the later filler is a `tell` or `expose` whose subject is the earlier filler, or (through S0-3) the actor holds a belief whose evidence includes it |
| `answers` | The later filler is a response, a refusal or a compliance whose direct `causes` include the earlier filler; or the protagonist's response to an offer whose delivery cites the earlier filler (S2 §10.2) |
| `order` | The stage form only (§2.2b): the later filler's time is not earlier than the earlier's |

**The protagonist's acts.** Where the later juncture is filled by an act of the protagonist's, every link into it is tested as `answers`: the act responds to an offer or a delivery that cites the earlier filler. The engine never reads the protagonist's reasons ([D-09](../decisions.md)).

**Links into a juncture matched early.** An entry juncture, or one filled by a state query, may be matched before the junctures with edges into it: a demand can start a debt instance before the debt itself is found. Those edges are tested when their sources match, against the juncture already matched, and a source whose link fails does not match.

**Near misses.** When the fill test succeeds but a link fails, the juncture stays `ready`, and the miss is logged (`near-miss`, with the failing link). In the core a near miss is only logged; back-fill, which would construct the missing step, is a later capability (§7.11). The director never asserts a link without a recorded step that bears it out.

### 6.5 Outcomes, ending, the boundary step and tombstones

**Outcomes** are checked after every match, in declaration order. The first whose `reached` junctures are all matched or refined, and whose `foreclosed` junctures are all foreclosed, applies:
- with `after`: it is **armed** (`armed = { outcome, since: now }`), unless an outcome is already armed. It applies at the first boundary step at which `now ≥ since + after` and no other outcome was fixed meanwhile; an outcome fixed meanwhile disarms it;
- otherwise it is **fixed**: `outcome` is set, the story event is minted (§6.6) and the tombstone written; the instance moves to `aftermath` if the outcome lists aftermath junctures (`aftermathUntil = now + (days ?? aftermathDays) × 86400`), and otherwise closes as `resolved`, or as `parked` if the outcome's kind is `parked`.

In `aftermath`, only the outcome's aftermath junctures can match; the instance closes when they have all matched, or at the first boundary step past `aftermathUntil`.

**Foreclosure.** A matched juncture's `forecloses` edges foreclose their targets at once; that is their only effect. A juncture whose acting person has died is foreclosed (§6.3). When no outcome is reachable any more (each has a reached juncture foreclosed), the instance ends.

**Ending without an outcome** (the deadline passed, an `unless` struck, nothing reachable): `parked` if the protagonist perceived any of its junctures (§6.7), with a story event minted as if a parked outcome named `@parked` had been fixed; otherwise `lapsed`, silently.

**The boundary step.** At each simulation window boundary ([S0 §9.4](kernel.md#94-evolution)), at every tempo, `off` included, in `seq` order, the matcher applies what time decides: open instances past `firstTime + within` end; armed outcomes that are due are fixed; aftermath windows that are due close; forming instances whose bound people have become known go live. **Deadlines are checked where they are used** as well (§6.3, §7.3): an instance past its deadline is never advanced, ranked or realised, whether or not its boundary step has run. Its ending, and anything that ending mints, happens at the boundary step, so that it falls at the same point however ticks fell. A deadline has passed when `now > deadline`; at equality it has not.

**A tombstone is written on every path that ends an instance of a pattern with `once`:**

| Path | `until` |
|---|---|
| An outcome fixed | `lastTime + tombstoneSpans × within` |
| Killed by `unless` | the killing occurrence's time `+ tombstoneSpans × within` |
| Ended at its deadline, or with nothing reachable | `firstTime + (1 + tombstoneSpans) × within` |
| Its told candidate dropped for refusals (§7.6) | the game time of the drop `+ tombstoneSpans × within` |

A tombstone is **in force** while `now ≤ until`. An instance that is evicted, or dropped because its pattern changed, writes none. A pattern without `once` writes none.

**The sweep** runs after the boundary step, and only reclaims storage. It removes terminal instances once `now > outcome.at + candidateTtl` (or their end time, if they had no outcome), or once their told candidate was sown, provided no closing is `needed` and no live seed realises one of their junctures; and it prunes tombstones past `until`. No decision depends on it having run.

**Tempo `off`.** The pattern frames are closed, so no instance starts or advances. The boundary step and the sweep still run, so instances end by their deadlines as usual. What would have matched while `off` is lost.

### 6.6 Composition: story events, chains, layers and shapes

Every composition is found by the matcher alone. There is no catalogue of which pattern joins which: a pattern's `links` and an outcome's `next` are hints for authors, the lint and evaluation, and the matcher never reads them.

**Story events.** When an instance fixes an outcome, or parks (§6.5), the matcher mints one inert **`meta:story`** event, with id `H("mint", director, instanceId, "meta:story")`:
- creator `director`; time the moment the outcome was fixed or the instance parked;
- participants the bound variables, `role` the variable's name without `?` (the protagonist included, where bound);
- `causes` the filler events of its matched junctures, and the cause events of its state fillers (`causesOf`), at most `maxJunctures`;
- no effects; no witnesses;
- the S0-1 data slot (assumed, §13.3): `story: { pattern, instance, outcome, kind, depth }`, with `outcome` the outcome's name (or `@parked`), `kind` its kind, and `depth` the instance's.

It fills the function `story(pattern, outcome)`. It is kept alive as the instance's other events are (§9.2). A lapsed instance mints none. v0.5's completion event is the stage form's case of this.

**Story junctures and lineage.** A `story` juncture is filled by a story event of the pattern it names, with its `binds` mapping the story's participants (by role name) onto this pattern's variables (`anyParticipant`: the first person among them). An instance's **depth** is 1, or 1 plus the greatest depth among the story events it matched. An instance never matches a story event of its own, or one whose causes reach (within `lineageDepth` steps over story events' `causes`, at most `causeWalkMax` records) a story event of its own, and never one of depth `lineageDepth` or more **[tunable 4]**. So chains are acyclic and at most four story events deep.

**Chaining** has two forms, both already in the record:
- **a shared filler:** the juncture that ends one instance is the entry of another. A debt broken by a recorded `wrong` and a grievance that starts from that `wrong` share the filler. No mechanism is needed;
- **a story event:** a closure or a shape matches the story event of a smaller instance.

Chained instances belong to one thread (§5.7).

**Layering.** When one filler fills junctures of two or more pooled instances, they are **layered** on it. At each match, the matcher looks up, in an index from filler id to instances, the other instances that used the filler, and records a `layer` entry on each side (at most `maxLayers` per instance, the first ones kept). A layer becomes **cross-causal** when a later juncture of one instance is filled by something the other produced: when `walk` from the later filler reaches a filler of the other instance (`cross` records the juncture and the time). Only cross-causal layers join threads (§5.7) and count in F-13 (§7.4). Layers form only through what the record holds, never through a coincidence the director invents.

**Shapes** are patterns whose junctures include `story` junctures (`heist`, `feud`, `hunted`, `uprising` in the v0 library). They **only recognise** (S3-I-26):
- none of their junctures has a `realise` list (S2 L-151), so the director never offers, nudges or constructs a shape's own juncture, and a shape can never run as a whole plot. It works only on the smaller instances that fill a shape, each under its own gates;
- a shape instance becomes `live` only when at least two of its filled junctures were perceived (for a `story` juncture: its child instance counts as a thread, §6.7) and the thread holds a pull on at least one of them (§5.7). Until then it stays `forming`;
- at most `maxLiveShapes` shape instances are live; another stays `forming`;
- a live shape adds to the ranking of the candidates that would advance it (F-15, §7.4), names the thread's shape in its skeleton (§6.8), and chains through its own story events.

Growth therefore follows the protagonist's attention, not the engine's ambition ([dossier 8](../craft/d08-scale-threads-time.md) GRW-01 to GRW-04).

### 6.7 Legibility

An invisible cascade is no story ([pattern language §9](../composite/pattern-language.md#9-legibility); [dossier 20](../craft/d20-staging-legibility.md)). The **legibility ledger** says what of an instance the protagonist could see. It keeps one thing per juncture, and derives the rest.

**Perception** (kept). A juncture is **perceived** when its filler reached `presented` or above: for an event filler, `Layer2View.exposure(event)` (S2 §10.1a: V took part, V observed it, or a delivery citing it was shown); for a state filler, the exposure of its cause event, if it has one, else never; for a `story` juncture, when its child instance counts as a thread. At each refresh, every matched juncture of a pooled instance that is not yet perceived is checked, and a newly perceived one is stamped `perceived = { at: exposure.at, play: playNow }`. The stamp is saved with the instance (§9.2); everything else here is derived from the record and the receipts, so it is the same after a load.

**Edges** (derived). An edge, not counting `forecloses`, is **shown** when both its ends are perceived and a **link sign** of it reached the protagonist:
- **told:** a delivery at `presented` or above whose `cites` include both fillers' events; or an offer whose delivery cites the earlier filler, answered by the protagonist's act that fills the later juncture;
- **own act:** the earlier filler is an act of the protagonist's (V took part as `actor`), and the later is perceived ([dossier 10](../craft/d10-change-theme-payoff.md) PAY-12);
- **asked:** a "why" answer the protagonist pulled that walked the edge (S2 §2.21; a later capability).

An edge marked `shown: 'must'` needs at least two signs of different kinds: told signs on channels of different modality (S2 §2.12) count as different kinds, and own act is a kind of its own ([STG-03](../craft/d20-staging-legibility.md), [DIR-46](../craft/d07-direction-pacing.md)).

**An instance counts as a thread** for the protagonist when all its `show.junctures` are perceived and at least `show.edges` of its edges are shown. Until then it is world texture, which may still be told as a rumour.

**Legibility debt** is the number of edges whose two ends are matched, whose source is perceived, and which are not shown. The director never realises a juncture of an instance whose debt is above 1 (gate 11, §7.3): it surfaces a cause first (a surface candidate, §7.1), or waits. The causes really exist; the director chooses only what to reveal and when ([DS-24](../design-seeds.md)).

**The other rules of the pattern language's §9.2** are carried by S2's existing constructs: a juncture the protagonist needs in order to choose rides a `mustReach` beat (S2 L-63); "name the act, once" is S2's callback rule; three routes to a needed conclusion are S2's `conclusion` beats (L-26); anchored hooks are L-67; why answers follow S2 §2.21.

### 6.8 Thread skeletons and the ring

A thread's **skeleton** is computed from what the protagonist perceived ([pattern language §14.1](../composite/pattern-language.md#141-the-thread-skeleton)). It serves the sower's diversity term (§7.4) and M3's repetition measures (P9).

**Tokens.** One token per perceived **occurrence**, not per juncture: an occurrence that fills junctures of several of the thread's instances gives one token. The occurrences are:
- every perceived filler of the thread's instances, except `story` fillers (their children give their tokens);
- every `offer` and `response` event of the thread's seeds (a `promise` restates the response it comes with, and gives none);
- every delivery of the thread's seeds at `presented` or above that cites no occurrence already counted, if `beatFunction` (S2 §10.1a) gives its beat a function.

They are ordered by the game time of perception (a stamp's `at`, an event's time, a delivery's `at`), then `play`, then id. Each token is **canonical**, a function of the occurrence alone:

```
token = fn(mask, mask, …) [<link] [/stance]
```

- `fn` is the first function, in the vocabulary's `tokenPrecedence`, among all the functions the occurrence's kind fills (`fills(kind)`, whatever their `when`), or the function its state rule filled, or the beat's function;
- the arguments are that function's, in declared order, each **masked**: `P` the protagonist; `K1`, `K2` … persons the protagonist had perceived before the thread began (`exposedNodeAt(person, 'presented')` earlier than the thread's first token); `N1`, `N2` … other persons; `G1` … groups; `I1` … items; `L1` … places; numbered by first appearance in the thread. Arguments of kind `event` or `fact` are left out. Every name, faction, place, item, price and wording is masked;
- `<link` is the strongest link, in the order `because`, `but`, `motive`, `reveals`, `enables`, `answers`, among the edges that join a juncture this occurrence fills to a juncture an earlier token's occurrence fills, in any of the thread's instances;
- `/stance` is the stance class of a `response` (`help`, `bargain`, `oppose`, `refuse`; a decline is `refuse`).

When every member of the thread is terminal, the skeleton ends with `end:<kind>/<pattern>`: the outcome kind and pattern name (without its namespace) of the instance that ended last, or of a seed's implicit pattern (`seed:<template>`). The thread's **shape** (its L1 level) is the list of its instances' patterns, and seeds' `seed:<template>`, in order of first perception.

**The skeleton ring** (persisted, §9.2). At most `skeletonRing` entries **[tunable 32]**, one per recent thread: `{ thread: Id; tokens: Id[]; play: number; seq: number }`. `tokens` are `H("tok", t)` for the first `skeletonTokens` (8) tokens `t` written **without** their `/stance`, so that a prediction, which can't know the stance, compares with them. At each refresh, after the thread view, every thread whose stance-free token list differs from its ring entry gets its entry written or replaced, with `play = playNow` and `seq` the next value of the persisted counter `skeletonSeq`; then entries beyond the cap go, lowest `seq` first. Entries outlive their thread's instances in the pool. A merged thread keeps its lowest member's `Id`, and the entry of the absorbed thread stays as a record of what was seen. The ring is updated in the refresh that precedes the slot procedure of the same tick, and saves are taken only at tick boundaries (§9.4), so a decision never ranks against a ring that a reload would not reproduce.

**For evaluation only**, the decision log records each thread's full tokens, stances included, whenever they change (§10). Ranking never reads the log.

## 7. The sower

Sowing turns what the world already holds into seeds, at a rate the player sets. Its rule is **selection over generation**: the world is simulated, the record is matched, and the sower chooses what to tell, what to surface and which open juncture to help along. It invents no story. Its vocabulary is the packs' sowable templates and patterns. The engine ships a small starter pack (S4, open question 11 of P5) so that a world with few packs still has rumours and recaps to tell.

### 7.1 Candidates

A candidate is one thing the sower could do with one instance (§6.2). There are three kinds (v0.6; v0.5 had only the first):

| Kind | What it is | Realised by |
|---|---|---|
| **told** | An instance whose outcome is fixed, whose pattern has a `tell`, within `candidateTtl` of the outcome | A seed of a kit serving the telling's form, as v0.5 told a completed match |
| **surface** | A matched juncture of an open or `aftermath` instance whose filler is an event the protagonist hasn't perceived (§6.7): at most `maxSurface` (2) per instance, the earliest by filler time | A telling kit (`rumour`, `sighting` or `recap`) whose `tells` role binds the filler: a cause shown before the story goes on |
| **realise** | A `ready` juncture of a `live` instance of a pattern that isn't a shape, whose realisation is legal (§7.5): an **offer**, or a **nudge** | A seed of a kit whose `fills` include the juncture's function |

A juncture that is `pending` (a director-sown seed works towards it, or a live seed realises it, §5.7) is no candidate. Other sources (loose ends, promotion subjects, fronts, ambient texture, pulls) are later capabilities (§0.3).

```ts
interface Candidate {
  key: Id;                                // §3.2, by kind
  kind: 'told' | 'surface' | 'realise';
  instance: Id; pattern: string;
  juncture?: JunctureKey;                 // surface and realise
  realisation?: 'offer' | 'nudge';        // realise only (§7.5)
  form: Form | 'nudge';                   // the form its kit must serve: the telling's form; 'rumour' for a surface; 'offer' or 'nudge'
  thread?: Id;                            // the thread it would join (§5.7)
  opens: boolean;                         // its thread is not aware: it would open one (§5.8)
  features: Record<FeatureId, number>;    // §7.4
  place?: Id;                             // the first bound place, in variable order
}
```

Candidates are collected in instance `seq` order, then juncture key order. Each candidate's kits are its alternatives (§7.5).

### 7.2 The slot procedure

The schedule (§5.9) has one pending slot, `k = slots.open.next`. Each second, after the director's tick and the refresh, the sower runs the procedure below. **It reads only branch-persisted state** (the record, the pool, the skeleton ring, settings, the thread counts, `playNow`) and **never the pacing phase or the play clock**. A slot is resolved once, at its time, and is never retried. So a load changes when a seed is *shown* (the hold hook, §5.4) and not which seed is sown.

```
while (k + 1) · I ≤ playNow:                   // the window ended unresolved: only when the pointer was behind
    log slot-lapsed(k); k += 1
if playNow < time(k): return                    // not yet
resolve slot k:
    if not live(k, tempo):                          log slot-passed
    else if time(k) < schedule.gentleFirst:         log slot-gentle           // first ten minutes
    else if playTotal < openLockUntil:              log slot-locked           // the arc lock (§5.2)
    else run the slot (below)
k += 1                                           // with the sowing step's commit when it sowed (§7.6)
```

`tempo` is the setting in force when the slot is resolved.

**Run the slot.**
1. Collect the candidates (§7.1). If the counts violate the budgets (§5.8: `A ≥ maxAttended` or `L ≥ maxLive` or `S ≥ maxSimmering`), keep only the candidates that continue an aware thread, and nudges; if none is kept, log `slot-budget`; done. Apply the gates (§7.3). If none remains: log `slot-empty(k)`; done.
2. Compute features, bands and scores **once** (§7.4). The scores are frozen for this slot.
3. Choose one candidate (§7.4). Try it (§7.5, §7.6).
4. If every kit tried was refused: the candidate gets the refusal (§7.6) and is removed from this slot's set. **The scores of the rest do not change.** Choose again among them. At most `maxCandidateTries` candidates are tried per slot.
5. On success: record it in `recent` (§9.2), log `sow`, done. A slot sows **at most one seed**, so the director takes at most one realisation per slot, across all instances.

A slot that finds nothing is spent: there are no owed pushes in the core.

### 7.3 Gates

**Gates come before scores.** A candidate that fails a gate is not ranked. The sower records which gate failed. `now` is the current game time. Gates 6 to 8 are tested per kit: a candidate whose kits all fail them fails gate 2, and the first gate that failed is logged. Let `bound` be the instance's bound values that are persons, groups or places, the protagonist left out.

| # | Gate | Applies to | Why |
|---|---|---|---|
| 1 | **Alive.** The instance isn't past its deadline (an open one: `now ≤ firstTime + within`; a told one: `now − outcome.at ≤ candidateTtl`), and every filler event it would bind is retrievable | all | Deadlines are checked here, before ranking. Neither the boundary step nor the sweep is relied on |
| 2 | The candidate has at least one eligible kit (§7.5) | all | Nothing to sow otherwise. Content ceilings and floors are layer 2's, applied by the sowing request itself (§7.6) |
| 3 | **F-1, a reportable change:** some filler event has at least one effect. **F-12, a showable cause:** for forms other than `rumour` and `sighting`, the latest filler event has non-empty `causes` | told | Causality |
| 4 | **F-4, a human at the centre:** some bound value is a person or a group, and the kernel still has it | all | Tellability |
| 5 | **V-link.** The protagonist took part in a filler event, or some value in `bound` is `exposedNode(·, 'presented')`. Without it, a told or surface candidate is eligible only in the forms `rumour`, `recap` and `sighting`, and a realise candidate only as a nudge | all | A chain about people V has never met stays world texture |
| 6 | **Stake, level and a gentle start.** The kit's `stakeScale` is at most `block`, its level at most `maxLevel`, and `firstClass` passes the first-hour rule: not `≥ 1` before `playTotal ≥ gentleFirst`, not `> 1` before `gentleHour` | all but nudges | Bounded dooms; a gentle start |
| 7 | **Exclusions.** No `exclusions` or `softExclusions` entry matches the kit's tags, its skeleton `verb`, a content class its envelope names, or any node the overlay binds | all | A stated setting overrides everything |
| 8 | **Budgets.** If the candidate `opens` a thread, the counts of §5.8 are within the budgets. If the kit is `climactic`, `C < maxClimactic` | all but nudges | Pacing |
| 9 | **Spine.** No node the overlay would bind `isSpine` | all | No process rewrites the main story's characters |
| 10 | **Not already sown.** `layer2.sownBy(decision)` is empty for `decision = H("sow3", worldSeed, cand.key)`, and the candidate's cooldown has passed (§7.6) | all | Idempotence; no re-offer after a decline |
| 11 | **Legibility debt.** The instance's debt (§6.7) is at most 1 | realise | Never stack an unseen cause on another ([pattern language §9.2](../composite/pattern-language.md#92-rules)) |
| 12 | **Escalation.** If the juncture is in the pattern's `escalation` list, the escalation gate passes (§7.9) | realise | Escalation is earned |
| 13 | **Nudge legality.** For a nudge: the pattern's `latitude.nudge` isn't false; no argument of the juncture is bound to the protagonist, and no role that allows the protagonist is among its arguments (S2 L-159); the juncture has been ready for at least `nudgeAfter` game seconds **[tunable 21600]**, so the world gets the first chance; fewer than `maxNudges` nudges are live (§7.7). Layer 2 checks the rest at the nudge's silent start (S2 §2.25) | realise by nudge | [DS-05](../design-seeds.md): the director steers only through the unobserved |

Gates 7 and 9 look only at the nodes the overlay binds. For roles that layer 2 fills by casting, S2 §5.2 step 4 removes spine characters and excluded NPCs from the candidates of **every** role of a director-sown instance, and ladders cannot relax it. The gates here only save a request that would fail.

A "betrayal" or "turn" seed counts against S1's betrayal budget when S1 defines one; that is S1's check, made at casting.

### 7.4 Ranking and the draw

At a live slot the sower ranks the candidates that passed, then draws. **All scores are computed once, here, and frozen for the slot.**

**The features** (kept raw in the log). `H = timelyH`; the filler events are those of the instance's matched junctures.

| # | Feature | Value |
|---|---|---|
| F-3 | Stakes | The number of distinct `(on, effect)` pairs over the filler events with `effect ∈ sower.harmful` |
| F-5 | Personal link | `#{ x ∈ bound : exposedNode(x, 'presented') }`, plus 2 if the protagonist took part in a filler event |
| F-6 | Irreversibility | The number of distinct `(on, effect)` pairs over the filler events with `effect ∈ sower.irreversible` |
| F-11 | Timeliness | `H / (H + max(0, now − lastTime))` |
| F-13 | Cross-causal layering | The number of the instance's cross-causal layers (§6.6) with instances whose thread is aware |
| F-14 | Known people at stake | The persons in `bound` that the protagonist has met (`exposedNode(·, 'presented')`) and that are the `on` of a harmful effect of a filler event, or are bound in an argument of the candidate's juncture other than its acting one ([D-27](../decisions.md): what matters to the people the protagonist knows) |
| F-15 | Open leverage | For a realise or surface candidate: the number of the pattern's outcomes still reachable (none of their reached junctures foreclosed), plus one for each live shape instance in the same thread with a ready `story` juncture that names this candidate's pattern. For a told candidate: 0 ([TEL-09](../craft/d06-sifting-tellability.md)) |
| F-16 | Legibility | For a realise or told candidate: the share of shown edges among the instance's edges whose ends are both matched (1 if there are none). For a surface candidate: one minus that share, so that surfacing ranks highest where the instance is least legible |

**1. Features to bands.** For each feature `F` above: if every candidate has the same value, the feature is **skipped**. Otherwise rank the candidates by value, descending, ties by `key` ascending: rank `r` = 0 for the best, `n−1` for the worst. The band is `band = 2 − floor(3·r / n)`, in {0, 1, 2}. The raw values stay in the log.

```
composite(c) = ( Σ_F w_F · band_F(c) ) / ( 2 · Σ_F w_F )          over the features not skipped; 0.5 if none
```

with `w_F = sower.featureWeights[F]`: 1 for each, except F-14 at 2 **[tunable]**, after D-27's direction that the ranking favour what matters to the people the protagonist knows. The composite lies in [0, 1].

**2. Diversity.** `dup(c)` is the number of entries in `recent` whose `pattern` equals `c.pattern` plus the number whose `place` equals `c.place`. **Skeleton diversity** (v0.6): let `p(c)` be the stance-free token list the candidate's thread would have if it went ahead: the thread's tokens so far (§6.8), or none for a thread it opens, followed by the candidate's **predicted token**. For a realise candidate that is the juncture's function over its bound arguments, masked as §6.8 masks them (an unbound argument as `?`), with the strongest link among the edges into it from perceived junctures. For a surface candidate it is the surfaced filler's token, and for a told candidate the thread's end token. `skel(c)` is the number of ring entries, other than the thread's own, whose first `len(p(c))` hashes equal those of `p(c)` (with `p(c)` cut at `skeletonTokens`).

```
score(c) = sower.lambda · composite(c) − sower.diversity · dup(c) − sower.skeleton · min(skel(c), sower.skeletonCap)
```

So a candidate whose thread would go on as a thread the protagonist recently saw went on is penalised, and the first ask of a new thread is penalised by how many recent threads began with an ask ([pattern language §8.4](../composite/pattern-language.md#84-choosing-what-to-act-on)).

**3. The draw.** By §3.3, `keyName = "s3-pick"`, `keyArgs = ["open", k]`, `o.key = c.key`. The band composite only tilts the draw, so the top candidate does not win every time. No fitted formula decides an offer.

**4. After a refusal,** a refused candidate is removed and the draw is run again over the rest **with the same scores**. Bands are not recomputed. So a removed loser never changes the winner.

**5. Authored first.** If an authored seed and a sown one want the same node, S2's claim priority decides ([S2 §9.2](seeding.md#92-settling)) and the authored seed wins (S2-I-10). The sower never sows to contest.

### 7.5 Realisation and kit

**Which realisation** (realise candidates). A juncture's `realise` list, or, absent one, the default `[{ wait }, { offer }, { nudge }]`, is read in order, past `wait`; skipped entries (`construct`, `refine`, §7.11) are passed over. The candidate takes the **first legal entry**:
- **offer** is legal when the juncture is `v: 'offer'`, or is an `ask` whose `of` argument may be the protagonist; the V-link holds (gate 5); and the tempo isn't `off`. The protagonist's own act fills such a juncture: a response, or a decline, a null path or a lapse, which fill the refusing side or the world's settling. Nothing is filled by assumption;
- **nudge** is legal when gate 13's static conditions hold.

If no entry is legal, the juncture is no candidate: the director waits.

**Eligible kits:**
- **told:** the telling's `kit`, if named; otherwise every sowable template whose `serves` includes the telling's form and whose roles include every key of `binds`;
- **surface:** every sowable template serving `rumour`, `sighting` or `recap` that declares `tells`, the form being the first of those it serves in that order;
- **realise:** the realisation's `kit`, if named; otherwise every sowable template that serves the realisation's form (`offer` or `nudge`) and has a `fills` entry for the juncture's function. An argument of the juncture bound to the protagonist must be mapped to `'v'` by that entry; an argument bound to a node must be mapped to a role;

each filtered by the template's sowable load checks and by gates 6, 7 and 8.

**The bounded order.** Choose by §3.3 with `keyName = "s3-kit"`, `keyArgs = [cand.key]`, `o.key` the template id, and

```
score(kit) = ln(kit.weight ?? 1) − sower.kitDiversity · [kit ∈ the last recentKits kits sown]
```

Scores are frozen with the kit set. If the request for that kit is refused (§7.6), remove the kit and choose again. Try at most `maxKitTries` **distinct** kits, in the order the draws give. If the last attempt is refused, or no eligible kit is left, the candidate gets **one** refusal (§7.6). A candidate is therefore refused once per slot attempt, however many kits were tried.

### 7.6 Instantiation and the sowing request

1. **Choose the kit** (§7.5).
2. **Build the overlay.** Fix what the instance already bound:

```ts
interface SeedOverlay {
  roles: Record<RoleKey, { identity: Id }>;     // each is a fixed identity (S2 §2.2)
  growsFrom?: { instance: Id; juncture: JunctureKey };   // v0.6: surface and realise candidates (S2 §2.13)
}
```

   - **told:** for each `binds` entry, `roles[kitRole] = { identity: bindings[variable] }`, with `?story` the instance's `meta:story` event and `?end` its latest filler event by time;
   - **surface:** the `tells` role takes the surfaced filler event, and, if the kit has a `fills` entry for the filler's function, each argument's role takes the filler's argument (the protagonist left out); `growsFrom` names the instance and juncture;
   - **realise:** for the kit's `fills` entry for the juncture's function, each argument bound to a node gives `roles[args[a]] = { identity: node }`; an unbound argument is left for the kit's own casting; the entry's `cause` role, if any, takes the filler event of the source of the juncture's strongest incoming edge (in the link order of §6.8, ties by edge order), if that filler is an event; `growsFrom` names the instance and juncture.

   **The overlay can change nothing else:** no durations, `must` terms, persistence flags, timing or `stakeScale`. S2's defaults for persistence ([§2.5](seeding.md#25-facts-world-requirements-effects-and-dependencies)) and timing ([§2.12](seeding.md#212-timing-requests): `onExpire: 'unattended'` for procedural seeds) already do what P5 wanted. S2 refuses an overlay that replaces a fixed identity or a profile's fixed part with a different node (S2 §1.3). Binding an event to a kit role makes every delivery that binds it **cite** it (S2 §10.2), which is how a seed shows the filler and the link it continues (§6.7).
3. **Fill the open parts.** Nothing is done here in the core. The seed's open parts are filled by layer 2's casting and draws, which call the fit hook (§4), and which apply the source filters of S2 §5.2 step 4. A sown seed is fitted exactly as an authored one is.
4. **Sow** with the request below.

```ts
interface SowRequest {                           // story.seed@1, from the procedural engine
  template: TemplateId; pack?: string;
  overlay: SeedOverlay;
  localName: string;                             // the first 16 hex characters of cand.key
  decision: Id;                                  // H("sow3", worldSeed, cand.key); H("close3", …) for a closing (§7.7)
}
type SowResult = { ok: true; instance: Id; existing: boolean } | { ok: false; findings: Finding[] };
```

Layer 2 applies the overlay ([S2 §1.3](seeding.md#13-sowing-authored-templates)), **lints** the result at the template's maturity, and mints the instance or refuses it ([§3.1](seeding.md#31-the-steps)). The instance `Id` follows [S2 §1.2](seeding.md#12-instances): creator `director`, cause `decision`, name `"seed:" + template + ":" + localName`. **Sowing is idempotent:** the same request finds the same instance (`existing: true`).

**What the seed does with it.** A seed sown from an instance is a normal seed. Its fragments read the bound events through ordinary role predicates, and `trace` walks from the seed to every event it binds. When it casts an event, its cast edge keeps the event alive (S2 §5.3). The juncture it was sown for is filled, if at all, when the matcher sees the occurrence the seed leaves: the protagonist's response to its offer, an event its beat mints, its `seed-outcome` through a `realises` entry (S2 §2.24), or, for a nudge, an act the simulation produces for the goal the nudge opened (S1-3). A stake line and a lead line belong to staging, not to selection, and are not carried.

**One sow, one commit.** The sowing step is one bounded operation. It runs inside a staged batch ([S0 §14.2a](kernel.md#142a-staged-batches-v46)), so that the instance and the layer-3 bookkeeping become visible and saved together:
1. open the batch;
2. send the request;
3. on `ok`: record the seed on the instance (`seeds`, §9.2); for a realise candidate set the juncture `pending` on it; add `{ instance, sownAt: playTotal }` to `nudges` for a nudge, and to `pending` for every other seed; push `{ pattern, kit, place, at: playTotal }` onto `recent`, keeping the last `recentSown`; set `slots.open.next = k + 1`; then **commit** the batch;
4. on refusal: **discard** the batch, so nothing remains but this step's own log. When no kit is left (§7.5), the candidate gets its one refusal: its `refusals` entry on the instance gains 1 and its cooldown runs to `playTotal + cooldown`.

At `maxRefusals` a told candidate is dropped for good, with a tombstone (§6.5), and a surface or realise candidate is never collected again. A save is never taken inside the step (§9.4). If S2 cannot run its side inside a batch, the repair of §9.3 gives the same guarantee afterwards.

**A decline stays a decline.** The decision id names the instance and the juncture, and `sownBy(decision)` stays non-empty (gate 10), so a juncture the protagonist declined is never offered again, though the world may still fill it. When a seed sown for a juncture ends with the juncture unfilled, the juncture goes back from `pending` to `ready` (checked at each refresh).

### 7.7 Pending lifetimes, nudges and closings

**Pending seeds.** A director-sown seed other than a nudge is **pending** from its sowing until V is shown something of it. It may wait long, or for ever: sowing can succeed where casting later cannot fill a role, and a ladder with `wait: window` waits until the seed closes (S2 §5.4). So a pending seed has a **finite lifetime**, in cumulative play seconds. At each refresh (§1.1), for each entry of `pending`, in order:
1. If the instance is gone, terminal, or has any `displays` entry: remove it from `pending`. It is no longer pending.
2. Otherwise, if `playNow − sownAt > pendingLifetime` (3600 play seconds **[tunable]**): withdraw it with `story.withdraw@1`, remove it from `pending`, and log `withdraw` with the reason `pending`.

**Nudges.** At most `maxNudges` (3) nudges are live at once (gate 13). At each refresh, for each entry of `nudges`, in order: if the nudge is gone or terminal, remove it; if it is `running`, keep it until it ends; otherwise, if `playNow − sownAt > nudgeLifetime` (3600 play seconds **[tunable]**), withdraw it (`story.withdraw@1`, reason `nudge-lapsed`) and remove it. A nudge never counts in a thread or a budget (§5.7, §5.8).

```ts
interface WithdrawRequest {                      // story.withdraw@1
  seed: Id; reason: 'pending' | 'nudge-lapsed'; decision: Id;     // H("wdraw3", worldSeed, seedId)
}
```

Layer 2 treats a withdrawal as a **source withdrawal**: T1, `withdrawn` ([S2 §1.3](seeding.md#13-sowing-authored-templates), [§6.2](seeding.md#62-transitions)). V never saw the seed, so it leaves no residue; a delivery shown just as it happens still gets its closing trace, which S3-K-3 guarantees. Only a seed with `source.by = 'director'` can be withdrawn this way. The core has **no other withdrawal**, so a seed V has seen is never withdrawn. These checks run at every tempo, `off` included.

**Closings.** An instance that **counted as a thread** (§6.7) and then ends gets `closing: 'needed'`, unless every juncture its fixed outcome reached was perceived, so that the protagonist saw how it ended (`closing: 'none'`). At each refresh, at a tempo other than `off`, for each instance with `closing: 'needed'`, in `seq` order, the sower sows its **closing**: a kit serving `recap` with `firstClass` at most 1 and a role of kind `core:event` that requires `kind = meta:story`, chosen as in §7.5, with that role bound to the instance's story event, decision `H("close3", worldSeed, instanceId)`, under gates 2, 7, 9 and 10 only. Closings are not tied to slots and don't count in budgets, as S2's closing deliveries don't ([THR-12](../craft/d08-scale-threads-time.md), [RMB-02](../craft/d13-perception-curiosity.md)). Sown, it is `sown` and joins `pending`; with no eligible kit, the sower logs `no-closing` and sets `none`. A closing still `needed` `candidateTtl` after the instance ended becomes `none`, with the same log.

### 7.8 What the dial does

| Part | `off` | `calm`, `steady`, `restless` |
|---|---|---|
| Matcher | Frames closed: no instance starts or advances. The boundary step and the sweep run | Runs |
| Sower: told, surface and realise candidates; offers and nudges | Stops. Slots are never live | Runs at the rate of §5.9 |
| Closings | Not sown | Sown at each refresh |
| Pending and nudge lifetimes | Run (they only withdraw seeds the engine sowed and V never saw) | Run |
| Fitter, hooks, thread view, pacing state | Run | Run |
| Evidence log | Runs if `noticing` allows | Runs if `noticing` allows |

**The dial scales how much the engine sows. It never changes how a decline is handled.** For authored and already-sown seeds every rule on this page holds at every setting, `off` included. At `off` the sower offers and nudges nothing, while authored seeds' own realisations still play ([D-03](../decisions.md)).

### 7.9 The escalation gate

A pattern's `escalation` list names the junctures that raise the stake scale (person, crew, block, district) or the class of harm ([pattern language §8.5](../composite/pattern-language.md#85-the-escalation-gate)). Gate 12 lets the director realise one, by offer or nudge, only when all five conditions hold. `A` is the juncture's acting argument; the **previous rung** is the latest matched escalation juncture of the instance, or, if there is none, its earliest perceived juncture.

1. **Pull.** The thread holds a pull (§5.7) later than the previous rung's filler time: an action answering an offer in it, a `pull` delivery of it, or an act of the protagonist's on one of its people or places ([GRW-01](../craft/d08-scale-threads-time.md), GRW-03, [DIR-39](../craft/d07-direction-pacing.md)). A decline, a null path or a lapse is no pull. Pushes alone never climb a rung.
2. **Legibility.** The source of the juncture's strongest incoming edge is perceived, and every edge into that source whose ends are both matched is shown (§6.7).
3. **A wanting actor.** `A` is bound, and `want(who: A, what: x)` or `pursue(who: A, target: x)` holds now, by a bounded state query (§6.4), for some `x` bound in another argument of the juncture: a frame of `A`'s, or, for a group, one of its active intentions. Otherwise the director waits, and the world may never climb.
4. **A portent.** If another argument of the juncture is bound to the protagonist, to a person the protagonist has met (`exposedNode(·, 'presented')`), or to a node a stake of an answered offer in the thread names, then some juncture of the instance whose function is `threaten`, `pursue`, `demand` or `want`, with `A` as its acting argument, was perceived at least `portentLead` play seconds earlier (**[tunable 120]**), so the protagonist had time to answer ([AGY-23](../craft/d09-agency-consequence.md), [DIR-41](../craft/d07-direction-pacing.md)).
5. **Bounds.** The kit passes gates 6 and 8: stake scale at most `block`, level at most `maxLevel`, and the climax budget ([AGY-30](../craft/d09-agency-consequence.md)).

If any fails, the candidate is removed and the failing condition logged. The instance stays where it is, and ends by one of its outcomes, or parks at `within`. **This is where the director decides how far a thread escalates:** rung by rung, on the protagonist's pull and the world's own wanting actors, never towards a target length. Most threads stop low. That is intended: most errands should stay errands, and the ones that grow are the ones the player leaned into.

**The gate binds the director's realisations only.** A group acting against the protagonist under D-30 is the world's move (§7.10).

### 7.10 Groups acting against the protagonist

Under [D-30](../decisions.md) a group may decide, as an S1 process, to act against the protagonist (S1-10, assumed in §13.3; [S2 §2.16a](seeding.md#216a-groups-acting-against-the-protagonist)).

- **What the matcher sees.** The intention fills `decide(group: G, what: v)` when it starts, `pursue(who: G, target: v)` while it is active, `threaten(by: G, to: v)` through its warning act, and `wrong(by: …, to: v)` through its harmful acts. These are ordinary fillers. The `hunted` shape recognises the whole; its children (a grievance, a misattribution, a protection, a settlement) read the same records, and the protagonist binds their roles that allow it.
- **What the director never does.** It never nudges any part of it: a nudge never names the protagonist (gate 13, S2 §2.25), so no nudge can carry word of the protagonist's act to the group, open a goal against the protagonist, or put the protagonist in its way. It never realises a shape's juncture (§6.6). It never starts, raises, holds, extends or ends the group's intention: the group's rungs are S1's, bounded by S1-10's conditions (an observed act, a warning before harm) and the proactivity setting, down to none at `off`. The escalation gate (§7.9) doesn't apply to them.
- **What it may do.** Make the cause legible: surface candidates for the thread's unperceived junctures (the act the group blames the protagonist for, the telling that carried it to them) rank high on F-16 (§7.4). And offer ways out: offers that realise junctures of the child instances (a settlement on terms, a protection with the protagonist as ward, a misattribution cleared) are ordinary realise candidates, under every gate.
- **Delivery.** The warning is carried by an authored pack template (S2 §2.16a), so the hold hook treats it as any authored delivery: it may hold it for pacing, and relaxes at 70 per cent of `maxWaitPlay` (§5.4, rule 2). Holding the warning only delays the group's harm, because S1 holds every harmful act until the warning is `presented`.

### 7.11 Later realisations: back-fill and open

The pattern language's two other realisations are specified here so that their contracts are fixed. The first implementation skips them (S3-L-11).

**Back-fill** (`construct`): generate, then justify, for a past juncture ([GEN-06](../craft/d06-sifting-tellability.md), ledger C-01).
- **When.** A near miss (§6.4) whose missing link has an intermediate step that is unobserved: no `observed` pin, no confirmed exposure, nothing the protagonist did. The pattern's `latitude.construct` isn't false, and S2's `trace-cause` latitude allows it ([S2 §2.15](seeding.md#215-traces-and-plants)).
- **What.** A constructed cause, built by a planner over goal frames' effects of depth at most 2, never over the protagonist ([GEN-05](../craft/d06-sifting-tellability.md), [FIT-41](../craft/d03-fitting-casting.md)), contributed at the procedural layer through S2's constructed-cause path, so it goes through ordinary arbitration and can't contradict a pin. It is refused if it would contradict confirmed exposure or the protagonist's acts, and committed with `committed` pins once shown. Its fill has source `constructed`: an adaptation.
- **Needs.** Near misses persisted (at most two per instance, newest kept); S3's cause hook; and the ogre audit ([AGY-05](../craft/d09-agency-consequence.md)): replay with other protagonist acts and compare which junctures still fill.

**Open** (`refine`): a juncture filled by a smaller pattern, opened only when it matters to the protagonist ([pattern language §7.4](../composite/pattern-language.md#74-refinement-a-juncture-filled-by-a-smaller-pattern)).
- **The contract** (checked statically by S2 L-150). The realisation names the child pattern, the child outcome that fills the juncture, and a role map `binds` (child role to parent variable) that covers every argument of the juncture. The named outcome `produces` the juncture's function, with arguments that map through `binds` onto the juncture's, and every change the juncture declares follows from that function or is recorded by the child's reached junctures. The finer reading then agrees with the coarser one ([foundation §4](../foundation.md#4-rules), rule 2).
- **When.** The juncture's people or place are at a fine tier for the protagonist (the protagonist is there, or a bound person's `depth` is `open`). Otherwise the juncture is filled coarsely, by the world or a nudge, and told as news if at all.
- **How.** The director opens a child instance with id `H("child", parentId, juncture)`, its variables pre-bound through `binds` and no juncture matched; it then advances and is realised like any instance. The parent juncture becomes `refined` when the child reaches the named outcome, with the child's story event as its filler; any other outcome leaves it open, or foreclosed if that outcome forecloses it. Depth at most 3 **[tunable]**; children count in the pool and close with their parent. Never on a shape's juncture.

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
| Thread view and statuses | No (derived) | Layer 2's records and the pool, stamped with `playTotal` |
| The instance pool, with each juncture's perception stamp (§6.7), tombstones, the chronological buffer, the pending and nudge lists, the recent-sown ring | Yes | A cache: a save without them loads with an empty pool |
| The skeleton ring and its counter (§6.8) | Yes | A cache, like the pool: without it, diversity starts with no history |
| Edge legibility, legibility debt, thread-hood (§6.7) | No (derived) | The stamps, the receipts and the exposure ledger |
| The evidence log | No | S2's records |
| Settings | Yes (S0 `SettingsSet`) | Replay |
| Draws made through the fit hook | Yes, in layer 2's draw records | |
| Why a seed was sown, and for which juncture | Yes, in the seed's `source.decision` and `growsFrom` | |
| The decision log, the rivals ring and near misses | No (local, per session) | |

**Under S0's three persistence principles** (v4.16, [S0 §14.1](kernel.md#141-what-is-persisted)):
- **The save chain is append-only truth.** The layer-3 record is a `SeedRecord`, written whole as a `SeedState` op whenever it changed since the parent save, so every version a save held is in the chain. Nothing layer 3 keeps is a kernel record that a later save could silently rewrite.
- **Recovery is replay.** Every filler event and story event of a pooled instance is in `nodes`, a retention root, so the kernel keeps it, with its facts (v4.15), for as long as the instance needs it. A state filler is kept only as a copied descriptor (`FillerRef`, `args`, `at`); a later `holdsAt` reads the record anew, and if the record was swept, the read is what recovery restores. Bound people and places are bare `Id`s, which regenerate or recover by the kernel's own path when read.
- **A sweep drops only what recovery restores exactly.** Layer 3 sweeps only its own record (§6.5); the kernel never sweeps a root, and it releases an instance's events only when the instance leaves the pool.

### 9.2 The layer-3 record

One `SeedRecord` under `layer3Id` ([S0 §14.1](kernel.md#141-what-is-persisted), V4-7), written as a `SeedState` op when it changed since the parent save, like S2's global record.

```ts
// SeedRecord.state for the layer-3 record
interface Layer3State {
  schema: 2;                                          // v0.6; schema 1 is v0.5's (§9.3)
  slots: { open: { next: number } };
  nextSeq: number;
  openLockUntil: number;                              // playTotal: the arc lock (§5.2); 0 if none
  pool: Instance[];                                   // §6.2; in creation (seq) order; capped
  tombstones: Array<{ pattern: string; key: Id; until: GameTime }>;   // key: the tombstone key of §3.2
  buffer: Array<{ occurrence: Id; at: GameTime; emission: unknown }>;  // §6.1: held until the horizon passes
  pending: Array<{ instance: Id; sownAt: number }>;   // §7.7; playTotal at sowing
  nudges: Array<{ instance: Id; sownAt: number }>;    // §7.7
  recent: Array<{ pattern: string; kit: TemplateId; place?: Id; at: number }>;   // last recentSown
  skeletons: { seq: number; ring: Array<{ thread: Id; tokens: Id[]; play: number; seq: number }> };   // §6.8
}
```

| `SeedRecord` field | Value |
|---|---|
| `id` | `layer3Id` |
| `state` | `Layer3State` |
| `nodes` | The union of every pooled instance's filler events and story event: the retention roots. An instance's events stay until it leaves the pool |
| `actor` | Omitted. Layer 3's record is not a demand root. Its pattern frames are the director's, a demand root already |

**Bounds.** The pool holds at most `poolTotal` instances of at most `maxJunctures` junctures, so `nodes` holds at most `poolTotal × (maxJunctures + 1)` ids. `pending` is bounded by `maxLive` and the closings outstanding, `nudges` by `maxNudges`, `recent` by `recentSown`, the ring by `skeletonRing`, the buffer by the publication lag; tombstones are pruned at `until`. P7 measures the save size and the **closure that retention marks** from `nodes` (participants, places, causes) before any cap is fixed.

### 9.3 Loading

After the kernel replays a save and layer 2 rebuilds ([S2 §12.2](seeding.md#122-loading)), layer 3:
1. Reads the layer-3 record. **If it is absent, layer 3 starts empty** (the pool is a cache). Nothing else is lost; no error is shown. **A schema 1 record** (v0.5) loads its slots, arc lock, tombstones, pending list and recent ring, with an empty pool, buffer, nudge list and ring: its pool entries are not converted.
2. Reconciles with the loaded patterns: drops instances and tombstones of patterns no longer loaded, and instances whose `version` differs from the loaded one. Each drop logs `match-dropped`.
3. Opens the pattern frames (§6.1) for the loaded patterns.
4. Checks the pool against the events: an instance with a filler event that is not retrievable ends with `match-lost`. (Retention should make that impossible. It covers a damaged record.) Deadlines are checked at use (§6.3) and applied at the next boundary step, as in uninterrupted play.
5. **Repairs a split sow.** For each candidate of a pooled instance whose decision has `sownBy(decision)` not empty but which the instance's `seeds` don't list: add it to `seeds` (and set its juncture `pending`, for a realise candidate), add the seed to `pending` or `nudges` with `sownAt = playTotal`, and log `sow-repaired`. Drop a `pending` or `nudges` entry whose seed does not exist. The repair makes a half-recorded sow whole; it never sows.
6. Rebuilds the thread view from layer 2's records and the pool.
7. Starts the pacing state in `settling`. The schedule resumes from `slots.open.next`. **Settling is a delivery gate:** it holds shows (§5.4) and nothing else. Due slots are resolved from the state above (§7.2), exactly as in uninterrupted play.

**What is the same after a load:** the schedule, the pool and its candidates, the perception stamps and the ring, the sowing decisions, the instances and their offer `Id`s, the pending and nudge lifetimes and the arc lock. **What may differ:** when the next push is shown, because pacing restarts in `settling` and the arbiter's timers restart. One divergence remains: an instance still forming from events that only the lost session saw. The window is the time since the last save (compromise C-S3-6).

**Branches.** Layer 3 is branch-local. Loading a save and playing on is a **fork**: it inherits the selected save's **whole** layer-3 state (pool, tombstones, buffer, pending and nudge lists, recent ring, skeleton ring, schedule pointer, arc lock) and then evolves independently. Its earlier matches, refusals and cooldowns still happened, so none is cleared. Only a **new lineage** (a new world seed), or recovery from a missing record (step 1), starts empty. "Never read across branches" means never reading a sibling's later state; inherited history is the fork's own.

### 9.4 When a save is taken

The host serves a save request at a **tick boundary**: after step 5 of §1.1, when the matcher has handled every emission released from the buffer in the tick, the refresh has run, and no sowing step is open. Three things follow.
- **No emission is lost or half-handled in a save.** Each is in the persisted buffer or already folded into the pool. Nothing needs replaying (kernel replay is silent, S0 I-13).
- **A sow is whole or absent.** The seed and its bookkeeping are in one committed batch (§7.6). Loading repairs a record that holds only the seed (§9.3, step 5).
- **The ring agrees with the decisions.** A tick's ring update (§6.8) precedes its slot, so a saved decision was always ranked against the saved ring.

## 10. The decision log

Every director action and every sowing, hold, fit, withdrawal and match event writes one entry to the **session ledger**: local, per session, never part of the save.

```ts
interface LogEntry {
  seq: number;
  kind: 'slot' | 'sow' | 'withdraw' | 'hold' | 'phase' | 'fit' | 'match' | 'budget' | 'evidence' | 'thread' | 'gate';
  at: { game: GameTime; playTotal: number; playClock: number };
  purpose: 'schedule' | 'rest' | 'protect-peak' | 'lead-aim' | 'headroom' | 'pending' | 'match' | 'fit' | 'evidence'
         | 'tell' | 'surface' | 'offer' | 'nudge' | 'close' | 'escalation' | 'skeleton';   // v0.6 adds the second line
  class: 0 | 1 | 2 | 3;                      // the manipulativity class; class 4 does not exist
  rule: string;                              // the gate, hold rule, band or budget that fired
  inputs: Record<string, unknown>;           // only from the closed lists
  chain: Id[];                               // the explanation chain: record facts that justify it
  data: Record<string, unknown>;
}
```

| `kind` | Written when | `data` holds |
|---|---|---|
| `slot` | A slot is passed, lapsed, gentle, locked, budget-blocked, empty or run | `k`, `time(k)`, `u(k)`, the tempo, the reason |
| `sow` | A candidate is sown or refused, or a closing is sown | The candidate's kind, the pattern id and version, the instance and juncture, the realisation, the bindings, the raw features, the bands, the composite, the diversity terms (`dup`, `skel` and the predicted tokens), the scores with noise, the **rivals** (every candidate ranked, in a ring of the last 8 slots, not saved), the kit and its scores, the overlay, the request and its result |
| `gate` | A candidate fails a gate (v0.6) | The candidate, the gate, and for gates 11 to 13 the failing condition |
| `withdraw` | A pending seed or a nudge is withdrawn | The seed, its `sownAt`, its age and the reason |
| `hold` | A (delivery, reason) pair first appears, and when it clears | The delivery, the reason, `T`, the phase |
| `phase` | A transition | The previous phase, the new one, `A`, `N`, `T`, `engaged`, `R` |
| `fit` | A fit hook call with a non-zero raw weight | The choice, each option's three terms, raw and clamped |
| `match` | A start, a juncture matched (with its fill and `source`), a near miss, a foreclosure, an outcome armed or fixed, a kill, an ending, a loss, a drop, a layer (cross-causal or not), `pool-full`, `sow-repaired` | The pattern, the instance, the juncture, the bindings, the failing link of a near miss, the minted `meta:story` id |
| `thread` | A thread's skeleton changes (v0.6) | Its members, its shape (L1) and its full tokens, stances included, for evaluation only (§6.8). Ranking never reads it |
| `budget` | A refresh finds a count over a budget | The four counts |
| `evidence` | A new display or response is seen (§8) | The delivery, its skeleton, channel, class and purpose, or the response kind, and the `playTotal` |

**Manipulativity classes.** Sowing a seed whose first delivery is class 0 is a `trace`, class 0. Sowing one whose first delivery is class 1 or above is an `offer`, class 1. Sowing a nudge, which adapts unobserved state, is class 2 (v0.6), capped by `maxNudges` and the slot rate. A hold, a withdrawal and a rest are class 3. **Class 4, changing anything V has observed or could base a choice on, does not exist.** Any action that would change a unit's strength is a logged defect.

**Rendering.** Turning a log entry into one plain sentence is a later capability (P6). In the core the entry is the explanation.

## 11. Invariants

| # | Invariant |
|---|---|
| S3-I-1 | **Determinism.** The same inputs (§3.1) give identical sowing decisions, instance `Id`s, holds, joint reports, pool contents and layer-3 records |
| S3-I-2 | **Two doors.** Layer 3 changes the world only through `story.seed@1` and `story.withdraw@1`, and mints only inert `meta:` events. It writes no pin, belief, contribution or edge. What a nudge changes, layer 2 writes, from a seed |
| S3-I-3 | **Bounded hooks.** `fit` is clamped by layer 2 to ±`fitCap`; `hold` only removes, and never holds a pull, class-0 or closing delivery; `joint` only reports; `onRelease` only adds to `N` |
| S3-I-4 | **The evidence has no exit.** The evidence log of §8 is read by nothing in layer 3. A static audit finds no read of it in any hook, gate, feature, draw, schedule or budget |
| S3-I-5 | **Closed inputs.** Hooks read only §1.5's list, the fit hook only §4.2's, the director only the sense feed. Perturbing session length, idle time, quit, save and load counts, time of day and the wall clock changes no hook output and no record, byte for byte |
| S3-I-6 | **Authored first.** The budgets, the schedule and the phase hold never refuse, withdraw or (past 70 per cent of `maxWaitPlay`) hold an authored seed. The engine's threads yield |
| S3-I-7 | **Nested schedule.** `time(k)` and `u(k)` depend only on `worldSeed`, `salt`, the stream and `k`. A slot live at a tempo is live at every higher tempo. Changing the tempo never changes `time(k)` or `u(k)` |
| S3-I-8 | **Idempotent sowing.** One candidate key gives one decision id and, for one template, one instance `Id`. Sowing twice finds the existing instance. A reload before a save re-sows the same seed |
| S3-I-9 | **Bounded state.** The pool, the buffer, the pending and nudge lists, the recent ring and the skeleton ring never exceed their caps. The pool holds only copied descriptors; `nodes` holds only the filler and story events of pooled instances |
| S3-I-10 | **A cache, not a source.** A save without the layer-3 record loads without error. A save with it gives the same schedule, candidates and sowing decisions after a load |
| S3-I-11 | **Fitting is independent of sowing.** The fit hook and the lead aim give the same output with tempo `off` and with any other tempo, and with sowing on or off, from the same state |
| S3-I-12 | **Selection never edits.** No layer-3 action changes a unit's strength, stakes, hostility or reward, removes an event that happened, overrides a filler the record holds, or rewrites a fragment. The overlay holds only role identities and a `growsFrom` |
| S3-I-13 | **Session independence.** No draw key, `Id`, ordering, tie-break or sowing decision reads the session epoch, the pacing phase, the play clock, a load count or the wall clock ([S0 I-16](kernel.md#15-invariants)). The play clock drives only the pacing tick and the holds. Slots are resolved from branch-persisted state |
| S3-I-14 | **Inert meta events.** A `meta:` event has no effects and no witnesses, and the director is its creator. S1's policies ignore it. Only `story` junctures read a `meta:story` event |
| S3-I-15 | **Explained.** Every sowing, hold, withdrawal and phase transition writes a log entry with its rule and a chain to a recorded fact |
| S3-I-16 | **No spine, no doom.** A sown seed binds no spine node and casts none (S2 §5.2 step 4), has stake scale at most `block`, and level at most `gig` |
| S3-I-17 | **A decline stays a decline.** A candidate whose seed V declined, retracted or let lapse is never sown again: the decision id names the occurrence and `sownBy` stays non-empty. The dial never changes how a decline is handled |
| S3-I-18 | **Occurrences are distinct.** An instance id names one occurrence: two incidents among the same people differ in instance id, candidate keys, decision ids and `meta:story` id, however far apart. A redelivered Change never advances an instance, and a Change fills at most one juncture of an instance through each function its record fills |
| S3-I-19 | **Deadlines first.** No instance advances, is ranked, is realised or starts past its deadline, whether or not a boundary step or a sweep has run. Endings and armed outcomes are applied at the boundary step; sweeps reclaim storage only. Equality is not past |
| S3-I-20 | **One sow, one commit.** A sowing step's seed and bookkeeping are saved together or not at all. Saves are taken at tick boundaries, so none holds a half-handled emission |
| S3-I-21 | **Pending is finite.** Every director-sown instance leaves `pending` within `pendingLifetime` play seconds: shown, ended, or quietly withdrawn. A seed V has seen is never withdrawn |
| S3-I-22 | **Saved evidence is kept.** Every filler event and story event of every saved instance is in `nodes` until the instance leaves the pool |
| S3-I-23 | **One matcher** (v0.6). Sifting and sowing read one pool: every candidate is an instance or a juncture of one, and every pattern, the stage form included, is matched by §6's procedure |
| S3-I-24 | **Only the unobserved is steered** (v0.6; DS-05). No nudge names the protagonist or is realised on a juncture an argument of which may be the protagonist; every fill a nudge causes has source `nudged`, and none is presented as a consequence |
| S3-I-25 | **Legibility before more cause** (v0.6). No juncture is realised while its instance's legibility debt is above 1 |
| S3-I-26 | **Shapes only recognise** (v0.6). No candidate realises a juncture of a shape; a shape becomes live only on two perceived junctures and a pull |
| S3-I-27 | **The escalation gate binds the director, not the world** (v0.6). No escalation juncture is realised without the five conditions of §7.9; nothing in layer 3 starts, raises, holds or ends a group's intention against the protagonist (§7.10) |
| S3-I-28 | **Matching draws nothing** (v0.6). Every matching choice (which filler, which state-query candidate, which instance a Change starts) follows the orders of §3.1, with no draw |

## 12. Fixtures

Every fixture uses `worldSeed = H("fixture", <id>)`, the fixture pack `xf.fixture`, the kernel's core schema plus S0 §20, S2's core, and `Layer3Data` at its defaults. As in S0, outcomes that depend on hashes are checked as properties, not numbers.

**v0.5's fixtures stand** (v0.6). Those that sift (SF3-15 to SF3-23, SF3-37 and SF3-38) write their patterns in the stage form (§2.2b) and run with `relevanceGate: false`; with it, they expect exactly what they expected before. The v0.6 fixtures (SF3-39 to SF3-60) use the composite's library and vocabulary as fixture pack data ([`composite/patterns/`](../composite/patterns/), [`vocabulary.json`](../composite/vocabulary.json)), and a stub registry that declares the fills and state rules the vocabulary lists for M3's kinds, standing in for S0-2 and S1-1 until they are built.

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
| SF3-39 | **A graph pattern.** `debt` over two people D and C. (a) A `favour` from C to D (fills `help` and `obligate`), then a demand by C of D, then D's payment. (b) The demand first, with the membership or norm behind it found by a state query from D. (c) After the payment, a `wrong` by D to C | (a) One instance at `owed`; `due` by the frame C opens; `called` with its `motive` link borne out; `settled` fixed; the story event minted once. (b) The instance starts at `called`; `owed` is filled by the query, and the edges into `called` are tested when their sources match. (c) `defaulted` is foreclosed: nothing changes |
| SF3-40 | **Multi-function advancement.** Worked example 2 ([composite worked examples §2](../composite/worked-examples.md#2-two-patterns-layered-over-kabuki)): one `shakedown` (Jun against Aiko, outcome `done`) with `squeeze` and `protection` loaded | `squeeze` starts at `rule` and fills `paid` through `comply` in the same Change; `protection` starts at `struck` through `wrong`. The shakedown fills at most one juncture per function in each instance. Both instances record a layer on it |
| SF3-41 | **Bounded state queries.** `squeeze.rule` requires `member(?col, ?pw)`: Jun has one membership; then a variant with ten candidate records; then a term whose only bound argument isn't in `searchFrom` | The Claws are bound from Jun's membership. With ten, the first passing record in `Id` order binds and two runs agree. The unsearchable term is `maybe`, so no, and the juncture stays open |
| SF3-42 | **Link tests.** A `because` edge whose later event cites the earlier at 1, 3 and 4 hops; a `but` edge whose later effect violates the earlier's served frame, and one that doesn't; a `motive` edge through the actor's `served` frame | Holds at 1 and 3 hops; at 4 the juncture stays `ready` and a `near-miss` is logged. `but` holds only for the violating effect. `motive` holds through the frame's cause |
| SF3-43 | **Story events and chaining.** `debt` ends `broken` by a `wrong`, which starts `grievance` (a shared filler); `grievance` ends; a closure matching `story(grievance, *)` is loaded; then a pattern that would match its own story event, and a chain five deep | One `meta:story` per fixed outcome, with the S0-1 slot, the bound roles as participants and the fillers as causes. The grievance shares the debt's `wrong`; the closure matches the grievance's story event with its `binds`. The self-match and the fifth link are refused. Both chained instances are in one thread |
| SF3-44 | **Outcomes in time.** An outcome with `after: 2 days`; another outcome reached on day 1 in a twin; an outcome with aftermath junctures and `days: 3`; a deadline at `firstTime + within`; then the same runs with the sweep skipped | The armed outcome is fixed at the first boundary at or after day 2; in the twin it is disarmed. In `aftermath` only the aftermath junctures match, and the instance closes at the first boundary past day 3. The deadline ends the instance at the boundary after it (equality is not past); a Change at the deadline still advances it. Decisions are identical with the sweep skipped |
| SF3-45 | **The relevance gate.** Three `theft` events: one between strangers in a cell at the coarse tier; one whose victim V has met; one in a fine-tier cell. A group-level pattern started by a `gang-clash` between two groups at the coarse tier | Only the second and third start instances; the first is ignored. The group-level pattern starts |
| SF3-46 | **Juncture candidates.** A live `debt` instance whose `paid` is ready (`v: 'offer'`, realise `[wait, offer]`); V has met D; then a twin where V has met nobody; then `called` ready with realise `[wait, nudge]`, at `nudgeAfter − 1` and `nudgeAfter` | The first gives a realise candidate by offer; its overlay binds D and C through the kit's `fills`, the cause role to the demand, and `growsFrom` the instance and `paid`. In the twin there is no offer candidate (gate 5). The nudge is a candidate only from `nudgeAfter` |
| SF3-47 | **Legibility debt.** A live instance whose two matched edges out of a perceived juncture are unshown; a surface kit is loaded. Then the surface seed's delivery, citing both fillers, reaches `presented` | The realise candidate fails gate 11, and the surface candidate is sown (F-16 favours it). Afterwards both edges are shown, the debt is 0, and the realise candidate passes. A `shown: 'must'` edge with one told sign is not shown; with a second sign on a channel of another modality, it is |
| SF3-48 | **The escalation gate.** An escalation juncture of a live instance, with each condition of §7.9 failing in turn: no pull since the previous rung (the protagonist only declined); the cause's edge unshown; no wanting actor; a portent shown 60 play seconds ago; a kit at `district` scale. Then all five holding | Each fails gate 12 with its condition logged; a decline is no pull. With all five, the candidate is ranked |
| SF3-49 | **Nudges and sources.** A ready juncture realised by a nudge kit that opens a goal on Rhee; the simulation's theft by Rhee, `served` by that goal, fills it. A nudge candidate on a juncture whose argument is bound to V. A fifth nudge while four are live | The fill has source `nudged`, is logged as an adaptation, and counts in the nudge share. The juncture bound to V gives no nudge candidate (gate 13). The fifth isn't a candidate. A nudge that hasn't started within `nudgeLifetime` is withdrawn (`nudge-lapsed`) |
| SF3-50 | **Features.** The state after SF3-40 with V having met Aiko, and The Mox's answer filling `protection.answer` and causing the next failed shakedown | F-13 counts the cross-causal layer; F-14 counts Aiko; F-15 the reachable outcomes; F-16 the shown share. Bands follow §7.4 with F-14 weighted 2 |
| SF3-51 | **Skeletons and the ring.** The package thread's path of [composite worked examples §1.6](../composite/worked-examples.md#16-the-threads-skeleton-on-one-path), scripted; save and load mid-thread; then 40 short threads | One token per perceived occurrence; the theft gives one token though three instances read it; masks, links and stances as §6.8 gives them (the worked example's tokens are a hand-built illustration, not a fixture value). The ring entry is written and survives the load; its tokens are stance-free. After 40 threads the ring holds 32, the lowest `seq` gone. A candidate whose predicted prefix matches three ring entries scores `−1.5` on the skeleton term |
| SF3-52 | **The thread view.** A seed sown for a juncture; an authored seed whose `realises` names a juncture of the same instance with agreeing casts; a second instance chained by story event; a third layered on a shared filler but not cross-causally; then cross-causally | The seeds and the first two instances form one thread; the third joins only once the layer is cross-causal. An instance-only thread is aware only once it counts as a thread (§6.7). A nudge joins no thread |
| SF3-53 | **D-30.** A stub S1-10 intention of a group against V, with its warning and a harmful act; `hunted` and its children loaded; a nudge kit and an offer kit for the children's junctures | `decided`, `warned`, `hunting` and `caught` fill from the group's records; `hunted` is a shape and gives no candidate. No nudge candidate names V. An offer realising `settlement` (a way out) is a candidate under every gate. Surface candidates for the act the group blames V for rank first on F-16. Nothing in layer 3 changes the intention |
| SF3-54 | **Closings.** An instance that counted as a thread parks at `within`; another resolves with every reached juncture perceived; a third lapses unperceived; tempo `off` for a fourth | The first gets one closing seed (idempotent across a reload), not counted in budgets; the second and third get none; the fourth's closing isn't sown at `off`, and becomes `none` after `candidateTtl` |
| SF3-55 | **Shapes.** A `feud` fed by two grievance instances' story events; first neither perceived; then both counted as threads, with an answered offer in one | The feud stays `forming` until two of its junctures are perceived and a pull holds; then it goes `live`. It is never a realise candidate; its live instance adds to F-15 of the candidates that would advance it |
| SF3-56 | **One occurrence, one start.** An event that fills two entry junctures of one pattern, with different bindings; then the same event redelivered | One instance starts, by the first entry in key order. The redelivery changes nothing |
| SF3-57 | **The stage form.** SF3-15 to SF3-17 run through §6 with the stage form | Results, ids and logs as v0.5 specified |
| SF3-58 | **Persistence.** Save mid-instance (two junctures matched, one perceived, a nudge live, ring entries, a buffered emission); load in a fresh process; run on. A hand-made schema 1 record | The run continues exactly as uninterrupted: stamps, ring and buffer intact; `nodes` equals the union of filler and story events. The schema 1 record loads its slots, lock, tombstones, pending list and recent ring, with an empty pool |
| SF3-59 | **Perturbation, extended.** SF3-33's perturbations over SF3-40, SF3-46 and SF3-51 | Byte-identical instances, candidates, decisions, stamps and ring |

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

**What holds in general (v0.5, from the M3 run).** SF3-36's identity holds because R1's fragments don't read anything the delay changes. For any seed, the invariant is **the fit report**: it is identical with layer 3 absent, with tempo `off` and with sowing on. The play is identical up to release time only for a seed whose selected fragments read nothing that can change during a hold. A seed that reads the world (its fragments' `applies`, its standing reads) may meet a later world when layer 3 holds its release, and select a different fragment. That is layer 3's pacing working as designed, not a defect. M3's R2 showed it once in 18 runs.

**SF3-60. End to end, a layered week** (v0.6). Kabuki with `squeeze` and `protection` loaded, tempo `steady`, Aiko met by V, a stub registry for the fills, R2′ (S2 SF-65) available as the authored seed, and a scripted week of shakedowns. **Expected:** Friday's shakedown starts both instances as SF3-40 says; the offer at `squeeze.asked` is realised by R2′'s authored offer (a live seed realising it makes it `pending`, so the sower doesn't sow another); each stance V takes feeds a different instance (help pay: `squeeze.paid`; stand at the stall: a second protection with V as guard; stay out: `protection` decides alone); the thread's skeleton and the decision log's split between consequences and adaptations are written; a replay gives identical records. Running the same week as the harness's whole-plot arm (A5, [pattern language §14.4](../composite/pattern-language.md#144-judging-threads-over-a-simulated-week)) is P9's, not a fixture.

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
- **Matching** (v0.6): over random Change streams with redeliveries, an occurrence never fills two junctures of an instance through one function; the same stream in any delivery order that the buffer releases identically gives the same instances; no instance matches its own lineage.
- **Steering** (v0.6): over random states, no nudge names V, no juncture is realised above a legibility debt of 1, no shape juncture is realised, and no escalation juncture is realised without its five conditions.
- **Legibility** is a function of the stamps and the receipts: recomputing it after a load gives the same values.

## 13. What S2 and S0 have taken, and what v0.6 assumes

### 13.1 What they have taken

Layer 3 needed additions to S2 and S0. They are now in S2 v1.1, v1.2 and v1.11 and S0 v4.7 and v4.8. This page relies on them and does not propose them.

- **S2 v1.1** (A-1 to A-12 of v0.1): the sowing request with an overlay (§1.3); the read API (§10.1a); source withdrawal (§1.3); the hooks, their inputs and the joint latch (§2.13, §3.4, §8.3, §8.8; here §1.4 and §1.5); the fit hook independent of `noticing`, and the fit report's `fit` field (§3.4, §11.2; here §4.2 and §4.5); the opaque `sowable` field (§2.1; here §2.3); no `fits` field (§4.1).
- **S2 v1.2:**
  - *D-04.* §5.2 step 4: a director-sown instance excludes spine characters and excluded NPCs from the candidates of every role, at casting, re-casting and preparation, and ladders cannot relax it. Gates 7 and 9 only pre-check the bound nodes (§7.3).
  - *D-05.* §1.3 item 4: the overlay is compared with the document before it, and may not replace a fixed identity or a profile's fixed part. A refusal is a kit refusal (§7.5). S3-L-6 checks the static case.
  - *D-15.* §10.1a and §12.1: `sowSeq`, `claimConflict`, `playTotal()` as the current value, `maxWaitPlay`, `source.decision`, and the loose-end vocabulary (needed again when loose-end growth returns).
- **S0 v4.7 and v4.8:** pattern frames (V4-31; §6.1); the event-kind registry and kinds matched through the `kind` slot (V4-32; §1.2, §6.1); occurrence id and game time on delivered emissions (V4-33; §3.2, §6.3); `tempo` in `SettingsSet`, and soft exclusions in `SettingsSet.content.softExclusions` (V4-34; §2.4); staged batches, from v4.6 (§14.2a; §7.6).
- **S2 v1.11** (for v0.6): `growsFrom` a pattern instance's juncture, accepted in the overlay (§2.13, §1.3; here §7.6); `realises` and the implicit pattern (§2.24; here §5.7, §6.8); the fills of `offer`, `response`, `promise` and `seed-outcome` (§2.24); the nudge form, its silent start and its legality check (§2.25; here §7.5 to §7.7); the `promise` an accepted offer leaves (§2.9); D-30's two sources of harm and the carried warning (§2.16a; here §7.10); the pattern lint, L-144 to L-159 (§11.1; here §2.2); delivery `cites` and the exposure, response, realisation and beat reads (§10.1a, §10.2; here §1.2, §6.7, §6.8).

### 13.2 Still owed

- **The host** serves a save at a tick boundary, after the matcher has handled the tick's emissions, the refresh has run, and no sowing step is open (§9.4).
- **S2** keeps `sownBy(decision)` answering for every instance of the branch, compacted ones included (gate 10), and settles the exact form of `claimConflict` (§14.2).

**Other specifications owe layer 3** (as P5 §10): S1 events for the matcher, entries in the event-kind registry with their `producers` and `fills`, the state rules, the `isSpine` and `aesthetic` reads, and policies that ignore `meta:` kinds; S4 the pattern, vocabulary and sowable formats, the tempo settings, the closed vocabularies and the starter pack (with kits that declare `fills` for the library's functions, a surface kit, a closing kit and the warning template of S2 §2.16a); S5 the `SenseFrame` of §5.1, the `jump` report and the quest-completion report; P6 the settings surface; P7 where the sower and matcher run, and the pool's cost; P9 and P10 the arms, measures and inspectors that read the decision log.

### 13.3 What v0.6 assumes from S0 v4.17 and S1 v0.6

A parallel pass revises the kernel and the simulation layer for the composite. Where v0.6 depends on it, it names the composite's proposal ([pattern language §13](../composite/pattern-language.md#13-proposed-specification-changes)) and the interface it assumes. Where that pass settles an interface differently, its form wins and this page is aligned to it.

| Proposal | Interface assumed here | Used in |
|---|---|---|
| S0-1 | A `meta:` event carries a registered data slot `story: { pattern, instance, outcome, kind, depth }`. v0.6 asks for `kind` (resolved, failed or parked) and `depth` (the lineage depth, so a chain's depth needs no walk) beside the proposal's three fields | §6.6 |
| S0-2 | The event-kind registry entry gains `fills: KindFill[]`; state fillers are registered `StateRule`s with declared `changes` selectors, a bounded `search` from the arguments a function lists in `searchFrom`, and `holdsAt` (§2.2a) | §2.2a, §6.1, §6.3, §6.4 |
| S0-3 | Forming or revising a belief emits a Change (or S1 always mints the forming event), so belief state rules (`blame`, `conceal`, `learn`) can fill without polling. Until it is built, those rules fill nothing | §2.2a |
| S1-1 | Every kind of M3 declares its fills, as [`vocabulary.json`](../composite/vocabulary.json) lists them | §2.2a |
| S1-2, S1-7, S1-8 | Harm to a member pulses its group whatever kind filled it; every group intention has a visible act; an unsanctioned public refusal is a norm signal. They change what the world produces, so more junctures fill by `wait` and fewer by nudge; this page reads nothing new from them | §7.5 (the nudge share) |
| S1-3 | A goal frame a seed opens on a cast person raises that person's rate for the matching kinds, and the act carries `served` = that frame | §6.3 (sources), §7.6 |
| S1-4 | A kind `xf:item` and a time-varying `xf:held-by` edge, with a state rule for `hold` | §2.2a |
| S1-5 | A `tell` may have a `promise` event as its subject, and a `tell` of a concealed subject also fills `expose` | §2.2a |
| S1-6 | The relation `leads(who, group)` is a registered read over membership role `leader` | §2.2a (relations) |
| S1-9 | Occurrences carry `outcome` `failed` or `prevented`, and a kind's fills may depend on it (`KindFill.when.outcome`) | §2.2a |
| S1-10 | A group intention against the protagonist, with its warning act and harmful acts as events, its transitions in S1's feed, state rules for `decide` and `pursue` that accept it, and S1's gate on S2's `exposure(warning)`; its reach scales with `SettingsSet.tempo`, with none at `off` | §7.10 |
| `depth` | S1's registered read `depth(node)` (S1 §9.1, built) | §6.3, §7.11 |

## 14. Compromises and open items

### 14.1 Compromises

Departures from the model, for the [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger):

| # | The model says | This specification does | Revisit when |
|---|---|---|---|
| C-S3-1 | The director is an actor whose drives are frames | Its drives are terms in its rules; in the core only phase adherence and care-free holds exist. Only pattern frames are kernel frames | A rule needs relevance matching through the director's drives |
| C-S3-2 | A partial story is a seed with its own interests | Pattern instances are descriptors in a bounded, saved pool that keeps their events alive; one frame per pattern carries the interests | Pool measurements show seeds are cheap enough |
| C-S3-3 | Fitting is query, sample and contribution | Fitting weighs the options layer 2 already has. No search, no fills | Authors need bridges or fills (§0.3) |
| C-S3-4 | Every choice is explainable by kernel `trace` | Layer-3 choices are not kernel pins. The decision log holds them | A tool needs `explain` on a sowing decision |
| C-S3-5 | Fitted choices are recorded as fitted | No `fits` record: the draw records hold the weights (§4.1) | Fitting produces anything but weights |
| C-S3-6 | Reload leaves the world's future unchanged | Pacing restarts in `settling`, so show times differ; sowing decisions do not (§7.2). A match formed only in the lost session is lost | Players report reload-fishing, or measured divergence is above 10 per cent **[tunable]** |
| C-S3-7 | New threads open in a quiet moment (P5) | The sower resolves a slot at its time from saved state, in any phase. Delivery is gated by the hold hook, so a class-0 trace can still show in a firefight (§5.4, rule 1) | Players find sown traces badly timed; then a persisted quiet flag may gate selection |
| C-S3-8 | Simmering and retirement count sessions as well as play-hours (P5 §3.6) | Play-hours only. A session count is a load count, which the director never reads (S2-I-11; P5 §3.1) | Never: this is a correction of P5 |
| C-S3-9 | Urgency rises with time since the window opened and with V's distance from the closing place | Urgency is only what S2's `urgency` list says (§4.4) | A kit needs a ramp the list cannot say |
| C-S3-10 | An unfilled slot's push is owed | A slot is spent, empty or not | Starvation shows in the harness (P5 open question 12) |
| C-S3-11 | A thread joins on shared cast, frames, promises | `growsFrom`, shared anchor casts, seeds realising instances, chains and cross-causal layers (§5.7, v0.6). Not shared frames or promises | Threads merge or split wrongly in practice |
| C-S3-12 | A story can be told at any stage, in several ways | An instance is told whole once, at its outcome, with one telling; before that, its matched junctures can be surfaced one at a time and its ready ones realised (§7.1, v0.6) | Authors want several tellings of the whole |
| C-S3-13 | The phase hold relaxes at 70 per cent of `maxWait` for every delivery (P5 §3.4) | Only for authored deliveries (P5 §2.4's hook table says authored; §3.4 says "everything but the phase hold"). The phase hold never relaxes for sown ones, since expiry already bounds them | Sown content starves under holds (P5 open question 12) |
| C-S3-14 | Threads over budget are withdrawn, lowest pull first (P5 §3.6) | Budgets only cap openings. A sown seed V never saw lapses after `pendingLifetime`; a seen one is never withdrawn (§5.8, §7.7) | Threads pile up in play; then overflow withdrawal (§0.3) |
| C-S3-15 | A completed match is a `meta:story-end` event, so that patterns compose (P5 §6.5) | One `meta:story` event at an outcome or parking, matched by `story` junctures (§6.6, v0.6). No separate `meta:story-end` | A composition needs a story's start as well as its end |
| C-S3-16 | A pattern can be read every way the record allows | The first filler that passes, with no forking (§6.3) | A forking matcher run offline finds stories the bounded one misses ([pattern language §16](../composite/pattern-language.md#16-open-questions), question 2) |
| C-S3-17 | A juncture's changes are part of its meaning | They are expectations, not match conditions: the matcher never waits for them (§2.2) | The harness shows outcomes counted whose changes never came |
| C-S3-18 | The director may give an actor any unobserved reason | Only goal frames, world requirements and minted events, never written beliefs, and never anything naming the protagonist (§7.5, S2 §2.25) | A needed nudge can't be expressed so |
| C-S3-19 | Legibility is a ledger kept as the protagonist perceives | Only each juncture's first perception is kept; edge legibility, debt and thread-hood are derived from it and the receipts (§6.7) | Deriving them costs too much per refresh (P7) |

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
13. **The nudge share** (v0.6). Too many nudges is the quantum ogre; too few starves the world. Until S1-3, S1-7 and S1-9 land, most open junctures can only be nudged ([composite worked examples §1.7](../composite/worked-examples.md#17-what-worked-and-what-didnt)). P9 sets `nudgeAfter` and `maxNudges` from the ogre audit and the raters' sense of what was caused.
14. **Kits per function** (v0.6). The library needs at least one offer or nudge kit for every function a realisable juncture names, a surface kit and a closing kit, or candidates starve; and several phrasings per function, or the words bring the template back ([pattern language §15](../composite/pattern-language.md#15-break-it-yourself), attack 13). S4's starter pack, and a coverage report per pattern.
15. **Skeleton calibration** (v0.6). The masks, the `skeletonTokens` prefix and the penalty are first guesses; P9 calibrates them against raters' "same story" answers ([pattern language §14.3](../composite/pattern-language.md#143-have-you-seen-this-story-before)).
16. **The proposals' interfaces** (§13.3), once the parallel pass lands.

## 15. Review record

### v0.6: the composite's proposals, D-30

A spec pass, not a review. It takes the S3 proposals of [the pattern language §13](../composite/pattern-language.md#13-proposed-specification-changes), read with its §3 to §11 and §14 and checked against what v0.5 said, with D-30. S2 v1.11 takes the S2 and S4 proposals ([S2 §16](seeding.md#16-review-record)); the interfaces assumed from the parallel S0 and S1 pass are in §13.3. An independent review of v0.6 with S2 v1.11 is still to run.

| Proposal | Decision | What this page does, and why |
|---|---|---|
| S3-1 patterns as graphs | Adopted | §2.2, §2.2a, §6: event and state junctures, fills declared by the world, bounded state queries, multi-function advancement, `forecloses` as an effect only, aftermath and armed outcomes; dilemma, edge, frame and belief junctures are in. **Changed:** the junctures' `changes` are expectations, not match conditions (C-S3-17); armed outcomes, aftermath windows and deadline endings are applied at a deterministic **boundary step**, because applying them "at the sweep", as proposed, would make a decision depend on storage reclaim, which v0.5's S3-I-19 forbids. **Added:** the v0.5 stage form stays loadable as a chain with an internal `order` link (§2.2b), so the built core's fixtures keep their meaning under one matcher; the relevance gate has a fixture switch for them |
| S3-2 instances as candidates | Adopted, extended | §7.1: told, **surface** and realise candidates. The single telling stays, now at an outcome. **Added:** surface candidates, because gate 11 (legibility debt) needs a way to show a cause before the story goes on, and the proposal gave the director none |
| S3-3 composed patterns | Adopted | §6.6: `meta:story` at outcomes and at parking, acyclic and at most four deep. The proposed S0-1 slot gains `kind` and `depth` (§13.3) |
| S3-4 the director's realisations and gates 11 to 13 | Adopted for offer and nudge; back-fill and open specified as later capabilities | §7.3, §7.5, §7.9, §7.11. Offer and nudge are what M3's iteration 3 needs: the nudge share and the whole-plot arm both depend on nudges. Back-fill and open are fixed as contracts but wait (S3-L-11): one library refinement doesn't justify child lifetimes in the core, and back-fill needs the cause hook and the ogre audit. **Changed:** an offer realises only a `v: 'offer'` juncture or an ask of the protagonist; a nudge waits `nudgeAfter` so the world fills first; nudges are capped and class 2 |
| S3-5 F-13 to F-16 and skeleton diversity | Adopted | §7.4. F-14 weighted 2 after D-27. F-16 reads the other way for surface candidates, so surfacing ranks where an instance is least legible |
| S3-6 the legibility ledger | Adopted, reduced | §6.7. Only each juncture's first perception is persisted; edges, debt and thread-hood are derived from it and the receipts each refresh (C-S3-19), which keeps one fewer persisted structure in step with the record |
| S3-7 the thread view over instances | Adopted | §5.7. Only cross-causal layers join threads; co-occurrence alone stays two stories ([pattern language §15](../composite/pattern-language.md#15-break-it-yourself), attack 3) |
| S3-8 the skeleton ring | Adopted, with one change | §6.8, §9.2. **Changed:** the ring is updated at the refresh, outside the sowing batch. Saves are taken only at tick boundaries (§9.4), and the refresh precedes the slot in every tick, so a saved decision always ranked against the saved ring; coupling the ring to the batch would add nothing. Ring tokens are stance-free so a prediction can match them |
| S4-1 the pattern lint | Adopted, in S2 | S2 L-144 to L-159; this page's load checks require it (§2.2) |
| D-30 | Applied | §7.10, gate 13, S3-I-27: the director waits for a group's acts against the protagonist, never nudges them, never realises a shape's juncture, and makes the cause legible |

### Round 1: GPT-6 Astra, on v0.1

Eighteen findings and four over-engineering cuts, all adopted. The parts that touch S2 and S0 are in S2 v1.2 and S0 v4.8. The cuts are in §0.3: the online estimator, sifting beyond completed event patterns, loose-end growth, and automatic overflow withdrawal.

| # | Finding | What changed in v0.2 |
|---|---|---|
| D-01 | Repeated matches reuse identities | Match id holds the stage-0 occurrence; separate binding key (§3.2, §6.3, §6.5). SF3-16, S3-I-18 |
| D-02 | One Change advances a pattern repeatedly | Emission goes only to its owning pattern; duplicates cannot advance (§6.1, §6.3). SF3-17 |
| D-03 | Saved pool lacks its evidence | Pool entries' events are retention roots; closure measured (§6.2, §9.2). SF3-21, S3-I-22 |
| D-04 | Spine and NPC checks miss casting | Done in S2 v1.2 §5.2; S3 pre-checks bound nodes (§7.3) |
| D-05 | Overlay can replace a fixed identity | Done in S2 v1.2 §1.3; S3-L-6 checks the static case (§2.2, §7.5) |
| D-06 | Impossible openings stop sowing | Finite pending lifetime; unseen threads counted in `A` and `L` (§5.8, §7.7). SF3-12, S3-I-21 |
| D-07 | Loose-end growth invites again | Deferred, with the source, ledger and `follow-up` form (§0.3) |
| D-08 | Reload changes which seed is selected | Slots resolve from persisted state; settling gates shows only (§5.2, §7.2, §9.3). SF3-2, SF3-27, S3-I-13 |
| D-09 | Save boundary splits a sowing decision | One staged batch; saves at tick boundaries; load repairs (§7.6, §9.3, §9.4). SF3-28, S3-I-20 |
| D-10 | A fork must inherit saved state | Fork inherits the whole layer-3 state; only a new lineage starts empty (§9.3). SF3-29 |
| D-11 | Promotion has no complete lifetime | Intermediate promotion deferred; one lifecycle; no `maxPromoted` (§6.2, §6.5) |
| D-12 | Expiry used as eligibility | Deadlines checked at use; sweeps reclaim; equality and tombstone paths defined (§6.5). SF3-18, S3-I-19 |
| D-13 | Overflow picks threads it cannot withdraw | Overflow withdrawal deferred; closing-only threads counted (§0.3, §5.8) |
| D-14 | Candidate and telling cardinality disagree | One telling; one candidate per match; bounded kit order (§2.2b, §7.1, §7.5). SF3-25 |
| D-15 | S2's read contract is insufficient | S3 uses S2 v1.2's additions; unused fields dropped (§1.2, §13) |
| D-16 | S0 needs more than a clarification | S3 uses S0 v4.8's registry, envelopes, `tempo`, soft exclusions (§1.2, §2.2, §2.4) |
| D-17 | Estimator asks for evidence S2 lacks | No estimator; offers and responses logged with play time (§8) |
| D-18 | Bands break the coupled-draw claim | Scores frozen per slot; no rebanding after removal (§3.3, §7.4). SF3-24 |
