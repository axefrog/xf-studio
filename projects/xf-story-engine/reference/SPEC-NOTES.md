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

The golden digest is `f924d2c9d1159bca85bbfa4cf18dba6c` over 1,067 entries, and the run ends at revision
2,058 with 135 pins and 121 contributions (S0 v4.15 event-fact persistence, entry 191). Its predecessor
`d534e0dcef3f85d27cefa552217152ec` ended at revision 2,057 with 51 contributions; that replaced
`c896b062fda81bacfbb6d84563a2c77d` (1,053 entries,
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
    so the schema hash. The v3-mode digest runs with `frameChanges: false` and `coreDefs({ v4: false })`:
    S0 v4.12 section 20 defines the digest on the v3 schema with frame changes off. S0 v4.15 event-fact
    persistence applies in both modes (entry 191), changing the v3-mode golden from
    `d534e0dcef3f85d27cefa552217152ec` to `f924d2c9d1159bca85bbfa4cf18dba6c`.
    The second frozen digest is now `42d5a84e16dde21cc0bca7fe50c01d72` (previously
    `da48cabc405ed361ce6ad5f3b895a822`) over 1,069
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
    what survives a reload) and belongs to the session, so a load that rewinds and a discarded stage both forget it. It refuses a node that is not a summary item. The `contribute` operation takes `silent`, which
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
102. **The test runner's default timeout is 120 s (`test/setup.ts`, preloaded by `bunfig.toml`). (new)** Two digest tests re-run
    the 1,000-operation script several times and sit near bun's 5 s default; on a loaded machine they time out. The tests
    are unchanged. bun ignores a `timeout` key in `bunfig.toml`, so the preload sets the default; a run of several files
    resets it, so the slow tests carry an explicit timeout as their third argument.
116. **An event kept as the evidence of a memorable belief is restored, silently, from the record. (amended, R1 SIM-03)** A load keeps
    the header of an event that a memorable belief cites as evidence (it is a retention root) and none of its fields: they are
    simulation-layer contributions, which a save does not hold. The kernel's `mintEvent` puts them back for a node that has the
    header and no contributions of its own origin, without emitting anything. That left the caller to know what the event was,
    and S1 does not: the first version relied on the ring, which holds seven days, and on the callers minting by hand. S1 now
    writes the facts of such events into its record at each save and restores them at the load (144), so a telling about the
    event scores what it did before the save, with the ring long past. `test/retention.test.ts` has the kernel case.
117. **Queries prune before they resolve. (new)** The mirror and the norms process find raw events with a query over every event
    under the city, which materialised every item of every summary (S0 8.3 step 9) and grew with the world: 48 ms a window
    at window 600. A query's `must` clauses on `kind` and `time` (`eq`, `in`, `not-in`, `range`, the field bounds) are now
    tested first on what the node already knows: a summary's kind and span (committed at minting, cached in
    `Summaries.spans`, cleared with the summaries), an item's time (`itemTime`, the same keyed draw the descriptor uses) and
    an event's minted kind and time (`Events.mintedFacts`). Anything that cannot pass is neither resolved nor materialised.
    A query still tests what a node resolves to (S0 8.3), so each shortcut holds only while it is proved equal to
    resolution. A fact cached at minting is used only for a node nothing local touches (`Store.localState` is the number it was
    cached at, and it is not cached at all for a node that already had a pin or a contribution when it was minted). A span
    resolved later, while something local names the summary, is good only at the time it was resolved, because a contribution's
    validity is a window that opens and closes without moving that number (R1 SIM-06; the first version of this note said the
    stamp was enough). The whole prefilter is off while a rule over a kind could touch `kind`, `time`, `from` or `length`
    (`Store.generalTouches`). An item that already exists (canon, or in focus) is always left to the exact check. The same run
    still costs 3 ms. `test/query.test.ts` and `test/review-fixes.test.ts` have the cases, with and without the cache and after
    a save and a load.
### The simulation layer's core (S1 v0.2, `src/sim/`)

Numbers are identifiers: 116 and 117 above belong to the kernel block and are not repeated here.

103. **The world kernel's work allowance is 5,000,000. (new)** A resident is several nested draws (the household's profile, the
    roster rules over six member slots, the age, the name), every rule re-reads its inputs, and a replay of a cached
    resolution charges the recorded cost again (SPEC-NOTES 37). One resident of a household of six exceeded the default.
    The limit is a configuration of the world, not of the kernel.
104. **Slot keys are lower-case, so the group slots are `grp-a1` to `grp-a3`. (new)** The kernel's slot-key rule is
    `[a-z0-9-]+`; S1 writes `grp-A1`. The public names of the groups (`A1`, `A2`, `A3`) are unchanged; only the slot key is
    lower-case.
105. **Iterative proportional fitting: the dimension fitted last is within 1e-9, the others within 1e-6 after 20 iterations. (ruled, S1 v0.3)**
    SF1-P-2 now says this: iterative proportional fitting converges at a finite rate, so the iteration count, not the tolerance, is
    what makes the result deterministic. For the person table (four dimensions, 2,304 cells) it holds for the last dimension and
    for the two-dimension hand case of SF1-P-1. The floor (`cellFloor`, 2^-30) then moves a marginal by up to about 2e-6, so the
    test also checks the fit against 5e-6.
106. **FX-3 is a line, so "two steps away" in SF1-I-13 is two steps from `c1`. (new)** The slice has `c1`, `c2`, `c3` in a line;
    `c3` is one step from `c2`, so with the cover at `c2` there is no cell two steps away. The tests cover at `c1` for the
    two-steps case (`c3`), and at `c2` for the case where both neighbours are thinned. The cover rule is as written: the same
    kind at the child's cell or one of its `adj1` cells, for `coverLull` windows.
107. **A pending child is part of its cell's heat from the moment it is born. (new)** SF1-I-8's second event is "of size 4, at
    `w + 10`". As a calendar entry it is heat as soon as it is injected, so the fixture injects it at `w + 9`, one window
    before it falls due, and the band is held by the dwell exactly as the table says.
108. **An injected child is consumed by the run that starts at its due boundary. (new)** The run for window `w` starts at
    boundary `w` and consumes the children due at `w`; a child injected after that boundary with `due = w` waits for ever. The
    fixtures that inject window by window use `due = w + 1`.
109. **The window V arrives in is covered. (ruled, S1 v0.3 10.2)** A reading of V's cell applied at boundary `k + 1` puts that cell
    in the recorded focus of window `k + 1`, and the items of that window are opened. The kernel does it: between the external
    operations of a boundary and the snapshot the processes take, `Kernel.settleInputs` runs the frame work and the relevance
    dispatch they queued, to their end and with no budget, so `v.frames` has opened the situation frame by the time a fine-tier
    process judges demand. The work is the same whichever tick takes the boundary (SPEC-NOTES 56). S0 9.4 lists three steps of a
    boundary; this is a fourth between the second and the third, and the spec of the kernel should say so (see the findings below).
    `test/sim/review-fixes.test.ts` has the first-window case, in one call and in many.
110. **`place` is optional on an `event` line. (new)** The port's `ReplayLine` gives `place` as required. The raw heat and district
    kinds carry none, and a death or a combat event may be placeless; a placeless event gets the city as its place, and the
    mirror takes V's district for the police response to a rise in heat. The name of a raw event is `raw/<t>/<n>` with `n`
    counted by the port: after a load the game's feed starts again from a fresh port, so the same line gets the same Id.
111. **A child's inherited cast is fixed when the child is born. (new)** A police response keeps the original victim and names the
    original aggressor as its target. The pending child carries them (`inherit`), so firing it needs neither the parent's
    cast nor the ring (SF1-E4). The same list rides on the ring's item `meta`.
112. **The ring remembers how an event was minted, and `Sim.remint` and `Sim.why` read it. (new)** A ring entry for an event
    carries its `mint` name and cause, so `Sim.remint(id)` puts it back under the same Id (its cast being a pure function of
    the descriptor and the recorded history), and an event or a summary within seven days regenerates identically
    (SF1-I-10). Restoring an occurrence is silent whether or not its header survived a load (`Events.restoreEvent`, 140): it was
    announced when it first happened, and the review found the first version announcing it again (SIM-02). `Sim.why(id)`
    returns the occurrence and its ancestors, nearest first, at most `genMax` after it; an ancestor the ring no longer holds is
    returned as an Id marked `beyondRing`. An item's `why` needs the item's header (materialise it first): an Id cannot be
    inverted to its summary. Regeneration from the ring covers what the ring holds; the facts of the events behind memorable
    beliefs are kept by the record instead (144).
113. **`scene.acts` materialises an item before it addresses the item's members, and its published list carries the summary and
    the index. (new)** `Kernel.address` needs the node's header. The first run of the fine tier after a reload could not find
    an item's summary from its Id alone, so each entry of `ActsState.published` now holds `summary` and `index`.
114. **A restated reading is not a change. (new)** After a load the game restates what it knows, and `reconcile` hears the
    readings again. A correction is logged when it corrected something, or when a reading with an earlier value moved
    (`old` defined and different); a reading with no earlier value, or an unchanged one, logs nothing. A quest-link
    reading logs only for a change. Without this a reload added a second `game-dead` for the same death and the decision
    log differed from the run that never reloaded (SF1-E3).
115. **The cap of memorable beliefs is kept by not promoting low-salience beliefs. (new)** S1 8.5: "40 memorable beliefs per person
    ... kept by not promoting further low-salience beliefs". A belief that is memorable by rule but has salience under 3 is
    formed as texture (not memorable) when its observer already holds `memorableCap` memorable beliefs; a salience-3 belief
    is still promoted.
118. **A mirrored slot with a reading gathers no contributions. (ruled, S1 v0.3 SF1-E3)** S0 5.1 step 2 returns the game's reading
    before any contribution is gathered, so the `simulation`-layer statement that `mv` is alive stays in the store, inactive,
    and the trace of the slot lists no constraint from it. SF1-E3 says this now; the test checks the value, the `game` pin, that
    the statement remains, and that the trace has a reading and no constraints.
119. **Ended edges and abandoned frames are history a save does not keep, so the `edges`, `frames` and `headers` sections are not compared
    after a reload. (amended, R1 SIM-04, SIM-07)** SF1-E3 compares the records after a reload with those of the run that did not
    reload. An abandoned frame is not a retention root and an ended edge not referenced by a canon event is dropped, so those
    sections differ; the fixture asserts instead that in every run the frames of `mv` are abandoned and its edges ended or gone.
    That is only right of history nothing reads. Two things read the past of edges, and the first version lost both: the
    protected set of a past time (a cast edge ended before the save), and the interval of a tie that ended. S1's record keeps
    them (143, 145), and the S1 record and the seeds are compared, so a run that reloaded and one that did not agree on them.
120. **"The same totals" of the metamorphic relation are the effective ones. (new)** Moving a district's opportunity out of
    `rest` into a new simulated district changes no other district's draws only if `rest` falls by the district's effective
    `a` (the cell weights less what the game covers, times the propensity), not by its static `staticTotalA`: the share of a
    district is its `aD` over the city's total, and the total adds the simulated districts' `aD`.
121. **The volume check is against the offered mean, with a tolerance for what is refused. (new)** SF1-E1 compares the immigrants
    of each kind with the sum of the means of the run's own propensities within four standard deviations. The sum is
    computed from the same formula the process uses (rate, shape, share, regime and group modifiers) on the snapshot each
    run saw. Incidents that admission refuses or the cast cannot fill are offered and not admitted, so the test allows
    ten per cent and two incidents beyond the four deviations.
122. **The long fixtures run at a smaller scale unless `S1_FULL=1`. (amended, R1 suite time)** The default suite runs in under a minute
    on the development machine (it took five minutes before R1's round; the budget is 90 seconds) and every assertion stands at the
    smaller scale; what shrinks is the length of a run, never what a test checks. Scaled down by default: SF1-E1 (a Kabuki stand-in of
    one day, the injected events at windows 40 and 90), SF1-E2 (280 windows), SF1-E3 (the story starts at window 140, not window 0),
    SF1-E4 (a calendar written down: one child of size 2 and one of size 1, injected where a natural child would stand; the natural run to
    the boundary of the ring is the `S1_FULL=1` scenario), SF1-O-3 (6 days), SF1-I-5 (3 seeds of 150 windows at 25 times the rates),
    SF1-I-10 (160 windows at 12 times the rates, plus a second test that writes the ring and the fourth generation down instead of
    waiting for them), SF1-I-15 (120 roots), SF1-S-2 (the arrival statistics are taken from the draws alone, in a test of their own;
    the whole-world run keeps three seeds of eight days at 0.4 a day), the gate fixtures SF1-X-1 and SF1-X-3 (50 windows of occurrences, 800 casts), SF1-A-5 (36 windows),
    SF1-P-0 (250 households), SF1-P-4 (about 350 households, thresholds scaled), the week fixture (96 windows, one baseline reused, reloads at 45 and 75),
    the metamorphic relations (60 windows) and the other property tests (3 seeds of 90 windows). SF1-T-1 checks every pair of FX-3.
    SF1-H-6 regenerates the artifacts in every run (a third of a second), so a change of the generator that changes an artifact fails on
    every push. `S1_FULL=1` runs the spec's figures (a 1,008-window Kabuki week, 100 game days, 20 seeds of 30 days, 1,000 roots, 2,600
    windows, 10,000 casts, 12 seeds of 240 windows, 10,000 random tie pairs, 10,000 sampled households for SF1-P-4 from Kabuki worlds of
    several seeds, the natural run for SF1-E4); the repository's workflow runs it on demand and once a week (`reference-full`), never on a
    push. Its first run found one defect of the model (154) and three of the harness, and the suite passes at that scale.
