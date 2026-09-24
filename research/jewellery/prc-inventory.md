# PRC piercing inventory and implementation boundary

Read-only survey, 23 September 2026. This is an inventory of installed candidates and a resource-level inspection, **not** a claim about effective game load order or rendered results. Nothing here authorizes redistribution of third-party meshes, morphs, materials or archives. Piercing authoring is a later XF Studio feature that requires discussion with the maintainer before implementation.

## What the installed framework does

The installed [PRC — Fully Modular Jewellery Framework](https://www.nexusmods.com/cyberpunk2077/mods/8590) is eagul's v1.1 (Nexus mod 8590; last updated 22 September 2023). Its only payload is `F:/Games/MO2/mods/PRC - Fully Modular Jewellery Framework/archive/pc/mod/PRC_z_999_Framework_128.archive`. A WolvenKit CLI 8.17.4 archive listing found 259 entries: 128 female `eagul\piercingmorphs\female\fpmN.morphtarget` files, 128 male `eagul\piercingmorphs\male\mpmN.morphtarget` files, `wa_linked.mesh`, `ma_linked.mesh`, and a replacement vanilla `base\characters\head\player_base_heads\appearances\head\piercings\i0_000__earring_14.app`.

Converting that `.app` for inspection found 32 appearances: 16 material appearances for each body variant. Each appearance contains 128 `entMorphTargetSkinnedMeshComponent` entries named `fpm1`–`fpm128` or `mpm1`–`mpm128`, pointing at the corresponding morph resources. Separate PRC item archives override selected placeholder morph targets. Thus the framework supplies a fixed slot bank and the accessory packs fill it; the inspected archive contains no `.inkcharcustomization`, `.xl`, TweakDB YAML or script. [The author says](https://www.nexusmods.com/cyberpunk2077/mods/8590) it appears through the existing piercing slider at option 12 for female V and 14 for male V, supports face sliders through morph targets, and that slot 9 is broken. The author recommends [xBaebsae's Facial Customisation Rig Fix](https://www.nexusmods.com/cyberpunk2077/mods/7179) for facial animation accuracy but says PRC can work without it. This PRC system is separate from Nim's older head-mesh-based New Piercings Collection.

This is a **pre-CCXL** design. In an [August 2026 author reply](https://www.nexusmods.com/cyberpunk2077/mods/8611?tab=posts), eagul confirmed it still replaces piercing option 12 and was not a CCXL mod. A CCXL migration was being explored in a May 2026 comment, not released or proven by these installed files.

## Installed candidates and slot collisions

Profile flags below come from `F:/Games/MO2/profiles/2025 (again)/modlist.txt`; version and Nexus ID come from each folder's `meta.ini`; target resources come from individual archive listings. `+` means selected in that saved profile. It does **not** prove the archive was loaded, won a conflict, or rendered on the reference V. All listed item morph targets are female; framework placeholders also cover male slots.

| MO2 folder (under `F:/Games/MO2/mods/`) | Profile | Nexus ID / installed version | Archive target or other payload |
| --- | :---: | --- | --- |
| PRC - Fully Modular Jewellery Framework | + | 8590 / 1.1.0.0 | Replacement `.app`, 256 slot placeholders, two linked meshes |
| PRC - Nose ring on both sides (front) | + | 10236 / 1.0.0.0 | `fpm72`, `fpm74` |
| PRC - Nose stud | + | 8611 / 1.1.0.0 | `fpm50`, `fpm50_linked.mesh`; separate `nim_piercings_recolor_silver.archive` contains `base\eagul\mat_1.mi` |
| PRC - Double nose rings (her left) | - | 8611 / 1.1.0.0 | `fpm16` |
| PRC - Double nose rings (her right) | - | 10236 / 1.0.0.0 | `fpm74`, `fpm75` |
| PRC - Heart Medusa Piercing - Fem V | - | 10286 / 1.0.0.0 | `fpm60` |
| PRC - Labret (lower lip + under) | - | 10238 / 1.0.0.0 | `fpm2` |
| PRC - Lower lip fangs | - | 8611 / 1.1.0.0 | `fpm37` |
| PRC - Lower lip middle ring | - | 8611 / 1.1.0.0 | `fpm42` |
| PRC - Lower lip ring (her left) | - | 8611 / 1.1.0.0 | `fpm36` |
| PRC - Lower lip ring (her right) | - | 8611 / 1.1.0.0 | `fpm35` |
| PRC - Nose ring and chain | - | 8611 / 1.1.0.0 | `fpm30` |
| PRC - Nose ring on both sides (back) | - | 10236 / 1.0.0.0 | `fpm73`, `fpm75` |
| PRC - Nostril spike studs with bridge chain | - | 10238 / 1.0.0.0 | `fpm53` |
| PRC - Septum ring (ball) | - | 8611 / 1.1.0.0 | `fpm17` |
| PRC - Septum ring (larger) | - | 8611 / 1.1.0.0 | `fpm49` |
| PRC - Septum ring (orc-like) | - | 8735 / 2.0.0.0 | `fpm112` |
| PRC - Septum ring (smaller) | - | 8611 / 1.1.0.0 | `fpm17` |
| Stretched Septum 2 For PRC | - | 29458 / 1.0.0.0 | `fpm17` |

The two selected item folders target distinct morph slots (`50`, `72`, `74`). Potential same-path collisions among currently unselected choices include `fpm74` (front pair versus double nose rings, her right), `fpm75` (back pair versus double nose rings, her right), and `fpm17` (three septum alternatives). A future source resolver must examine all active archives, overrides and actual load-order rules before assigning an effective asset to a slot. eagul's [Vol. 1 description](https://www.nexusmods.com/cyberpunk2077/mods/8611) also warns that fangs with lip rings can clip and that the nose diamond's second submesh needs a separately chosen colour.

The selected profile also has `Equipment-EX` (Nexus 6945 metadata version 1.0.0.0), `Facial Customisation Rig Fix - No more clipping Eyes` (7179 / 4.2.1.0), and `Kwek's Small Fancy Hoop Earrings with Physics - Designed for EquipmentEX - req ArchiveXL TweakXL` (7020 / 1.1.0.0) enabled. These are nearby implementation references, not PRC slot providers. The Equipment-EX installation file in MO2 metadata is a `HideHubButtons` variant; that metadata alone cannot establish the running core version.

The maintainer's earlier `F:/Games/RedModding/Projects/xf-prc-piercings` is a separate, untouched 1.0 WolvenKit project. It contains `eagul\piercingmorphs\female\fpm73.morphtarget` and `fpm75.morphtarget`, `wa_linked.mesh`, and a vanilla `i1_000_pwa_c__basehead_earring_03` mesh/raw GLB/material reference. It is a local research lead for attachment, deformation and historical intent, not evidence that a build was installed or that those source files may be distributed.

## Preview and future implementation routes

For a private preview, the installed PRC framework and item archives identify which morph resources to resolve. A bounded probe would extract only the selected resources into ignored local inputs, inspect each morph target's embedded base mesh, facial morphs, skinning and materials, then compare placement through neutral and animated poses against the studio's current head. The old project offers a second geometry reference. This requires a true source-resolution record; scanning a `+` profile flag or an archive filename is insufficient. No PRC resource was added to the studio or a release by this survey.

For an owned character-creator implementation, [CCXL documentation](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions) identifies existing `piercings` and `piercings_color` switcher slots. A prototype could register independently authored appearance and morph resources without replacing PRC's vanilla `.app`, then test stable save identity, Off, material colour, morph response and coexistence with option 12. This is a hypothesis; there is no evidence that current PRC assets can simply be moved into CCXL or that doing so preserves its modularity.

For inventory-worn earrings, the selected Kwek mod is a concrete ArchiveXL/TweakXL/EquipmentEx consumer: `F:/Games/MO2/mods/Kwek's Small Fancy Hoop Earrings with Physics - Designed for EquipmentEX - req ArchiveXL TweakXL/r6/tweaks/kwek_clothing_earrings_02.yaml` bases items on `Items.GenericFaceClothing` and appends `OutfitSlots.EarLeft`; its `.archive.xl` registers an item factory and localization. An owned earring could follow this pattern, with EquipmentEx providing presentation slots. This is an earring fallback, not proof that facial piercings attach or persist correctly as inventory items. Those geometry and save questions need an isolated fixture before choosing it for nose/lip pieces.

## Provenance and rights

The [framework](https://www.nexusmods.com/cyberpunk2077/mods/8590), [Vol. 1](https://www.nexusmods.com/cyberpunk2077/mods/8611) and [vanilla mirrors](https://www.nexusmods.com/cyberpunk2077/mods/10236) pages identify eagul as their creator. The framework credits Auska for morph-target import, Manavortex for troubleshooting and Priterna for its thumbnail; these are attributed upstream contributions, not evidence that their assets were used here. The framework and Vol. 1 Nexus permissions require author permission for asset reuse and modification, and forbid reupload. Vol. 1 text offers male-V adaptation permission, but that statement does not clear general XF Studio reuse. Treat all third-party payloads as local study material pending explicit permission and a resource-by-resource provenance review. Research here is learning from architecture and packaging; **no code or asset adaptation or reuse occurred**.

No game launch, installation, archive modification, HQ asset change, or runtime winner test was performed. WolvenKit CLI listing and one framework `.app` conversion were used for offline inspection; that conversion went only to the system temporary directory.
