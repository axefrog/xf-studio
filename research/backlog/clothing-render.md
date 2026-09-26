# Worn clothing in the Studio

**Status (27 September 2026): phases 1–4 built and merged into `main`** (the save's loadout, the item resolver, hiding and body context, drawing and the Clothing control); phases 5–8 open. Step 5 of the [standing direction](README.md#standing-direction-set-25-september-2026): show V's full in-game appearance, including the clothes the save says she wears, over the body `body-render` draws. How the built part works, and what it doesn't do yet, is [knowledge/clothing.md §6](../../knowledge/clothing.md#6-how-the-studio-draws-worn-clothing); the mechanics, with evidence grades, are the rest of that page; this page holds the design, the phases and the questions for the maintainer. Nothing is compared with the game yet: the in-game checks below are the next step.

Effort is rough agent effort: **S** under half a day, **M** one to two days, **L** longer or research-heavy.

## Goal

Load a save (or connect to the running game) and see V dressed as in game, in the same viewport as the head and body, with a control to take the clothes off while editing. Everything resolves through the generic resolver: vanilla and mod items follow the same rules the game and its core frameworks apply, with no per-mod intake ([AGENTS: interpret game files the way the game does](../../AGENTS.md#architecture-contract)).

## What existed before phase 1

This list records the starting point; phases 1–4 have since added the loadout reader and the item resolver ([worn clothing §6](../../knowledge/clothing.md#6-how-the-studio-draws-worn-clothing)).

- The save reader decoded only the creator appearance node ([save import](../eye-artistry/save-import.md)).
- The resolver already handles `.app` definitions, part entities, `partsOverrides` and chunk masks, ArchiveXL scopes, patches, links and dynamic material paths ([CC file chain §8](../../knowledge/cc-file-chain.md#8-generic-resolver-specification), [mod loading](../../knowledge/mod-loading.md)).
- The TweakDB reader addressed a record's fields from its ID alone, for six value types (`tweakdb-flats.ts`).
- The native reader decodes object packages, the format of the save's script-system node, but only for classes in the RTTI dump ([archive format §5.3](../../knowledge/archive-format.md)).
- The layered adapter draws `multilayered.mt` materials, which most garments use ([clothing §5](../../knowledge/clothing.md#5-clothing-materials)).
- The runtime bridge can run read-only commands in the game ([runtime access](../../knowledge/runtime-access.md)).

## Design

### Where the worn items come from

| Source | What it gives | Notes |
|---|---|---|
| **The save** (default) | The vanilla loadout: the equipped item per clothing area, the wardrobe's visual item and `isHidden` per area, and the underwear rules ([clothing §2](../../knowledge/clothing.md#2-what-the-save-records)) | A generic reader for the `ScriptableSystemsContainer` package that extracts `EquipmentSystemPlayerData`. It reads vanilla data with vanilla semantics only |
| **The running game** (exact) | A read-only bridge command listing what each attachment slot shows: the item record and the appearance name the item factory resolved | The only generic way to match what script mods such as EquipmentEx, or quest overrides, decide at runtime. It also covers slot records mods create in script |
| **The Studio's wardrobe** | Items the user picks per area from the installed catalogue | Lets a user dress any V, and check makeup against any outfit |

The save and the game can disagree whenever a script mod controls the look. The Studio should not decode a particular mod's script state to close that gap (that is a per-mod adapter). Instead it says, in plain words, that the clothes come from the save and that connecting the game shows exactly what V is wearing, with a button. Whether reading EquipmentEx's saved outfit is acceptable anyway is a question for the maintainer (below).

### Resolver additions (all data-driven)

1. **Item records.** Add Int32 and CName-array value types to `tweakdb-flats.ts` (`garmentOffset`, `visualTags`), and read `entityName`, `appearanceName`, `appearanceSuffixes`, `placementSlots`, `equipArea`, `itemType` and `displayName` for an item ID from the save. Mod items need a **TweakXL YAML reader** (`$base`, `$instances`, `$type`, flat overrides) that follows TweakXL's own rules. The creator catalogue needs the same reader for mod-added icons (R11), so it is shared work.
2. **Factories.** Decode `C2dArray` rows in the native reader (they follow the properties) and read the vanilla factory plus factories that `.xl` files add.
3. **Root appearance selection.** Build the suffix selector from the suffix-order record and its values (body gender; camera fixed to TPP; `Partial` from the torso item's `hide_T1part`; `HairType` from the creator hair; ArchiveXL's body, arms, feet and legs states), then pick the most specific matching root appearance. Handle `EmptyAppearance:*`.
4. **ArchiveXL dynamic appearances.** For `!` names on `DynamicAppearance` entities: definition weighting, conditional components and `*` component-path substitution with `?` and the `base_body`/`flat` fallback. This reuses `expandDynamicPath`.
5. **Visual tags and hiding.** Union each worn item's tags from its root entity schema and resolved definition. Apply the vanilla slot table (`hide_T2` … `hide_Genitals`, the Outfit area, underwear rules), then the tag-to-chunk rules from ArchiveXL's `VisualTags.xl` and every installed `.xl` (`overrides: tags:`, parsed in `archivexl-config.ts`), then item `partsOverrides` without a part resource, all onto body and head components by name and prefix. Keep the cooked visual-tag preset as an open question ([clothing Q2](../../knowledge/clothing.md#open-questions)).
6. **Body context.** Derive `{body}` from the resolved player entity (a `Body:<Name>` component or tag after patches), `{feet}` from the feet item's tags, `{arms}` from arm cyberware and `{sleeves}` from `hide_T1part`.
7. **Layer order.** Score each garment component by prefix and tag modifier, or by `garmentOffset` when an offset source is known ([clothing §4.5](../../knowledge/clothing.md#45-garment-support-layer-order-and-morphs)).

The output is the same `ResolvedComponent` shape the renderer already consumes, with an item and area label and a layer score, so garments enter the existing render record rather than a second path.

### Rendering

- Draw garment components over the body with the layered adapter; add templates as garments need them (decal, emissive, glass, hair for hat hair). For large garments, consider evaluating the layered stack per pixel instead of baking once the bake cap shows in close-ups.
- Mask body and head chunks from step 5. The body mesh has eight chunks that the tag rules address one by one, so masking is per-chunk visibility, not new geometry.
- **Garment support** comes last. First draw without it and accept some clipping. Then apply each covered layer's GarmentSupport morph (from the mesh's `garmentMeshParamGarment` morph offsets, weighted by the painted weight) where a higher layer covers it. Last, a per-vertex coverage test on the GPU and hidden-triangle removal. The engine's own algorithm is not in any source we have, so each step is judged against in-game captures.

### The undress/dress control

A character-context setting, **Clothing**, with its own Undo:

- **As saved** (or as the game shows it when connected).
- **Without headwear and face items**, the default while the eye-makeup editor is open, because helmets, glasses and masks cover the eyes. The default is per workspace and can be changed; the label says what is hidden.
- **Underwear only**: the save's underwear items, or the vanilla underwear when the save has none.
- **Custom**: the user's own picks per area, from the wardrobe.

It is a presentation choice over the resolved character, so it never edits the save or the recipe.

### Coordination with `body-render`

That track (`D:/Dev/worktrees/body-render`) is building V's body now. This work needs the following from it, and none of it should need a special case there:

1. Body components (`t0_`, `a0_`, `l0_`, `n0_`, seam fixes, nipples, genitals) in the render record under their resource names, so tag rules can match names and prefixes.
2. Chunk masks kept as data on each component and applied at draw time, so tags and `partsOverrides` can hide chunks without re-exporting meshes.
3. The feet variants (`l0_000_pwa_base__cs_flat` and the heel meshes) resolved from a feet state the resolver can set.
4. Room for a per-vertex offset on body meshes later, for garment support (the female body mesh carries GarmentSupport data).

How the body track met them (26 September; [body rendering §5](../../knowledge/body-rendering.md#5-what-clothing-uses-from-the-body-the-four-requirements)): component names and depot paths are in the record; the resolver applies each chunk mask and the served geometry is a chunk copy of the cached export, so a changed mask re-plans without exporting again (drawing every chunk and masking at draw time would need the masked chunks' materials resolved too); `BodyState.feet` picks the feet group; the garment-support attributes and shape key are in the exports and kept by the loader. The body's underwear cover already follows the body's shape through a carried-over shape key, a first stand-in for garment support. Nudity follows point 3 of the decisions below: the body is drawn with the game's own underwear cover over it.

### Export

Viewing clothes exports nothing. Two export consequences follow from the research:

- **XF Eye Artistry under helmets and masks.** The export's makeup component is named `xfs_c<key>_makeup` (prefix `xfs_`), so ArchiveXL's `hide_Head` rule, which hides `hx_` and the other head prefixes, doesn't reach it. If a full-head item hides V's head in game, the makeup might stay visible. Check in game before renaming anything ([clothing Q5](../../knowledge/clothing.md#open-questions)); a rename would change resource identity and needs the [pipeline contract](../authoring/studio-to-mod-pipeline.md) updated in the same change.
- **Later clothing features** (recolours, outfit presets, new garments) would export XF-branded item mods: TweakXL records, one root entity with `DynamicAppearance`, `{gender}`/`{body}` substitution and new colourways as mesh appearances. They are later features that need the maintainer's go-ahead first.

## Phases

| Phase | Work | Effort | Depends on |
|---|---|---|---|
| 1 | **Save loadout reader**: read the `ScriptableSystemsContainer` package (the save variant's u32 CRUID count; objects of classes the RTTI doesn't know read from the package's own field tables, or skipped); extract the loadout, wardrobe visuals and hide flags; add a CLI output and a fixture from the reference save's decoded values | M | **Built** (`save-package.ts`, `save-loadout.ts`; synthetic fixtures; the private check save's values checked by a test that runs where the save is) |
| 2 | **Item resolver**: TweakDB value types, the `C2dArray` factory, suffix selection and `.app`/part resolution to `ResolvedComponent`s; checked against the recorded vanilla chains (tank top, shirt partial and FPP variants) and WolvenKit output | M–L | **Built** (`clothing-resolver.ts`, `clothing-host.ts`; the cooked visual-tag preset read natively) |
| 3 | **Hiding and body context**: tags, the vanilla slot table, `.xl` tag rules, `partsOverrides` onto the body, `{body}`/`{feet}`/`{arms}`/`{sleeves}` | M | **Built**, except `{body}`/`{arms}`/`{sleeves}` substitution, which only dynamic items use (phase 5); the feet group follows footwear; the `BodyType` suffix reads ArchiveXL's body type from the player entity and its patches (`playerBodyType`), and each item evaluates only its record's own suffixes |
| 4 | **Render and the Clothing control**: garments with the layered adapter, body chunk masks, the four Clothing states, action catalogue and boundary tests | M | **Built** (record v9, request v5, `character.setClothing` and friends; "Custom" is **Choose areas** over the save's own items until the wardrobe, phase 8) |
| 5 | **ArchiveXL dynamic appearances and TweakXL YAML**: mod items, including the CC icon gap | M–L | Phase 2 |
| 6 | **Bridge worn-item snapshot**: a read-only command listing each attachment slot's item record and resolved appearance; the "connect the game" button | S–M | The bridge's command catalogue |
| 7 | **Garment support approximation**: decode `garmentMeshParamGarment` (native mesh reader phase 4, or WolvenKit's GarmentSupport shape key), apply morphs by layer, then a coverage test | L, research | Phase 4, in-game captures |
| 8 | **Studio wardrobe**: a clothing catalogue from TweakDB and YAML records with names and icons, picks per area, portable outfit presets | M | Phases 2 and 5 |

Phases 5 and 6 can run beside 3 and 4. Parity is measured against in-game captures, never assumed from offline resolution.

## In-game checks

One prepared session once phases 1–4 exist, with a checklist, fixed camera presets and the exact save and profile:

1. A reference outfit per layer (inner shirt, jacket, trousers tucked into boots, a hat), third person and photo mode, compared with the Studio's render of the same save.
2. A vanilla wardrobe set with one area left empty (the hide path), and the partial-sleeve look (`hide_T1part`).
3. With EquipmentEx: an active outfit, and the bridge snapshot compared with the save's prediction.
4. A full-head item tagged `hide_Head`, and a vanilla helmet, over XF Eye Artistry makeup.
5. One refit on a body mod, to check `{body}` resolution and body masking.
6. Close-ups of garment edges (collar, waistband, boot tops) for the garment-support phase.

## Provisional decisions (26 September 2026, coordinator; for the maintainer's review)

Taken as executive decisions while the maintainer was away; each is the proposal below and can be revised.

1. **EquipmentEx:** its saved outfits are not read from the save; outfits other mods apply are shown through the runtime bridge's "connect the game" snapshot.
2. **Default dressing:** as saved, minus headwear and face items while the eye-makeup editor is open.
3. **Nudity (decided 27 September 2026):** the player decides, as in the game. The Studio offers the game's own uncensored mode as one plain, opt-in setting ("Show my V uncensored, as the game can"): with it on, body options draw exactly as the game draws them with nudity allowed (the uncensored skin, nipples, genitals and breast shape as chosen, no cover); with it off (the default), the censorship cover stays and keeps failing closed. It never shows more than the game itself can. Public material (the site, README images, committed evidence) stays censored.
4. **Priority:** after `body-render` merges, phases 1–4 as one track, with 5 and 6 in parallel.

## Questions for the maintainer

1. **EquipmentEx.** Reading its saved outfit (`EquipmentEx.OutfitState` in the save) would show outfits offline, but it means interpreting one mod's script data, which the resolver rule forbids for intake. Proposed default: don't read it; show the save's vanilla loadout plus the "connect the game" option. Is that right, or is EquipmentEx core enough to treat like a framework?
2. **Default dressing.** Proposed: as saved, except headwear and face items while the eye-makeup editor is open. OK?
3. **Nudity.** The body track will draw an unclothed body. Proposed: the Studio never shows more than the game's own uncensored mode would; "Underwear only" is the lowest clothing state offered, and anything further is a separate, explicit setting. Is that the policy you want for a public app?
4. **Priority.** Where should this sit against tracks 1–3? Proposed: after `body-render` merges, phases 1–4 as one track, with 5 and 6 in parallel.

## Related

[Knowledge: worn clothing](../../knowledge/clothing.md) · [CC file chain](../../knowledge/cc-file-chain.md) · [Head CC rendering](../../knowledge/head-cc-rendering.md) · [Native archive reader](native-archive-reader.md) · [Runtime access baseline](runtime-access-baseline.md) · [CC controls and presets](cc-controls-and-presets.md)