123. **Layer 2 asks the simulation layer through `SimReadPort`; the reads it builds are the `city` and `social` atoms. (amended, R1 SIM-01)** The
    port (`builds`, `eval`, `transitions`, `deps`) is layer 2's own type (`seeding/registries.ts`); `Reads.port()` implements it, and
    `attachLayer2` builds layer 2 on a sim's kernel with it and with S1's spine. `eval` at a time gives the last value the time passed
    through; `transitions` gives the value at `from` and then every change in `(from, to]`, those at one time in the order they were
    made (S1 9.1), and layer 2 evaluates a window's closing condition at each of them (S2-4): the first version had no
    `transitions` in the port and latched on the last value of a second in which a regime ended and another began. A change carries
    `ord`, where it stands among the changes other reads made at the same second, and a condition on several reads is evaluated after
    each source transition in that order with every read at the value it had then; aliases update atomically (155, 163). Eleven of the
    sixteen reads of S2 2.16 and 2.17 are built (`band`, `regime`, `regimeIs`, `presence`, `priceLevel`, `refuge`, `label`, `bridge`,
    `normGap`, `tied`, `divergence`). `heatRank`, `tension`, `reach`, `protected` and `contract` are registered, answer `maybe`, and are
    refused at compile as "not supported yet", as is every read when no port is attached. A read's `deps` become the instance's
    interests; a dependency that names no kind is scoped to the nodes the read is made of (`tied`), and a read marked
    `boundary` (`divergence`) is looked at again at every boundary, like `believes`. The invalidation of `priceLevel` is the
    regime events, which the table says and the first version of the read did not declare. S2 v1.10 §4.2 now specifies the
    port's persistent shared sequence (168); the worktree's older spec copy could not be rebased in the sandbox.
124. **The audits are pure functions over structure, so a test can hand them a fault. (amended, R1)** `audit.ts` (in the simulation layer's
    source directory) has the source lint, the kind and read audits, the writers audit over a declared table (`PROCESS_WRITES`) and
    the writes a run observes, the gate audit, the cursor audit and the schema audit (which asks the kernel's loader to validate and
    lists every slot a derive reads). The source lint walks TypeScript compiler ASTs (166), distinguishing executable expressions from
    literal contents, and inspecting literal slot arguments where needed. The first version blanked strings for every rule, and the rule for V's cell could never
    match the literal it looked for: a read of `sim.w.vState` with `'cell'` in a tier 0 to 2 file was not found. The heritage
    lint applies to S1's own kinds: the kernel's `core:name` draws given and family names by an `origin` slot, which is display
    and no decision. A read of a believer's beliefs must test `memorable` within three lines, at each read.
125. **`gameOwnedNow` is not a name in the reference; the lint looks for it all the same. (amended, R1)** S1 12 forbids a coarse
    process to read it, and to read V's cell or position. The reference has no such read, so the audit cannot rely on its absence
    being checked elsewhere. In the files of tiers 0 to 2 the lint fails on the name, on the demand reads, on a string `'cell'` or
    `'position'` anywhere, and on any use of `vState` that is not a read of its `district` or its `wanted` level (the mirror takes V's
    district for the police response to a rise in heat). Written any other way, with a variable slot name among them, the read is
    still found, because `vState` itself is the thing looked for. The tests hand the lint the review's line in the real file.
### Review round R1: the independent review of the core (entries 126 onward)

One read-only review of the branch by GPT-6.1 Sol at xhigh effort found 17 problems (10 High, 7 Medium). Each is fixed with a
regression test. The decisions the fixes needed:

126. **`Store.localState` moves on every local change, and a cache made from touched state is good only at its own time; so is one made
    under a rule that has a window. (amended, R1 SIM-05)** `localState` is the number of pins and contributions that name a node,
    and a withdrawn pin and an ended contribution count twice, so a withdrawal or an end moves it as an addition does. The resident
    views and blocks and the minted facts of an event are stamped with it. A household nothing local touches has the same view at
    any time; a touched one is good only at the time it was resolved, because a contribution's validity is a window. That is not
    enough for a resident, whose values also depend on the rules that name no node. With any extra general rule, named rule on the
    resident/owner chain, or additional location edge, the resident and block caches are bypassed (164). Shared memoisation is restricted
    to the known installed pack and untouched local inputs. The first version assumed zero local state meant the resident was unchanged, and an
    authored kind-wide age constraint left a warm view saying 36 where the kernel said 17. The gate is told the age class the
    kernel resolves (`age-class`), not one worked out from the age. The spells of a resident are keyed by their age band.
127. **The order a record lists its properties in is not part of the model. (new)** The matrix rows of a kind are taken in the
    order of the kind registry, the rates and the presence of a cell are summed in the order of their names, districts are
    walked by Id and a person's slots are read in name order. Two records that mean the same, and hash the same, give the same
    run (finding 4; `S1-I-1` has the reordered run).
128. **Regeneration asks for the scene, not for local state. (new)** `scene.acts` regenerates an opened item's people when the
    kernel holds no contribution that names the item (`Store.namedContributions`). A canon descriptor leaves three pins and
    no people, and the old test (`localState > 0`) took the pins for the scene (finding 5; `SF1-A-2b`).
129. **A decision that persists reads only memorable beliefs. (new)** The attribution multiplier of a trust loss and the reason
    belief that travels with a telling both ignore texture beliefs, which a load drops (S1 8.3, S1-I-15). A reload no longer
    changes the regard (finding 6).
130. **`where` reads the protected set as of the time asked. (ruled, S1 v0.3 4.5)** A person V observed at 1200 was not present at 0
    because of it. S1 4.5 and 6 say `protectedAt(person, t)`, which equals the set now for a time at or after now. For a time
    before now it is the set as of that time, from what the kernel still holds and what the record kept (143).
131. **V is outside the cap of materialised ties, and a thread V retracted is closed. (ruled, S1 v0.3 4.6)** `materialise` asks both ends for
    room before it ends or makes anything. V has no cap: the record of whom V knows is never trimmed, and a tie to V never counts
    as the weakest. Any other person is under the cap: the weakest tie that no live frame and no memorable belief depends on is
    ended, or, if there is none, nothing is ended, the new tie is not made and the refusal is logged `tie-cap` (the caller carries
    on without the tie). A retract sets the status `ended` and closes the thread: `bid` and the five tie events for it are
    refused and logged `excluded-thread`; the thread stays visible. A tie that ended is opened again under its stable Id (145).
132. **A telling passes the gate before it is minted or takes volume. (new)** The occurrence is `tell`, origin `policy`, with the
    roles teller, listener and subject (informational, so the gate lets it through); a refusal is logged with its reason and
    leaves the hourly allowance alone (finding 9).
133. **A registered read evaluated at a past time answers from its transitions. (new)** `eval(name, args, t)` for a read fed by a
    digest's `changes` feed (band, regime, regimeIs, priceLevel, refuge, label, normGap, groupGap) and for `tied` is the value
    the transitions give at `t`, and `maybe` outside what the feed covers (eight windows) or before any reading. A time at or
    after now is the current value. S2's closing conditions read through this (finding 12).
134. **The modifiers of a window are those of the regimes live at its start, after the exits. (new)** A regime that arrives in the
    window changes incidents from the next one: not the offspring of the window's own occurrences, not the thinning, not
    `modBirth` (S1 7.1, 7.2; finding 13).
135. **A group's pulse is replaced by the stronger urgency now. (new)** `pulseReplaces` compares both at the snapshot time `T`, not at
    the time of the new fact; a mirrored fact older than a city fact already counted must not displace it (finding 14).
136. **A changed affiliation joins the group of the person's district. (ruled, S1 v0.3 8.8)** `reconcile` ends the memberships that are
    not to it and adds a `core:member-of` edge caused by the port (the game's own node) when a group stands for the affiliation.
    Only a move joins: a first reading, or one the game restates after a load, is not a change (a load keeps live memberships and
    drops ended ones, so a restated reading that joined would make a dead person's membership again), and a person the game says
    is dead joins nothing. The group is the A1 to A3 of the district the mirrored position is in, when that district lists the
    affiliation; otherwise the first simulated district, in `Id` order, that does. A membership already held is kept. The slice
    has to say which district a position is in: the real slice has polygons, the stand-ins none, so `DistrictIndex.polygon` is an
    optional outline in the game's x and y (with an optional floor and ceiling, `zBand`), and a slice without outlines (or a person with no
    position) takes the second rule. The outlines overlap and nest, and the game's current district is the innermost one entered
    (knowledge/places.md 3.2, game-events.md 1): of the districts whose outline contains the point, and whose band contains its height,
    the one with the smallest outline holds the person, the lower `Id` on a tie.
    `test/sim/review-fixes.test.ts` has two districts with outlines.
137. **A process version is pinned with its id. (new)** `PROCESS_VERSIONS` (in `s1ctx.ts`) is the one table; every process takes
    its version from it, and the lineage pack hashes the ids and versions of all seven whether or not an instance runs them.
    A save made under another version of any opens read-only (finding 17).
138. **A string's UTF-8 length counts a lone surrogate as three bytes. (new, kernel)** `utf8Length` took any high surrogate followed
    by anything for a pair; the encoder writes U+FFFD for a lone one. Two different strings could hash the same (finding 10).
139. **`matchStrength` keeps its memo per interest source. (new, kernel)** A frame that inherits from two matching sources is pulled
    by each on its own, as dispatch pulls it; the shared memo returned the weaker (finding 11).

### Fix round 1: the independent review of the simulation layer (entries 140 onward)

An independent read-only review (GPT-6.1 Sol, xhigh) of the branch found 15 problems, SIM-01 to SIM-15, seven of them High; all are fixed, each with a regression test that fails on the code the review was made against (`test/sim/review-fixes.test.ts`, `test/review-fixes.test.ts`). The review also disputed what entries 112, 116, 117, 119, 123, 124, 125 and 126 claimed; they are rewritten to say what the code now does. S1 v0.3 ruled on 105, 109, 118, 130, 131 and 136, and those entries say so.

140. **`Events.restoreEvent` is a silent mint. (new, kernel, R1 SIM-02)** It puts an event's fields back under its Id and emits no change,
    whether or not the header survived; `mintEvent` is the same call that announces a node it did not know. `Sim.remint` and the
    load's restoration use it.
141. **`Kernel.reopenEdge` opens an ended edge again under its own Id. (new, kernel, R1 SIM-07)** An edge has one interval and `addEdge`
    returns an ended edge unchanged, which is right for an edge whose Id includes its time and wrong for the stable Id of a
    materialised tie. The edge is live from the time given, with the attributes given; it emits an edge change and a save holds it
    as a live edge. The interval that ended is the caller's to keep (145).
142. **A boundary settles its inputs before the snapshot. (new, kernel, S1 v0.3)** See 109. `Kernel.settleInputs` is called by the evolution
    when the boundary applied anything (a batch or an external operation). It changes no frozen digest.
143. **The record keeps the spans of protection. (new, R1 SIM-04)** S1 4.4 and 5.4 cast an occurrence from the protected set as of its own time,
    and an occurrence within the ring regenerates. The kernel drops an ended `core:cast` edge, an old reading of a quest link and a
    withdrawn pin when it saves, so S1 writes the spans (a cast edge's interval, an observed pin from `at`, a quest-linked reading's
    validity) into its record at each save, as their union per node (a cause that is live at the save is recorded up to the save and no
    further, including a finite end later than the save: 156, 162), and drops the ones that ended before the oldest occurrence
    that can regenerate (a week and a window). A game that restates a quest link after a load makes a reading inside a span already
    held, so the union is what makes the record the same for a run that reloaded and one that did not. For a time before now the
    protected set is the kernel's state and the spans together. A cast edge counts for the interval it was live in: the first
    version also asked that its seed still be live, which made the past change when a seed closed. The mirrored canon person, the
    spine and the essential set are read as they are (they are configuration, not history).
144. **The record keeps the facts of the events behind memorable beliefs. (new, R1 SIM-03)** At each save S1 reads, from the kernel, the events a
    memorable belief is read back through (the source of an observed belief, the first evidence, the cause of an inference; a
    ledger item reads none) and keeps what each was minted with, including opened summary items (162), read from the contributions that hold the minted fields and not from what
    the event resolves to at the time of the save (157): creator, cause, name, time, kind, place, participants, effects, witnesses,
    causes, outcome and the frame it served. At the load it restores them silently (140). An item nobody has opened is not kept: it has no
    people to record, and restoring one would stop the scene from regenerating its people (128). The set is cut to the events a
    belief still cites at each save.
145. **A tie that ended is opened again under its Id, and the past of `tied` is not rewritten. (new, R1 SIM-07, SIM-11)** `materialise` of a pair
    whose edge ended reopens it (141) with fresh attributes, and the interval that ended goes to the tie's record (`spans`, the newest
    16); a save writes the intervals of the ended edges it is about to drop. `tied(a, b, type)` at a time before now is `yes` if the
    implicit tie (a pure function of the pair) holds or any interval of the materialised tie covers the time, and `no` otherwise
    (`maybe` where the implicit tie is unknown, and for the times the dropped intervals covered: 160); its transitions are the openings
    and closings of the intervals, with their original shared ordinals (168, 170). Only actually ended intervals enter history;
    an edge's scheduled future end remains the kernel's (S1 v0.5 §4.7). Only `xf:tie`
    is built; another type answers `maybe`.
