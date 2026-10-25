# M3 run 2: hooks that ask something of the protagonist

Iteration 2 of the [M3 prototype](../README.md). Run 1 met its fit criterion and lost the blind comparison: every rater preferred the Radiant-style baseline on "worth following up". The diagnosis was that the engine's kits could only tell news. This run gives the engine kits that tell a request, grounded in what happened, and judges them blind again against the same baselines. Run 1's packet, runs and results are untouched beside this folder; this folder holds run 2's. [`results.md`](results.md) is the generated report.

## Result in one paragraph

- **First done-when: met by the scoring sheet's own rule, for this material and this panel; the review fixes below did not change that.** Judged blind by three model raters (two Codex gpt-6.1-sol passes in different orders and a no-context Claude Sonnet), the engine's offers beat the Radiant-style baseline on "worth following up" in every rater (E won 23, 24 and 23 of 24 forced choices; run 1: the baseline won 20, 21, 14 and 20 of 24) and on "seemed caused" in every rater (E won 15, 24 and 22 of 24; run 1: split, the baseline won 14, 13, 13 and 11). Means on the 1 to 7 scales, run 1 in brackets: caused 5.01 (3.79), setting 4.50 (3.74), pull 4.68 (2.98); against the baseline's 3.26, 3.61 and 3.03. **The baseline is still the more legible**: 5.92 against 5.72 (run 1: 6.19 against 3.84), because a job with a price is shorter and plainer than a three-clause message.
- **Selection is still not credited.** Engine against random-within-gates: the engine won "follow" in all three raters (13, 15 and 15 of 24) and won "caused" in none of them (9, 11 and 12 of 24); the means are the same (caused 5.01 against 5.00, pull 4.68 against 4.57). Ranking changes what is sown, not how a card reads (see "Ranking" below).
- **Variety: 0 % of the engine's cards share a masked skeleton** (run 1: 75 %; the target was under 30 %). Random-within-gates 0 %, the baseline 83 % (71 % under run 1's looser slot rule), the authored seed 100 %.
- **The first done-when rests on one harness assumption that the real bridge must make true**: V is told of what happens near it, by a report that names the incident and has no social effect of its own. S1 opens almost no caused or two-stage record near V, and S3 asks of an offer a link to V and a recorded cause. See "The harness report of what V saw".
- **Review fixes.** An independent review found that the harness's report of what V saw was a `disclosure`, which S1 turns into a tie to V, regard and a disclosure count (one report moved an NPC's warmth towards V from 0 to 0.047), and that an offer pattern's second stage did not tie the report to its own incident (a theft could be completed by an accident's report from the same victim). Both are fixed: the report is a passive `tell` that names its incident, and the second stage must match that incident's kind and people. **The twelve runs were played again with the fixed code and came out the same where it matters: their records have the same hashes as the first play, so every sown hook, name, answer and decision is unchanged, and so are the 96 cards.** The one trace of the old behaviour is in two transcripts (E-w5 and A1-w5), where from Friday 23:00 one candidate fewer is in the pool the sower draws from. The pair sides of the forced choices were counterbalanced (see the limits), so the pairs sheets changed and the whole panel rated the rebuilt packet again; the result and its direction are as before, with the counts above.
- **Second done-when:** unchanged. Run 1's result stands; nothing in this run touches R2 or the fit service.

## What changed

### The kits: six offers

[`offers.ts`](../../reference/src/m3/offers.ts) (the words) and [`kits.ts`](../../reference/src/m3/kits.ts) (the builder). Each kit is a sowable `encounter`-level seed in S2's core offer language, lint-clean at `ready`:

- a decision beat whose offer has three actions with different stances and their own costs, a decline, a null path, a lapse that re-offers, and a consequence for each answer: each action writes a seed fact that an exit beat reads, and the decline's exit reads the response;
- an exit beat for each answer, with outcome wordings conditioned on the world (they appear in the transcripts, not on the cards);
- the six kits: a collector's demand at a stall (cover the shortfall, bargain with the Claws, or stand up to them), a theft (trace the goods, lean on the thief's crowd, or cover the loss), a beating (ask why, face the attacker, or see the victim through the clinic), an accident (carry the parcel, ask the client to wait, or take the shift), a street fight between crews (carry word, see them home, or stand with them) and a scuffle in the crowd (find who stirred it up, calm the corner, or see them clear).

