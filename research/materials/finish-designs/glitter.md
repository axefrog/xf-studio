# Glitter

**Status:** preview only. Check and Build omit active Glitter layers with that reason. The game route (resolved glint flakes, below) is built as a **diagnostic** route that only a prepared board reaches, and it has been in game once:
- **Session 6 (29 September), board 1's Glitter A**, judged by hand under movable lights: "doesn't seem much like glitter". The flecks looked printed on top of the purple base, with little light response.
- The route is now reworked as **glitter flakes 2**, which reproduces the Studio's glint models ([experiment 032](../../../experiments/032-finishes-rework/README.md)). It is built into board 2 ([experiment 021](../../../experiments/021-glitter-board/README.md)) for the [session-7 checks](../../runtime/runtime-bridge-test-card.md#session-7-checks-bridge-053).

**Glitter ships in 1.0 only if board 2 passes in game.** The engine reasoning is in [Glitter in game](../../../knowledge/glitter-in-game.md).

## Intended look

Individually visible reflective flakes of varied size and spacing over visible pigment. The agreed physical picture (session 6): **sparse, larger flakes at random angles, each flashing on its own as its angle aligns**. Shimmer, by contrast, is dense fine platelets lying mostly flat ([Shimmer](shimmer.md)). Areas range from dense to sparse. Highlights should merge toward a fine sheen at distance, with no unrelated flicker ([finish taxonomy](../makeup-finish-taxonomy.md), [glitter backlog](../../backlog/glitter-material.md)). The supplied references 1, 2 and 4 show gold and pale flakes over purple and pink pigment, so flake colour is independent of the base ([reference review](../glitter-reference-review.md)).

## Glitter flakes 2: the Studio's models in the game

