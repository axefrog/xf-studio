# S0. Kernel specification

**Status:** v1, 22 October 2026. This is the specification stage of the [foundation](../foundation.md): it states exactly how the dimensional model works, so the reference model can be built from this page alone. It is work package [WP-05](../plan.md#82-work-packages). v1 takes in an independent review; the [review record](#18-review-record) lists what changed and why.

**Normative words:**
- **MUST** and **MUST NOT** are requirements.
- **SHOULD** is a strong default that needs a recorded reason to break.
- **MAY** is optional.

A value marked **[tunable]** is a configurable default. A value marked **[calibrate]** is set by the calibration fixtures (§16) before the reference model is accepted.

**Type definitions** are written in TypeScript notation. Field names and meanings are normative. Physical layout is free, provided the fixtures and invariants pass.

Departures from the foundation are listed in §17 and in the foundation's [compromise ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger).

## 0. Scope and proportion

**The kernel holds the mechanism:**
- identity and arithmetic;
- the schema;
- nodes, edges and resolution;
- constraints and contributions;
- pins and time;
- queries;
- events, summaries and evolution windows;
- context frames and interest routing;
- belief records;
- membership edges;
- provenance;
- the logical persistence record.

**Behavioural policies are not kernel semantics.** Those are drive urgency models, attribution coefficients, rumour telling and distortion, reputation aggregation, and group decision-making. They belong to the simulation layer (S1), which plugs into hooks defined here.

**Proportion.** This is a game mod. The kernel guards against what players would notice: contradictory story state, lost or corrupted saves, stalls, and a game left broken. It does not defend against hostile input.

**Specified elsewhere:**

| Topic | Specification |
|---|---|
| Simulation processes and policies | S1 |
| The seed language | S2 |
| Sowing, fitting and the director | S3 |
| Content packs and settings | S4 |
| The game port and companion protocol | S5 |
| Persistence bytes and save keys | S6 |

## 1. Identity, arithmetic and randomness

### 1.1 Identifiers

An `Id` is 128 bits, written as 32 lowercase hexadecimal characters. Nodes, edges, contributions, pins, beliefs, events and frames all have one. An `Id` MUST NOT change once assigned.

| Origin | Formula | Used for |
|---|---|---|
| Root | `H("root", worldSeed, name)` | `city`, `director`, `v` |
| Owned value | `H("val", ownerId, slotPath)` | The node a `node`-typed slot holds (§2.1): a person's name, a drive state |
| Generated member | `H("gen", ownerId, slotKey, index)` | Member `index` of a `many` slot |
| Minted | `H("mint", creatorId, causeId, localName)` | Nodes created by events, seeds, processes or summary refinement |
| Mirrored | `H("game", gameKey)` | Things the game owns; S5 defines `gameKey` |

Moving a node changes its edges, never its `Id` (I-11).

### 1.2 Hashing

`H` is the first 128 bits of BLAKE3 over the canonical encoding of its arguments. Each argument is encoded as a one-byte tag followed by its bytes:

| Tag | Type | Encoding |
|---|---|---|
| `0x01` | UTF-8 string | u32 little-endian byte length, then the bytes |
| `0x02` | i64 | Little-endian |
| `0x03` | `Id` | 16 raw bytes |
| `0x04` | binary64 | Little-endian. Negative zero becomes positive zero; NaN is forbidden |
| `0x05` | bool | One byte |
| `0x06` | `Value` | The value's canonical encoding (§2.1), then a 0x00 terminator |

`toUnit(h)` takes the first 53 bits of `h` as an unsigned integer and divides by 2^53, giving a number in [0, 1).

### 1.3 Arithmetic

Cross-implementation determinism (I-1) needs identical arithmetic, not only identical hashes:
- **Allowed operations.** All weight and score arithmetic is IEEE 754 binary64 with round-to-nearest-even, using only `+ − × ÷` and `sqrt`.
- **`ln` and `exp`** are the fdlibm algorithms (`e_log.c`, `e_exp.c`), ported to use only those operations. Platform `Math.log` and `f64::ln` MUST NOT be used for kernel decisions.
- **Field falloff kernels are polynomials** (§4.3), so they need no transcendental functions.
- **Sums run in canonical order:** contributions sorted by `Id` ascending.
- **Comparisons** that decide outcomes are exact. Ties are broken by `Id`, or by value hash, as each rule states.

### 1.4 Random streams

All randomness comes from hashing a key, never from a stateful generator:
- `rand(key…) = toUnit(H("rng", key…))`;
- a stream is `rand(key…, i)` for `i = 0, 1, 2, …`.

Every draw in this specification names its key.

### 1.5 The world seed

Each save lineage has a 128-bit `worldSeed`. It is chosen from a cryptographic random source when the engine first meets a playthrough, and stored in the lineage's root record (S6). Every save descended from that playthrough shares it.

## 2. Schema

The schema is data. Engine releases ship the core schema, and content packs MAY add to it (S4). Ids are namespaced: `<namespace>:<name>`.

### 2.1 Dimensions and values

```ts
interface DimensionDef {
  id: DimId;
  value: ValueType;
  structure: 'none' | 'order' | 'metric' | 'cyclic' | 'graph';
  prior: FnRef;            // base weights when nothing contributes (§5.3)
  sampler?: FnRef;         // required when the domain is larger than N_enum (§5.4)
  buckets?: FnRef;         // value → coarse interest keys (§10.5)
}

type ValueType =
  | { t: 'enum'; values: string[] }                        // at most N_enum values, or a sampler
  | { t: 'int'; min: number; max: number }
  | { t: 'real'; min: number; max: number; quantum: number } // values on the quantum grid
  | { t: 'cyclic'; period: number; quantum: number }
  | { t: 'ref'; kind: KindId; candidates: Selector; max: number }  // selects an existing node (§2.4)
  | { t: 'node'; kind: KindId };                           // holds an owned value node (§2.4)
```

**Canonical value encoding:**
- enum: its index as i64;
- int: i64;
- real or cyclic: the quantum-grid index as i64;
- ref: the `Id`;
- node: the owned node's `Id`.

**`N_enum`** is the largest domain that may be enumerated per draw: **[tunable 4096]**.

**`FnRef`** is `{ name: string; version: number; params?: Value[] }`. It names a pure function in the engine's function registry: a prior, a sampler, a derivation, a falloff map, a bucket map, an effect table. Content packs reference registry functions with parameters and MUST NOT supply code. Function versions are part of the persisted compatibility record (§14.4).

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
  card: 'one' | { many: { count: DimId } };    // the count is itself a slot: '<key>#count'
  mode: 'sampled' | 'derived' | 'mirrored';
  derive?: { fn: FnRef; inputs: SlotPath[] };  // required when mode is 'derived'
  conditioned?: { fn: FnRef; inputs: SlotPath[] };  // optional prior given earlier slots
  temporal?: { window: number };       // absent = enduring; present = varies by time window (§6.3)
  perceivable?: boolean;               // observers may know it on sight (§11.4) [default false]
  tier: Tier;                          // scheduling band at which it normally opens (§10.6)
}

