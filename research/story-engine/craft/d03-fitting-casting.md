# Dossier 3: fitting, casting and the vague end of a seed

**Status:** draft v1, 22 October 2026. Third dossier of [P1 phase C](../p1-research-method.md). It follows the [P1 template](../p1-research-method.md) (§3) and uses its [evidence grades](../p1-research-method.md) (§4).

**Fields covered.** Core: SEL-04 (storylets, quality-based and salience-based narrative), SEL-12 (role casting and persona layers), AUT-03 (defensive, any-order, state-robust content), AUT-04 (mission command and commander's intent), NAR-08 (pattern languages). Supporting: SEL-05 (narrative planning), SEL-08 (case-based adaptation), CRA-10 (museum and heritage interpretation). Every row is in the [map](map.md).

**How far each source was read.** Each source in §2 says what was opened: *read* (the text itself), *summary* (a page or recap by someone else, or search snippets), *abstract* (title and abstract only) or *not opened*. A principle that rests on a source we only saw in summary says so. Where a talk is gated (GDC Vault) or a wiki refused the fetch (the UESP Creation Kit wiki), the mechanism is marked unverified rather than filled in from memory.

## 1. Scope and why it matters here

**What this dossier is about.** An author writes a seed: part of a story, with some parts pinned down and others left vague. Something must then work out *when* it can happen, *who* plays each role, *where*, *why now*, *through which channel*, and what to do when the world will not oblige. This is layer 2's casting and layer 3's fitting ([plan §2](../plan.md#2-the-system-at-first-level), [D-03](../decisions.md)). The dossier asks what the craft and the research record say about doing that well, and what must be true of the seed language for it to be possible.

**Layers and concerns informed.** Layer 2 (the seed language and its resolver, casting, the seed lifecycle, scheduling); layer 3 (the fitter, as a service role that still runs with sowing off); layer 4 (what authors write and how). Cross-cutting: evaluation (the fit report, the shuffle and fill-rate tests) and tooling (traces). It feeds P4 and P5 directly, and P6 (author priorities, the pinning loop).

**Where each of the brief's questions is answered.**

| Question | Answered in |
|---|---|
| How storylet, quality-based and salience-based systems represent requirements and effects, and what failed | Principles FIT-01 to FIT-09, and §4.1 to §4.4 |
| How casting works, and what to do with a role that cannot be filled | FIT-10 to FIT-20 |
| How fragments survive any order and any context | FIT-21 to FIT-28 |
| How author intent for the open parts can be captured | FIT-29 to FIT-37 |
| Adaptation, timing, windows, fallbacks and channels | FIT-38 to FIT-51 |
| The worked walkthrough of reference scenario R1 | §8 |
| Requirements for the seed language | §9 |

**The failure digest, before any advice.**

| What failed | Where it showed | Principle that answers it |
|---|---|---|
| Rules and qualities multiplied faster than anyone could tune them | Prom Week's 4,900-plus influence rules; Sunless Sea's hand-edited data files; Fallen London's own rule to keep qualities few | FIT-02, FIT-35 |
| Strict casting meant most events never fired | Wildermyth; quest aliases that "fail to start" when required | FIT-11, FIT-18 |
| One giver, everything else open, read as the same job again and again | Fallout 4's settlement quests; Skyrim's job quests | FIT-05, FIT-16, FIT-42 |
| Salience alone picked badly timed beats | Short on salience-based systems; Legion's side missions interrupting cliffhangers | FIT-06, FIT-48 |
| Authoring cost capped what the system could do | Façade: 27 beats after about three person-years of authoring; Legion's persona workflow | FIT-02, FIT-07 |
| Brittle adaptation | Minstrel, as rebuilt in Skald; quests that break when a fact is edited | FIT-22, FIT-38 |
| A fixed authored part silently lost to the game's own state | Kernel arbitration (authored 400 below game 500) | FIT-15, FIT-44, requirement 12 |

## 2. Sources

| Source | What it gave | Read | Credit status |
|---|---|---|---|
| Emily Short, ["Beyond Branching"](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/) (2016) | Definitions and weaknesses of quality-based, salience-based and waypoint structures | read (via a detailed fetch summary) | credited (Emily Short and Failbetter Games) |
| Short, ["Storylets: You Want Them"](https://emshort.blog/2019/11/29/storylets-you-want-them/) (2019) | Storylet = content + prerequisites + effects; time caves | summary | to credit as a second work |
| Short, [recap of Kreminski's survey](https://emshort.blog/2019/01/06/kreminski-on-storylets/) (2019); Kreminski and Wardrip-Fruin, "Sketching a Map of the Storylet Design Space", ICIDS 2018 | Four axes of the design space; authoring burden | the post: read; the paper: not opened | credited (Kreminski and Wardrip-Fruin 2018) |
| Short, [recap of Ruskin's GDC 2012 talk](https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/); the [Mímir README](https://github.com/subtalegames/mimir) (a reimplementation) | Valve's rule database: facts, criteria, most specific rule wins, general rules as fallback | both read; the talk and slides: gated | Valve's Left 4 Dead is credited via Booth; Ruskin's talk to credit |
| Failbetter Games, ["Fallen London Writer Guidelines, Part II"](https://www.failbettergames.com/news/fallen-london-writer-guidelines-part-ii); the [Card Frequency page](https://fallenlondon.wiki/wiki/Card_Frequency) (fan wiki) | Quality parsimony; no trapping; frequency tiers for cards | the guidelines: read; the wiki page: search summary only | to credit (guidelines) |
| Alexis Kennedy, ["Postmortem: Failbetter Games' Sunless Sea"](https://www.gamedeveloper.com/audio/postmortem-failbetter-games-i-sunless-sea-i-), *Game Developer*, 4 March 2015 | Special cases pile up in a reused story engine; hand-edited data became unmanageable | read (summary page) | to credit |
| Mateas and Stern, ["Structuring Content in the Façade Interactive Drama Architecture"](https://ojs.aaai.org/index.php/AIIDE/article/view/18722) (AIIDE 2005) | Beat selection knowledge; author-specified tension arc; 27 beats, about three person-years | read (PDF text) | credited (Façade). The existing entry says "about 200 authored beats"; this paper says 27 |
| Evans and Short, ["Versu: A Simulationist Storytelling System"](https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf), *IEEE TCIAIG* 6(2), 2014 | Role-agnostic social practices; episode-specific story managers; author inspector | read (PDF text) | to credit |
| McCoy, Treanor, Samuel, Wardrip-Fruin, Mateas, ["Comme il Faut: A System for Authoring Playable Social Models"](https://ojs.aaai.org/index.php/AIIDE/article/view/12454) (AIIDE 2011) | Initiator, responder and optional "other"; preconditions, effects, weighted influence rules; the rule-count cost | read (PDF text) | to credit |
| Nate Austin on Wildermyth, [Turn Based Lovers interview](https://turnbasedlovers.com/10-turns-interview/with-wildermyth-developer) (2019); the [villain-writing devlog](https://wildermyth.itch.io/wildermyth/devlog/91164/how-to-write-your-own-villain-for-wildermyth-part-1) | Events as plays with roles; casting strictness; plot steps, roles, fallback event lists | both read (fetch summaries) | credited (Worldwalker Games) |
| *Game Developer* on [Watch Dogs: Legion's narrative authoring](https://www.gamedeveloper.com/marketing/how-i-watch-dogs-legion-i-made-ubisoft-rethink-its-storytelling) (2023); Ubisoft, ["The tools that built London"](https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london); Dragert, "Census", GDC 2021 | Personas, anchors, what writers cannot assume; the Player Attention System | the two articles: read (summaries); the talk: not opened | to credit |
| Bruce Nesmith on Radiant Story, via [GamesBeat](https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/) (2012) | What was restricted and why; "would play horribly" for a main quest | read (summary) | to credit |
| Creation Kit alias documentation (UESP wiki, [Bethesda tutorial on radiant quests](https://ck.uesp.net/wiki/Bethesda_Tutorial_Radiant_Quests)); [Beyond Skyrim troubleshooting page](https://wiki.beyondskyrim.org/wiki/Arcane_University:Implementation_Troubleshooting_Reference) | Required and optional aliases, reservation, fill order, the "seed alias" | the UESP pages refused the fetch (403); the Beyond Skyrim page: read. UESP details are from search summaries | to credit |
| Crusader Kings 3 [event modding page](https://ck3.paradoxwikis.com/Event_modding); RimWorld [quest scripting page](https://rimworldwiki.com/wiki/Modding_Tutorials/Quests) | Triggers before scopes; fallback options; dry-run before a quest is generated | both read (summaries) | to credit as two entries |
| Doran and Parberry, ["A Prototype Quest Generator Based on a Structural Analysis of Quests from Four MMORPGs"](https://ianparberry.com/pubs/pcg2011.pdf) (PCG 2011) | Quest = NPC motivation + strategy; general planning is impractical | read (PDF text) | to credit |
| Tearse, Mawhorter, Mateas, Wardrip-Fruin, "Skald: Minstrel Reconstructed", *IEEE TCIAIG* 6(2), 2014 | Brittleness of case-based story generation; costs for transformations | abstract | to credit |
| Porteous, Cavazza, Charles, "Applying Planning to Interactive Storytelling: Narrative Control Using State Constraints", *ACM TIST* 1(2), 2010; Riedl and Young, "Narrative Planning", *JAIR* 39, 2010; Ware and Young, "Glaive", AIIDE 2014 | Author state constraints as landmarks; intent- and conflict-aware planning | abstracts; Riedl and Young not opened | to credit |
| Nelson, Mateas, Roberts, Isbell, ["Declarative Optimization-Based Drama Management in Interactive Fiction"](https://www.cs.uky.edu/~sgware/reading/papers/nelson2006declarative.pdf), *IEEE CG&A*, May/June 2006; Weyhrauch, *Guiding Interactive Drama* (CMU thesis, 1997) | Author aesthetics as an evaluation function over plot-point sequences; a feature toolbox | Nelson et al.: read (PDF text); Weyhrauch: not opened, known only from how later work and a search summary describe it | Nelson et al.: to credit; Weyhrauch: not until opened |
| Lajos Egri, *The Art of Dramatic Writing* (1946) | Premise as a thesis demonstrated in behaviour | search summaries only | to credit if kept |
| Justin Alexander (The Alexandrian), [Three Clue Rule](https://thealexandrian.net/?p=7985) and node-based design; Robin Laws, GUMSHOE (via Pelgrane Press pages) | Three independent routes; leads between nodes; guaranteed core clues | the Alexandrian page: read; GUMSHOE: search summaries | credited (Alexander, Three Clue Rule and node-based design) |
| Mike Shea (Sly Flourish), *Return of the Lazy Dungeon Master* and [Types of Secrets](https://slyflourish.com/types_of_secrets.html) | Secrets kept abstract from the place of discovery | summary | credited |
| RED Modding wiki, ["Quests: facts and files"](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/files-and-what-they-do/file-formats/quests-.scene-files/quests-facts-and-files) | Facts are named integers; fixing one fact can break a later quest | read (summary) | credited (RED Modding wiki) |
| Christopher Alexander and colleagues, *A Pattern Language* (1977); Alexander, ["A City Is Not a Tree"](https://www.patternlanguage.com/archive/cityisnotatree.html) (1965) | Patterns as hypotheses linked from large scale to small; overlap versus nesting | the essay: read (summary); the book: layout seen in excerpts only | credited (the book); the essay to credit |
| US Army, *ADP 6-0 Mission Command* (2019); a [US Army article on commander's intent](https://www.army.mil/article/215297/mission_command_requires_sharp_commanders_intent) | Intent as purpose, key tasks and end state; subordinates choose the means | the article: read; ADP 6-0: not opened | to credit |
| Tilden, *Interpreting Our Heritage* (1957); Serrell, *Paying Attention* (1998) and the [51% Solution project](https://informalscience.org/research/51-solution-research-project-meta-analysis-visitor-timeuse-museum-exhibitions/) | Relate the thing to the visitor; visitors stop at about a third of elements | secondary only; the one-third figure is from summaries of the book | to credit |
| Yu, Guzdial, Sturtevant, ["The Definition-Context-Purpose Paradigm…"](https://arxiv.org/abs/2110.04148) (AIIDE 2021) | Fifteen developers: purpose is a component of what a quest is | abstract | to credit |
| Haralick and Elliott, ["Increasing Tree Search Efficiency for Constraint Satisfaction Problems"](https://haralick.org/journals/haralick_elliot.pdf), *Artificial Intelligence* 14, 1980 | The fail-first principle for search order | abstract level | to credit |
| This repository's own corpus: [main-story state](../../../knowledge/main-story-state.md), [player channels](../../../knowledge/player-channels.md), [quests and story](../../../knowledge/quests-and-story.md), the [gig decompositions](../gig-decompositions.md), and S0 [kernel](../spec/kernel.md) | The game's facts and phases; channel limits; gig fallbacks; contribution and pin semantics | read | first-party |

## 3. Principles

Grades: **[empirical]**, **[practice]**, **[shipped]**, **[corpus]**, **[analysis]**, **[hypothesis]**. Scales are encounter (E), gig (G) and arc (A). "Operationalise" says whether a procedure could produce the property, check it, or neither, and points at the layer and, where one applies, the kernel section. Comparisons with the engine's own concepts are comparisons only ([D-21](../decisions.md)).

### 3.1 Units that state what they need and what they change (SEL-04)

**FIT-01. A unit declares what it needs and what it changes, in one shared, named vocabulary.** `[practice]`
- *Source:* Short 2019 (a storylet is content, prerequisites and effects); Short 2016 (qualities are the state, even location); Mateas and Stern 2005 (each beat has selection knowledge: preconditions, weights, priorities, and effects on a story value); McCoy et al. 2011 (a social exchange has preconditions and effects).
- *Instance:* A Fallen London storylet gated by qualities; a Façade beat that is unused, has its preconditions met, and moves tension.
- *Scales:* E, G, A. *Layers:* 2, 3, 4.
- *Operationalise:* **Check and produce.** A static check finds any need that no unit or game fact can ever satisfy, and any effect nobody reads. Needs map to kernel predicates and selectors (S0 §4.2, §8.1); effects map to events that commit pins (S0 §9.2). The game's own fact system is already a quality system: named integers, unset reads 0, tested by comparison ([quests and story §2.4](../../../knowledge/quests-and-story.md)).

**FIT-02. Keep the vocabulary of requirements small, shared and reused.** `[practice]`
- *Source:* Failbetter's writer guidelines (use as few unique qualities as possible; extra ones add economy complexity, bugs and interface clutter; two is the "magic minimum" for content with real structure); Kennedy 2015 (hand-edited data files became very hard to manage); McCoy et al. 2011 (over 4,900 influence rules and about 40,000 predicates, tuned by hand).
- *Instance:* Sunless Sea's content grew past what hand-edited files could carry; Prom Week's rule volume needed play-testing metrics to tune.
- *Scales:* all. *Layers:* 2, 4.
- *Operationalise:* **Check.** Lint a pack for the number of distinct facts per unit, facts used once, and facts with more than one writer. A review budget per pack is a design choice for P6.

**FIT-03. Needs should name kinds of thing with constraints, and bind the instance at cast time.** `[practice]`
- *Source:* Short's summary of Kreminski's axes (Fallen London checks specific quality values; Starfreighter's storylets look for any item of a category and bind it into the text); Creation Kit aliases (filled from conditions, or forced to one reference).
- *Instance:* "Any cargo" versus "this cargo".
- *Scales:* E, G. *Layers:* 2.
- *Operationalise:* **Produce.** A need is a kernel query with `must` and `prefer` predicates (S0 §8.1). The same need can be an instance (an identity pin) at the fixed end and a kind at the open end, which is the binding spectrum of [DS-35](../design-seeds.md).

**FIT-04. When several units fit, the most specific wins, and a general default sits underneath.** `[shipped]`
- *Source:* Short's recap of Ruskin's talk (Left 4 Dead's dialogue: the most specific matching rule wins, broader rules are fallbacks, so a writer adds a special case without touching the rest); Mímir, a reimplementation (specificity is the number of criteria, ties are random, uncovered states produce no output).
- *Instance:* A circus-specific quip for being attacked, with the general line used elsewhere.
- *Scales:* E, G. *Layers:* 3.
- *Operationalise:* **Produce and check.** Rank by satisfied criteria; break ties with the injected random stream, so a run is reproducible. Check that every context has at least one match (coverage), because a rule database with a gap yields nothing. Specificity is not importance: a rare, narrow rule can be the wrong one to play; see §5.

**FIT-05. Repeatability and recency are declared and remembered, and unseen beats seen.** `[practice]`
- *Source:* Fallen London's card frequencies (nine tiers from "Rarererest" at 1 to "Ubiquitous" at 1,000, "Standard" at 100; the effect is stronger in small decks); Façade's sequencer picks an *unused* beat. The claim that Hades puts unseen conversations first, and Yarn Spinner's "least recently viewed" default, come from the lenses and were **not verified**: the Hades talk is gated.
- *Instance:* A card with a low frequency tier shows up seldom; a played beat is not chosen again.
- *Scales:* E, G. *Layers:* 2, 3.
- *Operationalise:* **Produce and check.** The seed lifecycle record keeps what was offered and played (plan §2, layer 2). A blind test counts repeat complaints across long sessions with and without recency. P1 dossier 5 owns the variety test.

**FIT-06. Salience needs an arc check above it.** `[practice]`
- *Source:* Short 2016 (selecting by best fit can stumble into a dramatically weak or unintended ending; weight some variables by arc); Mateas and Stern 2005 (a beat is chosen partly by how closely its tension effect matches an author-specified arc).
- *Instance:* A death arriving by accident because its conditions were met.
- *Scales:* G, A. *Layers:* 3.
- *Operationalise:* **Check, then veto.** The fitter asks the director's pacing state before committing; a high-impact seed that matches but is badly timed is held. Test: log selections against a pacing model and count mistimed picks. Dossier 7 owns the pacing model.

**FIT-07. A selection system needs a big pool, and a small pool starves it. Plan for starvation.** `[practice]`
- *Source:* Short 2016 and Kreminski's survey (a quality-based system feels unrewarding until it has many storylets; a minimally playable one takes many); Nesmith (job quests restricted to fitting NPCs, which narrows the pool).
- *Instance:* Starfreighter sustained a long loop from few storylets, but only because its systemic design recombined them.
- *Scales:* all. *Layers:* 3.
- *Operationalise:* **Check.** For each sampled story state, count the eligible seeds. The engine will often hold only a handful of authored seeds, so the fitter must supply connecting material rather than hope that a match exists. A "no fit, and why" verdict is a first-class output of the fit report (FIT-36).

**FIT-08. Progress through a multi-step arc is engine state, not the author's bookkeeping.** `[practice]`
- *Source:* Short 2016 (in StoryNexus authors set series of qualities by hand to track multi-step arcs, which is a lot of work other systems automate); Failbetter's guidelines (reminder branches for players who return in spurts).
- *Instance:* A "find three clues" arc needs about four storylets in a quality-based system, one gated on the other three.
- *Scales:* G, A. *Layers:* 2.
- *Operationalise:* **Produce.** The seed lifecycle (sown, waiting, materialised, resolved, withered) holds progress. Authors declare steps and what each requires; the engine keeps the flags.

**FIT-09. Units depend on summary state, never on the exact route taken.** `[practice]`
- *Source:* Short 2019 (a "time cave", a branching tree that never recombines, forces a unique flag per node, which loses the benefits of storylets; real games embed small ones inside a larger structure).
- *Instance:* "V knows the lead" instead of "V went node 3 then node 5".
- *Scales:* G, A. *Layers:* 2, 4.
- *Operationalise:* **Check.** No unit may name another unit's internal state; it names facts. Count live paths per story length as a warning.

### 3.2 Casting (SEL-12)

**FIT-10. Write the unit with roles, and keep the role separate from the character who plays it.** `[practice]`
- *Source:* Evans and Short 2014 (Versu's practices are authored role-agnostic, so any character can be assigned to any role and "everything just works"; the paper also lets the player play different roles); Austin (Wildermyth events are plays with roles such as a leader and a hothead); Wildermyth's plot steps map a plot-level role to the role an event expects.
- *Instance:* A romance with a hero, a heroine, a friend and a jealous rival, cast differently each run.
- *Scales:* E, G, A. *Layers:* 2, 4.
- *Operationalise:* **Produce.** A role is a typed slot with constraints. Casting is "query, then pin" ([foundation §6](../foundation.md)). Roles let the same unit run in worlds the author never saw.

**FIT-11. Casting strictness is tuned between "never fires" and "the roles blur".** `[practice]`
- *Source:* Austin: too strict and most events never appear; too loose and players stop noticing the differences between heroes.
- *Instance:* An event that wants a hothead, a scholar and a loner can wait many sessions for that party.
- *Scales:* E, G. *Layers:* 2.
- *Operationalise:* **Check.** Report the fill rate per role over sampled states (the fit report, FIT-36). Sweep strictness and compare fill rate against how distinct the cast reads. No fixed number is claimed; it is a measured trade.

**FIT-12. Split constraints three ways: required, preferred and scored, and free.** `[shipped]`
- *Source:* Creation Kit aliases (an optional alias does not stop a quest starting; a required one does, via search summaries of the UESP wiki); McCoy et al. 2011 (preconditions decide whether an exchange is playable; weighted influence rules decide how much a character wants it); Valve's criteria.
- *Instance:* "The quest will not start without the giver" against "prefer someone who has met V".
- *Scales:* all. *Layers:* 2, 3.
- *Operationalise:* **Produce.** It maps one-to-one onto the kernel. Required is a `constrain` contribution or a query `must`; preferred is a `weight` contribution with a strength or a query `prefer` with a weight; free is no contribution (S0 §4.1, §5.2, §5.3, §8.1). The author's fixed, preferred and open ([D-03](../decisions.md)) are the same three.

**FIT-13. Fill the most constrained role first, and derive the rest from it.** `[analysis]`
- *Source:* Haralick and Elliott 1980 (try the choices most likely to fail first; abstract level); the Bethesda radiant-quest tutorial recommends starting from a "seed alias", often the location, then assigning the person to it (UESP, via search summary).
- *Instance:* Pick the place that has a boss, then make the thief that boss.
- *Scales:* E, G. *Layers:* 2.
- *Operationalise:* **Produce.** Order roles by candidate count, which a level-set query gives cheaply ([DS-49](../design-seeds.md)). The same order is the one that fails soonest, so an impossible cast is found cheaply. *Status:* a transfer from search theory; **[hypothesis]** that it helps here.

**FIT-14. Dry-run the whole cast before committing anything, and check again when it plays.** `[shipped]`
- *Source:* RimWorld's quest generator runs a root node's test against an emulated slate and uses the script only if that passes; Crusader Kings 3 events evaluate a `trigger` before the event fires and recommend list checks over candidates there, because scopes made later are not available; Creation Kit aliases fill top-down, so an alias that depends on another must sit below it.
- *Instance:* A quest script that cannot find its pawn is simply not used.
- *Scales:* E, G. *Layers:* 2.
- *Operationalise:* **Produce.** A hypothetical is a cheap fork of the model ([foundation §5](../foundation.md)). Commit pins only when every role passes. At play time, re-check the *required* constraints, since the state may have moved in between.

**FIT-15. A named character from the game is bound by identity and checked for availability. It is not searched for.** `[corpus]`
- *Source:* [Main-story state](../../../knowledge/main-story-state.md) (the game records a character's fate as one fact, and some are written by scenes long after the event); Sasko on The Witcher 3's Battle of Kaer Morhen (about sixteen characters could attend, seven or eight always, and the designer had to check particular pairings and earlier paths) via Game Developer and GamePressure.
- *Instance:* `q112_takemura_dead` reads 0 both when Takemura is alive and before the quest that decides it; so "alive" must be asked together with "the deciding quest is done".
- *Scales:* G, A. *Layers:* 2.
- *Operationalise:* **Check.** A fixed role gets an availability predicate (FIT-44). Precedence matters: an authored pin is 400, a game reading 500, an observation 600 (S0 §4.1). If the game's facts contradict an authored "fixed" part, arbitration quietly rejects the lower one and reports "ok" unless the loser has precedence 600 or more (S0 §5.2). **The fitter must therefore ask, via the trace, whether any of its fixed parts was rejected.** This is the finding behind requirement 12.

**FIT-16. A small authored cast of anchors gives continuity; open roles hang off them. A fixed giver with everything else open reads as repetition.** `[shipped]`
- *Source:* Legion (authored non-playable anchors, mostly antagonists, give the procedural cast shared goals and a common memory; early fully procedural prototypes lacked story momentum; a later expansion broke the "anchors are not playable" rule, which was costly); Austin (Wildermyth). The Fallout 4 case (one giver, a settlement chosen from a list) comes from the failure lens and forum threads, so it is **anecdotal**.
- *Instance:* Legion's recruitment missions are the only place the team could tell a story about one specific non-anchor person.
- *Scales:* A mostly. *Layers:* 2, 4.
- *Operationalise:* **Produce.** A role is marked `anchor` (bound by identity, authored, stable) or `open` (cast). Check the ratio in a pack, and check that an anchor-only seed varies something besides the place (FIT-42).

**FIT-17. Authored text may assume only what the role's required constraints guarantee. Everything else degrades to a default.** `[shipped]`
- *Source:* Legion (writers could not assume age, gender, occupation or traits, and so could not refer to them); Austin ("opportunistic variation": lines vary by personality or relationship when known).
- *Instance:* A line that says "your old friend" only when the role requires an existing bond.
- *Scales:* E, G. *Layers:* 4.
- *Operationalise:* **Check.** Every attribute a line uses must be implied by the role's required constraints or have a default form. This is a static check on the seed. It is also the safeguard against clichéd casting on traits (§4.5).

**FIT-18. Every role says what happens when it cannot be filled.** `[shipped]`, ladder `[hypothesis]`
- *Source:* Creation Kit (a required alias that cannot fill stops the quest; an optional one does not; the troubleshooting advice is to mark all aliases optional to find the one that fails); Crusader Kings 3 (an option can be a fallback that shows only when no other option's trigger passes; on-actions have a fallback too); Wildermyth's `StepC_Event` takes a list of events that "acts as a set of fallbacks"; Wildermyth events do not fire without a suitable party.
- *Instance:* A romance seed's "confidant" role is optional; its absence removes one scene, not the seed.
- *Scales:* all. *Layers:* 2.
- *Operationalise:* **Produce and check.** The ladder, each rung authored or defaulted: *wait* (hold the seed while the window is open); *relax* a preferred constraint, in a stated order; *stand in* (generate a minor figure the seed's constraints allow); *shrink* (the role becomes a mention or an off-screen presence); *withdraw*. The default is wait, then withdraw. A simulation over sampled states must find no seed that ends with an undefined outcome.

**FIT-19. Cast against commitments: a character or place cannot be in two scenes at once, but may belong to several threads.** `[analysis]`
- *Source:* Creation Kit's "reserves reference" flag keeps a filled reference from other quests' aliases unless they allow it (via search summary); Alexander 1965 (real cities overlap like a semilattice, and tree-shaped plans cut the overlaps; he adds that the overlap must be the right kind).
- *Instance:* A confidant who is also in an unrelated thread, but cannot be in two places at once.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce and check.** Reservation records on a binding, for a span of game time. The kernel's context frames carry an actor's commitments (S0 §10). Test: the share of persistent characters in two or more live threads against the sense of an interconnected world ([hypothesis]).

**FIT-20. Casting shows its reasons, so an author can pin or reject a fill.** `[practice]`
- *Source:* Evans and Short 2014 (an inspector gives the author runtime access to the simulation's state); Short 2016 (players lose track of why content is offered); Nelson et al. 2006 (trade-offs between conflicting goals are hard for an author to specify in advance).
- *Instance:* "Chosen because: quiet at this hour (high), in the preferred district (medium), no police nearby (required)."
- *Scales:* all. *Layers:* 2, tooling.
- *Operationalise:* **Produce.** The kernel's `trace` and `explain` list every constraint as active or rejected, the feasible set's size, and each weight's effect on the winner (S0 §13). The fit report is built on them.

### 3.3 Fragments that survive any order and any context (AUT-03, with node-based design)

**FIT-21. Each fragment states its preconditions locally and tolerates any order of arrival. Test by shuffling.** `[practice]`
- *Source:* Ingold, "Narrative Sorcery", GDC 2017 (abstract only: the Sorcery! series and 80 Days use defensive logic so the story reads coherently however a player reaches a scene); Short 2019.
- *Instance:* inkle's open-world story games, where players meet content in any order and hundreds of consequences persist.
- *Scales:* E, G, A. *Layers:* 4, evaluation.
- *Operationalise:* **Check.** In the offline prototype, play each pack's fragments in many random orders and states; flag dead ends and contradictions. The cost of defensive writing is bland, over-explained text and time spent checking; a good test finds the real gaps.

**FIT-22. A shared flag has one writer and a namespace. A seed writes only its own.** `[shipped]`
- *Source:* RED Modding wiki (a fact is a named integer that does nothing by itself; names start with the quest code; changing one fact to fix a problem often causes unpredictable trouble later, as when a repaired phone call broke an elevator in the final quest; the Delamain choice is read in three places).
- *Instance:* `sq027_panam_lover` is written by one chain of side quests and read by the roof scene, the Nomad route and Phantom Liberty.
- *Scales:* all. *Layers:* 2, 4.
- *Operationalise:* **Check.** A registry of fact writers, with a static check for a fact with two writers. Seed effects land in the seed's own namespace and as committed pins, never in the game's. See FIT-49.

**FIT-23. Every conclusion the story needs has at least three independent routes.** `[practice]`
- *Source:* The Alexandrian's Three Clue Rule (a single missed or misread clue stalls a scenario; three give redundancy; the rule is about *access*, not whether the players will find a clue; the clues must be genuinely distinct routes); GUMSHOE (core clues are given without a roll, with extras bought; secondary sources); Short 2016 (a quality-based system handles "find three clues in any order" with about four storylets).
- *Instance:* A witness, a camera log and a pawn-shop receipt, any two of which locate the person.
- *Scales:* G, A. *Layers:* 4.
- *Operationalise:* **Check.** For each declared conclusion, count the routes of distinct kind. Remove each in turn; the conclusion must stay reachable. Three copies of one lead fail the check.

**FIT-24. Build from nodes and leads, not a line. No node is a dead end.** `[practice]`
- *Source:* The Alexandrian (nodes point to nodes; the inverse of the three-clue rule: any three clues reach at least one conclusion).
- *Instance:* A campaign treated as nodes linked by clues.
- *Scales:* G, A. *Layers:* 2, 4.
- *Operationalise:* **Check.** Any node can be entered from at least two others; every node has an exit. Alexander's semilattice (FIT-19) is the same shape.

**FIT-25. Core information can be written without a place, and placed at cast time.** `[practice]`
- *Source:* Mike Shea (secrets and clues are single short sentences kept abstract from where they are found, to drop wherever they fit); [DS-13](../design-seeds.md).
- *Instance:* "The shipment was rerouted through the old tram depot", delivered by whoever or wherever suits.
- *Scales:* E, G. *Layers:* 2, 4.
- *Operationalise:* **Produce.** A clue declares "any place or person satisfying X"; the caster binds it late.

**FIT-26. Never trap the player, and let them retreat and rejoin.** `[practice]`
- *Source:* Failbetter's guidelines (linked events can break the game; plan for players who back out and make sure they can rejoin; use "must" events sparingly, with minimum and maximum requirements so nobody is trapped).
- *Instance:* A chain that offers a way back to the right track after the player declines a link.
- *Scales:* G, A. *Layers:* 4, evaluation.
- *Operationalise:* **Check.** Every multi-step chain declares how to rejoin and how to skip. Simulate a player who declines each step.

**FIT-27. Each scene stands alone for the reader who meets about a third of the material.** `[empirical]`, transfer `[hypothesis]`
- *Source:* Serrell's tracking of 110 exhibitions (visitors stop at about a third of elements; known only from summaries of the book); Tilden (relate the thing to the visitor); Sasko, GDC 2023 (deliver important information in focused, isolated moments); Failbetter's reminder branches.
- *Instance:* A scene that carries its own one-line recap and one idea.
- *Scales:* E, G. *Layers:* 4.
- *Operationalise:* **Check.** Read each scene alone, with only its declared context, and ask whether it makes sense. The one-third figure comes from museums; whether it holds for a game is untested here.

**FIT-28. Content must tolerate being half-complete in a save and tolerate an update.** `[hypothesis]`
- *Source:* RED Modding wiki (a changed fact has far-reaching effects); the lenses' claim that patches do not repair scripts baked into a save is **not verified**.
- *Instance:* A pack updated while a seed is mid-arc.
- *Scales:* A. *Layers:* 2, persistence (S0 §14).
- *Operationalise:* **Produce.** A seed carries a version and a policy for in-flight state: continue, migrate or withdraw gracefully. This is a map miss (§ map-miss log).

### 3.4 Capturing author intent for the open parts (AUT-04, NAR-08, CRA-10)

**FIT-29. Intent is purpose, end state and prohibitions, plus the purpose of the arc that encloses it.** `[practice]`
- *Source:* The US Army's article on commander's intent (a task, a purpose, critical factors and a vision of the end state; define the end state first; subordinates choose the ways and means within set parameters); the lens's reading of ADP 6-0 adds "two up", where each level also knows the purpose of the level above; Yu et al. 2021 (fifteen developers; purpose is one component of what a quest is).
- *Instance:* "Seize the bridge to stop the crossing": if the bridge is down, take the ford.
- *Scales:* all. *Layers:* 3, 4.
- *Operationalise:* **Produce and check, in part.** A structured record: purpose (tags and a sentence), end state (predicates over facts), must-not (predicates), parent purpose. The fitter's adaptation is acceptable if it reaches the end state and avoids the must-nots. Whether an adaptation is "on message" in purpose is a judgement; test it by agreement between an author's rating and a blind judge's. Mission command presumes trained subordinates with shared judgement; the engine has only what is encoded.

**FIT-30. Make the end state and the prohibitions mechanically checkable. Keep prose for people.** `[hypothesis]`
- *Source:* Derived from FIT-29 and Nelson et al. 2006 (the author encodes an aesthetic declaratively, as criteria that can be evaluated).
- *Instance:* End state: the seed's own "closeness" fact reached "declared" or "declined". Must-not: no beat that states V's feelings.
- *Scales:* all. *Layers:* 2, 3.
- *Operationalise:* **Check.** Predicates compile to kernel queries. Anything that cannot be written as a predicate stays as prose for the human reviewer and the fit report, and is not acted on by the engine.

**FIT-31. Capture the author's taste about the whole as weighted features, not as rules on every step.** `[practice]`
- *Source:* Nelson et al. 2006 (an author-specified evaluation function rates a sequence of plot points; a toolbox of features scaled 0 to 1, such as plot mixing, plot homing, the player's choices and how manipulative the drama manager's moves are; weighted into one score; the author finds the trade-offs hard to specify directly); the same paper credits Weyhrauch's 1997 thesis with the first automated evaluation function for a dramatic aesthetic (the thesis was not opened).
- *Instance:* "Prefer a long gap between the first two scenes" as a feature, not a rule.
- *Scales:* G, A. *Layers:* 3.
- *Operationalise:* **Produce.** The seed picks from a closed library of features (spacing, rest before, intensity, callbacks) and weights them coarsely. The director scores a candidate fit by them. Dossier 7 owns the director's features.

**FIT-32. A target intensity can be given as a curve, and each unit declares its effect on it.** `[shipped]`
- *Source:* Mateas and Stern 2005 (the sequencer picks the unused beat whose tension effect best matches the near-term trajectory of an author-specified tension arc).
- *Instance:* A quiet scene tagged low, a confrontation tagged high.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce.** A per-unit intensity effect and, optionally, a preferred position on an arc. It joins the director's tension budget ([DS-27](../design-seeds.md)).

**FIT-33. Theme is a commitment checked over a set of seeds, not over one.** `[analysis]`
- *Source:* Egri's premise as a thesis demonstrated in terms of behaviour (secondary summaries); the lens L12 on theme as a controlled variable (tag each story as supporting, opposing or complicating a shared premise; motifs reintroduced with a change). The lens found **no empirical study** of theme coherence in generated narrative. [Map](map.md) NAR-30.
- *Instance:* A premise such as "convenience eats consent", with each story tagged by how it argues it.
- *Scales:* A, set level. *Layers:* 3, evaluation.
- *Operationalise:* **Check, partly.** Tags come from the composite's closed vocabulary. The check is on a quota over a region or season, not on one seed, which avoids moralising in a single scene. Whether tagged sets read as more unified is **[hypothesis]**.

**FIT-34. Tone is a small closed vocabulary, with exemplars and must-nots. Test it by blind agreement.** `[hypothesis]`
- *Source:* None found for capturing tone as data. Nearest: genre as shared vocabulary plus structure (the map's SET-14); Tilden and Ham on one idea per element. This is our inference.
- *Instance:* Tone tags such as "guarded" and "restrained", an exemplar scene from the game, and "never played for laughs".
- *Scales:* all. *Layers:* 3, 4, 8.
- *Operationalise:* **Check, by judges.** The test: an author and a blind judge place the same fitted scene on the vocabulary and agree more often than chance. If they do not, the vocabulary is too loose.

**FIT-35. Preferred strengths are few and coarse: three levels.** `[practice]`
- *Source:* Short 2016 (numeric weights are hard to set from first principles and come from trial and error); Nelson et al. 2006; McCoy et al. 2011 (rules tuned by hand, guided by play-testing and metrics).
- *Instance:* Low, medium, high, mapped to fixed kernel strengths.
- *Scales:* all. *Layers:* 2, 6.
- *Operationalise:* **Produce.** The three levels map to `weight` strengths in S0 §4.1. The author pins from the fit report (FIT-36), not by tuning numbers.

**FIT-36. Show the author the consequences across sample states, and let them pin what they like.** `[practice]`
- *Source:* Short 2016 (rigorous testing of salience systems is hard; automated playthroughs and visualisation could find unused or overused content); Evans and Short 2014 (the author's tools included an inspector and the means to reproduce a run exactly); McCoy et al. 2011.
- *Instance:* A table of eight sample saves against when and where the seed fires and what was filled in.
- *Scales:* all. *Layers:* 6, tooling ([DS-43](../design-seeds.md)).
- *Operationalise:* **Produce.** Run the fitter across sampled states under fixed seeds and report fill rate, timing, chosen cast, connecting material and "no fit, and why". Pinning turns an open or preferred part into a fixed one.

**FIT-37. A seed has the shape of a good pattern: context, forces, a solution, and an instance left open, linked up and down in scale.** `[analysis]`
- *Source:* Alexander and colleagues 1977 (each pattern states a problem in context and a solution, and links to larger patterns it helps complete and smaller ones that complete it; the authors treat each as a hypothesis, with asterisks for confidence; excerpts only); the lens L11 (match on *forces*, the tensions that must be present; unfold large to small; allow overlap).
- *Instance:* A heist pattern containing "the inside man" and "the getaway", itself inside a faction arc.
- *Scales:* all. *Layers:* 2, 4, composite.
- *Operationalise:* **Produce, in part.** A seed's *situation of use* is its window and its needs; its *forces* are a short list of tensions that must be present in the world (a debt, a rival, a witness) and can be matched as predicates; the *solution* is the authored fragments; the *instance* is left to casting. A seed names its parent and children, which makes refinement of a larger seed into smaller ones an explicit link. Limits: the patterns concern static settings; the 1977 patterns were never systematically tested; the "forces match" idea is **[hypothesis]** for stories.

### 3.5 Fitting, adaptation and fallback (SEL-05, SEL-08)

**FIT-38. Adapt by small, costed edits, and have an explicit "cannot adapt".** `[analysis]`
- *Source:* Tearse et al. 2014 (Skald, a rebuild of Minstrel: the story library, templates and recall system had to be tuned to each other; costs on transformations and pruning of unsuccessful moves eased the brittleness; abstract).
- *Instance:* Move a scene to the next district: cheap. Change the giver's motive: costly. Change the end state: refuse.
- *Scales:* G. *Layers:* 3.
- *Operationalise:* **Produce and check.** Each edit class has a cost; a total above the author's threshold means "not offered". Test: acceptance by adaptation distance.

**FIT-39. Seeds declare their adaptation points, because the library and the operators must be tuned together.** `[analysis]`
- *Source:* Tearse et al. 2014 (same finding).
- *Instance:* "The place, the hour and the go-between may vary; the two lines in scene 3 may not."
- *Scales:* G. *Layers:* 4.
- *Operationalise:* **Check.** The fitter may change only what a seed lists, and the fit report names every change it made.

**FIT-40. Generate, then check, then offer.** `[analysis]`
- *Source:* MEXICA alternates engagement and reflection (lens L8, not opened); RimWorld's dry run (FIT-14).
- *Instance:* Propose a fitted scene; test its end state, its must-nots, role availability and window; only then schedule.
- *Scales:* E, G. *Layers:* 3.
- *Operationalise:* **Produce.** The fitter's last stage is a verifier over the FIT-29 triple and the FIT-18 ladder. Measure the fraction of proposals rejected at the check and judged poor by readers when forced through.

**FIT-41. Causal bookkeeping is kept only as deep as the library can bridge. Do not plan from scratch.** `[analysis]`
- *Source:* Doran and Parberry 2011 (quest generation is a special case of planning, planning is NP-complete in general and PSPACE-hard in some forms, so general planning is impractical; they build from NPC motivations and strategies instead); Porteous et al. 2010 (author-stated state constraints as landmarks split a problem into smaller ones; abstract); Riedl and Young 2010 (every action explained by a character goal; not opened).
- *Instance:* To get V to the first scene, bridge with one of a few library steps (a message, a mention, an errand), at depth one or two.
- *Scales:* G. *Layers:* 3.
- *Operationalise:* **Produce, bounded.** A unit's needs and effects form a graph; the fitter searches for a bridge of at most a few library steps from the current state to the unit's needs, or reports none. Authors need no full action model. Planner-grade guarantees are not claimed.

**FIT-42. A hook tied to V's own history lifts a filled template into content, and callbacks land hardest after a gap.** `[practice]`
- *Source:* Sasko, GDC 2023 (bring early choices back much later; make consequences visible; subtle ones are often not worth the cost); Nesmith (players tired of non-story job quests and the team made more hand-crafted content); Tilden's first principle (relate what is shown to the visitor's own experience; secondary).
- *Instance:* A message that refers to what V did at the end of a specific earlier quest.
- *Scales:* E, G. *Layers:* 3.
- *Operationalise:* **Produce and check.** The fitter attaches at least one history-linked hook drawn from observed pins or declares that none exists. A callback must name the act that caused it (D-09: observed, never assumed). Lens claims that place-only variation goes unnoticed are unverified here.

**FIT-43. Keep the authored spine authored. The fitter works at the joints.** `[practice]`
- *Source:* Nesmith (a system-driven main storyline "would play horribly"; templates were kept to job quests); Legion's anchors; [D-03](../decisions.md).
- *Instance:* The fitter may add a lead-in and a pointer, never rewrite a scene the author fixed.
- *Scales:* G, A. *Layers:* 3, 4.
- *Operationalise:* **Check.** Fixed parts are immutable to the fitter. Everything it adds is tagged as fitter-supplied, so it can be shown, switched off by the latitude setting ([DS-36](../design-seeds.md)) and traced.

**FIT-44. A story window is a predicate over the game's facts, with a distinct opening and closing, evaluated with three outcomes (yes, no, maybe), and carrying its reading cautions.** `[corpus]`
- *Source:* [Main-story state §8](../../../knowledge/main-story-state.md) (a window is a condition on facts; a never-set fact reads 0, so "alive" read as `_dead == 0` is also true before the event; some facts are written long after the event); S0 §8 (a predicate's verdict is `yes`, `no` or `maybe`, and `maybe` is allowed when in doubt). All fact meanings on that page are [hypothesis] until the game confirms them.
- *Instance:* "While he is alive": `q112_done > 0` and `q112_takemura_dead == 0`.
- *Scales:* G, A. *Layers:* 2.
- *Operationalise:* **Produce and check.** A window has `opens when`, `closes when`, and reading guards ("only if X has happened"). A `maybe` blocks a firing but not planning. The game-session card in the main-story page lists the checks that would confirm each fact.

**FIT-45. When the closing event is the player's to trigger, the window has no calendar. Offer early, keep the hook cheap, and have a graceful form ready.** `[hypothesis]`
- *Source:* [Main-story state §6](../../../knowledge/main-story-state.md) (the point of no return is one fact, set when V meets Hanako at Embers, with a warning and an autosave per a community guide; it fails 19 journal quests); inference from Ubisoft's attention system (requests carry a relevance window). The same page shows `q112_hanako_meeting_set_up` is written in the same scene that finishes `q112`, so it is already true the moment the window opens and is no warning of the close.
- *Instance:* A window of days or of weeks, closed by V walking through a door.
- *Scales:* G, A. *Layers:* 2, 3.
- *Operationalise:* **Produce.** A seed declares a lead-time preference: "fire early in the window" or "fire when the window is nearly over". The fitter can raise urgency from signals that are readable: time since the window opened, and V's distance from the place that triggers the close (a position reading, not a fact). No fact that warns of the close was found. It cannot rely on the game's own warning.

**FIT-46. Say what happens when the window closes first: withdraw, degrade, coda or turn into a memory.** `[hypothesis]`
- *Source:* Failbetter's guidelines (plan for the player who backs out, and return them to the right track); the corpus: gig briefs fall back to a thread entry if a call is muted or content is locked ([gig decompositions](../gig-decompositions.md)); the game fails or closes whole quests at the point of no return.
- *Instance:* After the first scene but before the last, a short authored coda by message, so no thread dangles.
- *Scales:* G, A. *Layers:* 2, 4.
- *Operationalise:* **Produce and check.** Four named forms: *withdraw* (nothing played yet; leave no residue); *degrade* (play a shorter authored form); *coda* (an authored closing beat by a lesser channel); *memory* (leave a belief or fact that later content can call back). Default: withdraw if nothing has played, coda if something has. Simulate the window closing at every step and check that every seed ends in a named form.

**FIT-47. Deliver through a ladder of channels, and write for the poorest rung.** `[corpus]`
- *Source:* [Gig decompositions](../gig-decompositions.md) (a gig's holocall brief has a thread-entry fallback when calls are muted or content is locked); [player channels](../../../knowledge/player-channels.md) (journal entries cannot be created from script; a journal-free phone thread can be injected; calls need a journal contact; the scanner and shards have their own limits).
- *Instance:* A call if the contact and the moment allow it, a message otherwise, an overheard line or a shard if the phone is blocked.
- *Scales:* E, G. *Layers:* 3, 8.
- *Operationalise:* **Produce and check.** Each fragment lists its channels in order and the lowest acceptable rung. A fragment that works only at the top rung is flagged. Dossier 20 and P8 own the channel details.

**FIT-48. Timing is arbitration: a unit asks for presentation with a priority, a relevance window and an attention cost.** `[shipped]`
- *Source:* Ubisoft on Legion's Player Attention System (missions submit requests with a priority, a relevance window and the attention they need; it weighs them against what the player is doing; built after side missions interrupted story cliffhangers).
- *Instance:* A quiet scene held until V is not in combat and is not near a major beat.
- *Scales:* E, G. *Layers:* 2, 3.
- *Operationalise:* **Produce.** A seed's timing request is data; the scheduler decides. Dossier 7 owns the arbiter.

**FIT-49. Offers, never impositions: V may decline, and V's feelings are never stated for V.** `[hypothesis]`, decision `D-09`
- *Source:* [D-09](../decisions.md) and [foundation §5.3](../foundation.md); Nesmith (a realistic response is not necessarily a good game response). The evidence home is dossier 9 (agency).
- *Instance:* An invitation that V can ignore, or accept in any of several stances.
- *Scales:* all. *Layers:* 2, 3, 4.
- *Operationalise:* **Check.** The language has no construct for asserting V's inner state. A static check flags authored text that does so. Declining is a legal end state in a seed's intent record.

**FIT-50. A seed may write only its own state. It must not write the game's.** `[corpus]`
- *Source:* [Main-story state §4 and §5](../../../knowledge/main-story-state.md) (the final boards read some twenty-five character facts; four romance facts are written by their own side quests and copied at the roof scene; Phantom Liberty and the aftermath read the lover facts).
- *Instance:* A Takemura seed must not set `sq030_judy_lover` or any `*_romance_chosen` fact.
- *Scales:* all. *Layers:* 2.
- *Operationalise:* **Check.** Effects target the seed's namespace and committed pins. A write to a game-owned fact needs an explicit capability. This also keeps FIT-22 true.

**FIT-51. Say early what cannot be expressed.** `[corpus]`
- *Source:* [DS-45](../design-seeds.md); [player channels](../../../knowledge/player-channels.md); [plan §6](../plan.md) on voices (nothing is cloned: reuse the game's own lines or use consenting performers).
- *Instance:* New voiced lines for a vanilla character; intimate scenes needing new animation.
- *Scales:* all. *Layers:* 6, 8.
- *Operationalise:* **Check.** Each game port reports its capabilities ([DS-46](../design-seeds.md)); the seed is linted against them with plain-English messages at authoring time.

## 4. Failure modes and critiques

### 4.1 Requirement explosion

- **Rules outgrow tuning.** Prom Week ran on over 4,900 unique influence rules, nearly 100 microtheories, 30 social exchanges with more than twenty rules each, and an 18-character cast, tuned "manually … guided by play testing and metrics" (McCoy et al. 2011, read). The authors list machine-learning diagnosis as future work.
- **Hand-edited data stops scaling.** Sunless Sea reached about 250,000 words and 415 illustrations; hand-edited JSON files "became very hard to manage" and the team wished it had built tools earlier (Kennedy 2015, read).
- **A reused engine accumulates special cases.** The first combat system reused StoryNexus code meant for social interaction; exceptions piled up until most of it was hardcoded (Kennedy 2015).
- **Qualities multiply.** Failbetter's own rule is to keep them to the fewest that keep content stable; extra ones add bugs and clutter (writer guidelines, read).
- **Variant axes multiply cost.** Sasko's Kaer Morhen quest: about sixteen possible characters, seven or eight always present, with pairings to check. Legion adapted every mission script into twenty persona variants. Both are cases of one axis multiplying every scene.
- **Hand-bookkept arcs.** Short names this as quality-based narrative's weakness: authors set series of qualities by hand to track a multi-step arc.
- **Authoring effort caps the content.** Façade needed about three person-years of authoring and ended with 27 beats, far less global agency than hoped (Mateas and Stern 2005, read).

### 4.2 Starvation

- Wildermyth: strict casting means most events never appear (Austin, read).
- A small pool feels unrewarding until it grows (Short 2016; Kreminski survey as summarised by Short).
- Deck frequency matters most in small decks (Fallen London wiki).
- A rule database with uncovered states returns nothing (Mímir README).
- A required alias that cannot be filled stops a quest from starting (Creation Kit, via search summaries). The remedy is a tooling habit (mark aliases optional to find the culprit), which shows how silent the failure is.
- Nesmith restricted job quests to fitting NPCs; that narrowed the pool deliberately to protect quality.

### 4.3 Repetition

- **Fallout 4's settlement quests** became a byword; the failure lens cites a critic and forum threads for a giver who keeps assigning the same kind of job with one repeated line. This evidence is anecdotal, and the sources record no design statement. (Lens L2, A3.)
- **Skyrim** needed custom lines per NPC voice type to cut repetition, and some reactions fired too often until conditioning limits were widened (Nesmith, read).
- **Sunless Sea** exposed text meant to be read once to repeat exposure through permadeath (Kennedy 2015, read).
- **Cause across cases:** the offer generator has no memory of what it offered (FIT-05), and the fixed part is the giver while the variation is only the place (FIT-16, FIT-42).

### 4.4 Authoring cost, tooling and testing

- Façade's 27 beats and Legion's heavy cross-checking by writers (each writer had at least one persona and a set of missions; the structure was "labor-intensive") show the cost of variants.
- Short on salience systems: weights are tuned by trial and error; testing is hard; automated playthroughs and visualisation could help.
- Versu's authors report producing an order of magnitude more behaviours than Façade in a shorter time by choosing text output and an authoring language (Evans and Short 2014, read). That is a design choice, not free.

### 4.5 Casting on traits

- Legion's team notes that generating a person from a job risks reinforcing stereotypes, so it sometimes starts from other traits (lens L2, A6, from a Game Developer article; our fetch of the article did not show this). A review of Wildermyth, seen only in a search summary, says its personality-based roles can feel forced. **Principle FIT-17 limits what text may assume; the ethics half belongs to dossier 18.**

### 4.6 Timing and arc

- Salience picks can end a story by accident (Short 2016).
- Legion's missions interrupted each other, and its attention system came after side missions broke cliffhangers (Ubisoft).
- Pacing by intensity alone, calibrated on action games, can read as a rhythm generator (lens L4, field 25).

### 4.7 Brittle adaptation and planning

- Minstrel's library, templates and recall system had to be fitted to each other (Skald).
- Planning needs a full action model, closed-world assumptions and short test stories; no open-world deployment was found (lens L8, fields 6 and 7; Doran and Parberry for the complexity argument).

### 4.8 Capturing intent

- Evaluation functions are hard to author: "difficult for an author to manually specify" the trade-offs (Nelson et al. 2006). Their result assumes the author specified their aesthetic well, and the check of that assumption with real players is left as future work.
- Mission command presumes trained subordinates; story purposes are fuzzier than a military end state; the world is not an adversary (lens L11). The Army article stresses that intent must be clear and well-prioritised.
- There is no agreed definition of a quest (Yu et al. 2021), so any purpose vocabulary is ours to define and test.
- Premise-first craft risks moralising; a premise so vague that nothing can violate it checks nothing; every story arguing one side (lens L12).

### 4.9 Robustness

- Editing a fact to fix one problem can break a later quest (RED Modding wiki).
- Defensive writing can be bland, costs time, and can mask real bugs (lens L9, field 15).
- A story arriving in any order must carry its own context, or players reconstruct the wrong story.

### 4.10 Critiques of the disciplines themselves

- **Storylets.** The term is disputed; the structure offers no arc by itself; selection can be opaque (lenses L9 and L8).
- **Pattern languages.** The 1977 patterns are static-setting hypotheses never systematically tested; "A City Is Not a Semilattice Either" (Harary and Rockey 1976, seen only as a citation in search results) argues that a city is neither a tree nor a semilattice.
- **Three clues.** Redundancy is only real if the clues are distinct, and the rule is about access, not discovery.
- **Heritage interpretation.** Tilden's principles are craft lore; museum visitors are self-selected; the one-third figure is from exhibits.
- **Case-based adaptation.** Early claims of creativity were overstated (lens L8).

## 5. Tensions with other disciplines and between principles

| Tension | Between | Suggested resolution |
|---|---|---|
| Specificity is not importance | FIT-04 against FIT-06 | Specificity ranks within a tier; the arc check and the director's priorities decide across tiers |
| Defensive text against good prose | FIT-21, FIT-27 against the hand-made feel (EXP-02, dossier 21) | State required context once per scene in an author-written recap; test for bland over-explanation with blind readers |
| Strict casting against variety | FIT-11 against NAR-10 and PER-08 (dossier 5) | Ladder (FIT-18): relax preferences before relaxing required |
| Fixed authored parts against the game's own state | FIT-15, FIT-44 against kernel precedence | Fixed means "mine to keep", not "guaranteed". The fitter reports a rejected fixed part as an unfillable seed |
| Redundant clues against authoring cost | FIT-23 against §4.4 | Reuse clue kinds across seeds; the clue is a short abstract statement (FIT-25), not a scene |
| Coarse strengths against author control | FIT-35 against author wish for exact weights | Pinning from the fit report (FIT-36) is the fine control |
| Intent that can be checked against intent that matters | FIT-30 against FIT-29's purpose | Keep both; the engine acts only on the checkable half |
| Offers never presume against a romance that needs V's interest | FIT-49 against R1 | Offer in stances, accept any response, make "no" a clean end (§8) |
| Template spine against procedural reach | FIT-43 against sowing (layer 3) | Authors mark "let this grow"; the spine stays fixed |
| Window early against hook readiness | FIT-45 against FIT-42 | A cheap hook first (a message), a history-rich hook in a later beat |

## 6. Lateral links

- **A casting query is the kernel's own query.** `must` and `prefer` in S0 §8.1 are FIT-12's required and preferred. A seed is "a partly resolved quest" ([foundation §6](../foundation.md)).
- **The game's facts are already qualities.** Named integers that read 0 when unset and are tested by comparison are what quality-based narrative uses. The game's quests are, at the state level, a quality-based system; the engine can read them as one.
- **Commander's intent is the author-priority triple plus a reason.** Fixed, preferred, open; the intent adds purpose, end state and prohibitions.
- **A pattern's forces are a seed's needs.** Alexander's "forces that must be present" and a storylet's prerequisites are the same job at different scales.
- **Dry run and fork.** RimWorld's emulated slate, a Crusader Kings trigger and the foundation's "what if V helps?" fork are one idea: test on a copy.
- **Three clues and the semilattice.** Redundant routes and overlapping membership are both ways of refusing a tree.
- **Exhibit design and scene design.** Visitors who stop at a third of the elements and players who meet a third of a pack's fragments pose the same problem.
- **Versu's bird's-eye practice and the kernel's seed.** Both are written once, for every role.

## 7. Open questions

1. **Does authoring in roles scale to a modder?** Wildermyth and Legion had teams. P6 should test a one-person pack.
2. **How many levels of strength are enough?** Three is a guess (FIT-35). Test with real authors.
3. **Can tone be captured at all as data?** FIT-34 has no source. A small blind-agreement trial with a closed vocabulary would answer it.
4. **How deep can bridging go?** Depth one or two is assumed (FIT-41). Measure acceptance by depth in the offline prototype.
5. **Does the hook rule hold?** Is a history-linked hook rated better at equal quality? Dossier 12 and the evaluation work can test it.
6. **Hades.** Its unseen-first rule is cited by three lenses, and the talk is gated. If a legitimate recording or a developer interview with the mechanism turns up, verify FIT-05.
7. **Do fixed parts need a separate "must hold or withdraw" flag?** Kernel arbitration lets a lower-precedence constraint lose quietly. The seed language may need a "withdraw if rejected" mark (requirement 12).
8. **Multiple windows.** Can one seed have several (a main-story window and an epilogue window)? §8 lists an instance.
9. **How are coda and degraded forms priced?** If they cost as much as the full seed, authors will not write them. Test the effort in P6.
10. **What does the one-third figure mean for a game?** Serrell's figure is from exhibitions and known here only second-hand. A direct measure in play sessions is cheap.
11. **Are the main-story facts right?** Every window in §8 is [hypothesis] until the booked game-session card in the main-story page is run (its rows 2 to 4, 7 and 11 cover R1).
12. **Is there any readable warning that the close is near?** None was found among the facts. If none exists, urgency rests on time and position, and the seed language needs a position-based urgency signal (requirement 19).
13. **Where is Takemura in the window, and is he "free"?** No fact says. An in-person scene needs a probe through the bridge; until then R1 uses a channel that does not need his body.

## 8. Worked example: reference scenario R1

R1 is an authored side quest with a romance option for a main-story character ([plan §2](../plan.md#2-the-system-at-first-level)). The example below is **invented for this dossier** to test the representation. It is not content, and nothing in it is kept. The seed is called "the Takemura seed". The notation is illustrative only; the syntax is P4's job.

### 8.1 What the author wants (the intent record, FIT-29)

| Part | Author's statement |
|---|---|
| Purpose | A guarded closeness between V and a man whose old loyalty has ended, finding whether trust built in a crisis survives ordinary life |
| End state | The seed's own closeness fact reaches one of two named rungs, "declared" or "declined" |
| Must-not | No line that states how V feels; no intimate scene before the second rung; no write to any game-owned fact; nothing while V is in combat or wanted |
| Parent purpose | "A character the main story leaves unresolved gets a quiet life of his own" |
| Tone | Reserved, dignified, understated; an exemplar scene from the game's own quiet beats; never comic |
| Theme tag | Complicates a premise of duty against desire |

How closeness grows rung by rung, and when a rung may be offered, is the subject of dossier 2 (REL-01 to REL-04) and its consent floor (ETH-08, dossier 18). This dossier needs only that a seed can name its rungs and make facts of them.

### 8.2 What is fixed, preferred and open

| Part | Status | Strength | Why, and the principle |
|---|---|---|---|
| The character: Takemura, by identity | **Fixed** | | Anchor bound by identity (FIT-15, FIT-16) |
| V | **Fixed**, and not cast | | The player; observed, never owned (D-09, FIT-49) |
| The subject: a possible romance | **Fixed** | | The seed's reason to exist |
| Authored scenes S1 (first contact), S2 (a shared errand), S3 (a quiet evening), S4 (a decision) | **Fixed text** | | The spine stays authored (FIT-43) |
| Order: S1 before S3 before S4; S2 optional between | **Fixed** order, S2 **preferred** (medium) | | Nodes, not a line (FIT-24) |
| The setting of S3: a quiet place | **Preferred** (high) | high | Tone depends on it |
| District of S3 | **Preferred** (medium) | medium | Author's taste, relaxable |
| Time of day of S3 | **Preferred** (medium): evening | medium | |
| Weather, crowd detail | **Open** | | |
| A confidant who notices (role) | **Open**, optional | | Texture; absence costs one line (FIT-18) |
| The hook: why V is contacted now | **Open**, with a **preferred** (high) history link | high | Fitter supplies it (FIT-42) |
| Connecting material between scenes | **Open**, within a latitude | | Allowed: a message, a mention. Forbidden: new words for Takemura beyond the authored ones (FIT-43, FIT-51) |
| Channel for S1 | **Preferred** (high): a message from Takemura's contact; fallbacks below | high | Lowest rung that works (FIT-47) |
| When it fires | **Open**, with lead-time **preferred** (high): early in the window | high | The close is V's (FIT-45) |
| Fallback if the window closes | **Fixed**: authored coda | | FIT-46 |

### 8.3 The story window as facts (FIT-44, FIT-45)

All fact meanings below are from the [main-story page](../../../knowledge/main-story-state.md) and are [hypothesis] until the game session checks them.

| Window part | Expression | Caution |
|---|---|---|
| Opens | `q112_done > 0` and `q112_takemura_dead == 0` | `_dead == 0` is also true before the event, so the first test is needed. `q112_done` is an "add" fact: test `> 0`, not `== 1` |
| Closes (hard) | `q115_point_of_no_return > 0` | Set when V meets Hanako at Embers; 19 journal quests fail. The game's own text messages from the Nomad route depend on it |
| Early warning of the close | **None found** | `q112_hanako_meeting_set_up` is written by the scene that ends `q112`, so it is already true when the window opens; it only says the way to Embers is open. Urgency has to come from time since opening and V's distance from the trigger place (a position reading) |
| "Allied" and "free" | **No fact found** | The files name no such fact. Treated as `maybe`; the first channel (a message) does not need his body. In-person versions need a probe |
| V's partner | `sq027_panam_lover`, `sq028_kerry_relationship`, `sq029_river_lover`, `sq030_judy_lover` | Read only (FIT-50). They select a variant (§8.6). The page notes these facts may also cover friendship, so a value above 0 is not proof of a romance |
| Competing content | `ep1_active > 0` | Phantom Liberty content competes for attention in the same stretch; the scheduler handles it (FIT-48) |

The game's own signals: `contacts/takemura` exists as a journal contact, and after the story event it holds a conversation (`q112_09_takemura_alive`), and a phase named `q112_text_messages` tests his fate fact. So the phone is a channel the game itself uses with him in this stretch, and our messages would sit beside its own.

### 8.4 Casting

| Role | Binding | Required | Preferred | If it cannot be filled |
|---|---|---|---|---|
| `takemura` | By identity (the game character) | The window predicate yes (FIT-44) | Not in another scene; not reserved | Wait while the window is open; withdraw at close (FIT-18) |
| `v` | The player | | | Not applicable |
| `place_quiet` (S3) | Level-set query over the city | Low crowd; low police presence; reachable; not a combat site | The preferred district; evening; a place V has been | Relax district, then hour; never relax "quiet". If nothing, hold; if the window is near its end, play the degraded form or the coda |
| `confidant` | Open, optional | Someone V has met | A person with a recorded bond | Shrink: a mention; or drop |
| `go_between` (the channel) | Takemura's phone contact | Contact exists; phone not blocked | | Next rung (§8.5) |

Casting order is `takemura`, `place_quiet`, `confidant` (FIT-13). The cast is dry-run on a fork, then re-checked when S3 plays (FIT-14).

### 8.5 What the fitter decides

| Decision | Inputs | R1's result |
|---|---|---|
| When | Window open; lead-time preference; director's tension budget and attention state; no major beat nearby | As early as the arbiter allows after the window opens (FIT-45, FIT-48) |
| Why now | Observed pins about V and Takemura; what V has done since the window opened | A hook linked to a specific earlier act by V, named in the message (FIT-42) |
| Channel | The ladder in §8.4's last row; capability report | A message; failing that, a thread entry; failing that, the overheard rung only if the author allowed it |
| Where | Level-set query for S3 | A quiet place in or near the preferred district |
| Connecting material | Latitude setting; adaptation points the seed listed (FIT-39) | A short lead-in and a pointer, tagged as fitter-supplied |
| Check | The intent triple; roles; window; must-nots (FIT-40) | Offer, or "no fit, and why" |

### 8.6 Five story states

| State (illustrative) | What the fitter does |
|---|---|
| Early window: `q112_done > 0`, Takemura alive, no close signal, V has no partner fact | Offers S1 soon, by message, with a history hook. S2 optional. S3 once S1 has landed and a quiet place and evening are available |
| Takemura dead (`q112_takemura_dead > 0`) | The window never opens. The fit report says "not applicable: Takemura is dead", and the seed withdraws leaving no residue |
| Before `q112_done` | The seed waits (lifecycle: sown, waiting). No offer. It watches the one fact |
| Window open, V's position approaching the place that triggers the close | The window may be about to close. The seed uses its authored degraded form if one is declared (S1 then S4); otherwise it holds the coda ready. Nothing is forced |
| V has a partner fact above 0 | The seed does not write or contradict it. It selects its variant: a friendship ladder with the same scenes and no romantic framing unless V takes the lead (FIT-49) |
| Past the point of no return when the pack is installed | Window already closed. Nothing is offered. An epilogue window is a separate authored option (§7, question 8) |

### 8.7 The fallback, in order

1. Before S1: withdraw silently (FIT-46).
2. After S1, before S4, window closing: the coda, an authored last message by the lowest rung that works, so no thread dangles.
3. After S4: nothing to do; the end state is reached.
4. Role failure: the ladder in §8.4.
5. Capability failure (no phone channel): a lower rung or withdrawal; the author is told at authoring time (FIT-51).

### 8.8 What R1 cannot promise (FIT-51)

- New voiced lines for a vanilla character (no cloning; text, reuse or a consenting performer).
- Intimate scenes needing new animation.
- Interplay with the vanilla romance state, except by reading it. The roof scene tests all four lover facts and writes the chosen ones; the seed must stay out of that.
- An in-person Takemura wherever the player is: he needs a staged character, which is a runtime question for the bridge.
- Journal entries for the seed: scripts cannot create them ([player channels](../../../knowledge/player-channels.md)).

### 8.9 What the representation depends on

| Element of the representation | Depends on | If the principle were false |
|---|---|---|
| Fixed, preferred and open parts | FIT-12, FIT-35 | The author could not say what they care about, or would tune raw numbers |
| The window as a three-valued predicate over facts | FIT-44 | The seed would fire in a save where Takemura was never met (the 0-reads trap) |
| A hard close the player triggers, and the lead-time preference | FIT-45 | The seed would wait for a calendar that never comes |
| Authored coda | FIT-46 | Threads would dangle |
| Role by identity with availability | FIT-15 | The caster would search the city for a man the game already has |
| A quiet place cast by a query, relaxable in an order | FIT-12, FIT-13, FIT-18 | The seed would either never fire or place the scene anywhere |
| Scenes that stand alone, with a recap | FIT-21, FIT-27 | Players who get S3 without S2 would be lost |
| Intent as end state and prohibitions | FIT-29, FIT-30 | The fitter could not verify its own work |
| History hook | FIT-42 | The seed would read as a filled template |
| Channel ladder | FIT-47 | The seed would fail whenever the phone is blocked |
| Own-namespace writes | FIT-22, FIT-50 | The seed would corrupt the game's endings |
| Offers, no statement of V's feelings | FIT-49 | The seed would speak for V |
| Fit report and pinning | FIT-20, FIT-36 | The author could not see what the fitter did across saves |
| Capability linting | FIT-51 | The author would find the limits only in play |

An illustrative sketch, not P4 syntax:

```
seed takemura.closeness  v1   pack: example
  intent:   purpose "guarded closeness, trust after crisis"
            end    closeness in {declared, declined}
            never  states-v-feelings, game-fact-write, intimate-before-rung-2, while(combat|wanted)
            parent "unresolved character gets a quiet life"
            tone   [reserved, understated] exemplar quest:<scene-id>
  window:   opens  q112_done>0 AND q112_takemura_dead==0   guard "q112 done"
            closes q115_point_of_no_return>0
            urgency-signal time-since-open, distance(v, close-trigger-place)
            lead: early (high)
  roles:    takemura  fixed(identity)  requires window
            place_quiet  query(quiet, low-police, reachable) prefer(district:medium, evening:medium)
                         on-unfilled: relax(district, hour); hold; degrade
            confidant  open optional  on-unfilled: shrink
  nodes:    S1 -> S3 -> S4 ; S2 optional   (each: needs, recap, repeatable:no, channels[msg, thread])
  hook:     open  prefer(history-link, high)  latitude: message, mention
  adapt:    place, hour, go-between may vary; S3 lines 4-9 may not
  on-close: before S1 withdraw ; after S1 coda(msg)
```

## 9. Requirements for the seed language (P4)

The seed language must be able to express the following. Each is traced to a principle.

**Parts and their status**
1. Every part of a seed has a binding status: **fixed**, **preferred** with a strength from a small ordered set (three levels), or **open**. Unstated parts are open. (FIT-12, FIT-35; [D-03](../decisions.md))
2. A seed has a stable identity, a version and a pack of origin, and its parts are addressable by name. (FIT-28, FIT-36)
3. The language has a place for notes on intent, tone and fallbacks beside each part. (FIT-29, FIT-34)

**Needs, effects and vocabulary**
4. Needs are predicates over declared facts. The language refuses undeclared fact names. (FIT-01, FIT-02)
5. A need can name an instance or a kind with constraints. (FIT-03)
6. Effects are declared. A seed may write its own namespace and commit pins. A write to a game-owned fact needs an explicit capability. (FIT-22, FIT-50)
7. General and specific variants of a fragment can coexist with a defined precedence, and the default is stated. (FIT-04)
8. Repeatability, recency and a frequency class are declared per fragment. (FIT-05)
9. Progress is held by the engine. Authors declare steps and what each requires; they do not declare progress flags. (FIT-08, FIT-09)

**Roles and casting**
10. A role is a typed slot with an identity or constraints, and the grade of each constraint (required, preferred, free). (FIT-10, FIT-12)
11. A role is marked `anchor` or `open`. (FIT-16)
12. A **fixed part rejected by higher-precedence game state** surfaces as an unsatisfiable seed, with a per-part "withdraw if rejected" mark. It must never yield silently. (FIT-15; S0 §4.1, §5.2)
13. Each role has an `on-unfilled` policy using the ladder (wait, relax in order, stand in, shrink, withdraw), with a defined default. (FIT-18)
14. Text can refer to role attributes in a way a checker can verify against the role's required constraints, with defaults. (FIT-17)
15. A role binding can claim exclusivity for a span of game time. Sharing is declared. (FIT-19)
16. Casting returns a ranked list with reasons and the number of candidates per role, and the order of casting can be hinted. (FIT-13, FIT-20)
17. A cast can be tried on a fork without effect, and re-checked at play time against the required constraints only. (FIT-14)

**Windows, timing and fallback**
18. A **window** is a predicate over facts with `opens`, `closes` and reading guards, evaluated yes, no or maybe. (FIT-44)
19. A seed can declare a lead-time preference and an urgency signal for a window the player closes. (FIT-45)
20. A seed can have more than one window. (FIT-44; §7)
21. A seed declares what happens at close and on cast failure: withdraw, degrade, coda, memory, with defaults. (FIT-46, FIT-18)
22. A seed states a timing request: priority, relevance window, attention cost and interrupt tolerance. (FIT-48)
23. A fragment lists its channels in order, the lowest acceptable rung, and the rung it was written for. (FIT-47)

**Robust fragments**
24. A fragment is a node with local needs, a short recap, repeatability and only the order constraints that are truly fixed. It names facts, never another fragment's internal state. (FIT-09, FIT-21, FIT-24, FIT-27)
25. A conclusion declares at least three routes of distinct kind, and the language can check the count. (FIT-23)
26. A fragment can say "any place or person satisfying X", resolved at cast time. (FIT-25)
27. A chain declares how to rejoin and how to skip. (FIT-26)
28. A seed names its parent and its child seeds, and the purpose of its parent. (FIT-37, FIT-29)

**Intent, taste and adaptation**
29. The intent record has purpose (tags and a sentence), an end state as predicates, prohibitions as predicates and the parent's purpose. (FIT-29, FIT-30)
30. Aesthetic preferences are chosen from a closed library of weighted features, with coarse weights. (FIT-31, FIT-35)
31. A fragment declares an intensity effect, and a seed may declare a preferred position on an arc. (FIT-32)
32. Theme and tone are tags from the composite's closed vocabulary, with a role for theme (supports, opposes, complicates), exemplars and prohibitions. (FIT-33, FIT-34)
33. A seed lists its **adaptation points** with a cost class each, and the language has an explicit "cannot adapt" outcome. (FIT-38, FIT-39)
34. A seed sets the **latitude** for connecting material: kinds allowed, kinds forbidden, and which parts are authored-only. (FIT-43, FIT-42)
35. A seed can ask for a history-linked hook, stating what kinds of history count. (FIT-42)

**Honesty, checking and tooling**
36. Every player-facing fragment is an offer with a decline path, and the language has no construct for asserting V's inner state. (FIT-49; D-09)
37. The language can be linted against a game port's capability report, with plain-English messages. (FIT-51)
38. The compiled seed can be run across sample states under fixed seeds to yield a fit report (verdict, cast, timing, chosen channel, connecting material, "no fit, and why"), and pins can be written back as fixed parts. (FIT-20, FIT-36)
39. The standard static checks exist: undeclared facts, multi-writer facts, unfillable roles in sample states, single-route conclusions, unreachable fragments, text attributes beyond the role's guarantee. (FIT-02, FIT-17, FIT-22, FIT-23)
40. All choices in casting and fitting are deterministic given the seed, the state and the injected random stream, and ties are explicit. (FIT-04; [D-06](../decisions.md))
41. A seed carries a version and a policy for in-flight state when its pack updates: continue, migrate or withdraw. (FIT-28)

## Map-miss log

| Field met | Source | Suggested tier |
|---|---|---|
| **Constraint-satisfaction view of casting** (variables, constraints, search order, fail-first) | Haralick and Elliott 1980, *Artificial Intelligence* 14; RimWorld and Creation Kit casting | supporting |
| **Scoped event scripting in strategy and colony games** (triggers evaluated before scopes, fallback options, weighted root selection, dry-run) | Crusader Kings 3 event modding page; RimWorld quest scripting page. Partly in dossier 4's remit (strategy-game event systems) | supporting |
| **Content migration when a pack updates mid-save** (versioned in-flight state) | RED Modding wiki on facts; the lens's Skyrim patch claim (unverified) | supporting; the map has no field |
| **Authoring an aesthetic as weighted features** (an evaluation function over a whole experience) | Nelson et al. 2006 (read); Weyhrauch 1997 (not opened). Close to SEL-03, so possibly a sub-point of it | already covered by SEL-03 if the map keeps "steer towards author goals"; flagged only to confirm |

## Credit candidates

For the [community credits](../../../docs/community-credits.md); this dossier does not edit that file. "Creator as evidenced" is the author named on the page we read.

| Creator as evidenced | Work | Link | What we learned |
|---|---|---|---|
| Emily Short | "Storylets: You Want Them" (2019) | https://emshort.blog/2019/11/29/storylets-you-want-them/ | A storylet is content, prerequisites and effects; time caves lose the benefits |
| Elan Ruskin (Valve), with Emily Short's recap | "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012 | https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/ | The most specific matching rule wins, with general rules as fallback |
| Failbetter Games | "Fallen London Writer Guidelines, Part II" | https://www.failbettergames.com/news/fallen-london-writer-guidelines-part-ii | Keep qualities few; never trap a player in a chain |
| Alexis Kennedy | "Postmortem: Failbetter Games' Sunless Sea", *Game Developer*, 2015 | https://www.gamedeveloper.com/audio/postmortem-failbetter-games-i-sunless-sea-i- | A reused story engine collects special cases; hand-edited data stops scaling |
| Michael Mateas and Andrew Stern | "Structuring Content in the Façade Interactive Drama Architecture", AIIDE 2005 | https://ojs.aaai.org/index.php/AIIDE/article/view/18722 | Beats with preconditions, weights, priorities and tension effects; 27 beats took about three person-years. **The existing credit says "about 200 authored beats"; the paper says 27, with about 2,500 joint dialogue behaviours.** |
| Richard Evans and Emily Short | "Versu: A Simulationist Storytelling System", *IEEE TCIAIG* 6(2), 2014 | https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf | Authoring practices that are agnostic about who plays each role |
| Joshua McCoy, Mike Treanor, Ben Samuel, Noah Wardrip-Fruin, Michael Mateas | "Comme il Faut: A System for Authoring Playable Social Models", AIIDE 2011 | https://ojs.aaai.org/index.php/AIIDE/article/view/12454 | Roles with an optional third party; weighted influence rules; the cost of tuning thousands of rules |
| Mark J. Nelson, Michael Mateas, David L. Roberts, Charles L. Isbell Jr. | "Declarative Optimization-Based Drama Management in Interactive Fiction", *IEEE CG&A*, 2006 | https://www.cs.uky.edu/~sgware/reading/papers/nelson2006declarative.pdf | An author's aesthetic as a weighted combination of features, and why it is hard to specify |
| Jonathan Doran and Ian Parberry | "A Prototype Quest Generator Based on a Structural Analysis of Quests from Four MMORPGs", PCG 2011 | https://ianparberry.com/pubs/pcg2011.pdf | Quests as motivation plus strategy; why general planning is impractical |
| Brandon Tearse, Peter Mawhorter, Michael Mateas, Noah Wardrip-Fruin | "Skald: Minstrel Reconstructed", *IEEE TCIAIG* 6(2), 2014 | https://dblp.uni-trier.de/pid/72/9799.html (listing) | Adaptation needs costed transformations and a library tuned to its operators |
| Ubisoft Toronto (Christopher Dragert, Jurie Horneman); Brandon Hennessy as reported by Justin Carter | Watch Dogs: Legion's Census and Player Attention System | https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london | Requests with priority, relevance window and attention cost; anchors and what writers cannot assume |
| Bruce Nesmith | Radiant Story lecture, via GamesBeat, 2012 | https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/ | Keep templates off the main story; restrict generated jobs to fitting characters |
| Paweł Sasko | GDC 2023 quest design talk, via Game Developer | https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3 | Bring early choices back later and make consequences visible |
| Paradox Interactive modding community (CK3 wiki); Ludeon Studios modding community (RimWorld wiki) | Event modding and quest scripting pages | https://ck3.paradoxwikis.com/Event_modding, https://rimworldwiki.com/wiki/Modding_Tutorials/Quests | Triggers before scopes, fallback options, and a dry run before a quest is generated |
| Christopher Alexander | "A City Is Not a Tree", *Architectural Forum*, 1965 | https://www.patternlanguage.com/archive/cityisnotatree.html | Overlap is what a tree-shaped plan removes |
| US Army | Article on commander's intent (and *ADP 6-0*, not opened) | https://www.army.mil/article/215297/mission_command_requires_sharp_commanders_intent | Intent is a task, a purpose and an end state; subordinates choose the means |
| Yu, Guzdial, Sturtevant | "The Definition-Context-Purpose Paradigm…", AIIDE 2021 | https://arxiv.org/abs/2110.04148 | Purpose is a component of what developers mean by a quest |
| Robin Laws (Pelgrane Press) | GUMSHOE | https://pelgranepress.com/2017/09/29/gumshoe-rules-summary/ | Core clues are guaranteed; extras are optional |
| Beverly Serrell; Freeman Tilden | *Paying Attention* (1998); *Interpreting Our Heritage* (1957) | https://informalscience.org/research/51-solution-research-project-meta-analysis-visitor-timeuse-museum-exhibitions/ | Visitors meet a fraction of the elements; relate the thing to the visitor |
| Haralick and Elliott | "Increasing Tree Search Efficiency for Constraint Satisfaction Problems", 1980 | https://haralick.org/journals/haralick_elliot.pdf | Try the choices most likely to fail first |
