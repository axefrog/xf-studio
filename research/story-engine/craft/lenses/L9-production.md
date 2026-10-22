# Lens L9: production

> Raw lens output, kept as provenance for the [discipline map](../map.md). Its claims are unverified unless marked otherwise. Its patent remarks are out of scope: the Story Engine does no patent searches for its own ideas ([D-20](../../decisions.md)).

**Method note.** Researched on 22 October 2026 with web search and page fetch only (no repository access, no sub-agents): about 70 searches and 65 page fetches covering CD PROJEKT RED (quest process, dialogue generator, localisation, facts system), Bethesda (Radiant Story), Obsidian, Larian, BioWare and Ubisoft (branching cost, Watch Dogs: Legion), Valve (response system, AI Director), inkle, Failbetter and Emily Short (storylets), Supergiant, Looking Glass, Ion Storm and Arkane (immersive-sim postmortems), environmental storytelling, QA of branching content, localisation, content economics, the Cyberpunk and Skyrim/Witcher modding communities (Nexus, RED Modding wiki) and professional attitudes to generative AI (GDC 2026 survey). The GDC Vault was mostly unreachable (maintenance or login wall), so many talks are known only through their abstracts and third-party write-ups; several publisher and wiki pages returned 403. Rockstar has published almost nothing usable on mission or stranger design. A claim that rests only on a search-result summary, with the page itself unread, is tagged `[sec]`. Vendor marketing is labelled as such. Where I could not verify a figure I say so rather than fill the gap, and the biggest gap is a trustworthy "cost of a minute of quest": no studio publishes one.

---

## Fields

