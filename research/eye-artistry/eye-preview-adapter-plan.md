# Saved-eye preview adapter — 23 September 2026

The [resolved Kala eye option](modded-eye-resolution.md) can replace the yellow placeholder using the existing eye mesh and diffuse-texture path. The current UVs support that bounded correction. A diffuse swap will not reproduce the game's cornea, iris depth, reflection or subsurface response. The initial investigation changed no application source; the subsequent integration below implements its bounded diffuse contract.

**Integration checkpoint:** `eye-appearance.ts` validates an optional local manifest, verifies image hashes, preloads before save selection and requires exact app-hash/definition identity. `scene.ts` retains the existing opaque material and gaze rig, explicitly resetting the diffuse on unresolved choices. `tools/intake_eyes.ts` prepares ignored local inputs only. The saved-V card names the selected source. Browser reload, gaze and unavailable-image fallback pass; [evidence](../../projects/xf-appearance-studio/authoring/evidence/saved-eye-preview-2026-09-23.json). General resource resolution and optical parity remain open.

## Measured inputs

Local inputs and derived files remain ignored under `research/consumers/saved-v-eyes/raw/`. `adapter-audit.json`, `native-uv-comparison.json` and `adapter-manifest.json` retain measurements and hashes. The prior `manifest.json` remains unchanged.

| Input | Evidence |
|---|---|
| Current `authoring/public/assets/head.glb` | SHA-256 `72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8`; eye node references mesh 2, historical mesh name `submesh_01_LOD_1`; 662 vertices, two UV sets, no tangent attribute |
| Current `eye-color.png` | 2048² historical UDIM crop, SHA-256 `92ecdf42807fc58554d259a3fa04914c2b8c34d0616e4c04791ae6c7344b3249` |
| Kala diffuse PNG | 512², SHA-256 `cc06290fe63cba59b42f11b97c06e364661e704c206b1e63a3b2c9420bc84d35` |
| Kala normal PNG | 512², SHA-256 `4d552554539649f591e0cb41719c6950ce84a02bc518e2f735314773b068848d` |
| Kala roughness PNG | 512², SHA-256 `1d30af6b0fc1d742287b01f517a56eb9f8ca427f684b0f79b39b412232f42c9e` |
| Game `base\materials\eye.mt` | FNV-1a resource hash `7679860726048573814`; extracted from both `memoryresident_1_general.archive` and `ep1_1_nightcity.archive`; byte-identical SHA-256 `c6eff77a473912680a5d3e2e439ef4fe6d9e664ee6238d0745e1e39b801e073e` |

Normal/roughness were exported using WolvenKit Console 8.17.4, the same `export … --uext png -o … -gp …` procedure as the diffuse. All three XBM files were serialized to JSON. These are local conversions, not redistributable app assets.

## UVs and image orientation

`authoring/tools/export_preview.py` subtracts `(1,1)` from the historical Blender eye UV0 before glTF export. It crops the old 3×3 diffuse atlas at tile `(1,1)`. The current renderer loads that separate PNG with `flipY=false`, `SRGBColorSpace`, UV0 and no texture-transform adjustment.

Measured current UV0 bounds are `(0.001953125, 0.00244140625)` to `(0.992149353, 0.992149353)`. The frontmost vertex of each eyeball is exactly `(0.5,0.5)`. Nearby higher-Y vertices have lower V. Kala's PNG places the pupil at its image centre and uses the same complete-eye layout, rather than a separate iris-only tile. Do not crop this new texture again or add another UDIM translation.

A stronger independent check used the native female eye resource:

`base\characters\head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\he_000_pwa_c__basehead.mesh`

Resource hash `17194564122230518757`, extracted from `basegame_4_appearance.archive`. ArchiveXL's `bundle/source/resources/PlayerCustomizationEyesScope.xl` identifies this as `player_wa_base_eyes.mesh`. Its second render chunk has 668 vertices; UV0 is an explicit `PT_Float16_2` stream. Reading that stream and comparing UV sets gives:

