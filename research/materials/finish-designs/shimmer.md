# Shimmer / pearl

**Status:** experimental export (faceted decal), game-matched model only. First seen in game on 25 September: the default fine facets (128 cells, tilt 0.65) read as a diffused gloss rather than sparkle at photo-mode distances. [Experiment 017](../../../experiments/017-plate-depth/README.md) tests a stronger setting (64 cells, tilt 1.0) beside it.

## Intended look

A fine reflective sheen: many tiny reflective particles that sparkle individually when the eye is close and merge into a soft, luminous sheen at normal viewing distance ([finish taxonomy](../makeup-finish-taxonomy.md)). Pearl is grouped here. The supplied references show this transition: the copper reference 3 reads as a continuous reflective band, while the purple references show individual points only close up ([reference review](../glitter-reference-review.md), [manifest](../../backlog/glitter-visual-references.json)).

## Engine routes, ranked

| Rank | Route | Evidence | What it can and cannot do |
|---|---|---|---|
| **1 (implemented)** | `base/materials/mesh_decal.mt` with the classic Shimmer facet bake as a tangent normal map, `NormalAlpha` 1, `UseNormalAlphaTex` 0, **`NormalsBlendingMode` 1**, per-texel roughness/metalness from the same bake, and roughness mips widened by lost facet variance | Pixel program `16098255505177109230` (SHA-256 `35e8c18f…c3d`), decompiled: in mode 1 the program loads the existing G-buffer normal (`t74`), composes the decal normal with it by reoriented normal mapping in the plate's tangent frame, and writes normal alpha = `saturate(50 − 50·z) × NormalAlpha × DiffuseTexture.a`, where z = sqrt(1 − x² − y²) of the sampled map. In mode 0 it replaces the normal with alpha = `NormalAlpha × a`. [source] | Real, light- and view-dependent facet reflections where facets are larger than a pixel. Flat texels (z = 1) write **nothing**, so the skin's own normal detail survives between facets and wherever the preset has no Shimmer. One normal and one roughness per pixel: sub-pixel facets cannot keep separate reflections. |
| 2 | Flat sheen only: moderate roughness plus low metalness (a pearlescent single lobe) | Same program without a normal map. [source] | Matches the far-field look but loses all close-up sparkle, which is the finish's defining difference from Satin in photo mode. Kept as the fallback if facets misbehave. |
| 3 | Add a weak Fresnel tint (pearl interference) through `mesh_decal_gradientmap_recolor_blendable` | See [Colour-shifting](colour-shifting.md). [source] | Pearl's hue sheen, but it would force the whole preset through that template and its one-pigment rule. Not built. |

### The design decisions and why

- **Mode 1, not mode 0.** Mode 0 overwrites the skin normal under all covered makeup with the plate's smooth vertex normal, erasing pores and wrinkles. Mode 1 leaves flat texels untouched and composes tilted ones with the skin normal. This follows directly from the decompiled arithmetic.
- **The green-sign question does not matter here.** Experiment 011 left the tangent green sign untested. The Shimmer bake draws facet azimuths uniformly at random, so flipping green mirrors each facet but leaves the distribution of reflections unchanged. Individual facets may catch the light at a different angle from the preview; the shimmer statistics do not.
- **Mode 1 fades small tilts.** Alpha rises from 0 at a flat facet to 1 at about 11.5° of tilt (1 − cos θ = 0.02). The classic Shimmer bake tilts facets by up to `tilt × 0.4` rad (15° at the default 0.65), so most default facets are partly faded: on the finish board the mean mode-1 alpha over the fine patch is **0.19** at the base level. This is a real property of the route, and the preview now shows it.
- **Lower mips fade facets and widen the highlight.** Averaging facet normals shortens them, which raises the reconstructed z and fades them out (mean alpha 0.19 → 0.12 at the 256 level → 0.002 at 32 on the board's fine patch). The roughness mips add back the lost slope variance, α′² = ᾱ² + v with v = E[x² + y²] − |E[x, y]|² (a Toksvig/LEAN-style approximation), so distant shimmer becomes a broader sheen instead of flat Satin (board fine patch: 0.427 → 0.448 against 0.424 without widening). The same specification is restated in the independent verifier.

## What the preview does

The game-matched model uses the same flake bake but uploads route-filtered mip chains: every level fades facet tilts by the mode-1 alpha and lower levels widen roughness exactly as the export does ([`previewFacetChains`](../../../projects/xf-studio/authoring/src/route-mip-chains.ts)). Earlier layers keep Three's automatic mipmaps.

## Risks

- Facet orientation relies on the plate's tangent frame; tangents come from the head mesh bytes, but this is unobserved.
- Normal alpha follows the colour-map alpha (square-root coverage), so partly covered edges carry slightly more normal than colour.
- BC5 compression and mip selection at face distance: the fine pattern has no strong tilts left from the 256 level down, so at face framing Shimmer may look like a slightly broader Satin.
- The facet bake is a UV-cell lattice; see the Glitter page for its known visual weaknesses.

## Single most informative in-game test

On the finish board, **Board 2**: at a close photo-mode framing, rotate the key light across the left lid (Satin control | fine Shimmer | coarse Shimmer). Shimmer passes if individual points flash and move with the light on both Shimmer stripes while the Satin control stays smooth, and if the skin texture between facets is unchanged. Then pull back to face framing and compare fine Shimmer with the Satin control: a slightly broader, brighter sheen is the intended result; identical to Satin means the facets are too faint (raise the tilt range), and a noisy crawl means the mips need more fading.
