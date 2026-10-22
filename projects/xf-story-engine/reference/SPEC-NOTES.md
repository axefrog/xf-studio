# Spec notes for the reference model

Interpretations made while building the TypeScript reference model of S0 v3
(`research/story-engine/spec/kernel.md`). Each entry gives the section, the issue, the reading chosen and
why. The coordinator decides afterwards and updates the spec.

**Status.** The coordinator has decided entries 1 to 29: entries 1 to 4 and 6 to 29 are accepted as
written (marked "decided by the coordinator"), and entry 5 was changed (marked "changed by the
coordinator"). Entries 30 to 51 are **new** since those decisions: interpretations the later modules
needed, each the most faithful reading found. Entry numbers are stable so messages and reviews can point
at them; the sections below order them worst first, meaning the entries that change observable results
come before presentation choices.

**Reading order, worst first:** 5, 6, 7, 34, 38, 9, 10, 46, 1, 2, 3, 4, 8, 11, 12, 13, 14, 15, 16, 17, 18,
27 (results); 19, 20, 39, 33, 35, 36, 21, 44 (records, persistence and knowing); 22, 23, 24, 25, 32, 40,
42, 47 (relevance, frames and groups); 26, 37, 41, 45, 48 (work and evolution); 43, 49, 50, 51, 28, 29, 30,
31 (guards, tooling and presentation).

## Interpretations that change results

5. **Enduring slots and `t`, 6.2. Changed by the coordinator.** A pin on an enduring slot (no `temporal`,
   not mirrored) applies at **every** time `t`, whatever its `valid.from`; the pin's `at` and `valid.from`
   only record when the fact was learned. Only withdrawal removes it. Pins on mirrored timelines and on
   simulated temporal windows keep the intervals the specification gives them. The reference model
   ignores `valid.to` on an enduring pin too. (decided by the coordinator; implemented: `reference/src/resolve.ts`,
   `reference/src/retention.ts`)
6. **`assigned` slots and singleton constraints, 5.1 step 3.** The spec takes the value from "the first
   active value pin". Non-canon events must carry their fields without pins (a pin in effect is a
   retention root, so pinning every minted event would make forgetting impossible). Reading: after
   arbitration, if the feasible set is a single value, that value is the result, whether it came from a
   value pin or from a `Const` constraint. This strictly extends the spec (an active value pin always
   leaves exactly one value). Minted events set their fields with `simulation`-layer `Const`
   contributions. (decided by the coordinator; implemented: `reference/src/resolve.ts`, `reference/src/events.ts`)
7. **Derived slots with pins, 5.1 step 1 and I-5.** "If the result violates an active pin, the status is
   `contradiction`." Reading: for a unary view with a preimage, arbitration happens on the input, so the
   derived result is `contradiction` only if a violated pin of precedence 600 or more was rejected there
   (a derived slot inherits the worst status of its inputs). For a multi-input view (or a view without a
   preimage, or whose input is read through the owner chain), any pin in effect on the derived slot that
   the result violates gives `contradiction`, at any precedence, as I-5 states. (decided by the
   coordinator; implemented: `reference/src/resolve.ts`)
34. **Pins on simulated temporal slots name their window. (new)** A pin on a slot with `temporal` must use
    the slot key `path@w<k>` (the spec's `SlotKey`); a bare-path pin is refused at write time, and
    `@w<k>` on a non-temporal slot is refused. The pin applies to window `k` by key alone, and its
    default validity is the window `[k*W, (k+1)*W)`. Resolution at time `t` uses window
    `floor(t / window)`; `path@w<k>` as a resolution path selects window `k` outright. (`reference/src/kernel.ts`,
    `reference/src/resolve.ts`)
38. **`ref` slots: pins are authoritative, candidates fill the gaps. (new)** A sampled `ref` slot starts
    its arbitration from an unbounded domain. A value or region pin, or a `Set`/`Const` constraint, names
    nodes directly and wins even if the node is not in the candidate set. Only when the constraints leave
    the feasible set unbounded does the draw run over the candidate set (spec 2.4: the complete query
    result cut to the `max` lowest `Id`s). A `Set` with `allow: false` first materialises the candidates.
    An empty candidate set is `unavailable`; a feasible set over `N_enum` is `failed` with a defect.
    (`reference/src/resolve.ts`)
9. **Many slots of non-node types, 1.1 and 2.4.** "Member i of a many slot is `H("gen", ...)` whatever its
   value type." For a `many` slot of a non-node type (witnesses, causes) the element `key[i]` is the value
   resolved at `(owner, "key[i]")`; its Id exists for identity but there is no separate node holding it,
   so it is not retained on its own. (decided by the coordinator; implemented: `reference/src/kernel.ts`)
10. **Slot order and the count.** `key#count` sits at the position of its `many` slot for the dependency
    order. Addressing member `i` requires `count > i` at the time. (decided by the coordinator;
    implemented: `reference/src/schema.ts`, `reference/src/resolve.ts`)
46. **Counts of assigned many slots are assigned, and non-node members need a count too. (new)** The
    count of a `many` slot takes the slot's mode: `assigned` slots (an event's witnesses and causes) have
    an assigned count, `sampled` slots a sampled count, `mirrored` slots a mirrored one on mirrored nodes.
    `key[i]` of a non-node many slot is `unavailable` unless `count > i`, as for node members.
    (`reference/src/resolve.ts`)
