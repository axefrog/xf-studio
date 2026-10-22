# Dossier 12: the player model, trust and manipulation

**Status:** v1, 23 October 2026. Dossier 12 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: MOT-02 (player typologies and player modelling), MOT-05 (trust, perceived manipulation and dark patterns), ETH-20 (ethics of player modelling and affective computing) and NAR-15 (disposition and moral allegiance). Supporting fields: MOT-03 (appeal-based matching) and ETH-12 (privacy law and inference rights). Feeds S2 (the seeding layer) and P5/S3 (the director). It serves quality bars 1, 4 and 8 ([plan §1](../plan.md#1-what-doesnt-suck-means)). It builds on [dossier 1](d01-motivation-drives.md) (DRV-46 to DRV-49), [dossier 7](d07-direction-pacing.md) (DIR-01, DIR-02, DIR-07, DIR-22, DIR-35 to DIR-39, DIR-53, PR-2, PR-21), [dossier 9](d09-agency-consequence.md) (AGY-14, AGY-20, AGY-42 to AGY-44, AGY-51, R5-23, R6-18) and [dossier 11](d11-saves-memory-forgetting.md) (BRN-04, FGT-03, RLD-01).

**How far each source was read.** *Full text* means I read the paper or page this session (PDFs converted locally). *Record* or *abstract* means I read a catalogue record or abstract only. *Summary* means a search-engine summary or another work's account of it, so I cite only what the summary states. Where a lens claim did not hold up, §3.3 says so. Fetched web pages come back through a summarising tool, so their wording is paraphrase.

## In brief

- **The line between serving and steering can be made into checks, because the engine has one narrow place where a model of V can act.** The model reaches the world through five S3 hooks (fitting, form, phase, scoring, joint) and through V's inferred frames, and S2 already fixes what those may touch. Eight checks follow from that: the model chooses *which true, declinable offers* appear and *when*, and nothing else. It never changes what an offer contains, never acts while V is deciding, never selects who is hurt, never reads a moment of strain except to hold back, and never gets a retention objective. Each check has a replay test (§5.4). The literature on manipulation says the same thing in other words: persuasion is open and manipulation is covert and exploits weakness (Susser and colleagues), and dark patterns share a small set of attributes (Mathur and colleagues, six of them, §3.1).
- **The model should be a table of response rates over the content's own features, not a portrait of V.** The typologies are weak: a 2024 study of four of them (877 people) found heavy overlap and reduced them to five continuous dimensions, and PaSSAGE's one controlled study (90 students) showed no overall effect, only subgroup effects. So the facets are rates such as "accepted 4 of 6 displayed quiet jobs", keyed to the six skeleton features S2 already computes (verb, stake, relationship, outcome, tone, channel). That vocabulary is inspectable, needs no new content work and has no slot for emotion, health or motive. It challenges the draft in DRV-49, which infers a distribution over drive profiles: that is a trait model of V, and it should go.
- **Estimate against exposure, not against acceptances.** The engine's own offers decide what V can accept, so a naive count teaches the model its own earlier choices. Simulation work shows that this feedback homogenises behaviour without raising utility. The estimator therefore counts only *displayed* offers, treats the unseen as unknown and keeps a bounded exploration quota (§5.3). Every number is derived by a fold over canon `offer` and `response` events, so it is reload-stable (I-16), branch-local (BRN-04) and resettable by moving a floor, with the world's record untouched. This needs one change to S2: those events must carry the offer's skeleton features, because the seed record is capped and forgets (S12-S2-07).
- **Make every control a verb on the engine, never a statement about V.** D-09 says no setting declares V's drives. "Show fewer jobs like this", "stop using this", "start fresh" are engine controls and fit the rule; "I prefer stealth" does not. The same rule settles the open-model question: V gets a pull-only page of what has been noticed, each row backed by the events behind it, with those controls and no scores. Evidence for the design is mixed and mostly indirect (§3.3), so it is a testing agenda (§11), not a finding.
- **How an outcome lands is a question of staging, not selection.** The same event can read as justice, loss or insult depending on V's stance toward the people involved and on V's own part, and guilt after unjustified virtual violence is measurable. The engine can track a coarse orientation toward each NPC (toward, against, mixed, unformed) from V's acts. It uses that only to choose *how* a world-caused outcome is shown and which outlets come with it. It never uses it to choose the outcome, and never to choose whom to hurt (the "no hostage" rule, LND-06).
- **Adaptation that works only while hidden is a steer, and a placebo is worse.** A study that quietly sped or slowed a game timer raised immersion in 42 players and nobody noticed. A later pair of studies found that merely *telling* players the game adapts raised immersion whether or not it did. So the temptation to claim personalisation we do not have is real, and the rule is that the noticed page is generated from the model itself (LIN-09).

## 1. Scope and why it matters here

The director's belief about V is the engine's only handle on relevance (D-09), and it is also a retention engine by construction if left unchecked (dossier 7, T-8). This dossier asks what the engine may believe about V, from which signals, with what confidence and for how long; how it predicts how an outcome will land; where adaptation becomes manipulation and what a check for that looks like; which dark patterns are forbidden; what V can see and reset; and what stays private.

| Layer or concern | What this dossier gives it |
|---|---|
| 1. Simulation (S0, S1) | Where the model's beliefs live (S0 §11.3), what they may contain, and the settings ops that make resets replayable |
| 2. Seeding (S2) | A firewall between the model and every predicate; the events the model folds from; bounds on the hooks; the why-record; honesty lexicon additions; fixtures |
| 3. Procedural engine (S3, P5) | The facet vocabulary, the estimator, the influence function, the orientation index, staging, the dark-pattern gate and the evaluation harness |
| 4. Authored content (P6) | What an author may and may not reference (record facts, not the model), and what staging an outcome must carry |
| Player configuration (C) | The `noticing` dial, per-facet controls, the reset, the noticed page and the one-time disclosure |
| Evaluation (E) | Eighteen measures (§7) and a testing agenda (§11) |
| Expression (X) | The voice rules: no system or narrator statement about what was noticed; counts only from a speaker's own witnessing |

**What it does not cover.** Content intensity, consent and age gates, and the veils and lines themselves (dossier 18; this dossier says only that stated settings beat inference). Pacing mechanics and the arbiter (dossier 7). The form of callbacks and their wording (dossier 21). Relationship ladders (dossier 2). Rights to the data in law (dossier 19; §5.5 flags what to ask). The reputation network as social structure (dossier 15). Reload and forgetting rules (dossier 11), except where the model must obey them.

**What is already settled and used as given.**
- **V is observed, never owned** (D-09, S0 I-12, S2-I-7). The engine holds beliefs about V; it never sets V's drives and never speaks for V.
- **Everyone has their own model** (D-10). Beliefs sit in the believer, read through `knows` (S0 §11.4).
- **NPCs may voice their own belief about V's motive** under four conditions (D-22; S2 §2.9; L-52).
- **Adaptations are silent and are not consequences** (AGY-42): an adaptation only changes *which true offers are made*, and is a belief-caused record.
- **The director's verbs and manipulativity classes** (DIR-02, PR-2): class 4, changing anything V has observed or could base a choice on, must not exist.
- **The director's objective has no retention term** (DIR-07).
- **Reactive pacing only subtracts** (DIR-35); director meters stay hidden (DIR-53).
- **Offers are stable once made** (S2-I-6), **no wall clock** (S2-I-12) and **session independence** (S0 I-16).

## 2. The failure record

Failures come first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses patterns, §2.3 lists where the advice itself fails.

### 2.1 Cases

| # | Case | What was tried | What went wrong | Evidence |
|---|---|---|---|---|
| F-01 | **PaSSAGE's player types** (Thue and colleagues, 2007) | A player model of five weights (fighter, power gamer, tactician, storyteller, method actor), taken from tabletop advice, updated by designer-set deltas on the player's choices, and used to pick which story encounter comes next. Study: 90 university students, one of three stories each (two fixed, one adaptive) | The paper says the all-participants data fail to strongly support either hypothesis (more fun, more agency). Support appears in filtered subgroups: women who found the game easy to follow (93 per cent confidence for fun, 86 for agency), and a weaker 80 per cent (for fun) among experienced players who found it easy to follow, on the two fixed paths. The types were not derived from data | *Full text*. [empirical]; one game, small cells, many filters |
| F-02 | **Typologies do not measure what they claim** | Bartle's types, Yee's motivations, BrainHex and HEXAD, used to tailor games | A 2024 study of all four with their own instruments (877 participants) found considerable overlap, some results that contradicted theory, and five underlying dimensions. The authors recommend continuous measures over fixed types and cite severe validity and reliability criticism | *Record* (Bamberg repository). [empirical] |
| F-03 | **Hidden adaptation that worked, and that was a deception** (Denisova and Cairns, 2015) | A 90-second game whose timer sped up for strong players and slowed for weak ones | 42 volunteers (22 adapted, 20 control); the adapted group was more immersed (F(1,40) = 7.41, p = 0.010, partial eta squared 0.156). No participant reported noticing the change, and players believed they had finished in the stated time. The authors warn that awareness over repeated play may leave players feeling short-changed, and say little is known about how single-player adaptation is perceived | *Full text*. [empirical]; one short session. It also shows adaptation that depends on a false clock |
| F-04 | **Telling players works even when it is false** (Denisova and Cairns, 2019) | Two games, two adaptation methods; participants were told the game adapts, independently of whether it did | Players felt more immersed when told, whether or not the adaptation was present, in both games and in longer sessions. The authors suggest developers need not fear telling players. The same result means a *claim* of personalisation can be used as a lever | *Abstract*. [empirical]; sample sizes not seen |
| F-05 | **Invisible algorithms shock people when found** (Eslami and colleagues, 2015) | A tool showed 40 Facebook users the gap between their curated feed and the unfiltered one | 62.5 per cent did not know the feed was curated. They reacted first with surprise and anger, and many blamed friends for what was missing. After becoming aware, satisfaction stayed about the same, engagement rose and so did the sense of control | *Abstract and summaries*. [empirical]; a social feed, not a game |
| F-06 | **Personalisation can be useful and creepy at once** (Ur and colleagues, 2012; White and colleagues, 2008) | Interviews (48 people) on online behavioural advertising; a study of highly personalised email offers | Participants called targeting useful and privacy-invading together, were surprised that browsing history fed it, and believed advertisers collected more than they did. In the email study, highly personalised offers that did not explain why they fitted drew *personalisation reactance*, less so where the service seemed useful | *Abstracts and press coverage*. [empirical]; advertising and undergraduates |
| F-07 | **Recommenders narrow what people see** (Nguyen and colleagues, 2014; Chaney and colleagues, 2018) | Longitudinal MovieLens data; simulations of recommenders retrained on their own influenced data | A slight narrowing over time, less for people who consumed what was recommended. In simulation, the feedback loop homogenised behaviour without improving utility and strengthened the system's influence | *Abstracts*. [empirical] (observational and simulation) |
| F-08 | **Appointment and withering in a shipped game family** (FarmVille and its kind, in Zagal and colleagues) | Crops ready in real time that wither if not harvested, so play follows the game's schedule | Named as a dark pattern: players orient their lives to the game's obligations. The paper notes the same timing can be harmless when nothing depends on it, as with a rare spawn that does not block progress | *Full text*. [analysis]. See also dossier 11, F-04 (Animal Crossing) |
| F-09 | **A model that shows itself can mislead** (Zhu and Seif El-Nasr, 2021; Kulesza and colleagues, 2013) | Position paper on open player models; a study of explanations for music recommendations | The first says player models are rarely accurate, so opening them raises accountability and gaming questions, and that exposure can interrupt immersion. Its own case study is unvalidated. The second found that very low soundness cost participants trust in the explanations and raised mental demand, while completeness helped their mental models more than soundness | *Full text* (Zhu); *abstract* (Kulesza). [analysis]; [empirical] |
| F-10 | **Behaviour data identifies people** (Nair and colleagues, 2023) | Head and hand motion from VR play (55,541 users in the published version) | About 73 per cent were identified from 10 seconds of motion and about 94 per cent from 100 seconds, after five minutes of training data each | *Abstract*. [empirical]; VR rhythm game, not our inputs |

### 2.2 What the failures have in common

1. **A model fitted to the designer's categories reports the designer's categories.** PaSSAGE's types came from tabletop advice and its deltas from the designer's guess, and the typologies do not hold up against data (F-01, F-02). A model of rates over the content's own features has no such gap, though it inherits whatever the content under-represents.
2. **The system's own choices contaminate its evidence.** What V accepts depends on what was offered (F-07). Every estimator for this engine needs the denominator.
3. **Adaptation works best when unseen and is judged on fairness when seen, and the judgement is mostly unstudied** (F-03, F-05). The two-sided evidence is that hidden use is risky when discovered (F-05) and disclosure appears harmless in the cases tested (F-04, F-05). Neither is a study of a narrative director.
4. **A claim of adaptation is itself a lever** (F-04). So honesty about the mechanism is not only an ethical nicety. It is the guard against the cheapest form of manipulation.
5. **Showing a model is only as good as the model** (F-09). A page full of confident, wrong statements costs trust. The page must state less than the model holds, and show the evidence for each line.
6. **Personal data from play is identifying, even when it looks like gameplay** (F-10). Local storage is not enough; where the data goes when shared matters too.

### 2.3 Where the advice itself fails

| Advice | Where it fails |
|---|---|
| "Model behaviour, not types" (L3; MOT-02's map note) | Behaviour counts are also open to confounding by the engine's own offers (F-07), and per-player histories are sparse early on. Rates need an exposure denominator and a prior (INF-03, INF-04) |
| "Adaptation below the detection threshold is best" (Denisova and Cairns; L3 field 19) | The threshold result rests on a deceptive timer in a 90-second game. A rule built on it ("adapt if they cannot tell") is exactly the covertness that manipulation theory flags. The usable lesson is the opposite one: design adaptation that survives being revealed (LIN-02) |
| "One wrong personalised offer costs more trust than one wrong authored offer" (L3 field 19, citing algorithm aversion) | Dietvorst and colleagues showed that people lose confidence in a *forecasting algorithm* faster than in a human after the same error. Nothing I found tests offers in a game. It stays a hypothesis; §11 tests it |
| "Make the basis of an offer inspectable on demand" (L3 principle 3) | Plausible, and the explanation literature agrees that explanations raise awareness, but Rader and colleagues found they were weaker at helping people judge whether the system was *correct*. And an unsound explanation costs trust (F-09). The reason must be true, brief and backed by events V saw |
| "Show the player the model" (open player modelling) | A position paper with an unvalidated case study (F-09). It also names the costs: immersion, gaming, inaccuracy and privacy. The design here borrows its three levels of openness and tests the costs |
| "Stated beats inferred" (L10, ETH-20) | Self-reports predict behaviour poorly (Nisbett and Wilson, via L3 field 18, not re-read). So stated settings should govern *boundaries* (what may appear, how often, what to stop using), and inference should govern *taste* within those bounds, never the reverse |
| "Detect compulsion or vulnerability and protect the player" (the wellbeing framing, L10 field 15) | Doing so is itself profiling, and the same signal that detects a vulnerable player is the one a manipulator would use (Susser and colleagues). The resolution is a player-set cue, not an inferred one (MDL-04) |
| "Disposition theory predicts how the audience will feel" (NAR-15) | It was built for films and television, where the audience does not act. It does not model the player's own judgement of their choices, and the sources behind the map row are thin (§3.3) |

## 3. Sources

### 3.1 Read

| Source | How far | Used for |
|---|---|---|
| Zagal, Björk and Lewis, "Dark Patterns in the Design of Games", FDG 2013 | Full text | The definition (a pattern used intentionally by a creator to cause negative experiences against players' best interests and without their consent); three families (time, money, social capital); the point that consent needs literacy in the manipulation; the Disclosure Principle quoted from Berdichevsky and Neuenschwander (DRK-01 to DRK-07, LIN-02) |
| Zhu and Seif El-Nasr, "Open Player Modeling: Empowering Players through Data Transparency", arXiv 2110.05810 | Full text | Three levels of openness (outcome, process, editable); the cost list; model types (descriptive, predictive, reflective); the Yannakakis and colleagues 2013 taxonomy (TRN-01, TRN-03, TRN-08) |
| Thue, Bulitko, Spetch and Wasylishen, "Interactive Storytelling: A Player Modelling Approach", AIIDE 2007 | Full text (author copy) | F-01; a weight-vector model updated by designer deltas; encounter selection by inner product; hinting (INF-01, INF-09) |
| Denisova and Cairns, "Adaptation in Digital Games: The Effect of Challenge Adjustment on Player Performance and Experience", CHI PLAY 2015 | Full text | F-03 (LIN-02, LIN-09) |
| Susser, Roessler and Nissenbaum, "Technology, autonomy, and manipulation", *Internet Policy Review* 2019 | Opened (summarised by the fetch tool) | Manipulation as covert influence exploiting decision-making vulnerabilities; surveillance, adaptivity and invisibility as the enablers (LIN-01, LIN-06) |
| Mathur, Mayer and Kshirsagar, "What Makes a Dark Pattern... Dark?", CHI 2021 | Opened (first part of the full text) | Six design attributes: asymmetric, covert, deceptive, information hiding, restrictive, disparate treatment; four normative perspectives (§5.4, §5.5, LIN-08) |
| Dossiers 1, 2, 7, 9, 11; S0 and S2 | Opened (the cited parts) | The settled rules in §1 and the hooks, events and ledgers the requirements extend |

### 3.2 Summary, record or abstract only

| Source | What I saw | Used for |
|---|---|---|
| Melhart, Togelius, Mikkelsen, Holmgård and Yannakakis, "The Ethics of AI in Games", arXiv 2305.07392 | Abstract: the affective loop (elicit, sense, detect) and the privacy against safe-spaces trade-off in sensing, and transparency and ownership in detection | MDL-04, LND-08, PRV-01 |
| Denisova and Cairns, "Player experience and deceptive expectations of difficulty adaptation in digital games", *Entertainment Computing* 29, 2019 | Abstract (two repository records) | F-04, LIN-09 |
| Dietvorst, Simmons and Massey, "Algorithm aversion", *JEP: General* 2015; "Overcoming algorithm aversion", *Management Science* 64(3), 2018 | Abstracts, working-paper text via search summary. After seeing it err, an algorithm loses confidence faster than a human; letting people modify forecasts, even slightly, raised use and tolerance | §2.3, TRN-05 |
| Eslami and colleagues, CHI 2015; Rader, Cotter and Cho, CHI 2018; Kulesza and colleagues, VL/HCC 2013 | Abstracts and summaries | F-05, F-09, TRN-02, TRN-07 |
| Ur, Leon, Cranor, Shay and Wang, SOUPS 2012; White, Zahay, Thorbjørnsen and Shavitt, *Marketing Letters* 19(1), 2008 | Abstracts and press coverage | F-06, DRK-07 |
| Nguyen, Hui, Harper, Terveen and Konstan, WWW 2014; Chaney, Stewart and Engelhardt, RecSys 2018 | Abstracts | F-07, INF-03, INF-06 |
| Kirchner-Krath and colleagues, *IJHCS* 190, 2024; Hamari and Tuunanen, *ToDiGRA* 1(2), 2014 | Repository record and abstract. Seven dimensions in the 2014 abstract (intensity, achievement, exploration, sociability, domination, immersion, in-game demographics) | F-02, INF-01 |
| Wachter and Mittelstadt, "A Right to Reasonable Inferences", *Columbia Business Law Review* 2019 | Abstract: inferences are weakly protected ("economy class" personal data under the GDPR); proposes ex-ante justification and ex-post challenge | MDL-03, PRV-04 |
| Nair, Guo, Mattern, Wang, O'Brien, Rosenberg and Song, USENIX Security 2023 | Abstract and press coverage | F-10, PRV-02 |
| Raney, "Expanding disposition theory", *Communication Theory* 14(4), 2004; Hartmann, Toz and Brandon, *Media Psychology* 13(4), 2010; Weaver and Lewis, *Cyberpsychology, Behavior, and Social Networking*, 2012 | Abstracts. Raney: dispositions can form before moral judgement, through schemas, and viewers work to protect their feelings for characters. Hartmann: guilt after unjustified virtual violence, stronger in empathetic players (two experiments, N = 49 and 80). Weaver and Lewis: in the first act of a commercial role-playing game (n = 75), most players made moral choices and treated characters as people, and choices tracked a moral-foundations questionnaire | LND-01, LND-02, LND-08 |
| Gray, Kou, Battles, Hoggatt and Toombs, "The Dark (Patterns) Side of UX Design", CHI 2018 | Secondary summary only: five categories (nagging, obstruction, sneaking, interface interference, forced action). **Not credit-ready** | DRK-02, LIN-03 |
| Tarulli and Caplinger, *RUSQ* 52(4), 2013 | Opened: Saricks's six appeal factors, Pearl's four doorways | MDL-02 |
| Barber and Kudenko, "Generation of adaptive dilemma-based interactive narratives", *IEEE TCIAIG* 2009 | Record only: a user model that predicts decisions and picks the next dilemma by expected interest | Lateral link only |
| Yannakakis and Togelius, *Artificial Intelligence and Games* (2018; 2nd ed. 2025); Seif El-Nasr and Kleinman, FDG 2020; Nisbett and Wilson 1977; Kröger and colleagues | Not opened by me; lens L3 and L10 accounts only. **Not credit-ready** | Context only |

### 3.3 Lens claims checked

| Claim | Result |
|---|---|
| L3 field 12: Kirchner-Krath and colleagues surveyed 177 people | The Bamberg repository record, the DOI-linked record and the abstract give **877**. One university listing says 177. Taken as 877 here |
| L3 field 12: PaSSAGE's user study showed enjoyment gains "notably for players with low prior game experience" | **Not what the 2007 paper shows.** The paper's support sits with women who found the game easy to follow, with all-player data not strongly supporting either hypothesis. A later paper by the same group is described, in a search summary, as reporting gains for players with little gaming experience. Not opened |
| L3 field 19: Denisova and Cairns adapted a timer with 42 volunteers (22 and 20), F(1,40) = 7.41, p = 0.010, nobody noticed | Confirmed from the full text. Added: the game lasted 90 seconds, the timer ran 1.4 times fast or slow, and the paper itself calls for work on repeated play and fairness |
| L3 field 19: one conspicuously wrong personalised offer lowers trust more than a wrong authored one | The cited work (algorithm aversion) is about forecasts. No game or offer study found. `[hypothesis]` |
| L3 field 19 principle 3: inspectable basis restores control and lowers reactance | Unsupported as stated. Related: Dietvorst 2018 (modifiability raised use), Rader 2018 (awareness and control judgements improved), Eslami 2015 (awareness raised control). No study on reactance to offers. `[hypothesis]` |
| L10 field 16: the open-modelling authors note models are rarely accurate | Confirmed (full text). The paper is a position paper, and says its own case study is not yet validated |
| L10 field 14: Zagal and colleagues give guiding questions | Confirmed, one set per family (time, money, social capital). Not a single checklist. §5.4 builds one for the director |
| L10 field 17: inferences are "economy class" data | Confirmed (abstract) |
| Map MOT-03: advisors start "from the last thing the person loved" | **Not found** in the RUSQ article I opened, which gives the appeal factors and the doorways only. Taken as: model appeal, not category |
| Map NAR-15: excitation transfer evidence is mixed | Not re-checked; the principle does not rest on it |
| Map NAR-15: "L4 gave only two sources, one a summary" | Added three at abstract level (Raney 2004, Hartmann and colleagues 2010, Weaver and Lewis 2012); the base is still thin |

## 4. Principles

Grades are P1 §4's. "Produce" and "Check" say how a procedure could make or test the principle, and name the layer and the specification section. Numbers marked **[J]** are judgement calls to be replaced by §11. The IDs in "Produce" (S12-S2-nn, S12-P5-nn) are the requirements in §12.

### A. What the engine may believe (MOT-02, ETH-20, with D-09)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| MDL-01 | **The director's model is a set of facts about what V did and how V responded, with counts. It never states what V is, wants or feels.** | [analysis] under D-09; [empirical] that typed labels are weak | F-01 and F-02: the typologies overlap and PaSSAGE's types were the designer's. Instance: "accepted 4 of 6 displayed quiet jobs" is a facet; "V is a stealth player" is not | all · 1 (S0 §11.3), 3 | **Produce:** the facet vocabulary of §5.2 (S12-P5-01). **Check:** a schema audit: every facet is a count, rate or last-time over canon events, and no facet type is a trait, emotion, motive or drive. **Challenges** DRV-49, which infers a distribution over drive profiles, and the `relevance` drive's "belief about V" in dossier 1 §12. Both can run on feature rates |
| MDL-02 | **Key the facets to the content's own vocabulary: the six skeleton features S2 computes (verb, stake, relationship, outcome, tone, channel), plus NPC and group ids.** | [practice] for appeal vocabulary; [hypothesis] for the fit | A readers' advisor matches on appeal factors (Saricks: pacing, characterization, storyline, tone, frame, style) and doorways (Pearl: story, character, setting, language), not on category (Tarulli and Caplinger, summarising both). Instance: V's acceptance of an offer whose features are (verb: infiltrate; stake: data; relationship: a contact owed a favour; outcome: clean exit; tone: low-key; channel: message) updates six facets | all · 2, 3, 4 | **Produce:** S2 §2.11 already computes the features; the model reads them off the offer event (S12-S2-07). **Check:** facet vocabulary is a subset of skeleton values, ids, channel and class |
| MDL-03 | **Every facet has a written card: purpose, evidence rule, weights, decay, minimum evidence, readers and forbidden uses. A facet without a card does not load, and packs cannot add facets.** | [analysis] | Wachter and Mittelstadt (abstract) ask for ex-ante justification of inferences and a way to challenge them. L10's purpose limitation: whitelisted features with declared purposes. Instance: the card for "acceptance of class 3 pushes": purpose *time*; reader the scoring hook; forbidden in any text | all · 3 | **Produce:** S12-P5-01. **Check:** a lint at load; card coverage 100 per cent (M12-16) |
| MDL-04 | **The model never infers inner or sensitive states: emotion, mood, health, compulsion, vulnerability, tolerance, age, sexuality, politics, religion, money trouble, identity. Wellbeing cues are player-set.** | [analysis] | Melhart and colleagues (abstract): sensing and detection raise privacy and ownership problems. Susser and colleagues: vulnerability is what manipulation exploits. Nair and colleagues: play data identifies. L10: detecting compulsion is itself profiling. Instance: V dies five times in a gig. The model records no frustration; the arbiter holds back for a game-state reason (LIN-06) | all · 3, C | **Produce:** a denylist in the facet schema (S12-P5-02). **Check:** a static audit that no facet or hook input matches it. The care-versus-profiling tension is in §8 |
| MDL-05 | **Content classes that dossier 18 marks sensitive are untracked: engagement with them creates no facet. Only stated settings govern them.** | [hypothesis] | Engagement with such content is the trait data that inference rights protect most weakly (Wachter and Mittelstadt). L10 ETH-20 principle 3. Instance: V takes a romance thread. The acceptance counts in no facet keyed to that content class | all · 3, C | **Produce:** the S4 content descriptors mark classes untracked, and the fold drops events carrying them. **Check:** untracked-class leakage is zero (M12-16) |
| MDL-06 | **The model is branch-local and rebuilt from the record. It holds nothing across branches, playthroughs or saves, and nothing outside the save.** | [analysis] | BRN-04 (the engine keeps no memory of V across branches). Kernel §11.3 puts the director's beliefs in the record, so they branch with it. Instance: V's habit of declining in a discarded branch shapes nothing here | all · 1 | **Check:** an audit that no store outside the record is read by a content decision (the table in §5.1) |
| MDL-07 | **The model is humble by construction: with little evidence its influence is zero, and what it does favour holds across the tastes still plausible.** | [analysis] | Foundation §5.3 and D-09 ("the player never pays for a misreading"); DRV-49's "hold up across plausible profiles". Instance: three accepted infiltration jobs move nothing yet | all · 3 | **Produce:** influence ramps from zero at 3 effective observations to full at 8 (INF-05, §5.3). **Check:** influence is monotone in evidence and zero below the threshold (M12-04) |
| MDL-08 | **Stated beats inferred, and a stated control is an instruction to the engine, never a claim about V.** | [analysis] | D-09 (no setting declares V's drives); L10 ETH-20 principle 3; self-report is a poor guide to taste (Nisbett and Wilson, via L3). Instance: "Show fewer jobs like this" and "Stop using what you have noticed" are offered. "I prefer stealth" is not. Lines, veils and intensity are content settings (dossier 18) and always win | all · C | **Produce:** control labels are verbs (TRN-05). **Check:** a settings-schema audit (no control describes V) and unit tests: a stated exclusion overrides any inferred rate, and inference never crosses a stated bound |

### B. Inference: from which events, with what confidence, and how it decays (MOT-02, MOT-03)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| INF-01 | **Model behaviour as rates over features, not as player types.** | [empirical] that the typologies are weak; [hypothesis] that rates win here | Kirchner-Krath and colleagues (877 people): four typologies overlap and reduce to five continuous dimensions. PaSSAGE (90 students): no overall effect. L3 field 12 principle 1. Instance: ranking the next offer by the quiet-job rate rather than by a "tactician" weight | all · 3 | **Check:** M12-06 compares rate ranking with a typed-label ranking on synthetic and recorded transcripts |
| INF-02 | **The evidence is V's response to a *displayed* offer, weighted by how clear the response is.** | [analysis]; weights [J] | AGY-16 (only a perceived offer can be declined); DIR-60 (unknown attention is unknown); BND-22 (retract). Instance: a missed call adds nothing; a call picked up and cut short adds a failure | all · 1, 2, 3 | **Produce:** the weights in §5.3: accepted and carried on, one success; accepted then abandoned within 120 play seconds, half a success and half a failure; explicit decline, one failure; lapse after perceived, half a failure; retract, one failure plus an exclusion; counter-offer, half a success; not displayed, nothing. **Check:** no evidence from a delivery that is not `displayed` |
| INF-03 | **Count against what was offered. An estimate is an acceptance rate among displayed offers, never a share of acceptances.** | [empirical] in simulation; [hypothesis] for transfer | F-07: retraining on influenced data homogenises behaviour without raising utility. Instance: V took five quiet jobs because only quiet jobs were displayed. Nothing follows about loud ones | all · 3 | **Produce:** per facet, weighted successes `a` and failures `b` among displayed offers. **Check:** M12-05, recovery of a synthetic V's taste with and without the denominator |
| INF-04 | **The unseen is unknown, not disliked. A facet never offered carries a flat prior and no influence.** | [analysis] | F-07; D-09. Instance: V has never been offered a heist; the model has no view about heists | all · 3 | **Produce:** prior (1, 1); `n = a + b` excludes the prior. **Check:** a facet with `n = 0` has influence 0 |
| INF-05 | **Confidence is the amount of independent evidence, shown to consumers as three states: unknown (under 3 effective observations), tentative (3 to under 8) and established (8 or more) [J]. A consumer declares the state it needs.** | [analysis] | DIR-22 (two thresholds; low confidence favours a trace over a push); S0 §11.1 `confidence`. Instance: tentative may rank class 0 traces; ranking a class 2 or higher push needs established | all · 3 | **Produce:** the states and the ramp `g(n)` of §5.3. **Check:** a lint on hook readers (each declares its minimum state) |
| INF-06 | **Decay runs on play time, never wall time, and only a bounded history counts.** | [analysis] for the clock; [hypothesis] for the form | FGT-03 and S2-I-12 (absence is not a lever); L3 field 12 principle 2 (preferences drift; continuous weights with decay); F-07 (stale confounded data). Weight `w = H / (H + Δ)`, `Δ` the play seconds since the response (`playTotal`, S2 §10.1), `H` = 10 play hours **[J]**; an effective sample cap of 12 per facet **[J]**. Only division, so inside S0 §1.3 | all · 1, 3 | **Check:** a three-week real-time gap changes nothing; after a taste shift the estimate crosses 0.5 within about 3 play hours (M12-08) |
| INF-07 | **The model is a fold over canon `offer` and `response` events since a floor, less excluded facets. Stored beliefs are a cache of that fold.** | [analysis] | S2 §10.2 (the ledger is derived, not stored); S0 I-4, I-16; BRN-04. Instance: reload and rebuild: the same beliefs | all · 1, 3 | **Produce:** S12-P5-04. **Check:** stored beliefs equal a fresh fold (M12-10) |
| INF-08 | **Exploration is built in and cheap: a bonus for facets with little evidence, a quota of offers from outside the top band, and a floor of breadth for a V who declines a lot.** | [hypothesis] | L3 field 12 principle 3 (the self-fulfilling loop); F-07; Mathur and colleagues' disparate-treatment attribute. Instance: V declines everything for two hours and still sees offers spanning at least four feature values an hour | all · 3 | **Produce:** a bonus `e / sqrt(n + 1)` for `n < 3` **[J: e = 0.15]**; at least one in four pushes from outside the top band **[J]**; a breadth floor that lowers rate (DRV-46) but not variety. **Check:** entropy of offered features against model-off at least 0.8 **[J]**; the starvation test (M12-05) |
| INF-09 | **A facet earns influence only after it beats a naive baseline in replay.** | [analysis] | F-01 and F-02. Dossier 7 DIR-04 asks the same of the director as a whole. Baseline: the overall acceptance rate for the same channel class. Instance: a facet that predicts acceptance no better than the base rate keeps zero influence and is not shown | all · 3, E | **Produce:** a validity entry on the facet card. **Check:** M12-07 |
| INF-10 | **Approach signs are a weaker, opt-in rung. Returns to a place or person and scans are events in the record. Gaze, dwell and camera attention are short-lived aggregate counters, never raw, and never shape what an NPC says.** | [hypothesis] | DIR-39 (approach signs as triggers) against DIR-60 (lingering can mean reading a sign, a call or a pet). Zhu and Seif El-Nasr name sensing as the privacy cost. Instance: V stands at a stall for a minute. The counter ticks if the dial allows it, and no vendor says "you were watching me" unless one saw it | all · 1, 3 | **Produce:** the signal ladder (§5.2); `noticing: approach`. **Check:** with `acts` no T2 counter exists; with `approach` only aggregates persist (M12-15) |

### C. How an outcome lands (NAR-15)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LND-01 | **The same event reads differently by V's stance toward those involved and by V's own part in it, so the engine needs a view of both before it decides how to show an outcome.** | [analysis] for disposition theory; [empirical] for guilt and for choices following morals | Raney 2004 and the theory behind L4 field 3 (abstract level). Hartmann and colleagues: unjustified virtual violence produced guilt, more in empathetic players (N = 49 and 80). Weaver and Lewis (n = 75): choices tracked a moral-foundations questionnaire. Instance: a vendor V helped is shaken down; a vendor V cheated is shaken down | G, A · 3 | **Check:** the pair test (M12-14): staging differs, the world record is identical |
| LND-02 | **Stance toward an NPC is built from V's acts (returns, help, protection, spending, taking sides, harm, avoidance) and from conduct V witnessed. It is not only a moral verdict.** | [analysis], abstract level | Raney 2004: dispositions can form before moral judgement, through schemas, and viewers work to protect their feelings for characters. Instance: V keeps returning to a stall because it is on the way, and the stance is still "toward" by the engine's measure | G, A · 1, 3 | **Produce:** the evidence classes of §5.7 (S12-P5-09). **Check:** each orientation cites at least one event V was shown |
| LND-03 | **Hold a coarse orientation per NPC (toward, against, mixed or unformed), not a liking score. Most NPCs stay unformed.** | [hypothesis] | The evidence base is thin (§3.3); D-09 humility; a scalar invites false precision. Instance: a guard V barely met is unformed | all · 3 | **Check:** the share unformed; confidence states per INF-05 |
| LND-04 | **The orientation chooses staging and outlets, never the outcome.** The outcome comes from world causes. The estimate decides whether V witnesses or hears, the register, and which responses come with it. | [analysis] | The map tension ("choose how an unjust outcome lands, not repair it"); AGY-20 (levers are world state, traced); AGY-04 (acknowledging is not deciding). Instance: the shakedown happens either way. For a V who is "toward" the vendor, the scene is witnessed at a joint and offers a way to step in or pay; for one who is "against", it is news | G, A · 3 | **Produce:** S12-P5-10. **Check:** a lint that the orientation is readable only from `staging` and `outlet`; M12-14 |
| LND-05 | **Stage for the readings still plausible. With an unformed or mixed orientation, attach outlets for at least three stances including indifference.** | [analysis] | D-09; AGY-18 (a span of stances); BND-20. Instance: the same shakedown for an unformed V carries "step in", "tell someone" and "walk on" | E, G · 3, 4 | **Check:** at least three stance classes per staged outcome |
| LND-06 | **The model weights offers, never events. It is never used to choose whom a world event happens to. Attachment is not a target.** | [hypothesis] | Zagal and colleagues' definition (against best interests, without consent); parasocial attachment as an exploitation risk (REL-05); BND-19 (distress as a lever is a defect); L3 rejected sunk-cost and endowment engineering. Instance: the model has learned V returns to a noodle stall. The Claws raid it only if their own frames wanted it, and the model had no say. An author may write a loss into an authored arc, choosing from ties in the record (S2-I-10); that choice is visible and auditable | all · 1, 3, 4 | **Produce:** S1 effect generators and S3 consequence sowing get no read access to the orientation or bond index (S12-P5-11). **Check:** a lint over registry read-sets; M12-12, the correlation between the bond index and unilateral harm against a model-off baseline |
| LND-07 | **Check how an outcome landed, and drop what does not predict.** After a staged outcome, V's next acts toward the party are classed, and the miss rate is kept per orientation state. | [analysis] | Disposition theory ignores the player's own judgement, which the engine cannot see; only V's later acts tell it. Instance: V takes the "step in" outlet after the vendor's shakedown: a hit | G, A · 3, E | **Produce:** a `landing` record. **Check:** M12-14. A chronic miss sets the orientation's influence to zero (INF-09) |
| LND-08 | **No guilt, regret or satisfaction estimate. After a harmful act, offer a way back and say nothing about it.** | [analysis]; [empirical] that guilt exists | Hartmann and colleagues. Melhart and colleagues (sensing and detection). AGY-27 (no reproach), RLD-08 (repair paths), BND-15. Instance: V kills a courier who turns out to be innocent. No line says "you regret it". The courier's sister appears with an offer | all · 3, X | **Check:** the lexicon (L-20); an objective audit that nothing refers to inferred emotion |

### D. Serving versus steering (MOT-05, ETH-20)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LIN-01 | **Serving changes which true, declinable offers V sees, and when. Steering acts on a decision while it is being made, or works only because V cannot see why. §5.4 makes that line into eight checks.** | [analysis] | Susser and colleagues: manipulation is covert influence that exploits decision-making vulnerabilities; persuasion works in the open, with reasons the target can weigh. Mathur and colleagues' six attributes. Zagal and colleagues: against best interests and without consent | all · 3 | **Check:** the battery C1 to C8 (§5.4), run as replays (M12-01 to M12-13) |
| LIN-02 | **The reveal test: every decision the model influenced carries a reason that renders as one plain sentence V would accept on reading it. A decision that would fail if V read it is a steer.** | [analysis]; [empirical] that telling did no harm in the cases tested | Disclosure Principle (Berdichevsky and Neuenschwander, as quoted in Zagal): disclose motives, methods and outcomes unless that would undermine an otherwise ethical goal. F-04 and F-05. Denisova and Cairns 2015 themselves warn about repeated play. Instance: "A fixer offered you this because you took the last three quiet jobs" | all · 3, C | **Produce:** the why-record (S12-S2-08) and its rendering table (S12-P5-13). **Check:** coverage 100 per cent; a reveal arm against a hidden arm in panels (T12-05) |
| LIN-03 | **Option invariance: the model never changes what an offer contains: actions, costs, stakes, null path, order, defaults, emphasis or wording.** | [analysis] | Mathur and colleagues: asymmetric and restrictive; Gray and colleagues, as summarised: interface interference; AGY-42 (an adaptation changes only which true offers are made); AGY-05. Instance: the refuse option stays where it is, whoever is playing | E, G · 2, 3 | **Produce:** S12-S2-03. **Check:** M12-01, a replay under any model state with identical offer content and presentation |
| LIN-04 | **Decision-time blindness: from display until the offer is answered or lapses, nothing that shapes it or its surroundings reads the model.** | [analysis] | Mathur and colleagues: covert; DIR-02 (class 4 forbidden). Lateral link: non-interference (§9). Instance: V is reading an offer; the model updates; the offer's surroundings do not move | E, G · 2, 3 | **Produce:** S12-S2-03, S12-P5-08. **Check:** M12-02, a freeze test |
| LIN-05 | **Outcomes and strengths are independent of the model. Whether a gig is hard or an enemy is strong never depends on it.** | [shipped] | DIR-01 (a director changes when and how often, not how hard). Instance: the Claws crew in the depot has the strength the world gave it | all · 1, 3 | **Check:** M12-03, a counterfactual run with the model on and off and the same acts from V |
| LIN-06 | **Strain signals only subtract. Anything that shows V is under strain (recent deaths, a long high-intensity phase, repeated failure, a long session) may delay, hold or withdraw a push. It never triggers or sharpens one.** | [analysis] | DIR-35 and DIR-29; Susser and colleagues (vulnerable moments are what manipulation targets). Instance: after V's third death in a gig, the director holds pushes; it never times an offer to that moment | all · 3 | **Produce:** the closed hook-input list (S12-P5-07). **Check:** M12-13, a sign test: the push rate never rises with strain on synthetic runs |
| LIN-07 | **Retention blindness: no input to any hook and no objective term refers to session length, returns, streaks, time of day, time since the last session or quit signals.** | [practice] | DIR-07; L10 field 14 principle 1; Zagal and colleagues' time family; dossier 11 F-04. Instance: a synthetic player built to maximise returns finds nothing to maximise | all · 3, E | **Check:** the objective audit and the hook-input audit (M12-11, M12-12) |
| LIN-08 | **Bounded influence, no starvation. The model moves a score by a small bounded factor, and no V is treated worse for what the model infers about them.** | [hypothesis] for the numbers; [analysis] for the principle | Mathur and colleagues: disparate treatment. F-07. A cap of a factor of 1.5 either way on an offer's weight **[J]**. Instance: a V who declines most offers sees fewer pushes but the same range | all · 2, 3 | **Produce:** the clamp in S2 §3.4 and §8.3 (S12-S2-04, S12-S2-05). **Check:** M12-04 and M12-05 |
| LIN-09 | **Honesty about adaptation: never claim personalisation that is not happening, never hide personalisation that is, and generate the noticed page from the model itself.** | [empirical] for the placebo effect | F-04: telling players the game adapts raised immersion whether or not it did. So a claim is cheap and effective, and the page must be unfakeable. Instance: a toggle on the page changes what the engine does, and the test proves it | all · C | **Check:** M12-10 and the "toggle changes behaviour" test |
| LIN-10 | **The firewall: the model never enters an NPC's belief, a seed predicate, a response template or the system's voice. NPCs know V only through what they saw or were told.** | [analysis] | D-10; S0 §11.4; S2 §2.6, §2.9; D-22's four conditions. Instance: "I heard you prefer quiet work" needs a told belief with a source event | all · 1, 2 | **Produce:** S12-S2-01, S12-S2-02. **Check:** the firewall audit (M12-11) |

### E. Dark patterns to forbid (MOT-05)

Each row names where the pattern would hide in this engine, so the check has somewhere to look.

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DRK-01 | **No appointment, streak, daily-return or withering mechanic keyed to a real-time clock or to V's return. World clocks come from world facts and are paid.** | [analysis] | Zagal and colleagues' time family (FarmVille's crops wither if not harvested in time; the paper notes the pattern is harmless when nothing depends on it); AGY-29; DIR-48; dossier 11 F-04. Hiding places: a seed `maxWait` or lapse that rewards returning; a clock keyed on `wall` | all · 2, 3 | **Check:** S2-I-12; a lint that every expiry cites a world fact |
| DRK-02 | **No nagging, obstruction or forced action: no repeated prompt, no gate on refusing, no content locked behind accepting.** | [practice] | Gray and colleagues (summary only); AGY-14; AGY-26; DIR-19. Hiding places: the same ask re-sent by another channel; a persistent marker | E, G · 2, 3 | **Check:** a re-offer needs a recorded later cause (R5-03); the lockout lint (R5-06) |
| DRK-03 | **No guilt, reproach or confirm-shaming. Copy and NPC reactions never make declining feel like a fault of V's.** | [analysis] | BND-19 (a reject-then-guilt template is a defect); AGY-27; L-21. Hiding places: a decline response written as disappointment; an NPC's "distress" used as pressure | E, G · 4, X | **Check:** the lexicon; template review |
| DRK-04 | **No hostage-taking: attachment is not a lever (LND-06).** | [hypothesis] | See LND-06 | G, A · 1, 3 | **Check:** M12-12 |
| DRK-05 | **No engagement-tuned reward or cadence: no offer rhythm, jitter or randomised reward whose parameters respond to V's engagement.** | [analysis] | L3's rejected list: reward schedules are known to work and are what the brief should avoid. DIR-36: jitter exists to defeat gaming, with fixed parameters. Hiding places: an adaptive spacing; a "lucky streak" generator | all · 3 | **Check:** cadence parameters are constants with respect to every model value (M12-03 variant) |
| DRK-06 | **No hook on quit: nothing detects an imminent exit to plant a cliffhanger or a "one more" offer. Sessions open by orienting.** | [hypothesis] | S2 §8.2; SES-02. Hiding places: a hook that reads menu opening, a save or input silence | all · 2, 3 | **Check:** the hook-input audit (M12-12) |
| DRK-07 | **No fake urgency, fake scarcity or placebo personalisation.** | [empirical] | F-04; AGY-29; White and colleagues (unexplained personalisation drew reactance). Hiding places: a "few left" that is not; a "chosen for you" with no basis | E, G · 2, 4, X | **Check:** every stated urgency is paid; LIN-09 |
| DRK-08 | **No data-reveal staging: personalisation never shows knowledge beyond what the speaker could witness, or from another branch.** | [hypothesis] | F-06 (surprise at what is known) and F-05. Instance: a vendor greets V by a habit nobody present could have seen | E, G · 2, X | **Produce:** counts and callbacks draw on events the speaker witnessed (S12-S2-09). **Check:** every personalised surface cites such an event |
| DRK-09 | **No covert experiments: the engine never varies what V sees in order to learn about V.** | [analysis] | L10 ETH-18 (not re-checked). Instance: the director never tries two framings on one V | all · 3, E | **Check:** no runtime experiment path exists; tuning uses consented sessions and synthetic players (PRV-05) |

### F. Transparency and control (ETH-20, MOT-05)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| TRN-01 | **Offer a page of what the engine has noticed, at three levels: what it believes, why (the events behind it), and what V can do about it.** | [analysis]; [empirical] for related findings | Zhu and Seif El-Nasr: outcome, process and editable openness. Dietvorst and colleagues 2018: letting people modify a forecast, even slightly, raised use and tolerance. Eslami and colleagues: awareness raised the sense of control. Instance: §5.6 | all · C | **Produce:** S12-P5-14, S12-P5-15. **Check:** a comprehension panel (T12-06) |
| TRN-02 | **Say less than the model holds, and show the evidence for each line.** | [empirical] on explanations | Kulesza and colleagues: very low soundness cost trust; completeness helped mental models. Zhu and Seif El-Nasr: models are rarely accurate. Rule: every facet that influences decisions appears (complete in effect), and each row rests on shown events (sound). Instance: "You took 4 of the last 6 quiet jobs offered. See them." | all · C | **Check:** every row links to events; a facet that influences decisions but is hidden is a defect |
| TRN-03 | **The page is pull-only, carries no numbers or scores, and reading it is never an input.** | [analysis] | Zhu and Seif El-Nasr (gaming and immersion costs); DIR-53 (no director meters). Instance: no "match" percentage anywhere | all · C | **Check:** no event is minted by viewing; a synthetic gaming player gains nothing (M12-17) |
| TRN-04 | **Every offer and push can answer "why this?" in one sentence from the why-record, and can be refused with one input that teaches the engine.** | [hypothesis] | L3 field 19 principle 3 (unsupported as stated, §3.3); BND-22; R5-23. Instance: a journal entry has "why?" and "not like this" | E, G · 2, C | **Produce:** S12-S2-08. **Check:** M12-09 |
| TRN-05 | **Controls are engine verbs, per facet and overall: use less, stop using, forget, start fresh. A `noticing` dial has three settings: off, acts, acts and approach. The default is acts.** | [analysis]; default [J] | D-09; AGY-51 (agree the contract before play); Dietvorst and colleagues 2018. Acts (what V did, and how V answered displayed offers) are the least invasive and most explicable signals; approach signs are opt-in (INF-10) | all · C | **Produce:** S12-P5-15. **Check:** the defaults work untouched; the schema audit |
| TRN-06 | **Reset means reset. "Start fresh" moves a floor in the recorded settings. For the same state and keys, decisions then equal the model-off decisions until new evidence passes the thresholds. The world's record is untouched, and the page says so.** | [analysis] | S0 §14.2 (`SettingsSet`); dossier 11 S11-S0-06 (settings as lenses over an append-only record). Instance: V presses it after a month; the next offers come from the schedule | all · 1, C | **Check:** M12-10 |
| TRN-07 | **Disclose the mechanism once, plainly, outside the fiction: what is noticed, what it changes (which offers, and when), and what it never changes (options, costs, outcomes).** | [empirical], mixed; [analysis] | The Disclosure Principle; F-04 and F-05 (telling did no harm in the cases tested; finding out cost trust). Delivered in the first-run settings flow, and by a one-time `notice` only when what is noticed changes in a later version | all · C | **Produce:** S12-P5-16. **Check:** a comprehension panel: a tester can say what the page will and will not change |
| TRN-08 | **The model, its evidence and the why-records are machine-readable for agents.** | [practice] | The project norm; PR-47 and the trace of S0 §13. Instance: an agent filters decisions by facet and lists the events behind each | all · T | **Check:** the harness reads them |

### G. Privacy (ETH-12, ETH-20)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| PRV-01 | **Local by default. Nothing about V leaves the machine, and no model feature goes to a remote model.** | [analysis] | L10 ETH-17 principles 1 and 2; Melhart and colleagues. Instance: a remote language model (dossier 22) receives a scene brief with no facet in it | all · all | **Check:** a network audit shows zero outbound calls in the default configuration (M12-15) |
| PRV-02 | **Treat the model and the ledger as personal data even though they are local. Exports, shared saves and bug reports leave the model out by default.** | [empirical] for identifiability; [analysis] | Nair and colleagues: 10 to 100 seconds of motion identified players. Wachter and Mittelstadt: inferences are weakly protected, so protect them yourself. Instance: V shares a save; the director's beliefs are not in it | all · 1, T | **Produce:** a separable model section, an export redaction, a viewer for any report (S12-S2-13, S12-P5-19). **Check:** an export test |
| PRV-03 | **Minimise: store counts and event ids only. No raw input, gaze, camera, menu or timing logs are kept, and nothing below the signal ladder's T2 is ever read.** | [analysis] | L10 ETH-17 (privacy by design, GDPR Article 25, not re-checked); Zhu and Seif El-Nasr (sensing and privacy) | all · 1, 3 | **Check:** a persisted-state scan (M12-15) |
| PRV-04 | **Inferences are data: documented (facet cards), viewable (the page), deletable (reset) and exportable as plain text.** | [analysis] | Wachter and Mittelstadt; L10 ETH-17 principle 3 | all · C | **Check:** card coverage; an export of the page |
| PRV-05 | **Tuning uses consented sessions and synthetic players only, with a viewer of what was recorded and withdrawal at any time. No runtime experiments.** | [analysis] | L10 ETH-18 (the news-feed experiment is cited there from summaries; not re-checked). Instance: the test sessions of §11 record only what the maintainer approves | E | **Check:** the experiment registry is empty |
| PRV-06 | **The legal floor is a question for dossier 19; the design aims higher.** | [sec] | Wachter and Mittelstadt; GDPR Article 25 via L10 | all · — | **Open:** does a data-protection regime attach to a free, local mod, and do exports change that? Not legal advice |

## 5. Models the engine could run

### 5.1 Where the model may act, and where it may not

The whole defence rests on this table being short. The director's beliefs about V are a store in the record (S0 §11.3). S2 §8.3 and §3.4 name the only hooks S3 supplies. V's inferred frames (S1 opens V's frames "from the game's story state and the director's beliefs", S0 §10.4) are a second exit, which the current text does not list as one.

| From | To | Allowed? | By what |
|---|---|---|---|
| Canon events (V's acts, `offer`, `response`) | The director's model | Yes | The fold (INF-07) |
| Canon events | NPC beliefs | Yes, for witnesses and tellings only | S0 §11.2 hooks; D-10 |
| The director's model | NPC beliefs | **No** | The firewall (LIN-10) |
| The director's model | Any seed predicate, effect, cost, offer field, response template, variant selector or registry function | **No** | S12-S2-01, -02; new invariant S2-I-13 |
| The director's model | S3's fitting hook (`fitWeight`) | Yes, clamped | S2 §3.4; S12-S2-04 |
| The director's model | S3's scoring and phase hooks | Yes, clamped; the phase hook may only remove | S2 §8.3 steps 4 and 5; S12-S2-05 |
| The director's model | S3's form and joint hooks | Form: sowing time only. Joint: no (game state only) | S2 §2.13, §8.3 |
| The director's model | V's inferred frames | Yes, inside the director; frames marked `inferred`, unreadable by predicates and NPCs | S0 §10.4, §11.3 |
| The orientation index | `staging` and `outlet` fields | Yes | LND-04 |
| The orientation index and bond evidence | Whom a world event happens to | **No** | LND-06 |
| The director's model | Any text | **No**, except the noticed page and "why this?" in the settings voice | S12-S2-09 |
| NPC beliefs about V | The director | Only as world facts (reputation aggregates), never as evidence about V's taste | Avoids a loop |
| Settings (`noticing`, exclusions, floor) | The fold and the hooks | Yes, as recorded ops | S12-S2-12 |
| The director's model | The Studio and agents | Yes, read-only | TRN-08 |
| The director's model | The network, or a remote model | **No** | PRV-01 |

### 5.2 The signal ladder and the facets

**The ladder.** Four rungs, each with a different privacy cost and a different right to be said aloud.

| Rung | What it is | Stored as | May feed | May an NPC say it? |
|---|---|---|---|---|
| T0 | V's acts in the record: deeds, visits that are events, scans, choices in dialogue | Canon events (already there) | Orientation; facets; callbacks | Yes, if that NPC witnessed or was told (S0 §11.4) |
| T1 | V's responses to *displayed* offers: accepted, declined, lapsed after perceived, retracted, abandoned, countered | Canon `response` events with the offer's features | Facets; the fold | Not as a rate. A witness may name an act or count acts it saw (AGY-44) |
| T2 | Approach counters: dwell near a person or stall, gaze and attention aggregates, camera time (opt-in) | A short-lived aggregate counter per subject; no raw samples | Class 0 and 1 ranking; time of day for traces only | **No** |
| T3 | Raw input, device and menu telemetry, session lengths, idle times | Nowhere | Nothing | No |

**The facets.** A closed set. Each is a count pair `(a, b)` over displayed offers (or a small evidence list for the orientation index), keyed as shown.

| Facet | Keyed by | Purpose | Readers | Rung |
|---|---|---|---|---|
| Response rate by skeleton value | verb, stake, relationship, outcome, tone (each value in turn) | *rank* | The fitting and scoring hooks | T1 |
| Response rate by channel and class | channel, class, purpose | *time* | The scoring and phase hooks | T1 |
| Orientation toward an NPC or group | the NPC or group id | *stage* | The staging and outlet fields only | T0 |
| Exclusions | a facet, an NPC or an offer kind V retracted or switched off | *rank*, *time*, *stage* | All hooks, as a hard filter | T1 and settings |
| Approach counters | a place or person | *rank* (class 0 and 1 only) | The scoring hook | T2 |

**The facet card** has these fields: label in plain words; purpose; evidence rule and weights (INF-02); decay (INF-06); minimum evidence (INF-05); readers; forbidden uses; validity entry (INF-09); content classes excluded (MDL-05); example rendering for the noticed page and for "why this?".

### 5.3 The estimator

All arithmetic is S0 §1.3's (`+ − × ÷`, `sqrt`, `ln`, comparisons), so the TypeScript oracle and any faster build agree.

For a facet `f`, over displayed offers whose features include `f`:

```
w(i)   = H / (H + Δ(i))                  Δ(i): play seconds since the response; H = 36,000 [J]
a, b   = Σ w(i)·s(i),  Σ w(i)·t(i)       (s, t) from the evidence table; both scaled down together if a+b exceeds 12 [J]
n      = a + b
p      = (1 + a) / (2 + n)               a flat prior, so an unseen facet reads 0.5
p0     = the same estimate over all displayed offers in the same channel class
g(n)   = clamp((n − 3) / 5, 0, 1)        no influence below 3, full at 8
u(n)   = 1 / sqrt(n + 1)
```

For a candidate offer `o` with feature set `F(o)`:

```
m(o)       = 1 + ( c · Σ_f g(n_f)·(p_f − p0)  +  e · Σ_{f: n_f < 3} u(n_f) ) / |F(o)|     (f runs over F(o))
fitWeight  = ln( clamp(m, 1/1.5, 1.5) )                                                   c = 1.5, e = 0.15 [J]
```

The evidence table (INF-02): accepted and carried on, `(1, 0)`; accepted then abandoned within 120 play seconds, `(0.5, 0.5)`; explicit decline, `(0, 1)`; lapse after perceived, `(0, 0.5)`; retract, `(0, 1)` plus an exclusion; counter-offer, `(0.5, 0)`; not displayed, nothing.

**Worked example.** All responses fall in the last half play hour, so `w` is about 0.95; I round it to 1. Effects are per feature, before the average over the offer's features.

| Facet | Displayed | Responses | `a` | `b` | `n` | `p` | `g` | Effect on `m` |
|---|---|---|---|---|---|---|---|---|
| verb: infiltrate | 6 | 4 accepted, 1 declined, 1 lapsed | 4 | 1.5 | 5.5 | 0.667 | 0.5 | with `p0` = 0.5, `1.5 · 0.5 · 0.167` = **+0.125** |
| verb: wet work | 4 | 4 declined | 0 | 4 | 4 | 0.167 | 0.2 | `1.5 · 0.2 · (−0.333)` = **−0.100** |
| verb: heist planning | 0 | none | 0 | 0 | 0 | 0.5 | 0 | `e · u(0)` = **+0.15** (the exploration bonus) |

After 8 declines of wet work, `p` is 0.1, `g` is 1, and the effect is `1.5 · (0.1 − 0.5)` = −0.6, so `m` (for an offer with that one evidenced feature) hits the floor of 0.667. That is the most the model can do to an option: make it two-thirds as likely as it would have been, against a favourite that is 1.5 times as likely at most. The cap is the design lever. Start narrow and widen only if panels show the adaptation is helpful and not noticed as a steer (T12-05). The numbers are placeholders for calibration fixtures, as the kernel's are.

**Why this form.**
- A flat prior and a count make the confidence the amount of evidence (INF-05), and fit the `(0, 1]` confidence of S0 §11.1.
- `p − p0` measures V against the channel's own base rate, so a busy-channel V is not read as a keen V.
- The optimism bonus runs only below three observations, so it never fights real evidence.
- `H / (H + Δ)` is a slow, heavy-tailed decay that needs no `exp`.
- The draw that follows is the kernel's keyed draw (`rand("seed-draw", worldSeed, s, c, attempt, o)`, S2 §3.4), so a reload gives the same choice (I-16). The model changes the weights and never the noise.

### 5.4 The serve-or-steer battery

LIN-01's line, as eight checks. Each runs offline on the reference model, so none of them needs a person (C1 also has a panel version). The last column names the attribute of Mathur and colleagues that the check answers, or another source.

| # | Check | The question | How it is run | Answers |
|---|---|---|---|---|
| C1 | **Reveal** | Would the one-sentence reason survive being read by V? | Every model-influenced decision renders a reason from its why-record; a classifier lists reasons that name a weakness, a mood, a bias, a session length or a return. Panels: reveal arm against hidden arm | Covert; deceptive; the Disclosure Principle |
| C2 | **Invariance** | Do options, costs, order, defaults, emphasis and wording stay the same under any model state? | Replay a fixed state with different model states; diff offers and presentation (M12-01) | Asymmetric; restrictive |
| C3 | **Freeze** | Does anything that shapes an open offer read the model after display? | Display an offer, then change the model; diff everything the offer touches (M12-02) | Covert |
| C4 | **Outcome independence** | Do world outcomes or strengths depend on the model? | Same V acts, model on and off; diff world records and strengths (M12-03) | Restrictive; DIR-01 |
| C5 | **Strain** | Does any lever fire more when V is under strain? | Sweep a synthetic strain signal; the push rate may only fall (M12-13) | Exploiting vulnerability (Susser and colleagues) |
| C6 | **Retention** | Does any input or objective relate to return, length, streak or quit? | Static audit of hook inputs and the objective list (M12-11, M12-12) | DIR-07; Zagal and colleagues' time family |
| C7 | **Bounds and breadth** | Is influence capped, and does any V see less breadth because of the model? | Rank displacement against the cap; entropy and starvation tests (M12-04, M12-05) | Disparate treatment |
| C8 | **Firewall** | Does the model reach an NPC, a predicate, a template or a voice? | Read-set audit over every registry function and hook; the table of §5.1 as a test (M12-11) | Information hiding; D-10 |

**What passes and what does not.**

| Director action | Verdict | Check that decides it |
|---|---|---|
| Sows a quiet gig more often because V accepted quiet gigs | Serves | C1 to C8 pass |
| Delays a push because V has just died three times in a gig | Serves | C5 (it subtracts) |
| Sends a push now because V has just failed and might be low | **Steers** | C5 |
| Puts "refuse" last in the options of a V who usually accepts | **Steers** | C2 |
| Raises the pay on a quiet job for a V who likes quiet jobs | **Steers** | C2 (it changes an offer's content), and C7 (price discrimination between Vs) |
| Orders two true offers by acceptance rate | Serves | C2 passes (the offers are unchanged) |
| Times an offer to the moment V opens the menu to quit | **Steers** | C6 |
| A fixer says "third quiet job you've taken", having been present for all three | Serves | C8 passes (witnessed) |
| Chooses to wreck the stall V keeps returning to | **Steers** | C8 and LND-06 |
| Stages that loss with a witnessed scene and a way to step in, for a V whose orientation is "toward" | Serves | LND-04 |
| Tells V "your tastes have changed" | **Steers** | The voice rule (MDL-01); C1 |

### 5.5 Where the dark patterns would hide

DRK-01 to DRK-09 name the patterns. Zagal and colleagues say the same pattern can be light or dark depending on use and context, and that consent needs literacy in the manipulation. So the review gate is a human step as well as a test.

- **Per mechanic.** Each director mechanic (a verb in DIR-02, a hook, a pacing rule) gets a record: what it does; the Zagal definition applied to it (intent, best interests, consent); the six attributes of Mathur and colleagues, each scored as present, absent or arguable; the checks C1 to C8 it passes; the reviewer, who is not the author.
- **Blocking.** A mechanic with an attribute scored *present* and no disclosure on the noticed page does not merge.
- **Reviewer's questions**, adapted from Zagal and colleagues' guiding questions: Can V form a sense of what this does? Is V's expectation of the time and attention it takes at odds with the reality? Would V regret it if V saw how it worked? Who gains, and is it V?

### 5.6 The noticed page

A pull-only page in the settings voice, outside the fiction (the Studio's preferences, and a pull entry in the game's journal that opens the same text). It never shows scores.

```
What has been noticed                                  [Noticing: Acts ▾]  [Start fresh]
Only what V did and how V answered offers. Nothing about how V feels.
It changes which offers appear, and when. It never changes what is in an offer,
what it costs, or what happens in the world.

  Often accepted    Quiet, low-key jobs      (4 of the last 6 shown)    [See them]  [Use less]
  Often declined    Jobs that end in a kill  (4 of 4 shown)            [See them]  [Use less]  [Stop using]
  Often returned to Kabuki, the noodle stall  (visited on 5 days)        [See them]  [Stop using]
  Still unknown     Heists, courier runs                                
  
  Recent choices that used this
    Today   A fixer offered "Dead drop" ... because you took the last three quiet jobs.   [Not like this]
```

- **Rows** appear only above the minimum evidence and carry the events behind them.
- **"Use less" and "Stop using"** add an exclusion (a recorded setting). **"Start fresh"** moves the floor. The page says: "The world still remembers what happened. This only stops the engine using it to decide what to offer you."
- **Honesty.** The page is generated from the model, so each control is real (LIN-09). A row for a facet that has no influence (INF-09) is not shown.
- **Gaming.** Because no number is shown, there is nothing to push on; the synthetic gaming player of M12-17 tests this.

### 5.7 How an outcome lands

**Evidence classes.** All are record events, none is an inner state.

| Toward | Against |
|---|---|
| Returns to the NPC or their place; helps; protects; pays or covers; takes their side in dialogue; accepts their offers; romance-ladder rungs (dossier 2) | Attacks; steals; refuses their offers; avoids; takes a rival's side; is witnessed leaving them in trouble |
| Witnessed conduct *by* the NPC that V saw: kindness to others | Witnessed conduct by the NPC that V saw: cruelty to others |

**State.** `toward` if the toward evidence clearly outweighs the against (by effective count, with a margin of 2 [J]); `against` likewise; `mixed` if both are substantial; `unformed` otherwise. Decay uses the tie's own timescale (dossier 2), not INF-06's.

**Staging.** Only the presentation and outlets change; the outcome and its causes do not.

| Orientation | Shown how | Register | Outlets attached |
|---|---|---|---|
| toward | Witnessed at a joint, or by a person V knows | Warm, specific to the NPC | Step in or pay; seek the cause; send word; walk on |
| against | News in the feed or a passing remark | Brief, matter-of-fact | Press the advantage; use it; walk on |
| mixed | Witnessed or news, whichever is cheaper | Even | At least three stances, one of them indifference |
| unformed | News by default | Plain | The default outlets of the seed |

**The pair test (M12-14).** One event, two histories. History A: V covered the vendor's debt and returned five times. History B: the vendor cheated V. The shakedown is the same event with the same causes. The test passes if the staging records differ as above and the world records are byte-identical.

**The landing record.** After staging, V's next acts toward the vendor within a window (say 10 play minutes **[J]**) are classed as engaging, avoiding or none. A `toward` that meets avoidance counts as a miss. The miss rate per state is on the facet card.

## 6. Walk-throughs

### 6.1 A quiet-jobs V

1. V accepts four of six displayed quiet jobs (one declined, one lapsed after being read). The `offer` and `response` events carry their features. After the fold, the verb-infiltrate facet reads `p` 0.667 with `n` 5.5: tentative, with `g` 0.5.
2. The fixer's seed has two candidate offers for the next sowing. For an offer whose only evidenced feature is infiltrate, the fitting hook returns `fitWeight` = ln 1.125; the other candidate gets ln 1.0. The keyed draw picks the quiet one 50 per cent of the time without the hint and about 53 per cent with it.
3. The offer arrives with the options it always has: take it, haggle, refuse, warn the target. The refuse option is in the same place for every V (C2). While V reads it, the model updates and nothing on screen changes (C3).
4. V declines. The decline is a failure on the facet and a response event. The fixer does not mention it (adaptation stays silent, AGY-42). The next quiet gig is a little less likely.
5. A week of real time passes. Nothing decays (INF-06), and the model is the same on return (FGT-03).
6. V opens the page and sees the rows of §5.6. V presses "Use less" on quiet jobs. An exclusion is recorded. The next offers come from the schedule without the quiet bias, and the page says so.
7. Later V presses "Start fresh". The floor moves. For the same state and keys the decisions equal what a model-off run would give. The world's record of the jobs V did is untouched.

### 6.2 Two Vs, one shakedown

The Claws' collector will lean on the market vendor, for causes in the simulation (a protection payment due). It happens whatever V has done.
- **V1** covered the vendor's debt and returned five times. The orientation is `toward`, from the debt event and the visits, with two witnessed kindnesses by the vendor to others. The shakedown is staged as a scene at a joint when V arrives, and the outlets are step in, pay, ask her what she needs, walk on. The vendor says what she believes about V from what she saw: "You looked out for me last month." That is her own belief with a witnessed source, and V may correct it (D-22).
- **V2** was shorted by the same vendor. The orientation is `against`. V hears the news in the feed, brief. The outlets are use it, ignore it, walk on.
- **The world records are identical.** The only differences are in staging records and deliveries. If V1 steps in, the landing record is a hit.
- **What the engine did not do.** It did not pick this vendor because V1 likes her (LND-06). It did not say "you care about her" in any voice (MDL-01).

## 7. Measures

| # | Measure | How to compute | Principle |
|---|---|---|---|
| M12-01 | **Option invariance** | Fix a state; vary model values across a grid; diff every offer's content and presentation. Target: no differences | LIN-03 |
| M12-02 | **Freeze** | Display an offer; change the model; diff everything the offer or its surroundings read. Target: none | LIN-04 |
| M12-03 | **Outcome independence** | Same V acts, model on and off; diff world records and unit strengths; cadence constants against model values. Target: only delivery and sowing-choice differences inside declared sets | LIN-05, DRK-05 |
| M12-04 | **Influence bound** | Maximum `|fitWeight|` and score delta against the caps; rank displacement; influence against evidence (monotone, zero below 3) | LIN-08, MDL-07 |
| M12-05 | **Breadth and recovery** | Entropy of offered features per play hour against model-off (at least 0.8 **[J]**); starvation test with a V who declines everything; recovery of a synthetic V's taste with and without the exposure denominator | INF-03, INF-08, LIN-08 |
| M12-06 | **Rates against types** | Offer-ranking quality by facet rates against a typed-label baseline on synthetic and recorded transcripts | INF-01 |
| M12-07 | **Validity** | Per facet, log-loss improvement over the base rate; the facet's influence is zero if the margin is not met | INF-09 |
| M12-08 | **Taste-shift recovery** | Play hours for an estimate to cross 0.5 after a synthetic V's taste flips (target about 3 **[J]**) | INF-06 |
| M12-09 | **Why coverage** | Share of model-influenced decisions with a rendered reason that cites at least one event V was shown. Target 100 per cent | LIN-02, TRN-04 |
| M12-10 | **Reset and rebuild** | After a reset the decisions equal model-off; stored beliefs equal a fresh fold; a toggle on the page changes behaviour | TRN-06, INF-07, LIN-09 |
| M12-11 | **Firewall and read-set audit** | For every registry function, hook and template: the set of model values it can read, against the allowed list of §5.1. Target: none outside | LIN-10, MDL-06, DRK-08 |
| M12-12 | **Forbidden-input audit and bond correlation** | Hook inputs and objective terms against the denylist (retention, mood, vulnerability); correlation of the bond index with unilateral harm against a model-off baseline | LIN-07, LND-06, MDL-04 |
| M12-13 | **Strain sign test** | Sweep a synthetic strain signal; the push rate must not rise | LIN-06 |
| M12-14 | **Landing** | The pair test (staging differs, world identical); the hit rate per orientation state against the base rate | LND-01, LND-04, LND-07 |
| M12-15 | **Network, export and persisted state** | Outbound calls in the default configuration (target 0); an export contains no model; no raw T2 or T3 data in persisted state | PRV-01 to PRV-03, INF-10 |
| M12-16 | **Card coverage and untracked classes** | Facets with complete cards (100 per cent); events of untracked classes reaching a facet (0) | MDL-03, MDL-05 |
| M12-17 | **Gaming and exploit players** | A synthetic player that watches the page to farm offers, a return-maximiser and a decline-everything player; each gains nothing | TRN-03, LIN-07 |
| M12-18 | **Human measures** | Noticed against watched (T12-03); trust and fairness ratings with the reveal and hidden arms (T12-05); page comprehension (T12-06) | LIN-02, TRN-01 |

## 8. Tensions

| # | Tension | One side | The other side | How to settle it |
|---|---|---|---|---|
| T-1 | **Hidden adaptation or visible responsiveness** (the map) | Adaptation is judged on fairness once seen (F-03, F-05); the strongest benefit appears while unseen | Players feel noticed only when they see a response; disclosure did no harm where tested (F-04, F-05) | Disclose the mechanism and hide the instance. The page and first-run disclosure say how it works; in the fiction a witness names an act. No voice ever says "the game noticed" |
| T-2 | **Open model or immersion** | Opening the model restores control (TRN-01) | It can interrupt, mislead and be gamed (F-09) | Pull-only, no numbers, evidence-backed rows, and a test that gaming gains nothing (M12-17) |
| T-3 | **Stated or inferred** | Stated settings are authoritative (MDL-08) | Self-report predicts taste poorly (§2.3) | Stated governs boundaries and exclusions; inference governs taste inside them. Controls are engine verbs |
| T-4 | **Accuracy or humility** | The more the model commits, the better it fits | D-09: the player never pays for a misreading | Influence ramps with evidence and is capped (INF-05, LIN-08). A wrong guess costs at most a 1.5-fold odds shift on an offer V can decline |
| T-5 | **Relevance or variety** | Offers V is likely to take serve V | The loop narrows what V sees (F-07) | Exposure denominator, optimism bonus, quota and breadth floor (INF-03, INF-08) |
| T-6 | **Pacing or a retention engine** (dossier 7, T-8) | A director that watches V can pace | The same machinery serves return rate | No retention input or objective; a closed hook-input list; a synthetic return-maximiser finds nothing (LIN-07, M12-17) |
| T-7 | **Privacy or tuning** | Everything stays local (PRV-01) | The engine cannot be tuned on players it never sees | Tune on consented sessions and synthetic players, with a viewer. Local-only forecloses community learning; that is accepted |
| T-8 | **Care or profiling** | Detecting strain or compulsion could protect people | It is profiling, and the same signal serves a manipulator | Strain may only subtract (LIN-06); no inference of inner states (MDL-04); wellbeing cues are player-set features owned by dossier 18 |
| T-9 | **Dramatic craft or a hostage lever** | Drama hurts what the audience loves | A system that sees what V loves can aim at it | The model weights offers, never events; authors may choose from the record's ties (LND-06) |
| T-10 | **Predicting the landing or not presuming** | Disposition theory predicts valence | D-09; the player's own judgement is hidden | Stage and offer outlets, check the landing, drop what misses (LND-04, LND-07) |
| T-11 | **Branch-local model or a cold start every time** | A new branch learns nothing (MDL-06) | A new character starts with no taste data | Humble offers and a flat prior. A carry-over of settings only is open (§10, question 7) |
| T-12 | **An NPC's attribution or the director's firewall** | An NPC may voice its own belief about V's motive (D-22) | The model must not reach NPC speech | The NPC's belief comes from its own evidence; the line is chosen by `believes` alone; a correction reply must write a real telling (S12-S2-10) |

## 9. Lateral links

- **Open learner models** (education) are the noticed page: a model shown to the person it describes, with ways to correct it. The games version is Zhu and Seif El-Nasr's.
- **Appeal factors in a readers' advisory** are the skeleton features as a taste vocabulary: recommend by pace and tone, not by category.
- **Non-interference** (in security: high-level inputs must not affect low-level outputs) is decision-time blindness and the firewall: a labelled flow from the model to anywhere but the named hooks is a type error.
- **Purpose limitation and privacy by design** are the facet card and the closed vocabulary.
- **Lines and veils in tabletop safety tools** are stated settings that beat inference (MDL-08); the retract is the X-card (BND-22).
- **Informed consent in research ethics** is the first-run disclosure plus the consented tuning sessions.
- **A magician's force and a con's shill** are the covert influence the reveal test excludes: both depend on the target not seeing the mechanism.
- **Closed-loop control with delay** is the reason for hysteresis and slow gain (DIR-35); here it also explains why the estimator's clock is play time and its gain is capped.
- **A dossier-7 manipulativity class** and **a Mathur attribute** are related views of how much a lever hides or removes. Class 4 (changing what V has observed or could decide on) reads as "restrictive" and "covert" together.

## 10. Open questions

1. **Noticed or watched?** Does a callback that names one or three witnessed acts read as being noticed, while a rate or an aggregate reads as being watched? (T12-03.) The rule that counts come from the speaker's own witnessing is a guess at the boundary L3 called least studied.
2. **Is approach worth its cost?** Do returns, dwell and gaze improve acceptance enough to justify a second, opt-in rung? (T12-02.)
3. **What default for `noticing`?** `acts` is a judgement; panels may show `off` costs nothing, or that `approach` is welcome when explained.
4. **How long a half-life, and what cap?** The 10 play-hour half-weight, the 12-observation cap and the 1.5-fold bound are all **[J]**.
5. **Does "why this?" raise or lower uptake?** And does seeing the reason change what V does (T12-04)?
6. **Is gaming of the model a problem?** If V learns to farm a kind of offer, should the engine care? D-09 and DIR-36 say the model should be harmless to game.
7. **A carry-over across playthroughs.** Settings-only carry-over (exclusions, the dial) is cheap and private. A model carry-over would break BRN-04. Does a profile layer (the Studio's direction) want either?
8. **Where does the model live in the save?** A separable section is needed for redaction (PRV-02), and the record's size budget is open.
9. **Does a wrong NPC attribution (D-22) cost trust, and is a correct one rewarded?** The correction reply must be real (S12-S2-10); the effect on trust is unmeasured.
10. **Who may propose a new facet?** A review route for the core, with the dark-pattern gate, is assumed; the authoring side of it (dossier 16) is open.
11. **Disparate treatment across Vs.** The starvation test covers decliners. Does anything treat players differently by how they play in a way a review would call unfair?
12. **The legal floor** (PRV-06), for dossier 19.

## 11. Testing agenda

The evidence is thin where the claims are boldest: no study I found tests whether a named act or a rate reads as noticing or as surveillance, whether showing a reason raises or lowers uptake in a game, or what a narrative director's model costs in trust. So this section is a plan to find out, ordered by cost. Offline tests need no people and run in days. Panels need a prototype and consenting participants. The in-game items go into one prepared session (the maintainer runs the game; agents do not). Thresholds are **[J]** and are written down before each run. Where a human sample is small, report the effect size with its interval and call the result exploratory. Data stay local and consented (PRV-05).

### 11.1 Offline, on the reference model (do first)

| # | Test | What it settles |
|---|---|---|
| T12-01 | **The invariance battery as CI fixtures.** Option invariance, freeze, outcome independence, the firewall read-set audit, forbidden hook inputs, strain sign test, export redaction, card coverage (M12-01 to M12-04, M12-11 to M12-13, M12-15, M12-16) | Whether the line between serving and steering holds in code. Cheap, and it blocks merges |
| T12-07 | **The estimator on synthetic players.** Known tastes, with and without the exposure denominator; taste shift; decline-everything; a farmer; a return-maximiser (M12-05 to M12-08, M12-17). Compare rate ranking against a typed baseline (M12-06) | Whether the denominator matters, how fast the model recovers, whether breadth survives, and whether the gaming players gain anything |
| T12-08 | **The pair test and the landing harness.** Scripted events with two histories; staging differs and the world is identical (M12-14, offline half) | Whether orientation changes only staging |

### 11.2 Panels on transcripts and the prototype (after the M3 prototype)

| # | Test | Design | What it settles |
|---|---|---|---|
| T12-02 | **Is approach worth its cost?** | From consented session recordings, predict acceptance of the next offer with T0 and T1 evidence, then add T2 counters. Compare log-loss | Whether the opt-in rung earns its place (INF-10) |
| T12-03 | **Noticed or watched?** | Within-subject, 30 or more readers per cell **[J]**. The same callback in four forms: one witnessed act; a witnessed "third time"; a rate ("seven out of ten"); the same content in system voice. Rate "noticed" and "watched" on seven-point scales, plus comfort | Where the line sits, and whether the witnessed-count rule (S12-S2-09) is right |
| T12-04 | **Does "why this?" help?** | Prototype with and without the control; uptake of offers, retract use, trust items | Whether TRN-04 is worth its surface |
| T12-05 | **Reveal against hidden.** | Three arms: told at the start, shown the page at the end, never shown. Adaptation on in all three. Trust, fairness and willingness to continue. Add a fourth arm told that the game adapts, with no adaptation, to test the placebo (F-04) | Whether disclosure costs anything, and whether the page can be trusted not to be a placebo. Sets the influence cap |
| T12-06 | **Can people use the page?** | Ten testers, think-aloud. Before pressing, each predicts what "Use less", "Stop using" and "Start fresh" will do, and what the page cannot change | Comprehension of TRN-01, TRN-05 and TRN-06 |

### 11.3 In the game: one prepared session

One session, batched, with the exact candidate and profile written beforehand, and a friction log kept throughout. All of it waits on the bridge.
1. A scripted route of about 30 minutes, run three times from one save with `noticing` off, `acts` and `approach`. Record offers and times (checks M12-03 and M12-05 against live data).
2. Read the page in the game's journal. Does it match what happened?
3. Press "Use less" and "Start fresh". Does the next 10 minutes behave as the model-off run?
4. Meet two NPCs with different orientations in the same event. Do the staging records differ and the world stay the same?
5. Export a save and a report; confirm the model is absent.
6. Log every friction point: wording, placement, anything that made the page feel like a tracker.

### 11.4 Longitudinal, with early testers

Over several sessions: does variety narrow (M12-05)? Does the estimate lag a real taste shift (M12-08)? A three-question weekly check on trust, fairness and feeling watched. A local export testers choose to share. Withdrawal at any time.

## 12. Requirements

Each requirement names the section it extends or challenges and the principle it traces to. "Challenges" marks a place where the current text is wrong, incomplete or silent for the reason given. Tunables are **[tunable]** and need fixtures from the evaluation work. New lint rules continue S2's numbering from L-56; new fixtures from SF-32.

### 12.1 S2 (the seeding layer)

| # | Requirement | Section | Traces to |
|---|---|---|---|
| S12-S2-01 | **A firewall on `believes`.** In `{ believes: { who, of, … } }`, `who` MUST be a role cast to an in-world actor. It MUST NOT resolve to a root actor (`director`, `city` or `v`). New lint L-56 (error). The atom reads an NPC's belief through `knows` only. **Challenges** §2.6, whose last bullet allows "beliefs held about V" without saying whose, while S0 §11.3 gives the root actor `director` beliefs about `v` | S2 §2.6, §11.1 | LIN-10, MDL-06 |
| S12-S2-02 | **Define "a state of V", and add S2-I-13, "the model has no entrance".** `fact` and `cap` read game facts only (skills, gear, money, level, quest state). No atom reads V's inner state, V's preferences or the director's model. No `Pred`, `Cost`, `EffectDecl`, `OfferSpec` field, `ResponseTemplate`, variant selector or registry function reads or writes the director's model. Registry functions are compiled with a read-set, and one whose read-set includes a `director → v` belief is rejected (L-57). **Challenges** §2.6 ("No atom reads a state of V"), which sits beside `cap`, "a capability read over V's state", and S2-I-7, whose wording does not cover the director's model | S2 §2.6, §13 (S2-I-7), §11.1 | LIN-10, MDL-01 |
| S12-S2-03 | **Offer content is model-independent, and frozen at display.** Options, their order, costs, stakes, null path, decline responses, defaults and wording are fixed by the spec and the recorded draws at first release. `OfferSpec` has no field for adaptive order or emphasis. From `displayed` until `answered` or `expired`, S2 passes no model-derived value to any hook concerning that delivery. Re-presentation after a load uses the recorded release data. Fixtures SF-33, SF-34 | S2 §2.9, §2.11, §8.4, §8.5 | LIN-03, LIN-04 |
| S12-S2-04 | **Clamp the fit term.** Each `fitWeight(o)` is clamped to ± `fitCap` = ln 1.5 **[tunable]** before it enters `score(o)`. The draw record keeps the raw and the clamped value. `fitWeight` is 0 when `noticing` is `off` or the director is off. **Challenges** §3.4, where `Σ_fit fitWeight(o)` is unbounded and so can swamp the declared weights and `K` | S2 §3.4 | LIN-08, MDL-07 |
| S12-S2-05 | **Bound the arbiter's hooks.** The phase hook MAY only remove deliveries. The scoring hook returns a delta clamped to ± `scoreCap` **[tunable]** around the built-in score, and S2 records both. With `noticing: off`, the built-in score is used. The joint hook reads game state only. **Challenges** step 5 ("S3's scoring hook scores what remains"), which has no bound | S2 §8.3 steps 4 and 5 | LIN-08, LIN-06 |
| S12-S2-06 | **Hook inputs are a closed list (new invariant S2-I-14).** A hook receives only: the delivery record (features, class, purpose, authored, pull), attention aspects, the session state, tempo, `playTotal` and the settings. No quit, menu, save, idle time, session length, time of day or return count reaches a hook. Fixture SF-35 perturbs forbidden inputs and expects byte-identical outputs. **Extends** S2-I-11 and S2-I-12 | S2 §3.4, §8.3, §2.13, §13 | LIN-07, DRK-06, LIN-06 |
| S12-S2-07 | **Offer and response events carry features.** The `offer` event (minted at `displayed`) carries `features { verb, stake, relationship, outcome, tone, channel }`, `class`, `purpose`, `pull`, `authored`, `deliveryId` and the content descriptors. The `response` event carries `kind` (`accepted`, `declined`, `lapsed-after-perceived`, `retracted`, `abandoned`, `countered`) and the play seconds since display. The model is folded from these canon events alone, so it survives the seed record's cap of 512 entries. **Extends** §10.2, which defines the ledger only as "was V shown this?", and S0 §9.2 (V4-3) | S2 §8.5, §7.4, §10.1, §10.2 | INF-02, INF-07, MDL-02 |
| S12-S2-08 | **A why-record, and a "why this?" pull entry.** `provenance.why` lists `{ kind: 'schedule' \| 'fit' \| 'score' \| 'phase', beliefs: Id[], delta }` whenever a hook's output was non-zero. A pull entry renders it in the settings voice from a closed rendering table, naming only events in the exposure ledger. A delivery whose cause includes a belief is an `adaptation` record, never a `consequence` (AGY-42, R5-23) | S2 §8.1, §10.1, §8.7 | LIN-02, TRN-04 |
| S12-S2-09 | **Honesty lexicon and witnessed counts.** (a) Narrator and system voice never assert what the game has noticed, tracked, learned or concluded about V. Only NPC voice (D-22, AGY-44) and the settings voice (the noticed page, "why this?") may. (b) `EventPattern` gains `witnessedBy?: RoleKey`. A callback or pattern line that states a count must use `count` with `witnessedBy` set to the speaker. L-58 errors otherwise. (c) No rate, percentage, score or badge derived from the model appears on an offer or in fiction (L-59). **Extends** "No cost class feeds a visible number" and L-20 | S2 §2.6, §2.9, §11.1 | DRK-08, MDL-01, TRN-03 |
| S12-S2-10 | **Attribution lines must be correctable in fact.** The `believes` need's belief must have `source.by` of `observed` or `told`. The template is selected by the `believes` result alone, never by a hook. The reply that "can correct it" must carry an effect that writes an observed telling (S0 §11.2, I-9), so the NPC's belief revises. A correction reply without that effect is an error (L-60). Fixture SF-36. **Extends** L-52 | S2 §2.9, §11.1 | LIN-10, T-12 |
| S12-S2-11 | **Closed timing purposes.** The `purpose` vocabulary stays closed in S4. No purpose, `category` or `onExpire` may be keyed to return, retention, streak or exit. `notice` serves the one-time change notice of TRN-07. A lint on pack-added purposes | S2 §2.12 | DRK-01, DRK-06, TRN-07 |
| S12-S2-12 | **Model settings are recorded ops.** The `noticing` dial, the exclusion list and the reset floor change decisions, so they are recorded (S0's `SettingsSet` extended), not presentation settings. S2 passes them to hooks. The `setting` atom MUST NOT accept them (L-61), so a seed's meaning never depends on them. **Challenges** S0 §14.2's "presentation settings are not recorded" for anything that changes what is offered | S2 §2.6, §12.1; S0 §14.2 | TRN-05, TRN-06, LIN-10 |
| S12-S2-13 | **Export and privacy.** Layer 2 persists no gaze, camera, menu, idle or input data. T2 counters arrive from S5 as aggregates and S2 stores none. Exports and reports exclude the `director → v` belief kind and the belief lists inside why-records by default (the text stays). A save with the model section absent loads, and the model restarts empty (S2-I-6 is unaffected) | S2 §12.1, §12.2, §10.2 | PRV-02, PRV-03, INF-10 |
| S12-S2-14 | **Fixtures.** SF-32: the `believes` firewall (the director as `who` fails L-56). SF-33: decision-time freeze. SF-34: option invariance across model states. SF-35: forbidden hook inputs. SF-36: attribution correction. SF-37: model-off equivalence (`noticing: off` gives `fitWeight` 0 and built-in scores, byte-identical to a no-director run from the same state) | S2 §14 | M12-01 to M12-03, M12-10, M12-11 |

### 12.2 P5/S3 (the director)

| # | Requirement | Section | Traces to |
|---|---|---|---|
| S12-P5-01 | **A closed facet vocabulary with cards.** Facet types are those of §5.2. Each has a card (label, purpose, evidence rule and weights, decay, minimum evidence, readers, forbidden uses, validity entry, excluded content classes, example renderings). A facet without a card does not load. Packs cannot add facets; new skeleton values extend the vocabulary automatically unless their content class is untracked. **Extends** S0 §11.3, which says only that beliefs are "formed by S3's inference policy", and **challenges** DRV-49 (drive profiles) and the `relevance` drive of dossier 1 §12, which can run on feature rates | S0 §11.3; D1 §12 | MDL-01 to MDL-03 |
| S12-P5-02 | **The denylist and untracked classes.** Schema-level denylist (MDL-04). Dossier 18's content descriptors mark classes untracked, and the fold drops events carrying them (MDL-05). A static audit runs on every facet and hook input | S0 §11.3; S4 | MDL-04, MDL-05 |
| S12-P5-03 | **The signal ladder.** T0 and T1 only by default. T2 counters only with `noticing: approach`, aggregated, expiring within about one play hour **[tunable]**, never raw and never said by an NPC. T3 is never read. **Extends** DIR-39 (approach signs) and **challenges** it where gaze and dwell are listed as plain inputs | D7 DIR-39; S5 | INF-10, PRV-03 |
| S12-P5-04 | **The inference policy is a fold.** Fold canon `offer` and `response` events after the floor, less excluded facets, with the evidence table, decay `H/(H+Δ)` and cap of §5.3. Arithmetic is S0 §1.3's only. Stored beliefs carry `source: { by: 'inferred', rule, from }`, and `confidence = n / (n + 2)` for `n > 0` (no belief at `n = 0`). A test asserts stored beliefs equal a fresh fold. **Extends** S0 §11.1 and §11.3 | S0 §11.1, §11.3, §1.3 | INF-02 to INF-07 |
| S12-P5-05 | **The influence function.** `fitWeight` and the scoring delta follow §5.3, with the caps of S12-S2-04 and S12-S2-05. It applies to offers and never to events. A consumer declares its minimum confidence state (INF-05) | S2 §3.4, §8.3 | LIN-08, MDL-07, INF-05 |
| S12-P5-06 | **Exploration and breadth.** The optimism bonus below three observations; at least one in four pushes from outside the top band **[tunable]**; a breadth floor for decliners that lowers rate but not variety (DRV-46) | D1 DRV-46; D7 PR-21 | INF-08, LIN-08 |
| S12-P5-07 | **Strain subtracts; the objective has no retention term.** The hook-input list is closed (S12-S2-06). Strain signals (recent deaths, a long high-intensity phase, repeated failure) only delay, hold or withdraw. A reward and objective audit lists every quantity the director optimises and fails if any is a retention proxy. **Extends** DIR-35 and DIR-07, and **challenges** PR-21 and DIR-22: the receptivity belief `p` is a facet rate with the states of INF-05 and nothing else | D7 DIR-07, DIR-22, DIR-35, PR-21 | LIN-06, LIN-07 |
| S12-P5-08 | **Option invariance and decision-time blindness on S3's side.** Hook outputs are computed at release and stored. S3 does not recompute them at display and does not subscribe to model changes that touch an open offer. The mapping from DIR-02's classes: levers of class 0 to 3 may read the model; class 4 never exists | D7 DIR-02, PR-2 | LIN-03, LIN-04 |
| S12-P5-09 | **The orientation index.** Per NPC and group: evidence classes, states and margin as in §5.7, `unformed` by default, decay by the tie's own timescale. Read only by `staging` and `outlet` fields | S0 §11; D2 | LND-02, LND-03 |
| S12-P5-10 | **Staging and outlets.** For an outcome that touches an NPC or group with a formed orientation, S3 chooses among authored staging alternates (witnessed or news, register) and attaches outlets of at least three stances including indifference. It never changes the outcome. Each choice is a `staging` record with its why | S2 §2.8, §8.3; D9 AGY-18 | LND-04, LND-05 |
| S12-P5-11 | **No targeting by attachment.** S1 effect generators and S3 consequence sowing get no read access to the orientation index or any bond evidence. A lint over registry read-sets enforces it. Authored seeds may choose affected parties from ties in the record | S1; S3 | LND-06, DRK-04 |
| S12-P5-12 | **The landing check and the validity gate.** After staging, classify V's next acts toward the party in a window **[tunable 10 play minutes]**. Keep a miss rate per orientation state; a state or facet below its margin has zero influence and is not shown (INF-09) | D7; S0 §13 | LND-07, INF-09 |
| S12-P5-13 | **Why-records and explanation.** Every decision where a hook's output was non-zero produces a why-record (S12-S2-08). A closed rendering table turns reasons into one plain sentence. An agent-facing `explain` lists the facets, events and caps that applied. **Extends** PR-44 and PR-47 | S0 §13; D7 PR-44, PR-47 | LIN-02, TRN-08 |
| S12-P5-14 | **The noticed page.** Content and wording as in §5.6: rows above the minimum evidence, each with its events; no numbers; pull-only; reading mints no event; generated from the model so each control is real; recent choices that used the model | S4; S6 | TRN-01 to TRN-04, LIN-09 |
| S12-P5-15 | **Controls.** The `noticing` dial (`off`, `acts`, `approach`; default `acts` **[judgement call]**). Per facet: use less (halves the facet's influence), stop using (influence zero), forget (moves a facet floor). Start fresh (global floor). A retract is an exclusion. Stated settings override inference; labels are verbs. Recorded ops (S12-S2-12). Reset-equals-fresh is a test | S0 §14.2; S4 | TRN-05, TRN-06, MDL-08 |
| S12-P5-16 | **Disclosure.** A short plain text, shown once in the first-run settings flow and again by a `notice` delivery only when what is noticed changes: what is noticed, what it changes, what it never changes, where to see and reset it | S2 §2.12; S4 | TRN-07 |
| S12-P5-17 | **Flows and the firewall.** The table of §5.1 as an executable check. The model never writes an NPC belief. V's inferred frames are marked `inferred`, are unreadable by predicates and NPCs, and feed relevance and pull only. NPC beliefs about V reach the director only as reputation aggregates, not as evidence of taste. **Extends** S0 §10.4 and §11.3 | S0 §10.4, §11.3, §11.4 | LIN-10, MDL-06 |
| S12-P5-18 | **Branch-locality and cold start.** The model begins empty on a new branch and is never read across branches or playthroughs. Cold start is handled by the flat prior and by offers that hold across plausible tastes. A settings-only carry-over is an open question | S0 §14.2; D11 BRN-04 | MDL-06, MDL-07 |
| S12-P5-19 | **Privacy.** Local only; no model feature in any prompt or call to a remote model (dossier 22); export redaction; a viewer for anything shared; telemetry only with opt-in, aggregated, withdrawable; no runtime experiments | S6; P8 | PRV-01 to PRV-05, DRK-09 |
| S12-P5-20 | **The dark-pattern review gate.** A record per director mechanic (§5.5): Zagal's definition, the six attributes scored, checks C1 to C8, a reviewer who is not the author. A mechanic with an attribute present and no disclosure does not merge. The records live beside the mechanic's specification | D7; code-health ledger | DRK-01 to DRK-09, LIN-01 |
| S12-P5-21 | **The evaluation harness.** Synthetic players with known tastes, including a taste shift, a decline-everything player, a farmer and a return-maximiser; three arms (`off`, `acts`, `approach`); M12-01 to M12-17 computed from logs without running the engine; a switch for the three arms | D7 PR-46; P9 | M12-01 to M12-17 |
| S12-P5-22 | **Wellbeing is not inferred.** Any break or time cue is a player-set feature owned by dossier 18 and player configuration. The director reads nothing for it, and no facet or hook input names compulsion, fatigue or mood | S4; D18 | MDL-04, T-8 |

## Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give. MOT-01 (reactance and self-determination), ETH-18 (research ethics for telemetry) and the privacy-law fields on the map are used and not repeated.

| # | Field | Source | Tier |
|---|---|---|---|
| MM-1 | **Online manipulation theory:** manipulation as covert influence that exploits decision-making vulnerabilities, distinct from persuasion | Susser, Roessler and Nissenbaum 2019 (opened, summarised) | Core under MOT-05. It supplies the test the engine's line rests on |
| MM-2 | **A dark-pattern attribute taxonomy and its normative perspectives** (asymmetric, covert, deceptive, information hiding, restrictive, disparate treatment) | Mathur, Mayer and Kshirsagar 2021 (opened, first part). The map lists Gray and colleagues 2018 only | Core under MOT-05, beside Gray and colleagues |
| MM-3 | **The ethics of persuasive technology:** the disclosure principle and the golden rule of persuasion | Berdichevsky and Neuenschwander 1999, quoted in Zagal and colleagues (the quoted principle read; the paper itself not opened) | Supporting under MOT-05 |
| MM-4 | **Algorithmic transparency and explanation research** (what explanations do to awareness, mental models and trust) | Eslami and colleagues 2015; Rader, Cotter and Cho 2018; Kulesza and colleagues 2013 (abstracts) | Supporting under ETH-20. It supplies the evidence for the noticed page |
| MM-5 | **Feedback loops in recommenders:** homogenisation and narrowing | Chaney, Stewart and Engelhardt 2018; Nguyen and colleagues 2014 (abstracts) | Supporting under MOT-02. It decides the exposure denominator |
| MM-6 | **Personalisation reactance and the useful-and-creepy finding** | White and colleagues 2008; Ur and colleagues 2012 (abstracts) | Supporting under MOT-05. It frames "noticed against watched" |
| MM-7 | **Placebo and expectation effects of claimed adaptation** | Denisova and Cairns 2019 (abstract) | Supporting under MOT-05. A claim of adaptation is itself a lever |
| MM-8 | **Guilt and moral disengagement in games** | Hartmann, Toz and Brandon 2010; Weaver and Lewis 2012 (abstracts) | Supporting under NAR-15. It shows the player's own judgement matters to how an outcome lands |
| MM-9 | **Identifiability of play data** | Nair and colleagues 2023 (abstract) | Supporting under ETH-12 |
| MM-10 | **Open learner and open user models** | Named in Zhu and Seif El-Nasr (Brusilovsky and colleagues; Bull); not read | Supporting under ETH-20. A primary source is needed before it is credited |
| MM-11 | **Counts-based player models and their validity** (an alternative to types) | Kirchner-Krath and colleagues 2024; Hamari and Tuunanen 2014 (record, abstract) | Supporting under MOT-02 |

## Credit candidates

Each third-party work that taught us something used in the principles above. "Full text" means I read the paper this session. "Abstract" or "record" means I saw an abstract or catalogue record only. Creator names are as the pages show them. Items marked not credit-ready were read only through summaries or search results.

| Creator as evidenced | Work | Link | What we learned | Link status |
|---|---|---|---|---|
| José P. Zagal, Staffan Björk and Chris Lewis | "Dark Patterns in the Design of Games", Foundations of Digital Games 2013 | https://research.chalmers.se/en/publication/177148 | A definition of a dark game pattern (against players' best interests and without consent), three families of such patterns, and that consent needs literacy in the manipulation | full text (author copy: https://gup.ub.gu.se/file/101018) |
| Jichen Zhu and Magy Seif El-Nasr | "Open Player Modeling: Empowering Players through Data Transparency", arXiv 2110.05810 | https://arxiv.org/abs/2110.05810 | Three levels of opening a player model to the player (outcome, process, editable), and the costs of doing so: immersion, inaccuracy, gaming and privacy | full text |
| David Thue, Vadim Bulitko, Marcia Spetch and Eric Wasylishen | "Interactive Storytelling: A Player Modelling Approach", AIIDE 2007 | https://ojs.aaai.org/index.php/AIIDE/article/view/18780 | A weight-vector player model driving encounter selection, and a 90-student study whose support sat in subgroups, not overall | full text (author copy) |
| Alena Denisova and Paul Cairns | "Adaptation in Digital Games: The Effect of Challenge Adjustment on Player Performance and Experience", CHI PLAY 2015 | https://www-users.york.ac.uk/~pc530/pubs/Denisova_CHIPLAY15.pdf | Covert adaptation of a timer raised immersion without being noticed in a short session, with a caution about repeated play and fairness | full text |
| Alena Denisova and Paul Cairns | "Player experience and deceptive expectations of difficulty adaptation in digital games", *Entertainment Computing* 29, 2019 | https://eprints.whiterose.ac.uk/139704 | Telling players a game adapts raised immersion whether or not it did, so a claim of adaptation is itself a lever | abstract |
| Daniel Susser, Beate Roessler and Helen Nissenbaum | "Technology, autonomy, and manipulation", *Internet Policy Review*, 2019 | https://policyreview.info/articles/analysis/technology-autonomy-and-manipulation | Manipulation is covert influence that exploits decision-making vulnerabilities; surveillance, adaptivity and invisibility make it easy | opened (summarised by the fetch tool) |
| Arunesh Mathur, Jonathan Mayer and Mihir Kshirsagar | "What Makes a Dark Pattern... Dark? Design Attributes, Normative Considerations, and Measurement Methods", CHI 2021 | https://arxiv.org/abs/2101.04843 | Six attributes by which a design is dark (asymmetric, covert, deceptive, information hiding, restrictive, disparate treatment) and four normative perspectives | opened (first part) |
| David Melhart, Julian Togelius, Benedikte Mikkelsen, Christoffer Holmgård and Georgios N. Yannakakis | "The Ethics of AI in Games", arXiv 2305.07392 | https://arxiv.org/abs/2305.07392 | Ethics of eliciting, sensing and detecting emotion in games, including the privacy against safe-spaces trade-off | abstract |
| Dietvorst, Simmons and Massey | "Algorithm aversion: People erroneously avoid algorithms after seeing them err", *JEP: General* 2015; "Overcoming algorithm aversion", *Management Science* 64(3), 2018 | https://repository.upenn.edu/fnce_papers/58 ; https://repository.upenn.edu/marketing_papers/389 | People lose confidence in an algorithm faster than in a human after the same error, and letting them modify its output, even slightly, raises use and tolerance. Given names not shown on the pages I saw | abstract |
| Eslami and colleagues | "'I always assumed that I wasn't really that close to [her]': Reasoning about invisible algorithms in the news feed", CHI 2015 | https://www.ideals.illinois.edu/items/55412 | Most users did not know the feed was curated, reacted with surprise and anger on finding out, and then felt more control | abstract and summaries. Author list not shown on the pages I saw; add before crediting |
| Emilee Rader, Kelley Cotter and Janghee Cho | "Explanations as Mechanisms for Supporting Algorithmic Transparency", CHI 2018 | https://pure.psu.edu/en/publications/explanations-as-mechanisms-for-supporting-algorithmic-transparenc/ | Explanations raised awareness and helped people judge bias and control, but helped less with judging correctness | abstract |
| Kulesza and colleagues | "Too much, too little, or just right? Ways explanations impact end users' mental models", VL/HCC 2013 | https://openaccess.city.ac.uk/id/eprint/6344 | Completeness helped mental models more than soundness, but very low soundness cost trust. Given names not shown on the pages I saw | abstract |
| Blase Ur, Pedro Leon, Lorrie Faith Cranor, Richard Shay and Yang Wang | "Smart, Useful, Scary, Creepy: Perceptions of Online Behavioral Advertising", SOUPS 2012 | https://fpf.org/wp-content/uploads/2021/05/Smart-Useful-Scary-Creepy.-Perceptions-of-Online-Behavioral-Advertising-.pdf | People call targeting useful and invasive together, and assume more is collected than is | abstract |
| Tiffany Barnett White, Debra L. Zahay, Helge Thorbjørnsen and Sharon Shavitt | "Getting too personal: Reactance to highly personalized email solicitations", *Marketing Letters* 19(1), 2008 | https://link.springer.com/article/10.1007/s11002-007-9027-9 | Highly personalised offers that do not explain their fit draw reactance, less so where the service seems useful | abstract and press coverage |
| Nguyen, Hui, Harper, Terveen and Konstan | "Exploring the filter bubble: the effect of using recommender systems on content diversity", WWW 2014 | https://experts.umn.edu/en/publications/exploring-the-filter-bubble-the-effect-of-using-recommender-syste/ | A slight narrowing over time, less for people who consumed what was recommended. Given names not shown on the pages I saw | abstract |
| Allison J. B. Chaney, Brandon M. Stewart and Barbara E. Engelhardt | "How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility", RecSys 2018 | https://arxiv.org/abs/1710.11214 | Retraining on data the system itself influenced homogenises behaviour without gaining utility | abstract |
| Jeanine Kirchner-Krath and colleagues | "Uncovering the theoretical basis of user types", *IJHCS* 190, 2024 | https://fis.uni-bamberg.de/handle/uniba/115001 | Four popular typologies overlap and reduce to five continuous dimensions; use continuous measures | record |
| Juho Hamari and Janne Tuunanen | "Player types: A meta-synthesis", *ToDiGRA* 1(2), 2014 | https://todigra.org/index.php/todigra/article/view/1697 | Earlier player types synthesise into seven dimensions | abstract. Given names as the page shows them: check before crediting |
| Sandra Wachter and Brent Mittelstadt | "A Right to Reasonable Inferences", *Columbia Business Law Review* 2019 | https://journals.library.columbia.edu/index.php/CBLR/article/view/3424 | Inferences are weakly protected ("economy class" data); a right to ex-ante justification and ex-post challenge is proposed | abstract |
| Vivek Nair, Wenbo Guo, Justus Mattern, Rui Wang, James F. O'Brien, Louis Rosenberg and Dawn Song | "Unique Identification of 50,000+ Virtual Reality Users from Head & Hand Motion Data", USENIX Security 2023 | https://usenix.org/conference/usenixsecurity23/presentation/nair-identification | Play data identifies people: about 94 per cent from 100 seconds of motion | abstract |
| Arthur A. Raney | "Expanding disposition theory: Reconsidering character liking, moral evaluations, and enjoyment", *Communication Theory* 14(4), 2004 | https://researchconnect.buffalo.edu/en/publications/expanding-disposition-theory-reconsidering-character-liking-moral/ | Attachment to a character can form before moral judgement, and viewers defend it | abstract |
| Tilo Hartmann, Erik Toz and Marvin Brandon | "Just a game? Unjustified virtual violence produces guilt in empathetic players", *Media Psychology* 13(4), 2010 | https://research.vu.nl/en/publications/6d94c7ce-66fe-4c78-a0ac-7a94a4c37d14 | Guilt follows unjustified virtual violence, more in empathetic players | abstract. Given names as the repository shows them: check before crediting |
| Weaver and Lewis | "Mirrored morality: An exploration of moral choice in video games", *Cyberpsychology, Behavior, and Social Networking*, 2012 | https://journals.sagepub.com/doi/10.1089/cyber.2012.0235 | In a commercial role-playing game most players made moral choices, which tracked a moral-foundations questionnaire | abstract (small sample, 18 to 24 year olds per a later review). Given names not shown on the pages I saw |
| Laurel Tarulli and Victoria A. Caplinger | "In the Eye of the Beholder: Readers' Advisory from a Cataloging Perspective", *RUSQ* 52(4), 2013 | https://journals.ala.org/index.php/rusq/article/view/2892/2959 | Saricks's appeal factors and Pearl's four doorways as a vocabulary for matching readers to books | opened |
| Berdichevsky and Neuenschwander; Gray, Kou, Battles, Hoggatt and Toombs; Barber and Kudenko; Yannakakis and Togelius | The disclosure principle (CACM 1999); "The Dark (Patterns) Side of UX Design" (CHI 2018); GADIN (IEEE TCIAIG 2009); *Artificial Intelligence and Games* | not individually verified | The disclosure principle (read as quoted in Zagal and colleagues); the five categories of dark pattern (summary); a user model that picks the next dilemma (record); a field overview (table of contents via the lenses) | **Not credit-ready**: quoted passage, summaries or records only |
