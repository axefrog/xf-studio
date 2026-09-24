# Recognizable makeup finish families — 2026-09-23

The project requires familiar categories rather than arbitrary legacy labels. Current menu:

| Family | Intended visual distinction | Current browser candidate |
|---|---|---|
| Matte | Low shine, soft colour | Rough non-metallic surface |
| Satin | Gentle sheen without distinct sparkle | Smooth non-metallic surface; internal `regular` |
| Shimmer / pearl | Fine reflective sheen | Fine facet study, not yet a calibrated pearlescent pigment |
| Metallic / foil | Strong continuous reflective finish | Smooth partially metallic study; never an alias for shimmer |
| Glitter | Individually visible reflective flecks | Seeded coarser facets; dark speckling and distant filtering need work |
| Glossy / wet look | Smooth wet-looking reflection over colour | Non-metallic colour + clearcoat |
| Colour-shifting | Angle-dependent hues; includes duochrome and multichrome | Thin-film iridescence study; no chosen two-colour/multi-colour pigment control yet |

These are practical editor families, not a universal cosmetics standard. Brands overlap terms, and metallic, shimmer and gloss can coexist. Pearl is grouped with shimmer and foil with metallic to avoid duplicate first-level choices; those may warrant presets/subtypes as fidelity improves. Colour shift is conceptually independent of surface texture and could become a modifier later. Do not label our fixed thin-film study as an accurate arbitrary duochrome/multichrome implementation. Powder/cream/liquid describe formulas; eyeliner/eyeshadow describe use; smoky/cut-crease describe designs. Keep those separate from finish.

Primary sources inspected:

- [MAC eye shadow](https://www.maccosmetics.com/products/small-eye-shadow): satin soft sheen distinction.
- [Charlotte Tilbury Queen of Glow](https://www.charlottetilbury.com/eu/product/luxury-palette-the-queen-of-glow): satin-matte, shimmer and metallic vocabulary.
- [Urban Decay Moondust](https://www.urbandecay.com/247-moondust-eyeshadow/ud1051.html): microfine glitter/shimmer terminology overlaps.
- [Danessa Myricks Colorfix Glazes](https://danessamyricksbeauty.com/collections/colorfix-glaze): glossy translucent toppers and standalone gloss, including shimmer-containing gloss.
- [Natasha Denona I Need a Warm](https://natashadenona.com/collections/midi-eyeshadow-palettes/products/i-need-a-warm-eyeshadow-palette): metallic, sparkling foil, duochrome and multichrome among stated finishes.

Renderer implementation: [Three MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) provides clearcoat and angle-dependent thin-film iridescence. All eye-plate materials now use that subclass with the full eight-influence skin adapter. Gloss: roughness .16, metalness 0, clearcoat 1 / roughness .08. Colour shift: roughness .27, metalness .65, iridescence 1, IOR 1.3 and constant 400 nm thickness. Values are exploratory choices, not measured makeup optical parameters or proven REDengine equivalents. Other materials reset these lobes to zero.

Existing recipes remain supported, including the `satin` alias for `regular`. Metallic retains its identity. New IDs are `glossy` and `iridescent`. Export mask remains coverage-only; game-side compilation must separately represent reflectance. Experiment 003's ten materials remain its historical four-finish fixture, not evidence that the new seven families work in-game.

Required research: distinct finish reference comparisons; authentic pearl and selectable duochrome/multichrome pigment responses; gloss coverage/stacking; mixed-finish preset compilation; matched game/browser variants in one batched runtime session. Emissive/neon fantasy effects are a separate potential expansion, not needed to complete this familiar cosmetics list.
