# XF Studio — authoring editor

A working local authoring experiment, built with Bun 1.4.2, TypeScript 7.0.2 and Three.js 0.186.0. Open [XF Studio](http://127.0.0.1:4317/) while the local server is running.

## Use

Run `bun install --frozen-lockfile`, then `bun start` from this directory. The server binds only to `127.0.0.1:4317`; set `PORT` if needed. It serves local files and a validated local look-library API; it cannot modify save games. Startup rebuilds the browser bundle; after editing source, run `bun run build` and reload the page.

- Select one of four layers, toggle its visibility, and drag its UV control points. Double-click to insert a point after the selected one; Remove point keeps at least three. The smooth outline is a closed Catmull–Rom curve.
- Point weight varies coverage near each part of the outline. Edge softness controls the signed-distance falloff. A mint handle controls a Gaussian vector field; drag its square to bend the sampled mask. Once the arrow has length, its round origin can be moved separately. Mirroring applies the same design and field to both sides.
- **Drag controls directly on the face.** Pink/white points edit the shared curve; mint handles edit field direction and origin. Either mirrored side updates the same shape. Surface controls can be hidden for an unobstructed preview. Drag empty space to orbit; scroll to zoom. A gesture makes one Undo step; Escape, pointer cancellation or window focus loss restores its starting recipe. Shift-click still relocates the selected point.
- Face handles and guides use UV triangle anchors, follow the current facial morphs and full skin weights, and update during blinking. Guides show the **control curve before field deformation**; the rendered makeup shows the resulting mask. Occluded/off-plate controls remain accessible in the UV view. Surface dragging stops at missing UV coverage or jumps above 0.06 UV per event; move back toward the last valid position to resume. The mapping does not yet resolve arbitrary overlapping UV islands in other meshes.
- The UV view is a fixed crop of the face atlas; arbitrary UV panning, multiple contours, holes, multiple fields, surface-distance falloff and layer isolation are future work. Field reach is currently adjusted with its slider, not a face ring.
- Colour and finish are independent of the shape mask. The seven finish families are **Matte, Satin, Shimmer / pearl, Metallic / foil, Glitter, Glossy / wet look and Colour-shifting**. Satin keeps internal `regular`; the old `satin` alias loads, and `metallic` retains its separate identity. Shimmer/glitter use experimental seeded facets; glossy uses clearcoat and colour shift uses thin-film iridescence. These are browser candidates, **not validated game finish mappings**. Specific duochrome/multichrome colour selection remains future work. See [finish definitions and evidence](../../../research/materials/makeup-finish-taxonomy.md) and [flake bakes](../../../experiments/002-flake-material/README.md). Orbit or move **Head & lighting → Key light angle** to inspect reflections.
- Enable **Character-creator idle** to play the extracted female close-up body clip with solved facial motion (mouth, eyelids and gaze). Disable it to restore the editing pose. The body and face loop independently; exact live game graph timing, wrinkle shading and scale-driven effects are not reproduced. See the [idle-system guide](../../../docs/idle-animation-guide.md) and [community solver credit](../../../docs/community-credits.md).
- Use the separate closure slider or Blink for the exploratory eyelid study when idle is off. That pose is synthesized from existing eyelid bones (44 in the head rig; 117 including accessory rigs); it is distinct from the decoded idle and is not calibrated across all 21 eye choices.
- Eyebrows and Eyelashes have independent visibility switches under Face details. The local reference styles are Arkhe Beautiful EYEBROWS II FULLER 18 and Soft Natural Eyelashes, identified from Nathan's save. Geometry and alpha textures are real; colours/shading are approximations. Other saves explicitly show these as reference styles unless their resource hash and definition match.
- **Look library:** enter a name and Save look to store the whole four-layer composition in SQLite. Opening an existing look lets Save look append a revision; Save a copy creates a separate ID. The menu only selects an entry; Open look loads it. Loading is undoable. Reload retains the working draft, selected entry, unfinished name and the revision originally opened/saved. Save look still checks that revision against the database; it cannot silently overwrite newer work. Reload does not fetch a library recipe over unsaved edits.
- Export recipe downloads editable JSON. Open recipe restores it and detaches from any library entry so the next Save look creates a new entry. **SQLite saves are explicit for now**. Browser workspace autosave retains the recipe and the last 80 Undo entries across reloads; no redo yet. Load V changes the preview head independently of the makeup recipe.
- Export mask downloads a 2048×2048 PNG: white RGB, coverage in alpha, full face UV0, top-left image origin. Disabled layers may still be exported intentionally. Colour is not baked into this reusable mask. The live preview uses 1024×1024 masks in a worker; rapid edits are coalesced and stale results discarded.
- **Load V from save** accepts a local `sav.dat`, entirely in the browser. It reads the appearance node and applies supported female facial morphs to the head, all four plates and corresponding accessory morphs. The card distinguishes applied face geometry, matching brow/lash reference resources, and unresolved skin, eye, hair and makeup resources. Decoded appearance choices now persist in the browser workspace and restore on reload, including any subsequent eye-shape override. No raw save bytes are retained or sent to the server. Export appearance data preserves decoded references; portable recipe files still store makeup only.
- **Field of view:** Head & lighting contains a 10–90° vertical FOV slider. Orbit/zoom and FOV are independently saved. FOV changes framing at the current camera position; moving the camera changes perspective. Match distance and viewport framing as well as lens angle when comparing photos. The game's displayed FOV convention has not yet been calibrated against this viewer.
- **Workspace restoration:** selected layer/point, recipe field values, imported V, camera orbit/target/distance, FOV, lighting, brows/lashes, wireframe, normal-map toggle, surface controls, blink/idle settings, lighting panel and scroll positions persist. Idle resumes its saved phase. Old recipe-only drafts migrate on first load; legacy storage is retained. A malformed/future workspace is preserved instead of silently overwritten, with a visible export/recovery message. Storage remains local to this browser/origin; it is distinct from the SQLite recipe library.

The desktop layout is the primary target. `?verify=1` uses a separate automatic-draft key for isolated UI verification. Do not test by editing Nathan's active draft.

## Actual asset intake

Derived locally from `F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend`; SHA-256 `c7a5fa8a90bcd4c45b78f85ad27b9f4a16056b370c664908bd7940adf3a6995d`.

`tools/export_preview.py` opens the original with scripts disabled, exports into `public/assets/`, and verifies its hash again without saving it. The head is `.009`, the deformable expanded plate `.010`, and eyes `submesh_01_LOD_1`. Both head and plate retain all 105 facial customization morphs. UV seams make the exported head 7,189 vertices versus 7,186 Blender vertices. Plate: 1,620 vertices / 3,010 triangles. See [asset manifest](evidence/asset-manifest.json) and [scene inspection](evidence/scene-inspection.json).

The original count of ten vertex-group memberships includes two non-bone selection groups (`TEMPORARY_EYE_MAKEUP_AREA`, `Group.002`). There are **eight actual bone influences**, exported as two JOINTS/WEIGHTS sets. Stock Three.js uses four and normalizes the first set while loading: the adapter restores original first-set weights from GLB, then includes both sets in position/normal shaders and CPU picking. No weight truncation is used. Shader modifications are deliberately pinned to Three 0.186.0 and must be rechecked on upgrades.

The separate static `.011` plate is now proven to be `.010` with the five saved facial shapes baked in. The deformation-preserving neutral master lives under the project's local `assets/authored/`; see [plate lineage](../../../research/eye-artistry/lineage.md). The Blender Displace modifier is omitted in this preview; each layer gets an explicit 0.00008-unit increment in the vertex shader and a browser render order. This does **not** prove that those offsets solve REDengine decal compositing. The UV guide uses source coordinates before vector warp, and GPU offset is not included in the tiny surface-picking displacement.

`UDIM_d/n/r.png` provide cropped 2048px head maps and the eye-colour tile. Source and output hashes are recorded. Hair, teeth, and the separate higher-detail eye-skin overlay have not been assembled. These reference assets stay ignored/local and are not a redistributable release.

Brow geometry comes from the vanilla resources named in the mod's ArchiveXL copy/patch declarations; the mod morph/mesh resources are partial stubs. Lashes are exported from their own complete morph/base mesh using an isolated copy of the mod archive. Brow morphs: 105; lash morphs: 21 eye shapes. Both retain two skin-weight sets. See [details manifest](evidence/details-manifest.json) and [assembly research](../../../research/eye-artistry/head-details.md). `tools/intake_details.ts` copies the already-extracted local inputs and records hashes. This is a specific reference assembly, not yet a general asset resolver.

## Material fidelity

The same source geometry/texture data is useful, but a REDengine `.mt` is not a WebGL shader. This first adapter uses MeshStandardMaterial for the head/details and MeshPhysicalMaterial for makeup, sRGB colour textures, linear roughness/normal textures, a provisional DirectX normal-Y sign, studio lighting and ACES tone mapping. Skin layering, wrinkles, subsurface scattering, eye refraction, game lighting and exact decal blending remain unresolved. Existing preview normals are attenuated to 0.35. Finishes are studies.

Next: trace skin/eye/mesh-decal parameters and channel packing from extracted authoritative resources; resolve the saved appearance hashes against the installed resource winners; add the missing eye overlay and attached parts; extract/calibrate true blink transforms. Compare a small material/pose matrix during one future game session. Do not ask Nathan to launch the game for each browser iteration.

## Implementation boundaries

- `src/recipe.ts`: versioned data, validation, deterministic curve/field/coverage evaluator. Mask output is independent of palette.
- `src/raster-worker.ts`: off-main-thread mask generation, also used for PNG baking.
- `src/scene.ts`, `src/skin.ts`: actual head/plate rendering, full influence skinning, morphs and exploratory pose.
- `src/idle-animation.ts`: composition of decoded body and offline-solved facial motion, independent loop clocks, world-bind transfer and exact reset.
- `src/surface-map.ts`, `src/surface-editor.ts`: triangle anchors, continuous UV coverage guard, deformed face handles, visibility checks and pointer gestures. Head/eyes occlude picking; transparent brow/lash textures are not used as opaque blockers.
- `src/save-reader.ts`: bounded, read-only CSAV/LZ4/appearance parser; no save writer. See [save import research](../../../research/eye-artistry/save-import.md).
- `src/workspace-state.ts`: versioned workspace validation, legacy-draft migration, camera/library/preview state and storage isolation. UI and renderer adapters apply its values.
- `src/main.ts`: editing, workspace autosave/restore, recipe import/export and UI.
- `tools/`: reproducible Blender intake and command-line save inspection.

This is project-local exploratory work that can later inform character rendering. It does not establish another general modding toolbox.

## Checks

`bun test` and `bun run check`. Tests cover malformed recipes, mirrored weighted fields, alpha boundaries, colour-independent masks, full skin weights, CPU skinning, binary bounds, LZ4 overlapping matches, strings and the private captured save where available. Asset tests require the local preview GLB; regenerate it with:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python tools/export_preview.py
```

The local save fixture is deliberately excluded from distribution. [Verification evidence](evidence/verification-2026-09-23.json) distinguishes browser/asset checks from absent game evidence.

[Surface editing verification](evidence/surface-editing-2026-09-23.json) records the earlier 17-test build and actual gestures. The expanded finish families have a [dedicated research task](../../../research/backlog/glitter-material.md); all game mappings remain provisional.

## Library storage

Ignored developer data: `data/library.sqlite`; isolated UI checks use `data/verification.sqlite`. Override the directory with `XFAS_DATA_DIR`. SQLite WAL files must remain with their database while running; for a simple manual backup, stop the server before copying the whole data directory. Production packaging will use a user-data location. Schema version 1 stores immutable recipe revisions with stable look IDs; future-version databases are rejected without modification. Revision browsing/restore, automated backup and DB autosave remain queued. Imported V and game assets are not stored in this recipe library.

Library API: GET/POST `/api/looks`, GET/PUT `/api/looks/<id>`; test namespace `/api/verification/looks`. Writes require same-origin JSON requests and validated recipes, with a 1 MB request limit. There is no arbitrary SQL/file-write API. The first [collection package fixture](../../../experiments/005-preset-collection/README.md) is verified offline; collection export UI and game validation remain pending. See [product direction](../data/product-direction.md).

Primary references: [Bun HTTP server](https://bun.com/docs/runtime/http/server), [Three GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [Three texture controls](https://threejs.org/docs/pages/Texture.html), [LZ4 block specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md). Save-format facts were checked against the local pinned WolvenKit source; its implementation is not copied wholesale or linked into the application.
