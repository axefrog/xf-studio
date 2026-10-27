# M3 iteration 3: reviewed replacement

The 16 run records in [runs/](runs/) are deterministic gzipped JSON (`*.json.gz`): canonical minified JSON, gzip mtime zero and no stored filename. Read one from this directory with `gzip -dc runs/<name>.json.gz`. Record readers also accept plain `.json` for earlier runs.

**Reviewed replacement complete: two Sol passes scored.** All sixteen corrected weeks completed. Each rater validated 75 distinct accounts from the unchanged 96-account sample, with 42 shown pairs and six omitted ties. E has small advantages over A1 in mean criteria, but no consistent forced causal preference. E loses to full fixed A5 in both passes; prefix matching changes that comparison. The first packet and scores are superseded. These limited offline results do not establish an architecture verdict.

**Review history:** the first packet (checkpoint `2b565787`) was replaced after independent review found closing-kit supply losses, overbroad casting and forced player participation, response-order errors, configuration-confounded sampling, non-repeating A5 roots and future information in time-based measures.

The [reviewed matrix protocol](protocol.md) was frozen before regeneration; packet schema 2 was approved after the overlap audit and before fresh ratings. [Results](results.md) contain every criterion per rater and arm, multiplicity-weighted and unweighted, configuration and crossed-cell contrasts, seen-before answers, all �14 measures, stage losses, refusals and overlap. Runs 1 and 2 and the design library remain unchanged.

## Blind results

The rating records and path-free completion logs are in [blind/answers/](blind/answers/); [provenance](blind/rating-provenance.json) records the packet/answer hashes and route. Both passes used GPT-6.1 Sol at high effort through the same fresh CLI route as run 2. Results remain separate; no pooled test is performed.

Multiplicity-weighted means, on 1�7 scales (24 sampled memberships per arm). The results also give unweighted means: E has 19 canonical accounts, A1 17, A3 24 and A5 24.

| Rater | Arm | Lives | Caused | Legible | Pull | Setting | Scale | Fair | New / reminds / same |
|---|---|---|---|---|---|---|---|---|---|
| a | E | 2.000 | 1.625 | 1.500 | 1.958 | 1.917 | 1.792 | 2.125 | 5 / 8 / 11 |
| a | A1 | 1.750 | 1.500 | 1.375 | 1.792 | 1.833 | 1.583 | 2.042 | 6 / 10 / 8 |
| a | A3 | 3.833 | 4.042 | 5.792 | 3.042 | 4.917 | 5.042 | 4.167 | 8 / 5 / 11 |
| a | A5 | 1.917 | 1.958 | 1.583 | 2.083 | 1.625 | 2.458 | 2.250 | 3 / 8 / 13 |
| b | E | 1.958 | 1.917 | 1.750 | 1.750 | 1.833 | 1.833 | 1.292 | 2 / 12 / 10 |
| b | A1 | 1.833 | 1.708 | 1.250 | 1.500 | 1.792 | 1.750 | 1.125 | 4 / 11 / 9 |
| b | A3 | 3.208 | 3.917 | 5.417 | 2.917 | 4.333 | 4.458 | 3.667 | 7 / 4 / 13 |
| b | A5 | 1.708 | 1.667 | 1.833 | 1.833 | 1.125 | 1.917 | 1.542 | 3 / 5 / 16 |

Forced choices below are E wins / losses / omitted identical ties. A5 full and length-matched results stay separate.

| Rater | Comparison | Follow | Caused |
|---|---|---|---|
| a | E / A1 | 10 / 8 / 6 | 8 / 10 / 6 |
| b | E / A1 | 10 / 8 / 6 | 10 / 8 / 6 |
| a | E / A5 full | 2 / 10 / 0 | 2 / 10 / 0 |
| b | E / A5 full | 5 / 7 / 0 | 5 / 7 / 0 |
| a | E / A5 matched | 8 / 4 / 0 | 8 / 4 / 0 |
| b | E / A5 matched | 4 / 8 / 0 | 8 / 4 / 0 |

Evidence-preserving rendering raises E's raw lives / caused / legibility / pull scores by 0.667 / 0.583 / 0.833 / 0.750 in a and 1.083 / 1.500 / 1.500 / 0.833 in b. Matching A5's length reduces its lives / caused / pull scores by 0.667 / 0.750 / 1.333 in a and 0.583 / 0.667 / 0.333 in b. Configuration-adjusted and unweighted contrasts, every renderer/length cell and their seen-before counts are in the results. These are differences between balanced halves of different accounts, not causal percentages.