type Tier = 0 | 1 | 2 | 3 | 4 | 5;     // city, district, block, scene, individual, fine detail
```

**`mirrored` slots** are owned by the game for mirrored nodes. They are read through the game port, never sampled. On generated or minted nodes, the same slot is `sampled`.

### 2.3 Dependencies are acyclic

A slot's `derive.inputs`, `conditioned.inputs` and the `when` predicates of rule contributions targeting it (§4.3) may reference only:
- slots declared **earlier** in the same kind, after inheritance;
- slots of the node's **owner chain** (the nodes it is an owned value or generated member of);
- slots of nodes reached through `ref` slots declared earlier.

Schema loading MUST reject a kind that breaks this rule. Resolution therefore always terminates (A-03).

Backward reasoning, a later fact constraining an earlier one, is limited to derived views (§6.4) and to the count rule (§6.5). Everything else uses generate-then-justify ([C-01](../foundation.md#9-the-reference-model-and-the-compromise-ledger), and [C-05](#17-compromises-and-open-items) here).

### 2.4 Owned values and references

A **`node`** slot holds an **owned value node** whose `Id` is `H("val", ownerId, slotPath)`. This is "no atoms" made concrete: a name, a drive state, a set of membership terms are each a small node with slots of their own.
- An owned value node exists, and can be opened, whenever its owner exists.
- It is never shared.
- It is retained exactly when its owner is.

A **`ref`** slot **selects** an existing node. The candidates are those matching `candidates`, bounded by `max`, and are found by a query (§8) in the owner's scope. Selection is a sampling over that bounded candidate set (§5). A ref never creates a node. Creating one is minting (§1.1) or a `many` slot (§2.2).

### 2.5 Edge types

```ts
interface EdgeTypeDef {
  id: EdgeTypeId;                      // core:located-in, core:member-of, core:kin, …
  from: KindId[]; to: KindId[];
  attrs: Record<string, DimId>;
  perceivable?: boolean;               // e.g. an open membership worn on a uniform
  symmetric?: boolean;
}
```

### 2.6 The minimal core schema

The reference model ships at least these kinds, which the fixtures use:

```
core:name     slots: origin (enum), given (enum, sampler by origin), family (enum, sampler by origin),
                     display (derived from given, family)
core:drive-state  slots: drive (enum of DriveIds), importance (real 0..1, q 1/64), urgency (real 0..1, q 1/64, temporal)
core:trait    slots: trait (enum), strength (real 0..1, q 1/64)
core:terms    slots: type (enum standing | contract), until (int game time; contract only)
core:person   facets: actor
              slots: name (node core:name), age (int 16..90), age-band (derived from age),
                     traits (many: node core:trait), drives (many: node core:drive-state),
                     position (vec 3, temporal, perceivable)
core:group    facets: actor, group   slots: name (node core:name), drives (many: node core:drive-state)
core:place    facets: place          slots: position (vec 3), district (ref core:district), public (enum)
core:event    facets: event          (§9.2)
core:summary  facets: summary        (§9.3)
edges: core:member-of (attrs role, strength, visibility, terms, exit-cost), core:kin (attrs relation),
       core:located-in, core:knows
```

## 3. Nodes, slots and edges

### 3.1 Nodes and headers

```ts
interface NodeHeader {                 // persisted for every retained node (§14)
  id: Id; kind: KindId;
  origin:
    | { by: 'root'; name: string }
    | { by: 'value'; owner: Id; slot: SlotPath }
    | { by: 'member'; owner: Id; slot: string; index: number }
    | { by: 'minted'; creator: Id; cause: Id; name: string }
    | { by: 'mirrored'; gameKey: string };
}

interface Node extends NodeHeader {
  slots: Map<SlotKey, SlotState>;      // materialised slots only
  touched: GameTime;
}

type SlotPath = string;                // "key", "key[i]", "key#count"
type SlotKey = string;                 // SlotPath, plus "@w<k>" for temporal slots (window k)

type SlotState =
  | { s: 'open' }
  | { s: 'resolved'; value: Value; status: 'ok' | 'contradiction'; revision: number };
```

### 3.2 Regions

A `Region` is a subset of a dimension's values:
- `enum`: a bitset;
- `int`, `real` and `cyclic`: sorted closed intervals on the grid (cyclic ones wrap);
- `vec`: a list of boxes;
- `ref` and `node`: an explicit `Id` set, or a selector.

Every form supports intersection, emptiness and membership tests.

### 3.3 Edges

```ts
interface Edge {
  id: Id; type: EdgeTypeId; from: Id; to: Id;
  attrs: Record<string, Value>;
  valid: { from: GameTime; to?: GameTime };   // ended edges stay as history
  cause: Id;
}
```

A `ref` slot's value is an edge of the implicit type `slot:<kind>.<key>`.

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
  strength: number;                    // > 0; for 'weight' it multiplies log-factors [default 1]
  valid: { from?: GameTime; to?: GameTime };
}

type Layer = 'observation' | 'game' | 'authored' | 'seeding' | 'simulation' | 'procedural';
```

**Precedence**, used by constraint arbitration (§5.2):

| Layer | Precedence |
|---|---|
| `observation` | 600 |
| `game` | 500 (and authoritative for the current window of mirrored slots, §6.3) |
| `authored` | 400 |
| `seeding` | 300 |
| `simulation` | 200 |
| `procedural` | 100 |

Within a precedence level, the lower `Id` comes first.

### 4.2 Selectors

```ts
interface Selector {
  kind?: KindId;
  slot: SlotPath | '*';
  scope?: { under: Id } | { nodes: Id[] } | { region: SpatialRegion };
  where?: Predicate[];                 // as in §8.1
}
```

A selector MUST be testable on one node, and MUST give a conservative verdict (`no`, `maybe` or `yes`) for an unopened region. Returning `maybe` is always allowed.

### 4.3 Forms

