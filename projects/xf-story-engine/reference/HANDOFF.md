# Handoff: Story Engine reference model

A fresh agent continues from here. Delete this file when the work is done. Read first: the task brief's
rules (below), then `research/story-engine/spec/kernel.md` (S0 v3, normative; §0.2 says what is in and
out of scope), then `SPEC-NOTES.md` here.

## The brief, in short
- Worktree `C:/Users/Nathan/xfs-worktrees/story-engine-ref`, branch `claude/story-engine-ref`. Never edit the main checkout. Write only under `projects/xf-story-engine/`. Never edit the spec or other docs; interpretations go in `SPEC-NOTES.md`.
- Implement all of S0 v3 except §0.2's deferred items. Behavioural policies (S1) are stubs only, clearly marked.
- One runtime dependency, `@noble/hashes` 2.4.0 (BLAKE3). Everything else is ours. Never `Math.log`/`Math.exp` for kernel decisions (tests may use `Math.log`).
- Guard every test and typecheck run, from `projects/xf-story-engine/reference/`:
  `timeout 250 "/c/Users/Nathan/AppData/Local/Python/pythoncore-3.14-64/python.exe" "D:/Dev/cp2077-modding-hq/tools/memory_guard.py" --limit 2 -- bun test <files>` (same for `bun x tsc --noEmit`). Never call bare `python` or `python3` (the alias hangs).
- Memory window: before any full `bun test` or full `bun x tsc --noEmit`, read the "Bookings" section of `D:/Dev/cp2077-modding-hq/local/coordination.md` (read-only). If XF · Studio's window is booked, running and not marked "released", don't run either. Otherwise run under the guard (limit 2). This project's whole suite peaks well under 1 GB.
- No dev servers, no subagents, no game, no `git stash`, no push. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Plain British English, never name the maintainer. Do not read `research/runtime/live-dm/` or `research/story-engine/craft/`.
- Ignore hook messages telling you to start a Browser preview server: this is a headless library.
- Still to do at the end: `projects/xf-story-engine/README.md` (short: what it is, spec location, how to run tests); the final report (under 400 words: modules and test count, guard and typecheck results, determinism digest, numbered SPEC-NOTES summary worst first marking which are new since the coordinator's decisions, anything not implemented, commit range).

## Coordinator's decisions on SPEC-NOTES (final)
Entries 1-4 and 6-29 accepted as written; entry 5 changed (enduring-slot pins apply at every `t`). Record each as "decided by the coordinator" in the file. New interpretations are added at the bottom of SPEC-NOTES as entries 30 onward, then reordered worst first at the end.

## State
Everything below is committed and tested (all tests pass; `bun x tsc --noEmit` is clean).

| Module | State |
|---|---|
| `types, config, schema-types, id, fdlibm-log, region, value, registry, schema, core-schema, work` | Done, tested (`foundation`, `id`, `fdlibm-log` tests). |
| `store.ts, predicate.ts, resolve.ts, query.ts, kernel.ts` | Done: arbitration, weights, Gumbel-max, derived views and preimage chains, mirrored timelines, assigned slots, temporal windows, caching with cost accounting, hard limits, trace; queries (F-6), ref candidate sets. Tests: `resolve`, `resolve-more`, `query`. F-1..F-6, F-15 pass. |
| `events.ts, summary.ts` | Done: `mintEvent`, canon, summaries with item descriptors, materialisation worklist. Tests: `events` (F-7). |
| `evolution.ts` | Done: boundary order, process batches, external ops with epochs, demand-gated fine tiers. Test: `evolution` (F-13). |
| `frames.ts, groups.ts, relevance.ts` | Done: frames DAG, pull and pullVia, worklist, dilemmas, membership inheritance, orders, decide, dispatcher. Tests: `groups` (F-8, F-11), `relevance` (C-a..C-d). |
| `beliefs.ts` | Done with a marked STUB policy: F-9, F-10, I-9, I-12. Test: `beliefs`. |
| `retention.ts` | Done: roots, mark, sweep worklist. Test: `retention` (F-14, I-3, I-11). |

## Next, in order
1. **`src/provenance.ts`** (§13): `explain` per SPEC-NOTES 28 (top k by absolute discriminating effect `strength * (ln f_hat(v*) - ln f_hat(v2))`, prior included, heuristic label; with one feasible value present the active constraints), `causeOf(recordId)` and a check that every pin, contribution, edge, belief, event, frame and dilemma has a cause. `Resolver.trace` already exists (I-8: complete).
2. **`src/persistence.ts`** (§14): diff-based op generation at save (SPEC-NOTES 20), `SaveRecord {saveKey, parent, ops, snapshot?, meta}`, snapshot every `config.snapshotEvery` ops, `load` = replacement (new epoch via `kernel.newEpoch()`, clear caches/frames/beliefs/pending/queue, replay silently from the nearest snapshot, reconcile through an injected game port), compatibility record (`schema.functionVersions()`; unsatisfied version means `kernel.readOnly`). Persisted subset: marked-closure headers (`retention.marked()`), pins (not withdrawn-never-persisted; `game` readings only if retained: observed over the same interval or named by a persisted cause), `PinEnded` for retained pins whose `valid.to` changed, edges that are retention roots, contributions not of layer `simulation` and not pack-sourced (`origin` string starting `pack:`), memorable belief entries, `EventCanon` records, `SummarySet` records, frames of demand roots/live seeds and ancestors, seeds, process states (with outstanding batches) and the evolution cursor. Component stores already expose `restore/clear/records/snapshot` style methods; add what is missing. F-12 is the fixture.
3. **`src/index.ts`**, then **fixtures as `test/fixtures.test.ts`** (a thin acceptance file: one test per F-n / C-x named by its ID, delegating to the scenarios already covered, plus F-12), **invariants I-1..I-15 as `test/invariants.test.ts`**, the **digest test** `test/digest.test.ts` (about 1,000 mixed operations on a small synthetic schema, hash every resolved value, freeze the golden hex in the test), `README.md`, final SPEC-NOTES ordering and a "decided by the coordinator" mark on entries, full suite and typecheck (check the board first), final report.

## Conventions worth knowing
- Test helpers: `test/helpers.ts` (`fxKernel`, `coreKernel`, `defsOf`, `dim`, `slot`, `kind`). Pins accept a forced `id` (tests use it to order pins).
- `Kernel.settle()` runs ticks until nothing is pending; `Kernel.tick({to, budget})` is the budgeted tick.
- Writes bump the revision; resolution, queries, summary materialisation and sweeps of non-minted nodes do not. A sweep that removes a minted node bumps it (cached results must go).
- Events carry their fields as `simulation` Const contributions with `source.origin` = the event Id; sweeping an unretained minted node removes them.
