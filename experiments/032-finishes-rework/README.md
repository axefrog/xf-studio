# Experiment 032: Glitter and Shimmer reworked after session 6

**Status (29 September 2026): offline design and evidence done; built into XF Finish Showroom; not yet in game.** Session 6 judged the two finishes by hand under movable lights ([Glitter design](../../research/materials/finish-designs/glitter.md), [Shimmer design](../../research/materials/finish-designs/shimmer.md)). This experiment finds the Studio models the maintainer liked, reworks both exports toward them, measures the change with experiment 030's tools, and evaluates one isolated alternative template. The in-game check is the finishes row of the [session-7 checks](../../research/runtime/runtime-bridge-test-card.md#session-7-checks-bridge-053).

Evidence grades as in the knowledge base: **[source]** compiled programs or tool source; **[resource]** installed game or tool output; **[offline]** measured here; **[runtime]** seen in game; **[hypothesis]** not established.

## What session 6 said [runtime]

- **Glitter A (board 1):** "doesn't seem much like glitter". The flecks looked printed on top of the purple base, with little light response. The maintainer suggested layering and a strategic distribution of randomised normals for metallic flecks. The Studio's own glitter preview looks much better, but only in some of its models.
- **Shimmer (shimmer-grain-1):** "reads more like a glossy vinyl than a shimmer". The maintainer suggested a highly speckled normal distribution (fine white noise), modelled on a Studio glitter preset that looked close to shimmer.
- **Agreed physical definitions.** Shimmer is dense, fine pearl platelets lying mostly flat: a coherent sliding sheen, faint pinpoints up close and a slight interference tint. Glitter is sparse, larger flakes at random angles, each flashing on its own as its angle aligns. Both are now in the [finish taxonomy](../../research/materials/makeup-finish-taxonomy.md).

## 1. The reference models

The library was read from a **copy** of the maintainer's SQLite database: the localhost server's default data folder, `projects/xf-studio/authoring/data/library.sqlite` with its WAL. That folder is `XFAS_DATA_DIR` when set, else the authoring folder's `data/` ([`host-state.ts`](../../projects/xf-studio/authoring/src/host-state.ts)). The original was never opened. It holds one collection and two looks, and only one Glitter layer:

