# Plate-local UV window: texel density for every mesh_decal finish route

**Status:** built into the production pipeline for the flat and faceted routes, 25 September 2026. Every step between an authored UV and the texel the game samples is verified offline, and the independent verifier now checks it on every build. **Nothing here has been seen in game yet:** the diagnostic candidate below is built and verified but not staged. The consolidated reading is in [Glitter in game](../../knowledge/glitter-in-game.md#1-from-flake-texture-to-screen-pixel) and [materials and shaders](../../knowledge/materials-and-shaders.md#6-makeup-finish-implications); the pipeline contract is in [the Studio-to-mod pipeline](../../research/authoring/studio-to-mod-pipeline.md#the-plate-local-uv-window).

Evidence grades as in the knowledge base: **[source]** compiled programs or tool source; **[resource]** installed game or mod files; **[offline]** measured here; **[runtime]** seen in game; **[hypothesis]** not established.

## Question

The eye plate keeps the head's UV0, so a 1024 head-atlas texture spends only the plate's rectangle (0.453 × 0.145 of the atlas) on the plate: about 0.56 × 0.40 mm per texel on the lids ([experiment 018](../018-glitter-route/README.md#texel-density)). `mesh_decal` has UV scale and offset constants. Can every export route map just the plate's rectangle onto the whole texture, with the right sign, and what should the textures be?

## Offline verification

### 1. The UV transform and its V sign

| Step | Finding | Grade |
|---|---|---|
| Vertex program | `mesh_decal` `post_gbuffer` MeshSkinned vertex `11128168794837425370` passes `TEXCOORD0.xy` through unchanged, so the pixel program sees the UV as stored in the mesh. | [source] |
| Pixel program | `16098255505177109230`: t = `UVScale`·(uv − 0.5) + 0.5 + `UVOffset` (rotated by `UVRotation`·π), then sign(t)·frac(\|t\|) and a flipbook divide that is the identity at the default frame counts. Every texture (diffuse, normal, roughness, metalness, normal mask) is sampled at that t; only `SecondaryMask` scales it again. For \|t\| < 1 the wrap is the identity, so no derivative seam appears near the window's edges. | [source] |
| Stored V | The built-in plate's UV0 is stored as U 0.273193–0.726563, V 0.676270–0.821289 (half floats). The Studio authors in glTF UV0, which is 1 − V: the finish board's lids at v 0.21–0.25 lie inside 1 − V = 0.179–0.324. | [resource] |
| XBM row order | WolvenKit CLI 9.0.1 **stores imported image rows bottom to top** and its export flips them back. [`probe_xbm.py`](probe_xbm.py) imports a 64 × 16 chain with a marker in its top rows; the serialized XBM's first stored BC4 block row holds background and the last holds the marker, while the exported DDS has the marker on top again ([`probe-result.json`](probe-result.json)). | [resource] |
| Consequence | Both flips together are why head-UV exports already land in place: the compiler writes row y at authored v = (y + ½)/1024, which is stored at t = 1 − v = V. For a window [u0, u1] × [v0, v1] (authored) with rows in natural authored order, t must map stored V ∈ [1 − v1, 1 − v0] onto [0, 1]: `UVScaleY` = 1/(v1 − v0) and `UVOffsetY` = `UVScaleY`·((v0 + v1)/2 − ½), which is **negative** (−1.66). This is the sign experiment 018 proposed. | [offline] |

**Per-build check.** The verifier decodes a stored BC4 level of every preset (roughness, or the Fresnel mask) itself and requires it to equal the exported level with its rows reversed (to within one byte step, the rounding difference between two BC4 decoders; on the builds below the unreversed rows differ by up to 255). It then maps 19,680 plate sample points (every vertex and six points inside each triangle, from the packaged plate's own UVs) through the restated shader transform and row flip, and compares the decoded window coverage with the authored head-UV coverage at the same points. The authored reference is cropped from the builder's **head-atlas raster**, not the window rasterizer that made the maps, so a fault in the window code cannot move both together (a test bakes with the window rasterizer mirrored and requires the gate to fail). [`tools/uv-window-probe.ts`](../../projects/xf-studio/authoring/tools/uv-window-probe.ts) shows that this separates the right mapping from plausible mistakes on the finish board build (rebuilt 25 September with the head-raster reference) [offline]:

| Mapping (Board 1) | Mean coverage error | Samples off by more than 0.5 | Offset estimate (u, v texels) |
|---|---:|---:|---|
| As packaged | 0.0008 | 0 % | 0, 0 |
| `UVOffsetY` sign flipped | 0.891 | 89 % | at the search limit |
| V mirrored inside the window | 0.885 | 89 % | at the search limit |
| Rows not reversed (no import flip) | 0.885 | 89 % | at the search limit |
| Lookup shifted 2 texels in U | 0.005 | 0 % | −2, 0 |
| Lookup shifted 2 texels in V | 0.028 | 0 % | 0, 2 |
| Lookup shifted 8 texels in U (1 mm) | 0.017 | 1.5 % | −8, 0 |

The gate is mean < 0.03, fewer than 1 % of samples off by more than 0.5, and a signed offset estimate within one window texel on each axis. The first two limits alone let shifts of a few texels through (both 2-texel rows pass them); the offset estimate is a joint search over shifts of the map lookup up to ±8 texels, refined to 1/16 texel, for the least total difference from the reference, and reports the content's displacement with its sign. It is made only with at least 24 samples of authored content and an edge strength (spread of the total error over the coarse shifts) of 8 coverage units: on lossless bakes a preset reaching only 13 samples, or at 0.5-1 % opacity, gave spurious 0.2-0.5 texel estimates. A map empty at the plate where the authored makeup reaches it fails however faint the makeup. Every wrong alternative above fails. On the rebuilt finish board and session-2 collection every window preset's estimate is 0 on both axes, except the sharpest line pattern at 0.06 texel in V.

### 2. The window rule

The builder derives the window from the plate it packages: the plate's stored UV0 bounds, each axis widened by 1/64 of the window span on each side (so 62/64 of each axis's texels land on the plate) and clamped to the atlas. For the built-in plate:

| | U | V (authored) | Constants |
|---|---|---|---|
| Plate bounds | 0.273193–0.726563 | 0.178711–0.323730 | |
| Window | 0.265881–0.733875 | 0.176372–0.326069 | `UVScaleX` 2.136780, `UVOffsetX` 0.000261, `UVScaleY` 6.680135, `UVOffsetY` −1.661879 |

Experiment 018's hand-picked window (margins of about 1–2 %) gave 2.161695 / 0.000216 / 6.622517 / −1.647682; the difference is only the margin rule. At 2048 × 512 the margin is 32 texels across U and 8 down V, so the bilinear, trilinear and anisotropic taps of the finer levels never reach across the wrap.

### 3. Non-square mip chains survive WolvenKit

The probe's supplied levels (backgrounds 40, 60, 80, …, 7 levels down to 1 × 1) are all stored and exported unchanged; WolvenKit does not regenerate them. In the real builds the 12-level 2048 × 512 chains pass the verifier's byte-for-byte supplied-chain check and its decoded-chain check [resource]. Below 4 texels a dimension, levels halve along the other side only; the builder's rule is the two-texel mean, which the verifier restates.

### 4. Block compression on fine detail

Decoded level 0 (WolvenKit's BC7 colour and BC4 scalars) against the compiler's exact bytes, on the [diagnostic collection](#diagnostic-collection) ([`result.json`](result.json), [`measure.ts`](measure.ts)) [offline]:

| Preset | Grid | Edge texels | Coverage error on edges (mean / p95 / max) | Colour error (mean / p95) |
|---|---|---:|---|---|
| Lines · new density | 2048 × 512 | 9,181 | 0.0096 / 0.027 / 0.12 | 0.0010 / 0.0039 |
| Lines · old density | 1024² head | 661 | 0.0046 / 0.014 / 0.098 | 0.0013 / 0.0078 |
| Board 1 · new density | 2048 × 512 | 40,820 | 0.0031 / 0.009 / 0.036 | 0.0003 / 0.0000 |
| Board 1 · old density | 1024² head | 2,948 | 0.0055 / 0.022 / 0.071 | 0.0005 / 0.0039 |
| Shimmer · new density | 2048 × 512 | 41,245 | 0.0032 / 0.008 / 0.024 | 0.0003 / 0.0039 |
| Shimmer · old density | 1024² head | 2,968 | 0.0039 / 0.020 / 0.053 | 0.0005 / 0.0039 |

Compression error stays small at the new density. The line pattern's sharpest edges (feather 0.0005, the recipe's minimum) have the largest errors, as expected of 4 × 4 blocks that hold a full 0→1 step; nothing approaches the verifier's gates. Facet normals (BC5) decode with a mean error of 0.0031 at the new density against 0.0074 at the old.

## Density and memory

| Texture | Texel on the lids (U × V) | Plate texels | GPU memory per flat / faceted preset |
|---|---|---:|---|
| Head atlas 1024² (before) | 0.56 × 0.40 mm | about 69,000 in the plate's rectangle | 2.67 / 4.00 MiB |
| **Window 2048 × 512 (now)** | **0.13 × 0.12 mm** | about 985,000 | **2.67 / 4.00 MiB** |
| Window 4096 × 1024 (option) | 0.065 × 0.059 mm | about 3.9 million | 10.7 / 16.0 MiB |

(Area-weighted medians of 569 mm per unit U and 405 mm per unit V, from experiment 018. Memory is block-compressed with the full chain: BC7 diffuse, BC4 roughness and metalness, BC5 normal.)

**Decision.** Flat and faceted presets use 2048 × 512: today's texel count and memory, about 4.3 times the linear density across the lids and 3.3 times down them (14 times the texels per mm²). 4096 × 1024 would quadruple memory and archive size for detail that the recipe cannot yet author (the minimum feather is about 0.28 × 0.20 mm) and that screens resolve only at extreme close-up; it is the natural size for a future Glitter route, not for flat colour. The Fresnel route stays on the 1024 head atlas (next section).

## What changed per route

| Route | Template | Texture space | Why |
|---|---|---|---|
| Flat (`@preset`) | `mesh_decal.mt` | 2048 × 512 window, material carries the four UV constants | The template transforms UVs |
| Faceted (`@faceted`) | `mesh_decal.mt` | 2048 × 512 window, same constants | Same. Shimmer facets keep their authored size (UV-anchored cells); their edges now ramp over one window texel instead of one head texel, so fewer facet texels are partial |
| Fresnel (`@fresnel_…`) | `mesh_decal_gradientmap_recolor_blendable.mt` | 1024² head atlas, no UV constants | The template has no `UVScale`/`UVOffset` parameters. Its pixel program `3456408455936683438` computes the UV only through the flipbook: t = (floor(F) + u)/`AnimationFramesWidth`, (v − floor(F/W))/`AnimationFramesHeight`. Fractional frame counts would act as a pure scale (a window with a circular shift under the wrap sampler), but that repurposes animation parameters the engine may treat as integers; it is recorded here as an untested option [hypothesis], not used |

A diagnostic knob, `uvSpace: "head"` in a collection's `xfs/export-diagnostics-1` entry, keeps a flat or faceted preset on the 1024 head atlas without the UV constants (entries `@preset_head`, `@faceted_head`, or `@flat_<hash>_head` with a surface override). The Studio never writes it; the verifier restates it.

## Resolving power

Coverage profiles through the line and dot patterns as the game samples them (bilinear through each preset's own mapping, decoded textures), at levels 0–2. Modulation is the peak inside a line or dot minus the gap beside it; 1 is fully resolved [offline]:

| Pattern | New L0 | New L1 | New L2 | Old L0 | Old L1 | Old L2 |
|---|---:|---:|---:|---:|---:|---:|
| Line 0.3 mm | 0.96 | 0.61 | lost | lost | lost | lost |
| Line 0.6 mm | 1.00 | 0.96 | 0.61 | 0.90 | 0.32 | lost |
| Line 1.2 mm | 1.00 | 1.00 | 0.99 | 1.00 | 0.80 | 0.05 |
| Line 2.4 mm | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.74 |
| Dots 0.5 mm | 1.00 | 0.89 | 0.34 | 0.55 | 0.03 | 0.01 |
| Dots 1 mm | 1.00 | 0.99 | 0.94 | 0.96 | 0.48 | 0.04 |
| Dots 2 mm | 1.00 | 1.00 | 1.00 | 0.99 | 0.97 | 0.41 |

At a given framing the window's level is about two above the head atlas's. So close up (both at level 0) the window resolves 0.3 mm lines and 0.5 mm dots that the head atlas loses; at face framing (window about level 1–2, head atlas level 0) both resolve about the same, because the screen, not the texture, is then the limit.

## Diagnostic collection

[`uv-window.collection.json`](uv-window.collection.json), generated by [`make-diagnostic.ts`](make-diagnostic.ts): six presets plus Off in the XF selector, in pairs that differ only in texture space (names at most 22 characters):

| Preset | Content | Space |
|---|---|---|
| Lines · new density | Left lid: horizontal lines 0.3, 0.6, 1.2 and 2.4 mm tall with equal gaps. Right lid: rows of square dots 0.5, 1 and 2 mm wide. Dark matte, the sharpest edge the recipe allows | Window |
| Lines · old density | The same | Head atlas (`uvSpace: "head"`) |
| Board 1 · new density | The finish board's Board 1 (Matte, Satin, Glossy / Metallic, Glossy, Matte stripes), unchanged | Window |
| Board 1 · old density | The same | Head atlas |
| Shimmer · new density | The finest Shimmer the recipe allows (256 cells, doubled: facets about 0.7 × 0.5 mm), tilt 1, over both lids | Window (faceted) |
| Shimmer · old density | The same | Head atlas (faceted) |

**Build** (25 September, WolvenKit 9.0.1, game 2.31, built-in plate mesh `58081caf…`, morph `b8b7c055…`): passed the independent verifier with 24 members (20 textures, 4 material entries: `@preset`, `@preset_head`, `@faceted`, `@faceted_head`). Archive 1,138,688 bytes, SHA-256 `cb392cd3e95bae6f039f964cfb5d98513eb4f4dadbea27d5273a1fcff91b4169`; `.archive.xl` `f0297e7c2a2c8eb65c082bf14deefe2c8f64f343347e4d0e5b1e1a4249a8c10c`. Plate-sample mapping on the window presets: mean coverage error 0.018 (Lines, the sharpest edges), 0.0008 (Board 1) and 0.0008 (Shimmer), none off by more than 0.5. It is **not staged**; the private output stays in the building checkout's ignored `build/` and `dist/`.

### Test card (for a session after staging)

1. **Placement first.** Close up, switch Lines new → old → new. The two must sit in exactly the same place on both lids; any vertical offset, mirror or sideways shift means the window's constants or row order are wrong in game, and nothing else on this card matters until it is fixed.
2. **Lines, close up.** Expect the new density to show all four lines on the left lid and every dot row on the right, with crisp edges; the old density loses the 0.3 mm line and blurs the 0.5 mm dots.
3. **Lines, pull back slowly to face framing.** Both should converge; note any shimmering or crawling of the fine lines on the new density while moving (a too-sharp mip transition).
4. **Board 1, new against old,** close and at face framing: the same finishes; edges sharper on the new density, nothing else different.
5. **Shimmer, new against old,** close up with a light sweep: the new density should show individual small facets flashing; the old one a mottled gloss.
6. **Edges of the plate:** look at the temples and the brow end of the plate on the new presets for any seam or smear at the plate's border (the window's margin).
7. Blink and slow head turn on Lines new.

Record the game version, upscaler and mode, and keep the ArchiveXL log.

## Rebuilds

The finish board and the four-preset fixture were rebuilt with the window and pass the independent verifier. Before is the same code without the window (`60a60e9`), built the same day with the same tools and plate:

| Collection | Members | Archive before | Archive after | After, SHA-256 |
|---|---:|---:|---:|---|
| [Finish board](../016-finish-board/finish-board.collection.json) | 21 (17 textures) | 839,680 bytes | 937,984 bytes | `76a8915fb6864602fb02243bcb1cabc729717401a9aaf11be8685aa05f25409c` |
| [Four-preset fixture](../005-preset-collection/editor-collection.json) | 16 (12 textures) | 839,680 bytes | 1,003,520 bytes | `12e02fa774e2835ceddf7568521f8427948c2529d3a2c10e95270c245a3fe9eb` |

Before: board `e555e73c9b1c323cb9abc5709bef57d4159c15a994f5e4bd7e88af4faa88861b`, fixture `0dd368faa57c9cd72a7f20adf5c4a8c42755da2a889456b7aa7a71c299ec74ee`. The `.archive.xl` files are unchanged (board `75ff8bbe…c556`, fixture `5789485c…48cb`). The archives grow by 12 % and 20 % because the compressed textures hold more distinct detail; GPU memory per preset is unchanged. On the board, the Fresnel presets' textures, the `.app`, the customization resource and the morph target are byte-identical to before; the mesh differs only in its material values.

## Reproduce

```powershell
bun experiments/019-uv-window/make-diagnostic.ts
cd projects/xf-studio/authoring
bun tools/build_collection_package.ts --collection ../../../experiments/019-uv-window/uv-window.collection.json --plate <plate>/resources --plate-manifest <plate>/plate-manifest.json --wolvenkit <WolvenKit.CLI.exe> --gamepath <game> --diagnostics
bun tools/uv-window-probe.ts ../build/<build>                                  # the mapping gate against wrong alternatives
cd ../../..
bun experiments/019-uv-window/measure.ts projects/xf-studio/build/<build> --json experiments/019-uv-window/result.json
python experiments/019-uv-window/probe_xbm.py --wolvenkit <WolvenKit.CLI.exe> --gamepath <game> --work <empty dir>
```

## Limits

- Offline only. The game's own sampling of the window (its derivatives, anisotropy and any upscaler mip bias) is untested; the test card's first step is the runtime check.
- The mapping gate compares against the recipe evaluator's own head-UV coverage, cropped from its 4096-texel head-atlas raster. It proves where the window's texels land, not that the evaluator is right.
- The stored-row check decodes BC4 only. Colour (BC7) and normal (BC5) maps are imported by the same WolvenKit path and are assumed to share the row order.
- Framings and mip levels follow experiment 018's estimates.

## Provenance

- **Game resources.** CD PROJEKT RED's installed game 2.31, read-only: the plate derived from the player head, and the compiled programs from `shader_final.cache`.
- **Tools.** WolvenKit CLI 9.0.1 for import, serialization, export and packing; dxil-spirv and SPIRV-Cross (as in the [shader-system notes](../../research/materials/shader-system/README.md)) for the decompiled listings.
- Everything tracked here (generators, probe, numbers) is asset-free.
