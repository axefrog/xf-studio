# Character resolver: validation against hand-traced evidence

25 September 2026. First run of the generic character resolver ([mod loading](../../knowledge/mod-loading.md), [file chain §8](../../knowledge/cc-file-chain.md#8-generic-resolver-specification)) against the reference installation, read-only. The question: does the resolver, from data alone and with no mod-specific code, reproduce what earlier studies traced by hand? Grades follow the [knowledge rules](../../knowledge/README.md). Nothing here is runtime evidence: every "winner" is a source-derived expectation for the selected launch route.

## Setup

| Input | Value |
|---|---|
| Installation | Game 2.31 with Phantom Liberty; MO2 route, profile `2025 (again)` (about 1,000 rows); ArchiveXL 1.26.3 installed |
| Character | The captured reference save (`AutoSave-12`, [save import](../eye-artistry/save-import.md)): 106 saved appearance descriptors, 58 unique `(option, definition)` pairs, 7 morph pairs |
| Tools | WolvenKit CLI 8.17.4 for extraction/serialization; resolver code at the checkpoint that adds this page |
| Coverage | 1,079 mounted archives (77 listed as not mounted: disabled, subfolders, plugin locations), zero index errors, 1,000 visible `.xl` files (one with a malformed `patch` node), 242 female custom CCO resources merged. The MO2 overwrite folder contains links, which source discovery skips, so the scan is marked incomplete. |
| Cost | Cold: 508 resources extracted in 52 WolvenKit calls, about 9 minutes. Cached: about 16 s. |

Reproduce: `bun tools/resolve-character.ts --game <game> --mo2 <instance> --profile <profile> --save <appearance.json> --wolvenkit <WolvenKit.CLI.exe>` in `projects/xf-studio/authoring`; the report stays in the ignored `data/resolver-cache/`. The opt-in [integration test](../../projects/xf-studio/authoring/tests/character-resolver-integration.test.ts) asserts the rows marked ✓ below when `XFS_RESOLVER_REFERENCE=1`.

## Results against earlier traces

| Detail | Hand-traced evidence | Resolver result | Verdict |
|---|---|---|---|
| Eyes | [Modded eye resolution](../eye-artistry/modded-eye-resolution.md): ArchiveXL app `7132639559252259433`, Unique Eyes definition, nutboy mesh patch, Kala textures | App from the ArchiveXL bundle; `eye_16_diffuse` provided by Unique Eyes' anonymous overlay and built as a dynamic customization appearance; eye morph via ArchiveXL's `resource.copy` normal-fix path; mask hides chunk 0 (lashes); chunk material `eye_16_diffuse@eyes` from the Unique Eyes patch mesh → `eye.mt`; Albedo/Normal/Roughness hashes all from `basegame_Kala Standalone Eyes V2.archive` | ✓ match |
| Hair | [Saved hair profile](../eye-artistry/saved-hair-profile-resolution.md): MELUMINARY app and meshes, island_dancer `ash_brown.hp`, cap gradient, `template__long/cap.mi` | App SHA-256 `e80ab06e…` and both mesh SHA-256s match; dynamic `38_ash_brown` → mesh appearance `ash_brown`, expanded from the MEL appearance; `ash_brown@long`/`@cap` instantiate the colour pack's templates; `*{long_base_material}` and `*…\{material}.hp` expand to the MEL strand material and `ash_brown.hp` (hash `10513927005646989368`); cap gradient `5639241876279721650`; shared MEL maps from the first alphabetical provider (byte-identical, as the trace found) | ✓ match |
| Brows | [Head details](../eye-artistry/head-details.md), [brow audit](../eye-artistry/brow-texture-audit.md): Arkhe app `10685882159528859062`, morph `5838896660247859963` is a stub filled by copy + patch; `brown_ombre` gradient from Alliekat | Same app and stub; geometry from the `arkhe_copy\…` copy of the vanilla brow morph (1 chunk, 105 targets, all 5 saved morphs apply); `brown_ombre@brows` → `mesh_decal_double_diffuse.mt`; gradient from `Alliekat's Natural Hair.archive` | ✓ match |
| Lashes | [Brown liquorice collision](../eye-artistry/brown-liquorice-profile-overlap.md): icxrus app, dynamic `brown_liquorice`, `.hp` collision Alliekat vs base unresolved | Same app; `brown_liquorice` from ArchiveXL's bundle patch mesh, expanded from icxrus's `black_carbon@lashes`, material from icxrus's own `@lashes` template (the bundle patch has no material entries, so it is not the material source); `brown_liquorice.hp` chosen from Alliekat by the mod-first rule **and** recorded as `mod-over-base-native-unread` with the base copy as alternative | ✓ match, ambiguity kept |
| Skin | [Saved skin chain](../eye-artistry/saved-skin-resource-chain.md): app `520eb3d7…`, head mesh `e877b91a…`, head morph base vs rig-fix candidates, four-level vanilla material chain | App and mesh SHA-256 match; head morph chosen from the Facial Customisation Rig Fix (`16ec1fae…`, the trace's second candidate) with a mod-over-base ambiguity. **New:** the -KS- UV Texture Framework `.xl` patches the female head mesh with `ks_uv_donor\ks_donor_head_f.mesh`, which replaces appearance `01_ca_pale_00_warm_ivory__d05`; its chunk material `skin2_d05` comes from the donor mesh and inherits the framework's own layered instance before the vanilla `01_ca_pale_00_warm_ivory.mi` (`1e73eedb…`, matching the trace's last level) and `skin.mt`. Albedo/Normal/Roughness candidates are the Arkhe ones the trace listed. | Match plus a finding the hand trace missed (it did not apply `.xl` patches) |
| Teeth | Same page: base app `764c4167…` vs MO2 `Morphtarget and AnimRig Additions` `ebab1c5c…` unresolved | NLD app chosen (mod first, `ebab1c5c…`); its appearance lists 16 morph components all named `ht_000_pwa__basehead` (15 with hash-only paths); all kept and flagged `duplicate-component-name` | Match, new ambiguity |
| Legacy XF eye makeup | Saved `xfea_layer1_e04`, `xfea_layer2_s01`, `xfea_layer3_s02` ([save import](../eye-artistry/save-import.md)) | See next section | Resolved |
| Lips, cheeks, scars, face rig, proxies, body, arms, nails | Not traced before | All resolve to vanilla or mod providers with full chains; nails and arm meshes come from mods over base | New |
| Female genitals | – | `i0_000_pwa_base__vagina__01_ca_pale_00_warm_ivory` exists in the EP1 CCO and the save but in **no** copy of `i0_000_base__genitals.app` (both base copies are byte-identical and list only the six plain tones for this body) | Gap: engine fallback unknown |
| Lifted feet | – | The winning `l0_000_base__full.app` (KS UV Texture Framework) cannot be converted by WolvenKit 8.17.4 or 9.0.1 (`castShadows` stored as `Bool`, an older resource layout) | Gap: unreadable here; whether the game tolerates it is open |

## Legacy XF eye makeup (validation target)

The reference character wears eye makeup from the legacy **XF Eye Artistry CCXL - Dev** package, enabled in the profile. The resolver picks it up from the save plus the installed `.xl`/CCO with no special handling:

| Layer | App (all from `xf-eye-artistry-ccxl.archive`) | Geometry | Material chain | Colour and texture |
|---|---|---|---|---|
| `xfea_layer1_e04` / `xfea_layer1_006_matte` | `base\axefrog\xf-eye-artistry-ccxl\variants\xfea_layer1_e04.app` | shared `xfea.morphtarget` → `xfea.mesh`, 1 chunk, 105 targets (all 5 saved morphs apply) | local material in `xfea.mesh` → `materials\layer1_matte.mi` → `materials\mesh_decal__emp_front.mt` | `DiffuseColor` (19,17,16) set by the mesh's local material; `DiffuseTexture` `textures\e04.xbm` |
| `xfea_layer2_s01` / `xfea_layer2_006_matte` | `…\variants\xfea_layer2_s01.app` | same | `layer2_matte.mi` → `mesh_decal__emp_front.mt` | (19,17,16); `textures\s01.xbm` |
| `xfea_layer3_s02` / `xfea_layer3_033_matte` | `…\variants\xfea_layer3_s02.app` | same | `layer3_matte.mi` → vanilla `base\materials\mesh_decal.mt` | (82,145,119); `textures\s02.xbm` |

All three share the vanilla noise secondary mask, flat normal and `roughmetal` roughness. `mesh_decal__emp_front.mt` is a copy of the vanilla `mesh_decal.mt` with the same 30 parameters and pass structure but `materialPriority = EMP_Front` instead of `EMP_Normal` [resource], so layers 1–2 are drawn in the front decal priority. Qualitatively, near-black layers under a green-grey layer are consistent with the dark green-grey smoky eye makeup in a private in-game portrait of the character; that is an observation, not a colour match (the portrait postdates the save, and lighting and shader are not modelled).

What is still missing to render these layers in the Studio: a geometry adapter that exports the resolved `xfea.morphtarget` (the resolver gives the winning bytes and their provenance, not a GLB), texture decoding of the three `.xbm` files, a `mesh_decal` shader adapter that honours `DiffuseColor` × texture, `SecondaryMask` and the two material priorities (the [mesh decal contract](../materials/mesh-decal-shader-contract.md) covers the shader side), and stacking order between decal priorities.

## PRC as vanilla piercing option 12

A UI state `{piercings: "12", piercings_12: i0_000_pwa__earring__01_silver}` resolves, with no PRC-specific code, to exactly the [PRC case study](../../knowledge/cc-file-chain.md#6-case-study-why-prc-piercings-work-in-game):

- `i0_000__earring_14.app` from `PRC_z_999_Framework_128.archive` (mod over content, ambiguity recorded);
- 128 inline slot components plus the kept vanilla part; **125 draw nothing** (zero render chunks), 3 draw: `fpm50` from `PRC_f_50_nose_diam.archive` (SHA-256 `42b4c7e8…`), `fpm72` from `PRC_f_72_nostril_ring_right_1.archive` (`d7b5238f…`), `fpm74` from `PRC_f_74_nostril_ring_left_1.archive`, each winning over the framework placeholder by alphabetical order;
- the kept vanilla part `i1_000_pwa__morphs_earring_04` shows chunk 1 (mask …610), from the Facial Customisation Rig Fix's replacement morph;
- all components use `silver`; the stud's second chunk `default__02` → `base\eagul\mat_1.mi` from `nim_piercings_recolor_silver.archive` → `multilayered.mt`, as the [PRC catalogue audit](../jewellery/prc-catalog-audit.md) found.

## Mismatches and limits

- **Material chains stop at the template.** Parameters and textures are listed with providers; no `.mt` shader semantics, `.mlsetup` layers or texture pixels are interpreted.
- **Geometry is not exported.** The resolver names the winning `.morphtarget`/`.mesh` bytes; GLB export remains in the older intake tools.
- **The skin head material now differs from the hand trace** because of the KS patch. Which chain the game uses depends on ArchiveXL applying that patch at runtime, which no log has confirmed.
- **Unproven rules decide real payloads:** 57 resources for this character come from a mod over a base copy and 55 of those payloads differ. All 70 base-internal collisions are byte-identical and harmless here.
- **Not modelled:** `.ent` patches of the player entity (R6b), visual-tag hiding, REDmod, Vortex, `!exclude` patch tags, and link propagation beyond the simple index rule.

Provenance: third-party resources were read privately from the reference installation for this validation; the mods involved are credited in the [community credits](../../docs/community-credits.md). No extracted resource, texture or report is committed.
