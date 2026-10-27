# M3 iteration 3: reviewed replacement

**Complete: both Sol passes were redone and scored on the stricter schema-3 account rule.** Each pass validated 79 accounts and 42 pairs from the unchanged 96 sampled memberships, with six omitted ties. E has a consistent descriptive forced-choice advantage over A1 in these two passes. E still loses to full fixed A5; length matching reverses the aggregate preference, concentrated in evidence-rendered pairs. Absolute scores remain low. These limited offline results do not establish an architecture verdict.

The 16 [run records](runs/) stand unchanged: deterministic minified JSON compressed with gzip mtime zero and no stored filename. Read one with `gzip -dc runs/<name>.json.gz`. No simulations were rerun for these review fixes. Runs 1 and 2, the specs and composite library remain unchanged.

## Review fixes and rating provenance

The first packet at `2b565787` was replaced after method review found supply, casting, chronology, sampling, A5-root and observation-time defects. A further review found that occurrence IDs alone did not establish equal accounts: H-022 had absorbed a different response in H-092. Schema 3 shares a canonical account only when ordered occurrence IDs, full rendered text in both renderers, response semantics and L2 tokens all agree. Both schema-2 passes are superseded; none of their answers is reused.

Four former groups split:

| Former group | Schema-3 membership groups |
|---|---|
| H-021 | H-021; H-077/H-094 |
| H-022 | H-022; H-092 |
| H-035 | H-035/H-050; H-087 |
| H-047 | H-047; H-059/H-062/H-080 |

Sampling, quotas, counterbalancing and first-appearance ordering rules are unchanged. There are 79 accounts, eleven shared groups and eight groups spanning configurations. Unique per-arm accounts are E 19, A1 20, A3 24 and A5 24, each retaining weighted N = 24. All memberships, multiplicities and original times remain in the hidden key. [Review-fix evidence](review-fixes.json) lists the splits and validation; [protocol](protocol.md) specifies the rule.

The maintainer ran fresh sequential GPT-6.1 Sol high-effort ephemeral CLI passes through `rate3.ts`, using run 2's route with project instructions disabled. Validated [answer JSON and path-free completion logs](blind/answers/) are retained publicly. [Provenance](blind/rating-provenance.json) binds their hashes and the original private-log hashes to packet SHA-256 `4e4d9f8b7149cfdd2a24bd65de8c9802e219bbf6763cded134d7409daf0f83b7`. Raw CLI logs and scratch remain with the maintainer as requested. Claude and human sheets are prepared but unrated.

## Blind results

Multiplicity-weighted means on 1–7 scales, 24 memberships per arm. New/reminds/same is weighted in the same way. [Results](results.md) also report unweighted means/counts, per-configuration scores, all renderer/length cells, adjusted and unadjusted contrasts, calibration and every automatic measure. Raters remain separate; no pooled significance test is performed.

| Rater | Arm | Lives | Caused | Legible | Pull | Setting | Scale | Fair | New / reminds / same |
|---|---|---|---|---|---|---|---|---|---|
| a | E | 2.042 | 1.958 | 2.000 | 1.875 | 2.750 | 1.833 | 1.250 | 3 / 9 / 12 |
| a | A1 | 1.958 | 1.708 | 1.500 | 1.625 | 2.667 | 1.667 | 1.167 | 2 / 12 / 10 |
| a | A3 | 3.083 | 4.875 | 5.750 | 3.000 | 5.000 | 4.875 | 3.792 | 8 / 5 / 11 |
| a | A5 | 2.083 | 2.000 | 1.958 | 1.917 | 2.208 | 1.958 | 1.250 | 2 / 8 / 14 |
| b | E | 2.125 | 1.875 | 1.458 | 1.875 | 2.750 | 1.917 | 1.250 | 2 / 11 / 11 |
| b | A1 | 2.042 | 1.708 | 1.208 | 1.792 | 2.833 | 1.750 | 1.125 | 3 / 10 / 11 |
| b | A3 | 3.458 | 4.333 | 5.667 | 3.042 | 4.958 | 4.292 | 3.417 | 8 / 3 / 13 |
| b | A5 | 1.750 | 1.667 | 1.417 | 1.583 | 2.125 | 2.125 | 1.042 | 2 / 7 / 15 |

