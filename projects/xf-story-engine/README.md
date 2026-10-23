# XF Story Engine

Procedural gigs, quests and encounters over a level-of-detail world simulation for Cyberpunk 2077. This
project holds the engine's code. Research and design live in [`research/story-engine/`](../../research/story-engine/README.md).

## What is here

[`reference/`](reference/) is the **reference model**: a TypeScript implementation of the kernel
specification [S0 v3](../../research/story-engine/spec/kernel.md), written as the oracle that a later
native core must agree with. It implements everything in S0 except the items deferred in the
specification's section 0.2. Behavioural policies (S1: drive urgency, attribution, rumour telling,
reputation, group decisions, the conflict table's contents) are small stubs, clearly marked, so that the
kernel rules around them can be tested.

- The kernel: identity and BLAKE3 hashing, fdlibm `ln`, the schema and function registry, nodes, edges,
  resolution (constraint arbitration, weights, the flat Gumbel-max draw), pins and time, queries, events
  and summaries, evolution (the boundary order), context frames and relevance, beliefs, groups,
  provenance, retention and the logical persistence record.
- [`reference/SPEC-NOTES.md`](reference/SPEC-NOTES.md) lists every place the specification left a choice
  open and what the reference model chose, worst first.
- The tests include the acceptance fixtures F-1 to F-15 and C-a to C-d, the invariants I-1 to I-15,
  regression tests for the findings of the independent reviews (`test/sr1.test.ts`, SR-01 to SR-13, and
  `test/sr2.test.ts`, SR2-01 to SR2-07; the digest test holds SR-14 and SR2-08), and a **determinism digest**: a fixed script of 1,000 mixed operations whose
  every result, and every saved record, folds into one hash (`test/digest.test.ts`). The script covers
  arbitration, time, queries, relevance and dilemmas, processes, beliefs with telling and evidence,
  summaries with canon items, a group's decisions and orders, and saves and replacement loads with
  branches, snapshots and outstanding process batches. A second implementation that agrees on the
  primitive vectors and the digest agrees on the kernel for what the script exercises; what it leaves out
  (read-only loads, fine-tier processes, `explain`, region scopes, the policy hooks beyond the stub) is
  listed in [`reference/SPEC-NOTES.md`](reference/SPEC-NOTES.md#cross-implementation-check) and left to
  the fixtures and unit tests.
- The layer 2 tests live in `reference/test/s2/`: the R1 acceptance tests and three crash-point sweeps, the
  lint matrix (each lint has a tripping seed and the passing base), casting, the lifecycle, the arbiter,
  predicates, pack lifecycle, property tests, and `fixtures.test.ts`, which indexes SF-1 to SF-64 (50 have
  named tests; the rest name the later capability they wait for). The suite has 705 tests.

- The **v4 core** of S0 (section 20): derives that get the query time, fact, seed and cast kinds with the offer,
  response and seed-outcome events, `outcome` and `served` on events, the `frame` change, routing to layer 2,
  typed `SettingsSet` content, `age-class`, and staged batches (S0 v4.12). The frozen v3 digest runs unchanged, on the v3 schema with frame changes off, with the
  v4 additions switched off; a second frozen digest covers the run with them on.
- **Layer 2** ([`reference/src/seeding/`](reference/src/seeding/)): the core of S2 v1.7 (section 0.3). Seed
  documents and the text form of predicates, the ladder profile, compilation and the core lints, casting with
  claims, the lifecycle and beats, offers and responses, the arbiter (gates, tempo, session states, prepare and
  confirm through a staged batch, display grades, receipts), the exposure ledger, the fit report, and
  persistence through the kernel's seed records. Later capabilities (clocks, short and full forms, plants,
  language-model fields, city reads, the tone, dread and stage lints and the rest of S2 section 0.3's
  "later" list) are refused at compile time with "not supported yet". The R1 scenario (S2 Appendix A) runs end to end through a save and a load.

The one runtime dependency is `@noble/hashes` (BLAKE3). Everything else is ours.

## Running the tests

From `projects/xf-story-engine/reference/`:

```
bun install
bun test
bun x tsc --noEmit
```

The whole suite runs in a few seconds and peaks well under 1 GB. In this repository run heavy commands
under the memory guard (`python tools/memory_guard.py --limit 2 -- bun test`), as the repository rules ask.

## Layout

| Path | Contents |
|---|---|
| `reference/src/` | The kernel, one module per subsystem. `kernel.ts` composes them; `index.ts` exports the public surface. |
| `reference/src/seeding/` | Layer 2: seed documents, predicates, compile and lint, casting, lifecycle, arbiter, effects, persistence. `layer2.ts` composes them. |
| `reference/test/`, `reference/test/s2/` | One test file per subject; `fixtures.test.ts` indexes the acceptance fixtures; `synthetic.ts` is the schema and operation script behind the invariant and digest tests. |
| `reference/SPEC-NOTES.md` | Interpretations of the specification, for its owner to confirm. |