- **All 662 preview UVs exactly match native UV-set members after modulo-one wrapping and V inversion.** Maximum nearest UV distance is zero.
- Without V inversion, only two exact matches exist, with maximum nearest distance 0.0526761.
- The native pupil U values are `1.5` and `-0.5`, both V `0.5`; the preview folds both into `(0.5,0.5)`. Out-of-range native U is therefore information that the simplified preview has discarded.

This supports preserving the existing glTF/PNG orientation (`flipY=false`) for the diffuse replacement. It does **not** prove a one-to-one geometry mapping: native and historical preview meshes have different counts and positions. Nearest-position matching was explicitly rejected as correspondence evidence. It also does not prove that the game eye shader samples every map at unmodified UV0; its side-dependent/refraction calculations remain to be traced. A future faithful eye shader may need original tiled UVs or an explicit left/right attribute.

The attempted ordinary CLI eye-mesh GLB export required a depot setting and failed; no global tool setting was changed. UV evidence instead comes directly from the serialized native render buffer, so that failure does not invalidate the comparison.

## Texture channels and colour space

Serialized XBM setup establishes, independently of filenames:

| Texture | `isGamma` | Compression | Preview interpretation |
|---|---:|---|---|
| Diffuse | 1 | `TCM_QualityColor` | sRGB colour |
| Normal | 0 | `TCM_Normalmap` | Linear/non-colour packed normal data |
| Roughness | 0 | `TCM_DXTNoAlpha` | Linear/non-colour scalar data |

The normal PNG's blue channel is **zero everywhere**, alpha 255. Red spans 1–250 and green 4–253. An ordinary RGBA PNG assigned directly to Three's `normalMap` would decode Z as −1; this is not a usable conventional RGB normal map.

The community Blender eye adapter supplies useful corroboration: `material_types/eye.py` calls the shared normal reconstruction group; `materials/blender/nodes.py:98` rebuilds Z from RG and inverts green under the label “Convert DX to OpenGL Normal.” It uses a 1.020 radicand constant, which is an adapter choice, **not established here as the game's exact eye formula**. No adapter code was copied.

Three 0.186.0 already has packed-RG reconstruction in `normal_fragment_maps.glsl.js`, but `WebGLPrograms.js` enables it only for `RGFormat`, `RG11_EAC_Format` or `RED_GREEN_RGTC2_Format`. Loading an ordinary PNG through TextureLoader does not activate it. A later normal integration should use a deliberate RG data texture or a documented reconstructed RGB derivative, `NoColorSpace`, and the DirectX-to-OpenGL green sign exactly once. Test tangent handedness on both eyes and under gaze before calling it correct; current eye geometry has no explicit tangent attribute.

The roughness PNG is approximately grayscale, **not channel-identical**: R 8–132, G 4–134, B 8–132. The Blender adapter uses G multiplied by `RoughnessScale`, as does Three's standard roughness-map convention. That is a plausible preview adapter, not proof of the REDengine eye shader's chosen component. Do not transfer the already-proven decal shader's red-channel rule to this unrelated eye shader.

Diffuse alpha spans 0–255. The inspected `eye.mt` declares `RMT_Eye`, normal material priority, and inspected render states disable blending while enabling depth writes. Keep the first diffuse adapter opaque; do not infer transparency or introduce alpha testing simply because the PNG has alpha. Alpha's actual eye-shader meaning is unresolved.

## Minimal integration contract