1. **Value representation, 1.2 and 2.1.** The spec says a real or cyclic value hashes as its grid index,
   but does not say what the in-memory value is. Reading: a real or cyclic value is held as the grid point
   itself (`min + i * quantum`, or `i * quantum`), a vec as an array of grid points, and only the hash uses
   the index. This keeps predicates such as `field-at-least 0.6` natural. Fixtures use power-of-two
   quanta, so the grid is exact. (decided by the coordinator; implemented: `reference/src/value.ts`)
2. **Canonical value encoding, 1.2.** The spec lists the encoding per value type but not the byte layout
   of strings, Ids and vecs. Reading: a string is its raw UTF-8 bytes, an Id is its 16 bytes, an int is
   i64 little-endian, a real or cyclic is the grid index as i64 little-endian, a vec is its n grid
   indices as consecutive i64 little-endian. `H` adds tag `0x06` before and `0x00` after. (decided by the
   coordinator; implemented: `reference/src/value.ts`, `reference/src/id.ts`)
3. **Hash argument types, 1.4.** `rand("g", worldSeed, node.id, slotPath, k, v)` mixes strings, Ids and
   integers, and a JS string cannot say which. Reading: arguments are explicitly typed (`s`, `i`, `id`,
   `f`, `b`, `val`). `worldSeed` and every `Id` use tag `0x03`; names such as a process id use tag
   `0x01`; the window index `k` is an `i64`. (decided by the coordinator; implemented: `reference/src/id.ts`)
4. **toUnit bit order, 1.2.** "The first 52 bits" is read as the first 13 hexadecimal characters of the
   Id, which is the big-endian reading of the first 6.5 bytes. (decided by the coordinator; implemented)
8. **View preimages come from the same node only, 5.2.** Preimage constraints on a slot are collected
   from derived slots of the same node that take it as their single input, chained through views of
   views. A derived slot on another node that reads this slot through the owner chain does not narrow it.
   (decided by the coordinator; implemented: `reference/src/resolve.ts`)
11. **Schema load: domain size.** "int/real: at most N_enum values when sampled" is enforced at load for
    `sampled` and `mirrored` slots (a mirrored slot is sampled on a generated node), not for `assigned` or
    `derived` slots, so large integer ranges (times, durations) are `assigned`. (decided by the
    coordinator; implemented: `reference/src/schema.ts`)
12. **Schema load: dependency reads, 2.3.** A derive or conditioned input, or an enum-by `by`, may be
    `key`, `key#count`, or `^/…/key` (owner chain). It may not be a later or same slot, a member
    (`key[i]`), a `node` slot's contents, or a `ref` slot. Owner-chain reads cannot be checked against a
    kind and are checked at resolution. (decided by the coordinator; implemented:
    `Schema.checkDependencyPath`)
13. **Contribution reads at resolution, 2.3.** Rule `when` predicates, field base slots and selector
    `where` predicates are checked when evaluated: only earlier slots of the node and owner-chain slots.
    A contribution that reads anything else is skipped as not applicable, and a `read-violation` defect is
    recorded. (decided by the coordinator; implemented: `reference/src/predicate.ts`, `reference/src/resolve.ts`)
14. **Selector scope `under`.** Defined as: the node is the Id, or the Id is in its owner chain, or
    following `core:located-in` edges (valid at `t`) from the node or an owner-chain node reaches the Id.
    For a query, the root of an `under` scope is itself an entry (a candidate if its kind matches).
    (decided by the coordinator; implemented: `reference/src/predicate.ts`, `reference/src/query.ts`)