| Form | Yields at a node | Bounds over a region |
|---|---|---|
| `Const(v)` | The set {v}, or a factor of 1 on v and ε on the rest | {v} |
| `Set(region, allow)` | A set | The region |
| `Table(weights)` | Explicit positive factors over enum, int or ref values; absent values get factor 1 | Per-value [min, max] |
| `Field(base, points, map)` | Control points `{ at, value, radius, falloff }` over a base slot (usually `position`). Falloff is a polynomial: `linear`, `smoothstep` or `bump` (`(1 − d²/r²)²`). Points combine by `sum` or `max`, then `map` turns the field value into factors over the target's values | The field's [min, max] over the region's extent, mapped |
| `Rule(when, then)` | `then`'s factor if `when` holds, otherwise nothing | `when` is `yes`: `then`'s bounds. `when` is `maybe`: the union of `then`'s bounds and the no-contribution case. `when` is `no`: nothing |
| `Derive(fn, inputs)` | One value, for `derived` slots | `fn`'s bound function over the inputs' bounds; every derive function MUST provide one |

A factor is either a set, which only `constrain` mode uses, or a strictly positive weight function. ε is **[tunable 2⁻²⁰]**. A weight of zero is not allowed: exclusion is a set.

## 5. Resolution

`resolve(node, slotPath, t)` returns `{ value, status }`, where `t` is the game time asked about. For temporal slots, `t` selects window `k = floor(t / window)`. Every step is deterministic. **Resolution never emits relevance changes (I-13).**

### 5.1 The order of steps

1. **Derived slots** return `derive(inputs)`, after the inputs are resolved, then are checked against any pins on the slot (§6.4).
2. **Mirrored slots** of mirrored nodes, in the current window: the game port's reading is the value. If the read fails, the slot is `open` and resolution returns `unavailable`.
3. **Every other slot** goes through constraint arbitration (§5.2), then the prior and weights (§5.3), then the draw (§5.4).

### 5.2 Constraint arbitration

**Collect the constraints that apply to (node, slot, window):**
- value pins and region pins valid in the window (§6.1);
- `constrain`-mode contributions whose selector matches and which are valid at `t`;
- view filters from pinned derived views (§6.4);
- the count bound (§6.5).

Each constraint carries its precedence. Pins take their reason's layer:

| Pin reason | Precedence |
|---|---|
| `observed` | 600 |
| `game` | 500 |
| `authored` | 400 |
| `committed` | 300 |

**Arbitrate:**
1. Sort the constraints by precedence descending, then by `Id` ascending.
2. Start with `F` = the dimension's domain.
3. For each constraint `c` in order:
   - if `F ∩ c` is non-empty, set `F` to it; `c` is **active**;
   - otherwise `c` is **rejected**: record a `Conflict { node, slot, window, rejected: c, activeSoFar, t }`.
4. If any rejected constraint has precedence 600 (an observation), set `status = 'contradiction'`; otherwise `'ok'`.

The value is drawn from `F`, so it satisfies every active constraint (I-2).

Most "contradictions" are temporal and disappear under §6.3. The rest are perception defects, shown by the inspection tools (P10).

### 5.3 Prior and weights

1. **The prior `P0`.** It is the slot's `conditioned` prior evaluated on its inputs, if defined, otherwise the dimension's `prior`. If `replace-prior` contributions apply, the first in precedence order replaces it.
2. **The score.** For each `v ∈ F`:

   ```
   score(v) = ln P0(v) + Σ_c strength_c · ln f_c(v)
   ```

   The sum runs over the matching `weight` contributions, in `Id` order (§1.3). This is a log-linear combination, or product of experts.

### 5.4 The draw: Gumbel-max with fixed per-value noise

For each `v ∈ F`:

```
g(v)  = −ln(−ln(rand("g", worldSeed, node.id, slotPath, k, v)))   // k = window index, 0 for enduring slots
v*    = argmax over v ∈ F of (score(v) + g(v))
```

Exact ties are broken by the lower `H("tie", worldSeed, node.id, slotPath, k, v)`.

**Why this draw.** It samples exactly from the normalised distribution (the Gumbel-max trick). Because each value's noise is fixed, the outcome changes only when the winner changes. Scaling one value's weight changes the result only if that value was the winner, or becomes the winner. Scaling every value's weight equally changes nothing (I-7). It needs no canonical ordering.

**Domains larger than `N_enum`** MUST use the dimension's `sampler`. A sampler is a registry function that draws hierarchically, each level over at most `N_enum` options and each level by this same rule with its own key suffix. An example is a name list split by first letter.

A sampler that can't produce a value within its bound returns `failed`, and the slot stays `open`. Failure is explicit, never a silent default.

**`ref` slots** draw over the bounded candidate set returned by their candidate query, with each candidate's `Id` as `v`.

### 5.5 Caching

- **What is cached.** A resolved value is stored with the kernel's **revision**: a counter incremented by every write (pin, contribution, edge, event, minted node, belief, frame change, game reading).
- **When it is valid.** A cache entry is valid only at the revision it was computed at.
- **Finer schemes.** The reference model uses only this coarse rule. A faster implementation MAY track finer dependencies (the slots, edges, contributions and function versions each resolution read), provided it never returns a value the coarse rule wouldn't. [miniAdapton](https://arxiv.org/abs/1609.05337) is a model for that.

## 6. Pins, time and propagation

### 6.1 The pin record

```ts
interface Pin {
  id: Id; node: Id; slot: SlotPath;
  value?: Value; region?: Region;      // exactly one
  reason: 'observed' | 'game' | 'authored' | 'committed';
  valid: { from: GameTime; to?: GameTime };   // enduring slots: { from: at } with no end
  at: GameTime;
  cause: Id;
  evidence?: Id;                       // the originating event, for observations
}
```

A pin is a hard constraint at its precedence (§5.2). It is history: it is never deleted except by its source's withdrawal or the loss of its save branch (§6.6).

### 6.2 Enduring slots

An enduring slot (no `temporal`) has one value for the node's whole life, such as a name or a birth year. A pin on it holds from `at` onwards, with no end.

### 6.3 Temporal slots

A temporal slot, such as position, weather, mood or urgency, has one value per **window** `k`, and its pins cover only the windows they were made in:
- **An observation pins the observed window only.** V seeing rain at `t` pins weather's window `floor(t / window)`. It doesn't stop the weather changing later. The observation stays in the record as history.
- **The game is authoritative for the current window** of mirrored temporal slots. Its reading is used directly (§5.1, step 2). A past window's value comes from pins, if any, otherwise it is resolved like any sampled slot.
- **Simulation and seeds** pin temporal slots over explicit intervals.

### 6.4 Derived views and backward narrowing

A derived slot `d` is a **view** of its inputs: `d = derive(inputs)`. A pin on `d` (value or region `R`) adds a **view filter** constraint to each input slot `s` of `d`:

```
F_s ∩= { v : derive(…, v, …) ∈ R, with the other inputs at their resolved or pinned values }
```

