# Reference test profiles and timing

This is offline test evidence, not game-runtime evidence. Measurements use Bun 1.4.4
on the shared Windows development host, under the repository memory guard with a
4 GB per-job limit. The comparison restores the original tracked project and its
imported data in scratch, then runs its default suite and the revised default
suite sequentially. Scratch is removed after recording the results.

The latest validation is in [review corrections after cd601cc2](#review-corrections-after-cd601cc2):
175.10 s for the default suite and 40.025 s for the three-day reproduction.
The independent [offline Holotable producer measurement](#offline-holotable-producer)
also records its end-to-end week throughput and observation checks.

## What was expensive

The SF3-60 default fixture reduced its explicit loop to 14 calls but still settled
across 604,800 seconds. The kernel therefore processed a complete 1,008-window
week in each of six executions. The default now advances 14 actual windows after
the scripted events; all three stances, the active-choice reload, the later reload
and every existing assertion remain. The full profile still advances a week.

The integration fixtures also constructed and repeatedly copied full district
rosters. `kabukiFixture` preserves the cell graph, affiliations and recipes while
reducing density for the default fixtures. Full/soak profiles use the original
index. The M3 world builder accepts an optional fixture index; its evaluation
default is unchanged. Larger FX-3 goal fixtures use four times the base population
by default and the original eight times under `S1_FULL=1`. The retaliation fixture
keeps eight times at both scales because kin exclusion needs another eligible
member after the first draw is excluded.

Two redundant costs were removed without changing the requested work:

- Packet generation reuses each A3 world for its three read-only slot draws,
  instead of constructing the same world three times. Both committed packet
  rebuilds are checked byte for byte in full-profile validation.
- The hunt helper projects the ring fields it needs before copying them. It no
  longer deep-copies the entire event calendar and occurrence metadata on each
  step. Returned nested fields are still detached copies.

## Engine history work

The graph ledger previously resolved every canon event for every refresh, then
`exposedNodeAt` resolved that history again for each masked token argument.
Layer 3 also projected the ledger twice per refresh. Its per-second flush replaced
the retention seed even when its explicit root set was identical, bumping the
kernel revision and immediately retraversing retained history.

The ledger now owns a session-local history index. Fact edits invalidate their
own event, including edits of owned members; canon/replay and materialisation
changes also notify it. Per-node latest own acts and earliest presentations use
incremental extrema with lazy deletion and bounded compaction. Ordinary constant
events are not read again until changed. General rules, descriptors, time-dependent
fields, region pins and extra retained members use the original general reader;
future validity boundaries and backward time changes invalidate cached results.
Loads and staged rollback replace the derived index. The index creates no roots
and is not persisted.

Thread projection reuses unchanged bounded pool and active/closing instance inputs;
age alone updates attended/simmering/dormant status. Archived instance views are
filtered before cloning. The original ring replay under capacity pressure remains.
A second projection is needed only when pending-seed withdrawal changes its inputs.
Flush still saves a detached current snapshot and enforces write authority, but
only replaces the retention seed when its explicit roots change.

Controlled ticks reuse detached pool/evidence snapshot subtrees until their inputs
change; public flush/save boundaries still make a fresh detached snapshot. A
conservative negative-exposure cache avoids resolving constant events whose
participants and witnesses provably exclude the viewer. Rules, time-dependent
fields, extra owned members, observed pins and mutable receipts retain the general
path or invalidate that proof. Ten history regressions check these boundaries.

Receipt fingerprints remain because receipts are mutable plain state, including
in-place grade upgrades. They preserve that interface and are separate from the
large canon-event history. Differential regressions compare the index against the
general readers after receipts, member edits and withdrawals, silent contribution
expiry, time reversal, staged discard, sweeping and reload. A work regression proves
that adding one event leaves 30 previous constant events unread.

## Scale contract

All previous assertions remain; packet cardinality assertions follow the selected
fixture cardinality. No new skips were added. The hunt additionally requires
multiple encounters for its spacing assertion and an ended intention after the
short reload fixture.

| Fixture | Default | `S1_FULL=1` |
|---|---|---|
| S3 graph week | 14 subsequent windows, 10% Kabuki density, all three stances twice | 1,008 windows, original density, all three stances twice |
| E5 | 1 seed × 160 windows, 10% density | 2 seeds × 504 windows, original density |
| E6 | Restless; minimum 180 windows; kill/dwell/payment lag 20/12/24; 10% density | Restless and steady; minimum 560 windows; original 100/48/100 timing and density |
| M3 fit | 25% density for early quiet, 10% for other states; original random-gates span, header 4 windows | Original density, states and 20/10-window spans |
| M3 offers | 25% density; 8 windows; every kit and all four answer policies represented | Original density; 40-window plays, 60-window wording comparisons; every kit under every answer |
| M3 arms, R2, witness units | 25% density; original windows and assertions | Original density, windows and additional witness runs |
| M3 synthetic packet | 2 hooks per source tier; 2 cards per arm; 3 raters | Original 6 hooks per tier, 3 cards per arm, 3 raters |
| Goal fixture population | 4× FX-3; retaliation exclusion fixture 8× | Original 8× FX-3 |
| Goal persistence | Demand 120 windows; reload 60+40; three-way 3×36 | Original 420; 300+200; 6×70 |
| Generated goals | 3×240 windows plus a required confrontation at seed 0, 700 windows, 8× population; removals 2×160 | Original 12×1,100 plus the same bounded confrontation case; removals 8×900 |
| Punish expiry / observed warning / tempo caps | Duration 120 and 240-window expiry run; 240 observed-warning windows; 240 per tempo | Original 400/520, 400 and 700 |
| Encounter / hunt reload | 450 per location; duration 180 and 200 post-load windows | Original 900; original duration and 450 post-load windows |

E6 retains its bounded 500-window extension until payment is complete. E5/E6's
separate `S1_SOAK=1` seed counts, windows and timings remain unchanged. Full-scale
validation runs one file at a time under the guard, including the callers affected
by the shared goal and hunt helpers.

## Frozen run-3 reproduction

The run-3 harness and its M3 inputs were frozen at `cd59ea96` in the read-only
`story-engine-m3c` worktree. Scratch copies ran Arm E, world `m3c-w0`, calm tempo,
engage policy, `S-mid-squeezed`, walk enabled, for 432 windows (144 per day), with
the original 3,000-person world. The baseline core is `9595b6dee0b8a805f4aeb43d7efa49c351364280`.
Each run had a bounded deadline and the 4 GB guard; peak memory was 0.8 GB.

The reproduction command inside each prepared reference scratch copy was
`bun tools/m3/run3-week.ts m3c-w0 E calm engage <output-directory> 432`, wrapped
with the memory guard. Harness-only edits set the deadline and print millisecond
precision cumulative day times. The table converts those to incremental day times.

| Simulated day | Before incremental seconds | After incremental seconds |
|---|---:|---:|
| 1 | 192.825 | 12.035 |
| 2 | 867.449 | 13.545 |
| 3 | 1,281.752 | 23.783 |
| Total | 2,342.026 | 49.363 |

This is a 47.4× reduction. Semantic JSON is byte-identical after removing only
`diagnostics.seconds`; both normalized SHA-256 values are
`92e47437fe44f1a685d5cf1b6c4229d3df269a3009438d3e355be15d7f926b25`.
Both outputs contain two threads, 194 archived entries, 229 decisions, seven gates
and two deliveries. The coordinator accepted the remaining growth as work driven
by live active graphs and scheduled S1 activity, rather than a history rescan.

Follow-up, deliberately deferred: general contribution edits conservatively clear
the negative-exposure cache. Passing changed-slot metadata through fact observers
could avoid invalidating it for unrelated general writes. Any tightening needs
equivalent rule, time, ownership, receipt and rollback regressions; it is not needed
to meet this performance target.

## Measurements at performance checkpoint cd601cc2

On 27 October 2026 the original back-to-back baseline passed in **621.59 s** and the adjacent reduced-profile checkpoint passed in **271.67 s** (43.7% of baseline). The initial baseline before host contention increased was 458.11 s.

The final default run, including the original 20-window random-gates comparison, passed in **165.70 s**, or **26.7% of baseline** (36.2% of the initial baseline). The original suite had 1,669 passes; the final suite adds seven regression tests (1,676 passes, 183,272 assertions). Both have 45 pre-existing skips and zero failures. Host contention changes absolute timings; the coordinator accepted a target of at most 55% of the adjacent baseline. The adjacent original/reduced-profile pair is the controlled comparison; later absolute times remain subject to shared-host load.

Per-file numbers below sum Bun’s per-test timings. They exclude module/describe setup and runner overhead, so only the suite total is end-to-end wall time.

### Fifteen slowest baseline files

| File (under `test/`) | Before (s) | Final after (s) |
|---|---:|---:|
| `s3/graph-week.test.ts` | 125.31 | 2.14 |
| `sim/e2e-v06.test.ts` | 91.78 | 5.64 |
| `m3/run2.test.ts` | 55.77 | 20.89 |
| `m3/offers.test.ts` | 38.26 | 4.34 |
| `m3/fit.test.ts` | 37.38 | 7.09 |
| `sim/v06-punish2.test.ts` | 31.45 | 7.71 |
| `m3/arms.test.ts` | 15.32 | 3.41 |
| `sim/v06-persist.test.ts` | 14.00 | 5.43 |
| `m3/witness.test.ts` | 13.98 | 1.85 |
| `m3/r2.test.ts` | 13.75 | 4.10 |
| `sim/review-fixes.test.ts` | 12.50 | 6.93 |
| `sim/v06-punish.test.ts` | 12.46 | 4.11 |
| `sim/incidents.test.ts` | 10.29 | 5.72 |
| `sim/invariants.test.ts` | 9.89 | 6.26 |
| `sim/v06-properties.test.ts` | 9.19 | 2.54 |

### Fifteen slowest baseline tests

| File and test | Before (s) | Final after (s) |
|---|---:|---:|
| `s3/graph-week.test.ts` — SF3-60: a scripted layered Kabuki week with R2 prime replays every stance | 125.31 | 2.14 |
| `sim/e2e-v06.test.ts` — SF1-E6 (v0.6): a hunt, end to end > at restless: grounds, order, encounters, the end, the protagonist, and identity across per-window runs and reloads | 50.24 | 1.81 |
| `sim/e2e-v06.test.ts` — SF1-E5 (v0.6): the Friday fee under protection > A, B and D agree; collectors work their posts; goals, acts and the protagonist stay within bounds; a run with V at the market differs only in scene.acts | 39.18 | 2.37 |
| `m3/run2.test.ts` — the packet of run 2 > without `tier`, run 1's rule holds: texture and offers alike are hooks | 36.60 | 12.91 |
| `sim/v06-punish2.test.ts` — SF1-D-10: reload in the middle of a hunt > a hunt saved at rung 2, loaded under another epoch, play clock and wall clock: the same climb, duties, acts and end as without the reload | 19.90 | 3.44 |
| `m3/run2.test.ts` — the packet of run 2 > the engine and A1 cards are the hooks with an ask and nothing else; the texture tier is left out | 17.81 | 6.80 |
| `m3/arms.test.ts` — adversarial synthetic players on R2 (B14, first pass) > every policy ends the seed or leaves it answerable, and nothing is gained by farming | 12.75 | 2.94 |
| `m3/offers.test.ts` — the kits played > the world picks the wording: the same kit offered in a crackdown and in a quiet district reads differently | 11.71 | 0.87 |
| `m3/fit.test.ts` — R2 fitted with sowing off and on > S-mid-squeezed: the same fit report with layer 3 absent, attached with tempo off, and sowing on; the same selection and content when declined | 9.71 | 1.60 |
| `s3/graph-persist.test.ts` — SF3-59/new properties: generated incidents agree unswept, swept and with replacement loads | 8.15 | 3.54 |
| `m3/fit.test.ts` — R2 fitted with sowing off and on > S-mid-squeezed, accepting first: the fit is the same, the play is not (the held offer meets a later world and selects another fragment) | 8.13 | 1.03 |
| `sim/v06-properties.test.ts` — goals and intentions under generated scripts (S1 14.3) > random acts of V against a group, a random walk of tempo, warnings observed at random lags or never: no price, search or confront ever precedes an observed warning of its intention, no rung exceeds the tempo in force, and no S1 output harms V | 7.05 | 1.59 |
| `sweep-replay.test.ts` — S3I property: unswept, swept and random fresh replay agree after every operation | 6.30 | 3.96 |
| `sim/v06-punish.test.ts` — SF1-D-5: reach follows tempo > off never starts; calm never above rung 1; steady never above rung 2 | 5.98 | 1.56 |
| `sim/v06-persist.test.ts` — SF1-Y-8: demand independence > two runs with V in different cells, and so a different demand: identical people.goals states, digests, goal frames and goal acts | 5.71 | 2.24 |

### Full-profile confirmations

Each row is a separate guarded `S1_FULL=1 bun test <file>` invocation. This includes unchanged test files reached by the shared helpers, and both committed packet rebuilds.

| File (under `test/`) | Passed | Seconds (guard wall) | Peak GB |
|---|---:|---:|---:|
| `m3/arms.test.ts` | 20 | 9.66 | 0.6 |
| `m3/fit.test.ts` | 11 | 26.18 | 0.8 |
| `m3/offers.test.ts` | 43 | 62.24 | 0.8 |
| `m3/r2.test.ts` | 9 | 9.64 | 0.6 |
| `m3/run2.test.ts` | 5 | 30.69 | 0.7 |
| `m3/witness.test.ts` | 14 | 23.66 | 0.9 |
| `m3/packet.test.ts` | 5 | 33.21 | 0.7 |
| `m3/packet2.test.ts` | 5 | 51.72 | 0.7 |
| `s3/graph-week.test.ts` | 1 | 34.69 | 0.6 |
| `s3/graph-history.test.ts` | 7 | 0.62 | 0.0 |
| `sim/e2e-v06.test.ts` | 4 | 127.86 | 0.8 |
| `sim/v06-punish2.test.ts` | 6 | 21.66 | 0.5 |
| `sim/v06-persist.test.ts` | 4 | 39.20 | 0.8 |
| `sim/v06-properties.test.ts` | 3 | 29.17 | 0.6 |
| `sim/v06-punish.test.ts` | 8 | 9.65 | 0.5 |
| `sim/v06-posts.test.ts` | 7 | 3.62 | 0.4 |
| `sim/review-v06.test.ts` | 13 | 5.13 | 0.5 |
| `sim/v06-groups.test.ts` | 17 | 3.63 | 0.5 |
| `sim/v06-goals.test.ts` | 14 | 2.62 | 0.4 |
| `sim/v06-reads.test.ts` | 6 | 2.64 | 0.4 |

Both frozen kernel digests pass unchanged: v3 `746601727380a3fdff647f873c91c971`, v4 `8fce55b19462a1e02f03ca5336bd8c16`. Both full-profile committed packet rebuilds pass byte for byte. The TypeScript check and `git diff --check` pass.

All 20 individual full-profile invocations passed: 202 tests, zero failures. Their
peak memory stayed at or below 0.9 GB. The default suite peaked at 1.4 GB.

### All default file timings

| File (under `test/`) | Before (s) | Final after (s) |
|---|---:|---:|---:|
| `s3/graph-week.test.ts` | 125.313 | 2.143 |
| `sim/e2e-v06.test.ts` | 91.778 | 5.643 |
| `m3/run2.test.ts` | 55.768 | 20.889 |
| `m3/offers.test.ts` | 38.259 | 4.342 |
| `m3/fit.test.ts` | 37.384 | 7.094 |
| `sim/v06-punish2.test.ts` | 31.448 | 7.711 |
| `m3/arms.test.ts` | 15.320 | 3.406 |
| `sim/v06-persist.test.ts` | 14.000 | 5.428 |
| `m3/witness.test.ts` | 13.983 | 1.845 |
| `m3/r2.test.ts` | 13.755 | 4.104 |
| `sim/review-fixes.test.ts` | 12.497 | 6.930 |
| `sim/v06-punish.test.ts` | 12.459 | 4.108 |
| `sim/incidents.test.ts` | 10.289 | 5.724 |
| `sim/invariants.test.ts` | 9.895 | 6.257 |
| `sim/v06-properties.test.ts` | 9.194 | 2.544 |
| `s3/graph-persist.test.ts` | 8.304 | 3.611 |
| `sim/review-v06.test.ts` | 7.361 | 3.676 |
| `sweep-replay.test.ts` | 6.517 | 4.065 |
| `sim/e2e.test.ts` | 6.443 | 3.395 |
| `s3/e2e.test.ts` | 6.161 | 2.900 |
| `sim/gate.test.ts` | 5.470 | 3.219 |
| `sim/events.test.ts` | 5.086 | 2.932 |
| `sim/v06-posts.test.ts` | 4.270 | 2.625 |
| `sim/v06-groups.test.ts` | 4.249 | 3.147 |
| `sim/properties.test.ts` | 3.691 | 2.850 |
| `sim/acts.test.ts` | 3.279 | 1.453 |
| `sim/v06-audits.test.ts` | 3.252 | 2.125 |
| `sim/reads.test.ts` | 3.061 | 1.807 |
| `sim/v06-reads.test.ts` | 3.011 | 1.385 |
| `sim/witness.test.ts` | 2.991 | 2.178 |
| `sim/v06-goals.test.ts` | 2.845 | 2.135 |
| `sim/ledger-groups.test.ts` | 2.274 | 1.435 |
| `s2/props.test.ts` | 2.183 | 0.993 |
| `sim/week.test.ts` | 2.002 | 1.218 |
| `sim/order.test.ts` | 1.933 | 1.119 |
| `sim/review-round4.test.ts` | 1.844 | 1.061 |
| `invariants.test.ts` | 1.693 | 1.137 |
| `sim/audits.test.ts` | 1.500 | 0.787 |
| `s2/sweep.test.ts` | 1.482 | 0.654 |
| `sim/review-round2.test.ts` | 1.407 | 0.886 |
| `sim/review-round5.test.ts` | 1.234 | 0.753 |
| `sim/people.test.ts` | 1.177 | 0.939 |
| `recovery-api.test.ts` | 1.149 | 0.812 |
| `s3/script.test.ts` | 1.103 | 0.526 |
| `sim/mirror.test.ts` | 1.017 | 0.656 |
| `digest-v4.test.ts` | 0.899 | 0.629 |
| `s3/vectors-graph.test.ts` | 0.867 | 0.479 |
| `sim/v06-items.test.ts` | 0.863 | 0.706 |
| `sim/layer2.test.ts` | 0.798 | 0.514 |
| `s3/properties.test.ts` | 0.746 | 0.311 |
| `digest.test.ts` | 0.721 | 0.518 |
| `process-evidence.test.ts` | 0.718 | 0.379 |
| `sim/v06-outcomes.test.ts` | 0.680 | 0.520 |
| `sim/ties.test.ts` | 0.559 | 0.427 |
| `s2/round2.test.ts` | 0.502 | 0.124 |
| `s2/spec-v17.test.ts` | 0.449 | 0.135 |
| `s2/arbiter.test.ts` | 0.429 | 0.233 |
| `sim/arith.test.ts` | 0.397 | 0.256 |
| `s2/properties-v111.test.ts` | 0.388 | 0.256 |
| `m3/names.test.ts` | 0.382 | 0.327 |
| `sim/v06-misc.test.ts` | 0.368 | 0.301 |
| `s2/r1.test.ts` | 0.368 | 0.155 |
| `s2/life.test.ts` | 0.341 | 0.224 |
| `s2/review.test.ts` | 0.305 | 0.081 |
| `s3/sower.test.ts` | 0.298 | 0.142 |
| `resolve.test.ts` | 0.288 | 0.235 |
| `s3/review-fixes.test.ts` | 0.284 | 0.112 |
| `s3/graph-sower.test.ts` | 0.268 | 0.179 |
| `s2/review-v111.test.ts` | 0.263 | 0.092 |
| `s3/audit.test.ts` | 0.212 | 0.131 |
| `s3/graph.test.ts` | 0.206 | 0.086 |
| `s3/reload.test.ts` | 0.187 | 0.072 |
| `s3/gates.test.ts` | 0.186 | 0.144 |
| `s3/review-graph.test.ts` | 0.184 | 0.096 |
| `sweep-operations.test.ts` | 0.167 | 0.082 |
| `s2/more.test.ts` | 0.166 | 0.089 |
| `s2/vectors-v111.test.ts` | 0.164 | 0.083 |
| `m3/packet2.test.ts` | 0.145 | 0.124 |
| `s3/evidence.test.ts` | 0.139 | 0.071 |
| `s2/findings.test.ts` | 0.121 | 0.099 |
| `s2/lint.test.ts` | 0.110 | 0.059 |
| `blake3-short.test.ts` | 0.095 | 0.074 |
| `s2/encounter-v111.test.ts` | 0.089 | 0.061 |
| `s2/events-v111.test.ts` | 0.072 | 0.042 |
| `s3/sifter.test.ts` | 0.069 | 0.028 |
| `s2/lint-round1.test.ts` | 0.064 | 0.033 |
| `s2/nudge-v111.test.ts` | 0.062 | 0.040 |
| `s2/cast.test.ts` | 0.059 | 0.027 |
| `m3/packet.test.ts` | 0.056 | 0.042 |
| `discovery.test.ts` | 0.042 | 0.024 |
| `s2/pred.test.ts` | 0.035 | 0.014 |
| `s2/pattern-seeds-v111.test.ts` | 0.034 | 0.024 |
| `persistence.test.ts` | 0.032 | 0.024 |
| `resolve-more.test.ts` | 0.031 | 0.017 |
| `s3/fit.test.ts` | 0.029 | 0.018 |
| `beliefs.test.ts` | 0.026 | 0.021 |
| `sr1.test.ts` | 0.023 | 0.018 |
| `fdlibm-log.test.ts` | 0.022 | 0.014 |
| `query.test.ts` | 0.020 | 0.010 |
| `s3/transcript.test.ts` | 0.020 | 0.010 |
| `v417.test.ts` | 0.019 | 0.015 |
| `retention.test.ts` | 0.019 | 0.009 |
| `s2/pattern-lint.test.ts` | 0.018 | 0.015 |
| `relevance.test.ts` | 0.018 | 0.011 |
| `v4-process.test.ts` | 0.016 | 0.023 |
| `v4.test.ts` | 0.016 | 0.011 |
| `sr2.test.ts` | 0.015 | 0.008 |
| `s2/round1.test.ts` | 0.014 | 0.011 |
| `evolution.test.ts` | 0.010 | 0.003 |
| `s3/director.test.ts` | 0.009 | 0.006 |
| `events.test.ts` | 0.008 | 0.008 |
| `sr3.test.ts` | 0.008 | 0.000 |
| `groups.test.ts` | 0.008 | 0.005 |
| `round1.test.ts` | 0.007 | 0.005 |
| `foundation.test.ts` | 0.006 | 0.004 |
| `review-fixes.test.ts` | 0.005 | 0.004 |
| `fixtures.test.ts` | 0.003 | 0.004 |
| `s2/fixtures.test.ts` | 0.002 | 0.001 |
| `id.test.ts` | 0.001 | 0.001 |
| `sim/transcript.test.ts` | 0.000 | 0.000 |
| `s3/graph-history.test.ts` | 0.000 | 0.143 |

### Slowest files and tests after the change

These final-run rankings complement the baseline-ranked comparisons above.

| File (under `test/`) | Final seconds |
|---|---:|
| `m3/run2.test.ts` | 20.889 |
| `sim/v06-punish2.test.ts` | 7.711 |
| `m3/fit.test.ts` | 7.094 |
| `sim/review-fixes.test.ts` | 6.930 |
| `sim/invariants.test.ts` | 6.257 |
| `sim/incidents.test.ts` | 5.724 |
| `sim/e2e-v06.test.ts` | 5.643 |
| `sim/v06-persist.test.ts` | 5.428 |
| `m3/offers.test.ts` | 4.342 |
| `sim/v06-punish.test.ts` | 4.108 |
| `m3/r2.test.ts` | 4.104 |
| `sweep-replay.test.ts` | 4.065 |
| `sim/review-v06.test.ts` | 3.676 |
| `s3/graph-persist.test.ts` | 3.611 |
| `m3/arms.test.ts` | 3.406 |

| Test | Final seconds |
|---|---:|
| `m3/run2.test.ts` — the packet of run 2 > without `tier`, run 1's rule holds: texture and offers alike are hooks | 12.912 |
| `m3/run2.test.ts` — the packet of run 2 > the engine and A1 cards are the hooks with an ask and nothing else; the texture tier is left out | 6.800 |
| `sweep-replay.test.ts` — S3I property: unswept, swept and random fresh replay agree after every operation | 3.957 |
| `s3/graph-persist.test.ts` — SF3-59/new properties: generated incidents agree unswept, swept and with replacement loads | 3.539 |
| `sim/v06-punish2.test.ts` — SF1-D-10: reload in the middle of a hunt > a hunt saved at rung 2, loaded under another epoch, play clock and wall clock: the same climb, duties, acts and end as without the reload | 3.443 |
| `m3/arms.test.ts` — adversarial synthetic players on R2 (B14, first pass) > every policy ends the seed or leaves it answerable, and nothing is gained by farming | 2.935 |
| `sim/e2e-v06.test.ts` — SF1-E5 (v0.6): the Friday fee under protection > A, B and D agree; collectors work their posts; goals, acts and the protagonist stay within bounds; a run with V at the market differs only in scene.acts | 2.371 |
| `sim/v06-persist.test.ts` — SF1-Y-8: demand independence > two runs with V in different cells, and so a different demand: identical people.goals states, digests, goal frames and goal acts | 2.241 |
| `s3/e2e.test.ts` — Kabuki S1 → completed pattern → S2 sow, cast, release; crash at every window boundary | 2.162 |
| `s3/graph-week.test.ts` — SF3-60: a scripted layered Kabuki week with R2 prime replays every stance | 2.143 |
| `sim/v06-audits.test.ts` — SF1-A-6: the outcome of an item at opening > a shakedown item is opened with outcomeOf keyed by its Id, contributed with its other fields; a failed one carries no take; a reload puts the contributions back and publishes nothing again | 2.011 |
| `sim/v06-persist.test.ts` — the three-way property over goals, posts, items and intentions > unswept, swept and reloaded runs of the same world agree, window after window and at the end | 1.994 |
| `sim/e2e-v06.test.ts` — SF1-E6 (v0.6): a hunt, end to end > at restless: grounds, order, encounters, the end, the protagonist, and identity across per-window runs and reloads | 1.813 |
| `sim/e2e.test.ts` — SF1-E3: the mirror overriding a simulated value with a game reading > derived events, the game's reading, the corrections and the abandoned state of mv; the same records in one call, in per-window calls and across a reload | 1.704 |
| `m3/fit.test.ts` — R2 fitted with sowing off and on > S-early-quiet: the same fit report with layer 3 absent, attached with tempo off, and sowing on; the same selection and content when declined | 1.603 |

## Review corrections after cd601cc2

The review identified two incorrect derived-history caches and a vacuous confrontation branch. All three were reproduced before correction:

- Clock-driven time/participant contributions left a removed cited participant known at 5 while the general reader returned undefined. Separate canon and non-canon regressions now compare the index, save, and reload.
- A materialised summary item with a complete ordinary field view but no EventProvenance retained its old scope-derived place. The regression exercises the header/summary-owner dependency directly.
- The positive confrontation assertion failed with zero confrontations at seed 0, 240 windows and 4× population. An additional seed-0 case at 700 windows and the original 8× population now requires a confrontation and runs all the original effect, warning, intention and tempo assertions. The three small runs and twelve full-profile runs are retained.

Receipt projections now rebuild on clock or kernel-revision changes, and on projection notifications, including non-canon citations. Receipt-only invalidation also advances the history version so consumers cannot reuse stale projections. Summary items identified by minted header origin and summary owner remain volatile even without EventProvenance.

The final guarded default suite passed in **175.10 s**, **28.2% of the 621.59 s baseline** (38.2% of the initial 458.11 s baseline). It has 1,680 passes, 45 pre-existing skips, zero failures and 183,356 assertions across 121 files. Guard wall time was 175.571 s and peak memory 1.4 GB. Shared-host load still limits absolute cross-run comparisons.

TypeScript and `git diff --check` passed. Both frozen kernel digest tests passed unchanged: v3 `746601727380a3fdff647f873c91c971`, v4 `8fce55b19462a1e02f03ca5336bd8c16`.

### Updated fifteen slowest baseline files

| File (under `test/`) | Original before s | Corrected after s |
|---|---:|---:|
| `s3/graph-week.test.ts` | 125.31 | 2.48 |
| `sim/e2e-v06.test.ts` | 91.78 | 6.94 |
| `m3/run2.test.ts` | 55.77 | 21.05 |
| `m3/offers.test.ts` | 38.26 | 4.61 |
| `m3/fit.test.ts` | 37.38 | 7.52 |
| `sim/v06-punish2.test.ts` | 31.45 | 7.74 |
| `m3/arms.test.ts` | 15.32 | 3.47 |
| `sim/v06-persist.test.ts` | 14.00 | 7.07 |
| `m3/witness.test.ts` | 13.98 | 1.58 |
| `m3/r2.test.ts` | 13.75 | 4.25 |
| `sim/review-fixes.test.ts` | 12.50 | 7.58 |
| `sim/v06-punish.test.ts` | 12.46 | 4.31 |
| `sim/incidents.test.ts` | 10.29 | 6.27 |
| `sim/invariants.test.ts` | 9.89 | 6.40 |
| `sim/v06-properties.test.ts` | 9.19 | 4.93 |

### Updated fifteen slowest baseline tests

| File and test | Original before s | Corrected after s |
|---|---:|---:|
| `s3/graph-week.test.ts` — SF3-60: a scripted layered Kabuki week with R2 prime replays every stance | 125.31 | 2.48 |
| `sim/e2e-v06.test.ts` — SF1-E6 (v0.6): a hunt, end to end > at restless: grounds, order, encounters, the end, the protagonist, and identity across per-window runs and reloads | 50.24 | 2.50 |
| `sim/e2e-v06.test.ts` — SF1-E5 (v0.6): the Friday fee under protection > A, B and D agree; collectors work their posts; goals, acts and the protagonist stay within bounds; a run with V at the market differs only in scene.acts | 39.18 | 2.88 |
| `m3/run2.test.ts` — the packet of run 2 > without `tier`, run 1's rule holds: texture and offers alike are hooks | 36.60 | 12.92 |
| `sim/v06-punish2.test.ts` — SF1-D-10: reload in the middle of a hunt > a hunt saved at rung 2, loaded under another epoch, play clock and wall clock: the same climb, duties, acts and end as without the reload | 19.90 | 3.59 |
| `m3/run2.test.ts` — the packet of run 2 > the engine and A1 cards are the hooks with an ask and nothing else; the texture tier is left out | 17.81 | 6.98 |
| `m3/arms.test.ts` — adversarial synthetic players on R2 (B14, first pass) > every policy ends the seed or leaves it answerable, and nothing is gained by farming | 12.75 | 2.98 |
| `m3/offers.test.ts` — the kits played > the world picks the wording: the same kit offered in a crackdown and in a quiet district reads differently | 11.71 | 0.99 |
| `m3/fit.test.ts` — R2 fitted with sowing off and on > S-mid-squeezed: the same fit report with layer 3 absent, attached with tempo off, and sowing on; the same selection and content when declined | 9.71 | 1.65 |
| `s3/graph-persist.test.ts` — SF3-59/new properties: generated incidents agree unswept, swept and with replacement loads | 8.15 | 3.73 |
| `m3/fit.test.ts` — R2 fitted with sowing off and on > S-mid-squeezed, accepting first: the fit is the same, the play is not (the held offer meets a later world and selects another fragment) | 8.13 | 1.25 |
| `sim/v06-properties.test.ts` — goals and intentions under generated scripts (S1 14.3) > random acts of V against a group, a random walk of tempo, warnings observed at random lags or never: no price, search or confront ever precedes an observed warning of its intention, no rung exceeds the tempo in force, and no S1 output harms V | 7.05 | 1.83 |
| `sweep-replay.test.ts` — S3I property: unswept, swept and random fresh replay agree after every operation | 6.30 | 3.85 |
| `sim/v06-punish.test.ts` — SF1-D-5: reach follows tempo > off never starts; calm never above rung 1; steady never above rung 2 | 5.98 | 1.59 |
| `sim/v06-persist.test.ts` — SF1-Y-8: demand independence > two runs with V in different cells, and so a different demand: identical people.goals states, digests, goal frames and goal acts | 5.71 | 3.28 |

### Full-profile confirmations after review

Each file ran alone under the 4 GB guard with `S1_FULL=1`. The history file also passed its targeted default run (10 tests, 214 assertions).

| File | Passed | Bun seconds | Guard wall seconds | Peak GB |
|---|---:|---:|---:|---:|
| `test/s3/graph-history.test.ts` | 10 | 0.210 | 0.668 | 0.0 |
| `test/s3/graph-week.test.ts` | 1 | 40.310 | 40.744 | 0.6 |
| `test/s3/graph-persist.test.ts` | 4 | 37.880 | 38.233 | 0.7 |
| `test/sim/v06-properties.test.ts` | 4 | 29.140 | 29.702 | 0.6 |

### Three-day benchmark after review

The frozen `cd59ea96` harness and M3 sources were restored into scratch copies of the `cd601cc2` core and the corrected core. Both ran sequentially under the 4 GB guard, using the same original-size world and 432-window command documented above. Only the harness deadline (15 minutes) and millisecond day logging changed.

| Day | cd601cc2 incremental s | Corrected incremental s |
|---|---:|---:|
| 1 | 10.207 | 10.174 |
| 2 | 11.856 | 12.004 |
| 3 | 17.573 | 17.847 |
| Total | 39.636 | 40.025 |

The corrected core is 1.010× the adjacent pre-review run and 58.5× faster than the original 2,342.026 s engine measurement. The corrected run peaked at 0.9 GB (pre-review 0.8 GB). Semantic output is identical after excluding only `diagnostics.seconds`; its normalized SHA-256 remains `92e47437fe44f1a685d5cf1b6c4229d3df269a3009438d3e355be15d7f926b25`. Two threads, 194 archived entries, 229 decisions, seven gates and two deliveries remain unchanged.

### All corrected default file timings

Per-file seconds sum Bun test timings; setup and runner overhead appear only in the suite total.

| File (under `test/`) | Original before s | Corrected after s |
|---|---:|---:|
| `s3/graph-week.test.ts` | 125.313 | 2.485 |
| `sim/e2e-v06.test.ts` | 91.778 | 6.942 |
| `m3/run2.test.ts` | 55.768 | 21.054 |
| `m3/offers.test.ts` | 38.259 | 4.614 |
| `m3/fit.test.ts` | 37.384 | 7.523 |
| `sim/v06-punish2.test.ts` | 31.448 | 7.740 |
| `m3/arms.test.ts` | 15.320 | 3.474 |
| `sim/v06-persist.test.ts` | 14.000 | 7.073 |
| `m3/witness.test.ts` | 13.983 | 1.581 |
| `m3/r2.test.ts` | 13.755 | 4.255 |
| `sim/review-fixes.test.ts` | 12.497 | 7.585 |
| `sim/v06-punish.test.ts` | 12.459 | 4.309 |
| `sim/incidents.test.ts` | 10.289 | 6.266 |
| `sim/invariants.test.ts` | 9.895 | 6.402 |
| `sim/v06-properties.test.ts` | 9.194 | 4.935 |
| `s3/graph-persist.test.ts` | 8.304 | 3.779 |
| `sim/review-v06.test.ts` | 7.361 | 3.868 |
| `sweep-replay.test.ts` | 6.517 | 3.977 |
| `sim/e2e.test.ts` | 6.443 | 3.474 |
| `s3/e2e.test.ts` | 6.161 | 2.581 |
| `sim/gate.test.ts` | 5.470 | 3.444 |
| `sim/events.test.ts` | 5.086 | 3.002 |
| `sim/v06-posts.test.ts` | 4.270 | 2.997 |
| `sim/v06-groups.test.ts` | 4.249 | 3.634 |
| `sim/properties.test.ts` | 3.691 | 3.014 |
| `sim/acts.test.ts` | 3.279 | 1.702 |
| `sim/v06-audits.test.ts` | 3.252 | 2.368 |
| `sim/reads.test.ts` | 3.061 | 1.981 |
| `sim/v06-reads.test.ts` | 3.011 | 1.563 |
| `sim/witness.test.ts` | 2.991 | 2.785 |
| `sim/v06-goals.test.ts` | 2.845 | 2.665 |
| `sim/ledger-groups.test.ts` | 2.274 | 1.332 |
| `s2/props.test.ts` | 2.183 | 0.843 |
| `sim/week.test.ts` | 2.002 | 1.171 |
| `sim/order.test.ts` | 1.933 | 1.027 |
| `sim/review-round4.test.ts` | 1.844 | 1.093 |
| `invariants.test.ts` | 1.693 | 0.958 |
| `sim/audits.test.ts` | 1.500 | 0.914 |
| `s2/sweep.test.ts` | 1.482 | 0.676 |
| `sim/review-round2.test.ts` | 1.407 | 1.022 |
| `sim/review-round5.test.ts` | 1.234 | 0.829 |
| `sim/people.test.ts` | 1.177 | 0.893 |
| `recovery-api.test.ts` | 1.149 | 0.684 |
| `s3/script.test.ts` | 1.103 | 0.647 |
| `sim/mirror.test.ts` | 1.017 | 0.611 |
| `digest-v4.test.ts` | 0.899 | 0.658 |
| `s3/vectors-graph.test.ts` | 0.867 | 0.581 |
| `sim/v06-items.test.ts` | 0.863 | 0.822 |
| `sim/layer2.test.ts` | 0.798 | 0.490 |
| `s3/properties.test.ts` | 0.746 | 0.434 |
| `digest.test.ts` | 0.721 | 0.463 |
| `process-evidence.test.ts` | 0.718 | 0.412 |
| `sim/v06-outcomes.test.ts` | 0.680 | 0.616 |
| `sim/ties.test.ts` | 0.559 | 0.425 |
| `s2/round2.test.ts` | 0.502 | 0.105 |
| `s2/spec-v17.test.ts` | 0.449 | 0.146 |
| `s2/arbiter.test.ts` | 0.429 | 0.199 |
| `sim/arith.test.ts` | 0.397 | 0.264 |
| `s2/properties-v111.test.ts` | 0.388 | 0.173 |
| `m3/names.test.ts` | 0.382 | 0.323 |
| `sim/v06-misc.test.ts` | 0.368 | 0.347 |
| `s2/r1.test.ts` | 0.368 | 0.146 |
| `s2/life.test.ts` | 0.341 | 0.218 |
| `s2/review.test.ts` | 0.305 | 0.058 |
| `s3/sower.test.ts` | 0.298 | 0.198 |
| `resolve.test.ts` | 0.288 | 0.217 |
| `s3/review-fixes.test.ts` | 0.284 | 0.144 |
| `s3/graph-sower.test.ts` | 0.268 | 0.230 |
| `s2/review-v111.test.ts` | 0.263 | 0.096 |
| `s3/audit.test.ts` | 0.212 | 0.119 |
| `s3/graph.test.ts` | 0.206 | 0.121 |
| `s3/reload.test.ts` | 0.187 | 0.080 |
| `s3/gates.test.ts` | 0.186 | 0.093 |
| `s3/review-graph.test.ts` | 0.184 | 0.116 |
| `sweep-operations.test.ts` | 0.167 | 0.074 |
| `s2/more.test.ts` | 0.166 | 0.091 |
| `s2/vectors-v111.test.ts` | 0.164 | 0.094 |
| `m3/packet2.test.ts` | 0.145 | 0.011 |
| `s3/evidence.test.ts` | 0.139 | 0.065 |
| `s2/findings.test.ts` | 0.121 | 0.071 |
| `s2/lint.test.ts` | 0.110 | 0.050 |
| `blake3-short.test.ts` | 0.095 | 0.065 |
| `s2/encounter-v111.test.ts` | 0.089 | 0.042 |
| `s2/events-v111.test.ts` | 0.072 | 0.034 |
| `s3/sifter.test.ts` | 0.069 | 0.040 |
| `s2/lint-round1.test.ts` | 0.064 | 0.022 |
| `s2/nudge-v111.test.ts` | 0.062 | 0.031 |
| `s2/cast.test.ts` | 0.059 | 0.020 |
| `m3/packet.test.ts` | 0.056 | 0.004 |
| `discovery.test.ts` | 0.042 | 0.023 |
| `s2/pred.test.ts` | 0.035 | 0.012 |
| `s2/pattern-seeds-v111.test.ts` | 0.034 | 0.019 |
| `persistence.test.ts` | 0.032 | 0.020 |
| `resolve-more.test.ts` | 0.031 | 0.018 |
| `s3/fit.test.ts` | 0.029 | 0.010 |
| `beliefs.test.ts` | 0.026 | 0.024 |
| `sr1.test.ts` | 0.023 | 0.011 |
| `fdlibm-log.test.ts` | 0.022 | 0.014 |
| `query.test.ts` | 0.020 | 0.010 |
| `s3/transcript.test.ts` | 0.020 | 0.014 |
| `v417.test.ts` | 0.019 | 0.014 |
| `retention.test.ts` | 0.019 | 0.014 |
| `s2/pattern-lint.test.ts` | 0.018 | 0.012 |
| `relevance.test.ts` | 0.018 | 0.010 |
| `v4-process.test.ts` | 0.016 | 0.011 |
| `v4.test.ts` | 0.016 | 0.011 |
| `sr2.test.ts` | 0.015 | 0.007 |
| `s2/round1.test.ts` | 0.014 | 0.004 |
| `evolution.test.ts` | 0.010 | 0.003 |
| `s3/director.test.ts` | 0.009 | 0.005 |
| `events.test.ts` | 0.008 | 0.004 |
| `sr3.test.ts` | 0.008 | 0.000 |
| `groups.test.ts` | 0.008 | 0.004 |
| `round1.test.ts` | 0.007 | 0.004 |
| `foundation.test.ts` | 0.006 | 0.002 |
| `review-fixes.test.ts` | 0.005 | 0.005 |
| `fixtures.test.ts` | 0.003 | 0.001 |
| `s2/fixtures.test.ts` | 0.002 | 0.005 |
| `id.test.ts` | 0.001 | 0.001 |
| `sim/transcript.test.ts` | 0.000 | 0.000 |
| `s3/graph-history.test.ts` | 0.000 | 0.081 |

## Offline Holotable producer

Offline evidence, 27 October 2026: the shared SF3-60-style Kabuki week, default
fixture density, reaches GameTime 604,800 and publishes 1,010 observations to
12 layers. The CLI reads the existing private world pack; district regions are
real ids and synthetic cells are explicitly schematic. The consumer validator
accepts both the week and a temporary save/load test spool without refusals.

| Measurement | Result |
|---|---:|
| End to end, including fixture construction | 30.212 s |
| Observation, validation and spool writing combined | 17.120 s |
| Combined publishing time per observation, mean | 16.95 ms |
| Guard peak | 0.4 GB / 4 GB |
| Total spool bytes | 202,213 |
| Largest spool, people | 147,702 bytes |
| Default suite | 1,712 pass, 46 skip, 0 fail; 558.97 s, peak 1.5 GB |
| Guarded targeted observer/consumer/recovery recheck | 38 pass, 0 fail; 24.73 s, peak 0.9 GB |

The full suite includes the distinct-id and per-item bounds, branch-prefix
retraction and replacement regressions, a 20,000-entry list-prefix regression,
all ten fidelity-review corrections, glyphs/badges, captions, cell item anchors
and exact-time delivery holds. It ran after the coordinated quiet
window ended. The opt-in consumer test passed in the guarded targeted run.
The regenerated week reports
zero truncations and unknown glyph names in every layer. It includes one recorded
delivery hold and its exact-time retraction. Typechecking, link/privacy checks and the recovery
API inventory pass. Fidelity review extracted the tie policy's strength formula
into a pure function shared with observation; no state-transition behaviour changed.
The regenerated week excludes two synthetic event placeholders, preserves the
fixture's zero ties/items/intentions and one belief, and passes the independent
consumer validator. The fixture extraction
preserves its assertions and default/FULL scales.

These are single-run timings on a shared host, not controlled benchmark deltas
or game/UI latency claims. The next cost to isolate is projection versus writer
time: the combined total does not establish that disk writes dominate. Unchanged
layers skip item-bound revalidation and appends. Observer-on/off tests compare
record/digest/transcript/save bytes with equal starting memo conditions; immediate
raw-state images additionally detect cache/header changes from observation.

Consumer read-back at the week's end places all 25 place zones, all four groups,
290 of 291 people, 1 of 20 event items, 8 of 18 story items and 5 of the 8 remaining
director items. Cell references resolve through the places layer; detail zones
keep the cell's own box. Remaining unplaced points have no recorded location,
and their relations or links to V inherit the missing endpoint. No locations
are invented. The consumer reports zero refused items. This
confirms producer/consumer interpretation only, not an in-game result.

The task footprint is below 0.5 GB, with no task payload above 5 GB. Scratch
spools/logs are regenerable and removed at handoff; the commands and counts remain
in the [producer notes](HOLOTABLE.md).
