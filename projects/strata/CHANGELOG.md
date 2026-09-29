# Changelog

XF Strata follows semantic versioning from its first tag. Every change to the public API surface (`tests/api-surface.json`) is noted here.

## 0.1.0 (unreleased)

Changes after the first review (deep review 6):

- Stores: a position is never reissued, and the head never falls, even after a purge of the newest entries (SPEC §19.3); the store conformance suite checks a purge followed by an append.
- `GraphOptions.writeSnapshots` (default true): a read-only graph, such as an inspector, writes nothing to its store.

The first version, built as slice G1 of XF Studio's profiles and graph design.

- The execution kernel: streams, demand specs and demand as a source, the five node kinds, START/END cycles with queued mid-cycle changes, errors as values, drivers whose start returns a process node, child processes, AbortSignal-compatible cancellation tokens with chaining, the erector over a versioned graph-model schema, one operator catalogue for built-ins and scripts, declarable state machines, an inspectable process tree with actors, roles and members.
- The entity layer: node types with value, reference, reference-list, entry and map fields; commits with layering operations; resolution with origins; compensating undo and redo; revert and tags; time views; snapshots and upcasting; compaction primitives and inline collapse; purge; conflicts with fix routes; per-frame trust and disagreement; the inspector's data model and query language; an ordered outbox with recovery, rejection and sync; subscriptions ended by abort signals.
- Storage interfaces and an in-memory store.
- `strata/testing`: simulated sources and store, the seeded scheduler, the reference model, the standard invariants, the simulation harness and shrinker, the entity and kernel scenarios, the store conformance suite and the conformance-vector runners.
- The language-neutral specification (SPEC.md) and 33 conformance vectors.
