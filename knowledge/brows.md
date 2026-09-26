# Eyebrows

**Maturity: Draft.** Consolidated from the vanilla 2.31 resources (female and male), ArchiveXL 1.27.3's bundled brow files, three installed brow mods, the Modding Docs and a read-only audit of the Studio preview (26 September 2026), and the brow editor's phase 0 measurements (27 September). Nothing here has runtime evidence of its own. Evidence grades follow the [knowledge rules](README.md): **[source]** engine, framework or tool source or compiled programs, **[resource]** extracted game or mod resources, **[offline]** measured from them, **[wiki]** Modding Docs text or image, **[runtime]** running game, **[hypothesis]** not yet established. Provenance, hashes and measurements are in the [brows and cheeks evidence](../research/character-customization/brows-cheeks-evidence.md) and [experiment 025](../experiments/025-brow-facts/README.md), which also lists every texture's path hash and data hash.

This page answers how a brow gets from the character creator onto V's face, how mods add brows, and what that means for a Studio brow designer. The option catalogue is in the [CC file chain](cc-file-chain.md#4-every-cc-detail-and-what-drives-it); the double-diffuse shader is in [materials and shaders §4.5](materials-and-shaders.md#45-mesh_decal-family-post_gbuffer-all-standard-class-meshskinned-available) and [hair shading §6](hair-shading.md#6-brow-decal-colour-blend-mesh_decal_double_diffusemt). The design options built on these facts are in the [brows and cheeks brief](../research/backlog/brows-and-cheeks-brief.md), and the proposed editor in the [brow editor design](../research/brows/brow-editor-design.md).

## 1. The chain at a glance

| Step | Vanilla female | Grade |
|---|---|---|
| Creator option | Switcher `eyebrows` (`UI-CharacterCreation-eyebrows`, edit tags `NewGame`/`HairDresser`/`Ripperdoc`, randomise category `Eyebrows`): 13 styles plus Off. Choice N activates `eyebrows_colorN` (appearance option, `LocKey#43266`, `useThumbnails` 1, 35 colour definitions, link `eyebrows color`). Off, at switcher index 16, activates `eyebrows_color0`, which has no resource and no definitions. | [resource] |
| Consumer groups | `TPP`, `TPP_photomode` and `character_customization`. Brows are **not** in the `face` group (unlike makeup) and not in `hairs`. | [resource] [wiki] |
| `.app` | `…\appearances\head\eyebrows\heb_000__basehead_NN.app`, one per style. Apps 14–16 exist but no creator option uses them. ArchiveXL's bundled fix remaps them to per-gender `archive_xl\…\eyebrows\` apps. | [resource] [source] |
| Component | One `entMorphTargetSkinnedMeshComponent` `heb_000_pwa__basehead_morph` (via `face_decals\heb_000_pwa__basehead.ent`), `morphResource` `heb_000_pwa__morphs.morphtarget`, meshAppearance `<colour>__NN` | [resource] |
| Mesh | **One mesh for every style**: `…\player_female_average\h0_000_pwa_c__basehead\heb_000_pwa_c__basehead.mesh` (male `pma` twin). 390 vertices, 664 triangles, one chunk, one LOD. | [resource] |
| Appearances | 657 appearances and 656 local materials: 560 are `<colour>__NN` (35 colours × 16 styles), 97 are older names pointing at `eyebrows\<colour>\eyebrows_wa_NN_<colour>.mi`. Match a chunk material to its entry by the entry's `index`, not by list position. | [resource] |
| Material | `mesh_decal_double_diffuse.mt` (`EMP_Normal`) ← `eyebrows_grad__default.mi` ← per-colour `eyebrows_grad__<colour>.mi`; the style's local material overrides the three textures | [resource] |

**Style is a texture set, not geometry** [resource]. Every style draws the same 390 vertices; the style's material swaps three textures on the brow's own UV layout. The texture numbering is offset: styles 01–08 use sets 01–08, styles 09–16 use sets 12–19. Sets 09–11 and all `heb_ma__*` textures are unused by the player; the male mesh uses the same `heb__base_*` textures.

| Texture | Size, mips | Format | Role |
|---|---|---|---|
| `DiffuseTexture` `heb__base_dNN` | 512 × 256, 10 | BC7 `TCM_QualityColor`, `isGamma` 1 | Primary coverage in alpha; greyscale tone in RGB (linear 0.30 on average under coverage) |
| `SecondaryDiffuseAlpha` `heb_wa__base_dsNN` | 64 × 32, 7 | BC7 `TCM_QualityColor`, `isGamma` 1, white RGB | Soft underlay ("powder") coverage in alpha; the program never reads the RGB |
| `NormalTexture` `heb__base_nNN` | 512 × 256, 10 | **BC5** `TCM_Normalmap` (two channels), `isGamma` 0 | Hair relief, RG with reconstructed Z; flat (128, 128) outside the hairs |