The filter takes the precedence of the pin on the view. It is computed by enumerating `F_s`, or through the derive function's bound function when `F_s` is larger than `N_enum`. Filters chain through views of views by recomputing until nothing changes. Views form a DAG over finite grid domains (§2.3), so this terminates.

Example: pinning `age-band = 30s` narrows `age` to 30–39. Pinning `display = "JimBob McGready"` narrows `given` and `family` through `display`'s filter.

### 6.5 Retained members bound their counts

If member `i` of a `many` slot is retained (§7.3), the count slot gets the constraint `count ≥ i + 1` at the precedence of the strongest pin that retains it. A remembered person therefore never falls out of the collection they came from.

### 6.6 Withdrawing pins

A pin is removed only when the source that created it withdraws it, which is a recorded operation: an authored pack is uninstalled, or a seed is withdrawn by its owner. Observations are never withdrawn.

## 7. Open, close, forget

### 7.1 Open

`open(node, slotPath)` materialises `{ s: 'open' }`. For a `many` slot it resolves `<key>#count` first. Members and owned values come into being lazily, when first addressed.

### 7.2 Close

`close(node)` drops the node's `resolved` caches, and those of its unretained owned values and members. Pins, edges and headers stay.

### 7.3 Retention and forgetting

Forgetting is mark and sweep. It runs only between ticks, within the work budget (§10.7).

**The roots:**
- every node carrying a pin, and its origin chain;
- both ends of every edge with a persistent cause (§14.2);
- the nodes referenced by a canon event's pinned fields;
- the nodes in a live seed's bindings (S2);
- the nodes in the focus of an active or blocked frame;
- every mirrored node the game currently has streamed in.

**Marking** follows origin chains (to owners and creators) and owned-value links (to and from owners).

**Sweeping** discards every unmarked node's in-memory state. A swept node regenerates identically when next addressed, while its constraints and contributions are unchanged (I-3). Its retained header (§14.2) keeps it addressable.

## 8. Queries

### 8.1 The query record

```ts
interface Query {
  find: KindId;
  scope: { under: Id } | { nodes: Id[] } | { region: SpatialRegion } | { roots: Id[] };
  at: GameTime;                        // the window for temporal predicates
  must: Predicate[];
  prefer?: Array<{ p: Predicate; weight: number }>;
  limit: number | 'all';
  budget: Work;                        // §10.7
}

interface Predicate {
  path: string;                        // slot path from the candidate; may cross ref and node slots
  op: 'in' | 'not-in' | 'range' | 'eq' | 'field-at-least' | 'field-at-most' | 'has-edge' | 'lacks-edge';
  arg: Value | Region | { edge: EdgeTypeId; to?: Id | Selector };
}
```

### 8.2 Bounds

The verdict of a predicate over a region is derived from:
- the region's pins;
- the bounds of every contribution that could apply there (§4.3);
- conservative treatment of uncertainty. A constraint that might be rejected by arbitration (§5.2) contributes no narrowing to the bounds. When in doubt, the verdict is `maybe`.

### 8.3 Traversal: branch and bound

1. **The frontier.** It starts with the scope's roots. A frontier entry is either a **compound region** (an unopened node standing for its descendants, or a spatial cell from the world index) or a **candidate** (a single node of kind `find`).
2. **Ordering.** Pop the entry with the highest upper bound on preference score. Ties go to the lower `Id`, or the lower cell key.
3. **Pruning.** An entry with any `must` verdict of `no` is dropped.
4. **Descent.** **Every compound region that is not pruned is descended,** whether its verdicts are `yes` or `maybe`. Descent pushes its children with their bounds, computed without materialising them.
5. **Candidates.** **Every candidate that is not pruned is checked exactly,** whether its verdicts are `yes` or `maybe`. The candidate is resolved (§5) and each `must` predicate evaluated. A candidate that passes is scored: the sum of the `prefer` weights whose predicates hold.
6. **Deduplication.** Candidates are deduplicated by `Id`, since one node can be reached through several regions.
7. **Stopping.**
   - With `limit = n`: stop when `n` candidates are confirmed and no frontier entry's upper bound exceeds the `n`-th score. This gives the complete top-`n`.
   - With `limit = 'all'`: stop when the frontier is empty.
8. **Results** are returned with explanation traces (§13).
9. **Budget.** When the work budget runs out, return what is confirmed so far, flagged `incomplete`. A resumable query keeps its frontier for the next slice (§10.7).

**Soundness (I-6).** A complete run returns:
- for `'all'`: every in-scope node satisfying all `must` predicates;
- for `n`: a set of `n` such nodes, none of which scores below any qualifying node left out.

## 9. Time, events, summaries and evolution

### 9.1 Time

`GameTime` is a signed 64-bit count of game seconds since the lineage's epoch. S5 maps it to the game's clock. Windows are integer divisions of it (§6.3).

### 9.2 Events

Events are minted nodes of kind `core:event`:

| Slot | Contents |
|---|---|
| `time` | When it happened |
| `place` | Ref to a place |
| `kind` | An enum from data |
| `participants` | Many: an owned value node with `who` (ref) and `role` (enum) |
| `effects` | Many: owned value nodes describing an effect: `{ on: ref, effect: enum }`, using the effect vocabulary of §10.8 |
| `witnesses` | Many: ref |
| `causes` | Many: ref, to events or contributions |

**An event becomes canon** when:
- V observes it, in which case the fields V observed are pinned `observed`; or
- a seed commits it, in which case the committed fields are pinned `committed`; or
- a persisted effect depends on it, in which case the fields the effect needs are pinned `committed`.

**Only those fields are pinned.** Causes, other participants and details stay open until something needs them (generate, then justify).

### 9.3 Summaries and their refinement

A summary covers events nobody looked at individually, such as "about three robberies in Kabuki this week". It is a minted node of kind `core:summary`:

| Slot | Contents |
|---|---|
| `kind` | The kind of event summarised |
| `interval` | A time interval |
| `region` | A place region |
| `count` | int |
| `materialised` | A set of indices |
| `canon` | A set of indices |

**Refinement is deterministic per index.** Item `i` of a summary `S`, for `0 ≤ i < count`:
1. Its `Id` is `H("mint", S.id, "item", i)`.
2. Its time is `interval.start + rand("item-t", S.id, i) × interval.length`, on the second grid.
3. Its place is sampled within `region` by the place sampler, keyed by `("item-p", S.id, i)`.
4. Its other slots resolve as ordinary sampled slots of a minted event.

**Querying a summary.** A query over a time or place region materialises exactly those items whose computed time and place fall inside it. Overlapping queries therefore always see the same items, and nothing is counted twice. `materialised` and `canon` are bookkeeping.

