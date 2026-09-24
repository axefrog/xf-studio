# Materials and shaders (REDengine 4, game 2.31)

**Maturity: Draft.** The resource model, template catalogue, G-buffer layout and deferred BRDF are consolidated from source, installed resources and compiled programs. Runtime confirmation is still missing (see [in-game test asks](#in-game-test-asks)).

This page explains how Cyberpunk 2077 materials work well enough to:

- make the browser preview faithful;
- design makeup finishes that have a realistic chance of rendering correctly in game at the first attempt.

Hair is covered only at overview level here. See [hair shading](hair-shading.md) for the in-depth study.

**Evidence grades:**

- **[source]**: engine, framework or tool source, or disassembled compiled programs;
- **[resource]**: installed game or mod resources;
- **[wiki]**: Cyberpunk Modding Docs at commit `be2f44eed8419342ec13f72ed9cab008e9f7b289`;
- **[runtime]**: observed in the running game;
- **[hypothesis]**: not yet established.

**Pinned sources:**

| Source | Version |
|---|---|
| Installed game | 2.31 (`GameVersion 2310` in serialized JSON) |
| `shader_final.cache` | SHA-256 `339145…3ccfa` |
| `staticshader_final.cache` | SHA-256 `bff160…59ff` |
| WolvenKit | CLI 8.17.4; source `11720772` |
| RED4ext.SDK | `ad727771` |
| ArchiveXL | `5474e34d` |
| Cyberpunk Blender add-on | 2.1.0 at `7a4ee793` |
| dxil-spirv / SPIRV-Cross (optional decompile) | `f2d1b554` / `aa217aeb` |

Compiled-program hashes and the reproducible method are in the [shader-system evidence note](../research/materials/shader-system/README.md).

---

## 1. The material resource model

```
mesh (.mesh)
 ├─ appearances[k].chunkMaterials[submesh] ──name──► materialEntries[i] {name, isLocalInstance, index}
 │                                                      │ local                     │ external
 │                                   localMaterialBuffer.materials[index]   externalMaterials[index] (.mi path)
 │                                   (embedded CMaterialInstance)                   │
 └──────────────────────────────────────────────────────┴──► CMaterialInstance ── baseMaterial ──► (.mi …) ──► CMaterialTemplate (.mt/.remt)
                                                                  sparse name→value overrides          parameters, techniques/passes, materialType
```

### 1.1 Resource types

| Extension | RED class | Role | Grade |
|---|---|---|---|
| `.mt`, `.remt` | `CMaterialTemplate` | The shader: typed parameters with defaults, compiled techniques and passes, render states, lighting class. Both extensions are the same class; `.remt` is used mainly by `engine\materials\*` templates. | [source] WolvenKit `FileTypeHelper.cs:284,296` |
| `.mi` | `CMaterialInstance` | `baseMaterial` (a template or another `.mi`), a sparse `values` list of name → Variant, and `enableMask`. | [source] RED4ext `N/CMaterialInstance.hpp:15-19`; WolvenKit `ClassesExt/Appendix/CMaterialInstance.cs:20-40` |
| `.hp` | `CHairProfile` | `gradientEntriesID` and `gradientEntriesRootToTip` (`{value, Color}` stops), plus `sampleCount` | [source] `G/CHairProfile.hpp:20-23` |
| `.sp` | `CSkinProfile` | `blurSize`, `diffuse`, `falloff`, `roughness0`, `roughness1`, `lobeMix` | [source] `G/CSkinProfile.hpp:19-24` |
| `.gradient` | `CGradient` | A list of colour stops, e.g. the eye `IrisColorGradient` | [source] `G/CGradient.hpp:20` |
| `.mlsetup` | `Multilayer_Setup` | An ordered list of `Multilayer_Layer`, plus `ratio` and `useNormal` | [source] `G/Multilayer_Setup.hpp:20-23` |
| `.mltemplate` | `Multilayer_LayerTemplate` | Colour/normal/roughness/metal textures, `tilingMultiplier`, and named override tables | [source] `G/Multilayer_LayerTemplate.hpp:23-31` |
| `.mlmask` | `Multilayer_Mask` | Per-layer masks inside a render-resource blob | [source] `G/Multilayer_Mask.hpp:20` |

### 1.2 Parameter types

Template parameters are `CMaterialParameter*` objects with `parameterName` and `register` [source] (`G/CMaterialParameter.hpp:19-20`).

| Class | Value | References | Grade |
|---|---|---|---|
| `Scalar` | `float` (plus min/max) | — | [source] |
| `Vector` | `Vector4` | — | [source] |
| `Color` | `Color` (bytes) | — | [source] |
| `Texture`, `TextureArray`, `Cube`, `DynamicTexture` | `Ref<ITexture>` | `.xbm`, `.texarray`, `.cubemap` | [source] |
| `HairParameters` | `Ref<CHairProfile>` | `.hp` | [source] |
| `SkinParameters` | `Ref<CSkinProfile>` | `.sp` | [source] |
| `MultilayerSetup`, `MultilayerMask` | refs | `.mlsetup`, `.mlmask` | [source] |
| `Gradient` | `Ref<CGradient>` | `.gradient` | [source] |
| `StructBuffer` | none reflected | runtime data (multilayer `Layers`/`MaskTiles`) | [source] / [resource] |

WolvenKit maps each class to its value field in `MaterialExtractor.cs:626-646`. There is no `.mltemplate` parameter type. A template is reached only through `Multilayer_Layer.material` [source].

**Stage slots.** `parameters`, `usedParameters` and `samplerStates` are three-slot arrays indexed like `EMaterialShaderTarget`: [0] unused, [1] vertex, [2] pixel.

- The indexing is [source]-supported: `G/EMaterialShaderTarget.hpp:12-15`, and WolvenKit reads only slot 2.
- In every template inspected, vertex-animation parameters sit in [1] and all surface parameters in [2] [resource].
- `usedParameters[2]` gives the constant-buffer register the compiled pixel program uses (§3.1).

**Wrong resource type or unresolved path renders black and shiny** [wiki] (`materials/materials-troubleshooting.md` L17-25).

**Inconsistent parameter names.** The same concept has different names across templates (`Albedo`, `BaseColor`, `DiffuseTexture`, `Color`). Always read the template [wiki] (`configuring-materials/README.md` L82-88) [resource].

### 1.3 How an instance chain resolves

| Rule | Grade |
|---|---|
| **Defaults.** The template's parameters supply the defaults. | [wiki] `materials/shaders/README.md` L35-42 |
| **Leaf wins.** Each `.mi` applies its `values` over its base; the mesh-local instance is applied last. | [wiki] `materials/shaders/README.md` L35-42; [source] WolvenKit `MaterialExtractor.cs:278-347` implements the same order |
| **Undeclared names are inert.** A value whose name the template does not declare has no effect. | [wiki] `shaders/README.md` L19 |
| **Unused names are dropped on export.** WolvenKit only exports template parameters present in `usedParameters[2]`. | [source] `MaterialExtractor.cs:389-424` |
| **Cycles crash the game.** A cyclic `baseMaterial` chain does this. | [wiki] `re-using-materials-.mi.md` L29 |
| **Masking.** Effective masking is `template.canBeMasked && instance.enableMask`. A masked (alpha-test) draw uses the pass's `stagePassNameDiscarded` stage (`…_discarded`); the shader cache records it as `Discarded`. | [source] WolvenKit export logic `MaterialExtractor.cs:313-314,386`; the stage link is [hypothesis] |
| **Shared templates.** Never edit a shipped template or a shared `.mi`: every user of it changes. About half the player head skin `.mi` files are shared with NPCs. | [wiki] `configuring-materials/README.md` L22-25; `cheat-sheet-head/README.md` L70-72 |

### 1.4 Mesh-side binding

**Name lookup.** `chunkMaterials[submesh]` names a `materialEntries` entry. That entry's `isLocalInstance` and `index` choose between two lists [source]:

- the local list, `localMaterialBuffer.materials` (embedded CR2W files) or `preloadLocalMaterialInstances`;
- the external list, `externalMaterials` (async `.mi` refs) or `preloadExternalMaterials`.

ArchiveXL loads through exactly this pair (`src/App/Extensions/Mesh/Extension.cpp:410-427`).

**Unnamed chunks.** A chunk without a valid material name renders invisible [source] (WolvenKit `CMeshPreProcessor.cs:144-162`).

**Preload lists.** Do not mix preload and non-preload lists of the same kind [wiki] (`3d-objects-.mesh-files/README.md` L230-241):

- mixing them makes non-preload materials render transparent on first use;
- WolvenKit's export also collides on names when the lists are mixed [source] (`MaterialExtractor.cs:223-271`).

**Dynamic materials (ArchiveXL)** [source] (`Extension.cpp`, `Dynamic.cpp`):

- **Template entries.** A chunk name `prefix@tmpl` binds to a template entry named `@tmpl`.
- **Soft references.** Resource values and `baseMaterial` paths starting with `*` are soft and are substituted:
  - `{material}` is the prefix;
  - `{material.N}` is the Nth `+`-separated part;
  - other `{attr}` tokens come from context attributes.
- **Optional values.** A trailing `?` makes the value optional; if it is unresolved, the parameter is removed.
- **Base chains.** Soft `.mi` base chains are cloned recursively.
- **`@context`.** Local entry 0 named `@context` supplies override parameters and attributes.
- **Emulation gap.** WolvenKit's `Material.json` export only emulates `*` and `{material}` [source] (`ArchiveXlHelper.cs:14-61`). Offline exports of CCXL-style chains can therefore silently fall back to defaults.

---

## 2. Rendering pipeline: what a material can and cannot express

### 2.1 Passes and render stages

Each template holds `techniques[]` → `passes[]`. A pass carries [source] (`G/MaterialPass.hpp:21-30`) [resource]:

- stage names (`stagePassNameRegular`, `stagePassNameDiscarded`);
- depth and stencil state;
- the rasterizer: cull, winding and `offsetMode`, e.g. `OFFSET_DecalBias`;
- per-target blend for up to 8 targets, with write masks;
- `enablePixelShader`.

The depth test is `GreaterEqual` in G-buffer passes, i.e. a reversed-Z depth buffer [resource].

| Stage (`renderstage_…`) | What it does, as evidenced | Examples |
|---|---|---|
| `gbuffer_regular` / `gbuffer_velbuff_regular` | Opaque G-buffer write, depth write on, no blending | skin, eye, metal_base, multilayered [resource] |
| `post_gbuffer` | After the opaque G-buffer. Alpha-blends 3 targets with depth writes off. This is where decals live. | mesh_decal family, and metal_base has one too [resource] |
| `skin_translucency` | Depth-only pass (pixel shader off, front-face cull, R write mask) that feeds the SSS/translucency pipeline | skin family [resource] |
| `hair_alpha_accum`, `hair_basecolor_blend`, `hair_gbuffer_solid` | The three-part hair path (§4.3) | hair family [resource] |
| `transparent`, `transparent_back_face`, `unlit`, `distortion` | Forward passes after lighting, with their own lighting code | glass, eye_shadow, the clear-coat `unlit` pass [resource] [source] |
| `highlights` | Outline and highlight buffer. Its programs write constants or zeros and compute no lighting. | nearly every template [source] [particle-decal audit](../experiments/009-glitter-game-fixture/particle-decal-audit.md) |
| `cascade_regular`, `depth`, `depth_prepass` | Shadow and depth | [resource] |

The full stage list, with compilation counts, is in the local `material-index.json` produced by the [evidence tool](../research/materials/shader-system/README.md).

### 2.2 The G-buffer

The layout below is decoded from the tiled deferred light (`m_shaderLightsComputeGlobalLocalShadows_Clustered_*`) and from the skin, metal_base and mesh_decal writers. All of it is [source] (compiled programs; see the [evidence note](../research/materials/shader-system/README.md)).

| Target | RGB | A |
|---|---|---|
| **GBuffer0** | `sqrt(linear base colour)`. The light squares it. | Class-specific payload (bits of the eye's second vector). Skin writes 1. |
| **GBuffer1** | World normal `n / max(|n|) × 0.5 + 0.5`. The light uses `normalize(rgb − 0.5)`. | Class-specific: skin-profile slot high bits (skin); tangent-axis selector (hair); octahedral bits (eye). 0 for metal_base. |
| **GBuffer2** | **x = metalness, y = roughness** (the light clamps it to [0.04, 1]), **z = "translucency" term**: neutral 1/3 for Standard materials, `0.4 + 0.6·(vertex colour G)` for skin. | Class-specific: skin-profile low bit, an emissive flag and 6 bits (skin); the eye's second vector (eye). Standard emissive writers (metal_base family, `mesh_decal_emissive`) store bit 7 = emissive flag and 7 bits = `sqrt(EV/10)`. |
| **Stencil** (bits 5+) | Lighting class = `ERenderMaterialType`: Standard 0, Subsurface 1, Cloth 2, Eye 3, Hair 4, Foliage 5. The value is set per material template (`materialType`). | — |

**Grades for the less certain rows:**

- Stencil-class identity: the enum values match the light's class switch and the templates' `materialType` → [source]/[resource] match. The actual stencil write was not traced → [hypothesis].
- "Translucency" as the meaning of GBuffer2.z: [hypothesis]. It is supported by the engine debug-view enum `EEnvManagerModifier`, which lists Albedo, Specularity, Metalness, Roughness, Translucency, HairDirection and MaterialID (`G/EEnvManagerModifier.hpp:24-40`).

Which templates carry which class [resource]:

| Class | Templates |
|---|---|
| Subsurface | `skin`, `skin_blendable`, `skin_morph`, `blackwall_blendable_skin` |
| Eye | the 6 eye templates (`eye`, `eye_gradient`, `eye_blendable`, `eye_morph`, blackwall variants) |
| Hair | the 6 hair templates |
| Foliage | speedtree and `cloth_wind` |
| Standard | everything else (351 of 373), including every decal |

No template uses Cloth.

### 2.3 The deferred lighting model

Decoded from the global-light compute shader [source]:

| Term | Engine formula | Browser implication |
|---|---|---|
| Base colour / F0 | diffuse colour = `albedo·(1−metal)`. F0 = `lerp(0.04, albedo, metal)`. | Dielectric F0 is **fixed at 0.04**. No G-buffer channel sets IOR or specular level for non-metals. |
| Diffuse | Renormalized Burley (Disney) diffuse: `fd90 = 0.5·r + 2·LdotH²·r`, energy factor `1/π·(1 − 0.338·r)`. This is Frostbite's formulation (Lagarde & de Rousiers 2014). | Three.js `MeshStandard/Physical` uses Lambert. Rough skin and makeup darken or brighten differently at grazing angles. |
| Specular | GGX with α = roughness², height-correlated Smith visibility, Schlick Fresnel with F90 = 1 | Three uses the same α = r² convention. Roughness values transfer directly. |
| Sun / moon | A disk light, using the representative-point method | A small area light, not a point. Highlights on glossy makeup are slightly larger than a point light's. |
| Classes | Hair builds an anisotropic tangent frame. Eye uses a second (iris) normal and switches off the GBuffer2.z term. Subsurface keeps the diffuse term separate: albedo is set to 1 when metalness < 0.1 and a global flag is on. It also fetches a per-profile colour from a table of **8 skin-profile slots**. | Skin SSS is a screen-space pipeline (`m_postfx_SubsurfaceScattering_Setup/Blur/Combine`) driven by `CSkinProfile` blur and colours. The shader and pipeline names are [source]; how it works is [hypothesis]. |

**Consequence (the central fact for makeup).** The G-buffer stores **one surface per pixel**: one base colour, one normal, one metalness and one roughness. There is no clear-coat, sheen, second normal (except Eye), anisotropy (except Hair) or specular-tint channel. Anything that needs a second reflection lobe must come from a **separate forward pass** drawn after lighting. The stock examples are `multilayered_clear_coat`'s `unlit` pass (dual-source blend `One/Src1Color`) and `eye_shadow`'s `transparent_back_face` pass (`One/SrcAlpha`) [resource] [source].

### 2.4 What a `post_gbuffer` decal does to the pixel under it

All [source]/[resource] ([mesh-decal contract](../research/materials/mesh-decal-shader-contract.md), [evidence note](../research/materials/shader-system/README.md)):

1. **What it blends, and in what space.** It blends base colour, normal and metalness/roughness into GBuffer0–2 with `SrcAlpha/InvSrcAlpha`. Each target gets its own alpha (colour, normal and surface coverage). Colour is written as `sqrt(colour)`, so **decal colour blending happens in square-root (gamma-2) space**, not linear.
2. **Write mask RGB, stencil disabled.** The decal never changes the lighting class, skin-profile slot or `.w` payloads. **Makeup on skin is still lit as Subsurface skin.** Metalness ≥ 0.1 on a Subsurface pixel takes the class's non-SSS albedo path (§2.3).
3. **Translucency is diluted.** GBuffer2.z is written as 1/3, so where surface coverage is non-zero the decal blends skin's translucency term toward "none". The arithmetic is [source]; the visible effect is [hypothesis].
4. **Opacity curve.** Coverage is `saturate((a−0.5)·tan((c+1)·π/4)+0.5)² · (1 − influence·secondaryMask)`. Each target's alpha multiplies it by `DiffuseAlpha`, `NormalAlpha` or `RoughnessMetalnessAlpha`. **All three default to 0**, so an instance must enable them.
5. **Placement.** Rasterizer state is front-face cull with CCW winding, which is equivalent to back-face cull with CW. `OFFSET_DecalBias` adds a depth bias.

---

## 3. Compiled shaders: finding and reading them

### 3.1 Where they are and how templates map to programs

| Cache | Contents | Grade |
|---|---|---|
| `PATH_TO_GAME/engine/shader_final.cache` | All material-template programs. Footer RDHS v10. Programs are DXBC containers holding **DXIL**. Each compilation record reads `<template> CompiledTechnique [Index, Pass '<stage>', PassIndex, …, RenderStageContext: [ID, VF: <factory>; Discarded/Dismembered/PreSkinned]]`, followed by (vertex GUID, pixel GUID or none, material GUID). | [source] WolvenKit `ShaderCacheReader.cs`, with the stage correction below |
| `PATH_TO_GAME/engine/staticshader_final.cache` | Engine programs: lighting, SSS, multilayer surface cache, hair resolve, post-FX, ray tracing. Footer RDHS v8, with `m_*` technique names. | [source] reverse-engineered here |
| `shaderps4/ps5/xboxone/xsx/vulkan*.cache` | Console and Vulkan builds | not examined |

**Stage labels.** WolvenKit labels the first GUID "pixel". In all 19,647 records it is the **vertex** program; 2,564 records have no pixel program [source].

**Template-to-program link.** Templates connect to programs only by template name plus an opaque material GUID. No template field stores a shader GUID [source].

**Constant registers.**

- **Material constants are `cb4`**, one register per `usedParameters[2]` register ([1] for vertex programs).
  - Each program keeps a `%ShaderSpecificConstants` type with **one field per register**: `i32` for Texture/TextureArray/Cube, `float` for Scalar, `<4 x float>` for Vector/Color.
  - Across one representative program per template, 314 of 314 checked templates agree, and no program reads a `cb4` register that the template does not own [source].
- **Textures are bindless.** The program loads an index from that `cb4` register and indexes `t0, space1`. Multilayer layer textures are the exception: their index comes from a structured-buffer load.
- **Engine buffers keep their struct names** in the DXIL resource metadata; their member names do not survive, so individual registers are identified by use [source]:

  | Register | Struct |
  |---|---|
  | `cb0` | `GlobalShaderConsts` |
  | `cb1` | `CameraShaderConsts` |
  | `cb2` | `ENV_PROBES` |
  | `cb3` | `CustomPixelConsts` / `CustomVertexConsts` |
  | `cb5` | `FrequentVertexConsts` |
  | `cb6` | `COM` / `VER` (static compute programs) |
  | `cb7` | `MaterialModifiersConsts` |
  | `cb12` | `SharedPixelConsts` |
  | `cb13` | `CSConstants` |

### 3.2 Repeatable method

[`research/materials/shader-system/`](../research/materials/shader-system/README.md) contains:

- `shader_cache.py` (index / find / static / extract / summary);
- `template_summary.py` (parameters, registers, passes and blend states for all 373 templates);
- `shader_annotate.py` (annotate, optionally `--decompile` / search).

Recipe:

1. **Serialize the templates** with WolvenKit CLI 8.17.4: `unbundle memoryresident_1_general.archive -r "\.(mt|remt)$"`, then `convert serialize`.
2. **Find the compilation** with `shader_cache.py find <template> --info "<stage>'.*VF: MeshSkinned\]"`. The eye plate, head and eyes are `MeshSkinned`.
3. **Annotate** with `shader_annotate.py annotate <template> --guid <pixelGUID>`. This extracts and disassembles with Windows SDK `dxc -dumpbin`, then writes readable pseudo-HLSL with names for:
   - template parameters and textures;
   - engine struct names;
   - the vertex inputs behind each interpolator;
   - G-buffer and blend roles for each target.

   `shader_annotate.py search` finds the programs that contain a code pattern. `extract` and `summary` remain for raw work.
4. **Read structured source if needed.** `--decompile` adds `<GUID>.decompiled.hlsl`: dxil-spirv (DXIL to SPIR-V) and SPIRV-Cross (to HLSL), both built from source, with the same names applied.
   - It gives real loops, typed values and a named per-register `cb4`. HLSL output compiles with `dxc` for 244 of 253 templates.
   - It is HLSL for about three quarters of templates; forward programs with wave ops or float-granular cbuffer views fall back to GLSL.
   - Renaming was checked not to change the compiled program. The decompilers themselves are a second reading, not proof.
   - Its `_N` are not SSA numbers ([annotation results](../research/materials/shader-system/annotation-results.md#two-listings-lifted-and-decompiled)).
5. **Check against the disassembly** (`<GUID>.annotated.ll`) before relying on either listing. The lifted pseudo-HLSL folds expressions and keeps loops as `goto`; it is a reading aid, not compilable source.
6. **Write it down.** Record the program GUID, the SHA-256 and SSA ranges. SSA numbers are only valid within that one program.

Older one-off extractors (`projects/xf-studio/authoring/tools/inspect_shader_cache.ts`, `extract-brow-shader.ts`, `inspect-eye-skin-cache.ts`, `experiments/014-native-eye-gradient/inspect-cache.ts`) cover the same v10 format for single studies.

### 3.3 Compiled-program index (MeshSkinned unless noted)

| Template / pass | Pixel GUID | Documented in |
|---|---|---|
| `skin` `gbuffer_regular` | `12806642364631437234` | [saved-skin trace](../research/eye-artistry/saved-skin-shader-and-winner.md), [evidence note](../research/materials/shader-system/README.md) |
| `eye` `gbuffer_regular` | `14845425953312192161` | [eye/lip optics](../research/eye-artistry/eye-lip-optics-audit.md) |
| `eye_gradient` `gbuffer_regular` | `10020572278408962832` | [exp. 014](../experiments/014-native-eye-gradient/compiled-shader-and-gaze.md) |
| `mesh_decal` `post_gbuffer` | `16098255505177109230` | [decal contract](../research/materials/mesh-decal-shader-contract.md) |
| `mesh_decal_blendable` `post_gbuffer` | `3004271728282315156` | [glossy feasibility](../research/materials/glossy-decal-feasibility.md) |
| `mesh_decal_wet_character` `post_gbuffer` | `17388524518779931857` | [glossy feasibility](../research/materials/glossy-decal-feasibility.md) |
| `mesh_decal_gradientmap_recolor_blendable` `post_gbuffer` | `3456408455936683438` | [colour-shift feasibility](../research/materials/colour-shift-game-feasibility.md) |
| `mesh_decal_particles` `post_gbuffer` / `highlights` | `1688064767334184205` / `10861674281505605668` | [particle-decal audit](../experiments/009-glitter-game-fixture/particle-decal-audit.md) |
| `mesh_decal_emissive` `post_gbuffer` (target 2 is additive on B/A, so over skin it would add into GBuffer2.z/.w [hypothesis for the visible effect]) | `9453098283293843067` | [annotation results](../research/materials/shader-system/annotation-results.md#basematerialsmesh_decal_emissivemt) |
| `mesh_decal_emissive_subsurface` `subsurface_emissive` / `highlights` | `8986576764202126900` / `7960168020925993542` | [glint feasibility](../research/materials/redengine-glint-feasibility.md) |
| `metal_base_glitter` `gbuffer_regular` | `15760075574186250120` | [glitter investigation](../research/materials/glitter-shader-investigation.md) |
| `metal_base` `gbuffer_regular` | `1846801220589112223` | [evidence note](../research/materials/shader-system/README.md) |
| `eye_shadow` `transparent_back_face` | `14043594489545752539` | [evidence note](../research/materials/shader-system/README.md) |
| `multilayered_clear_coat` `unlit` | `5403688829342147459` | [evidence note](../research/materials/shader-system/README.md) |
| `hair` `alpha_accum` / `basecolor_blend` / `gbuffer_solid` | `2782105832921211528` / `7571795766366002052` / `2903833597335136032` | [lash follow-up](../research/eye-artistry/lash-material-followup.md), [hair shading](hair-shading.md) |
| static `m_shaderLightsComputeGlobalLocalShadows_Clustered_00000001` / `_11111111` (compute) | `10862954502888615639` / `6606735909222169407` | [evidence note](../research/materials/shader-system/README.md) |
| static `m_classifyMaterials` (compute) | `13401747477113664336` | [evidence note](../research/materials/shader-system/README.md) |

---

## 4. Template catalogue (characters and makeup)

Parameters and registers below are from the serialized 2.31 templates [resource]. Channel semantics are from compiled programs where cited [source]; everything else is marked. "Reg" is the `cb4`/`usedParameters[2]` register.

### 4.1 `base\materials\skin.mt` (and `skin_blendable`, `skin_morph`)

**Class:** Subsurface.

**Passes:** `gbuffer_regular`/`velbuff` (opaque), `skin_translucency` (depth only), cascade, highlights.

**Vertex factories** include MeshSkinned and the LightBlockers variants [resource].

| Parameter (reg) | Semantics | Grade |
|---|---|---|
| `Albedo` (0) | Base colour, UV0 | [source] |
| `Normal` (4), `DetailNormal` (5), `DetailNormalInfluence` (6) | RG-packed tangent normals with Z reconstructed as `sqrt(1−x²−y²)`, blended by influence | [source] |
| `Roughness` (8) | **R** = base roughness. **B** gates a spatially varying bias between `DetailRoughnessBiasMin/Max` (9/10), giving `saturate(R·(1+B·(bias−1)))`, which is written to GBuffer2.y. **G** is written to GBuffer2.x, the slot the light reads as metalness. Vanilla head G is zero. | [source] [saved-skin trace](../research/eye-artistry/saved-skin-shader-and-winner.md) |
| `MicroDetail` (11), `MicroDetailUVScale01/02` (12/13), `MicroDetailInfluence` (14) | Tiling micro-normal at two frequencies, derivative-guided; B of Roughness weights it | [source] |
| `TintColorMask` (15), `TintColor` (16), `TintScale` (17) | Character-creator tone tint | [wiki] `hair-and-skin-material-properties.md` L28-38; mask channel semantics [hypothesis] |
| `SecondaryAlbedo` (1), `…Influence` (2), `…TintColorInfluence` (3) | Alpha-blended overlay, used for freckles and tattoo frameworks | [wiki] |
| `SkinProfile` (24) | Bound as a **slot index 0–7** into a runtime table. The index is packed into GBuffer1.w and GBuffer2.w. The table holds `CSkinProfile` colours and blur. | [source] |
| `EmissiveMask` (18), `EmissiveEV` (19) | Mask **R** × EV. If this exceeds 0.001, GBuffer2.w gets an emissive flag plus 6-bit intensity. | [source] |
| `CavityIntensity` (7), `Detailmap_Stretch/Squash` (20/21), `Bloodflow` (22), `BloodColor` (23) | Wrinkle maps (RG normals); the other roles are unmapped | [source] (wrinkle RG) / [hypothesis] |

**Vertex colour.** The wiki reads vertex colour as R = AO, G = SSS mask and B = "improved facial lighting" [wiki] (`shader-docs.md` L47-51). The skin writer stores GBuffer2.z = `0.4 + 0.6·G`: its vertex program passes `COLOR.y` straight through to the interpolator the pixel program reads [source] ([annotation results](../research/materials/shader-system/annotation-results.md#basematerialsskinmt)). That fits G being the SSS mask. What GBuffer2.z means to the lighting is still [hypothesis] (§2.2).

**Gotcha.** The Blender add-on maps Roughness G to Metallic and marks its microdetail masking as uncertain (`material_types/skin.py:341,626`). It uses Principled random-walk SSS, which is an approximation, not the engine path.

### 4.2 Eye family: `eye.mt`, `eye_gradient.mt`, `eye_blendable.mt`, `eye_morph.mt`

**Class:** Eye.

**Passes:** opaque G-buffer, velocity, highlights. `eye.mt` defaults: `RoughnessScale` 0.4934, `RefractionIndex` 0.97, `EyeRadius` 0.0152 [resource].

| Parameter | Semantics | Grade |
|---|---|---|
| `Albedo`, `Normal` | Sampled at a **computed, view- and eye-parameter-dependent UV**. Normal is RG with reconstructed Z. | [source] [optics audit](../research/eye-artistry/eye-lip-optics-audit.md) |
| `Roughness` | **R** × `RoughnessScale`, at the *original* UV, written to GBuffer2.y. The G channel is not used. | [source] |
| `NormalBubble`, `BubbleNormalTile` | Cornea bulge normal (RG) | [source] |
| `IrisMask`, `IrisColorGradient` (`eye_gradient`) | Mask **R** addresses the gradient row `(reg+0.5)/512` of a runtime gradient texture. Mask **A** lerps from Albedo to the gradient colour. | [source] [exp. 014](../experiments/014-native-eye-gradient/compiled-shader-and-gaze.md) |
| `RefractionIndex/Amount`, `IrisSize`, `EyeParallaxPlane`, `EyeHorizAngleLeft/Right`, `Egg*`, `IrisCoord*` | Parallax/refraction UV construction | [source] (the parameters are read) |
| `Blick`, `BlickScale`, `SubsurfaceFactor`, `AntiLightbleed*` | Not read by the audited `eye_gradient` G-buffer pixel program. `Blick` is a cubemap. Their consumer is unknown. | [source] / [hypothesis] |

**Gotchas:**

- The Eye class stores a second vector in GBuffer `.zw`/`.w` bits and disables the translucency term (§2.3).
- The Blender add-on samples eye roughness **G**, contradicting the compiled R [source]. CCXL eye guides note the eye UVs are Y-flipped [wiki] (`ccxl-eye-textures.md` L267-271).

### 4.3 Hair (`hair.mt` family) — overview only

**Class:** Hair. There are three cooperating passes [resource] [source]:

- `hair_alpha_accum`: alpha write mask only; alpha is accumulated atomically from `Strand_Alpha` R.
- `hair_basecolor_blend`: additive; the two red-channel strand maps address a runtime gradient texture (the static cache names a `HairProfilesGradients` resource).
- `hair_gbuffer_solid`: opaque, depth-writing.

The light builds an anisotropic tangent frame for the Hair class. `.hp` profiles hold two gradient ramps (`gradientEntriesID`, `gradientEntriesRootToTip`).

See **[hair-shading.md](hair-shading.md)** for the detailed formula work, and the [lash follow-up](../research/eye-artistry/lash-material-followup.md) and [hair-profile resolution](../research/eye-artistry/saved-hair-profile-resolution.md).

### 4.4 `eye_shadow.mt` / `eye_shadow_blendable.mt` — the eye's occlusion and tear shell, not cosmetic eyeshadow

**Class:** Standard, **`EMP_Front`**.

**Pass:** `transparent_back_face`, forward-lit, `CULL_None`, blend `One/SrcAlpha`, i.e. out = highlight + dst·alpha [resource] [source].

**Vertex factories:** `eye_shadow` has MeshSkinned; `eye_shadow_blendable` has only MeshStatic and MeshExtSkinned [resource].

| Parameter (reg) | Compiled semantics | Grade |
|---|---|---|
| `Mask` (4) | **R** gives the shadow amount, `saturate(Intensity·R^Exponent)`. **G** × `WetnessRoughness` gives a wet-highlight roughness in [0.04, 1]. **B** × `WetnessStrength` scales the lit highlight. | [source] |
| `ShadowColor` (1), `Exponent` (2), `Intensity` (3) | Colour is linearized with exponent 2.2. Alpha darkens the destination toward the colour's luminance. | [source] |
| `WetnessRoughness` (5), `WetnessStrength` (6) | Forward-lit specular added on top of already-lit pixels | [source] |
| `AdditiveAlphaBlend` (0), `SubsurfaceBlur` (7) | Not read by this program | [source] |

**Naming gotcha.** This template's name refers to the ocular occlusion/tear film. The Blender add-on reads Mask R as alpha and A as coat, which does not match the program. That the vanilla eye-shadow mesh uses this template is [hypothesis].

### 4.5 `mesh_decal` family (`post_gbuffer`, all Standard class, MeshSkinned available)

**Common parameters.** Every member shares `DiffuseTexture`/`DiffuseColor`/`DiffuseAlpha`, `UV*`, `SecondaryMask*`, `NormalTexture`/`NormalAlpha`/`NormalAlphaTex`/`UseNormalAlphaTex`/`NormalsBlendingMode(+Alpha)`, `RoughnessTexture`/`MetalnessTexture` with scale and bias, `AlphaMaskContrast`, `RoughnessMetalnessAlpha`, `Animation*` and `DepthThreshold` [resource].

**Compiled contract** for `mesh_decal` [source] ([decal contract](../research/materials/mesh-decal-shader-contract.md)):

- Normal is RG with reconstructed Z.
- Roughness and Metalness each read **R** × scale + bias.
- There are independent colour, normal and surface coverages.
- `NormalsBlendingMode` > 0.5 composes with the existing screen normal in a reoriented-normal style.

| Template | Distinguishing inputs | Relevance |
|---|---|---|
| `mesh_decal` | Base set | Current makeup export route [resource] |
| `mesh_decal_blendable` | Adds `FresnelColor`/`Intensity`/`Exponent`, `VectorField`, fade controls | Single-lobe glossy candidate; surface alpha is masked by coverage [source] [glossy](../research/materials/glossy-decal-feasibility.md) |
| `mesh_decal_wet_character` | Base set | **Writes surface alpha = 1.0** regardless of coverage. It would overwrite roughness across the whole plate. [source] |
| `mesh_decal_double_diffuse` | `GradientMap`, `UseGradientMap`, `SecondaryDiffuseAlpha/Color/Intensity` | Brows. See [hair shading](hair-shading.md). [resource] |
| `mesh_decal_gradientmap_recolor(_2)` | `MaskTexture`, `GradientMap` (or a `.gradient` in `_2`). `DiffuseTexture` is an ID map indexing the gradient. | Recolour from one greyscale map [resource]; add-on `meshdecal.py:53` |
| `mesh_decal_gradientmap_recolor_blendable` | Gradient recolour plus **Fresnel colour added by view angle** | Colour-shift candidate [source] [colour shift](../research/materials/colour-shift-game-feasibility.md) |
| `mesh_decal_parallax` | `HeightTexture`, `HeightStrength` | Parallax offset. The Blender add-on does not implement it. [resource] |
| `mesh_decal_emissive` | `DiffuseColor2`, `EmissiveEV`, animation and scroll. Target 2 is additive (`One/One`, write mask **BA**). | Glow accents, independent of light [resource] |
| `mesh_decal_emissive_subsurface` | `EmissiveMask`, `EmissiveMaskChannel`, `EmissiveColor/EV`. Stage `subsurface_emissive`. | Emissive under skin [resource] [source] |
| `mesh_decal_particles` | Flipbook atlas | Not a glint model [source] |
| `mesh_decal_morph`, `_revealed`, `_multitinted`, `_parallax` | Morph, reveal/flow, 8 tints, height | Not yet studied [resource] |

### 4.6 Multilayered: `engine\materials\multilayered.mt`, `multilayered_clear_coat.mt`

**`multilayered.mt`** is Standard class. It is `canBeMasked = 0`, opaque and depth-writing [resource].

**Inputs:**

- `MultilayerSetup` (.mlsetup) and `MultilayerMask` (.mlmask);
- `GlobalNormal` with its intensity, UV scale and bias;
- runtime-filled `MaskAtlas`, `MaskTiles`, `Layers` (StructBuffers) and `Mask*` dimensions.

**Runtime surface cache.** The static cache holds `m_surfaceCache_GenerateMultilayer` [source]. This is consistent with CDPR's statement that compute shaders prepare visible layers into a runtime texture ([multilayered assessment](../research/materials/multilayered-makeup-assessment.md)). The G-buffer shader then samples one resolved surface [hypothesis].

**Layer values are name lookups.** Each `Multilayer_Layer` stores `colorScale`, `normalStrength`, `rough/metalLevelsIn/Out` as **CNames** that key into its `.mltemplate` override tables [source] (`G/Multilayer_Layer.hpp:22-40`). The per-layer numeric fields are `opacity`, `matTile`, `mbTile`, `microblend*` and `offsetU/V`. The wiki gives up to 20 layers [wiki] (`multilayered/README.md` L27, L80).

**How the add-on composites** (an approximation):

- straight lerp by opacity × contrast-adjusted mask;
- levels treated as scale/bias;
- `colorMaskLevelsIn` ignored.

Cited at `materials/blender/nodes.py:398-554`, `material_types/multilayered.py:845`.

**`multilayered_clear_coat.mt`** [resource] [source]:

- The G-buffer pass is opaque, depth-writing and Standard class.
- A second **`unlit` forward pass** blends `One/Src1Color` (dual source), adding coat reflection and attenuating the base per channel.
- Parameters: `CoatTintFwd/Side`, `CoatTintFresnelBias`, `CoatSpecularColor`, `CoatRoughnessBase`, `CoatReflectionPower`, `CoatFresnelBias`, `CoatNormalStrength`, `CoatLayerMin/Max`, `Opacity`.
- A community test shows angle-dependent tint on a garment [wiki] (`multilayered-material-properties.md` L121-133, image `clearcoat_1.png`/`clearcoat_2.png`, discovered by Rebecca).
- **Not an overlay:** its base pass replaces the surface, and skin's Subsurface class with it.

### 4.7 `engine\materials\metal_base.remt` and relatives (future body and clothing work)

`metal_base.remt` is Standard class with an opaque G-buffer pass plus a `post_gbuffer` pass. It has the broadest vertex-factory list [resource]:

- `BaseColor` with `BaseColorScale` (Vector);
- `Metalness`, `Roughness` (texture × scale + bias);
- `Normal` with `NormalStrength`;
- `Emissive` with `EmissiveColor/EV/Lift/Directionality`, ray-traced emissive switches;
- `AlphaThreshold` (default 0.38), `LayerTile`.

Transparency needs `enableMask` [wiki] (`textured-material-properties.md` L25).

**Relatives:**

- `pbr_simple.mt` has scalar `Color`, `Roughness` and `Metalness` only [resource].
- `metal_base_glitter.mt` is noise/time emissive, not a glint BRDF [source] [glitter investigation](../research/materials/glitter-shader-investigation.md).
- `glass.mt` is a forward transparent pass with `IOR`, tint, reflection power and blur [resource]; its parameters are documented in [wiki] `glass-material-properties.md`.

---

## 5. Texture conventions

| Convention | Evidence |
|---|---|
| **Normal maps are two-channel (RG) with Z reconstructed** in skin, eye, decal and multilayer global normals. Blue is ignored, and a DirectX orientation is expected. The compiled programs apply no Y flip, so orientation lives in the texture data. | [source] (compiled RG/Z paths); [wiki] `normal-maps-in-cyberpunk.md` L18-32, `shader-docs.md` L37-43 |
| **Roughness and metalness are separate single-channel (R) maps in decals**, with the usual meaning: white rough, white metal. Browser packed maps (G/B) must be split for export. | [source] [decal contract](../research/materials/mesh-decal-shader-contract.md); [wiki] `textures/README.md` L84-102 |
| **Skin and eye roughness maps are multi-channel with template-specific meanings** (skin R/G/B, eye R only). Three.js's default G sampling is wrong for both. | [source] |
| **Colour is stored as `sqrt(linear)` in the G-buffer.** Whether a texture sample is sRGB-decoded depends on the XBM's `isGamma` / format. Diffuse maps use `isGamma`; normal, roughness and mask maps must be linear. | [source] (sqrt); [wiki] `textures/README.md` L60-62, `ccxl-eye-textures.md` L252 |
| **Textures are stored vertically flipped** relative to PNG; WolvenKit's `VFlip` handles this. | [wiki] `materials/textures/README.md` L28-29 |
| **Gradient and profile ramps** (`.gradient`, `.hp`) are baked at runtime into gradient textures that the shaders address by row. The exact row bytes and filtering are unrecovered. | [source] [exp. 014](../experiments/014-native-eye-gradient/compiled-shader-and-gaze.md) |

---

## 6. Makeup finish implications

"Plate" means the owned morph-skinned eye-makeup mesh drawn over the head. Every decal route keeps the underlying Subsurface class (§2.4).

| Finish | Most plausible game route | Why / limits | Grade | Single confirming in-game test |
|---|---|---|---|---|
| **Matte** | `mesh_decal` with `DiffuseAlpha` and `RoughnessMetalnessAlpha` enabled; roughness R ≈ 0.8–1, metal 0 | Replaces skin roughness under the mark; skin SSS still applies. Translucency is diluted where surface alpha > 0. | [source] route; [runtime] untested | Matte swatch next to bare skin under a raking key light, camera fixed then moved. The highlight should vanish on the swatch only. |
| **Satin** | Same as Matte, roughness ≈ 0.4–0.55 | Soft single GGX lobe; no sparkle by construction | [source] | Same capture; a broad, soft highlight that tracks the light |
| **Metallic / foil** | `mesh_decal` with metal ≈ 0.8–1 and roughness ≈ 0.2–0.35; F0 comes from the pigment colour | At metal ≥ 0.1 the Subsurface class uses the ordinary albedo path. Reflections come from probes/SSR/RT, so metallic looks dark in dim or probe-poor scenes. | [source] | Metallic swatch in a bright and a dim location. Check for coloured reflections, and for a seam where metal crosses 0.1 on a soft edge. |
| **Shimmer / pearl** | `mesh_decal` with a fine resolved normal/roughness texture and low-to-moderate metal. Optionally add a weak Fresnel tint via `mesh_decal_gradientmap_recolor_blendable`. | One lobe per pixel; sub-pixel sparkle filters away. The pearl "interference" can only be faked with the Fresnel additive tint. | [source] / [hypothesis] for the look | Face-scale and close-up captures while rotating the camera. Is the sheen visible at normal framing? |
| **Glitter** | `mesh_decal` with **resolved** facet normals/roughness/metal, plus optional sparse `mesh_decal_emissive` flecks | No stock glint BRDF exists. Fine facets collapse under mip filtering; emissive flecks ignore light. | [source] [glint feasibility](../research/materials/redengine-glint-feasibility.md) | PBR-only vs emissive-only vs combined, under light and camera sweeps and with lights dimmed |
| **Glossy / wet** | **(a)** Single-lobe: low-roughness non-metal `mesh_decal_blendable`/`mesh_decal`. **(b) New candidate:** a second, coincident skinned shell mesh using `eye_shadow.mt` with `Intensity` 0. Mask **G** sets wet roughness and **B** sets wet strength; it adds a real **forward-lit second specular lobe** on top of the lit makeup. | (a) replaces skin roughness and cannot add clearcoat, because the G-buffer holds one lobe. (b) is the only stock skinned transparent pass found that *adds* specular after lighting. Sorting with lashes and brows (`EMP_Front`), the double draw and blink behaviour are unknown. `multilayered_clear_coat` cannot overlay skin. | (a) [source]; (b) [source] arithmetic, [hypothesis] as makeup | The (b) shell over a dark liner. Does a wet highlight appear on top of the pigment? Is there no darkening at `Intensity` 0? Is it correct during blink and against lashes? |
| **Colour-shifting** | `mesh_decal_gradientmap_recolor_blendable`: gradient base plus `FresnelColor·Intensity·pow(1−N·V, Exponent)` **added** to colour | One fixed secondary hue added at grazing angles. It is not thin-film or multichrome. The addition happens in sqrt space before squaring. | [source] [colour shift](../research/materials/colour-shift-game-feasibility.md) | Fixed light and moving camera, then fixed camera and moving light. Hue must follow the camera only. |

**Cross-cutting guidance for the browser preview:**

1. Blend decal colour in **sqrt space**, and apply the decal's **squared** coverage curve.
2. Use F0 = 0.04 for non-metals, and treat roughness as perceptual (α = r²).
3. Consider Burley diffuse for skin and makeup.
4. Present the Glossy finish's clearcoat as a *second pass*, not a G-buffer property.
5. Sample skin roughness from R, with B gating the bias, and eye roughness from R × scale.

---

## 7. Open questions

These become [backlog](../research/backlog/materials-shader-re.md) items.

1. **GBuffer2.z.** What is it exactly: translucency, specular occlusion or something else? What does the `%1201` term add? Trace the `…_11111111` variant further and the SSS `Setup_UseTranslucency` program.
2. **Stencil write.** Confirm that the engine writes `materialType` into stencil bits 5–7, via a runtime capture or the pass stencil setup code.
3. **Skin-profile table.** The table holds 8 slots per frame. What happens with more than 8 distinct `.sp` on screen? How are `blurSize`, `diffuse`, `falloff`, `roughness0/1` and `lobeMix` used? `lobeMix` suggests a dual-lobe skin specular that the global light program did not show; trace the SSS combine and local-light variants.
4. **Metal ≥ 0.1 threshold.** The flag controlling the Subsurface class's albedo = 1 path is unknown. Does metallic makeup over skin break SSS continuity at soft edges?
5. **Eye second vector.** What exactly is the octahedral vector the Eye class stores, and how does the light use it? What consumes `Blick`, `SubsurfaceFactor` and `AntiLightbleed*`?
6. **`eye_shadow` as a gloss shell.** Is it usable as a glossy-makeup shell (sorting, `transparent_back_face` stage semantics, blink, cost)? Which vanilla mesh uses it?
7. **Runtime gradient atlases.** Recover the atlas construction for `.gradient` and `.hp` (row assignment, colour space, filtering). This affects eyes, brows, lashes and hair.
8. **Unmapped debris.** Recover the G-buffer render-target formats (8-bit vs 10-bit precision affects the sqrt encoding) and the meaning of the low 5 stencil bits.
9. **Ray-tracing libraries.** Parse the ray-tracing libraries in `staticshader_final.cache`. Their names survive (`ShadeSurfaceWithLightSample*`, `GBuffer0..2`), which could confirm the BRDF and G-buffer semantics independently.
10. **Multilayer levels.** Confirm the multilayer levels semantics (`roughLevelsIn/Out` pairs) against the `m_surfaceCache_GenerateMultilayer` program.
11. **Debug views.** Can the engine's `EEnvManagerModifier` debug views (G-buffer, Roughness, Metalness, Translucency, MaterialID) be enabled from CET or RED4ext? That would turn most questions here into one capture session.

## In-game test asks

Batch these into one prepared session with fixed camera, FOV and light, and record game and framework versions.

1. **Finish board.** One test preset on the plate with side-by-side swatches: matte, satin, metallic, single-lobe glossy, colour-shift, and an `eye_shadow` gloss shell over one liner.
   - Capture a camera orbit under fixed light, then a light sweep under a fixed camera, at close and face framing, with a blink.
   - Settles routes (a)/(b) for Glossy, the Fresnel colour shift, metallic behaviour on skin and translucency dilution.
2. **Sqrt-space blend check.** Black `mesh_decal` patches at 25/50/75 % `DiffuseAlpha`, contrast 0, on flat-lit cheek skin, captured in photo mode with fixed exposure.
   - Compare measured luminance with linear and sqrt-space predictions.
3. **Metal threshold edge.** A soft-edged metallic patch whose metalness ramps 0 → 0.3.
   - Look for a visible seam at 0.1.
4. **Backlit translucency.** Ear or eyelid backlit, with a decal `RoughnessMetalnessAlpha` of 1 vs 0 over identical pigment.
   - Checks the GBuffer2.z dilution hypothesis.
5. **Debug views.** If a debug-view toggle is found (open question 11), capture Albedo, Roughness, Metalness, Translucency and MaterialID views of the plate once.

---

Related: [mesh-decal contract](../research/materials/mesh-decal-shader-contract.md) · [glossy feasibility](../research/materials/glossy-decal-feasibility.md) · [colour-shift feasibility](../research/materials/colour-shift-game-feasibility.md) · [multilayered assessment](../research/materials/multilayered-makeup-assessment.md) · [glint feasibility](../research/materials/redengine-glint-feasibility.md) · [finish taxonomy](../research/materials/makeup-finish-taxonomy.md) · [skin trace](../research/eye-artistry/saved-skin-shader-and-winner.md) · [eye/lip optics](../research/eye-artistry/eye-lip-optics-audit.md) · [backlog](../research/backlog/materials-shader-re.md). Community sources are acknowledged in the [community credits](../docs/community-credits.md).
