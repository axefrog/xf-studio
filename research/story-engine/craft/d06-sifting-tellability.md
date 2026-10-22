# Dossier 6: sifting and tellability

**Status:** v1, 22 October 2026. Dossier 6 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: SEL-01 (story sifting), SEL-02 (tellability, eventfulness and unexpectedness). Supporting, as comparisons only under [D-21](../decisions.md): SEL-09 (news values) and SEL-13 (pragmatics: relevance theory and common ground). Feeds P5 (the procedural engine), and in a smaller way P4 (what a sifted seed hands to the seeding layer), P9 (evaluation) and P10 (tooling). Kernel references are to [S0](../spec/kernel.md).

**In brief**
- **Sifting works as a pipeline, not as a score.** Simulate, match patterns against events, keep the matches that survive, then choose. The literature supports the separation of generation from selection as a design. It does not yet show, in any live game I could find, that a sifter makes play more enjoyable.
- **The only reader test of generic tellability heuristics is a null result, and the one favourable test is tiny.** A 24-reader study found no relation between "improbable" or "dramatic situation" chains and enjoyment. A three-rater study found a within-pattern rarity heuristic agreed with raters in 38 of 45 pairs. They measure different things. The lens summary ran them together; this dossier separates them (§3.3).
- **Four of Schmid's five eventfulness criteria could not be turned into general formulas** in the one project that tried (irreversibility, non-iterativity, effect, relevance). The engine has what that project lacked: a typed effect vocabulary, edges with end times, and a record of what the player has seen. So it can try again, but the result is a hypothesis.
- **Tellability belongs to an event, an audience and a context together.** A score that ignores the audience will repeat the null result. In this engine the audience model exists already: V's observed record and the director's beliefs about V ([D-09](../decisions.md)).
- **Incremental matching with a bounded pool of partial matches is the right machine,** and a naive port is too slow. The published one costs about 0.1 s per event at 100 partial matches and about 0.9 s at 1,000 (JavaScript, a Datalog store). The kernel's first implementation scans every interest per change ([§10.5](../spec/kernel.md#105-changes-and-matching)), so the pool needs caps, expiry and a first-clause index from the start.
- **The kernel already holds most of what a sifter reads, with eight gaps.** Belief changes, frame status changes and attempt outcomes are not Changes. The effect vocabulary lacks the verbs of betrayal and deceit. Non-canon events are forgotten, so a pool that stores bare `Id`s will lose its own evidence. The gaps are in §7.4.
- **No single generation method suits the whole of P5.** Each answers a different question. Sifting is the default for "what story is in the record". Planning is a validator and a bridge-builder for short chains. Constraint solving is casting. Grammars recognise and shape. Generate-then-justify fills causes under a write-once rule. Search belongs to ordering and pacing (dossier 7), computed offline.

## 1. Scope and why it matters here