Stakes and rewards are not a price list. A request is an account of the incident, an ask, and a clause saying what it is worth and what is at stake, and the clause is chosen by what the world holds, through S2's alternates rule (the most specific applicable wording, then the draw):

| The world | Read through | Changes the clause |
|---|---|---|
| the district's prices | `city priceLevel` | cash amounts that differ by kit and by price (240, 180, 90, 60, 350, 200 ...), or none |
| whether the people know each other | `social tied` | "they have collected from this row for years" against "I had never seen that collector before" |
| how the stalls stand with V | `social label` (the stalls, V, decent) | "the rows know you" against "we have not really met" |
| how hard the fee is pressed | `social normGap fee` | "the whole row is sick of the fee" (fee kit) |
| whether the police press the district | `city regimeIs crackdown` | "with the police all over the district, do it quietly" |

Each kit names each person once and speaks of them as "they", "the thief" or "the other crew" afterwards, so a card does not repeat a full name (run 1's critics named that).

### Variety: wordings, names and the masked skeleton

- **Forms.** A kit has five or six openers, three or four asks and, for each condition of the world it reads, two wordings of the clause. The builder writes a fragment for each opener with three asks and each clause: 195 to 342 asks per kit, 1,651 fragments in all with the exits. The world picks the clause; the draw picks among the rest.
- **Names.** [`names.ts`](../../reference/src/sim/names.ts), read through `S1Data.people.names`: twelve origins of the port city (Japanese, Chinese, Korean, Vietnamese, Latin American, Anglo, Black American and African, Slavic, South Asian, Filipino, Middle Eastern), each with its own given and family names, drawn by weight from the resident's affiliation class and the district (the Claws lean to their own origin, the NCPD to the others). A district's residents now carry well over a hundred given names where the kernel's own pool had seven, and the same full name is rare. No name is one of a character in the game's own stories (a test checks a reserved list) and none is both a given and a family name. The game's records hold no names for street characters, so the registry is the pack's own. The default pack has no registry, so every run before this one rebuilds as it did. The schema audit exempts the pack's own name kind from its heritage lint, as it does the kernel's.
- **The check.** The automatic critic masks names from the whole registry, not only from a pattern of two capitalised words, and then compares cards: the engine's 24 cards are 24 different skeletons, and so are random-within-gates'. Word-pair repetition is 48 % for the engine and 52 % for random-within-gates (run 1: 53 % and 54 %), because the clauses and asks still share their vocabulary.

### Ranking: what layer 3 weighs, and what was tuned

Layer 2's fit hook weighs *who, which wording* (aesthetic terms are absent in M3, variety, yielding to live seeds); it never decides whether to sow. Layer 3's ranking weighs four features of a completed match, banded across the slot's candidates ([S3 6.5 and 7.4](../../../../research/story-engine/spec/procedural.md#65-features-and-gates-for-a-match)): F3 stakes (distinct harmful effects), F5 personal link (V took part, 2, plus the people V has been shown), F6 irreversibility and F11 timeliness, then a diversity penalty for the same pattern or place sown lately.

What the data showed: every offer pattern here carries one harmful effect, so F3 is constant among offers and skipped; F6 is zero everywhere and skipped; so among offers the ranking acts on F5, F11 and diversity only. Against texture, F5 is what matters: an offer exists only where V took part in a stage's event, so it carries at least 2 and a texture candidate usually none.

Tuned as data, no engine rule ([`run2.ts`](../../reference/src/m3/run2.ts)): feature weights F3 2, F5 2, F6 1, F11 1; `lambda` 3 (the default tilt makes the best candidate only 2.7 times likelier than the worst); `diversity` 1; a completed match is a candidate for one game day (`candidateTtl` 86,400 s), because a pool of three days of incidents made every tick slower without making a hook more timely. A1 is the same data with the selection switched off.

What it did, over the six paired worlds (E and A1 on the same worlds and states):

| | E | A1 |
|---|---|---|
| hooks sown | 110 | 110 |
| hooks with an ask | 59 (54 %) | 39 (35 %) |
| mean F11 of the hooks sown (1 is just now) | 0.45 | 0.39 |
| mean F5 of the hooks sown | 1.83 | 1.25 |
| the same, offers only: F5 and F11 | 3.15 and 0.45 | 3.18 and 0.39 |

So ranking does what it was tuned to: more of the hooks are offers, and the ones sown are fresher. It does not change what an offer reads like, and the blind cards are text only, so the panel cannot see it. **E does not beat A1 and the simpler design (random within gates) stands (PNL-11)**: on cards, E and A1 differ by nothing consistent. What would let ranking show in a card is a feature that tracks how much is at stake, and in S1's record near V there is almost nothing that varies: a lone incident has one harmful effect, and chains (a demand and then the police) are not realised near V.

### The harness report of what V saw

S3 asks two things of an offer: V takes part in a stage's event (gate 5), and the last event has a recorded cause (gate 3). S1 opens an incident into people only where something is looking, and in run 1's six-day runs that was 43 incidents with named people, 5 of them with a cause, none a chain over the same people. Run 1's two-stage tellings ("a collector's demand, then the police") were never sown, and in a three-day pilot of this run's patterns, before the report below was added, no two-stage pattern over the same people completed. So an offer cannot come from S1's record on its own, whatever the kit says.

The driver therefore stands in for the game's report of what V saw (`RunExtra.witness`, `witnessReport` in [`driver.ts`](../../reference/src/m3/driver.ts)): when an incident that an offer pattern has matched opened at the block V stood in, or at one beside it, the driver mints a report, a `tell` event (S1's own kind for one person telling another about someone). The person the incident happened to is the teller, V the listener, the other people of the incident and the incident itself are its subjects, and the incident is its cause. Each offer pattern is two stages, the incident and that report, so gates 3 and 5 are passed by what is in the record, not assumed ([`witness.test.ts`](../../reference/test/m3/witness.test.ts) checks the events and that without the report no offer is sown). The replay port gained two small things for it: it names a resident or an event by its Id, and a replayed event can name its causes.

