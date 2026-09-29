# Shimmer / pearl

**Status:** experimental export (faceted decal), game-matched model only. The current build is **shimmer-grain-2**: dense pearl specks on nearly every texel over a satin base. It has **not been in game**. Its history in game:
- The classic facet bake read as a diffused gloss at its default (25 September).
- At *Shimmer · strong* it was a static field of dots (session 3, 28 September), and under a neutral key light at face framing a regular grid of dots far too large (session 4). [Experiment 030](../../../experiments/030-shimmer-grain/README.md) traced that and replaced it with shimmer-grain-1.
- shimmer-grain-1, a uniform glossy pearly surface with a sparse one-texel grain, "reads more like a glossy vinyl than a shimmer" (session 6, 29 September, judged by hand under movable lights).

[Experiment 033](../../../experiments/033-finishes-rework/README.md) measures why and checks grain-2 offline. The in-game check is the finishes row of the [session-7 checks](../../runtime/runtime-bridge-test-card.md#ink-demo-rows-bridge-053).

## Intended look

A fine reflective sheen: many tiny particles that sparkle individually when the eye is close and merge into a soft, luminous sheen at normal viewing distance ([finish taxonomy](../makeup-finish-taxonomy.md)). The agreed physical picture (session 6): **dense, fine pearl platelets lying mostly flat**, giving a coherent sliding sheen, faint pinpoints up close and a slight interference tint. Pearl is grouped here. The supplied references show this transition: the copper reference 3 reads as a continuous reflective band, while the purple references show individual points only close up ([reference review](../glitter-reference-review.md), [manifest](../../backlog/glitter-visual-references.json)). Glitter, not Shimmer, is the finish with individually visible flakes.

## What the engine allows

- **One surface per pixel.** The G-buffer holds one normal, one roughness, one metalness and one colour. Skin has no anisotropy (only hair does), no sheen lobe, no clear coat and no specular tint ([materials and shaders §2](../../../knowledge/materials-and-shaders.md)). An anisotropic or two-lobe pearl is therefore not expressible on the eye plate [source].
- **Pigment is sub-pixel.** Pearl and shimmer pigment platelets are a few tens of micrometres [general background, not sourced here]. The plate window's texel is 0.13 × 0.12 mm, and a screen pixel covers roughly 0.1 mm at an eye close-up and 0.2–0.25 mm at face framing [hypothesis; [experiment 030](../../../experiments/030-shimmer-grain/README.md#method)]. Real particles can therefore only show as the statistics of a texel: its roughness, its tint and, close up, a texel-sized glint.
- **The mip chain is the only filter a mod controls.** Nothing in the decal or skin programs turns normal variance into roughness ([Glitter in game §1](../../../knowledge/glitter-in-game.md#1-from-flake-texture-to-screen-pixel)) [source].
- **Mode 1 gate.** `NormalsBlendingMode` 1 writes a decal normal at weight saturate(50 − 50z), full from about 11.5° of tilt. It lerps the *encoded* normal, so a 5° tilt survives as about 1° ([decal reference §9.2](../shader-decal.md#92-shimmer-reads-as-a-soft-gloss)) [source].

## The design: shimmer-grain-2

`mesh_decal`, entry `@faceted`: a tangent normal map with `NormalAlpha` 1, `UseNormalAlphaTex` 0, **`NormalsBlendingMode` 1**, plus per-texel roughness and metalness. The route and material are unchanged; only the maps differ ([`shimmer-grain.ts`](../../../projects/xf-studio/authoring/src/engines/layered-makeup/shimmer-grain.ts)). The model is the Studio's Dense fine speckles glitter model, the one closest to shimmer ([experiment 032 §1](../../../experiments/033-finishes-rework/README.md#1-the-reference-models)), made finer, denser and flatter.

| Part | Value | Why |
|---|---|---|
| Speck share | **70 % + 25 % × the layer's density** of the texels are specks (default 0.65: 86 %); the rest are flat | "A highly speckled normal distribution (fine white noise)". Dense speckle also survives the temporal clamp: grain-1's lone grains in a smooth neighbourhood are exactly what it removes. |
| Speck tilt | Uniform between **13°** and 13° + 8° × tilt (default 13–18.2°), uniform azimuth | Every speck clears the mode-1 gate at full weight, with room for BC5's ≈ 1° error. The band is narrow and centred on the surface normal, so the specks together make one coherent lobe that slides with the light. Random azimuths make the untested green sign irrelevant to the statistics. |
| Speck surface | Roughness **0.26**, metalness **0.35** | Glossy pinpoints tinted by the pigment (F0 = lerp(0.04, albedo, 0.35)): the pearly part. Above 0.1 metalness a texel skips the skin's subsurface scattering, as the game's own gold and silver blush does ([decal reference §3](../shader-decal.md#3-instance-chains-on-the-player)). |
| Base between specks | Roughness **0.5**, metalness **0.05** on the flat texels | A rougher satin that keeps the skin's scattering. Grain-1's one glossy surface everywhere (0.32, 0.3) is what read as vinyl. |
| Scale | White noise at 4096 cells per unit of head UV. The plate window (2048 × 512, 0.13 × 0.12 mm) holds **one speck per texel** | Close up, a speck is a pixel or two and glints as the light or view moves. At face framing it is sub-pixel and the chain averages it away. There are no cells, discs or lattice. |
| Coarser maps | A texel coarser than a grain cell holds its cells' mean tilt, their mean surface, and roughness widened by their variance: r′ = (r̄⁴ + v)^¼. From 16 cells per texel it writes a flat normal with the full expected variance and the expected surface | Same rule as the export's lower mips. Applies to head-UV diagnostics (the browser preview bakes one cell per texel, below). |
| Mips | Unchanged route rule: the normal's lower levels are plain means, roughness levels are the mean widened by the lost slope variance (α′² = ᾱ² + v), metalness is the mean | Unresolved specks become one broad, tinted lobe instead of vanishing. |

**What stays with the layer:** its density and tilt settings (*Flake density*, *Orientation spread*) and its seed. *Flake fineness* (`cells`) does not apply to game-matched Shimmer. The grain has one true-to-scale size, so the application refuses the setting and the inspector hides it (only for that refusal; any other would disable it). A value stored earlier stays on the layer, since it applies again if the layer becomes Glitter, but it is not part of the grain's identity or the preview's. Layers still in the earlier browser study keep the classic facet preview and do not export.

### Offline result

From [experiment 033](../../../experiments/033-finishes-rework/README.md#3-shimmer-shimmer-grain-2), on *Shimmer · strong*'s stripes, with the tools of [experiment 030](../../../experiments/030-shimmer-grain/README.md) plus a steady-state forecast of the temporal clamp [offline]:

- **Close up, speckle instead of gloss.** Speckle inside the near-mirror highlight is 1.0–1.1 (grain-1: 0.36–0.48), and 0.86–0.96 after the clamp. Pinpoints under an oblique light are two to three times as frequent. Twinkle for a 10° light move is 0.19–0.27 (grain-1: 0.06–0.09).
- **Face framing, a soft sheen.** Grain-1's fine stripe peaked above Satin (0.93 against 0.72): the gloss. Grain-2 peaks lower (0.40–0.46), falls off more slowly and matches Satin from 16° out; its tint is not in these luminance figures.
- **No dots, no grid.** The static pattern is 0.02 close up and 0.01 at face framing: one texel wide, averaged away one mip down. Experiment 030's lattice and disc findings still hold: there are no cells.

### Risks and open questions

- **The specks' metalness 0.35 turns off SSS on their texels**, and the mean at a distance (about 0.31) does too. Metallic's "hard, plastic" read in session 3 was traced to the same switch ([decal reference §9.1](../shader-decal.md#91-matte-and-satin-read-glossy)). If the build looks hard, the fallback is speck metalness 0.08 (keeps SSS, loses most of the tint), or a pearl tint through the Fresnel template's one-pigment route ([Colour-shifting](colour-shifting.md)).
- **A broad sheen at a distance.** Every speck must tilt at least 11.5°, so the specks' collective lobe cannot be narrower than about that. At face framing Shimmer may read as a soft, tinted, satin-like sheen rather than a bright one. Only a shader without the fade would allow a narrower platelet distribution ([custom shaders, backlog](../../backlog/README.md)).
- **One-texel grains under DLSS.** At the eye close-up a grain is about one output pixel, and fewer internal pixels under DLSS. The upscaler and TAA may keep, soften or crawl it. The session should compare DLSS with DLAA.
- **BC5 at one-texel frequency.** Measured offline on grain-1 through WolvenKit 9.0.1's own import ([experiment 030](../../../experiments/030-shimmer-grain/README.md#through-wolvenkits-bc5-offline)): about 2 % of tilted grains fell below the fade's full weight at a 12° floor (one in 5,400 below half), with a mean angle error of 0.7–1.0°; flat grains stayed flat. Grain-2's 13° floor adds a degree of margin; it was not re-measured. The manifest says BC5 lowers a few. How the game's sampler decodes it is unobserved.
- **Tangent frame.** Grain orientation relies on the plate's tangents, from the head mesh bytes, which is unobserved. Random azimuths make it irrelevant to the statistics.
- **Normal alpha follows the colour-map alpha** (square-root coverage), so partly covered edges carry slightly more normal than colour.

## Engine routes considered

| Route | Verdict |
|---|---|
| **Dense specks over a satin base** (`mesh_decal` mode 1, above; shimmer-grain-2) | **Implemented** |
| Sparse grain over one uniform glossy surface (shimmer-grain-1, 28–29 September) | Retired: glossy vinyl in session 6. Its sparse one-texel grains are what the temporal clamp removes, leaving the uniform gloss |
| The car-paint metallic flake layer (`car_paint_metallic_01.mltemplate` on the vehicles' multilayered template) | Rejected as a template: opaque, replaces the skin. Its flake map is dense one-texel noise at 6–9° of tilt, which would all fade in our decal ([experiment 032 §5](../../../experiments/033-finishes-rework/README.md#5-an-isolated-alternative-the-car-paint-metallic-flake-layer)); the pattern supports grain-2's |
| Classic facet bake (UV-cell discs with per-facet metalness, retired 28 September) | Rejected. A lattice of millimetre discs painted into metalness: static dots in game |
| Larger, resolved flakes with nested mips | That is Glitter's design ([Glitter](glitter.md)), deliberately kept distinct |
| Flat sheen only (no normal map) | Fallback if the grain misbehaves in game: the same surface without its close-up sparkle |
| Anisotropic or two-lobe sheen | Not expressible: no anisotropy or second lobe on skin in the G-buffer |
| Pearl hue through `mesh_decal_gradientmap_recolor_blendable` Fresnel | Possible later tint, but it forces the preset through that template's one-pigment rule. Not built |

## What the preview does

The game-matched model bakes the export's grain, specks and base surfaces alike, at its true scale at **every** preview quality: one grain cell per texel, 4096 per unit of head UV, over the region's optics rectangle (eye makeup's: u 0.25–0.75, v 0.125–0.375, a 2048 × 1024 map around the plate). The raster worker bakes it and builds the route's mip chains off the main thread: every level fades tilts by the mode-1 weight, and lower levels widen roughness as the export does ([`raster-processor.ts`](../../../projects/xf-studio/authoring/src/engines/layered-makeup/raster-processor.ts), [`createPreviewFacetChainJob`](../../../projects/xf-studio/authoring/src/engines/layered-makeup/route-mip-chains.ts)). The layer's material and the plate composite read the maps through the rectangle's UV transform. With a grain merged, the composite runs at the grain's density on the grain's own grid, so each grain is one composite texel, as in the export.

So close-up sparkles show at 512, 1024 (the default), 2048 and 4096 alike; the preview quality sets only the masks' resolution. Neither the grain nor its identity depends on the quality or on *Flake fineness*: changing either does not bake it again. The grain costs a fixed ≈ 22 MB of maps and ≈ 60 MB of composite, which the quality assessment counts; the bake takes about 0.25 s in the worker (measured in Bun: 165 ms grain plus 78 ms chains, 62 MB peak). Before 28 September the preview baked the grain on its head-UV mask texture instead, so only 4096 showed grains, and 4096 needed about 0.8 GB of chain planes on the main thread (code-health PREV-182, PREV-183).

The preview's grain field is the same design and statistics as the export's but not the same texels: the export draws its grains per texel of its own plate window, whose pitch is 4376 × 3420 per unit of head UV on the built-in plate.

## Determinism

The grain's bytes are the same on every platform: an integer hash, and only +, −, ×, ÷ and square roots on the byte path (sines and cosines are polynomials, never `Math.sin`, `Math.cos` or `Math.pow`). The seed is mixed before use, so neighbouring seeds draw unrelated grains (code-health PREV-185). A test pins the default seed's bytes (PREV-186); they moved once, deliberately, with the model id (shimmer-grain-2, 29 September).
