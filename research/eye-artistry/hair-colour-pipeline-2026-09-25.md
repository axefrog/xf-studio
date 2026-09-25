# Brow, lash and hair colour pipeline: evidence and capture request

25 September 2026. This note records the evidence behind the preview change. The consolidated explanation is [hair shading](../../knowledge/hair-shading.md). No game launch took place. Extracted resources, compiled programs and screenshots stay in ignored local folders. This note records only names, hashes and measurements. **Game parity is not claimed.**

## What changed in the preview

| Detail | Before | After |
|---|---|---|
| Hair strands | `id × rootTip × 1.3` from 256-entry filtered palettes. Alpha test 0.12. Standard PBR card lighting. | The `hair.mt` base colour: a truncated lookup into a baked `sampleCount` row, then an overlay with root-to-tip as base, then the vertex-red shadow term and `|c|`. Coverage uses `Strand_Alpha.r` with the `.mi` `AlphaCutoff`, through alpha-to-coverage. Lighting is the decoded Hair-class direct light (R + TRT + multiple-scatter diffuse) on the skinned strand bitangent, with card specular off. |
| Lashes | Flat `#302d29`, exposure-fitted to the creator swatch. Standard lighting. | Albedo from the same `hair.mt` arithmetic, using the eyelash placeholders and the `.hp` chosen by the generic provider rule. Roughness comes from the `.mi` chain (1.0). Lit by the same hair light. |
| Brows | The double-diffuse colour and coverage, alpha-blended linearly over lit skin. | The same colour and coverage, reproducing the engine's `sqrt`-encoded G-buffer blend over the skin albedo sampled beneath each brow vertex. |

Manifests: the hair manifest is now `xfs/local-hair-assets-3`, adding `profile.sampleCount` and the `.mi` scalar overrides. The lash manifest is now `xfs/lash-profile-preview-2`: a generic strand-profile manifest listing **every** installed provider of the profile depot path, with an optional explicit override. Legacy v2 and v1 manifests still load; they fall back to template or eyelash-`.mi` values and label them as such. After this change, rerun `tools/intake_hair.ts` and `tools/intake_lash_profile.py` (usage is in each file) to regenerate the private manifests.

## Source evidence

| Program | GUID | SHA-256 |
|---|---|---|
| `hair` `alpha_accum` PS (MeshSkinned) | `2782105832921211528` | `2b0f35971acfe9c38eb7fa304962a8ef9271357b9964fd743aacb93cf8a4267a` |
| `hair` `basecolor_blend` PS | `7571795766366002052` | `7647ccdcb67473f7dcc90e415ad2591da70beaeceb2d9169b045b0a2c1bcbf23` |
| `hair` `gbuffer_solid` PS | `2903833597335136032` | `ade6c2a6fe7bf980b117e41a4eb2b296f7a71491cedcb18aca56ecd1b73808cc` |
| `hair` `basecolor_blend` VS | `7115927943278841644` | `65b1b1b968812873b548dd3d8201451cde418deeb3aa67c72c03a394c5cd07ae` |
| `m_shaderLightsComputeGlobalOnly_Clustered_00010001` (Standard + Hair) | `7525818560587663624` | `07ebbaf9319500b776b8afaa3602c984f7576b4b93a33f5416cf19fea9f6c8e3` |
| `…_Clustered_00000001` (Standard only, comparison) | `11542214229456522081` | `0f19c90e26e485b45a6b69475ad174ab1b884092a8efe06041a792739a30f691` |

Reproduce with `research/materials/shader-system/shader_cache.py extract <GUID>` and `dxc -dumpbin`. Key SSA values in `basecolor_blend`:

- `%44`–`%64`: profile row reads;
- `%65`–`%90`: overlay;
- `%91`–`%126`: shadow term.

In the light program:

- `%80`–`%138`: hair frame;
- `%447`–`%585`: R lobe;
- `%586`–`%637`: TRT lobe;
- `%638`–`%690`: diffuse.

The executable's option strings were read with a byte search of `Cyberpunk2077.exe` (2.31).

Resource facts:

- `hair.mt` defaults come from a WolvenKit 9.0.1 serialization.
- `Strand_ID`/`Strand_Gradient`/`Strand_Alpha` placeholders and the MELUMINARY `id`/`grad`/`a` textures are `isGamma=0`; `hair_lm60_f` is `isGamma=1`.
- The MELUMINARY strand GLB vertex colour is all zero; the cap GLB's red channel averages 0.61.
- On the strand cards, the glTF tangent follows UV U (median |cos| 0.996) and cards are about 6× longer along V.

## Colour-space test (hypothesis support)

`tools/hair-profile-swatch-fit.py` compares the creator swatch of each vanilla profile with the mean over a uniform grid of ID × root-to-tip samples, as an angle between linear colours (brightness-independent). Across 24 profiles (23 excluding `pink_rose`, whose swatch duplicates `blue_steel`), the fits are:

