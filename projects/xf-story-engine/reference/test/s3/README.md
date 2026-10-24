# S3 core fixture index

S3 v0.4's core runs in `src/procedural/`. The tests use Bun and explicit world seeds. No game is launched.
The coordinator owns independent pre-merge review; the project README records guarded full-suite validation.

| Fixture   | Executable coverage                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SF3-1     | `director.test.ts`: 1,000 keyed windows, nested thinning and count tolerance.                                                             |
| SF3-2     | `sower.test.ts`: phase-independent resolution, single use and stale-pointer lapse.                                                        |
| SF3-3–4   | `director.test.ts`: exact intensity arithmetic, transition seconds and bounded episode rests.                                             |
| SF3-5–6   | `director.test.ts`: protection, authored relaxation, non-relaxing sown phase holds and headroom.                                          |
| SF3-7     | `director.test.ts`, `reload.test.ts`: climax locks; a real witnessed arc outcome; saved opening lock, reset session locks.                |
| SF3-8–9   | `director.test.ts`, `script.test.ts`: lead equality, joint priority, one occurrence, quiet guards and load orientation.                   |
| SF3-10    | `director.test.ts`: connected components, anchor casts, terminal closing-only membership and recency.                                     |
| SF3-11–12 | `sower.test.ts`, `gates.test.ts`: all opening/climax budgets; pending equality, shown grades, load and off-tempo withdrawal.              |
| SF3-13–14 | `sifter.test.ts`, `audit.test.ts`, `fit.test.ts`: every load-check failure with a passing twin, later refusals and variant certification. |
| SF3-15    | `gates.test.ts`: literal Order against kin, effect sets, unless and missing initiating effect.                                            |
| SF3-16–17 | `sifter.test.ts`, `properties.test.ts`: distinct occurrences, duplicate delivery, one advancement and separate pattern frames.            |
| SF3-18    | `sifter.test.ts`, `gates.test.ts`: open/complete/tombstone equality and overdue use without sweeping.                                     |
| SF3-19    | `gates.test.ts`, `properties.test.ts`: default 32/256 bounds, oldest-incomplete eviction and complete-only refusal.                       |
| SF3-20    | `gates.test.ts`: own contributions/meta events ignored; meta patterns refused.                                                            |
| SF3-21    | `sifter.test.ts`, `reload.test.ts`: silent restoration, retained closure, every stage boundary, summary provenance and released roots.    |
| SF3-22–23 | `gates.test.ts`: each gate fails independently; rumour texture versus an offer's V-link.                                                  |
| SF3-24    | `sower.test.ts`: bands, skipped constants, diversity and removing a loser with frozen scores.                                             |
| SF3-25    | `gates.test.ts`, `sower.test.ts`: three distinct kits, success on third, rollback, cooldown and final tombstone.                          |
| SF3-26    | `sower.test.ts`, `properties.test.ts`: same instance on retry/load; decision index rejects a retired occurrence.                          |
| SF3-27    | `reload.test.ts`: fresh reload immediately before a slot, including real slot 836 ending two seconds before its window.                   |
| SF3-28    | `reload.test.ts`, `sower.test.ts`: tick/batch save guards, staged refusal, whole sow and split-sow repair.                                |
| SF3-29–30 | `sower.test.ts`: selected-save inheritance, new lineage, tempo frame lifecycle, sweep and pending expiry.                                 |
| SF3-31–32 | `fit.test.ts`: exact four-option weights, clamp, all four draw kinds and unchanged reports under every tempo/noticing setting.            |
| SF3-33    | `script.test.ts`, `audit.test.ts`: extraneous telemetry perturbation and compiler-AST checks of closed inputs.                            |
| SF3-34    | `evidence.test.ts`: identical decisions/state with logging off/on; structural facets, timestamps, sensitive classes and model floor.      |
| SF3-35    | `sower.test.ts`: absent record starts empty at the cumulative schedule window without an error.                                           |
| SF3-36    | `e2e.test.ts`: authored R1 at 215 versus 105 without S3; identical offer Id, cast, draws, decline and closure.                            |
| SF3-37    | `script.test.ts`: the literal script, actual keyed slots and two distinct sowings; prose conflicts recorded in SPEC-NOTES 182.            |
| SF3-38    | `e2e.test.ts`: real S1 simulation/mirror publication reversal, with reload; `sifter.test.ts` isolates the buffer.                         |

`e2e.test.ts` also runs Kabuki with the real S1 event process and S2. A simulated assault completes a pattern, whose seed
is cast, released, presented and resolved through S2. Five fresh-process crash positions are compared with uninterrupted
play, then a run reloads at all five boundaries. Full Layer3State, source decisions, instance identities, casts, logical
deliveries and closures agree. The host supplies the same cumulative play totals; display timing may restart after load.

All 22 invariants have complementary coverage: determinism/closed inputs/session independence (1, 5, 13), static two-door
and firewall audits (2, 4, 12), hook fixtures (3, 6, 11), schedule and occurrence properties (7, 8, 17, 18, 19), bounded-state
and cache recovery checks (9, 10), inert meta and decision-log fixtures (14, 15), gate/variant/spine tests (16), atomic and
crash tests (20), finite pending (21), and event-root/summary restoration (22). `auditState` is an inspector-side check,
not an input to a decision. Source audits use the shared TypeScript AST parser and test executable template expressions
and literal computed accesses; they are conservative syntax checks, not general information-flow verification.

