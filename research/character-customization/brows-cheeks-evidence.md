# Eyebrows and cheek makeup: resource and mod evidence

26 September 2026. Provenance behind the [eyebrows](../../knowledge/brows.md) and [face makeup](../../knowledge/face-makeup.md) knowledge pages and the [brows and cheeks design brief](../backlog/brows-and-cheeks-brief.md). Offline, read-only inspection: no game launch, no MO2 launch, no write under the game or MO2 folders. Extracted resources, serialized JSON, GLB exports and the analysis scripts stay in the ignored `research/consumers/brows-cheeks/` (vanilla) and `research/consumers/brows-cheeks-mods/` (installed mods and the ArchiveXL bundle); nothing extracted is committed.

## Tools and inputs

| Input | Version / identity |
|---|---|
| Installed game | 2.31 with Phantom Liberty, at `PATH_TO_GAME` |
| WolvenKit CLI | 9.0.1: `archive -l -r`, `unbundle -r` (one simple regex per call; a combined regex crashed the CLI), `convert serialize` per folder (a whole-folder run flattens output and collides file names), `uncook -r <mesh or morphtarget> -u --uext png --mesh-export-type MeshOnly -gp <game>` for bound GLBs (a plain `export` of a mesh fails with "Depot path is not set"), `export <xbm> --uext png -gp <game>` for textures |
| MO2 | Selected profile `2025 (again)`; mod folders read in place |
| ArchiveXL | 1.27.3 bundle files as installed (`PlayerCustomizationBrows{Fix,Scope,Patch}.xl`) |
| Modding Docs | Local clone at `be2f44eed8419342ec13f72ed9cab008e9f7b289` |
| Studio source | Worktree at `46d1a31` (read-only audit of `projects/xf-studio/authoring/src`) |

Analysis scripts (ignored, `research/consumers/brows-cheeks/raw/`): `meshlib.py`/`glb.py` (GLB reader), `decal_vs_head.py` (nearest head vertex, offset along the head normal, UV and weight comparison, texel density), `morph_offset.py`/`morph_regions.py` (the lift under each morph target, which regions move a mesh), `topo_mirror.py` (UV mirroring), `mesh_materials.py`/`brow_style_map.py` (appearance → material → texture, looked up by each entry's index), `cheek_chain.py`/`cheek_table.py` (blush `.mi` chains), `xbm_summary.py` (header versus cooked sizes), `cheek_head_uv.py` and `plate_overlap.py` (head UV0 bounds of the brow and cheek regions, and their overlap with the expanded eye plate's face selection).

## Resource identities

FNV-1a64 of the lower-case depot path.

| Resource | Hash |
|---|---|
| `base\characters\head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\heb_000_pwa_c__basehead.mesh` | `93420395318360365` |
| male twin `…\player_man_average\h0_000_pma_c__basehead\heb_000_pma_c__basehead.mesh` | `1794131504349689667` |
| `…\heb_000_pwa__morphs.morphtarget` | `16994631526596172536` |
| `…\h0_000_pwa_c__basehead\hx_000_pwa_c__basehead_makeup_freckles_01.mesh` | `16725110353175741504` |
| male twin `hx_000_pma_c__basehead_makeup_freckles_01.mesh` | `1853986081667373634` |
| `…\hx_000_pwa__morphs_makeup_freckles_01.morphtarget` | `8340567777573172279` |
| `base\materials\mesh_decal.mt` | `4072856713183553028` |
| `base\materials\mesh_decal_double_diffuse.mt` | `10501783642502886761` |
| `…\eyebrows\grad\eyebrows_grad__default.mi` | `7055832371151832458` |
| `…\makeup\freckles\textures\hx_makeup_16.xbm` | `16168648846165582951` |
| `…\makeup\freckles\textures\hx_makeup_m16.xbm` | `15343569053232125126` |

## Measurements

Geometry from WolvenKit's bound GLB exports of the female meshes (male in brackets where measured). "Lift" is the offset from the nearest head vertex along that vertex's normal.

