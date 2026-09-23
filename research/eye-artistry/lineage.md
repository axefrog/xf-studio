# Eye Artistry sources, chronology and art intake

Survey date: 2026-09-23. Original files remain intact. Metadata is in the [inventory snapshot](../../inventory/README.md); selected files and ZIP members have [SHA-256 provenance](evidence/provenance.json).

## Which source answers which question

| Source | Evidence and role |
|---|---|
| `D:/Dev/xf-omega` | Generator commit `28c822ea57fcea50ba3f20031744797bddc13e0c`, August 10 2025. Best description of generation behavior, not final art state. |
| `xf-omega/assets/xf-eye-artistry-ccxl` | Portable generator-era art/config snapshot. Its `assets/project.yaml` hashes identically to the current RedModding copy. |
| `F:/Games/RedModding/Projects/xf-eye-artistry-ccxl (LESS OLD)` | Created April 6 2025; later August activity. Older working lineage; retains full generated content. |
| `.../xf-eye-artistry-ccxl (OLD)` | Created May 9 2025. A later copy timestamp than LESS OLD does not make it a newer design. |
| `.../xf-eye-artistry-ccxl-TEST` | May 9 2025 test resource tree. |
| `.../xf-eye-artistry-ccxl` | Created August 21 2025; contains later art modifications through February 7 2026. Primary intake candidate for new authored assets. |
| `.../xfea backup 2026-01-22.zip` | Only two files: a 2,199,552-byte archive and `.xl`, with ZIP timestamps August 25 2025. It is a January backup of an older compiled build, not a January source revision. |
| `F:/Games/MO2/mods/XF Eye Artistry CCXL - Dev` | Installed development archive: 14,594,048 bytes; hash differs from the January ZIP payload and the root loose archive. A separate build, not proof of final source equivalence. |
| `RedModding/Projects/xf-eye-artistry-ccxl.archive` | Loose June 2025-modified build, 35,340,288 bytes; distinct historical output. |
| `.../xf-eye-artistry-ccxl.20250519.7z`, `.7z`, `xfea_makeup*.7z` | Historical backups/exchange packages; metadata indexed. Not all 7z payloads were expanded because newer editable sources are available. |

Creation dates establish local copying/import history; modification times, Git commits, ZIP member times, hashes and semantic file contents establish stronger lineage. No old directory has been deleted or consolidated based on its name.

## New eye plate: verified Blender evidence

`F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend` was last saved February 7 2026 at 18:43 Brisbane time. Blender 5.0.0 successfully opened it headlessly with startup scripts disabled; no source save occurred. [Full inspection](evidence/blender-head2-inspection.json).

- `submesh_00_LOD_1.010`: 1,620 vertices, 3,010 polygons, 2 UV sets, 256 vertex groups, armature parent/modifier and Displace modifier. Basis plus 105 facial customization shape keys. All 105 keys contain nonzero deltas; no vertices lack groups. This is the strong deformation-preserving plate candidate, but group presence is not yet a weight-normalization/bone-map proof.
- `submesh_00_LOD_1.011`: same polygon vertex indexing and counts, 254 groups, no shape keys. Geometry differs by up to approximately 0.006008 Blender units at corresponding vertices. It is not a byte-identical copy of the deformable candidate.
- `eye_makeup_plates.glb`, exported February 7 at 16:21, names `.011`. Its glTF primitive carries POSITION, NORMAL, TEXCOORD_0/1 and COLOR_0; **no JOINTS, WEIGHTS, skin, or morph targets**. See [GLB metadata](evidence/eye-plates-gltf-metadata.json). It cannot be treated as a drop-in morph-skinned game mesh.
- The scene also contains full head meshes, including 7,186-vertex variants with 105 facial shape keys. These offer offline deformation references.
- Earlier `xfea_head.blend` files are September 2025/August 2025 stages. `xfea_makeup_autosave_0.spp` has a January 31 2026 timestamp, newer than some named Substance source files; preserve and inspect it during texture intake rather than assuming the unnumbered `.spp` is latest.

### Intake and cut-surface findings, 2026-09-23

