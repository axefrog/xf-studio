# Eye rendering: evidence and provenance

25 September 2026. Provenance behind the [eye rendering](../../knowledge/eye-rendering.md) knowledge page. Offline, read-only inspection: no game launch, no MO2 launch, no write under the game or MO2 folders. Extracted resources, serialized JSON, decoded PNGs, shader disassemblies and scratch analyses stay in the ignored `research/consumers/eyes/raw/` of the working checkout (`vanilla/`, `vanilla-json/`, `png/`, `glb/`, `mods/`, `shader/`, `analysis/`).

## Tools and inputs

| Input | Version / identity |
|---|---|
| Installed game | 2.31 with Phantom Liberty, at `PATH_TO_GAME` |
| `PATH_TO_GAME/engine/shader_final.cache` | SHA-256 `339145371a3b5aaa08eb4ef82d558f445b632e28603ee0f3b4860270dfc3ccfa` |
| `PATH_TO_GAME/engine/staticshader_final.cache` | SHA-256 `bff160947aba8df144200247adc39b44c26322360628d875f7c7218ad26c59ff` |
| `basegame_4_appearance.archive` (eye meshes, apps, morphs, `.mi`, gradients, textures) | SHA-256 `9c20370467e71d49ffb0a6415fe0415b2349ac22fe5afd38daf2783f54f2443b` |
| `memoryresident_1_general.archive` (templates) | SHA-256 `71d3d4116eee455b75309e0c36f5af5aa2fef17ecf509639c3e3a622fcf32295` |
| WolvenKit CLI | 9.0.1 (`unbundle -r`, `convert s`, `export --uext png -gp`, `uncook --mesh-export-type MeshOnly -gp`) |
| Shader tools | The [shader-system method](../materials/shader-system/README.md) (`shader_cache.py`, `shader_annotate.py --decompile`; dxil-spirv `f2d1b554`, SPIRV-Cross `aa217aeb`; Windows SDK 10.0.22621 `dxc`), run through a small wrapper that points its output at `research/consumers/eyes/raw/shader/` instead of `research/consumers/shader-system/` |
| ArchiveXL | Installed 1.27.3.0 (MO2 `meta.ini`); bundle `ArchiveXL.archive` SHA-256 `70b2967832555292712cc583753da4823113dc7a3f388030b45c6966909241d3`; source clone at `5474e34d56112f5d8843ae863e1e72ff510957c0` |
| Modding Docs | Local clone at `be2f44eed8419342ec13f72ed9cab008e9f7b289` |
| MO2 | Selected profile at inspection: `XF Studio diagnostic 2026-09-25`; the eye mods have the same enabled state in `2025 (again)` |

WolvenKit regex note: from Git Bash, a .NET regex over backslash depot paths needed four backslashes inside single quotes (`'characters\\\\common\\\\eyes\\\\'`); two produced `RegexParseException … Illegal \ at end of pattern` with exit code 0.

## Compiled programs