146. **The divergence log is written when a belief changes. (new, R1 SIM-08)** `Beliefs.onChange` tells S1 when a belief is added, replaced or
    dropped, by anyone, and S1 logs the divergence of that believer from the game at that time. Mirrored readings also notify S1 at
    application, before deferred relevance dispatch can hide intermediate values (168). The boundary hook detects any remaining
    changes. The value at a time before now is the last log entry at or before it; when the oldest transitions have been dropped
    (the log keeps eight) the record keeps the time they reached back to, and an earlier time is `maybe`. While a staged batch is open the
    notification waits for its commit, and goes with a discard (159).
147. **`groupGap` is the band the group maintains. (new, R1 SIM-09)** The digest carries the band `group.decide` keeps with its hysteresis, and
    the read and the transitions both give it. The first version worked a band out from the enter thresholds alone.
148. **`label` takes a carrier's node as well as its name. (new, R1 SIM-10)** S2 2.17 says an audience is a role or an Id; a cast role resolves to a
    node, which is the carrier's. A name in the configuration stands for that carrier in the first simulated district.
149. **The ledger counts carriers in Id order. (new, R1 SIM-13)** Of two items of one origin with the same reach the one of the smaller carrier is
    counted, so the aggregate does not depend on the order an audience was written in.
150. **Assimilation recovers the act and the listener's expectation. (new, R1 SIM-14)** S1 8.4 says the `reason` region is replaced by "the listener's
    default reasons for the actor's group" and defines neither. The reference takes the act's effect from the event the belief cites
    (its inference's cause, then its first evidence, then the class its reasons name) and gives the listener the attribution of
    `attr@1` with no constraint visible, tilted by the listener's attitude to the actor's class: dispositional when `wD >= 0.5`,
    otherwise situational. With the defaults (`wD` 0.65, tilt 0.1) that is dispositional for everyone; the test sets `wD` to 0.5 to
    show a listener of the actor's own group excusing them. A belief that is not about reasons is not bent.
151. **A kind outside the core is refused at load. (new, R1 SIM-15)** The role specifications and the producers of the core's kinds are code,
    not data, so a city kind named in `data.kinds` that the core does not list would have the core's producers and no roles and pass
    for a supported one. `lintKinds` names it and says it is not supported yet.
152. **A save the kernel opened read-only is not written by S1's load hook. (new, R1 SIM-12)** The hook restores the record and stops; it builds
    nothing, restores nothing and reconciles nothing, and `flush` writes nothing while the world is read-only.
153. **The reference is faster; no value changed. (new, kernel and layer 2, R1 suite time)** The frozen digests (v3 and v4) and the S1
    transcript digest are the same before and after, so these are changes of how an answer is reached, not of the answer. The hashes of
    one chunk or less (all but a rare long message) go through `blake3-short.ts`, the library's function with its state in fixed arrays
    and the chain of a key's whole blocks computed once for the draws of one key over many values (`randOverValues`, which the sampled
    slots use for every candidate); a test compares it with the library on every length from 0 to 1,024 and on heads and tails of every
    split. The Ids of owned values and members are remembered (bounded); the canonical encoder writes into one buffer; the store
    indexes general contributions by slot and lists edge values without copying; the predicate matcher tests a slot before a kind;
    a process's own state is copied by its own `cloneState` when it has one (S1's ring is deep-copied: 165); reads that only look at a
    digest use `digestPeek` and do not copy it. The queued contribution optimisation was also removed (165). A native core can ignore all of it: none of it is in
    the contract.
154. **A frame that has ended is opened afresh, never reactivated. (new, found by the full-scale partition property)** `v.frames` used
    to set an abandoned situation frame (a neighbour V had left) or a satisfied or abandoned goal frame (an entry untracked) back to
    `active` when V came back or the entry was tracked again, keeping its old `opened`. A save keeps the live frames and the ended ones a
    persisted record refers to (S0 10.4: the ended ancestors of a live frame among them), so a run that was saved and loaded in between had
    no such frame, unless something hung from it, and opened a new one: the two runs differed in `opened` and in the status change the
    reactivation emits. The ended frame is now dropped (`Frames.remove`, which asserts the kernel is writable and emits
    nothing) and the frame opened as new, which is what the saved run does. The rule is S1's, not the kernel's: `Frames.open` still
    returns the frame under an explicit Id if there is one.
155. **A closing condition is evaluated after each change, in the order the changes were made. (new, R2-01)** Layer 2 used to walk the values of
    each read separately and pair them by their index, which could meet a condition on two reads with values that never stood
    together. A transition now carries `ord` (`SimReadPort.transitions`), and `statesAt` puts the changes of every read the condition
    names in that order, with one state after each source transition (aliases share a source: 163). All sources now allocate from
    the S1 record's one `ord` sequence, at actual application or observation (168, S2 v1.10 §4.2). Fixed source ranks and separate
    source counters were incorrect: external writes can interleave arbitrarily. A change with no `ord` follows those that have one.
156. **A cause that is live at a save is recorded up to the save. (new, R2-02)** The span of a cast edge, an observed pin or a quest link that
    has not ended is written as `[from, now)`, including a finite future end (162): the kernel keeps it and says when it ends. The first version wrote it open, and the union
    with the closed span the kernel later reported kept it open for ever.