The Studio's glint models, Direct-light glints, Clustered fine glints and Dense fine speckles, looked right to the maintainer; the classic macro dots did not. The reference is the maintainer's "Glitterati" preset, read from a copy of the library: Dense fine speckles, density 0.88, fine share 0.88, strength 16, pink `#fa006c` over `#620422` ([experiment 032 §1](../../../experiments/032-finishes-rework/README.md#1-the-reference-models)).

[`glitter-studio-flakes.ts`](../../../projects/xf-studio/authoring/src/glitter-studio-flakes.ts) maps a glint layer's settings onto the route's flakes as faithfully as the decal allows:
- **Where the flakes are:** the model's own count per mm² and cluster envelope.
- **How big they are:** its facet sizes, but never below two window texels (0.13 mm), plus its large population.
- **How they tilt:** a **14° floor** above mode 1's fade, then |N(0, 16°)| to 65°.
- **How they shine:** per-flake roughness and metalness set by the glint strength (0.20–0.34 and 0.85–1 at full strength).
- **What lies underneath:** the layer's colour at the Studio's glint base surface (roughness 0.55).

The route's nested mips are unchanged. The verifier restates every rule, including the new "no flake under its floor".

Offline, the floor removes what made board 1 look printed [offline]:
- 37 % of board 1's flake texels sat under the fade.
- At a macro framing, 32 % of its flakes were brightest exactly where the lid's own sheen is, and up to 43 % lit at once.
- With the flakes-2 normals, no flake fades, 1–2 % peak with the skin, and twinkle rises by half.

The reference model's two-texel flakes resolve at a macro framing but give way to sheen by 0.1 mm per pixel, so board 2 tests both it and board-1-sized flakes ([experiment 032 §2](../../../experiments/032-finishes-rework/README.md#offline-evidence)).

## Engine routes, ranked

| Rank | Route | Evidence | What it can and cannot do |
|---|---|---|---|
| **1 (proposed)** | **Resolved glint flakes.** `mesh_decal` in `NormalsBlendingMode` 1 with a **plate-local UV window**: `UVScale`/`UVOffset` map only the plate's UV rectangle onto a 4096×1024 texture, about 0.06 mm per texel instead of today's 0.4–0.56 mm. Flat, strongly tilted flakes (0.2 mm median, tilt up to 50°) at roughness 0.22 and metalness 0.85, with their own colour. A flake mask in `NormalAlphaTex`, and normals dilated past each flake. A **nested mip chain** re-draws flakes at least 2 texels wide on every level. | Channel semantics, UV transform, sampler and temporal clamp [source]; non-square XBM [resource]; mip survival [offline] ([experiment 018](../../../experiments/018-glitter-route/README.md)) | Real light- and view-dependent points wherever a flake covers at least 2 pixels: close up and, via larger representatives, at face framing; sheen only at gameplay distance. One normal per pixel: no sub-pixel glints. Offline, after the temporal clamp, the nested chain keeps 3 times the sparkling pixels of a BOX chain at about face framing, and 30 times one level further. |
| 2 (fallback) | Rank 1 plus an **emissive sparkle accent** on a second plate chunk (`mesh_decal_emissive_subsurface`): 8 % of the same flakes as an `EmissiveMask` in a 2048 head-UV atlas (the template has no UV transform), `EmissiveEV` 1 so it writes the flake colour itself (the template multiplies by it directly; 0 is black) | Masks and constants only; no light or view input [source] | Points that stay visible at any distance, but glow regardless of lighting. Must be labelled a stylised sparkle. |
| — | The faceted Shimmer bake with fewer cells and more tilt | Same program; facets are UV-cell discs in the head-UV atlas. Board 2's coarse "glitter proxy" (`cells` 32) makes discs of about 5.6 mm; 017's *Shimmer · strong* makes 2.8 mm discs. | Sequins or hammered metal, not glitter. It cannot get finer without the window. |
| — | Per-flake Fresnel in `mesh_decal_gradientmap_recolor_blendable` | Its Fresnel term uses the normal-mapped normal [source] | A view-only twinkle, added to albedo (at most white) with one shift colour per draw. A possible later variant. |
| — | `metal_base_glitter.mt`, `mesh_decal_particles.mt`, multilayered | Noise/time emission, a time-driven flipbook, and an opaque surface respectively [source] | Rejected |
| — | The car-paint metallic flake layer (`car_paint_metallic_01.mltemplate` on the vehicles' multilayered `vehicle_destr_blendshape.mt`, with its forward coat pass) | Opaque multilayered surface; the flakes are a tiled 512² one-texel noise normal at 6–9° of tilt [resource] [offline] ([experiment 032 §5](../../../experiments/032-finishes-rework/README.md#5-an-isolated-alternative-the-car-paint-metallic-flake-layer)) | Rejected for the plate: replaces the skin, no soft coverage, the coat lands only on its own base pass. Its flakes would all fade in our decal; they are a car's micro-sparkle (Shimmer's pattern), not glitter |

The installed community glitter eyeshadow (*Winterkissed*, Limerence × AllieKat) confirms that modders ship glitter through plain `mesh_decal`. It uses 4096² maps on the vanilla eye-makeup UVs, near-1 metalness and embossed outline normals. Its outline normals give the ring pattern our reference review rejected, so rank 1 uses flat flakes instead ([experiment 018](../../../experiments/018-glitter-route/README.md#community-glitter-winterkissed)).

## Why the guard stays

The browser Glitter models (recipes 7–10) compute glints per fragment from sub-pixel facet populations. The game can draw only resolved flakes, and its temporal filter dims one-pixel glints. Glitter flakes 2 is now the defined translation of those models into resolved flakes, but only board 2 uses it, through the diagnostic knob. The guard lifts, and a Glitter layer exports through that mapping, only after board 2 passes in game. The backlog rule stands: do not lift the guard on browser sparkle alone. The game-matched preview (below) is still to build.

## Studio UX (for the design gate)

The UI change is minimal and uses only existing components, so the design gate should review it as a small change:
1. **The model choice shows to everyone.** It is the existing `ChoiceList` in rows in the Colour & finish panel's Glitter section; before, it showed only with research tools on.
2. **The glint models come first:** Direct-light glints, Clustered fine glints, Dense fine speckles. Classic reflective flakes (the macro dots, the seed of the banked Pattern finish) and Irregular raster flakes are listed only with research tools on, or on a layer already using one, so its current value always shows.
3. **A layer that becomes Glitter starts in Direct-light glints**, not the classic dots. It gets its own earlier settings for that model if it had them; its classic settings are kept for the classic study.

No copy, component or style-guide entry changed. The captures for the gate show the Colour & finish panel on a layer that has just become Glitter, floated at 300 and 480 px, in light and dark, with research tools off and on: [the eight captures](../../../projects/xf-studio/authoring/evidence/glitter-model-choice-2026-09-29/), made by [`tools/glitter-model-look.ts`](../../../projects/xf-studio/authoring/tools/glitter-model-look.ts) in an isolated `?verify=1` workspace. The pattern followed is the same `ChoiceList` rows the panel already used for these models with research tools on.

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
