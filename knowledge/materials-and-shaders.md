# Materials and shaders (REDengine 4, game 2.31)

**Maturity: Draft.** The resource model, template catalogue, G-buffer layout and deferred BRDF are consolidated from source, installed resources and compiled programs. Runtime evidence is partial: the first photo-mode session (25 September) showed the colour shift working, distinct coverage steps, close-up breakup of a skin-coincident plate and uniformly glossy flat finishes (see [in-game test asks](#in-game-test-asks) and [experiment 017](../experiments/017-plate-depth/README.md)).

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
| **WolvenKit's material export applies this order for us.** `uncook … --mesh-export-type MeshOnly -gp <game>` writes `<mesh>.Material.json`: every mesh-local material resolved through its `.mi` chain (`Data` holds the effective parameters), plus `Appearances` keyed `<name><index>` → chunk material names, and it decodes every texture those materials use. Example (2.31 female head, appearance `default` → `01_ca_pale`): `Albedo` `h0_000_pwa_c__basehead_d01.xbm` and `Normal` `h0_001_pwa_c__basehead_n01.xbm` come from the mesh-local instance, `Roughness` `h0_000_wa_c__basehead_rm01.xbm` from `default_female_head_01_ca_pale.mi` two levels up; a manual `.mi` walk gave the same answer. The Studio's derived preview reads this file instead of re-walking chains (`src/preview-core-materials.ts`). | [resource] 2.31 export, 25 Sep 2026, CLI 8.17.4 and 9.0.1; [source] `MaterialExtractor.cs` |

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
| **GBuffer1** | World normal `n / max(\|n\|) × 0.5 + 0.5`. The light uses `normalize(rgb − 0.5)`. | Class-specific: skin-profile slot high bits (skin); tangent-axis selector (hair); octahedral bits (eye). 0 for metal_base. |
| **GBuffer2** | **x = metalness, y = roughness** (the light clamps it to [0.04, 1]), **z = a transmission weight** read only by the Foliage class: neutral 1/3 for Standard materials, `0.4 + 0.6·(vertex colour G)` for skin (which the Subsurface lighting ignores). | Class-specific: skin-profile low bit, an emissive flag and 6 bits (skin); the eye's second vector (eye). Standard emissive writers (metal_base family, `mesh_decal_emissive`) store bit 7 = emissive flag and 7 bits = `sqrt(EV/10)`. |
| **Stencil** (bits 5+) | Lighting class = `ERenderMaterialType`: Standard 0, Subsurface 1, Cloth 2, Eye 3, Hair 4, Foliage 5. The value is set per material template (`materialType`). | — |

**Grades for the less certain rows:**

- Stencil-class identity: the enum values match the light's class switch and the templates' `materialType` → [source]/[resource] match. The actual stencil write was not traced → [hypothesis].
- GBuffer2.z: the all-classes global light (`…_11111111`, `6606735909222169407`) forms `saturate((z − 1/3) × 1.5)` (`%85`–`%87`) and uses it only in the **Foliage** branch (class 5, block `%1051`), as the weight of a back-lit transmission lobe added to diffuse (`%1186`–`%1204`); Eye forces it to 0. The Subsurface branch, the local-light path and the SSS passes never read it [source] ([experiment 017](../experiments/017-plate-depth/README.md#2-uniform-gloss-the-roughness-reaches-the-lighting-the-finish-values-are-glossier-than-skin)). The debug-view enum `EEnvManagerModifier` still lists a "Translucency" view (`G/EEnvManagerModifier.hpp:24-40`); whether that view shows this channel is [hypothesis].

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
| Classes | Hair builds an anisotropic tangent frame. Eye uses a second (iris) normal and switches off the GBuffer2.z term. **Subsurface** keeps diffuse and specular in separate outputs: albedo is set to 1 when metalness < 0.1 and a global flag is on, diffuse is Burley at the G-buffer roughness, and specular is **two GGX lobes** at roughness × `roughness0` and × `roughness1` from the pixel's skin-profile kernel (one of **8 slots**, `cb6` registers 4–11, `SKernelDualSpecular`), summed and scaled by (1 + `lobeMix`)/2. The default profile (`roughness0` 0.966, `roughness1` 1.597, `lobeMix` 1) gives skin up to twice a Standard lobe's specular. Local lights can also shift roughness per light: r′ = saturate(r + k·(byte/127.5 − 1)), from a byte of the light's parameters. [source] (`…_11111111` `%575`–`%751`, `%2766` onward) | Skin roughness written by a decal **does** reach skin's specular. The SSS combine (`7703933925853799832`) blurs diffuse with the profile colour and **adds specular unchanged**; a pixel whose metalness exceeds 0.1 skips SSS entirely (diffuse unblurred). Setup `18323727242039837728` and horizontal blur `13638945895069409584` read only GBuffer2.x/.w [source]. The global light has no probe term; reflection passes (probes, SSR, ray tracing) are not traced. |

**Consequence (the central fact for makeup).** The G-buffer stores **one surface per pixel**: one base colour, one normal, one metalness and one roughness. There is no clear-coat, sheen, second normal (except Eye), anisotropy (except Hair) or specular-tint channel. Anything that needs a second reflection lobe must come from a **separate forward pass** drawn after lighting. The stock examples are `multilayered_clear_coat`'s `unlit` pass (dual-source blend `One/Src1Color`) and `eye_shadow`'s `transparent_back_face` pass (`One/SrcAlpha`) [resource] [source].

### 2.4 What a `post_gbuffer` decal does to the pixel under it

All [source]/[resource] ([mesh-decal contract](../research/materials/mesh-decal-shader-contract.md), [evidence note](../research/materials/shader-system/README.md)):

1. **What it blends, and in what space.** It blends base colour, normal and metalness/roughness into GBuffer0–2 with `SrcAlpha/InvSrcAlpha`. Each target gets its own alpha (colour, normal and surface coverage). Colour is written as `sqrt(colour)`, so **decal colour blending happens in square-root (gamma-2) space**, not linear.
2. **Write mask RGB, stencil disabled.** The decal never changes the lighting class, skin-profile slot or `.w` payloads. **Makeup on skin is still lit as Subsurface skin.** Metalness ≥ 0.1 on a Subsurface pixel takes the class's non-SSS albedo path (§2.3).
3. **GBuffer2.z has no effect on skin.** The decal writes 1/3, so where surface coverage is non-zero it blends skin's `0.4 + 0.6·G` toward 1/3, but only the Foliage class reads that channel [source]. (An earlier reading here, that this dilutes skin translucency, was wrong.)
4. **Opacity curve.** Coverage is `saturate((a−0.5)·tan((c+1)·π/4)+0.5)² · (1 − influence·secondaryMask)`. Each target's alpha multiplies it by `DiffuseAlpha`, `NormalAlpha` or `RoughnessMetalnessAlpha`. **All three default to 0**, so an instance must enable them.
5. **Placement and depth.** Rasterizer state is front-face cull with CCW winding, which is equivalent to back-face cull with CW. The pass tests depth `GreaterEqual` without writing it, and `offsetMode` `OFFSET_DecalBias` (value 3 of `PSODescRasterizerModeOffsetMode`) adds a depth bias whose values are engine-side and unknown. `DepthThreshold` (default 0.5) discards decal pixels farther than that from the scene depth; it does not settle coincident surfaces [source].
6. **Vanilla face decals do not rely on the bias.** The 2.31 female eye-makeup, lip, freckle and pimple meshes are the head's vertices pushed **0.40 mm** out along the head's normals (median residual 5 µm), and their morph targets keep the offset along each target's normal; they have one LOD like the head. A plate coincident with the head broke into skin-coloured patches close up in photo mode, and was clean at medium distance [resource] [runtime]. XF Studio now lifts its packaged plate 0.4 mm the same way ([experiment 017](../experiments/017-plate-depth/README.md)); the close-up-only mechanism (a depth bias that absorbs less world-space mismatch near the camera) is [hypothesis].

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
| `mesh_decal_gradientmap_recolor_blendable` `post_gbuffer` | `3456408455936683438` | [colour-shift design](../research/materials/finish-designs/colour-shifting.md), [feasibility](../research/materials/colour-shift-game-feasibility.md) |
| static `m_postfx_SubsurfaceScattering` Setup / Blur_Horizontal / Combine | `18323727242039837728` / `13638945895069409584` / `7703933925853799832` | [experiment 017](../experiments/017-plate-depth/README.md) |
| `mesh_decal_gradientmap_recolor_blendable` vertex (Fresnel distance fade) | `7066617541061519457` (DXBC SHA-256 `77e887ec…cb3`) | [colour-shift design](../research/materials/finish-designs/colour-shifting.md) |
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
| static `m_simpleTemporal` (compute; PQ-space mean ± σ history clamp, 5 % blend) | `525406595650312948` | [experiment 018](../experiments/018-glitter-route/README.md#taa-and-upscalers) |
| static FSR2 / XeSS reactivity and DLSS colour-bias masks (compute) | `881371692195232951` / `15039989337359667650` / `7261057323686950841` | [experiment 018](../experiments/018-glitter-route/README.md#taa-and-upscalers) |

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
| `TintColorMask` (15), `TintColor` (16), `TintScale` (17) | Character-creator tone tint. Weight `abs(TintScale)·Mask.R`; a positive scale **multiplies** albedo by `TintColor`, a negative one **overlays** it. Mask **G** and **B** are microdetail selectors (tile blend and UV frequency), not tint. Per-tone values: [head CC rendering §2](head-cc-rendering.md#2-skin-type-tone-and-the-complexion-texture-set) | [source] decompiled `12806642364631437234`; [wiki] `hair-and-skin-material-properties.md` L28-38 (multiply only) |
| `SecondaryAlbedo` (1), `…Influence` (2), `…TintColorInfluence` (3) | Overlay composited by `Influence · SecondaryAlbedo.A`, tinted toward the tone by `TintColorInfluence`; used by freckle and tattoo frameworks | [source] [wiki] |
| `SkinProfile` (24) | Bound as a **slot index 0–7** into a runtime table. The index is packed into GBuffer1.w and GBuffer2.w. The table holds `CSkinProfile` colours and blur. | [source] |
| `EmissiveMask` (18), `EmissiveEV` (19) | Mask **R** × EV. If this exceeds 0.001, GBuffer2.w gets an emissive flag plus 6-bit intensity. | [source] |
| `CavityIntensity` (7), `Detailmap_Stretch/Squash` (20/21), `Bloodflow` (22), `BloodColor` (23) | Wrinkle maps (RG normals); the other roles are unmapped | [source] (wrinkle RG) / [hypothesis] |

**Vertex colour.** The wiki reads vertex colour as R = AO, G = SSS mask and B = "improved facial lighting" [wiki] (`shader-docs.md` L47-51). The skin writer stores GBuffer2.z = `0.4 + 0.6·G`: its vertex program passes `COLOR.y` straight through to the interpolator the pixel program reads [source] ([annotation results](../research/materials/shader-system/annotation-results.md#basematerialsskinmt)). The deferred light ignores GBuffer2.z for skin (only Foliage reads it, §2.2), so what that value does for Subsurface pixels, if anything, is unknown.

**Roughness under eye makeup.** On the pale default head the `Roughness` map's R channel reads about 0.57–0.66 at the vanilla eye-makeup vertices (`h0_000_wa_c__basehead_rm01.xbm`, before the detail bias) [resource] ([experiment 017](../experiments/017-plate-depth/README.md)).

**No specular antialiasing.** Neither the skin writer nor `mesh_decal` derives roughness from normal-map variance. Decal textures are read with implicit-LOD `Sample` through one anisotropic, trilinear, wrapping sampler, so a texture's mip chain is the only filter a mod controls [source] ([Glitter in game §1](glitter-in-game.md#1-from-flake-texture-to-screen-pixel)).

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

**Naming gotcha.** This template's name refers to the ocular occlusion/tear film. The Blender add-on reads Mask R as alpha and A as coat, which does not match the program. The vanilla user is the player eye mesh's wetness chunk `eyeWetness_MAT` (`eyeshadow_base.mi`: `ShadowColor` 125,58,58, `Intensity` 0.7, `Exponent` 0.8; female chunk 2, male chunk 1) [resource] ([head CC rendering](head-cc-rendering.md#4-eyes-lashes-brows-hair-and-beard)).

### 4.5 `mesh_decal` family (`post_gbuffer`, all Standard class, MeshSkinned available)

**Common parameters.** Every member shares `DiffuseTexture`/`DiffuseColor`/`DiffuseAlpha`, `UV*`, `SecondaryMask*`, `NormalTexture`/`NormalAlpha`/`NormalAlphaTex`/`UseNormalAlphaTex`/`NormalsBlendingMode(+Alpha)`, `RoughnessTexture`/`MetalnessTexture` with scale and bias, `AlphaMaskContrast`, `RoughnessMetalnessAlpha`, `Animation*` and `DepthThreshold` [resource].

**Compiled contract** for `mesh_decal` [source] ([decal contract](../research/materials/mesh-decal-shader-contract.md)):

- Normal is RG with reconstructed Z.
- Roughness and Metalness each read **R** × scale + bias.
- There are independent colour, normal and surface coverages. Colour and surface coverage are the **squared** contrast-adjusted colour-map alpha; normal alpha is **not** squared: `NormalAlpha` × (`UseNormalAlphaTex` ? `NormalAlphaTex`.R : colour-map alpha).
- `NormalsBlendingMode` > 0.5 loads the existing G-buffer normal and composes the decal normal with it by reoriented normal mapping (Barré-Brisebois & Hill) in the plate's tangent frame, lerped by `NormalsBlendingModeAlpha`.R (white by default). Its normal alpha is also multiplied by `saturate(50 − 50·z)`: a flat texel (z = 1) writes nothing, and full weight needs about 11.5° of tilt. Mode 0 replaces the normal with the plate normal plus the map at the plain alpha. [source] (decompiled `16098255505177109230`; see the [Shimmer design](../research/materials/finish-designs/shimmer.md))

| Template | Distinguishing inputs | Relevance |
|---|---|---|
| `mesh_decal` | Base set | Current makeup export route [resource] |
| `mesh_decal_blendable` | Adds `FresnelColor`/`Intensity`/`Exponent`, `VectorField`, fade controls | Single-lobe glossy candidate; surface alpha is masked by coverage [source] [glossy](../research/materials/glossy-decal-feasibility.md) |
| `mesh_decal_wet_character` | Base set | **Writes surface alpha = 1.0** regardless of coverage. It would overwrite roughness across the whole plate. [source] |
| `mesh_decal_double_diffuse` | `GradientMap`, `UseGradientMap`, `SecondaryDiffuseAlpha/Color/Intensity` | Brows. See [hair shading](hair-shading.md). [resource] |
| `mesh_decal_gradientmap_recolor(_2)` | `MaskTexture`, `GradientMap` (or a `.gradient` in `_2`). `DiffuseTexture` is an ID map indexing the gradient. | Recolour from one greyscale map [resource]; add-on `meshdecal.py:53` |
| `mesh_decal_gradientmap_recolor_blendable` | Base = `DiffuseColor` × `GradientMap`(`DiffuseTexture`.R, 0.5); **Fresnel colour** × intensity × w × saturate(\|1 − N·V\|^exponent) added before the square root. Colour coverage = `DiffuseAlpha` × gradient alpha × `MaskTexture`.R, **linear** (not squared). The vertex program sets w = max(1 + `MaterialModifiersConsts[2].x` − saturate((d − `FadeOutOffset`)/`FadeOutDistance`), 0), d = horizontal camera-to-object distance; the defaults remove the tint beyond 0.7 m. | Colour-shifting export route, with the fade pushed to 1000 m [source] [design](../research/materials/finish-designs/colour-shifting.md) |
| `mesh_decal_parallax` | `HeightTexture`, `HeightStrength` | Parallax offset. The Blender add-on does not implement it. [resource] |
| `mesh_decal_emissive` | `DiffuseColor2`, `EmissiveEV`, animation and scroll. Target 2 is additive (`One/One`, write mask **BA**). | Glow accents, independent of light [resource] |
| `mesh_decal_emissive_subsurface` | `EmissiveMask`, `EmissiveMaskChannel`, `EmissiveColor/EV`. Stage `subsurface_emissive`. | Emissive under skin [resource] [source] |
| `mesh_decal_particles` | Flipbook atlas (plain `mesh_decal` has the same time-driven flipbook controls) | Not a glint model [source] |
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
| **Player head defaults.** The female head mesh's own `default` appearance is the pale tone `01_ca_pale` (D01 albedo). The eye mesh's `default` appearance is a `metal_base.remt` placeholder on all three chunks; the real eye colour is an appearance the character creator selects (e.g. `gradient_brown`, whose albedo is `he_000_base_d02.xbm` and whose colour comes from `IrisColorGradient`). | [resource] 2.31 `h0_000_pwa_c__basehead.mesh`, `he_000_pwa_c__basehead.mesh` |
| **Gradient and profile ramps** (`.gradient`, `.hp`) are baked at runtime into gradient textures that the shaders address by row. The exact row bytes and filtering are unrecovered. | [source] [exp. 014](../experiments/014-native-eye-gradient/compiled-shader-and-gaze.md) |

---

## 6. Makeup finish implications

"Plate" means the owned morph-skinned eye-makeup mesh drawn over the head. Every decal route keeps the underlying Subsurface class (§2.4).

The Studio exports each preset as **one decal draw**, so per-texel inputs can vary within a preset but material constants cannot. The implemented routes are in [`finish-export.ts`](../projects/xf-studio/authoring/src/finish-export.ts); each finish has a [design page](../research/materials/finish-designs/README.md). None has been seen in game; the [finish board](../experiments/016-finish-board/README.md) is the prepared test.

| Finish | Export route (current) | Why / limits | Grade | Single confirming in-game test |
|---|---|---|---|---|
| **Matte** | Flat `mesh_decal` (`@preset`): roughness 0.88, metal 0, colour and surface alpha on, normal off | Replaces skin roughness under the mark (bare lid skin ≈ 0.6); skin SSS and skin's dual-lobe specular still apply. | [source] route; [runtime] read glossy on the first board (with close-up breakup) | Experiment 017 *Gloss A–D* |
| **Satin** | Same, roughness 0.38 | Glossier than bare lid skin (≈ 0.6) and than vanilla eye makeup (0.50), and skin doubles the lobe; a calibrated 0.50 is on the next candidate | [source]; look [hypothesis] | Experiment 017 *Gloss D* against *Gloss A* |
| **Metallic / foil** | Same, roughness 0.27, metal 0.65 | At metal ≥ 0.1 the Subsurface class leaves its SSS albedo path. Reflections come from probes/SSR/RT, so metallic looks dark in dim or probe-poor scenes. Losing SSS also makes the skin under it read hard. | [source]; [runtime] part of the uniformly glossy first board | Experiment 017 *Gloss A–D* (right outer stripe); *Metal ramp · lifted* for the 0.1 seam |
| **Glossy / wet** | **Experimental.** Flat `mesh_decal`, one dielectric lobe at roughness 0.12 (game-matched model only) | One G-buffer lobe: no clear coat, same F0 as skin, only sharper. The `eye_shadow` forward shell (`Intensity` 0, wet highlight from `Mask` G/B) remains the only stock way to add a second lobe; not built. | [source]; look [hypothesis]; [runtime] not distinct from Satin on the first board | Experiment 017 *Gloss A* against *Gloss D* (0.24) |
| **Shimmer / pearl** | **Experimental.** `mesh_decal` + the classic facet normal map in `NormalsBlendingMode` 1 (`@faceted`), per-texel roughness/metal from the bake, roughness mips widened by lost facet variance | Mode 1 keeps skin normals where facets are flat and fades tilts under about 11.5°; averaged facets fade out at distance and become a broader lobe. Random facet azimuths make the untested green sign irrelevant statistically. | [source]; [runtime] the default (128 cells, tilt 0.65) read as a diffuse gloss, not sparkle; its facets are ≈ 1.4 mm wide on the plate (texel density below) | Experiment 017 *Shimmer · strong* (64 cells, tilt 1.0) beside Board 2's fine stripe |
| **Glitter** | **None** (preview only). Proposed: resolved glint flakes in `mesh_decal` through a plate-local UV window (4096×1024), with nested flake mips; fallback adds an emissive accent chunk ([Glitter in game](glitter-in-game.md)) | No stock glint BRDF; one normal per pixel, no specular antialiasing, and a temporal clamp that removes one-pixel glints, so flakes must stay ≥ 2 texels wide at every mip. Board 2's coarse stripe was ~5.6 mm facets (sequins), not a glitter test. | [source]; route measured [offline]; look [hypothesis] | [Experiment 018](../experiments/018-glitter-route/README.md#diagnostic-board) *Glitter A* and *B* |
| **Colour-shifting** | **Experimental.** Per-preset `mesh_decal_gradientmap_recolor_blendable` (`@fresnel_<preset>`): uniform base-colour gradient, linear coverage mask, roughness 0.32 and metal 0.25 via bias, `FresnelColor` from the chosen shift colour, exponent 2, distance fade pushed away | One additive secondary hue by view angle, lit like base colour; not thin-film or multichrome. One constant per draw, so a colour-shift preset must be one pigment. The `Color` parameter encoding (byte/255 assumed) and `MaterialModifiersConsts[2].x` are unconfirmed. | [source]; encoding and look [hypothesis] | Boards 3 and 4: teal at the lid edges that follows the camera, not the light |

**Plate depth.** Every route draws on the plate lifted 0.4 mm off the skin, like the vanilla face decals (§2.4 item 6).

**Plate texel density and the UV window.** The plate keeps the head's UV0, so a head-atlas texture spends only a 0.453 × 0.145 rectangle on it: at 1024 a texel is about 0.56 × 0.40 mm on the lids (569 and 405 mm per UV unit, area-weighted medians). The vanilla eye-makeup mesh has its own UV layout at about 66 mm per UV unit, so its 1024 texels are 0.065 mm [resource] ([experiment 018](../experiments/018-glitter-route/README.md#texel-density)). `mesh_decal` transforms every texture UV by `UVScale`/`UVOffset` from the UV as stored in the mesh [source], so **Build now maps just the plate's rectangle onto a 2048 × 512 texture for the flat and faceted routes: about 0.13 × 0.12 mm per texel at today's texel count and memory** [offline]. The V sign follows from two offline facts: the Studio authors in glTF UV (1 − stored V), and WolvenKit's XBM import stores image rows bottom to top; so `UVOffsetY` is negative (−1.66 for the built-in plate) and the verifier checks the stored row order on every build. The Fresnel route's gradient-recolour template has no UV transform and stays on the 1024 head atlas. The window's placement has not been seen in game ([experiment 019](../experiments/019-uv-window/README.md)). Shimmer facets keep their authored size (about 1.4 mm by default), now with crisp edges; finer facets are a recipe question, not a texture limit, any more.

**Calibration against skin.** Finish roughness sits on top of skin, not a Standard surface: skin's own roughness under the lids is about 0.6, vanilla eye makeup writes 0.50 at full surface alpha (and breaks its coverage with a ×30 noise mask), and the Subsurface class sums two GGX lobes at 0.97× and 1.6× the written roughness. On the first in-game board, Matte, Satin, Glossy and Metallic read uniformly glossy; experiment 017 separates "values too glossy" (*Gloss D*: all +0.12) from "written roughness not what you see" (*Gloss B*: surface alpha 0; *Gloss C*: roughness forced to 1) [hypothesis until that session].

**Cross-cutting guidance for the browser preview:**

1. Blend decal colour in **sqrt space**, and apply the decal's **squared** coverage curve.
2. Use F0 = 0.04 for non-metals, and treat roughness as perceptual (α = r²).
3. Consider Burley diffuse for skin and makeup.
4. Present Glossy as the one lobe the game can draw (the game-matched model does); a clear coat would need a second, forward pass.
5. Sample skin roughness from R, with B gating the bias, and eye roughness from R × scale.

---

## 7. Open questions

These become [backlog](../research/backlog/materials-shader-re.md) items.

1. **GBuffer2.z for skin.** The deferred light reads it only for Foliage (transmission). Does anything else (a debug view, the two "Setup_UseTranslucency"-named programs, which actually hold a sun-only light using GBuffer2.w bits) consume skin's `0.4 + 0.6·G`?
2. **Stencil write.** Confirm that the engine writes `materialType` into stencil bits 5–7, via a runtime capture or the pass stencil setup code.
3. **Skin-profile table.** The table holds 8 slots per frame; `roughness0/1` and `lobeMix` form the dual-lobe specular kernel (§2.3). What happens with more than 8 distinct `.sp` on screen, and how do `blurSize`, `diffuse` and `falloff` drive the blur? Which lights set the per-light roughness byte, and to what (photo-mode lights in particular)?
4. **Metal ≥ 0.1 threshold.** The SSS blur and combine skip pixels whose blended metalness exceeds 0.1 [source]; the flag controlling the light's albedo = 1 path is unknown. Does metallic makeup over skin show a visible SSS seam at soft edges (the lifted metal ramp on the next candidate)?
5. **Eye second vector.** What exactly is the octahedral vector the Eye class stores, and how does the light use it? What consumes `Blick`, `SubsurfaceFactor` and `AntiLightbleed*`?
6. **`eye_shadow` as a gloss shell.** Is it usable as a glossy-makeup shell (sorting, `transparent_back_face` stage semantics, blink, cost)? (Its vanilla user is the eye mesh's wetness chunk.)
7. **Runtime gradient atlases.** Recover the atlas construction for `.gradient` and `.hp` (row assignment, colour space, filtering). This affects eyes, brows, lashes and hair.
8. **Unmapped debris.** Recover the G-buffer render-target formats (8-bit vs 10-bit precision affects the sqrt encoding) and the meaning of the low 5 stencil bits.
9. **Ray-tracing libraries.** Parse the ray-tracing libraries in `staticshader_final.cache`. Their names survive (`ShadeSurfaceWithLightSample*`, `GBuffer0..2`), which could confirm the BRDF and G-buffer semantics independently.
10. **Multilayer levels.** Confirm the multilayer levels semantics (`roughLevelsIn/Out` pairs) against the `m_surfaceCache_GenerateMultilayer` program.
11. **`Color` parameter encoding.** Do `CMaterialParameterColor` values reach shaders as byte/255 (as `eye_shadow`'s in-shader 2.2 linearisation suggests) or sRGB-decoded? This sets the in-game strength of the Colour-shifting tint. What is `MaterialModifiersConsts[2].x` on the player head?
12. **Debug views.** Can the engine's `EEnvManagerModifier` debug views (G-buffer, Roughness, Metalness, Translucency, MaterialID) be enabled from CET or RED4ext? That would turn most questions here into one capture session.
13. **Decal depth bias.** What depth bias does `OFFSET_DecalBias` apply, and does it explain why a coincident decal failed only close up?
14. **Temporal filtering and upscalers.** Which program is the main anti-aliasing? Does the engine apply a negative texture LOD bias under DLSS, FSR3 or XeSS? How do the upscalers treat stable 2–3 pixel glints? Tracked in [Glitter in game](glitter-in-game.md#open-questions).

## In-game test asks

Batch these into one prepared session with fixed camera, FOV and light, and record game and framework versions.

1. **Finish board (first photo-mode session held 25 September).** The [finish board](../experiments/016-finish-board/README.md#runtime-results) packaged asks 1–3 as six selector presets through the production pipeline, with its own test card: flat finishes and single-lobe Glossy (Board 1), faceted Shimmer and a coarse glitter proxy (Board 2), and the Fresnel colour shift with its strength-0 control (Boards 3 and 4).
   - Capture a camera orbit under fixed light, then a light sweep under a fixed camera, at close and face framing, with a blink.
   - The `eye_shadow` gloss shell (Glossy route 2) is not on the board; it needs a second component.
2. **Sqrt-space blend check.** Board 5: black Matte patches at 25/50/75 % coverage under the eyes, contrast 0, captured in photo mode with fixed exposure.
   - Compare measured luminance with linear and sqrt-space predictions.
3. **Metal threshold edge.** Board 6: a metalness ramp 0 → 0.3 and five steps (0.05–0.3) over Satin.
   - Look for a visible seam at 0.1.
4. **Plate depth and gloss (built, not installed).** [Experiment 017](../experiments/017-plate-depth/README.md) packages the depth comparison (0, 0.1, 0.2 and 0.4 mm lifts), the gloss controls (surface off, roughness forced to 1, roughness +0.12) and a stronger Shimmer, with its own test card. It replaces the earlier backlit-translucency ask: GBuffer2.z does not reach skin lighting.
5. **Debug views.** If a debug-view toggle is found (open question 11), capture Albedo, Roughness, Metalness, Translucency and MaterialID views of the plate once.

---

Related: [Glitter in game](glitter-in-game.md) · [mesh-decal contract](../research/materials/mesh-decal-shader-contract.md) · [glossy feasibility](../research/materials/glossy-decal-feasibility.md) · [colour-shift feasibility](../research/materials/colour-shift-game-feasibility.md) · [multilayered assessment](../research/materials/multilayered-makeup-assessment.md) · [glint feasibility](../research/materials/redengine-glint-feasibility.md) · [finish taxonomy](../research/materials/makeup-finish-taxonomy.md) · [skin trace](../research/eye-artistry/saved-skin-shader-and-winner.md) · [eye/lip optics](../research/eye-artistry/eye-lip-optics-audit.md) · [backlog](../research/backlog/materials-shader-re.md). Community sources are acknowledged in the [community credits](../docs/community-credits.md).
