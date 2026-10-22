# S2. Seed language and seeding layer specification

**Status:** v0, 22 October 2026, not yet reviewed. This is the specification stage of [P4](../p4-seeding-layer.md) (work package [WP-10](../plan.md#82-work-packages)). It is exact enough to implement layer 2 in the reference model from this page plus the kernel specification [S0](kernel.md).

Where this page and P4 differ, this page wins. P4 explains why; this page says exactly what.

**Normative words, tunables and type notation** are as in [S0](kernel.md): MUST, SHOULD, MAY; **[tunable]** and **[calibrate]**; TypeScript notation with normative field names and free physical layout.

## 0. Scope

### 0.1 What layer 2 does

Layer 2 is the only way content enters the simulation ([D-02](../decisions.md)). It:
- compiles **seed documents** into kernel material (§3);
- **casts** roles (§5);
- runs each seed's **lifecycle** and its beats (§6, §7);
- makes **offers**, and runs the **arbiter**, through which everything that reaches V passes (§8);
- detects and settles **intersections** between seeds (§9);
- keeps the seed **record** and the **exposure ledger** (§10);
- provides the **lint** and the **fit report** (§11).

Authored packs (layer 4), the procedural engine (layer 3) and other plugins (`story.seed@1`) all submit seeds the same way.

**Specified elsewhere:**

| Topic | Specification |
|---|---|
| Choosing what to sow, fitting open parts, the director, pacing state | S3 |
| Pack format, player settings, the lint's text lexicon | S4 |
| Attention aspects, vanilla UI states, the play clock's source, capability reads, channels | S5 |
| Rendering text and choosing channel content | S7 |

### 0.2 What changed from P4

1. **Few kernel records.** Run-time bindings are few kernel records:
   - casts are `core:cast` edges;
   - seed facts are `core:seed-fact` nodes;
   - commitments are `committed` pins;
   - offers and responses are canon events.

   Beats, fragments and content choices are layer-2 state, persisted in `SeedState` (§12). They are not kernel nodes.
2. **Fixed parts don't all compile the same way.** A fixed role constraint becomes a casting `must` (§5). A fixed requirement on world state becomes a `constrain` contribution (§3.2). P4's "fixed means a pin" was too coarse.
3. **Content choices** (alternates, variants, modes, channels, scale forms) are drawn by layer 2 with the kernel's draw arithmetic (§3.4), not as kernel slots.

### 0.3 The first implementation

The first implementation is in the TypeScript reference model, beside the kernel. It implements everything here except:

| Deferred | The first implementation instead |
|---|---|
| The text-honesty lexicon (§11.1, L-20 to L-22) | A small provisional lexicon in a fixture pack; the checks are warnings |
| Capability predicates over V's state (§2.6, `cap`) | A registry stub that answers `maybe` unless a fixture sets it |
| Scale forms rendered differently | The form is chosen and recorded; rendering is S7's |
| The fit report's replay under two director policies (§11.2) | One policy: the director off |
| The director's scoring and phase hooks (§8.3) | The built-in fallback score |
| Migration with a beat map (§12.3) | `continue` and `withdraw` only |

### 0.4 What S2 needs from the kernel (S0 v4)

These are additions, not changes to anything the reference model implements:

1. **Fact kinds.**
   - `core:game-fact`: one mirrored `int` slot, `value`. Each game fact is the mirrored node `H("game", "fact:" + name)`.
   - `core:seed-fact`: one `assigned` `int` slot, `value`.
2. **`core:seed`**, with the `actor` facet and no slots the kernel reads.
3. **`core:cast`**, an edge type from `core:seed` to any kind, with `data: ['role']`, not perceivable.
4. **Event kinds** `offer`, `response` and `seed-outcome` in the core event vocabulary.

Kernel rules that already cover the rest:
- live seeds and their frames are retention roots (§7.3);
- seed states are persisted (§14.1);
- seeds are demand roots (§10.4).

DS-66 (derive functions take the query time) is S1's need, not S2's.

## 1. Packs, templates and instances

### 1.1 Templates

A **seed template** is a seed document (§2) in a pack, identified by `(pack, id, version)`. Pack ids and template ids are `<namespace>:<name>`.

### 1.2 Instances

A **seed instance** is a minted `core:seed` node. Its `Id` follows S0 §1.1:

| Sown by | `creator` | `cause` | `name` |
|---|---|---|---|
| An authored pack, once | The pack root `H("root", worldSeed, "pack:" + packId)` | `H("sow", packId, templateId)` | `"seed:" + templateId` |
| An authored pack, repeatable | The pack root | `H("sow", packId, templateId, n)`, with `n` the count of earlier instances of this template in the lineage | `"seed:" + templateId + ":" + n` |
| The procedural engine | `director` | The id of S3's sowing decision | `"seed:" + templateId + ":" + localName` |
| Another plugin | Its root, `H("root", worldSeed, "plugin:" + pluginId)` | The id of its `story.seed@1` request | As the plugin names it |

An instance records its template's `(pack, id, version)`. A procedural or plugin seed whose document is not in a pack carries its full document in its first `SeedState` op (§12).

### 1.3 When authored seeds are sown

An authored template is sown when its pack is active and its `sow` predicate (§2.1) first becomes `yes`. The default `sow` is `yes`: sown when the pack activates. A repeatable template is sown again when its `sow` predicate is yes and all of the following hold:
- its previous instance is terminal;
- `repeat.gap` has passed since that instance ended;
- fewer than `repeat.max` instances exist. Sowing is idempotent: the instance `Id` is fixed by the rules above, so sowing twice finds the existing instance.

## 2. The seed document

### 2.1 The top level

```ts
interface Seed {
  id: TemplateId; version: number;
  level: 'phrase' | 'exchange' | 'beat' | 'encounter' | 'job' | 'arc';
  parent?: { seed: TemplateId; purpose: string };
  purpose: { tags: PurposeTag[]; sentence: string };
  context: Pred;                       // required; where and when this seed makes sense (§2.6)
  intent: Intent;                      // §2.3
  sow?: Pred;                          // authored templates: when to sow (default yes)
  repeat?: { max: number | 'unbounded'; gap: Duration } ;   // repeatable templates only
  roles: Record<RoleKey, Role>;        // §2.4
  facts?: Record<FactKey, SeedFactDecl>;          // §2.5
  world?: WorldRequirement[];          // §2.5
  effects?: EffectDecl[];              // §2.5
  depends?: Dependency[];              // §2.5
  windows: Window[];                   // §2.7; at least one
  beats: Record<BeatKey, Beat>;        // §2.8
  start: BeatKey[];                    // beats available first
  end: Pred;                           // the end state, also in intent; §6
  unattended: UnattendedPlan;          // §2.9; required for any seed with an offer
  promises?: Promise[];                // §2.8
  profile?: { id: ProfileId; params: Record<string, unknown> };   // §2.10
  variation?: Variation;               // §2.11
  latitude?: Latitude;                 // §2.11
  adapt?: AdaptationPoint[];           // §2.11
  timing?: TimingRequest;              // §2.12; defaults for this seed's requests
  migrate?: Migration;                 // §12.3
}

type Duration = { clock: 'game' | 'play'; s: number };
```

### 2.2 Binding status

Any field typed `Part<T>` takes one of three forms:

```ts
type Part<T> =
  | T                                              // a bare value is fixed
  | { fixed: T; note?: string; ifRejected?: 'withdraw' | 'degrade' | 'refit' }
  | { prefer: T; strength: 1 | 2 | 3; note?: string }
  | { open: true; note?: string };
```

- **A missing optional `Part` is open.**
- **`ifRejected`** applies when a fixed part loses arbitration (§3.5). Its default is `withdraw` for anchor roles and world requirements, and `degrade` elsewhere. `refit` is allowed only if `latitude` permits re-fitting the part.
- **`note`** is the intent note shown in the fit report.

### 2.3 Intent

```ts
interface Intent {
  end: Pred;                           // the same predicate as Seed.end
  prohibitions: Pred[];                // fitting must never make one yes; the lint checks static cases
  tone: Array<{ tag: ToneTag; role: 'supports' | 'opposes' | 'complicates' }>;
  aesthetic?: Record<AestheticFeature, number>;   // −1..1, a few coarse weights for fitting
}
```

`PurposeTag`, `ToneTag` and `AestheticFeature` are closed vocabularies in S4. Until the composite seeds them, S4 ships a small starter set marked provisional.

### 2.4 Roles

```ts
interface Role {
  kind: KindId;                        // e.g. core:person, core:place, core:group
  identity?: Part<Id | GameKey>;       // a specific node
  must?: Predicate[];                  // required: S0 §8.1 predicates on the candidate
  prefer?: Array<{ p: Predicate; strength: 1 | 2 | 3 }>;
  scope?: RoleScope;                   // where to look; default: the seed's place role's district, else the city
  anchor?: boolean;                    // cast first, before the others
  order?: number;                      // cast-order hint among non-anchors
  optional?: boolean;                  // may be shrunk away (§5.4)
  onUnfilled?: LadderStep[];           // §5.4; default ['wait', 'withdraw']
  onLost?: 'withdraw' | 'standIn' | 'shrink';     // §5.5; default withdraw for anchors, else as onUnfilled's last step
  claim?: { span: 'seed' | 'beat' | Duration; share?: 'none' | 'background' | 'any' };  // default seed, none
  goal?: Goal;                         // effects this role pursues; opens a goal frame on the cast node (§5.3)
  memberships?: Array<{ group: Id | RoleKey; role?: string }>;     // pull on the cast node; feeds cross-pressure
  tie?: { to: RoleKey | 'v'; kind: 'companion' | 'rival' | 'mentor' | 'kin' | 'partner'; exits: BeatKey[] };
  authored?: Array<BeliefDecl | EdgeDecl>;        // grievances, beliefs, debts per direction, each with a reason
  repertoire?: FragmentRef[];          // casting prefers candidates whose repertoire holds one (§5.2)
  textAttrs?: string[];                // attributes text may name; each must be guaranteed by `must` or identity (L-17)
  client?: { blocked: Pred; stands_to_lose: string };   // job-like seeds: the client's blocked goal
}

type RoleScope = { under: Id | RoleKey } | { nodes: Array<Id | RoleKey> } | { region: SpatialRegion } | 'city';
type LadderStep = 'wait' | { wait: Duration } | { relax: number[] } | 'standIn' | 'shrink' | 'withdraw';
```

- **A role's `must` and `prefer`** are kernel predicates (S0 §8.1). A predicate argument MAY name another role as `{ role: RoleKey }`. It resolves to that role's cast `Id`, so the role must be cast earlier (§5.1).
- **`relax: [i, j]`** moves `must[i]`, then `must[j]`, to `prefer` with strength 1, one at a time, re-casting after each.
- **A `place` role** uses the place dimensions of [knowledge/places.md](../../../knowledge/places.md) §12. Several of them (wealth, danger, gang presence, public) are derived, so a predicate on them is a registry derive, not a single game field.

### 2.5 Facts, world requirements, effects and dependencies

```ts
interface SeedFactDecl {
  route?: { consumers: Array<BeatKey | RewardKey> };   // a route variable; at least one consumer (L-05)
  initial?: number;                    // default 0
}

interface WorldRequirement {
  target: { role: RoleKey; slot: SlotPath } | { selector: Selector };   // selectors may name roles
  form: Part<Form>;                    // S0 §4.3 forms; fixed → constrain, prefer → weight
  valid?: { from: 'commit' | BeatKey; to?: 'end' | BeatKey };           // default commit to end
}

type EffectDecl =
  | { fact: FactKey; set?: number; add?: number }                      // this seed's own facts
  | { game: { fact: string; set?: number; add?: number }; capability: 'story.write-vanilla' }
  | { reward: { table: RewardTableRef; tier: string; byRoute?: FactKey } }
  | { kernel: { on: RoleKey; effect: Effect } };                       // S0 §10.8 effects, as events

interface Dependency { on: RoleKey | { fact: string }; hold: 'keep' | 'substitute' | 'notice' }
```

- **Seed facts** are `core:seed-fact` nodes minted `H("mint", seedId, seedId, "fact:" + key)`. With no pin, a seed fact reads its `initial` value. Writing one is a `committed` pin with the seed as cause.
- **Game facts** are written only through the `story.write-vanilla` capability, under the bridge's write class for persisted vanilla state ([requirements H3](../runtime-requirements.md)). A seed without that capability that declares a game write fails the lint (L-12).
- **Rewards** reference a policy table. A literal amount is not allowed.
- **Cadence limits** are `repeat` (§2.1) and per-fragment `repeat` (§2.8).

### 2.6 Predicates

Predicates are three-valued: `yes`, `no` or `maybe`. Every condition in a seed is a `Pred`:

```ts
type Pred =
  | { all: Pred[] } | { any: Pred[] } | { not: Pred }
  | { fact: string; op: Cmp; value: number }                // a game fact, by name
  | { seedFact: FactKey; op: Cmp; value: number }            // this seed's fact
  | { decided: string }                                      // a game fact's guard (below)
  | { role: RoleKey; p: Predicate }                          // an S0 §8.1 predicate on the cast node
  | { cast: RoleKey }                                        // the role is cast (tentatively or committed)
  | { seed: TemplateId | Id; state: SeedStateName[] }        // another seed's lifecycle state
  | { beat: BeatKey; state: BeatState[] }                    // a beat of this seed
  | { hour: [number, number] }                               // game clock hour, half-open, wrapping
  | { since: { state: SeedStateName } | { beat: BeatKey }; atLeast: Duration }
  | { exposed: ExposurePattern }                             // §10.2
  | { cap: CapabilityRef }                                   // a capability read over V's state (S5)
  | { fn: FnRef; args: unknown[] }                           // a registry predicate returning yes, no or maybe
  | 'yes' | 'no';

type Cmp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
```

**Evaluation** uses Kleene's strong three-valued logic:
- `all` is `no` if any member is `no`, `yes` if every member is `yes`, otherwise `maybe`. An empty `all` is `yes`.
- `any` is `yes` if any member is `yes`, `no` if every member is `no`, otherwise `maybe`. An empty `any` is `no`.
- `not` swaps `yes` and `no` and keeps `maybe`.

**Atoms:**
- **`fact`** is `maybe` if the fact has no game reading, or if its guard is not `yes`. Otherwise it compares the reading.
- **Guards.** The facts table ([main-story-facts.json](../main-story-facts.json)) MAY give a fact a `decidedBy` predicate: typically the completion fact of the quest that sets it. Until `decidedBy` is `yes`, every read of that fact is `maybe`. `{ decided: f }` is `f`'s `decidedBy`, or `yes` if it has none. This makes "not dead" mean "decided, and not dead".
- **`role`** is `maybe` if the role isn't cast, or if the kernel's resolution returns anything but `ok`.
- **`hour`, `since`, `seed`, `beat` and `seedFact`** are never `maybe`.
- **`exposed`** is `yes` or `no` (§10.2).
- **`cap` and `fn`** return what the registry function returns.

Evaluation reads the kernel at the current revision and game time. It is read-only and emits nothing (S0 I-13).

**`maybe` never fires anything.** Every transition in this specification fires on `yes` only. A condition that should fire on "not known to be false" is written `not(... = no)` explicitly. The lint flags it (L-25) so it's deliberate.

### 2.7 Windows

```ts
interface Window {
  id: string;
  opens: Pred;
  closes?: Pred;                       // default 'no'
  lead?: 'early' | 'preferred' | 'late';          // where in the open span to aim; S3 reads it
  urgency?: Array<{ when: Pred; level: number }>; // 0..1; the highest level whose `when` is yes
  holdsWhileRunning?: boolean;         // default false: closing also ends a running seed
  onClose: 'withdraw' | 'degrade' | 'coda' | 'memory';
  closeContent?: BeatKey;              // required for coda and memory (L-09)
}
```

**A window's state**, evaluated whenever the seed re-evaluates (§6.2):

| `closes` | `opens` | Window state |
|---|---|---|
| `yes` | any | `closed` |
| `no` or `maybe` | `yes` | `open` if `closes` is `no`, else `pending` |
| `no` or `maybe` | `no` or `maybe` | `pending` |

**Closing is latched.** Once a window is `closed`, it stays closed for that instance, whatever the facts do later. The latch is part of `SeedState`.

**Urgency** comes from V's position in the story, expressed in the `when` predicates. It never comes from a calendar. With no `urgency` list, it is 0.

**The seed as a whole:**
- **open:** at least one window is `open`;
- **closed:** every window is `closed`;
- **pending:** otherwise.

### 2.8 Fragments, beats and links

**A fragment** is reusable content, in a pack, at any level:

```ts
interface Fragment {
  id: FragmentId; level: Seed['level'];
  needs?: Pred;                        // facts it presupposes; it may play only when yes
  leaves?: EffectDecl[];               // facts it establishes when it completes
  roles: RoleKey[];                    // role slots it uses; the seed maps them (Beat.bind)
  applies?: Pred;                      // the most specific applicable alternate wins (§7.2)
  tone?: ToneTag;
  repeat?: 'never' | { times: number } | 'free';   // default free
  minGap?: { game?: number; offers?: number };
  salience: 'foreground' | 'background' | 'oddity';
  forms: { standard: ContentRef; short?: ContentRef; full?: ContentRef };
  channels: ChannelId[];               // best first; the last is the lowest acceptable
  render?: { phrasings: ContentRef[]; reuse: 'once' | 'cycle' | 'free' };
  offer?: OfferSpec;                   // a player-facing fragment (§2.9)
  responses?: ResponseTemplate[];      // NPC responses to V's acts (§2.9)
}
```

A fragment reads only facts and its bound roles. It never reads another fragment's state.

**A beat** places fragments in a seed's graph:

```ts
interface Beat {
  play: Part<FragmentRef | { alternates: FragmentRef[] }>;
  bind?: Record<RoleKey, RoleKey>;     // fragment role → seed role; default same names
  kind?: 'texture' | 'decision' | 'obstacle' | 'conclusion' | 'aftermath' | 'exit';
  links?: Link[];                      // incoming links: what makes this beat available
  join?: 'all' | 'any';                // default all
  objective?: Objective;
  decision?: { atStake: RoleKey; stances: Stance[] };            // kind decision
  obstacle?: { affordances: Affordance[] };                      // kind obstacle; at least two
  conclusion?: { clues: ClueRoute[] };                           // kind conclusion; at least three
  aftermath?: { delay: Duration; signpost: FragmentRef; cancelIf?: Pred };   // kind aftermath
  failure?: Array<{ when: Pred; warnFirst?: Pred; leadsTo: BeatKey }>;
  scale?: Part<'short' | 'standard' | 'full'>;
}

type Link =
  | { because: BeatKey; on?: Pred }    // available after that beat is done and `on` is yes; `on` defaults to yes
  | { obstructedBy: BeatKey }          // not available while that beat is running or available
  | { then: BeatKey };                 // plain order; allowed only into texture beats (L-03)

interface Objective { kind: 'task' | 'condition'; succeeds: Pred; fails?: Pred; warns?: Pred }
interface Affordance { needs: Pred; cost: CostClass; exposure: ExposureClass; combat: boolean }
interface ClueRoute { beats: BeatKey[] }
type Stance = 'help' | 'bargain' | 'refuse' | 'oppose' | 'ignore';

interface Promise { id: string; opens: BeatKey; paidBy: Pred; mayStayOpen?: boolean }
```

- **Reconvergence** is explicit: a beat with several incoming links joins them by `join`. A variant is a condition (`on` or `needs`) on one graph, never a copy of it.
- **Live paths are bounded.** At most `maxLive` beats of one seed are `available` or `running` at once **[tunable 4]**. The lint checks the static bound (L-04).
- **Failure forms.** A `failure` caused by distance, time or neglect MUST have `warnFirst` (L-07), and every failure leads to a beat (`leadsTo`).
- **Promises.** A seed can't reach `resolved` while a promise without `mayStayOpen` is open: its `opens` beat is done and `paidBy` is not `yes`. Such a seed waits; the lint flags promises that no beat can pay (L-08).

### 2.9 Offers, choices, responses and the unattended plan

```ts
interface OfferSpec {
  stakes: Array<{ bearer: RoleKey | 'client' | 'v'; what: StakeTag }>;
  actions: Array<{ id: string; stance: Stance; foresight: ContentRef; writes?: EffectDecl[] }>;
  nullPath: { id: string; content?: ContentRef };       // the authored option of doing nothing
  lapse: { after: Duration; then: 'unattended' | 'reoffer' | 'withdraw'; content?: ContentRef };
  decline: Array<{ id: string; response: ContentRef }>;
  choice: 'flavour' | 'consequential' | 'unchoice';
  retractQuietly?: ContentRef;         // shown when V retracts with one input; default nothing
}

interface ResponseTemplate {
  to: ActPattern;                      // V's observed act
  because: ConcernRef;                 // required: the NPC concern the act touched
  content: ContentRef;
}

interface UnattendedPlan {
  after: Duration;                     // how long the world takes to settle it without V
  outcome: EffectDecl[];
  events?: EventSpec[];                // off-screen events, minted when it settles
}
```

- **A stake on `v`** (V's money, items, standing) is allowed only as a consequence of an action V accepts (L-15).
- **A consequential choice:** each action's `writes` MUST include a distinct seed-fact value, and that fact MUST have a consumer (L-06).
- **A decision beat's stances** need at least three, including `refuse` (L-14).
- **Honesty.** The language has no construct that states V's feelings, motives or reasons. Callbacks name V's acts (`ActPattern`), never reasons. Response templates without `because` don't compile (L-19).

### 2.10 Profiles

A **profile** is a pack-provided partial seed with parameters. It is data:

```ts
interface Profile { id: ProfileId; version: number; params: ParamSchema; body: Partial<Seed>; lint?: LintId[] }
```

**Expansion** happens before compiling:
1. Substitute parameters into `body`.
2. Merge the seed over the expanded body, field by field. The seed's own values win, except where the body marks a part `fixed`: then the seed may not change it (L-02).
3. Add the profile's own lint rules to this seed's checks.

Profiles shipped with the first content pack:
- **gig**;
- **job and heist**;
- **con**;
- **four-beat**;
- **relationship ladder**.

[P4 §3.8](../p4-seeding-layer.md#38-profiles-shapes-as-data) gives their shape. The ladder's own rules are lint checks (L-10, L-11, L-16, L-23):
- at least three exits;
- an `intimate` scene class that only a human-authored pack scene can fill;
- pacing counted from V's acts;
- boundaries only an authored event revises.

### 2.11 Variation, latitude and adaptation

```ts
interface Variation {
  modes?: Array<{ id: string; weight: number }>;               // drawn first
  variants?: Array<{ id: string; weight: number; rare?: Pred; parts: Partial<Seed> }>;
  strata?: string[];                   // hints for S3's stratified sampling
}

interface Latitude {
  allow: MaterialKind[]; forbid: MaterialKind[];
  authoredOnly: PartPath[];            // parts fitting must never fill or change
  historyHook?: { kinds: ActPattern[] };
}

interface AdaptationPoint { part: PartPath; cost: 'cheap' | 'moderate' | 'costly' }
```

- **A rare variant** is eligible only while its `rare` predicate is `yes`.
- **`MaterialKind`** is a closed vocabulary in S4. Its starter set: `callback`, `hook`, `holocall-hook`, `bridge-beat`, `stand-in`, `new-named-character`, `location-swap`, `delay`.
- **Skeleton features.** The compiler computes them through a registry function: `verb`, `stake`, `relationship`, `outcome`, `tone` and `channel`. They are read-only, for the arbiter, S3 and the tests.
- **Variety provenance.** Every offer records which mode, variant and alternates produced it (§10.1).

### 2.12 Timing requests

```ts
interface TimingRequest {
  kind: 'trace' | 'pin' | 'bark' | 'message' | 'call' | 'approach';
  importance: 'low' | 'normal' | 'high';
  purpose: 'introduce' | 'escalate' | 'rest-cue' | 'callback' | 'close';
  tolerates: Partial<Record<AttentionAspect, 'allow' | 'forbid'>>;   // default forbid for combat, driving, dialogue
  maxWait: Duration;                   // on the play clock
  category?: string;
  intensity?: number;                  // −1..1
  form?: Part<'short' | 'standard' | 'full'>;
  onExpire?: 'retry' | 'unattended' | 'withdraw';   // if it waits maxWait unreleased (§8.3)
}
```

`AttentionAspect` is S5's vocabulary. A beat's request is the seed's `timing`, overridden by the fragment's channel ladder and the beat's `scale`.

**Defaults** for a seed without `timing`:
- `kind: 'message'`;
- `importance: 'normal'`;
- `purpose: 'introduce'`;
- `maxWait: { clock: 'play', s: 1800 }`;
- `onExpire: 'retry'` for authored seeds and `'unattended'` for procedural ones.

**Play-clock durations across a load.** The play clock restarts at a load (§8.2). A play-clock duration that was running (`maxWait`, a lapse, a category timer) restarts from the load. Game-clock durations don't.

## 3. Compiling

### 3.1 The steps

Compiling an instance runs once, at sowing, and again after a pack update (§12.3):
1. **Expand** the profile (§2.10).
2. **Draw the mode, then the variant** (§3.4), and merge the variant's `parts`.
3. **Lint** (§11.1). An error refuses the seed. The refusal is recorded, and the instance is never sown.
4. **Mint** the seed node and its seed facts.
5. **Open the seed's frames** (§3.3).
6. **Add the pack-level contributions:** world requirements that name no role. Requirements that name a role are added at commit (§5.3).

### 3.2 What compiles to what

| Seed construct | Kernel material | Layer or reason | When |
|---|---|---|---|
| A fixed world requirement | `constrain` contribution, `Set` or `Const` form | The seed's layer (below) | At sowing, or at commit if it names a role |
| A preferred world requirement, strength `k` | `weight` contribution, `strength = k` | The seed's layer | As above |
| A role's identity, `must` and `prefer` | Casting query terms (§5) | — | At casting |
| A committed cast | `core:cast` edge, seed → node, `data.role` | Cause: the release (§6.3) | At commit |
| A role's `goal` | A goal frame on the cast node, parent the seed's role frame (§5.3) | — | At commit |
| A role's `authored` beliefs and edges | Beliefs (source `inferred`, rule `seed`) and edges | Cause: the seed | At commit |
| A seed-fact write | Pin on `value`, reason `committed` | 300 | When the writing beat or action completes |
| A game-fact write | A `story.write-vanilla` request to the game port (S5) | — | As above |
| A `kernel` effect | A `core:event` with that effect, committed | — | As above |
| An offer shown, and V's response | `core:event` of kind `offer`, then `response`, with V as witness | Canon (observed) | When shown, and when answered |
| A window | `reactsTo` interests on the seed's window frame (§3.3) | — | At sowing |

**The seed's layer** comes from who sowed it:

| Sown by | Contribution layer | Precedence |
|---|---|---|
| An authored pack | `authored` | 400 |
| A plugin through `story.seed@1` | `authored`, if the plugin declares itself an authoring source; else `procedural` | 400 or 100 |
| The procedural engine | `procedural` | 100 |

Commitments are `committed` pins (300) whoever sowed the seed. A procedural seed's wishes therefore yield to the simulation (200) until committed, and its commitments then hold against it.

### 3.3 The seed's frames

Each instance has two frames on its own node, opened at sowing:
- **The window frame,** `level: 'goal'`, weight 1, with one `reactsTo` interest per fact node read by any window, `context` or `sow` predicate: `{ kind: core:game-fact | core:seed-fact, scope: { nodes: [fact] }, slot: 'value' }`. Role predicates add interests on the cast node once it's cast.
- **One role frame per role,** `level: 'goal'`, weight 1, child of the window frame. It focuses on the cast node once cast.

Both are active while the seed is live, and are closed (`satisfied` or `abandoned`) when it ends. Through them the kernel tells the seed when the world moves towards it or away from it: there is no polling, except for time-based atoms (§6.2).

### 3.4 Layer-2 draws

Layer 2 makes these choices with the kernel's draw arithmetic (S0 §1.3 and §5.4), on its own keys:
- modes;
- variants;
- alternates;
- channels;
- scale forms;
- casting among candidates (§5.2).

For a choice `c` among options `F`, with `s = seedId`:

```
score(o)  = ln w(o) + Σ_parts strength · ln K · [o is the preferred value]  + Σ_fit fitWeight(o)
g(o)      = −ln(−ln(rand("seed-draw", worldSeed, s, c, attempt, o)))
choice    = argmax over o ∈ F of (score(o) + g(o)); exact ties to the lower H("tie", worldSeed, s, c, o)
```

- **`w(o)`** is the option's declared weight, or 1.
- **`K`** is **[tunable 8]**.
- **`fitWeight`** comes from S3's fitting hook. It is 0 with the director off.
- **A fixed part** makes `F` its single value.
- **`attempt`** starts at 0. It increments only when the same choice is legitimately re-made (a re-offer, a re-cast after relaxing).

The draw is recorded in the seed's state, so a reload re-uses it rather than re-drawing.

### 3.5 Watching fixed parts

A fixed world requirement can lose arbitration to a higher layer without the kernel reporting a contradiction ([DS-67](../design-seeds.md)), because only rejected constraints at 600 or above set `contradiction`. So layer 2 watches its own:
1. **When.** After adding a fixed requirement, and on every relevance delivered to the seed's frames, layer 2 calls `trace` (S0 §13) on each fixed requirement's target.
2. **What counts as rejected.** A requirement whose constraint is marked rejected is **rejected**.
3. **What follows.** The requirement's `ifRejected` applies:
   - `withdraw`: the seed goes to `withdrawn` (§6);
   - `degrade`: the requirement is ended, and the seed continues without it;
   - `refit`: S3 is asked to re-fit the part within `latitude`. With the director off, `refit` acts as `degrade`.
4. **Recording.** Every rejection writes a `fixed-rejected` record entry (§10.1), whatever the policy.

A fixed role identity is watched differently: through `onLost` (§5.5).

## 4. Re-evaluation

A live seed **re-evaluates** when:
- a relevance event reaches one of its frames;
- a simulation window boundary passes and the seed has `hour` or `since` atoms;
- an arbiter result for one of its requests arrives (§8);
- V responds to one of its offers;
- another seed it reads (`seed` atoms) changes state.

Re-evaluation is a worklist item (S0 §10.7), processed in seed `Id` order. Re-evaluating:
1. updates the window states and latches (§2.7);
2. watches fixed parts (§3.5);
3. updates beat availability (§7.1);
4. applies the lifecycle transitions (§6).

## 5. Casting

### 5.1 Order

Roles are cast in this order:
1. Anchor roles, by `order`, then by key.
2. Roles that other roles' predicates name, before those roles. A cycle among role references is a lint error (L-13).
3. The rest, fail-first: the role with the fewest candidates in the previous attempt goes first; ties by `order`, then key.

### 5.2 Casting one role

1. **A role with a fixed identity** has one candidate: that node. It is cast if every `must` holds (`yes`); otherwise it is unfilled.
2. **Otherwise** run the kernel query (S0 §8):
   - `find`: the role's kind;
   - `scope`: the role's scope, with role references resolved;
   - `must`: the role's `must` predicates;
   - `prefer`: none;
   - `limit: 'all'`.
3. **Remove** candidates held by another live seed's cast under an exclusive claim that overlaps this one (§9.2), unless both claims share.
4. **Choose** by the layer-2 draw (§3.4) over the remaining candidates:
   - `w(o) = 1`;
   - each `prefer` term that holds for `o` adds `strength · ln K`;
   - each fragment in the role's `repertoire` that S1 lists in `o`'s repertoire adds `ln K`.
5. **Results:**
   - an empty set means the role is **unfilled**;
   - a query that returns `failed` means **unfilled**, with reason `too-broad`;
   - otherwise the choice is the role's **tentative cast**.

**Casting is read-only.** Tentative casts live in layer-2 state only. They add nothing to the kernel, so the kernel's revision doesn't change. A trial cast needs no fork.

### 5.3 Committing

Roles commit at the seed's first **release** (§6.3). A role that no beat uses before then commits when the first beat that uses it starts.

Committing a role:
1. Adds the `core:cast` edge, valid from now until the seed ends.
2. Adds the role's world requirements, scoped to the cast node.
3. Opens the role's `goal` frame on the cast node, if it has one. Its parent is the seed's role frame, at edge weight 1. Opening it runs the kernel's cross-pressure check (S0 §10.8).
4. Adds `authored` beliefs and edges.

The cast edge makes the cast node a retention root (S0 §7.3), so a cast person is never forgotten while the seed is live.

### 5.4 When a role can't be filled

The role's ladder `onUnfilled` runs in order. The default is `['wait', 'withdraw']`.

| Step | Effect |
|---|---|
| `wait` | Stay `waiting`, and re-cast on each re-evaluation, until a window closes or `{ wait: d }` runs out |
| `{ relax: [i, …] }` | Demote the named `must` terms to preferences one at a time, re-casting after each |
| `standIn` | Mint a new node of the role's kind, `H("mint", seedId, seedId, "role:" + key)`, and add the role's `must` terms as fixed world requirements on it. Resolution generates the rest. Allowed only for roles without a fixed identity (L-18) |
| `shrink` | Allowed only for `optional` roles. The role is dropped; beats that bind it are `skipped`. If that makes `end` unreachable (§7.4), the next step runs |
| `withdraw` | The seed goes to `withdrawn` |

### 5.5 Re-checking at play time

When a beat that binds a committed role starts, the role is re-checked against its `must` terms only. Preferences are not re-checked. If a `must` term is now `no`, the role is **lost**, and `onLost` applies:
- `withdraw`;
- `standIn`, as above, for this beat onwards;
- `shrink`, if optional.

A `maybe` is not a loss; the beat waits.

## 6. The lifecycle

### 6.1 States

| State | Meaning |
|---|---|
| `sown` | Compiled and live, not yet evaluated |
| `waiting` | The seed is pending, or a non-optional role is unfilled |
| `cast` | Open, with every non-optional role tentatively cast; its first request is with the arbiter |
| `offered` | An offer has been released and is awaiting V's response |
| `running` | Its beats are unfolding |
| `unattended` | V declined, retracted or let the offer lapse; the unattended plan is settling |
| `resolved` | Terminal: the end state was reached, with or without V |
| `withered` | Terminal: every window closed before the seed resolved |
| `withdrawn` | Terminal: withdrawn by its source, by a ladder, or by a rejected fixed part |

Terminal states are final. The seed's frames close, its cast edges end, and its world requirements end.

### 6.2 Transitions

Each transition writes a `SeedState` op (§12) and a record entry. They are checked in this order at every re-evaluation, and the first that applies fires. Then evaluation repeats until none applies, at most 8 times per re-evaluation **[tunable]**.

| # | From | Condition (all `yes`) | To | Effects |
|---|---|---|---|---|
| T1 | any live | Source withdrawal, a rejection with `withdraw`, a ladder that reached `withdraw`, a lapse with `then: 'withdraw'`, or an expiry with `onExpire: 'withdraw'` | `withdrawn` | End everything (§6.1) |
| T2 | `sown`, `waiting`, `cast` | The seed is closed (§2.7) | `withered` | Play `closeContent` for coda or memory through the arbiter, then end |
| T3 | `running`, `offered` | Any window with `holdsWhileRunning: false` closed | `withered` | As T2. Running beats stop |
| T4 | `sown`, `waiting` | The seed is open, `context` is yes, and every non-optional role has a tentative cast | `cast` | Submit the first request (§8) |
| T5 | `sown` | Otherwise | `waiting` | — |
| T6 | `cast` | The seed is no longer open, `context` is no longer yes, or a tentative cast was lost | `waiting` | Withdraw the pending request |
| T7 | `cast` | The arbiter released the first request, and it was an offer | `offered` | Commit (§5.3); mint the `offer` event |
| T8 | `cast` | The arbiter released the first request, and it was a beat with no offer | `running` | Commit; start the beat |
| T9 | `offered` | V accepted (a `response` event) | `running` | Start the beats after the offer beat |
| T10 | `offered` | V declined or retracted; or the lapse ran out with `then: 'unattended'` and the offer was exposed (§10.2) | `unattended` | Decline: its response content. Retract: `retractQuietly`, if any. Lapse: its content |
| T11 | `offered` | The lapse ran out with `then: 'reoffer'`, or the lapse ran out and the offer was never exposed | `cast` | `attempt` + 1 for the offer's draws |
| T11a | `cast` | The first request expired unreleased with `onExpire: 'unattended'` | `unattended` | — |
| T12 | `running` | `end` is yes and no promise blocks (§2.8) | `resolved` | Write `seed-outcome`; end |
| T13 | `unattended` | The plan's `after` has passed since entry | `resolved` | Apply `outcome`; mint its events; write `seed-outcome` |

**Deterministic ids.** An offer's event `Id` is `H("mint", seedId, seedId, "offer:" + beat + ":" + n)`, where `n` counts earlier offers from that beat in this instance. A reload therefore shows the same offer (PR-13).

**The world goes on.** A declined or ignored seed doesn't vanish: its client's blocked goal and the unattended plan settle without V ([dossier 9](../craft/d09-agency-consequence.md)).

### 6.3 Releases

A **release** is the arbiter letting one of the seed's requests through (§8). The first release commits the seed. Before it, nothing about the seed has reached V or changed the world beyond its pack-level contributions.

## 7. Beats at run time

### 7.1 Beat states and availability

| State | Meaning |
|---|---|
| `locked` | Its incoming links aren't satisfied |
| `available` | Its links are satisfied; it's waiting for the arbiter or V |
| `running` | Started |
| `done` | Completed |
| `skipped` | A shrunk role, an unchosen branch, or a cancelled aftermath |
| `failed` | Its objective failed; its `failure.leadsTo` beat becomes available |

**A beat becomes `available`** when all of the following hold:
1. The seed is `running`, or the beat is in `start`.
2. Its links are satisfied:
   - each `because` link's beat is `done` and its `on` is yes, joined by `join`;
   - no `obstructedBy` beat is `available` or `running`;
   - for `then` links, the beat named is `done`.
3. Its fragment's `needs` is yes.
4. Fewer than `maxLive` beats are live.

Ties among beats that could become available are broken by key.

### 7.2 Choosing the fragment

For `{ alternates: [...] }`:
1. Keep the alternates whose `applies` is yes. Drop those excluded by `repeat`, or by a `minGap` not yet passed.
2. Keep the most specific: those with the most atoms in `applies`.
3. Choose among them by the layer-2 draw (§3.4) with key `"alt:" + beat`.

If none remains, the beat waits. If the seed is `running` and a window closes meanwhile, T3 applies.

### 7.3 Running a beat

**Release first, where needed.** A beat with a player-facing fragment (an offer, a message, a call) is released through the arbiter. A background beat starts without one:
- `salience: 'background'` with a class-0 channel;
- or a beat with no channel.

**Running.** While it runs, its `objective` is tracked:
- `succeeds` yes means `done`;
- `fails` yes means `failed`;
- `warns` yes plays its warning through the arbiter.

A beat without an objective is `done` when its content has played (S7 reports it) or, for background beats, at once.

**On completion,** its `leaves` are written (§3.2).

**Aftermath beats.** On becoming available, the beat waits `delay`. Then it releases its `signpost`, unless `cancelIf` is yes, in which case it is `skipped`.

### 7.4 Reachability

`end` is **unreachable** when no assignment of the remaining beats' outcomes can make it yes. The reference model tests this by trying each remaining beat as done, then as skipped, over the seed-fact writes each would make. Its search is bounded at 2¹² combinations **[tunable]**. If the bound is exceeded, the seed is treated as reachable.

## 8. Requests and the arbiter

### 8.1 Requests

A request is what a seed asks the arbiter to show V:

```ts
interface Request {
  offerOrBeat: Id;                     // the deterministic offer event Id, or H("beat", seedId, beat, n)
  seed: Id; beat: BeatKey;
  timing: TimingRequest;               // §2.12, resolved
  windowClose?: true;                  // set while the seed's window is open: the deadline is its close
  authored: boolean;                   // the seed's layer is authored
  pull: boolean;                       // V asked for it (e.g. V called the contact): spacing and caps don't apply
  submitted: number;                   // play-clock seconds
  provenance: { mode?: string; variant?: string; alternates: Record<BeatKey, FragmentId>; channel: ChannelId; form: string };
}
```

### 8.2 The play clock

The arbiter runs on the **play clock:**
- seconds of unpaused play in the current session;
- it stops in menus, pause, photo mode and loading;
- it does not advance over sleep, waits or fast travel.

Its source is the game port (S5). It is session state and is not persisted. After a load it restarts at 0, and the arbiter starts in **settling** for `settle` seconds **[tunable 30]**.

### 8.3 The release step

The arbiter runs once a second of play:

1. **Expire.** A request is expired when either:
   - it has waited `maxWait`;
   - or it had `windowClose` and its window has closed.

   An expired request was never released, so V saw nothing. It goes back to its seed, which applies the request's `onExpire`:
   - `retry` re-submits it with `attempt` + 1;
   - `unattended` lets the world settle it without V (T11a);
   - `withdraw` withdraws the seed (T1).

   A released offer that gets no answer is not expired; its seed applies the offer's `lapse` (T10, T11).
2. **Hard gates.** These are never relaxed, and a request passes only if:
   1. no vanilla UI state is busy: dialogue, scene, menu, photo mode, loading, or a vanilla call or banner (S5);
   2. none of its forbidden attention aspects is active;
   3. the away marker isn't set, unless the channel is class 0 or 1;
   4. for a push, not a `pull`:
      - at least `spacing` play seconds have passed since the last release **[tunable 60]**;
      - fewer than `cap` releases happened in the last `capWindow` **[tunable 2 per 600 s]**;
   5. its category timer, if any, has run out **[tunable per category; default 300 s]**;
   6. the arbiter isn't settling, unless the request is a `pull`.
3. **Tempo.** The player's tempo setting (S4) scales `spacing` and `cap`:

   | Tempo | Effect |
   |---|---|
   | `calm` | `spacing` × 2 and `cap` × ½ |
   | `steady` | As set |
   | `restless` | `spacing` × ½ and `cap` × 2 |
   | `off` | Only `pull` requests and requests from authored seeds pass |
4. **Phase.** S3's phase hook MAY filter the rest, for example keeping only rest cues during a rest phase. With no director, nothing is filtered.
5. **Score.** S3's scoring hook scores what remains. The built-in fallback is:
   - importance (high 3, normal 2, low 1);
   - plus the fraction of `maxWait` already waited;
   - plus 1 for authored requests.

   Ties go to the lower `H("arb", worldSeed, offerOrBeat)`.
6. **Release** at most one request, and start its timers. The release is logged with the request's provenance and explanation.

**What the arbiter never does.** It holds, delays, expires and releases; it never creates or changes content. Every released push is **retractable by one input** (S5) for `retractWindow` seconds **[tunable 10]**. A retraction reaches the seed as T10's retract.

**Arbiter state** (queues, timers, the settling flag) is session state. After a load it is rebuilt from the live seeds' states: every seed in `cast`, and every `available` beat awaiting release, re-submits its request in seed `Id` order.

## 9. Intersections

### 9.1 Detection

Two live seeds A and B **intersect** when any of the following holds. Detection runs on casting and on re-evaluation, through the seeds' own interests:

| Kind | Condition |
|---|---|
| `claim` | A and B cast the same node, tentatively or committed, with exclusive claims whose spans overlap and that don't both share |
| `effect` | An effect A declares writes a fact, or targets a node, that B reads in `needs`, a window, `context` or `depends` |
| `pressure` | The kernel emits a `Dilemma` whose two frames include a role frame of A and a frame from another origin (B's role frame, or the cast node's own concern) |

### 9.2 Settling

| Kind | Rule |
|---|---|
| `claim` | 1. An authored seed keeps the node; a procedural seed re-casts, excluding it. 2. Between two seeds of the same layer, the one that committed first keeps it; if neither has committed, the lower seed `Id` keeps it. 3. The other runs its role's ladder |
| `effect` | Nothing is blocked. B's `depends` decides: `keep` asks S3 to hold the dependency (a procedural world requirement holding the fact or node as it is); `substitute` re-casts B's role; `notice` only records it |
| `pressure` | Never settled away. It is recorded and handed to S3 as story material ([DS-11](../design-seeds.md)) |

Every intersection writes a record entry on both seeds (§10.1).

## 10. The record and the exposure ledger

### 10.1 The seed record

Each instance keeps an append-only record. Each entry is `{ at: GameTime, play?: number, kind, data, cause }`. The kinds are:
- `transition`;
- `cast`;
- `commit`;
- `release`;
- `response`;
- `beat`;
- `fixed-rejected`;
- `unfilled`;
- `lost`;
- `intersection`;
- `draw`;
- `expired`;
- `lint`.

The record is persisted in `SeedState` (§12). It is what the fit report and `because` citations read. The record is capped at `recordMax` entries per instance **[tunable 512]**. Past the cap, the oldest `draw` and `expired` entries are dropped first; the other kinds are kept.

### 10.2 The exposure ledger

The exposure ledger answers "was V shown this?". It is derived, not stored. It holds:
- every canon event with V among its witnesses: offers, responses, and events V observed;
- every release of a beat whose content S7 reports as displayed.

```ts
type ExposurePattern = { event?: { kind?: string; participant?: RoleKey | Id; effect?: Effect }; fragment?: FragmentId; seed?: TemplateId | Id; since?: Duration };
```

`exposed(pattern)` is yes if any entry matches, and no otherwise. The ledger is rebuilt from the kernel's canon events and the seeds' records after a load.

**Uses:**
- an offer that lapsed without ever being displayed counts as missed, not declined: T10 doesn't apply, and the seed returns to `cast`;
- a hard step MAY require its portent to be exposed first, through `needs: { exposed: … }`;
- a callback may cite only exposed events (L-24).

## 11. Lint and the fit report

### 11.1 Lint

The lint runs at compile time (§3.1) and on demand from authoring tools (S4, P10). An **error** refuses the seed; a **warning** is reported only.

| # | Check | Level |
|---|---|---|
| L-01 | A fact or role a predicate names isn't declared, or a game fact isn't in the facts table | error |
| L-02 | A seed changes a part its profile fixed | error |
| L-03 | A `then` link into a beat that isn't `texture`; or a seed with more than two beats whose links are all `then` | error |
| L-04 | The static count of beats that can be live at once exceeds `maxLive` | warning |
| L-05 | A route variable with no consumer | error |
| L-06 | A consequential choice whose actions don't write distinct values of a consumed fact | error |
| L-07 | A failure caused by distance, time or neglect without `warnFirst` | error |
| L-08 | A promise no beat's `leaves` can pay | warning |
| L-09 | A window with `coda` or `memory` and no `closeContent` | error |
| L-10 | A relationship ladder with fewer than three exits, or an exit with no content | error |
| L-11 | An `intimate` scene filled by anything other than a human-authored pack scene, or without a fade alternative | error |
| L-12 | A game-fact write without the `story.write-vanilla` capability | error |
| L-13 | A cycle among role references | error |
| L-14 | A decision beat with fewer than three stances, or none that is `refuse` | warning |
| L-15 | A stake on `v` not tied to an action V accepts | error |
| L-16 | A gate on a partner fact (a relationship rung that tests V's romance state elsewhere) | error |
| L-17 | Text naming a role attribute not guaranteed by the role's `must` or identity | error |
| L-18 | `standIn` on a role with a fixed identity | error |
| L-19 | A response template without `because` | error |
| L-20 | Text that states V's feelings, motives or reasons (lexicon, S4) | warning |
| L-21 | Second-person reproach or evaluation of V (lexicon, S4) | warning |
| L-22 | Guilt, streak or countdown mechanics: a `fn` atom or effect in S4's forbidden list | error |
| L-23 | A delayed consequence with no early cue: an aftermath without `signpost` | error |
| L-24 | A callback citing an event kind that can't be exposed | warning |
| L-25 | A condition written to fire on `maybe` (`not(… = no)`) | warning |
| L-26 | A conclusion with fewer than three clue routes | error |
| L-27 | An obstacle with fewer than two affordances, or none with `combat: false` | error |
| L-28 | A construct the game port's capability report says is unavailable (a channel, a capability, a write class) | warning, in plain English |
| L-29 | A role that can't be cast in any of the sample states (run by the fit report) | warning |

### 11.2 The fit report

The fit report runs a seed against sample states without changing them, with fixed world seeds.

**Inputs:**
- the seed;
- a list of sample states (a saved kernel record, or a fixture);
- a world seed per sample;
- the director policy (`off` in the first implementation).

**Output, per sample:**

```ts
interface FitReport {
  verdict: 'fits' | 'waits' | 'no-fit';
  why?: string[];                      // plain reasons for waits and no-fit
  windows: Record<string, 'open' | 'pending' | 'closed'>;
  cast: Record<RoleKey, { node?: Id; candidates: number; reasons: string[]; unfilled?: string }>;
  draws: Record<string, string>;       // mode, variant, alternates, channels, forms
  fixedRejected: string[];
  timing: { firstRequest: TimingRequest; channel: ChannelId };
  exits: Array<{ beat: BeatKey; reachable: boolean; leadsTo: string }>;
  declinePreview: { response?: ContentRef; unattendedOutcome: EffectDecl[] };
  connectingMaterial: string[];        // what fitting would add (empty with the director off)
}
```

An author can pin any drawn or fitted choice back into the seed as fixed ([DS-43](../design-seeds.md)). The report shows the `Part` to paste.

## 12. Persistence

### 12.1 The `SeedState` op

S0 §14.2's `SeedState` carries complete data:

```ts
interface SeedStateOp {
  seed: Id;
  template: { pack?: string; id: TemplateId; version: number };
  document?: Seed;                     // only for seeds not in a pack, in their first op
  state: SeedStateName; since: GameTime;
  latches: Record<string, 'closed'>;   // closed windows
  cast: Record<RoleKey, { node: Id; committed: boolean; attempt: number }>;
  roleLadder: Record<RoleKey, number>; // the ladder step reached
  beats: Record<BeatKey, { state: BeatState; since: GameTime; offers: number }>;
  draws: Record<string, { value: string; attempt: number }>;
  unattendedSince?: GameTime;
  record: RecordEntry[];               // §10.1, the entries since the previous SeedState op
}
```

A `SeedState` op is written on every transition, every commit, every beat state change and every draw. Its `record` field carries only new entries; replay concatenates them.

Kernel material the seed writes uses the kernel's own ops:
- edges;
- pins;
- canon events;
- contributions it adds at run time;
- frames.

Contributions compiled from a pack's own templates at sowing are not persisted: they are reloaded with the pack (S0 §14.1).

### 12.2 Loading

After the kernel replays a save (S0 §14.3), layer 2:
1. rebuilds each live instance from its latest `SeedState`;
2. recompiles pack templates;
3. rebuilds the exposure ledger (§10.2);
4. re-evaluates every live seed in `Id` order;
5. rebuilds the arbiter queue (§8.3).

Re-evaluation after a load is silent for the kernel. Its layer-2 transitions are real, and are written as new ops in the new epoch.

### 12.3 Pack updates

```ts
interface Migration { from: number[]; policy: 'continue' | 'migrate' | 'withdraw'; beatMap?: Record<BeatKey, BeatKey> }
```

When a live instance's template has a newer version in the active pack, the new template's `migrate` entry covering the old version applies.
- **With no entry:**
  - `continue`, if every beat key, role key and fact key in the instance's state still exists;
  - otherwise `withdraw`.
- **`migrate`** renames beats by `beatMap`. It is deferred in the first implementation (§0.3).
- **A removed pack** withdraws its live instances (T1). Their committed pins and canon events stay, because history is never undone (S0 §6.6).

## 13. Invariants

| # | Invariant |
|---|---|
| S2-I-1 | **Determinism.** The same documents, world seed, kernel operations and V responses give identical casts, draws, transitions, offer `Id`s and records |
| S2-I-2 | **One door.** Every change a seed makes to the world is a kernel contribution, pin, edge, frame, belief or event whose cause chain leads to the seed, or a game-port write under a declared capability |
| S2-I-3 | **Read-only until commit.** Sowing adds only the seed node, its facts, its frames and pack-level contributions. Casting and re-evaluation before the first release add nothing else |
| S2-I-4 | **Everything that reaches V is released by the arbiter** |
| S2-I-5 | **Nothing is lost silently.** Every refusal, rejected fixed part, unfilled or lost role, expiry, withering and withdrawal has a record entry |
| S2-I-6 | **Reload stability.** After loading a save, an offer shown before the save has the same `Id`, and the seed is in the same state |
| S2-I-7 | **V is not owned.** No seed construct pins V's drives, states V's inner life, or spends V's resources without an accepted action |
| S2-I-8 | **`maybe` fires nothing.** Every transition and availability condition requires `yes` |
| S2-I-9 | **Terminal states are final,** and closed windows stay closed |
| S2-I-10 | **Authored before procedural** in every claim conflict |

## 14. Fixtures

Every fixture uses `worldSeed = H("fixture", <id>)`, a fixture pack `xf.fixture`, the kernel's core schema plus §0.4, and the director off.

| # | Setup | Expected |
|---|---|---|
| SF-1 | **Kleene.** Evaluate `all`, `any` and `not` over every pair of `yes`, `no` and `maybe`; a `fact` atom with no reading; a fact with `decidedBy` false and a reading of 0 | The strong Kleene tables. Both atoms read `maybe`. `not(fact = 1)` with the guard false is `maybe` |
| SF-2 | **Latch.** A window `closes: fact x = 1`. Read x = 1, then x = 0 | The window is `closed` after the first reading and stays closed. The seed withers (T2) once |
| SF-3 | **Casting determinism.** A role over 50 candidate people, two `prefer` terms. Cast twice from the same state, then once after an unrelated pin elsewhere | All three casts are the same node. The kernel revision is unchanged by casting (S2-I-3) |
| SF-4 | **Coupling.** As SF-3. Raise a `prefer` term's strength from 1 to 3 | The cast changes only if the new score makes a different candidate win, checked from the recorded draw |
| SF-5 | **Claim.** An authored seed A and a procedural seed P both prefer the same fixer, exclusive, overlapping | A casts the fixer. P casts someone else, and both records have a `claim` intersection |
| SF-6 | **Fixed part rejected.** An authored world requirement fixes a cast person's `place` to a bar. The game then reads the person elsewhere (500). `ifRejected: withdraw` | After the next re-evaluation, the trace shows the requirement rejected. The seed is `withdrawn`, with a `fixed-rejected` entry. No kernel contradiction |
| SF-7 | **Scenario R1.** The [P4 §5](../p4-seeding-layer.md#5-reference-scenario-r1-in-this-language) seed. Facts: q112 not done; then q112 done and Takemura alive and allied; release; V declines at the first rung | `waiting` (window `maybe`); then `cast`; then `offered` with a deterministic offer `Id`; then the decline exit's content plays, and the seed goes `unattended`, then `resolved` with the unattended outcome |
| SF-8 | **R1, closed by the point of no return.** As SF-7, but the point-of-no-return fact is set while `waiting` | `withered`. The coda is requested through the arbiter |
| SF-9 | **Reload.** SF-7 up to `offered`. Save; load | The same state and the same offer `Id`. The offer is not released again. Its play-clock lapse restarts from the load. The arbiter settles for 30 s |
| SF-10 | **Arbiter gates.** Five pushes submitted at play time 0, spacing 60, cap 2 per 600 | Releases at 0 and 60 (after settling, if after a load); the third waits until 600 |
| SF-11 | **Tempo off.** A procedural push and an authored push, tempo `off` | Only the authored push is released |
| SF-12 | **Lint.** Three seeds: all-`then` links over four beats; a route variable without a consumer; a ladder with two exits | L-03, L-05 and L-10 errors; none is sown |
| SF-13 | **Pressure.** A Tyger Claw's family frame `protects` X. A seed casts the Claw in a role whose goal has `{ kill, X }` | One `pressure` intersection recorded on the seed. The seed is not blocked |
| SF-14 | **Stand-in.** A role with `onUnfilled: ['standIn']` and no candidates | A minted node `H("mint", seed, seed, "role:<key>")`, identical across two runs, satisfying the role's `must` |
| SF-15 | **Missed, not declined.** An offer released but never reported displayed lapses | The seed returns to `cast`, not `unattended` |
| SF-16 | **Promise.** A seed whose end is yes while a promise is open | It stays `running` until `paidBy` is yes, then `resolved` |

## 15. Compromises and open items

| # | The design says | This specification does | Revisit when |
|---|---|---|---|
| C-S2-1 | Every choice uses the same mechanism as the kernel | Content choices use the kernel's draw arithmetic on layer-2 keys, not kernel slots, so `trace` doesn't cover them; the seed record does | A tool needs kernel `explain` on a content choice |
| C-S2-2 | Casting considers the whole city | Casting queries one scope with `limit: 'all'`; a query over the hard limits leaves the role unfilled (`too-broad`) | Large-scope roles become common |
| C-S2-3 | Reachability is exact | A bounded search; past the bound, assume reachable | A seed is wrongly kept alive |

**Open items:**
1. **Dossier 8** (scale, threads and time) is running. Its P4 requirements will amend §2.8 (scale forms, units at each scale) and §8 (thread budgets) before review.
2. **Dossier 6's kernel gaps.** Its eight gaps go into S0 v4 together with §0.4.
3. **The facts table's guards.** It gains `decidedBy` for decision facts. That is data work under WP-12.
4. **Vocabularies.** S4 fixes the closed vocabularies and the honesty lexicon.
5. **Hooks.** S3 defines the fitting, phase and scoring hooks used in §3.4 and §8.3.
6. **The arbiter's split.** P7 decides how much of the arbiter's gate logic runs in the game-side plugin, from the event feed's latency.

## 16. Review record

Not yet reviewed.
