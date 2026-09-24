# Brow texture and installed-provider audit

23 September 2026. Bounded read-only follow-up to the supplied comparison, `a local clipboard image (personal Temp path withheld)`. No renderer, assets, originals or game installation changed. The screenshot alone cannot identify a texture path or runtime winner.

## Result

The preview is using the recorded **Arkhe Beautiful EYEBROWS II FULLER, style 18** diffuse export. Its intake label agrees with the saved appearance's actual app → morph → mesh → material → texture references; no alternative installed archive providing those exact resources was found. There are, however, concrete coverage and colour differences in the preview implementation:

- The image passed to Three.js `alphaMap` is an RGBA diffuse image. `alphaMap` samples its **green channel**, not its alpha channel. The two channels differ substantially in this actual image.
- The browser uses the fixed brown `#675147`, with no saved `brown_ombre` gradient, secondary diffuse or normal-map contribution.
- The installed profile contains **Alliekat's Natural Hair Tones**, which supplies a replacement for precisely the `brown_ombre` gradient requested by the selected brow material. The browser does not consume it.

These are strong candidates for a fuller/differently patterned and incorrectly coloured preview. They are not yet proof of the reported visual cause. The correct channel combination must come from the actual double-diffuse shader, not from assuming the PNG alpha alone is the answer. Do not change the selected style or thin geometry to conceal these unresolved material differences.

## Saved identity and material chain

The captured save records app hash `10685882159528859062`, appearance `ark_eyebrows_02_ccxl_18`, definition `10_brown_ombre`. The serialized component refers to morph hash `5838896660247859963`; its incidental `resolvedDependencies` text still mentions style 05, but the component reference resolves to style 18. See [original assembly evidence](head-details.md).

All paths below use the same installed archive:

`F:/Games/MO2/mods/Beautiful EYEBROWS II - CCXL - Realistic Textures - BOTH V/archive/pc/mod/Arkhe_Beautiful_Eyebrows_02_FULLER_CCXL.archive`

| Role | Resource path | Path hash |
|---|---|---:|
| App | `arkhe\ccxl_eyebrows_02\app\pwa\ark_eyebrows_02_ccxl_18_pwa.app` | 10685882159528859062 |
| Morph | `arkhe\ccxl_eyebrows_02\models\pwa\heb_000_pwa__morphs_18.morphtarget` | 5838896660247859963 |
| Mesh | `arkhe\ccxl_eyebrows_02\models\pwa\heb_000_pwa_c__basehead_18.mesh` | 6964115484359009791 |
| Material | `arkhe\ccxl_eyebrows_02\materials\ark_eyebrows_02__18.mi` | 17519094438502283721 |
| Diffuse | `arkhe\ccxl_eyebrows_02\textures\ark_heb__base_d18.xbm` | 12014415929380493100 |
| Secondary diffuse | `arkhe\ccxl_eyebrows_02\textures\ark_heb_wa__base_ds18.xbm` | 8825559761805751330 |
| Normal | `arkhe\ccxl_eyebrows_02\textures\ark_heb__base_n18.xbm` | 11366430283384820302 |

The sibling `.xl` supplies copied vanilla morph data and mesh render buffers to the partial style resources. The base material is `base\materials\mesh_decal_double_diffuse.mt`. Inspected material values include `DiffuseAlpha=1`, `NormalAlpha≈0.8`, `UseNormalAlphaTex=1`, `SecondaryDiffuseAlphaIntensity≈0.7`, `UseGradientMap=1`, `GradientMapIntensity=0.5`, base diffuse RGB `(103,81,71)` and secondary RGB `(62,49,42)`.

The mesh's local `@brows` material declares dynamic gradient path `*base\characters\common\hair\textures\cap_gradiants\hh_cap_grad__{material}.xbm`. For the saved colour this resolves to `hh_cap_grad__brown_ombre.xbm`, path hash `17043542013265241872`. The enabled installed provider is:

`F:/Games/MO2/mods/Alliekat's Natural Hair Tones/archive/pc/mod/Alliekat's Natural Hair.archive`

## Coverage discrepancy measured from current PNG

`authoring/public/assets/brows-alpha.png` is byte-identical to `research/consumers/saved-v-brows/raw/ark_heb__base_d18.png`:

`SHA-256 5fac5306ee4f32c082a6739457170e5f5d2aac5e2f3a73eb3c903628ebfdb56f`

It is RGBA, 2048×1024. RGB channels are identical to one another, but differ from alpha. Over the whole texture, green ranges 0–247 with mean 19.100; alpha ranges 0–237 with mean 10.535 (all in 0–255 units). These averages are diagnostic channel statistics, not a prediction of perceived brow thickness.

