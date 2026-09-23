# Directional edge softness study

23 September 2026. Research-only prototype; no production recipes, masks or UI changed. Own mathematical experiments using the existing `preparePigmentStrength` implementation; no new external/community source was consulted.

## Recommendation

Use **linear positive width interpolation** for the first bounded prototype, with an independent small positive softness regularizer. Do **not** reuse the pigment blend default of 0.0005 UV. The best tested boundary fidelity is at **0.0000078125 UV**; recommend that as a provisional fixed default, with a research-backed allowed range **0.0000078125–0.001 UV** if an advanced blend control is needed. Existing feather bounds 0.0005–0.06 are a reasonable first width contract, but the contrast probes here use 0.001 versus 0.04. Width remains the *full centered fade-band distance*, measured before displacement in control UV. Keep it separate from pigment amount.

This recommendation is conditional: linear blending removes the discontinuity and is monotone on the tested edge normals, but it cannot make independently requested opposing widths coexist unchanged in very narrow shapes. Communicate these as blended boundary targets, not exact local widths. Retain an exact global-width path for old designs and uniform new widths. The study does not prove monotonicity for every possible self-intersecting or concave path.

Do **not** adopt log-width blending merely because it retains the sharper boundary better. It produces a visible non-monotonic opacity ridge even in a rectangular strip: moving inward from the sharp edge, opacity peaks and then falls by about **0.0609** before reaching the medial axis for a 0.004 UV gap. Reducing the regularizer does not remove this defect. If linear blending is visually too coupled for the intended designs, investigate a different continuous spatial construction instead of a nearest-edge winner or a concealed seam.

## Construction and semantics

`fields.ts` normalizes absolute per-boundary widths into [0,1], passes them through the positive arclength boundary integral, and decodes the result. Linear mode blends absolute widths; log mode blends logarithms and exponentiates. Query alpha is the existing centered smoothstep of `0.5 + signedDistance / interpolatedWidth`, multiplied by the independent pigment field and opacity.

Positive widths and positive regularization keep the field finite at conflicting crossings. At zero signed distance, alpha stays exactly half the pigment contribution, up to floating-point geometry error. Width blending does not displace the mathematical boundary. All query geometry in this study is unwarped; production must evaluate both distance and width after the same inverse displacement used today, scale width and regularizer with whole-shape scaling, and keep reflection covariant.

Linear interpolation on a straight boundary is subdivision invariant when inserted widths are linearly interpolated. Log mode instead requires geometric interpolation of inserted widths; linearly interpolating a newly inserted width in log mode changes the authored field. Bézier integration would need width tags interpolated at the actual cubic parameter and then the same adaptive polygon used for guides/compiler. This study verifies straight-segment subdivision, not production Bézier attribute migration.

## Quantified competing-edge influence

For a 0.6 UV long strip, sharp width target 0.001, opposite soft target 0.04:

| Gap | Regularizer | Linear width at sharp boundary | Log width at sharp boundary |
|---|---|---|---|
| 0.004 | 0.0005 (current pigment default) | 0.0052750: **5.275×** target | 0.0014983: **1.498×** |
| 0.004 | 0.000125 | 0.0021719: **2.172×** | 0.0011172: **1.117×** |
| 0.004 | 0.00003125 | 0.0012998: **1.300×** | 0.0010288: **1.029×** |
| 0.004 | 0.0000078125 | 0.0010754: **1.075×** | 0.0010072: **1.007×** |
| 0.001 | 0.0000078125 | 0.0013017: **1.302×** | 0.0010289: **1.029×** |
| 0.04 | 0.0000078125 | 0.0010070: **1.007×** | 0.0010007: **1.001×** |

At the 0.004 gap's center, symmetry of the boundary integral fixes linear width at 0.0205 and log width at sqrt(0.001×0.04)=0.0063246, independently of regularizer. The resulting alpha is 0.64448 (linear) or 0.91110 (log). The linear case never reaches 90% opacity before the midpoint: `transition10to90: null` is an absent crossing, not a failed numeric solve. A very soft opposing edge overlaps the entire narrow interior. There is no honest epsilon adjustment that removes this interior coupling.

## Verification and limitations

- Nearest-width evaluation jumps **0.42525037** across points separated by only 2e-8 UV at the 0.004 strip's medial axis. Smooth linear/log deltas are **1.339e-6 / 5.251e-6** at regularizer 0.000125, decreasing with sample separation. No arbitrary winner is substituted.
- Four uniform widths, two encodings and 19,800 actual petal queries per case match current production coverage exactly: **158,400 samples, zero numeric or alpha-byte differences**. These parity cases use uniform pigment; the proposed production fast path should route *all* uniform-width designs through current coverage rather than rely on an approximate reimplementation.
- Across thin/separated rectangles, a cornered square, concave U and a bow-tie crossing, positive fields stay bounded and finite. Maximum straight-subdivision width difference: **1.46e-16**. Rotation/reflection/reversal results are recorded separately in `results.json`.
- Boundary midpoint alpha differs from half the independent pigment contribution by at most **8.31e-14** in sampled edges, including crossings.
- Linear mode has no inward decreases in the sampled strip probes. Log mode falls by **0.0609** for the 0.004 strip and **0.0301** for the 0.001 strip at the proposed small regularizer. The isolated-width corner/concave checks cover **72 segment/mode/regularizer cases**; none decrease over the sampled normal interval from -0.02 outside to +0.01 inside. These are tests, not a general monotonicity theorem.
- The smoothstep/mask antialiasing limitation remains separate. Widths smaller than texture pixels and highly curved/crossing boundaries need the planned antialiasing work; decreasing this regularizer is not a substitute.

## CPU cost

Warm median of three, one authored side, no displacement, varying pigment plus varying width, sampling U=[0.25,0.5], V=[0.16,0.31]. Both fields are prepared once. This is a query-loop measurement, **not** complete production raster/worker timing; it excludes image allocation and does not skip width/strength work outside coverage.

| Geometry | Linear 1024 / 2048 | Log 1024 / 2048 |
|---|---|---|
| Six-knot petal, 170 adaptive edges | 338 / 1,370 ms | 347 / 1,453 ms |
| 24-knot legacy ellipse, 240 edges | 471 / 2,000 ms | 468 / 1,868 ms |

Both fields currently repeat the same arclength denominator and edge geometry work. A production implementation could accumulate pigment and width numerators in one traversal while retaining their independent positive blend radii. Pixel-distance loops and outside-band early-outs remain useful. Preserve exact uniform-width behavior and verify outputs before claiming performance gains. Worker cancellation/indexing work remains necessary for extreme valid curves.

## Reproduce

From the authoring directory:

```text
bun test tools/softness-study/fields.test.ts
bun run tools/softness-study/run.ts
```

The run writes `results.json`: 64 width/regularizer sweep cases, continuity, invariance, uniform-width parity, boundary constraints, strip normal scans, 72 additional corner/concave normal scans and timings. `normal-probes.ts` can refresh only the cheap additional normal scans. No game session is involved.
