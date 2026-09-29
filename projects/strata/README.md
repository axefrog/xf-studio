# XF Strata

XF Strata (Strata for short) is a standalone reactive stream graph. Every node is a stream of entries, nothing runs without demand, and every change moves through the graph in a glitch-free cycle. On that kernel it keeps an event-sourced graph of typed nodes that reference, fork from and feed from each other to any depth, with compensating undo, views of any past point, compaction, conflicts with fix routes, and deterministic simulation testing. It imports nothing from XF Studio, its first user, and reads no host global, so another project can start from it. MIT licensed, like the repository.

**Status:** 0.1, built as slice G1 of the Studio's [profiles and graph design](../../research/authoring/profiles-and-graph-design.md).

## Concepts

**The kernel.** Five node kinds: **seeds** take observations from outside; **combinators** compute from their inputs; **effects** do synchronous work when an input changes; **drivers** coordinate demand, and starting one returns a **process** node, the observable state of its run; processes carry long-running work and are parents of child processes. A node computes only while something demands it (the latest entry, an entry, a range, a rolling window, a query; a demand spec can itself be a node). A **cycle** starts with observations at seeds; START/END counting makes each node compute once, after all its moving inputs, and an unchanged output ends its branch's work. Wiring changes and observations made during a cycle wait for its end. Failures are error entries, never exceptions. Cancellation is an AbortSignal-compatible token (`Aborter`), chained from parent to child. The **erector** builds subsystems declared as data ([graph model format](schema/graph-model-1.schema.json)) from an operator **catalogue**, including state machines. A driver is an actor.

**The entity layer.** A node type declares fields: values, references (`follow` or `share` on clone, `follows` for derivations), reference lists, entry references and keyed maps, with `inherit: false` identity fields and `unique` fields. A node's stream is its entries; its state is their fold; its effective value resolves own values, then feeds, then its base, then the type's defaults, map key by map key. Commits are atomic batches of edits (create, fork, clone, feed, rebase, detach, apply to source, set, reset, tombstone, rename, trash, restore, revert, tag). Undo appends compensating entries. `graph.at(point)` is a consistent view of the past. Compaction keeps the latest and every referenced entry and rolls up the rest; purge removes a node for good. Rules produce conflicts with fix routes; trust policies per frame of reference resolve other actors' claims.

**Determinism.** Time, randomness, storage and every other source enter through source interfaces. `strata/testing` has seeded simulated sources, a scheduler that owns every pending event, a brute-force reference model, the standard invariants, the simulation harness with a shrinker and the store conformance suite.

## The API

`index.ts` is the public API and `testing.ts` the testing entry point; nothing else is public. The surface is snapshotted from the emitted declarations (`tests/api-surface.json`); a change to it fails the suite until the snapshot is regenerated (`UPDATE_API_SNAPSHOT=1 bun test tests/api-surface.test.ts`) and noted in the commit message.

| Area | Main exports |
|---|---|
| Kernel | `createEnvironment`, `Environment` (`seed`, `combinator`, `effect`, `driver` (each ended by an optional signal), `transaction`, `observe`, `setInputs`, `read`, `connect`, `spawn`, `processTree`), `KNode`, `Driver` (`start(signal)` returns a `Process`), `Process`, `UNCHANGED`, `ErrorValue`, `LATEST` |
| Streams and operators | `map`, `filter`, `scan`, `combine`, `flatMap`, `catalogue`, `standardOperators`, `erector`, `GRAPH_MODEL_SCHEMA` |
| Cancellation | `Aborter`, `StrataSignal`, `anySignal`, `AbortSignalLike` |
| Entity layer | `defineType`, `defineRule`, `defineSource`, `defineSink`, `createGraph` → `commit`, `read`, `resolve`, `origin`, `subscribe`, `subscribeAll`, `subscribePending` (all ended by a signal), `undo`, `redo`, `at`, `history`, `conflicts`, `fix`, `compact`, `collapseInline`, `purge`, `sync`, `recover`, `inspect`, `inspectNode` |
| Storage | `GraphStore` (the interface a host implements), `MemoryStore` |
| Replication | `resolveClaims`, `trustSelf`, `trustTable`, `TrustPolicy`, `FramePolicies` |
| Utilities | `seededRandom`, `canonical`, `equal`, `pathKey`, `fold`, `kindAt`, compaction primitives |
| `strata/testing` | `simulate`, `shrink`, `replay`, `graphScenario`, `kernelScenario`, `referenceModel`, the invariant checks, `Scheduler`, `simClock`, `SimStore`, `SimJobs`, `STORE_CASES`, `STRATA_FAULTS`, `STRATA_DEBUG` |