| Program | Role | DXBC SHA-256 |
|---|---|---|
| `eye_gradient` `gbuffer_regular` pixel `10020572278408962832` | Eye G-buffer writer with gradient (shared by the MeshSkinned and MeshExtSkinned compilations) | `cf4b1423c4c1241ff81434e58e65a0b7ac1b9eb75353c13613b05e13fff533c7` |
| `eye_gradient` `gbuffer_velbuff_regular` pixel `776001972724306108` | Same, plus velocity; per-eye constants at `MaterialModifiersConsts` 6/7 and 10/11 instead of 2/3 and 6/7 | `3a1b5062e7a558e8d28c69a9ca41625e00a8860a485c9c04517c9eaece7a4921` |
| `eye_gradient` vertex `1226803013347725086` / `11812954726399949237` | Pass raw UV0, N, B = `cross(N,T)·w`, T, world position | `6ea44d888c8aedd8aa57ad350efff573b9c6fc9582662c3dc64d521d0cf6c21e` / `7ff6d16ca0f9979cf2b99dc9ede860b3734acc4f364b0f959b8c85a7856172c5` |
| `eye` `gbuffer_regular` pixel `14845425953312192161` | Texture-only eye; identical arithmetic minus the mask and gradient lines | `38cc7fb4b2800be113c1075e428eb609a49036c5b8a61ca008286612926f42d3` |
| `eye_shadow` `transparent_back_face` pixel `14043594489545752539` / vertex `10390499172143877202` | Wetness shell | `54e65aa46e0c224a3dcd35fc90d81c61fa30e47c2486392300902e64636266e0` / `f0a0826c31f1c4967c729fa0d88a7c00a4d8f0653df0dd29541ea7bcedc2caf2` |
| static `m_shaderLightsComputeGlobalLocalShadows_Clustered_11111111`, compute `6606735909222169407` | Deferred light: eye decode `%155`–`%192`, sun eye branch `%476`–`%572`, eye local-light loop `%2098`–`%2764` | `c0ce7b53584553eb3b6bba3cb75f7125f1bddc07cf34511060487212010dac86` |
| static sun shadow-mask program `1844879209050928149` (name attribution heuristic) | Decodes N2 for class 3 (`%90`–`%132`) and zeroes the shadow when `sunDir·N2 < 1e-4` (`%137`–`%145`) | `f9b3e4c31a3ac4e4e0c06c7ef72135cf2f783ae6c230f75c6fe4f10892ced19e` |
| static ambient/integrate pixel program `10393055107398307099` (name attribution heuristic) | For Eye: emissive and the skin term forced to 0, probe-specular weight 1 (`%229`–`%234`); ambient on N1; occlusion terms forced to 1 when `cb6[9].z` is off (`%1077`–`%1081`, `%1208`–`%1211`) | `7df07e2d0e594b5f65ab225198890d52c7ead1cced8a04bca9cc4eaa273649b9` |

Other light variants carrying the eye BRDF (by content, the static name index being heuristic): `…GlobalLocalShadows_00001001` `6401500188092573977`, `…RT_00001001` `8595463782375003625`, `…_00011011` `17409193996670112058`, `…RT_00011011` `10208394446357008445`, `…RT_11111111` `17294978391357308168`, `GlobalOnly_11111111` `4051694192440103074`, plus at least 13 unnamed compute programs with lighting switches `[0,3]`, `[0,1,3,4]` or `[0,1,3,4,5]`. No Eye-only variant exists.

### G-buffer program readings (`10020572278408962832`, SSA of its `.ll`)

| Step | SSA |
|---|---|
| Iris weight from UV radius | `%66` |
| Refracted iris-plane coordinate `uvC` | `%216`, `%217` |
| `Normal` RG unpack, TBN → N2 | `%218`–`%246` |
| `NormalBubble` sample | `%247`–`%265` |
| Egg bulge, blend, TBN → N1 | `%271`–`%345` |
| `IrisMask` R/A, gradient sample `t55` at `(R, (reg6 + 0.5)/512)` | `%359`–`%365` |
| Colour blend `albedo + (gradient − albedo)·A`, square root | `%366`–`%377`, `%461`–`%463` |
| `Roughness` R × `RoughnessScale` at the raw UV | `%386`–`%389` |
| Back-face reflection of both normals | `%390`–`%419` |
| Octahedral 10-bit encoding of N2 into GB0.w, GB1.w, GB2.zw | `%424`–`%446` |

The structured listing (`10020572278408962832.decompiled.hlsl`, SPIRV-Cross ids, not SSA) was used for the formulas on the knowledge page and checked against the lifted listing.

### Inert parameters

Every pixel program of `eye`, `eye_gradient`, `eye_blendable` and `eye_morph`, all passes and vertex factories, was disassembled (`shader/eyefam/`); none reads `Blick`, `BlickScale`, `SubsurfaceFactor`, `AntiLightbleedValue` or `AntiLightbleedUpOff`. The highlights, depth, cascade, velocity and wireframe passes bind no `cb4`. All 845 static programs were disassembled (`shader/static_all/`); none is named for eyes, irises, corneas or catch lights.