15. **Candidate-query scopes name the city by root name.** A static schema cannot hold the Id of `city`
    (it depends on the world seed). A scope Id written `root:<name>` is expanded with
    `rootId(worldSeed, name)`. (decided by the coordinator; implemented: `Kernel.expandId`)
16. **`Derive` form.** "One value, for derived slots." Reading: as a `constrain` contribution it acts as
    `Const(derive(inputs))` over the node's resolved earlier slots. (decided by the coordinator;
    implemented)
17. **`Set(region, allow)`.** `allow: false` removes the region from the feasible set (set and interval
    regions only). Set is valid only in `constrain` mode; in `weight` mode it is invalid and recorded as a
    defect. (decided by the coordinator; implemented)
18. **Process pins and reasons, F-13.** Pin reasons are `observed`, `game`, `authored` and `committed`
    only. A process pin uses `committed`. (decided by the coordinator; implemented: `reference/src/evolution.ts`)
27. **Summary item place draw, 9.3.** "Drawn among the places under `scope`... with the key
    (`item-p`, S.id, i)": read as a Gumbel-max draw with uniform weights whose noise is
    `rand("item-p", S.id, i, v)`, and whose tie hash is `H("tie", "item-p", S.id, i, v)`. Candidates are
    places strictly under the scope; an empty set leaves the item's place unavailable. (decided by the
    coordinator; implemented: `reference/src/summary.ts`)
31. **Summaries: fields, candidate places and canon items. (new)** `mintSummary` mints the node (a
    `minted` change) and pins `kind`, `from`, `length`, `scope` and, if given, `count` as `committed` by
    the given cause, silently, so a summary persists through its pins. Item places are drawn among all
    `core:place`-kind nodes strictly under the scope at any depth (blocks included), cut to
    `summaryPlaceMax` lowest Ids. Making an item canon pins its `time`, `place` and `kind` (silently) with
    the given reason and raises the structural floor of `count` (`max(canon) + 1`). (`reference/src/summary.ts`)

## Records, persistence and knowing

19. **Withdrawn pins and persistence, 6.6, 14.1.** All non-withdrawn pins persist except `game` readings
    nobody retained. A reading is retained when V observes it (an `observed` pin starting at the same
    time) or a persisted record's cause names it. A pin withdrawn before it was ever persisted is history
    and is not written; one already in the chain gets a `PinWithdrawn`. (decided by the coordinator;
    implemented: `reference/src/persistence.ts`)
20. **Persistence by diff, 14.2.** The op log is generated at save time by diffing the live persistable
    state against a mirror of what the chain already holds. This yields exactly the listed op kinds, keeps
    the log append-only, and lets retention-dependent rules (headers, retained readings) work without
    logging at every write. Headers are never removed (there is no `HeaderDropped` op). (decided by the
    coordinator; implemented: `reference/src/persistence.ts`)
39. **What a save holds. (new)** Besides the listed record kinds the save's `meta` carries the world
    seed, the game time, the evolution cursor, function versions (checked on load: a missing function
    gives a read-only load with a plain message), installed packs (id and version), demand roots and
    the demand history (needed for I-15). Contributions persist unless they are `simulation`-layer or
    pack-sourced (origin `pack:<id>`); packs reinstall from the host's registry, and a pack that is gone is
    reported, not stored. Records the chain already holds (an edge, a pin, a contribution) stay in the
    saved view even after they stop being roots, so their end or withdrawal is recorded and a load never
    revives them. (`reference/src/persistence.ts`)
33. **Retention details. (new)** An event's own `core:located-in` edge (cause = the event, not canon) is
    not a root, or no event could ever be forgotten. The Ids named by the ops of an outstanding process
    batch are roots, so the batch can apply after a load. Sweeping drops the in-memory node of every
    unmarked header; a minted unmarked node (nothing can regenerate it) goes entirely, with its owned
    headers, its `simulation` contributions and its own edges, and the revision is bumped because results
    change. Headers of roots, mirrored nodes, owned values and members stay (cheap, and regenerable).
    (`reference/src/retention.ts`)
35. **Pin Ids, withdrawal and the `pin` change. (new)** A pin's Id is a hash of its content unless the
    caller forces one (tests do, to order pins; replays carry the recorded Id), so writing the same fact
    twice is one pin. A pin is withdrawn only by the source that created it (`by` equals its `cause`), and
    only `authored` and `committed` pins can be. The `pin` change carries `old` = the strongest live pin's
    value or region before the write; a withdrawal emits a `pin` change with `new` = the unbounded region
    and reason `withdrawn`. (`reference/src/kernel.ts`)