All vanilla brow textures allow texture downgrade and have mip bias 0; their alpha mips are plain 2 × 2 box reductions [resource] [offline]. In glTF UV (below) the 13 creator styles' content spans u 0.03–0.97, v 0.16–0.71 of the brow UV area, entirely inside both body types' footprints [offline]. Sets 17–19 (styles 14–16, no creator option) are placeholders: alpha 255 everywhere with near-black RGB, so they would paint the whole strip dark if a mod offered them; sets 09–11 are ordinary painted brows without a `_ds` [resource].

## 2. Geometry, deformation and placement

- **A lifted strip of the head** [resource]. Every brow vertex is a distinct head vertex pushed out along the head's normal by **0.35 mm** (0.344–0.354; male 0.338–0.356), not the 0.40 mm of the makeup, lip, freckle and pimple decals ([face makeup §2](face-makeup.md#2-the-vanilla-face-decal-meshes)). 654 of the 664 triangles are head triangles; the rest are re-triangulated. The gap holds under the morph targets (median 0.35 mm, range 0.26–0.52). Why brows sit lower than the makeup is unknown [hypothesis: an authoring choice; both lifts clear the skin].
- **Footprint and density** [resource]. About 2,508 mm² (1,250 per brow; male 2,752), extent 119 × 25 × 45 mm. The 512 × 256 vanilla textures give about **0.14 mm per texel**, coarser than a single brow hair; vanilla brows are painted, not hair-by-hair. The same triangles in head UV0 run at 418 mm per UV unit.
- **Orientation** [resource]. WolvenKit's glTF export writes v = 1 − the stored v, and XBMs store their rows bottom first, so in glTF UV with image rows top-down the brow is upright (the same pair of flips as the eye plate, [experiment 019](../experiments/019-uv-window/README.md#1-the-uv-transform-and-its-v-sign)). u runs **medial to lateral** on both brows (about 0.02 at the nose end, 0.98 at the tail).
- **The UV is not isometric** [offline]. Per triangle, the female strip runs 53–93 mm per unit u and 28–44 per unit v (5–95 %, area-weighted), the u and v directions are up to 26° from perpendicular, and the upper edge is stretched (88 mm per u near the top, 55 near the bottom). Against one constant scale the median triangle's worst length error is 22 %; male 28 %. At 2048 × 1024 a texel is 0.026–0.045 × 0.027–0.043 mm (female). Anything drawn in millimetres must use the per-triangle metric.
- **Both brows share one UV area** [resource]. 96 % of the UVs are shared (male: all within 4 texels at 2048) and u is not flipped, so one texture draws both brows identically and the two brows' footprints are the same texels. A per-side asymmetric brow is impossible on this mesh without new UVs.
- **Male and female footprints** [offline]. At 2048 × 1024 the female strip covers 53 % of the texture (u 0.022–0.985, v 0.162–0.979), the male 44 % (u 0.029–0.924, v 0.111–0.955), and their **intersection** 42 %: 80 % of the female footprint and 96 % of the male, bbox u 0.029–0.924, v 0.162–0.955. At the same texel the male strip is 0.65–1.41 × the female's length along the brow and 0.99–1.59 × across (medians 0.96 and 1.21), so a shared texture looks about 20 % taller on a masculine V.
- **Tangent frame** [source] [resource]. The double-diffuse vertex program (`17205971338381575357`) passes the mesh tangent T and B = cross(N, T) · w; the pixel program places the map's x along T and y along B. Stored tangents follow +u, and the stored sign w is +1 on V's right brow and −1 on the left, matching the mirrored UV, so B points **down the face** on both brows: red tilts toward the tail, green toward the bottom of the upright image. Every painted vanilla set and the three mods inspected follow that convention [offline, inferred from alpha as a height proxy]. WolvenKit's GLB export negates w together with v, so a renderer using the exported tangents must negate green to match the game.
- **Skinning follows the face rig** [resource]. 74 joints are declared and 70 weighted (brow rows A/B/C, lids, cheeks, nose), up to eight influences per vertex, and 97.7 % of vertices carry exactly the head vertex's weights. Brows move with facial animation because they are skinned to the same face-rig bones as the head, driven through the `face_rig` component; the Studio's idle confirms nonzero brow-card motion ([brow idle gap](../research/animation/brow-idle-gap.md)).
- **Morphs** [resource]. The female brow morph carries all 105 face targets (male 100), but only the `eyes`, `nose` and `jaw` targets move it; the `mouth` and `ear` targets are zero. There is **no vanilla brow-shape slider**; brow height follows the eye shape.

