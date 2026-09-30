# Piercings and jewellery

**Maturity: Draft.** Consolidated from the vanilla 2.31 creator, piercing `.app`, `.morphtarget` and `.mesh` resources (female in detail, male creator entries), ArchiveXL 1.27.3 source, the installed PRC framework and the Modding Docs, on 26 September 2026; extended on 30 September (levels of detail, the site atlas, headgear and component prefixes, the community rigging workflow, materials for owned pieces). There is no runtime evidence specific to piercings yet; the CCXL mechanism itself is runtime-proven through XF Eye Artistry. Evidence grades follow the [knowledge rules](README.md): **[source]** framework or tool source, **[resource]** extracted game or mod resources, **[wiki]** Modding Docs text or image, **[runtime]** running game, **[hypothesis]** not yet established. Detailed evidence and the proposed Studio design are in the [CCXL piercing feasibility study](../research/jewellery/ccxl-piercing-feasibility.md).

This page answers how the game's piercings are chosen, built and attached, how mods add jewellery, and what an additive creator-choice export must look like. The option catalogue is in the [CC file chain](cc-file-chain.md#4-every-cc-detail-and-what-drives-it); the multilayered shader is in [materials and shaders](materials-and-shaders.md).

## 1. The chain at a glance

| Step | Vanilla | Grade |
|---|---|---|
| Creator rows | Switcher `piercings` (`UI-CharacterCreation-piercings`, `uiSlot` `piercings`, index 290 female / 520 male, edit tags `NewGame`/`HairDresser`/`Ripperdoc`, randomise category `FaceModification`): Off + 14 styles (female) or Off + 16 (male), labelled `Common-Off`, `01`, `02`, … Choice N activates appearance option `piercings_NN` (`uiSlot` `piercings_color`, `useThumbnails` 1, 16 colour definitions, link `piercings color`). Off activates `piercings_00`, a single `None` definition. | [resource] |
| Consumer groups | Every `piercings_NN` is in `face` (gameplay and photo mode) and `character_customization` (the creator puppet); the switcher is only in `character_customization`. | [resource] |
| `.app` | `base\characters\head\player_base_heads\appearances\head\piercings\i0_000__earring_NN.app`, both genders' appearances in one file (`i0_000_pwa__earring__01_silver`, `i0_000_pma__…`). Female styles 12–14 use `earring_14/15/16.app`; `earring_12/13.app` hold only male appearances. | [resource] |
| Components | Up to three `entMorphTargetSkinnedMeshComponent`s per definition (`i1_000_pwa__morphs_earring_01…04`), inline and through `partsValues` `…\appearances\entity\items\i1_000_pwa_earring__basehead_0N.ent`; `partsOverrides` set one `meshAppearance` (the colour) and a per-component `chunkMask` (the pieces). | [resource] |
| Geometry | `…\player_female_average\i1_000_pwa__morphs_earring_0N.morphtarget` → `baseMesh` `…\h0_000_pwa_c__basehead\i1_000_pwa_c__basehead_earring_0N.mesh` | [resource] |
| Level of detail | One: every bank has `lodLevelInfo` `[0]` and every chunk `lodMask` 1; pieces are 12–786 vertices. Components cast shadows (`castShadows` and `castLocalShadows` `Always`) and hide beyond 50 m (`autoHideDistance`) | [resource] |
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

**The pieces as a site atlas** [offline, from the four exported bank GLBs, 30 September]. The 29 pieces sit at about 20 distinct sites: both lobes (`earring_04` pieces 0 and 1, `earring_01` pieces 1, 2 and 9), a graded run of six helix studs up V's left ear (`earring_01` 3–8, 3.5 mm down to 1.7 mm), upper-ear pieces on V's right (`earring_01` 0 and 10, `earring_02` 3 and 4, `earring_04` 2, which is 56 mm tall), both brows (`earring_02` 10–12), the nose bridge (8, 9), the right upper cheek (0, 1), three lip sites (5–7), the septum and the left nostril (`earring_03`). Three sites are left/right pairs whose centres mirror within about 1 mm (lobe studs, lip corners, bridge), so the head is near-symmetric there. Vanilla pieces are small: the lobe hoop is about 12 mm across, the septum ring 14.5 mm wide.

## 3. How a piece follows the face

