# Head character-creator options: render-chain evidence

25 September 2026. Provenance behind the [head CC rendering](../../knowledge/head-cc-rendering.md) knowledge page and the additions to the [CC file chain](../../knowledge/cc-file-chain.md). Offline, read-only inspection. No game launch, no MO2 launch and no write under the game or MO2 folders. Extracted resources, resolver reports and scan outputs stay in the ignored `research/consumers/head-cc-rendering/raw/` of the working checkout.

## Tools and inputs

| Input | Version / identity |
|---|---|
| Installed game | 2.31 with Phantom Liberty, at `PATH_TO_GAME` |
| Resolver | XF Studio generic character resolver at commit `afb474e` (`tools/resolve-character.ts`, `src/character-resolver.ts`), run on the direct route (base game only, 57 mounted archives, no `.xl` files) with UI states, and its existing MO2-route report of the reference save (profile `2025 (again)`, 1,079 mounted archives) |
| WolvenKit CLI | 8.17.4 (`unbundle`, `convert serialize`, `archive -l`), used by the resolver's fetcher and for the tone-instance extraction |
| Shader listing | The skin G-buffer pixel program `12806642364631437234` (`renderstage_gbuffer_regular`, MeshSkinned), decompiled earlier with the [shader-system method](../materials/shader-system/README.md) (dxil-spirv `f2d1b554`, SPIRV-Cross `aa217aeb`); lines cited below are in the ignored `…/annotated/12806642364631437234.decompiled.hlsl` |
| Modding Docs | Local clone at `be2f44eed8419342ec13f72ed9cab008e9f7b289` |
| Template defaults | The serialized 2.31 template summary (`template-summary.json`, 373 templates) from the [shader-system method](../materials/shader-system/README.md) |

## Resolver runs (UI states)

Each state is `{bodyGender, state: {option: choice}}` as accepted by `tools/resolve-character.ts --ui-state`. Switcher choices use their `localizedName`; appearance choices use the definition name.

| Run | State | What it exercised |
|---|---|---|
| A (female) | skin type 03, tone `03_ca_senna`, brows 03, hairstyle 05, eye makeup 05, lipstick glossy 05, cheeks 02 (freckles), pimples 02, facial tattoo 02, face cyberware 03, piercings 03, scar `scar_02`, eyes `h091`, nose `h012` | Every head decal family, piercing chunk masks, vanilla lashes and brows |
| B (female) | skin type 05, tone `06_bl_dark`, eye makeup 25, lipstick regular 05, cheeks 10 (blush), facial tattoo 10, face cyberware 12, piercings 12, eye colour `01_blood_gradient_black` | Dark tone, EP1-era makeup style, blush, tone-dependent cyberware |
| C (female) | skin type 01, tone `01_ca_pale`, eye makeup 36, lipstick matte 05, face cyberware 01, hairstyle 20 | Matte lip finish, `hairstyle_cyberware` swap |
| D (male) | skin type 05, beard 05 part 02, eye makeup 05, hairstyle 05 | Male head, beard, male eye chunk order |

Cold cost: 158 s for run A (76 resources extracted in 24 CLI calls on top of a warmed cache); later runs were mostly cache hits.

### Extracted-byte SHA-256 (first 16 hex digits) of the resolved vanilla resources

All from the base game (`basegame_4_appearance.archive` unless the resolver recorded a byte-identical base-internal twin).

