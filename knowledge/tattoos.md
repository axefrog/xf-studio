# Tattoos: face and body, vanilla and modded

**Maturity: Draft.** Consolidated on 27 September 2026 from the game 2.31 resources in the Studio's resolver cache (WolvenKit CLI 9.0.1 JSON) and preview exports, the creator option inventory, ArchiveXL 1.27.3 source, the Modding Docs at `be2f44ee` and the tattoo mods on the reference MO2 install. Nothing here has runtime evidence of its own. Evidence grades follow the [knowledge rules](README.md): **[source]** engine, framework or tool source; **[resource]** extracted game or mod resources, including measurements on exported geometry; **[wiki]** Modding Docs text or image; **[runtime]** the running game; **[hypothesis]** not yet established. Provenance, hashes and the measurement method are in the [tattoos brief](../research/character-customization/tattoos-brief.md#evidence-and-provenance), which also holds the proposed XF Tattoos design.

This page answers: how the character creator's face and body tattoos are built; how they take their colour; how they sit with skin, makeup, scars and clothing; how they cross from one body part to another; and how mods add tattoos, additively or by replacement. The creator's option model is in the [CC file chain](cc-file-chain.md), the body's parts in [V's body](body-rendering.md), and decal arithmetic in [materials and shaders §2.4](materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it).

## 1. At a glance

| | Face tattoos | Body tattoos |
|---|---|---|
| Creator row | Switcher `facial_tattoo` (Off + 15), slot `facial_tattoo_switcher` → options `facial_tattoo_01…15` in slot `facial_tattoo` | Switcher `body_tattoo` (Off + 7), slot `body_tattoo_switcher` → `body_tattoo_01…07` in slot `body_tattoo`; hidden first-person twin `fpp_body_tattoo` on the same link |
| Links | Switcher link `facial_tattoo`; each option follows `skin color` (12 tone definitions) | Switcher link `body_tattoo`; each option follows `skin color` |
| Groups (who draws it) | `TPP`, `TPP_photomode`, `character_customization` (not the `face` group that makeup uses) | `TPP_Body`, `character_creation`; the twin in `FPP_Body` |
| Edit contexts | `NewGame`, `Ripperdoc` | `NewGame`, `Ripperdoc` |
| `.app` | `…\appearances\head\tattoos\hx_000__tattoo_NN.app`, 24 definitions (`m__<tone>`, `w__<tone>`) | `…\player_base_bodies\appearances\t0_000_base__tattoo_NN.app` (and `t0_000_fpp__tattoo_NN.app`), 24 definitions |
| Component | `entMorphTargetSkinnedMeshComponent` on `hx_000_pwa__morphs_tattoo_NN.morphtarget` (105 facial targets) | Female: `entMorphTargetSkinnedMeshComponent` on `tx_000_pwa_base__full_tattoo_NN.morphtarget` (the two breast targets). Male: `entGarmentSkinnedMeshComponent` on `tx_000_pma_base__full_tattoo_NN.mesh` |
| Geometry | A lifted copy of head triangles, own UV, one LOD | A lifted copy of body **and** arm triangles in one chunk, own UV, one LOD |
| Texture | `head_tattoo__customisation_NN_d0x.xbm`, 1024² (design 02) | `tattoo_body__customisation_NN_d02.xbm`, 2048² (design 01) |
| Material | `mesh_decal.mt` through `customization_tattoos_<tone>.mi` | the same |
| Hidden by | `hide_Head` (every `hx_` component) | `hide_Torso` (every `tx_` component) |

Sources: creator resources and option inventory [resource]; `.app`, `.mesh`, `.mi`, `.xbm` headers [resource]; tags [source: ArchiveXL `bundle/source/resources/VisualTags.xl`]; body tattoo names and chest sizes [wiki: [character-creator cheat sheet](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md), [body cheat sheet](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-body.md), both manavortex].

## 2. Face tattoos

**Creator order is not option order** [resource]. The switcher's choices are labelled by position, and position 01 is `facial_tattoo_06`: 01 → 06, 02 → 07, 03 → 08, 04 → 09, 05 → 11, 06 → 10, 07 → 01, 08 → 02, 09 → 03, 10 → 04, 11 → 05, 12–15 → 12–15. A save stores the resolved appearance, not the position ([file chain "Identity"](cc-file-chain.md#identity-and-why-indices-are-not-identity)).

