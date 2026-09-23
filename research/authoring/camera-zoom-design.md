# Camera zoom and framing design investigation

23 September 2026. This is offline diagnosis and a proposed control model, **not an implemented camera change or reproduction of Nathan's exact mouse-wheel session**. It extends [the first camera findings](camera-control-findings.md). No browser workspace was changed.

## What the current code actually does

`scene.ts` uses a perspective camera, FOV 10–90°, OrbitControls distance 0.1–1.2, far plane 10, and the adaptive near plane capped at 0.005. Wheel zoom changes camera-to-target distance; it does not change FOV or camera projection `zoom`. OrbitControls applies the same multiplicative distance step regardless of FOV. `setFov` currently changes projection alone. Workspace validation independently rejects distances outside approximately 0.1–1.2.

The target starts at `[0, 1.67, .005]`, inside the head and below the eye centres. At small FOV, wheel zoom therefore converges on the nose until the view is panned. Surface editing captures only applicable left-button gestures; it does not intercept wheel or right-button pan.

## Measured geometry and projection

The installed `public/assets/head.glb`, SHA-256 `72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8`, was loaded with Three.js 0.186.0. Original first-set weights and the studio's full eight-influence CPU skinning were restored. Both head and plate were given the saved morph set `h091_eyes`, `h012_nose`, `h053_mouth`, `h054_jaw`, `h145_ear`; no idle or synthetic blink was applied. All 1,620 plate vertices were transformed to world space. This is the current preview plate, not a newly corrected experiment-006 release candidate.

Local reproduction inputs and full measurements are ignored under `projects/xf-appearance-studio/authoring/data/`: run `camera-zoom-study.ts`, then `camera-anchor-study.ts` with Bun from the authoring directory. The result is `camera-zoom-measurements.json`.

| Measurement | Result |
|---|---|
| Head world bounds | x ±0.09072; y 1.49242–1.79973; z −0.09103–0.12910 |
| Plate world bounds | x ±0.06490; y 1.66354–1.71871; z −0.07352–−0.00257 |
| Minimum orbit, frontal camera | position `[0, 1.67, −.095]`, distance .1 |
| Plate depth at that camera | .02148–.09243; every vertex beyond the .001 near plane |
| 10° FOV, 504×660, no pan | no plate vertices inside the frustum; an 11×11 ray grid hits head 121/121, plate 0/121 |
| Same camera translated to x .035 | lower-lid-centred grid hits plate 121/121 and head 121/121 |
| That lower-lid surface point | `[.035, 1.67, −.055860625]`, camera depth .039139375 |
| Visible plane span at that point, 10° | 5.23 mm wide × 6.85 mm high |
| Visible plane span at that point, 30° | 16.02 mm × 20.97 mm |

The minimum-distance clamp exists, but these measurements **do not support a special loss of close-up magnification at narrow FOV**. In this representative saved-V view the plate is well clear of the near plane and already magnified to a few millimetres across when panned onto the eye. The target/framing is a plausible contributor to the perceived limitation; Nathan's exact camera, pan, pose and wheel state are not known, so the reported zoom-in bug remains unproven rather than dismissed. The sampled ray grid is spatial evidence, not a rendered image or exhaustive pixel-coverage test.

The maximum-distance problem is separate and definite: at 10° the existing Front-view formula requests orbit distance 1.95083 for a 504×660 viewport, and 3.06968 for 320×660. Both are clamped to 1.2. This prevents full framing/zoom-out, not close zoom-in.

## Preserve the surface being edited when FOV changes

Multiplying orbit distance by `tan(oldFov/2) / tan(newFov/2)` preserves size on the **target plane**. The eye surface sits roughly .06 units in front of that plane; close views amplify the discrepancy. For the measured lower-lid point, 30°→10° at orbit distance .2 makes a small surface-plane patch **22.8% smaller** with target-only compensation. At distance .55 it becomes 7.7% smaller before any clamp. The current 1.2 maximum instead makes the latter patch 31.5% larger once clamped.

A coherent surface-anchored dolly uses:

```text
forward = normalized(target − camera)
depth = dot(anchor − camera, forward)
ratio = tan(oldFov / 2) / tan(newFov / 2)
camera' = camera + forward * depth * (1 − ratio)
target' = target
```

All points on the plane perpendicular to the view through `anchor` retain their projected position and scale. Orientation and pan stay unchanged. The actual face has depth, so perspective changes elsewhere are expected and desirable when comparing lenses. The equations do not promise that every head vertex retains its screen position.

Use a valid visible selected surface control as the authoring anchor when available, otherwise the nearest visible head/eye/plate hit around the viewport centre, with a documented head-plane fallback when looking at background. Include eyes in picking so a ray through an open eyelid does not accidentally anchor on the back of the skull. Capture one anchor plane for a continuous FOV gesture; do not chase an animated facial point each frame. Reject anchors behind the camera. Keep the pure projection calculation independent of DOM/rendering.

