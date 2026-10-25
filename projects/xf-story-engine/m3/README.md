# M3: the offline prototype

The M3 run of the [plan](../../../research/story-engine/plan.md#4-milestones) over the reference model: Kabuki through S1, layer 2 with the authored seed R2, layer 3 sowing at three proactivity settings, text output, synthetic players, a blind pass and an adversarial critic pass. The harness is [`reference/src/m3/`](../reference/src/m3/) with its tools in [`reference/tools/m3/`](../reference/tools/m3/) and tests in `reference/test/m3/`. This folder holds the run outputs. [`results.md`](results.md) is the generated report.

## Result in one paragraph

- **Second done-when: met.** R2 with sowing off is fitted and played the same way as with sowing on: on all six story states, under three policies, the fit report (verdict, windows, cast, draws, exits, timing, decline preview, cost) and the play (cast, draws, offers, answers, beats, closure) are identical with layer 3 absent, attached with tempo off, and sowing on ([`fit/fit-results.md`](fit/fit-results.md)).
- **First done-when: not met.** Judged blind by four model raters from two families, the engine's hooks did not beat the Radiant-style baseline. They lost on whether to follow a hook up (the baseline won 75 of 96 forced choices, p below 0.001, and each rater alone favoured the baseline), tied on seeming caused (45 to 51), and were rated far below it on legibility (3.8 against 6.2). The engine also did not beat random-within-gates. The authored seed R2 was rated best on every scale.

## What each phase produced

| Phase | Output |
|---|---|
| 0. R2 | [r2.ts](../reference/src/m3/r2.ts): "The Friday Fee", lint-clean at `ready`, core constructs only, with an author-fill stand-in; tests in `test/m3/r2.test.ts` show it waits, casts from generated residents, plays all four answers and the lapse |
| 1. Driver | [driver.ts](../reference/src/m3/driver.ts), `states.ts`, `transcript.ts`: six story states from the facts table, a deterministic run through the replay port, a text transcript (S1 week text, the deliveries' words, layer 3's decision log) and a machine-readable record with a hash; [`runs/`](runs/) |
| 2. Sowing off | [`fit/`](fit/): 18 comparisons, all agree |
| 3. Sowing on | six six-day runs on one busy Kabuki: calm 4 hooks, steady 9, restless 19 (the schedule thins in nested steps as specified), and the engine's hook material in [hooks.ts](../reference/src/m3/hooks.ts) |
| 4. Baselines | A3, A1 and A4 as [defined in dossier 23](../../../research/story-engine/craft/d23-evaluation-testing.md#541-the-three-m3-arms-defined) before they were built; [arms.ts](../reference/src/m3/arms.ts) |
| 5. Blind pass | [`blind/`](blind/): 96 cards (24 per arm), four balanced orders, 96 forced-choice pairs, a scoring sheet, the key kept apart, and four raters' answers in [`blind/answers/`](blind/answers/) |

## The blind pass by criterion

Four raters, each blind, each with a different balanced order: Codex gpt-6.1-sol and gpt-6-astra at high effort, and a Claude Sonnet and a Claude Opus with no context (no tools, no memory, no project files). Means on a scale of 1 to 7 over 96 ratings per arm; the engine is E, random within gates A1, the baseline A3, the authored seed A4.

| Criterion | E | A1 | A3 | A4 |
|---|---|---|---|---|
| Caused (bar 1) | 3.79 | 3.88 | 3.98 | 6.00 |
| Legible (bar 3) | 3.84 | 3.94 | 6.19 | 5.75 |
| Setting (bar 6) | 3.74 | 3.49 | 4.02 | 6.00 |
| Pull (bars 2 and 4) | 2.98 | 2.83 | 3.77 | 5.00 |
| Called "program" | 88 of 96 | 94 of 96 | 96 of 96 | 96 of 96 |

Forced choices (96 each; two questions): E against A3, "follow": E won 21, p below 0.001; "caused": E won 45, p 0.61. E against A1: E won 52 (follow) and 44 (caused), p 0.48 each. A4 beat A3 on both questions (p below 0.001).

Reading of it, by the dossier's rules:
- **"Hooks beat the baseline": refuted for this material** (verdict "refuted" on follow-up and legibility, "equivalent" on caused and setting). The engine's hooks here are rumours and sightings with no action in them, and the baseline's are jobs that say what to do and what it pays; the legibility gap (what could you do?) carries most of the loss. The raters' own cues say so.
- **Selection is not credited.** E against A1 is a null on every item, so by PNL-11 the simpler design (random within gates) stands until a feature shows a difference. The kits and the supply of candidates, not the ranking, set what the hooks read like.
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

- **The district** is S1's Kabuki stand-in slice: the game's real figures for Kabuki (the 2,964 entry quantity and the gang counts, from the population research) over a generated graph, until the real index is built. The run is not on a graph read from the game's files.
- **Incident density is raised by a factor of eight** in the hook runs, and V walks the district, so the fine tier has enough to tell. At default density a game week gives about four hooks.
- **Standing with the stalls** is made by replaying acts and lowering the ledger's minimum mass ([`SPEC-NOTES`](../reference/SPEC-NOTES.md#the-m3-offline-prototype-srcm3-toolsm3), M3-07), and is named in each transcript's header.
- **The first two story states** in the stored transcripts still list a player-background fact that R2 never reads; the states no longer set it, and a rerun would not print it.
- **Everything is the reference model on the offline replay port.** Nothing here is game evidence.

## Rerun

From `projects/xf-story-engine/reference/`, each under the memory guard:

- `bun test test/m3/` runs the phase tests (`S1_FULL=1` runs all six states in the fit test).
- `bun tools/m3/run-fit.ts <dir>` writes `fit-results.md` and the sowing-off transcripts.
- `bun tools/m3/run-hooks.ts <file> <world> <state> <tempo> <E|A1> <days> <dir>` writes one hook run (about 7 to 16 minutes for six days with layer 3).
- `bun tools/m3/build-packet.ts <rundir> <outdir> 24 4` builds the blind packet; `bun tools/m3/report.ts <rundir> <packetdir> <answersdir> <out.md>` scores it.
