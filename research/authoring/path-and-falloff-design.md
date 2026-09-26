# Shape paths, falloff and editing overlays

23 September 2026. Queued design/research, not a feature implementation. This note records source inspection and a deterministic numeric probe so the requested editing changes survive conversation history. No game launch, browser draft change or external source was used.

Follow-up checkpoints: the [continuous-strength study](continuous-weight-study.md) compares and measures replacement fields without changing production recipes. The surface-overlay draw-order correction is now implemented and [browser-verified](../../projects/xf-studio/authoring/evidence/surface-overlay-2026-09-23.json); the original orders described below record the diagnosed cause. The other path/falloff controls remain queued.

## Current behavior and its consequences

- [recipe.ts](../../projects/xf-studio/authoring/src/engines/layered-makeup/recipe.ts) stores a closed list of 3–24 `{u,v,weight}` points, one layer-wide `feather`, opacity, symmetry and a Gaussian displacement field. `curve()` is a uniform closed Catmull–Rom spline sampled ten times per segment; it interpolates weights linearly along each segment. It has no editable tangents.
- The same `raster()` supplies [the preview worker](../../projects/xf-studio/authoring/src/raster-worker.ts) and [flat material compilation](../../projects/xf-studio/authoring/src/engines/layered-makeup/preset-compiler.ts). A mask correction must therefore be shared, with explicit compatibility semantics; changing only the visual overlay would leave exports wrong.
- The sidebar shell's `main.ts` (since retired) `uv.ondblclick` inserts the raw clicked location **after the selected point**, regardless of the closest curve segment. This can introduce a crossing or a large excursion. New-point weight is always 1. It does not reflect a click on the mirrored side, whereas point dragging partly does.
- The UV viewport is a fixed crop `{u:.25,v:.17,w:.5,h:.215}` spanning both eyes. Only original-side point handles and field controls are drawn/selectable in this view; the mirrored outline is decorative. Point dragging folds `u>.5` only when symmetry is enabled, while field dragging does not. These differing conventions need one shared mapping before adding a single-eye view.
- [surface-editor.ts](../../projects/xf-studio/authoring/src/surface-editor.ts) already maps reflected handles back to the same source points, anchors them barycentrically to the deformed plate, rejects UV gaps, and supports gesture Undo/cancel. Its curve has six samples per segment, versus ten in the raster/UV view. Both guides deliberately show the control path **before** the displacement field, as the current UI states.

## 1. Insert on the nearest segment without changing the path

Two operations need distinct semantics: **insert a point on the existing curve**, and **move the curve toward a new location**. A double-click close to the curve should do the former. Subsequent dragging can change the shape intentionally.

Find the closest segment in display pixels, not just the nearest knot or the last selection. Return the original segment index and a parameter `t`; consider the closing segment and the mirrored view. Use coarse sampled candidates followed by a bounded one-dimensional refinement on each plausible cubic interval. Do not assume Newton iteration from one seed finds the nearest location on a looping curve. A screen-space threshold prevents a distant double-click from making an unexplained change.

For an explicitly stored cubic Bézier, split at `t` with repeated linear interpolation (de Casteljau): this exactly preserves its continuous geometric curve. Assign the new knot the interpolated attributes and select it; one Undo restores the previous path. Ignore or select the existing endpoint for near-zero/near-one `t` instead of adding near-duplicate knots.

Simply adding a Catmull–Rom knot—even at a point on its old curve—recomputes neighboring tangents and **does not preserve shape**. Therefore closest-segment placement alone satisfies the requested ordering correction but does not provide the proposed shape-preserving insertion. For shape preservation, implement the Bézier representation first or perform a clearly versioned conversion when insertion is first used. Preserve legacy appearance until conversion is requested or demonstrated equivalent.

Geometry preservation does not automatically prove identical pixels: splitting also changes where a fixed ten-samples-per-segment rasterizer samples. Compare both continuous curves and raster outputs. Prefer a deterministic adaptive tessellation with a defined UV/pixel error bound, shared by preview and compiler; record the small approximation difference rather than claiming byte-identical old masks without testing it.

## 2. Single-eye UV view and symmetry

Add a persisted **Both eyes / one eye** viewport mode; it changes the view, not the recipe. Establish anatomical versus screen-left naming from the actual atlas/mesh, rather than guessing from `u<.5`. A source-side single-eye crop can initially use the half of the existing region ending at `u=.5`, with padding and aspect-correct scaling. It must expose enough room to draw a wing beyond the current eye area; cropping should not silently clamp the shape to the current crop.

Use one invertible mapping for canvas rendering, pointer positions and all handle types:

