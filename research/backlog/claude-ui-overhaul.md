# XF Studio UI/UX overhaul — delivered; follow-ups

## Status (25 Sep 2026)

**Delivered and merged into `main` on 24 September** (merge `95516b2`; portrait-head follow-up `038054e`). The Opus 5.5 redesign replaced the fixed sidebars with a dockable interface. Production entry: `public/index.html` → `src/studio-main.ts` (trusted composition root) → `src/studio-ui/` (presentation, mounted with only `StudioPresentationPort`). The legacy shell `src/main.ts` stays at `/legacy.html` until the maintainer has accepted the new UI in depth. Delivery record, audit, evidence and acceptance: [ui-overhaul-2026-09-24.md](../authoring/ui-overhaul-2026-09-24.md). Current boundary state: [ui-architecture-boundary.md](../authoring/ui-architecture-boundary.md).

The maintainer has reviewed it only cursorily so far.

### Done

- Dock / float / magnetic composite / tab groups with **cursor-position** snapping, keyboard alternatives, per-size-class layouts, persistence and off-screen recovery.
- System light/dark theme with persistent override.
- Authoritative self-contained [style guide](../../projects/xf-studio/authoring/public/style-guide.html) ([Pages copy](https://axefrog.github.io/xf-studio/style-guide.html)), generated from production CSS/modules with a drift test.
- Audit of the previous UI with dispositions (B-, A-, C- items); isolated `?verify=1` acceptance 24/24; independent code review fixed.
- Core defects B-1 (draft lost on second open), B-2 (texture rebuild/point reset on layer edits) and B-3 (refusal cleared `busy`) fixed on 25 September: `f552ff6`, `da76361` + `c6b2866`, `6c0e46f`.
- Audit API gaps and adapter notes closed on 25 September: A-1, A-2 (consequence metadata), A-3, A-5, A-7, A-8, A-9, A-10 (labelled Undo/Redo), A-12, A-13, A-14 (revision part), file-workflow IDs in the registry, B-7, control transaction versus gesture and unowned layer edits. Contracts: [boundary assessment](../authoring/ui-architecture-boundary.md#application-api-additions-25-september).
- Interim native-menu policy (`src/context-menu.ts`) and target-aware context menus on UV points, head points, background and layer rows ([acceptance](../authoring/ui-overhaul-2026-09-24.md#acceptance--isolated-verify1-disposable-library-throwaway-chrome-profile)).

### Open

1. **The maintainer's in-depth review** of the new UI; then retire `legacy.html` / `main.ts` once it is accepted.
2. **Primary review** of the read-only API extension commit (`ebe6a1f`, plus the one-line file-snapshot change) versus presentation commits, confirming no unintended logic/data change.
3. **B-17 Shift overload on the head** is resolved: the maintainer chose option (b), so Shift always means a shape gesture and does nothing off makeup. Viewport input hints, tooltips and gesture cursors now come from the same [input binding catalogue](../authoring/input-bindings.md).
4. **Partial audit items:** A-4, A-6, A-11, A-15; A-14's disclosure move (deferred while only the legacy shell uses it). `CollectionService.capability()` still re-validates the whole workspace including Undo histories (~27 ms).
5. **Verify** the context-menu and command-registry claims end to end (every menu/palette/shortcut path dispatches the same validated action with the same disabled reason).
6. **Presentation follow-ups:** arrow-key nudging (now possible with `point.move`/`shape.transform`), a Redo entry in context menus if wanted, UI for the new consequences/limits/per-layer readiness beyond the current chip, hint and Glitter limits, UV units (C-17), stable warp names (C-16), virtualised lists for large collections, screen-reader verification, shorter stage hint in narrow head cells.

## Requirements that remain binding for future UI work

These came from the original brief and still apply to any change to the Studio UI.

- **Architecture.** Follow the [architecture contract](../authoring/architecture-contract.md): presentation talks only through typed actions, read-only snapshots and capabilities; no business logic, recipe mutation, SQLite or worker steering in UI modules. New interactions that need an API get a reviewed contract extension, not a quiet core change. The boundary test's import allowlist must not grow without an exception entry in [the boundary assessment](../authoring/ui-architecture-boundary.md).
- **Aesthetic.** Professional, modern, crisp, clean and restrained Cyberpunk 2077 character, without cheesy franchise tropes; readability, hierarchy, contrast and keyboard/focus behaviour come first. Original UI work, not extracted game UI resources.
- **Panels.** Dockable, floating, magnetic composites and tabbed groups; snapping decisions use the **cursor position, never the dragged panel's bounds**. Persist layout, recover invalid/off-screen panels, keep accessible alternatives.
- **Theme.** Follow the system light/dark preference by default with a persistent override and a clear return to system. Theme and layout are workspace preferences, separate from recipes, SQLite revisions and export quality.
- **Style guide.** Keep the HTML style guide synchronised with the delivered interface (regenerate with `bun tools/build-style-guide.ts`); every pattern states what/when/combine/adapt/driven-by and whether it is implemented or future.
- **Future expansion zones.** The category switcher is the single expansion point for later authoring categories (piercings/earrings, eyebrows, cheek makeup, hair, expressions, tattoos, body, world). Each later category needs discussion with the maintainer before it is built; preview context is not permission to build its editor. Do not merge future categories into the makeup finish families.
- **Programmable actions and context menus** (requested 23 September). Almost every meaningful UI operation should be a typed, in-process, scriptable action with stable ID, parameter types, target scope, capability/disabled reason and Undo behaviour — not a network command server or arbitrary code execution. Buttons, gestures, shortcuts, menus and scripts all call the same validated operations and share change notifications, draft tracking, errors and persistence. Gesture/batch transactions give one-step Undo and cancellation. Preserve native text-editing menus in inputs; suppress unhelpful browser menus elsewhere without breaking right-drag pan. Catalogue: [ui-action-catalogue.md](../authoring/ui-action-catalogue.md).
- **Preset/layer functionality** (add/remove/copy/rename/reorder with feedback, Undo and persistence) is provided by the core; the UI must not alter persistence or recipe semantics to implement interactions.

## Regression acceptance for UI changes

Use an isolated `?verify=1` draft and disposable library; never the maintainer's active draft. Cover new, empty and densely layered presets; long names and reorder; curve/field/whole-shape gestures with Undo and Escape; preview quality changes during cancellable work; saved/unsaved revisions and conflict/recovery; saved-V import; package Check freshness; reload of selection, camera, imported V, theme and layout. Demonstrate dock/float/composite/tab behaviour in narrow and wide windows, including a large panel overlapping a target while the cursor stays outside it (must not snap). Check keyboard alternatives, focus order, context-menu disabled reasons, native text menus and right-drag pan. The scripted pass is `bun tools/ui-acceptance.ts`. Game rendering is outside UI acceptance.

## History

The pre-delivery gate (presentation/core decoupling, port-only acceptance, CLI harness validation and dispatch) is complete and condensed here; git history and the [port acceptance](../authoring/ui-port-acceptance-2026-09-24.md), [handoff acceptance](../authoring/ui-handoff-acceptance.md) and [bootstrap smoke](../authoring/ui-bootstrap-smoke-2026-09-24.md) records retain the detail. The overhaul ran through Claude Code 2.1.281 with `claude-opus-5-5` at xhigh. The coordinator is now Claude Opus 5.5 directly; future branches use the `claude/` prefix, and the old `codex/*` worktrees and branches were removed on 25 September after integration was verified.