36. **Readings. (new)** A `reading` change is emitted only if the value differs from the reading in
    effect at that time. An observed pin on a mirrored slot ends at the first reading strictly after its
    start; ends are only set or shortened, never extended, so a retained pin keeps its recorded end after a
    reload. Reconciling with the game after a load writes its readings silently (they set the baseline);
    only later readings can change anything. (`reference/src/store.ts`, `reference/src/kernel.ts`, `reference/src/persistence.ts`)
21. **`knows` and "witnessed", 11.4.** The spec does not say how the kernel knows an observer witnessed a
    subject at `t`. Reading: some event with `time == t` lists the observer in `witnesses` and the
    subject among its participants, effect targets, place, or is the event itself. (decided by the
    coordinator; implemented: `reference/src/beliefs.ts`)
44. **`knows` details. (new)** Step 1 looks for a belief about exactly `at == t`, then one with no `at`.
    An edge path may be written `member-of` or `core:member-of`; the edge's `visibility` must be the
    explicit value `open` to be seen. A mirrored slot is seen only when S1's policy lists its dimension.
    (`reference/src/beliefs.ts`)

## Relevance, frames and groups

22. **Matching.** Bucket predicates are written `<slot>:bucket` (for example `weather:bucket`); `@self` is
    the binding's own Id (so specificity 1.0 "by Id in `where`" can be tested); an empty path or `.` is the
    binding node (for `has-edge`). A selector without `slot` is `'*'`. Specificity is the highest that
    applies. The receiving frame, not the declaring frame, is the `frame` of an emission, and dedup is per
    (change, receiving frame, interest type). (decided by the coordinator; implemented:
    `reference/src/predicate.ts`, `reference/src/relevance.ts`)
23. **Emission order, 10.5.** "Order of actor (demand roots first), then frame Id": sort key is (not a
    demand root, actor Id, frame Id, interest type, interest index). (decided by the coordinator;
    implemented)
24. **Dilemma frames.** `frameA` is the frame carrying the effect, `frameB` the frame whose interest it
    violates. "Until either frame changes" is tracked with a per-frame version counter. Obligations on a
    membership trigger a check but are not themselves scanned as interests. (decided by the coordinator;
    implemented: `reference/src/frames.ts`)
25. **Group frames.** Frames of level `concern` or `goal` on a group actor change only through `decide`
    (attributed to a leader). A parent link from a member's frame to a group concern frame as its *child*
    is refused. Concerns without a family attach to every active situation frame of the member. (decided
    by the coordinator; implemented: `reference/src/groups.ts`)
32. **Membership inheritance details. (new)** A membership edge that states no `strength` counts as full
    strength. Inherited parent links are marked `via: 'membership'` on the frame's `parents` entry (an
    optional field added to the spec's `{ frame, weight }`), so a re-sync can replace them. Only a
    member's `drive` and `concern` frames inherit by family (the group concern frame must be `active`);
    famless group concerns attach to the member's `situation` frames. An order's goal frame has
    `weight = 1`, parent = the group's goal frame at weight `pressure`, and origin = that group goal frame's
    Id. (`reference/src/groups.ts`)
40. **Specificity fallback and over-matching. (new)** A selector that names no node by Id, no kind and no
    bucket predicate gets the lowest class (`specificity.bucket`, 0.3). A contribution change whose target
    names no nodes matches an interest when their kinds are related (either extends the other), their
    slots agree (or one is `*`) and any named scope nodes intersect, which can over-match, as the spec
    allows. (`reference/src/relevance.ts`)
42. **Dilemma scan. (new)** For each effect target of frame A's goal, B ranges over the actor's other
    eligible frames of a different origin, and B counts the interests of B's own and of its eligible
    ancestors (so an inherited `protects` still binds). A goal effect `on` that is a selector names its
    targets only through `scope.nodes`. The check runs in the frame worklist, after a goal frame opens, an
    interest set changes, or a membership edge is added, changed or ended. (`reference/src/frames.ts`)
47. **Demand and fine tiers. (new)** "Demand reaches tier T" is judged from a recorded history of
    intervals (maintained whenever frames change status or focus), not from the frames in force when the
    tick runs, so a fine-tier process runs at exactly the boundaries demand covered and never catches up,
    however ticks fall (I-15). A node's demand tier is the highest focus tier of eligible frames focusing
    on it or its owner chain; its claim is the sum of `pull * w_actor` over those frames. (`reference/src/frames.ts`,
    `reference/src/evolution.ts`)

