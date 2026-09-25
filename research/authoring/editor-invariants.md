# Editor and recipe invariants

Consolidated 25 September 2026 from the dated checkpoint paragraphs that previously lived in `AGENTS.md`. Git history keeps the original wording. This page lists the rules that must survive every refactor. Detailed design and evidence stay in the linked contracts.

## Recipe schema versions

New recipes are created as **`xfs/recipe-7`** (`projects/xf-studio/authoring/src/recipe.ts`). Validation accepts `eye-artistry/recipe-1` and `xfs/recipe-2`…`xfs/recipe-11`. Older schemas migrate **on read** to the current in-memory form. Recipes 8–11 keep their own schema so their optical model stays pinned.

| Schema | Introduced | Migration rule for older input |
|---|---|---|
| `eye-artistry/recipe-1` | Legacy fixed four-layer look | Still readable; must have exactly four layers |
| `xfs/recipe-2` | Editable/variable layer stacks (preview budget 32), stable layer IDs | — |
| `xfs/recipe-3` | `fields` arrays (0–8 warp fields per layer, stable field IDs, additive Gaussian sampling at the original query) | v1/v2 single `field` migrates with exact single-field mask parity |
| `xfs/recipe-4` | Per-layer `strength`: `smooth-boundary` with positive blend distance (default 0.0005 control UV, bounds 0.000125–0.02) or explicit `legacy-nearest` | v1–v3 migrate to `legacy-nearest`, preserving saved looks; the upgrade to smooth is explicit and undoable |
| `xfs/recipe-5` | Explicit per-layer `pathMode`; Bézier points with relative incoming/outgoing handles (Smooth = aligned arms, independent lengths; Symmetric = equal opposite arms; Corner = independent arms) | v1–v4 keep original Catmull–Rom geometry; conversion is explicit and undoable |
| `xfs/recipe-6` | Explicit uniform/boundary (directional) softness with per-point widths | v1–v5 migrate to uniform softness without mask changes |
| `xfs/recipe-7` | **Current default.** Opt-in irregular raster Glitter model | — |
| `xfs/recipe-8` | Direct-light UV-cell Glitter | Pinned |
| `xfs/recipe-9` | Clustered direct Glitter | Pinned |
| `xfs/recipe-10` | Denser fine-speckle direct Glitter | Pinned |
| `xfs/recipe-11` | Per-layer game-matched `optics` for Glossy, Shimmer and Colour-shifting (with shift colour and strength); accepts every recipe-10 layer | Pinned. Changing a layer to one of these finishes adds `optics` and moves the recipe to 11; existing layers keep their earlier study until **Use game-matched model** (`layer.useGameOptics`) |

Rules:

- **Version the model whenever appearance changes.** Older recipes must keep their original look, so never silently upgrade existing pigment, softness, path or optical fields.
- **Never rewrite stored revisions.** Old SQLite revisions stay unchanged; migration happens on read only.
- **Share one evaluator.** Preview, PNG export, the raster worker and the compiler all use the same mask evaluator and adaptive Bézier tessellation. Raster bounds include every warp displacement and the maximum softness width.
- **One schema rule for layer edits.** `requiredRecipeSchema()` ([`recipe-schema.ts`](../../projects/xf-studio/authoring/src/recipe-schema.ts)) takes the newest schema any layer's stored form needs (irregular Glitter 7, Direct 8, Clustered 9, Fine 10, game-matched optics 11) and never goes below the recipe's current schema. Every recipe action and Glitter-model change goes through it, so a per-layer choice never downgrades the recipe or invalidates another layer, and removing the layer that needed a newer schema does not move the recipe back. Capability and dispatch agree: every finish and Glitter model the application offers is applied.
- **Keep editor state out of portable recipes.** Field selection, UV view state and similar editor memory belong in editor/workspace state, not in the portable recipe.

## Layers, presets and collections

