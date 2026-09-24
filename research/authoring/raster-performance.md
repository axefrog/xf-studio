# Exact makeup raster acceleration — 23 September 2026

Texture updates were reported to take 5–8 seconds, and a portable reference recipe was supplied. Its Backdrop has nine knots tessellated to 195 segments, mirrored coverage, a warp, nonuniform pigment, and nonuniform edge softness. The input remains local; it is not bundled as a default preset.

The previous raster evaluated both mirrored contours for every pixel in their combined bounds, including the empty gap between eyes. It integrated variable softness over every contour segment even when distance already guaranteed zero or full feather coverage. This repeated expensive square roots, logarithms and angles for irrelevant samples.

## Changes and preserved behavior

- Prepare edge geometry once, keeping the scalar evaluator's edge and tie order.
- Reject samples outside conservative bounds before and after warping. Bounds include every warp's possible displacement and outward floating-point padding.
- Skip the softness integral only when distance exceeds the maximum possible half-width. Pigment interpolation still runs where needed.
- For mirrored power-of-two textures, evaluate each pixel pair once. Pixel centres and their reflected coordinates are exact binary fractions at those sizes. Other resolutions retain independent sampling.
- Preserve bounded cooperative writes, including a pending partner when a one-pixel work slice splits a mirrored pair. Cancelled jobs never publish partial textures.
- Yield through three MessageChannel tasks followed by a timer fairness break. This avoids continuously nested timers without starving incoming cancellation on engines that favour one message port. Timer-only fallback remains available.

No curve simplification, lower resolution, field approximation, recipe migration or material change is involved. Public scalar `coverage()` remains unchanged as an independent test oracle. The shared raster benefits preview, mask export and compiler callers.

## Measurements

Same-machine Chrome synchronous worker benchmark of the supplied Backdrop at 2048²: **7,125 ms before, 955 ms after**. Both produce SHA-256 `1dc9372a511c20bea54eea3c287a27cc16b29e6b05266b94320b091b000a6dbe`. A Bun run measured 4,480 ms before and 624–674 ms after. Browser and Bun timings are separate measurements, not interchangeable estimates of interaction latency.

The final production worker completed the same texture in **971.5 ms** (972 ms round trip) with that same hash. A cancellation sent 30 ms into work was acknowledged 1.1 ms after sending, without publishing pixels. Through the actual isolated editor's pigment control, the completed 2K Backdrop reported **970.1 ms**. The user's live workspace was never changed; only `?verify=1` received the local test recipe. Full validation: **182 tests / 650,601 assertions**, TypeScript check and browser build pass.

Eight fixed synthetic 512/1K fixtures also retain their pre-change hashes. The complex 1K directional fixtures fell from 1,195–1,475 ms to 111–139 ms in Bun. Timing varies with engine, load and shape; complex nonsymmetric 4K fields still require substantial computation.

Reproduce with `bun tools/raster-performance.ts data/raster-after.json`; optionally append an absolute recipe path to benchmark its enabled layers at 1K/2K. Output records include layer inputs for local reproduction and must stay ignored when personal. Regression tests cover scalar-byte equivalence, frozen hashes, warps, crossed/degenerate curves, saturation boundaries, odd/even sizes and one-pixel slices.

Implementation is project-authored. No additional community technique or asset was imported for this optimization; existing Bun/TypeScript and browser dependencies support verification.
