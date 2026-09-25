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

## Limits

- The CPU-side conversions are not read: lumens to intensity, cone angles and softness to `a`, `b`, `c`, the `Color` default, and the camera settings to an exposure scale. Neither is the preview camera's placement code (`gameuiPuppetPreviewCameraController` is native).
- The in-game box was matched by its prefab names and node references. It was not proven at runtime that the mirror binds that copy. Among the Night City quest sectors, only that prefab defines the `#character_creation_{female,male}` camera and spawner nodes, and the world's `always_loaded_0` sector holds the matching `character_creation_{female,male}_marker` markers.
- The maintainer's qualitative observation of 25 September (brightened preview hair close to the game, the game slightly darker) is recorded on the knowledge page as a qualitative check only.
