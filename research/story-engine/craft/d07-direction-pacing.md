# Dossier 7: direction, pacing, offer timing and dread

**Status:** v1, 22 October 2026. Dossier 7 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: SEL-03 (drama and experience management), PAC-03 (suspense, tension and affective pacing), PAC-04 (AI directors and pacing systems), PAC-05 (interruption cost and attention arbitration), CRA-16 (wargame adjudication and exercise control). Supporting fields: PAC-06 (alarm management and queueing), PAC-07 (control theory), PAC-08 (stakes and leverage), PAC-09 (open loops, the quest log, hooks), CRA-03 (immersive theatre), CRA-05 (escape-room game mastering), CRA-06 (stage management and show control). Feeds P5 (the procedural engine, which owns the director) and P4 (the seeding layer, which owns the scheduler). It serves quality bar 7, "pacing: tension builds and rests, never spam and never a dead city", and quality bar 4, "offer, never control" ([plan §1](../plan.md#1-what-doesnt-suck-means), [D-09](../decisions.md)). It builds on [dossier 5](d05-units-variety.md) (separation, bags and growing chances: VAR-18 to VAR-23) and [dossier 3](d03-fitting-casting.md) (FIT-06, FIT-31, FIT-32, FIT-45, FIT-48, which hand the pacing model and the arbiter to this dossier).

**In brief**
- **Every shipped director steers how often, not how hard, from a crude estimate, and none has a baseline.** Left 4 Dead keeps one intensity number per player, raised by damage and nearby kills, decaying unless enemies are engaging, and cycles through four phases (a sustain of 3 to 5 seconds, a relax of 30 to 45 seconds; mobs come at random 90 to 180 second intervals). I read the slides. A 2024 study of quest-selection directors states that it has no comparative data on the Left 4 Dead director against no director (§2, DIR-01, DIR-04).
- **The two designs worth copying are cheap and neither has player data.** Alien: Isolation splits a director that always knows where the player is from a hunter that must find them. Watch Dogs: Legion puts every request for the player's attention through one arbiter with a type, an importance, the distractions it tolerates and a maximum wait. Legion's author says the system cannot tell whether the player is actually looking (DIR-03, DIR-13).
- **Intensity and interruptibility are different quantities.** A conversation is low in arousal and high in load. The model keeps a situation-intensity estimate, a set of attention flags and a thread-pressure count apart, and takes the maximum, not the mean, across sources (DIR-11, DIR-12).
- **Interruption research gives a usable rule.** Defer to a breakpoint, let the offer's relevance to the current activity decide how coarse a breakpoint is needed, give a warning lag of about 8 seconds before a disruptive event, and let the player negotiate. In a toy model of play (§5.8, inputs assumed), gating a silent message on activity state delivers it at once three times in four. Requiring a coarse breakpoint for every offer makes the mean wait 4 to 10 minutes (DIR-14 to DIR-19).
- **Queues clump, and a cap makes them back up.** With 8 requests an hour released at the first free moment, the toy model delivered up to 4 in one minute and 8 in ten. A cap of 2 per 10 minutes removes the bursts, but the queue then needs arrivals under about a third of the cap, or the 90th-percentile wait passes ten minutes. The same arithmetic means pacing must run on the play clock, not the game clock, or a night's sleep releases a night's backlog (DIR-24, DIR-30, DIR-34).
- **Rest means withholding our own additions.** The engine cannot make the base game calm. It reads the intensity the game already supplies and adds nothing on top. Rest never blocks pull: a player who goes looking for something finds it (DIR-27, DIR-29, DIR-37).
- **Dread can be turned into rules, on thin evidence.** Disclose before acting. Let each trace shrink the ways out. Run a visible clock. Move the threat through distal, proximal and imminent stages. Let the threat find the player, with the director's help showing only as traces in the world. Then pay off and rest. The evidence is small lab studies, designers' accounts and theory. Several lens claims did not survive checking (§3.3, DIR-41 to DIR-53).
- **Reactive pacing should only subtract.** The base rhythm is a deterministic schedule that survives a reload (RimWorld's Cassandra keeps fixed phase dates across saves). The reactive layer may hold, delay or withdraw, never add, which keeps delay-driven oscillation and "the director is after me" feelings small (DIR-35, DIR-36, tension T-3).
- **Magnitudes here are mostly judgement.** §5.1 sorts every number into evidence or judgement, and §5.9 lists what the harness must measure to replace the guesses.

## 1. Scope and why it matters here

A seed is a partly resolved quest, and the engine will always have more things it could offer than a person can take in. This dossier asks: what may surface, when, through which channel, at what rate, with what lead time, and how is tension built and released without taking a choice from the player? Layer 3 decides what is worth surfacing and steers. Layer 2 holds the scheduler that releases it. The split matters, because the shipped systems that work (Legion's arbiter, Alien: Isolation's director and hunter) each have two parts.

| Layer or concern | What this dossier gives it |
|---|---|
| 3. Procedural engine (the director) | The director's verbs and their limits; the estimates it keeps (situation intensity, load, thread pressure); the phase machine and rest rules; thread budgets; dread rules; the split between what the director knows and what a threat knows (§4, §5) |
| 2. Seeding (scheduler, seed lifecycle) | The arbiter: the request record, attention aspects, breakpoints, category spacing, expiry and withdrawal; lead-time classes; warn, standby and go for staged beats (§4.3, §5.5, §5.7) |
| 4. Authored content | What an author can say about timing: a request's importance, tolerated distractions, maximum wait and lead-time preference; how a fixed window pierces rest (§9, P4 list) |
| 1. Simulation | Two clocks (a play clock for people, game time for the world); events stamped with both; the senses the estimators read (§5.2, §9) |
| Evaluation (E) | Measures and a calibration plan for every judgement number; the baseline a director must beat (§5.9) |
| Expression (X) | Channels ranked by how much they interrupt (§5.3) |

**Evidence used from the repository, read-only:** the [runtime requirements](../runtime-requirements.md) (senses S1 to S6), [game events](../../../knowledge/game-events.md) (what the game can report and at what rate), [player channels](../../../knowledge/player-channels.md) (what each channel can carry and where vanilla pre-empts), [open-world activities](../../../knowledge/open-world-activities.md) (how the base game offers and re-arms things), the [kernel spec](../spec/kernel.md) (§9.4 evolution windows, §10 relevance and work limits, §11.3 beliefs about V), the [foundation](../foundation.md) (the director as an actor with drives of tension, variety and relevance to V), and dossiers [3](d03-fitting-casting.md), [4](d04-quest-structure.md) and [5](d05-units-variety.md).

**Grades.** [empirical], [practice], [shipped], [corpus], [analysis], [hypothesis] as in P1 §4. **contested** marks a claim two sources dispute. Source status: *read* (fetched and read this session), *summary* (only a search summary or a lens's account was seen), *memory* (recalled, not rechecked). Where a source is a vendor page, a wiki or a secondary write-up, the grade is [sec] and any number is a starting value. Numbers marked **[J]** are my judgement, with the reason given. Numbers marked **[sim]** come from the toy model in §5.8, whose inputs I assumed.

**Wording.** "Situation intensity" is a property of what the game is doing around V (combat, a chase, damage). It is never a claim about V's feelings (D-09). "Push" means the engine starts an offer (a message, a call, an approach). "Pull" means V goes looking (a map pin, a scanner entry, a place). "Play time" means seconds of unpaused play with the world in view. "Game time" is the game's clock.

## 2. The failure record

Failures first (P1 §2.4). §2.1 lists cases, §2.2 diagnoses patterns, §2.3 lists where the disciplines' own advice fails.

### 2.1 Cases

| # | Case | What was tried | What went wrong, or what is not known | Evidence |
|---|---|---|---|---|
| F-01 | **Left 4 Dead's director** (Valve, 2008) | One intensity scalar per player, phases of build up, peak, fade and relax, and a procedural population of enemies and loot | The proxy is built from combat only. The director has one main verb (how many enemies spawn). Bosses are exempt from it. The slides list a wider set of verbs as future work. Forum threads from single-player users call the director unfair (swarms within two minutes of a level start, with no upgrades or health to hand). A game-design essay calls the line between productive discomfort and toying with players fine. A 2024 paper states there is no comparative data on player experience with or without it. The benefit is assumed | *read*: Booth's slides [shipped]. *Summary*: a TechSpot thread, Serviss 2013 [community, weak]. *Read*: Yu, Guzdial and Sturtevant 2024 [empirical, for the gap] |
| F-02 | **RimWorld's storytellers** (Ludeon, 2018) | Three personalities choosing events by cadence, with threat size set by colony wealth and a separate difficulty setting | The wiki records that wealth scaling and the choice of storyteller interact with difficulty, that Randy can send hard raids back to back (a random factor of 0.5 to 1.5 on raid size) as an intended drama, and that Phoebe's gentle cadence still hits hard at high difficulty. A wealth-independent mode exists, and the wiki notes its own trade-off: too easy for a player who gets ahead, and recovery from heavy losses may be nearly impossible. No systematic data on how players feel manipulated | *read*: RimWorld wiki pages [shipped; wiki; some pages tagged unverified] |
| F-03 | **Alien: Isolation** (Creative Assembly, 2014) | A hunter on a behaviour tree plus a director with a menace gauge that sends it away at peak pressure | The behaviour tree alone could trap the player in a corner or lose them, and the director was added to pace pressure. Even so, reviews call the game too long. One critic reports annoyance replacing tension about two-thirds through, and argues that dealing with the alien feels the same at hour 15 as at hour 1, so mastery stops being tested. One review scores it 5.9 out of 10 on repetition and padding. The director fixed rhythm; it did not fix a flat curve | *read*: Thompson in Game Developer, 2017 and 2020 [shipped, critique]; Jensen in Game Developer, 29 Oct 2014 [community essay]. *Summary*: the IGN score, through a search result |
| F-04 | **Watch Dogs: Legion's missions and banter** (Ubisoft, 2020) | Missions and contextual dialogue that start by themselves, so the world seems not to wait | Early on, each mission chose its own start. A random side mission could start after a main mission ended on a cliffhanger, and banter played during combat. The fix was one arbiter. A later problem: unrelated narrative began as V neared a tracked objective, which confused players, and "near the objective" became another attention aspect. The author reports "very positive" results with no metrics, and says the system cannot know whether the player is paying attention | *read*: Horneman, Ubisoft Toronto [shipped] |
| F-05 | **Drama managers** (Weyhrauch 1997 to Riedl and Bulitko 2013) | Search or learning over plot points, with an author-written evaluation function | Evaluated on small closed story worlds, often with simulated players. The hand-built evaluation functions and plot-point lists are expensive; Façade took over five years. Nobody deployed one in an open world. The field's own surveys concede an evaluation gap. A designer-side worry: a manager that alters the world against what the player has come to expect can break the player's sense of agency | *read*: Nelson et al. 2006 [analysis]. *Summary*: lens L8 for the rest; Wardrip-Fruin et al. 2009 and Fisher, Siler and Ware 2025 for the agency worry |
| F-06 | **Fallout 4's settlement requests** | Endless "a settlement needs help" jobs | No memory of what was just offered, no cap, no gating on what V is doing. Named within a week. See [dossier 5](d05-units-variety.md) F-02 and [dossier 4](d04-quest-structure.md) P-3 | *read* there [shipped] |
| F-07 | **Alarm floods** (process industries) | Many alarms to a few operators | Floods, stale and chattering alarms; operators stop trusting alarms. The "cry wolf" effect itself is not settled: studies of weather warnings are mixed, some finding that high false-alarm ratios lower compliance, others finding weak or no effect of perceived false-alarm rates | *summary*: vendor and consultancy pages for the EEMUA and ISA figures [sec]; a socio-meteorology review for the mixed record [empirical, mixed] |
| F-08 | **Amnesia's sanity meter** (Frictional, 2010) | A hidden measure, made visible only in the inventory, that falls with darkness, monsters and horrific events and distorts the screen | The designer later named item hoarding and a systemic approach that made the experience less engaging. Players treated a pacing device as a resource to manage | *read*: Grip, Game Developer, 27 Aug 2014 [practice] |
| F-09 | **Majestic** (EA, 2001) | A story pushed by phone, fax and email on the game's own schedule, with daily progress capped | About 800,000 signed up for the free first episode and about 71,200 finished it. EA's communications director said players wanted their own speed and were made to wait. Retrospectives disagree on how much was pacing, since the second episode launched days before 11 September 2001 and the game was age-restricted | *summary*: Engadget and encyclopedia pages [sec; causes contested] |
| F-10 | **Immersive theatre's private scenes** (Sleep No More) | More audience than performer capacity, with one-on-one scenes given by approach | One blogger's back-of-envelope estimate is that 10 to 15 per cent of a night's audience get a one-on-one scene. A critic recalls leaving sure she had missed the important parts. Alston's book critiques "empowerment" as work the audience does for the producer | *summary*: a Substack estimate (rough, not an official figure); Alston's abstract [analysis]. The lens's 10 to 15 per cent is the blogger's guess |
| F-11 | **Escape-room hints** | A game master or a timer releases hints | Poor timing is the main risk: a hint arriving just as the team solves the puzzle. A fixed time release can repeat what the team knows. Hard limits can leave a team stuck with no way on | *read*: Spira, Room Escape Artist, 24 Oct 2019 [practice] |

### 2.2 What the failures have in common

| # | Pattern | Cases | What is missing | A test that catches it | Where this dossier answers it |
|---|---|---|---|---|---|
| P-1 | **Pushing with no sense of what the player is doing** | F-04, F-06, F-09 | An arbiter with attention aspects and a maximum wait | Share of offers delivered inside combat, dialogue or near a tracked objective | DIR-13 to DIR-25 |
| P-2 | **One crude proxy, regulated hard** | F-01, F-02, F-08 | Separate estimates; reactive pacing that only subtracts; no reward for gaming the proxy | Divergence between the proxy and player ratings; players hoarding or timing around the meter | DIR-05, DIR-35, DIR-36, DIR-53 |
| P-3 | **Rhythm fixed, mastery flat** | F-03 | Variation in what the threat does, not just when | Rated tension by hour; the learner bot of dossier 5 on threat behaviour | DIR-26, DIR-52 |
| P-4 | **Help the player can detect** | F-01, F-03 (design intent), F-05 | Director hints that appear as in-world traces; a director that is not the threat | A "does the threat know where I am?" probe in sessions | DIR-03, DIR-06 |
| P-5 | **Queues that clump or back up** | F-06, F-07, F-09 | Spacing, caps, expiry, arrival limits | Burst size in 60 s and 10 min; share of offers expired | DIR-24, DIR-30, DIR-31 |
| P-6 | **A manager that is not tested against doing nothing** | F-01, F-05 | A no-director baseline and a leverage measure | Rated experience against a fixed schedule and a random schedule | DIR-04, §5.9 |
| P-7 | **Tension with no release, or release smaller than the build** | F-03, F-09 | Stage dwell caps, a payoff that matches the dread, enforced rest | Rated tension and annoyance by hour of play | DIR-49, DIR-50 |
| P-8 | **Cadence the player learns and waits for** | F-02, F-06 | Jitter; pull content during rest | Whether synthetic and human players delay actions until offers arrive | DIR-36, DIR-37 |

### 2.3 Where the advice itself fails

- **Directors.** The proxy is built for four-player half-hour campaigns where intensity is combat. Whether narrative intensity can be estimated from non-combat play is untested (lens L8). Directors regulate pressure, not plot (lens L9). Tuning was long and manual. The one shipped director with a peer-reviewed comparison gap is the best known.
- **Drama management.** The narrative paradox is unresolved: stronger management reduces freedom, weaker management loses the arc. Every system needs an author-written plot-point set and evaluation function. The authorial-leverage measures (Chen, Nelson and Mateas 2009) say a manager that does no better than a trigger script should be a trigger script. Those measures have not been applied to a director for an open world.
- **Interruption research.** Almost all of it is desktop or phone work, with workers and tasks such as diagram editing and programming. Breakpoint detection from interaction logs finds about 52 to 59 per cent of breakpoints with 64 per cent precision, and cannot tell a breakpoint's size reliably (Iqbal and Bailey 2008). Interruption studies of games are sparse and mostly about adverts, questionnaires and VR notifications, not about story offers.
- **Suspense and dread research.** The lab studies are small, short, mostly text or film, and some are conference abstracts. The theory (Lehne and Koelsch 2015) says plainly that the effect of delaying resolution has little empirical support and that the best delay is an open question. The paradox of suspense (tension survives re-exposure) is unresolved.
- **Alarm management.** The figures are for operators who watch a plant on duty. A game that sent one alert per ten minutes would feel empty. Only the structure transfers (lens L11).
- **Control theory.** The plant is non-stationary, partly adversarial and unobservable, and the set point is aesthetic. It names failure modes (delay, windup, proxy gaming) but cannot supply numbers.
- **Escape-room mastering.** Evidence is practitioner opinion. A hint is a rescue in a closed, timed room. In an open world, apparent stalling is often a choice.
- **Wargame exercise control.** Built to train and to evaluate, not to delight. Scripts can teach participants to wait for the next inject.

## 3. Sources

Source status as defined in §1. "Credit" says whether [the community credits](../../../docs/community-credits.md) already hold an entry for the creator (checked by name).

### 3.1 Read

| Work | Used for | Credit |
|---|---|---|
| Michael Booth, "The AI Systems of Left 4 Dead", Valve, AIIDE 2009 (all slides, text extracted) | DIR-01, DIR-12, DIR-27, DIR-26; F-01 | Exists (Valve and Booth) |
| Jurie Horneman, "Watch Dogs: Legion and the Player Attention System", Ubisoft Toronto | DIR-13, DIR-23, DIR-24; F-04 | to add |
| Tommy Thompson, "The Perfect Organism: The AI of Alien: Isolation" and "Revisiting the AI of Alien: Isolation", Game Developer | DIR-03, DIR-45, DIR-52; F-03 | to add |
| Nelson, Mateas, Roberts and Isbell, "Declarative Optimization-Based Drama Management in Interactive Fiction", IEEE CG&A 2006 (full text) | DIR-02, DIR-04, DIR-06 | Exists (Nelson, Mateas, Roberts and Isbell) |
| Yu, Guzdial and Sturtevant, "Evaluating the Effects of AI Directors for Quest Selection", arXiv 2410.03733, 2024 | DIR-04; F-01 | to add |
| Horvitz, "Principles of Mixed-Initiative User Interfaces", CHI 1999 (full text) | DIR-22, DIR-23 | to add |
| Iqbal and Bailey, "Effects of Intelligent Notification Management on Users and Their Tasks", CHI 2008 (full text) | DIR-14, DIR-15, DIR-16 | to add |
| Trafton, Altmann, Brock and Mintz, "Preparing to resume an interrupted task", IJHCS 58, 2003 (abstract and introduction) | DIR-18 | to add |
| Mehrotra and Musolesi, "Intelligent Notification Systems: A Survey", arXiv 1711.10171 (sections on breakpoints and engagement) | DIR-14, DIR-20 | to add |
| Hsieh, Chiang, Chiu and Chang, "Bridging the Virtual and Real Worlds: messaging notifications in VR", CHI 2020 (abstract and introduction) | DIR-20 | to add |
| Lehne and Koelsch, "Toward a general psychological model of tension and suspense", Frontiers in Psychology 2015 (first 100,000 characters) | DIR-41, DIR-42, DIR-43, DIR-51 | to add |
| de Berker et al., "Computations of uncertainty mediate acute stress responses in humans", Nature Communications 2016 | DIR-43 | to add |
| Grip, "Game Design Deep Dive: Amnesia's Sanity Meter", Game Developer, 27 Aug 2014 | DIR-52, DIR-53; F-08 | to add |
| Jensen, "How Much Friction?", Game Developer, 29 Oct 2014 | F-03, DIR-50 | to add |
| Serviss, "The Discomfort Zone", Game Developer (from Dashjump), 7 Feb 2013 | F-01 | to add |
| RimWorld wiki pages for Cassandra Classic, Phoebe Chillax, Randy Random and the storyteller overview; Game Developer staff report on Sylvester, 11 Aug 2016 | DIR-09, DIR-10, DIR-28; F-02 | Sylvester and Ludeon exist |
| Spira, "An Exploration of Escape Room Hint Systems", Room Escape Artist, 24 Oct 2019 | DIR-19; F-11 | to add |
| Turnitsa, "Adjudication in Wargaming for Discovery", CSIAC, 2016 | DIR-57, DIR-58 | to add |
| theatrecrafts.com, "The Prompt Book" | DIR-54 | encyclopedic; not credited |
| Fisher, Siler and Ware, "Structure, Agency, and Improvisation in Human-Led Digital Interactive Narrative Exercises", AIIDE 2025 (abstract, introduction) | DIR-06 | to add |
| The repository pages named in §1 | §5 inputs | first-party |

### 3.2 Summary only, or memory

| Work | What I have | Treatment |
|---|---|---|
| Adamczyk and Bailey, "If not now, when?", CHI 2004 | Abstract and later papers' accounts: interruptions at different moments differ in emotional state and in how the interrupter is judged; subtask boundaries are better moments | DIR-14, [empirical], abstract level |
| McFarlane and Latorella 2002; McFarlane 2002 (HCI 17) | Citation, taxonomy (immediate, negotiated, mediated, scheduled) and a secondary account that negotiation gave the best overall performance in one emergency-response task, with immediate slightly faster to handle | DIR-17, secondary |
| Mark, Gudith and Klocke, "The cost of interrupted work", CHI 2008 | Abstract: interrupted work was finished sooner with no loss of quality, at the price of more stress, frustration, time pressure and effort | F-07 context; DIR-31 |
| Fischer, Greenhalgh and Benford, MobileHCI 2011 | Abstract and survey: notifications were handled faster just after a call or text ended | DIR-14 |
| Cutrell, Czerwinski and Horvitz 2001; Czerwinski et al. | Through the survey: disruption is greater when the task needs attention | DIR-20 |
| Weyhrauch 1997; Riedl and Bulitko 2013; Roberts and Isbell 2008 | Abstracts and lens L8 | DIR-04 context |
| Mateas and Stern 2005 (Façade) | Read in dossier 5; here only its tension-arc beat choice, as given in [dossier 3](d03-fitting-casting.md) FIT-32 | DIR-27 |
| Thue et al., PaSSAGE, AIIDE 2007 | Search accounts: 101 participants, benefits for some players (low-experience players who found the stories easy to follow), more fun at about 91 per cent confidence | DIR-04, [empirical], summary |
| Wardrip-Fruin, Mateas, Dow and Sali, "Agency Reconsidered", DiGRA 2009 | Abstract and blog: agency arises where what the player wants to do is what the system supports | DIR-06 |
| Chen, Nelson and Mateas, AIIDE 2009 | Lens L8 (read there): three authorial-leverage measures | DIR-04 |
| Vachiratamporn, Inventado, Legaspi, Moriyama and Numao, JSAI 2013 | Abstract: initial results suggest a player in a suspense state is more likely to become more fearful at a scare | DIR-44, [empirical, preliminary] |
| Berns et al., "Neurobiological substrates of dread", Science 2006 | Abstract and press summaries: 32 participants; some chose a stronger shock sooner rather than wait; nine "extreme dreaders" | DIR-51 |
| Mobbs et al., Science 2007 | Abstract: activity shifts from prefrontal to midbrain regions as a virtual predator closes in; tracks reported dread | DIR-45 |
| Loewenstein, "Anticipation and the valuation of delayed consumption", Economic Journal 1987 | Abstract and secondary accounts: savouring good outcomes and dread of bad ones explain delaying the good and getting the bad over with | DIR-51 |
| Ely, Frankel and Kamenica, "Suspense and Surprise", JPE 2015 | Abstract: suspense is the spread of the next period's beliefs; surprise is the size of the belief change | DIR-43 |
| Gerrig and Bernardo 1994; Cheong and Young 2015 | Lens L8: suspense rises as the visible routes to success fall; a planner-based estimator rated more suspenseful than controls in one study | DIR-42 |
| Bordwell, "Hitchcock, Lessing, and the bomb under the table", 2013 | Search excerpts: the suspense and surprise distinction, with an older history than the legend gives | DIR-41 |
| Zillmann on excitation transfer | Search summaries: residual arousal can intensify a later reaction when its source is not obvious | DIR-44, context |
| Cowan 2001, "The magical number 4" | Abstract: a central limit of about four chunks | DIR-32 |
| Ghibellini and Meier 2025 | Abstract and secondary accounts: no memory advantage for unfinished tasks; a general tendency to resume them | DIR-33, PAC-09 |
| Tango, Lichtman and Dolphin 2007; FanGraphs and Baseball-Reference glossaries | Leverage index: the average swing in win probability, scaled so that 1 is typical; above 2 is high leverage | DIR-43 |
| EEMUA 191; ISA-18.2 | Vendor and consultancy summaries: about 1 alarm per 10 minutes steady state, 1 to 2 manageable, more than 3 an action level; a flood is more than 10 in 10 minutes | DIR-30 [sec] |
| Harper, Blades in the Dark (clocks), through a practitioner page | Danger, racing and tug-of-war clocks; four, six or eight segments; the page advises not hiding clocks | DIR-48 |
| HSEEP and Master Scenario Events List guidance | Search summaries: injects tied to objectives, timed, delivered by controllers; the list is kept from participants | DIR-57 |
| Machon 2013; Alston 2016; Cartelli 2013 | Abstracts and the lens | DIR-39, DIR-38 |
| Perla 1990; Stern and Gold; Kelly 2009; Conant and Ashby 1970; Åström and Murray 2008; Kingman 1961; Little 1961; Zeigarnik 1927; Campbell 1979 | Memory, or the lens | Used only where marked [analysis] |
| Bray's nucl.ai 2016 talk on Alien: Isolation | Not watched; its content is as paraphrased by Thompson and others | DIR-03 |
| Majestic and Sleep No More accounts | Search pages and a blog; see F-09, F-10 | Context only |

### 3.3 Lens claims checked

| Lens claim | Result |
|---|---|
| L8 field 4 and L9 field 8: the Left 4 Dead intensity model, phases and numbers | **Confirmed from the slides.** One nuance: wanderers are zeroed when an area becomes visible to a survivor or in the relax phase; boss events are dealt from a shuffled set of Tank, Witch and nothing, with no immediate repeats |
| L8: "changes frequency, not amplitude" | **Confirmed** (the slides say amplitude is unchanged, frequency adjusted). Mob size grows between a minimum just after a spawn and a maximum after a set time, which is a separate small amplitude rule |
| L12 F12 principle 1: threat sequences with enforced relief are rated more intense than constant pressure | **No rating study found.** The design intent is confirmed (Booth: constant combat is fatiguing and long inactivity boring). Demoted to [practice] with a [hypothesis] on ratings |
| L12 F12 principle 2: a threat that must find the player is rated fairer and scarier | **Design intent confirmed** by Thompson's account of the split. No study of ratings found. [shipped] design, [hypothesis] on ratings |
| L12 F12 principle 3: detected director help lowers rated fairness | **Not found.** Only opinion pieces and a thesis on hidden against disclosed adaptive difficulty whose results I could not see. [hypothesis] |
| L12 F11 principle 1: disclosure before the threat acts gives higher rated tension than surprise at equal exposure | **Not tested in anything I found.** Lehne and Koelsch treat tension as preceding events and surprise as following them. Bordwell notes the bomb-under-the-table story is murkier than the legend. [analysis] and [hypothesis] |
| L12 F11 principle 2: a prior suspense state raises fear at the first confirmation | **Confirmed at abstract level** as initial results, small and preliminary |
| L12 F11 principle 3: prolonged suspense with no release lowers satisfaction and then tension itself | **No study found.** Lehne and Koelsch list the effect of delay as open. The Alien: Isolation critiques are the nearest evidence [shipped, weak] |
| L12 F13 principle 1: two independent traces beat one for correct inference | **Not checked** (the source in the lens is theory plus a review). [hypothesis] |
| L12 F14 principle 3: unpaid plants lower trust in later plants | **Not checked.** The nearest evidence on false alarms is mixed (F-07). Marked contested |
| L1 field 6: a short grace delay before a nudge reduces "you stole my solve" reports | **Not tested.** Spira confirms the risk of a hint landing just as the team solves it. [practice] |
| L1 field 3: only 10 to 15 per cent of attendees get a one-on-one | **A blogger's rough calculation** from an assumed 40 to 50 encounters a night. Not a measured figure |
| L11 field 23: about one alarm per ten minutes; a flood is ten in ten minutes; the Kingman instance | **Figures confirmed in vendor material.** The Kingman instance checks: 0.83/0.17 = 4.9 and 0.95/0.05 = 19, a factor of 3.9 |
| L2 A21: the behaviour tree alone could trap the player or lose them, and a director fixed it | **Partly.** Thompson says the tree can trap or lose the player. The talk summary says the director exists because a player cannot be scared senseless all the time. Both are true; the director is about pressure |
| Map, PAC-05: Ubisoft "fixes the cliffhanger collision" | **Confirmed** (Horneman) |
| L10: "a 2024 paper finds no comparative evidence that directors improve experience" | **Confirmed in a narrower form**: Yu et al. state they have no comparative data for the Left 4 Dead director. Their own study compared three quest-selection directors (n = 32 usable) and found a curated director presented fewer quests and enjoyment fell in a second session only with the random one, and that many players noticed no difference |

## 4. Principles

Columns: grade; source and a concrete instance; scale (E encounter, G gig, A arc) and layers (the plan's four, with X expression, C configuration, E evaluation, T tooling); how to operationalise (**produce**, **check**, or **neither**). Kernel references are to [S0](../spec/kernel.md). Numbers marked [J] are my judgement; §5.1 sorts every number. "Request" means a request for the player's attention (DIR-13, DIR-23).

### 4.1 What a director may do, and what it must not (SEL-03, PAC-04, CRA-16)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DIR-01 | A director changes when and how often content arrives. It does not change how hard each piece is | [shipped] | Booth's slides state that amplitude is unchanged and frequency adjusted. Mobs spawn at a random interval of 90 to 180 seconds on Normal. One small amplitude rule exists: a mob's size grows from a minimum just after a spawn to a maximum after a set time, so that frequent mobs are not harsher | E, G, A · 3 | **Produce:** the director's outputs are release times, holds and withdrawals. Stakes and hostility come from the seed and the world. **Check:** log any director action that changed a unit's strength; there should be none. Players should not report rubber-banding when only the rate of offers changes (inferred, not tested) |
| DIR-02 | Keep the director's verbs few, and rank them by how much a player would notice | [shipped] for the verb list; [analysis] for the ranking | Nelson et al. 2006: five kinds of drama-manager action (permanent deniers, temporary deniers with paired re-enablers, causers, hints, game endings), 30 actions in Anchorhead. The author gives each action a manipulativity score for how likely a player is to find it suspicious, and a "choices" feature rewards leaving the player options. Subtle hints rank below outright causers. Instance for us: a rumour on a news screen (rank 0) against an NPC volunteering information (rank 2) | E, G, A · 3 | **Produce:** the engine's verbs are `trace`, `offer`, `hold`, `withdraw`, `nudge` (a contribution to a world actor's frame, so it acts for its own reasons) and `rest`. Classes: 0 a trace in the world; 1 an offer on a channel V can ignore; 2 a nudge to an actor; 3 a hold or withdrawal of something V has not observed. Class 4, changing anything V has observed or could base a choice on, is forbidden (DS-05). **Check:** an audit log shows no class 4, and reports class 2 and 3 actions per hour against a cap |
| DIR-03 | Keep what the director knows apart from what a threat knows | [shipped] for the design; [hypothesis] that players rate it fairer and scarier | Alien: Isolation. The director always knows where the player and the hunter are. The hunter runs on a behaviour tree with over 100 nodes (about 30 at the top level) and senses through view cones, hearing with thresholds and touch. The director only points it at the general area now and then. A developer says it teleports twice in a 12 to 18 hour campaign, both for cutscenes | E, G · 3, 1 | **Produce:** threat actors are ordinary actors that read the world only through `knows(observer, subject, path, t)` ([§11.4](../spec/kernel.md#114-knowing)). The director, a root actor, is the only reader of V's position. Its hint is a coarse region added to the threat's `wants`, and it travels with a trace chain that says how the threat could have known (a witness, a tip, a camera). **Check:** every hint's region is coarser than V's tier, and no threat act lacks a `knows` path |
| DIR-04 | A director must beat a fixed schedule and a trigger script, or it should be one | [analysis] for the measures; [empirical] that the gap exists | Chen, Nelson and Mateas 2009 (read in lens L8): three measures of authorial leverage (how complex a script is needed to reproduce the policy, how sensitive the policy is to story changes, branches offered against scripted equivalents). Yu, Guzdial and Sturtevant 2024 compared a random, a player-modelling (PaSSAGE) and a bandit director on a farming game with a quest board of three. The bandit presented fewer quests (mean 20.7 against 27.3 and 29.7). Accepted and completed counts did not differ, enjoyment fell in a second session only with the random director, and many players noticed no difference. 32 usable participants | E, G, A · 3, E | **Check:** run three arms on the same seeds: a deterministic fixed-rhythm schedule, a random release that obeys only the hard gates, and the director. Compare blind ratings and the logged measures in §5.9. If the director does not beat the fixed rhythm, ship the fixed rhythm. Apply the three leverage measures to the director's policy |
| DIR-05 | Do not regulate to one proxy. Keep separate estimates and review them against ratings | [analysis] | The combat-based proxy is untested outside combat (lens L8). Campbell's and Goodhart's warning that a measure used as a target stops measuring [memory]. Amnesia's sanity meter drew item hoarding and optimising play (F-08) | E, G, A · 3, E | **Produce:** three estimates (DIR-11). **Check:** in consented test sessions, ask for a rating of intensity every few minutes and track how well each estimate follows it; raise an alarm when the gap widens |
| DIR-06 | Director help must be explicable in the world and must not overturn what the player has been led to expect | [hypothesis]; [analysis] | A developer says Alien: Isolation's hunter is never allowed to cheat. Wardrip-Fruin et al. 2009 locate agency where what the player wants to do is what the system supports. Fisher, Siler and Ware 2025 (human game masters and players): a strong link between perceived structure and perceived agency, and poor agency experiences read as failures of the improvising partnership. The authors warn that an alteration that contradicts established expectations may make a player doubt any of them | E, G, A · 3, E | **Produce:** each director action carries an explanation chain to a recorded fact (`found`) or to a cause labelled `constructed` ([dossier 6](d06-sifting-tellability.md) T-4). The director alters nothing V has observed (DS-05). **Check:** actions without a chain are zero. A session probe asks whether anything felt arranged |
| DIR-07 | The director's objective never includes return rate, session length or streaks | [practice] (lens L10, not rechecked) | Lens L10: a director that watches the player is a retention engine by construction, and pacing and manipulation sit close together. Dossier 12 owns the detail | all · 3, E | **Check:** a reward and objective audit lists every quantity the director optimises, and none is a retention proxy |
| DIR-08 | Authored seeds sit above the director. A fixed window pierces rest only on the author's declared terms, otherwise the seed degrades by a named form | [analysis] | [D-02](../decisions.md); FIT-06 (the fitter asks the director before committing); FIT-45 and FIT-46; [dossier 6](d06-sifting-tellability.md) T-8 | G, A · 2, 3, 4 | **Produce:** an authored request carries a hard deadline from its window. Before the deadline it ranks above sown requests. At the deadline it plays in its lowest-intensity form or degrades, and does not fire into a peak. **Check:** simulate the window closing at every step (FIT-46) |
| DIR-09 | Make the base rhythm a deterministic function of state and seed, so a reload shows the same schedule | [shipped] | RimWorld's Cassandra Classic runs fixed On and Off phases (4.6 days on, 6.0 off, one or two major threats per On phase, at least 1.9 days apart, minor events about every 4.8 days) whose dates stay the same after saving, reloading or switching storyteller (wiki). Randy has no cycle but a guarantee: a major threat within 13 days | G, A · 2, 3 | **Produce:** schedule slots are hashed draws on (world seed, epoch, slot) ([§1.4](../spec/kernel.md#14-random-streams)). **Check:** the reload test of the evaluation plan: identical schedule after a load |
| DIR-10 | The player chooses the director's character and range. Cadence is separate from magnitude | [shipped] | RimWorld: three storyteller personalities, with difficulty a separate setting that can change mid-game. [D-02](../decisions.md): a proactivity dial down to off; DS-30 tone controls | all · 3, C | **Produce:** a tempo setting (off, calm, steady, restless) scales the cadence parameters inside bounds. Tone and intensity controls are separate. Off means pull only, plus fitting of authored seeds. **Check:** measure each setting's push rate in the harness; off yields zero sown pushes |

### 4.2 Reading the moment (PAC-04, PAC-05)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DIR-11 | Estimate three things apart: how intense the situation is, how busy the player is, and how much unresolved thread pressure is near. Take the maximum across sources, not the mean | [analysis]; [shipped] for the maximum | A conversation is low in arousal and high in load; a long drive is the reverse. Booth's director tracks four players and acts on the highest. Legion tracks distraction flags, not intensity. Iqbal and Bailey found relevance and task decide the moment. Hsieh et al.: higher engagement meant notifications were rated worse timed | all · 3, 2 | **Produce:** `A` (situation intensity, 0 to 1, with decay), `L` (a set of attention flags and a load class), `P` (thread pressure, a weighted count). Tension is `T = max(A, N)` where `N` is the declared intensity of active beats (FIT-32). **Check:** unit tests on scripted session traces |
| DIR-12 | Situation intensity is a sum of sensed events that decays unless something is still engaging V | [shipped] | Booth: intensity rises with damage in proportion, incapacitation, being pushed off a ledge, and nearby infected deaths in inverse proportion to distance. It decays towards zero over time and does not decay while infected are engaging the survivor. The slides call the estimate crude and the pacing good | E · 3, 1 | **Produce:** the sensed analogues in §5.2, from the event feed (S1) and V's state (S6). **Check:** calibrate the weights against intensity ratings from consented sessions (§5.9) |
| DIR-13 | One arbiter releases every request for the player's attention. A request names its kind, its importance, the distractions it tolerates and its maximum wait | [shipped] | Horneman (Ubisoft Toronto): missions and contextual dialogue submit a request; the system checks how busy the player is from game state only, picks the highest priority when the player seems ready, starts a timer for that request's category (a one-minute timer allows one mission a minute) and approves or rejects it when its wait window ends. Rejected banter retries at the next trigger (a window of 5 seconds in one example). Built after side missions broke cliffhangers | E, G · 2 | **Produce:** the request record of §5.5 and one release procedure. Nothing reaches V except through it. **Check:** a static check that no code path pushes outside the arbiter; the share of pushes delivered inside a forbidden aspect is zero |

### 4.3 Offer timing: the arbiter (PAC-05, CRA-03, CRA-05)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DIR-14 | Defer non-urgent offers to a breakpoint, the moment a chunk of activity ends | [empirical] on desktop and phone work | Iqbal and Bailey 2008: scheduling notifications at breakpoints lowered frustration and reaction time against immediate delivery, with a mean deferral of 88.6 s (SD 139.3 s). Adamczyk and Bailey 2004 (abstract): interruptions at different moments differ in emotional effect. Fischer et al. 2011: notifications were handled faster just after a call or text ended. The Mehrotra and Musolesi survey reports a 46 per cent fall in cognitive load in a 37-person lab study and 33 per cent in a 30-person field study of breakpoint delivery on phones. Instance for us: after V leaves a building or a firefight ends | E, G · 2 | **Produce:** breakpoints from the explicit transitions the feed reports: combat ended, dialogue ended, menu closed, left a vehicle, arrived, a loading screen ended. **Check:** share of pushes delivered within 60 seconds of a breakpoint, by importance |
| DIR-15 | The offer's relevance to what V is doing decides how coarse a breakpoint it needs | [empirical] on desktop | Iqbal and Bailey 2008: notifications relevant to the ongoing task suited medium or fine breakpoints. General-interest ones suited coarse breakpoints, and users read them fully only then. A relevant notification shown at a coarse breakpoint made some users abandon an intended switch. Instance for us: a call about the gig V is driving to may ring at a stop; an unrelated one waits until V has parked | E, G · 2, 3 | **Produce:** relevance from the pull of V's active frames on the request's seed (kernel [§10.3](../spec/kernel.md#103-inheritance-and-pull)). Above a threshold the request may use any allowed state; below it, only coarse breakpoints. **Check:** deferral distributions by relevance class |
| DIR-16 | Moment detection is imperfect even when the state is explicit, so build in tolerance | [empirical] | Iqbal and Bailey 2008: composite models found breakpoints with 52 to 59 per cent recall and 64 per cent precision, and told their size apart with only 2 to 42 per cent accuracy. A game reports transitions outright, but "the player finished thinking" is not reported | E · 2 | **Produce:** a settle time after leaving a high-load state and a recent-input check (§5.1). **Check:** the share of pushes followed within 10 seconds by a dismissal, a menu opening or a reload of the same screen is a proxy for ill-timed offers. Tune the settle time against it |
| DIR-17 | Let the player negotiate. Prefer channels that announce and wait over channels that act | [empirical] on a secondary account | McFarlane's taxonomy of immediate, negotiated, mediated and scheduled interruption. In one emergency-response lab task, negotiated coordination gave the best overall performance, and immediate was slightly faster to handle. Instance for us: a call that rings and can be answered, ignored or sent to messages | E, G · 2, X | **Produce:** every channel has a default of negotiated delivery (§5.3). No push forces a scene (D-09). **Check:** forced-scene count is zero |
| DIR-18 | Warn before a disruptive offer | [empirical] | Trafton et al. 2003: with an 8 second lag between the alert and the interruption, people prepared more and resumed the task faster than with no lag. With practice the no-lag group also sped up, so people adapt to abrupt interruptions at a cost. Instance for us: a call rings at least 8 seconds before it connects; an approaching NPC is visible for 5 to 8 seconds before speaking | E · 2, X | **Produce:** a lag of at least 8 seconds before a call connects or an approach opens [J on transfer from a desktop task to a game]. **Check:** time from first cue to V's first reaction |
| DIR-19 | Hold a short grace delay before any unsolicited nudge, and make help point before it tells | [practice] for the delay; [hypothesis] for the ladder | Spira (Room Escape Artist): a game master's hint can land just as the team solves the puzzle; a fixed time release can repeat what the team knows. The lens says a hint that redirects attention is rated more satisfying than an answer (not checked) and that stalling in an open world is often a choice | E, G · 2, 3 | **Produce:** a nudge fires only for a goal V has accepted and shows no progress event for 30 to 60 seconds [J]. Its first rung names an area or a person, not the answer. **Check:** count nudges followed within 15 seconds by progress ("you stole my solve") |
| DIR-20 | The more engaged V is, the worse the interruption. Protect flow near an active objective and while V is making progress | [empirical] | Hsieh et al. 2020 (VR): higher engagement generally led to higher perceptions that notifications were ill-timed or disruptive. Cutrell et al., through the survey: disruption is greater when the task needs attention. Horneman: a "near the tracked objective" aspect was added after unrelated narrative on approach confused players | E, G · 2 | **Produce:** an engagement flag when V has recent progress events on an objective or is within an approach distance of its tracked pin [J: 100 to 150 m on foot]. Only requests relevant to that objective pass. **Check:** pushes delivered while the flag is set |
| DIR-21 | Vanilla outranks us | [corpus] | [Player channels](../../../knowledge/player-channels.md): a mod's call yields to any quest call; one banner at a time, and the game's own messages replace ours; a journal-free contact cannot be called. [C1](../runtime-requirements.md): reserved people and places must be avoided | E, G · 1, 2 | **Produce:** vanilla UI states (banner up, call ringing, scene running) and reservations are attention aspects with infinite priority. **Check:** pushes delivered during a vanilla banner, call or scene are zero |
| DIR-22 | Decide among nothing, a cheap probe and a full offer by expected value, and let uncertainty about V favour the cheap probe | [analysis] | Horvitz 1999: act only when the expected value of acting beats inaction; add dialogue as a third option, with two threshold probabilities (between inaction and dialogue, between dialogue and action); weigh the cost of bothering a user needlessly and of deferring to a less distracting time. Under D-09 the engine's belief about V is held with a confidence, so low confidence favours a trace or a pin over a call | E, G · 3 | **Produce:** `p` is the engine's belief that V is receptive to this kind of offer, built from observed history only; the cost is the channel's interruptiveness times the load class. Below `p*₁` do nothing; between `p*₁` and `p*₂` place a trace or pin; above `p*₂` push. **Check:** decision logs; acceptance by decision class |
| DIR-23 | The request record carries everything the arbiter needs | [shipped]; [analysis] | Legion's four fields (type, importance, tolerated distractions, maximum wait) plus dossier 3's relevance window and channel ladder (FIT-47, FIT-48) and intensity effect (FIT-32) | E, G · 2, 4 | **Produce:** the record in §5.5. P4 owns the form |
| DIR-24 | Release one request at a time, with spacing. Never release everything that queued during a block | [analysis] with a toy model | Legion starts a category timer when it approves a request. Toy model (§5.8): at 8 requests an hour released at the first free moment, up to 4 were delivered in one minute and 8 in ten, because a long fight or menu stretch queues them all. A 180 second cooldown cut that to 1 per minute and 4 per ten minutes | E, G · 2 | **Produce:** category timers, a global minimum spacing of 60 seconds, and one release per eligible moment. **Check:** maximum pushes in any 60 seconds and any 10 minutes (M-1) |
| DIR-25 | Every request expires, and expiry is quiet and named | [analysis] | Legion rejects a request when its wait window ends. Toy model: a coarse-breakpoint-only rule left 34 per cent of silent messages waiting more than 5 minutes and 60 per cent of calls | E, G · 2 | **Produce:** a maximum wait by importance [J]: low 5 minutes, normal 15, high until the window closes. At expiry use a named form from FIT-46: withdraw, degrade, coda or memory. **Check:** share expired, by rule |

### 4.4 Rest, rate and budgets (PAC-03, PAC-04, PAC-06, PAC-07, PAC-08, PAC-09, CRA-03)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DIR-26 | Peaks and valleys beat constant pressure and long inactivity. Even so, tension fades if mastery stops being tested | [practice]; [shipped] for the fade | Booth: constant combat is fatiguing, long inactivity is boring, and unpredictable peaks and valleys make a replayable experience. Jensen on Alien: Isolation: annoyance replaced tension about two-thirds through, and dealing with the alien felt the same at hour 15 as at hour 1. A review scored it 5.9 on repetition and padding. The claim that enforced relief makes the same threat rated more intense is a design belief, not a measured result | E, G, A · 3, 4 | **Produce:** rest after peaks (DIR-27), and change what a threat demands over hours by unlocking behaviours from observed progress, not from V's deaths (the Alien: Isolation rule). **Check:** rated tension by hour in long sessions; a learner bot on threat behaviour (M-16 of dossier 5) |
| DIR-27 | Run a four-phase cycle: build, peak, fade, rest. Rest cannot begin until there is a natural break | [shipped] | Booth. Build up: full threat population until intensity crosses the peak threshold. Sustain peak: 3 to 5 seconds, which guarantees a minimum build. Peak fade: minimal population while intensity decays out of the peak range, so the fight can play out without eating the relax period; relax cannot start until a natural break. Relax: 30 to 45 seconds or until the team has travelled far enough. Façade's sequencer picks the unused beat whose tension effect best matches an author-set arc (FIT-32) | E, G · 3 | **Produce:** the phase machine of §5.4. A natural break is no hostile engaging V and no active high-intensity beat. **Check:** inter-peak interval distribution inside a target band; rest never starts mid-fight |
| DIR-28 | Rest lasts about as long as the stress it follows | [shipped] for the order of magnitude; [J] for the factor | Cassandra: 6.0 days off to 4.6 on. Phoebe: 8 off to 8 on. Left 4 Dead's relax of 30 to 45 seconds follows peaks that last from seconds to a minute or so. Randy has no rest and is the harshest | E, G, A · 3 | **Produce:** `R = clamp(R_min, R_max, k × episode length)` with `k` between 1 and 1.5 [J] and bounds in §5.4. **Check:** compare rated intensity of the next peak across rest lengths |
| DIR-29 | The engine cannot make calm in a game it does not run. It can only withhold its own additions | [corpus]; [analysis] | The base game re-arms ambient fights on a 12, 24 or 36 game-hour cycle with no quest, releases scanner hustles in ticks, and runs its own police heat ([open-world activities](../../../knowledge/open-world-activities.md), [game events](../../../knowledge/game-events.md)). A "rest" that ignored this would pile our pressure on the game's | E, G · 3, 1 | **Produce:** headroom `H = target − A_game`, where `A_game` is the intensity from sensed events whatever their source. Our pushes may add intensity only up to `H`. Rest means no new pushes. **Check:** measure `A_game` from session traces without the engine to set `H` (open question 1) |
| DIR-30 | Cap pushes per hour and per ten minutes. Give passive offers their own salience budget | [sec] for the vendor figures; [J] for ours | EEMUA guidance as vendors report it: about 1 alarm per 10 minutes as a steady-state target, 1 to 2 manageable, more than 3 an action level, a flood more than 10 in 10 minutes. Legion's example category timer is 1 minute. Toy model: Poisson arrivals at 4, 8 and 12 an hour put more than 2 requests in a 10 minute window 3.6, 16.6 and 33.6 per cent of the time when released at once | E, G · 2 | **Produce:** soft target of 2 to 4 pushes a play-hour [J]; hard cap of 2 per rolling 10 minutes and at least 60 seconds apart [J]. Pins, scanner entries and environmental traces are not pushes but count against a salience budget set per district by the harness. **Check:** pushes per hour; share of 10-minute windows over the cap |
| DIR-31 | Keep attention utilisation well under one | [analysis] | Kingman's approximation: mean wait grows with `ρ/(1−ρ)`, so waits climb without bound as load nears capacity (0.83 to 0.95 nearly quadruples the wait). Toy model with a cap of 2 per 10 minutes (service rate 12 an hour): arrivals of 4 an hour gave a mean wait of 82 s and a 90th percentile of 291 s; 8 an hour gave 405 s and 1,094 s; 12 an hour does not settle. Mark et al. 2008 (abstract): interrupted people finish sooner but with more stress and effort, so a lack of complaints does not show a lack of cost | all · 2, 3 | **Produce:** sowing may submit requests at no more than about a third of the cap [J]; `ρ` is arrival rate times mean spacing. **Check:** queue length and age; alert above 0.35 |
| DIR-32 | Limit the threads near V | [empirical] for the four; [J] for the rest | Cowan 2001: a central limit of about four chunks held in the focus of attention. Lens L11 proposes that each extra open offer lowers uptake of the others (untested). Dossier 8 owns thread composition | G, A · 3, 4 | **Produce:** attended threads (surfaced and unresolved) at most 4; live threads (a beat in progress or a clock inside its last third) at most 2; climactic beats at most 1; simmering threads (traces only) at most 8 [J]. On overflow: merge, queue, or withdraw the lowest-pull thread with a closing trace (NAR-05). **Check:** counts by hour; offers refused |
| DIR-33 | Count what V can see, not what exists. Give every open thread a cue | [analysis]; [empirical] for cues | Coarse-detail threads cost the player nothing. Ghibellini and Meier 2025 (abstract): unfinished tasks showed no memory advantage but a tendency to be resumed, so a thread needs a cue to resume from and must not rely on recall | G, A · 3, 2 | **Produce:** the budget counts threads that have reached V's awareness (a thread entry, a pin, an observed trace). Each has a re-findable cue. **Check:** every attended thread has a cue; dead cues are zero |
| DIR-34 | Pace in play time. Cap what is owed. Never catch up in a dump | [analysis] | Arithmetic: 4 pushes an hour accrued on the game clock across an 8 game-hour sleep or wait owes 32. Lens L11: integral windup, and the standard remedy of clamping the accumulator while no delivery is possible | all · 2, 3, 1 | **Produce:** rest, spacing and budgets run on the play clock, which stops in menus, pause and photo mode. World clocks (threats, traces) run on game time. The owed count is capped at one. After a wait, sleep, fast travel or load, rest restarts in a settling state (DIR-59). **Check:** after scripted skips, pushes in the next 10 minutes do not exceed the cap |
| DIR-35 | Reactive pacing only subtracts. Use hysteresis and slow gain | [analysis] | Control theory as the lens states it: loop delay makes a controller oscillate unless its gain is lowered; without a deadband it flips between "needs excitement" and "needs rest". Lens L11 warns that a too-responsive controller reads as manipulation | all · 3 | **Produce:** the schedule (DIR-09) creates opportunities. The reactive layer may hold, delay or withdraw, never add. Enter rest above `θ_peak`, leave the fade below `θ_fade < θ_peak`. **Check:** simulate synthetic players and plot the oscillation of beat intensity against gain |
| DIR-36 | Add jitter, and never let a visible proxy become the target | [analysis] | [Dossier 5](d05-units-variety.md) VAR-19 to VAR-21: order rules make a skeleton predictable. Lens L1: scripts can teach participants to wait for the next cue. Goodhart [memory] | all · 3 | **Produce:** jitter on release times of about plus or minus 20 to 30 per cent [J]; no director meter visible (DIR-53). **Check:** a synthetic player that delays its actions to farm offers should gain nothing |
| DIR-37 | Rest never blocks pull | [practice]; [analysis] | Majestic capped daily progress and made players wait; EA's communications director blamed pacing (F-09). [D-09](../decisions.md): V is never made to wait | all · 3, 2 | **Produce:** the director limits pushes only. Any pin, scanner entry, place or person V seeks plays at once. A floor of ambient traces keeps the city from reading as dead (quality bar 7). **Check:** time from V seeking something to it starting |
| DIR-38 | Every offer V never takes must be complete without V, and declining must not feel like losing the main thing | [practice] | Lens L1 on immersive theatre: the non-selected majority must see something complete, and "you missed the real scene" reports predict churn; Alston's critique of participation as audience labour. Only about 10 to 15 per cent of a night's audience get a one-on-one scene by one blogger's rough count | G, A · 3, 4 | **Check:** every thread has a no-take path that ends in a named form (FIT-46). A session probe asks whether V felt they had missed something important |
| DIR-39 | Treat signs of voluntary approach as better triggers for personal or intense content than proximity | [hypothesis] | Lens L1: immersive-theatre performers give a private scene to the audience member who lingers, follows or returns (Machon; Cartelli). No study. Instance for us: V returns to the same bar, lingers by a person, or scans them | E, G · 3, 1 | **Produce:** count approach events from the feed: returns to a place, dwell time, gaze and scan targets. Observed only (D-09). They raise `p` in DIR-22. **Check:** acceptance of intense offers after approach signs against after proximity alone |
| DIR-40 | Rank beats by leverage. Put high-leverage beats at receptive moments and let low-leverage ones fill gaps | [analysis] | Tango's leverage index is the average swing in win probability, scaled so 1 is typical; above 2 is high, about 10 per cent of baseball situations. Ely, Frankel and Kamenica: suspense is the spread of the next belief. Worked example: a thread at 0.5 whose next beat moves belief to 0.8 or 0.2 has a next-belief variance of 0.09 and an expected move of 0.3. A beat that moves it to 0.6 or 0.4 gives 0.01 and 0.1: ten times the suspense for three times the leverage | G, A · 3 | **Produce:** for a thread with at least two declared outcomes (FIT-29), compute both from the engine's outcome weights. Book high-leverage beats into the first receptive window after a rest. Baseball has a closed state space, so threads need declared outcome classes. **Check:** rank correlation of the computed leverage with rated importance |

### 4.5 Dread and anticipation (PAC-03, PAC-04)

Mechanics only. Horror as a tone belongs to dossier 17. Most of the support is small lab work, theory and designers' accounts, so most grades are [hypothesis] or [empirical, preliminary].

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DIR-41 | Announce a threat before it acts. Tension comes from anticipation; surprise comes after the event | [analysis]; [hypothesis] that rated tension is higher | Lehne and Koelsch 2015: tension precedes events and is almost the opposite of surprise; it rests on prediction and uncertainty about events that matter. Hitchcock's bomb under the table is the classic claim, though Bordwell finds its history murkier than the legend. No controlled study found at equal exposure | G, A · 3, 4 | **Produce:** a hostile thread has a disclosure step before first contact: a rumour, a notice, a change in routine, V-visible. **Check:** A/B in sessions: the same encounter with and without disclosure, rated tension and fairness |
| DIR-42 | Each trace should shrink V's ways out or raise the stakes. A trace that changes nothing is texture | [empirical], lab and text | Gerrig and Bernardo 1994, through the lens: suspense rose as readers saw fewer routes to a solution. Cheong and Young's Suspenser counts solutions to a goal and chose events to show; its stories were rated more suspenseful than controls (98 subjects, 294 responses, small to moderate effects). Instance for us: the fixer V could call has stopped answering | G, A · 3 | **Produce:** a trace declares the V-visible options before and after (allies reachable, safe places, time left). **Check:** traces with no change are labelled texture and not counted toward the disclosure step |
| DIR-43 | Keep a building thread's outcome uncertain, in the middle band, then resolve it | [empirical], lab | de Berker et al. 2016 (45 participants): subjective stress, pupil size and skin conductance tracked irreducible uncertainty, which peaks when the estimated probability is one half. Ely et al. 2015: suspense is the spread of the next period's beliefs; surprise is the size of the belief change. Lehne and Koelsch: tension grows with the variability of the anticipated outcomes and with their perceived probabilities | G, A · 3 | **Produce:** the engine reads each hostile thread's outcome weights and picks the next trace so that the V-visible evidence stays in the band 0.25 to 0.75 [J] while it builds, then resolves. V's belief is not the engine's probability, so the proxy is what V has observed. **Check:** simulated Bayesian audiences against ratings |
| DIR-44 | Place a scare after a suspense state, not cold | [empirical], preliminary | Vachiratamporn et al. 2013 (abstract): a player already in a suspense state was more likely to become more fearful at a scare. Zillmann's excitation transfer: lingering arousal can strengthen the next reaction when its source is not obvious (summary) | E, G · 3 | **Produce:** a fear-type payoff requires `T` above a suspense threshold within the last N minutes [J: 5]. **Check:** rated fear by prior state |
| DIR-45 | Stage a threat's approach in steps of imminence | [empirical]; [shipped] | Mobbs et al. 2007: as a virtual predator closed in, activity shifted from prefrontal to midbrain regions, tracking reported dread and lower confidence of escape. Alien: Isolation's menace gauge rises faster the nearer the hunter is, with line of sight, or close on the motion tracker, and at its peak the director pulls the hunter into the vents | E, G · 3, 1 | **Produce:** four stages: distal (rumour, news), proximal (sightings in the district, changed routines), imminent (sounds, shadows, bystanders leaving), contact. The stage follows travel-time distance, line of sight and the clock. The threat is represented coarsely until the stage is imminent, and returns to a coarse state when it retreats. **Check:** stage transitions are logged with their causes |
| DIR-46 | Use at least two independent traces from one thread record | [hypothesis] | Lens L12: a cause is inferred more often from two independent traces than one; contradictory traces from separate generators lower belief in the whole chain. Not checked | G, A · 3 | **Produce:** traces are generated from the thread's record, never by separate generators. At least two distinct kinds before first contact at gig and arc scale. **Check:** a contradiction check across a thread's traces |
| DIR-47 | Traces must be true to the record. An unpaid plant gets a closing trace | [hypothesis]; **contested** | Lens L12: planted details never paid off lower trust in later ones. The nearest evidence, on false alarms, is mixed (F-07): some studies find high false-alarm ratios lower compliance, others find weak or no effect of perceived ratios | G, A · 3, 4 | **Produce:** each trace cites a fact or event (`found`) or a labelled `constructed` cause. When a thread stands down, a closing trace says so. **Check:** track the false-alarm ratio per thread type and V's response to later traces of that type |
| DIR-48 | Run a visible clock on every hostile thread | [practice] | Blades in the Dark danger clocks tick towards a threat arriving; four, six or eight segments; ticks come from actions, consequences and the world's own evolution; the practitioner page advises against hiding them and allows the players to bypass one with a sensible plan. NAR-17: a clock needs a perceivable source and fires whether or not the player attends. A deadline that punishes someone who was elsewhere breeds resentment | G, A · 3, 4 | **Produce:** a hostile seed declares a clock (segments, tick sources, the visible sign per segment). Ticks follow game-time events and V's actions. A full clock happens to the world, not to V's progress. A decline is a consequence, never a null. **Check:** each clock has a perceivable source; a V who ignores a thread meets a changed city, not a failure screen |
| DIR-49 | Pay off at the size of the dread, then rest | [hypothesis] | Lens L12: a payoff smaller than the dread built is a named failure. Left 4 Dead and Alien: Isolation both follow a peak with enforced quiet | G, A · 3 | **Produce:** a thread's payoff intensity effect is at least its declared build (FIT-32). Payoff triggers rest of length `R` (DIR-28). **Check:** rated satisfaction against build and payoff size |
| DIR-50 | Cap how long a threat may sit at the edge of contact | [hypothesis]; [shipped, weak] | Jensen and the IGN review on Alien: Isolation; Lehne and Koelsch list the best delay as an open question. Lens L12: suspense with no release erodes satisfaction | G, A · 3 | **Produce:** the imminent stage lasts at most 15 play-minutes; the proximal stage at most 3 game days and 2 sessions [J]. Beyond a cap, contact or a stand-down trace. **Check:** rated annoyance against dwell time |
| DIR-51 | Let V shorten the wait | [empirical]; [analysis] | Berns et al. 2006 (32 participants): some, the extreme dreaders (nine), chose a stronger shock sooner rather than wait. Loewenstein 1987: people delay good outcomes to savour them and hurry bad ones. Lehne and Koelsch list a lack of control during a gap as part of tension | G, A · 3, 4 | **Produce:** every hostile thread at proximal stage or later has a handle V can seek (a place, a person, a call). Seeking it advances the clock. V cannot remove the threat for free. **Check:** share of V's who seek the handle; their ratings against those who wait |
| DIR-52 | Vary the threat and limit exposure to any one | [shipped] | Thompson: Alien: Isolation's behaviour branches unlock after repeated escapes so the creature seems to learn, and deaths never unlock them. Grip: in Amnesia looking at monsters costs sanity. Lens L12: scares for a player who expects them can be braced against | E, G · 3, 4 | **Produce:** threat behaviours unlock from observed progress counts, not V's failures. A per-threat exposure cap per session. **Check:** the learner bot on threat behaviour; rated tension by encounter number |
| DIR-53 | Keep the director's meter out of sight and out of reach | [practice] | Grip: the sanity meter is shown only as a rotting-brain image and a line of text in the inventory, yet he later named item hoarding and a systemic approach that made the experience less engaging | all · 3, X | **Produce:** no director state in any V-facing display except diegetic signs, and nothing V can stock up to buy rest. **Check:** synthetic exploit players gain nothing |

### 4.6 Lead time, show control and exercise control (CRA-06, CRA-16)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| DIR-54 | Stage a beat in three steps: warn, standby, go | [practice] | The prompt book: standby (called warn in the US) tells operators a cue is coming; the same verbal command starts each cue; how early depends on how complex the change is. Instance for us: warn a scene change early and a lighting button late | E, G · 2, 1 | **Produce:** *warn* requests finer detail for the venue and cast (kernel [§10.6](../spec/kernel.md#106-demand-and-tiers)) at least 60 seconds of play before the planned time [J]; *standby* holds it ready and reserves the arbiter's slot for at least 10 seconds [J]; *go* commits when the arbiter releases. **Check:** half-ready beats (a beat that starts without its detail) are zero; a variance log of planned against actual start |
| DIR-55 | Offer early in a window V may close, keep the hook cheap, and declare the lead preference | [hypothesis] | FIT-45: no fact warns of the point of no return in the main story, so a window V closes has no calendar | G, A · 2, 3 | **Produce:** a seed's lead preference (early, late) and the signals that raise urgency: time since the window opened and V's distance from the place that closes it. **Check:** share of seeds whose window closed before the offer was made |
| DIR-56 | Lead time scales with the unit. Refresh a trace the player may have forgotten | [hypothesis] | The table in §5.7. Lens L12 names "delaying so long the player forgets" as a failure. Ghibellini and Meier: unfinished tasks need cues | E, G, A · 3 | **Produce:** the lead classes of §5.7. A trace not met for one session is refreshed. **Check:** recall of the cause at payoff, asked in test sessions |
| DIR-57 | Every push has a stated purpose and is logged, planned against actual | [practice] | Exercise control: the Master Scenario Events List is a time-ordered record of scripted injects tied to exercise objectives, delivered by controllers, who may vary or drop injects as participants act, and kept from the participants. Lens L1: a log lets reviewers say why each event existed | E, G, A · 2, T | **Produce:** each request has a purpose from a closed vocabulary (introduce, escalate, rest cue, callback, close) and a planned time. The log records the actual time. Controllers' freedom to drop an inject is the arbiter's expiry (DIR-25). **Check:** reviewers can state the reason for every push; defects found per hour of play |
| DIR-58 | Mix rules and judgement. Rigid where the world is simulated, free where it is only plausible, and use stand-ins for what is absent | [practice] | Turnitsa (CSIAC): rigid adjudication is fast and covers every case but only as the system allows; free adjudication covers the unforeseen but costs time and invites bias; semi-rigid keeps a formal system and lets a referee adapt outside it; open and matrix adjudication let participants argue. Instance for us: a simulated gang war resolves by rule; what is only plausible (a rumour's reach) by the director's bounded judgement | all · 3, 1 | **Produce:** three tiers of resolution: simulated state (rule), summaries (kernel [§9.3](../spec/kernel.md#93-summaries-and-their-refinement)), and director judgement bounded by the author's fixed parts. Off-stage actors speak through coarse summaries. **Check:** disputes found between a summary and a later fine-detail refinement |
| DIR-59 | After a load or a return, settle first | [J]; [analysis] | The fast estimates are lost across a load, and pending offers must come from the saved state so a reload shows the same offer (SAV-02). Return after an absence belongs to dossier 11 | all · 2, 3 | **Produce:** no pushes for 90 seconds of play after a load [J]. Pending offers are re-derived from the saved record. **Check:** the reload test |
| DIR-60 | Treat unknown attention as unknown | [analysis] | Horneman: the system cannot tell whether a player is distracted by a television, a pet or a friend. Input silence is the only extra sign the engine has | all · 2 | **Produce:** no input for 60 seconds with no menu open marks V as away [J]. While away: no calls or approaches; messages and pins persist. Every offer is re-findable. **Check:** offers delivered while away that were missed, by channel |

## 5. A pacing model the director could run

The model is built from the principles in §4. It is meant to be small enough to run in a second-by-second loop and to be replaced piece by piece as the harness measures. Read the grades before the numbers: most values are my judgement, and §5.1 says which.

### 5.1 Every number, sorted into evidence and judgement

"Borrowed" means the number comes from a shipped system or a study in a different setting and is used here only as a starting value.

| Quantity | Starting value | Basis | Kind |
|---|---|---|---|
| Peak sustain | 5 s | Left 4 Dead: 3 to 5 s after intensity crosses the peak | Borrowed [shipped] |
| Rest after a firefight or chase | at least 45 s | Left 4 Dead relax: 30 to 45 s | Borrowed [shipped], genre differs |
| Ambient hostile arrival (not a push) | 90 to 180 s | Left 4 Dead mob interval on Normal | Borrowed, for texture only |
| Situation-intensity decay half-life | 30 s when nothing is engaging V | Booth gives the shape (decay, none while engaged) and no number | **Judgement** |
| Peak and fade thresholds `θ_peak`, `θ_fade` | 0.7, 0.35 | Hysteresis is a control-theory rule (DIR-35); the values are mine | **Judgement** |
| Settle time after leaving talk, fight or menu | 10 s | Near the 8 s lag of Trafton et al., and short against Iqbal and Bailey's 88.6 s mean deferral | **Judgement** |
| Warning lag before a call connects or an approach speaks | at least 8 s | Trafton et al. 2003 | Borrowed [empirical], desktop task |
| Window after a coarse breakpoint | 60 to 120 s | Iqbal and Bailey mean deferral of 88.6 s | Borrowed [empirical] |
| Maximum wait | low 5 min, normal 15, high until the window closes | Toy model (§5.8): state gating gives a 90th percentile of 79 to 425 s | **Judgement**, checked against the toy model |
| Push rate, soft | 2 to 4 per play-hour | EEMUA figures as vendors report them; Legion's 1-minute category timer as an upper bound | **Judgement** |
| Push rate, hard | 2 per rolling 10 min, at least 60 s apart | The EEMUA over-demanding band; toy model | **Judgement** |
| Arrival into the queue | at most a third of the cap | Kingman's shape and the toy model | [analysis] |
| Rest after a firefight or chase | `clamp(45 s, 1.5 × episode, 3 min)` | Left 4 Dead; shipped quiet phases at least as long as the active ones | **Judgement** |
| Rest after a thread climax | 5 to 20 play-minutes of no high-intensity pushes | Cassandra's 6.0 off to 4.6 on; Phoebe's 8 to 8 | **Judgement** |
| Rest after an arc climax | 20 play-minutes, then V decides | As above, scaled up | **Judgement** |
| Attended, live, climactic, simmering threads | 4, 2, 1, 8 | Cowan's four for the first; the rest mine | **Judgement** (one anchor) |
| Release jitter | plus or minus 25 per cent | Anti-gaming rule of DIR-36 | **Judgement** |
| Settling period after a load | 90 s of play | Mine | **Judgement** |
| Away marker | 60 s with no input and no menu | Mine | **Judgement** |
| Nudge grace | 30 to 60 s without progress | Spira's warning about timing; no numbers there | **Judgement** |
| Engagement distance to a tracked pin | 100 to 150 m on foot | Mine; Horneman gives the rule and no distance | **Judgement** |
| Warn and standby for a staged beat | 60 s and 10 s of play | Theatre practice names the grammar, not the times | **Judgement** |
| Building band for outcome uncertainty | 0.25 to 0.75 | de Berker et al.: stress tracks uncertainty, peak at one half | Borrowed [empirical], lab |
| Stage dwell caps | imminent 15 play-min; proximal 3 game days and 2 sessions | Mine, from the Alien: Isolation fatigue critiques | **Judgement** |
| Rule weights in §5.2 | all | Booth gives the kinds of input and no weights | **Judgement** |

### 5.2 Estimating situation intensity from the senses

`A` is a number from 0 to 1 that describes what the game is doing around V. It is not a claim about how V feels (D-09). It is updated about once a second from the event feed (S1) and V's state (S6) described in [game events](../../../knowledge/game-events.md). That page advises against hooking every hit, so damage is read from polled health changes, and kills from the death and defeat events. All weights are my judgement.

| Input | Effect on `A` | Note |
|---|---|---|
| Health lost | plus 1.0 times the fraction of maximum health lost in the last second | Booth: in proportion to damage taken |
| Health first drops below 25 per cent in an episode | plus 0.15 once | |
| V downed or near death | plus 0.30 | Booth: incapacitation |
| Combat entered (a hostile is aware of V) | plus 0.10, and `engaged` is set | |
| Hostile killed or defeated within 10 m | plus 0.05 times (1 minus distance over 10 m) | Booth: nearby deaths, inversely with distance |
| Civilian death seen within 15 m | plus 0.10 times (1 minus distance over 15 m) | |
| Police heat stage rises | plus 0.10 per stage; `engaged` while a pursuit is active | |
| Vehicle collision at speed | plus 0.05 | |
| Gunshot or explosion stims nearby | plus 0.03 each, at most 0.15 per 10 s | Count-limited, as the hook-rate guidance says |
| Special encounter starts (a cyberpsycho, a boss) | plus 0.20 | |
| Decay | half-life 30 s, none while `engaged` | Booth: no decay while enemies are engaging |
| Narrative beat in progress | separate `N`, the beat's declared intensity effect, decaying with a half-life of 120 s [J] | Covers dialogue and scenes, which `A` cannot see |

`engaged` is true while a hostile is aware of V within 40 m or a pursuit is active. Tension for the phase machine is `T = max(A, N)`.

What the model cannot see: pain from a fall, fear of a place, grief at a scene. `N` is the author's declaration for those, not a sense.

### 5.3 Load, breakpoints and channels

The load class comes from the feed. A breakpoint is a transition out of a high-load state. The table also gives the permitted channels, using the interruptiveness classes below.

| Activity state | How sensed | Load | Channels allowed |
|---|---|---|---|
| On foot, free | no combat, not in a menu | 0 | 0, 1, 2, 3, 4 (not near a tracked objective unless relevant: DIR-20) |
| Idle | no movement and no input for 20 s, not in a menu | 0 | 0, 1, 2, 3, 4 |
| Driving, cruising | in a vehicle, no collision or pursuit in the last 20 s [J] | 1 | 0, 1, 2. A call (3) only if the harness finds it well received; the toy model leaves it out |
| Looting or at a vendor | a loot or shop screen | 1 | 0, 1 |
| Menu, map, inventory, journal | UI state | 2 | 0 (silent pins); everything else queues until the menu closes |
| Dialogue or scene | scene or dialogue hub active | 3 | none; settle 10 s after it ends |
| Combat or pursuit | `engaged` | 3 | none; rest rules apply when it ends |
| Photo mode, pause, loading | host state | 3 | none; the play clock stops |
| Away | no input for 60 s with no menu | n/a | 0 and 1 only |

Interruptiveness classes (my ranking, consistent with the channel limits in [player channels](../../../knowledge/player-channels.md)):

| Class | Channel | Cost | Notes |
|---|---|---|---|
| 0 | Map pin, scanner entry, environmental trace, a shard left lying | V-pulled; no interruption | The vanilla game offers most of its content this way |
| 1 | Journal-free message with a silent notification | Low | One banner at a time; vanilla's messages replace ours |
| 2 | Overhead line, overheard talk, a bark | Low | The player can switch chatter off |
| 3 | A ringing call | Medium, negotiated | The lag of DIR-18 applies. Pre-empted by quest calls. A journal-free contact cannot be called |
| 4 | An NPC walks up and speaks | High | Visible for 5 to 8 s before it speaks |
| 5 | A forced scene or a taken-over camera | Forbidden | D-09 |

### 5.4 Phases and rest

The phase machine runs on the play clock.

| Phase | Entered when | What the director may do | Leaves when |
|---|---|---|---|
| Build | start; after rest | Release pushes at the scheduled opportunities; advance clocks; place traces | `T` reaches `θ_peak` |
| Peak | `T ≥ θ_peak` | Nothing new that adds intensity. Closing messages of live threads are allowed | 5 s have passed and `T` falls below `θ_peak` |
| Fade | the peak has passed | Nothing new. Existing play finishes. Rest may not begin | `engaged` is false and `T < θ_fade` (the natural break) |
| Rest | the natural break | No pushes except class 0 traces and pins, and the closing messages of live threads. Pull is unaffected (DIR-37) | `R` has elapsed, or V has moved to another district and `R_min` has elapsed (Left 4 Dead ends relax on distance as well as time) |
| Settling | after a load, sleep, wait or fast travel | As rest, for 90 s of play | The period ends |

Rest length `R`, by what V has just been through [J]:

| What ended | `R` | Applies to |
|---|---|---|
| A firefight or chase (an episode) | `clamp(45 s, 1.5 × episode length, 3 min)` | Pushes of any intensity above class 0 |
| A thread climax (a gig ends, a major beat lands) | 5 min with no push at all except the thread's own closing messages; 20 min with no high-intensity push | New pushes |
| An arc climax | 20 min with no new thread of the same kind | New threads, unless V seeks one |

Reactive layer: it moves the machine between phases from `T` and `engaged` and holds, delays or withdraws pushes. It never creates one (DIR-35). The base schedule (DIR-09) decides when opportunities exist at all.

### 5.5 The arbiter: the request and the release step

**The request record.** Authors state the first five rows; the rest are filled by fitting or the engine.

| Field | Meaning | From |
|---|---|---|
| `kind` | trace, pin, bark, message, call, approach | Legion's type; the channel ladder |
| `importance` | low, normal, high | Legion's importance |
| `purpose` | introduce, escalate, rest cue, callback, close | DIR-57 |
| `tolerates` | for each attention aspect, allow or forbid | Legion's attentiveness |
| `max_wait` and `window_close` | how long it may wait; the hard deadline from the seed's window | Legion's maximum wait; FIT-44 |
| `channels` | the ladder from best to the lowest acceptable rung | FIT-47 |
| `intensity_effect` | its effect on `T`, from minus 1 to plus 1 | FIT-32 |
| `relevance` | the pull of V's active frames on the seed, recomputed at release | kernel §10.3 |
| `category` | the key for the category timer | Legion's category timers |
| `lead` | when to warn and when to stand by | DIR-54 |
| `on_expire` | withdraw, degrade, coda or memory | FIT-46 |
| `offer_id` | a stable identity derived from the seed and the saved state, so a reload shows the same offer | SAV-02 |
| `authored` | whether an author fixed its timing | DIR-08 |

**One release step**, once a second of play:

1. Update `A`, `N`, `T`, `engaged`, the load class and the flags, then the phase.
2. Expire requests past `max_wait` or `window_close` and apply `on_expire` (DIR-25).
3. If the phase is rest or settling, keep only class 0 and the closing messages of live threads.
4. Apply the hard gates, which are never relaxed: vanilla states (DIR-21), forbidden aspects, the away marker, the global spacing of 60 s, the cap of 2 per rolling 10 minutes, category timers, and the settle time.
5. Apply the breakpoint rule (DIR-14, DIR-15). A request below the relevance threshold needs a coarse breakpoint inside its window. Once a request has waited 70 per cent of `max_wait`, relax that rule only [J]; this stops starvation.
6. Score what remains by importance, wait fraction, relevance, leverage (DIR-40) and fit to the target `T` (FIT-32). Break ties by a hashed key.
7. Take the decision of DIR-22: nothing, a class 0 trace or pin in its place, or the push.
8. Release one request. Start its category timer and the spacing timer. Apply the warning lag. Log the planned and actual times with the purpose (DIR-57) and the explanation chain (DIR-06).

All random choices come from named streams, so the whole step is deterministic given the state.

### 5.6 Budgets

| Budget | Value | Principle |
|---|---|---|
| Pushes | 2 to 4 per play-hour soft; 2 per rolling 10 min hard | DIR-30 |
| Queue arrivals | at most a third of the hard cap | DIR-31 |
| Owed pushes | at most one | DIR-34 |
| Threads near V | 4 attended, 2 live, 1 climactic, 8 simmering | DIR-32 |
| Hostile thread dwell | imminent 15 play-min; proximal 3 game days and 2 sessions | DIR-50 |
| Director actions of class 2 or 3 | capped per hour; zero of class 4 | DIR-02 |
| Salience of passive offers | set per district by the harness | DIR-30 |

### 5.7 Lead time

Lead time is the interval between the first sign of something and its arrival. Only the warning lag and the warn and standby grammar come from outside sources. The rest is judgement for the harness to tune.

| Unit | First trace before the offer or contact | Traces before first contact | Refresh | Warn, standby |
|---|---|---|---|---|
| Encounter (seconds to minutes) | 5 to 60 s: a sound, bystanders moving, a glance | one | none | warn 60 s; standby 10 s |
| Gig (minutes to hours) | 10 to 30 play-min before the offer or the contact | at least two of different kinds (DIR-46) | if the last trace is more than 30 play-min old at contact | warn 60 s; standby 10 s; call lag 8 s |
| Arc (days of game time, sessions) | at least one session, or 1 to 3 game days, before the first contact | at least two, spread across sessions | at the start of each session in which the thread is live | as gig |

Dread ladder (DIR-45), with what changes at each stage:

| Stage | Signs | Channels | Cap on dwell | Clock |
|---|---|---|---|---|
| Distal | rumour, news, a message from a contact | 0, 1, 2 | 3 game days and 2 sessions | segments tick slowly with the world |
| Proximal | sightings in the district, changed routines, a contact goes quiet | 0, 1, 2 | as above | ticks follow game time and V's actions |
| Imminent | sounds, shadows, bystanders leaving, a nearby call | 0, 1, 2, 3 | 15 play-min | V can seek the handle (DIR-51) |
| Contact | the threat acts | any the seed allows | until resolved | the clock fills or is broken |
| After | a closing trace, then rest | 0, 1 | `R` of §5.4 | |

### 5.8 A toy model of when an offer can be delivered

This is the only simulation in the dossier. **All inputs are assumed**, not measured. It shows how the choice of rule changes waits and bursts. It does not show what players do.

**Assumptions.** V moves through seven activities as a semi-Markov chain with gamma-distributed stays (shape 2). Mean stays in play-minutes: on foot 2.5, driving 4.0, talk 2.5, fight 1.2, menu 1.0, loot 0.8, idle 0.4. The transition probabilities are mine. Long-run time shares come out at on foot 39 per cent, driving 28, talk 13, fight 7, menu 6, loot 5, idle 2. Requests arrive at random moments over 40 simulated hours (4,000 requests). The model is about 150 lines of standard-library Python with fixed seeds; it is not kept in the repository, and the assumptions above specify it fully. A silent message is allowed on foot, driving, idle and loot (74 per cent of the time). A call or approach is allowed only on foot and idle (41 per cent, a conservative setting). The settle time is 10 s. "Coarse breakpoint" means the first seconds after leaving talk, fight or menu.

**Waiting time for one request.**

| Channel | Rule | Mean wait | Median | 90th percentile | Delivered at once | Over 5 min | Over 15 min |
|---|---|---|---|---|---|---|---|
| Message | State gate | 22 s | 0 s | 79 s | 75% | 1% | 0% |
| Message | State gate and 10 s settle | 24 s | 0 s | 92 s | 73% | 1% | 0% |
| Message | Coarse breakpoint only, 5 s grace, 60 s window | 271 s | 189 s | 650 s | 11% | 34% | 4% |
| Message | Coarse breakpoint only, 5 s grace, 120 s window | 237 s | 152 s | 602 s | 19% | 30% | 3% |
| Call or approach | State gate and 10 s settle | 144 s | 55 s | 425 s | 39% | 17% | 1% |
| Call | Coarse breakpoint only, 8 s grace, 60 s window | 624 s | 425 s | 1,535 s | 6% | 60% | 24% |
| Trace | State gate | 16 s | 0 s | 57 s | 82% | 0% | 0% |

Reading it: a state gate is cheap for silent offers. A rule that makes every offer wait for a coarse breakpoint costs minutes, so the breakpoint rule has to be a preference tied to relevance and importance (DIR-15), with a maximum wait (DIR-25) and the relaxation in step 5. For comparison, Iqbal and Bailey measured a mean deferral of 88.6 s (SD 139.3 s) for breakpoint scheduling on desktop tasks, which sits between the first and third rows.

**Releasing a queue.** Requests arrive at random at 4, 8 or 12 an hour, and each is delivered by the message rule.

| Arrivals per hour | Release rule | Most in 60 s | Most in 10 min | 10-min windows with more than 2 | Mean wait | 90th percentile wait |
|---|---|---|---|---|---|---|
| 4 | At the first allowed moment | 4 | 5 | 3.6% | 26 s | 94 s |
| 4 | 180 s cooldown | 1 | 4 | 2.6% | 61 s | 190 s |
| 4 | At most 2 per rolling 10 min, 60 s apart | 2 | 2 | 0% | 82 s | 291 s |
| 8 | At the first allowed moment | 4 | 8 | 16.6% | 28 s | 100 s |
| 8 | 180 s cooldown | 1 | 4 | 15.4% | 134 s | 379 s |
| 8 | At most 2 per rolling 10 min, 60 s apart | 2 | 2 | 0% | 405 s | 1,094 s |
| 12 | At the first allowed moment | 6 | 10 | 33.6% | 27 s | 97 s |
| 12 | 180 s cooldown | 1 | 4 | 38.2% | 302 s | 781 s |

With a cap of 2 per 10 minutes the system can serve 12 an hour at most, so 12 arrivals an hour never settle (not shown). Three things follow, all consequences of the assumptions: a cooldown alone does not hold a rolling cap; a cap needs arrivals well below it or the queue ages; and a queue with no expiry stores a backlog that will drop on V at the next break.

### 5.9 Calibration plan and measures

The numbers above are starting values. The harness replaces them with these measures. Where a measure needs a human, it uses consented sessions with local data (D-09, dossier 12).

| # | Measure | How to compute | Principle |
|---|---|---|---|
| M-1 | **Burst** | Most pushes in any 60 s and any 10 min; share of 10-minute windows over the cap | DIR-24, DIR-30 |
| M-2 | **Forbidden deliveries** | Pushes delivered inside a forbidden aspect or a vanilla state; target zero | DIR-13, DIR-21 |
| M-3 | **Waits and expiry** | Wait distribution by channel and importance; share expired, by rule | DIR-14, DIR-25 |
| M-4 | **Ill-timed proxy** | Share of pushes followed within 10 s by a dismissal, a menu opening or a repeated screen | DIR-16 |
| M-5 | **Phase statistics** | Peak duration, inter-peak interval distribution, rest durations, rests that began mid-fight | DIR-27, DIR-28 |
| M-6 | **Estimate against rating** | Correlation of `A`, `N` and `T` with intensity ratings given every few minutes; its trend over weeks | DIR-05, DIR-12 |
| M-7 | **Leverage against importance** | Rank correlation of computed leverage with rated importance of beats | DIR-40 |
| M-8 | **Schedule stability** | Identical schedule and pending offers after a reload | DIR-09, DIR-59 |
| M-9 | **Rest effect** | Rating of the next peak after short, medium and long rests (the claim in lens L12 that nobody tested) | DIR-26, DIR-28 |
| M-10 | **Queue age** | Queue length and oldest age against `ρ` | DIR-31, DIR-34 |
| M-11 | **Audit** | Explanation-chain coverage (target 100 per cent); class 4 actions (target zero); class 2 and 3 per hour | DIR-02, DIR-06 |
| M-12 | **Three arms** | Director against fixed schedule against random release, on the same seeds, blind ratings | DIR-04 |
| M-13 | **Dread** | Rated tension by stage; dwell against rated annoyance; recall of the cause at payoff; rated fairness with and without disclosure | DIR-41 to DIR-52 |
| M-14 | **Gaming** | A synthetic player that waits for rest or hoards to farm offers should gain nothing | DIR-36, DIR-53 |
| M-15 | **Vanilla baseline** | `A_game` over hours of play with the engine off, to set headroom | DIR-29 |
| M-16 | **Return and reload** | Duplicate or contradictory offers after loads | DIR-59 |

### 5.10 How it sits on the kernel

- **The director is a root actor.** The [foundation](../foundation.md) gives it drives of tension, variety and relevance to V. The slow part of the pacing model fits there: a `rest` urgency that rises with recent intensity and falls during rest, a `stimulus` urgency that rises with quiet time, frames whose interests are V's combat, heat and district changes, and thread pressure counted through frame pull ([§10](../spec/kernel.md#10-context-frames-and-relevance)). Beliefs about V come from observed events only ([§11.3](../spec/kernel.md#113-the-directors-beliefs-about-v)).
- **The fast loop is not a kernel process.** `A`, the load flags and the release step run once a second of play. The kernel's evolution runs in windows of 600 game seconds ([§9.4](../spec/kernel.md#94-evolution)) and applies external operations at the window boundary, so relevance emitted to the director would arrive late. The fast loop therefore reads the event feed directly, and only its consequences enter the record: offers made, rests taken, thread stages, clocks.
- **Pacing state is session state.** It is not canon and is not persisted. After a load it restarts in the settling phase (DIR-59). What persists is what the record already holds: threads, stages, clock segments and the events that offers produced.
- **Two clocks.** The kernel has only `GameTime`. Pacing needs a play clock that stops in menus, pause and photo mode and does not jump over sleep or waits (DIR-34). Events must carry both stamps (§9, PR-3).
- **Thread stages and clocks are slots on seed nodes.** A stage is a time-varying slot ([§6.3](../spec/kernel.md#63-time-varying-slots)) driven by the clock and by V-relative distance. Distance makes the stage depend on V's vantage, as the level of detail does.
- **Offers are pinned when they are made,** so a reload shows what V was shown and does not draw a fresh offer (SAV-02).

## 6. Tensions

| # | Tension | One side | The other side | How to settle it |
|---|---|---|---|---|
| T-1 | **Rest against a city that is never dead** (quality bar 7) | Rest withholds pushes (DIR-27, DIR-29) | A quiet city must not read as empty | Rest limits pushes only. A floor of class 0 traces and pins stays on, and pull is never blocked (DIR-37) |
| T-2 | **A fair threat or a helpful director** (map) | A threat that must find V is fairer and scarier by design intent (DIR-03) | Help V can detect lowers trust (DIR-06) | Keep the two apart. Hints are coarse regions with a trace chain, never a direct fix on V |
| T-3 | **Reactive pacing or a fixed rhythm** (map: which variable paces) | Meter intensity and react to it (DIR-12, DIR-27) | Delay makes reactive control oscillate, and a reload must show the same schedule (DIR-09, DIR-35) | A fixed, reload-stable base schedule creates the opportunities. The reactive layer only subtracts. Pace which beat to book by leverage (DIR-40) and when by intensity. The three-arm test (M-12) decides |
| T-4 | **Disclose or surprise** (PAC-02) | A threat announced beforehand builds tension (DIR-41) | Variety wants some events with no warning | Disclose threats V can act on. Leave texture and minor events to surprise. Test both (M-13) |
| T-5 | **Honest clocks or an absent player** (NAR-17, MOT-01) | A clock fires whether or not V attends (DIR-48) | A deadline that punishes someone who was elsewhere breeds resentment | A full clock changes the world, not V's progress, and a decline is a consequence. V can seek the handle (DIR-51) |
| T-6 | **Less interruption or a world that does not wait** | Offers should not break what V is doing (DIR-14 to DIR-20) | Legion pushed missions on purpose so the world would not feel like it waits | Push, but through the arbiter's gates and negotiated channels. Most vanilla offers are pins, which cost nothing (§5.3) |
| T-7 | **An omniscient director or perspectives** (D-10) | The director must see V to pace | Everyone else has only their own model | The director is the one root actor with that view. Threats and people read through `knows` (DIR-03) |
| T-8 | **Pacing or a retention engine** (L10, dossier 12) | A director that watches V can improve pacing | The same machinery can serve return rate | No retention objective (DIR-07); an audit; local, consented data |
| T-9 | **Determinism or freshness** (SAV-02) | A reload shows the same offer (DIR-09, DIR-59) | Fully deterministic content looks scripted | The schedule is a function of state. Variety comes from differing states and sowing, not re-rolls. Jitter is seeded by state (DIR-36) |
| T-10 | **Authored windows or rest** ([dossier 6](d06-sifting-tellability.md) T-8) | A fixed window must not be crowded out | Rest protects V | The author's deadline ranks above sown requests. At the deadline the seed plays low-intensity or degrades (DIR-08) |
| T-11 | **Learning from play or the model of V** (D-09) | Approach signs and responses improve timing (DIR-22, DIR-39) | The engine must not assign or infer V's drives | Use observed events only (returns, dwell, accepted and ignored offers). Keep the belief and its confidence inspectable. No mood inference |
| T-12 | **A learnable cadence or reload stability** | Players learn a fixed rhythm and wait for it (P-8) | A reload must not change the schedule | Jitter drawn from the saved state, and plenty of pull content so waiting gains nothing (DIR-36, DIR-37) |

## 7. Lateral links

- The director's **rest urgency** has the same shape as a deficit drive in [dossier 1](d01-motivation-drives.md): it rises while intensity stays high and discharges during rest, and the kernel's drive model already reads importance and urgency ([§10.1](../spec/kernel.md#101-drives)).
- **Legion's request** is the seed's timing request (FIT-48). Its attention aspects are the load flags. Its category timer is the separation rule of [dossier 5](d05-units-variety.md) VAR-19. Its maximum wait is a window.
- **Alien: Isolation's front stage and backstage** are fine and coarse levels of detail. A retreating threat dissolves into the field and returns as an individual (DS-50). Its menace gauge is a function of distance and sight, like the pull of a frame.
- **Warn, standby, go** is the same as asking the kernel's demand tiers to open a venue ahead of a beat, which is also the load-time goal's lead.
- **A master scenario inject** is a request with a purpose and a log. The **stand-in cell** is a summary that speaks for absent actors ([§9.3](../spec/kernel.md#93-summaries-and-their-refinement)).
- **Alarm floods and the cry-wolf effect** are push bursts and false-alarm ratios on traces. **Anti-windup** is the owed cap.
- **A leverage index and Ely's suspense** are the same quantity, a spread of the next belief, computed on a thread's outcome weights ([§5.3](../spec/kernel.md#53-weights)).
- **An escape room's observable-state triggers** are a seed's window predicates over facts. Its **hint ladder** is the channel ladder, one rung at a time.
- **Cassandra's fixed phases** are hashed draws on a named stream ([§1.4](../spec/kernel.md#14-random-streams)).
- **A danger clock** is a time-varying slot with a named form for each way it can end (FIT-46).
- **Approach signals in immersive theatre** are observed evidence in the engine's belief about V, held with a confidence.

## 8. Open questions

1. **How much intensity does the base game already supply?** The headroom rule (DIR-29) needs `A_game` over hours of play with the engine off. Nothing is measured. The base game's ambient fights re-arm every 12, 24 or 36 game hours and heat rises on its own, which suggests the headroom is small near crowded districts.
2. **Which transitions are breakpoints in Night City?** The feed reports explicit transitions, but whether a cognitive chunk has ended (reading a journal update, looking at a map) is not reported. Session logs will say which transitions precede dismissals.
3. **Do the intensity weights track what players feel?** Booth's slides give inputs and no weights, and call the estimate crude. M-6 sets them.
4. **Does rest raise the rating of the next peak?** The belief is common to designers and untested here (M-9).
5. **Does disclosure raise rated tension at equal exposure?** Hitchcock's claim has no controlled test that I found (M-13).
6. **How long can a trace be remembered across sessions?** DIR-56's lead classes assume a session. A recall probe at payoff would give the half-life.
7. **How should the director behave when the player has switched chatter and notifications off?** Channels 1 and 2 may then be unavailable, which pushes everything to pins.
8. **Does a visible clock help or spoil dread?** Practitioners say do not hide clocks (Blades in the Dark). In a horror setting, concealment may matter more. Test both.
9. **How many hostile threads can run at once?** DIR-32 gives limits for threads in general. Hostile ones may need a tighter limit (a first guess of one imminent at a time).
10. **Does the toy model's shape survive real activity mixes?** §5.8 used assumed stays and transitions. Replacing them with the traces of real sessions is the first calibration step.
11. **Kernel timing.** Does relevance reach the director when a reading arrives, or only at the next 600-second boundary (§5.10)? If the second, the fast loop must stay outside the kernel, as proposed.
12. **What does a pause or a photo-mode session do to the play clock and the rest timers?** The proposal is that both stop. A player who leaves the game paused for an hour should not return to find the engine rested and without any memory of the peak that came before.

## 9. Requirements for the procedural engine (P5)

What the director and arbiter must do, and what they need from the kernel, the seed language and the game port. Each traces to a principle in §4. "Must" is a requirement; "should" is a default the harness may change with evidence (§5.9). Comparisons with outside systems are never sources of the engine's concepts (D-21).

**Roles and limits**

| # | Requirement | Traces to |
|---|---|---|
| PR-1 | The procedural engine has a director (layer 3) and an arbiter (layer 2). Nothing reaches V except through the arbiter | DIR-13, DIR-23 |
| PR-2 | The director's verbs are `trace`, `offer`, `hold`, `withdraw`, `nudge` and `rest`, each with a manipulativity class from 0 to 3. Class 4, changing anything V has observed or could base a choice on, must not exist. Every action is logged with its class | DIR-02 |
| PR-3 | The director changes timing and rate only. Stakes, hostility and rewards come from the seed and the world. Any action that changes a unit's strength is a logged defect | DIR-01 |
| PR-4 | Threat actors read the world only through `knows`. The director alone reads V's position. A hint to a threat is a region coarser than V's tier and carries a trace chain that explains how the threat could know | DIR-03 |
| PR-5 | Every director action carries an explanation chain to a recorded fact, or to a cause labelled `constructed` | DIR-06 |
| PR-6 | The director's objective contains no return-rate, session-length or streak term, and the objective is listed in an audit | DIR-07 |
| PR-7 | An authored request carries a hard deadline from its window, ranks above sown requests until then, and at the deadline plays low-intensity or degrades by a named form | DIR-08, DIR-25 |
| PR-8 | A tempo setting (off, calm, steady, restless) scales the cadence parameters of §5.1 within bounds, separate from tone and intensity controls. Off means pull only, plus fitting of authored seeds | DIR-10 |

**Clocks, state and determinism**

| # | Requirement | Traces to |
|---|---|---|
| PR-9 | The engine keeps a play clock that stops in menus, pause and photo mode and does not advance over sleep, waits or fast travel, beside game time. Events from the game port carry both stamps (S5) | DIR-34, DIR-59 |
| PR-10 | Rest, spacing, caps and thread budgets run on the play clock. Threat clocks and traces run on game time | DIR-34, DIR-48 |
| PR-11 | Pacing state (`A`, `N`, the load flags, the phase, timers) is session state. It is not persisted. After a load it restarts in settling | DIR-59 |
| PR-12 | The base schedule's slots are hashed draws on named streams from the world seed and the saved state, so a reload shows the same schedule. Jitter is seeded from state | DIR-09, DIR-36 |
| PR-13 | An offer is pinned when it is made, and its `offer_id` derives from the seed and the saved state, so a reload shows what V was shown | DIR-59 |
| PR-14 | The fast loop (once a second of play) reads the event feed directly and writes only consequences to the record: offers made, rests taken, thread stages, clock segments. S0's owners confirm when relevance reaches the director (open question 11) | §5.10 |
| PR-15 | The game port provides, as events or polls: combat state and whether a hostile is aware of V; V's health; deaths and defeats near V; heat stage and pursuit; vehicle state and collisions; menu, dialogue, scene and loot or shop states; photo mode, pause and loading; vanilla banner, call and scene states; input silence; and the position of the tracked objective. Rows S1 to S6 of the [runtime requirements](../runtime-requirements.md) cover part of this; the rest is added there | DIR-12, DIR-13, DIR-20, DIR-21, DIR-60 |

**Estimates**

| # | Requirement | Traces to |
|---|---|---|
| PR-16 | The director keeps `A`, `N`, the load class with its flags, and `P` apart, and uses `T = max(A, N)` for phases | DIR-11, DIR-05 |
| PR-17 | `A` follows §5.2: a sum of sensed inputs, decaying unless `engaged`. The weights and thresholds are data in a pack setting, not code | DIR-12 |
| PR-18 | Attention aspects and the load class come from the feed (§5.3). Vanilla states are aspects with infinite priority | DIR-13, DIR-21 |
| PR-19 | An engagement flag is set while V has recent progress on an objective or is near its tracked pin. Only relevant requests pass while it is set | DIR-20 |
| PR-20 | An away marker is set after 60 s of input silence with no menu open. While set, only class 0 and 1 channels are used | DIR-60 |
| PR-21 | The engine's belief that V is receptive to a kind of offer is built from observed events only, including approach signs, and is held with a confidence. The decision among nothing, a probe and a push follows two thresholds | DIR-22, DIR-39 |

**The arbiter**

| # | Requirement | Traces to |
|---|---|---|
| PR-22 | A request has the fields of §5.5. The record is data in the seed language | DIR-23 |
| PR-23 | The release step of §5.5 runs once a second of play and releases at most one request. Category timers, a global spacing of at least 60 s, and a rolling cap of 2 per 10 minutes are hard gates. Release times are jittered | DIR-24, DIR-30, DIR-36 |
| PR-24 | Requests below a relevance threshold need a coarse breakpoint inside their window. The rule relaxes after 70 per cent of the maximum wait. The hard gates never relax | DIR-14, DIR-15, DIR-25 |
| PR-25 | A settle time follows every high-load state. A call or approach is preceded by a warning lag of at least 8 s. Channels are negotiated by default and no push forces a scene | DIR-16, DIR-17, DIR-18 |
| PR-26 | Every request has a maximum wait and a named form at expiry. The queue has an arrival limit of about a third of the cap, and the owed count is capped at one | DIR-25, DIR-31, DIR-34 |
| PR-27 | A nudge needs an accepted goal and 30 to 60 s without progress. Its first rung points at an area or a person | DIR-19 |
| PR-28 | Channels carry an interruptiveness class. A request lists its channels from best to the lowest acceptable. A fragment that works only on the top rung is flagged | DIR-17, FIT-47 |

**Rest and budgets**

| # | Requirement | Traces to |
|---|---|---|
| PR-29 | The phase machine of §5.4 runs on the play clock with hysteresis. Rest begins only at a natural break. The reactive layer holds, delays or withdraws and never adds | DIR-27, DIR-35 |
| PR-30 | Rest lengths follow §5.4 by scale. Pushes may add intensity only up to the headroom above the sensed intensity of the game | DIR-28, DIR-29 |
| PR-31 | Rest never blocks pull. A floor of ambient traces keeps the city from reading as dead | DIR-37 |
| PR-32 | The thread budget counts threads that have reached V's awareness: 4 attended, 2 live, 1 climactic, 8 simmering. Overflow merges, queues or withdraws the lowest-pull thread with a closing trace. Every attended thread has a re-findable cue | DIR-32, DIR-33 |
| PR-33 | For threads with at least two declared outcomes, the engine computes leverage and next-belief spread from outcome weights, and books high-leverage beats into the first receptive window after a rest | DIR-40 |
| PR-34 | Every thread has a no-take path that ends in a named form | DIR-38 |

**Dread**

| # | Requirement | Traces to |
|---|---|---|
| PR-35 | A hostile thread has a disclosure step before first contact, at least two traces of different kinds at gig and arc scale, all generated from the thread's record. Each trace declares V-visible options before and after | DIR-41, DIR-42, DIR-46 |
| PR-36 | A hostile thread moves through distal, proximal, imminent and contact stages driven by travel-time distance, line of sight and its clock. The imminent stage lasts at most 15 play-minutes, the proximal stage at most 3 game days and 2 sessions. Beyond a cap: contact or a stand-down trace | DIR-45, DIR-50, DIR-47 |
| PR-37 | A hostile thread has a clock with a perceivable source. A full clock changes the world, not V's progress. A decline is a consequence | DIR-48 |
| PR-38 | From the proximal stage on, a hostile thread has a handle V can seek, and seeking it advances the clock | DIR-51 |
| PR-39 | The director picks traces to keep V-visible evidence in the middle band of uncertainty while a thread builds, requires a suspense state before a fear-type payoff, and sets the payoff at least as large as the declared build, followed by rest | DIR-43, DIR-44, DIR-49 |
| PR-40 | Threat behaviours unlock from observed progress counts, never from V's failures. A threat has an exposure cap per session. No director state is shown to V except diegetic signs | DIR-52, DIR-53 |

**Staging, logs and tests**

| # | Requirement | Traces to |
|---|---|---|
| PR-41 | A staged beat is warned (at least 60 s of play ahead, requesting finer detail for the venue and cast), held on standby (at least 10 s, with the arbiter's slot reserved) and then released. A beat that starts without its detail is a logged defect | DIR-54 |
| PR-42 | A seed states a lead preference for a window V can close. The engine raises urgency from the time since the window opened and V's distance from the closing place | DIR-55 |
| PR-43 | Lead classes follow §5.7. A trace not met for one session is refreshed | DIR-56 |
| PR-44 | Every push has a purpose from a closed vocabulary and is logged with its planned and actual time and its explanation chain | DIR-57, DIR-06 |
| PR-45 | Resolution has three tiers: simulated state, summaries, and bounded director judgement. Off-stage actors speak through coarse summaries | DIR-58 |
| PR-46 | The logs let a harness compute M-1 to M-16 of §5.9 without running the engine, and a switch selects the three arms (fixed schedule, random release, director) | DIR-04, §5.9 |
| PR-47 | Each push and each hold has a "why" trace readable by an agent, with the estimates, gates and rules that applied | DIR-06, DIR-57 |

**Interfaces other plans owe**

- **P4 (seed language).** A timing request (importance, tolerated aspects, maximum wait, relevance window, channel ladder, lead preference, expiry form). A declared intensity effect on a unit. For hostile seeds: a clock with segments, tick sources and visible signs per segment, declared outcome classes, trace kinds, and a V-seekable handle. A no-take form. Dossier 3 requirements 19, 22, 23 and 31 already cover part of this.
- **P8 and the game port (S5).** The senses of PR-15 and the channel classes of §5.3, with plain reporting of what is unavailable (chatter off, banner busy).
- **P9 (evaluation).** M-1 to M-16, the three-arm protocol, consented intensity probes and an exploit player (M-14).
- **S0 (kernel).** A play-clock stamp on events, and a statement on when relevance is delivered to a root actor (open question 11).

## Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give.

| # | Field | Source | Tier |
|---|---|---|---|
| MM-1 | **Notification management and receptivity prediction** (breakpoints, relevance and engagement, opportune-moment models) | Iqbal and Bailey 2008 and Mehrotra and Musolesi 2018 (read); Adamczyk and Bailey 2004, Fischer et al. 2011 (abstracts) | Core for PAC-05: the map holds only Horvitz and McFarlane |
| MM-2 | **Threat imminence, dread and anticipation under uncertainty** (neuroscience and decision research) | Mobbs 2007, Berns 2006, de Berker 2016, Loewenstein 1987 | Supporting, under PAC-03 |
| MM-3 | **Sequential emotion and excitation transfer** | Zillmann; search summaries only | Peripheral |
| MM-4 | **Event schedulers in colony and strategy games** (phase cycles, guarantees, spacing, scaling by wealth) | RimWorld wiki pages (read) | Supporting, under PAC-04. Dossier 3 flagged scoped event scripting; this is the scheduling half |
| MM-5 | **Hidden meters and exploit-by-design** | Grip 2014 (read), Goodhart and Campbell (memory) | Supporting, under PAC-07 |
| MM-6 | **Dynamic difficulty adjustment and its perception** (hidden against disclosed adaptation, perceived cheating, flow) | A 2025 systematic review and a thesis on hidden against upfront adjustment, both seen only in search results | Supporting, adjacent to PAC-04 and ETH-20 |
| MM-7 | **Engagement time and idle detection** (a play clock; away markers) | None found for games; Horneman's note on what a system cannot know | Peripheral, but it shapes a kernel requirement |
| MM-8 | **Perceived fairness of game AI** | Thompson on Alien: Isolation; opinion pieces on rubber-banding. No study found | Supporting |
| MM-9 | **Pacing of pushed content in alternate-reality and live games** (Majestic, daily caps) | Engadget and encyclopaedia pages (summary) | Supporting. Lens L1 has ARGs under field 5 |

## Credit candidates

Each third-party work that taught us something used in the principles above. "opened" means I opened the page this session; "indexed" means I saw it in search results or only an abstract or a secondary account.

| Creator as evidenced | Work | Link | What we learned | Link status |
|---|---|---|---|---|
| Michael Booth (Valve) | "The AI Systems of Left 4 Dead", AIIDE 2009 slides | https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf | An intensity number that decays unless enemies are engaging, four phases with timings, and the rule that a director changes frequency, not strength (entry exists) | opened |
| Jurie Horneman (Ubisoft Toronto) | "Watch Dogs: Legion and the Player Attention System" | https://toronto.ubisoft.com/watch-dogs-legion-and-the-player-attention-system/ | One arbiter for missions and dialogue, requests with importance, tolerated distractions and a maximum wait, and the limits of what a system can know about attention | opened |
| Tommy Thompson (AI and Games) | "The Perfect Organism: The AI of Alien: Isolation" and "Revisiting the AI of Alien: Isolation", Game Developer | https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation | A director that knows where the player is, a hunter that must find them, and a menace gauge that pulls the hunter away | opened |
| Andy Bray (Creative Assembly), as reported by Thompson | Talk at nucl.ai, 2016 | (through Thompson's articles) | The hunter is never allowed to cheat, and a player cannot be scared senseless all the time | summary through Thompson |
| K Thor Jensen | "How Much Friction?", Game Developer, 29 Oct 2014 | https://www.gamedeveloper.com/design/how-much-friction- | Tension gave way to annoyance when the mechanics stopped testing the player's growing mastery | opened |
| Ben Serviss | "The Discomfort Zone: The Hidden Potential of Valve's AI Director", Game Developer, 7 Feb 2013 | https://www.gamedeveloper.com/design/the-discomfort-zone-the-hidden-potential-of-valve-s-ai-director | The line between productive discomfort and toying with players is fine, and options are the safeguard | opened |
| Thomas Grip (Frictional Games) | "Game Design Deep Dive: Amnesia's Sanity Meter", Game Developer, 27 Aug 2014 | https://www.gamedeveloper.com/design/game-design-deep-dive-i-amnesia-i-s-sanity-meter- | A hidden meter, shown only as an image, that discourages looking at monsters, and the exploits it still invited | opened |
| RimWorld wiki contributors; Tynan Sylvester and Ludeon Studios | Pages on Cassandra Classic, Phoebe Chillax, Randy Random and the AI storytellers | https://rimworldwiki.com/wiki/Cassandra | Deterministic On and Off cycles, guarantees, spacing, and cadence kept apart from difficulty (Sylvester and Ludeon entry exists) | opened |
| Mark Nelson, Michael Mateas, David Roberts and Charles Isbell | "Declarative Optimization-Based Drama Management in Interactive Fiction", IEEE CG&A 2006 | https://www.cs.uky.edu/~sgware/reading/papers/nelson2006declarative.pdf | Five kinds of manager action, a manipulativity score for each, and a feature that rewards leaving the player choices (entry exists) | opened |
| Kristen K. Yu, Matthew Guzdial and Nathan R. Sturtevant | "Evaluating the Effects of AI Directors for Quest Selection", arXiv 2410.03733, 2024 | https://arxiv.org/abs/2410.03733 | A small human study of three quest-selection directors, and the statement that the best-known director has no comparative data | opened |
| Mira Fisher, Molly Siler and Stephen G. Ware | "Structure, Agency, and Improvisation in Human-Led Digital Interactive Narrative Exercises", AIIDE 2025 | https://www.cs.uky.edu/~sgware/reading/papers/fisher2025structure.pdf | Perceived structure and perceived agency go together, and poor agency reads as a failed partnership | opened (abstract and introduction) |
| Noah Wardrip-Fruin, Michael Mateas, Steven Dow and Serdar Sali | "Agency Reconsidered", DiGRA 2009 | https://dl.digra.org/index.php/dl/article/view/369 | Agency arises where what the player wants to do is what the system supports | indexed |
| Eric Horvitz | "Principles of Mixed-Initiative User Interfaces", CHI 1999 | https://www.interruptions.net/literature/Horvitz-CHI99-p159-horvitz.pdf | Act only when expected value beats inaction, add a cheap dialogue option, and weigh the cost of bothering the user | opened |
| Shamsi T. Iqbal and Brian P. Bailey | "Effects of Intelligent Notification Management on Users and Their Tasks", CHI 2008 | https://www.interruptions.net/literature/Iqbal-CHI08.pdf | Deferring to breakpoints lowers frustration, relevance sets how fine a breakpoint is needed, and detection is imperfect | opened |
| J. Gregory Trafton, Erik M. Altmann, Derek P. Brock and Farilee E. Mintz | "Preparing to resume an interrupted task", IJHCS 58, 2003 | https://interruptions.net/literature/Trafton-IJHCS03.pdf | An 8 second warning before an interruption helps people prepare and resume | opened |
| Adamczyk and Bailey | "If Not Now, When?", CHI 2004 | https://hci.rwth-aachen.de/materials/conferences/CHI2004/1p271.pdf | Interruptions at different moments differ in emotional effect | indexed |
| Daniel C. McFarlane | "Comparison of Four Primary Methods for Coordinating the Interruption of People in Human-Computer Interaction", HCI 17, 2002 | https://www.interruptions.net/literature/McFarlane-HCI02_2.pdf | Immediate, negotiated, mediated and scheduled interruption, and the advantage of negotiation | indexed |
| Gloria Mark, Daniela Gudith and Ulrich Klocke | "The Cost of Interrupted Work: More Speed and Stress", CHI 2008 | https://www.interruptions.net/literature/Mark-CHI08.pdf | People finish interrupted work faster at the price of stress, so an absence of complaints is weak evidence | indexed |
| Joel E. Fischer, Chris Greenhalgh and Steve Benford | "Investigating Episodes of Mobile Phone Activity as Indicators of Opportune Moments to Deliver Notifications", MobileHCI 2011 | https://interruptions.net/literature/Fischer-MobileHCI11.pdf | Notifications are handled faster just after an episode of activity ends | indexed |
| Abhinav Mehrotra and Mirco Musolesi | "Intelligent Notification Systems: A Survey of the State of the Art and Research Challenges", arXiv 1711.10171 | https://arxiv.org/abs/1711.10171 | A survey of breakpoints, engagement and receptivity, with the size of the effects | opened |
| Ching-Yu Hsieh, Yi-Shyuan Chiang, Hung-Yu Chiu and Yung-Ju Chang | "Bridging the Virtual and Real Worlds: A Preliminary Study of Messaging Notifications in Virtual Reality", CHI 2020 | https://doi.org/10.1145/3313831.3376228 | Higher engagement made notifications feel worse timed | opened |
| Chen, Nelson and Mateas (first names not checked) | "Evaluating the Authorial Leverage of Drama Management", AIIDE 2009 | https://ojs.aaai.org/index.php/AIIDE/article/view/12377 | Three measures for asking whether a drama manager beats a trigger script | indexed (read by lens L8) |
| Thue, Bulitko, Spetch and Wasylishen | "Interactive Storytelling: A Player Modelling Approach", AIIDE 2007 | https://ojs.aaai.org/index.php/AIIDE/article/view/18780 | Adapting a story to a learned play style helped some players in a 101-person study | indexed |
| Lehne and Koelsch | "Toward a general psychological model of tension and suspense", Frontiers in Psychology 6, 2015 | https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00079/full | Tension precedes events and rests on prediction under uncertainty, and the effect of delay is an open question | opened |
| Archy de Berker and colleagues | "Computations of uncertainty mediate acute stress responses in humans", Nature Communications, 2016 | https://pmc.ncbi.nlm.nih.gov/articles/PMC4820542 | Stress tracks uncertainty that cannot be reduced and peaks at even odds | opened |
| Vanus Vachiratamporn, Paul Inventado, Roberto Legaspi, Koichi Moriyama and Masayuki Numao | "Analysis of affective state transitions in survival horror games", JSAI 2013 | https://www.ai-gakkai.or.jp/jsai2013/webprogram/2013/paper-987.html | Players already in a suspense state were more likely to become more fearful at a scare (initial results) | indexed |
| Gregory S. Berns and colleagues | "Neurobiological substrates of dread", Science, 2006 | https://pubmed.ncbi.nlm.nih.gov/16675703/ | Some people choose a worse outcome sooner rather than wait | indexed |
| Mobbs and colleagues | "When Fear Is Near: Threat Imminence Elicits Prefrontal-Periaqueductal Gray Shifts in Humans", Science, 2007 | https://pmc.ncbi.nlm.nih.gov/articles/PMC2648508 | Responses change as a threat gets closer, tracking dread | indexed |
| George Loewenstein | "Anticipation and the Valuation of Delayed Consumption", Economic Journal, 1987 | https://ideas.repec.org/a/ecj/econjl/v97y1987i387p666-84.html | People savour good outcomes and want bad ones over with | indexed |
| Jeffrey Ely, Alexander Frankel and Emir Kamenica | "Suspense and Surprise", Journal of Political Economy, 2015 | https://www.journals.uchicago.edu/doi/10.1086/677350 | Suspense as the spread of the next belief and surprise as the size of the belief change | indexed |
| David Bordwell | "Hitchcock, Lessing, and the bomb under the table", 2013 | https://www.davidbordwell.net/blog/2013/11/29/hitchcock-lessing-and-the-bomb-under-the-table/ | The suspense and surprise distinction has an older and murkier history than the legend | indexed |
| Nelson Cowan | "The magical number 4 in short-term memory", Behavioral and Brain Sciences 24, 2001 | https://pubmed.ncbi.nlm.nih.gov/11515286/ | A central limit of about four items in the focus of attention | indexed |
| Ghibellini and Meier | Review of the Zeigarnik effect, Humanities and Social Sciences Communications 12, 2025 | https://doi.org/10.1057/s41599-025-05000-w | Unfinished tasks are not remembered better but tend to be resumed | indexed |
| Tom Tango and colleagues | Leverage index, as set out in FanGraphs' library | https://library.fangraphs.com/misc/li | A scale for how much the next moment can swing the outcome | indexed |
| David Spira | "An Exploration of Escape Room Hint Systems", Room Escape Artist, 24 Oct 2019 | https://roomescapeartist.com/2019/10/24/escape-room-hint-systems/ | Hint timing, who triggers it, and the risk of a hint landing as the team solves the puzzle | opened |
| Charles Turnitsa | "Adjudication in Wargaming for Discovery", CSIAC, 2016 | https://csiac.dtic.mil/articles/adjudication-in-wargaming-for-discovery/3 | Rigid, free, semi-rigid, open and matrix adjudication and their costs | opened |
| theatrecrafts.com contributors | "The Prompt Book" | https://theatrecrafts.com/pages/home/topics/stage-management/the-prompt-book/ | The warn and go grammar for cues and what the book holds | opened |
| John Harper (Blades in the Dark), as set out by a practitioner page | Progress clocks | https://slyflourish.com/progress_clocks_in_dnd.html | Danger clocks, their segments, and the advice not to hide them (Harper entry exists) | opened |
| EEMUA, ISA and vendors (Emerson) | EEMUA 191 and ISA-18.2 guidance, as summarised in a vendor article | https://d1-live.emerson.com/documents/automation/article-alarm-management-by-numbers-deltav-en-38292.pdf | Alarm-rate bands and the definition of a flood | indexed |
| Cheong and Young (first names not checked) | "Suspenser: A Story Generation System for Suspense", IEEE TCIAIG 2015 | https://www.cs.uky.edu/~sgware/reading/papers/cheong2015suspenser.pdf | Counting the routes to a goal as an estimate of suspense | indexed (read by lens L8) |
| Adam Alston; Josephine Machon; Thomas Cartelli | *Beyond Immersive Theatre*; *Immersive Theatres*; "Punchdrunk's Sleep No More: Masks, Unmaskings, One-on-Ones" | https://research.gold.ac.uk/28079 | A critique of audience participation as labour, and the approach-signal practice in private scenes | indexed |

