# XF Studio authoring requests

Persistent authoring requests (from 23 September 2026). Read this across context changes; conversation history is not the only record. Ranking lives in the [queue](README.md). All new archive appearance names use `xfs_`, including expanded mesh appearances; see the [naming contract](../../projects/xf-studio/data/naming.md).

## Status (25 Sep 2026)

**Product decision:** users author [complete presets, keep them in a local SQLite library and export a collection for ONE eye-makeup selector](../../projects/xf-studio/data/product-direction.md). Collection editing, portable export and an offline-verified Check/Build for Matte/Satin/Metallic work; the first in-game test is prepared but not run.

| Request | State |
|---|---|
| Editable layer and preset collections (add/remove/copy/rename/reorder, no preset dropdown, per-preset drafts and Undo, SQLite collection snapshots, stable IDs) | **Done** (`xfs/recipe-2` onwards, 0–32 layer preview budget; recipe-1 imports still supported) |
| Edit makeup live on the model surface (points, guides, field handles on either mirrored side, following skinning/morphs/blink; one Undo per gesture; Escape) | **Done** (first slice). Open: surface-distance falloff, optional layer isolation, arbitrary overlapping UVs, surface reach controls — see [surface-editing requirements](#surface-editing-requirements) |
| Richer procedural tools (Bézier/corners, multiple warp fields, continuous strength, directional softness, whole-shape transforms, UV navigation, preview resolution) | **Done** — see [path and falloff](path-and-falloff-controls.md). Open: multiple contours/holes per layer, asset library; prioritise from authoring sessions |
| Default character-creator idle with on/off toggle | **Done** (female UI close-up body + solved facial clip, 387 bones; pause and head/facial subsets). Open: exact live animation-graph selection/synchronisation, wrinkle shading, scale-driven effects. [Guide](../../docs/idle-animation-guide.md) |
| Modded eyes, FOV, all-state persistence, imported-V reload fix | Persistence/FOV/reload **done**; saved-eye diffuse **done**; eye/lip material fidelity **open** — see [preview fidelity](preview-fidelity.md) |
| Optional head details (brows, lashes, hair, piercings) to judge makeup against | Rendered with independent toggles, morphs and blink; **colours open** (track 2) — see [preview fidelity](preview-fidelity.md) |
| Preview current V from a save | Whole appearance node read; five facial morphs applied; eyes, brows, lashes, hair, piercings resolved for the captured save. **Open:** assemble all referenced resources with an explicit missing-assets report; save import stays read-only/local. See [CC controls](cc-controls-and-presets.md). |
| Configurable game/mod asset sources | **In progress.** Read-only [catalogue probe](../character-customization/catalog-prototype.md) and [source discovery](../authoring/source-discovery-foundation.md) separate MO2 and direct routes. Open: physical/payload winner resolution, Vortex/REDmod, ArchiveXL transformations. A source-derived candidate is not a measured runtime winner. |
| Convincing materials and blinking | **Open.** Material adaptation and synthesised blink remain exploratory; extract/calibrate authoritative parameters and motion (track 4). |
| Familiar makeup finish families incl. convincing glitter | **Open** — see [finishes and glitter](glitter-material.md) |
| Facial expressions and custom idle animations | **Later; discuss before building** (static/animated photo-mode expressions, varied idles) |
| Browser character rendering for other mods/users | **Later.** Tested project-local pieces consuming users' own game/mod assets and portable manifests; no reference dumps, no new all-in-one toolbox. |
| Desktop packaging | Electrobun trial functional; release/updater paused ([desktop packaging](../authoring/desktop-packaging.md)) |
| Resizable sidebars with persisted widths | **Obsolete** — replaced by the dock UI (`95516b2`) |

Later features, in order, each requiring discussion with the maintainer before building: piercings/earrings, eyebrows, cheek makeup, hair, facial expressions/custom idles, tattoos (full body), then full body customisation and world integration.

## Surface-editing requirements

- Map UV anchors to barycentric positions on the current deformed plate using the same full skin weights/morphs as rendering; handles follow blinking and eye-shape changes. *(Done.)*
- Drag raycasts against the visible front surface; handle missed rays, occlusion, UV seams, symmetry and eyelid openings. Separate camera gestures from editing. No jumping onto the back of the mesh or across seams. *(Done; keep the guards.)*
- Keep controls and field parameters non-destructive. Distinguish pre-warp handles from the resulting contour. **Open:** eventually evaluate spatial falloff using surface distance, not only UV distance.
- Readable selection/hover states *(done)* and **optional layer isolation (open)**. Desktop mouse/pen first.
- Verify poses, morph changes, Undo, export agreement and off-surface dragging offline; batch remaining game-fidelity comparisons.

## Content and references

Replacing every old Eye Artistry design, name, preset identity and ID is explicitly permitted. The layered concept matters; the tools should enable a fresh collection. Saved legacy choices are references, not compatibility requirements.

Two in-game V reference images were supplied; paths/hashes and observations are in [save-import research](../eye-artistry/save-import.md#user-provided-visual-references). Use them for fidelity comparisons without treating photographed colours or apparent shape as exact resource parameters.

Related: [XF Studio authoring README](../../projects/xf-studio/authoring/README.md), [saved V](../eye-artistry/save-import.md), [CCXL research](ccxl-character-creator-capabilities.md).
