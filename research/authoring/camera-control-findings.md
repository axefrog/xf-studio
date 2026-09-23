# Camera controls: source and gesture findings

23 September 2026. Local Three.js 0.186.0 and the current studio were inspected; FOV/zoom changes are not implemented by this note.

## Pan is available

OrbitControls enables screen-space pan by default and maps the right mouse button to it. The studio does not disable it. Its surface editor only captures unmodified left-button control dragging, so right-drag can pan over the model without changing makeup. The viewport help now explicitly says **Right-drag to pan**.

Actual isolated browser gesture at 10° vertical FOV, 504×660 viewport: a 70×30 px right-drag changed camera and target by the same vector after damping settled, from camera `[0, 1.67, -1.195]` / target `[0, 1.67, .005]` to camera `[.0222698416, 1.6795442178, -1.195]` / target `[.0222698416, 1.6795442178, .005]`. Distance and orientation stayed unchanged. Reload restored the values exactly in diagnostics. No user draft was edited. This establishes the existing gesture; a visible touch/trackpad-friendly pan mode could still improve discoverability later.

## FOV/framing and distance limits

`scene.ts` fixes OrbitControls distance to 0.1–1.2 units, while Front view calculates a distance from FOV and viewport aspect before `controls.update()` clamps it. `workspace-state.ts` also accepts only approximately that range. A narrow FOV can require a farther camera than this ceiling to fit the head; merely changing the renderer limit would leave persistence inconsistent.

`setFov` currently changes only projection. To preserve projected scale **at the orbit target plane**, change camera-to-target distance by `tan(oldFov/2) / tan(newFov/2)` while retaining target and view direction. For example, 30°→10° multiplies distance by about 3.063. This is a dolly-zoom: depth perspective necessarily changes, and points away from the target plane cannot all retain exactly the same screen position. Panning makes preservation around the current target important.

Before implementing, choose coherent FOV-aware orbit bounds, persistence bounds and near/far clipping. At close views the target is inside the head; preserving only target-plane scale may not preserve the makeup surface scale well enough. A surface-depth anchor or inspected face plane may be preferable. Do not simply drive the camera into the face or enable arbitrary projection zoom without a clear control model.

The reported **zoom-in** restriction has not yet been reproduced to a specific clamp/clip condition. The verified maximum-distance problem concerns zoom-out/framing and must not be mislabeled as that report’s full cause. Inspect the actual minimum-distance view and camera-to-surface depth at narrow FOV, then test a close editing view without clipping. Re-run the matte-depth comparison if clip policy changes.

## Source credit

[Three.js OrbitControls](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/controls/OrbitControls.js), local installed 0.186.0, by mrdoob and contributors. Read `enablePan`, `screenSpacePanning`, `mouseButtons`, `_pan`, `_clampDistance` and zoom handling. This is source learning and existing dependency use; no upstream implementation was copied. See the central community credit record.