| Family | Resources |
|---|---|
| Skin | `h0_000__basehead.app` `5f994d46f5b06006`, `h0_000__basehead_d03.app` `f301d24c39bb6fdc`, `h0_000__basehead_d05.app` `520eb3d70ca8eead`, `h0_000_pwa_c__basehead.mesh` `e877b91a7b3f6bd6`, `h0_000_pwa__morphs.morphtarget` `3e10c3f75fbefb0a`; male `h0_000_pma_c__basehead.mesh` `034db61306fea1a6`, `h0_000_pma__morphs.morphtarget` `e68817d2ddc4b6ca` |
| Eyes, lashes | `he_000__basehead.app` `cb921d5379182d16`, `hel_000__basehead.app` `b09eb7f10ac7b3c1`, `he_000_pwa_c__basehead.mesh` `4d5dfa91efdf5448`, `he_000_pwa__morphs.morphtarget` `42a19b6a4d2f4060`; male mesh `22b8d2ac4a0ab19b` |
| Brows | `heb_000__basehead_01.app` `c07443412568c1b2`, `heb_000__basehead_03.app` `0f1884549c52ca1e`, `heb_000_pwa_c__basehead.mesh` `a51d4940e56cca58`, `heb_000_pwa__morphs.morphtarget` `2f2caa19882ae517` |
| Teeth | `ht_000__basehead.app` `764c4167bf0063be`, `ht_000_pwa_c__basehead.mesh` `076cb660a2e72b1c`, `ht_000_pwa__morphs.morphtarget` `fe1a9f91909d62a4` |
| Hair | `hh_000_pwa__hairs_059.app` `d3d395f9ffbf9c9a` → `hh_033_wa__player.mesh` `8afe809f5c20c9c3`; `hh_004_pwa__hairs_090.app` `9409caf43f0e1805` → `hh_090_wa__alt_player.mesh` `b2f67418f12c260a`; `hh_019_pwa__hairs_044.app` `f9080792567fc5b4`; `hh_000_pwa__hairs_059_cyberware_01.app` `539f799a597e3c31` |
| Eye makeup | `…makeup_eyes_05.app` `03f194c462790a37`, `_25` `25a3808a9effbb01`, `_36` `4ae8d1588f7870b1`; mesh `hx_000_pwa_c__basehead_makeup_eyes_01.mesh` `b2597cfa7d362403`, morph `1bde3fff7378ef9f` |
| Lips | `…makeup_lips_05.app` `71e66ffefa7145fe`, `_05_02` `c9513f061fe53e92`, `_05_03` `ccd5bbce82756199`; mesh `6fe5f56a3073f023`, morph `9dfe06812d6b72d9` |
| Cheeks, freckles | `…makeup_freckles_02.app` `06367aea9af73113`, `…makeup_cheeks_06.app` `d257ef23a66f7dc2`; mesh `fa3c52261703e8b1`, morph `3778c7d24e37d683` |
| Pimples, scars | `hx_000__basehead_pimples_01.app` `7dcb148991e036bd` (mesh `ab2eb90e0ba75e99`); `hx_000__scars.app` `98ab1e12f43b9243` (mesh `2d368f182bc2bb23`, 11 chunks) |
| Tattoos | `hx_000__tattoo_04.app` `b7997586149d004d`, `hx_000__tattoo_07.app` `d1c6a6c83deb5b70`; meshes `_tattoo_04` `b961635ea26534c5`, `_06` `701c8a71994a56e2`, `_07` `a51eb8fc1607c3d8` |
| Face cyberware | `hx_000__cyberware.app` `752b58574c10e944`; `hx_000_pwa_c__basehead_cyberware_01.mesh` `9bce1ab12cb196ef` |
| Piercings | `i0_000__earring_03.app` `b943eab20a3130bb`, `i0_000__earring_14.app` `fd9d98df453d9d38`; earring meshes `_01` `e6ff17ee8efbea93`, `_02` `0e7f9520e40b91cb`, `_03` `3d7969d3808955c7`, `_04` `fd9f4383611e8cfb` |
| Beard (male) | `hb_000_pma__jesse_beard__chin.app` `b7bf0f56e7a98766`, `hb_000_pma_c__basehead_jesse_beard.mesh` `76370ea50b60a5ae`, morph `3453f381bc892968` |

## Observations recorded here in detail

**Skin type versus tone** [resource]. The female head mesh has 62 material entries, all local: 60 are one per (12 tones × 5 types), and two set no albedo. Every local instance overrides only `Albedo` and `Normal`: `Albedo` is `h0_000_pwa_c__basehead_d0N.xbm` where N is the skin type (types 2–5 carry a `_d0N` suffix in the material name, type 1 none), and `Normal` is `h0_001_pwa_c__basehead_n01.xbm` for all 60. The tone lives only in the `baseMaterial` chain `female_head_<tone>.mi` → `default_female_head_<tone>.mi` → `default_head_<tone>.mi` → `<tone>.mi` → `skin.mt`. One vanilla inconsistency: `05_bl_espresso_d02` bases directly on `05_bl_espresso.mi` with a full parameter set, skipping the female chain; its effective tint is the same. Mesh-appearance names are not uniform (`03_ca_senna_d03` female, `01_ca_pale__d05` male), so a renderer must follow the app override to the mesh appearance rather than build names.