| Quantity | Brows (`heb_000_pwa_c__basehead`) | Cheeks chunk 0 (face) | Cheeks chunk 1 (nose) |
|---|---|---|---|
| Vertices / triangles | 390 / 664 (654 are head triangles) | 890 / 1,564 | 443 / 768 |
| Distinct head vertices matched | 390 | 890 | 443 |
| Lift, min / median / max | 0.344 / 0.349 / 0.354 mm (male 0.338–0.356) | 0.386 / 0.400 / 0.405 mm | 0.341 / 0.400 / 0.406 mm |
| Lift under the morph targets | median 0.35, range 0.26–0.52 mm | – | – |
| Skin weights equal to the head's | 97.7 % of vertices | 100 % | 100 % |
| Joints declared / weighted | 74 / 70 | 142 / 125 | 142 / 57 |
| Own UV0 bounds | u 0.022–0.985, v 0.162–0.979 (male u 0.029–0.924, v 0.111–0.955) | u 0.352–0.987, v 0.201–0.857 | u 0.013–0.508, v 0.079–0.627 |
| Mirroring | both brows share one UV area (96 % of UVs shared, u not flipped) | both cheeks share one UV area | one island, not mirrored |
| Surface area | 2,508 mm² (about 1,250 per brow) | 9,775 mm² | 1,888 mm² |
| Extent (x, y, z) | 119 × 25 × 45 mm | 132 × 70 × 79 mm | 35 × 70 × 25 mm |
| Own UV density | 48.6 mm/UV (along the brow 72.8, across 34.2) | 152.6 mm/UV (u 175, v 136) | 127.4 mm/UV |
| Head UV0 density, same triangles | 418 mm/UV | 509 mm/UV (u 589, v 459) | 420 mm/UV |
| Head UV0 bounds (glTF V, top-left) | u 0.316–0.684, v 0.173–0.248 | u 0.283–0.717, v 0.210–0.405 (sides at u < 0.473 and > 0.527) | u 0.426–0.574, v 0.173–0.337 |
| Vertices inside the expanded eye plate's faces | 346 of 390 (89 %) | 512 of 890 (58 %) | 50 of 443 (11 %) |

The expanded eye plate's head UV0 bounds recomputed from its recipe's native face IDs are u 0.2732–0.7266, glTF v 0.1787–0.3237, matching the recipe's stored rectangle (stored V 0.6763–0.8213), which also confirms that the GLB export keeps native face order.

Textures (header size / cooked size, from `xbm_cooked.tsv`): brow diffuse `heb__base_dNN` and normal `heb__base_nNN` 512 × 256 / 512 × 256 (BC7 `TCM_QualityColor`, `isGamma` 1; normal `TCM_Normalmap`, `isGamma` 0); brow secondary `heb_wa__base_dsNN` 64 × 32. Blush masks `hx_makeup_NN` are cooked one mip below their header: 256² for most styles, 512² for styles 11, 12, 16, 17, 18 and `13a`; freckles `hx_freckles_makeup_01…04` cooked 256, 512, 512, 512.

## Observations recorded here in detail