`authoring/src/scene.ts` assigns this texture to `MeshStandardMaterial.alphaMap`, with no diffuse map, `alphaTest=0.01`, transparent blending and `NoColorSpace`. The installed Three.js 0.186.0 `alphamap_fragment.glsl.js` explicitly multiplies opacity by the sampled green channel. This explains why the filename `brows-alpha` is misleading: it is the exported diffuse image being repurposed as a coverage mask, not a separately verified engine coverage texture. Secondary and normal inputs are entirely absent from that material.

## Installed providers, variants and limits

MO2's current `selected_profile` is `2025 (again)`. Its mod list enables both the Arkhe II mod above and Alliekat's Natural Hair Tones. Arkhe metadata identifies Nexus mod 26168, installed version 1.0.0.0, file 129560, package `Beautiful Eyebrows - 02 - Fuller - CCXL-26168-1-0-1765398379.zip`. The installed mod description distinguishes Default/natural from Fuller/pencil-makeup variants, and says to use only one. **FULLER is the variant actually present**, not a speculative selection by the studio. No DEFAULT provider for the selected resource hashes was found in installed mod archives.

The older, also-enabled Arkhe set contains `Arkhe_Beautiful_Eyebrow_Material_FULLER.archive` and `Arkhe_Beautiful_Eyebrow_SET_01.archive`, but neither supplies any of the selected Arkhe II hashes or the checked copied vanilla female geometry hashes. Do not conflate the two collections merely because their names are similar.

[Provider metadata](brow-texture-audit-index.json) records a read-only hash scan of **1,103 archive indexes**, with zero parse errors, covering every `.archive` beneath MO2 `mods`, `overwrite`, `_overwrite_`, and physical game `archive/pc/mod`. For selected Arkhe II resources, the FULLER archive was the sole provider. The gradient had the Alliekat provider. No mod archive supplied the checked base shader template or the copied vanilla female brow mesh/morph paths. The scan did not read game content/DLC base archives, downloaded/uninstalled packages or REDmod sources outside these roots. It did not resolve runtime ArchiveXL patches or dynamic script changes. A targeted text search for the Arkhe namespace, exact gradient name and double-diffuse template in installed `.xl`, `.yaml`, `.lua` and `.reds` files found only Arkhe II's own `.xl`.

The archive index reader followed the field layout in the local WolvenKit `ArchiveReader.cs`: 28-byte index header and 56-byte file entries. FNV-1a resource hashes independently match the saved app and compiled morph hashes. Index SHA-1 fields for these entries contain the empty digest and **must not be treated as payload integrity evidence**. Full container SHA-256 values at audit time:

- Arkhe FULLER archive: `62bc69d17a7f1f0c28e8f12e219e1c717a44d2f3386c40ffdee0c222b99456c0`.
- Alliekat gradient archive: `eb16849ae89094d94d7adf5431a6bfb1ead7f2bdf4bb90426d3249637b00c616`.

These findings establish unique **installed candidates** under the enumerated roots, not the assets loaded in the photographed reference game session. No game launch, new extraction or current-runtime resource inspection was performed. The existing extracted JSON/PNG chain was checked, not freshly decoded from the current container. The enabled Character Rendering Editor is an additional runtime-material research lead; its saved configuration was not audited here and no effect is assumed.

## Next bounded work

1. Inspect the actual double-diffuse shader's RGBA, secondary, normal-alpha and gradient combination. Reproduce its coverage semantics in an isolated comparison before changing the main preview.
2. Decode the installed Alliekat gradient as a local-only input and reproduce the selected brown ombre path; preserve provider hashes and fallback behavior.
3. Compare current green-only, verified shader coverage and completed colour/secondary adaptation at the same head morph, pose, camera and lighting. Keep brow geometry unchanged during this diagnosis.
4. If discrepancy remains, verify current extracted resources against the current archive payloads, examine runtime material settings, then add a matched brow reference to the already planned batched game session. No immediate launch is necessary.

## Provenance to integrate centrally

- [Arkhe / Beautiful EYEBROWS II](https://www.nexusmods.com/cyberpunk2077/mods/26168): existing asset research credit extended with exact style-18 material/texture chain and installed Default/Fuller distinction. Current local version/file identified above; third-party textures remain local only.
- [Alliekat / Natural Hair Tones](https://www.nexusmods.com/cyberpunk2077/mods/15787): discovered installed dependency of the saved brow gradient, version 1.0.0.0, metadata modified 15 July 2024. Learning/provider attribution; no new asset reuse yet.
- [WolvenKit contributors](https://github.com/WolvenKit/WolvenKit/blob/11720772f1e20581301b3dec88a59f7b5ee05675/WolvenKit.RED4/Archive/IO/ArchiveReader.cs): archive-index binary layout used for this read-only census; no upstream implementation file copied.
- [Three.js contributors](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/alphamap_fragment.glsl.js): existing renderer dependency/source inspection established green-channel alpha-map semantics. Parent task owns central credits integration before checkpoint.
