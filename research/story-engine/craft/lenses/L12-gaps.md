# Lens L12: targeted gaps

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise. Its patent remarks are out of scope: the Story Engine does no patent searches for its own ideas ([D-20](../../decisions.md)).

**Method note.** Run on 22 October 2026 by a single lens working alone, with no repository reading. I ran 30 web searches (standard mode) and 2 page fetches across the four gap areas: approval/affinity and romance design and critique; relationship psychology; interactive-drama and social-simulation systems; theme, arcs and procedural rhetoric; suspense, dread and horror-game affect research; unseen-threat directors; save-scumming and reload-friendly designs; memory and forgetting models. Search results were often fan wikis and content farms; I discarded those and kept only bibliographic or primary pages. Verification marks used below: **(v)** the source's existence and a key claim were confirmed in this session by a fetch or by a bibliographic search hit; **(m)** the source is a standard reference I am citing from memory and did not re-confirm today; **[sec]** a claim that rests only on a search-engine summary, not on my reading of the source. The empirical literature on save-scumming and on player expectations of world memory is thin; where I say so, I mean I found little, not that none exists.

---

## Area 1: Relationships and romance

### F1. Graded disclosure and intimacy pacing
- **Definition:** The study of how closeness grows through reciprocal, step-wise self-disclosure that widens (topics) then deepens (privacy), and can also reverse.
- **Area:** 1
- **Why it matters here:** The engine must pace relationship content so a companion's backstory, a fixer's trust, or a romance beat arrives when the player has "earned" that depth, not on a timer or a flag. It also gives a vocabulary for beats that make a relationship regress.
- **Key sources:**
  - Altman, I. & Taylor, D. (1973). *Social Penetration: The Development of Interpersonal Relationships.* Holt, Rinehart & Winston. (m; breadth/depth/onion/reciprocity/de-penetration confirmed via secondary summaries [sec])
  - Reis, H. & Shaver, P. (1988). Intimacy as an interpersonal process. In Duck (ed.), *Handbook of Personal Relationships*, Wiley. (m)
  - Wikipedia, "Social penetration theory", https://en.wikipedia.org/wiki/Social_penetration_theory (secondary; use only as a pointer)
- **Instance:** A fixer's early jobs exchange only professional facts; only after the player has returned a favour and listened to an unprompted aside does the fixer disclose a personal stake. If the player later betrays them, the same ladder is climbed back down (the fixer stops volunteering).
- **Principles:**
  1. Players rate a companion's disclosure as "earned" more often when it follows the player's own prior reciprocal act than when it is released at an equal-length delay with no reciprocal act. (testable by A/B on the same content)
  2. A relationship beat that discloses at a depth two or more rungs above current closeness is rated less believable than one a single rung up.
  3. Visible regression (withheld disclosure after a betrayal) raises perceived consequence of the earlier betrayal more than a numeric penalty does.
- **Failure modes:** Treating the onion as a strict linear ladder (real people skip rungs under crisis); depth released by quantity of interaction rather than by quality; reciprocity quotas that read as a toll gate.
- **Relevance:** Core; confidence medium-high. The theory is dated and its strict form has critics, but as a pacing heuristic it is sound.
- **Surprise:** No.

### F2. Commitment, maintenance and drift
- **Definition:** The psychology of what keeps relationships going or lets them decay: commitment as a function of satisfaction, alternatives and investment; small daily "bids" and responses; novelty and shared self-expansion.
- **Area:** 1
- **Why it matters here:** Relationships in a living city should change when the player is away or neglects them, and should be sustained by identifiable things. This literature supplies the variables, which are richer than a single approval number.
- **Key sources:**
  - Rusbult, C. E. (1980). Commitment and satisfaction in romantic associations: a test of the investment model. *Journal of Experimental Social Psychology* 16, 172-186. (m)
  - Tran, J. K., Judge, M. & Kashima, E. S. (2019). Commitment in relationships: an updated meta-analysis of the investment model. *Personal Relationships*. (v by search hit: 202 samples, ~50,000 participants; satisfaction r about .65, investments r about .53 [sec]; journal name from memory)
  - Aron, A., Norman, C. C., Aron, E. N., McKenna, C. & Heyman, R. E. (2000). Couples' shared participation in novel and arousing activities and experienced relationship quality. *Journal of Personality and Social Psychology* 78(2). (m; effect summarised via a secondary blog [sec])
  - Gottman, J. M. and colleagues on "bids for connection" and turning toward, summarised at https://www.gottman.com/blog/turn-toward-instead-of-away/ (v as a pointer; the 86% vs 33% figure is Gottman's own blog's claim of a six-year newlywed follow-up [sec] and should be checked against the primary paper before reuse)
- **Instance:** A bartender who has known V for two missions makes a small bid (asks how a job went). A reply, even a curt one, counts as turning toward; ignoring it ten times lets her stop asking. A shared novel risky job (heist, a trip to a dangerous district) raises closeness more than another equal-reward routine job.
- **Principles:**
  1. Relationship state modelled with separate satisfaction, investment and alternatives variables predicts the player's later decision to keep or drop an NPC better than a single scalar does.
  2. Companions who never initiate small bids are rated as less alive than companions who initiate them at a low rate, even if total interaction time is equal.
  3. Relationship quality rises more after a novel shared activity than after a repeat of a liked one of equal duration.
