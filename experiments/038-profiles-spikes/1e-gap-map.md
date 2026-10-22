# Profiles phase 1e: gap map

**Status:** worked through in this pass; what was built, and what was left, is in the 1e report and in the docs it updated ([editor invariants](../../research/authoring/editor-invariants.md#targets-focus-and-captures), [UI architecture boundary](../../research/authoring/ui-architecture-boundary.md)). The map below is the record of the starting point.

What the branch held at `87d62b1f` against each 1e item of the [profiles design](../../research/authoring/profiles-views-layouts-design.md) (§3, §4.1, §5, §7, the phase 1 row of §9.2), what is missing, and the order of work. Paths are relative to `projects/xf-studio/authoring/src/`; line numbers are as of `87d62b1f`.

## 1. Actions name their targets (§3.6)

| Family | Has | Missing |
|---|---|---|
| `camera.*`, `preview.*` | `PreviewAction = … & { view?: ViewId }` (`preview/preview-actions.ts:21`); `target()` falls back to `graph.focused()` (`:203–206`); descriptors mark `view` optional (`app/studio-action-descriptors.ts:39`, `inView`) | `view` required; the fallback removed |
| `motion.*` | `MotionAction = … & { view?: ViewId }` (`animation/motion-actions.ts:55`, `MotionScene` `:88`) | `view` required |
| `view.setTool` | `view?` falls back through `graph.target()` (`app/view-actions.ts:22, 51, 97`) | `view` required |
| `pose.select`, `pose.clear`, `pose.frame` | Act on "the shown V" through `PoseStageHub` (`animation/pose-stage.ts`), no target | `view` required |
| `scene.setSubject`, `scene.setLook` | Session methods only (`app/profiles/profile-session-state.ts:66–83`); `preset.select` sets the drawn scene's look through the `CollectionScenePort` (`library/collection-service.ts:115–124, 544`) | Registered actions naming `scene` and `sceneGen`; `preset.select` replaced |
| `character.*` | Act on the one attached `characterContext` (`app/studio-application.ts:127, 802–805`); `CharacterService` already keys contexts by ID and its commands name `base` | `character` required on every context action, routed by ID |
| Eye makeup `layer.*`, `point.*`, `field.*` … | Act on the one live editor document (`core.document`) | `look: LookRef` required, validated against the look the editor shows |
| `preset.*`, `collection.*`, `package.*` | Act on "the collection the drawn scene's look belongs to" (`library/collection-service.ts:199–203`) | `collection` (and `scene` where a preset is shown) required |
| `saves.*` | Done in 1d-ii: `instance` (`features/save-explorer/sessions.ts:14`) | Nothing |
| `profile.*` | Name `profile` and `base` (`app/profiles/profile-service.ts:41–47`) | Nothing |
| `tabs.*` / `layout.set` | `layout.set` changes "the" dock (`app/ui-preferences.ts:62`); no `tabs.*` yet (phase 2) | `layout.set` names its `tab` |
| `history.undo`, `history.redo` | `scope` optional; without it the application asks the history service for its focused scope (`app/studio-application.ts:497–508`) | `scope` required; the application never reads the editing context |

**Input layer.** Nothing resolves targets outside the services today. Key bindings (`studio-ui/app.ts:389–391`), the palette and the header build actions without targets.

## 2. `FocusService` (§3.3, §3.7)

- **Has.** The view graph stores focus: `focus`, `focused()`, `focusView()`, `target()` (`platform/core/view-graph.ts:165, 184, 204–210, 376–381`). Focus is part of the View and lighting history's structure value (`:43, 403, 418, 446`), so a structure Undo moves focus. `ViewGraphData.focused` is required when parsing (`:118`, `platform/api/view-graph.ts:48`). The session keeps a second copy of view focus sequences and derives them from the graph when it stores (`app/profiles/profile-session-state.ts:34, 120–131`). The editing context is the history service's `recent` list (`platform/core/history-service.ts:15–22, 318–330, 398–416`), stored with the session through `historyService.editing()` (`compose/studio-startup.ts:277, 290, 318–320`).
- **Missing.** `platform/core/focus.ts`: one owner of view focus sequences (`++seq`, never truncated), the focused panel and the editing context. Focus out of the graph and out of Undo. The history service records into it instead of owning `recent`.

## 3. Captures and the resolver (§3.1–3.3, §3.5)

- **Has.** Panel contexts aren't declared. Bindings exist as data only (`PanelBinding`, `app/profiles/profile-session.ts:26–28`). Context menus freeze a collection and geometry revision (`StudioBoundContext`, `app/studio-context-targets.ts:21–27`), and gestures check their layer, but neither freezes a view, scene, `sceneGen`, subject or look.
- **Missing.** The pure resolution (policies `follow-focus` and `pinned`, the partial context, per-action `requires`, constraint rules as data); `resolver.capture(instance, signal)` freezing `{ view, scene, sceneGen, subject, look }` and document revisions; validation at dispatch (`missing_target`); gestures, menus and popovers taking captures.

## 4. Editing-context history (§3.7)

- **Has (1d-ii).** Scopes `look:<collection>/<look>`, `character:<id>`, `doc:<id>`; the unqualified `look` scope and its fallback are gone; with no editing context the application refuses Undo with `NOTHING_TO_UNDO` (`app/studio-application.ts:46`); a 3D view's own Ctrl+Z steps the look its scene shows (`compose/studio-startup.ts:433–438`).
- **Missing.** The View and lighting scope is still `view`, not `view:<profileId>` (`platform/core/history-service.ts:31`). Undo targets are resolved inside the application (item 1). The header Undo and the History panel don't name the context. Fixtures without a history service still fall back to the document's history (`app/studio-application.ts:507`).

## 5. Data contracts (§4.1, §5)

- **Has.** Session, tab, panel instance and binding types and their reading (`app/profiles/profile-session.ts`); `LayoutFragment` (`app/profiles/profiles-migration-data.ts:48`); storing tab 1 (`app/profiles/profile-session-state.ts:114–134`).
- **Missing.** Bindings aren't validated when read (`tabOf` keeps any panel object, `profile-session.ts:70–75`); instance IDs aren't checked or deduplicated; focus isn't validated; closed-tab fragments are `unknown[]`; panel types don't declare `context`, `owner` or their default binding (§5).

## 6. De-singletoning (§7)

| Row | Has | Missing |
|---|---|---|
| `CharacterContextActions` | Steps 1, 2, 3 and 5 (1b, 1c-i); step 4: the V's scope is `character:<id>` | The application holds one attached context (`studio-application.ts:127`); `character.*` routed by ID (item 1) |
| `SavedAppearanceActions` | Step 1: `character.setSource` (aliases `savedV.*` until phase 1 ends, `character/saved-appearance-actions.ts:19–23`) | Step 2 (apply per scene) is the head's; step 3 (`workspace.savedV` migration input only) to confirm |
| `collection-workspace.ts`' one live look | Steps 1 and 3 (1c-ii, 1d-ii); `LookSessions` keyed by `LookRef` | Step 2 (look actions name `LookRef`, item 1); step 4 (`selected` becomes the scene's `look`: done for the shown look, `preset.select` still the entry point) |
| `liveSurface` | The root reads `STUDIO_COMPOSITION.documents.live` and wires `layered` (`compose/studio-startup.ts:238, 549–558`) | Step 1 (a per-scene setup); step 2 (editor hooks take the captured `LookRef`); step 3 (boundary test) |
| Save Explorer | Done in 1d-ii | Nothing |
| Focused-view default | None of the steps | Steps 1–3 (items 1–3) |

## 7. The no-default boundary test

Doesn't exist. Nothing forbids the root naming the live feature.

## Order of work

1. `FocusService` as plain data with operations, tested deterministically; focus out of the view graph and its history; the history service records the editing context into it (items 2, 4).
2. The pure resolver and captures, tested; `TargetResolver` over the session, focus and document revisions (item 3).
3. Families one at a time, each with its input-layer resolution and tests: `history.*` (scope), the view family (`view`), `scene.*` (replacing `preset.select`), `character.*`, eye makeup and `preset.*`/`collection.*`, `layout.set` (item 1). Each removes its default path in the same commit.
4. The no-default boundary test, listing families still defaulting (item 7), started with step 3 and empty at the end.
5. `view:<profileId>` and naming the context in Undo (item 4).
6. Data contracts (item 5), then the remaining de-singletoning rows, `liveSurface` last, with its boundary test (items 6, 7).

If the pass runs long, items 1–4 with their tests land first (1e-i), and 5–6 follow as 1e-ii.