Deferred: S3 §0.3's capabilities, S4's complete skeleton classifier/starter pack, P7's city-scale pool/closure cost and
save-size work, and P9's large generated corpus with automatic shrinking. The generated regressions here are bounded,
seeded scripts, not a claim that the later evaluation harness is built. The full suite's two-minute target is the
guarded full-suite timing check. Existing frozen digests are checked without changing their expected values.

`review-fixes.test.ts` covers S3-01–07: fresh loads after hand-over/reclamation with multiple consumers, root-order
monotonicity, pending closure consumption, real unbound-role casting/recasting/preparation, shared settings/registry
authority, per-pattern/total/sown capacity, selected variant exclusions and nested later-capability refusals.
`properties.test.ts` advances game time beyond a short candidate TTL and compares admission with/without sweeps;
its tempo walk resolves actual slots under all tempos. `transcript.test.ts` freezes identities and uniforms in
`transcript.json`, checks them with a separate byte encoder over BLAKE3 (`transcript-oracle.ts`), and asserts the pool,
decision, instance, tombstone, pending/recent records and handed-over event facts against explicit expected values.
The independent host logarithm checks Gumbel noise within binary64 tolerance; uniform values and identities are exact.
Run `bun run test/s3/check-review-mutations.ts` to reverse each reviewed behavior in memory and require its named
semantic assertion to fail. The kernel's pending-output regression is `test/process-evidence.test.ts`; SF3-38 retains
its strict uninterrupted/reloaded state comparison.

S3C-01/02 add explicit summary-materialisation provenance and actual saved edge termination regressions in
`process-evidence.test.ts`: expired overlays through fresh incremental and snapshot loads; save A → edge end/release →
optional later sweep → save B → fresh load; and release-only history across further saves. Four source-loader probes
reverse the ownership lookup in retention and views, the edge diff and sweep preservation, and require the named semantic
assertion to fail. S3D-01 compares re-reference at 20 after release at 10 with/without a B load: spatial queries and whole
C records agree through fresh incremental and snapshot loads. S3D-02 preserves the reopened interval `{ from: 20, to: 30 }`
after the previous end at 10, with/without a sweep, also checking an end beyond save time. Release never invents an end;
separate tests preserve an end before the first save and check retention monotonicity. Three more source-loader probes
reverse these fixes and require spatial-query semantic failures. S3E-01 adds sweep-before-B and the two-load
release/re-reference/release sequence: live headers, owned facts, transitive event dependencies, spatial reads and complete
C/D records agree with incremental and snapshot replay. Seed/frame/pin/edge/origin reference fixtures cover ordinary and
materialised events, monotonicity and root insertion order. S3E-02 reopens at the previous start, with/without loading A,
with/without sweeping before B, and with an open interval or an end at 30. All 20 initial S3E boundary cases fail at their
named semantic assertions without the fixes. S3F-01 adds query-before-reference after a sweep and save B: a recreated
summary header still requires missing owned facts and provenance to recover. Sixteen boundary combinations cover
incremental/snapshot records, sweeps, query order and fresh B loads, with transitive dependencies, unrelated history,
complete C record comparisons and fresh C loads. A partial-tree fixture also checks authoritative live records and
idempotence. Both original query-first/sweep reproductions fail at the missing-participant semantic assertion without
the fix. Three source-loader probes reverse each header short-circuit independently. S3G-01 adds all 16 combinations
of snapshot mode, optional A reload, sweep and current/future contribution ends, each with both release/end orders
and retained-consumer controls. B must record the contribution end, exclusive-end resolution must agree after
recovery and fresh replay, and whole C records must match. S3G-02 withdraws the descriptor's five original pins,
sweeps both descriptor and item, saves B and re-references either root order, with incremental/snapshot records and
with/without a B load. Shared header-first replay restores participant facts and provenance; unrelated history stays
absent. All 18 S3G test bodies reproduced the prior defects. `sweep-replay.test.ts` covers S3H-01's 16 variants,
S3H-02's four variants and S3H-03's two variants, with no-sweep, reference-first, saved/unsaved-header and
general/named-rule controls. Re-mints recover saved ends before defaults, known live headers can recover saved
contributions without a saved header, and authored general rules survive their origin's sweep. Silent header
recovery and selected-branch reconciliation have separate fixtures. The bounded property test checks live versus
randomly reloaded state after 768 generated operations in both snapshot modes, including contribution/edge ends
and an authored contribution whose target header was never saved. Every random save compares complete records.
All 56 S3/review mutation probes pass their rejection checks; the S3H probes reverse regeneration recovery, cleanup,
known-live-header recovery and general-rule preservation. Redundant query-first probes now target partial live
records, because query regeneration itself performs recovery.
The S1 generated partition/reload comparison remains unchanged and checks that saved updates do not leak into the
retention-selected live-state view.

Host entry: attach `new Layer3(l2, { registry: sim.w.kinds, patterns })`, then drive unpaused seconds through
`layer3.advancePlay(portClock, senseFrame, beforeSecond)`. That boundary runs earlier kernel/S2 work, the director,
refresh/pending/evidence, the slot and S2 release in order. Saves are served after it returns. Game-time-only advances
still run the sifter and sweep through the kernel hook. Data tunables are copied and pinned for the lineage; `salt`
only changes keyed draws, never identities. Use `SettingsSet.storyExclusions` for recorded typed filters.

The wakeup-order regression in `reload.test.ts` checks that S2's due play-clock window is cast before S3 ticks in that
same second. `preparePlaySecond` is an adapter boundary; its expiry/wakeup work is not repeated during release.
