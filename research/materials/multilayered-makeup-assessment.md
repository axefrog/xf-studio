# Can the multilayered shader compile eye-makeup presets?

Research prompted by Nathan's supplied [materials overview](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials) and [multilayered guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials/multilayered), read 2026-09-23. The latter explains masks (`mlmask`), layer settings (`mlsetup`) and reusable surfaces (`mltemplate`), describes up to 20 surfaces and lists a clearcoat variant. Its last documented edit is October 2024; treat the stated limit and technical property descriptions as leads for current-source checks.

CDPR's technical art director explains the original system in [A World Full of Substance](https://magazine.substance3d.com/cyberpunk-2077-a-world-full-of-substance/) (December 2020). Shared tileable surface maps and small coverage masks reduce duplication; microblends add fine transition detail. The engine uses compute shaders to prepare visible layers in a runtime texture. Their external preview deliberately matches shader inputs and tone mapping. This is primary historical support for resource reuse and a calibrated studio preview, not proof that a particular current shader can overlay makeup on skin.

## Current local evidence

Serialized the previously extracted authoritative `engine/materials/multilayered.mt` with WolvenKit 8.17.4 (game-version metadata 2310) and compared it with `base/materials/mesh_decal.mt`. [Machine-readable evidence](evidence/multilayered-decal-passes.json) records resource/JSON hashes, parameter names, every technique's feature flags and active render-target states. Reproduce with `projects/xf-appearance-studio/tools/inspect_material_passes.py` after serialization. Original game files untouched.

- Standard multilayered: `canBeMasked=0`; all seven recorded passes enable depth writes and disable blending. Includes depth prepass and G-buffer stages. Its exposed parameters reference MultilayerSetup/Mask and runtime layer/atlas data; no exposed cosmetic alpha controls appear in this template.
- Mesh decal: `canBeMasked=1`; the inspected post-G-buffer pass disables depth writes and uses source-alpha/inverse-source-alpha blending on three targets. Exposes independent colour, normal and roughness/metalness coverage controls. A separate G-buffer technique DOES write depth, so do not generalize that every mesh-decal pass disables it. The earlier compiled skinned-decal investigation applies to the selected post-G-buffer variant.

**Conclusion:** the stock standard multilayered template is not a drop-in transparent replacement for the eye plate's decal material. This conclusion is about the inspected resource, not a proof that all variants or approaches are impossible. Changing a `.mt` blend flag alone does not create missing shader alpha outputs or preserve skin shading.

## Practical research sequence

1. Trace multilayer compute outputs and surface blending: can its colour/normal/roughness/metalness results be reproduced offline and consumed by a cosmetic decal, with separate overall and normal coverage?
2. Compare CPU-baked channel maps with a layered reference. Flattening overlapping roughness/normal maps is not generally equivalent to preserving several reflective lobes; use deliberate matte/metallic/glitter overlap examples.
3. Inspect multilayer clearcoat and other relevant variants for their actual transparency/coverage behavior. Shipped compiled shader data and authoritative parameters can eliminate unsuitable candidates before game tests.
4. Keep a small coordinated decal stack as a comparison backend under the SAME preset selector. One selector does not require one draw call. Compile only authored combinations and deduplicate repeated masks/material inputs.
5. Batch a minimal two-preset/Off diagnostic to compare coverage, skin preservation, eyelid deformation, order, highlight motion and clearing of previous components. No game launch is required yet.

The desired outcome remains a compact compiled layered preset. Neither a stock `.mlsetup` solution nor faithful flattening of every finish is established. The studio source recipe must remain editable regardless of output representation.
