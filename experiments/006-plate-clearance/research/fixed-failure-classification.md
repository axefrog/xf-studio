# Which failed shell constraints belong to hidden folds?

23 September 2026. **These are moving folds, not permanently hidden spare triangles.** Every one of the 40 distinct head faces incident to the ten certified failure vertices is front-facing and exposed at some point in the 73-pose sample. Deleting their plate counterparts permanently would remove observed visible makeup coverage.

There is nevertheless an important distinction between the two UV regions. The severe failures near U≈0.37 involve planes that are hidden during some of the poses establishing the failure certificate. The three failures near U≈0.57–0.58 have certificates composed entirely of exposed planes. Therefore **simply ignoring sampled-hidden planes cannot make the original 0.00005-margin, 0.00025-bound problem feasible**: those three unchanged certificates still reject it. This conclusion is checked at both 1e-7 and 1e-6 visibility tolerances.

## What was measured

[The diagnostic](classify_fixed_failures.py) reads the unchanged retained-weight build and the independently verified fixed-feasibility report. It constructs an opaque head-only Blender BVH for every preserved pose and casts rays to four strictly interior barycentric points per incident face from the existing five fixed views: front, ±30° horizontal and ±20° vertical. Visibility requires front-facing winding plus a first-hit depth within tolerance. Meshes are recentered before Blender's float32 queries. Existing synthetic ray/segment self-tests run first. Input hashes and the ignored detailed observations' digest are retained in [the metadata summary](fixed-failure-classification.json).

The 30 certificate entries below include repeated face/pose planes when shared by different vertices; they are not 30 unique faces. Sixteen entries are exposed at their certificate pose. The ordinary exposed-face-pose counts use 1e-6 tolerance. Eight vertex-associated face-pose classifications change at 1e-7, but none of the certificate-plane exposure classifications does. All 40 distinct faces are exposed somewhere at the stricter tolerance too (independently checked from the retained detailed observations).

| Head vertex | Exposed / sampled incident face-poses | Exposed certificate entries | Worst same-pose incident-normal dot product | Interpretation |
|---|---:|---:|---:|---|
| 266 | 509 / 511 | 1 / 2 | −0.99918 | Almost opposing closure fold; one certificate plane temporarily hidden |
| 275 | 501 / 511 | 1 / 4 | −0.99957 | Severe closure fold, mixed exposed/hidden certificate |
| 276 | 570 / 584 | 2 / 3 | −0.50443 | Cross-pose restriction, one temporarily hidden certificate plane |
| 277 | 351 / 365 | 0 / 4 | −0.99945 | All four certificate planes hidden at the relevant poses; faces visible elsewhere |
| 278 | 434 / 438 | 1 / 2 | −0.40380 | Same face changes exposure and orientation across the loop |
| 805 | 209 / 219 | 1 / 4 | −0.99899 | Severe folded region, mixed exposed/hidden certificate |
| 806 | 142 / 146 | 2 / 3 | −0.45130 | Same face hidden at frame 169 and exposed at frames 570/571 |
| 5631 | 431 / 438 | 3 / 3 | −0.91867 | Exposed certificate survives hidden-plane removal |
| 5981 | 438 / 438 | 2 / 2 | −0.94767 | Every tested incident face-pose exposed; both active planes at frame 490 |
| 6471 | 438 / 438 | 3 / 3 | −0.91723 | Every tested incident face-pose exposed; exposed cross-pose certificate |

These are triangle-normal comparisons, not smooth lighting-normal comparisons. A value approaching −1 means neighboring face planes nearly oppose one another. Exposure means *some sampled interior point is exposed in at least one view*; it does not say the whole triangle is visible or all planes are visible simultaneously from one camera.

Hidden active planes are generally blocked by other nearby head faces rather than solely a face sharing the failure vertex. The detailed certificate metadata identifies the actual first-hit face IDs. This matters: deleting only a vertex's immediate opposing plane from a solver does not account for the other head triangles that form the fold's outer surface.

## Connection to the existing contact study

The diagnostic also joins each incident head-face set to the already preserved, separate head-plus-plate contact visibility reports (both retained-weight offsets, frames 0 and 25). These joins must not be summed across vertices, because incident sets overlap.

- Vertex 278's incident head faces participate in **three exposed newly introduced non-adjacent pairs** for geometry/0.00005 at frame 25, and one for geometry/0.0001. This is not merely a set of hidden native self-intersections.
- Vertex 5631's incident faces participate in six exposed pairs at frame 0 and three at frame 25 for both offsets. It has a small margin shortfall, but existing exposed contacts remain relevant.
- Vertices 275, 277, 805 and 806 have no exposed joined contacts in those older two-frame cases. That limited result cannot override the new observation that their faces become exposed elsewhere in the loop.
- Vertex 5981 has no joined contacts in those two frames, while its active exposed certificate is at **frame 490**, outside that earlier visibility subset. This supplies a concrete missing pose for the next candidate's visibility checks.

## Next bounded experiment

Do **not** remove these faces, silently clamp their offsets, or re-run the same fixed shell after merely deleting hidden constraints. The exposed certificates already show that the latter fails at the original margin.

The next useful diagnostic is an explicit two-tier constraint benchmark, still without producing a release mesh:

1. Expand visibility sampling around the failure faces (more interior samples and viewpoints; include the active frame 490). Classify each *face/pose*, preserving all topology. Treat unresolved/borderline samples conservatively as exposed. This remains a heuristic exposure set, never a proof that omitted views are irrelevant.
2. Require a positive margin on exposed face/pose planes and nonnegative clearance on temporarily hidden incident planes. Compare positive margins **0.00005, 0.00004 and 0.000025** with the same **total 0.00025** displacement bound. These are diagnostic margins, not an approved change to the deliverable's clearance requirement. At 0.00005, the three exposed certificates provide a required negative control. The old full-set certificate bounds permit at most approximately 0.000049819, 0.000040431 and 0.000045990 at vertices 5631, 5981 and 6471 respectively; a 0.00004 trial is therefore informative but not guaranteed feasible.
3. Keep certificate verification independent. If even the reduced-margin, exposure-aware problem fails, record the active finite triangle regions and move to a **finite-surface distance/contact objective**, rather than infinite incident supporting planes. The current plane construction may reject displacements that clear the actual finite triangle, but an open head surface has no automatic global inside/outside sign; that replacement needs an explicit orientation/visibility policy.

Any promising field still needs the neighbor smoothness constraints, all-pose non-adjacent triangle contact checks, exposed-contact rays, 107 static morph checks, native skin-byte retention in both buffers, real import/round-trip and the eventual game-rendering comparison. Neither accepting a smaller geometric margin nor hiding a plane in one camera makes those checks optional. No candidate, master or game resource was modified by this study.

## Reproduction and provenance

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python experiments/006-plate-clearance/research/classify_fixed_failures.py
```

This is project-authored diagnostic code using the already credited Blender BVH/NumPy tooling, WolvenKit-derived geometry, and the Cyberpunk Blender IO Suite / Three.js sampled idle. There is no new external technique, asset source or copied implementation. The new contribution to the existing tool-use provenance entry is the 73-pose visibility classification of certified failure planes. Detailed geometry-related observations stay in the ignored build; tracked files contain code and summary metadata only.