## 3. Material and colour

Parameters set by `eyebrows_grad__default.mi` [resource]; the arithmetic is [source] (pixel program `7624081209775720613` and its Discarded twin `8834363738920290566`, which differ only by the engine's dissolve; [decal reference §5.1](../research/materials/shader-decal.md#51-mesh_decal_double_diffuse-brows-36-lip-styles), [brow material study](../research/eye-artistry/brow-lash-fidelity.md)):

| Parameter | Vanilla value | Effect |
|---|---|---|
| `DiffuseColor` / `SecondaryDiffuseColor` | (103, 81, 71) / (62, 49, 42) | Tint of the primary and secondary terms |
| `DiffuseAlpha` | 1 | Colour target alpha multiplier |
| `SecondaryDiffuseAlphaIntensity` | 0.6 | Coverage = `(p + (1 − p)·s·0.6)²` at default contrast, p = primary alpha, s = secondary alpha, squared after filtering |
| `UseGradientMap` / `GradientMapIntensity` | 1 / 2 | Colour = `saturate(gradient sample × 2)` × primary RGB, plus the secondary term. Linear gradient channels above 0.5 clip: 7 of the 35 colours (`blue_sky`, `blue_steel`, `citrus_yellow`, `green_orange`, `phoenix_fire`, `purple_blonde`, `red_apple`) lose part of their tint; `blonde_platinum` (0.47) does not [offline]. With vanilla's tone of linear 0.30, a vanilla brow shows about 0.6 × the gradient colour |
| `GradientMap` | `hh_cap_grad__<colour>.xbm` (32 × 4 BC7, `isGamma` 1, 6 mips), sampled at the **constant** coordinate (`GradientMapUV`, 0.5) through the template's sampler `s1`, which **clamps** (linear, no anisotropy; every other map uses `s0`: wrap, anisotropic) [resource]; template defaults `hh_cap_grad__black_carbon.xbm` and `GradientMapUV` 1 | One colour per brow: at 1 exactly the ramp's last texel (mip 0), not an ombre along the brow; `phoenix_fire`'s 0.75 blends texels 23 and 24 |
| `NormalTexture` / `NormalAlpha` / `UseNormalAlphaTex` / `NormalsBlendingMode` | style normal / 0.4 / 1 / 1 | Hair relief composed onto the skin normal (reoriented blending, flat texels fade out). With `UseNormalAlphaTex` 1 and the default white `NormalAlphaTex`, the normal alpha is 0.4 × the tilt gate **whatever the coverage**, so relief depends on the map being flat outside the hairs (vanilla maps leave a faint halo, gate 0.04–0.11 on average outside coverage) [source] [offline] |
| `RoughnessTexture` / `RoughnessMetalnessAlpha` | `engine\textures\editor\roughmetal.xbm` (4 × 4, R = 128, linear) / 1 | The brow writes **roughness ≈ 0.50** over its coverage; metalness from the template default `black.xbm`, so 0 [resource] |
| `AlphaMaskContrast`, UV transform | unset (0; scale 1, offset 0) | The program applies the UV transform to every texture, as `mesh_decal` does [source] |
| `DepthThreshold` | template default **0** | The depth-distance test is off for brows (0.5 m in `mesh_decal`) [resource] [source] |

The brow is a `post_gbuffer` decal: it blends colour in square-root space into the skin's G-buffer and is lit as Subsurface skin, once ([materials §2.4](materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it)).

**Brow colour and hair colour** [resource]:

- The 35 brow colours **are** the 35 hair colours, with the same names, localisation keys (`UI-CharacterCreation-NN_<colour>`) and icons.
- Each per-colour `.mi` sets only `GradientMap = …\cap_gradiants\hh_cap_grad__<colour>.xbm`, the **same file** the hair cap materials use for that colour (for example `hair_profiles\brown_liquorice__cap.mi` on `mesh_decal_gradientmap_recolor.mt`). `black_carbon` inherits the template default; `phoenix_fire` also sets `GradientMapUV` 0.75.
- The choices are **independent**: brows link on `eyebrows color`, hair on `hairstyle color`, and no `.hp` hair profile is involved in brows. Picking a hair colour never changes the brow colour, and a hair-profile replacer (`.hp`) does not recolour brows; a gradient replacer (`hh_cap_grad__*.xbm`) recolours both brows and hair caps.
- Vanilla data slips: female `blonde_golden__11` uses the blonde-platinum gradient, female `purple_blonde__14/15/16` use purple ombre, male `liliac_ombre__14/15/16` use purple blonde, and app 15's `female__24_purple_ombre` points at `purple_ombre__16`. A renderer must follow the data, not the colour name.

## 4. How mods add brows

Three installed routes, and ArchiveXL's own brow framework underneath them ([evidence](../research/character-customization/brows-cheeks-evidence.md#installed-mods-inspected)):

| Route | Example | How it works | Consequence |
|---|---|---|---|
| **CCXL named merge into the vanilla switcher** | Arkhe's Beautiful EYEBROWS II (40 styles), Even More Brows (16 styles) | A custom creator resource declares a switcher named `eyebrows` (slot `eyebrows`, `uiSlots` `[eyebrows_color]`) whose new choices activate new appearance options in slot `eyebrows_color`, link `eyebrows color`, 35 colour definitions each. ArchiveXL merges the choices into the vanilla switcher ([CC file chain §5](cc-file-chain.md#5-how-archivexlccxl-extends-the-lists)). | New styles appear after the vanilla ones in the same creator row, with the same 35-colour row. No new selector. [resource] |
| **Same-path replacement** | Arkhe's Beautiful EYEBROWS 2K Material Edit | Ships vanilla depot paths: `eyebrows_grad__default.mi` (gradient intensity 2 → 0.5, secondary 0.6 → 0.7) and texture sets 12–16 at 2048 × 1024 | Changes vanilla styles for V and every NPC; conflicts per path. [resource] |
| Geometry source for new styles | Arkhe copies the vanilla brow morph and mesh with `.xl` `copy` and `patch`es them into per-style stubs; Even More Brows ships full 390-vertex, 74-bone geometry per style | Both keep the vanilla footprint and skinning | Neither changes the brow's shape beyond the vanilla strip [resource] |

**ArchiveXL's brow framework** [resource] [source]. The bundled `PlayerCustomizationBrows{Fix,Scope,Patch}.xl` remaps the vanilla brow apps per gender, defines the scopes `player_{wa,ma}_brows.{app,mesh,morphtarget}`, and patches `archive_xl\characters\common\hair\h1_base_color_patch.mesh` (35 name-only appearances) into every mesh in the brow scope. A CCXL brow mesh therefore defines only `black_carbon`, with the dynamic material pair `@context` `BrowsBaseMaterial` (the style `.mi`) and `@brows` (`baseMaterial` = the style `.mi`, `GradientMap` = `*base\…\cap_gradiants\hh_cap_grad__{material}.xbm`); ArchiveXL expands every other colour name, and hair-colour packs that patch the brow scope (for example Ratstick's Washed Out) add their colours to every scoped brow at once. The wiki's [CCXL eyebrows guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-eyebrows.md) (lumad11, 2025; later edits by manavortex) documents the same recipe: per-gender app, morph and mesh with a shared `.mi` holding only `_d`, `_ds` and `_n`, a `Soft` resource flag, and the options added to the `TPP`, `character_customization` and `TPP_photomode` head groups; its screenshot `billede.png` shows those three groups, and `2025-09-16 13 43 56.png` an app with meshAppearance `black_carbon` and a full chunk mask [wiki]. The [scopes and extensions guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-theory-scopes-and-extensions.md) (manavortex) warns that several styles in one mesh block later colour extension, so ship one mesh per style [wiki].