Forced choice is E wins / losses / omitted ties. Full and length-matched A5 remain separate.

| Rater | Comparison | Follow | Caused |
|---|---|---|---|
| a | E / A1 | 11 / 7 / 6 | 12 / 6 / 6 |
| a | E / A5-full | 2 / 10 / 0 | 2 / 10 / 0 |
| a | E / A5-matched | 7 / 5 / 0 | 9 / 3 / 0 |
| b | E / A1 | 12 / 6 / 6 | 12 / 6 / 6 |
| b | E / A5-full | 5 / 7 / 0 | 5 / 7 / 0 |
| b | E / A5-matched | 7 / 5 / 0 | 7 / 5 / 0 |

The main interpretation changes from the superseded ratings: both passes now favor E over A1 on follow and caused, and both favor E over matched A5 on follow. Mean E/A1 differences remain small; the earlier claim that E is higher on every criterion in both passes no longer holds because b gives A1 a slightly higher setting score (2.833 versus 2.750). Full A5 still wins both forced questions in both passes.

The matched-A5 advantage depends strongly on presentation. In evidence-rendered matched pairs, E wins all six follow and all six caused choices in each pass. In current-rendered matched pairs, E follow is 1/6 in both, and caused is 3/6 in a and 1/6 in b. The aggregate matched preference therefore does not establish superiority across renderers. Evidence-minus-current E lives / caused / legibility / pull differences are +1.417 / +1.250 / +1.333 / +1.083 in a and +0.417 / +1.417 / +0.917 / +0.917 in b. A5 matched-minus-full differences are −0.500 / −0.667 / +0.250 / −0.667 in a and −0.500 / −1.000 / +0.167 / −0.833 in b. These compare balanced halves of different accounts; they are not causal percentages.

Both critics still name missing concrete motives, acts, objects and consequences; asserted causal links; requests to act against the asker; and repetitive structures with substituted names. Paid jobs supply clearer objectives but jump straight to completion. Explicit refusals give clearer stopping points than unexplained closing labels. A3 scores higher on all arm-level means, but its separate wording remains confounded. E is not consistently more novel than A1, and evidence rendering does not consistently reduce same-story answers.

**Residual chronology limitation:** the archived actor/time audit flags four E and two A1 population threads with an actor-matched simultaneous response preceding its request, including sampled H-025 and H-096. Their retained response links are missing, so the recorded-link ordering guard cannot catch them. The direction of bias from this chronology residual is uncertain: equal sampled counts do not establish an unbiased comparison. The rated packet and run observations were not repaired during scoring; [ranking.json](ranking.json) retains the identities.

## Arms, controls and packet

E uses graph matching and ranking; A1 uses the same gates with uniform candidates/kits and no diversity penalties. A3 retains its Radiant nearest-slot templates. A5 plays static expanded authored paths with inherited bindings and explicit synthetic-player acceptance, using the same seeded initial casting pool. It has no live matching, composition or growth; uncastable whole slots are refused. Seven root draws with replacement per configuration use that configuration's ordinary E root-selection frequencies, without copying order or outcomes. Weights, draws and refusals remain in [slots.json](slots.json).

The matrix contains eight paired configurations across three worlds, three active tempos and six synthetic policies. Each E/A1 week has 1,008 ten-minute game windows and 28 play hours. Shared quotas retain three memberships per arm/configuration. One renderer assignment applies to every membership of an identical account; weighted E/A1 halves have twelve memberships each and reverse on sheet b. A5 renderer and full/prefix assignments are independently balanced and reversed, six accounts per crossed cell. Each of the twelve prefixes per sheet exactly meets its sampled E target length.

