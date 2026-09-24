# Shader-system evidence: caches, G-buffer and deferred lighting (game 2.31)

Evidence note behind [knowledge/materials-and-shaders.md](../../../knowledge/materials-and-shaders.md). It records the repeatable method and the compiled-program observations; the knowledge page holds the consolidated reading. All extracted programs, disassemblies and serialized templates stay under the git-ignored `research/consumers/shader-system/{raw,json}/`. Nothing here was observed in a running game.

## Inputs (read-only)

| Input | Identity |
|---|---|
| `PATH_TO_GAME/engine/shader_final.cache` (material shaders) | 161,804,693 bytes, SHA-256 `339145371a3b5aaa08eb4ef82d558f445b632e28603ee0f3b4860270dfc3ccfa`, RDHS v10; 19,037 programs, 19,647 compilation records |
| `PATH_TO_GAME/engine/staticshader_final.cache` (engine shaders) | 14,966,384 bytes, SHA-256 `bff160947aba8df144200247adc39b44c26322360628d875f7c7218ad26c59ff`, RDHS v8; 845 DXBC programs, 1,061 technique names |
| `PATH_TO_GAME/archive/pc/content/memoryresident_1_general.archive` | SHA-256 `71d3d4116eee455b75309e0c36f5af5aa2fef17ecf509639c3e3a622fcf32295`; holds all 373 `.mt`/`.remt` templates |
| WolvenKit CLI 8.17.4 | `unbundle -r "\.(mt|remt)$"`, then `convert serialize`; JSON header `GameVersion: 2310` |
| Windows SDK 10.0.22621 x64 `dxc.exe -dumpbin` | SHA-256 `e51ba98aee7656b05ecea156107398d2b62224eb185d90d0fea9d45d62733ad5` |

The installed tree also ships PS4/PS5/Xbox/Vulkan caches (`shadervulkan*.cache` etc.); they were not examined.

## Method (repeatable in minutes)

```powershell
# 1. Index both caches (writes json/material-index.json and json/static-index.json)
python research/materials/shader-system/shader_cache.py index
# 2. Find a template's compiled variants; filter on pass and vertex factory
python research/materials/shader-system/shader_cache.py find mesh_decal --info "post_gbuffer'.*VF: MeshSkinned\]"
# 3. Extract + disassemble (writes raw/<GUID>.dxbc and raw/<GUID>.ll)
python research/materials/shader-system/shader_cache.py extract 16098255505177109230
# 4. Signature, bindings and every render-target store
python research/materials/shader-system/shader_cache.py summary 16098255505177109230
# 5. Engine (static) shaders by technique name
python research/materials/shader-system/shader_cache.py static "LightsComputeGlobalLocalShadows_Clustered_[01]+$"
# 6. Template parameters/registers/passes (after WolvenKit unbundle + serialize into raw/templates)
python research/materials/shader-system/template_summary.py "base/materials/skin\.mt$"
```

`CP2077_GAME_DIR` and `DXC_EXE` override the default locations.

Reading a disassembly:

