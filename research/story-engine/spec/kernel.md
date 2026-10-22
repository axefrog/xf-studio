# S0. Kernel specification

**Status:** v0 draft for review (22 October 2026). This is the specification stage of the [foundation](../foundation.md): it states exactly how the dimensional model works, so that the reference model can be built from this page alone. It is work package [WP-05](../plan.md#82-work-packages).

**Normative words:**
- **MUST** and **MUST NOT** are requirements.
- **SHOULD** is a strong default that needs a recorded reason to break.
- **MAY** is optional.

A value marked **[tunable]** is a default that configuration can change. Anything this specification does that departs from the foundation is listed in §17 and in the foundation's [compromise ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger).

**Type definitions** are written in TypeScript notation. Their field names and meanings are normative. Physical layout is free, provided the test vectors (§16) pass.

## 0. Scope

**Covered here:**
- identity and hashing;
- the schema of dimensions and kinds;
- nodes, edges and resolution state;
- contributions and how they combine;
- sampling;
- pins and their propagation;
- open, close and forget;
- queries;
- time and events;
- actors, context frames and relevance;
- beliefs;
- groups;
- provenance;
- the logical persistence record;
- invariants and test vectors.

**Not covered here:**

| Topic | Specification |
|---|---|
| Simulation processes and their catalogue | S1 |
| The seed language | S2 |
| Sowing, fitting and the director | S3 |
| Content pack format and player settings | S4 |
| The game port and the companion protocol | S5 |
| The persistence byte format and save keys | S6 |

This specification defines the hooks those specifications plug into.

## 1. Identity and hashing

### 1.1 Identifiers

An `Id` is 128 bits, written as 32 lowercase hexadecimal characters. Every node, edge, contribution, pin, belief, event and frame has one. An `Id` MUST NOT change once assigned.

There are four ways an `Id` is formed:

| Origin | Formula | Used for |
|---|---|---|
| Root | `H("root", worldSeed, rootName)` | The fixed roots: `city`, `director`, `v` |
| Generated | `H("gen", parentId, slotKey, index)` | A node that exists because a slot of its parent was opened |
| Minted | `H("mint", creatorId, causeId, localName)` | A node created by an event, a seed or a process: a newly arrived person, a new crew |
| Mirrored | `H("game", gameKey)` | Something the game owns. `gameKey` is the canonical string of the game's persistent identity, defined in S5 |

A node's `Id` never depends on where it is now. Moving a node changes its edges, never its `Id` (invariant I-11).

### 1.2 The hash `H`

`H` is the first 128 bits of BLAKE3 over the canonical encoding of its arguments. Every implementation MUST use exactly this, so that the TypeScript reference model and the native core agree bit for bit (I-1).

**Canonical encoding.** Arguments are encoded in order, each as a one-byte type tag followed by its bytes:
- `0x01` UTF-8 string: a u32 little-endian byte length, then the bytes;
- `0x02` signed 64-bit integer, little-endian;
- `0x03` `Id`: 16 raw bytes;
- `0x04` IEEE 754 binary64, little-endian, with negative zero normalised to positive zero and NaN forbidden;
- `0x05` boolean: one byte, 0 or 1.

**Unit values.** `toUnit(h)` takes the first 53 bits of `h` as an unsigned integer and divides by 2^53, giving a number in [0, 1).

### 1.3 The world seed

Each save lineage has a 128-bit `worldSeed`. It is chosen once, when the engine first meets a playthrough, from a cryptographic random source, and is stored in the lineage's root record (S6). Every save descended from that playthrough shares it. A new game gets a new seed.

## 2. Schema: dimensions and kinds

The schema is data. Engine releases ship the core schema, and content packs MAY add to it (S4). Each schema item has a namespaced id, `<namespace>:<name>`, for example `core:person` or `xf.takemura-pack:hideout`.

### 2.1 Dimensions

```ts
interface DimensionDef {
  id: DimId;
  value: ValueType;
  structure: 'none' | 'order' | 'metric' | 'cyclic' | 'graph';
  prior: FnRef;          // base distribution when nothing contributes (§5)
  valueKind?: KindId;    // the kind a value opens into (no atoms, foundation §4 rule 7)
  buckets?: FnRef;       // maps a value to interest-key buckets (§10.5)
}

type ValueType =
  | { t: 'enum'; values: string[] }                       // canonical order is the list order
  | { t: 'int'; min: number; max: number }
  | { t: 'real'; min: number; max: number; quantum: number }   // sampled on the quantum grid
  | { t: 'cyclic'; period: number; quantum: number }
  | { t: 'vec'; n: number; min: number; max: number; quantum: number }
  | { t: 'ref'; kind: KindId }                            // a node of that kind (an edge, §3.3)
  | { t: 'text'; grammar: FnRef };                        // generative text, such as names
```

`FnRef` is `{ name: string; version: number }`. It names a pure function in the engine's function registry: a prior, a grammar, a derivation, a falloff, a bucket map, an upward rule, or an attribution rule's predicate. Content packs reference registry functions with parameters. They MUST NOT supply code (content is data, [DS-38](../design-seeds.md)). New functions arrive with engine versions.

### 2.2 Kinds

```ts
interface KindDef {
  id: KindId;
  extends?: KindId[];                  // slots are inherited; a redefined key overrides
  slots: SlotDef[];
  facets?: Array<'actor' | 'group' | 'place' | 'event'>;
  tags?: string[];                     // static tags, used for interest keys
}

interface SlotDef {
  key: string;                         // [a-z0-9-]+, unique within the kind after inheritance
  dim: DimId;
  card: 'one' | { many: { count: DimId } };   // how many is itself sampled
  mode: 'sampled' | 'derived' | 'mirrored';
  derive?: FnRef;                      // required for 'derived': pure f(parent value, sibling values)
  conditioned?: FnRef;                 // optional: prior for this slot given the parent's value (§6.2)
  up?: FnRef;                          // optional: how a pin here narrows the parent's value (§6.3)
  tier: Tier;                          // the coarsest level of detail at which this slot may open
}

type Tier = 0 | 1 | 2 | 3 | 4 | 5;     // city, district, block, scene, individual, fine detail
```

**`mirrored` slots** are owned by the game. They are read through the game port (S5) and enter the kernel as `game` pins (§6), never sampled. A slot MAY be `mirrored` for mirrored nodes and `sampled` for generated nodes of the same kind. The node's origin decides which applies.

### 2.3 Edge types

```ts
interface EdgeTypeDef {
  id: EdgeTypeId;                      // e.g. core:located-in, core:member-of, core:kin, core:knows
  from: KindId[]; to: KindId[];
  attrs: Record<string, DimId>;        // edge attributes are dimensions too
  inverse?: EdgeTypeId;
  symmetric?: boolean;
}
```

## 3. Nodes, edges and resolution state

### 3.1 Nodes

```ts
interface Node {
  id: Id;
  kind: KindId;
  origin:
    | { by: 'root'; name: string }
    | { by: 'generated'; parent: Id; slot: string; index: number }
    | { by: 'minted'; creator: Id; cause: Id; name: string }
    | { by: 'mirrored'; gameKey: string };
  slots: Map<SlotPath, SlotState>;     // only slots that have been opened
  touched: GameTime;                   // last access, for forgetting (§7.3)
}

type SlotPath = string;                // "key" or "key[index]" for many-slots

type SlotState =
  | { s: 'open' }                                            // opened, not resolved
  | { s: 'resolved'; value: Value; fingerprint: Id };        // computed, regenerable (a cache)
```

**Pins are not stored in the slot state.** They live in the pin store (§6), because pins persist and caches don't. A slot's effective state is its pins (if any) combined with its slot state.

### 3.2 Regions

A `Region` is a subset of one dimension's values:

| Value type | Region form |
|---|---|
| `enum` | A bitset over the value list |
| `int`, `real`, `cyclic` | A sorted list of closed intervals. Cyclic intervals wrap |
| `vec` | An axis-aligned box list |
| `ref` | An explicit set of `Id`s, or a selector (§4.2) |
| `text` | A conjunction of named component constraints defined by the grammar, such as `given = "JimBob"` or `syllables in [2, 2]` |

Every region form MUST support intersection, emptiness testing and membership testing.

### 3.3 Edges

```ts
interface Edge {
  id: Id;
  type: EdgeTypeId;
  from: Id; to: Id;
  attrs: Record<string, Value>;
  valid: { from: GameTime; to?: GameTime };   // ended edges stay in the record as history
  cause: Id;                                  // provenance (§13)
}
```

A `ref` slot's value is an edge of the implicit type `slot:<kind>.<key>`, so every relationship is an edge. Edges are the relationship substrate of the foundation: a dimension is a family of edges of one kind.

### 3.4 Addresses

An `Address` is a starting node `Id` followed by a path of `SlotPath` steps, written `node/slot/slot[2]/…`. Resolving an address walks the path, opening slots as needed (§7.1). Many addresses can reach the same node. The `Id` is the identity; the address is one view of it ([DS-57](../design-seeds.md)).

## 4. Contributions

### 4.1 The contribution record

```ts
interface Contribution {
  id: Id;
  source: { layer: Layer; origin: Id | string; precedence: number };
  target: Selector;                    // which (node, slot) pairs it applies to (§4.2)
  form: Form;                          // what it says (§4.3)
  mode: 'constrain' | 'weight' | 'replace-prior';
  strength: number;                    // > 0, scales log-weights in 'weight' mode [default 1]
  valid: { from?: GameTime; to?: GameTime };
  perspective: 'world';                // beliefs use §11, not contributions (ledger C-02)
}

type Layer = 'observation' | 'game' | 'authored' | 'seeding' | 'simulation' | 'procedural';
```

**Precedence**, used only to settle conflicts between hard constraints (§5.3). It MUST follow this order:

| Source layer | Precedence |
|---|---|
| `observation` | 600 |
| `game` | 500 |
| `authored` (fixed) | 400 |
| `seeding` (committed) | 300 |
| `simulation` | 200 |
| `procedural` | 100 |

Within a layer, ties are broken by higher `strength`, then by lower `Id`.

### 4.2 Selectors

```ts
interface Selector {
  kind?: KindId;                       // matches this kind and its descendants
  slot: SlotPath | '*';                // '*' for node-level predicates only (queries)
  scope?:
    | { under: Id }                    // nodes whose generation chain or located-in chain contains this Id
    | { nodes: Id[] }
    | { region: SpatialRegion };       // nodes whose position slot falls in a box or radius
  where?: Predicate[];                 // further conditions, as in queries (§8.1)
}
```

A selector MUST be testable on a single node, and MUST give a conservative answer (`no`, `maybe`, `yes`) on a region of unopened nodes (§8.2).

### 4.3 Forms

| Form | Definition | What it yields at a node | Bounds over a region |
|---|---|---|---|
| `Const(v)` | A single value | A set {v}, or a weight of 1 on v | {v} |
| `Set(region, allow)` | Allowed or forbidden values | A set | The region |
| `Dist(weights)` | Explicit weights over enum, int or ref values | A weight function | Each weight's [min, max] is itself |
| `Field(base, points, map)` | Control points over a base slot (usually `position`), each `{ at, value, radius, falloff }`. Falloff is `linear`, `smoothstep` or `gaussian`. Combined by `sum` or `max`, then mapped to target weights by `map` (an `FnRef`) | A weight function | [min, max] of the field over the region's extent, mapped |
| `Rule(when, then)` | `when` is a predicate list on other slots of the same node or its ancestors; `then` is another form | The `then` form if `when` holds, else nothing | `then`'s bounds if `when` is `maybe` or `yes` |
| `Derive(fn, inputs)` | A pure function of input slot paths | A single value (for `derived` slots) or a weight function | Computed from the inputs' bounds by `fn`'s bound function, which every derive function MUST provide |

Every form implementation MUST provide `evaluate(node) → Factor` and `bounds(region) → FactorBounds`. A factor is either a set, which only `constrain` mode may use, or a strictly positive weight function over the target's values. A zero weight means "excluded" and is treated as a constrain.

## 5. Resolution (Sample)

### 5.1 Algorithm

`resolve(node, slotPath)` returns a value as follows. Every step is deterministic.

1. **Pins.** If a value pin exists for `(node, slotPath)` (§6), return its value.
2. **Derived slots.** If the slot is `derived`, return `derive(parent value, sibling values)`, resolving those inputs first.
3. **Mirrored slots** on mirrored nodes: if no `game` pin is present, ask the game port to read it now (S5). If the read fails, the slot is `open` and the caller gets `unavailable`.
4. **Gather.** Collect every contribution whose selector matches `(node, slotPath)`, that is valid at the current game time, and that has not been overruled at this node (§5.3).
5. **Feasible set** `F` is the intersection of:
   - the dimension's domain;
   - every `constrain`-mode factor;
   - every region pin on this slot (§6.1);
   - the downward constraints from the parent's pinned value (§6.2);
   - the upward constraints from this value's own pinned children (§6.3).

   If `F` is empty, resolve the conflict by §5.3, then continue.
6. **Prior.** `P0` is the slot's `conditioned` prior given the parent's value, if the slot has one. Otherwise it is the dimension's `prior`. If any `replace-prior` contributions apply, the one with the highest precedence (then strength, then lowest `Id`) replaces `P0`.
7. **Score.** For each `v` in `F`: `logw(v) = log P0(v) + Σ strength_c · log f_c(v)` over the `weight`-mode contributions `c`. The result is a log-linear model, or product of experts.
8. **Draw.** Let `u = toUnit(H("u", worldSeed, node.id, slotPath))`.
   1. Order `F` canonically: enum list order; numbers ascending on the quantum grid; refs by `Id` ascending; text by the grammar's canonical enumeration order.
   2. Normalise the weights and return the value at which the cumulative weight first exceeds `u`. This is the inverse cumulative distribution.
   3. Text slots use the grammar's sampler instead, with a pseudo-random stream seeded by `H("text", worldSeed, node.id, slotPath)`, under `F`'s text region (§17, C-04).
9. **Cache** the result as `{ s: 'resolved', value, fingerprint }`. The fingerprint is `H` of the sorted `Id`s of every contribution and pin used, and of the parent's value. A cache entry is valid only while its fingerprint still matches.

### 5.2 Stability

Because `u` depends only on the seed, the node and the slot, a small change to the weights changes the result only when `u` lies in the mass that moved. This is invariant I-7. It is why one changed contribution reshuffles almost nothing.

### 5.3 Conflicts

If the hard constraints leave `F` empty:
1. Order the conflicting constraints by precedence, lowest first. A constraint takes part if removing it would make `F` non-empty, alone or together with the constraints removed before it.
2. Drop the lowest-precedence constraints one at a time, re-intersecting after each, until `F` is non-empty.
3. Mark each dropped contribution `overruled` at this node, and write a `Conflict` record: node, slot, dropped, kept, time.
4. **Observation constraints are never dropped.** If two observation pins conflict:
   - when the earlier one is a region pin and the later one a value pin inside it, the value pin stands, because it is a narrowing;
   - otherwise both stand. The slot reports `contradiction`, which is a perception defect for inspection (P10), and resolution uses the later pin.

## 6. Pins and propagation

### 6.1 The pin record

```ts
interface Pin {
  id: Id;
  node: Id; slot: SlotPath;
  value?: Value;                       // a value pin fixes the slot
  region?: Region;                     // a region pin narrows it (partial knowledge)
  reason: 'observed' | 'game' | 'authored' | 'committed' | 'derived';
  at: GameTime;
  cause: Id;                           // the event, contribution or seed that pinned it
}
```

Exactly one of `value` and `region` is set. Pins are hard constraints in the world perspective. Beliefs are never pins on the subject (§11).

`pin(node, slot, valueOrRegion, reason, cause)`:
1. resolves the slot's current feasible set;
2. if the new value lies outside it, records a conflict (§5.3) unless the reason is `observed` or `game`, which always prevail over lower layers;
3. stores the pin;
4. invalidates the caches whose fingerprints include this slot.

### 6.2 Downward propagation

When a slot with a `valueKind` holds a pinned value `v`:
- the value's **derived** child slots are computed from `v`;
- its **sampled** child slots use their `conditioned` prior given `v`, if one is defined.

Example: pinning a name pins its letter count by derivation, and conditions its likely origin. "How the person came by the name" stays open.

### 6.3 Upward propagation

When a child slot of a value node is pinned, the child's `up` function maps the pin to a region on the parent slot. That region joins the parent's feasible set (§5.1, step 5).

Example: pinning `name.given = "JimBob"` narrows `person.name` to the names whose given part is "JimBob". A later full-name pin MUST lie inside that region, or it is a conflict.

### 6.4 Removing pins

A pin is removed only in two cases:
- the source that created it withdraws it, which is a recorded operation: an authored pack uninstalled, or a seed withdrawn by its owner;
- its save branch is discarded.

Observations are never withdrawn.

## 7. Open, close and forget

### 7.1 Open

`open(node, slotPath)` creates `{ s: 'open' }` for the slot. For a `many` slot, it first resolves the count (itself a slot, `<key>#count`). Children are generated lazily, when first addressed, with generated `Id`s (§1.1).

A slot MAY be opened only when the node's **demand tier** (§10.6) is at least the slot's `tier`. A query (§8) or a seed (S2) may open below that tier within its own budget, and the open is attributed to it.

### 7.2 Close

`close(node, depth)` discards the `resolved` caches and the generated, unreferenced descendants below `depth` levels. Pins and their nodes are untouched.

### 7.3 Forget

Forgetting is mark and sweep, run at most once per evolve tick, within budget. The roots are:
- every node that carries a pin, and its origin chain up to a root;
- every node at either end of a persistent edge (§14);
- every node referenced by a canon event, a live seed (S2) or a memorable belief;
- every node in the focus of an active context frame (§10);
- every mirrored node the game currently has streamed in.

Everything else MAY be swept. A swept node MUST regenerate identically when next addressed, provided its contributions are unchanged (I-3).

## 8. Queries

### 8.1 The query record

```ts
interface Query {
  find: KindId;                         // the kind of node wanted
  scope: Selector['scope'] | { roots: Id[] };
  must: Predicate[];                    // hard conditions
  prefer?: Array<{ p: Predicate; weight: number }>;
  limit: number;
  budget: { opens: number; evals: number };
}

interface Predicate {
  path: string;                         // slot path from the candidate node, may cross ref slots
  op: 'in' | 'not-in' | 'range' | 'eq' | 'field-at-least' | 'field-at-most' | 'has-edge' | 'lacks-edge';
  arg: Value | Region | { edge: EdgeTypeId; to?: Id | Selector };
}
```

### 8.2 Algorithm: branch and bound

The search space is a tree of candidate regions:
- a region is an unopened node (standing for its future descendants) or a spatial cell from the world index (S1);
- its children are the region's slots or sub-cells.

1. **Seed.** Start the frontier with the scope's roots.
2. **Classify.** Pop the frontier entry with the highest upper bound on preference score. For each `must` predicate, compute `bounds` over the region from its pins and from the `bounds()` of every applicable contribution. The predicate's verdict is `no`, `maybe` or `yes`.
3. **Prune** any region where any predicate is `no`.
4. **Descend.** A region that is `maybe` on some predicate is split into its children. Splitting computes the children's bounds without materialising them, through generated `Id`s and contribution bounds. A region that is `yes` on every predicate and is a single node of the wanted kind is a candidate.
5. **Confirm.** Candidates are resolved for real (§5), which materialises them and counts against `budget.opens`, then re-checked exactly.
6. **Score and return.** Score confirmed candidates by `prefer`. Return the top `limit`, each with an explanation trace (§13).

**When the budget runs out,** return the best confirmed candidates so far, flagged `incomplete`.

**Soundness.** Every `bounds()` MUST be conservative: it may say `maybe` when the truth is `no`, never `no` when the truth is `maybe` or `yes`. A complete search therefore never misses a qualifying node (I-6).

## 9. Time, events and evolution

### 9.1 Time

`GameTime` is a signed 64-bit count of game seconds since the lineage's epoch. S5 defines how it maps to the game's clock. Time is also a dimension (`core:time`, metric) for queries and contributions.

### 9.2 Events

Events are nodes of kind `core:event`:

| Slot | Meaning |
|---|---|
| `time` | When it happened |
| `place` | Ref to a place node |
| `kind` | An enum from data, such as `collision`, `robbery` or `order-given` |
| `participants` | Many: ref plus role |
| `witnesses` | Many: ref |
| `causes` | Many: refs to events or contributions |
| `effects` | Many: refs to pins, edges, contributions and beliefs |

An event is **canon** when V observed it, a seed committed it, or one of its effects is persisted. A canon event is pinned in full and persisted (§14).

**Summary events** cover detail nobody looked at: `{ kind, placeRegion, interval, count, distribution }` at a coarse tier ("about three robberies in Kabuki this week"). When a query or relevance needs one of them, individual events materialise from the summary as minted nodes with `Id = H("mint", summaryId, "item", index)`, and their values are drawn consistently with the summary.

### 9.3 Evolution

Simulation processes are specified in S1. The kernel requires:
- **The definition.** Each process is a `ProcessDef { id, tier, period, inputs: Selector[], run }`. `run(ctx, from, to)` returns contributions, pins, events and edges, and MUST handle any interval `to − from` in bounded work: a closed form, or at most a fixed number of sub-steps. Long absences therefore cost no more than short ones.
- **The order.** `evolve(now)` runs every due process, coarsest tier first. Tiers 0–1 always run. Finer tiers run only within regions whose demand tier (§10.6) reaches them.
- **Determinism.** Process outputs are deterministic given the world seed, inputs and interval. Process randomness uses `H("proc", worldSeed, processId, from, to, key)`.

## 10. Actors, context frames and relevance

### 10.1 Drives

```ts
interface DriveDef {
  id: DriveId; family: string;          // the families in foundation §5.1
  urgency: { model: 'rise'; rate: number } | { model: 'event' } | { model: 'constant' };
  horizon: 'now' | 'soon' | 'life';
  scope: 'self' | 'kin' | 'group' | 'city';
  satisfiers: Selector[]; threats: Selector[];
}

interface DriveState { drive: DriveId; importance: number; urgency: number; updated: GameTime }  // 0..1 each
```

Actors (nodes whose kind has the `actor` facet) carry a `drives` slot. Its values are `DriveState`s, sampled like any slot from contributions: personality priors, group norms, history.

`urgency` changes as follows:
- by the `rise` model: `urgency = min(1, urgency + rate · Δt)`;
- by events: a satisfier event resets it, and a threat event raises it.

### 10.2 Frames

```ts
interface ContextFrame {
  id: Id; actor: Id;
  level: 'drive' | 'concern' | 'goal' | 'step' | 'situation';
  parents: Id[];                       // more than one when memberships contribute (§12.2)
  payload: { drive?: DriveId; goal?: GoalSpec; target?: Id[]; place?: Id };
  weight: number;                      // > 0
  own: FrameIndexes;                   // only what this frame adds over its parents
  focus: { nodes: Id[]; tier: Tier };  // what this frame needs detail on (§10.6)
  status: 'active' | 'blocked' | 'satisfied' | 'abandoned';
  opened: GameTime; cause: Id;
}

interface FrameIndexes { wants: Key[]; reactsTo: Key[]; blockedBy: Key[]; threatenedBy: Key[]; protects: Key[] }

type Key = string;  // 'node:<Id>' | 'kind:<KindId>' | 'tag:<tag>' | 'dim:<DimId>=<bucket>' | 'edge:<EdgeTypeId>:<Id>'
```

A frame's **effective index** of each type is its own keys plus its parents' effective keys. Implementations MUST compute it by walking parents or by persistent sets with structural sharing. They MUST NOT copy whole parent sets per frame.

### 10.3 Unfolding: top-down and incremental

For an actor with demand (§10.6):
1. **Drive frames.** Open a drive frame for each drive with `importance × urgency ≥ θ_drive` **[tunable 0.25]**. Its weight is `importance × urgency`, and its own keys come from the drive's satisfiers and threats.
2. **Concern frames.** Under each drive frame, open concern frames for the actor's current concerns. Concerns come from the simulation (S1), from seeds (S2) and from memberships (§12). Each concern adds only the keys it introduces.
3. **Goal, step and situation frames** open in the same way, each predicated on its parent. The situation frame records where the actor is and what they're doing.
4. **Changes recompute increments only.** When a frame opens, closes or changes status, only that frame's own keys, and the registry entries for them (§10.4), change.

### 10.4 The interest registry and matching

The kernel keeps one registry `Map<Key, Set<FrameId>>` covering the **own** keys of every active frame.

On every change, the kernel derives the change's keys:
- the node's `Id`;
- its kind and the kind's ancestors;
- its tags;
- the bucket keys of the changed slot values (`DimensionDef.buckets`);
- for edges, `edge:<type>:<from>` and `edge:<type>:<to>`.

Changes include a pin, a newly resolved slot, a new event, and an edge added or ended. The kernel looks up each key and visits the matched frames. Each matched frame's descendants inherit the match, so they are visited too, down the chain.

**The relevance increment** of change `x` for frame `f` matched by index type `t`:

```
r = f.chainWeight × m(t) × strength(x)
f.chainWeight = product of weights from the drive frame down to f
m: wants 1.0, threatenedBy 1.0, protects 1.0, blockedBy 0.8, reactsTo 0.6   [tunable]
strength(x) = 1 for direct node keys, 0.5 for kind or tag keys, 0.3 for bucket keys   [tunable]
```

When `r ≥ θ_react` **[tunable 0.3]**, the kernel emits `Relevance { actor, frame, change, type, r }` to:
- the simulation (S1), for behaviour;
- the procedural engine (S3), for sifting and hooks.

Nothing else is scored. Relevance is only ever this increment.

### 10.5 Buckets

`DimensionDef.buckets` maps a value to a small set of coarse keys, so frames can react to "rain", "night" or "Tyger Claw territory" without per-value keys. Bucket functions are registry functions with parameters.

### 10.6 Demand tier and budget

Each node has a demand tier. It is the highest `focus.tier` among active frames whose focus includes the node or one of its ancestors. A frame's pull is weighted by its chain weight times `w_actor`:
- `w_actor` is **[tunable 4.0]** for V's frames;
- it is 1.0 for everyone else.

Per evolve tick, opens are capped at `B_open` **[tunable 2000]** and active frames at `F_max` **[tunable 5000]**. When a cap is reached, the lowest-pull frames are suspended first. They keep their state, but leave the registry and stop pulling demand.

### 10.7 V

V is the root node `v`, with the `actor` facet. Its rules:
- **Nothing assigns V's drives, and nothing pins them** (I-12).
- **V's frames come from two sources:**
  1. `game`-sourced frames that mirror the canon story state. For example, the main quest's active objectives appear as goals with `cause` set to the game.
  2. `inferred` frames built from the director's beliefs about V (§11.5).
- Inferred frames carry their belief's confidence as part of their weight.
- V's decisions enter the kernel only as `observed` events from the game port.

## 11. Beliefs and perspectives

### 11.1 The belief record

```ts
interface Belief {
  id: Id; believer: Id; subject: Id; path: SlotPath;
  value?: Value; region?: Region;       // exactly one
  confidence: number;                   // (0, 1]
  source:
    | { by: 'observed'; event: Id }
    | { by: 'told'; teller: Id; event: Id }
    | { by: 'inferred'; rule: FnRef; from: Id[] };
  formed: GameTime; reinforced: GameTime; memorable: boolean;
}
```

Beliefs are stored per believer and indexed by `(subject, path)`. A believer MUST NOT hold two active beliefs on the same `(subject, path)` that contradict each other (I-9). A belief never constrains the subject's true state.

### 11.2 Forming beliefs by attribution

When an actor witnesses an event (it is in the event's `witnesses`), the kernel runs the **attribution rules** that match the event's kind and the roles involved. Each rule is data:

```ts
interface AttributionRule {
  id: string;
  event: string; observerRole: string; subjectRole: string;
  infers: { path: SlotPath; value?: Value; region?: Region };
  confidence: number;
  bias: { dispositional: number; groupPrime: number };
}
```

The belief's confidence is:

```
confidence = rule.confidence × (1 + bias.dispositional × (1 − circumstanceVisible))
                             × (1 + bias.groupPrime × rivalry(observer, subject))
             capped at 0.95
```

- `circumstanceVisible` is 1 if the event carries a visible cause the observer witnessed, else 0.
- `rivalry` is the strongest negative stance between the observer's groups and the subject's groups.

This is how one bad moment becomes "Bob is a jerk" (the fundamental attribution error), and how corporate rivalry colours it.

### 11.3 Updating, telling and fading

**Updating.** A new belief `b'` on the same `(subject, path)` as an existing `b`:
- **compatible** (equal values, or overlapping regions): merge. `confidence = 1 − (1 − c)(1 − c')`, take the intersection of the regions, and set `reinforced` to now.
- **contradictory:** keep the one with the greater `confidence × recency`, where `recency = 0.5^(age / h)` and `h` is **[tunable 30 game days]**. If the loser is memorable, keep it as superseded history.

**Telling.** On a social event between a teller and a listener:
- each of the teller's beliefs whose subject is salient to the listener (an index match, §10.4) is passed on with probability `p_tell` **[tunable 0.5]**;
- the passed belief's confidence is `c × trust(listener → teller)`;
- with probability `p_distort` **[tunable 0.1]**, the value moves to a neighbouring value (enum neighbours by list order, numbers by one quantum step).

**Fading.** A non-memorable belief's confidence decays by `exp(−Δt / τ)`, with `τ` **[tunable 7 game days]**, and the belief is dropped below 0.1. A belief is memorable if it was formed from an event whose salience is at least θ_salient **[tunable 0.6]**, or if it has been reinforced twice.

### 11.4 Reputation

`reputation(subject, audience, path)` aggregates the believers in an audience (a group or a place region) holding beliefs on `path` about the subject. It is the confidence-weighted mean of their values, with a count. It is computed lazily and cached, and the cache is invalidated by belief changes. V's street cred is V's reputation on the standing paths.

### 11.5 The director's beliefs about V

The root actor `director` holds beliefs whose subject is `v`. They are formed only by the inference process (S3), from observed V events and engagement, and they feed V's inferred frames (§10.7).

## 12. Groups and membership

### 12.1 Groups

Groups are actors whose kind has the `group` facet. A group has a `leadership` slot (many refs), drives, and concerns.

**Membership** is an edge of type `core:member-of`, with these attributes:

| Attribute | Values |
|---|---|
| `role` | `leader`, `member`, `associate`, `contractor`, or a family role |
| `strength` | 0 to 1 |
| `visibility` | `open`, `secret` (with `knownTo`, a set of actor `Id`s) or `deniable` |
| `terms` | `standing`, or `contract`, with an end condition as a predicate list |
| `obligations` | Selectors for what the member must do or avoid |
| `benefits` | Selectors |
| `exitCost` | 0 to 1 |

Groups can be members of groups.

### 12.2 Context inheritance

For each membership with `strength ≥ θ_member` **[tunable 0.2]**, the group's active concern frames become extra parents of the member's matching frames:
- they parent the member's drive frame of the same family, or the member's root frame if it has none;
- the edge weight is `strength × group frame weight`.

**Leadership.** The group's own frames have its leaders' frames as parents, weighted by each leader's authority, so leaders can bend the group to their own ends.

### 12.3 Orders

When a group delegates a goal, the kernel creates an `Assignment { group, member, goalFrame, pressure }` and opens a goal frame on the member whose parent is the group's goal frame. `pressure = strength × authority(leader) + fear(member → leader)`, and the member's goal frame weight is `pressure`.

### 12.4 Cross-pressure

Whenever a goal or step frame opens for actor `a`:
1. For each key `k` among the new frame's `target` keys, look up `a`'s other active frames whose effective `protects` or `wants` contain `k` and whose root is different (another membership or the actor's own drive).
2. For each such frame `g`, emit `Dilemma { actor: a, frame, conflicting: g, key: k, severity: chainWeight(frame) × chainWeight(g) }` to the procedural engine (S3).

Example: the gang's order to kill X meets the family frame that protects X ([DS-61](../design-seeds.md)).

## 13. Provenance and explanation

Every pin, contribution, edge, belief, event, frame and conflict carries a `cause`.

`explain(node, slotPath)` MUST return, deterministically:
- the pins that applied, with their causes;
- the top `k` contributions by absolute effect `|strength · log f(v)|` at the resolved value, where `k` is **[tunable 8]**;
- each feasible-set reduction, with its source;
- conflicts and overruled contributions;
- the draw `u`.

It is the basis of the agent-readable "why" views ([DS-26](../design-seeds.md)).

## 14. Persistence: the logical record

**Persisted:**
- pins;
- minted nodes (their origin);
- edges caused by persisted events or committed seeds;
- contributions from `seeding`, committed `procedural` sources and runtime `authored` decisions that packs can't reproduce;
- memorable beliefs;
- canon events;
- the active frames of actors who are canon;
- seed states (S2) and process states (S1);
- the world seed and lineage information.

**Not persisted:**
- generated nodes' unpinned state and every cache;
- mirrored state, which is re-read from the game;
- pack contributions, which are reloaded (the record keeps each pack's id and version).

**Record structure.** Each save gets a record `{ saveKey, parent, ops }`:
- `parent` is the record of the save this one was made from;
- `ops` is an append-only log of operations since the parent: `PinAdded`, `PinRemoved`, `NodeMinted`, `EdgeAdded`, `EdgeEnded`, `BeliefSet`, `BeliefDropped`, `ContributionAdded`, `ContributionEnded`, `EventCanon`, `FrameState`, `SeedState`, `ProcessState`.

**Loading** a save replays ops from the nearest snapshot up its parent chain.

**Snapshots** are written when a record's op count since the last snapshot exceeds **[tunable 10,000]**.

Ops carry complete data, so replay never recomputes anything except regenerable state. S6 defines the bytes and the save key.

## 15. Invariants

Each invariant is a test that the reference model and the native core MUST pass.

| # | Invariant |
|---|---|
| I-1 | **Determinism.** The same world seed, schema, contributions, pins and operation sequence give identical resolved values at every address, in every implementation |
| I-2 | **Pins hold.** Every resolved value satisfies every value pin and region pin on its slot |
| I-3 | **Regeneration.** Forgetting a node and resolving it again gives identical values while its contributions are unchanged |
| I-4 | **Nothing regenerable is persisted.** The persisted record contains no `resolved` cache values |
| I-5 | **Propagation agrees.** Children's pins and their parent's resolution are mutually consistent (§6.2, §6.3) |
| I-6 | **Queries are sound.** A complete search returns every node in scope that satisfies every `must` predicate |
| I-7 | **Stability.** Scaling one weight contribution by (1 ± ε) changes at most the slots whose `u` falls in the moved mass, checked statistically |
| I-8 | **Explanations are complete.** `explain` accounts for every constraint and every contribution with non-zero effect |
| I-9 | **Perspectives are consistent.** No believer holds contradictory active beliefs on one `(subject, path)` |
| I-10 | **Budgets hold.** An evolve tick never exceeds `B_open` opens or `F_max` active frames |
| I-11 | **Identity is stable.** Moving a node never changes its `Id` or its pinned values |
| I-12 | **V is never owned.** No operation creates a pin or sets a `DriveState` on V's drives; V's choices enter only as observed events |

## 16. Test vectors

The reference model produces the expected outputs once, a reviewer checks them by hand against this specification, and they are then frozen in the reference model's test folder. Every later implementation must reproduce them exactly.

| # | Scenario | What it checks |
|---|---|---|
| TV-1 | **The vendor** ([foundation §10](../foundation.md#10-worked-example-one-vendor)): open the market to stall 7; resolve the vendor's name and first concern; pin both as observed; forget; resolve again; then change the Tyger Claw influence field and resolve the concern | I-1, I-3. The pinned concern is unchanged. A newly resolved second concern reflects the change, and `explain` shows the influence field |
| TV-2 | **An overheard first name:** a region pin on `name.given`, then resolution of `name` | I-2, I-5. The full name lies inside the region; a later conflicting full-name pin is reported as a conflict |
| TV-3 | **Alice and Bob:** a `collision` event with no visible cause, witnessed by Alice. Then resolve Bob's true disposition | Alice's belief has the attribution confidence from §11.2. Bob's truth comes from his own contributions and may differ. I-9 holds |
| TV-4 | **Gang and brother:** a `kin` edge between M and X, M a member of G; G assigns M the goal of killing X | Exactly one `Dilemma`, with the severity from §12.4 |
| TV-5 | **Query:** in a synthetic district of 2,000 places, find places at night with gang influence ≥ 0.6 and police presence ≤ 0.2 | Branch and bound returns the same set as brute force (I-6) and opens far fewer nodes |
| TV-6 | **Cross-implementation:** a fixed script of 1,000 mixed operations on a synthetic schema | The hash of every resolved value equals the frozen hash (I-1) |
| TV-7 | **Branching saves:** save A; act; save B; load A; act differently; save C | B's and C's records share A's ops and diverge after them; loading B shows only B's pins |
| TV-8 | **V:** V's observed actions only | V's frames are only `game` or `inferred`; I-12 holds |

## 17. Compromises and open items

**Compromises.** These are recorded in the foundation's [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger).

| # | The model says | This specification does | Revisit when |
|---|---|---|---|
| C-02 | A believer's view is a full perspective over every dimension | Beliefs are sparse records formed by fixed attribution rules, not a resolved perspective with its own contributions | A story needs an NPC to reason about something no rule covers |
| C-03 | Relevance follows from what matters to each actor | Fixed match weights per index type and key type (§10.4) | Evaluation shows misplaced attention that tuning can't fix |
| C-04 | Text is a dimension like any other | Text is sampled by grammar with bounded retries under constraints, not by inverse cumulative distribution over all strings | Constrained text generation fails or repeats noticeably |

**Open items before v1:**
1. Confirm that BLAKE3 gives byte-identical results in the TypeScript and Rust builds used. The reference model's first test does this.
2. The text-region language: which grammar components can be constrained. Decide it with S4's name and text grammars.
3. Whether summary events (§9.2) need explicit distributions per kind, or can derive from process outputs. Decide it with S1.
4. Real numbers for `B_open`, `F_max` and the tick budget, from P7's measurements.
5. The `GameTime` epoch and clock mapping, decided with S5.
