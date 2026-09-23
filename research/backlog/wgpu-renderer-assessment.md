# wgpu for the rendering-fidelity pass

Requested by Nathan on 23 September 2026, to investigate when the renderer fidelity pass begins. Source lead: [gfx-rs/wgpu](https://github.com/gfx-rs/wgpu). Nathan heard it may support real-time ray tracing and explicitly described that as an unverified lead. Do not treat the suggestion as a requirement to migrate the renderer or as a confirmed cross-platform capability.

Initial README inspection only: upstream describes a Rust graphics API with native backends and browser WebGPU/WebGL2 paths. That makes native versus browser capability an explicit research question; it does not establish that the same ray-tracing functionality is available through each path. No clone, installation, renderer migration or performance measurement has been performed. Recheck a pinned stable release when undertaking the study rather than relying on a moving README.

## Questions and deliverable

- Establish hardware ray-query / acceleration-structure / ray-tracing-pipeline support separately, exact feature flags and backend support, maturity, hardware/driver requirements, and restrictions on browser/Wasm versus native Windows. Distinguish hardware ray tracing from software ray traversal implemented in compute shaders, and demonstrate any real-time claim on the actual target hardware.
- Compare three routes using the same head/assets/camera/light: improve the current Three.js renderer; a browser WebGPU route; a native wgpu renderer integrated with the chosen desktop shell. Include integration cost, shader work, presentation and input sharing, deployment, portability and fallbacks. Electron/Electrobun remain undecided.
- Evaluate visible benefits for skin subsurface scattering, eyes/cornea, lip seam, shadows/reflections, cosmetic glitter and mixed finishes. Correct asset/material interpretation remains necessary whichever renderer is chosen; tracing rays alone does not implement the game's materials.
- Keep the 105 customization morphs, all eight skin influences, animated facial/body rig, surface editing/picking, masks, transparency and user state working. Measure animation-geometry updates and acceleration-structure rebuild/refit cost, not just a static scene.
- Measure frame time, convergence/noise, denoising artifacts, memory, warm-up and responsive editing on representative hardware. Preserve a fast interactive fallback if a high-fidelity mode takes time to converge.
- Produce a recommendation supported by pinned primary documentation/source, a bounded comparative prototype where warranted, and explicit limits. Credit gfx-rs/wgpu contributors and any other learned community work in the provenance record.

This is queued under [preview fidelity](preview-fidelity.md), after the current plate/compiler work. It is research authorization, not an assumption that a rewrite is justified. Keep rendering adapters separate from authoring/domain logic so the later UI overhaul remains independent.