**The report is passive.** S1's witness, tie and absorb policies ignore a `tell`, so it forms no belief, makes no tie to V and no regard, and counts as no disclosure. The first version minted a `disclosure`, which S1 4.7 turns into a tie with warmth and trust deltas and a disclosure count: that was a social effect that a report of V merely seeing something has no business having, and the old text claiming the driver "changes nothing else" was wrong. `witness.test.ts` now compares S1's whole record (every edge, the beliefs, the record's histories) with and without the report, outside the report event itself, and shows that the same report sent as a `disclosure` does change it.

**The report is of one incident.** The second stage of an offer pattern must be a report by the person the first stage bound as its victim, naming the people it bound as subjects, and naming as a subject an occurrence of the first stage's kind (S3's patterns match participants and effects, not causes, so the occurrence rides as a subject as well as being the cause). A report of an accident does not complete a theft of the same victim, nor a report of one aggressor's theft another aggressor's ([`witness.test.ts`](../../reference/test/m3/witness.test.ts) plays overlapping incidents of one victim). What S3 cannot say is that the report names the very event that opened the first stage: two incidents of one kind among the same people are one match by S3's own rule, and the driver reports the matched one. The real bridge's report must name its incident the same way.

**This is the assumption the result rests on.** The real bridge must report what V saw, as an event with V in it and the incident as its cause, or S3's gates will refuse every offer. It belongs on the bridge's list.

## The run

Six worlds, each played twice (arm E and arm A1) for six game days at the restless setting, on four story states (`S-early-quiet` twice, `S-mid-squeezed` twice, `S-mid-crackdown`, `S-late-wary`), at run 1's incident density (eight times the base rate). [`runs/`](runs/) holds the twelve records, transcripts and compact transcripts; [`blind/`](blind/) the packet, the manifest `inputs.json` that rebuilds it exactly, the three raters' sheets and answers; [`sensitivity/`](sensitivity/) the supplementary packet below.

