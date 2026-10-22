# Dossier 16: authoring formats, pipeline and tools

**Status:** v1, 23 October 2026. Dossier 16 of the [craft discipline map](map.md), written under the [research method](../p1-research-method.md) (template in §3, evidence grades in §4). Core fields: AUT-01 (staged quest production: pitch to playable) and AUT-02 (authoring tools and writer pipelines, including co-creative tools). Supporting fields: AUT-05 (content economics and where procedural help is credible) and AUT-06 (mod-community quest authoring). It feeds P6 (authored content and player configuration) and P10 (tooling and inspection), and it extends the seed-language specification [S2](../spec/seeding.md) v0.8 (§1, §2, §11, §12.3) and the pack format and settings that [S4](../plan.md#5-second-level-plans) will fix. Read first: [dossier 3](d03-fitting-casting.md) (fitting and casting) and [dossier 4](d04-quest-structure.md) (quest structure).

**How far each source was read.** *Opened* means I read the page this session, through a page converter that returns a summary of the text, so I cite only what it stated. *Opened (full text)* means I extracted the text of a PDF and read the sections named. *Summary* means an abstract, a search summary or a second person's account of a talk. *Lens* means I rely on a lens file's account, which this dossier treats as unverified. *Blocked* means the page refused the fetch. §3 lists every source with its status, and §3.4 lists what I checked in the lenses.

**Grades.** [empirical], [practice], [shipped], [corpus], [analysis], [hypothesis] as in P1 §4. **contested** marks a claim two sources dispute. **[J]** marks a judgement value: a starting number chosen by me, to be replaced by a measurement. There is no [empirical] or [corpus] evidence in this dossier. Nobody has measured how well non-programmers write in a language like ours, and §12 says how to find out.

**First-party concepts (D-21).** Fixed, preferred and open ([D-03](../decisions.md)), the seed document and the layer split are the project's own. Authoring tools from outside appear here only as comparisons: what an author's experience was in a tool that does something similar, and what that suggests for ours. Nothing in this dossier says the engine's concepts derive from them. Where a tool influenced a *workflow* (a live preview, a hit-count report), the principle says so.

## In brief

- **S2 is a compile target, not an authoring surface.** A window such as the one in scenario R1 is a tree of `{ all: [...] }` and `{ fact, op, value }` objects in S2, and a one-line expression in the P4 sketch of the same scenario. The two have already drifted apart in names. Every comparable tool that writers actually use (ink, Twine, Yarn Spinner) is text-first with an editor that checks as you type. The two that demanded most of their users (Storytron, Versu's Praxis) are the ones whose authors report the learning cost, one of them as the reason it ended. So the design needs a text form that compiles to S2's types and prints back from them, predicates written as expressions, profiles shown as forms, and a **source map** so that every finding about the expanded document points at what the author wrote. S2 has no source map today.
- **There are two ladders from vague to precise, and S2 has only one.** *Binding* (fixed, preferred, open) says how much of a seed the author has decided. *Maturity* (a sketch, a playable draft, a ready seed) says how much of it is finished. CD PROJEKT RED's pipeline is a maturity ladder: half-page pitches, a design document, a rough playable with placeholder dialogue, then final lines. S2's lint treats every finding as an error that refuses the seed, so an author cannot save a sketch. The fix is to grade the lint by maturity, allow loud placeholders, and never sow anything below *ready* into a player's game.
- **A pack is a long-lived, shared thing, and the other modding ecosystems show how it breaks.** RimWorld modders overwrote whole definitions and the last in load order won, until patch operations arrived. A malformed XML file there can crash the parser and remove every active mod. Cyberpunk's own quest facts are global named integers, and the community's guidance is that editing them "will almost always cause" later problems. WolvenKit's quest editor has no undo and recommends soft deletion for published quests. The design should therefore make ids permanent (with tombstones), diff each release against the last for breaking changes, give extensions additive patch semantics, isolate every pack and file from the others, and record the game and facts-table versions a pack was checked against.
- **The testing method already exists, and S2's determinism makes it cheap.** ChoiceScript's random test (10,000 seeded runs, hit counts per line) and Versu's playback, stress-test and inspector tools are the same idea. For us it is a **survey**: many world seeds across sample states, with per-element hit counts, cast spread, stuck seeds and unreachable exits, and any finding reproducible from one small repro bundle. It cannot judge writing quality, and §6 says what to put beside it.
- **The realistic non-programmer author fills profile forms and writes prose lines.** Hand-writing beat graphs with `because` and `obstructedBy` links, `count` patterns or `believes` atoms is for a smaller group, and writing registry functions is programming. Packs carry no code, so the last tier belongs to the engine team. The Appendix A ladder profile is already the model for the first group, and the profile library should be built out before the beat language is taught. This is [hypothesis]; §12.2 is the author trial that tests it.
- **Authorship, not rendering, is the bottleneck** (Obsidian's lead designer says so for reactive dialogue; Versu's authors measured their own gain from text output and a purpose-built language). Procedural help that professionals accepted was first drafts with accept, edit or discard. For the Story Engine the assistance worth building first is structural (a near-miss explanation, a suggested missing exit), not prose.
- **The first tool is files, a command line and a schema.** Check, fit, survey, pin, build, all with machine-readable output and stable finding codes, on the TypeScript reference model. XF Studio can host the same actions later as a feature module in its component library. It must not become the only way in, because the community's packs will live in plain text under version control.

## 1. Scope and why it matters here

Layer 4 is what people write ([plan §2](../plan.md#2-the-system-at-first-level)). The engine can only be as good as the packs, and the packs are only as good as the tools their authors use. [S2](../spec/seeding.md) says *what a seed can say* and what the lint and the fit report must check. This dossier asks the author's questions. What do I type? How do I know it is wrong? How do I see how it would behave? How do I work with others, ship an update, and keep a save alive across it? What can someone who does not program realistically do?

| Layer or concern | What this dossier gives it |
|---|---|
| 4. Authored content (P6, S4) | The author tiers (§4 C), the file layout and pack manifest, the text-unit format, the maturity ladder, the profile-as-form principle, the pack-evolution rules (§4 H) |
| 2. Seeding (S2) | Twelve requirements on the language and its lint (§11.1): maturity, placeholders, an expression syntax for `Pred`, a source map through profile expansion, a finding contract, the fit report's near-miss and pin locations, unresolved `ContentRef` behaviour, a structure version |
| Tooling and inspection (P10) | The first tool and its commands, the sample library, the explain tool, the survey, repro bundles, and what XF Studio can host (§11.3) |
| Evaluation (P9) | Eleven author-side measures (§7) and a testing agenda (§12) |
| Procedural engine (layer 3) | Only one thing: the fit report is layer 3's fitting hook seen from the author's side; the director-on report is deferred in S2 §0.3 and stays deferred |

**What it does not cover.** The seed language's semantics (S2); how fitting chooses ([dossier 3](d03-fitting-casting.md)); what a good quest is ([dossier 4](d04-quest-structure.md)); the words themselves (dossier 21, words and dialogue rules, not yet written; see [the map](map.md)); scene, voice and animation formats (P8, and S2 §15 notes the `intimate` scene format depends on it); rights and licences for what packs may contain (dossier 19, not yet written). Where this dossier needs one of them it states the interface. Two map fields overlap its edges: testing and replay of branching content (EVA-02, dossier 23) and localisation of dynamic text (EXP-06, dossier 21). The survey and the text-unit format here are the author-facing sides of those, and the owners of those dossiers settle the harness and the text grammar.

## 2. The failure record

### 2.1 Cases

| # | Case | What went wrong | What it means here |
|---|---|---|---|
| F-1 | **Storytron** (Chris Crawford, 2006 to 2011). Authors built storyworlds with the StoryWorld Authoring Tool, in a purpose-built language for character interaction | Crawford's own account of the end: it was "too complicated for the audience", and demanded more of its users than they would invest. He names no storyworld by an outsider. A foundation paid $350,000 for the predecessor, and he spent about ten years on it | Expressive power that costs a long learning commitment gets no authors. The test for our tools is the time to a first working seed, not what the language can express (TIER-03, M16-05) |
| F-2 | **Versu** (Evans and Short). A purpose-built language, Praxis, for social practices; more behaviours than Façade in less time | Tuning stayed hard: with over 300 desires, making the preferred action win was "difficult and unrewarding" even with the inspector. Several practices running at once complicated tuning and debugging. A later paper says no comparably approachable framework has replaced it since Versu became unavailable | A good inspector helps and does not remove the cost of tuning. Fewer, coarser knobs (the three strengths of S2 §2.2) and explanations of *why* a choice won matter more than more power (LOOP-07) |
| F-3 | **Thief's editor** (Tom Leonard's postmortem). Level editor began as a demo tool and never got a specification; the object system took far more work than planned and fell heavily on one designer | The editor was essential and poorly documented, and nobody stopped to rebuild it. The lesson he draws: treat the editor as a first-class product | The authoring tool needs an owner, a specification and documentation from its first release (TOL-06) |
| F-4 | **RimWorld quests in XML.** Quests are data (a script definition with a root node and a shared dictionary of values) | The wiki page calls them "extremely difficult to modify or extend", aimed at experienced modders, and says newer quests bypass the dictionary with one large node. The page itself is marked as under review | Being data is not the same as being approachable. A pack's quests must be authorable at the level of parameters and prose, not node classes (TIER-01) |
| F-5 | **RimWorld patching.** Before alpha 17 mods overwrote whole definitions and the last in load order survived. Patch operations came later | Even patching fails quietly: a sequence stops at the first failed operation and can hide errors; an option that suppressed all errors was made obsolete; XPath is case-sensitive; a malformed file can crash the parser, and the page says this can remove all active mods | Additive extensions by stable id, loud failures, and a loader that isolates a broken file from everything else (COL-05, COL-06) |
| F-6 | **Cyberpunk's quest tooling.** WolvenKit's quest editor works on one file type; it has no undo or redo, and the wiki tells users to take backups. Hard-deleting a signal-stopping node in a published quest can strand players. Quest facts are global named integers, and editing them "will almost always cause" later problems | The tool is capable and unforgiving. State collides in one global namespace | Undo and backups are table stakes (COL-03). Retired ids need tombstones (VER-01). Pack authors should never touch the game's quest files (TIER-04) |
| F-7 | **Twine.** Text-focused, popular with writers | No simultaneous editing. Story files are compressed HTML, so diffs are hard to read. The documentation warns against syncing the library through a cloud drive, which may merge changes and corrupt stories. Short adds that Twine is not designed for state-heavy structures | Source must be plain text with no layout or compression inside it (COL-01), and the working folder must never depend on a sync service (COL-02) |
| F-8 | **Radiant Story's reach** (Bruce Nesmith, design director). The system was easy to over-extend | The main quest "would play horribly" with it; job quests had to be limited to fitting NPCs such as innkeepers; events over-fired until conditions were expanded; players wanted only so many job quests; creating new data types and attaching them to objects was a "Herculean task" | Authors need a way to see over-firing and over-use before players do (TST-01). Pack authors will reach for the tool for things it should not do; the lint and the starter pack set limits (MOD-02) |
| F-9 | **Quality-based narrative bookkeeping.** A multi-step arc needs separate "available" and "complete" values at each stage | Short calls it "a lot of bookkeeping", and finds the tool hard for newcomers until they have spent real time in it | Seed facts that every profile needs (the ladder's `rung`, `exit`) should be generated by the profile, not hand-declared (FMT-08) |
| F-10 | **The marketing of simulation.** The articy:draft feature page promises its flow simulation will help "avoid logic errors" | The same page's own list shows what the simulation does: it plays the flow with its conditions and instructions. It cannot know about states the author did not wire | A preview shows what it ran, no more (PRV-05). The engine's rule on evidence applies: an offline run is not game proof |
| F-11 | **Random testing's blind spots.** ChoiceScript's random test | It can run in an infinite loop with no message, and it cannot prove that a line it never reached is unreachable (Rachel E. Towers) | Pair a survey with static reachability (S2 L-44, §7.5) and with forced-path replay (TST-01, TST-02) |
| F-12 | **The sketch is not the spec.** [P4 §5](../p4-seeding-layer.md#5-reference-scenario-r1-in-this-language) wrote R1 as a short indented sketch with expressions such as `guard(q112_done) and q112_takemura_dead == 0`; [S2 Appendix A.3](../spec/seeding.md#a3-reference-scenario-r1) writes the same window as a tree | Names changed (`on_unfilled`, `lead_time` against `onUnfilled`, `lead`), and the readable surface was never specified. A reader of P4 cannot write S2 | Specify the text form as its own deliverable with its own fixtures (FMT-02, S16-S4-02) |
| F-13 | **Implicit typing.** YAML 1.1 reads `y`, `n`, `yes`, `no`, `on` and `off` (in any common case) as booleans | S2's predicates include the literals `yes` and `no`, its `because` link has a field called `on`, and `no` is also a word authors write. A YAML-like authoring file would silently turn them into booleans | Do not hand authors a format with implicit typing (FMT-04) |

### 2.2 What they have in common

Four things recur. First, **the author's cost was higher than the benefit** (F-1, F-2, F-3, F-4): power was delivered, and the people who would use it could not afford the learning. Second, **edits that cannot be undone or compared** (F-6, F-7), so every change is a risk. Third, **one namespace, last writer wins** (F-5, F-6), so independent authors break each other without meaning to. Fourth, **testing that checks that it runs and not that it reads well** (F-10, F-11). The design below answers each: the author's route is parameters and prose; every edit is in plain text under version control, with undo; ids are permanent and extensions are additive; and the survey is paired with a read-through for the human judgement no tool replaces.

### 2.3 Where the advice itself fails

| Advice | Where it fails |
|---|---|
| **Constrained, purpose-specific tools beat general ones** (Thief: GUI-defined objects, a pick-list of AI triggers, weighted tables, with a real programming language kept for programmers) | The same postmortem says the object system took much more work than expected. A constrained tool still has to be built, documented and maintained, and each profile is a small tool of its own. The ladder is one; gig, job and heist, con, four-beat, front, testing-arc and slide are six more that S2 §2.10 names and has not specified |
| **Text first** (ink calls itself markup of pure text with flow; Yarn is text with a graph view; Short says Twine suits few state-heavy designs) | Graph editors are what vendors sell for large projects (articy's flow editor, WolvenKit's quest editor), and I found no study that compares them for authors. Whether a read-only graph is enough, or authors will demand editing in it, is open. **contested** (PRV-01) |
| **Check as you type** (Inky, the Yarn Spinner editor) | Only cheap checks can run that fast. Several of S2's lints need a world to run against (L-29, the cast checks). A tool that mixes the two speeds without saying so makes the slow ones look like the fast ones (LOOP-01) |
| **Randomised runs find dead content** (ChoiceScript) | The author's random choices do not reflect players, and loops need a human (Towers). Our survey samples worlds more than choices, which is a better fit for this engine and has its own bias: the sample states someone else wrote (TST-05) |
| **Staged production filters by taste** (CD PROJEKT RED accepts 5 to 10 per cent of a designer's pitches) | It needs a big pool of pitches and a team of reviewers. A mod author has neither (STG-05) |
| **Version numbers tell users what is safe** (SemVer, Minecraft's pack format) | A number is only as good as the rule that sets it. An author who forgets to bump it ships a break. The tool must compute the part it can (VER-02) |

## 3. Sources

### 3.1 Read

| Source | Status | What it gave |
|---|---|---|
| Richard Evans and Emily Short (2014), "Versu—A Simulationist Storytelling System", *IEEE Transactions on Computational Intelligence and AI in Games* 6(2): 113 to 130 | **Opened (full text; part):** the motivation, the authoring-tools section, the production-time section and the limitations; not the logic or the agent model in full | Praxis is a high-level language for practices, initial character states and the world; its support tools were a type checker with inferred types, an inspector for the simulation state, a playback facility that needs a fully deterministic simulator, and a stress-test tool running hundreds of computer-controlled games at once; logical breakpoints show which practice made a fact true; the tools were "heavily indebted" to Inform 7's. A 20-minute Versu episode took about two months against Façade's three-plus years; Versu had over 1,000 parameterised actions after one year against Façade's 30, which the authors attribute to text output and the language. Limits: over 300 desires; score tuning "difficult and unrewarding" even with the inspector; concurrent practices complicate tuning and debugging |
| Chris Crawford, "End of an Era" (erasmatazz.com) | **Opened (through a page converter)** | Why Storytron ended in the author's own words (F-1); the funding and the time |
| inkle, "ink" product page; inkle, *Writing with ink* documentation (first 100,000 of 123,660 characters); the Inky repository's README | **Opened (through a page converter)** | Text-first design; knots and stitches; flow errors "impossible" in a basic weave; compiler warnings for loose ends and a runtime "ran out of content" error; visit counts, `TURNS_SINCE`, `SEED_RANDOM`; globals visible to the game runtime; the editor's live play pane that remembers choices, its continuous compile, issue browser (errors, warnings, TODOs) and `INCLUDE`-based multi-file projects; MIT licence. The last 23,660 characters of the documentation were not read |
| Twine reference: introduction, "Collaborating on Stories", source control page (twinery.org) | **Opened (through a page converter)** | No simultaneous editing; export and import as the simple route; Git works, compressed HTML makes diffs hard to read, Twee conversion helps; do not sync the library through a cloud drive |
| Yarn Spinner documentation: "Start here", "Node Groups"; the Yarn Spinner editor page (yarnspinner.dev) | **Opened (through a page converter)** | A VS Code extension with checking as you write, "did you mean" quick fixes, a graph view of one file or the whole project, a preview running the real runtime in the editor with a changeable saliency strategy, autocomplete and string-table management; node groups of same-named nodes with `when:` conditions (`once`, `always`, a variable). The node-group page did not describe the saliency strategies |
| articy:draft X feature list (articy.com) | **Opened (through a page converter); vendor page, marketing flagged** | Flow, templates with constraints, a presentation view and property inspector for simulation, a conflict search for invalid values and references and duplicate technical names, localisation states (final, in progress, outdated; editing the reference text marks others outdated), multi-user licences, version history and rollback over SVN or Perforce, change comments written automatically, exports (JSON, Unity, Unreal, Excel, Word), rulesets to filter an export. Variables are Boolean, integer or string only. File locking is not listed |
| RimWorld Wiki, "Modding Tutorials/PatchOperations" and "Modding Tutorials/Quests" | **Opened (through a page converter);** the quests page is marked under review | The patch operations, their load order (after all definitions load, in mod-list order, before inheritance), their failure behaviour (F-5); quest definitions, the shared dictionary, and the page's own warning about difficulty (F-4) |
| RED Modding wiki: quest guides index; "Visualize Quest files"; "Quests: facts and files"; WolvenKit wiki "Quest Editor" | **Opened (through a page converter)** | Seven guide titles in the quest section; questphases as graphs joined by handle references, with scenes holding choices and similar content; quest facts as a name and a signed integer, unset reading 0, with the warning (F-6); the editor's node operations, soft and hard delete, no undo or redo, and the advice to back up |
| Bruce Nesmith interview, GamesBeat (27 January 2012) | **Opened (through a page converter)** | Radiant Story's start (30 player actions and their world reactions), its reach, its limits and fixes (F-8) |
| Philipp Weber's forum Q&A as reported by Oleg Nesterenko, Game World Observer (13 September 2019) | **Opened (through a page converter)** | Hundreds of half-page pitches; the best become design documents of at least ten pages in screenplay form without final dialogue; reviews by writers, the lead quest designer and directors; a basic playable with rough dialogue outlines; a coordinator logging contributions in a production tool |
| Paweł Sasko's PC Gamer interview as reported by Rita Hou, 80 Level (25 March 2024) | **Opened (through a page converter)** | A good designer's acceptance ratio is 5 to 10 per cent; designers pitch everything and the studio takes the strongest; many remembered quests had small budgets |
| Tom Leonard, "Postmortem: Thief: The Dark Project", *Game Developer* (9 July 1999) | **Opened (through a page converter)** | Designer tool tiers and the editor lessons (F-3) |
| Kirk McKeand, interview with Josh Sawyer, PCGamesN (23 January 2017) | **Opened (through a page converter)** | Authorship is the bottleneck; writers can already see how often NPCs react to events or traits; a hoped-for system would learn reaction rules, not invent content |
| Bryant Francis, "Here are more details on Ubisoft's Ghostwriter AI tool from GDC 2023", *Game Developer* (22 March 2023) | **Opened (through a page converter)** | A first-draft tool inside Ubisoft's in-house narrative tool: barks, background and crowd lines, UI text; two options; writers accept, edit or discard; paraphrase the biggest use; not for cinematics or lore |
| Emily Short, "Beyond Branching: Quality-Based, Salience-Based, and Waypoint Narrative Structures" (12 April 2016) | **Opened (through a page converter)** | Authoring and testing of quality-based and salience-based systems (F-9, FMT-07, TST-01) |
| Rachel E. Towers, "How to get the most out of automated testing, part 2" (Choice of Games blog, 2018) | **Opened (through a page converter)** | `randomtest` defaults and limits (F-11) |
| Minecraft Wiki, "Pack format" (first 100,000 of about 214,000 characters) | **Opened (through a page converter)** | Pack format numbers; ranges (`min_format` and `max_format`); mismatch warnings; minor versions; overlays |
| Tom Preston-Werner, Semantic Versioning (semver.org) | **Opened (through a page converter)** | The three-part rule |
| YAML 1.1 boolean type page (yaml.org) | **Opened (through a page converter)** | The literal values read as booleans (F-13) |

### 3.2 Abstract or summary only

| Source | Status | What it gave |
|---|---|---|
| Max Kreminski, Melanie Dickinson, Noah Wardrip-Fruin and Michael Mateas (2022), "Loose Ends: A Mixed-Initiative Creative Interface for Playful Storytelling" (AIIDE) | Abstract page | A co-creative interface for managing parallel plot threads; four mixed-initiative interactions; a preliminary expert evaluation reporting a sense of co-authorship |
| Piotr Mirowski, Kory W. Mathewson, Jaylen Pittman and Richard Evans, "Co-Writing Screenplays and Theatre Scripts with Language Models: An Evaluation by Industry Professionals" | arXiv abstract | A hierarchical prompt-chaining tool; 15 theatre and film professionals co-wrote; discussion of suitability for co-creation, plagiarism and bias. No quantitative result in the abstract |
| James Dameris, Rosaura Hernandez Roman and Max Kreminski, "Praxish: A Rational Reconstruction of a Logic-Based DSL for Modeling Social Practices" | Abstract page | An open-source reconstruction of Versu's low-level language, begun because Versu has been unavailable for nearly a decade and nothing as approachable and flexible has replaced it |
| Elan Ruskin (Valve), "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012; Emily Short, "GDC 2012 Talk on Dynamic Dialogue" (16 March 2012) | Short's account and the GDC Vault listing (search summary). The Vault page and the slides were not readable | Rule-based; the most specific matching rule wins and less specific ones are fallbacks, as in Inform; the stated aim was that writers could author a lot of content with tools they find comfortable; the listing says hundreds of world facts are matched against thousands of lines |
| Creation Kit pages on Radiant Story and aliases (UESP mirror and the Bethesda wiki) | **Blocked** (HTTP 403 and a redirect); only search summaries | Quests are triggered by Story Manager events in a nested node tree; aliases are filled by picking from lists of references or locations; conditions are the main filter |
| Storytron entries (IFWiki, search summary) | Search summary only | Dates 2006 to 2011; the authoring tool is called Swat; interaction through a language called Deikto and verb scripting in a second language |
| Gutierrez and Marino (Hypertext '08), "Literatronica" | Appeared in search results only; **not used** | None |

### 3.3 Memory or lens only

Lens claims I did not check and do not rely on: Microids' split of text, logic and flow in articy; CDPR's REDkit for Witcher 3 and its quest modules (the how-to page returned no body); the Saltsea Chronicles test bot; ICU MessageFormat and localisation of generated text (Allcorrect); Vincke's capture costs; the 2026 industry survey on generative-AI sentiment; the report that CDPR moved from waterfall to pods; The Forgotten City and Enderal as scope lessons (the Kotaku interview I opened covers the standalone project's clearance, tools and costs, not scope lessons); Deus Ex's conversation editor; Dramatron's participants finding output formulaic (not in the abstract).

### 3.4 Lens claims checked

| Claim (lens) | Result |
|---|---|
| L9:1: CDPR pipeline of half-page pitches, at least ten-page documents, a rough playable with dialogue outlines, a coordinator's production tool | **Confirmed** by Weber's Q&A as reported (Game World Observer). The 5 to 10 per cent acceptance is **confirmed** (80 Level, relaying PC Gamer). "Main and side quests cost about the same" not checked |
| L9:16: Thief shows that narrow purpose-specific tools suit designers better than one general scripting system; the editor deserved first-class treatment | **Confirmed in part:** the postmortem describes tiers (GUI object tuning, a pick-list of AI triggers, weighted tables, C++ scripts that, being a real programming language, not every designer could use) and the editor lesson. It does not compare tools by error rate; that test is the lens's, not the source's |
| L9:17: ChoiceScript runs 10,000 seeded playthroughs by default with hit counts; about 100 hits is "very difficult" to reach, about 10 "exceedingly" | **Confirmed** (Towers) |
| L9:19: Ghostwriter gives two options, writers accept, edit or discard; not for cinematics or lore. Sawyer on authorship | **Confirmed** (Francis; McKeand) |
| L9:20: the RED Modding wiki's quest section lists seven guides and none on end-to-end quest authoring | **Confirmed for the fetched index** (seven titles). A search result also listed a guide on adding text-message threads, so the index I fetched may be incomplete. I saw no end-to-end quest guide |
| L8:18: Dramatron participants found output formulaic and preferred it for world-building | **Not in the abstract.** Unverified; not used |

## 4. Principles

Grades are P1 §4's. "Produce" says how a procedure could make the principle true; "Check" says how a procedure could test it. Layers are the plan's numbers (2 seeding, 3 procedural engine, 4 authored content), with "tool" for P10 and "S4" for the pack format. Scales: *enc* (encounter), *gig*, *arc*, *pack*. IDs are `<area>-NN`. Instances are invented for this dossier unless a source or a game fact is named; none is content.

### A. Staged production: how a vague unit becomes a precise one (AUT-01)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| STG-01 | **A cheap first tier filters ideas before expensive design starts. In our files that tier is a seed at sketch maturity: a purpose sentence, a context, and one line per beat.** | [practice] | Weber via Game World Observer (hundreds of half-page pitches; the best become documents of ten pages or more); Sasko via 80 Level (designers pitch everything). Instance: a sketch of "a courier asks V to carry something she shouldn't open", six lines | all · 4, tool | **Produce:** the sketch needs only `purpose`, `context`, beat names and one `note` each; the compiler accepts it and lists to-dos. **Check:** parse and name checks only. **Neither** can judge whether the idea is worth building: that is taste |
| STG-02 | **Judge structure before prose is paid for: run the sketch as a rough playable with placeholder lines.** | [practice] | Weber via Game World Observer (a basic playable with rough dialogue outlines, final lines later). Versu's authors measured their gain from text and a purpose-built language (Evans and Short). Instance: the fit report and a text play-through of the R1 sketch show `reunion` unreachable in two samples before any line is written | all · 4, tool | **Produce:** a placeholder `ContentRef` is generated from the fragment id and the cast ("[fragment `quiet-hour-offer-2` between {takemura} and V]") and is printed conspicuously. **Check:** at *ready* maturity a placeholder is an error (S16-S2-02) |
| STG-03 | **Keep two ladders apart. Binding (fixed, preferred, open) says how much the author has decided. Maturity (sketch, playable, ready) says how much is finished.** | [hypothesis], extending S2 §2.2 and the pipeline of STG-01 and STG-02 | S2 has `Part` for binding and nothing for maturity. A fully fixed seed can be a sketch (every part decided, no lines written), and a mostly open seed can be ready (the author left the moment and channel to fitting, and wrote every line) | all · 2, 4, tool | **Produce:** a `maturity` field on the template. A template below *ready* is never sown into a player's game, whatever its `sow` says. **Check:** the lab can sow it, labelled |
| STG-04 | **Lint strictness follows maturity. The same finding is a to-do on a sketch and an error on a ready seed.** | [practice] for the mechanism; [hypothesis] for the grading | Inky's issue browser lists errors, warnings and TODOs together (opened). S2 §11.1 gives only "error refuses the seed" and "warning". Instance: L-35 (no `closing` at gig level) and L-26 (a conclusion with fewer than three clue routes) are normal on a sketch | all · 2, tool | **Produce:** each lint gets a "blocks ready" flag (S16-S2-01, S16-S2-05). The player's runtime keeps S2's rule unchanged: an error at sowing refuses the seed. **Check:** M16-02 |
| STG-05 | **The human taste filter does not exist for a mod author. The tool can stand in for the cheap parts of it (lint, fit, survey) and must not pretend to stand in for taste.** | [practice] | 5 to 10 per cent acceptance needs a big pool and a review team (Sasko; Weber). Mod authors have neither (lens L9:20; a lens claim) | pack · tool, P9 | **Produce:** lint, fit and survey as a pre-flight; the quality bars that can be tested offline (causality, agency, legibility) appear as named checks with the same finding contract. **Neither** produces taste; a "read-through" export (TST-04) hands it to people |

### B. Formats (AUT-02)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| FMT-01 | **The authoring surface is text in files, with the author's own words kept apart from logic.** | [practice] | ink is described as marking up pure text with flow; its guidance is that scripts stay clean enough to check by eye (inkle docs, opened). Twine is "very text-focused". Yarn is text with a graph view. Instance: a `.seed` file for structure and a `.lines` file for words | all · 4, S4 | **Produce:** two file kinds (structure, text units). **Check:** a project with only a text editor can write, check and build a pack |
| FMT-02 | **One document, two forms. The canonical form is S2's types serialised. The text form compiles to it and prints back from it.** | [hypothesis] | The P4 sketch and S2 drift (F-12). The same data in two spellings, with a printer, makes drift testable | all · 2, S4 | **Produce:** a parser and a printer. **Check:** round trip on every fixture: text to canonical to text is byte-stable after formatting (M16-04) |
| FMT-03 | **Conditions are written as expressions. `Pred` stays the canonical tree.** | [hypothesis] | R1's window is thirteen lines of nested objects in S2 A.3 and one line in P4 §5. Instance: `decided(q112_takemura_dead) and q112_takemura_dead == 0 and q112_done == 1 and allied(takemura)` | all · 2, S4 | **Produce:** a small grammar over S2 §2.6's atoms, with `all`, `any`, `not` as `and`, `or`, `not`. **Check:** `parse(print(p)) = p`. The author sees three-valued results in the explain tool (LOOP-07). Fixtures SF-1 and SF-7 are re-run through the text form |
| FMT-04 | **Do not give authors a format with implicit typing or case-sensitive path queries as their main surface.** | [practice] for the failures; [hypothesis] for the rule | YAML 1.1's boolean literals include `yes`, `no`, `on` and `off` (opened); S2 uses `yes`, `no` and a field named `on`. RimWorld's XPath is case-sensitive and a malformed file can take down the mod list (F-5). Instance: `closes: no` read as the boolean `false` | all · S4 | **Produce:** a parser we own, with located messages in plain words and a closed set of literals. A strict JSON canonical form (no comments) for programmers and tools. **Check:** a fixture of every S2 literal that a YAML 1.1 reader would change |
| FMT-05 | **Each piece of text is a unit with a stable id and explicit placeholders: `{role.attribute}`.** | [practice] for whole-sentence templates (lens: Allcorrect); [analysis] for the lint reasons | S2 §1.2: wording can be corrected under a live instance because `ContentRef` resolves against the active pack. L-17 (text naming a role attribute that `must` doesn't guarantee) and L-58 (a count in a line with no `count` atom) need to read placeholders. articy marks other languages outdated when the reference text changes (opened, vendor) | all · 4, S4, 8 | **Produce:** one id per unit; a content hash recorded per unit; translations attach by id and go stale when the hash changes. **Check:** L-17 and L-58 over parsed placeholders. Select and plural forms are allowed in a unit; the grammar waits for P8/S7 (open question 2) |
| FMT-06 | **No conditional logic inside prose. Variety is separate units with conditions.** | [analysis] | S2 §2.8: a fragment reads only facts and its bound roles. Logic inside text escapes the text lints (L-17, L-20, L-21, L-58). Yarn's node groups use separate nodes with `when:` conditions (opened). ink offers inline conditionals and the documentation lists many limits on them. Instance: three alternates of one greeting, each with an `applies` | all · 4, S4 | **Produce:** the text grammar has placeholders and select/plural only. **Check:** a unit with anything else fails parse |
| FMT-07 | **Alternates and specificity: write the general case first and add specific ones where you notice a gap. Say what happens on a tie.** | [practice] | Short on salience systems: start with broad defaults, add specific content when a situation needs it; later additions rarely have many side effects. Valve's rule system (Short's account; the talk itself not read) applies the most specific matching rule. S2 §7.2 keeps the alternates with the most atoms in `applies` and then draws among ties | enc, gig · 4, 2 | **Produce:** the editor lists, per beat, the alternates in order of specificity and marks each tie. **Check:** a lint warning when two alternates tie and both can be eligible in a sample (S16-S2-05). Specificity by atom count can be gamed by adding a redundant atom; the report shows the count |
| FMT-08 | **A profile is a form. The author fills in its parameters and the tool generates the beats, the seed facts and the lint.** | [practice] for purpose-built tools; [hypothesis] for the form | Thief's designers set most behaviour through GUI-defined objects, with scripting kept for programmers (Leonard). S2 §2.10 and Appendix A: the ladder profile takes `with`, `rungs`, `offers`, `exits`, `pacing` and writes everything else. QBN's bookkeeping is the cost without it (F-9) | gig, arc · 4, S4, tool | **Produce:** the form is generated from the profile's `ParamSchema` (the Studio's component for it is in §11.3). **Check:** the profile's own lints (L-10, L-11, L-16) are phrased against parameters (LOOP-03) |

### C. Who writes what (AUT-06, with AUT-02)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| TIER-01 | **Three kinds of author. Parameter authors fill profile forms and write text units. Graph authors write beats, links, windows and conditions. Extension authors write new profiles, registry functions and vocabularies. Packs carry no code, so the third belongs to the engine.** | [hypothesis]; the tiering follows Thief's | Leonard: object tuning without scripting for most; pick-list triggers; weighted tables; a real programming language, which not every designer could use. [Plan](../plan.md#2-the-system-at-first-level): content is data | pack · 4, tool | **Produce:** the tool offers the first two tiers. A registry `fn` reaches a pack only as an engine release. **Check:** §12.2 |
| TIER-02 | **Build the profile library before teaching the beat language. A pack author should be able to write most of what the city needs without a `because` link.** | [hypothesis] | S2 §2.10 names gig, job and heist, con, four-beat, front, testing arc and slide as profiles still to be specified. Only the ladder exists (Appendix A). QBN shows what hand-built state costs (F-9) | gig, arc · 4, S2 | **Produce:** an appendix per profile before the first public tool, in the order authors ask. **Check:** the share of the starter and trial seeds written with no hand-written link (M16-10) |
| TIER-03 | **Teach from a complete working example, and make the first working seed take minutes.** | [practice] for the gap; [hypothesis] for the remedy | The RED Modding quest index lists guides for parts (viewing quest files, voice-over and subtitles, lipsync sets, communities, garage doors) and I saw no end-to-end guide. Crawford: authors would not make the large investment (F-1). Instance: `new` writes a ladder pack that checks, fits and surveys on day one | pack · tool | **Produce:** a starter pack generated from R1's shape with all three exits written. **Check:** M16-05, the time from install to first fit |
| TIER-04 | **A pack author never edits the game's quest files.** | [analysis] | Quest state in the game is global named integers read from `.quest`, `.questphase` and `.scene` files, with graphs joined by handle references (RED Modding wiki); the editor has no undo (F-6). Packs reach the game through fact reads, declared writes under `story.write-vanilla`, and the bridge (S2 §2.5, L-12) | pack · 4, S4 | **Produce:** no pack construct names a quest file. **Check:** L-12, L-28. Exceptions are voiced scenes and animation (P8) and any scene format S2 §15 leaves open; DS-45 lists what the runtime cannot do and the tool says so before the author writes it |
| TIER-05 | **What a non-programmer can realistically write is a hypothesis to measure. I expect: parameters, text units, a window of a few facts chosen from a picker, and intent notes. I expect they cannot write `count` patterns, `believes` atoms, `fn` atoms or `kernel` effects unaided.** | [hypothesis]; no study found | Praxis was written by its own authors for Versu; no outside author study exists (F-2). The Studio's "it just works" rule: where something can't be done unaided, give plain guidance | pack · tool | **Check:** §12.2. **Produce:** pickers and templates for the hard atoms; the explain tool shows their effect |

### D. The edit, lint and fit loop (AUT-02)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| LOOP-01 | **Two speeds. Static checks answer as the author types; checks that need a world run on request or on save, and say so.** | [practice] | Inky compiles continuously and highlights errors as you type; the Yarn Spinner editor flags errors as you write (both opened). S2 §11.1 mixes lints that need only the document (L-01, L-13) with lints that need sample worlds (L-29, run by the fit report) | all · tool | **Produce:** a static/sampled column on each lint (S16-S2-05). A budget for static checks [J: 200 ms for 100 templates]. **Check:** M16-01 |
| LOOP-02 | **Every finding has a stable code, a place, plain words and a fix hint. A message for a missing name suggests the nearest declared one.** | [practice] | Yarn's editor offers quick fixes and "did you mean" suggestions (opened). The project's policy: never show a bare error. Instance: "Fact `q112_done` is not in the game's facts list. Did you mean `q112_complete`?" | all · tool | **Produce:** the finding contract of S16-S2-05, with text from S4's plain-English lexicon. **Check:** M16-02 |
| LOOP-03 | **Findings point at what the author wrote. Profile expansion and the variant merge keep a source map.** | [hypothesis]; follows from S2 §2.10 and §3.1 | S2 expands a profile into beats the author never wrote and lints the result. No source map exists in S2 (I searched the specification). Instance: "L-10: the lapse exit has no content" must point at `exits.lapse`, not at `exit-lapse` | all · 2, tool | **Produce:** each expanded part records the parameter or field it came from. The map is built at tool time and is not saved with the instance. **Check:** M16-03, every finding on an expanded part resolves to a source span |
| LOOP-04 | **A preview keeps its place. After an edit, rerun the same samples and world seeds and show what changed.** | [practice] for the replay; [hypothesis] for the diff | Inky's play pane remembers the author's earlier choices and fast-forwards after a recompile (opened). S2-I-1 (determinism) means the same inputs give the same fit report, so a difference is the edit's doing. Instance: "sample 3 now waits instead of fitting; the window's `closes` changed" | all · tool | **Produce:** a diff of two `FitReport`s (S16-S2-06). **Check:** an unedited rerun is byte-identical (M16-06) |
| LOOP-05 | **Pin from the report, and let the tool write the pin into the file.** | [hypothesis], extending S2 §11.2 and DS-43 | S2 says the report shows the `Part` to paste. Pasting by hand is where typos happen | all · 2, tool | **Produce:** the report carries, for each draw or cast, the source span and the `Part` to write; the tool edits the text form and re-checks. **Check:** after a pin the same sample reproduces the pinned choice |
| LOOP-06 | **When a role cannot be cast, say which single relaxation would help and how many candidates it would give.** | [hypothesis]; extends dossier 3's starvation record (§4.2) | The fit report already lists candidates and reasons (S2 §11.2). A leave-one-out count over `must` terms is a query per term (S2 §5.2 runs the kernel query with `limit: 'all'`) | gig, arc · 2, 3, tool | **Produce:** `nearMiss` in the report: for each unfilled or thin role, per `must` term, the candidate count if it were dropped (S16-S2-06), within the query budget. **Check:** the count equals a manual relax in a fixture (SF-3 setup) |
| LOOP-07 | **Explain a condition in a sample state: every node of the expression with its yes, no or maybe, and what is missing when it is maybe.** | [practice] for the tool class; [hypothesis] for the use | Versu's inspector shows the state and the scores with reasons, and logical breakpoints show which practice made a fact true; articy's property inspector shows live changes during simulation (vendor). S2 §2.6: `maybe` comes from missing readings and undecided guards, which authors will not predict | all · tool, 1 | **Produce:** from S0's `trace`/`explain` plus the layer-2 predicate evaluator. **Check:** the tool's values equal the evaluator's in SF-1 and SF-7 |

### E. Previews (AUT-02)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| PRV-01 | **Three previews, cheapest first: one fragment's text with a chosen cast; the beat graph; the whole seed played in the simulated game port.** | [practice]; **contested** whether the graph should be editable | The Yarn Spinner editor has a preview running the real runtime, plus a graph view for a file or a project; articy's presentation view plays the flow; ink's play pane. WolvenKit edits graphs directly; ink's documentation prefers a text order that reads by eye. I found no study that compares them | all · tool | **Produce:** the graph is derived from links and read-only in the first tool. It marks the live-path count against `maxLive`, unreachable beats (L-44) and exits. **Check:** the graph and the compile agree on links |
| PRV-02 | **Previews run the real engine, not a copy.** | [practice] | Yarn's preview "runs dialogue with the real Yarn Spinner runtime" (opened). D-06: a slow reference model is the oracle | all · tool, 1 | **Produce:** the tool imports the reference model's layer 2 as a library. **Check:** SF fixtures run identically from the tool and from tests |
| PRV-03 | **Placeholders and constructed material are loud in every preview.** | [hypothesis] | STG-02. S2 §2.15 marks constructed causes. Instance: a placeholder prints in a different style and counts in the summary | all · tool | **Produce:** an item kind on every rendered line: authored, placeholder, constructed. **Check:** a ready seed shows zero placeholders |
| PRV-04 | **Preview the unhappy paths as often as the happy one: every exit, the decline, the unattended settlement, and every player setting that changes what plays.** | [hypothesis] | S2 §11.2 already gives `exits` and `declinePreview`. Setting atoms are never `maybe` (S2 §2.6) and the player's mix is quality bar 8, so they can be enumerated. Instance: R1 with the romance content tag off must reach `fade` (L-11) | all · 2, tool | **Produce:** the fit report runs under a settings matrix: tempo off, content tags on and off, `noticing` off, memory scale at its limits (S16-S4-07). **Check:** each exit and each alternate reports whether any sample played it |
| PRV-05 | **A preview says what it did not show: voices, animation, channel behaviour, real placement, timing in the game.** | [analysis] | The project's evidence rule (an offline run never proves game rendering). articy's "avoid logic errors" is the overclaim (F-10) | all · tool | **Produce:** a fixed footer on every report listing what the simulated port cannot show, drawn from the port's capability report (L-28) |

### F. Testing at scale (AUT-02)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| TST-01 | **Run many seeded worlds and count what each element does: reached, cast, played, stuck.** | [practice] | ChoiceScript's `randomtest`: 10,000 runs by default, with hit counts; about 100 hits in 10,000 is "very difficult" to reach (Towers). Short suggests thousands of randomised playthroughs and visualisation to find unreached or overused sequences. Versu ran hundreds of computer-controlled games at once | pack · tool | **Produce:** the **survey**: N world seeds across the sample states, with per-template, role, alternate and beat counts, stuck seeds (S2 §7.5), unreachable exits and the share of runs each fires. A starting flag at about 1 per cent [J, from ChoiceScript's example]. Heavy runs go under the project's memory guard. **Check:** a seeded dead beat is flagged (SF-24 setup). It does not prove unreachability, and loops need a human (Towers) |
| TST-02 | **Every finding can be replayed from one small file.** | [practice] | Versu's playback stores the player's chosen actions and requires a fully deterministic simulator (Evans and Short). S2-I-1 gives us determinism. Instance: a repro bundle of pack hash, world seed, sample, session inputs | all · 2, tool | **Produce:** `replay <bundle>`. **Check:** M16-06, byte-identical. It is also what an author attaches to a request for help |
| TST-03 | **Testing cannot judge writing. Give people a read-through and give the tool the honesty checks.** | [practice] | ChoiceScript finds errors and not prose problems (Towers). The honesty lints L-20, L-21 and L-58 are text checks. articy exports the flow as Word for reading (vendor list) | all · tool, 8 | **Produce:** a read-through export: every text unit a seed can say, in beat order, with its conditions and cast, as one readable file. **Check:** the lexicon lints on that file |
| TST-04 | **Test the author's expectations, not only the engine's rules. Let the pack carry assertions over the fit report.** | [hypothesis] | Versu's playback is regression in spirit. FitReport is structured data, so "sample 2 fits, role `place` has at least 3 candidates, `exit-lapse` is reachable" is cheap to state (S16-S4-10) | pack · S4, tool | **Produce:** `tests/` files in the pack; the tool reruns them on every check. **Check:** an edit that breaks an assertion names it |
| TST-05 | **Watch for the happy-path sample. Sample states written by one person show one person's world.** | [hypothesis]; extends dossier 3's starvation and repetition record | S2 §11.2 takes "a list of sample states". The survey reports cast spread per role (the same person in 90 per cent of runs signals a narrow `must`) and runs two or more packs together so claims between them show (SF-5) | pack · tool | **Produce:** the sample library (S16-P10-03) includes awkward states: the key person dead, the window closed, V wanted. **Check:** M16-07 |

### G. Collaboration (AUT-02, AUT-06)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| COL-01 | **Source is plain text with no layout, timestamps, generated ids or compression, one template per file, in a stable order.** | [practice] | Twine: compressed HTML makes diffs hard to read and Twee conversion helps (opened). Graph positions belong to a view, not to the source | pack · S4 | **Produce:** a formatter that rewrites a file to its canonical text. Graph layout is derived, or kept in a sidecar the diff ignores. **Check:** two edits to different templates merge without conflict |
| COL-02 | **Do not depend on live co-editing, and never keep the working folder in a sync service.** | [practice] | Twine has no simultaneous editing and warns against cloud sync for the library (opened). articy offers multi-user editing through SVN or Perforce on paid licences (vendor list) | pack · tool | **Produce:** files plus Git is the shared route. The Studio keeps its own history and autosave and treats the folder as the truth. **Check:** the tool refuses to open a library in a known sync folder without a plain warning |
| COL-03 | **Undo, history and backups are table stakes.** | [practice] | WolvenKit's quest editor: no undo or redo, and the wiki advises periodic backups. The project's data-durability rule | all · tool | **Produce:** the Studio's one history service gives scoped undo; the CLI's `format` and `pin` write backups or work on a clean tree |
| COL-04 | **Split work by fragment. A fragment reads only facts and its bound roles, so a writer can write fragments for another author's seed.** | [practice] for additions being safe; [analysis] for the split | Short: adding new content alongside old is relatively safe in storylet systems, which suits many contributors. S2 §2.8 | pack · 4 | **Produce:** fragments in their own files with explicit `needs`, `leaves` and role slots; the seed names the fragment ids. **Check:** a fragment checks alone against its declared roles |
| COL-05 | **Extensions are additive patches against stable ids. They never overwrite, and they never delete another pack's items.** | [practice] | RimWorld: whole-definition overwrite meant the last mod in load order won; patch operations arrived later, and their failures need to be loud (F-5). Project policy: additive choices, no replacement | pack · S4, 2 | **Produce:** a pack may add templates, and add alternates to slots a template declares (S16-S4-06). Order of application is by pack id, never by player load order, because determinism's inputs include "the documents" (S2-I-1). **Check:** two extensions to one slot give the same result in either order |
| COL-06 | **A broken file, template or pack never affects another.** | [practice] | RimWorld: a malformed file can crash the parser and remove all active mods; a sequence can stop at the first failure and hide the rest (F-5). S2 §3.1 already refuses one seed at a time | pack · S4, 2 | **Produce:** parse per file, lint per template, load per pack; a plain-English load report. **Check:** M16-09, corrupt one pack in N and N−1 still load |

### H. Versioning packs (AUT-06, with S2 §1.2 and §12.3)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| VER-01 | **Ids are permanent. Renaming is a tool operation that rewrites references. Retiring leaves a tombstone, with a reason and an optional replacement.** | [practice] | WolvenKit recommends soft deletion with a marker for signal-stopping nodes in published quests, and warns that hard deletion can leave users stuck (opened). The wiki's warning on editing quest facts (F-6). articy's conflict search catches duplicate technical names (vendor). Instance: `retired: xf.example:old-greeting -> xf.example:greeting-2` | pack · S4 | **Produce:** a `retired` list in the pack; ids are `<namespace>:<name>` (S2 §1.1) and duplicates across a pack are an error. **Check:** a reference to a retired id resolves through the tombstone or fails the lint |
| VER-02 | **Three numbers: the pack's version, each template's structure version and the language version. The tool computes what it can.** | [practice] for the numbers; [hypothesis] for the computation | Minecraft packs declare supported ranges and, since a late change, minor versions for non-breaking changes; SemVer's major, minor, patch rule (both opened). S2 §2.1 has `version: number`. S2 §1.2: wording changes freely under a live instance, structure cannot | pack · S4, 2 | **Produce:** a structure hash of the expanded document excluding text-unit contents; the template version must increase when the hash changes and need not when only text does (S16-S2-09). The pack's major number rises on a breaking change (S16-S4-04). **Check:** M16-08 |
| VER-03 | **An update must not strand a live save. The pack diff finds references a stored instance may still use.** | [analysis] from S2 §1.2 and §12.3 | A live instance runs on its stored document, so its structure is safe. Its `ContentRef`s resolve against the active pack at run time, so a removed or renamed text unit can break it. S2 does not say what happens then | pack · 2, S4 | **Produce:** the diff lists every removed id that any earlier release's templates cited; a tombstone or a `keep` entry is required (VER-01). S2 defines the run-time result (S16-S2-08). **Check:** a fixture removing a cited unit |
| VER-04 | **A pack declares the game version and the facts table it was checked against. A game update re-lints every installed pack and lists those affected.** | [practice] | Minecraft marks a pack incompatible or warns on a format mismatch, and supports ranges (opened). S2 L-01 checks fact names against the facts table; quest facts are game-owned and a game patch can change them (F-6; the lens reports a patch breaking a main quest, unchecked) | pack · S4, tool | **Produce:** manifest fields `game` and `facts` (ranges); on a change, a plain list: "These 2 packs read facts the new game version changed". **Check:** L-01 against the new table |
| VER-05 | **Compatibility has a direction. A newer engine loads older packs. An older engine declines a newer pack politely, naming the version it needs.** | [practice] | Minecraft: a format higher than the game supports shows as incompatible; other mismatches warn (opened). S2 §12.2 already sends a one-time `notice` for a compatibility change | pack · S4, 2 | **Produce:** a `lang` range in the manifest. **Check:** an unknown future field or version gives a notice, not a crash |
| VER-06 | **Tell the author who a change would hit. Report, for each changed template, how many sample saves hold a live instance and what the migration policy would do.** | [hypothesis] | S2 §12.3: `continue` by default; `withdraw` or `migrate` by a `migrate` entry; migration deferred. Most edits will be harmless; the report says which are not. articy writes change comments automatically (vendor) | pack · 2, tool | **Produce:** `diff` output with structure changes, text changes, in-flight impact and a draft changelog. **Check:** the changelog equals the diff |

### I. Mod-community practice and content economics (AUT-06, AUT-05)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| MOD-01 | **Cyberpunk has no first-party quest editor. The community route is WolvenKit with documented gaps. Our tool is the first author-facing surface for packs, and its absence of rivals is a duty, not an advantage.** | [practice] | RED Modding wiki: seven guides in the quest section, none end-to-end that I saw; WolvenKit's quest editor without undo (F-6). CDPR's REDkit exists for Witcher 3 (lens; not read) | pack · tool | **Produce:** documentation and a starter pack are part of the tool (TIER-03, TOL-06) |
| MOD-02 | **Start small. A small seed that is finished and tested serves a pack better than an ambitious one that is not.** | [practice] | Sasko via 80 Level: many remembered quests had small budgets. Nesmith: the system was easy to over-extend (F-8). S2's levels (glance, encounter, vignette) cost less to finish: L-35 asks for a `closing` only from gig level | enc, vignette · 4, tool | **Produce:** the starter pack and the first profiles are small ones. The tool shows the number of text units a seed still needs (ECO-01). **Check:** a lint cannot tell ambition from overreach; the survey shows the cost |
| ECO-01 | **Authorship is the bottleneck, so show the author what a seed costs to finish: text units, alternates, and the variant axes.** | [practice] | Sawyer: "the major bottlenecks are authorship" (McKeand). Versu's authors credit the language and text output for their pace. Lens L9:1 reports that variant axes multiplied cost at CDPR (lens; not checked) | pack · tool | **Produce:** a cost line in the report: units written, units missing, alternates, placeholders. **Check:** M16-11, the number of distinct experiences per unit written |
| ECO-02 | **Procedural help earns acceptance as a first draft the author accepts, edits or discards. In the first release, help the structure and not the prose.** | [practice] for acceptance; [hypothesis] for the scope | Ubisoft's tool offers two options for barks, background and UI lines; writers accept, edit or discard; it is not for cinematics or lore (Francis). Dramatron's study had 15 professionals co-write with a language-model tool (abstract); Loose Ends is a mixed-initiative interface for plot threads (abstract). Sawyer hopes for learned reaction rules, not invented content | pack · tool | **Produce:** suggestions from the tool's own knowledge: a missing exit (L-10), a missing clue route (L-26), a thin role (LOOP-06). No generated prose in packs. Whether a pack may include model-written prose is a policy question (open question 3). **Neither** a quality claim nor a sentiment claim is established here |

### J. The tool itself (AUT-02, P10)

| ID | Principle | Grade | Source and instance | Scale · layers | Operationalise |
|---|---|---|---|---|---|
| TOL-01 | **The first tool is files, a command line and a schema. Editor integration follows as a language server.** | [practice]; [hypothesis] for the order | The plan says files first, the Studio later. Yarn Spinner's authoring home is a VS Code extension (checking, graph, preview, autocomplete); ink needed its own editor (Inky). Thief's editor lesson: give it an owner and a specification (F-3) | pack · tool | **Produce:** commands `new`, `check`, `fit`, `survey`, `pin`, `explain`, `format`, `diff`, `build`, `replay` (S16-P10-01), on the TypeScript reference model (D-05 keeps authoring tools in TypeScript). A JSON Schema of the canonical form gives checking in any editor on day one (S16-P10-02) |
| TOL-02 | **Every command has machine-readable output with stable codes. Agents are authors and reviewers too.** | [analysis] | The project's rule on scriptable, agent-first tools; S2 §11 already numbers its lints | pack · tool | **Produce:** JSON on every command; a human table by default; non-zero exits on errors. **Check:** an agent can run check, read the finding codes and fix hints, and rerun |
| TOL-03 | **Check and Build agree.** | [analysis] | The repository's own rule for the mod pipeline: Check and Build must agree on the filtered snapshot, and a build refuses on failed gates (AGENTS.md). Same pattern here | pack · tool | **Produce:** `build` runs `check`, refuses on errors for a *ready* pack, lists omitted drafts, and writes the manifest. **Check:** a pack that checks clean builds, and the reverse |
| TOL-04 | **XF Studio hosts the tool as a feature module. It composes the component library, registers its actions, and is never the only way in.** | [analysis] | The architecture contract: one action registry; component-first UI (feature agents specify, the UI track builds); "show the options"; contributed defaults; instant response. Lock-in is the risk with a vendor's data model (lens, L9:16) | pack · tool | §11.3 lists the actions and the components specified |
| TOL-05 | **Profiles ship with several read-only example parameter sets. Authors save their own.** | [analysis] | Studio policy: defaults are contributed baselines, changed only by an explicit save | pack · S4, tool | **Produce:** example sets as data in the profile's pack; "save as" writes a new file |
| TOL-06 | **Treat the tool as a product: an owner, a specification, generated reference documentation, and the closed vocabularies shown with their meanings.** | [practice] | Leonard (F-3). S2 §2.3: tone, purpose and aesthetic vocabularies are closed and provisional until S4; dossier 3's FIT-34 asks for exemplars | pack · tool, S4 | **Produce:** a language reference generated from the registry, with each tag's definition and an example; provisional tags marked as such. **Check:** M16-05 |

## 5. Models the tools could run

Everything here is a design for the tools to be built, not a result. Numbers marked [J] are starting values.

### 5.1 What each kind of author sees

| Tier | Writes | Sees | Needs from the tool |
|---|---|---|---|
| 1. Parameter author | A profile form (ladder: `with`, `rungs`, `offers`, `exits`, `pacing`, `lapseAfter`, `absence`, `intimate`), text units, notes | The form, the text units, findings phrased against parameters, the fit report with Pin buttons | Example parameter sets, a starter pack, the profile library (TIER-02), no graph to read |
| 2. Graph author | Beats, links, windows, conditions, offers, costs, promises | Everything above plus the derived beat graph, the condition explainer, the survey | A condition builder from the facts table, pickers for hard atoms, source-mapped findings, near-miss explanations |
| 3. Extension author | Profiles, registry functions, vocabularies, kernel effects | The engine repository | Not a pack feature. Arrives as an engine release; profile definitions carry their own form metadata (S16-S4-13) |

### 5.2 A pack on disk

```
xf-example/
  pack.manifest         id, name, version, lang/game/facts ranges, authors, licence, credits, content tags, requires
  seeds/                one template per file (structure)
  text/en/              text units, one or more files; other languages beside it
  profiles/             only for packs that ship profile definitions (rare, engine-reviewed)
  tests/                assertions over fit reports, with their sample references
  samples/              optional extra sample states for this pack
  retired.ids           tombstones: retired id, reason, optional replacement
  releases/             the last released pack, kept for the diff (or supplied by path)
```

Nothing here holds code, layout, timestamps or generated ids (FMT-01, COL-01). The graph layout, if the Studio keeps any, goes to a sidecar the diff and the lint ignore.

### 5.3 The two forms of one document (illustrative, not the grammar)

R1's window in the text form, against the tree it compiles to ([S2 Appendix A.3](../spec/seeding.md#a3-reference-scenario-r1)):

```
seed xf.example:takemura-quiet-hour
  maturity  playable
  level     arc
  purpose   bond, aftermath, loyalty
            "Two people who survived the same betrayal find out what they are to each other."
  role takemura   fixed game:takemura   anchor   on-lost withdraw
  role place      prefer 2   public == quiet and district == japantown
  window main
    opens   decided(q112_takemura_dead) and q112_takemura_dead == 0
            and q112_done == 1 and allied(takemura)
    closes  q115_point_of_no_return == 1
    on-close coda  text:quiet-hour-coda
  profile relationship-ladder
    with takemura   rungs acquainted, confided, close, partner
    exits decline: text:qh-decline   stay: text:qh-stay   lapse: text:qh-lapse
```

and a text file, where each unit has a stable id and a hash the tool keeps:

```
qh-lapse
  "You've been busy, and so have I. Come by when the week lets you. {takemura.name}"
  uses: takemura          todo: no
```

The compile target is S2's `Seed`; `{ all: [ { decided: ... }, { fact: ..., op: eq, value: 0 }, ... ] }` is what the first line of `opens` becomes. The printer takes it back. A programmer can still work in the canonical form.

**A finding about the specification's own example.** As listed in A.3, R1's window has `onClose: coda` and names no `closeContent`, which S2 L-09 refuses. The listing also names no `context`, which §2.1 marks as required. The fixtures SF-7 and SF-8 may supply both; the listing does not. An author following the specification would meet this first, which is the case for S16-S2-12.

### 5.4 The finding contract

Every command emits findings in one shape. The text is plain English from S4's lexicon.

```
{ code: "L-10", severity: "error", blocksReady: true, speed: "static",
  place: { file: "seeds/takemura-quiet-hour.seed", line: 14, path: "profile.exits.lapse" },
  text: "The ladder needs a closing scene for 'lapse', and none is written yet.",
  fix:  [ { do: "create-text-unit", id: "text:qh-lapse" } ] }
```

`place` is the author's span (LOOP-03), found through the source map. `fix` is a list of machine-readable actions, so an agent or the Studio can offer the repair as one step.

### 5.5 The two ladders

| Maturity | What it means | Sown into a player's game | Lint |
|---|---|---|---|
| sketch | purpose, context and named beats; notes instead of text | never; the lab can play it | parse, id, name and reference checks are errors; everything else is a to-do |
| playable | structure complete; placeholders allowed | never; the lab and the author's own game | structural lints are errors; missing text is a to-do |
| ready | structure and text complete | yes, when the player's mix allows it | every error and warning of S2 §11.1 applies; no placeholders |

Binding is orthogonal: a ready seed may leave its moment, place and hook open for fitting, and a sketch may fix everything.

### 5.6 The loop

| Step | Speed | What runs |
|---|---|---|
| Save or keystroke | static, [J] under 200 ms per 100 templates | parse, ids, references, the static lints, source-mapped findings |
| Fit | sampled, seconds | the fit report on the pack's samples under fixed world seeds, the settings matrix on request, with a diff against the last run |
| Survey | sampled, minutes, on request | many world seeds across the samples, under the memory guard; hit counts, cast spread, stuck seeds, unreachable exits |
| Pin | static | the tool writes the pinned `Part` into the text form and reruns the fit |
| Build | static + the above | `check`; refuses on errors for a ready pack; writes the manifest, the diff and the changelog draft |

### 5.7 What the survey reports

Per template and per element, from N seeded runs: sown, cast, played, stuck, withered, closed by each window policy. Per role: candidates (min, median, max) and the share of runs each distinct person was cast, so a narrow `must` shows as one person in nearly every run. Per beat and alternate: the share of runs reaching it, flagged below a threshold [J: 1 per cent, from ChoiceScript's example]. Per exit: reached or not. Per setting preset: the same. The output carries a content-cost line (ECO-01). Everything is deterministic from the pack hash and the seeds, so each flagged element has a repro bundle (TST-02).

### 5.8 Pack evolution rules

| Change | Breaking for live saves? | What the tool does |
|---|---|---|
| Edit the words of a text unit | No (S2 §1.2) | Bumps nothing; marks other languages outdated (FMT-05) |
| Add a template, text unit, alternate or fragment | No | Minor bump |
| Change a template's expanded structure | Not for live instances (they run on the stored document); yes for the next sowing | Template structure version must rise (VER-02) |
| Remove or rename a text unit a released template cites | Yes (a live instance may cite it) | Refuse the build unless a tombstone or `keep` exists (VER-03) |
| Remove a template | Live instances continue; the template is not sown again | Major bump, tombstone |
| Remove a template an extension or another pack cites | Yes | Major bump; the diff lists the dependents it can see |
| Narrow a window or fix a role the old version left open | Not for live instances | Report in-flight impact (VER-06) |
| Change a game fact a pack reads (game update) | Yes | Re-lint against the new table; list affected packs (VER-04) |

### 5.9 The minimal first tool and what XF Studio could host

**The minimal first tool** has seven commands on the TypeScript reference model: `new`, `check`, `fit`, `survey`, `pin`, `build` and `replay`. It adds `format`, `explain` and `diff` as soon as the text form exists. It needs the canonical JSON form, a JSON Schema generated from S2's types (so any editor checks it on day one), the sample library, and the finding contract. It needs no editor, no graph and no UI of its own. Order of work: (1) canonical form, schema, `check` with the existing lints, `fit` and `replay`; (2) the text form, printer and `format`, source maps, `pin`; (3) maturity and placeholders, the survey and `explain`; (4) pack diff, tombstones and `build`; (5) a language server; (6) the Studio module.

**What XF Studio could host.** The Studio is where the pack workspace, forms, the fit report and the survey would live. It already has the pieces: one action registry (each command is an action), a component library with a UI component track (feature agents specify, the track builds), a single history service, contributed defaults, and the `?verify=1` workspace for tests. §11.3 (S16-P10-09) gives the actions and the component specifications. The Studio adds convenience and must not add capability: anything it does, the command line does, because the community's packs are plain files (TOL-04, COL-02).

## 6. Walk-through: R1 as an author works it

The numbers and outputs below are invented for this dossier, not taken from a run.

1. **New pack.** The author runs `new --profile relationship-ladder`. A starter pack appears with the ladder's parameters filled with a read-only example set and every text unit a placeholder. It checks clean at *playable*.
2. **Fill in.** In the form (or the text file) she sets `with: takemura` as a fixed game identity. The binding control shows fixed, preferred (1, 2, 3) and open side by side, with the note field beside it.
3. **Check.** Within a fraction of a second: "The window uses `q112_done`; the game's facts list has no such fact. Did you mean `q112_complete`?" (L-01, with a suggestion). "The ladder needs a closing scene for 'lapse', and none is written yet" (L-10, at `exits.lapse`, not at a generated beat). At *playable* this is a to-do. When she moves the seed to *ready* it blocks.
4. **Fit.** Six samples. Two fit. One waits: the explain tool shows `decided(q112_takemura_dead)` is `maybe` there because the story state has not reached the quest that decides it. One sample has the place role at two candidates; `nearMiss` says dropping `district == japantown` (a `prefer` term, not a `must`) would not change it, but relaxing `public == quiet` to a preference would give nine. She pins the place as preferred strength 3 and the tool writes the line.
5. **Settings.** With the `romance-intimate` tag off, the `intimate` beat plays the `fade` alternate. With tempo off, only the authored seed is released (SF-11). Both rows are green.
6. **Text.** She writes the units. Each placeholder disappears from the preview; the footer still lists what the simulated game cannot show.
7. **Survey.** 2,000 seeded worlds over the pack's samples. The report shows `reunion` reached rarely and `exit-lapse` more often than she expected, because `lapseAfter` is 14 game days and the samples are short. She adjusts the samples, not the seed. A repro bundle is attached to the one stuck case; `replay` reproduces it.
8. **Build.** `build` runs `check`, finds the pack ready, diffs against release 1.0.0, finds a text unit renamed without a tombstone, refuses, and offers the `retired` entry. She accepts, and the build writes version 1.0.1 and a changelog draft.

## 7. Measures

Author-side measures for P9 and for the tool's own tests. Targets are [J].

| # | Measure | How | Target |
|---|---|---|---|
| M16-01 | Static check latency | Time `check` on packs of 10, 100 and 500 templates | p95 under 200 ms at 100 templates |
| M16-02 | Finding completeness | Share of findings with a code, a place, plain text and (where one exists) a fix | 100 per cent |
| M16-03 | Source-map coverage | Seed a fault in each profile parameter; check each finding resolves to the author's span | 100 per cent |
| M16-04 | Round trip | text to canonical to text over all fixtures, after `format` | Byte-stable |
| M16-05 | Time to first fit | From a clean install to a first fit report, for new authors in the trial | Median under 15 minutes |
| M16-06 | Replay identity | Rerun `fit`, `survey` and `replay` on the same inputs | Byte-identical |
| M16-07 | Survey flags | Seeded faults: a dead beat, a narrow `must`, a stuck seed; also the share of elements below the hit threshold in real packs | Every seeded fault flagged; no false clean |
| M16-08 | Pack diff | Seeded breaking changes (removed unit, renamed unit, changed structure) | All detected; no breaking change classed as minor; structure hash ignores text edits |
| M16-09 | Isolation | Corrupt one file, one template, one pack in N | The rest load; the load report names the cause |
| M16-10 | Non-programmer trial | Share of trial seeds finished with no hand-written link; share reaching *ready*; help requests per author | Reported; no target until the first trial |
| M16-11 | Text per experience | Distinct fragment-alternate-cast combinations seen in a survey, per text unit written | Reported per seed; trend only |

## 8. Tensions

| Tension | Between | Resolution or status |
|---|---|---|
| **Power against approachability** | S2's expressive language (promises, clocks, `believes`, turns) and what a newcomer can learn (F-1, F-2) | Profiles carry the power; the beat language is for the second tier; the trial measures where the line falls (TIER-01 to TIER-05) |
| **Strict lint against sketching** | S2's refuse-on-error and the need to save unfinished work | Maturity ladder; the runtime rule is unchanged (STG-03, STG-04) |
| **Logic-free text against writers' wish for inline variation** | The text lints (L-17, L-20, L-21, L-58) that need parseable text, and ink's inline logic | Variation lives in alternates with conditions (FMT-06, FMT-07). Open: whether that is too strict for writers used to ink |
| **Permanent ids against tidy names** | Authors rename as they learn; saves cite ids | Rename is a tool operation with a tombstone (VER-01) |
| **Replay against variety in preview** | Determinism (S2-I-1) gives the same result each run; an author wants to see another draw | An explicit "different world seed" control and a survey, never a silent reroll |
| **Additive extension against lint ownership** | A second pack adds alternates to a first pack's slot; who answers for the combined result? | The extending pack's lint covers its additions; the survey runs the combined set; order is fixed by pack id (COL-05). Slots are deferred (S16-S2-11) |
| **Samples against bias** | The author's samples decide what the fit report shows | An awkward-states library, cast-spread reporting, and the wish for real saves as samples (TST-05, S16-P10-03) |
| **Studio convenience against files-first** | A friendly UI and the community's plain-text habits | The Studio is a client of the same actions; nothing is Studio-only (TOL-04) |
| **Near-miss help against query cost** | LOOP-06 needs a query per term | Bounded by the existing query budget; skipped for roles whose scope is too broad to query, and said so |
| **Assistance against sentiment and rights** | Accept-or-edit drafts are what professionals use; sentiment about generated content is a lens claim, unchecked | Structural help only in the first release; prose policy is open question 3 and belongs with dossiers 18 and 19 |

## 9. Lateral links

- **Maturity grading** is the same idea as a compiler that warns during development and fails a release build.
- **Tombstones** are soft deletion in a database, and the deprecation notice in a software interface.
- **The pack diff** is an interface-compatibility checker: it asks what a consumer of the old version could still reference.
- **The survey** is coverage-guided random testing (as in fuzzing): seeded runs, counts per branch, flag what is rare or never seen, replay the failure. ChoiceScript's random test is the closest cousin in interactive fiction [comparison; the fuzzing link is from memory].
- **The source map** is a source map in the compiler sense: generated code reports errors in the author's file. Profile expansion is macro expansion, and the same hygiene problems apply.
- **`nearMiss`** resembles asking a constraint solver for a minimal relaxation, here a leave-one-out count [comparison, from memory].
- **Check and Build agreeing** is the repository's own partial-export rule applied to packs.
- **Profile forms with example sets** are the Studio's contributed defaults applied to authoring.
- **Additive extensions** are the CCXL stance: creators add choices and do not replace presets.

## 10. Open questions

1. **The text form's grammar.** A bespoke indentation-based syntax (as sketched), or a strict JSON-compatible subset of another format? The case for bespoke is located messages and no implicit typing (FMT-04). The case against is the parser we must maintain. The trial (T16-08) could compare the two on the same tasks.
2. **Select and plural forms in text units.** Needed for gender and number in inflected languages (lens). Whether the first release supports them depends on P8/S7 and on what V's text may assume.
3. **Model-written prose in packs.** Is a pack allowed to contain text drafted by a language model, how is it disclosed, and does the tool offer drafting at all? This is a policy question that belongs with ethics and rights (dossiers 18 and 19) and probably with the maintainer. I assumed no prose generation in the tool (ECO-02).
4. **Scene, voice and animation authoring.** What a pack scene is, who stages it, and how the lint checks it (S2 §15 item 2, P8). Until then, packs are text, structure and choices.
5. **Maturity per template or per pack?** A pack with one ready template and two sketches: does it install? My assumption: only ready templates sow, and the build lists the rest as omitted (TOL-03).
6. **What counts as a structural change.** Whether `note` fields, tone tags and `argues` entries change the structure hash. They do not affect play but they do affect fitting.
7. **How many samples are enough,** and how authors avoid the happy path (TST-05). The trial should log which samples authors actually add.
8. **Where packs live and how XF Core finds them.** Out of scope here; the manifest and folder rules should not assume a mod manager.
9. **Real saves as samples.** A read-only importer of facts and readings is cheap; whether the sample may keep personal save data (names, locations) is a privacy question for the harness.
10. **Whether graph editing is ever needed.** The first tool derives the graph and does not edit it. The trial and early users will say.

## 11. Requirements

Each traces to principles in §4 and names the exact specification section it extends or challenges. S2 is at v0.8.

### 11.1 S2 (the seed language and its lint)

| # | Requirement | Extends or challenges | Traces to |
|---|---|---|---|
| S16-S2-01 | **Maturity.** Add `maturity: 'sketch' \| 'playable' \| 'ready'` to the template envelope (default `ready` for hand-built fixtures). A template below `ready` is never sown into a player's game, whatever its `sow` says; the lab may sow it. Add a "blocks ready" flag to each lint. At runtime the rule stays: an error at sowing refuses the seed | §2.1, §1.3, §3.1 step 3, §11.1 | STG-03, STG-04 |
| S16-S2-02 | **Placeholders.** A `ContentRef` kind `todo` carries a generated line from the fragment id and cast. Allowed below `ready`; an error at `ready` (new lint L-72). Every report and preview prints it distinctly | §2.8, §11.1 | STG-02, PRV-03 |
| S16-S2-03 | **A text syntax for `Pred`.** Specify a grammar with one-to-one printing: `and`, `or`, `not`, comparisons, `decided(f)`, `role.p`, `cast(r)`, `seed(t) in {...}`, `beat(b) in {...}`, `response(b) is ...`, `hour`, `since`, `count`, `clock`, `exposed`, `cap`, `setting`, `believes`, `city`, `social`, `fn`. Semantics stay §2.6's. The literals `yes` and `no` are keywords, never booleans. Fixtures SF-1 and SF-7 run through the text form | §2.6 | FMT-03, FMT-04 |
| S16-S2-04 | **Source map.** Profile expansion (§2.10) and the variant merge (§3.1 step 2) record, for each generated part, the parameter or field it came from. Lint and fit findings report the author's span. The map is built at tool time; the saved `InstanceState.document` is unchanged | §2.10, §3.1, §12.1 | LOOP-03, FMT-08 |
| S16-S2-05 | **Finding contract and lint classes.** Each lint gets: `speed` (static or sampled), `blocksReady`, a plain-English template in S4's lexicon, and a machine-readable `fix` where one exists. Profile lints (L-02, L-10, L-11, L-16) are worded against profile parameters. Add: L-72 placeholder at ready (S16-S2-02); L-73 duplicate id inside a pack; L-74 a `ContentRef`, role or fragment that is unresolved or retired without a tombstone; L-75 two alternates of equal specificity that can both be eligible in a sample (warning); L-76 a text unit whose placeholder names a role or attribute the role does not guarantee (extends L-17 to parsed units). L-25 and L-40 stay unused | §11.1 | LOOP-01, LOOP-02, FMT-05, FMT-07, VER-01 |
| S16-S2-06 | **Fit report additions.** Add to `FitReport`: `nearMiss` per unfilled or thin role (candidate count if each `must` term were dropped, within the query budget); `diffFrom` (changes against a previous report with the same inputs); `pins` (for each draw or cast, the source span and the `Part` to write); `cost` (text units written, missing, placeholders, alternates); `settings` (the settings vector the sample ran under) | §11.2 | LOOP-04, LOOP-05, LOOP-06, ECO-01 |
| S16-S2-07 | **Fit under a settings matrix.** The fit report's input takes a list of settings vectors drawn from S4's enumerable registry (S16-S4-07), and returns a row per sample and vector. The first implementation runs `off` and the content-tag on and off cases; the rest wait on the director | §11.2, §0.3 | PRV-04 |
| S16-S2-08 | **Unresolved content at run time.** A live instance whose `ContentRef` no longer resolves: use the tombstone's replacement if there is one; otherwise the fragment is `unavailable`, the delivery is skipped with a `missing-content` record entry, and §7.5's stuck rule applies. A pack compatibility `notice` (§12.2) is sent once per branch. This is the gap VER-03 found: §1.2 says wording can change under a live instance and does not say what happens when it vanishes | §1.2, §7.2, §7.5, §12.2, §12.3 | VER-03 |
| S16-S2-09 | **Structure version.** Define `structureHash` as the hash of the expanded document excluding text-unit contents. The tool requires `Seed.version` to rise exactly when the hash changes. `Migration.from` refers to those versions | §2.1, §12.3 | VER-02 |
| S16-S2-10 | **Predicate explanation interface.** Layer 2 exposes, read-only, the value (yes, no, maybe) and the missing reading or undecided guard for every node of a `Pred`, at a given kernel revision and game time, without emitting anything (S0 I-13). It is the interface the explain tool needs | §2.6, §4.1 | LOOP-07 |
| S16-S2-11 | **Extension slots (deferred past the first public pack).** A template or beat may declare a named slot that accepts additional alternates or fragments from other packs. Application is additive and ordered by pack id; the extending pack answers for its additions' lint. Needs S4 (S16-S4-06) | §2.8 (`Beat.play`), §1.1, §7.2 | COL-05 |
| S16-S2-12 | **Make the worked example lint-clean.** Complete A.3 so R1 passes at *ready*: add its `context` and a `closeContent` for the coda window, or state that the fixtures supply them. Add a fixture, SF-46, that checks R1 in text form: parse, print, check clean at *ready*, fit on the SF-7 and SF-8 states | Appendix A.3, §14 | F-12, FMT-02 |

### 11.2 S4 (the pack format and settings)

| # | Requirement | Traces to |
|---|---|---|
| S16-S4-01 | **A pack is a folder and, built, one archive.** Manifest fields: id, name, version (SemVer), `lang`, `game` and `facts` ranges, authors, licence, credits, content tags, `requires`, `extends`. No code, layout, timestamps or generated ids in source. Layout as §5.2 | COL-01, VER-02, VER-04 |
| S16-S4-02 | **The text form of the seed document,** with its grammar (S16-S2-03 for conditions), a canonical formatter, located plain-English parse messages, and a closed set of literals. Canonical JSON is the programmer's alternative and the interchange form | FMT-01, FMT-02, FMT-04 |
| S16-S4-03 | **The text-unit file.** Stable id; text with `{role.attribute}` placeholders and select/plural forms (grammar waits on S7); no other logic; a content hash recorded per unit; language directories with a base-language fallback; translations go stale when the base hash changes; a `todo` marker | FMT-05, FMT-06 |
| S16-S4-04 | **Breaking-change rules and the pack diff** of §5.8: which edits need a major, minor or patch number; what the build checks; the changelog draft | VER-02, VER-03, VER-06 |
| S16-S4-05 | **Permanent ids, rename and tombstones.** `<namespace>:<name>` ids, duplicate detection, a rename operation that rewrites references, a `retired.ids` file with reason and optional replacement | VER-01 |
| S16-S4-06 | **Extensions are additive.** `extends: pack@range`; a pack may add templates, fragments and alternates in declared slots, and may not overwrite or delete another pack's items; order of application is by pack id; conflicts are reported at load in plain words | COL-05 |
| S16-S4-07 | **Settings are enumerable.** The registry lists every setting with a finite set of values and says which are lenses and which change eligibility. The tool derives, for each pack, the settings its seeds read, and the fit report runs those as a matrix | PRV-04 |
| S16-S4-08 | **Load isolation and the load report.** Parse per file, lint per template, load per pack. A broken unit disables that unit and says why in plain English; nothing else is affected | COL-06 |
| S16-S4-09 | **Compatibility behaviour.** A newer engine loads older packs; an older engine declines a newer pack and names the version it needs; a game update triggers a re-lint and a plain list of affected packs (the `notice` delivery of S2 §12.2) | VER-04, VER-05 |
| S16-S4-10 | **Pack tests.** A `tests/` folder of assertions over fit report and survey fields with sample references; `check` runs them and names any that break | TST-04 |
| S16-S4-11 | **Closed vocabularies are presented with meanings.** Each tag has a definition, a short example and a provisional mark until the composite seeds it; unknown tags get a "did you mean" | TOL-06 |
| S16-S4-12 | **Credits, licence and content tags** are manifest fields. A pack contains no game assets; the build refuses obvious violations once dossier 19 fixes the rules. The credit entries follow the project's credit policy | TOL-06 |
| S16-S4-13 | **Profile definitions carry form metadata:** labels, help text, field order, examples, and the read-only example parameter sets, so the form is generated and not hand-built. S2's `Profile` (§2.10) has `params: ParamSchema` and no author-facing text | FMT-08, TOL-05 |

### 11.3 P10 (tools, including a minimal first tool and what XF Studio could host)

| # | Requirement | Traces to |
|---|---|---|
| S16-P10-01 | **The command line.** Commands `new`, `check`, `fit`, `survey`, `pin`, `explain`, `format`, `diff`, `build`, `replay`, on the TypeScript reference model. JSON output for each, a readable table by default, stable finding codes, non-zero exit on errors. Order of work as §5.9 | TOL-01, TOL-02 |
| S16-P10-02 | **A JSON Schema of the canonical form,** generated from S2's types, shipped with the pack so any editor checks structure on day one. A language server (diagnostics, did-you-mean, quick fixes from `fix`, go-to-definition, completion from the facts table and vocabularies) comes after the text form | TOL-01, LOOP-02 |
| S16-P10-03 | **The sample library.** Named fixture states: V states, story windows (the key person alive and allied; dead; the window closed; V wanted), districts and times, including awkward ones. A read-only importer that turns a save's recorded facts and readings into a sample, keeping no personal data in the sample file | TST-05 |
| S16-P10-04 | **The explain tool.** `explain <seed> <path> --sample` prints a condition's tree with yes, no or maybe per node and the missing reading or undecided guard. Built on S16-S2-10 | LOOP-07 |
| S16-P10-05 | **The survey.** Specification of §5.7, with a run budget and the project's memory guard around heavy runs. Deterministic from pack hash, seeds and samples. Output: JSON, a table, and a repro bundle per flagged element | TST-01, TST-05 |
| S16-P10-06 | **Repro bundles and `replay`.** One file: pack hash, world seed, sample, settings vector, session inputs. `replay` reproduces the result byte-for-byte | TST-02 |
| S16-P10-07 | **The read-through export.** Every text unit a seed can say, in beat order, with conditions and cast, as one readable file for proofreading; the lexicon lints run on it | TST-03 |
| S16-P10-08 | **`pin` and `format`.** `pin` writes a fitted choice into the text form as a `Part` at the right span, reruns the fit, and works on a clean tree or makes a backup. `format` rewrites a file to its canonical text | LOOP-05, COL-01, COL-03 |
| S16-P10-09 | **The Studio module.** Each command above is an action in the action registry. The UI components below are specified here for the UI component track to build; this dossier designs no controls. Every UI change ships with light and dark captures at a narrow and a wide panel and passes the UI/UX review, as the architecture contract requires. Interactions respond at once; the fit and survey show plain progress and never block | TOL-04 |
| S16-P10-10 | **The pack builder.** `build` runs `check`, refuses on errors for a *ready* pack, lists omitted drafts, diffs against the last release, writes the manifest and a changelog draft. Check and Build agree | TOL-03, VER-06 |
| S16-P10-11 | **Documentation as part of the tool.** A language reference generated from the registry and vocabularies; a starter pack; a cookbook with one worked pack per profile | TIER-03, TOL-06 |
| S16-P10-12 | **A trial harness.** For the author trial (T16-08), opt-in logging of time to first fit, findings seen, findings fixed, help requests, and which samples authors added | M16-05, M16-10 |

**The Studio components to specify** (the UI component track decides the design; behaviours and states only):

| Component | Behaviour and states it needs |
|---|---|
| Profile form | Generated from the profile's schema and metadata; example-set picker with "save as"; per-field findings inline; empty, filled and invalid states |
| Binding control | Fixed, preferred (strength 1 to 3) and open shown at once as buttons, with a note field; never a dropdown |
| Condition builder | Fact picker over the facts table showing the guard state; the expression text beside it; a live yes, no or maybe per sample |
| Findings list | Grouped by place; code, plain text and a fix button; filter by "blocks ready" and by speed; sampled findings marked as such |
| Fit report table | Samples against roles, windows and exits; Pin buttons; changes since the last run highlighted; the near-miss line |
| Beat graph (read only) | Nodes by kind, live-path count against `maxLive`, unreachable beats, exits |
| Survey view | Hit counts and cast spread; flagged elements first; a repro button on each |
| Text-unit editor | Placeholder chips checked against role attributes; placeholder and todo badges; stale translation markers |
| Pack explorer and diff | File tree; changelog draft; in-flight impact |

## 12. Testing agenda

### 12.1 Offline, on the reference model (do first)

| # | Test | Passes when |
|---|---|---|
| T16-01 | Round trip text to canonical to text over all fixtures and R1 | Byte-stable (M16-04) |
| T16-02 | Static check latency at 10, 100 and 500 templates | M16-01 |
| T16-03 | Seed one fault in each profile parameter | Each finding resolves to the author's span (M16-03) |
| T16-04 | R1 in text form: check at *playable* and *ready*; fit on SF-7 and SF-8 | Clean once S16-S2-12 lands |
| T16-05 | Survey of R1 with a seeded dead beat, a narrow `must` and a stuck seed | All three flagged (M16-07); rerun identical (M16-06) |
| T16-06 | Pack diff over seeded breaking and non-breaking edits | M16-08 |
| T16-07 | Corrupt one file, one template, one pack | M16-09 |
| T16-10 | The `yes`, `no`, `on` fixture run through candidate text forms | The chosen form keeps them as written (FMT-04) |

### 12.2 Trials with people (after the first tool)

- **T16-08. Author trial.** Six to eight writers who do not program, given the starter pack and three tasks: change the tone of a ladder's lines; add a rung; write a small encounter from a profile. Measure time to first fit, findings that needed outside help, seeds reaching *ready*, and the share finished without a hand-written link (M16-05, M16-10). Run the same tasks for two programmers in the canonical form as a control. Compare the bespoke text form with a strict alternative on a second task (open question 1).
- **T16-09. Message comprehension.** Show twenty real findings and ask what each means and what to do. Rewrite the ones that fail.

### 12.3 In the game

This dossier's own claims need no in-game test: authoring happens offline. The first pack loaded in a game session belongs to the runtime sessions already planned. The friction log kept in those sessions should include anything an author would have wanted from the tool.

### 12.4 Longitudinal

With early pack authors, keep a friction log of authoring friction: every point where they stopped, asked for help, or worked around the tool. Review it at each tool release.

## Map-miss log

Fields met in this dossier that are not on the [map](map.md), with a source and the tier I would give. Localisation (EXP-06) and testing and replay (EVA-02) are on the map and belong to dossiers 21 and 23; this dossier covers only their author-facing side.

| # | Field | Source | Tier |
|---|---|---|---|
| M-1 | **Content-pack versioning, compatibility and tombstoning** (semantic versions, supported-version ranges, soft deletion of published ids) | Minecraft Wiki "Pack format" (opened); Semantic Versioning (opened); WolvenKit "Quest Editor" soft delete (opened) | Supporting; shapes the S4 pack format and the pack diff |
| M-2 | **Mod loading, patching and isolation** (additive patch operations, load order, containing a broken file) | RimWorld Wiki "PatchOperations" (opened) | Supporting; a sibling of AUT-06 |
| M-3 | **Authoring-time error design and source maps through generated code** (macro hygiene, located plain-language diagnostics) | None opened; the gap is in S2 itself (no source map through profile expansion). Compiler practice [memory] | Supporting; needs a targeted look before the language server is built |
| M-4 | **Authoring-tool learnability** (time to first working result, starter projects, example-driven learning) | Crawford, "End of an Era" (opened); the RED Modding quest guide index (opened) | Supporting; an evaluation field for the tool |
| M-5 | **Format ergonomics** (implicit typing hazards, diff-friendly text, comments, canonical formatters) | YAML 1.1 boolean type (opened); Twine source-control page (opened) | Peripheral; engineering note for S4 |
| M-6 | **Editor integration protocols** (language servers, editor extensions for narrative scripting) | Yarn Spinner editor page (opened) | Peripheral; engineering note for P10 |
| M-7 | **Authoring analytics** (showing writers how often content fires, as Obsidian did for NPC reactions) | McKeand's interview with Sawyer (opened) | Supporting; near EVA-02 and the survey |

## Credit candidates

Each third-party work that taught us something used in this dossier. "Opened" means I read it through a page converter, or the full text for the Versu paper; "summary" means an abstract, a search summary or a second person's account. Creator names are as the source shows them. A link marked "page" is an abstract or catalogue page. The Versu paper was read from a university-hosted copy; the DOI is the publisher's identifier as the copy's metadata gave it. The vendor page for articy:draft is marketing as well as a feature list; its claims are used only for what it says the tool offers.

| Creator | Title | Link | Status | What we learned |
|---|---|---|---|---|
| Richard Evans, Emily Short | "Versu—A Simulationist Storytelling System" (*IEEE Transactions on Computational Intelligence and AI in Games* 6(2), 2014) | https://doi.org/10.1109/TCIAIG.2013.2287297 | Opened (full text, part) | Authoring support tools (type checking, an inspector, deterministic playback, a stress-test tool), the production time they report, and the tuning cost that remained |
| Chris Crawford | "End of an Era" | https://erasmatazz.com/personal/self/end-of-an-era.html | Opened | Storytron's author on why it ended: too demanding for the audience |
| inkle | ink, and its editor Inky | https://www.inklestudios.com/ink/ ; https://github.com/inkle/inky | Opened | A text-first language whose editor checks as you type, lists issues and replays your choices after each edit |
| The Twine project | Twine Reference: "Collaborating on Stories" and the source-control page | https://twinery.org/reference/en/limitations/collaborating.html ; https://twinery.org/reference/en/limitations/source-control.html | Opened | No simultaneous editing, unreadable diffs from compressed HTML, and the warning against cloud-synced libraries |
| The Yarn Spinner project | Yarn Spinner documentation: Node Groups; the Yarn Spinner editor page | https://docs.yarnspinner.dev/write-yarn-scripts/advanced-scripting/node-groups ; https://yarnspinner.dev/editor/ | Opened | Variants as separate conditioned nodes; an editor with checking, a graph view, and a preview that runs the real runtime |
| articy (vendor) | articy:draft X feature list | https://articy.com/en/articydraft/feature-list/ | Opened (vendor page, marketing flagged) | Simulation and conflict-search checks, localisation states, version history over SVN or Perforce, automatic change comments |
| RimWorld Wiki contributors | "Modding Tutorials/PatchOperations"; "Modding Tutorials/Quests" | https://rimworldwiki.com/wiki/Modding_Tutorials/PatchOperations ; https://rimworldwiki.com/wiki/Modding_Tutorials/Quests | Opened | How additive patching replaced whole-definition overwrite, how it fails, and how hard XML quests are to extend |
| RED Modding wiki and WolvenKit wiki contributors | "Quests: facts and files"; "Visualize Quest files"; WolvenKit "Quest Editor" | https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/files-and-what-they-do/file-formats/quests-.scene-files/quests-facts-and-files.md ; https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/quest/visualize-quest-files ; https://wiki.redmodding.org/wolvenkit/wolvenkit-app/editor/quest-editor | Opened | Quest state as global named integers, questphases as graphs, and the editor's missing undo and soft-delete advice |
| GamesBeat (interview with Bruce Nesmith) | "Bethesda's Nesmith reflects on the difficult birth of Skyrim's 'Radiant Story' system" (27 January 2012) | https://gamesbeat.com/bethesdas-nesmith-reflects-on-the-difficult-birth-of-skyrims-radiant-story-system/ | Opened | How easily a quest system is over-extended, and how event conditions had to be tightened |
| Oleg Nesterenko (Game World Observer), reporting Philipp Weber | "Designing quests for The Witcher and Cyberpunk 2077" (13 September 2019) | https://gameworldobserver.com/2019/09/13/quests-witcher-cyberpunk-2077 | Opened | CD PROJEKT RED's staged route from half-page pitch to design document to rough playable |
| Rita Hou (80 Level), reporting Paweł Sasko's PC Gamer interview | "CD Projekt Red Reveals The Secret Key To Impressive Side Quests" (25 March 2024) | https://80.lv/articles/cd-projekt-red-reveals-the-secret-key-to-impressive-side-quests | Opened | A pitch acceptance ratio of 5 to 10 per cent, and small budgets behind memorable quests |
| Tom Leonard | "Postmortem: Thief: The Dark Project" (*Game Developer*, 9 July 1999) | https://www.gamedeveloper.com/design/postmortem-i-thief-the-dark-project-i- | Opened | Tiers of designer tools, and the lesson to treat the editor as a first-class product |
| Kirk McKeand (PCGamesN), interviewing Josh Sawyer | "'AI is the next step' - Obsidian's Josh Sawyer talks about the evolution of branching dialogue" (23 January 2017) | https://www.pcgamesn.com/josh-sawyer-branching-dialogue-ai | Opened | Authorship is the bottleneck of reactive content, and data tracking already helps writers |
| Bryant Francis | "Here are more details on Ubisoft's Ghostwriter AI tool from GDC 2023" (*Game Developer*, 22 March 2023) | https://www.gamedeveloper.com/marketing/here-are-more-details-on-ubisoft-s-narrative-ai-tools-from-gdc-2023 | Opened | First-draft help that writers accept, edit or discard, kept away from cinematics and lore |
| Emily Short | "Beyond Branching: Quality-Based, Salience-Based, and Waypoint Narrative Structures" (2016) | https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/ | Opened | How authors work in salience and quality-based systems, the bookkeeping, the weight tuning, and the testing difficulty |
| Emily Short (reporting a talk by Elan Ruskin of Valve) | "GDC 2012 Talk on Dynamic Dialogue" (16 March 2012) | https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/ | Summary (the talk's slides were not read) | A rule system where the most specific matching rule wins and the tools are aimed at writers |
| Rachel E. Towers | "How to get the most out of automated testing, part 2" (Choice of Games, 2018) | https://choiceofgames.com/2018/01/how-to-get-the-most-out-of-automated-testing-part-2 | Opened | Seeded random runs with hit counts, and what they cannot find |
| Max Kreminski, Melanie Dickinson, Noah Wardrip-Fruin, Michael Mateas | "Loose Ends: A Mixed-Initiative Creative Interface for Playful Storytelling" (AIIDE 2022) | https://ojs.aaai.org/index.php/AIIDE/article/view/21955 | Summary (abstract page) | A co-creative interface for managing plot threads, with a preliminary expert evaluation |
| Piotr Mirowski, Kory W. Mathewson, Jaylen Pittman, Richard Evans | "Co-Writing Screenplays and Theatre Scripts with Language Models: An Evaluation by Industry Professionals" | https://arxiv.org/abs/2209.14958 | Summary (abstract) | A study in which 15 professionals co-wrote with a hierarchical language-model tool |
| James Dameris, Rosaura Hernandez Roman, Max Kreminski | "Praxish: A Rational Reconstruction of a Logic-Based DSL for Modeling Social Practices" | https://ojs.aaai.org/index.php/AIIDE/article/view/27537 | Summary (abstract page) | Versu's authoring framework has had no comparably approachable successor |
| Minecraft Wiki contributors | "Pack format" | https://minecraft.wiki/w/Pack_format | Opened (part) | Declared supported-version ranges, mismatch warnings and minor versions for packs |
| Tom Preston-Werner | Semantic Versioning | https://semver.org/ | Opened | The major, minor and patch rule |
| YAML specification authors (the page I read shows no names) | YAML 1.1 "Boolean Language-Independent Type" | https://yaml.org/type/bool.html | Opened | The literals read as booleans, which clash with `yes`, `no` and `on` |

Also taught us through lens accounts and not opened (so no credit line is made until opened): Microids' use of articy; CDPR's REDkit for Witcher 3; the Saltsea Chronicles test bot; Allcorrect on localising generated text; Vincke on capture costs; the Creation Kit pages on Radiant Story and aliases (blocked); Ruskin's slides; the 2026 industry survey; The Forgotten City and Enderal scope accounts.
