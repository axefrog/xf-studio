# XF Appearance Studio makeup classes and glitter

Current scope supersedes the historical four-label limit: [seven familiar finish families](../materials/makeup-finish-taxonomy.md), with metallic separate and glossy/colour-shifting preview candidates added. Research must now support [compiled complete presets](../../projects/xf-appearance-studio/data/product-direction.md) under one in-game selector. Investigate mixed-finish flattening, real multilayered materials and coordinated components without losing coverage or reflection behavior. Nathan supplied the wiki [materials overview](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials) and [multilayered guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials/multilayered) as explicit research leads.

Initial investigation is now [recorded here](../materials/glitter-shader-investigation.md): actual material template located, shipped shader cache indexed, 78 glitter shader programs extracted locally, and one skinned variant disassembled. The named FX shader's emissive behavior and different depth/blending pipeline make it a research lead rather than a finished cosmetic material. Game/browser glitter implementation remains outstanding.

First reflective browser candidate and identical texture bakes are now [Experiment 002](../../experiments/002-flake-material/README.md). Fineness, density and orientation controls work on the real plate; light and view change the response. Dark speckling, game mapping and subpixel filtering remain unresolved. Nathan approved **Satin** as the user-facing label for internal `regular`, and welcomes useful unsolicited insights throughout the work.

[Experiment 003](../../experiments/003-decal-material-import/README.md) now supplies ten checked XBM textures and ten material instances. The [decal shader contract](../materials/mesh-decal-shader-contract.md) identifies the channel reads, independent blend weights, squared alpha and normal blending branch. Resource serialization and base-mip compression are verified; appearance/deformation/runtime tests are still outstanding.

Explicit user requirement, 23 September 2026: preserve the intent of four classes, including a convincing glitter material which was never properly implemented. Current browser matte/satin/metallic studies are provisional and do not fulfil the four game finishes.

Legacy labels are **matte, regular, shimmer, glitter**. `D:/Dev/xf-omega/source/projects/xf-eye-artistry-ccxl/materials.ts` emits identical property sets for matte/regular and for shimmer/glitter; those names are not evidence of working distinct effects. Reimplement their intended appearances cleanly.

## Investigation and deliverables

1. Map REDengine material resources, inheritance, channel packing, render states and shader selection. Locate actual game `.mt`, `.mi`, relevant shader/cache resources and shipped shader information using archive inventories and WolvenKit/RED4 sources. Nathan specifically suggested shipped shaders as references; establish what exists and is inspectable rather than assuming editable source is bundled.
2. Search installed mod/game materials for useful sparkling cosmetics, flake paint, fabrics, jewellery and other glitter-like responses. Trace real dependencies and parameters; distinguish glints from emission, static speckles, rough metallic surfaces or animated particles.
3. Design separate regular/shimmer/glitter responses. A glitter candidate should support sparse flake size/density/orientation, light/view-dependent glints, base pigment, roughness and coverage. Assess what the existing engine shaders permit before proposing custom shader execution. Prototypes are hypotheses until verified.
4. Build a browser approximation from the same masks/parameters and a reproducible light/camera study. Handle minification, aliasing and temporal stability. Visible sparkle should respond to lighting/view rather than unrelated random flicker. Keep browser/engine differences explicit.
5. Package a small comparison matrix of all four classes, palettes and overlap layers, then include it in one batched game-validation session. Measure loading/cache cost as well as appearance. No separate launch for each material adjustment.

Acceptance: four intentionally distinct useful classes, a convincing glitter effect in-game, documented resource/shader implementation, a useful browser preview, and captured comparison evidence. Do not mark complete from finish names, thumbnails, a metallic slider or browser-only output.

Related: [ArchiveXL strategy](../archive-xl/eye-artistry-strategy.md), [authoring queue](eye-artistry-authoring.md), [validation](../../docs/validation.md).
