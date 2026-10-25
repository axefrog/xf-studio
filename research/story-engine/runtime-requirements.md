# Runtime requirements

What the Story Engine needs from the running game. This list is decided by what the system needs, not by what exists today. Each row is then matched to whatever provides it: the [runtime bridge](../../projects/xf-runtime-bridge/README.md), an [XF Core](../runtime/xf-core-architecture.md) plugin of our own, or a standalone mod. The runtime bridge's coordinating chat reads this page at each of its milestones and marks the bridge's status per row. Rows are raised by message when they start to matter.

## Current picture

Refreshed whenever the bridge reaches a milestone; last refreshed 23 October 2026.

- **Where the code is.** `main` has bridge 0.8.5. Bridge 0.8.8 (branch `claude/bridge-080a`) holds NPC direction and the read-only senses (S2 to S6), built and tested offline but never run in game; the DM toolkit (`claude/bridge-080-dm`) is work in progress.
- **XF Core C1** is designed (`research/runtime/xf-core-architecture.md` on `claude/xf-core-design`). It takes all 12 plugin API needs and `companion@1` into account. The plugin lives in `projects/xf-story-engine/`, built against the published SDK. The Story Engine's review (5 blocking, 9 missing, 6 changes) was resolved in design round 2 (`7adc6430`): 17 accepted, 2 changed, 1 partly deferred. Highlights:
  - saves go through `ledger@1`, an append-only branching ledger with a five-fact pin, committing on change;
  - release senses come from a first-party plugin, XF Senses;
  - `npc.direct@1` and `dm.beats@1` drafts arrive at the end of C1, and the NPC Direction port is in C3;
  - the SDK gets a protocol spec, fixtures, a core simulator and the TypeScript client, while the Rust crate is the Story Engine's own;
  - writes to vanilla state (O5) are a maintainer decision.
- **The order:**
  1. Session 11.
  2. Merge 0.7 and 0.8 into `main`.
  3. The XF Core plugin host (phases C1–C3), proposed ahead of porting the NPC and DM branches so that they land as plugins. The bridge chat is confirming this order with the maintainer.
- **Plugins.** A Story Engine plugin is welcome as an early non-photo client. A native part is first-party only (an `xf.` id, signed off, lab tier first). Our plugin API needs (below) go to the bridge chat before C1's design review.
- **Host-side driving** through the CLI, MCP or the shared tools library is agreed, under these conditions:
  - the XF Studio diagnostic test profile only;
  - game time booked on the coordination board;
  - the maintainer launches the game;
  - one session at a time;
  - catalogue commands only, never raw pipe framing;
  - every safety rule stands: kill, handover and the save lock.
- **Today, every bridge write takes a save lock** that blocks the game's own saves until a load. That suits test sessions but not a campaign (P4 below, [DS-39](design-seeds.md)).
- **The command API is on `main`** (bridge 0.8.3) in `projects/xf-runtime-bridge/tools/`: the catalogue (`api/catalogue*.ts`, with schemas and refusals), `api/command-api.ts`, the pipe client and a generated reference (`docs/mcp.md`). The engine's adapter imports it in place, pinned to a bridge version, and the commands it uses are registered with the bridge chat ([D-18](decisions.md)). Command names survive the move to XF Core.
- **Session traces for offline replay** are kept in `local/sessions/<date>-sessionN/`:
  - `calls.log`, with every command and its full answer;
  - the session log tail;
  - the plugin log.

  From session 12 they also hold a full event dump. They're private and never published.
- **Reuse, don't duplicate.** NPC direction ([design](../runtime/npc-direction-design.md), on its branch) and the DM toolkit cover much of what we need. Its beat-card runtime is the precise end of the seed language ([DS-35](design-seeds.md)).

**Status values:**
- **want:** needed and not covered;
- **partial:** some of it exists (the row says what);
- **planned:** in the bridge's or XF Core's plan;
- **branch:** built on a branch, not in game;
- **main:** merged;
- **proven:** seen working in game.