## Resources

| Resource | SHA-256 |
|---|---|
| `base\materials\eye.mt` | `c6eff77a473912680a5d3e2e439ef4fe6d9e664ee6238d0745e1e39b801e073e` |
| `base\materials\eye_gradient.mt` | `348ec8d2b88288dec4fea5dca69f4d15bcc0c2c3c0b89111bf4f922fdb0f36f5` |
| `base\materials\eye_shadow.mt` | `9b1480fdf2470900c240e0a4849a2d4b4faa23c3e4bf08f4893243739e418ad0` |
| female eye mesh `…\player_female_average\h0_000_pwa_c__basehead\he_000_pwa_c__basehead.mesh` | `4d5dfa91efdf54485c5637ad34d64c32ae2f02cad7c52915062f3a0ec0f7aa19` |
| male eye mesh `…\player_man_average\h0_000_pma_c__basehead\he_000_pma_c__basehead.mesh` | `22b8d2ac4a0ab19b4e85d203f392af273f718abdb858eff543248c061ef683a6` |
| `…\appearances\head\he_000__basehead.app` | `cb921d5379182d1616b0322f47f1f3a80c41af75092fcf9ac2a02df09af23a60` |
| `he_000_pwa__morphs.morphtarget` / `he_000_pma__morphs.morphtarget` | `42a19b6a4d2f4060f6785de525d8c55f663fb2a13db804cd84e929e5110d1323` / `9e73062dccc94c270b9477ce24d1cdfc703a9c855349ed261c9d591c12669d6b` |
| `eyeshadow_base.mi` | `c8cd52dada67db836eb4bff2f409d96a61589b725fc3713673f063231b73a9e8` |
| `brown_eye_gradient.mi`, `red_eye_gradient.mi` | `3dab26626dece44d46811c00504d75a65971bbdfcf2d72871324906cb896c676`, `a6a754ac72f103219f733b4ef9a4ac5c27f9a657589032aa095ab530074835b4` |
| `rebecca_eye_blue.mi`, `black_eye_multilayer.mi` | `ddcf694a3edca452ae377b190f1e3bced9bf3873ae121d1dcf4ef5461f9011ad`, `ae4bdae5ab3cb3c34a03e4fd3c0279b3df09e90ee61770396fe9fc7503d2d26a` |
| `eye_black.gradient` | `71fb47d43bd98cb2dc399f45aee0a930e05396a0c044106de542720bcc3c9302` |
| `eye_blue.gradient` | `86d98241c96b355119d0966cdf1f745dcac431a183c81ecf4228699cdf03188a` |
| `eye_blue_light.gradient` | `ea6b2920439366ea1886543e41d2b1d3eb6e3ce7caad0b1b98cd77d816d76b54` |
| `eye_brown.gradient` | `a0316560105d88121dab00467ed1ff22a361db528ce9d7db019717e12fea5e04` |
| `eye_green.gradient` | `0ab0f3734169cb1f4fc69764f9dcb35fa30d2f0695a100fa0e3705e18abc6f38` |
| `eye_grey.gradient` | `929219e59e4436fc6e166bd213b8d1739d7c8fc51d7847585d4b4ce1b856cf62` |
| `eye_red.gradient` | `94e573e263cc63fbfb70d5f74c667d5a79d61b858a99bbe8b6e744b43351fde0` |
| `eye_violet.gradient` | `d724eadf436614dcc6620da893bbb830a9682d295b13dd331247639da4cb6bc7` |
| `eye_yellow.gradient` | `1d415702f2e34bee730c18f602b9e22ae7e13cf60ae4bf440d2463413a3c5704` |
| `he_000_base_d02.xbm`, `he_000_base_d11.xbm` | `d1afea0622075a02c69110fbe390ba22d8c5275a6bce304d063def856f3888e1`, `d2228763c14058aad41a2de9ad9fc81ef220e9811e021f4e1705ce39c15da322` |
| `he_000_base_n01.xbm`, `he_000_base_rm01.xbm` | `837d21fb747ddeafb80cd5d338c51031cc0321f160c76e772da694c2c386df0d`, `fdd37f4a9644820042aaed4ab9410420a4340354ca8e489563bb3e9f51ab9784` |
| `eye_mask.xbm`, `normal_bubble.xbm`, `eye_shadow_mask.xbm` | `0718cc7d1fe42e7d2ee6cdf2ad99009e08c0e45111e938398d8648004e022a72`, `091465790a11805210cd8a3fbc1207f00ba224c76589022a93a5308cb521247c`, `79e351c5bbbdf96e82b0179b60fe7ac3232430757a512e9fa0f30eadbc83860b` |
| ArchiveXL `archive_xl\…\appearances\head\he_000_pwa__basehead.app` | `101ebdec70595593fc72e3a89f4d92281ac5caa3a6ef2261e3d402fe54a9eb6a` |
| ArchiveXL bundle `PlayerCustomizationEyesFix.xl` / `…EyesPatch.xl` / `…EyesScope.xl` | `f2fc3657f8620f81fe58049bc2dbca13534c8a8a6da299bda70914b070854c39` / `2b1e3736764b4de5aea6d55120703fcf5bc0249441851fc8dbee489df013c527` / `58d06e94151cb49de1004bee265f3dbf7e189a3a15de495a01129740bc06dbd6` |

