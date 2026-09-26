# Creator and mirror lighting: evidence

25 September 2026. Provenance for [creator lighting](../../knowledge/creator-lighting.md): which resources and programs were read, their hashes, how they were read, and the install state recorded. No game launch took place. All reads were read-only. Extracted resources, JSON and decompiled programs stay in the ignored `research/consumers/cc-lighting/raw/` and `research/consumers/shader-system/raw/`. This note records names, hashes and derived numbers only.

## Tools and inputs

| Item | Identity |
|---|---|
| Game | Cyberpunk 2077 2.31 (`bin\x64\Cyberpunk2077.exe` product version), at `PATH_TO_GAME` |
| WolvenKit CLI | 9.0.1 console release (`archive -l`, `extract`, `uncook --uext dds`, `convert serialize`) |
| Decompiler | dxil-spirv `f2d1b554`, SPIRV-Cross `aa217aeb`, via the [shader-system method](../materials/shader-system/README.md); `shader_cache.py extract` with Windows SDK `dxc` |
| Static shader cache | `PATH_TO_GAME\r6\cache\staticshader_final.cache` (the index the shader-system tools build) |
| Clones read | Cyberpunk-Modding-Docs `be2f44ee`; Cyberpunk Blender add-on `7a4ee79`; WolvenKit `11720772`; red-dump-json `a8e52990` |
| Mods read | The reference MO2 instance's mod folders and its profiles `2025 (again)` and `XF Studio diagnostic 2026-09-25` (identical for the rows below) |
| Scripts | [`creator-lighting/`](creator-lighting/): `dump_sector.py`, `rig.py`, `rig_table.py`, `rig_gains.py`, `rig_normals.py`, `lut_axis.py`, `scan_mods.py`, `compact.py` |

## Resources (SHA-256 of the extracted file, first 16 hex digits)

| Depot path | Archive | SHA-256 |
|---|---|---|
| `base\worlds\04_main_menu\_compiled\default\quest_fc76e8948d75e8d4.streamingsector` (female box) | `basegame_2_mainmenu` | `f9ba075a8147ac35` |
| `…\04_main_menu\_compiled\default\quest_a0f0cd2476942221.streamingsector` (male box) | `basegame_2_mainmenu` | `22a4f20febac18fe` |
| `…\04_main_menu\_compiled\default\always_loaded_0.streamingsector` (scene markers) | `basegame_2_mainmenu` | `19e4695c39835c51` |
| `…\04_main_menu\_compiled\default\04_main_menu.streamingworld` | `basegame_2_mainmenu` | `f63cd40504f0d761` |
| `base\worlds\03_night_city\_compiled\default\quest_a73ac4b55b3d6ec1.streamingsector` (female box) | `basegame_3_nightcity` | `d64522df3013c098` |
| `…\03_night_city\_compiled\default\quest_8cf966bb983a0158.streamingsector` (male box) | `basegame_3_nightcity` | `74f1bb415988a9f0` |
| `base\gameplay\gui\fullscreen\main_menu\target_face.ent` | `basegame_3_nightcity` | `859649e67b2969ff` |
| `…\main_menu\gender_selection_female.ent` | `basegame_3_nightcity` | `8092a096e759d855` |
| `…\main_menu\prefabs\empty_room_char_creation_female.ent` | `basegame_1_engine` | `14d341e309c5622d` |
| `…\main_menu\prefabs\empty_room_char_creation_male.ent` | `basegame_1_engine` | `81219c16bbfdb142` |
| `…\main_menu\character_creation_step_6.inkwidget` | `basegame_1_engine` | `fe40cac689fdef7f` |
| `…\fullscreen\ingame_character_creation_menu.inkwidget` | `basegame_1_engine` | `0e890670b1f6d231` |
| `…\fullscreen\menu.inkmenu` | `basegame_1_engine` | `ca659a2f3288e180` |
| `…\main_menu\pregame_menu.inkmenu` | `basegame_1_engine` | `df9f5431a6e07d75` |
| `…\main_menu\preview.dtex` / `preview.inkatlas` | `basegame_1_engine` | `82daffffc3d44acf` / `19fb2020ae9c3645` |
| `base\items\quest\q110__misc\q110_black_box.mesh` | `basegame_3_nightcity` | `4b9f9c1fca56be42` |
| `base\weather\24h_basic\cp2077_master_env_nge_v002.env` (menu world) | `basegame_2_mainmenu` | `20b79a0704ff7d64` |
| `base\weather\24h_basic\cp2077_master_env_ep1_v006.env` (Night City world) | `basegame_3_nightcity` | `827ec106af8c60a3` |
| `base\weather\24h_basic\luts\cp2077_gen_lut_nge_v017.xbm` (SDR) | `basegame_3_nightcity` | `49386685745d7f01`; texture blob `a95c29f6f8fe1bc8` |
| `…\luts\cp2077_gen_lut_nge_hdr_v017.xbm` (HDR) | `basegame_3_nightcity` | `458d01b829b6962a` |