- Canvas coordinate → atlas UV via current crop/zoom/pan.
- If the displayed instance is mirrored, source `u = 1 - displayed u`, source `v = displayed v`.
- Reflect horizontal tangent and vector components as `du → -du`; retain vertical components.
- Apply this equally to knot insertion, knot dragging, tangent handles, field origin/direction, hit testing and selected-point highlighting.

Reflection is involutive. Round-trip tests should recover the original source coordinate, and editing either displayed eye under symmetry must update the same knot. With symmetry disabled, do not silently fold coordinates or force both eyes equal. Keep the selected point stable when changing views, even when it is outside the new crop; provide fit-to-shape or an offscreen indicator.

The current mask uses `max(original coverage, reflected coverage)`. Preserve this contract for legacy inputs: it prevents doubled opacity at symmetry overlap, but is not equivalent to painting two independently composited strokes. Supporting truly independent eyes later requires explicit data semantics, not a viewport trick.

## 3. Confirmed nearest-segment weight discontinuity

`coverageAt()` first finds the closest sampled boundary segment. It then uses **only that segment's interpolated weight** for the entire sampled pixel, including deep inside the shape. The nearest segment can change abruptly across the interior's medial axis. Signed distance itself remains continuous, but the selected weight need not. Feather changes cannot generally fix this.

Deterministic reproduction, run with Bun against the actual current `coverage()` on 23 September 2026:

```ts
const l = initialRecipe().layers[0];
l.symmetry = false;
l.opacity = 1;
l.feather = .01;
l.field.du = l.field.dv = 0;
l.points = [
  {u:.3, v:.3, weight:0}, {u:.7, v:.3, weight:0},
  {u:.7, v:.7, weight:1}, {u:.3, v:.7, weight:1},
];
for (const e of [.01, .0001, .000001, .00000001]) {
  console.log(e, coverage(.5, .5-e, l), coverage(.5, .5+e, l));
}
```

All four rows returned **0 above and 1 below**. At exactly `(.5,.5)`, coverage was `0.47970910979806514`; the tessellated polygon contained 40 points. Thus a 0→1 alpha jump persists at just `2e-8` UV separation, away from the outside edge. This is a deterministic algorithm defect, not temporal shimmer or texture quantization. These values diagnose this fixture, not the exact shape being edited when the defect was reported.

A replacement needs a continuous pigment-strength field independent of whichever edge wins the distance test. Before choosing one, compare a small set of bounded smooth-field prototypes on this fixture, narrow wings, concavities, closely opposed edges and all-zero/all-one weights. A normalized smooth kernel interpolation is a small first prototype; it must document that controls blend rather than promising exact interpolation at every knot. A harmonic extension of boundary values is an alternative if exact boundary conditions become necessary, but adds solve/domain complexity. Do not add a large field framework before these cases show a need.

Requirements: finite alpha in `[0,1]`, no winner-switch jump, unchanged uniform-weight behavior, no dependency on point order/start index, and stable preview/export agreement. Nearest-segment tie-breaking or extra antialiasing would only conceal the underlying discontinuity.

## 4. Cubic handles and legacy migration

Recommended editable knot data: position, incoming and outgoing handle vectors, a handle relationship mode, pigment strength, and separately defined edge-softness attributes. Keep selected knots/handles separate from layer IDs and transient array positions where needed. The current 24-knot limit can remain an operational cap until performance is measured.

Use familiar explicit handle semantics:

- **Smooth/aligned:** opposite collinear tangents, independently adjustable lengths; geometric tangent continuity without requiring equal speed.
- **Symmetric:** opposite collinear tangents with equal lengths; dragging one updates the other.
- **Corner/independent:** the two handles are decoupled and can point in unrelated directions; permits a deliberate sharp wing or cusp.
- An optional **automatic** mode recomputes tangents from neighboring knots. Do not secretly keep recomputing supposedly explicit handles after conversion or insertion.

The exact cubic conversion for an old segment from `b` to `c`, with neighbors `a,d`, is:

`B0=b, B1=b+(c-a)/6, B2=c-(d-b)/6, B3=c`.

This follows algebraically from the existing uniform Catmull–Rom polynomial. Adjacent endpoint derivatives agree before edits. It gives a path-preserving initial conversion; the existing linear weight parameter must also be retained or explicitly migrated. Handles can extend outside the `[0,1]` UV square even when all knots are inside it, so clamping handles to that square would alter legacy paths. Validate finite, bounded handle magnitudes separately from knot coordinates.