- **Failure modes:** Importing couples research wholesale to friendships, rivalries and mentorship (the cited work is largely romantic or marital); exploitative investment mechanics (sunk-cost hooks); Gottman's headline numbers repeated uncritically.
- **Relevance:** Core; confidence medium. Mature field, but transfer to NPC relationships is untested.
- **Surprise:** Yes. The "alternatives" and "investment" variables, and the idea that a character should make small low-stakes bids, are rarely used in affinity systems.

### F3. Approval and affinity systems, and their critiques
- **Definition:** The family of design patterns that track a companion's opinion of the player as a number or stage (gifts, dialogue approval, loyalty), and the criticism that they reduce relationships to transactions.
- **Area:** 1
- **Why it matters here:** This is the incumbent solution the engine will be compared to. Knowing exactly where it fails (gift-giving, one-axis opinion, "playersexual" availability) tells us what to replace and what players still expect to see.
- **Key sources:**
  - Tomlinson, C. (2024). Designing Romance and the "Playersexuality" Debate. *International Journal of Games and Social Impact* 2(2), 8-27. https://revistas.ulusofona.pt/index.php/ijgsi/article/view/9461 (v by search; abstract-level only: content analysis of Dragon Age and Baldur's Gate 3 and player discourse; players want realistic characters with their own sexualities, which conflicts with desire for control)
  - Bednorz (2021), *Images*, on courtly-love structure in BioWare romances (v by search hit only [sec]; check the exact reference before reuse).
  - Mawhorter, P., Mateas, M., Wardrip-Fruin, N. & Jhala, A. (2014). Towards a Theory of Choice Poetics. *FDG 2014*. https://cs.wellesley.edu/~pmwh/research/papers/towards-choice-poetics-fdg-2014.pdf (v)
  - Telltale's GDC 2013 account that only about 25% of players saved Doug versus 75% saving Carley, attributed to Carley having more earlier relationship-building scenes: GameInformer, https://www.gameinformer.com/b/news/archive/2013/03/28/telltale-why-fewer-people-saved-doug-in-the-walking-dead.aspx (v by search summary [sec])
- **Instance:** In many companion RPGs a gift raises approval by a preset amount with diminishing returns (fan guides; no scholarly source), so players can brute-force a romance. Replace with: closeness depends on what the player did *in the companion's own storylines* and on how the player treated the companion's bids.
- **Principles:**
  1. Players' attachment to a character is predicted by the count and quality of authored relationship moments with them (Telltale's Doug/Carley finding is the natural experiment), more than by the character's stated traits.
  2. A scalar approval number visible to the player produces more "optimising" behaviour (gift farming, reload to fix a bad answer) than an invisible or qualitative state.
  3. Approval changes that the player cannot attribute to a specific act are rated as unfair.
- **Failure modes:** Gift economies; opaque penalties; approval that gates content so players save-scum dialogue; characters whose opinion bears no relation to what they say.
- **Relevance:** Core; confidence high on the failure modes, medium on the replacement principles (little experimental work exists).
- **Surprise:** No, but the Telltale case is a rare piece of real data and is easy to overlook.

### F4. Romance arcs, consent and agency in interactive romance
- **Definition:** How games structure romance (availability, pursuit, scene gating, endings) and how consent, boundaries and player/character agency are designed and read.
- **Area:** 1
- **Why it matters here:** The engine may propose relationship content. A system that offers but never forces must have a model of refusal, boundary-setting by NPCs, and how the player can decline without penalty. Cyberpunk 2077 already ties romance to V's body type and side-quest chains, which constrains availability and invites the "playersexual" critique.
- **Key sources:**
  - Tomlinson (2024), above (v).
  - Tomlinson (2025), on agency, consent and trauma in Baldur's Gate 3, *Journal of Gaming & Virtual Worlds* (v by a search mention only [sec]; not read).
  - Inverse, interview on Baldur's Gate 3 romance craft: https://www.inverse.com/gaming/baldurs-gate-3-romance-sex-craft (v by search listing only; used for developer intent: romances can be refused by the companion, and the player is told to behave as themselves) [sec]
  - Cyberpunk 2077 romance structure is documented only in fan wikis and guides that I found; no CD PROJEKT RED design interview located. Do not cite those wikis as design intent.
- **Instance:** A companion declines a player's advance, in character, and the relationship continues with the refusal remembered but not punished by a lock-out.
- **Principles:**
  1. Offers that a companion can plausibly decline (with in-character reasons) are rated as more believable and not less enjoyable than universally accepted offers by the same player population (this tests the tension Tomlinson reports).
  2. When an NPC's boundary is a persistent trait, players' later requests that ignore it are rated as out-of-character if the game accepts them.
  3. Romance beats that the player can enter or leave at any rung without a "point of no return" prompt reduce reported pressure.
- **Failure modes:** Romance as a loot box for correct answers; availability hard-coded to a body type; refusal that reads as a parser error; the system *proposing* intimate content the player did not signal interest in (violates the "observe and offer" stance).
- **Relevance:** Core for any generated relationship content; confidence medium. The main empirical gap is user research, not theory.
- **Surprise:** No.

