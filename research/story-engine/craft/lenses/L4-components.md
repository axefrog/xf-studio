# Lens L4: components

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise.

**Method note.** Run on 22 October 2026 as a saturation test, working alone and without reading anything in the repository. I ran about 30 web searches, each aimed at confirming a source or a core claim. These covered: suspense, curiosity and surprise (Sternberg; Brewer and Lichtenstein; Gerrig and Bernardo; Zillmann; Carroll; Hitchcock); possible-worlds narratology (Ryan); plan-based narrative conflict (Ware and Young); folklore morphology and tale-type indexing (Propp; ATU); affective narratology (Hogan); theatre and improv craft (Mamet; Johnstone); fictional minds and theory of mind (Palmer; Zunshine); chronotope (Bakhtin); object biography (Kopytoff); genre theory (Altman); humour theory (Attardo and Raskin; Hurley, Dennett and Adams); closure and the peak-end rule (Kermode; Fredrickson and Kahneman); narrative transportation (Green and Brock); rhetorical narratology (Phelan); game ethics (Sicart); environmental storytelling (Jenkins); and interactive-drama architecture (Mateas and Stern; Short; Evans and Short; Booth). I did not retrieve any full texts. Every claim about a source's content that rests only on a search result or abstract summary is marked `[sec]`. Sources cited from background knowledge, with the bibliographic details not re-checked this session, are marked "(not re-verified)". Quotes are avoided; everything is paraphrase. Fields are ordered roughly by how directly they bear on the system's stated problem (caused, relevant, legible, consequential, varied, true to setting, well paced; the player is observed and offered to, never steered).

A recurring pattern across fields: most craft advice assumes an author who controls the order of disclosure and the audience's attention. This system does not control either. It controls what is placed in the world and when it is offered. Each entry's failure-modes line addresses that gap.

---

## 1. Narrative information economics (suspense, curiosity, surprise as gap management)

