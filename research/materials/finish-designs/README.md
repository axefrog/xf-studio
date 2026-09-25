# Finish designs: how each makeup finish reaches the game

One page per finish that goes beyond a flat colour. Each records the intended look, the candidate engine routes ranked by evidence, what the browser preview does to match, the risks, and the single most informative in-game test. The engine facts are consolidated in [materials and shaders](../../../knowledge/materials-and-shaders.md); the export policy lives in [`finish-export.ts`](../../../projects/xf-studio/authoring/src/finish-export.ts).

| Finish | Export status | Route | Evidence grade |
|---|---|---|---|
| Matte, Satin, Metallic | Exports (provisional values) | Flat `mesh_decal` | [source] route; [runtime] untested |
| [Glossy / wet look](glossy.md) | **Experimental** export, game-matched model only | Flat `mesh_decal`, one low-roughness lobe | [source]; look [hypothesis] |
| [Shimmer / pearl](shimmer.md) | **Experimental** export, game-matched model only | `mesh_decal` + facet normals, `NormalsBlendingMode` 1, variance-widened roughness mips | [source]; look [hypothesis] |
| [Colour-shifting](colour-shifting.md) | **Experimental** export, game-matched model, one pigment per preset | `mesh_decal_gradientmap_recolor_blendable` with an additive Fresnel colour | [source]; colour encoding and look [hypothesis] |
| [Glitter](glitter.md) | Preview only | None credible yet | [source] for the limits |

"Game-matched model" means recipe schema `xfs/recipe-11` with a layer `optics` field: the browser preview then follows the export route's arithmetic instead of the earlier browser study. Choosing Glossy, Shimmer or Colour-shifting uses it; layers made earlier keep their original preview until the user presses **Use game-matched model**, and Check omits them with that reason.

All four pages share three engine facts:

1. **One surface per pixel.** The G-buffer stores one base colour, one normal, one roughness and one metalness per pixel; decals blend into those (`SrcAlpha/InvSrcAlpha`, colour in square-root space). No decal can add a clear coat or a second lobe.
2. **One draw per preset.** The Studio flattens a preset into one decal draw on the eye plate. Per-texel inputs (textures) can vary within a preset; material constants cannot. That is why Colour-shifting, whose shift colour is a constant, is limited to one pigment per preset.
3. **Metalness is the only way to raise specular.** Dielectric F0 is fixed at 0.04; F0 = lerp(0.04, albedo, metalness). Metalness ≥ 0.1 moves a Subsurface (skin) pixel off its SSS albedo path.

The next in-game session tests all of these at once with the [finish board](../../../experiments/016-finish-board/README.md).
