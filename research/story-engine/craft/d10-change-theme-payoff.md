# Dossier 10: character change, theme and payoff

**Status:** v1, 23 October 2026. Dossier 10 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: NAR-28 (character-arc theory), NAR-29 (foreshadowing, setup and payoff), NAR-09 (ludonarrative harmony and procedural rhetoric). Supporting field: NAR-30 (theme as a controlled variable). Feeds P4 (the seed language, now specified as [S2](../spec/seeding.md)) and P5 (the procedural engine: director, sowing, sifting). It is the craft side of the gap that lens L12 closed ([L12](lenses/L12-gaps.md), areas 2 and 3). It builds on [dossier 4](d04-quest-structure.md) (the gig and its promise ledger), [dossier 9](d09-agency-consequence.md) (the exposure ledger, consequence and the freedom to decline) and [dossier 8](d08-scale-threads-time.md) (a unit's scale is the level of the context chain it turns). It does not repeat [dossier 7](d07-direction-pacing.md)'s trace and dread rules (DIR-41 to DIR-50); it cites them.

**How far each source was read.** *Full text* means a file I converted and read locally. *Page* means a web page fetched through a tool that returns a model-written summary, so wording is paraphrase. *Summary* means a search-engine summary or another paper's account only. *Abstract* means the abstract only. *Memory* means recalled and not rechecked. *Lens* means I relied on a lens file. Where a lens claim did not hold up, §3.3 says so. All example stories are invented for this dossier and are not content.

## In brief

- **The craft is thin exactly where the engine leans on it.** Arc theory, theme and foreshadowing are writers' tools. I found no study of theme coherence in generated narrative, none of arcs in a simulation, and one controlled test of generated foreshadowing. That test went against the lens's hope: a hint sentence added no surprise beyond a flashback that explained the cause, and the version with the hint had the lowest coherence ratings (54 participants, two short stories). Every principle here is a testing agenda, graded honestly.
- **An arc is a label on a recorded run of changes, never a template to generate from.** What can be modelled is a held view (a belief the evidence does not justify), pressure (independent events and cross-pressure the kernel already emits), a stability that most NPCs have in plenty, and a revision or a refusal. In a toy with assumed inputs, one or two pressure events almost never turn a stable NPC and four or five usually do, so arcs gather where one thread keeps touching the same person. Most people in the city stay put and change others, which is the flat arc, and it needs to be a first-class result, not an absence.
- **The V asymmetry resolves cleanly.** NPC change is the engine's to model. V's "change" can only be what V's acts leave in the record and how the city's beliefs about V move. The engine writes no arc for V, reflects acts in the world's behaviour before words, and must not engineer a slide. The one real hazard is the slippery slope: it works on people in the laboratory, so a director that orders escalating asks would be a lever against V.
- **Theme is measured from the record, not from tags.** S2 §2.3 gives each seed a tone with a role of supports, opposes or complicates, and the role has nothing to be relative to. Theme needs a premise, a signature over what was offered, what it cost, who paid, when, and whether V saw it, and an audit that computes the realised pattern from the record and compares it with the declared one. Three offers with the same cost are not evidence: against a 30 per cent chance background a pattern needs about 10 to 40 offers to show.
- **Traces come in three feelings and three sources.** Cause shown and outcome pending is suspense. Outcome shown with its causes visibly missing is curiosity. Outcome shown with its causes unnoticed as missing, then supplied, is surprise that can be accounted for afterwards. All three can be built from one record: portents, a handle that asks "why", and a why-trace. Plant situations that are true whether or not the event fires, not promises about outcomes. Prefer found causes, then found-and-chosen, then constructed ones, and pin a constructed cause when V first sees it.
- **A change needs a witnessed before.** The exposure ledger makes this checkable: a turn scene may be staged for V only if V saw an earlier act of the old stance, or the scene carries a told alternate. Off-screen change settles at joints and shows as a difference between two sightings.
- **For the seed language** this dossier asks for 23 changes to S2: a separate theme field, a premise object, per-action costs, a `believes` predicate, typed plants on the promise ledger, trace provenance with pin-on-display, a canon guard and two profiles. **For P5** it asks for 23: an argument-profile audit, a weak stance quota, an NPC change policy, an arc recogniser, a plant planner, a constructed-cause service and an escalation guard (§11).

## 1. Scope and why it matters here

The engine will tell many small stories across a city, and three things decide whether they read as a world or as a generator. People must change in ways that look caused (NAR-28). A district must seem to be about something, though no one writes that in prose for every gig (NAR-09, NAR-30). And an event must read as caused and fair, so a player can claim the foresight (NAR-29). Each has a failure the lenses named: everyone arcs, rhetoric that contradicts the fiction, and random events.

The decisions fix the shape of the answer. [D-09](../decisions.md) says V is observed, never owned: the engine holds beliefs about V, sets no drives and never speaks for V. [D-10](../decisions.md) says everyone has their own model. The foundation says the scale of a unit is the level of the context chain it turns ([UNT-03](d08-scale-threads-time.md)). So this dossier treats character change as a change in *recorded* things (beliefs, concerns, memberships, ties), theme as a pattern in *recorded* offers and costs, and payoff as the visibility of a *recorded* cause chain.

| Layer or concern | What this dossier gives it |
|---|---|
| 1. Simulation | Held views as beliefs with a stability; pressure from independent events and `Dilemma`s; a `turning` event kind; bounded importance drift; asymmetric reputation updates |
| 2. Seeding (S2) | A theme field apart from tone; a premise object; per-action costs; a `believes` predicate; typed plants on the promise ledger; trace provenance and pin-on-display; a canon guard; two profiles (§11.1) |
| 3. Procedural engine (P5) | The argument-profile audit; a weak stance quota; the arc recogniser; the plant planner; the constructed-cause service; the escalation guard; staging of turns (§11.2) |
| 4. Authored content | What an author writes for a character test (creed, pressure, decision), for a premise (stances, carriers) and for a plant (cause, weight, payoff, closing trace) |
| Evaluation (E) | Sixteen measures (§7), including the arc recogniser's distribution, the argument profile and the plant ledger |
| Expression (X) | World-borne traces over narrated hints; reflection of V in behaviour before words; the told alternate of a turn |
| Configuration (C) | How much the city leans on its premises (scales with the proactivity dial and can go to zero) |

It does not cover relationship ladders and romance (dossier 2; Appendix A of S2), the drives catalogue (dossier 1), the director's pacing and dread (dossier 7), saves and forgetting (dossier 11), the player model (dossier 12), or how words render (dossier 21).

**Wording.** *Held view*: a belief an NPC acts on. *Pressure*: events or dilemmas that bear on a held view or on competing concerns. *Turn*: the recorded change that completes a unit ([UNT-02](d08-scale-threads-time.md)); a *turning event* is the pack event kind that records an NPC's change. *Plant*: a perceivable trace laid before an event. *Portent*: a foreground plant that announces. *Postdict*: to make an event accountable after it, by showing its causes. *Premise*: the idea a city's stories argue about. *Signature*: the pattern of offers and costs a premise predicts. **Grades** are as in P1 §4. **contested** marks a claim two sources dispute. **[sim]** marks a number from a toy model in §5 whose inputs I assumed. **[J]** marks my judgement, with the reason given.

## 2. The failure record

Failures come first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses patterns, §2.3 lists where the craft advice itself fails.

### 2.1 Cases

| # | Case | What was tried | What went wrong | Evidence |
|---|---|---|---|---|
| F-01 | **Arc theory as a generator** | Treat the three arcs (positive, flat, negative) and their parts as a recipe for characters | The craft books contradict each other, and a trade review of one calls the author's own terms nearly indistinguishable. "Flat" means two different things in the literature (§2.3). Generative narrative tends to default to transformation, and everyone arcs | *page*: Weiland's flat-arc article; *summary*: Publishers Weekly on Truby; *lens*: L12 F7. [analysis], **contested** |
| F-02 | **Change that nothing reads** (Shadow of Mordor and Shadow of War, 2014 and 2017) | A memory layer gave generated enemy captains histories that rise, betray and return | Reported: a reviewer found the sequel's missions short, plain and repetitive and outside the system. The lens infers that the rest of the content did not read from or write to the layer, and that the system's causes were not shown clearly | *lens*: L2 A7, citing the director's postmortem and two reviews; I did not open them. [practice], [shipped] |
| F-03 | **Convergence drift** (Generative Agents, 2023) | Language-model agents with memory and reflection in a small town | Reported in the paper's own sections: instruction tuning made agents over-cooperative, and one agent's interests drifted to match the others'. The lens reads this as characters growing alike | *lens*: L2 A15, citing the paper; not opened. [empirical], one system |
| F-04 | **A hint line that costs coherence** | A planner generated a flashback to explain a surprising outcome, and a foreshadowing sentence that alluded to it | In 54 participants' ratings of two short stories, the flashback raised surprise over chronological order. Adding the foreshadowing sentence added no significant surprise and gave the lowest coherence ratings in both stories. The authors guess the hint interrupts the flow | *full text*: Bae and Young 2014. [empirical], small |
| F-05 | **Accumulated choices that did not pay off** (Mass Effect 3, 2012) and **"will remember that"** (Telltale) | A trilogy-long ledger of decisions; an on-screen notice after a choice | Unpaid setups, and announced consequences that did not arrive. Covered in full in [dossier 9, F-02 and F-03](d09-agency-consequence.md) | Dossier 9. [practice], critic |
| F-06 | **Mechanics that argue against the story** (BioShock, 2007) | A choice about harvesting or freeing the Little Sisters inside a story that praises selflessness | The writer who named "ludonarrative dissonance" argued that the game rewarded self-interest while the plot asked for selflessness. The term is now stretched and disputed | *summary*: secondary accounts of Hocking's post, which I could not reach. [analysis], **contested** |
| F-07 | **A system's argument read differently by players** | Persuasive games meant to move attitudes through their rules | One thesis, as summarised, found players perceived an argument but read it and changed attitude in ways not always matching the intent; choices followed what the mechanics rewarded more than the players' own policy views. A larger experiment found stronger procedural rhetoric increased persuasion | *summary*: Anderson's UCSC thesis; *page*: Jacobs et al. 2021. [empirical], small |
| F-08 | **One meter that sorts the player into two types** (Dishonored's chaos) | A tally of kills that changes the world (guards, infestations, tone) and the ending | A review said it worked as an ersatz morality meter and trapped play in two types. A later essay argued the system was never a punishment at all. The director said the team reweighted victims so low chaos meant more than skipping a fifth of the guards | *summary*: Rolling Stone and others; one source returned 403. [practice], **contested** |
| F-09 | **A retrofitted cause the audience can see** | Resolve a plot with a cause that was not in the story until it was needed | The old name is deus ex machina. Aristotle's rule is that the unravelling should come out of the plot itself | *memory*: Poetics ch. 15. [analysis]. No study; the lens lists "retro-fitting the player can detect" as a failure |
| F-10 | **Unpaid plants, and the myth of the rule** | "Every gun that appears must fire" | The famous wording comes from memoirs (1904 and 1911), and the 1889 letter that is usually cited concerned a speech Chekhov thought unrelated to the play. It is an editor's rule of economy, not a law, and works that leave plants unfired exist on purpose | *summary*: a Wikipedia article with citations. [practice] |
| F-11 | **Spoilers and foreshadowing: the evidence disagrees** | Test whether knowing the outcome lowers enjoyment | One study (819 students) found spoilers slightly raised enjoyment of short stories, and a second on simple predictable stories found no difference. Two others found spoilers lowered it. A 2018 paper reports an effect on television episodes and none on short stories | *summary*: Leavitt and Christenfeld 2011; Johnson and Rosenbaum 2015; a 2018 listing. [empirical], **contested** |

### 2.2 What the failures have in common

| # | Pattern | Cases | What is missing | A test that catches it | Where this dossier answers it |
|---|---|---|---|---|---|
| P-1 | **A template stands in for a record** | F-01, F-02 | Change as recorded, caused events with readers | Every turn cites pressure; every turn has a consumer | CHG-01, 05, 14 |
| P-2 | **Everyone is the same, or everyone changes** | F-01, F-03 | A stability that differs by person, and a distance check | Share of NPCs with no turn; pairwise distance over a season | CHG-02, 07, 15 |
| P-3 | **The mechanics argue something the story does not** | F-06, F-07, F-08 | An audit of what the record rewards, and annotation of intended dissonance | Table of mechanic, implied value and stated value | THM-03, 10 |
| P-4 | **The argument is stated, not carried** | F-05, F-08 | Cost carried by options, bearers and traces | Cost audit; no meter | THM-01, 05, 06 |
| P-5 | **The cause shows late, or not at all** | F-05, F-09, F-10 | A cause chain V can find, an exposed plant and a closing trace | Reachable cause chain; plant ledger | PAY-01, 11, 14 |
| P-6 | **The hint hurts** | F-04 | World-borne traces in place of narrated hints | A/B with four arms | PAY-08 |
| P-7 | **Claims of foresight and of effect rest on recall** | F-07, F-11 | Measures from the ledger and the record | Ledger against reported foresight | PAY-10; §7 |

### 2.3 Where the advice itself fails

- **"Flat" means two things.** Forster's flat character is built round one idea or quality and is not a lesser character. Weiland's flat arc belongs to a fully drawn protagonist who already holds a truth, keeps it under pressure and changes the world (*page*). A system that reads "flat" as "dull" or "unchanging" will lose both. CHG-02 keeps them apart.
- **The lie-and-ghost story is a craft convention.** In Weiland's account a past wound drives a false belief, and a bigger ghost makes a bigger arc (*summary*, a reader's notes). Nothing tests it. Measured personality change in people is small and slow (CHG-03), so the engine borrows the belief-and-pressure skeleton and drops the backstory causation.
- **"Convincing" is a judgement.** Forster's test for a round character is that it can surprise convincingly. A Dutch critique in the search results says the test is hard to apply because "convincing" shifts with the reader (*summary*). The engine can only operationalise one half: the surprise must have a recorded cause (CHG-05).
- **Three steps is a convention.** The lens's "negative arcs need three observable steps" has no study behind it. Lab work shows escalation by increments in people, and impression research shows one moral lapse can change an observer's mind at once. So the number is mine to set and test (CHG-08, CHG-09).
- **A premise can become a sermon.** Egri's premise is a thesis shown through behaviour, and Truby's moral argument is the same idea in other words (both from descriptions, not the books). A premise stated aloud more than once per story reads as preachy, by the lens's claim, which I could not source. THM-13 treats it as a lint with a test.
- **Procedural rhetoric overreaches.** Sicart's critique, as summarised, is that it puts meaning in the rules and gives the player no part in making it, while rules frame play without fixing it. Anderson's results fit his side; Jacobs et al. fit Bogost's. THM-02 and THM-11 take both: the system argues, the player may read otherwise, and the fiction answers by its own logic.
- **The best-known foreshadowing rule is not universal.** F-10 above, and PAY-11, which turns the rule into a budgeted ledger with room for texture.

## 3. Sources

### 3.1 Read

| Source | How far | Used for |
|---|---|---|
| Bae and Young 2014, "A Computational Model of Narrative Generation for Surprise Arousal", *IEEE Transactions on Computational Intelligence and AI in Games* 6(2) | *Full text* (PDF converted locally) | The three discourse structures of structural-affect theory, separable causal chains, the evaluation (54 participants), the finding on the hint sentence; the account of MINSTREL's use of foreshadowing |
| Mawhorter, Mateas, Wardrip-Fruin and Jhala 2014, "Towards a Theory of Choice Poetics", FDG 2014 | *Full text* | Choice idioms (false, blind, dilemma, flavour, delayed effect, unchoice) and what each can say |
| Weiland, "The flat character arc" (helpingwritersbecomeauthors.com) | *Page*, first 100,000 of 110,000 characters | The flat arc, the testing arc, the contrast with the positive arc |
| Jacobs, Werning, Jansz and Kneer 2021, *Journal of Media Psychology* 33(2) | *Page* (abstract and design) | Procedural rhetoric strength and persuasion (241 participants) |
| Formosa, Ryan and Staines 2016, *Ethics and Information Technology* 18(3) | *Page* (abstract) | Papers, Please as a systemic approach to moral engagement |
| Repository: S0, S2, the foundation, the map, L12 and L2 (read in part), dossiers 1 to 9, `knowledge/open-world-activities.md`, `knowledge/main-story-state.md`, `knowledge/npc-reactions.md` | Read | Contracts and prior principles |

### 3.2 Summary, abstract or memory only

| Source | Status | What I relied on |
|---|---|---|
| Roberts, Walton and Viechtbauer 2006, *Psychological Bulletin* 132(1) | Summary | 92 longitudinal samples; mean-level trait change mostly in young adulthood; longer studies show more change |
| Haehner, Krämer, Wright and Bleidorn 2025 | Summary | Pooled panel studies (N about 196,000): life-event effects on traits small, average about 0.05; new employment raised conscientiousness and emotional stability |
| Roberts, Wood and Smith 2005 (social investment) | Memory and secondary accounts | Commitment to adult roles as a driver of trait change |
| Mischel and Shoda 1995, *Psychological Review* | Summary | If-then patterns of behaviour across situations |
| Welsh et al. 2015, *Journal of Applied Psychology* 100 | Summary | Gradually rising chances to cheat led to about twice the cheating (one experiment, 73 students) |
| Garrett et al. 2016, *Nature Neuroscience* 19 | Summary | Amygdala adaptation to repeated self-serving dishonesty predicted escalation (dishonesty only) |
| Skowronski and Carlston 1987; Mende-Siedlecki, Baron and Todorov 2013 | Summary | Diagnosticity of negative moral acts and positive competence acts; the frequency account |
| Forster 1927, *Aspects of the Novel* | Summary (several quoting pages) | Flat and round characters; the test of convincing surprise |
| McAdams and colleagues on narrative identity; Adler et al. 2015 | Summary | Redemptive and contaminated life stories and later wellbeing (89 participants over four years) |
| Trabasso and Sperry 1985; Trabasso and van den Broek 1985 | Summary (title and journal not confirmed by the search) | Causally connected story events rated more important and better recalled |
| Graesser, Singer and Trabasso 1994, *Psychological Review* 101(3) | Abstract | Readers search for meaning: a representation that explains why events occur |
| Brewer and Lichtenstein 1982, *Journal of Pragmatics* 6 | Summary, and Bae and Young's full-text account | Suspense, surprise and curiosity as effects of discourse order. The technical report returned 403 |
| Gerrig 1989, *Journal of Memory and Language* 28(6) | Abstract | Suspense about outcomes the reader knows |
| Leavitt and Christenfeld 2011; Johnson and Rosenbaum 2015 | Summary | Spoiler effects, mixed |
| Fischhoff 1975; Roese and Vohs 2012 | Summary | Hindsight bias in three levels |
| Gentner, Rattermann and Forbus 1993, *Cognitive Psychology* 25 | Abstract | Retrieval follows surface similarity; judged soundness follows relational structure |
| Hartmann, Toz and Brandon 2010, *Media Psychology* 13 | Abstract | Guilt over virtual violence depends on justification and trait empathy (49 and 80 participants) |
| Bogost 2007; Sicart 2011, "Against Procedurality"; Hocking 2007; Anderson's UCSC thesis | Summary (the Game Studies page refused the connection) | Procedural rhetoric, its critique, the BioShock reading, player interpretations |
| Turner's MINSTREL (Planning Advice Themes, transform-recall-adapt methods) and Bringsjord and Ferrucci's BRUTUS | Summary | Theme as a generation constraint in two older systems |
| Egri 1946 and Truby 2007 | Memory and book descriptions | Premise as a thesis; moral argument and opposing values |
| Aristotle, *Poetics* ch. 15 | Memory | The unravelling should arise from the plot |
| Dishonored's chaos system: Rolling Stone and others | Summary | Design intent and critique |
| Dwarf Fortress stress and personality | Summary of wiki and forum posts | Personality shifts are rare and slow; stress spirals |

### 3.3 Lens claims checked

| Lens claim | What I found |
|---|---|
| L12 F14 #1: events preceded by at least one earlier trace are rated more "caused" than the same events with none | **No study found.** The nearest evidence is that causally connected events are rated more important and remembered better (Trabasso and colleagues, summary) and that readers search for explanations (Graesser et al., abstract). The one generated-narrative test (Bae and Young) did not measure causedness and found the hint line lowered coherence. Graded `[hypothesis]`, with the hint finding as a warning (PAY-01, PAY-08) |
| L12 F14 #2: foreshadowing that makes the outcome obvious cuts surprise but not satisfaction | **Contested.** Spoiler studies disagree (F-11). Gerrig's anomalous suspense shows suspense can survive known outcomes. PAY-09 keeps the path uncertain and does not rely on concealment |
| L12 F14 #3: unpaid plants lower trust in later ones | **No study found.** D7's DIR-47 already notes the nearest false-alarm evidence is mixed. Kept as `[hypothesis]` with a measure (M10-11) |
| L12 F7 #1: a changed choice under pressure convinces more than a stat or narration | **No rating study found.** The claim is the craft's own (McKee, Aristotle, from memory). Graded `[analysis]` for the rule, `[hypothesis]` for the rating (CHG-10) |
| L12 F7 #3: negative arcs need three observable steps | **No study.** Lab work supports gradual escalation in people (Welsh, Garrett) and impression research says one lapse can revise an observer's view at once (Skowronski). The number is a `[J]` (CHG-08, 09) |
| L12 F8 #1: a cost structure recurring across three offers is named as the theme more often than independent costs | **No study found, and the number is weak.** At a 30 per cent chance background, three matching offers occur in a row 2.7 per cent of the time by chance, and an audit needs 10 to 40 offers (THM-07, §5.2). Anderson's results warn that players' readings may differ anyway |
| L12 F8 #3: choices that carry no cost carry no theme | **Partly supported.** Dilemmas need valued outcomes (Mawhorter et al., full text); guilt tracks justification as well as harm (Hartmann et al., abstract). Kept (THM-05) |
| L12 F10 and the map's NAR-30 row: no generator implements a checkable theme | **Narrowed.** MINSTREL's planning advice themes and BRUTUS's formal definition of betrayal are older generators that made a theme the engine of generation (summaries). Neither checks a *set* of stories against a premise with a stance quota, which is still the lens's new idea. I add them as comparisons (MM-4) |
| L12 F10 #2: motifs reintroduced with a change are noticed more | **No study of motifs.** The nearest evidence is Gentner et al.: reminding is driven by surface similarity, soundness by structure. That gives a design rule (THM-09) and not a finding |
| L12 F10 #3: a premise stated more than once per story reads as preachy | **No source found.** Kept as a lint with a test (THM-13) |
| Map NAR-09: "Hocking 2007" and "Jenkins 2004" as sources | Hocking's post was unreachable and read through secondary accounts. Jenkins was not opened |

## 4. Principles

Grades: **[empirical]**, **[practice]**, **[shipped]**, **[corpus]**, **[analysis]**, **[hypothesis]**; **contested** where sources disagree. Scales are glance (G0), encounter and vignette (E), gig (G) and arc (A), with season (S) where it applies, as in [dossier 8](d08-scale-threads-time.md). "Operationalise" says whether a procedure could **produce** the property, **check** it, or neither, and points at the layer and, where one applies, the kernel ([S0](../spec/kernel.md)) or seed-language ([S2](../spec/seeding.md)) section. Comparisons with the engine's own concepts are comparisons only ([D-21](../decisions.md)).

### A. How an NPC changes (NAR-28)

**CHG-01. An arc is a label on a recorded run of changes. The engine recognises arcs after the fact and never generates one from a template.** `[analysis]`
- *Source:* [QST-39](d04-quest-structure.md) (arc catalogues as recognisers and checklists, not generators); Weiland's three arcs are patterns in one character's relation to one belief, read off finished stories (*page*); S2 §2.13 (a thread is a view, not a type); F-01.
- *Instance:* A ripperdoc holds her line through three gigs while two people around her shift. A reader calls hers a flat arc. Nothing in the engine said "flat" in advance.
- *Scales:* A, S. *Layers:* 1, 3, E.
- *Operationalise:* **Check, not produce.** A recogniser over `turning` events (CHG-06) and the exposure ledger labels each NPC's run `revision`, `refusal`, `corruption`, `revelation` or `none`, for evaluation and for sifting ([TEL-02](d06-sifting-tellability.md)). It never decides what happens next.

**CHG-02. Keep two meanings of "flat" apart. A flat character is built round one idea. A flat arc is a character who holds a conviction under pressure and changes others. Most NPCs should run the second by default.** `[analysis]`
- *Source:* Forster 1927 (*summary*: round characters can surprise convincingly; flat ones are organised round a single idea and are not lesser); Weiland (*page*: the flat-arc protagonist already holds the truth, keeps it under heavy opposition, may grow outwardly in skill or role, and changes the world around him); L12 F7 (generative narrative tends to default to transformation); [BND-30](d02-relationships.md) (ties among NPCs are story material).
- *Instance:* A fixer who will not take a job that targets a clinic stays that way for the whole run. The people around her take sides, move away or change.
- *Scales:* A, S. *Layers:* 1, 3, E.
- *Operationalise:* **Produce (S1).** Every NPC has a `stability` class of three coarse levels ([FIT-35](d03-fitting-casting.md)), drawn from its persistent id at sowing, with most NPCs high. A flat arc is measured by **influence**: the count of other NPCs' turning events whose cause chain includes this NPC's acts. It is not measured by the absence of events. **Check:** M10-03.

**CHG-03. Real change in temperament is slow and small. Story-visible change lives in concerns, beliefs, memberships and ties. Give each its own rate, and let a role change be the default cause.** `[empirical]` for the slowness; `[hypothesis]` for the mapping
- *Source:* Roberts, Walton and Viechtbauer 2006 (*summary*: 92 samples, most mean-level change in young adulthood); Haehner et al. 2025 (*summary*: pooled panels, life events moved traits by about 0.05 standardised units on average, with new employment raising conscientiousness and emotional stability); the social investment idea (*memory*, secondary accounts: commitment to adult roles drives change); [DRV-06](d01-motivation-drives.md) (importance is a slow variable); S0 §12 (a member's frames inherit a group's concerns at once).
- *Instance:* A courier joins a crew. What he wants, who he answers to and what he would react to shift on the day, through inherited concerns. His temperament barely moves in a season.
- *Scales:* G to S. *Layers:* 1.
- *Operationalise:* **Produce (S1).** Drive importance (a drive-level turn, [UNT-03](d08-scale-threads-time.md)) moves in small bounded steps and only on a few event kinds, role transitions first. Concerns, beliefs and memberships (concern-level turns) change on events and take effect at once through inheritance. A membership change is the default cause of a visible turn. **Check:** M10-03.

**CHG-04. Identify a character by its if-then pattern across situations. Change is a change in that pattern.** `[empirical]` for the framework (summary); `[hypothesis]` for the mapping
- *Source:* Mischel and Shoda 1995 (*summary*: stable patterns of variation across situations explain how behaviour varies while persons stay consistent); [DRV-08](d01-motivation-drives.md) (traits tune gains; values and role decide content); Forster's test (a surprise must convince against a pattern the audience has learned).
- *Instance:* A fixer is generous to people in her debt and curt with strangers. "Generous" alone is a poor description. The pattern is the character.
- *Scales:* G, A. *Layers:* 1, 3.
- *Operationalise:* **Produce.** An NPC's dispositions are stored as context-relative frame weights and a fragment repertoire ([S2 §2.4](../spec/seeding.md#24-roles)), keyed by situation class, not as a global trait. **Check:** a response outside the prior pattern is a surprise, and the turn scene must cite pressure that explains it (CHG-05). Otherwise it reads as a flat character pretending to be round (Forster). M10-06 tracks consistency across matched situations.

**CHG-05. No change without pressure. A turn cites at least one recorded event or dilemma that bears on the held view or on the competing concerns.** `[analysis]`
- *Source:* McKee and Weiland on a held belief meeting pressure (*page* for Weiland); L12 F7; S0 §10.8 (the kernel already emits `Dilemma { actor, frameA, frameB, severity = pull(A) × pull(B) }` when an actor's frames from different origins conflict); S0 §13 (every record has a `cause`); [DS-24](../design-seeds.md).
- *Instance:* A lieutenant's gang orders him to give up a cousin. His frame for the gang and his frame for kin conflict at a severity of 0.5. What he does next, and which frame yields, is the turn.
- *Scales:* G, A. *Layers:* 1.
- *Operationalise:* **Produce (S1).** Pressure takes two forms: independent events that contradict a held view, and unresolved dilemmas, whose severity is the pressure weight. **Check:** every `turning` event cites at least one (M10-01); a turn with none is a defect.

**CHG-06. Model the character's "lie" as an ordinary belief held with more confidence than its evidence supports, and a change as that belief's revision, or its refusal.** `[hypothesis]`
- *Source:* Weiland (*summary*, a reader's notes and the table of contents: the character believes a lie, shaped by a past event; the need is its antidote; the want is the outer goal); S0 §11.1 and §11.2 (a belief has `confidence` and `evidence`; one belief per question; S1's policy decides replacement; only independent evidence corroborates). The ghost-causes-lie story is a craft convention (§2.3).
- *Instance:* A lieutenant believes loyalty is repaid. The record says otherwise: two promises broken in front of him.
- *Scales:* G, A. *Layers:* 1, 2.
- *Operationalise:* **Produce.** S1 holds the NPC's view as a `Belief`; its subject may be the NPC itself, a group or V. The engine needs no notion of "truth": its revision policy reads only evidence and stability. A `turning` event (a pack event kind like `offer`, S2 §0.4) records old value, new value and causes. Authors of a named NPC declare the held view and its stability (S10-S2-15). **Check:** the arc recogniser (CHG-01).

**CHG-07. Revision follows independent evidence, and a stable NPC discounts it. Keep few NPCs in motion.** `[hypothesis]`; the numbers are `[sim]` from assumed inputs
- *Source:* S0 I-9 and §11.2 (only independent evidence corroborates; a rumour does not corroborate itself); the toy in §5.1: stability drawn from a Beta distribution with mean 0.73, a threshold of 3 × (0.5 + s) weight units and event weights of 0.5, 1 or 1.5. The share who turn is 0.00 after one event, 0.02 after two, 0.23 after three, 0.62 after four and 0.90 after five. Every input is assumed.
- *Instance:* A stable bouncer is pressed once by a bribe and does not turn. After the fourth distinct pressure (a bribe, a threat to a sister, a rival's offer, an order he will not follow) he may.
- *Scales:* A. *Layers:* 1, 3.
- *Operationalise:* **Produce (S1).** Per-NPC threshold from stability. Arcs then gather where one thread touches the same NPC several times (an arc-scale seed), and not across the city. Cap the NPCs with a pending turn in V's attended set at about three **[J: the order of THR-02's three visible threads]**. **Check:** M10-03. This is the guard against "everyone arcs" (P-2).

**CHG-08. Negative change is gradual. Escalation comes in steps, each easier because of the last, and the number of observable steps is set by the largest step allowed.** `[empirical]` for dishonesty in the laboratory; the extension is `[hypothesis]`
- *Source:* Welsh et al. 2015 (*summary*: in one experiment, 73 students, a gradually rising run of chances to cheat led to cheating at about twice the rate of the other conditions); Garrett et al. 2016 (*summary*: the amygdala response to repeated self-serving dishonesty adapted, and the size of the adaptation predicted the next escalation; dishonesty only, and extension to other acts is speculation); L12 F7 (three observable steps: no study).
- *Instance:* A lieutenant skims, then covers for a skim, then sells an informant. Each is a full scene with its own cost.
- *Scales:* A. *Layers:* 1, 3.
- *Operationalise:* **Produce (S1).** Each accepted transgression lowers the cost of the next by a gain `g` **[J]**. Cap the size of any one step at no more than a third of the total change **[J]**, so a change of that size takes at least three steps. The toy in §5.1: asks of 1.0, 1.5 and on to 4.0, a willingness starting at 1.5 and multiplied by `g` after each ask taken. Below `g` of about 1.2 the NPC never reaches size 4. At 1.2 and above it takes seven steps, while a cold size-4 ask is refused. **Check:** M10-04.

**CHG-09. One act can reveal. It takes a run of acts to change. The engine knows which it is; V can tell only by earlier signs.** `[empirical]` for the asymmetry (*summary*), **contested** at the edges; `[hypothesis]` for the use
- *Source:* Skowronski and Carlston 1987 (*summary*: negative acts weigh more for judgements of morality, positive acts for judgements of competence); a 2000 study found the effect only when the information was morally inconsistent; Mende-Siedlecki et al. 2013 (*summary*: the asymmetry follows how often each kind of act is expected); Forster.
- *Instance:* A trusted ripperdoc sells V's name. If the record shows she had skimmed before and V had seen the signs, it reads as revealed. If not, it reads as a swing.
- *Scales:* G, A. *Layers:* 1, 3.
- *Operationalise:* **Check and produce.** A `turning` event is `revelation` if the new stance was already a recorded, unexposed disposition, and `change` if the pattern shifted. For a revelation, the planner must have laid at least one found trace of the hidden stance beforehand (PAY-04; [QST-36](d04-quest-structure.md) on reveals from the record). A revelation with no earlier trace is a retrofit risk and is reported (M10-12).

**CHG-10. Show a change as a changed choice under pressure. Do not announce it, and do not show it as a number.** `[analysis]` for the rule; `[hypothesis]` for the rating
- *Source:* McKee and Aristotle on character shown by choice under pressure (*memory*); L12 F7 (no rating study found); [BND-10 and BND-12](d02-relationships.md) (a visible number turns closeness into a purchase; every change cites an act V can name); [AGY-35](d09-agency-consequence.md) (name the act, not the reason).
- *Instance:* The ripperdoc who once patched anyone now asks V who the buyer is before she starts. That scene is the change.
- *Scales:* G, A. *Layers:* 2, 3, X.
- *Operationalise:* **Produce.** The turn scene is the beat where the NPC's response to a matching situation differs from its own earlier recorded response. Its text is templated from the two act records (verb, object, place). **Check:** no meter (S2 L-22 spirit); the scene cites the earlier act (M10-02).

**CHG-11. A change needs a witnessed before. Stage it as a difference between two sightings, or tell the before.** `[hypothesis]`
- *Source:* Forster (surprise must convince against a learned pattern); [UNT-06](d08-scale-threads-time.md) (a second sighting after a gap shows more change, by an amount the record fixes); [TIM-04](d08-scale-threads-time.md) (one cue per dimension that changed); [AGY-32](d09-agency-consequence.md) (the exposure ledger).
- *Instance:* V buys from a dealer twice, a week apart. The second time the stall is shut and her sister is running it.
- *Scales:* G, A. *Layers:* 2, 3, X.
- *Operationalise:* **Produce and check.** A turn scene `needs` an exposed earlier act or trace of the old stance (S2 §10.2). Without it, a **told** alternate plays: a bystander or the NPC says what used to be. A change settled off-screen is delivered at the next sighting as a glance with one cue per changed dimension. **Check:** every staged turn has a witnessed or a told form (M10-02).

**CHG-12. Off-screen change settles at joints and shows at the strength V's presence earns. It ends with a recorded turn, or fades by stepping down. It is never forced to a resolution.** `[practice]` for settlement; `[hypothesis]` for the rest
- *Source:* [AGY-25 and R5-09](d09-agency-consequence.md) (lazy settlement at joints); [THR-12 and GRW-08](d08-scale-threads-time.md) (retire in steps; growth reverses); L12 F7 (arcs resolved while the player is absent: a named failure).
- *Instance:* An NPC V stopped meeting turned over months. When V comes back, one shop sign and a changed greeting carry it.
- *Scales:* A, S. *Layers:* 1, 3.
- *Operationalise:* **Produce.** A turn settled while V was absent becomes news ([AGY-41](d09-agency-consequence.md)) or a sighting (CHG-11), with `witnessed` false on the closure record (S2 §6.4). A thread V no longer attends steps down with a closing trace and keeps its pins. **Check:** no turn first appears mid-scene unless the scene caused it.

**CHG-13. An NPC's account of their own change is a belief. It may differ from the record, and the gap is material.** `[empirical]` for narrative identity (*summary*); `[hypothesis]` for the use
- *Source:* McAdams's work on redemptive and contaminated life stories, and Adler et al. 2015 (*summary*: 89 participants followed for four years; redemption and agency in life stories predicted later mental health; some samples show no such link); foundation §5.4 and [D-10](../decisions.md); [DRV-47 and DRV-48](d01-motivation-drives.md) (explanation by reasons; the dispositional lean).
- *Instance:* A lieutenant says he never had a choice. The record shows two offers he refused.
- *Scales:* G, A. *Layers:* 1, 3, X.
- *Operationalise:* **Produce.** Told-story fragments (dossier 21) read the NPC's own beliefs, not the record. **Check:** where the account contradicts an act the speaker witnessed and holds, it is a marked excuse or a defect. The account is never the engine's statement.

**CHG-14. Every change must have a reader. A turn nothing reads is wasted, and a turn something reads must be able to show it.** `[practice]`; one reported failure
- *Source:* F-02 (the memory layer that the rest of the content did not read, *lens*); [QST-09](d04-quest-structure.md); S2 L-05 (a route variable with no consumer is an error).
- *Instance:* A lieutenant's new grievance changes which gigs the fixer offers V, what the dealer quotes and what a bystander says.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Check and produce.** Each `turning` kind declares its consumers (a response template, an offer condition, a tie rung, a price). A lint rejects a kind with none (S10-S2-18). Unread turns are logged as loose ends (S2 §6.4) and may seed new seeds ([GRW-07](d08-scale-threads-time.md)). **Check:** M10-05.

**CHG-15. Change must not make characters alike. Watch the distance between NPCs' patterns over a season.** `[hypothesis]`, from one reported failure
- *Source:* F-03 (*lens*); Forster (flat characters stay distinct by their one idea).
- *Instance:* After a season of events, a district's fixers all speak of "doing what is best for everyone".
- *Scales:* S. *Layers:* 1, E.
- *Operationalise:* **Check, and constrain S1.** Drift moves an NPC toward its group and role, never toward V or the population mean. M10-06: the pairwise distance between NPCs' signatures does not shrink over a season.

### B. V: observed, never owned (NAR-28, with D-09 and I-12)

**VOB-01. V's change is what V's acts leave in the record and how the city's beliefs about V move. The engine describes no inner life of V, so it writes no arc for V.** `[analysis]` under D-09 and S0 I-12
- *Source:* [D-09](../decisions.md); foundation §5.3; [DRV-49 and DRV-53](d01-motivation-drives.md) (the model of V is a belief; street cred is the city's beliefs about V); [AGY-35 and AGY-44](d09-agency-consequence.md); `knowledge/open-world-activities.md` (the game stores no trust or standing with a fixer; what a fixer "knows" is a district counter, tier facts and the street-cred stat).
- *Instance:* "Three jobs for the Claws, and the stalls on this street now charge V less." The record states acts and effects. It does not say what V is.
- *Scales:* A, S. *Layers:* 1, 2, 3.
- *Operationalise:* **Check.** `turns` may read beliefs NPCs hold about V and V's acts. No atom reads a state of V (S10-S2-06, 07). Lint L-20 stands. The base game gives the engine only a crude baseline here, so NPC beliefs about V are where the engine adds something.

**VOB-02. Reflect V's acts in how the world behaves. Say it in words only as a witness's observation after a run of acts.** `[hypothesis]`
- *Source:* [AGY-44](d09-agency-consequence.md) (a pattern line needs at least three recorded acts, stated by a witness); [AGY-42](d09-agency-consequence.md) (consequences are named, adaptations stay silent); Dishonored's chaos tally changed the world (guard density, infestations, tone) rather than naming the player, and drew the criticism that one axis sorted play into two types (F-08, *summary*).
- *Instance:* A stallholder pulls her shutter down when V walks past, after three incidents on that street.
- *Scales:* A, S. *Layers:* 2, 3, X.
- *Operationalise:* **Produce.** Reflection goes through non-verbal channels first: who approaches, what things cost, how close people stand. **Check:** reflection has several dimensions (named act classes, each its own response), never a single good-evil axis, and no visible meter.

**VOB-03. Let the city's belief about V move asymmetrically by domain, scale the asymmetry to how common the act is in the district, and let it move back when V changes course.** `[empirical]` for the asymmetry (*summary*), **contested**; `[hypothesis]` for the policy
- *Source:* Skowronski and Carlston 1987 (morality: negative acts weigh more; competence: positive); Mende-Siedlecki et al. 2013 (*summary*: expectation of how often each kind of act occurs explains the asymmetry), so where violence is common a violent act is less diagnostic of moral character; [BND-25](d02-relationships.md) (reconnection is welcomed); S0 §11.2 (new independent evidence revises a belief).
- *Instance:* One betrayal of a client dents a courier's standing among fixers for a long time. Ten cheerful brawls in Kabuki dent it hardly at all.
- *Scales:* A, S. *Layers:* 1.
- *Operationalise:* **Produce (S1 `aggregate()`).** Per-domain weights (morality, competence), scaled by the district's base rate for the act kind. A V who changes course is eventually seen to have: independent new evidence revises the belief. **Check:** fixtures; M10-07. Calibrate **[J]**.

**VOB-04. Treat expressive choices as acts V made. They shape how V is read. They never reveal why.** `[analysis]`
- *Source:* Mawhorter et al. 2014 (*full text*: flavour choices can disproportionately shape a player's sense of in-game identity because they are made for personal reasons); [DRV-48](d01-motivation-drives.md) (observers lean towards dispositional explanations).
- *Instance:* V's clothes, car and manner of greeting. Fixers react to what they see, not to intent.
- *Scales:* E to A. *Layers:* 1, 3.
- *Operationalise:* **Produce.** Record style as `observed` acts of a style class. An NPC's reading of it is the NPC's belief. **Check:** lint L-20.

**VOB-05. Do not engineer a slide. Escalating asks must come from the asker's own frame, each step must stand as a full offer with a decline path, and the director never orders offers to walk V down a slope.** `[empirical]` that slopes work on people; the rule is `[hypothesis]`
- *Source:* Welsh et al. 2015 and Garrett et al. 2016 (CHG-08); [DIR-07](d07-direction-pacing.md) (the director's objective never includes return rate or session length); [FIT-49](d03-fitting-casting.md); Formosa, Ryan and Staines 2016 (*page*: Papers, Please draws its ethics from systems, with pay, penalties and time pressure doing the work); essays on it say the game asks the player to become efficient, not cruel (*summary*).
- *Instance:* A client's second ask is larger because the first succeeded, and V can see why.
- *Scales:* A. *Layers:* 3.
- *Operationalise:* **Check.** An escalation detector over consecutive offers from one thread to V: if the ask's size rises each time, the cause chain must show a world-side reason (the asker's frame changed). A director-ordered rise is refused. M10-16. A theme of complicity by increments remains available through the world's own escalation.

### C. Theme carried by systems (NAR-09, NAR-30)

**THM-01. A theme is an argument the system offers. It travels in four things: which options are offered, what each costs, who bears the cost, and how the consequence shows later. It is never a sentence the system says.** `[analysis]`
- *Source:* Bogost 2007 (*summary*: rules can make arguments); Mawhorter et al. 2014 (*full text*: a false choice can suggest a protagonist's lack of control, a blind choice disorientation, and a delayed effect "what is important"); Formosa, Ryan and Staines 2016 (*page*: systemic against scripted moral engagement); Mawhorter et al. 2018 applies the framework to Papers, Please (*listing only*).
- *Instance:* In a border-control game every approval is paid and every careful check costs time. The cost structure says that efficiency is the moral cost.
- *Scales:* G, A, S. *Layers:* 2, 3, E.
- *Operationalise:* **Produce and check.** The offer anatomy of S2 §2.9 carries stances, stakes and writes; add per-action costs (S10-S2-03). The audit (THM-03) reads them back.

**THM-02. Players read a system's argument their own way, and what the mechanics reward steers choice more than stated preference. Assume varied readings and audit the rewards.** `[empirical]`, small
- *Source:* Anderson's thesis (*summary*: players saw an argument, but interpretations and attitude change did not always match the intent; choices followed what the mechanics rewarded; attitude effects appeared only where the narrative framing matched the real context); Jacobs et al. 2021 (*page*: 241 participants; stronger procedural rhetoric increased persuasion; high cognitive load did not change processing); Sicart 2011 (*summary*: rules frame play and meaning arises in the playing).
- *Instance:* A player in a "no one is disposable" district takes the efficient route every time because it pays. The player did not endorse the efficiency.
- *Scales:* all. *Layers:* E.
- *Operationalise:* **Neither produces nor checks the engine's output.** It is a rule for evaluation (ask what players took away, M10-09) and a reason to audit rewards (THM-10).

**THM-03. The argument a system actually makes is the pattern in its payoffs. Measure it from the record: for each stance, what it gained, what it cost, who paid, when, and whether V saw it.** `[hypothesis]`, built on `[analysis]`
- *Source:* Hocking's reading of BioShock (*summary*, F-06); L2 F18 (a table of mechanic, implied value and stated value); S2 §2.9 (offers carry stances, stakes and writes) and §10 (the record and the exposure ledger).
- *Instance:* Across 30 offers in one district, the cheapest stance wins on immediate gain 80 per cent of the time and its cost lands later on a third party. That pattern is what the district argues, whatever its tags say.
- *Scales:* A, S. *Layers:* 3, E.
- *Operationalise:* **Produce (evaluation).** The **argument profile** of §5.2, computed per scope from the seed records and the exposure ledger. **Check:** a dominant stance regardless of premise is flagged; a gap between the declared signature and the realised table is a finding. M10-07.

**THM-04. Keep tone and theme apart. Tone is how a scene feels. Theme is what a set of scenes argues about a premise. A tag that says "supports" needs a premise to support.** `[analysis]`
- *Source:* [FIT-33 and FIT-34](d03-fitting-casting.md) (theme over a set; tone a small closed vocabulary); S2 §2.3, where `tone` carries `role: supports | opposes | complicates` and nothing says relative to what; Egri's premise as a thesis shown through behaviour (*book descriptions*); L12 F10.
- *Instance:* "Guarded" is a tone. "Convenience eats consent: opposes" is a stance on a premise.
- *Scales:* all. *Layers:* 2, 4.
- *Operationalise:* **Produce.** A separate `argues` field and a `Premise` object (S10-S2-01, 02). The `tone` field keeps its vocabulary and loses its role.

**THM-05. A choice with no cost carries no theme. Give at least two options costs of different kinds.** `[hypothesis]`, with partial `[empirical]` support
- *Source:* L12 F8 #3; Mawhorter et al. 2014 (*full text*: a dilemma sets two highly valued or highly reviled outcomes against each other, and is false if the outcomes are unequal in value or the same); Hartmann, Toz and Brandon 2010 (*abstract*: guilt over virtual violence depended on whether it was justified and on trait empathy, so cost is felt through justification as well as size).
- *Instance:* In a gig, the clean route costs time and the loud one costs a bystander's standing.
- *Scales:* G. *Layers:* 2, 4.
- *Operationalise:* **Check.** A lint: a consequential offer whose actions declare identical or no costs gets a warning (S10-S2-04). Costs of one class on every option make a weak dilemma.

**THM-06. Show cost through traces and through who pays, not through labels or meters.** `[practice]` for the principle; `[hypothesis]` for the comparison
- *Source:* L12 F8 #2 (immediate "morality" labels read as less thematic; no study); F-08; [BND-10 and BND-12](d02-relationships.md); [AGY-37](d09-agency-consequence.md) (show first; name once).
- *Instance:* The quiet route leaves a drained account for a neighbour. The loud route leaves a shuttered stall and a rumour. Neither shows a number.
- *Scales:* G, A. *Layers:* 2, 3, X.
- *Operationalise:* **Produce.** A cost with `when: 'later'` is shown through an aftermath beat with a signpost (S2 §2.8). **Check:** no cost class feeds a visible number, and the aftermath beat exists (S10-S2-04).

**THM-07. A theme needs recurrence of one cost structure. Within a thread, recurrence is a rhetorical device. Across a district, it is evidence for an audit, and the audit needs many offers, not three.** `[hypothesis]`; the numbers are `[sim]`
- *Source:* L12 F8 #1 (three recurrences; untested). The toy in §5.2: if a signature holds in 60 per cent of offers against a 30 per cent chance background, a one-sided binomial test at the 5 per cent level with power 0.8 needs 17 offers (9 or more matching). For 70 against 30 it needs 10, and for 60 against 40 it needs 42. Three matching offers in a row occur by chance 2.7 per cent of the time at a 30 per cent background and 6.4 per cent at 40.
- *Instance:* A premise declares that the cheapest option's cost lands on a third party in at least 60 per cent of a district's offers.
- *Scales:* G (device), A and S (evidence). *Layers:* 3, E.
- *Operationalise:* **Produce and check.** Sowing holds the signature at a declared share across the scope. The audit reports "insufficient" below a minimum sample (S10-P5-02). A within-thread recurrence of three is allowed as craft and never counted as evidence.

**THM-08. Vary the surface and hold the structure. Recurrence with the same people, places and verbs reads as repetition. Recurrence with new carriers reads as a pattern.** `[hypothesis]`
- *Source:* [QST-06](d04-quest-structure.md) (variation must change the verb, stake, relationship or outcome); [dossier 5](d05-units-variety.md) (separation rules); Gentner, Rattermann and Forbus 1993 (*abstract*: reminding follows surface similarity, judged soundness follows shared relational structure), so a pattern carried by structure alone is real and easy to miss.
- *Instance:* A consent-eroding bargain appears as a lease, a loan, a medical plan and a security subscription.
- *Scales:* A, S. *Layers:* 3.
- *Operationalise:* **Produce.** Hold stance classes, cost classes, bearers and timing equal across the recurrence while S5's separation rules force the surface slots ([SL-6](d05-units-variety.md) skeleton features) to differ. **Check:** structure equal, surface different.

**THM-09. An echo between two specific scenes needs a shared surface carrier (an object, place or phrase) and a shared structural role, changed. Surface alone is retrieved and then judged unsound.** `[empirical]` for retrieval against soundness (*abstract*); `[hypothesis]` for the echo
- *Source:* Gentner et al. 1993; L12 F10 #2 (motifs reintroduced with a change: untested); [TEL-07](d06-sifting-tellability.md) (a callback at a distance needs a cue).
- *Instance:* The same cracked bowl sits in a stall that now answers to another gang, and the same bargain is put to a different person.
- *Scales:* A. *Layers:* 3.
- *Operationalise:* **Produce.** The callback finder retrieves candidate pairs by carrier and then filters on matching stance structure and a recorded change (S10-P5-06). **Check:** the echo-noticing arm of M10-09, as a test agenda.

**THM-10. What the mechanics reward must not contradict what the fiction says. Audit reward tables and route payoffs against the premises. Where dissonance is intended, say so.** `[analysis]`, **contested** in use
- *Source:* Hocking 2007; L2 F18; [QST-13](d04-quest-structure.md) (pay is a policy of district and route, kept apart from structure); `knowledge/open-world-activities.md` (a completion record holds eddies, level experience and street-cred experience).
- *Instance:* If a district argues that the city devours the careful, a pay table that always pays the loud route more says the opposite.
- *Scales:* G to S. *Layers:* 2, 3, E.
- *Operationalise:* **Check.** A table of mechanic, implied value and stated value is computed from reward policies and route facts (S10-P5-04). A mismatch needs an `intended` annotation on the premise, which signals dissonance made on purpose. M10-08.

**THM-11. Let the fiction argue back. The engine never punishes a reading of the theme.** `[analysis]` under D-09 and bar 4
- *Source:* Sicart 2011 (*summary*); Mawhorter et al. 2014 (*full text*, critical play: a player may play against the design); [AGY-26 to AGY-28](d09-agency-consequence.md) (declining has consequences, never punishment).
- *Instance:* V takes the cruel route in a "no one is disposable" district. The people there respond from their own frames. No penalty meter appears.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Check.** No premise-driven effect lands on V's resources or access outside the stakes V accepted (S2 L-15). The audit counts counter-premise acts as data.

**THM-12. Balance the stances. Over a district and a season, a premise needs supporting, opposing and complicating arguments, or it is propaganda.** `[hypothesis]`
- *Source:* L12 F10 #1 (balanced tags not rated less varied; untested); Truby's opposing-values opponent as a counterweight (*summary*; a trade review called his terms nearly indistinguishable).
- *Instance:* A district about "convenience eats consent" also holds a story where the convenient option turns out to be free of cost, and one where it is honestly mixed.
- *Scales:* S. *Layers:* 3, E.
- *Operationalise:* **Produce, weakly.** The stance quota of S10-P5-03 is a tie-breaker among seeds that already fit. **Check:** quota bounds on the premise (S10-S2-02). Seeds with no `argues` are texture and are not counted.

**THM-13. Say the premise rarely, and never in the system's voice.** `[hypothesis]`
- *Source:* L12 F10 #3 (stated more than once per story reads as preachy; no source found); [FIT-34](d03-fitting-casting.md); [AGY-27](d09-agency-consequence.md) (no reproach); Mawhorter et al. 2014 (dilemmas make players think about outcomes rather than accept what the game tells them).
- *Instance:* A fixer may say "everything's a subscription now" once. The narration never says it.
- *Scales:* E, G. *Layers:* 2, X.
- *Operationalise:* **Check.** A lexicon lint (S4): the premise sentence rendered more than once per seed, or in a system voice, is a warning (S10-S2-22). NPCs may state views, including opposing ones. M10-10.

**THM-14. Check theme over a set, never inside one seed.** `[analysis]`
- *Source:* [FIT-33](d03-fitting-casting.md).
- *Instance:* A single gig may argue nothing and be fine. A district of fifty gigs argues something, and the audit sees it.
- *Scales:* A, S. *Layers:* 3, E.
- *Operationalise:* **Check.** The audit's scope is a district, region or season, declared on the premise. Per-seed checks are limited to carriers (S10-S2-05).

**THM-15. Carry theme by casting. Give people stances toward the premise, spread across a region.** `[analysis]`
- *Source:* Truby's opposing characters (*summary*); foundation §5.2 (cross-pressure is where many stories come from) and §5.4; [BND-30](d02-relationships.md). The central question of Planescape: Torment recurs through the game in secondary accounts, but I found no source tying its companions to different answers.
- *Instance:* A ripperdoc who holds the line, a fixer who profits, a dealer who doubts and a runner who resists.
- *Scales:* A, S. *Layers:* 3, 4.
- *Operationalise:* **Produce.** `Role.stance` (S10-S2-15), usable in `prefer`, so casting spreads stances. **Check:** a coverage count of stances among a district's recurring NPCs.

**THM-16. Premises are few, authored and city-wide. The engine selects among them. It does not invent them.** `[hypothesis]`
- *Source:* [D-02](../decisions.md) (authored content sits above procedural); Egri's single premise; Planescape's single question (secondary); S4's closed-vocabulary habit.
- *Instance:* "Convenience eats consent" is a premise. "Be kind" is not: nothing can violate it.
- *Scales:* S. *Layers:* 4, 3.
- *Operationalise:* **Produce.** Premises live in packs; the default is none; sowing never mints one. **Check:** premises in force per district stay at two or three **[J]**, and each has a signature that a record could violate (S10-S2-02).

### D. Setup and payoff (NAR-29)

**PAY-01. A generated event reads as caused when V can find a chain of causes behind it. Causal connection makes events matter and be remembered.** `[empirical]` (*summary*)
- *Source:* Trabasso and Sperry 1985 and Trabasso and van den Broek 1985 (*summary*: events with more causal connections are rated more important, recalled more and put into summaries more; events on the causal chain beat dead ends); Graesser, Singer and Trabasso 1994 (*abstract*: readers search for an explanation of why events occur); [TEL-10](d06-sifting-tellability.md) (the more extraordinary the offer, the more its causes must be visible); S0 §13.
- *Instance:* A depot fire, with a rival's threat on record, a changed guard rota and a broken sprinkler, reads as caused. The same fire from nowhere reads as the game.
- *Scales:* all. *Layers:* 1, 3, X.
- *Operationalise:* **Produce and check.** Every V-facing generated event cites its causes in the record. **Check:** from each such event, a chain of at least one recorded cause that V could be shown within two steps (M10-13). The lens's rating claim (F14 #1) remains untested.

**PAY-02. Three arrangements of cause and effect give three feelings. Show the cause and keep the outcome pending: suspense. Show the outcome with its causes visibly missing: curiosity. Show the outcome with its causes unnoticed as missing, then supply them: surprise that can be accounted for. Build all three from one record.** `[empirical]` for the distinctions (via the full text of Bae and Young); the engine mapping is `[analysis]`
- *Source:* Brewer and Lichtenstein 1982 as set out by Bae and Young 2014 (*full text*): in surprise and curiosity the outcome appears without its initiating events, and the difference is whether the reader is aware of the omission; surprise should be *postdictable*, meaning the explanation fits without conflict. The suspense arrangement is from the same theory, from memory. In Bae and Young's test the flashback form raised surprise over chronological order.
- *Instance:* A portent (a rumour of a rival's move) gives suspense. A shuttered stall with a note, and an `ask` handle, gives curiosity. A fire with a why-trace gives accounted surprise.
- *Scales:* G, A. *Layers:* 2, 3, X.
- *Operationalise:* **Produce.** Portents ([DIR-41, DIR-45](d07-direction-pacing.md)); glance fragments with an `ask` handle (S2 §2.14, L-38); the kernel's `explain` for the why-trace (S0 §13). **Check:** every V-facing generated event has at least the why-trace path (S10-P5-18).

**PAY-03. Plant situations, not outcomes. A planted trace must be true whether or not the event it points to fires.** `[hypothesis]`
- *Source:* [AGY-45](d09-agency-consequence.md) (sow situations, not plots); [DIR-47](d07-direction-pacing.md) (traces true to the record; an unpaid plant gets a closing trace); S2 L-32 (a glance's `needs` is a recorded fact or a labelled constructed cause).
- *Instance:* A maintenance notice about a failing main is true even if the main never bursts.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce and check.** A trace cites a fact or a past event. No trace cites a pending event. A lint rejects one that does (S10-S2-13). If the event does not fire, the plant is still honest, and a closing trace is optional.

**PAY-04. Three sources of a trace, in order of preference: found in the record; found, then chosen for display; constructed within the author's latitude and labelled.** `[hypothesis]`
- *Source:* [DS-24](../design-seeds.md) (the causes really exist; the director chooses the reveal and its timing); [DS-29](../design-seeds.md) and foundation C-01 (generate, then justify); S2 L-32. MINSTREL used foreshadowing to avoid a sense of contrivance for uncommon and important events (as Bae and Young describe it).
- *Instance:* A city's rising rents are in the record (found). The planner shows a landlord's letter among them (found, chosen). With no record, it constructs a plausible earlier complaint within latitude (constructed, labelled).
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce.** The plant planner (S10-P5-16) queries the thread's record first and constructs only when the found set is empty and `latitude` allows `trace-cause` (S10-S2-12). **Check:** the constructed share per thread stays low **[J: under a quarter]** (M10-12).

**PAY-05. A constructed cause must agree with every pin and with the exposure ledger, and it becomes a pin when first shown. V never sees the past contradict itself, and never has to have missed something V was placed to see.** `[analysis]`
- *Source:* S0 §4 and §6 (pins are hard constraints); S2 §2.14 (commit what a pattern used, so a match cannot change on reload); Aristotle (F-09); L12 F14 (retro-fitting the player can detect).
- *Instance:* A constructed "complaint from last month" cannot appear on a wall V walked past yesterday, because V's observed pins show the wall clear.
- *Scales:* G, A. *Layers:* 1, 2, 3.
- *Operationalise:* **Produce and check.** A constructed cause is a contribution that goes through constraint arbitration; on display S2 commits its fields (S10-S2-11); the service refuses when the cause is infeasible or contradicts V's presence history. **Check:** M10-12 contradictions are zero.

**PAY-06. Match the interval between plant and payoff to the unit's scale, and refresh a plant the player may have forgotten.** `[practice]`
- *Source:* [DIR-56](d07-direction-pacing.md) (lead time scales with the unit; refresh a trace); [AGY-34 and AGY-40](d09-agency-consequence.md) (a delay needs a cue that grows with elapsed time); [TEL-07](d06-sifting-tellability.md).
- *Instance:* A character plant for an arc is refreshed with a class-0 trace between sessions.
- *Scales:* G, A. *Layers:* 3.
- *Operationalise:* **Produce.** The payoff schedule reads the plant's last exposure time and V's activity since; if stale, a refresh trace is added (S10-P5-19). The numbers are dossier 7's.

**PAY-07. Two weights of trace. A portent announces and raises tension. A plant sits in the background and makes the later event recognisable. Choose by purpose.** `[analysis]`
- *Source:* [DIR-41, DIR-45](d07-direction-pacing.md) (announce a threat; stage imminence); [SL-11](d05-units-variety.md) (salience tiers: foreground, background, oddity); PAY-02.
- *Instance:* A portent: a crew leaves a district early. A plant: a courier's habit of carrying a sealed case, noted in passing.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce.** A `weight` on the promise entry (S10-S2-10). Portents count toward dossier 7's tension and push limits where they push. Plants are class 0 and cost no push, but are capped (PAY-11).

**PAY-08. Prefer world-borne traces to narrated hints. A hint line can cost coherence.** `[empirical]`, small, one study
- *Source:* Bae and Young 2014 (*full text*): 54 participants read two short stories in three forms. Surprise ratings rose for the flashback form and the flashback-with-hint form against chronological order, with no significant difference between the last two. The hint form had the lowest coherence ratings in both stories. The authors suggest the hint sentence ("someone sends an e-mail") interrupts the flow. Story interacted with form on coherence.
- *Instance:* A shuttered stall and an unpaid bill on the counter, against a narrator line saying trouble was near.
- *Scales:* G. *Layers:* 3, X.
- *Operationalise:* **Produce.** Traces are things in the world: objects, routines, overheard talk, changed prices ([STR-01](d08-scale-threads-time.md) forms). **Check:** an A/B with four arms (no trace, world trace, narrated hint, after-the-fact why-trace) rated for surprise, coherence and fairness (M10-14). The study used text with one-to-one plan steps and is a weak guide to play.

**PAY-09. Do not rely on concealment. Knowing the outcome does not reliably spoil it, but the evidence is mixed. Keep the path uncertain.** `[empirical]`, **contested**
- *Source:* Gerrig 1989 (*abstract*: readers feel suspense about outcomes they know); Leavitt and Christenfeld 2011 (*summary*: 819 students, spoilers slightly raised enjoyment of short stories; a second study found none); Johnson and Rosenbaum 2015 and Levine and colleagues (*summary*: spoilers lowered it); a 2018 paper (*listing*: an effect for television episodes but not short stories).
- *Instance:* A district's rent strike is announced by a poster. The tension is in who joins and who is hurt.
- *Scales:* G, A. *Layers:* 3.
- *Operationalise:* **Produce.** Portents may state the threat ([DIR-41](d07-direction-pacing.md)); uncertainty sits in the path and the outcome weights ([DIR-43](d07-direction-pacing.md)). **Check:** the A/B that DIR-41 asks for.

**PAY-10. Do not take "I saw it coming" as evidence the plant worked. Memory turns known outcomes into inevitable ones.** `[empirical]` (*summary*)
- *Source:* Fischhoff 1975 and Roese and Vohs 2012 (*summary*: hindsight bias works at three levels, memory distortion, a sense of inevitability and a sense of having foreseen it).
- *Instance:* After a depot fire, a player says the signs were obvious. The ledger shows they never saw the notice.
- *Scales:* all. *Layers:* E.
- *Operationalise:* **Check (evaluation).** Compare reported foresight with the exposure ledger recorded *before* the event (M10-15). Do not use recall as a success measure.

**PAY-11. Every plant is a debt entry with a type, a size and a payer. Pay it at the size it was planted, with the thing that was planted, or retire it with a closing trace. Texture is allowed and budgeted.** `[practice]`
- *Source:* [QST-03](d04-quest-structure.md) (typed promises: tone, story, character, structure; paid or explicitly retired); [DIR-47, DIR-49](d07-direction-pacing.md) (closing trace; pay off at the size of the dread); [AGY-38](d09-agency-consequence.md); F-10 (the famous rule is an editor's rule of economy); [STR-07](d08-scale-threads-time.md) (keep a baseline of ordinary texture).
- *Instance:* A planted creed is paid by a test of the same creed. A courier's sealed case, never opened, is retired by a coda: the buyer was arrested.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce and check.** Extend the promise entry (S10-S2-10). Cap live plants at about three per attended thread and one foreground plant per scene **[J]**. **Check:** M10-11 unpaid ratio by type.

**PAY-12. The best plant is V's own act. A trace that cites something V did lets V claim the cause and the foresight.** `[hypothesis]`
- *Source:* [AGY-33](d09-agency-consequence.md) (V credits an event to V's act when the act came first, fits, and has no more conspicuous rival); [AGY-40](d09-agency-consequence.md); [BND-12](d02-relationships.md).
- *Instance:* Because V let a courier go, her sister's price drops later.
- *Scales:* G, A. *Layers:* 3.
- *Operationalise:* **Produce.** The callback finder prefers causes that are V acts; **check** AGY-33's exclusivity before naming.

**PAY-13. Plants must survive a reload. Derive them from the saved state with stable ids.** `[practice]`
- *Source:* SAV-02 (map); S2 §6.2 (offer ids are stable minted hashes) and §2.14 (sign ids `H("sign", …)`).
- *Instance:* After a reload V sees the same notice at the same stall.
- *Scales:* all. *Layers:* 2, 3.
- *Operationalise:* **Produce.** Trace delivery ids are `H("trace", seedId, plantId, index)`; the planner's choice is a seed-keyed draw (S2 §3.4). **Check:** a reload test shows the same traces.

**PAY-14. A plant V never perceived does not count. Count what V was shown.** `[analysis]`
- *Source:* [DIR-33](d07-direction-pacing.md); [AGY-32](d09-agency-consequence.md); S2 §10.2.
- *Instance:* A payoff may say "as the notice warned" only if the notice is in the ledger.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce.** A payoff claims an earlier plant only if the ledger holds an exposed trace. Otherwise it takes the why-trace route (PAY-02), or news. The planner re-stages an unexposed plant once. **Check:** M10-11 payoffs with at least one exposed plant.

**PAY-15. Establish a creed, then test it. A character plant is a visible stance. Its payoff is a decision under pressure.** `[analysis]`
- *Source:* [QST-03](d04-quest-structure.md) (character promises); CHG-10 and CHG-11; Forster; McKee.
- *Instance:* A ripperdoc's creed is visible at her stall. A client then offers triple for a job she would refuse. The decision is the payoff.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce.** Character plants are the first beat of a character-test profile (S10-S2-19). **Check:** a turn scene needs an exposed plant (CHG-11).

**PAY-16. A cause can be withheld unnoticed only if nothing V has seen depends on it.** `[analysis]`
- *Source:* Bae and Young 2014 (*full text*): a chain of initiating events can be moved after the outcome without the reader detecting the omission only if no event before the outcome has a causal link out of the chain, and nothing before the outcome depends on a dedicated link into it. If a seen event lacks its cause, the reader is aware of the gap, and curiosity replaces surprise.
- *Instance:* If V saw a guard pocket a key, the later break-in cannot be a surprise about the key. It is a curiosity about who gave it.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Check and produce.** Before staging an outcome-first event as surprise, the engine reads the exposure ledger. If V was exposed to an effect of a withheld cause, the cause is already a question in V's mind, and the event takes the `ask` route.

## 5. Models the engine could run

Three small models, each as a reading of the kernel and S2 as they stand, with the places where they need more. The toy numbers use assumed inputs, are labelled **[sim]**, and are small enough for the reference model to reproduce.

### 5.1 An NPC's change

| Concept | Record in the engine | Owner |
|---|---|---|
| Held view | A `Belief` in the NPC (S0 §11.1). Subject: the NPC itself, a group, a place or V | S1 |
| Stability | A class of three levels per NPC, drawn from its persistent id at sowing; an author may fix it for a named NPC | S1; S2 `Role.stability` |
| Pressure | (a) Events independent of evidence already counted that contradict the view (S0 §11.2); (b) `Dilemma`s between frames of different origin, weighted by severity (S0 §10.8) | S1 |
| Turn | A `turning` event, a pack event kind like `offer`: `{ who, kind: revision \| refusal \| exit \| tie, from, to, causes, served }`. S1 mints it. S2 reads it with `count` and, for staging, the new `believes` atom | S1, S2 |
| Reader | A consumer declared by the turning kind: a response template, an offer condition, a tie rung, a price | S2, S3 |
| Arc label | Derived afterwards: `revision`, `refusal`, `corruption`, `revelation`, `none` | P5 (evaluation) |

**The policy, per pressure arrival at one NPC:**
1. A relevance emission (S0 §10.5) or a `Dilemma` reaches the NPC's frame for the view. Pressure that cites evidence already counted adds nothing.
2. The weight is added to the view's pressure account. Weight comes from the event's size, or from the dilemma's severity.
3. If the account reaches the NPC's threshold, S1 revises. Normally the view moves toward what the evidence supports (a **revision**). If the move would violate a protected frame with high pull, S1 revises to the nearest view that spares that frame (a **rationalisation**, which is how a negative change starts), and each accepted rationalisation lowers the cost of the next by a gain (CHG-08).
4. S1 mints a `turning` event with its causes. Drive importance drifts by a bounded step only for a few event kinds (CHG-03). A membership change is an `exit` turn, with the exit cost the foundation gives (§5.2 there).
5. When a decision frame resolves in favour of the held view while the account is at or above a share of the threshold, S1 mints a `refusal`. A refusal changes nothing in the NPC. It is a recorded choice under pressure that V can see and that other NPCs' beliefs can use, and it is what makes the flat arc a thing that happens.

**What V sees of each outcome:**

| Outcome | What the record holds | What V can see | Principles |
|---|---|---|---|
| Revision toward the evidence | Old and new view, ≥1 independent pressure | A changed choice to a matching situation, after a witnessed before | CHG-05, 06, 10, 11 |
| Rationalisation, repeated | Several `turning` events of `corruption`, each with a step no larger than a third of the total | A run of scenes, each a full offer or response with its own cost | CHG-08, VOB-05 |
| Refusal | A `refusal` event with the pressure it held against | The NPC's line holding, and others shifting around it | CHG-02, 07 |
| Revelation | A recorded, unexposed disposition surfacing | A swing, readable as revealed only if a trace was laid | CHG-09, PAY-04 |

**Canon NPCs.** An NPC whose identity is fixed to the game's character keeps its canon facts. For such a role the change engine may change what that NPC believes about V and its ties with V, and nothing the game itself records about them, unless an author has declared a turn (`authoredOnly`, S10-S2-16). This follows D-03 (fixed parts), [GRW-11 and GRW-12](d08-scale-threads-time.md), and S2's L-16.

**Toy 1, how many turn [sim].** Inputs, all assumed: stability `s` drawn from Beta(4, 1.5) (mean 0.73, 41 per cent of NPCs above 0.8); threshold `3 × (0.5 + s)` weight units; each independent pressure event weighs 0.5, 1 or 1.5 with equal chance. Share who turn after `k` independent pressure events:

| k | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Share turned | 0.00 | 0.02 | 0.23 | 0.62 | 0.90 | 0.99 |

Reading: one or two events almost never turn a stable NPC, and four or five usually do. So turns concentrate where an arc-scale seed keeps touching the same few people. Across a city with a thin spread of pressure, almost everyone stays as they are, which is the flat arc by default. The inputs are guesses. The shape (a steep rise between two and five events) is what calibration fixtures would test.

**Toy 2, how steps arise [sim].** An NPC's willingness starts at 1.5 and is multiplied by a gain `g` after each ask it takes. Asks grow 1.0, 1.5, 2.0 and on to 4.0 in steps of 0.5. A cold ask of 4.0 is refused. With `g` of 1.0 or 1.1 the NPC stops partway. With `g` of 1.2, 1.3 or 1.5 it takes the size-4 ask on the seventh step. The number of steps is set by the ask schedule, not by the NPC, so a cap on step size (a third of the total) guarantees the observable run (CHG-08).

### 5.2 A district's argument

**A premise** is pack data (S10-S2-02): an id; a sentence for authors and tools, never rendered to V in the system's voice; a **signature**; a scope; a quota; an optional `intended` list for dissonance made on purpose.

**The argument profile** is computed from the seed records, offers, responses, canon events and the exposure ledger, per scope. For each stance class (help, bargain, refuse, oppose, ignore, S2 §2.8) and each offer in scope it holds:

| Column | Source |
|---|---|
| Immediate gain to V | The action's `writes` and reward policy (S2 §2.5) |
| Cost: class, bearer, when | The action's `costs` (S10-S2-03) |
| Consequence shown | Whether the cost's aftermath trace was exposed (S2 §10.2) |
| V's choice | The recorded response (S2 §7.4) |
| Counter-premise act | A V act the premise's signature marks as against it |

A **signature** is a predicate over this table, for example: "in at least 60 per cent of offers, the stance with the highest immediate gain also has a later cost whose bearer is a third party". Signatures name record features only. They never name V's feelings.

**The audit** runs offline first and has five checks:
1. **Sample.** Report `insufficient` below a minimum number of offers in scope.
2. **Match.** Does the realised table meet the declared signature?
3. **Dominance.** Is one stance best on immediate gain in most offers whatever the premise? If so, the district argues "that stance pays", and that is a finding even if no one declared it.
4. **Rewards.** Do reward policies and route payoffs contradict the stated stance (THM-10)?
5. **Balance.** Are supporting, opposing and complicating arguments within the quota (THM-12)?

**Toy 3, how many offers an audit needs [sim].** One-sided binomial test at the 5 per cent level, power 0.8, signature present in a share `p1` of offers against a chance background `p0`:

| Background `p0` | Signature `p1` | Offers needed | Matching needed |
|---|---|---|---|
| 0.2 | 0.6 | 10 | 5 |
| 0.3 | 0.7 | 10 | 6 |
| 0.3 | 0.6 | 17 | 9 |
| 0.5 | 0.7 | 37 | 24 |
| 0.4 | 0.6 | 42 | 23 |

Three matching offers in a row happen by chance 0.8, 2.7, 6.4 and 12.5 per cent of the time at backgrounds of 0.2, 0.3, 0.4 and 0.5. A signature that is only slightly above chance needs a district's worth of offers, so audits work at district or season scope and a within-thread recurrence of three stays a craft device (THM-07).

**What the audit does not do.** It does not steer in the first implementation. It reports. A weak tie-breaker (S10-P5-03) can use its output later, and only if the report has proved trustworthy.

### 5.3 The plant ledger

A **plant** is a promise entry (S2 §2.8) whose `opens` beat is a trace, a world-borne thing V can perceive. Its states:

| State | Meaning |
|---|---|
| `candidate` | A found cause exists that could be shown |
| `planned` | A trace is scheduled with a weight (portent or plant) and a carrier |
| `shown` | The delivery was displayed and sits in the exposure ledger |
| `acted-on` | V's observed act touched the carrier (approached, scanned, asked). It is inferred only from observed acts |
| `paid` | The payoff used the planted thing, at the planted size |
| `retired` | Closed with a closing trace (DIR-47) |
| `lapsed` | Never shown. Dropped with no residue |

**The three arrangements and the engine's paths:**

| Feeling | Arrangement (Brewer and Lichtenstein, via Bae and Young) | Engine path | Existing S2 construct |
|---|---|---|---|
| Suspense | Cause shown, outcome pending | Portent (DIR-41, 45) from a hostile thread's record | `Clock.signs`, `Projection`, class-0 traces |
| Curiosity | Outcome shown, reader aware its causes are missing | A glance with an `ask` handle that reaches an offer or a why-trace in two steps | `Fragment.ask`, L-38 |
| Surprise, accounted for | Outcome shown, reader unaware its causes are missing, then supplied | Outcome first; a why-trace on request or at once, with ≤2 causes (AGY-36); only if nothing V has seen depends on the withheld cause (PAY-16) | Kernel `explain`; nothing in S2 yet |

**The source choice**, in order: (1) a **found** cause in the thread's record; (2) a found cause chosen for display from several; (3) a **constructed** cause, only if the first two are empty and `latitude` allows `trace-cause`. A constructed cause goes through kernel constraint arbitration, is refused if it contradicts a pin, the exposure ledger or V's presence history, and is committed when first displayed. The service records `source` on every delivery.

**Budgets [J]:** at least two independent traces of different kinds for a gig-level or higher event (DIR-46); at most about three live plants per attended thread and one foreground plant per scene; a baseline of unplanted texture kept (STR-07); portents under dossier 7's push and tension limits; plants are class 0.

**What S2 has and what it lacks.**

| Need | In S2 now | Missing |
|---|---|---|
| A typed, sized, paid-or-retired plant | `Promise { id, opens, paidBy, mayStayOpen }` | `kind`, `size`, `weight`, `carrier`, `retire` content |
| A true-to-record trace | Glance fragments with `implies` and a `needs` of a fact or constructed cause (L-32) | A check that the cause is past, not pending; provenance `source` |
| A closing trace for an unpaid plant | `closing` for the seed (S2 §6.4) | A per-plant closing trace and typed loose ends |
| Pin-on-display for a constructed cause | §2.14's commit of consumed events | The same commit for a constructed trace cause |
| Two independent signposts | `aftermath.signpost` (one fragment) | A list, with a lint for kind variety |
| A why-trace path for any event | Kernel `explain` (S0 §13) | A contract in S2 and the arbiter that a V-facing event can reach it |

## 6. Three walk-throughs

All invented for this dossier. None is content.

### 6.1 A ripperdoc holds her line (a flat arc)

A ripperdoc, Mara, has a creed: she treats anyone, no questions. An authored role fixes her stability high.
1. **Plant (PAY-15, CHG-11).** Her stall shows the creed through three world-borne traces: a hand-lettered price list with no "preferred clients", a waiting bench with a gang runner and an office worker side by side, and her talk with a patient. The ledger holds them as `shown`.
2. **Pressure (CHG-05, 07).** Over three gigs a fixer leans on her (a threat to her licence), a rival clinic offers her a post (a membership), and a client asks her to fix a man V has just shot (a dilemma between her creed and a protected frame, severity 0.6). Four independent events. Her account is near the threshold.
3. **Refusal (CHG-02).** At the dilemma she patches the wounded man, over the client's objection. S1 mints a `refusal`. V sees the choice under pressure.
4. **Influence (CHG-02, 14).** The fixer, who relied on her, revises a belief about "no one is clean" (a turning event whose cause is her act). The gang runner on her bench stops carrying a blade in the clinic. Two readers of her refusal.
5. **Label (CHG-01).** The recogniser reads: Mara `refusal` ×1, influence 2. A reader calls it a flat arc.

### 6.2 A lieutenant slides (a negative change)

A gang lieutenant holds the belief "the crew looks after its own" (a `Belief`, stability medium).
1. **Pressure (CHG-05).** Two promises to him are broken in front of V's earlier gig, and a rival's offer arrives (independent events).
2. **Rationalisation (CHG-08).** His protected frame is his place in the crew. He revises to "everyone skims, so I may". Gain `g` is 1.3. His asks grow in steps of at most a third of the total: skim, cover a skim, sell a name.
3. **Offers, not a ramp (VOB-05).** Each step reaches V as its own offer from the lieutenant's own frame, with a decline path. The cause chain for each rise is the lieutenant's changing frame. The director orders nothing.
4. **Reading (CHG-09, 10).** The third step is a revelation if the record shows he had been skimming unexposed, and a change if not. Either way the planner laid two traces (PAY-04): a ledger left open on a bar, an unusual debt repaid.
5. **Account (CHG-13).** Later he tells V he had no choice. The record shows two offers he turned down.

### 6.3 A burst main (a plant that pays)

A water main fails in a district at the end of a gig.
1. **Found causes (PAY-04).** S1's record holds a maintenance backlog (a district field), a contractor's dispute and a complaint from a vendor. The planner picks two of different kinds (DIR-46): a notice at a stop and a vendor's remark. Both are true whether or not the main bursts (PAY-03).
2. **Shown (PAY-14).** V passes the stop and hears the vendor. The ledger holds both.
3. **Payoff (PAY-01, 02).** The main bursts. Because V saw the plants, V can claim the foresight. Because both are in the record, the why-trace names one cause (AGY-36).
4. **If the main had not burst (PAY-11).** The notice stays honest. A coda a week on says the contractor came. If the planner had had nothing found, it would have constructed a vendor's remark inside latitude, labelled it `constructed`, checked it against V's observed pins and committed it when V heard it (PAY-05).

## 7. Measures

Principles are hypotheses until measured ([TEL-15](d06-sifting-tellability.md)). Each measure reads the record and the exposure ledger; none needs a model of V.

| # | Measure | Reads | Target or alarm | Principles |
|---|---|---|---|---|
| M10-01 | Share of `turning` events citing ≥1 independent pressure event or dilemma | Turning events and causes | 100 per cent; any other value is a defect | CHG-05 |
| M10-02 | Share of staged turn scenes with a witnessed earlier act or a told alternate | Scene `needs`, exposure ledger | 100 per cent | CHG-10, 11 |
| M10-03 | Distribution of arc labels per season; influence counts of `refusal` NPCs | Arc recogniser | Most NPCs `none`; flat arcs show influence ≥1 | CHG-02, 03, 07 |
| M10-04 | Steps in each negative change; largest step as a share of the total | Turning events | ≥3 steps; largest ≤ one third **[J]** | CHG-08 |
| M10-05 | Readers per turning kind; unread turns | Registry, record | ≥1; unread turns logged as loose ends | CHG-14 |
| M10-06 | Pairwise distance between NPC signatures over a season; consistency across matched situations | Frame weights, responses | Distance does not shrink; consistency high except at turns | CHG-04, 15 |
| M10-07 | The argument profile per scope, with sample size, match, dominance flags; city-belief fixtures for V | Seed records, exposure ledger | Report, no target yet | THM-03, 07, VOB-03 |
| M10-08 | Count of mechanic, implied value and stated value mismatches without `intended` | Reward policies, route facts | 0 | THM-10 |
| M10-09 | The takeaway test: after N hours players answer "what is this part of the city about?" and "which two scenes echoed?" Compare to the premise, structure-recurring against independent-cost districts | Player answers | A pilot first; effect size unknown | THM-02, 07, 09 |
| M10-10 | Premise-sentence renders per seed; preachiness ratings | Renders | ≤1 per seed; ratings not worse than no-premise districts | THM-13 |
| M10-11 | Plant ledger: plants alive, paid, retired, lapsed; unpaid ratio by type; payoffs with ≥1 exposed plant | Promise entries, ledger | Unpaid ratio low and falling; payoffs mostly with an exposed plant | PAY-11, 14 |
| M10-12 | Constructed share of traces; contradictions of pins or ledger; revelations without an earlier trace | Delivery `source`, record | Share low **[J: under a quarter]**; contradictions 0; revelations without a trace 0 | PAY-04, 05, CHG-09 |
| M10-13 | Share of V-facing generated events with a reachable why-trace of ≥1 recorded cause | Record, `explain` | 100 per cent | PAY-01, 02 |
| M10-14 | A/B with four arms: no trace, world trace, narrated hint, after-the-fact why-trace; rated for surprise, coherence, fairness and "seemed caused" | Ratings | A pilot first; the hint arm is the one to watch (Bae and Young) | PAY-08, 09 |
| M10-15 | Reported foresight against the exposure ledger recorded before the event | Survey, ledger | Report the gap; do not target recall | PAY-10 |
| M10-16 | Escalation detector hits: consecutive offers from one thread rising in ask size without a world-side cause | Offers, causes | 0 | VOB-05 |

**A first test design for the lens's untested claims.** Take one event type (a depot fire). Build four versions of the lead-up: no trace, one world trace, two independent world traces, and a narrated hint. Add a fifth with the why-trace only. Run each as a short scripted scene to players, then ask whether the event "seemed caused", "seemed fair" and "seemed random", and check each answer against the ledger. A pilot sets the effect size. Bae and Young's one test suggests the hint arm may not help, so it should be there.

## 8. Tensions

| # | Pulls | Resolution |
|---|---|---|
| T-1 | **Arc craft against simulation.** The craft wants transformation arcs. The simulation, with sane thresholds, yields flat people and few turns | Treat the flat arc as a first-class result and let turns gather where seeds keep touching one NPC (CHG-02, 07). Do not add turns to make arcs |
| T-2 | **Theme against agency (bar 4, D-09).** A theme wants repeated costs. Agency wants V free to decline and to read otherwise | Costs attach to accepted options, never to declines (THM-11; D9 on declines). The fiction argues back by its own logic |
| T-3 | **Theme coherence against variety.** The same structure again and again | Hold the structure, vary the surface (THM-08); the audit is district-scale; a quota is a tie-breaker |
| T-4 | **Plants against surprise and spoilers.** Hints can lower coherence and concealment may not matter | World-borne traces; keep the path uncertain; use the why-trace route (PAY-08, 09, 02) |
| T-5 | **Found against constructed causes (foundation C-01 against DS-24).** Generate-then-justify is cheap and invented causes can contradict V's memory | Prefer found; constructed only inside latitude, pinned when shown, refused on conflict (PAY-04, 05) |
| T-6 | **Showing change against lazy settlement.** Off-screen turns need staging V may never see | Settle at joints; news or a sighting; a told alternate when V lacks the before (CHG-11, 12) |
| T-7 | **Moral asymmetry against forgiveness.** A bad act weighs more, yet reconnection is welcomed (BND-25) | A per-domain asymmetry scaled by the district's base rate, and revision on new independent evidence (VOB-03) |
| T-8 | **The audit against "no ceremony".** A heavy theme machine would break the engineering contract | Offline first, reports only; a weak tie-breaker later and only if the report proves its worth (§5.2) |
| T-9 | **Reward realism against premise.** Pay by route (QST-13) may say what the premise denies | Audit rewards against premises; `intended` for dissonance on purpose (THM-10) |
| T-10 | **Plant counts against dossier 7's limits.** More plants might push the attention budget | Plants are class 0 world traces, capped per thread and scene; portents obey the push limits (PAY-07, 11) |
| T-11 | **NPC beliefs about V's motives against AGY-35 and L-20.** An NPC misreading V is good story material (foundation §5.4). The engine may not state V's reasons | The belief is the NPC's, `because` an observed act, with a reply V can use to correct it. This needs a coordinator ruling (S10-S2-21) |
| T-12 | **Canon characters against generated change.** Canon fates are fixed | The engine changes beliefs about V and ties with V only, unless an author declares more (S10-S2-16) |

## 9. Lateral links

- **Arc as a recorded revision** is the same idea as belief revision in agent architectures, where the question is when new evidence displaces a held belief. A comparison only (D-21): the kernel's belief record is the engine's own.
- **The three arrangements of cause and effect** are the same idea as portents, `ask` handles and why-traces, which the engine already has for other reasons. Structural-affect theory names what each does to the audience, which is why they belong together.
- **An argument profile** is the same idea as an expressive-range histogram in procedural content generation (lens L2 F4): a picture of what a generator actually produces, compared with what it was meant to.
- **Influence of a flat arc** is the same idea as out-degree in the cause graph: how many other records cite this one.
- **The plant ledger** is the same idea as the promise ledger (QST-03), the debt entry (AGY-38), the clock's signs (S2 §2.14) and an editor's setup-and-payoff list.
- **Asymmetric updating** is the same idea as trust repair (BND-04): a breach has a kind, and what repairs it depends on the kind.
- **Pin on display** is the same idea as committing a consumed event (S2 §2.14): what V has seen cannot change.
- **Echo by carrier and structure** is the same idea as a callback with a cue (TEL-07, AGY-40).
- **A told alternate of a turn** is the same idea as the told story (map EXP-09), which dossier 21 owns.

## 10. Open questions

1. **Do world-borne traces raise rated causedness over no trace?** The lens assumed so. The one nearby study found a hint line lowered coherence. M10-14 is the pilot.
2. **How many independent pressure events convince players that an NPC changed?** The toy says four or five turn a stable NPC. What players need to believe it is untested.
3. **Does naming the premise help or hurt?** Preachiness is a hypothesis with no source (THM-13). The takeaway test (M10-09) can run both.
4. **What granularity do cost classes need?** S4's `StakeTag` list is the candidate. Too few and the audit is blind. Too many and tags are noisy.
5. **Does the morality asymmetry hold in Night City?** The frequency account says where bad acts are common they are less diagnostic. Calibrate by district (VOB-03).
6. **Can the signature be learned from the record, not declared?** Mining the argument profile for the pattern a district actually argues is a possible later tool.
7. **Do players notice constructed causes?** Retrofit detection (PAY-05) has no study. A cheap probe: show a trace and ask whether it "was always there".
8. **How do canon characters' authored arcs meet generated pressure?** T-12 gives a floor. The interplay (an authored turn that generated events might push on) needs an example from the main-story state.
9. **Does a reunion read as change, or as a different NPC?** CHG-11 asks for one cue per changed dimension. The count that reads best is unknown.
10. **Can any of this be tagged reliably by a model?** The engine's tags are structural, so none needs a language model. Dossier 22 owns the question of whether one can help author premises or traces.

## 11. Requirements

Each requirement traces to a principle. Tunables marked **[J]** need fixtures from the evaluation work. Proposed lint numbers continue S2 §11.1 after L-44 (L-25 and L-40 are retired and not reused). "Extends" and "Challenges" name the S2 section. Items owned by S1 (the simulation policies) are marked and go to the simulation specification through the coordinator.

### 11.1 The seed language (S2)

| # | Requirement | Extends or challenges | Traces to |
|---|---|---|---|
| S10-S2-01 | **Split theme from tone.** `Intent.tone[].role` (supports, opposes, complicates) has no referent. Keep `tone` as a list of `ToneTag`s. Add `argues: Array<{ premise: PremiseId; stance: 'supports' \| 'opposes' \| 'complicates'; carriers: BeatKey[] }>`, where carriers are the beats whose offers, costs or consequences carry the argument | **Challenges** §2.3 | THM-04, 14; FIT-33 |
| S10-S2-02 | **A `Premise` object in packs (S4 vocabulary):** `{ id, sentence, signature, scope, quota, intended? }`. `sentence` is for authors and tools, never for rendering in a system voice. `signature` is a predicate over the argument profile (§5.2) built from record features only. `scope` is district, region or season. `quota` bounds the share of supporting, opposing and complicating seeds. Packs default to no premises | **Extends** §2.3 | THM-04, 07, 12, 16 |
| S10-S2-03 | **Per-action costs.** Add `costs: Array<{ bearer: RoleKey \| 'client' \| 'v' \| 'third'; what: StakeTag; when: 'now' \| 'later'; shown: 'trace' \| 'named' \| 'quiet' }>` to `OfferSpec.actions`. The offer-level `stakes` stay. The audit reads costs from the record; a stake on `v` keeps L-15 | **Extends** §2.9 | THM-01, 03, 05, 06 |
| S10-S2-04 | **Cost lints.** L-45 (warning): a consequential offer whose actions declare identical or no costs. L-46 (error): a cost with `when: 'later'` and `shown: 'trace'` whose action's write has no aftermath beat consuming it, in the manner of L-06 | **Extends** §11.1 | THM-05, 06 |
| S10-S2-05 | **L-47 (warning): an `argues` entry with no carrier.** A seed that takes a stance but writes nothing the audit reads is a label only | **Extends** §11.1 | THM-14 |
| S10-S2-06 | **A `believes` atom.** `{ believes: { who: RoleKey; of: RoleKey \| Id \| 'v'; path: SlotPath; is?: ValueSpec; atLeast?: number } }`, reading the NPC's own belief through S0 §11.4's `knows` (never world truth). Beliefs held about V are allowed. No atom reads a state of V | **Extends** §2.6 | CHG-01, 06; VOB-01 |
| S10-S2-07 | **Turns on NPCs.** `Turn` gains `who?: RoleKey` and `kind: 'revision' \| 'refusal' \| 'exit' \| 'tie' \| 'standing'`. L-33 is extended: a `turns[].what` may read a belief held about V, or V's recorded acts, and may never read V's inner state | **Extends** §2.13, L-33 | CHG-01, 05; VOB-01 |
| S10-S2-08 | **Register the `turning` event kind** in the core pack vocabulary (S4, through the route S0 §20 gives for new event kinds): `{ who, kind, from, to, causes, served }`, minted by S1. Staging beats read it with `count`. No kernel change | **Extends** §0.4, §2.6 | CHG-05, 06 |
| S10-S2-09 | **L-48 (warning): a staging beat for a turn needs a witnessed and a told form.** A beat whose `needs` reads a `turning` count must have alternates, one that applies when the earlier stance is `exposed` and one that applies when it is not | **Extends** §2.8, §11.1 | CHG-10, 11 |
| S10-S2-10 | **Typed plants on the promise ledger.** `Promise` gains `kind: 'tone' \| 'story' \| 'character' \| 'structure'`, `size: 'small' \| 'medium' \| 'large'`, `weight: 'portent' \| 'plant'`, `carrier?: 'object' \| 'person' \| 'place' \| 'phrase'` and `retire?: ContentRef` (the closing trace). A plant is a promise whose `opens` beat is a trace | **Extends** §2.8 | PAY-07, 11, 15; QST-03 |
| S10-S2-11 | **Trace provenance and pin on display.** Each trace delivery records `source: 'found' \| 'surfaced' \| 'constructed'` and the cause it cites in the `display` entry (§10.1). On displaying a `constructed` trace, layer 2 commits the cause's fields with `committed` pins, as §2.14 does for consumed events, so the past cannot change after V has seen it | **Extends** §2.14, §10.1 | PAY-04, 05 |
| S10-S2-12 | **`trace-cause` joins the starter `MaterialKind` set.** A constructed cause outside a seed's latitude fails L-32 | **Extends** §2.11 | PAY-04 |
| S10-S2-13 | **L-49 (error): a trace whose cause is a pending event.** A glance trace's `needs` must cite a fact or a past event pattern. L-32 stays | **Extends** §11.1 | PAY-03 |
| S10-S2-14 | **Two signposts at gig level and above.** `aftermath.signpost` becomes `signposts: FragmentRef[]`. L-23 stays an error for none; add a warning for gig level or above when the list holds one kind only (DIR-46) | **Extends** §2.8, L-23 | PAY-02, 04 |
| S10-S2-15 | **`Role.stance` and `Role.stability`.** `stance?: { premise: PremiseId; toward: 'holds' \| 'resists' \| 'profits' \| 'doubts' }`, usable in `prefer` so casting spreads stances. `stability?: 1 \| 2 \| 3`, a class an author may fix for a named NPC; the default comes from S1 | **Extends** §2.4 | CHG-02, 06; THM-15 |
| S10-S2-16 | **Canon guard.** A turn or effect on a role with a fixed game identity that would change a fact the game records is `authoredOnly` (L-50, error). Turns the engine adds on such a role are confined to beliefs about V and ties with V | **Extends** §2.5, §2.4; L-16 | GRW-11; CHG-12 |
| S10-S2-17 | **Persistence of turns.** Belief, importance and membership writes made by a turning kind are `lasting`. `resettable` on them is an error, as L-12 treats game facts | **Extends** §2.5 | CHG-03, 08 |
| S10-S2-18 | **Turning kinds declare consumers.** Each `turning` kind lists its readers (response templates, offer conditions, tie rungs, prices). L-51 (error): a kind with none. L-05's logic applied to turns | **Extends** §2.5, §11.1 | CHG-14 |
| S10-S2-19 | **Two profiles, specified before they are built (§2.10).** `testing-arc` (a flat arc): a baseline beat that exposes the creed; at least two pressure beats from independent causes; a test beat that is a decision with the NPC's stance; an aftermath that reads other NPCs' turns. `slide` (a negative change): asks whose size may rise by at most a third of the total change per step **[J]**, each a full offer with a decline path, each rise tied to the asker's own frame, never to `then` order. L-52 (warning): a step above the cap. Both are data and each gets an appendix like A | **Extends** §2.10 | CHG-07, 08, 10, 11; VOB-05; PAY-15 |
| S10-S2-20 | **Typed loose ends.** `looseEnds` (§6.4) gains entries `unpaidPlant`, `unreadTurn` (a turning event no consumer read) and a `changes` list of turning events the seed caused, each with a `witnessed` flag | **Extends** §6.4 | CHG-12, 14; PAY-11 |
| S10-S2-21 | **Marked NPC attribution lines. Needs a coordinator ruling.** Allow a line, marked `attribution`, in which an NPC states a belief about V's motive, `because` an observed act, phrased as the NPC's belief, with a reply V can use to correct it. System-voice statements stay forbidden. This refines L-20 and L-21 (S4 lexicon) and the §2.9 honesty rule | **Challenges** §2.9, L-20 | CHG-13; T-11; D-10 |
| S10-S2-22 | **Premise-phrase lint (S4 lexicon).** A warning when a premise sentence is rendered more than once in a seed, or in a system voice. NPC speech that holds a view, including an opposing one, is not counted | **Extends** §11.1 | THM-13 |
| S10-S2-23 | **Fit report previews (§11.2).** Add `argues` (the seed's rows of the argument profile in each sample state), `plants` (each plant's cause, found or would-be constructed, and its earliest exposure) and `turns` (who could turn, and how much pressure it takes). With the director off, they show only what the seed itself carries | **Extends** §11.2 | THM-03; PAY-04, 14; CHG-07 |

### 11.2 The procedural engine (P5)

"S1" marks items the simulation specification owns that P5 depends on.

| # | Requirement | Owner | Traces to |
|---|---|---|---|
| S10-P5-01 | **Argument-profile service.** Compute the table of §5.2 per scope from seed records, offers, responses, canon events and the exposure ledger. Report match, dominance and reward mismatches. Read-only and offline in the first implementation | P5 evaluation | THM-03, 07, 10 |
| S10-P5-02 | **Sample rule.** The audit reports `insufficient` below a minimum number of offers in scope, set from the premise's declared effect size (§5.2, toy 3: about 10 to 40). It never judges by three offers | P5 evaluation | THM-07 |
| S10-P5-03 | **Stance quota as a weak weight.** Among seeds that already fit, fitting and sowing prefer the stance most under-represented in scope. It never overrides V's pull, author priorities (D-03) or the proactivity dial (D-02), and it is off when no premise is in force | P5 sowing, fitting | THM-12, 16 |
| S10-P5-04 | **Reward-policy audit hook.** The audit reads QST-13's reward tables and route facts against each premise. A mismatch needs the premise's `intended` annotation | P5 evaluation | THM-10 |
| S10-P5-05 | **Recurrence by structure.** Sowing holds a premise's structural features (stance classes, cost classes, bearers, timing) at the declared share, while S5's variety rules separate the surface slots | P5 sowing | THM-07, 08 |
| S10-P5-06 | **Echo finder.** The callback finder retrieves candidate pairs by carrier (object, place, phrase), filters on matching stance structure and a recorded change, and applies TEL-07's cue rules | P5 sifting | THM-09 |
| S10-P5-07 | **NPC change policy (S1).** Held views as beliefs; stability classes; pressure from independent events and `Dilemma`s; thresholds; `turning` events with causes; bounded importance drift on a few event kinds; a cap on NPCs with a pending turn in V's attended set | S1 | CHG-03 to 07 |
| S10-P5-08 | **Rationalisation and reversal policy (S1).** Gain `g`, step cap, decay with absence and with contrary evidence; fixtures from toy 2 | S1 | CHG-08 |
| S10-P5-09 | **Arc recogniser.** Label turning-event runs `revision`, `refusal`, `corruption`, `revelation` or `none`, with an influence count for refusals. For sifting and measures. Never a generation target | P5 evaluation | CHG-01, 02, 09 |
| S10-P5-10 | **Sifting of turns.** Treat a witnessed before and a turning event as a tellable chain (TEL-02), ranked by exposure and reader count. Unwitnessed turns go to news or a sighting | P5 sifting | CHG-11, 12, 14 |
| S10-P5-11 | **Staging of turns.** Release turn scenes at joints through the arbiter, in witnessed and told forms; a reunion glance with at least one cue per changed dimension; lazy settlement for off-screen turns | P5 director, arbiter | CHG-10 to 12 |
| S10-P5-12 | **Reader registry.** Each `turning` kind registers its consumers; unread turns are logged as loose ends and may seed new seeds | P5 sowing | CHG-14 |
| S10-P5-13 | **Reputation aggregation (S1).** Per-domain asymmetry (morality, competence) scaled by the district's base rate for the act kind, and revision on new independent evidence when V changes course | S1 | VOB-03 |
| S10-P5-14 | **Reflection channels.** Reflect V's acts in world behaviour (approach, prices, distance) before words. Reflection has several dimensions and no single axis. Words only as a witness's observation after at least three acts of one kind | P5 director, S8 | VOB-02, 04 |
| S10-P5-15 | **Escalation guard.** Detect consecutive offers from one thread rising in ask size to V. Require a world-side cause for each rise. Refuse director-ordered ordering. Log hits | P5 director | VOB-05 |
| S10-P5-16 | **Plant planner.** Per thread, choose traces from found causes as class-0 world forms; at least two independent kinds at gig level and above; at most about three live plants per attended thread and one foreground per scene **[J]**; keep a baseline of unplanted texture | P5 sowing | PAY-03, 04, 07, 08, 11 |
| S10-P5-17 | **Constructed-cause service.** Produce causes only as kernel contributions; refuse on conflict with pins, the exposure ledger or V's presence history; commit on first display; record provenance; meter the share | P5, S2 | PAY-04, 05 |
| S10-P5-18 | **Postdict route.** Every V-facing generated event carries a why-trace path (kernel `explain`, at most two causes, AGY-36) reachable within two steps. An outcome-first event is staged as surprise only if no effect of the withheld cause is in the exposure ledger; otherwise it takes the `ask` route | P5 director | PAY-02, 16 |
| S10-P5-19 | **Plant ledger, interval and closing.** The payoff schedule reads the last exposure time and adds a refresh trace when stale (DIR-56). Unpaid plants get a closing trace (DIR-47). Report the unpaid ratio by type | P5 director | PAY-06, 11, 14 |
| S10-P5-20 | **Reload stability.** Plant choices, traces and turning events use stable ids and seed-keyed draws | S2, P5 | PAY-13 |
| S10-P5-21 | **Theme default off.** With no premises in force, the audit weight and the quota are off. The engine never mints a premise. A player setting lowers or removes the city's thematic weighting, and the proactivity dial scales it | P5, S4 | THM-16; D-02 |
| S10-P5-22 | **Evaluation hooks.** Expose what M10-01 to M10-16 need, and the arms for PAY-08's four-way test and the takeaway test | P5 evaluation | §7 |
| S10-P5-23 | **Canon NPCs.** The change engine runs on generated and open NPCs. For canon NPCs it changes only beliefs about V and ties with V unless an author declares a turn | S1, P5 | CHG-12; S10-S2-16 |

## 12. Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give.

| # | Field | Source | Tier |
|---|---|---|---|
| MM-1 | **Personality stability and change in people.** How fast and why traits change, and the social investment idea that roles drive it. Grounds the rates for NPC change | Roberts, Walton and Viechtbauer 2006; Haehner et al. 2025; Roberts, Wood and Smith 2005 (summaries) | Supporting; it feeds dossier 1 (DRV-06, DRV-08) |
| MM-2 | **Person perception: diagnosticity and negativity.** Why one moral lapse outweighs several good acts, and the frequency account | Skowronski and Carlston 1987; Mende-Siedlecki et al. 2013 (summaries) | Supporting; it belongs with reputation inference in dossier 15 |
| MM-3 | **Narrative comprehension: causal networks and the search for meaning.** What makes an event matter and be remembered | Trabasso and colleagues 1985; Graesser, Singer and Trabasso 1994 (summaries and abstract) | Core for perception work (dossier 13); it grounds NAR-29 and TEL-10 |
| MM-4 | **Theme-driven story generators.** MINSTREL's planning advice themes and BRUTUS's formal definition of betrayal made a theme the engine of generation | Turner (MINSTREL); Bringsjord and Ferrucci (BRUTUS); Peinado et al. 2006 and a Computational Linguistics review (summaries) | Supporting; it narrows L12's "no generator" and belongs with dossier 22 |
| MM-5 | **Moral psychology of gradual corruption.** Slippery-slope escalation and its neural adaptation | Welsh et al. 2015; Garrett et al. 2016 (summaries) | Supporting; it grounds CHG-08 and the ethics of VOB-05 (ETH-04, ETH-20) |
| MM-6 | **Narrative identity.** How people tell their own change and what it predicts | McAdams and colleagues; Adler et al. 2015 (summaries) | Supporting; it feeds told stories (EXP-09, dossier 21) |
| MM-7 | **Analogical retrieval.** Reminding follows surface; soundness follows structure | Gentner, Rattermann and Forbus 1993 (abstract) | Supporting; it belongs with callbacks and perception (dossier 13) |
| MM-8 | **Hindsight bias.** Memory turns known outcomes into foreseen ones | Fischhoff 1975; Roese and Vohs 2012 (summaries) | Supporting; it shapes evaluation (dossier 23) |
| MM-9 | **Empirical tests of persuasion through game rules.** Whether procedural rhetoric moves players, and whether they read the intended argument | Jacobs et al. 2021 (page); Anderson's thesis (summary) | Supporting; it is the evidence base for NAR-09 |
| MM-10 | **Person-situation interactionism.** Character as stable if-then patterns across situations | Mischel and Shoda 1995 (summary) | Supporting; it feeds dossier 1 (DRV-08) and NPC signatures |
| MM-11 | **Moral emotion in games.** Guilt and justification in virtual harm | Hartmann, Toz and Brandon 2010 (abstract) | Fold into ETH-04 (supporting) |

## 13. Credit candidates

For the [community credits](../../../docs/community-credits.md); this dossier does not edit that file. Creators are as the page showed them. "Opened" means I read the page or the full text this session. "Listed" means the link appeared in a search result and I did not open it, or it refused the connection; the link should be checked before the credits file is edited.

| Creator | Title | Link | Status | What we learned |
|---|---|---|---|---|
| Byung-Chull Bae and R. Michael Young | "A Computational Model of Narrative Generation for Surprise Arousal" (*IEEE TCIAIG* 6(2), 2014) | https://www.cs.uky.edu/~sgware/reading/papers/bae2014surprise.pdf | Opened (full text) | How curiosity and surprise differ by whether the reader notices the missing causes, when a cause can be withheld unnoticed, and that a hint line did not add surprise and lowered coherence |
| Peter Mawhorter, Michael Mateas, Noah Wardrip-Fruin and Arnav Jhala | "Towards a Theory of Choice Poetics" (FDG 2014) | https://cs.wellesley.edu/~pmwh/research/papers/towards-choice-poetics-fdg-2014.pdf | Opened (full text) | That false, blind and delayed choices can each carry a theme, and that flavour choices shape a player's sense of identity |
| K. M. Weiland | "The flat character arc" (helpingwritersbecomeauthors.com) | https://www.helpingwritersbecomeauthors.com/flat-character-arc/ | Opened (page) | The flat arc as a stable conviction that changes the world, and its difference from the positive arc |
| Ruud S. Jacobs, Stefan Werning, Jeroen Jansz and Julia Kneer | "Procedural arguments of persuasive games: an elaboration likelihood perspective" (*Journal of Media Psychology* 33(2), 2021) | https://research.utwente.nl/en/publications/procedural-arguments-of-persuasive-games-an-elaboration-likelihoo-4/ | Opened (page) | That stronger procedural rhetoric increased persuasion in a 241-participant experiment |
| P. Formosa, M. Ryan and D. Staines (initials as the page showed them) | "Papers, Please and the systemic approach to engaging ethical expertise in videogames" (*Ethics and Information Technology* 18(3), 2016) | https://researchers.mq.edu.au/en/publications/papers-please-and-the-systemic-approach-to-engaging-ethical-exper/ | Opened (page) | A systemic design carries moral engagement differently from scripted scenes |
| Roberts, Walton and Viechtbauer (first names not shown in the listing I saw) | "Patterns of mean-level change in personality traits across the life course" (*Psychological Bulletin* 132(1), 2006) | https://pubmed.ncbi.nlm.nih.gov/16435954/ | Listed | That personality change in people is slow and small, which sets our rates |
| Dedre Gentner, Rattermann and Forbus (first names of the last two not shown in the listings I saw) | "The roles of similarity in transfer: separating retrievability from inferential soundness" (*Cognitive Psychology* 25, 1993) | https://groups.psych.northwestern.edu/gentner/papers/GentnerRattForbus93.pdf | Listed | That reminding follows surface and soundness follows structure, which gives the echo rule |
| Graesser, Singer and Trabasso (first names not shown in the listing I saw) | "Constructing inferences during narrative text comprehension" (*Psychological Review* 101(3), 1994) | https://centre-alain-savary.ens-lyon.fr/CAS/documents/frederique-m/graessersingertrabasso.pdf | Listed | That readers search for an explanation of why events occur |
| Roese and Vohs (first names not shown in the listing I saw) | "Hindsight bias" (*Perspectives on Psychological Science*, 2012) | https://carlsonschool-d8.prd.umn.edu/sites/carlsonschool.umn.edu/files/2019-04/roese_vohs_hindsight_bias_2012_pps_0.pdf | Listed | That recall of foresight is not evidence the plant worked |
| R. J. Gerrig | "Suspense in the absence of uncertainty" (*Journal of Memory and Language* 28(6), 1989) | https://researchconnect.stonybrook.edu/en/publications/suspense-in-the-absence-of-uncertainty/ | Listed | That suspense can survive a known outcome |
| Garrett and colleagues (first author as given in the summary) | "The brain adapts to dishonesty" (*Nature Neuroscience* 19, 2016) | https://www.nature.com/articles/nn.4426 | Listed | That repeated dishonesty adapts the brain's response and predicts escalation |
| Miguel Sicart | "Against Procedurality" (*Game Studies* 11(3), 2011) | https://gamestudies.org/1103/articles/sicart_ap | Listed (the page refused the connection) | The critique that rules frame play and meaning arises in playing |
| Peinado and colleagues; a *Computational Linguistics* review | A rational reconstruction of MINSTREL (2006); a review of BRUTUS (2000) | https://www.fdi.ucm.es/profesor/fpeinado/publications/2006-peinado-minstrel.pdf; https://aclweb.org/anthology/J00-4007.pdf | Listed | That older generators made a theme the engine of generation |

**Works used from summaries, with no link I could verify.** They taught us through the summaries named in §3.2 and should be credited once opened, or through the work that cited them: Trabasso and Sperry 1985; Trabasso and van den Broek 1985; Brewer and Lichtenstein 1982; Skowronski and Carlston 1987; Mende-Siedlecki, Baron and Todorov 2013; Mischel and Shoda 1995; Welsh et al. 2015; Haehner et al. 2025; Leavitt and Christenfeld 2011; Johnson and Rosenbaum 2015; Fischhoff 1975; McAdams and Adler et al. 2015; Hartmann, Toz and Brandon 2010; Forster 1927; Hocking 2007; Egri 1946; Truby 2007; Bogost 2007; Anderson's thesis; and Turner's MINSTREL and Bringsjord and Ferrucci's BRUTUS themselves.
