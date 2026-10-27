# M3 run 3 performance: resolved by 9ca3186e

Observed 26–27 October 2026, Bun 1.4.4 on Windows. Original harness checkpoint: `a3e90787` (rebased as `eec8642c`). This is offline reference-model evidence, not game evidence. The original attempt was stopped without a complete week or blind rating. The engine fix landed in `9ca3186e`; the harness was rebased onto it at `c18e317e`. The first post-fix production matrix completed; its evaluation packet was subsequently superseded by method review. The reviewed replacement regenerates every cell with changed harness semantics.

## Resolution

Fixed by **`9ca3186e`**, measured and independently reviewed on main before the harness rebase. The corrected three-day reproduction took **40.025 seconds**, versus **2,342.026 seconds** for the controlled original-core reproduction (58.5 times faster). These are separate sequential measurements, not a comparison with the concurrently running pair below.

| Day | Corrected incremental seconds | Corrected cumulative seconds |
|---|---|---|
| 1 | 10.174 | 10.174 |
| 2 | 12.004 | 22.178 |
| 3 | 17.847 | 40.025 |

The fix projects the ledger once per refresh, incrementally indexes canonical history and receipt exposure, reuses thread projections, and detaches snapshots. The corrected run peaked at 0.9 GB. After excluding only `diagnostics.seconds`, semantic output is byte-identical: normalized SHA-256 `92e47437fe44f1a685d5cf1b6c4229d3df269a3009438d3e355be15d7f926b25`, with two threads, 194 archived entries, 229 decisions, seven gates and two deliveries. The coordinator also reported a full week at about 3.5 minutes. The controlled timings, equivalence checks and limits are recorded in the [test-performance guide](../PERFORMANCE.md#three-day-benchmark-after-review).

The first post-fix production matrix completed sixteen full weeks with two workers, peaking at 2.5 GB under the 4 GB guard. Individual week times ranged from 206 to 1,669 seconds (3.4–27.8 minutes), depending on world, tempo and player policy. The approximately 3.5-minute calm example is not a bound for every configuration. Those timings describe the superseded harness at `2b565787`; [run-3 results](../../m3/run3/results.md#weeks) retain the replacement matrix's timings. The controlled same-harness equivalence measurement above remains historical evidence for the engine optimisation; it does not claim identical output after later casting and supply corrections. The historical evidence below describes the pre-fix engine.

The reviewed replacement (`reviewed-v5`) completed all sixteen weeks with two workers and a 2.5 GB guarded peak. Its week times range from 362 to 4,254 seconds (6.0–70.9 minutes). The new adapters, nominal casting, optional participation and observation archives change the work and output, so these are not a controlled comparison with the old 40.025-second reproduction. Late-day costs remain substantial: A1's restless/decline milestones were 21, 126, 441, 950, 1,775, 2,877 and 4,254 cumulative seconds. Completion within the three-hour cell deadline does not establish a production performance budget. No further engine optimisation is included in this replacement.

## Pre-fix production-pair timings

The two workers used world `m3c-w0`, arms E/A1, calm tempo, the `engage` policy, state `S-mid-squeezed`, walking enabled, graph-only patterns and the shared atomic adapters. The pair ran under the 4 GB memory guard. Each game day is 144 ten-minute windows, with 100 play seconds per window.

These cumulative wall times and delivery counts were read from the live matrix console. Deliveries count all records emitted by the driver, not completed or perceived threads.

| Game day | E cumulative seconds | E minutes | E deliveries | A1 cumulative seconds | A1 minutes | A1 deliveries |
|---|---|---|---|---|---|---|
| 1 | 306 | 5.1 | 1 | 317 | 5.3 | 1 |
| 2 | 1,457 | 24.3 | 1 | 1,484 | 24.7 | 1 |
| 3 | 3,106 | 51.8 | 2 | 3,139 | 52.3 | 1 |
| 4 | 5,785 | 96.4 | 2 | 5,680 | 94.7 | 1 |

The incremental E day costs were 306, 1,151, 1,649 and 2,679 seconds. A1's were 317, 1,167, 1,655 and 2,541 seconds. Thus days 1/2/3 reached roughly 5/24/52 minutes despite very little delivered content. Worker working sets were approximately 0.4–0.5 GB; the guarded matrix's recorded peak was 1.5 GB.

That attempt and its supervisor were stopped. Neither worker reached its three-hour safety deadline, so this is an interrupted run, not a timeout result. There are no completed cells to resume from this pair. Incomplete cells must restart; the matrix can skip completed week files from later attempts.

The increasing day costs motivated the coordinator's decision to fix engine performance before restarting. Wall times include two concurrent workers and shared-machine load; some validation work overlapped the earlier days. These observations establish the increasing cost in this run, not a formal asymptotic complexity bound or a proven cause.

## Bounded CPU profile

A separate preflight sample of the same E world and calm tempo completed 109 windows in 121.536 seconds. It used `accept-first`, which chooses the same first action as `engage`, and a 120-second loop deadline checked between windows. Bun's profile reported 122.47 seconds, 16,013 samples, a 1 ms sampling interval and 1,506 function entries. Guarded peak memory, including profiler overhead, was 1.4 GB.

| Frame | Self time | Inclusive time |
|---|---|---|
| `structuredClone` | 8.9% | 8.9% |
| `resolve` | 1.2% | 39.2% |
| `GraphLedger.refresh`, principal sampled frame | 0.4% | 32.9% |
| `Run.step` | 0.0% | 90.8% |

Other prominent self-time frames included two `resolveWithin` entries at 7.1% and 6.5%, `sort` at 3.5%, and `bytesToHex` at 3.1%. Inclusive percentages overlap and must not be added.

This profile predates the adapter fix that prevents an optional event role from casting an unrelated cause. Its story outputs were discarded. It is evidence for candidate hot paths, not a day-3 profile of the final adapters or proof that one proposed optimisation will fix the growth. The earlier path-free record is [run-3 performance evidence](../../m3/run3/performance.md). Raw profiles contain machine paths and are kept only in temporary scratch.

## Repeated work in the pre-fix source

In the pre-fix graph path, [Layer3.refresh](../src/procedural/layer3.ts) calls `GraphLedger.refresh` twice: once before checking pending instances and once after filtering or withdrawing them. At the checkpoint these calls are at lines 379 and 399. Pending withdrawals can change state between them; their presence is not proof that the second call can always be removed.

`Layer3.advancePlay` calls `refresh` inside its per-second `tick`, then calls it again after `Layer2.advancePlay` returns. The [M3 driver](../src/m3/driver.ts) invokes `advancePlay` separately for every play second. That normal graph path therefore has four ledger-refresh calls per play second, before additional retirement callbacks and the archive's refresh once per game window. `advancePlay` also calls `flush` after each invocation; `flush` rebuilds retained evidence and copies the layer-3 state. These frequencies are source observations, not instrumented call counts from the profile.

The profile points to resolution, graph-ledger work and copying as useful places to investigate. Any optimisation must preserve perception stamps, pending withdrawals, retention roots, director decisions and replay identities. No engine change is included in the M3 harness checkpoint or this note.

## Exact bounded reproduction

Run **one** of these measurements at a time, outside a quiet window. From `projects/xf-story-engine/reference/`, with dependencies already installed, this command runs E through day 3 and prints the day-1, day-2 and day-3 milestones:

```powershell
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 4 -- bun tools/m3/run3-week.ts m3c-w0 E calm engage ../../../.scratch-m3c/perf-day3 432
```

Python is invoked by its full installed path after environment expansion. The guard and script paths are repository-relative; output stays in the task's scratch directory. The run has a fixed 432-window bound and the harness's three-hour wall-time deadline. To stop at day 2, replace `432` with `288` and use `../../../.scratch-m3c/perf-day2` as the output directory. To measure A1 separately, replace `E` with `A1`.

The JSON output is a bounded diagnostic run, not a completed production week. The single-worker wall time need not match the concurrent-pair table above. A post-fix comparison should use the same seed, arm, policy, window bound, Bun version and machine-load conditions, and compare semantic records as well as elapsed time. The coordinator supplied the fix in `9ca3186e` and rebased this harness onto it; the completed production matrix uses that fix.
