# XF Studio — authoring editor

The local procedural eye-makeup editor for [XF Studio](../README.md), built with Bun 1.4.2, TypeScript 7.0.2 and Three.js 0.186.0. Users author complete presets from editable layers, save them in a local SQLite library and check or build a private mod candidate for **one** in-game eye-makeup selector.

**Current state (25 September 2026):** `/` opens the dock/panel Studio delivered on 24 September (`src/studio-main.ts`, `public/index.html`). The previous sidebar interface remains at `/legacy.html` until the new UI is accepted after in-depth review. New recipes use `xfs/recipe-7`. **Check mod export** and **Build mod files** work for Matte, Satin and Metallic, producing independently verified private candidates; unsupported layers are omitted and reported. None of these candidates has been tested in the game; a diagnostic MO2 profile is staged and the prepared [first runtime card](../../../research/authoring/first-makeup-runtime-preflight-2026-09-25.md) waits on the maintainer's game session. The [Studio-to-mod pipeline guide](../../../research/authoring/studio-to-mod-pipeline.md) illustrates the complete path from draft to private mod files.

## Quick start

From this directory:

```powershell
bun install --frozen-lockfile
bun start
```

Open [127.0.0.1:4317](http://127.0.0.1:4317/). The server binds only to `127.0.0.1:4317` (set `PORT` to change the port). It serves local files, a validated collection-library API, local settings and the package Check/Build route; it cannot modify save games. Startup rebuilds the browser bundle; after editing source, run `bun run build` and reload.

A fresh clone has no game-derived preview assets. Without them the Studio still opens: the head pane reports that the preview is unavailable, while the UV editor, Undo, library, mask export and package Check keep working and the status bar reads **UV masks** rather than **Preview**. To enable the 3D head from your own game, set the game folder and WolvenKit CLI in Local setup and run `bun tools/prepare-preview.ts` (or `POST /api/preview-core` with `{"action":"prepare"}`); the server then serves the derived head, plate, eyes and maps from the ignored `data/preview-cache/` (`XFS_PREVIEW_CORE_CACHE` relocates it) whenever `public/assets` has no prepared `head.glb`. The richer prepared assets described under [Actual asset intake](#actual-asset-intake) still win when present. The [desktop app](desktop/README.md#3d-preview-from-the-players-game-files-25-september) prepares the derived preview on first run.

On a new browser workspace, Studio starts an unsaved collection with one mirrored four-point matte area above the eye. Save to library to record its first revision. Existing workspaces and recipe-only drafts reopen with their original content; the historical four-layer recipe remains a test and reference fixture.

## Use

The [interface style guide](public/style-guide.html) (also served at `/style-guide.html`) is the authoritative reference for every interface pattern. The [delivery record](../../../research/authoring/ui-overhaul-2026-09-24.md) lists the audit, API extensions, acceptance evidence and remaining work.

### Workspace and panels

Everything is a dockable panel: **Presets**, **Layers**, **Library**, **Mod package**, **Head**, **UV map**, **Colour & finish**, **Shape**, **Pigment & edge**, **Warp**, **Character**, **Camera & light**, **Motion**, **Preview quality** and **Activity** (closed by default; the status bar opens it).

- **Default arrangement.** In wide windows (≥1100 px) the collection panels and layer stack sit on the left, the head fills a full-height centre column, and the UV map sits above a tabbed inspector group on the right. Compact windows put the head and UV map side by side on top and two tab groups below. Head and UV map are always visible together. Wide and compact windows keep separate saved arrangements; **Panels → Reset this layout** restores the current one.
- **Docking.** Drag a tab to move one panel, or a tab bar's empty area to move the whole group. The group under the **cursor** shows a compass: the centre adds a tab and the arrows split beside it; guides on each workspace edge dock full height or full width; release elsewhere to float. Drag a floating panel until the cursor enters another floating panel's edge band to join them into a magnetic composite. Hold Ctrl to float without snapping; Escape cancels. Each drag has a keyboard/menu equivalent on the tab's menu (right-click, Shift+F10 or ⋯).
- **Header.** The authoring-category menu (Eye makeup; later categories are listed as planned and each needs discussion before it is built), the collection/preset breadcrumb with its library chip, Undo, Save, Package (reveals Mod package), Commands, the Panels menu and the Theme menu.
- **Commands everywhere.** Ctrl+K opens the command palette, which lists every command and explains why an unavailable one is disabled. Right-click rows, points, handles, warps, shapes or empty viewport space for target commands (right-*drag* still pans). `?` lists shortcuts, including F2 rename, Ctrl+D duplicate, Alt+↑/↓ reorder, F (front view or fit shape), 1/2/O (UV modes) and F6 to move between regions. Native text-field context menus remain available.
- **Themes.** The Studio follows the system light/dark setting until you choose Light or Dark from the Theme menu or palette. The choice persists with the workspace, never in recipes or exports.
- **Status bar.** Reports browser autosave of the draft, recent activity, any gesture in progress (Esc cancels) and preview readiness (`Preview 1K · ready`, `updating` or `blocked`).

### Presets, layers and the library

- **Presets** are the named looks in the current collection; each becomes one choice in the game selector. Add, duplicate, rename, remove or reorder them. Switching retains each preset's unsaved recipe, selected layer/point and Undo history. **Restore removed** recovers the last removal (up to 20 retained), even after reload. An empty collection is editable but cannot be exported.
- **Layers** lists the current preset's stack front first; the top row renders in front. Add, duplicate, rename, hide, reset, reorder (drag, Alt+↑/↓ or the row menu) or remove layers. Undo restores structural edits, including removing the last layer. Empty compositions are supported; the preview budget is 32 layers per preset, independent of the eventual number of presets.
- **Saving.** Browser autosave keeps the draft and the last 80 Undo entries per preset. **Save to library** (Ctrl+S) records one atomic SQLite revision. The breadcrumb chip reports the library relationship (*Not in library*, *Based on rN*, *Newer rN saved*); a stale save offers *Refresh library* or *Save as copy* instead of overwriting another window's changes. **Save as new collection** starts a separate identity.
- **Library files.** Import or export a portable collection, export the compiler plan, import a recipe as a new preset, export the selected preset's recipe, or export the selected layer mask. Export collection and Export compiler plan save an immutable snapshot first; a compiler plan is an input to the offline compiler, not an installable mod. **Recover previous draft** walks through up to four recent collection drafts, including unsaved edits and per-preset Undo; the queue survives reload, and opening another collection warns before dropping its oldest draft.
- **Mask export** downloads a 2048×2048 PNG: white RGB, coverage in alpha, full face UV0, top-left origin. Disabled layers may be exported intentionally, and colour is not baked in.

### Editing a layer

- **Shape.** New and reset layers start as a compact, mirrored four-point wash above the eye, with no warp until you add one. Drag points in the UV map or directly on the head; double-click near a curve section to insert a point without changing the shape; Remove point keeps at least three. New layers use closed Bézier curves: select a point to show its gold tangent handles, then choose **Smooth** (aligned arms, independent lengths), **Symmetric** (equal opposite arms) or **Corner** (independent arms). Older shapes keep automatic Catmull–Rom curves until you choose **Enable Bézier handles**; Undo restores the original, and finer sampling can slightly change edge pixels. Handles outside the plate remain editable in UV, and Fit shape includes them. Very long or tangled handles can make preview generation slow. **Mirror across the face** applies the same design and warps to both sides; either mirrored set of controls edits the same recipe.
- **Tangent handles over the eyes.** Bézier arms may extend across eyeballs and plate openings. They are projected direction guides attached to their parent point, shown only while that parent is visible and facing the camera; actual outline points still follow the head surface.
- **Whole-shape gestures.** Drag the painted interior in UV or on the head to move the whole shape (existing handles take priority). Shift+drag rotates around the selected point; Shift+scroll scales around it, including warp reach and falloff widths. A move stops at the layer's limits without distorting individual points. Each drag or short wheel burst is one Undo entry; Escape cancels. On-head gestures require surface controls. [Gesture contract](../../../research/authoring/shape-gesture-contract.md).
- **UV map.** Choose Both eyes or Single eye (enlarged), Other eye to switch sides, and Fit shape to frame the curve and its handles. Scroll zooms around the pointer and right-drag pans; mode, side and crop persist without changing the design, and the crop stays fixed during a drag. UV paths and handles draw at the pane's actual size and display density.
- **Surface editing on the head.** Points, handles and warp controls use UV triangle anchors, follow the current facial morphs and full skin weights, and update during blinking. Guides show the control curve **before** warp deformation; the rendered makeup shows the resulting mask. Controls draw above the transparent brows/lashes while retaining opaque head/eye occlusion and far-side rejection. Occluded or off-plate controls stay reachable in the UV map. A drag stops at missing UV coverage or jumps above 0.06 UV per event; move back toward the last valid position to resume. One gesture is one Undo step; Escape, pointer cancellation or focus loss restores its start. Arbitrary overlapping UV islands in other meshes are not yet resolved.
- **Pigment & edge.** **Selected point pigment** sets a point's colour-strength target; **Point blend** softens differences between nearby targets; **Edge softness** controls the outline's signed-distance falloff independently. Enable **Per-point edge softness** to set **Selected point softness** per point; disabling it restores one global width while keeping stored widths. See [Continuous point pigment](#continuous-point-pigment) and the [directional-softness contract](../../../research/authoring/directional-softness-contract.md).
- **Warp.** Add up to eight smooth Gaussian pulls per layer. The circle moves the origin, the square sets direction and magnitude, and **Reach** sets the influence (the ring marks reach, not a hard cutoff). Pulls add smoothly where they overlap; a new zero-strength pull leaves the design unchanged. Selection survives layer/preset switches and reload. Strong overlapping pulls can fold the mask; this is not a rigid shape cage.
- **Colour & finish.** Colour, opacity and finish are independent of the shape mask. The seven finish families are **Matte, Satin, Shimmer / pearl, Metallic / foil, Glitter, Glossy / wet look and Colour-shifting**. Satin keeps the internal ID `regular` (the old `satin` alias loads) and Metallic keeps its separate identity. Only Matte, Satin and Metallic are currently exportable; the panel marks the others as preview studies omitted from mod packages. The browser finishes are candidates, **not validated game finish mappings**; see [finish definitions](../../../research/materials/makeup-finish-taxonomy.md) and the [finish research task](../../../research/backlog/glitter-material.md). Rotate **Key light angle** to inspect reflections.

### Glitter preview models

Glitter offers five browser preview models, selected per layer through **Glitter preview model**; each selection is undoable and shows only that model's settings. The local workspace remembers every model's settings for that layer while you compare them; portable recipes and SQLite revisions store only the selected model. Older recipes keep their original optical model and masks. None has a proven REDengine mapping or photographic match, and **game export still rejects Glitter**.

| Model | Recipe | Notes |
|---|---|---|
| Classic reflective flakes | any | Original seeded facets ([flake bakes](../../../experiments/002-flake-material/README.md)). |
| Irregular raster flakes | recipe-7 | Density, size, variation, orientation spread and flake colour independent of base pigment. Density is a share of generated candidate IDs, **not a visible flake count**. Dense settings are restricted to two fixed eye UV regions; 16 subpixel samples. At face distance most fine facets average into weak grain. A 4K candidate exceeds the 1 GiB generated-texture budget; use 2K or below. [Checkpoint](../../../research/materials/glitter-browser-checkpoint.md). |
| Direct-light glints | recipe-8 (`uv-cell-direct-1`) | UV-anchored fine polygons evaluated against preview lights in the shader over a worker-generated mask, so 1K and 2K look similar. [Evidence](../../../research/materials/direct-glint-browser-checkpoint.md). |
| Clustered fine glints | recipe-9 (`uv-cell-direct-2`) | Groups fine facets into soft patches with fewer oversized streaks. [Comparison](../../../research/materials/clustered-direct-glint-study.md). |
| Dense fine speckles | recipe-10 (`uv-cell-direct-3`) | Dense tiny facets over sparse larger flashes; about three times recipe-9's close-eye bright area in one fixed crop, but can look frosty. [Study](../../../research/materials/fine-speckle-browser-study.md). |

Switching a Glitter layer to another finish converts its flake settings to legacy values in one undoable edit. The standalone `/glitter-study.html` material study runs outside the editor and its draft.

### Head preview and character context

- **Head.** Drag empty space to orbit, right-drag to pan (the target moves with the camera and persists), scroll to zoom. **Front view** restores a useful frame; **Surface controls** and **Plate wireframe** toggle overlays.
- **Camera & light.** A 10–90° vertical **Field of view** slider, exposure, key light angle, preview normal map, surface controls, plate wireframe and a source eye roughness study. FOV changes keep the viewed face area's apparent scale within the 0.1–3.5 orbit range; pan an eye to the centre before a close lens change. At 10° Front view fits even a narrow pane. The game's displayed FOV convention is not calibrated against this viewer. [Camera measurements](../../../research/authoring/camera-zoom-design.md#implementation-checkpoint--24-september-2026).
- **Character.** **Load V from a save…** reads a local `sav.dat` entirely in the browser and applies supported female facial morphs to the head, plates and accessory morphs. The card separates applied face geometry, matched local detail meshes and unresolved resources. Decoded choices (and any later eye-shape override) persist in the workspace; no raw save bytes are retained or sent to the server. Export appearance data preserves decoded references; recipes store makeup only. The same panel holds **Eye shape**, **Eyebrows**, **Eyelashes**, **Saved V hair** and **Piercings** preview context (see [Preview context](#preview-context)).
- **Motion.** **Character-creator idle** plays the extracted female close-up body clip with solved facial motion (mouth, eyelids, gaze). **Pause idle** holds the expression without resetting. **Head movement** and **Facial movement** are independent; both off holds the editing pose with the phase retained. Disabling idle resets pose/time/pause but remembers the two choices. Body and face loop independently; exact live game graph timing, wrinkle shading and scale-driven effects are not reproduced. **Eyelid closure** and **Play blink** drive a separate synthetic study from existing eyelid bones (44 in the head rig; 117 including accessory rigs), not calibrated across all 21 eye choices. See the [idle guide](../../../docs/idle-animation-guide.md).
- **Preview quality.** Choose 512, 1K, 2K or 4K generated makeup textures; the choice persists independently of recipes, Undo and export. The last completed preview stays visible while replacements calculate; **Rebuild preview** retries failed work; capacity messages explain when to lower quality or disable layers. [Contract](../../../research/authoring/preview-quality-contract.md).
- **Workspace restoration.** Selections, field values, imported V, camera orbit/target/distance, FOV, lighting, detail toggles, wireframe, normal map, surface controls, idle/blink settings, panel layout and theme persist in browser storage and restore on reload; idle resumes its saved phase. Old recipe-only drafts migrate on first load. A malformed or future workspace is preserved with a visible export/recovery message rather than overwritten. This storage is local to the browser origin and separate from the SQLite library.

### Mod package

The **Mod package** panel runs **Check mod export** and **Build mod files…** against the current draft, including unsaved edits, without saving a SQLite revision. Check tests eligibility and names every active unsupported layer or whole preset that a package would omit. Build uses the same filtered package-only snapshot, leaves the authored collection unchanged, builds in isolated intermediates and promotes only independently verified files to a private candidate in ignored project `dist/` with a manifest. It does not install or game-test the files. The panel's **Local setup** section stores the game folder, WolvenKit CLI, optional Bun and the direct-or-MO2 source route (Build does not need Python); Build stays disabled until those inputs are ready, while Check needs none of them. The expanded eye plate needs no setting: Build cuts it from your installed game on first use and caches it privately ([how](../../../research/authoring/studio-to-mod-pipeline.md#where-the-eye-plate-comes-from)). See [local settings](LOCAL-SETTINGS.md) and the [local package workflow](../../../research/authoring/local-package-build.md).

## Verification workspace

Add `?verify=1` to any Studio URL (for example `http://127.0.0.1:4317/?verify=1`) for an isolated automatic draft and the separate `data/verification.sqlite` library under `/api/verification/collections`. The header shows **Verification workspace**. Always test UI changes here, never in the active working draft. The `tools/ui-acceptance.ts`, `ui-explore.ts`, `ui-layout-review.ts` and `ui-look.ts` scripts drive isolated browser reviews.

## Architecture

New work follows the [XF Studio architecture contract](../../../research/authoring/architecture-contract.md): domain/application services own validation, state transitions, Undo, persistence and async policy; device/renderer adapters own Three.js, canvas, workers, files and network; presentation talks only through typed actions, read-only snapshots and capabilities. The [boundary gap record](../../../research/authoring/ui-architecture-boundary.md), [action catalogue](../../../research/authoring/ui-action-catalogue.md) and [presentation-port acceptance](../../../research/authoring/ui-port-acceptance-2026-09-24.md) track what is migrated.

| Area | Modules |
|---|---|
| Composition and presentation | `studio-main.ts` (trusted composition root), `trusted-studio-bootstrap.ts`, `trusted-authoring-core.ts`, `studio-presentation.ts` (`StudioPresentationPort`), `studio-application.ts`, `studio-action-descriptors.ts`; `studio-ui/` (dock, panels, menus, palette, style guide) |
| Recipe and editing | `recipe.ts` (versioned data, validation, deterministic curve/field/coverage evaluator), `bezier-path.ts`, `path-edit.ts`, `shape-transform.ts`, `layer-stack.ts`, `pigment-strength.ts`, `pigment-edit.ts`, `softness-edit.ts`, `field-selection.ts`, `editor-actions.ts`, `authoring-document.ts` |
| Raster and preview | `raster-worker.ts`, `raster-processor.ts`, `raster-client.ts`, `layer-render-queue.ts`, `authoring-preview-coordinator.ts`, `preview-quality.ts`, `direct-glint.ts`, `flake-field.ts` |
| Renderer and surface | `scene.ts`, `skin.ts`, `makeup-stack.ts`, `surface-map.ts`, `surface-editor.ts`, `surface-occlusion.ts`, `surface-tangent.ts`, `uv-editor.ts`, `uv-view.ts`, `idle-animation.ts`, `camera-framing.ts`, `camera-depth.ts` |
| Collections and storage | `collection-workspace.ts`, `collection-session.ts`, `collection-service.ts`, `collection-store.ts`, `workspace-state.ts`, `workspace-persistence.ts` |
| Save and context | `save-reader.ts` (bounded read-only CSAV/LZ4 parser, no writer), `hair-preview.ts`, `piercing-preview.ts`, `eye-appearance.ts` |
| Package | `package-action.ts`, `package-filter.ts`, `package-preflight.ts`, `package-server.ts`, `package-result-verifier.ts`, `preset-compiler.ts`, `local-settings*.ts`, `runtime-diagnostic-stage.ts`, `runtime-diagnostic-promotion.ts`, `mod-install-transport.ts`, `framework-versions.ts` and `pe-version.ts` (read-only framework check), `mo2-placement.ts` (adds only our own MO2 row) |
| Legacy shell only | `main.ts`, `sidebar-ui.ts`, `layer-ui.ts`, `collection-ui.ts`, `reorder-ui.ts`, `field-ui.ts`, `pigment-ui.ts`, `softness-ui.ts`, `motion-ui.ts`, `preview-quality-ui.ts`, `path-ui.ts` |

Existing coupling in the legacy modules is migration debt, not precedent. `tools/` holds reproducible Blender/asset intake, validation and study scripts. This is project-local work that can later inform character rendering; it does not establish another general modding toolbox.

## Recipe versions

Portable recipes are versioned; older versions load and migrate in memory without changing their look, and stored SQLite revisions are never rewritten. New recipes start as `xfs/recipe-7`. Selecting a newer Glitter model upgrades that recipe to the model's schema.

| Schema | Introduced |
|---|---|
| `eye-artistry/recipe-1` | Historical fixed four-layer recipe with one warp `field` per layer |
| `xfs/recipe-2` | Editable ordered stacks of 0–32 layers with stable IDs |
| `xfs/recipe-3` | `fields` arrays of 0–8 additive Gaussian warps with stable per-layer IDs (single legacy `field` migrates with exact mask parity) |
| `xfs/recipe-4` | Per-layer pigment `strength`: `smooth-boundary` with blend 0.000125–0.02 (default 0.0005), or explicit `legacy-nearest` for migrated v1–v3 |
| `xfs/recipe-5` | Explicit `pathMode` and relative Bézier handles (aligned/symmetric/corner); v1–v4 keep Catmull–Rom until converted |
| `xfs/recipe-6` | Explicit edge `softness`: `uniform` or per-point `boundary` widths |
| `xfs/recipe-7` | Irregular raster Glitter settings; **current default for new recipes** |
| `xfs/recipe-8` | Direct-light Glitter (`uv-cell-direct-1`) |
| `xfs/recipe-9` | Clustered fine Glitter (`uv-cell-direct-2`) |
| `xfs/recipe-10` | Dense fine-speckle Glitter (`uv-cell-direct-3`) |

Older Studio builds cannot read newer schemas. The portable collection identifier `xfas/collection-1` and existing browser workspace keys remain unchanged for compatibility.

## Actual asset intake

Derived locally from `F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend`; SHA-256 `c7a5fa8a90bcd4c45b78f85ad27b9f4a16056b370c664908bd7940adf3a6995d`. All outputs below are ignored local files, not redistributable app assets.

`tools/export_preview.py` opens the original with scripts disabled, exports into `public/assets/`, and verifies its hash again without saving it:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python tools/export_preview.py
```

The head is `.009`, the deformable expanded plate `.010`, and eyes `submesh_01_LOD_1`. Both head and plate retain all 105 facial customization morphs. UV seams make the exported head 7,189 vertices versus 7,186 Blender vertices. Plate: 1,620 vertices / 3,010 triangles. See [asset manifest](evidence/asset-manifest.json) and [scene inspection](evidence/scene-inspection.json). `UDIM_d/n/r.png` provide cropped 2048px head maps and the eye-colour tile; source and output hashes are recorded.

The original ten vertex-group memberships include two non-bone selection groups (`TEMPORARY_EYE_MAKEUP_AREA`, `Group.002`). There are **eight actual bone influences**, exported as two JOINTS/WEIGHTS sets. Stock Three.js uses four and normalizes the first set while loading: the adapter restores original first-set weights from GLB, then includes both sets in position/normal shaders and CPU picking. No weight truncation is used. Shader modifications are deliberately pinned to Three 0.186.0 and must be rechecked on upgrades.

The separate static `.011` plate is `.010` with the five saved facial shapes baked in. The deformation-preserving neutral master lives under the project's local `assets/authored/`; see [plate lineage](../../../research/eye-artistry/lineage.md). The Blender Displace modifier is omitted in this preview; all layers use the same explicit 0.00008-unit surface offset with ordered transparent drawing. This does **not** prove that those offsets solve REDengine decal compositing. The UV guide uses source coordinates before vector warp, and GPU offset is not included in the tiny surface-picking displacement.

Optional preview-context intake scripts (each verifies known hashes and writes only ignored local assets):

- **Brows and lashes:** `tools/intake_details.ts` copies already-extracted inputs and records hashes. Brow geometry comes from the vanilla resources named in the mod's ArchiveXL copy/patch declarations (the mod morph/mesh resources are partial stubs); lashes come from their own complete morph/base mesh using an isolated copy of the mod archive. Brow morphs: 105; lash morphs: 21 eye shapes; both retain two skin-weight sets. [Details manifest](evidence/details-manifest.json), [assembly research](../../../research/eye-artistry/head-details.md). This is a specific reference assembly, not a general asset resolver.
- **Saved V hair:** `bun tools/intake_hair.ts <source-directory>` with the two converted GLBs, `hair_lm60_a.png`, `hair_lm60_id.png`, `hair_lm60_grad.png`, `hh_110_wa__wizzy_cap_mask.png`, `hh_cap_grad__ash_brown.png` and extracted `ash_brown.hp`. It copies browser-ready images to `public/assets/hair/` and writes [its manifest](evidence/hair-intake-manifest.json). Source paths and hashes are in the [saved hair resource trace](../../../research/eye-artistry/saved-hair-profile-resolution.md).
- **Saved eye colour:** `bun tools/intake_eyes.ts` after the [local extraction and UV audit](../../../research/eye-artistry/eye-preview-adapter-plan.md) verifies the known PNG hash and dimensions and prepares `public/assets/eyes/`. Credits stay in the intake manifest and the [community record](../../../docs/community-credits.md).
- **Vanilla piercings:** `bun tools/intake_piercings.ts` writes the hash-checked geometry manifest. [Resource chain and limits](../../../research/jewellery/vanilla-piercing-preview.md).
- **Private PRC slots:** `bun tools/intake_prc.ts` validates locally extracted framework/item resources and uses the vanilla option-12 manifest for 16 approximate preview colours. [Chain, validation and rights boundary](../../../research/jewellery/prc-preview-slice.md).
- **Native morph eye (research only):** `bun tools/intake_native_eye.ts <morph-eye.glb> <base-eye.mesh> <eye.morphtarget>` checks pinned installed-resource and GLB hashes plus the three native chunks, 57 joints and 21 eye morphs. It does not change the current eye renderer, first-run setup, saved-V resolution or game export. [Required gates](../../../research/eye-artistry/native-eye-preview-intake-gate.md).

Teeth and the separate higher-detail eye-skin overlay have not been assembled.

### Preview context

These are viewport-only context layers. They never edit the imported V or the makeup recipe, and missing optional assets leave the rest of the editor usable.

- **Brows and lashes.** Independent visibility switches. The local reference styles are Arkhe Beautiful EYEBROWS II FULLER 18 and Soft Natural Eyelashes, identified from the reference save. With the optional inputs, the saved brow uses its two alpha maps and brown-ombre gradient; the saved lashes use a labelled `brown_liquorice.hp` colour approximation. The [compiled hair-shader audit](../../../research/eye-artistry/lash-material-followup.md) finds no defensible exact lash RGB/coverage mapping yet. Other saves show these as reference styles unless their resource hash and definition match. [Brow/lash evidence](../../../research/eye-artistry/brow-lash-fidelity.md).
- **Saved V hair.** Appears only when the imported save matches the locally resolved `lm097_hair` hash and `38_ash_brown` definition. Style: MELUMINARY Long Length Pak Vol 3 #011; colour: island_dancer's Hair Profiles CCXL. The browser samples strand ID and root-to-tip maps against decoded HP stops, uses the green channel of the card opacity image, and colours the cap from its mask and gradient; the cap mask repeats across the saved mesh's U=2–3 tile ([evidence](evidence/hair-cap-wrap-2026-09-24.json)). Loading is capped at 128 MiB source, 750,000 vertices and 800 rig bones; the browser only reads local `/assets/hair/` URLs. This is an approximate Three.js pigment blend, not a hair editor; REDengine strand shading, anisotropy, alpha details and physics remain open. [Preview limits](../../../research/eye-artistry/saved-v-hair-preview.md).
- **Saved eye colour.** The captured reference V uses the Kala eye-16 diffuse through the researched Unique Eyes to CCXL mapping; matching requires both app hash and definition, and another choice falls back explicitly to the reference map. This is one researched choice, not general MO2/Vortex/manual discovery; packed normals, roughness, cornea/refraction and shader parity remain open.
- **Piercings.** A female vanilla piercing style and colour, or an exact saved choice, with approximate browser materials. The private PRC selector can show candidate nose slots 50, 72 and 74 together under one shared colour, or singly; slots 50/74 use mod-aware linked-mesh exports retaining skin and facial morphs. The stud's second material and effective game archive winners are unresolved. [Bank and colour audit](../../../research/jewellery/prc-catalog-audit.md).

## Material fidelity

The same source geometry/texture data is useful, but a REDengine `.mt` is not a WebGL shader. The adapter uses MeshStandardMaterial for the head/details and MeshPhysicalMaterial for makeup, sRGB colour textures, linear roughness/normal textures, a provisional DirectX normal-Y sign, studio lighting and ACES tone mapping. Existing preview normals are attenuated to 0.35. Skin layering, wrinkles, subsurface scattering, eye refraction, game lighting and exact decal blending remain unresolved; finishes are studies.

`/render-fidelity-study.html` compares the current skin/eye materials against isolated lighting, roughness and normal changes under matched Front, 30° quarter and Mouth close views, with neutral or saved five-morph poses. It does not touch the editor draft and reports missing assets rather than substituting them. [Results](evidence/render-fidelity-study-2026-09-24.md), [private D05/Arkhe A/B](evidence/render-fidelity-source-maps-2026-09-24.md), [failed lip ownership gate](evidence/render-fidelity-ownership-gate-2026-09-25.md). An [optional diffuse-only SSS gate](evidence/diffuse-sss-gate-2026-09-24.md) found the study lacks an isolated diffuse/depth pass and validated mouth ownership mask, so no scattering switch was added. A [read-only CharacterCreator study](../../../research/eye-artistry/charactercreator-rendering-reference.md) informed lighting and isolation methods without importing its shaders or assets.

Next: establish effective runtime winners for the [traced saved head and teeth](../../../research/eye-artistry/saved-skin-shader-and-winner.md) (base head geometry and UV0 match the browser head exactly; modded morphs and game tangent/texture behavior remain unresolved), add the missing eye overlay and attached parts, and compare a small material/pose matrix during one future game session rather than asking the maintainer to launch the game for each browser iteration.

## Library storage

Ignored developer data: `data/library.sqlite`; isolated UI checks use `data/verification.sqlite`. Override the directory with `XFAS_DATA_DIR` (localhost only; the desktop host uses its own user-data directory). For a consistent live backup run `bun tools/backup-library.ts`, which creates timestamped copies under `data/backups` with SQLite `VACUUM INTO` and verifies integrity; do not copy only a running WAL database file.

Private preview manifests can be served from an ignored overlay: set `XFS_ASSET_OVERLAY` (for example `data/asset-overlay`) and files present there win over `public/assets` for `/assets/...` requests. This lets a worktree whose `public/assets` is a read-only link test regenerated manifests (for example from `tools/intake_hair.ts` or `tools/intake_lash_profile.py`) without touching the shared assets. `tools/hair-colour-look.ts` captures fixed-camera brow/lash/hair frames in an isolated `?verify=1` workspace.

Schema v2 stores immutable collection revisions and per-preset versions. The transactional v1 migration gathered latest looks into a collection and retained every legacy look revision unchanged. Recipe/name changes advance preset versions; order-only changes advance the collection revision. Removal does not delete history, and restoring old content never reuses an earlier preset revision. Future-version databases are rejected. Revision browsing, automatic backup scheduling and database autosave remain queued. Imported V and game assets are not stored in this library.

Collection API: GET/POST `/api/collections`, GET `/api/collections/<id>`; isolated namespace `/api/verification/collections`. Writes require same-origin JSON, validated snapshots and an expected revision for existing collections; the request/import budget is 16 MB. Legacy look endpoints remain for compatibility with their 1 MB limit. No arbitrary SQL/file-write API or destructive collection endpoint exists. See [product direction](../data/product-direction.md).

## Checks

Run `bun test` and `bun run check` (TypeScript `--noEmit`) from this directory; `bun test` also runs the desktop tests. **Last verified 25 September 2026: 448 tests pass and the typecheck is clean.** Real-geometry tests need the ignored local preview GLBs (regenerate with the Blender command above); without them those tests fail with explicit missing-file errors. The private captured save fixture is excluded from distribution.

Reproducible studies: `bun tools/validate-pigment.ts` (Python/Pillow for the labelled PNG; results in `data/pigment-validation/`), `bun tools/raster-performance.ts` ([raster performance](../../../research/authoring/raster-performance.md): a supplied complex 2K design went from about 7 s to 1 s in Chrome with identical pixels), and the depth study below.

Evidence records distinguish browser/asset checks from absent game evidence: [verification](evidence/verification-2026-09-23.json), [surface editing](evidence/surface-editing-2026-09-23.json), [surface overlay](evidence/surface-overlay-2026-09-23.json), [UV editor](evidence/uv-editor-2026-09-23.json), [Bézier controls](evidence/bezier-controls-2026-09-23.json), [editable layers](evidence/editable-layers-2026-09-23.json), [preset collections](evidence/preset-collections-2026-09-23.json), [continuous pigment](evidence/continuous-pigment-2026-09-23.json) and [preview depth](evidence/preview-depth-2026-09-23.json). Test counts inside those records describe their own checkpoints.

## Matte flicker / preview depth

The former fixed 1 mm near clipping plane caused depth rejection in otherwise visible makeup at long camera distances. The camera now uses a zoom-dependent 1–5 mm plane, preserving the closest-distance setting. A controlled unlit full-plate GPU comparison at 36 camera/pose combinations reduced missing plate pixels from 12,641 to 20 out of 1,285,700 reference pixels. This establishes a depth-precision correction, not perfect geometric clearance or game rendering; residual differences and other GPUs/poses remain limits. [Measurements](evidence/preview-depth-2026-09-23.json).

Reproduce with `bun tools/build-depth-study.ts` while the server runs, then open `http://127.0.0.1:4317/build/depth-study.html` and select Run depth study. The page uses no saved workspace or library, renders the actual head/plate with unlit diagnostic colours at fixed idle phases, and compares the previous and adaptive near planes against a higher-precision reference. It needs the local preview/animation assets; empty reference images abort rather than pass.

## Continuous point pigment

New layers blend point strengths smoothly across the shape (`smooth-boundary`). A zero-strength point can retain some pigment from nearby points; increasing blend helps narrow opposing transitions but does not change the shape or simulate directional feathering. Existing saved looks keep `legacy-nearest` until you enable **Smooth point gradients** on a layer (undoable); duplicated layers retain their source mode. Positive regularization gives self-crossing paths a defined blend.

`pigment-strength.ts` prepares an arclength blend once per raster and `pigment-edit.ts` supplies typed, UI-independent commands. Worker preview, PNG masks and the preset compiler share the same raster evaluator. Three validation fixtures at 1K/2K remove the old internal strength seams, and all 491,520 compiler alpha checks match the expected squared-alpha encoding. One-layer warm median CPU costs were about 49/186 ms for six knots and 182/846 ms for 24 knots at 1K/2K. Thin-edge downsample differences can still reach 27 alpha levels: continuity does not guarantee sufficient texture sampling.

**Mask responsiveness.** Preview jobs snapshot recipes, yield cooperatively and cancel obsolete snapshots; only complete masks for the latest recipe are displayed. Preset switching invalidates old versions, and active-layer work can preempt another layer without dropping it. Worker failures preserve queued newer edits and retry lazily without a restart loop. Synchronous raster/compiler output is unchanged. This improves responsiveness, not the inherent cost of extreme curves.

## Legacy shell

`/legacy.html` (`src/main.ts`) keeps the previous sidebar/accordion interface for comparison until the new UI is accepted. It edits the same recipes, workspace and library through older adapters; its sidebar dividers resize with drag or arrow keys and stack below 900 px. Control names map to the new Studio as: *Open recipe* → *Import recipe as preset*, *Export recipe* → *Export preset recipe*, *Save a copy* → *Save as new collection*, *Export build plan* → *Export compiler plan*, *Undo collection open* → *Recover previous draft*, *Check game package* / *Build local package* → *Check mod export* / *Build mod files*, *Head & lighting* → *Camera & light* and *Character*. Do not add new features to the legacy shell.

Primary references: [Bun HTTP server](https://bun.com/docs/runtime/http/server), [Three GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [Three texture controls](https://threejs.org/docs/pages/Texture.html), [LZ4 block specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md). Save-format facts were checked against the local pinned WolvenKit source; its implementation is not copied or linked into the application.