- **Skinning:** each bank mesh is skinned to the face joints under its pieces, so pieces ride facial animation with the skin [resource: bone lists; behaviour hypothesis].
- **Morph targets:** each mesh carries the creator's `(target, region)` pairs, but only for the regions its pieces sit in (ear pieces: `ear` only). A slider applies its pair to every morph-skinned component that has it; a component without it does not follow that slider [resource + hypothesis on the manager].
- **Colour:** the definition's one `meshAppearance` applies to every component, so a vanilla style has one colour for all pieces [resource].
- **Pieces bend with their region, they don't just ride it.** Within one piece the morph deltas differ per vertex: under the `ear` target `h055` the vertices of a left lobe hoop (`earring_01` piece 1) move by amounts up to 2.2 mm apart along one axis, and those of the long right-ear piece (piece 0) up to 8.4 mm apart. The deltas look transferred from the skin around each vertex rather than applied rigidly [resource: `earring_01`/`_03` diff rows decoded, 26 September].
- **The banks' morph targets carry no rig.** Their target entries have empty `boneNames` and `boneRigMatrices`, while the head's (and PRC's linked pieces', and the eye plate's) carry all 254 joints per target [resource]. The head's 21 shapes each carry their own binds (the five regions of one shape share them), moving 244 of 254 joints, the six jaw-ear joints included, by up to about 13 mm in the inverse binds' translation; `Head` does not move [resource, 30 September; [facial animation](facial-animation.md)]. What the per-target rig does at run time is unread.
- **Format details a generator must match** [resource]: a bank mixes vertex factory 3 (four influences, 16-byte position stream) and 4 (eight influences, 24 bytes, the head's layout minus its extra-data and light-blocker streams) chunk by chunk; normals are Dec4 with top bits `01`, tangents `00` or `11`; vertex colour is zero; UV0 runs along a ring (0–1) and around its wire (0–0.16); a morph row whose normal or tangent does not change stores `0x5ff7fdff`; each bank mesh has local material instances whose base is a shared `…\earrings\i1_000_base_0N__<colour>.mi`.
- **How the community rigs a piece** [wiki: Mx_OrcBoi's [PRC piercing guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/a54b08735a560bca7dd76b1e1dab1631e6aaae89/modding-guides/npcs/custom-facial-piercings-prc-framework.md), a technique taught by eagul]: transfer weights from the vanilla piece or the head, then flatten the piece to one weight per joint "since piercings are solid objects"; position the piece by hand for each shape key of its own region only (nose keys for a nose piece). The guide warns that a morph target whose shape keys all stay at the basis crashes the game, so a generated piece must carry at least one non-zero row. XF Studio's probe does the same automatically: every vertex takes one head vertex's skin bytes and morph rows ([experiment 024](../experiments/024-ccxl-piercings/README.md)).

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
- its row `index` is free: two top-level options with the same index show only the first [wiki: [CCXL overview](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/README.md)]. After vanilla Piercings, female indices 306–309 and male 538–539 are free in vanilla 2.31 (male also 510–519 just before Piercings and 541–549 after Teeth; female 287–289 just before) [resource];
- its components are named with the prefix `i1_` (`i1_xfs_…`): ArchiveXL's bundled `hide_Head` tag hides components by prefix, `i1_` among them, and a component's prefix is its name up to the first `_` within six characters, so an `xfs_…` component is never hidden with the head [source: ArchiveXL `Garment/Prefix.cpp`, `bundle/source/resources/VisualTags.xl`; [clothing §4.3](clothing.md#43-masking-the-body-resource-source-wiki)]. Experiment 024's probe components are `xfs_`-prefixed, so its headgear check needs a rebuild to mean anything;
- it joins `face` and `character_customization`, as vanilla piercings do (the wiki's generic switcher example uses `FPP`/`TPP`/`TPP_photomode`/`character_customization` instead).

Referencing vanilla resources by path (for example a vanilla earring `.mi` for a finish) replaces nothing and redistributes nothing.

## 5a. Materials for owned pieces

| Route | Holds | Limits | Grade |
|---|---|---|---|
| Vanilla earring `.mi` by depot path | The 16 finishes (`silver`, `gold`, `black`, `cooper`, `red`, `pink`, `pearl`, `blue`, `mixed`, `mixed2`, `neon_teal`, `pink_metalic`, `rainbow`, `rose_gold`, `steel`, `wood`), `multilayered.mt` with the bank's shared `.mlmask` | Patterned finishes show the mask's vanilla UV islands on new geometry: the community guide's in-game screenshot shows a wood septum ring half covered, and its fix is a modified mask. Plain metals come from the base layer and should not depend on UVs | [resource]; [wiki] images `custom_weird_mat.png`, `custom_weird_mat_example.png`; plain metals [hypothesis] |
| Own multilayered setups | Any game `.mltemplate` stack with our own mask | A layer's colour is a CName into its template's colour table: no arbitrary colours | [source] |
| `metal_base.remt` | Free colour (`BaseColorScale`), metalness and roughness as scale and bias, a normal map, emission (`EmissiveEV`) | No character instance uses its emission, so the in-game look of an emissive piece is unseen | [source] |
| `glass_onesided.mt` (gems) | Transparency, tint, refraction and blur | Reflects only the sun and the probes, so creator and photo-mode lights put no highlight on it; an opaque faceted stone on a Standard template catches every light | [source] |

Details: [materials and shaders](materials-and-shaders.md) §4.6–4.7 and [metal and glass](../research/materials/shader-metal-glass.md).

## 6. What the Studio does today

The generic resolver renders the shown V's piercings, vanilla or from any installed framework, through the layered (`multilayered.mt`) adapter; PRC's option 12 resolves as its bank with no PRC-specific code ([file chain §8](cc-file-chain.md#retiring-the-prc-specific-code)). An installed CCXL jewellery option would resolve the same way. There is no jewellery authoring or export yet. A scripted probe mod built with the proposed fitting ([experiment 024](../experiments/024-ccxl-piercings/README.md)) waits for its in-game session. It has three procedural pieces, each carrying the skin bytes and morph rows of one anchor head vertex, on two own rows per area. The [construction set](../research/jewellery/construction-set-design.md) is a design proposal, and the [feasibility study](../research/jewellery/ccxl-piercing-feasibility.md#5-proposed-design) proposes the export shape (additive XF rows per area, owned pieces skinned at their anchor and carrying the head's morph deltas). The [piercings and earrings brief](../research/backlog/piercings-and-earrings-brief.md) turns these into a phased plan with questions for the maintainer.

## Open questions

1. Do generated rigid pieces with anchor-copied skin and anchor-displacement morph deltas stay seated through sliders and facial animation? (Feasibility checks 4–6.)
2. Does a piece need every region's targets, or only its site's, as vanilla ear pieces suggest?
3. How do vanilla helmets and masks hide creator piercings, and would ours hide the same way? **Partly answered [source]:** ArchiveXL's `hide_Head` hides every `i1_` component, so pieces named `i1_xfs_…` hide with the head under items that carry that tag; no vanilla item carries it, so how vanilla headgear treats piercings is still unread.
4. What does the game do with a saved piercing choice whose mod was removed?
5. Can patterned finishes (rainbow, mixed, wood) share the vanilla `.mlmask` on new geometry, or does each look need its own setup and mask? **Answered for patterned finishes [wiki]:** they show the vanilla mask's islands on new UVs (§5a), so they need our own mask or UVs laid out like vanilla. Plain metals on new UVs remain probe check 7.
6. Does a dangle animation graph inside a creator `.app` give earrings physics in both the creator and gameplay? **Partly answered [resource]:** the cached vanilla creator piercing `.app` files carry no dangle component; worn physics earrings add one controlled by V's skeleton but skin their mesh to `root`, which leaves how their joints reach the mesh open ([dangle physics §2.1](hair-physics.md#21-components-and-bindings), in-game check H5).

## In-game test asks

The batched probe is the [feasibility study's test plan](../research/jewellery/ccxl-piercing-feasibility.md#6-in-game-test-plan), built as [experiment 024's test card](../experiments/024-ccxl-piercings/README.md#test-card-the-12-checks): registration beside the untouched vanilla row, layering with vanilla and PRC, slider and animation following, per-piece materials, gameplay and photo mode, persistence and Off, headgear, and missing-mod behaviour.

## Related pages

[Piercings and earrings brief](../research/backlog/piercings-and-earrings-brief.md) · [CC file chain](cc-file-chain.md) · [Head CC rendering](head-cc-rendering.md) · [Materials and shaders](materials-and-shaders.md) · [Mod loading](mod-loading.md) · [CCXL piercing feasibility](../research/jewellery/ccxl-piercing-feasibility.md) · [Construction set](../research/jewellery/construction-set-design.md) · [PRC inventory](../research/jewellery/prc-inventory.md)
