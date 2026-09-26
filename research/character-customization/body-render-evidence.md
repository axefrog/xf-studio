# V's body: render-chain evidence

26 September 2026. Provenance behind the [body rendering](../../knowledge/body-rendering.md) knowledge page. Offline, read-only inspection plus the Studio's own preview in isolated `?verify=1` workspaces. No game launch, no MO2 launch and no write under the game or MO2 folders. Resolver reports, exported geometry and captures stay in ignored locations (the scratch folder of the session, the preview cache and `projects/xf-studio/authoring/evidence/screenshots/body-render/`).

## Tools and inputs

| Input | Version / identity |
|---|---|
| Installed game | 2.31 with Phantom Liberty, at `PATH_TO_GAME` |
| Creator resources | `ep1\gameplay\gui\fullscreen\main_menu\female_cco_ep1.inkcharcustomization` (`ep1_2_gamedata.archive`, extracted SHA-256 `1cc497235d2155ee…`) and its masculine twin, as the resolver's JSON cache holds them |
| Resolver | XF Studio generic character resolver (`tools/resolve-character.ts`) on the MO2 route (profile `2025 (again)`, 1,079 mounted archives), at the base of `claude/body-render` (`fb15268`) |
| WolvenKit CLI | 9.0.1 (the resolver's fetcher and the geometry and texture exports) |
| Game scripts | 2.31 `r6\cache\final.redscripts` (SHA-256 `2119046f…ee86`), decompiled with redscript-cli 0.5.31 into the ignored `research/consumers/expressions/raw/scripts/`: `cyberpunk/UI/fullscreen/pregame/preGameMenuGameController.script`, `cyberpunk/systems/equipmentSystem.script`, `cyberpunk/UI/fullscreen/pregame/characterCreationBodyMorphMenu.script` |
| Idle rig | The creator close-up idle's body clip and rig, `authoring/public/assets/cc-idle-body.glb` (from `base\animations\ui\female\ui_female.anims` over `woman_base.rig`; [CC idle](../animation/cc-idle.md)) |
| Modding Docs | Local clone at `be2f44eed8419342ec13f72ed9cab008e9f7b289`: `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-body.md` (manavortex; last documented edit January 2024), `for-mod-creators-theory/core-mods-explained/archivexl/archivexl-suffixes-and-substitutions.md` (manavortex; the `{feet}` table) |

## Resolver runs

| Run | Input | What it exercised |
|---|---|---|
| Default V (female) | `{ "bodyGender": "female", "state": {} }` | Every body and arms option R5 activates: both body perspective groups, every holster state, both feet groups, the censored twins, genitals `genitals_04` (none) |
| Body choices (female) | body tattoo 01, body scars 01, breast `t0_000_wa_base__full_breast_big`, `nails_l` long, nail colour `a0_000_pwa_base__nails_01_red_heart__multilayer` | Tattoo and scar decals with the breast targets, nail length, a layered nail design (a nails framework's `skin.mt` on this install) |
| New-game save | a decoded 2.31 new-game save (senna, skin type 3) | What a save stores per body and arms group (below) |

What the new-game save lists per group [resource]: `TPP_Body` = `body_color`, `body_color_censored`, `nipples_03`, `underpants`; `FPP_Body` = the first-person twins and `underpants`; `character_creation` adds `genitals_04`, `lifted_feet` and the breast morph (with `censorFlag` 1, `censorAction` 1 on the morph); `genitals` = `genitals_04`; `lifted_feet` and `flat_feet` one entry each; every holster group (`holstered_*_tpp`, `*_fpp`, `unholstered_*`) its arms, nails and personal-link entries. `perspectives` = the creator resource's six `perspectiveInfo` entries.

### Extracted-byte SHA-256 (first 16 hex digits) of the resolved body resources

Base-game resources from `basegame_1_engine.archive` (`.app`) and `basegame_4_appearance.archive` (geometry); on the reference profile several geometry resources win from mod archives (a UV framework, a nails morph mod and a nails framework), marked *mod*.

| Part | Resources |
|---|---|
| Body skin | `t0_000_base__full.app` `00e09b46220869ef`, `t0_000_base__full_censored.app` `10432505a4b7f7e5`, `t0_000_pwa_base__full.morphtarget` `ceca0e211ca503fb`, `t0_000_pwa_base__full.mesh` `ec51445950da0bbb` |
| Underwear cover | `t0_000_base__censored_items.app` `8bf10ba102d5a648`, `i0_000_pwa_base_full_censored.mesh` `65396660de27b734` |
| Feet | `l0_000_base__cs_flat.app` `8362742ca1cac4af`, `l0_000_pwa_base__cs_flat.mesh` `888f3169a679d6e3` (*mod*) |
| Arms | `a0_000_base__full.app` `9652e6b1765aaeb4`, `a0_000_pwa_base_hq__l.mesh` `a585d5bccbc22c7a` (*mod*), `…__r.mesh` `7f7866aea5c734d4` (*mod*), `a0_001__personal_link_tpp.mesh` `7242efe9b997db7d` |
| Nails | `a0_000_base__nails.app` `5e0ce0802157b4c4`, `a0_000_pwa_base__nails_l.morphtarget` `b8db33c6eb4fb00a` (*mod*) over `…_l.mesh` `ed58207372fbbe25` (*another mod*); `_r` `8996033691fe5407` / `fe797c4f794fdf20` |
| Genitals | `i0_000_base__genitals.app` `e98887528e5d9e9b`, `i0_000_pwa_base__genitals_none.mesh` `e4888e8b593a7b12` (*mod*) |
| Body tattoo 01 | `t0_000_base__tattoo_01.app` `dd295832e8b2d1ae`, `tx_000_pwa_base__full_tattoo_01.morphtarget` `2ba62e4a6eff87ed`, mesh `fc933af2082c6b4e` |
| Body scars | `scars_000_base.app` `affeac67200fa358`, `t0_000_pwa_base__scars.morphtarget` `68fae78ea5d5c6ed`, mesh `e55041c95fd498e1` |

The lifted-feet `.app` on the reference profile comes from the UV framework's archive and WolvenKit 9.0.1 can't read it (the same `castShadows` layout question as [file chain open question 13](../../knowledge/cc-file-chain.md#open-questions)); the preview's flat-feet default doesn't read it.

## Observations recorded here in detail

**Censorship rules** [resource]: `censorFlag` / `censorFlagAction` on the female body options: `body_color` Censor_Nudity/Deactivate, `body_color_censored` Censor_Nudity/Activate (both creator slot `body_color`), `underpants` Censor_Nudity/Activate (slot `underpants`), `nipples` switcher and `nipples_01…04` Censor_Nudity/Deactivate (slot `nipples`, no resource on the feminine options), `genitals` switcher and `genitals_0N` Censor_Nudity/Deactivate, `breast` (morph) Censor_Nudity/Deactivate; tattoos, scars, feet and every arms option `0`.

**Joint rest transforms** [resource]: world rest position and rotation of joints in the WolvenKit 9.0.1 export of `a0_000_pwa_base_hq__l.mesh` (the served chunk copy) against `cc-idle-body.glb`'s rig nodes; equal within 0.001 for `Hips`, `Spine3`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `RightArm`, `Neck` (for example `LeftForeArm` at (−0.330, 1.286, 0.023) in both). The arm export's 120 joints and the body's 167 are all direct children of the `Armature` node. Of the arm's joints, 38 are rig nodes, 6 are in the head's idle binding ancestry (shoulder and neck muscle joints) and 76 are neither (`l_SHL_0_JNT`, `l_deltoid_*`, `l_triceps_mscl_JNT`, `l_Wrist_0/1/2_JNT`, knuckle and thumb muscle joints). A CPU simulation of the idle at 2 s bound all 120 once the nearest-segment rule was in, and moved the arm chunks' vertices by 0.10–0.42 m (median per chunk), where the upper arm alone had moved before.

**Export attributes** [resource]: the arm, feet and cover exports carry `_GARMENTSUPPORTWEIGHT` and `_GARMENTSUPPORTCAP` vertex attributes and a `GarmentSupport` shape key; the body export has the two breast shape keys (`t0_000_wa_base__full_breast_small_breast`, `…_big_breast`); the nails export (the nails morph mod's target over the nails framework's mesh) has its length shape key and no joints or weights.

**Texture sizes on the reference profile** [resource]: the body's `d02_naked`, `n02_naked`, `wa_base_rm02` and `fullbody_overlay_d01` export at 8192² (36 MB and 27 MB PNGs for the largest). Served at 4096², one V's distinct textures came to 125 M texels (the record's budget is 268 M), and the whole V's first preparation after the scaled copies existed took seconds.

### Holster-state records

27 September 2026, read-only, with the Studio's TweakDB reader (`src/tweakdb-flats.ts`) under the memory guard. Inputs: `r6\cache\tweakdb.bin` SHA-256 `918f0acfc3f3174b29b5c10b463dfb106b603118c85d24456204a1e2a2ac13f9` and `tweakdb_ep1.bin` SHA-256 `89c7ee678c1366d4c289edc78beaa60ce3d64bf44b300fc3902adc94f6ac14c5`, which hold the same values [resource]:

| Weapon record | `cyberwareType` | `holsteredItem` (TweakDBID as a number; the record's name was not recovered) | Holstered item's `appearanceName` |
|---|---|---|---|
| `Items.w_melee_004__fists_a` | — | `Items.HolsteredFists` | `holstered_default` |
| `Items.StrongArms`, `Items.StrongArmsLegendary` | `StrongArms` | `111672476241` | `holstered_strong` |
| `Items.MantisBlades`, `Items.MantisBladesLegendary` | `MantisBlades` | `135086907534` | `holstered_mantis` |
| `Items.NanoWires` | `NanoWires` | `122871210708` | `holstered_nanowire` |
| `Items.ProjectileLauncher` | `ProjectileLauncher` | `163616915732` | `holstered_launcher` |

Every holstered item: `entityName` `holstered_arms`, `equipArea` `EquipmentArea.RightArm`, `placementSlots` `[AttachmentSlots.RightArm]`. The weapons' own `appearanceName` is `None`; their `entityName`s are `a0_005__strongarms_ent`, `a0_003__mantisblades_ent`, `a0_002__monowire_whip_ent` and `a0_006__launcher_ent`. Scripts (decompiled, as above): `cyberpunk/systems/equipmentSystem.script` `UpdateArmSlot`, `HandleArmsCWUnequip`, `RetrofixHolsteredArms`; `cyberpunk/managers/rpgManager.script` `ForceEquipStrongArms`. ArchiveXL `5474e34d` `src/App/Extensions/PuppetState/Handler.cpp` (`ResolveArmsState`, `IsWeaponSlot`).

## Preview checks

Captured with `tools/body-look.ts` (headless Chrome, ANGLE D3D11 on an RTX 4070, `?verify=1` with disposable data, the reference MO2 profile, dark theme), frames in `evidence/screenshots/body-render/` (ignored):

| Run | What it shows |
|---|---|
| `default-4` | The default V: body, flat feet, arms, hands, nails and the underwear cover, head and neck joined; bind pose and the idle (arms by the sides); the body hidden |
| `choices-3` | Senna tone across head and body, body tattoo 1, body scar 1, big breasts under the cover, long nails with the layered design, under both lighting presets |

`renderer.info.memory` with the body shown and hidden was the same (the toggle releases nothing); the real-GPU probe (`tests/webgl-body.test.ts`) measures the draw, the toggle, the depth range and the release on a synthetic body.

**Makeup screenshot parity** (`tools/scene-parity.ts`, the step-7 gate), with the body shown (its default), leaving out the viewport toolbar's corner (x 380–583, y 0–47 of each 584×788 frame), where the new whole-body button shifts the toolbar's icons (with the corner included every frame differs in exactly those 831 pixels):
- against two captures of `main` at `4053038`: all 20 frames of the branch identical to a base capture;
- after merging `main` at `9ca6c78`, against two new captures of it: 19 frames identical; the first creator frame (`bare-creator-1024`) differs from the nearest base in 4 pixels by one step, the known run-to-run noise of that frame (the two new base captures themselves differ in 3 pixels by one step on `board2-creator-2048`).

**Tooling note**: the memory guard started through the `python` alias from the Windows app store package runs its children inside the package's AppData virtualization, so the localhost host found no saved settings (`%LOCALAPPDATA%\XF Studio`) and asked for setup; started through the interpreter's own path it found them.