Pairs share configuration and renderer. Each sheet shows eighteen E/A1 pairs, twelve E/A5-full and twelve E/A5-matched pairs; six E/A1 self pairs are omitted and counted as ties. Sides are balanced within shown cells and mirrored. Original sampled-account orders map to canonical IDs and keep first appearances. Internal chronology remains; shared accounts across configurations prevent preserving every original run's across-account order, so all original times remain in hidden memberships. Pair prompts reference IDs without repeating accounts.

Exact occurrence-ID overlap is separate from account equivalence: 32/49 E population threads have the same ordered IDs in A1 within configuration, and nine of 24 sampled E memberships overlap sampled A1. Equal IDs can still have different evidence or responses. A5 uses a separate synthetic identity namespace; zero exact identity overlap therefore cannot establish novelty. R1 measures role-masked recast separately.

## Automatic measures and constraints

R5 now trains only on occurrences and actual endings observed strictly before each evaluated thread starts. It cuts the fixed prior-thread set separately at each evaluation point; open prefixes have no synthetic end marker, and the shuffled control sees the same cut prefixes. All arm/per-run values and run-2 one-juncture baselines were recomputed. [Review-fix evidence](review-fixes.json) retains the before/after cells and four legacy leakage cases; [measures.json](measures.json) retains current values, cutoffs and counts. R2/R3 continue to use observation-time snapshots and bins.

Population sizes remain E 49, A1 61, A3 56 and A5 51. E's three-plus share is 0.286 versus full A5's 0.863; R1 recast is 0.510 versus 0.549, a 0.039 difference against the declared 0.10 margin. There is no compatible authored perceived-L2 baseline in the supplied data. Sixteen independent weeks and seven A5 root draws per cell cannot establish long-run saturation.

Supply stages remain E 123 sown → 113 cast → 56 released → 56 perceived and A1 123 → 119 → 68 → 68. Ninety of 123 E sows have only one compatible kit; no logged rival pool has positive F6 or F13. Selected F5 is higher than A1, while F14 barely changes. Stochastic selection chooses below the highest base score in 109 E sows under the declared keyed-noise policy. These logged constraints explain limited opportunities to rank, not counterfactual causes of ratings. A5 refuses five of 56 whole slots: four revelation event casts and one interception item cast. No ordinary closing-kit selection or perceived dedicated closing remains in this matrix.

Production remains graph-only because mixed stage/graph execution exposes the separate [meta:story defect](../../reference/known-issues/mixed-patterns.md). Uprising lacks its S1 intent-end producer; construct/refine remain unsupported. The authorised nominal-actor casting rule and both frozen kernel digests are unchanged by these fixes. New recovery regressions cover saved-only structural membership and swept nominal candidates in incremental and snapshot saves; no casting engine change was needed. Creative wording item 4 remains deferred to Claude. All claims here are offline reference-model evidence.

## Reproduction and verification

From `projects/xf-story-engine/reference/`, rebuild the scored artifacts with `bun tools/m3/build3.ts ../m3/run3` under the repository memory guard at 4 GB, invoking Python by its full installed path. This reads the standing run records and refuses to change a rated packet. Ratings were already completed by the maintainer; do not rerun them to reproduce scoring.

Validation is recorded in [verification.json](verification.json): packet/source/answer hashes; independent arithmetic for weighted/unweighted criteria, seen counts, configurations, renderer/length cells, contrasts, forced choices, omitted ties and repetition calibration; corrected R5 checks; typechecks; targeted/default suites; links; privacy; UTF-8 and frozen digests. Follow-up validation passes: targeted 600 pass / 37 skip / 0 fail; default suite 1,805 pass / 46 skip / 0 fail in 442.38 seconds under the 4 GB guard (peak 1.5 GB). Main and harness-tool typechecks pass, as do links, privacy, strict UTF-8 checks, 5,801 independent rating checks and 768 independent R5 checks. Both frozen digests remain unchanged. Scratch is intentionally left for the maintainer to delete. No game session or commit is part of this checkpoint.