**Effective tint per tone** (female chain; walked leaf-first from 75 serialized `.mi` files extracted with `unbundle -w` from `basegame_4_appearance.archive`) [resource]:

| Tone | `TintColor` (RGB bytes) | `TintScale` | `TintColorMask` |
|---|---|---|---|
| `01_ca_pale` | 171, 155, 150 | 0 | `h0_000_base__tintcolormask.xbm` |
| `01_ca_pale_00_warm_ivory` | 255, 245, 181 | −0.15 | none set (template default `i0_000_base__tintcolormask.xbm`) |
| `02_ca_limestone` | 131, 149, 83 | 0.38 | head mask |
| `02_ca_limestone_00_beige` | 172, 166, 31 | 0.58 | head mask |
| `03_ca_senna` | 202, 177, 153 | 0.70 | head mask |
| `03_ca_senna_00_amber` | 199, 116, 112 | 0.52 | head mask |
| `03_ca_senna_01_honey` | 181, 141, 29 | 0.67 | head mask |
| `03_ca_senna_02_band` | 17, 62, 11 | 0.57 | head mask |
| `04_ca_almond` | 189, 180, 173 | 1.0 | head mask |
| `04_ca_almond_00_umber` | 160, 113, 70 | 0.716 | head mask |
| `05_bl_espresso` | 117, 98, 96 | 0.80 | head mask |
| `06_bl_dark` | 63, 51, 39 | 0.845 | head mask |

The warm-ivory mask row is inferred from the chain as extracted (no level sets it); the resolver's reference-save chain shows the -KS- UV Texture Framework's donor material supplying its own mask for that tone instead. `default_female_head_<tone>.mi` supplies the shared maps (`h0_000_wa_c__basehead_d01` or, for espresso and dark, `h0_000_wa_b__basehead_d04` fallback albedo; `h0_000_wa_c__basehead_n01`, `_rm01`, `h0_000_wa_c__base_nd`, the two wrinkle normals and the blood-flow mask); `default_head_<tone>.mi` supplies `MicroDetailUVScale01/02` = 20/8 and the tint mask; `<tone>.mi` supplies tint, `DetailRoughnessBiasMin/Max` 1/0.93, `DetailNormalInfluence` and `MicroDetailInfluence` 0.8.

**Skin tint arithmetic** [source: decompiled program, lines 268–273 and 322–349, output 656–658]. With `m = TintColorMask.R`, `w = abs(TintScale)·m` and `a` = albedo plus a cavity term driven by `Roughness.B` and `CavityIntensity`:

- `TintScale ≥ 0`: `t = saturate(TintColor · a)` (multiply);
- `TintScale < 0`: `t` = overlay of `a` with `TintColor` (`a < 0.5 ? 2·a·c : 1 − 2(1−a)(1−c)`);
- base = `lerp(a, t, w)`, then `Bloodflow`-masked `BloodColor` blends driven by two vertex interpolants cubed (animation-driven flush, [hypothesis] for the driver);
- `SecondaryAlbedo` composites over the result with weight `SecondaryAlbedoInfluence · SecondaryAlbedo.A`, itself tinted toward the base tint by `w · SecondaryAlbedoTintColorInfluence`;
- GBuffer0 = `sqrt(result · k)` with a branch factor `k` that is 1 on the plain path.