## Guarantees

- **Glitch freedom:** a node computes at most once per cycle, after every moving input, and only when an input changed, checked on every cycle of the kernel simulation.
- **Exact propagation:** a demanded node's change report lists exactly the paths whose effective value changed, checked against a brute-force reference model on random graphs up to 200 nodes and fork chains 8 deep.
- **Exact undo:** undoing a commit folds each node back to its state before it while the stream only grows.
- **No lost work:** an accepted commit is stored, pending (the host's recovery copy) or rejected, across crashes.
- **Consistent cuts:** a view at a point equals replaying every stream from empty to that point; snapshot plus tail equals the full fold.
- **Budgets:** 10,000 nodes over one million entries load from their snapshots and short tails (about 55,000 entries folded) in about 50 ms of folding (budget 300), and fold from empty, all million entries, in about 175 ms (budget 1,000); a commit on a node shared by 20 subscribed forks returns in about 0.7 ms (budget 2) and is acknowledged by an in-memory store in about 0.8 ms (budget 3).
- **Boundary:** the engine compiles against ES2022 alone and imports nothing outside this folder.

## Minimal example

[`examples/minimal`](examples/minimal/index.ts): two node types, a fork, a feed, a conflict rule, a subscription, a subsystem declared as data and erected by the kernel, and a seeded simulation run.

```sh
bun examples/minimal
```

## Working on it

```sh
bun install                 # typescript and bun types, for the checks
bun test                    # kernel, entity and stream tests, property tests, 1,000 simulated runs, budgets
bun run check               # the engine against ES2022 alone; the tests and example with Bun's types
bun run bench               # the load and commit budgets
bun run sim:long 5000 400   # a longer simulation for the review cadence (under the memory guard)
bun tools/coverage.ts --list uncovered.txt   # branch coverage (every branch outcome of the engine)
bun tools/mutate.ts --survivors survivors.txt # mutation testing: every surviving mutant is a missing test or an equivalent change
bun run coverage:ratchet    # fails if branch coverage fell below the recorded baseline
bun run mutate:ratchet      # fails if the mutation score fell (runs only mutants not yet in the cache)
```

The two quality tools parse the engine with acorn, which isn't a dependency of the package: set `STRATA_ACORN` to an acorn `dist/acorn.mjs` (npm `acorn`, MIT). Run both under the memory guard; the mutation tool also takes `STRATA_GUARD` (`<python>|<memory_guard.py>|<GB>`) to guard each test process, since a mutant can loop or allocate without bound. `tools/quality.json` keeps two baselines: `public`, the suite alone (what CI checks), and `full`, which also counts external conformance tests named by `STRATA_VECTORS`. `--record` records a run's scores and refuses to lower one. The mutation cache is keyed by a hash of each mutant's function and records the test set it ran against, so a rewritten function's mutants run again. Mutants recorded as equivalent, with the reason, are in `tools/equivalent-mutants.md`; branches left uncovered on purpose are listed, with the reason, in `tools/uncovered-branches.md`.

A failing simulation prints its seed and steps; the harness shrinks them to a minimal trace, which goes into `tests/sim/regressions.json` and replays on every run.