Both critics name missing concrete acts, objects, motives and outcomes; asserted rather than explained causes; requests to act against the asker; and interchangeable participants. The evidence renderer helps, yet E's evidence-rendered halves still average only about 1.9�2.7 on lives, caused, legibility and pull. Full A5's length supplies more development; the underlying records and limited adapters also constrain quality. A3's concrete jobs score higher, but retain their wording confound.

E's logged selected F5 is higher than A1's, while F14 is nearly unchanged. Ninety of 123 E sows have only one compatible kit; no logged rival pool has a positive F6 or F13. Kit incompatibility and missing escalation conditions dominate gate checks. Stochastic selection chooses below the highest base score in 109 E sows; this is the declared keyed-noise policy, not proof that ranking is bypassed. The logs show constrained opportunities to rank, not a counterfactual explanation of each rating. [ranking.json](ranking.json) retains the audit.

**Residual method limitation:** a post-rating audit flags four E and two A1 population threads with an actor-matched simultaneous response preceding its request, including sampled H-025 and H-096. Their archived response link is missing, so the recorded-link ordering guard does not catch them. The packet remains frozen; these counts and IDs are reported explicitly. This limits causal-legibility conclusions and needs observation-layer repair before a stronger architecture claim.

## Arms and controls

E uses graph matching and ranking. A1 uses the same gates with uniform candidates/kits and no diversity penalties. A3 keeps its Radiant nearest-slot templates. A5 replays static expanded authored paths, with inherited bindings and explicit synthetic-player acceptance before their own acts, from the same seeded initial casting pool. It has no live matching, composition or growth; uncastable whole slots are refused.

The matrix retains eight paired configurations across three worlds, three active tempos and six synthetic policies. Every E/A1 week has 1,008 ten-minute game windows and 28 play hours. `engage` accepts and follows offers without reading hidden state. Completed cells resume only if marked `reviewed-v5`; superseded cells, including both preliminary calm cells, regenerate.

A5 makes seven root draws with replacement per configuration. Probabilities follow that configuration’s ordinary E root-selection frequencies, without copying order or outcomes. The weights, draws and refusals are retained. Seven draws remain a short repetition horizon; a zero rate where no repeat was sampled is uninformative. The supplied inputs contain no authored perceived-L2 baseline, only dossier 5’s aggregate quest-node trigrams.

## Crossed packet

Shared world/tempo/policy quotas cap each configuration at its minimum supply across all arms. The original selection retains 24 memberships per arm, three per configuration. Schema 2 groups exact ordered occurrence identities globally: each canonical sequence is shown once, with every original arm/configuration membership, run/start/occurrence time and per-arm multiplicity retained in the hidden key. One renderer assignment applies to every membership of a shared sequence; weighted halves remain balanced within configurations. Sheet b reverses sheet a’s renderer assignments. A5’s full/prefix assignment is independently balanced and reversed. Prefix lengths target the selected E distribution in the same configuration; shorter paths are never extended.

There are 75 distinct sequences among 96 sampled memberships: 12 shared groups, ten spanning configurations. Unique per-arm account counts are E 19, A1 17, A3 24 and A5 24; a shared account can belong to both E and A1. Every arm retains weighted N = 24. Each weighted E/A1 renderer half has 12 memberships, and each A5 renderer/length cell has six accounts. All 12 matched prefixes on each sheet exactly meet their E target length. Each sheet shows 18 E/A1 pairs, 12 E/A5-full pairs and 12 E/A5-matched pairs; six self pairs are omitted and counted as ties, giving 24 E/A1 comparisons alongside the tally. Identical-text pairs are also omitted if present. Source/hash, quota, assignment, multiplicity, first-appearance ordering and side-mirroring audits pass.

Pairs share configuration and renderer; sides are balanced within crossed comparison cells and mirrored. Pair prompts reference IDs without repeating accounts. Original counterbalanced sampled-account orders are mapped to canonical IDs and keep only first appearances. Internal chronology remains; cross-configuration sharing makes every run’s across-account chronology jointly impossible, so the hidden membership retains the original times. A3 stays unchanged and wording-confounded. Reports retain weighted and unweighted per-rater and per-configuration criteria, seen-before counts, crossed cells and contrasts, with no pooled significance test or causal percentage attribution. Multiplicity weights preserve the original arm/configuration sample means without a second reading. The two Sol passes are launched by the coordinator outside the editing sandbox. Claude and human sheets are prepared but unrated.