`TintColorMask.G` and `.B` are **not** tint channels: B, quantised to five steps and smoothstepped, raises both microdetail UV frequencies (`(1.4 + b)·MicroDetailUVScale01`, `(1.0 + b)·MicroDetailUVScale02`); G, quantised to six steps, blends between the two microdetail patterns. `MicroDetail` is a 2:1 atlas sampled as two half-width tiles, each an RG normal with reconstructed Z; the micro normal weight is `MicroDetailInfluence · Roughness.B` (lines 276–305). Whether `TintColor` reaches the program as byte/255 or sRGB-decoded is still [materials open question 11](../../knowledge/materials-and-shaders.md#7-open-questions).

**Decal families on the head** [resource] (run A–D chains; template defaults from the template summary):

| Option | Mesh (shared across styles) | Chunks | Template and key values |
|---|---|---|---|
| Eye makeup 05/25/36 | `hx_000_pwa_c__basehead_makeup_eyes_01.mesh` (1 chunk) | style = mesh appearance `black_05`, `_25`, `_36` | `mesh_decal`; `makeup_NN_<colour>.mi` → `makeup_color__NN_<colour>.mi`; `DiffuseTexture hx_eyes_makeup_01_dNN`, `DiffuseColor` per colour (black 15,16,19), `DiffuseAlpha 1`, `SecondaryMask noise_decal_d01` at UV scale 30 with influence 1, `RoughnessTexture roughmetal.xbm` with `RoughnessMetalnessAlpha 1`, normal off |
| Lipstick 05 regular / `_02` glossy / `_03` matte | `hx_000_pwa_c__basehead_makeup_lips_01.mesh` | 1 | `mesh_decal_double_diffuse`; diffuse mask `hx_lips_makeup_01_d05` + `SecondaryDiffuseAlpha hx_lips_makeup_01_a18` with a second colour. Regular: alpha 0.8, secondary (106,45,67). Glossy: alpha 0.6, main (46,52,58), secondary (142,64,92). Matte: as regular plus `RoughnessMetalnessAlpha 0.4` over the template's white roughness. **Regular and glossy write no roughness** (template default surface alpha 0). |
| Lipstick glossy 08 (reference save) | same mesh | 1 | `mesh_decal` (`lips__08_red_02.mi`): `DiffuseAlpha 0.4`, `RoughnessTexture white` but no surface alpha, so no roughness write |
| Freckles 02 | `hx_000_pwa_c__basehead_makeup_freckles_01.mesh` | 2 (face, nose) | `mesh_decal`: `DiffuseAlpha 0.3`, colour (97,63,48), surface alpha 0 |
| Blush 05/06 | same freckles mesh | 2 | `mesh_decal`: `DiffuseAlpha 2` (above 1), surface alpha 0 |
| Pimples 01 | `hx_000_pwa_c__basehead_pimples_01.mesh` | 2; mask `…551613` shows chunk 0 | `mesh_decal`: `DiffuseAlpha 0.5`, colour per definition |
| Scars | `hx_000_pwa_c__basehead_scars_01.mesh` | 11; one chunk per scar (`scar_02` → mask `…549570` shows chunk 1) | `mesh_decal`: diffuse, secondary mask, scar normal (`NormalAlpha 0.425`, blending mode 1), `RoughnessMetalnessAlpha 0.02` |
| Facial tattoos 04/07 | one mesh per design (`hx_000_pwa_c__basehead_tattoo_NN.mesh`) | 1 | `mesh_decal` through `customization_tattoos_<tone>.mi`: the **tone** selects colour and alpha (senna 216,204,191 at 0.7; dark 119,115,110 at 0.6) |
| Face cyberware 01 | `hx_000_pwa_c__basehead_cyberware_01.mesh` | 1 | `mesh_decal` with full colour, normal (`NormalAlpha 2`), roughness and metalness maps, `RoughnessMetalnessAlpha 1` |
| Face cyberware 03 | the **freckles** mesh, appearance `cyberware_04` | 2 | `mesh_decal` (`cyberware__04.mi`); no tone variation for this design |
| Face cyberware 12 | the tattoo-06 mesh **and** the freckles mesh, appearance `cyberware_11_dark` | 1 + 2 | `mesh_decal`; the tone picks a light or dark appearance |
| Beard shadow (male) | `hb_000_pma_c__basehead_shadowbase_01.mesh` | 1 | `mesh_decal` (`beard_shadow.mi`): alpha 0.75, noise secondary mask |

The Modding Docs head cheat sheet warns that the 2.2 cyberware appearances "do not exist in the .mesh"; in 2.31 base files the resolver found `cyberware_04` and `cyberware_11_dark` as ordinary mesh appearances with material entries on the direct route (no ArchiveXL present). The warning may refer to NPV copies of older meshes; it does not match the 2.31 player meshes.

**Other chunk facts** [resource]:

- Eye mesh chunk roles differ by body gender: female `he_000_pwa_c__basehead.mesh` chunk 1 = eye (`eye_gradient`/`eye`), chunk 2 = `eyeWetness_MAT` (`eye_shadow.mt` via `eyeshadow_base.mi`); male chunk 1 = wetness, chunk 2 = eye. Chunk 0 is the lashes in both. The shared eye chunk mask `…551614` hides only chunk 0.
- Piercing 03 draws three earring components with chunk masks `…550088` (chunks 3, 9), `…550624` (5, 10, 11, 12) and `0` (nothing, a nose placeholder carrying only `nose` targets). Materials are `multilayered.mt` with a per-metal `.mlsetup`.
- Hair meshes interleave strand cards (`hair.mt`) and cap chunks (`mesh_decal_gradientmap_recolor.mt`) in one mesh; each hairstyle `.app` also carries a `*_shadow_npc` component. Vanilla hair shadow meshes have `isShadowMesh = 1`, but so does the visible male stubble mesh `hb_000_pma_c__basehead_shadowbase_01.mesh`, and a CCXL hair's `hair_shadow.mesh` has `isShadowMesh = 0` with glass and multilayered materials. The flag alone does not decide what the preview should draw.
- Beard (male): switcher `beard` → per-style switcher `beardN` → `beard_colorN_M` appearance options; the definition draws the stubble decal plus hair cards (`hair.mt`, `_master__beard.mi`, chunk 0 hidden).

**Resolver defects found and fixed (RES-01, RES-02).** Runs A–D at `afb474e` showed two faults in `descriptorsFromUiState` (rule R5):

- A switcher's **default target** stayed active beside the chosen one, because the default target is `enabled` in the CCO (`skin_type_01`, `eyebrows_color1`, `hair_color1` beside the chosen `skin_type_03`, `eyebrows_color3`, `hair_color5`).
- An appearance option left at its `None` definition (`scars` at index 0, "Common-Off") produced an empty descriptor and an `appearance-missing` gap.

What the game data shows:

- **Switchers own their targets** [resource]. The six vanilla 2.31 UI presets (`base\gameplay\gui\fullscreen\main_menu\ui_character_presets\ui_preset_{female,male}_{corpo,nomad,street}.charcustpreset`, serialized with WolvenKit 8.17.4) store `isActive` per option. For every active switcher in every preset (1,736 target checks), exactly the options named by the chosen choice are active. Every other option the switcher can name is inactive, including 43 cases where that option is `enabled` in the CCO: `skin_type_01`, `hair_color1`/`hair_color38`, `hair_color_fpp_*`, `eyebrows_color1`, `beard0`, `cyberware_00`, `piercings_00`, `makeupEyes_00`, `makeupCheeks_00`, `makeupPimples_00`, `nipples_01`, `body_scars_00`, `makeupLips_none`, and `hairstyle` when a `cyberware` choice swaps in `hairstyle_cyberware`. No target of an inactive switcher is active unless an active switcher also names it. Among the options a preset lists, those that no switcher names are active exactly when `enabled`, with one exception: `tattoo` (see open questions below). The reference save agrees: it lists `skin_type_05` and no other skin type.
- **`switchVisibility` does not decide it** [resource]. `skin_type`, `cyberware`, `facial_tattoo`, `body_scars` and `nipples` have `switchVisibility = 0` (female; male similar), yet the presets deactivate their enabled defaults all the same. The earlier guess that the flag drives deactivation is withdrawn; its meaning remains unknown (the wiki's switcher table says "More info needed").
- **One active option per slot** [wiki] [source]. The Modding Docs [switcher theory page](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-theory-switchers.md) (icxrus, 3 September 2025) states that every `uiSlot` can hold only one active option; its screenshots `.gitbook/assets/hairstyle uiSlot(s).png` and `hair color ui slot.png` show the hairstyle switcher's `uiSlots` and a `hair_color` target occupying that slot. ArchiveXL 1.27.3 `src/Red/CharacterCustomization.hpp` declares the engine's `InitializeAppOption`/`InitializeSwitcherOption` with a `Map<CName, option>` of UI slots, and the RED4ext SDK's `game::ui::CharacterCustomizationOption` carries a per-option `isActive` flag. This is consistent with the preset observation but does not show the native code that clears the flag.
- **Off choices name no appearance** [resource]. Every vanilla "Off" choice is a definition whose `name` is the `None` CName: either on an option with no `.app` (`cyberware_00`, `piercings_00`, `makeupEyes_00`, `hair_color_none`; 19 such options in the female CCO, 20 in the male EP1 CCO) or as definition 0 of an option that has one (`scars`, `tattoo`). The `.app` has no appearance with an empty name. The reference save contains no appearance entry with an empty definition, and no `scars` entry, although `scars` is an enabled option that every preset marks active.

The fix, in `src/cco-model.ts`: an option that any switcher choice names is active only while an active switcher's current choice names it, whatever its `enabled` flag. An option no switcher names is active when `enabled`. A definition whose name is `None` emits no descriptor, whether chosen directly or reached through a link index. The rule reads only switcher `options[].names`, `enabled` and definition names, with no option-name cases. Checks:

- Deriving a UI state from each of the six presets (plus the `_ep1` CCO twins) and running `descriptorsFromUiState` gives exactly the preset's active appearance options, with the preset's definitions. The only extras are options the older presets do not list at all (`finalSceneBruises`, `eyelash_color`, the face-rig options), which are enabled roots and appear in the reference save.
- Re-running runs A, B and D on the direct route drops `skin_type_01`, `eyebrows_color1`, `hair_color1` and `hair_color_fpp_01` from run A, `skin_type_01` and the empty `scars` entry from run B, and `skin_type_01`, `hair_color38`, `hair_color_fpp_38` and `scars` from run D. It adds nothing, and no `appearance-missing` gap remains. Run B keeps `eyebrows_color1` and `hair_color1` because that state leaves brows and hairstyle at their defaults.

Still unproven: the presets are shipped UI state, not a capture of the running creator; the native code that clears `isActive` is unread. In-game check: choose skin type 03 and confirm that only one complexion renders (test ask below).

**Open questions from the preset check.** `tattoo` (hidden, `enabled = 0`, a follower of the `facial_tattoo` switcher's link `facial_tattoo`) is active in all six presets at index 0 (Off), although no switcher names it. How a **switcher** link controller activates or indexes its followers is unread. The resolver propagates link indices only from appearance controllers, so `tattoo` stays inactive. With the Off choice, the result is the same either way. ArchiveXL's `OnInitSwitcherOption`/`OnInitAppOption` hooks also mark an enabled, non-hidden, mod-added option active when a loaded state lacks it. That matters for save-loaded states, not for UI states, and is not modelled.

## Complexion mod scan (MO2 profile `2025 (again)`)

Method: a private script opened the installation through `resolver-host.ts` (MO2 route) and looked up 217 candidate depot paths of the player head skin chain (both body genders: albedos, normals, roughness, tint masks, wrinkle and detail maps, every tone `.mi` level, morph targets, `microdetail_n.xbm`, `engine\materials\defaults\default.sp`, `skin.mt`) in every mounted archive index; 105 exist in at least one archive. ArchiveXL declarations touching the head were read from the installed `.xl` files. Contents of the matching archives were listed with `WolvenKit.CLI archive -l`. Mod folders and archive names below are as installed; enabled state is from the profile's `modlist.txt` (`+` rows).

| Overridden vanilla path | Winning mod archive (installed mod, Nexus id, installed version) | Mechanism |
|---|---|---|
| `…\player_female_average\h0_000_pwa_c__basehead\textures\h0_000_pwa_c__basehead_d01…d05.xbm` (all five skin-type albedos) | `##_Arkhe_UniversalSkinTone_HEAD_FAIR_III.archive` (Realistic Complexion III, 19314, 1.0.0.0). The archive contains exactly these five files and nothing else. | Same depot path in a mod archive (legacy archive replacement); no `.xl` |
| `…\h0_001_pwa_c__basehead_n01.xbm` (female head normal) | `###_Arkhe_UniversalSkinTone_FaceDetails_Realistic_01.archive` (Universal Skin Tone face details, 15426, 1.0.0.0). The archive also adds new paths `base\4k\common\head\h0_000_wa_c__basehead_rm01.xbm`, `base\4k\common\overlays\normals\wa_head_overlay_n01.xbm`, `…\h0_001_pwa_c__basehead_rm.xbm`, `…\h0_001_pwa_c__basehead_n_detail.xbm` | Same-path replacement, plus new paths that only a patched material references |
| `base\characters\common\skin\face\microdetail_n.xbm` | `##_Arkhe_UniversalSkinTone_Microdetails_Smooth.archive` (15426, 3.0.0.0) | Same-path replacement of a **global** resource: every `skin.mt` user without its own `MicroDetail` |
| `engine\materials\defaults\default.sp` | `##_Arkhe_UniversalSkinTone_SkinMaterial_WarmSmooth.archive` (15426, 1.0.0.0) | Same-path replacement of the **template-default skin profile**, again global |
| `h0_000_pwa_c__basehead.mesh`, `h0_000_pma_c__basehead.mesh` (appearances) | `!!!_UV4.xl` of the -KS- UV Texture Framework (3783, 4.1): `resource.patch` with `ks_uv_donor\ks_donor_head_f.mesh` / `_m.mesh`, no `props` | ArchiveXL mesh patch: the donor's appearances replace the vanilla ones, and its local materials become the material source. For the reference save this yields material `skin2_d05`, adding `SecondaryAlbedo wa_head_overlay_d01`, an `EmissiveMask`, its own tint mask and `SecondaryAlbedoInfluence 1` over the vanilla tone chain, and pointing `Roughness`/`DetailNormal` at the Face Details archive's new `base\4k\…` paths ([resolver validation](resolver-validation.md)) |
| `base\materials\skin.mt` | `008_UV_Framework.archive` (same framework) | Byte-identical copy (SHA-256 `d7e50733…`), no effect |
| `h0_000_pwa__morphs.morphtarget`, `h0_000_pma__morphs.morphtarget` | `zz_FacialCustomizationFix_xBaebsae.archive` (7179) | Geometry-neutral morph replacement (renamed jaw/ear joints); not a complexion change |

Not overridden in this profile: every tone `.mi` (so tones keep vanilla tint values), the shared `h0_000_wa_c__basehead_*` fallbacks, the female roughness `h0_000_wa_c__basehead_rm01.xbm` at its vanilla path, and all **male** head albedos (the installed complexion package is female-only). The same Nexus page's body package (`##_Arkhe_UniversalSkinTone_BODY_FAIR.archive`, installed twice under two mod folders) replaces body, arm, nipple and genital albedos by the same same-path mechanism.

Also enabled: Arkhe's Character Rendering Editor (32842, package 3.0.0.0), a CET script that sets engine `GameOptions` at runtime: `Editor/Characters/Skin` (`SkinAmbientIntensity_Factor` 0.4, `SkinAmbientMix_Factor` 1.0, `AllowSkinAmbientMix`, `SubsurfaceSpecularTintWeight` 0.3, `SubsurfaceSpecularTint_R/G/B` 0.21/0.26/0.29), `Editor/Characters/RimEnhancement` (`GlobalCharacterFresnel` 3.0, `LightBlockerInfluence` 0.7), `Editor/Characters/Eyes` (`DiffuseBoost` 0.1, `UseAOOnEyes` off), feature toggles `CharacterSubsurfaceScattering`, `CharacterRimEnhancement`, `ContactShadows`, plus the hair options already in [hair shading](../../knowledge/hair-shading.md). Values are the script's "Vanilla" preset [community]; the option names exist as strings in the 2.31 executable. Its "Arkhe Balanced" preset changes, among others, skin ambient intensity to 0.206, SSS tint weight to 0.696 and global character Fresnel to 0.809. No file-based resolver can see these; a capture must record them.

## P1 check: the skin chain the preview resolves (25 September 2026)

Browser check of step P1 at `?verify=1`, MO2 profile `2025 (again)` (1,079 mounted archives), WolvenKit CLI 9.0.1; plus the default V on the direct route (57 archives). Records stay in the ignored preview cache. Per V, the skin slot's head component and its one `skin.mt` chunk:

| V | Definition | Chunk | Albedo (winning archive, size) | Tint | Skin profile |
|---|---|---|---|---|---|
| Default, MO2 | `h0_000_pwa__basehead__01_ca_pale` (`skin_type_01`) | `skin1` (framework donor) | `…_d01.xbm` (Realistic Complexion III, 4096²) | (171,155,150) × 0 | `default.sp` from the WarmSmooth package: `roughness0` 1, `roughness1` 1.6, `lobeMix` 0.6, `blurSize` 2.5, falloff (255,155,119) |
| Reference save | `…__01_ca_pale_00_warm_ivory` (`skin_type_05`) | `skin2_d05` (framework donor) | `…_d05.xbm` (same package, 4096²) | (255,245,181) × −0.15 | as above |
| New-game save | `…__03_ca_senna` (`skin_type_03`) | framework donor | `…_d03.xbm` (same package, 4096²) | (202,177,153) × 0.70 | as above |
| Default, direct | `…__01_ca_pale` | `01_ca_pale` | `…_d01.xbm` (`basegame_4_appearance.archive`, 1024²) | (171,155,150) × 0 | base game: 0.966, 1.597, 1, 1.4, (255,178,165) |

On the MO2 route every V also resolves the Face Details package's normal (4096²), its new-path roughness (1024²) and detail normal (2048²), the Microdetails package's `microdetail_n.xbm` (1024×512, the two-tile atlas), and the texture framework's secondary albedo, emissive mask (`EmissiveEV` 2) and tint mask (all 1024², `isGamma` set) [resource]. The base game's own tint mask (512²) is also `isGamma` [resource]. The head's morph target wins from `zz_FacialCustomizationFix_xBaebsae.archive`; its export matches the core head's positions, UVs, triangles and all facial morph targets, so the preview draws the resolved skin on the core head. Preparation: 35 s for the first V (cold texture exports), 7–15 s for the saves. Switching reference → new-game → reference restored the reference record byte for byte (same content address).

## Modding Docs pages and images consulted

Clone `be2f44ee`; paths relative to the clone. Editor and wiki illustrations, not runtime proof.

| Page (authorship as evidenced) | Images inspected | Used for |
|---|---|---|
| `for-mod-creators-theory/materials/configuring-materials/hair-and-skin-material-properties.md` (page metadata: published and last documented edit 5 April 2024 by mana vortex) | `.gitbook/assets/skin_shader_microdetail_scale.png` (two side-by-side RG normal tiles, left coarse, right fine), `skin_shader_UV_scale.png` (checkerboard on the player body parts) | Tint multiplies albedo; `SecondaryAlbedo` for freckles and tattoo frameworks; `MicroDetail` is a 2:1 combination of two tiles. The image agrees with the compiled half-width sampling. |
| `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-head/README.md` (no author metadata) | `.gitbook/assets/cyberware_2-2_custompath_mi.png` (seen for the earlier study) | Complexion = one albedo per skin type with appearances `<tone>`, `<tone>_d02…_d05`; skin `.mi` files half-shared with NPCs; 2.2 cyberware inside other decal meshes (see the 2.31 discrepancy above) |
| `modding-guides/npcs/custom-tattoos-and-scars/README.md` (published 3 February 2024 by manavortex; last documented edit 25 February 2025 by LadyLea) | – | Skin, tattoo and scar texture frameworks as the community's route for custom skins (context for the KS patch mechanism) |

## Limits

Resource-level observation of one installation, four synthetic UI states and one save. It does not show what the running game rendered, which archive the engine really serves for a contested hash, or the effect of the runtime `GameOptions`. The UI states went through rule R5 before its switcher and Off fixes, so the descriptor lists above were read per option, not as whole characters. The re-runs after the fix are described under "Resolver defects found and fixed".
