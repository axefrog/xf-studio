# XF Studio architecture contract

This is the default rule for new XF Studio work and for changes to an existing feature. Clean, modular, decoupled code with well-designed subsystems is the everyday standard, not a special effort. The [presentation boundary](ui-architecture-boundary.md) records where the code stands against it; existing coupling listed there is work to finish, not a pattern to copy.

## Layers and dependency direction

| Owner | Owns | Must not own |
| --- | --- | --- |
| Domain and application services | Recipe and collection validation, edit actions, Undo transactions, selection, persistence policy, async operation state and export eligibility | DOM elements, CSS or layout, browser events, Three scene objects, raw worker messages or HTTP details |
| Device and renderer adapters | Canvas and Three resources, picking and coordinate conversion, worker transport, local file selection and download, browser storage and network calls | Recipe rules, SQLite revision policy, finish eligibility or undocumented edits to live authoring state |
| Presentation | Layout, controls, docking, focus, theme, labels, menus and gesture affordances | Mutable recipes, direct database writes, package decisions inferred from labels, direct raster scheduling or hidden state outside the application and workspace contract |

Dependencies point inward. Presentation calls typed application actions and reads detached snapshots and capabilities. Application services use typed ports for device work, and adapters implement those ports. Pure evaluators, recipe parsing, the compiler and serialization run without a browser.

**One composition root.** `studio-startup.ts` wires services and devices. The localhost entry (`studio-main.ts`) and the desktop bootstrap both start it with a typed `StudioHost`, so host differences reach it only through that object, never through page globals or data attributes. A presentation is mounted by the root through `createTrustedAuthoringCore`, `createTrustedPreviewServices` and `createTrustedStudioBootstrap`, and receives only the `StudioPresentationPort`. A view never receives the bootstrap object, `AuthoringDocument`, the raw collection service, a renderer or a writable recipe. A new host starts the same root with its own `StudioHost`. The root is not a place for behaviour just because a feature has a button.

