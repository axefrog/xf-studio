# Engine bug: mixed stage and graph patterns reject meta:story

Reproduced in the M3 iteration-3 harness on 26 October 2026. No engine fix is included.

1. Construct the normal M3 run-2 world (named seed `m3c-pilot`, `S-mid-squeezed`, restless).
2. Add the composite vocabulary and graph patterns to its layer-3 options, keeping the old stage patterns.
3. Advance with the normal M3 driver, walking and reporting witnessed incidents.
4. In window 4, a stage match completes. `Sifter.complete` mints `meta:story` without a `data` record. Graph registration has declared that kind's required data schema.

The engine throws `event data refused: meta:story needs its data record`.

Stack (repository-relative):

```
events.ts:204 put
procedural/sifter.ts:215 complete
procedural/sifter.ts:364 onEvent
procedural/sifter.ts:171 boundary
procedural/layer3.ts:371 run
kernel.ts:823 drainWork
kernel.ts:843 tick
kernel.ts:874 settle
m3/driver.ts:143 step
```

Graph-only construction avoids this crash. S3 v0.6 retains compatibility with stage patterns, so mixed operation needs an engine regression and fix, owned separately by the coordinator.