- Layers render bottom-to-top in recipe order and appear top-first in the UI. IDs survive rename and reorder. Do not reintroduce fixed four-layer assumptions.
- Presets are complete looks. `CollectionSession` owns preset switching without UI or network dependencies.
- SQLite v2 stores immutable collection and preset versions while preserving legacy look rows.
- Keep drafts, per-preset Undo and stable IDs through edits and imports.
- **Undo transactions track their own entry.** A gesture or form transaction keeps the identity of the Undo entry its checkpoint added (`AuthoringDocument.checkpoint()` returns it) and labels or discards only that entry, never by comparing depths. At `RECIPE_HISTORY_LIMIT` (80) a new entry displaces the oldest; discarding an empty transaction's entry, or undoing it, brings the displaced entry back.
- **Undo entries keep their identity.** Every entry has a session-unique ID. Undo, Redo and history jumps carry a step's ID, label and time with it, so a step keeps the same ID whether it is done or undone. A preset switch or restore starts fresh IDs; old ones never match again.
- **History jumps are Undo/Redo runs.** `history.jumpTo {entryId}` goes to the look right after that step (or, for the timeline's `startId`, the oldest kept state) by applying the Undo or Redo steps between as one change: the recipe is published once and preview resources are reset once. It adds no entry of its own, keeps every step reachable (like repeated Undo/Redo), follows the same Redo validity rule (only while the look is exactly what the last Undo/Redo/jump produced; any other edit discards undone steps) and is refused while a gesture or form transaction is open. Reading the history never discards Redo: an open transaction only hides it (its checkpoint is the new top entry), and cancelling the transaction brings it back; Redo is discarded when a different entry is on top or the content differs, at the next Undo, Redo or jump. At the limit a jump behaves exactly like the same single steps, including the displaced-entry rule.
- **"Older steps were not kept" is recorded, not guessed.** The history knows when entries older than its first were dropped: a new entry at the limit (undone again if that entry is undone), more than 80 entries on restore, or the browser workspace budget trimming a stored copy. Stored editor memory carries an optional `historyTrimmed: true` for that; it is absent otherwise, so untrimmed workspaces serialize exactly as before and older builds ignore it.
- **Form control edits are validated actions.** `controlEdit` passes the same capability gate as `dispatch` (target, descriptor payload types and ranges, domain rules) and returns a typed result; a refused edit never opens a transaction. `createTrustedAuthoringCore` wires control dispatch; hosts do not supply it.
- Collection files and build plans are portable compiler inputs, not installable mods.

## Browser workspace persistence

- **Save on content changes only.** Autosave subscribes to domain and content sources (the authoring document, preferences, the collection library, preview services and view adapters), never to the whole presentation port, which also carries the save status and preview readiness. Save status is published only when it changes, and identical content is never rewritten.
- **Bounded size** (`workspace-budget.ts`). Each workspace key targets at most 2,000,000 UTF-16 code units, because the normal and `?verify=1` keys share one origin quota of roughly five million. Every save stores the selected preset once (inside the collection, not again as the top-level editor), keeps the selected preset's full Undo history, keeps the latest 5 Undo entries of other presets, keeps removed presets without their histories and keeps recovery drafts' presets without histories or removed-preset lists. Only when that is still over budget, or the browser refuses the write, does a save give up more Undo depth and recovery copies, and it reports `nearly-full`. If nothing fits, it reports `full`. Neither case is silent. The live session keeps its full in-memory history; only the stored copy is trimmed.
- **Tolerant restore.** Only the current collection draft must parse. A damaged recovery draft or removed-preset entry is dropped with a warning (`loadWorkspace().warning`, save status `repaired`); a damaged current draft still protects the original storage from being overwritten.
- **Retired shell fields are ignored, not rejected.** Workspaces written while the sidebar shell existed also carry `panels` (sidebar widths, scroll positions, open sections), a draft `expanded` flag and a collection `filesOpen` flag. Restore ignores them and saves no longer write them; the dock layout and theme live in `uiPreferences`. Older recipe, collection and workspace formats and SQLite rows still migrate on read.

## Path, pigment and softness

- Point pigment (strength) is distinct from edge softness. Keep a positive regularisation term for crossing paths.
- Directional softness: keep stored per-point widths when the feature is disabled, and interpolate widths through all path operations.
- Shape scaling scales widths, blend distances and warp radii and vectors. See the [directional softness contract](directional-softness-contract.md) and the [shape gesture contract](shape-gesture-contract.md).
- Separate addable softness-field controls are **on hold** by request while per-point softness is evaluated. Record the concept; do not implement it yet.
- Pure curve actions stay separate from UV and surface adapters.
- **Known Bézier limits.**
  - Exact continuous splitting still has small measured raster approximation differences.
  - Fit includes legal outside-atlas tangents.
  - Missing or singular tangent parents fall back to UV editing.
  - Extreme handles can cause long worker jobs and expensive main-thread guide rebuilds. Address cancellation and indexing before claiming that every valid recipe edits interactively.

## Surface editing and viewport

- **Whole-shape gestures.** `shape-transform.ts` is the pure API, and the pivot is the selected contour point. Proposals are rejected atomically. Mirrored canonical mapping, whole-gesture Undo/Escape, 250 ms wheel bursts and stale-context guards are preserved. Legacy Shift-click relocation is removed. Shift always means a shape gesture: off makeup it does nothing, never a camera pan or zoom (B-17, option b). See the [shape gesture contract](shape-gesture-contract.md).
- **Input bindings.** Every pointer gesture and shortcut resolves through [`input-bindings.ts`](../../projects/xf-studio/authoring/src/input-bindings.ts). Hints, tooltips, cursors, menu and palette shortcut labels, and the Keyboard & mouse dialog derive from the same table. Add a binding there before handling a new input; tests fail on unlabelled bindings or hints without a binding. See [input bindings](input-bindings.md).
- **UV wheel zoom and right-drag pan** change persistent view state only. See the UV viewport section below.
- **Tangent arms and occlusion.** Tangent arms are projected vector UI on their parent knot's deformed triangle plane. They may cross eye holes and must never be labelled mesh anchors. Only these guides bypass endpoint depth, gated by the parent's front-facing visibility. Occlusion uses cached exact deformed geometry with dependency invalidation, because repeated per-frame skinned raycasts caused a measured regression. See [projected tangent controls](projected-tangent-controls.md).
- **Guide draw order.** Surface guides render after the transparent brow and lash cards while keeping opaque head and eye depth testing and far-side picking rejection. Do not disable all depth tests or physically lift guides.
- **SurfaceMap UV hierarchy** keeps original triangle-order winners and exact gap tests. Pose anchors are unchanged.
- **Idle controls.** Pause never uses the reset path. With both Head and Facial movement muted the idle stays enabled and keeps its phase. Phase-zero neutral-space camera normalisation stays consistent across subset changes and reloads.
- **Context menus.** Preserve native text-field context menus and suppress unhelpful browser menus elsewhere.

## UV viewport

The UV map's canvas fills its panel's whole stage (the area below the toolbar), docked or floating. The math lives in [`uv-view.ts`](../../projects/xf-studio/authoring/src/uv-view.ts); [`uv-editor.ts`](../../projects/xf-studio/authoring/src/uv-editor.ts) is the only adapter.

- **View state is a frame, not a box.** The persistent `UVView` is a centre (`u`, `v`), a frame width `span` and an optional frame `aspect` (width/height). The frame is always fully visible: `uvViewRegion(view, width, height, insets)` scales it uniformly to fit the pane's safe area, centres it there, and shows whatever else fits around it. One UV unit has the same length in both directions at every pane shape.
- **Stored views keep their meaning; no migration.** Views saved while the canvas was a fixed-aspect box have no `aspect`, and the mode's historical box proportions (`uvAspect`: 720:310 for both eyes, 720:520 for one) apply. In a pane of those proportions they show exactly the old crop; in any other pane the old crop is contained and more of the atlas shows around it. `parseUVView` rejects an out-of-range aspect (outside 1:10 to 10:1) like any other damaged field.
- **Limits.** The centre stays within -1 to 2. The frame's larger side stays within 0.02 to 10 UV units, so zoom limits hold for tall and wide frames alike; pointer anchoring is subject to those limits.
- **Fit fills the pane.** Fit sets the frame to the content's bounds (contour, knots, Bézier arms and warp controls, both mirrored instances, or one eye in single-eye mode) times 1.25, at least 0.04 UV per side and within the aspect limits. Because the frame carries its own aspect, the content fills the safe area's limiting side at 80% whatever the pane's shape. Single-eye mode fills the pane with that eye.
- **Safe insets keep Fit clear of overlays.** The host's CSS declares `--uv-safe-top/right/bottom/left` (registered `<length>` properties on `.uv-stage`). The bottom inset is the hint strip's maximum height plus margins; it drops to the plain margin when input hints are turned off. The editor reads the insets once per draw; they come from CSS, never from measuring the hint strip, so hint content cannot move the view. Insets taking more than half a side are scaled down. The canvas still draws under the inset bands.
- **Mapping, DPR and resize.** Drawing and hit-testing use CSS pixels of the canvas content box; the backing buffer is that size times DPR, and a DPR change alters only resolution. The canvas CSS size comes from its host, never from the buffer, so resizing the buffer cannot feed back into layout. Resizing the pane keeps the persisted view unchanged and the frame visible and centred.
- **Zoom and pan.** Wheel zoom scales the frame about the UV under the cursor, so that point stays under the cursor at any pane size, inset or DPR. Right-drag and Ctrl-drag pan from anywhere in the pane, including the stage outside the atlas, keeping the grabbed UV under the pointer. Escape or a lost capture restores the view without touching recipe history.
- **Drawing.** Outside the atlas the canvas is transparent and the panel's theme-aware `--stage` shows through. Only the visible part of the atlas is sampled: its dark base, the albedo at 55% and each layer's tinted mask (drawn into a display-pixel scratch canvas). A neutral outline marks the atlas edge and the dashed centre line spans the atlas height.
- **Hints never take layout space.** Viewport hint strips and the UV warning chip are absolutely positioned overlays. A strip is clamped to two rows (`--hint-strip-max`), with its vertical spacing as a transparent border so a clipped third row cannot show in the padding. A hint change therefore never resizes the canvas. This fixes a loop in which hovering a point changed the hints, the in-flow strip grew, the canvas shrank, the hover was lost and the hints changed back.
- **Unchanged gesture rules.** Handle hit priority (tangents, then the selected warp, then points and warps within 11 CSS pixels), mirrored canonical mapping, whole-gesture Undo and Escape, 250 ms wheel bursts and stale-context guards are as in the [shape gesture contract](shape-gesture-contract.md).

Tests: `tests/uv-viewport.test.ts` (fit at several pane shapes and insets, cursor-anchored zoom at several DPRs, frame-based zoom limits, pan following the pointer and clamping, mapping round trips, stored-view compatibility, overlay CSS), plus the adapter tests in `tests/uv-resolution.test.ts`, `tests/uv-quality.test.ts` and `tests/uv-gestures.test.ts`.

## Preview jobs and performance

- **Preview jobs.** Jobs snapshot recipes, yield cooperatively and acknowledge cancellation without publishing partial masks. Versions stay monotonic across preset resets, with one pending snapshot per layer. The active layer has priority without starving other layers. Worker recovery is lazy and never loops on a broken worker script.
- **Worker yields** use bounded MessageChannel/timer fairness, never microtask-only yielding. Cooperative work budgets count paired writes individually. The exact raster keeps the independent scalar coverage oracle, conservative pre/post-warp bounds, the original edge/tie arithmetic and power-of-two-only mirrored pixel reuse. See [raster performance](raster-performance.md).
- **Preview quality.** Settings (512/1K/2K/4K) are persistent preferences, independent of recipe, history and export. Disabled slots use 1 px placeholders. Failures stay visible until cancelled work is recovered, and stale layers are never reported as ready. See the [preview quality contract](preview-quality-contract.md).
- **Finish choices.** Choosing a different finish gives Glossy, Shimmer and Colour-shifting the game-matched model. Re-selecting the current finish (Satin and its stored alias included) changes nothing and records no Undo step; in particular it never switches an earlier-model layer, which only `layer.useGameOptics` does. Inactive settings are editor memory per preset and layer, never recipe content: each Glitter model's settings (kept when switching models or leaving Glitter) and the last Colour-shift shift colour and strength (restored when the layer becomes Colour-shifting again). They are stored in the workspace under the historical `glitterChoices` key, with Colour-shift settings as an optional `shift` entry that older builds ignore.
- **Export status is preset-level.** `StudioApplication.layerExport()` reports a layer's status from the same `planPresetExport` plan Check uses, with `blockedBy: "layer"` (its own finish) or `"preset"` (the rest of the preset, e.g. Colour-shifting beside Matte). A hidden layer is judged as if shown. The Inspector and the Layers flag show that status, never a per-layer guess.
- **Glitter models** use direct-light rendering with a complete mask-worker result and no optical map bake. A generated candidate count is not a visible sparkle count. No Glitter model has a proven REDengine mapping, so game export of Glitter stays guarded.

## Saved-V preview inputs

- A captured saved-eye diffuse resolves only through the optional ignored local manifest, matching the exact app hash and definition plus a verified PNG digest. Switching to an unresolved choice resets to the reference map. Never distribute the extracted image as an app asset.
- Preload keeps save selection synchronous. Reload must restore everything, including an imported V.
