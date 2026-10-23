# Spec notes for the reference model

Interpretations made while building the TypeScript reference model of S0 (v3, then the v4 core) and of the
core of S2 v1.7 (`research/story-engine/spec/kernel.md` v4.12, `seeding.md`). Each entry gives the section, the issue, the reading chosen and
why. The coordinator decides afterwards and updates the spec.

**Status.** The coordinator has decided entries 1 to 29: entries 1 to 4 and 6 to 29 are accepted as
written (marked "decided by the coordinator"), and entry 5 was changed (marked "changed by the
coordinator"). Entries 30 to 51 are **new** since those decisions: interpretations the later modules
needed, each the most faithful reading found. Entries 52 to 57 are **new** since the independent review
of the reference model (findings SR-01 to SR-14, fixed): readings that the fixes needed. Entries 31, 33,
37, 39, 42 and 50 were amended by the same review and say so. A second review (SR2-01 to SR2-08, fixed)
found that entries 54 to 57 claimed more than the code guaranteed; entries 33, 53, 54, 55, 56 and 57
now state exactly what the code does, including what it leaves alone. Entries 58 to 92 are **new** from the v4 and layer 2 build and its fix round (the last section, with its findings for the
coordinator). Entry numbers are stable so messages and
reviews can point at them; the sections below order them worst first, meaning the entries that change
observable results come before presentation choices.

**Reading order, worst first:** 5, 6, 7, 34, 38, 52, 9, 10, 46, 1, 2, 3, 4, 8, 11, 12, 13, 14, 15, 16, 17,
18, 27 (results); 19, 20, 39, 33, 35, 36, 55, 21, 44 (records, persistence and knowing); 22, 57, 23, 24,
25, 32, 40, 42, 47, 56 (relevance, frames and groups); 26, 37, 53, 54, 41, 45, 48 (work and evolution);
43, 49, 50, 51, 28, 29, 30, 31 (guards, tooling and presentation).

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
52. **Canonical record encoding. (new)** Every identity, cache key and equality test that reads a
    plain-data record (a contribution's target, form and validity; a pin's region; an edge's attributes; a
    frame's payload and parents; a belief's value and source; an external operation; a persisted record)
    uses one encoding, so incidental object construction order never reaches a kernel decision. Each item
    is a one-byte tag and its bytes: `0x00` null; `0x01` false; `0x02` true; `0x03` an integer, meaning a
    finite number with no fractional part and magnitude below 2^63, as i64 little-endian; `0x04` any other
    finite number as binary64 little-endian (negative zero is the integer 0; NaN and infinities are
    refused); `0x05` a string as a u32 little-endian byte length and its UTF-8; `0x06` an array as a u32
    count and its items in order; `0x07` a record as a u32 count of its entries whose value is not
    `undefined`, sorted by the bytewise order of their UTF-8 keys, each entry being the key (u32 length and
    bytes, no tag) and then the value's item. Array order is part of the record: a writer who means a set
    sorts it first, as `setRegion` does. A generated Id passes the whole encoding to `H` as one `val`
    argument (tag `0x06` before, `0x00` after, as for a value). Hashing `JSON.stringify` text carried the
    property order of the object literal: reordering `{ f: 'const', value: 'a' }` changed a contribution's
    Id and with it which equal-precedence constraint arbitration applied first. (`reference/src/canon.ts`)
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
    `core:place`-kind nodes strictly under the scope at any depth (blocks included); the scope itself is
    left out before the cut to the `summaryPlaceMax` lowest Ids, not after it. Making an item canon pins its `time`, `place` and `kind` (silently) with
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
    seed, the game time, the evolution cursor, function versions (the schema's, the effect conflict table
    in force, and every function used by the forms of the persisted contributions, nested `rule` forms
    included, and by the operations of outstanding process batches; checked on load: a missing function
    gives a read-only load with a plain message, entry 55), installed packs (id and version), demand roots and
    the demand history (needed for I-15). Contributions persist unless they are `simulation`-layer or
    pack-sourced (origin `pack:<id>`); packs reinstall from the host's registry, and a pack that is gone is
    reported, not stored. Records the chain already holds (an edge, a pin, a contribution) stay in the
    saved view even after they stop being roots, so their end or withdrawal is recorded and a load never
    revives them. (`reference/src/persistence.ts`)
33. **Retention details. (new)** An event's own `core:located-in` edge (cause = the event, not canon) is
    not a root, or no event could ever be forgotten. The Ids named by the ops of an outstanding process
    batch are roots, so the batch can apply after a load: every Id among the operation's values, `root:<name>`
    strings expanded, and the Id keys of the `weights` of a `table` form wherever the form sits (nested in a
    `rule` too), since a ref-valued slot's table is keyed by the Ids it weighs and those keys are the only
    place a node may be named. Other record keys are not read. A root frame's Id fields include every Id its
    interests name (`scope.nodes`, `scope.under`, the arguments of `where` predicates and the targets of
    `has-edge` tests, with `root:<name>` expanded) as well as its links, focus and goal targets, so a node
    named only by an interest survives a save and a load. Sweeping drops the in-memory node of every
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
55. **A read-only world does not change. (new)** When a save loads read-only (spec 14.4) the writes that
    change a recorded fact are refused with the plain message, each before it touches any state:
    pins and their withdrawal, readings, contributions and their ending, edges, their ending and their
    update, minting (a node, an event, a summary), event canon and summary item canon, beliefs (set and
    drop, so observing and telling too), frames (open, status, weight, interests, focus, parents, so group
    decisions and orders too), seeds and streaming, content packs (empty or not: neither pack map changes),
    saves and `tick` (which would apply, refuse and discard the outstanding process batches); `submit`
    answers "not accepted". Reads, traces and queries keep working. The cursor, the outstanding batches and
    the queue stay exactly as loaded, and loading another save lifts the restriction. **Not guarded**, because
    they record no fact the save holds: registering a root or mirrored node header (`root`, `mirrored`),
    cache population (`address`, `mintSilent`, `open`, `close`, and resolution itself), registering a process
    definition, and direct access to the stores and sets the kernel exposes (`k.store`, `k.frames.demandRoots`).
    (`Kernel.assertWritable`, which each guarded write calls first, in `reference/src/kernel.ts`,
    `reference/src/frames.ts`, `reference/src/beliefs.ts`, `reference/src/events.ts`, `reference/src/summary.ts`,
    `reference/src/retention.ts` and `reference/src/persistence.ts`)
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
    targets only through `scope.nodes`. The check runs in the frame worklist for every goal of the actor of a
    frame, and of the actor of each of its descendants, whenever the frame opens, changes status (entering
    or leaving the interest set), changes its parents or changes its interests, so an interest added after a
    goal exists, or inherited from a group concern, is found; and for a member after its membership edge is
    added, changed, ended or crosses its validity (entry 56). A pair is emitted once until either frame
    changes. (`reference/src/frames.ts`)
47. **Demand and fine tiers. (new)** "Demand reaches tier T" is judged from a recorded history of
    intervals (maintained whenever frames change status or focus), not from the frames in force when the
    tick runs, so a fine-tier process runs at exactly the boundaries demand covered and never catches up,
    however ticks fall (I-15). A node's demand tier is the highest focus tier of eligible frames focusing
    on it or its owner chain; its claim is the sum of `pull * w_actor` over those frames. (`reference/src/frames.ts`,
    `reference/src/evolution.ts`)

56. **Boundaries are processed one at a time, with their consequences. (new)** Amends 48 and 50. The tick
    takes boundaries in order, and the work a boundary leaves runs in three phases, in this order, before
    the next boundary starts: (1) the frame worklist (inheritance re-syncs, pull, dilemma checks) and
    relevance dispatch, until both are empty; (2) the belief hooks; (3) the frame worklist and dispatch
    again, for whatever the hooks wrote. A budget that runs out stops inside a phase and the next tick
    resumes that phase, so whatever the budget, hooks never start while frame work or dispatch is pending,
    and once a boundary's hooks have begun they all finish before any frame or dispatch work starts again:
    what a hook sees, and what a later hook of the same boundary sees of an earlier hook's writes, does not
    depend on the budget or on where ticks fall. Writes the caller makes between ticks are the caller's own
    input and take their place in call order (their frame work and dispatch run first, unless hooks are
    underway, in which case they wait for the hooks). The first boundary of a call is always taken; a budget
    that runs out stops the advance between boundaries. (a) *Belief hooks.* Every processed boundary queues
    `onTick(believer, at)` for every believer, `at` being the boundary's time, in believer Id order; none
    merges with another. (b) *Validity crossings.* A membership edge whose validity starts or ends in (the
    last time handled, T] changes which group concerns its member inherits. `Groups.crossTo(T)` runs at
    every processed boundary and when an advance ends, and queues the member's re-sync and a recheck of its
    goals in the frame worklist; the sync reads the memberships in force at the engine time when the
    worklist runs, which for a boundary's own work is the boundary's time. (c) *Loading.* A load restores
    the clock to the save's time and puts the frames back as saved; an expired membership is not saved, so
    every actor with a frame or a membership re-syncs, and that work is run to its end at once, with the
    clock at the **saved** time, before the game's time is adopted. The catch-up then crosses each later
    validity change at its own boundary, as an uninterrupted advance would. A tick that ends between
    boundaries observes the crossings up to its end, so identical transient emissions however ticks fall
    hold for ticks that end on boundaries (the engine's own cadence); the frames after any partition are
    the same. (`reference/src/kernel.ts` `tick`, `reference/src/evolution.ts`, `reference/src/groups.ts`,
    `reference/src/beliefs.ts`, `reference/src/persistence.ts`)
57. **Matching reads the change's own value. (new)** Spec 10.5 evaluates `where` predicates "on new values
    (on old values for ended edges and removals)". A `pin` or `reading` change carries the value of the
    slot it changed, so a predicate's read of that one slot of the changed node gives the change's new
    value, or its old value for a withdrawn pin, at the change's time; every other slot, and every change
    without a single value for a slot (a region, a contribution, an event, a minted node), is read from the
    world at the change's time as before. A pin on window `k` of a simulated temporal slot names its slot
    `path@w<k>` (entry 34). A selector names the slot by its path, so an interest in `weather` matches a
    change to `weather@w<k>` (as `'*'` does), and a read of `weather` is the changed slot only when its time
    falls in window `k`, that is `floor(t / window) = k` for the read's time `t`, which for a queued change
    is the time it was made; a read that names the window (`weather@w<k>`) is the changed slot by its key.
    A read of any other window of the slot gets the world's value for that window, so a pin on a later
    window, made earlier, does not change what the matcher reads now. An ended edge is still counted
    present. (`reference/src/relevance.ts`, `reference/src/predicate.ts` `selectorMatches`,
    `reference/src/resolve.ts` `makeEnv`)

## Work, evolution and queries

26. **Budget overshoot, 10.7.** The first step of a tick is always taken, so an atomic item (a process
    run, one swept node) can overshoot the budget by its own cost. Interest scans are per-interest and
    never overshoot. (decided by the coordinator; implemented: `reference/src/work.ts`)
37. **Cache-independent limits. (new)** A cached resolution, candidate set or item descriptor charges the
    shared allowance the cost it recorded when it was computed, and its dependency height counts against
    the depth limit, so whether an outer operation returns `failed` never depends on what happened to be
    cached; candidate sets and item descriptors record and replay both exactly as resolutions do. A `cycle` result is never cached. (`reference/src/resolve.ts`, `reference/src/query.ts`, `reference/src/summary.ts`)
53. **Caches are valid for a revision and an engine time. (new)** Spec 5.5 makes a cache entry valid for
    the same revision and `t`. Retention, and through it the structural constraints of 6.5, reads the engine
    time, which moves without a write (a temporal pin lapses, a live edge ends), so the resolver, candidate
    set, item descriptor and retention caches are valid only for the same revision and the same engine
    time. The outstanding process batches are retention roots (entry 33), so a change to them changes the
    revision like a write does: queuing a batch bumps it, once per process run (at boundary 0 the engine time
    does not move either, so nothing else would invalidate the caches), and applying due batches bumps it once
    per boundary that applied any. Loading bumps it as before. (`reference/src/resolve.ts`, `reference/src/query.ts`,
    `reference/src/summary.ts`, `reference/src/retention.ts`, `reference/src/evolution.ts`)
54. **A nested failure fails the outer operation. (new)** A nested resolution that returns `failed` (a
    limit, a domain over `N_enum`, a bad weight) fails the outer query or resolution that reads it, with a
    defect, instead of reading as a missing value (spec 8.4, 10.7). Where the code does this, by throwing
    `NestedFailure` from `failIfFailed`: the last segment of a predicate path, the `position` read of a region
    scope or a query's spatial test, the inputs of a `derive` form, the base of a `field` form, the count
    that a member address needs when a predicate or `child` follows the address, and the summary reads (the
    descriptor's `from`, `length` and `scope`, an item's `kind`, and the `scope`, `count` and `position`
    reads of the item scan). Where it propagates the status instead: a derived slot, an `enum-by` slot's
    `by` and the member count of a resolution that addresses a member take the worse status of what they
    read, and a `conditioned` prior whose input has no value makes the slot `failed`. The accessors that
    are outer operations themselves read a failed slot as absent, as `Kernel.value` always has: belief
    `knows` and `witnessed`, `eventsAtTime`, the field reads of `makeCanon` and `makeItemCanon` (a field that
    did not resolve is left unpinned), and the background materialisation worklist (a failed count queues no
    items). `unavailable` stays an ordinary missing value: the predicate does
    not hold. `cycle` keeps its own status and defect. (`reference/src/work.ts` `NestedFailure`,
    `reference/src/predicate.ts`, `reference/src/resolve.ts`, `reference/src/summary.ts`, `reference/src/query.ts`)
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
    catch-up the engine time rests at the last boundary processed. (`reference/src/evolution.ts`) New batches are published only after every process starting at that boundary has read the boundary snapshot, then the revision moves once (SR3-01; spec 9.4's shared snapshot).

## Guards, tooling and presentation

43. **I-12 is enforced. (new)** A pin, or a contribution naming a node, on V's `drives` slots or on any
    node owned under them is refused. V's frames are not drives and may be opened. (`reference/src/kernel.ts`)
49. **Candidate queries are checked at load. (new)** A `ref` dimension's candidate `must` predicates may
    not read, in their first path segment, a ref slot or a temporal slot of the `find` kind (spec 2.3).
    (`reference/src/schema.ts`)
50. **Hooks and open/close. (new)** `onTick(believer, at)` runs for every believer once per processed
    boundary, in boundary order, with the boundary's time, as a budgeted worklist (entry 56); `onWitness` and `onSocial` run from `observe` and `tell`. `open`
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
(`test/synthetic.ts`, script `script-1`, world seed `H("fixture", "digest")`, snapshots every 40 ops, a
pack `demo@1.0.0`, two processes) runs against a small synthetic schema merged with the core schema. It
folds into one BLAKE3 chain:

- every resolved value, trace score, query result, relevance emission and dilemma;
- every belief outcome (set, observe, tell with its evidence, knows) and every summary item and canon item;
- the whole frame each group decision left (11 decisions in the frozen run: concerns, goals, and changes
  of interests, weight and status), each order issued (3), the frames and every frame's pull after each
  crew step, and the dilemmas that follow;
- the whole of every saved record (ops, snapshot, metadata, parent), the persisted state after every load, the
  outstanding process batches a load brings back, the refusal of an operation queued in an earlier epoch, and
  at the end every record of the chain, so branches count.

The frozen run makes 16 saves (10 of them snapshots, with 3 points where a save has more than one child)
and 17 replacement loads of earlier saves, some with a game port. It also covers external operations applied at
boundaries, seeds, sweeps and the two process kinds (a tier-0 mood process and a tier-1 maker of events,
contributions and edges whose batches wait across ticks and loads). The test also checks that the digest
moves when a save, a load, belief state, summary canon, outstanding batches or dilemma checking changes
(SR-14), and when a group decision's weight, status or interests or an order's pressure changes directly
(SR2-08), so these cannot drift unnoticed. It freezes primitive vectors for `H`, `toUnit`, `rand` and fdlibm `ln`.

The golden digest is `d534e0dcef3f85d27cefa552217152ec` over 1,067 entries, and the run ends at revision
2,057 with 135 pins and 51 contributions. It replaces `c896b062fda81bacfbb6d84563a2c77d` (1,053 entries,
revision 1,956, the same 135 pins and 51 contributions), which hashed a group decision only through the
emissions and counts that followed it: replacing the weight decision with weight zero left it unchanged
(SR2-08). The script now hashes each decision's resulting frame and each order whole (14 more entries). The
revision moved from 1,956 to 2,069 because queuing and applying a process batch now bump it (entry 53), and then to 2,057 once the batches started at one boundary are published together, after every starting process has read the snapshot (SR3-01; one bump per boundary instead of one per process); the
revision is not hashed, and the fixes of SR2-01 to SR2-07 changed no other result the script exercises. That
digest in turn replaced `00796d399c46bee565b64ca1f03323ae` (2,194 entries, revision 1,344, 408 pins, 338
contributions) of the first version of the script, whose results changed for two reasons: identities are
hashed canonically (entry 52; with the old script alone the digest became `431d3e8a5309a7df066865689748123c`
over the same 2,194 entries), and the script now covers persistence and the subsystems above.

A native core that agrees on the vectors and the digest agrees on the kernel for what the script exercises.
**Not covered by the digest**, and so to be checked by the fixtures, invariants and unit tests: read-only
loads and missing functions; missing packs; processes in the fine tiers (3 to 5) and demand-driven running;
`explain`; `open`, `close` and streaming; region and `roots` scopes in queries and spatial `position` reads;
contribution ends (`ContributionEnded`) and `updateEdge`; external operations other than readings; the
belief policy hooks `onSocial` and `aggregate` (the stub policy is in force); ticks resumed under a small
budget (the script's ticks use the default one); relevance matching of changes to windows of simulated
temporal slots; a load whose game time is several boundaries ahead of the save; and every failure and
refusal defect. The unit tests of `test/sr2.test.ts` cover the resumed ticks, the catch-up after a load and the
temporal matching.

## Kernel v4 core and layer 2 core (entries 58 onward)

These entries come from building the S0 v4 core (section 20) and the S2 core (section 0.3) in a second,
independent run, and from fix round 1 after its independent review (findings L2-01 to L2-17), which moved
the layer to S2 v1.7 and S0 v4.12. Numbers continue after 57. They are ordered worst first: the readings that
change observable behaviour or a frozen digest come before the ones that only fill a gap. The block headed
**Spec findings for the coordinator** at the end lists the ones that most need a decision.

58. **The v4 changes move the frozen v3 digest; both are switchable. S0 v4.12 now says so.** The `frame` change
    (V4-4) adds two emissions to the v3 run, and the v4 schema (V4-2, V4-3, V4-22) changes function versions and
    so the schema hash. The frozen v3 digest `d534e0dcef3f85d27cefa552217152ec` therefore runs with
    `frameChanges: false` and `coreDefs({ v4: false })`, and is unchanged: S0 v4.12 section 20 defines the digest
    on the v3 schema with frame changes off. A second frozen digest, `da48cabc405ed361ce6ad5f3b895a822` over 1,069
    entries, covers the same script with both on (`test/digest-v4.test.ts`); a native core must reproduce both. The
    defaults of the kernel are v4 on. Fix round 1 changed neither digest: the change payload snapshot (L2-01), the
    operation Id without the epoch (L2-04) and the captured focus (L2-13) moved no result the script exercises.
59. **A ladder ends when an exit beat has been played, and T12 reads `unattended` as well. S2 v1.6 and v1.7
    settle the first half.** Only the exit beats write `exit` (through `leaves`, when they complete), so the
    expansion's `end` is A.4's `any[top rung done, exit > 0]` and waits for the exit's content. What SF-7 then
    asks for, "T12 with closure status `resolved` and `witnessed` true" after a decline, needs T12 to fire from
    `unattended`, because T10 (a decline) puts the seed there and T12's row says `running`. The reference fires T12
    from `running` and from `unattended`, in table order before T13. **This needs a ruling** (see the findings
    block). The variant that ignores every offer ends by T13 with `abandoned`: with `reoffers: 0` the first offer's
    lapse is T10, and the plan settles it.
60. **The attempt bound counts offers only, and a pull lifts it. In-scene offers are exempt (S2 v1.7).** S2 8.5
    bounds attempts per logical offer across channels and reloads. Replies and beats are not offers and do not count.
    When the bound is reached the delivery is `expired` ("waits for pull") and the offer is `stopped` until V pulls (a
    recap or a deliberate approach), which lifts it. The bound is checked at candidate selection as well as at release,
    or a fifth push could be queued (SF-62). A request that expires unreleased (a busy UI throughout its `maxWait`) is
    a timeout and counts as an attempt; its retry takes the place of the expired delivery under the same id, so there is
    one delivery object per id (review R-4, R-8). An in-scene offer is not a push: it is not stopped by the bound, and
    its retry keeps its `inScene` mark.
61. **In-scene offers (S2 v1.7).** An offer inside a scene V is already in is released at the beat's moment: the busy-UI,
    attention, spacing, cap, category and session gates do not apply, and neither does the tempo-off filter (it is not
    a push). Display grades, receipts and the joint latch still apply, and it follows the response lifecycle. It is not
    counted towards the attempt bound. The scene it follows must be running: when the beat it follows becomes final
    before the offer is released or answered, the offer is dropped with `why: the scene ended`, whether it is queued,
    released or displayed, and its beat is skipped as `rejected` (`dropEndedScenes`, run at every re-evaluation and
    every arbiter step). L-131a is static: the offer's fragment and the fragment of the beat it links `because` carry
    the same `scene` label (S2 v1.7 `Fragment.scene`). The earlier wording of this note, which said the gates were
    "pacing, attention and region" and that the offer kept the attempt bound, was wrong about both.
62. **A seed fact counts as changeable only if something writes it (`writtenFacts`). (new)** `writtenFacts` and
    `canChange` serve the run-time beat analysis (a `never` link, the stuck check): a seed fact nothing writes is a
    constant there. The lint does not use it. (The earlier wording said it did; L-05 reads `consumers`, and L-06 reads
    consequences, note 80.)
63. **The fit report casts first and ignores the live instance's own claim. (new)** S2's fit report builds a
    throwaway instance. It casts before windows are computed (a template that cannot cast reports `waits`, not a
    window), and a live instance of the same template is not counted as a claimant against the throwaway one. Its
    decline preview names the exit beat's content when the decline has none of its own.
64. **Offer identity counts offer and beat deliveries only. (new)** The id of an offer hashes the number of
    earlier releases of that offer. Reply deliveries are another kind and must not shift an offer's identity, or
    the same offer would get a new id after V answers (SF-64). `missed` ignores replies for the same reason.
65. **A hard prepare failure re-evaluates the seed at once. (new)** S2 8.4: if prepare finds a hard condition no
    longer holds, the delivery is dropped and the seed queued for re-evaluation in the same pass (SF-23), not at
    the next change that happens to touch it.
66. **Content gates run before prepare, at release. (new)** A delivery whose fragment is above a content ceiling
    in force at release is `expired` ("above the content ceiling") and its beat omitted (SF-51); a delivery
    whose content is missing from the pack (and has no implied form) is `expired` ("missing-content"). Both
    happen before prepare, which would otherwise stage and discard a batch for a result already known.
67. **Predicate text extensions. (new)** The grammar of S2 2.6 leaves open: `all()` and `any()` for an empty or
    one-member group, the other role operators (`in {..}`, `not in {..}`, `in [a, b]`, `has-edge(..)`), `@role`
    as an argument, durations `<seconds>g` (game time) and `<seconds>p` (play time), and generic `{key: value}`
    patterns. The printer and parser round-trip every form (tested with generated predicates).
68. **`since` for a beat is its last move into a final or deferred state; a duration runs on its own clock.** `finalAt` and
    `finalAtPlay` are written each time a beat becomes `done`, `skipped`, `failed` or `deferred`, and a state's entry writes
    `entered` and `enteredPlay`. `since(x) >= <n>g` compares the game time **read at the last window boundary** (S2 4.3:
    a game-clock duration is checked at window boundaries only, so a result never depends on where the host's ticks
    fell) with the game stamp; `<n>p` compares the cumulative play time (`playTotal`) with the play stamp. A beat or
    state never entered has no stamp, and `since` is `no`. The same two clocks serve a timed `wait` step of a casting
    ladder, the unattended plan's `after`, an aftermath's delay and a game-clock `maxWait`. A game-time wake-up is
    rounded up to the boundary that ends the window it falls due in; a play-time wake-up is checked by the arbiter's step
    (L2-08).
69. **Layer 2 state loads in a fixed order and starts a new session. (new)** `onLoad` rebuilds instances from
    the kernel's `SeedRecord` roots and layer 2's global record, resets deliveries, reinstalls each seed's
    contributions with origin `pack:seed/<id>`, and starts a new arbiter in `settling` (S2 8.6). Play-clock
    stamps are relative to the session (`playBase`, `baseTotal`) so a save means the same in the next session. A
    save flushes layer 2 first (`layer2.flush()`), so the file holds the committed state. A load that is read-only
    (a function the save needs is gone) rebuilds the instance table and the arbiter for reading and writes nothing:
    no root, watcher, contribution, withdrawal, maintenance or lifecycle write (L2-12). A play-clock duration that was
    running restarts from the load (S2 2.12): a play-clock `since` stamp that has not yet elapsed, a timed `wait`, an
    unattended plan and an aftermath on the play clock restart from the load's cumulative play time; a duration
    that had already passed stays passed. The state and beat stamps are history and are never rewritten: a restart is
    recorded for that one duration (`playRestarts`), so two durations on one stamp, one passed and one running, stay
    apart (R2-02). A game-clock offer lapse is kept (`lapseGameAt`), not restarted.
70. **A staged batch is a snapshot and a restore, with one shared allowance. (new)** V4-26 allows it. The batch holds the
    revision and captures of the store, frames, beliefs, events and groups; `discard` restores all of them and
    invalidates the query, summary, resolution and retention caches. A write outside the batch while it is open is
    refused with a plain error, and `Persistence.load` and `Persistence.save` are refused with a batch open (a save from
    inside the batch's own write callback too: its operations are not persisted). Discard also restores the settings log,
    the seed table, streaming and the summaries' canon sets (review R-1, R-2). A change is a snapshot of what happened:
    `emit` copies the payload, so a staged write that is discarded, or a later write, cannot alter a notification that was
    already queued (L2-01). A batch whose reads ran out of the allowance is never committed: the release that staged it fails
    softly and the batch is discarded, since a check that ran out proved nothing (R2-01). Every read made through a batch (`resolve`, `value`, `trace`, `query`) draws on **one**
    allowance, S0 14.2a's "shared work allowance", not a fresh one each; the batch exposes what it has used. The spec does
    not say what a failing commit does; the reference has none, so the failure path is a discard.
71. **Redaction scrubs settings content and the director's beliefs about V; a new v4 lineage records its initial
    settings. (new)** V4-21 says sensitive material is dropped by default from an export. `redactSensitive` removes
    `BeliefSet` ops whose believer is the director and subject is V and replaces a `SettingsSet` content block with a
    `redacted` preset with empty ceilings; the same for a snapshot. `PersistedView.settings` is omitted when empty so v3
    records are byte identical. S0 14.2 says the lineage root records the initial settings: a kernel that has layer 2
    attached while its lineage is still empty (no save, no log) writes them, at the time of attachment. An empty log in a
    v3 save stays as it is, and loading it into a world with layer 2 keeps it empty. The frozen v4 digest has no layer 2,
    so it records none.
72. **Reply selection and attribution. (new)** S2 8.8 says an NPC's template reply can correct a telling. The
    templates offered with a delivery are chosen at release (`selectResponses`): those whose `needs` holds and
    whose `to` pattern matches a confirmed event V has acted on. A template whose `to` is a **response kind**
    (`decline:<id>`, `action:<id>`, `decline:*`, `action:*`, `any`; S2 v1.6 section 2.9) is chosen when V answers, and
    the `response` record entry lists it. V using one (`reply`) writes an observed telling (an event with V and the NPC
    as witnesses) and sets the NPC's belief from V's own words, so the belief really revises and the line no longer
    applies (SF-25, SF-36).
73. **Effects by persistence class. (new)** A seed-fact write rewrites the single pin it owns; maintenance
    writes go through a queue that a reset empties; cosmetic marks live on the instance and are never read by a
    predicate. The accept, decline and not-now crash-point sweeps show a reset at any point leaves no partial
    state. The class of a seed-fact write is the effect's own `persist`, then the fact's (`SeedFactDecl.persist`), then
    `lasting` for a fact with a `route` and `resettable` for any other (S2 v1.6 2.5). An `authoredOnly` fact (a ladder
    boundary) is always lasting, is written by authored seeds only, and only rises: a write that would lower it is refused
    with a record entry (Appendix A.2 step 6, L2-11).
74. **The fit hook is clamped and recorded raw and clamped, in every draw. (new)** The `fit` hook sees the choice id, the
    option and the instance only. Its weight is clamped to plus or minus `fitCap` before it enters the Gumbel-max draw
    as a bonus (S2 3.4), and the trace records both. The draw is `rand("seed-draw", ...)` with `H("tie", ...)` for
    exact ties. The mode and variant draws and the draws among alternates keep `raw` and `clamped` beside the value and
    attempt, as the casting draw does.

75. **T9 to T11 answer to the offer that committed the seed, by id. (new)** The state `offered` alone does not
    say which delivery is the first offer: an in-scene follow-up answered while the first offer is open would
    fire T9. The instance records `firstOffer` (the delivery id released at T7) and T9 to T11 apply only to an
    answer, lapse or miss of that delivery (review R-5).
76. **Reverse invalidation is by kind, for instances and for sowing. (new)** S2 4.1 asks that readers of settings and of
    other seeds be re-evaluated when those change. The reference tags each instance with what it reads beyond its own
    state (a `setting` atom or a fragment with content tags; a `seed` atom; an `exposed` atom) and queues the readers
    when a setting is set (seen at the next layer-2 step), when any seed changes state, and when a display report
    changes the exposure ledger. The tags derive from the stored document, so nothing needs rebuilding at a load, which
    queues every instance anyway (review R-6). A pack's sowing predicates are tagged the same way (`sowReads`): the
    pack is queued for sowing when one of those changes, and at each boundary for an `hour` atom. The sowing watcher and
    an instance's watch frame share one dependency collection (`addPredInterests`): a guarded fact also waits on the
    facts its `decidedBy` reads, and a `decided` test waits on its guard (L2-09).
77. **Migration applies at load as well as at install. (new)** A pack installed before a load may carry
    `migrate: withdraw` for the saved version; `onLoad` applies it before the instance is reinstalled (T1). A
    game-clock duration is not restarted by a load: `submittedGame` is kept (clamped to the world's time),
    while play-clock stamps restart (review R-9, R-10).
78. **Answering is confirmation. (new)** An answer to an offer that is released but not yet reported displayed
    first processes a `confirmed` display report, so the offer event, the grade and the receipt exist before the
    response event that cites them (review R-11). A receipt is stamped with the time its retained grade was reached:
    raising the grade restamps `at` and `playTotal`, and a repeat report of a grade already held does not (L2-14).
79. **Cosmetic effects write no pin; replies and closing deliveries outlive a seed's pending requests. (new)** S2
    2.5: a cosmetic effect is the canon event and its carrier and no pin, so a predicate cannot read it back. A
    `reply` (a retract's `retractQuietly`, a lapse's line) is not cancelled when the seed ends, as a closing
    delivery is not; closing deliveries are retired, with the references their job held, when shown or at
    `closeExpiry` (review R-13 to R-15).
80. **L-06 reads consequences (S2 v1.6 2.9).** Every action of a consequential choice needs a consequence something reads: a
    write to a seed fact with a consumer, or a link whose `on` reads the response with `action:<id>` (a bare `action`
    or `action:*` reads every action, so it counts as a consequence but tells none apart). No two actions may have the
    same consequence: their writes, as sets of fact = value pairs (every write, not only the read ones), differ, or a response link
    names one of them. R1's `stay` writes nothing and is read by `exit-stay`, so the scenario passes. The earlier
    "distinct value per action" reading (review R-16) is replaced.
81. **Later capabilities are checked in every variant, and in the whole closure of fragments. (new)** A variant's parts
    merge over the seed, so a clock in an unchosen variant is refused at compile time as well. The fields of a
    fragment (`implies`, `ask`, `render`, `modelOk`, `says`, `means`, `humour`, `told`, short and full forms, recall)
    and its predicates are checked on **every** fragment the document reaches: the beats' fragments, the ladder's, the
    close content and signposts, and what their `implied` forms and other content references reach in turn, in the
    document that runs and in every variant (review R-7, L2-15).
82. **A channel-free beat with an objective stays running. (new)** S2 7.3 completes a beat on its content only
    when it has no objective; one with an objective starts at once (no channel to wait for) and is left to the
    running pass (review R-3).

**Fix round 1 (entries 83 onward).**

83. **Closure status and witnessing (S2 v1.6 6.4, L2-17).** `resolved` only after T12; every T13 is `abandoned` even if
    its plan makes `end` yes; forced closures (withered, withdrawn, T13) retire open promises. `witnessed` is derived
    from exposure: for T12, true when a delivery of one of the beats that completed last (the ending beats) has a
    receipt of at least `presented` (the beat that completed last is found by the order of the record, `doneAt`, because two completions
    in one pass share their stamps, R2-04); for T13 and forced closures, false (the plan is not shown). A seed that reaches its
    end with no display receipt (a channel-free completion) is therefore unwitnessed and queues the news.
84. **Links (S2 v1.6 7.1).** `join` combines the chain links (`because`, `then`); `obstructedBy` is a guard that must
    always hold. A beat in `start` needs no chain links. A beat a `failure` leads to waits for that failure (the failing
    beat records `failedBy`, the entry's index) and then also needs its own chain links; when every beat that could fail
    into it has ended some other way, it is skipped as rejected. A beat with no chain links, not in `start` and not led
    to, is satisfied at once and waits only for its fragment's `needs` (R1's lapse exit); the lint's reachability and the
    fit report count it (`reachableBeats`). Ties go by key, and a beat that becomes available is live for the later ones in
    the same pass.
85. **Casting before the window (S2 v1.6 5).** Casting runs in `sown`, `waiting` and `cast` whatever the windows say
    (it was already so; a regression test now pins it). Only T4 needs a window open.
86. **R1's expansion (S2 v1.6 Appendix A).** `stay` and `decline` write nothing; the decline has no response content
    (`OfferSpec.decline[].response` is optional) and `exit-decline` plays `exits.decline`; every offer beat has a
    `reoffer`, `offer-1` too; Takemura's `must` includes `age-class` = adult. The lapse exit's gate lives in its
    fragment's `needs` (A.4), which a profile cannot generate: the ladder lint checks the contract (L-10): `since(offer-1)`
    at least `lapseAfter`, and no pacing act since `offer-1`. This is A.4's one simplification (measured from `offer-1`).
87. **L-99 proves acceptance by structure (L2-02).** A scene's enabling link must imply that V accepted an action of the
    offer it follows: an `all` is proved by any one part, an `any` by every part; `not`, a bare test, `yes` and any form
    that cannot be shown to imply it are not proofs. A seed-fact test proves it only if it is false at the fact's initial
    value and no write other than the offer's actions can make it true (a decline, the null path, another fragment, a beat or
    the plan). The scene's beat must not be in `start`, offered again by `reoffer`, or led to by a failure; with `join: any`
    every chain link must prove it and a `then` link cannot.
88. **The resituating gate (S2 8.2, L2-16).** `resituating` admits one cue of class 2 or lower: a delivery of the
    last-attended seed (the one with the most recent receipt of at least `presented`, by the cumulative play time), or, with no seed
    attended, a class-0 delivery (the hook). Class-0 deliveries pass anyway. Releasing the cue ends the orientation.
89. **Cast edges are role-qualified (L2-06) and stand-ins are staged (L2-05).** A cast edge's Id hashes the seed, the role,
    the node, the time and the delivery that committed it, so two roles on one node have two edges and a recommitted role a
    new one. While a batch commits roles, world requirements and authored relationships resolve a role through the staged
    binding map, so a stand-in (minted inside the batch) gets its commit-time requirements installed and checked.
90. **Lapse and expiry re-evaluate (L2-03).** A lapse, a missed release and an unreleased expiry queue the owning instance,
    so the new state's wake-ups are installed (T10 gets its T13 wake-up).
91. **The kernel's operation Id (L2-04).** An external operation's Id is `H("xop", stamp, op, ordinal)`: the epoch only
    refuses stale operations (I-16).

92. **The second review's findings (R2-01 to R2-09).** The staged commit is bounded (R2-01, see 70). A canon event's exposure wakes the instances and
    the sowing watcher that read it (`exposed` with an event pattern watches the event kind, R2-03). L-06 evaluates each link condition under
    every answer to the offer, response atoms set by the answer and everything else unknown, so a grouped test (`is go or skip`) does not
    tell two actions apart and a test of any action tells actions from a decline only (R2-05). The ladder's lapse contract must be implied by
    every way the fragment's `needs` can be yes (R2-06). Predicates in the fragments and documents of an unchosen variant are checked for later
    capabilities (R2-07). `commitRoles` first binds every role (a stand-in is minted), then installs goals, relationships and requirements, so
    a role may name one that commits later in the order (R2-08). A game-clock offer lapse (`lapse.after.clock = game`) is kept as a game time,
    falls due at the window boundary that ends the window it fell due in, and is not restarted by a load (R2-09).

### Spec findings for the coordinator

The ones that need a decision, worst first:

- **59 (T12 from `unattended`).** SF-7 expects T12 after a decline, but T10 puts the seed in `unattended` and T12's
  row reads `running`. The reference lets T12 fire from `unattended` too. If that is not intended, SF-7's expected
  ending changes (or T10 on a decline in a ladder must leave the seed `running`).
- **68 (clocks).** The spec says game-clock durations are checked at window boundaries; the reference reads every
  game-clock duration (`since`, waits, the plan, an aftermath, a `maxWait`) at the last boundary. If a `since` atom
  should instead read exact time and only the wake-up be rounded, results differ by up to one window.
- **69 (restart).** A play-clock `since` that has not yet elapsed restarts at a load; one that has elapsed stays
  elapsed. The text of 2.12 names `maxWait`, a lapse and a category timer; it does not name `since` or a casting wait.
- **80 (L-06, "differ").** Distinctness is judged on every write and every named response, not only the read ones; a
  stricter reading (only the consequences something reads) would also reject two actions that share a read write and
  differ in an unread one.
- **88 (the cue).** With no seed attended the "class-0 hook" is any class-0 delivery; 8.2 does not say which.
- **Later capabilities refused.** Each later construct is rejected at compile time with "X is not supported yet"
  and the spec's instead-text where one exists: clocks and projections, short and full forms, plants,
  language-model fields, city reads, the tone, dread, setting, stage, words and model lint blocks, scale
  metadata, constructed traces and late causes. `test/s2/fixtures.test.ts` names the fixture each one blocks
  (50 of SF-1 to SF-64 have named tests, SF-18 in its count form only; 14 wait wholly for a later capability;
  the kernel's F-16 has its own test, and F-17 to F-20 wait for the deferred memory machinery).

## The kernel's process additions and the simulation layer's core (entries 93 onward)

These entries come from building S0 V4-35 to V4-49 and the core of S1 v0.2 (`src/sim/`). Numbers continue after 92 and
are ordered worst first within each block. The block headed **Spec findings for the coordinator (S1)** lists the ones
that most need a decision.

### Kernel process additions (V4-35 to V4-49)

93. **A run returns operations, or operations with a state and a digest; both ride in the batch. (new)** `ProcessDef.run`
    may still return a bare `ProcessOp[]`, which every earlier process does and which changes nothing. A new form returns
    `{ ops, state?, digest? }`. The state and the digest are stored on the outstanding batch and replace the process's own
    `ProcessState.state` and `.digest` when the batch applies, after its operations and in the same step, so they are
    double-buffered with the operations (V4-35, V4-36). A batch with neither leaves both alone. `ctx.own()` is a copy of
    the applied state, or `def.init(...)` before any has applied; `ctx.digest(id)` is a copy of another process's applied
    digest. Because every process of a boundary reads before any new batch is published, a reader sees the digest of the
    window before its own, whatever the order of ids (V4-36). Digests are persisted with the `ProcessState` (V4-49) and read
    outside a run by `Evolution.digestOf` (V4-42).
94. **`ctx.rand` is `ctx.procRand(k, …)`; the window is always explicit. (new)** V4-41 keys a process draw by the window
    being computed. For a run that computes one window, `ctx.rand(…)` is exactly `ctx.procRand(k, …)`, so the frozen digests'
    processes (period 2 and 3 with `ctx.rand`) are unchanged. A multi-window run uses `procRand(w, …)` for each window, and a
    test shows the draw for window `w` is the same from a run that starts earlier.
95. **`demanded(tier)` lists the focus nodes of eligible frames whose focus tier is `tier` or finer. (new)** The spec says
    "the nodes demand reaches at that tier, with the claim". The reference lists each node named in the focus of an active or
    blocked frame whose focus tier is at least `tier`, with the node's demand tier and claim (S0 10.6), in `Id` order. So
    `demanded(3)` includes persons focused at tier 4. Owned values of a focused node are not listed: a process that wants a
    household's residents asks for them.
96. **V4-39 and V4-40 are switchable or strict so the frozen digests stand. (new)** `Config.itemScopePlace` (default on)
    gives the items of a summary with no place strictly under its scope the scope itself as their place; off, an item has
    none, as before. V4-40 passes an unavailable derive input as `undefined` and lets a derive answer; every core derive
    (`identity`, `concat`, `floor-div`, `sum`, `first-char`, `age-class`) is strict and answers `undefined` for an
    `undefined` input, which makes the slot unavailable, exactly as before. A derive that returns `undefined` is
    unavailable. Both digests pass unchanged.
97. **An event minted late is announced at its own time (V4-45). (new)** `Kernel.emit` takes the occurrence's time and stamps the
    change `min(time, now)`. The relevance emission and `Relevance.time` of an event minted at a boundary with an earlier
    `time` carry that earlier time. The digests do not hash relevance times, and no other test reads them.
98. **`publish-item` is `Events.publishItem`; the kernel keeps a session guard, the publishing layer keeps the record. (new)**
    It resolves the item's kind, time, place, participants and effects as they stand and emits one `event` change stamped with
    the item's time. A second call in the same session does nothing; the set is not persisted (S1's `ActsState.published` is
    what survives a reload). It refuses a node that is not a summary item. The `contribute` operation takes `silent`, which
    S1 sets when it regenerates an opened item's contributions after a load (V4-48).
99. **The operation names and shapes. (new)** `frame-open`, `frame-status`, `frame-weight`, `frame-interests`, `decide`,
    `order`, `observe`, `tell`, `belief-set`, `belief-drop` and `publish-item` join the earlier operations. `observe` pins
    the node's slot as it stood at `at`, `observed`, with the observer as the cause (a mirrored slot's reading, any other
    slot's resolved value). `tell` names the teller's belief by Id and the telling event, and the policy's `onSocial` hook now
    also receives the operator and may override `path`, `value`, `region` and `salience` besides `confidence` and
    `memorable`. `mint-event` and `mint-summary` may name a `creator` and a `cause`, which fix the node's identity
    (`H("mint", creator, cause, name)`): S1 needs the mirror's `H("mint", proc(city.mirror), raw, "mir")` and a child's
    `H("mint", proc, parent, "child/<i>")`.
100. **`Belief.salience` is the one field of V4-9 the core needs; `aggregate` may return `mass` and `items`. (new)** Salience is
    optional and omitted when zero. `uses`, `widened` and the memory machinery stay deferred (V4-30). The policy `aggregate`
    result gains optional `mass` and `items` (S0 V4-19's contract) beside `confidence`, so the stub's result is unchanged.
101. **`matchStrength` is a read over the same scan as dispatch. (new)** It takes the greatest `pullVia × m × s` over the
    interests that reach the actor's eligible frames, optionally for some interest types, with no emission threshold and no
    side effect; it ignores the frame worklist (it reads the frames as they stand).
102. **The test runner's timeout is 30 s (`bunfig.toml`). (new)** Two digest tests re-run the 1,000-operation script several
    times and sit near bun's 5 s default; on a loaded machine they time out. The tests are unchanged.
