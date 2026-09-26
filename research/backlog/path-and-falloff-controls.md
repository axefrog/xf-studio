# Path, falloff and surface-control requests

## Status (25 Sep 2026)

All of the 23 September path/falloff/surface requests are implemented and browser-verified offline. The default new recipe is `xfs/recipe-7` (see `projects/xf-studio/authoring/src/engines/layered-makeup/recipe.ts`); every earlier schema still migrates on read without changing saved looks.

| Request | State | Evidence |
|---|---|---|
| 1. Insert at the nearest path section (not after the selected point), incl. closing edge and mirrored side, one Undo | **Done** | [UV evidence](../../projects/xf-studio/authoring/evidence/uv-editor-2026-09-23.json) |
| 2. Single-eye UV mode (Both / Single / Other / Fit), persisted, recipe unchanged | **Done** | same |
| 3. Point-weight seam bug (nearest-segment strength switch) | **Done** — `xfs/recipe-4` continuous boundary blend; v1–v3 keep legacy rendering until the author opts in via *Smooth point gradients* | [evidence](../../projects/xf-studio/authoring/evidence/continuous-pigment-2026-09-23.json), [study](../authoring/continuous-weight-study.md) |
| 4. Bézier handles | **Done** — `xfs/recipe-5`; v1–v4 keep Catmull–Rom until explicitly converted | [evidence](../../projects/xf-studio/authoring/evidence/bezier-controls-2026-09-23.json) |
| 5. Corner points (Smooth / Symmetric / Corner) | **Done** — same checkpoint | same |
| 6. Directional/asymmetric falloff, separate from pigment strength | **Done** — `xfs/recipe-6` per-point edge softness | [contract](../authoring/directional-softness-contract.md) |
| 7. Surface handles visible above lashes/brows, picking agrees with display | **Done** for current preview details | [evidence](../../projects/xf-studio/authoring/evidence/surface-overlay-2026-09-23.json) |
| Bézier arms over the eyeball | **Done** — projected vector controls on the parent knot's plane; never labelled mesh anchors | [contract](../authoring/projected-tangent-controls.md) |
| Multiple warp fields (0–8 per layer, add/remove, mirrored, smooth additive) | **Done** — `xfs/recipe-3`, exact single-field parity on migration | [evidence](../../projects/xf-studio/authoring/evidence/multiwarp-2026-09-23.json) |
| Whole-shape drag, Shift-drag rotate, Shift-wheel scale; UV wheel zoom and right-drag pan | **Done** — pivot is the selected contour point; widths, warp radii/vectors scale with the shape | [contract](../authoring/shape-gesture-contract.md) |
| Cooperative raster cancellation and indexed UV surface lookup (for extreme handles) | **Done** — cancellation changes scheduling, not mask fidelity; the `SurfaceMap` UV hierarchy preserves original triangle-order winners | [scheduling evidence](../../projects/xf-studio/authoring/evidence/raster-scheduling-2026-09-23.json), [raster performance](../authoring/raster-performance.md), [shape-gesture contract](../authoring/shape-gesture-contract.md) |

### Open / known limits

- **On hold (by request, 23 Sep): addable softness-field anchors** with optional directional gradient handles (sharp wing tip, different upper/lower softness, interpolated field). Record the concept; do not implement unless the per-point softness controls prove insufficient. Any future design must budget interactive recomputation, cancel obsolete work and share export sampling.
- Tiny collapsed Bézier arms: proxy diamonds visually approach the knot on first movement.
- Extreme handles can still create thousands of segments; preparation and individual raster chunks are not preemptible, and main-thread surface-guide rebuilding for such recipes has not been re-measured. Do not claim every valid recipe edits interactively.
- Catmull–Rom insertion on legacy (v1–v4) layers can change neighbouring curvature; exact shape-preserving subdivision applies only to Bézier layers.
- Directional softness: narrow-edge coupling and subpixel antialiasing are documented limits.
- Strong warp fields can fold the mask; eight active fields cost more than one (measured).
- Zero pigment at a point does not erase all pigment there, because nearby targets blend (by design).
- Future **opaque** accessories may need a dedicated occlusion pass for surface guides.
- Surface-distance (rather than UV-distance) falloff and optional layer isolation remain open; see [authoring requests](eye-artistry-authoring.md#surface-editing-requirements).
- **Obsolete (dock UI):** the "remove the sidebar introduction" and "widened-sidebar blurry controls" items were sidebar-era; the DPR-aware UV canvas sizing that fixed the latter remains a requirement (UV controls draw at actual pane size × DPR).

## Invariants that still apply

- Keep shape, field and finish data separate. New curve or strength data needs explicit versioning and migration; never silently reshape or re-render an existing recipe.
- Preview, mask export and material compilation share one evaluator (tessellation, strength, softness, warp, raster bounds).
- Whole-shape transforms act on the authored side and reflect the result; reject a whole proposal atomically rather than clamping and deforming at an atlas edge. View navigation stays outside recipe history.
- Point pigment strength and edge softness remain distinct controls.
- Surface controls stay anchored to the animated/morphed surface; do not disable all depth tests or physically lift guides to fix transparent draw order. Picking must agree with what is displayed, including mirrored and rear-facing controls.
- Typed, UI-independent actions come before gestures (see the [action API requirement](claude-ui-overhaul.md#requirements-that-remain-binding-for-future-ui-work)).

## Multiple warp-field controls — requested 23 September

Done (see the status table). The original request: the mint circle/square handle is one Gaussian displacement field (circle = origin, square = vector endpoint, reach = radius); extend it to an editable set with independent origin, direction/magnitude and reach, add/remove, mirrored UV/surface handles, whole-gesture Undo and smooth blending, preserving single-field appearance on migration and using one evaluator for preview/export/compiler. The warp never deforms the head mesh; the white guide remains the unwarped contour.

Design history and the numeric seam reproduction: [path-and-falloff-design.md](../authoring/path-and-falloff-design.md); softness interpolation study: [softness-study](../../projects/xf-studio/authoring/tools/softness-study/README.md).