**The count.** It is fixed when the summary is created. If a process later revises it, the new count MUST be at least `max(canon) + 1` (§6.5).

### 9.4 Evolution in canonical windows

Simulation processes are S1's. The kernel requires:
- **The definition.** Each process is `ProcessDef { id, tier, period, inputs: Selector[], run }`.
- **Canonical windows.** A process's history is a function of whole windows `k = floor(t / period)`. `run(ctx, k)` computes window `k` from the state at that window's start. Its randomness is keyed by `("proc", worldSeed, processId, k, …)`. The result is independent of how ticks were scheduled (I-15).
- **Catch-up.** The scheduler always completes whole windows in order. After an absence, the missed windows of tiers 0–2 run one by one, each in bounded work. A tier's period SHOULD keep a week's absence to a few hundred windows.
- **Fine tiers don't catch up.** Tiers 3–5 run only where demand reaches them (§10.6). When V arrives, their state is generated from the coarse state, consistent with the pins.
- **Order.** Within a window, processes run by tier, coarse first, then by `id`. Inputs are read from the state at the window's start, and outputs are applied at its end (double-buffered), so the order among same-tier processes doesn't change results.

## 10. Context frames, interest routing and relevance

### 10.1 Drives are data; their dynamics are policy

Actors carry a `drives` slot of `core:drive-state` nodes:
- `drive`: an id;
- `importance`;
- `urgency`: temporal.

How urgency rises and falls is an S1 policy, written as simulation contributions and pins. The kernel only reads the values.

### 10.2 Frames

```ts
interface ContextFrame {
  id: Id; actor: Id;
  level: 'drive' | 'concern' | 'goal' | 'step' | 'situation';
  parents: Array<{ frame: Id; weight: number }>;      // weighted, acyclic (§10.3)
  origin: Id;                          // the originating concern or drive, for aggregation
  payload: { drive?: DriveId; goal?: Goal; place?: Id };
  weight: number;                      // this frame's own weight, 0..1
  own: FrameInterests;                 // only what this frame adds over its parents
  focus: { nodes: Id[]; tier: Tier };
  status: 'active' | 'blocked' | 'satisfied' | 'abandoned' | 'suspended';
  opened: GameTime; cause: Id;
}

interface FrameInterests {
  wants: Selector[]; reactsTo: Selector[]; blockedBy: Selector[];
  threatenedBy: Selector[]; protects: Selector[];
}

interface Goal { effects: Array<{ on: Id | Selector; effect: Effect }> }   // §10.8
```

### 10.3 Inheritance is acyclic

Frame parent links MUST form a DAG, and adding a link that would close a cycle is refused. In particular:
- **Members inherit from groups.** A member's frames may take a group's concern frames as parents (§12.2).
- **Leaders influence groups through decisions, not parent links.** A group's concerns are created and changed by S1's group-decision policy, which reads the leaders' frames and writes the group's concern frames as ordinary operations, attributed to the leaders.

**The pull** of a frame is the strongest path from any of its root frames, where a path's value is the product of the edge weights and frame weights along it:

```
pull(f) = f.weight × max over parents p of (edgeWeight(p) × pull(p))      (pull of a root = its weight)
```

Repeated influence from one `origin` counts once, through its strongest path. Distinct origins stay separate frames, so they are never summed.

### 10.4 Lifecycle

- **Demand roots.** V, the director, and every live seed (S2) are demand roots. Their frames are opened by S1 (for V, from the game's story state and the director's beliefs) and by S2.
- **Other actors' frames** open only when a demand root's frame, or a relevance event, focuses on them.
- **Blocked frames stay in the registry,** so they hear about what could unblock them: their `blockedBy` interests.
- **Satisfied and abandoned frames leave the registry.** They are kept only while a persisted record refers to them.
- **Suspension (§10.7)** removes a frame from the registry and from demand, in a deterministic order: lowest pull first, then higher `Id`. Resumption is the reverse order when budget frees up.
- **Status changes cascade.** When a parent's status, weight or parents change, the kernel recomputes its descendants' pull and eligibility in the same tick.

### 10.5 Interest routing and matching

Matching runs in two stages:
1. **Routing keys** make lookups cheap. Each interest selector compiles to one or more routing keys:
   - `node:<Id>`;
   - `kind:<KindId>`;
   - `tag:<tag>`;
   - `role:<role>:<Id>`;
   - `dim:<DimId>=<bucket>`;
   - `edge:<EdgeTypeId>:<Id>`.

   The registry is `Map<RoutingKey, Set<(FrameId, interestType, selectorIndex)>>`.
2. **Exact checks** decide matches. The candidate interests found through routing are tested exactly against the change.

**Semantic changes** are the only things that emit (I-13): a pin added, an edge added or ended, a canon event, a minted node, a contribution added or ended, and a game reading that changed a mirrored value. Cache fills, regeneration and save replay never emit.

**A change's keys** are:
- its node's `Id`, kind and kind ancestors, and tags;
- the bucket keys of its changed values;
- for events, the `Id` and `role:<role>:<Id>` of every participant, the targets of every effect, and the place;
- for edges, both endpoints.

**Emission.** A change matches a frame through an interest of type `t` when an exact check passes. Inherited interests are checked on the frame that declared them. Descendants receive the match through their pull, not through re-matching. The relevance of the match is:

```
r = pull(f) × m(t) × s(x)
m: wants, threatenedBy, protects 1.0; blockedBy 0.8; reactsTo 0.6                 [calibrate]
s: 1.0 for node or role keys, 0.5 for kind or tag keys, 0.3 for bucket keys          [calibrate]
```

At most one emission is made per (change, frame, interest type): the one with the greatest `r`. It is emitted when `r ≥ θ_react` **[calibrate]**, as `Relevance { actor, frame, change, type, r }`, to S1 and S3.

### 10.6 Demand and tiers

Each node has a demand tier: the highest `focus.tier` among active or blocked frames focusing on it or on its owner chain. A frame's claim is weighted by its pull times `w_actor`, which is **[tunable 4.0]** for demand roots and 1.0 for everyone else.

A slot normally opens when the node's demand tier reaches the slot's `tier`. Tiers are scheduling bands, not an ontology or a maximum depth: a query, a seed or a view filter may open finer slots inside its own work budget.

### 10.7 Work budget

All kernel work is metered in work units, consumed from one budget per tick:
- resolving a slot: 1 + |F|/64;
- a query frontier step;
- an exact check;
- a relevance emission;
- a frame recomputation;
- a forgetting step.

The budget per tick is **[tunable; P7 sets it from measurement]**.