Nathan confirms that he created the expanded plate by loading the larger head and cutting a plate out of it. The [topology audit](evidence/plate-topology-audit.json) independently establishes exact correspondence: all 1,620 Blender vertex positions and all 105 shape-key positions match the source head. It has four connected components (790, 790, 20, 20 vertices), 226 boundary edges with degree two throughout, no isolated vertices, no edges shared by more than two faces and no near-zero-area triangles in Basis or any individual customization shape. Open boundaries are expected for this cut surface. Normal turns around some eye shapes are inspection candidates, not proof of erroneous topology; posed intersection checks remain pending.

The [evaluated comparison](evidence/plate-evaluated-comparison.json) resolves `.011`: it is `.010` with the five saved customization shapes baked in, matching within 3.84e-9 units, with identical UVs and bone weights. It is not a different plate design. The source Displace modifier was hidden in the viewport but enabled for rendering; explicitly enabling it shifts the surface about 0.00005 units. The owned neutral master removes that ambiguous offset and retains all shapes and eight bone influences. Original and intake copies remain unchanged; [intake manifest](../../projects/xf-appearance-studio/data/plate-intake.json) records hashes. Later exports supersede its initial GLB snapshot; see [Experiment 004](../../experiments/004-plate-import/README.md).

The owned master is `projects/xf-appearance-studio/assets/authored/xfas_eye_plate.blend`. Its game export splits UV/corner attributes into 1,635 vertices while retaining 3,010 triangles. A fresh full-head resource supplies all 254 bone names, including 15 weighted bones missing from the legacy small makeup mesh. Reimport rebuilds both mesh and morph buffers for the new topology.

The first conversion exposed clipped normal/tangent morph deltas from Blender's recalculation on the cut surface. A checked export step now retains the corresponding original game head's base and morph lighting vectors. Each exported plate vertex must match one head vertex by position AND both UV sets, and all 105 position deltas must match within 1e-7. This narrowly justified transfer preserves geometry, UVs and weights; it must fail and be reassessed after independent sculpting. Further skin clearance, blink/pose and in-game shading checks remain required.

## Old code findings worth retaining, not copying

- Four layers; 20 designs (9 eyeliner, 11 eyeshadow); 49 sampled colours × four finish labels. Nathan wanted a larger palette; the old material matrix prevented it from being practical in WolvenKit.
- `materials.ts` emits identical property sets for matte/regular and for shimmer/glitter in the inspected source. Finish labels do not prove four distinct implemented shaders.
- A structural comparison with `General/references/mesh_decal.json` finds exactly one template-field difference: `materialPriority` from `EMP_Normal` to `EMP_Front`. This is a historical baseline comparison, not a fresh extraction of the current game's authoritative material. [Diff](evidence/legacy-material-diff.json).
- Layer generation combines that priority choice with `enableMask` toggling. Those material flags should not become the new layer-order contract.
- Both inspected template variants have depth testing enabled and depth writes disabled for the relevant decal passes. Geometry separation is a testable hypothesis, not a guaranteed compositing order.
- Switcher option indexes restart for each included texture list, leaving duplicates in generated source. ArchiveXL reindexes some options, but a clean generator should produce coherent indexes itself.
- Palette sampling assumes fixed image dimensions/channel layout. Validate the new palette explicitly, including channel order, colour space and thumbnail agreement.
- `rebuildEyeArtistryProject` ultimately calls `project.install(true)`. Never run the historical generator during research expecting a harmless build-only operation.

## Historical agent effort

`D:/Dev/sx-cp2077` is the relevant April-May 2026 modding coordination attempt. It contains useful source maps, an Eye Artistry dossier, consumer shortlists and preliminary ArchiveXL analysis. Latest status, May 19, records a practical-workflow proposal; the priority prerequisite sprint was not delivered as a rebuilt mod. Some earlier index text still suggested photo-mode-first work, while later prerequisite/status documents restored Eye Artistry first. Current user instructions settle that priority.

Retain source leads and research questions, verify claims against current code, and avoid importing the old knowledge-maintenance/coordination machinery. `xf-hq` is 2025 workspace/methodology material. `xf-hub` is a later general context workbench with partly completed worker/coordination surfaces, not a hidden Eye Artistry implementation. `sx` contains broader language/workbench experiments. Their designs are not dependencies of this headquarters.