**Needed by** names the first milestone that depends on the row ([plan §4](plan.md#4-milestones)).

## Hosting

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| H1 | **A host-side route.** The engine runs as an ordinary program beside the game and drives it through the link with catalogue commands: it reads state and events, and sends verbs. Frame-rate work stays in game, armed by the host (behaviours, watchers, the sequencer). Used for development, the offline-to-live step, and the authoring preview; the shipping route is H2 ([DS-46](design-seeds.md)) | M4 | **main**, and agreed for the test profile |
| H2 | **A Story Engine plugin on XF Core:** a manifest, redscript for the game-side senses, verbs and watchers, and the engine itself as a **companion process** that XF Core launches (H6). The player installs XF Core and the plugin and nothing else. A first-party native part stays an option for anything that must run in process | M5 | **planned (C3):** plugin and companion; the companion protocol needs the review's call-in, handshake and restaging items |
| H3 | **An access class for story writes in the release flavour,** scoped to what the plugin owns, with consent. Release builds currently allow only reads, photo-mode changes and XF's own store | Later | **planned (C3), owned things only:** `write-owned` with per-plugin consent; writes to vanilla state wait on the open question O5 |
| H4 | **A frame budget and background scheduling** for plugins: per-frame slices that yield to the player and pause in menus, plus worker time for a native part. The XF Core design has no tick capability; today's behaviours live in the core | M5 | **planned (C3):** a tick with budgets; the companion's clock feed is a review item |
| H5 | **The sequencer and frame-rate behaviours** for staging beats (waits, conditions, per-step checks, undo) | M4 | **partial:** four behaviours on `main`; the host-side session runner and `npc.scenario` on a branch; XF Core's `sequencer@1` designed |
| H6 | **Companion processes.** XF Core starts a plugin's declared executable as a child process when the game starts. It talks to the child over a private pipe that XF Core owns. The supervisor lives in the core as the capability `companion@1`, which the plugin must declare and which the gate or the player's switch can deny.<br>Conditions agreed with the bridge chat for XF Core's C1 design review:<br>1. **First-party only:** the same rule as native parts (an `xf.` id, signed off, lab tier first). Third-party plugins never get a companion.<br>2. **What gets launched:** only the hash-pinned executable inside the plugin's own folder. No arguments or paths taken from data, and no shell. A hash mismatch is refused in plain words.<br>3. **Lifetime:** a job object with kill-on-close, below-normal priority and a memory cap. Bounded restarts (for example 3 per game session, with backoff), then a plain degrade. The kill switch ends the process, then runs the restore hooks.<br>4. **Its writes:** everything it sends passes the same gate, classes, pause and handover as any client. Only the external link's rate limit is waived.<br>5. **No network by default.** The manifest declares any network use, and the release consent screen states it.<br>6. **Packaging checks, early:** MO2's virtual file system reaching the child (tested from a virtualised folder), Vortex hardlinks, and antivirus false positives. A small native executable is preferred over a bundled runtime. Unsigned alpha releases will show Nexus and SmartScreen warnings, so the user gets a plain explanation.<br>7. **First proof:** an in-game session on a hello-world companion before the engine depends on it.<br>Benefits: a crash in the engine can't take the game down; the simulation runs on other cores, outside the game's frame; the engine is the same code the Studio and the offline prototype run ([DS-46](design-seeds.md), [DS-52](design-seeds.md), [DS-53](design-seeds.md)) | M5 | **planned (C3):** `companion@1` in the core (stdio, job object, hash); antivirus and import probes to run early |

## Senses

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| S1 | **A world event feed:**<br>- V's movement between districts, subdistricts and interiors;<br>- combat starting and ending, kills and knockdowns, NPC deaths;<br>- crimes and police heat;<br>- vehicle use and purchases;<br>- calls answered and dialogue choices;<br>- quest fact changes, time and weather;<br>- saves loaded | M4 | **partial:** the bridge's own event ring (`main`); `npc.*` events (branch); DM watchers for V's own state. **Designed:** [game events](../../knowledge/game-events.md) gives graded hooks and a minimal set of twelve event kinds (session, death, combat, heat, district, vehicle, vehicle acquired, journal, a fact watch-list, dialogue, call, time). Gaps: interior entry is polled; there's no "any fact changed" hook; dialogue picks are inferred |
| S2 | **Perception:** what V can see now (people and props in view, line of sight), what V looked at or scanned, and how close V came | M4 | **partial:** `scene.report` and the look-at target (`main`); a gaze watcher (DM branch); the scanner (whether V is scanning, its progress and the object it is on) is `player_status`'s scanner part, **proven** in session 15 (scanning an officer: scanning true, progress 1, the officer's record at 5.7 m; released: false) **Release route: planned** through the XF Senses plugin |
| S3 | **The people around V:** record, archetype, faction, appearance, current activity or workspot, and crowd density | M4 | **partial:** people within a radius (`main`); `npc.list` up to 40 m with crowd, protected and busy flags (branch). **Proven** in session 15 (bridge 0.8.8): each NPC's affiliation, type, rarity, archetype, attitude group and crowd flags in `scene.read`'s rows with `npc_detail` (NCPD officers read NCPD, vendors Civilian with crowd true). **Wanted next:** the entity template path (script can't read a resource reference as a path or hash; it needs a native read of the record's resource flat); the record paths are in [population and affiliations](../../knowledge/population-and-affiliations.md) §9 **Release route: planned** through the XF Senses plugin |
| S4 | **The places around V:** district and subdistrict, nearby workspots and AI spots, interiors, points of interest, and whether a point is reachable on foot or by car | M4 | **partial:** `world.probe` (streamed, navmesh, ground, clearance, sight line) on 0.8. **Proven** in session 15: `world.district`, V's district, subdistrict and place from the game's district system (it agreed with the map in Little China, Kabuki and four interiors, and was never stale after a fast travel). **Wanted next:** workspot queries **Release route: planned** through the XF Senses plugin |
| S5 | **Quest state:**<br>- facts;<br>- journal entries and their states;<br>- active quests and gigs;<br>- fixer standing;<br>- whether a vanilla quest has reserved a person or place | M4 | **partial:** up to 16 named facts beside the clock, read-only, on 0.8. **Proven** in session 15: `world.facts`, up to 128 names in one read (93 in about 340 ms with the round trip), with the presets `final_boards` (the 29 the game's final boards read, from [main-story state](../../knowledge/main-story-state.md)) and `main_story` (the [main-story facts table](main-story-facts.json), 93 facts in one call). Journal entries, active quests and fixer standing are not read |
| S6 | **V's state:** appearance tags, vehicle, wanted level, health, street cred, money, inventory summary and cyberware | M4 | **partial:** player state, appearance and wardrobe (`main`); cyberware and inventory (0.8). **Proven** in session 15: `player.status`'s health, level, street cred, money and current vehicle agreed with the screens; the inventory counted items the backpack hides (3 handguns for 1) and the star state read Searching under one solid star, both fixed in 0.8.9 and **proven** in session 16 (the weapon stacks equal the inventory screen: 1 handgun, 1 knife, 1 machete, with 35 of 79 stacks hidden as the screen hides them; one solid star read `look: solid`, `stars: 1`). `equipped` listed two clothing items while V wore more, because an outfit's pieces are visual only and never equipped: 0.8.10 adds `clothing` per area (what is equipped, what the area shows) and a plain note **Release route: planned** through the XF Senses plugin |
| S7 | **What V witnessed, as reports tied to their incidents:** when V sees or hears an incident (a theft, an assault, an accident, a street fight, a police stop, a collection at a stall), one report naming the incident's identity, who took part, where, when, and how V perceived it (saw, heard, was told) | M4 | **want (found by the M3 run, 25 Oct):** layer 3's gates need an event chain linked to V, and the simulation seldom realises one near V on its own (in M3 run 1, 43 named incidents, 5 with a cause, none a chain). M3 run 2 stood in for this report in the harness. The report must be **passive** (no change to anyone's ties or beliefs beyond V's own perception) and must carry the **incident's identity**, so a story ties to the right incident. Builds on S1 (the event feed) and S2 (perception) |

## Verbs

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| V1 | **Spawn and despawn people** with any record and appearance, friendly or hostile, at a chosen place, with an identity that survives streaming out and back in, and at crowd scale | M4 | **proven** (session 15): 10 cloned casts, non-persistent, friendly and immortal, at most 3 within 30 m, spawned facing V and gone after every teardown (a spawn beside a machine stood unseen in session 16, so 0.8.10 needs a sight line from V's head for a spawn asked for relative to her); `npc.pick` adopts existing people for look, face and speech |
| V2 | **Direct people:**<br>- walk or drive somewhere, use a workspot, follow or flee;<br>- look at, gesture, change expression;<br>- set their attitude to V;<br>- fight in a group, or surrender | M4 | **proven** for move, follow, turn and place (session 15); faces lost to the actor's own look-at reaction and walks went backwards; in session 16 the reaction system held back while directed (a smile stayed through 20 s face to face), the walk to V was forwards and a walk away from V was still backwards: 0.8.10 turns the actor to her way first [hypothesis] for session 17. Gestures need a carrier archive; no workspots, fleeing or fighting |
| V3 | **Speech:**<br>- overhead text, subtitles and holocalls;<br>- the game's own lines by voice and by line;<br>- dialogue choices with V | M4 | **proven** (session 15): subtitles, overhead text and 2–4 choices in the game's dialogue widget with the pick returned; voiceset triggers play, but the words are the voice's own and vary from call to call ("Wow, where do you shop?" and "whaddya want, friend?" from the same `greeting`), so a scene speaks its own subtitle; the holocall line type shows as a plain subtitle ("Caller: …", `call_subtitle`, proven in session 16). No chosen lines |
| V4 | **Phone:** messages and calls from contacts, including new XF contacts | M5 | **branch (in progress):** a text and a scripted call with subtitles in the DM toolkit. Script can't create journal entries ([DS-33](design-seeds.md)) |
| V5 | **Objectives and the map:** map pins, areas, and objectives in the journal or an XF tracker | M5 | **partial:** a test pin (`main`); quest dynamic map pins (0.8); a journal-free tracker (DM, in progress) |
| V6 | **Props and places:**<br>- spawn props, containers and shards with our own text;<br>- lock and unlock doors;<br>- hide nodes;<br>- place lights | M4 | **branch (in progress):** spawn, despawn, doors and lights, at most 24 things within 60 m. No shards or containers |
| V7 | **Facts:** read and set quest facts; keep XF's own | M5 | **partial:** read only |
| V8 | **Scanner text:** our own scanner entries for people and props | M4 | want. Three routes are known offline (TweakXL records with a scanning component, run-time events, rewriting chunks), none yet seen in game ([player channels](../../knowledge/player-channels.md)) |
| V9 | **Rewards and costs:** money, items, street cred and fixer standing | M5 | want |
| V10 | **Vehicles:** spawn them, drive routes, run chases | M6 | **branch (in progress):** `vehicle.set` |
| V11 | **World nudges:** time, weather, crowd and traffic density near a scene | M5 | **partial:** time and pause (`main`); weather (0.8). **Density routes located (static):** no TweakDB or static route; at run time `CommunitySystem.ChangeDensityModifier` thins the crowd (clamped 0.01 to 1.0, never raises it), `EnableDynamicCrowdNullArea` clears a box; more people come only from our own actors ([crowd adoption and identity §5](../../knowledge/crowd-adoption-and-identity.md#5-q3-density-hour-of-day-and-faction-shares)). Unrun: session rows CA8 to CA10 |
| V12 | **Messages to the player and a debug overlay** that shows what the director is doing (lab only) | M4 | **partial:** `ui.message` and `ui.hud` (`main`); overlay state (0.8); notifications (DM) |
| V13 | **Direct people the game protects** (vendors, police, quest-adjacent people) for a staged moment, or a clean way to stand them in: a clone in their look and place, with the original hidden for the scene ([dossier 20](craft/d20-staging-legibility.md) §12.2) | M5 | **not built; plan around stand-ins:** hiding and restoring someone else's NPC, and holding a crowd NPC's AI, are unproven, and quest reservation can't be detected safely (bridge `claude/bridge-080-npc`, design §5.4) |
| V14 | **Marks and ambient sound:** decals, stains, scorch and damage that persist for a set time and survive a reload; ambience and named sound cues at a place, with a fallback | M5 | want: no route known; a research request |
| V15 | **Mortal and hostile stand-ins:** spawned people who can be hurt and killed, who turn hostile or hand back to ordinary AI in combat, and who keep the game's reaction presets. Friendly, immortal clones read as a bug when V shoots one | M4 | **proven** (session 15): a hostile mortal stand-in was handed back in the fight, died and kept its body; the friendly actor was removed |
| V16 | **Out-of-sight staging:** spawn people and props outside V's view and hearing; dissolve by walking away and despawning only when out of sight; join a scene mid-phase, posed, with no visible fast-forward | M5 | **proven** (session 15): an out-of-sight spawn landed 12 m behind V unseen, and a dissolve release waited until V looked away |
| V17 | **Adopt crowd people into the simulation** (overriding the walk loops): take over a person the game's crowd system spawned, hold or replace their AI, and run them on the engine's routine (go to a place, use a workspot, meet someone, leave); keep their identity across sector reloads, so the same body maps to the same simulated resident (P3 §3.5, open question 3); release them cleanly back to the crowd. Only the people who matter are driven (people the protagonist knows, people in a live story, people where something is happening); the rest stays game crowd, kept consistent in aggregate (density by hour, gang and faction shares) through V11. Wider than V13, which holds a person only for a staged moment | M5 | **route (a) planned, route (b) researched (static), unrun:** route (a), substitution with an XF actor of the same look, is on the bridge roadmap after Borg 4, with a [probe checklist](probes/v17-crowd-substitution.md). Route (b): a crowd member is a full AI puppet with a lane component; stop and rejoin levers and a bounded adopt, direct, release design are in [crowd adoption and identity](../../knowledge/crowd-adoption-and-identity.md). Community NPCs have a persistent stub (community id, entry name, look) and fixed entity ids, so they can carry a key; lane-crowd pedestrians cannot. Unproven in game: a move command on a live lane walker, release back to the lane, key stability across a reload (session rows CA1 to CA7) **Scope (bridge 0.8.19):** `npc.substitute` acts on lane-crowd walkers only and refuses community-spawned people, because the game can't reliably say when a quest reserves one and the original would stay hidden for good. A substituted walker's identity is the engine's `resident` key (a hash of record, look and spot), with `respawn` parameters that bring the same look back after a reload. Community people (stallholders, vendors, people at fixed spots) can be read, including their (spawner, entry, ordinal) key, but driving them waits for true adoption (route b). The probes run as the bridge's CRS1 to CRS11 in the session after Borg 4 |

## Persistence

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| P1 | **A store keyed to the save:** the save's identity and its parent, so the world record branches with saves ([DS-08](design-seeds.md)) | M6 | **planned (C3):** `ledger@1`, XF Core's append-only branching save ledger, with the five-fact pin from [save identity](../../knowledge/save-identity.md), committing on change; a session card proves the pin |
| P2 | **Restage after load:** bring back whatever should be present | M5 | **planned (C3):** restage hooks; an asynchronous restaging state is a review item |
| P3 | **A store quota sized for a world record** (megabytes, compressed) | M6 | **planned (C3):** save-scope store with quotas; large records need streaming |
| P4 | **Story writes without the save lock:** a save-safe route for everything the Story Engine changes ([DS-39](design-seeds.md)) | M5 | **planned (C3):** play mode takes no save lock |
| P5 | **Saves at a tick boundary:** the host takes the Story Engine's checkpoint only between ticks, so a save never splits one of its operations (a sow and its bookkeeping) ([S3 §9.4](spec/procedural.md)) | M4 | **route found:** Codeware's `Session/BeforeSave` runs callbacks synchronously before the save step returns, so it is the commit point. The checkpoint commits the record as of the last completed tick ([save identity](../../knowledge/save-identity.md#the-story-engines-save-key)). Still open: whether autosaves and quick-saves run that step (session card row 4) |

## Safety and coexistence

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| C1 | **Never break vanilla quests.** Detect people and places a vanilla quest has reserved, and avoid them; the kill switch restores everything | M4 | **partial:** refusals in combat, vehicles, scenes, dialogue and busy states; protected and busy flags (branch). No reservation check |
| C2 | **Respect the player's settings,** such as subtitles and crowd chatter turned off | M5 | want |
| C3 | **Release consent and a switch per feature** | Later | **planned** (XF Core link consent) |

## XF Core plugin API needs

For the plugin host's design review (phases C1–C3). Each item names the rows above it serves.

1. **A capability we provide.** `story.seed@1` lets other plugins and content packs sow seeds through the same interface as the procedural engine ([DS-40](design-seeds.md)).
2. **Data-only packs.** A manifest with data and no scripts, which requires a capability such as `story.seed@1`. Content packs then install, version and refuse exactly like plugins, through the Studio's install host ([DS-38](design-seeds.md)).
3. **Capabilities we consume** rather than duplicate: NPC direction, the DM toolkit's beats and watchers, and the light host, provided by their own plugins (V1–V6, H5).
4. **Lifecycle:**
   - start once the game's systems are ready after a load, in dependency order;
   - suspend and resume around menus, photo mode, braindances, vanilla scenes and loading;
   - stop at session end;
   - game-state gates as events (H4, C1).
5. **Events:**
   - the world event feed (S1) as additions to `events@`, subscribable from redscript and from a native part;
   - plugins can publish their own events (`story.*`) for add-ons.
6. **Scheduling:** a tick capability with a per-plugin frame budget, plus worker time for a native part. Both pause with the game (H4).
7. **Persistence:**
   - the save's identity and its parent's on `save.loaded`;
   - a `save.writing` event before the game writes, so a consistent snapshot can be flushed;
   - a store namespace per save branch, with a megabyte-scale quota;
   - clean-up of branches whose saves are gone;
   - no save lock for these writes (P1–P4).
8. **Restore and restage:**
   - on the kill switch, a restore hook removes everything the plugin owns: people, props, pins, trackers, messages and facts;
   - after a load, a restage hook brings back what should be present (P2).
9. **Owned scope.** The release access class lets a plugin create, change and remove only what it owns, in its own namespace, plus direct people it spawned or adopted under rules. It only reads vanilla quest state, with consent per plugin (H3).
10. **The native part,** if one is needed, reaches events, the store and ticks, and calls redscript (and is called by it) through the C interface (H2).
11. **Inspection commands** for agents: `story.state`, `story.why` and `story.seeds` (read). Sowing seeds live is lab-only (V12, [DS-26](design-seeds.md)).
12. **A companion process** (H6, `companion@1`, supervised by the core): declared in the manifest (the executable inside the plugin's folder, its hash, any network use), launched and supervised by XF Core under H6's seven conditions, and connected through a pipe XF Core owns. Events, store calls and plugin commands are available over it at local-IPC speed, with every gate applied and only the external link's rate limit waived. XF Core's design §3.5 is reworded to "only XF Core opens links, including the one to a companion" (agreed with the bridge chat).