Query traversal, relevance dispatch, frame cascades and forgetting are **worklists**. When the budget runs out they stop where they are and resume next tick, in the same deterministic order. Work for demand roots, and for the player's direct actions, is taken from the worklists first.

### 10.8 Goals, effects and cross-pressure

**Goals declare their effects** on targets, from a small vocabulary: `harm`, `kill`, `help`, `protect`, `take`, `give`, `expose`, `conceal`, `move`, `meet`.

**Interests imply requirements.** A `protects X` interest forbids `harm`, `kill`, `take` and `expose` on X. A `wants Y` interest requires the matching effect. The conflict table is a registry function [S1 refines it].

**Cross-pressure is checked:**
- when a goal frame opens;
- when a membership edge is added or changed;
- when an obligation changes;
- whenever a frame's interests change.

**The check:**
1. **Candidates come from routing.** For each effect target, look up the actor's other active or blocked frames whose interests route on that target and that come from a **different origin**.
2. **The exact check is the conflict table.** A pair conflicts when an effect of one frame violates a requirement of the other.
3. **Emission.** Emit `Dilemma { actor, frameA, frameB, target, effect, severity: pull(A) × pull(B) }`, at most once per (frameA, frameB, target) until either frame changes.

So an order to kill X conflicts with a frame that protects X, and an order to rescue X doesn't (A-19).

## 11. Beliefs and perspectives

### 11.1 The belief record

```ts
interface Belief {
  id: Id; believer: Id; subject: Id; path: SlotPath;
  value?: Value; region?: Region;      // exactly one
  window?: number;                     // for temporal paths
  confidence: number;                  // (0, 1]
  evidence: Id[];                      // originating events: independent sources of support
  source: { by: 'observed'; event: Id } | { by: 'told'; teller: Id; event: Id } | { by: 'inferred'; rule: FnRef; from: Id[] };
  formed: GameTime; refreshed: GameTime; memorable: boolean;
}
```

Beliefs are stored per believer and indexed by (subject, path, window). They never constrain the subject's world state.

### 11.2 Kernel rules

- **Consistency within a perspective (I-9).** A believer holds at most one active belief per (subject, path, window). A new belief that contradicts the active one replaces it or is discarded, by S1's policy. The loser is kept as superseded history only if memorable.
- **Independent evidence only.** Merging two compatible beliefs raises confidence only by evidence that is new. If `b'`'s `evidence` is a subset of `b`'s, nothing changes except `refreshed`. Telling passes the teller's `evidence` on unchanged, so a rumour heard twice from one origin never corroborates itself (A-21).
- **Forming, telling, fading and reputation** are S1 policies. They use these hooks:
  - `onWitness(event, observer)`;
  - `onSocial(event, teller, listener)`;
  - `onTick(believer)`;
  - `aggregate(audience, subject, path)`.

  S1's first policy implements the attribution rules from [foundation §5.4](../foundation.md#54-perspectives-everyone-has-their-own-model): dispositional bias, group priming, telling with distortion, fading, and reputation as aggregated belief.

### 11.3 The director's beliefs about V

The root actor `director` holds beliefs about `v`, formed by S3's inference policy from observed V events and engagement. V's inferred frames are built from them (§10.4).

Nothing pins or sets V's drives (I-12).

### 11.4 Knowing: the observer-relative interface

Attribution and other perspective-bound policies MUST read the world only through `knows(observer, subject, path, t)`, which returns, in order:
1. the observer's active belief, if any;
2. the subject's value of a `perceivable` slot, or a `perceivable` edge, if the observer witnessed the subject at `t`: a uniform, an open gang tattoo, the subject's appearance;
3. `unknown`.

It MUST NOT fall back to world truth. A secret affiliation therefore never colours a stranger's judgement (A-20). World-level simulation reads world truth directly, through ordinary resolution.

## 12. Groups and membership

- **Groups** are actors whose kind has the `group` facet.
- **Membership** is an edge `core:member-of`. Its attributes are `role`, `strength`, `visibility` (`open`, `secret` or `deniable`), `terms` (an owned `core:terms` value: `standing`, or `contract` with an end predicate), `obligations` (interest selectors) and `exit-cost`.
- **Inheritance (§10.3).** A member's frame of drive family `X` may take as a parent each active concern frame of each group it belongs to with `strength ≥ θ_member` **[tunable 0.2]**, at edge weight `strength`. A concern without a family attaches to the member's situation frame.
- **Orders.** An order creates a goal frame on the member whose parent is the group's goal frame, at edge weight `pressure`. S1's group policy computes `pressure` from strength, the leader's authority and fear.
- **Leadership** acts only through S1's decisions (§10.3), so frames stay acyclic.

## 13. Provenance and explanation

Every pin, contribution, edge, belief, event, frame, conflict and dilemma has a `cause`.

`trace(node, slotPath, t)` returns the complete, deterministic record:
- every constraint, active and rejected;
- every applicable weight contribution, with `f(v*)`;
- the prior;
- the draw's noise for `v*` and for the runner-up.

`explain(…)` presents the trace's top `k` **[tunable 8]** weight contributions, ranked by **discriminating effect** at the winner:

```
effect(c) = strength_c × (ln f_c(v*) − ln f_c(v₂))      (v₂ = the runner-up)
```

A contribution that weights every value equally therefore ranks zero. The presentation is labelled a heuristic. The trace is the complete account (I-8).

## 14. Persistence: the logical record

### 14.1 What is persisted

- **Node headers (§3.1)** for every retained node (§7.3), including generated members and owned values that durable state refers to.
- **Pins, edges and conflicts** whose causes are persisted.
- **Contributions** whose source can't reproduce them: seeds, committed procedural decisions, and runtime authored decisions. Pack contributions are reloaded; the record keeps each pack's id and version.
- **Memorable beliefs.**
- **Canon events:** their headers and only their pinned fields.
- **Summaries.**
- **Frames** of demand roots and live seeds.
- **Seed states** (S2), and **process window cursors and states** (S1).
- **Lineage:** the world seed, the schema and function versions (§14.4), and lineage information.

**Not persisted:**
- caches and unretained nodes;
- the current values of mirrored slots, which are re-read from the game;
- relevance events, which are transient.

V's observations of game state are persisted, because they are history.

### 14.2 Records and branching

Each save has a record `{ saveKey, parent, epoch, ops }`. Its parts:
- `parent` is the record of the save it was made from;
- `epoch` is a fresh `Id` per load;
- `ops` is an append-only log since the parent:
  - `HeaderAdded`;
  - `PinAdded`, `PinWithdrawn`;
  - `EdgeAdded`, `EdgeEnded`;
  - `ContributionAdded`, `ContributionEnded`;
  - `BeliefSet`, `BeliefDropped`;
  - `EventCanon`;
  - `SummarySet`;
  - `FrameState`, `SeedState`, `ProcessState`;
  - `Conflict`.