## Work, evolution and queries

26. **Budget overshoot, 10.7.** The first step of a tick is always taken, so an atomic item (a process
    run, one swept node) can overshoot the budget by its own cost. Interest scans are per-interest and
    never overshoot. (decided by the coordinator; implemented: `reference/src/work.ts`)
37. **Cache-independent limits. (new)** A cached resolution, candidate set or item descriptor charges the
    shared allowance the cost it recorded when it was computed, and its dependency height counts against
    the depth limit, so whether an outer operation returns `failed` never depends on what happened to be
    cached. A `cycle` result is never cached. (`reference/src/resolve.ts`, `reference/src/query.ts`, `reference/src/summary.ts`)
41. **Refused and late operations. (new)** An operation the kernel refuses while applying a process batch
    or an external operation (for example a pin on V's drives) is recorded as an `op-refused` defect and
    skipped, so a tick never stalls. An external operation stamped before the window that just ended is
    applied at the next boundary and recorded as a `late-op` defect. (`reference/src/evolution.ts`)
45. **Query traversal. (new)** The children of a node in a query are the nodes with a valid
    `core:located-in` edge to it plus its known owned values and members. With every compound region
    answering `maybe` the bounds of all frontier entries are equal, so the early stop for `limit n` (spec
    8.3 step 7) is correct but never fires; the result is the same as a full traversal. Summary items are
    found through their descriptors, not through the tree. Region scopes scan the known nodes of the kind.
    (`reference/src/query.ts`)
48. **Boundaries. (new)** Boundary indices start at 0; the run started at boundary `b` by a process of
    period `n` applies at boundary `b + n`. The cursor persists with the save. When a budget stops a
    catch-up the engine time rests at the last boundary processed. (`reference/src/evolution.ts`)

## Guards, tooling and presentation

43. **I-12 is enforced. (new)** A pin, or a contribution naming a node, on V's `drives` slots or on any
    node owned under them is refused. V's frames are not drives and may be opened. (`reference/src/kernel.ts`)
49. **Candidate queries are checked at load. (new)** A `ref` dimension's candidate `must` predicates may
    not read, in their first path segment, a ref slot or a temporal slot of the `find` kind (spec 2.3).
    (`reference/src/schema.ts`)
50. **Hooks and open/close. (new)** `onTick(believer)` runs for every believer after each processed
    boundary as a budgeted worklist; `onWitness` and `onSocial` run from `observe` and `tell`. `open`
    marks a slot open (a many slot resolves its count first) and `close` drops a node's caches and its
    unretained owned values' caches. (`reference/src/beliefs.ts`, `reference/src/kernel.ts`)
30. **Event minting emits one change. (new)** `mintEvent` writes the event's contributions, its
    `core:located-in` edge (cause = the event) and, for a canon declaration, its pins silently, and emits
    a single `event` change (not also `minted`, `contribution`, `edge` or `pin`), so one event never counts
    as several. (`reference/src/events.ts`)
51. **Pack and port seams. (new)** Content packs are installed through `Persistence.installPack` and the
    game through the `GamePort` given to `load`; both are small stand-ins for S4 and S5. (`reference/src/persistence.ts`)
28. **`explain`, 13.** "Top k by signed discriminating effect" is read as the k largest by absolute
    effect, shown with their sign; the prior is included as an entry. (decided by the coordinator;
    implemented: `reference/src/provenance.ts`)
29. **Trace.** Includes every feasible value's score and noise (not only the winner and runner-up) so F-5
    can be checked from it. (decided by the coordinator; implemented: `reference/src/resolve.ts`)

## Cross-implementation check

The **determinism digest** is frozen in `test/digest.test.ts`. A fixed script of 1,000 mixed operations
(`test/synthetic.ts`, script `script-1`, world seed `H("fixture", "digest")`) runs against a small
synthetic schema merged with the core schema; every resolved value, trace score, query result and
relevance emission folds into one BLAKE3 chain. It also freezes primitive vectors for `H`, `toUnit`,
`rand` and fdlibm `ln`. The golden digest is `00796d399c46bee565b64ca1f03323ae` over 2,194 entries, and the
run ends at revision 1,344 with 408 pins and 338 contributions. A native core that agrees on the
vectors and the digest agrees on the kernel.