157. **The facts of an event are the fields it was minted with. (new, R2-03, R2-04, R2-05)** `Events.mintedSpec` reads them from the simulation
    contributions whose origin is the event (or the original summary and opening process for an opened item: 162), not from what the event resolves to, so a rule or a pin that restates a field for a while is
    not made permanent by a save. The load restores an event unless its own fields are there (`restoreEvent` decides; a contribution
    of someone else's that names the event does not stop it), and `served` is kept with the rest.
158. **Resident caching requires a complete dependency set. (amended, R2-06, R2-07, R3-04)** The earlier owner-slot scan missed transitive
    dependencies and edge predicates. Those cases now bypass caching altogether (164). The known pack's resident rules read local
    household/resident slots and fixed ownership scopes; local stamps, time and the pack/configuration key cover that restricted case.
159. **A belief notification waits for the staged batch that made it. (new, R2-08)** `Beliefs.onChange` listeners keep state outside the
    tables a discard restores, so `Beliefs` hands the notification to the open batch (`StagedBatch.after`), which delivers it on commit
    and drops it on a discard.
160. **`tied` says maybe where dropped intervals covered. (new, R2-09)** A tie keeps its newest 16 intervals; once the oldest is dropped the
    record keeps `spanFloor`, the end of the newest dropped, and `tied` at a time before it that no kept interval covers is `maybe`,
    not `no`. The coverage floor is itself a transition boundary, so evaluation and transitions agree on recovery (163).
161. **The source audit parses executable expressions and rejecting guards. (amended, R2-10, R2-11, R3-08, R3-09)** The compiler AST,
    rather than `codeOf` or call counting, drives the lint (166). Regex braces cannot end an interpolation early, and unrelated
    executable calls cannot replace a policy's rejecting conditional. `codeOf` remains a syntax-based diagnostic utility only.

### Fix round 2 (entries 162 onward)

162. **Opened summary evidence keeps both sources; protection stops at the save. (R3-01, R3-02; completes R2-02)** An opened item's
    descriptor is recovered from its summary's original committed pins and its item index; S1 summaries use the cell itself as place.
    Its materialised fields are read only from `scene.acts` constants. The evidence record keeps these origins and restores the
    materialisation silently; it never installs descriptor constants. An item's live descriptor still derives from the summary (169),
    so a summary edit survives a reload and subsequent edits propagate. Ordinary events retain their own provenance.
    Every protection span is clipped to `min(end, save time)`, even a finite future end; empty and future intervals are discarded.

163. **A source transition is atomic, and independent transitions have persistent order. (R3-03, R3-07; completes R2-01, R2-09)**
    Equal `ord` entries are aliases of one source transition, applied together before testing a compound closing predicate. All reads
    contribute their initial value, including those without a change. Feeds, divergence and ties now share `S1Record.ord` (168);
    the feed producers are version 3 except `city.events`, now version 4 for atomic regime/price changes (174). One mirrored reading
    shares one ordinal among every affected divergence pair. Tie boundary
    logs wait for staged commits and keep the original ordinals while their intervals remain answerable (170), including the coverage floor.
    Older saves with unordered retained history open read-only: the missing chronology cannot be reconstructed honestly.
164. **Extra rules bypass resident and block caches. (R3-04; completes R2-06)** Only the exact installed world-pack contributions
    are treated as known dependencies. An extra general contribution, a named contribution on a household/resident or its owner chain,
    or a location edge outside the pack's fixed ownership scopes bypasses both per-world caches and shared memoisation. No hand-scanned
    dependency approximation remains. The remaining baseline memo includes world seed, pack version and kernel configuration.
165. **Applied state and queued changes own their nested data. (R3-05, R3-06)** `city.events.cloneState` deep-copies the ring and all
    nested descriptors. `Kernel.emit` deep-copies every queued change, including a contribution's form, selector and source. Fixture
    callbacks can update applied and outstanding states once each without double-applying mutations through shared ring entries.
166. **Source audits use the installed TypeScript compiler. (R3-08, R3-09; completes R2-10, R2-11)** TypeScript 7 exposes AST parsing
    through `typescript/unstable/sync` and `typescript/unstable/ast`. A virtual project holds the supplied source in memory; each compiler
    instance is closed after use. Lints walk syntax nodes, including nested template expressions. `heardEvent` and `absorb` must each
    start with an unconditional early return whose conditional is provably truthy for a `meta:` event. Strings, unrelated calls, dead
    conjuncts, non-returning branches and guards placed after work do not satisfy this requirement. This is a conservative syntactic
    proof of the shipped guards, not general TypeScript control-flow verification. Operand values and truthiness are evaluated separately (171).
167. **Full mode restores independent cold and replay coverage.** `S1_FULL=1` runs the extra uninterrupted 1,008-window replay and
    compares every line to the baseline, in addition to the reload comparison. It checks all 10,000 tie pairs with shared and resident
    caches disabled and fresh per-pair caches. Default mode keeps the sampled tie comparison. The R3 regression probes can be checked
    with compatible, surgical mutations loaded only in memory by `bun run test/sim/check-review-mutations.ts` (173).

### Fix round 3 (entries 168 onward)

168. **One persistent sequence records actual application order. (A1-01, A1-04; S2 v1.10 §4.2, S1 v0.5 §4.7)**
    `S1Record.ord` allocates across every feed publication, belief/divergence update and tie validity boundary. A process computes
    unstamped transitions; its application hook stamps them when the digest is published, between the preceding and following writes.
    Mirrored readings notify divergence immediately, rather than waiting for reconciliation's relevance dispatch. Dependent feed
    entries carrying one atomic source identity (174), aliases of an entry and affected pairs of a mirrored reading share their source
    ordinal. There are no source ranks, per-source counters or read-time reconstruction. Saved ordinals and the next counter survive
    replacement loads. The four transition producers reject lineages with incompatible chronology through their process versions:
    version 3 for shared ordering, and version 4 for `city.events`' atomic regime/price publication.
169. **An opened item's descriptor remains a dependency, not a restored constant. (A1-02)** `Events.restoreEvent` restores participants,
    effects, witnesses, causes, outcome and served from the evidence record with the original materialisation source. For an item with
    summary provenance it leaves `time`, `kind` and `place` to `Summaries.itemConstraint`, creates no fixed place edge and caches no minted
    descriptor. The evidence record still holds the original committed descriptor for provenance, not a permanent override of the
    summary. Repeated reloads and edits after reload preserve that distinction.
170. **Tie history contains only ended intervals; attributes cannot erase chronology. (A1-03, A1-04, A2-01)** Saving captures a finite interval
    only when its end is at or before now. A live edge's scheduled end is not copied into history, so shortening it leaves no stale
    future interval. A reopening clears a preceding end while an attribute write retains it, even if the opening timestamps match.
    Reopening appends a fresh opening ordinal and preserves the completed closing boundary, including after a save/load between those
    writes. Attributes allocate nothing; shortening replaces only the latest interval's superseded end and keeps its opening ordinal.
    Log pruning follows the retained 16 ended intervals, the current edge and
    the coverage floor; there is no independent 64-entry eviction and no fallback to today's counter.
171. **Guard evaluation preserves JavaScript operands. (A1-05)** `||` and `&&` return an operand, using its truthiness; strict equality
    compares those operand values. An unknown operand stays unknown where it could alter the result. A separate truthiness proof can
    still accept `unknown || true` as an early-return condition without claiming its result is the Boolean `true`.
172. **Resident views are immutable shared values. (A1-06)** `ResidentView` is readonly and every resolved view is frozen before either
    cache receives it. Its fields are all scalars, so freezing the object also protects the shared memo across worlds.
173. **Mutation probes must fail at the semantic assertion. (A1-07)** The helper uses small compatible changes to the current sources,
    including reverting only `Kernel.emit`'s snapshot expression for R3-06. A rejected probe requires a nonzero exit, the named failing
    test and that test's explicit semantic-assertion error. Constructor/import errors and failures during setup do not count. The
    checker itself has a regression and a surgical mutation. All 26 probes (13 R3, 10 A1 and 3 A2) reach their intended assertions.
    Validation: 141 targeted tests across 12 files pass, including all six A2 checks, and `bun run check` is clean. The frozen
    digests remain unchanged: v3 `d534e0dcef3f85d27cefa552217152ec`, v4 `da48cabc405ed361ce6ad5f3b895a822`, and S1 transcript
    `158e89e481c3cd72aaf891c55c1c75f1`. Persisted S1 transition ordinals change as required by 168; no golden digest was edited.
    The coordinator owns the guarded full-suite run.

### Fix round 4 (entry 174)

174. **A regime lifecycle change publishes every dependent transition atomically. (A2-02; S2 v1.10 §4.2)** Regime starts and ends attach
    their source identity (`regime-start/<id>` or `regime-end/<id>`) to their regime and price feed entries during generation. Publication
    allocates one shared ordinal per source within each feed window; entries without a source retain independent ordinals. Distinct
    regime changes keep distinct source identities and ordinals even when they share a district and second. The source identity survives
    an outstanding batch's save/load, and already published ordinals survive later publication and replacement loads unchanged.
    Ending a lockdown now replays `lockdown/high` → `none/fair` in one step, so a closing condition `none AND high` never latches.
    Two independent same-second expiries still expose the real state between them. `city.events` is version 4: a version 3 lineage with
    split source transitions is incompatible and opens read-only. Persisted S1 source metadata and ordinal allocation deliberately
    change; the frozen v3, v4 and S1 transcript digests above do not.

### Spec findings for the coordinator (S1)

The ones that need a decision, worst first. The six questions of the first build are ruled in S1 v0.3 (105, 109, 118, 130, 131, 136 above).

- **S0 9.4 (the order of a boundary).** S1 10.2 relies on a step the kernel specification does not list: between the external operations
  and the snapshot, the frame work and the relevance dispatch they queued run to their end (109, 142). S0 should say so.
- **S2 4.2 and the read port (resolved by S2 v1.10).** The port carries transitions from one persistent sequence (123, 155, 163, 168);
  aliases and dependent feed entries of one source transition are evaluated atomically (174).
- **S1 8.4 (assimilate).** "The listener's default reasons for the actor's group" is not defined. The reference uses `attr@1` from the
  listener's side with no constraint visible, which makes everyone dispositional at the default data (150). Is that meant, or is the
  default a table?
- **S1 8.8 (a position's district).** The slice has to place a mirrored position in a district. The real slice has polygons; the
  stand-ins do not, and the reference reads an optional outline (136).
- **S1 2.2 (the record).** The record now holds spans of protection, the facts of the events behind memorable beliefs, the intervals of
  ended ties and the time the divergence log reaches back to (143 to 146); S1 2.2 lists none of them.
- **S1 8.2 (a frame V returns to).** "The frames for the old cell are abandoned and the new ones opened" does not say what opening means for a
  frame that was abandoned earlier under the same Id. The reference opens it afresh (154), the only reading under which a run that goes
  on and a run that is saved and loaded agree, whether or not something hangs from the ended frame.
- **S1 4.7 (reopening a tie).** The spec is silent on a tie that ended and is wanted again. The reference opens it under its Id with
  fresh attributes and keeps the history for reads (145).
- **106 (SF1-I-13).** FX-3 has no cell two steps from `c2`.
- **114 (restated readings).** The spec is silent on whether a reading the game restates after a load is a correction. The reference says
  it is not, unless it changes something or moves from an earlier value.
- **120 (the metamorphic relation).** The totals that must match are the effective ones.
- **117 (queries).** S0 8.3 step 9 enumerates every item of every summary in scope for a query. A world that has run a week made the
  mirror's and the norms process's queries the dearest thing in a window. The pruning keeps the result: it is used only where it is
  proved equal to resolution (review R1 made it so; the independent review found a span resolved under a window).

## S3 core implementation

### Spec findings for the coordinator

Priority order below; finding numbers remain stable. These choices need specification reconciliation, not a maintainer
decision before completing this branch.

**180. S1 residents were not people to S2 or S3.** `xf:resident` extended `core:thing`, so its events could not start a
human-centred pattern or satisfy a person overlay. Inheriting `core:person`'s slots would put `name` and `age` before
`profile` and break their dependency order. `KindDef.classifiesAs` supplies nominal kind compatibility without inheriting
slots; residents classify as `core:person`. Classification is nominal only: `isKind`, `kindsOf`, selectors and generic
kernel queries follow `extends` alone (S0 §2.2). `isCompatibleKind` follows both `extends` and `classifiesAs`, for S3's
pattern/kind checks and S2's explicit fixed/preferred identities and overlays. Unknown targets and classification cycles
fail validation. This is an S0/S1/S3 contract addition for explicit coordinator review.

The original S3 implementation merged nominal classification into structural ancestry. In A1-01c it widened the open
`core:person` casting query to residents, exhausted the 5,000,000-unit allowance and left `npc` unfilled (S2 §5.2);
the latch then stayed empty despite correctly ordered divergence and tie transitions. Restoring `origin/main`'s
`schema.ts` or `sim/world-schema.ts` independently restored the test; restoring `kernel.ts`, `retention.ts` or
`seeding/layer2.ts` did not. The classification boundary now has a direct query regression; A1-01c is unchanged.
Existing slot order, generated values and frozen digests are unchanged.

**175. The chronological buffer is saved state.** S3 v0.3 §6.1 overrides §9.4's older claim that no emission is pending at
a save, but §9.2 omits the buffer's fields. `Layer3State.buffer` copies events, pattern ids and versions; its events are
retention roots. Release is at or before `boundary - maxProducerLag × W`, ordered by occurrence time, occurrence Id and
pattern id. Incomplete expiry and tombstone pruning follow that horizon, so late-published valid stages survive. Completed
candidate deadlines use current game time. Off drops buffered emissions as well as closing frames. Sifting runs in the
kernel's shared budget after dispatch, with at most one emission's atomic overshoot.

**176. Retained event addresses do not reload their fields.** The reconstruction boundary includes the complete event
closure of pool/buffer roots and S2 hand-overs: a `?story` retains its constituent events and their causes after the pool
entry is reclaimed, until the last live or closing consumer finishes. `Layer3State.evidence` keeps those copied descriptors
and restores silently after S1. Summary-item provenance is preserved: time/place remain live summary dependencies.
There is no cut at the story event that delegates its constituent facts back to an unspecified producer. Unreachable
history is released. These mechanical facts are unrelated to the local player-response evidence log. The kernel also
preserves own event constants for every persisted reference category (191).

**181. Non-canon event retention did not follow participants or causes.** The marker followed headers and owned values,
not event simulation constants. Every root category, including pins, frames, edges, memorable beliefs, canon fields,
SeedRecords and outstanding outputs, retains event fields and Id references transitively, without recursive resolution.
Header creator/cause and owned-field owner links also enable event traversal. Ordinary marking and event-field traversal have separate visited sets:
an event first reached through a frame is revisited when another event needs its fields. Adding roots is monotone,
and either root order has the same closure. The frozen control arms remain checked independently.
S2 also roots fixed overlay identities before first casting. Pool `nodes` remains its stage/story events plus buffered
occurrences, with no extra person roots.

**182. SF3-37's narration conflicts with its algorithms.** For `H("fixture", "SF3-37")`, defaults and empty salt, slots
0/1 are `(770, 0.8343770799768483)` and `(4514, 0.9847611045769517)`: neither is live at steady. First live times are
11333 and 21175, so both incidents complete before the first sow. Completing incident 2 at 2500 also extends the same
once tombstone to 3700; redelivery at 2600 cannot start another entry. `script.test.ts` runs the literal script and checks
the actual slots and two distinct sowings. Separate tests check redelivery after expiry. §6/§7's algorithms win over the
fixture prose; no hash, default or deadline was changed to fit it.

**177. S2's fit seam lacked S3's inputs.** The scalar callback lacked document, sow order, node and fragment metadata;
alternates bypassed it. `WorldFitInput` reaches all four draws and collects report terms locally from the same fitter.
The legacy scalar seam retains its existing single-option calls; S3's richer seam only runs with multiple options.
Release hooks keep S2's original closed input shape; S3 gets its play clock from its own sense frames.

**188. Play-clock transitions must precede the director, not just release.** S2 formerly discovered play wakeups in
the arbiter's release step. S3's host now runs S2 expiry/wakeup preparation, drains the kernel and reevaluations, then
ticks the director and resolves a slot before release. Preparation runs once. The old two-argument `advancePlay` path
keeps its existing order when S3 is absent. A fixture checks a one-second window is already cast when S3 ticks at 1.

**178. One exclusion and spine authority.** Settings keeps one canonical typed verb/class/tag/NPC list. The legacy
`SettingsEntry.exclusions` view and SettingsSet wire field are derived from its NPC entries; old writes are translated
at the Settings boundary, and conflicting simultaneous alias writes are refused. Non-NPC typed entries use the optional
`storyExclusions` wire field. This preserves pre-S3 wire encoding and frozen digests without independently writable NPC
lists. S2 casting, cached tentative recasting and preparation of every director-sown role use the same typed NPC source
as S3. S2 and S3 read spine membership through one shared `worldRegistry` port, supplied by S1's reads or replaced by
S3's registry when it explicitly supplies `isSpine`. Attaching only an event-kind registry preserves S1's authority;
`opts.spine` is removed. Exclusions are hard filters, never scores. Effective-document validation checks only fixed
identities and actual casts: an excluded preferred identity does not veto a kit with allowed alternatives. S2's shared
authority filters the candidate set, including after a fresh load (S3B-03).

**183. S2 promises a skeleton classifier but specifies no implementation.** `L2Registry.skeleton` is the pure seam.
Its default reads explicit fragment `features`, declared tone/outcome, an unambiguous offer stake and actual channel;
unknown facets remain absent. Nothing is inferred from V or prose. S4 still owes the full classifier. Evidence fixtures
provide facets as pack metadata and check exact display/response play stamps, sensitivity, exclusions and inertness.

**179. Ambiguous first classes are not certified.** Every possible first channel must agree with `firstClass`; variants
are checked too. A variant cannot change the sowable declaration, escape gig/block caps or fix a spine character. Mixed
classes receive K-4. The six telling forms come from P5 §4.2; follow-up and unknown forms are refused plainly.

**184. Thread merging alone cannot bound pending.** Several released-but-unshown seeds can commit the same anchor and
join one thread. Openings also require `pending.length < maxLive`, preserving §9.2's bound. Closing-only terminal members
reserve neither an unseen opening nor a live slot. No budget withdraws anything V has seen.

**185. SF3-9's quiet rule wins over §5.5's narrower wording.** The fixture forbids every joint while engaged, driving or
speaking; the core applies that guard globally and reports none on a load/first frame. S2 owns the latch. An episode pays
for one rest only: later N-driven peaks do not reuse its long rest. Hold clears are logged on release, expiry and withdrawal.

**186. Meta participants inherit S0's bound.** L-2 refuses patterns that could bind more variables than the kernel's
participant bound (32). Otherwise a valid five-stage chain could mint an unrepresentable story. Pattern activation extends
only this kernel's participant vocabulary and `meta:story` kind, from copied enum data.

**187. Max-wait normalisation has no game-speed input.** S2 supplies duration seconds, not a future game/play conversion.
The reference uses the numeric seconds at its unit clock rate; S2's game-clock hard expiry remains authoritative across
jumps. A variable-speed port needs an explicit conversion contract. Phase logs cite the copied timestamped sense frame
in `inputs`; no kernel event Id is invented for a sense frame.

**189. Outcome consumption is branch state.** S3 §5.2 consumes witnessed closures since the previous tick, but §9.2
omits that position. `Layer3State.consumedOutcomes` saves the sorted closure event ids already consumed. A save between
a closure and its next director tick preserves that pending closure; a save after consumption cannot apply it twice.
Absent fields read as empty, rather than treating every loaded closure as consumed. Session pacing still resets.

**190. Exclusions and lifetimes are checked at use.** Admission first reclaims expired completed entries and reclaimable
sown entries, across both capacity limits, after advancement and before admission. This includes a late emission
that both completes an already-expired candidate and starts a new occurrence. Incomplete expiry uses the chronological
input horizon and its original tombstone formula. Sweeps change storage, never admission decisions. Gate 7 pre-checks the base kit and checks the
actual selected, expanded document inside the sow transaction before commit, including the full fragment closure's
skeleton verbs, tags, envelope classes and soft levels. A refused variant rolls back the seed and bookkeeping. An
unselected excluded alternative does not veto a safe selected document. `telling` and `sowable` have closed core field
sets; `atStage`, `from`, `subject` and unknown additions receive explicit "not supported yet" findings.

**191. The save chain is append-only truth (S0 v4.16 §14.1).** A save records every change to a
record already held by an earlier save, whether or not that record is still retained. Retention selects
only new material to add and what a sweep may drop from live memory; it never hides a saved contribution
or edge ending, or a pin withdrawal. The save writer merges live updates to previously saved records
independently of the retained closure. `currentView()` continues to describe retention-selected live
material, so state comparisons remain independent of when earlier saves occurred. Missing live records
leave their saved history intact. Release never ends or reopens an interval, and a reopened interval keeps its own actual end, even when its start
matches the previous interval or its end lies beyond save time.

Sweeping preserves pending changes to saved contributions until a save records them; once recorded,
orphaned contributions can leave memory only when exact recovery is possible (193). Saved edge history remains
available without becoming a retention root. No synthetic release-time end, validity clamp, separate
release operation, or `releasedEdge()` path remains. This principle supersedes the piecemeal writer and
sweep rules previously in 192–194.

For new event records, retained references still require the event's own simulation constants, never
resolved overlays: seeds, outstanding process output, pins, frames, edges, canon fields and memorable
beliefs all propagate dependencies through creator/cause links and owned fields. A retained event's own
location edge preserves spatial queries without independently rooting that event. Other simulation
contributions and reproducible pack content remain regenerable. Explicit summary-item ownership is an
`EventMaterialised` record (optional snapshot `materialisations`), shared by retention and event views;
participant/effect facts belong to the declared opening process, while time/kind/place remain live
summary dependencies. Ownership is immutable and independent of contribution order.

**192. Recovery is replay (S0 v4.16 §14.1).** A reached reference, regeneration or re-mint triggers recovery. The selected
save view supplies records for that reference's owned tree and origin closure, including its summary
descriptor. Load and recovery call one silent replay path: all selected headers first, then
contributions, provenance and edges, with pins and withdrawals restored together. Recovery installs
only absent records; authoritative live headers, contribution ends, edge intervals, pins and provenance
win. Every header re-creation, including a summary query, replays saved records before new defaults
can be synthesised. An already live header need not have been saved for its named saved contributions
to recover. Load selects its recovery baseline before settling and game reconciliation, so those
paths cannot recover facts from the discarded branch. Normal retention
traversal then follows recovered Id-valued facts, including transitive event dependencies. Seed
registration completes that traversal before returning. Replay emits no changes or relevance and only
bumps the revision when recovery adds data. Saved lookup indexes are lazy and never enumerated as
roots; unrelated history stays absent, and releasing a new reference makes its recovered closure
sweepable again. This replaces the bespoke recovery rules previously in 194, including S3F-01.

`test/process-evidence.test.ts` covers the earlier S3C-02, S3D-01/02, S3E-01/02 and S3F-01 regressions,
retention monotonicity, traversal/insertion order, authoritative partial live records, idempotence,
non-rooting history and end-before-first-save. S3G-01 adds all 16 combinations of incremental/snapshot
mode, optional A reload, sweep and current/future contribution ends; each checks both release/end
orders and retained-consumer controls, B's `ContributionEnded`, resolution at the exclusive end and
whole C-record equality against a fresh B load. S3G-02 withdraws the descriptor's five original pins,
sweeps both descriptor and item before B, and recovers in both root orders with incremental records
and snapshots, with and without a fresh B load. It checks headers, participant facts, provenance,
withdrawals, closure equality, later records and unrelated history. All 18 new test bodies reproduced
the reported semantic failures against the previous source. The source-loader mutation runner also
reverses the new writer, sweep and descriptor selection fixes; stale edge probes now target the shared
writer rather than the removed helper. The S1 generated partition/reload assertion remains unchanged;
an initial full run caught history leaking into the live-state view, and saved-update merging now
belongs exclusively to the writer. Validation: 88 event-persistence tests, `bun run check`, all 53
mutation probes and the guarded full suite pass: 1,269 tests across 78 files in 95.44 seconds, peak
1.1 GB under the 4 GB limit. The project README and fixture index record the coverage.

Both frozen digests are unchanged: v3 `f924d2c9d1159bca85bbfa4cf18dba6c`, v4
`42d5a84e16dde21cc0bca7fe50c01d72`. Neither frozen script changes a previously saved contribution after
its last consumer is released, nor recovers an item before its swept descriptor, so this restructure
changes no record in either frozen transcript. The historical v4.15 addition of referenced-event facts
changed the earlier hashes `d534e0dcef3f85d27cefa552217152ec` / `da48cabc405ed361ce6ad5f3b895a822`
to these current goldens (1,067/1,069 entries); that earlier contract change is not part of this fix.
No game session is needed. Changes remain uncommitted for the coordinator's review and integration.

**193. A sweep drops only what recovery restores exactly (S0 v4.16 §14.1).** Sweeping is a memory
optimisation and may not change a result. Contribution disposal has one predicate, shared by the sweep
and post-save cleanup: the complete record must match the selected save exactly, name explicit targets,
and have saved headers for every target, with none of those targets still live. Pending ends,
contributions whose target headers were never saved, and general rules stay live. In particular an
authored rule's applicability is independent of its origin header's lifetime; sweeping that origin
cannot delete a rule needed by a retained target. These retained records do not become retention roots.
Unsaved contributions and event-owned edges are conservatively kept: the kernel cannot prove that a layer will regenerate
their entire records exactly. Edge disposal requires an exact saved record and saved endpoint headers.
Pending interval or attribute/data changes stay live. Ownership of an unsaved event location survives
its swept header as non-rooting retention metadata, included in staged capture/discard and cleared on load.
Re-creation completes saved replay first, including ends and provenance;
an original event specification never reopens an ended saved contribution.

`test/sweep-replay.test.ts` covers S3H-01's 16 variants (both event APIs, incremental/snapshot saves,
optional A reload and current/future ends), each with no-sweep and reference-first controls; S3H-02's
four variants, with twelve controls, explicit known-live-header recovery and later record equality;
and S3H-03's two variants, with named, unsaved and no-sweep controls and repeated fresh loads. Additional
fixtures check silent header re-mints and selection of the loaded branch before reconciliation.
The current property is specified in 195. It compares an unswept control, a swept execution and a
swept execution with fresh loads after each operation, including complete records at saves. Its raw
root observation includes every retention category; lazy resolution/event/spatial reads use a
separate projection and cannot repair the observed execution. The earlier seed-only observer and
its 14/28 mutation coverage are superseded. S3C-I's named regression assertions remain unchanged.

**194. Recovery belongs inside record operations; event regeneration checks completeness (S3I).**
`contribute` computes the original identity before replaying an absent saved contribution; identical
re-submission returns its saved exclusive end. `endContribution` also recovers by identity. Edge add,
end, reopen and update use the same selected-save recovery authority. The shared header-first replay
installs only absent records and emits nothing; live ends, intervals, attributes and data remain
current. Recovery by record identity restores its reached headers before the record, without requiring
callers to recover a target or register a temporary retention seed.

An event's surviving own constant proves only that constant exists. Regeneration checks the complete
stored description, including participant/effect member fields and all list elements, and restores the
spatial link using the original stored time/place. An ended or reopened edge is returned by identity,
so regeneration cannot reopen or reset its interval. A complete event still ignores changed defaults.

`test/sweep-operations.test.ts` keeps S3I-01's original-spec re-submission and direct-end reproductions
in incremental/snapshot modes, with/without loading A. S3I-02 covers header-first regeneration against
a fresh A load and ended-unsaved-interval preservation against an unswept control, through both event
APIs and both snapshot modes. Extra regressions cover all four edge operations on physically swept
saved edges, and regeneration with one missing member field and a missing edge. The unsaved-event
retention fixture now checks that intervals stay live without rooting the missing header.

The historical S3I hunt passed 2,048 distinct seeds in both snapshot modes (4,096 scenarios), 196,608
generated steps executed in all three runs, 49,052 random saves and 24,556 random fresh loads, plus
initial/final loads. No additional divergence was found after S3I-01/02. It took 987.42 seconds and
peaked at 0.3 GB under the 4 GB guard; the default property took 3.62 seconds. All 60 source-loader
mutation probes reach their intended semantic assertions (four new S3I probes; guard peak 0.2 GB).
`bun run check` and the 21 new operation regressions pass. The guarded full suite passes: 1,315 tests
across 80 files, 191,483 assertions, zero failures, 208.55 seconds, peak 1.1 GB under `--limit 4`
(overlapping the tail of the seed hunt on the shared machine). The earlier S3C-H regressions pass.
Both frozen digests remain unchanged: v3 `f924d2c9d1159bca85bbfa4cf18dba6c`, v4
`42d5a84e16dde21cc0bca7fe50c01d72`; no golden or transcript was edited. Neither script contains the
post-sweep direct-record writes or incomplete unsaved-event regeneration fixed here. Changed-file
link/privacy checks and `git diff --check` pass. No logs or scratch payloads were written in the worktree;
its scoped final footprint is 0.110 GB. This is deterministic offline oracle evidence; no game session is
needed. All changes remain uncommitted for the coordinator.


**195. One reference gate and first-save edits (S3J).** `Persistence.recoverIfSaved` is the semantic
boundary for saved node, event, contribution, edge and pin references. It selects only the current
save, replays headers before facts and provenance, and preserves authoritative live records. Direct
pinning, observation and canonisation enter before inspecting headers or selecting default fields.
The record/header restoration methods are typed return-value adapters over that gate. Predicate
and procedural read facades use it too. Pure identity functions and raw physical storage, replay,
notification and collector hooks do not acquire semantic references. Their explicit inventory below
makes that distinction reviewable: a collector must not resurrect the records it is collecting.
The original S3J AST inventory enumerated 415 public operations; entry 196 extends it to separate facade callables and exported expressions. It resolves nested record types and checks reference methods, including
future methods, against the gate/delegation boundary and this list. Raw Store and PersistedView APIs
are listed individually; adding one also requires an inventory update.
The sibling checks include computed edge identities and withdrawal reads, and reject recovery placed
after a lookup. S1 tie/regard reads, S2 fact reset/closure reads and queued item materialisation use the
same typed gate adapters before inspecting those records.

Non-regenerable first-save edits are independent of retention: edge ends, reopened intervals,
attribute/data patches and own simulation-contribution ends persist even if the record was never
saved. Store metadata remembers each edited record's original identity headers and origin closure,
including after a pre-save sweep. The writer adds these exact records and required headers; none is
a retention root. A new event identity also brings its complete own payload, spatial link, transitive
event dependencies and materialisation provenance, so every saved-reference API can use it without
an author re-supplying a recipe. Dependencies are admitted only alongside a retained or edited event
header; changing an already-saved authored source does not admit unrelated event history. Staged
discard rolls the edit metadata back; replacement load clears it. Unchanged
regenerable facts remain omitted. Previously saved records still merge through the unconditional
saved-update writer, and `currentView()` remains a retention-selected live view.

The default property has eight seeds in both snapshot modes, 48 random operations per scenario and
eight stratified lifecycle templates: 912 generated operations across 16 three-way scenarios. Every
retention-root category participates. Raw retained headers, facts, edge intervals/data, withdrawals,
provenance and pending semantic changes are compared before any lazy reads. Resolution, `readEvent()`
run on a disposable projection with an empty recovery baseline (the history-prefilled spatial observer was superseded by entry 196); serialization
checks that observation leaves every source table, worklist, queue and revision untouched. Expired
unpersisted overlays remain available to challenge event-view provenance, while deliberately ephemeral
overlays are excluded from factual and resolved-value equality. Random targets independently include
never-saved events and their own simulation constants, alongside authored facts.

`test/check-sweep-mutations.ts` runs only this default property against each of the 28 historical S3C-I
source mutations. Import/setup failures and timeouts do not count as detections. Two source-loader
probes also bypass the new recovery route for their original defect: S3F's partial-header probe bypasses
the provenance-read gate, and S3I's contribution re-submission probe bypasses target-validation recovery.
Neither adds an independent data corruption; the original dedicated semantic assertions are unchanged.
The final default-property check rejects **28/28**, with zero missed or invalid probes (guard peak
0.3 GB). Its unmutated standalone run passes in 17.32 seconds; the default remains bounded.
All 60 dedicated source-loader probes also reach their intended semantic assertion failures (guard
peak 0.2 GB). S3J's 22 new operation regressions and the three API guard tests pass.

The first full-suite run exposed two incidental physical-absence expectations in SIM-04 and SIM-07:
each expected an explicitly ended `core:cast` or `xf:tie` edge to disappear after its first save/load.
The new first-save persistence contract instead replays its exact interval. With coordinator and
maintainer approval, only those two residency assertions and their comments were updated. Every later
protection-history, casting and tie-reopening assertion runs unchanged and passes. Added consistency
assertions require the S1 protection union to cover the replayed cast interval and the bounded tie
record to contain exactly the replayed interval, with no duplicate. All nine targeted SIM-04/07/11
tests pass (2.14 seconds); no runtime policy was changed to hide saved records.

After the default property reached the mutation bar, the guarded hunt passed 2,048 distinct seeds in
both snapshot modes (4,096 scenarios): 102,400 generated operations executed in all three runs,
34,740 generated saves and 26,570 counted fresh loads, plus the random sequence's initial/final loads.
It found no further divergence, took 1,363.01 seconds and peaked at 0.4 GB under `--limit 4`. The hunt
used 16 random operations per scenario alongside the same stratified lifecycle grammar; the default
keeps 48. Its one property assertion body made 1,009,135 assertions.

Final validation passes: `bun run check`, the 415-operation API audit, 28/28 default-property probes,
all 60 dedicated mutation probes and the guarded full suite. The suite has **1,340 tests across 81
files, zero failures, 187,950 assertions**, taking **256.96 seconds** with a **1.1 GB** peak under
`--limit 4`. Earlier semantic regressions pass, including the unchanged later SIM-04/07 assertions
and S1 history/edge consistency checks. The default property remains eight seeds, 912 operations
and 17.32 seconds standalone; the multi-seed hunt is opt-in. Both digest tests pass at the authorized
new values below. Changes remain uncommitted for the coordinator; no game session is needed.

**Obsolete S1 probe, confirmed against HEAD.** The legacy S1 mutation runner stops at R3-01 because
removing `Sim.restoreEvidence()` no longer makes its regression fail. The same counterfactual passes
all seven assertions against unmodified HEAD `3b2f9cae`, with every source/test module loaded from
HEAD in memory and the mutation explicitly installed (9.45 seconds, guard peak 0.2 GB). This is
pre-existing overlap, not a new S3J regression: S0 v4.15 and v4.16's saved kernel event facts now
guarantee the fields/provenance that S1 evidence materialisation restored. The ordinary R3-01 test
still passes. With maintainer approval, the S1 mutation suite is not migrated in this round; the
28/28 S3C-I bar and all 60 S3 probes above are separate checks. Possible later simplification: S1's
own evidence capture/materialisation may now be redundant. No defence is removed here. The temporary
HEAD loader was deleted; no logs or baseline source copies remain in the worktree.
Changed-file link/privacy checks and `git diff --check` pass. The scoped worktree footprint is
0.110 GB, with no new scratch payloads; no task-owned logs are retained.

The coordinator authorized new digest goldens after an entry-by-entry comparison against the
pre-S3J source. Both transcripts differ only in saves/loads/record hashes and their counters,
snapshots and inherited headers for three formerly lost ended `core:located-in` edges:

| Save | Newly preserved record | Header effect (both v3 and v4) |
|---|---|---|
| s75 | `d846a8a70604f8fb0b7704b19a95b536` | Adds `c0062ee2c1bf1cbca6645c473f049f8b` (syn:agent); 50 -> 52 ops |
| s185 | `22e6ccf9e427928e829782a8dae15c88` | Adds `b396bed469492493f3b14e565d0f6e3d` (syn:site), inherits c006... instead of adding it again; 103 -> 104 ops |
| s824 | `780b8ccd5e5fd15ae49f30f0d83f0e0c` | Endpoints already saved; 72 -> 73 ops |
| s875 | Inherited c006... header | No repeated HeaderAdded; 27 -> 26 ops |

The other affected save/record hashes are s563, s650 and s865; affected loads select s75, s185,
s563 and s650. Exactly 15 operation transcript entries change in either mode (zero-based v3 indices
50, 59, 144, 165, 286, 299, 537, 540, 543, 632, 724, 812, 832, 854, 860;
v4 indices 51, 60, 145, 166, 287, 300, 539, 542, 545, 634, 726, 814, 834, 856, 862),
plus the seven final save-record entries. No resolution, query, event, belief or frame output moves.
The v3 digest changes `f924d2c9d1159bca85bbfa4cf18dba6c` -> `746601727380a3fdff647f873c91c971`;
v4 changes `42d5a84e16dde21cc0bca7fe50c01d72` -> `8fce55b19462a1e02f03ca5336bd8c16`.
There is no historical data-loss compatibility mode. Both frozen scripts and their entry counts remain
unchanged; only their expected digests and explanatory comments change.

Public reference API inventory (raw entries explicitly identify the physical/data boundary).
S1/S2/S3 retain their own records across sweeps; their data lookups either need no live node state
or delegate to the gated kernel. Their live header reads use `restoreReferencedHeader`. Pure
predicate helpers use the supplied environment; the kernel's environment gates every node accessor.
Schema, hashing and identity arithmetic never inspect live state.

| Public operation | Recovery route |
|---|---|
| `addPredInterests` | pure data, supplied predicate environment or gated kernel delegation |
| `applyEffects` | pure data, supplied predicate environment or gated kernel delegation |
| `applyRejection` | pure data, supplied predicate environment or gated kernel delegation |
| `attachLayer2` | pure data, supplied predicate environment or gated kernel delegation |
| `barredOf` | pure data, supplied predicate environment or gated kernel delegation |
| `Beliefs.activeOf` | recoverIfSaved |
| `Beliefs.aggregate` | recoverIfSaved |
| `Beliefs.drop` | recoverIfSaved |
| `Beliefs.get` | recoverIfSaved |
| `Beliefs.knows` | recoverIfSaved |
| `Beliefs.observe` | recoverIfSaved |
| `Beliefs.restore` | raw: replay hook |
| `Beliefs.set` | recoverIfSaved |
| `Beliefs.tell` | recoverIfSaved |
| `Beliefs.tellAs` | recoverIfSaved |
| `Beliefs.witnessed` | recoverIfSaved |
| `castRole` | via restoreReferencedHeader |
| `chooseFragment` | pure data, supplied predicate environment or gated kernel delegation |
| `claimConflictRead` | pure data, supplied predicate environment or gated kernel delegation |
| `claimsConflict` | pure data, supplied predicate environment or gated kernel delegation |
| `closeSeed` | via restoreEdge |
| `collectInterests` | pure data, supplied predicate environment or gated kernel delegation |
| `commitRoles` | pure data, supplied predicate environment or gated kernel delegation |
| `completeBeat` | pure data, supplied predicate environment or gated kernel delegation |
| `computeWakeups` | pure data, supplied predicate environment or gated kernel delegation |
| `consumeEvent` | pure data, supplied predicate environment or gated kernel delegation |
| `detectIntersections` | pure data, supplied predicate environment or gated kernel delegation |
| `Dispatcher.matchStrength` | recoverIfSaved |
| `Divergence.current` | via restoreReferencedHeader |
| `Divergence.evaluate` | layer-owned data or gated kernel delegation |
| `Divergence.noteBelief` | via restoreReferencedHeader |
| `Divergence.noteReading` | layer-owned data or gated kernel delegation |
| `Divergence.onTick` | layer-owned data or gated kernel delegation |
| `Divergence.transitions` | layer-owned data or gated kernel delegation |
| `dropEndedScenes` | pure data, supplied predicate environment or gated kernel delegation |
| `endRequirement` | pure data, supplied predicate environment or gated kernel delegation |
| `evalAll` | pure data, supplied predicate environment or gated kernel delegation |
| `evalPred` | pure data, supplied predicate environment or gated kernel delegation |
| `evalPredicate` | pure data, supplied predicate environment or gated kernel delegation |
| `eventFacts` | via restoreReferencedHeader |
| `Events.canonRecord` | recoverIfSaved |
| `Events.defaultFields` | recoverIfSaved |
| `Events.forgetMaterialisation` | raw: collector hook |
| `Events.isCanon` | recoverIfSaved |
| `Events.makeCanon` | recoverIfSaved |
| `Events.materialisationOf` | recoverIfSaved |
| `Events.mintedFacts` | recoverIfSaved |
| `Events.mintedSpec` | recoverIfSaved |
| `Events.mintEvent` | recoverIfSaved |
| `Events.publishItem` | recoverIfSaved |
| `Events.restoreEvent` | recoverIfSaved |
| `Events.setCanonRecord` | raw: replay hook |
| `Events.setMaterialisation` | raw: header-first replay hook |
| `Evolution.restore` | raw: replacement replay hook |
| `Evolution.submit` | raw: queues an operation; application uses gated writes |
| `explainPred` | pure data, supplied predicate environment or gated kernel delegation |
| `failBeat` | pure data, supplied predicate environment or gated kernel delegation |
| `fearOf` | pure data, supplied predicate environment or gated kernel delegation |
| `findDelivery` | pure data, supplied predicate environment or gated kernel delegation |
| `Frames.addParent` | raw: frame table is not swept |
| `Frames.ancestorsOrSelf` | raw: frame table is not swept |
| `Frames.checkDilemmas` | raw: frame table is not swept; node reads use resolver environment |
| `Frames.childrenOf` | raw: frame table is not swept |
| `Frames.claim` | recoverIfSaved |
| `Frames.deliveryTargets` | raw: frame table is not swept |
| `Frames.demandTier` | recoverIfSaved |
| `Frames.eligible` | raw: pure frame predicate |
| `Frames.frame` | raw: frame table is not swept |
| `Frames.framesOf` | raw: frame table is not swept |
| `Frames.insert` | raw: replay hook |
| `Frames.isAncestorOrSelf` | raw: frame table is not swept |
| `Frames.isGroupActor` | recoverIfSaved |
| `Frames.open` | recoverIfSaved |
| `Frames.pull` | raw: frame table is not swept |
| `Frames.pullVia` | raw: frame table is not swept |
| `Frames.remove` | raw: frame table is not swept |
| `Frames.setFocus` | recoverIfSaved |
| `Frames.setInterests` | raw: frame table is not swept; selectors are evaluated through the resolver environment |
| `Frames.setParents` | raw: frame table is not swept |
| `Frames.setStatus` | raw: frame table is not swept |
| `Frames.setWeight` | raw: frame table is not swept |
| `Frames.shouldOpen` | recoverIfSaved |
| `Frames.version` | raw: frame table is not swept |
| `Gate.ageClassOf` | layer-owned data or gated kernel delegation |
| `Gate.produce` | layer-owned data or gated kernel delegation |
| `gateFragment` | pure data, supplied predicate environment or gated kernel delegation |
| `Groups.decide` | recoverIfSaved |
| `Groups.isLeader` | recoverIfSaved |
| `Groups.issueOrder` | recoverIfSaved |
| `Groups.memberships` | recoverIfSaved |
| `Groups.membersOf` | recoverIfSaved |
| `Groups.onEdgeChange` | raw: notification hook |
| `Groups.onFrameChange` | raw: notification hook |
| `Groups.strengthOf` | raw: pure edge attribute predicate |
| `Groups.syncMember` | recoverIfSaved |
| `handleDilemma` | pure data, supplied predicate environment or gated kernel delegation |
| `heatOf` | pure data, supplied predicate environment or gated kernel delegation |
| `hookInputs` | pure data, supplied predicate environment or gated kernel delegation |
| `identityNode` | via restoreReferencedHeader |
| `installRequirement` | pure data, supplied predicate environment or gated kernel delegation |
| `instanceNodes` | pure data, supplied predicate environment or gated kernel delegation |
| `isStuck` | pure data, supplied predicate environment or gated kernel delegation |
| `isUnder` | pure data, supplied predicate environment or gated kernel delegation |
| `itemDescriptor` | pure data, supplied predicate environment or gated kernel delegation |
| `itemFieldOps` | pure data, supplied predicate environment or gated kernel delegation |
| `Kernel.addEdge` | via restoreReferencedHeader, restoreEdge |
| `Kernel.address` | recoverIfSaved |
| `Kernel.close` | recoverIfSaved |
| `Kernel.contribute` | via restoreContribution |
| `Kernel.create` | raw: factory, no live state |
| `Kernel.emit` | raw: notification snapshot, no lookup |
| `Kernel.endContribution` | via restoreContribution |
| `Kernel.endEdge` | via restoreEdge |
| `Kernel.isVDrive` | recoverIfSaved |
| `Kernel.matchStrength` | recoverIfSaved |
| `Kernel.mint` | via recoverOrAddHeader |
| `Kernel.mintSilent` | via recoverOrAddHeader |
| `Kernel.mirrored` | via recoverOrAddHeader |
| `Kernel.observeAs` | recoverIfSaved |
| `Kernel.observeReading` | recoverIfSaved |
| `Kernel.open` | recoverIfSaved |
| `Kernel.pin` | recoverIfSaved |
| `Kernel.query` | recoverIfSaved |
| `Kernel.reading` | recoverIfSaved |
| `Kernel.readingAt` | recoverIfSaved |
| `Kernel.reopenEdge` | via restoreEdge |
| `Kernel.resolve` | recoverIfSaved |
| `Kernel.root` | via recoverOrAddHeader |
| `Kernel.submit` | raw: queues an operation; application uses gated writes |
| `Kernel.trace` | recoverIfSaved |
| `Kernel.updateEdge` | via restoreEdge |
| `Kernel.value` | recoverIfSaved |
| `Kernel.withdrawPin` | recoverIfSaved |
| `kernelView` | recoverIfSaved |
| `Layer2.applyMigration` | layer-owned data or gated kernel delegation |
| `Layer2.atomicSow` | layer-owned data or gated kernel delegation |
| `Layer2.claimConflict` | layer-owned data or gated kernel delegation |
| `Layer2.compile` | layer-owned data or gated kernel delegation |
| `Layer2.completeNow` | layer-owned data or gated kernel delegation |
| `Layer2.contentCompleted` | layer-owned data or gated kernel delegation |
| `Layer2.detectIntersections` | layer-owned data or gated kernel delegation |
| `Layer2.directorExcludes` | layer-owned data or gated kernel delegation |
| `Layer2.draw` | layer-owned data or gated kernel delegation |
| `Layer2.evaluate` | layer-owned data or gated kernel delegation |
| `Layer2.explain` | layer-owned data or gated kernel delegation |
| `Layer2.exposedNode` | layer-owned data or gated kernel delegation |
| `Layer2.fitWeights` | layer-owned data or gated kernel delegation |
| `Layer2.installPack` | layer-owned data or gated kernel delegation |
| `Layer2.instance` | layer-owned data or gated kernel delegation |
| `Layer2.isSpine` | layer-owned data or gated kernel delegation |
| `Layer2.layerOf` | layer-owned data or gated kernel delegation |
| `Layer2.marksAt` | layer-owned data or gated kernel delegation |
| `Layer2.notifyReaders` | layer-owned data or gated kernel delegation |
| `Layer2.onDilemma` | layer-owned data or gated kernel delegation |
| `Layer2.onRelevance` | layer-owned data or gated kernel delegation |
| `Layer2.pull` | layer-owned data or gated kernel delegation |
| `Layer2.queueReeval` | layer-owned data or gated kernel delegation |
| `Layer2.readsOf` | layer-owned data or gated kernel delegation |
| `Layer2.record` | layer-owned data or gated kernel delegation |
| `Layer2.registerActor` | layer-owned data or gated kernel delegation |
| `Layer2.renderWords` | via restoreReferencedHeader |
| `Layer2.reply` | layer-owned data or gated kernel delegation |
| `Layer2.respond` | layer-owned data or gated kernel delegation |
| `Layer2.sourceWithdraw` | layer-owned data or gated kernel delegation |
| `Layer2.sow` | layer-owned data or gated kernel delegation |
| `Layer2.sownBy` | layer-owned data or gated kernel delegation |
| `Layer2.sowRequest` | layer-owned data or gated kernel delegation |
| `Layer2.startDirect` | layer-owned data or gated kernel delegation |
| `Layer2.syncRecord` | layer-owned data or gated kernel delegation |
| `Layer2.timingOf` | layer-owned data or gated kernel delegation |
| `Layer2.unregisterActor` | layer-owned data or gated kernel delegation |
| `Layer2.withdraw` | layer-owned data or gated kernel delegation |
| `Layer3.installPatterns` | layer-owned data or gated kernel delegation |
| `Layer3.tick` | layer-owned data or gated kernel delegation |
| `Ledger.aggregate` | layer-owned data or gated kernel delegation |
| `Ledger.carrierNode` | layer-owned data or gated kernel delegation |
| `Ledger.itemsOf` | layer-owned data or gated kernel delegation |
| `linkState` | pure data, supplied predicate environment or gated kernel delegation |
| `marksAt` | pure data, supplied predicate environment or gated kernel delegation |
| `matchPattern` | pure data, supplied predicate environment or gated kernel delegation |
| `namesNode` | pure data, supplied predicate environment or gated kernel delegation |
| `nodeEdgesFrom` | pure data, supplied predicate environment or gated kernel delegation |
| `normsProcess` | via restoreReferencedHeader |
| `onRelevance` | pure data, supplied predicate environment or gated kernel delegation |
| `onRoleLost` | pure data, supplied predicate environment or gated kernel delegation |
| `ownerChain` | pure data, supplied predicate environment or gated kernel delegation |
| `patternFindings` | pure data, supplied predicate environment or gated kernel delegation |
| `People.alive` | layer-owned data or gated kernel delegation |
| `People.blockInfo` | layer-owned data or gated kernel delegation |
| `People.blockOf` | layer-owned data or gated kernel delegation |
| `People.cellOf` | layer-owned data or gated kernel delegation |
| `People.householdId` | layer-owned data or gated kernel delegation |
| `People.isResident` | layer-owned data or gated kernel delegation |
| `People.locate` | layer-owned data or gated kernel delegation |
| `People.neighbourBlocks` | layer-owned data or gated kernel delegation |
| `People.placeOf` | layer-owned data or gated kernel delegation |
| `People.presentAt` | layer-owned data or gated kernel delegation |
| `People.protectedAt` | recoverIfSaved |
| `People.protectedSet` | layer-owned data or gated kernel delegation |
| `People.refOf` | via restoreReferencedHeader |
| `People.residentAt` | layer-owned data or gated kernel delegation |
| `People.residentCount` | layer-owned data or gated kernel delegation |
| `People.residentId` | layer-owned data or gated kernel delegation |
| `People.residentsOfBlock` | layer-owned data or gated kernel delegation |
| `People.spellLen` | layer-owned data or gated kernel delegation |
| `People.stateAt` | layer-owned data or gated kernel delegation |
| `People.view` | via restoreReferencedHeader |
| `People.where` | layer-owned data or gated kernel delegation |
| `PersistedView.apply` | raw: physical storage or saved data, never a semantic reference |
| `PersistedView.fromData` | raw: physical storage or saved data, never a semantic reference |
| `Persistence.canSweepContribution` | raw: exact recoverability predicate |
| `Persistence.canSweepEdge` | raw: exact recoverability predicate |
| `Persistence.currentView` | via marked, eventFacts |
| `Persistence.installPack` | via contribute |
| `Persistence.restoreContribution` | recoverIfSaved |
| `Persistence.restoreEdge` | recoverIfSaved |
| `Persistence.restoreReferencedHeader` | recoverIfSaved |
| `Persistence.save` | via currentView |
| `Persistence.savedHeader` | raw: saved identity lookup used by collector, no live lookup |
| `pickChannel` | pure data, supplied predicate environment or gated kernel delegation |
| `Policies.absorb` | layer-owned data or gated kernel delegation |
| `Policies.attitudeTilt` | layer-owned data or gated kernel delegation |
| `Policies.attribution` | layer-owned data or gated kernel delegation |
| `Policies.belongsToCarrier` | layer-owned data or gated kernel delegation |
| `Policies.changeOf` | layer-owned data or gated kernel delegation |
| `Policies.classNameOf` | layer-owned data or gated kernel delegation |
| `Policies.closeness` | layer-owned data or gated kernel delegation |
| `Policies.defaultReasons` | layer-owned data or gated kernel delegation |
| `Policies.districtOfPlace` | layer-owned data or gated kernel delegation |
| `Policies.encounter` | layer-owned data or gated kernel delegation |
| `Policies.fade` | layer-owned data or gated kernel delegation |
| `Policies.focal` | layer-owned data or gated kernel delegation |
| `Policies.groupOfAffiliation` | layer-owned data or gated kernel delegation |
| `Policies.hear` | layer-owned data or gated kernel delegation |
| `Policies.memorableByRule` | layer-owned data or gated kernel delegation |
| `Policies.observedByV` | recoverIfSaved |
| `Policies.origin` | layer-owned data or gated kernel delegation |
| `Policies.reconcile` | recoverIfSaved |
| `Policies.salienceOf` | layer-owned data or gated kernel delegation |
| `Policies.tellScore` | layer-owned data or gated kernel delegation |
| `Policies.tiedTo` | layer-owned data or gated kernel delegation |
| `Policies.toldBelief` | layer-owned data or gated kernel delegation |
| `Policies.viewEvent` | via restoreReferencedHeader |
| `Policies.witness` | layer-owned data or gated kernel delegation |
| `pressures` | pure data, supplied predicate environment or gated kernel delegation |
| `Protection.capture` | raw: save hook records physically held protection intervals without resurrecting history |
| `Protection.protectedBefore` | recoverIfSaved |
| `Protection.recordedAt` | layer-owned data or gated kernel delegation |
| `Provenance.causeChain` | recoverIfSaved |
| `Provenance.causeOf` | recoverIfSaved |
| `Provenance.explain` | recoverIfSaved |
| `Queries.candidateSet` | recoverIfSaved |
| `Queries.run` | recoverIfSaved |
| `queueClosing` | pure data, supplied predicate environment or gated kernel delegation |
| `readEvent` | recoverIfSaved |
| `Reads.aesthetic` | layer-owned data or gated kernel delegation |
| `Reads.isSpine` | layer-owned data or gated kernel delegation |
| `Reads.tied` | layer-owned data or gated kernel delegation |
| `Reads.tiedAt` | layer-owned data or gated kernel delegation |
| `readSeedFact` | recoverIfSaved |
| `recordClaim` | pure data, supplied predicate environment or gated kernel delegation |
| `reevaluate` | pure data, supplied predicate environment or gated kernel delegation |
| `refreshInterests` | pure data, supplied predicate environment or gated kernel delegation |
| `replyTo` | pure data, supplied predicate environment or gated kernel delegation |
| `requirementNodes` | pure data, supplied predicate environment or gated kernel delegation |
| `Resolver.childOf` | recoverIfSaved |
| `Resolver.effectiveMode` | raw: pure schema/header predicate |
| `Resolver.makeEnv` | recoverIfSaved |
| `Resolver.ownerOf` | recoverIfSaved |
| `Resolver.pinRegion` | raw: pure pin value conversion |
| `Resolver.resolve` | recoverIfSaved |
| `Resolver.resolveWithin` | recoverIfSaved |
| `Resolver.trace` | recoverIfSaved |
| `respondTo` | pure data, supplied predicate environment or gated kernel delegation |
| `Retention.endSeed` | raw: seed table is not swept |
| `Retention.isOwnEventLocation` | raw: collector predicate |
| `Retention.isRetained` | via marked |
| `Retention.isRootEdge` | raw: collector predicate |
| `Retention.maxRetainedMember` | via compute |
| `Retention.pinInEffectNow` | raw: collector predicate |
| `Retention.rootIds` | raw: physical root discovery; marked traversal recovers their dependencies |
| `Retention.setSeed` | via marked |
| `Retention.streamIn` | recoverIfSaved |
| `Retention.streamOut` | recoverIfSaved |
| `Retention.sweepNode` | raw: collector operation |
| `roleVerdict` | pure data, supplied predicate environment or gated kernel delegation |
| `runLadder` | pure data, supplied predicate environment or gated kernel delegation |
| `runMaintenance` | recoverIfSaved |
| `selectorMatches` | pure data, supplied predicate environment or gated kernel delegation |
| `Settings.restore` | raw: replacement replay hook |
| `Settings.set` | recoverIfSaved |
| `Sifter.drop` | layer-owned data or gated kernel delegation |
| `Sifter.hear` | layer-owned data or gated kernel delegation |
| `Sifter.install` | layer-owned data or gated kernel delegation |
| `Sifter.matchClause` | layer-owned data or gated kernel delegation |
| `Sifter.onEvent` | layer-owned data or gated kernel delegation |
| `Sifter.tombstone` | layer-owned data or gated kernel delegation |
| `Sifter.within` | layer-owned data or gated kernel delegation |
| `Sim.childCell` | layer-owned data or gated kernel delegation |
| `Sim.completeDescriptor` | layer-owned data or gated kernel delegation |
| `Sim.eventSpecOf` | layer-owned data or gated kernel delegation |
| `Sim.inheritFor` | layer-owned data or gated kernel delegation |
| `Sim.kindAllowed` | layer-owned data or gated kernel delegation |
| `Sim.logNow` | layer-owned data or gated kernel delegation |
| `Sim.occurrenceOf` | layer-owned data or gated kernel delegation |
| `Sim.remint` | layer-owned data or gated kernel delegation |
| `Sim.reportChance` | layer-owned data or gated kernel delegation |
| `Sim.ringEntry` | layer-owned data or gated kernel delegation |
| `Sim.summaryOfItem` | via restoreReferencedHeader |
| `Sim.why` | layer-owned data or gated kernel delegation |
| `skipBeat` | pure data, supplied predicate environment or gated kernel delegation |
| `sowableFindings` | pure data, supplied predicate environment or gated kernel delegation |
| `sowTemplate` | via restoreReferencedHeader |
| `StagedBatch.query` | recoverIfSaved |
| `StagedBatch.resolve` | recoverIfSaved |
| `StagedBatch.trace` | recoverIfSaved |
| `StagedBatch.value` | recoverIfSaved |
| `standInRecipe` | pure data, supplied predicate environment or gated kernel delegation |
| `startDirect` | pure data, supplied predicate environment or gated kernel delegation |
| `stockRows` | pure data, supplied predicate environment or gated kernel delegation |
| `Store.addContribution` | raw: physical storage or saved data, never a semantic reference |
| `Store.addEdge` | raw: physical storage or saved data, never a semantic reference |
| `Store.addHeader` | raw: physical storage or saved data, never a semantic reference |
| `Store.addPin` | raw: physical storage or saved data, never a semantic reference |
| `Store.contribution` | raw: physical storage or saved data, never a semantic reference |
| `Store.contributionCandidates` | raw: physical storage or saved data, never a semantic reference |
| `Store.contributionsNaming` | raw: physical storage or saved data, never a semantic reference |
| `Store.contributionsOrigin` | raw: physical storage or saved data, never a semantic reference |
| `Store.deletePin` | raw: physical storage or saved data, never a semantic reference |
| `Store.dropNode` | raw: physical storage or saved data, never a semantic reference |
| `Store.edgesFrom` | raw: physical storage or saved data, never a semantic reference |
| `Store.edgesTo` | raw: physical storage or saved data, never a semantic reference |
| `Store.ensureNode` | raw: physical storage or saved data, never a semantic reference |
| `Store.header` | raw: physical storage or saved data, never a semantic reference |
| `Store.isWithdrawn` | raw: physical storage or saved data, never a semantic reference |
| `Store.livePinsOn` | raw: physical storage or saved data, never a semantic reference |
| `Store.localState` | raw: physical storage or saved data, never a semantic reference |
| `Store.membersOfSlot` | raw: physical storage or saved data, never a semantic reference |
| `Store.namedContributions` | raw: physical storage or saved data, never a semantic reference |
| `Store.ownedOf` | raw: physical storage or saved data, never a semantic reference |
| `Store.pin` | raw: physical storage or saved data, never a semantic reference |
| `Store.pinnedSlots` | raw: physical storage or saved data, never a semantic reference |
| `Store.pinsOfNode` | raw: physical storage or saved data, never a semantic reference |
| `Store.pinsOn` | raw: physical storage or saved data, never a semantic reference |
| `Store.recomputeTimeline` | raw: physical storage or saved data, never a semantic reference |
| `Store.recordChanged` | raw: physical storage or saved data, never a semantic reference |
| `Store.removeContribution` | raw: physical storage or saved data, never a semantic reference |
| `Store.removeEdge` | raw: physical storage or saved data, never a semantic reference |
| `Store.removeHeader` | raw: physical storage or saved data, never a semantic reference |
| `submitDelivery` | pure data, supplied predicate environment or gated kernel delegation |
| `Summaries.canonOf` | recoverIfSaved |
| `Summaries.descriptor` | recoverIfSaved |
| `Summaries.itemCandidates` | recoverIfSaved |
| `Summaries.itemConstraint` | recoverIfSaved |
| `Summaries.itemId` | raw: pure identity derivation |
| `Summaries.makeItemCanon` | recoverIfSaved |
| `Summaries.materialise` | recoverIfSaved |
| `Summaries.mintSummary` | recoverIfSaved |
| `Summaries.queueMaterialise` | recoverIfSaved |
| `Summaries.setRecord` | raw: replay hook |
| `Summaries.spanOf` | recoverIfSaved |
| `syncRecord` | pure data, supplied predicate environment or gated kernel delegation |
| `TiePolicy.accepts` | layer-owned data or gated kernel delegation |
| `TiePolicy.applyInteraction` | layer-owned data or gated kernel delegation |
| `TiePolicy.attributionMultiplier` | layer-owned data or gated kernel delegation |
| `TiePolicy.bid` | layer-owned data or gated kernel delegation |
| `TiePolicy.boundaryAt` | layer-owned data or gated kernel delegation |
| `TiePolicy.coverageFloor` | layer-owned data or gated kernel delegation |
| `TiePolicy.edge` | via restoreEdge |
| `TiePolicy.excluded` | layer-owned data or gated kernel delegation |
| `TiePolicy.fall` | layer-owned data or gated kernel delegation |
| `TiePolicy.hasEdge` | layer-owned data or gated kernel delegation |
| `TiePolicy.hear` | layer-owned data or gated kernel delegation |
| `TiePolicy.intervalsOf` | via restoreEdge |
| `TiePolicy.materialise` | via restoreEdge |
| `TiePolicy.noteEdge` | layer-owned data or gated kernel delegation |
| `TiePolicy.record` | layer-owned data or gated kernel delegation |
| `TiePolicy.regardOf` | via restoreEdge |
| `TiePolicy.repair` | layer-owned data or gated kernel delegation |
| `TiePolicy.sociabilityOf` | layer-owned data or gated kernel delegation |
| `TiePolicy.statusOf` | layer-owned data or gated kernel delegation |
| `TiePolicy.strengthOf` | layer-owned data or gated kernel delegation |
| `TiePolicy.transitionsOf` | layer-owned data or gated kernel delegation |
| `Ties.bridge` | layer-owned data or gated kernel delegation |
| `Ties.bridgeBand` | layer-owned data or gated kernel delegation |
| `Ties.fociOf` | layer-owned data or gated kernel delegation |
| `Ties.neighbours` | layer-owned data or gated kernel delegation |
| `Ties.ordinalOf` | layer-owned data or gated kernel delegation |
| `Ties.pFocus` | layer-owned data or gated kernel delegation |
| `Ties.pGeoOfRank` | layer-owned data or gated kernel delegation |
| `Ties.populationOf` | layer-owned data or gated kernel delegation |
| `Ties.rankOf` | layer-owned data or gated kernel delegation |
| `Ties.sharedFoci` | layer-owned data or gated kernel delegation |
| `Ties.tie` | layer-owned data or gated kernel delegation |
| `Ties.tieP` | layer-owned data or gated kernel delegation |
| `Ties.walkingBlocks` | layer-owned data or gated kernel delegation |
| `timingFor` | pure data, supplied predicate environment or gated kernel delegation |
| `transition` | pure data, supplied predicate environment or gated kernel delegation |
| `updateBeats` | pure data, supplied predicate environment or gated kernel delegation |
| `verdictOnNode` | pure data, supplied predicate environment or gated kernel delegation |
| `VFrames.goalId` | layer-owned data or gated kernel delegation |
| `VFrames.journalChanged` | layer-owned data or gated kernel delegation |
| `VFrames.situationId` | layer-owned data or gated kernel delegation |
| `watchFixed` | pure data, supplied predicate environment or gated kernel delegation |
| `weekLines` | via restoreReferencedHeader |
| `windowStates` | pure data, supplied predicate environment or gated kernel delegation |
| `withdrawPending` | pure data, supplied predicate environment or gated kernel delegation |
| `World.cell` | layer-owned data or gated kernel delegation |
| `World.circle` | layer-owned data or gated kernel delegation |
| `World.create` | layer-owned data or gated kernel delegation |
| `World.district` | layer-owned data or gated kernel delegation |
| `World.group` | layer-owned data or gated kernel delegation |
| `World.standingOfCarrier` | layer-owned data or gated kernel delegation |
| `writeKeys` | raw: physical audit classification; never repairs the audited store |
| `writeSeedFact` | recoverIfSaved |


**196. Semantic discovery and callable recovery boundaries (SE-229 to SE-231).**

S0 v4.16 section 14.1 requires discovery to agree before and after a sweep, even when the caller
knows only the place, time or witness rather than the saved event id. `Persistence.discoveryChildren`
and `Persistence.discoveryIdsOfKind` enumerate the union of live and selected-save candidate indexes.
The saved indexes are shared with the existing recovery selector, invalidated on save/load, and never
contribute retention roots. Candidate enumeration preserves authoritative live edge intervals and
snapshots and deduplicates both live and saved kind membership, then enumerates their union in id order
before recovery can add dependent candidates. Resident versus saved-only membership cannot change
candidate order or which shared-allowance/applicable-contribution limit fails first (merge review R1).
Each query frontier or
region candidate is charged before common-gate recovery; temporal and witness reads share one operation
allowance with their nested resolutions. Exhaustion fails instead of yielding an incomplete discovery.

`test/discovery.test.ts` checks the exact O/S/P/E reproduction as three independent reads in incremental
and snapshot modes against unswept and fresh-load controls. Reads start with E physically absent,
recover it without a producer recipe, leave it unretained, and allow it to sweep again. Further checks
cover live edge ends, operation budgets, indirect recovery of another candidate, region discovery and
unrelated saved events remaining absent. Source-loader counterfactuals for each of place/time/witness
fail at their named semantic assertions in both save modes.

The R1 regression saves two events L < H, retains only H and sweeps one execution. H has a second
applicable time contribution with `maxApplicableContributions: 1`. Unswept, swept and replacement-load
executions enumerate [L, H] and `eventsAtTime(0, newOpCtx(4))` fails at the same shared allowance,
rather than letting H's contribution cap win solely because H remains resident. Both incremental and
snapshot saves are covered; the regression fails against the previous resident-first enumeration.
The R1 follow-up's targeted discovery, simulation-property and sweep/replay tests passed (46 pass,
2 statistical skips), as did `bun run check`. The guarded default suite passed 1,343 tests with
8 skips and no failures in 109.58 seconds (4 GB limit, 1.2 GB peak); both frozen digests below are unchanged.

