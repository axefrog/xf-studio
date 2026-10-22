# S0. Kernel specification

**Status:** v2, 22 October 2026. This is the specification stage of the [foundation](../foundation.md): exactly how the dimensional model works, so the reference model can be built from this page alone. It is work package [WP-05](../plan.md#82-work-packages).

v2 takes in two independent review rounds. The [review record](#18-review-record) lists what changed and why. What the first implementation includes is settled in [§0.2](#02-the-first-implementation). One more review round is allowed ([D-17](../decisions.md)).

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
| Processes with different base periods | One shared simulation window. Processes run every n-th window (§9.4) |

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

`toUnit(h) = (bits₅₃(h) + 0.5) / 2^53`, where `bits₅₃` is the first 53 bits as an unsigned integer. The result is in the open interval (0, 1), so `ln` never sees 0 or 1.

### 1.3 Arithmetic

Determinism across implementations (I-1) needs identical arithmetic:
- **Allowed operations.** All weight and score arithmetic is IEEE 754 binary64, round-to-nearest-even, using `+ − × ÷`, `sqrt`, comparisons, and reading or writing a binary64's bit pattern (needed for argument reduction).
- **`ln`** is fdlibm's `e_log.c` ([netlib](https://netlib.org/fdlibm/e_log.c)), ported literally: the same constants and the same operation order. Platform `Math.log` and `f64::ln` MUST NOT be used for kernel decisions. The kernel needs no `exp`.
- **Falloff kernels are polynomials** (§4.3).
- **Sums run in canonical order:** contributions by `Id` ascending.
- **Each weight factor is normalised** over the feasible set before its `ln` is taken: divided by its maximum over `F`, so its maximum becomes exactly 1. Scaling a factor uniformly is therefore exactly invisible (I-7).
- **Outcome comparisons are exact.** Ties are broken as each rule states.

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
- **`vec` and `text`** are never drawn by the generic sampler. They are derived, mirrored, or set by pins.
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
type Derive      = (inputs: Value[], params) => Value;
type Preimage    = (output: Region, otherInputs: Value[], params) => Region;     // unary views only (§6.4)
type Conditioned = (inputs: Value[], F: Value[], params) => number[];           // positive weights over F
type FieldMap    = (fieldValue: number, F: Value[], params) => number[];        // positive weights over F
type Buckets     = (value: Value, params) => string[];
type Bound       = (inputBounds: Region[], params) => Region;                   // conservative, for queries
```

Every `Derive` used by a queried slot MUST provide a `Bound`. Function versions are part of the compatibility record (§14.4).

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
  mode: 'sampled' | 'derived' | 'mirrored';
  derive?: { fn: FnRef; inputs: SlotPath[]; preimage?: FnRef };  // preimage only for one input
  conditioned?: { fn: FnRef; inputs: SlotPath[] };
  temporal?: { window: number };       // simulated temporal slots only (§6.3)
  tier: Tier;                          // scheduling band (§10.6)
}

type Tier = 0 | 1 | 2 | 3 | 4 | 5;     // city, district, block, scene, individual, fine detail
```

`mirrored` slots are read from the game for mirrored nodes. The same slot on a generated or minted node is `sampled`, or `derived` if it has a `derive`.

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
  symmetric?: boolean;
}
```

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
                        position (vec 3; mirrored for mirrored people, otherwise pinned by simulation), place (ref core:place)
core:group       facets: actor, group   slots: name (node core:name), drives (many node core:drive-state)
core:place       facets: place          slots: position (vec 3), district (ref core:place), public (enum)
core:event       facets: event          (§9.2)
core:summary     facets: summary        (§9.3)
core:member-of   attrs: role (enum), strength (real), visibility (enum open|secret|deniable),
                        terms (enum standing|contract), until (int; contract only), exit-cost (real)
                 data:  obligations (list of interest selectors); perceivable: true
core:kin         attrs: relation (enum)
core:located-in, core:knows
```

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
3. **Every other slot** goes through arbitration (§5.2), weights (§5.3) and the draw (§5.4).

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
- scaling any factor uniformly changes nothing (I-7).

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

A pin is a hard constraint at its precedence, in effect over `valid`. It is history. It is removed only by its source's withdrawal or the loss of its save branch (§6.6).

### 6.2 Enduring slots

A slot without `temporal`, and not mirrored, has one value for the node's life. A pin on it is valid from `at`, with no end.

### 6.3 Time-varying slots

There are two kinds of time-varying slot.

**Mirrored slots are timelines of readings.** Each game reading of a mirrored slot (on a mirrored node) is a pin with reason `game`, valid from the reading's time until the next reading of that slot, with no fixed windows. Resolution at `t` uses the reading in effect at `t` (§5.1, step 2).

V's observation of a mirrored value is an `observed` pin over the same interval as the reading it saw. So "V saw rain at 1,000" and "V saw clear skies at 2,000" are two consecutive intervals, not a conflict.

**Simulated temporal slots** (with `temporal: { window }`) hold one value per window `k`. Use them for quantities the simulation treats as piecewise constant, such as urgency or mood. Their pins cover the windows they name.

### 6.4 Derived views and backward narrowing

**A pin on a derived slot with one input `s`,** whose `derive` declares a `preimage`, adds a constraint on `s`. The constraint is `preimage(pinRegion)`, at the pin's precedence. Preimages chain through views of views. Every domain is finite, so this terminates.

**A pin on a derived slot with several inputs** is checked, not propagated. Its inputs are resolved normally. If the result violates the pin, the status is `contradiction` (§5.1). Observations SHOULD pin base slots or unary views. For example, the perception layer reports a name as `given` and `family`, not as `display`.

Joint inverses are deferred ([C-05](#17-compromises-and-open-items)).

### 6.5 Structural constraints

Some constraints hold whatever any source says, so they take precedence 700:
- **Retained members stay in their collection.** If member `i` of a `many` slot is retained (§7.3) for any reason, the count gets `count ≥ i + 1`. A smaller count from any source is rejected.
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

**The roots:**
- every persisted record (§14.1) and every `Id` field it holds: pins, edges, contributions, beliefs (subject, evidence, sources), canon events, summaries, seed states, frames, process states;
- the nodes in the focus of active or blocked frames;
- the mirrored nodes the game currently has streamed in.

**Marking** follows every root's `Id` fields, origin chains (to owners and creators), and owned-value links in both directions.

**Sweeping** discards unmarked nodes' in-memory state. A swept node regenerates identically while its constraints and contributions are unchanged (I-3). Retained nodes' headers are persisted, so they stay addressable.

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

The first implementation MAY return `maybe` for every compound region. Tight bounds and spatial pruning are deferred (§0.2).

### 8.3 Traversal

A query runs atomically, within the hard limits of §10.7, against one revision.

1. **The frontier** starts with the scope's roots. Entries are compound regions or candidates (nodes of kind `find`).
2. **Order.** Pop the entry with the highest upper bound on preference score. Ties go to the lower `Id` or cell key.
3. **Prune** an entry with any `must` verdict `no`.
4. **Descend** every compound region that isn't pruned.
5. **Check** every candidate that isn't pruned exactly: resolve it and evaluate each `must`. Score passing candidates by the sum of the `prefer` weights that hold.
6. **Deduplicate** by `Id`.
7. **Stop.**
   - With `limit = n`: when `n` candidates are confirmed and no frontier entry's upper bound exceeds the `n`-th score. Score ties go to the lower `Id`.
   - With `'all'`: when the frontier is empty.
8. **Limits.** Hitting a hard limit returns `failed`, never a partial result presented as complete.

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

An event becomes **canon** when:
- V observes it, which pins the observed fields `observed`;
- a seed commits it, which pins the committed fields `committed`;
- a persisted effect depends on it, which pins the fields the effect needs `committed`.

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
| `materialised` | A set of indices, kept as data on the summary's persisted record |
| `canon` | A set of indices, likewise |

**Item `i`,** for `0 ≤ i < count`:
- is minted with `creator = cause = S.id` and `name = "item:<i>"`;
- its `time` is `from + floor(rand("item-t", S.id, i) × length)`;
- its `place` is drawn among the places under `scope`, with the candidates found as for a ref (§2.4) and the key `("item-p", S.id, i)`;
- its other slots resolve normally.

**Querying.** A query over a time or place region materialises exactly the items whose time and place fall inside it. Overlapping queries see the same items and nothing is counted twice.

**Revisions.** A process may revise `count`, subject to the structural constraint (§6.5).

### 9.4 Evolution

Simulation processes are S1's. The kernel defines when they run and what they may read.

- **One shared window.** All processes share a base simulation window, `W_sim` **[tunable 600 s]**. A process runs every `n`-th window, `n ≥ 1`, aligned so it runs when `k mod n = 0`. `run(ctx, k)` computes its outputs for windows `k` to `k + n − 1`. Its randomness is keyed `("proc", worldSeed, processId, k, …)`.
- **Order at each boundary** `t = k × W_sim`:
  1. Apply the outputs of every process run whose span ends at `t`, by tier (coarse first), then by `id`.
  2. Apply the external operations stamped in the window that just ended, by timestamp, then `Id`. These are game readings, observations and seed operations.
  3. Take the snapshot that processes starting at `t` read.

  Processes never see each other's outputs within a span (double buffering).
- **Partition independence (I-15).** Given the same timestamped external operations and the same demand history, a process's history doesn't depend on how ticks fell.
- **Catch-up.** After an absence, tiers 0–2 run every missed boundary in order, each within the hard limits.
- **Fine tiers (3–5)** run only where demand reaches them (§10.6). They never catch up: when V arrives, their state is generated from the coarse state, consistent with the pins.

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
  | { c: 'reading'; node: Id; slot: SlotPath; old?: Value; new: Value };   // a game reading that changed a value
```

Cache fills, regeneration and save replay produce no changes.

**Matching.** An interest selector `σ` matches change `x` when all of the following hold:
1. **Kind:** `σ.kind`, if set, is the kind (or an ancestor kind) of one of `x`'s subjects. A change's subjects are:
   - for a pin or reading: its node;
   - for an edge: both endpoints;
   - for an event: the event node, every participant's `who` and every effect's `on`;
   - for a minted node: the node itself;
   - for a contribution: every node its target selector can match. The reference model treats a contribution as matching an interest whose kind and scope overlap the target's, which may over-match.
2. **Scope:** `σ.scope`, if set, contains one of the subjects.
3. **Where:** `σ.where` holds for that subject, evaluated on new values. For ended edges and removals, it is evaluated on old values.

**The first implementation scans every registered interest.** A routing index is deferred (§0.2).

**Specificity `s(σ, x)`** **[calibrate]**:
- 1.0 when the matched subject was named by `σ.scope.nodes`, or is an edge endpoint or participant matched by `Id`;
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
  3. Emissions go to S1 and S3, in order of actor (demand roots first), then frame `Id`.

### 10.6 Demand and tiers

A node's demand tier is the highest `focus.tier` among active or blocked frames focusing on it or its owner chain. A frame's claim weighs `pull × w_actor`, where `w_actor` is **[tunable 4.0]** for demand roots and 1 otherwise. Slots normally open when the node's demand tier reaches the slot's `tier`. Queries, seeds and preimages may open finer slots.

Tiers are scheduling bands, not an ontology or a depth limit.

### 10.7 Work: hard limits and worklists

**Atomic operations are bounded by hard limits** **[tunable]**. Hitting a limit returns `failed` for that operation and records a defect for inspection:

| Atomic operation | Hard limits |
|---|---|
| A resolution | `N_enum` values; 256 applicable contributions; 64 points per field; dependency depth 32 |
| A query | 50,000 frontier steps; 5,000 exact checks |

**Worklists are resumable and budgeted.** Each worklist runs in a fixed order, and stops and resumes deterministically:
- relevance dispatch;
- frame recomputation;
- forgetting;
- summary materialisation;
- process catch-up.

The per-tick work budget is **[tunable; P7 measures it]**. It is counted in atomic operations and dispatched matches. Work for demand roots, and for the player's own actions, is taken first.

### 10.8 Effects and cross-pressure

**Effects** form a small vocabulary: `harm`, `kill`, `help`, `protect`, `rescue`, `take`, `give`, `expose`, `conceal`, `move`, `meet`.

**The conflict table** is a registry function [S1]. It maps (interest type, effect) to `violates` or `ok`. Its first version is:

| Interest | Violated by |
|---|---|
| `protects X` | `harm`, `kill`, `take` or `expose` on X |
| `wants Y` | `conceal` or `take` on Y, or the effect opposite the wanted one |

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
  - `aggregate(audience, subject, path)`.

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
- **Summaries,** with their `materialised` and `canon` sets.
- **Frames** of demand roots and live seeds.
- **States:** seed states (S2), and process cursors and states (S1).
- **Lineage:** the world seed, plus schema and function versions (§14.4).

**Not persisted:**
- caches and unretained nodes;
- conflicts, which `trace` derives;
- relevance events;
- the current game state.

### 14.2 Records and branching

Each save has a record `{ saveKey, parent, ops }`, where `parent` is the record of the save it was made from. `ops` is an append-only log of these operations:
- `HeaderAdded`;
- `PinAdded`, `PinWithdrawn`;
- `EdgeAdded`, `EdgeEnded`;
- `ContributionAdded`, `ContributionEnded`;
- `BeliefSet`, `BeliefDropped`;
- `EventCanon`;
- `SummarySet`;
- `FrameState`, `SeedState`, `ProcessState`.

Snapshots are written every **[tunable 10,000]** ops. Ops carry complete data.

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
| I-7 | **Coupled draws.** Changing one value's weight changes a result only if that value was or becomes the winner. Scaling a factor uniformly changes nothing |
| I-8 | **The trace is complete** |
| I-9 | **One active belief** per (believer, subject, path, at) |
| I-10 | **Bounded work.** Atomic operations stay within hard limits or return `failed`. Worklists stay within the tick budget and resume deterministically |
| I-11 | **Stable identity.** Moving a node never changes its `Id` or pins |
| I-12 | **V is never owned.** Nothing pins or sets V's drives. V's choices enter only as observed events |
| I-13 | **Silence.** Resolution, regeneration and replay produce no changes and no relevance |
| I-14 | **Acyclic frames** |
| I-15 | **Partition independence,** given the same timestamped external operations and the same demand history |

## 16. Fixtures

### 16.1 Acceptance fixtures

Fully specified: outcomes that depend on hashes are checked as properties, not numbers. Every fixture uses `worldSeed = H("fixture", <fixture id>)` and `W_sim = 600`.

| # | Setup | Expected |
|---|---|---|
| F-1 | **Arbitration.** Enum {a, b, c, d}. Observation pin {a, b} (600); authored set {b, c} (400); seeding set {c} (300); simulation set {a, b, c, d} (200) | Active: 600, 400, 200; rejected: 300. `F` is {b}; value b; `ok` |
| F-2 | **Contradiction.** F-1, plus a second observation pin {c} with a higher `Id` | The second observation is rejected; `F` is {b}; value b; `contradiction` |
| F-3 | **Timeline.** Weather is mirrored. Readings: rain at 1,000, clear at 2,000. V observes each reading | Resolving at 1,500 gives rain; at 2,500, clear. Two observed pins with consecutive intervals; no contradiction |
| F-4 | **Unary view.** `age` 16..90; `age-band` derived as `floor(age / 10)` with its preimage. Observation pins `age-band = 3` | `F_age` is 30..39 and `age` lies in it. A later authored pin `age = 45` (400) is rejected |
| F-5 | **Coupling.** 1,000 nodes, each with an enum slot of 100 values and equal priors. Resolve; multiply value `a`'s factor by 4; resolve again | For every node, the result changed exactly when `a`'s new perturbed score exceeds the previous winner's, which is checked from the trace. Every other node is unchanged. Multiplying every value's factor by 3 changes nothing |
| F-6 | **Query.** A tree: 1 district, 4 blocks, 16 places, all compound regions bounded `maybe`. Five places satisfy `influence ≥ 0.6` and `police ≤ 0.2` | `'all'` returns exactly those 5, with no duplicates |
| F-7 | **Summary.** Five robberies over one day, scope = a district with two blocks. Query block 1, then the whole district; make item 2 canon; then the process withdraws its count pin and pins `count = 2` | Block 1's items are a subset of the district's, with the same `Id`s. The pin `count = 2` is rejected by the structural constraint (≥ 3), and the count resolves to a value ≥ 3 |
| F-8 | **Cross-pressure.** M is a member of G. M's family frame `protects X`. G's goal A has effects [{kill, X}]; G's goal B has [{rescue, X}] | A gives one `Dilemma`; B gives none |
| F-9 | **Hearsay.** Alice observes E (belief with evidence {E}), tells Carl, Carl tells Dana; then Alice tells Dana | Dana's belief has `evidence = {E}`. The second telling only refreshes it |
| F-10 | **Secret affiliation.** `core:member-of` is perceivable. Bob's Militech membership is `secret`; Alice witnesses Bob | `knows(Alice, Bob, member-of)` is `unknown`. With the same edge type and `visibility: open`, it returns the membership |
| F-11 | **Leadership.** L leads G and is a member of G | No frame cycle. G's concerns change only through decision operations attributed to L |
| F-12 | **Branching.** Save A; pin p1; save B; load A; pin p2; save C; load B | B has p1 and not p2. An operation queued under C's epoch is refused. Replay emits nothing |
| F-13 | **Partition.** Process "tally": every window it pins `counter@w<k> = counter@w<k−1> + floor(rand("proc", seed, "tally", k) × 10)`. Run 12 windows as one tick, and again as 12 ticks | Identical counter histories |
| F-14 | **Retained member.** A crowd count of 12; member 9 is focused by V's frame (no pin). An authored constraint sets the count to 6 | The count is 10 or more (the structural constraint, 700, rejects 6), and member 9 stays addressable |
| F-15 | **Cycle guard.** A kind whose slot reads itself through an invalid schema the loader missed (tested by bypassing the loader) | Resolution returns `cycle` and records a defect |

### 16.2 Calibration fixtures

These fix the **[calibrate]** values. Every frame weight is stated, and every expectation is an inequality on `r` with `θ_react`.

| # | Frames | Change | Expected |
|---|---|---|---|
| C-a | A pedestrian: drive frame `comfort`, weight 0.5; situation frame, weight 1, with `reactsTo: { where: weather in {rain} }` (a bucket match) | Weather reading changes to rain | `r ≥ θ_react` |
| C-b | A vendor: drive frame `money`, weight 0.8; concern frame `protection-payment`, weight 0.9, with `threatenedBy: kind core:person, where member-of Tyger Claws, role collector, scope: { nodes: [the stall] }` | (1) A collector event at the stall. (2) A Tyger Claw member event elsewhere in the district | (1) `r ≥ θ_react`; (2) no match |
| C-c | The vendor's work frame, weight 0.6, `wants: kind core:person, role customer` | A customer arrives | `θ_react ≤ r <` the r of C-b(1) |
| C-d | V: a frame `protects [friend]`, weight 1 | An event with effect `harm` on the friend | `r` is the greatest of C-a to C-d |

The chosen values of `m`, `s` and `θ_react` are recorded with the fixtures.

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
