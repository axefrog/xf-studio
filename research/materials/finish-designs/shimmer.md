# Shimmer / pearl

**Status:** experimental export (faceted decal), game-matched model only. The current build is **shimmer-grain-1**: a uniform pearly surface with a one-texel sparkle grain. It has **not been in game**. It replaces the classic facet bake. In game, that bake read as a diffused gloss at its default (25 September). At *Shimmer · strong* it was a static field of dots (session 3, 28 September) and, under a neutral key light at face framing, a regular grid of dots far too large (session 4). [Experiment 030](../../../experiments/030-shimmer-grain/README.md) measures why and checks the grain offline. The in-game check is the [Shimmer grain row](../../runtime/next-sessions-plan.md#shimmer-grain-check) of the sessions plan.

## Intended look

A fine reflective sheen: many tiny particles that sparkle individually when the eye is close and merge into a soft, luminous sheen at normal viewing distance ([finish taxonomy](../makeup-finish-taxonomy.md)). Pearl is grouped here. The supplied references show this transition: the copper reference 3 reads as a continuous reflective band, while the purple references show individual points only close up ([reference review](../glitter-reference-review.md), [manifest](../../backlog/glitter-visual-references.json)). Glitter, not Shimmer, is the finish with individually visible flakes.

## What the engine allows

- **One surface per pixel.** The G-buffer holds one normal, one roughness, one metalness and one colour. Skin has no anisotropy (only hair does), no sheen lobe, no clear coat and no specular tint ([materials and shaders §2](../../../knowledge/materials-and-shaders.md)). An anisotropic or two-lobe pearl is therefore not expressible on the eye plate [source].
- **Pigment is sub-pixel.** Pearl and shimmer pigment platelets are a few tens of micrometres [general background, not sourced here]. The plate window's texel is 0.13 × 0.12 mm, and a screen pixel covers roughly 0.1 mm at an eye close-up and 0.2–0.25 mm at face framing [hypothesis; [experiment 030](../../../experiments/030-shimmer-grain/README.md#method)]. Real particles can therefore only show as the statistics of a texel: its roughness, its tint and, close up, a texel-sized glint.
- **The mip chain is the only filter a mod controls.** Nothing in the decal or skin programs turns normal variance into roughness ([Glitter in game §1](../../../knowledge/glitter-in-game.md#1-from-flake-texture-to-screen-pixel)) [source].
- **Mode 1 gate.** `NormalsBlendingMode` 1 writes a decal normal at weight saturate(50 − 50z), full from about 11.5° of tilt. It lerps the *encoded* normal, so a 5° tilt survives as about 1° ([decal reference §9.2](../shader-decal.md#92-shimmer-reads-as-a-soft-gloss)) [source].

## The design: shimmer-grain-1

`mesh_decal`, entry `@faceted`: a tangent normal map with `NormalAlpha` 1, `UseNormalAlphaTex` 0, **`NormalsBlendingMode` 1**, plus per-texel roughness and metalness. The route and material are unchanged from the facet bake; only the maps differ ([`shimmer-grain.ts`](../../../projects/xf-studio/authoring/src/engines/layered-makeup/shimmer-grain.ts)).

| Part | Value | Why |
|---|---|---|
| Surface | Roughness **0.32** and metalness **0.3** on every covered texel | Nothing static varies between texels, so any pattern that shows must move with the light. Metalness tints the reflection with the pigment (F0 = lerp(0.04, albedo, 0.3)), which is the pearly part. Above 0.1 it also skips the skin's subsurface scattering under the makeup, as the game's own gold and silver blush does ([decal reference §3](../shader-decal.md#3-instance-chains-on-the-player)). |
| Grain share | 0.4 × the layer's density of the texels tilt (default 0.65: 26 %); the rest are flat | Flat texels write nothing in mode 1, so the skin's own normal detail stays between grains. |
| Grain tilt | Uniform between **12°** and 12° + 18° × tilt (default 12–23.7°), uniform azimuth | Every tilted grain clears the mode-1 gate at full weight, so none is faded into a ripple. Random azimuths make the untested green sign irrelevant to the statistics. |
| Grain scale | White noise at 4096 cells per unit of head UV. The plate window (2048 × 512, 0.13 × 0.12 mm) holds **one grain per texel** | Close up, a grain is a pixel or two and glints as the light or view moves. At face framing it is sub-pixel and the chain averages it away. There are no cells, discs or lattice. |
| Coarser maps | A texel coarser than a grain holds its grains' mean tilt and widens its roughness by their variance: r′ = (r⁴ + v)^¼. From 16 grains per texel it writes a flat normal with the full expected variance | Same rule as the export's lower mips. Applies to head-UV diagnostics (the browser preview bakes one grain per texel, below). |
| Mips | Unchanged route rule: the normal's lower levels are plain means, and roughness levels add the lost slope variance (α′² = ᾱ² + v) | Unresolved grains become a broader, brighter lobe instead of vanishing. |

**What stays with the layer:** its density and tilt settings (*Flake density*, *Orientation spread*) and its seed. *Flake fineness* (`cells`) does not apply to game-matched Shimmer. The grain has one true-to-scale size, so the application refuses the setting and the inspector hides it (only for that refusal; any other would disable it). A value stored earlier stays on the layer, since it applies again if the layer becomes Glitter, but it is not part of the grain's identity or the preview's. Layers still in the earlier browser study keep the classic facet preview and do not export.

### Offline result

From [experiment 030](../../../experiments/030-shimmer-grain/README.md), on *Shimmer · strong*'s maps as built and as the grain [offline]:

- **Static pattern.** The facet bake's static contrast was 0.16–0.19. The grain's is 0.
- **Lattice.** Tilt autocorrelation one old cell pitch away was 0.23–0.41. The grain's is about 0.
- **Pattern width on screen.** Down from 13–23 pixels at the close-up and 7–9 at face framing, to 1 pixel.
- **Face framing.** The grain is a smooth sheen (lit contrast 0.06–0.10). Its fine stripe peaks brighter than Satin's and stays brighter 16° off the mirror angle.

### Risks and open questions

- **Metalness 0.3 turns off SSS** under covered makeup. Metallic's "hard, plastic" read in session 3 was traced to the same switch ([decal reference §9.1](../shader-decal.md#91-matte-and-satin-read-glossy)). If the grain build looks hard, the fallback is metalness 0.08 (keeps SSS, loses most of the tint), or a pearl tint through the Fresnel template's one-pigment route ([Colour-shifting](colour-shifting.md)).
- **One-texel grains under DLSS.** At the eye close-up a grain is about one output pixel, and fewer internal pixels under DLSS. The upscaler and TAA may keep, soften or crawl it. The session should compare DLSS with DLAA.
- **BC5 at one-texel frequency.** Measured offline through WolvenKit 9.0.1's own import ([experiment 030](../../../experiments/030-shimmer-grain/README.md#through-wolvenkits-bc5-offline)): about 2 % of tilted grains fall below the fade's full weight (one in 5,400 below half), with a mean angle error of 0.7–1.0°; flat grains stay flat. The manifest says so. How the game's sampler decodes it is unobserved.
- **Tangent frame.** Grain orientation relies on the plate's tangents, from the head mesh bytes, which is unobserved. Random azimuths make it irrelevant to the statistics.
- **Normal alpha follows the colour-map alpha** (square-root coverage), so partly covered edges carry slightly more normal than colour.

## Engine routes considered

| Route | Verdict |
|---|---|
| **Grain over a uniform pearly surface** (`mesh_decal` mode 1, above) | **Implemented.** Sheen first, sparkle only where the texture can resolve it |
| Classic facet bake (UV-cell discs with per-facet metalness, retired 28 September) | Rejected. A lattice of millimetre discs painted into metalness: static dots in game |
| Larger, resolved flakes with nested mips | That is Glitter's design ([Glitter](glitter.md)), deliberately kept distinct |
| Flat sheen only (no normal map) | Fallback if the grain misbehaves in game: the same surface without its close-up sparkle |
| Anisotropic or two-lobe sheen | Not expressible: no anisotropy or second lobe on skin in the G-buffer |
| Pearl hue through `mesh_decal_gradientmap_recolor_blendable` Fresnel | Possible later tint, but it forces the preset through that template's one-pigment rule. Not built |

## What the preview does

The game-matched model bakes the export's grain at its true scale at **every** preview quality: one grain per texel, 4096 per unit of head UV, over the region's optics rectangle (eye makeup's: u 0.25–0.75, v 0.125–0.375, a 2048 × 1024 map around the plate). The raster worker bakes it and builds the route's mip chains off the main thread: every level fades tilts by the mode-1 weight, and lower levels widen roughness as the export does ([`raster-processor.ts`](../../../projects/xf-studio/authoring/src/engines/layered-makeup/raster-processor.ts), [`createPreviewFacetChainJob`](../../../projects/xf-studio/authoring/src/engines/layered-makeup/route-mip-chains.ts)). The layer's material and the plate composite read the maps through the rectangle's UV transform. With a grain merged, the composite runs at the grain's density on the grain's own grid, so each grain is one composite texel, as in the export.

So close-up sparkles show at 512, 1024 (the default), 2048 and 4096 alike; the preview quality sets only the masks' resolution. Neither the grain nor its identity depends on the quality or on *Flake fineness*: changing either does not bake it again. The grain costs a fixed ≈ 22 MB of maps and ≈ 60 MB of composite, which the quality assessment counts; the bake takes about 0.25 s in the worker (measured in Bun: 165 ms grain plus 78 ms chains, 62 MB peak). Before 28 September the preview baked the grain on its head-UV mask texture instead, so only 4096 showed grains, and 4096 needed about 0.8 GB of chain planes on the main thread (code-health PREV-182, PREV-183).

The preview's grain field is the same design and statistics as the export's but not the same texels: the export draws its grains per texel of its own plate window, whose pitch is 4376 × 3420 per unit of head UV on the built-in plate.

## Determinism

The grain's bytes are the same on every platform: an integer hash, and only +, −, ×, ÷ and square roots on the byte path (sines and cosines are polynomials, never `Math.sin`, `Math.cos` or `Math.pow`). The seed is mixed before use, so neighbouring seeds draw unrelated grains; the default seed 2077 kept its bytes through that change, and a test pins them (code-health PREV-185, PREV-186).