### F5. Computational social models: social practices, social physics and interactive-drama beats
- **Definition:** Authoring and simulation frameworks that model relationships and social norms as playable state: Façade's beat architecture, Comme il Faut / Prom Week's rule-based "social physics", Versu's social practices.
- **Area:** 1
- **Why it matters here:** The engine's relationships must be generated, not scripted for every pair. These systems show how to author social rules at the level of the culture (what is expected between a fixer and a mercenary) and let specific relationships fall out.
- **Key sources:**
  - Mateas, M. & Stern, A. (2005). Structuring content in the Façade interactive drama architecture. *AIIDE 2005*. https://cdn.aaai.org/AIIDE/2005/AIIDE05-016.pdf (v by search hit; abstract-level: hierarchy of story and behaviour pieces assembled in response to the player)
  - McCoy, J., Treanor, M., Samuel, B., Reed, A., Mateas, M. & Wardrip-Fruin, N. (2014). Social story worlds with Comme il Faut. *IEEE Transactions on Computational Intelligence and AI in Games* 6(2). (v by search; author list may vary by record, check before citing; the system uses roughly 5,000 social rules per a UCSC news item [sec])
  - Evans, R. & Short, E. (2014). Versu: a simulationist storytelling system. *IEEE TCIAIG* 6(2), 113-130. https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf (v)
- **Instance:** A "social practice" such as "asking a fixer for a favour" has roles, expected moves and norms; characters choose moves by utility, so a favour request from an unknown and one from a trusted ally play out differently without separate scripts.
- **Principles:**
  1. A relationship system built on shared practices produces NPC behaviour that human raters judge consistent with the setting's norms more often than one built on per-pair scripts of equal authoring cost.
  2. Rule counts above a few thousand without authoring tools produce rules authors can no longer reason about (testable via author debugging time).
  3. Characters that justify an action by citing a norm they hold are rated more legible than characters whose action is merely probable.
