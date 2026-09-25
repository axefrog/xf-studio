# Editor and recipe invariants

Consolidated 25 September 2026 from the dated checkpoint paragraphs that previously lived in `AGENTS.md`. Git history keeps the original wording. This page lists the rules that must survive every refactor. Detailed design and evidence stay in the linked contracts.

## Recipe schema versions

New recipes are created as **`xfs/recipe-7`** (`projects/xf-studio/authoring/src/recipe.ts`). Validation accepts `eye-artistry/recipe-1` and `xfs/recipe-2`…`xfs/recipe-10`. Older schemas migrate **on read** to the current in-memory form. Recipes 8–10 keep their own schema so their optical model stays pinned.

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

Rules:

- **Version the model whenever appearance changes.** Older recipes must keep their original look, so never silently upgrade existing pigment, softness, path or optical fields.
- **Never rewrite stored revisions.** Old SQLite revisions stay unchanged; migration happens on read only.
- **Share one evaluator.** Preview, PNG export, the raster worker and the compiler all use the same mask evaluator and adaptive Bézier tessellation. Raster bounds include every warp displacement and the maximum softness width.
- **Keep editor state out of portable recipes.** Field selection, UV view state and similar editor memory belong in editor/workspace state, not in the portable recipe.

## Layers, presets and collections

- Layers render bottom-to-top in recipe order and appear top-first in the UI. IDs survive rename and reorder. Do not reintroduce fixed four-layer assumptions.
- Presets are complete looks. `CollectionSession` owns preset switching without UI or network dependencies.
- SQLite v2 stores immutable collection and preset versions while preserving legacy look rows.
- Keep drafts, per-preset Undo and stable IDs through edits and imports.
- **Undo transactions track their own entry.** A gesture or form transaction keeps the identity of the Undo entry its checkpoint added (`AuthoringDocument.checkpoint()` returns it) and labels or discards only that entry, never by comparing depths. At `RECIPE_HISTORY_LIMIT` (80) a new entry displaces the oldest; discarding an empty transaction's entry, or undoing it, brings the displaced entry back.
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
- **UV wheel zoom and right-drag pan** change persistent view state only. UV controls draw in CSS coordinates at the actual pane size times DPR, and resizing preserves the view and pointer mapping.
- **Tangent arms and occlusion.** Tangent arms are projected vector UI on their parent knot's deformed triangle plane. They may cross eye holes and must never be labelled mesh anchors. Only these guides bypass endpoint depth, gated by the parent's front-facing visibility. Occlusion uses cached exact deformed geometry with dependency invalidation, because repeated per-frame skinned raycasts caused a measured regression. See [projected tangent controls](projected-tangent-controls.md).
- **Guide draw order.** Surface guides render after the transparent brow and lash cards while keeping opaque head and eye depth testing and far-side picking rejection. Do not disable all depth tests or physically lift guides.
- **SurfaceMap UV hierarchy** keeps original triangle-order winners and exact gap tests. Pose anchors are unchanged.
- **Idle controls.** Pause never uses the reset path. With both Head and Facial movement muted the idle stays enabled and keeps its phase. Phase-zero neutral-space camera normalisation stays consistent across subset changes and reloads.
- **Context menus.** Preserve native text-field context menus and suppress unhelpful browser menus elsewhere.

## Preview jobs and performance

- **Preview jobs.** Jobs snapshot recipes, yield cooperatively and acknowledge cancellation without publishing partial masks. Versions stay monotonic across preset resets, with one pending snapshot per layer. The active layer has priority without starving other layers. Worker recovery is lazy and never loops on a broken worker script.
- **Worker yields** use bounded MessageChannel/timer fairness, never microtask-only yielding. Cooperative work budgets count paired writes individually. The exact raster keeps the independent scalar coverage oracle, conservative pre/post-warp bounds, the original edge/tie arithmetic and power-of-two-only mirrored pixel reuse. See [raster performance](raster-performance.md).
- **Preview quality.** Settings (512/1K/2K/4K) are persistent preferences, independent of recipe, history and export. Disabled slots use 1 px placeholders. Failures stay visible until cancelled work is recovered, and stale layers are never reported as ready. See the [preview quality contract](preview-quality-contract.md).
- **Glitter models** use direct-light rendering with a complete mask-worker result and no optical map bake. A generated candidate count is not a visible sparkle count. No Glitter model has a proven REDengine mapping, so game export of Glitter stays guarded.

## Saved-V preview inputs

- A captured saved-eye diffuse resolves only through the optional ignored local manifest, matching the exact app hash and definition plus a verified PNG digest. Switching to an unresolved choice resets to the reference map. Never distribute the extracted image as an app asset.
- Preload keeps save selection synchronous. Reload must restore everything, including an imported V.
