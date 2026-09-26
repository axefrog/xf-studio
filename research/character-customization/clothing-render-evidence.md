# Worn clothing: render-chain evidence

27 September 2026. Provenance behind [worn clothing §6](../../knowledge/clothing.md#6-how-the-studio-draws-worn-clothing) (clothing render phases 1–4, `claude/clothing-render`). Offline, read-only inspection plus the Studio's own preview in isolated `?verify=1` workspaces. No game launch, no MO2 launch and no write under the game, MO2 or save folders. Resolver reports, decoded save data, exported geometry and captures stay in ignored locations (the session's scratch folder, the worktree's own preview and resolver caches, and `projects/xf-studio/authoring/evidence/screenshots/clothing-render/`).

## Tools and inputs

| Input | Version / identity |
|---|---|
| Installed game | 2.31 with Phantom Liberty, at `PATH_TO_GAME`; `r6\cache\tweakdb_ep1.bin` |
| Resolver | XF Studio generic resolver on the MO2 route (1,079 mounted archives), WolvenKit CLI 9.0.1 as the fetcher |
| Native reader | XF Studio's `native/` reader (Oodle from the game folder) for the visual-tag preset |
| Check save | A private 2.31 save (save version 269, 169 nodes); never committed |
| Newest game save | A private 2.31 quick save taken while EquipmentEx dressed V (read-only) |
| Game scripts | 2.31 `final.redscripts`, decompiled privately (as in [body render evidence](body-render-evidence.md)): `equipmentSystem.script` |
| ArchiveXL | Source at 5474e34 (1.27.3): `Garment/Config.cpp`, `ChunkMask.hpp`, `Prefix.cpp`, `States.cpp`, `Extension.cpp`; `FactoryIndex/Extension.cpp`; `PuppetState/Handler.cpp`, `Extension.hpp`; the installed bundle's `VisualTags.xl` |
| WolvenKit | Source at 11720772: `RedPackageReader.File.cs`, `PackageParser`, `WardrobeSystemClothingSetsParser.cs`; `usedhashes.kark` (known depot paths) |
| RTTI dump | `red-dump-json` at `a8e52990`: `gameWardrobeClothingSetIndex`, `EquipmentSystemPlayerData` |

## The check save's loadout [resource]

`ScriptableSystemsContainer` (21,482 bytes): node ID, u32 size, then a version-4 package with six sections and a u32 CRUID count (57). Two `EquipmentSystemPlayerData` objects: the player's (`ownerID.hash` 1) and one with `ownerID` 9000324 and only its slot tables. The reader consumed the player's object to its chunk's last byte with nothing skipped. `WardrobeSystem_ClothingSets`: 9 bytes, count 0, then 8 (`INVALID`).

| Area | Record (TweakDB) | `appearanceName` → root appearance | `.app` / definition | Tags (preset ∪ entity ∪ definition) |
|---|---|---|---|---|
| OuterChest | `player_outer_torso_item`, suffixes Gender, Camera | `t2_vest_14_q000_nomad_nopatch_` → `…&Female&TPP` | `t2_vest_14.app` / `_q000__nomad_nopatch_w` | `Leather_normal`, `Large` |
| InnerChest | `player_inner_torso_item`, Gender | `t1_tshirt_01_q000_nomad_` → `…&Female` | `t1_tshirt_01.app` / `_q000__nomad_w` | `Tight`, `Cotton` |
| Legs | `player_legs_item`, Gender | `l1_pants_02_q000_nomad_` → `…&Female` | `l1_pants_02.app` / `_q000__nomad_w` | `Normal` |
| Feet | `player_feet_item`, Gender | `s1_boots_05_q000_nomad_` → `…&Female` | `s1_boots_05.app` / `_q000__nomad_w` | `Large`, `Sneakers` |
| UnderwearBottom (saved hidden) | `player_underwear_bottom_item` (`Items.Underwear_Basic_01_Bottom`) | `l1_underwear_01_basic_01_` → `…&Female` | hidden under the legs (underwear rule) | `Tight` |

Drawn components: the vest (`t2_021_pwa_vest__denim` with its torn patch; its `metal_base.remt` chunks and the collar shadow mesh are left out), goggles on the vest's appearance (`i1_020_pwa_neck__goggles`, layer 80), the torn shirt (`t1_073`, 70), jeans (`l1_012`, 60) and racing boots (`s1_057`, 50). No worn item's definition carries `visualTags`, so no body chunk is masked; the boots set the lifted feet group, whose `.app` this profile's UV framework archive supplies and WolvenKit 9.0.1 can't read (the known `castShadows` case), so the record says the feet aren't shown (they are inside the boots).

The newest quick save marks every clothing area `isHidden` (EquipmentEx's `HideEquipment`) and wears two items the compiled TweakDB doesn't define (TweakXL items): the Studio shows no clothes from it and says why.

## First resolution cost

On a cold resolver cache the first V with clothes took about 80 s, almost all of it reading the ~640 factory `.csv` files the profile's `.xl` files declare (four WolvenKit batches); they are cached as JSON afterwards, and the preset table (one native decode of 13 MB of JSON) is cached per archive identity.

## Preview checks

`tools/clothing-look.ts` (headless Chrome, ANGLE D3D11 on an RTX 4070, `?verify=1` with disposable data, dark theme), frames in `evidence/screenshots/clothing-render/` (ignored):

| Run | What it shows |
|---|---|
| `run-1` | The check save under **Without headwear and face items** (the default), **As saved** and **Underwear only**: head, whole body, side and torso views. Underwear only shows the basic bra (filled in, the save has no top) and the save's own underwear bottom, bare feet on the flat feet group |
| `run-2` | **Choose areas** with the outer torso switched off (vest and goggles gone, shirt kept) and the Character panel's Clothing section |

Real-GPU probe (`tests/webgl-clothing.test.ts`): two garments baked by the layered adapter, a higher layer winning a coincident surface, a body chunk the record leaves out drawing nothing, the body shape carried to a garment (each of two garments sharing one exported geometry gets its own key: a bug the probe found and the loader now avoids), the Body toggle, and no GPU memory growth between rounds.

**Makeup screenshot parity** (`tools/scene-parity.ts`, the default V, which wears nothing): after merging `main` at `4029c59`, all 20 frames of the branch identical to one of two captures of `main` at `4029c59`, with no ignored region. (A first comparison differed only in the viewport toolbar, because the worktree lacked the ignored idle assets that add a play button; with them in place, none differs.)