[Design seed DS-01](../design-seeds.md) says the procedural engine selects rather than generates: simulate, sift the record for story-shaped patterns, then let a director choose what surfaces. Sowing, the first role of layer 3 ([plan §2](../plan.md#2-the-system-at-first-level)), starts here. This dossier asks three things. How do sifters work, and where do they fail? What makes a chain of events worth an offer, in a form a procedure can score? Which generation methods should P5 use for which job, and how do they sit on the kernel's record?

| Layer or concern | What this dossier gives it |
|---|---|
| 3. Procedural engine (sowing) | The pipeline from events to offers; a pattern form over kernel events; tellability features; the choice of method per question (§6, §7, §11) |
| 3. Procedural engine (fitting) | Planning and constraint solving as validators and bridge-builders for authored seeds (§6); the credibility rule for connecting material (TEL-10) |
| 2. Seeding layer | What a sifted match hands over: bound roles, cited causes, a stake statement (R-17, R-18) |
| 1. Simulation layer | What the sifter needs from the record: rich events, kind tags, belief and frame changes, retention (§7.4) |
| 4. Authored content | Sifting patterns as content-pack data; authoring cost as the limiting resource (SFT-08) |
| Evaluation (E) | Tellability features as hypotheses with logging; null-result-aware test designs (TEL-15, R-25) |
| Tooling (T) | Every offer carries the pattern, the bindings and the feature scores, so "why this?" has an answer (R-24) |
| Expression (X) | The lead and the point belong to staging, not selection (TEL-11) |

**Proportion.** This dossier does not decide the scheduler, the tension budget or pacing (dossier 7), the casting algorithm (dossier 3), the seed language (dossier 4), or text generation (dossier 22). It touches each only where sifting meets it.

**Comparison fields (D-21).** SEL-09 and SEL-13 are cross-checks. The engine's own notions of context and relevance are first-party and are worked out in the [foundation](../foundation.md#5-context-and-relevance). News values and relevance theory appear here only to check whether the engine's selection rules miss something that outside work found.

**Grades.** [empirical], [practice], [shipped], [corpus], [analysis], [hypothesis] as in P1 §4. **contested** marks a claim two sources dispute. Source status: *read* (fetched and read this session), *abstract*, *summary* (only a search summary or a lens's account was seen), *memory*.

## 2. The failure record

Failures come first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses patterns, §2.3 lists where the advice itself fails.

### 2.1 Cases

| # | Case | What was tried | What went wrong | Evidence |
|---|---|---|---|---|
| S-01 | **Pure simulation as a story source** (Ryan's *Talk of the Town*, 2018) | A small-town simulation with beliefs, gossip and romance, mined by hand | Per Short's recap, Ryan himself says the knowledge the characters trade is not prone to narrative intrigue (they mostly discuss hair and eye colour). Short adds that curation alone does not decide quality: interlocking systems, modelled stakes and motives, and the range of outcomes matter too | *read*: Short's two recaps [practice, with opinion] |
| S-02 | **Chroniqueur** (Lessard et al., FDG 2026) | 61 simulated years gave 228,000 unique events in 27,000 causal chains. Chains were sifted by world-level improbability (a Markov model of the event space) and by 10 of Polti's 36 dramatic situations. Six categories (the most improbable chain or a random one, for each of two situations and for none) gave 12 short stories, each written once by a human and once by GPT-4. 24 readers scored them on six 5-point scales | No significant relation between either heuristic and enjoyment. The favourite was the control: a random chain with no situation, in which a tribe chief confides an affair to a clan leader who is delivering a food contribution. The most improbable chain (a death by meteorite, then an unrelated conversation at the funeral) puzzled readers. Longer simulations produced extreme outliers that "defied narrative explanations". One event type (affairs) was over-prevalent. The same events ranked 3rd in the human version and last in the GPT-4 version | *read*: full paper [empirical, small, one world] |
| S-03 | **Eventfulness criteria that would not become formulas** (same paper, §4.1) | Schmid's criteria tried as sifting scores: relevance, improbability, irreversibility, non-iterativity, effect | Relevance needs a protagonist, so it fails at world scale. Irreversibility needs a record of states being restored, and the world holds almost none. Non-iterativity collapsed into commonness, which gave the same ranking as improbability. Effect failed because the variables sit on incomparable scales (one child more, against 20 food gained and 30 health lost). Only improbability and the dramatic situations went to the readers | *read* [empirical, negative; the authors' own account] |
| S-04 | **Retrospective, hard-to-write sifters** (Felt, 2019; Winnow paper, 2021) | Patterns as Datalog queries over a finished log | Matches appear only after the story has finished, so a system cannot foreshadow or steer. The notation is close to raw Datalog, so complex patterns are hard to read, and the negative-constraint syntax is a stated pain point | *read*: Winnow paper [analysis] |
| S-05 | **The cost of incremental matching** (Winnow, JavaScript with a Datalog store) | Update the pool of partial matches on every event | Per-event update times in the paper's benchmark: pool of 10, about 13 ms on average; 100, about 93 ms; 500, about 460 ms; 1,000, about 912 ms (maximum 1.1 s). The authors judge this adequate for interactive use because narratively significant events are rarer than once a second, and note many easy optimisations | *read*: Winnow paper, Table 1 [analysis, measured] |
| S-06 | **A heuristic tested on a toy** (Kreminski et al., ICIDS 2022) | Rank matches by the average rarity of their properties within the same pattern's matches | The test world had 20 characters, 24 action types and 1,000 events of randomly chosen actor, target and action. Five patterns, one run, three raters judging 15 pairs: raters chose the heuristic's pick in 38 of 45 pairs (84.44 %). Two patterns had only 12 or 13 matches to choose from. The authors call the setting a worst case for presentation and give cherry-picked examples as a second line of evidence | *read*: full paper [empirical, very small] |
| S-07 | **Language models as sifters** (Méndez and Gervás, as reported by Lessard et al.) | A chat model asked to find interesting events | Handled only a few events at a time; the authors were not convinced. An evolutionary sifter by the same authors, in the same report, would not scale to Chroniqueur's event space | *summary*: via Lessard et al. [analysis] |
| S-08 | **Sifting evaluated on everything but enjoyment** | Composable patterns (Lyu et al., 2025) tested for stability and cost; Arc Sift (Leong et al., 2022) tested for intuitiveness of drawing an arc; Centrifuge tested as a proof of concept | None of these tests asks whether a reader or player enjoys the sifted output. Lessard et al. say so of the field: it has mostly evaluated algorithmic relevance and interface usability | *read* [analysis] |
| S-09 | **Retellings need the world** (Sych 2020, via Lessard et al.) | Player retellings of Dwarf Fortress | The retold story is often a weirdness only someone who knows the world can see. Lessard et al.'s authors found their own stories "not great" to outsiders and put it down to familiarity | *read*: Lessard et al.'s account of Sych [analysis] |
| S-10 | **Hindsight and apophenia do the work** | Hand-picked sifting successes | A sequence that looks storyful may owe its shape to the reader supplying motives the simulation does not model. Kreminski et al. call this extrapolative narrativization and treat it as a feature. Caves of Qud's designers rely on apophenia on purpose. It is also a bias in any success story told about sifting | *read*: Kreminski et al.; Grinblat and Bucklew [analysis] |

**Generation without selection** is covered by the other dossiers' failure records: Radiant quests, errand chains and offers with no cause ([dossier 4, F-01 to F-05](d04-quest-structure.md#21-cases)). They are the negative case that DS-01 answers.

### 2.2 What the failures have in common

| # | Pattern | Cases | What is missing | A test that catches it | Answered by |
|---|---|---|---|---|---|
| P-1 | **A world-level score stands in for an audience-level one** | S-02, S-03, S-09 | A model of what this audience expects and knows | Score the same chain for two audiences that know different things; the scores should differ | TEL-01, TEL-03, SFT-10 |
| P-2 | **Unbounded rarity selects length and noise** | S-02 | A focus (a protagonist) and a length cap | Plot rating against chain length; look for a peak, then a fall | TEL-04 |
| P-3 | **One event type floods the offers** | S-02 | Diversification across patterns and event kinds | Share of offers by pattern and by kind | SFT-13, TEL-12 |
| P-4 | **The criteria cannot be computed from the record** | S-03 | Typed effects, ended edges and an audience record | For each criterion, name the record field that feeds it | TEL-08, MAP-07 |
| P-5 | **Late recognition** | S-04 | Partial matches before completion | Median time between the first partial match and completion | SFT-04, SFT-05 |
| P-6 | **Machinery that does not fit the tick** | S-05 | Caps, expiry and a first-clause index | Per-event update time against the budget | SFT-06 |
| P-7 | **Selection and telling are judged together** | S-02, S-06 | Fixed telling when testing selection, and the reverse | The 2 by 2 design of SFT-12 | SFT-12 |
| P-8 | **Claims rest on the author's own world** | S-02, S-06, S-10 | Evidence from a world the authors did not build | Run the same test on a second world | TEL-15 |

### 2.3 Where the advice itself fails

| Advice | How it fails |
|---|---|
| "Select the unexpected" (SEL-02) | It was tested favourably within one pattern's matches (S-06) and unfavourably across the whole world (S-02). The two are different operationalisations, so neither refutes the other. Dessalles' unexpectedness is subjective by construction: complexity is the observer's, and his own site says a layman and a geneticist differ on the same fact |
| Narratology's accounts of tellability | They describe what makes tellers and critics call something tellable. Baroni's entry lists the open issues: evaluation devices cannot be pinned down and do not guarantee tellability, the notion may depend too much on genre, culture and period to be universal, and scholars disagree whether it is a property of the story or of the whole narrative. Prince's point stands: calling an event unusual does not make it so |
| News values (SEL-09) | The lists describe what editors chose, not what readers enjoyed. Harcup and O'Neill (2017) coded 711 lead stories from ten UK dailies, one sample week each in November 2014, and say the criteria are also governed by resources, time and unconscious influences. Content analysis cannot separate selection from treatment. Later tests of Galtung and Ruge reached conflicting conclusions. A news reader does not act on the world; a player does |
| Relevance theory (SEL-13) | The theory is about utterances. It declines a numerical measure on purpose: the authors call relevance "comparative rather than quantitative". Any formula "effects over effort" is a proposal of the lens, not of the theory |
| "Overgenerate and curate" (Ryan) | Ryan values the actual, the improbable and the unauthored, and is wary of any intervention that makes stories look well-formed (Lyu et al. report his view). The engine's director steers only through the unobserved ([DS-05](../design-seeds.md)), so the tension is real and is recorded in §8 |
| Dramatic situations as a sifting target | Searching for a named situation guarantees finding it and risks cookie-cutter results unless local detail differs (S-02) |

## 3. Sources

Source status as defined in §1. "Credit" says whether [the community credits](../../../docs/community-credits.md) already hold an entry (checked by name).

### 3.1 Read

| Work | Used for | Credit |
|---|---|---|
| Lessard, Friedrich, Paré-Chouinard, Kosseim, ["Narrative Gold Digging: Sifting and Narrating Stories from a Procedural Simulation"](https://www.pcgworkshop.com/archive/lessard2026narrative.pdf), FDG '26 (full text) | S-02, S-03, S-09; TEL-03, TEL-04, SFT-10, SFT-12, SFT-13 | to add |
| Kreminski, Dickinson, Mateas, ["Winnow: A Domain-Specific Language for Incremental Story Sifting"](https://ojs.aaai.org/index.php/AIIDE/article/view/18903), AIIDE 2021 (full text) | S-04, S-05; SFT-04 to SFT-06, SFT-09 | credited (with Felt) |
| Kreminski, Dickinson, Wardrip-Fruin, Mateas, ["Select the Unexpected: A Statistical Heuristic for Story Sifting"](https://mkremins.github.io/publications/StU_ICIDS2022.pdf), ICIDS 2022, LNCS 13762, pp. 292-308 (full text) | S-06; SFT-03; TEL-03 | to add |
| Kreminski, Wardrip-Fruin, Mateas, ["Toward Example-Driven Program Synthesis of Story Sifting Patterns"](https://ceur-ws.org/Vol-2862/paper18.pdf), INT at AIIDE 2020 (full text, skimmed) | SFT-08 | to add |
| Lyu, Millard, Gibbins, ["Stories from the Bottom Up: Emergent Narratives with Composable Story Sifting Patterns"](https://eprints.soton.ac.uk/502632/2/3723498.3723809.pdf), FDG '25 (full text) | SFT-06, SFT-07; S-08 | to add |
| Leong, Porteous, Thangarajah, ["Automated Sifting of Stories from Simulated Storyworlds"](https://www.ijcai.org/proceedings/2022/0686.pdf), IJCAI-22 (full text, skimmed) | SFT-08; S-08 | to add |
| Emily Short's recaps of Ryan's thesis: [chapters 1 to 3](https://emshort.blog/2019/05/21/curating-simulated-storyworlds-james-ryan/) and [chapter 6 onward](https://emshort.blog/2019/05/28/curating-simulated-storyworlds-james-ryan-ch-6f/) | S-01; SFT-01, SFT-11 | Short credited elsewhere; Ryan's thesis credited |
| Baroni, ["Tellability"](https://www-archiv.fdm.uni-hamburg.de/lhn/node/30.html), and Hühn, ["Event and Eventfulness"](https://www-archiv.fdm.uni-hamburg.de/lhn/node/39.html), *Living Handbook of Narratology* | §5.1; TEL-01, TEL-02, TEL-08 | to add |
| Grinblat and Bucklew, ["Subverting Historical Cause & Effect: Generation of Mythic Biographies in Caves of Qud"](https://pcgworkshop.com/archive/grinblat2017subverting.pdf), FDG '17 (full text) | GEN-06; S-10 | credited |
| Wilson and Sperber, "Relevance Theory", in Horn and Ward (eds.), *The Handbook of Pragmatics* (2004) ([chapter PDF](https://www.dan.sperber.fr/wp-content/uploads/2004_wilson_relevance-theory.pdf), first sections) | §5.4; TEL-14 | to add |
| Harcup and O'Neill, ["What is news? News values revisited (again)"](https://eprints.hud.ac.uk/id/eprint/27268/), *Journalism Studies* 18(12), 2017 (the open-access author text, which carries the 2016 online date) | §5.3; TEL-12, TEL-13 | to add |
| Dessalles' [publication page](https://perso.telecom-paristech.fr/jld/papiers/narrative.html) and [Simplicity Theory page on relevance](https://simplicitytheory.telecom-paris.fr/Relevance.html) | §5.1; TEL-03 (as author-reported claims) | to add |
| Riedl and Young, ["Narrative Planning: Balancing Plot and Character"](https://jair.org/index.php/jair/article/view/10669), *JAIR* 39, 2010 (abstract page); Nelson, Mateas, Roberts, Isbell, ["Declarative Optimization-Based Drama Management"](https://www.kmjn.org/publications/DODM_IEEECGA-abstract.html) (abstract page) | GEN-02, GEN-05 | to add |
| Wilmot and Keller, ["Modelling Suspense in Short Stories as Uncertainty Reduction over Neural Representation"](https://arxiv.org/abs/2004.14905), ACL 2020 (abstract) | TEL-09 | to add |
| Deo, Chung, McCoy, ["Shepherd: An Incremental Story Sifting-Based Drama Manager"](https://ojs.aaai.org/index.php/AIIDE/article/view/31887), AIIDE 2024 (abstract only) | SFT-05 | to add |
| Fabula contributors, [Narrative Quality](https://sifting.dev/docs/concepts/narrative-quality), a community sifting crate's documentation | Read for contrast: its six-signal quality function is presented with no validation. Not relied on | not credited |
| This repository: [kernel S0](../spec/kernel.md) §7.3, §9, §10, §11, §14; [foundation](../foundation.md) §5 to §8; [game events](../../../knowledge/game-events.md); [runtime requirements S1](../runtime-requirements.md); design seeds DS-01, 09, 10, 11, 24, 27, 29 | §7 and §11 | n/a |

### 3.2 Summary only, or memory

| Work | How I know it | Used for |
|---|---|---|
| Ryan, *Curating Simulated Storyworlds* (2018) | Short's recaps, Lessard et al., Winnow and StU papers. I did not read the thesis | SFT-01, SFT-11 |
| Kreminski, Dickinson, Wardrip-Fruin, "Felt: A Simple Story Sifter", ICIDS 2019 | Described in the Winnow and StU papers | §4.2 |
| Johnson-Bey and Mateas, ["Centrifuge"](https://eis.ucsc.edu/papers/Johnson-Bey_Centrifuge_PLIE2021.pdf), PLIE 2021 | Search summary and Lyu et al. | §4.2 |
| Samuel, Summerville, Ryan, England, "A Quantified Analysis of *Bad News* for Story Sifting Interfaces", ICIDS 2021 | StU paper's one-sentence account (certain console command sets are often run together). I could not find the paper | SFT-11 |
| Clothier and Millard on *Awash!* (ICIDS 2023), a sifter feeding a drama manager | Search abstract and Lyu et al. (qualitative analysis; narrative completeness increased) | SFT-05 |
| Gervás and Méndez 2024; Méndez and Gervás 2023 (sifting with a language model, and evolutionary sifting) | Lessard et al. only | S-07 |
| Labov and Waletzky 1967; Labov 1972, 1997 (reportability, evaluation, the most reportable event) | Baroni's entry and search summaries of Labov 1997. I could not open Labov's text | TEL-05, TEL-10, TEL-11 |
| Galtung and Ruge 1965, "The structure of foreign news" | Harcup and O'Neill's text and search summaries. Not opened | §5.3 |
| Mesoudi, Whiten, Dunbar, ["A bias for social information in human cultural transmission"](https://research-portal.st-andrews.ac.uk/en/publications/a-bias-for-social-information-in-human-cultural-transmission/), *Br. J. Psychol.* 97(3), 2006; Stubbersfield, Tehrani, Flynn 2015 | Search summaries | TEL-06 |
| Berger and Milkman, "What makes online content viral?", *J. Marketing Research*, 2012 | Search summary | TEL-13 |
| Brewer and Lichtenstein 1982 (structural-affect theory: suspense, surprise, curiosity) | Search summaries; the report was not opened | TEL-09 |
| Schank 1979, "Interestingness: controlling inferences" | StU's mention only | §5.1 |
| Barber and Kudenko, GADIN (AIIDE 2007; *IEEE TCIAIG* 2009) | Search abstracts | GEN-08 |
| Togelius, Yannakakis, Stanley, Browne, "Search-Based Procedural Content Generation", *IEEE TCIAIG* 3(3), 2011; Smith and Mateas, "Answer Set Programming for PCG", same issue; Martens, "Ceptre", AIIDE 2015; Dormans and Bakkes, *IEEE TCIAIG* 3(3), 2011; Kybartas and Bidarra, *IEEE TCIAIG* 9(3), 2017 | Search abstracts | §6 |
| Cugola and Margara, "Processing flows of information", *ACM Computing Surveys* 44(3), 2012; Forgy, "Rete", *Artificial Intelligence* 19, 1982 | Search abstracts | §4.2 (comparison) |
| Doran and Parberry 2011; Black and Wilensky 1979; Weyhrauch 1997; Ware and Young; Ware et al. 2012 | Dossier 4 (read, for Doran and Parberry) and the lenses | §6 |
| Adams, "Characterization and Emergent Narrative in Dwarf Fortress" (2019); the Paradox *Crusader Kings II* dev diary 6 | The lens (L5) only. The forum page would not load | SFT-02 (flagged) |

### 3.3 Lens claims checked

| Lens claim | Finding |
|---|---|
| L8: "Select the Unexpected" ranks matches "by improbability of the matched events under the simulation's own statistics"; Lessard et al. cite it as an AIIDE workshop paper | The paper is ICIDS 2022 (Springer LNCS 13762), as the map says. Its heuristic is not world improbability. It scores each match by the average rarity of its properties **among matches against the same pattern** (event types, tags, traits, dyadic relations, "same character" coincidences). Lessard et al. tested something else |
| L8: Lessard et al. had "24 readers rate six sifted stories" | Six categories, twelve stories (each written twice), 24 readers split over two questionnaires of six stories each. The heuristics: world-level improbability (a Markov model over chains) and 10 of Polti's situations |
| L8 and map: Dimulescu and Dessalles, pp. 1734-1739 | Dessalles' own publication page gives pp. 1734-1739. Lessard et al.'s reference list gives 2922-2927. I use the first |
| L8: Schmid's criteria | Hühn's entry lists two binary conditions (facticity, resultativity) and five graded criteria: relevance, unpredictability, effect, irreversibility, non-iterativity. Lessard et al. use the five graded ones |
| L11: relevance as "effects divided by effort", fitted as a ratio | The theory says relevance is **comparative rather than quantitative** and that only some aspects (processing time, number of implications) are measurable in absolute terms. A ratio is a proposal, not the theory's claim (TEL-14) |
| L11: Galtung and Ruge's three hypotheses | Confirmed in outline (additivity, complementarity, exclusion). Secondary sources add that the first eight factors are read as perception-based and the last four as culture-bound |
| L11: Harcup and O'Neill revised the list | Confirmed. The 2017 list has 15 values (exclusivity, bad news, conflict, surprise, audio-visuals, shareability, entertainment, drama, follow-up, the power elite, relevance, magnitude, celebrity, good news, the organisation's agenda), from 711 lead stories |
| L2: sifting patterns are "hand-written and few" | Hand-written, yes. "Few" is not the field's aim: the Winnow and StU papers both want large numbers of patterns and work on making them cheap to write |
| L8: Winnow patterns can fire on a partial match | Confirmed, with the semantics in §4.3. Winnow's evaluation covers use cases and a speed table. It has no reader study |
| L12: raw output rates below curated output from the same world | Stated as Ryan's position in the recaps. I saw no measurement |
| L3: a content analysis found emergent narrative rare in shipped games | Not rechecked; not used |

## 4. Sifting: how it works in research and practice

### 4.1 The idea and its history

Ryan first called it "story recognition" (with Mateas and Wardrip-Fruin, 2015) and then "story sifting" (thesis, 2018): find the storyful sequences in a vast chronicle of simulated events. His first sifter, Sheldon, held its patterns as chunks of Python code. Sifting sits in the **curationist** tradition of emergent narrative, where producing events is decoupled from arranging and presenting them. Because it only reads events, it can sit on top of an engine that was not built for stories ([Winnow paper](https://ojs.aaai.org/index.php/AIIDE/article/view/18903)). That property matters here: the game is not ours, and its own event feed is thin ([game events](../../../knowledge/game-events.md), [runtime requirements S1](../runtime-requirements.md)).

Related precursors, as the Winnow and StU papers list them: plan recognition for anticipating player actions, regular-expression "playspecs" over game states, analogy search over plot structures, and *The Sims 2*'s "story trees", which raised the odds of events that would advance a partly matched tree (details of that system are hard to find).

### 4.2 Pattern languages

| Language | Form | What it can say | Incremental? | Authoring | Evidence |
|---|---|---|---|---|---|
| Sheldon patterns (Ryan 2018) | Python code | Anything | No | Programmer | Found the arson-revenge story in *Talk of the Town* |
| Playspecs (Osborn et al. 2015) | Regular expressions over game-state sequences | Order; no variables | Not as published | Technical | Cited in the Winnow paper |
| **Felt** (2019) | Datalog queries: events, variables, inference rules, not-joins | Ordered or unordered event sets with shared variables and negation | No: matches finished sequences | Low-level; the paper that followed calls it "frustratingly low-level" | Used in several co-creative games |
| **Winnow** (2021) | Staged clauses with `unless-event ... between`; compiles to acceptors, or to Felt | Ordered stages with variables, attribute checks scoped to a stage, negation between two bound events | **Yes**, with partial matches | Readable at a glance by design | Use cases and a speed table, no reader study |
| Synthesifter (2020) | Inductive logic programming from example event sequences, refined on feedback | Patterns generated from examples | Not addressed | Example-driven | Prototype |
| Centrifuge (2021) | Node-based visual editor compiled to logic queries | Felt-like queries without code | No | Visual; the first paper found pattern reuse missing | Proof of concept |
| ARC SIFT (2022) | A drawn fortune arc matched by dynamic time warping against character-pair relationship curves | Shape of a relationship over time; no coding | No | Drawing | User study of how intuitive drawing is |
| Composable patterns (Lyu et al. 2025) | JSON conditions with a time limit, `unless` and `unless_forever`; a completed pattern is re-inserted as a new event | Stories built from smaller stories | **Yes** | JSON | Stability and cost tests in a toy alien-invasion world |

**Outside comparison (not a source of the engine's concepts, D-21).** Matching ordered patterns against a stream is an old problem. Surveys of complex event processing (Cugola and Margara) compare systems by architecture, data model, rule model and rule language, and the Rete algorithm (Forgy 1982) matches many patterns against many facts without rechecking everything on each change. The kernel's own incremental interest matching ([§10.5](../spec/kernel.md#105-changes-and-matching)) has the same shape for single changes, and [foundation §8](../foundation.md#8-comparisons-with-outside-work) already lists incremental rule matchers as a comparison. What the kernel lacks is the multi-event, variable-sharing part (§7.2).

### 4.3 Incremental matching and partial matches

Winnow gives the clearest account. Each pattern compiles to an **acceptor**. For a partial match holding bindings for its first N events, and a new event, the acceptor does one of three things.

| Verdict | When | Effect on the pool |
|---|---|---|
| **Dies** | The event matches an active `unless-event` between two bound events | The partial match is removed |
| **Forks and accepts** | The event matches clause N+1 under the current bindings | The parent stays unchanged, in case another event advances it differently; a child carries the new binding |
| **Passes** | Anything else | Nothing changes |

A match with every clause bound is complete and leaves the pool. An event that matches the first clause starts a new partial match.

What this gives, and what it costs:
- **Lead time.** A partial match can be narrated, offered or steered before the story ends. Winnow's own examples are a live commentary that calls a blunder a fatal error and later retells its own mistaken call, and an arson-revenge pattern whose second clause (a revenge scheme hatched) is enough to foreshadow.
- **Stage-scoped constraints.** An attribute test attaches to a stage. "The host values communalism" is checked when the host shows hospitality, not at the end. Retrospective Felt checks it at the end. The two can disagree if the attribute changes (Winnow paper, §Retrospective Sifting).
- **No authoring of partial variants.** The stage structure derives them. Hand-writing partial variants of every pattern was the alternative, and costs authoring effort per pattern.
- **Pool growth.** Keeping the parent when a child forks means one early event can seed many branches. The paper's table (S-05) shows cost rising with pool size. Lyu et al. add three controls: skip a new partial match that duplicates one in the pool, drop a partial match after a time limit (20,000 simulation units in their world), and an `unless_forever` tombstone that stops the same pattern starting again for the same characters (a "lucky kill" can only be the first attack).
- **Narrative use of the early stages.** Awash (via Lyu et al.) passes unfinished matches to a drama manager that nudges the simulation toward finishing them, and reports higher narrative completeness without hurting emergent aesthetics (qualitative). Shepherd (AIIDE 2024) steers autonomous characters the same way; I saw only its abstract.

### 4.4 Who curates

| Curator | Examples | Good at | Bad at |
|---|---|---|---|
| **A human at run time** | *Bad News*: a human "wizard" sifted a *Talk of the Town* town live during performances (Ryan et al., 2016, via Short) | Judging what matters to this audience now; framing | Volume; cost; cannot ship |
| **The player, afterwards** | Dwarf Fortress retellings; Legends Viewer; Kreminski et al.'s 2019 study of retellings of *Civilization VI*, *Stellaris* and *Prom Week* | Meaning; filling gaps (apophenia) | Needs world knowledge (S-09); not available to steer |
| **A human who writes patterns, a machine that matches** | Sheldon, Felt, Winnow, Centrifuge, Synthesifter | Encodes a designer's taste and genre knowledge; explainable | Authoring burden; patterns find only what was imagined |
| **A machine ranking matches** | StU; Chroniqueur's improbability; Arc Sift; language-model sifting | Cheap once built; scales | The evidence is a null and a very small positive (S-02, S-06). Quality of the ranking depends on the audience model |
| **A machine that steers while it sifts** | Awash; Shepherd | Turns partial matches into completed stories | Costs some of the "actual, unauthored" appeal Ryan values |

Kreminski et al. propose **two layers**: patterns capture event sequences that have narrative structure without regard to tellability, and a heuristic judges tellability among their matches. They also note that more generic patterns match more, which gives the heuristic more material. That division fits the engine: authors and packs supply patterns as data (layer 4), and the engine supplies the judging (layer 3).

### 4.5 Principles: sifting

Columns: grade; source and a concrete instance; scale and layers; how to operationalise (**produce**, **check**, or **neither**).

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| SFT-01 | Selection from an overgenerated pool is a separate stage from generation. The generator need not know which stories it makes | [analysis] with practice precedent. Partly **contested**: Short holds that curation alone does not decide quality | Ryan 2018; Winnow paper (sifting can add narrative intelligence without touching the event source); *Bad News*. The only test against random selection is S-06 | All · 3, 1 | **Produce:** sowing reads events and never edits the simulation to make them storyful. **Check:** the swap test of L2: run two presenters over one event log. A reader test of sifted against random chains from one log is the missing evidence (R-25) |
| SFT-02 | The record is mostly banal. Offers should be a small share of event volume, with a stated target and cap | [practice] for the principle; the numbers are mine to set. Chroniqueur: 228,000 events gave 27,000 chains. Adams's claim that named detail raises story yield is **unchecked** (lens only) | Chroniqueur (S-02) | All · 3, E | **Check:** offers per hour and offers per thousand events, logged. **Produce:** a cap in the dial (R-9). The target value is an open question (§10) |
| SFT-03 | Two layers: patterns find structure, a separate judgement decides tellability among matches. Patterns are written for structure, not for tellability | [analysis] with weak evidence (S-06) | Kreminski et al. 2022 §6.1: generic patterns give the heuristic more matches to rank | Gig, arc · 3, 4 | **Produce:** pattern packs are data; tellability scoring is engine code over their matches (R-3, R-10). **Check:** score distribution within each pattern's matches |
| SFT-04 | Match incrementally, with partial matches that can be read, narrated or steered before completion | [analysis]; prototype evidence only | Winnow acceptors (die, fork and accept, pass); Awash and Shepherd steer partial matches | Encounter to arc · 3, 2 | **Produce:** a staged pattern form with per-stage constraints (R-2). **Check:** median lead time (sim-time between the first partial match and completion), per pattern |
| SFT-05 | The value of a partial match is the window it opens. Use it to prepare (foreshadow, hold resources, choose V's involvement), not to force the ending | [hypothesis] on window lengths; [analysis] on use | Awash: narrative completeness up, qualitative. Ryan's caution that intervention costs the "actual" appeal. [DS-05](../design-seeds.md): the director steers only through the unobserved | Gig, arc · 3, 2 | **Produce:** promote a partial match to a seed at a stage threshold (R-6). **Neither** forcing nor steering is decided here: see dossier 7 and §8 |
| SFT-06 | The pool of partial matches must be bounded: per-pattern caps, expiry, duplicate suppression, and tombstones against repeats | [analysis], measured only in a toy | Winnow Table 1; Lyu et al. (time limit, `unless_forever`, duplicate skip) | All · 3, P7 | **Produce:** the caps in R-5. **Check:** per-event pool update time against the tick budget ([kernel §10.7](../spec/kernel.md#107-work-hard-limits-and-worklists)) |
| SFT-07 | A completed pattern is itself an event that other patterns can match, so large stories are built from small ones | [analysis]; stability tests only | Lyu et al.: "revenge" built from "almost kill", "escape", "defeat" | Gig, arc · 3 | **Produce:** the completion is minted as a `meta:` event whose causes are its constituents (R-8). **Check:** no loop back into S1 policies (§8) |
| SFT-08 | Authoring cost limits how many patterns exist. Make writing one cheap: a readable notation, learning from example sequences, a visual or arc-sketch front end | [analysis] | Winnow; Synthesifter; Centrifuge; ARC SIFT; the Winnow paper (hand-written partial variants were the alternative) | All · 4, T | **Produce:** patterns as pack data (DS-38); tools in the Studio later (P6). **Check:** time to write a working pattern, and edits needed after the first run |
| SFT-09 | Constraints attach to the stage where they must hold, and negation is scoped between two bound events | [analysis] | Winnow: `?host.value: communalism` at the hospitality stage; `unless-event between ?e1 ?e3` | Encounter to arc · 3 | **Produce:** the pattern form has stage-scoped `where` and `unless between` (R-2). The kernel's time-varying slots and `at` support the check |
| SFT-10 | Sifted chains are appreciated by people who know the world and the people in the chain. Surface chains whose entities V has met, or that touch V's record | [empirical], weak and one world; [analysis] | Lessard et al. §7; Sych 2020 via Lessard et al. Dwarf Fortress retellings | Encounter to arc · 3, E | **Produce:** a familiarity feature from V's observed record (TEL-07). **Check:** score the same chain for a V who has met its people and a V who has not |
| SFT-11 | Human curation and player retelling are evidence sources, not just alternatives to the machine | [analysis] | Ryan's wizard; Kreminski et al. 2019 on retellings; the *Bad News* console traces (Samuel et al., unread) | All · E, P9 | **Neither** for the engine. **Check:** record which offers V accepts, ignores or later mentions; blind-rate samples (R-25) |
| SFT-12 | Selection and telling are separate causes of quality. Test one with the other held fixed | [empirical], one study | Lessard et al.: the same events ranked 3rd and last under two narrativisations; some chains shone under either writer (a "story effect"), some failed under both | Encounter to arc · 3, X, E | **Check:** the 2 by 2 design: two selectors by two presenters, rated blind. Staging belongs to P8 |
| SFT-13 | A named situation will always be found, and one over-prevalent event kind will dominate. Diversify across patterns and kinds, and let local detail do the freshening | [empirical], weak | Lessard et al.: affairs flooded the output; the love-triangle warning | Gig, arc · 3, E | **Produce:** per-pattern and per-kind quotas in selection (R-10). **Check:** share of offers by pattern and kind |
| SFT-14 | A sifter can only find what the record holds. The record needs people with names, intents, outcomes and ties. The game's own event feed is thin, so the richness has to come from simulation | [analysis] | Ryan's *Talk of the Town* admission (S-01). [Game events](../../../knowledge/game-events.md): a minimal feed of about a dozen kinds, mostly about V | All · 1, 3 | **Check:** for each pattern, list the event kinds and fields it reads, and which layer produces them (R-1) |

## 5. Tellability: what makes a chain worth telling

### 5.1 The narratological accounts

Baroni's entry treats tellability, "reportability" and "narratibility" as near-synonyms. The idea began in the study of conversational storytelling and was extended to all narrative. Hühn separates a **type I event** (any represented change of state, identifiable fairly objectively) from a **type II event** (a change of state credited, by an interpretive and context-dependent decision, with relevance, unexpectedness or unusualness). A type II event supplies tellability.

| Account | Claim, paraphrased | Reading for the engine |
|---|---|---|
| **Labov and Waletzky** | A narrative has two parts: what happened, and why it is worth telling. "Evaluation" devices signal the point | A told chain needs a stated point (TEL-11). Evaluation devices are hard to locate outside speech (Baroni) |
| **Labov (1997)**, via search summaries | A narrative centres on its *most reportable event*, the rarest and most consequential. The more reportable the event, the less credible it is, so the teller must supply a causal account | The more extraordinary the offer, the more its causes must show (TEL-10, DS-24) |
| **Bruner** | A tale concerns a breach of an implicit canonical script | Breach needs a script the audience holds. NPC frames hold expectations ([kernel §10.2](../spec/kernel.md#102-frames)); V's are only believed (TEL-03) |
| **Sacks** | Tellability links to "local news": new or unexpected to this audience, with a "total currency" such as gossip value | Newness is relative to what V has been told or seen |
| **Polanyi** | The point is culturally salient material that members of the culture accept as important and true, and it is negotiated during telling | The setting's own values (street cred, loyalty, debt) set what counts as a point |
| **Marie-Laure Ryan** | Events are more tellable when they project more forking paths in the fabula, including virtual outcomes | Stakes as live alternatives (TEL-05). Hühn criticises equating tellability with structural complexity |
| **Sternberg** | Suspense, curiosity and surprise are the three universal narrative interests, arising from the interplay of story time and telling time | Gaps about the future, the past, and the unfelt gap that closes (TEL-09) |
| **Norrick** | Tellability is two-sided: events below a threshold of significance are not told, and some are too intimate or frightening to tell | A ceiling as well as a floor. Tone and content controls ([DS-30](../design-seeds.md)) act as the ceiling |
| **Schmid / Hühn** | Eventfulness: two binary conditions (facticity, resultativity) and five graded ones (relevance, unpredictability, effect, irreversibility, non-iterativity), all relative to context | The best-developed checklist, and the one Chroniqueur tried (S-03) |
| **Dessalles** (Simplicity Theory) | A situation is interesting when it is simpler to describe than to generate: unexpectedness is the gap between expected and observed complexity. Emotional intensity is controlled by the same drop. He reports that narratives fill 25 to 40 per cent of conversation time | Unexpectedness is the observer's. Author-reported; the experimental details were not available to me |

Baroni's open issues set the tone for the rest of this section: the notion may depend too heavily on genre, culture and period to be universal; evaluation devices cannot be pinned down; and the line between "worth telling" and "accessible to tell" needs clarifying.

### 5.2 What empirical work there is

There is little, and none of it is about interactive offers.

| Finding | Source | Status | What it supports |
|---|---|---|---|
| In transmission chains, information about intense social interactions was recalled with more accuracy and in greater quantity than non-social information. A control for narrative coherence did not remove it. A later partial replication found the bias was for social information in general, not specifically gossip | Mesoudi, Whiten, Dunbar 2006; Stubbersfield, Tehrani, Flynn 2015 extended it to urban legends | [empirical], summaries only | People at the centre (TEL-06) |
| The control story won reader preference: a confession, with an open question about what the listener will do | Lessard et al. 2026 | [empirical], one story, 24 readers | A live gap beats an improbable chain (TEL-09). Not proof of the gap theory |
| Forward-looking uncertainty reduction predicted human suspense judgements better than backward-looking surprise, and reached near-human accuracy on short stories | Wilmot and Keller 2020 | [empirical], abstract | Score a partial match by how much its completion would resolve (TEL-09) |
| Online sharing tracks physiological arousal: high-arousal emotions (awe, anger, anxiety) spread more than low-arousal ones (sadness); positive content was more viral than negative overall | Berger and Milkman 2012: nearly 7,000 *New York Times* articles, plus lab experiments | [empirical], search summary | Valence alone is a poor feature; arousal matters (TEL-13). About articles, not play |
| Suspense, surprise and curiosity are produced by the order in which information is given | Brewer and Lichtenstein 1982 | [analysis], summaries | A presentation lever (dossier 7), not a selection feature |

### 5.3 News values (comparison, SEL-09)

News selection is the nearest working practice to the engine's problem: many events, a few slots, a reader who may stop at any point. Galtung and Ruge (1965) proposed twelve factors from four Norwegian papers' coverage of the Congo, Cuba and Cyprus crises: frequency, threshold, unambiguity, meaningfulness, consonance, unexpectedness, continuity, composition, reference to elite nations, to elite people, to persons, and negativity. They added three hypotheses. More factors raise the chance of selection (additivity). Factors can offset each other (complementarity). An event with none or few is not selected (exclusion). Harcup and O'Neill revised the list in 2001 and again in 2017 (15 values, §3.3).

| Value | Transfer to the engine | Caution |
|---|---|---|
| Persons; celebrity; the power elite | Chains about people the player knows, or who hold standing (TEL-06, TEL-07) | Elite-centred selection would skew the city towards the already powerful; street-level people carry the setting |
| Bad news; conflict; drama; negativity | Harm, loss, rescue and chase carry stakes (TEL-05) | A negativity bias in a dark setting exhausts the tone. Good news and entertainment are on the 2017 list too (TEL-13) |
| Surprise; unexpectedness | TEL-03 | As above |
| Meaningfulness; relevance | Closeness to V's record and places (TEL-07) | Here "relevance" is a news value. The engine's own notion is separate |
| Follow-up; continuity | A thread already in play has inertia and needs less set-up | Competes with variety and the tension budget ([DS-27](../design-seeds.md)) |
| Composition | The offers made over a stretch of play should be chosen as a mix, not by independent scores (TEL-12) | Pacing across a session is not something news formalised |
| Frequency; threshold; magnitude | A process slower than play is noticed only through a punctuating event (the news peg); small events need a size threshold | Untested in games |
| Shareability | "Would V tell someone this?" as a stand-in for retellability (SFT-11) | A web-era value; measure by retelling instead of predicting it |
| Exclusivity; audio-visuals; the organisation's agenda | Do not transfer. The nearest analogue to an agenda is the author's stated intent, which is already a fitting input | |

### 5.4 Relevance theory and common ground (comparison, SEL-13)

This subsection is a cross-check only. The engine's own relevance, computed as increments over context frames, is first-party ([foundation §5](../foundation.md#5-context-and-relevance)). Sperber and Wilson's theory is about how hearers pick among utterances, and it makes three points worth testing the engine's selection against.

- **Effect against effort.** An input is relevant when processing it yields positive cognitive effects, and less relevant the more effort it takes. For a callback this reads as: a reference to something V barely remembers has large possible effect and large retrieval effort. A cue lowers the effort. The lens proposed that cue size should grow with elapsed time (TEL-07, R-15).
- **Comparative, not quantitative.** The authors prefer comparisons ("this is more relevant than that") because only some aspects of effect and effort are measurable in absolute terms. So the engine should rank candidate offers and callbacks, and should not fit a formula and trust its numbers (TEL-14).
- **Common ground and the maxims** (Clark; Grice; both from memory here). A teller says what the hearer lacks and does not say what both already know, and a deliberate flout carries a message. For staging, that means a lead that adds news, not a recap of what V saw ([TEL-11](#56-principles-tellability)).

### 5.5 Features a procedure could score

Each feature says what it means, where its parts come from in the kernel record, and what is unproven. **Gate** means a chain without it is not offered. **Score** means it enters a ranking. All scores are comparative inputs to a ranking (TEL-14), not probabilities.

| # | Feature | Role | Meaning | Parts from the record | Unproven |
|---|---|---|---|---|---|
| F-1 | **Reportable change** | Gate | A completed change of state with an effect on someone (Hühn type II; Schmid facticity and resultativity) | Event with non-empty `effects`, canon or committed ([§9.2](../spec/kernel.md#92-events)). An *attempt* that failed has no field today (§7.4, G-3) | Whether "completed" should include failed attempts that changed someone's mind |
| F-2 | **Deviation from expectation** | Score | (a) the match's properties are rare among matches of its own pattern (StU); (b) an actor acts against its own frame's interests; (c) the outcome contradicts what V believes or was told | (a) kind tags, participant roles, traits, edges; (b) conflict table and `protects` or `wants` interests ([§10.8](../spec/kernel.md#108-effects-and-cross-pressure)); (c) the director's beliefs about V and V's observed pins | (a) 84 % on 45 pairs from three raters; (b) and (c) have no test. World-level improbability had a null result (S-02) |
| F-3 | **Stakes** | Score | What is at risk, for whom, and how much it matters to them | Effect kinds on targets; the relevance strength `r` of the interests they touch ([§10.5](../spec/kernel.md#105-changes-and-matching)); `Dilemma.severity` | The scale problem of S-03 (incomparable variables) is avoided only by using effect kinds and pull, which are on one scale. No validation |
| F-4 | **A human at the centre** | Gate and score | Roles are filled by named persons or groups; recurrence in the record | Participant `who` with `core:person` or `core:group` and a `name`; count of events involving them | Mesoudi et al. support the memory advantage, not the offer value |
| F-5 | **Familiarity and personal link** | Score | The chain touches people and places V has met, and V's own acts | V-observed pins and events V witnessed or took part in; recency of the last such event | Lessard et al. suggest it. Cue cost grows with elapsed time (comparative) |
| F-6 | **Irreversibility and novelty** | Score | The change cannot easily be undone; the chain differs from ones already offered | Effect kinds in an irreversible set (`kill`, `expose`, and others S1 names); ended `core:member-of` edges with high `exit-cost`; a signature distance to earlier offers | Chroniqueur could not make a general version (S-03). The kind set is a design choice |
| F-7 | **A live gap** | Score | Something V knows only part of: a belief that differs from the pinned truth, a concealed membership, a partial match awaiting its outcome | Beliefs against pins ([§11](../spec/kernel.md#11-beliefs-and-perspectives)); `secret` or `deniable` edges; the pool | One story won in one study. Needs belief changes as Changes (G-1) |
| F-8 | **Causal coherence and focus** | Gate and score | Consecutive events are linked by a cause or by shared participants; there is a protagonist; the chain is short | `event.causes`, participants; length and number of distinct protagonists | The Chroniqueur "meteor" chain shows the failure; the thresholds are untested |
| F-9 | **Closure** | Score | Whether the chain is resolved (a recap or rumour) or open (an offer) | Frame status (satisfied, abandoned, blocked); the pattern's stage | Frame status is not a Change today (G-2) |
| F-10 | **Valence and arousal mix** | Score across offers | A spread of positive and negative, high and low arousal | Effect kinds; kind tags | Berger and Milkman is about articles |
| F-11 | **Timeliness and continuity** | Score | The chain is current; a thread already in play gets a small bonus | Time since the last event; the seed lifecycle record | Interacts with the tension budget |
| F-12 | **Showable cause** | Gate | At least one path of cited causes can be shown for the surprising step | `event.causes`; provenance ([§13](../spec/kernel.md#13-provenance-and-explanation)); a flag for write-once rationalisations | Labov's trade-off is known only from summaries |

### 5.6 Principles: tellability

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| TEL-01 | Tellability belongs to an event, an audience and a context together. Score a chain for a particular audience, never in the abstract | [analysis]; [empirical], weak | Baroni (contextual and textual factors; Polanyi, Sacks); Lessard et al. §7 | All · 3, E | **Produce:** the scorer takes the audience model (V's observed record and the director's beliefs) as input. **Check:** score one chain for two Vs; the scores must be able to differ |
| TEL-02 | A chain needs at least one reportable change: a completed change of state that matters to someone | [analysis] | Hühn (type II); Schmid (facticity, resultativity) | All · 3 | **Produce:** feature F-1 as a gate. **Check:** count offers with no effect on any person |
| TEL-03 | Expectation is the audience's and the pattern's, not the world's. Measure deviation against the audience's likely expectation and against the pattern's own matches, not against base rates over all events | [analysis]; [empirical] weak and **contested** between two operationalisations | StU (38 of 45 pairs, three raters, within-pattern rarity) against Chroniqueur (no relation, world-level improbability, 24 readers). Dessalles: complexity is the observer's. Lessard et al. §6.1.2: the most appreciated story was not remarkably improbable in its own world, while the meteor chain puzzled readers | Encounter to arc · 3 | **Produce:** F-2 (a), (b), (c). **Check:** rank correlation of F-2 with blind ratings, per variant (R-25) |
| TEL-04 | Rarity grows with chain length while focus falls. Cap the length and require a protagonist | [empirical], weak | Lessard et al. §6.1.1: the longest chains were the rarest and the least coherent | Gig, arc · 3 | **Produce:** F-8 as a gate and cap. **Check:** plot rating against length, look for a peak |
| TEL-05 | Stakes: a chain is more worth telling when something a person cares about is at risk, and the offer says what | [analysis]; [practice] | Labov on the most reportable event (summary); M.-L. Ryan on forking paths; G&R negativity; H&O bad news, conflict, drama, magnitude. Instance: the vendor whose gang orders harm to kin ([foundation §5.2](../foundation.md#52-groups-and-membership)) | Encounter to arc · 3, 2 | **Produce:** F-3 from effect kinds and the pull of the interests they touch; every offer carries a one-line stake. **Check:** the stake line names who loses what (dossier 4, QST-05) |
| TEL-06 | A person at the centre: events about people the audience can name are remembered better and told more than the same content about things | [empirical], summaries | Mesoudi et al. 2006 and the 2015 extension; G&R personalisation; Lessard et al. (the control story) | Encounter to arc · 3, 1 | **Produce:** F-4. **Check:** share of offers whose protagonist has a name and an earlier appearance in V's record |
| TEL-07 | Closeness to V's own history and places raises worth. A callback at a distance needs a cue, and the cue grows with elapsed time | [analysis] | Schmid (relevance); G&R (meaningfulness); H&O (relevance); relevance theory (effect against effort), a comparison only. [DS-10](../design-seeds.md) | Gig, arc · 3, 2 | **Produce:** F-5. **Check:** the same callback after 20 minutes and after 20 hours, with and without a cue |
| TEL-08 | Lasting, hard-to-reverse and non-repeated changes are more eventful than reversible or repeated ones | [analysis] | Schmid via Hühn and Lessard et al. §4.1.3 to 4.1.5; Chroniqueur could not make them general | Gig, arc · 3, 1 | **Produce:** F-6 with a named irreversible-effect set and an exit-cost threshold; novelty against earlier offers. **Check:** whether F-6 adds anything beyond F-2 on blind ratings |
| TEL-09 | A live gap: something the audience knows part of and wants closed (a secret, a divergence between belief and truth, an outcome not yet decided). Prefer partial matches by how much their completion would resolve | [analysis]; [empirical], weak | Sternberg; Loewenstein (via lenses); Wilmot and Keller (forward uncertainty reduction beat backward surprise); Lessard et al.'s control story | Encounter to arc · 3, 1 | **Produce:** F-7, and a forward score for partial matches. **Check:** follow-up rate on teasers with and without prior context |
| TEL-10 | The more extraordinary the offer, the more its causes must be visible. A surprising step needs a showable cause | [analysis]; Labov known from summaries | Labov 1997 (reportability and credibility); [DS-24](../design-seeds.md); Caves of Qud's rationalisations as the cheap route (GEN-06) | Encounter to arc · 3, T | **Produce:** F-12 as a gate. **Check:** the offer's trace shows one cause path ([kernel §13](../spec/kernel.md#13-provenance-and-explanation)) |
| TEL-11 | Selection is not telling. The staging supplies the point and leads with it, so a player who stops after the opening can say what it was about | [analysis]; [practice] | Labov's evaluation; Baroni on discourse; the news inverted pyramid (L11); Lessard et al.'s narrativisation effect | Encounter to arc · X, 3 | **Produce:** each offer ships a lead line and a stake line to P8. **Check:** disengage-early test of L11 |
| TEL-12 | Choose the set of offers as a mix, not by independent scores. Add continuity for threads in play and a peg for slow processes | [analysis] | G&R composition, continuity, frequency; H&O follow-up. Lessard et al.'s flooding by one event kind | All · 3 | **Produce:** selection with diversity constraints (pattern, kind, valence, place). **Check:** at equal mean score, compare top-K with the constrained mix on rated variety and relevance |
| TEL-13 | Do not let valence stand in for impact. Arousal matters in both directions, and good news and light entertainment are items on the news list too | [empirical], one summary; [analysis] | Berger and Milkman; H&O (good news, entertainment) | All · 3, X | **Produce:** F-10 as a spread target under the tone controls. **Check:** a valence and arousal histogram of offers |
| TEL-14 | Rank, do not fit. Relevance, stakes and expectation are comparative judgements; use ordering, thresholds and pairwise tests, and be wary of a single fitted formula | [analysis] | Wilson and Sperber (comparative rather than quantitative); S-03 (incomparable scales) | All · 3, E | **Produce:** scorers return ranks or bands with their feature values. **Check:** pairwise judgements instead of absolute scales in P9 |
| TEL-15 | No tellability feature set is validated. Ship it as a set of hypotheses with logging, and expect the first version to be partly wrong | [hypothesis] | S-02, S-06, S-08 | All · E, 3, T | **Produce:** every offer logs its features, pattern and outcome (accepted, ignored, later mentioned). **Check:** feature-by-feature ablation against blind ratings from a second world (R-25) |

### 5.7 What is honestly unproven

- That any feature above predicts enjoyment in play. Two tests exist for improbability; they disagree; both are tiny.
- That the features add up. Additivity and complementarity were hypotheses in Galtung and Ruge, and later tests conflict.
- That sifting raises enjoyment compared with the same events sown at random and staged the same way. The study of that has not been done.
- That the familiarity effect (Lessard et al.) holds for in-game offers, and how fast it decays.
- Whether the engine can compute "expected by V" at all. D-09 allows only a belief about V, held with confidence. A deviation score for V must stay humble and robust across the Vs the engine cannot yet tell apart.

## 6. Generation methods compared

P5 has to answer several different questions. The methods in the literature each answer one of them well. The comparison is by question, because a method that is poor as a story generator can still be the right validator or caster.

| # | Question P5 must answer | Method that fits best | Where it is decided |
|---|---|---|---|
| Q1 | What in the record is story-shaped? | Sifting | §4 |
| Q2 | What is offered, in what order and mix? | Scoring and composition; search or policy for ordering | §5, dossier 7 |
| Q3 | What shape does an engaged thread take as it grows? | Shape templates (grammar-like) | dossier 4 |
| Q4 | Which people, places and times fit? | Constraint queries (casting) | dossier 3, kernel §8 |
| Q5 | Is this chain causally sound, and what bridges a gap? | Planning, on short chains | here |
| Q6 | What cause makes a surprising step believable? | Generate, then justify | here |

### 6.1 The methods

| Method | Core idea | Good at | Bad at | Evidence and failures | Fit with the kernel | Role in P5 |
|---|---|---|---|---|---|---|
| **Sifting, then staging** | Simulate; match patterns over events; choose; present | Causes that really exist (DS-24); works on a simulation we do not own; explainable by pattern and bindings; incremental lead time | Quality is capped by the record (S-01); needs patterns written; the ranking is unproven; produces nothing where nothing happens | §2, §4. Ryan's *Bad News*; *Talk of the Town*; Chroniqueur | Native: events, edges, beliefs, frames (§7) | **Default for sowing** |
| **Search-based** (drama management; search-based content generation) | Write an evaluation function; search orderings or candidate content (Weyhrauch; Nelson and Mateas; Togelius et al.'s survey frames search-based generation by content type, representation and fitness) | Optimising a stated author aesthetic; measuring authorial leverage (Chen et al. 2009, via the lens) | Online search "does not perform very well in general, especially on larger and more complex stories" (Nelson et al.); evaluation functions are hand-written; tested on small closed worlds; none found deployed in an open world (lens L8). For stories the fitness is tellability, which is unsolved | Nelson et al. 2006, abstract read. The authors report promising early results for computing a policy offline with reinforcement learning | Queries are an exact best-first search over nodes ([§8.3](../spec/kernel.md#83-traversal)); ordering is the director's | **Ordering and pacing only** (dossier 7), policies precomputed, not online search |
| **Grammar-based** | Rewrite rules for story parts (story grammars), for quests (a motive grammar), for missions and spaces (graph grammars), for text (replacement grammars) | Cheap, controllable shape; designers can author it; the mission-then-space split is a useful two-step | Story grammars were criticised as inadequate grammars, recognisers and predictors of recall (Black and Wilensky, contested by Frisch and Perlis); the quest grammar's own worked example is an errand chain (dossier 4, F-04); variation lands in the slot, not the situation | Doran and Parberry (read in dossier 4); Dormans and Bakkes (abstract); Black and Wilensky (listing) | Shape templates as seed data ([dossier 4, R-28](d04-quest-structure.md#10-requirements-for-the-seed-language-p4)) | **Recognisers, checklists and escalation shapes**, never the source of what happens |
| **Constraint-based** (answer set programming, linear logic, constraint solving) | Describe the design space declaratively; a solver finds members. Smith and Mateas recast an evolutionary generator as a logic program. Martens's Ceptre models rules as resource-consuming transitions, so play is proof search and intermediate states can be inspected | Validity by construction; an explicit, inspectable design space; quick prototypes; "does any valid completion exist?" | I found no open-world deployment in the abstracts seen, and scaling is not addressed there. A solver says what is possible, not what is worth telling | Smith and Mateas 2011, Martens 2015: abstracts only | The kernel already is a constraint system: contributions, arbitration, bounded queries, casting as a level-set query ([DS-49](../design-seeds.md)) | **Casting and fitting inside the kernel.** No external solver in the first implementation ([D-19](../decisions.md)) |
| **Planning-based** | A story is a plan; causal links join steps; IPOCL adds an explaining goal for each character act; Glaive adds conflict; state constraints from the author act as landmarks (Porteous et al.) | Causal soundness; audiences understand characters' intentions better (Riedl and Young's evaluation); knowing which remaining steps a perturbation breaks; bridging beats | A full action model must be written; search cost grows with the world; evaluations are short and synthetic; Doran and Parberry judge general planning impractical for quests; plot-only planning gives puppet characters; a rich simulation can still tell dull stories (Tale-Spin tradition) | Riedl and Young 2010: abstract read. Others via the lens (L8 fields 6 and 7) | A goal frame is already a small action: `Goal { effects }` ([§10.2](../spec/kernel.md#102-frames)). NPC planning is an S1 policy. V is never planned for (D-09) | **Validator and bridge-builder over short, local chains** (the fitting problem of R1). Not a global generator |
| **Generate, then justify** | Choose that an event happens, then build its cause from the entities' state (Caves of Qud) | Cheap causal depth; no forward simulation; coherent mythology; matches the kernel's own compromise C-01 | Contradicts later observation unless write-once; readers supply much of the meaning (apophenia); may need to alter state to supply a cause | Grinblat and Bucklew (read): events are chosen at random and their gospels "often profess causes". A tertiary system with five rulers per world, designed to be evocative | [Ledger C-01](../foundation.md#9-the-reference-model-and-the-compromise-ledger); [DS-29](../design-seeds.md); pins make it write-once | **Fills missing causes under a write-once rule** (R-19) |
| **Dilemma-based** | Plan action sequences that lead a character, possibly the user, into a dilemma, then adapt to the user's choices (GADIN) | A target that matters (a hard choice); adapts to the player's past choices | Evaluated by a Turing-style test (127 participants could not tell which story was the machine's, per a search summary), which measures human-likeness, not interest | Barber and Kudenko 2007, 2009: abstracts | The kernel's `Dilemma` emission ([§10.8](../spec/kernel.md#108-effects-and-cross-pressure)) detects them for free from frames. The director may prefer castings that create them ([DS-11](../design-seeds.md)) | **A source of candidates** (MAP-04, R-16) |
| **Language models** | A model proposes events, sifts or narrates | Fluent surface; flexible phrasing | As sifters, only a few events at a time (S-07). As narrators, they can rescue or sink the same events (S-02). Suspense needs a planning scaffold (Xie and Riedl, via the lens) | Lessard et al.; lens L8 | The plan keeps generated text at the surface | **Presentation only** (dossier 22) |

### 6.2 Principles: generation methods

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| GEN-01 | Pick the method per question. No one method serves selection, shape, casting, soundness and causes | [analysis] | The comparison above | All · 3 | **Check:** every decision in P5's design names the question (Q1 to Q6) it answers and its method |
| GEN-02 | Do not search online over stories. Compute orderings or policies offline and keep run-time search inside a fixed allowance | [empirical], weak: one replication, one story | Nelson et al. 2006 (online search poor, more so on larger stories); the kernel's hard limits ([§10.7](../spec/kernel.md#107-work-hard-limits-and-worklists)) | All · 3 | **Produce:** any ordering search is a precomputed policy or bounded by the allowance. **Check:** run time against story size |
| GEN-03 | Use grammars to recognise and to shape, not to originate | [analysis], **contested** | Black and Wilensky against Frisch and Perlis; Doran and Parberry's errand chain | Gig, arc · 3, 4 | **Produce:** shape templates as data. **Check:** the sorting test of dossier 4 (P-1): outputs that differ only in names are not variety |
| GEN-04 | Casting is constraint satisfaction over the kernel's own queries. Do not add a solver without a case the queries cannot meet | [analysis]; the abstracts show strength in closed design spaces | Smith and Mateas; Martens; [DS-49](../design-seeds.md); kernel §8 | Gig · 3, 2 | **Produce:** constraint queries and contributions. **Check:** casting failures that a solver would have found |
| GEN-05 | Use planning for short chains: to check causal soundness, to say why an act was taken, and to find bridging beats from the present state to what an authored seed assumes | [empirical], small and synthetic; [analysis] | Riedl and Young (intentions better understood); Porteous et al. (landmarks split a problem); Doran and Parberry (general planning impractical for quests) | Encounter, gig · 3 | **Produce:** a depth-bounded planner over goal frames' effects, never over V. **Check:** the planner agrees with an S1 trace on "why did X do Y" |
| GEN-06 | Generate-then-justify is allowed only as write-once: a constructed cause must agree with everything observed or committed, and is pinned once observed. It must be marked as constructed in the trace | [shipped] | Caves of Qud's gospels (cause chosen after the event, from the figure's state; state altered if no cause fits); [ledger C-01](../foundation.md#9-the-reference-model-and-the-compromise-ledger); [DS-03](../design-seeds.md) | Encounter to arc · 3, 1 | **Produce:** the justifier queries constraints, then commits pins. **Check:** contradiction rate of later observations against earlier justifications; the offer's trace lists each cause as `found` or `constructed` |
| GEN-07 | Sifting needs a rich event source. Its ceiling is the simulation's detail, so S1 must produce events with people, intents and outcomes where stories are wanted | [practice] | S-01 (Ryan's own caution); SFT-14 | All · 1, 3 | **Check:** SFT-14. The richness gap is a direct request on S1 (§7.4) |
| GEN-08 | A dilemma is a ready-made story shape. Treat the kernel's `Dilemma` emission as a candidate source alongside event patterns | [analysis] | Antigone-type cross-pressure ([foundation §5.2](../foundation.md#52-groups-and-membership)); GADIN; kernel §10.8 and fixture F-8 | Gig, arc · 3, 1 | **Produce:** a `dilemma` clause type (§7.2). **Check:** share of dilemmas that reach an outcome event |
| GEN-09 | Recommended order for P5: simulate, sift, gate and score, select as a mix, seed and cast, validate and bridge, justify what is missing, stage | [hypothesis] | The comparison above; DS-01 | All · 3, 2, 1 | **Check:** each stage is a replaceable component with a tested interface; compare variants in P9 |

## 7. Mapping to the kernel

This section reads the S0 text as it stands (v3.1, final for the first implementation, [D-19](../decisions.md)). It asks what a sifter can read, how patterns could be expressed on it, and what is missing. Statements about the spec's behaviour are [analysis] of its text. Statements about the design of S3 are [hypothesis].

### 7.1 What a sifter can read, and what survives

| Kernel item | Section | What it offers a sifter | Limit |
|---|---|---|---|
| **Event** (`core:event`) | [§9.2](../spec/kernel.md#92-events) | `time`, `place`, `kind`, `participants` (`who`, `role`), `effects` (`on`, one of 11 effects), `witnesses`, `causes` (events). Kinds may carry `tags` ([§2.2](../spec/kernel.md#22-kinds)) | Only canon events are persisted: observed by V, committed by a seed, or depended on by a persisted effect. Others can be forgotten |
| **Summary** | [§9.3](../spec/kernel.md#93-summaries-and-their-refinement) | A coarse count of an event kind in a place and period | Its items are materialised silently, with no Change |
| **Pins** | [§6](../spec/kernel.md#6-pins-time-and-propagation) | `observed` pins mark what V has seen (a familiarity record, F-5); time-varying slots give states at a time | One Change per pin; volume can be high |
| **Edges** | [§3.3](../spec/kernel.md#33-edges), [§12](../spec/kernel.md#12-groups-and-membership) | Membership, kin and knows, with `attrs` (role, strength, visibility, terms, exit-cost). An ended edge stays as history | Visibility changes are edge updates, not events |
| **Beliefs** | [§11](../spec/kernel.md#11-beliefs-and-perspectives) | Who holds what, with confidence and independent evidence; `knows()` answers from beliefs or sight, never from truth | Not Changes (G-1) |
| **Frames and goals** | [§10.2](../spec/kernel.md#102-frames) | Each actor's current concern and goal, with `status` | Status changes are not Changes (G-2) |
| **Dilemmas** | [§10.8](../spec/kernel.md#108-effects-and-cross-pressure) | `Dilemma { actor, frameA, frameB, target, effect, severity }` when a goal frame opens or a membership changes | Emitted once per tuple until a frame changes; its recipient is not stated |
| **Relevance emissions** | [§10.5](../spec/kernel.md#105-changes-and-matching) | Delivered to S1 and S3 above `θ_react`, by actor and frame | Only for interests registered on frames |

**Silence and forgetting shape the design.**
- Resolution, regeneration and replay produce no Changes (I-13). A sifter that subscribes to Changes never sees a forgotten event come back. A sifter that stores bare `Id`s of non-canon events will find them gone.
- Fine-tier events appear when a process mints them or when a root's focus resolves them. A summary item materialised by a query is silent.
- So the sifter's input is the **live Change stream**, plus whatever it chose to keep. It is not a persisted log to scan later. That is the same constraint Winnow's incremental mode imposes by design.

**The game's contribution is thin.** The runtime feed has about a dozen kinds, mostly about V: deaths and knockdowns, combat, heat, district, vehicle, journal and facts, dialogue picks, calls, time ([game events §1](../../../knowledge/game-events.md#1-the-short-answers)). The record of other people's lives has to be S1's (SFT-14, GEN-07). Two sifting domains follow:
- **The V chronicle.** What V did and what it touched. It is sparse and certain, and it is the base for callbacks.
- **The world chronicle.** Simulated events among NPCs and groups. It is as rich as S1 makes it.

### 7.2 A pattern form on kernel types

A pattern is pack data (DS-38). Each clause is an interest selector over the subject bindings of one Change ([§10.5](../spec/kernel.md#105-changes-and-matching)), with role variables that must bind to the same node across clauses.

```ts
interface SiftPattern {
  id: string; version: number;
  roles: Record<string, { kind: KindId; where?: Predicate[] }>;   // ?host, ?guest ...
  stages: Clause[];                       // ordered; each stage is one Change
  unless?: Array<{ between: [number, number]; clause: Clause }>;  // stage indexes
  within?: number;                        // game seconds from first stage; expiry
  once?: string[];                        // role names: tombstone per binding
  tags: string[];                         // for quotas and diversity
}

type Clause =
  | { c: 'event'; kind?: KindId | { tag: string };
      who?: Array<{ role: string; as: string }>;   // participant role -> variable
      effects?: Array<{ on: string; effect: Effect }>;
      where?: Predicate[] }                        // stage-scoped checks (§8.1)
  | { c: 'edge'; type: EdgeTypeId; from?: string; to?: string; ended?: boolean }
  | { c: 'dilemma'; actor: string; target?: string; effect?: Effect; minSeverity?: number }
  | { c: 'belief'; believer: string; subject: string; path: SlotPath; differsFromPin?: boolean }  // needs G-1
  | { c: 'frame'; actor: string; status: 'satisfied' | 'abandoned' | 'blocked' };                 // needs G-2
```

Three invented examples show the range. They are for this dossier only and are not content.

**A. Guarantee broken** (an analogue of the published "violation of hospitality" pattern, in the engine's own terms).
1. `event` kind tagged `shelter`, with effect `protect` on `?guest`, by `?host`, where `?host` carries a trait that values hospitality (a stage-scoped `where` check).
2. `event` with effect `harm` on `?guest`, by `?host`.
3. `unless` between 1 and 2: an event where `?guest` moves out of `?host`'s place.
4. Expiry: three game days. Tombstone per (`?host`, `?guest`).

**B. Ordered against kin** (the foundation's cross-pressure example).
1. `dilemma` with actor `?m`, target `?x`, effect `kill`, `minSeverity` 0.3. This is a prospective stage: no event has happened.
2. `event` by `?m` with any effect on `?x` in {`harm`, `kill`, `protect`, `rescue`, `expose`}. Each choice is a different completion, tagged by the outcome.
3. `unless` between 1 and 2: an event by the ordering group's leadership that withdraws the order.
4. Expiry: six game days.

**C. A false picture** (needs G-1).
1. `belief` held by `?a` about `?b` that differs from the pinned truth, with the belief's evidence including an event `?a` witnessed.
2. `event` where `?a` acts on `?b` with effect `harm` or `help`.
3. Completion yields a story that turns on the gap (TEL-09).

**Where the pieces come from in S0:**
- Clause matching is the kernel's selector test: `kind` (with ancestors), `scope`, `slot`, and `where` predicates that may read the binding's `@role`, `@effect` and `@edge`. Event and edge clauses fit it directly.
- **Joins are the new part.** A kernel interest tests one Change against one frame's indexes. It does not remember that `?host` bound to a particular `Id` two Changes ago. The sifter keeps that memory in its pool.
- **Negation between two bound events** has no kernel counterpart; the nearest is a `threatenedBy` interest on a frame, which only reacts.
- **Stage-scoped attribute checks** (SFT-09) fit `where` predicates evaluated "on new values" when the stage matches. Time-varying slots and `at` answer "did the host value this *then*?".

### 7.3 Change kinds and the sifter

| Change | Feeds | Missing |
|---|---|---|
| `event` | Every event and edge-like clause; causes for F-8 and F-12; effects for F-2, F-3, F-6 | No outcome (done, failed, prevented) and no link to the goal the act served (G-3). Verbs of betrayal, deceit, promise and refusal are not among the 11 effects (G-4) |
| `edge` | Joining, leaving and betraying groups; ended edges with `exit-cost` for F-6 | Visibility changing from `secret` to `open` is an edge update, so a "reveal" needs an `expose` event as well |
| `pin` | `observed` pins for familiarity (F-5); state at a time for stage checks | No marking of which pin changes are story-relevant; the sifter must filter by slot |
| `minted` | Arrivals, births, new groups | Nothing for the sifter itself |
| `contribution` | The sifter's own seeds appearing; authored constraints | The sifter must not match its own sowing as if it were the world |
| `reading` | Game-side facts (heat stage, quest facts) and V's acts from the bridge | The feed is thin and V-centred |
| *(none)* beliefs | Needed for F-7 and example C | G-1 |
| *(none)* frame status | Needed for F-9 and closure | G-2 |
| *Dilemma*, *Relevance* | Not Changes, but delivered; ready-made candidates | Recipient and persistence unstated (G-5) |

### 7.4 Gaps, with a route that leaves S0 unchanged

S0 v3.1 is final for the first implementation, and its scope is settled by D-19. So each gap first gets a route through S1 policies and pack schema. A kernel change is the second choice and needs a recorded contract.

| # | Gap | Why the sifter needs it | Route that leaves S0 unchanged | If S0 changes |
|---|---|---|---|---|
| G-1 | Beliefs are not Changes | Divergence between belief and truth is the main source of live gaps (TEL-09, F-7) | S1's telling, lying and overhearing policies mint events (kinds such as `tell`, `lie`, `rumour`) whose participants include the listener and whose effects include `expose` or `conceal`. Divergence is checked by query when a partial match is already running | A `belief` Change with bindings for believer and subject, limited to memorable beliefs to bound volume |
| G-2 | Frame status changes are not Changes | Closure (F-9), reversals, a goal blocked then met | S1 mints events at status transitions (`goal-met`, `goal-abandoned`, `goal-blocked`), with the frame as cause | A `frame` Change |
| G-3 | Events carry effects, not outcome or intent | Winnow's and StU's examples rely on `failure` and `success`. Planners want the goal an act served | A pack kind extending `core:event` with `outcome` (done, failed, prevented) and `goal` (a frame) | Add both to `core:event` |
| G-4 | The effect vocabulary has no betrayal, deceit, promise, refusal, threat or confession | Many classic stories turn on them | New event kinds with kind tags in pack schema. Keep the 11 effects for the conflict table | Extend effects only if the conflict table needs them |
| G-5 | Delivery to S3 is only by relevance emission, and the Dilemma's recipient is not stated. Each actor gets **at most one emission per (change, frame, interest type)** ([§10.5](../spec/kernel.md#105-changes-and-matching)), so many patterns' first clauses on one frame collapse into one emission | The sifter needs every first-clause match, and dilemmas | Register first-clause interests on the director's frames, **one frame per pattern**, and check that the frame's pull keeps a kind-level `reactsTo` match above `θ_react` (match weight 0.6 times specificity 0.5 is 0.3, so pull must be at least about 0.27). Read `Dilemma` as S3, and state the recipient in the spec as a clarification, not a behaviour change | A subscription to the raw Change stream for S3 |
| G-6 | Non-canon events are forgotten | A pool of partial matches refers to events | The pool copies the descriptors it needs (ids, kinds, times, roles). A promoted match becomes a live seed, which is a retention root ([§7.3](../spec/kernel.md#73-retention-and-forgetting)), and an offer commits its events | Make live partial matches roots |
| G-7 | Fine-tier events are silent when materialised from summaries | Character-level patterns cannot see them | S1 mints events for character acts wherever a root's focus reaches tier 3 or finer. Coarse patterns read summary `count` pins. On V's approach, a retrospective query over summary items ([§8.3](../spec/kernel.md#83-traversal)) can recover a story for the place (DS-29) | None needed |
| G-8 | The sifter's state is not in the persisted record | After a load the pool is empty (replay is silent, I-13) | Persist promoted matches as seed state. Lose the rest. Record the loss as a compromise with a revisit trigger | A `SifterState` operation in the record |

### 7.5 Where partial matches live

Two options.
- **Pool in S3, with first-clause interests on the director's frames.** Cheap. The kernel does what it already does, and the join memory sits in the sifter. Pool size does not multiply kernel interests, which the first implementation scans in full ([§0.2](../spec/kernel.md#02-the-first-implementation)).
- **Every partial match a seed.** This follows the foundation literally: a seed is an actor whose context is what it needs in order to happen ([foundation §6](../foundation.md#6-story-in-the-same-space)), so its next stage is a `reactsTo` interest scoped to the bound nodes, and an `unless` is a `threatenedBy`. It gives persistence and tooling for free. It multiplies frames and interests by the pool size, and Winnow's table shows what a pool of a thousand costs when each event must be tested against all of them.

**Recommended [hypothesis]:** the pool in S3 with a first-clause index, and promotion to a seed (R-6) when a partial match reaches a declared stage or a score threshold. Promotion is where retention, persistence and the seed lifecycle ([P4](../plan.md#5-second-level-plans)) begin to apply. It is a departure from the literal reading and belongs in the compromise ledger with the trigger "pool measurements show seeds are cheap enough".

### 7.6 Determinism and budget

- The sifter's output must be a deterministic function of the Change stream, the pattern set and the world seed (I-1, I-15). Patterns are tried in `id` order, partial matches in creation order, ties go to the lower `Id`, and any random choice uses a keyed stream.
- Each Change costs the sifter units of the tick budget: one per pattern first-clause tested and one per partial match advanced ([§10.7](../spec/kernel.md#107-work-hard-limits-and-worklists)). A cap on the pool is the hard limit that keeps it inside the budget. P7 sets the numbers.
- Winnow's table is a warning, not a forecast. It measures a JavaScript Datalog store with string parsing on each query. The native core ([D-05](../decisions.md)) with a first-clause index starts from a better place, and the Winnow authors name easy wins.

### 7.7 A worked example: the order against kin

Invented for this dossier, on the foundation's cross-pressure case ([§5.2](../foundation.md#52-groups-and-membership)): a gang member M is ordered by the gang's leadership G to kill X, M's brother. Pattern B of §7.2 runs.

| Step | What the record shows | Pool | Features and gates | What the engine may do (D-09 holds throughout) |
|---|---|---|---|---|
| 0 | M's family frame `protects` X. G issues an order: a goal frame on M with effect `kill` on X | Empty | | Nothing yet |
| 1 | The kernel emits a `Dilemma`: M, target X, effect `kill`, severity = pull(family) × pull(order) | **Partial match PM1 starts** with bindings M, G, X | F-1 not yet (no change done). F-3 stakes high (severity). F-4 passes (named persons). **F-5 depends on V's record**: does V know M, X or G? F-7: the gap is live | If F-5 is low, hold PM1 as world texture: it may surface as a rumour, never as an offer. If V has met M or X, PM1 is a candidate for a hook. Foreshadowing is allowed. V is not told how to feel |
| 2 | Time passes with no relevant event | PM1 stays (expiry six game days) | | The director may choose how V could come near it: as the hired killer who finds out who X is, as X's protection, as go-between, or as a witness (foundation §5.2). Each is an offer |
| 3 | An event: M warns X (effect `protect` on X) | **PM1 completes** with outcome tag `warned` | F-1 passes (completed change). F-6: a membership may now end. F-8 passes: cause path order → warning | A `meta:story` event is minted, with causes the order and the warning. It becomes a recap, a rumour or a callback, or opens a second pattern ("vendetta") that matches `meta:` events |
| 3′ | Instead, G withdraws the order | **PM1 dies** (`unless` between 1 and 2) | | The story did not happen. Nothing is offered. A tombstone stops PM1 restarting for (M, X) this week |

**Ordering against another candidate.** Suppose a second candidate is a queue of customers gossiping about prices. The first outranks it on stakes (F-3), a live gap (F-7) and irreversibility (F-6). The second can outrank it on familiarity (F-5) if V is a regular at that stall. The engine ranks, shows both with their feature values, and the composition rule (TEL-12) decides how many of each kind to offer. No number above is a score, by design (TEL-14).

### 7.8 Principles: the mapping

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| MAP-01 | Sifting runs on the live Change stream plus what the sifter chose to keep. It is not a scan of a persisted log | [analysis] of the spec | Kernel §7.3 (non-canon events can be forgotten), §14.1, I-13 (replay and regeneration are silent) | All · 3, 1 | **Check:** a test that forgets and regenerates an event mid-pattern and confirms no phantom match |
| MAP-02 | A pattern clause is a kernel selector over a Change's subject bindings. A join is a shared role variable, remembered by the sifter | [analysis] of the spec; the pattern form is [hypothesis] | Kernel §10.5; Winnow's variables and acceptors | All · 3 | **Produce:** §7.2. **Check:** fixture patterns that match and miss on the same event log |
| MAP-03 | The pool is S3 data. A partial match is promoted to a seed at a declared stage, and only then does the kernel retain, persist and schedule it | [hypothesis] | Foundation §6; kernel §7.3 (live seeds are roots) and §14.1 | All · 3, 2 | **Produce:** R-5 and R-6. **Check:** a promotion test and a reload test |
| MAP-04 | The kernel's `Dilemma` is a prospective candidate source, available before any event completes | [analysis] of the spec | Kernel §10.8, fixture F-8; foundation §5.2 | Gig, arc · 3, 1 | **Produce:** the `dilemma` clause. **Check:** each Dilemma either starts a match, is dropped by a stated rule, or is logged as unused |
| MAP-05 | Belief and truth divergence needs a trigger. Until beliefs are Changes, S1 policies must mint the events that create them | [hypothesis] | Kernel §11.1 and §11.2 (policies are S1's); G-1 | Gig, arc · 3, 1 | **Check:** a pattern that depends on a divergence names the event kind that creates it |
| MAP-06 | A completed match is minted as a `meta:` event whose causes are its constituents. The trace of an offer then walks back to the real events | [analysis] of the spec | Kernel §3.1 (minted nodes have a `creator` and `cause`), §9.2 (`causes`), §13 | Gig, arc · 3, T | **Produce:** R-8. **Check:** `trace` from an offer reaches every constituent event |
| MAP-07 | Every tellability feature names the record fields it reads. A feature with no field is dropped | [hypothesis] | §5.5; S-03 (criteria that could not be computed) | All · 3 | **Check:** the table in §5.5 stays in sync with the registry of features |
| MAP-08 | The sifter obeys determinism and the work budget like any other subsystem | [analysis] of the spec | Kernel I-1, I-10, I-15, §10.7 | All · 3, P7 | **Check:** replay the same Change stream twice and compare offers; run with the pool at its cap and compare tick cost to budget |

## 8. Tensions

| # | Tension | Between | How the design can live with it |
|---|---|---|---|
| T-1 | **Curation against intervention.** Ryan values the actual, improbable and unauthored, and is wary of anything that makes stories look well-formed. The plan wants pacing and engaged threads that grow (DS-09) | Sifting (SEL-01) and the director (SEL-03) | Sifting never edits what V has observed (DS-05). Partial matches may be used to prepare and foreshadow. Forcing completion is left to dossier 7. The proactivity dial goes down to off (D-02) |
| T-2 | **Surprise against familiarity.** A chain is more enjoyable to someone who knows its people (SFT-10), but a chain that is only about known people is predictable | TEL-03 and TEL-07 | Unknown chains stay as world texture or rumour. Introduce new people through casting, so that by the time a chain matters V has met them |
| T-3 | **Findable against tellable.** Patterns give structure without tellability, and ranking supplies tellability that is unproven | SFT-03 and TEL-15 | Ship the ranking as a logged hypothesis, keep a random-within-gates baseline running in tests, and report null results |
| T-4 | **Honest causes against cheap causes.** DS-24 says causes really exist in the record. DS-29 says invent the event and justify it later | TEL-10 and GEN-06 | Both stand if justification is write-once and every offer's trace labels each cause `found` or `constructed`. A constructed cause that V later contradicts is a defect to count |
| T-5 | **Sift or plan or manage.** Planning offers soundness, sifting offers real causes, management offers shape. The map says the P5 design chooses | GEN-01 | §6: sift for sowing, plan to validate short chains, manage ordering offline |
| T-6 | **The model of V against D-09.** Tellability for V needs an audience model. The engine may hold only beliefs about V and never assigns drives | TEL-01 and D-09 | Features use V's observed record (facts about what V saw and did), not inferred wants. A score that would flip on a guess about V's taste is held back or averaged over the Vs the engine cannot tell apart |
| T-7 | **Pattern count against the tick budget.** Richer libraries match more stories and cost more per event | SFT-06 and the load-time goal | Caps, a first-clause index and native code; P7 measures. Fewer, more generic patterns plus a ranking is also the two-layer advice of Kreminski et al. |
| T-8 | **Authored seeds against sifted offers.** Authored content sits above procedural content (D-02), and fixed windows must not be crowded out | Sowing and fitting | Sifted offers are lower priority than a live authored seed's declared window. The scheduler (dossier 7) arbitrates |
| T-9 | **Negativity against tone.** News selection favours bad news and conflict. The setting is dark already | TEL-13 | Valence spread as a target under the player's tone controls ([DS-30](../design-seeds.md)) |

## 9. Lateral links

- **Pattern pool and the kernel's frame interests.** A partial match waiting for its next stage is a sifter-side version of a frame waiting for what would unblock it (`blockedBy`, `wants`). That similarity is why promoting a match to a seed (R-6) is natural.
- **Winnow's staged constraints and the kernel's time-varying slots.** "True at stage k" is the same question as "true at time t" in [§6.3](../spec/kernel.md#63-time-varying-slots).
- **Within-pattern rarity (StU) and expressive-range analysis** (PER-08). Both ask how unusual an output is among what the system can produce. StU's property signatures are a cheap form of the second.
- **News composition and the director's tension budget** ([DS-27](../design-seeds.md)). Both choose the mix, not the top item.
- **Labov's credibility trade-off and "surprising yet inevitable"** ([DS-24](../design-seeds.md)). The more remarkable the event, the more of its causes must show.
- **Qud's write-once rationalisation and the kernel's pins.** What is observed is fixed; what is not may be justified later ([ledger C-01](../foundation.md#9-the-reference-model-and-the-compromise-ledger)).
- **Dilemma emission and tragedy.** A cross-pressure detector is a sifter for one family of story shapes (Antigone), running before any event completes.
- **Peak-end** (PER-04). A closed chain's ending decides how it is remembered, which is why closure (F-9) and the stake line (TEL-11) are staged with care.
- **Callbacks** ([DS-10](../design-seeds.md)). Sifting the V chronicle for earlier acts that connect to the present is the callback finder.
- **Retellings as evaluation.** Counting what players retell is both a sifting concern (SFT-11) and a P9 measure.

## 10. Open questions

1. **What offer rate is right?** A share of event volume and a number per hour (SFT-02). The only figures in the sources are Chroniqueur's chain counts, which say how large the pool was, not how much to surface.
2. **Do the features beat random-within-gates?** The test in R-25, run on a second world, with blind raters and a fixed presenter.
3. **Does within-pattern rarity (StU) carry over to a richer world?** Its test had three raters and a toy world. Chroniqueur's null result used a different measure. A paired test on one world would settle which part failed.
4. **How fast does familiarity decay?** Lessard et al. suggest knowing the world raises appreciation. For callbacks we need the curve for V's memory of a person.
5. **How many patterns does a city need?** The sources aim at large numbers and cheap authoring. A first library of a few dozen patterns, with a measure of how much of the record they cover, would tell us.
6. **Can patterns be induced from the game's own content?** The 73 base-game gigs ([dossier 4](d04-quest-structure.md#5-what-makes-the-strong-ones-strong-a-first-corpus-test)) are example sequences of a sort. A Synthesifter-like step could draft patterns from them for an author to edit. This is a research idea, not a plan.
7. **What does a pool of a thousand cost in the native core?** Winnow's table is the only figure. P7 should measure on real patterns before any cap is fixed.
8. **Should V ever see partial matches as anticipation?** Winnow's authors suggest an interface that lets the player track a chosen pattern. For this engine it would be a new feature, so under the finish-first spirit of the project it is banked, not designed.
9. **How should tellability treat group-level stories?** Most of the sources are about individuals. A gang's war is a chain of group events. Whether F-4 and F-5 work for groups is untested.
10. **What does "irreversible" mean in this city?** Death is clear. Many changes (a debt, a standing, a membership) are costly but reversible. The irreversible-effect set (F-6) needs an owner and a test.

## 11. Requirements for the procedural engine (P5)

Each requirement traces to principles in this dossier (SFT, TEL, GEN, MAP), to gaps (G), and to decisions (D), design seeds (DS) or the plan's quality bar (bar-N: 1 causality, 2 relevance, 3 legibility, 4 agency, 5 perceptible variety, 6 setting fidelity, 7 pacing, 8 player sets the mix, 9 no perceivable cost, 10 coexistence). They state what P5 must provide. How is for P5.

**A. Inputs and patterns**

| # | Requirement | Traces to |
|---|---|---|
| R-1 | Every pattern declares the event kinds, slots and edges it reads, and which layer produces them. A pattern with no producer is rejected at load | SFT-14, GEN-07, MAP-07; bar-1 |
| R-2 | The pattern form has ordered stages; role variables with kinds; stage-scoped `where` checks; `unless` between two bound stages; an expiry; and a once-per-binding tombstone. Patterns are versioned pack data, read by a generic loader | SFT-04, SFT-06, SFT-08, SFT-09, MAP-02; DS-38 |
| R-3 | Patterns carry structure and tags only. Tellability weights live in engine code over matches, never in a pack | SFT-03, TEL-14 |
| R-4 | First-clause matching uses interests on the director's frames, one frame per pattern, with frame pull high enough to clear `θ_react` for kind-level matches. Later clauses are checked by the sifter against its pool | SFT-04, MAP-02; G-5; kernel §10.5 |
| R-5 | The pool is bounded: a cap per pattern and overall, expiry, duplicate suppression and tombstones. Its update cost is counted in the tick budget and measured by P7 | SFT-06, MAP-08; bar-9 |
| R-6 | A partial match is promoted to a live seed at a declared stage or score. Before promotion it holds copied descriptors only. Promotion retains its events | SFT-05, MAP-03; G-6; kernel §7.3 |
| R-7 | Candidate sources are event patterns, `Dilemma` emissions, belief and truth divergences, and promoted partial matches | MAP-04, MAP-05, TEL-09, GEN-08; G-1 |
| R-8 | A completed match is minted as a `meta:` event with the sifter as creator and its constituent events as causes. It reaches the sifter's patterns and tools, and never S1's behavioural policies | SFT-07, MAP-06; kernel §9.2 |

**B. Scoring and selection**

| # | Requirement | Traces to |
|---|---|---|
| R-9 | Offers have a stated target share of event volume and a hard cap per hour, tied to the proactivity dial from off to high. At off, sowing stops and fitting is unaffected | SFT-02; D-02; DS-36; bar-7, bar-8 |
| R-10 | Selection composes the set under diversity constraints on pattern, event kind, valence and place, with quotas as data | SFT-13, TEL-12, TEL-13; bar-5 |
| R-11 | Gates come before scores: a reportable change, a showable cause, a protagonist and a length cap | TEL-02, TEL-04, TEL-10, F-1, F-8, F-12 |
| R-12 | Scorers take V's observed record and the director's beliefs as input. They never assign or assume V's drives. Deviation scores are robust across the Vs the engine cannot yet tell apart | TEL-01, TEL-03; D-09; I-12; T-6 |
| R-13 | Scores are ranks or bands that keep their feature values. Thresholds are data. No single fitted formula decides an offer | TEL-14, TEL-15 |
| R-14 | A chain about people V has never met is held as world texture or a rumour, unless its stakes touch V's record | SFT-10, TEL-06, TEL-07; bar-2 |
| R-15 | A callback to something V saw earlier carries a cue that grows with elapsed time and with the number of similar events since | TEL-07; DS-10; bar-2 |
| R-16 | The director may prefer castings that create dilemmas and collisions, scored by the same features and limited by the tension budget | GEN-08; DS-11, DS-27; bar-7 |

**C. Hand-over to seeding, fitting and staging**

| # | Requirement | Traces to |
|---|---|---|
| R-17 | A sifted match hands P4 its bound roles, the cited cause paths, a stake line, a lead line, its feature values and the stage reached. Bound roles are fixed, since they are events already in the record | TEL-05, TEL-10, TEL-11; DS-24 |
| R-18 | The seed marks whether the story is complete (a recap, rumour or callback) or partial (a foreshadow or an offer) | TEL-09, SFT-05, F-9 |
| R-19 | Generate-then-justify is allowed only if every constructed cause agrees with all observed and committed pins. A constructed cause is pinned once V observes it, and never alters an observed fact | GEN-06, TEL-10; DS-03, DS-29; bar-1 |
| R-20 | Planning serves as a depth-bounded validator and bridge-builder for short chains, over NPC and group goals only. It never plans V's acts and is not the global generator | GEN-05; D-09 |
| R-21 | Casting uses the kernel's queries and contributions. No external solver in the first implementation | GEN-04, DS-49; D-19 |
| R-22 | Shape templates and arc checklists are data. They recognise and shape; they do not originate | GEN-03; dossier 4 R-28 |
| R-23 | Ordering and pacing policies are precomputed or bounded by the work allowance. No online search over stories | GEN-02; kernel §10.7 |

**D. Evidence, tools and records**

| # | Requirement | Traces to |
|---|---|---|
| R-24 | Every offer records the pattern id and version, bindings, feature values, rank, its rivals and why it won, with each cause marked `found` or `constructed`. The record is agent-readable | TEL-10, TEL-15, GEN-06, MAP-06; DS-26; bar-3 |
| R-25 | Before tellability features drive a live session, P9 runs (a) blind ratings of sifted against random-within-gates chains from at least two worlds, (b) a selection by presentation design with presentation held fixed, (c) per-feature ablation, and reports null results as results | SFT-01, SFT-12, TEL-03, TEL-15; S-02, S-06 |
| R-26 | Log what V accepts, ignores and later mentions, per offer and feature, as the engagement signal. It feeds the same features | SFT-11, TEL-15; DS-09 |
| R-27 | Pattern authoring has a preview: run a pattern over a recorded or simulated log and see what would match. Time to a working pattern is measured | SFT-08; DS-43 |

**E. State and determinism**

| # | Requirement | Traces to |
|---|---|---|
| R-28 | Promoted matches persist as seed state. The unpromoted pool is not persisted and starts empty after a load. The departure goes in the compromise ledger with the trigger "reloads lose stories players noticed" | MAP-03; G-8; kernel §14.3 |
| R-29 | Pattern and pool iteration is in `id` and creation order, ties go to the lower `Id`, random choices use keyed streams, and nothing reads a wall clock | MAP-08; I-1, I-15 |
| R-30 | The eight gaps in §7.4 go to the owners of S0 and S1 as requests, each with its route that leaves S0 unchanged. S1 mints the missing events (beliefs told, goals met or dropped, betrayal and deceit as kinds with tags, character acts at fine tiers). Pack schema adds `outcome` and `goal` to event kinds | G-1 to G-8; D-19 |

## 12. Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give.

| # | Field | Source | Tier |
|---|---|---|---|
| M-1 | **Complex event processing and incremental pattern matching** (event pattern languages; Rete). A comparison for the sifter's engine and for the kernel's interest matching | Cugola and Margara 2012; Forgy 1982 (abstracts) | Supporting, comparison only (D-21) |
| M-2 | **Sifting-pattern authoring by example, by node graph and by sketched arc** | Synthesifter, Centrifuge, ARC SIFT (read or abstract) | Supporting; feeds P6 tooling |
| M-3 | **Conversation analysis of storytelling rights and "local news"** (Sacks, Polanyi, Norrick, Ochs and Capps, as Baroni reports them) | Baroni (read) | Supporting |
| M-4 | **Social-information bias and cultural attraction** (why content about people is remembered and passed on) | Mesoudi et al. 2006; Stubbersfield et al. 2015 (summaries) | Supporting |
| M-5 | **Sharing and virality research** (arousal as a driver) | Berger and Milkman 2012 (summary) | Peripheral |
| M-6 | **Retelling-based evaluation of games** | Kreminski et al. 2019 (abstract) | Supporting; P9 |
| M-7 | **Complexity-drop accounts of interest** (Simplicity Theory) as a field in itself | Dessalles (author's pages) | Supporting, comparison only |
| M-8 | **Dilemma-based narrative generation** | Barber and Kudenko (abstracts) | Supporting; near SEL-05 and the kernel's cross-pressure |
| M-9 | **Prospective sifting joined to drama management** (Awash, Shepherd) | Lyu et al. (read); Deo et al. (abstract) | Supporting; shares ground with SEL-03 and dossier 7 |
| M-10 | **Narrative event ontologies and kind-tag design** (what event kinds and tags a sifter needs; no source found) | None; a gap in the sources | Supporting, to be researched with S1 |

## 13. Credit candidates

Each third-party work that taught us something used above. "Opened" means I fetched and read that page or document in this session. Creator names are as the document shows them.

| Creator | Title | Link | Status | What we learned |
|---|---|---|---|---|
| James Ryan | *Curating Simulated Storyworlds* (PhD thesis, 2018) | https://escholarship.org/uc/item/1340j5h2 | Not opened; known through recaps and papers. Already credited | Sifting as "overgenerate and curate", and the caution that the simulated knowledge was not rich in intrigue |
| Emily Short | Recaps of Ryan's thesis, [chapters 1 to 3](https://emshort.blog/2019/05/21/curating-simulated-storyworlds-james-ryan/) and [chapter 6 onward](https://emshort.blog/2019/05/28/curating-simulated-storyworlds-james-ryan-ch-6f/) | as linked | Opened | What the thesis claims, and an independent view that curation is not the only thing that decides quality |
| Max Kreminski, Melanie Dickinson, Michael Mateas | "Winnow: A Domain-Specific Language for Incremental Story Sifting" (AIIDE 2021) | https://ojs.aaai.org/index.php/AIIDE/article/view/18903 | Opened. Already credited | Staged patterns with acceptors, partial matches, stage-scoped constraints, and a measured cost for the pool |
| Max Kreminski, Melanie Dickinson, Noah Wardrip-Fruin, Michael Mateas | "Select the Unexpected: A Statistical Heuristic for Story Sifting" (ICIDS 2022) | https://mkremins.github.io/publications/StU_ICIDS2022.pdf | Opened | Two layers (patterns for structure, a heuristic for tellability) and a within-pattern rarity measure |
| Max Kreminski, Noah Wardrip-Fruin, Michael Mateas | "Toward Example-Driven Program Synthesis of Story Sifting Patterns" (INT at AIIDE 2020) | https://ceur-ws.org/Vol-2862/paper18.pdf | Opened | Pattern authoring is a bottleneck that example-driven synthesis can ease |
| Jonathan Lessard, Stephen Friedrich, Samuel Paré-Chouinard, Leila Kosseim | "Narrative Gold Digging: Sifting and Narrating Stories from a Procedural Simulation" (FDG '26) | https://www.pcgworkshop.com/archive/lessard2026narrative.pdf | Opened | A reader test that found no gain from improbability or dramatic situations, and a candid account of why eventfulness criteria are hard to compute |
| Qianwen Lyu, David Millard, Nicholas Gibbins | "Stories from the Bottom Up: Emergent Narratives with Composable Story Sifting Patterns" (FDG '25) | https://eprints.soton.ac.uk/502632/2/3723498.3723809.pdf | Opened | Composable patterns, and the controls that keep a pool bounded |
| Wilkins Leong, Julie Porteous, John Thangarajah | "Automated Sifting of Stories from Simulated Storyworlds" (IJCAI-22) | https://www.ijcai.org/proceedings/2022/0686.pdf | Opened | Sifting by a drawn arc, as a way to cut authoring cost |
| Raphaël Baroni | "Tellability" (*Living Handbook of Narratology*) | https://www-archiv.fdm.uni-hamburg.de/lhn/node/30.html | Opened | A map of the accounts of tellability and their open problems |
| Peter Hühn | "Event and Eventfulness" (*Living Handbook of Narratology*) | https://www-archiv.fdm.uni-hamburg.de/lhn/node/39.html | Opened | The two kinds of event, and Schmid's binary and graded criteria |
| Jean-Louis Dessalles | Publication page on narrative interest, and the Simplicity Theory page on relevance | https://perso.telecom-paristech.fr/jld/papiers/narrative.html | Opened | Unexpectedness as a gap between expected and observed complexity, held by the observer |
| Deirdre Wilson and Dan Sperber | "Relevance Theory" in *The Handbook of Pragmatics* (2004) | https://www.dan.sperber.fr/wp-content/uploads/2004_wilson_relevance-theory.pdf | Opened | Relevance as comparative, not quantitative, so ranking beats formula fitting |
| Tony Harcup and Deirdre O'Neill | "What is news? News values revisited (again)" (*Journalism Studies*, 2017) | https://eprints.hud.ac.uk/id/eprint/27268/ | Opened (abstract page; full text from a copy of the author version) | A fifteen-item list from 711 lead stories, and the point that selection cannot be separated from treatment |
| Johan Galtung and Mari Holmboe Ruge | "The structure of foreign news" (*Journal of Peace Research*, 1965) | Not verified | Not opened; known through Harcup and O'Neill | Additivity, complementarity and exclusion, and composition and continuity as selection factors |
| Jason Grinblat and C. Brian Bucklew | "Subverting Historical Cause & Effect: Generation of Mythic Biographies in Caves of Qud" (FDG 2017) | https://pcgworkshop.com/archive/grinblat2017subverting.pdf | Opened. Already credited | Choosing an event first and rationalising its cause afterwards, with the state held as glue |
| Mark O. Riedl and R. Michael Young | "Narrative Planning: Balancing Plot and Character" (*JAIR*, 2010) | https://jair.org/index.php/jair/article/view/10669 | Opened (abstract) | Planning with explained character goals improved audience understanding of intent |
| Mark J. Nelson, Michael Mateas, David L. Roberts, Charles L. Isbell | "Declarative Optimization-Based Drama Management in Interactive Fiction" (2006) | https://www.kmjn.org/publications/DODM_IEEECGA-abstract.html | Opened (abstract) | Online search did poorly on larger stories |
| David Wilmot and Frank Keller | "Modelling Suspense in Short Stories as Uncertainty Reduction over Neural Representation" (ACL 2020) | https://arxiv.org/abs/2004.14905 | Opened (abstract) | Forward-looking uncertainty reduction predicted suspense better than backward surprise |
| Deo, Chung and McCoy | "Shepherd: An Incremental Story Sifting-Based Drama Manager" (AIIDE 2024) | https://ojs.aaai.org/index.php/AIIDE/article/view/31887 | Opened (abstract) | Incremental sifting can steer autonomous characters |
| Alex Mesoudi, Andrew Whiten, Robin Dunbar | "A bias for social information in human cultural transmission" (*British Journal of Psychology*, 2006) | https://research-portal.st-andrews.ac.uk/en/publications/a-bias-for-social-information-in-human-cultural-transmission/ | From a search result; not opened | Information about social interaction is retained better than equivalent non-social information |
| Jonah Berger and Katherine Milkman | "What makes online content viral?" (*Journal of Marketing Research*, 2012) | https://faculty.wharton.upenn.edu/wp-content/uploads/2011/11/Virality.pdf | From a search result; not opened | Arousal, not valence alone, drives sharing |
| Heather Barber and Daniel Kudenko | "Dynamic Generation of Dilemma-Based Interactive Narratives" (AIIDE 2007) | https://ojs.aaai.org/index.php/AIIDE/article/view/18773 | From a search result; not opened | Dilemmas as the target of a generator |
| Johnson-Bey and Michael Mateas | "Centrifuge: A Visual Tool for Authoring Sifting Patterns" (PLIE 2021) | https://eis.ucsc.edu/papers/Johnson-Bey_Centrifuge_PLIE2021.pdf | From a search result; not opened | A visual route to pattern authoring, and pattern reuse as a missing feature |
| William Labov | "Some further steps in narrative analysis" (*Journal of Narrative and Life History*, 1997) | https://narrativestudies.lib.unb.ca/bibcite/reference/17613 (bibliographic record) | Not opened; known through summaries | The most reportable event, and the link between reportability and the need for credibility |
