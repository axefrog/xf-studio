# Recognizable makeup finish families — 2026-09-23

The project requires familiar categories rather than arbitrary legacy labels. Current menu:

| Family | Intended visual distinction | Game export route | Browser preview |
|---|---|---|---|
| Matte | Low shine, soft colour | Flat decal, roughness 1.0 (provisional; 0.88 until 27 September, [decal reference §10](shader-decal.md#10-recommended-changes-ranked)) | Same values |
| Satin | Gentle sheen without distinct sparkle | Flat decal, roughness 0.38; internal `regular` | Same values |
| Shimmer / pearl | Fine reflective sheen that sparkles close up | **Experimental**: *shimmer-grain-2*, one-texel pearl specks on nearly every texel (tilted 13–18°, glossy, slightly metallic) over a rougher satin base, with variance-widened roughness mips ([design](finish-designs/shimmer.md)). In game the facet bake was a static grid of oversized dots, and *shimmer-grain-1* read as glossy vinyl (session 6). Grain-2 has not been in game | Game-matched model follows the route; earlier layers keep the fine-facet study |
| Metallic / foil | Strong continuous reflective finish | Flat decal, roughness 0.27, metalness 0.65; never an alias for shimmer | Same values |
| Glitter | Individually visible reflective flecks | **None**: preview only. The resolved glint-flake route is built as a diagnostic board; board 1 looked "printed", board 2 (*glitter flakes 2*, the Studio's glint models above the fade) awaits session 7 ([design](finish-designs/glitter.md)) | The glint models (direct-light by default, clustered, dense fine); the classic and irregular studies with research tools |
| Glossy / wet look | Smooth wet-looking reflection over colour | **Experimental**: one low-roughness dielectric lobe (0.12), no clear coat ([design](finish-designs/glossy.md)) | Game-matched model: the same single lobe; earlier layers keep the clear-coat study |
| Colour-shifting | Angle-dependent hues; includes duochrome and multichrome | **Experimental** duochrome only: one additive Fresnel shift colour per preset ([design](finish-designs/colour-shifting.md)) | Game-matched model: the same Fresnel term with a chosen shift colour and strength; earlier layers keep the thin-film study |

**Working physical definitions** (agreed in session 6, 29 September 2026). They separate the two sparkle finishes by what the particles are, not by brand vocabulary:
- **Shimmer:** dense, fine pearl platelets lying mostly flat. A coherent sliding sheen, faint pinpoints up close and a slight interference tint.
- **Glitter:** sparse, larger flakes at random angles. Each flashes individually as its angle aligns.

In the game's decal both are limited by the same engine facts: one normal per pixel, and no normal written below about 11.5° of tilt ([decal reference §9.2](shader-decal.md#92-shimmer-reads-as-a-soft-gloss)). So Shimmer's platelets tilt just above that, densely, and Glitter's flakes are resolved (at least two texels) and tilted well above it.

These are practical editor families, not a universal cosmetics standard. Brands overlap terms, and metallic, shimmer and gloss can coexist. Pearl is grouped with shimmer and foil with metallic to avoid duplicate first-level choices; those may warrant presets/subtypes as fidelity improves. Colour shift is conceptually independent of surface texture and could become a modifier later. Do not label our fixed thin-film study as an accurate arbitrary duochrome/multichrome implementation. Powder/cream/liquid describe formulas; eyeliner/eyeshadow describe use; smoky/cut-crease describe designs. Keep those separate from finish.

Primary sources inspected:

- [MAC eye shadow](https://www.maccosmetics.com/products/small-eye-shadow): satin soft sheen distinction.
- [Charlotte Tilbury Queen of Glow](https://www.charlottetilbury.com/eu/product/luxury-palette-the-queen-of-glow): satin-matte, shimmer and metallic vocabulary.
- [Urban Decay Moondust](https://www.urbandecay.com/247-moondust-eyeshadow/ud1051.html): microfine glitter/shimmer terminology overlaps.
- [Danessa Myricks Colorfix Glazes](https://danessamyricksbeauty.com/collections/colorfix-glaze): glossy translucent toppers and standalone gloss, including shimmer-containing gloss.
- [Natasha Denona I Need a Warm](https://natashadenona.com/collections/midi-eyeshadow-palettes/products/i-need-a-warm-eyeshadow-palette): metallic, sparkling foil, duochrome and multichrome among stated finishes.

Renderer implementation: every eye-plate layer is a [Three MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) with the full eight-influence skin adapter. **Game-matched models** (recipe schema `xfs/recipe-11`, layer `optics`) follow the export routes: Glossy is one lobe at roughness 0.12 with no clear coat; Shimmer bakes the export's grain and uploads its faded normals and widened roughness mips; Colour-shifting adds the shift colour × 2 × strength × saturate(|1 − N·V|²) to the base colour before lighting, at roughness 0.32 and metalness 0.08 (0.25 until 27 September: below 0.1 the covered skin keeps its subsurface scattering). Choosing one of these finishes uses its game-matched model. **Earlier studies** stay pinned on layers made before it: Gloss with roughness .16, metalness 0 and clear coat 1 / roughness .08; Colour shift with roughness .27, metalness .65 and thin-film iridescence (IOR 1.3, 400 nm). The earlier values were exploratory, not measured makeup optics; the game-matched values are provisional choices inside proven engine routes, not measured either.

Existing recipes remain supported, including the `satin` alias for `regular`. Metallic retains its identity. Experiment 003's ten materials remain its historical four-finish fixture. **In game** (feminine V, game 2.31), from the [finish board](../../experiments/016-finish-board/README.md#runtime-results) (25 September) and [session 3](../../experiments/028-session-3/README.md#5-results-28-september-2026) (28 September):
- Colour-shifting behaves as designed.
- Matte and Satin first read too glossy. Matte's roughness has since gone to 1.0, which hasn't been seen yet.
- Under the creator's soft light the flat finishes (Matte, Satin, Glossy, Metallic) barely separate, so their defaults wait for a controlled-light verdict.
- Metallic's ramp shows no angular highlights.
- Shimmer's facet bake showed a static field of dots rather than sparkle (sessions 3 and 4: a regular grid, far too large). Its replacement, a sparse fine grain over one glossy surface ([experiment 030](../../experiments/030-shimmer-grain/README.md)), "reads more like a glossy vinyl than a shimmer" (session 6, by hand under movable lights). It is rebuilt as dense specks over a satin base ([experiment 032](../../experiments/032-finishes-rework/README.md)) and stays experimental until that build is seen in game.
- Glitter's diagnostic board 1 (session 6) "doesn't seem much like glitter": its flecks looked printed on the base, with little light response. A third of its flakes sat under the decal's normal fade. Board 2 reproduces the Studio's glint models with every flake above the fade ([experiment 032](../../experiments/032-finishes-rework/README.md)).

Required research: distinct finish reference comparisons; authentic pearl and multichrome pigment responses; a second gloss lobe (the `eye_shadow` shell); colour shift inside mixed presets; glitter beyond resolved facets; the finish board's runtime session. Emissive/neon fantasy effects are a separate potential expansion, not needed to complete this familiar cosmetics list.
