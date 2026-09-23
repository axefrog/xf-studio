# Brow and lash preview material gate

23 September 2026. Read-only diagnostic of the saved style-18 brow material, its three locally extracted texture images, installed archive-provider index, and the installed game's compiled double-diffuse pixel program. No preview material, save, game asset, or user draft changed. Game-derived shader bytes and PNGs remain ignored local inputs.

## Brow identity and inputs

The saved app hash `10685882159528859062`, appearance `ark_eyebrows_02_ccxl_18`, and definition `10_brown_ombre` select Arkhe Beautiful EYEBROWS II **FULLER** style 18. The existing [provider audit](brow-texture-audit.md) finds its app, morph, mesh, material, diffuse, secondary and normal resources only in `Arkhe_Beautiful_Eyebrows_02_FULLER_CCXL.archive` among 1,103 checked installed archives. The dynamic `hh_cap_grad__brown_ombre.xbm` path has an enabled Alliekat Natural Hair Tones provider. This establishes installed candidates, not the photographed game's effective runtime winner.

The saved material instance derives from `base\materials\mesh_decal_double_diffuse.mt`; its overrides include DiffuseColor `(103,81,71)`, SecondaryDiffuseColor `(62,49,42)`, DiffuseAlpha `1`, SecondaryDiffuseAlphaIntensity `0.7`, NormalAlpha `0.8`, UseNormalAlphaTex `1`, UseGradientMap `1`, GradientMapIntensity `0.5`, the style-18 diffuse, secondary alpha and normal textures. The browser currently uses diffuse RGB `#675147` as a fixed tint and gives that **RGBA diffuse** image to Three.js `alphaMap`, which samples green. It omits the secondary, gradient and normal material inputs.

| Local decoded image | SHA-256 | Relevant channel facts over 2048 × 1024 |
|---|---|---|
| `ark_heb__base_d18.png` | `5fac5306ee4f32c082a6739457170e5f5d2aac5e2f3a73eb3c903628ebfdb56f` | Green mean 19.100, alpha mean 10.535; green exceeds alpha in all 336,637 nonzero pixels, equal elsewhere. |
| `ark_heb_wa__base_ds18.png` | `1684bedf441efc495bd06f3c8c1438e7293dc00f7f3b4b55bc6ce254d1546eaf` | Red/green/blue/alpha equal; red mean 20.684 and nonzero in 410,235 pixels. |
| `ark_heb__base_n18.png` | `2426e263edecb13d79ba8b902780c82a5f15ca13f4bbb3fcf5e8474b0bc84584` | Red/green vary, blue is zero, alpha is 255 everywhere. |

Channel means are diagnostic statistics, not visual opacity estimates. Reproduce them with Pillow installed:

```powershell
python projects/xf-appearance-studio/authoring/tools/brow-channels.py D:\Dev\cp2077-modding-hq\research\consumers\saved-v-brows
```

## Compiled coverage and colour trace

The installed `shader_final.cache` has a `mesh_decal_double_diffuse` `MeshSkinned` `renderstage_post_gbuffer` pixel variant, GUID `8834363738920290566`. Its extracted 7,737-byte DXBC has SHA-256 `8397be365eb46c682e35d452cc9de7bb11dd5fe30b9f2a00eb2c96164ae73133`. Reproduce the ignored extraction and disassembly with:

```powershell
bun projects/xf-appearance-studio/authoring/tools/extract-brow-shader.ts 8834363738920290566
& 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\dxc.exe' -dumpbin research/consumers/brow-shader/raw/8834363738920290566.dxbc
```

The pixel program samples **two RGBA textures** at the same UV. It contrast-adjusts each sampled alpha, adds a weighted secondary contribution in uncovered primary areas, **squares that combined result**, then applies a separate red-channel mask factor before multiplying by an output-alpha scalar (DXIL values 132–184, 419–427). The second sampled alpha contributes even where primary diffuse alpha is zero. This rules out treating the diffuse image's alpha alone as final coverage. The precise binding/defaults for the second RGBA sample and separate red mask still require the current serialized base template and dynamic material resolution. A single-channel switch would be an unjustified production fix.

The primary texture RGB is tinted; the shader adds a secondary tinted RGB contribution in areas weighted by primary alpha (values 137–143, 362–378). When gradient use is enabled, it samples a 1D row at `v=0.5`, scales that RGB by GradientMapIntensity, and uses the result in the primary colour path (values 379–414). The selected installed gradient is Alliekat's override and has not yet been locally decoded. Normal RGB is not interchangeable with its alpha: the pixel program uses normal-map R/G with reconstructed positive Z, and separately selects a normal-coverage texture's red or diffuse alpha (values 185–252). The browser's fixed brown transparent material cannot reproduce these inputs.

## Lash limit and next implementation gate

The save selects Soft Natural Eyelashes `icxrus_softnaturaleyelashes`, `05_brown_liquorice`, app hash `6047185506343464350`. Its `Strand_Alpha` geometry/texture is already in the local preview, but its `#30221b` colour and standard transparent shading remain provisional. The saved brown-liquorice swatch is `#322c28`; dynamic hair profiles and the enabled Hair Profiles CCXL patch can alter effective colour, so a swatch replacement alone would overstate certainty. Preserve the lash style and deformation until the material/profile winner is resolved.

The smallest safe next implementation is an isolated comparison of (1) the current green-channel preview, (2) the complete double-diffuse coverage using current template defaults and material bindings, and (3) the decoded Alliekat gradient plus secondary/normal inputs at one saved morph, pose, camera and light. Verify filtered edges as well as texel centres. Only then promote the adapter to `scene.ts`. Resolve the lash dynamic profile and material family separately before changing its colour. If that comparison still differs from the photographed game, include a matched brow/lash reference in the planned batched runtime session. No new game launch is required for this gate.

The prior [community learning credit](../../docs/community-credits.md) for Arkhe, Alliekat, WolvenKit and Three.js applies; this follow-up adds local compiled-game evidence and no third-party code or asset reuse. The parent task should update the central record if it adds a new community-derived lesson at integration.