**How the mods ship their textures** [resource]. Arkhe's Beautiful EYEBROWS II: `_d` and `_ds` 2048 × 1024 **uncompressed** RGBA8 (10.67 MiB each, 12 mips; its `_ds` is `isGamma` 0 with black RGB), `_n` 2048 × 1024 BC5; its material raises `NormalAlpha` to 0.8 and lowers `GradientMapIntensity` to 0.5. Arkhe's SET 01 replacer: 2048 × 1024 BC7, BC7 and BC5. Even More Brows: vanilla sizes and formats with vanilla material values. All three set `allowTextureDowngrade` 0. Their `_d` tone differs widely: Even More Brows is near white (linear ≈ 1.0, so about 2 × the gradient colour at intensity 2), Arkhe II linear 0.55 at intensity 0.5 (0.28 ×), vanilla 0.30 at intensity 2 (0.6 ×) [offline].

**Creator entries** [resource]. The row label is the switcher choice's `localizedName`, plain text in every inspected resource: vanilla `01`…`13` and `Common-Off`, Arkhe `Beautiful Eyebrows II  01`…, Even More Brows `EMB 01`…. ArchiveXL merges switcher choices by that text, and a later duplicate replaces the earlier choice ([CC file chain §5](cc-file-chain.md#5-how-archivexlccxl-extends-the-lists)), so a label is an identity, not just a caption. Each mod style is a `gameuiAppearanceInfo` copying the vanilla fields: `uiSlot` `eyebrows_color`, `link` `eyebrows color`, `linkController` 1, `index` 191, `randomizeCategory` `Eyebrows`, `localizedName` `LocKey#43266`, `useThumbnails` 1, a `Soft` app, and 35 definitions that reuse the vanilla colour keys and icons (`UI-CharacterCreation-05_brown_liquorice`, `OptionsIcons.BrownLiquorice`) under names matching the app's appearances (`05_brown_liquorice`; vanilla uses `female__05_brown_liquorice`). The mods list their appearance options in the `TPP`, `character_customization` and `TPP_photomode` head groups; only vanilla also lists the switcher, in `character_customization`.

