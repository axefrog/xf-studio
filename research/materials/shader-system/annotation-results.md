# Shader annotation: recovered names and validation (game 2.31)

Evidence note for `shader_annotate.py` ([usage](README.md#annotating-programs-with-template-names)). It records what the annotator recovers, the optional decompiled listing, three validation programs and where the community "emissive decal" snippet actually comes from. All annotated listings stay in the git-ignored `research/consumers/shader-system/raw/annotated/`. The excerpts below are short lines from the tool's listings. In lifted pseudo-HLSL, `_N` = SSA `%N` and is valid only in the named program. Decompiled excerpts are marked as such. Nothing here was observed in a running game.

Inputs are the pinned caches and templates in the [evidence note](README.md#inputs-read-only), disassembled with Windows SDK 10.0.22621 `dxc -dumpbin`.

## Two listings: lifted and decompiled

`shader_annotate.py` produces two listings of each program.

**Lifted** (`<GUID>.hlsl`, the default). The tool lifts the `dxc -dumpbin` LLVM IR itself, in pure Python:

- It folds expressions.
- It rebuilds `if`/`else`/`switch` from post-dominators.
- It turns phi nodes into assignments.
- It keeps loop back-edges and unstructured joins as labelled `goto`.

Its `_N` names are the `.ll` SSA numbers, so this is the listing to cite.

**Decompiled** (`--decompile`, `<GUID>.decompiled.hlsl`). DXIL goes to SPIR-V with dxil-spirv, then to HLSL with SPIRV-Cross. The lifter's names are then applied to that source (see [usage](README.md#annotating-programs-with-template-names)).

| Tool | Build used | Licence | Binary |
|---|---|---|---|
| [dxil-spirv](https://github.com/HansKristian-Work/dxil-spirv) | Commit `f2d1b554` with its pinned submodules; no published releases, so it is built with CMake + MSVC 2022. It needs no external LLVM. | MIT | `dxil-spirv.exe` 3.8 MB + `dxil-spirv-c-shared.dll` 2.3 MB |
| [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) | Commit `aa217aeb` (after tag `vulkan-sdk-1.4.357.0`), same build. Its only Windows binary release is inside the LunarG Vulkan SDK, which was not installed. | Apache-2.0 | `spirv-cross.exe` 2.3 MB |

**What the decompiled listing adds:**

- **Structure.** Loops are `for (;;)`, and the lifter's `goto` joins become breakable blocks. In the metal_base, skin and multilayered_clear_coat programs below, 2, 2 and 1 `goto` become 0.
- **Real HLSL.** Values are typed and resource declarations are complete, so a listing can be compiled, edited and recompiled for experiments.
- **Named `cb4`.** It is redeclared per register, e.g. `float EmissiveEV : packoffset(c12);  // Scalar default 0`, and texture reads use `#define Emissive Bindless[Emissive_bindlessIndex]`.

**What it costs:**

- It runs to about 1.3–1.8× the lifter's line count, because it keeps single-use temporaries and SPIRV-Cross boilerplate (zero-initialised outputs, a `discard_state` demote emulation, the entry wrapper).
- Its `_N` are SPIRV-Cross ids, not SSA numbers.

**metal_base emissive block** (pixel `1846801220589112223`, the program that matched the community snippet). The lifted listing:

```hlsl
if (EmissiveEV > 0.0) {
    float4 _115 = Emissive.Sample(s0, float2(TEXCOORD0.x, TEXCOORD0.y));  // Emissive
    float _121 = ((1.0 - EmissiveLift) * _115.x) + EmissiveLift;
    float _127 = max(log2(max(_121, 1e-07)) + EmissiveEV, 0.0);
    float _142 = (((EmissiveColor.x * _43.x) - _54) * _128) + _54;   // _128 = saturate(_121)
```

SPIRV-Cross before renaming:

```hlsl
if (_46_m0[12u].x > 0.0f)
{
    float _269 = ((1.0f - _46_m0[14u].x) * _11[asuint(_46_m0[10u]).x + 0u].Sample(_54, float2(TEXCOORD0.x, TEXCOORD0.y)).x) + _46_m0[14u].x;
```

The decompiled listing after renaming:

```hlsl
if (EmissiveEV > 0.0f)
{
    float _269 = ((1.0f - EmissiveLift) * Emissive.Sample(s0, float2(TEXCOORD0.x, TEXCOORD0.y)).x) + EmissiveLift;
    float _278 = clamp(_269, 0.0f, 1.0f);
    _297 = (((EmissiveColor.x * _148) - _161) * _278) + _161;
    _300 = max(log2(max(_269, 1e-07f)) + EmissiveEV, 0.0f);
```

**Where the snippet came from [hypothesis].** The unrenamed SPIRV-Cross output has the same shape as the [community snippet](#the-community-emissive-decal-snippet): `_N_m0[reg]`, `asuint` bindless indices and a bare `TEXCOORD` input name, which is dxil-spirv's default. That suggests the snippet came from this toolchain, for example through vkd3d-proton, which uses dxil-spirv. It is not evidence of which program the snippet came from.

### Coverage and checks

**Raw chain on all 2,119 extracted programs.**

- dxil-spirv converted all 2,119.
- SPIRV-Cross emitted HLSL for 1,993. The other 126 are mostly forward and transparent programs (holograms, blackbody, particles, vehicle lights, the `multilayered_clear_coat` unlit pass) and fall back to GLSL:
  - **102 use a wave-op helper that HLSL cannot express.** dxil-spirv lowers `WaveReadLaneFirst` in pixel programs to a helper-lane-masked helper, and SPIRV-Cross cannot write `BallotFindLSB` in HLSL. The switch that disables the masking is not exposed on dxil-spirv's command line.
  - **24 use a float-granular cbuffer view** that HLSL packing cannot express. dxil-spirv adds that view for dynamically indexed reads.

**Annotator run.** This used the same one-representative-pixel-program-per-template harness as the [coverage run](#coverage-run-one-representative-program-per-template), over 339 templates (31 s).

| Result | Count |
|---|---|
| Decompiled / tool failures | 339 / 0 |
| HLSL / GLSL fallback | 253 / 86 |
| HLSL that compiles with `dxc` | **244 of 253** |
| Template parameters read by the program / named in the decompiled source | 3,501 / 3,493 |

- **The 9 `dxc` failures come from SPIRV-Cross, not from the renaming.** The unrenamed output fails in the same way:
  - Six hair-family programs write conservative depth (`oDepthGE`/`oDepthLE`), and SPIRV-Cross's `SV_Position` interpolation mode is then invalid.
  - Three have packed signature rows (two elements in one register), which SPIRV-Cross gives the same semantic.
- **The 8 unnamed parameter reads** go through the float-granular view by dynamic index. They print as `ShaderSpecificConstants_floats[i]`, where register = i / 4.

**The renaming preserves the program.** Five validation programs were checked: metal_base pixel, skin pixel and vertex, mesh_decal pixel and mesh_decal_emissive pixel. Each was compiled with `dxc` twice, from the unrenamed and the renamed source. The two builds have identical instruction multisets. The one exception is that bindless indices are now loaded as typed `uint` (`cbufferLoadLegacy.i32` instead of `.f32` plus a bitcast). This checks the rename step only.

**Validation programs, as decompiled:**

- **metal_base.** Pixel and vertex `11774188032190459829` compile.
- **skin.** Pixel and vertex compile. They show `min(uint(SkinProfile), 7u)` and `SV_Target2.z = (TEXCOORD3.w * 0.6f) + 0.4f`, and the vertex program shows `out_TEXCOORD3.w = COLOR0.y`. This agrees with the [skin result](#basematerialsskinmt).
- **mesh_decal.** It compiles. It shows the `DepthThreshold` discard against `SharedPixelConsts[25..26]` and the `NormalsBlendingMode` branch as structured `if`/`else`.
- **`multilayered_clear_coat` `unlit` (`5403688829342147459`).** This needs the GLSL fallback, because its cb13 has a float-granular view. Its `WaveReadLaneFirst` calls appear as a `subgroupBallot`/`subgroupShuffle` helper.

### Limits of the decompiled listing

- **The decompilers are not checked against the original DXIL.** A decompiled listing is a second reading, not proof. Where it disagrees with the `.ll`, the `.ll` wins.
- **GLSL output is not compile-checked**, because no GLSL compiler is installed.
- **Packed signature rows keep dxil-spirv's names** (`TEXCOORD_2`), because several elements share one location.
- **Float literals are rewritten** to the shortest decimal that round-trips to the same float32. SPIRV-Cross prints the exact expansion.
- **Engine registers have names only where they are known.** Registers that the lifter labels (for example the `GlobalShaderConsts[0].x` time) carry that label in the file header only, not inline.

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
| **Render targets** | Each target's template pass blend/write mask. G-buffer roles are added for `gbuffer_regular`, `gbuffer_velbuff_regular` and `post_gbuffer`, from [knowledge §2.2](../../../knowledge/materials-and-shaders.md#22-the-g-buffer). | [resource] + consolidated reading |

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

- **Lifted listing not compilable.** The lifted pseudo-HLSL is a reading aid. It uses sequential phi copies, falling back to temporaries only when phis of one block reference each other, and loops stay as `goto`. Use `--decompile` for compilable, structured source ([limits](#limits-of-the-decompiled-listing)).
- **Evidence graded by use.** Engine-register labels marked "inferred by use" rest on one program's arithmetic.
- **Cache-name ambiguity.** Templates are joined to programs by cache name, so a name shared by several depot paths would be ambiguous (none observed). Templates outside `memoryresident_1_general.archive` are not annotated.
- **SM 6.6 not covered.** SM 6.6 `CreateHandleFromBinding` handles are only labelled raw. No such program was seen in this cache.
