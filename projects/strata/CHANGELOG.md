# Changelog

XF Strata follows semantic versioning from its first tag. Every change to the public API surface (`tests/api-surface.json`) is noted here.

## 0.1.0 (unreleased)

Changes after the first review (deep review 6):

- Stores: a position is never reissued, and the head never falls, even after a purge of the newest entries (SPEC §19.3); the store conformance suite checks a purge followed by an append.
- `GraphOptions.writeSnapshots` (default true): a read-only graph, such as an inspector, writes nothing to its store.
- Kernel lifetimes: finished processes are forgotten once their terminal entry is observed (§9.8), a run's effects are forgotten with it, demand-as-source followers with their edge; `Aborter.release()` unlinks finished work from its parents. Nodes take an optional `signal` at creation (seed, combinator, effect, driver) and `Environment.remove` is gone (§8.4). `Environment.cycle` and `inCycle` are read-only; `removeNow`, `setInputsNow` and `startDriver` are no longer public.
- A rewiring keeps the demand edge of every input it keeps (§5.1); a demand spec change primes the consumer (§4.3); releases survive the activation bound (§6.11); every entry and computation in a cycle sees the cycle's start time (§3.2).
- The erector refuses an invalid model whole (code `model`), reports an operator that can't be made (code `operator`), and looks operators and state-machine states up by own names only. `product` counts an absent input as 1.
- Commits: a refused `busy` commit takes no counters; a compaction refuses (`busy`) commits referencing entries it is rolling up and computes its keep set after syncing; a purge waits for queued snapshots and reaches inline-collapsed nodes; store tasks settle from their process state and fail at once after the graph stops; `flush` never hangs.
- Canonical JSON is RFC 8785 (JCS): non-finite numbers throw, `isJson` refuses unpaired surrogates. Resolution in a layer cycle no longer depends on read order (§12.5). Trust ties break by actor ID, never across actors' clocks (§17.5).
- API: `KNode.entries`, `inputs`, `active` and `computes` are read-only views; the node's cycle state is internal (not in the surface). `graph.debugState()` is now `graph[STRATA_DEBUG]()`, with `STRATA_DEBUG` exported from `strata/testing` only.
- Simulation: the kernel scenario keeps only what demand requires, checks K2 on every cycle, and exercises windows demanded through a spec node, host demand, one-shot reads and host nodes ended by their token, with activity and lifetime invariants. Benchmarks: the full fold from empty is measured beside the load from snapshots, and each commit's acknowledgement is awaited and timed.
- The erector also refuses (code `model`) a model whose `params` or `initial` isn't plain data (§10.2), and decides which nodes to release before releasing any (deep review 7, STRATA-16); one new vector (53 in all).
- `EnvironmentOptions.onAppend`; conformance: the kernel runner honours retention and fails on unknown IDs, new steps (`read`, `token`, `listen`, entity `reload`) and expectations (`retains`, `tree`, `actors`), canonical-form vectors (`runCanonicalVector`), the `probe` operator; 19 new vectors (52 in all). The store conformance suite checks a snapshot written after a purge.

The first version, built as slice G1 of XF Studio's profiles and graph design.

- The execution kernel: streams, demand specs and demand as a source, the five node kinds, START/END cycles with queued mid-cycle changes, errors as values, drivers whose start returns a process node, child processes, AbortSignal-compatible cancellation tokens with chaining, the erector over a versioned graph-model schema, one operator catalogue for built-ins and scripts, declarable state machines, an inspectable process tree with actors, roles and members.
- The entity layer: node types with value, reference, reference-list, entry and map fields; commits with layering operations; resolution with origins; compensating undo and redo; revert and tags; time views; snapshots and upcasting; compaction primitives and inline collapse; purge; conflicts with fix routes; per-frame trust and disagreement; the inspector's data model and query language; an ordered outbox with recovery, rejection and sync; subscriptions ended by abort signals.
- Storage interfaces and an in-memory store.
- `strata/testing`: simulated sources and store, the seeded scheduler, the reference model, the standard invariants, the simulation harness and shrinker, the entity and kernel scenarios, the store conformance suite and the conformance-vector runners.
- The language-neutral specification (SPEC.md) and its conformance vectors.
