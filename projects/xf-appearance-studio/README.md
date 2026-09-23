# XF Studio

Makeup raster performance: exact bounds, mirrored-pixel reuse and fair background scheduling reduce the supplied complex 2K Backdrop from roughly seven seconds to one second in Chrome, preserving its pixels. [Measurements and remaining limits](../../research/authoring/raster-performance.md).

Whole-shape translation, selected-point rotation/scaling and persistent UV pan/zoom now work in both applicable editing views. Pure transform/view actions are separate from their gesture adapters; [details](../../research/authoring/shape-gesture-contract.md).

Latest authoring checkpoint: the editor offers an opt-in irregular Glitter browser study with independent base and flake colours. It saves in recipe-7, while older glitter retains its original appearance. Game export still rejects Glitter. [Editor use and limits](authoring/README.md).

Renamed by Nathan on 2026-09-23. Current product: users author their own eye-makeup presets in the studio, save a local library and compile a collection for **one in-game selector**. This supersedes four in-game layer selectors and the design/colour/finish matrix. Editable layers, expanded plate coverage, predictable stacking and seven familiar finish families remain the first delivery area. See the [product direction and later-feature discussion gates](data/product-direction.md).

All newly generated archive appearance names use the `xfs_` namespace. See [naming and scope](data/naming.md). Photo Mode Tools remains an independent peer project.

Status: foundation research complete; the first clean [procedural authoring prototype](authoring/README.md) now runs locally. The game mod implementation is still pending. This is the authoritative location for XF Studio, formerly XF Appearance Studio and XF Eye Artistry.

Historical Eye Artistry feature intent: female V, four independently selectable makeup layers, 20 designs (9 eyeliner and 11 eyeshadow), 49 colours and four finish labels. The legacy finish implementations are not all distinct; keep user-visible intent separate from accidental old behavior. Expanded eye-plate surface, predictable layer ordering and facial deformation support are core requirements.

**Content reset authorized:** Nathan is happy to replace all old designs, identities, preset names and IDs. The numbers above describe historical reference material, not a new catalogue specification. The concept and layered structure matter; the procedural editor can author a completely fresh collection. Do not require legacy parity or a save migration bridge unless it becomes useful or is requested. Save inspection can reproduce a reference V without forcing those old choices into new content.

The user wants **more colours**. The legacy 49-colour limit was imposed by the enormous material matrix and reports of WolvenKit becoming unusably slow. Make the palette configurable; benchmark larger candidates and residual UI/thumbnail/cache growth. Do not treat 49 as a release cap. The queued CCXL capability study should investigate decoupled selectors and palette browsing where they help this goal.

Target: current stable ArchiveXL 1.27.3, Cyberpunk 2077 2.31. Installed ArchiveXL requires an update before runtime verification. Use the [expansion design](../../research/archive-xl/eye-artistry-strategy.md) and [asset lineage](../../research/eye-artistry/lineage.md).

Planned project-local structure:

- `src/`: new build/validation code; no old toolbox dependencies.
- `data/`: explicit stable IDs, palette, finishes, selectors and asset provenance.
- `assets/authored/`: authoritative editable art once selected/imported; `assets/imported/` for preserved intake copies.
- `resources/`: small reviewed resource templates and registration declarations.
- `build/`: generated intermediate files; `dist/`: uniquely versioned install packages and manifests.
- `tests/`: meaningful invariants and regression fixtures as implementation warrants.
- `authoring/`: Bun/TypeScript/Three.js procedural editor, local derived preview assets, saved-V reader and renderer experiments.

The authoring prototype supports weighted curve areas, a Gaussian vector field, symmetry, editable ordered layers, colour/finish studies, recipe persistence, 2K alpha-mask export, exploratory eyelid motion and importing a save's facial morph choices. It renders the actual head and `.010` plate with eight bone influences and all 105 customization morphs. Optional Arkhe brows, Soft Natural lashes, locally resolved saved-V MELUMINARY hair, vanilla piercings and one private PRC ring provide preview context. The saved brow now uses its two source alpha maps/gradient, and AshBrown hair samples source strand/cap maps through island_dancer's CCXL profile. These are browser material approximations, not verified game shader matches; hair physics and saved skin/other appearance references remain incomplete. Direct face dragging for curve/field controls is implemented; refinements remain in the [authoring queue](../../research/backlog/eye-artistry-authoring.md). See [save research](../../research/eye-artistry/save-import.md), [hair preview limits](../../research/eye-artistry/saved-v-hair-preview.md) and [PRC preview limits](../../research/jewellery/prc-preview-slice.md).

The first game package slice now exists: [Experiment 005](../../experiments/005-preset-collection/README.md) contains ONE selector with two complete overlapping-layer presets and Off, sharing one material template and one mesh/morph pair. Binary structure, maps and all packed payloads pass offline checks. It is not deployed or render-verified. Next prove switching clears previous components, runtime CCXL registration, posed clearance and save identity, while integrating installable export and remaining optical finishes. Editable collection accordions, SQLite snapshots and portable collection export now work. Preserve zero-offset and controlled-offset comparisons; do not regenerate a full combinatorial catalogue.

No installed mod is replaced by this work. The owned neutral plate master is now `assets/authored/xfas_eye_plate.blend`, with hashed source intake, all 105 facial shapes and eight bone influences retained. Nathan confirms the plate was cut from the larger head, and exact geometric correspondence is verified. The historical static GLB lacks deformation data; it is not used as the master. [Experiment 004](../../experiments/004-plate-import/README.md) records game-resource conversion and shading retention; skin clearance, posed intersections and game rendering remain open.