| Look | Layer | Model | Settings |
|---|---|---|---|
| **Glitterati** (revisions 1 and 2, identical glitter) | "Inner light", Glitter over `#620422` | **Dense fine speckles** (`uv-cell-direct-3`) | density 0.88, fine share 0.88, glint strength 16 (the control's top), seed 2077, flake colour `#fa006c` |

Its other layers are Matte and Metallic, whose stored classic flake settings are unused. Slate Smoke has no Glitter layer. The workspace draft lives in browser storage and was not read, so "a couple of others also look good" can only be the Studio's other glint models, not saved presets. By its description, that means **Direct-light glints** (`uv-cell-direct-1`) and **Clustered fine glints** (`uv-cell-direct-2`).

**Which one looked "close to shimmer".** Most probably Glitterati's own model, Dense fine speckles [hypothesis]. It is the only saved glitter preset. Its catalogue text says it "can look frosty". Its 2,304-cell grid of 0.05–0.09 mm facets, glinting over a broad lobe (angular power 12), is the densest, finest sparkle the Studio draws, and its base sits under a thin clear coat, which gives a sheen. That matches the agreed Shimmer definition (dense and fine), and it is why Glitter's default is now the sparser Direct-light glints model (§4).

What the Studio's glint models do ([`render/direct-glint.ts`](../../projects/xf-studio/authoring/src/engines/layered-makeup/render/direct-glint.ts)) [source]:
- Each model is one jittered polygon facet per UV cell, 1,536 cells per unit of UV (2,304 for Dense fine speckles), occupied at the authored density. The clustered and fine models take that density times a smooth cluster envelope over 18-cell patches, with floors of 0.07 and 0.48.
- Facet sizes come in fine and coarse shares. Dense fine speckles adds a sparse population of large facets, 0.2–0.5 mm, on a 768-cell grid.
- Facet tilts fall in classes: 22 % flat, 53 % at 6–22°, 19 % at 31–48° and 6 % at 51–65°.
- The glint is an additive term, colour × strength × a Blinn-style lobe, with no energy bound. Under it, a direct-glint layer renders at roughness 0.55 with a 0.4 clear coat.

## 2. Glitter flakes 2: the Studio models in the export

[`glitter-studio-flakes.ts`](../../projects/xf-studio/authoring/src/glitter-studio-flakes.ts) turns a glint layer's settings into the diagnostic Glitter route's flake statistics. The route gained optional fields for this ([`export-diagnostics.ts`](../../projects/xf-studio/authoring/src/export-diagnostics.ts), [`glitter-route.ts`](../../projects/xf-studio/authoring/src/glitter-route.ts)). A region without them draws exactly board 1's flakes: same stream, same bytes, which the tests pin.

| What | Glitter flakes 2 | Board 1 | Why |
|---|---|---|---|
| Tilt | **14° floor** + \|N(0, 16°)\|, up to 65° (`tiltMinDeg`) | \|N(0, 25°)\| up to 50°: 37 % of flake texels under mode 1's fade | A flake under ≈ 11.5° writes no normal, so it brightens with the skin's own highlight, like paint on it: the "printed" look. The margin covers BC5's ≈ 1° |
| Surface per flake | Roughness uniform in 0.20–0.34, metalness in 0.85–1 at full glint strength (`roughnessMax`, `metalnessMin`); weaker strength is rougher and less metallic | One value: 0.22, 0.85 | Varied sharpness and reflectance, as the Studio's varied facets give. The game's lobe is energy-bound, so strength buys a brighter, tighter lobe |
| Populations | Small flakes at 2 texels (0.13 mm) and a large share (`largeShare`, `largeSizeMm`): 4 % at 0.29 mm for Dense fine speckles, the coarse share for the others | One log-normal, 0.2 mm | The Studio's occasional big flashes. Its finest facets (0.06 mm) would be one pixel, which the temporal filter dims by an order of magnitude, so they are drawn at two texels |
| Density | The model's own count per mm² (grid × density × envelope), times the flake area | 15 % cover | "As authored": Glitterati becomes 27 % cover, about 16 flakes per mm² |
| Clustering | Value-noise envelope on the model's 18-cell lattice, with its floor (`clusterMm`, `clusterFloor`) | None | "Dense to sparse" areas ([intended look](../../research/materials/finish-designs/glitter.md#intended-look)) |
| Layering | The layer's colour at the Studio's glint base surface (roughness 0.55, metalness 0) under the flakes; flake colour and metalness per flake above it | Satin 0.5 base | The Studio's base. Its clear coat has no G-buffer lobe, so it is not exported |
| Mips | Nested chains as before: each level re-draws its flakes at 2 texels, and the sheen widens by the tilt variance of the new distribution | Same | Glint variance survives to face framing; unresolved flakes become a broader lobe, not nothing |

The independent verifier restates all of it ([`glitter-checks.ts`](../../projects/xf-studio/authoring/src/features/eye-makeup/verify/glitter-checks.ts), [`resource-checks.ts`](../../projects/xf-studio/authoring/src/features/eye-makeup/verify/resource-checks.ts)): the new draw order and cluster envelope, flake by flake; per-flake surface ranges; and a new check that **every fully covered flake texel tilts at least its floor**, so none can fade.

### Offline evidence

[`diagnose.ts`](diagnose.ts) uses experiment 030's model: `mesh_decal` mode 1 on the skin class, the export's own nested chains on the built-in plate's 4096 × 1024 window, and a frontal view. It adds three things:
- **Flake tracking.** Flakes are identified as components of the level-0 flake mask and followed through 168 light directions (elevation 10–70°, azimuth every 15°) and three views.
- **An environment-only render**, for what shows whatever the lights do.
- **A steady-state forecast of the temporal clamp.**

A flake **flashes** under a light when its mean luminance exceeds 5 × the base's under that light. [result.json](result.json) [offline]:

| Left lid interior | Board 1 (session 6) | Same sizes and cover, flakes-2 normals and surfaces | Reference model (Glitterati's, board 2 A) |
|---|---:|---:|---:|
| Flakes (components) | 1,879 | 1,799 | 3,946 |
| Flake texels under mode 1's fade | **37 %** | **0** | **0** |
| Flake tilt, 10th percentile / median | 2.6° / 16.0° | 16.1° / 24.3° | 15.9° / 24.8° |
| **Macro** (0.065 mm/px): flakes brightest where the skin's own highlight is | **32 %** | **1.2 %** | **1.9 %** |
| Macro: most flakes flashing under one light (a sheet) / mean | 43 % / 17 % | 21 % / 15 % | 15 % / 9.2 % |
| Macro: flash state changing for a 15° light move (twinkle) | 0.25 | **0.37** | **0.47** |
| Macro: flakes flashing under at least one light | 100 % | 100 % | 99.8 % |
| Eye close-up (0.1 mm/px): flakes brightest with the skin highlight | 51 % | 27 % | 58 % |
| Eye close-up: most flashing at once / mean / twinkle | 28 % / 10 % / 0.27 | 14 % / 10 % / 0.38 | 4.5 % / 2.9 % / 0.49 |
| Environment only: flakes' brightness over the base's (macro) | 2.9 | 2.7 | 2.0 |
| Face framing: flashing pixels, after the temporal clamp | 0.78 % | 0.74 % | 0.67 % |

How to read it:

- **The printed look is traced, and gone.** On board 1, a third of the flakes sat under the fade. They were brightest exactly where the lid's own sheen is, and up to 43 % of the flakes lit at once under one light: a metallic print that brightens with the skin. With the floor, no flake fades, almost none peaks with the skin, and no single light lights more than a fifth. The flashes are individual: twinkle rises by half (0.25 → 0.37 → 0.47), and each flake flashes over its own few lights.
- **The reference model is denser and finer, and pays for it at the eye close-up.** Its small flakes are exactly two texels. At 0.1 mm per pixel (lod 0.75) the nested chain has already replaced most of them with sheen, so fewer flash there than board 1's larger ones. That is the two-pixel rule working as designed: the game cannot resolve them. Board 2 tests both sizes (A and B), so the session can see which reads as glitter.
- **Statically the flakes still show** (2–2.7 × the base under a uniform environment): metallic flakes over a darker pigment are visible under any light, as real ones are. The pink-over-wine reference shows least.
- **Face framing is unchanged.** About 0.7–0.8 % of pixels flash, and the temporal clamp keeps nearly all of them, because nested flakes are at least two texels.

**Through BC5.** [`bc5-fade.ts`](bc5-fade.ts) decodes board 2's packed normal maps (WolvenKit 9.0.1's own import, the Studio's reader) [offline]. Of every fully covered flake texel supplied at 14° or steeper, **99.98–100 % keep mode 1's full weight and none falls below half**, with a mean tilt loss of 0.006–0.017° ([bc5-result.json](bc5-result.json)). The floor's 2.5° margin holds.

**Limits.** A flat patch, a frontal camera, a uniform environment and one analytic light at a time. No lid curvature, SSS, upscaler, bloom or ray-traced reflections; the renders use the supplied bytes, not the BC-decoded ones. The framings are estimates. This forecasts what the maps can do; it is not the game.

## 3. Shimmer: shimmer-grain-2

[`shimmer-grain.ts`](../../projects/xf-studio/authoring/src/engines/layered-makeup/shimmer-grain.ts):
- **Specks on nearly every texel:** 70 % + 25 % × density, so 86 % by default.
- **A narrow tilt band just above the fade:** 13–(13 + 8 × tilt)°, so 13–18.2° by default, at random azimuths.
- **Glossy, slightly metallic specks:** roughness 0.26, metalness 0.35.
- **A rougher satin base on the flat texels:** roughness 0.5, metalness 0.05, which keeps the skin's scattering.

It replaces shimmer-grain-1: a 26 % grain on one glossy surface everywhere (0.32, 0.3). [Design](../../research/materials/finish-designs/shimmer.md).

**Why grain-1 read as vinyl** [offline, hypothesis for the game]. Its lone one-texel grains stand in a smooth neighbourhood, which is exactly what the temporal clamp removes. What remains is one uniform glossy lobe. In grain-2 every neighbourhood is speckled, so the clamp's window is wide and the speckle survives.

*Shimmer · strong*'s stripes, the same framings and lights as experiment 030. grain-1 comes from a copy of the retired generator, whose bytes equal its pinned digests (`grain1EqualsPinnedBytes: true`) [offline]:

| Stripe interior | Framing | Satin | grain-1 fine | grain-1 strong | **grain-2 fine** | **grain-2 strong** |
|---|---|---:|---:|---:|---:|---:|
| Speckle inside the near-mirror highlight (CV) | close-up | 0 | 0.36 | 0.48 | **1.00** | **1.11** |
| … after the temporal clamp | close-up | 0 | 0.33 | 0.45 | **0.86** | **0.96** |
| Pinpoints under an oblique light (share > 3 × mean), after the clamp | close-up | 0 | 1.0 % | 2.1 % | **3.5 %** | **4.3 %** |
| Twinkle for a 10° light move | close-up | 0 | 0.06 | 0.09 | **0.19** | **0.27** |
| Static pattern (environment only) | close-up | 0 | 0 | 0 | 0.02 | 0.02 |
| Sheen, light 0° / 8° / 16° / 24° off normal | face framing | 0.72 / 0.51 / 0.28 / 0.18 | 0.93 / 0.63 / 0.33 / 0.19 | 0.70 / 0.52 / 0.30 / 0.19 | 0.46 / 0.39 / 0.28 / 0.19 | 0.40 / 0.36 / 0.26 / 0.19 |
| Speckle in the highlight | face framing | 0 | 0.22 | 0.29 | 0.16 | 0.17 |

How to read it:

- **Up close it is a speckle, not a gloss.** Speckle in the highlight roughly triples, and after the clamp it is still more than twice grain-1's. Pinpoints are two to three times as frequent, and twinkle doubles to triples.
- **At face framing it is a soft, even sheen, not a sharp gloss.** grain-1's fine stripe peaked above Satin (0.93 against 0.72), which is the vinyl read. grain-2's peak is lower than Satin's (0.46) and falls off more slowly; from 16° out it matches Satin. The pigment tint from the specks' metalness is not in these luminance figures. The broadness is the cost of the fade: every speck must tilt at least 11.5°, so their collective lobe cannot be narrower. At a distance, Shimmer may read as a soft satin-like sheen with a tint. The session decides whether that is enough.
- **The static pattern is small and one texel wide.** Specks and base differ in roughness and metalness, but the pattern averages away one mip down: 0.01 at face framing.

## 4. The Studio's default glitter model

A layer that becomes Glitter now starts in **Direct-light glints** (shown as "Scattered sparkle"; the list is "Glitter style", with Clustered sparkle and Fine frost), with this layer's remembered settings if it had them. It no longer starts in the classic macro dots. Direct-light glints is sparse facets with occasional larger flashes, the closest to the agreed Glitter definition. Glitterati's Dense fine speckles, the model closest to shimmer, stays one choice away. The three glint models are offered to everyone, with Direct-light glints first. The classic and irregular flake studies show only with research tools on, or on a layer already using one. The classic model's macro dots are the seed of the banked Pattern finish ([backlog](../../research/backlog/README.md)). The UI change is listed for the design gate in the [Glitter design](../../research/materials/finish-designs/glitter.md#studio-ux-for-the-design-gate).

## 5. An isolated alternative: the car-paint metallic flake layer

[`car-paint.ts`](car-paint.ts) and [car-paint-result.json](car-paint-result.json) [resource] [offline]. The game's car paint is not a decal. Vehicle bodies use `vehicle_destr_blendshape.mt`:
- a multilayered setup, Standard class, opaque and depth-writing;
- a forward coat pass (`CoatTintFwd/Side`, `CoatSpecularColor`, `CoatLayerMin/Max`) that blends over its own base pass, like `multilayered_clear_coat`.

The "metallic flake layer" is one of that setup's layer templates, `car_paint_metallic_01.mltemplate`. On the Chevalier Thrax's clean exterior setup it is tiled 15 × its multiplier 4. Its roughness and metalness maps are plain white, remapped by the setup's levels (roughness out 0.27–0, metalness out 0–1). Its flakes are only a 512² BC5 normal map, `car_paint_01_n.xbm`, at normal strength 0.66. Measured:

- **One-texel white noise.** Neighbouring texels correlate 0.1: no flakes wider than a texel.
- **Tilts below our fade.** A median of 6.4° and a 90th percentile of 8.9° at strength 0.66 (9.6° / 13.4° raw). None clears `mesh_decal` mode 1's 11.48°, and plain BOX mips halve the tilt at every level (level 2's median is 1.7°).

**Verdict: not for the plate.**
- **The template:** an opaque multilayered surface replaces the skin under it. That means no soft coverage, no SSS or skin lobes and black where no layer covers, exactly as the [multilayered assessment](../../research/materials/multilayered-makeup-assessment.md) found. Its coat pass lands only on its own base pass's pixels.
- **The flake idea:** inside our decal, the texture's tilts would all fade out. It is a car's micro-sparkle: dense, sub-texel noise at a small tilt, visible only because the opaque surface writes its normal without a fade.
- **What it teaches.** It supports both reworks: the game's own metallic sparkle is dense white noise at a small tilt, which is the shimmer-grain-2 pattern, and our decal needs every tilt above the fade.

No template was switched. The research route that would remove the fade is the queued custom-shader track ([backlog](../../research/backlog/README.md)).

## Files

| File | What it is |
|---|---|
| [`diagnose.ts`](diagnose.ts), [`result.json`](result.json) | Glitter and Shimmer evidence (asset-free). `--png` writes renders to the ignored `generated/` |
| [`bc5-fade.ts`](bc5-fade.ts), [`bc5-result.json`](bc5-result.json) | Board 2's flake normals through WolvenKit's BC5: how many keep the fade's full weight |
| [`car-paint.ts`](car-paint.ts), [`car-paint-result.json`](car-paint-result.json) | The car-paint flake map's statistics (numbers only; the texture stays in the ignored `research/consumers/car-paint/`) |

```powershell
bun experiments/032-finishes-rework/diagnose.ts [--png]
bun experiments/032-finishes-rework/bc5-fade.ts <showroom build>/eye-build/<eye build> PATH_TO_GAME
bun experiments/032-finishes-rework/car-paint.ts PATH_TO_GAME [PATH_TO_car_paint_01_n.xbm]
```

The car-paint resources were extracted read-only with WolvenKit CLI 9.0.1 (`unbundle -r` on `archive/pc/content`; `convert serialize`) into the ignored `research/consumers/car-paint/`. Game resources are CD PROJEKT RED's (game 2.31), read only.
