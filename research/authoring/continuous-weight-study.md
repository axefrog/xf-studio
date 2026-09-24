# Continuous pigment strength: measured candidates

**Implementation follow-up:** the chosen positive boundary blend is now integrated in recipe-4 with explicit legacy preservation, user-controlled blend and Undo. See the [authoring guide](../../projects/xf-studio/authoring/README.md#continuous-point-pigment). The measurements below describe the original research checkpoint. The runner now explicitly selects legacy mode for its old-evaluator baselines so v4 defaults do not invalidate comparisons.

23 September 2026. Research prototype only: no production evaluator, recipe schema, library data, UI or compiled mask was changed. This follows the confirmed [nearest-edge seam](path-and-falloff-design.md#3-confirmed-nearest-segment-weight-discontinuity).

**Recommendation:** use a positive, regularized **arclength boundary integral** as the next versioned strength-field prototype. It blends boundary strengths continuously, respects geometric symmetry and does not change merely because an unchanged edge gets more control/sample points. Do not adopt an unweighted average over control points. Do not adopt an exact-boundary/unregularized variant without prohibiting ambiguous self-crossing paths. Keep `recipe-2` masks available unchanged.

This selects an algorithm for implementation/interaction trials, not a final approved visual look. The blend footprint needs a deliberate contract. A starting prototype of **0.0005 control-UV units** retains more local contrast than 0.002, but is not yet a user-validated default. It is pigment blending, separate from edge softness and global opacity. The recipe must carry the meaning explicitly; it must not depend on output resolution.

## Reproduce

From `projects/xf-studio/authoring`:

```powershell
bun test tools/weight-study/fields.test.ts
bun tools/weight-study/run.ts
```

Sources: [fields.ts](../../projects/xf-studio/authoring/tools/weight-study/fields.ts), [run.ts](../../projects/xf-studio/authoring/tools/weight-study/run.ts), [independent checks](../../projects/xf-studio/authoring/tools/weight-study/fields.test.ts). Numerical output is local/ignored at `authoring/data/weight-study/results.json`. Measurements used Bun 1.4.2 on an Intel Core Ultra 7 265KF. Four prototype tests pass, **11,923 assertions**. Results below are one executed run; timings are not a cross-machine performance promise.

Recorded result SHA-256: `39f01b4bd2041892f63a5d88803b0dac0785d6cbe27aa181c6f9476589fc65b7`. Rerunning includes fresh timings and therefore changes this identity. The later addition of exact `bufferBytes` metadata to the solver does not alter these recorded numerical results; the memory figures below are calculated from its typed-array dimensions.

No external source was used: the candidates were derived here from positive kernel averaging, line integration and the discrete Laplace equation, then compared against our existing evaluator. There is no new community code adaptation or asset reuse to credit.

## What was compared

1. **Point kernel:** normalize `sum(w_i / (distance_i² + epsilon²))` by the same sum without `w_i`. It is bounded and smooth for positive epsilon, but every additional sample has an additional vote. Uneven subdivision therefore changes the appearance.
2. **Boundary integral:** replace that point sum with an integral over boundary arclength. Integrate linearly varying strength on every polygon segment. Long segments contribute in proportion to their extent rather than their number of stored points. The integral is analytical, not sample-count-dependent quadrature.
3. **Boundary limit:** the same integral with epsilon zero, including its exact-boundary limit. Attractive for simple paths, unsafe for arbitrary self-crossings carrying inconsistent strengths.
4. **Harmonic grid reference:** solve the discrete Laplace equation on an isotropic grid, with nearest-boundary strengths on exterior nodes. Red/black SOR, residual tolerance `1e-8`, longest bounding dimension 144 cells. This is an intentionally bounded comparison, not a robust cut-cell/FEM solver. Bilinear lookup and a smooth exterior continuation supply the feather region. Thin boundaries are stair-stepped, not exactly reconstructed; convergence residual is not a bound on the domain-discretization error.
5. **Cached boundary field:** precompute the regularized integral on a 128×128-cell padded field and use bilinear lookup. This measures a possible optimization; the tested cache is not yet adaptive or appropriate for every epsilon/shape.

For a segment of length `L`, projection coordinate `t`, perpendicular distance `h` (including epsilon), and linearly varying strength `w(s)=a+b*s`:

```text
I0 = integral[0,L] 1 / ((s-t)^2+h^2) ds
   = atan2(L*h, h^2 + t*(t-L)) / h
I1 = integral[0,L] s / ((s-t)^2+h^2) ds
   = 0.5*log(((L-t)^2+h^2)/(t^2+h^2)) + t*I0
strength = sum(a*I0 + b*I1) / sum(I0)
```

The `atan2` form avoids subtracting nearly equal angles outside a segment. Zero-length segments are skipped. The zero-epsilon prototype additionally handles collinear exterior limits and exact-boundary points; these special branches are unnecessary when epsilon is strictly positive. The tests compare the analytical integral against **independent 20,000-bin midpoint quadrature per edge**, including a boundary sample and collinear exterior sample, with error below `2e-8`.

For finite geometry and positive epsilon the denominator is positive, each contribution is positive, and linear segment strengths remain within their endpoint bounds. Therefore the mathematical field is bounded, continuous and smooth everywhere. Floating-point results are clamped to `[0,1]`. The same positive normalized weights could blend a positive softness field later, but that does not settle the user-facing definition of inward/outward falloff.

## Measured evidence

Fixtures cover a square with opposite zero/full boundaries, a 0.17-UV long narrow wing, a concave U, a **0.004-UV wide strip with zero/full opposed edges**, and the actual initial Petal wash path with varying weights. The field measurements use 457–1,609 interior locations per fixture, with local regular-grid points so thin shapes are not missed by random sampling. The petal uses the actual production Catmull–Rom tessellation. Other fixtures are polygons deliberately chosen to isolate interpolation, not a claim about an actual authored preset.

At the old square seam, samples at `(.5,.5 ± 1e-8)` still differ by **1.0** using the current production evaluator. With epsilon 0.002, the point kernel, boundary integral and harmonic reference differ by about **5e-8**, decreasing proportionally as the sample separation shrinks. They eliminate that interior winner-switch discontinuity.

Splitting one unchanged straight edge into twelve pieces, assigning linearly interpolated strengths:

| Fixture | Point-kernel maximum change | Boundary-integral maximum change |
|---|---:|---:|
| Opposed square | 0.4803 | 2.3e-16 |
| Narrow wing | 0.2515 | 2.3e-16 |
| Concave U | 0.2585 | 2.3e-16 |
| Thin opposed strip | 0.4997 | 3.0e-15 |
| Actual petal polygon | 0.03388 | 3.4e-16 |

This is the main reason to reject naïve point kernels: adding a shape-preserving point must not materially repaint the layer. Arclength integration removes that representation-density bias. Reversal, start index and reflection should also not change the field; reversal and arbitrary rotation are exercised in assertions, reflection in the measurement runner. The largest rotation error for the regularized boundary integral across these fixtures was **1.4e-14**; reflection stayed within `1.2e-15`.

The harmonic reference was much less robust to rotating a thin shape relative to its grid. Its maximum rotated differences were 0.00513 for the square, 0.00088 for the wing, 0.01166 for the U, 0.00278 for the petal and **0.22111 for the thin strip**. The strip has only 143 unknown grid nodes. This is insufficient resolution, not a proof that a properly discretized harmonic solver cannot work. A reliable solver would need domain-aware boundary treatment and adaptive/resolution convergence evidence, adding complexity that this editor does not currently need.

Uniform strengths 0, 0.37 and 1 are retained by the regularized integral to floating-point precision. **All three full 1024² RGBA petal masks matched the current raster alpha bytes exactly**, with the same geometry, feather, opacity and symmetry, no displacement. The harmonic iterative reference left approximately `1.9e-7` uniform-field residuals; a production uniform-value fast path should bypass either interpolation implementation.

### Boundary exactness has a cost

Positive epsilon means nearby strengths blend, including at knots; a zero-strength knot beside a high-strength region is not guaranteed to become completely transparent. At epsilon 0.002 the boundary integral's maximum boundary errors were 0.01024 square, 0.04919 wing, 0.01807 U, 0.05762 petal and **0.32632 thin opposed strip**. That last result is unacceptable if the UI promises exact interpolation; it is explainable if the UI explicitly offers a blended pigment field.

The sweep quantifies the control:

| Epsilon, UV | Petal maximum knot difference | Narrow-wing maximum knot difference | Thin-strip maximum knot difference |
|---|---:|---:|---:|
| 0.000125 | 0.00648 | 0.00501 | 0.04973 |
| 0.00025 | 0.01158 | 0.00904 | 0.08526 |
| 0.0005 | 0.02032 | 0.01614 | 0.14160 |
| 0.001 | 0.03481 | 0.02842 | 0.22387 |
| 0.002 | 0.05762 | 0.04919 | 0.32632 |

Reducing epsilon makes local values more exact but permits sharper transitions and increases sampling demands; simply choosing an almost-zero constant is not a free solution. Very thin opposing 0/1 edges inherently request a steep gradient. Subpixel antialiasing must be evaluated separately from mathematical continuity, especially at crossings. This study does not claim every continuous field looks pleasantly soft.

At zero epsilon, the exact-boundary limit works for ordinary simple polygons but fails a currently representable bow-tie. One diagonal carries strength 0, the other 1; at the crossing a continuous field cannot satisfy both. In the prototype, exact center is 0 in one ordering and 1 after reversing it. Samples on the two diagonals remain 0 and 1 at `1e-8` from the center. Positive epsilon gives a center value 0.5 regardless of order, and at epsilon 0.0005 those near-crossing samples differ by only `2e-10`. **Do not ship the zero-epsilon option silently.** Either allow self-crossings with explicit blended semantics, or separately validate/restrict topology before offering exact boundary conditions.

### Geometry approximation remains a separate issue

Collinear subdivision invariance does not make different polygon approximations of a cubic identical. For the real petal, sampled field differences versus an 80-step-per-segment reference were 0.000949 with 10 steps, 0.000221 with 20, and 0.0000442 with 40, at epsilon 0.0005 and the runner's 1,500 deterministic points. These are field differences, not proven worst-case alpha bounds. Shared adaptive curve tessellation and attribute interpolation are still required for a Bézier split to preserve appearance within a defined error tolerance. Do not claim exact old-mask bytes after retessellation.

## Real raster cost

All timings include allocation/initialization of a full RGBA image and evaluation of the bounding region for the symmetric initial petal, with six knots/60 polygon edges and zero displacement. Each is the median of three warm runs; shader upload, rendering and worker scheduling are excluded. Candidate coverage uses the same signed-distance smoothstep and opacity, with an early-out where geometric coverage is zero. Thus this is end-to-end candidate CPU cost, not an isolated apples-to-apples transcendental-instruction comparison.

| One varied-strength layer | 1024² preview | 2048² export |
|---|---:|---:|
| Current production raster | 28.2 ms | 107.7 ms |
| Point kernel, epsilon 0.002 | 17.0 ms | 62.6 ms |
| Exact regularized boundary integral, epsilon 0.002 | 31.6 ms | 123.1 ms |
| Boundary limit, epsilon 0 | 32.9 ms | 127.5 ms |
| Cached 128-cell regularized boundary field | 38.1 ms | 83.3 ms |
| Harmonic 144-cell solve plus lookup | 32.0 ms | 101.7 ms |

The cache differs from the exact regularized result by at most one alpha byte on this fixture: 134 changed pixels at 1024² and 608 at 2048². It is slower for the preview because building it costs more than it saves; do not introduce it by default. The one-byte result is **not validated at the proposed smaller epsilon**, on the thin strip, or on self-crossings.

A separate 24-knot eye-sized oval, 240 tessellated edges, gave current/candidate times of **88.9/121.3 ms at 1024²** and **345.8/497.2 ms at 2048²** (candidate epsilon 0.0005). This is already noticeable for direct dragging. Thirty-two fully complex layers were not benchmarked; do not extrapolate these numbers into a responsiveness claim. Prefer unchanged-layer caching, latest-request cancellation, uniform-strength fast paths and bounded tessellation before adding a grid solver.

Definite buffer memory: every method allocates **4 MiB at 1024² / 16 MiB at 2048²** for its RGBA output. The direct integral allocates no additional image-sized field buffer; its edge records are ordinary JavaScript objects proportional to edge count (heap overhead not measured). The harmonic petal grid allocates **76,437 bytes** for 149×57 Float64 values plus Uint8 interior flags; the square/U grids allocate **199,809 bytes** for 149×149. The cached integral adds **133,128 bytes** for 129×129 Float64 samples. Harmonic exterior evaluation also retains its boundary-integral edge records. These are exact typed-array payload sizes, not total runtime heap/GC measurements. The comparison runner deliberately retains six output images at a time for numeric comparison; that test-harness retention is not part of a recommended production design.

## Integration decisions and remaining evidence

- Keep a legacy evaluator for existing `recipe-2` revisions. Introduce an explicit new strength-field contract with serialized, positive bounded blend footprint. Migration must be reversible through retained source/revisions; no silent rewrite of old SQLite data.
- Use the same pure field implementation for worker preview, PNG export and preset compilation. Evaluate it in the existing inverse-warped **control UV** coordinates, reflecting query coordinates with the layer. Do not switch to screen-space or output-pixel units during this repair.
- Compute arclength weights from the actual curve approximation, with continuous attributes along the path. The current nearest-boundary geometry query can still supply signed distance; it must no longer choose pigment strength.
- Separate pigment strength from edge softness in the UI. The new integral is a candidate for blending both, but directional inner/outer widths still need their own visual contract and tests. This research does not implement them.
- Preserve uniform-weight masks, include crossings/overlaps, zero-length edges, finite parameter limits, symmetry/rotation, curve splitting, serialization and displacement in production regression fixtures. The current prototype skips degenerate edges but does not accept a completely collapsed path as a valid production input; define that behavior explicitly.
- Before finalizing epsilon, compare alpha heatmaps and actual model interaction across feather widths, close opposing edges and deliberate corners; validate preview/export antialiasing. No browser or game rendering was performed for this numerical study.

The next bounded implementation choice is now grounded: **regularized boundary integration, not control-point averaging or a new harmonic solver**, behind new explicit recipe semantics. This keeps the mathematical seam fix independent from the broader handle/UI redesign while retaining the old appearance when requested.