### Observations recorded here in detail

**The 71 female creator colours** (`female_cco_ep1` option `eyes_color`, `index 1–71`; each definition's app component uses chunk mask `18446744073709551614`) [resource]:

| Creator index | Mesh appearance → material | Template |
|---|---|---|
| 1–9 | `gradient_brown`, `_blue`, `_black`, `_green`, `_grey`, `_light_blue`, `_red`, `_violet`, `_yellow` → `<colour>_eye_gradient.mi` (light blue: `blue_eye_gradient_light.mi`), Albedo `he_000_base_d02` | `eye_gradient` |
| 10–18 | `blood_gradient_<same order as 1–9 but black first>` → `…_eye_gradient_blood.mi` (black: `black_eye_gradien_blood.mi`), Albedo `he_000_base_d11` | `eye_gradient` |
| 19–49, 56–61 | `multilayer_<design>` → `<design>_eye_multilayer.mi`, `MultilayerMask` `eye_ml`, `eye_ml_02` or `eye_ml_03`, `MultilayerSetup` `<design>.mlsetup` (20 layers) | `multilayered` |
| 50–55 | `rebecca_pink`, `_green`, `_cyan`, `_red`, `_blue`, `_baby_pink` → `rebecca_eye_<colour>.mi`, Normal `he_000_rebecca_n01` | `eye` |
| 62–71 | `cybereye`, `cybereye_black`, `double_eye`, `double_eye_black`, `ring_orange_eye`, `ring_green_eye`, `stand_clear_eye`, `stand_clear_eye_black`, `circle_pink_eye`, `circle_orange_eye` | `eye` (circles: horizontal angles ±3.6) |

The female mesh has 107 appearances and 108 local material entries; beyond the 71 colours, 35 `eyelashes__<colour>` appearances serve the lash option (their eye chunk reuses `black_eye_gradien_blood.mi`, hidden by the lash chunk mask), and `default` is `metal_base.remt` on all three chunks. The male mesh has the same set with chunks 1 and 2 swapped (its material entry names differ in places, e.g. `eyeMat3`, `eyeWetness_MAT3` on `gradient_violet`) [resource]. The per-appearance catalogue is `analysis/catalogue.json` and `analysis/eye-colours-female.json`.

**Eyeball geometry** (female eye GLB exported by `uncook`; glTF axes) [resource]: per eye a least-squares sphere of radius 13.69 mm, vertex distances 13.68–13.82 mm, normals radial to within 0.01; pupil vertex at raw U 1.5 (eye centre game x −0.030 m, `l_J_eye_JNT`) and U −0.5 (x +0.031 m, `r_J_eye_JNT`). Height along the eye axis by UV radius: 13.69 mm at 0, 13.0 mm at 0.145, 12.5 mm at 0.165, 10.6 mm at 0.25. Shell vertices lie 13.66–14.50 mm from the eye centres (median about 13.87 mm); shell UV spans U 0–1 and glTF V 0.048–0.406 per eye. The eye joints' bind frames (`boneRigMatrices`) map joint local X to world up, local Y to world backward and local Z to +X, so the joint forward is local −Y.

**Texture channels** [resource] were measured from WolvenKit's PNG exports: `eye_mask` iris ring A ≈ 1 for UV radius 0.06–0.15, R median 0.345 (10th/90th percentile 0.19/0.55) inside it; `he_000_base_rm01` R about 80/255 inside UV radius 0.15, about 26/255 outside 0.2; `he_000_base_n01` mean tilt 50–61° in the iris, under 3° on the sclera; `normal_bubble` ±1.5°; `eye_shadow_mask` R 2–255, G 105–109, B 0–44, A up to 146 (unread). Iris-colour predictions for the nine profiles under the raw and decoded mask readings are in `analysis/gradient-iris-predictions.json`.

**Morph `baseTexture`** [resource] [source]: both vanilla eye morphs set `baseTexture` `engine\textures\editor\normal.xbm` and `baseTextureParamName` `Normal`, with 21 targets whose `targetTextureDiffsData` arrays are all empty. `PlayerCustomizationEyesPatch.xl` copies each to `…_morphs_normal_fix.morphtarget` and patches `baseTexture` and `baseTextureParamName` from `archive_xl\common\null.morphtarget`; ArchiveXL's `ResourcePatch/Extension.cpp:668-678` applies exactly those two properties. The ArchiveXL eye app's second appearance `he_000_pwa__basehead__mod` binds morph hash `2971506501429392748` (the fix copy); its first binds the vanilla morph. The female head morph `h0_000_pwa__morphs.morphtarget` names the head's own normal `h0_001_pwa_c__basehead_n01.xbm` as `baseTexture`.

## Mod eyes (reference MO2 profile)

Resource inspection only; extracted payloads stay under `raw/mods/`. `MO2_MODS` stands for the MO2 mods folder.

| Mod (Nexus id, installed version, enabled) | Mechanism observed | Key file SHA-256 |
|---|---|---|
| Photoreal Eyes CCXL (22412, 1.0.0, yes) | 32 definitions; `@eyes` template entry → soft `.mi` → `eye.mt`; soft `Albedo`/`Normal` | `MO2_MODS/Photoreal Eyes CCXL/archive/pc/mod/id_photoreal_eyes_ccxl.xl` `6bc8ce60f912235aadb03a36ca1ffe8bd7802ccb12038ea43adcb74d17c252e3`; `.archive` `273c6e879641333fc48d4e46ed935919096894f15ffce3aba4c357cafb223160` |
| Unique Eyes to CCXL (23263, 1.0.0, yes) | 39 definitions on `eyes_color` and `link: eyes_color_2`; per-colour `eye_NN_diffuse@eyes` entries → `eye_base.mi` → `eye.mt`; fixed `base\eyes\textures\eye_NN_*` paths; `.xl` fallback links | `.xl` `a2b154cb3d20a9a5ff16a1c0fbaa4807f74441cc6bb7ad0e9f5d098069dbbfdd`; `.archive` `29636cc75d4d09f1c138aa82ad02324f03dee4b9e8c60fe557bb95db67fcded9` |
| Kala's Eyes Standalone V2 (3242, 1.0.0, yes) | Texture-only archive supplying the `base\eyes\textures\eye_NN_*` triplets | `.archive` `e79e609dd009bf747d3cdff6844b480d8d0709ab7c920d067d3fc941e3c6a127` |
| Pit Eyes – CCXL (23665, 1.0.0, yes) | 14 definitions; local `@eyes` entry → `eye.mt`; soft `Albedo`, fixed `Normal` | `.xl` `838c0a1800964d733bbf5e0c2c15bacd6844a76e82f42bb49a80d848a572b146`; `.archive` `f7e3288fee8dd87893c444516a7633ff2527ef95deedc1cb5898e360a782f9e4` |
| FORBIDDEN EYES – CCXL (23363, 1.0.1, yes) | 18 definitions; as Pit Eyes | `.xl` `bdc937d68947a5b269fb90e6c7d44cb05844bc8fb5d043eb8b18ddf1ec752fb9`; `.archive` `a15fa1b4c76e826270b8bf1ea78b2f8ad435091aa8de89c8e1bc32a163cdaa7c` |
| Beautiful IRIS III – CCXL (25619, 1.0.0, yes) | 80 definitions; `@eyes` → soft `.mi` → `eye.mt`; soft `Albedo` and `Normal`; no expansion tag, so the context's expansion source applies | `.xl` `75a4713498de0b621925b0143b9564b7101d99d92f39a4b545f5ba5f1eba86c2` |
| Beautiful Exotics – CCXL (25718, 1.0.0, no) | 39 definitions; local `@eyes` → `eye.mt` | `.xl` `7ddca386a66b3e48149e2fa0038dae11cb44f9eab6d516016d707bdce4ebd93b` |
| Heterochromia Eyes – CCXL (20349, 2.0.0, no) | Switcher `heterochromia`; left/right options (`eyes_color` / `eyes_color_2`); separate left and right apps with split-eye morph meshes (`[lashes, eye, wet, eye, wet]`, masks `…590` and `…608`); 108 `X@eyes` entries copying vanilla `.mi`s; same-path `he_000_rebecca_n01.xbm` and `he_000_circle_n01.xbm` with different bytes | `.xl` `0770e62d667f7b3971d3bc73ca4c3564fd9568f6111e749ec685678a3df23d73`; `.archive` `2b42b435570f8a80801ccc84d73a004dd243557d97652da494b290eaff89e407` |

An index scan of every MO2 archive for the eye meshes, their 114 `.mi` paths, the eye templates, base eye textures and the female eye morph found no same-path replacement except Heterochromia's two normals and a male eye morph override in Facial Customisation Rig Fix. No mod changes `eyeshadow_base.mi` or `eye_shadow.mt`. Authorship of Pit Eyes, FORBIDDEN EYES, Beautiful IRIS III and Beautiful Exotics is evidenced only by depot namespaces or install file names and is listed on the [provenance follow-ups](../provenance-followups.md).

**Modding Docs** [wiki]: `for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-eye-textures.md`, published by nutboy and island_dancer, last documented edit by icxrus (per the page). L244-252 and image `.gitbook/assets/roughness_xbm_setup.png`: the base-game eye roughness map is an RGB image with linear gamma. L267-271 and image `.gitbook/assets/inverted_y_03.png`: albedo textures must be inverted on Y, normal maps regenerated rather than flipped. Images `ccxleyes012 (1).png` (the `@eyes` soft `Albedo`) and `ccxleyes017.png` (`.xl` normal links) show the template setup the mods follow. Editor examples, not runtime proof.

## Limits

- Every rendering claim is offline: compiled-program reading and resource inspection. The per-eye `MaterialModifiersConsts` source, the gradient atlas bake, the `isGamma` sampling of `eye_mask`, the morph `baseTexture` binding and the global eye render options are open (knowledge page, open questions).
- Static-program names come from a heuristic index; the sun-shadow-mask and ambient programs are identified by content.
- The male V was checked for chunk order and appearance set only.
