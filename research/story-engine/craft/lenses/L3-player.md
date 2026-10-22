# Lens L3: the player

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise.

PARTIAL: interrupted at 25 fields; remaining areas: none left in the planned list (all 25 fields, cross-field tensions and rejected list are written), but no final proofreading pass or re-verification of [mem]-tagged citations was done.

**Method note.** Written on 22 October 2026 as one independent lens, without reading the repository or any other lens output. I ran about 85 web searches (a summarising search tool, not a raw index) and about 25 page or PDF fetches. Roughly 15 of the fetches returned usable text; PDFs were converted locally with `pdftotext`. Searches covered attention and inattentional blindness, retrospective evaluation (peak-end), event cognition, schema and distinctiveness, curiosity, expectation and habituation, self-determination and player-type models, apophenia and statistical learning, procedural-variety critiques, transportation and immersion, agency and choice, causality and animacy, confabulation, trust in adaptive systems, pacing, emergent narrative, rumour, community analysis, and games user research. Evidence tags: **[sec]** means the claim rests only on a search-tool summary and I did not read the source text. **[mem]** means I cite it from memory and did not re-check it this session. Untagged claims come from text I read this session (an abstract, article page or PDF). Gaps: the GDC Vault is paywalled, so the *Hades* dialogue mechanism is unverified. The Loewenstein 1994 PDF is image-only, so I relied on abstracts. Most evidence is lab-based, and almost none of it studies generated narrative content directly. That is itself a finding for the design: the claims below are hypotheses to test, not laws.

## Index

| # | Field | Relevance (confidence) | Surprise |
|---|---|---|---|
| 1 | Inattentional blindness, change blindness, attentional set | core (high on direction, medium on magnitude) | no |
| 2 | Gist, ensembles, guided search, selective listening | core (medium-high) | yes |
| 3 | Peak-end rule and duration neglect | core (medium-high) | no |
| 4 | Event segmentation and situation models | supporting (medium) | yes |
| 5 | Schema, distinctiveness, reconstructive memory | supporting (medium) | no |
| 6 | Being noticed: self-reference effect and perceived responsiveness | core (medium) | yes |
| 7 | Curiosity and information-gap theory | core (medium-high) | no |
| 8 | Expectation, surprise, the Goldilocks effect | supporting (medium) | yes |
| 9 | Habituation, hedonic adaptation, boredom | core (high) | no |
| 10 | Unfinished tasks, goal commitment, the quest log | supporting (medium) | no |
| 11 | Self-determination theory and reactance | core (medium-high) | no |
| 12 | Player typologies, motivation models, player modelling | supporting (medium) | no |
| 13 | Apophenia, illusory patterns, statistical learning (template detection) | core (medium-high on mechanism) | yes |
| 14 | Perceptual uniqueness in procedural content | core (high on principle, low on quantitative evidence) | no |
| 15 | Narrative transportation, engagement, immersion | supporting to core (medium) | no |
| 16 | Agency, perceivable consequence, choice poetics | core (high on constructs, medium on effect sizes) | no |
| 17 | Perceived causality, animacy, intention; legible agents | core (medium-high) | yes |
| 18 | Confabulation, choice blindness, hindsight bias | supporting (medium) | yes |
| 19 | Trust, perceived manipulation, algorithm aversion, dark patterns | core (medium) | yes |
| 20 | Affective pacing, tension, suspense | core (medium-high) | no |
| 21 | Emergent narrative and player-authored stories | core (medium) | no |
| 22 | Rumour, hearsay, social transmission | supporting (medium-low) | yes |
| 23 | Player-community analysis | supporting (medium) | no |
| 24 | Games user research and believability evaluation | core as method (high) | partly |
| 25 | Perception of randomness and probability | supporting (medium) | yes |

---

## A. Perception and attention

### 1. Inattentional blindness, change blindness and attentional set

**Definition.** People fail to notice fully visible things when attention is committed elsewhere, and fail to notice changes that happen without an attention-grabbing transient. What does get noticed depends on how well it fits the observer's current task set.

**Why it matters here.** Staged content only exists for the player if it is noticed. In a busy street the player is on a route, a fight, a phone call or a loot scan, so "visible" is not "seen". Two consequences follow. A hook has to be designed for the noticing rate, not the visibility. And much of the per-passer-by simulation detail will never be consciously perceived, so identity swaps or level-of-detail transitions for non-focal people may be cheap, provided the meaning of the scene is preserved.

**Key sources.**
- Simons & Chabris 1999, "Gorillas in our midst", *Perception* 28:1059-1074, doi 10.1068/p281059.
- Most, Scholl, Clifford & Simons 2005, "What you see is what you set", *Psychological Review* 112(1):217-242, doi 10.1037/0033-295x.112.1.217 (attentional set).
- Simons & Levin 1998, "Failure to detect changes to people during a real-world interaction", *Psychonomic Bulletin & Review* 5(4):644-649 ([record](https://experts.illinois.edu/en/publications/failure-to-detect-changes-to-people-during-a-real-world-interacti/)).
- Drew, Võ & Wolfe 2013, "The invisible gorilla strikes again", *Psychological Science* ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3964612/)).
- Mack & Rock 1998, *Inattentional Blindness*, MIT Press [mem].

**Instance.** In Simons & Levin's field study a stranger asking for directions was swapped for a different person mid-conversation. Only about half of pedestrians noticed, and those from the experimenters' own social group noticed more [sec]. Drew et al. put a gorilla image about 48 times the size of a typical nodule into a lung-scan task. 83% of 24 radiologists missed it, and eye tracking showed most of the misses had looked at its location [sec].

**Principles (testable).**
1. A hook that does not match the player's current task set is noticed far less often than its visibility suggests. Plant an unexpected NPC event while players pursue a task, and measure noticing against a no-task baseline.
2. Unexpected items are noticed more when they share features with what the player is already attending to (Most et al.). A hook that echoes the faction, district or object the player is currently tracking should be noticed more than an equally salient unrelated one.
3. A swap of surface identity for a non-focal NPC that keeps its role in the scene goes undetected by a large share of players. This is testable, and it bounds how much identity continuity the system must pay for.

**Failure modes.** The "half missed it" headline is an aggregate over conditions that varied difficulty and similarity, and popular readings ("you can't multitask") overreach [sec]. Free-moving 3D play with controllers is not a controlled video, so magnitudes will differ. Expectation, practice and arousal change the rates. The finding supports budgeting for noticing, not a claim about any particular rate in Night City.

**Relevance.** Core. High confidence on direction, medium on magnitude in games. **Surprise:** no (the gorilla is famous), but the attentional-set and change-blindness corollaries are rarely applied to hook design.

---

### 2. Gist, ensembles, guided search and selective listening

**Definition.** Scenes are perceived as gist plus summary statistics ("ensemble" coding). Individual items rise out of the crowd only when attention is guided to them by salience, task features, scene meaning, search history or value. Hearing works similarly: you follow one stream, and a few high-value signals (your own name) can break through.

**Why it matters here.** A crowd is perceived as a texture, so a passer-by simulated down to "what one person is worried about" is invisible unless the presentation routes through a guidance factor: motion onset, a gaze, a word, a prop the player has reason to care about. Overheard speech is probably the cheapest channel for city-scale facts to reach a player, but noticing depends on load.

