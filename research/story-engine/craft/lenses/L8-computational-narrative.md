# Lens L8: computational narrative

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise. Its patent remarks are out of scope: the Story Engine does no patent searches for its own ideas ([D-20](../../decisions.md)).

Method note. Run on 22 October 2026 by one researcher working alone, with no repository material read. I ran roughly 75 web searches and opened roughly 55 pages or PDFs (papers, proceedings pages, talk recaps, arXiv abstracts), and read in full or in large part the Left 4 Dead director slides (Booth 2009), the Versu paper (Evans and Short 2014), the Doran and Parberry quest-structure paper, the Yu et al. quest-definition paper, the Mawhorter et al. choice-poetics paper, the Suspenser paper, and the FDG 2026 story-sifting paper by Lessard et al. Searches covered narrative planning, drama management, story sifting, storylets and quality/salience-based narrative, story grammars, social simulation (Versu, Comme il Faut, Talk of the Town), suspense/surprise/curiosity, quest research, mixed-initiative tools, LLM story generation and its benchmarks (including 2026 work), evaluation, and interactive-fiction craft. Tags: `[sec]` = the claim rests only on a search-result summary, not on a page or PDF I opened; `[mem]` = a bibliographic entry from background knowledge that I did not re-check this session; "(inferred)" on a principle = my own extrapolation from the cited results, not a finding of the sources. Not reachable: the ACM Digital Library (HTTP 403), Grand Text Auto (connection refused), the GDC Vault (gated or under maintenance), so talk contents are known only from session descriptions or third-party recaps. Principles are written as testable claims; most were tested in the literature only on short texts or small closed storyworlds, and none on an open-world game, so every transfer to the system described in the brief is itself a hypothesis. LLM results (fields 19-20) move fast; numbers are indicative of 2022-2026 models, not fixed.

## Fields

### 1. Story sifting and emergent-narrative curation

**Definition.** Searching the event log of a running simulation for chains that read as stories, then selecting, framing and sometimes retelling them ("overgenerate and curate").

**Why it matters here.** This is the procedural engine's first job: sifting the simulation's history for story-shaped patterns. Concrete problems it addresses: the log of a city simulation is overwhelmingly banal; patterns must run incrementally so a thread can be grown while it is still live; pattern authoring must be cheap; and something must decide which matches deserve an offer.

**Key sources.**
- James Ryan, *Curating Simulated Storyworlds*, PhD dissertation, UC Santa Cruz, 2018, https://escholarship.org/uc/item/1340j5h2. Chapter recaps by Emily Short: https://emshort.blog/2019/05/21/curating-simulated-storyworlds-james-ryan/ and https://emshort.blog/2019/05/28/curating-simulated-storyworlds-james-ryan-ch-6f/ (read).
- Kreminski, Dickinson, Mateas, "Winnow: A Domain-Specific Language for Incremental Story Sifting", AIIDE 2021 (poster), https://ojs.aaai.org/index.php/AIIDE/article/view/18903 (abstract read).
- Kreminski, Dickinson, Wardrip-Fruin, "Felt: A Simple Story Sifter", ICIDS 2019, LNCS 11869, pp. 14-27 (as cited by Lessard et al.).
- Lessard, Friedrich, Pare-Chouinard, Kosseim, "Narrative Gold Digging: Sifting and Narrating Stories from a Procedural Simulation", FDG '26, doi 10.1145/3815598.3815687, https://www.pcgworkshop.com/archive/lessard2026narrative.pdf (read).
- "Stories from the Bottom Up: Emergent Narratives with Composable Story Sifting Patterns", doi 10.1145/3723498.3723809 (ACM page returned 403; existence and topic from search listing only) `[sec]`.

**Instance.** *Bad News* (Ryan et al., CHI 2016): a human curator sifted a *Talk of the Town* town live during performances. Winnow patterns can fire on a partial match while the sequence is still unfolding (prospective as well as retrospective sifting).