This example needs orbit distance .486999 for .2 / 30°→10°, or 1.558935 for .55 / 30°→10°. Both preserve the selected surface-plane scale exactly in arithmetic. These are design examples, not tested changes to OrbitControls.

## Distance, clipping and persistence must change together

Do not simply lower `minDistance`. A front camera at the existing minimum is already only about 4 mm ahead of the most forward head point. Other angles/pans/poses can encounter the head differently. A meaningful closer-editing model needs a surface-aware focus/pivot and clearance policy, with an actual pixel-size acceptance target. A separate magnification control could be valid, but silently mixing projection zoom with dolly while reporting only FOV would confuse photo comparisons.

Likewise, raising `maxDistance` alone would regress the matte flicker fix. Preserving a 1.2-distance, 90° view when changing to 10° needs approximately **13.0813** units at the measured surface, beyond today's far plane. At 13 units and near .005, a nominal 24-bit forward-depth buffer has roughly millimetre-scale depth steps, far greater than the .08 mm makeup separation. Even a 3-unit orbit can make the current cap inadequate. The previous 36-case depth study covers at most 1.2 units.

Recommended policy:

1. Define supported framing in terms of visible span at a surface/reference plane, plus camera clearance from the rendered head. FOV-aware distance bounds must admit the normal front view and required macro view for every supported viewport aspect.
2. Keep a valid camera outside relevant geometry when orbiting/dollying; calculate bounds from the current rendered geometry or a conservative envelope. A whole-head support plane is conservative at a panned eye but preferable to treating a fixed target radius as collision proof. A more permissive local policy requires explicit occlusion tests.
3. Derive near/far planes from projected bounds of **all rendered head details**, with margin for motion and close views. A farther camera permits a substantially farther near plane without clipping the head. Keep finite lower bounds and handle objects crossing the camera plane. This must be checked with the actual GPU matte-depth diagnostic, not only a depth-precision formula.
4. Persist valid camera/target/FOV and use the same exported limits in parser and renderer. Restore is direct, never a second FOV-compensation operation. Keep neutral-space idle framing offsets applied once.
5. Do not hide a safety clamp. If a requested FOV/frame combination cannot be preserved safely, preserve the user's authored data, expose that the frame changed, and define a recoverable Front view. Exact preservation has physical limits when a very wide lens would put the camera inside the face.

Native OrbitControls pan is measured against the target plane too. At the representative minimum-distance lower-lid view, target distance .1 versus surface depth .03914 means its plane-based pan distance is about 2.55× the surface's intuitive pixel mapping. Existing pan works and persists; a future surface-depth pivot would also make close-up pan feel more direct. Do not break the existing gesture while improving FOV.

## Meaningful implementation checks

- **Projection:** test independently projected points on a fixed plane, including off-centre points, across 10/30/60/90° pairs, arbitrary view directions, pans and portrait/landscape aspect ratios. Compare original and new NDC coordinates, not merely the computed distance. Round trips and a many-step slider path must not drift. Explicitly measure nonplanar residuals instead of requiring impossible whole-face invariance.
- **Close eye editing:** use actual plate geometry, saved-V and alternate eye shapes; pan onto upper/lower/outer-lid regions at 10°. Demonstrate increased rendered landmark separation through wheel steps until the documented macro limit, positive camera depth, valid pick/drag, and no near-plane holes. Record the clamp reached. Test with idle paused and moving. Include the unpanned nose view so off-screen eyes are not mistaken for clipping.
- **Front framing / zoom-out:** at 320×660, 504×660 and landscape, fit actual head/plate bounds with explicit margin at 10/30/90°. Verify no silent 1.2 clamp and no far clipping. Use both custom sidebar widths and window resize.
- **Pan and FOV together:** preserve a selected eye control's screen location through a FOV gesture after right-drag pan, then test continued orbit and wheel zoom. Verify damped motion does not inject residual translation into the compensated view.
- **Persistence:** reload unusual but valid near/far camera states, panned narrow-FOV views and idle modes. Compare the final camera/target/FOV and projected landmark locations, rather than only stored JSON. Test malformed or obsolete distance values separately.
- **Depth regression:** extend the existing red-head/green-plate GPU study to the new closest/farthest camera states and FOV/aspect/pose boundaries. Require nonempty, unclipped reference images, retain prior 36 cases, and inspect temporal frames at matte finish. Source math and serialization cannot prove absence of visible shimmer.

## Source learning / credit handoff

[Three.js OrbitControls r186](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/OrbitControls.js), mrdoob and contributors, installed package 0.186.0: `update`, `_clampDistance`, `_pan`, `_dollyIn`, `_dollyOut` and `zoomToCursor` establish the control semantics above. This extends the existing Three.js learning/dependency entry; no implementation was copied. The primary agent owns the central credit/status update at integration. Measurements use the already-provenanced local head/plate preview assets and studio skinning helper; no new community asset was imported.
