# Authored hair colours as character-creator choices: feasibility

Research snapshot, 27 September 2026. Hair design is later feature 4 in the [backlog](../backlog/README.md#later-features--discuss-with-the-maintainer-before-building-each): this is a design and feasibility study to discuss, not a build. Nothing here has been seen in game. **Status: study ready, needs discussion.**

**Question.** How could XF Studio let a player author their own hair colours and export them as **additive** character-creator choices, previewed exactly as the game bakes them?

Evidence grades follow the [knowledge rules](../../knowledge/README.md#rules-for-knowledge-pages): **[source]** framework, tool or engine source, or the 2.31 executable; **[resource]** extracted game or mod resources; **[offline]** measured or computed from them; **[wiki]** Modding Docs text or image; **[runtime]** seen in game; **[hypothesis]** not established.

## Verdict

**Feasible, and cheaper than the piercing route.** Every hair-colour pack on the reference installation is the same small data pattern, and it needs no per-hairstyle work:

- **One colour reaches every hairstyle.** A pack's creator resource holds only *anonymous* options that match the creator's colour rows by `uiSlot` (`hair_color`, `eyebrows_color`, `eyelash_color`, and `beard_color` for masculine V). ArchiveXL merges every named option from every mod first, then every anonymous overlay, so the colours land in every hairstyle's colour row, vanilla, cyberware variant and CCXL alike, whatever the load order [source].
- **One template per hair family.** The colour's material is built at load time. A patch mesh adds an empty appearance named after the colour to every hair, brow, lash, beard and hat-hair mesh, and ArchiveXL instantiates the hairstyle's own base material with `HairProfile = <pack>\{material}.hp` ([mod loading §5](../../knowledge/mod-loading.md#5-archivexl-dynamic-materials-mesh-side)) [source + resource]. A colour costs one `.hp` (about 1 KB), one 32 × 4 cap gradient (about 2.3 KB) and one icon. The largest pack, 45 colours, is a 299 KB archive [resource].
- **The Studio can own the whole chain.** The `.hp` bake is decoded from the executable ([hair reference §7](../materials/shader-hair.md#7-hp-profiles-and-their-resolution)). The Studio already resolves these dynamic materials for installed packs ([resolver validation](../character-customization/resolver-validation.md)). An XF export is the same six resource kinds that hand-made packs ship, generated with names that cannot collide and with the hand-assembly slips found below ruled out by construction.

What only a game session can settle: the swatch and label with no TweakXL icon, what a save shows when an XF colour is gone, colour count, and the side effects of the slot overlays on the "bald" and "brows off" rows. They are batched into [one checklist](#6-in-game-checklist).

## 1. What was studied

| Pack (as installed) | Kind | Colours | Resource namespace | Container SHA-256 |
|---|---|---:|---|---|
| Hair Color Profiles CCXL ([Nexus 19115](https://www.nexusmods.com/cyberpunk2077/mods/19115)), co-credited to psiberx and redacted-c01, `f1.02` | CCXL additions | 45 | `redacted-c01\id_hair_profiles_ccxl` | `06e1e36564e914c5…` |
| MCH Focused Hair Colors Pt 1 ([30027](https://www.nexusmods.com/cyberpunk2077/mods/30027)), 1.0.0.0 | CCXL additions | 21 | `cypherdusk\sigh4_mch_ccxl` | `8cd867a1f494bdd8…` |
| Washed Out ([29943](https://www.nexusmods.com/cyberpunk2077/mods/29943)), 1.0.0.0 | CCXL additions | 35 | `ratstick\washed_out_ccxl` | `67449fb8c02df3aa…` |
| Illegally Blonde ([23002](https://www.nexusmods.com/cyberpunk2077/mods/23002)), 1.0.0.0 | CCXL additions | 20 | `ratstick\illegallyblonde_ccxl` | `f6d82d775a5afc65…` |
| Like totally — Pink ([22664](https://www.nexusmods.com/cyberpunk2077/mods/22664)), 1.0.0.0 | CCXL additions | 8 | `ratstick\like_totes_ccxl` | `f779df67a8eb6e5c…` |
| XF Dipped Tips CCXL, an older first-party local package | CCXL additions | 21 | `axefrog\xf_dipped_tips_ccxl` | `a0c3e928fa18104c…` |
| Alliekat's [Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787), 1.0.0.0 | Same-path **replacer** of vanilla profiles | 36 `.hp`, 34 cap gradients | `base\characters\common\hair\textures\…` | `eb16849ae89094d9…` |

Method: each archive (all under 1.2 MB) was unbundled and serialized with WolvenKit CLI 9.0.1 into a private scratch folder, and its cap gradients exported to PNG in one guarded launch (peak 1.2 GB). The `.xl` and TweakXL files were read in place. Comparison inputs were the 73 vanilla profiles already extracted for the [yellow-hair investigation](../character-customization/yellow-hair-profile-override.md), the Phantom Liberty creator resources, ArchiveXL 1.27.3 source (`5474e34d`) and its bundled `PlayerCustomizationHair*.xl`, 46 hair meshes in the Studio's resolver cache, one CCXL hairstyle (the reference save's MELUMINARY `lm097_hair`) and one more (Bluebell, [Nexus 23941](https://www.nexusmods.com/cyberpunk2077/mods/23941)). The wiki's [CCXL: Hair Profiles (Colors)](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-hair-profiles-colors.md) guide (nutboy, 2025, at `be2f44ee`) was read with its screenshots. Nothing extracted is committed.

**Every CCXL pack follows one template**, the one the wiki guide walks through (its template project is [Nexus 21545](https://www.nexusmods.com/cyberpunk2077/mods/21545)). All six ship the same file set, register the same nine patch targets and use the same ten material templates [resource] [wiki].

## 2. The file chain of an additive colour

### 2.1 Resources a pack ships

```text
<pack>.xl
  customizations: female → <pwa>.inkcharcustomization, male → <pma>.inkcharcustomization
  resource.patch: <pack>\meshes\patch.mesh → player_{wa,ma}_hair.mesh, player_{wa,ma}_hat_hair.mesh,
                  player_{wa,ma}_brows.mesh, player_{wa,ma}_lashes.mesh, player_ma_beard.mesh
  localization (optional)
<pwa>.inkcharcustomization   anonymous appearance options, one per colour row (below)
<pma>.inkcharcustomization   the same, plus beard_color
patch.mesh                   one empty appearance per colour (no chunk materials, no geometry)
                             + template material entries @long @short @curls @dread @braid @cap @cap01 @beard @brows @lashes
materials\<pack>__<family>.mi
                             baseMaterial = *{<family>_base_material}
                             HairProfile  = *<pack>\hair_profiles\{material}.hp        (strand families, lashes, beard)
                             GradientMap  = *<pack>\cap_gradients\…{material}.xbm      (cap, brows)
hair_profiles\<colour>.hp    CHairProfile: ID stops, root-to-tip stops, sampleCount
cap_gradients\<colour>.xbm   32 × 4, BC7 (TCM_QualityColor), isGamma 1, 6 mips
ui\*.inkatlas + icon .xbm    one part per colour
r6\tweaks\…\<pack>.yaml      TweakXL: OptionsIcons.<…>$(colour) UIIcon records → inkatlas part
```

All [resource], across the six packs.

### 2.2 How a choice becomes a coloured strand

| Step | What happens | Grade |
|---|---|---|
| 1. Creator rows | An anonymous option (no `name`) with `uiSlot: hair_color` and the colour list is merged, in ArchiveXL's second pass, into **every** option with that exact slot: 73 feminine and 78 masculine hairstyle colour options (vanilla, `_cyberware_NN` twins, CCXL styles). The same happens for `eyebrows_color`, `eyelash_color` and `beard_color`. Choices are appended, so a new name adds and an existing name replaces. | [source] ArchiveXL `MergeCustomEntries` / `MergeCustomOptions`; [resource] slot counts from the EP1 creator resources |
| 2. Order and links | Named options from all mods merge before any overlay, so an overlay reaches hairstyles registered by mods loaded after it. Each overlay appends the same list to every matching option, which keeps the `hairstyle color` link index aligned across styles that start from the same 35 vanilla colours. The CCXL styles inspected (MELUMINARY `lm097_hair`, Bluebell) list the 35 in vanilla order. | [source]; [resource] two styles |
| 3. Hair-colour tags | For `hair_color` targets, ArchiveXL adds each choice's `tags` to TweakDB `ItemFactory.HairColors.hairColors`. The tag is what `CharacterCustomizationHelper::GetHairColor` returns, and garment dynamic appearances substitute it as `{hair_color}`. The wiki's troubleshooting ("My hair colors don't work on hat hairs!") ties a missing tag to hair under hats. | [source] `Garment/Dynamic.cpp`; [wiki] |
| 4. Requested appearance | The save or UI asks the hairstyle's `.app` for the definition name, which exists in no `.app`. In the `player_customization.app` scope, ArchiveXL clones a template appearance. A name shaped `NN_rest` (two digits and an underscore) drops the prefix, a name with `__` keeps what follows the last `__`, and anything else is used whole. The result becomes the mesh appearance of every component override. | [source] `FixCustomizationAppearance` |
| 5. Mesh appearance | The patch added an empty appearance of that name to the mesh. ArchiveXL expands it from the mesh's expansion source (`black_carbon@long` → `<colour>@long`) and takes the `@long` template from the **patch** mesh. | [source] Mesh extension; [resource] patch meshes |
| 6. Material | `*{long_base_material}` resolves to the hairstyle's own strand material (its `@context` `LongBaseMaterial`: textures, roughness, flow), and `*…\{material}.hp` resolves to the pack's profile. The cap takes `*{cap_base_material}` plus the pack's gradient. | [source] + [resource]; the resolver reproduces it for the saved `38_ash_brown` ([saved hair resolution](../eye-artistry/saved-hair-profile-resolution.md)) |
| 7. Pixels | The profile is baked on load (sort, rescale to 0–1, sample `k/N`, 8-bit truncation, sRGB decode) and read by `hair.mt` as an overlay of ID over root-to-tip ([hair shading §3](../../knowledge/hair-shading.md#3-base-colour)). | [source: executable, compiled programs] |

### 2.3 Which hairstyles take an added colour

- **Vanilla.** ArchiveXL's bundle renames the materials of **295** vanilla hair, hat-hair and beard meshes to the eight template families `@long @short @curls @dread @braid @cap @cap01 @beard`, and gives them `@context` base materials (`PlayerCustomizationHairFix.xl`). Every vanilla hairstyle, cyberware variant and hat-hair remnant therefore takes pack colours [source].
- **CCXL hairstyles** take them when their meshes use the same families. All 18 dynamic CCXL hair meshes in the Studio's resolver cache use `@long` (8 also `@cap`), with `LongBaseMaterial`/`CapBaseMaterial` context [resource: 46 cached hair meshes, not an inventory]. A style whose materials are static, or that uses another template name, would find no template in the patch mesh. The wiki's symptom for a broken name is hair that shows "pure black or blonde" [wiki]. Which of these happens is a [hypothesis]. The Studio can check every installed hairstyle before Build (§3.4).
- **Brows, lashes, beards** take the colour through their own scopes and the `@brows`, `@lashes` and `@beard` templates. That is how one pack colours every scoped brow at once ([eyebrows §4](../../knowledge/brows.md#4-how-mods-add-brows)) [source + resource].
- **NPCs are untouched.** Additions go only to the player's creator options and player scopes. A same-path replacer such as Alliekat's recolours every NPC wearing the replaced colour ([hair shading §7](../../knowledge/hair-shading.md#7-resolving-which-hp-a-material-uses)) [resource].

### 2.4 How brows, lashes and beard follow

There is **no engine link** between hair colour and brow, lash or beard colour. They are separate creator rows (`hairstyle color`, `eyebrows color`, the lash row and `beard color`). A pack simply offers the same colour name in each row [resource] ([eyebrows §3](../../knowledge/brows.md#3-material-and-colour)). What each row draws differs:

| Row | Drawn from | Consequence for an authored colour |
|---|---|---|
| Hair | The `.hp` (ID × root-to-tip) and the cap gradient | Full ramp |
| Brows | The **cap gradient** sampled at its last texel (`GradientMapUV` 1), × `GradientMapIntensity` 2 × the style's tone. Linear channels above 0.5 clip | One flat colour, the cap gradient's texel 31 |
| Lashes | The `.hp`: ID sample 52 overlaid on the **last** root-to-tip sample ([hair reference §9](../materials/shader-hair.md#9-lashes)) | The tip colour. The first-party "dipped tips" profiles would give hot-pink lashes |
| Beard | The `.hp` through `@beard` | Full ramp on beard cards |

The packs reuse one `.hp` and one gradient per colour for every row, so brows and lashes are whatever the hair's gradient end and tip happen to be. Nothing forces that. The template paths can point each row at its own file with the same `{material}` name (for example `…\lash_profiles\{material}.hp`), so a colour can carry a derived lash colour and brow colour of its own [source: path expansion; untested for this use].

### 2.5 Save identity, and what happens when a pack is removed

- **Stored:** `(FNV-1a64 of the hairstyle .app, definition name)` in the `hairs` and `character_customization` groups, the same for brows (TPP groups) and lashes. The save's `tags` also hold the colour's tag and a length tag ([CC file chain §7](../../knowledge/cc-file-chain.md#7-how-a-save-stores-cc-choices)) [resource].
- **Pack removed:** the definition disappears from the creator, but the saved descriptor still asks for the appearance. ArchiveXL's step 4 still clones it (it needs only the requested name and the scope), yet no mesh appearance of that name exists any more. The wiki's "black or blonde" symptom suggests a fallback to the mesh's default or its expansion source [hypothesis]. What the mirror shows as selected is [file chain open question 3](../../knowledge/cc-file-chain.md#open-questions).
- **Useful corollary:** because rendering never consults the creator list, a colour can be **retired from the creator while its resources stay**. Saves that use it keep rendering, and the grid loses the entry [source-supported hypothesis; checklist item 9].

### 2.6 The swatch in the creator's row

Vanilla hair colour options have `useThumbnails` 1, so the row is a colour grid, six per row. A swatch tints its background with the definition's `color` and draws its `icon`, a TweakDB `UIIcon` record pointing at an `.inkatlas` part ([CC file chain: presentation](../../knowledge/cc-file-chain.md#presentation-order-rows-sections-labels-and-swatches)) [source]. Vanilla sets both (`color` (50, 44, 40) and `OptionsIcons.BrownLiquorice`). Every pack sets `color` to transparent black and relies on a painted icon: a TweakXL YAML record per colour, a 160 px icon plus a smaller 1080p one per the wiki, and an atlas with three slots [resource] [wiki]. Labels (`localizedName`) are empty in five packs and a secondary key with an ArchiveXL localisation file in one. Plain text would show as written [source].

Two icon textures of Washed Out and one each of Illegally Blonde and Like totally are `TEXG_Generic_Color`, the setting the [legacy generator](../../knowledge/cc-file-chain.md#lessons-from-the-legacy-generator) found to look washed out in game; the rest are `TEXG_Generic_UI` [resource].

### 2.7 Limits on colour count

- **ArchiveXL** has no cap: definitions are a dynamic array, re-indexed after merging [source].
- **The reference installation** lists 35 vanilla colours plus 150 added (45 + 21 + 35 + 20 + 8 + 21), so 185 per hair option. Its saved V wears an added colour chosen in game, so the grid scales at least that far [runtime, uncontrolled].
- **The profile bake** writes rows into a runtime float texture with a slot bound of 64 (`slot < 0x40` in the bake) [source: executable]. Vanilla alone has 73 profiles, so rows must be allocated on demand. What happens with more than 64 distinct profiles visible at once is [hypothesis]. It matters for crowds, not for one V.
- **Stops**: vanilla uses 2–6 per ramp; no limit is known. `sampleCount` is a `uint16`; vanilla uses 127 (47 profiles), 64 (24) and 43 (2).

### 2.8 Hand-assembly slips a generator removes

| Slip | Where | Effect |
|---|---|---|
| Tags left at the template's placeholder (`modderinitials_modname_bleached_aqua`) | All 21 colours of one pack | Hat hair and `{hair_color}` garments don't find the colour [wiki symptom; source mechanism] |
| One tag belonging to another colour (`bad_apple_brian` on `37_flaxteabrown`) | 1 of 20 in another | The same for that colour |
| Female and male creator resources swapped in the `.xl` | Washed Out | The female (`pma`) resource's `beard_color` overlay matches nothing; masculine V gets no Washed Out beard colours [source reading; hypothesis in game] |
| Anonymous overlays on the exact slot also reach `hair_color_none` (the bald choice, empty resource, one `None` definition) and feminine `eyebrows_color0` (brows Off, no definitions) | Every pack | Those rows may gain a grid of colours that draw nothing [source reading; checklist item 6] |
| Icons as `TEXG_Generic_Color` | Three packs | Washed-out swatches [legacy lesson] |
| Mesh appearance names that collide across packs | None found (0 duplicate definition names across 150) | A later same-named empty patch appearance would take over the earlier one's templates, so one pack's colour would draw another's profile [source: `ResourcePatch` mesh rule] |

## 3. What an XF export would emit

### 3.1 Resources

Generated per collection, under the Studio's depot root (`axefrog\appearance_studio\`, [naming](../../projects/xf-studio/data/naming.md)), with the feature folder `hair_colours\xfs_c<collection>\`:

| Resource | Content | Notes |
|---|---|---|
| `.xl` fragment | `customizations` female/male; `resource.patch` of `patch.mesh` into the nine player scopes | Joins the product's merged declaration ([package plan](../authoring/feature-module-platform.md#package-plan-merged-by-default-splittable-by-the-user)) |
| `xfs_…_pwa.inkcharcustomization`, `…_pma` | Anonymous appearance options, one per target slot, each with the collection's colours: `name` `xfs_h<colour uuid>`, `localizedName` plain text (the colour's display name), `tags` `[xfs_h<uuid>]`, `color` a representative swatch colour, `icon` per §3.3 | Both body genders from the start: colours need no geometry |
| `patch.mesh` | One empty appearance `xfs_h<uuid>` per colour; the ten `@family` template entries pointing at our `.mi` | Built from a minimal template mesh like the packs' (no geometry) |
| `materials\xfs_hair__<family>.mi` ×10 | Strand families, lashes and beard: `baseMaterial *{<family>_base_material}`, `HairProfile *…\hair_profiles\{material}.hp` (lashes: `…\lash_profiles\{material}.hp`). Cap: `GradientMap *…\cap_gradients\{material}.xbm`. Brows: `GradientMap *…\brow_gradients\{material}.xbm`, other values as vanilla's `eyebrows_grad__default.mi` | Only paths differ from the proven template |
| `hair_profiles\xfs_h<uuid>.hp` | The authored ramp (§4.2): stops written at exactly 0 and 1, `sampleCount` 127 | About 1 KB; up to about 14 KB with the dense encoding |
| `lash_profiles\xfs_h<uuid>.hp` | A flat profile giving the chosen lash colour: ID stops at sRGB 188 (linear ≈ 0.5, so the overlay passes the root-to-tip value through), root-to-tip constant | Only when lashes are offered |
| `cap_gradients\xfs_h<uuid>.xbm` | 32 × 4 BC7, sRGB, derived from the bake's root region (§4.4) | About 2.3 KB |
| `brow_gradients\xfs_h<uuid>.xbm` | 32 × 4, the brow colour at the last texel, pre-divided for `GradientMapIntensity` 2 and the clipping above linear 0.5 | Only when brows are offered |
| Icons | Per §3.3 | |

**Names.** `xfs_h` + the colour's UUID without hyphens (37 characters). It starts with `xfs_`, never matches the `NN_` shape, contains no `__` (which would make ArchiveXL split it) and cannot collide with another pack's mesh appearance. It is the definition name, the mesh appearance, the tag and the file stem at once, as the proven template requires. Display names can change freely; the identity cannot. Two definitions in one list with the same name would replace each other, so the generator derives every name from the UUID.

**Which slots.** Default: the four vanilla slots (`hair_color`, `eyebrows_color`, `eyelash_color`, `beard_color` in `pma`) as exact names, like every proven pack. Four of the six packs also overlay `mch_hair_part_01…03`, the part rows of the Multicolored Hair framework (§10). Rather than copy one framework's slot names (a per-mod branch), Build can **discover** slots from the user's merged catalogue: every appearance-option slot whose options carry the vanilla hair-colour definitions. Build lists what it found in Check. Discovery is generic, and an extra slot with no options is a no-op [source].

**Additive audit** (the [piercing study's rules](../jewellery/ccxl-piercing-feasibility.md#4-additive-audit-what-would-replace-or-shadow-existing-choices), applied here): no named options, no vanilla or third-party depot path shipped, no patch of vanilla `.app`/`.mesh` *content* beyond adding new-named empty appearances (exactly what ArchiveXL's own `h1_base_color_patch.mesh` and every pack do), and no definition name that exists in the merged catalogue. Build refuses any collision against the effective merged catalogue the resolver already computes.

### 3.2 One mod or many

Hair colours are one more `FeatureExporter`. By default they join the collection's single product ("XF Looks" when there is more than one feature). Split out, the proposed brand is **"XF Hair Colours"** (question 2). Two XF products never share a colour UUID, so a split build and a merged build of the same collection must not be installed together. That is the existing platform rule for any feature [source: `package-plan.ts`].

### 3.3 Swatch and label

Two routes, to settle in one test:

1. **Colour-only swatch** (proposed first): set `color` to a representative albedo (§4.3) and `icon` to none. It needs no TweakXL, atlas or icon textures. Whether the creator draws a plain tinted swatch with no icon is [hypothesis] (checklist item 2).
2. **Icon swatch**: Build renders a 160 px swatch per colour from the exact bake (and a smaller 1080p one), packs an `.inkatlas` with `TEXG_Generic_UI` textures and emits TweakXL YAML records. It adds TweakXL as a runtime dependency for this feature; the framework check already handles it.

Labels are plain text in `localizedName`, which the creator shows as written [source], so no localisation file is needed.

### 3.4 Verification

The resolver reads the built archive like any installed mod ([file chain §8](../../knowledge/cc-file-chain.md#8-generic-resolver-specification)). FeatureVerifier would:

- resolve each colour on the shown V's hairstyle, on every installed hairstyle's colour option, and on the brow, lash and beard rows;
- list hairstyles whose meshes offer no matching template ("won't take XF colours: <style>, uses static materials") as a plain Check note, not a failure;
- assert that every definition, tag, patch appearance, `.hp` and gradient agree (the §2.8 checks);
- confirm that the merged catalogue gained exactly the new names and replaced nothing.

## 4. The Studio editor

### 4.1 Document

`xfs/hair-colour-1`, one per colour in a collection: UUID, display name, the root-to-tip ramp, the strand-variation (ID) ramp or its generator settings, `sampleCount`, swatch colour, and the follow settings for cap, brows, lashes and beard. Undo, validation and persistence live in a domain service, per the [architecture contract](../authoring/architecture-contract.md). The editor talks to it through typed actions only.

### 4.2 Ramp editor

- **Root, mid and tip handles** on one strip, with more stops on click. Positions are pinned to 0 and 1 at the ends, so the engine's rescaling is the identity and the ramp means what it shows ([hair reference §7](../materials/shader-hair.md#7-hp-profiles-and-their-resolution): 28 of one pack's 45 root-to-tip ramps don't span 0–1, so the game stretches them).
- **Strand variation (ID).** The overlay makes an ID stop at linear 0.5 (sRGB 188) neutral; lighter stops lift a strand and darker ones deepen it. The editor offers variation amount, balance and tint instead of raw stops, and an advanced raw view. Vanilla ID stops are not grey: their median chroma is 48 of 255 and their luminance spans a median of 113 to 224 [offline, 73 profiles], so vanilla variation carries hue as well as lightness.
- **Game-linear or smooth.** The game interpolates stored 8-bit sRGB linearly between stops. For smooth curves the Studio can write a **dense encoding**: a flat pair of stops ±¼ sample around every sample position `k/N`, so every baked texel equals the authored colour whatever float rounding the engine uses. That is 254 stops per ramp. Writing stops exactly at `k/N` is not enough: `k · (1/N)` and `k/N` differ in float32 at 8 of 127 positions [offline], which could shift a channel by one level. That the engine accepts a profile with hundreds of stops is [hypothesis] (checklist item 5).
- **Everything in the ramp is the game's.** The strip draws the baked row, not the stops: sort, rescale, `k/N`, truncation and sRGB decode.

### 4.3 Preview through the exact bake

- The shown V's own hairstyle, brows and lashes, under the character-creator lighting preset, through the hair adapter. Prerequisite: the recommended preview changes of the [hair reference §11.1](../materials/shader-hair.md#111-recommended-preview-changes-for-a-code-track). `bakeHairProfile` still samples raw positions at `k/(N−1)` without truncation, and the environment path lacks the `2·C·w²` factor [source: `src/hair-colour-model.ts` at this commit].
- **A test sheet** of four to six installed hairstyles (vanilla long, short, curls, dread, one CCXL), since each hairstyle's `Strand_ID` and `Strand_Gradient` textures weight the same profile differently.
- **Readouts:** the mean strand albedo (hair is dark in game: the saved V's alpha-weighted mean is sRGB ≈ (74, 61, 54), [hair shading §5](../../knowledge/hair-shading.md#5-deferred-hair-light)), the lash colour the profile implies, the brow colour and its clipping, and the swatch as the creator will show it. For scale, a uniform ID × root-to-tip sample of the 73 vanilla profiles gives a median linear mean-albedo luminance of 0.28 (0.02 `default` to 0.81 `custom_beige_fur`); the six packs' medians run from 0.24 (Washed Out) to 0.63 (the MCH pack) [offline; uniform sampling, not strand-texture weighted].

### 4.4 Presets and follow options

- **Start from** any vanilla colour, or from colours picked off a reference photo with an eyedropper (root, mid, tip; a starting point only, since a photo's lighting is baked in).
- **Installed pack profiles as references**: shown side by side through the same bake. Whether their stops may seed an exported colour is question 4.
- **Cap:** derived by default from the bake's root region, so the scalp matches the roots, with an override colour. In the packs, the cap gradients are hand-painted and only loosely track their profile's baked root. The median RGB distance between texel 0 and the baked root is 60–98 per pack [offline].
- **Brows:** *not offered*, *match roots* (default), *match tips* or a custom colour, written to the colour's own brow gradient (§3.1).
- **Lashes:** *not offered*, *darkened roots* (default), *match tips* or a custom colour, written to the colour's own lash profile. This avoids the tip-coloured lashes of §2.4.
- **Beard:** the hair profile (default) or a custom ramp.
- **"Apply to my V"** sets the hair, brow, lash and beard choices together in the character context. The in-game rows stay independent, as in vanilla.

## 5. What makes a hair colour look good in game

From the decoded shader and the installed profiles:

1. **Dark roots, lighter lengths.** 60 of 73 vanilla profiles are darker at the root than the tip. Their median root-to-tip luminance ratio is 0.43. The packs range from 0.37 to 0.75, and Alliekat's 1.00 inverts some vanilla ramps ([yellow-hair investigation](../character-customization/yellow-hair-profile-override.md)) [offline].
2. **Stops that span 0–1.** Anything else is stretched by the bake. Vanilla spans 0–1 on the root-to-tip axis in 55 of 73 profiles but on the ID axis in only 32. Several community packs keep vanilla stop positions and change only colours (Washed Out 35/35, Illegally Blonde 20/20, Alliekat 36/36) [offline].
3. **3–6 stops per ramp**, as vanilla uses. Features narrower than 1/127 of the length vanish in the truncated lookup [source].
4. **Variation lives in the ID ramp.** It is the only per-strand colour control. Roughness and the per-strand highlight shift come from the hairstyle's `Strand_ID` *texture* and its `.mi` scalars, never from the profile. A colour cannot make hair glossier unless its template `.mi` overrides `RoughnessScale`/`RoughnessBias` for every hairstyle, which would overwrite each hairstyle author's tuning (question 7) [source].
5. **Keep albedo dark.** The hair light is dim (diffuse 0.47 × a squared, tightly wrapped N·L) and ambient light carries albedo twice, so a colour that reads right on a flat swatch goes darker on hair, most of all in shade ([hair shading §5](../../knowledge/hair-shading.md#5-deferred-hair-light)). Judge colours in the preview under the creator preset, not on the swatch.
6. **Match cap and roots.** The scalp shows the cap gradient, not the profile ([hair reference §8](../materials/shader-hair.md#8-the-scalp-cap)).
7. **Mind the tip.** It is the lash colour whenever lashes reuse the hair profile, and on thin cards it is where alpha is lowest.

## 6. In-game checklist

One prepared session, female V, with a scripted three-colour probe export ("XF Hair Colours Probe": a natural brown on 5 stops, a dipped-tips colour with derived brow and lash colours, and the same brown in the dense 254-stop encoding). Record game, ArchiveXL, TweakXL and Codeware versions and the creator-lighting state. Items 6 and 10 need no XF build and can run today with the installed packs.

| # | Check | Expected | Settles |
|---|---|---|---|
| 1 | Creator: hairstyle 1, a cyberware face with hairstyle 5, and one CCXL style: find the three probe colours in each grid | Present at the end of every grid; hair and scalp coloured | Overlay reach; templates on vanilla, cyberware and CCXL meshes |
| 2 | Look at the probe swatches (colour-only) beside a pack's icon swatch | A plain tinted swatch, or a blank or black one | Swatch route (§3.3) |
| 3 | Hover or select a probe colour | Its plain-text name shows | Labels |
| 4 | Brow and lash rows: pick the dipped-tips colour | Brows the derived brow colour; lashes the derived lash colour, not pink | Per-row files behind one name |
| 5 | The dense brown against the 5-stop brown, same hairstyle and camera | Identical, or a smoother ramp; no missing or garbled hair | Stop-count tolerance, dense encoding |
| 6 | Bald hairstyle, brows Off, and MultiColor Hair Off (§10): do these rows show a colour grid? | Unknown; the installed packs already overlay these slots | Side effect of exact-slot overlays |
| 7 | Put on a beanie or a cap over probe brown | The hair under the hat is probe brown | Tag → `{hair_color}` |
| 8 | Save, reload, mirror | Colour kept; the mirror shows it selected | Persistence |
| 9 | Build 2 of the probe with the dipped-tips definition removed but its resources kept; load the item-8 save using it | Still dipped tips; the grid no longer lists it | Retirement without breaking saves |
| 10 | On a throwaway save with a pack colour, disable that pack, load, open the mirror (then re-enable and load the original save) | Record hair and mirror state (black, blonde, or other) | Removed-colour fallback ([file chain ask 5](../../knowledge/cc-file-chain.md#in-game-test-asks)) |
| 11 | Scroll to the end of the hair grid | All 188 colours reachable | Count |
| 12 | Photo mode and gameplay third person with the probe colour | Same as the creator | Consumers |
| 13 | With the creator preset and the refined capture setup, photograph the probe brown next to vanilla `brown_liquorice` on one hairstyle | For the bake and light parity measurement | Preview parity ([capture request](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request)) |

## 7. Effort by phase

Estimates assume one agent, with the platform, resolver and Build pipeline as they are today.

| Phase | Work | Size |
|---|---|---|
| P0 Prerequisites | §11.1 bake and environment path in the preview; a bake parity test over every installed profile (vanilla, packs); an `.hp` writer through WolvenKit JSON with a round-trip oracle | 1–2 days |
| P1 Editor and preview | Colour document and service, ramp editor (root, mid, tip, variation, dense option), preview on the shown V and a test sheet, readouts, vanilla presets, follow settings | 3–5 days |
| P2 Exporter | Probe fixture first (checklist); then the `FeatureExporter`: `.xl` fragment, two creator resources, `patch.mesh`, ten templates, `.hp`, cap, brow and lash files, slot discovery, collision refusal, verifier (§3.4), pipeline contract update | 3–4 days |
| P3 Swatch | Colour-only swatch; icon route (bake-rendered icons, atlas, TweakXL YAML) only if item 2 requires it | 0.5 day, or 2 days with icons |
| P4 Session | The maintainer's in-game checklist (§6), about 30–45 minutes | — |
| Later | Photo-derived presets, per-colour gloss (if approved), masculine preview for beards, colour retirement UI | — |

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Colour-only swatches render blank | Medium | Icon route (P3), already proven by every pack |
| A hairstyle with static materials shows black or blonde in XF colours | Known for such styles | Verifier lists them in Check; nothing we ship can fix another mod's mesh |
| Link index drift: a style whose own list isn't the 35 vanilla colours shifts the added colours by the difference when V changes hairstyle | Low (both inspected styles align) [hypothesis] | Verifier reports styles with other base counts |
| Uninstalling or rebuilding without a colour breaks saves | Unknown (items 9, 10) | Keep retired colours' resources by default (question 5) |
| The dense encoding is rejected or slow | Low | Game-linear stops are the default; dense is an option |
| Cap and brows disagree with the hair under other lighting | Medium | Derived from the same bake; the creator preset preview; item 13 |
| Clutter: every pack adds to every row | Inherent | One XF entry per authored colour; nothing else |

## 9. Questions for the maintainer

**Decided 27 September 2026:** all nine proposed defaults accepted. On question 4, another mod's colour profile is a reference only (shown and compared), never copied into an exported colour; revisit if needed. The mod at Nexus 21613 is studied in §10, which adds question 10.

| # | Question | Proposed default |
|---|---|---|
| 1 | Should each authored colour also appear in the brow, lash and beard rows? | Yes: hair, brows and lashes, plus beard for masculine V, with Studio-derived brow and lash colours (brows match roots, lashes darkened roots) |
| 2 | Mod name when split out? | "XF Hair Colours"; merged into "XF Looks" by default |
| 3 | Swatch route? | Colour-only swatch if item 2 shows it works (no TweakXL dependency); otherwise generated icons through TweakXL |
| 4 | May an installed pack's profile seed an exported colour? | No. Vanilla colours and the user's own picks seed exports; third-party profiles are shown for reference only |
| 5 | When a colour is deleted, keep its resources so old saves still render? | Yes, retire it from the creator and keep its files, with an explicit "remove for good" action |
| 6 | Which rows to join? | Discover them from the installation's catalogue (any slot carrying the vanilla hair colours), exact names, listed in Check |
| 7 | Per-colour gloss (overriding the hairstyle's roughness)? | Not in the first version |
| 8 | Body genders? | Emit both creator resources from the start (colours need no geometry); the preview stays feminine until the masculine V lands |
| 9 | Build the three-colour probe for a coming session once discussed? | Yes, alongside the next planned session |

## 10. Multicolored Hair (Nexus 21613)

Studied 27 September 2026 from the installed package, read-only. The Core and the redacted-c01 hair profiles compatibility patch are enabled in the diagnostic MO2 profile (the reference profile lists both disabled). The Modder's Resources were read from the downloaded zip only. Nothing has been seen in game.

**Verdict.** Multicoloured hair here is **geometry, not shading.** A hairstyle is cut into up to three meshes, each an ordinary CCXL dynamic hair with its own colour row. The framework adds one creator switcher that turns the parts on. There are no masks, no new templates, no extra `.hp` data and no second profile per strand. Every colour pack that overlays the part rows reaches every part. XF colours will too, through slot discovery (§3.1), without a per-mod branch. The Studio resolves an MCH hairstyle correctly today, but the preview doesn't draw it (PREV-109, below).

### 10.1 What the packages hold

| Package (1.1.0.0) | Content | SHA-256 (first 16) |
|---|---|---|
| Core | Two creator resources (`eagull\multicolored_hair\multicoloredhair_main.inkcharcustomization` female, `…_main_mv` male; 8 KB archive), an `.xl` with `customizations` only, and a redscript file | zip `ef012f5c4266607c`, archive `13275fe508a0ee17`, script `2888b89a5fed32f4` |
| The redacted-c01 hair profiles compatibility patch | One creator resource, registered for both body genders; an `.xl` with `customizations` only | zip `2da1e3df05ac1cd8`, archive `9efde719c8f1fa21` |
| Modder's Resources | A written guide; two WolvenKit project templates (vanilla texture paths, and custom-pathed textures); loose `.mi` templates; placeholder rigs and animgraphs; the same redscript file | zip `70d944efc5cad4e6` |

No `.hp`, texture, mesh, `.mi`, TweakXL record or `resource` block ships in the Core or the patch [resource].

### 10.2 The mechanism

| Step | What happens | Grade |
|---|---|---|
| 1. Framework switcher | The Core adds a named switcher `mch_hair_switcher` ("MultiColor Hair", index 161, `link` `mch_hairstyle` feminine and `mch_hairstyle_pma` masculine, link controller). Its `uiSlots` are `mch_hair_part_01`, `_02`, `_03` and `mch_hair_fpp`. Its one choice, "Off", names four placeholder options (`hair_none_part_01…03`, `hair_none_fpp`) with no resource and only a `None` definition. They sit in `hairs`, `character_customization` and `FPP_hairs`. | [resource] |
| 2. Why a new switcher | The vanilla `hairstyle` switcher's `uiSlots` are `hair_color` and `hair_color_fpp`. ArchiveXL never changes an existing option's top-level fields in a merge ([file chain §5](../../knowledge/cc-file-chain.md#5-how-archivexlccxl-extends-the-lists)), so no mod can give it more colour rows. Each colour row must be its own slot, and one switcher must own them all. The three-part limit is the Core's fixed `uiSlots` list. The guide calls it an arbitrary choice made because a fourth option "just breaks stuff". | [source] ArchiveXL `MergeCustomOptions`; [resource] |
| 3. A hairstyle joins | An MCH hairstyle ships an **anonymous** switcher with only `link: mch_hairstyle`. ArchiveXL's overlay pass matches it to the Core's switcher by link, and appends its choice (for example "SOPHIE MCH"). The choice names one **named** appearance option per part (`sophiemch_hair_part_01` on slot `mch_hair_part_01`, and so on) plus an FPP shadow option. Each part option is a link controller of its own key, `hairstyle_color_1…3`, so a part's colour index carries over between MCH hairstyles. Each option lists the 35 vanilla colours and has its own label ("HAIR BASE", "FACE FRAME"). A two-part style simply names no part-3 option. | [source + resource]: the template, and two installed MCH hairstyles (MELUMINARY Sophie Midlength MCH, Easy Access Pony #003 MCH) |
| 4. Parts render as CCXL hair | Each part has its own `.app` with a single template appearance (`01_blonde_platinum`) and one mesh component. The hairstyle's `.xl` puts the part `.app`s in the `player_wa_hair.app` scope, so they are in `player_customization.app` transitively and ArchiveXL clones the requested colour there (§2.2 step 4). It also puts the part meshes in the `player_wa_hair.mesh` scope. Each part mesh carries `@context` (`LongBaseMaterial`, `CapBaseMaterial`), `@long` and `@cap` entries. Only the first part carries the cap chunk. | [resource]; [source] `FixCustomizationAppearance` |
| 5. Colours reach every part | Vanilla colours come from ArchiveXL's own patch mesh, and pack colours from each pack's `patch.mesh`. Both are patched into `player_{wa,ma}_hair.mesh`, whose scope now includes the part meshes. Creator reach is separate: a colour appears in a part's row only if its pack overlays `mch_hair_part_01…03`. The four third-party packs of §1 do. On the diagnostic profile each part option lists 164 colours (35 + 21 + 35 + 20 + 8 + the patch's 45). | [source + resource]; merged catalogue computed by the Studio |
| 6. Save | The active part options are ordinary appearance descriptors in `hairs` and `character_customization`, so one V can store two or three hair entries beside the vanilla hairstyle's. The Core's description says to set the vanilla hairstyle to 51 (no hair) while MCH is used; the two switchers don't know about each other. | [resource: groups]; storage [source-supported expectation] |
| 7. Creator camera | The redscript wraps `characterCreationBodyMorphMenu.GetSlotName` and maps the four `mch_*` slots to `UI_Hairs`, so the creator zooms to the hair for those rows. | [source: the script] |

### 10.3 What the compatibility patch changes, and why a patch is needed

The redacted-c01 pack's overlays name only the four vanilla slots (§1), so its 45 colours never appear in the part rows. The patch is one creator resource with three anonymous overlays on `mch_hair_part_01…03`. Each lists the pack's 45 definitions again with the same names, tags, icons and localisation keys. It ships nothing else, because the pack's `patch.mesh`, profiles, cap gradients, icons and localisation already reach the part meshes and the creator (step 5). It is registered under both `female` and `male`, which works because the slots have the same names in both resources [resource]. A pack that doesn't overlay the part slots therefore needs such a patch per framework. That is exactly the dependency slot discovery avoids for XF colours.

### 10.4 What the Modder's Resources offer

- **Template project.** Three part meshes, three part `.app`s (each a single template appearance), an FPP `.app` with the shadow mesh, a feminine creator resource wired as in step 3, and CCXL `.mi` templates (long, short, curls, dread, beard, cap). The cap and strand `.mi`s set the hairstyle's own textures over the vanilla `_master__*` materials. Colour stays in the dynamic `HairProfile` and `GradientMap` paths [resource].
- **Guide.** Split the hairstyle into three parts in Blender, import each part over a template mesh, rename the namespace folders, apply WolvenKit's "Convert hair to CCXL material", then search and replace `template` in the creator JSON. Known issues: rigs misbehave when several animgraphs drive one rig, so parts 2 and 3 point at placeholder rigs; two `.xl` files pointing at one creator resource double the rows; hot reload can reset the choice; an `@cap`-only mesh breaks vanilla colours [resource: guide text; the issues are the author's observations].
- **Gaps.** The guide tells creators to rename a `template.xl`, but neither template contains one. The installed MCH hairstyles show what it holds: the part `.app` and mesh scopes of step 4. The guide also says a hairstyle's `localizedName` need not be unique. ArchiveXL merges switcher choices by `localizedName`, so two MCH hairstyles with the same name **replace** each other [source: `MergeCustomOptions`]. The template covers feminine V only. A masculine MCH hairstyle must overlay link `mch_hairstyle_pma` [resource].

### 10.5 What XF Studio does with it today

| Stage | Result on the diagnostic profile | Grade |
|---|---|---|
| Merged catalogue | Faithful: the Core switcher with three choices (Off and the two MCH hairstyles), seven part options and the 129 added colours per part. The masculine switcher has only Off. Link-only anonymous overlays merge as in ArchiveXL (`cco-model.ts`). | [offline: `loadMergedCco`] |
| Character state (R5) | Choosing "SOPHIE MCH" activates both part options through the switcher and emits one descriptor per part. | [offline: `descriptorsFromUiState`] |
| Resolver (R6–R7) | Part 1 resolves to `sophie_hair_pt1.mesh` in `brown_liquorice` (dynamic appearance from `01_blonde_platinum`, 6 chunks, `hair.mt`). Part 2 resolves in `ash_brown`: its `@long` template comes from the redacted-c01 pack's `patch.mesh`, its `@context` base material from the hairstyle. That is exactly steps 4 and 5. | [offline: `resolveCharacter`, 35 s cold] |
| Preview plan | **Drawn since 27 September** (PREV-109 fixed). Hair is every active option the `hairs` group lists, whatever its creator slot (`HAIR_GROUP` in `character-detail-plan.ts`), so both parts of "SOPHIE MCH" draw, each with its own colour; the hair label names each part by its creator label ("hair base: brown liquorice, face frame: brown liquorice"), and the Character panel's coverage marks the part rows drawn by the same rule. Before the fix the plan picked hair by the vanilla slot name `hair_color`, dropped the parts and read "None". | [offline, then the browser on the diagnostic profile]; ledger **PREV-109** |

**The generic rule the Studio now follows** is the game's consumer rule. Everything active in the `hairs` group is drawn by the hairstyle controller ([file chain: groups](../../knowledge/cc-file-chain.md#groups-who-consumes-a-choice-resource)). On the diagnostic profile, the feminine `hairs` group holds 523 `hair_color` options, 7 `mch_hair_part_*` options and 5 names with no option; nothing else is in it [offline]. Treating "consumed by `hairs`" as the hair slot would draw MCH parts, and any future multi-part framework, with no name list. The hair material adapter already works per chunk template. This is data-driven work, not an adapter.

Smaller gaps, all generic:

- The preview's hair label names each active part (done with PREV-109). "Apply to my V" (§4.4) is still a design; it needs one entry per active part when it is built.
- Hair colour tags go to TweakDB only from `hair_color` targets, in ArchiveXL and in the Studio alike. What hair under a hat shows while the vanilla hairstyle is off and MCH is on is unknown. The hat-hair meshes know nothing of the parts [hypothesis; checklist item 15].

### 10.6 Implications for the XF hair colour design

1. **XF colours reach MCH parts with no extra work.** Question 6's slot discovery ("every slot whose options carry the vanilla hair colours") finds `mch_hair_part_01…03` on any installation with the Core and an MCH hairstyle. XF's `patch.mesh` already targets the `player_{wa,ma}_hair.mesh` scope that MCH part meshes join. This was the "untraced convention" of §3.1; it is now traced, and it needs no framework-specific name.
2. **Discovery happens at Build.** If the player installs MCH after building, XF colours are missing from the part rows until the next Build. The Studio can notice generically that the merged catalogue has gained a hair-colour slot since the last Build, and say "rebuild to add your colours to the new hair rows". Emitting a fixed list of framework slot names would work at runtime (an overlay on a missing slot matches nothing), but it is per-framework knowledge, so it is not proposed.
3. **Off rows gain grids.** Exact-slot overlays also reach `hair_none_part_01…03` (each lists 130 definitions on the diagnostic profile). That is the same side effect as the bald row (§2.8), and checklist item 6 now covers both. A wildcard overlay skips options with no resource or no definitions [source: `MergeCustomOptions`], which would avoid it. But a wildcard matches by prefix, so `hair_color*` would also reach the hidden `hair_color_fpp` options, which have a resource and one definition. The exact-slot default stays.
4. **Multicolour has three levels, and only the first is a colour feature:**
   - **Within one colour** (ombre, dipped tips, streaks): the root-to-tip ramp and the strand-variation (ID) ramp (§4.2). A two-band ID ramp gives streaks spread across strands by the hairstyle's own `Strand_ID` texture. There is no spatial control, and the same profile scatters differently on each hairstyle. `hair.mt` has no region mask ([hair shading §1](../../knowledge/hair-shading.md#1-inputs)). **In scope for P1** as editor presets: ombre, dipped tips, streaks and highlights, salt and pepper.
   - **Across parts of a split hairstyle** (MCH): each part is an independent creator row with the full colour grid. A "multicolour look" is therefore a **combination**: one XF colour per discovered hair part. It can be saved as a Studio preset and applied to the shown V part by part. It cannot be exported as one in-game choice, because the creator picks each row separately and a switcher choice activates options, not colours [source]. **In scope** as a preview and apply feature once PREV-109 is fixed.
   - **Region colour on a hairstyle that isn't split**: needs new geometry parts. A data-only route may exist: two or three part `.app`s that reference the **same** hair mesh with complementary component `chunkMask`s, each with its own colour row. It needs no mesh export or redistribution, but it splits only along the mesh's existing submeshes. Whether vanilla hair submeshes follow useful regions is unmeasured [hypothesis]. A true region split (bangs, one side, a "money piece") needs a mesh cut, which is hairstyle design. **Out of scope for colours.** It belongs to later feature 4 (hair design) and needs a decision: target MCH's slots (a runtime dependency on the Core, whose rows the colour packs already reach) or an XF switcher of its own (XF and vanilla colours only). Question 10.
5. **Generic authoring model.** Keep `xfs/hair-colour-1` as one colour. Add a Studio-only `hair look`: an ordered list of `(hair part, colour)`, where a part is any active option consumed by `hairs`, identified by option name and labelled with its `localizedName` ("HAIR BASE"). The export stays colour-per-choice. The look drives the preview, "Apply to my V" and a printed checklist ("in game, choose Midnight Teal for HAIR BASE and Rose Tips for FACE FRAME"). Nothing in it names a mod.

**Updated effort.** Region colour stays out of scope, so the phases change only a little:

| Phase | Change | New size |
|---|---|---|
| Prerequisite | PREV-109: plan every option consumed by `hairs` as hair, per part (a code-health fix, not part of the feature) | +0.5 day |
| P1 | Part-aware preview and apply; the `hair look` combination; ombre, streak and dipped-tip presets | 3.5–6 days (was 3–5) |
| P2 | Verifier resolves colours on every discovered part slot; Check lists hairstyles and frameworks reached; "rebuild for new hair rows" note | 3.5–4.5 days (was 3–4) |
| P4 | Two more checklist items (14, 15) | about 40–55 minutes |
| Later (decision) | Region multicolour hairstyles through chunk-mask parts or mesh cuts on part slots | 4–6 days plus a session, not estimated in detail |

**Checklist additions** (§6 table, same session):

| # | Check | Expected | Settles |
|---|---|---|---|
| 14 | With the MCH Core and "SOPHIE MCH": set the vanilla hairstyle to 51, then look for the probe colours in HAIR BASE and FACE FRAME; choose two different ones | Both parts coloured independently; the cap follows HAIR BASE | Discovery reaches framework slots; material reach through mesh scope |
| 15 | Same V: put on a beanie, then take it off | Record what hair shows under the hat | Hair colour tag and hat hair with MCH |

**Question 10 for the maintainer.** Should region multicolour (splitting a hairstyle into colourable parts) be a hair design feature? If so, should it target the Multicolored Hair Core's part slots (dependency on the Core; its rows already take every colour pack) or an XF selector of its own? Proposed default: out of the first hair colour version; revisit with hair design, preferring the Core's slots with a framework check, like the other frameworks.

## Provenance

- Packs and versions: §1. The first-party XF Dipped Tips package is a local test input, not a credit.
- ArchiveXL 1.27.3, commit `5474e34d56112f5d8843ae863e1e72ff510957c0`: `src/App/Extensions/Customization/Extension.cpp` (`MergeCustomEntries`, `MergeCustomOptions`, `FixCustomizationAppearance`), `src/App/Extensions/Garment/Dynamic.cpp` (`hair_color`), `bundle/source/resources/PlayerCustomizationHair{Fix,Scope,Patch}.xl`, `PlayerCustomizationLashes*.xl`, `PlayerCustomizationBeardFix.xl`.
- Modding Docs at `be2f44ee`: [CCXL: Hair Profiles (Colors)](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-hair-profiles-colors.md) (nutboy; images `CCXL_hp_image12.png`, `CCXL_hp_image13.png`, `ccxl_hairprofiles_edit_mi.png` inspected: an editor walkthrough, not runtime proof); [Hair Profiles: .hp](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/files-and-what-they-do/file-formats/materials/hair-profiles-.hp.md) and [Custom Hair Colours](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/modding-guides/npcs/guides-all-about-hair/custom-hair-colours/README.md) (manavortex), which point to the Blender add-on's gradient editing as the community's current authoring route.
- Offline statistics come from throwaway scripts over the private extractions: stop counts, spans, chroma, root/tip ratio, a Python port of the decoded bake with a uniform-sample mean albedo, cap texels against the baked root, name, tag and file consistency, and the float32 sample-position check. The numbers are recorded above; the scripts and extractions were not kept.
- Multicolored Hair (§10): the installed Core and the redacted-c01 hair profiles compatibility patch, 1.1.0.0 (hashes in §10.1), and the Modder's Resources zip, unpacked into a private scratch folder. The creator resources, the template project, and the part `.app`s and meshes of the installed MELUMINARY Sophie Midlength MCH hairstyle were read with the Studio's native reader. The merged catalogue, the R5 state, the resolved V and the preview plan came from the Studio's own `loadMergedCco`, `descriptorsFromUiState`, `resolveCharacter` and `planCharacterDetails` on the diagnostic MO2 profile, in throwaway scripts under a 3 GB guard (peak 2.0 GB). ArchiveXL source as above (`MergeCustomOptions` for link overlays and switcher-choice identity). Nothing extracted is committed.
- The 46 cached hair meshes are those the Studio's resolver had read on the reference installation by 27 September; they are a sample, not an inventory.

Related: [hair shading](../../knowledge/hair-shading.md) · [hair reference](../materials/shader-hair.md) · [CC file chain](../../knowledge/cc-file-chain.md) · [eyebrows](../../knowledge/brows.md) · [mod loading](../../knowledge/mod-loading.md) · [saved hair resolution](../eye-artistry/saved-hair-profile-resolution.md) · [piercing feasibility](../jewellery/ccxl-piercing-feasibility.md)
