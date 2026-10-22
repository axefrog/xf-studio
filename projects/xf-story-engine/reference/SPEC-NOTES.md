# Spec notes for the reference model

Interpretations made while building the TypeScript reference model of S0 v3
(`research/story-engine/spec/kernel.md`). Each entry gives the section, the issue, the reading chosen,
and why. The coordinator decides afterwards and updates the spec. **This is a draft written at a
checkpoint**: entries marked (planned) are decisions taken for modules not yet written. The module
that implements each one should confirm or amend its entry.

Worst first means: entries that change observable results come before presentation choices. The final
version of this file must be reordered and the determinism-digest note added (see HANDOFF.md).

## Interpretations that change results

1. **Value representation, 1.2 and 2.1.** The spec says a real or cyclic value hashes as its grid
   index, but does not say what the in-memory value is. Reading: a real or cyclic value is held as the
   grid point itself (`min + i * quantum`, or `i * quantum`), a vec as an array of grid points, and only
   the hash uses the index. This keeps predicates such as `field-at-least 0.6` natural. Fixtures use
   power-of-two quanta, so the grid is exact. (implemented: `src/value.ts`)
2. **Canonical value encoding, 1.2.** The spec lists the encoding per value type but not the byte
   layout of strings, Ids and vecs. Reading: a string is its raw UTF-8 bytes, an Id is its 16 bytes, an
   int is i64 little-endian, a real or cyclic is the grid index as i64 little-endian, a vec is its n
   grid indices as consecutive i64 little-endian. `H` adds tag `0x06` before and `0x00` after.
   (implemented: `src/value.ts`, `src/id.ts`)
3. **Hash argument types, 1.4.** `rand("g", worldSeed, node.id, slotPath, k, v)` mixes strings, Ids and
   integers, and a JS string cannot say which. Reading: arguments are explicitly typed (`s`, `i`, `id`,
   `f`, `b`, `val`). `worldSeed` and every `Id` use tag `0x03`; names such as a process id use tag
   `0x01`. (implemented: `src/id.ts`)
4. **toUnit bit order, 1.2.** "The first 52 bits" is read as the first 13 hexadecimal characters of the
   Id, which is the big-endian reading of the first 6.5 bytes. (implemented)
5. **Enduring slots and `t`, 6.2. Changed by the coordinator.** A pin on an enduring slot (no
   `temporal`, not mirrored) applies at **every** time `t`, whatever its `valid.from`; the pin's `at` and
   `valid.from` only record when the fact was learned. Only withdrawal removes it. Pins on mirrored
   timelines and on simulated temporal windows keep the intervals the specification gives them.
   (decided by the coordinator; implemented: `src/resolve.ts`)
6. **`assigned` slots and singleton constraints, 5.1 step 3.** The spec takes the value from "the first
   active value pin". Non-canon events must carry their fields without pins (a pin in effect is a
   retention root, so pinning every minted event would make forgetting impossible). Reading: after
   arbitration, if the feasible set is a single value, that value is the result, whether it came from a
   value pin or from a `Const` constraint. This strictly extends the spec (an active value pin always
   leaves exactly one value). Minted events set their fields with `simulation`-layer `Const`
   contributions. (planned: `src/resolve.ts`, `src/events.ts`)
7. **Derived slots with pins, 5.1 step 1 and I-5.** "If the result violates an active pin, the status is
   `contradiction`." Reading: for a unary view with a preimage, arbitration happens on the input, so the
   derived result is `contradiction` only if a violated pin of precedence 600 or more was rejected
   there. For a multi-input view (or a view without a preimage), any pin in effect on the derived slot
   that the result violates gives `contradiction`, at any precedence, as I-5 states. (planned)
8. **View preimages come from the same node only, 5.2.** Preimage constraints on a slot are collected
   from derived slots of the same node that take it as their single input, chained through views of
   views. A derived slot on another node that reads this slot through the owner chain does not narrow
   it. (planned)
9. **Many slots of non-node types, 1.1 and 2.4.** "Member i of a many slot is `H("gen", ...)` whatever
   its value type." For a `many` slot of a non-node type (witnesses, causes) the element `key[i]` is the
   value resolved at `(owner, "key[i]")`; its Id exists for identity and retention but there is no
   separate node holding it. (planned)
10. **Slot order and the count.** `key#count` sits at the position of its `many` slot for the
    dependency order. Addressing member `i` requires `count > i` at the time. (planned)
11. **Schema load: domain size.** "int/real: at most N_enum values when sampled" is enforced at load for
    `sampled` and `mirrored` slots (a mirrored slot is sampled on a generated node), not for `assigned`
    or `derived` slots, so large integer ranges (times, durations) are `assigned`. (implemented:
    `src/schema.ts`)
