# Dossier 23: evaluation, simulation validation and testing

**Status:** v1, 23 October 2026. Dossier 23 of the [craft discipline map](map.md), the last one, written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: EVA-01 (evaluating generated stories and interactive narrative), EVA-02 (simulation testing, deterministic replay and QA of branching content) and SYS-01 (agent-based simulation and its validation). Supporting: EVA-03 (player-community analysis), CRA-15 (simulation-based training: functional fidelity, fiction contract, debrief) and ETH-13 (research ethics for user research and telemetry). LOD-01, LOD-02 and LOD-03 are comparisons only under [D-21](../decisions.md). Feeds P9 (evaluation), P10 (tooling), the validation half of P3, and the fixtures of S0 and S2. Kernel references are to [S0](../spec/kernel.md), seed-language references to [S2](../spec/seeding.md).

## In brief

- **This is the integrating dossier.** Dossiers 1 to 22 left about 276 numbered measures (16 dossiers), about 50 numbered tests, 17 evaluation requirements (dossier 5), and 15 draft in-game session cards with roughly 170 rows (7 in knowledge pages, 8 inside dossiers). They overlap heavily: "the same save gives the same record" appears, in different words, in at least ten places. §7 merges the measures into 30 groups. §5 turns them into one plan with four tiers. §6 merges the cards into 14 ordered sessions.
- **No single quality score, and the plan is built around that.** Each of the plan's ten quality statements gets its own instruments. Comparative judgements use pairwise tests against named controls. A feature is kept only if it beats a control that passed the same gates, or if removing it makes no difference worth the complexity (STN-01, STN-04, PNL-11).
- **A level-of-detail simulation in a fictional city has no ground truth, so validity has three parts that are tested differently.** The exact part (determinism, regeneration, partition independence, reload) is tested exactly, by property tests with shrinking. The agreement part (coarse against fine) is tested by twin runs under a declared contract per process. The plausibility part is tested against patterns declared in advance, then by people (VLD-01 to VLD-10).
- **Null results are results.** Every run has a plan written first, with a smallest effect of interest and equivalence bounds, and ends in one of four verdicts: supported, refuted, equivalent or inconclusive (NUL-01 to NUL-04). The only reader test of generic tellability heuristics that dossier 6 found was a null.
- **The session ledger is the one evidence interface** for panels, game sessions and testers. It is local, consented and counts-only by default, and nothing in the director may read it (ETX-02, ETX-03, TRS-04).
- **Gaps found.** 17 kernel items (S23-S0), 16 seed-language items (S23-S2), 30 plan items (S23-P9) and 18 tooling items (S23-P10) in §12. The reference model implements S0 v3; fixtures F-16 to F-25 and invariant I-16 from S0 v4 are not in it yet, and no S2 fixture covers the lint groups from dossiers 19 to 22.
- **I ran no tests and no jobs.** Everything about the reference model comes from its README and the specifications.

## 1. Scope and why it matters here

