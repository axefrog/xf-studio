# Dossier 4: quest, job and heist structure

**Status:** v1, 22 October 2026. Dossier 4 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: NAR-01, NAR-02, NAR-03, NAR-06, NAR-11. Supporting fields: NAR-04, NAR-07, NAR-12, NAR-25, CRA-08. Feeds P4 (the seed language) and P6 (authoring).

**In brief**
- Generated and templated quests fail in a small number of repeatable ways. The commonest is that variation sits in the slot (a place, a name, a target) and not in the situation. The next is that nothing says *why now* or *what is at stake*. Others are offers with no memory, chains of errands, and consequences that stop at the quest's last node.
- The game's own gigs share one wiring: unlock, pin, arrival trigger, brief, objectives, outcome fact, debrief, reward, counter. That wiring is cheap and a procedure can produce it. The content that makes a gig worth remembering is not in the wiring.
- A first pass at the corpus test says the gigs that critics single out for story differ from the rest by having a conversation with a decision about a named person in it. They are not larger. The evidence is thin (seven gigs, one opinion source) and is stated as a hypothesis.
- Almost all the game's alternatives are held in facts, not in forks. About two thirds of forks in gig graphs start parallel work, not alternative paths.
- Craft traditions treat a job as a script with stages the world must be able to satisfy, and they treat the aftermath as a stage. The shipped gigs are thin exactly there: retaliation is set in about one gig in four.
- Heist planning stays fun when it is late-bound: a plan type and one detail, a rolled starting position, and preparation revealed when it is needed (Blades in the Dark). That maps onto pins and the kernel's late binding, with one hard limit from D-09: the engine may late-bind the crew's preparation, never V's.

## 1. Scope and why it matters here

