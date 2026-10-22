# Runtime requirements

What the Story Engine needs from the running game. This list is decided by what the system needs, not by what exists today. Each row is then matched to whatever provides it: the [runtime bridge](../../projects/xf-runtime-bridge/README.md), an [XF Core](../runtime/xf-core-architecture.md) plugin of our own, or a standalone mod. The runtime bridge's coordinating chat reads this page at each of its milestones and marks the bridge's status per row. Rows are raised by message when they start to matter.

## Current picture

Refreshed whenever the bridge reaches a milestone; last refreshed 22 October 2026.

- **Where the code is.**
  - `main` has bridge 0.6.1.
  - Branch `claude/bridge-080a` carries 0.7.0 to 0.8.3, with 0.8.3 staged for in-game session 11.
  - NPC direction (`claude/bridge-080-npc`) is built and tested offline, but has never run in game.
  - The DM toolkit (`claude/bridge-080-dm`) is work in progress: its native part only, unverified.
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
| H2 | **A Story Engine plugin on XF Core:** redscript for game logic, plus a first-party native part for the simulation's hot paths | M5 | **planned:** the plugin host follows the 0.8 merge |
| H3 | **An access class for story writes in the release flavour,** scoped to what the plugin owns, with consent. Release builds currently allow only reads, photo-mode changes and XF's own store | Later | want |
| H4 | **A frame budget and background scheduling** for plugins: per-frame slices that yield to the player and pause in menus, plus worker time for a native part. The XF Core design has no tick capability; today's behaviours live in the core | M5 | want |
| H5 | **The sequencer and frame-rate behaviours** for staging beats (waits, conditions, per-step checks, undo) | M4 | **partial:** four behaviours on `main`; the host-side session runner and `npc.scenario` on a branch; XF Core's `sequencer@1` designed |

## Senses

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| S1 | **A world event feed:**<br>- V's movement between districts, subdistricts and interiors;<br>- combat starting and ending, kills and knockdowns, NPC deaths;<br>- crimes and police heat;<br>- vehicle use and purchases;<br>- calls answered and dialogue choices;<br>- quest fact changes, time and weather;<br>- saves loaded | M4 | **partial:** the bridge's own event ring (`main`); `npc.*` events (branch); DM watchers for V's own state (enter, leave, gaze, weapon, combat, vehicle, interact, choice, timer, clock; work in progress). Nothing world-wide |
| S2 | **Perception:** what V can see now (people and props in view, line of sight), what V looked at or scanned, and how close V came | M4 | **partial:** `scene.report` and the look-at target (`main`); a gaze watcher (DM branch); no scanner |
| S3 | **The people around V:** record, archetype, faction, appearance, current activity or workspot, and crowd density | M4 | **partial:** people within a radius (`main`); `npc.list` up to 40 m with crowd, protected and busy flags (branch) |
| S4 | **The places around V:** district and subdistrict, nearby workspots and AI spots, interiors, points of interest, and whether a point is reachable on foot or by car | M4 | **partial:** `world.probe` (streamed, navmesh, ground, clearance, sight line) on 0.8; no district or workspot queries |
| S5 | **Quest state:**<br>- facts;<br>- journal entries and their states;<br>- active quests and gigs;<br>- fixer standing;<br>- whether a vanilla quest has reserved a person or place | M4 | **partial:** up to 16 named facts, read-only, on 0.8 |
| S6 | **V's state:** appearance tags, vehicle, wanted level, health, street cred, money, inventory summary and cyberware | M4 | **partial:** player state, appearance and wardrobe (`main`); cyberware and inventory (0.8) |

## Verbs

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| V1 | **Spawn and despawn people** with any record and appearance, friendly or hostile, at a chosen place, with an identity that survives streaming out and back in, and at crowd scale | M4 | **branch:** 10 cloned casts, non-persistent, friendly and immortal, at most 3 within 30 m; `npc.pick` adopts existing people for look, face and speech |
| V2 | **Direct people:**<br>- walk or drive somewhere, use a workspot, follow or flee;<br>- look at, gesture, change expression;<br>- set their attitude to V;<br>- fight in a group, or surrender | M4 | **branch:** move, follow, turn, place, stop, look, 13 expressions and 8 gestures (gestures need a carrier archive). No workspots, fleeing, fighting or attitude |
| V3 | **Speech:**<br>- overhead text, subtitles and holocalls;<br>- the game's own lines by voice and by line;<br>- dialogue choices with V | M4 | **branch:** text in all three forms; voiceset triggers (the game picks the line); 2–4 choices in the game's dialogue widget. No chosen lines |
| V4 | **Phone:** messages and calls from contacts, including new XF contacts | M5 | **branch (in progress):** a text and a scripted call with subtitles in the DM toolkit. Script can't create journal entries ([DS-33](design-seeds.md)) |
| V5 | **Objectives and the map:** map pins, areas, and objectives in the journal or an XF tracker | M5 | **partial:** a test pin (`main`); quest dynamic map pins (0.8); a journal-free tracker (DM, in progress) |
| V6 | **Props and places:**<br>- spawn props, containers and shards with our own text;<br>- lock and unlock doors;<br>- hide nodes;<br>- place lights | M4 | **branch (in progress):** spawn, despawn, doors and lights, at most 24 things within 60 m. No shards or containers |
| V7 | **Facts:** read and set quest facts; keep XF's own | M5 | **partial:** read only |
| V8 | **Scanner text:** our own scanner entries for people and props | M4 | want |
| V9 | **Rewards and costs:** money, items, street cred and fixer standing | M5 | want |
| V10 | **Vehicles:** spawn them, drive routes, run chases | M6 | **branch (in progress):** `vehicle.set` |
| V11 | **World nudges:** time, weather, crowd and traffic density near a scene | M5 | **partial:** time and pause (`main`); weather (0.8); no density |
| V12 | **Messages to the player and a debug overlay** that shows what the director is doing (lab only) | M4 | **partial:** `ui.message` and `ui.hud` (`main`); overlay state (0.8); notifications (DM) |

## Persistence

| ID | Requirement | Needed by | Status |
|---|---|---|---|
| P1 | **A store keyed to the save:** the save's identity and its parent, so the world record branches with saves ([DS-08](design-seeds.md)) | M6 | want: XF Core's store is designed outside saves and not keyed to them |
| P2 | **Restage after load:** bring back whatever should be present | M5 | want: no bridge command; the host re-issues state today |
| P3 | **A store quota sized for a world record** (megabytes, compressed) | M6 | want |
| P4 | **Story writes without the save lock:** a save-safe route for everything the Story Engine changes ([DS-39](design-seeds.md)) | M5 | want |

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
10. **The native part** reaches events, the store and ticks, and calls redscript (and is called by it) through the C interface (H2).
11. **Inspection commands** for agents: `story.state`, `story.why` and `story.seeds` (read). Sowing seeds live is lab-only (V12, [DS-26](design-seeds.md)).
