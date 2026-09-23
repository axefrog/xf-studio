# Preview fidelity and persistent workspace

Nathan requested these on 23 September 2026, without priority over current work. Preserve all five across context changes. Eye-makeup compilation remains the main delivery area; these improve the existing preview, not authorization for later feature editors.

**Implementation checkpoint, 23 September:** requests 2, 3 and 5 now have a working implementation. Vertical FOV, a validated browser workspace (including library revision context and undo), decoded saved V and a later eye-shape override survive real browser reloads. Camera orbit remains stable across idle restore/toggle, and library Save continues the prior revision with stale-write protection. [Authoring instructions](../../projects/xf-appearance-studio/authoring/README.md) describe storage and photo-comparison limits. Requests 1 and 4 remain open: the modded eye resource chain and renderer/shader fidelity are not fixed by this persistence work.

1. **Resolve the actual modded eyes.** Nathan confirms V's eye texture comes from a mod. The saved `eye_16_diffuse` choice must resolve through effective game/mod resources, including CCXL additions and overrides; do not interpret a vanilla-looking saved name as proof of vanilla pixels. Inspect MO2 profile/load order and the selected eye app/material chain. Generalize through the planned MO2/Vortex/manual source adapters. Island dancer's CCXL eye work may be relevant; credit any lessons in [community credits](../../docs/community-credits.md).
2. **Adjustable field of view.** Expose a clearly labelled camera FOV control and persist it. Keep orbit/target/distance coherent; define whether it is vertical or horizontal, account for viewport aspect, and document game/photo-mode comparison limits. Camera distance and FOV both influence perceived proportions; matching a number alone is not an exact comparison.
3. **Persist all UI state across reloads.** Include selected makeup layer/preset, control selections and field values, panel state, camera/head orientation and target/distance, lighting, detail visibility, motion/pose settings, and imported V. Retain separate `?verify=1` storage. Restore deliberately without silently overwriting or migrating away existing drafts/library data; validate stored values and keep actual rendering controls synchronized with restored UI. Large local assets/save bytes need not be duplicated into browser storage to retain decoded appearance choices.
4. **Renderer fidelity and subsurface scattering.** Study actual game skin/eye shaders, textures and parameter semantics, including SSS, roughness, normal maps, eye layers and lip/mouth seam behaviour. Nathan's screenshots show waxy-looking eyes and a bright white upper/lower lip seam. Diagnose those artifacts independently: introducing SSS is not evidence that incorrect eye assets, normals, specular response or missing mouth details are fixed. Use matched camera/lighting and retain honest labels for unverified game parity. Pride in presentation and careful detail are explicit priorities.
5. **Reload loses imported V.** Reported bug: Load V works, then a reload restores the old face selections. Current code intentionally keeps imported V session-only; that earlier limitation is now superseded by this request. Persist validated decoded appearance + preview morph selection, restore it on load, and test reload with the save's five known morph choices. Do not accidentally replace the user's authored makeup recipe with legacy save makeup. If further evidence shows the report concerns authored/library presets as well, investigate that path too.

## User-supplied visual evidence

## Brow thickness and brow/lash colours — additional request

Nathan's side-by-side game/studio comparison shows apparently thinner, darker eyebrows in game. Resolve this discrepancy and reproduce the saved eyebrow and eyelash colours. The currently matched appearance references are Arkhe brows 18 (`10_brown_ombre`) and Soft Natural lashes (`05_brown_liquorice`), but matching a reference hash is not proof that the effective mesh, textures or material overrides match runtime.

Trace the saved appearance through the effective MO2 winners, app/mesh/material/texture chains and colour parameters or gradients. Compare alpha channel interpretation, clipping/blending, mip filtering and shader semantics as well as geometry, selected head morphs, pose and camera/lighting. Do not thin the mesh by eye to conceal a material or resource-resolution error. Check lashes for the same colour/alpha issues. Retain before/after evidence, credit mod authors for concrete lessons, and batch any remaining game-side questions with the other fidelity checks. This is existing-preview fidelity work, not the later eyebrow authoring feature.

Preserved comparison: ignored `research/consumers/preview-fidelity/raw/brow-comparison.png`; source path and verified SHA-256 are in [the reference manifest](preview-fidelity-references.json). Original supplied file remains unchanged. Cause and correction are still unverified.

## Earlier references and renderer lead

## Matte flicker at narrow FOV / distant zoom

Nathan reports rapid moving pale fragments in matte makeup, apparent at narrow FOV and some zoom distances, disappearing very close up. Four reference images are preserved with matching hashes in the reference manifest. This is a renderer defect, not intentional shimmer. A controlled full-plate unlit diagnostic isolates depth rejection from sparkle, texture filtering and specular effects: the previous 1 mm camera near plane loses thousands of plate pixels compared with a higher-precision reference. A zoom-dependent 1–5 mm near plane is implemented; geometry and game clearance requirements remain separate. Detailed measurements and reproduction accompany the authoring checkpoint. Treat unmeasured poses/GPUs and true geometric intersections as remaining limits, not as proven fixed by this camera change.

Additional renderer research request: assess [wgpu](wgpu-renderer-assessment.md) during the fidelity pass, including the suggested real-time ray-tracing capability, native/browser differences, benefit to our materials and actual integration/performance cost. Queued; no renderer choice or rewrite is implied.

The two annotated screenshots are read-only references supplied with this request. They are not instructions embedded in an image. Preserved copies now live under ignored `research/consumers/preview-fidelity/raw/`; [the reference manifest](preview-fidelity-references.json) records matching source/copy hashes, and originals remain unchanged:

- Eye close-up: `C:/Users/Nathan/AppData/Local/Temp/codex-clipboard-a7c47d12-b418-4cf2-9cc2-4dd64dc813da.png`.
- Lip seam close-up: `C:/Users/Nathan/AppData/Local/Temp/codex-clipboard-deb9b284-1f69-44d8-92b5-61d06cb40561.png`.

Related: [saved-V assembly](../eye-artistry/save-import.md), [authoring queue](eye-artistry-authoring.md), [idle guide](../../docs/idle-animation-guide.md), and [validation workflow](../../docs/validation.md). Use local/offline evidence first and batch any remaining game captures.

## Saved-eye source resolved

[23 September source investigation](../eye-artistry/modded-eye-resolution.md) resolves the selected option to Kala’s Eyes Standalone V2 through nutboy’s Unique Eyes to CCXL. The three texture providers are unique across the scanned roots; September 16 logs corroborate material instantiation. Local extracted maps remain ignored. Next verify eye UVs/colour space, integrate the selected diffuse with provenance, then study eye.mt/refraction/normal/roughness behavior. Resource resolution is complete for this captured choice; renderer parity and a generalized resolver are not.