12. **Schema load: dependency reads, 2.3.** A derive or conditioned input, or an enum-by `by`, may be
    `key`, `key#count`, or `^/…/key` (owner chain). It may not be a later or same slot, a member
    (`key[i]`), a `node` slot's contents, or a `ref` slot. Owner-chain reads cannot be checked against a
    kind and are checked at resolution. (implemented: `Schema.checkDependencyPath`)
13. **Contribution reads at resolution, 2.3.** Rule `when` predicates, field base slots and selector
    `where` predicates are checked when evaluated: only earlier slots of the node and owner-chain slots.
    A contribution that reads anything else is skipped as not applicable, and a defect is recorded.
    (planned)
14. **Selector scope `under`.** Defined as: the node is the Id, or the Id is in its owner chain, or
    following `core:located-in` edges (valid at `t`) from the node or an owner-chain node reaches the
    Id. For a query, the root of an `under` scope is itself an entry (a candidate if its kind matches).
    (planned)
15. **Candidate-query scopes name the city by root name.** A static schema cannot hold the Id of
    `city` (it depends on the world seed). A scope Id written `root:<name>` is expanded with
    `rootId(worldSeed, name)`. (planned: `src/query.ts`)
16. **`Derive` form.** "One value, for derived slots." Reading: as a `constrain` contribution it acts as
    `Const(derive(inputs))` over the node's resolved earlier slots. (planned)
17. **`Set(region, allow)`.** `allow: false` removes the region from the feasible set (set and interval
    regions only). Set is valid only in `constrain` mode. (planned)
18. **Process pins and reasons, F-13.** Pin reasons are `observed`, `game`, `authored` and `committed`
    only. A process pin uses `committed`. (planned)
19. **Withdrawn pins and persistence, 6.6, 14.1.** All non-withdrawn pins persist except `game` readings
    nobody retained. A reading is retained when V observes it or a persisted record's cause names it.
    (planned: `src/persistence.ts`)
20. **Persistence by diff, 14.2.** The op log is generated at save time by diffing the live persistable
    state against a mirror of what the chain already holds. This yields exactly the listed op kinds,
    keeps the log append-only, and lets retention-dependent rules (headers, retained readings) work
    without logging at every write. Headers are never removed (there is no `HeaderDropped` op).
    (planned)
21. **`knows` and "witnessed", 11.4.** The spec does not say how the kernel knows an observer witnessed
    a subject at `t`. Reading: some event with `time == t` lists the observer in `witnesses` and the
    subject among its participants, effect targets or place. (planned: `src/beliefs.ts`)
22. **Matching.** Bucket predicates are written `<slot>:bucket` (for example `weather:bucket`); `@self`
    is the binding's own Id (so specificity 1.0 "by Id in `where`" can be tested); an empty path or `.`
    is the binding node (for `has-edge`). A selector without `slot` is `'*'`. Specificity is the highest
    that applies. The receiving frame, not the declaring frame, is the `frame` of an emission, and
    dedup is per (change, receiving frame, interest type). (planned: `src/relevance.ts`)
23. **Emission order, 10.5.** "Order of actor (demand roots first), then frame Id": sort key is
    (not a demand root, actor Id, frame Id, interest type, interest index). (planned)
24. **Dilemma frames.** `frameA` is the frame carrying the effect, `frameB` the frame whose interest it
    violates. "Until either frame changes" is tracked with a per-frame version counter. Obligations on a
    membership trigger a check but are not themselves scanned as interests. (planned)
25. **Group frames.** Frames of level `concern` or `goal` on a group actor change only through
    `decide` (attributed to a leader). A parent link from a member's frame to a group concern frame as
    its *child* is refused. Concerns without a family attach to every active situation frame of the
    member. (planned)
26. **Budget overshoot, 10.7.** The first step of a tick is always taken, so an atomic item (a process
    run, one swept node) can overshoot the budget by its own cost. Interest scans are per-interest and
    never overshoot. (implemented: `src/work.ts`)
27. **Summary item place draw, 9.3.** "Drawn among the places under `scope`... with the key
    (`item-p`, S.id, i)": read as a Gumbel-max draw with uniform weights whose noise is
    `rand("item-p", S.id, i, v)`, and whose tie hash is `H("tie", "item-p", S.id, i, v)`. Candidates are
    places strictly under the scope; an empty set leaves the item's place unavailable. (planned)
28. **`explain`, 13.** "Top k by signed discriminating effect" is read as the k largest by absolute
    effect, shown with their sign; the prior is included as an entry. (planned)
29. **Trace.** Includes every feasible value's score and noise (not only the winner and runner-up) so
    F-5 can be checked from it. (planned)

## Cross-implementation check

The determinism digest (a fixed script of about 1,000 mixed operations on a small synthetic schema,
hashing every resolved value) is frozen in `test/digest.test.ts` once written. It is the
cross-implementation check for a later native core. (to do)
