# XF Studio authoring requests

Scope expanded by Nathan on 2026-09-23: this is now XF Studio, with other appearance details and potentially full-body editing later. Continue the first makeup milestone while designing reusable surface, asset-resolution and material tools. All new archive appearance names use `xfs_`, including expanded mesh appearances; see the [naming contract](../../projects/xf-appearance-studio/data/naming.md).

Persistent user requests, 23 September 2026. Read this across context changes; conversation history is not the only record.

**Latest product decision:** [complete authored presets, SQLite library, one eye-makeup selector](../../projects/xf-appearance-studio/data/product-direction.md). First explicit SQLite save/open/copy/revision slice is implemented. Collection export, mixed-finish material compilation and one-selector runtime proof are next. Later features are ordered: piercings/earrings, eyebrows, cheek makeup, hair, facial expressions/custom idles, full-body tattoos. Discuss each with Nathan before building it. Desktop Electron/Electrobun assessment is [recorded](../authoring/desktop-packaging.md); no wrapper chosen yet.

| Priority | Requested outcome | Current state / acceptance criterion |
|---|---|---|
| FOV/persistence/reload fix implemented; eye/material work open | Modded eyes, adjustable FOV, all-state persistence, SSS/material fidelity, imported-V reload bug | [Detailed requirements, checkpoint and screenshot references](preview-fidelity.md). Imported V and preview controls now survive reload. Still resolve modded eye winners and diagnose eye/lip highlights rather than treating SSS as a universal fix. |
| Playback slice implemented; fidelity follow-up remains | Actual default character-creator idle animation, with on/off toggle | Female UI close-up body + IO Suite-solved facial clip now play together, including mouth, eyelids and separately rigged gaze. 387 preview bones mapped; on/off restores editing pose and leaves recipe intact. [Guide](../../docs/idle-animation-guide.md). Exact default animation-graph selection/synchronization, wrinkle shading and scale-driven effects remain to verify. Return primary focus to the preset compiler. |
| Later; discuss before editor work | Facial expressions and custom idle animations | Static/animated photo-mode expressions plus new varied idle animations; added before the full-body tattoo milestone. Early idle playback is authorized now, full authoring tools remain a later discussion. |
| Fidelity follow-up queued | Optional head details, especially brows, to judge makeup against | Saved Arkhe brows 18 and Soft Natural lashes render with independent toggles, morphs and exploratory blink. Colour/material approximation is labelled. Nathan supplied a game/studio comparison showing broader, lighter preview brows; investigate effective assets, alpha/shading and deformation, and resolve actual brow/lash colours. See the preview-fidelity queue. Skin/eye overlays, hair and other details remain. |
| First slice implemented | **Edit makeup live on the model surface** | Face curve points, pre-warp guides and field origin/direction handles now drag live on either mirrored side, following skinning/morphs/blink. One Undo per gesture, Escape cancellation, head/eye occlusion and UV gap guards implemented. Browser checks passed. Surface reach controls, layer isolation, arbitrary overlapping UVs and surface-distance falloff remain. |
| Next | Preview current V from a save | Whole appearance node read; five facial morphs applied. Assemble referenced mod/game resources with an explicit missing-assets report. Save import stays read-only/local. |
| Next | Configurable game/mod asset sources | Nathan clarified that non-vanilla save references likely come from installed mods/overrides. Resolve names/hashes against MO2 mods now; generalize to MO2, Vortex and manually managed `archive/pc/mod` for other users. Account for profile/deployment/load-order winners and ArchiveXL runtime transformations, not merely the first matching filename. |
| Next | Convincing materials and blinking | Real geometry/maps/full skin weights work. Material adaptation and synthesized blink remain exploratory; extract/calibrate authoritative parameters and motion. |
| Required | Familiar makeup finish families, including convincing glitter | [Seven-family taxonomy](../materials/makeup-finish-taxonomy.md): matte, satin, shimmer/pearl, metallic/foil, glitter, glossy/wet look, colour-shifting. Preview candidates exist; exact optical/game mapping and selectable duochrome/multichrome pigments remain research. [Material investigation](glitter-material.md) tracks this. |
| Later | Richer procedural tools | Multiple contours/holes and fields, weights/falloffs, tangent controls, symmetry, undo/redo, UV navigation, resolution/performance controls and an asset library. Prioritize from authoring sessions. |
| Not urgent; explicit request | Editable layer and preset collections | Add/remove makeup layers and drag to reorder. Above the layers, an accordion list of presets with add/remove, rename and reorder; NO preset dropdown. Editable layers are now implemented (0–32 preview budget), with stable IDs, add/copy/rename/remove, pointer reordering, up/down controls, empty stacks and Undo. Recipe-1 imports remain supported. Preset accordions, CRUD/order and SQLite collection snapshots are now implemented, with independent per-preset drafts/Undo and recoverable removal. Preserve stable IDs, selection, undo/recovery and explicit order through saving and export. |
| Later | Browser character rendering for other mods/users | Develop tested project-local pieces. Consume users' own game/mod assets and portable manifests; do not distribute reference dumps or build another all-in-one modding toolbox. |

## Surface-editing requirements

- Map UV anchors to barycentric positions on the current deformed plate, using the same full skin weights/morphs as rendering. Handles must follow blinking and eye-shape changes.
- Drag raycasts against the visible front surface; handle missed rays, occlusion, UV seams, symmetry and eyelid openings. Separate camera gestures from editing. No jumping onto the back of the mesh or across seams.
- Keep controls and field parameters non-destructive. Distinguish pre-warp handles from the resulting contour. Eventually evaluate spatial falloff using surface distance, not only UV distance.
- Provide readable selection/hover states and optional layer isolation. Desktop mouse/pen first.
- Verify poses, morph changes, undo, export agreement and off-surface dragging offline. Batch remaining game-fidelity comparisons.

Nathan explicitly permits replacing every old Eye Artistry design, name, preset identity and ID. The layered concept matters; the tools should enable a fresh collection. Saved legacy choices are references, not compatibility requirements.

Nathan supplied two current in-game V reference images; paths/hashes and appearance observations are saved in [save-import research](../eye-artistry/save-import.md#user-provided-visual-references). Use them for fidelity comparisons without treating photographed colours or apparent shape as exact resource parameters.

Related: [XF Appearance Studio](../../projects/xf-appearance-studio/authoring/README.md), [saved V](../eye-artistry/save-import.md), [CCXL research](ccxl-character-creator-capabilities.md).

Sidebar request implemented: both sidebars resize by pointer/keyboard and retain preferred widths across reload. Responsive limits keep preview space; narrow layouts retain both panels. Scrollbars are themed.

Latest detailed feedback: [seven path/falloff/surface-control requests](path-and-falloff-controls.md). Point weight currently controls nearest-edge strength, not directional softness; its seams require correction.