| Hypothesis | Median angle | Median exposure |
|---|---:|---:|
| Overlay, stops decoded from sRGB (Studio model) | 4.8° | 0.92 |
| Multiply, decoded | 6.5° | 1.87 |
| Blender add-on `id^2.2·rt^4.5` | 9.0° | 3.45 |
| Overlay with swapped roles | 11.0° | 0.87 |
| Multiply, raw | 15.6° | 0.82 |
| Overlay, raw stops | 19.1° | 0.42 |

## Browser comparison (isolated, fixed camera)

Captures come from `tools/hair-colour-look.ts`: an isolated `?verify=1` workspace, disposable data, headless Chrome, and the reference save imported through the normal file action. Idle and surface guides are off; exposure is 1.2 and key angle 0. Three fixed cameras were used: face (0, 1.705, −0.42) → (0, 1.695, 0); eye (−0.034, 1.712, −0.2) → (−0.034, 1.706, 0); hair three-quarter (−0.38, 1.74, −0.5) → (0, 1.66, 0). All use a vertical FOV of 30°. The "before" frames used the previous commit's code and manifests.

Each value below is the mean display sRGB of the pixels that change when that detail is toggled. It is a raster measure, not a material value.

| View | Brows before → after | Lashes before → after | Hair before → after |
|---|---|---|---|
| Face | (150,123,108) → (141,114,99) | (128,107,104) → (121,81,70) | (100,88,83) → (90,76,71) |
| Eye | (140,112,96) → (130,102,86) | (117,102,98) → (105,64,49) | (99,83,78) → (106,86,79) |
| Hair ¾ | (146,119,105) → (138,111,96) | (123,103,99) → (118,82,71) | (101,88,83) → (86,73,68) |

Visual inspection at normal and enlarged size:

- The lashes lost their silver-grey sheen and read as dark red-brown.
- The brows are slightly darker and denser at their fringes.
- The hair has near-black roots and warm brown lengths with a light streak structure, where before it was pale grey-beige with a silvery card sheen. Faint cool highlights come from the bluish fill light's R lobe.
- The browser reported no shader errors.

Two trials were rejected:

- A derivative-based Kajiya-Kay lobe produced bright, blocky bands.
- Proportional coverage with the old card specular made the hair paler.

The alpha-weighted mean hair albedo under §3 of the knowledge page is sRGB ≈ (74, 61, 54). The uncontrolled in-game reference photograph shows darker hair, median about 30–37 sRGB in the scalp and side regions. Lighting, exposure and scene differ, so this gap is not calibrated.

## Remaining uncertainty

- The profile bake's colour space and sample positions [hypothesis].
- The hair-light option values. The preview now uses vanilla values from a third-party list, per the [calibration note](hair-calibration-2026-09-25.md#3-hair-light-constants). The local-light and environment hair paths are still undecoded.
- The runtime winner for `brown_liquorice.hp`. The preview uses the mod candidate under the mod-over-base expectation; the base profile would render the lashes golden-tan.
- Whether the preview's ambient and exposure resemble any game scene.

Mod-specific code that this work touched but did not expand is migration debt:

- `scene.ts` hard-codes the brow/lash detail identities and fallback colours;
- `brow-material.ts` pins the Arkhe style-18 manifest identity and material constants;
- the hair cap keeps a provisional recolor.

## Matched in-game capture request

Superseded by the [refined capture request](hair-calibration-2026-09-25.md#refined-capture-request). It adds a CET dump of the hair GameOptions, a neutral-light photo-mode set and a same-frame colour ladder that separates the profile bake from lighting.

## Reproduction

```powershell
cd projects/xf-studio/authoring
# Private manifests into an ignored overlay (public/assets may be a read-only link):
bun tools/intake_hair.ts <extracted saved-hair raw dir> --out data/asset-overlay/hair
python tools/intake_lash_profile.py --appearance 6047185506343464350 --definition 05_brown_liquorice --swatch 50,44,40 `
  --depot-path "base\characters\common\hair\textures\hair_profiles\brown_liquorice.hp" `
  --mi <softnatural_eyelashes_pwa.mi.json> --mi <eyelashes__default.mi.json> `
  --candidate "basegame_4_appearance.archive|base|<base .hp>|<base .hp.json>|<container sha256>" `
  --candidate "Alliekat's Natural Hair.archive|mod|<mod .hp>|<mod .hp.json>|<container sha256>" `
  --placeholders <decoded placeholder dir> --out data/asset-overlay/lashes
$env:XFS_ASSET_OVERLAY = "data/asset-overlay"
bun tools/hair-colour-look.ts <private save copy> evidence/screenshots/hair-colour/after 4394
python tools/hair-profile-swatch-fit.py <vanilla .hp.json dir> <female_cco.inkcharcustomization.json>
```

Container hashes and provider details are in the [overlap audit](brown-liquorice-profile-overlap.md). `bun test`, `bun run check` and `bun run build` passed on this checkpoint.

Community sources used are recorded in the knowledge page's sources: Modding Docs pages by manavortex, based on island_dancer's notes; the Cyberpunk Blender add-on; WolvenKit; and the MELUMINARY, island_dancer, Alliekat, icxrus and Arkhe mods as private reference inputs.
