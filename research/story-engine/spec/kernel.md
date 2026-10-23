# S0. Kernel specification

**Status:** v4.11, 23 October 2026.
- v4.11 adds three clarifications from S1 v0.2 (V4-47 to V4-49).
- v4.10 adds eight clarifications from writing [S1](simulation.md) (V4-39 to V4-46).
- v4.9 completes the process interface for S1 (V4-35 to V4-38), from the [P3](../p3-simulation-layer.md) design.
- v4.8: an event-kind registry; occurrence ids and times on delivered envelopes; `tempo` in settings (V4-32 to V4-34).
- v4.7 clarifies pattern frames for layer 3 (V4-31).
- v4.6 adds staged batches, widens relevance routing to layer 2, tightens the production gate, fixes recall to once per encounter, and defers the memory machinery and implicit edges from the first version, after GPT-6 Astra's second review of S2 (V4-26 to V4-30 in §20).
- v4.5 adds the `coarseFine` declaration on processes and the property-test plan, from [dossier 23](../craft/d23-evaluation-testing.md) (V4-24 and V4-25 in §20).
- v4.4 adds an age class on people, typed and sensitive content settings, and lines that refuse events, from [dossier 18](../craft/d18-content-boundaries.md) (V4-21 to V4-23 in §20).
- v4.3 adds implicit edge types (specified; implementation deferred) and states the `aggregate` hook's contract, from [dossier 15](../craft/d15-people-networks-order.md) (V4-18 to V4-20 in §20).
- v4.2 adds city settings and clarifies arithmetic and summaries for simulated events, from [dossier 14](../craft/d14-city-events.md) (V4-14 to V4-17 in §20).
- v4.1 added memory and forgetting from [dossier 11](../craft/d11-saves-memory-forgetting.md) (V4-8 to V4-13). v3.1 was final for the first implementation and adopted the reference model's 57 accepted implementation notes ([§19](#19-decisions-adopted-from-the-reference-model)). v4 adds what the seeding layer ([S2](seeding.md)) and the sifting research ([dossier 6](../craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged)) need. The additions are listed in [§20](#20-version-4-additions); none changes a result the reference model already produces. This is the specification stage of the [foundation](../foundation.md): exactly how the dimensional model works, so the reference model can be built from this page alone. It is work package [WP-05](../plan.md#82-work-packages).