**Principles.**
1. Raw simulation output seldom has story structure, so selection from an overgenerated pool is a required stage (Ryan's central claim, per Short's recap). Testable: naive readers rate pattern-selected chains above equal-length random chains from the same log. (Not yet shown in the sifting literature; see failure modes.)
2. Incremental matching creates an opportunity window: if a pattern can flag its first k of n steps, the director can act before the thread resolves. Testable: median sim-time between first partial match and completion, per pattern. (Winnow's stated goal; the window length is my metric.)
3. Appreciation of an emergent chain depends on familiarity with the world and its entities (Lessard et al.'s conclusion). Testable: the same chain scores higher with raters who have met its characters. Implication (inferred): only surface chains whose entities the player has already encountered.

**Failure modes.** Lessard et al. tested "unexpectedness" and "dramatic situations" as absolute sifting heuristics: 24 readers rated six sifted stories, each written once by a human and once by GPT-4, and found no significant relation between the heuristics and reading enjoyment; the clear favourite was the control. They note that sifting research has mostly evaluated algorithmic relevance and interface usability, not reader-perceived interest. They also report that narrativisation can rescue or sink the same events (a human version ranked 3rd, the GPT-4 version last), and that a prior ChatGPT sifting attempt by Mendez and Gervas could handle only a few events at a time. Sifted chains can also be dominated by one over-prevalent event type (affairs, in their sim).

**Relevance.** Core. Confidence: high that the field is on point; medium that any published heuristic works unmodified.

**Surprise.** Yes: quest designers do not read the emergent-narrative literature.

### 2. Tellability, eventfulness and unexpectedness

**Definition.** Narratological and cognitive accounts of what makes an event or chain worth telling (tellability, eventfulness, breach of expectation) and their use as scoring functions for sifters.

**Why it matters here.** The sifter and director need a score: of thousands of candidate chains, which earn an offer, and which are deliberately not surfaced. The only heuristics with published tests are improbability and Polti-style dramatic situations, and their first reader test was inconclusive, so this is the open scoring problem.

**Key sources.**
- Raphael Baroni, "Tellability", and Peter Huhn, "Event and Eventfulness", both in the *Living Handbook of Narratology*: https://www-archiv.fdm.uni-hamburg.de/lhn/node/30.html and https://www-archiv.fdm.uni-hamburg.de/lhn/node/39.html (listed in Lessard et al.'s references; I did not open them).
- Wolf Schmid, "Narrativity and Eventfulness", in *What Is Narratology?* (de Gruyter, 2003), pp. 17-33.
- Dimulescu and Dessalles, "Understanding Narrative Interest: Some Evidence on the Role of Unexpectedness", Proc. CogSci 31, 2009, pp. 1734-1739; Dessalles' Simplicity Theory defines unexpectedness as expected minus observed complexity `[sec]`.
- Kreminski, Dickinson, Mateas, "Select the Unexpected: A Statistical Heuristic for Story Sifting", ICIDS 2022, LNCS 13762, pp. 292-308 (dblp; Lessard et al. cite it as an AIIDE workshop paper): rank sifter matches by improbability; a manual ranking study partly supported it (as reported by Lessard et al.).
- Lessard et al. 2026 (above).

**Instance.** Select the Unexpected ranks pattern matches by how improbable the matched events are under the simulation's own statistics.

**Principles.**
1. Improbability is useful only measured against the audience's local narrative expectations, not world base rates (Lessard et al.: world-improbability is not narrative-improbability). Testable: rank correlation with player ratings, using player-knowledge-conditioned versus base-rate improbability.
2. Rarity grows with chain length while focus falls, so unconstrained improbability selects long, pointless chains (Lessard et al.). Testable: rating versus chain length should be an inverted U; a cap or a required protagonist-of-interest should lift mean rating. (Inferred from their observation.)
3. Searching for a named dramatic situation guarantees finding it and risks cookie-cutter output unless local detail differs (Lessard et al.; Lessard and Pare-Chouinard, "Dramatic Situations for Emergent Narrative System Authorship", ICIDS 2022: 18 situations embedded; some emergent patterns recurred discernibly `[sec]`). Testable: repetition of situation type among surfaced offers versus rated freshness.

**Failure modes.** The null result above (six stories, 24 raters: small). Extreme outliers appear as simulations run longer, so improbability thresholds drift with run length. The foundational narratology is descriptive, not predictive.

**Relevance.** Core. Confidence: medium (right problem, no validated answer).

**Surprise.** Yes.

### 3. Drama management (academic)

**Definition.** A component that watches an interactive experience and intervenes, or chooses what to present next, so the whole matches authored goals without removing player freedom.

**Why it matters here.** The director "that paces what surfaces" has a 30-year literature giving its vocabulary (plot points, manager actions, story-quality functions, beats), its algorithms (search, reinforcement learning, targeted-trajectory MDPs, beat sequencers), and a record of what failed to scale.

**Key sources.**
- Peter Weyhrauch, *Guiding Interactive Drama*, PhD, Carnegie Mellon, 1997 (tech report CMU-CS-97-109).
- Nelson and Mateas, "Search-Based Drama Management in the Interactive Fiction Anchorhead", AIIDE 2005, https://ojs.aaai.org/index.php/AIIDE/article/view/18723; Nelson, Mateas, Roberts, Isbell, "Declarative Optimization-Based Drama Management in Interactive Fiction", IEEE CG&A 26(3), 2006, https://www.kmjn.org/publications/DODM_IEEECGA-abstract.html (read); Nelson and Mateas, "Another Look at Search-Based Drama Management", AAAI 2008, https://www.kmjn.org/publications/SBDM_AAAI08-abstract.html (read).
- Chen, Nelson, Mateas, "Evaluating the Authorial Leverage of Drama Management", AIIDE 2009, https://ojs.aaai.org/index.php/AIIDE/article/view/12377 (read).
- Mateas and Stern, Facade (GDC 2003 paper); retrospective: https://www.gamedeveloper.com/design/the-story-of-facade-the-ai-powered-interactive-drama (read).
- Riedl and Bulitko, "Interactive Narrative: An Intelligent Systems Approach", AI Magazine 34(1), 2013, https://ojs.aaai.org/index.php/aimagazine/article/view/2449 (abstract only). Louchart and Aylett, "Solving the Narrative Paradox in VEs - Lessons from RPGs", IVA 2003, LNCS 2792 pp. 244-248 (narrative paradox: participant versus coherent story) `[sec]`. Riedl, Saretto, Young, "Managing Interaction Between Users and Agents in a Multi-agent Storytelling Environment", AAMAS 2003 (intervention versus accommodation; content not read).

**Instance.** Facade's beat sequencer: 27 main beats, about 15 used in a typical run, each beat made of 10-100 joint dialogue behaviours (about 2,500 in all); it picks unused beats to follow an intended tension arc, can insert mix-ins in response to the player, and returns to the core storyline after interruption. Development took over five years, three of them writing the drama, and reached roughly 30 per cent of the original vision.

**Principles.**
1. Authorial leverage is measurable: (a) complexity of the trigger script needed to reproduce the manager's policy, (b) sensitivity of the policy to story changes, (c) branches offered versus scripted equivalents (Chen et al.). A director that does not beat a trigger script on these should be one. Testable: apply the three measures to the director.
2. For realistic story sizes, compute policy offline rather than search online: Nelson et al. (2006) found online search performed poorly, especially on larger and more complex stories; Nelson and Mateas (2008) argue offline cached search matches TTD-MDPs. Testable: policy quality versus story size, online versus cached.
3. Managing at beat granularity (a pool of precondition-gated chunks, selected against a tension target) preserves local agency while shaping the global arc (Facade). Testable: share of player actions that get an in-beat response, and adherence to the target arc.

**Failure modes.** Every system was evaluated on a small closed storyworld (Anchorhead's abstract plot-point space, a 20-30 minute Facade scene) and often with simulated players. Evaluation functions are hand-written. Authoring cost is severe (Facade). Nobody deployed one in an open world. The narrative paradox is unresolved: stronger management reduces player freedom, weaker management loses the arc.

**Relevance.** Core. Confidence: high on vocabulary and measures, medium on transfer.

**Surprise.** Yes for the academic framing (evaluation function, authorial leverage); designers know directors from games.

### 4. AI directors and pacing in shipped games

**Definition.** Runtime systems that estimate a player's current intensity or state and schedule events accordingly.

**Why it matters here.** It is the only form of drama management with player-tested shipping history, and it answers "how often, and when, may an offer appear".

**Key sources.**
- Mike Booth, "The AI Systems of Left 4 Dead", Valve, 2009, https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf (read).
- Hunicke and Chapman, "AI for Dynamic Difficulty Adjustment in Games", AAAI-04 workshop (Hamlet: supply and demand of in-game resources via inventory theory) `[sec]`; Hunicke, "The Case for Dynamic Difficulty Adjustment in Games", ACE 2005, pp. 429-433 `[sec]`.
- Tynan Sylvester, "RimWorld: Contrarian, Ridiculous, and Impossible Game Design Methods", GDC 2017, https://gdcvault.com/play/1024232/-RimWorld-Contrarian-Ridiculous-and (session description only); *Designing Games* (O'Reilly, 2013) `[mem]`. RimWorld's storyteller picks events from a categorised database using a few statistics, in the lineage of the Left 4 Dead director `[sec]`.

**Instance.** Left 4 Dead: each survivor has an intensity value raised by damage taken, incapacitation, being pushed off ledges, and nearby infected deaths (inversely with distance), decaying toward zero but not while infected are engaging. The Director cycles Build Up (full threat population until intensity crosses a peak), Sustain Peak (3-5 s), Peak Fade (minimal population until intensity leaves the peak range; Relax cannot start until a natural break), and Relax (30-45 s or until the team has travelled far enough). Bosses are exempt. The slides say it changes frequency (pacing), not amplitude (difficulty), and that the estimation is crude yet the pacing works.

**Principles.**
1. A single crude intensity scalar with decay-unless-engaged plus a four-phase cycle yields reliable peaks and valleys that differ every run. Testable: inter-peak interval variance inside a target band, and player-rated pacing versus random event timing.
2. Modulate when and how often, not how big (Booth). Testable: players do not report rubber-banding when only offer frequency changes. (The second half is inferred.)
3. A quiet phase ends on distance or time, whichever first, and cannot begin until a natural break. Inferred open-world analogue: "natural break" = no active thread beat in progress.

**Failure modes.** The Director has one verb (modulating the infected population); the slides list a broader verb repertoire as future work. The intensity proxy is combat-derived; whether narrative intensity is estimable from non-combat play is untested. Tuning was manual and long (months of watching play, per press coverage `[sec]`). RimWorld's storytellers behave like event-rate and difficulty presets with drama names `[sec]`.

**Relevance.** Core. Confidence: high.

**Surprise.** No.

### 5. Storylets, quality-based and salience-based narrative

**Definition.** Content as self-contained units gated by conditions on world or player state; in quality-based narrative (QBN) the player picks among available units, in salience-based narrative the system picks the best match.

**Why it matters here.** It is the natural atom for the seeding layer (premise to scripted beat) and the way to make content "relevant" at scale.

**Key sources.**
- Emily Short, "Beyond Branching: Quality-Based, Salience-Based, and Waypoint Narrative Structures", 12 April 2016, https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/ (read).
- Kreminski and Wardrip-Fruin, "Sketching a Map of the Storylets Design Space", ICIDS 2018 (four axes: precondition definition, repeatability, content type, selection architecture; Short's summary https://emshort.blog/2019/01/06/kreminski-on-storylets/ read).
- Elan Ruskin (Valve), "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012, https://gdcvault.com/play/1015317/AI-driven-Dynamic-Dialog-through; recap https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/ (read).
- Garbe et al., StoryAssembler, FDG 2019, https://github.com/LudoNarrative/StoryAssembler (forward planner plus HTN over fragments) `[sec]`.

**Instance.** Valve's rule database matches hundreds of world facts against thousands of lines, applying the most specific matching rule with general fallbacks; writers add special cases without programmer changes.

**Principles.**
1. Specificity-ordered selection makes additions locally safe: adding a rule for one situation has few side effects (Short). Testable: adding N specific rules changes the chosen content only in contexts they match.
2. Parametrised storylets (slots filled by any entity meeting qualities) multiply reuse (Kreminski's *Starfreighter*). Testable: distinct perceived experiences per authored storylet, parametrised versus fixed.
3. QBN's weakness is that causal chains become unclear and players forget why something is available (Short), so each offer should carry its reason. (Inferred remedy.) Testable: players can state why an offer appeared.

**Failure modes.** Salience-sequenced whole events can accidentally satisfy the conditions for an unplanned dramatic ending, having no sense of arc; numeric weights are tuned by trial and error; QBN can overwhelm with options and demands heavy bookkeeping for multi-step spines (Short). A minimally playable storylet world needs many storylets, and *Starfreighter*'s own content stayed shallow (Short's recap of Kreminski).

**Relevance.** Core. Confidence: high.

**Surprise.** No.

### 6. Classical narrative planning

**Definition.** Casting story generation as AI planning: a plot is a sequence of actions whose preconditions are satisfied by earlier effects (causal links), reaching an author-specified goal.

**Why it matters here.** It supplies a formal "caused" guarantee: validate that a heist's beats are causally sound, detect which beats a world change has broken, and generate bridging beats between the world's current state and the state an authored quest assumes.

**Key sources.**
- James Meehan, "TALE-SPIN, an Interactive Program That Writes Stories", IJCAI-77, https://www.ijcai.org/proceedings/1977-1.
- Porteous, Cavazza, Charles, "Applying Planning to Interactive Storytelling: Narrative Control Using State Constraints", ACM TIST 1(2), art. 10, 2010, doi 10.1145/1869397.1869399 (abstract read).
- Doran and Parberry (field 14) on why general planning is impractical for quests (read).
- Riedl and Young 2010 (field 7) as the standard reference.

**Instance.** Porteous et al. express narrative control as state-trajectory constraints used as landmarks that split generation into smaller problems, implemented in a *Merchant of Venice* interactive narrative; real-time scalability is claimed, not quantified in the abstract.

**Principles.**
1. Explicit causal links let a system compute which remaining beats a perturbation threatens. Testable: perturb world state at random times; measure how often the system correctly predicts which remaining beats are still executable. (Inferred.)
2. Author-stated intermediate state constraints decompose the search (Porteous et al.). Testable: planning time versus number of landmarks.
3. Plot-only planning yields causally sound stories with puppet characters (the motivation for field 7).

**Failure modes.** Knowledge-engineering cost; planning is NP-complete in general and PSPACE-hard for non-trivial domains (Doran and Parberry); closed-world assumptions; toy-domain evaluation; the Tale-Spin tradition shows that a rich internal simulation can still output dull or odd stories (field 10).

**Relevance.** Supporting. Confidence: medium.

**Surprise.** Yes.

### 7. Intent- and conflict-aware narrative planning

**Definition.** Planners that require every character action to be explained by a goal that character is pursuing and that represent conflict between plans, including plans that fail.

**Why it matters here.** Antagonist factions and a heist crew need actions the player can interpret as intentional; conflict is a quantity the director can read; failed plans are drama.

**Key sources.**
- Riedl and Young, "Narrative Planning: Balancing Plot and Character", JAIR 39:217-268, 2010, doi 10.1613/jair.2989, https://jair.org/index.php/jair/article/view/10669 (abstract read).
- Ware and Young, "Glaive: A State-Space Narrative Planner Supporting Intentionality and Conflict", AIIDE 2014, https://ojs.aaai.org/index.php/AIIDE/article/view/12712 (eight test problems, some solved in under a second) `[sec]`.
- Ware, Young, Harrison, Roberts, "Four Quantitative Metrics Describing Narrative Conflict", ICIDS 2012 (balance, directness, intensity, resolution; formulas ranked four stories like human readers) `[sec]`.
- Szilas, "IDtension: a narrative engine for Interactive Drama", TIDSE 2003 (story as an atemporal structure of goals, tasks, obstacles and values) `[sec]`. Ware and Young, *The Best Laid Plans*, IEEE TCIAIG 2016 `[sec]`.

**Instance.** IPOCL infers goals that explain each character's behaviour and builds plans showing why characters commit to them; readers of IPOCL narratives understood characters' intentions better than readers of conventional partial-order-planner narratives.

**Principles.**
1. Actions are comprehended as intentional when the audience can recover the explaining goal. Testable: accuracy on "why did X do Y?" with versus without goal frames.
2. Conflict can be scored on balance, directness, intensity and resolution and tracks human rank ordering on short test stories. Testable: correlation with rater rankings on your own content.
3. Characters' plans must be allowed to fail (CPOCL, Glaive); players noticed these phenomena more than in a control in *Best Laid Plans* `[sec]`. Testable: perceived conflict with and without NPC plan failures.

**Failure modes.** Authors must supply a full action model; evaluation is on short synthetic stories; rational-agent assumptions; no open-world deployment found; search cost grows with world size.

**Relevance.** Supporting. Confidence: medium.

**Surprise.** Yes.

### 8. Social-practice and social-physics simulation

**Definition.** Simulations in which characters' behaviour is organised by reusable models of social situations and norms (Versu's practices, Comme il Faut / Ensemble rules) rather than scripts or a central plot.

**Why it matters here.** Crowds and encounters must behave appropriately for their context; local conflict between NPCs needs a plausible cause; and the approach reduces authoring per situation.

**Key sources.**
- Richard Evans and Emily Short, "Versu - A Simulationist Storytelling System", IEEE TCIAIG 6(2):113-130, 2014, doi 10.1109/TCIAIG.2013.2287297 (read in full).
- McCoy, Treanor, Samuel, Wardrip-Fruin, Mateas, "Comme il Faut: A System for Authoring Playable Social Models", AIIDE 2011, https://ojs.aaai.org/index.php/AIIDE/article/view/12454; *Prom Week*, AIIDE 2013, https://ojs.aaai.org/index.php/AIIDE/article/view/12662 (over 5,000 social considerations per the project blog) `[sec]`.
- Dameris, Hernandez Roman, Kreminski, "Praxish: A Rational Reconstruction of a Logic-Based DSL for Modeling Social Practices", AIIDE 2023, https://ojs.aaai.org/index.php/AIIDE/article/view/27537 (abstract: no equally approachable successor to Versu has emerged) `[sec]`.

**Instance.** Versu takes the strong-autonomy side: each character picks actions from its own beliefs and desires; practices are reactive joint plans that offer affordances; the central story manager initiates practices, watches them and inserts occasional changes, rarely overriding anyone. A trained writer produced a 20-minute episode in one to two months.

**Principles.**
1. Shared practices coordinate multi-agent scenes without puppeteering. Testable: rate of incoherent joint behaviour across many simulated episodes.
2. A major event must suppress unrelated affordances: Versu's crude "dominating practice" mechanism was too broad, and the authors wanted a shared public mood instead. Testable: stage an incident; the share of nearby NPC behaviours raters judge inappropriate. (Inferred transfer: a city incident must change ambient behaviour in its area.)
3. A score inspector that shows why each action won is a prerequisite for tuning utility agents (Versu had one and still called tuning "difficult and unrewarding" with over 300 desires). Testable: time to diagnose a seeded misbehaviour with and without the inspector.

**Failure modes.** Tuning cost; beliefs limited to two-place predicates with no quantifiers; no controlled evaluation (only reviews and store ratings); Versu was cancelled in 2014 `[sec]`; Comme il Faut content was hand-authored; scale is far below a city.

**Relevance.** Supporting. Confidence: medium.

**Surprise.** Yes.

### 9. Knowledge, belief and rumour simulation

**Definition.** Simulating who observes, remembers, tells, misremembers and lies about events, so information has provenance.

**Why it matters here.** Rumour, news and eyewitness accounts are the natural channel for making off-screen, coarse-detail events legible and investigable: the player can trace a thread back to what happened and who saw it.

**Key sources.**
- Ryan, Summerville, Mateas, Wardrip-Fruin, "Toward Characters Who Observe, Tell, Misremember, and Lie", AIIDE-15 workshop, https://ojs.aaai.org/index.php/AIIDE/article/view/12825.
- Ryan's dissertation and Short's recap (field 1).
- Ryan et al., *Bad News*, CHI 2016, https://eis.ucsc.edu/papers/ryanEtAl_BadNewsCHI2016.pdf.
- Samuel, Summerville, Ryan, England, "A Quantified Analysis of Bad News for Story Sifting Interfaces", ICIDS 2021 (as cited by Lessard et al.).

**Instance.** *Talk of the Town*: characters form beliefs by observation, hearsay and confabulation, and repeated lies come to be believed; Ryan's own critique is that the simulated knowledge rarely produced narrative intrigue because characters mostly traded trivial facts such as hair and eye colour (Short's recap).

**Principles.**
1. Propagation yields story material only if what spreads carries stakes. Testable: the fraction of propagated beliefs a sifter tags as stake-bearing, compared with trivia.
2. Beliefs with provenance (source, hops, distortion) give the player an inspectable trail. Testable: rate at which players successfully trace a rumour to its origin. (Inferred.)
3. Bounded, typed distortion keeps the truth reconstructable. (Inferred; testable by reconstruction success.)

**Failure modes.** Trivial gossip; heavy simulation; *Bad News* still needed a human curator; evaluation informal.

**Relevance.** Supporting. Confidence: medium.

**Surprise.** Yes.

### 10. Expressive processing: the Tale-Spin effect

**Definition.** Wardrip-Fruin's analysis of how the visible surface of a computational work relates to its hidden processes: the Eliza effect (surface suggests more than the system does), the Tale-Spin effect (rich processes invisible at the surface), the SimCity effect (complexity made readable in play).

**Why it matters here.** The brief demands content that feels caused and is legible. This field says internal causal richness earns nothing unless the surface exposes it, and gives a design contrast with SimCity.

**Key sources.**
- Noah Wardrip-Fruin, *Expressive Processing: Digital Fictions, Computer Games, and Software Studies* (MIT Press, 2009), chapters on the three effects; catalogue https://elmcip.net/node/1540.
- Raine Koskimaa, review, *Game Studies* 11(2), 2011, https://gamestudies.org/1102/articles/koskima `[sec]`.
- Wardrip-Fruin's Grand Text Auto drafts of the book (unreachable this session; accounts via search summaries) `[sec]`; "Three Play Effects: Eliza, Tale-Spin, and SimCity", https://dh-abstracts.library.virginia.edu/works/810 `[sec]`.

**Instance.** Tale-Spin's menu-driven play surface hides processes that are interesting; play cannot pierce the dull surface to see the fiction in the processes (so critics misread it) `[sec]`.

**Principles.**
1. Causal richness the audience cannot perceive does not count. Testable: after a thread, ask players to reconstruct its causes; the gap to the internal causal graph is the Tale-Spin gap. (Inferred operationalisation.)
2. Expose a few state variables whose changes players can attribute (SimCity effect). Testable: improvement in players' predictions of consequences across sessions.
3. Do not imply tracking that does not exist (Eliza end): an offer that says the world "remembers" must be backed by a state variable. Testable: probe-based audit of claims against state.

**Failure modes.** An interpretive humanities lens built on a few historical systems; no controlled tests; the three effects are not independent measures.

**Relevance.** Core for legibility. Confidence: high on the principle, medium on the evidence base.

**Surprise.** Yes.

### 11. Computational models of suspense, surprise and curiosity

**Definition.** Formal accounts of how information about outcomes, revealed over time, produces suspense, surprise or curiosity, and systems that choose what to reveal to target them.

**Why it matters here.** The director chooses which events surface and in what order. Suspenser's lever is exactly that: given a world history (fabula), select and order what is presented (sjuzhet). This is the only literature that treats "what to show next" as an optimisation target.

**Key sources.**
- Gerrig and Bernardo, "Readers as Problem-Solvers in the Experience of Suspense", *Poetics* 22(6):459-472, 1994 (seven experiments: suspense rose as readers saw fewer routes to a solution while likelihood ratings changed little) `[sec]`.
- Cheong and Young, "Suspenser: A Story Generation System for Suspense", IEEE TCIAIG 7(1), 2015, https://www.cs.uky.edu/~sgware/reading/papers/cheong2015suspenser.pdf (read).
- Ely, Frankel, Kamenica, "Suspense and Surprise", *Journal of Political Economy* 123(1):215-260, 2015 (suspense = variance of next-period belief, surprise = belief change; optimal reveal schedules) `[sec]`.
- Wilmot and Keller, "Modelling Suspense in Short Stories as Uncertainty Reduction over Neural Representation", ACL 2020, https://arxiv.org/abs/2004.14905 (read); Xie and Riedl, "Creating Suspenseful Stories: Iterative Planning with Large Language Models", EACL 2024, https://arxiv.org/abs/2402.17119 (read).
- Bae and Young, ICIDS 2008, LNCS 5334, pp. 156-167 (flashback and foreshadowing for surprise) `[sec]`; Loewenstein, "The Psychology of Curiosity", *Psychological Bulletin* 116(1):75-98, 1994 (curiosity as an information gap) `[sec]`.

**Instance.** Suspenser estimates reader suspense from the number of solutions to the protagonist's goal (via a planner) and picks which events of a fabula to present. In a between-groups study (98 subjects, 294 responses) its stories and a professional's were rated more suspenseful than controls, with small-to-moderate effect sizes.

**Principles.**
1. Perceived suspense rises as the number of visible routes to the protagonist's success falls. Testable: vary the visible options in a heist beat; rate tension.
2. For a Bayesian audience, suspense is the expected variance of the next belief about the outcome and surprise is the size of the belief change, and the two call for different reveal schedules (Ely et al.). Testable: simulate a belief model for a thread and check schedule predictions against player ratings. `[sec]`
3. Curiosity needs a perceived gap on a topic the audience already knows something about (Loewenstein) `[sec]`, so teasers need established context. Testable: curiosity-driven follow-up rate for teasers with versus without prior context.
4. Forward-looking uncertainty reduction predicted human suspense judgments better than backward-looking surprise (Wilmot and Keller). Implication (inferred): score candidate next events by how much they would shrink uncertainty about the thread's outcome.

**Failure modes.** Lab studies on short texts; none in interactive 3D with player agency. Suspenser's heuristic counts solutions without their likelihood, and its evaluation used one human author. Ely et al. is normative and assumes a Bayesian audience. LLMs are unreliable at suspense without a planning scaffold (Xie and Riedl).

**Relevance.** Core. Confidence: medium.

**Surprise.** Yes.

### 12. Cognitive models of narrative comprehension and memory

**Definition.** Psychological models of how audiences build situation models, link events by causal and other relations, and decide which earlier events are salient now.

**Why it matters here.** "Caused", "legible" and "consequential" all depend on whether the player connects today's offer to an event hours or days earlier. These models predict which earlier events a player will have in mind and which links they will draw.

**Key sources.**
- Zwaan and Radvansky, "Situation Models in Language Comprehension and Memory", *Psychological Bulletin* 123(2), 1998 (event-indexing: time, space, protagonist, causation, intentionality) `[mem]`.
- Cardona-Rivera, Cassell, Ware, Young, "Indexter: A Computational Model of the Event-Indexing Situation Model for Characterizing Narratives", Workshop on Computational Models of Narrative, LREC 2012, pp. 32-41 (listing only; PDF unreadable here) `[sec]`.
- Kives, Ware, Baker, "Evaluating the Pairwise Event Salience Hypothesis in Indexter", AIIDE 2015, pp. 30-36, https://ojs.aaai.org/index.php/AIIDE/article/view/12789 (read).
- Farrell and Ware, 2016 and 2017 (predicting, then influencing, choices in interactive stories using the hypothesis) `[sec]`.
- Trabasso and van den Broek, "Causal Thinking and the Representation of Narrative Events", *Journal of Memory and Language* 24:612-630, 1985 (events on the causal chain recalled more and judged more important than dead ends) `[sec]`.

**Instance.** In a 200-participant crowdsourced study with 24 short stories, a past event sharing at least one index with the latest event was judged more salient than one sharing none.

**Principles.**
1. A callback is more likely to be recognised when it shares indices (same people, place, time frame, cause, intention) with the scene on screen. Testable: recognition rate of callbacks by number of shared indices. (Kives et al. tested sharing at least one versus none, on short stories.)
2. Events on the causal path to an outcome are remembered and rated as important more than dead ends. Testable: the share of beats on the causal chain that players recall after a thread; prune or recast dead-end beats. (Short-text evidence `[sec]`.)
3. The player's memory is the binding constraint, so re-index (remind) rather than assume. (Inferred.) Testable: recall of a thread after a gap, with and without a re-index cue.

**Failure modes.** All evidence is from short texts; the Indexter authors say a richer model with intervening events, complexity and memory decay is needed; nothing here has been tested over game-length gaps.

**Relevance.** Core. Confidence: medium.

**Surprise.** Yes.

### 13. Choice poetics, perceived agency and consequence

**Definition.** Formal and empirical work on how choices carry meaning and how players perceive their effects and their own agency.

**Why it matters here.** "Consequential" is a perception: a consequence the player never connects to their action does not exist for them. This field names the patterns that create or destroy the perception.

**Key sources.**
- Mawhorter, Mateas, Wardrip-Fruin, Jhala, "Towards a Theory of Choice Poetics", FDG 2014, https://cs.wellesley.edu/~pmwh/research/papers/towards-choice-poetics-fdg-2014.pdf (read).
- Cardona-Rivera, Robertson, Ware, Harrison, Roberts, Young, "Foreseeing Meaningful Choices", AIIDE 2014, https://ojs.aaai.org/index.php/AIIDE/article/view/12716 (read).
- Thue, Bulitko, Spetch, Romanuik, "A Computational Model of Perceived Agency in Video Games", AIIDE 2011 (perceived agency depends on how much the player desires the outcomes; 141-participant study) `[sec]`.
- Wardrip-Fruin, Mateas, Dow, Sali, "Agency Reconsidered", DiGRA 2009, https://dl.digra.org/index.php/dl/article/view/369 (agency as a phenomenon of player and game together).

**Instance.** Choice idioms from Mawhorter et al.: false choice (all options lead to the same outcome), blind choice (framing gives no basis for expectations), delayed effect (outcomes identical now, diverging later), flavour choice (minor but possibly long-lasting effects), puzzle choice, dilemma, unchoice.

**Principles.**
1. Players report more agency when they can foresee that options lead to situationally different content (88 participants, a choose-your-own-adventure game). Testable: consequence foreshadowing at decision time raises agency ratings.
2. Delayed effects make the original choice feel more important once revealed but can breed frustration (Mawhorter et al.). Testable: at payoff, an explicit "because you..." attribution raises perceived consequence without raising frustration. (Remedy inferred.)
3. Perceived agency tracks desire for the outcome (Thue et al.) `[sec]`, so consequences should land on things the player has shown they care about. (Inferred; links to field 23.)

**Failure modes.** Validations use short branching text games; the idiom taxonomy is descriptive, not predictive; definitions of agency remain contested; no open-world test.

**Relevance.** Core. Confidence: medium-high.

**Surprise.** Yes.

### 14. Quest structure analysis and quest generation research

**Definition.** Analysis of what quests are and how they are built, and generators derived from those analyses.

**Why it matters here.** The known failure is the template quest; this field shows what structural samey-ness looks like in numbers and what has been proposed to ground quests in world state and purpose.

**Key sources.**
- Espen Aarseth, "From Hunt the Wumpus to EverQuest: Introduction to Quest Theory", ICEC 2005, LNCS 3711, pp. 496-506 (landscape and quest types; the "grammar" of quests) `[sec]`.
- Doran and Parberry, "A Prototype Quest Generator Based on a Structural Analysis of Quests from Four MMORPGs", PCGames 2011, https://ianparberry.com/pubs/pcg2011.pdf (read).
- Yu, Guzdial, Sturtevant, "The Definition-Context-Purpose Paradigm and Other Insights from Industry Professionals About the Definition of a Quest", arXiv 2110.04148, 2021, https://arxiv.org/abs/2110.04148 (read).
- Sullivan, Mateas, Wardrip-Fruin, "Making Quests Playable: Choices, CRPGs, and the Grail Framework", *Leonardo Electronic Almanac* 17, 2011 (quests as task lists are poorly playable; QuestBrowser and GrailGM) `[sec]`.
- Alexander and Martens, "Deriving Quests from Open World Mechanics", arXiv 1705.00341 (FDG 2017), https://arxiv.org/abs/1705.00341 (read); Dormans, "Adventures in Level Design", PCGames 2010 (mission graph first, then space built to fit) `[sec]`; Ashmore and Nitsche, "The Quest in a Generated World", DiGRA 2007, https://dl.digra.org/index.php/dl/article/view/312 (key-and-lock quests as spatial progression) `[sec]`.

**Instance.** Doran and Parberry analysed over 750 quests (EverQuest 266, Vanguard 137, World of Warcraft 205, Eve Online 145) and found nine underlying NPC motivations (knowledge, comfort, reputation, serenity, protection, conquest, wealth, ability, equipment), each with 2-7 strategies of 1-6 actions; they argue motivations are essential for quests to appear intentional rather than random.

**Principles.**
1. Ground each offered quest in a motivation of a concrete world entity derived from state. Testable: players' rating of "why is this being asked of me" clarity with versus without a visible motivation.
2. Define quests by purpose rather than element lists: 15 industry developers had no consensus definition but converged on purposes (guide, tell story, engage, teach, provide reason to play) (Yu et al.). Implication (inferred): tag each offer with its intended purpose and let the director choose by purpose.
3. A playable quest carries state and interdependent choices rather than a checklist (Sullivan et al.) `[sec]`. Testable: variation in how different players complete the same quest.

**Failure modes.** The structural generators' output was not evaluated with players in the sections I read; a nine-motivation grammar is exactly the kind of structure that reads as template if surface variation is all that changes; key-and-lock quests lack purpose (Doran and Parberry's critique of Ashmore and Nitsche); there is no agreed quest definition.

**Relevance.** Core. Confidence: high.

**Surprise.** No (quest designers know Aarseth and the genre); the structural numbers and the purpose finding are less known.

### 15. Shipped procedural quest and history systems

**Definition.** Case studies of procedural quest and history generation that reached players: Skyrim's Radiant Story, the Nemesis system, Caves of Qud's histories.

**Why it matters here.** They are the closest real-world precedents for the whole system, and their reception is the clearest account of how template quests are perceived.

**Key sources.**
- Bruce Nesmith's 2012 talk on Radiant Story, as reported in GamesBeat, https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/ (read).
- Player-side critique and a student thesis, "Procedural Quest Generation - Improving Skyrim's Radiant Story", https://labjogos.tecnico.ulisboa.pt/en/thesis/procedural-quest-generation-improving-skyrim-s-radiant-story `[sec]`.
- Warner Bros. Entertainment, US patent 10,926,179, "Nemesis characters, nemesis forts, social vendettas and followers in computer games" (reportedly allowed October 2020, granted 23 February 2021) `[sec]`: https://www.patentarcade.com/2021/02/warner-brothers-granted-patent-for-nemesis-system-from-middle-earth-video-games.html.
- Jason Grinblat, "Procedurally Generating History in Caves of Qud", GDC 2018 (generates historical events and rationalises them afterwards rather than simulating) `[sec]`: https://gdcvault.com/play/1024990/Procedurally-Generating-History-in-Caves.

**Instance.** Nesmith: Radiant Story tied quests to player progress and past choices; limits were put on how often events fire because realistic reactions became silly; job quests were restricted to fitting NPCs and given custom lines per voice type; it was not used for the main quest because a generated one would play badly; "a response that is reasonable in real life isn't necessarily good gameplay" (paraphrased).

**Principles.**
1. Cap the cadence and context eligibility of generated events; realism alone does not predict fun (Nesmith). Testable: A/B on cap values with player-rated annoyance.
2. Reserve generation for connective tissue and keep climactic beats authored (Nesmith). Testable: rated quality of generated versus authored finales.
3. Retrospective rationalisation (generate an event, then invent a consistent cause) gives a feeling of causal depth cheaply, provided what has been shown is never contradicted (Qud approach `[sec]`; the write-once condition is inferred). Testable: contradiction rate against observed history.

**Failure modes.** Radiant repetition complaints are about a finite pool of targets behind unlimited contracts (forum accounts, a mod author's critique `[sec]`). The Nemesis system is covered by a patent: any feature built on persistent procedurally generated antagonists with ranks, vendettas or promotions should get a legal check before design work (I am not a lawyer). Qud is single-player and turn-based.

**Relevance.** Core as a cautionary record. Confidence: high.

**Surprise.** No for Radiant; the patent and the retrospective-history technique are less often examined.

### 16. Story grammars and plot-unit models

**Definition.** Formal models of story structure: grammars of story parts, affect-based plot units, catalogues of dramatic situations, and statistical arc shapes.

**Why it matters here.** The engine "grows threads into arcs", so it needs a shape vocabulary, and a retrospective sifter needs some recognisable story form. This field also contains one of the sharper negative results.

**Key sources.**
- Vladimir Propp, *Morphology of the Folktale* (1928; English 1968) `[mem]`; Rumelhart, "Notes on a Schema for Stories", in Bobrow and Collins (eds), *Representation and Understanding* (1975) `[mem]`.
- Black and Wilensky, "An Evaluation of Story Grammars", *Cognitive Science* 3:213-229, 1979; rebuttal Frisch and Perlis, "A Re-Evaluation of Story Grammars", *Cognitive Science* 5(1):79-86, 1981 (both known from listings and abstracts) `[sec]`.
- Wendy Lehnert, "Plot Units and Narrative Summarization", *Cognitive Science* 4(4):293-331, 1981 (positive, negative and neutral mental affect states that overlap into a plot graph) `[sec]`.
- Reagan et al., "The Emotional Arcs of Stories Are Dominated by Six Basic Shapes", *EPJ Data Science* 5, 2016 (1,327 Gutenberg fictions, sentiment-based) `[sec]`; Lessard and Pare-Chouinard 2022 on Polti's situations (field 2).

**Instance.** Plot units represent a story as overlapping affect configurations (for example a loss followed by an attempted repair); the graph's structure marks central versus peripheral concepts.

**Principles.**
1. Use grammars as recognisers and checklists on authored arcs, not as generators: story grammars were criticised as inadequate grammars, recognisers and predictors of recall (Black and Wilensky; Black and Bower 1980 `[sec]`), while causal networks predicted recall better (field 12). Testable: compare grammar-conformance versus causal-chain measures as predictors of what players recall.
2. Representing a thread's state as affect-valenced units makes an arc's position computable from the log. (Inferred; plot-unit models were built mostly by hand-engineering `[sec]`.) Testable: inter-annotator agreement between automatic and human unit labelling on thread logs.
3. A small set of arc shapes fits text corpora (Reagan et al.) but describes sentiment in finished texts, not interaction. Testable: whether player-rated best arcs cluster into a small set of tension shapes.

**Failure modes.** Grammar critiques; plot units' manual knowledge engineering; sentiment-derived arcs are weak proxies; named situations produce repetition (field 2).

**Relevance.** Supporting. Confidence: medium.

**Surprise.** No.

### 17. Case-based and analogical adaptation of authored content

**Definition.** Generating by retrieving a stored story or episode and transforming it to fit a new situation.

**Why it matters here.** "Fitting human-authored quests into the world at the right moment" is adaptation: retrieve a quest whose preconditions are close to the world's current state, substitute entities and locations, and know when adaptation is not possible.

**Key sources.**
- Scott Turner, *The Creative Process: A Computer Model of Storytelling and Creativity* (Erlbaum, 1994) `[mem]` (Minstrel).
- Tearse, Mawhorter, Mateas, Wardrip-Fruin, "Skald: Minstrel Reconstructed", IEEE TCIAIG 6(2):156-165, 2014, and "Lessons Learned from a Rational Reconstruction of Minstrel", AAAI 2012 (listing and abstract mirrors) `[sec]`.
- Perez y Perez and Sharples, "MEXICA: A Computer Model of a Cognitive Account of Creative Writing", JETAI 13:119-139, 2001, https://www.cs.uky.edu/~sgware/reading/papers/perezyperez2001mexica.pdf (listing and summary) `[sec]`.

**Instance.** Skald, a public reconstruction of Minstrel, found that the original depended on a story library, templates and recall system fitted to each other, a brittleness hinted at only lightly in Turner's publications; adding differential costs to transformations and pruning the least successful author-level actions reduced it `[sec]`. MEXICA alternates an engagement phase (generate under content constraints) and a reflection phase (repair impasses, check coherence, novelty and interestingness).

**Principles.**
1. Small, costed transformations with an explicit "cannot adapt" outcome beat open-ended adaptation. Testable: acceptance rate by adaptation distance, with a threshold beyond which the quest is not offered.
2. The case library and the adaptation operators must be authored together (Skald finding), so authored quests should declare their adaptation points (slots and constraints). Testable: adaptation success rate for quests with versus without declared points.
3. Separate generation from a check stage that tests coherence and novelty (MEXICA). Testable: the fraction of adapted offers rejected by the check stage and judged poor by readers when forced through.

**Failure modes.** Brittleness; small domains; maintenance of the case base; early claims of creativity were overstated.

**Relevance.** Supporting. Confidence: medium.

**Surprise.** Yes.

### 18. Mixed-initiative co-creative authoring tools

**Definition.** Tools in which human and system take turns proposing, extending and critiquing story material.

**Why it matters here.** The seeding layer spans a vague premise to a fully scripted beat, so authors and the system must hand work back and forth. This field shows what helps authors and what they reject.

**Key sources.**
- Yannakakis, Liapis, Alexopoulos, "Mixed-Initiative Co-Creativity", FDG 2014, https://www.antoniosliapis.com/papers/mixed_initiative_co-creativity.pdf (listing) `[sec]`.
- Kreminski, Dickinson, Wardrip-Fruin, Mateas, "Loose Ends: A Mixed-Initiative Creative Interface for Playful Storytelling", AIIDE 2022, https://ojs.aaai.org/index.php/AIIDE/article/view/21955 (abstract read); "Why Are We Like This?: The AI Architecture of a Co-Creative Storytelling Game", FDG 2020 `[sec]`.
- Mirowski, Mathewson, Pittman, Evans, "Co-Writing Screenplays and Theatre Scripts with Language Models" (Dramatron), CHI 2023, arXiv 2209.14958, https://arxiv.org/abs/2209.14958 (abstract read; user-study findings from the project repository summary `[sec]`).
- Zhu, Martin, Head, Callison-Burch, "CALYPSO: LLMs as Dungeon Masters' Assistants", AIIDE 2023, https://arxiv.org/abs/2308.07540 (abstract read).
- Johnson-Bey and Mateas, "Centrifuge: A Visual Tool for Authoring Sifting Patterns", AIIDE workshops 2021 (as cited by Lessard et al.).

**Instance.** Loose Ends manages several plot threads and prompts the player towards satisfying conclusions; a preliminary expert evaluation reports that players felt like co-authors and lost less direction than in earlier systems. Dramatron: 15 theatre and film professionals co-wrote with a hierarchical prompt-chaining tool; reportedly they found output formulaic and preferred it for world-building and alternative plots over full scripts `[sec]`. CALYPSO: dungeon masters found some output usable verbatim and some a prompt for their own ideas.

**Principles.**
1. Surfacing unresolved threads to the author or director reduces drift. Testable: proportion of opened threads that reach a resolution with versus without a loose-ends view.
2. Use generation for premises, variants and ideas, not as the author of record (Dramatron, CALYPSO). Testable: authors' acceptance of generated seeds versus generated finished beats.
3. Authoring burden is the limiting resource, so visual or example-driven pattern authoring (Centrifuge, Praxish) is a first-class feature. Testable: time to author a working sifting pattern.

**Failure modes.** Small studies and preliminary evaluations; formulaic output; homogenisation if many authors share one model (field 19).

**Relevance.** Core. Confidence: medium-high.

**Surprise.** Yes.

### 19. LLM story generation and its failure modes

**Definition.** Language-model story generation, long-range coherence and consistency problems, controllability limits, and benchmarks of them.

**Why it matters here.** An LLM is the obvious route from a vague premise to prose and dialogue, and the obvious route to template-like sameness. The recent benchmarks quantify exactly the failures the brief names: consistency against world state, homogeneity and uncontrolled pacing.

**Key sources.**
- Yang, Tian, Peng, Klein, "Re3: Generating Longer Stories With Recursive Reprompting and Revision", EMNLP 2022, https://arxiv.org/abs/2210.06774 (read).
- Tian et al., "Are Large Language Models Capable of Generating Human-Level Narratives?", EMNLP 2024, https://arxiv.org/abs/2407.13248 (read).
- Li et al., "Lost in Stories: Consistency Bugs in Long Story Generation by LLMs" (ConStory-Bench), Findings of ACL 2026, https://aclanthology.org/2026.findings-acl.410/ (read); Ma et al., "Can LLM Agents Stick to the Script?" (NCP-Bench), ICML 2026, arXiv 2608.08160, https://arxiv.org/abs/2608.08160 (read); Chen et al., "When Stories Evolve: Benchmarking LLM Storytelling Across Agent Architectures in Open-Ended World Simulations" (WSE-bench), arXiv 2608.15654, https://arxiv.org/abs/2608.15654 (read).
- Doshi and Hauser, "Generative AI Enhances Individual Creativity but Reduces the Collective Diversity of Novel Content", *Science Advances*, 12 July 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC11244532 (read). Valmeekam et al., "On the Planning Abilities of Large Language Models - A Critical Investigation", NeurIPS 2023, https://arxiv.org/abs/2305.15771 (read).

**Instance.** NCP-Bench (100 movie-plot environments with structured commitments and facts): even the strongest model tested kept its narrative commitments in only about 42 per cent of runs after 20 turns, with fact-conflict rates of roughly 40-68 per cent across models. ConStory-Bench (2,000 prompts, five error categories, 19 subtypes): errors concentrate in factual and temporal details, cluster mid-narrative, and correlate with higher token-level entropy. WSE-bench: consistency and richness do not trade off along a simple curve, and neither added structure nor model scale reliably improved coherence.

**Principles.**
1. Facts drift unless re-grounded from symbolic state at every call. Testable: contradiction rate against the world state, with and without per-call state injection.
2. Output diversity collapses without externally injected variation. Evidence: LLM stories were homogeneously positive with little tension (Tian et al.), and writers given LLM ideas wrote individually better but mutually more similar stories (Doshi and Hauser: 293 writers, 600 evaluators; similarity rose by about 10.7 per cent of range with one idea and 8.9 per cent with five). Testable: inter-output embedding similarity versus the number of structured seed parameters varied.
3. External verification improves LLM plans: GPT-4 produced executable plans only about 12 per cent of the time unaided, and checker feedback and use as a heuristic for a sound planner helped (Valmeekam et al., 2023-era models). Testable: share of proposals passing a symbolic validator after repair loops.

**Failure modes.** Mid-narrative consistency errors; mode collapse; tension and suspense deficits; unreliable planning; hierarchical or recursive scaffolds help coherence (Re3: +14 percentage points on coherent plot, +20 on premise relevance) but do not close the gap; benchmarks are text-only and not grounded in a live game state; results age quickly.

**Relevance.** Core as risk and tool. Confidence: high on the failure patterns, medium on current numbers.

**Surprise.** No.

### 20. Hybrid symbolic and LLM narrative architectures

**Definition.** Architectures in which a symbolic layer holds state, constraints and authorial structure while an LLM proposes content inside them.

**Why it matters here.** The brief wants content that stays caused and consistent while still varied; the emerging pattern assigns truth to the simulation, proposals to the model, and pacing to the director.

**Key sources.**
- Wang, Zhou, Ledo, "StoryVerse: Towards Co-authoring Dynamic Plot with LLM-based Character Simulation via Narrative Planning", FDG 2024, https://arxiv.org/abs/2405.13042 (abstract read).
- Xie and Riedl, EACL 2024 (field 11). Park et al., "Generative Agents: Interactive Simulacra of Human Behavior", UIST 2023, https://arxiv.org/abs/2304.03442 (abstract read).
- "From World-Gen to Quest-Line: A Dependency-Driven Prompt Pipeline for Coherent RPG Generation", arXiv 2604.25482 (April 2026) (listing) `[sec]`; Peng et al., "Player-Driven Emergence in LLM-Driven Game Narrative", arXiv 2404.17027 (GPT-4 in a text adventure produced many narrative paths designers did not anticipate) `[sec]`.

**Instance.** StoryVerse: authors write high-level "abstract acts" and an LLM-based planner grounds them in the current world state as concrete character actions, in a loop that player actions propagate through; a proof of concept without a formal evaluation. Generative Agents: a 25-agent sandbox town with a memory stream, reflection and retrieval; ablations indicated observation, planning and reflection each contribute to believability; a Valentine's Day party spread without scripting.

**Principles.**
1. A structured intermediate representation (abstract acts, partially ordered events, dependency graphs) between authorial intent and LLM output improves steerability (StoryVerse, the 2026 pipeline `[sec]`). Testable: adherence of generated beats to authored act constraints.
2. Let the LLM propose and the symbolic layer verify and execute, so only validated proposals enter the world. Testable: rate of world-state violations that reach the player.
3. Pre-generate offline for rare, high-value seeds rather than calling a model per NPC per tick. (Inferred from cost and consistency evidence; testable by per-offer cost against consistency.)

**Failure modes.** StoryVerse and the 2026 pipeline are proofs of concept without systematic evaluation; emergent LLM behaviour can be unplanned and unsafe; latency and cost make per-NPC runtime calls impractical at city scale; the consistency benchmarks in field 19 apply.

**Relevance.** Core. Confidence: medium.

**Surprise.** No.

### 21. Evaluation of generated stories and interactive narratives

**Definition.** Methods for judging story quality and interactive-narrative experience, human and automatic.

**Why it matters here.** The brief lists six qualities (caused, relevant, legible, consequential, varied, paced). Nothing ships if they cannot be measured, and automated checks are needed for regression across thousands of generated arcs.

**Key sources.**
- Chhun, Colombo, Suchanek, Clavel, "Of Human Criteria and Automatic Metrics: A Benchmark of the Evaluation of Story Generation", COLING 2022, https://arxiv.org/abs/2208.11646 (read).
- Purdy et al., "Predicting Generated Story Quality with Quantitative Measures", AIIDE 2018, https://ojs.aaai.org/index.php/AIIDE/article/view/13021 (read; features: grammaticality, temporal ordering, local contextuality, narrative productivity `[sec]`).
- Roth and Koenitz, "Evaluating the User Experience of Interactive Digital Narrative", AltMM 2016, pp. 31-36 (modular scales for 11 user-experience dimensions) `[sec]`.
- Lessard et al. 2026 (field 1); Ware et al. 2012 (field 7); Chen et al. 2009 authorial leverage (field 3).

**Instance.** HANNA (Chhun et al.): 1,056 stories from 10 systems annotated on six orthogonal human criteria, used to correlate 72 automatic metrics; they conclude current metrics have significant weaknesses.

**Principles.**
1. Automatic metrics are for gating and regression, human panels are for decisions. Testable: correlation of each metric with human ratings on your own content before trusting it.
2. Score the criteria separately rather than one quality number (Chhun et al.'s six orthogonal criteria). Testable: low inter-criterion correlation in your own ratings.
3. Authors are poor judges of emergent output because of familiarity (Lessard et al.: the evaluators surely liked the stories less than the authors did). Testable: naive versus expert rater gap.

**Failure modes.** No agreed metrics; evaluation of interactive narrative is mostly questionnaire-based and session-bound; simulated players (as in drama management work) are not human behaviour; sample sizes are small.

**Relevance.** Core. Confidence: high.

**Surprise.** Yes.

### 22. Perceptual variety and expressive range analysis

**Definition.** Measuring what a generator can produce (expressive range) and whether people perceive the outputs as different (perceptual uniqueness).

**Why it matters here.** "Varied in ways players notice" is a perception requirement, and the "ten thousand bowls of oatmeal" problem (Kate Compton) is the field's name for failing it.

**Key sources.**
- Emily Short, "Bowls of Oatmeal and Text Generation", 21 September 2016, https://emshort.blog/2016/09/21/bowls-of-oatmeal-and-text-generation/ (read); Boris the Brave, "Oatmeal Spice", 5 July 2026, https://www.boristhebrave.com/2026/07/05/oatmeal-spice/ (read; practitioner heuristics, not validated).
- Smith and Whitehead, "Analyzing the Expressive Range of a Level Generator", PCG workshop 2010, https://www.pcgworkshop.com/archive/smith2010analyzing.pdf (listing).
- Kybartas, Verbrugge, Lessard, "Tension Space Analysis for Emergent Narrative", IEEE Transactions on Games, 2020, https://arxiv.org/abs/2004.10808 (abstract read).
- Doshi and Hauser 2024 and Tian et al. 2024 (field 19) for homogenisation evidence.

**Instance.** Tension Space Analysis adapts expressive range analysis to an emergent narrative system built on possible worlds, so designers can see what story space a system can express before shipping.

**Principles.**
1. Variation registers only when tied to consequences: decorative variation holds attention briefly and is then ignored (Short). Testable: players classify encounters; surface-only variants are confused more than consequence-bearing ones.
2. Fewer, bigger, correlated decisions per instance produce more distinguishable outputs than many small independent ones (Boris the Brave; heuristic). Testable: pairwise distinguishability tasks.
3. Plot generator outputs over author-chosen narrative metrics to expose holes and biases before shipping (Smith and Whitehead; Kybartas et al.). Testable: metric-space coverage compared with rated variety.

**Failure modes.** Expressive-range metrics are domain-specific and their match to perception is unverified (the original linearity and leniency metrics fit platformer levels); the oatmeal rules are practitioner lore; recurrent patterns can lower interest even in a wide space (Lessard and Pare-Chouinard).

**Relevance.** Core. Confidence: medium-high.

**Surprise.** Yes.

### 23. Player modelling and experience-driven adaptation

**Definition.** Inferring player preferences or state from observed behaviour and adapting content selection or pacing to them.

**Why it matters here.** The system never controls the player and only observes and offers, so observation-based preference inference is the permitted lever for ranking which offers to make.

**Key sources.**
- Thue, Bulitko, Spetch, Wasylishen, "Interactive Storytelling: A Player Modelling Approach" (PaSSAGE), AIIDE 2007, https://ojs.aaai.org/index.php/AIIDE/article/view/18780 (listing).
- Yannakakis and Togelius, "Experience-Driven Procedural Content Generation", IEEE Transactions on Affective Computing 2(3):147-161, 2011 (listing) `[sec]`.
- Hunicke and Chapman 2004 (field 4); Thue et al. 2011 (field 13).

**Instance.** PaSSAGE learns a model of the player's preferred style of play and selects story content from it; its user study suggested adaptation can raise enjoyment in a computer role-playing game for certain types of players.

**Principles.**
1. Learn preferences from observed actions and use them only to rank offers, never to remove options. (Inferred from the brief; testable as offer-acceptance rate, with no fall in offer variety.)
2. Adapt frequency and selection, not outcomes (Booth's frequency-not-amplitude lesson).
3. Keep the model low-dimensional enough to learn within a session (PaSSAGE used a small set of player styles `[mem]`). Testable: model accuracy against session length.

**Failure modes.** Benefit appeared only for certain player types; small studies; adaptation can narrow the content a player sees (filter-bubble risk, inferred); accurate preference models are session-limited.

**Relevance.** Supporting. Confidence: medium.

**Surprise.** Yes.

### 24. Simulation level of detail and retroactive history

**Definition.** Running a world at different fidelity by distance from the observer, and elaborating details lazily so that what is revealed is consistent with the abstract past.

**Why it matters here.** The city is simulated at varying detail; story events that occurred at coarse detail must become concrete and consistent when the player arrives. Consistency across that boundary is a story requirement the quest literature ignores.

**Key sources.**
- Brom, Sery, Poch, "Simulation Level of Detail for Virtual Humans", IVA 2007, LNAI 4722, https://artemis.ms.mff.cuni.cz/main/papers/IVE_IVA07.pdf (abstract and summary) `[sec]`; Sery, Poch, Safrata, Brom, SOFSEM 2006 (reduce quality in unimportant places while keeping the simulation plausible, with minimal scenic inconsistencies) `[sec]`.
- Grinblat, GDC 2018, Caves of Qud (field 15) `[sec]`.
- Ryan's dissertation and *Bad News* (generate a town's history before play, then curate) and Lessard et al.'s Chroniqueur (hundreds of simulated years) (fields 1, 9).

**Instance.** Brom et al.: several degrees of simulation detail for a large virtual-storytelling game with tens of virtual humans, simplifying both space and behaviour in places the player cannot see. Qud: histories created as events and justified after the fact `[sec]`.

**Principles.**
1. Preserve invariants (who is where, who knows what, what has been seen) across detail transitions; scenic inconsistency is the failure metric. Testable: rate at which players spot contradictions after a transition.
2. Elaborate lazily and write once: details created on first observation must be consistent with the abstract record and then become fixed. (Inferred from Qud and Brom et al.) Testable: contradiction rate between an abstract record and its later concretisation.
3. Every abstract story event needs a concretisation path into the detailed simulation (a summary "gang war" becomes specific bodies, damage and graffiti). (Inferred.) Testable: whether players recognise the abstract event from its traces.

**Failure modes.** I found no study of story-level consistency under level of detail: Brom et al. concern behaviour, not narrative, so the field is an evidence gap rather than a mature literature; retroactive elaboration can contradict earlier observations.

**Relevance.** Core for architecture. Confidence: medium (low evidence, high fit).

**Surprise.** Yes.

### 25. Interactive-fiction community practice

**Definition.** Craft knowledge accumulated by interactive-fiction authors and designers on structures, state, scale and authoring cost.

**Why it matters here.** Decades of practice on bounding content explosion while preserving the effect of earlier choices, and on steering unpredictable input back towards authored beats, which is the "fit an authored quest into the world" problem in miniature.

**Key sources.**
- Sam Kabo Ashwell, "Standard Patterns in Choice-Based Games", 26 January 2015 (time cave, gauntlet, branch and bottleneck, and others), https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/; IFWiki summary https://www.ifwiki.org/Standard_Patterns_in_Choice-Based_Games `[sec]`.
- Emily Short, "Beyond Branching" (field 5); "Small-Scale Structures in CYOA", 5 November 2016, https://emshort.blog/2016/11/05/small-scale-structures-in-cyoa/ `[sec]`; "Bowls of Oatmeal and Text Generation" (field 22).
- Failbetter Games' Fallen London / StoryNexus, the origin of quality-based narrative (as described by Short).

**Instance.** Branch-and-bottleneck: paths diverge then reconverge, with heavy state tracking so earlier choices still colour later scenes; time caves branch freely but must stay short; gauntlets run along a narrow spine (Ashwell, via IFWiki `[sec]`). Waypoint structures use NPC pathfinding through topic networks to steer back to authored beats (Short).

**Principles.**
1. Reconverging with state-carried variation preserves the felt effect of earlier choices while bounding authored content. Testable: authored node count versus perceived distinct histories.
2. Invisible bottlenecks (branches that end in similar choices) are acceptable if state-dependent flavour shows. (Ashwell, `[sec]`.) Testable: players' detection of bottlenecks versus rating of agency.
3. Systems that "heal" input towards authored beats (waypoints) raise responsiveness as content is added (Short). Testable: reachable-beat coverage as routes are added.

**Failure modes.** Mostly anecdotal and authorial folk theory, not controlled study; time-cave growth is exponential; QBN chains turn opaque (field 5).

**Relevance.** Supporting. Confidence: medium.

**Surprise.** No.

## Considered and rejected

- Narrative discourse generation and surface realisation (Montfort's Curveship, SimpleNLG-style NLG): output is prose ordering and voice; this system stages events in a game world, so discourse lives in the director (field 11).
- Computational creativity evaluation theory (Boden, Ritchie, Jordanous's SPECS): too abstract to yield design tests beyond fields 21-22.
- Cinematic camera and staging planning (Jhala and Young): belongs to a staging lens, and the brief says the player controls the camera.
- Believable-agent architectures (Hap, OCC emotion models) as a separate field: animation-level believability is not story-level, and the story-relevant part is in field 8.
- Greimas and other structuralist narratology as computational tools (outside IDtension-style use): descriptive, no testable claims found.
- Story understanding and narrative information extraction (DramaBank, story summarisation): parses finished texts, does not generate or pace.
- Generic bandit or A/B content selection: a mechanism, not a narrative idea; touched in field 23.
- Interactive film and video (*Bandersnatch*): linear-branching media with no simulation.
- TV Tropes and tale-type catalogues (ATU) as a seed ontology: plausible for seeding, but I found no evaluated computational use, so unresearched.
- Believability evaluation of dialogue systems (Alexa Prize style): conversation quality, not story.
- Hades' dialogue system as its own field: the GDC session exists, but I found no public account of its selection logic beyond the salience approach already in field 5.

## Verification notes

- "Beyond Branching" is by Emily Short, not Alexis Kennedy; Failbetter coined quality-based narrative (per Short's post).
- Ruskin's 2012 talk is titled "AI-driven Dynamic Dialog through Fuzzy Pattern Matching".
- "Select the Unexpected" is dated ICIDS 2022 by dblp; Lessard et al. list it as an AIIDE workshop paper (probably the workshop version).
- StoryAssembler is FDG 2019, not 2014. Purdy et al. (AIIDE 2018) has authors Purdy, Wang, He, Riedl.
- "Talk of the Town" results about trivial gossip come from Short's summary of Ryan's thesis, not from reading the thesis.
- Blocked or unread: ACM DL pages (Stories from the Bottom Up), Grand Text Auto posts, GDC Vault talk contents (Grinblat, Ruskin, Sylvester), the Indexter 2012 PDF, the Facade 2003 paper itself (retrospective read instead), Aarseth 2005, Gerrig and Bernardo 1994, Ely et al. 2015, Trabasso and van den Broek 1985, Reagan et al. 2016, Lehnert 1981, Ashwell 2015.