Snapshots are written every **[tunable 10,000]** ops. Ops carry complete data.

### 14.3 Loading is replacement

Loading save `B` runs in this order:
1. **Discard all branch-local state:**
   - caches;
   - in-memory nodes;
   - frames, the registry and worklists;
   - pending relevance;
   - every queued operation tagged with the previous `epoch`. Operations from that epoch that arrive later are refused.
2. **Replay** `B`'s ops from its nearest snapshot, silently: no relevance emission (I-13).
3. **Reconcile with the game:** read the mirrored state through the game port. Changed values become ordinary game readings for the current window.
4. **Start a new epoch** and resume ticking.

### 14.4 Compatibility

The lineage root records the schema and registry function versions. Loading under different versions is allowed when every function a pin, persisted contribution or header depends on is still available at a compatible version. Otherwise the record loads read-only, and the engine says so in plain words (S6 details).

## 15. Invariants

| # | Invariant |
|---|---|
| I-1 | **Determinism.** The same world seed, schema, function versions, contributions, pins and operation sequence give identical resolved values everywhere, using the arithmetic of §1.3 |
| I-2 | **Active constraints hold.** Every resolved value satisfies every constraint arbitration made active. Rejected constraints are recorded as conflicts, and a rejected observation sets the status to `contradiction` |
| I-3 | **Regeneration.** Forgetting a node and resolving it again gives identical values while its constraints and contributions are unchanged |
| I-4 | **Nothing regenerable is persisted.** The record contains no resolved cache values |
| I-5 | **Views agree.** A pinned derived view and its inputs' resolved values are consistent (§6.4) |
| I-6 | **Queries are sound and complete** (§8.3) |
| I-7 | **Coupled draws.** Scaling the weight of one value `a` changes a slot's result only if `a` was or becomes the winner. Scaling every value's weight by one constant changes nothing |
| I-8 | **The trace is complete:** every constraint and every non-uniform weight contribution appears in `trace` |
| I-9 | **Perspectives are consistent.** At most one active belief per (believer, subject, path, window) |
| I-10 | **Budgets hold.** A tick never exceeds its work budget. Interrupted worklists resume deterministically |
| I-11 | **Identity is stable.** Moving a node never changes its `Id` or its pins |
| I-12 | **V is never owned.** No operation pins or sets V's drives. V's choices enter only as observed events |
| I-13 | **Silence.** Cache fills, regeneration and replay emit no relevance |
| I-14 | **Acyclic frames.** The frame parent graph is always a DAG |
| I-15 | **Partition independence.** A process's history is the same however ticks partition time |

## 16. Fixtures

