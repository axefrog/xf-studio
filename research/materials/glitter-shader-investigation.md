# XF Appearance Studio: initial glitter shader investigation

23 September 2026. Local resource and compiled-code inspection only; no game-rendering validation. The four intended makeup classes remain matte, regular, shimmer and glitter. This research does not yet deliver a convincing glitter material.

## Where the shipped code is

The installed game has `F:/Games/Cyberpunk 2077/engine/shader_final.cache` (161,804,693 bytes) and a separate `staticshader_final.cache`. The inspected main cache uses an RDHS version-10 footer. A read-only inspector built from the structural facts in the local WolvenKit `ShaderCacheReader.cs` and `ShaderStructs.cs` consumed its shader, compilation and parameter regions exactly: 19,037 shaders, 19,647 compilation records, 1,019 parameter sets and 395 template names.

The extracted glitter containers have DXBC headers containing DXIL compiled programs. They are useful references, but are not editable HLSL source. The installed Windows SDK's `dxc.exe -dumpbin` successfully disassembles selected programs. Custom shader injection/replacement is not established by this discovery.

Reproduce the index with `bun projects/xf-studio/authoring/tools/inspect_shader_cache.ts` from HQ. [Index and hashes](evidence/shader-cache-index.json) retain all matching glitter/decal compilation metadata. The 78 distinct glitter shader extracts and disassemblies remain ignored local research under `research/consumers/glitter/raw/shaders/`.

Reader caveat: the reference reader's PixelShader/VertexShader field names disagree with the actual stages in the inspected MeshSkinned record. Our index now preserves first/second field order and identifies the stage from each DXIL program header. Disassembly confirms first GUID `15657999486617040344` is vertex and second GUID `15760075574186250120` is pixel. Unknown parameter metadata bytes remain labelled unknown rather than guessed types/slots.

## The named glitter material is an FX lead

The local archive resource is `base\fx\shaders\metal_base_glitter.mt`. The community [FX material reference](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials/configuring-materials/fx-material-properties) lists the older path with `_shaders`; use the installed archive evidence for this game version.

Observed in the serialized template:

- Standard material with masked rendering support, including MeshSkinned and MeshExtSkinned vertex factories; 66 compilation variants in this cache.
- Main G-buffer passes write depth and disable blending. This differs materially from makeup's `mesh_decal.mt` post-G-buffer pass, which disables depth writes and uses source-alpha/inverse-source-alpha blending on three targets.
- Base colour, metalness, roughness and normal maps coexist with EmissiveMask, EmissiveEV, EmissiveColor, HistogramRange, ScrollSpeed, EmissiveTile, Looped, AlphaFromEmissive and AlphaThreshold controls.
- The selected pixel program computes sine/fraction operations on a shared-buffer value multiplied by ScrollSpeed, combines that with sampled noise, applies HistogramRange and drives an emissive branch. Interpreting the shared value as time is plausible, but its exact global-buffer semantics have not yet been traced.

Inference: the name points to an animated emissive FX mechanism, not evidence of a finished light-dependent cosmetic flake shader. Replacing a soft makeup decal with this template would change depth/blending behavior and needs explicit proof. Its ordinary PBR channels may still provide useful study material.

## Next concrete investigation

The inhaler lead is now traced in [material-chain evidence](evidence/inhaler-material-chain.json). Its primary mesh material derives from `engine\materials\multilayered.mt`; the embedded setup exactly matches the extracted external setup. The setup's layers use `plastic_tech_01_300.mltemplate`. Layer 12 uses `scratches_and_flakes_a.xbm`, with microblend normal strength -1.1, tile 2 and roughness output endpoints approximately 0.3334/0.549. Other mesh materials are glass, a separate emissive part and decals. This is no evidence of the dedicated FX glitter shader or of a cosmetic glitter implementation: the word also belongs to this quest prop's identity.

Compare a microflake normal/roughness treatment on the existing decal pipeline against the FX material. Establish view/light-dependent response, antialiasing and soft coverage before building a browser approximation. Preserve each candidate's parameters and differences from engine shading. Then prepare one batched four-class comparison for in-game validation, including overlap ordering and load/cache costs.

A first [shared-map flake experiment](../../experiments/002-flake-material/README.md) now runs on the actual browser makeup plate, with separate shimmer/glitter candidates, editable facet distribution and a movable key light. Identical raw material inputs bake to ten checked PNGs for later game import. There is no time-driven emission, but glitter remains too speckled at some angles and needs game-side mapping and minification work. This is useful experimental progress, not finished glitter.

Rendering reference: [DreamWorks MoonRay glitter guide](https://docs.openmoonray.org/user-reference/how-to-guides/glitter-shader/) describes randomly oriented reflective flakes, independent distribution controls and filtering at small pixel footprints. Its dedicated rendering lobe is a conceptual reference, not a claim that REDengine or Three.js implements the same model.

Related: [required material task](../backlog/glitter-material.md), [project scope](../../projects/xf-studio/data/naming.md).
