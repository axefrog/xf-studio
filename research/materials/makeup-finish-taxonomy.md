# Recognizable makeup finish families — 2026-09-23

The project requires familiar categories rather than arbitrary legacy labels. Current menu:

| Family | Intended visual distinction | Game export route | Browser preview |
|---|---|---|---|
| Matte | Low shine, soft colour | Flat decal, roughness 1.0 (provisional; 0.88 until 27 September, [decal reference §10](shader-decal.md#10-recommended-changes-ranked)) | Same values |
| Satin | Gentle sheen without distinct sparkle | Flat decal, roughness 0.38; internal `regular` | Same values |
| Shimmer / pearl | Fine reflective sheen that sparkles close up | **Experimental**: facet normal map composed with the skin normal, variance-widened roughness mips ([design](finish-designs/shimmer.md)) | Game-matched model follows the route; earlier layers keep the fine-facet study |
| Metallic / foil | Strong continuous reflective finish | Flat decal, roughness 0.27, metalness 0.65; never an alias for shimmer | Same values |
| Glitter | Individually visible reflective flecks | **None**: preview only; resolved glint-flake route proposed ([design](finish-designs/glitter.md)) | Opt-in glitter studies (recipes 7–10) |
| Glossy / wet look | Smooth wet-looking reflection over colour | **Experimental**: one low-roughness dielectric lobe (0.12), no clear coat ([design](finish-designs/glossy.md)) | Game-matched model: the same single lobe; earlier layers keep the clear-coat study |
| Colour-shifting | Angle-dependent hues; includes duochrome and multichrome | **Experimental** duochrome only: one additive Fresnel shift colour per preset ([design](finish-designs/colour-shifting.md)) | Game-matched model: the same Fresnel term with a chosen shift colour and strength; earlier layers keep the thin-film study |

These are practical editor families, not a universal cosmetics standard. Brands overlap terms, and metallic, shimmer and gloss can coexist. Pearl is grouped with shimmer and foil with metallic to avoid duplicate first-level choices; those may warrant presets/subtypes as fidelity improves. Colour shift is conceptually independent of surface texture and could become a modifier later. Do not label our fixed thin-film study as an accurate arbitrary duochrome/multichrome implementation. Powder/cream/liquid describe formulas; eyeliner/eyeshadow describe use; smoky/cut-crease describe designs. Keep those separate from finish.

Primary sources inspected:

- [MAC eye shadow](https://www.maccosmetics.com/products/small-eye-shadow): satin soft sheen distinction.
- [Charlotte Tilbury Queen of Glow](https://www.charlottetilbury.com/eu/product/luxury-palette-the-queen-of-glow): satin-matte, shimmer and metallic vocabulary.
- [Urban Decay Moondust](https://www.urbandecay.com/247-moondust-eyeshadow/ud1051.html): microfine glitter/shimmer terminology overlaps.
- [Danessa Myricks Colorfix Glazes](https://danessamyricksbeauty.com/collections/colorfix-glaze): glossy translucent toppers and standalone gloss, including shimmer-containing gloss.
- [Natasha Denona I Need a Warm](https://natashadenona.com/collections/midi-eyeshadow-palettes/products/i-need-a-warm-eyeshadow-palette): metallic, sparkling foil, duochrome and multichrome among stated finishes.

Renderer implementation: every eye-plate layer is a [Three MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) with the full eight-influence skin adapter. **Game-matched models** (recipe schema `xfs/recipe-11`, layer `optics`) follow the export routes: Glossy is one lobe at roughness 0.12 with no clear coat; Shimmer uploads the export route's faded facet normals and widened roughness mips; Colour-shifting adds the shift colour × 2 × strength × saturate(|1 − N·V|²) to the base colour before lighting, at roughness 0.32 and metalness 0.08 (0.25 until 27 September: below 0.1 the covered skin keeps its subsurface scattering). Choosing one of these finishes uses its game-matched model. **Earlier studies** stay pinned on layers made before it: Gloss with roughness .16, metalness 0 and clear coat 1 / roughness .08; Colour shift with roughness .27, metalness .65 and thin-film iridescence (IOR 1.3, 400 nm). The earlier values were exploratory, not measured makeup optics; the game-matched values are provisional choices inside proven engine routes, not measured either.

Existing recipes remain supported, including the `satin` alias for `regular`. Metallic retains its identity. Experiment 003's ten materials remain its historical four-finish fixture. The [finish board](../../experiments/016-finish-board/README.md) is the first package meant to show these families side by side in game; nothing here has been observed there yet.

Required research: distinct finish reference comparisons; authentic pearl and multichrome pigment responses; a second gloss lobe (the `eye_shadow` shell); colour shift inside mixed presets; glitter beyond resolved facets; the finish board's runtime session. Emissive/neon fantasy effects are a separate potential expansion, not needed to complete this familiar cosmetics list.
