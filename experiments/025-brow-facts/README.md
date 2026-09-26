# Brow facts: phase 0 of the brow editor

**Status:** done, 27 September 2026. Offline only: no game or MO2 launch, nothing written under the game or mod folders, no extracted data committed. This is phase 0 of the [brow editor design](../../research/brows/brow-editor-design.md#5-phased-plan); the consolidated reading is on the [eyebrows](../../knowledge/brows.md) knowledge page.

Evidence grades as in the knowledge base: **[source]** compiled programs or tool source; **[resource]** installed game or mod files, decoded here; **[offline]** measured here from those files; **[hypothesis]** not established. Nothing here has runtime evidence.

## Question

Before the strand-field engine is written, establish the facts the design marks for phase 0: the brow strip's real metric (UV to millimetres, per triangle, both body genders), which way its UV runs, the male and female footprints and the area a style must stay inside, the vanilla texture formats, sizes, mips, colour spaces and tone levels, the double-diffuse program's secondary term, gradient sampling and clip, the tangent-frame convention of the normal map, how the CCXL brow mods ship their textures, and the creator entries an "XF <look name>" style needs.

## Inputs

| Input | Identity |
|---|---|
| Game | 2.31 (`GameVersion 2310`), extracted with WolvenKit CLI 9.0.1 into the ignored `research/consumers/brows-cheeks/` and `research/consumers/brows-cheeks-mods/` of the main checkout ([evidence note](../../research/character-customization/brows-cheeks-evidence.md)) |
| Female brow mesh | `base\characters\head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\heb_000_pwa_c__basehead.mesh`, FNV-1a64 `93420395318360365`, render buffer SHA-256 `ce3ddb1a8a724dd9…090f47c` |
| Male brow mesh | `…\player_man_average\h0_000_pma_c__basehead\heb_000_pma_c__basehead.mesh`, FNV-1a64 `1794131504349689667`, render buffer SHA-256 `30fe1b8f24ffab09…0cf3b` |
| Template | `base\materials\mesh_decal_double_diffuse.mt` (FNV-1a64 `10501783642502886761`), its serialized parameter defaults and sampler states |
| Programs | MeshSkinned `post_gbuffer`: vertex `17205971338381575357` (DXBC SHA-256 `6c01bb3024c555b0…0c0dee9`, new here), pixel `7624081209775720613` (`15b4d277…ba8e550`), from `shader_final.cache` through `shader_cache.py extract`, then dxil-spirv `f2d1b554` and SPIRV-Cross `aa217aeb`; listings kept in the session scratchpad, not committed |
| Mods (installed, read in place) | Arkhe's Beautiful EYEBROWS II FULLER CCXL (Nexus 26168, 1.0), Even More Brows CCXL (26230, 1.0), Arkhe's Beautiful EYEBROWS 2K Material Edit and SET 01 (18783, 1.0) |
| Decoder | Pillow's BCn decoder (modes 7 and 5) on the serialized mip data; its level 0 equals WolvenKit's PNG export with the rows reversed, byte for byte for `_d` and within one step for `_n` |

## Results

| # | Fact | Value | Grade | Design consequence |
|---|---|---|---|---|
| 1 | UV orientation | Both brows: u runs **medial to lateral** (u ≈ 0.02 at the nose end, 0.98 at the tail; correlation of u with \|x\| 0.985 female, 0.977 male). In glTF UV (WolvenKit's export, = 1 − stored v) v runs **top to bottom** of the brow, so the glTF UV rectangle drawn with image rows top-down shows the brow upright. | [resource] | As designed: the chart is medial to lateral, no flip between sides. |
| 2 | Stored v and row order | WolvenKit's GLB export writes v = 1 − the stored half-float v (exact for all 390 vertices of both meshes), and the XBM mip data is stored bottom row first (WolvenKit's PNG export is the stored image with rows reversed). The two flips cancel: authored images in glTF UV are right side up, as [experiment 019](../019-uv-window/README.md#1-the-uv-transform-and-its-v-sign) found for the plate. Vanilla coverage lies 100 % inside the footprint in that pairing and 4–32 % outside with stored rows. | [resource] | The engine and exporter author in glTF UV with top-down rows, like the eye plate. |
| 3 | Metric is **not** isometric | Female mm per unit u, area-weighted 5 / 50 / 95 %: 53 / 76 / 93; per unit v: 28 / 34 / 44; angle between the u and v directions on the skin up to 26° (95 %). The upper edge is stretched: mm per u is 88 at v 0.1–0.2 and 55 at v 0.8–0.9. Against one constant scale (75.3 × 35.7 mm per unit) the median triangle's worst length error is **22 %**, and only 39 % of the area is within 20 %. Male: 53 / 83 / 113 per u, 32 / 46 / 56 per v, median error 28 %. | [offline] | The per-triangle metric is required, not a check (§3.3's fallback does not apply). It is computed at load time from the V's own brow mesh, which the host already loads, rather than stored as a table of game data. |
| 4 | Texel size at 2048 × 1024 | Female 0.026–0.045 mm along the brow and 0.027–0.043 mm across (5–95 %); male 0.026–0.055 × 0.031–0.055 mm. | [offline] | Hair-by-hair still holds; the rasteriser must use the local metric for hair width. |
| 5 | Male against female at the same texel | Male mm per u ÷ female: 0.65 / 0.96 / 1.41 (5 / 50 / 95 %); per v: 0.99 / 1.21 / 1.59. Male mid-brow (u 0.3–0.5) runs 99–106 mm per u against the female's 73–78. | [offline] | One shared texture cannot be millimetre-exact on both bodies: on a masculine V the same style is about 20 % taller and up to 40 % longer or shorter along the brow. Vanilla and both mods share textures anyway. Default: millimetres refer to one reference body (the female strip, as §3.3 proposed) and the preview shows the true result on either body. Per-gender texture sets are the alternative (double size). |
| 6 | Footprints (2048 × 1024, glTF UV) | Female 1,112,511 texels (53 % of the texture), bbox u 0.022–0.985, v 0.162–0.979; male 926,192 (44 %), u 0.029–0.924, v 0.111–0.955. Within each gender the left and right brows cover the same texels (female 96 % of vertices share UVs, male all within 4 texels). | [offline] | – |
| 7 | **Intersection** a style must stay inside | 886,646 texels (42 % of the texture; 80 % of the female footprint, 96 % of the male); bbox u 0.029–0.924, v 0.162–0.955. Eroded by 8 / 16 / 32 texels: 848,594 / 811,078 / 737,650. Every creator-offered vanilla style keeps ≥ 99.95 % of its coverage inside it; the union of their content is u 0.029–0.971, v 0.160–0.711. | [offline] | Domain check as designed; the intersection is also computed at load time from both meshes. A margin of a few texels keeps mips from bleeding past the edge. |
| 8 | Tangent frame | Vertex program: T = the mesh tangent, B = cross(N, T) · w, both skinned; pixel program: normal = T·x + B·y + N·z (mode 0; mode 1 is the same frame under RNM). Stored tangents follow +u (cos ≥ 0.99). Stored w is +1 on V's right brow (+x) and −1 on the left, matching the mirrored UV handedness, so B points **down the face** on both brows. WolvenKit's GLB export negates w along with v, so the exported B points up. | [source] + [resource] | Red = tilt toward +u (lateral); green = tilt toward the **bottom of the upright image** (down the face). One normal map lights both brows correctly. A preview built on the GLB tangents must negate green (or w) to match the game. |
| 9 | Vanilla `_n` convention | Normal x correlates with −∂(alpha)/∂u (+0.27 to +0.88) and y with +∂(alpha)/∂(stored row) (+0.36 to +0.85) in every painted vanilla set, Arkhe style 18, Arkhe set 12 and Even More Brows 01: hairs are raised, green points down the upright image, as fact 8 requires. | [offline], inferred from alpha as a height proxy | The encoder writes green = tilt toward larger glTF v. |
| 10 | Formats (vanilla, per set) | `_d` 512 × 256, BC7 (`TCM_QualityColor`), `isGamma` 1, 10 mips, 174,800 bytes; `_ds` 64 × 32, BC7, `isGamma` 1, 7 mips, 2,768 bytes; `_n` 512 × 256, **BC5** (`TCM_Normalmap`, two channels, no blue), `isGamma` 0, 10 mips. All `allowTextureDowngrade` 1, mip bias 0. Hashes per set below. | [resource] | Export BC7 `_d` and BC5 `_n`; at 2048 × 1024 each is 2,796,240 bytes with 12 mips (2.67 MiB), as §3.5 estimated. |
| 11 | Vanilla `_d` RGB | Near-greyscale (R − G ≤ 17 of 255 under coverage, slightly warm); sRGB median 112–142 under coverage; coverage-weighted **linear mean 0.23–0.42, 0.30 on average** over the 13 creator sets. Where alpha is 0 the RGB is (72, 68, 62). | [offline] | Vanilla brows show about **0.6 × the gradient colour** (2 × 0.30), not the gradient colour. A tone centred on linear 0.5 (§3.6) would be 1.67 × brighter than vanilla brows in the same creator colour. |
| 12 | Mods' tone | Even More Brows 01: RGB 250–254 (linear ≈ 0.99) at intensity 2, so about 2 × the gradient before the clip. Arkhe II style 18: linear 0.55 at intensity 0.5 (their material edit), so 0.28 ×. Arkhe set 12 replacer: 0.74. | [offline] | Mods disagree by 7 ×; matching vanilla (0.30) is the neutral default. |
| 13 | Gradient sampling | The template's sampler `s1` (gradient) is **clamp**, linear, no anisotropy; `s0` (all other maps) is wrap, anisotropic, linear mips. The 35 gradients are 32 × 4 BC7, `isGamma` 1, 6 mips; the constant v 0.5 averages rows 1 and 2 (the four rows differ slightly in 16 files). The implicit LOD of a constant coordinate is mip 0. With clamp, `GradientMapUV` 1 reads exactly the last texel; `phoenix_fire`'s 0.75 blends texels 23 and 24. `black_carbon` sets nothing and inherits the template default `hh_cap_grad__black_carbon.xbm` and `GradientMapUV` 1. | [resource] | Answers the eyebrows page's open question 2. |
| 14 | The clip | Linear end-texel channels above 0.5 clip at `GradientMapIntensity` 2 in **7 of 35** colours: `blue_sky`, `blue_steel`, `citrus_yellow`, `green_orange`, `phoenix_fire`, `purple_blonde`, `red_apple` (largest 0.76). `blonde_platinum` peaks at 0.47 and does not clip. | [offline] | Hue shifts only for those 7; greyscale tone still survives every colour. |
| 15 | Secondary term | `_ds` RGB is never read (only `.a`). Powder colour = `SecondaryDiffuseColor` × s × (1 − raw primary alpha) × `SecondaryDiffuseAlphaIntensity`, with no gradient; coverage `(p + (1 − p)·s·I)²`. Vanilla `_ds` RGB is white, Arkhe's black; neither matters. | [source] | Confirms §3.5's `_ds` = 0 default; `_ds` can be any single-channel alpha. |
| 16 | Normal alpha | Vanilla sets `UseNormalAlphaTex` 1 and leaves `NormalAlphaTex` at the template's `white.xbm`, so the normal is written at `NormalAlpha` × the mode-1 tilt gate **regardless of coverage**. Vanilla `_n` texels outside coverage (alpha < 0.05) still average a gate of 0.04–0.11. | [source] + [offline] | `_n` must be exactly flat (128, 128) wherever there is no hair, or relief lands on bare skin. BC5's flat code gives a gate of 0.0008. |
| 17 | Mips | Vanilla `_d` alpha mips are a 2 × 2 box of the level above (mean error ≤ 1.3 bytes over the first three levels, up to 3.3 on the smallest, which is BC7 noise). Mean on-screen coverage (p²) falls to 0.69–0.94 of level 0 at mip 1 and 0.44–0.84 at mip 4. | [offline] | The coverage-preserving chain of §3.5 fixes a real thinning of vanilla brows too. |
| 18 | Unused sets | Sets 17–19 (styles 14–16, no creator option) are placeholders: alpha 255 everywhere, near-black RGB, one shared `_n`. Selected through a mod they would paint the whole strip dark. Sets 09–11 are ordinary painted brows with no `_ds`. | [resource] | Answers the eyebrows page's open question 5 at the texture level. |
| 19 | How mods ship textures | Arkhe II: `_d` and `_ds` 2048 × 1024 **uncompressed** RGBA8 (10.67 MiB each, 12 mips; `_ds` `isGamma` 0, black RGB), `_n` 2048 × 1024 BC5 (`TRF_DeepColor`). Arkhe SET 01: `_d`, `_ds` and `_n` 2048 × 1024 BC7/BC7/BC5. Even More Brows: vanilla formats and sizes. All three set `allowTextureDowngrade` 0. | [resource] | – |
| 20 | Creator entries | Row label = the switcher choice's `localizedName`, **plain text** in every inspected resource: vanilla `01`…`13` and `Common-Off`, Arkhe `Beautiful Eyebrows II  01`…, Even More Brows `EMB 01`…. Each style is a `gameuiAppearanceInfo` whose fields copy the vanilla ones (`uiSlot` `eyebrows_color`, `link` `eyebrows color`, `linkController` 1, `index` 191, `randomizeCategory` `Eyebrows`, `localizedName` `LocKey#43266`, `useThumbnails` 1, `Soft` app) with 35 definitions reusing the vanilla colour keys and icons (`UI-CharacterCreation-05_brown_liquorice`, `OptionsIcons.BrownLiquorice`) under definition names matching the app's appearances (`05_brown_liquorice`). Mods list only their appearance options in `TPP`, `character_customization` and `TPP_photomode`; vanilla also lists the switcher in `character_customization`. | [resource] | "XF <look name>" goes in the switcher choice's `localizedName`. ArchiveXL merges switcher choices **by that text** and a duplicate replaces the earlier choice ([CC file chain §5](../../knowledge/cc-file-chain.md#5-how-archivexlccxl-extends-the-lists)), so the exporter must keep labels unique across the collection and never reuse a vanilla or installed label. |

### Per-set texture identities

Depot folder `base\characters\common\character_customisation_items\eyebrows\textures\`; files `heb__base_dNN.xbm`, `heb_wa__base_dsNN.xbm`, `heb__base_nNN.xbm`. FNV-1a64 of the lower-case depot path; SHA-256 of the serialized texture data (all mips), first 16 hex digits. "Outside" is the share of on-screen coverage (p²) outside the male–female intersection.

| Set | Style | `_d` FNV-1a64 | `_d` data | `_ds` FNV-1a64 | `_n` FNV-1a64 | `_n` data | Linear tone | Outside |
|---|---|---|---|---|---|---|---|---|
| 01 | 01 | `14424546112531270409` | `b1a749755c95f9b4…` | `2183546139841793351` | `6519569037304863155` | `482732de5a575dc5…` | 0.31 | 0.00 % |
| 02 | 02 | `6503729325115685192` | `8086747256e6c425…` | `9467915109927779354` | `17841606286577615798` | `2be45a5f9ed00e8a…` | 0.28 | 0.00 % |
| 03 | 03 | `7896407094015625787` | `5d0ab7e9ff4255c8…` | `2346696114264515925` | `13109104785127699617` | `7480ab7f976fa878…` | 0.29 | 0.00 % |
| 04 | 04 | `16755807583783952618` | `f303f9d6c8d45354…` | `11582934815330067576` | `5792075969941060044` | `bd40bc9c26b56031…` | 0.26 | 0.00 % |
| 05 | 05 | `3440729423439884709` | `34fa47a6908c622e…` | `608444251415247019` | `10916177243305965871` | `4f3e8218c62ae375…` | 0.36 | 0.05 % |
| 06 | 06 | `10173942029078002292` | `c1fd0ff70eee5a1b…` | `2784234737455118478` | `15195236735988950242` | `f91b499e7e04a6c5…` | 0.26 | 0.00 % |
| 07 | 07 | `15297972933698702615` | `0abeeed1b1304f85…` | `7197944814865980729` | `8012902485995316989` | `587ddd2483f0e8bd…` | 0.23 | 0.00 % |
| 08 | 08 | `17132689775546305878` | `5dfc4f9721d62d72…` | `16434253884675737884` | `7020684485211207720` | `a538ab3ceed56802…` | 0.26 | 0.00 % |
| 12 | 09 | `4400940695577367801` | `41dc31483f909c91…` | `9200137107171601435` | `449225020039415223` | `11d9b7c119e69bb7…` | 0.34 | 0.00 % |
| 13 | 10 | `11954983698973943118` | `e01cf807c1682e7b…` | `1625991979030362024` | `13771656714151444500` | `a589f6370573f0d5…` | 0.42 | 0.02 % |
| 14 | 11 | `11354295101360617991` | `7f906fc70d1be5d8…` | `17009736151064113157` | `17830299446668925225` | `2812f0e77579ded6…` | 0.30 | 0.04 % |
| 15 | 12 | `18352197456046938980` | `9e39191f6593cd13…` | `11632905532935095114` | `7243491307356722814` | `2812f0e77579ded6…` | 0.30 | 0.05 % |
| 16 | 13 | `17751552838898742293` | `638ebddd1ec25745…` | `10612196938549166839` | `11494121779089067995` | `2812f0e77579ded6…` | 0.29 | 0.05 % |
| 17 | 14 (no option) | `436521752546942682` | `480948f2c21bba7c…` | `5243282804141754196` | `9909764134230162024` | `556fa3aa9680f5cd…` | 0.01 | 57.7 % |
| 18 | 15 (no option) | `1866974693935468611` | `480948f2c21bba7c…` | `7714412278946853921` | `4912476126708759869` | `556fa3aa9680f5cd…` | 0.01 | 57.7 % |
| 19 | 16 (no option) | `719461629799062352` | `480948f2c21bba7c…` | `12446913780396770102` | `12094810376702393122` | `556fa3aa9680f5cd…` | 0.01 | 57.7 % |
| 09 | none | `12400188274096389697` | `724bd0ace1e06d81…` | – | `14594829613352447131` | `3fef2caa12626eb5…` | 0.37 | 0.00 % |
| 10 | none | `16258465680813007723` | `6f7f618b7fedd84f…` | – | `612093519485315781` | `561781f631e6bdc8…` | 0.38 | 0.00 % |
| 11 | none | `2551822932926052920` | `14f5ef9c0cb637f3…` | – | `1714816844212055818` | `d305480c0659f975…` | 0.43 | 0.00 % |

Mod textures: Arkhe II `arkhe\ccxl_eyebrows_02\textures\ark_heb__base_d18.xbm` (`12014415929380493100`), `ark_heb_wa__base_ds18.xbm` (`8825559761805751330`), `ark_heb__base_n18.xbm` (`11366430283384820302`); Even More Brows `coralinekoralina\ccxl\evenmorebrows_ccxl\textures\ck_emb_01_d.xbm` (`17759940098946723661`), `ck_emb_01_ds.xbm` (`4120901230496529872`), `ck_emb_01_n.xbm` (`1043522608271809863`); Arkhe SET 01 replaces the vanilla set-12 paths above.

## Method

| Script | Measures | Output (ignored) |
|---|---|---|
| [`geometry.py`](geometry.py) | Per-triangle ∂P/∂u and ∂P/∂v in mm from WolvenKit's bound GLB exports; orientation against \|x\| and height; deviation from one constant scale (singular values of the scaled Jacobian); footprints rasterised at texel centres, per side and gender, their intersection and erosions; mirror-pair UV sharing; stored tangents against ∂P/∂u and cross(N, T)·w against ∂P/∂v; male ÷ female metric at the same texel | `geometry.json`, `jacobians.json`, `footprint_*.png` |
| [`native_frame.py`](native_frame.py) | Decodes the mesh render buffers (UV0 float16, normal and tangent `PT_Dec4` = R10G10B10A2 UNORM, expanded as x·2 − 1 as the vertex program does) and compares them with the GLB: v flip, tangent direction and sign | `native_frame.json` |
| [`textures.py`](textures.py) | Every stored mip of the vanilla and mod XBMs: headers, SHA-256, decoded tone and greyscale levels, content boxes, coverage outside each footprint for both row orders, alpha mips against a 2 × 2 box, mean coverage per level, `_n` tilt, gate inside and outside coverage and its correlation with the alpha gradient | `textures.json` |
| [`materials.py`](materials.py) | `.mi` chain parameters, the 35 gradients sampled with clamp (and wrap, for comparison) and the clip, the meshes' style overrides, the eyebrows switcher and options in the vanilla and mod creator resources | `materials.json` |
| [`report.py`](report.py) | Prints the per-set table above | stdout |

Template parameter defaults and sampler states were read from the serialized `mesh_decal_double_diffuse.mt` in the ignored `research/consumers/base-brow-template/`; the programs with the repository's [`shader_cache.py`](../../research/materials/shader-system/shader_cache.py) `find`/`extract` and the decompilers above.

### Rerun

From this folder, with the main checkout's ignored extracts (paths relative to the main checkout) and the full interpreter path, each under the memory guard (peak 0.7 GB):

```powershell
$py = "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe"
$c = "D:/Dev/cp2077-modding-hq/research/consumers"
& $py ../../tools/memory_guard.py --limit 3 -- $py geometry.py --extracts $c/brows-cheeks
& $py ../../tools/memory_guard.py --limit 3 -- $py native_frame.py --extracts $c/brows-cheeks
& $py ../../tools/memory_guard.py --limit 3 -- $py textures.py --vanilla-json $c/brows-cheeks/json/xbm --mods-json $c/brows-cheeks-mods/json
& $py ../../tools/memory_guard.py --limit 3 -- $py materials.py --extracts $c/brows-cheeks --mods-json $c/brows-cheeks-mods/json
& $py report.py
```

Recreating the extracts: the [evidence note](../../research/character-customization/brows-cheeks-evidence.md#tools-and-inputs) lists the WolvenKit commands.

## Limits

- Everything is offline. That the per-triangle metric, the green convention and the coverage encoding look right in game stays a runtime question (the design's test asks 2–4).
- The `_n` convention in fact 9 is an inference: it assumes the painted alpha is a fair height proxy. It agrees in sign with the engine frame (fact 8) in all 16 painted vanilla sets and the three mods inspected.
- The metric comes from the neutral mesh. Morph targets move the strip (the eyes, nose and jaw targets); a V with strong eye shapes stretches it further. The engine should measure the neutral mesh, as the earlier project did.
- The footprints are texel-centre rasters at 2048 × 1024; at 1024 × 512 they are the 2 × 2 reductions.
- The creator resources show what mods ship, not how the creator renders a plain-text label with non-ASCII characters.