The Night City world's `03_night_city.streamingworld` names `cp2077_master_env_ep1_v006.env`; the menu world names `cp2077_master_env_nge_v002.env`. The nine standard `24h_weather_*.envparam` files were serialized; six of them override `ExposureAreaSettings` and none overrides colour grading, tone mapping or camera settings.

## Programs

| Technique | GUID | SHA-256 | Read for |
|---|---|---|---|
| `m_shaderLightsComputeGlobalLocalShadows_Clustered_00000001` | `10862954502888615639` | `d2babcec049fe682…` (matches the [shader-system table](../materials/shader-system/README.md)) | Local-light loop: 32-dword light records; falloff `(flags & 256) ? saturate(1 − (d²/r²)²)² / max(d², 1e−4) : 1 − saturate(d·invR)`; clamp under flag 512; spot `pow(saturate(a·cosθ + b), c)` (flag 1); IES row lookup; cut-off `0.01/(R+G+B)` |
| `m_LUTGenerateLinear` | `7299616531647440496` | `75da7975030bc86e…` | Grading-LUT bake: log2 grid, lift/gamma/gain, split-toned offsets, contrast, hue, saturation, per-LUT input mapping (0 linear with soft clip, 1 sRGB with soft clip, 2 ARRI LogC3 EI 800), `(R,G,B) → (u,v,w)` sampling, output mapping (sRGB decode when flagged), weighted sum of up to eight LUTs |
| `m_computeExposureScaleBuffer` | `13063388872850500556` | `fbf7a2621756b5f7…` | Only a per-pixel mask-driven exposure scale; the photographic-to-exposure conversion is on the CPU |

## How the rig numbers were derived

1. `dump_sector.py` prints every node of a serialized sector. `rig.py` takes each `worldStaticLightNode` relative to the box's population spawner and rotates local +Y by the node quaternion to get the spot axis.
2. The spot-axis convention was checked against geometry: every light named Main, Fill or Rim points at V's head to within a few degrees (Main_Eyes 3.7°, Rim_Top 2.5°). A local −Z axis would point several of them at the floor. The Blender add-on's sector importer uses the same local-Y convention.
3. `rig_table.py <sector.json> <yaw> <head height>` writes the Studio-frame table. `rig_gains.py` adds the at-head contributions under the stated hypotheses; `--half` selects the half-angle cone reading. `rig_normals.py` gives Lambert-weighted totals for six head normals. Example: `python rig_table.py <raw>/json/quest_fc76e8948d75e8d4.streamingsector.json -125 1.62`.
4. Menu-world against Night City boxes: every light, relative to its spawner, matched in every field compared (position, axis, type, unit, lumen, EV, colour, temperature, radius, inner and outer angle, falloff, source radius, softness, shadows, contact shadows, roughness bias, specular and diffuse scale, light channel, attenuation clamp), for both sexes.
5. Unset light colours (serialized as (0, 0, 0, 0)) in a 150-sector sample (every 16th of the 2,356 Night City quest sectors): 15 of 197 light nodes. They include temperature-driven lights (`{sky_main}` at 12000 K, `{campfire}` at 2200 K) and ordinary work lights (`{L_Tent_Ceiling}_010`, 200 lm, next to sibling nodes with an explicit white). WolvenKit's generated classes contain 32 `Color = new CColor()` defaults and no non-zero `CColor` default, whereas `HDRColor` defaults such as (1, 1, 1, 1) are recorded. So WolvenKit cannot show a non-zero class default for `Color`.

## LUT neutral axis

`lut_axis.py` decodes the serialized texture blob as `[B][G][R]` RGBA float32, the order the bake program's `(u, v, w)` sampling implies. It encodes scene grey with LogC3 (EI 800), samples trilinearly at `LogC3·(N−1)` and prints linear output and 8-bit sRGB. The WolvenKit 9.0.1 DDS export of the same texture produced a non-monotonic diagonal, so it did not preserve the texel order, and was not used.

