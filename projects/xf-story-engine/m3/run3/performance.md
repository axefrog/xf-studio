# Run-3 performance evidence

26 October 2026, Bun 1.4.4; offline reference model, not game evidence. The engine bottleneck described here was fixed by `9ca3186e`; see the [resolution and controlled comparison](../../reference/known-issues/run3-performance.md#resolution). Production timings are retained with the run-3 results.

The superseded preflight pair was CPU-bound. It was stopped after discovering that an optional open event role could cast an unrelated cause; its outputs are excluded from the evaluation. E's first game day took 196 seconds; its second completed at 1,228 seconds (1,032 seconds more), with only one delivery by that point. Worker working sets remained below 0.5 GB. These are preflight observations, not production or completed-week timings.

A separate, bounded 109-window sample of the same preflight E world/tempo under the 4 GB guard completed in 121.536 seconds. Bun's CPU profiler reported 122.47 seconds, 16,013 samples and a 1 ms sampling interval. The profiling process's guarded peak was 1.4 GB including profiler overhead.

| Function | Self | Inclusive | Source |
|---|---|---|---|
| structuredClone | 8.9% | 8.9% | native |
| resolve | 1.2% | 39.2% | reference model resolver |
| GraphLedger.refresh (principal sampled frame) | 0.4% | 32.9% | graph thread ledger |
| Run.step | 0.0% | 90.8% | M3 driver |

Inclusive percentages overlap and must not be added. The profile points to engine resolution and ledger work, rather than report generation, as major costs. It does not prove an optimisation's correctness or speedup. No engine change was made.

The raw profiler output contains machine paths and stays in temporary scratch; this page preserves only asset-free, path-free measurements. The bounded sample and production jobs stop at explicit window counts and deadlines. A further engine performance change requires the coordinator's agreement and separate review.
