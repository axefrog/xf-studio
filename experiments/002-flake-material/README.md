# Reflective flake material candidate

Status: working browser study and reproducible texture bake; **not a convincing, validated REDengine glitter implementation yet**. This is a material-input experiment for XF Appearance Studio, not a deployed mod.

This experiment studies Shimmer and Glitter using seeded, stationary UV-space facets encoded in tangent-space normals, roughness and metalness. Ordinary Three.js lighting supplies reflections; there is no emissive sparkle or time-based texture animation. Shimmer has twice the cell frequency, gentler orientation spread, broader reflection and less metalness than glitter. Fineness, density and orientation spread are editable per layer and persist in recipes. `satin` remains an alias for `regular`; **metallic is a separate finish**, never an alias for shimmer. The expanded seven-family editor menu is documented in the [finish taxonomy](../../research/materials/makeup-finish-taxonomy.md); this flake experiment still only bakes its two candidates.

Use **Head & lighting → Key light angle** and orbit separately to assess the response. Lights now target the head instead of the world origin. Preview minification uses ordinary mipmapping and anisotropic filtering; it does not preserve the full distribution of subpixel facet orientations. Current UV placement is not a constant physical flake size over arbitrary body meshes. Glitter can still appear as dark speckles at some angles, and shimmer is not yet a calibrated pearlescent model. These observations require refinement, not a claim of completion.

## Reproduce

From `projects/xf-studio/authoring`, run `bun tools/bake_finish_study.ts`. It uses the same `src/finish.ts` baker as the browser, writes under this experiment's ignored `generated/` folder and uses local Pillow to encode PNGs. Two 1024-square candidates produce ten PNGs: normal XYZ, packed coverage/roughness/metalness, and each scalar channel separately. Both raw maps remain available for byte comparisons. [Result](result.json) records hashes and exact PNG decode comparisons for all ten files.

The browser interprets normal XYZ as linear tangent-space data, with UV0 top-left and no Y image flip. That states our convention; it is not proof of REDengine import conventions. Do not ship the PNGs merely by naming them `.xbm`. Verify importer texture groups, normal channel encoding, compression, orientation and all relevant `mesh_decal` blend weights first. Main editor **Export mask** still exports shape coverage only; these CLI-baked finish maps are a separate research output.

## Verification, 2026-09-23

- 19 authoring tests, typecheck and build passed. New checks cover deterministic seed behavior, normalized encoded normals, zero-density flat/nonmetallic output, bounded settings, old finish aliases and unchanged shape coverage across finishes.
- In isolated `?verify=1`, selected glitter/shimmer/satin, moved the camera and key light, set density to zero and observed flakes disappear, then used Undo to restore 65%. No shader warnings/errors were reported during these checks. Refined shimmer uses smaller/weaker facets after visual inspection of its overly speckled first candidate.
- Recipe retains the finish after reload. Nathan's active browser draft was not used for testing. A startup race found during verification now applies the Surface controls checkbox's current value when the model finishes loading.
- Actual asset loading, skinning and alpha coverage continue to work. This does not prove in-game decal normals, layer compositing, mip stability, or physical accuracy.

The first import and selected decal shader trace are now complete in [Experiment 003](../003-decal-material-import/README.md). It includes explicit blend weights, both normal modes/signs, independent normal coverage and colour-alpha compensation. Next, assemble the actual mesh/morph/app fixture and compare variants in the already planned batched runtime session. Additional candidate models may be necessary to avoid excessively dark flakes while retaining light-dependent highlights.
