# M3: the offline prototype

The M3 run of the [plan](../../../research/story-engine/plan.md#4-milestones) over the reference model: Kabuki through S1, layer 2 with the authored seed R2, layer 3 sowing at three proactivity settings, text output, synthetic players, a blind pass and an adversarial critic pass. The harness is [`reference/src/m3/`](../reference/src/m3/) with its tools in [`reference/tools/m3/`](../reference/tools/m3/) and tests in `reference/test/m3/`. This folder holds the run outputs. [`results.md`](results.md) is the generated report.

## Result in one paragraph

- **Second done-when: met, as its criterion is written.** The criterion is that R2 is *fitted* the same way with sowing off as with it on, and it is: on all six story states, under three policies, the fit report (verdict, windows, cast, draws, exits, timing, decline preview, cost, findings) is identical with layer 3 absent, attached with tempo off, and sowing on, in all 18 comparisons ([`fit/fit-results.md`](fit/fit-results.md)). The *play* is not identical, and is not claimed to be. Layer 3's pacing holds the first delivery of an open R2 by two hours (12 of the 18 comparisons; the other six are states where R2 waits or has closed). In 17 of the 18 the selected fragments, the delivered words, the answers and the end state are the same. In one (S-mid-squeezed, accepting first) the later release meets a later world: the stalls know V by then, so the beat delivers the "known" payment text instead of the "plain" one. That is layer 3 doing its pacing job, not a defect, but it is a difference in play.
- **First done-when: not met.** Judged blind by four model raters from two families, the engine's hooks did not beat the Radiant-style baseline. They lost on whether to follow a hook up (the baseline won 75 of 96 forced choices, and each rater alone favoured it: 20, 21, 14 and 20 of 24), showed no demonstrated difference on seeming caused (the baseline won 51 of 96, and the raters split: 14, 13, 13 and 11 of 24), and were rated far below it on legibility (3.8 against 6.2). The engine also did not beat random-within-gates. The authored seed R2 was rated best on every scale.

## What each phase produced

| Phase | Output |
|---|---|
| 0. R2 | [r2.ts](../reference/src/m3/r2.ts): "The Friday Fee", lint-clean at `ready`, core constructs only, with an author-fill stand-in; tests in `test/m3/r2.test.ts` show it waits, casts from generated residents, plays all four answers and the lapse |
| 1. Driver | [driver.ts](../reference/src/m3/driver.ts), `states.ts`, `transcript.ts`: six story states from the facts table, a deterministic run through the replay port, a text transcript (S1 week text, the deliveries' words, layer 3's decision log) and a machine-readable record with a hash; [`runs/`](runs/) |
| 2. Sowing off | [`fit/`](fit/): 18 comparisons; the fit agrees in all, the play agrees on selection and content in 17, and 12 are released two hours later |
| 3. Sowing on | six six-day runs on one busy Kabuki: calm 4 hooks, steady 9, restless 19 (the schedule thins in nested steps as specified), and the engine's hook material in [hooks.ts](../reference/src/m3/hooks.ts) |
| 4. Baselines | A3, A1 and A4 as [defined in dossier 23](../../../research/story-engine/craft/d23-evaluation-testing.md#541-the-three-m3-arms-defined) before they were built; [arms.ts](../reference/src/m3/arms.ts) |
| 5. Blind pass | [`blind/`](blind/): 96 cards (24 per arm), four balanced orders, 96 forced-choice pairs, a scoring sheet, the key kept apart, the input manifest `inputs.json` that rebuilds the packet exactly, and four raters' answers in [`blind/answers/`](blind/answers/) |

## The blind pass by criterion

Four raters, each blind, each with a different balanced order: Codex gpt-6.1-sol and gpt-6-astra at high effort, and a Claude Sonnet and a Claude Opus with no context (no tools, no memory, no project files). Means on a scale of 1 to 7 over 96 ratings per arm; the engine is E, random within gates A1, the baseline A3, the authored seed A4.

| Criterion | E | A1 | A3 | A4 |
|---|---|---|---|---|
| Caused (bar 1) | 3.79 | 3.88 | 3.98 | 6.00 |
| Legible (bar 3) | 3.84 | 3.94 | 6.19 | 5.75 |
| Setting (bar 6) | 3.74 | 3.49 | 4.02 | 6.00 |
| Pull (bars 2 and 4) | 2.98 | 2.83 | 3.77 | 5.00 |
| Called "program" | 88 of 96 | 94 of 96 | 96 of 96 | 96 of 96 |

Forced choices (96 each; two questions), as counts. They carry no significance test: the four raters judge the same 24 items per arm, so the pooled n of 96 is not a sample of independent choices. The evidence is the direction, rater by rater (wins out of 24 each, in the order Sol, Astra, Sonnet, Opus):
- E against A3, "follow": A3 won 20, 21, 14 and 20 (E won 21 of 96 in all). "Caused": A3 won 14, 13, 13 and 11 (E won 45 of 96), a split with no consistent direction.
- E against A1: E won 12, 13, 13 and 14 on "follow" and 10, 10, 12 and 12 on "caused" (52 and 44 of 96 in all), no consistent direction.
- A4 against A3: A4 won 22, 22, 17 and 24 on "follow" and 24, 24, 22 and 24 on "caused", every rater, both questions.

Reading of it, by the dossier's rules:
- **"Hooks beat the baseline": refuted for this material** (verdict "refuted" on follow-up and legibility, where every rater's direction and the means agree; "no demonstrated difference" on caused and setting, which is not evidence that there is none: dossier 23 NUL-02, and no equivalence bound was fixed for this run). The engine's hooks here are rumours and sightings with no action in them, and the baseline's are jobs that say what to do and what it pays; the legibility gap (what could you do?) carries most of the loss. The raters' own cues say so.
- **Selection is not credited.** E against A1 shows no difference on any item, so by PNL-11 the simpler design (random within gates) stands until a feature shows a difference. The kits and the supply of candidates, not the ranking, set what the hooks read like.
- **Cause is where the engine's material was strongest.** The one two-stage telling (a collector's demand, then the police) and the fee cards were named as the most caused; plain assault, accident and sweep bulletins were named as the flattest.

## What the critics named as giveaways

Four model critics (the `critic` field of each answer) and the automatic critic ([`results.md`](results.md)) agree:
- **Frames repeated with names swapped.** The engine's kits have four to five frames each, and one run draws the same frame several times; 75 % of engine cards share a masked skeleton with another, and A1 83 %. The authored seed's offer is one frame, so 100 % of its cards do; it still rated highest because the frame carries a cause and a request.
- **A small name pool.** S1's residents have a pool of seven first names and six surnames, so full names repeat across cards, two people on one card can share a name, and "Kenji Mori" turns up again and again.
- **Fixed prices and role labels.** The baseline's rewards come in tiers of 250, 500 and 1000 and its role labels change nothing in the sentence.
- **Bulletins with no cause and nothing to do.** The accident and "taken for treatment" lines.
- **Stock phrases** ("no questions", "the street crowded round for a minute").

## What this says about the next step

- Hooks that carry something to do, or that follow an earlier telling to the same people (an offer sown after a rumour, S3's gate 5), are the first thing to try. The engine's gates already allow it; the kits and patterns for it were not built here.
- More frames per kit, and a larger name pool in S1, would remove most of the repetition the critics named.
- The panel here is four models. It is the first judge, not the last: the maintainer's blind pass over the same cards is ready (`blind/rater-1.md` is the whole sheet) and can be scored with `tools/m3/report.ts`.

## Limits

- **The baseline A3 of the rated packet deviates from the declared slot rule.** Dossier 23 5.4.1 declares that each slot takes the nearest eligible resident or place, ties to the smaller identifier. The rated packet's A3 took a keyed draw among the first four residents of the nearest ring and drew places from every ring and then the whole district, so its jobs were less local and more varied than declared. The packet was not regenerated or re-rated and its verdicts stand for the baseline as it was; `rated-v1` in `arms.ts` keeps that rule so the packet can still be rebuilt, and runs from now on use the declared rule.
- **The rated packet is pinned to four runs.** `blind/inputs.json` lists the restless E and A1 runs it was sampled from (36 E hooks and 36 A1 hooks available, 24 each used), by file name and record hash. The calm and steady runs in [`runs/`](runs/) are not in it.
- **The pooled forced-choice counts are descriptive.** No significance is claimed (see the blind pass above).
- **The district** is S1's Kabuki stand-in slice: the game's real figures for Kabuki (the 2,964 entry quantity and the gang counts, from the population research) over a generated graph, until the real index is built. The run is not on a graph read from the game's files.
- **Incident density is raised by a factor of eight** in the hook runs, and V walks the district, so the fine tier has enough to tell. At default density a game week gives about four hooks.
- **Standing with the stalls** is made by replaying acts and lowering the ledger's minimum mass ([`SPEC-NOTES`](../reference/SPEC-NOTES.md#the-m3-offline-prototype-srcm3-toolsm3), M3-07), and is named in each transcript's header.
- **The first two story states** in the stored transcripts still list a player-background fact that R2 never reads; the states no longer set it, and a rerun would not print it.
- **Everything is the reference model on the offline replay port.** Nothing here is game evidence.

## Rerun

From `projects/xf-story-engine/reference/`, each under the memory guard:

- `bun test test/m3/` runs the phase tests (`S1_FULL=1` runs all six states in the fit test); the packet test rebuilds the rated packet from its manifest and takes about 40 s.
- `bun tools/m3/run-fit.ts <dir>` writes `fit-results.md` (the fit and the play compared separately) and the sowing-off transcripts.
- `bun tools/m3/run-hooks.ts <file> <world> <state> <tempo> <E|A1> <days> <dir>` writes one hook run (about 7 to 16 minutes for six days with layer 3).
- `bun tools/m3/make-manifest.ts <rundir> <out.json> 24 4 <declared|rated-v1> <run file>...` writes a packet manifest (the runs named one by one, sorted, with their record hashes); `bun tools/m3/build-packet.ts <manifest.json> <rundir> <outdir>` builds the blind packet from it (only the listed runs are read); `bun tools/m3/report.ts <rundir> <packetdir> <answersdir> <out.md>` scores it, with the forced choices pooled and per rater.