1. Resolve the saved eye group by the **app hash plus definition** already recorded in the resolution report: `7132639559252259433` / `eye_16_diffuse`. Use the explicit local manifest/provider chain. Do not use visual colour similarity or a filename-only global match.
2. Serve the locally extracted 512² diffuse with its recorded hash. Assign it to the existing eye material's map using sRGB and `flipY=false`; keep current geometry, rig/gaze, opaque state and transforms. No resampling or tint is justified by this evidence.
3. Preserve the known fallback for unresolved choices and report which source is active. Switching/importing/reloading a V must resolve again without retaining the previous V's successful texture accidentally. Missing local assets should remain an explicit fallback state.
4. Verify both pupil centres and scleral landmarks in a neutral pose, then exercise gaze and saved-V reload in the isolated workspace. The subsequent integration checked these visually and verified exact restored metadata/pose; see the evidence above. This is not a calibrated game-image comparison.
5. Label material response approximate. Keep normal/roughness integration separate until its optical/channel checks are implemented; a wrong packed normal is worse evidence than an explicit unimplemented normal adapter.

## Optical work still open

The bridge's `eye_base.mi` inherits `eye.mt`, sets `Blick` cubemap, `NormalBubble`, `RefractionIndex≈0.97`, `RefractionAmount=1`, `IrisSize≈0.737374`, left/right horizontal angles −5/+5, `EyeRadius≈0.0152`, `EyeParallaxPlane≈0.0134`, `BubbleNormalTile≈0.631313`, egg/iris mask controls, `RoughnessScale≈0.493421`, `SubsurfaceFactor≈0.2`, and anti-lightbleed controls. These are concrete material parameters, not interchangeable with similarly named Three/Principled settings. In particular, setting physical IOR to 0.97 would be an unjustified interpretation; the Blender adapter itself flags that mapping as uncertain.

Still unresolved: shader sampling/UV transformation and tiled eye-side semantics; actual roughness channel and scale application; two-stage normal/cornea response; alpha meaning; iris depth/refraction and pupil treatment; engine subsurface/anti-lightbleed; lighting/environment matching; and any Character Rendering Editor runtime overrides. This audit inspected the material template and parameters but deliberately did not disassemble an eye shader variant. Shader cache infrastructure already documented in `research/materials/glitter-shader-investigation.md` provides the next route without launching the game.

## Provenance to carry into central credits

- **Kala / guidethisonekalaheria**, [Kala's Eyes Standalone V2](https://www.nexusmods.com/cyberpunk2077/mods/3242), installed 1.0: actual locally selected texture triplet, now normal/roughness decoded and channel metadata measured. Existing resolution report records Sarah Cartwright's source texture credit and reuse restrictions. No redistribution.
- **nutboy / brocreate**, [Unique Eyes to CCXL](https://www.nexusmods.com/cyberpunk2077/mods/23263), installed 1.0: effective material inheritance and parameter values, including the separation between texture replacement and optical shader behavior. Local inspection only; preserve upstream permission requirements.
- **Cyberpunk Blender add-on / WolvenKit and contributors**, [eye adapter](https://github.com/WolvenKit/Cyberpunk-Blender-add-on/blob/7a4ee793c36d9615946fe87ec9d42cde7568021d/i_scene_cp77_gltf/material_types/eye.py) and [normal reconstruction](https://github.com/WolvenKit/Cyberpunk-Blender-add-on/blob/7a4ee793c36d9615946fe87ec9d42cde7568021d/i_scene_cp77_gltf/materials/blender/nodes.py), manifest declares `GPL-3.0-or-later`: learning only, no code adaptation; packed normals, green inversion, roughness-G precedent and explicit uncertainty about IOR mapping. Individual author of these specific changes not independently resolved; inline JATO attribution is not a full authorship audit.
- **WolvenKit contributors**, Console 8.17.4 and source `11720772f1e20581301b3dec88a59f7b5ee05675`: native stream format/orientation inspection, hash extraction, XBM conversions and serialization. Tool/format use.
- **Three.js contributors**, local 0.186.0 source: texture colour-space settings, packed-normal format gating, and roughness-G behavior. Dependency/source inspection, not copied shader implementation.
- **psiberx and ArchiveXL contributors**, `5474e34d56112f5d8843ae863e1e72ff510957c0`: eye scope resource links identify the native female eye mesh. Learning/source inspection.

The parent integration checkpoint must update `docs/community-credits.md` with these additional lessons; this delegated slice intentionally owns only this research document and ignored local outputs.
