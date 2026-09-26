# Face makeup: cheeks, and how face decals combine

**Maturity: Draft.** Consolidated from the vanilla 2.31 cheek resources (female first), the other vanilla face-decal meshes, the installed face-makeup mods, the Modding Docs and a read-only audit of the Studio's makeup engine, all on 26 September 2026. Nothing here has runtime evidence of its own. Evidence grades follow the [knowledge rules](README.md): **[source]**, **[resource]**, **[wiki]**, **[runtime]**, **[hypothesis]**. Provenance, hashes and measurements are in the [brows and cheeks evidence](../research/character-customization/brows-cheeks-evidence.md).

This page covers vanilla cheek makeup (blush, freckles and the metallic cheek colours), how face decals share the face and combine, how mods add face makeup, and how the head's UV layout constrains a Studio cheek feature. Per-option templates for every head decal are tabulated in [head CC rendering §1](head-cc-rendering.md#1-every-head-option-at-a-glance); decal shader arithmetic is in [materials and shaders §2.4 and §4.5](materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it); brows have their own page, [eyebrows](brows.md). The design options built on these facts are in the [brows and cheeks brief](../research/backlog/brows-and-cheeks-brief.md).

## 1. Vanilla cheek makeup

| Step | Vanilla female | Grade |
|---|---|---|
| Creator option | Switcher `makeupCheeks` (Off + 24) → appearance options `makeupCheeks_01…24` in slot `makeupCheeks_color`, link `makeupCheeks color`. Choices 1–4 are freckles (4 colours), 5–24 blush `makeup_cheeks_01…20` (16 colours). Group `face` (and `character_customization`). | [resource] [wiki] |
| `.app` | `…\appearances\head\makeup_freckles\hx_000__basehead_makeup_{freckles,cheeks}_NN.app` | [resource] |
| Geometry | **One shared mesh for every freckle and blush style**: `…\h0_000_pwa_c__basehead\hx_000_pwa_c__basehead_makeup_freckles_01.mesh` with `hx_000_pwa__morphs_makeup_freckles_01.morphtarget`; two chunks, face and nose (§2) | [resource] |
| Material chain | mesh local instance → `makeup\freckles\<colour>\cheeks__NN_<colour>.mi` (style: `DiffuseTexture` `hx_makeup_NN.xbm`, often a per-style alpha or colour tweak) → `cheeks_color__KK_<colour>.mi` (colour: `DiffuseColor`, a default alpha 1–3, `AlphaMaskContrast` 0, `DepthThreshold` 0.5, white `SecondaryMask` at influence 0, identity UV transform, normal alpha 0) → `base\materials\mesh_decal.mt` (`EMP_Normal`) | [resource] |
| Textures | One mask per style, not an atlas: white RGB with coverage in alpha, each covering both cheek islands and the nose. Cooked **one mip below their header size**: 256² for most styles, 512² for styles 11, 12, 16, 17, 18 and `13a`. Freckles `hx_freckles_makeup_01…04` (256, 512, 512, 512). 21 diffuse masks plus two metal masks. | [resource] |

