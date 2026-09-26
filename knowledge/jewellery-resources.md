# Piercings and jewellery

**Maturity: Draft.** Consolidated from the vanilla 2.31 creator, piercing `.app`, `.morphtarget` and `.mesh` resources (female in detail, male creator entries), ArchiveXL 1.27.3 source, the installed PRC framework and the Modding Docs, on 26 September 2026. There is no runtime evidence specific to piercings yet; the CCXL mechanism itself is runtime-proven through XF Eye Artistry. Evidence grades follow the [knowledge rules](README.md): **[source]** framework or tool source, **[resource]** extracted game or mod resources, **[wiki]** Modding Docs text or image, **[runtime]** running game, **[hypothesis]** not yet established. Detailed evidence and the proposed Studio design are in the [CCXL piercing feasibility study](../research/jewellery/ccxl-piercing-feasibility.md).

This page answers how the game's piercings are chosen, built and attached, how mods add jewellery, and what an additive creator-choice export must look like. The option catalogue is in the [CC file chain](cc-file-chain.md#4-every-cc-detail-and-what-drives-it); the multilayered shader is in [materials and shaders](materials-and-shaders.md).

## 1. The chain at a glance

| Step | Vanilla | Grade |
|---|---|---|
| Creator rows | Switcher `piercings` (`UI-CharacterCreation-piercings`, `uiSlot` `piercings`, index 290 female / 520 male, edit tags `NewGame`/`HairDresser`/`Ripperdoc`, randomise category `FaceModification`): Off + 14 styles (female) or Off + 16 (male), labelled `Common-Off`, `01`, `02`, … Choice N activates appearance option `piercings_NN` (`uiSlot` `piercings_color`, `useThumbnails` 1, 16 colour definitions, link `piercings color`). Off activates `piercings_00`, a single `None` definition. | [resource] |
| Consumer groups | Every `piercings_NN` is in `face` (gameplay and photo mode) and `character_customization` (the creator puppet); the switcher is only in `character_customization`. | [resource] |
| `.app` | `base\characters\head\player_base_heads\appearances\head\piercings\i0_000__earring_NN.app`, both genders' appearances in one file (`i0_000_pwa__earring__01_silver`, `i0_000_pma__…`). Female styles 12–14 use `earring_14/15/16.app`; `earring_12/13.app` hold only male appearances. | [resource] |
| Components | Up to three `entMorphTargetSkinnedMeshComponent`s per definition (`i1_000_pwa__morphs_earring_01…04`), inline and through `partsValues` `…\appearances\entity\items\i1_000_pwa_earring__basehead_0N.ent`; `partsOverrides` set one `meshAppearance` (the colour) and a per-component `chunkMask` (the pieces). | [resource] |
| Geometry | `…\player_female_average\i1_000_pwa__morphs_earring_0N.morphtarget` → `baseMesh` `…\h0_000_pwa_c__basehead\i1_000_pwa_c__basehead_earring_0N.mesh` | [resource] |
| Material | 17 mesh appearances per mesh (`default`, `silver`, `gold`, … `wood`) → per-chunk `.mi` under `base\characters\common\character_customisation_items\earrings\` → `engine\materials\multilayered.mt`, one shared `.mlmask`, one `.mlsetup` per colour | [resource] |

## 2. The four piece banks

A vanilla style is not its own model: it is a **chunk-mask selection from four shared meshes**, all shown in one colour.

| Mesh | Pieces | Morph regions | Skinned to | Pieces sit at |
|---|---|---|---|---|
| `earring_01` | 11 | `ear` (21 targets) | 11 bones: `Head`, jaw-ear and jaw rows | Both ears (lobe studs, rings, a run of six small studs up one ear) |
| `earring_02` | 13 | all five regions (105) | 73 face joints: brow and lid rows, nose rows, lower lip, mouth rows, chin, jaw-ear | Eyebrows, nose bridge, lower lip, upper cheek, small ear pieces |
| `earring_03` | 2 | `nose` (21) | 6 bones: nostril and nose tip | Septum ring, nostril piece |
| `earring_04` | 3 | `ear` (21) | 16 bones | Two lobe studs and one large ear piece; the only mesh female styles 12–14 use |

The piece counts, regions and bone lists are [resource]; the sites are our reading of each piece's position in the exported geometry. Examples: female style 01 = `earring_01` piece 2 + `earring_02` piece 10 + `earring_03` piece 1; style 11 = all eleven ear pieces of `earring_01`. The wiki's chunk table (credited to xbae's NPV part picker) maps NPC parts and differs for `earring_02` [wiki: [character-creator cheat sheet](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md)]; use the current `.app` masks. A mask bit set means that zero-based submesh is visible ([file chain](cc-file-chain.md#3-from-app-to-pixels)).

## 3. How a piece follows the face

- **Skinning:** each bank mesh is skinned to the face joints under its pieces, so pieces ride facial animation with the skin [resource: bone lists; behaviour hypothesis].
- **Morph targets:** each mesh carries the creator's `(target, region)` pairs, but only for the regions its pieces sit in (ear pieces: `ear` only). A slider applies its pair to every morph-skinned component that has it; a component without it does not follow that slider [resource + hypothesis on the manager].
- **Colour:** the definition's one `meshAppearance` applies to every component, so a vanilla style has one colour for all pieces [resource].
- **Pieces bend with their region, they don't just ride it.** Within one piece the morph deltas differ per vertex: under the `ear` target `h055` the vertices of a left lobe hoop (`earring_01` piece 1) move by amounts up to 2.2 mm apart along one axis, and those of the long right-ear piece (piece 0) up to 8.4 mm apart. The deltas look transferred from the skin around each vertex rather than applied rigidly [resource: `earring_01`/`_03` diff rows decoded, 26 September].
- **The banks' morph targets carry no rig.** Their target entries have empty `boneNames` and `boneRigMatrices`, while the head's (and PRC's linked pieces', and the eye plate's) carry all 254 joints per target [resource]. What the per-target rig does at run time is unread.
- **Format details a generator must match** [resource]: a bank mixes vertex factory 3 (four influences, 16-byte position stream) and 4 (eight influences, 24 bytes, the head's layout minus its extra-data and light-blocker streams) chunk by chunk; normals are Dec4 with top bits `01`, tangents `00` or `11`; vertex colour is zero; UV0 runs along a ring (0–1) and around its wire (0–0.16); a morph row whose normal or tangent does not change stores `0x5ff7fdff`; each bank mesh has local material instances whose base is a shared `…\earrings\i1_000_base_0N__<colour>.mi`.

## 4. How mods add jewellery

| Route | Example | Mechanism | Replaces anything? | Grade |
|---|---|---|---|---|
| **File replacement** | eagul's PRC framework and packs | Ships the vanilla path `i0_000__earring_14.app` with 128 inline slot components; packs overwrite `fpmN.morphtarget` placeholders with real pieces ([file chain §6](cc-file-chain.md#6-case-study-why-prc-piercings-work-in-game)) | **Yes:** vanilla style 12 (female) / 14 (male); packs collide by slot | [resource] |
| **Inventory item** | Kwek's EquipmentEx hoops and 30 other installed jewellery item mods | ArchiveXL item factory + TweakXL record on a face-clothing base with an outfit slot ([PRC inventory](../research/jewellery/prc-inventory.md#preview-and-future-implementation-routes)) | No; separate from the creator | [resource] |
| **Creator choice (CCXL)** | None installed on the reference installation: none of its 31 jewellery or piercing mods declares `customizations` | A new named option in a sex-specific `.inkcharcustomization`, merged by ArchiveXL | Not when names and labels are unique (below) | [source] + [resource] |

PRC's lasting technique is the **linked mesh**: a piece's `baseMesh` bound to the full head skeleton (254 joints) with all 105 face targets, so it can sit anywhere and follow every slider ([PRC preview slice](../research/jewellery/prc-preview-slice.md#linked-mesh-resolution-for-slots-50-and-74)) [resource]. That technique works equally well inside an owned CCXL option.

## 5. Additive rules for a CCXL jewellery option [source]

ArchiveXL 1.27.3 (`src/App/Extensions/Customization/Extension.cpp`, commit `5474e34d`) merges a custom option into the same-named, same-typed base option. It appends a choice whose key is new and **replaces** a choice whose key already exists: appearance definitions by `name` (line 473), morph choices by `localizedName` (line 517), switcher choices by `localizedName` (line 544). A wholly new named option is appended (line 562). Anonymous `uiSlot`/`link` overlays add to **every** matching option. New options that are enabled and not hidden are added to an older save's state at their default (lines 97–143). So an export stays additive only if:

- every option and definition name is new (`xfs_` prefix plus a stable look ID);
- every switcher choice label is a unique text key: vanilla piercing choices are labelled `01`…`16`, so a numeric label **overwrites** a vanilla style;
- it uses no anonymous overlay, `resource.fix.paths`, `resource.patch` on vanilla files, or shipped vanilla or third-party depot path;
- its row `index` is free: two top-level options with the same index show only the first [wiki: [CCXL overview](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/README.md)]. After vanilla Piercings, female indices 306–309 and male 538–539 are free in vanilla 2.31 [resource];
- it joins `face` and `character_customization`, as vanilla piercings do (the wiki's generic switcher example uses `FPP`/`TPP`/`TPP_photomode`/`character_customization` instead).

Referencing vanilla resources by path (for example a vanilla earring `.mi` for a finish) replaces nothing and redistributes nothing.

## 6. What the Studio does today

The generic resolver renders the shown V's piercings, vanilla or from any installed framework, through the layered (`multilayered.mt`) adapter; PRC's option 12 resolves as its bank with no PRC-specific code ([file chain §8](cc-file-chain.md#retiring-the-prc-specific-code)). An installed CCXL jewellery option would resolve the same way. There is no jewellery authoring or export yet. A scripted probe mod built with the proposed fitting ([experiment 024](../experiments/024-ccxl-piercings/README.md)) waits for its in-game session. It has three procedural pieces, each carrying the skin bytes and morph rows of one anchor head vertex, on two own rows per area. The [construction set](../research/jewellery/construction-set-design.md) is a design proposal, and the [feasibility study](../research/jewellery/ccxl-piercing-feasibility.md#5-proposed-design) proposes the export shape (one additive XF row of complete looks, owned pieces skinned at their anchor and carrying the head's morph deltas).

## Open questions

1. Do generated rigid pieces with anchor-copied skin and anchor-displacement morph deltas stay seated through sliders and facial animation? (Feasibility checks 4–6.)
2. Does a piece need every region's targets, or only its site's, as vanilla ear pieces suggest?
3. How do helmets and masks hide creator piercings, and would ours hide the same way?
4. What does the game do with a saved piercing choice whose mod was removed?
5. Can patterned finishes (rainbow, mixed, wood) share the vanilla `.mlmask` on new geometry, or does each look need its own setup and mask?
6. Does a dangle animation graph inside a creator `.app` give earrings physics in both the creator and gameplay?

## In-game test asks

The batched probe is the [feasibility study's test plan](../research/jewellery/ccxl-piercing-feasibility.md#6-in-game-test-plan), built as [experiment 024's test card](../experiments/024-ccxl-piercings/README.md#test-card-the-12-checks): registration beside the untouched vanilla row, layering with vanilla and PRC, slider and animation following, per-piece materials, gameplay and photo mode, persistence and Off, headgear, and missing-mod behaviour.

## Related pages

[CC file chain](cc-file-chain.md) · [Head CC rendering](head-cc-rendering.md) · [Materials and shaders](materials-and-shaders.md) · [Mod loading](mod-loading.md) · [CCXL piercing feasibility](../research/jewellery/ccxl-piercing-feasibility.md) · [Construction set](../research/jewellery/construction-set-design.md) · [PRC inventory](../research/jewellery/prc-inventory.md)
