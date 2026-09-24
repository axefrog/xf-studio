# Bezier handles across eye openings

23 September 2026. Reported defect: a Bezier handle cannot be dragged over the eyeball.

## Reproduced cause

In the isolated saved-V browser workspace, incoming tangent on knot 6 was dragged from approximately (515,355) toward (530,376). It stopped at (518.62,360.40), with UV (0.3972911,0.2497602). Instrumentation reported `no-front-plate-hit` at the requested destination. Removing the eye occluder alone produced the same stop. This demonstrated a surface-ray limitation, not merely an eyeball depth check.

The previous implementation treated a tangent endpoint like a painted surface point. It required an eye-plate triangle both beneath the handle and beneath every drag position, and clipped movement to continuous plate UV coverage. A curve direction control has no such requirement: its endpoint can legitimately cross an eye opening while the parent contour point remains on the head.

## Interaction contract

Bezier arms use a local plane derived from the actual deformed triangle at their parent knot. The triangle's UV-to-world derivatives project the arm; ray-plane inversion converts dragging back into the same serialized UV tangent vector. The projected endpoint is explicitly UI geometry, never a fabricated mesh anchor. Deformation and mirrored UV islands use the same parent triangle data; geometric winding controls front-facing checks independently of UV handedness.

Projected handles and connectors can draw over the eyeball. Their real parent must face the camera and remain visible against the head and eyes. Missing parent anchors, degenerate UV/deformed triangles and grazing ray-plane intersections stop interaction safely; UV editing remains available. Actual contour knots, warp controls, curve outlines and painted-shape gestures retain their surface/occlusion rules.

Both arms share parent calculations within a frame. The projection retains click offset, mirrored vector editing, existing Smooth/Symmetric/Corner semantics, one Undo checkpoint per gesture, Escape cancellation and stale-target rejection. No portable recipe schema or material changes are needed.

## Evidence

Final checkpoint: 175 tests / 529,657 assertions across 42 files, typecheck/build pass. Browser tests used the isolated verification workspace, leaving the working draft untouched.

The real-head gesture now reaches (530.21,376.11), releases and re-grabs to reach (540.21,381.11), with no rejection. Escape restores the exact pre-gesture recipe; two Undo operations restore the original recipe after the two completed drags. The same gesture was repeated after the visibility optimization, again reaching the requested eye-overlap position and remaining selectable. No browser console warnings/errors were observed.

The first correct mapping used two full skinned-head raycasts per frame and regressed a paused preview from 16.7 ms median frame interval to 49.9 ms. CPU profiling identified repeated vertex deformation. The replacement caches exact world-space deformed vertices, refits a triangle hierarchy only when pose/geometry changes and tests parent rays against that hierarchy. It does not modify renderer meshes or truncate skin influences. Paused and animated browser runs returned to 16.7 ms median / 16.8 ms 95th percentile over 60 frames. These are observed cadence checks on this machine, not a universal performance guarantee.

Independent parity tests compare 96 near-threshold occlusion decisions on the local real head across rest, morph and bone poses: zero mismatches against the original raycaster, with all eight skin influences retained. Synthetic tests cover material sidedness, mirrored UVs, negative world scale, draw groups/ranges, pose/geometry cache invalidation, singular/grazing projection, genuine plate holes and unchanged actual-knot constraints. [Checkpoint evidence](../../projects/xf-studio/authoring/evidence/projected-tangents-2026-09-23.json).

## Provenance

This is project-authored interaction/mapping code using existing Three.js ray/vector and deformed-vertex facilities. The already credited CDPR-derived head/plate and saved-V assets supplied the local reproduction; no new external implementation or game asset is redistributed.
