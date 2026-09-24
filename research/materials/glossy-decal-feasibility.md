# Glossy eye makeup: why the stock wet decal is not a safe shortcut

23 September 2026. Read-only inspection of the installed game's compiled shader cache and local WolvenKit-exported material templates. This is a **shader/pass assessment**, not a game-rendered result. The current reference recipe has two enabled glossy eyeliner layers, which the flat preset compiler deliberately rejects.

## Relevant compilation and template

The installed 2.31 `shader_final.cache` contains 108 `mesh_decal_wet_character` compilations. The selected `MeshSkinned` `renderstage_post_gbuffer` entry has vertex GUID `7037176062922522222`, pixel GUID `17388524518779931857`, and material GUID `10373864754015329280` in the [cache index](evidence/shader-cache-index.json). Its extracted pixel DXBC SHA-256 is `e8c589f5453f33113ce4bbd3b8de55b4d176e4c132a42231a9617c9ea4641135`. The ignored local disassembly is `research/consumers/glitter/raw/shaders/mesh-decal-wet-character-skinned-fragment.ll`; it can be reproduced with the project [cache reader](../../projects/xf-studio/authoring/tools/inspect_shader_cache.ts) and Windows SDK `dxc -dumpbin`.

The installed 2.31 `mesh_decal_wet_character.mt` binary (SHA-256 `2613b74fdbf71f2069e8b5ce1e411335d556e40cf33e58f4cdea3a66833c1c89`) was extracted locally and compared with an older game-2200 export. Their RootChunk structure agrees for the fields relevant here. The post-G-buffer pass enables three independently alpha-blended RGB targets, with source-alpha/inverse-source-alpha factors, depth testing on and depth writes off. The G-buffer pass has depth writes on and its pixel shader disabled; pass selection therefore matters. The extracted game file and JSON remain local, outside Git.

## What the selected pixel shader actually writes

Cross-referencing texture reads and material parameter order with the serialized template gives this output contract for the post-G-buffer pass:

| Target | Relevant compiled output | Implication |
|---|---|---|
| Colour | Diffuse sample/colour with alpha from `DiffuseAlpha` and coverage | The painted eyeliner can be masked. |
| Normal | Separate normal and alpha path | Normal influence need not equal colour coverage. |
| Roughness/metalness | Red-channel scalar texture reads produce its R/G values; **the target's alpha is literal `1.0`** (`storeOutput`, target 2, alpha, disassembly line 468) | The pass blends surface properties wherever the plate rasterizes, even where the colour mask is transparent. |

The inspected shader has no pixel `discard`, and its output path reaches that constant-alpha write. Although the template declares `RoughnessMetalnessAlpha`, this selected pixel program does not use it to mask target 2. The contrast is material: the [standard `mesh_decal.mt` compilation](mesh-decal-shader-contract.md) multiplies roughness/metalness target alpha by its coverage and configurable `RoughnessMetalnessAlpha`.

**Inference:** putting `mesh_decal_wet_character` on the whole expanded eye plate for narrow glossy eyeliner would probably overwrite roughness and metalness on surrounding skin and lower makeup. Its name and lower roughness controls do not establish safe transparent cosmetic layering. Treat this as a reason to exclude that stock template from the first authored glossy export, pending a targeted in-game check. A tightly cropped dedicated eyeliner mesh might limit the damage, but would complicate arbitrary user-drawn contours and morph/deformation; it is not an established solution.

The normal/roughness/metalness response is still a single surface layer. It does not demonstrate the browser's separate base lobe plus clearcoat lobe. A low-roughness, nonmetallic `mesh_decal_blendable.mt` instance is a plausible **single-lobe glossy approximation** because its skinned post-G-buffer pixel program masks colour and roughness/metalness target alpha by coverage. The installed 2.31 template SHA-256 is `ddfacaf5894b6aba9cfde35d796ccad415d5db16d6c8e4851d7f3875d8266bbe`; the selected pixel GUID is `3004271728282315156`, with DXBC SHA-256 `3126455caa2ac51cd9188a840e00ad5fb71e485606a7ced0ab159fb5d866d50c`. Its diffuse alpha is `DiffuseAlpha × coverage`; roughness/metalness alpha is `RoughnessMetalnessAlpha × coverage`, with coverage derived from the colour mask after contrast and a secondary mask. This is a compiled-shader observation, not a game-rendered guarantee. The candidate changes the look of an authored two-lobe glossy recipe, so keep the current `UnsupportedMaterialError` unless an explicit approximation is selected and validated.

The installed `multilayered_clear_coat.mt` template (SHA-256 `0893221f2405a6e5401695123641f9995d663c7aa184e0161967de836f1a3518`) uses a skinned G-buffer pass with blending disabled and depth writes on. It does not establish a transparent eye-plate clearcoat overlay. The investigated roughness-only decals mask target 2, but their compiled variants use `MVF_Decal`, not the skinned plate route. No faithful clearcoat-compatible transparent makeup path is proven.

## Next bounded validation

1. Review and reproduce the separate **explicitly labelled approximation fixture** using current `mesh_decal_blendable`: transparent diffuse with low-roughness alpha-masked scalar channels. Check its encoded textures, material references and coverage independently of the browser recipe. The fixture is material-only; mesh/morph/app/CCXL integration is a later gate.
2. Package controlled glossy/matte comparisons using the existing plate only after its clearance decision. Verify CR2W references, native skin bytes, `xfs_` names, and selector/Off transitions offline.
3. In one batched game session, compare glossy approximation and wet-character diagnostic at a dark eyeliner edge and on bare skin beside it, then switch preset/Off. Capture fixed camera/light screenshots and logs. Do not claim runtime coverage behavior from compiled inspection alone.

These material facts derive from CD PROJEKT RED's local game resources. WolvenKit enabled template/cache inspection; its contribution is recorded in the [community learning record](../../docs/community-credits.md). No upstream assets or shader binaries are committed.