**The route an XF-built brow would use** [source + resource; runtime untested for XF output]: the CCXL named merge into `eyebrows`, a per-style brow mesh in ArchiveXL's `player_*_brows` scope with the `black_carbon` / `@brows` dynamic material, and options in the three head groups. That gives every installed hair-colour pack's colours for free and keeps the vanilla colour row; it needs no new selector and no per-mod code.

## 5. What the Studio draws today

Brows render from the resolver's output for any vanilla or CCXL choice (P0 of the [head CC render plan](head-cc-rendering.md#6-render-plan-ranked-by-visual-gain-per-effort)): the planner picks the chunk by the `eyebrows_color` slot and the `TPP` group, and the `doubleDiffuseDecal` adapter (`src/brow-material.ts`) reproduces the squared two-alpha coverage, the gradient colour and the square-root blend over the resolved skin through a per-vertex underlay [source]. Brows follow the facial morphs by `(target, region)` and join the idle rig. Not reproduced [source]:

- the brow's **normal write** (0.4, mode 1) and **roughness write** (≈ 0.50): the adapter draws a fixed roughness 0.8, although the newer face-decal family (`src/face-decal-material.ts`) already implements both for the same template;
- the game's authored mips (the browser builds its own; [mip gate](../research/eye-artistry/brow-lash-mip-gate.md));
- brow wrinkle shading from the idle solver ([brow idle gap](../research/animation/brow-idle-gap.md)).

There is no brow authoring of any kind: no part, painter, texture injection or exporter.

## 6. What this means for a brow designer