A seed is a partly resolved quest ([foundation §6](../foundation.md#6-story-in-the-same-space)). Before the seed language (P4) can say what a seed is made of, we need to know which shapes real jobs take, which shapes fail, and which relations between parts a seed must be able to state.

This dossier covers the structure of one unit of play at the scale of a **gig** (a job from a fixer, one to a few hours) and, by composition, the **heist** (a multi-stage job with a crew) and the **side quest**. It does not cover the arc above the gig (dossier 8), the director's timing (dossier 7), or the words (dossier 21).

| Layer or concern | What this dossier gives it |
|---|---|
| 2. Seeding (seed language, casting, lifecycle) | The shapes and relations a seed must express (§10); the checks a lifecycle can run before a seed resolves |
| 3. Procedural engine (sowing, fitting) | What to propose, and what a fitter must not leave open |
| 4. Authored content | The reference shape of a gig, so authors can write against it |
| Evaluation (E) | Failure patterns with tests; a first corpus test (§5) |
| Expression (X) | Which parts need authored craft (the decision beat) and which are wiring |

**Evidence in the repository, used read-only:** the [seven gig decompositions](../gig-decompositions.md), the [quest corpus statistics](../quest-corpus-statistics.md), and [open-world activities](../../../knowledge/open-world-activities.md). I also ran new read-only queries on the corpus database for 73 base-game gigs (method and limits in §5.2).

**Grades.** [empirical], [practice], [shipped], [corpus], [analysis], [hypothesis] as in P1 §4. **contested** marks a claim two sources dispute. Source status in this dossier: *read* (fetched and read this session), *summary* (only a search summary or a lens's account was seen), *memory* (recalled, not rechecked).

## 2. The failure record

Failures come first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses patterns, §2.3 lists where the craft advice itself fails. The lens's own cases are in [L2 Part A](lenses/L2-failures.md); I re-checked the ones that bear on quests and say where a lens claim did not hold up.

### 2.1 Cases

| # | Case | What was tried | What went wrong | Evidence |
|---|---|---|---|---|
| F-01 | **Oblivion's Radiant AI** (2006) | NPCs given needs and goals and left to pursue them | Most of the wild behaviour was killing and theft. In testing, addicts killed the skooma merchant a Dark Brotherhood quest needed, so he was dead when the player arrived. The designer is reported as saying the AI sometimes broke quests and that designers need control. The column's author thinks the shipped game then felt sedated and says the piece is opinion | *read*: GamesBeat column, 17 Dec 2010 [practice, with opinion] |
| F-02 | **Skyrim's Radiant Story** (2011) | Quests with slots for giver, target and place, filled from the player's progress | The designer's account: 30 player actions each had a list of possible reactions. A theft reaction was cut because players always ended by killing the NPC. A drop-an-item reaction fired so often that half the town swarmed, so the conditions were widened. Job quests were limited to NPCs that fit them, such as innkeepers. Custom lines were written for each voice type. Players tired of non-story jobs, so more hand-made quests were built. He did not expect a generated main quest to match a hand-made one | *read*: GamesBeat report of Nesmith's talk, 27 Jan 2012 [practice] |
| F-03 | **Fallout 4's Minutemen** (2015) | Endless generated "a settlement needs help" jobs | A sympathetic critic describes the giver handing out a new job whenever V is near, without asking and whatever V is doing. The jobs are timed and expire into a failure message. Each asks V to travel somewhere and kill or rescue. A popular mod exists to stop the offers | *read*: Inverse, 19 Apr 2016 [practice; critic] |
| F-04 | **The research generator's own output** | Doran and Parberry derived a grammar from over 750 quests in four MMORPGs: nine NPC motivations, each with 2 to 7 strategies, each strategy 1 to 6 actions, recursively expandable | Their own worked example is a 28-step quest in which the player goes to one NPC to learn where the next NPC is, four times over, then buys a letter that says where a goblin is, then spies on the goblin. The authors say further work is needed before it matches hand-made quests, and report no player evaluation | *read*: PCG 2011 paper [analysis]. The reading of the example as an errand chain is mine [hypothesis] |
| F-05 | **Starfield's points of interest and errands** (2023) | Handmade sites placed procedurally on many planets | One reviewer reports sites that are near-copies from a small set of templates, side quests of the form "go here, get this", and a fetch quest as the answer to wanting more. Bethesda's reply to a player review said the empty planets are intentional | *read*: DSOGaming review; 80.lv report [practice; critic] |
| F-06 | **Cyberpunk 2077's own gigs and hustles** | Hand-made gigs with a fixed wiring; scanner hustles as one-step events | Players on a Reddit thread (reported by Dexerto) name Padre's gigs as mostly killing. A Steam commenter calls the base-game gigs a formula of going somewhere, killing and collecting (summary of a page I could not open). A critic of the game's side quests (not gigs) faults abrupt endings and predictable plots. In the corpus, 22 of 73 base gigs have no dialogue choice node and 22 have under 25 lines (§5.2) | *read*: Dexerto; NME; *summary*: Steam [practice, community; weak] |
| F-07 | **Watch Dogs: Legion's recruits** (2020) | Anyone can be recruited; each has a generated job and traits | Writers could not know age, gender, occupation or traits, so lines could not refer to them. Early procedural prototypes lacked narrative energy. A recruit's own mission is the only place to tell a story about that person, and it is a one-off with no lasting consequence. Authored "Anchor" characters were added for continuity and shared goals. Lines were written for 20 personas | *read*: Game Developer on Hennessy's GDC talk [practice] |
| F-08 | **Tabletop heist planning** | The group plans a job before it runs | Players gather information without end, plan before they know enough and rebuild the plan at each new fact, treat the heist as a dungeon, or the game master withholds too tightly. Planning may fill most of a session. Lens L6 adds that the Shadowrun 4E text warns that too many complications make players feel they have lost control, and that one Reddit game master reports legwork taking 90 % of a session (both unverified) | *read*: The Alexandrian (heist article); *summary*: Pathfinder Ultimate Intrigue, a Shadowrun 4E excerpt on an unofficial host, a Reddit thread [practice; the last two weak] |
| F-09 | **Quest theory as a generator** | Taxonomies drawn from existing quests | Computer role-playing quests are mostly lists of tasks, with variation only in combat or a binary faction or morality choice | *read*: abstract of Sullivan, Mateas and Wardrip-Fruin (2011) [analysis] |
| F-10 | **Mass Effect 3's ending** (2012) | A ledger of choices across a trilogy | Critics said the ending made earlier choices inconsequential. The fix was an extended epilogue that varies by prior choices | *summary*: carried from L2, not rechecked [practice, weak] |

Cases from L2 that I did not recheck and do not rely on: Façade's authoring cost, the quantum ogre, Majestic's pacing, the Galactic Starcruiser, and the 2023 generative-agent and 2026 language-model narrator findings. L2 also says Legion's missions "request a calm moment"; the Game Developer article I read does not mention a player-attention system, so I treat that as unconfirmed. L2 calls the "Another settlement needs our help" meme a fast spread; I did not open the page that dates it.

**Strategy-game event systems (thin).** The map asks this dossier to hold the case record for weighted, triggered events. I found only secondary material. A Crusader Kings modding thread shows the shape of an event: a trigger block for eligibility, a mean-time-to-happen block for chance, and an immediate block for effects (Crusader Kings II syntax, so unverified for the current game). Mod changelogs show modders repeatedly fixing events that fired too often or not at all. A RimWorld wiki says its storytellers choose incidents rather than roll them, with Phoebe spacing major threats by days and Cassandra following a rise and fall; a video summary adds a points budget set by colony wealth. No primary source (Paradox documentation, Sylvester's talks) was reached. Nothing here supports a principle; it is logged as an open question (§9).

### 2.2 What the failures have in common

| # | Pattern | Cases | What is missing | A test that catches it | Where this dossier answers it |
|---|---|---|---|---|---|
| P-1 | **Variation in the slot, not the situation** | F-02, F-04, F-05 | A difference in verb, stake or relationship | Show players N outputs that differ only in place and names and ask whether they are the same quest | QST-06, QST-05 |
| P-2 | **No why-now and no stake** | F-02, F-03 | A recorded cause for the offer and something to lose | The offer's record has no cited cause or stake | QST-05, QST-01 |
| P-3 | **Offers with no memory or cap** | F-03, F-07 | A model of what was just offered, what V is doing, and a limit | Offer rate against V's activity; the same wording twice in a row | QST-10 |
| P-4 | **Chains of errands** | F-04, F-05 | Beats linked by consequence, not by succession | A beat whose only link to the last is "then" | QST-01 |
| P-5 | **Consequences that stop at the last node** | F-06, F-07, F-10 | A downstream edge from every outcome, failure included | A terminal state with nothing leaving it | QST-15, QST-16, QST-37 |
| P-6 | **Autonomy tramples authored dependencies** | F-01 | A statement of which people and facts a quest needs alive | Run the world forward with random autonomy and count seeds that can no longer finish | R-24 (§10) |
| P-7 | **Realistic is not the same as fun** | F-02 | A cadence cap and an outcome check for every reaction | Count of reactions per hour; share ending in a degenerate outcome (always killed) | QST-10, QST-16 |
| P-8 | **Generated content on the spine** | F-02 | A rule that generated material stays off the climactic beats | Share of generated beats among those players rank as peak or ending | QST-09 |
| P-9 | **Planning swallows the play, or a twist wipes the plan** | F-08 | Time limits, costly research, a forgiving run, no plan-wiping twist | Minutes of planning against minutes of run; share of runs that end in one forced failure | QST-32 to QST-34 |

### 2.3 Where the advice itself fails

| Advice | How it fails |
|---|---|
| "Every beat is therefore or but" (NAR-01) | It comes from closed linear works, and I have only secondary accounts of the talk it is attributed to. Mateas notes that game stories are usually episodic, and the studio describes gigs as small encounters with a story each. Over-causal plots read as contrived and open-world players want slack (map tension). It applies inside a unit, not across units |
| Quest taxonomies (NAR-02) | They are drawn from fetch-and-kill online games and reproduce them (F-04, F-09). Fifteen developers could not agree what a quest is; they agreed on purposes |
| Story grammars and arc shapes (NAR-04) | Black and Wilensky's critique stands, with a rebuttal on the other side (both known from listings). Reagan's six shapes are sentiment curves of 1,327 Gutenberg fictions of 20,000 to 100,000 words. The authors say an emotional arc does not give the plot. They describe finished texts, not interaction |
| Multi-solution design (NAR-07) | Deus Ex's designers meant the simulation to produce several solutions. It was too shallow, so they hand-built separate skill, action and conversation paths for each problem. That worked and multiplied the content. A deeper simulation is the only way out |
| Branching craft (NAR-03) | The practice record is anecdotal. Ashwell's patterns describe structure, not quality. The cost claims come from authored games, and a generator multiplies variants without multiplying testing |
| Three Clue Rule and competing-hypotheses analysis (NAR-12) | The rule is about access to clues, not their discovery. The 2019 study of 50 intelligence analysts found mixed evidence that the analysis-of-competing-hypotheses method reduces confirmation bias and some sign that it increased inconsistency. Use it to design clues, not to promise players better reasoning |
| Heist planning craft (NAR-06) | Most of it is game-master advice, forum threads and fan sites. The criminological scripts are built from offenders who were caught or who talked, and describe how crimes were done, not the improvisation around them |
| Con-game stages (CRA-08) | Maurer's data are anecdotal. I have read the stage list only through a summary |
| Craft versus shipped data on the opinion test (§5) | Opinion sources disagree on what "good" means. One ranks by taste, another by ease and reward. Only two gigs appear in more than one base-game list |

## 3. Sources

Source status as defined in §1. "Credit" says whether [the community credits](../../../docs/community-credits.md) already hold an entry (checked by name).

### 3.1 Read

| Work | Used for | Credit |
|---|---|---|
| Bruce Nesmith, talk reported on GamesBeat, 27 Jan 2012 | F-02 | to add |
| GamesBeat column, "Dimming the Radiant AI in Oblivion", 17 Dec 2010 | F-01 | to add |
| Inverse, "An ode to Preston Garvey", 19 Apr 2016 | F-03 | to add |
| Doran and Parberry, PCG workshop 2011 (full text) | F-04, QST-05 | to add |
| Sullivan, Mateas and Wardrip-Fruin, "Making Quests Playable", 2011 (abstract) | F-09, QST-06 | to add |
| Yu, Guzdial and Sturtevant, arXiv 2110.04148 (abstract) | QST-04 | to add |
| Mateas, "A Preliminary Poetics for Interactive Drama and Games", *Digital Creativity* 12(3), 2001 (first four sections) | QST-01, QST-02 | exists (Mateas and Stern entry covers Façade, not this paper) |
| Paweł Sasko, GDC 2023, as summarised by Game Developer | QST-16, QST-24 | to add |
| Philipp Weber, as reported by Game World Observer, 13 Sep 2019 | QST-02, QST-07, QST-17 | to add |
| 80.lv on Sasko's pitch rates; Game Developer on Hennessy (Legion); DSOGaming review; 80.lv on Starfield | F-05, F-07 | to add |
| Ashwell, "Standard Patterns in Choice-Based Games", 2015; Short, "Small-Scale Structures in CYOA", 2016; Sawyer in PCGamesN, 2017 | QST-11 | to add (Short has entries; these works not checked) |
| Alexandrian, heist structure article; Three Clue Rule | QST-19, QST-34 | Three Clue Rule credited; heist article to add |
| Harper, *Blades in the Dark* SRD (Roll20 compendium and an SRD text copy) | QST-32, QST-33, QST-37 | credited |
| Bordwell, "One last big job: how heist movies tell their stories", 2017 | QST-30, QST-31, QST-36 | to add |
| Cornish, "The procedural analysis of offending", 1994 (full text) | QST-26 to QST-28 | to add |
| Sanderson, 2025 plot lecture write-up | QST-03 | to add |
| Reagan et al., arXiv 1606.07772 | QST-39 | to add |
| Spector and the Ion Storm team, Deus Ex postmortem, *Game Developer* | QST-17, QST-18 | to add |
| Hayashida, Game Developer interview on Mario level design | QST-40 | to add |
| Daggerfall Unity quest system status page | §10 (comparison) | to add |
| TheGamer, GamesRadar, Screen Rant, NME, Dexerto, PowerPyx pages (listed in §5.1) | §5 opinion data | publications; low priority |
| GameGrin on Witcher 3 contracts; Wikipedia "Heist film"; Wikipedia and a walkthrough on the Konpeki Plaza job | §4, §6 | encyclopedia and fan pages; not credited |
| ScriptEase quest patterns thesis (abstract) | §11 | to add |

### 3.2 Summary only, or memory

| Work | What I have | Treatment |
|---|---|---|
| Parker and Stone, NYU session on "therefore" and "but" | Several secondary write-ups; no transcript | The idea is used, the attribution is hedged |
| Aristotle, McKee, Propp, Black and Wilensky, Lehnert, Aarseth, Howard | Memory and lens citations | Named only where a lens did; no claim rests on them alone |
| *Shadowrun* 4th edition, *The Sprawl* (Cameron), *Technoir*, *Leverage* RPG | Search summaries; one 4E excerpt on an unofficial host | Marked [sec] wherever used |
| Maurer 1940, Goffman 1952, Forer 1949 | Goffman's citation (*Psychiatry* 15(4), 451–463) confirmed by a search; Maurer's stage list through Wikipedia's "Scam" page | CRA-08 principle marked weak |
| Heuer ch. 8 and Dhami, Belton and Mandel 2019 | Search summaries | QST-20 hedged |
| Dehghanniri and Borrion, crime scripting review | Not reached | Not relied on |
| Thief postmortem, Mooncrash talk | L9's account | Not relied on |
| Steam discussions on gigs | The pages were blocked in this region; only search summaries | Weak, labelled |

### 3.3 Lens claims checked

| Lens claim | Result |
|---|---|
| L2 A1: a skooma merchant killed in testing | Confirmed (opinion column) |
| L2 A2: Nesmith's account | Confirmed |
| L2 A3: unrequested, repeated, timed offers | Confirmed in part (Inverse) |
| L2 A4: copy-paste sites, fetch errands | Confirmed as one reviewer's view; the forum distinction (placement procedural, contents fixed) not reached |
| L2 A6 / L9: Legion's player-attention system | Not in the article I read |
| L6: gigs fall into about six formulae | A Steam comment (summary only). PowerPyx groups the 86 base gigs into seven types (Thievery 20, Gun for Hire 14, SOS: Merc Needed 15, Search and Recover 9, Agent Saboteur 9, Convoy 2, Cyberpsycho Sighting 17). The guide does not say whether the labels show in the game |
| L9: Sasko puts a good designer's acceptance rate at 5 to 10 per cent; pitches are half a page; documents run to ten pages or more | Confirmed (80.lv; Game World Observer) |
| L7: Cornish's stages | Confirmed in part: levels of script (universal script, metascript, protoscript, script, track), components, the "script permutator", and the sequence preparation, entry, conditions, instrumental actions, main action, exit |
| L1: Blades in the Dark engagement roll and flashback costs | Confirmed (§6.3) |
| L5: Zeigarnik figures | Not needed here; not checked |

## 4. The shapes

### 4.1 Stage by stage

Seven accounts of how a job unfolds, set side by side. Rows are stages; each cell says how that account treats it.

| Stage | Bordwell (heist films) | Cornish (crime script) | Shadowrun and *The Sprawl* | *Blades in the Dark* | Witcher 3 contract | The game's gig (corpus) |
|---|---|---|---|---|---|---|
| Offer, circumstances | Circumstances push someone to a heist | (before the script) | Meet the Johnson; Get the Job | Free play, then choose a target | Notice board, then talk to the giver and settle a fee | Fixer unlock (counters, tier facts, a text), a map pin, V reaches a trigger area |
| Recruit | Initiators recruit participants | Roles assigned | (the team already exists) | The crew is the player group | None | None; one fixer, one contact |
| Study, legwork | The crew studies, rehearses, plans | Preparation, often away from the scene | Legwork | Gather information; plan type and one detail | Investigate the area, a small whodunnit | A few "find" and "scan" objectives; a brief by call or text |
| Prepare | (rehearsal) | Instrumental pre-conditions | (part of legwork) | Load; flashbacks later | None | None; some objectives fetch an item |
| Run | The heist | Entry, conditions, main action | The run; Action | Engagement roll sets the opening position, then the score | Face the monster after tension has built | 2 to 18 objectives (median 8), an encounter phase kept apart from a narrative phase |
| Complication | The plan goes wrong | Distractions, contingencies | Complications, the double-cross | Rolls, obstacles, clocks | Twists and moral dilemmas in the investigation | Alarm waves, reinforcements, a chase objective |
| Exit | (part of the heist) | Exit | (part of the run) | Escape within the score | None | Leave-the-area and drop-point objectives |
| Payoff | Take, or lose it | (outside) | Get Paid, where the contact may cheat | Coin by job size and tier; reputation | Return and be paid | One reward record; a debrief by call or text; often a drop point |
| Aftermath | Fates of the participants; the genre often ends here | (outside) | Retaliation (*The Sprawl*) | Heat by loudness, then an entanglement that lands before the crew can prevent it, then downtime | None | A retaliation fact in 16 of about 70 gigs, a delayed text and a chase; district counters |

Sources: Bordwell (read); Cornish (read); *Blades* SRD (read); GameGrin on Witcher contracts (read); Shadowrun 4E excerpt and *The Sprawl* phase list (summary only); the gig column from the [decompositions](../gig-decompositions.md) and [open-world activities](../../../knowledge/open-world-activities.md).

### 4.2 The fixer's offer and payout

Facts from the knowledge page, all [corpus] (read in the game files) unless marked.

- **The offer is state, not a quest.** A fixer phase sets tier facts when V has done enough work, texts V, and flips map pins from hidden to discovered. A district counter rises when a gig sets its finished fact (or its failed fact, for a few gigs). Regina's phase waits on counters of 5, 8, 11, 13, 15, 17 and 19. At each it waits, texts, then sets the next tier fact. So the text *is* the unlock. Street cred gates only the top tier of a region (and Pacifica's higher tiers).
- **The brief is a call with a text as fallback.** 68 of 70 gigs with full structure play a fixer call on arrival and another at the end. If calls are muted or other content is active, the same words arrive as a text.
- **Pay is a record.** 2,230 to 32,400 eddies, median 8,800, set by district. Level experience is 1,000 in every record. Street-cred experience runs 484 to 1,710. No gig record holds an item. Only three gigs pay more for a non-lethal route. A gig of 710 nodes pays what five gigs of 300 to 450 nodes pay. Standing with a fixer is the district counter and street cred; no fact stores trust.
- **Optional objectives are conditions.** 58 of 652 street-story objectives are optional, across 37 of 73 gigs. Typical names are `stealth`, `be_unseen`, `dont_kill`, `avoid_combat`, `dont_damage_the_car`. They feed outcome facts such as `perfect` and `pacifist`, which pick a debrief and sometimes a reward record. Which optional objective feeds which fact is not traced.
- **Failure has a warning.** 24 gig files send a warning text before failing when V strays; 18 of about 70 set a failure fact.
- **Fixers do not test V.** No base-game gig holds a fact named for a betrayal or an ambush (a search of fact names; the twist could live in a scene without a fact). Two Phantom Liberty gigs hold ambush facts. The double-cross in the shipped game sits in the main story's heist.

### 4.3 Where craft and the studio agree, and where they do not

| Topic | Craft advice | What the studio says and the data show | Verdict |
|---|---|---|---|
| Typing | Pattern catalogues name shapes (Ashwell; Doran and Parberry) | Weber: no checklist of types and no fetch or escort boxes; even a fetch usually has other activities. The data: every gig has the same wiring. Community guides sort gigs into six or seven types | Partly agree. Nothing *selects behaviour* by type, but the wiring is a type |
| Aftermath | A stage of its own (Bordwell; *The Sprawl*; *Blades*) | Retaliation set in 16 of about 70 gigs, as a delayed chase | **Disagree.** The game is thin where craft is firm |
| Payoff varies with noise | *Blades*: heat by how loud the job was | Pay is flat by district; the debrief text varies in about 15 gigs, the reward record in 16 | Partly agree: the words change, the pay mostly does not |
| Complication reveals the patron | Shadowrun 4E: complications are the vehicle for a double-cross | No gig fact names one; the fixer is a stable reward platform | **Disagree.** A design choice |
| Failure | "Failure is a consequence, not a state" (Weber; game-master craft) | 18 gigs set a failed fact. In the data I traced, it feeds counters. No further effect found | **Contested.** Statement and data differ |
| Legwork | It swallows sessions; compress or time-box it (Alexandrian; Shadowrun threads) | Legwork is a few objectives and a call | Agree |
| Several ways through | Goal before route (Deus Ex; Weber: several completion paths) | Route facts are few: three or four in a gig that has them. 16 gigs mention a pacifist variant, 15 a "perfect" one. Some gigs have real alternatives (a persuasion branch, a lethal or non-lethal route, a code or a movable fridge) | Partly agree |
| Delayed, visible consequence | Callbacks that return and can be seen (Sasko) | A fixer text, a delay, then a chase; cancellable | Agree, for the 16 |
| Warning before failure | Do not punish with rules the player cannot learn (Alien: Isolation as lens-cited example) | 24 gigs warn first | Agree |
| Clues with several routes | Three clues per conclusion (Alexandrian) | Woman of La Mancha lists parallel leads (confront, shopkeepers, cameras, the target, the body) | Agree where investigation exists, which is rare |
| Unity of action | Dramatic stories have one causal spine; episodic ones do not (Mateas) | Gigs are small encounters, each with a story (Weber) | Agree: episodic by design |
| Dilemmas that match what the player expects | Set up the stakes first (Sasko) | The eight Phantom Liberty gigs have 20 to 39 choice nodes each, against a base median of 2 | Agree for the expansion |

### 4.4 Principles: the shapes

Columns: grade; source and a concrete instance; scale and layers; how to operationalise (**produce**, **check**, or **neither**). "Layers" are the plan's four layers; X, C, E, T are the cross-cutting concerns. Kernel references are to [S0](../spec/kernel.md).

**A. Causal form (NAR-01, NAR-25)**

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-01 | Every beat after the first is linked to its predecessor by a recorded cause (*therefore*) or a recorded obstacle (*but*). A link that reads only as *then* is a defect, except for beats flagged as texture | [practice] heuristic; [analysis] (Mateas on unity of action). Contested for open-world slack | Mateas 2001; secondary accounts of Parker and Stone. Counter-instance: the 28-step quest in F-04. Instance: a Witcher-style contract, where learning what the thing is *causes* the decision about it | Gig, arc · 2, 3 | **Check:** each beat has a `because` edge to a record entry or an `obstructed-by` edge; a validator rejects a seed whose only link is order. **Produce:** fitting adds the cause from the record ([kernel §9.2](../spec/kernel.md#92-events), `causes`) |
| QST-02 | A unit is unified inside and threaded across. Inside a gig, beats form one causal chain. Between gigs, links are optional (a callback, a rumour), not required | [analysis]; [shipped] | Mateas separates unity of action from episodic structure and says game stories are mostly episodic. Weber: Street Stories are small encounters, each with its own story | Gig, arc · 2, 4 | **Check:** a seed declares `unity: within` or `across`; the first is checked by QST-01, the second only for dangling promises (QST-03) |
| QST-03 | Every promise (a hint, a named object, a stated stake) is typed (tone, story, character, structure), shown to progress by visible steps, and either paid or explicitly retired. A payoff should be surprising and fulfilling. Small promises nest inside larger ones | [practice] | Sanderson's lecture (progress is information found, a relationship shifting, or an internal change). Instance: a fixer's reward for finishing every gig, with a district counter as the visible progress (PowerPyx, via the knowledge page) | Gig, arc · 2, 3 | **Check:** a ledger in seed state, `promises[]` with type, opened-at, progress events and state (open, paid, retired); the lifecycle will not resolve a seed with an unmarked open promise. **Produce:** sowing proposes payoff candidates |

**B. Vocabulary (NAR-02)**

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-04 | Describe a quest by its purpose and context before its elements. Fifteen developers had no shared definition but converged on purposes (guide, tell a story, provide content, teach, give a reason to play) | [empirical] (a qualitative interview study) | Yu, Guzdial and Sturtevant 2021 | All · 2, 4, T | **Check:** `purpose` and `context` are required fields; agreement between authors tagging a sample should beat agreement on element tags |
| QST-05 | An offer is a blocked goal of a world entity, plus something at stake. A motive alone yields a template | [analysis] | Doran and Parberry found nine motives across 750 quests: knowledge, comfort, reputation, serenity, protection, conquest, wealth, ability, equipment. F-04 shows the limit | Gig · 2, 3 | **Produce:** query for blocked frames near V ([kernel §10.2](../spec/kernel.md#102-frames), [DS-56](../design-seeds.md)). **Check:** the offer record cites the frame and names what the client loses |
| QST-06 | Variation must change the verb, the stake, the relationship or the outcome. A change of place or name alone does not read as variety | [practice] | Nesmith on custom lines and fitting NPCs; F-02, F-04, F-05. Lens L5 offers a thesis on this that I did not read | Gig · 2, 3, E | **Check:** the P-1 sorting test. **Produce:** vary at least one of verb, stake, relationship per repeat of a template |
| QST-07 | Do not let a type drive behaviour. Derive the objective from the situation | [practice]. **Contested**: community guides sort gigs into six or seven types | Weber (no typology, fetches carry other activities); PowerPyx type counts; a Steam comment on formulae | Gig · 2, 4, E | **Check:** the seed language has no field whose value switches a rule; labels computed from structure are allowed for evaluation only |

**C. The gig as the game builds it (NAR-02, NAR-03)**

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-08 | A gig is a composition of eight things: a unique id and pin; a fixer-owned unlock separate from the quest; a brief by call or text at the site with a matching debrief; 2 to 18 objectives with Active, Succeeded, Failed and Inactive transitions; an encounter phase apart from a narrative phase; finished and failed facts that counters read; a reward by record with a variant per route; an optional delayed, cancellable retaliation | [corpus] | [Open-world activities §8](../../../knowledge/open-world-activities.md); all seven decompositions | Gig · 2, 4 | **Produce:** a `gig` profile that composes these fragments. **Check:** a seed that claims the profile has all eight |
| QST-09 | The wiring is invariant and the content is not. Brief, trigger, objectives, outcome fact, debrief, reward and counter are the same in all seven decomposed gigs. A procedure can produce the wiring, so scarce authored or targeted craft goes to the one beat that carries the decision (QST-21) | [corpus] | [Gig decompositions](../gig-decompositions.md) "Shape shared by all seven" | Gig · 3, 4, X | **Produce:** the engine builds wiring; authors and fitting spend effort on the decision beat. **Check:** generated beats are not on the peak or the ending of an arc |
| QST-10 | The offer is state. Availability is a ladder of facts (tiers, counters, thresholds); the fixer's text is the unlock and follows a delay; offers come in batches of one to three; an unwanted offer must have a cap and a memory | [corpus]; [practice] (Horvitz via L2; unread) | Regina's counters at 5, 8, 11, 13, 15, 17, 19. Counter-instance: F-03 | Gig · 2, 3 | **Produce:** an offer scheduler with counters, thresholds, batching and channel (layer 2 scheduling). **Check:** no offer repeats a wording or a template inside a window; acceptance falls by activity (P-3) |
| QST-11 | Alternatives live in facts, and paths reconverge. In gig graphs 92.9 % of nodes with an exit use one socket, and about a third of forks use two or more sockets (my arithmetic from the statistics tables: 7.1 % of 23,393 nodes with an exit, against 15.9 % of 30,505 nodes that fork); the rest start parallel work. A gig's endings come from three or four route facts that pick a debrief and a reward | [corpus]; [practice] | [Corpus statistics §5](../quest-corpus-statistics.md#5-branching-factor); Ashwell (branch-and-bottleneck needs state tracking; time caves are unaffordable; floating modules collapse without volume); Short's small structures (confirmation-required choice, track switching, re-enterable node); Weber (a variant axis such as a companion is built twice) | Gig · 2, 4 | **Check:** a seed graph has a join; each variant axis is a condition on one graph, not a copy; count of live paths per length is bounded. **Produce:** route variables set by player acts (R-9) |
| QST-12 | An optional objective is a condition on the doing, not an extra task: stay unseen, do not kill, do not damage the car | [corpus] | Journal names `stealth`, `be_unseen`, `dont_kill`, `avoid_combat`, `dont_damage_the_car`; outcome facts `perfect`, `pacifist` | Gig · 2, 4 | **Check:** each condition has a measurable predicate the player can perceive, and feeds a route fact with a consumer (QST-11) |
| QST-13 | Pay is a policy of district and route, kept apart from the structure. It does not follow gig size | [corpus] | 21,780 eddies for Radar Love and for five other Badlands and Pacifica gigs of 300 to 450 nodes (the decompositions count Radar Love at 710 nodes because they include a developer test copy; my live-file count is 470); level experience 1,000 everywhere | Gig · 3, 4, C | **Produce:** a reward table keyed by tier and route. **Check:** pay bands are published, and effort per eddy is monitored, because the lens names rewards decoupled from effort as a radiant failure [lens, unverified] |
| QST-14 | A failure that comes from distance, time or neglect gets a warning first | [corpus] | 24 gig files send one of two texts before failing when V strays | Gig · 2, 3 | **Check:** every failure condition has a preceding warning state in the seed graph |
| QST-15 | A failed job leaves something behind: a loss, a changed standing, a changed offer, a retaliation. Never a bare terminal | **Contested** | [practice]: Weber says quests cannot be failed in the classic sense, only consequenced. [corpus]: 18 of about 70 gigs set a failed fact; in what I traced it feeds counters only | Gig · 2, 3 | **Check:** no terminal `failed` without an outgoing consequence edge. Define the consequence as the world moving on, not as punishment (map tension) |
| QST-16 | Consequences are delayed, signposted and cancellable, and the player can name their cause | [practice]; [corpus] | Sasko (delayed but visible); retaliation in 16 gigs: a fixer text, a wait of seconds to a minute, then spawned chase vehicles; a 3-hour game delay in one gig; cancellable | Gig, arc · 2, 3, E | **Check:** every consequence has a delay, a perceivable signpost and a cancel condition; a test asks players to name the cause |

**D. Several ways through (NAR-07)**

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-17 | State the goal, the obstacles and the affordances (capabilities with a cost and an exposure). Give every obstacle at least two affordances. Show the goal before the route | [practice]; [shipped] | Deus Ex ("problems will have multiple solutions"); Weber. Instances in the decompositions: a persuasion branch (Hippocratic Oath), a lethal or non-lethal route (On a Tight Leash), a code or a movable fridge (Greed Never Pays) | Gig, heist · 2, 4 | **Check:** at least two affordances per obstacle; no hidden roll decides an outcome. **Produce:** casting finds affordances in V's capabilities and the setting |
| QST-18 | Prefer a rich, limited toolset the player can combine to a solution scripted for each case. Hand-built parallel paths multiply cost | [practice] | Deus Ex postmortem: too little simulation, so separate skill, action and conversation paths were built by hand; the team's lesson was general systems over special cases | Gig, heist · 1, 2 | **Produce:** affordances refer to the game's general capabilities (hacking, scanning, persuasion by background) by predicate. **Check:** count of scripted one-off solutions per seed |

**E. Investigation (NAR-12)**

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-19 | For each conclusion the player must reach, offer at least three independent routes; at any time keep at least three leads to places not yet visited. The rule is about access, not discovery | [practice] | Alexandrian's Three Clue Rule and its inverse. Instance: Woman of La Mancha lists parallel leads | Gig · 2, 4 | **Check:** simulate random clue loss and verify the conclusion is still reached; count independent routes per `conclusion` node ([DS-12](../design-seeds.md)) |
| QST-20 | Choose clues that discriminate. A clue consistent with every live hypothesis carries no weight | [practice]; the evidence that the competing-hypotheses method debiases is mixed ([empirical], 50 analysts) | Heuer (summary); Dhami, Belton and Mandel 2019 | Gig · 2, 3 | **Check:** store a consistency vector per clue; each clue must be inconsistent with at least one hypothesis. Use it to build clues, not to tell players how to reason |

**F. Shapes outside the usual arc (NAR-04)**

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-39 | Use story grammars and arc catalogues as recognisers and checklists on finished arcs, not as generators | [analysis] | Black and Wilensky's critique (known from listings); Reagan et al.: six sentiment shapes (rags to riches, tragedy, man in a hole, Icarus, Cinderella, Oedipus) in 1,327 books, with the authors stating that an emotional arc does not give the plot | Arc · E | **Check:** label a thread's arc afterwards for evaluation. **Neither** produces nor constrains the engine's output |
| QST-40 | A four-beat shape (introduce, develop, twist, conclude) gives a shape that needs no antagonist: the tension comes from a turn that recontextualises the first beats | [shipped] in level design; [hypothesis] for jobs | Hayashida on Mario levels, tied to four-panel comics; the twist is called the surprise. Map gap: shapes outside the Western arc | Gig · 2, 4 | **Produce:** a template with four slots. **Check:** the twist refers to an element set up in beats one and two, so it recontextualises and is not random |

## 5. What makes the strong ones strong: a first corpus test

This is a first pass at [P1 §2.6](../p1-research-method.md#26-try-to-break-the-result), the corpus test: can the dossier say what separates a gig widely held to be memorable from a forgettable one? The answer is partial, and the sample is small.

### 5.1 The opinion sources and how I used them

Gigs are the unit. Sources were fetched in this session; two pages were read through a text-extraction proxy because the sites block direct fetches.

| Source | Criterion | Base-game gigs named | Notes |
|---|---|---|---|
| GamesRadar, "best gigs I always love replaying", by a player with 900 hours | The author's taste: questioning one's actions, Night City's seedy side, feeling like a merc; stealth, pacifist and detective setups, grey choices | Dirty Biz, Breaking News, Bring Me the Head of Gustavo Orta, No Fixers, Woman of La Mancha, A Lack of Empathy, Psychofan (plus three Phantom Liberty gigs) | The one source that ranks on story grounds. Code **GR** |
| TheGamer, "The 10 best gigs" | Mixed: some entries praised for approach options, others "ideal for earning eddies" because short and easy | Woman of La Mancha, Occupational Hazard, A Shrine Defiled, Family Heirloom, Two Wrongs Makes Us Right, Sparring Partner, Going-Away Party, The Union Strikes Back, Going Up or Down?, Hot Merchandise | Code **TG**. Reward and ease are in the criterion |
| Screen Rant, side gigs "good and bad" | Tone (light against heavy), not quality | Backs Against the Wall is one of the gigs listed | The article labels none good or bad |
| Screen Rant, five best Phantom Liberty gigs | Moral choice, flexibility of approach, humour | Dogtown Saints, Prototype in the Scraper, Waiting for Dodger, Treating Symptoms, Talent Academy | Expansion only |
| TheGamer, "hardest gigs" | Difficulty | Hippocratic Oath is called a rescue with a moral choice about a wounded gang member | Difficulty, not quality |
| Dexerto, a Reddit poll of least-liked fixers | Fixers | Padre's gigs said to be mostly killing; Wakako's dialogue called slow | Opinion of fixers, not of gigs |
| NME and TheGamer, best side quests | Emotional depth, closure | No gig named. NME faults quests that end abruptly | Side quests, not gigs |

What the sources do not give: a list of forgettable gigs. Nobody names the weak ones. So the comparison below is *named against not named*, which is weaker than strong against weak.

Only **Woman of La Mancha** appears in two base-game lists. Only **Waiting for Dodger** appears in two Phantom Liberty lists. That is a finding in itself (QST-25).

### 5.2 Method and limits of the numbers

- **Sample:** 73 base-game gigs that have a title in the [quest-id list](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/a54b0873/for-mod-creators-theory/references-lists-and-overviews/reference-quest-ids.md), and eight Phantom Liberty gigs.
- **Counted per gig** (live files only): nodes across all its phases; scenes, dialogue lines and choice nodes in the scenes under its street-stories folder; journal objectives under its path.
- **What is not counted:** fixer call scenes that live under the shared holocall folder, shards and texts. A gig whose story sits in shards (Dirty Biz is described that way) is undercounted. Treat line counts as a floor.
- **Definitions:** "no choice" means no choice node in any gig scene. A pattern match on route-fact names was too crude, so I do not use it.
- **Statistics:** the database was opened read-only; no rows were changed.
- **Sample size:** seven gigs in the story-ranked list. The two tests below (at least one choice node; at least 25 lines) each have a chance probability of about 0.07 if the seven were drawn at random from the 73. That suggests a hypothesis; it does not establish one.

### 5.3 The data

Dialogue lines, choice nodes, scenes, nodes and journal objectives for every named gig and for the seven decomposed gigs (**D7**). **SR** is Screen Rant's Backs Against the Wall.

| Gig | Named by | Lines | Choice nodes | Scenes | Nodes | Objectives |
|---|---|---:|---:|---:|---:|---:|
| Dirty Biz (`wat_nid_04`) | GR | 107 | 5 | 4 | 239 | 5 |
| Breaking News (`std_arr_05`) | GR | 50 | 7 | 4 | 552 | 11 |
| Bring Me the Head of Gustavo Orta (`hey_rey_01`) | GR | 64 | 4 | 5 | 543 | 10 |
| No Fixers (`bls_ina_06`) | GR | 70 | 3 | 5 | 433 | 13 |
| Woman of La Mancha (`wat_kab_08`) | GR, TG | 184 | 14 | 6 | 391 | 9 |
| A Lack of Empathy (`cct_dtn_03`) | GR | 38 | 1 | 4 | 421 | 9 |
| Psychofan (`hey_gle_03`) | GR | 43 | 7 | 3 | 436 | 9 |
| Occupational Hazard (`wat_nid_01`) | TG | 71 | 6 | 5 | 230 | 7 |
| A Shrine Defiled (`wbr_jpn_03`) | TG | 19 | 0 | 3 | 245 | 5 |
| Family Heirloom (`wbr_hil_06`) | TG, D7 | 18 | 0 | 4 | 428 | 11 |
| Two Wrongs Makes Us Right (`pac_cvi_02`) | TG | 22 | 0 | 5 | 342 | 8 |
| Sparring Partner (`bls_ina_11`) | TG | 11 | 1 | 5 | 407 | 9 |
| Going-away Party (`std_rcr_03`) | TG | 114 | 7 | 8 | 782 | 13 |
| The Union Strikes Back (`std_rcr_01`) | TG | 54 | 1 | 4 | 459 | 9 |
| Going Up or Down? (`hey_gle_05`) | TG | 52 | 4 | 5 | 287 | 8 |
| Hot Merchandise (`hey_spr_06`) | TG | 46 | 0 | 5 | 454 | 8 |
| Backs Against the Wall (`wat_kab_03`) | SR | 115 | 6 | 4 | 281 | 5 |
| Hippocratic Oath (`wat_kab_02`) | D7 | 223 | 10 | 4 | 461 | 12 |
| Serial Suicide (`cct_cpz_01`) | D7 | 49 | 1 | 5 | 178 | 5 |
| On a Tight Leash (`hey_spr_01`) | D7 | 174 | 11 | 6 | 532 | 10 |
| Hacking the Hacker (`std_arr_11`) | D7 | 10 | 0 | 3 | 248 | 7 |
| Radar Love (`bls_ina_04`) | D7 | 20 | 0 | 3 | 470 | 9 |
| Greed Never Pays (`wbr_jpn_12`) | D7 | 32 | 1 | 4 | 301 | 12 |

Medians over the groups:

| Group | n | Nodes | Scenes | Lines | Choice nodes | Objectives |
|---|---:|---:|---:|---:|---:|---:|
| All base-game gigs | 73 | 356 | 4 | 43 | 2 | 9 |
| GR, the story-ranked list | 7 | 433 | 4 | 64 | 5 | 9 |
| TG, the reward-and-ease list | 10 | 399 | 5 | 49 | 1 | 8.5 |
| Not named by any source | 56 | 331 | 4 | 35 | 2 | 8.5 |
| Phantom Liberty gigs | 8 | 1,056 | 8.5 | 252 | 29 | 22 |

Other counts across the 73 base gigs: 22 have no choice node, 51 have at least one, 23 have five or more; 22 have under 25 lines and 11 have 100 or more. Rank correlation (Spearman): lines with choice nodes 0.84; nodes with lines 0.41. Randomiser nodes make up 0.2 % of gig nodes (73 of 30,505), against 0.8 % of all quest nodes, so chance does little in a gig's shape.

### 5.4 Reading

| Share of group with | GR (7) | TG (10) | All base gigs (73) |
|---|---:|---:|---:|
| At least one choice node | 100 % | 60 % | 70 % |
| Five or more choice nodes | 57 % | 30 % | 32 % |
| Under 25 lines | 0 % | 40 % | 30 % |
| Fifty or more lines | 71 % | 50 % | 41 % |

- The story-ranked list differs from the rest in having *conversation with a decision in it*. Every one of its seven has a choice node and none is short of lines. The reward-and-ease list shows no such pattern.
- **Size does not separate.** The story-ranked median is 433 nodes against 356 for all. Nodes correlate only weakly with lines. The decomposed Hacking the Hacker has 248 nodes and 10 lines; Hippocratic Oath has 461 nodes and 223 lines. So gig size is a poor proxy for quality, and effort spent on spawns and objectives does not buy the thing critics name.
- The reasons the author of the story-ranked list gives are about *what the job asks*: investigating (Woman of La Mancha, Dirty Biz, Breaking News), sparing or talking down a person (Gustavo Orta, Woman of La Mancha), sneaking in and out (Breaking News, A Lack of Empathy, No Fixers), and a voice (Psychofan, with commentary from Johnny). Those are conversation, a decision about a person, a non-lethal route, and a distinct tone.
- Phantom Liberty gigs carry about six times the lines and about fifteen times the choice nodes of the base median, and the sources praise them for moral choice. The expansion's gigs are a different design, not a better tuning of the same one.
- Against the decomposed seven: three (Hacking the Hacker, Radar Love, Family Heirloom) have under 25 lines and no choice node, and two (Serial Suicide, Greed Never Pays) have a single choice node. Hippocratic Oath and On a Tight Leash rank first and sixth for lines, and neither is in a favourites list; the hardest-gigs list notes that Hippocratic Oath hinges on a moral choice about a wounded gang member. Strong structure does not guarantee a ranking. Opinion data are too sparse to say whether the two are neglected or merely not chosen.

### 5.5 Principles: strong against forgettable

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-21 | A gig that people single out for story turns on a decision about a named person who has something to lose | [hypothesis] from opinion reasons and the counts above | GamesRadar: Orta and La Mancha (spare, talk down or kill), Dirty Biz (a father and a son, with a different reaction if one dies), Hippocratic Oath (a wounded gang member). Screen Rant on Phantom Liberty: the choice to hand over a captive | Gig · 2, 3, X | **Produce:** a `decision` beat with a person at stake, cast by query; the engine reserves authored or targeted craft for it (QST-09). **Check:** tag it, so evaluation can count gigs with and without one |
| QST-22 | Conversation carries the weight: strong picks have at least one dialogue choice and are not short of lines | [corpus], first pass (p about 0.07, n = 7) | §5.3 and §5.4 | Gig · 2, 4, E | **Check:** a measure for the corpus test: choice nodes and lines per gig, to be rerun when the rating protocol exists (§9) |
| QST-23 | Do not take node count or spawn count as a proxy for quality | [corpus] | Rank correlation of nodes with lines 0.41; the story-ranked median is only slightly above the base median; a 248-node gig has 10 lines | Gig · E | **Neither produces nor checks the engine's output:** it is a rule for evaluation and for budgeting authored effort |
| QST-24 | Make non-lethal, stealthy and investigative resolutions first-class outcomes, so the same job can be played as talk, sneak or fight | [practice] (one author's taste, plus Padre's gigs being called mostly killing); [corpus] (16 gigs have a pacifist variant) | GamesRadar's stated criteria; Dexerto; knowledge page §4.4 | Gig · 2, 4 | **Check:** each seed lists its resolutions by mode; at least one is not combat. Do not make a mode unreachable by a V who has no combat build |
| QST-25 | "Memorable" is not a stable label for base-game gigs. Two lists share one gig. A corpus test needs a rating protocol, not a literature survey | [corpus]; [analysis] | §5.1 | E | **Neither:** evaluation work. Rate all 73 gigs blind on named criteria, with the line and choice measures held back from the raters (§9) |

## 6. The heist

A heist is a job with a crew, a plan, a run and an aftermath. The craft traditions here are film (Bordwell), criminology (Cornish), and tabletop play (*Blades in the Dark*, Shadowrun, *The Sprawl*, *Leverage*, the Alexandrian).

### 6.1 The stages

Bordwell's five-part plot schema fits the other accounts (§4.1): circumstances push someone towards a job; initiators recruit; the crew studies, rehearses and plans; the job; the aftermath. Any stage can be stretched or shrunk. *Bob le flambeur* lingers on the circumstances, *Ocean's 11* on recruitment, *Rififi* on a wordless heist of about twenty-five minutes, and *Touchez pas au grisbi* on the aftermath.

Cornish's script has levels (universal script, metascript, protoscript, script, track) and components (scenes, paths, actions, roles, props, locations). Different tracks of one script come from swapping scene variants, which he draws as a cube of alternative scenes (the "script permutator"). Distractions, which are unexpected states that start new goals, can pull an actor out of a script, and scripts can be joined end to end (script concatenation).

### 6.2 The shipped example

The game's own heist, the Konpeki Plaza job in the prologue (spoilers fine, single sources: a plot summary and a walkthrough, both fan or encyclopedia pages):

| Bordwell stage | In the game |
|---|---|
| Circumstances | A fixer hires the crew for a theft from Arasaka |
| Recruitment | None. The crew (V, Jackie, a netrunner) is given |
| Study, plan | A briefing with the fixer and the netrunner; V places the hacking bot in the briefcase. The plan is shown, and V decides nothing |
| Run | Check in, reach the floor, the bot breaches the camera network, the safe is found by a hidden switch, V hides from the search |
| Complication | The crew witnesses a killing it was not meant to see, the bot sticks, a mech drops in, and Jackie is shot |
| Aftermath | A choice of where Jackie's body goes, which changes a later side quest and later dialogue; the fixer says the job went bad |
| Reveal | The fixer's betrayal follows the job (the plot summary places it after) |

So the shipped heist has everything except a plan for V to make. That fits the studio's story-first approach and leaves the planning space free for a procedural heist.

### 6.3 Planning without tedium

| Approach | How it keeps planning short | Source (status) |
|---|---|---|
| *Blades in the Dark* | The crew picks a plan type (assault, deception, stealth, occult, social, transport) and gives one detail (the point of attack, the method of deception, the point of infiltration, the route). One fortune roll sets the starting position: base 1 die, plus one for each major advantage (a bold approach, a weakness the plan exploits, friendly contacts), minus one for each major disadvantage (excess complexity, strong defences, rivals); a 6 is controlled, 4 or 5 risky, 1 to 3 desperate, and a critical skips the first obstacle. Flashbacks let a player establish preparation when it matters, at a cost of 0 stress for easy, 1 for complex or unlikely, 2 or more for elaborate; a flashback cannot undo what is already established | read (SRD) |
| The Alexandrian | Time limits so that gathering costs in-game time; failed research is costly (it tips off the target); "let it ride" rulings; narrative resolution of prep so players do not feel they guessed the one right approach; a forgiving run, because over-planning grows out of past punishment; say when information gathering is over; do not use a twist that wipes out the plan | read |
| Pathfinder *Ultimate Intrigue* | Prod the table with suggestions and deadlines; do not punish players because they could have planned better; split the execution into a separate session for complex jobs | summary |
| Shadowrun threads | Time-box legwork; give intel from the Johnson; run a mini-run for the resources the main one needs | summary; anecdote |
| *Leverage* RPG | Flashbacks and complications are what make it feel like the show | summary |
| Heist films | The planning montage previews the plan and builds anticipation; the run then goes at least a little wrong and is rescued by improvisation | read (Wikipedia, Bordwell) |

### 6.4 Principles: the heist

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| QST-26 | A job is a script whose stages each need actors, props, places and information. A generated job is valid only if the world can satisfy every stage | [analysis] | Cornish 1994. Instance: his robbery and auto-theft scripts | Heist · 2, 3 | **Check:** remove any required prop or role and the generator must re-route or mark the job infeasible. **Produce:** each stage's `requires` is a query over the record ([kernel §8](../spec/kernel.md#8-queries)) and casting resolves it |
| QST-27 | A job seed is a protoscript with swappable scenes. Its tracks are the combinations of scene variants that satisfy the stage requirements | [analysis] | Cornish's levels and his script permutator | Heist · 2, 4 | **Produce:** scene slots with alternative fillers, each with its own requires. **Check:** the number of valid tracks is reported to the author |
| QST-28 | A complication or an interference attaches to a stage, not to the job as a whole | [analysis] | Cornish's intervention points | Heist · 2, 3 | **Check:** every complication names its stage |
| QST-29 | Failure at a stage changes the next stage's preconditions (injury, alarm, lost time) and does not end the job. No twist should wipe out the whole plan | [practice]; [hypothesis] for the first clause | Alexandrian (fail forward; avoid a plan-wiping twist); Bordwell (the run going wrong is the genre's main pleasure and is usually rescued by improvisation) | Heist · 2, 3 | **Produce:** a stage failure writes a modifier into the next stage's `requires`. **Check:** no failed stage is a terminal |
| QST-30 | The five-stage schema is stretchable. A seed states which stages it expands and which it compresses | [analysis] | Bordwell's examples | Heist · 2, 4 | **Produce:** a per-stage weight in the seed; the engine may compress recruitment into an earlier gig or into the brief |
| QST-31 | Suspense needs the audience to know what the thieves do not. The plan is held as a belief by the crew; the truth lives in the world; the reveal revises the belief | [analysis] | Bordwell: the audience is told what the thieves may not know; *Ocean's 11* withholds its plan until about the midpoint; *The Killing* uses clock tags. The engine's perspectives ([foundation §5.4](../foundation.md#54-perspectives-everyone-has-their-own-model)) hold the same split | Heist · 1, 2, X | **Produce:** the plan as a belief bundle on each planner ([kernel §11](../spec/kernel.md#11-beliefs-and-perspectives)); a reveal pins the true state as observed. **Check:** the director may use what V cannot know only through channels an in-world actor could use (lens L2 F1; unverified) |
| QST-32 | Fold preparation into one legible state variable that sets the opening position of the run | [practice] | *Blades* engagement roll: advantages and disadvantages become dice, and the result sets controlled, risky or desperate | Heist · 2, 3 | **Produce:** preparation yields a small set of typed, perceivable `advantage` and `disadvantage` facts; a pure function maps them to an opening position. **Check:** each fact is perceivable by the player |
| QST-33 | Let preparation be settled at the moment it matters, for a cost, and never against what has already been established. **Limit under D-09:** the engine may do this for the crew's preparation and never for V's | [practice] | *Blades* flashbacks. Maps onto [DS-14](../design-seeds.md) and onto a late pin (`committed`) over an earlier time ([kernel §6.1](../spec/kernel.md#61-the-pin-record)) | Heist · 1, 2 | **Produce:** a `flashback` operation that pins an earlier crew action where the record leaves it open, with a cost drawn from a stated currency. **Check:** it refuses where the record already holds a contrary observation. A flashback for V is offered to the player, who accepts or declines |
| QST-34 | Control the planning phase: deadlines that cost in-game time, costly failed research, rulings that let a result stand, a clear end to each phase, and a forgiving run | [practice] | Alexandrian; Ultimate Intrigue; Shadowrun threads | Heist · 2, X | **Produce:** a planning stage carries a clock and a research cost. **Check:** the ratio of planning time to run time stays inside a stated band in play tests (P-9) |
| QST-35 | A crew is a set of capabilities and memberships. Each capability should be the answer to at least one obstacle. Each member holds a membership with visibility, strength and terms | [analysis]; [hypothesis] for "each used once" | Bordwell and the heist-film convention (a team in which each member brings a distinct skill); the *Leverage* roles (summary); [foundation §5.2](../foundation.md#52-groups-and-membership) | Heist · 2, 3 | **Produce:** casting by query on capability. **Check:** no crew member is idle; no obstacle needs a capability nobody has, unless the job marks it as a gap to fill |
| QST-36 | A complication should reveal something hidden about the patron or a crew member, not only add enemies. The reveal must come from a divergence that is already in the record | [practice]; [analysis] | Shadowrun 4E (unofficial excerpt); Bordwell (a betrayal or the identity of the traitor often becomes the central mystery). Warning from the same sources: "every patron betrays you" is a cliché | Heist · 2, 3 | **Check:** a reveal cites a membership with secret or deniable visibility or an interest conflict ([foundation §5.2](../foundation.md#52-groups-and-membership), [DS-62](../design-seeds.md)). Quality bar 1 forbids inventing one on the spot. **Produce:** choose from existing divergences; keep the base rate of betrayal a tunable |
| QST-37 | The aftermath is a stage. Payoff varies with how loud the job was; a ledger of exposure sets consequences that land before the player can prevent them | [practice]; [corpus] for how thin the shipped version is | *Blades*: heat 0 for smooth and quiet, 2 contained, 4 loud, 6 wild, plus 1 each for a high-profile target, hostile turf and a war with a faction, plus 2 if killing was involved; entanglements are chosen by heat and take effect first. *The Sprawl*: retaliation as a phase (summary). Game: retaliation in 16 gigs | Gig, heist · 1, 2, 3 | **Produce:** every job writes an `exposure` value to the record; the aftermath reads it and emits consequences (heat on a faction, a changed offer). **Check:** no job ends with the exposure ledger unread (P-5); the end is a peak-end spend (PER-04) |
| QST-38 | A long con has an escalation shape, and a loss needs cooling out. Maurer's stages: put up the mark, play the con, rope, tell the tale, convincer, breakdown, send, touch, blow-off, fix. Goffman's cooler stays with the mark and reframes the loss | [analysis]; Maurer's data are anecdotal; Goffman and Maurer read only through summaries | Maurer 1940; Goffman 1952 (citation confirmed) | Arc · 2, 3 | **Produce:** a `con` profile for jobs where V is the mark or runs the con; a cooler role cast after a loss as an *offer from a person*, never a lecture. **Check:** an unwelcome loss triggers a reframing offer. Keep within D-09: the engine never tells V how to feel |

## 7. Tensions

| Tension | One side | The other side | How to settle it |
|---|---|---|---|
| Causal chain or slack | Every beat is *therefore* or *but* (QST-01) | Over-causal plots feel contrived, and open-world players want slack (map) | Causal inside a unit, open between units, texture beats flagged (QST-02) |
| Unity or episode | One spine (Mateas) | Gigs are small encounters, each with a story (Weber) | Declare which (QST-02) |
| Consequence or no penalty | Failure resolves into a consequence (QST-15) | Declining should carry none (map) | The world moves on; no punishment |
| Several ways through or authoring cost | Goal, obstacle, affordances (QST-17) | Hand-built parallel paths multiply cost (Deus Ex) | Affordances by predicate over general capabilities (QST-18) |
| Planning depth or tedium | A plan the player owns | Planning swallows the session (F-08) | Plan type, one detail, a rolled position, late flashbacks (QST-32 to QST-34) |
| Equal quality or peak-end | CD PROJEKT RED gives all quest types equal quality (map) | Spend the craft on the peak and the end | The decision beat (QST-21) and the aftermath (QST-37) are where to spend |
| Typed shapes or no typology | The generator needs shapes (QST-08) | The studio avoids typing content (QST-07) | Shapes are internal profiles; the player sees situations; labels are for evaluation |
| Betrayal as reveal or cliché | The reveal gives a complication meaning (QST-36) | "Every patron betrays you" is worn | A tunable base rate, and only from a divergence already in the record |
| The engine fills a past or V's past | A flashback is the cheapest way to settle preparation (QST-33) | V is observed, never owned (D-09) | Late-bind the crew's past; offer V's |

## 8. Lateral links

- A *Blades* flashback is a **late pin**: settled when needed, consistent with what is already observed ([kernel §6](../spec/kernel.md#6-pins-time-and-propagation)). The engagement roll is a **summary** that is opened when the run starts (kernel §9.3).
- Cornish's script permutator is a **dimension of scene variants**, with a requires query per variant.
- Alexandrian's node-based design is a **graph in which every node has at least three in-edges**: the same shape as a conclusion with three clue routes.
- A gig's counters, tier facts and thresholds are **storylet preconditions** (L2 F3, L9 field 3) that a fixer phase flips.
- Daggerfall's quests (resources, conditions, actions, clocks) are a **comparison for the seed language**: a quest declares named resources and clocks and chains tasks through conditions (§10). The Daggerfall Unity status page lists the five resource types (Place, Person, Item, Clock, Foe) and some seventy conditions and actions.
- Maurer's stages and Bordwell's schema are **the same escalation seen from the mark and from the crew**.
- The four-beat shape in Mario level design (introduce, develop, twist, conclude) is the same idea as Sanderson's payoff being surprising and fulfilling: the twist recontextualises what was set up.
- A gig's wiring (brief, objectives, outcome fact, debrief, reward, counter) is the **same shape as an event with causes and effects** ([kernel §9.2](../spec/kernel.md#92-events)): a seed commits fields as `committed` pins when it resolves.

## 9. Open questions

1. **A rating protocol for the corpus test.** Blind raters score all 73 base gigs on named criteria (story, voice, decision, replay), without seeing the line and choice counts. Choose criteria that separate story from reward; TheGamer's list shows the two mix.
2. **Count the missing text.** Include fixer call scenes under the holocall folder, shards and texts in the line counts. Dirty Biz suggests the undercount is large for gigs told through shards.
3. **What follows a failed gig in the data?** I traced counters only. A game session could check whether a failed gig changes later offers.
4. **Does the guide's gig-type label show in the game?** If it does, "no typology" (QST-07) is a design intent and not a player's experience.
5. **How often should a patron betray?** A folk figure of about one in ten circulates in tabletop forums; it is anecdote. Treat as a tunable and test it.
6. **Who plans?** Under D-09, V's plan is the player's. Whether the engine should offer plan types at all, and in what interface, is a P6 and P8 question.
7. **Strategy-game events.** Reach primary sources (Paradox's modding documentation, Sylvester's talks) before drawing any principle from weighted event tables.
8. **Optional objectives and outcome facts.** Which optional objective feeds which fact is untraced; a trace would show how a "perfect" outcome is judged.
9. **The Phantom Liberty step-change.** Is the leap in lines and choices a different team or a different brief? It matters for how much of the base-game wiring to treat as a floor.
10. **Is the person-at-stake feature (QST-21) necessary or only common?** A test: build one gig with and without a person-at-stake decision, keeping the wiring fixed, and compare blind.

## 10. Requirements for the seed language (P4)

What a seed must be able to say. Each requirement traces to a principle (QST) or a corpus finding (§5, §4.2). "Comparison" lines are outside systems cited to cross-check, never as sources of the engine's concepts (D-21).

| # | Requirement | Traces to |
|---|---|---|
| R-1 | A seed binds as much as its author wants. Every role, place, time and cause is **fixed**, **preferred** (with a strength) or **open**, with an intent note | [DS-35](../design-seeds.md), [DS-42](../design-seeds.md), D-03; QST-04 |
| R-2 | A seed has a **purpose** and a **context** as required fields, and no field whose value selects a rule by type | QST-04, QST-07 |
| R-3 | A seed names its **client as a blocked goal** (a reference to a frame) and states **what the client stands to lose** | QST-05, P-2 |
| R-4 | Beats are a graph with **typed links**: `because` (cites a record entry), `obstructed-by`, and `then` for beats flagged texture. A validator rejects a seed whose only link is order | QST-01, P-4 |
| R-5 | A seed declares **unity**: within (all beats causal) or across (optional threads, callbacks) | QST-02 |
| R-6 | A **promise ledger**: typed promises with opened-at, progress events and state (open, paid, retired); a seed cannot resolve with an unmarked open promise | QST-03 |
| R-7 | **Offer conditions apart from content**: unlock ladders and counters, thresholds, batching, a channel pair (call or text, with a fallback), a cap and a memory of past wordings and templates | QST-10, P-3, §4.2 |
| R-8 | A **gig profile** that composes the eight parts (id and pin, unlock, brief and debrief, objectives, encounter apart from narrative, finish and fail facts, reward by route, retaliation), so wiring is produced and not hand-written | QST-08, QST-09 |
| R-9 | **Route variables** set by player acts, each with at least one declared consumer (a debrief, a reward, a consequence). A route with no consumer is rejected | QST-11, QST-12 |
| R-10 | **Objectives with states** (Active, Succeeded, Failed, Inactive) and **condition objectives** (stay unseen, do not kill) that are measurable and perceivable | QST-12; §4.2 |
| R-11 | **Reward as a policy reference** (a table by tier and route), never a literal inside the seed | QST-13 |
| R-12 | **Failure forms**: a `warning` state before any failure from distance, time or neglect; every failure has an outgoing consequence edge | QST-14, QST-15, P-5 |
| R-13 | **Reconvergence**: graphs have joins; a variant axis is a condition on one graph, not a copy; a bound on live paths per length | QST-11; Ashwell; Weber |
| R-14 | An **aftermath stage** with delay, signpost and cancel condition, reading an **exposure ledger** written by the run | QST-16, QST-37, P-5 |
| R-15 | **Goal, obstacles and affordances**: each obstacle lists at least two affordances, each a capability predicate with a cost and an exposure; no hidden roll decides an outcome | QST-17, QST-18 |
| R-16 | **Resolution modes** declared per seed (talk, sneak, fight, hack), with at least one non-combat mode reachable by any V | QST-24 |
| R-17 | A **conclusion node** with at least three independent clue routes and a hypothesis-consistency vector per clue | QST-19, QST-20 |
| R-18 | A **decision beat** with a named person at stake, taggable so evaluation can count it | QST-21, QST-22 |
| R-19 | A **stage script** for jobs: ordered stages, each with a `requires` query, an interference attachment, and a failure modifier written into the next stage; per-stage weight | QST-26, QST-28 to QST-30; Cornish |
| R-20 | **Scene slots with variants**, each variant with its own requires; the seed reports its number of valid tracks | QST-27; Cornish (comparison) |
| R-21 | **Crew roles** as capability plus membership (visibility, strength, terms), with a check that every capability meets an obstacle | QST-35; [foundation §5.2](../foundation.md#52-groups-and-membership) |
| R-22 | A **plan as a belief** held by its planners, with the truth in the world and a **reveal** operation that pins the true state as observed | QST-31; [kernel §11](../spec/kernel.md#11-beliefs-and-perspectives) |
| R-23 | **Preparation as state**: typed advantages and disadvantages with a pure function to an opening position, and a **flashback** operation that late-pins crew preparation at a cost where the record leaves it open. Never for V without the player's acceptance | QST-32, QST-33, D-09 |
| R-24 | **Dependencies**: a seed declares the people, places and facts it needs to stay as they are, so world autonomy can hold them or substitute for them. A seed also declares its cadence limits (how often it may recur, how often a reaction may fire) | F-01, F-02, P-6, P-7 |
| R-25 | A **planning stage** carries a clock, a research cost and a phase end | QST-34, P-9 |
| R-26 | A **reveal from the record**: a betrayal or hidden fact cites an existing divergence, and has a tunable base rate | QST-36 |
| R-27 | **Nesting**: a gig seed can sit inside an arc seed, and a small promise feeds a larger one | QST-03; [DS-28](../design-seeds.md), [DS-09](../design-seeds.md) |
| R-28 | **Shape templates are data**, not code. A four-beat template (introduce, develop, twist, conclude) sits beside the job profile; a template's slots carry the same bindings as any seed | QST-40; QST-39 |
| R-29 | A **con profile** for long escalation about one mark, with an optional cooler role after a loss | QST-38 |
| R-30 | **Provenance on every beat**, so a "why" trace can show the cause, the casting and the fit | [kernel §13](../spec/kernel.md#13-provenance-and-explanation); QST-01 |

Daggerfall's quest language is a useful comparison for R-3, R-4, R-9 and R-10. A quest names its resources (place, person, item, clock, foe), declares conditions that start tasks, and chains tasks through actions such as `start task`, `pick one of`, `prompt` and `end quest`. It has no stake, no cause link and no aftermath. Its shape is a sound floor and shows what an unaided grammar leaves out.

## 11. Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give.

| # | Field | Source | Tier |
|---|---|---|---|
| M-1 | **Quest scripting languages as comparisons for a seed language** (Daggerfall's resources, conditions, actions and clocks) | Daggerfall Unity quest system status page (read) | Supporting |
| M-2 | **Heist-film narratology** (Bordwell 2017; Lee 2014, *The Heist Film: Stealing with Style*; Sloniowski and Leach 2017, *The Best Laid Plans*) | Bordwell (read); the other two are titles from Wikipedia's reference list | Supporting for NAR-06; core for the heist scale if heists become a product |
| M-3 | **Four-beat structure from level design** (kishotenketsu in Mario levels) | Hayashida interview, *Game Developer* (read) | Supporting |
| M-4 | **Pattern-instantiated quest scripting** (ScriptEase quest patterns; Sullivan's Grail framework with QuestBrowser and Grailgm) | Thesis abstract and Sullivan abstract (read) | Supporting |
| M-5 | **Planning-control craft for player-owned operations** (fail forward, let it ride, flashbacks as late binding, phase locking) | Alexandrian; *Blades* SRD (read) | Supporting; it sits under CRA-01 but no field names it |
| M-6 | **Payout and reward calibration for jobs** (pay by district, not size; effort against pay) | Knowledge page §5 (TweakDB records); *Blades* payoff table (read) | Supporting |
| M-7 | **Exposure and heat ledgers** (noise-driven consequence; faction pressure variables) | *Blades* SRD (read); *The Sprawl* (summary) | Supporting; related to SYS fields on faction pressure |
| M-8 | **Crew and ensemble capability design** (roles as affordances; each member needed once) | Bordwell (read); *Leverage* roles (summary) | Supporting |

## 12. Credit candidates

Each third-party work that taught us something used above. Status of the link: all opened in this session unless marked. Creator names are as the page shows them; where a page did not show an author, none is given.

| Creator | Title | Link | What we learned |
|---|---|---|---|
| Bruce Nesmith (reported by GamesBeat) | Report of his Game Design Expo talk on Radiant Story | https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/ | Realistic reactions are not always good play, and a generated quest needs a fit between role and filler |
| GamesBeat column (author not captured) | "Dimming the Radiant AI in Oblivion" | https://gamesbeat.com/dimming-the-radiant-ai-in-oblivion/ | Autonomous agents can remove the people a quest needs |
| Inverse (Justin Andress, per L2) | "An ode to Preston Garvey" | https://www.inverse.com/article/14519-an-ode-to-preston-garvey-the-minuteman-of-fallout-4-who-deserves-a-defender | How an offer with no memory or cap reads to players |
| Jonathon Doran and Ian Parberry | "A Prototype Quest Generator Based on a Structural Analysis of Quests from Four MMORPGs" | https://ianparberry.com/pubs/pcg2011.pdf | A motive grammar produces plausible shapes and, unaided, errand chains |
| Anne Sullivan, Michael Mateas and Noah Wardrip-Fruin | "Making Quests Playable" | https://ojs.gold.ac.uk/index.php/lea/article/view/183 | Role-playing quests are mostly task lists with variation only in combat or one binary choice |
| Yu, Guzdial and Sturtevant | "The Definition-Context-Purpose Paradigm..." | https://arxiv.org/abs/2110.04148 | Developers define quests by purpose and context, not by elements |
| Michael Mateas | "A Preliminary Poetics for Interactive Drama and Games" (host copy) | https://www.cs.uky.edu/~sgware/reading/papers/mateas2001preliminary.pdf | Unity of action against episodic structure, and agency as an effect that relates to intent |
| Paweł Sasko (summarised by Game Developer) | "10 Key Quest Design Lessons..." GDC 2023 | https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3 | Delayed but visible consequences; signal against noise |
| Philipp Weber (reported by Game World Observer) | Quest design developer spotlight | https://gameworldobserver.com/2019/09/13/quests-witcher-cyberpunk-2077 | Street Stories are small encounters with several ways through, and the studio avoids typing quests |
| 80.lv | "CD Projekt Red reveals the secret key to impressive side quests" | https://80.lv/articles/cd-projekt-red-reveals-the-secret-key-to-impressive-side-quests | Pitch volume and acceptance rate in the studio's process |
| Game Developer (Justin Carter) on a GDC talk by Hennessy | Watch Dogs: Legion writing | https://www.gamedeveloper.com/marketing/how-i-watch-dogs-legion-i-made-ubisoft-rethink-its-storytelling | Writing for unknown actors needs authored anchors; one-off missions leave no lasting consequence |
| Sam Kabo Ashwell | "Standard Patterns in Choice-Based Games" | https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/ | Named branching structures and which collapse without volume |
| Emily Short | "Small-Scale Structures in CYOA" | https://emshort.blog/2016/11/05/small-scale-structures-in-cyoa/ | Beat-level choice patterns |
| Josh Sawyer (PCGamesN) | Interview on branching dialogue and AI | https://www.pcgamesn.com/josh-sawyer-branching-dialogue-ai | Authorship, not disk space, is the bottleneck of reactivity |
| Justin Alexander | "Scenario Structure Challenge #4: Heists"; "The Three Clue Rule" | https://thealexandrian.net/wordpress/42867/roleplaying-games/scenario-structure-challenge-4-heists ; https://thealexandrian.net/?p=46236 | Five steps of a heist and how to keep planning short; three routes to every conclusion |
| John Harper | *Blades in the Dark* (SRD text read on Roll20 and a GitHub copy) | https://bladesinthedark.com/ | Plan type, engagement roll, flashbacks, heat and entanglements |
| David Bordwell | "One last big job: how heist movies tell their stories" | https://www.davidbordwell.net/blog/2017/10/12/one-last-big-job-how-heist-movies-tell-their-stories/ | A five-stage heist plot that can be stretched, and suspense built on what the audience knows |
| Derek Cornish | "The procedural analysis of offending..." (1994) | https://popcenter.asu.edu/sites/default/files/library/CrimePrevention/Volume_03/06_cornish.pdf | A job as a script with levels, tracks and interference points |
| Brandon Sanderson | 2025 plot lecture write-up | https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2 | Promise, progress and payoff, and nested plots |
| Reagan, Mitchell, Kiley, Danforth and Dodds | "The emotional arcs of stories are dominated by six basic shapes" | https://arxiv.org/abs/1606.07772 | Sentiment arcs of finished texts, and their stated limit |
| Warren Spector and the Ion Storm team | Deus Ex postmortem, *Game Developer* | https://www.gamedeveloper.com/design/postmortem-ion-storm-s-i-deus-ex-i- | Multiple solutions were hand-built when the simulation was too shallow |
| Koichi Hayashida (Game Developer interview) | "The secret to Mario level design" | https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design | A four-beat shape with a surprise, tied to four-panel comics |
| Daggerfall Unity project (posts by "Interkarma") | Quest system status | https://www.dfworkshop.net/projects/daggerfall-unity/roadmap/quest-system-status/ | A readable quest language of resources, conditions, actions and clocks |
| Dhami, Belton and Mandel | "The 'analysis of competing hypotheses' in intelligence analysis" (summary read only) | https://repository.mdx.ac.uk/item/8834v | The debiasing evidence for competing-hypotheses analysis is mixed |
| Erving Goffman; David Maurer (secondary summaries only) | "On Cooling the Mark Out" (1952); *The Big Con* (1940) | https://kieranhealy.org/blog/archives/2002/10/31/cooling-the-mark-out/ ; https://en.wikipedia.org/wiki/Scam | The cooler role after a loss; the stages of a long con. **Not credit-ready**: the primary works were not read |
| TheGamer, GamesRadar, Screen Rant, NME, Dexerto, PowerPyx | Gig and side-quest lists and polls named in §5.1 | https://www.thegamer.com/cyberpunk-2077-best-gigs-walkthroughs/ ; https://www.gamesradar.com/best-cyberpunk-2077-gigs/ ; https://screenrant.com/cyberpunk-2077-phantom-liberty-best-gigs-dlc/ ; https://www.powerpyx.com/cyberpunk-2077-all-gigs-list-walkthroughs/ | Opinion data for the first corpus test. Low priority; publications, not design sources |
