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

Reimagine the UI/UX of **XF Studio**. Prescribe required functionality and acceptance criteria, not a visual design or how workflows must be realized. The existing interface, labels, sidebar structure and interaction arrangements are examples of available capabilities, not a template to preserve. Earlier Cyberpunk aesthetic discussion is historical context; the latest instruction grants freedom over aesthetic, navigation, hierarchy and interaction design. Require legibility, accessibility, keyboard/focus behavior, understandable save/draft/export status and operation feedback without prescribing their presentation. Use original UI assets rather than bundling extracted game UI resources by default.

Current product: author named multilayer eye-makeup presets, maintain a local library, preview on V, and eventually export a selected collection for one game selector. Other feature categories remain discussion-gated and must not be implemented as part of the redesign.

Required preset/layer functionality: add/remove/copy/rename/reorder presets and layers, with appropriate feedback, Undo and persistence. The earlier accordion arrangement describes the current implementation; the latest freedom-to-reimagine instruction supersedes prescribing it in the eventual overhaul. These operations must be provided by the core first, so the UI harness need not alter persistence or recipe semantics to implement new interactions.

Required panel system, explicitly requested 23 September: replace fixed sidebars with distinct dockable functional panels. Users can anchor panels wherever supported, detach them into floating panels, magnetize adjacent panels into a composite, and group panels into a tabbed container. During a drag, snapping decisions must use **cursor position**, never the dragged panel's extent or position; large panels must not snap merely because they overlap another panel. Preserve layout state and provide accessible alternatives for docking/grouping. Exact visuals, affordances and interaction strategy are for Opus to design; do not predesign them in the handoff. Preview quality and lighting are current functional groups, not required future sidebar locations.

Protect core logic through the decoupled API, a bounded presentation change set and reviewed diffs. If a new interaction genuinely needs an API extension, Claude should propose the contract change for the primary agent to implement/review; do not quietly modify persistence, material calculations or compiler behavior. A separate branch/worktree may help contain the change once the baseline is committed; do not infer that a worktree alone provides architectural separation.

Completion: UI and user workflows verified in an isolated draft/library, core checks still passing, dock/float/magnetic-composite/tab grouping and cursor-based snapping demonstrated, and primary-agent review confirms no unintended logic/data changes. Record the actual harness/model used and retain screenshots and acceptance evidence.

## Programmable actions and context menus — requested 23 September

The eventual Opus 5.5 overhaul must design and implement a context-menu system. For now suppress unhelpful native browser context menus on studio non-text surfaces while preserving native text editing menus, including input fields and editable text. This must not break right-drag panning. Custom context menus remain deferred with the overhaul.

Nathan explicitly wants broad internal API coverage so the UI designer can invent workflows without rewriting functionality. Treat almost every meaningful UI operation as a candidate scriptable action, not merely the actions currently in menus. This is an in-process typed application interface, not an unauthenticated network command server or arbitrary code execution facility.

Build this incrementally alongside functionality. Before handoff, audit the entire UI and deliver a discoverable action catalogue with stable IDs, parameter types, target scope, capability/disabled reasons, Undo behavior and examples. Include collection/preset/layer CRUD and reorder; point/curve/field selection and edits; whole-shape transforms; material settings; UV/camera navigation; visibility, light and animation controls; save import; library save/open/recovery; recipe/collection/mask/build export. Expose read-only state subscriptions and contextual capability queries. All interactions (buttons, gestures, keyboard shortcuts, scripts and future menus) should call the same validated operations and participate in the same change notifications, draft tracking, error handling and persistence.

Support gesture/batch transactions with one-step Undo and cancellation, async progress/results and stale-target checks. Do not expose raw mutable recipes, direct database writes or DOM-only click wrappers as the public contract. Keep rendering/picking and file/network adapters separate. Menus must be able to ask which actions apply to a selected layer, point, field, preset or empty canvas. Provide implementation examples and a completeness checklist to Opus; new presentation can combine actions creatively while preserving tested behavior. This strengthens the existing decoupling gate and does not move the overhaul ahead of working makeup functionality.

Interim native-menu policy implemented in `authoring/src/context-menu.ts` and wired once at application startup. Isolated browser checks retain text-field/editable-content menus, suppress non-text menus, and retain viewport right-drag pan; typecheck/build pass. [Evidence](../../projects/xf-appearance-studio/authoring/evidence/context-menu-2026-09-23.json). The custom menu system and broad action catalogue remain pending.