**Key sources.**
- Alvarez 2011, "Representing multiple objects as an ensemble enhances visual cognition", *Trends in Cognitive Sciences* 15(3):122-131 ([PDF](https://scholar.harvard.edu/alvarez/files/alvarez-2011-tics-ensemble.pdf)).
- Wolfe & Horowitz 2017, "Five factors that guide attention in visual search", *Nature Human Behaviour* 1:0058, doi 10.1038/s41562-017-0058 [sec].
- Conway, Cowan & Bunting 2001, "The cocktail party phenomenon revisited", *Psychonomic Bulletin & Review* 8:331-335, doi 10.3758/BF03196169 ([PDF](https://memory.psych.missouri.edu/assets/doc/articles/2001/conway-et-al-pbr-2001.pdf)).
- Röer & Cowan 2020, preregistered replication of own-name capture ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8908911)) [sec].
- Cherry 1953; Moray 1959 [mem].

**Instance.** Wolfe & Horowitz name five guidance factors: bottom-up salience, top-down feature guidance, scene structure and meaning, search history over milliseconds to years, and the relative value of targets and distractors [sec]. Roughly a third of listeners report hearing their own name in an ignored channel, and those who do tend to have lower working-memory capacity, which suggests weaker focus rather than better monitoring (Conway et al.) [sec on the figure; the finding is in the abstract I read about].

**Principles (testable).**
1. Adding one guidance factor (a gaze at the player, a motion onset, a word the player recently heard) raises the chance a given NPC is individually noticed and remembered. Measure with gaze logging plus recall.
2. Overheard speech that contains something tied to the player's own history (a name, a faction, a place they just left) is picked up more than equally audible generic speech, and pickup is higher in low-load moments (idle walking, driving) than in combat. Schedule overheard hooks into low-load windows.
3. Perceived crowd diversity is judged on the ensemble statistics of the attended dimensions (silhouette, colour, motion), not on hidden attributes. Spend variation where the ensemble is read.

**Failure modes.** Mostly lab visual search and dichotic listening. Own-name capture is a minority effect and may reflect lapses of control rather than a general tendency. Load theory itself is contested: some argue salience, not load, drives distraction [sec]. Game audio mixing, voice over music and subtitles change everything.

**Relevance.** Core. Medium-high. **Surprise:** yes.

---

## B. Memory

### 3. Peak-end rule and duration neglect

**Definition.** Retrospective evaluation of an episode is dominated by its most intense moment and its ending, with length contributing little.

**Why it matters here.** Players will remember a multi-hour heist as a handful of snapshots, and a street encounter as its resolution. Most generated content ends by despawning or by the player walking away, which is the worst possible end beat. Budget craft where memory looks: a deliberate, consequential ending beat, a high point, and no flat final stretch.

**Key sources.**
- Fredrickson & Kahneman 1993, "Duration neglect in retrospective evaluations of affective episodes", *JPSP* 65(1):45-55 ([PDF](https://bear.warrington.ufl.edu/brenner/mar7588/Papers/fredr-kahneman-jpsp1993.pdf)).
- Kahneman, Fredrickson, Schreiber & Redelmeier 1993, "When more pain is preferred to less", *Psychological Science* 4(6):401-405 [mem for authors and pages; the finding appears in search summaries] [sec].
- Alaybek et al. 2022, meta-analysis of the peak-end rule, *Organizational Behavior and Human Decision Processes* 170 ([abstract](https://ideas.repec.org/a/eee/jobhdp/v170y2022ics0749597822000334.html)) [sec].
- Gutwin, Rooke, Cockburn, Mandryk & Lafreniere 2016, "Peak-end effects on player experience in casual games", CHI 2016, doi 10.1145/2858036.2858419 [sec].

**Instance.** In Fredrickson & Kahneman's studies (32 and 96 participants) effects of film duration on retrospective evaluation were small and explained by real-time affect, consistent with a weighted average of "snapshots". In Gutwin et al., manipulating difficulty sequences in casual games produced strong peak-end effects on recalled challenge, while effects on fun and preference to repeat were mixed, sometimes significant and never against the hypothesis [sec].

**Principles (testable).**
1. With total content held constant, giving a systemic encounter a clear ending beat with a visible consequence raises its remembered rating more than lengthening it.
2. For a long heist, remembered quality tracks its best moment and its last stretch. A weak final ten minutes lowers the retrospective rating even when the earlier hours were identical.
3. Where nothing peaks, duration can be cut with little loss in remembered value. Cut the flat middle first.

**Failure modes.** The meta-analysis found the peak-end score predicts about as well as the plain average, so "peak-end" may add little over mean experience [sec]. Duration neglect seems limited to unfamiliar experiences and weakens when people have a standard for judging time [sec]. Most evidence is short, passive, lab episodes. Games showed mixed effects on enjoyment. Players also act on live experience (quitting, continuing), not only on remembered evaluation.

**Relevance.** Core. Medium-high. **Surprise:** no.

---

### 4. Event segmentation and situation models

**Definition.** People automatically parse ongoing activity into nested events, and comprehension builds a situation model (who, where, when, why, what caused what). Story understanding is largely inferring causal links between events.

**Why it matters here.** The system chooses where encounters start and end, and the player's own segmentation may not match. Boundaries (a loading screen, a fast travel, a district edge, a change in who wants what) can reset the model, so a hook that depends on a detail from before a boundary may need re-cueing. Players also try to link separate events causally, so a generated event with one visible cause from the player's own recent action is integrated far more readily than a context-free one.

**Key sources.**
- Zacks & Swallow 2007, "Event segmentation", *Current Directions in Psychological Science* 16(2):80-84 [sec].
- Zwaan & Radvansky 1998, "Situation models in language comprehension and memory", *Psychological Bulletin* 123(2):162-185 ([PDF](https://cs.uky.edu/~sgware/reading/papers/zwaan1998situation.pdf)).
- Trabasso & van den Broek 1985, causal network model of story events, *Journal of Memory and Language* 24 [mem].
- Radvansky & Copeland 2006, doorway effect, *Memory & Cognition* 34:1150-1156 [sec]; Radvansky & Zacks 2014, *Event Cognition*, OUP [mem].

**Instance.** The doorway effect (walking through a door causes forgetting of what was in the previous room) is the popular face of this field. A four-experiment conceptual replication (virtual reality with and without memory load, video, real walking) found no significant doorway effect on forgetting, only more false alarms in the VR condition under load (McFadyen et al. 2021, *BMC Psychology*, [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7938580)).

**Principles (testable).**
1. Segmentation tracks changes in actors' goals and causes as well as sensory change, so aligning system-defined encounter boundaries to goal changes will produce more agreement between the system's and the player's sense of "one thing happened" than timer-based boundaries.
2. A hook that requires a detail from before a boundary is understood more often if the detail is re-cued after it. Test with recall probes across a transition, and do not expect large effects outside high-load conditions.
3. A generated event with one visible cause drawn from the player's recent action is integrated into the player's account of what happened more often than the same event without a cause cue.

**Failure modes.** The doorway effect has a patchy replication record, so build on the event-boundary idea with caution and measure locally. Event-segmentation findings come mostly from passive viewing and reading. Interactive agents and map UIs blur boundaries. Causal-network models come from text comprehension.

**Relevance.** Supporting. Medium. **Surprise:** yes.

---

### 5. Schema, distinctiveness and reconstructive memory

**Definition.** Memory is reconstructive and schema-driven: expected content is "remembered" whether or not it was present, and the distinctive or schema-violating item is what sticks (the von Restorff or isolation effect).

**Why it matters here.** Setting-true texture is, by design, schema-congruent. That is what makes a street believable and what makes it nearly unmemorable. The stories players retell come from violations of the schema. Memory also merges: two similar encounters collapse into "that one thing the game always does". And players will misremember what the game actually did, filling in causes. Budget distinctiveness deliberately: a few scenes get isolated, attended oddities, and the rest stay congruent.

**Key sources.**
- Bartlett 1932, *Remembering*, Cambridge University Press [mem].
- Brewer & Treyens 1981, "Role of schemata in memory for places", *Cognitive Psychology* 13:207-230 [sec for details].
- Hunt 1995, "The subtlety of distinctiveness: What von Restorff really did", *Psychonomic Bulletin & Review* 2(1):105-112, doi 10.3758/BF03214414 [sec].
- Loftus & Palmer 1974, *Journal of Verbal Learning and Verbal Behavior* 13:585-589 [mem].

**Instance.** In Brewer & Treyens, people waiting in a room made up as a professor's office recalled schema-fitting objects (chair, desk) far better than odd ones (an anatomical skull), and some reported books that were not there [sec; the sources disagree on sample sizes].

**Principles (testable).**
1. Schema-congruent generated texture will be recalled as "the generic". In free recall after a session it will contribute almost nothing to remembered distinctiveness.
2. A single distinctive element, isolated on a dimension the player attends to, is recalled far more than the same element among equally odd neighbours.
3. After a delay, players report schema-consistent details and causes that were not present. Recall-based audits ("did you see X?") therefore over-report. Log what was actually shown.

**Failure modes.** The isolation effect needs attention on the isolated item and has subtle boundary conditions (Hunt) [sec]. The "office" study's recognition and recall results are described differently in different summaries [sec]. These are short-delay lab results. Effect sizes for post-event misinformation vary.

**Relevance.** Supporting. Medium. **Surprise:** no.

---

### 6. Being noticed: self-reference effect and perceived responsiveness

**Definition.** Information tied to the self is encoded and recalled better than other information. Separately, people feel valued and understood when another party responds in a way that shows understanding, validation and care ("perceived partner responsiveness").

**Why it matters here.** "Relevant to the player's own history" is two different effects. One is a memory advantage; the other is a feeling of being responded to. Both can be triggered cheaply by a callback using the player's own specific act, but the second requires the response to show what the act meant to the other party, not merely to quote the event. A line that restates a log entry is data. A line that reflects the player's style of acting is responsiveness.

**Key sources.**
- Rogers, Kuiper & Kirker 1977, "Self-reference and the encoding of personal information", *JPSP* 35(9):677-688.
- Symons & Johnson 1997, "The self-reference effect in memory: a meta-analysis", *Psychological Bulletin* 121(3):371-394, doi 10.1037/0033-2909.121.3.371 [sec].
- Reis & Shaver 1988, interpersonal process model of intimacy [mem].
- Reis, Clark & Holmes 2004, "Perceived partner responsiveness as an organizing construct", in *Handbook of Closeness and Intimacy*, pp. 201-225 [sec].

**Instance.** Across two experiments, adjectives judged for self-description were recalled better than adjectives processed structurally, phonemically or semantically (Rogers et al.) [sec]. The meta-analysis found a smaller advantage when the comparison tasks also encouraged organisation and elaboration, so much of the effect is plain elaboration [sec].

**Principles (testable).**
1. A line referencing a specific, verifiable player act is recalled a week later more often than an equally informative line referencing a population fact.
2. A response that reflects how the player did something (stealthily, loudly, generously) is rated as more "noticing me" than one that restates what happened.
3. Callback formats habituate (see field 9). Rotate the channel (a radio mention, a rumour, an NPC's change in behaviour) and not only the wording.

**Failure modes.** The self-reference advantage is partly an elaboration effect, so a bare "you" will not do. The responsiveness literature is about close relationships and may transfer weakly to NPCs. There is a boundary the literature does not locate: when specific recall of the player's history tips from "noticed" into "watched" (see field 19).

**Relevance.** Core. Medium. **Surprise:** yes.

---

## C. Curiosity, expectation, novelty

### 7. Curiosity and information-gap theory

**Definition.** Curiosity arises when a person perceives a gap between what they know and what they want to know, and it acts like a mild deprivation that motivates seeking the answer.

**Why it matters here.** An offer works only if a question exists in the player's head. Gaps require some prior knowledge to be perceived, so a hook with no anchor does nothing. And a gap the player senses the system cannot fill (generated content with no depth behind it) teaches the player not to bite next time.

**Key sources.**
- Loewenstein 1994, "The psychology of curiosity", *Psychological Bulletin* 116(1):75-98 ([record](https://stafforini.com/works/loewenstein-1994-psychology-curiosity-review/)).
- Kidd & Hayden 2015, "The psychology and neuroscience of curiosity", *Neuron* 88:449-460, doi 10.1016/j.neuron.2015.09.010 ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4635443)) [sec].
- Brewer & Lichtenstein 1982, structural-affect theory of stories (suspense, curiosity, surprise), *Journal of Pragmatics* 6:473-486 [mem].
- Gruber, Gelman & Ranganath 2014, *Neuron* [sec; as cited in a secondary summary].

**Instance.** Loewenstein's account treats curiosity as cognitively induced deprivation arising from a perceived knowledge gap, and also explains why satisfying curiosity often disappoints [sec]. Kidd & Hayden use "a drive state for information" as a working definition [sec].

**Principles (testable).**
1. Hook strength depends on a specific question the player can already formulate from facts they hold. A precise unanswered question outpulls a vague mystery. A/B test hint wording against follow-through.
2. Partial reveals increase pull only when the player knows enough to know what is missing.
3. A payoff thinner than the gap it implied lowers follow-through on the next hook. Measure follow-through on a second hook after a thin versus a rich first payoff.

**Failure modes.** Information-gap is one account among several (learning progress, compression progress, reward prediction). The "aversive state" claim has mixed support. Neuroimaging claims are thin. Related Zeigarnik-style claims have replicated poorly (field 10).

**Relevance.** Core. Medium-high. **Surprise:** no.

---

### 8. Expectation, surprise and the Goldilocks effect

**Definition.** Attention and pleasure peak when events are neither fully predictable nor fully unpredictable relative to a learned model, and surprise is prediction error against that model.

**Why it matters here.** Players learn the generator's model quickly (field 13). Beyond that point, outputs are predictable and attention drifts. Wholly random output is incomprehensible. The player's own history is also their predictive model, so the system has to steer variety to the intermediate band for this player, which means tracking exposures.

**Key sources.**
- Kidd, Piantadosi & Aslin 2012, "The Goldilocks effect", *PLoS ONE* ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3359326)).
- Berlyne 1970, "Novelty, complexity, and hedonic value", *Perception & Psychophysics* 8:279-286 [sec].
- Huron 2006, *Sweet Anticipation*, MIT Press [mem].
- Itti & Baldi 2009, "Bayesian surprise attracts human attention", *Vision Research* 49(10):1295-1306 ([record](https://ilab.usc.edu/publications/Itti_Baldi09vr.html)) [sec].

**Instance.** In two experiments with 7- and 8-month-old infants (42 and 30 analysed), looking away was most likely for very simple and very complex sequences, with a U-shaped relation to model-defined complexity and a peak preference near 1.25 bits in Experiment 1. Itti & Baldi report that 72% of gaze shifts landed on locations more surprising than average [sec].

**Principles (testable).**
1. Engagement with a repeated encounter type follows an inverted U against its predictability to that player. Estimate predictability from prior exposures and plot engagement against it.
2. A twist lands only if the player has had enough exposures to form the expectation it breaks.
3. Variation on dimensions the player does not track does not relieve predictability.

**Failure modes.** Infant looking time is far from adult game engagement. Berlyne's inverted U has mixed support, and complexity is multidimensional [sec]. "Complexity" here is relative to a model of the observer, which is only available to the system if it builds a player model.

**Relevance.** Supporting. Medium. **Surprise:** yes.

---

### 9. Habituation, hedonic adaptation and boredom

**Definition.** Habituation is a response decrement from repeated stimulation that is not sensory or motor fatigue, and it is stimulus-specific: a change restores the response (dishabituation). Hedonic adaptation is the fading of affective reaction to constant conditions. Boredom is an aversive state of wanting but being unable to engage in satisfying activity, tied to attention failure and attributed to the environment.

**Why it matters here.** Repetition is the radiant quest's signature failure, and this field supplies the sharpest testable form of it. Habituation is specific to the repeated feature. Varying a feature the player has not habituated to will not restore interest, while varying the one they have will. Boredom is also a state: over-familiar content and under-challenge feel the same from inside.

**Key sources.**
- Rankin et al. 2009, "Habituation revisited", *Neurobiology of Learning and Memory* 92:135-138 [sec].
- Frederick & Loewenstein 1999, "Hedonic adaptation", in Kahneman, Diener & Schwarz (eds), *Well-Being*, pp. 302-329 [mem].
- Eastwood, Frischen, Fenske & Smilek 2012, "The unengaged mind", *Perspectives on Psychological Science* 7(5) [sec].

**Instance.** Fallout 4's Minutemen quest-giver, whose repeated "another settlement needs your help" requests were being photoshopped and mocked within weeks of launch ([Know Your Meme](https://amp.knowyourmeme.com/memes/another-settlement-needs-our-help)) [sec]. The complaint is about the skeleton (who asks, what is asked), not the particular settlement.

**Principles (testable).**
1. Response to a repeated encounter template falls with exposures and recovers when the habituated feature changes, but not when an irrelevant feature changes. A/B test feature-specific variation.
2. Habituation is fastest on the delivery channel (the same voice, the same radio crackle, the same map ping). Rotate channels, not only content.
3. Reported boredom tracks attention failure, so players can be bored by both over-familiar content and too-easy content. Measure both exposure count and challenge.

**Failure modes.** Habituation is a neural and behavioural concept, and applying it to narrative templates is an analogy until tested. Hedonic adaptation is partial and varies by circumstance and person. Novelty alone is not interest (see field 14).

**Relevance.** Core. High. **Surprise:** no.

---

### 10. Unfinished tasks, goal commitment and the quest log

**Definition.** The Ovsiankina effect is a tendency to resume interrupted tasks. The Zeigarnik effect is a claimed memory advantage for unfinished tasks. The goal-gradient effect is rising effort as a goal nears.

**Why it matters here.** Every offer is an open loop. If unfinished tasks did not stick in memory, ignored offers cost the player nothing and can lapse silently. Started tasks still pull the player back. That separates "offered" from "accepted" sharply, and shapes how many concurrent threads the log should ask the player to carry.

**Key sources.**
- Ghibellini & Meier 2025, meta-analysis, *Humanities and Social Sciences Communications* 12, doi 10.1057/s41599-025-05000-w ([abstract](https://ideas.repec.org/a/pal/palcom/v12y2025i1d10.1057_s41599-025-05000-w.html)).
- Zeigarnik 1927, *Psychologische Forschung* 9 [mem]; Ovsiankina 1928 [mem].
- Kivetz, Urminsky & Zheng 2006, "The goal-gradient hypothesis resurrected", *Journal of Marketing Research* 43(1) [mem].

**Instance.** The meta-analysis found no memory advantage for unfinished tasks but a general tendency to resume them, and noted the memory effect "has proven particularly difficult to replicate". Secondary coverage gives a resumption rate near 67% across 37 studies [sec].

**Principles (testable).**
1. Players resume started activities at a rate well above chance but do not recall unstarted offers better than completed ones. Let unaccepted offers lapse silently and never leave a started thread without a path to a close.
2. Visible partial progress on a multi-part job raises persistence near the end. Test with and without progress cues.
3. Each added open loop costs planning attention. Cap concurrent loops and measure abandonment against loop count.

**Failure modes.** The Zeigarnik memory claim is the standard "psychology of game design" talking point and it does not hold up. Resumption evidence comes from trivial lab tasks under an experimenter's authority. Goal-gradient evidence comes from loyalty cards and animals. Voluntary quests differ, and completionism varies by player (field 12).

**Relevance.** Supporting. Medium. **Surprise:** no.

---

## D. Motivation and player models

### 11. Self-determination theory and psychological reactance

**Definition.** Motivation and wellbeing depend on satisfying autonomy, competence and relatedness. Perceived pressure to act a certain way threatens freedom and provokes resistance (reactance).

**Why it matters here.** The brief says the player is never controlled and the system only observes and offers. SDT supplies the player-side reason: perceived autonomy is among the strongest predictors of enjoyment, and an offer felt as pressure (a nagging marker, a repeated prompt, a quest-giver who will not stop) undermines it. Competence says offers must match demonstrated skill. Relatedness says NPC relationships should be earned by what the player did.

**Key sources.**
- Ryan, Rigby & Przybylski 2006, "The motivational pull of video games", *Motivation and Emotion* 30(4):347-363, doi 10.1007/s11031-006-9051-8 [sec].
- Przybylski, Rigby & Ryan 2010, "A motivational model of video game engagement", *Review of General Psychology* 14(2):154-166, doi 10.1037/a0019440 [sec].
- Deci & Ryan 2000, *Psychological Inquiry* 11(4):227-268 [mem]; Brehm 1966, *A Theory of Psychological Reactance* [mem].

**Instance.** Across four studies, perceived in-game autonomy and competence tracked enjoyment, game preference and future play, and related to presence and immersion [sec].

**Principles (testable).**
1. An offer the player can decline at no cost and that is never repeated produces more follow-through, and higher reported autonomy, than the same offer with persistent reminders.
2. Offers that arise from the player's own actions satisfy autonomy more than assigned ones.
3. Offers calibrated to demonstrated skill sustain competence ratings better than fixed-difficulty offers.

**Failure modes.** SDT is broad and hard to falsify. Game studies are self-report and often small. Reactance effects depend on how strongly freedom is perceived as threatened. Trivial choices do not satisfy autonomy (Katz & Assor 2007 [mem]).

**Relevance.** Core. Medium-high. **Surprise:** no.

---

### 12. Player typologies, motivation models and player modelling

**Definition.** Taxonomies of why people play (Bartle, Yee and the Quantic Foundry model, BrainHex, Hexad) and methods that infer an individual's preferences from behaviour to adapt content.

**Why it matters here.** The system must decide what to offer a particular person, which needs a model of that person. The literature says the typologies overlap, were built on thin empirical grounds, and collapse to a few continuous dimensions. The practical lesson is to model behaviour, not types, and to guard against the self-fulfilling loop where the model only offers what was taken before.

**Key sources.**
- Bartle 1996, "Hearts, clubs, diamonds, spades" ([background](https://mud.co.uk/richard/hcdsbg.htm)); Yee's critique ([page](https://nickyee.com/facets/bartle.html)) [sec].
- Quantic Foundry, Gamer Motivation Model: 12 motivations in six clusters, built by factor analysis of survey data ([methods post](https://quanticfoundry.com/2015/07/20/how-we-developed-the-gamer-motivation-profile-v2/)) [sec].
- Hamari & Tuunanen 2014, "Player types: a meta-synthesis", *ToDiGRA* 1(2), doi 10.26503/todigra.v1i2.13 (seven dimensions) [sec].
- Kirchner-Krath et al. 2024, "Uncovering the theoretical basis of user types" ([page](https://researchportal.tuni.fi/en/publications/uncovering-the-theoretical-basis-of-user-types-an-empirical-analy/)); authors and venue (an HCI journal) from a search summary [sec].
- Thue, Bulitko, Spetch & Wasylishen 2007, PaSSAGE, AIIDE ([record](https://ojs.aaai.org/index.php/AIIDE/article/view/18780)).

**Instance.** Kirchner-Krath et al. surveyed 177 people with the original instruments of Bartle's types, Yee's motivations, BrainHex and Hexad. They found considerable overlap and an exploratory factor analysis reducing the four to five dimensions (socialisation, escapism, achievement, reward pursuit, independence), and recommended continuous measurement rather than fixed types. PaSSAGE's user study reported that adaptive stories raised enjoyment for certain players, notably those with low prior game experience who found the story easy to follow [sec].

**Principles (testable).**
1. Per-player history of what the player did when offered options predicts acceptance better than a typed label. Compare offer ranking by history against ranking by type.
2. Preferences are mixtures that drift with context. Model them as continuous weights with decay.
3. A model that only offers what was previously taken collapses variety. Reserve an exploration budget and measure variety over time.

**Failure modes.** Severe validity and reliability criticisms apply to the typologies [sec]. Bartle's types came from designer discussion, not data. The Quantic Foundry model is vendor-held and not openly accessible [sec]. PaSSAGE's evidence is one game with small samples [sec].

**Relevance.** Supporting. Medium. **Surprise:** no.

---

## E. Pattern detection and variety

### 13. Apophenia, illusory patterns and statistical learning (template detection)

**Definition.** Apophenia, or illusory pattern perception, is seeing design, agency or meaning in noise. Statistical learning is the implicit extraction of real regularities (including what follows what) from brief exposure, without intent or articulation.

**Why it matters here.** Both edges matter. Players will find meaning in systemic noise, which can be used with sparse, ambiguous seeding. And players detect the template, the repeating skeleton, through statistical learning long before they can say why. "Feels generated" is the verbal tip of that learning. Statistical learning works on sequential structure (transitional probabilities: what tends to follow what), so changing names and faces will not hide a fixed skeleton.

**Key sources.**
- Saffran, Aslin & Newport 1996, "Statistical learning by 8-month-old infants", *Science* 274:1926-1928 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/8943209/)) [sec].
- van Prooijen, Douglas & De Inocencio 2018, "Connecting the dots", *European Journal of Social Psychology* 48(3):320-335 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/29695889/)) [sec].
- Whitson & Galinsky 2008, *Science* 322:115-117 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/18832647/)), and van Elk & Lodder 2018, "Experimental manipulations of personal control do not increase illusory pattern perception", *Collabra: Psychology* 4(1):19 ([record](https://research.tilburguniversity.edu/en/publications/experimental-manipulations-of-personal-control-do-not-increase-il/)).
- Chun & Jiang 1998 (contextual cueing) [mem].

**Instance.** Infants segmented "words" from a continuous syllable stream after only about two minutes, using the statistical relations between neighbouring syllables [sec]. Conversely, a lack-of-control manipulation that was said to increase illusory pattern perception produced no effect in seven experiments, with Bayesian support for the null and strong evidence of publication bias in the earlier literature (van Elk & Lodder).

**Principles (testable).**
1. After a small number of exposures, players can predict the next beat in a generated chain better than chance, and call the content "templated" before they can say why. Test with "what happens next?" prediction tasks after N encounters.
2. A hidden skeleton is hidden by varying the transitional structure (order, who initiates, what is at stake, how it ends), not the skin. Compare predictability under skin-only and structural variation.
3. Ambiguous seeds invite players to build explanations, raising perceived depth, but only when at least one confirmed pattern anchors them.

**Failure modes.** The headline "lack of control increases illusory pattern perception" did not survive a seven-experiment null, so do not design to induce helplessness. Apophenia work is mostly correlational and tied to belief measures. That adults statistically learn narrative skeletons in games is inferred, not demonstrated here.

**Relevance.** Core. Medium-high on mechanism, medium on magnitudes. **Surprise:** yes.

---

### 14. Perceptual uniqueness in procedural content

**Definition.** The difference between content that is mathematically distinct and content that players perceive as different. A generator can produce 10,000 distinct outputs that are perceived as one.

**Why it matters here.** This is the named failure mode in one phrase, and it supplies the right unit: variation counts only along dimensions players perceive and categorise by. It tells the evaluation what to ask (do players sort, name or retell these as different?) and where a hand-curated set beats a large random one.

**Key sources.**
- Kate Compton, "10,000 bowls of oatmeal" ([Vice, 2016](https://www.vice.com/en/article/no-mans-sky-review/)); GDC talk write-up ([Game Developer](https://www.gamedeveloper.com/design/practical-procedural-generation-for-everyone-)).
- Emily Short 2016, "Bowls of oatmeal and text generation" ([blog](https://emshort.blog/2016/09/21/bowls-of-oatmeal-and-text-generation/)) [sec].
- Smith & Whitehead 2010, expressive range analysis, PCGames workshop [mem].

**Instance.** Compton, who worked on Spore's planet generation, kept the seeds that produced appealing planets and discarded the rest, found that faster than "proper" algorithm work, and proposed asking whether someone would write fan fiction about an object. Her point: "Perceptual uniqueness" is the real metric and it is hard to achieve.

**Principles (testable).**
1. Perceived similarity among generated encounters is governed by a few features the player has learned to track. Changing the others does not increase perceived variety. Run sorting tasks and compare player groupings with generator parameters.
2. A small set of clearly different items beats a large set of subtly different ones at equal authoring cost.
3. Curation (hand-picking seeds, templates, or outputs) beats random sampling at equal compute in blind ratings.

**Failure modes.** The core claims are practitioner testimony, not controlled studies. Expressive-range analysis measures generator output, not perception. The fan-fiction test is rhetorical. I found no verified user study of perceived variety in generated narrative content.

**Relevance.** Core. High on the principle, low on quantitative evidence. **Surprise:** no.

---

## F. Immersion, agency, causality

### 15. Narrative transportation, engagement and immersion

**Definition.** Transportation is absorption into a story, combining imagery, affect and attentional focus. Immersion in games is graded (engagement, engrossment, total immersion) and is disrupted by interface, incoherence and interruption.

**Why it matters here.** Transported players find fewer false notes, so being transported masks template failures, and a break in the spell makes everything visible at once. Street encounters last seconds and may never transport anyone, while a multi-hour heist can. Open-world play interleaves story with maps, menus and travel, so immersion is intermittent and the system should expect to re-earn it.

**Key sources.**
- Green & Brock 2000, "The role of transportation in the persuasiveness of public narratives", *JPSP* 79(5):701-721, doi 10.1037/0022-3514.79.5.701.
- Van Laer, de Ruyter, Visconti & Wetzels 2014, extended transportation-imagery model, *Journal of Consumer Research* 40(5):797-817, doi 10.1086/673383 [sec].
- Jennett et al. 2008, "Measuring and defining the experience of immersion in games", *IJHCS* 66(9):641-661 ([PDF](https://www-users.york.ac.uk/~pc530/pubs/JennettIJHCS08.pdf)) [sec].
- Busselle & Bilandzic 2009, narrative engagement scale, *Media Psychology* 12 [mem]; Brown & Cairns 2004, CHI EA [mem].

**Instance.** In Green & Brock's four experiments (N = 97, 69, 274, 258), more transported readers held more story-consistent beliefs, highly transported readers found fewer false notes, and labelling a story as fact or fiction made little difference to transportation.

**Principles (testable).**
1. Players deeply engaged in a thread detect fewer planted inconsistencies in it, and detect them again right after an interruption (menu, loading, fast travel). Plant the same inconsistency before and after an interruption.
2. Vivid, specific, imageable detail transports more than generic description. A/B test specific versus generic versions of the same scene.
3. Immersion degrades measurably at interface transitions. Track questionnaire scores and behaviour across them.

**Failure modes.** The transportation scale was built on text. Transportation, immersion, presence and flow are often conflated. Evidence is self-report and correlational. Transportation is not unambiguously good for the player (it lowers critical scrutiny).

**Relevance.** Supporting to core. Medium. **Surprise:** no.

---

### 16. Agency, perceivable consequence and choice poetics

**Definition.** Agency is the match between what the player wants to do and what the system supports, with effects the player can perceive. Choice poetics studies how the options, outcomes and goals of a choice shape the experience.

**Why it matters here.** "Consequential" needs consequences that are perceivable and attributable. An invisible consequence costs authoring effort and delivers no agency. Agency on this account is not free will; it depends on the system evoking desires it can satisfy and presenting materials for action that fit them. The system must therefore log what consequences were shown, not just what occurred.

**Key sources.**
- Church 1999, "Formal abstract design tools" ([Game Developer](https://www.gamedeveloper.com/design/formal-abstract-design-tools)).
- Wardrip-Fruin, Mateas, Dow & Sali 2009, "Agency reconsidered", DiGRA ([record](https://dl.digra.org/index.php/dl/article/view/369)).
- Murray 1997, *Hamlet on the Holodeck* [mem; summarised in the previous source].
- Mawhorter, Mateas, Wardrip-Fruin & Jhala 2014, "Towards a theory of choice poetics", FDG ([slides](https://www.cs.hmc.edu/~pmawhorter/research/slides/choice_poetics-Mawhorter_Mateas_Wardrip-Fruin_Jhala-2014.pdf)).
- Tanenbaum & Tanenbaum 2010, "Agency as commitment to meaning", *Digital Creativity* [sec]; Mateas & Stern 2003, Façade ([paper](https://users.soe.ucsc.edu/~michaelm/tenurereview/publications/mateas-tidse2003.pdf)).

**Instance.** Church (16 July 1999) defines perceivable consequence as a clear reaction from the game world to the player's action, and says players must be able to see why something worked or failed in order to adjust. He argues scripted drama competes with intention. Wardrip-Fruin et al. add that agency occurs when the actions players desire are among those they can take, as supported by an underlying model, and that Façade's requirements included characters whose internal states are interpretable through performance. Critics argue many Telltale choices converge ("same result, different dialogue") [sec].

**Principles (testable).**
1. Agency is felt when the player's intended action is among those the system supports and its effect is visible within the scene. Ask players what they meant to do and whether they saw it work.
2. A consequence delivered later is attributed to the player's act only if the link is legible (a cause cue plus time proximity or a memorable marker).
3. Local agency (within a scene) and global agency (across an arc) separate. A seconds-long encounter can deliver the first alone, so avoid promising that everything matters.

**Failure modes.** Agency is a contested construct. The Tanenbaums' reframing is criticised as overbroad [sec]. Choice poetics is a descriptive framework with little measurement. Whether revealed "illusion of choice" erodes enjoyment is unsettled, and agency measurement is mostly self-report.

**Relevance.** Core. High on constructs, medium on effect sizes. **Surprise:** no.

---

### 17. Perceived causality, animacy and intention; legible agents

**Definition.** Perception reads launching, causation, life and goals directly from motion and timing (Michotte's causal impressions, Heider-Simmel animacy). Game AI craft exploits this by making an NPC's intent legible through tells, barks and performance.

**Why it matters here.** "Feels caused" runs on automatic machinery: initiation of movement, speed changes and turning away from obstacles are read as goals. A passer-by's worry can be made legible with a few cues, cheaper than simulating it deeper. Contiguity matters too: a world event whose cause is offscreen needs a cause cue inside the player's sensory field.

**Key sources.**
- Michotte 1946/1963, *The Perception of Causality* [mem]; Heider & Simmel 1944, *American Journal of Psychology* 57:243-259 [sec].
- Scholl & Tremoulet 2000, "Perceptual causality and animacy", *Trends in Cognitive Sciences* 4(8):299-309 ([Yale demo page](https://perception.yale.edu/Brian/demos/Causality-Basics.html)) [sec].
- Bates 1994, "The role of emotion in believable agents", *CACM* 37(7):122-125, doi 10.1145/176789.176803.
- Orkin 2006, "Three states and a plan" ([GDC Vault](https://www.gdcvault.com/play/1013459/Three-States-and-a-Plan)) [sec]; Isla on Halo AI, GDC 2005 and later [sec]; Mateas & Stern 2003.

**Instance.** Viewers of simple moving shapes narrate chases and fights rather than motion, and the impression is described as automatic and hard to resist [sec]. In F.E.A.R., commentary reports that shouting for backup made players believe reinforcements had been called although the squad was always present, and that cover placement made moves read as flanks [sec].

**Principles (testable).**
1. A short telegraph of intent (a bark, a glance, a change of direction) makes players attribute plans to an NPC, and the same behaviour without a telegraph is read as random. Run viewing studies.
2. Perceived cause depends on visible cause within a short time and distance. A world event with its cause offscreen needs an in-field cue (a witness, a radio line). Test with and without the cue.
3. An NPC acting on a believed-but-wrong model of the player reads as more intelligent than an NPC that knows everything (Isla) [sec].

**Failure modes.** Animacy results use simple shapes and brief displays. Players who learn the trick may collapse the impression (F.E.A.R. critics) [sec]. Too much legibility reads as cartoonish. Cues vary by culture and by player expertise.

**Relevance.** Core. Medium-high. **Surprise:** yes.

---

### 18. Confabulation, choice blindness and hindsight bias

**Definition.** People give confident causal accounts of their own choices without access to the real cause. They sometimes fail to notice a mismatch between what they chose and what they were given, and then defend the swapped result. After learning an outcome, they judge it as having been foreseeable.

**Why it matters here.** A system that decides the "why" late (when a player first looks) will be accepted as long as the explanation is consistent with what the player has seen, and in hindsight will feel set up. That is a design lever and an ethical edge (field 19). It also warns researchers: what players say about why they did something is an inference, so measure behaviour.

**Key sources.**
- Nisbett & Wilson 1977, "Telling more than we can know", *Psychological Review* 84(3):231-259 ([record](https://deepblue.lib.umich.edu/items/c810051d-bb3a-48c7-86ae-da8ef48caa77)).
- Johansson, Hall, Sikström & Olsson 2005, *Science* 310:116-119, doi 10.1126/science.1111709 [sec].
- Hall, Johansson, Tärning, Sikström & Deutgen 2010, "Magic at the marketplace", *Cognition* 117(1):54-61 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/20637455/)) [sec].
- Fischhoff 1975, *JEP: Human Perception and Performance* 1(3):288-299 [mem]; Roese & Vohs 2012, "Hindsight bias", *Perspectives on Psychological Science* 7(5):411-426 [sec].

**Instance.** In choice blindness, participants picked the more attractive of two faces, a card trick swapped the choice, and most did not notice and gave reasons for the face they had not chosen [sec]. In a supermarket tasting booth, only about a third or fewer of manipulated jam and tea trials were detected [sec].

**Principles (testable).**
1. A just-in-time explanation for an observed event is accepted as the real cause when it fits everything the player has observed, with low detection. Change the stated cause between sessions and ask for the cause.
2. After an outcome is known, players judge it as having been foreshadowed, so after-the-fact seeding reads as foreshadowing. Compare ratings of seeded and unseeded versions with timestamps.
3. Players' stated reasons for preferences predict behaviour poorly. Compare stated reasons with logged choices.

**Failure modes.** Detection rates depend on stimulus similarity, speed and stakes. Lab tasks use strangers and trivial choices. Hindsight effect sizes vary. No games-specific study was found. Using this to rewrite what the player actually did would breach trust (field 19).

**Relevance.** Supporting. Medium. **Surprise:** yes.

---

## G. Trust, pacing, stories

### 19. Trust, perceived manipulation, algorithm aversion and dark patterns

**Definition.** How people react to systems they suspect of covertly steering them: aversion to algorithms after visible errors, perceived fairness of adaptive difficulty, and "dark patterns" in game design.

**Why it matters here.** The system observes the player and tailors offers while promising not to control them. An observant adaptive system risks reading as surveillance or manipulation, and the harm is asymmetric: one conspicuously wrong personalised offer may lose more trust than one wrong authored offer. Adaptation that works only while hidden is fragile.

**Key sources.**
- Dietvorst, Simmons & Massey 2015, "Algorithm aversion", *JEP: General* ([record](https://repository.upenn.edu/fnce_papers/58)) [sec].
- Denisova & Cairns 2015, "Adaptation in digital games", CHI PLAY 2015, doi 10.1145/2793107.2793141 ([PDF](https://www-users.york.ac.uk/~pc530/pubs/Denisova_CHIPLAY15.pdf)).
- Hunicke & Chapman 2004, "AI for dynamic difficulty adjustment in games", AAAI workshop ([PDF](https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf)) [sec].
- Zagal, Björk & Lewis 2013, "Dark patterns in the design of games", FDG ([record](https://research.chalmers.se/en/publication/177148)) [sec].
- Logg, Minson & Moore 2019, "Algorithm appreciation", *OBHDP* 151 [mem].

**Instance.** Denisova & Cairns adapted a game's timer to performance with 42 volunteers (22 adapted, 20 control). Nobody reported noticing, and the adapted group was more immersed (F(1,40) = 7.41, p = 0.010). The authors chose time because players misjudge it, and caution that awareness over repeated play might feel "short changed" and unfair.

**Principles (testable).**
1. Adaptation below the detection threshold can raise immersion, but once detected it is judged on fairness. Design adaptation that is defensible if revealed, then reveal it after play and measure trust.
2. A single conspicuously wrong personalised offer lowers trust in the offer system more than one wrong authored offer. Manipulate the stated source of the same offer.
3. Making the basis of an offer inspectable on demand ("why am I seeing this") restores perceived control and lowers reactance (field 11).

**Failure modes.** Algorithm aversion is context-dependent, and "algorithm appreciation" has been reported in other tasks [mem]. The DDA evidence is short-session and mostly one-off. Dark-pattern taxonomies are normative, not empirical.

**Relevance.** Core. Medium. **Surprise:** yes.

---

### 20. Affective pacing, tension and suspense

**Definition.** The time course of arousal and relief across an experience, and the cognitive basis of suspense (felt suspense tracks the perceived number of ways out).

**Why it matters here.** Pacing is needed at street scale (seconds) and heist scale (hours), with the system able only to offer, not force. A director needs a cheap estimate of the player's state from observable events, a model of decay, and rules for when to withhold. Valve's Left 4 Dead director is the best-documented implementation and shows how little is needed.

**Key sources.**
- Booth 2009, "The AI systems of Left 4 Dead" ([Valve PDF](https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)).
- Gerrig & Bernardo 1994, "Readers as problem-solvers in the experience of suspense", *Poetics* 22(6):459-472 ([record](https://researchconnect.stonybrook.edu/en/publications/readers-as-problem-solvers-in-the-experience-of-suspense/)) [sec]; Gerrig 1993, *Experiencing Narrative Worlds*, Yale UP [mem].
- Brewer & Lichtenstein 1982 [mem].
- RimWorld storytellers, said to be modelled on the L4D director [sec]; Yannakakis & Togelius 2011, experience-driven procedural content generation [mem].

**Instance.** Booth's slides: estimate each player's "emotional intensity" from damage taken, incapacitation, ledge pushes and nearby deaths, decaying toward zero except while enemies are engaged. The phases are build up, sustain peak (3-5 s after the peak), peak fade (waiting for a natural break), then relax at minimal threat for 30-45 s. Boss encounters are exempt. The slides cite Counter-Strike's observation that constant combat is fatiguing and long inactivity boring.

**Principles (testable).**
1. A relax interval after a peak raises ratings of the next peak, with an optimal length to find. Vary the interval (a hypothesis from the director's design, not an established result).
2. Suspense tracks the number of perceived escapes, so constraining visible options raises suspense without changing the odds (Gerrig & Bernardo) [sec].
3. Flat intensity over a long stretch lowers engagement and reported tension relative to a spiky profile of equal mean.

**Failure modes.** The director's intensity proxy is hand-built, and the slides give no validation against self-report. Suspense work is on text and film. Individuals differ in arousal tolerance. Pacing at hour scale also involves session fatigue and external life.

**Relevance.** Core. Medium-high. **Surprise:** no.

---

### 21. Emergent narrative and player-authored stories

**Definition.** Stories players assemble from systemic events, with theories (evoked, enacted, embedded and emergent narrative architectures), structures that support them (storylets) and tools that find them (story sifting).

**Why it matters here.** The brief asks how players build their own stories from systemic play, and it needs a feel for what makes a systemic event story-able. The system does not have to narrate everything. It can supply anchors and let imagination fill the gaps, and unprompted retellings are a usable signal of success.

**Key sources.**
- Jenkins 2004, "Game design as narrative architecture", in *First Person*, MIT Press [mem for the venue; the four-part scheme is in secondary summaries].
- Short 2016, "Beyond branching" ([blog](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/)); Kreminski & Wardrip-Fruin 2018, storylets design space, ICIDS [sec].
- Ryan, Mateas & Wardrip-Fruin 2015, "Open design challenges for interactive emergent narrative", ICIDS (story sifting) [sec].
- de Plater on the Nemesis system, DICE 2015 ([GamesBeat](https://gamesbeat.com/shadow-of-mordors-nemesis-system-draws-from-burnout-football-and-an-architecture-book/)) [sec].
- Aarseth 2012, "A narrative theory of games", FDG [mem].

**Instance.** De Plater described the Nemesis system as generating detail at key points ("anchors of gameplay") and leaving players' minds to fill the gaps between them, with enemies remembering encounters [sec].

**Principles (testable).**
1. A systemic event becomes a story the player tells when it has a named, recurring participant, a visible cause linking to an earlier player act, and a reversal. Count unprompted retellings by event type.
2. Sparse anchors with ambiguous links yield more player-attributed narrative than dense continuous narration. Compare retell counts.
3. Sifting the event log for rare, already-meaningful sequences and surfacing them (a callback, a rumour) turns random chains into recognised stories.

**Failure modes.** Evidence is mostly designer testimony and case studies. A content analysis found emergent narrative rare in shipped games [sec]. Selection bias: we hear the best stories. Sifting tools are research prototypes.

**Relevance.** Core. Medium. **Surprise:** no.

---

### 22. Rumour, hearsay and social transmission

**Definition.** How information changes as it passes between people (levelling, sharpening, assimilation), and rumour as collective sense-making about something unresolved.

**Why it matters here.** City-wide facts reach the player through other people. This field says how a true fact should arrive: partial, sharpened around the salient detail, coloured by the teller's concerns. A believable hearsay chain signals "someone told them". Player deeds should propagate the same way, with distortion in the direction of the teller's attitude, which reads as reputation. Accurate relay reads as surveillance.

**Key sources.**
- Allport & Postman 1947, *The Psychology of Rumor*, Holt [sec for details].
- Bordia & DiFonzo 2004, "Problem solving in social interactions on the Internet: rumor as social cognition", *Social Psychology Quarterly* 67(1) [sec].
- DiFonzo & Bordia 2007, *Rumor Psychology*, APA [mem]; Caplow 1947 (wartime rumour study) [sec].

**Instance.** In serial-reproduction experiments, many details vanished within the first five or six retellings, summarised as levelling, sharpening and assimilation [sec]. Field studies find much less distortion than the laboratory, and one wartime study found reports growing more accurate as they spread [sec].

**Principles (testable).**
1. A fact relayed through two or three NPCs, each dropping detail and sharpening one item, is rated more believable as hearsay than a verbatim relay.
2. Hearsay tied to a district's current worry gets more uptake than random gossip.
3. A player deed relayed back with distortion toward the teller's attitude reads as reputation. Relayed accurately it reads as being watched.

**Failure modes.** Classic lab serial reproduction overstates real-world distortion [sec]. No games study found. Distortion trades off against legibility: players still need to extract the information.

**Relevance.** Supporting. Medium-low. **Surprise:** yes.

---

## H. Method and the wider community

### 23. Player-community analysis

**Definition.** Study of how players collectively document, compare, name and mock content (forums, wikis, datamining, memes, review text), treating the community as a detector of templates.

**Why it matters here.** "Feels generated" is partly social. Players compare notes, name repeats and datamine rule tables, so a system that is unique per player loses that uniqueness once it is discussed. The forum record is also a cheap, existing set of defect reports on the same game: Cyberpunk 2077's own community has already named what its street content lacks.

**Key sources.**
- Know Your Meme, "Another settlement needs our help" ([page](https://amp.knowyourmeme.com/memes/another-settlement-needs-our-help)) [sec].
- Klepek 2020, "Cyberpunk 2077 has an open world that invites you to ignore it" ([Vice](https://vice.com/en/article/cyberpunk-2077-has-an-open-world-that-invites-you-to-ignore-it)).
- Guru3D forum post on repetitive encounters ([post](https://forums.guru3d.com/posts/5873011/)) [sec]; TechSpot on dropped police chases ([article](https://static.techspot.com/news/92709-cyberpunk-2077-dev-explains-lack-police-chases.html)) [sec].
- Consalvo 2007, *Cheating*, MIT Press [mem]; Jenkins 2006, *Convergence Culture* (collective intelligence) [mem].

**Instance.** Klepek describes working through the map by fast travel and a mission checklist, finding the open world's emergent systems (police, crowds) produced little but clutter, and finding that face-to-face encounters with people describing how the city treated them were what drew him in. A forum poster counts three or four variants of random pop-up encounters [sec]. The Fallout 4 case is contested: defenders argue the character is sympathetic [sec].

**Principles (testable).**
1. How often a content type is named or memed in public text leads template detection. Track phrases in reviews and forums.
2. Players name content by skeleton (who asks, what is asked), so the nameable skeleton must vary.
3. Design as if the rule is known: make the experience robust to being explained, using reactivity instead of secrecy.

**Failure modes.** Forum voices are self-selected and exaggerate. Review text conflates bugs with design. Sampling is not representative. Memes amplify a few details.

**Relevance.** Supporting. Medium. **Surprise:** no.

---

### 24. Games user research and believability evaluation

**Definition.** Methods for measuring player experience and perceived believability: questionnaires (immersion, player experience), think-aloud and retrospective interviews, telemetry, and judge-based Turing-style tests.

**Why it matters here.** The success criteria in the brief are perceptions, so each needs an instrument, and the instruments have traps (peak-end bias in retrospective report, confabulated reasons). A blind "authored or generated?" judging panel measures "feels generated" more directly than a satisfaction scale, and sorting tasks measure perceived variety (field 14).

**Key sources.**
- Jennett et al. 2008 (Immersive Experience Questionnaire) ([PDF](https://www-users.york.ac.uk/~pc530/pubs/JennettIJHCS08.pdf)) [sec].
- Vanden Abeele, Spiel, Nacke, Johnson & Gerling 2020, Player Experience Inventory, *IJHCS* 135:102370 ([news item](https://uwaterloo.ca/arts/news/new-tool-helps-game-designers-evaluate-player-experience)) [sec].
- Hingston 2009, "A Turing test for computer game bots", *IEEE TCIAIG* 1(3):169-186 ([record](https://ro.ecu.edu.au/ecuworks/594)) [sec].
- Drachen, Mirza-Babaei & Nacke (eds) 2018, *Games User Research*, OUP [mem]; Denisova & Cairns 2015 (an IEQ-based adaptation study, above).

**Instance.** The PXI has 30 items, was developed with 64 experts, and was validated across five studies with 529 participants [sec]. In the BotPrize, judges decide whether an opponent in a shooter is human or a bot, with chat disabled. The 2008 test was found challenging, and in 2012 judges could for the first time not tell the best bots from humans [sec].

**Principles (testable).**
1. Blind judge tests (authored versus generated) detect "feels generated" at rates that vary by content type, and give a per-type detection rate to drive down.
2. Combine telemetry with a short post-session instrument, because retrospective report is biased to peak and end (field 3) and to confabulated reasons (field 18).
3. Sorting tasks (group these encounters by similarity) expose perceived variety directly (field 14).

**Failure modes.** BotPrize used expert judges in one genre. IEQ and PXI are self-report. Single-session studies miss habituation. Being observed changes behaviour.

**Relevance.** Core as method. High. **Surprise:** partly. Questionnaires are known, but blind judge tests for quest content are rarely done.

---

### 25. Perception of randomness and probability

**Definition.** People hold a systematic, wrong model of "random": random-looking sequences should alternate more and cluster less than real ones. Stated odds are also misread.

**Why it matters here.** A system that samples encounter types randomly will produce streaks players read as design or as a defect. The classic fix, forbidding repeats, produces sequences that feel more random but are more predictable (field 13). The constraint belongs on the skeleton, not the skin, and expected outcomes from stated advantages tend to be read as near-certain.

**Key sources.**
- Falk & Konold 1997, "Making sense of randomness", *Psychological Review* 104:301-318 ([abstract](https://srri.umass.edu/publications/falk-1997msr/)) [sec].
- Gilovich, Vallone & Tversky 1985, hot hand, *Cognitive Psychology* 17 [mem]; Miller & Sanjurjo 2018, *Econometrica* 86(6):2019-2047 ([record](https://econometricsociety.org/publications/econometrica/2018/11/01/surprised-hot-hand-fallacy-truth-law-small-numbers)) [sec].
- Sid Meier, GDC 2010 keynote ([transcript excerpts](https://venturebeat.com/2010/03/12/quotes-from-sid-meiers-keynote-gdc-speech)) [sec].

**Instance.** Across prior studies, the modal subjective probability of alternation was about 0.6 against 0.5 for a true random process, and Falk & Konold's account is that perceived randomness tracks encoding difficulty [sec]. Meier reported that in Civilization Revolution testers misjudged battle odds around 3:1 to 4:1; sources disagree on the direction of the complaint [sec].

**Principles (testable).**
1. Sequences with fewer repeats than chance are rated more random and fair than true random ones. Rate sequences of encounter types.
2. Runs of the same encounter skeleton are noticed as design, while runs of surface repeats are noticed less. Constrain skeleton streaks, not skin.
3. Players expect a stated advantage to be near-certain. Compare complaint rates when odds are shown or hidden.

**Failure modes.** Miller & Sanjurjo's streak-selection bias undercuts the original hot-hand-fallacy conclusion, so human pattern sense is not simply wrong [sec]. Over-alternation has competing explanations [sec]. The Meier anecdotes are second-hand and inconsistent.

**Relevance.** Supporting. Medium. **Surprise:** yes.

---

## Cross-field tensions worth settling early

- **Hidden adaptation versus visible responsiveness.** Field 19 says adaptation works best undetected, while field 6 says players must see the response to feel noticed. Where a callback tips from "noticed" into "watched" is the least-studied boundary, and the one most worth a prototype study.
- **Congruence versus distinctiveness.** Field 5 says setting-true texture is unmemorable and field 14 says players only count perceptible difference. The budget is a tiering question, not a maximisation.
- **Skeleton variation versus streak control.** Fields 13 and 25 pull opposite ways: anti-streak rules make the skeleton predictable. Vary structure, not only order.
- **Transportation versus scrutiny.** Field 15's masking effect is why short, interruptible street content needs the strongest template defence.
- **Evidence gap.** No verified study measures how players perceive generated narrative content as such. Field 24's instruments would produce the first data. Until then, treat the principles as a testing agenda.

## Considered and rejected

- **Choice overload (Iyengar & Lepper 2000):** the meta-analytic mean effect across 63 conditions was about zero (Scheibehenne, Greifeneder & Todd 2010, [Journal of Consumer Research 37:409-425](https://ideas.repec.org/a/oup/jconrs/v37y2010i3p409-425.html)) [sec], so it cannot ground a rule.
- **Flow and GameFlow (Csikszentmihalyi; Sweetser & Wyeth 2005):** covered by difficulty design and adds little to the offer-and-narrative problem; subsumed by fields 9 and 11.
- **Excitation transfer and mood management (Zillmann):** relevant to pacing, but old and TV-based; subsumed by field 20.
- **Uncanny valley:** about appearance, not narrative.
- **Ludonarrative dissonance (Hocking 2007):** a critical lens, not a mechanism; folded into field 16.
- **Parasocial relationships (Horton & Wohl 1956):** plausibly relevant to recurring NPCs, but evidence is mostly broadcast media; park it for a later lens.
- **Reward schedules and compulsion loops (Skinner):** known to work and exactly what the brief should avoid.
- **Personality (Big Five) as a content predictor:** weak predictive power; folded into field 12.
- **Presence research in VR:** tied to embodiment on headsets, not flat-screen play.
- **Improv theatre and tabletop GM craft (Johnstone, *Impro*):** a craft source for offers and callbacks and probably covered by craft lenses; the player-side mechanism is field 6.
- **Cognitive load theory (Sweller):** about learning; the perceptual-load version is in field 2.
- **Dual-process "System 1/System 2":** too general to yield a testable design claim.
- **Sunk cost and endowment effects:** manipulation-prone and ethically fraught; they are not wanted here.