1. **Material constants are `cb4`**, one 16-byte register per template parameter; the register number is the template's `usedParameters[2]` register (`template_summary.py` prints it). The program's own `%ShaderSpecificConstants` type lists one field per register (`i32` texture index, `float` scalar, `<4 x float>` vector/colour), which confirms the mapping. Textures are bindless: the shader loads an integer index from the same `cb4` register and calls `createHandle` on a large `t0, space1` range. So a texture parameter's register also leads to its sample.
2. **Render targets** are `storeOutput(sigId=target, …, component)`. `summary` lists them.
3. Engine buffers keep their **struct type names** in the DXIL resource metadata: `cb0` `GlobalShaderConsts`, `cb1` `CameraShaderConsts`, `cb12` `SharedPixelConsts`, `cb13` `CSConstants`, and so on (full table in [annotation results](annotation-results.md#what-is-recovered-and-what-stays-anonymous)). Their member names are gone, so identify individual registers by use, for example camera position (subtracted from world position) or a light direction.
4. Record SSA numbers only together with the program GUID and SHA-256, because numbering is per program.

Format notes:

- In every v10 compilation record the **first** GUID is the vertex program. The second is the pixel program in 17,083 records and absent in 2,564, which are depth-only or pixel-less passes. WolvenKit's `ShaderCacheReader.cs` labels them the other way round.
- The static v8 cache has a 16-byte tail: `RDHS`, version 8, then 8 unknown bytes. After a descriptor region, it stores contiguous `[u64 guid][u32 size][DXBC]` records. Each descriptor stores its program GUID(s) about 111 bytes **before** its length-prefixed technique name. `shader_cache.py` attributes each GUID to the following name.
- That name association is a heuristic. The lighting programs below were confirmed by their content: the class switch, the G-buffer decode and the material-mask test.
- Ray-tracing libraries (`rgs_reference_main` etc.) sit in the same file in another container form. Their metadata keeps names such as `GBuffer0..2` and `ShadeSurfaceWithLightSampleFullLighting`. They are not parsed yet.

## Annotating programs with template names

`shader_annotate.py` does steps 3–4 and the register mapping automatically. It lifts the `dxc -dumpbin` DXIL into readable pseudo-HLSL and names:

- every material constant and bindless texture after the template parameter, with its class and default;
- engine buffers by their DXIL struct name;
- each pixel input by the vertex inputs it depends on;
- each render target by its template blend state, plus its G-buffer role in G-buffer passes.

No DXIL decompiler is installed, so the tool does its own lifting in pure Python, using only the Windows SDK `dxc` that step 3 already needs. Output is written to the ignored `research/consumers/shader-system/raw/annotated/` as `<GUID>.hlsl` plus `<GUID>.annotated.ll`, the original disassembly with name comments.

```powershell
# Prerequisites: shader_cache.py index, and template_summary.py (writes json/template-summary.json)
# Annotate every matching compilation of a template (pixel + vertex programs)
python research/materials/shader-system/shader_annotate.py annotate "base/materials/mesh_decal.mt" --info "post_gbuffer'.*VF: MeshSkinned\]"
# Annotate one known pixel program of a template
python research/materials/shader-system/shader_annotate.py annotate "base/materials/skin.mt" --guid 12806642364631437234
# Find which programs contain a code pattern (all regexes must match the pseudo-HLSL)
python research/materials/shader-system/shader_annotate.py search "metal_base.*|cable" "if \(EmissiveEV > 0\.0\)" "\+ EmissiveEV, 0\.0\)"
```

It uses the same `CP2077_GAME_DIR` and `DXC_EXE` overrides as `shader_cache.py`.

Read `_N` as SSA `%N` of that program's `.ll`. Loops stay as labelled `goto`, and the listing is a reading aid, not compilable source.

Recovered names, what stays anonymous, a coverage run over all templates and three validation programs are in [annotation results](annotation-results.md).

## Programs examined in this pass

| Program | Role | Pixel/compute DXBC SHA-256 |
|---|---|---|
| static `m_classifyMaterials`, compute `13401747477113664336` | Per-tile material-class mask | `04c2534b71a79869da18dda1aabdeec53177293ef38a862ea18d6a78507bda62` |
| static `m_shaderLightsComputeGlobalLocalShadows_Clustered_00000001`, compute `10862954502888615639` | Tiled deferred global light, Standard class only | `d2babcec049fe6827c7f00784d4aaa512cdd27905237033f27df79e2e7ce699a` |
| static `…_Clustered_11111111`, compute `6606735909222169407` | Same, all classes | `c0ce7b53584553eb3b6bba3cb75f7125f1bddc07cf34511060487212010dac86` |
| `skin` `gbuffer_regular` MeshSkinned pixel `12806642364631437234` | Skin G-buffer writer | `8040f820f64055156d8223e65d1463e785ca62007db8eaae92356cadcfa36053` |
| `mesh_decal` `post_gbuffer` MeshSkinned pixel `16098255505177109230` | Decal G-buffer blend | `35e8c18f7f90f77e82c536d114ed279cd39979cfb5a34c5e157e58762a905c3d` |
| `metal_base` `gbuffer_regular` MeshSkinned pixel `1846801220589112223` | Standard opaque G-buffer writer | `6b59ca6d02f54992f8ea6a13ed2680b80d7c4bc4ef6fc16d1c8b2f457caf0be9` |
| `eye_shadow` `transparent_back_face` MeshSkinned pixel `14043594489545752539` | Forward-lit transparent shell | `54e65aa46e0c224a3dcd35fc90d81c61fa30e47c2486392300902e64636266e0` |
| `multilayered_clear_coat` `unlit` MeshSkinned pixel `5403688829342147459` | Forward clear-coat pass | `2d4cb586c3c9a9a489a131dfa6523d39da94eab7fc167bee53d3edc7dcaddad5` |

## Observations

### G-buffer decode in the deferred light (`…_00000001`, SSA in that program)

- **Depth** is `t0.x` (`%53`). World position is rebuilt from a matrix in `cb12` registers 69–72.
- **GBuffer0** is `t1`. RGB is squared (`%68`–`%70`), so albedo is stored as `sqrt(linear albedo)`. Every G-buffer writer examined ends RGB with `Sqrt` (skin `%1125`–`%1127`, decal `%339`–`%341`).
- **GBuffer1** is `t2`. The normal is decoded as `normalize(rgb − 0.5)` (`%71`–`%78`). The skin writer stores `n / max(|n|) × 0.5 + 0.5` (`%1128`–`%1141`).
- **GBuffer2** is `t4`:
  - `.x` is metalness (`%63`).
  - `.y` is roughness, clamped to [0.04, 1] (`%79`/`%80`).
- **Stencil** is `t3` (u32), component `.y`:
  - The low 5 bits carry other flags.
  - `m_classifyMaterials` ignores value 17 (`%45`) and builds a per-tile bitmask from `(stencil >> 5) & 31`.
- **Base-colour / F0 split:**
  - diffuse = `albedo × (1 − metal)` (`%84`–`%86`)
  - F0 = `0.04 + metal × (albedo − 0.04)` (`%87`–`%95`)
  - The dielectric F0 is fixed at 0.04. **No G-buffer channel controls dielectric specular level.**
- **Diffuse** is renormalized Burley:
  - `fd90 = (2·LdotH² + 0.5)·r` (`%233`–`%237`), with energy factor `1/π − 0.1076·r` (`%250`/`%251`).
  - This matches the Frostbite "Moving Frostbite to PBR" diffuse.
- **Specular:**
  - GGX distribution with α = r², i.e. D uses r⁴ (`%254`–`%263`).
  - Height-correlated Smith visibility `0.5 / (NdotL·√… + NdotV·√…)` (`%264`–`%277`).
  - Schlick Fresnel with F90 = 1 (`%281`–`%293`).
  - Clamp at 100 (`%298`).
- **Sun/moon:** treated as a disk. The reflection vector is bent toward the light within an angular radius from `cb0` register 5 `.w` (`%180`–`%210`); this is the representative-point method.

### Material-class switch (`…_11111111`)

`(stencil >> 5)` is switched at `%70` (lines 237–241 of the disassembly).

| Value | Branch | Class |
|---|---|---|
| 4 | Rebuilds a tangent frame from GBuffer1. `GBuffer1.w × 3` selects the dropped axis (`%88`–`%146`). | Hair |
| 1 | If a `cb6` flag is set and metalness < 0.1, albedo is replaced by 1 (`%147`–`%154`). Later, a per-pixel colour is fetched from `cb6` register `4 + index`, with `index = (GBuffer1.w·3) << 1 | bit 6 of GBuffer2.w·255` (`%224`–`%237`). | Subsurface |
| 3 | Decodes a second, octahedral-encoded vector from GBuffer2.zw (8 bits each) plus two bits each from GBuffer0.w and GBuffer1.w (`%155`–`%192`), and zeroes the GBuffer2.z term. | Eye |

These values match the templates' `materialType` enum (`ERenderMaterialType`: Standard 0, Subsurface 1, Cloth 2, Eye 3, Hair 4, Foliage 5). The `_XXXXXXXX` suffix of the clustered-light variants is that class bitmask, and no `00000100` (Cloth-only) variant exists. That enum-to-stencil identity is an inference from matching values, not a traced write.

For every class except Eye, `saturate((GBuffer2.z − 1/3) × 1.5)` (`%85`–`%87`) scales an extra lighting term (`%1201`). What GBuffer2.z means is still a hypothesis:

- Standard writers store exactly 1/3 (metal_base target 2 `.z`, decal target 2 `.z`), so the term is zero.
- Skin stores `0.4 + 0.6 × TEXCOORD3.w` (`%1142`/`%1143`). Its vertex program `7494393843130164436` writes `TEXCOORD3.w = COLOR.y`, so the input is the **vertex colour's green channel** ([annotation results](annotation-results.md#basematerialsskinmt)).
- The engine's debug view list includes "Translucency", which fits this term.

### What writers put in the `.w` channels

- **Skin:**
  - The skin-profile slot comes from `cb4` register 24 (`SkinProfile`, `%565`), clamped to 0–7.
  - Its high bits go to GBuffer1.w (`%1106`) and its low bit to GBuffer2.w bit 6 (`%1107`/`%1108`).
  - GBuffer2.w bit 7 flags emissive, with 6 bits of emissive intensity; otherwise the 6 bits hold another saturated input (`%1109`–`%1124`).
  - GBuffer2.x is the Roughness texture's **G** channel (`%184`), in the slot the light treats as metalness.
- **metal_base:** GBuffer1.w = 0 and GBuffer2.z = 1/3.
- **mesh_decal `post_gbuffer`:**
  - GBuffer2.x = saturate(Metalness.R × scale + bias) (`%186`–`%193`); GBuffer2.y = saturate(Roughness.R × scale + bias) (`%173`–`%180`); GBuffer2.z = 1/3.
  - Each target's `.w` output is the blend weight.
  - The template's blend state is `SrcAlpha/InvSrcAlpha` on colour, with alpha factors `Zero/One` and write mask **RGB** on all three targets. Stencil is disabled.
  - So a decal never changes the underlying pixel's class bits, skin-profile slot or `.w` payloads. It does blend GBuffer2.z toward 1/3 wherever surface coverage is non-zero.

### Forward transparent passes that add a lobe

**`eye_shadow` `transparent_back_face`.** The template's blend is `One/SrcAlpha`, i.e. out = src + dst·srcAlpha. The program is a full forward-lit program with shadow-map compares and light buffers.

- `Mask` is `cb4` register 4:
  - **R**: shadow amount = saturate(`Intensity` × R^`Exponent`) (`%37`–`%50`).
  - **G** × `WetnessRoughness` (register 5): a wet-highlight roughness clamped to [0.04, 1] (`%772`–`%776`).
  - **B** × `WetnessStrength` (register 6): scales the lit highlight (`%1697`–`%1702`).
- `ShadowColor` is linearized with exponent 2.2 (`%51`–`%66`). The output alpha darkens the destination toward that colour's luminance (`%1703`–`%1708`).
- Output RGB is the highlight, clamped to 65,000.
- The Blender add-on's reading (R → alpha, A → coat) does not match this program.

**`multilayered_clear_coat` `unlit`.** The pixel program is a forward-lit program writing two outputs. Target 1 row 0 is written twice: once zero, once colour with alpha 1. The template blend is `One/Src1Color`, i.e. dual-source: the coat is added and the lit base is multiplied per channel. The G-buffer pass underneath is opaque, depth-writing and Standard class.

## Limits

- **One variant per pass.** Only the listed variants were read. Other vertex factories, `Discarded`/`Dismembered` variants, ray-traced and path-traced paths, and screen-space SSS passes may differ.
- **SSS and lighting details not traced.** The SSS pipeline (`m_postfx_SubsurfaceScattering_Setup/Blur/Combine`) and the local-light variants were identified by name only. G-buffer render-target formats were not recovered.
- **Offline evidence only.** No runtime capture confirms which variant draws a given frame.
