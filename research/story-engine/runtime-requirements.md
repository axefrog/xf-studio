# Runtime requirements

What the Story Engine needs from the running game. This list is decided by what the system needs, not by what exists today. Each row is then matched to whatever provides it: the [runtime bridge](../../projects/xf-runtime-bridge/README.md), an [XF Core](../runtime/xf-core-architecture.md) plugin of our own, or a standalone mod. Missing pieces are raised with the runtime bridge's coordinating chat, and this page records the outcome.

**Status values:**
- **want:** needed, not yet raised;
- **asked:** raised with the bridge;
- **planned:** in the bridge's or XF Core's plan;
- **branch:** built on a branch;
- **main:** merged;
- **proven:** seen working in game.

**Needed by** names the first milestone that depends on the row ([plan §4](plan.md#4-milestones)).

## Hosting

| ID | Requirement | Why | Needed by | Status |
|---|---|---|---|---|
| H1 | **A host-side route.** The engine runs outside the game and drives it through the link (MCP, CLI or a library) | Prototypes and the hand-run director need nothing new in game | M4 | want |
| H2 | **A Story Engine plugin on XF Core:** redscript for game logic, plus a first-party native part for the simulation's hot paths | Shipping without the Studio; a simulation too heavy for script | M5 | want |
| H3 | **An access class for story writes in the release flavour,** with consent: spawning, directing, messages and pins. Release builds currently allow only reads, photo-mode changes and XF's own store | Nothing reaches players otherwise | Later | want |
| H4 | **A frame budget and background scheduling** for simulation steps in game, which yield to the player and pause in menus | No perceivable cost | M5 | want |
| H5 | **The sequencer and frame-rate behaviours** for staging beats (waits, conditions, per-step checks, undo) | Beats with timing and recovery | M4 | want |

## Senses

| ID | Requirement | Why | Needed by | Status |
|---|---|---|---|---|
| S1 | **A world event feed:**<br>- V's movement between districts, subdistricts and interiors;<br>- combat starting and ending, kills and knockdowns, NPC deaths;<br>- crimes and police heat;<br>- vehicle use and purchases;<br>- calls answered and dialogue choices;<br>- quest fact changes, time and weather;<br>- saves loaded | The simulation's input, and the source of causes | M4 | want |
| S2 | **Perception:** what V can see now (people and props in view, line of sight), what V looked at or scanned, and how close V came | "Observed means canon" ([DS-03](design-seeds.md)) | M4 | want |
| S3 | **The people around V:** record, archetype, faction, appearance, current activity or workspot, and crowd density | Casting and materialising | M4 | want |
| S4 | **The places around V:** district and subdistrict, nearby workspots and AI spots, interiors, points of interest, and whether a point is reachable on foot or by car | Casting places and staging | M4 | want |
| S5 | **Quest state:**<br>- facts;<br>- journal entries and their states;<br>- active quests and gigs;<br>- fixer standing;<br>- whether a vanilla quest has reserved a person or place | Never collide with vanilla content; use it as material | M4 | want |
| S6 | **V's state:** appearance tags, vehicle, wanted level, health, street cred, money, inventory summary and cyberware | Relevance and reactions | M4 | want |

## Verbs

| ID | Requirement | Why | Needed by | Status |
|---|---|---|---|---|
| V1 | **Spawn and despawn people** with a chosen record and appearance at a chosen place, with an identity that survives streaming out and back in | Cast members | M4 | want |
| V2 | **Direct people:**<br>- walk or drive to a place, use a workspot, follow or flee;<br>- look at, gesture and change expression;<br>- set their attitude to V;<br>- fight in a spawned group, or surrender | Staging scenes and encounters | M4 | want |
| V3 | **Speech:**<br>- overhead text and subtitles;<br>- reuse of the game's own lines by voice;<br>- holocalls;<br>- dialogue choices with V | Expression ([DS-17](design-seeds.md)) | M4 | want |
| V4 | **Phone:** messages and calls from contacts, including new XF contacts. This needs a better route than pre-authored journal slots if one exists | Fixers and hooks | M5 | want |
| V5 | **Objectives and the map:** map pins, areas, and objectives in the journal or in an XF tracker | Gigs | M5 | want |
| V6 | **Props and places:**<br>- spawn props, containers and shards with our own text;<br>- lock and unlock doors;<br>- hide nodes;<br>- place lights | Environmental storytelling | M4 | want |
| V7 | **Facts:** read and set quest facts, and keep XF's own facts | Gating and coexistence | M5 | want |
| V8 | **Scanner text:** our own scanner entries for people and props | An NPC's concerns, in world ([DS-18](design-seeds.md)) | M4 | want |
| V9 | **Rewards and costs:** money, items, street cred and fixer standing | Gigs with stakes | M5 | want |
| V10 | **Vehicles:** spawn them, drive routes, run chases | Gigs and arcs | M6 | want |
| V11 | **World nudges:** time, weather, crowd and traffic density near a scene | Pacing and atmosphere | M5 | want |
| V12 | **Messages to the player and a debug overlay** that shows what the director is doing (lab only) | Sessions and inspection ([DS-26](design-seeds.md)) | M4 | want |

## Persistence

| ID | Requirement | Why | Needed by | Status |
|---|---|---|---|---|
| P1 | **A store keyed to the save:** the save's identity and its parent, so the world record branches with saves | [DS-08](design-seeds.md) | M6 | want |
| P2 | **Restage after load:** bring back whatever should be present | Continuity | M5 | want |
| P3 | **A store quota sized for a world record** (megabytes, compressed) | The record | M6 | want |

## Safety and coexistence

| ID | Requirement | Why | Needed by | Status |
|---|---|---|---|---|
| C1 | **Never break vanilla quests.** Detect reserved people and places and avoid them; the kill switch restores everything | Coexistence | M4 | want |
| C2 | **Respect the player's settings,** such as subtitles and crowd chatter turned off | Coexistence | M5 | want |
| C3 | **Release consent and a switch per feature** | Release | Later | want |