Fixtures are fully specified here, so an implementer can check them without running anything else. Where an outcome depends on hash values, the fixture checks a property, not a number. After acceptance, the reference model adds a regression corpus of generated cases, including the vendor scenario ([foundation §10](../foundation.md#10-worked-example-one-vendor)).

| # | Setup | Expected |
|---|---|---|
| F-1 | **Arbitration.** An enum slot over {a, b, c, d}. Constraints: an observation pin `{a, b}` (600); an authored set `{b, c}` (400); a seeding set `{c}` (300); a simulation set `{a, b, c, d}` (200) | Active: 600, 400, 200. Rejected: 300 (conflict recorded). `F` is {b}. The value is b, with status `ok` |
| F-2 | **Contradiction.** As F-1, plus a second observation pin `{c}` with a higher `Id` | Active: the first observation, then the authored set. The second observation is rejected. Status `contradiction`; value b |
| F-3 | **Temporal observation.** Weather is temporal with a 3,600 s window. V observes `rain` at t = 1,000. At t = 5,000 the game reports `clear` | Window 0 is pinned `rain`. Window 1 resolves to `clear` from the game. No conflict |
| F-4 | **View filter.** `age` int 16..90; `age-band` derived as `floor(age / 10)`. An observation pins `age-band = 3` | `F_age` is 30..39, and resolved `age` lies in it. A later authored pin `age = 45` (400) is rejected with a conflict, because the view filter carries the observation's precedence (600) |
| F-5 | **Coupling.** An enum slot with 100 values and equal priors. Resolve it, then scale value `a`'s weight by 1.01, where `a` is not the first result, and resolve again. Then scale every value by 2 | The result is unchanged unless `a` becomes the winner. Scaling every value leaves the result unchanged (I-7). Run across 1,000 node ids: the change rate equals the rate at which `a` wins, within sampling error |
| F-6 | **Query: a region where every predicate is `yes`.** A three-level place tree (1 district, 4 blocks, 16 places) where the influence field is ≥ 0.6 everywhere and police ≤ 0.2 in 5 places | `limit = 'all'` returns exactly those 5. The `yes` region is descended, and no node is missed or duplicated |
| F-7 | **Summary refinement.** A summary of 5 robberies over one day in a region of two blocks. Query block 1, then the whole region; make item 2 canon; revise the count to 2 | Block 1's items are a subset of the whole-region items, with the same `Id`s. The revision is refused because it is below canon index 2 + 1 = 3 |
| F-8 | **Cross-pressure.** M is a member of G; M has a family frame protecting X. G orders M to kill X; separately, G orders M to rescue X | Kill: one `Dilemma`. Rescue: none |
| F-9 | **Hearsay.** Alice observes event E and forms belief b. She tells Carl, and Carl tells Dana. Dana is later told the same thing by Alice | Dana's belief has `evidence = {E}`. The second telling only refreshes it; confidence doesn't rise from it |
| F-10 | **Secret affiliation.** Bob is secretly a member of Militech (`visibility: secret`), and Alice's group is Arasaka. A collision is witnessed by Alice | `knows(Alice, Bob, member-of)` is `unknown`; no rivalry is applied. Repeat with an open membership on a perceivable edge: rivalry is applied |
| F-11 | **Leadership.** L leads G and is a member of G | Frame inheritance stays acyclic. G's concerns change only through decision operations attributed to L |
| F-12 | **Branching load.** Save A; pin p1; save B; load A; pin p2; save C; load B | Loaded B has p1 and not p2. Operations queued under C's epoch are refused after the load. Replay emits no relevance |
| F-13 | **Partition.** A process with a period of 3,600 s, ticked across 7,200 s once as one tick and once as 120 ticks | The histories are identical |
| F-14 | **Retained member.** A crowd slot has a count of 12; member 9 is pinned observed. A process revises the crowd to 6 | The count resolves to at least 10, and member 9 stays addressable |

**Calibration fixtures (set the [calibrate] values):**
- **C-a.** A pedestrian whose drive frame for comfort has `reactsTo rain`. The `rain` bucket change should produce a reaction.
- **C-b.** A vendor's concern frame, `threatenedBy` Tyger Claw collectors. A collector entering the stall should react. A distant gang member in the district should not.
- **C-c.** A customer approaching a vendor's `wants customers` frame should react at low priority.
- **C-d.** V's frame protecting a friend, and an event harming that friend, should react strongly.

The defaults for `m`, `s` and `θ_react` are chosen so that all four behave as stated, and are recorded with the fixtures.

## 17. Compromises and open items

These are recorded in the foundation's [ledger](../foundation.md#9-the-reference-model-and-the-compromise-ledger).

| # | The model says | This specification does | Revisit when |
|---|---|---|---|
| C-02 | A believer's view is a full perspective over every dimension | Beliefs are sparse records; their policies live in S1 | A story needs an NPC to reason about something the policies can't express |
| C-03 | Relevance follows from what matters to each actor | Fixed match weights per interest type and key type, calibrated by fixtures (§10.5) | Evaluation shows misplaced attention that recalibration can't fix |
| C-04 | Every dimension is sampled the same way | Domains larger than `N_enum` need a declared hierarchical sampler. Text is composed from enumerable components, not sampled as free strings | A dimension can't be expressed hierarchically |
| C-05 | Pins propagate both ways through everything | Backward narrowing works only through derived views and member counts. Slot dependencies follow declaration order (§2.3). Other backward reasoning is generate-then-justify | A scenario needs a later fact to constrain an earlier one in a way views can't express |

**Open items:**
1. Measure BLAKE3 and the fdlibm ports in TypeScript and Rust for bit-identical results. This is the reference model's first test.
2. P7 sets the work budget per tick from a measured simulated session.
3. S5 fixes the `GameTime` epoch and clock mapping.
4. S1's first policies: urgency, attribution, telling and fading, group decisions, and the effect conflict table.
5. P7 measures save size in a representative simulated session before any budget is set (A-15).

## 18. Review record

### Round 1: GPT-6 Astra, extra-high reasoning effort, 22 October 2026

The review covered the foundation and S0 v0, with a brief to weigh proportion and simplicity. Its 25 findings were each checked against the specification:
- **adopted:** 22;
- **adopted with a different solution:** 3;
- **not adopted:** 0.

Its over-engineering notes were adopted except one point, kept for a reason given in the table.

The raw review is kept privately.

| Finding | Disposition | Where |
|---|---|---|
| A-01 Observations froze mutable state | Adopted: temporal slots and windows; the game is authoritative for current mirrored values | §6.2, §6.3 |
| A-02 Arbitration contradicted resolution | Adopted: one arbitration pass, highest precedence first; active versus rejected; contradiction status | §5.2 |
| A-03 Propagation had no dependency model or termination | Adopted differently: declaration-order dependencies; backward narrowing only through derived views and counts | §2.3, §6.4, C-05 |
| A-04 Leadership created inheritance cycles | Adopted: acyclic weighted parent links; leaders act through decisions; pull is the strongest path | §10.3 |
| A-05 Query traversal missed nodes | Adopted: descend every unpruned region; check every candidate exactly; deduplicate; complete top-k | §8.3 |
| A-06 Owned values, refs and structured values were guesses | Adopted: `node` slots for owned values; `ref` slots that select; a minimal core schema | §2.1, §2.4, §2.6 |
| A-07 Some bounds weren't conservative | Adopted: Rule bounds under `maybe`; constraints that might be rejected don't narrow | §4.3, §8.2 |
| A-08 Fingerprints missed dependencies | Adopted: a coarse global revision in the reference model; finer tracking is an optimisation that must agree | §5.5 |
| A-09 Regeneration could become a story event | Adopted: only semantic changes emit; resolution, regeneration and replay are silent | §5, §10.5, I-13 |
| A-10 Sampling undefined at scale | Adopted: `N_enum`, declared hierarchical samplers, bounded ref candidates, explicit failure; text composed from components | §5.4, §2.6, C-04 |
| A-11 Summary refinement had no procedure | Adopted: per-index deterministic items; counts never below canon; only observed or committed fields pinned | §9.2, §9.3 |
| A-12 Identity information not persisted | Adopted: headers for every retained node; retained members bound counts | §3.1, §6.5, §14.1 |
| A-13 Load boundary unclear | Adopted: loading is replacement, silent replay, game reconciliation, epochs | §14.3 |
| A-14 Caps didn't bound time | Adopted: one work budget in units; resumable worklists | §10.7 |
| A-15 Persistence grew regardless of relevance | Adopted: retention-driven persistence; canon pins only the needed fields; measure before budgeting | §7.3, §9.2, §14.1 |
| A-16 Evolution depended on time partitioning | Adopted: canonical windows, double-buffered order; fine tiers don't catch up | §9.4, I-15 |
| A-17 Frame lifecycle incomplete | Adopted: demand roots, blocked frames stay registered, deterministic suspension, cascades | §10.4 |
| A-18 Matching lost semantics; defaults suppressed reactions | Adopted: routing keys plus exact checks; participant and role keys; one emission per triple; calibration fixtures | §10.5, §16 |
| A-19 Shared target isn't cross-pressure | Adopted: an effect vocabulary and conflict table; rechecked when memberships change | §10.8 |
| A-20 Attribution leaked world truth | Adopted: the `knows` interface and perceivable slots and edges | §11.4 |
| A-21 Hearsay manufactured confidence | Adopted: evidence identities; only independent evidence corroborates | §11.2 |
| A-22 Stability claim overstated | Adopted differently: the inverse-CDF draw is replaced by Gumbel-max with fixed per-value noise, which has the coupling property exactly (I-7) | §5.4 |
| A-23 Hashing alone isn't cross-language determinism | Adopted: binary64 rules, fdlibm `ln` and `exp`, polynomial falloffs, canonical sum order, hash-keyed streams, versioned functions | §1.3, §1.4, §14.4 |
| A-24 Scenarios weren't test vectors | Adopted: fourteen hand-checkable fixtures and four calibration fixtures; the regression corpus comes later | §16 |
| A-25 Explanation ranking misleading | Adopted differently: the complete trace is separate from the top-k presentation; ranking by discriminating effect at the winner | §13 |
| Over-engineering notes | Adopted: behavioural policies moved to S1; first domains narrowed; no general frameworks; tiers are scheduling bands. Partly adopted: drive data stays in the kernel because frames need it | §0, §10.1, §10.6, §11.2 |
