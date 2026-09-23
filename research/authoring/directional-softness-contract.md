# Directional edge softness

Implemented 23 September 2026. Enable **Per-point edge softness**, select a contour point in the UV pane or on the head, and adjust **Selected point softness**. The width controls the fade around that part of the outline; pigment remains a separate control. Turning the option off restores the global edge width and retains custom point settings for reuse.

## Recipe and evaluation

`xfs/recipe-6` adds a required per-layer `softness` discriminator: `uniform`, or `boundary` with a positive blend distance. Boundary mode requires an absolute `feather` width on every point. Uniform mode may retain optional point widths without using them. V1–v5 migrate to uniform mode without changing their masks or rewriting immutable SQLite revisions. Ambiguous old-version payloads containing new fields are rejected.

Widths span 0.0005–0.06 control UV and describe the full centered fade band. The geometric outline remains at half local pigment coverage. Positive linear boundary integration uses an independent default regularizer of 0.0000078125 UV; validated serialized bounds are 0.0000001–0.001 to permit scaling. The default comes from the [measured study](../../projects/xf-appearance-studio/authoring/tools/softness-study/README.md); the broader bounds are operational limits, not a claim that every crossing/shape is visually ideal.

Width and distance use the same coordinates after inverse warping and reflection. Raster bounds use the largest point width. Constant point widths use the exact uniform arithmetic path. Catmull–Rom and Bézier samples interpolate widths linearly; splitting uses the original curve parameter. Equal-width interpolation stays exact and convex roundoff is bounded, preventing minimum/maximum widths from becoming invalid by one floating-point unit. Whole-shape scaling includes stored widths and the regularizer.

`editSoftness` exposes immutable `variable-softness`, `point-softness`, and `uniform-softness` commands. The presentation adapter delegates history, persistence and rendering to the application. The mask worker, PNG export and flat material compiler share the coverage evaluator.

## Evidence and limits

The integrated suite passes 141 tests / 493,326 assertions, including ten softness tests and two canvas-resolution tests. Independent review checked 1,998 minimum/maximum-width splits and 49,152 scalar/raster/compiler pixel comparisons. Browser evidence covers point selection, min/max edits, toggling with retained settings, Undo, reload, SQLite copy save and mask export. See [checkpoint evidence](../../projects/xf-appearance-studio/authoring/evidence/softness-and-uv-resolution-2026-09-23.json).

Widths are blended targets: a very soft opposing edge can influence a sharp edge in a narrow shape. This is disclosed in the UI. The study rejected log blending because it created an inward opacity ridge. Thin subpixel edges still need separate antialiasing work, and large complex curves still have finite computation cost despite cooperative cancellation. No game-rendering equivalence is claimed by the browser or offline tests.

## UV resolution correction

The old UV canvas always used 720 backing pixels across and became blurry when a larger sidebar stretched it. It now uses the pane's CSS dimensions multiplied by display pixel density. Controls, line widths and hit tests remain in CSS pixels; changing the backing resolution does not alter recipes or stored UV zoom/pan. An explicit CSS aspect ratio prevents the backing-buffer dimensions from changing the layout. Resize and display-density observers redraw without reallocating an unchanged buffer.

At emulated DPR 2, a 1191 × 859.609375 CSS-pixel pane produced a 2382 × 1719 buffer. Point selection/dragging and Undo worked at that density. Returning to DPR 1 restored a 661 × 477 buffer for the narrower pane with the same saved view. Enlarging the photographic or mask background may still reveal its source texture resolution; the path and controls are drawn freshly at display resolution.
