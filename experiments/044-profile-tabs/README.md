# Experiment 044: profile tabs and contributed defaults (profiles phase 2)

**Status:** plan for review: gap map, UI spec list, chunk plan, decisions and risks (24 October 2026). Nothing is built. This is the working record for [profiles design](../../research/authoring/profiles-views-layouts-design.md) phase 2 (its §9.2 row: [phases](../../research/authoring/profiles-views-layouts-design.md#92-phases)). It builds on phase 1 (merged `35e3c5b6`) and phase 4a, scene runtimes ([experiment 043](../043-scene-runtimes/README.md), merged `5b315f9b`).

Source paths are relative to `projects/xf-studio/authoring/src/`, and line numbers are at `076a7a65`. Tests are in `projects/xf-studio/authoring/tests/`. Effort is in the design's units (agent-days).

## 1. Where main stands

Phase 1 built the session as data and the resolver over it, but the window still shows one tab. Phase 4a built the renderer device and scene runtimes, with `heads.show(view)` ready for a tab switch, but nothing calls it with another view.

- **One tab.** `ProfileSessionState` (`app/profiles/profile-session-state.ts:31`) holds the session and shows its first tab only (`:43–44`). Every view opened in the window joins that tab (`:63`). It has no operations beyond `setLook`, `setSubject` and the instance lookup (`:81–121`).
- **The dock is still a preference.** Tab 1's arrangement is copied into `UIPreferences.layout` at start (`compose/studio-startup.ts:199–201`). The dock saves through `layout.set` (`studio-ui/app.ts:138–141`), and the session reads it back when the workspace is written (`compose/studio-startup.ts:294–297`).
- **One 3D view panel.** The shell contributes one `head` panel (`studio-ui/views/shell.ts:20`), and its controller is a singleton that hosts the device (`studio-ui/panels/viewports.ts:112–129`). The view graph requires the main view (`platform/core/view-graph.ts:119`, `:459`), refuses to close it (`:373`) and caps views at 16 (`:22`, `:356`).
- **One edited look.** The authoring core edits one document (`app/trusted-authoring-core.ts`), and `LookEditor` (`library/look-editor.ts:84`) shows the drawn scene's look (`compose/studio-startup.ts:279–281`, `:474–475`). The heads owner draws `MAIN_VIEW` (`:397`). `show(view)` of a view whose scene shows another look is refused (`preview/browser/browser-scene-heads.ts:274–277`, with `ANOTHER_LOOK` and `refusal(view)` from `preview/browser/scene-editors.ts:61`, `:121–125`).
- **Saved layouts and modules are still live.** The Layouts button (`studio-ui/app.ts:518`) drives `layoutController` (`studio-ui/layouts.ts`) over the preference library (`app/layout-library.ts`). The Modules button (`studio-ui/app.ts:485`), its menu (`:708`), the Panels menu's module switches (`:736`) and the palette's module commands (`:894`) drive `modules.set` (`app/ui-preferences.ts:61`). Phase 1's migration already copied every saved layout into an own default (`app/profiles/host/profiles-migrate.ts:320–327`), so the library is input only.

## 2. Gap map

### 2.1 `ProfileSessions` operations with history

| | |
|---|---|
| **On main** | Session, tab, instance and binding data with validation (`app/profiles/profile-session.ts:165–281`): unique tab IDs, instance IDs never reused, views in a known tab, focus and `seq`, `closed` kept to the last 5 (`:170`, `:280`) but typed `unknown[]` (`:195`). `ProfileSessionState` as above. The view graph's own View and lighting scope, `view:<profile>` (`platform/core/view-graph.ts:184–198`), with structural steps for `addView`, `closeView`, `link` and `unlink` (`:355–405`) and a whole-result consistency check on Undo (`:455–461`). `FocusService` (`platform/core/focus.ts:52`). |
| **Missing** | `ProfileSessions` (`app/profiles/profile-sessions.ts`, the successor of `ProfileSessionState`), changing tabs, graph and focus only through operations, each one commit and one `view:<profile>` step: new tab from a fragment, close, reopen, reset to default, rename, reorder, add or remove a panel, change a binding, add or close a view (design §4.1). **One history for session and graph:** a session operation and the graph edits inside it are one step, so the scope's owner becomes `ProfileSessions`, and the graph records through it (the scope API takes one target per scope, `platform/core/history-service.ts:124`). A shown tab (switching is navigation: never an Undo step). Closed-tab fragments as typed data. The graph without a required main view and without `MAX_VIEWS` (the workspace budget bounds it, §4.4). An empty session (no tab, no view: the graph parser refuses zero views today, `view-graph.ts:80`). `tabs.*` actions in the action registry, with capabilities and plain refusals. |

### 2.2 Fragments and substitution

| | |
|---|---|
| **On main** | `LayoutFragment` as the migration writes it (`app/profiles/profiles-migration-data.ts:48–57`): the dock with view panels as `view:<key>`, slots `v1` and `look1`, value copies of nodes, views and panels by type. `layoutFragment()` (`:226–247`) turns a saved layout into one. |
| **Missing** | The design's fragment (§4.2): panel bindings with pins as local keys, panel state for types with `stateInDefaults`, and validation on read (a fragment from another build). **Fragment from a tab** (Save as default): actual subjects and looks become slots, and links outside the tab are copied as values. **Instantiation** with fresh IDs for every view, node, scene and instance. **Substitution:** per subject slot, the profile's subjects of the slot's kinds or Leave empty; per look slot, the profile's looks or Leave empty; per scene, Share the scene of an existing scene. Candidates are computed as plain data (0, 1 or many). |

### 2.3 Feature defaults

| | |
|---|---|
| **On main** | The factory arrangement (`studio-ui/layout-defaults.ts:29–46`), built from catalogue slots, used as the dock's defaults and by Reset. Modules have no `defaults` (`platform/api/module.ts:14–26`). |
| **Missing** | `DefaultLayoutContribution` on the module manifest (`id`, `name`, `description`, `fragment`), checked at composition like the rest of the registration (`compose/modules.ts:40–41`). Eye makeup's default made from today's factory arrangement (both size classes, one V slot, one look slot); minimal defaults for Poses, Expressions and the Save Explorer (decision M1). The factory layout stops being the dock's fallback: an empty tab is empty. |

### 2.4 Save as default

| | |
|---|---|
| **On main** | `layout-default` documents (`xfs/layout-default-1`, `profiles-migration-data.ts:34–36`), written only by the migration's host transaction. Nothing in the window reads them. |
| **Missing** | **`LayoutDefaults`** (`app/profiles/layout-defaults.ts`), the owner of own defaults: reads them, and writes them only through owner commands and the outbox (create, update an own default, rename, delete as a tombstone with Undo). A tab's `origin` naming a feature default (`<module>/<id>`) or an own default. Update "<name>" only on an own default; saving over a feature default makes an own default (§4.2). The outbox model test grows to cover the new kind. |

### 2.5 Feature focus

| | |
|---|---|
| **On main** | Modules shown or hidden by preference (`UIPreferences.modules`, `app/ui-preferences.ts:29`); the tool filter reads it (`studio-ui/runtime.ts:23–43`). A hidden module's panels are parked (`studio-ui/app.ts:77`) and its tools withdrawn. |
| **Missing** | The tool filter's `modules` derived from the shown tab: a module is active when one of its panel instances is in the tab's dock (§4.3). **Panel owners per §5:** Presets and Library are still shell panels (`studio-ui/views/shell.ts:11`, `:15`), so a tab holding only them wouldn't activate eye makeup; they move to eye makeup's contribution. Optional experiments follow the shown tab too. |

### 2.6 Tab strip, tab menu and substitution menu

| | |
|---|---|
| **On main** | The library's Tab strip (`studio-ui/components/tab-strip.ts`): condensing stages, overflow menu, intents for select, close, keys, context menu and pointer down. The context menu and value popover (`studio-ui/menu.ts:219`). The dock's tab key scope (`app/input-bindings.ts:220–224`). `DockView.load` (`studio-ui/dock/dock-view.ts:138`). |
| **Missing** | Everything in §3 below: the strip as the page-level row, its `+`, rename through the value popover, reordering by drag within the strip, the read-only state; the tab menu; New tab ▸ and the substitution step; the global keys (Alt+1…9, Alt+PageUp/PageDown) and palette commands (design §6.7). **The switch itself:** load the tab's arrangement, rebind the panels to its instances, and draw its most recently focused view. |

### 2.7 The **Choose…** routes

| | |
|---|---|
| **On main** | Resolution yields `empty` and `dangling` states with reasons (`app/profiles/bindings.ts:51–57`), and nothing presents them yet. `scene.setLook` and `scene.setSubject` exist (`app/profiles/scene-commands.ts`). A scene with no V gets a new default V made for it at start (`app/profiles/profile-window.ts:130–138`). |
| **Missing** | Empty states for what phase 2 can produce (§3.4): a 3D view whose scene has no V, editors whose scene has no look, and a panel with no eligible view in its tab (**Open a 3D view**). Each lists its candidates and acts on the scene (decision D4). Dangling pins and the binding selector stay in phase 3. |

### 2.8 Modules menu and Layouts button removed

| | |
|---|---|
| **On main** | See §1. Also: the palette's `layout.reset` (`studio-ui/app.ts:962`), the Panels menu's Reset this layout (`:513`), the withdrawn-panel toast (`:133–136`), the guidance anchor `header.layouts` (`studio-ui/guidance/anchors.ts:16`), and Coming soon rows for planned modules in the Modules menu (`compose/modules.ts:19`, `studio-ui/app.ts:718–720`). |
| **Missing** | Removing them, with the legacy fields (`modules`, `layouts`, `layout`) kept exactly as read and written back for older builds (design §2.4). Deleting `app/layout-library.ts` and `studio-ui/layouts.ts`. Moving Coming soon to the Panels menu (decision D10). |

### 2.9 Per-view editing, lifting 4a-vi's refusal

| | |
|---|---|
| **On main** | One editor document, following the drawn scene's look. The preview device rasters that document's layers (`legacy/eye-makeup/browser/browser-preview-device.ts:32`), and a surface no longer shown keeps what it was given (`disconnectScene`, `:185`; `holdsCurrent`, `:217`). Its resources are kept by stable layer ID (`legacy/eye-makeup/preview/authoring-preview-coordinator.ts:134`), and `resetStack` rasters a whole look again (`:130`). The editors mount per view (`preview/browser/scene-editors.ts`). |
| **Missing** | **Showing a view of another look:** the leaving head's surface is disconnected (it keeps its layers), the on-head editor is unmounted, the document switches to the new look, and the target head is filled and prepared with it before the takeover; going back before the takeover switches the document back. **The warm look's raster resources are kept** with it, bounded by residency, so a warm switch back needs no raster (one 2K look takes about 1 s: [raster performance](../../research/authoring/raster-performance.md)). The UV editor's albedo follows at the takeover. `ANOTHER_LOOK`, `refusal(view)` and the owner's refusal go. **3D view panels per view:** `view.<id>` panels made per view instance, with the device's canvas attached to the drawn view's panel. A view not drawn shows that it isn't, and focusing it draws it. |

### 2.10 Not in phase 2

- **Duplicate tab** (design §6.2, §6.3) is phase 6 by §9.2. The tab menu leaves it out until then.
- **The header subject slot and profile flyout** (§6.5) are phase 5. Phase 2 removes the Modules button and adds nothing in its place (decision D9).
- **The panel picker, several instances of a type in one tab, the binding selector, dangling states** are phase 3.
- **Simultaneous drawn views** are 4b. A tab may hold several views, and one is drawn.

## 3. UI spec list

The style guide is the spec. In every chunk the UI component track writes these entries first, the UI design lead reviews them, and then the feature code composes them. Each ships with light and dark captures at a narrow and a wide panel beside the pattern it follows.

| # | Component | Library | Behaviour | States | Keyboard | Accessibility |
|---|---|---|---|---|---|---|
| U1 | **Layout tab strip** | **Extends** Tab strip (`lib-tab-strip`) | A full-width row between the header and the dock. Click switches tab. `+` at the end opens New tab ▸ (U3). Double-click or F2 renames through the value popover (U5). Drag reorders within the strip only (no docking, no floating). Middle-click does nothing (close is in the menu and on Delete; a stray click mustn't close a tab). Right-click or Shift+F10 opens the tab menu (U2). Each tab's icon is its origin's (the module's icon; a generic layouts icon for own defaults and empty tabs). Overflow uses the strip's condensing stages, and the active tab stays in the strip. Switching shows its effect at once: the tab is selected and the arrangement loads, with the 3D view's progress in place if its V isn't ready. | Active, inactive, focused, renaming (the tab pressed while its popover is open), dragging (a drop marker between tabs), overflowing, read-only (switching works and is not stored; `+`, rename, reorder and close show as unavailable with the window's reason), empty session (only `+`, with "New tab" as its label). | Roving focus. ← → Home End move and switch, Alt+Shift+← → reorder, F2 renames, Delete closes, Shift+F10 or Menu opens the menu, Enter or ↓ moves into the dock. Global: Alt+1…Alt+8 tab N, Alt+9 the last, Alt+PageUp and Alt+PageDown previous and next. | `tablist` named "Layout tabs", `aria-selected` and `aria-controls` (the dock region). Each tab's name is its label and origin ("Eye makeup, made from Eye makeup"). Reordering and switching are announced. |
| U2 | **Tab menu** | **Composes** Context menu (`c-context`) and Value popover | Rename…; Reset to default ▸ (the origin first, then a separator, then the others grouped by owner); Save as default…; Update "<own default>" (only when the origin is an own default); Close tab; Reopen closed tab ▸ (newest first; a reset's fragment reads "<name> before reset"). Entries that don't apply are left out; entries that apply but can't run now (read-only window) show unavailable with the reason. Reset and Close act at once and are undoable (Undo, and Reopen closed tab). | Normal, read-only, no closed tabs (Reopen left out), origin gone (Reset lists the others; the origin's deleted default isn't offered). | As the context menu: roving focus, type-ahead, → opens a submenu, ← or Escape closes. | `role=menu`; the heading names the tab. |
| U3 | **New tab ▸ menu** | **Extends** Context menu: a row with a trailing secondary action (new to the library) | Lists the defaults grouped by owner: each module in module order, with its stage tag when early access, then "Yours". A row whose slots each have at most one candidate names them and creates the tab in one click ("Eye makeup — V · ManualSave-12 · Look 3"). A row with a slot of two or more candidates opens the substitution step (U4); its label ends with an ellipsis. The default used last is listed first in its group and focused. An own default's row has a trailing Delete; deleting is a tombstone with an Undo toast. Opened from `+`, the palette, and the empty session. | Normal; a default whose panel types this build lacks (a newer build's own default) is listed unavailable with the reason; read-only (unavailable, reason). | Menu keys; Delete on an own default's row deletes it (the toast says how to undo). | Each row's accessible name says what it creates and with which V and look. The secondary action is a separate focusable item named "Delete default <name>". |
| U4 | **Substitution step** | **Extends** Value popover with Choice list fields (`c-popover`, `c-choice-list`) | A popover titled "New tab: <default>", one field per slot, every option visible ("Show the options"): **Show which V?** (the profile's Vs of the slot's kinds, then Leave empty), **Show which look?** (the profile's looks, grouped by collection, then Leave empty), **Scene** (Its own scene, or Share the scene of <tab> · <V> · <look>, one per existing scene showing the chosen V). Defaults: the only candidate, else Leave empty, else Its own scene (decision M2). Create makes the tab; Escape cancels and creates nothing. A field with one choice is shown as text, not as a group. A long list (more than about 8 looks) shows a search field above it. | Normal; a candidate deleted while the step is open drops out (its choice falls back to Leave empty with a note); read-only never opens it. | Tab between fields, arrows within a field, Enter creates, Escape cancels and returns focus to the invoker. | Each field is a `radiogroup` named by its slot and the default ("V for Eye makeup"); focus starts on the first field. |
| U5 | **Rename and Save as default…** | **Uses** Value popover (no change) | Rename: one name, validated (empty, too long, control characters). Save as default…: a name defaulting to the tab's name, unique among own defaults; the tab's origin becomes the new default. Saving over a feature default's name makes an own default; the hint says so. | As the popover. | As the popover. | As the popover. |
| U6 | **Empty state with choices** | **Extends** Empty states (`c-empty`): several choice buttons instead of one primary action | The title says what is missing, one line says why, then the choices themselves as buttons, each naming its target. **3D view whose scene has no V:** "Show which V?" with the profile's Vs, then the game's default V (feminine, masculine). **An editor whose scene shows no look:** "Show which look?" with the profile's looks (up to about 6 shown; more opens a searchable list, Choose…). **A panel with no 3D view in its tab:** "Open a 3D view" with the profile's Vs (it adds a view to this tab showing that V). Choosing acts at once (optimistic), and the panel fills. | No candidates (one plain line and the one action that makes one: the default V); many candidates (Choose… list); read-only (unavailable, reason). | Tab through the choices; Enter chooses. | Each button's name says what it does ("Show V · ManualSave-12 in this 3D view"). |
| U7 | **3D view pane: not drawn** | **Extends** Setup card and head pane states (`c-setup`) and Viewport overlays (`c-viewport`) | A tab can hold several 3D views and one is drawn (4b brings more). A view not drawn shows its title, its V and look, and **Show here**. Pressing in the pane or focusing it does the same: the view is drawn, with the usual progress in place if its V isn't prepared. | Not drawn, preparing (existing), ready (existing). | Enter or Space on the pane draws it. | The pane's name says it isn't shown and how to show it. |
| U8 | **Panels menu without modules** | **Changes** the Panels flyout (`d-summon`, `s-header`) | Rows open or close a panel **in this tab**. Module switches and parked rows go. A folded **Coming soon** heading lists planned modules, with research tools on only (as today). Reset this layout becomes the tab menu's Reset to default. | Open, collapsed, closed. | As today. | As today. |
| U9 | **Header without Modules and Layouts** | **Changes** Application header (`s-header`, `s-category`); retires Saved layouts (`d-layouts`) and updates Size classes and default layouts (`d-sizes`) | The Modules button and the Layouts button go. The crumbs stay and follow the drawn view's look. `d-sizes` says defaults hold both size classes, and Reset to default restores both. | — | — | The `header.layouts` guidance anchor becomes `tabs.strip`. |

Toasts (closing a tab: "Closed <name>" with Reopen; deleting an own default with Undo) use the existing Toasts pattern unchanged. The palette entries and the Keyboard & mouse reference rows of design §6.7 are generated from the action registry and `KEY_BINDINGS` as today; the style guide's Command palette and Focus entries list them.

## 4. Chunk plan

Each chunk leaves `main` green (suite, typecheck, build), has one Sol review, and is merged by the coordinator. Chunks with a UI change start with the UI track's style-guide entries, and pass the UI review before the merge.

| Chunk | Scope | Gates | Review | Effort | Depends on |
|---|---|---|---|---|---|
| **P2-i: Session operations and one history** (DOM-free) | `ProfileSessions` replaces `ProfileSessionState`: tabs, the shown tab, every operation of design §4.1 as one commit and one `view:<profile>` step (new tab from an instantiated fragment, close, reopen, reset, rename, reorder, add or remove a panel, change a binding, add or close a view). `ProfileSessions` owns the `view:<profile>` scope; the view graph records through it. The graph loses its required main view and `MAX_VIEWS`; an empty session is valid; views carry their tab. `tabs.*` in the action registry. The workspace stores every tab; the dock saves to the shown tab, not to `layout.set`. Behaviour unchanged with one tab. | T1, model-based and seeded: random operations, Undo to the start and Redo to the end, the stored session byte-identical at both ends; close, Undo: byte-identical; close, Reopen: byte-identical (the fragment keeps its views' focus numbers, D13); an Undo that would put a view in a missing tab can't happen. The multi-subject test on two tabs. The parity test and the workspace fixtures unchanged with one tab. The no-default boundary test stays empty. | Sol | 2–2.5 | — |
| **P2-ii: Fragments, substitution and defaults** (DOM-free, one library kind) | The design's `LayoutFragment` with bindings and state, validated on read. Fragment from a tab; instantiation with fresh IDs; substitution candidates as data. `DefaultLayoutContribution` on modules; eye makeup's default from the factory arrangement; minimal Poses, Expressions and Save Explorer defaults (M1). `LayoutDefaults` over `layout-default` documents through the outbox: create, update, rename, delete as a tombstone with restore. `tabs.saveAsDefault`, `tabs.updateDefault`, `defaults.delete`, `defaults.restore`. A verification-only command that prints a tab as feature-default data, so supplied layouts can be authored in the Studio (M1). | T1: the fragment round trip (tab, fragment, new tab, fragment: equal up to keys) for every contributed default and for migrated own defaults; substitution with 0, 1 and 2 candidates per slot, and Share the scene of; a contributed default naming a panel type or view tool no module has fails at composition; the outbox model test with `layout-default` writes and a conflict. | Sol | 1.5–2 | P2-i |
| **P2-iii: Per-view editing and 3D view panels** | **Style guide first:** U7. The heads owner draws the shown tab's most recently focused view. Showing a view of another look disconnects the leaving surface, unmounts the editor, switches the document, and fills and prepares the target before the takeover; the warm look keeps its raster resources (bounded by residency, D3). `ANOTHER_LOOK`, `refusal(view)` and the owner's refusal are removed. `view.<id>` panels per view instance; the device's canvas follows the drawn view's panel; a view not drawn shows U7. | T1: no frame of the leaving head ever holds the new look's layers (held layers checked per slot); back before the takeover restores the first look with no raster; a gesture open across the switch is settled, never applied to the other look. T2 (`tests/webgl-scene-runtimes.test.ts` grows): a warm switch to a view of another look ≤ 100 ms with 0 links, 0 programs and no raster; the look resources kept for the warm runtime are released on its eviction (GL counts and canvas count at baseline). | Sol; **UI review** (U7) | 2–2.5 | P2-i |
| **P2-iv: Tab strip, tab menu, New tab and substitution** | **Style guide first:** U1–U5. The strip row replaces the Layouts button (its code goes with it; saved layouts are already own defaults). Switching: the tab's arrangement loads, panel controllers rebind to its instances (D2), its focused view is drawn. Tab menu, New tab ▸ with one-click entries, the substitution step, Save as default…, Update, Reopen. Keys and palette per design §6.7. An early timing probe of the switch's main-thread part (dock load, rebind, first paint) on synthetic panels, so a slow path shows here rather than in G4. | T1: presentation tests per operation, keyboard tests, read-only refusals; the switch's main-thread work under 50 ms per task in the probe (headless Chrome, synthetic panels). Captures light and dark, narrow and wide, beside the dock's tab strip. | Sol; **UI review** (U1–U5) | 2–2.5 | P2-ii, P2-iii |
| **P2-v: Feature focus; Modules menu removed** | **Style guide first:** U8, U9. Tool filter from the shown tab; Presets and Library move to eye makeup; experiments follow the tab. The Modules button, menu, palette commands and `modules.set` go; the Panels menu loses module switches and parked rows, gains Coming soon; `layout.reset` becomes Reset to default. `UIPreferences.modules`, `layouts` and `layout` kept exactly as read. `app/layout-library.ts`, `studio-ui/layouts.ts` and their tests deleted. | T1: tools derived per tab (a Poses tab offers no Surface controls; makeup still draws); an older-build reader sees the legacy fields unchanged; `coming-soon.test.ts` follows the new home. Captures as above. | Sol; **UI review** (U8, U9) | 0.75–1 | P2-iv |
| **P2-vi: Choose… routes** | **Style guide first:** U6. Empty states for a scene without a V, a scene without a look, and a panel with no 3D view in its tab, through the resolver's `empty` state; choosing dispatches `scene.setSubject`, `scene.setLook` or a new view in the tab (D4). | T1: each empty state with 0, 1 and several candidates; choosing acts on the captured scene and is refused (`missing_target`) if the scene changed meanwhile. Captures as above. | Sol; **UI review** (U6) | 1–1.5 | P2-ii, P2-iv |
| **P2-vii: G4 and records** | The tab-switch gate on real data (§5). Records: design §4 and §6 "Built in phase 2" notes, the view graph design's status, the UI boundary record, the action catalogue, the style-guide entries marked implemented, the performance track. | G4 (§5). | Sol (harness) | 0.75–1 | P2-iii to P2-vi |
| **Total** | | | | **10.75–13** | |

**Against the design's 8–10.** Two pieces of work weren't in the phase 2 estimate. The 3D view panel was a singleton and must exist per view before a second tab can show its own view. Per-view editing needs the warm look's raster resources kept, or every switch between looks re-rasters (about 1 s at 2K) and the gate fails. The composite history (one step over session and graph) adds a little more. P2-iii can run beside P2-ii, so with two agents the elapsed time is about four fifths of the total.

**Merge order.** i, then ii and iii (either order), iv, v, vi, vii. P2-iv removes the Layouts button in the same chunk as the strip arrives, so `main` never has both. Until P2-v, module visibility is still the preference.

**Reductions as the work migrates:** `ProfileSessionState`, the factory layout as the dock's fallback, `layout-library.ts`, `layouts.ts`, the Layouts and Modules buttons, `moduleMenuItems`, `modules.set`, parked panels, `ANOTHER_LOOK` and `refusal(view)`, the graph's main-view rule and `MAX_VIEWS`, the singleton `head` panel.

## 5. G4: the tab-switch gate on real data

Run by the coordinator at the end of P2-vi, with 043's environment: an isolated server per build (its own port, data folder and caches; never 4317 or 4331), `measure.ts` gaining tab rows, warm cache then a fresh Chrome profile. Memory as G3: server `--limit 5`, Chrome `--limit 5` (head only); the whole-body part needs Chrome 6.

| Row | Setup | Gate (S2's budget) |
|---|---|---|
| T-a | Two tabs whose views share one scene | Click to first presented frame ≤ 100 ms |
| T-b | Two tabs, two scenes of one V, the other warm and prepared | ≤ 100 ms; 0 links and 0 programs in the first shown frame |
| T-c | Two tabs, two Vs of different bodies, the other warm | ≤ 100 ms; 0 links |
| T-d | T-b with the two scenes showing different looks | ≤ 100 ms; no raster; 0 links |
| T-e | A third tab, cold (beyond the warm budget) | Progress in place within 150 ms, never a blank pane; no task ≥ 50 ms; the result shown once ready (no gate on duration) |
| T-f | Rapid switching: A, B, C, A within 300 ms | Only A shown; nothing superseded drawn; no late result |
| T-g | The switch's main-thread part (dock load, rebind, paint) | No task ≥ 50 ms from the click to 1 s after |
| T-h | Close a tab whose scene nothing else shows | Its runtime disposed; GL objects and memory back at the baseline |

## 6. Decisions

### Needing the maintainer

| # | Question | Proposed default |
|---|---|---|
| M1 | **Which default layouts ship.** The decision of 21 October says good defaults will be supplied. | Build with today's factory arrangement as eye makeup's one default ("Eye makeup"), and one minimal default each for Poses, Expressions and the Save Explorer, made by the implementing agent. The supplied layouts replace them as data at any time: arrange a tab in the Studio, then a verification-only command prints it as a feature default to paste into the module. Nothing waits on them. |
| M2 | **A new tab for a V that another tab already shows: its own scene, or the existing one.** The design gives every new tab its own scene unless Share the scene of is chosen. Each scene is its own runtime (about 0.47 GB of VRAM head only), and only one runtime stays warm (043 decision D2), so a third tab on the same V is rebuilt on every visit (2.5–9 s in G3). Sharing is instant and costs nothing, but the tabs then share the V's pose, idle and eye shape (cameras stay separate). | Keep the design: Its own scene is the default, and Share the scene of <tab> is listed beside it in the substitution step. Measure T-b and T-e in G4, and revisit the warm budget (N = 2) or the default if cold visits prove common. |
| M3 | **Early-access modules in New tab ▸.** With the Modules menu gone, Poses, Expressions and the Save Explorer (all early access, hidden by default today) are reached through their defaults and the Panels menu. | List their defaults with the Early access tag, as the Panels menu already lists their panels. Moving any of them behind research tools for the beta stays his call ([work queue](../../research/backlog/README.md#work-queue)). |

### Decided here

| # | Decision | Why |
|---|---|---|
| D1 | The shown tab is held with focus (`focus.tab`), stored with the session, never an Undo step. | Switching tabs is navigation (design §3.3); unknown fields are kept, so the data stays forward-readable. |
| D2 | Panel controllers stay one per type in phase 2, rebound to the shown tab's instance on a switch. New code addresses panels by instance ID. | Only one tab is shown at a time, and one instance of each type per tab is all phase 2 offers; several per tab is phase 3. Rebinding is far cheaper than rebuilding panels on a switch. |
| D3 | One editor document follows the drawn view's look. It switches when the view is asked for, after the leaving head's surface is disconnected; the warm look keeps its raster resources, bounded by residency. | All of phase 2's panels follow focus within the shown tab, so they resolve to the drawn view's look anyway. A surface already keeps what it was given when disconnected (`disconnectScene`), so the head on screen never shows the wrong look. Documents per look come with phase 3's instances and phase 5's several looks rastered at once. This answers 4a-vi's concern (a second notion of the drawn view): there is still one, and the document follows it, while the head on screen is held. |
| D4 | Phase 2's Choose… acts on the scene (`scene.setSubject`, `scene.setLook`) or opens a 3D view in the tab. Pins come from fragments only (with the Character panel's subject pins already supported). | A look editor pinned to a look no view shows needs a document per look (phase 3). Acting on the scene keeps "a panel never edits an unseen subject without saying which one" (§3.3). |
| D5 | `ProfileSessions` owns the `view:<profile>` scope, and the view graph records through it. | Design §4.1 needs one step over tabs, graph and focus; the history service takes one target per scope. |
| D6 | The main view becomes ordinary. `head` stays as the viewport device's kind and key scope, and as an alias in capture tools and evidence keys (design §4.4). The workspace budget replaces `MAX_VIEWS`. | Renaming the 172 uses of `"head"` buys nothing; the alias is what §4.4 asks for. |
| D7 | Rename uses the value popover, not an inline edit. | Design §6.2 ("names go in the value popover"); one naming pattern across the Studio. |
| D8 | The tab menu leaves out entries that don't apply, and shows entries that apply but can't run now as unavailable with the reason. | Menus are actionable (AGENTS.md), and a read-only window shows editing controls as unavailable with the reason (`t-read-only-window`). |
| D9 | Nothing replaces the Modules button until phase 5's subject slot. The crumbs stay and follow the drawn view's look. | Phase 2's scope; the crumbs already say what is being edited. |
| D10 | Planned modules move to the Panels menu's folded Coming soon (research tools only) until the picker. | They are listed only with research tools on today; the picker (phase 3) has their final home. |
| D11 | `layout-library.ts` and `layouts.ts` are deleted. The legacy preference fields are kept as read and written back unchanged. | The migration already made every saved layout an own default; design §2.4 freezes the legacy fields for older builds. |
| D12 | Reset to default restores both size classes. | A fragment holds both (§4.2); a reset that left one class changed would be surprising. |
| D13 | A closed tab's fragment keeps its views' focus numbers, and Reopen restores them. | Makes close and reopen byte-identical, the phase's gate. Numbers stay unique: they never exceed `seq`. |
| D14 | `+` opens New tab ▸, with the default used last first and focused. | The person chooses the default each time (contributed-defaults policy), and Enter repeats the usual one. |

## 7. Risks, ranked

1. **Switching looks costs a raster.** Without the kept resources (D3), a tab switch between two looks re-rasters the whole look: about 1 s at 2K for a complex layer, far over 100 ms. Keeping them costs memory per warm look (preview-size canvases per layer). P2-iii measures it in T2 and G4 measures it on real data (T-d). If the memory is too high, the warm look keeps its masks at a smaller tier and is brought up after the takeover.
2. **Fresh scenes multiply runtimes** (M2). Each tab on its own scene is a runtime. With one warm, the third tab is cold on every visit. G4's T-b and T-e measure it; the levers are the warm budget and the substitution default, not the model.
3. **The switch's main-thread work.** A dock load, rebinding every panel and its first paint could pass 50 ms in one task, or push the first frame past 100 ms. P2-iv probes it early on synthetic panels; G4 T-g measures it on the real Studio. Rebinding (D2) rather than rebuilding is the first mitigation; painting off-screen panels lazily is the second.
4. **One history over session and graph.** Coalesced camera and lighting steps, CORE-94's whole-result check and structural session steps share one scope. A step restoring views into a tab another step removed must be impossible by construction. The model-based T1 test in P2-i, with seeded random operations, is the guard.
5. **Removing the main view's special status** touches the graph's parser and history check, capture tools and the viewport attachment. The `head` alias (D6) limits the change; the parity test and the workspace fixtures catch drift.
6. **Workspace size.** Tabs, closed fragments (with value copies of lighting setups) and no `MAX_VIEWS` grow the session. The workspace budget already refuses with a reason; P2-i adds a size row to the multi-subject test.
7. **Phase 3 inheriting phase 2's shortcuts** (one controller per type, one document). New code addresses instances and looks by ID (D2, D3), so phase 3 replaces the controller map and the document, not the callers.

## Related pages

- [Profiles, views and layout tabs: design](../../research/authoring/profiles-views-layouts-design.md)
- [Experiment 043: scene runtimes](../043-scene-runtimes/README.md) and [experiment 039: view switch spike](../039-view-switch-spike/README.md)
- [Architecture contract](../../research/authoring/architecture-contract.md) and [visual QA checklist](../../research/authoring/ui-visual-qa-checklist.md)
- [Performance track](../../research/backlog/performance.md)