| Fact | Implication |
|---|---|
| Style = three textures on one shared mesh | The cheapest authored brow is a **texture set** (`_d`, `_ds`, `_n`) on the vanilla brow geometry: no geometry work, no clearance risk. |
| 0.14 mm per texel at 512 × 256; about 0.026–0.045 mm at 2048 × 1024, varying across the strip | Hair-by-hair strokes need 2048 × 1024; BC7 `_d` and BC5 `_n` are 2,796,240 bytes each with 12 mips, so about 5.3 MiB per style. Lengths and widths in millimetres need the per-triangle metric, not one scale. |
| Both brows share one UV area | Symmetric by construction. Per-side asymmetry needs a brow mesh with separate UVs per side (a UV-only change keeps positions and skin bytes), or a cut in head UV0 (below). |
| The footprint is a fixed strip of head triangles | Shapes outside the strip (a much higher arch, a brow reaching the temple) need new geometry: a new cut of head triangles, lifted like the vanilla brow. |
| 89 % of brow vertices lie inside the expanded eye plate's faces | The eye plate's head-UV texture already covers the brow region. Brow *makeup* over any brow (tint, gel, brow-bone highlight) is drawable today with the eye-makeup engine; a brow *replacement* is not, because a decal cannot remove the vanilla brow below it. |
| In head UV0 the brow region is u 0.316–0.684, v 0.173–0.248 (glTF) at 418–448 mm per UV unit | A brow cut kept in head UV0 with the eye plate's `UVScaleX/Y`, `UVOffsetX/Y` window trick would give about 0.08 × 0.07 mm per texel at 2048 × 512 for both brows in one window, separate per side and with no UV authoring (head UV0 is not mirrored). The double-diffuse program applies the UV transform to all its textures exactly as `mesh_decal`'s does [source]; the gradient is sampled at a constant coordinate and is unaffected. |
| One colour per brow from the gradient's end texel | "Follow the creator's colour" (35 hair colours plus installed packs) is free through `@brows`; a multi-tone or ombre brow must bake colour into the diffuse RGB with `UseGradientMap` 0, and then loses the colour row. |
| Colour and hair colour are independent choices sharing gradient files | A "match my hair" default is a Studio convenience (preselect the same colour name), not an engine link. |
| Colour = gradient × `GradientMapIntensity` × primary RGB | Greyscale variation in the `_d` RGB (per-hair tone, a lighter front) survives every creator colour; only hue changes need `UseGradientMap` 0. Vanilla and Arkhe `_d` RGB are near-greyscale [resource]. A tone of linear 0.30 matches vanilla brows' brightness in every colour [offline]. |
| Coverage is squared *after* texture filtering | An authored coverage `C` is shown faithfully by writing `p = √C`, and a box-filtered mip of `p` thins the brow at a distance (mean of `p`, squared, < mean of `p²`); a mip chain holding `√(mean C)` preserves it [hypothesis until checked in game]. |
| The secondary term is tinted by the constant `SecondaryDiffuseColor`, not the gradient ([brow material study](../research/eye-artistry/brow-lash-fidelity.md)) | A heavy `_ds` underlay stays one tint for every creator colour; soft "powder" that must follow the colour row belongs in `_d` alpha. |
| Female and male strips share textures but not footprints or metric | An authored style must stay inside the intersection (42 % of the texture) to show on both body types, and is millimetre-exact on one of them only [offline]. |
| The tangent sign flips with the mirrored UV; green points down the face | One normal map, authored with green toward the bottom of the upright image and flat outside the hairs, lights both brows correctly [source] [resource]. |

## Open questions

1. Why are brows lifted 0.35 mm while every other face decal is 0.40 mm, and does the difference matter for draw order against eye makeup (both are `EMP_Normal`)?
2. ~~What does `GradientMapUV` mean exactly?~~ **Answered [resource]:** the u coordinate along the 32-texel ramp, read through a clamping linear sampler, so 1 is exactly the last texel and 0.75 blends texels 23 and 24 (§3).
3. ~~Does the double-diffuse program apply `UVScale`/`UVOffset` to all three textures?~~ **Answered [source]:** yes, like `mesh_decal` ([decal reference §5.1](../research/materials/shader-decal.md#51-mesh_decal_double_diffuse-brows-36-lip-styles)).
4. ~~What is the template default for the brow's metalness and `NormalAlphaTex`?~~ **Answered [resource]:** `black.xbm` (metalness 0) and `white.xbm`.
5. Do the unused brow apps 14–16 and texture sets 09–11 draw anything if selected through a mod? **Partly answered [resource]:** styles 14–16 (apps 14–16) use texture sets 17–19, which are full-coverage near-black placeholders and would darken the whole strip; sets 09–11 are ordinary painted brows. Rendering is untested.
6. Does a brow mesh with separate per-side UVs (positions and skin bytes unchanged) render and deform identically in game?

## In-game test asks

Batch into one prepared session; record game, ArchiveXL and whether Phantom Liberty is installed.

1. **Brow colour is not hair colour.** In the creator, choose hair `brown_liquorice` and brows `blonde_platinum`, then switch hair to `black_carbon`: the brows must not change.
2. **Brow gloss.** Photo mode, frontal close-up of brow style 3 under one light moved from above to the side: a brow writing roughness 0.5 over skin at about 0.6 should show a faint sheen on the hairs; compare with the preview.
3. **Brow and eye makeup overlap.** Eye makeup style 05 black with brow style 1: capture whether the makeup draws over the brow hairs where they overlap near the tail (both decals, 0.40 against 0.35 mm).

## Related pages

[Face makeup](face-makeup.md) · [CC file chain](cc-file-chain.md) · [Head CC rendering](head-cc-rendering.md) · [Hair shading](hair-shading.md) · [Materials and shaders](materials-and-shaders.md) · [Mod loading](mod-loading.md) · [Evidence](../research/character-customization/brows-cheeks-evidence.md) · [Brows and cheeks brief](../research/backlog/brows-and-cheeks-brief.md)