- **Hooks:** the engine sowed 110 hooks, 59 of them offers (random-within-gates 110 and 39); the fee kit, the best received in run 1's critics, was sown twice, because S1 realises few collector demands near V.
- **Cards:** 24 per arm, sampled from the offers (59 and 39 available) for the engine arms, with names that do not collide on a card. The baseline and the authored seed are regenerated over fresh worlds with the same name registry, so a name is no tell. A3 follows the declared nearest-slot rule; A4 is R2's offer.
- **Raters:** codex gpt-6.1-sol at high effort twice, each with its own balanced order, and a no-context Claude Sonnet (no tools, no memory, no project files; the harness attaches only the account's email line), through the CLI. Three raters, not four: run 1's second Codex model (gpt-6-astra) and Opus are not used. Per-rater counts only; no pooled significance test (dossier 23, as corrected). The first and third rater (the two Codex passes) see every pair with its sides mirrored, and each comparison has twelve pairs of each orientation on every sheet.

### The blind pass by criterion

Means on 1 to 7 over each rater's 24 cards per arm (72 ratings), run 1 in brackets (four other raters, different cards):

| Criterion | E | A1 | A3 | A4 |
|---|---|---|---|---|
| Caused | 5.01 (3.79) | 5.00 (3.88) | 3.26 (3.98) | 5.33 (6.00) |
| Legible | 5.72 (3.84) | 5.69 (3.94) | 5.92 (6.19) | 5.00 (5.75) |
| Setting | 4.50 (3.74) | 4.38 (3.49) | 3.61 (4.02) | 5.67 (6.00) |
| Pull | 4.68 (2.98) | 4.57 (2.83) | 3.03 (3.77) | 4.33 (5.00) |
| Called "program" | 67 of 72 | 70 of 72 | 71 of 72 | 72 of 72 |

Forced choices (24 each; wins of the first arm, rater by rater in the order Sol-a, Claude, Sol-b; run 1's four raters in brackets in the order Sol, Astra, Sonnet, Opus):

| | Question | Run 2 | Run 1 |
|---|---|---|---|
| E against A3 | follow | 23, 24, 23 | (4, 3, 10, 4) |
| E against A3 | caused | 15, 24, 22 | (10, 11, 11, 13) |
| E against A1 | follow | 13, 15, 15 | (12, 13, 13, 14) |
| E against A1 | caused | 9, 11, 12 | (10, 10, 12, 12) |
| A4 against A3 | follow | 21, 24, 24 | (22, 22, 17, 24) |
| A4 against A3 | caused | 24, 24, 24 | (24, 24, 22, 24) |

(The run 2 counts for E against A3 are the engine's wins, the complement of the baseline's in [`results.md`](results.md). Before the sides were counterbalanced, the first play of this panel gave E against A3 follow 23, 24, 22 and caused 19, 24, 19, and E against A1 follow 14, 13, 15 and caused 11, 11, 10: the same direction in every cell, with one move of note, Sol-a's "caused" for E against A3, 19 then 15 of 24, still above half.) The raters disagree more than in run 1 on caused, legible and pull and not on setting: the share of rater pairs differing by two points or more is 0.26 on caused, 0.17 on legible, 0.04 on setting and 0.21 on pull (run 1: 0.14, 0.07, 0.06, 0.03). The sheet's decision rule (the engine's share against A3 above one half on both questions in every rater alone, and its means on caused and pull above A3's) is met.

**Sensitivity: the baseline under run 1's looser slot rule.** The declared rule (nearest eligible resident and place) makes the baseline's jobs repeat the same people and venues, so it reads flatter than run 1's did. [`sensitivity/`](sensitivity/) is the same packet with A3 under run 1's `rated-v1` rule (the engine, A1 and A4 cards are the same, with the same counterbalanced sides), rated by the same three raters. The result holds: E against A3 follow 23, 24, 23 of 24 and caused 16, 18, 20; means E caused 4.82 and pull 4.61 against A3's 3.43 and 3.13. The odd cell of the first play, Claude putting A3 ahead of A4 on "follow" in all 24 pairs there, did not come back with the sides counterbalanced (A3 ahead in 12 of 24 on follow and 11 on caused, the control at chance in this packet for this rater); it does not touch the engine's columns.

### What the critics named

Three model critics and the automatic critic:

- **The closing clause.** Most cards end on a line about reputation or being a stranger ("people trust you with their things", "you will not know me") that reads detachable and interchangeable across scenarios.
- **Three-option menus** that join different needs without saying how they connect; the third option is often "pay for it", which reads as a way out of the investigation.
- **Pronoun joins**: a switch from third-person reporting to first-person speech, and "they" for the person asked about.
- **Repeated phrases** across cards ("somebody must have given the nod", "I had never seen them before the fight").
- **Generic nouns under precise names**: motives, possessions, crews and jobs stay generic.
- **What worked**: injury that costs income, protection money with a Friday deadline, and a refused collector's threat with the stalls organising ("something already underway before V arrives"). The most convincing chain is the one with an existing pressure and a consequence. The critics of the replayed panel named the same families of tells, and the same cards as the strongest.
- **The authored seed** repeats verbatim (exact duplicates); the baseline has fixed prices and stock role labels, as before.

## Limits

- **The report of what V saw is a harness stand-in** (above); the engine's offers exist only through it.
- **Three raters** from two model families, all models; the human blind pass of run 1's packet is still ready and this packet can be given to the maintainer the same way (`blind/rater-1.md` is a whole sheet). The raters disagree more than run 1's on three of the four scales.
- **Counterbalanced sides.** Run 1's packet drew each pair's sides once for every rater, so a rater's side preference could look like a taste. This packet's manifest says `sides: balanced`: each rater's sheet has exactly half of each comparison's pairs with the first arm on the left, and the first and third raters see every pair mirrored. A rater's answer is read against its own sheet's sides (the answer files carry `sheet`). The reader of run 1's packet should know its sides were not balanced; run 1 is untouched.
- **Run 1's panel and run 2's differ** (Sol twice and Sonnet against Sol, Astra, Sonnet and Opus), and the cards differ, so the run-over-run comparison is of direction and size, not of paired items.
- **Card length.** The engine's cards run 68 words and the baseline's 24; the baseline stays the more legible.
- **Kit supply is S1's.** The fee kit was sown twice; the engine's offers are mostly the theft, accident, fight and beating kits.
- **Everything is the reference model on the offline replay port.** Nothing here is game evidence.

## Rerun

From `projects/xf-story-engine/reference/`, each under the memory guard:

- `bun test test/m3/` runs the phase tests of both runs; the long ones (the 108-window witness runs, every kit under every answer, and the rebuilds of both packets from their manifests, about 30 to 40 s each) wait behind `S1_FULL=1`, and the default versions check the same behaviour in a few minutes less (the committed packets are checked against the committed runs and the balanced sides without the rebuild).
- `bun tools/m3/run2-hooks.ts <file> <world> <state> restless <E|A1> 6 ../m3/run2/runs` writes one hook run (name the file `E-...` or `A1-...`; about 20 to 35 minutes for six game days, twelve at a time, each under `memory_guard.py --limit 2`).
- `bun tools/m3/make-manifest2.ts ../m3/run2/runs ../m3/run2/blind/inputs.json 24 3 <run file>...` writes the manifest (balanced sides); `bun tools/m3/build-packet.ts ../m3/run2/blind/inputs.json ../m3/run2/runs ../m3/run2/blind` builds the packet (`M3_A3_RULE=rated-v1` for the sensitivity one).
- `M3_RATER_CWD=<empty folder> bun tools/m3/rate.ts <codex|claude> <model> <sheet> <answer.json> <rater> [effort]` runs one model rater (the answer records which sheet, `rater-N.md`, it answered).
- `bun tools/m3/report2.ts ../m3/run2/runs ../m3/run2/blind ../m3/run2/blind/answers ../m3/blind ../m3/blind/answers ../m3/run2/results.md` writes the report, with run 1 beside it.