Use a new recipe revision or an explicitly discriminated path representation. Do not relabel changed weight/falloff semantics as the same `xfs/recipe-2` meaning. Keep old SQLite revision bytes unchanged; migration should produce a new editable revision. Tests need old recipe loading, full new serialization, Undo, collection round-trip, exact cubic evaluation before/after conversion/split and quantified raster approximation differences. No schema migration is implemented by this note.

## 5. Separate edge softness from pigment strength

The current `weight` multiplies opacity throughout the nearest segment's interior region. It is not an edge-width control. `feather` is one width for the entire layer. Its present smoothstep runs from zero to one across a band centered on the boundary: half outside and half inside. The outer nonzero extent is approximately `feather/2` before field deformation.

Keep these user concepts independent:

- **Pigment strength:** local opacity/amplitude inside an otherwise unchanged shape.
- **Edge softness:** distance over which coverage fades at a boundary location.
- **Directional/asymmetric falloff:** separate inward and outward distances, or a clearly defined anisotropic direction, rather than an ambiguous second weight.

A minimal first version can interpolate softness along each cubic edge, with shared endpoint values by default. At smooth joins, match endpoint widths and optionally their derivatives; corner geometry may be intentional, but alpha should not acquire an accidental seam. Define whether a sharp split in softness is allowed as an explicit corner property.

Do not replace the current nearest-segment weight with a nearest-segment softness lookup and assume continuity is solved: opposing boundary segments with different widths can produce the same winner-switch jump when their feather bands reach the medial axis. Extend width continuously into the region or blend competing contributions continuously with documented behavior. Require positive bounded widths, uniform-width parity and rotation/mirror covariance. A UV-directional effect should reflect with symmetry, not remain fixed to the screen.

The displacement field currently inverse-maps sample coordinates before distance evaluation. Decide and document whether width is measured in control UV, warped UV, or projected surface distance. Preserve the old convention for legacy masks; physical-width brush behavior would be a separate capability. Guides currently showing the pre-warp path should remain labelled until a reliable forward/inverse field visualization is implemented.

## 6. Handles above lashes, with consistent picking

Current source establishes a direct draw-order conflict: surface lines/points have orders **50/51**; brows/lashes render at **100/101** with transparency and `depthWrite:false`. The detail cards can therefore paint over editing handles after they have already drawn. The handles remain barycentrically anchored, and raising them physically farther from the skin is not the right first correction.

For the present renderer, the smallest candidate is a reserved editor-overlay order after makeup and context details, retaining `depthWrite:false` and head/eye depth testing. Since current lashes/brows do not write depth, this should put guides visibly above them while opaque head/eyes still occlude back-side controls. Verify in the actual browser before calling the explanation a rendered fix. If future detail materials write depth, use a deliberate overlay/occlusion policy rather than continually increasing physical offsets or disabling all depth testing.

Picking currently uses projected screen distance within 13 CSS px, then verifies plate UV at the handle center. Head and eyes are blockers; brows/lashes deliberately are not. Preserve that useful distinction and ensure drawn visibility agrees with pick eligibility. Do not make controls behind the head clickable just because they are overlays. At coincident handles, retain a deterministic priority, visible hover feedback and a way to select the alternate control; the current zero-length field prioritizes its endpoint.

Bezier tangents will add more handles than the current fixed buffer allocation (`24*2 + 4 = 52` points) allows. Size buffers from a validated budget rather than silently truncating them. Keep barycentric anchoring, all eight skin weights, per-frame morph/idle updates, UV-gap rejection, pointer capture, one-gesture Undo and Escape cancellation. Tangent handles may lie off the mesh; a projected editor overlay may represent them, but dragging an off-surface tangent must not pretend it has a valid skin anchor.

## Bounded implementation order and evidence

1. Correct guide ordering and validate visible/clickable controls at lashes, facial rotations and closed eyelids. This is independent of recipe migration.
2. Introduce a shared UV view mapping and persisted single-eye mode; test every existing handle type and reflection before adding new handles.
3. Implement a small pure cubic path module, explicit handle modes, versioned legacy conversion and exact segment splitting. Connect both editors to the same operations and Undo semantics; avoid parallel implementations in `main.ts` and `surface-editor.ts`.
4. Prototype and measure continuous strength/softness interpolation against the numeric defect and difficult shapes, then adopt a versioned mask contract shared by worker and compiler. Geometry controls and material finish remain separate.
5. Verify portable files, SQLite histories, presets, surface anchoring and shader-independent alpha maps offline, followed by isolated browser gestures. No game session is needed for these editing semantics; do not claim in-game finish parity from these checks.

These are queued tasks. Existing authored masks must remain recoverable; neither an automatic migration nor a new falloff implementation was introduced here. No new community attribution is required for this note: the evidence is our own local source and an executed probe, with mathematical deductions identified as design proposals.