### 1. Staged quest production (pitch, design doc, rough playable, write-in)
- **Definition:** The studio pipeline by which many cheap half-page pitches are filtered into a few fully specified quests, each built first as a rough playable with placeholder dialogue, with writers attached after approval.
- **Why it matters here:** The system must accept authored fragments that are "precise or vague" and promote them. CDPR's pipeline is a worked model of how a vague unit (a pitch) becomes a precise one (a screenplay-like design doc) and then a playable one, and it shows where the human selection filter sits. It also shows which stages a procedural engine could plausibly take over (pitch volume, placeholder passes) and which professionals keep human (selection, final lines).
- **Key sources:**
  - Philipp Weber's 2019 CDPR forum Q&A as reported in [Game World Observer](https://gameworldobserver.com/2019/09/13/quests-witcher-cyberpunk-2077) and [WN Hub](https://wnhub.io/news/marketing/item-2371).
  - Paweł Sasko on pitch acceptance (PC Gamer interview, relayed by [80.lv](https://80.lv/articles/cd-projekt-red-reveals-the-secret-key-to-impressive-side-quests)).
  - Sasko, [GamePressure interview](https://www.gamepressure.com/editorials/interview-with-cd-projekt-reds-lead-quest-designer-pawel-sasko/zd661).
  - Sasko, "10 Key Quest Design Lessons from The Witcher 3 and Cyberpunk 2077", GDC 2023 ([Game Developer summary](https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3); [GDC Vault listing](https://gdcvault.com/play/1028897/10-Key-Quest-Design-Lessons)).
- **Instance:** Cyberpunk 2077: hundreds of half-page pitches, the best becoming design documents of at least ten pages that read like screenplays without final dialogue (sections such as SCENE, EXPLORATION, PLAYSTYLES); a rough playable with general dialogue outlines is built before writers finish lines; a coordinator tracks everything in a production tool. Sasko puts a good designer's acceptance rate at 5 to 10 per cent, and says a story outline can be "barely a few sentences".
- **Principles:**
  1. A half-page pitch is enough information to decide whether to build; detailed design should start only for the survivors. (Test: pitch-to-document ratio near 10 to 20 to 1 in a working studio; for the engine, a stored "pitch tier" that carries no commitment.)
  2. Each variant axis multiplies cost: companion and lifepath variants meant big parts of some quests were implemented twice. (Test: count built nodes per variant axis; the cost should scale multiplicatively, not additively.)
  3. A rough playable with placeholder dialogue lets structure be judged before writing is paid for. (Test: structural rework found after text is written should be rarer in this order.)
- **Failure modes:** It depends on a large pool of pitchers and a taste-based filter; a 5 to 10 per cent hit rate means roughly 10 to 20 times oversupply, and a procedural proposer has no equivalent taste. Mod authors have no team, no coordinator and no review. Sasko's own "main and side quests cost about the same" ([WN Hub](https://wnhub.io/news/engines/item-51284), relaying an X post) sits awkwardly beside the "smallest budgets" framing in the 80.lv piece, so treat cost parity claims as one person's account. The Weber process description is pre-release (2019); a Digital Citizen report says CDPR later moved from a waterfall-like process to cross-discipline "pods" `[sec]`.
- **Relevance:** core (high confidence for the shape of pack tiers).
- **Surprise:** no.

### 2. Quest vocabularies and pattern catalogues
- **Definition:** Shared vocabularies, taxonomies and named structural patterns for quests and choice structures, from academic quest theory to practitioner catalogues.
- **Why it matters here:** Authored packs "precise or vague" need a schema, and the engine needs names for what it is fitting. These catalogues give tested vocabulary (purpose, structure, space, actor, challenge) instead of an invented one, and show which structures are cheap or collapse without volume.
- **Key sources:**
  - Aarseth, "From Hunt the Wumpus to EverQuest: Introduction to Quest Theory", Entertainment Computing, ICEC 2005, LNCS 3711, pp. 496-506, DOI 10.1007/11558651_48 `[sec]`.
  - Howard, *Quests: Design, Theory, and History in Games and Narratives* (A K Peters, 2008), organised around spaces, objects, actors and challenges `[sec]`.
  - Smith et al., "Situating Quests: Design Patterns for Quest and Level Design in Role-Playing Games" (ICIDS 2011; repository at rpgpatterns.soe.ucsc.edu, which I could not reach) `[sec]`.
  - Ashwell, ["Standard Patterns in Choice-Based Games"](https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/) (2015).
  - Yu, Guzdial and Sturtevant, ["The Definition-Context-Purpose Paradigm and Other Insights from Industry Professionals About the Definition of a Quest"](https://arxiv.org/abs/2110.04148) (arXiv 2110.04148, 2021).
- **Instance:** Yu et al. interviewed 15 developers (BioWare, Bungie and Ubisoft among them): no consensus definition of "quest", but purpose (guiding the player, telling the story, providing content, teaching rules, driving progression) was more useful to designers than a list of elements. Ashwell names Time Cave, Gauntlet, Branch and Bottleneck, Quest, Open Map, Sorting Hat, Floating Modules and Loop and Grow. Failbetter reportedly identified sixty named narrative patterns within a year of launch, including "Faust" and "Carousel" ([IF50 essay](https://if50.substack.com/p/2009-fallen-london)). The game's own shipped vocabulary is visible in the [RED Modding quest ID list](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/references-lists-and-overviews/reference-quest-ids.md): Main, Side, Minor, Street Stories, CyberPsychos, Contract, Vehicle, Courier.
- **Principles:**
  1. Practitioners classify quests by purpose and context more usefully than by element lists. (Test: ask authors to tag a sample of quests by purpose; agreement should beat agreement on element-based tags. Yu et al. found no clusters in free definitions, so the schema should carry an explicit purpose field.)
  2. Pattern-instantiated scripting reduces plot-scripting errors versus hand-written scripts. (Trenton's University of Alberta MSc thesis on ScriptEase quest patterns, [abstract](https://ualberta.scholaris.ca/handle/123456789/75314): two user studies report substantially fewer errors; the abstract gives no numbers.)
  3. "Floating modules" structures need a large amount of content or they collapse into a linear sequence. (Ashwell; test: measure the share of runs whose path is identical as module count falls.)
- **Failure modes:** Academic catalogues skew to CRPG and MMO quests and to scripting, not to what makes a quest good; one review calls Howard's book outdated `[sec]`. Patterns describe structure, not quality. Developers themselves disagree on what a quest is, so a rigid taxonomy will not fit every pack.
- **Relevance:** core (medium-high confidence).
- **Surprise:** yes.

### 3. Storylets, quality-based narrative and salience-based narrative
- **Definition:** Content as small, self-contained units, each with a prerequisite and an effect on world state, selected at runtime by what is eligible (quality-based, player picks) or what fits best (salience-based, system picks).
- **Why it matters here:** This is the closest mature craft to "a procedural engine fits authored content into the world": the author writes the unit and its conditions, the engine decides when it plays. It also names the pitfalls: thin libraries, lost causal chains, ill-timed picks.
- **Key sources:**
  - Short, ["Beyond Branching: Quality-Based and Salience-Based Narrative Structures"](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/) (2016) and ["Storylets: You Want Them"](https://emshort.blog/2019/11/29/storylets-you-want-them/) (2019).
  - Kreminski and Wardrip-Fruin, "Sketching a Map of the Storylets Design Space", ICIDS 2018 `[sec]`.
  - [Yarn Spinner docs: storylets and saliency](https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/storylets-and-saliency-a-primer).
- **Instance:** Per an [IF50 essay](https://if50.substack.com/p/2009-fallen-london), Fallen London launched with about 10,000 words, passed a million by 2014 and has grown since; Yarn Spinner node groups use `when:` conditions and a recommended "Random Best Least Recently Viewed" strategy that favours the best fit while reducing repeats, and the docs say line groups suit barks.
- **Principles:**
  1. A storylet library feels unrewarding until it is large. (Short; Failbetter; Ashwell on floating modules. Test: playtest sessions against library size.)
  2. Without an arc check, a salience system will occasionally choose a badly timed beat (Short names a premature ending). (Test: log selections against a pacing model and count mis-timed picks.)
  3. Least-recently-viewed selection among near-equal candidates lowers perceived repetition. (Yarn Spinner's default; test: blind A/B on repeat complaints.)
- **Failure modes:** Multi-step arcs need heavy manual bookkeeping of quality values; players lose track of chains they assembled; weights are tuned by trial and error and are hard to test; "time caves" (non-recombining branches) cost the benefits. The term "storylet" is itself disputed `[sec]`.
- **Relevance:** core (high).
- **Surprise:** no.

### 4. Rule databases and contextual dialogue (barks)
- **Definition:** A database of rules, each a set of criteria over world facts, mapped to a response; the most specific matching rule wins and general rules are fallbacks.
- **Why it matters here:** Street encounters and ambient talk need thousands of small reactive lines that must stay correct as the world changes. Valve's design lets writers add a more specific line for a case without editing anything else, and the same pattern could select between competing authored fragments.
- **Key sources:**
  - Ruskin, "AI-Driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012 ([GDC Vault](https://gdcvault.com/play/1015317/AI-driven-Dynamic-Dialog-through); not viewable).
  - Short's write-up, ["GDC 2012 Talk on Dynamic Dialogue"](https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/).
  - ["Rule databases for contextual narrative"](https://www.blog.radiator.debacle.us/2012/07/rule-databases-for-contextual-narrative.html?m=1) (Radiator blog, 2012).
  - Thief postmortem on "Tagged Schema" ([Game Developer](https://www.gamedeveloper.com/design/postmortem-i-thief-the-dark-project-i-)); the open-source Rust re-implementation [Mimir](https://github.com/subtalegames/mimir) `[sec]`.
- **Instance:** Left 4 Dead 2: lines are matched to a changing world state, most specific rule first; Ruskin's argument was that writers' tools matter as much as the matching. Thief's earlier Tagged Schema chose sounds and motions by concept, tags and weighted randomness without code changes.
- **Principles:**
  1. New specific rules do not require edits to existing rules, and unmatched cases fall back safely. (Test: add a rule and run the old corpus; outputs change only where the new criteria match.)
  2. Vague, easily met conditions yield generic events that players find static (Radiator). (Test: rate specificity of conditions against player-reported repetition.)
  3. The difficulty moves from programming to authoring: if the result feels wrong, the conditions or the line were poorly chosen.
- **Failure modes:** Characters react but do not plan or pursue goals through speech (Short); long arcs and cross-scene consistency are not expressible; specificity ordering can be gamed or accidentally shadowed; testing is by sampling, not proof.
- **Relevance:** core (high).
- **Surprise:** yes.

### 5. Persistent run-based narrative delivery (Hades)
- **Definition:** A very large pool of voiced lines, gated by game state and spread over repeated loops, so that story beats are delivered opportunistically and repeats stay rare.
- **Why it matters here:** The engine must deliver authored story beats at a moment the world makes plausible and not bury them in filler; Hades is the best-known case of a small team doing this at scale.
- **Key sources:**
  - Kasavin and Korb, "Breathing Life into Greek Myth: The Dialogue of Hades", GDC 2021 ([GDC Vault](https://gdcvault.com/play/1026975/Breathing-Life-into-Greek-Myth)).
  - [GeekDad: Kasavin on Hades' development](https://geekdad.com/2019/10/narrative-and-early-access-supergiants-greg-kasavin-discusses-hades-development/) (2019).
  - [Game Developer podcast summary](https://www.gamedeveloper.com/design/roguelikes-and-narrative-design-with-i-hades-i-creative-director-greg-kasavin).
- **Instance:** The GDC abstract credits a studio of fewer than 20 with a fully voiced game of more than 22,000 lines `[sec]`. GeekDad reports gods reacting to which gods were met earlier in the run, the writer authoring many contexts per character, and lines designed so a repeat is unlikely to be noticed for something like 20 to 30 loops.
- **Principles:**
  1. Story beats can be released in any order if each carries its own state requirements. (Test: shuffle delivery order in simulation and check no beat references unseen facts.)
  2. Releasing content in increments and watching reaction improves tone calibration (early access updates every one to two months).
  3. Optional, seemingly low-stakes content is worth including because designers cannot predict which pieces land.
- **Failure modes:** I could not verify the exact selection mechanism (priority order, once-only flags); do not assume it. Volume came from paid voice work, which this project cannot use. The loop structure makes repetition natural; an open-world city does not.
- **Relevance:** supporting (medium-low confidence).
- **Surprise:** no.

### 6. Radiant Story: templated quests with role aliases and a Story Manager
- **Definition:** Bethesda's system in which authored quest templates have aliases (slots for locations, actors, items) filled at run time under conditions, and a Story Manager fires quests in response to world events.
- **Why it matters here:** It is the shipped precedent for "the engine fits authored content into the world", and its designer wrote down what went wrong. Its shortcomings (location-only variation, thin story) are exactly what content "must not feel generated" is up against.
- **Key sources:**
  - Nesmith, Game Design Expo lecture (Vancouver Film School, 21 January 2012), reported by [VentureBeat/GamesBeat](https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/).
  - [Straight.com feature on Radiant Story](https://www.straight.com/node/35562).
  - Creation Kit documentation of Radiant Story and quest aliases ([UESP CK wiki](https://ck.uesp.net/wiki/Radiant_Story); 403 to me, summary only `[sec]`).
  - Critical reception of Fallout 4's settlement and Minutemen radiant quests `[sec]` (Steam and Nexus forum threads; no single authoritative page).
- **Instance:** Per Nesmith: the team began by defining about 30 player actions and how the world could react; job quests were limited to fitting NPCs such as innkeepers; custom dialogue was written per NPC voice type to cut repetition; conditioning limits were expanded to stop events recurring; players tired of non-story job quests so more custom content was made; using it for the main quest "would play horribly". Mechanically, aliases are fixed or filled from lists or leveled lists under conditions, the Story Manager reacts to events such as a change of location, and selection biases towards places the player has not visited `[sec]`. An early failure sent the player across the map to clear rats from a basement `[sec]`.
- **Principles:**
  1. Templated quests need a fit test between role and filler (the innkeeper rule). (Test: audit fills for role plausibility; rejection rate before and after adding the test.)
  2. Keep templated content off the spine of the story; reserve authored beats for the arcs that matter.
  3. Variation in location alone does not read as variety; the objective, stakes or NPC reaction must also vary. (Test: players asked to say whether two quests were "the same" after only the place changes.)
- **Failure modes:** Fallout 4's settlement quests became a byword for repetition `[sec]`; the system decides on boundaries such as location change, so it fits sparse event streams, not a continuously simulated city; the source is a single lecture write-up plus wiki summaries.
- **Relevance:** core (high).
- **Surprise:** no.

### 7. Role casting and persona layers
- **Definition:** Authored events are written as plays with roles; a procedural population is cast into the roles at runtime by personality or tags, with inline variation markup and a small authored "anchor" cast supplying continuity.
- **Why it matters here:** The engine will cast simulated people into authored story roles. Wildermyth and Watch Dogs: Legion document the two tuning knobs (casting strictness; what writers may assume) and the writer workflow needed.
- **Key sources:**
  - Nate Austin on [Wildermyth](https://turnbasedlovers.com/10-turns-interview/with-wildermyth-developer) (Turn Based Lovers interview).
  - [Game Developer on Legion's narrative authoring](https://www.gamedeveloper.com/marketing/how-i-watch-dogs-legion-i-made-ubisoft-rethink-its-storytelling).
  - Dragert, "Census: The Systemic Backbone Behind Play As Anyone in Watch Dogs: Legion", GDC 2021 ([GDC Vault](https://gdcvault.com/play/1027018/Census-The-Systemic-Backbone-Behind)); [Ubisoft article](https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london).
  - Evans and Short, "Versu: A Simulationist Storytelling System", IEEE TCIAIG, 2014 (real paper; not opened this session).
- **Instance:** Wildermyth: each event is written like a play with defined roles (a leader, a hothead and a goofball, say); the game casts heroes into the roles by personality, and writers vary lines inline by personality or relationship (the developer calls this "opportunistic variation"). Legion: 20 personas (doubled from 10 to cover London's accents and dialects) adapt mission scripts; a mission writer drafts, persona writers adapt, the mission owner revises; recruitment missions are written as one-off stories about the recruit; anchors (authored, mostly non-playable antagonists and allies) give the procedural cast shared goals.
- **Principles:**
  1. Casting constraints that are too tight mean most events never fire; too loose and roles blur. (Wildermyth; test: sweep strictness and plot fire-rate against role distinctiveness.)
  2. Writers cannot reference traits they cannot guarantee; text must degrade gracefully when an attribute is unknown.
  3. A small authored cast with fixed goals is needed to hold procedurally populated stories together. (Legion's early fully procedural prototypes "lacked story momentum".)
- **Failure modes:** Wildermyth's developer says procedural plot is very hard and that attempts stalled at concept stage; Legion needed heavy writer coordination; Nemesis-style "remembering" characters are patent-encumbered (field 25).
- **Relevance:** core (medium-high).
- **Surprise:** yes.

### 8. Director and storyteller pacing systems
- **Definition:** A system that watches the player's recent experience and meters the frequency of events (threats, relief, incidents) to shape pacing, without altering how hard any single event is.
- **Why it matters here:** A city with many hand-made fragments needs something to decide *when* each may intrude. The pacing logic in Left 4 Dead is simple, published and tested.
- **Key sources:**
  - Booth, "The AI Systems of Left 4 Dead", Valve, 2009 ([slides, Valve CDN](https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf); readable copy on [ReadKong](https://www.readkong.com/page/the-ai-systems-of-left-4-dead-michael-booth-valve-9664541)).
  - [Game Developer on RimWorld's storyteller](https://gamedeveloper.com/design/how-i-rimworld-i-fleshes-out-the-i-dwarf-fortress-i-formula).
  - Short on the need for a dramatic-arc check ([Beyond Branching](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/)).
- **Instance:** Left 4 Dead: per-survivor intensity rises with damage and incapacitation, decays over time, the Director uses the maximum across the team, and the phases are Build Up, Sustain Peak (3 to 5 s), Peak Fade and Relax (30 to 45 s or until the team has moved on). Boss events are exempt. Automated survivor bots enabled stress tests with accelerated game time. RimWorld's storyteller picks events from a categorised database using a few statistics and eases off when the colony shrinks.
- **Principles:**
  1. A deliberately crude intensity estimate plus a phase machine produces workable pacing. (Booth: "crude, yet the resulting pacing works"; test: compare against a richer estimator in blind playtests.)
  2. Pacing (frequency) can be separated from difficulty (amplitude), so authored encounters keep their intended strength.
  3. Authored set pieces are better exempted from the modulator than modulated.
- **Failure modes:** Built for four-player, half-hour campaigns where intensity is mostly combat; an open-world city has no equivalent single signal. Directors regulate pressure, not plot; one of RimWorld's storyteller presets is described as deliberately unfair `[sec]`. Needs an arc check for narrative content (Short).
- **Relevance:** core (medium-high).
- **Surprise:** yes.

### 9. Player-attention arbitration and mission scheduling
- **Definition:** One arbiter to which every system submits requests for the player's attention, each stating its type, importance, the attention it needs and how long it can wait; the arbiter releases the highest-priority request when the player is ready and rate-limits by type.
- **Why it matters here:** The engine will add its own content to a world that also contains authored quests. Without arbitration, a generated side event lands on a cliffhanger. Ubisoft shipped this fix and described it.
- **Key sources:**
  - [Ubisoft Toronto: "Watch Dogs: Legion and the Player Attention System"](https://toronto.ubisoft.com/watch-dogs-legion-and-the-player-attention-system/) (Jurie Horneman).
  - [Ubisoft news article on Legion's tools](https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london).
  - Bethesda's Story Manager as the earlier analogue (Creation Kit documentation `[sec]`).
- **Instance:** Legion started missions without a quest giver; each mission checked its own timer and collided (a side mission after a cliffhanger). Fix: requests describe type, importance, attention aspects and maximum wait; the arbiter watches what the game presents (restricted areas, pursuit, cut-scenes, menus, being indoors, proximity to a tracked objective); missions wait, short-lived requests such as team banter are rejected and retry; per-type timers (for example one mission a minute); requests can waive specific aspects. It also fixed contextual dialogue timing.
- **Principles:**
  1. A single shared arbiter beats per-system timing logic. (Test: count collisions between systems before and after.)
  2. Requests that declare their own exceptions need no special-case code in the arbiter.
  3. Short-lived requests should be rejected rather than queued; stale chatter is worse than silence.
- **Failure modes:** The arbiter infers attention from what the game presents, not from the player; tuning came from playtests. It assumes a single player-facing channel; a modded layer cannot reorder another mod's content unless that content opts in.
- **Relevance:** core (high).
- **Surprise:** yes.

### 10. Systemic cinematic dialogue generation
- **Definition:** A generator that turns a conversation script (and, at CDPR, the recorded audio) into a first-pass scene of cameras, idles, gestures and look-ats from shared libraries, which designers then refine.
- **Why it matters here:** The system has no new voice acting and little new animation. CDPR's Witcher 3 solution shows how most dialogue in a large RPG was staged from reusable parts, reserving bespoke scenes for peaks.
- **Key sources:**
  - Tomsiński, "Behind the Scenes of Cinematic Dialogues in The Witcher 3: Wild Hunt", GDC 2016 ([GDC Vault](https://gdcvault.com/play/1022988/The-Witcher-3-Wild-Hunt); third-party summary at [GameAnim](https://www.gameanim.com/?p=10962)).
  - [VULKK write-up](https://vulkk.com/2017/08/09/get-behind-scenes-cinematic-dialogues-witcher-3/) and [TweakTown](https://www.tweaktown.com/news/51166/cdpr-reveals-science-behind-witcher-3s-dialogue-animations/index.html) (both 403 to me; summaries only `[sec]`).
  - CDPR's description of the Cyberpunk 2077 "Scene System" (John Mamais, 2019, as reported by [GamingBolt](https://gamingbolt.com/cyberpunk-2077-developer-talks-about-the-games-interactive-and-fully-immersive-cutscenes) `[sec]`).
- **Instance:** As summarised by GameAnim: over 35 hours of dialogue, 2.5 hours of true cutscenes, 1,463 systemic dialogues; about 2,400 dialogue animations shared across characters; 35 idle variations per skeleton type; generator inputs are the voice-over audio, camera rules (180-degree rule, establishing shots) and idle groupings by mood or status; re-running gives a different result and shots can be swapped from a menu; a simple scene could take minutes; event timing is scaled as a percentage of scene length so localised lines still fit (a 12-second English scene ran 14 seconds in French); a "Deny Area" keeps wandering NPCs out of a scripted scene.
- **Principles:**
  1. A generator fed by line timing, camera rules and shared idle and gesture libraries can produce a usable first pass for most conversations; true cutscenes are reserved for peak moments. (Test: share of scenes shipped with only light edits.)
  2. Scene timings expressed relative to line length survive translation and re-recording.
  3. Staging must exclude ambient NPCs from the scene volume.
- **Failure modes:** The Witcher generator parses recorded audio; with no new recording the timing source must come from text length or synthetic timing. The reusable libraries (about 2,400 mocap animations) are what made it work; I found no public description of Cyberpunk's equivalent tooling; that it reuses the same generator is plausible but unconfirmed `[sec]`. Results can look uniform.
- **Relevance:** core (medium-high).
- **Surprise:** yes.

### 11. Text-forward reactive scenes
- **Definition:** Short passages of prose with stat- or skill-gated options, used in place of cutscenes to deliver reactivity, context and consequence cheaply.
- **Why it matters here:** The brief is "mostly text, systems and environment". Obsidian, Failbetter and CDPR all use text where cinematics would be too costly, and CDPR notes it can be added late.
- **Key sources:**
  - [PC World preview of Pillars of Eternity](https://www.pcworld.com/article/439895/pillars-of-eternity-preview-spiritual-successor-to-rpg-classics-turns-promise-into-game.html) (scripted interactions; Sawyer paraphrased).
  - Sasko, [GamePressure interview](https://www.gamepressure.com/editorials/interview-with-cd-projekt-reds-lead-quest-designer-pawel-sasko/zd661) (data shards added late, no voice recording).
  - [IF50 essay on Fallen London](https://if50.substack.com/p/2009-fallen-london).
  - Disco Elysium's skill-voice dialogue, where 24 skills speak in the player's head (secondary coverage `[sec]`, for example [Wikipedia](https://en.wikipedia.org/wiki/Disco_Elysium)).
- **Instance:** Pillars of Eternity's "scripted interactions": a short text description with a still illustration and choices that depend on stats or skills, used to avoid costly cutscenes while conveying information that would not make sense in engine. Sasko says Cyberpunk's text shards and messages can be added late because they need no voice recording, though he suspects there were too many.
- **Principles:**
  1. A text moment with gated options delivers reactivity at a fraction of cinematic cost. (Test: authoring hours per reactive variant versus a scripted scene.)
  2. Text suits events that cannot be staged in engine and suits late additions. (Sasko.)
  3. Volume has a ceiling: players noticed and tired of an excess of shards.
- **Failure modes:** Reading load; players of a voiced game may skip text; some reviewers found heavy text slow `[sec]`. In a modded Cyberpunk, surfacing text needs UI work through the mod frameworks rather than a native journal slot.
- **Relevance:** core (medium-high).
- **Surprise:** no.

### 12. Environmental storytelling and set-dressing vignettes
- **Definition:** Staging a space so that a player can reconstruct what happened from props, layout and traces, without exposition.
- **Why it matters here:** Street encounters and heists will be staged in the world by the engine; the craft tells it what a readable, "authored-feeling" vignette contains and what a bad one looks like.
- **Key sources:**
  - Carson, "Environmental Storytelling: Creating Immersive 3D Worlds Using Lessons Learned from the Theme Park Industry", Gamasutra, 2000 `[sec]`.
  - Worch and Smith, "What Happened Here? Environmental Storytelling", GDC 2010 ([GDC Vault](https://gdcvault.com/play/1012647/What-Happened-Here-Environmental); [Nieman Storyboard summary](https://niemanstoryboard.org/2011/01/14/harvey-smith-on-environmental-storytelling-and-embedding-narrative/); [slide deck mirror](https://slidetodoc.com/level-design-workshop-what-happened-here-environmental-storytelling/)).
  - Gaynor, "Why Is Gone Home a Game?", GDC 2014 `[sec]`.
  - CDPR on Night City: [80.lv](https://80.lv/articles/interview-how-cyberpunk-2077-s-night-city-was-built-almost-entirely-by-hand/) (hand placement) `[sec]`.
- **Instance:** Smith's "pull narrative" example: a cave with a body, prospector gear, fallen rock and a shaft of light implies a miner's fatal fall. Techniques from the slides: a discernible chain of events, each event engaging, echoes of the premise, characterisation, minimal disconnects with what the player can do; "systemic" environmental storytelling means persistent traces of the player's actions (Colantonio: players remember coming back to "see your own mess").
- **Principles:**
  1. A vignette should contain a discernible chain of events, not one prop. (Test: show screenshots to players and score whether they reconstruct the intended sequence.)
  2. Players must be allowed to miss it; a pulled story is self-paced. (Test: placement should not force a camera pan.)
  3. Anonymous environmental moments are missed opportunities; each should echo the premise. (Smith.)
- **Failure modes:** Procedural placement tends to produce incoherent clutter unless the vignette is authored as a unit; art cost is high (CDPR placed Night City's detail largely by hand `[sec]`); interpretations vary between players.
- **Relevance:** core (high).
- **Surprise:** no.

### 13. Open-world activity design and "checklist" fatigue
- **Definition:** The craft and critique around map-icon activity lists, point-of-interest rhythm and repetition in open worlds.
- **Why it matters here:** "Passing street encounters" are exactly the content type where repetition kills the sense of a living city, and the engine will produce volume. This field is where fatigue is documented, though largely by critics.
- **Key sources:**
  - Weber and Sasko on CDPR's "no checklist" stance ([Game World Observer](https://gameworldobserver.com/2019/09/13/quests-witcher-cyberpunk-2077)).
  - Opinion pieces: [Exputer](https://exputer.com/features/prince-of-persia-the-lost-crown-ubisoft-formulaic/) and [Inverse](https://www.inverse.com/gaming/star-wars-outlaws-planets-size-ubisoft-open-world) on Ubisoft's formula; weak, not developer statements.
  - Bergeron (Ubisoft Montreal), "360 Approach for Open World Mission Design", GDC 2016 (abstract only `[sec]`; [GDC Vault](https://gdcvault.com/play/1023140/Level-Design-Workshop-360-Approach)).
- **Instance:** CDPR's stated rule: quests are not built around types such as fetch or escort, and "even a simple fetch task usually involves other activities", with sad and upbeat quests interleaved. Cyberpunk's NCPD scanner hustles are one-step events that vanish when done; the reward gap between them and organised-crime hustles is a player complaint `[sec]`. Ubisoft's recent Assassin's Creed design is reported to drop revealing the whole map at once in favour of information gathering `[sec]`.
- **Principles:**
  1. Adjacent activities should differ in verb, reward and tone. (Test: play-session logs of consecutive activity types; fatigue should rise with long runs of the same verb.)
  2. Finite, non-respawning encounters preserve meaning (Far Cry 3 changed outposts to stay captured; reported, not verified `[sec]`).
  3. Wrap the objective in a small situation, not just a marker. (Sasko.)
- **Failure modes:** Evidence is mostly critics' opinion and player forums; developers rarely publish density rules. Treat conclusions as hypotheses to test, not craft consensus.
- **Relevance:** supporting (low-medium confidence).
- **Surprise:** no.

### 14. Branching scope and reactivity budgeting
- **Definition:** Practices for keeping branching content affordable: reconvergence, state variables in place of forks, delayed and visible consequences, and a deliberate choice of where to spend reactivity.
- **Why it matters here:** Authors will supply branching quest packs and the engine will multiply them across world states. The professional record shows where cost explodes and where reactivity is worth buying.
- **Key sources:**
  - Sawyer on reactivity and authorship ([PCGamesN, 2017](https://www.pcgamesn.com/josh-sawyer-branching-dialogue-ai)).
  - Gaider on cost ([Tor.com interview via GameBanshee](http://www.gamebanshee.com/kwhx6)).
  - Larian's BG3 team on ending tracking ([Yahoo-syndicated report](https://malaysia.news.yahoo.com/larian-gave-baldurs-gate-3-022539159.html)).
  - Sasko, GDC 2023 (delayed and visible consequences) ([Game Developer](https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3)).
- **Instance:** Gaider: the limit on multi-branch narrative is the cost of creating content, not disc space. BG3: a spreadsheet of every ending path, "row after row", needing "a small army" to test. Witcher 3's Battle of Kaer Morhen had up to 16 possible supporting characters whose combinations the designer had to prioritise ([GamePressure](https://www.gamepressure.com/editorials/interview-with-cd-projekt-reds-lead-quest-designer-pawel-sasko/zd661)). Assassin's Creed Odyssey's director reportedly tried a Telltale-style "this choice matters" notice and dropped it, and its script writer described flow charts and deciding where branches reconverge (GameSpot and [Stevivor](https://stevivor.com/features/interviews/assassins-creed-odysseys-scott-bingham-branching-paths) interviews, both 403 to me `[sec]`).
- **Principles:**
  1. Reconverge at fixed beats and carry differences in state; unrestricted forks (time caves) are unaffordable. (Ashwell's [patterns](https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/); test: count live paths per story length.)
  2. A consequence that is not telegraphed is mostly wasted effort; bring earlier choices back later and make the link visible. (Sasko.)
  3. Surprise "gotcha" consequences should be minimal `[sec]` (Gaider).
- **Failure modes:** The record is from authored games; a procedural engine multiplies the variants without multiplying the testing capacity. Sawyer himself speculates that AI could eventually learn reactivity rules, which is a hope, not a result.
- **Relevance:** core (high).
- **Surprise:** no.

### 15. Defensive, any-order, state-robust content
- **Definition:** Writing and scripting each fragment so it makes sense whatever order the player arrives in and whatever the world state, with its preconditions stated locally.
- **Why it matters here:** The engine will place authored quests into worlds the author never saw, in orders nobody planned. The record on quest breakage in shipped open-world games is a catalogue of what this costs.
- **Key sources:**
  - Ingold, "Narrative Sorcery: Coherent Storytelling in an Open World", GDC 2017 ([GDC Vault listing](https://gdcvault.com/play/1023989/Narrative-Sorcery-Coherent-Storytelling-in); abstract only, which names "defensive logic").
  - RED Modding wiki, ["Quests: facts and files"](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/files-and-what-they-do/file-formats/quests-.scene-files/quests-facts-and-files.md).
  - Short on time caves ([Storylets: You Want Them](https://emshort.blog/2019/11/29/storylets-you-want-them/)).
  - Unofficial Skyrim Special Edition Patch notes: patches do not repair scripts already baked into a save (Nexus listings `[sec]`).
- **Instance:** In Cyberpunk, a quest fact is a name and a signed integer (unset reads as 0) that any file can read and compare; facts do nothing on their own and the logic that reads them decides; a prologue choice about Delamain is checked in three later places along with other factors; the wiki warns that editing a fact to fix one problem "almost always" causes unpredictable problems later, giving the example that a repaired phone call broke an elevator in the final quest.
- **Principles:**
  1. Each fragment should declare its own preconditions and tolerate any order of arrival. (Test: shuffle the order of fragments in simulation and check for dead ends and contradictions.)
  2. Shared mutable flags are a liability: namespace them (Cyberpunk fact names usually start with the quest code) and limit who may write them. (Test: static check that each fact has one writer module.)
  3. Fixes cannot be applied retroactively to saves, so content must tolerate being half-complete. (Skyrim patch experience `[sec]`.)
- **Failure modes:** Defensive text can be bland and over-explained; checking everything everywhere costs authoring time; it can mask real bugs.
- **Relevance:** core (medium-high).
- **Surprise:** yes.

### 16. Authoring tools and pipeline design for quest writers
- **Definition:** The tools (graph editors, scripting languages, entity databases, conversation editors) and design rules by which writers and designers author branching content.
- **Why it matters here:** Human authors will write data packs. Whether packs are good depends on their tool; postmortems record what to copy and what to avoid.
- **Key sources:**
  - Thief postmortem ([Game Developer](https://www.gamedeveloper.com/design/postmortem-i-thief-the-dark-project-i-)) and Deus Ex postmortem ([Game Developer](https://www.gamedeveloper.com/design/postmortem-ion-storm-s-i-deus-ex-i-)).
  - [ink](https://www.inklestudios.com/ink/), inkle's scripting language, described as markup with logic inserted into text `[sec]`; [Yarn Spinner docs](https://docs.yarnspinner.dev/).
  - Microids' use of articy:draft, [Amerzone showcase](https://www.articy.com/en/showcase/amerzone-the-explorers-legacy/) (studio account, vendor-hosted `[sec]`).
- **Instance:** Thief: narrow, purpose-built tools for specific audiences (a fixed set of AI triggers, tagged schemas) beat one general scripting system; the editor was never treated as a first-class product and the author says it should have been; Deus Ex built its own conversation editor. Microids split narrative data into text, branching logic and game flow with links between layers. Ubisoft's in-house tool Omen hosts Ghostwriter ([report](https://www.gamedeveloper.com/marketing/here-are-more-details-on-ubisoft-s-narrative-ai-tools-from-gdc-2023)); CDPR's REDkit for Witcher 3 documents quest and scene modules ([tutorial index](https://cdprojektred.atlassian.net/wiki/x/AYC2AQ) `[sec]`).
- **Principles:**
  1. Constrained, purpose-specific scripting suits designers better than a general language. (Thief; test: error rate of designer-authored content per tool.)
  2. Separating text, narrative logic and game flow lets each change independently. (Microids.)
  3. The editor is core production infrastructure and needs documentation and dedicated engineering.
- **Failure modes:** Graph editors probably become hard to read at scale (my expectation; I found no source); lock-in to a vendor's data model; for Cyberpunk mods the authoring surface is still file-level editing with community tools rather than a writer's tool (field 20).
- **Relevance:** core (high).
- **Surprise:** no.

### 17. QA and testing of branching and systemic content
- **Definition:** Methods for finding unreachable, contradictory or blocking content in large state spaces: seeded random playthroughs with coverage, bots with accelerated time, explicit combination matrices and human playtests.
- **Why it matters here:** The engine will create combinations no author tested; there must be an automated way to sample them and flag dead ends.
- **Key sources:**
  - Choice of Games, ["How to get the most out of automated testing, part 2"](https://choiceofgames.com/2018/01/how-to-get-the-most-out-of-automated-testing-part-2) (2018).
  - modl.ai on a bot testing Saltsea Chronicles ([vendor material](https://modl.ai/testing-content-heavy-games-with-ai-bots)).
  - Booth, L4D slides (survivor bots, accelerated time).
  - BG3 team on ending testing ([Yahoo-syndicated report](https://malaysia.news.yahoo.com/larian-gave-baldurs-gate-3-022539159.html)); Short on random playthroughs and visualisation ([Beyond Branching](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/)).
- **Instance:** ChoiceScript's randomtest runs, by default, 10,000 seeded random playthroughs and can print hit counts per line (a line hit about 100 times in 10,000 is "very difficult" to reach; about 10 times is "exceedingly" hard); a never-hit line cannot be proven reachable without forcing a path. The Saltsea Chronicles bot (vendor claim) replayed a more than 10-hour game in minutes and found crashes, blocked progression and invisible buttons, but not writing problems.
- **Principles:**
  1. Seeded random playthroughs with per-fragment hit counts reveal both unreachable and over-rare content. (Test: seed a known dead branch and confirm it is flagged.)
  2. Accelerated-time bots make pacing systems testable. (L4D.)
  3. Combination matrices of ending-relevant state need explicit human ownership. (BG3.)
- **Failure modes:** Random choices do not reflect player behaviour; loops need human reading; state-dependent systems (time passing) defeat visualisation; tools cannot judge quality. Cyberpunk's own launch quest breakage shows the cost of untested combinations (for example Patch 1.1 breaking a main quest `[sec]`).
- **Relevance:** core (high).
- **Surprise:** yes.

### 18. Localisation of dynamic and branching text
- **Definition:** Constraints that translation imposes on text with variables, gender, number and variable length, and the authoring habits that avoid them.
- **Why it matters here:** Generated text that splices names, pronouns or counts into sentences breaks in inflected languages; a text-heavy system with a gender-customisable protagonist hits this early.
- **Key sources:**
  - [Allcorrect: localising procedurally generated text](https://allcorrectgames.com/insights/how-to-localize-a-game-with-procedurally-generated-text/) (vendor, grounded in two projects).
  - GameAnim summary of the Witcher 3 talk (scene timing as percentages; see field 10).
  - CDPR localisation team, "Localization of Cyberpunk 2077 Technology", GDC 2023 (abstract: more than 1 million words, more than 80,000 voiced lines, 11 voice languages `[sec]`; [GDC Vault](https://gdcvault.com/play/1029219/Localization-of-Cyberpunk-2077-Technology)).
  - ICU MessageFormat select and plural formats ([Android ICU reference](https://developer.android.com/reference/android/icu/text/SelectFormat) `[sec]`); [Disco Elysium localisation interview](https://80.lv/articles/disco-elysium-localizing-an-enormous-rpg) `[sec]`.
- **Instance:** Allcorrect on Rogue Legacy 2: without gender tags, each gendered line needed two full translations, raising cost; joining item and material fragments needs per-language word order and prepositions; German plurals are not "add an s".
- **Principles:**
  1. Whole-sentence templates with named placeholders beat concatenation. (Test: translators can reorder placeholders.)
  2. Translators need entity metadata (gender, number, case) and a view of the generated result.
  3. Time-based staging should scale with line length (the Witcher 3 percentage rule).
- **Failure modes:** A mod community will usually ship English first; pack authors rarely supply grammar tags; supporting case-heavy languages fully may be out of scope. Graceful degradation (neutral phrasing) is the realistic target.
- **Relevance:** supporting (medium).
- **Surprise:** yes.

### 19. Content economics and where procedural help is credible
- **Definition:** What content costs, which parts are the bottleneck, and which procedural aids professionals actually accept.
- **Why it matters here:** The project must choose what to generate and what to leave to authors; the record says authorship, not rendering, is the bottleneck, and that professional acceptance is narrow.
- **Key sources:**
  - Vincke on the cost of motion capture and voice ([Larian blog via GameBanshee](https://www.gamebanshee.com/ckq), 2012).
  - Sawyer, ["AI is the next step"](https://www.pcgamesn.com/josh-sawyer-branching-dialogue-ai) (PCGamesN, 2017).
  - Nesmith ([GamesBeat](https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/)).
  - Ubisoft Ghostwriter, GDC 2023 ([Game Developer](https://www.gamedeveloper.com/marketing/here-are-more-details-on-ubisoft-s-narrative-ai-tools-from-gdc-2023)).
  - GDC 2026 [State of the Game Industry](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/).
- **Instance:** Vincke (2012): professional simultaneous body and face capture was quoted at about $1,000 to $2,000 per minute, roughly $0.5 to $1 million for the project, so Larian built a cheaper facial-capture rig around its voice booth. Ghostwriter (inside Omen): drafts of barks, background lines, crowd chatter and UI text; two options per request; writers accept, edit or discard, and their choices feed back; paraphrase was the most common use; explicitly not for cinematics or lore. Sawyer: "the major bottlenecks are authorship", with a hope that AI could be taught reactivity rules rather than invent content. CDPR reported spending more than $120 million on Cyberpunk 2077 after launch, about $84 million of it on Phantom Liberty (Investor Day, October 2023, via [80.lv](https://80.lv/articles/cdpr-has-spent-usd120-million-on-cyberpunk-2077-after-its-release/)).
- **Principles:**
  1. Authorship (writing, variant implementation, testing) dominates the cost of reactive content more than rendering does. (Sawyer; Gaider; BG3 spreadsheet.)
  2. Procedural help earns professional acceptance for first drafts and variants with human accept-or-edit, not for lore, arcs or cinematics. (Ghostwriter; Nesmith's view that automated quests will not match hand-crafted quality soon.)
  3. Sentiment is hostile and worsening: in the 2026 survey (more than 2,300 respondents) 52 per cent said generative AI harms the industry (30 per cent a year earlier), and 63 per cent of game design and narrative respondents were unfavourable; where it is used, 81 per cent use it for research or brainstorming.
- **Failure modes:** No studio publishes a cost per minute of quest; the numbers here are sparse or dated (2012). The Ghostwriter backlash and the survey show reputational cost for a project that leans on generation; a hobby mod has different economics from AAA.
- **Relevance:** core (medium-high).
- **Surprise:** yes.

### 20. Mod-community quest authoring
- **Definition:** How volunteer teams and solo authors build quests and total conversions on top of a shipped engine and its tools, and the scope lessons they report.
- **Why it matters here:** The packs are written by this community. Their record shows what survives a volunteer budget, and the Cyberpunk-specific tooling is still immature.
- **Key sources:**
  - Pearce on The Forgotten City ([Kotaku](https://kotaku.com/its-hard-work-turning-a-skyrim-mod-into-a-standalone-ga-1827378941)); SureAI lead on Enderal ([Nexus news](https://www.nexusmods.com/news/13836) `[sec]`).
  - RED Modding wiki, [quest guides index](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/quest).
  - CDPR's REDkit for Witcher 3 (official quest and scene modules `[sec]`, [tutorial index](https://cdprojektred.atlassian.net/wiki/x/AYC2AQ)).
  - Bethesda "Monthly Modder" interview: a Fallout 4 quest modder aiming for smaller vignettes to complement the base game ([bethesda.net](https://bethesda.net/en-EU/news/monthly-modder-seddon4494) `[sec]`).
- **Instance:** The Forgotten City began as a solo Skyrim mod (about 1,700 hours, an Australian Writers' Guild award) built around an ethical time-loop structure. Enderal's lead says many ambitious total conversions fail from overreach and that its predecessor Nehrim survived only through major cuts. As fetched, the RED Modding wiki's quest section lists seven guides (visualising quest files, voice-over and subtitles, lipsync sets, mesh component transforms, removing an animation, community registries, garage doors) and none on end-to-end quest authoring; [communities](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/world-editing/ai-and-npcs/creating-communities.md) spawn NPCs through World Builder objects with entries, phases and periods and need ArchiveXL, Codeware and WolvenKit; quest state lives in [named integer facts](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/files-and-what-they-do/file-formats/quests-.scene-files/quests-facts-and-files.md).
- **Principles:**
  1. Scope discipline predicts completion: smaller, tightly written units survive better than total conversions. (Test: completion rate of announced mods by scope.)
  2. A distinctive structural hook plus strong writing explains the best-received quest mods (The Forgotten City). Survivorship bias applies.
  3. Quest state in Cyberpunk is global named integers read from `.quest`, `.questphase` and `.scene` files; pack tooling must hide this from authors or enforce namespacing.
- **Failure modes:** Anecdote and survivorship; I found no postmortem of a full Cyberpunk quest mod; wiki coverage is partial; Witcher 3's REDkit is a first-party editor, Cyberpunk has no equivalent.
- **Relevance:** core (medium-high).
- **Surprise:** no.

### 21. Community norms on generated content and disclosure
- **Definition:** The rules and expectations of mod platforms and communities about AI-generated voices, dialogue, code and assets.
- **Why it matters here:** The engine will produce text and may be tempted to voice it. Hosting platforms now require disclosure, and cloning real actors is a flashpoint.
- **Key sources:**
  - Nexus Mods generative AI tagging guidelines, announced the week of 31 July 2026 ([Shacknews](https://www.shacknews.com/article/150216/nexus-mods-gen-ai-tagging-moderation); also [PC Gamer](https://pcgamer.com/gaming-industry/nexus-mods-finally-tightens-the-screws-on-ai-though-its-still-playing-softball-with-the-tide-of-slop)).
  - TechRadar on AI-voiced Skyrim mods ([article](https://www.techradar.com/gaming/consoles-pc/voice-actors-are-being-abused-by-skyrim-modding-communities-using-ai); headline and search summary only `[sec]`).
  - GDC 2026 survey ([GDC](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/)).
- **Instance:** Nexus tags: "AI-Generated Content" covers AI-made code, UI, voices, dialogue, translations, music and in-game assets; "AI Assisted" covers limited developer-led use; "AI Media" covers promotional material. Untagged use is subject to moderation; it is not a ban. In Skyrim, voice clones of real actors in mods drew the sharpest objections.
- **Principles:**
  1. Generated dialogue shipped in a mod falls under disclosure tags; undisclosed use risks moderation. (Test: check platform rules at release.)
  2. Text-only content sidesteps the voice-cloning controversy.
  3. Narrative and design professionals are the most hostile group; audience goodwill cannot be assumed.
- **Failure modes:** Rules change quickly and differ by platform; the policy covers uploads, not generated-at-runtime content on a player's machine; community sentiment is not uniform.
- **Relevance:** core as a constraint (medium-high).
- **Surprise:** yes.

### 22. Multi-solution mission design (immersive sims) and heist structure
- **Definition:** Missions framed as a goal plus obstacles and affordances, solved in several ways by the player's choice, rather than a scripted route.
- **Why it matters here:** The heists and "multi-part" content of this system need to survive being built from fragments, with room for the player's improvisation.
- **Key sources:**
  - Deus Ex postmortem ([Game Developer](https://www.gamedeveloper.com/design/postmortem-ion-storm-s-i-deus-ex-i-)).
  - Thief postmortem ([Game Developer](https://www.gamedeveloper.com/design/postmortem-i-thief-the-dark-project-i-)).
  - Wilson, "Mooncrash: Resetting the Immersive Simulation", GDC 2019 (recap `[sec]`, [GDC Vault](https://gdcvault.com/play/1025732/-Mooncrash-Resetting-the-Immersive)).
  - Cyberpunk Street Stories "usually have several completion paths" ([Game World Observer](https://gameworldobserver.com/2019/09/13/quests-witcher-cyberpunk-2077)).
- **Instance:** Deus Ex's brief said problems would have multiple solutions; limits in the simulation meant designers planned separate skill, action and conversation paths past each problem, and concluded a deeper simulation was needed. Thief took the GoldenEye idea of different objectives per difficulty, changing the experience without changing geometry. Mooncrash recut the same space with different characters and escape routes `[sec]`.
- **Principles:**
  1. Show the goal before the route and let geometry guide it; avoid puzzle-style guess-the-intent solutions. (Deus Ex.)
  2. Resolve outcomes without hidden rolls so players can judge risk.
  3. Build a fully playable early "proto-mission" to test the whole design, and cut scope early (Deus Ex cut its design document from about 500 to 270 pages after a milestone).
- **Failure modes:** Parallel hand-scripted paths cost multiples of linear content unless the simulation is deep enough for solutions to emerge. I found no GDC talk on heist structure itself; applying immersive-sim lessons to heists is my inference.
- **Relevance:** core for heist scale (medium confidence).
- **Surprise:** no.

### 23. Hand-made feel: specificity, restraint and signal over noise
- **Definition:** The craft habits that make content read as authored: small physical detail, controlled exposition, tailored dilemmas and a fixed backbone with generated texture.
- **Why it matters here:** "Content must not feel generated" is the headline requirement, and veteran designers have stated what produces and removes that feel.
- **Key sources:**
  - Sasko, GDC 2023 ([Game Developer](https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3)).
  - Caves of Qud design lessons ([Game Developer](https://www.gamedeveloper.com/design/tapping-into-the-potential-of-procedural-generation-in-caves-of-qud)).
  - Nesmith ([GamesBeat](https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/)); Wildermyth (field 7).
  - Witcher 3 contracts as a template (commentary `[sec]`, for example [GameGrin](https://www.gamegrin.com/articles/the-witcher-3s-monster-contracts-are-a-masterclass-in-worldbuilding/)).
- **Instance:** Sasko: the "signal" is what players must absorb and "noise" everything else, so isolate key information in focused moments and move minor talk to walking or other activity; a small gesture (Panam's leg over a knee) had outsized impact; cut repeated exposition. Caves of Qud keeps towns fixed and generates history, dungeons and wilderness around a static backbone; hand-made feel comes from texture, writing and small details, not volume. The Witcher 3 contract pattern (investigate, decide what the "monster" is worth, fight) is a reusable authored template that readers praise when the monster is tied to a human story `[sec]`.
- **Principles:**
  1. Specific small physical details carry more weight than volume. (Test: blind preference between generic and specific versions of the same vignette.)
  2. Choices should be dilemmas that anticipate the player's expectation, with stakes set up first. (Sasko.)
  3. Put authored backbone where lore and arcs live and generate the surround. (Qud.)
- **Failure modes:** These are craft heuristics from authors, hard to turn into rules and hard to test without players; "friction" and "restraint" are not computable.
- **Relevance:** core (medium; synthesis of several accounts).
- **Surprise:** no.

### 24. Quest hooks, leads and journals for vague quests
- **Definition:** How players learn that a quest exists and how they keep their place: notice boards, fixers, overheard talk, journals and in-world clue organisers.
- **Why it matters here:** Packs may be vague ("something is wrong at the market"); the player's journal and the way leads surface decide whether vagueness feels like mystery or like a bug.
- **Key sources:**
  - Yu et al. (guiding the player was the most common stated purpose of a quest) ([arXiv](https://arxiv.org/abs/2110.04148)).
  - Mobius Digital's [December 2017](https://www.mobiusdigitalgames.com/news/archives/12-2017) and [February 2018](https://www.mobiusdigitalgames.com/blog/a-look-into-playtests) Outer Wilds updates.
  - Weber on Street Stories and Witcher contracts ([Game World Observer](https://gameworldobserver.com/2019/09/13/quests-witcher-cyberpunk-2077)).
  - Todd Howard on the Oblivion journal and Morrowind's text directions (secondary coverage `[sec]`, for example [GameBanshee](https://gamebanshee.com/3qah)).
- **Instance:** Outer Wilds' team found in playtests that the way the ship computer organised information strongly affected how players interpreted it, and rebuilt it as a "detective board" that helps stuck players without changing the core experience. Morrowind put directions in prose in the journal; Oblivion added journal sorting after complaints `[sec]`.
- **Principles:**
  1. The organisation of the journal changes how players interpret clues, so test the journal, not just the quest. (Mobius.)
  2. A way to recover when stuck should not reveal the solution.
  3. Guiding the player is the commonest stated purpose of a quest, so every vague pack needs a defined lead.
- **Failure modes:** Evidence is developer blog posts and secondary coverage; guidance conventions differ by genre; Cyberpunk mods have limited UI hooks.
- **Relevance:** supporting (low-medium confidence).
- **Surprise:** yes.

### 25. Patent and IP hazards in narrative-system design
- **Definition:** Legal constraints that shape which "world remembers the player" mechanics a project can safely build.
- **Why it matters here:** Systems that adapt NPC opposition to player history are the obvious extension of a quest engine, and at least one such mechanism is patented.
- **Key sources:**
  - [Patent Arcade on US 10,926,179](https://www.patentarcade.com/?p=5803) (Warner Bros., "Nemesis characters, nemesis forts, social vendettas and followers in computer games").
  - [MCV report](https://www.mcvuk.com/business-news/warner-bros-secures-patent-for-the-nemesis-system-from-shadow-of-mordor/) `[sec]`.
- **Instance:** Granted 23 February 2021, filed March 2015, after six revisions in prosecution. Claim 1 as granted: a processor detects an avatar-NPC interaction and changes stored parameters of a second NPC, which then opposes avatars using them, and outputs an indication of that change. Developers publicly called the grant a chilling threat; no enforcement or court ruling was found.
- **Principles:**
  1. Mechanics in which one NPC's recorded interaction with the player changes a different NPC's hostile parameters fall within a granted claim. (Test: review designs against the claim text.)
  2. A design can reach similar player experience through different structures (per-region memory, authored escalation); this needs legal review, not just engineering.
- **Failure modes:** I am not a lawyer; scope after prosecution is narrow and validity untested; term ends around 2035 `[sec]`; the same concern may apply to other patents I did not search for.
- **Relevance:** peripheral to supporting (medium confidence).
- **Surprise:** yes.

---

## Considered and rejected

- **Rockstar mission and stranger design:** no developer talks or postmortems found, only fan guides.
- **Telltale-style episodic production pipelines:** no verifiable source found in this session.
- **Voice-casting and recording pipelines (Hades, Cyberpunk VO):** irrelevant under a no-new-VO constraint.
- **Larian's cinematic production costs:** a figure of 170-plus hours circulates in unsourced guides; nothing citable.
- **Procedural cinematography research (academic):** belongs to other lenses, not production practice.
- **LLM runtime dungeon-master products (AI Dungeon and similar):** not studio production practice.
- **Audio middleware for barks (Wwise and similar):** implementation detail, peripheral.
- **Live-ops and seasonal content cadence:** does not match a one-shot data-pack model.
- **MMO quest hubs and the WoW "quest ? ! loop":** different context; only touches field 13.
- **Dwarf Fortress / Legends-style history simulation:** covered by simulation lenses; Caves of Qud used here as the production-relevant example.
- **Speech-act and dialogue-wheel UX (Mass Effect, Fallout 4):** UI design, not content production.