The property observer no longer installs saved headers, contributions, pins, materialisations or edges
in its disposable projection. It compares raw retained closure first, then observes values in that
projection with an empty recovery baseline. Public spatial queries, `Events.eventsAtTime` and
`Beliefs.witnessed` instead run as generated operations on each execution, without preparatory recovery.
Every lifecycle includes save/release/sweep/discovery, rotating the three read orders and sweeping before
each read. Random discovery checks saved event identities, excluding deliberately never-saved producer
recipes; the lifecycle comparisons use complete public results. A saved-ended-contribution re-submission
sequence is stratified too: reducing the random tail to 16 originally missed S3I-01-contribute, and this
sequence restores the full 31/31 mutation bar without relying on longer random luck.

The default property uses eight seeds in both snapshot modes, 20 random operation kinds, 16 random
steps per scenario and eight lifecycle templates: **550 operations, 166 saves and 136 counted loads**.
It rejects **28/28 historical S3C-I probes plus 3/3 SE-229 discovery counterfactuals**, with zero missed or
invalid probes. All **64/64 dedicated source-loader probes** fail at their intended semantic assertion,
including SE-231's facade `kindOf` removal. No setup, import or timeout failure counts as evidence.

The recovery inventory enumerates **482 operations**. It treats object facade callables, returned functions and exported arrows/function
expressions as independent operations. AST walks exclude nested callable bodies when checking their
factory, resolve simple store/argument aliases in lexical scope, and require the lookup's actual input
to be covered by an earlier gate. Counterfactuals reject wrong-argument recovery, factory-only recovery,
aliased table reads and ungated exported expressions. The real `Resolver.makeEnv.kindOf` is audited in
isolation and tested after factory creation followed by a sweep, before any other facade can repair it.
The read facade gates its own argument before inspecting an operation's own-value override.

