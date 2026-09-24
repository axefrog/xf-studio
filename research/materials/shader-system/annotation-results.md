# Shader annotation: recovered names and validation (game 2.31)

Evidence note for `shader_annotate.py` ([usage](README.md#annotating-programs-with-template-names)). It records what the annotator recovers, three validation programs and where the community "emissive decal" snippet actually comes from. All annotated listings stay in the git-ignored `research/consumers/shader-system/raw/annotated/`. The excerpts below are short pseudo-HLSL lines lifted by the tool; SSA numbers (`_N` = `%N`) are valid only in the named program. Nothing here was observed in a running game.

Inputs are the pinned caches and templates in the [evidence note](README.md#inputs-read-only), disassembled with Windows SDK 10.0.22621 `dxc -dumpbin`.

## Decompiler availability

No DXIL-to-HLSL/GLSL decompiler is installed on the workstation. The search covered `PATH`, `VULKAN_SDK` (unset, no `C:\VulkanSDK`), the local clone and tool folders, Program Files on all drives and an Unreal Engine 5.8 install. Only these turned up:

- `d3dcompiler_*.dll` copies: DXBC (SM5) only, and they cannot read DXIL.
- The UE ShaderConductor `dxcompiler.dll`, `dxil.dll` and `ShaderConductor.dll`: these compile HLSL to SPIR-V and on to other languages. They do not decompile DXIL.

`shader_annotate.py` therefore lifts the `dxc -dumpbin` LLVM IR itself (pure Python, no new binaries):

- It folds expressions.
- It rebuilds `if`/`else`/`switch` from post-dominators.
- It turns phi nodes into assignments.
- It keeps loop back-edges as labelled `goto`.

**Possible upgrade.** A dxil-spirv + SPIRV-Cross chain would give fully structured loops and typed vectors:

| Tool | Repository | Licence | Size | Notes |
|---|---|---|---|---|
| dxil-spirv | [HansKristian-Work/dxil-spirv](https://github.com/HansKristian-Work/dxil-spirv) | MIT | 6.7 MB repository | No published releases, so it must be built with CMake from source plus submodules. It needs no external LLVM. |
| SPIRV-Cross | [KhronosGroup/SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) | Apache-2.0 | 18 MB repository | Also ships as `spirv-cross.exe` in the LunarG Vulkan SDK. |

- The size of a built binary was not measured.
- The annotator's naming (template registers, struct names, G-buffer roles) would still be needed on top of that output. Their output addresses the cbuffer as `_22_m0[reg]`, which is the same register index the annotator maps.

## What is recovered and what stays anonymous

| Item | Recovered from | Grade |
|---|---|---|
| **Material constants** (`cb4`) | Parameter name, class, default and components read. The register is `usedParameters[2]` (pixel) or `[1]` (vertex). | [source] + [resource] |
| **cb4 layout check** | The DXIL keeps the type `%ShaderSpecificConstants = type {…}` with **one field per register**: `i32` for Texture/TextureArray/Cube (bindless index), `float` for Scalar, `<4 x float>` for Vector/Color. | [source] |
| **Bindless textures** | `createHandle` on the 32,768-entry `t0, space1` table, traced back to the cb4 register that supplies the index. It is printed as `Name.Sample(…)`. | [source] |
| **Engine constant buffers** | Struct type names kept in the DXIL `!dx.resources` metadata. See the table below. | [source] |
| **Engine registers** | Only the few whose use is decoded. Most stay `Struct[reg].c`. | mixed; each label states its basis |
| **Group-shared memory** | Demangled global names, e.g. `ldsMaterialMask` in `m_classifyMaterials`. | [source] |
| **Interpolators** | For each pixel input component, the vertex-stream inputs it depends on, from dxc's ViewId dependency table in the paired vertex program. The vertex program is also lifted. | [source] |
| **Render targets** | Each target's template pass blend/write mask. G-buffer roles are added for `gbuffer_regular`, `gbuffer_velbuff_regular` and `post_gbuffer`, from [knowledge §2.2](../../../knowledge/materials-and-shaders.md#22-the-gbuffer). | [resource] + consolidated reading |

**Engine constant-buffer names** in 2,119 extracted programs (vertex, pixel and compute):

| Register | Struct name | Register | Struct name |
|---|---|---|---|
| `cb0` | `GlobalShaderConsts` | `cb7` | `MaterialModifiersConsts` |
| `cb1` | `CameraShaderConsts` | `cb8`–`cb10` | `CullObjectsCB`, `WindDynamicsCB`, `TextureRegionsCB`, `FloatTracksDataCB` (the slot varies) |
| `cb2` | `ENV_PROBES` | `cb12` | `SharedPixelConsts` |
| `cb3` | `CustomPixelConsts` / `CustomVertexConsts` | `cb13` | `CSConstants` |
| `cb4` | `ShaderSpecificConstants` (material) | `cb6` | `COM` / `VER` (static compute programs) |
| `cb5` | `FrequentVertexConsts` | | |

**Still anonymous:**

- Field meanings inside the engine buffers. The structs keep types but not member names.
- Fixed-slot engine textures, e.g. `engine_t33`/`engine_t74` in `mesh_decal`, which are depth/normal-like by use.
- Structured buffers (`t2`/`t3` in multilayered programs).
- Samplers, which appear only as `s0`, `s8`–`s11`.
- **Multilayer layer textures.** They are indexed from a structured-buffer load, not from cb4, so they print as `t0[_N]`.
- **Engine-resolved classes** (`SkinParameters`, `DynamicTexture`, `Multilayer*`, `StructBuffer`) are reported with their field type but not type-checked.

The `SkinProfile` register is read as a float slot index and cast to `uint` [source].

## Coverage run (one representative program per template)

The run took one non-highlight/depth pixel program per cache template name, preferring one that reads cb4. It is a scratch harness, not a tracked tool.

| Result | Templates |
|---|---|
| Template names in the cache | 395 (383 with a non-highlight pixel program) |
| Annotated with a serialized template | 341 |
| No serialized template (outside `memoryresident_1_general.archive`) | 42 |
| cb4 register/type check consistent | **314 of 314 checked, 0 mismatches** |
| cb4 registers read that no template parameter owns | **0** |
| Programs with no `ShaderSpecificConstants` | 27 |
| Runtime-indexed (multilayer) bindless textures left as `t0[_N]` | 20 |
| Lifter failures on all 2,119 extracted programs | 0 |

## Validation programs

### `base\materials\mesh_decal.mt`

- **Program:** `post_gbuffer` MeshSkinned, pixel `16098255505177109230`, SHA-256 `35e8c18f…905c3d`.
- **Parameters:** all 29 are mapped and read, and the type check is consistent.

The UV, flipbook and output code reproduces the [decal contract](../mesh-decal-shader-contract.md) by name:

```hlsl
float _102 = (AnimationFramesWidth * frac(AnimationSpeed * GlobalShaderConsts[0].x)) * AnimationFramesHeight;
SV_Target0.x = sqrt(DiffuseColor.x * _116.x);           // _116 = DiffuseTexture.Sample(...)
SV_Target0.w = DiffuseAlpha * _152;
SV_Target2.x = saturate((MetalnessScale * _185.x) + MetalnessBias);
SV_Target2.z = 0.33333334;
```

Uses that the annotator exposes:

- **`GlobalShaderConsts[0].x`** is a time value, inferred by use.
- **`SharedPixelConsts[25..26]`** linearise depth for the `DepthThreshold` discard, also inferred by use.
- **Interpolator `TEXCOORD0.xy`** is the mesh `TEXCOORD0` passthrough.

### `base\materials\skin.mt`

- **Programs:** `gbuffer_regular` MeshSkinned, pixel `12806642364631437234` (SHA-256 `8040f820…fa36053`) with vertex `7494393843130164436` (SHA-256 `789b74c4…8f459b`).
- **Parameters:** all 25 are mapped. `SkinProfile` is `(uint)SkinProfile.x`, and `EmissiveEV` scales the `EmissiveMask` sample.
- **New [source] result:** the skin translucency input is the **vertex colour's green channel**.
  - The pixel program writes `SV_Target2.z = (TEXCOORD3.w * 0.6) + 0.4;`.
  - The vertex program writes `TEXCOORD3.w = COLOR.y;`, a direct passthrough. The ViewId table agrees: `TEXCOORD3.w` depends only on `COLOR0.y`.
  - This joins the wiki's "vertex colour G = SSS mask" to GBuffer2.z. What GBuffer2.z *means* is still the §2.2 hypothesis.

### `base\materials\mesh_decal_emissive.mt`

- **Program:** `post_gbuffer` pixel `9453098283293843067`, SHA-256 `8099da16…dbea3229`. The same program serves MeshSkinned, MeshExtSkinned and other compilations.
- **Parameters:** all 20 are mapped. `EmissiveEV` is register **9**, and register 10 is `AnimationSpeed`.
- **Targets:** the program writes only targets 0 and 2. Target 2 blends `One/One` with write mask **BA**.

```hlsl
float _160 = ((HardOrSoftTransition * (min(1.0, ((_147 * 4.0) * (1.0 - _147)) * FullVisibilityFactor) + -1.0)) + 1.0) * _139.w;
float _166 = max(log2(max(_160, 1e-07)) + EmissiveEV, 0.0);
SV_Target2.z = 0.33333334;
SV_Target2.w = (float)((uint)(sqrt(saturate(_166 * 0.1)) * 127.0) | ((_166 > 0.001) ? 128 : 0)) * 0.003921569;
```

Emission is encoded in the GBuffer2.w byte:

- bit 7 is the emissive flag;
- 7 bits hold `sqrt(EV/10)`, where EV is the diffuse alpha converted to stops plus `EmissiveEV`.

**Implication for makeup [hypothesis].** Because target 2 is **additive** on B and A, an emissive decal over skin would add into skin's GBuffer2.w payload (profile low bit and emissive bits) and add 1/3 to its GBuffer2.z. The arithmetic and blend state are [source]/[resource]. The visible effect needs a runtime check, and the G-buffer formats are still unrecovered.

## The community "emissive decal" snippet

The hypothesis was that the snippet shows emissive colour/EV with a mask in an emissive decal. **It is an emissive-with-mask block, but not a decal's.**

- **`mesh_decal_emissive` does not match.** Its `EmissiveEV` is cb4 register 9, and it has no mask-lift parameter.
- **The register pattern is metal_base-family.** A static search of all 373 templates for a texture at 10 with non-texture parameters at 11, 12 and 14 finds only the metal_base family with `Emissive`@10, `EmissiveColor`@11, `EmissiveEV`@12 and `EmissiveLift`@14 (plus unrelated layouts).
- **The code pattern confirms it.** `shader_annotate.py search` requires all five patterns: the EV gate, the lift, the log2 EV, the EmissiveColor lerp and an unscaled `TEXCOORD0` sample. It matches 148 pixel programs, all in `gbuffer_regular`/`gbuffer_velbuff_regular` passes of:
  - `engine\materials\metal_base.remt`
  - `metal_base_parallax`
  - `metal_base_dithered`
  - `metal_base_animated_uv`
  - `cable`

  A further 32 matching programs are `metal_base_blendable`, but its emissive registers are 16/17/18/20, so they cannot produce `m0[10..14]`.
- **Which template, exactly, cannot be decided.** These templates compile the same emissive block, so the snippet alone does not say which one it came from.

The mapping, verified in `metal_base` pixel `1846801220589112223`:

| Snippet | Recovered | metal_base line |
|---|---|---|
| `_22_m0[12u].x > 0.0f` | `EmissiveEV > 0` | `if (EmissiveEV > 0.0)` |
| `_11[asuint(_22_m0[10u].x)].Sample(_25, TEXCOORD.xy).x` | `Emissive` mask, sampled at **untiled** UV0 (other maps use `LayerTile × UV0`) | `Emissive.Sample(s0, float2(TEXCOORD0.x, TEXCOORD0.y))` |
| `_22_m0[14u].x` | `EmissiveLift`: mask = lerp(mask, 1, lift) | `((1.0 - EmissiveLift) * _115.x) + EmissiveLift` |
| `_22_m0[11u].x * _94` | `EmissiveColor.r × BaseColor texture.r` | `EmissiveColor.x * _43.x` |
| `_107` | `saturate(BaseColorScale.r × BaseColor.r)`, the unlit base colour | `_54` |
| `_244` | Base colour lerped toward the emissive tint by `saturate(mask)` | `_142` |
| `_247` | EV stops `max(log2(mask) + EmissiveEV, 0)`, later encoded into GBuffer2.w as for the decal | `_127` → `SV_Target2.w` |

So in the metal_base family, where the mask is non-zero, emissive **replaces the stored base colour** with `EmissiveColor × BaseColor`, and it carries its brightness separately as an EV value in GBuffer2.w.

## Limits

- **Not compilable.** The pseudo-HLSL is a reading aid. It uses sequential phi copies, falling back to temporaries only when phis of one block reference each other, and loops stay as `goto`.
- **Evidence graded by use.** Engine-register labels marked "inferred by use" rest on one program's arithmetic.
- **Cache-name ambiguity.** Templates are joined to programs by cache name, so a name shared by several depot paths would be ambiguous (none observed). Templates outside `memoryresident_1_general.archive` are not annotated.
- **SM 6.6 not covered.** SM 6.6 `CreateHandleFromBinding` handles are only labelled raw. No such program was seen in this cache.
