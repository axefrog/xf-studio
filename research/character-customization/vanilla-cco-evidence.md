# Vanilla character-creator resources: extraction and evidence

25 September 2026. Evidence and reproduction notes behind the [CC file-chain knowledge page](../../knowledge/cc-file-chain.md) and the asset-free [option inventory](cc-option-inventory.json). Offline inspection only; no game launch, save edit or game-file change. Extracted resources and WolvenKit JSON stay in ignored `research/consumers/cc-file-chain/`.

## Extraction

Tool: WolvenKit CLI 8.17.4 against an installed 2.31 game (`PATH_TO_GAME`).

1. `unbundle PATH_TO_GAME/archive/pc/content/basegame_4_gamedata.archive -o research/consumers/cc-file-chain/raw -r "\.inkcharcustomization$"`, and the same against `archive/pc/ep1/ep1_2_gamedata.archive`. A scan of every `basegame_*` and EP1 archive found exactly these four resources; no other archive contains an `.inkcharcustomization`.
2. `convert s research/consumers/cc-file-chain/raw`, then move the JSON into the sibling `json/` folder.
3. Representative `.app` and player `.ent` files: `unbundle` `basegame_4_appearance.archive` with an explicit alternation of basenames (one per option family). **Guard the regex:** an empty `-r ""` matches every entry and starts a full-archive extraction.
4. UI presets: `unbundle basegame_4_gamedata.archive -r "ui_preset_(female|male)_(corpo|nomad|street)\.charcustpreset$"`.
5. The inventory is produced by a local normaliser (flatten `CName`/`ResourcePath` wrappers, keep names/paths/counts, de-duplicate definition lists, reduce EP1 twins to diffs). Its output is the committed JSON; the script itself is a scratch helper.

| Resource | SHA-256 of extracted bytes |
|---|---|
| `base\gameplay\gui\fullscreen\main_menu\female_cco.inkcharcustomization` | `0f412c4c091df7b01d1998a0958b0d85e2e342101e9cba1ac7be490ffb9a10e4` |
| `base\gameplay\gui\fullscreen\main_menu\male_cco.inkcharcustomization` | `3bcccb549b0c67c37cdfbc4b2e1c5187d81e35cd5570f7ca09e121cca212683a` |
| `ep1\gameplay\gui\fullscreen\main_menu\female_cco_ep1.inkcharcustomization` | `1cc497235d2155ee9415c66f6b53cadfa2cda7d93916b2322c0ee9e2d93aa5b4` |
| `ep1\gameplay\gui\fullscreen\main_menu\male_cco_ep1.inkcharcustomization` | `b2f0a0b37290c312306eb395662625a2f926956315d801db08dc12c0b0aebce1` |

The earlier catalogue probe's female JSON (SHA-256 `6689fe6f…`) was serialised from the same base resource.

## Findings recorded here in detail

**EP1 twin in use.** The reference save's `tpp_head_face_rig` resource hash `14034739559546167190` equals FNV-1a64 (lower-case path) of `ep1\characters\head\player_base_heads\appearances\head\face_rig\h0_000__basehead_face_rig_ep1.app`; the base path hashes to `4202529424089658858`. Only the `_ep1` CCO names that app. Other saved hashes (teeth `4335264894338256315`, lips `4611898753144546376` = `makeup_lips\hx_000__basehead_makeup_lips_08_02.app`, cheeks `4013954541166571766` = `makeup_freckles\hx_000__basehead_makeup_cheeks_05.app`, neck `10731250262594030950`, photo-mode rig `13870987152078611154`) match the same paths in both CCO versions.

**Link semantics.** `ui_preset_female_corpo.charcustpreset` stores 281 `{optionName, isActive, value}` entries (90 active). `skin_color = 10` coincides with value 10 on `skin_type_05`, `body_color`, `fpp_body_color`, `nipples_01`, `genitals_04`, `neck`, both feet and all 23 skin-linked arm options; `nails_color_tpp = nails_color_fpp = 31`; `tpp_head_proxy` and `fpp_head_proxy` are 0. Inactive options store `4294967295`.

**Save versus UI state.** The save lists resolved appearances per group; the corpo preset lists option indices. The save never contains `skin_color`, switchers or morph `None` entries.

**Morph target identity.** `.morphtarget` `targets[]` entries have separate `name` and `regionName` fields. Eye/lash, nose-ring, ear-placeholder and linked-mesh resources carry only the regions they need (21 `eyes`, 21 `nose`, 21 `ear`, all 105).

**Eyes and vanilla lashes share one mesh.** `he_000__basehead.app` overrides component `he_000_pwa__basehead` with chunk mask `18446744073709551614` (chunk 0 hidden); `hel_000__basehead.app` overrides the same component name with `18446744073709551609` (chunks 1–2 hidden) and `eyelashes__<colour>` appearances.

**CC controller components.** `player_wa_tpp.ent`, `player_wa_fpp.ent` and `player_wa_photomode.ent` carry `gameuiCharacterCustomization{Genitals,Feet,Hairstyle,Face,Nails,ArmCyberware}Controller`; `player_ma_tpp.ent` adds `…BeardController`. Their group-name fields are `genitals`/`breast`, `flat_feet`/`lifted_feet`, `hairs`, `face`, `nails`, `beards`. `player_wa_fpp` sets `forceHideGenitals = 1`.