Default-suite performance was measured under the 4 GB memory guard on the same worktree:

| Check | Before | Current bounded profile |
|---|---|---|
| Full default suite | 1,340 pass / 81 files, **271.62 s**, 1.1 GB peak | Final checkpoint below |
| Sweep/replay property | 26.28 s within baseline suite | 5.81 s standalone, 0.3 GB peak |
| Two size-4 regime witnesses | 4.62 s seed search | 0.29 s using deterministic seeds 21 and 33 |
| Tie symmetry | 4,005 pairs, 1.79 s | 251 stratified pairs, 0.36 s |

No assertion thresholds were relaxed. The frozen 1,000-operation digests and their coverage assertions
remain in the default suite. Repeated digest/transcript mutation/repeat runs, the week-scale E1/E2
fixtures and statistical multi-world metamorphic runs are `S1_FULL=1` checks. Smaller simulation
horizons, population samples and random tails keep their semantic assertions and explicit non-vacuity
checks; the full profile restores the original or larger scale. S3's default crash matrix keeps first,
last and all-boundary reload runs; the full profile also tests every individual boundary. Parsing the
immutable inventory source once avoids repeating the same AST setup for each counterfactual.

The deterministic metamorphic checks (display-name renaming preserves records; `cityScale` preserves
resident views) run in the default suite independently of the full-profile statistical comparisons.