**Strength varies per look** [resource]. `DiffuseAlpha` is not a fixed 2: over the 640 blush chunk materials it is 2 in 204, 3 in 162, 1 in 96 and 0.5–4 in the rest, because the masks are faint (style 01's alpha peaks at 0.31) and the alpha multiplies them before the coverage clamp. Freckles use `DiffuseAlpha` 0.3–1.0 and `DepthThreshold` 0.9975.

**Vanilla already has a metallic, highlighter-like blush** [resource]. It corrects the earlier statement that cheeks write no normal or roughness:

| Looks | Surface write |
|---|---|
| Gold and silver, all 20 blush styles | White `MetalnessTexture`, `RoughnessMetalnessAlpha` 0.1–1 (metal from `white.xbm` or the masks `hx_makeup_m08`/`m16`), roughness from `engine\textures\editor\hairdefault_u.xbm` (4 × 4, R = 129, flagged sRGB: 0.51 read raw, about 0.22 if the sampler decodes it [hypothesis]) |
| Silver | Also `NormalAlpha` 0.6 of the flat `normal.xbm`, blending mode 0.5 |
| Style 16, every colour | The `m16` metal mask at surface alpha 0.4 |
| Styles 15 and 17, most colours | Surface alpha 0.1 plus normal alpha 0.6 |

Everything else is colour only and keeps the skin's roughness. There is no vanilla contour, bronzer or separate highlighter resource [resource, name search of the four appearance archives].

**What the looks are** [wiki]. The character-creator cheat sheet's screenshot `character_creator_cheek_makeup_options.png` ([page](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-character-creator.md), manavortex with an update by nutboy) shows freckles over cheeks and nose (01–04) and blush that is as much face paint as blush: soft cheek washes, a band across the nose bridge (07), hard-edged panels (11, 12) and stars (14). The page's counts (Off + 14) predate 2.31's 24.

## 2. The vanilla face-decal meshes

Every vanilla face decal is a copy of head vertices lifted along the head's normals and skinned with the head's weights; each has one LOD [resource] ([materials §2.4 item 6](materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it)). What differs is the footprint, the lift and the UV layout:

| Mesh | Footprint | Lift | UV layout | Density (mm per UV unit) | Vanilla texel |
|---|---|---|---|---|---|
| Eye makeup `hx_000_pwa_c__basehead_makeup_eyes_01` | Lids and surrounds, both eyes | 0.40 mm | Own; both eyes overlap | 66 | 0.065 mm at 1024 |
| Cheeks chunk 0 (face) `…makeup_freckles_01` | Both cheeks, from just under the eyes downward: 890 vertices, 9,775 mm² | 0.40 mm | Own; both cheeks share one area, u 0.352–0.987, v 0.201–0.857 | 153 (u 175, v 136) | about 0.6 mm at 256², 0.3 mm at 512² |
| Cheeks chunk 1 (nose) | Nose from brow level to the tip: 443 vertices, 1,888 mm² | 0.40 mm | Own, one island, u 0.013–0.508, v 0.079–0.627 | 127 | as above |
| Brows `heb_000_pwa_c__basehead` | Brow strip: 390 vertices, 2,508 mm² | **0.35 mm** | Own; both brows share one area | 48.6 | 0.14 mm at 512 × 256 |
| XF Studio expanded eye plate | Lids, brows, upper cheeks: 1,620 vertices, 3,010 faces | 0.40 mm (Build) | **Head UV0**, window u 0.273–0.727, v 0.179–0.324 (glTF) | 405–569 | 0.13 × 0.12 mm through the 2048 × 512 window |

The freckles mesh has no forehead or temple coverage. Its face chunk also carries 16 face-cyberware appearances (designs 01–08 through `cyberware__NN.mi` with normals and surface writes) and a `metal_base.remt` `default` appearance [resource], which is why face cyberware and cheek makeup can share geometry ([CC file chain §4](cc-file-chain.md#4-every-cc-detail-and-what-drives-it)).

**The same regions in head UV0** (glTF V, measured by matching each decal vertex to its head vertex) [resource]:

| Region | Head UV0 bounds | Density there | Inside the eye plate's faces |
|---|---|---|---|
| Brows | u 0.316–0.684, v 0.173–0.248 | 418 mm/UV | 89 % of brow vertices |
| Cheeks (face chunk) | u 0.283–0.717, v 0.210–0.405; left and right sides are separate (u < 0.473 and > 0.527) | 509 mm/UV (u 589, v 459) | 58 % of cheek vertices (the upper cheek and cheekbone) |
| Nose (nose chunk) | u 0.426–0.574, v 0.173–0.337 | 420 mm/UV | 11 % |

Head UV0 is not mirrored, so anything cut in head UV0 is left/right independent, unlike the vanilla cheek and brow meshes.

## 3. How face decals combine

- **Separate draws, one blend each** [source] [resource]. Eye makeup, lipstick, cheeks, pimples, scars, tattoos, face cyberware and brows are separate components, each its own `post_gbuffer` decal draw. Each blends its colour into the G-buffer in square-root space (`SrcAlpha/InvSrcAlpha` on `√colour`), its roughness and metalness linearly under **one shared alpha** (a decal that writes roughness also blends metalness towards its own value), and its normal by its own mode; the deferred light then shades the combined pixel once, as Subsurface skin ([materials §2.4](materials-and-shaders.md#24-what-a-post_gbuffer-decal-does-to-the-pixel-under-it), [decal reference §6](../research/materials/shader-decal.md#6-what-the-pixel-under-a-decal-ends-up-with)). Where two decals overlap, the later one blends over the earlier result.
- **Coverage curves differ by template** [source]. `mesh_decal` and `mesh_decal_double_diffuse` square their (filtered) coverage, so their masks store √coverage; the gradient-recolour family (hair caps, the Colour-shifting route) uses linear coverage. A feature that mixes templates on one face must encode each mask for its own template ([decal reference §2.1](../research/materials/shader-decal.md#21-templates)).
- **How CDPR calibrates makeup finishes** [resource]. Matte is a partial push to roughness 1.0 (lipstick, 35–40 % surface weight); gloss keeps the skin's roughness (glossy lipstick adds only metalness 1 at 5 %); metallic is metalness 1 at roughness ≈ 0.51 (gold and silver blush); eye makeup is 0.50 at full weight with noise-broken coverage. Cheek finishes on a Studio plate can start from these ([decal reference §3](../research/materials/shader-decal.md#3-instance-chains-on-the-player)).
- **Order** [resource] [hypothesis]. Every vanilla face decal is `EMP_Normal`; the order between decals of one priority is unknown ([head CC rendering open question 2](head-cc-rendering.md#open-questions)). The preview's fallback is the creator option order, then the Studio's authored plate on top. The lifts (0.40 mm for makeup, 0.35 mm for brows) keep each decal clear of the skin for the depth test; they do not decide order, because decals do not write depth.
- **Overlaps that matter** [resource]. The cheek face chunk starts just under the eyes and overlaps the eye-makeup surrounds and the eye plate's lower edge (58 % of cheek vertices lie inside the plate's faces); the nose chunk runs up to brow level. Lipstick does not overlap the cheeks.
- **Metal switches off skin SSS** [source]. A pixel whose blended metalness exceeds 0.1 skips the subsurface blur. The vanilla gold, silver and style-16 blush looks cross that line at their soft edges, which makes them a natural in-game check of the seam ([materials open question 4](materials-and-shaders.md#7-open-questions)).
- **Consumer group** [resource] [runtime]. Cheeks, eye makeup, lips and piercings are `face`-group options; brows are head (`TPP`) options. An XF eye-makeup option that sat only in `character_customization` showed in the creator but not in photo mode ([CC file chain §2](cc-file-chain.md#groups-who-consumes-a-choice-resource)).

## 4. How mods add face makeup

No installed mod adds cheek makeup through the character creator, extends `makeupCheeks`, or adds a cheek selector; the installed face-makeup mods are all eye or lip products [resource] ([evidence](../research/character-customization/brows-cheeks-evidence.md#installed-mods-inspected)). Three routes are in use:

| Route | Example | Mechanism | Trade-off |
|---|---|---|---|
| **Worn item** | KOZMETIX by meluminary (lips, liner); Limerence × AllieKat Winterkissed (glitter eyeshadow) | A TweakXL clothing item (`Items.GenericFaceClothing`) in an outfit or Equipment-EX face slot, whose entity draws a decal mesh. KOZMETIX ships no geometry: `resource.patch` merges material-only meshes into the vanilla lip and eye-makeup meshes, `resource.link` aliases its morph paths to the vanilla makeup morphs, and a visual tag hides the vanilla lipstick's chunks. Colours come from one `@dynamic` material with a `{material}` shade path. | Combines with any creator look and can be changed in the wardrobe; is not part of the creator, the save's appearance node or photo-mode face presets |
| **Same-path replacement** | Limerence Liners, Alliekat's Eyeshadow Remix, Arkhe's brow Material Edit | Ships vanilla depot paths for masks or `.mi` files | Replaces vanilla looks for V and NPCs; conflicts per path |
| **CCXL option** | (eye colours, brows, hair; no cheek example installed) | Named merge into a vanilla switcher, or a new option | Part of the creator and the save; the wiki's [CCXL overview](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/README.md) (manavortex and redacted-c01; edited by icxrus) lists `makeupCheeks` / `makeupCheeks_color` among the established switchers and recommends extending them [wiki] |

The wiki's [scopes and extensions guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/be2f44eed8419342ec13f72ed9cab008e9f7b289/for-mod-creators-theory/core-mods-explained/archivexl/archivexl-character-creator-additions/ccxl-theory-scopes-and-extensions.md) (manavortex) shows the makeup pattern for colour extension (`@context` `MakeupBaseMaterial`, `@makeup` → `*…\{material}.mi`, one small colour `.mi` each) and warns that several styles in one mesh block later colour extension [wiki]. Vanilla cheeks are exactly that non-extensible shape: 24 styles on one mesh.

## 5. What this means for a Studio cheek feature

| Fact | Implication |
|---|---|
| The layered-makeup engine (recipe, raster, compiler, finishes) works in head UV0 and cuts plates from head faces by native face ID | A **cheek plate** is a new plate recipe with the same lift and skin-byte rules; nothing in the engine is eye-only except the plate recipe, the 2048 × 512 window, starter shapes, the default UV view, the single plate in the scene and the hard-wired `u → 1 − u` mirror ([evidence, Studio audit](../research/character-customization/brows-cheeks-evidence.md#studio-audit-read-only)). |
| The cheeks span u 0.283–0.717, v 0.210–0.405 in head UV0 at about 589 × 459 mm per UV unit | A 2048 × 1024 window over that rectangle gives about **0.13 × 0.09 mm per texel**, the eye plate's density and four to seven times finer than most vanilla blush (two to three times the 512² styles); 2048 × 512 gives 0.13 × 0.18 mm. |
| The vanilla freckles mesh has its own mirrored UV at 153 mm/UV | Authoring on it needs a head-UV → cheek-UV resample at Build, is symmetric by construction and cannot reach temples, forehead or jaw; at 1024² it gives about 0.17 × 0.13 mm. No new geometry. |
| 58 % of the cheek lies inside the eye plate already | Cheekbone highlight and under-eye colour are drawable today on the eye plate; a separate cheek plate that overlaps it meets the unknown same-priority order in game. A cheek plate cut from faces **outside** the eye plate avoids the overlap but splits looks along the plate edge. |
| Vanilla gold, silver and style-16 blush write metalness and roughness | Engine precedent for Satin, Metallic and Shimmer highlighter on cheeks with the same `mesh_decal` routes as the eye plate. |
| The Colour-shifting route's template has no UV transform | On cheeks it stays on the 1024 head atlas, about 0.58 mm per texel; that suits a soft duochrome wash, not a sharp edge. `mesh_decal_blendable` has the same Fresnel term with the UV transform and squared coverage, so moving the route there would give cheeks the window's density too ([decal reference §5.2](../research/materials/shader-decal.md#52-the-fresnel-colour-mesh_decal_blendable-_gradientmap_recolor_blendable)). |
| Dark partial coverage blends in square-root space (≈ 2a − a² for dark over skin) | Contour and bronzer need gentler coverage than a linear painter suggests; the preview already blends this way. |

## Open questions

1. Is `hairdefault_u.xbm` (flagged sRGB, R = 129) sampled decoded? It sets the vanilla metallic blush's roughness at about 0.51 or about 0.22.
2. What decides the draw order of two `EMP_Normal` face decals that overlap (cheeks and eye makeup under the eye; an XF cheek plate and the XF eye plate)?
3. Does the freckles mesh's `DepthThreshold` 0.9975 on freckles (0.5 on blush) change how they sit near the nose and eye sockets?
4. Can a `face`-group CCXL option added to `makeupCheeks` carry a single authored definition (no colour row) cleanly in the creator UI?
5. What are the head UV0 bounds of the whole front face (forehead to chin), for sizing a whole-face plate?

## In-game test asks

Batch into one prepared session; record game, ArchiveXL and whether Phantom Liberty is installed.

1. **Metallic blush.** Creator, blush style 5 in gold, then silver, then brown: under a light moved across the face, gold and silver should show a moving highlight and brown none. Close-up of the soft edge for a visible SSS seam where metalness crosses 0.1.
2. **Cheek over eye makeup.** Eye makeup style 5 black with blush style 10 (a colour contrasting with black): capture the band just under the lower lid to see which draws on top.
3. **Blush strength.** Blush style 5 (alpha 3) and style 1 (alpha 1) in the same colour: one frontal frame each under fixed light, to anchor the preview's alpha clamp.

## Related pages

[Eyebrows](brows.md) · [Head CC rendering](head-cc-rendering.md) · [CC file chain](cc-file-chain.md) · [Materials and shaders](materials-and-shaders.md) · [Glitter in game](glitter-in-game.md) · [Evidence](../research/character-customization/brows-cheeks-evidence.md) · [Brows and cheeks brief](../research/backlog/brows-and-cheeks-brief.md)
