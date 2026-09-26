# Piercings as character-creator (CCXL) choices: feasibility

Research snapshot, 26 September 2026. This is feasibility research, not a game-tested route. **Status:** the design decisions are recorded [below](#decisions-26-september-2026), and the scripted test fixture of [§6](#6-in-game-test-plan) is built and verified offline as [experiment 024](../../experiments/024-ccxl-piercings/README.md) ("XF Piercings Probe"). It is not staged or seen in game yet; its twelve checks are the next in-game session's piercing block. Authoring UI waits for those results.

**Direction.** The preferred route is piercings as character-creator choices added through ArchiveXL's character-customization feature (CCXL), with a version of the [jewellery construction set](construction-set-design.md) as the design kit behind them. No existing mod offers this: PRC works by replacing a vanilla `.app` file, and other jewellery mods are inventory items.

**Hard requirement.** The route must be **additive**. It must never replace or shadow an existing creator preset, a vanilla choice or another mod's choice. It adds choices alongside them. The [additive audit](#4-additive-audit-what-would-replace-or-shadow-existing-choices) lists every mechanism that would break this rule.

Evidence grades follow the [knowledge rules](../../knowledge/README.md#rules-for-knowledge-pages): **[source]** framework or tool source, **[resource]** extracted game or mod resources, **[wiki]** Modding Docs text or image, **[runtime]** the running game, **[hypothesis]** not yet established.

## Verdict

**Feasible, with high confidence in the mechanism and moderate confidence in the details that only a game session can settle.**

- **The mechanism is proven for another feature.** A Studio-generated CCXL option has been seen working in game (25 September): the XF Eye Artistry selector, one appearance option with an Off definition and one definition per authored look in the `face` and `character_customization` groups, drawing a morph-skinned component. It appears in the creator, gameplay and photo mode, and switching, clearing and save persistence work ([status](../../docs/status.md)) [runtime]. A piercing option is the same kind of option with different geometry.
- **The game's own piercings work the way we would build ours.** Every vanilla piercing style is a fixed set of pieces taken from four shared morph-skinned meshes. Each piece is skinned to nearby face joints and carries the morph targets of the face regions it sits on ([section 1](#1-how-vanilla-piercings-work-in-the-creator)) [resource]. An owned look can reproduce that structure exactly, with its own meshes.
- **ArchiveXL adds options additively when names are unique** ([section 2](#2-what-ccxl-can-add)) [source]. Replacement happens only when an added entry shares a key with an existing one, so our generator can rule it out by construction.
- **PRC's technique transfers; its assets and its file replacement do not** ([section 3](#3-could-prcs-technique-be-driven-by-creator-choices)). The technique is a jewellery mesh bound to the head's skeleton, carrying the head's morph targets.
- **Open until tested in game:** whether pieces generated our way follow the face sliders and facial animation cleanly, how the game treats a save whose XF look has been uninstalled, whether headgear hides our pieces as it hides vanilla ones, and male V. The [test plan](#6-in-game-test-plan) settles these in one session with a scripted fixture that uses no editor and no third-party assets.

Main risks: missing-mod save behaviour (unknown, and the same unknown XF Eye Artistry already carries); fit on heads that face or rig mods change; the construction set's scale (chains and dangles need physics work that static studs don't); and creator clutter if we add many rows. None looks like a blocker.

## Evidence snapshot

| Source | Version | Used for |
|---|---|---|
| Installed game resources | 2.31 (`GameVersion` 2310), extracted with WolvenKit CLI 8.17.4 into the ignored caches `research/consumers/cc-file-chain/` and `research/consumers/vanilla-piercings/` | Creator options, piercing `.app`, `.morphtarget` and `.mesh` structure, per-chunk geometry from the exported GLBs |
| ArchiveXL source | 1.27.3, commit `5474e34d56112f5d8843ae863e1e72ff510957c0` (local clone `D:/Dev/cp2077-archive-xl`) | `src/App/Extensions/Customization/Extension.cpp`: merge rules, activation of new options, app overrides, dynamic appearances |
| Modding Docs clone | commit `be2f44eed8419342ec13f72ed9cab008e9f7b289` (local clone `../Cyberpunk-Modding-Docs`) | CCXL overview, switcher theory, creating-a-switcher guide, character-creator cheat sheet (pages and images cited below) |
| XF Studio | this worktree, `projects/xf-studio/authoring/src/package-resources.ts` | The runtime-proven shape of the XF Eye Artistry option |
| Reference MO2 installation | local, read-only | 31 installed jewellery or piercing mods checked for CCXL declarations |

## 1. How vanilla piercings work in the creator

### The creator rows [resource]

Both body genders have a two-level tree: one `piercings` switcher row whose choices each turn on one appearance option, and those appearance options fill a shared colour row. Values below are from the Phantom Liberty resources `ep1\gameplay\gui\fullscreen\main_menu\female_cco_ep1.inkcharcustomization` and `male_cco_ep1.inkcharcustomization`; the base-game pair is the same for these options.

| Field | `piercings` (switcher) | `piercings_00` (Off) | `piercings_01`…`_NN` (styles) |
|---|---|---|---|
| Type | `gameuiSwitcherInfo` | `gameuiAppearanceInfo` | `gameuiAppearanceInfo` |
| Choices | Off + 14 (female) or Off + 16 (male); labels `Common-Off`, `01`, `02`, … | one `None` definition, no resource | 16 colour definitions each, e.g. `i0_000_pwa__earring__01_silver`, `__02_gold`, `__07_pearl` |
| `uiSlot` / `uiSlots` | `piercings` / `[piercings_color]` | `piercings_color` | `piercings_color` |
| `link`, `linkController` | none | none | `piercings color`, controller on every style, so the colour index carries over between styles |
| `index` | 290 (female), 520 (male) | 291 / 521 | 292–305 (female), 522–537 (male) |
| `enabled`, `hidden` | 1, 0 | 1, 0 | 0, 0 (active only through the switcher) |
| `editTags` | `NewGame`, `HairDresser`, `Ripperdoc` | same | same |
| `randomizeCategory` | `FaceModification` | same | same |
| `useThumbnails` | – | 1 | 1 (colour grid) |
| Groups | `character_customization` | `face`, `character_customization` | `face`, `character_customization` |

The `face` group is read by the player entities' face controller in gameplay and photo mode; `character_customization` drives the creator's preview puppet ([file chain: groups](../../knowledge/cc-file-chain.md#groups-who-consumes-a-choice-resource)).

Style *N* points at `base\characters\head\player_base_heads\appearances\head\piercings\i0_000__earring_NN.app` for styles 01–11 on both genders. Female styles 12–14 point at `…earring_14/15/16.app`: the female list skips `earring_12` and `_13`, whose `.app` files hold only male appearances. That skip is why PRC's replaced `earring_14.app` is "option 12" for female V and "option 14" for male V.

### From a choice to geometry [resource]

Each female definition, for example `i0_000_pwa__earring__01_silver`, is built like this:

- `partsValues`: up to three part entities under `base\characters\head\player_base_heads\appearances\entity\items\`, namely `i1_000_pwa_earring__basehead_01.ent`, `_02.ent` and `_03.ent` (styles 01–11), or only `_04.ent` (styles 12–14).
- `partsOverrides`: one override per component (`i1_000_pwa__morphs_earring_01`…`_04`), all with the same `meshAppearance` (`silver`, `gold`, …) and a 64-bit `chunkMask` that selects which pieces show.
- Inline `components[]`: the same three (or one) `entMorphTargetSkinnedMeshComponent`s, plus a compiled-data package. The `visualTags` value is `Female`.

Each component's morph target is `…\player_female_average\i1_000_pwa__morphs_earring_0N.morphtarget`, with `baseMesh` `…\player_female_average\h0_000_pwa_c__basehead\i1_000_pwa_c__basehead_earring_0N.mesh`. **The four meshes are banks of pieces, and a style is a chunk-mask selection across them:**

| Mesh | Pieces (render chunks) | Morph regions carried | Skinned to (bone list) | Where the pieces sit (GLB centroids, interpreted) |
|---|---|---|---|---|
| `earring_01` | 11 (136, 195, 198, 7 × 112, 12 vertices) | `ear` × 21 | `Head`, `l/r_J_jaw_ear_0…2`, `l/r_J_jaw_rowA/B_0` (11 bones) | Both ears: lobe studs, rings, and a graded run of six tiny studs up one ear |
| `earring_02` | 13 (10 × 66, 195, 180, 180) | all five regions, 105 targets | 73 face joints: brow rows, eye-lid rows, nose rows, jaw-ear, lower lip (`l/r_J_mug_lip_dn_0…3`), mouth rows, chin | Eyebrow (chunks 10–12), nose bridge (8–9), lower lip or labret (5–7), upper-cheek studs (0–1), small ear pieces (2–4) |
| `earring_03` | 2 (256, 190) | `nose` × 21 | `Head`, nostril and nose-tip joints (6 bones) | Septum ring (chunk 0, centred), nostril piece (chunk 1) |
| `earring_04` | 3 (112, 112, 786) | `ear` × 21 | `Head`, jaw-ear, jaw, cheek (16 bones) | Two lobe studs (0, 1) and one large ear piece about 56 mm tall (2); styles 12–14 show one chunk each |

Decoded chunk selections for the female styles, for example: style 01 = `earring_01` chunk 2 + `earring_02` chunk 10 + `earring_03` chunk 1; style 11 = all eleven `earring_01` ear pieces; style 10 = nearly the whole face bank. The site column is our interpretation of piece centroids in the exported GLBs (for example, `earring_03` sits at the nose tip on the midline) [resource: geometry; site names are interpretation]. The wiki cheat sheet's chunk-mask table, compiled with xbae's NPV part picker, gives different numbers for `earring_02` because it maps NPC parts [wiki: `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md`, section "Piercings and submeshes"]. The Studio uses the current `.app` masks.

### How pieces follow the face [resource + hypothesis]

- **Skinning.** Each bank mesh is skinned to the face joints next to its pieces: ear joints for ear pieces, lower-lip joints for labrets, brow rows for brow bars. Pieces therefore move with facial animation the way the underlying skin does [resource: bone lists; behaviour hypothesis].
- **Morph targets.** Each mesh carries the creator's morph targets, named `(target, region)` like the head's (`h015`/`ear` … `h215`/`ear`), but only for the regions it needs. A creator slider applies its `(target, region)` pair to every morph-skinned component that has it ([file chain: morph targets](../../knowledge/cc-file-chain.md#morph-targets-resource-wiki)). Ear pieces follow only the ear slider; the mixed face mesh carries all 105 targets [resource]. That the morph manager simply skips a component lacking a pair is a [hypothesis] consistent with every inspected resource.
- **Materials.** Each named mesh appearance maps every chunk to a per-colour material. The materials all use `engine\materials\multilayered.mt`, one shared mask `base\characters\common\character_customisation_items\earrings\textures\i1_000_pma_c__basehead_earring_01.mlmask` and one `.mlsetup` per colour (for example `…_earring_01_silver.mlsetup`) [resource]. One definition means one colour for every visible piece.

So a vanilla style is already a **complete set** of pieces, one choice per row, with one shared colour. It is exactly the "complete look" model XF Eye Artistry uses.

## 2. What CCXL can add

All from ArchiveXL 1.27.3 `src/App/Extensions/Customization/Extension.cpp` at `5474e34d` unless marked otherwise. Line numbers refer to that commit.

| Capability | How | Grade |
|---|---|---|
| **A new creator row** | A new named option (switcher or appearance) in a sex-specific `.inkcharcustomization` listed under `customizations:` in an `.xl`. A named option matching no existing name is appended whole, with all its own metadata (`MergeCustomOptions`, lines 354–566; the append is line 562). | [source]; demonstrated by XF Eye Artistry [runtime] |
| **New choices in an existing switcher row** (for example vanilla `piercings`) | A named switcher with the same name and type. Its choices merge **by `localizedName`**: a new key is appended, and an existing key **replaces** the vanilla choice (`targetChoice = sourceChoice`, line 544). | [source] |
| **New colours in an existing appearance option** | Definitions merge **by `name`**: a new name is appended and registers an app override from the vanilla `.app` to ours (`RegisterAppOverride`, line 487); an existing name **replaces** the vanilla definition (line 473). Morph choices behave the same by `localizedName` (line 517). | [source] |
| **Overlays on many options at once** | An unnamed option matching by `uiSlot` and/or `link`, with `*` prefix wildcards, in a second pass. It adds its definitions to **every** matching option, other mods' included. | [source] |
| **One choice turning on several options** | A switcher choice's `names[]` lists several options. Vanilla hairstyles turn on `hair_colorN` and `hair_color_fpp_N`; icxrus's Heterochromia Eyes turns on `eyes_color_left` and `eyes_color_right` from one choice ([merge boundary](../character-customization/ccxl-merge-boundary.md#a-demonstrated-switcher-pattern-and-its-limit)). Each activated option needs its own `uiSlot`, because one slot holds one active option [wiki: switcher theory, image `.gitbook/assets/hairstyle uiSlot(s).png`]. | [resource] + [wiki] |
| **Component toggles** | Not a separate feature. An `.app` definition lists whatever components it wants, inline or through `partsValues`, and `chunkMask` hides pieces within a mesh, as vanilla does. | [resource] |
| **New switchers in existing groups** | Group entries are appended only to existing group names (`face`, `character_customization`, …); a new group name is ignored (`MergeCustomGroups`). | [source] |
| **Dynamic appearances** | For an `.app` in the `player_customization.app` scope, a requested but missing definition is cloned from a template, and the suffix after `__` becomes the mesh appearance of **every** component override in the clone (`FixCustomizationAppearance`, lines 779–883). One colour per look, like vanilla and PRC. | [source] |
| **Existing saves** | A new option that is enabled, not hidden and absent from the loaded state is added to it (appearance and morph options) or activated (switchers) at load (`OnInitAppOption`, `OnInitSwitcherOption`, lines 97–143). A save made before the mod was installed shows the new row at its default choice, which we make Off. | [source] |
| **Row order** | Rows sort by the option's `index`. Two top-level options with the same index show only the first [wiki: CCXL overview `for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/README.md`, warning under "Modded switchers"; switcher theory page]. ArchiveXL renumbers choice indices, never option indices (`RegenerateIndexes`). | [wiki] + [source] |
| **Removal** | ArchiveXL can remove every entry it registered (`RemoveCustomEntries`) on `Reload`. What the game does with a saved choice whose option no longer exists is unread. | [source] + [hypothesis] |

The wiki's creating-a-switcher guide gives "switchable tattoo additions that can be toggled *alongside* the game's vanilla facial tattoos" as the reason to make a new switcher rather than occupy an existing one [wiki: `…/ccxl-creating-a-switcher.md`, "Why would I want to do that?"]. Its group screenshot (`.gitbook/assets/headGroups tree.png`) registers a demonstration switcher in `FPP`, `TPP`, `TPP_photomode` and `character_customization`. **Piercings should instead follow vanilla** and join `face` and `character_customization`. The Eye Artistry photo-mode result depends on the `face` group ([file chain: groups](../../knowledge/cc-file-chain.md#groups-who-consumes-a-choice-resource)) [runtime + resource]. The CCXL overview also keeps a community registry of shared modded switcher names with fixed indices, so far only tattoo slots `neck_tattoo` 3300 … `right_leg_tattoo` 3309, and "strongly encourages" established switchers to avoid clutter [wiki: same README, "Modded switchers" table].

## 3. Could PRC's technique be driven by creator choices?

**The technique, yes; PRC's files, no.** PRC works through two things ([file chain §6](../../knowledge/cc-file-chain.md#6-case-study-why-prc-piercings-work-in-game)):

1. **File replacement.** PRC ships the vanilla path `…\piercings\i0_000__earring_14.app` with 128 inline slot components, and item packs overwrite the same `fpmN.morphtarget` paths. This is the old-school route: it replaces vanilla style 12 (14 for male V) and makes packs collide by slot number. **It violates the additive requirement and we must not copy it** [resource].
2. **Linked meshes.** A piece is a `.morphtarget` whose `baseMesh` is either a vanilla earring mesh (reusing its skin) or a "linked" mesh, for example `eagul\piercingmorphs\wa_linked.mesh`, bound to the full female head skeleton (254 joints) and carrying all 105 face targets ([PRC preview slice](prc-preview-slice.md#linked-mesh-resolution-for-slots-50-and-74)) [resource]. A piece can therefore sit anywhere on the face and follow every slider. **This part is exactly what an owned CCXL look needs**, and none of it depends on file replacement.

Pointing a CCXL option at PRC's own `fpmN` resources would work mechanically [hypothesis]. It would still be wrong for XF Studio on three counts: it creates a per-mod dependency (against the no-per-mod-adapter rule); PRC's pages require the author's permission for reuse or modification; and a slot's content depends on which pack wins that path. eagul was exploring a CCXL migration in May 2026, not a released one ([PRC inventory](prc-inventory.md#what-the-installed-framework-does)). PRC stays a source of **technique and geometry insight** only: how pieces sit, what scale reads well, and that full-head linked meshes follow the sliders in the community's experience.

What CCXL fixes compared with PRC, by construction: per-piece materials (each component in our definition can have its own `meshAppearance`); no slot numbers or collisions (our names are unique); nothing replaced (vanilla style 12 stays available); and a user's complete look is one saved choice with a stable identity.

## 4. Additive audit: what would replace or shadow existing choices

| Mechanism | Effect on existing choices | Verdict for the XF route |
|---|---|---|
| New named option (row) with unique `xfs_` names | None; appended | **Use** |
| Unique option names in existing groups `face`, `character_customization` | None; group lists appended | **Use** |
| Adding our `.app` to the `player_customization.app` scope | Affects only our `.app` | **Use** if a variant or colour row needs dynamic appearances |
| Adding choices to the vanilla `piercings` switcher with **unique** labels | Appended after the vanilla choices and PRC's option 12; nothing replaced. But a V can then wear either a vanilla/PRC style **or** an XF look, not both, because they share one row. | Additive in data; an **alternative** to an own row (decision 1) |
| A switcher choice whose `localizedName` equals an existing one (vanilla uses `01`…`16`) | **Replaces** that choice. A choice labelled `15` would overwrite male V's vanilla style 15. | **Never.** Labels must be unique text keys, never positions |
| An appearance definition whose `name` equals an existing one | **Replaces** it | **Never.** Definition names carry the `xfs_` prefix and a stable look ID |
| New colour definitions on vanilla `piercings_NN` | Appended, but the `piercings color` link assumes every style has the same number of colours; a colour index beyond 16 on one style has no partner on the others [hypothesis on link edge cases] | **Avoid** |
| Anonymous `uiSlot`/`link` overlays (for example `piercings_color*`) | Injects our definitions into **every** matching option, other mods' and PRC's included | **Never** |
| `resource.fix.paths` on the vanilla creator resources | **Replaces** the `.app` a vanilla option uses | **Never** |
| Shipping any vanilla or third-party depot path (PRC's route) | **Replaces** that file for everyone | **Never** |
| `resource.patch` on vanilla `.app`, `.mesh` or `.morphtarget` | **Modifies** vanilla and every mod using it | **Never** |
| A row `index` equal to another top-level option's | **Shadows** the other row: only the first shows [wiki] | **Avoid.** Build picks a free index from the user's merged creator catalogue (the Studio already builds it) and reports the choice |
| Referencing vanilla resources by depot path (for example a vanilla earring `.mi`) | Read-only reference; nothing replaced or redistributed | **Allowed**; useful for materials ([section 5](#materials)) |

The Studio's generator can enforce all of this mechanically. Build checks every name, label and index against the user's effective merged catalogue, which the resolver already computes (`cco-model.ts` implements the same merge), and refuses a collision with a plain message. The resolver would also show a replacement immediately, because it reports which resource provided each choice.

## 5. Proposed design

### Creator rows

**Default proposal: one XF row with complete looks, next to the vanilla Piercings row.**

- One `gameuiAppearanceInfo` option, `xfs_piercings` (female and male resources separately), `uiSlot` `xfs_piercings`, labelled with the XF-branded name. It has `useThumbnails = 0` (a stepper, like XF Eye Artistry), `editTags` `NewGame`/`HairDresser`/`Ripperdoc`, `randomizeCategory` `FaceModification`, and joins `face` and `character_customization`. Definitions are Off plus one per authored **look**.
- A look is a complete set: every piece the user designed (both ears, nose, brow, lip, …) with its own material. This matches vanilla (a style is a set) and XF Eye Artistry (one row, complete presets). It adds exactly one row whatever the collection size.
- `index`: a free value right after the vanilla Piercings block (female 290–305 is followed by free 306–309 before teeth at 310; male 520–537 by free 538–539 before teeth at 540). Build confirms the value is free on the user's installation.
- **Why an own row rather than the vanilla row.** It lets a V wear an XF look *with* a vanilla or PRC style, or with another mod's future CCXL piercings. The AGENTS "Selectors" rule allows an own selector where it is genuinely the best option; layering is the reason here. Contributing to the vanilla row stays possible as an export option (decision 1).

Later options, each a small extension of the same data: a **colour or variant row**, and **per-site rows**. For a colour row, the look becomes a switcher choice that turns on its own appearance option carrying *K* authored variants, as vanilla styles carry 16 colours. For per-site rows (for example "XF Ears" and "XF Face"), independent choices avoid authoring every combination; we could propose shared site switcher names to the wiki's registry so other CCXL piercing mods could join the same rows instead of adding more.

### What Build would emit per look (female; male mirrors it with `pma` resources)

```text
.archive.xl        customizations: female/male → xfs_…_piercings_pwa/.pma .inkcharcustomization
                   (scope: player_customization.app → our .app, only if a variant row uses dynamic appearances)
.inkcharcustomization
                   xfs_piercings: Off + one definition per look, groups face + character_customization
xfs_…_piercings.app
                   one appearance per look (xfs_ names, stable look IDs), plus an Off appearance that draws nothing
                   components: one entMorphTargetSkinnedMeshComponent per piece (or per piece family),
                   each with its own meshAppearance (per-piece material)
piece .morphtarget + .mesh
                   deduplicated by content: a piece reused in several looks is compiled once
                   mesh: the piece geometry, skinned to head joints near its anchor
                   morph target: the head's (target, region) pairs for the regions at its anchor, or all 105
materials          .mi per finish (see below)
```

Stable identities follow the Eye Artistry rules: look IDs never reuse or renumber. A look deleted from a later collection keeps a **tombstone** definition that draws nothing, so saves that reference it resolve to "no piercings" rather than to a missing name. That this avoids a problem is a [hypothesis] until the removal test runs.

### How the construction set feeds it

The [construction-set model](construction-set-design.md#proposed-composition-model) already separates `placements` (semantic sites), `parts` and `materials`. Compilation adds one step, an **attachment solver**, shared by preview and Build so both use the same derived data:

1. **Site → anchor.** A semantic site (`ear.left.lobe1`, `nostril.right`, `septum`, `brow.left`, `labret`, …) resolves to a point and oriented frame on the **installed** head, with the same "which head" handling as the eye plate (the installed winner by default, a plain message and a base-game fallback if a head mod changes the data). The vanilla bank pieces give reference positions for calibration, used as data rather than geometry.
2. **Skin.** The anchor's interpolated head skin weights are copied to every vertex of a rigid piece, so the piece moves as one body with the skin under it. Joint names come from the head rig, as vanilla meshes and PRC's linked mesh do. Dangling parts (chains, drops) come later: hair and NPC earrings already use dangle animation graphs inside `.app` definitions (for example the expressions cache's `i1_001_wa_earring__maman_brigitte_dangle.animgraph`), which gives a precedent for physics [resource; not studied further here].
3. **Morph deltas.** For each `(target, region)`, the piece moves by the anchor's displacement, and larger pieces also rotate with the local surface frame. Vanilla carries only the needed regions (ear pieces: `ear`); carrying all 105 like the mixed bank is the safe default, and the cost is small. The morphtarget guide says mods cannot invent new activation names, only reuse them [wiki: `for-mod-creators-theory/3d-modelling/morphtargets.md`]; this design only reuses them.
4. **Geometry.** Parts generate meshes in millimetres as the construction set already specifies. Build converts them to game units, with LODs where needed.

### Materials

The cheapest faithful first route is to **reference the vanilla piercing materials by depot path**, for example `base\characters\common\character_customisation_items\earrings\i1_000_base_01__silver.mi` (all 16 finishes). Nothing is redistributed or replaced. They use one shared `.mlmask` on vanilla UVs. For plain metals the look comes from the base layer (the silver setup's other layers have opacity 0 and 0.07, per the [PRC catalogue audit](prc-catalog-audit.md#stud-second-chunk-material-resolution-24-september)), so our own UVs should not matter [hypothesis]. Patterned finishes (rainbow, mixed, wood) would need UVs matched to the mask, or our own `.mlsetup` and mask generated from game `.mltemplate`s. Our own multilayered setups are the route to the construction set's full material list (gems, enamel) and a later step.

### Preview in the Studio

- **Installed looks** need nothing new. The resolver already reads CCXL options and renders piercings through the layered (`multilayered.mt`) adapter; an exported XF look appears as an ordinary creator choice in the Character panel, beside vanilla and PRC ([file chain §8](../../knowledge/cc-file-chain.md#retiring-the-prc-specific-code)).
- **Looks being authored** render the kit's meshes directly on the preview head, with skin and morph deltas from the same attachment solver, so they follow the shown V's sliders and the creator idle.
- **Verification** resolves the built package through the resolver and compares it with the authored look (component list, masks, materials, morph coverage), in the same way FeatureVerifier checks eye makeup. Preview and verified output are never presented as game-tested.

### Pipeline fit

The platform's step-8 product planner (one XF mod by default, splittable; `FeatureExporter`/`FeatureVerifier`) already combines features. Piercings would be a second `FeatureExporter` contributing its `.xl` fragment, creator resources, `.app`, meshes and materials, so an Eye Artistry look and a piercing look ship in one XF mod by default [source: `package-resources.ts`, `eyeMakeupXl`]. The [Studio-to-mod pipeline](../authoring/studio-to-mod-pipeline.md) contract would be updated when this is built, not now.

## 6. In-game test plan

**Built** as [experiment 024](../../experiments/024-ccxl-piercings/README.md), adjusted to the 26 September decisions: rows per area (**XF Ears**, **XF Nose**, indices 306 and 307) instead of Row A, no Row B (nothing touches the vanilla row; check 3 became the per-area mix check), a septum ring instead of the brow bar, and the stud on the right nostril. Its [test card](../../experiments/024-ccxl-piercings/README.md#test-card-the-12-checks) carries the bridge commands. Offline, the probe's merge into the installed creator (1,236 head options) leaves every existing option and group unchanged. The plan as first written:

One prepared session with a **scripted fixture** (no editor, no third-party assets): three owned primitive pieces generated by a small script, namely a 1.2 mm-wire hoop on one ear lobe, a 2.5 mm nostril stud and a small brow bar, packaged as a throwaway test mod. The fixture holds:

- **Row A:** an own row `xfs_piercings_probe` with Off, Look 1 (all three pieces, one material), Look 2 (hoop gold + stud silver: per-piece materials) and Look 3 (hoop only, carrying `ear` targets only, against Look 1's all-105 hoop).
- **Row B probe:** one appended choice in the vanilla `piercings` switcher, with a unique label, turning on a hidden appearance option with the stud.
- Female only, unless the maintainer wants male V in the same session (it would double the build, not the session).

Record the game, ArchiveXL, TweakXL and Codeware versions, and whether Phantom Liberty and PRC are enabled. Where the [runtime bridge](../../knowledge/runtime-access.md) can drive the camera and captures, it does; the creator clicks stay manual.

| # | Check | Expected | Settles |
|---|---|---|---|
| 1 | New game creator: find the XF probe row and the vanilla Piercings row | XF row directly after Piercings; vanilla row still lists Off + 14 styles with PRC's option 12 intact, plus the Row B choice at the end | Registration, index placement, nothing replaced |
| 2 | Vanilla Piercings 03 + XF Look 1 together | Both visible at once | Layering (own-row case) |
| 3 | Row B choice, then vanilla 03 | Mutually exclusive in one row | Vanilla-row case behaves as the source says |
| 4 | Look 1; step the **ear**, **nose** and **mouth** sliders through several values; screenshot close-ups | Pieces stay seated on the lobe, nostril and brow | Morph following of generated pieces |
| 5 | Look 3 against Look 1 with the jaw and mouth sliders | Is an `ear`-only hoop as good as an all-105 one? | Which regions a piece needs |
| 6 | Creator idle and a photo-mode expression, profile and close views | Pieces move with the face, no gap or penetration | Skinning of generated pieces |
| 7 | Look 2 | Gold hoop and silver stud together | Per-piece materials |
| 8 | Gameplay third person (mirror or photo mode) and photo mode | Same look as the creator | `face` group consumer |
| 9 | Save, reload, mirror | Look persists; the mirror shows it selected; Off clears everything | Persistence and clearing |
| 10 | Wear a full helmet and a face mask | Do our pieces hide when vanilla piercings hide? | Headgear interaction (unknown) |
| 11 | Throwaway save with Look 1; disable the fixture; load; open the mirror; re-enable and load the original save | Record what the face shows and whether the load warns | Missing-mod behaviour (shared with [file chain ask 5](../../knowledge/cc-file-chain.md#in-game-test-asks)) |
| 12 | With PRC enabled: Piercings 12 + XF Look 1 | Both show; PRC's bank unchanged | Coexistence with a replacement framework |

Checks 4–7 decide the attachment solver's defaults; check 11 decides whether tombstones are needed; check 10 may add a visual-tag task. Checks 1–3 and 12 prove the additive requirement in game.

## 7. Constraints

| Constraint | Finding | Grade |
|---|---|---|
| **Body gender** | Separate female and male creator resources, heads and meshes; male has 20 targets per region instead of 21 and 16 vanilla styles instead of 14. A look compiles once per body gender. The Studio's head preview is female-only today, so female first is the natural order. | [resource] |
| **Face morph compatibility** | Pieces follow sliders only through the `(target, region)` pairs they carry; generated deltas must come from the head the user actually runs. Head or rig mods that change morphs or joints (for example a facial-rig fix) need the eye plate's gate: build from the installed winner, or refuse with a plain explanation. Vanilla V always uses face rig 000 ([file chain: facial rigs](../../knowledge/cc-file-chain.md#morph-targets-resource-wiki)). | [resource] + [wiki] |
| **Several piercings at once** | Within one row, one look at a time, but a look holds any number of pieces (as vanilla styles do). Across rows, an own XF row layers with vanilla, PRC and other mods' rows. Mixing independent parts in game needs several rows or a switcher choice that turns on several options, each in its own `uiSlot`. | [resource] + [source] |
| **Colours and materials** | The creator's colour row is a per-style list of definitions tied by a link key. Our default bakes materials into each look (no colour row). A variant row is possible later with authored variants per look; ArchiveXL's dynamic appearance gives one mesh appearance for every piece, so per-piece colours need mesh appearance names that map per piece, as vanilla mesh appearances do per chunk. | [source] + [resource] |
| **Save compatibility, installing** | New enabled options join an existing save's state at their default (Off). | [source] |
| **Save compatibility, removing** | The save stores `(FNV-1a64 of our .app path, definition)` in `face` and `character_customization`. What the game does when it no longer resolves is unknown. Stable IDs and tombstones limit the damage within a collection's lifetime; check 11 measures the removal case. | [resource] + [hypothesis] |
| **Users' existing piercing mods** | PRC (vanilla option 12 replaced) is untouched and can be worn with an XF look. The 31 jewellery and piercing mods on the reference installation declare no `customizations`: they are items or PRC packs, so none competes for a creator row. Item earrings can visually overlap an XF look on the same lobe, and the Studio preview cannot show inventory items. | [resource] |
| **Creator clutter** | The wiki asks for established switchers. One XF row adds one row; per-site rows would add several and are better proposed as shared names. | [wiki] |
| **Framework version** | Designed against ArchiveXL 1.27.3; the Studio's framework check already tells users what to update. | [source] |

## 8. Decisions for the maintainer

1. **Own row or vanilla row.** An own "XF" row next to Piercings (layers with vanilla, PRC and other mods; the proposed default), contributing looks to the vanilla Piercings row (fewer rows, but a V then wears one or the other), or both as an export option?
2. **One row of complete looks, or per-site rows.** Complete looks match Eye Artistry and add one row; per-site rows (for example ears / face) allow mix-and-match without authoring every combination. Start with complete looks?
3. **Colour row.** Bake materials into each look (proposed first), or offer a creator colour/variant row per look from the start?
4. **Mod name.** Eye makeup exports as XF Eye Artistry; what should the piercing feature be called in game and in mod managers (for example "XF Piercings")? One combined XF mod stays the default.
5. **First scope.** The earlier construction-set questions still apply ([decisions](construction-set-design.md#decisions-for-the-maintainer-before-jewellery-authoring-starts)): studs, hoops and septum rings first, with dangles and chains (physics) later?
6. **Body genders.** Female first, male in a later slice (the preview head is female-only)?
7. **Probe session.** Approve building the scripted fixture above for a batched session, ideally alongside the next planned in-game session?


## Decisions (26 September 2026)

- **Own XF rows**, after the vanilla Piercings row, so XF pieces can be worn together with vanilla, PRC or other mods' piercings.
- **Rows per area** (for example ears, nose, lips, brow), so areas mix and match in the creator; revisit if it feels poor in game. Makeup, brows and cheeks stay separate features with their own rows.
- **Materials fixed per piece** in the first version; a creator colour row can follow.
- **First scope:** studs, hoops and septum rings; dangles and chains (physics) later.
- **Defaults** (changeable): the split mod is "XF Piercings" (merged into "XF Looks" by default); female V first, male next; the scripted test mod is built for a coming session ([experiment 024](../../experiments/024-ccxl-piercings/README.md), built 26 September).

## 9. Open questions (research)

1. Does the game hide creator piercings under helmets and masks through visual tags on the components, the group, or something else? Check 10 observes it; the mechanism is unread.
2. How does the game treat a saved `(app, definition)` that no longer resolves: dropped, defaulted or kept? (Check 11; [file chain open question 3](../../knowledge/cc-file-chain.md#open-questions).)
3. Does the morph manager skip a component that lacks a pair, or does a piece need every region? (Check 5.)
4. Which UVs make the vanilla shared `.mlmask` safe for patterned finishes on new geometry?
5. Would a dangle graph in a creator `.app` give earrings physics in the creator and in gameplay alike?
6. Is a shared community name for piercing site rows worth proposing to the wiki registry?

## Provenance

Local extractions (ignored, not committed): the Phantom Liberty creator resources in `research/consumers/cc-file-chain/json/`; the 16 piercing `.app`, 4 `.morphtarget` and 4 `.mesh` serializations and the 4 exported GLBs in `research/consumers/vanilla-piercings/`; the vanilla earring `.mi` in `research/consumers/vanilla-piercing-materials/`. Their extraction and hashes are in the [vanilla piercing preview](vanilla-piercing-preview.md) and its [intake evidence](../../projects/xf-studio/authoring/evidence/vanilla-piercing-intake.json). Per-chunk centroids and bone lists were computed from those files with throwaway scripts, not kept. The installed-mod check read each jewellery folder's `.xl` files under the reference MO2 `mods/` directory; nothing was modified.

ArchiveXL 1.27.3 by psiberx and contributors, commit `5474e34d56112f5d8843ae863e1e72ff510957c0`: `src/App/Extensions/Customization/Extension.cpp` and `bundle/source/resources/PlayerCustomization*.xl`.

Modding Docs at `be2f44eed8419342ec13f72ed9cab008e9f7b289`: the [CCXL overview](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/README.md) (published by manavortex and redacted-c01, last edited by icxrus; vanilla switcher table and modded-switcher registry), the [switcher theory](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-theory-switchers.md) (icxrus; images `.gitbook/assets/switcherInfo options.png` and `hairstyle uiSlot(s).png` inspected), the [creating-a-switcher guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-creating-a-switcher.md) (last edited by icxrus, original author unresolved; image `.gitbook/assets/headGroups tree.png` inspected), the [character-creator cheat sheet](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md) (piercing chunk table credited to xbae's NPV part picker) and the [morphtarget guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/3d-modelling/morphtargets.md). Editor screenshots are documentation examples, not runtime proof.

eagul's PRC framework is cited for technique only, as recorded in the [PRC inventory](prc-inventory.md); no PRC asset is used or proposed for use. The learning record is in [community credits](../../docs/community-credits.md).