**Legacy option** [resource]. A hidden `tattoo` option (slot `tattoo`, link `facial_tattoo`, `enabled` 0, 7 definitions) points at `h0_000_tattoo.app`, which also carries named NPC tattoos (`tygerclaw`, `valentino`). The six vanilla UI presets hold it active at Off ([resolver validation](../research/character-customization/resolver-validation.md)).

**Ten meshes carry fifteen designs** [resource]. The female meshes are `…\h0_000_pwa_c__basehead\hx_000_pwa_c__basehead_tattoo_01…10.mesh`. Several meshes serve two designs as a second set of tone appearances (`<tone>_02`): mesh 01 references textures 01 and 11, mesh 02 textures 02 and 12, mesh 05 textures 05 and 10, mesh 07 textures 07 and 13; mesh 10 carries 13 again and the NPC Tyger Claw and Valentino looks. Tattoo meshes also host face-cyberware looks (`cyberware_10` on mesh 02; `cyberware_09`, `_11`, `_13` on mesh 06), as the cheek mesh does ([head CC rendering](head-cc-rendering.md#1-every-head-option-at-a-glance)). Vertex counts run from 377 (mesh 04) to 3,606 (mesh 02).

**Geometry of design 02** (measured on the WolvenKit export against the drawn head) [resource]:

| Property | Value |
|---|---|
| Footprint | 3,606 vertices, 900 cm²: 55 % of the head's area and 53 % of its vertices, from the scalp line down the neck to the head mesh's lower edge |
| Lift | 0.19–0.21 mm along the head normal (median 0.197 mm); makeup decals sit at 0.40 mm, brows at 0.35 mm ([face makeup §2](face-makeup.md#2-the-vanilla-face-decal-meshes)) |
| UV | Its own layout, not head UV0 (no vertex shares its head vertex's UV); partly mirrored: where a vertex has an exact mirror partner, 93 % of pairs share a UV, so symmetric parts of a design are painted once |
| Density | 289 mm per UV unit: about **0.28 mm per texel** at 1024² |

## 3. Body tattoos

**Seven designs, five female meshes** [resource] [wiki]. The cheat sheet names them 01 Valentinos, 02 geometric blackwork, 03 serpent, 04 flowers/mandalas, 05 NUSA, 06 Rock, 07 Arasaka; designs 06 and 07 are the `_02` and `_03` tone appearances of mesh 01 (37 appearances: `default` plus 12 tones × 3), which references `tattoo_body__customisation_06_d02.xbm` besides its own texture [resource].

**Female body tattoos follow the breast shape by morph; male ones by garment** [resource]. The female component carries the body's two breast targets (`t0_000_wa_base__full_breast_small` / `_big`, region `breast`); the male one is a garment component, so the garment assembler fits it to the body like clothing [hypothesis for the male fit mechanism].

**Geometry of design 01, female** (measured against the body and both arms) [resource]:

| Property | Value |
|---|---|
| Structure | **One chunk** of 3,296 vertices and 5,824 triangles, 9,396 cm², one LOD |
| Footprint | Body chunks 0–3 (chest, collarbone, upper and lower abdomen: 53 %, 49 %, 88 % and 59 % of their vertices), all of the thighs (chunk 4) and calves (chunk 5), 9 % of the ankles, no feet; the upper arms (88 %) and part of the forearms (28 %), no hands; nothing on the head. The arm vertices are copies of **arm** mesh vertices, so one decal spans the body and both arm meshes |
| Lift | 0.95–1.04 mm along the skin normal (median 0.99 mm): about five times a face tattoo's lift |
| UV | Its own atlas over u 0.006–0.989, v 0.005–0.994, not mirrored (2 % of mirror pairs share a UV) |
| Density | Chest and shoulders 985 mm/UV, abdomen and hips 1,101, thighs 1,359, lower legs 1,371: **0.48–0.67 mm per texel** at 2048² |

The other body meshes were not measured; whether each design has its own footprint or all share mesh 01's canvas is open (question 1).

**First person** [resource]. The `fpp_body_tattoo` twin selects `t0_000_fpp__tattoo_NN.app`, drawn with the first-person body parts; it has no creator row of its own.

## 4. Colour and material

The ink is a colour texture with coverage in alpha, and the V's **skin tone** picks the material [resource]. `customization_tattoos_<tone>.mi` is a direct child of `base\materials\mesh_decal.mt`:

| Tone instance | `DiffuseColor` | `DiffuseAlpha` |
|---|---|---|
| `01_ca_pale` | default (white) | 0.6 |
| `03_ca_senna` | 216, 204, 191 | 0.6 |
| `06_bl_dark` | 119, 115, 110 | 0.6 |

Face meshes 06–10 carry complete local parameter sets that override this: `DiffuseAlpha` 0.7 and their own per-tone `DiffuseColor` (from 255, 255, 255 down to 119, 115, 110), with the flat normal, white roughness and black metalness placeholders at zero weight [resource]. Body mesh 01 uses the tone instances as they are [resource].

What that does [source: [decal reference §4.3–4.4](../research/materials/shader-decal.md#43-coverage)]: colour = `DiffuseColor × DiffuseTexture.rgb`, alpha = `DiffuseAlpha × coverage²`. So vanilla ink is **never opaque** (at most 60–70 %, like healed ink under skin), is **darkened on darker tones** by the tone's tint rather than recoloured, and writes **colour only**: the skin keeps its own roughness, normal and subsurface scattering under the ink. The player cannot choose an ink colour; the colour comes from the design's texture.

## 5. How tattoos combine with skin, makeup, scars and each other

| Layer | Where it lands | Evidence |
|---|---|---|
| Skin albedo, tone tint and any `SecondaryAlbedo` overlay (texture-framework tattoos, §8) | Written by the skin shader itself, in the skin's own UV | [source] ([materials §4.1](materials-and-shaders.md#41-basematerialsskinmt-and-skin_blendable-skin_morph)) |
| Face and body decals: makeup, blemishes, scars, tattoos, face cyberware | Each a separate `post_gbuffer` draw that blends into the G-buffer after the skin | [source] [resource] ([face makeup §3](face-makeup.md#3-how-face-decals-combine)) |

- **Decals draw over framework overlays** [source]: an overlay tattoo is part of the skin; a decal tattoo, makeup or scar blends on top of it.
- **Tattoo and scar together** [source]: a scar writes normal and roughness and a tattoo writes colour only, so where they overlap the ink takes the scar's relief whichever draws first; which colour wins depends on the unknown draw order within `EMP_Normal` (open question 2).
- **Tattoo and makeup** [resource] [hypothesis]: every vanilla face decal is `EMP_Normal`; the face-tattoo lift (0.2 mm) is below makeup's (0.4 mm), but decals do not write depth, so lift does not decide order.
- **Several tattoos** [resource]: the vanilla creator allows one face and one body tattoo at a time (one choice per switcher). Face and body tattoos never overlap: the face tattoo lives on the head mesh (neck included) and the body tattoo on the body and arms.

## 6. Across body parts and seams

The V is several meshes, each with its own UV and texture [resource] [wiki: LadyLea's layout images in the [texture frameworks page](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/modding-guides/npcs/custom-tattoos-and-scars/converting-between-tattoo-frameworks/README.md), `ORIGINAL - UV LAYOUT - FEMALE - BY LL.png`, `ORIGINAL - UV LAYOUT - ALL IN ONE PLACE - LEFT&RIGHT ARMS.png`]:

| Part | Mesh | UV and density (female, measured) |
|---|---|---|
| Head and neck | `h0_000_pwa_c__basehead` | Head UV0, not mirrored; 529 mm/UV on average (0.13 mm per texel at 4096²) |
| Torso and legs | `t0_000_pwa_base__full`, 8 chunks | One sheet: front and back torso, each leg with its foot, all separate islands, not mirrored; 1,466–1,795 mm/UV by chunk (0.36–0.44 mm per texel at 4096²). The sheet's left strip is unused in vanilla |
| Arms and hands | `a0_000_pwa_base_hq__l` / `__r` | Their own texture; both arms share one layout (mirrored) [wiki]; 642–718 mm/UV on the upper and forearm, 386 on the hand |
| Feet (by footwear state) | `l0_000_pwa_base__cs_flat` and variants | Part of the body sheet's leg islands [wiki] |

The seams: the head meets the body at the collar (the head mesh ends at y ≈ 1.49 m, body chunk 1 reaches 1.53 m in the export's frame), the arms meet the body at the shoulders, and the feet meet the calves at the ankles [resource]. The measured surface adds up to about 1.63 m² for a female V (head, body and both arms), a sanity check against real body surface area.

**How vanilla crosses a seam** [resource]: body tattoo 01 is one decal mesh whose vertices copy both body and arm vertices, each with its own part's skinning, laid out in the decal's own atlas. The seam problem moves from the skin's UV to the decal's UV, where the tattoo artist controls it. Nothing vanilla crosses the collar: face tattoos stop at the head mesh's edge.

**How frameworks cross a seam** [wiki] [resource]: they paint in the skin's own UV, so each skin part is a separate image and a design that crosses a seam is drawn twice and matched by hand. Unique Arms (Halvkyrie) gives each arm its own texture to break the vanilla arm mirroring; the KS UV framework's base layout moves both arms into the body sheet's unused strip, so a sleeve and the torso are painted in one image (`KSUV - UV FULL BODY LAYOUT - FEM - BY LL.png`); VTK keeps the vanilla arm layouts with separate left and right textures. Head overlays are separate images in head UV0.

## 7. Clothing, cyberware and camera

- **Clothing covers tattoos by depth** [hypothesis]: a garment is drawn over the skin, so a decal a millimetre above the skin is hidden where the garment is.
- **Tags hide whole tattoo components** [source: ArchiveXL `VisualTags.xl`]: `hide_Torso` hides every `tx_` component, so a garment that hides the torso also hides the body tattoo's leg and arm parts, which share the one chunk; `hide_Chest`, `hide_Legs`, `hide_Arms` and the other partial tags do not touch `tx_`. `hide_Head` hides every `hx_` component, face tattoos included. A mod can add its own components to any tag through its `.xl` ([clothing §4.3](clothing.md#43-masking-the-body-resource-source-wiki)). These rules register only from an item `.app` definition's own `visualTags`; vanilla items' definitions carry none, so vanilla clothing hides no tattoo this way and relies on the garment assembler ([clothing §4.3](clothing.md#43-masking-the-body-resource-source-wiki)).
- **Arm cyberware** [hypothesis]: the arm parts change with the holster state ([body rendering §1](body-rendering.md#1-which-parts-make-the-third-person-body)); no rule we have read hides the body tattoo's arm vertices when a cyberarm replaces the forearm (test ask 3).
- **First person** [resource]: the FPP twin draws a separate tattoo resource with the first-person body.

## 8. How mods add tattoos

| Route | Example (reference install) | Mechanism | Additive? |
|---|---|---|---|
| **Texture-framework overlay** | Sun Moon And Stars (the one enabled), Serpentine Heart and its Remix, Photon Spine, Graceful, Brooke Candy, Floral, Deej's Mandala Geometry, both Bedellia overlays | The framework gives V a player-only skin material chain whose tone level sets `SecondaryAlbedo` = an overlay texture (KS UV: `base\4k\common\overlays\fullbody_overlay_d01.xbm` for the body, `wa_head_overlay_d01.xbm` for the head, also `EmissiveMask` = `glow_overlay_d01.xbm` at `EmissiveEV` 2 and `DetailNormal` = `fullbody_overlay_n01.xbm`). A tattoo mod ships that one overlay path, sometimes with the body roughness map (for glossy ink), the glow overlay or the overlay normal | **No.** Every overlay mod replaces the same file; one wins by load order (project-name prefixes such as `004_`/`005_` or `00_` [wiki]); combining two means merging their images by hand [wiki: merge guides]. Painted in the framework's body UV, so a mod is tied to one framework and body layout |
| **Framework wiring** | -KS- UV Texture Framework 4.1 | `!!!_UV4.xl` patches the vanilla female and male body, foot, first-person torso and head meshes with donor meshes (`resource.patch`) whose materials point at `base\characters\common\skin\player_mat_instance\…`, a copy of the tone chain that NPCs do not use [resource] | Changes V's skin materials; the vanilla tone chain has no `SecondaryAlbedo` at all [resource] |
| **Same-path replacement of vanilla tattoos** | Night City Tattoos' guide route, Halk's replacer guide [wiki] | Ship a vanilla `tattoo_body__customisation_NN_d01/_d02.xbm` or head tattoo texture at its own path | **No.** Replaces a vanilla design for V and every NPC wearing it |
| **CCXL: a new row** | SEDTH's Sandevistan CCXL Tattoo 2.0 | Its own switcher `sedth_san` (own slot, `index` 0, `NewGame`/`HairDresser`/`Ripperdoc`), one choice per supported body (Vanilla, Angel, Elegy, EBB variants, Solo 2, SoLush), each an appearance option with two definitions (Enabled/Disabled) whose `.app` holds two `entGarmentSkinnedMeshComponent`s: a head decal and a body decal fitted to that body (`body_vanilla_pwa.mesh`: 4,656 vertices), both `mesh_decal` writing colour, normal, roughness and metalness (`RoughnessMetalnessAlpha` 0.75) with a separate normal-alpha mask. Groups `TPP_Body`, `FPP_Body`, `character_creation` | **Yes.** Combines with any vanilla or overlay tattoo; costs a creator row |
| **CCXL: choices in the vanilla row** | The wiki's body-tattoo template (Nexus 19903) [wiki: [CCXL body tattoos](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-body-tattoos.md), images `image (261).png`, `ccxl_tattoo_mesh_file.png`] | A nameless switcher with link `body_tattoo` whose choice names a new appearance option; its `.app` has 24 tone appearances (`m__01_ca_pale` …) on an `entGarmentSkinnedMeshComponent`; the mesh is a copy of a body mesh, "slightly inflated", with a local material over a `.mi` | **Yes, within the row**: while chosen it replaces the vanilla body tattoo (one choice per switcher) |
| **Community region rows** | none installed | The wiki's table of modded tattoo switchers: `neck_tattoo` 3300, `left_arm_tattoo` 3301, `right_arm_tattoo` 3302, `left_shoulder_tattoo` 3303, `right_shoulder_tattoo` 3304, `chest_tattoo` 3305, `stomach_tattoo` 3306, `back_tattoo` 3307, `left_leg_tattoo` 3308, `right_leg_tattoo` 3309, with the advice to join these rather than add new ones and never to change an existing modded switcher's index [wiki: [CCXL additions](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/README.md), manavortex and redacted-c01, last edited by icxrus]. The [switcher guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-creating-a-switcher.md) gives tattoos that toggle alongside the vanilla ones as its example | **Yes**, and several mods can share one region row |

**Keeping a CCXL tattoo additive** [source] ([CC file chain §5](cc-file-chain.md#5-how-archivexlccxl-extends-the-lists), [jewellery §5](jewellery-resources.md#5-additive-rules-for-a-ccxl-jewellery-option-source)): ArchiveXL merges switcher choices by `localizedName` and replaces a choice whose key already exists. Vanilla tattoo choices are labelled `01`…`15`, so a mod choice labelled `15` in `facial_tattoo` would overwrite vanilla design 15; every added choice needs a globally unique label (the wiki's template says so for its translation key).

**Body mods** [resource] [wiki]: a decal mesh copied from the vanilla body does not fit a refitted body, which is why Sandevistan ships one mesh per body and one choice per body. The overlay route instead depends on the framework's UV layout, which is why tattoo mods ship KS UV and VTK builds.

**Getting a tattoo in the world** [resource]: Watson Tattoo Shops (1.2) adds two shop interiors through ArchiveXL streaming and a chair whose Native Interactions entry (`appearanceOption` 2) opens character customisation; the vanilla tattoo rows already carry the `Ripperdoc` edit tag.

## 9. Texel density and size, side by side

| Surface | Density (mm/UV) | Texel at 1024² | 2048² | 4096² | 8192² |
|---|---|---|---|---|---|
| Face tattoo 02 (own UV) | 289 | 0.28 mm (vanilla) | 0.14 | 0.07 | – |
| Head UV0 (average) | 529 | 0.52 | 0.26 | 0.13 (vanilla head albedo size) | – |
| Body tattoo 01 (own atlas) | 985–1,371 | – | 0.48–0.67 (vanilla) | 0.24–0.33 | – |
| Body sheet (skin UV; overlay route) | 1,466–1,795 | – | 0.72–0.88 | 0.36–0.44 | 0.18–0.22 (reference install's overlay and skin) |
| Arm (skin UV) | 642–718 | 0.63–0.70 | 0.31–0.35 | 0.16–0.18 | – |

Sizes on disk with a full mip chain, per colour texture with alpha (`TCM_QualityColor`, one byte per texel [hypothesis for the format the cooker picks]): 1024² ≈ 1.3 MiB, 2048² ≈ 5.3 MiB, 4096² ≈ 21 MiB, 8192² ≈ 85 MiB. The overlay guide's advice is that 2048² is almost always enough and larger maps belong in an optional download [wiki: [overlay tattoo guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/modding-guides/npcs/custom-tattoos-and-scars/how-to-create-an-overlay-tattoo.md), Yggnire].

## 10. What the Studio draws today

Face tattoos render through the head-decal family and body tattoos through the body's decal path, both from the resolver's output and in the V's tone ([head CC rendering §3](head-cc-rendering.md#3-the-head-decal-family), [body rendering §4](body-rendering.md#4-how-the-studio-draws-the-body)). Overlay tattoos render only as far as the skin adapter reads the framework's `SecondaryAlbedo` ([materials §4.1](materials-and-shaders.md#41-basematerialsskinmt-and-skin_blendable-skin_morph)). The design for authoring and exporting XF tattoos is in the [tattoos brief](../research/character-customization/tattoos-brief.md).

## Open questions

1. Do body tattoo meshes 02–05 share mesh 01's footprint (a shared canvas) or have their own?
2. What orders two `EMP_Normal` decals that overlap (tattoo against scar, blush or eye makeup)? ([head CC rendering open question 2](head-cc-rendering.md#open-questions))
3. How does the male garment tattoo stay on the body: the garment assembler, and with what offset?
4. What happens to a body tattoo's forearm part when arm cyberware replaces the forearm?
5. Why is the body tattoo lifted about 1 mm but the face tattoo 0.2 mm: body-shape morphs and garment squash, or depth precision at body scale?
6. Does a CCXL option joining `body_tattoo` need all 12 tone definitions to follow `skin color` cleanly, or can one definition serve every tone?
7. Does a garment that hides body chunks with `hide_Chest` (not `hide_Torso`) leave the vanilla body tattoo floating over the hidden area, clipping through the garment?

## In-game test asks

Batch into one prepared session; record game, ArchiveXL and the texture framework in use.

1. **Order.** Female V, creator face tattoo 08 (`facial_tattoo_02`, the large design), eye makeup 5 (black) and blush 10: a close-up where the tattoo meets the cheek and lower lid. Which draws on top?
2. **Overlay under decal.** With the enabled KS UV overlay, choose body tattoo 01: the vanilla decal should draw over the overlay where they overlap (torso, thighs).
3. **Cyberarm.** Body tattoo 01, then equip Gorilla Arms or Mantis Blades: does the forearm ink stay on the cyberarm, float or vanish?
4. **Tags.** Use garments whose `.app` definitions carry the tags (mod items; vanilla definitions carry none). Body tattoo 01 with a garment that hides only the chest (`hide_Chest`), then one with `hide_Torso`: in the first the leg and arm ink should stay; in the second all of it should vanish.
5. **Strength.** Creator face tattoo 09 (`facial_tattoo_03`, tone instance, alpha 0.6) and 02 (`facial_tattoo_07`, local alpha 0.7) on a pale and a dark V under one light: the ink should read as partly transparent on both, slightly stronger for 02.

## Related pages

[CC file chain](cc-file-chain.md) · [V's body](body-rendering.md) · [Head CC rendering](head-cc-rendering.md) · [Face makeup](face-makeup.md) · [Worn clothing](clothing.md) · [Materials and shaders](materials-and-shaders.md) · [Tattoos brief](../research/character-customization/tattoos-brief.md)
