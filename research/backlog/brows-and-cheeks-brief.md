# Eyebrows and cheek makeup: design brief

**Status: research and discussion brief, 26 September 2026. Nothing is built.** Eyebrows and cheek makeup are later features 2 and 3 in the [queue](README.md#later-features--discuss-with-the-maintainer-before-building-each), after piercings. Each is discussed with the maintainer before any editor, renderer or exporter work starts; the existing brow preview is not permission to build a brow editor. The facts behind this brief are on the [eyebrows](../../knowledge/brows.md) and [face makeup](../../knowledge/face-makeup.md) knowledge pages, with provenance in the [evidence note](../character-customization/brows-cheeks-evidence.md).

## What the research established

| Finding | Grade |
|---|---|
| **Vanilla brows are one mesh for all styles.** A brow style is three textures (`_d` 512 × 256, `_ds` 64 × 32, `_n` 512 × 256) on one shared 390-vertex strip of head triangles, lifted 0.35 mm and skinned with the head's face-rig weights. Both brows share one UV area, so vanilla brows are symmetric by construction. | [resource] |
| **Brow colour is one colour per brow**, taken from the hair cap's gradient file for the same colour name (35 names, identical to hair), sampled at a constant coordinate. Brow colour and hair colour are independent creator choices that share textures, not a link. | [resource] [source] |
| **Brows write more than colour**: a normal (0.4, blended onto the skin normal) and roughness ≈ 0.50. The Studio preview draws neither yet. | [resource] [source] |
| **Brow mods merge into the vanilla `eyebrows` switcher** (Arkhe's Beautiful EYEBROWS II, Even More Brows), inside ArchiveXL's bundled brow scope, whose dynamic `@brows` material gives every style the 35 hair colours and any installed hair-colour pack. No brow mod adds a selector. | [resource] [source] [wiki] |
| **Vanilla cheeks are one shared two-chunk mesh** (face and nose) with its own mirrored UV at about 0.6 mm per texel for most blush styles; 24 styles × up to 16 colours; blush strength varies (`DiffuseAlpha` 0.5–4). | [resource] |
| **Vanilla already ships a metallic blush.** Gold and silver in every style, and style 16 in every colour, write metalness and roughness; silver and styles 15/17 also write a flat normal. It is the engine's own precedent for a highlighter. | [resource] |
| **No installed mod adds cheek makeup through the creator.** Face-makeup mods are worn clothing items (KOZMETIX, Winterkissed) or same-path replacements. | [resource] |
| **The expanded eye plate already covers 89 % of the brow strip and 58 % of the cheek** (the cheekbone and under-eye). Brow makeup and cheekbone highlight are paintable on the eye plate today; a brow *replacement* is not, because a decal cannot remove the brow beneath it. | [resource] |
| **The layered-makeup engine is region-generic underneath.** Recipes, raster, compiler and finishes work in head UV0, and the plate cut takes any face list. What is eye-specific: the plate recipe, the 2048 × 512 window, starter shapes, the default UV view, the single plate in the scene, the hard-wired `u → 1 − u` mirror, and an exporter and verifier that assume one selector. | [source] |

## Eyebrows

### What a brow designer could author, and what each costs

| Capability | How it would reach the game | Cost |
|---|---|---|
| **Shape and hair pattern** (outline, arch, tail, hair strokes with direction, length, taper, density, jitter) | Painted into the style's `_d` (hair coverage), `_ds` (soft powder underlay) and `_n` (hair relief derived from the strokes) | Per style: at 2048 × 1024, as Arkhe ships (0.035 mm per texel, hair-by-hair), about 2.7 MiB per BC7 map with mips, so about 5.3 MiB for `_d` and `_n`; at vanilla 512 × 256 (0.14 mm, painted look) about 0.35 MiB. No per-colour cost |
| **Density and softness** | Stroke count and the `_ds` underlay; `SecondaryDiffuseAlphaIntensity` | None beyond the texture set |
| **Colour: follow the creator's colour** (default) | Gradient via ArchiveXL's `@brows`; the creator's 35-colour row, plus installed hair-colour packs | Free |
| **Colour: authored tones or an ombre along the brow** | Baked into `_d` RGB with `UseGradientMap` 0 | The colour row no longer applies: one fixed look per definition |
| **Per-side asymmetry** | Needs a brow mesh whose two brows have separate UVs: either a UV-only variant of the vanilla strip (positions and skin bytes unchanged), or a cut in head UV0 (option B) | One shared mesh and morph for every XF brow style |
| **Shapes beyond the vanilla strip** (a higher arch, a longer tail toward the temple, a bold wide brow) | New geometry: a larger cut of head triangles, lifted like the vanilla brow | One shared mesh and morph; clearance and eyelid checks for the larger footprint |
| **3D hair** (strands standing off the skin) | Hair cards on `hair.mt`, like lashes | New geometry per style, card generation, skinning to 70 face joints and 105 morph targets each; a new render path in the preview |

### Design options

**A. Brow styles on the vanilla brow strip (texture sets).** Paint a style in the brow's own UV space (already mirrored, so both brows match), export `_d`/`_ds`/`_n` per style, and add each style as a choice in the vanilla `eyebrows` switcher through ArchiveXL's brow scope and `@brows` material, like Arkhe's and Even More Brows.

- For: the proven route of two installed mods; no geometry work, no clearance risk; the creator's 35 colours and every installed hair-colour pack work at once; highest texel density.
- Against: symmetric only; bound to the vanilla footprint; the painter needs a second UV space (the brow UV, not head UV0), so the engine's region abstraction must carry its own UV space and no mirror.

**B. A brow cut in head UV0 ("brow plate").** Cut a generous brow-area footprint from the head once, lift it 0.35 mm, keep head UV0 and use the eye plate's `UVScale`/`UVOffset` window (about 0.08 × 0.07 mm per texel at 2048 × 512); every XF brow style is a texture set on that one shared mesh, contributed to the `eyebrows` switcher as in A.

- For: per-side asymmetry and shapes beyond the vanilla strip; the painter stays in head UV0, so the eye-makeup engine's shapes, brushes, symmetry and UV view carry over almost unchanged.
- Against: new geometry (one shared cut, which must pass the plate's skin-byte and morph rules); whether the double-diffuse program honours the UV transform is unproven (brows knowledge open question 3); fallback is a larger texture over the head-UV rectangle.

**C. Strand-card brows on `hair.mt`.** Real 3D hairs, like lashes.

- For: the most convincing close-up brows.
- Against: an order of magnitude more work (cards, skinning, morphs, the hair k-buffer path in preview), new unknowns, and no vanilla or installed precedent for brows. Not recommended now.

**Recommended default: A first, built so that B can follow.** A ships the common case (a symmetric brow in the creator's colours) on the most proven route. Design the brow part and painter around a region that owns its UV space, so B's asymmetric and larger-footprint brows become a second region rather than a rewrite. Default the colour to "follow the creator's colour", with authored tones as an opt-in.

Before any brow export, the preview needs the brow's normal and roughness writes (move brows onto the face-decal family's double-diffuse member), and the painter needs the authored textures injected into the brow renderer.

### Selector

**No new selector.** XF brow styles are extra choices in the vanilla `eyebrows` switcher, in the `TPP`, `TPP_photomode` and `character_customization` head groups (brows are not `face` options). That keeps one brow row in the creator, as the "Selectors" rule asks and as every installed brow mod does. A separate selector would only make sense for something that must combine with *any* brow (a tint, gel or brow-bone highlight), and those are better as eye-makeup layers, which already reach the brow region. Brow slits and shaved gaps cannot be drawn over a vanilla brow and belong inside XF brow styles.

## Cheek makeup

### Design options

**A. A cheek plate in head UV0.** A second plate recipe cut from the head (cheeks and nose, optionally temples and jaw line), lifted 0.40 mm, with a 2048 × 1024 window over the cheek rectangle (u 0.283–0.717, v 0.210–0.405): about 0.13 × 0.09 mm per texel, the eye plate's density. The whole layered engine applies: shapes, falloff, symmetry, every finish route.

- For: any footprint, left/right independence, the full finish menu, one shared mesh for every look, and the eye-makeup editor's workflow unchanged.
- Against: new geometry (skin-byte and morph rules as for the eye plate; no eyelid gates, but its own clearance check); where it overlaps the eye plate (the cheekbone and under-eye band), the order between two XF decals is unknown in game (see open questions).

**B. Author on the vanilla freckles mesh.** Keep painting in head UV0 and resample onto the freckles mesh's own UV at Build; ship looks as extra appearances of that mesh (patched in, the way KOZMETIX patches lip shades into the vanilla lip mesh).

- For: no geometry at all; the vanilla footprint and lift.
- Against: symmetric only (both cheeks share one UV area); no temples, forehead or jaw; a resample at Build; about 0.17 × 0.13 mm per texel at 1024².

**C. One face plate for eye and cheek looks.** Extend the eye plate downward, or cut a whole-face plate, and author eye and cheek makeup as one look.

- For: no overlap-order question; one texture; the most freedom for looks that cross from eye to cheek (graphic liner, face paint).
- Against: changes the eye product and its proven plate (clearance gates, experiments 006/012/017); merges two features into one selector and one look, against the feature-module split and the one-mod-or-many rule; four times the texels per look for the whole face.

**Recommended default: A**, a separate cheek plate covering the whole cheek including the under-eye band, with the XF eye plate kept on top where they overlap. If the same-priority order proves unreliable in game, the eye plate can be drawn at a higher `materialPriority` through a copy of `mesh_decal` that differs only in priority, which the legacy XF generator shipped and the game rendered ([head CC rendering §3](../../knowledge/head-cc-rendering.md#3-the-head-decal-family)).

### Finishes on cheeks

| Finish | Cheek use | Transfer |
|---|---|---|
| Matte | Blush, bronzer, contour | Direct. Contour and bronzer need gentler coverage than a linear painter suggests (square-root blend) |
| Satin | Soft-focus blush | Direct |
| Metallic | Highlighter (strong) | Direct; vanilla gold and silver blush are the precedent. Large soft edges cross the 0.1 metalness SSS switch: test it |
| Shimmer | Highlighter (pearl) | Direct (faceted normal route), same open calibration as on the lids |
| Glossy | Dewy skin | Direct (one lobe) |
| Colour-shifting | Duochrome highlighter | Its template has no UV transform, so it stays on the 1024 head atlas (about 0.58 mm per texel): fine for a soft wash |
| Glitter | Body glitter | Guarded, as on the lids |

### Selector

The rule's default is **extra choices in the vanilla `makeupCheeks` switcher** (a `face` option), and nothing technical forces a custom selector: the cheek plate is geometry inside our own appearance, as the vanilla cheek looks carry theirs. Two shapes are possible: one new style per authored look (a one-swatch colour row), or one "XF" style whose colour row lists the looks. The trade-off the maintainer should decide is combinability: joining `makeupCheeks` means an XF cheek look **replaces** vanilla freckles and blush (one choice per switcher), while an own selector would let XF blush sit over vanilla freckles. The Studio could offer a freckle brush so that authored looks carry their own freckles.

## How both fit the feature-module platform

- **Two modules.** *Cheek makeup* reuses `engines/layered-makeup` with a region config (plate recipe, UV window, mirror axis, starter shapes, default view) and its own part, renderer and exporter, much like the platform's lip-makeup example. *Eyebrows* needs its own part (strokes, powder, colour mode, symmetry), a brow painter and renderer on the brow surface, and an exporter that emits the brow-scope resources.
- **Prerequisites.** The per-feature renderer (platform step 7: several plates or decal surfaces in the scene), the `FeatureExporter` contract (step 8), the `engines/layered-makeup` extraction, a region abstraction that owns its UV space and mirror, and a verifier that accepts more than one selector contribution. Platform step 5 has merged into `main` since this worktree branched; steps 7 and 8 are still open.
- **Packaging.** Merged by default: a collection with eye makeup, cheeks and brows builds one "XF Looks" mod; each feature can be split into its own XF-branded mod. Each feature keeps its own selector contributions (eye makeup its own selector; brows into `eyebrows`; cheeks into `makeupCheeks`) whether merged or split, and resources under `…/<key>/<feature>/` with `xfs_` names.
- **Documentation inconsistency to settle first.** The platform design's §6 says lip makeup joins the vanilla lipstick choices, while its §9 example gives lips "the lips selector" ([feature-module platform](../authoring/feature-module-platform.md#9-how-module-2-plugs-in)). Cheeks follow whichever rule is settled for lips.

## Decisions (26 September 2026)

1. **Brow scope:** symmetric texture styles on the vanilla strip (A) first; asymmetric and larger-footprint brows (B) follow.
2. **Brow colour:** XF brows follow the creator's colour row (35 hair colours plus installed packs); authored multi-tone brows are an opt-in; the Studio preselects the brow colour that matches the V's hair colour.
3. **Brow resolution:** hair-by-hair 2048 × 1024 by default, with a lighter 1024 × 512 option.
4. **Cheeks:** XF looks join the vanilla `makeupCheeks` row (they replace vanilla freckles and blush while chosen).
5. **Cheek plate footprint:** cheeks, nose, temples and jaw line; the under-eye band stays with the eye plate.
6. **Names:** split mods are "XF Brow Artistry" and "XF Cheek Artistry"; several features merged into one mod are "XF Looks".
7. **Editor reference:** an earlier first-party project's eyebrow editor is the starting point for the Studio's brow editor, adapted to this context. The proposal is the [brow editor design](../brows/brow-editor-design.md): a field-driven groom (outline, density centres, flow controls) rasterised into the brow's `_d`/`_ds`/`_n` set with greyscale tone so the creator's colour row still applies, a new `strand-field` engine and an `eyebrows` feature module, in six phases.

Still open: the §6/§9 lip selector wording (question 7 below).

## Questions for the maintainer

1. **Brows, scope of the first version:** symmetric texture styles on the vanilla strip (A) first, with asymmetric and larger-footprint brows (B) later, or asymmetry from the start?
2. **Brow colour default:** follow the creator's colour row (35 hair colours plus installed packs), with authored multi-tone brows as an opt-in? And should the Studio preselect the brow colour matching the V's hair colour?
3. **Brow resolution:** hair-by-hair 2048 × 1024 (about 5.3 MiB per style) or a lighter default?
4. **Cheeks, combinability:** join `makeupCheeks` (XF looks replace vanilla freckles and blush) or an own cheek selector (XF blush over vanilla freckles)? And, if joining, one style per look or one "XF" style with looks in the colour row?
5. **Cheek plate footprint:** cheeks and nose only, or also temples and jaw line for contour? Include the under-eye band that overlaps the eye plate?
6. **Names:** mod brands for the split case (suggested defaults "XF Brow Artistry" and "XF Cheek Artistry"; merged "XF Looks") and how XF choices are labelled in the creator's brow and cheek rows.
7. **Lip rule:** settle the §6/§9 selector wording for lips, which cheeks will follow.

## Runtime questions to batch into a future session

None needs a session now; add them to the prepared session in which the first brow or cheek build is tested. Each lists its knowledge page.

1. **Brow colour independence and gloss** ([eyebrows test asks 1–2](../../knowledge/brows.md#in-game-test-asks)).
2. **Brow against eye makeup order** ([eyebrows test ask 3](../../knowledge/brows.md#in-game-test-asks)).
3. **Metallic blush and the SSS seam; cheek against eye-makeup order; blush strength** ([face makeup test asks 1–3](../../knowledge/face-makeup.md#in-game-test-asks)).
4. **A merged XF brow style.** One XF test style in the `eyebrows` switcher: it appears after the vanilla styles, shows the 35-colour row, renders in the creator, gameplay and photo mode, and follows a brow-raising expression.
5. **A per-side UV brow variant.** The same style on a UV-only variant with separate left and right UVs (asymmetric test pattern): each side shows its own pattern and the brows deform as vanilla.
6. **A UV window on the double-diffuse template.** A brow cut with a `UVScale`/`UVOffset` window: the texture lands where the preview places it.
7. **A merged XF cheek look.** One XF look in `makeupCheeks`: position in the style row, colour-row behaviour, photo mode, and whether choosing it clears vanilla freckles.
8. **Two XF plates overlapping.** Eye and cheek looks with contrasting colours in the under-eye band, with both plates at `EMP_Normal`, then with the eye plate at front priority.

## Related

[Eyebrows](../../knowledge/brows.md) · [Face makeup](../../knowledge/face-makeup.md) · [Evidence](../character-customization/brows-cheeks-evidence.md) · [Feature-module platform](../authoring/feature-module-platform.md) · [Eye-makeup authoring](eye-artistry-authoring.md) · [Brow editor design](../brows/brow-editor-design.md) · [Jewellery construction set](../jewellery/construction-set-design.md) (the preceding feature's proposal)