**Source layout.** Studio code follows the [feature-module platform layout](feature-module-platform.md#layout) under `projects/xf-studio/authoring/src/`:

- `platform/api` is the only platform import a feature may use.
- `platform/core` holds platform services; `platform/persistence/` holds the durable stores (the typed document store, library durability and backups); `platform/scene/` is the scene host and names no feature.
- `engines/<name>/` holds shared pure engines (the layered-makeup recipe, raster, finishes and compiler; Three only in its `render/`). An engine holds no feature's data: a feature hands it configuration.
- `features/<id>/` holds a feature's module. Its core imports only the platform API, engines, pure helpers and its own folder. Its `view/` acts only through the `FeatureViewContext` over its facade. Its `render/` is a `FeatureRenderer` that reaches the scene only through the scene port.
- `compose/` holds the composition lists (registry, views, renderers), which only the composition roots import.

New feature code goes into its feature folder or an engine, never into the shell or the top of `src/`.

## Subsystems

- **One owner per subsystem.** Each subsystem owns its state, persistence and async policy behind a small typed interface, and nothing reaches into another subsystem's internals.
- **Shared resources have one owner.** Caches, prepared files, preparation jobs and preview jobs each have exactly one owner. That owner deduplicates in-flight work, scopes supersession and cancellation to each requester, and does work only while something wants the result. A request for the same result joins the running job; one requester cancelling never cancels another's.
- **Composable views.** Views, cameras, lights, overlays and toolbar and panel contributions compose through the view graph service (`platform/core/view-graph.ts`; [design](view-graph-design.md)). One source can feed several views, and modules contribute while active and withdraw when hidden.
- **Plain data, explicit state.** Domain state is typed, versioned plain data with explicit state transitions. Experiment flags are a per-library document (kind `experiment-flags`, id `preferences`), so an isolated verification workspace keeps its own.
- **One library owner per file.** `LibraryDatabase` (`platform/persistence/library-database.ts`) holds each library file's only connection; every store (looks, collections, part presets, documents) works through it, and `openLibraryFiles` composes them for both hosts. Schema changes are additive migrations recorded in its ledger; `user_version` never rises above 2 and released tables are never altered, so released builds keep reading the file ([library durability](library-durability.md)).
- **One history service.** Undo and Redo go through `platform/core/history-service.ts`: scoped stacks (the look, the view and each document) on one `HistoryStack`, with transactions for gestures and controls. Features reach it only through the `DocumentHistory` API.
- **Injected time and randomness.** Services take the clock (`platform/core/clock.ts`) and seedable randomness (`platform/core/random.ts`) as inputs where a test needs determinism, so tests control them instead of patching globals.
- **Latest request wins.** Work the user can supersede in the page (a preview, a search) runs as a task (`platform/core/tasks.ts`): the newest request wins, the older one is aborted, and the task publishes its state for the interface to show.
- **Background work is a job.** Host work (preparing V, previews, prefetching, eviction) runs on the job scheduler (`platform/core/jobs.ts`, bound to the host in `host-jobs.ts`): the person's own changes come first, then what is on screen, then preparing ahead; one run per key is shared by every requester; a requester's newer want replaces its older one; work stops when nothing wants it. Prepared files are partitions of one `PreparedFiles` owner with one budget.
- **Cancellation is `AbortSignal` everywhere.** Disposal patterns appear only in adapters where the other side forces them.
- **Simplicity is part of the contract.** Prefer the simpler design that is just as robust. Add ceremony (parallel catalogues, speculative abstractions, multiplicity nobody needs yet) only where it prevents a real class of bugs.
- **Recorded exceptions.** A deliberate exception needs a written reason, an owner and a removal criterion in the [presentation boundary](ui-architecture-boundary.md). Urgency alone does not make direct UI-to-core access the new standard.

## Rules for each feature change

1. **Actions first.** Put the state transition and validation in a domain or application action before wiring a control. The same action serves buttons, shortcuts, context menus and any scripted caller. Describe its target, input, capability and disabled reason, Undo or recovery policy, persistence effect and async result where they apply. Register it with exactly one owner in the action registry (a system family or a feature module; see [feature-module platform step 1](feature-module-platform.md#step-1-status)). A refusal carries a reason code where it is decided, never matched by message text. Do not expose writable recipe objects or a remote execution endpoint. Every action names its target; no service holds an implicit current preset, look or view.
2. **Publish complete, detached state.** A view may cache a versioned geometry projection for drawing and picking but never mutates the authoritative recipe. Stale target IDs and gesture sessions are rejected at dispatch. A pointer drag, wheel burst or form edit has one explicit begin, commit or cancel transaction, and Escape restores its starting state.
3. **Rendering policy is separate from resource ownership.** Application code requests a complete preview or its cancellation through a port, and the adapter owns worker, texture and scene lifetimes. Typed `ready`, `updating` and `blocked` preview readiness is derived from the current queue and complete resources; a resolution preference alone is never evidence that a texture is ready. Preserve the raster arithmetic, cooperative cancellation and complete-bundle publication contracts.
4. **Keep stores distinct.** Portable recipes, local workspace preferences, SQLite revisions, imported save context and exported mod files are different things. Persisted shape changes carry schema versions and migrations. Never silently rewrite old revisions or change export behaviour as a side effect of a UI edit. Package checks and builds share eligibility and disclose partial omissions.
5. **Update the records with the change.** The generated [action catalogue](ui-action-catalogue.md), the [capability inventory](ui-capability-inventory.md) when user-visible scope changes, the relevant architecture or feature contract, and the [mod pipeline guide](studio-to-mod-pipeline.md) with a visual recheck of its diagrams for any pipeline change. Credit community learning in the [community credits](../../docs/community-credits.md).
6. **Verify at the boundary.** Focused pure tests for validation, state and Undo; adapter tests for worker, geometry or transport behaviour; a `?verify=1` task flow when interaction or persistence changes. Keep authored draft data and private assets out of fixtures and Git. Run the authoring suite, type check and build for an integration checkpoint.

## Component-first UI

All UI composes the one reusable component library documented in the [interface style guide](../../projects/xf-studio/authoring/public/style-guide.html) (`src/studio-ui/components/`). A feature specifies the component it needs (behaviour, states, accessibility) and the UI component track builds or extends it with a style-guide entry; the feature then composes and wires it. A one-off control in feature code is a review finding. See the [component library record](ui-component-library.md). Regenerate the style guide with `bun tools/build-style-guide.ts` whenever `studio.css` or a pattern changes.

## Boundary tests

- `tests/architecture-import-boundary.test.ts` guards dependencies from trusted services into browser and renderer modules, and from core modules into presentation modules or browser entries. Its platform rules follow imports transitively (no feature reaches platform internals, no pure engine module reaches a renderer) and scan pure engine and feature code for page and host globals. Each rule is shown to fail on an injected violation.
- `tests/studio-ui-boundary.test.ts` guards the presentation's imports and that the composition root reads no page globals.
- `tests/style-guide.test.ts` keeps the generated style guide current.

These are tripwires, not a substitute for reviewing data flow when adding a service.

## Change review questions

- Can another UI invoke this capability through the presentation port without clicking today's DOM control or importing the composition root?
- Can a disabled action explain why it is unavailable for the concrete target, and does dispatch revalidate after the UI query?
- Are Undo, cancellation, persistence and async failure visible and consistent across entry points?
- Does this alter preview, recipe, SQLite or game-export semantics? If so, are those effects explicit and tested independently of layout?
- Could the renderer or device port fail, cancel or load late without publishing a partial or stale result?
- Does the subsystem have one owner, and does it hand out detached data rather than internals?

If the current boundary cannot support a feature, add the smallest typed port or application action needed and record the remaining gap in the [presentation boundary](ui-architecture-boundary.md).
