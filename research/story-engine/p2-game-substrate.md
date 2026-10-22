# P2. Game substrate research

**Status:** v1 plan, 22 October 2026. This is second-level plan P2 of the [first-level plan](plan.md#5-second-level-plans): workstream 2, work packages [WP-07 and WP-12](plan.md#82-work-packages). It absorbs design seeds [DS-21](design-seeds.md) (the game's quest graphs as a corpus), [DS-33](design-seeds.md) (a story machine instead of generated graphs), [DS-34](design-seeds.md) (the game is ground truth) and [DS-44](design-seeds.md) (windows on the game's own story).

## 1. Purpose

The simulation layer mirrors what the game owns and simulates only the rest ([foundation §7](foundation.md#7-how-the-layers-map-onto-it)). To do that, the engine must know four things about the game itself:
- **What it owns:** story state, people, groups, places, time, police, streaming.
- **How to read each of those:** which records, facts and events.
- **How to act on each of those:** which verbs, and with what limits.
- **What its own content looks like as structure:** the corpus.

P2 produces that knowledge in a form the specifications can cite.

Everything P2 learns about the engine's systems goes into the shared [knowledge base](../../knowledge/README.md), under its rules and evidence grades. Story Engine-specific conclusions go into this folder.

## 2. What already exists

Start from these. Don't redo them.

| Page | What it already answers |
|---|---|
| [Quests and story](../../knowledge/quests-and-story.md) | How a mod adds a quest phase, journal, facts, map pins, phone messages, scenes and persistent systems. Script can't create journal entries. No mod generates quest graphs. What can be hot-reloaded |
| [NPC reactions](../../knowledge/npc-reactions.md) | Crowd look-at reactions, reaction triggers, voiceset lines, the gap in civilian lines |
| [NPC direction](../../knowledge/npc-direction.md) and its [design](../runtime/npc-direction-design.md) | Spawning, moving and speaking through the bridge |
| [World and streaming](../../knowledge/world-and-streaming.md) | Streaming blocks and sectors, placement records, mod world content. The world index plan (W0–W1) in [world ideas](../backlog/world-and-interactive-ideas.md#world-phased-plan) |
| [Save files](../../knowledge/save-files.md) | Save layout and where mods keep their data |
| [Terminals and arcade](../../knowledge/terminals-and-arcade.md) | Browser pages, computer menus, phone messages within authored slots |
| [Player control](../../knowledge/player-control.md), [runtime access](../../knowledge/runtime-access.md) | What the bridge can drive and read, and its limits |
| [Story systems deep dive](../mod-ecosystem/b1-story-systems.md) | Six installed story mods studied: Dark Future, Virtual Atelier Delivery, the stock market mod and others |

## 3. Questions, by area

Each area gives the question, why the engine needs the answer, and the output. The **graded result** is what the specifications cite: each claim carries its knowledge-base grade.

### A. The main story as state (highest priority)

**Question:** how does the game record story progress? We need the facts, quest phases and journal states that mark:
- each act and its key turning points;
- who is alive, allied, romanced or estranged;
- where the point of no return is;
- which endings are open.

**Why:** authored seeds name windows on the story ("after the parade", "while he is alive and allied"). Fitting must evaluate those windows on any save ([DS-44](design-seeds.md), scenario R1).

**Output:**
- a story-progression map, as a knowledge page plus a data table of names and conditions (no assets);
- a list of characters whose state the game tracks, with the facts that carry it;
- the vanilla romance and relationship facts.

**Method:**
1. Read `base\quest\cyberpunk2077.quest` and the main phases from the corpus (area H).
2. Check fact names against the decompiled scripts and the wiki.
3. Confirm a sample by reading facts on real saves through the bridge (`world.state` reads named facts), in a booked session.

### B. Gigs, hustles and fixers

**Question:** how does the game structure its open-world work? This covers:
- how fixers offer gigs (messages, calls, map markers, journal);
- the phases and outcomes of a gig, and the optional objectives;
- rewards and reputation;
- NCPD scanner hustles and assault-in-progress activities;
- how activities spawn their people;
- what each gig's journal and phase structure look like.

**Why:** gigs are the medium scale (milestone M5). Vanilla's structure is the baseline players know, and its delivery channels are ones we may reuse.

**Output:** a knowledge page on open-world activities, plus decompositions of a sample of gigs (area H).

### C. Population and groups

**Question:** who appears where, and why? This covers:
- crowd and community spawners;
- character records and archetypes;
- faction and affiliation records, and district records;
- how gangs are placed by district;
- what an NPC's record tells us (gender, faction, voice, appearance);
- what is persistent and what is ephemeral.

**Why:** the coarse population fields in layer 1 must be read from the game, not invented ([DS-32](design-seeds.md), [DS-34](design-seeds.md)).

**Output:** a knowledge page on population and affiliations, and the record paths the game port reads.

### D. Places

**Question:** what the game says about places: districts and subdistricts, points of interest, interiors, workspots and AI spots, which places are public and which are private, and how a place's character is recorded (wealth, danger, gang).

**Why:** casting queries need place dimensions ([DS-49](design-seeds.md)).

**Output:** a knowledge page section and the list of place dimensions the world index (W1) should expose. Coordinate with the world index plan rather than duplicating it.

### E. Channels to the player

**Question:** for each channel, what can be read and written, and how custom content gets in:
- phone messages and contacts;
- holocalls;
- the Kiroshi scanner (can we supply our own scanner entries?);
- crowd barks and voicesets;
- shards and readable items (custom text through TweakXL and ArchiveXL?);
- notifications;
- the journal and a journal-free tracker;
- map pins.

**Why:** realisation needs these ([DS-18](design-seeds.md), [DS-33](design-seeds.md), requirements V3–V8).

**Output:** a table of channels: route, limits, grade, and whether the bridge already reaches it.

### F. Events the game emits

**Question:** which script-visible hooks report:
- deaths and knockdowns;
- crimes and police heat;
- district and interior entry;
- vehicle use and purchases;
- quest and journal updates;
- dialogue choices;
- time skips;
- save and load.

**Why:** the world event feed (requirement S1) and perception.

**Output:** a list of hook points (class, method or callback, what it carries), graded, for the bridge chat to turn into an event feed.

### G. Saves and identity

**Question:**
- how to identify a save and its lineage (a save made from a loaded save);
- how existing mods key their state to saves (the session-key fact pattern);
- what happens to mod state on a new game, on loading an older save, and on deleting a save.

**Why:** the world record branches with saves ([DS-08](design-seeds.md), requirement P1).

**Output:** a knowledge page section and a proposal for the save key.

### H. The quest corpus

**Question:** what the game's authored quests and gigs look like as structure. This covers:
- phases, nodes and their types;
- facts read and written;
- journal entries;
- scenes and their roles;
- the size and shape of the graphs.

**Why:** the corpus test of the composite ([DS-21](design-seeds.md)), the story-progression map (area A), and a statistical picture of how professional quests are built.

**Method:**
1. **Extract** the quest, phase, scene and journal resources with the native reader or WolvenKit CLI, as JSON. Do it on C (`%USERPROFILE%/xfs-scratch/story-engine/quest-corpus`) under the memory guard, then move the result to `research/consumers/quest-corpus/json/`, which is ignored. Track only a manifest: tool versions, counts and hashes.
2. **Structure statistics:** node-type counts, phase sizes, fact usage, branching factor, and scene counts per quest.
3. **Decompositions** of a sample into the composite's representation, once its schema exists (P1 phase D):
   - about ten gigs across several fixers;
   - about five side quests widely held to be strong;
   - about five held to be forgettable.

   The sample is chosen from published critical and community opinion, with sources cited, so that it isn't our taste.

**Spoilers:** the vanilla game is not a spoiler concern for the maintainer. The live DM's material is excluded entirely ([D-14](decisions.md)).

## 4. How it runs

Questions about the game and its systems go to the project's [research queue](../backlog/research-queue.md), which XF · Meta-coordinator runs on every chat's behalf and delivers into the knowledge base ([D-16](decisions.md)). This vertical sends each area below as a request in the queue's format, with what it serves, when it's needed, and what has been checked. It keeps only quick lookups inside its own scope.

| Step | Request | Priority for this vertical | Notes |
|---|---|---|---|
| 1 | Area A: the main story as state | First | Serves scenario R1 and every authored story window |
| 2 | Areas B, C and E: gigs and fixers, population and groups, channels to the player | Second | Serves layer 1's mirror and realisation |
| 3 | Areas D, F and G: places, game event hooks, saves and identity | Third | D is coordinated with the world index plan; F and G also feed the [runtime requirements](runtime-requirements.md) |
| 4 | Area H: the quest corpus extraction | With step 2 | One disk-heavy, memory-guarded job; the decompositions wait for the composite's schema (P1 phase D) |
| 5 | In-game confirmation of samples (facts on saves, a scanner entry, a channel check) | When a session is next prepared | Batched onto the runtime bridge's session card |

This vertical turns the delivered knowledge into what its specifications cite. That includes the story-progression table used by fitting, and the event and channel lists in the runtime requirements.

## 5. Done when

- Areas A–G each have a graded knowledge page or section, with open questions listed.
- The corpus is extracted, with its manifest tracked and the statistics published.
- The story-progression map can answer: "on this save, is window W open?"
- The channel table and the event-hook list have been sent to the bridge chat and are reflected in the [runtime requirements](runtime-requirements.md).