- **Failure modes:** Authoring burden; rules that generate behaviour with no narrative shape (Ryan's point, see F10); Versu itself was cancelled by its owner, so the production track record is thin.
- **Relevance:** Core; confidence high on the design lineage, medium on transfer to an open-world 3D game.
- **Surprise:** No.

### F6. Parasocial attachment to NPCs
- **Definition:** One-sided emotional bonds with media figures, applied to game characters who respond to the player but do not truly reciprocate.
- **Area:** 1
- **Why it matters here:** Players will form attachments to generated characters. The field says what drives attachment, what it does for the player, and where it shades into exploitation.
- **Key sources:**
  - Horton, D. & Wohl, R. R. (1956). Mass communication and para-social interaction. *Psychiatry* 19(3), 215-229. (m)
  - Elvery, G. (2023). Undertale's loveable monsters: investigating parasocial relationships with non-player characters. *Games and Culture* 18(4), 475-497. https://eprints.gla.ac.uk/271560 (v)
  - Findings on social anxiety and in-game romantic parasocial relationships, summarised at PsyPost: https://www.psypost.org/2024/02/social-anxiety-makes-young-women-more-prone-to-establishing-in-game-romantic-relationships-with-video-game-characters-221387 (secondary, [sec]; primary study not identified)
- **Instance:** A background NPC the player meets three times (a street vendor who remembers V's usual order) becomes a character the player visits on purpose.
- **Principles:**
  1. Repeated, small, remembered responsiveness from an NPC (naming, recall of a prior exchange) raises players' reported attachment more than one large authored scene of equal length.
  2. Attachment-driven return visits fall sharply if the NPC fails to recall something the player considers significant.
  3. Players disclose more to NPCs that have shown they remember earlier disclosures.
- **Failure modes:** Monetised parasocial hooks (a qualitative study of otome games reports transactional exploitation via gacha [sec]); manipulative loss ("missing" a companion for engagement); small self-selected samples dominate this literature.
- **Relevance:** Supporting; confidence medium. Mostly an ethical and expectation-setting lens.
- **Surprise:** No.

---

## Area 2: Theme and character change

### F7. Character-arc theory: change, flat and negative arcs
- **Definition:** Craft models in which a character's change is driven by a false belief confronted by pressure; the positive change arc (lie to truth), the negative arc (truth to lie or corruption), and the flat arc (the character holds a truth and changes the world).
- **Area:** 2
- **Why it matters here:** The engine will generate many small stories across a city. Character change over a run needs a model, and the flat-arc character matters because most NPCs in a living city are stable people who change others, not people who transform.
- **Key sources:**
  - Weiland, K. M. (2016). *Creating Character Arcs.* PenForASword. (v by search summaries of the three-arc framework [sec])
  - McKee, R. (1997). *Story.* ReganBooks. (m; character revealed through choice under pressure)
  - Truby, J. (2007). *The Anatomy of Story.* Faber & Faber. (m; need/desire/weakness structure and moral argument)
- **Instance:** A flat-arc character (a ripperdoc whose creed is "no one's disposable") shifts what V does by holding the line under pressure; a negative-arc character (a gang lieutenant) slides step by step across several runs of the engine's offers.
- **Principles:**
  1. Stories in which a character's changed choice under pressure shows the change are rated as more convincing than stories in which a stat or narration declares it.
  2. Treating stable NPCs as flat-arc forces (they pressure the world) yields more distinct NPC voices across a corpus than giving every NPC a transformation.
  3. Negative arcs delivered in at least three observable steps are rated as more believable than a single swing.
- **Failure modes:** Everyone arcs; arcs resolved when the player is absent; arc stage flagged but not shown by behaviour; craft books give mutually inconsistent advice with no empirical test.
- **Relevance:** Core; confidence medium. Practical writer's tools, not scientific results.
- **Surprise:** Yes. The flat arc is rarely modelled in generative narrative, which tends to default to transformation.

### F8. Procedural rhetoric and choice poetics: meaning carried by systems
- **Definition:** The claim that rules and procedures can make arguments (Bogost), and frameworks for how the shape of choices (what is offered, how outcomes are shown) shapes meaning (Mawhorter et al.).
- **Area:** 2
- **Why it matters here:** The engine cannot write a theme in prose for every story. It must carry theme in which options it offers, what they cost, and how consequence is shown. These frameworks say what a system can say.
- **Key sources:**
  - Bogost, I. (2007). *Persuasive Games: The Expressive Power of Videogames.* MIT Press. (v by search summaries: arguments made through authorship of rules)
  - Mawhorter et al. (2014), Towards a Theory of Choice Poetics (v); Mawhorter, P. et al. (2018). Choice poetics by example. *Arts* 7(3):47. https://www.doi.org/10.3390/ARTS7030047 (v by search hit; applies the framework to *Papers, Please*)
  - Jenkins, H. (2004). Game design as narrative architecture. In *First Person*, MIT Press; online at https://web.mit.edu/~21fms/People/henry3/games&narrative.html (v)
- **Instance:** A story about corporate dehumanisation offers V the efficient option each time and shows its cost only through downstream traces; the theme is carried by repeated offering and cost, not stated.
- **Principles:**
  1. Players state the intended theme of a generated story arc more often when the same cost structure recurs across three offers than when each offer has an independent cost.
  2. Offers whose costs are shown only by later traces are read as more thematic than offers with an immediate "morality" label.
  3. A theme cannot be carried by choices that carry no cost to the player; testable by comparing recall of themes between cost and cost-free variants.
- **Failure modes:** Rhetoric that contradicts the fiction (ludonarrative dissonance); players reading the system's argument as bugs; moralising meters.
- **Relevance:** Core; confidence medium.
- **Surprise:** No.

### F9. Storylets, quality-based and salience-based structures, and story curation
- **Definition:** Content-selection architectures that choose which small story to offer from state (qualities or salience), and the practice of picking out of a simulated world the sequences worth telling.
- **Area:** 2
- **Why it matters here:** It is the closest existing craft to what the engine does: a library of authored and generated pieces selected by world state. The literature records what keeps many small pieces coherent and what lets them drift.
- **Key sources:**
  - Short, E. (2016). Beyond branching: quality-based, salience-based and waypoint narrative structures. https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/ (v)
  - Kreminski, M. & Wardrip-Fruin, N. (2018). Sketching a map of the storylets design space. *ICIDS 2018*. (v by search; four dimensions: preconditions, repetition, content, selection architecture [sec]; discussed at https://emshort.blog/2019/01/06/kreminski-on-storylets/)
  - Ryan, J. (2018). *Curating Simulated Storyworlds.* PhD thesis, UC Santa Cruz. https://escholarship.org/uc/item/1340j5h2 (v)
  - Anchors and Ornaments model, "Between chaos and history", DiGRA Digital Library: https://dl.digra.org/index.php/dl/article/view/2781 (v by search; abstract-level only, fixed authored anchors with algorithmic variation)
- **Instance:** A "salience" scorer picks, among stories that fit, the one that references the most facts V has already established; authored anchor beats are fixed and the generator varies ornament around them.
- **Principles:**
  1. Offers selected by salience to the player's recorded history are rated as more "relevant to me" than offers selected by precondition match alone, at equal content quality.
  2. Raw simulation output without curation (Ryan) is rated less satisfying than curated output from the same world.
  3. Repeatable storylets without repetition rules produce players noticing sameness within a small number of plays.
- **Failure modes:** Content selection that drifts from any theme; variety that destroys continuity; combinatorial explosion in preconditions; curation that needs a human.
- **Relevance:** Core; confidence high. Largely the field the engine lives in; included here because the thematic-coherence question is its weakest part.
- **Surprise:** No.

### F10. Theme as a controlled variable: premise, moral argument, motif
- **Definition:** Craft practices that fix a story's governing idea first (Egri's premise, Truby's moral argument) and use recurring motifs to hold many scenes to it.
- **Area:** 2
- **Why it matters here:** For thematic coherence across many small stories the engine needs a theme representation it can check against, not just tags. Craft practice offers premise-first discipline and motif repetition as concrete constraints.
- **Key sources:**
  - Egri, L. (1946). *The Art of Dramatic Writing.* Simon & Schuster. (m; premise as a conclusion that drives the plot)
  - Truby, J. (2007), as above (m).
  - Park et al. and Short are not theme sources; no empirical study of theme coherence in generated narrative was located, which is itself a finding.
- **Instance:** The city's governing premise is "convenience eats consent". Each generated story is tagged with how it argues that premise (for it, against it, or complicating it); a per-region quota keeps the arguments from being all one-sided.
- **Principles:**
  1. A set of stories checked against a shared premise (each tagged as supporting, opposing or complicating) is rated as more thematically unified than an untagged set, while being rated as no less varied if the tags are balanced.
  2. Motifs reintroduced with a change (the same object in a different context) are noticed as thematic echoes at a higher rate than motifs repeated unchanged.
  3. A premise that is stated in dialogue more than once per story is rated as preachy.
- **Failure modes:** Moralising; premise so vague nothing can violate it; every story argues the same side; tagging errors by LLM or human.
- **Relevance:** Supporting; confidence medium-low. Strong craft tradition, little empirical backing, and no existing generator I could find that implements it.
- **Surprise:** Yes. Treating theme as a checkable constraint instead of tone is rarely attempted in the procedural-narrative literature I found.

---

## Area 3: Dread and anticipation

### F11. Suspense and anticipation psychology, with empirical horror-game affect
- **Definition:** Models in which tension arises from predictions about emotionally significant future events under uncertainty, from film theory (Hitchcock's bomb) through cognitive psychology to physiological studies of horror games.
- **Area:** 3
- **Why it matters here:** The engine can cause dread by announcing a threat early and delaying it. This field says which variables to control: what the audience knows, how certain it is, when release arrives.
- **Key sources:**
  - Lehne, M. & Koelsch, S. (2015). Toward a general psychological model of tension and suspense. *Frontiers in Psychology* 6:79. https://www.frontiersin.org/articles/10.3389/fpsyg.2015.00079/full (v)
  - Huron, D. (2006). *Sweet Anticipation: Music and the Psychology of Expectation.* MIT Press. (v by bibliographic hits; ITPRA: imagination, tension, prediction, reaction, appraisal)
  - Bordwell, D. (2013). Hitchcock, Lessing, and the bomb under the table. https://www.davidbordwell.net/blog/2013/11/29/hitchcock-lessing-and-the-bomb-under-the-table/ (v; notes the attribution is murkier than the legend)
  - Vachiratamporn, V. et al. (2013). Analysis of affective state transitions in survival horror games with player self-reports and physiological signals. JSAI 2013. https://www.ai-gakkai.or.jp/jsai2013/webprogram/2013/paper-987.html (v; preliminary: players already in a suspense state become fearful more often at a scare)
  - Graja, Lopes & Chanel (2021), *IEEE Transactions on Games*, P.T. demo and galvanic skin response (v by search summary only [sec]; check the exact reference).
- **Instance:** The player learns on a fixer's feed that a cyberpsycho was last seen in the district; the threat then does not appear for two in-game days while traces accumulate. The scare, if any, lands on a player who is already in suspense.
- **Principles:**
  1. Disclosing a threat before it acts produces higher rated tension than surprise appearance of the same threat, at equal exposure time (Hitchcock's claim, testable).
  2. The first confirmation that an anticipated threat is near produces more fear when the player was in a prior suspense state than when they were not (Vachiratamporn).
  3. Prolonged suspense without any release or resolution reduces rated satisfaction and eventually the tension itself.
- **Failure modes:** Sustained alert fatigue; delaying so long the player forgets; payoff that is smaller than the dread built; applying scares to a player who expects them and can brace.
- **Relevance:** Core; confidence high on the principle, medium on the specific numbers (the empirical studies are small, preliminary and lab-based).
- **Surprise:** No.

### F12. Unseen-threat directors: pacing and the menace gauge
- **Definition:** Systems that shape a threat's presence by a hidden tension estimate: Left 4 Dead's director raising and relaxing pressure, and Alien: Isolation's split between a macro director and a micro hunter that does not share the director's knowledge.
- **Area:** 3
- **Why it matters here:** An engine that "observes and offers" can use the same split: a director that knows where the player is and controls pressure, and an in-world threat that must find the player through the world. The player's sense of a hidden threat depends on the threat appearing to act on its own.
- **Key sources:**
  - Booth, M. (2009). The AI systems of Left 4 Dead. Valve, AIIDE keynote slides. https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf (v exists; goals include generating dramatic pacing; my search did not extract the intensity model)
  - Game Developer, "The perfect organism: the AI of Alien: Isolation" (Tommy Thompson, AI and Games): https://www.gamedeveloper.com/design/the-perfect-organism-the-ai-of-alien-isolation (v by search summary: menace gauge, director hints, backstage retreat [sec]; read the article before relying on specifics)
  - Game Developer, "Revisiting the AI of Alien: Isolation": https://www.gamedeveloper.com/design/revisiting-the-ai-of-alien-isolation (v by search listing)
- **Instance:** A hunter faction's patrols in a region follow their own rules; a hidden pressure estimate lowers their incursions after a high-pressure sequence, and raises hints (traces, rumours) before the next.
- **Principles:**
  1. Threat sequences that alternate pressure peaks with enforced relief periods are rated more intense than the same total threat delivered at constant pressure.
  2. A threat that must find the player (rather than know where they are) is rated as fairer and scarier, even if a director secretly gives it hints.
  3. When the director's help is detected by players (threats that "cheat"), ratings of fairness drop.
- **Failure modes:** Rubber-banding noticed as such; director overrides that break world consistency; pressure estimates that ignore player skill and state.
- **Relevance:** Core; confidence high on design pattern, medium on specifics (sources are secondary summaries).
- **Surprise:** Yes. The explicit separation of "director knows" from "threat knows" is an under-used trick for consistent in-world cause.

### F13. Environmental storytelling and the traces of an unseen cause
- **Definition:** Narrating by arrangement of space and objects so the player infers events that happened earlier or elsewhere.
- **Area:** 3
- **Why it matters here:** The player is never controlled and never told. A threat, a relationship or a past event is felt through what it left behind: damage, absence, changed routines. This is the staging vocabulary for "caused" and "legible" content.
- **Key sources:**
  - Carson, D. (2000). Environmental storytelling: creating immersive 3D worlds using lessons learned from the theme park industry. *Gamasutra.* (v by bibliographic mentions; original page not fetched)
  - Jenkins (2004), above (v): four modes of environmental storytelling (evoked associations, staging ground, embedded narrative information, resources for emergent narrative).
  - Environmental storytelling: an integrative review of storytelling through the environment in digital games. SBGames: https://sol.sbc.org.br/index.php/sbgames/article/view/45370 (v by search hit)
- **Instance:** A dive bar V frequents has its usual stool stacked on a table, a handwritten notice, and a regular's absence marked by their untouched drink order on the wall; no dialogue says the regular is gone.
- **Principles:**
  1. Players infer the correct cause from a trace set more often when the set contains at least two independent traces pointing to the same event than from one trace.
  2. Traces visible before the player knows what they mean raise later recall of the cause when it is revealed.
  3. A trace that contradicts the world's rules (impossible damage) lowers belief in the whole cause chain.
- **Failure modes:** Traces too subtle to notice; contradictory traces from independent generators; staging that costs more than the story is worth.
- **Relevance:** Core; confidence high. Directly aligned with the observe-and-offer stance.
- **Surprise:** No.

### F14. Foreshadowing, setup and payoff
- **Definition:** Planting a detail so that a later event reads as caused and fair, and managing the interval and the reader's awareness.
- **Area:** 3
- **Why it matters here:** The engine can plan or retro-fit setups: a generated event can be given prior traces so that it feels caused rather than arbitrary. Foreshadowing is the inverse of the "random event" complaint.
- **Key sources:**
  - Brewer, W. F. & Lichtenstein, E. H. (1982). Stories are to entertain: a structural-affect theory of stories. *Journal of Pragmatics* 6, 473-486. (m; suspense, surprise, curiosity arise from the ordering of events and disclosures)
  - Gerrig, R. J. (1993). *Experiencing Narrative Worlds.* Yale University Press. (v by catalogue hits; the book addresses why suspense recurs on rereading, not read today)
  - Lehne & Koelsch (2015), above (v).
- **Instance:** Before a pipe bursts in a district, the generator seeds three small signs in the preceding days (a maintenance notice, a smell reported by a vendor, a worker's complaint). The burst then reads as caused and V can claim the foresight.
- **Principles:**
  1. Events preceded by at least one earlier trace are rated as more "caused" than identical events with none.
  2. Foreshadowing that makes the outcome obvious cuts surprise but not satisfaction when the path to the outcome remains uncertain.
  3. Planted details that are never paid off lower trust in later planted details.
- **Failure modes:** Retro-fitting that the player can detect as such; over-planting (everything is a clue); unpaid setups; foreshadowing a branch the player later reloads away from (see F17).
- **Relevance:** Core; confidence medium-high on craft, medium-low on cited empirical evidence (my sources are theory).
- **Surprise:** No.

---

## Area 4: Saves, reloads and forgetting

### F15. The psychology of save-scumming
- **Definition:** Reloading to undo an unwanted outcome; research on why players do it and what it does to the weight of choice.
- **Area:** 4
- **Why it matters here:** Players can save, reload and branch at will. The engine must assume that the player may see two versions of any offer, and decide what it owes to each.
- **Key sources:**
  - Farmer, G. & Kelly, D. (2024). Save-scumming in role-playing games: a call for further psychological exploration. British Psychological Society. https://bps.org.uk/news/save-scumming-role-playing-games-call-further-psychological-exploration (v, fetched: little psychological research exists; competing views of it as protection against permanent loss and as weakening consequence; dialogue and combat reloading may serve different aims)
  - Farmer, G., Kelly, D. & Jones-Rincon, A. (2025). Save-scumming: a novel exploration of video game play. *DiGRA 2025 abstract proceedings.* https://dl.digra.org/index.php/dl/article/view/2509 (v, fetched; self-determination theory; preliminary UK and US data; no findings in the abstract)
  - Theses cited by the BPS piece: Bugnar & Persson (2021), quicksave and quickload effects on immersion; Handley (2021), fictional responsibility and morality in interactive fiction (cited by the BPS article; not read).
- **Instance:** A player reloads after a dialogue choice leads to a companion's anger. They are shaping a story and a relationship, not cheating; the same player reloads a combat to get better loot, which is a different motive.
- **Principles:**
  1. Players reload after a relationship penalty more often than after a combat loss of equal felt cost, and the former is more often motivated by wanting to keep the relationship (testable by reload logs and interviews).
  2. Making a consequence irreversible by design (no reload possible) is not required for it to be felt, if the player has no cheap way to see what the alternative branch would have given.
  3. Reload rates drop when outcomes are not visibly bad at the moment of choice (delayed or sideways consequences).
- **Failure modes:** Treating all reloading as cheating; punishing reload; a system that regenerates different content on reload and so lets players fish for the best version.
- **Relevance:** Core; confidence high on the question, low on the evidence (the field is small and preliminary).
- **Surprise:** No.

### F16. Reload-embracing and reload-resisting world designs
- **Definition:** Designs that make resets part of the fiction (roguelikes, time loops, persistent worlds) or that bind outcomes to a single timeline (permadeath, single-slot saves, save-erasing games).
- **Area:** 4
- **Why it matters here:** The engine has to choose a position: how its content behaves across a reload. These games are worked examples of both positions with documented craft.
- **Key sources:**
  - Barkman (University of Melbourne), PhD work on time loops and repetition with *Outer Wilds* and *Deathloop*: https://minerva-access.unimelb.edu.au/server/api/core/bitstreams/74607ce6-efaa-438c-b978-b386ba476faa/content (v by search hit; abstract-level)
  - Kasavin interviews on *Hades*, where each death advances the script and the team aimed to take the sting out of failure: https://inlander.com/culture/hades-writer-greg-kasavin-on-how-he-made-video-game-deaths-drive-a-feel-good-story-22725237 (v by search summary [sec])
  - Game Developer, "How Shadow Gambit: The Cursed Crew made save scumming a central mechanic": https://www.gamedeveloper.com/design/how-shadow-gambit-the-cursed-crew-was-able-to-make-save-scumming-a-central-mechanic (v by listing [sec])
  - Reverse Shot, "And the worlds go round" on diegetic time loops: https://reverseshot.org/features/2984/outer_wilds (v by search hit)
- **Instance:** *Outer Wilds* keeps only the player's knowledge across loops; *Hades* keeps relationship state and dialogue progress across deaths; a CP2077 mod or design could treat "reload" as nothing special, with the world re-derived from the save.
- **Principles:**
  1. In reload-embracing designs, what survives a reset (knowledge, relationships, unlocks) is the main carrier of meaning; designs whose carried state is visible to the player are rated as more coherent than ones where it is hidden.
  2. Designs that reward a reload with new information rather than a better outcome produce less "reload to fix" frustration.
  3. Content that is deterministic from the saved world state gives the same offer after a reload; the player's trust in "the world is real" is higher than with re-rolled content.
- **Failure modes:** Tonal mismatch between a heavy theme and a trivial reset; deterministic content that makes the system look scripted; punishing reloads with lockouts.
- **Relevance:** Core; confidence medium.
- **Surprise:** Yes. Principle 3 (derive offers from saved state, don't re-roll) is a cheap, testable design rule for the engine that falls out of treating reload as normal.

### F17. What players expect a world to remember: consequence legibility
- **Definition:** The evidence on how players read, anticipate and judge the carry-over of their choices, including backlash when the world appears to forget or to ignore them.
- **Area:** 4
- **Why it matters here:** The engine's "consequential" requirement depends on what counts as consequence to the player. This field records the failure cases (flat endings, invisible consequences) and one sort of positive proof.
- **Key sources:**
  - The Mass Effect 3 ending controversy: BioWare forum poll and commentary; a Missouri S&T news item reported players concluding their decisions did not matter: https://news.mst.edu/?p=18308 (v by search hit [sec]); the peer-reviewed study I hoped to find (listed in one search summary) was not located and should not be cited.
  - Mawhorter et al. (2014), choice poetics (v): consequence is part of how a choice's meaning is made.
  - Telltale choice statistics trailers and GDC 2013 commentary (v by search summaries [sec]); the statistics are developer-reported and one reviewer doubted them anecdotally.
  - Tomlinson (2024) on the tension between realism and control (v).
- **Instance:** A minor favour to a street vendor in act one returns as discounted gear in act three, with the vendor naming the favour; players cite it as proof the game "noticed".
- **Principles:**
  1. A consequence is credited to the player's choice only if the game names or visibly references the originating act; unnamed consequences are rated as accidents.
  2. Players reading a single missing or contradictory memory (an NPC forgets a major event) generalise to "the world forgets everything" more strongly than they generalise from a single correct memory.
  3. Consequences that arrive at different delays (immediate, session, far) are noticed at different rates; far consequences without a prior reminder are least often attributed.
- **Failure modes:** Fake consequences ("illusion of choice") found out by comparing branches, which reloading makes easy; memory debt (too many things to remember); over-reliance on dialogue acknowledgement.
- **Relevance:** Core; confidence medium. The empirical base is weak; much is forum and journalism evidence.
- **Surprise:** No.

### F18. Memory, decay and forgetting models for characters and worlds
- **Definition:** Human-memory science (power-law forgetting, need-probability, the "seven sins") and its use in agent architectures (memory streams with recency, importance and relevance), applied to deciding what a character or city remembers or lets go.
- **Area:** 4
- **Why it matters here:** The engine needs a principled rule for what NPCs remember and for how long, how recall errors can be used as characterisation, and when forgetting is a feature. Without a rule, memory is either total (omniscient NPCs) or arbitrary.
- **Key sources:**
  - Anderson, J. R. & Schooler, L. J. (1991). Reflections of the environment in memory. *Psychological Science* 2(6), 396-408. https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.1991.tb00174.x/ (v by search; retention follows frequency, recency and pattern of exposure; power-function forgetting)
  - Schacter, D. L. (1999). The seven sins of memory. *American Psychologist* 54(3), 182-203; and (2001) book of the same name. https://sites.harvard.edu/schacter-memory/files/2022/09/schacter1999.pdf (v by search hit)
  - Park, J. S. et al. (2023). Generative agents: interactive simulacra of human behavior. arXiv:2304.03442. https://arxiv.org/abs/2304.03442 (v; memory stream, retrieval by recency, importance and relevance, reflection; UIST venue from memory)
  - Ryan (2018), Talk of the Town: knowledge and its transmission between characters (v).
- **Instance:** A shopkeeper recalls V's big act (high importance) vividly for weeks, recalls the exact price paid vaguely, and mixes up which of two similar customers asked about a rumour; the errors are in character and traceable.
- **Principles:**
  1. Recall probability that follows a power-law decay in time since last use, boosted by importance, is rated as more "human" than uniform recall or a hard time-out.
  2. NPC misremembering that the player can correct (and that the NPC then updates) is rated as more charming than perfect recall, as long as the error is minor and in character.
  3. Forgetting that is silent to the player is rated as unfair when the forgotten thing was important to the player; a marker that an NPC "half remembers" prevents that.
- **Failure modes:** Misremembering that looks like a bug; importance scores that disagree with the player's own idea of significance; forgetting used to dodge authoring cost; false-memory features (suggestibility) causing contradictions with a saved timeline.
- **Relevance:** Core; confidence medium-high on the cognitive science, medium on transfer to games.
- **Surprise:** Yes. Anderson and Schooler's argument that forgetting tracks how likely something is to be needed again gives the engine a principled, non-arbitrary rule for decay.

### F19. Persistent personalised antagonists and the Nemesis lineage (including the patent constraint)
- **Definition:** Systems that remember the player's encounters with a specific hostile NPC and generate a personal history, grudges and promotions from them.
- **Area:** 4
- **Why it matters here:** It is the best-known shipped example of a world that remembers the player in a legible, consequential, personal way, and it works across deaths and reloads by design. It is also patented.
- **Key sources:**
  - Hoge, C. (2018). Helping players hate (or love) their Nemesis. GDC. https://www.gdcvault.com/play/1025150/contactUs (v as a listing; talk not viewed)
  - de Plater, M., Middle-earth: Shadow of Mordor postmortem, on feature creep and returning to the core promise of personal villains: https://gamebanshee.com/k3axd (v by search summary [sec]; a mirror, not the original venue)
  - US Patent 10,926,179, Warner Bros. Entertainment: "Nemesis characters, nemesis forts, social vendettas and followers in computer games"; press reports expiry in August 2036 and a filing in 2015: https://www.patentarcade.com/video-game-patent/US10926179/nemesis-characters-nemesis-forts-social-vendettas-and-followers-in-computer-games (v by search; claims not read; legal reading requires counsel)
- **Instance:** An enemy lieutenant who survives a fight comes back scarred, referencing the earlier encounter; the player experiences the grudge as theirs.
- **Principles:**
  1. Antagonists who reference a specific earlier encounter are rated as more memorable than equal-strength antagonists who do not.
  2. When a personalised antagonist's history is invisible to the player in the moment (no reference in speech or appearance), the benefit disappears.
  3. A small number of well-surfaced persistent antagonists produce more attachment than many thinly surfaced ones (postmortem's feature-creep lesson).
- **Failure modes:** Feature creep; repetitive barks; patent exposure for engines that copy the specific claimed mechanism; the system becomes the gameplay rather than serving a story.
- **Relevance:** Supporting; confidence medium. Valuable as a reference for legibility; the engine should independently design memory and avoid the patented specifics (the patent's scope is unread here; the project's own rule against licensed patents applies, so get a patent review before copying any structure).
- **Surprise:** Yes. The patent is a hard constraint on a design everyone would otherwise copy.

---

## Considered and rejected

- **Dunbar-number and network-size research on friend counts:** interesting for NPC ties but too far from the engine's decisions.
- **Persona-style social links and Fire Emblem supports as a separate field:** covered by F3 and F2; no extra sources found that were better than the design-pattern level.
- **Attachment theory (Bowlby, Ainsworth) in adult relationships:** relevant for characterisation, but I could not frame a testable engine principle beyond F2.
- **Interactive-drama manager research (Riedl, Young, Roberts and Isbell) as a dread/pacing field:** belongs to a drama-management lens; assumed covered elsewhere.
- **Horror theory (Carroll's *Philosophy of Horror*, Lovecraft, Kristeva's abjection):** literary and philosophical value, but weak mapping to testable engine principles; kept only the suspense psychology (F11).
- **Ludonarrative dissonance as its own field:** folded into F8's failure modes.
- **Permadeath studies in roguelikes as a separate field:** folded into F16 because I found no empirical sources distinct from design commentary.
- **Fear-of-missing-out and loss aversion research:** relevant to reload and consequence but I could not tie a source to the setting without speculation.
- **Dwarf Fortress characterisation (Adams, "Characterization and Emergent Narrative in Dwarf Fortress"):** found at a mirror (wileywiggins.com); relevant to F5 and F9, but I did not read it in full and did not give it its own entry.
- **Cyberpunk 2077 romance design interviews:** searched for CD PROJEKT RED sources and found only fan wikis and forums; no usable design-intent source, so no field built on them.
- **Mass Effect 3 ending peer-reviewed study:** one search summary suggested an article in *Bulletin of Science, Technology & Society*; I could not confirm it and left it out as a source.