v3 takes in three independent review rounds. The [review record](#18-review-record) lists what changed and why. What the first implementation includes is settled in [§0.2](#02-the-first-implementation), and that scope is final ([D-19](../decisions.md)).

**Normative words:**
- **MUST** and **MUST NOT** are requirements.
- **SHOULD** is a strong default that needs a recorded reason to break.
- **MAY** is optional.

A value marked **[tunable]** is a configurable default. A value marked **[calibrate]** is fixed by the calibration fixtures (§16.2).

**Type definitions** are in TypeScript notation. Field names and meanings are normative; physical layout is free if the fixtures and invariants pass. Departures from the foundation are listed in §17 and in the foundation's [compromise ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger).

## 0. Scope

### 0.1 What the kernel is

**The kernel holds the mechanism:**
- identity and arithmetic;
- the schema;
- nodes, edges and resolution;
- constraints and contributions;
- pins and time;
- queries;
- events, summaries and evolution;
- context frames and relevance;
- belief records;
- membership edges;
- provenance;
- the logical persistence record.

**Behavioural policies belong to the simulation layer (S1),** which plugs into hooks defined here:
- drive urgency;
- attribution;
- rumour telling and distortion;
- reputation aggregation;
- group decisions;
- the effect conflict table's contents.

**Proportion.** This is a game mod. The kernel guards against what players would notice: contradictory story state, lost or corrupted saves, stalls, and a broken game. It does not defend against hostile input.

**Specified elsewhere:**

| Topic | Specification |
|---|---|
| Simulation processes and policies | S1 |
| The seed language | S2 |
| Sowing, fitting and the director | S3 |
| Content packs and settings | S4 |
| The game port and the companion protocol | S5 |
| Persistence bytes and save keys | S6 |

### 0.2 The first implementation

The first implementation is the TypeScript reference model. It implements everything in this specification **except** the items deferred below.

Deferred items are named in the text where they apply, and are recorded as compromises or open items (§17). Each later version MUST agree with the reference model on everything the reference model implements.

| Deferred to a later version | The first implementation instead |
|---|---|
| Hierarchical samplers for domains larger than `N_enum` | Flat enumeration only. Large lists are split by an earlier slot through conditioned domains (§2.1) |
| Backward narrowing through views with several inputs | Unary views with an exact preimage only (§6.4) |
| Reading through `ref` slots during resolution | Refs are never resolution dependencies (§2.3) |
| A routing index for interests | A conservative scan of registered interests (§10.5) |
| Spatial pruning and tight query bounds | Conservative `maybe` and complete traversal (§8) |
| Resumable resolution and resumable queries | Hard limits keep each resolution and query atomic and bounded (§10.7). Worklists remain resumable |
| Frame suspension under budget | Queued work pauses; frame status and interests are unchanged (§10.4) |
| Fine-grained cache dependency tracking | Cache keyed by revision and query time (§5.5) |
| Implicit edge types (§2.5, v4.3) | Only materialised edges are tested. Casting through ties opens a bounded candidate set first (S2) |
| Memory machinery: accessibility, the forgetting sweep, widening and `onRecall` (§11.2, v4.1) | Beliefs are kept exactly; non-memorable beliefs follow the existing fading hooks. The fields `uses`, `salience` and `widened` are carried but unused |
| Processes with different base periods | One shared simulation window. Processes run every n-th window (§9.4) |
| Function-specific query bounds (`Bound`) | Optional; without one, the verdict is `maybe` (§2.1, §8.2) |
| Reasoning about "opposite" effects in the conflict table | Explicit violation pairs only (§10.8) |

## 1. Identity, arithmetic and randomness

### 1.1 Identifiers

An `Id` is 128 bits, written as 32 lowercase hexadecimal characters. An `Id` MUST NOT change once assigned.

| Origin | Formula | Header origin (§3.1) | Used for |
|---|---|---|---|
| Root | `H("root", worldSeed, name)` | `{ by: 'root', name }` | `city`, `director`, `v` |
| Owned value | `H("val", ownerId, slotKey)` | `{ by: 'value', owner, slot }` | The node held by a `card: 'one'` `node` slot |
| Collection member | `H("gen", ownerId, slotKey, index)` | `{ by: 'member', owner, slot, index }` | Member `index` of a `many` slot, whatever its value type |
| Minted | `H("mint", creatorId, causeId, localName)` | `{ by: 'minted', creator, cause, name }` | Nodes made by events, seeds, processes or summaries. A summary item is `creator = cause = summaryId`, `name = "item:<i>"` |
| Mirrored | `H("game", gameKey)` | `{ by: 'mirrored', gameKey }` | Things the game owns. S5 defines `gameKey` |

Every `Id` is reproducible from its header. Moving a node changes its edges, never its `Id` (I-11).

### 1.2 Hashing

`H` is the first 128 bits of BLAKE3 over the canonical encoding of its arguments. Each argument is a one-byte tag followed by its bytes:

| Tag | Type | Encoding |
|---|---|---|
| `0x01` | UTF-8 string | u32 little-endian length, then the bytes |
| `0x02` | i64 | Little-endian |
| `0x03` | `Id` | 16 bytes |
| `0x04` | binary64 | Little-endian. Negative zero becomes positive zero; NaN is forbidden |
| `0x05` | bool | One byte |
| `0x06` | `Value` | Its canonical encoding (§2.1), then `0x00` |

`toUnit(h) = (bits₅₂(h) + 0.5) / 2^52`, where `bits₅₂` is the first 52 bits as an unsigned integer. Every step is exact in binary64, and the result lies strictly inside (0, 1), so `ln` never sees 0 or 1.

### 1.3 Arithmetic

Determinism across implementations (I-1) needs identical arithmetic:
- **Allowed operations.** All weight and score arithmetic is IEEE 754 binary64, round-to-nearest-even, using `+ − × ÷`, `sqrt`, comparisons, and reading or writing a binary64's bit pattern (needed for argument reduction).
- **`ln`** is fdlibm's `e_log.c` ([netlib](https://netlib.org/fdlibm/e_log.c)), ported literally: the same constants and the same operation order. Platform `Math.log` and `f64::ln` MUST NOT be used for kernel decisions. The kernel needs no `exp`.
- **Falloff kernels are polynomials** (§4.3).
- **Sums run in canonical order:** contributions by `Id` ascending.
- **Each weight factor is normalised** over the feasible set before its `ln` is taken: divided by its maximum over `F`. Scaling a factor uniformly is then invisible mathematically. In binary64, rounding can differ at the edges, so tests check the specified computation, not exact invariance (I-7).
- **Outcome comparisons are exact.** Ties are broken as each rule states.

**Scope** (v4.2, a clarification). These rules govern every arithmetic that decides a pin, event, count or contribution, including those a simulation process (S1) produces, not only weights and scores.
- `ln` is the only transcendental function in a decision.
- S1 MAY add exact table-based sampling and fixed-order loops, specified bit for bit. That is how a process gets exponential-like decay or a log-normal spread without `exp`.

**What is exact.** The draw (§5.4) samples the specified distribution mathematically. The implementation reproduces the same finite-precision computation bit for bit; it does not promise mathematical exactness beyond that.

### 1.4 Random streams

`rand(key…) = toUnit(H("rng", key…))`. A stream is `rand(key…, i)` for `i = 0, 1, …`. Every draw names its key. There is no stateful generator.

### 1.5 The world seed

Each save lineage has a 128-bit `worldSeed`. It is chosen from a cryptographic random source when the engine first meets a playthrough, and stored in the lineage's root record (S6).

## 2. Schema

The schema is data: the core ships with engine releases, and content packs MAY add to it (S4). Ids are namespaced: `<namespace>:<name>`.

### 2.1 Dimensions and values

```ts
interface DimensionDef {
  id: DimId;
  value: ValueType;
  structure: 'none' | 'order' | 'metric' | 'cyclic' | 'graph';
  prior: FnRef;                        // base weights (§5.3); not used for derived or mirrored slots
  buckets?: FnRef;                     // value → coarse match keys (§10.5)
}

type ValueType =
  | { t: 'enum'; values: string[] }                                  // at most N_enum values
  | { t: 'enum-by'; by: SlotPath; lists: Record<string, string[]> }  // a conditioned domain:
                                                                     // the list chosen by an earlier slot's value
  | { t: 'int'; min: number; max: number }                           // at most N_enum values when sampled
  | { t: 'real'; min: number; max: number; quantum: number }         // grid; at most N_enum points when sampled
  | { t: 'cyclic'; period: number; quantum: number }
  | { t: 'vec'; n: number; quantum: number }                         // derived, mirrored or pinned only
  | { t: 'text' }                                                    // derived or mirrored only
  | { t: 'ref'; kind: KindId; candidates: CandidateQuery }           // selects an existing node (§2.4)
  | { t: 'node'; kind: KindId };                                     // an owned value or a member (§2.4)
```

- **`N_enum`** is the largest domain one draw may enumerate: **[tunable 4096]**. An `enum-by` list longer than `N_enum` is rejected at schema load.
- **`vec` and `text`** are never drawn by the generic sampler. Their slots are `derived`, `mirrored` or `assigned`.
- **Canonical value encoding:**
  - `enum` and `enum-by`: the value's string;
  - `int`: i64;
  - `real` and `cyclic`: the grid index as i64;
  - `vec`: n grid indices;
  - `text`: the string;
  - `ref` and `node`: the `Id`.

**The function registry.** `FnRef` is `{ name, version, params? }`. Packs reference registry functions with parameters and supply no code. The registry signatures are:

```ts
type Prior       = (dim: DimensionDef, F: Value[], params) => number[];          // positive weights over F
type Derive      = (inputs: Value[], params, t: GameTime) => Value;              // t: the query time (v4)
type Preimage    = (output: Region, otherInputs: Value[], params) => Region;     // unary views only (§6.4)
type Conditioned = (inputs: Value[], F: Value[], params) => number[];           // positive weights over F
type FieldMap    = (fieldValue: number, F: Value[], params) => number[];        // positive weights over F
type Buckets     = (value: Value, params) => string[];
type Widen       = (value: Value, level: number, params) => Region;              // v4.1: blurs a remembered value;
                                                                                 // the region always contains the value
type Bound       = (inputBounds: Region[], params) => Region;                   // conservative, for queries
```

A `Derive` MAY provide a `Bound`. Without one, its query verdict is `maybe`. Function versions are part of the compatibility record (§14.4).

**Derives read the query time** (v4). A `Derive` receives the time `t` that resolution was asked about (§5). It lets a derived value depend on elapsed time, such as urgency growing towards a deadline, without a process ticking it ([DS-66](../design-seeds.md)). A derive that reads `t` is still deterministic, because `t` is part of the cache key (§5.5). A derive that ignores `t` behaves exactly as before.

### 2.2 Kinds

```ts
interface KindDef {
  id: KindId;
  extends?: KindId[];                  // slots inherited; a redefined key overrides
  slots: SlotDef[];                    // declaration order is the dependency order (§2.3)
  facets?: Array<'actor' | 'group' | 'place' | 'event' | 'summary'>;
  tags?: string[];
}

interface SlotDef {
  key: string;                         // [a-z0-9-]+
  dim: DimId;
  card: 'one' | { many: { count: DimId } };       // the count is the slot '<key>#count'
  mode: 'sampled' | 'derived' | 'mirrored' | 'assigned';   // assigned: value comes only from value pins
  derive?: { fn: FnRef; inputs: SlotPath[]; preimage?: FnRef };  // preimage only for one input
  conditioned?: { fn: FnRef; inputs: SlotPath[] };
  temporal?: { window: number };       // simulated temporal slots only (§6.3)
  tier: Tier;                          // scheduling band (§10.6)
}

type Tier = 0 | 1 | 2 | 3 | 4 | 5;     // city, district, block, scene, individual, fine detail
```

`mirrored` slots are read from the game for mirrored nodes. The same slot on a generated or minted node is `sampled`, `derived` (if it has a `derive`) or `assigned` (if its dimension is `vec` or `text`).

`assigned` slots are never drawn. Their value is supplied by value pins, from processes, seeds or authors (§5.1).

### 2.3 Dependencies are well-founded

During resolution, a slot may read only:
- **the same node's earlier slots,** in declaration order after inheritance;
- **any slot of its owner chain,** that is, the owners of an owned value or member, transitively.

An owner never reads its owned values' or members' slots, except for the count of a `many` slot.

These reads include:
- `derive.inputs`;
- `conditioned.inputs`;
- `enum-by.by`;
- the `when` predicates of rule contributions that target the slot;
- a field contribution's base slot;
- a selector's `where` predicates when evaluated for this slot.

`ref` slots are **not** resolution dependencies in the first implementation. No resolution reads through a ref. A ref's candidate query may test only the candidates' non-ref, non-temporal slots, which are resolved independently.

Schema loading MUST reject a kind that breaks these rules. As a guard against a defect in that check, resolution also keeps a stack of the (node, slot) pairs being resolved. Re-entering one returns the error `cycle` and records a defect for inspection.

### 2.4 Owned values, members and references

**`node` slots:**
- With `card: 'one'`, the slot holds an **owned value node**, `Id = H("val", owner, slotKey)`. It is never shared, exists whenever its owner exists, and is retained whenever its owner is.
- With `card: { many }`, member `i` is `H("gen", owner, slotKey, i)`, whatever the value type.

**`ref` slots select** among existing nodes:

```ts
interface CandidateQuery { find: KindId; scope: QueryScope; must: Predicate[]; max: number }
```

1. The candidate set is the complete result of this query (§8), evaluated without a limit, then cut to the `max` lowest `Id`s.
2. The draw (§5.4) runs over that set, with each candidate's `Id` as its value.
3. An empty set returns `unavailable`. A query that hits a hard limit (§10.7) returns `failed`.

A ref never creates a node.

### 2.5 Edges

```ts
interface EdgeTypeDef {
  id: EdgeTypeId;
  from: KindId[]; to: KindId[];
  attrs: Record<string, DimId>;        // plain values of declared dimensions
  data?: string[];                     // names of structured data fields carried on the edge record
  perceivable?: boolean;               // the type can be seen; each edge's visibility decides (§11.4)
  implicit?: { fn: FnRef; neighbours?: FnRef };   // v4.3: edges that exist as a pure function, below
  symmetric?: boolean;
}
```

**Implicit edge types** (v4.3; implementation deferred, §0.2). Most ties between ordinary people never need storing: they follow from where people live, work and gather.
- **The function.** An implicit type names a registered pure, symmetric function of `(a, b, t)` that returns the edge's attributes, or none. An optional `neighbours` function enumerates the candidates for one endpoint.
- **Queries.** The `has-edge` and `lacks-edge` predicates evaluate it exactly on candidates, and return `maybe` over unopened regions.
- **Retention.** Implicit edges are not retention roots.
- **Materialising.** When V sees a tie, hears of it, or a seed uses it, it is materialised as an ordinary edge, pinned under the `Id` `H("edge", type, min(a, b), max(a, b))`.
- **Cost.** Evaluation counts against the shared allowance (§10.7).

The city therefore never stores a social graph; it stores only the ties that have mattered ([dossier 15](../craft/d15-people-networks-order.md)).

### 2.6 The core schema

The reference model ships these. The fixtures use them.

```
core:name        slots: origin (enum), given (enum-by origin), family (enum-by origin),
                        display (text, derived from given + family)
core:drive-state slots: drive (enum of drive ids), importance (real 0..1 q 1/64),
                        urgency (real 0..1 q 1/64, temporal window W_sim)
core:trait       slots: trait (enum), strength (real 0..1 q 1/64)
core:person      facets: actor
                 slots: name (node core:name), age (int 16..90),
                        age-band (int, derived from age; preimage: the band's 10 ages),
                        traits (many node core:trait), drives (many node core:drive-state),
                        position (vec 3; mirrored for mirrored people, otherwise assigned by simulation), place (ref core:place),
                        age-class (enum adult | minor, v4.4: derived from age, adult at 18 and over, for generated people;
                                   mirrored from the game's child flag for mirrored people; declared for pack people.
                                   Floor checks treat a missing reading as minor)
core:group       facets: actor, group   slots: name (node core:name), drives (many node core:drive-state)
core:place       facets: place          slots: position (vec 3), district (ref core:place), public (enum)
core:event       facets: event          (§9.2)
core:summary     facets: summary        (§9.3)
core:member-of   attrs: role (enum), strength (real), visibility (enum open|secret|deniable),
                        terms (enum standing|contract), until (int; contract only), exit-cost (real)
                 data:  obligations (list of interest selectors); perceivable: true
core:kin         attrs: relation (enum)
core:located-in, core:knows

# v4, for the seeding layer (S2 §0.4)
core:game-fact   slots: value (int, mirrored). The fact named n is the mirrored node H("game", "fact:" + n)
core:seed-fact   slots: value (int, assigned)
core:seed        facets: actor. No slots the kernel reads
core:cast        edge, from core:seed to any kind; data: role; not perceivable
```

The core event vocabulary (§9.2) gains the kinds `offer`, `response` and `seed-outcome` (v4).

## 3. Nodes, slots and edges

### 3.1 Nodes and headers

```ts
interface NodeHeader {                 // persisted for every retained node (§7.3, §14)
  id: Id; kind: KindId;
  origin:
    | { by: 'root'; name: string }
    | { by: 'value'; owner: Id; slot: string }
    | { by: 'member'; owner: Id; slot: string; index: number }
    | { by: 'minted'; creator: Id; cause: Id; name: string }
    | { by: 'mirrored'; gameKey: string };
}

interface Node extends NodeHeader {
  slots: Map<SlotKey, SlotState>;      // materialised slots only
  touched: GameTime;
}

type SlotPath = string;                // "key", "key[i]", "key#count"
type SlotKey  = string;                // SlotPath, plus "@w<k>" for simulated temporal slots

type SlotState =
  | { s: 'open' }
  | { s: 'resolved'; value: Value; status: 'ok' | 'contradiction'; revision: number; at: GameTime };
```

### 3.2 Regions

| Value type | Region form |
|---|---|
| `enum`, `enum-by` | A set of strings |
| `int`, `real`, `cyclic` | Sorted closed intervals on the grid; cyclic intervals wrap |
| `vec` | Boxes |
| `text` | A set of strings |
| `ref`, `node` | A set of `Id`s |

Every region supports intersection, emptiness and membership tests.

### 3.3 Edges

```ts
interface Edge {
  id: Id; type: EdgeTypeId; from: Id; to: Id;
  attrs: Record<string, Value>;
  data?: Record<string, unknown>;      // the type's declared data fields
  valid: { from: GameTime; to?: GameTime };   // an ended edge stays as history
  cause: Id;
}
```

### 3.4 Addresses

An address is a starting `Id` followed by `SlotPath` steps. It is one view of a node, never its identity.

## 4. Constraints and contributions

### 4.1 The contribution record

```ts
interface Contribution {
  id: Id;
  source: { layer: Layer; origin: Id | string };
  target: Selector;
  form: Form;
  mode: 'constrain' | 'weight' | 'replace-prior';
  strength: number;                    // > 0; multiplies the normalised log-factor [default 1]
  valid: { from?: GameTime; to?: GameTime };
}

type Layer = 'observation' | 'game' | 'authored' | 'seeding' | 'simulation' | 'procedural';
```

**Precedence** for arbitration (§5.2):

| Source | Precedence |
|---|---|
| Structural constraints (§6.5) | 700 |
| `observation` | 600 |
| `game` | 500 |
| `authored` | 400 |
| `seeding` | 300 |
| `simulation` | 200 |
| `procedural` | 100 |

Within a level, the lower `Id` comes first.

### 4.2 Selectors

```ts
interface Selector {
  kind?: KindId;
  slot: SlotPath | '*';
  scope?: { under: Id } | { nodes: Id[] } | { region: SpatialRegion };
  where?: Predicate[];                 // as in §8.1; reads obey §2.3 when evaluated for resolution
}
```

A selector is testable on one node. For an unopened region it returns a conservative verdict (`no`, `maybe` or `yes`), and `maybe` is always allowed.

### 4.3 Forms

| Form | Yields at a node | Bound over a region |
|---|---|---|
| `Const(v)` | The set {v}, or a factor of 1 on v and ε on the rest | {v} |
| `Set(region, allow)` | A set | The region |
| `Table(weights)` | Positive factors over values. Absent values get 1 | Per value, [min, max] |
| `Field(base, points, map)` | Control points `{ at, value, radius, falloff }` over the node's `vec` base slot | The field's [min, max] over the region's extent, mapped |
| `Rule(when, then)` | `then`'s factor if `when` holds, else nothing | `when` is `yes`: `then`'s bound. `maybe`: the union of `then`'s bound and "no contribution". `no`: nothing |
| `Derive(fn, inputs)` | One value, for derived slots | `fn`'s `Bound` |

**Field falloffs** are piecewise. Let `d` be the Euclidean distance in the base `vec` space and `r` the radius (`r > 0`). For `d ≥ r` the value is 0. For `d < r`:
- `linear`: `1 − d/r`;
- `smoothstep`: `1 − 3x² + 2x³`, with `x = d/r`;
- `bump`: `(1 − x²)²`.

Points combine by `sum` or `max`. `map` turns the field value into factors.

A factor is a set (only `constrain` mode uses one) or a strictly positive weight function. ε is **[tunable 2⁻²⁰]**. Exclusion is expressed as a set, never as a zero weight.

## 5. Resolution

`resolve(node, slotPath, t)` returns `{ value, status }`, where status is `ok`, `contradiction`, `unavailable`, `failed` or `cycle`. Here `t` is the game time asked about. For a simulated temporal slot, `t` selects window `k = floor(t / window)`.

Every step is deterministic, and resolution never emits relevance (I-13).

### 5.1 The order of steps

1. **Derived slots** return `derive(inputs)`, after resolving the inputs. A pin on a derived slot constrains its inputs through §6.4, and is checked here: if the result violates an active pin, the status is `contradiction`.
2. **Mirrored slots of mirrored nodes** return the game's reading in effect at `t`: the latest reading at or before `t` (§6.3). If there is no reading, the result is `unavailable`.
3. **Assigned slots** go through arbitration (§5.2) with every value pin and constraint. The value is that of the first active value pin in arbitration order. With no active value pin, the result is `unavailable`.
4. **Every other slot** goes through arbitration (§5.2), weights (§5.3) and the draw (§5.4).

### 5.2 Constraint arbitration

**The constraints for (node, slot, window or t):**
- value pins and region pins in effect;
- `constrain` contributions whose selector matches and which are valid at `t`;
- view preimages (§6.4);
- structural constraints (§6.5).

Each carries its precedence. Pins take their reason's level:

| Pin reason | Precedence |
|---|---|
| `observed` | 600 |
| `game` | 500 |
| `authored` | 400 |
| `committed` | 300 |

**Arbitration:**
1. Sort by precedence descending, then by `Id`.
2. Start with `F` = the domain. For `enum-by`, the domain is the list chosen by the `by` slot's resolved value.
3. For each constraint, in order: if `F ∩ c` is non-empty, set `F` to it (`c` is active); otherwise `c` is rejected.
4. The status is `contradiction` if any rejected constraint has precedence 600 or more, otherwise `ok`.

**Conflicts are derived, never stored.** `trace` (§13) recomputes them, so repeated reads never grow the save.

### 5.3 Weights

1. **The prior `P0`** is the `conditioned` function on its inputs if the slot defines one, otherwise the dimension's `prior`. The first `replace-prior` contribution in precedence order replaces it.
2. **Normalise.** Each factor (`P0` and each `weight` contribution's `f_c`) is evaluated over `F`, then divided by its maximum over `F`.
3. **Score.** For each `v ∈ F`:

   ```
   score(v) = ln P̂0(v) + Σ_c strength_c · ln f̂_c(v)      (summed in Id order)
   ```

   where the hats mark normalised factors.

### 5.4 The draw: flat Gumbel-max

For each `v ∈ F`:

```
g(v)  = −ln(−ln(rand("g", worldSeed, node.id, slotPath, k, v)))   // k is the window index; 0 if not temporal
v*    = argmax over v ∈ F of (score(v) + g(v))
```

Exact ties go to the lower `H("tie", worldSeed, node.id, slotPath, k, v)`.

The draw samples from the normalised distribution `∝ exp(score)`. With fixed per-value noise:
- changing one value's weight changes the result only if that value was the winner or becomes it;
- scaling a factor uniformly changes nothing mathematically. The binary64 computation may differ at rounding edges, so I-7 is tested on the specified computation.

**Cost.** Noise depends only on (node, slot, window, value). An implementation MAY cache it across re-resolutions; the reference model computes it fresh.

**Limits.** `|F| ≤ N_enum` always holds, because domains are bounded by schema loading (§2.1).

### 5.5 Caching

The reference model caches a resolved value with the kernel's **revision** and the query time `t`.

The revision is a counter incremented by every write: a pin, contribution, edge, event, minted node, belief, frame change or game reading. A cache entry is valid only for the same revision and the same `t`.

A faster implementation MAY track dependencies and validity intervals instead, provided it never returns a value this rule wouldn't. [miniAdapton](https://arxiv.org/abs/1609.05337) is the model for that.

## 6. Pins, time and propagation

### 6.1 The pin record

```ts
interface Pin {
  id: Id; node: Id; slot: SlotPath;
  value?: Value; region?: Region;      // exactly one
  reason: 'observed' | 'game' | 'authored' | 'committed';
  valid: { from: GameTime; to?: GameTime };
  at: GameTime;
  cause: Id;
  evidence?: Id;                       // the originating event, for observations
}
```

A pin is a hard constraint at its precedence, in effect over the half-open interval `[valid.from, valid.to)`. It is history. It is removed only by its source's withdrawal or the loss of its save branch (§6.6).

### 6.2 Enduring slots

A slot without `temporal`, and not mirrored, has one value for the node's life. A pin on it is valid from `at`, with no end.

### 6.3 Time-varying slots

There are two kinds of time-varying slot.

**Mirrored slots are timelines of readings.** Each game reading of a mirrored slot (on a mirrored node) is a pin with reason `game`, valid over `[its time, the next reading's time)`, with no fixed windows. Readings with equal timestamps are ordered by `Id`, and the last one wins. When a later reading ends a retained reading or observation, the end is recorded as a `PinEnded` operation, even if the later reading itself isn't persisted (§14.2). Resolution at `t` uses the reading in effect at `t` (§5.1, step 2).

V's observation of a mirrored value is an `observed` pin over the same interval as the reading it saw. So "V saw rain at 1,000" and "V saw clear skies at 2,000" are two consecutive intervals, not a conflict.

**Simulated temporal slots** (with `temporal: { window }`) hold one value per window `k`. Use them for quantities the simulation treats as piecewise constant, such as urgency or mood. Their pins cover the windows they name.

### 6.4 Derived views and backward narrowing

**A pin on a derived slot with one input `s`,** whose `derive` declares a `preimage`, adds a constraint on `s`. The constraint is `preimage(pinRegion)`, at the pin's precedence. Preimages chain through views of views. Every domain is finite, so this terminates.

**A pin on a derived slot with several inputs** is checked, not propagated. Its inputs are resolved normally. If the result violates the pin, the status is `contradiction` (§5.1). Observations SHOULD pin base slots or unary views. For example, the perception layer reports a name as `given` and `family`, not as `display`.

Joint inverses are deferred ([C-05](#17-compromises-and-open-items)).

### 6.5 Structural constraints

Some constraints hold whatever any source says, so they take precedence 700:
- **Retained members stay in their collection.** While member `i` of a `many` slot is retained by a current root (§7.3), the count gets `count ≥ i + 1`. A smaller count from any source is rejected. When nothing retains the member any more, the constraint lapses.
- **Summaries never shrink below their canon items:** `count ≥ max(canon) + 1` (§9.3).

### 6.6 Withdrawing pins

A pin is removed only by a recorded withdrawal from the source that created it, such as an authored pack uninstalled or a seed withdrawn. Observations and game readings are never withdrawn.

## 7. Open, close, forget

### 7.1 Open

`open(node, slotPath)` materialises `{ s: 'open' }`. A `many` slot resolves `<key>#count` first. Owned values and members come into being lazily, when first addressed.

### 7.2 Close

`close(node)` drops the resolved caches of the node and of its unretained owned values and members. Pins, edges and headers stay.

### 7.3 Retention and forgetting

Forgetting is mark and sweep, run between ticks as a worklist (§10.7).

**The roots are current semantic facts,** not supporting records:
- pins in effect now, or observed, or committed;
- edges that haven't ended, and ended edges referenced by a canon event;
- memorable beliefs;
- canon events and the canon items of summaries;
- live seeds;
- active and blocked frames of demand roots and live seeds, and every ancestor frame of those;
- the nodes in those frames' focus;
- the mirrored nodes the game currently has streamed in.

Persisted headers, withdrawn pins and other history are not roots on their own.

**Marking** follows every root's `Id` fields, origin chains (to owners and creators), and owned-value links in both directions.

**Sweeping** discards unmarked nodes' in-memory state. A swept node regenerates identically while its constraints and contributions are unchanged (I-3). The headers of the marked closure are persisted, together with the complete records the closure needs, including ancestor frames (§14.1). Retained nodes therefore stay addressable.

## 8. Queries

### 8.1 The query record

```ts
type QueryScope = { under: Id } | { nodes: Id[] } | { region: SpatialRegion } | { roots: Id[] };

interface Query {
  find: KindId;
  scope: QueryScope;
  at: GameTime;
  must: Predicate[];
  prefer?: Array<{ p: Predicate; weight: number }>;
  limit: number | 'all';
}

interface Predicate {
  path: string;                        // slot path from the candidate; may cross node slots, not ref slots (§2.3)
  op: 'in' | 'not-in' | 'range' | 'eq' | 'field-at-least' | 'field-at-most' | 'has-edge' | 'lacks-edge';
  arg: Value | Region | { edge: EdgeTypeId; to?: Id | Selector };
}
```

### 8.2 Bounds

A predicate's verdict over a compound region comes from the region's pins and the bounds of applicable contributions (§4.3). A constraint that arbitration might reject narrows nothing. When in doubt, the verdict is `maybe`.

The first implementation MAY return `maybe` for every compound region. Tight bounds, spatial pruning and function-specific `Bound`s are deferred (§0.2).

### 8.3 Traversal

A query runs atomically, within the hard limits of §10.7, against one revision.

1. **The frontier** starts with the scope's roots. Entries are compound regions or candidates (nodes of kind `find`).
2. **Order.** Pop the entry with the highest upper bound on preference score. Ties go to the lower `Id` or cell key.
3. **Prune** an entry with any `must` verdict `no`.
4. **Descend** every compound region that isn't pruned.
5. **Check** every candidate that isn't pruned exactly: resolve it and evaluate each `must`. Score passing candidates by the sum of the `prefer` weights that hold.
6. **Deduplicate** by `Id`.
7. **Stop.**
   - With `limit = n`: when `n` candidates are confirmed and every remaining frontier bound is strictly lower than the `n`-th score. Score ties go to the lower `Id`.
   - With `'all'`: when the frontier is empty.
8. **Limits.** Exhausting the query's work allowance (§10.7) returns `failed`, never a partial result presented as complete.
9. **Summaries** within scope are expanded synchronously: their item descriptors (§9.3) are enumerated as candidates under the same allowance. Materialising an item is silent cache population.

**Soundness (I-6).** Against a fixed revision:
- `'all'` returns every in-scope node satisfying every `must`;
- `n` returns `n` such nodes, none scoring below a qualifying node left out (by score, then `Id`).

## 9. Time, events, summaries and evolution

### 9.1 Time

`GameTime` is a signed 64-bit count of game seconds since the lineage's epoch. S5 maps it to the game's clock.

### 9.2 Events

Events are minted nodes of kind `core:event`:

| Slot | Contents |
|---|---|
| `time` | int |
| `place` | ref core:place |
| `kind` | enum |
| `participants` | many node: `{ who: ref, role: enum }` |
| `effects` | many node: `{ on: ref, effect: enum }`, with effects from §10.8 |
| `witnesses` | many: ref |
| `causes` | many: ref to events |
| `outcome` | Optional enum: `done`, `failed`, `prevented` (v4) |
| `served` | Optional data: the `Id` of the frame whose goal the act served (v4) |

`outcome` and `served` are optional. An event without them means what it always meant. They let a reader tell an attempt from a success, and see which goal an act served ([dossier 6](../craft/d06-sifting-tellability.md) G-3).

An event becomes **canon** when:
- V observes it, which pins the observed fields `observed`;
- a seed commits it, which pins the committed fields `committed`;
- a persisted effect depends on it, which pins the fields the effect needs `committed`.

**Lines refuse new occurrences** (v4.4; tightened in v4.6). The exclusion gate applies to **new occurrences the engine produces**, before they are published, together with everything that depends on them:
- process outputs;
- summary counts and their items;
- fact writes;
- rewards.

An occurrence in a content class the player has excluded (`SettingsSet.classExclusions`, or a content ceiling of 0) is not produced, with reason `excluded`.

**What the gate doesn't touch:**
- **Records of what the game itself did** (mirrored readings, observed events) are kept as they are: the engine must still understand the world accurately. Their presentation is filtered separately (S2 §2.19).
- **Replayed history** is never re-filtered.

Where a generic event kind can't identify the class, the occurrence carries a content classification.

Only those fields are pinned. Causes, other participants and other details stay open until something needs them.

### 9.3 Summaries and their refinement

A summary is a minted node of kind `core:summary`:

| Slot | Contents |
|---|---|
| `kind` | The event kind summarised |
| `from` | int, a game time |
| `length` | int, seconds |
| `scope` | ref to a place node |
| `count` | int |
| `canon` | A set of indices, kept as data on the summary's persisted record |

**Item `i`,** for `0 ≤ i < count`:
- is minted with `creator = cause = S.id` and `name = "item:<i>"`;
- its `time` is `from + floor(rand("item-t", S.id, i) × length)`;
- its `place` is drawn among the places under `scope`, with the candidates found as for a ref (§2.4) and the key `("item-p", S.id, i)`;
- its other slots resolve normally.

**Querying.** A query enumerates item descriptors (`Id`, time, place) and materialises the items whose time and place fall inside its region, as silent cache population. Overlapping queries see the same items, and nothing is counted twice. Only canon items are persisted.

**Revisions.** A process may revise `count`, subject to the structural constraint (§6.5).

**Clarifications** (v4.2):
- **Scope and span.** A summary may be scoped to any single place, and cover one simulation window.
- **Empty summaries.** A summary whose count is zero is not minted.
- **Re-minting.** Re-minting a summary from its persisted descriptor under the same `Id` yields the same items (I-3). A process may therefore keep descriptors for a bounded horizon, instead of making every summary a retention root.
- **Item ids.** An item's `Id` is a pure function of the summary's `Id` and the item's index.

A city's incidents can therefore start as counts in per-window summaries. Fine detail is the lazy materialisation of their items, so the counts agree at every tier and across reloads ([dossier 14](../craft/d14-city-events.md)).

### 9.4 Evolution

Simulation processes are S1's. The kernel defines when they run and what they may read.

- **One shared window.** All processes share a base simulation window, `W_sim` **[tunable 600 s]**. A process runs every `n`-th window, `n ≥ 1`, aligned so it runs when `k mod n = 0`. `run(ctx, k)` computes its outputs for windows `k` to `k + n − 1`. Its randomness is keyed `("proc", worldSeed, processId, w, …)`, where `w` is the window being computed, not the run's start (v4.10).
- **Order at each boundary** `t = k × W_sim`:
  1. Apply the outputs of every process run whose span ends at `t`, by tier (coarse first), then by `id`.
  2. Apply the external operations stamped in the window that just ended, by timestamp, then `Id`. These are game readings, observations and seed operations.
  3. Take the snapshot that processes starting at `t` read.

  Processes never see each other's outputs within a span (double buffering).
- **Outstanding outputs are state.** A batch computed but not yet applied is part of the process's `ProcessState`, with its application boundary. It is persisted, restored on load under the new epoch, and applied at its boundary without re-running the process.
- **The process interface** (v4.9). `run(ctx, k)` may:
  - **read its own state** and return a replacement with its batch. The state is applied atomically with the batch, and double-buffered like any output;
  - **read other processes' published digests** as of the boundary snapshot, read-only;
  - for a fine-tier process, **call `demanded(tier)`**, which returns the nodes demand reaches at that tier, with the claim;
  - **return operations of these kinds:**
    - frame operations: open, status, weight, interests;
    - group `decide` and `order` (§12);
    - `observe`;
    - `tell`;
    - belief set.

    They are applied with the batch, in its order, under the same rules as the other operations.
- **Partition independence (I-15).** Given the same timestamped external operations and the same demand history, a process's history doesn't depend on how ticks fell.
- **Catch-up.** After an absence, tiers 0–2 run every missed boundary in order, each within the hard limits.
- **Fine tiers (3–5)** run only where demand reaches them (§10.6). They never catch up: when V arrives, their state is generated from the coarse state, consistent with the pins.
- **Coarse against fine** (v4.5). A process registration MAY declare `coarseFine`: `exact`, `count`, or `distribution` with a tolerance. This is the agreement it owes between its coarse state and fine state generated from it. The test harness picks the test from it; resolution ignores it.

## 10. Context frames and relevance

### 10.1 Drives

Actors carry `drives`: many `core:drive-state`. The kernel only reads importance and urgency. S1's policies change them, through simulation pins on `urgency`'s windows and contributions on `importance`.

### 10.2 Frames

```ts
interface ContextFrame {
  id: Id; actor: Id;
  level: 'drive' | 'concern' | 'goal' | 'step' | 'situation';
  parents: Array<{ frame: Id; weight: number }>;      // acyclic (§10.3)
  origin: Id;                          // the originating drive or concern
  payload: { drive?: DriveId; goal?: Goal; place?: Id };
  weight: number;                      // 0..1
  own: FrameInterests;                 // what this frame adds over its parents
  focus: { nodes: Id[]; tier: Tier };
  status: 'active' | 'blocked' | 'satisfied' | 'abandoned';
  opened: GameTime; cause: Id;
}

interface FrameInterests {
  wants: Selector[]; reactsTo: Selector[]; blockedBy: Selector[];
  threatenedBy: Selector[]; protects: Selector[];
}

interface Goal { effects: Array<{ on: Id | Selector; effect: Effect }> }
```

### 10.3 Inheritance and pull

- **Acyclic.** Frame parent links form a DAG, and a link that would close a cycle is refused.
- **Members** may take a group's concern frames as parents (§12).
- **Leaders** change a group's concerns only through S1's decision operations, never through parent links.

**Eligibility.** A parent counts only while its status is `active` or `blocked`.

**Pull:**

```
pull(f) = f.weight                                                              if f has no eligible parent
pull(f) = f.weight × max over eligible parents p of (edgeWeight(p) × pull(p))  otherwise
```

Influence from one `origin` therefore counts once, through its strongest path.

### 10.4 Lifecycle

- **Demand roots** are V, the director and every live seed. Their frames are opened by S1 (V's, from the game's story state and the director's beliefs) and by S2.
- **Other actors' frames** open when a root's frame, or a relevance event, focuses on them.
- **In the interest set:** `active` and `blocked` frames. Blocked frames keep listening for what would unblock them.
- **Out of it:** `satisfied` and `abandoned` frames. They are kept while a persisted record refers to them.
- **Status, weight and parent changes** recompute descendants' pull and eligibility through the frame worklist (§10.7). Relevance dispatch waits until that worklist is empty, so no consumer sees half-updated frames.
- **Suspension under budget** is deferred (§0.2). When the budget runs out, queued work waits; frames keep their status and interests.

### 10.5 Changes and matching

**The change payload.** Semantic changes are the only things that produce relevance (I-13):

```ts
type Change =
  | { c: 'pin'; node: Id; slot: SlotPath; old?: Value | Region; new: Value | Region; reason: string }
  | { c: 'edge'; edge: Edge; ended: boolean }
  | { c: 'event'; event: Id; kind: string; place?: Id;
      participants: Array<{ who: Id; role: string }>; effects: Array<{ on: Id; effect: Effect }> }
  | { c: 'minted'; node: Id; kind: KindId }
  | { c: 'contribution'; contribution: Contribution; ended: boolean }
  | { c: 'reading'; node: Id; slot: SlotPath; old?: Value; new: Value }    // a game reading that changed a value
  | { c: 'frame'; frame: Id; actor: Id; level: string; old: string; new: string };   // a frame status change (v4)
```

A `frame` change is produced when a frame's `status` changes. Weight and parent changes produce none.

Cache fills, regeneration and save replay produce no changes.

**Matching.** A change has one or more **subject bindings**. Each binding is a subject node together with how it relates to the change:

| Change | Bindings |
|---|---|
| Pin or reading | Its node, with `slot` = the pinned slot |
| Edge | Each endpoint, with `role` = `from` or `to` and `edge` = the edge's type |
| Event | The event node itself, its `place` (with `role` = `place`), each participant's `who` (with `role` = the participant's role), and each effect's `on` (with `role` = `target` and `effect` = the effect) |
| Minted node | The node |
| Frame status (v4) | The frame's actor, with `role` = `actor`, and each node in the frame's focus, with `role` = `focus` |
| Contribution | Each node its target selector names by scope. The reference model treats any other target as matching interests whose kind and scope overlap it, which may over-match |

An interest selector `σ` matches change `x` if **one binding** satisfies all of the following:
1. **Kind:** `σ.kind`, if set, is the binding's kind or an ancestor of it.
2. **Scope:** `σ.scope`, if set, contains the binding's node.
3. **Slot:** if `σ.slot` is not `'*'`, the binding's `slot` equals it.
4. **Where:** every `σ.where` predicate holds for the binding. Predicates read the binding's node, evaluated on new values (on old values for ended edges and removals). They may also test the binding's relation with the paths `@role`, `@effect` and `@edge`.

**The first implementation scans every registered interest.** A routing index is deferred (§0.2).

**Specificity `s(σ, x)`** **[calibrate]**:
- 1.0 when the matching binding's node was named by `σ.scope.nodes`, or by `Id` in `σ.where`;
- 0.5 for kind or tag matches;
- 0.3 for bucket matches, meaning `where` predicates on `buckets` keys.

**Relevance and delivery.** For a match through an interest of type `t`, declared on frame `f`:
- **Delivery.** The match is delivered to `f` and to every descendant `d` of `f` whose path to `f` runs through eligible frames.
- **Strength.** For each receiving frame `d`, the match's relevance is `r = pullVia(d, f) × m(t) × s`:
  - `pullVia` is `d`'s pull computed only through paths that run through `f`;
  - `m` is 1.0 for `wants`, `threatenedBy` and `protects`, 0.8 for `blockedBy`, and 0.6 for `reactsTo` **[calibrate]**.
- **Emission.**
  1. Each receiving actor gets at most one emission per (change, frame, interest type): the one with the greatest `r`.
  2. It is emitted when `r ≥ θ_react` **[calibrate]**, as `Relevance { actor, frame, change, type, r }`.
  3. Emissions go to S1 and S3, in order of actor (demand roots first), then frame `Id`. Emissions on frames whose actor is one layer 2 has registered (every `core:seed`, and the pack roots that carry sowing watchers) go to layer 2 (S2) as well, in the same order (v4; widened in v4.6). Layer 2 also hears dilemmas (§10.8) whose frames belong to those actors.

**For layer 3** (v4.7, a clarification):
- a frame MAY carry many interests for one pattern;
- a `Relevance` emission carries the change payload itself, not only its id;
- a root actor's frames may be opened and closed as packs load and unload.

**Event kinds and envelopes** (v4.8):
- **The registry.** An event's kind is the `kind` slot of `core:event` (§9.2). Packs register event kinds, with their tags and producers, in an **event-kind registry**. Selectors and patterns match kinds through `where` predicates on that slot, never through `KindId`s. The registry also holds the inert `meta:` kinds layer 3 mints.
- **Envelopes.** Every delivered relevance emission and dilemma carries a stable **occurrence id** (the event's `Id`, or the change's own id) and the occurrence's **game time**.
- **Soft exclusions** live in `SettingsSet.content.softExclusions` (V4-21).

### 10.6 Demand and tiers

A node's demand tier is the highest `focus.tier` among active or blocked frames focusing on it or its owner chain. A frame's claim weighs `pull × w_actor`, where `w_actor` is **[tunable 4.0]** for demand roots and 1 otherwise. Slots normally open when the node's demand tier reaches the slot's `tier`. Queries, seeds and preimages may open finer slots.

Tiers are scheduling bands, not an ontology or a depth limit.

### 10.7 Work: hard limits and worklists

**Atomic operations are bounded by one shared work allowance** **[tunable]**. Each outer operation (a resolution or a query) gets one counter. Nested resolutions, candidate queries, value enumeration, contribution evaluation and predicate tests all consume from it. Exhausting it returns `failed` for the outer operation and records a defect for inspection. The shape limits below also apply:

| Atomic operation | Hard limits |
|---|---|
| A resolution | `N_enum` values; 256 applicable contributions; 64 points per field; dependency depth 32 |
| A query | 50,000 frontier steps; 5,000 exact checks |
| The shared allowance per outer operation | 200,000 units: one per value enumerated, contribution evaluated, predicate tested or frontier step |

**Worklists are resumable and budgeted.** Each worklist runs in a fixed order, and stops and resumes deterministically:
- relevance dispatch;
- frame recomputation;
- forgetting;
- summary materialisation;
- process catch-up.

The per-tick work budget is **[tunable; P7 measures it]**. It is counted in allowance units consumed, plus one unit per interest examined by relevance dispatch, whether or not the interest matches. Work for demand roots, and for the player's own actions, is taken first.

### 10.8 Effects and cross-pressure

**Effects** form a small vocabulary: `harm`, `kill`, `help`, `protect`, `rescue`, `take`, `give`, `expose`, `conceal`, `move`, `meet`.

**The conflict table** is a registry function [S1]. It maps (interest type, effect) to `violates` or `ok`. Its first version is:

| Interest | Violated by |
|---|---|
| `protects X` | `harm`, `kill`, `take` or `expose` on X |
| `wants Y` | `conceal` or `take` on Y |

`help`, `protect`, `rescue`, `give` and `meet` violate nothing in it.

**When it is checked:**
- a goal frame opens;
- a membership edge is added or changed;
- a membership's obligations change;
- a frame's interests change.

**The check:**
1. For each effect target, scan the actor's other active or blocked frames from a **different origin** whose interests mention that target.
2. Apply the conflict table.
3. For each violation, emit `Dilemma { actor, frameA, frameB, target, effect, severity: pull(A) × pull(B) }`, at most once per (frameA, frameB, target, effect) until either frame changes.

**Recipients** (v4, a clarification). Dilemmas go to S1, S3 and layer 2, in emission order, with relevance emissions. They are not persisted: a reader that needs one keeps what it needs.

## 11. Beliefs and perspectives

### 11.1 The belief record

```ts
interface Belief {
  id: Id; believer: Id; subject: Id; path: SlotPath;
  value?: Value; region?: Region;      // exactly one
  at?: GameTime;                       // for time-varying paths: the time the belief is about
  confidence: number;                  // (0, 1]
  evidence: Id[];                      // originating events: the independent support
  source: { by: 'observed'; event: Id } | { by: 'told'; teller: Id; event: Id } | { by: 'inferred'; rule: FnRef; from: Id[] };
  formed: GameTime; refreshed: GameTime; memorable: boolean;
  uses?: number;                       // v4.1: corroborations, recalls and retellings (default 0)
  salience?: 0 | 1 | 2 | 3;            // v4.1: rated at formation by onWitness (default 0)
  widened?: number;                    // v4.1: how far the value has blurred (0 = exact)
}
```

Beliefs are stored per believer and indexed by (subject, path, at). They never constrain world state.

### 11.2 Kernel rules

- **One belief per question (I-9).** A believer holds at most one active belief per (subject, path, at). S1's policy decides whether a contradicting newcomer replaces it. The loser is kept as history only if memorable.
- **Only independent evidence corroborates.** A merge raises confidence only for evidence not already held. If the newcomer's `evidence ⊆` the existing belief's, only `refreshed` changes.
- **Telling passes the teller's `evidence` on unchanged,** so a rumour from one origin never corroborates itself.
- **Policies are S1's.** Forming, telling, fading and reputation are S1 policies, called through these hooks:
  - `onWitness(event, observer)`;
  - `onSocial(event, teller, listener)`;
  - `onTick(believer)`;
  - `aggregate(audience: Id | Selector, subject: Id, path: SlotPath, t: GameTime) → { value?: Value | Region; mass: number; items: number }` (contract stated in v4.3). It is a pure read over the beliefs of the audience's carriers, not over every resident. It is deterministic and cacheable by revision and `t`, counts against the shared allowance, and never writes. `mass` counts each independent piece of evidence once, so a rumour retold by three tellers weighs as its origin;
  - `onRecall(believer, belief, encounter, cue)` (v4.1), below.

**Forgetting beliefs** (v4.1). Forgetting is lazy, shaped like blurring, and never touches the record of events. It has three parts:
- **Accessibility** is a registered pure function of a belief's fields and the query time, evaluated when read. The first policy follows [dossier 11](../craft/d11-saves-memory-forgetting.md):

  ```
  accessibility(b, t) = ln(2 · max(1, uses)) − ½ · ln(max(1, t − refreshed)) + importance(salience) + cue
  ```

  It uses only `ln` and arithmetic (§1.3). No process ticks it.
- **Recall.** `onRecall` returns the form of a belief at an encounter: `exact`, `region`, `gist` or `gone`. A `region` comes from the slot class's `Widen`. The draw is `rand("recall", believer, belief.id, encounter)`, where `encounter` is the stable `Id` of the contact event S1 mints, so the same question gets the same answer after a reload. Recall is evaluated **once** per (belief, encounter): the result is stored with the encounter, `uses` increments once, and a delivery that depends on it keeps the result and the belief state it rests on (v4.6). The forms nest: a believer who can recall a belief exactly can also recall it as a region or as gist.
- **The sweep** runs once per `W_forget` game seconds **[tunable 86,400]**, as the forgetting worklist (§10.7). It touches only beliefs that are not memorable, and only those whose accessibility has fallen below the **floor**: the accessibility at the most generous memory setting. A belief below the floor is widened one level by `BeliefSet`, or dropped by `BeliefDropped` once it is gist. A setting raised later can therefore restore anything blurred under a stricter one, because the sweep never went below what the most generous setting would keep.

Events, pins and canon are never forgotten by this. Beliefs are views of them.

  The first policy follows [foundation §5.4](../foundation.md#54-perspectives-everyone-has-their-own-model).

### 11.3 The director's beliefs about V

The root actor `director` holds beliefs about `v`, formed by S3's inference policy from observed V events and engagement. V's inferred frames come from them. Nothing pins or sets V's drives (I-12).

### 11.4 Knowing

Perspective-bound policies read the world only through `knows(observer, subject, path, t)`. It answers in order:
1. **The observer's belief,** if it has an active one.
2. **What the observer can see.** If the observer witnessed the subject at `t`, it sees:
   - a mirrored slot's reading, when the slot's dimension is marked visible by S1's perception policy (an outfit, for example);
   - an edge whose type is `perceivable` and whose own `visibility` is `open`.

   A `secret` or `deniable` membership is never perceived.
3. **`unknown`.** It never falls back to world truth.

World-level simulation reads world truth through ordinary resolution.

## 12. Groups and membership

- **Groups** are actors with the `group` facet.
- **Membership** is a `core:member-of` edge (§2.6).
- **Inheritance.** A member's frame of drive family `X` may take as a parent each active concern frame, of family `X`, of each group the member belongs to with `strength ≥ θ_member` **[tunable 0.2]**. The edge weight is `strength`. Concerns without a family attach to the member's situation frame.
- **Orders** create a goal frame on the member whose parent is the group's goal frame, at edge weight `pressure`. S1 computes `pressure`.
- **Leaders** act through S1 decisions only (§10.3).

## 13. Provenance and explanation

Every pin, contribution, edge, belief, event, frame and dilemma has a `cause`.

**`trace(node, slotPath, t)`** returns the complete, deterministic record:
- every constraint, marked active or rejected;
- the feasible set's size;
- every applicable weight contribution, with its normalised factor at the winner;
- the prior;
- the winner's score and noise, and the runner-up's (second by `score + g`).

**`explain(…)`:**
- **With two or more feasible values,** it presents the top `k` **[tunable 8]** contributions by signed discriminating effect:

  ```
  effect(c) = strength_c × (ln f̂_c(v*) − ln f̂_c(v₂))      (v₂ = the runner-up)
  ```

  This is labelled a heuristic.
- **With one feasible value,** it presents the active constraints that produced it.

The trace is the complete account (I-8).

## 14. Persistence: the logical record

### 14.1 What is persisted

- **Headers** of every retained node (§7.3).
- **Pins**, including game readings that V observed or that persisted events depend on. Other game readings are not persisted: they are re-read.
- **Edges** with persisted causes.
- **Contributions** that packs can't reproduce: seeds, committed procedural decisions, runtime authored decisions. Pack contributions are reloaded, and the record keeps each pack's id and version.
- **Memorable beliefs.**
- **Canon events:** their headers and pinned fields.
- **Summaries,** with their `canon` sets.
- **Frames:** those of demand roots and live seeds, and every ancestor frame they inherit from, whoever's it is.
- **States:** seed states (S2), and process cursors and states (S1), including each process's outstanding output batches (§9.4). A seed state is a `SeedRecord { id, state, nodes, actor? }` whose `state` is the owning layer's plain data. Its `nodes` are retention roots, and its `actor`, if set, is a demand root. Any layer MAY keep its own records this way under an id it owns, such as S2's global record or S3's promoted sifting matches (v4, a clarification; [dossier 6](../craft/d06-sifting-tellability.md) G-8).
- **Lineage:** the world seed, plus schema and function versions (§14.4).

**Not persisted:**
- caches and unretained nodes;
- conflicts, which `trace` derives;
- relevance events;
- the current game state.

### 14.2 Records and branching

Each save has a record `{ saveKey, parent, ops }`, where `parent` is the record of the save it was made from. `ops` is an append-only log of these operations:
- `HeaderAdded`;
- `PinAdded`, `PinWithdrawn`, `PinEnded` (sets a retained pin's `valid.to`, §6.3);
- `EdgeAdded`, `EdgeEnded`;
- `ContributionAdded`, `ContributionEnded`;
- `BeliefSet`, `BeliefDropped`;
- `EventCanon`;
- `SummarySet`;
- `FrameState`, `SeedState`, `ProcessState`;
- `SettingsSet { memoryScale, resetScale, noticing, exclusions, modelFloor, cityScale, classExclusions, content, tempo, at }` (v4.1; city settings v4.2; `content` v4.3, typed in v4.4 as `{ preset, ceiling per class 0..3, notice per class, softExclusions }`, marked sensitive and dropped from exports and bug reports by default, like the director's beliefs about V): every player setting that changes what is offered or remembered, in force from `at`. `noticing`, `exclusions` and `modelFloor` are the director's model settings ([S2 §8.8](seeding.md#88-the-player-models-boundary)). The lineage root records the initial settings. Replays and the harness use the settings in force at each op. Settings that change only presentation are not recorded.

Snapshots are written every **[tunable 10,000]** ops. Ops carry complete data.

### 14.2a Staged batches (v4.6)

Layer 2 sometimes needs to try a set of changes, check them, and keep them only if the checks pass (S2 §8.4). A **staged batch** supports this:
1. **Open.** `stage()` opens a batch. Operations applied inside it are visible to resolution, `trace` and queries made through the batch, and to nothing else.
2. **Silence.** While a batch is open, it emits no changes, relevance or dilemmas. Its operations aren't persisted. Other operations are not interleaved with it.
3. **Commit.** `commit()` applies the batch's operations as one unit. They are persisted, the revision advances, and their changes are dispatched in the order the operations were made.
4. **Discard.** `discard()` drops the batch. No operation, change or revision remains. Only the caller's own diagnostic record says it happened.

A batch is bounded by the shared work allowance (§10.7). The reference model MAY implement it by snapshot and restore.

### 14.3 Loading is replacement

The engine keeps a session `epoch`, a fresh `Id` per load. Every queued operation is tagged with the epoch it was created in. Loading save `B`:
1. Discards all branch-local state: caches, in-memory nodes, frames and interests, worklists, pending relevance, and every queued operation. An operation tagged with an earlier epoch that arrives later is refused.
2. Replays `B`'s ops from its nearest snapshot, silently (I-13).
3. Reconciles with the game: reads the mirrored state, which becomes `game` readings at the current time.
4. Starts a new epoch and resumes ticking.

### 14.4 Compatibility

The lineage root records the schema and function versions. Loading under newer versions is allowed while every function a persisted record depends on is still available at a compatible version. Otherwise the record loads read-only, with a plain message (S6).

## 15. Invariants

| # | Invariant |
|---|---|
| I-1 | **Determinism.** The same seed, schema, function versions, contributions, pins and operation sequence give identical results in every implementation, using §1.3's arithmetic |
| I-2 | **Active constraints hold.** Every resolved value satisfies every constraint arbitration made active. A rejected constraint of precedence ≥ 600 sets the status to `contradiction` |
| I-3 | **Regeneration.** A forgotten node resolves identically while its constraints and contributions are unchanged |
| I-4 | **No caches persisted** |
| I-5 | **Active views agree.** Inputs satisfy every active preimage constraint. A violated multi-input view pin yields `contradiction` |
| I-6 | **Queries are sound and complete** against one revision (§8.3) |
| I-7 | **Coupled draws.** Changing one value's weight changes a result only if that value was or becomes the winner. Scaling a factor uniformly changes nothing mathematically; tests check the specified binary64 computation |
| I-8 | **The trace is complete** |
| I-9 | **One active belief** per (believer, subject, path, at) |
| I-10 | **Bounded work.** Atomic operations stay within hard limits or return `failed`. Worklists stay within the tick budget and resume deterministically |
| I-11 | **Stable identity.** Moving a node never changes its `Id` or pins |
| I-12 | **V is never owned.** Nothing pins or sets V's drives. V's choices enter only as observed events |
| I-13 | **Silence.** Resolution, regeneration and replay produce no changes and no relevance |
| I-14 | **Acyclic frames** |
| I-15 | **Partition independence,** given the same timestamped external operations and the same demand history |
| I-16 | **Session independence** (v4.1). No draw key, `Id`, ordering or tie-break reads the session `epoch`, the play clock, the wall clock or a load count. The epoch only refuses stale operations (§14.3). "Epoch" means only the session's |

## 16. Fixtures

### 16.1 Acceptance fixtures

Fully specified: outcomes that depend on hashes are checked as properties, not numbers. Every fixture uses `worldSeed = H("fixture", <fixture id>)` and `W_sim = 600`.

| # | Setup | Expected |
|---|---|---|
| F-1 | **Arbitration.** Enum {a, b, c, d}. Observation pin {a, b} (600); authored set {b, c} (400); seeding set {c} (300); simulation set {a, b, c, d} (200) | Active: 600, 400, 200; rejected: 300. `F` is {b}; value b; `ok` |
| F-2 | **Contradiction.** F-1, plus a second observation pin {c} with a higher `Id` | The second observation is rejected; `F` is {b}; value b; `contradiction` |
| F-3 | **Timeline.** Weather is mirrored. Readings: rain at 1,000, clear at 2,000. V observes each reading | Resolving at 1,500 gives rain; at 2,500, clear. Two observed pins with consecutive intervals; no contradiction |
| F-4 | **Unary view.** `age` 16..90; `age-band` derived as `floor(age / 10)` with its preimage. Observation pins `age-band = 3` | `F_age` is 30..39 and `age` lies in it. A later authored pin `age = 45` (400) is rejected |
| F-5 | **Coupling.** 1,000 nodes, each with an enum slot of 100 values and equal priors. Resolve; give value `a` a `Table` factor of 4 (others 1); resolve again | For every node, the new result is `a` exactly when `a`'s updated perturbed score beats every other value's updated score (ties by the hash rule). Otherwise the result is unchanged. Both are checked from the trace. Multiplying every factor by 3 leaves every result unchanged |
| F-6 | **Query.** A tree: 1 district, 4 blocks, 16 places, all compound regions bounded `maybe`. Five places satisfy `influence ≥ 0.6` and `police ≤ 0.2` | `'all'` returns exactly those 5, with no duplicates |
| F-7 | **Summary.** Five robberies over one day, scope = a district with two blocks. Query block 1, then the whole district; make item 2 canon; then the process withdraws its count pin and pins `count = 2` | Block 1's items are a subset of the district's, with the same `Id`s. The pin `count = 2` is rejected by the structural constraint (≥ 3), and the count resolves to a value ≥ 3 |
| F-8 | **Cross-pressure.** M is a member of G. M's family frame (origin: M's `family` drive) `protects X`. G orders M: order A, a goal with effects [{kill, X}]; separately, order B, a goal with [{rescue, X}]. Each creates a goal frame on M whose origin is G's goal | A gives one `Dilemma`; B gives none |
| F-9 | **Hearsay.** Alice observes E (belief with evidence {E}), tells Carl, Carl tells Dana; then Alice tells Dana | Dana's belief has `evidence = {E}`. The second telling only refreshes it |
| F-10 | **Secret affiliation.** `core:member-of` is perceivable. Bob's Militech membership is `secret`; Alice witnesses Bob | `knows(Alice, Bob, member-of)` is `unknown`. With the same edge type and `visibility: open`, it returns the membership |
| F-11 | **Leadership.** L leads G and is a member of G | No frame cycle. G's concerns change only through decision operations attributed to L |
| F-12 | **Branching.** Save A; pin p1; save B; load A; pin p2; save C; load B | B has p1 and not p2. An operation queued under C's epoch is refused. Replay emits nothing |
| F-13 | **Partition.** Process "tally", tier 0, period 1 window: in window k it pins `counter@w<k> = counter@w<k−1> + floor(rand("proc", seed, "tally", k) × 10)`, with `counter@w<−1> = 0`. Run 12 windows as one tick, and again as 12 ticks | Identical counter histories |
| F-14 | **Retained member.** A crowd count of 12; member 9 is focused by V's frame (no pin). An authored constraint sets the count to 6 | The count is 10 or more (the structural constraint, 700, rejects 6), and member 9 stays addressable |
| F-15 | **Cycle guard.** A kind whose slot reads itself through an invalid schema the loader missed (tested by bypassing the loader) | Resolution returns `cycle` and records a defect |
| F-16 | **Session independence** (v4.1). Run F-12's sequence twice, with different epochs and play and wall clocks | Identical records and resolved values |
| F-17 | **Jump versus tick** (v4.1). Beliefs and a forgetting sweep over 30 game days, run as one jump and as 30 daily ticks | Identical beliefs |
| F-18 | **Widening keeps the truth** (v4.1). A belief `age = 34`, widened level by level to gist | Every region contains 34 |
| F-19 | **Nested recall** (v4.1). The same belief recalled at one encounter at several accessibility levels | `exact` implies `region` implies `gist` |
| F-20 | **Lens invariance** (v4.1). Blur beliefs under a strict memory setting; raise the setting | Beliefs above the new floor read as before blurring wherever the sweep didn't widen them; no event, pin or exposure changed |
| F-21 | **Cluster process** (v4.2). A self-exciting process with a persisted pending calendar of offspring and thinning, run for 12 windows as one tick and as 12 ticks | Identical calendars and fired lists |
| F-22 | **Mid-cascade reload** (v4.2). The F-21 process saved mid-cascade and reloaded under a different epoch, play clock and wall clock | The same future |
| F-23 | **Implicit edges** (v4.3). An implicit tie type over a block's residents | Symmetric. Identical answers after a reload and under a changed tick partition |
| F-24 | **Aggregate** (v4.3). A chain of three tellers from one origin; a 30-game-day absence; then `k` contrary independent items | The chain weighs as the origin. The absence changes no label. The `k` items flip it |
| F-25 | **Norm slot** (v4.3). A norm updated by a public act and by a private act, over 12 windows as one tick and as 12 ticks | Identical results; only the public act moves perceived support |

### 16.2 Calibration fixtures

These set the **[calibrate]** values. The chosen values are:
- `m`: `wants`, `threatenedBy` and `protects` 1.0; `blockedBy` 0.8; `reactsTo` 0.6;
- `s`: by `Id` 1.0; by kind or tag 0.5; by bucket 0.3;
- `θ_react = 0.08`.

Downstream consumers (S1, S3) apply their own, higher thresholds for anything costly.

| # | Frames (root frames have no parents; child edges weigh 1) | Change | `r` | Expected |
|---|---|---|---|---|
| C-a | A pedestrian. Drive frame `comfort`, weight 0.5, root. Situation frame, weight 1, child of it, with `reactsTo: { where: [weather-bucket in {rain}] }` | A weather reading changes to rain | 0.5 × 0.6 × 0.3 = 0.09 | ≥ θ_react |
| C-b | A vendor. Drive frame `money`, weight 0.8, root. Concern frame `protection-payment`, weight 0.9, child of it, with `threatenedBy: { kind: core:person, where: [@role = collector, has-edge member-of → Tyger Claws] }`, plus a second interest `threatenedBy: { kind: core:place, scope: { nodes: [stall] }, where: [@role = place] }` | (1) An event at the stall whose participant is a Tyger Claw collector. (2) The same event elsewhere in the district | (1) The stall binding: 0.72 × 1.0 × 1.0 = 0.72. The collector binding: 0.72 × 1.0 × 0.5 = 0.36. The greatest, 0.72, is emitted. (2) The collector binding only: 0.36 | (1) ≥ θ_react, and the greatest of C-a to C-c. (2) ≥ θ_react, but lower than (1) |
| C-c | The vendor's work frame, weight 0.6, root, `wants: { kind: core:person, where: [@role = customer] }` | A customer arrives (an event with a `customer` participant) | 0.6 × 1.0 × 0.5 = 0.30 | ≥ θ_react, and below C-b(1) |
| C-d | V: a frame `protects`, weight 1, root, `{ scope: { nodes: [friend] }, where: [@effect = harm] }` | An event with effect `harm` on the friend | 1 × 1.0 × 1.0 = 1.0 | The greatest of all |

### 16.3 Property, soak and docking tests

The fixtures above are examples. The next version of the reference model also checks the invariants as **properties**, over generated operation scripts drawn from logged named streams, shrinking failures to the smallest script ([dossier 23](../craft/d23-evaluation-testing.md) §12, S23-S0-01 to S23-S0-17):
- I-1 to I-16 as properties;
- random tick partitions and random save and load points;
- regeneration under random forgetting;
- summary and item agreement across scopes;
- a library of metamorphic relations: unrelated nodes, renamed ids, permuted independent operations, scaled weights;
- hard limits with fault injection;
- damaged, truncated and foreign loads;
- session independence;
- never-dropped beliefs at every memory setting.

**Further work:**
- **Digests.** Second and third digest scripts cover the v4 operations, fine tiers and `explain`.
- **A soak run:** 100 game-years on 20 seeds, under the memory guard.
- **A cross-implementation runner** compares the reference model and the native core hash by hash.
- **A relevance gold set:** 50 to 100 hand-written "who should care" cases. It is the evidence that would trigger revisiting C-03.

## 17. Compromises and open items

These are recorded in the foundation's [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger).

| # | The model says | This specification does | Revisit when |
|---|---|---|---|
| C-02 | A believer's view is a full perspective over every dimension | Beliefs are sparse records; their policies live in S1 | A story needs an NPC to reason beyond what the policies express |
| C-03 | Relevance follows from what matters to each actor | Fixed match weights per interest type and specificity, set by calibration fixtures | Evaluation shows misplaced attention that recalibration can't fix |
| C-04 | Every dimension is sampled the same way | Draws enumerate at most `N_enum` values. Large lists are split by an earlier slot (`enum-by`). Text and vectors are derived, mirrored or pinned, never drawn | A dimension can't be split this way |
| C-05 | Pins propagate both ways through everything | Backward narrowing only through unary preimages and structural counts. Slot dependencies follow declaration order and the owner chain; refs are not dependencies. Everything else is generate-then-justify | A scenario needs a later fact to constrain an earlier one in a way these can't express |

**Open items:**
1. Measure the BLAKE3 and fdlibm `ln` ports for bit-identical results in TypeScript and Rust. This is the reference model's first test.
2. P7 sets the work budget and the hard limits from a measured simulated session, and measures save size before any budget.
3. S5 fixes the `GameTime` epoch and clock mapping.
4. S1 writes the first policies: urgency, attribution, telling and fading, group decisions, the visible-slot perception policy, and the conflict table's contents.
5. Later versions take up each deferred item in §0.2. Each needs a recorded contract that agrees with the reference model.

## 18. Review record

### Round 1: GPT-6 Astra, extra-high effort, on v0

25 findings: 22 adopted, 3 adopted with a different solution. The disposition of each is summarised by area in the table below. Round 2 assessed them as 12 sound, 11 sound with caveats, and 2 not fixed. Round 2's findings closed the caveats and the gaps.

| Area | Round-1 findings | v1 resolution | Round-2 status and v2 change |
|---|---|---|---|
| Time | A-01 | Windows, with the game authoritative | Caveat (B-07). Mirrored state is now a timeline of readings; windows only for simulated quantities |
| Arbitration | A-02 | One pass, highest precedence first | Sound. Conflicts are now derived, not stored (B-16) |
| Dependencies and propagation | A-03 | Declaration order; backward through views | Not fixed (B-01, B-02). Reads are limited to earlier slots and the owner chain, refs are not dependencies, and a cycle guard is added. Unary preimages only |
| Frames | A-04, A-17 | DAG, decisions, lifecycle | Caveats (B-13). Eligibility, delivery to descendants, and the frame worklist completing before dispatch are defined. Suspension is deferred |
| Queries | A-05, A-07 | Traversal fixed, conservative bounds | Caveats (B-11). Atomic queries against one revision; complete candidate sets for refs; `failed` on limits |
| Data contract | A-06, A-11, A-12 | Owned values, refs, schema, summaries, headers | Not fixed or caveated (B-05, B-09, B-10). Identity formulas per origin match the headers; `vec` and `text` restored as derived or mirrored only; a registry ABI; structural constraints at 700; retention follows every persisted `Id` |
| Caching | A-08 | Global revision | Not fixed (B-08). Keyed by revision and query time |
| Silence | A-09 | Only semantic changes emit | Sound |
| Sampling | A-10, A-22 | Hierarchical samplers; Gumbel-max | Not fixed (B-03). Flat Gumbel-max only; `enum-by` replaces hierarchy; factors normalised so uniform scaling is invisible |
| Work | A-14 | Units and worklists | Not fixed (B-12). Hard limits make atomic operations bounded; worklists stay budgeted and resumable |
| Persistence | A-13, A-15 | Replacement load, retention-driven | Sound, with a caveat (B-16 conflicts) closed |
| Evolution | A-16 | Canonical windows | Caveat (B-04). One shared window and a defined boundary order |
| Matching | A-18 | Routing and calibration | Not fixed (B-06). A defined change payload and exact matching rules; a conservative scan; concrete calibration fixtures |
| Cross-pressure | A-19 | Effects and conflict table | Caveat (B-17). `rescue` added; the first table is stated |
| Knowing | A-20 | `knows` interface | Not fixed (B-14). Perception requires the instance's `visibility` to be `open` |
| Beliefs | A-21 | Evidence identities | Sound |
| Determinism | A-23 | fdlibm, sum order | Caveat (B-18). The open-interval unit, a pinned fdlibm source with bit-word operations, no `exp`, normalised factors, and a stated scope for exactness |
| Fixtures | A-24 | Fourteen fixtures | Caveat (B-17). F-5 is exact, F-13 has a process, F-15 is added, and the calibration fixtures are concrete |
| Explanation | A-25 | Discriminating effect | Caveat (B-19). The singleton case is handled; the runner-up is by perturbed score |
| Falloff | (new) | — | B-15. Kernels are piecewise, zero outside the radius |

### Round 2: GPT-6 Astra, extra-high effort, on v1

19 findings (B-01 to B-19), all adopted. B-03, B-06, B-11 and B-12 were adopted mainly by deferring the general mechanism and narrowing the first implementation (§0.2), as the review recommended. Its "defer to v2" list was adopted in full.

### Round 3 (final): GPT-6 Astra, extra-high effort, on v2

**Round-2 resolutions:** 11 sound, 5 sound with a caveat, 3 not fixed (B-06, B-12, B-18). The caveats and gaps are closed by the findings below.

**10 findings (C-01 to C-10), all adopted:**

| Finding | v3 change |
|---|---|
| C-01 Pending process outputs could vanish on load | Outstanding batches are part of `ProcessState`: persisted and restored (§9.4, §14.1) |
| C-02 Pinned-only values had no resolution branch | The `assigned` mode (§2.2, §5.1) |
| C-03 Matching couldn't express the calibration cases | Subject bindings with `@role`, `@effect` and `@edge`; slot tests; event places as subjects; calibration fixtures with computed `r` and `θ_react` = 0.08 (§10.5, §16.2) |
| C-04 Limits didn't bound total work | One shared allowance per outer operation; dispatch charges every interest examined (§10.7) |
| C-05 Reading intervals didn't survive saving | Half-open intervals, equal-time ordering, a `PinEnded` operation (§6.1, §6.3, §14.2) |
| C-06 Retention kept too much and missed parent frames | Roots are current semantic facts; ancestor frames persisted (§7.3, §14.1) |
| C-07 The top-k stop broke ties | Stop only when every remaining bound is strictly lower (§8.3) |
| C-08 Summary refinement versus atomic queries | Item descriptors enumerated synchronously; materialisation is cache; only canon persisted (§8.3, §9.3) |
| C-09 Two numerical claims were false | 52-bit open-interval unit; scaling invariance stated mathematically, tests on the computation; F-5 compares updated scores (§1.2, §1.3, I-7) |
| C-10 Opposite-effect rule and F-8 setup | Explicit violation pairs only; F-8 uses explicit orders (§10.8, §16.1) |

Its "could be lighter" points were adopted: `Bound`s are optional, summary materialisation is cache, the conflict table uses explicit pairs only, and there is no promise of exact invariance under rescaling.

### Final decision on the first implementation

The review process is complete ([D-17](../decisions.md)). This vertical's coordinator has decided ([D-19](../decisions.md)) that the first implementation, the TypeScript reference model, implements this specification as v3 states it: everything except the items deferred in §0.2. Every deferred item returns only with a recorded contract that agrees with the reference model. Changes to this scope come only through a new decision.

## 19. Decisions adopted from the reference model

The [reference model](../../../projects/xf-story-engine/README.md) is on `main`: 261 tests, and three independent code-review rounds with no findings left open. Building it took 57 decisions where this specification was silent or ambiguous. All 57 were accepted. They are recorded, numbered, in [SPEC-NOTES.md](../../../projects/xf-story-engine/reference/SPEC-NOTES.md), which is **normative alongside this page**: a later implementation follows them exactly as it follows the text above. The ones that change results:

| Area | Decision | Note |
|---|---|---|
| Pins and time | Pins on enduring slots apply at every `t`; `at` records only when the fact was learned. Pins on simulated temporal slots name their window (`slot@w<k>`). Readings and observations of mirrored slots use half-open intervals that are never extended, and equal timestamps are ordered by `Id` | 5, 34, 36 |
| Values and hashing | Reals are held as grid points and hashed by grid index. Hash arguments are explicitly typed. Every hashed or compared record uses one canonical record encoding (sorted keys, a fixed number format) | 1–4, 52 |
| Resolution | An `assigned` slot also takes a value when arbitration leaves exactly one. A `ref` pin or constraint names nodes outright, and candidates only fill unconstrained draws. A nested `failed` fails the outer resolution or query. Caches are valid for one revision **and** one engine time | 6, 38, 53, 54 |
| Evolution | Boundaries are processed one at a time: frame work and dispatch, then belief hooks, then what they queued. New process batches are published together after every starting process has read the boundary snapshot. Outstanding batches persist and are roots | 33, 50, 53, 56 |
| Matching | Each change is matched on its own values (old values for removals) at its own time, including temporal windows | 22, 57 |
| Persistence | A save's `meta` carries the world seed, time, evolution cursor, function versions, packs, demand roots and demand history. Ops are produced by a diff at save time. A read-only load changes nothing, packs included | 19, 20, 39, 55 |

**The determinism digest** frozen in the reference model's tests (`d534e0dc…`, 1,067 entries, covering save, load, branching, outstanding batches, beliefs, summaries and group decisions) is the cross-implementation check that the native core must reproduce.

## 20. Version 4 additions

v4 adds what the seeding layer and sifting need. None of the additions changes a result the reference model produces today: the determinism digest stays valid. Each is marked "v4" where it appears.

| # | Addition | Section | Needed by | Reference model |
|---|---|---|---|---|
| V4-1 | Derives receive the query time `t` | §2.1 | S1 urgency and deadlines ([DS-66](../design-seeds.md)) | To implement; existing derives ignore `t` |
| V4-2 | `core:game-fact`, `core:seed-fact`, `core:seed`, the `core:cast` edge, and event kinds `offer`, `response`, `seed-outcome` | §2.6 | S2 §0.4 | To implement (schema only) |
| V4-3 | Optional `outcome` and `served` on events | §9.2 | Sifting ([dossier 6](../craft/d06-sifting-tellability.md) G-3) | To implement (schema only) |
| V4-4 | A `frame` change on frame status changes, with its bindings | §10.5 | Sifting (G-2); closure and reversals | To implement. It adds changes, so relevance can grow; the digest's fixtures produce no status changes, so it is unaffected |
| V4-5 | Relevance on seed frames reaches layer 2 | §10.5 | S2 §4 | To implement (delivery only) |
| V4-6 | Dilemma recipients stated | §10.8 | S2 §9, S3 (G-5) | A clarification |
| V4-7 | Any layer may keep `SeedRecord`s under its own ids | §14.1 | S2 §12, S3's promoted matches (G-8) | Already true |
| V4-8 | Invariant I-16, session independence | §15 | Reload stability ([dossier 11](../craft/d11-saves-memory-forgetting.md) S11-S0-01) | Fixture F-16 to add |
| V4-9 | Belief fields `uses`, `salience`, `widened` | §11.1 | Memory (S11-S0-03) | Optional fields, default 0 |
| V4-10 | The `Widen` registry signature | §2.1 | Blurring (S11-S0-05) | To implement |
| V4-11 | Lazy accessibility, `onRecall` and the forgetting sweep with its floor | §11.2 | S11-S0-04, 09, 10 | To implement; the sweep is a defined worklist |
| V4-12 | The `SettingsSet` op | §14.2 | Settings as lenses (S11-S0-06) | To implement |
| V4-13 | Fixtures F-16 to F-20 | §16.1 | S11-S0-11 | To add |
| V4-14 | Arithmetic scope covers process decisions; `ln` is the only transcendental | §1.3 | Simulated events ([dossier 14](../craft/d14-city-events.md) S14-S0-01) | A clarification |
| V4-15 | Summary clarifications: single-place scope, no empty summaries, re-minting, item ids | §9.3 | S14-S0-02 | A clarification; already true |
| V4-16 | `cityScale` and `classExclusions` in `SettingsSet` | §14.2 | S14-S0-03 | To implement with V4-12 |
| V4-17 | Fixtures F-21 and F-22 | §16.1 | S14-S0-04 | To add with S1's first process |
| V4-18 | Implicit edge types | §2.5 | Casting through unopened ties ([dossier 15](../craft/d15-people-networks-order.md) S15-S0-01) | Deferred (§0.2) |
| V4-19 | The `aggregate` hook's contract | §11.2 | Reputation (S15-S0-02) | A clarification |
| V4-20 | Fixtures F-23 to F-25 | §16.1 | S15-S0-03 | F-23 with V4-18; F-24 and F-25 with S1's reputation and norm policies |
| V4-21 | `SettingsSet.content` typed and marked sensitive | §14.2 | Content ceilings ([dossier 18](../craft/d18-content-boundaries.md) S18-S0-01; S2 §2.19) | With V4-12 |
| V4-22 | `age-class` on `core:person`; missing counts as minor in floor checks | §2.6 | The minors floor (S18-S0-02) | To implement (schema and derive) |
| V4-23 | Lines refuse events before minting | §9.2 | Lines (S18-S0-03) | To implement with S1's first process |
| V4-24 | `coarseFine` on process registrations | §9.4 | Simulation validation ([dossier 23](../craft/d23-evaluation-testing.md) S23-S0-07) | Optional; ignored by resolution |
| V4-25 | The property, soak and docking test plan | §16.3 | S23-S0-01 to S23-S0-17 | With the next reference-model version |
| V4-26 | Staged batches: stage, commit, discard | §14.2a | S2 §8.4: a failed release leaves nothing in effect (Astra's second S2 review, C-02) | To implement |
| V4-27 | Relevance and dilemmas routed to layer 2 for every actor it registers | §10.5, §10.8 | S2 §1.3 sowing watchers (C-12) | Delivery only |
| V4-28 | The production gate applies to new occurrences and their dependents; observed history is kept | §9.2 | C-08 | To implement with S1's first process |
| V4-29 | Recall once per (belief, encounter) | §11.2 | C-20 | With V4-11, deferred |
| V4-30 | The memory machinery (V4-9 to V4-11) and implicit edges (V4-18) are deferred from the first version | §0.2 | Astra's core set | Deferred |
| V4-31 | Pattern frames: many interests per frame, emissions carry the change, frames come and go with packs | §10.5 | S3's sifter | A clarification |
| V4-32 | The event-kind registry; kinds matched through the `kind` slot | §9.2, §10.5 | S3's sifter (Astra's S3 review, D-16) | A clarification and a small registry |
| V4-33 | Occurrence id and game time on delivered emissions and dilemmas | §10.5, §10.8 | D-16 | Delivery only |
| V4-34 | `tempo` in `SettingsSet` | §14.2 | D-16 | With V4-12 |
| V4-35 | A process reads and replaces its own state, with its batch | §9.4 | S1 processes ([P3](../p3-simulation-layer.md) §16, K-1) | To implement |
| V4-36 | A process reads other processes' published digests | §9.4 | K-2 | To implement |
| V4-37 | `demanded(tier)` for fine-tier processes | §9.4, §10.6 | K-3 | To implement |
| V4-38 | The process operation set: frames, decide, order, observe, tell, belief set | §9.4 | K-4 | To implement |
| V4-39 | A summary whose scope has no place strictly under it gives its items the scope itself as their place | §9.3 | [S1](simulation.md) §16.1 K-1 | A clarification |
| V4-40 | A `Derive` input that resolves `unavailable` reaches the derive as `undefined`; other statuses propagate | §5.1 | K-2 | A clarification |
| V4-41 | **A process draw is keyed by the window being computed**: `rand("proc", worldSeed, processId, w, …)`, not by the run's start, so a draw is independent of where a run starts | §9.4 | K-3 | To implement; the reference model's `ctx.rand` changes |
| V4-42 | Process digests are readable by registered reads and hooks, as of the last applied boundary | §9.4 | K-4 | A clarification |
| V4-43 | The process operation shapes, and `contributionId(spec)` as a pure function | §9.4 | K-5 | With V4-38 |
| V4-44 | `matchStrength(actor, change, types?)`: the greatest relevance the kernel's matching gives a change against an actor's eligible frames, as a read | §10.5 | K-6 | A small read |
| V4-45 | An event may be minted with a `time` earlier than the boundary at which it is applied | §9.2 | K-7 | A clarification |
| V4-46 | A layer's `SeedRecord` with no `actor` retains only its own `nodes` | §14.1 | K-8 | A clarification |
| V4-47 | `publish-item`: a process operation that publishes a summary item once, as one `event` change. Later regeneration of the item stays silent (I-13) | §9.3, §9.4 | [S1](simulation.md) v0.2 §16.1 N-1 | To implement with V4-38 |
| V4-48 | Restating a contribution identical to one already in effect is a silent no-op: no new id, no change, no revision | §4.1 | N-2 | A clarification |
| V4-49 | A process's last published digest is persisted with its `ProcessState`, so digest reads are identical after a load | §9.4, §14.1 | N-3 | A clarification |

**Dossier 11's other kernel requirements:**
- **S1 policies:**
  - how telling transforms a story (S11-S0-07);
  - coalescing many similar beliefs, and the cap per believer (S11-S0-09, the part beyond the floor);
  - the memory policy list (S11-S0-12).
- **S6 and P7:** the commit window on saving (S11-S0-08).
- **S2:** the load class, as a session input (S11-S0-02).

**Recorded compromise:** accessibility's closed form assumes evenly spaced use. Storing each use's time would be more exact. Revisit when recall feels wrong in the transcript panels (dossier 11's testing agenda).

**Dossier 6's other gaps take routes that leave the kernel unchanged:**
- **G-1:** S1's telling and lying policies mint events.
- **G-4:** new event kinds come from packs.
- **G-6:** the sifter's pool copies the descriptors it needs.
- **G-7:** S1 mints events where a root's focus reaches the fine tiers.

These follow the dossier's recommendations, and are recorded in [§7.4 of dossier 6](../craft/d06-sifting-tellability.md#74-gaps-with-a-route-that-leaves-s0-unchanged).
