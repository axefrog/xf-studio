# Glitter

**Status:** preview only. No export route is credible yet; Check and Build omit active Glitter layers with that reason.

## Intended look

Individually visible reflective flakes of varied size and spacing over visible pigment, dense and sparse areas, with highlights merging toward a fine sheen at distance and no unrelated flicker ([finish taxonomy](../makeup-finish-taxonomy.md), [glitter backlog](../../backlog/glitter-material.md)). The supplied references 1, 2 and 4 show gold and pale flakes over purple and pink pigment, so flake colour is independent of the base ([reference review](../glitter-reference-review.md)).

## Engine routes, ranked

| Rank | Route | Evidence | What it can and cannot do |
|---|---|---|---|
| 1 (next candidate) | The **faceted** Shimmer route with coarse, strongly tilted facets and an independent flake colour | Same `mesh_decal` program `16098255505177109230` as [Shimmer](shimmer.md): resolved facet normals in `NormalsBlendingMode` 1, per-texel roughness/metalness. [source] | Real light-dependent flashes where flakes cover more than a pixel (close-up, photo mode). One normal per pixel: flakes smaller than a pixel average away, and with mode 1 they fade out entirely at distance. The board's coarse Shimmer stripe on the left lid of **Board 2** is exactly this route with the classic bake, so it answers whether resolved facets read as glitter at all. |
| 2 | Rank 1 plus a separate sparse emissive component (`mesh_decal_emissive` or `mesh_decal_emissive_subsurface`) | Emissive programs read masks and constants only; no light or view input ([glint feasibility](../redengine-glint-feasibility.md), [particle-decal audit](../../../experiments/009-glitter-game-fixture/particle-decal-audit.md)). [source] | Flecks that stay visible at any distance but glow regardless of lighting. A stylised sparkle, not reflection; needs a second component. |
| — | `metal_base_glitter.mt`, `mesh_decal_particles.mt` | Noise/time emission and an animated atlas respectively. [source] | Not a glint BRDF; rejected. |
| — | A true filtered glint BRDF (per-pixel distribution of facet normals) | No stock template exposes one; no supported shader injection path. [source] | Would need engine-level work. |

## Why the guard stays

The browser Glitter models (recipes 7–10) compute per-fragment glints from sub-pixel facet populations. No stock template can store more than one normal per pixel, so exporting them would silently turn the recipe's glitter into something else. The backlog rule is explicit: do not lift the guard on browser sparkle alone. The board's coarse Shimmer stripe gives the first in-game evidence for rank 1 without presenting it as Glitter.

## What the preview does

Unchanged: the opt-in Glitter models remain browser studies and are labelled preview only.

## Risks of rank 1 when it is built

- Flake colour independent of pigment needs a colour map per texel (possible in `mesh_decal`) but a new recipe/compiler field.
- The facet lattice and circular flakes of the classic bake already failed the visual review; rank 1 would need the irregular flake catalogue baked into maps, which loses its sub-pixel population by design.

## Single most informative in-game test

On the finish board, **Board 2**, left lid, third stripe (coarse Shimmer, 64 cells across the atlas, full tilt): in close photo mode, sweep the key light. If distinct flakes flash and go dark as the light moves, rank 1 is viable for close-up glitter and worth building with an irregular flake bake and a flake colour; if the stripe only looks like a mottled satin, glitter needs the emissive accent (rank 2) or engine-level work.
