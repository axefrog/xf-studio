# Research queue

The one queue for research questions from any chat in this project: how the game, its file formats, its tools and its mod ecosystem work, and what the options are for something we want to build. The meta-coordinator (`XF · Meta-coordinator`) owns it and manages each request on the asking chat's behalf.

R&D *build* tracks (prototypes, bridge features, experiments with code) stay with the chat that owns them, in the [work queue's R&D lane](README.md#rd-runs-only-while-the-polish-lane-is-moving). This queue covers the understanding those tracks rest on.

## Asking for research

Send the meta-coordinator a message with this first line:

`[XF] request · research: <the question> · reply needed: yes · blocking: yes/no`

**Send the full brief, the one you'd have given your own research agent.** That covers:
- the question and why it matters;
- scope and sources;
- method rules (for example, how third-party code may be used);
- the output you want and what counts as done;
- what you've already checked;
- when it's needed.

A brief on `main` (as the Story Engine's [p2-game-substrate](../story-engine/p2-game-substrate.md) is) can be linked instead of pasted. The meta-coordinator is the go-between, not a rewriter: it runs the brief as written, after trimming what's already answered and merging overlaps with other chats' requests, and it asks the requesting chat before changing anything else.

A quick lookup inside your own scope doesn't need to come here. Anything bigger does, so that answers end up in the knowledge base rather than in one chat's context.

## What the meta-coordinator does with a request

1. **Checks what we already have:**
   - the [knowledge base](../../knowledge/README.md), `research/` and `experiments/`;
   - the [community credits](../../docs/community-credits.md) for prior art;
   - the local Cyberpunk Modding Docs clone.

   If the question is already answered, it points at the material and says whether it's current. If the answer is partial, it says what's missing and queues only that part.
2. **Queues the rest by priority:**
   1. blocking work in flight;
   2. beta and 1.0;
   3. the standing tracks;
   4. exploratory questions.

   **The queue is also the throttle.** Requests trickle in one at a time, not all in parallel. How many run at once follows the usage mode on the board:

   | Mode | Research agents at once |
   |---|---|
   | Normal | up to 2 |
   | Economical | 1, with the next starting as soon as the last delivers. Economical means lean, never waiting. |
   | Crawl | none, except a request that blocks work in flight. Crawl applies only when the maintainer asks, or nothing is left in reserve. |

   The work queue's rule that R&D runs only while the polish lane is moving still applies. Large requests are split into batches, and each batch's results are delivered before the next one starts, so later batches can be trimmed or dropped.
3. **Runs it from the requester's brief** with a research agent. That's read-only, or a documentation worktree when the result is a page. If the question needs the asking chat's own context, it goes back to that chat. Questions only the running game can answer are batched onto the owning chat's next session card.
4. **Delivers:**
   - the knowledge page is updated (cited and evidence-graded), with credits for any source;
   - the result lands on `main`;
   - the asking chat gets the links.

Requests from the Story Engine stay spoiler-free here: neutral wording, no plot, characters or story beats.

## Standing tracks

- The game's material and shader system: [materials and shader RE](materials-shader-re.md).
- The character-customisation file chain: [CC file chain](cc-file-chain.md).
- Load time and responsiveness: [performance](performance.md).

## Queue

| Question | Asked by | Serves | Priority | Status | Result |
|---|---|---|---|---|---|
| How the base game records main-story progress as state: the facts, quest phases and journal states that mark acts and turning points; tracked character states (alive, allied, romance); the point of no return and open endings. Delivered as a knowledge page plus a table of fact names and conditions (no assets). Brief: area A of [p2-game-substrate](../story-engine/p2-game-substrate.md). | XF · Story Engine (22 Oct) | Seed-language design (P4): evaluating authored story windows on any save | 4: exploratory, not urgent | Delivered (22 Oct) | [Main story as game state](../../knowledge/main-story-state.md) (Draft: facts, journal states and phases from 737 quest and phase files and 132 scenes of game 2.31; characters, romance, the point of no return, endings; 24 session-card rows), [fact table](../story-engine/main-story-facts.json), [corpus manifest](../story-engine/quest-corpus-a-manifest.json). The extracted files are in the corpus folder; area H adds only the rest |
| How mods put their own ink UI inside photo mode's menus: where to attach (rows, pages, whole panels), input and focus, layout, coexistence between several photo-mode mods, pitfalls; plus questions only the game can answer, for the bridge's session cards. Source: the downloaded mod-study set (ignored), studied for technique only, never adopting its code; source-only claims graded as such; mods credited. | XF · Runtime bridge (22 Oct); full brief: [briefs/photo-mode-ink-panels](briefs/photo-mode-ink-panels.md) | The bridge's surface rule: XF photo-mode controls native inside photo mode, the overlay only as a fallback | 4: not urgent, before XF Core C1 | Delivered (22 Oct) | [Photo mode §15](../../knowledge/photo-mode.md#15-panels-inside-photo-modes-menu): attach points and lifetime, input and focus, layout, coexistence and failure modes from five mod packages, a recommended attach route (a layer under the photo-mode menu controller's root, shown from `OnShow`), and 20 session-card rows for the layout, input and teardown questions only the game can answer. |
| Open questions that public framework source can settle (TweakXL, ArchiveXL, Codeware, redscript, the RED4ext SDK): scanner record types, literal text in localised fields, runtime localisation, the journal-merge objective pool, Codeware's save events, wrapping native methods. Full brief: [briefs/framework-source-answers](briefs/framework-source-answers.md). | XF · Meta-coordinator, for XF · Story Engine and XF · Runtime bridge (23 Oct) | Open questions in the player-channels, save-identity and game-events pages | 4 | Delivered (23 Oct) by the first cloud research session (about 17 minutes), landed on main. Answered from source: questions 1, 3 and 6; narrowed to what needs the game: 2, 4 and 5 | [Scanner records](../../knowledge/player-channels.md#33-the-kiroshi-scanner), [shard `$base`](../../knowledge/player-channels.md#35-shards-and-readable-items), [journal merge](../../knowledge/player-channels.md#37-the-journal-and-a-journal-free-tracker) and [localised text](../../knowledge/player-channels.md#39-localised-text-from-mods-what-the-frameworks-do) in player channels; [Codeware session events](../../knowledge/game-events.md#how-codeware-raises-the-session-events) and [wrapping a native method](../../knowledge/game-events.md#wrapping-a-native-method) in game events; [save identity, rule 1 and open question 4](../../knowledge/save-identity.md#the-story-engines-save-key) |
| Race-track chevrons and checkpoints as in-world guidance: what draws them, whether a mod can lay them along any path (on foot and by car), and how they relate to the GPS route and map pins. Full brief: [briefs/race-chevrons-guidance](briefs/race-chevrons-guidance.md). | XF · Runtime bridge (23 Oct) | Guiding the maintainer by an in-world marker in bridge sessions instead of written directions; later the Story Engine's guidance | 3–4 | Queued. XF chats are in crawl, so it waits until crawl lifts. Nothing existing covers it. Its main lead, In-World Navigation, has public source (see the brief), so it could run in the cloud, with the local sources (quest corpus, decompiled scripts) as a follow-up if needed. | — |
| A live, low-fidelity 3D view of the game world (bird's-eye; base layer plus bridge and Story Engine layers), phase 1: the proposal. Full brief, with the maintainer's words: [briefs/live-world-view](briefs/live-world-view.md). | The maintainer, via XF · Runtime bridge (23 Oct) | Diagnostics shared by the bridge and the Story Engine; possibly a new vertical | 3 | Queued. Its sources are all in the repository, so it suits a cloud run (the credit, not the weekly plan). It starts once the first cloud run's cost is known. | — |
| Locate the game systems for autonomous testing, R1–R8: input dispatch, Wwise audio events, evaluated NPC face state, live HUD rects and occlusion, the committed dialogue choice, navigation, cover and combat, smart-weapon chains, title and exit controllers and MO2 invocation. Each has a bounded brief, the evidence to return and a stopping rule, in `research/runtime/autonomous-testing.md` ("Research list") on branch `claude/autotest-proposal` (291fd576). | XF · Runtime bridge (24 Oct) | Autonomous testing: direct system integration before visual, audio or input fallbacks | 2–3; order R1–R3, then R4, R5, R8, then R6, R7 | R1 and R5 (plus the Esc-in-photo-mode and "Save anyway" routes) delivered by XF · Runtime bridge (24 Oct, landed with bridge 0.8.13). R2 delivered (24 Oct, Codex agent), partly located: UI, VO and scene paths found; gunshot and ambient still open. R3 delivered (24 Oct), partly located: the path up to the graph inputs is found, the evaluated face output isn't. R4 delivered (24 Oct), partly located: HUD tree readers, transformed bounds and static occlusion found; device and moving-occluder coverage unproven. R8 delivered (24 Oct), narrowed by XF · Runtime bridge after session Borg 1: the start-screen and post-load prompt consumers, the exit path, MO2 argument passing and window focus are located or bounded; safe invocation awaits a session. R6 delivered (24 Oct, widened with road/pavement space and V contact), partly located: road and crosswalk flags, the car-hit callback, path queries, attitude, cover and weapon state found; no-contact proof and a V path-follow command still open. R7 held until the combat benchmarks are next (XF · Runtime bridge). | [Input and choices](../../knowledge/input-and-choices.md) (R1, R5), [game audio](../../knowledge/game-audio.md) (R2), [NPC face state](../../knowledge/npc-face-state.md) (R3), [HUD and occlusion](../../knowledge/hud-and-occlusion.md) (R4), [game lifecycle control](../../knowledge/game-lifecycle-control.md) (R8), [navigation and safety](../../knowledge/navigation-and-safety.md) (R6) |
| Story Engine substrate, P2 areas B–H. Each area's question and wanted output is in §3 of [p2-game-substrate](../story-engine/p2-game-substrate.md); its §2 lists the existing pages it builds on. Batches in the requester's order: **(1)** B gigs, hustles and fixers; C population and affiliations; E channels to the player (including custom scanner entries and shard text). **(2)** H quest-corpus extraction: extraction, manifest and structure statistics only; one memory-guarded disk job on C. Area A already extracted the main quests and Phantom Liberty (`MANIFEST.json` beside the corpus), so H adds only the rest. H also writes the reusable extractor and analysis scripts, tracked under `research/consumers/quest-corpus/scripts/` with the manifest pointing at them (A's own scripts weren't kept). **(3)** D places (coordinated with the world index plan in [world ideas](world-and-interactive-ideas.md)); F script-visible event hooks; G save identity and lineage. In-game confirmations go on XF · Runtime bridge's next session card. | XF · Story Engine (22 Oct) | Layer 1 (the mirror of what the game owns, realisation channels, the event feed and save-keyed store), and the corpus test for the craft research | 4: not urgent | Delivered (22 Oct): B, [open-world activities](../../knowledge/open-world-activities.md) and [gig decompositions](../story-engine/gig-decompositions.md); C, [population and affiliations](../../knowledge/population-and-affiliations.md); E, [player channels](../../knowledge/player-channels.md); H, the corpus database and [structure statistics](../story-engine/quest-corpus-statistics.md) (decompositions wait for the composite schema); F, [game events](../../knowledge/game-events.md); G, [save identity](../../knowledge/save-identity.md); D, [places](../../knowledge/places.md). All of P2 is delivered except H's decompositions, which wait for the composite schema. | — |

### Added 25 Oct

| Question | Asked by | Serves | Priority | Status | Result |
|---|---|---|---|---|---|
| Crowd adoption and NPC identity (Story Engine V17): (1) how the crowd and traffic system drives a crowd member, whether AI commands reach it, and the route to detach it to AI and re-attach it to the crowd (the game does something like this when crowd members react); (2) a stable identity key for community-spawned NPCs across sector reloads (community instance, entry, spot and ordinal, per Story Engine P3 §3.5); (3) V11 density nudges: crowd density by hour and faction shares, through TweakDB or system routes. Full request: V17 in [runtime requirements](../story-engine/runtime-requirements.md) (b1a5da83). | XF · Runtime bridge, for XF · Story Engine (25 Oct) | Story Engine M5: adopting real crowd NPCs instead of substituting XF actors (route (a), which the bridge builds meanwhile) | 4: needed before M5 | **Delivered (25 Oct)**, by a Claude Sonnet agent. Q1: the game's detach routes and public levers are located, but whether move commands reach live lane walkers is open. Q2: the stub-record key (spawner, entry, ordinal) is located, and surviving a reload is a hypothesis. Q3: density is baked in world data, with a runtime thinning lever only. Session rows CA1–CA10. Builds on [population and affiliations](../../knowledge/population-and-affiliations.md) (communities, crowd pools, markings) and [NPC direction](../../knowledge/npc-direction.md) (AI commands), so only the crowd-control handoff, the identity key and the density routes are new. It runs after the reset, as one static research agent. | [Crowd adoption and identity](../../knowledge/crowd-adoption-and-identity.md) |

## Answered from existing material

Requests answered by pointing at what we already had. One line each, newest first.

| Date | Question | Asked by | Answered by |
|---|---|---|---|
| 23 Oct | Does REA (`github.com/morluto/rea`, an MIT-licensed MCP server for agent-driven reverse engineering) add value beyond what our agents already do? | The maintainer | A quick README review by the meta-coordinator. Below our bar, so dropped and not banked (the maintainer). It wraps general tools our agents already drive directly; its runtime capture is Linux and macOS only, and its Windows support is experimental Ghidra. |
| — | | | |
