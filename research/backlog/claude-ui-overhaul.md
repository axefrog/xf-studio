# Deferred UI/UX overhaul — Claude harness, Opus 5.5

Explicit user request, 2026-09-23. **Lower priority. Queued, not delegated yet.**

Priority clarification: Nathan prefers working functionality first. Build sensible presentation/domain boundaries as functional work proceeds, but do not make a dedicated decoupling/refactoring project or the UI overhaul compete with the eye-makeup authoring/export milestone. Full decoupling remains a gate for the later Claude handoff, not an immediate prerequisite for current feature development.

Local harness discovery: `claude.exe` resolves to `C:/Users/Nathan/.local/bin/claude.exe`. Exact Opus 5.5 availability has not been checked; resolving the executable is not model validation or task dispatch.

Delegate this work to the `claude` harness using **Opus 5.5**, not a generic subagent or a silently substituted model. Before dispatch, verify that the harness and exact requested model are available; if they are unavailable, retain the request and report the limitation. No need to start a new user-visible Codex task or schedule an automation.

## Required prerequisite: presentation/functionality decoupling

Nathan explicitly requires the architecture to be fully decoupled before delegation, so Claude can reimagine UI strategy without changing the functional logic. This prerequisite is **not yet met**: `authoring/src/main.ts` mixes DOM handling, state transitions, undo, persistence and rendering coordination; `library-ui.ts` also binds transport and view state directly. Recipe evaluation, SQLite storage and save parsing are already separate modules, but that alone is insufficient.

1. Extract UI-independent application state, commands, undo/history, document/library identity and asynchronous operation coordination. Expose typed commands and observable read-only state, not direct mutable access to recipes or database internals.
2. Keep recipe schemas, shape/raster evaluator, save reader, SQLite/revision rules, asset resolver, material behavior and compiler/export contracts in owned core/adapters with contract checks. Desktop/browser transports must not determine domain behavior.
3. Provide a viewport/surface-editing adapter with explicit lifecycle, resize, input capture and command callbacks. DOM layout and toolbar design may change freely while geometry, skin/morph picking and gesture/undo semantics stay stable.
4. Move presentation to a clear area with a documented adapter boundary. Provide a UI component/interaction inventory and task-oriented acceptance scenarios rather than freezing the existing layout. Use fixtures/demo states so a redesigned interface can be developed independently.
5. Verify core functionality before handoff, including portable imports, SQLite conflict/recovery behavior, surface gestures, worker ordering, undo, asset loading and export. Record a baseline; preserve Nathan's browser draft.

## Delegated brief once ready

Perform a full UI/UX rethink in the **Cyberpunk 2077 aesthetic** for XF Appearance Studio. Freedom includes layout, navigation, workflows, visual hierarchy, information architecture and interaction design—not merely reskinning the current panels. Use a legible, accessible authoring interface with responsive layouts, keyboard/focus behavior, clear save/draft/export status and strong feedback for long operations. Keep implementation jargon out of user workflows. Use original UI assets rather than bundling extracted game UI resources by default.

Current product: author named multilayer eye-makeup presets, maintain a local library, preview on V, and eventually export a selected collection for one game selector. Other feature categories remain discussion-gated and must not be implemented as part of the redesign.

Explicit layout/workflow direction from Nathan: presets listed as an accordion above Makeup Layers, never a preset dropdown. Support add/remove/rename/reorder presets; add/remove layers and drag to reorder them. These operations must be provided by the core first, so the UI harness need not alter persistence or recipe semantics to implement the interaction.

Protect core logic through the decoupled API, a bounded presentation change set and reviewed diffs. If a new interaction genuinely needs an API extension, Claude should propose the contract change for the primary agent to implement/review; do not quietly modify persistence, material calculations or compiler behavior. A separate branch/worktree may help contain the change once the baseline is committed; do not infer that a worktree alone provides architectural separation.

Completion: UI and user workflows verified in an isolated draft/library, core checks still passing, requested aesthetic evident, and primary-agent review confirms no unintended logic/data changes. Record the actual harness/model used and retain screenshots and acceptance evidence.