Exact overlap is also a result: 32 of 49 E population accounts have an identical ordered sequence in A1 within the same configuration. The sampled overlap is nine of 24 E memberships. Results list each configuration’s rates and every shared group’s configurations. This compares recorded occurrence sequences; it does not assert identical hidden state. A5 uses separate synthetic occurrence IDs, so its zero exact-identity overlap cannot establish story novelty; R1 measures role-masked recast separately.

Evidence-preserving rendering serializes only the supplied observations, arguments, event/state records, effects, options and outcomes. It explicitly marks missing content and never invents a motive or revelation. **Creative wording item 4 remains deferred to Claude.** Run-2 wording data is unchanged; its automatic measures accompany new cards outside blind sheets.

## Scope and verification

The closing kit is reserved for its dedicated route. Actors use the coordinator-authorised nominal `core:actor` category. Mixed target roles take fixed identities from the typed matcher with no free-casting scope; optional participation has separate NPC/player variants. Simultaneous responses follow their recorded offers. R2/R3 use observation-time snapshots, excluding later events, recognizers and endings. The raw run records also retain sow → cast → release → perception losses by seed, route and kit; awareness is a separate threshold.

The observed populations are E 49 threads, A1 61, A3 56 and A5 51. Three-or-more-occurrence shares remain 0.286 for E and 0.863 for full A5; the renderer/length ratings above show that both missing evidence and path length matter, without assigning percentages. E's stages are 123 → 113 → 56 → 56; A1's are 123 → 119 → 68 → 68. No ordinary closing-kit selection remains, and no dedicated closing seed was produced in this matrix. A5 refused five of 56 whole slots: four revelation paths lacking an event cast and one interception path lacking an item cast. Refusals and replacement-root weights are reported per pattern.

Production remains graph-only because mixed stage/graph execution exposes a [meta:story engine defect](../../reference/known-issues/mixed-patterns.md). Uprising lacks its live S1 intent-end producer; construct/refine remain later capabilities. Authorised engine changes add nominal actor schema data, its graph projection/check, and S2 candidate gathering for nominal kinds with no structural members. Compatible structural queries supply that casting pool; it is deduplicated in kind-id/query order before the existing checks and keyed draw. Generic kernel queries and both frozen digests remain unchanged. The design library is unmodified. The separate performance fix in `9ca3186e` remains the base ([resolution](../../reference/known-issues/run3-performance.md)). This is offline evidence only.

From `projects/xf-story-engine/reference/`, run the matrix, builder and rating wrappers under the repository memory guard at 4 GB, invoking Python by its full installed path. The matrix takes `bun tools/m3/run3-matrix.ts ../m3/run3/runs PATH_TO_TASK_SCRATCH`; the builder takes `bun tools/m3/build3.ts ../m3/run3`. The coordinator launched both rating passes after packet readiness. The builder refuses to change a rated replacement packet.

Rating handoff, in sequence through the same guarded route: `bun tools/m3/rate3.ts ../m3/run3 ../../../.scratch-m3c 1`, then `bun tools/m3/rate3.ts ../m3/run3 ../../../.scratch-m3c 2`. Packet SHA-256: `d7d34d65589ef506dfa760c28a0c2c65293dbe55cf4c925102f9b632436459db`.

Final validation ([record](verification.json)): `bun run check` passes; the default suite passes 1,717 tests, with 45 skipped and zero failures (184,015 expectations, 330.67 seconds). Both frozen digests are unchanged. Targeted nominal casting and method regressions pass; the harness tools typecheck. The full guarded suite peaked at 1.4 GB and production at 2.5 GB; no task-owned payload exceeds 5 GB. Artifact/hash, quota, prefix, link and privacy checks pass, including untracked public artifacts and 82 privacy-check vectors. No game session is needed. Validated rating outputs and provenance are retained publicly. Scratch cleanup was attempted after a path/reparse-point audit, but execution policy blocked recursive deletion; the coordinator must remove the remaining 1.8 MB task scratch. No task-owned process remains running.