| Mod package | Archive SHA-256 | Replaced SDR LUT: size, blob SHA-256 |
|---|---|---|
| Nova LUT 3.0 (AgX - HDR Support), Nexus 11622, v3.0.0.0, `#####-NovaLUT-3.archive` | `7265e7e649cf9c93…` | 64³, `ffe4f870d140bc91` |
| Preem LUT 3.0 (ACES - New HDR), Nexus 11510, v3.0.2.0, `###-PreemLUT3.archive` | `9a0dc5b921c6133d…` | 64³, `5f775c36ab594998` |

Both packages also replace the HDR LUT path. `scan_mods.py` (RDAR index hashes over every mod archive) found no mod that replaces the menu inkmenus, except Mod Settings, which ships its own copies of `menu.inkmenu` and `pregame_menu.inkmenu`. Their creator entries were not compared with vanilla. No mod replaces the box sectors, the camera or slot entities, the puppet widget, the preview texture, the black box mesh or either master environment. There is no `archive\pc\mod\modlist.txt`, so the archive order falls back to first-alphabetical ([mod loading](../../knowledge/mod-loading.md)).

## Install state recorded (read-only)

- **ReShade 6.7.1.2132** as `bin\x64\dxgi.dll`. Its log names the configuration it loaded, a `ReShade.ini` inside an MO2 mod folder.
  - Screenshot section: `FileFormat` 2 (JPEG), `JPEGQuality` 90, `SaveBeforeShot` 0, `SaveOverlayShot` 0.
  - `bin\x64\ReShadePreset.ini` `Techniques=`: CinematicDOF, SoftMotion, Lightroom (qUINT), prod80_03_Color_Space_Curves, prod80_03_CurvedLevels, ChromaticAberration (Prism), Crystallis (Quark film grain), TECH_RealLongExposure, ArtisticVignette.
  - The save folder is withheld.
- **LUT Switcher 2**: CET script header "2024 by CyanideX"; package v1.1.1.0e (Nexus 16310), script `modVersion` 2.4.0. `userConfig.json`: `activeEffect` and `photoModeActiveEffect` "Preem LUT 3: Main", `disableLUTinMenus` true, `separateMenuLUT` false. LUTs are applied as `.effect` events on the player (`GameObjectEffectHelper`).
- **Game settings** (`UserSettings.json` version 140, under the user profile):
  - Display: `HDRModes` None, `Gamma` 1.0, `Brightness` 50, `TonemappingMidpoint` 2.0, `MaxMonitorBrightness` 270, `PaperWhiteLevel` 300, `Saturation` 0.
  - Ray tracing: `RayTracing` on, `RayTracedLighting` Ultra, `RayTracedLocalShadows` on, `RayTracedReflections` on, `RayTracedPathTracing` off.
  - Upscaling: `DLSS` Auto.
  - Post effects: `FilmGrain`, `ChromaticAberration`, `DepthOfField`, `LensFlares` and `Vignette` on, `MotionBlur` High.
  - Camera: `FieldOfView` 80.

## Indirect light (27 September 2026)