- **Brow material lookup.** The brow mesh has 657 appearances and 656 local material entries. Chunk materials must be matched to entries by each entry's `index`, not by list position; position order returns wrong textures.
- **Brow style → texture set.** Styles 01–08 use texture sets 01–08; styles 09–16 use sets 12–19. Sets 09–11, `heb__base_a01/a02`, `heb_wa__base_a03` and every `heb_ma__*` texture are unused by the player meshes; the male mesh uses the same `heb__base_*` textures.
- **Vanilla brow data slips.** Female `blonde_golden__11` uses the `blonde_platinum` gradient; female `purple_blonde__14/15/16` use `purple_ombre`; male `liliac_ombre__14/15/16` use `purple_blonde`; in app 15 the definition `female__24_purple_ombre` points at `purple_ombre__16`. Male brow definitions carry scrambled index and swatch colours; their icons and localisation keys are correct.
- **Blush alpha distribution.** Over the 640 blush chunk materials in use, `DiffuseAlpha` is 2 in 204, 3 in 162, 1 in 96, and 0.5–4 in the rest. The masks are white RGB with coverage in alpha (style 01's alpha peaks at 0.31, hence alphas above 1).
- **Metallic blush.** `cheeks_color__10_gold.mi` and `__11_silver.mi` set a white `MetalnessTexture`; their style files set `RoughnessMetalnessAlpha` 0.1–1 with metal from `white.xbm` or the masks `hx_makeup_m08`/`m16` and roughness from `engine\textures\editor\hairdefault_u.xbm` (4 × 4, R = 129, flagged sRGB). Silver adds `NormalAlpha` 0.6 of the flat `normal.xbm` with blending mode 0.5. Style 16 writes the `m16` metal mask at 0.4 for every colour; styles 15 and 17 write surface alpha 0.1 and normal 0.6 for most colours.
- **Other appearances on the freckles mesh.** 16 face-cyberware appearances (01–08 through `cyberware__NN.mi`, `mesh_decal`, surface alpha 0.8–1 with normals; 09/11/13/15 and their `_dark` variants through `…\cyberware\face\cyberware_NN.mi`, not extracted) and a `default` appearance on `metal_base.remt`.
- **Not examined.** The unused brow apps 14–16, the per-preset-head brow and freckle meshes (`heb_0NN`, `hx_0NN`) and `cyberware_09…15.mi`.

## Installed mods inspected

| Mod (Nexus ID, installed version) | Route | Key facts |
|---|---|---|
| ArchiveXL bundle brow files | Framework | `Fix` remaps the 13 vanilla `heb_000__basehead_NN.app` in all four creator resources to per-gender apps under `archive_xl\…\eyebrows\`; `Scope` defines `player_{wa,ma}_brows.{app,mesh,morphtarget}` and `player_*_base_brows.*`; `Patch` copies the vanilla brow morph and mesh into `*_base_brows` and patches `archive_xl\characters\common\hair\h1_base_color_patch.mesh` (35 name-only appearances) into every `player_*_brows.mesh`, so hair-colour packs that patch that scope reach every scoped brow mesh |
| Beautiful EYEBROWS II FULLER CCXL (26168, 1.0) | CCXL named merge | Merges into the vanilla `eyebrows` switcher; 40 options `ark_eyebrows_02_ccxl_01…40`, each an appearance option in slot `eyebrows_color`, link `eyebrows color`, 35 colours; `.xl` copies the vanilla brow morph and mesh and patches them into 40 stubs per gender; 2048 × 1024 `d`/`ds`/`n` |
| Even More Brows for Cyberpunk CCXL (26230, 1.0) | CCXL named merge | Same merge; 16 options, 35 colours; ships full 390-vertex, 74-bone geometry and a 105-target morph; material values identical to vanilla; 512 × 256 textures |
| Beautiful EYEBROWS 2K Material Edit and SET 01 (18783, 1.0) | Same-path replacement | Replaces `eyebrows_grad__default.mi` (`GradientMapIntensity` 2 → 0.5, `SecondaryDiffuseAlphaIntensity` 0.6 → 0.7) and vanilla texture sets 12–16 at 2048 × 1024; affects every NPC using vanilla brows |
| KOZMETIX by meluminary (29018, 1.0.1) | Worn items (lips, liner) | TweakXL items based on `Items.GenericFaceClothing` in `OutfitSlots.Mask` (liner in Equipment-EX eye slots); no geometry of its own: `resource.patch` merges material-only meshes into the vanilla lip and eye-makeup meshes, `resource.link` aliases its morph paths to the vanilla makeup morphs, and a tag hides chunks 0–5 of the vanilla lipstick mesh; one `@dynamic` material per product with `{material}` shade `.mi` files |
| Limerence × AllieKat Winterkissed AXL Eyeshadows (18323, 1.1) | Worn item (eyes slot) | Own depot path for a mesh that is the vanilla eye-makeup geometry byte for byte ([experiment 017](../../experiments/017-plate-depth/README.md)); 4096² maps with over-driven alphas |
| Lime Makeup Atelier (18322, 1.1) | Store only | Registers a Virtual Atelier shop selling the Winterkissed items; no makeup of its own |
| Limerence Liners (14780), Alliekat's Eyeshadow Remix Pt. 1 (15451) | Same-path replacement | Replace vanilla `hx_eyes_makeup_01_dNN.xbm` eye-makeup masks (2048²); they conflict per slot and change NPCs too |

No installed mod adds cheek makeup through the character creator, targets `makeupCheeks` or adds a cheek selector.

## Modding Docs pages and images inspected

| Page (at `be2f44ee`) | Author as stated | What it established | Images inspected |
|---|---|---|---|
| `for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-eyebrows.md` | lumad11 (created 25 April 2025), later edits manavortex | One creator resource per gender; app, morph and mesh per gender with a shared `.mi`; option names match the appearance options; `Soft` resource flag; add the options to the `TPP`, `character_customization` and `TPP_photomode` head groups; mesh `@context` `BrowsBaseMaterial` plus `@brows`; a style `.mi` needs only `_d`, `_ds` and `_n` | `.gitbook/assets/billede.png` (the three head groups listing two example brow options); `.gitbook/assets/2025-09-16 13 43 56.png` (an app with meshAppearance `black_carbon`, a `partsOverride` matching the component name and a full chunk mask) |
| `…/archivexl-character-creator-additions/ccxl-theory-scopes-and-extensions.md` | manavortex (12 March 2025) | `@brows` ↔ `BrowsBaseMaterial`; colour `.mi` files derive from one base; several makeup styles in one mesh block colour extension, so ship one mesh per style | `ccxl_material_colour_extensions.png`, `ccxl_makeup_mesh_example.png` |
| `…/archivexl-character-creator-additions/README.md` | manavortex and island_dancer; edit by icxrus | Vanilla switcher table: `makeupCheeks` (switcher) and `makeupCheeks_color` (appearance slot), `eyebrows`/`eyebrows_color`; recommends extending established switchers | – |
| `…/archivexl-character-creator-additions/ccxl-hair-profiles-colors.md` | nutboy (17 May 2025) | Custom `hh_cap_grad` gradients double as brow colours | – |
| `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md` | manavortex; update nutboy | Illustrated cheek choices: 01–04 freckles over cheeks and nose, 05–14 blush and graphic shapes (a band across the nose bridge at 07, stars at 14); counts are older than 2.31 (cheeks Off + 14, brows Off + 11) | `character_creator_cheek_makeup_options.png`, `character_creator_cheek_makeup_color.png` |
| `…/references-lists-and-overviews/cheat-sheet-head/README.md` | none stated | Vanilla brow textures `heb__base_dNN` and `heb_wa__base_dsNN`; cheek makeup on `hx_` meshes | – |

No wiki guide covers CCXL cheek makeup or reusing the freckles mesh.

## Studio audit (read-only)

- Brows render through the `doubleDiffuseDecal` adapter (`src/character-material-adapters.ts` → `src/brow-material.ts`): primary and secondary coverage squared after filtering, gradient colour, a per-vertex skin underlay to reproduce the square-root blend, render order 100 (above face decals, the authored plate and the wetness shell, below lashes). It draws a `MeshStandardMaterial` at a fixed roughness 0.8 and ignores the brow's normal and roughness writes, which the newer face-decal family (`src/face-decal-material.ts`) already implements for the same template. Brow bones join the idle rig and brows copy the head's morph influences by `(target, region)`.
- There is no brow or cheek authoring: no part, action, painter or exporter.
- The layered-makeup engine (recipe, raster, compiler, finishes) works in head UV0. Eye-specific pieces: `eye-plate-recipe.json` (3,010 faces, 1,620 vertices, 105 targets), `WINDOW_TEXTURE` 2048 × 512 and the verifier's copy, `PLATE_LIFT_MM` 0.4, starter shapes and the default UV view, the single plate node (`createMakeupStack(plate)`), `plate-reach.ts`, and the mirror hard-wired as `u → 1 − u`. `derivePlateDocuments` cuts any face list, so a cheek plate is a new recipe.
- Export assumes one selector (`planCollection`, `SELECTOR_GROUPS` `character_customization` and `face`, verifier `selectorCount` 1).
- The legacy xf-omega eye-makeup mesh was skinned to the brow joints (`l_/r_J_eye_brows_rowA/B_*`), and its selector used option index 311 between teeth (310) and eye makeup (450). Neither legacy project contains brow, cheek or lip work.
