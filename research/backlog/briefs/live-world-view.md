# Research brief: a live, low-fidelity 3D view of the game world (proposal first)

Requested by the maintainer through XF · Runtime bridge on 23 October 2026, via the [research queue](../research-queue.md). This run covers **phase 1, the proposal**. Design and spec, the bridge "wants" list in full, and the proof of concept come later, in that order, each after the maintainer has reviewed the step before.

## The maintainer's words, verbatim

> Research/ideation/proposal task to queue up: Some form of game-external live low-fidelity 3D visualisation of what's going on in the game world right now. Think flat shaded simple polygons, simple poly edges where applicable, etc. Visually reads like a bird's-eye view of where V is right now, what they're doing and everything being tracked around them. Diagnostic readouts and so on. Like a kind of private "tapping into the matrix" to observe what's going on in game. Relevant for diagnostic overlap between bridge and story engine (e.g. story engine regions, influences, control points/field, etc. could be rendered in this over the base layer of geometry, markers, etc). Allows live developer view that confirms visually what's happening. Might feel a little like somewhere between lidar, gaussian splatting (without the texturing), radar, position tracker, etc. In other words, everything we know right now, with higher detail as provided (a) by the bridge, (b) by the story engine. Agent who investigates this idea should recognise that being ambitious and making it nicer than requested is a positive thing - overdelivery is encouraged. Specifics I've suggested are "bare minimum" (think: Office Space scene where Jennifer Aniston is being chided for not wearing more flare than she's technically required to wear - let's go above and beyond! But doesn't have to be all at once - first: proposal, design/spec, "wants" re: bridge functionality, then PoC). Figure out where this integrates, how it's actually presented (in game? own app? studio view? something else?), decoupling so that base can exist with story engine contributing to it, etc. Is this something we run in a dedicated XF coordinator chat we start alongside the existing ones? What else have I not considered? Anything else important/significant/worth mentioning/covering? etc. I acknowledge I haven't thought deeply about this idea, I'm mentioning it because I have a hunch that it could be something that would have a lot of value for the game integration side of things, but the specifics of that value proposition are part of what this task is about determining/assessing.

## The ambition behind it

> "FYI, in general we're shooting for Borg-level augmentation of this game. Our cybernetic tendrils into electrical pathway the game has to offer. Total integration, and then some." (the maintainer, 23 Oct, on game integration as a whole)

## What the proposal must cover

1. **The value proposition.** What this view gives the maintainer, the bridge and the Story Engine that nothing else does: diagnosing sessions, confirming what scripts and simulations believe, guiding tests, and authoring. Be concrete about the use cases.
2. **Presentation.** Compare the options: its own app or window; a view inside XF Studio (the Studio is web-based, with a composable view graph); a browser page; an in-game overlay; something else; or a combination. Recommend one, and give the trade-offs (second monitor, the ultrawide 3840×1600 display, latency, the "no flashing windows or focus stealing" rule, desktop app versus localhost).
3. **Architecture and decoupling.**
   - A base layer that exists without the Story Engine: static world geometry, V, NPCs, vehicles, pins, the camera and the navmesh.
   - Live data from the bridge.
   - Contributed layers from any producer: the Story Engine's regions, influences, control points and fields today, other producers later.
   - A layer or contribution contract that fits the project's architecture contract (one owner per subsystem, plain data, composable views, cancellation by `AbortSignal`).
4. **Data sources and fidelity.**
   - What the bridge exposes live today: the MCP reference lists `scene_read` and `scene_report` (camera, NPCs with faction detail), `world_probe` (navmesh, ground, line of sight), the district read, player state, NPC state, the test event feed and pins.
   - What exists offline: the sector and world-index plans (W0–W2, including the planned offline location viewer W2) and the knowledge pages on places, population and world streaming.
   - How "lidar or splat-like" geometry could be had cheaply: sampling, proxies, the navmesh, collision, and streaming sectors near V.
5. **The bridge's performance constraint, which is a hard requirement.** Session 15 ended in a 120-second engine watchdog crash. Before it, the coordinator had polled a district read at 1–2 Hz for about 12 minutes (about 1,000 game-thread reads, normally waiting 1–20 ms each), and an event probe was logging heavily. It isn't proven to be the cause, but a live view must not add game-thread polling. Propose how live data reaches the view cheaply: native-side snapshots taken off the main thread, change-driven pushes, rate budgets, level of detail by distance, and a kill switch.
6. **A first-cut bridge "wants" list:** the commands, streams and rates the view would need. The full list comes in a later phase. Flag which ones need native work.
7. **The Story Engine's contribution:** which of its concepts would render, and how, from its public docs. **Spoilers are a switch, not a ban.** The maintainer usually wants to discover the Story Engine's generated content (plot, characters, beats) in play. But, in his words, "Sometimes you need spoilers in order to properly analyse what you're looking at." So the view needs a spoiler-safe mode that he can switch on and off:
- **On:** story layers show structure (regions, fields, counts) without story content.
- **Off:** everything is shown, for analysis.

Propose the default, how the switch is made clear and hard to flip by accident, and whether it applies per layer or for the whole view.
8. **Coordination.** Should this run as its own XF coordinator chat, a track inside the bridge, or a Studio view? What would it own and depend on?
9. **What the maintainer hasn't considered:** risks, opportunities and reuse beyond diagnostics. Examples to think about: session replay, a test-card companion, guiding the maintainer in game, and use by agents (the "give agents their own view of the game" rule in `AGENTS.md`).
10. **A phased plan:** proposal → design/spec → bridge wants → proof of concept, with a rough size per phase and the smallest proof of concept that would show the value.

## Sources (all in the repository)

- `AGENTS.md`, especially "Architecture contract", "Give agents their own view of the game", "No flashing windows", "Component-first UI" and the "It just works" UX policy.
- The bridge:
  - [the MCP reference](../../../projects/xf-runtime-bridge/docs/mcp-reference.md) and [MCP guide](../../../projects/xf-runtime-bridge/docs/mcp.md);
  - [runtime access](../../../knowledge/runtime-access.md);
  - [player control](../../../knowledge/player-control.md);
  - [game events](../../../knowledge/game-events.md).
- The world:
  - [world ideas (W0–W2)](../world-and-interactive-ideas.md);
  - [world and streaming](../../../knowledge/world-and-streaming.md);
  - [places](../../../knowledge/places.md);
  - [population and affiliations](../../../knowledge/population-and-affiliations.md).
- The Studio: [the view graph design](../../authoring/view-graph-design.md) and [the architecture contract](../../authoring/architecture-contract.md).
- The Story Engine: [its hub](../../story-engine/README.md), with its foundation, kernel spec and plan. Read only the public docs, and never anything under `research/runtime/live-dm/`.
- Prior art on the web is welcome: radar and minimap tools, debug visualisers, telemetry viewers, splat and point-cloud viewers. Credit anything that teaches us something.

## Output

`research/live-world-view/proposal.md`, a proposal the maintainer can read in one sitting. Diagrams are welcome as Mermaid or inline SVG mock-ups; a small static HTML mock-up in the same folder is welcome too. Also a short `README.md` for that folder. Add credits where the file's rules call for them. Don't edit `research/backlog/research-queue.md`; the meta-coordinator updates it.

## Done when

Every point above is covered with a recommendation, open questions for the maintainer are listed at the end, and the plan says what the next phase would deliver.
