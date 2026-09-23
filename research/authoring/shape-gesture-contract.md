# Whole-shape gestures — 23 September 2026

The active layer's painted footprint can be dragged in UV or on the head. Existing point, tangent and warp handles retain priority for an ordinary drag. Shift-drag rotates about the selected contour point; Shift-wheel scales about that same point. The pivot stays selected even when the gesture starts on another handle. Surface controls must be enabled for on-head editing. Background drag still orbits the head; right-drag still pans the camera.

UV wheel zooms around the pointer and right-drag pans the crop. These are view operations: they preserve the recipe, Undo history and camera, and survive reload. View limits are centre coordinates -1 to 2 and span 0.02 to 10 UV units; pointer anchoring is subject to those limits. Fit and the existing eye-view controls remain available.

## Transform semantics and API

`authoring/src/shape-transform.ts` exports presentation-independent `transformLayer(layer, command)`, `shapeHit(layer, uv)` and `wheelScaleFactor(deltaY, deltaMode)`. `ShapeTransform` accepts translation (`du`, `dv`), uniform scale (`pivot`, positive `factor`) and rotation (`pivot`, `radians`). `uv-view.ts` exports pure `panUVView` and `zoomUVView` alongside Fit/mapping functions. These are importable application capabilities, not remote script execution or a completed app-wide command registry.

Transforms move all contour knots and warp origins together, rotate/scale relative Bézier arms and warp vectors, and scale warp radii, edge softness and smooth pigment blend distances. IDs, pigment weights, modes, colours and finishes persist. Optical flake patterns remain defined by the material's atlas-space sampling; moving the mask is not a promise to rotate individual glitter flakes. Only the authored side is transformed; mirrored gestures are reflected into its coordinate system.

Invalid input or any output outside current recipe bounds rejects the entire proposal. Controls freeze at the last valid pose instead of independently clamping and distorting it. A warp origin or width can therefore limit a move before the visible outline reaches an atlas edge. Paint picking evaluates the shared warped coverage, with a 1% coverage threshold; a virtually invisible layer may need a handle or the UV scale gesture. The stronger of overlapping mirrored instances wins, with the authored side winning ties.

A drag uses its starting snapshot and adds one Undo entry when it actually changes. UV shape drags require four pixels of movement to avoid nudging during double-click insertion. Wheel events within 250 ms share one Undo entry. Escape cancels the active gesture; after a burst ends, use Undo. Cancellation never undoes edits in a replaced layer/preset. Pan cancellation restores the view without touching recipe history. The old immediate Shift-click point-relocation shortcut was removed because Shift now belongs to shape rotation.

## Surface lookup improvement

The UV triangle hierarchy in `surface-map.ts` filters lookup candidates while retaining original triangle order and the same barycentric/segment-clipping arithmetic. Triangle bounds include the existing relaxed edge tolerance. This preserves overlapping-island selection, tiny-gap rejection and deformation anchors. The index is built from the fixed UV atlas; poses continue using the original weighted anchors.

Differential tests compare indexed queries with the previous exhaustive candidate set: random/overlapping/outside-atlas triangles, relaxed edges, the actual 3,010-face plate, 3,000 plate query pairs and all plate UV vertices with small perturbations. One warm batch of 3,000 anchors took 0.89 ms indexed versus 78.49 ms exhaustive, with 1.018 candidates per query on average. These timings measure lookup, not total frame rate. Highly overlapping UVs can reduce the gain. Expensive extreme-curve raster jobs still need cancellation/recovery work.

## Verification

See [machine-readable checkpoint](../../projects/xf-appearance-studio/authoring/evidence/shape-gestures-2026-09-23.json). Tests cover transform covariance, fields/widths, mirrored adapters, bounds, no-op gestures, cancellation, stale contexts and view persistence. Isolated browser gestures verified movement/rotation/scaling on the real head, unchanged camera, grouped wheel Undo, UV navigation and exact recipe/view/preview reload. No installed mod or game launch was involved. This is project-authored geometry and gesture code using previously credited Three.js/Bun/SQLite facilities.