Behind [creator lighting §10–11](../../knowledge/creator-lighting.md#10-indirect-light-what-reaches-v). Everything was read-only, and nothing was launched. Only single files were extracted, each through `tools/memory_guard.py` with a 3 GB limit (peak 1.1 GB).

**Resources** (SHA-256 of the extracted file, first 16 hex digits):

| Depot path | Archive | SHA-256 | Read for |
|---|---|---|---|
| `…\03_night_city\_compiled\default\quest_a73ac4b55b3d6ec1.streamingsector` | `basegame_3_nightcity` | `d64522df3013c098` (as above) | Box geometry: spawner z −195.11, panels at z −205.11 and −185.11 and x/y ±10 m |
| `…\03_night_city\_compiled\default\blocks\all.streamingblock` | `ep1_1_nightcity` (the effective copy) | `f829cc5cfb6b380e` | 24,132 descriptors. Grid cell sizes from name index against box centre: exterior 64 m × 2^level, interior 32 m × 2^level. The cells holding the box follow from those sizes |
| `…\exterior_-2_6_-2_1.streamingsector` | `basegame_3_nightcity` | `6cadbd1467eb98cb` | 64 nodes, all `worldAcousticSectorNode` |
| `…\exterior_-1_1_-1_3.streamingsector` | `basegame_3_nightcity` | `39f9067f4117e78c` | 185 nodes. `worldGISpaceNode` `gi_003` at (−469.9, 875.6, −1.3), `worldStaticFogVolumeNode` at (−458.3, 860.4, −12.8) and a light at (−479.5, 612.6, −4.2), all at least 200 m from the box. Two `worldInstancedMeshNode`s of `q110_black_box.mesh`, six instances each at scale 100; the second spans (−258.8…−148.6, 782.3…888.1, −241.2…−135.8) and so encloses the box |
| `…\interior_-1_1_-1_4.streamingsector` | `basegame_3_nightcity` | `040ece15e704bebf` | Five `worldGenericProxyMeshNode`s |
| `basegame_2_mainmenu.archive` (listing) | — | archive `b0f967f782761974` | All 53 entries: 15 sectors, acoustics, traffic and device resources, one `.env`; no `.envprobe` or `.gidata`. The 15 sectors were already serialized; their node classes are listed on the knowledge page |

`target_face.ent` (above) was re-read for `env` (unset), `params` (three area settings), `depthCutDistance` 9, `backgroundColor` (0, 0, 0, 0), `overrideBackgroundColor` 0 and `renderSceneLayer` `Default`. Class fields come from the RTTI dump red-dump-json `a8e52990`.

**Programs** (static cache as in the [shader-system note](../materials/shader-system/README.md); extracted with `shader_cache.py extract`, decompiled with dxil-spirv `f2d1b554` and SPIRV-Cross `aa217aeb` to Vulkan GLSL):

| Technique | Pixel program | DXBC SHA-256 | Read for |
|---|---|---|---|
| `m_shaderLightIntegrate` | `2291179555597019501` | `df2b6c86419a31c4` | Probe loop over a 32 × 32 tile bitmask (`t45`). Per-probe six-colour cubes in `ENV_PROBES`. Fallback where the weight is under 1: the cube at `ENV_PROBES[257 + 6·ENV_PROBES[0].w]`, and the cube at 449–454 scaled by a three-layer world-space array (`t61`, sampled at world XY × 6.1035e−5 + 0.5, height terms with constants 900, −100 and −110). A cube texture at `t43` |
| `m_shaderLightIntegrate_NoEnvProbes` | `10393055107398307099` | `7df07e2d0e594b5f` | Global cube `GlobalShaderConsts` 21–26 along the normal or `L_e` (diffuse, hair) and along the bent reflection (specular), plus screen buffers `t5`/`t6` (× a per-draw factor) and `t11`/`t12` (× 64, behind `cb6[13].z`) |
| `m_shaderLightIntegrate_CubeIBL` | `16956390879026470170` | `7df07e2d0e594b5f` | Byte-identical to `NoEnvProbes`, with a different vertex program (`3791666749441714394`) |
| `m_shaderLightIntegrate_NoAmbient` | `5858691682494776269` | `73b174b058493cda` | Same bindings as `NoEnvProbes`; the two cube evaluations and the hair environment branch are absent (normalised diff of the two listings) |

**Name attribution.** In `static-index.json` each integrate technique's program pair is filed under a `dsFormat` entry five entries before the technique's name. The pattern holds for all eight integrate techniques (entries 245/250, 309/314, 475/480, 533/538, 604/609, 704/709, 714/719, 730/735 and 772/777). `shader_cache.py` attributes GUIDs to the following name, so these programs appeared nameless; the pairing is a layout reading, strongly supported.

**Runtime frames.** These are the private session-2 mirror captures (26 September 2026, bridge build `c31156a`). *Metal ramp · lifted* (full-frame SHA-256 `f9a7c62ce765ba57…`, 3840 × 1600) was sampled on the side of the nose away from the key, a 40 × 60 px box: mean (47, 24, 18), minimum (41, 21, 17). The forehead centre, a 60 × 40 px box, reads (187, 176, 162). The patches were inverted through the Nova LUT's neutral axis from §5. Every frame shows the menu's red backdrop behind V. In the bridge's command log, `world.time.set` restores the clock to 705,706 s (about 04:00) at 09:14 UTC, followed by `world.pause`. The mirror frames follow at 09:37–09:38 UTC, so the hour was early morning if the pause held.

Extracted files and JSON are kept in the ignored `research/consumers/cc-lighting/raw/nc-ambient/`, and the decompiled integrate listings in `research/consumers/shader-system/raw/amb/`.

## Limits

- The CPU-side conversions are not read: lumens to intensity, cone angles and softness to `a`, `b`, `c`, the `Color` default, and the camera settings to an exposure scale. Neither is the preview camera's placement code (`gameuiPuppetPreviewCameraController` is native).
- The in-game box was matched by its prefab names and node references. It was not proven at runtime that the mirror binds that copy. Among the Night City quest sectors, only that prefab defines the `#character_creation_{female,male}` camera and spawner nodes, and the world's `always_loaded_0` sector holds the matching `character_creation_{female,male}_marker` markers.
- The maintainer's qualitative observation of 25 September (brightened preview hair close to the game, the game slightly darker) is recorded on the knowledge page as a qualitative check only.