`S1_FULL=1` also runs 2,048 distinct sweep/replay seeds in each snapshot mode (48 random steps plus the
same lifecycle grammar). The existing weekly/manual CI job sets that flag; its timeout is now 120
minutes to accommodate the added hunt. `SWEEP_SEEDS`, `SWEEP_FIRST_SEED` and `SWEEP_STEPS` override
local hunt bounds; `SWEEP_PROGRESS=1` reports progress without writing logs. The property mutation
runner always selects the bounded default profile, regardless of the caller's full-profile flag.

Both frozen digests are unchanged: v3 `746601727380a3fdff647f873c91c971`, v4
`8fce55b19462a1e02f03ca5336bd8c16`. No golden or frozen transcript was edited. These fixes affect
discovery of swept saved history, which those fixed scripts do not exercise. The earlier authorized
S3J migration remains documented in entry 195; there is no digest migration in this checkpoint.

Additional audited operations (including exported function expressions and facade callables):

- `arbTie`: layer-owned data or gated kernel delegation.
- `beatDeliveryId`: layer-owned data or gated kernel delegation.
- `beatSince`: layer-owned data or gated kernel delegation.
- `beatSincePlay`: layer-owned data or gated kernel delegation.
- `castEdgeId`: layer-owned data or gated kernel delegation.
- `castEnforcement`: layer-owned data or gated kernel delegation.
- `closeDeliveryId`: layer-owned data or gated kernel delegation.
- `complies`: layer-owned data or gated kernel delegation.
- `effectEventId`: layer-owned data or gated kernel delegation.
- `fragmentOf`: layer-owned data or gated kernel delegation.
- `globalId`: layer-owned data or gated kernel delegation.
- `goalFrameId`: layer-owned data or gated kernel delegation.
- `instanceId`: layer-owned data or gated kernel delegation.
- `Kernel.isId`: raw: pure type guard.
- `kernelView.aesthetic`: layer-owned data or gated kernel delegation.
- `kernelView.event`: layer-owned data or gated kernel delegation.
- `kernelView.eventKind`: layer-owned data or gated kernel delegation.
- `kernelView.eventKinds`: layer-owned data or gated kernel delegation.
- `kernelView.holds`: layer-owned data or gated kernel delegation.
- `kernelView.isKind`: layer-owned data or gated kernel delegation.
- `kernelView.isSpine`: layer-owned data or gated kernel delegation.
- `kernelView.kind`: recoverIfSaved.
- `Layer2.fitWeights.returned`: layer-owned data or gated kernel delegation.
- `layerOfInstance`: layer-owned data or gated kernel delegation.
- `memberId`: layer-owned data or gated kernel delegation.
- `mintedId`: layer-owned data or gated kernel delegation.
- `newsDeliveryId`: layer-owned data or gated kernel delegation.
- `normsProcess.init`: layer-owned data or gated kernel delegation.
- `normsProcess.run`: via restoreReferencedHeader.
- `offerId`: layer-owned data or gated kernel delegation.
- `originOf`: layer-owned data or gated kernel delegation.
- `outcomeEventId`: layer-owned data or gated kernel delegation.
- `ownedId`: layer-owned data or gated kernel delegation.
- `packRootId`: layer-owned data or gated kernel delegation.
- `Persistence.discoveryChildren`: raw: candidate index only; consumer charges and recovers reached ids.
- `Persistence.discoveryIdsOfKind`: raw: candidate index only; consumer charges and recovers reached ids.
- `readsOf`: layer-owned data or gated kernel delegation.
- `regardEdgeId`: layer-owned data or gated kernel delegation.
- `replyDeliveryId`: layer-owned data or gated kernel delegation.
- `residentType`: layer-owned data or gated kernel delegation.
- `Resolver.makeEnv.charge`: layer-owned data or gated kernel delegation.
- `Resolver.makeEnv.child`: layer-owned data or gated kernel delegation.
- `Resolver.makeEnv.edgesFrom`: recoverIfSaved.
- `Resolver.makeEnv.edgesTo`: recoverIfSaved.
- `Resolver.makeEnv.expandId`: layer-owned data or gated kernel delegation.
- `Resolver.makeEnv.kindOf`: recoverIfSaved.
- `Resolver.makeEnv.ownerOf`: layer-owned data or gated kernel delegation.
- `Resolver.makeEnv.read`: recoverIfSaved.
- `responseEventId`: layer-owned data or gated kernel delegation.
- `roleFrameId`: layer-owned data or gated kernel delegation.
- `rootId`: layer-owned data or gated kernel delegation.
- `seedFactNode`: layer-owned data or gated kernel delegation.
- `seedFactPinId`: layer-owned data or gated kernel delegation.
- `simulatedDistricts`: layer-owned data or gated kernel delegation.
- `sowTemplate.afterExpand`: layer-owned data or gated kernel delegation.
- `sowTemplate.draw`: layer-owned data or gated kernel delegation.
- `sowTemplate.evalPred`: layer-owned data or gated kernel delegation.
- `standInNode`: layer-owned data or gated kernel delegation.
- `stateSince`: layer-owned data or gated kernel delegation.
- `stateSincePlay`: layer-owned data or gated kernel delegation.
- `subKey`: layer-owned data or gated kernel delegation.
- `tieEdgeId`: layer-owned data or gated kernel delegation.
- `watchFrameId`: layer-owned data or gated kernel delegation.

- `Events.eventsAtTime`: recoverIfSaved per budgeted candidate.
