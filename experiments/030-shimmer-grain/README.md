# Experiment 030: Shimmer as a fine grain over a pearly sheen

**Status (28 September 2026): offline diagnosis and redesign done; not yet in game.** The exported Shimmer showed as a static, regular grid of oversized dots in sessions 3 and 4. This experiment measures why from the export's own maps, and checks the replacement design, *shimmer-grain-1*, with the same measurements. The design and its rules are on the [Shimmer design page](../../research/materials/finish-designs/shimmer.md). The in-game check is the Shimmer row in the [sessions plan](../../research/runtime/next-sessions-plan.md#shimmer-grain-check).

## What the game showed

- **Session 3** ([experiment 028](../028-session-3/README.md#5-results-28-september-2026)): *Shimmer · strong* was a static field of dots, with no flash or sparkle as V moved.
- **Session 4**, under a neutral key light at face framing: the dots were far too big, as if shown at microscope scale, and they formed a grid.

The preset in both sessions was *Shimmer · strong* from [experiment 017](../017-plate-depth/README.md), staged since session 2. On the left lid it holds a Satin control, Board 2's fine Shimmer (128 cells, density 0.65, tilt 0.65) and the strong Shimmer (64 cells, density 0.8, tilt 1), in the finish board's plum. It was built on the 2048 × 512 plate window.

## Method

[`diagnose.ts`](diagnose.ts) compiles that preset exactly as Build does (`compilePreset` on the plate window of the built-in plate). It then runs every map through the export's own mip chain (`facetedMipChain`). It needs no game files.

- **As built.** The Shimmer stripes are redrawn with a copy of the retired window sampler (`shimmerFacetSampler`). Before the rework, the compiler's output equalled that copy on every fully covered stripe texel (`asBuiltEqualsCompiler: true` at commit `5e84330`). After the rework the flag is false by design.
- **Grain.** This is whatever `compilePreset` builds now.
- **Texture statistics** over each stripe's fully covered interior:
  - the tilted share, mean tilt and mean mode-1 weight;
  - the spread of roughness and metalness;
  - the width over which a tilted patch stays correlated (above 0.5);
  - the tilt autocorrelation one as-built cell pitch away. A lattice gives a clearly positive value; a random field gives about 0.
- **Offline renders.** The script draws a frontal view of the lid at two estimated framings: a creator eye close-up at 0.1 mm per pixel and photo-mode face framing at 0.22 mm per pixel. Both footprints are [hypothesis]. Experiment 018 put face framing near its 0.25 mm level, and DLSS renders about half as many internal pixels. The light model is `mesh_decal` mode 1 on the skin class:
  - the gate saturate(50 − 50z) on the filtered normal;
  - an encoded lerp onto a flat skin normal;
  - two GGX lobes at roughness × 0.966 and × 1.597;
  - F0 = lerp(0.04, albedo, metalness);
  - Lambert diffuse × (1 − metalness).

  From the renders it reports:
  - **static contrast**: the pattern in albedo × (1 − metalness), which shows whatever the light does;
  - **lit contrast** under an oblique light;
  - **twinkle**: how much of the image changes when that light moves 10°;
  - the on-screen pattern width;
  - a **sheen profile**: mean brightness as the light tilts 0–32° off the normal.

```powershell
bun experiments/030-shimmer-grain/diagnose.ts          # result.json
bun experiments/030-shimmer-grain/diagnose.ts --png    # also texture crops and renders into ignored generated/
```

## Diagnosis [offline]

Why the exported Shimmer is a regular grid of large dots, from [result.json](result.json):

1. **It is a lattice by construction.**
   - The classic bake puts at most one facet in each cell of a square grid in head UV (2 × `cells` per unit).
   - A facet's centre moves at most ±15 % of a cell.
   - Every facet has the same radius, 0.39 cell.
   - With density 0.8, most cells are filled, so the facets read as rows and columns.
   - Measured on the window maps, the tilt autocorrelation one cell pitch away is **0.36 (across) and 0.41 (down)** on the strong stripe, and 0.28 and 0.23 on the fine one. The grain's is **0.01 and −0.004**.
2. **The dots are millimetres wide.**
   - A strong-stripe cell is 1/128 of head UV, about 4.4 × 3.2 mm on the lid, so each facet is about **3.5 × 2.5 mm**. That is roughly 16 × 11 pixels at face framing and 35 × 25 at an eye close-up.
   - Board 2's fine stripe is half that.
   - Real pearl and shimmer pigment platelets are a few tens of micrometres [general background, not sourced here]. The exact size does not matter here: anything under about 0.1 mm is below one window texel and below one pixel at any in-game framing.
   - The measured correlated patch is 1.95 mm (strong) and 1.17 mm (fine). The rendered pattern is 23 pixels wide at the close-up and 9–13 at face framing.
   - The plate window raised the texture's resolution, but the facets kept their authored cell size, so the dots got crisper, not smaller.
3. **The dots are static because the bake painted them into the surface.**
   - Each facet also wrote metalness 0.35 (0 between facets) and roughness 0.32 against 0.48.
   - Albedo × (1 − metalness) therefore varies across the stripe whatever the light does. The measured static contrast is **0.18 (strong) and 0.16–0.17 (fine)**. Satin's is 0 and the grain's is 0.
   - Only the normal can make a pattern that moves with the light. On the fine stripe, mode 1 weights a mean tilted texel only 0.64, because most of its facets tilt less than 11.5° ([decal reference §9.2](../../research/materials/shader-decal.md#92-shimmer-reads-as-a-soft-gloss)).
   - So the visible thing was a grid of dark and bright metal discs, with a weak sparkle on top.

The texture crops (`generated/as-built-texture.png`: tilt above, metalness below) and the unlit render (`as-built-face-framing-ambient.png`) show the disc grid directly.

## The redesign and its measurements [offline]

*shimmer-grain-1* ([`shimmer-grain.ts`](../../projects/xf-studio/authoring/src/engines/layered-makeup/shimmer-grain.ts)) is sheen-first:

- **Uniform surface.** Every covered texel writes roughness 0.32 and metalness 0.3.
- **Grain.** 0.4 × density of the texels tilt between 12° and 12° + 18° × tilt, at random azimuths; the rest are flat. The grain is white noise at one grain per window texel (0.13 × 0.12 mm).

| Measure (stripe interior) | As built: fine | As built: strong | Grain: fine | Grain: strong |
|---|---:|---:|---:|---:|
| Tilted share | 0.31 | 0.39 | 0.26 | 0.32 |
| Mean mode-1 weight on tilted texels | 0.64 | 0.92 | **1.00** | **1.00** |
| Metalness spread (SD) | 0.16 | 0.16 | **0** | **0** |
| Correlated patch width | 1.17 mm | 1.95 mm | **0.13 mm** (one texel) | **0.13 mm** |
| Tilt autocorrelation at the old cell pitch (across, down) | 0.28, 0.23 | 0.36, 0.41 | −0.01, 0.00 | 0.01, −0.00 |

| Render (stripe interior) | Framing | As built: fine | As built: strong | Grain: fine | Grain: strong | Satin |
|---|---|---:|---:|---:|---:|---:|
| Static contrast | close-up | 0.17 | 0.19 | **0** | **0** | 0 |
| Pattern width (px) | close-up | 13 | 23 | **1** | **1** | — |
| Lit contrast, oblique light | close-up | 0.53 | 0.43 | 0.72 | 0.97 | 0 |
| Twinkle for a 10° light move | close-up | 0.05 | 0.12 | 0.06 | 0.09 | 0 |
| Static contrast | face framing | 0.16 | 0.18 | **0** | **0** | 0 |
| Pattern width (px) | face framing | 7 | 9 | **1** | **1** | — |
| Lit contrast, oblique light | face framing | 0.46 | 0.44 | **0.06** | **0.09** | 0 |
| Sheen, light 0° / 8° / 16° off normal | face framing | 0.49 / 0.39 / 0.27 | 0.30 / 0.28 / 0.23 | **0.93 / 0.63 / 0.33** | 0.71 / 0.52 / 0.30 | 0.72 / 0.51 / 0.28 |

How to read it:

- **No dots, no grid.** The grain has no static pattern at either framing. At the close-up its pattern is one pixel wide: a fine sparkle that is strong under an oblique light and changes when the light moves. At face framing the chain has averaged it away (lit contrast 0.06–0.09), leaving a smooth sheen.
- **Distinct from Satin.** At face framing the fine grain's highlight is brighter at the mirror angle than Satin's (0.93 against 0.72) and holds more of its brightness at 16° (0.33 against 0.28). That is the soft, luminous lobe the finish is meant to have. Its reflection is also tinted by the pigment (metalness 0.3), which luminance does not show. The strong stripe's larger slope variance makes its lobe broader and dimmer at the peak.
- **Distinct from Glitter.** Glitter's design needs flakes of two or more texels and pixels, with nested mips that keep them visible ([Glitter in game](../../knowledge/glitter-in-game.md)). Shimmer's grains are one texel and deliberately vanish into the sheen by face framing.

**Limits.** This is a flat patch under one directional light with a frontal view. It leaves out lid curvature, SSS, TAA or DLSS, bloom, environment and ray-traced reflections, and BC5 or BC4 compression. The trilinear LOD is isotropic and ignores anisotropic filtering. The framings are estimates. These are forecasts to make the in-game check informative, not proof of how the game renders.

## Files

| File | What it is |
|---|---|
| [`diagnose.ts`](diagnose.ts) | The measurement and render script |
| [`result.json`](result.json) | Its output (asset-free) |
| `generated/` (ignored) | Texture crops (tilt ×4 above, metalness below; 2 px per texel) and renders per variant, framing and light (A near mirror, B and C oblique 10° apart, ambient) |