**What this dossier does.** It answers one question: how will we know the Story Engine is good enough, and how will we know when it is not? The engine is a set of deterministic layers over a level-of-detail simulation ([plan §2](../plan.md#2-the-system-at-first-level)). Its success criteria are perceptions: caused, relevant, legible, consequential, varied, in-setting and well paced ([plan §1](../plan.md#1-what-doesnt-suck-means)). A perception needs an instrument. Its structural promises (determinism, reload stability, no silent loss) need tests. Its simulation needs validation without a real city to compare with.

**Layers and workstreams informed.** Evaluation (E) is the home layer. Tooling (T, P10) builds the instruments. The simulation layer (1) gets its validation method. Layers 2 to 4 get fixtures and a place where each of their hypotheses is tested. P9 consumes everything above ([map row 23](map.md)). The validation half (SYS-01, EVA-02) is cheap and could start with dossier 14; it is the part of this dossier that can start now.

**The two milestones that use it first.** M3 is done when "generated hooks beat a Radiant-style baseline on the quality bar, judged blind" and the authored seed "plays with sowing off, fitted the same way as with it on". M4 is done when "one prepared in-game session passes its checklist" ([plan §4](../plan.md#4-milestones)). This dossier defines what "judged blind", "the same way" and "passes its checklist" mean.

**What it does not do.** It does not choose the engine's constants, run any test, or decide a design question that a test would decide. It does not design the panel software or the tools in detail; it specifies what they must do (§12).

## 2. The failure record

How evaluation of generated and simulated systems goes wrong. Each row says what a plan must do about it.

| # | Failure | Evidence | What the plan does |
|---|---|---|---|
| F-1 | **A clever selection heuristic that does nothing.** Chains chosen by world-level improbability or by dramatic situation showed no relation to enjoyment; the favourite story was the random control | Dossier 6 (S-02): a 24-reader study of 12 stories, as that dossier read it in full | Every selection feature is tested against random-within-gates (STN-04, PNL-11) |
| F-2 | **Selection and telling are judged together.** The same events ranked third and last under two writers | Dossier 6 (SFT-12, from the same study) | Hold one stage fixed (STN-05) |
| F-3 | **Automatic metrics that do not track people.** A benchmark of 1,056 stories from 10 systems, annotated on six human criteria, correlated 72 automatic metrics with them and reports weaknesses in current metrics | Chhun and colleagues 2022, abstract read | Automatic measures gate and regress; people decide; proxies are validated first (STN-02) |
| F-4 | **One number hides what failed.** The same benchmark proposes six criteria that are orthogonal to each other. [Hypothesis], extending it: a single score would not say which quality is missing | Same (the first sentence only is the source's) | No overall score (STN-01) |
| F-5 | **The builders are the worst judges.** The lens records that the authors of generated stories liked them more than the evaluators did | Lens L8 field 21, citing Lessard and colleagues; not re-read here | Builders are not raters (STN-09) |
| F-6 | **People cannot report their own causes.** Verbal reports of why people did something often reflect theories about why, not access to the process | Nisbett and Wilson 1977, abstract summary; dossier 13 CNF-01 | Behaviour logs first; stated reasons never carry a conclusion alone (STN-10) |
| F-7 | **Tools that pass while the content is wrong.** ChoiceScript's randomtest finds crashes and logs the choices that reproduce them, but gives no error for an infinite loop; the "avoid used options" mode can miss bugs that need a repeated choice; zero hits do not prove dead code; neither tool replaces playing | Choice of Games pages, read | Mutation tests of the harness; zero-hit reported as unreached, not dead (DST-07, DST-09) |
| F-8 | **Fake bugs from the tool.** Quicktest can report errors for cases the author knows cannot happen, and can reach code a human could not | Choice of Games, read | Findings carry a "cannot happen" waiver that is itself logged (DST-08) |
| F-9 | **Happy-path samples.** Sample states written by one author show one person's world | Dossier 16 (TST-05) | Awkward-state library; cast-spread reports; real saves as samples (S23-S2-04, S23-P10-06) |
| F-10 | **Polish mistaken for fidelity.** In health-professions simulation, higher physical resemblance did not by itself improve learning; the review argues for functional correspondence | Hamstra and colleagues 2014, abstract summary | Sessions use throwaway scripts and the test profile; they do not polish (GSN-04) |
| F-11 | **Unsafe experiments.** A large field experiment that varied what people saw drew an editorial expression of concern about consent | Kramer, Guillory and Hancock 2014; PNAS editorial, summary | Any arm that varies what players see is a human-subjects experiment (ETX-01) |
| F-12 | **Simulation compared with the wrong thing.** Validating agent-based models against data is hard for general reasons, and the choice of method changes the answer | Windrum, Fagiolo and Moneta 2007, abstract read | Patterns are chosen before calibration; calibration and validation use separate seeds (VLD-02, VLD-09) |
| F-13 | **Differences in means drowned by variance.** Agent-based and equation-based models can differ little in means when stochastic events, parameter uncertainty and model boundary dominate | Rahmandad and Sterman 2008, abstract summary | Compare distributions across many worlds, not single runs (VLD-04) |
| F-14 | **Players name the template within days.** The Fallout 4 settlement-request pattern had a forum thread seven days after launch (10 to 17 November 2015) | Know Your Meme, page read | The community is a cheap detector, and uniqueness per player is not independence (TRS-05, TRS-06) |
| F-15 | **Passing the proxy.** Agents that write a plainly repetitive sequence while passing the repetition metrics | Dossier 5 (EV-16, a planned test, not an observed case) | An adversarial pass on every metric that gates (S23-P9-21) |

## 3. Sources

I read only the measures, testing and requirements sections of dossiers 1 to 22, plus the specifications named in each row. I did not re-read their source papers, except where §3.1 says so.

### 3.1 Read (page or abstract fetched in this session)

| Source | What I read | Used for |
|---|---|---|
| Chhun, Colombo, Clavel and Suchanek, "Of Human Criteria and Automatic Metrics: A Benchmark of the Evaluation of Story Generation", COLING 2022 (arXiv 2208.11646) | The arXiv abstract page | STN-01, STN-02, F-3, F-4 |
| Grimm and 18 co-authors, "The ODD Protocol for Describing Agent-Based and Other Simulation Models: A Second Update to Improve Clarity, Replication, and Structural Realism", *JASSS* 23(2), 7 (2020) | The journal page: abstract and the element list, through a summarising fetch that covered the first 100,000 of about 104,000 characters | VLD-01, VLD-02, VLD-07 |
| Windrum, Fagiolo and Moneta, "Empirical Validation of Agent-Based Models: Alternatives and Prospects", *JASSS* 10(2), 8 (2007) | The journal page: abstract | F-12, VLD-09 |
| Towers, Choice of Games blog, "How to get the most out of automated testing, part 2" (19 January 2018), and Choice of Games, "Testing ChoiceScript games automatically" | Both pages, through a summarising fetch | DST-07, DST-08, F-7, F-8 |
| Know Your Meme, "Another Settlement Needs Our Help" | The entry page | F-14, TRS-05 |

### 3.2 Abstract, listing or search summary only

Findings from these are graded for what the summary shows, and no more.

| Source | What the summary showed | Used for |
|---|---|---|
| Grimm and nine co-authors, "Pattern-oriented modeling of agent-based complex systems: lessons from ecology", *Science* 310(5750):987-991 (2005) | The abstract's claim that no general framework existed for designing, testing and analysing bottom-up models, and the proposal of pattern-oriented modelling | VLD-02 |
| Axtell, Axelrod, Epstein and Cohen, "Aligning simulation models: a case study and results", *Computational and Mathematical Organization Theory* 1(2), 123-141 (1996) | The abstract: "docking" two models to see whether they give the same results; a richer model modified to reproduce a simpler model's results | VLD-07 |
| Sargent, "Verification and validation of simulation models", *Journal of Simulation* 7:12-24 (2013) | The abstract: conceptual model validity, model verification, operational validity, data validity | VLD-01 |
| Claessen and Hughes, "QuickCheck: a lightweight tool for random testing of Haskell programs", ICFP 2000 | The abstract: properties written as functions, tested on random input, with custom generators | DST-02 |
| Wilson, "Testing Distributed Systems w/ Deterministic Simulation", Strange Loop 2014 | The conference listing only (benefits, drawbacks and trade-offs of a deterministic simulation framework). I did not see the talk, slides or transcript | DST-01 (hedged) |
| MacIver and Donaldson, "Test-Case Reduction via Test-Case Generation: Insights from the Hypothesis Reducer", ECOOP 2020 | The abstract: reduce the sequence of random choices made in generation, so reduced cases remain valid | DST-03 |
| Segura, Fraser, Sánchez and Ruiz-Cortés, "A Survey on Metamorphic Testing", *IEEE TSE* 42(9):805-824 (2016) | The abstract: check relations between outputs of transformed inputs when no oracle is available | DST-04 |
| Hamstra, Brydges, Hatala, Zendejas and Cook, "Reconsidering fidelity in simulation-based training", *Academic Medicine* 89(3):387-392 (2014) | The abstract: fidelity appears independent of educational effectiveness; functional task alignment, engagement and suspension of disbelief are proposed | GSN-04, F-10 |
| Rudolph, Raemer and Simon, "Establishing a safe container for learning in simulation: the role of the presimulation briefing", *Simulation in Healthcare* 9(6):339-349 (2014) | The abstract and secondary summaries: clarify expectations, a fiction contract, logistics, and a commitment to respect | GSN-05 |
| Kramer, Guillory and Hancock, *PNAS* (2014), with the editorial expression of concern | The editorial's text as reproduced in copies, and commentary | ETX-01, F-11 |
| Dittrich and Kenneally, "The Menlo Report: Ethical Principles Guiding Information and Communication Technology Research" (2012) | The abstract and bibliographic listings: built on the Belmont Report's principles; stakeholder identification, informed consent, balancing risks and benefits | ETX-01 |
| National Commission, The Belmont Report (1979) | Search summaries: respect for persons, beneficence, justice | ETX-01 |
| Seif El-Nasr and Kleinman, "Data-Driven Game Development: Ethical Considerations", FDG 2020 (arXiv 2006.10808) | The abstract: biased or incomplete data and opaque models as risks | ETX-02 |
| Hingston, "A Turing test for computer game bots", *IEEE TCIAIG* 1(3):169-186 (2009) | The abstract and a poster summary: a bot-vs-human judging test, hard to pass in 2008, first won in 2012 | PNL-03 |
| Vanden Abeele, Spiel, Nacke, Johnson and Gerling, "Development and validation of the player experience inventory", *IJHCS* 135:102370 (2020) | The abstract: two levels (functional and psychosocial), 64 experts, five studies, 529 participants | PNL-02 |
| Lakens, "Equivalence Tests: A Practical Primer for t Tests, Correlations, and Meta-Analyses", 2017 (DOI 10.1177/1948550617697177; the journal name was not shown on the page seen) | The abstract: a non-significant result is not evidence of absence; equivalence bounds set from the smallest effect of interest | STN-06, NUL-02 |
| Hayes and Krippendorff, "Answering the call for a standard reliability measure for coding data", *Communication Methods and Measures* 1(1):77-89 (2007) | The abstract: Krippendorff's alpha across observers, scales, sample sizes and missing data | PNL-06 |
| Nisbett and Wilson, "Telling more than we can know: verbal reports on mental processes", *Psychological Review* 84:231-259 (1977) | The abstract and secondary descriptions | STN-10 |
| Davis and Hillestad, "Families of Models that Cross Levels of Resolution", Winter Simulation Conference 1993 | A search summary: variable-resolution modelling; consistency across resolutions cited as a quality notion in later work | VLD-03 (comparison only, D-21) |
| Rahmandad and Sterman, "Heterogeneity and Network Structure in the Dynamics of Diffusion", *Management Science* 54(5):998-1014 (2008) | The abstract (see F-13) | VLD-04 (comparison only) |
| Brom, Šerý and Poch, "Simulation Level of Detail for Virtual Humans", IVA 2007, LNCS 4722:1-14 | The abstract and listings: simulation level of detail has had little attention; several degrees of detail; lessons learned | VLD-03 (comparison only) |
| Grinblat, "Procedurally Generating History in Caves of Qud", GDC 2018 | The GDC Vault description and a write-up: generate events first and rationalise them afterwards | VLD-05 (comparison only) |

### 3.3 Lens and map claims checked

| Claim | Result |
|---|---|
| Map EVA-01: Chhun, Colombo, Suchanek and Clavel | **Author order differs.** The arXiv page gives Chhun, Colombo, Clavel, Suchanek |
| Map LOD-02: Brom, "Šéry" and Poch | **Spelling differs.** The listings give Šerý |
| Map EVA-03: Klepek 2020, Vice, "Cyberpunk 2077 has an open world that invites you to ignore it" | **Date doubtful.** The search result places it in a series about games the writer played later, and it mentions a game released in 2022. I did not read it and use nothing from it |
| Map ETH-13: Kramer, Guillory and Hancock 2014 and the expression of concern | Confirmed from the editorial's text as reproduced in copies |
| Map ETH-13: Menlo Report 2012 | Confirmed; the authors are Dittrich and Kenneally. The four principles named in the listings I saw are not spelled out in them, so I do not list them |
| Lens L3 field 24: PXI has 30 items, 64 experts, five studies, 529 participants | Experts, studies and participants confirmed; I did not see the item count, so I do not use it |
| Lens L3 field 24: in 2012 judges could for the first time not tell the best bots from humans | Consistent with the poster summary (the grand prize needs a bot judged human over 50% of the time; first won in 2012) |
| Map SYS-01: Windrum, Fagiolo and Moneta 2007, *JASSS* 10(2), 8 | Confirmed |
| Map EVA-02: Wilson, Strange Loop 2014 | The conference page is titled 2014; one other source dates it 2015. Content not seen |
| Map LOD-03: Töpfer and Pillewizer 1966 | **Not verified.** Only a summary of a bibliographic page was found, with no journal or date. I use nothing from it |
| Map LOD-01: Davis and Bigelow 1998; Hunter, Mac Namee and Kelleher 2020 | Not retrieved. Not used |
| Lens L8 field 21: Purdy and colleagues 2018 | Not re-read; not used |

## 4. Principles

IDs: STN (stance), VLD (validating the simulation), DST (deterministic simulation testing and properties), PNL (panels), GSN (game sessions), TRS (early testers), ETX (ethics and data), NUL (reporting, including null results). Grades are P1 §4's. Scale codes follow dossier 8 (gl glance, en encounter, vg vignette, gg gig, ar arc, se season); "all" covers every scale. Layers follow [plan §2](../plan.md#2-the-system-at-first-level), with E for evaluation and T for tooling. "Operationalise" says whether a procedure could produce the property, check it, or neither.

### A. Stance: what evaluation is for

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| STN-01 | **No single quality score.** Judge each quality with its own instrument and report them side by side. Gates are conjunctions of per-criterion rules ("no worse than the control on A, B and C"), never a weighted sum | [empirical] for separate criteria (one benchmark proposes six orthogonal human criteria); [analysis] for the rest | Chhun and colleagues 2022 (abstract); dossier 6 TEL-14 and R-13 ("scores are ranks or bands that keep their feature values"). The kernel specification holds no tellability number at all: it keeps the mechanism and points to dossier 6 for that decision | all · E | **Check.** Reports are tables of criteria by arms with intervals, with no "overall" column (S23-P9-02). A report lint refuses one. As a design check, report the correlation between criteria in our own ratings: if two always move together, they are one criterion |
| STN-02 | **Automatic measures gate and regress; people decide.** An automatic proxy may block a merge. It may not declare a design good. Before any proxy gates, correlate it with panel ratings on our own content | [empirical] (metrics found weak against human criteria); [hypothesis] that ours will be too | Chhun and colleagues 2022. Instance: dossier 5 EV-7 (text homogeneity measures) and M18-16 (lint false-positive rates) are proxies that need that check | all · E, T | **Check.** A proxy-validation table in the results ledger: proxy, panel criterion, correlation, sample, date. A proxy without a row is advisory only (S23-P9-10) |
| STN-03 | **Name the kind of evidence in every result.** Offline model, transcript panel, in-game session and tester log are four kinds. A result from one is never reported as proof for another | Project rule ([plan §6](../plan.md#6-principles-at-every-level)); [practice] | Instance: M14-17 (a transcript panel on a week of events) says nothing about whether the in-game street reads as alive; GS-4 asks that | all · E | **Check.** Every result record has an `evidence` field with one of four values and a "does not show" line (NUL-01) |
| STN-04 | **Controls are part of the design.** Every comparison names its controls: engine off, random-within-gates, fixed schedule, a Radiant-style baseline generator, authored content, vanilla content, model off. A feature is credited only against a control that passed the same gates | [empirical], thin: the one reader test of generic tellability heuristics was a null, and its favourite story was the random control | Dossier 6 S-02 and T-3 ("keep a random-within-gates baseline running in tests, and report null results"); plan M3's "Radiant-style baseline" | all · 3, E | **Produce.** The arm library of §5.4, each arm a setting or a small generator, built once. **Check.** Every panel and survey plan lists its arms; a plan with no control is refused (S23-P9-03) |
| STN-05 | **Hold one stage fixed when testing another.** Test selection with the presenter fixed, and presentation with the selection fixed. Report a 2 by 2 when both matter | [empirical], one study | Dossier 6 SFT-12: the same events ranked third and last under two writers | en, gg, ar · 3, X, E | **Check.** The panel plan template has a "held fixed" field. Staging belongs to P8 and gets its own panel (P-J) |
| STN-06 | **Write the plan before the run.** The question, arms, sample, smallest effect of interest, decision rule and equivalence bounds are committed before data exist. Thresholds marked [J] in the dossiers become numbers here, once | [practice]; Lakens (abstract summary) for the equivalence part | Dossiers 11 and 12: "thresholds are written down before the run" | all · E | **Check.** The harness takes a plan file, hashes it, and stamps the hash on the result. A result without a plan hash prints as exploratory (S23-P9-01) |
| STN-07 | **Cheapest tier first; people only for what machines cannot answer.** Order: offline model, transcript panel, in-game session, testers. A question moves up only when the cheaper tier cannot answer it, or when it answered and the answer needs checking where the player is | [hypothesis] | The dossiers' testing agendas all share this order | all · E | **Produce.** The plan's gates (§5.8) put batteries ahead of panels ahead of sessions |
| STN-08 | **Each quality-bar statement has at least two kinds of instrument, or a stated reason why not.** Bars 8 to 10 (player-set mix, no perceivable cost, coexistence) are mostly offline and in-game, not panel items | [hypothesis] | [Plan §1](../plan.md#1-what-doesnt-suck-means); the table in §5.2 | all · E | **Check.** The bar-to-instrument table is a living file; a bar with one instrument is a finding |
| STN-09 | **Builders are not raters.** The people who built a generator judge it too kindly, and know too much. Their ratings are kept but reported apart; decisions rest on naive raters and players who know the game | [empirical], one study as reported in a lens; not re-read | Lens L8 field 21, from Lessard and colleagues (authors against evaluators) | all · E | **Check.** Rater strata recorded on every rating sheet; the report splits by stratum (PNL-01) |
| STN-10 | **Stated reasons are not evidence.** Behaviour logs and recognition tests with foils come first. Free-text reasons are collected, coded and reported, but no conclusion may rest on them alone | [empirical] (verbal reports often reflect theories, not access); dossier 13 CNF-01 | Nisbett and Wilson 1977 (abstract summary); dossier 13 S13-P9-16 | all · E | **Check.** An audit over result records: conclusions that cite only stated reasons: target zero |

### B. Validating the simulation

LOD-01 to LOD-03 are comparisons only (D-21). The engine's level-of-detail model is first-party; these sources can only cross-check how its agreement is tested.

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| VLD-01 | **A fictional city can only be valid for its purpose.** There is no real Night City to compare with. Validity splits into conceptual (are the mechanisms right for the purpose), verification (does the code do what the model says) and operational (is the output plausible to the people it is for). Each has its own test | [analysis] | Sargent 2013 (abstract summary); the map's SYS-01 note ("only plausibility to stakeholders applies") | all · 1, E | **Produce.** Each S1 process is described in the ODD order (purpose and patterns; entities and scales; scheduling; design concepts; initialisation; input; submodels) so a reader can reimplement it (VLD-08). **Check.** The three tests are named separately on each process's page |
| VLD-02 | **Declare several independent patterns the city must reproduce, before calibrating.** A model that matches several patterns at different scales is less likely to be right for the wrong reasons. The ODD protocol now puts the patterns used to evaluate the model into its first element | [analysis]; [practice] in ecology | Grimm and colleagues 2005 (abstract summary); ODD update 2020 (page read). Instance: dossiers 14 and 15 already list them: concentration of incidents (M14-01), near-repeat excess (M14-03), delay law (M14-08), network shape (M15-06), triadic closure by foci (M15-07) | all · 1, E | **Check.** The pattern register (S23-P9-05): ID, source, scale, band, tolerance, and whether it was used to calibrate. A pattern used to calibrate cannot be used to validate (VLD-09) |
| VLD-03 | **Every process declares which kind of agreement it owes.** Three kinds: **exact** (identity, determinism, regeneration, partition, reload), **count-exact** (a summary's count equals its items; canon items are kept), **distributional** (coarse and fine runs give the same pattern within a stated tolerance). The kind decides the test | [hypothesis]; multiresolution modelling treats consistency across resolutions as a quality notion (comparison only) | Davis and Hillestad 1993 (summary). Instance: F-7 (summary items nest across scopes) is count-exact; M14-20 (demand independence: two runs with V in different places give identical coarse histories) is exact; M14-11 (suppression outcomes) is distributional | all · 1, E | **Produce.** A `coarseFine` field in each S1 process registration (S23-S0-07). **Check.** The twin-run harness reads it and picks the test |
| VLD-04 | **Test coarse against fine by twin runs over many worlds, comparing distributions.** Run one world seed with V at two vantage points, or at two detail settings, and compare the derived quantities. A single pair of runs says little: differences in means can be small against the variability from stochastic events, parameters and model boundary | [analysis]; comparison only | Rahmandad and Sterman 2008 (abstract summary). Instance: district totals from tier-0 only against totals from materialising every tier-2 item (M14-16) | all · 1, E | **Check.** `twin` in the harness: world seeds by vantage pairs (at least 20 seeds, as in dossiers 14 and 15), the contract from VLD-03, an interval on the difference (S23-P9-06, S23-P10-04) |
| VLD-05 | **Elaboration must agree with the abstract past.** Detail made when V looks closer, and causes constructed afterwards, must fit what was already settled. Retroactive history is a way to avoid a full simulation; here it is allowed only inside what the record leaves open | [analysis]; comparison only | Grinblat 2018 (description): events generated, then rationalised. Engine rules: SF-26 and SF-44 (a constructed cause is pinned at display; one that would contradict a confirmed event is refused); dossier 10 M10-12 (constructed share low; contradictions zero) | all · 1, 3, E | **Check.** Property: for random sessions, every constructed cause leaves the coarse record unchanged and contradicts no earlier exposure (S23-S2-07, S23-S0-06) |
| VLD-06 | **Partition independence and reload identity are exact, and are tested with random partitions and random reload points.** Any split of a run into ticks, and any save and load at any boundary, give identical records | Kernel invariant I-15 and S2-I-6; [practice] for the test method | S0 F-13, F-21, F-22, F-25; measures M14-10, M14-22, M15-03, M11-01, M16-06, M22-02. The existing fixtures test 1 against 12 ticks | all · 1, 2, E | **Check.** Generated op scripts with random partitions and reload points (S23-S0-03). One battery serves all those measures (B2, §5.3) |
| VLD-07 | **Regeneration is exact.** A forgotten locality resolves identically while its constraints and contributions are unchanged. Test by forgetting at random times in random sessions and comparing with a twin that never forgot | Kernel invariants I-3 and I-13; [practice] | S0 §7 (open, close, forget); F-18 to F-20 for beliefs | all · 1, E | **Check.** S23-S0-04. Silence (I-13) is part of it: resolution, regeneration and replay produce no changes and no relevance |
| VLD-08 | **Dock the implementations, and reimplement from the text.** The reference model is the oracle (D-06). A native core must agree with it on everything the reference implements. Separately, have someone who has not seen the code implement one S1 process from its written specification alone, and compare: the differences are specification gaps | [practice] for docking as a test of whether two models give the same results (abstract summary); [hypothesis] for the spec-only reimplementation | Axtell and colleagues 1996 (abstract summary: aligning two different models); ODD update 2020 (page read: descriptions "often too incomplete to reimplement"); the reference model's 57 notes, adopted as S0 §19, are of this kind | all · 1, T | **Check.** Digest, primitive vectors and per-script golden traces (S23-S0-11); one spec-only reimplementation per S1 process, with its disagreements filed as specification issues |
| VLD-09 | **Sweep the judgement constants before tuning them, and keep calibration data apart from validation data.** Many dossiers mark starting values [J]. Vary each across its band and report which outputs move. Calibrate on some seeds and districts, validate on others | [practice]; validation methods differ and the choice matters (abstract read) | Windrum and colleagues 2007 (indirect calibration, empirical calibration and the history-friendly approach are named in the abstract); Rahmandad and Sterman 2008 (parameter uncertainty) | all · 1, 3, E | **Check.** `sweep` in the harness; seed lists split into calibration and validation sets recorded in the plan (S23-P9-07, S23-P9-27) |
| VLD-10 | **Believability is judged by people, and offline statistics give necessary conditions only.** A city whose incidents concentrate like real ones can still read as dead or frantic. Pair every pattern battery with a transcript panel and, later, a game session | [practice] | Dossier 14 M14-17 (panel on felt causality and "not nothing"); dossier 15 P15-01; a judging test for bots as a model of the method (Hingston 2009, summary) | all · 1, E | **Check.** Panel P-C (§5.5). The result decides whether the later simulation phases (dossier 14 phases 2 and 3, dossier 15 phases 2 and 3) are needed at all |
| VLD-11 | **Run it long, and look for runaways.** Stocks that diverge or stick at zero, wars that never end, record growth without bound, lock-in of police presence | [hypothesis]; dossier measures | M14-07, M14-12, M14-15, M18-04 (a hundred game-years), M11-12 | all · 1, E | **Check.** B6 and B12 (§5.3): a soak run of 100 game-years on 20 seeds under the memory guard, with growth curves and a pass band (S23-S0-12) |

### C. Deterministic simulation testing, properties and branching content

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DST-01 | **Everything reproduces from one small file.** World seed, pack hashes, operation script, settings vector and session inputs are enough to replay any failure byte for byte. Debug a replay, not a play session | [practice]; the talk itself was not seen | Wilson 2014 (listing only). The engine already has the ingredients (S0 I-1, S2-I-1); dossier 16 S16-P10-06 specifies the bundle | all · T, E | **Produce.** Repro bundles (S23-P10-03). **Check.** Replay identity: M16-06 |
| DST-02 | **State the properties and generate the inputs.** Write each invariant as a function that must hold for any generated input. Keep fixed fixtures for the cases a person can name, properties for the rest | [practice] | Claessen and Hughes 2000 (abstract summary). Instance: I-1 to I-16, S2-I-1 to S2-I-16 | all · 1, 2, E | **Check.** S23-S0-02 and S23-S2-04 (generators of op scripts and of seed documents) |
| DST-03 | **Shrink failures to the smallest script that still fails.** Reduce the sequence of generator choices, so reduced cases stay valid. Our generators draw from named, hashed streams, so reduction by choice sequence is natural | [practice] (an internal reducer in a widely used library); [hypothesis] that it fits our generators | MacIver and Donaldson 2020 (abstract summary) | all · T | **Produce.** The shrinker in the property library (S23-P10-02) |
| DST-04 | **Where there is no oracle, test relations.** Transform the input and check how the output must change: add an unrelated node; rename ids; permute independent operations inside a window; scale every weight; raise a settings lens; swap the renderer for a stub | [practice]; survey of the method (abstract summary) | Segura and colleagues 2016. Instances: I-7 (coupled draws), F-5, F-20, M22-01 (structural invariance with the model off, on, or a different stub), SF-30 | all · 1, 2, E | **Produce.** A relation library (S23-S0-05, S23-S2-09). **Check.** Each relation names its transformation and its expected change |
| DST-05 | **Inject faults on purpose.** Truncated or damaged saves, a killed preparation, a refused operation, a stale epoch, a time jump, a missing capability, a port that answers late, a hard limit overrun. Assert that nothing is lost silently | [practice] | S2-I-5; SF-15, SF-23, SF-24; F-12; M18-01 (fault injection with the age field removed); dossier 11 T11-07 (load classes) | all · 1, 2, E | **Check.** S23-S0-08, S23-S0-09, S23-S2-07 |
| DST-06 | **Sweep the crash points.** Save and load between every pair of adjacent steps of a scripted seed, and compare the end state with the uninterrupted run | [hypothesis]; cheap because the engine is deterministic | Generalises SF-9 and F-22 | gg, ar · 2, E | **Check.** S23-S2-03: R1 and one scripted seed per profile |
| DST-07 | **Sample branching content with random players, and read the hit counts.** Thousands of runs with random choices, a log of the exact choices that reproduce each failure, and a count of how often each element is reached. Exhaustive passes (every option, both sides of every condition) come first. Neither replaces playing | [practice] (read) | Choice of Games: randomtest at 10,000 runs or more, deterministic for a seed; elements hit about 100 times in 10,000 are very difficult, about 10 exceedingly rare; the "avoid used options" mode can miss repeated-choice bugs; infinite loops give no error | gg, ar · 2, E | **Produce.** `survey` over seeds, exits and variants (S2 §11.2; S16-P10-05). **Check.** A timeout on every run; a repeat-choice policy among the synthetic players (DST-10) |
| DST-08 | **Unreached is not dead.** An element nobody reached is reported with its reach and the reason it may be unreachable; it is never deleted by a tool. A finding the author knows cannot happen can be waived, and the waiver is logged | [practice] (read) | Choice of Games: zero hits do not prove dead code; quicktest can report cases that cannot occur and reach code a human cannot | gg, ar · 2, 4, T | **Produce.** Findings carry a code, a place and a waiver field (M16-02) |
| DST-09 | **Test the tester.** Plant known faults and require the harness to find them: a dead beat, a narrow `must`, a stuck seed, a swapped agent, a negation, a minor in a barred role. A harness that cannot catch a planted fault is not evidence | [practice] | M16-07, M16-03, M22-06 (mutation test of the text gates), M18-01 | all · E, T | **Produce.** A fault-seeding tool (S23-P10-16). **Check.** Detection rate per fault class, reported with every harness release |
| DST-10 | **Synthetic players give structural evidence, never enjoyment.** Policies such as decline-everything, accept-everything, farm-the-offers, maximise-return, play-off-plan and the closed audience-script list test invariants and gaming. They say nothing about whether a person would like the result | [hypothesis]; the lens lists simulated players as a known limit of this field | M12-17, D7 M-14, D5 EV-16, D9 M-11, M20-11 | all · E | **Produce.** One library of named policies (S23-P10-05). **Check.** A result from a synthetic player carries the label "structural" (STN-03) |
| DST-11 | **Budgets are tests, and a changed output is a diff to be read.** Tick cost, record growth, start-up and frame time run as assertions in the same harness. Every report is diffable between versions; a change in the structural hash of the fixed survey set needs a person's acknowledgement | [practice]; project goal (load time is a standing research target) | M14-23, M16-01, M11-12, M22-07, M22-08, M22-11; dossier 16 M16-08 (pack diff) | all · T | **Produce.** A budgets file shared with P7 and a golden set of survey hashes (S23-P9-20) |

### D. Human panels

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| PNL-01 | **Blind, within-subject, counterbalanced, with named rater strata.** Raters see no label of origin. Order is balanced. Strata: naive readers, players who know the game, sensitivity readers, authors. Decisions rest on the first two | [practice]; the dossiers agree | Dossiers 11 (T11-09 to T11-13), 12, 13, 17, 21 | all · E | **Check.** The panel plan template (S23-P9-12) |
| PNL-02 | **Use pairwise or forced-choice judgements for comparative qualities, and validated instruments for experience where one exists.** Relevance, stakes and expectation are comparative. A player-experience inventory exists (two levels, built with 64 experts and checked in five studies); use it as a supporting instrument, not as the plan | [analysis] for pairwise (TEL-14); [empirical] for the inventory's validation (summary) | Dossier 6 TEL-14; Vanden Abeele and colleagues 2020 | all · E | **Produce.** Rating sheets with pairs and, where a question maps to one, items from the inventory (S23-P10-12) |
| PNL-03 | **"Authored or generated?" is the headline instrument for "feels generated".** Per content type (gig brief, encounter, line, news item, bark), a blind guess plus "what gave it away?". The target is chance, with the cues fed back to P4 and P5 | [practice]; I found no study that does this for generated quest content | Lens L3 field 24; dossier 5 EV-9; dossier 21 M21-01 (sort test); dossier 17 M17-03; dossier 22 M22-05; the bot-judging test as a precedent (Hingston 2009, summary) | all · 3, X, E | **Check.** Panel P-A. Detection rate by type, with intervals; cues coded |
| PNL-04 | **Free report first, then probes; recognition with foils.** Ask "anything odd?" before any probe. A recognition result without foils is invalid. Report hit rate, false-alarm rate and d-prime | [practice]; dossier 13 | Dossier 11 §12.2; dossier 13 M13-04, S13-P9-06 | all · E | **Check.** Rating sheet order is fixed by the template; the scorer refuses a recognition item with no foil |
| PNL-05 | **Rate criteria separately from a fixed sheet.** The sheet (§5.5) has one item per quality. A new item needs a reason and a pilot | [empirical] for separate criteria (STN-01); [hypothesis] for our list | Plan §1; Chhun and colleagues 2022 | all · E | **Produce.** The criteria sheet (S23-P9-02) |
| PNL-06 | **Report agreement; do not assume it.** Use Krippendorff's alpha (it handles many raters, scale types and missing data), with a bootstrap interval. Low agreement means the item or the criterion is poorly defined, not that raters are wrong | [practice] (abstract summary) | Hayes and Krippendorff 2007 | all · E | **Check.** The scorer prints alpha per item; an item below the plan's floor is reported but left out of decisions |
| PNL-07 | **Small samples are exploratory.** Run a pilot (about 10) to check floors, ceilings and agreement, then the decision run. Report effect sizes with intervals and call small runs exploratory | [practice] | Dossier 10 ("a pilot sets the effect size"); dossier 11 (20 to 30 per panel [J]); dossier 12 (30 or more per cell [J]) | all · E | **Check.** §5.5 gives starting sizes. They are not power calculations; each plan sets its own from the smallest effect of interest |
| PNL-08 | **Present the engine's own wording, and say which layer is under test.** Transcripts show text and order, not timing, staging or sound. A transcript result transfers to the game only as a hypothesis that a session checks | [practice] | Dossier 11 §12.2; dossier 6 SFT-12; staging has its own panels on stills and clips (dossier 20) | all · X, E | **Produce.** Stimulus export from the ledger (S23-P10-12) |
| PNL-09 | **Keep an anchor set.** A fixed bank of stimuli (generated, authored, vanilla, control) reused across versions, so a change in ratings can be told from a change in stimuli | [hypothesis] | EV-17 (repeat the sorting test when the axes change) | all · E | **Produce.** A versioned anchor bank per content type, refreshed on a schedule and never silently |
| PNL-10 | **Always include the random-within-gates arm and an authored or vanilla anchor.** Without the first, a feature cannot be credited. Without the second, "good" has no scale. The Radiant-style baseline is a defined generator, not a vague idea | [practice]; plan M3 | Plan M3 ("beat a Radiant-style baseline, judged blind"); dossier 4 QST-25 (rate the 73 base gigs blind on named criteria, with line and choice counts withheld) | gg, ar · 3, E | **Produce.** The baseline generator (arm A3, §5.4): same world, same slots, no cause chain, no sifting |
| PNL-11 | **Ablate.** Switch each feature off in turn and keep it only if its removal is worse than the equivalence bound. If removal makes no difference worth the cost, take the simpler design | [practice] | Dossier 6 R-25(c); dossier 11 T11-10 (a hard time-out against a power law: if they match, use the simpler) | all · 3, E | **Check.** Every feature graded [hypothesis] ships with an off switch and an ablation entry in the plan |

### E. Prepared in-game sessions

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| GSN-01 | **The maintainer runs the game; agents never do.** A session is a booking: game time reserved on the board, the diagnostic profile, one session at a time, catalogue commands only, every safety rule standing | Project rule; [D-12](../decisions.md) | AGENTS.md; D-12; the cards' `C` and `M` roles | all · E | **Produce.** The common frame in §6.1 |
| GSN-02 | **Batch the questions, order the rows, keep waits short.** One booking answers many rows. Rows that need saves come before rows that load them. No single wait runs long | [practice]; the dossiers' cards | Dossier 14, 15 and 20 cards: "batch these into one session" | all · E | **Check.** The session runner times each row against a budget (S23-P10-10) |
| GSN-03 | **Every row has who, do, expect, if-not, evidence, and the decision it feeds.** The "if not" says which design item moves. A row with no decision attached is dropped | [practice] | The save-identity, event and staging cards use who / do / expect / if-not. The last two columns are added here | all · E | **Produce.** Cards are data (S23-P10-10) |
| GSN-04 | **Fidelity means the same decisions and consequences, not polish.** A staged scene is good enough for a session if it demands the same reading and action as the real setting. Use the test profile, throwaway scripts and plain stand-ins | [empirical], thin: higher physical resemblance did not by itself improve effectiveness in one field (abstract summary) | Hamstra and colleagues 2014. Instance: dossier 20's rows use cloned casts and throwaway props; the question is whether the residue reads | all · 4, X, E | **Check.** Each staged row states what decision or reading it must preserve |
| GSN-05 | **Brief before, debrief after.** Say what the rows are for, what is staged, what will not happen (nothing is saved unless asked) and when to stop. Close with a short debrief: what felt wrong, what was slow, what would help | [practice] (abstract and secondary summaries) | Rudolph and colleagues 2014: expectations, a fiction contract, logistics, commitment to respect | all · E | **Produce.** Each card opens with a brief and ends with the debrief questions of §6.1 |
| GSN-06 | **Dry-run every card on the offline simulated port before booking.** The port mirrors the bridge's catalogue (D-18). A dry run finds missing capabilities, wrong row order and unreadable expectations at no cost to the maintainer | [hypothesis] | D-18; dossier 20 §11.3 | all · T, E | **Check.** The runner has a `--simulated` mode (S23-P10-10). A card that has not dry-run is not offered |
| GSN-07 | **Calibration sessions and acceptance sessions differ.** Calibration sessions supply inputs the engine lacks (a time ratio, crowd counts, noticing distances). They cannot fail. Acceptance sessions test a built thing against a checklist and can | [hypothesis] | M4 is "one prepared session passes its checklist"; dossier 13 §11.3 calibrates tests | all · E | **Produce.** §6.2 labels each session C or A |
| GSN-08 | **Evidence is versioned and stays local.** Engine build, bridge version, profile, pack hashes, save list and world seed are recorded; traces hold save names and locations, so they are never published | [D-18](../decisions.md) | D-18; dossier 22 M22-12 (no save names in briefs) | all · T | **Produce.** The session manifest (§6.1) and `local/sessions/` |
| GSN-09 | **Ask, never tell, and stop on any comment.** Rows ask what the player remembers or sees; they do not describe story content. The friction log runs through every session and becomes queued work afterwards | Project rule; [practice] | The friction-log rule; the cards' stop conditions ("any in-game comment from the player") | all · E | **Produce.** A write-up template that turns the log, the failed rows and the nulls into the work queue and knowledge-page edits (S23-P9-15) |

### F. Early testers

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| TRS-01 | **Tester logs are opt-in, local and counts-only by default.** Nothing leaves the machine unless the tester sends it, after seeing what it holds | [practice]; dossiers 11, 12, 20 | Dossier 11 T11-20; dossier 12 PRV; dossier 20 §11.4 | all · E, T | **Produce.** The exporter shows its contents and strips paths and save names (S23-P10-14) |
| TRS-02 | **Ask about experience at natural joints; never prompt at the moment of the behaviour.** Do not ask about a reload as it happens. Interview afterwards, in the player's words | [practice] | Dossier 11 T11-21 | all · E | **Produce.** Prompts are tied to session ends and returns, not to events |
| TRS-03 | **Short diaries and a weekly three-question check.** A line per return (gap, what they remembered, what helped) and a weekly check on trust, fairness and feeling watched. Keep them light enough to continue | [hypothesis]; dossiers propose these | Dossier 11 T11-20; dossier 12 §11.4 | all · E | **Produce.** The tester package of §5.6 |
| TRS-04 | **Tester data never feeds a rule.** Nothing a tester logs or says is an input to the director, the scorer or any hook | [D-09](../decisions.md); dossier 13 S13-P9-19 | The audit that none of the measures is a term in the director's objective | all · E, 3 | **Check.** A static read-set audit (S23-P9-19), part of battery B3 |
| TRS-05 | **Testers compare notes.** Uniqueness per player is lost once players talk. Test the pooled population: how many players' streams contain each mined template | [shipped]: a Fallout 4 quest pattern was named in forums within a week | Know Your Meme (page read); dossier 5 VAR-30, EV-15, M-19 | all · 3, E | **Check.** B8 pooled run offline; at the tester stage, include testers who are isolated and testers who are pooled |
| TRS-06 | **The community is a cheap detector of defects, not a source of conclusions.** Template-naming, memes and complaint threads show what repeats. Use public, aggregated signals; no personal data | [shipped] (one case read) | Know Your Meme entry on the Fallout 4 pattern; the map's EVA-03 | all · E | **Produce.** A small watch for template-naming after public release (S23-P9-24) |
| TRS-07 | **A one-key "this felt wrong" marker.** The tester presses it; the session ledger stores the last minute of record excerpt (counts and ids, not text from saves) and the tester may add a line | [hypothesis] | An extension of the friction log to testers; the bridge's `session_note` marker is the same shape | all · T, E | **Produce.** An in-game marker, tester-initiated only (S23-P10-14) |

### G. Ethics and data

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| ETX-01 | **Varying what players see to change their behaviour is a human-subjects experiment.** It needs informed consent before, not terms of service; a debrief after; and extra care where an arm deceives. Dossier 12's fourth arm (told the game adapts, when it does not) is such a case | [analysis]; the editorial expression of concern is a documented case | Kramer, Guillory and Hancock 2014 and the editorial; the Menlo Report's adaptation of the Belmont principles (respect for persons, beneficence, justice); dossier 12 T12-05 | all · E | **Check.** The ethics checklist (S23-P9-18): who sees what, consent text, opt-out, debrief, what is deceived and why, how data are kept |
| ETX-02 | **Raw perception data exist for evaluation only, and layer 2 never sees them.** Gaze, camera, speed and dwell values stay in the local session ledger. Layer 2 sees grades | Project design (S13-S2-02); [analysis] | Dossier 13 S13-P9-01; Seif El-Nasr and Kleinman 2020 (abstract: opaque models and biased data erode trust) | all · E, 2 | **Check.** A static audit that no layer-2 path stores a raw value (dossier 13 §11.1) |
| ETX-03 | **No retention proxy is a term in anything the director reads.** Quit phase, return rate and time played are measured for evaluation and kept out of every objective | Project rule (dossier 13 S13-P9-19; dossier 17 S17-P9-04); [hypothesis] on the harm | M8-13 (quit phase) is a P9 measure that must never feed pacing | all · 3, E | **Check.** B3 audit: zero such terms |
| ETX-04 | **Stimuli stay inside the floors and the player's ceilings.** Panels of representation and tone use descriptions, not scenes, and every stimulus records its content settings. No participant sees anything over the floors; the floor checks themselves (M18-01) are static and generated, with no human rater | Project rule (dossier 18); [practice] | Dossier 18 REP-07 (fifty generated descriptions to a reader panel); M18-01 | all · 4, E | **Check.** Stimulus records carry the settings vector; content notices on every panel invitation |
| ETX-05 | **Share nothing that holds a save name, a path or a location.** Session traces are replayed offline and never published; tester exports are redacted; knowledge-page edits cite counts and rows, not traces | [D-18](../decisions.md) | D-18 | all · T | **Check.** A redaction scan before any export leaves `local/` |

### H. Reporting and null results

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| NUL-01 | **Every run ends in a result record.** Question, plan hash, evidence kind, arms, sample, result with interval, verdict, what it does not show, and what it moves. Distributions across sessions, not only means | [practice] | Dossier 13 M13-01 ("report the distribution across sessions, not the mean") | all · E, T | **Produce.** The results ledger (S23-P10-15) |
| NUL-02 | **"Equivalent" is a verdict with bounds fixed before the run.** A non-significant difference is not evidence of no difference. Use equivalence bounds set from the smallest effect of interest | [analysis] (abstract summary) | Lakens 2017 | all · E | **Check.** The plan's bounds register (S23-P9-14). Instance: T11-10, where a hard time-out that matches the power law in ratings means the simpler rule wins |
| NUL-03 | **"Inconclusive" is a verdict.** It is followed by a larger sample, a better instrument or a dropped question, never by re-analysis until something is significant. Exploratory analyses are labelled | [practice] | Dossiers 10 and 11 ("call the result exploratory") | all · E | **Check.** Analyses beyond the plan are listed as exploratory in the record |
| NUL-04 | **A null changes the design, and is published with the positives.** A refuted or equivalent result demotes a feature to logging, removes it, or replaces it with the simpler rule, and the knowledge base records it with its limits | [practice]; project rule on distilling findings | Dossier 6 T-3 ("ship the ranking as a logged hypothesis ... report null results") | all · 3, E | **Produce.** A results-to-knowledge draft generator (S23-P10-15) |

## 5. The evaluation plan

This is the plan P9 builds from. It has four tiers, a library of control arms, a fixed criteria sheet, and gates by milestone. Measure IDs are the dossiers' own; "D7 M-12" means measure M-12 of dossier 7, since dossiers 5, 7 and 9 number theirs from M-1.

### 5.1 The four tiers

| Tier | Where | Who runs it | Answers | Cost | Evidence kind (STN-03) |
|---|---|---|---|---|---|
| **1. Offline, on the reference model** | The TypeScript reference model, the author tools, the offline simulated port | Agents, under the memory guard | Does the engine do what the specifications say, always? Does the simulation reproduce its declared patterns? What does a seed do across many worlds? | Days, no people | Offline model |
| **2. Transcript panels** | Text, stills and clips from the prototype, rated away from the game | Agents prepare; people rate | Does it read as caused, relevant, varied, in-setting, human-written? Does a feature beat its control? | A prototype (M3) and consenting raters | Transcript panel |
| **3. Prepared in-game sessions** | The game, in the diagnostic profile, through the bridge | The maintainer plays; agents read the log and ask | What does the game do that we assumed? Does the built thing work, read and cost nothing in the game? | One booking each | In-game session |
| **4. Early testers** | Testers' own machines and setups | Testers; agents read their opt-in local logs and diaries | Does it hold up over weeks, on other setups, with players who talk to each other? | The first public build | Tester log |

Order and gating follow STN-07. A question is asked at the lowest tier that can answer it.

### 5.2 The quality bar, statement by statement

Plan §1 lists ten statements. Each gets at least two kinds of instrument (STN-08).

| Bar | Offline (tier 1) | Panel (tier 2) | Session (tier 3) | Testers (tier 4) |
|---|---|---|---|---|
| 1. Causality | B5: M10-01, M10-12, M10-13, M14-02, M14-24, D9 M-14; B7 | P-C: "seemed caused", naming the cause; M10-14 trace arms | GS-9: staged residue true to the record (M20-01 in game) | Cause at payoff over weeks (M13-06) |
| 2. Relevance | B10: relevance features logged; TEL-01 check (score one chain for two Vs) | P-D (retell, "worth telling"), P-F (noticed or watched) | GS-12: callbacks to V's own acts | Recall of specific-act lines at a week (M13-15) |
| 3. Legibility | B5, B8: every `mustReach` has a confirmed route (M13-02) | P-E recognition and recall; P-J reconstruct from residue; D9 M-4 foreseeability | GS-8 noticing, GS-9 readable staging | Retrievable-thread counts across gaps |
| 4. Agency | B3 option invariance, outcome independence (M12-01, M12-03); B14 two-policy replay (D9 M-2), off-plan moves (D9 M-11), decline audit (D9 M-1) | P-C attribution (D9 M-3); perceived-agency scale paired with M-2 (D9 M-5) | GS-12: choices change outcomes the world remembers | "Did my choices matter?" in the weekly check |
| 5. Perceptible variety | B9: skeleton diversity after masking, learner bits, template miner, dead and hot units (D5 M-3, M-14, M-16, M-17) | P-A, P-B: authored-or-generated, free sorting | GS-9, GS-12: repeat detection in play | Habituation curves (M13-08); pooled templates (D5 M-19) |
| 6. Setting fidelity | B11 lints (L-77 to L-92 class); lexicon false-positive rates (M17-16) | P-I: predict the faction, ordinary-person cost, blind rank against vanilla gigs by scale | GS-4 (what the street looks like), GS-6 (text channels) | "Does this feel like Night City?" in the diary |
| 7. Pacing | B8: burst, forbidden deliveries, waits, phase statistics (D7 M-1 to M-5, M8-01 to M8-08) | P-K: director against fixed schedule against random release (D7 M-12); rest effect (D7 M-9) | GS-10: first push after a load (M8-12) | Dead city or spam, in diaries; quit phase for P9 only (M8-13) |
| 8. The player sets the mix | B4: settings matrix (M18-03, M18-04), SF-11 tempo off, SF-30 settings are lenses, SF-37 model off. M3 test: fit report of the authored seed with sowing off equals the one with sowing on (S23-S2-10) | Setting comprehension (M11-14) | GS-13: dials do what the page says | Which dials are used |
| 9. No perceivable cost | B13: tick cost, record growth, start-up, soak (M14-23, M11-12, M22-07) | None | GS-11: frame time, start-up, memory with the game | Start-up and hitch reports |
| 10. Coexistence | B1 and B4 (nothing breaks vanilla content in the model); reservation checks | None | GS-12: a vanilla quest chain with the engine on; kill switch restores everything | Other setups: the beta's "works about 99 % of the time" check |

### 5.3 Tier 1: batteries on the reference model

Each battery is a named group of merged measures (§7 maps the 276 measures onto 30 groups; the batteries run those groups). Batteries run under `python tools/memory_guard.py`, with the smallest limit that fits. Targets that dossiers marked [J] are fixed in each run's plan (STN-06).

| Battery | What it runs | Source measures and tests | Pass rule | When |
|---|---|---|---|---|
| **B1 Kernel conformance** | Acceptance fixtures, calibration fixtures, invariants, primitive vectors, the determinism digest | S0 F-1 to F-25, C-a to C-d, I-1 to I-16; reference README (F-1 to F-15 and I-1 to I-15 present) | All pass. The digest changes only with an acknowledged record | Every change |
| **B2 Determinism, partition and reload identity** | One battery for every "same inputs, same record" claim, with random partitions and reload points | M11-01, M11-02, M11-10, D7 M-8, D7 M-16, D9 M-10, M14-10, M14-22, M15-03, M15-04, M16-06, M22-01, M22-02; SF-9, SF-27; S2-I-11, S2-I-12 | Zero differences | Every change |
| **B3 Firewall, read-set and forbidden-input audits** | Static read-set audits and perturbation tests: what the model, settings, grades and raw values can reach | M12-01 to M12-04, M12-11 to M12-13, M12-15, M12-16; SF-32 to SF-37; M22-12; S13-P9-19; S17-P9-04; M13-16; M9 reproach lint (D9 M-9) | Zero violations | Every change |
| **B4 Floors, ceilings and safety** | Minors and barred roles (static reachability plus a fuzz of a million draws), ceiling breach over the settings matrix, lines over a hundred game-years, retract, flash, licence and pack checks | M18-01 to M18-05, M18-11 to M18-15, M18-17, M18-18, M22-14, M21-13, M17-17; dossier 19 T-01 to T-09 | Zero | Every change to packs, lints or content settings |
| **B5 Record integrity and explanation** | Every cause exists; every offer has a trace; no orphan staged element; no claim without a citation; answers agree with the record | D9 M-1, M-8, M-12, M-14; M10-01, M10-02, M10-12, M10-13; M14-02, M14-08, M14-24; M20-02, M20-09, M20-15, M20-16; D6 R-24 | 100 per cent or zero as each measure states | Every change |
| **B6 Simulation patterns (S1)** | The pattern register run across seeds: concentration, near-repeat, delay law, clusters, network shape, closure, norms, reputation, hazards, stocks and wars | M14-01, -03 to -07, -09, -11 to -15, -18, -19, -21; M15-01, -02, -05 to -14, -17 to -23, -25 to -28 | Within the register's bands over at least 20 calibration seeds, then confirmed on separate validation seeds | Per S1 process, then weekly |
| **B7 Coarse against fine** | Twin runs; summary and item agreement; demand independence; jump against tick | M14-16, M14-20, M14-14, M15-18, M11-10; F-7; new twin runs (S23-P9-06) | Exact and count-exact: zero differences. Distributional: inside tolerance, with interval | Per S1 process |
| **B8 Pacing, delivery and threads** | The arbiter and director over synthetic sessions: bursts, forbidden deliveries, waits, expiry, phases, thread occupancy, debt, intervals | D7 M-1 to M-5, M-10, M-11, M-15; M8-01 to M8-08, M8-12; M13-14 (offline half) | Within the plan's bands; forbidden deliveries zero | Per S3 change |
| **B9 Variety and streams** | Stream statistics, skeleton diversity after masking, learner bots, template miner, dead and hot units, expressive range, session-length curves, pooled templates | D5 M-3 to M-19 and EV-2 to EV-7, EV-10 to EV-15 | Against the authored baseline (EV-6), not an absolute | Per content change |
| **B10 Sifting and offers** | Offer logs: features, rivals, why it won, found or constructed causes; shares by pattern and kind; escalation detector; influence caps | D6 R-24 to R-26, SFT-13; M10-16; M12-04 | Logged and bounded. Whether the features help is a panel question (P-D) | Per S3 change |
| **B11 Text layer** | Stub renderer, structural invariance, gate detection by mutation, provenance coverage, brief audit, repeat rates, translation readiness, lexicon hits | M21-02, -04, -06, -07, -10 to -12, -14, -15; M22-01, -03, -06 to -10, -12 | Equal structural hashes; detection near 100 per cent for deterministic faults | Per text change |
| **B12 Authoring tool and lints** | Check latency, finding completeness, source-map coverage, round trip, pack diff, isolation; every lint has a positive and a negative fixture; lint false positives on the game's own text | M16-01 to M16-09, M16-11; M17-16; M18-16; S23-S2-01 | As each states; the lint coverage report lists any lint with no fixture | Per tool change |
| **B13 Budgets and soak** | Tick cost, record growth, start-up, render calls, a hundred-game-year soak | M14-23, M11-12, M22-07, M22-08, M16-01; M8-12 (model half) | Inside P7's budgets; no runaway | Weekly, and before a session |
| **B14 Adversaries and synthetic players** | Named policies against the invariants: decline all, accept all, farm offers, maximise return, off-plan acts, clue loss, audience scripts, do-nothing V | M12-17; D7 M-14; D5 EV-16; D9 M-2, M-7, M-11, M-13; M20-10, M20-11 | Nothing gains; no soft-lock | Per composite change |

### 5.4 The arm library

Built once, used by every plan (STN-04). Arms A1 to A3 are the ones M3 needs.

| Arm | What it is | Used for | Built by |
|---|---|---|---|
| **A0 Engine off** | The game's own content only | Pacing headroom (D7 M-15), vanilla noticing priors | Nothing to build |
| **A1 Random-within-gates** | Same eligibility, tone, floor and cause gates as the engine; random choice among what passes | Every selection feature (STN-04, PNL-11) | S3 setting (S23-P9-03) |
| **A2 Fixed schedule and random release** | A deterministic rhythm and a random-release arm on the same seeds | The director (D7 M-12) | S3 setting |
| **A3 Radiant-style baseline** | A generator of the shipped pattern of template-and-slot jobs: a random eligible template, slots filled from the nearest eligible people and places, a reward; no cause chain, no history. It is defined by us as a stand-in for that pattern, not as a copy of any one game's system | M3's blind comparison; panel P-A and P-D | WP-17 |
| **A4 Authored** | The packs' own seeds, played with sowing off | Anchor; the fit-service test | Content packs |
| **A5 Vanilla** | The game's own gigs, quests and encounters, as descriptions and, later, play | Setting fidelity ranking (M17-03); corpus rating protocol (QST-25) | P2's corpus (D-24) |
| **A6 Model off, stub, second stub, tape** | Rendering without a model, with a stub, with another stub, with a recorded output | Structural invariance (M22-01) | S7 |
| **A7 Memory baselines** | Perfect recall; hard time-out; power law with marked half-memory; silent loss | T11-10 | S1 memory policy |
| **A8 Explanation arms** | No trace; world trace; narrated hint; after-the-fact why-trace; pull against push | M10-14, M20-12, M20-13 | S3, P8 |
| **A9 Disclosure arms** | Told at start; page shown at end; never shown; told but not adapted (a deceptive arm; ETX-01) | T12-05 | S3; ethics checklist first |
| **A10 Synthetic V policies** | The named policies of DST-10 | Tier 1 only | P10 |

### 5.5 Tier 2: transcript panels

**The criteria sheet.** One item per quality, rated separately and never added (STN-01, PNL-05). Items start as pairs or forced choices where the question is comparative, and as seven-point scales where it is an experience.

| # | Criterion | Asked as | Bar |
|---|---|---|---|
| C1 | **Seemed caused** | "Did this happen for a reason? Name it." Reasons are coded against the record | 1 |
| C2 | **Anything come of anything** | "Did what happened lead to anything?" | 1, 4 |
| C3 | **Fits this player's history** | Pair: which fits this record better? (the record is shown) | 2 |
| C4 | **Legible** | "What is going on? What could you do?" Coded against the record | 3 |
| C5 | **Foreseeable and fair** | "What do you expect each option leads to?" Compared with the outcomes (D9 M-4) | 4 |
| C6 | **Felt agency, paired with real difference** | A short scale, always reported beside the two-policy replay (D9 M-5 with M-2) | 4 |
| C7 | **Varied** | Free sorting into piles; repeat detection (D5 M-1, M21-03) | 5 |
| C8 | **Feels generated** | Guess authored or generated, and what gave it away | 5, 6 |
| C9 | **Reads as Night City** | Rank against vanilla by scale; predict the faction (M17-01, M17-03) | 6 |
| C10 | **Pace** | Tension rated over time; "dead" or "frantic" | 7 |
| C11 | **Noticed or watched** | Two scales plus comfort (T12-03) | 2, 4 |
| C12 | **Remembered** | Free recall, then recognition with foils (M13-04) | 3 |

**The panels.** Sizes are starting values [J], not power calculations (PNL-07). A pilot of about 10 comes first in every case.

| Panel | Question | Stimuli and arms | Raters, size [J] | Merged measures | Decision rule |
|---|---|---|---|---|---|
| **P-A Authored or generated** | Can raters tell, by content type, and what gives it away? | Per type (gig brief, encounter, line, news item, bark): generated with sowing on, generated with sowing off, A3, A4, A5 | 30 naive; 20 who know the game; per-type detection with intervals | D5 EV-9; M21-01; M17-03; M22-05; dossier 13's blind pair | Target: detection near chance; the baseline A3 should be detected more often than the engine. Cues coded and returned to P4 and P5 |
| **P-B Free sorting** | Which axes do players sort by, and is generated content as spread out as authored? | N items per condition after 10 and 30 exposures; names masked and unmasked; generated against authored of matching N | 30 | D5 EV-1, M-1, M-2; M13-10; M17-10 | Piles divided by N no lower than the authored set's beyond the equivalence bound; recovered axes reported (they set the scheduler's separation keys) |
| **P-C Caused and alive** | Do a district's week and its sifted chains read as caused, fair, alive but not frantic? | A week of one district's events and chains from a template; chains drawn at random within the gates; for the trace question, four arms (none, world trace, narrated hint, why-trace) | 30 | M14-17; P15-01; M10-14; D9 M-3 | Chains rated more caused than random-within-gates, or the feature is demoted; "anything come of anything" in the plan's band. Decides whether simulation phases 2 and 3 are needed |
| **P-D Selection and retelling** | Does sifting beat random-within-gates, with the presenter fixed? Which feature carries it? | 2 by 2: sifted or random-within-gates, by two presenters, on two worlds; per-feature ablation | 30 per cell | D6 R-25(a to c); TEL-15; SFT-12 | A feature stays if its ablation is worse by more than the bound; otherwise the simpler design (PNL-11). A null is published |
| **P-E Recognition, recall and hooks** | Do signs register, are causes remembered, do hooks draw follow-through? | Transcripts with foils; delays of a day and a week (remote); anchored and unanchored hooks; thin and rich payoffs | 30 | M13-04 to M13-07, M13-11, M13-12 | d-prime above zero per sign kind; cue lift at least the plan's bound; otherwise relax the re-cue rule (S13-P9-07) |
| **P-F Noticed or watched** | Where does a callback stop feeling like noticing and start feeling like surveillance? | One callback in four forms (witnessed act; witnessed third time; a rate; system voice); disclosure arms A9; page comprehension | 30 per cell; think-aloud with 10 | T12-03, T12-05, T12-06; M13-15 | Sets the witnessed-count rule and the influence cap (ETX-01 checklist first) |
| **P-G Memory and return** | What does forgetting feel like; what helps a returning player? | A7 arms; recap arms (nothing; resume line; line plus waiting list; full view; authored recap); stable against fresh draws | 20 to 30 | T11-09 to T11-13; M11-09, M11-13, M11-14 | Stable stays default unless "scripted" is higher by more than a point; the least recap that holds orientation |
| **P-H Voice, text and presumption** | Do voices differ, do option labels predict outcomes, does any line presume V's feelings, do gated model lines escape? | Lines with speaker hidden; labels with and without outcomes; flagged-line read-through; 500 gate-passed lines per model against their briefs; told stories with and without an evaluation clause | 20 to 30; escape audit by 3 raters | M21-05, M21-08, M21-09, M21-01, M21-03; M22-04, M22-05 | Voices above chance; zero rater-flagged presumptions; escape rate under the class threshold, or the class is withheld from models |
| **P-I Setting and tone** | Does it read as Night City, and can raters predict a faction and say who pays? | Predict the faction; ordinary-person cost; street use; district identification; blind rank against vanilla by scale; residue from media and rumour; dread ratings by stage | 20 who know the game | M17-01 to M17-05, M17-08, M17-13, M17-14; D7 M-13 | Above chance by the plan's margin; ranked at least as high as A5 on setting, reported by lens |
| **P-J Stills and clips: staging** | Can a viewer reconstruct what happened, tell intent, and read the answer to "why"? | Arrival-matrix stills and clips; sign kinds removed one at a time; trait against situation; reaction latency 0.3 s against 2 s; believed against omniscient; pull against push | 20 to 30 | M20-01, M20-05, M20-08, M20-12, M20-13; STG-03 | At least 70 per cent above chance in every non-exempt cell [J]; pull at least as accepted as push |
| **P-K Pacing** | Does the director beat a fixed schedule and random release, and does rest help the next peak? | Same seeds, three arms (A2); rest of three lengths; estimate against rating every few minutes | 30 | D7 M-6, M-9, M-12 | The director kept only if it beats both on the pacing ratings, or the simpler schedule wins |
| **P-L Representation read** | Do generated descriptions read as dignified? | Fifty generated descriptions, no scenes | 3 to 5 sensitivity readers | REP-07 (dossier 18); M18-08 | Lexicon screen compared with the panel; a miss changes the screen |
| **P-M Authors' trial** | Can writers who do not program author, fit and survey a seed? | Starter pack, three tasks, two programmers as control | 6 to 8 writers | M16-05, M16-10; T16-08, T16-09 | Median time to first fit under the plan's bound; findings rewritten until they are understood |

**Panel hygiene.** Blind and counterbalanced (PNL-01). Controls always (STN-04, PNL-10). Free report before probes (PNL-04). Agreement printed (PNL-06). Anchor set kept (PNL-09). Stimuli carry their content settings (ETX-04). Plan hash stamped (STN-06). No builder rates (STN-09). Each panel is piloted and its instrument checked before the decision run (§11).

### 5.6 Tier 4: early testers

**What a tester is asked to do.** Play normally. Keep a diary line on each return. Answer three questions weekly. Press the marker when something felt wrong. Share an export, if they choose, after seeing it.

**Instruments.**

| Instrument | Content | Feeds |
|---|---|---|
| **Opt-in local log** | The session ledger's counts: gaps, grades, channels, offers shown and taken, which dials are on, hitches. No text from saves, paths or names | Habituation (M13-08), variety narrowing (M12-05), taste-shift lag (M12-08), return by gap (T11-20), cost reports |
| **Diary line** | Per return: the gap, what they remembered, what helped | T11-12, T11-20 |
| **Weekly check** | Three items: trust, fairness, feeling watched | M12-18, T12-03 |
| **Marker** | The "this felt wrong" key; the last minute of record excerpt and an optional line | The friction log; B5 cases |
| **End interview** | Reloads in their own words; the three places they remember from a week and what happened there | T11-21; M20-01 and M20-14 at a delay |

**Ask:** what they remember, what they did next, what was annoying, what they would turn off. **Do not ask:** why they chose an option, in the moment (STN-10, TRS-02); anything that tells them what the engine is trying to do.

**Who.** Eight to twenty testers [J], stratified by play style (completionist, rusher, role-player) and by setup, with some isolated and some who talk to each other (TRS-05). Recruitment, consent and the ethics checklist come first (ETX-01). The beta's aim, that things "just work" about 99 per cent of the time on other people's setups, is tested here and in B1, B2 and B13 together.

### 5.7 Results and verdicts

Every run produces a result record (NUL-01). Four verdicts:

| Verdict | Meaning | What follows |
|---|---|---|
| **Supported** | Beyond the smallest effect of interest, in the planned direction | Keep; record the limits |
| **Refuted** | Beyond it, the other way | Remove or redesign; record why |
| **Equivalent** | Inside the declared bounds | Take the simpler design; publish the null |
| **Inconclusive** | Neither | Larger sample, better instrument or drop the question (NUL-03) |

A milestone report (plan §4: achieved, look at, test) includes the verdict table of the milestone's runs, nulls included.

### 5.8 Gates by milestone

| Milestone | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| **M2 Understanding v0** | B1 on the reference model; B12 lint and round trip as S2 is implemented; the criteria sheet and arm library specified | None | GS-1 to GS-3 booked (calibration; inputs for S5, S6 and the R1 windows) | None |
| **M3 Offline prototype** | B1 to B5, B7, B9, B11, B12, B13 green; B6 phase 1; B14 first pass | P-A, P-B, P-C, P-D, P-H: "generated hooks beat a Radiant-style baseline, judged blind" is P-A and P-D against A3. The authored seed with sowing off fits as with sowing on (S23-S2-10) | GS-4 to GS-8 done (calibration) | None |
| **M4 First encounters in game** | B2, B13 on every build; B14 audience scripts on the simulated port | P-J on stills and clips | GS-7, GS-9 (acceptance), GS-10, GS-11 | Small, informal |
| **M5 Gigs** | B6 phases 2 and 3 only if P-C says so; B8, B10 on gig-scale sessions | P-E, P-F, P-G, P-I, P-K, P-L | GS-12, GS-13 | The first tester group |
| **M6 Arcs** | B2 across multi-session arcs; B14 long runs | Re-run the anchor sets | GS-14 | Longitudinal: habituation, returns, taste shift |
| **Public beta** | All batteries green; coexistence rows passed | Anchor sets re-run on the release build | GS-11 again; a coexistence session | The 99 per cent check on others' setups; the community watch |

### 5.9 A worked example: one tellability feature

Take dossier 6's within-pattern rarity feature (F-2a), which the engine will use to rank matches of one pattern.

1. **Tier 1.** B10 logs the feature value for every offer with its rivals. B1 and B2 confirm that scoring changes no record. A check scores one chain for two Vs who differ in what they have met; the scores must be able to differ (TEL-01). B14 confirms that a farmer gains nothing.
2. **Tier 2.** P-D runs the 2 by 2 on two worlds with the presenter fixed: sifted with the feature, sifted without it, random-within-gates. The raters judge "worth telling" in pairs and would they retell it. The plan fixes the smallest effect and the equivalence bound first.
3. **Verdict.** If removing the feature is equivalent, it becomes a logged hypothesis and leaves the ranking. If it is supported on the first world and inconclusive on the second, a third world is run. Either way the result is published, with the limits.
4. **Tier 3 and 4.** The log records what V accepts, ignores and later mentions (R-26), which is a tester measure and never a rule's input (TRS-04).

## 6. The merged session cards, ordered by milestone

Fifteen draft cards exist: seven in the knowledge pages ([save identity](../../../knowledge/save-identity.md#session-card) with 13 rows, [game events](../../../knowledge/game-events.md#questions-only-the-game-can-answer) 17, [main-story state](../../../knowledge/main-story-state.md#questions-only-the-game-can-answer) 24, [population](../../../knowledge/population-and-affiliations.md#questions-only-the-game-can-answer) 16, [places](../../../knowledge/places.md#questions-only-the-game-can-answer) 14, [open-world activities](../../../knowledge/open-world-activities.md#questions-only-the-game-can-answer) 25 and [player channels](../../../knowledge/player-channels.md#questions-only-the-game-can-answer) 17), and eight in dossiers 11, 12, 13, 14, 15, 20, 21 and 22. Together they hold about 170 rows. Many ask the same thing twice (the same vendor after a load appears in dossier 15 and in the population card; crowds at market points appear in four cards; three cards ask the bridge chat for a district read). This section merges them into 14 sessions. Where a session takes its rows straight from a knowledge-page card, the card stays the checklist and this section gives the merge notes. Where the rows live only in dossiers, this section is the checklist.

### 6.1 The common frame

**Profile.** The XF diagnostic profile and nothing else ([D-12](../decisions.md)): game time booked on the coordination board, the maintainer launches the game, one session at a time, catalogue commands only, every safety rule standing (kill switch, handover, save lock). No user's mod setup is touched; a mod placed for a session is added to the test profile only. Roles: `C` is Claude driving the bridge, `M` is the maintainer.

**Before booking.**
- The card has dry-run on the offline simulated port (GSN-06).
- The bridge version is pinned; any probe build or throwaway script the card needs exists and is named (D-18).
- The engine build, pack hashes, world seed and save list are written into the manifest.
- The coordinator tells XF · Meta-coordinator when the session starts and when it ends.

**Brief (read to the maintainer).** What the rows are for. What is staged and what is not. Nothing is saved unless a row says so. Rows ask what you see and remember; they never describe story content. Stop at any time; any comment from you stops the session. Waits are short.

**Row format** (GSN-03): `GS-n.m` · who · do · expect · if not · evidence · decision it feeds.

**Evidence capture.**
- `local/sessions/<id>/` (ignored, never published; D-18) holds: the manifest (engine build hash, bridge version, profile, pack hashes, world seed, save list by redacted key); the exported `session_log` with its `ev:` and `sk:` lines; `session_note` markers `GS-n.m start` and `GS-n.m end`; every `ask` answer verbatim with its option list; `scene_read` and `scene_report` outputs; `capture_screenshot` (with `expect`) and `capture_sheet` files; the engine's session ledger for the run; the friction log, one line per point, tagged `fr:`.
- Counts and verdicts go to the results ledger; traces stay in the folder.

**Stop conditions.** Any in-game comment from the player. Any crash, odd behaviour or save-lock refusal: `session_handover`, stop, note. No single tool call waits longer than 90 s. Test windows stay off-screen or minimised and never steal focus.

**Debrief (GSN-05).** What felt wrong? What was slow or awkward? What would you want more control over? What did the card not ask that it should have?

**After.** A write-up the same day (S23-P9-15): rows passed, failed and not run; the friction log turned into queued work; knowledge-page edits; nulls recorded. Calibration results become values in the specifications' open items; acceptance results go to the milestone report.

### 6.2 The sessions

`C` marks a calibration session (it supplies inputs and cannot fail), `A` an acceptance session (it tests a built thing against its checklist). Booking lengths are estimates [J].

| Session | Name | Type | Milestone gate | Merges | Needs | Booking | Feeds |
|---|---|---|---|---|---|---|---|
| **GS-1** | Save identity and load points | C | Before M3 | Save-identity rows 1 to 13; game-events rows 3, 4 and 5 folded in | A probe build with the `xfs_probe_*` facts and lifecycle log lines | 90 min | S6, P7, dossier 11, S2 load classes |
| **GS-2** | The event feed | C | Before M3 | Game-events rows 1, 2 and 6 to 17 | Log-only event hooks | 90 min | S5, dossier 6 gaps, P7 |
| **GS-3** | Main-story facts, R1 first | C | Before M3 | Main-story rows 1 to 7 and 11 first; rows 8 to 10 and 12 to 24 later, one save each | Saves at known points | 60 min, then optional | R1 windows, S2 facts table |
| **GS-4** | The street: people, places, order | C | Before M3 | Population 1 to 16; places 1 to 14; dossier 14 rows 1 to 4 and 6; dossier 15 rows 1 to 3 and 5 to 7 | `scene_read`; a written request to the bridge chat | Two halves of 75 min | S1 time constants and incident shares, POP-07, places registry, norms |
| **GS-5** | Gigs, fixers and hustles | C | Before M3 | Open-world rows 1 to 25; dossier 15 row 4; dossier 4's open question on failed gigs; a content-parity question from dossier 18 | Saves with several gigs done | 90 min | Fitting, S2 facts, dossier 18 defaults |
| **GS-6** | Channels and text | C | Before M3 (M3 prototype is text) | Player-channels rows 1 to 17; dossier 21's five items | Throwaway CET or redscript scripts; a small test mod; the NPC-direction branch for two rows | 90 min plus script preparation | P8, S7, dossier 21 budgets |
| **GS-7** | Early staging check (WP-18) | C and A | Between M3 and M4 | Dossier 20 rows 1 to 9 and 11 | NPC-direction branch merged; the XF Core plugin host; a restage hook for the last row | 90 min | P8, S2 §2.21, plan WP-18 |
| **GS-8** | Noticing calibration | C | Before M4 | Dossier 13 §11.3; dossier 20 row 10 | Traces placed by the bridge at known distances; a port that logs grade and raw values | 75 min | S5 display tests, S2 §8.5, the noticing prior table |
| **GS-9** | First encounters | A | **M4 acceptance** | New checklist; dossier 20 rows re-run on engine output; dossier 11 T11-16 and T11-19 | Engine-generated encounters; GS-7 and GS-8 results | 90 min | M4 done-when |
| **GS-10** | Reload, return and catch-up | A | M4, repeated at M5 | Dossier 11 T11-14 to T11-19; M8-12; the engine-off baseline of dossier 7 | Probe build; the engine's offers | 75 min | Dossier 11 targets, S2 load and return rules |
| **GS-11** | Cost to the game and to start-up | A | M4, then every milestone and the beta | Dossier 22 §11.3; dossier 14 catch-up cost; budgets | The companion process; the runner | 60 min | P7 budgets, quality bar 9 |
| **GS-12** | A gig played, with coexistence | A | **M5 acceptance** | New checklist from dossiers 6, 7, 8, 9 and 13; the coexistence rows | A fixer-delivered gig through the real channels | 90 min | M5 done-when, bars 1 to 4 and 10 |
| **GS-13** | The player model and its pages | A | M5 | Dossier 12 §11.3 | The model and its page in the journal | 75 min | Dossier 12 caps, ETX-01 |
| **GS-14** | An arc across saves | A | **M6 acceptance** | New checklist; dossier 11 T11-12 in game; dossier 8 re-situating | A multi-session arc | Two or more sittings, a day or more apart | M6 done-when |

The dread register (dossier 17) has no session; dossier 17 proposes none until its offline panels pass.

### 6.3 Checklists and merge notes

#### GS-1 Save identity and load points (C)

Use the [save-identity card](../../../knowledge/save-identity.md#session-card) rows 1 to 13 in order; it already carries `who`, `do`, `expect` and `if not`. The merge adds three things.
- **Row 3** also reads the `game_was_loaded` fact straight after `game_wait` reports gameplay (game-events row 3).
- **Row 4** also logs which of the three save hooks fire for each save kind (game-events row 5 is the same test).
- **Row 6** also notes any save-replacer that appears on load or on a new game (game-events row 4).

Evidence: `sk:` lines and copies of the metadata files in scratch, read for structure only; no names, paths or identifiers are kept. Feeds: the save pin (S6), the load classes of S2, dossier 11 T11-07.

#### GS-2 The event feed (C)

Use [game-events](../../../knowledge/game-events.md#questions-only-the-game-can-answer) rows 1, 2 and 6 to 17 (wanted level and chases; area type; district and subdistrict borders; interiors; vehicles; purchases; combat outcomes; crowd death counts; journal and quest events; dialogue choices; calls; time skips; the cost of the stim filter; the checkpoint wrapper). Rows 3, 4 and 5 moved to GS-1. Evidence: `ev:` lines. Feeds: the event feed of S5, the gaps of dossier 6, the hook list of P7.

#### GS-3 Main-story facts (C)

Use the [main-story card](../../../knowledge/main-story-state.md#questions-only-the-game-can-answer). Run rows 1 to 7 and 11 first; they settle the R1 windows (dossier 3, open question 11). Rows 8 to 10 and 12 to 24 each need a save at a different point and run later, one per booking slot, and are low priority. Rows ask the player what happened and read named facts; they do not tell the story. Feeds: S2's facts table (`decidedBy` guards), the R1 appendix.

#### GS-4 The street (C)

Booked as two halves. Merged rows:

| # | Source rows | Do | Expect | If not | Feeds |
|---|---|---|---|---|---|
| 4.1 | Dossier 14 row 1 | Read the game clock and the simulation clock every 10 s for 5 real minutes in free play, then in a conversation, then in a menu | A steady ratio in free play | A varying ratio: record it per state; every S1 time constant depends on it | S1 clocks |
| 4.2 | Population 1 to 3; dossier 14 row 2; dossier 15 row 2 | `scene_read` NPCs within 40 m at one Kabuki and one Corpo Plaza market point, and a Heywood point, at six fixed hours (for example 05:00, 08:00, 12:00, 18:00, 22:00, 02:00; set the time only with the player's agreement); three reads a minute apart at one spot | Counts that change at period boundaries | Smooth variation: crowd density dominates; record both | S1 population periods |
| 4.3 | Population 4 to 6 and 13; places 10 to 12 | Gang presence in Little China, Northside, Heywood, Arroyo, Coastview, Japantown and Dogtown; which symbols or colours dominate; positions against the registry's spots at night in one bar | Groups at fixed places | Mixed or absent: the registry over-promises | Places registry |
| 4.4 | Population 7 to 9, 12, 14, 15 | Look at three pedestrians in turn and ask "is this a community member?"; dress by district; counts of record names; ripperdoc and fixer records; the Phantom Liberty rewrite; a gang chase | As the population page predicts | Differences: record them | POP-07, population page |
| 4.5 | Population 10; dossier 15 row 1 | Pick a street NPC and a market vendor; save; leave the district; load; return | The vendor may differ after a load | The same vendor: record the key the game uses | POP-07 binding |
| 4.6 | Population 11 | Knock down one pedestrian, leave 100 m, return after five game minutes | The pedestrian is gone or replaced | A persistent body: record | Residue rules |
| 4.7 | Places 1, 2, 8, 9, 12 | Walk between districts and read the pop-ups in order; teleport to named pins and read the location text; count fast-travel icons; the Dogtown gate | As the places page predicts | Differences: record | Places registry |
| 4.8 | Places 4 to 7, 13, 14 | Venue rules: the map panel's gangs; weapon draw in three bars; whether waiting is allowed; photo mode in the studio; restricted-area warnings; the vehicle ban | As the places page predicts | Differences: record | Places registry, S8 limits |
| 4.9 | Dossier 14 row 3 | Stand 20 game minutes in a hot-looking place and a quiet one, in morning, evening and night, and record the game's own incidents | More in the hot place and at night | No difference: the game's ambient events are not concentrated like the engine's will be; the counts set the engine's share of what V sees | S1 incident share |
| 4.10 | Dossier 14 row 4; dossier 15 rows 3 and 5 | A minor crime once in view of a crowd and once alone, in the same district and hour; the same in a low-security district and a standard one. Record reactions in five game minutes, police lag, direction and distance | More reaction in a crowd; slower response in the low-security district | No difference: our norm state lives only in the engine's cues | Norms, TIE-04 safe radius |
| 4.11 | Population 16; places 3; dossier 14 row 5; dossier 15 row 6 | **A written request, not a game row.** Ask the bridge chat whether it can provide: a district read (district id, crime multiplier, prevention preset); an NPC's attitude group, affiliation and community entry; and activate or deactivate on a named community or hustle pin, with limits | An answer in writing | No: the realisation table is limited to off-screen traces and bridge spawns | Runtime requirements |
| 4.12 | Dossier 14 row 6; dossier 15 row 7 | On one long drive and one long walk across three districts, note every place where the world felt empty, repeated or had no history | A list | A list | Friction log, P8 |

Evidence: `scene_read` outputs, `ask` answers, counts per cell. No NPC names are kept.

#### GS-5 Gigs, fixers and hustles (C)

Use the [open-world card](../../../knowledge/open-world-activities.md#questions-only-the-game-can-answer) rows 1 to 25 (counters and tiers 1 to 7; fixed-gig starts, briefs and call settings 8 to 11; outcome facts 12 and 13; pay 14 to 16; retaliation 17; hustles 18 to 25). Merge notes:
- Add dossier 15 row 4: three gigs for one fixer, then one for another; note any change in offers beyond street-cred gating.
- Row 3 also answers dossier 4's open question: does a failed gig change later offers?
- **Content parity from memory (dossier 18).** `ask` the maintainer, without replaying anything, which of these four classes they have met in the base game, and where: self-harm, captivity or torture, bodies treated as property, threats to V's own body or tools. The answer sets the "parity unchecked" defaults, and the research queue's corpus check can replace it.

Feeds: the fitter's use of gig facts, S2's facts table, dossier 18's defaults table.

#### GS-6 Channels and text (C)

Use the [player-channels card](../../../knowledge/player-channels.md#questions-only-the-game-can-answer) rows 1 to 17. They need throwaway scripts and, for rows 8 and 9, a small test mod built from the wiki's shard guide, all prepared in advance. Merge notes: add dossier 21's five items to the rows that use the same channel.
- The character counts that fit before wrapping or clipping, on a banner, a toast and a scanner line (with rows 10, 11 and 6).
- Whether a message `delay` is honoured on a thread with no journal entry (with rows 12 and 13).
- Whether the female variant of an on-screen row is chosen for V's body gender (with row 4).
- How a subtitle-only call line looks with no call (with row 17 and the existing question 10).
- The reading time of a 12-word overhead line against the game's own display time (with row 17).

Feeds: P8's channel table, S7's text budgets (dossier 21 §5.4), dossier 21's calibration of the lexicon.

#### GS-7 Early staging check, WP-18 (C and A)

Dossier 20 §11.3, rows 1 to 9 and 11 (row 10 moved to GS-8). It needs the NPC-direction branch and the XF Core host, and fits the diagnostic profile only. Each row was written as an ask, not a result.

| # | Do | Expect | If not |
|---|---|---|---|
| 7.1 | Three clone casts at a market. Give them: stand and count; glance up the street; look at each other. `ask "Which one is worried? Which is waiting for someone?"` | The worried one named by more than chance | An unreadable tell: record which of movement, look-at, facial reaction carried nothing |
| 7.2 | One clone walks, steps up to a run and changes heading when a second clone appears 20 m away, with a reaction delay of 0.3 s, then 2 s. `ask "Did they react to the other person?"` [Yes, No, Unsure] | Yes at 0.3 s; weaker at 2 s | Yes at both: the latency budget is looser than 0.5 s. No at both: the cue is too weak |
| 7.3 | Ask a clone to use an existing Nervous or Sitting spot, by marking and by node reference; log `GetCommandState` | A spot is used, or the command fails with a logged state | Fall back to the carrier gesture and record the missing query |
| 7.4 | Spawn the residue kit (a sign on the ground, spilled items, a notice); capture stills from the front, back and each end with `capture_sheet`. `ask "Looking at the stills, what happened here?"` | The two events and their order | A key read invisible from a side: move it or add the second sign |
| 7.5 | `M` walks into a clone, bumps it, then draws a weapon at it; `C` watches `session_events` | The game's crowd reacts by its presets; the clone responds per `onInterfere`; the kill switch restores everything | An immortal or frozen clone: record as a bug |
| 7.6 | The cast walk off and despawn while `M` looks away, then at them (`capture_burst`) | Nobody vanishes in view; residue stays | A pop-out: despawn only when `world.probe` says out of sight |
| 7.7 | An overhead text bark at 5, 15 and 30 m, with chatter on and off. `ask "Could you read it? Did it show?"` | Readable at 15 m or less; hidden with chatter off | Unreadable at 15 m: shorten the line or move the cast |
| 7.8 | A scanner entry on a spawned prop (player-channels rows 1 to 6) | A description shows | Record which route failed |
| 7.9 | Enter photo mode during a staged row and orbit the camera. `ask "Do you see anything wrong: floating, clipping, a cast member in the wrong place?"` | Nothing backstage | A seam: note it; photographs of staged scenes will be shared |
| 7.10 | After the restage hook exists: save mid-row, load | The scene restages at the current phase | A replay: the persisted phase is not read |

Evidence: stills, `session_events`, `ask` answers. Feeds: P8, S2 §2.21, and the plan's WP-18 aim of confirming that small encounters can be expressed and read in game while the design is still cheap to change.

#### GS-8 Noticing calibration (C)

Dossier 13 §11.3, with dossier 20 row 10.
- **Candidate.** A fixed set of traces placed by the bridge at known distances, sizes and angles, and a set of barks and toasts of known length.
- **Routes.** On foot with no objective; on foot with a tracked objective; driving with a call and without; at a vendor; in dialogue. Hold a staged row at its midpoint through each (dossier 20 row 10): the row is noticed on foot, less in a vehicle, not in dialogue.
- **Logged by the port.** Grade, raw test values and activity. **Probed after each run.** Cued recognition with foils, and "what did you notice?" as free report.
- **Friction log.** Every point where the port could not report what the tests need; every unreadable banner; every inaudible bark; every moment a sign should have been seen and was not.

Pass rule for the tests (S13-P9-02): for each display test, the distance, angle and dwell at which half of presented items were noticed; a test is accepted when, among items it grades `presented`, the observed noticing meets the plan's bound. Feeds: S5's display tests, the noticing prior table.

#### GS-9 First encounters, the M4 acceptance session (A)

The one session whose pass is M4's done-when. New checklist, built from the dossiers' rows.

| # | Do | Expect | If not | Evidence |
|---|---|---|---|---|
| 9.1 | Confirm only catalogue commands are used. Run the kill switch at the end | Everything the engine placed (people, props, pins, trackers, messages, facts) is removed | Anything left: fix before any other row counts | Log; scene read before and after |
| 9.2 | Three engine-generated encounters, one per scale (glance, encounter, vignette), staged near V. After each: `ask "What happened here?"` | The answer names the events and their order that the record holds (M20-01) | A wrong or empty answer: the staging does not carry the record | `ask` answers against the record |
| 9.3 | One encounter where the key read is on one side only; approach from each side | Readable from the approach side, or a second sign supplies it | Unreadable: add a second sign (dossier 20 STG-03) | Stills |
| 9.4 | Walk away and look back as the cast leave | Nobody vanishes in view; residue stays and is true to the record | A pop-out or a false trace | `capture_burst` |
| 9.5 | Select people the engine must avoid: a quest NPC, a vendor, a police officer, a child, a crowd member in combat, a person in a scene or vehicle | The engine refuses each (reservation and protection checks) | A selection: fix; this is the "never break vanilla" bar | Refusal entries in the log |
| 9.6 | Save mid-encounter; load; and repeat with ten quick-loads in two minutes (dossier 11 T11-16) | The encounter restages at its phase; no duplicate offers; the pin classed *behind* each time | A duplicate or a replay | Offer ids before and after |
| 9.7 | Place a cosmetic trace from a test seed; save; load (dossier 11 T11-19) | The mark is drawn again from its event | The mark is gone: the carrier rule is missing | Capture |
| 9.8 | Note frame time with the engine idle and active (details in GS-11) | No perceivable change | A hitch: record where | Frame-time log |
| 9.9 | Friction log and debrief | A list | | Friction log |

**Pass rule.** Every row passes, or has a waiver the coordinator records with a reason. One failure of 9.1, 9.5 or 9.6 fails the session.

#### GS-10 Reload, return and catch-up (A)

Dossier 11 §12.3, with measures from dossiers 7 and 8.

| # | Do | Expect | If not |
|---|---|---|---|
| 10.1 | T11-14. Load one save five times with the same short act sequence; log the offer ids and recall results; note which street and combat details differ | Engine ids and recalls identical; street and combat details differ | Engine ids differ: a key reads the session; find it |
| 10.2 | T11-15. Load three ways (menu, quick-load, death reload) in the middle of an activity; note the first push and what appears | Settling for 90 s; the resume line only for a save older than the first bucket; nothing above class 1 | A push inside the settle, or no settle after a death reload |
| 10.3 | T11-16. Ten quick-loads in two minutes, then play | No duplicate or new offers, no recap; the pin classed *behind*; the branch forks once | Duplicates: the commit or the offer id is wrong |
| 10.4 | T11-17 (probe). In the diagnostic profile, wait 3 and 7 game days; read the log; enter a district last seen before | Catch-up cost within budget; at most three changes shown; recalls widen as designed | A visible hitch, or more than three changes: tune the glance or the budget |
| 10.5 | T11-18 (probe). Make a manual save, a quick-save and an autosave straight after a displayed message; load each | The message is an answerable offer, not new, and the exposure lost is under the timer | A displayed offer shown as new |
| 10.6 | D7 M-15. Thirty minutes of ordinary play with the engine off, ledger only | A baseline of the game's own intensity, to set headroom | None |
| 10.7 | M8-12. First push and class after each load above | After the settle; the lowest class | Earlier or higher: the arbiter's load rule is not applied |

Feeds: dossier 11's forgetting and return targets, S2's load and return rules, the buckets of §5.5 in dossier 11.

#### GS-11 Cost to the game and to start-up (A)

Dossier 22 §11.3 and the budgets of P7, repeated at every milestone and before the beta.
- Frame time, GPU memory and start-up time with the engine and runner off, warming, and generating (M22-11).
- Whether the runner pauses in combat and resumes in menus as designed.
- Whether a message pre-rendered during play is ready at release.
- Engine tick cost in game against the simulated figure (M14-23); pack load time; total memory with the game and the companion running.
- Time from load to the first engine action.
- Friction: anything awkward about installing, enabling, qualifying or switching off the engine or a model.

Pass rule: no perceivable change in frame time; start-up unchanged within the plan's bound (quality bar 9).

#### GS-12 A gig played, with coexistence (A, M5)

New checklist. Rows ask and never tell.

| # | Do | Expect | If not | Feeds |
|---|---|---|---|---|
| 12.1 | Receive a fixer-delivered gig through the real channels (a call or a text) | It arrives by the rung the seed asked for, at a good moment (no class above the gate during combat) | Wrong channel or timing | D7, S5 |
| 12.2 | At the decision, `ask "What do you expect each option to lead to?"` before choosing | Answers compared with the outcomes (D9 M-4) | Blind choices: fix the hints | Bar 4 |
| 12.3 | After a consequence, `ask "What caused that?"` | The cause is named at the plan's rate (D9 M-3) | A delay or channel that breaks attribution | Bar 1 |
| 12.4 | Decline one offer | The stake resolves without V; no reproach; no unrelated lockout (D9 M-1) | A penalty | Bar 4 |
| 12.5 | Save, load, and look at the consequence | It persists and matches (D9 M-10) | A fresh draw | Bars 1 and 4 |
| 12.6 | A later callback to an act the maintainer remembers | It cites an act V did (not a population fact) | A generic line | Bar 2 |
| 12.7 | **Coexistence.** Play a vanilla quest chain with the engine on, then with it off | The engine refuses reserved people and places; no vanilla state differs; the kill switch restores everything | A difference: record the cause | Bar 10 |
| 12.8 | Friction and debrief | A list | | |

Feeds: M5's done-when ("a session's gigs meet the quality bar").

#### GS-13 The player model and its pages (A, M5)

Dossier 12 §11.3, six items, one session.
1. A scripted route of about 30 minutes, run three times from one save with `noticing` off, `acts` and `approach`. Record offers and times (checks M12-03 and M12-05 on live data).
2. Read the page in the game's journal. Does it match what happened?
3. Press "Use less" and "Start fresh". Does the next 10 minutes behave as the model-off run?
4. Meet two NPCs with different orientations in the same event. Do the staging records differ and the world stay the same?
5. Export a save and a report; confirm the model is absent.
6. Log every friction point: wording, placement, anything that made the page feel like a tracker.

The ethics checklist (ETX-01) is complete before this session; no deceptive arm is run in game.

#### GS-14 An arc across saves (A, M6)

New checklist, for a multi-session arc.
- Play the first sitting, save, and quit. Return after a day, then after at least seven days (a remote check-in is enough for the second).
- Reload equivalence at arc scale: decline, reload, decline again; the consequence and its portents match (D9 M-10).
- Re-situating after a long gap: `ask` when, where and why (M8-14); the loose-end register and closure entries agree with what the maintainer remembers.
- The return view arms of dossier 11 T11-12, in game: nothing; the resume line; line plus waiting list.
- Record growth over the arc (M11-12, in game).
- The kill switch and a clean removal of the mod mid-arc leave no stalled seed (dossier 19 T-06).

Pass rule: the arc holds together across saves (M6's done-when).

## 7. The merged measure register

About 276 numbered measures came from 16 dossiers (the measures of dossiers 1 to 4 and 19 are in prose or are tests; dossier 19's nine tests are included). They fold into 30 groups. A group is one thing to compute or rate, with one pass rule. Source IDs are the dossiers' own; "D5 M-3" is measure M-3 of dossier 5. A measure sits in the group where it is computed; cross-listing is noted by "also". The "Where" column names the battery (B), panel (P) or session (GS) that runs it.

| Group | Merged measure | Source measures | Where |
|---|---|---|---|
| MR-01 | **Replay, reload, partition and session independence.** The same inputs give the same record under any tick split, reload point, epoch, play clock, wall clock or load count | M11-01, M11-02, M11-10, M11-11 (commit window, GS-1); D7 M-8, M-16; D9 M-10; M8-15; M14-10, M14-22; M15-03, M15-04; M16-06; M22-02; M22-01 (reload half); F-12, F-13, F-16, F-17, F-21, F-22, F-25; SF-9, SF-27 | B2; GS-1, GS-10 |
| MR-02 | **Branch difference and option distinctness.** Branch diffs are minimal and contained in the causal cone; options leave different records | M11-03, M11-04; D9 M-2 (two-policy replay); M12-03 (outcome independence) | B2, B14 |
| MR-03 | **Firewall and read-set.** What the model, settings, grades, raw values and tester data can reach; forbidden hook inputs; no retention term | M12-01, -02, -04, -10 to -13, -15, -16; SF-32 to SF-37; M13-16; S13-P9-19; S17-P9-04; D9 M-9; M22-12 | B3 |
| MR-04 | **Record integrity and causes.** Every offer and consequence has a trace; no orphan announcement; constructed share low; no contradiction; orphan staged elements zero | D9 M-1, M-8, M-12, M-14; M10-01, M10-02, M10-12, M10-13 (also R-22); M14-02, M14-08, M14-24; M20-02; D6 R-24 | B5 |
| MR-05 | **Floors, ceilings, lines and licence checks.** Minors, ceilings over the settings matrix, lines over a hundred game-years, retract, fade parity, flash, envelope, licence and pack tests | M18-01 to M18-05, M18-11 to M18-15, M18-17, M18-18; M17-17; M21-13; M22-14; dossier 19 T-01 to T-09 | B4 |
| MR-06 | **Representation audit.** Role independence, swap difference, proxy strength, role support, feedback loop; a reader panel for dignity | M18-06 to M18-10; REP-07 | B4; P-L |
| MR-07 | **Lint quality and findings.** Latency, completeness, source maps, round trip, false positives on the game's own text, lint fixture coverage | M16-01 to M16-04; M16-09; M17-16; M18-16; M21-14 | B12 |
| MR-08 | **Authoring loop and survey.** Time to first fit, survey flags, pack diff, isolation, non-programmer trial | M16-05 to M16-08, M16-10, M16-11; T16-01 to T16-10 | B12; P-M |
| MR-09 | **Simulation patterns (S1).** Concentration, near-repeat, offender location, hot-list turnover, band flicker, cluster statistics, delay law, largest follow-up, suppression, rumour reach, stocks and wars, tail, unrest bursts, routines, population fit, ties, closure, norms, sanctions, reputation, hazards | M14-01, -03 to -07, -09, -11 to -15, -18, -19, -21; M15-01, -02, -05 to -14, -17 to -23, -25 to -28 | B6 |
| MR-10 | **Coarse against fine.** Summary and item agreement, demand independence, lazy knowledge, aggregate against residents | M14-14, M14-16, M14-20; M15-18; F-7; new twin runs | B7 |
| MR-11 | **Pacing and delivery.** Bursts, forbidden deliveries, waits and expiry, ill-timed proxy, phases, queue age, headroom, estimate against rating, rest effect, three arms, closing perceived | D7 M-1 to M-7, M-9 to M-12, M-15; M13-14 | B8; P-K; GS-10 |
| MR-12 | **Threads, growth and session shape.** Occupancy, refusals, advance share, beat intervals, thread age, debt, composition, promotion audit, rung counts, pull share, opening, quit phase (P9 only), re-situating | M8-01 to M8-14 | B8; GS-10, GS-14 |
| MR-13 | **Variety and stream statistics (offline).** Skeleton diversity, effective kinds, reach, repeat and run-length, gaps, clumping, alternation, pair coverage, learner bits, template miner, dead and hot units, text homogeneity, pooled templates, session-length curves, expressive range, interface validity | D5 M-3 to M-19; EV-2 to EV-7, EV-10 to EV-15 | B9 |
| MR-14 | **Perceived variety.** Free sorting, perceived axes, authored-or-generated, repeat detection, prediction task, similarity sorting | D5 M-1, M-2, EV-1, EV-8, EV-9; M13-09, M13-10; M17-10; M21-01, M21-03 | P-A, P-B |
| MR-15 | **Agency and consequence.** Decline audit, attribution, foreseeability, perceived agency, re-offer count, exposure, off-plan moves, reported foresight | D9 M-1, M-3 to M-7, M-11; M10-15; M11-09 | B14; P-C; GS-12 |
| MR-16 | **Change, theme and payoff.** Arc labels, step size, readers per turn, signature distance, argument profile, mechanic mismatch, takeaway test, premise renders, plant ledger | M10-03 to M10-11 | B5; P-D |
| MR-17 | **Memory and forgetting.** Forgetting curve, never dropped, contradiction audit, half-memory share, generalisation probe, record growth, return, setting comprehension, foreign loads, absence lint | M11-05 to M11-09, M11-12 to M11-16 | B2, B13; P-G; GS-10 |
| MR-18 | **Player model, trust and landing.** Breadth and recovery, rates against types, validity, taste-shift, why coverage, reset, landing, gaming players, human trust measures | M12-05 to M12-10, M12-14, M12-17, M12-18 | B3, B14; P-F; GS-13 |
| MR-19 | **Noticing, recognition and recall.** Noticing by channel, time to confirmed, grounding, recognition with foils, cue lift, cause at payoff, source accuracy, habituation, responsiveness, sources and corrections, scrutiny after transitions | M13-01 to M13-08, M13-15, M13-17, M13-18 | P-E; GS-8; testers |
| MR-20 | **Curiosity and peak-end.** Gap and payoff, question formulation, peak-end A/B | M13-11 to M13-13 | P-E |
| MR-21 | **Staging and legibility.** Reconstruct from residue, pastiche index, one read in view, intent recognition, equifinality shown, reaction latency, glance and stay, soft-locks, interference outcomes, street | M20-01, M20-03 to M20-08, M20-10, M20-11; M8-16 | B14; P-J; GS-7, GS-9 |
| MR-22 | **The "why" answers.** Comprehension, acceptance, the Tale-Spin gap, leak differential, answer against record, trace arms | M20-12 to M20-16; M10-13, M10-14 | B5; P-C, P-J |
| MR-23 | **Setting, tone and dread.** Predict the faction, ordinary-person cost, reads as Night City, street use, specifics, stake scale, win-cost, district identification, readable rate, tone trace, residue, dread | M17-01 to M17-15; D7 M-13 | B8, B11; P-I |
| MR-24 | **Text layer.** Orphan specifics, repeat rate, specificity order, presumption, turn lengths, teller divergence, register, reading time, voice, option labels, provenance, brief audit, diversity, gate detection, false rejects, fallback | M21-02 to M21-12, M21-15; M22-03 to M22-10, M22-13 | B11; P-H |
| MR-25 | **Model qualification and escape.** Per-model pass rate, escape rate, class set granted, calls per delivery | M22-04, M22-05, M22-08, M22-13 | P-H |
| MR-26 | **Budgets and cost.** Tick cost, record growth, start-up, frame time, render time, check latency, calls per delivery | M14-23; M16-01; M11-12; M22-07, M22-08, M22-11 | B13; GS-11 |
| MR-27 | **Gaming and synthetic players.** Farming, decline-all, return-maximiser, off-plan, clue loss, audience scripts | M12-17; D7 M-14; D5 EV-16; D9 M-11, M-13; M20-10, M20-11 | B14 |
| MR-28 | **Selection, tellability and offer shares.** Per-feature logs; shares by pattern and kind; random-within-gates comparison; escalation | D6 R-24 to R-26, SFT-13; M10-16; M12-04 | B10; P-D |
| MR-29 | **Retelling and acceptance logs.** What V accepts, ignores and later mentions | D6 SFT-11, R-26; M13-16 | Testers; GS-12 |
| MR-30 | **Kernel conformance.** Fixtures, invariants, digest, primitive vectors | S0 F-1 to F-25, C-a to C-d, I-1 to I-16 | B1 |

**What the merge removed.** More than ten separate "reload gives the same result" measures became one group (MR-01); about eight "blind panel of authored against generated" designs became P-A and P-B; four cards asking the bridge chat for a district, attitude or community capability became one request (GS-4.11); four cards asking for crowd counts at market points became one row (GS-4.2).

## 8. Tensions

| Tension | One side | Other side | Resolution here |
|---|---|---|---|
| **A release needs a yes or no; there is no single score** (STN-01) | A milestone must pass or fail | One score would hide which quality failed (F-3, F-4) | Gates are conjunctions of per-criterion rules, each against a named control. A failing criterion names itself |
| **Controls cost people; people are scarce** | Every claim wants a random-within-gates arm and an anchor | A panel of 30 per cell is expensive | The arm library is built once; cheaper tiers first; pilots of about 10 prune the plan; panels share stimuli and raters across questions where the design allows |
| **One seed is exact; players are not** | Determinism makes tests exact | A single seed shows one world | Exact properties are checked on random seeds and scripts; distributional ones on at least 20 worlds; many-world hit counts are reported (S2 §11.2) |
| **Retention-like measures against no retention proxies** (ETX-03) | Quit phase and returns say whether play holds up | A measure that reaches the director becomes an objective | Measured in the local ledger for P9, audited as never read by any rule (B3) |
| **Honest nulls against momentum** | A null stops a feature that took weeks | A feature kept without evidence is a hypothesis dressed as a result | The verdict is set by a plan written first (STN-06, NUL-02); the null demotes the feature to logging, which keeps the work (NUL-04) |
| **Transcripts are cheap; the game is where the player is** (PNL-08) | Text panels need no game time | They carry no timing, staging or sound | Panels decide what to build; sessions decide whether it reads in game. Both are named in every result (STN-03) |
| **A deceptive arm gives the cleanest test; it is also the riskiest** (ETX-01) | A placebo arm separates adaptation from the belief in it | Deception needs consent and debrief | The deceptive arm runs only in an ethics-checked panel, never in game, and after the cheaper arms |
| **Agents never run the game; machine-readable introspection exists** | `scene_report`, `world_probe` and the ledger give agents their own view | A person still has to run it | Sessions use the agent's view to cut human work (pre-capture checks, auto-diff of expected against observed) and keep people for what only they can judge |
| **Calibrate and validate on separate data; data are scarce** (VLD-09) | A pattern used to tune cannot test | The game's own data are limited, and the city is fictional | Split seeds and districts; use the game's own counts (GS-4) for calibration, and held-out patterns for validation |
| **Independent adversaries against cost** | A fresh agent finds what the builders cannot | Each adds usage | An adversarial pass on every composite change and every gating metric, in small runs; builders do not review their own metrics (STN-09) |
| **Session size against short waits** | One booking should answer many rows | No wait may run long; the player may stop at any comment | Fourteen sessions of 60 to 90 minutes, rows ordered by dependency, each row with its own short wait (GSN-02) |

## 9. Lateral links

- **A pattern register is the model's evaluation section.** The ODD protocol's first element, "purpose and patterns", is the same idea as the register: say what the model must reproduce before testing it (comparison only).
- **A twin run is a differential test across detail levels.** Where the ordinary differential test compares two implementations, this compares one implementation at two vantage points, under the foundation's rule that finer agrees with coarser.
- **A result record is event sourcing for evidence.** The plan hash, evidence kind and verdict are append-only; a later reading never edits an earlier one.
- **A session card is a test script for a person.** Its rows are test cases with preconditions, expected results and a "what to do if not", which is why they can be dry-run on the simulated port.
- **The anchor set is a pinned stimulus.** It is the evaluation's own `pin`: fixed, with a reason, and changed only on purpose.
- **A refuted feature is a rejected constraint.** The engine refuses a constraint it cannot hold and records why; the evaluation drops a feature it cannot support and records why.
- **Foils in a recognition test are the same idea as decoys in the audience-script list.** Both separate what V truly perceived from what V would say.
- **A brief and a debrief are the engine's own `offer` and `response`.** The session offers rows, records answers and leaves no state it was not asked to.

## 10. Open questions

1. **Are the criteria independent?** The criteria sheet assumes twelve separable qualities. The first pilot's correlations between items may merge some. Needs P-A and P-C pilots.
2. **What is the smallest effect of interest for each criterion?** No source gives one for generated game content. Each plan must set its own, and the first runs will show the spread.
3. **Does the authored-or-generated panel transfer across content types?** Detection of a gig brief may say nothing about detection of a bark. P-A stratifies by type, and the result decides whether one panel or five.
4. **How many worlds are enough for distributional agreement?** "At least 20" comes from the dossiers. The width of the interval across worlds will say.
5. **Who are the "players who know the game"?** The rater stratum needs a definition (hours played, whether the base game and its expansion are finished). A short screening question is the cheap answer; its effect on ratings is unknown.
6. **Can an agent write a good adversarial property?** DST-02 relies on property writers with imagination. A fresh-eyes pass will show how many mutation-test faults the properties miss.
7. **Does a spec-only reimplementation find real gaps?** VLD-08 is a hypothesis. One S1 process is the first test; the number of disagreements per page is the measure.
8. **Which verdict does the player-visible "why" panel give?** Whether pull access lowers annoyance against push (M20-13) has no study I found.
9. **When may a tester log leave the machine?** TRS-01 says "when the tester sends it". Whether a standing, revocable permission is acceptable needs the maintainer's decision.
10. **What is the right cadence for the anchor set?** Too fixed and it goes stale; too fresh and results are not comparable. The first two releases will show how fast content drifts.
11. **How should a failed acceptance session be re-run?** A fix and a re-run of the whole card costs a booking. Whether failed rows can run alone on the next booking, with the pass rule re-read, is a process choice.

## 11. Testing agenda: testing the evaluation itself

The evaluation is a system with its own failure modes. Same order: cheapest first.

### 11.1 Offline, on the reference model (do first)

1. **Mutation tests of the harness** (DST-09): plant a dead beat, a narrow `must`, a stuck seed, a swapped agent, a negation, a minor in a barred role, and a reload that reads the session. Each must be caught. Report the catch rate per fault class.
2. **The harness replays itself.** Run each battery twice with the same plan; outputs are byte-identical (M16-06). Change the plan hash and confirm the result prints as exploratory when the plan is missing.
3. **Relation library self-test.** For each metamorphic relation, confirm that a deliberately broken kernel fails it.
4. **Proxy validation, dry.** Take the proxies that gate (M21-02, M22-06, M18-16) and check that each has a row in the proxy table, with "none yet" where no panel has run.
5. **Dry-run every card on the offline simulated port** and record per row: whether the capability exists, the time it took, and whether the "expect" can be checked automatically (GSN-06).
6. **Panel scorer on synthetic ratings.** Feed generated ratings with known agreement, known effect sizes and known nulls; confirm the scorer's alpha, d-prime, intervals and verdicts come out as designed, including an equivalent verdict.

### 11.2 With people, away from the game (after the prototype)

- **Pilot every panel** (about 10 raters): check floors and ceilings, instruction clarity, agreement, and how long it takes. Revise before the decision run.
- **Criteria sheet pilot:** correlations between items; items that always move together are merged or dropped (STN-01).
- **Rater strata check:** do naive readers and players who know the game differ? Does a builder's rating differ from both (STN-09)?
- **Anchor set check:** re-rate a subset a week later; ratings should be stable.

### 11.3 In the game: the first real use

GS-1 is the first real use of the card format. Record per row: time taken against the estimate, rows skipped, rows that needed a re-explanation, rows whose "if not" was needed, and where the runner or the evidence capture failed. Revise the common frame (§6.1) from that before GS-2.

### 11.4 Longitudinal, with the programme itself

At each milestone: the share of runs with a plan hash; the verdict mix (how many equivalent and inconclusive results, which would show the plans are honest); the number of nulls published; the number of friction-log lines that became queued work; the number of proxies still without a panel check. A programme with no nulls after M3 deserves suspicion.

## 12. Requirements

Each requirement names what it extends and the principle or measure it traces to. IDs are `S23-<owner>-nn`. Fixture numbers for S0 and S2 are assigned by those specifications' owners; "provisional" means the number is a placeholder. The reference model implements S0 v3, so v4 items are listed as missing even though the specification has them.

### 12.1 P9 (the evaluation plan)

| # | Requirement | Traces to |
|---|---|---|
| S23-P9-01 | **Plans and plan hashes.** Every run has a plan file (question, arms, sample, smallest effect of interest, decision rule, equivalence bounds, held-fixed stage) committed before data exist. The harness hashes it and stamps the hash on the result; a result without one prints as exploratory | STN-06, NUL-02 |
| S23-P9-02 | **The criteria sheet.** The twelve criteria of §5.5, each its own item, with no total, and a report lint that refuses an "overall" column. Pilot correlations between items before the first decision run | STN-01, PNL-05 |
| S23-P9-03 | **The arm library.** Arms A0 to A10 of §5.4, with A1 (random-within-gates), A2 (fixed schedule, random release) and A3 (a Radiant-style baseline generator, defined by us) specified first, since M3 needs them. A comparison plan with no control is refused | STN-04, PNL-10 |
| S23-P9-04 | **The tier-1 batteries.** B1 to B14 of §5.3 with their exit rules, owners and cadence; each battery lists the measures it runs by MR group | §5.3, §7 |
| S23-P9-05 | **The pattern register.** For each S1 process: purpose, the patterns it must reproduce (ID, source, scale, band, tolerance), whether each was used to calibrate. A pattern used to calibrate is not used to validate | VLD-02, VLD-09 |
| S23-P9-06 | **Coarse-fine agreement.** Each process declares exact, count-exact or distributional agreement; `twin` runs world seeds by vantage pairs and tests against the declaration, with an interval | VLD-03, VLD-04 |
| S23-P9-07 | **Sensitivity sweep.** Every [J] constant in the dossiers and specifications is swept across its band on the calibration seeds; the report names the constants that move any pattern, which are the ones worth calibrating | VLD-09 |
| S23-P9-08 | **Many-world survey.** For each seed, a hit count over at least 200 worlds ("fits in 41 of 200"), cast spread per role, starvation and dead beats, replayable from one file | DST-07, DST-08, S2 §11.2 |
| S23-P9-09 | **Synthetic players with stated limits.** The named policies of DST-10, with a rule that any result from them is labelled "structural" and may not support a perception claim | DST-10 |
| S23-P9-10 | **Proxy validation.** No automatic text, variety or lint measure gates a merge until a panel check on our own content has a row in the proxy table | STN-02 |
| S23-P9-11 | **Panel kit.** Stimulus export from the session ledger, rating sheets (pairs, scales, foils, free report first), scorer (alpha, d-prime, effect sizes with intervals, equivalence verdicts), consent text and a pilot protocol | PNL-02, PNL-04, PNL-06 |
| S23-P9-12 | **Panel protocols.** P-A to P-M of §5.5 as plan templates, each with its held-fixed field, rater strata, starting size [J] and decision rule | PNL-01, PNL-07 |
| S23-P9-13 | **Stimulus pipelines.** Transcript export in the engine's own wording; stills and clips from the arrival-matrix runner; both record the content settings and the engine build | PNL-08, ETX-04 |
| S23-P9-14 | **The bounds register.** A smallest effect of interest and an equivalence bound per criterion, set after the first pilots and changed only by a recorded decision | NUL-02 |
| S23-P9-15 | **The session write-up.** A same-day template: rows passed, failed, not run; friction log turned into queued work; knowledge-page edits; nulls; the notice to XF · Meta-coordinator | GSN-09 |
| S23-P9-16 | **The session ledger specification.** What a session writes: gaps, grades, channels, activity, raw test values (for P9 only), offers shown and taken, dials, phase at quit. Local, consented, counts by default; M8-01 to M8-16 compute from it without running the engine | ETX-02, SES-10 |
| S23-P9-17 | **The tester programme.** Consent, opt-in local logs, diaries, the weekly check, the marker, the end interview, strata, withdrawal and deletion, redacted exports (§5.6) | TRS-01 to TRS-07 |
| S23-P9-18 | **The ethics checklist.** For any arm that varies what players see: who sees what, consent text, opt-out, debrief, what is deceived and why, how the data are kept. A deceptive arm is panel-only | ETX-01 |
| S23-P9-19 | **The read-set audit.** Static proof that no director, scorer or hook reads a tester datum, a raw perception value or a retention proxy | ETX-03, TRS-04 |
| S23-P9-20 | **Budgets and golden hashes.** A budgets file shared with P7 and a golden set of survey structural hashes; a changed hash needs a person's acknowledgement | DST-11 |
| S23-P9-21 | **The adversarial pass.** On every composite change and every gating metric, independent agents try to satisfy the metric with a plainly bad result. Each success fixes or drops the metric | P1 §2.6; D5 EV-16 |
| S23-P9-22 | **The corpus rating protocol.** Blind raters score the 73 base gigs on named criteria (story, voice, decision, replay), separate from reward, with line and choice counts withheld; the same protocol rates A3 and the engine's gigs | D4 QST-25; PNL-10 |
| S23-P9-23 | **Baselines without the engine.** `A_game` over hours of play (D7 M-15); the game's own repetition measures at the abstraction level of D5 §5.5; vanilla noticing priors | D7 M-15; D5 EV-6 |
| S23-P9-24 | **The community watch.** After public release, a small, aggregated watch for template-naming and complaint threads; public sources only; no personal data | TRS-06 |
| S23-P9-25 | **Gates by milestone.** §5.8 as a file the harness reads: which batteries, panels and sessions must be green for each milestone and for the beta | STN-07, STN-08 |
| S23-P9-26 | **The milestone report format.** Achieved, look at, test (plan §4), with the verdict table of the milestone's runs, nulls included | NUL-01 |
| S23-P9-27 | **Calibration and validation seed lists.** Disjoint, recorded in each plan, and never swapped after a result | VLD-09 |
| S23-P9-28 | **Stimulus hygiene.** Stimuli carry no spoilers and no save names; their settings vector is recorded and marked sensitive | ETX-04, ETX-05 |
| S23-P9-29 | **Evaluating the evaluation.** The tests of §11: mutation catch rates, harness replay, relation self-tests, dry runs, scorer on synthetic ratings, pilots | DST-09, §11 |
| S23-P9-30 | **Coexistence tests.** A compatibility check in the diagnostic profile for quality bar 10: reservation refusals, vanilla chains with the engine on and off, kill-switch restoration, clean removal mid-arc. Never run on a user's setup | Bar 10; D-12 |

### 12.2 S0 (the kernel): fixtures and invariants still missing

The reference model implements S0 v3 (F-1 to F-15, C-a to C-d, I-1 to I-15 and a determinism digest, per its README). Items below are not in it.

| # | Requirement | Traces to |
|---|---|---|
| S23-S0-01 | **The v4 fixtures and invariant.** F-16 to F-20 (session independence, jump against tick, widening keeps the truth, nested recall, lens invariance), F-21 and F-22 (cluster process, mid-cascade reload), F-23 to F-25 (implicit edges, aggregate, norm slot) and I-16, as S0 §16.1 and §15 state them. F-23 waits for implicit edge types, which are deferred (§0.2) | S0 V4-8, V4-13, V4-17, V4-20 |
| S23-S0-02 | **A property harness over generated operation scripts,** with the invariants I-1 to I-16 as properties, scripts drawn from named streams (seed logged), and shrinking by reducing the sequence of generator choices | DST-02, DST-03 |
| S23-S0-03 | **Partition and reload as properties.** Random tick partitions and random save and load points over generated scripts; identical records. Generalises F-13, F-21, F-22 and F-25 beyond 1 against 12 ticks | VLD-06, I-15 |
| S23-S0-04 | **Regeneration under random forgetting.** Forget at random times in random sessions; resolved values and the logical record equal a twin that never forgot; silence (I-13) holds on regeneration and replay | VLD-07, I-3, I-13 |
| S23-S0-05 | **A metamorphic relation library for the kernel.** Adding an unrelated node changes no other node's draw; renaming ids changes only ids; permuting independent operations inside a window changes nothing; scaling every weight changes nothing (I-7 at scale, beyond F-5's 1,000 nodes); raising a settings lens changes no pin | DST-04, I-7 |
| S23-S0-06 | **Summary and item agreement as a property.** For random summaries and scopes: items nest across scopes, ids are stable, counts are constant under reload and re-tick, canon items persist. Generalises F-7 | VLD-03, M14-16 |
| S23-S0-07 | **A `coarseFine` declaration on process registrations** (`exact`, `count`, or `distribution` with a tolerance), so the twin-run harness can pick the test. Optional field; the reference model ignores it | VLD-03 |
| S23-S0-08 | **Hard limits and worklist resumption.** Operations that exceed a hard limit return `failed` and leave no partial state; an interrupted worklist resumes deterministically; fault injection at every step | DST-05, I-10 |
| S23-S0-09 | **Damaged, truncated and foreign loads.** Truncate or flip a byte in generated saves: the load is classed damaged or foreign and never silently accepted; known, behind, unkeyed and new-game classes behave as specified (dossier 11 T11-07) | DST-05, S0 §14 |
| S23-S0-10 | **Second and third digest scripts.** The first digest leaves out read-only loads, fine-tier processes, `explain`, region scopes and policy hooks beyond the stub. Add a script for the v4 operations (`SettingsSet`, the sweep, `onRecall`) and one for fine tiers and `explain` | Reference README, cross-implementation check |
| S23-S0-11 | **Native-core docking.** A runner that feeds the same generated scripts to the reference model and the native core and compares hashes after every operation; the BLAKE3 and fdlibm `ln` ports compared first (S0 §17 open item 1); per-script golden traces | VLD-08 |
| S23-S0-12 | **A soak run.** 100 game-years on 20 seeds under the memory guard: record growth, retention and sweep floors hold, no runaway, work stays within the hard limits | VLD-11, M11-12, M18-04 |
| S23-S0-13 | **Never dropped, at every dial position.** Events V returned to and memorable beliefs are never dropped by the sweep, across every memory setting; the contradiction audit (M11-06, M11-07) as a property | M11-06 |
| S23-S0-14 | **Silence as a property.** Resolution, regeneration and replay under random scripts produce no changes and no relevance (I-13) | I-13 |
| S23-S0-15 | **Cross-platform arithmetic check at scale.** The binary64 computation of I-7 and the `ln` port agree across implementations on a million draws, not only the primitive vectors | I-1, I-7 |
| S23-S0-16 | **A gold set for relevance.** Fifty to a hundred hand-written "who should care about this event" cases with expected emitters, to measure precision and recall of relevance emission. It is the evidence that would trigger the revisit of compromise C-03 ("evaluation shows misplaced attention that recalibration can't fix") | S0 §17 C-03 |
| S23-S0-17 | **Session independence as a property.** Random perturbation of epoch, play clock, wall clock and load count over random scripts; identical records. Generalises F-16 and SF-27 | I-16 |

### 12.3 S2 (the seed language): fixtures and invariants still missing

S2's fixtures run SF-1 to SF-55 (with SF-26 appended). None covers the lint groups from dossiers 19 to 22.

| # | Requirement | Traces to |
|---|---|---|
| S23-S2-01 | **Lint coverage report.** A report listing every lint rule (L-1 to L-137) with its positive and negative fixtures, and which have none. A report, not a gate: its purpose is that a lint that never fires is noticed | DST-09, M16-02 |
| S23-S2-02 | **Fixtures for lint groups L-114 to L-137** (provisional SF numbers from SF-56): licence and game-text (L-114 to L-117), the stage lint (L-118), words (L-119 to L-130), model use (L-131 to L-137). Each: a seed that trips it, a seed that does not | dossier 19 T-01 to T-04; dossier 21 §11.1; dossier 22 §11.1 |
| S23-S2-03 | **Crash-point sweep.** Save and load between every pair of adjacent steps of R1 and of one scripted seed per profile (gig, job and heist, con, four-beat, front, testing arc, slide); the end state equals the uninterrupted run | DST-06, S2-I-6 |
| S23-S2-04 | **A seed-document generator and an awkward-state library.** Grammar-based generation of S2 documents: compile and lint never crash; findings carry a code and a place; text round-trips (SF-46 generalised). A library of named awkward sample states (key person dead; window closed; V wanted) and a read-only importer from a save's recorded facts | DST-02; D16 TST-05, S16-P10-03 |
| S23-S2-05 | **Lint soundness rate.** Seeds lint-clean at `ready` are surveyed over many worlds; the share that end `stuck` or in an unexplained state is the lint's false-negative rate, reported per release | DST-07 |
| S23-S2-06 | **Claim order as a property.** Authored and procedural seeds claiming the same person, over random permutations of casting order: the authored seed always keeps the role (S2-I-10), one `claim` entry each. Generalises SF-5 | S2-I-10 |
| S23-S2-07 | **No silent loss, and constructed causes, as properties.** Random faults and responses over running seeds: every refusal, failed preparation, rejected fixed part, lost role, expiry, miss, withering and stuck seed has a record entry (S2-I-5). Every constructed cause leaves the coarse record unchanged and contradicts no earlier exposure | S2-I-5; VLD-05; SF-26, SF-44 |
| S23-S2-08 | **Settings-matrix invariance.** Content ceilings over four setting vectors and 50 seeds; the settings lens property (SF-30) across random setting changes | M18-03; SF-30 |
| S23-S2-09 | **Structural invariance with a stub renderer.** A stub renderer and a tape in the reference model; the fixtures run with no model, a stub, a different stub and a different tape; structural hashes equal (S2-I-15). Needs the stub renderer in S7's first cut | M22-01; S2-I-15 |
| S23-S2-10 | **Fitting is a service.** The authored seed R1 fitted on several story states with sowing off and with sowing on gives the same fit report (verdict, windows, cast, draws, exits). This is M3's second done-when | Plan M3; D-03 |
| S23-S2-11 | **Arbiter stream property.** Random request streams: push caps hold, forbidden aspects are never delivered into, every expiry is quiet and named, and a tempo-off run releases only authored pushes (SF-10, SF-11 generalised) | D7 M-1, M-2, M-3 |
| S23-S2-12 | **Return invariance across gaps.** Any real-world gap in a save's age changes only the return view; every layer-2 decision is identical (S2-I-12). Generalises SF-31 | S2-I-12 |
| S23-S2-13 | **Released words are immutable.** A property over random sessions: a released delivery's text never changes, with the model on, off or changed between release and display | S2-I-16; SF-33 |
| S23-S2-14 | **Intersection order independence.** Two or more seeds touching the same person or place resolve identically whichever is evaluated first; the `pressure` and claim entries are the same | S2 §3, SF-13 |
| S23-S2-15 | **One acceptance story per profile.** Each profile in the starter pack has a fixture like SF-7: fit, cast, play, decline, resolve, with a save and load in the middle | S2 appendices |
| S23-S2-16 | **Survey and fit-report determinism.** The same pack, seeds and samples give byte-identical fit reports and survey outputs across runs and machines; a changed text unit changes no structural hash | M16-06, M16-08 |

### 12.4 P10 (tooling): the harness, the inspectors, the session ledger

| # | Requirement | Traces to |
|---|---|---|
| S23-P10-01 | **The evaluation harness.** One command line over the reference model and the author tools: `conform`, `replay`, `survey`, `twin`, `sweep`, `panel-export`, `report`. It takes a plan file, writes a result record, runs under the memory guard, and builds on the author CLI of S16-P10-01 | S23-P9-01, S23-P9-04 |
| S23-P10-02 | **A property and shrink library** for op scripts and seed documents: generators with logged seeds, shrinking by reducing generator choices | DST-02, DST-03 |
| S23-P10-03 | **Repro bundles** extended from seeds to kernel scripts and sessions: world seed, pack hashes, settings vector, session inputs, op script; `replay` reproduces byte for byte | DST-01; S16-P10-06 |
| S23-P10-04 | **The twin and docking runner.** Same script through two vantage points, two detail settings, or two implementations; compares by the declared agreement class and prints a diff | VLD-04, VLD-08 |
| S23-P10-05 | **The synthetic player library.** Named policies (decline-all, accept-all, farm, maximise-return, off-plan, audience script, do-nothing), a repeat-choice option, a timeout on every run | DST-07, DST-10 |
| S23-P10-06 | **The survey runner and sample library.** Many-world hit counts, cast spread, coverage heat maps in the style of randomtest hit counts, and the awkward-state library with a save importer that keeps no personal data | DST-07, S23-S2-04; S16-P10-03, S16-P10-05 |
| S23-P10-07 | **The sensitivity sweep tool.** Vary each [J] across its band on the calibration seeds; report which outputs move | VLD-09 |
| S23-P10-08 | **The pattern register evaluator.** Bands, plots (Lorenz curves, near-repeat excess, delay law), per-seed and pooled verdicts | VLD-02 |
| S23-P10-09 | **The session ledger, both ways.** The engine-side writer and the harness-side reader of the per-session ledger (SES-10 extended with raw test values, consent flags and redaction), from which M8-01 to M8-16 compute without running the engine. And a register of sessions: which cards were booked, which rows passed, failed or were not run, over time | S23-P9-16; D8 SES-10 |
| S23-P10-10 | **The session runner and cards as data.** Cards as files (rows with who, do, expect, if-not, evidence, feeds), printable as a checklist; a runner that posts `ask`s through the bridge, saves answers, diffs expected against observed, times each row against its budget, and has a `--simulated` mode on the offline port | GSN-02, GSN-03, GSN-06 |
| S23-P10-11 | **Inspectors.** The existing ones (the "week in a district" and "who knows whom" inspectors, the explain tool, `story.why` and `story.scene`, the cause-chain timeline, the derivation preview, the brief-candidate-gate view, time-scrub replay) get one front door. New for evaluation: a twin-run diff viewer showing coarse and fine side by side; a run diff by subsystem structural hash; a criteria board showing panel results by criterion with intervals and verdicts | S14-S2-10, S15-S2-10, S20-P10-01 to -13, S16-P10-04 |
| S23-P10-12 | **The panel kit tools.** A stimulus builder from the ledger, rating sheet generator (pairs, scales, foils, free report first), the anchor bank, and the scorer | S23-P9-11, S20-P10-04 |
| S23-P10-13 | **Game-side evidence automation.** Capture steps with `expect`, `capture_sheet`, `scene_report`, the arrival-matrix runner, `session_note` markers per row; results written into the evidence folder with the manifest | S20-P10-03; GSN-08 |
| S23-P10-14 | **The tester package.** The opt-in log exporter that shows its contents and strips paths and save names; consent record; withdraw and delete; the one-key marker; the diary prompts | TRS-01, TRS-07 |
| S23-P10-15 | **The results ledger.** Append-only result records with plan hash, evidence kind, verdict and limits, queryable; a generator that drafts a knowledge-page entry (nulls included) from a record | NUL-01, NUL-04 |
| S23-P10-16 | **The fault-seeding tool.** Plant the faults of DST-09 into fixtures and packs and report the harness's catch rate per class | DST-09 |
| S23-P10-17 | **The budget dashboard.** Tick cost, record growth, start-up, frame time and render time over versions, from B13 and GS-11, against P7's budgets | DST-11 |
| S23-P10-18 | **The redaction scanner.** Before any export, report or knowledge-page edit leaves `local/`, scan for save names, paths and locations | ETX-05 |

## Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give. Reliability measurement (EVA-01's neighbour), property-based testing and the verification and validation of simulation models are partly on the map under EVA-01, EVA-02 and SYS-01; the entries below are the parts that are not named.

| # | Field | Source | Tier |
|---|---|---|---|
| MM-1 | **Test-case reduction (shrinking) for generated tests** | MacIver and Donaldson 2020 (abstract summary) | Core for EVA-02. The map names property checks and shrinking in its row text but gives no source for the reduction method; DST-03 rests on it |
| MM-2 | **Metamorphic testing** (relations between outputs where no oracle exists) | Segura and colleagues 2016 (abstract summary) | Core for EVA-02 and for P9's text layer (structural invariance with the model off, on or changed). Not on the map |
| MM-3 | **Equivalence testing and the reporting of null results** | Lakens 2017 (abstract summary) | Core for P9. The map says nothing on how to report "no difference"; NUL-02 rests on it |
| MM-4 | **Inter-rater reliability** (Krippendorff's alpha and alternatives) | Hayes and Krippendorff 2007 (abstract summary); one later commentary disputes alpha as the best index (seen in a result title only) | Supporting, for EVA-01 |
| MM-5 | **Verification and validation vocabulary for simulation models** (conceptual validity, verification, operational validity, data validity) | Sargent 2013 (abstract summary) | Supporting, next to SYS-01 |
| MM-6 | **Empirical validation of agent-based models, and its alternatives** (indirect calibration, empirical calibration, history-friendly) | Windrum, Fagiolo and Moneta 2007 (abstract read) | Supporting; already the source for SYS-01, but its three approaches are not named on the map |
| MM-7 | **Introspection limits and verbal reports** | Nisbett and Wilson 1977 (abstract summary) | Supporting; already behind dossier 13's CNF-01, not on the map as a field |
| MM-8 | **Ablation as a design practice for generated systems** | Dossier 6 R-25(c) and T-3; no external source read | Supporting, EVA-01 |
| MM-9 | **Think-aloud, diary and experience-sampling methods for early testing** | None read | Supporting, for the tester tier (§5.6). A targeted look is needed before a diary form is fixed |
| MM-10 | **Multiple comparisons and sequential testing in small panels** | None read | Supporting; the plan relies on pre-registered decisions and intervals, but a source on small-sample panels is missing |
| MM-11 | **Differential and N-version testing of independent implementations** | None read | Supporting, for docking a native core (VLD-08); the method name is common practice and I found no source in this session |

## Corrections after credit verification

What this dossier found when it checked its inputs, so that later credit verification starts from the right place.

| Source | What the map, a lens or the brief said | What the source shows |
|---|---|---|
| Chhun and colleagues, COLING 2022 | Map EVA-01: authors Chhun, Colombo, Suchanek and Clavel | The arXiv page gives Chhun, Colombo, Clavel, Suchanek |
| Brom and colleagues, IVA 2007 | Map LOD-02: "Šéry" | The listings give Šerý |
| Klepek, Vice | Map EVA-03: 2020 | The search result places the essay in a later series and mentions a game from 2022. Not read; unused |
| The kernel specification | The brief and the map's tension rows say the kernel and dossier 6 reject a single tellability number | The kernel specification contains no tellability number; it keeps the mechanism and points to dossier 6. The rejection is in dossier 6 (TEL-14, R-13) |
| Kramer, Guillory and Hancock, PNAS | Link to the article | The publisher page refused retrieval (HTTP 403). Findings rest on the editorial's text as reproduced in copies and on commentary; the link below is the DOI, not a page I read |
| Töpfer and Pillewizer 1966 | Map LOD-03: *The Cartographic Journal* 3(1):10-16 | A bibliographic page confirmed the authors and title but not the journal or date. Not used |
| Wilson, Strange Loop | Map EVA-02: Strange Loop 2014 | The conference listing is titled 2014; one other page calls it 2015. Content not seen |

## Credit candidates

Each work below taught us something used in the principles. Authors and titles are as the pages retrieved in this session show them. "Abstract only" means no more than the abstract or a search summary was seen.

| Creator | Title | Link | What we learned |
|---|---|---|---|
| Cyril Chhun, Pierre Colombo, Chloé Clavel, Fabian M. Suchanek | "Of Human Criteria and Automatic Metrics: A Benchmark of the Evaluation of Story Generation", COLING 2022 | https://arxiv.org/abs/2208.11646 | A benchmark that rates stories on six orthogonal human criteria found weaknesses in current automatic metrics (abstract) |
| Volker Grimm and 18 co-authors | "The ODD Protocol for Describing Agent-Based and Other Simulation Models: A Second Update to Improve Clarity, Replication, and Structural Realism", *JASSS* 23(2), 7 (2020) | https://www.jasss.org/23/2/7.html | A standard description format whose first element names the patterns used to evaluate a model, and whose aim is that a reader can reimplement it |
| V. Grimm, E. Revilla, U. Berger, F. Jeltsch, W. M. Mooij, S. F. Railsback, H. Thulke, J. Weiner, T. Wiegand, D. DeAngelis | "Pattern-oriented modeling of agent-based complex systems: lessons from ecology", *Science* 310(5750):987-991 (2005) | https://pubs.usgs.gov/publication/70161783 | Matching several patterns to design, test and analyse bottom-up models (abstract only) |
| Axtell, Axelrod, Epstein and Cohen (first names not shown on the pages seen) | "Aligning simulation models: a case study and results", *Computational and Mathematical Organization Theory* 1(2):123-141 (1996) | https://link.springer.com/doi/10.1007/BF01299065 | "Docking": checking whether two models can give the same results (abstract only) |
| Paul Windrum, Giorgio Fagiolo, Alessio Moneta | "Empirical Validation of Agent-Based Models: Alternatives and Prospects", *JASSS* 10(2), 8 (2007) | https://www.jasss.org/10/2/8.html | Validating agent-based models is hard in general, and the method chosen matters |
| Sargent (first name not shown on the pages seen) | "Verification and validation of simulation models", *Journal of Simulation* 7:12-24 (2013) | https://doi.org/10.1057/jos.2012.20 | Conceptual, verification, operational and data validity as separate tests (abstract only) |
| Claessen and Hughes (first names not shown on the pages seen) | "QuickCheck: a lightweight tool for random testing of Haskell programs", ICFP 2000 | https://research.chalmers.se/publication/237427 | Properties written as functions and tested on random input with custom generators (abstract only) |
| Will Wilson | "Testing Distributed Systems w/ Deterministic Simulation", Strange Loop 2014 | https://thestrangeloop.com/2014/testing-distributed-systems-w-slash-deterministic-simulation.html | The existence of a deterministic simulation framework as a testing approach (listing only; the talk was not seen) |
| David R. MacIver, Alastair F. Donaldson | "Test-Case Reduction via Test-Case Generation: Insights from the Hypothesis Reducer", ECOOP 2020 | https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2020.13 | Reducing the sequence of generator choices keeps reduced tests valid (abstract only) |
| Sergio Segura, with Fraser, Sánchez and Ruiz-Cortés (their first names not shown on the pages seen) | "A Survey on Metamorphic Testing", *IEEE Transactions on Software Engineering* 42(9):805-824 (2016) | https://doi.org/10.1109/TSE.2016.2532875 | Checking relations between outputs of transformed inputs where there is no oracle (abstract only) |
| Rachel E. Towers (Choice of Games) | "How to get the most out of automated testing, part 2" (2018), and the ChoiceScript page "Testing ChoiceScript games automatically" | https://www.choiceofgames.com/2018/01/how-to-get-the-most-out-of-automated-testing-part-2/ ; https://www.choiceofgames.com/make-your-own-games/testing-choicescript-games-automatically | What random-play and exhaustive tools catch, what they miss, and how hit counts guide balance |
| Hamstra, Brydges, Hatala, Zendejas and Cook (first names not shown on the pages seen) | "Reconsidering fidelity in simulation-based training", *Academic Medicine* 89(3):387-392 (2014) | https://mayoclinic.elsevierpure.com/en/publications/reconsidering-fidelity-in-simulation-based-training | Physical resemblance appeared independent of educational effectiveness; functional correspondence matters (abstract only) |
| Jenny W. Rudolph, Daniel B. Raemer, Robert Simon | "Establishing a safe container for learning in simulation: the role of the presimulation briefing", *Simulation in Healthcare* 9(6):339-349 (2014) | https://psnet.ahrq.gov/issue/establishing-safe-container-learning-simulation-role-presimulation-briefing | Expectations, a fiction contract, logistics and a commitment to respect as the parts of a good briefing (abstract and summaries only) |
| Kramer, Guillory and Hancock (first names not shown on the pages seen); the editors of PNAS | "Experimental evidence of massive-scale emotional contagion through social networks", *PNAS* (2014), and the editorial expression of concern | https://doi.org/10.1073/pnas.1320040111 | A large experiment that varied what people saw drew a published concern about informed consent and opt-out (editorial text as copied elsewhere; the publisher page was not retrieved) |
| David Dittrich, Erin Kenneally | "The Menlo Report: Ethical Principles Guiding Information and Communication Technology Research" (2012) | https://papers.ssrn.com/abstract=2445102 | The Belmont principles adapted to ICT research (abstract only) |
| National Commission for the Protection of Human Subjects of Biomedical and Behavioral Research | The Belmont Report (1979) | https://www.hhs.gov/ohrp/sites/default/files/the-belmont-report-508c_FINAL.pdf | Respect for persons, beneficence and justice as the basis of consent and risk balancing (search summaries only) |
| Magy Seif El-Nasr, Erica Kleinman | "Data-Driven Game Development: Ethical Considerations", FDG 2020 | https://arxiv.org/abs/2006.10808 | Biased or incomplete data and opaque models as risks to trust in data-driven game development (abstract only) |
| Philip Hingston | "A Turing test for computer game bots", *IEEE Transactions on Computational Intelligence and AI in Games* 1(3):169-186 (2009) | https://ro.ecu.edu.au/ecuworks/594 | A judge-based test of whether bots pass as human, as a model for blind authored-or-generated panels (abstract and a poster summary) |
| Vero Vanden Abeele, Lennart Nacke, Spiel, Johnson and Gerling (the last three first names not shown on the pages seen) | "Development and validation of the player experience inventory", *International Journal of Human-Computer Studies* 135:102370 (2020) | https://doi.org/10.1016/j.ijhcs.2019.102370 | A validated two-level player-experience scale built with 64 experts and tested in five studies (abstract summary) |
| Daniël Lakens | "Equivalence Tests: A Practical Primer for t Tests, Correlations, and Meta-Analyses", 2017 (DOI 10.1177/1948550617697177; the journal name was not shown on the pages seen) | https://pmc.ncbi.nlm.nih.gov/articles/PMC5502906 | A non-significant result is not evidence of absence; equivalence bounds come from the smallest effect of interest (abstract summary) |
| Andrew F. Hayes, Klaus Krippendorff | "Answering the call for a standard reliability measure for coding data", *Communication Methods and Measures* 1(1):77-89 (2007) | https://www.tandfonline.com/doi/10.1080/19312450709336664 | Krippendorff's alpha applies across observers, scales, sample sizes and missing data (abstract summary) |
| Richard E. Nisbett and Wilson (his first name not shown on the pages seen) | "Telling more than we can know: verbal reports on mental processes", *Psychological Review* 84:231-259 (1977) | https://deepblue.lib.umich.edu/items/c810051d-bb3a-48c7-86ae-da8ef48caa77 | People's explanations of their own behaviour may draw on theories, not direct access (abstract summary) |
| Paul K. Davis, Richard Hillestad | "Families of Models that Cross Levels of Resolution: Issues for Design, Calibration and Management", Winter Simulation Conference 1993 | https://doi.org/10.1109/WSC.1993.718351 | Variable-resolution modelling and consistency across resolutions as a quality notion (search summary only; comparison only) |
| Rahmandad and Sterman (first names not shown on the pages seen) | "Heterogeneity and Network Structure in the Dynamics of Diffusion: Comparing Agent-Based and Differential Equation Models", *Management Science* 54(5):998-1014 (2008) | https://ideas.repec.org/a/inm/ormnsc/v54y2008i5p998-1014.html | Differences in means can be small against variability from stochastic events, parameters and model boundary (abstract summary; comparison only) |
| Cyril Brom, Ondřej Šerý, Tomáš Poch | "Simulation Level of Detail for Virtual Humans", IVA 2007, LNCS 4722:1-14 | https://artemis.ms.mff.cuni.cz/main/papers/IVE_IVA07.pdf | Simulation level of detail with several degrees of detail has had little attention (abstract and listings; comparison only) |
| Jason Grinblat | "Procedurally Generating History in Caves of Qud", GDC 2018 | https://gdcvault.com/play/1024990/Procedurally-Generating-History-in-Caves | Generating events first and rationalising them afterwards, as a way to avoid a full simulation (description only; comparison only) |
| Know Your Meme (entry for "Another Settlement Needs Our Help") | Entry page | https://knowyourmeme.com/memes/another-settlement-needs-our-help | A repetitive generated quest pattern in Fallout 4 was named in a forum thread seven days after launch |
