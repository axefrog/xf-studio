# Glitter

**Status:** preview only. Check and Build omit active Glitter layers with that reason. A game route is now designed and measured offline (resolved glint flakes, below), but it is not built and has not been seen in game. The engine reasoning is in [Glitter in game](../../../knowledge/glitter-in-game.md).

## Intended look

Individually visible reflective flakes of varied size and spacing over visible pigment. Areas range from dense to sparse. Highlights should merge toward a fine sheen at distance, with no unrelated flicker ([finish taxonomy](../makeup-finish-taxonomy.md), [glitter backlog](../../backlog/glitter-material.md)). The supplied references 1, 2 and 4 show gold and pale flakes over purple and pink pigment, so flake colour is independent of the base ([reference review](../glitter-reference-review.md)).

## Engine routes, ranked

| Rank | Route | Evidence | What it can and cannot do |
|---|---|---|---|
| **1 (proposed)** | **Resolved glint flakes.** `mesh_decal` in `NormalsBlendingMode` 1 with a **plate-local UV window**: `UVScale`/`UVOffset` map only the plate's UV rectangle onto a 4096×1024 texture, about 0.06 mm per texel instead of today's 0.4–0.56 mm. Flat, strongly tilted flakes (0.2 mm median, tilt up to 50°) at roughness 0.22 and metalness 0.85, with their own colour. A flake mask in `NormalAlphaTex`, and normals dilated past each flake. A **nested mip chain** re-draws flakes at least 2 texels wide on every level. | Channel semantics, UV transform, sampler and temporal clamp [source]; non-square XBM [resource]; mip survival [offline] ([experiment 018](../../../experiments/018-glitter-route/README.md)) | Real light- and view-dependent points wherever a flake covers at least 2 pixels: close up and, via larger representatives, at face framing; sheen only at gameplay distance. One normal per pixel: no sub-pixel glints. Offline, after the temporal clamp, the nested chain keeps 3 times the sparkling pixels of a BOX chain at about face framing, and 30 times one level further. |
| 2 (fallback) | Rank 1 plus an **emissive sparkle accent** on a second plate chunk (`mesh_decal_emissive_subsurface`): 8 % of the same flakes as an `EmissiveMask` in a 2048 head-UV atlas (the template has no UV transform) | Masks and constants only; no light or view input [source] | Points that stay visible at any distance, but glow regardless of lighting. Must be labelled a stylised sparkle. |
| — | The faceted Shimmer bake with fewer cells and more tilt | Same program; facets are UV-cell discs in the head-UV atlas. Board 2's coarse "glitter proxy" (`cells` 32) makes discs of about 5.6 mm; 017's *Shimmer · strong* makes 2.8 mm discs. | Sequins or hammered metal, not glitter. It cannot get finer without the window. |
| — | Per-flake Fresnel in `mesh_decal_gradientmap_recolor_blendable` | Its Fresnel term uses the normal-mapped normal [source] | A view-only twinkle, added to albedo (at most white) with one shift colour per draw. A possible later variant. |
| — | `metal_base_glitter.mt`, `mesh_decal_particles.mt`, multilayered | Noise/time emission, a time-driven flipbook, and an opaque surface respectively [source] | Rejected |

The installed community glitter eyeshadow (*Winterkissed*, Limerence × AllieKat) confirms that modders ship glitter through plain `mesh_decal`. It uses 4096² maps on the vanilla eye-makeup UVs, near-1 metalness and embossed outline normals. Its outline normals give the ring pattern our reference review rejected, so rank 1 uses flat flakes instead ([experiment 018](../../../experiments/018-glitter-route/README.md#community-glitter-winterkissed)).

## Why the guard stays

The browser Glitter models (recipes 7–10) compute glints per fragment from sub-pixel facet populations. The game can draw only resolved flakes, and its temporal filter dims one-pixel glints. Exporting those recipes would silently turn them into something else. Rank 1 needs its own **game-matched model** (physical fields: flake colour, width in mm, covered area, tilt spread, sharpness, reflectance) and a passing in-game board before the guard lifts. The backlog rule stands: do not lift the guard on browser sparkle alone.

## What the preview must do (when rank 1 is built)

Upload the export's window maps with their exact nested mip chains through the same UV transform. Compose one normal per pixel as the decal does. Light with Burley diffuse plus the skin class's two GGX lobes. Do not evaluate glints per fragment. State the one known gap: the browser has no temporal clamp. Details: [Glitter in game §5](../../../knowledge/glitter-in-game.md#5-what-the-studio-preview-must-match).

## Risks of rank 1

- **V orientation.** The window's V sign follows the compiler's image-row convention; check it on a decoded export.
- **Compression.** BC5 on 3-texel flakes, and WolvenKit's handling of supplied chains for non-square maps: verify offline.
- **Upscaler mip bias.** An upscaler's negative mip bias (if the engine applies one) moves sampling one level finer, shrinking representatives toward 1 pixel.
- **Upscaler behaviour.** DLSS, FSR3 and XeSS are closed; their treatment of 2–3 pixel glints is unknown.
- **Metallic flakes going dark.** Fully metallic flakes may look like dark dots when unlit; the board tests metalness 1.0 / 0.6 / 0.25.
- **Mixed presets.** One UV window per preset draw: a preset that mixes Glitter with other finishes compiles all of them in the window. That is harmless and sharper.

## Single most informative in-game test

The board's **Glitter B · mips** at close-up, pulled back slowly to face framing. If the nested (left) lid keeps flashing points to face framing while the BOX (right) lid turns to mottle, rank 1 and its mip strategy are right. If neither lid shows points even close up, the temporal filter or upscaler suppresses them and the fallback accent becomes the route. *Glitter A* answers the plain "does it read as glitter" question at the same time.