**PRC placeholders.** From the installed PRC framework archive (SHA-256 `6e73610b…`), `female\fpm1`, `fpm9` and `fpm50` placeholders are byte-identical (SHA-256 `417b1ff396dff1d15c3d448b4c0847fb37494d6eadb64a025232ec598e6c7f94`): base mesh vanilla `i1_000_pwa_c__basehead_earring_01.mesh`, 21 `ear` targets, and an embedded mesh blob with **no render chunk infos**. Filled slot `fpm72` has one 190-vertex chunk. The framework `.app` keeps vanilla style 12's `i1_000_pwa_earring__basehead_04.ent` part; vanilla's override chunk mask `…551612` becomes `…551610`. WolvenKit 8.17.4 GLB export of a placeholder fails ("GLB format only supports one binary buffer"), so render-chunk metadata, not export, is the reliable emptiness test.

**ArchiveXL source note.** In 1.27.3 `MergeCustomOptions`, `isWildcardLink` is computed from `sourceSlotStr.ends_with('*')` after the slot's own `*` was stripped (`src/App/Extensions/Customization/Extension.cpp:379`). A link-only wildcard overlay therefore appears not to be treated as a wildcard. Source reading only; not tested.

**EP1 eye-makeup link key.** In `female_cco_ep1`, `makeupEyes_21`…`_36` have `link = LocKey#43269`, while base `female_cco` and styles 1–20 use `makeupEyes color`.

## Modding Docs pages and images consulted

Clone commit `be2f44ee`; paths relative to the clone. All images are editor or game-UI illustrations, not runtime proof. Pages already covered in the [wiki chain map](file-chain-map.md) are not repeated.

| Page (author as evidenced) | Images inspected | Used for |
|---|---|---|
| `for-mod-creators-theory/files-and-what-they-do/file-formats/character-creator/.inkcharactercustomization-cc-options.md` (manavortex, IslandDancer, Jan 2025) | `.gitbook/assets/inkcc_gameuiAppearanceInfo.png` (hair option fields, `link "hairstyle color"`, icons) | Link semantics, field meanings |
| `…/archivexl-character-creator-additions/ccxl-theory-switchers.md` (icxrus, Sep 2025) | `switcherInfo options.png`, `chest size switcher.png`, `morph names for switcher.png`, `eye color switcher.png`, `Hairstyle switcher with hair color appInfos.png`, `hairstyle uiSlot(s).png`, `hair color ui slot.png` | Switcher/slot structure, breast morph, eye-colour list |
| `…/archivexl-character-creator-additions/README.md` (manavortex, island_dancer; edited icxrus) | – | Vanilla `uiSlot` table; community tattoo switcher indices 3300–3309 |
| `…/ccxl-theory-scopes-and-extensions.md` (manavortex) | `ccxl_material_colour_extensions.png`, `ccxl_makeup_mesh_example.png` | `@context`/`@makeup`/`{material}` makeup pattern |
| `…/ccxl-body-tattoos.md` (no author metadata) | `image (261).png`, `ccxl_tattoo_mesh_file.png` | Nameless switcher overlay by `link body_tattoo` |
| `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md` (manavortex; updated by nutboy, Jan 2025) | `done.png`, `character_creator_eye_makeup.png`, `character_creator_lip_makeup_color.png`, `character_creator_cheek_makeup_options.png`, `cyberware.png` | Choice counts shown in the UI at that date; skin-tone order |
| `…/cheat-sheet-head/README.md` (no author metadata) | `cyberware_2-2_custompath_mi.png` | Prefixes; 2.2 cyberware inside decal meshes |
| `modding-guides/npcs/npv-v-as-custom-npc/*.md` (manavortex, crediting NoraLee) | `npv_app_structure.png`, `npv_file_deletion_chart.png`, `npv_blender_01_apply_shapekeys.png` | NPV baking; CC → component map |
| `modding-guides/npcs/fixing-eye-clipping-in-npvs-by-replacing-facial-rigs.md` (saltypigloaf, 2025) | – | 22/21 facial rigs; rig-000 report |
| `modding-guides/npcs/creating-facial-cyberware.md` (manavortex, Jul 2025) | `custom_head_cyberware_components.png` | Always-on entity patch route |
| `modding-guides/npcs/custom-facial-piercings-prc-framework.md` (Mx_OrcBoi, 2023) | `image1.png` (shape keys `h011_eyes`…) | Shape-key naming |
| `for-mod-creators-theory/3d-modelling/morphtargets.md` (no author metadata) | – | Name + region activation, blending |
| `for-mod-creators-theory/3d-modelling/garment-support-how-does-it-work/README.md` | – | Component prefix scores |

## Limits

Resource-level observation of one installed 2.31 game and one save. It does not measure what the running game rendered, the native archive lookup order, or behaviour after uninstalling a mod. See the knowledge page's open questions and in-game test asks.