- **Definition.** A model in which story effects come from the order in which a text discloses information: curiosity is a felt gap about the past, suspense a felt gap about the future, surprise a gap not felt until it is closed.
- **Element(s).** Information (secrets, reveals, clues, dramatic irony); time; plot structure.
- **Why it matters here.** The engine can plant the same facts (a body, a debt, a betrayal) and choose what the player has already perceived when the scene triggers. This gives the generator a typed vocabulary for deciding what to show before the event (suspense), after it (curiosity), or never (a flat event). Without this, "legible" and "surprising" are not separately controllable.
- **Key sources.**
  - Sternberg, *Expositional Modes and Temporal Ordering in Fiction* (Johns Hopkins UP, 1978); "Telling in Time (I)" and "(II)", *Poetics Today* 11(4) 1990 and 13(3) 1992. `[sec]` for the two-criteria scheme (past vs future; gap felt vs not felt).
  - Brewer and Lichtenstein, "Stories are to entertain: a structural-affect theory of stories", *Journal of Pragmatics* 6 (1982), pp. 473-486; University of Illinois Center for the Study of Reading Technical Report 265. `[sec]`
  - Truffaut, *Hitchcock* (Simon and Schuster, 1967 / revised 1984), the bomb-under-the-table passage. `[sec]`
  - Yuan (2018), *Neohelicon*, linking the three effects to frame-shifting, frame-completion and frame-matching. `[sec]` (https://link.springer.com/10.1007/s11059-018-0462-9)
- **Instance.** A fixer's apartment is trashed (curiosity: who, why). Earlier, the player overheard a rival crew's boss name the same address (suspense: they know it is coming). A third variant gives no prior cue and the player simply finds the wreck (surprise, then retrospective gap-closing). One world fact, three disclosure orders.
- **Principles.**
  1. For any staged event, the generator should be able to label it as curiosity-, suspense- or surprise-structured by what the player has perceived beforehand. Testable: for a sample of staged events, a labeller reading only the player's perception log gets the same label as the generator's intent.
  2. A suspense scene whose threat the player has not been shown is not suspense. Testable: scenes tagged suspense must be preceded by at least one perceived cue that identifies the threat, or they are re-tagged surprise.
  3. Surprise should be rationed because it is the only one of the three that depends on the gap being unnoticed. Testable: in a play session, the share of surprise-structured beats stays below a configured fraction, and each can be explained by an earlier, perceivable cause.
- **Failure modes.** The model is text-order based. In an open world the player decides what they perceive and when, so "before" and "after" are only known at runtime. Brewer and Lichtenstein's scheme is also reported to be neither necessary nor sufficient for the audience effect it names `[sec]`. Hitchcock's rule to inform the audience whenever possible is a thriller heuristic, not a law.
- **Relevance.** Core. Confidence high.
- **Surprise.** No.

## 2. Psychology of suspense (problem-solving, uncertainty, entertained uncertainty)

- **Definition.** Empirical and philosophical work on what makes audiences feel suspense, especially the finding that suspense tracks perceived difficulty of escape rather than raw probability.
- **Element(s).** Stakes and cost; information; time (ticking clocks); conflict.
- **Why it matters here.** The engine must choose how many ways out a dangerous encounter offers. Treating suspense as "danger level" is wrong; this field says how to tune it via the number and visibility of solutions.
- **Key sources.**
  - Gerrig and Bernardo, "Readers as problem-solvers in the experience of suspense", *Poetics* 22 (1994), pp. 459-472. `[sec]`
  - Zillmann, "The psychology of suspense in dramatic exposition", in Vorderer, Wulff and Friedrichsen (eds.), *Suspense: Conceptualizations, Theoretical Analyses, and Empirical Explorations* (Erlbaum, 1996) (not re-verified).
  - Carroll, "The paradox of suspense", same volume; summarised in the Stanford Encyclopedia of Philosophy entry (https://plato.stanford.edu/entries/paradox-suspense/). `[sec]`
  - Brewer (1996), same volume (not re-verified).
- **Instance.** A hostage scene where the player can see three exits, two of which are visibly closed by the antagonist's actions over the scene. Perceived solutions shrink, suspense rises, without any change in the real chance of success.
- **Principles.**
  1. Suspense rises when the number of perceived escape paths falls, even if actual odds are unchanged. Testable: in a playtest, scenes that visibly close options before the danger peak are rated more suspenseful than scenes with matched odds and no visible closing. `[sec]`
  2. A suspenseful sequence needs a stated, perceived, desired outcome that is in doubt. Testable: a generator must be able to name the desired outcome and the party who wants it, or the sequence is not scheduled as suspense.
  3. Repeated exposure to the same outcome does not abolish suspense if the audience can keep the alternatives open (entertained uncertainty), so "replayed" templates need not be thrown out for the same player. Testable: second-run ratings of the same scene shell with varied surface dressing drop less than for an identical rerun. `[sec]` for Carroll's thesis; the test is mine.
- **Failure modes.** Most results come from short read texts. A player who is also the agent can end suspense by acting. Rules like "close exits" read as railroading if the closing is not caused by in-world agents.
- **Relevance.** Core. Confidence medium-high.
- **Surprise.** No.

## 3. Affective disposition theory and moral allegiance

- **Definition.** Audience enjoyment of drama depends on moral judgments of characters; liking a character produces hope for good outcomes and disliking one produces hope for bad.
- **Element(s).** Character; moral choice; stakes; endings.
- **Why it matters here.** The system offers content around NPCs the player has met. It needs a way to predict whether a given outcome will register as justice, tragedy or insult, which depends on the disposition the player has formed.
- **Key sources.**
  - Zillmann, "Disposition theory" body of work; Raney, "Disposition-based theories of enjoyment", in Bryant, Roskos-Ewoldsen and Cantor (eds.), *Communication and Emotion: Essays in Honor of Dolf Zillmann* (Erlbaum, 2003). `[sec]`
  - Zillmann on excitation transfer, summarised in https://en.wikipedia.org/wiki/Excitation-transfer_theory `[sec]` (secondary only).
  - Wikipedia summary of Zillmann: https://en.wikipedia.org/wiki/Dolf_Zillmann `[sec]`
- **Instance.** A street vendor the player has repeatedly helped is shaken down. If the shakedown crew is also one the player has seen abusing someone else, the player is positioned to want a punishment arc. If the vendor has been rude to the player, the same event reads as neutral background.
- **Principles.**
  1. Outcome valence is read relative to the player's disposition toward the affected party. Testable: the generator must carry a disposition estimate per NPC and event outcomes should be chosen (or labelled) conditional on it; unchanged events paired with different dispositions should produce different predicted valence labels.
  2. Relief after distress amplifies positive affect. Testable: a tense sequence that resolves favourably is rated more positive than the same resolution without prior tension. `[sec]` (reported results are mixed.)
  3. Bad characters "should" meet bad ends in the audience's eye. Testable: unpunished antagonists with no cost to them are rated less satisfying than punished ones, controlling for the player's disposition.
- **Failure modes.** The empirical record on excitation transfer is mixed `[sec]`. In interactive settings the player's own moral judgement of their choices also matters, which the theory does not model. Dispositions form from limited, sometimes misleading cues.
- **Relevance.** Core. Confidence medium.
- **Surprise.** No.

## 4. Rhetorical narratology: instabilities, tensions, progression

- **Definition.** A theory treating narrative as purposeful communication in which progression is driven by instabilities within the story (character conflict) and tensions in the discourse (gaps in knowledge, value or belief between audience and narrator).
- **Element(s).** Plot structure; point of view; dramatic irony; theme.
- **Why it matters here.** It separates two sources of narrative motion the generator might conflate: what is unresolved between characters, and what is unresolved between the player and the world's presentation. Dramatic irony and unreliable reports belong to the second.
- **Key sources.**
  - Phelan, *Narrative as Rhetoric: Technique, Audiences, Ethics, Ideology* (Ohio State UP, 1996) (https://ohiostatepress.org/books/BookPages/PhelanNarrative.htm). `[sec]`
  - Booth, *The Rhetoric of Fiction* (Chicago UP, 1961) (not re-verified).
  - Phelan, *Reading People, Reading Plots* (Chicago UP, 1989) (not re-verified).
- **Instance.** An NPC fixer gives the player an account of a job that a later radio chatter (overheard) contradicts. The tension is between what the narrator-source says and what the player can infer; no character conflict is needed to drive the beat.
- **Principles.**
  1. A beat's drive should be attributable to either an instability (two parties' goals collide) or a tension (the player's information differs from a source's), or both. Testable: every scheduled beat has at least one of the two named in its metadata; beats with neither are flagged as filler.
  2. An unreliable source needs a perceivable counter-cue. Testable: a "lying NPC" beat must have a discoverable contradiction available in world state, or the lie is unfair rather than tense.
- **Failure modes.** Phelan's apparatus is built for authored, finished texts with an implied author. There is no single implied author across a generated world. Advice on "authorial audience" does not translate directly.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** No.

## 5. Possible-worlds narratology and tellability

- **Definition.** Narrative analysed as a system of nested worlds: the actual story-world plus each character's knowledge, wish, obligation and fantasy worlds, with plot arising from conflict among them.
- **Element(s).** Character (want vs need); conflict; stakes; plot structure; information.
- **Why it matters here.** It gives a data model for the engine's NPCs that already looks like a story: each agent has beliefs, desires and duties that may diverge from the world's state. Divergence is the unit of narrative potential, and "tellable" content is where the divergences matter.
- **Key sources.**
  - Ryan, *Possible Worlds, Artificial Intelligence, and Narrative Theory* (Indiana UP, 1991). `[sec]` (typology of accessibility relations and internal-world types).
  - Ryan, *Narrative as Virtual Reality* (Johns Hopkins UP, 2001; 2nd ed. 2015). `[sec]`
  - Doležel, *Heterocosmica: Fiction and Possible Worlds* (Johns Hopkins UP, 1998) (not re-verified).
- **Instance.** Agent A believes a courier job is safe (knowledge world), wants a payout (wish world), owes a debt to a gang (obligation world). The world state is that the cargo is hot. The mismatches among these worlds are the story seeds, and the engine can read them off without any authored script.
- **Principles.**
  1. A beat is a candidate for staging when at least one NPC's belief world and the actual world disagree on something that affects that NPC's goals. Testable: scheduled beats map to a named belief/goal/obligation divergence; random events without one are rated as less meaningful.
  2. Story pressure grows with the number of unresolved divergences that touch the same agents. Testable: clusters of overlapping divergences should be preferred by the scheduler and correlate with player-reported interest.
- **Failure modes.** Ryan's typology is descriptive and was devised for reading, not generating. Maintaining a full belief model per NPC across LOD tiers is expensive; the tier at which beliefs are tracked determines which stories can occur.
- **Relevance.** Core. Confidence medium-high.
- **Surprise.** No.

## 6. Computational narrative planning and conflict models

- **Definition.** AI planning approaches that generate sequences of events from character goals, with explicit models of how one agent's plan is thwarted by another's or by the world.
- **Element(s).** Conflict and opposition; character; stakes; plot structure.
- **Why it matters here.** The engine proposes its own content. This field supplies measurable conflict dimensions, so "opposition" is not a vague ingredient but a parametrised choice (who, why, when, balance, directness, stakes, resolution).
- **Key sources.**
  - Ware and Young, "A computational model of plan-based narrative conflict at the fabula level", *IEEE Transactions on Computational Intelligence and AI in Games* 6(3), 2014 (https://scholars.uky.edu/en/publications/a-computational-model-of-plan-based-narrative-conflict-at-the-fab/). `[sec]` for the seven dimensions.
  - Ware and Young, "CPOCL: a narrative planner supporting conflict", AIIDE 2011 (https://scholars.uky.edu/en/publications/cpocl-a-narrative-planner-supporting-conflict/). `[sec]`
  - Riedl and Young, "Narrative planning: balancing plot and character", *Journal of Artificial Intelligence Research* 39 (2010) (not re-verified).
  - Ware, thesis (2014) (https://www.cs.uky.edu/~sgware/reading/papers/ware2014thesis.pdf). `[sec]`
- **Instance.** To produce a conflict for a courier NPC, select one with participants (courier, gang lieutenant), reason (debt), duration (single scene), and set balance, directness, stakes and resolution as continuous knobs. The model reportedly identified which characters were in conflict and for how long in a reader validation study, with weaker results elsewhere. `[sec]`
- **Principles.**
  1. Conflicts should be selected by dimension values to match what the pacing layer asks for, not generated blind. Testable: given a request (e.g. direct, balanced, low stakes, unresolved), the proposal contains a conflict whose measured dimensions fall in the request range.
  2. A conflict must be traceable to a thwarted plan step of a named agent. Testable: every "opposition" has a causal link to an agent's goal and the step that fails.
- **Failure modes.** Planners optimise coherence and tend to produce dry, over-explained plots. Ware and Young's validation was mixed, with failures traced to missing psychology `[sec]`. State-space cost is a problem for large casts.
- **Relevance.** Core. Confidence medium-high.
- **Surprise.** No.

## 7. Folkloristics: function morphology, tale types and motif indexes

- **Definition.** The comparative study of traditional tales, including Propp's analysis of character functions in fixed sequence and the Aarne-Thompson-Uther and Thompson motif indexes.
- **Element(s).** Plot structure; character roles; objects (donor gifts, magical agents); variation.
- **Why it matters here.** Gives a source of tested, recombinable story skeletons and a way to describe "same story, different surface" for varied-in-ways-players-notice. It also supplies the idea that roles are defined by what characters do, not who they are, which lets the engine cast roles from whoever the simulation has available.
- **Key sources.**
  - Propp, *Morphology of the Folktale* (Russian 1928; English transl. Univ. of Texas Press, 1968) (not re-verified). `[sec]` for the 31-function summary.
  - Uther, *The Types of International Folktales*, FF Communications 284-286 (2004); Aarne and Thompson. `[sec]` (ATU about 2,500 types; Propp applies to tales of magic).
  - Thompson, *Motif-Index of Folk-Literature* (Indiana UP, 1955-58) (not re-verified).
- **Instance.** A "donor test" function (a helper tests the hero and gives a tool on success) staged in a night-market: the player is asked for a small favour by a stranger, and later the stranger's gift (a keycard) opens a door.
- **Principles.**
  1. Roles are cast by function, so any simulated NPC who can perform the function can fill the role. Testable: a template is valid if substituting any NPC meeting stated capability preconditions yields a well-formed scene.
  2. Variation that players notice lives in role-filling and motif change, not in dressing. Testable: players asked to sort a set of generated quests recognise two as "the same" when they share role sequence even if setting differs, and as "different" when role sequence differs.
- **Failure modes.** Propp's sequence is specific to Russian wonder tales; it was found to hold in other tale sets `[sec]` but is not a general plot grammar. Strict sequencing produces predictable, formulaic output, which players of a long game will detect quickly.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** No.

## 8. Affective narratology: universal prototypes and emotion systems

- **Definition.** A cognitive-cultural theory that cross-cultural story prototypes (romantic, heroic, sacrificial, plus others) arise from basic emotion-motivation systems.
- **Element(s).** Plot structure; theme; character goals; stakes.
- **Why it matters here.** If prototypes are tied to emotion systems, they give a short list of goal shapes (union, hegemony, sacrifice) that any dystopian-city story can be mapped onto, helping with relevance to player history and cross-scale consistency (a street encounter and a heist can share the same prototype).
- **Key sources.**
  - Hogan, *Affective Narratology: The Emotional Structure of Stories* (University of Nebraska Press, 2011). `[sec]` for the three prototypes and the happiness-goal framing.
  - Hogan, *The Mind and Its Stories* (Cambridge UP, 2003) (not re-verified).
  - Onfiction summary: https://www.onfiction.ca/2009/04/emotions-narrative-universals-and.html `[sec]`
- **Instance.** A heist that is secretly a sacrificial prototype: a crew member is positioned to give up their share to save another. The generator tags the heist as heroic on the surface and plants the sacrificial subplot as a variant.
- **Principles.**
  1. A multi-part story keeps one dominant prototype at each scale, with others as subplots. Testable: story descriptors carry a prototype tag and sub-beats do not contradict it without a named subplot.
  2. Goals should be expressible as an eliciting condition for a basic positive state. Testable: every character goal in a proposal maps to one of a short list of happiness conditions.
- **Failure modes.** The universality claim is contested, and the evidence base is literary. Prototype tags can become a straitjacket if used as templates rather than as checks.
- **Relevance.** Supporting. Confidence medium-low.
- **Surprise.** Yes (rarely cited in game-writing manuals).

## 9. Action-based scene analysis (Stanislavskian objectives and the Mamet test)

- **Definition.** The theatre/screen craft of analysing every scene by what each character wants, what stands in the way, and what makes the scene necessary now.
- **Element(s).** Character (want); conflict; stakes; time; dialogue.
- **Why it matters here.** The cheapest reliable validity check for generated scenes. Generated exchanges often have no pressing objective. This test can reject them mechanically.
- **Key sources.**
  - Mamet's memo to the writers of *The Unit* (widely reposted), e.g. https://www.slashfilm.com/a-letter-from-david-mamet-to-the-writers-of-the-unit/ `[sec]` (the memo asks who wants what, what happens if they do not get it, and why now; the exact third question is paraphrased in sources).
  - Stanislavski, *An Actor Prepares* (1936) and *Building a Character* (1949) (not re-verified).
  - McKee, *Story* (ReganBooks, 1997) (not re-verified).
- **Instance.** A scene where a drone-repair tech wants the player to carry a package. Need: she must be gone by midnight. Cost of failing: the package is seized at dawn. If any of the three cannot be filled from world state, the scene is not staged.
- **Principles.**
  1. A scene is valid only if it has a named character with a concrete, pressing want that the scene tries to satisfy. Testable: reject any proposal whose metadata lacks want, obstacle, and urgency.
  2. A scene ends in failure, or a partial change of the want. Testable: the scene's end state differs from its start in the wanting character's circumstance.
- **Failure modes.** Prescriptive and screen-derived. Scenes where the player is the one wanting do not follow it. Many good scenes (atmosphere, rest) are low-want; applied strictly it penalises them.
- **Relevance.** Core. Confidence high.
- **Surprise.** No.

## 10. Improvisation craft: status, offers and blocking

- **Definition.** Practical theory from improvised theatre treating interaction as a continuous negotiation of status (relative height of positions) plus the acceptance or blocking of offers.
- **Element(s).** Dialogue and voice; character; conflict; humour.
- **Why it matters here.** Street encounters are small and unscripted; the vocabulary of status transactions and offers gives the generator a compact way to write NPC behaviour that reads as alive, and a way to make NPCs respond to the player's actions without scripting dialogue per case.
- **Key sources.**
  - Johnstone, *Impro: Improvisation and the Theatre* (Faber, 1979; Routledge 1981). `[sec]` for the central claim that status transactions are constant.
  - Commentary: https://www.antoinebuteau.com/lessons-from-keith-johnstone/ `[sec]`
  - Spolin, *Improvisation for the Theater* (1963) (not re-verified).
- **Instance.** A doorman and the player. The doorman raises status by making the player wait; the player, by not reacting, lowers the effect. The next line is picked by the doorman's status needs, not by a script.
- **Principles.**
  1. Every NPC line or action should be explainable as a status move (raise, lower, hold). Testable: a rater labels generated NPC lines; labelled moves should match the generator's intended move and vary over the exchange rather than repeating.
  2. Accepting a player's offer produces more engagement than blocking it. Testable: NPC responses that acknowledge a player action are rated more natural than responses that ignore it.
- **Failure modes.** Johnstone's claims are experiential, not experimental. "Status" here is interactional, not class or wealth `[sec]`, so it must not be confused with in-world rank. Overuse produces sitcom-style one-upmanship.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** Yes.

## 11. Fictional minds and theory of mind in narrative

- **Definition.** Cognitive-narratological accounts that readers follow stories by reading characters' minds (including shared, group-level "intermental" thought), limited to a few levels of nested belief.
- **Element(s).** Character; point of view; dialogue; information.
- **Why it matters here.** Sets a design budget for how much nested belief a scene can carry before the player loses track, and shows that groups (crews, gangs, corporations) can be modelled as having minds, which suits a city of factions.
- **Key sources.**
  - Palmer, *Fictional Minds* (University of Nebraska Press, 2004). `[sec]`
  - Zunshine, *Why We Read Fiction: Theory of Mind and the Novel* (Ohio State UP, 2006). `[sec]`
  - Evans and Short, "Versu - a simulationist storytelling system", *IEEE TCIAIG* 6(2), 2014 (https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf). `[sec]` (social practices as suggestion-only joint plans).
- **Instance.** A double-cross in which the player must know that the broker thinks the buyer thinks the player is loyal. Four levels is about the comfortable cap per the reviews cited. `[sec]`
- **Principles.**
  1. A scene should not require the player to track more than about four nested attributions of mental state. Testable: a proposal's belief-nesting depth, computed from its information graph, stays at or below a configured limit.
  2. Groups can be given a persistent "continuing consciousness" so players attribute a single intent to them. Testable: players asked to describe a faction's goal give consistent answers across encounters if the generator keeps a single group intent.
- **Failure modes.** The four-level figure is an empirical average from reading, not a hard limit; games add spatial cues that may change it. Simulating minds at depth is costly across LOD tiers.
- **Relevance.** Core. Confidence medium.
- **Surprise.** No.

## 12. Focalisation and range of knowledge

- **Definition.** The study of through whose perception and with how much knowledge a story is presented: restricted, omniscient, or something between.
- **Element(s).** Point of view; information; dramatic irony; tone.
- **Why it matters here.** In a system where the player is the only camera, the only available focalisation is the player's. The engine still needs a way to give the player knowledge the player-character lacks (overheard scenes, shards, news) so that dramatic irony and suspense are possible without taking control.
- **Key sources.**
  - Genette, *Narrative Discourse* (Cornell UP, 1980; French 1972) (not re-verified).
  - Bal, *Narratology: Introduction to the Theory of Narrative* (University of Toronto Press, 1985) (not re-verified).
  - Bordwell, *Narration in the Fiction Film* (University of Wisconsin Press, 1985), on range and depth of knowledge (not re-verified).
- **Instance.** The player reads a data-shard from the antagonist's point of view before meeting them. The shard gives wider knowledge than the street view, creating dramatic irony without a cutscene.
- **Principles.**
  1. Knowledge channels other than direct perception (shards, radio, news, rumours) are what extend the player's range beyond V's own. Testable: every dramatic-irony beat can name the channel by which the player obtained the information.
  2. The range of knowledge should vary by scale: street encounters are mostly restricted, heists tend to give a wider planning view. Testable: logged knowledge ranges differ by scale class in proposals.
- **Failure modes.** The vocabulary comes from fixed texts with one narrator. Here, any information channel the player ignores does not exist for them, so irony can silently fail to land.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** No.

## 13. Narrative time: order, duration, frequency and ticking clocks

- **Definition.** Structural description of how story time is rearranged in telling (anachrony, flashback), stretched or compressed (duration), and repeated (frequency); and philosophical accounts of narrative as the shaping of lived time.
- **Element(s).** Time (structure, ordering, flashback, ticking clocks); pacing; plot structure.
- **Why it matters here.** A simulated city has its own clock. The player may see an aftermath before a cause, may skip days, may be offered the same event twice. The vocabulary lets the engine reason about legitimate reorderings (a flashback delivered as a recording) and about deadlines.
- **Key sources.**
  - Genette, *Narrative Discourse*, on order, duration, frequency (not re-verified).
  - Ricoeur, *Time and Narrative*, 3 vols. (Chicago UP, 1984-88) (not re-verified).
  - Kermode, *The Sense of an Ending* (Oxford UP, 1967) `[sec]`
- **Instance.** A deadline stated in-world ("the shipment moves at dawn") plus a later bar-scene recording of the earlier planning session (a flashback via found media) that explains why.
- **Principles.**
  1. A ticking clock must be perceivable and consistent with the world clock. Testable: any deadline has a visible source and the simulation fires the consequence at that time whether or not the player attends.
  2. A reordered reveal (aftermath first) is legitimate only if the later cause can be located. Testable: every curiosity beat has a resolvable cause in the event log that can be surfaced.
- **Failure modes.** Genette's categories describe text; with an open simulated world the "narrative" time is the player's own order of discovery. Deadline mechanics can become a source of resentment if they punish a player who was elsewhere.
- **Relevance.** Core. Confidence medium-high.
- **Surprise.** No.

## 14. Chronotope, place as story, and spatial narrative

- **Definition.** Literary and game-design accounts in which a kind of place carries a characteristic kind of time and event (the road, the threshold, the salon), and in which space itself stores or evokes stories.
- **Element(s).** Place and setting as story; time; tone; information (embedded clues).
- **Why it matters here.** The city is the main authored asset. This lets the engine choose where an event happens because of what the place affords (a stairwell for a decision, a market for a chance meeting) and place clues in the environment rather than in dialogue.
- **Key sources.**
  - Bakhtin, "Forms of time and of the chronotope in the novel", in *The Dialogic Imagination* (University of Texas Press, 1981). `[sec]` (threshold as a site of crisis and decision).
  - Jenkins, "Game design as narrative architecture", in Wardrip-Fruin and Harrigan (eds.), *First Person* (MIT Press, 2004); four modes: evoked, enacted, embedded, emergent. `[sec]`
  - Lynch, *The Image of the City* (MIT Press, 1960) (not re-verified).
  - Fernandez-Vara, "The game spaces speak volumes: indexical storytelling", DiGRA 2011 (not re-verified).
- **Instance.** A decision between two crews is staged in a stairwell or doorway rather than on an open street; an abandoned apartment's props imply an earlier eviction (embedded narrative).
- **Principles.**
  1. Event type should be matched to place type by affordance. Testable: scheduling logs show decision/crisis beats concentrated at threshold-type locations more than chance.
  2. Embedded clues should reflect the actual simulated history of the place. Testable: every environmental prop set can be traced to events in the place's log; props with no trace are flagged as decoration.
- **Failure modes.** Bakhtin warns against treating motifs as fixed in meaning `[sec]`. Embedded storytelling is expensive to dress and often unnoticed; players frequently do not read props.
- **Relevance.** Core. Confidence medium-high.
- **Surprise.** No.

## 15. Object biography and thing theory (props, MacGuffins, Chekhov's gun)

- **Definition.** Anthropological and cultural-studies accounts of objects as having careers: they move between commodity and singular status, accrue meanings, and can be read through their histories.
- **Element(s).** Objects and props; stakes; information; place.
- **Why it matters here.** The engine can generate objects with histories that carry story (a pistol that passed through four owners), turning loot and props into reusable narrative hooks tied to the player's history and the city's.
- **Key sources.**
  - Kopytoff, "The cultural biography of things: commoditization as process", in Appadurai (ed.), *The Social Life of Things* (Cambridge UP, 1986), pp. 64-91 (https://www.cambridge.org/core/books/abs/social-life-of-things/cultural-biography-of-things-commoditization-as-process/3AD40A7B3A3BF10A57628A023587402D). `[sec]`
  - Brown, "Thing theory", *Critical Inquiry* 28(1), 2001 (not re-verified).
  - Hitchcock's MacGuffin as discussed in Truffaut, *Hitchcock* (not re-verified).
- **Instance.** A corporate keycard carries a log of owners. The player picks it up; two sessions later its previous owner's friend appears. The object linked the two beats.
- **Principles.**
  1. A significant object should have a recorded chain of custody that the engine can surface. Testable: every object used as a story hook has a non-empty custody log that the staged scene references at least once.
  2. A planted object should pay off or be retired explicitly. Testable: the system tracks planted hooks and each ends in use, expiry, or a stated reason for removal.
- **Failure modes.** Chekhov's rule (anything shown must be used) conflicts with open worlds that are full of unused things; applying it strictly makes everything a quest item. Object biographies can be mere flavour text.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** Yes.

## 16. Genre theory and tone: semantics, syntax and the expectation contract

- **Definition.** Accounts of genre as a combination of shared vocabulary (semantic elements) and shared structure (syntactic relations), producing an audience contract about tone and what can happen.
- **Element(s).** Tone and mood; theme; setting; plot structure.
- **Why it matters here.** "True to the setting" needs to be checkable. Cyberpunk's vocabulary (chrome, corps, street) is easy to supply; its syntax (the individual against systems, bought-and-sold bodies, hard-bought wins) is what generators miss.
- **Key sources.**
  - Altman, "A semantic/syntactic approach to film genre", *Cinema Journal* 23(3), 1984, pp. 6-18. `[sec]`
  - Cawelti, *Adventure, Mystery, and Romance* (Chicago UP, 1976) (not re-verified).
  - Suvin, *Metamorphoses of Science Fiction* (Yale UP, 1979), on cognitive estrangement (not re-verified).
- **Instance.** A generated encounter has all the vocabulary (a ripperdoc, a gang, a corp van) but ends with a clean heroic rescue and no cost. The syntax of the setting says wins cost something; the check flags the mismatch.
- **Principles.**
  1. Setting fidelity has two parts: vocabulary present and structural relations respected. Testable: a rubric scores both separately and proposals must pass the syntactic check, not just the lexical one.
  2. Tone is a constraint on outcomes as well as on style. Testable: outcome distributions across generated resolutions match the setting's declared tone profile (e.g. the share with a lasting cost).
- **Failure modes.** Genre labels are historically unstable, and Altman himself questioned where the line between semantic and syntactic falls `[sec]`. Tone rules can become a fixed bleakness that players find monotonous.
- **Relevance.** Core. Confidence medium.
- **Surprise.** No.

## 17. Humour theory: incongruity, scripts and the general theory of verbal humor

- **Definition.** Linguistic and cognitive theories that humour arises when a text is compatible with two opposed scripts and an incongruity is resolved, structured as parameters (script opposition, logical mechanism, situation, target, narrative strategy, language).
- **Element(s).** Humour; tone; dialogue; character.
- **Why it matters here.** The setting is dark, but its humour is part of its truth. The engine needs a way to construct comic beats rather than hope for them, and to avoid humour misplaced against tone.
- **Key sources.**
  - Attardo and Raskin, "Script theory revis(it)ed: joke similarity and joke representation model", *Humor* 4(3/4), 1991, pp. 293-347. `[sec]`
  - Attardo, *Linguistic Theories of Humor* (Mouton de Gruyter, 1994) (not re-verified).
  - Hurley, Dennett and Adams, *Inside Jokes: Using Humor to Reverse-Engineer the Mind* (MIT Press, 2011). `[sec]` (humour as reward for correcting mistaken assumptions).
- **Instance.** A vending machine that politely upsells during a shootout. Script opposition: consumer service vs life-threatening danger; target: corporate culture.
- **Principles.**
  1. A comic beat needs a stated script opposition and a target. Testable: each flagged comic beat names both; beats with neither are not scheduled as humour.
  2. Humour should not be placed at the peak of distress unless the target is the source of the distress. Testable: playtester ratings of dark comedy where the target is the oppressor are higher than where the target is the victim.
- **Failure modes.** The theory addresses short jokes, not sustained comic situations. Generated jokes are often incongruous without being resolved; "random" is not funny. Humour is highly dependent on personal taste.
- **Relevance.** Supporting. Confidence medium-low.
- **Surprise.** No.

## 18. Closure, endings and retrospective evaluation (Kermode; peak-end)

- **Definition.** Literary theory of how endings confer meaning on what came before, combined with psychology showing that remembered experiences are judged mostly by their peak and their end, with little weight on duration.
- **Element(s).** Endings and closure; pacing; stakes; theme.
- **Why it matters here.** A procedural system produces many beats and few natural endings. It needs to know which moments to invest in (the peak, the end) and that ending well matters more than lasting long.
- **Key sources.**
  - Kermode, *The Sense of an Ending* (Oxford UP, 1967) `[sec]` (ending confers meaning on the middle).
  - Herrnstein Smith, *Poetic Closure* (Chicago UP, 1968) (not re-verified).
  - Fredrickson and Kahneman, "Duration neglect in retrospective evaluations of affective episodes", *Journal of Personality and Social Psychology* 65(1), 1993. `[sec]` (film-viewing experiments; weighted peak and final ratings predicted overall evaluation). Meta-analysis summary: https://ideas.repec.org/a/eee/jobhdp/v170y2022ics0749597822000334.html `[sec]`
- **Instance.** A long heist's last scene is a quiet cost-count rather than another firefight. Retrospective rating is driven by the peak (the vault) and the end (the aftermath) more than by the number of hours.
- **Principles.**
  1. Remembered quality is governed by the most intense moment and the final moment. Testable: after-session ratings are better predicted by peak-plus-end ratings than by mean or length. `[sec]`
  2. Every offered thread needs an explicit closure state (resolved, abandoned, transformed). Testable: the thread tracker has no thread open beyond a configured age without a stated status.
- **Failure modes.** The peak-end rule was established on short episodes; its force on dozens-of-hours experiences is uncertain. Closure can be forced, producing tidy endings that clash with a dystopian tone where some things stay open.
- **Relevance.** Core. Confidence medium.
- **Surprise.** No.

## 19. Narrative transportation and believability

- **Definition.** The psychology of absorption in a story (imagery, affect, attention) and its effects: story-consistent beliefs, attitudes to characters, and reduced detection of false notes.
- **Element(s).** Tone; setting; character; plot.
- **Why it matters here.** It gives a measure for whether content "works" at the level of immersion, and explains why a single false note (a contradiction with the player's history or the city's rules) can break absorption and why believable plots matter.
- **Key sources.**
  - Green and Brock, "The role of transportation in the persuasiveness of public narratives", *Journal of Personality and Social Psychology* 79(5), 2000, pp. 701-721. `[sec]`
  - Gerrig, *Experiencing Narrative Worlds* (Yale UP, 1993) (not re-verified).
  - Green and Appel (2024), *Advances in Experimental Social Psychology* preprint (https://mcm.uni-wuerzburg.de/fileadmin/06110300/2024/Pdfs/Green___Appel__2024__Advances_Preprint.pdf). `[sec]`
- **Instance.** An NPC greets V as a stranger though they have met twice. The continuity error costs more than any plot flaw because it breaks absorption; a transportation scale after the scene would register it.
- **Principles.**
  1. Continuity with the player's history is a precondition of absorption. Testable: scenes with a detected continuity violation score lower on a transportation scale than matched scenes without.
  2. Highly transported audiences notice fewer inconsistencies, so inconsistency is most costly in low-absorption moments. Testable: error detection rates are higher in scenes with low imagery and low character identification. `[sec]`
- **Failure modes.** Transportation research uses short texts and persuasion outcomes. In games, players are also operating a controller and managing systems, which compete for attention.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** No.

## 20. Conversational narrative: Labov's structure and evaluation

- **Definition.** Sociolinguistic analysis of narratives of personal experience told in everyday talk, with a standard structure (abstract, orientation, complicating action, evaluation, resolution, coda) in which evaluation says why the story is worth telling.
- **Element(s).** Dialogue and voice; plot at small scale; stakes; theme.
- **Why it matters here.** Street encounters are small stories, often told or overheard rather than staged. This field describes how real people tell small stories, which gives NPC "tell me about it" lines a credible shape and a built-in answer to "so what".
- **Key sources.**
  - Labov and Waletzky, "Narrative analysis: oral versions of personal experience", in Helm (ed.), *Essays on the Verbal and Visual Arts* (University of Washington Press, 1967) (not re-verified).
  - Labov, "The transformation of experience in narrative syntax", in *Language in the Inner City* (University of Pennsylvania Press, 1972) (not re-verified).
  - Ochs and Capps, *Living Narrative* (Harvard UP, 2001) (not re-verified).
- **Instance.** A drunk at a noodle stand tells V about the night the lights went out on his block: orientation, a complicating event, then evaluation ("that's when I knew they weren't coming"), resolution, coda. The evaluation points to a nearby seed.
- **Principles.**
  1. A told anecdote that lacks evaluation reads as pointless. Testable: NPC anecdotes without an evaluative clause are rated as less tellable than matched anecdotes with one.
  2. Told stories bind to the teller's stance. Testable: two NPCs describing the same event produce different evaluation clauses tied to their goals.
- **Failure modes.** Labov's data are interviews on the single topic of near-death experience, which biases the model. Voice is cultural; the scheme can homogenise dialects and registers.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** Yes.

## 21. Causal-network and situation-model psychology of story comprehension

- **Definition.** Experimental work showing readers represent stories as networks of causal links and as multidimensional situation models (time, space, protagonist, causation, intention); events with more causal connections are remembered and judged important.
- **Element(s).** Plot structure; time; character; information.
- **Why it matters here.** The requirement that content "feels caused" and "relevant to the player's history" can be read as: raise the causal connectivity between the new event and what the player has experienced. This field says why that matters and how to measure it.
- **Key sources.**
  - Trabasso and van den Broek, "Causal thinking and the representation of narrative events", *Journal of Memory and Language* 24 (1985), pp. 612-630 (not re-verified).
  - Zwaan, Langston and Graesser, "The construction of situation models in narrative comprehension: an event-indexing model", *Psychological Science* 6(5), 1995 (not re-verified).
  - Mandler and Johnson, "Remembrance of things parsed: story structure and recall", *Cognitive Psychology* 9 (1977) (not re-verified).
- **Instance.** A gang war flare-up that links to a debt the player helped create has several causal links to V's past; a random gang fight has none. The first is remembered as "my doing".
- **Principles.**
  1. Events with more causal links to prior experienced events are judged more important and are better recalled. Testable: recall after a delay is higher for staged content with more causal links to the player's log. (not re-verified)
  2. Shifts in time, space, character or goal are where comprehension is most effortful. Testable: scene transitions that change several situation dimensions at once produce more player confusion reports.
- **Failure modes.** Results come from read texts with experimenter-controlled structure. The player may not recognise a causal link unless it is made perceivable, so unseen causes are worthless.
- **Relevance.** Core. Confidence medium.
- **Surprise.** Yes.

## 22. Moral psychology and the ethics of game design

- **Definition.** Moral psychology and philosophy of games explaining why moral choices register or fail: moral intuitions are multi-dimensional, and games are ethical objects in which players act as ethical agents.
- **Element(s).** Moral choice; stakes and cost; theme; character.
- **Why it matters here.** The system offers consequential choices without steering the player. This field says what makes a choice morally real (costly, ambiguous, attributable) and warns against binary good/evil meters.
- **Key sources.**
  - Sicart, *The Ethics of Computer Games* (MIT Press, 2009) `[sec]`; *Beyond Choices: The Design of Ethical Gameplay* (MIT Press, 2013) `[sec]` (https://summit.sfu.ca/item/223).
  - Haidt, *The Righteous Mind* (Pantheon, 2012) (not re-verified).
  - Hocking, "Ludonarrative dissonance in Bioshock" (blog essay, 2007) (not re-verified).
  - Zagal, "Ethically notable videogames: moral dilemmas and gameplay", DiGRA 2009 (not re-verified).
- **Instance.** The player must choose which of two neighbours' flats the building security sweeps first. Both have a legitimate claim; no option is labelled good; each has a visible cost.
- **Principles.**
  1. A choice is morally real only if every option has a perceivable cost to something the player cares about. Testable: option sets in which one choice is dominant are flagged as non-dilemmas.
  2. Consequences should be attributed to the player's act, not to a meter. Testable: a consequence message names the act and the affected party, not a score.
  3. Rewards that reward the "cruel" choice contradict stated narrative stance (ludonarrative dissonance). Testable: reward structure should not contradict the tone the scene sets.
- **Failure modes.** Haidt's foundations are contested. Players treat many choices as optimisation puzzles and pick by reward. Over-engineered dilemmas feel contrived.
- **Relevance.** Core. Confidence medium.
- **Surprise.** No.

## 23. Dramatistic motive analysis (Burke's pentad and ratios)

- **Definition.** A rhetorical framework for analysing motive via five terms (act, scene, agent, agency, purpose), with "ratios" between them that test coherence (e.g. whether an act fits its scene).
- **Element(s).** Place and setting as story; character motive; theme; conflict.
- **Why it matters here.** It is a cheap consistency check on generated events. A crime in a setting that makes it implausible, or an agent whose means do not match their purpose, shows up as a ratio mismatch. It also lets the system describe disagreements between factions as different weightings of the same terms.
- **Key sources.**
  - Burke, *A Grammar of Motives* (Prentice-Hall, 1945) (not re-verified).
  - Burke, *A Rhetoric of Motives* (1950) (not re-verified).
- **Instance.** A scene-act ratio check: a quiet confession in a roaring club fails the ratio unless motivated; a violent act in a hushed clinic is highly marked and thus tellable.
- **Principles.**
  1. Every staged event can be described with all five pentad terms; a missing term indicates a hole. Testable: proposals are rejected if any of the five cannot be filled from world state.
  2. Marked mismatches in a ratio are story-bearing; unmarked mismatches are errors. Testable: the generator labels each mismatch as intended (with justification) or reports it as a defect.
- **Failure modes.** The pentad is interpretive, and Burke did not specify procedures. Without a rubric, raters disagree on the terms. Formal use may flatten it.
- **Relevance.** Peripheral. Confidence low-medium.
- **Surprise.** Yes.

## 24. Comics theory: closure, elision and sequential staging

- **Definition.** The study of how readers fill gaps between panels (closure) and how artists choose transitions (moment-to-moment, action-to-action, scene-to-scene, aspect-to-aspect) and what to leave out.
- **Element(s).** Information (what is withheld); time; pacing; setting.
- **Why it matters here.** The city is simulated at levels of detail around the player, so most events are never shown. Comics craft is a mature account of showing the aftermath or a fragment and letting the audience supply the rest. This matches the engine's constraint that far-away stories must be implied, not rendered.
- **Key sources.**
  - McCloud, *Understanding Comics: The Invisible Art* (Tundra, 1993) (not re-verified).
  - Groensteen, *The System of Comics* (University Press of Mississippi, 2007; French 1999) (not re-verified).
- **Instance.** The player sees a smashed storefront, a cleaning crew and a single survivor's shoe. The shooting itself was never simulated; closure fills it.
- **Principles.**
  1. Implied events are legible when the shown fragment constrains the possible cause to a few. Testable: observers shown the fragment can name the cause class in a forced choice above chance.
  2. Where detail is unavailable, aspect-to-aspect staging (mood, setting) beats failed attempts at action. Testable: low-LOD scenes staged as aftermath get higher legibility ratings than low-fidelity enactments.
- **Failure modes.** Closure assumes the audience sees the panels in order, and in a world the player can walk through in any order, fragments may be seen out of sequence or not at all.
- **Relevance.** Supporting. Confidence medium.
- **Surprise.** Yes.

## 25. Beat structure, drama management and pacing in interactive practice

- **Definition.** Game-writing and interactive-drama practice for dividing a story into small selectable units (beats, storylets) and managing intensity over time, either by a drama manager choosing beats toward an arc or by systems that modulate pressure.
- **Element(s).** Plot structure; pacing; tone; stakes; time.
- **Why it matters here.** The nearest direct precedent for the system. It shows how small authored units are chosen by state and context, how pacing can be driven by a measured intensity, and how the player stays free while being offered content.
- **Key sources.**
  - Mateas and Stern, "Structuring content in the Facade interactive drama architecture", AIIDE 2005 (https://ojs.aaai.org/index.php/AIIDE/article/view/18722). `[sec]`
  - Booth, "The AI systems of Left 4 Dead", AIIDE 2009 keynote (https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf). `[sec]`
  - Short, "Beyond branching: quality-based, salience-based, and waypoint narrative structures" (2016) (https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/). `[sec]`
  - Evans and Short, "Versu" (see field 11). `[sec]`
- **Instance.** A pool of 40 encounter beats, each with preconditions on player state and city state; a selector picks the most salient, and a pacing model withholds high-intensity beats until after a measured lull.
- **Principles.**
  1. Selecting by salience (best fit for current state) rather than by the player's menu choice keeps the player free while offering relevant content. Testable: offered content correlates with recent player state beyond chance, and the player is never forced to take it. `[sec]`
  2. Intensity should rise and fall rather than climb. Testable: logged intensity over a session shows peaks followed by troughs of at least a configured depth. `[sec]`
  3. Scripted set pieces are memorised and lose force on repeat. Testable: second-encounter ratings of a fixed set piece drop more than ratings of a dynamically varied one. `[sec]` (Booth's stated rationale; the test is mine.)
- **Failure modes.** Facade's beat model assumes a bounded scene and a drama manager that sequences them. An open world has many unrelated beats concurrently. Pacing by intensity alone is calibrated to action games and risks reading as a rhythm generator, not a story.
- **Relevance.** Core. Confidence high.
- **Surprise.** No.

---

## Considered and rejected

- **Hero's Journey / monomyth (Campbell, Vogler):** a single-protagonist template that fits authored arcs; the system never controls the protagonist, and the template adds no testable property beyond fields 7 and 8.
- **Save the Cat and beat-sheet manuals:** formulaic page-count templates with no empirical or theoretical grounding; subsumed by field 25 for pacing.
- **Freytag's pyramid:** a descriptive shape for finished tragedies; the intensity-curve content is covered better by fields 2 and 25.
- **Aristotle's *Poetics* as a standalone field:** reversal and recognition are folded into fields 1 and 3; as a plot rulebook it assumes unity of action under author control.
- **Russian Formalism fabula/syuzhet in isolation:** the story/discourse split is already embedded in fields 1, 12 and 13.
- **Semiotics (Greimas actantial model):** overlaps with Propp roles in field 7 and adds a formal square with little generator payoff.
- **Jungian archetypes:** low evidential standing and hard to test.
- **Game-feel / MDA (Hunicke, LeBlanc, Zubek):** a mechanics-experience framework; relevant to the whole product but not to a story component.
- **Ludology vs narratology debate (Aarseth, Juul, Murray):** useful orientation for other lenses; no component-level principle.
- **Environmental storytelling as a standalone entry:** folded into field 14 with Bakhtin and Jenkins.
- **Transmedia and world-building theory (Wolf):** valuable for setting breadth, but the component-level guidance overlaps with fields 5 and 14.
- **Screenwriting dialogue manuals (McKee, Field) beyond field 9:** prescriptive; the testable content is in fields 9, 10 and 20.
- **Rhetorical figures and classical rhetoric (ethos, pathos, logos):** useful for persuasion dialogue but peripheral to story components.
- **Narrative identity and memory studies (McAdams):** relevant to character arcs, but evidence is on life stories, not generated fiction.
