# Private native-eye visual inspection

25 September 2026. This is a bounded **offline Blender inspection** of the pinned native head and all three native eye GLB chunks at idle frames 0, 169, 331 and 490. It renders both neutral and the previously captured saved five-morph head. The two passes are (1) a source-map approximation with eye surface, native lash and wetness geometry and (2) an eye-only cyan geometry diagnostic. Sixteen private 1080 × 720 PNGs live under ignored `generated/renders/`; no screenshot or extracted asset is tracked. The later [source-graph trace](source-graph-trace.md) proves this comparison omitted the native eye's matching `h091` morph and morph-specific joint binds. Thus its saved-pose images are a **neutral-eye-versus-morphed-head diagnostic, not game visual evidence**.

## Reproduce and source gate

First reproduce the [finite study's private posed surfaces](finite-clearance.md) and the [experiment 013 source-map candidate](../013-native-preview-core/README.md). Its `candidate.py` and `verify.py` produce and check the exact native GLBs and six source maps. The renderer additionally requires private WolvenKit exports of `base/characters/common/eyes/eyelashes_wa_01.mi` and `eyeshadow_base.mi`, plus `base/characters/common/hair/textures/hb1_brow_beard_lashes/hb1_01__lash_single_d.xbm` and its WolvenKit-decoded PNG beneath this experiment's ignored `generated/materials/` and `generated/material-textures/` paths. The script checks their hashes before drawing.

```powershell
python experiments/013-native-preview-core/verify.py experiments/013-native-preview-core/generated/visual-study
& 'PATH_TO_BLENDER_5_EXE' -b -t 4 --python experiments/015-native-eye-assembly/render-native-eye.py -- --mode source --frames 0,169,331,490
& 'PATH_TO_BLENDER_5_EXE' -b -t 4 --python experiments/015-native-eye-assembly/render-native-eye.py -- --mode eye-only --frames 0,169,331,490
```

The source gate pins head GLB `0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730`, eye GLB `0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba`, lash instance `6dffe3f4d48d79c1ec3d17d3b4fd19eb388a45f96875273661e0b443139b7f27`, wetness-slot instance `c8cd52dada67db836eb4bff2f409d96a61589b725fc3713673f063231b73a9e8`, lash XBM `5897127a8acc95866a0f6d4ae14ce79a2543f8a5526cfe9f7dec51ac7afc9977` and decoded lash PNG `c844d762c249ebf7e17c009605929c736aa039e53e698863d3d9fa6415be82de`. It also checks the prior manifest's head/eye diffuse-map hashes and every posed geometry/index hash. The native eye resource's embedded material links point to `eyelashes_wa_01.mi` and `eyeshadow_base.mi`; its MeshOnly GLB gives all three primitives the placeholder `Default` material, so their actual shader passes cannot be recovered from that GLB alone.

Blender 5.0 Cycles CPU uses 24 samples, fixed seed, no denoising, one fixed frontal orthographic camera, lights and Standard colour transform. The script strips only Blender's time-varying PNG text metadata after rendering. Two independent four-thread runs produced identical PNG SHA-256 for both frame-0 shapes; a one-thread run produced the same decoded pixel hash for neutral frame 0. The eight-PNG private source manifest SHA-256 is `695bdef47a8afbc16ace32482cbf1e1059080e4c3a7956b18ae86f4bcf2e6c36`; the eight-PNG eye-only manifest SHA-256 is `c9e921c2469d4f89f471ec8275e9fd096555550f4397ce501ef8a895bbbfeaa0`. Each manifest contains individual file SHA-256 values and source hashes. All 16 file hashes were checked independently against the private manifests.

## Visual findings

| Frame | Neutral head | Saved five-morph head |
|---|---|---|
| 0, phase start | Continuous lid rim; native lash strands straddle the upper/lower boundary. | Eye-only pass reveals small disconnected eye-surface slivers above each outer upper lid. The mapped pass shows pale wedges there and a dark lower-inner gap. |
| 169, minimum lid-joint gap | Lids meet continuously in both passes; lash cards remain along the seam. | Both sides leave a large exposed upper eye island and a bright lower eye strip separated by a broad lid band. This is plainly visible with the mapped eye and with cyan diagnostic eye geometry. |
| 331, horizontal gaze extreme | Eye surface remains inside the opening in the frontal view. | Pale upper outer eye wedges and shifted lower/inner boundaries remain; the eye base diffuse appears cyan/white in the opening. |
| 490, opposite horizontal gaze extreme | Eye surface remains inside the opening in the frontal view. | Similar upper outer wedges and lower/inner boundary discontinuity remain. |

The severe frame-169 saved-pose exposure is the clearest visual meaning of the [finite checker](finite-clearance.md)'s 255 eye/head contact pairs with opaque ray witnesses there; its neutral count is zero. These images show a **geometry/pose mismatch in this incomplete offline assembly**, particularly across a blink, and explain why raw contact counts alone were not sufficient. The mapped native lash cards visually cover parts of the edge but do not hide the upper eye islands. The wetness chunk is present in the source pass but is drawn with a deliberately diagnostic cyan translucent material, so its exact edge and alpha behavior are not established.

## Material confidence and limits

- **High, geometry/pose:** exact hash-gated native head/eye GLBs, source UV0, native lash/wetness geometry and the prior pinned body/facial pose sampler. The view is frontal only; no runtime idle graph or between-sample behavior is inferred.
- **Moderate, colour placement:** verified D05 native head albedo and eye base diffuse, plus the source lash `Strand_Alpha` texture path and decoded pixels. Blender recomputes normals and uses simple diffuse/roughness and hair-colour approximations. The lash texture is a scalar strand mask; the native `hair.mt` pass and profile are not implemented here.
- **Low, optics/parity:** the selected eye diffuse lacks the unresolved generated brown iris gradient/filter. Native wetness is not source-shaded; `eyeshadow_base.mi` is an embedded link for the wetness slot, not a sufficient optical recipe. Alpha/depth order, cornea, game skin/eye shader, actual material overrides and effective mod winner remain unresolved. The pale/cyan iris and cyan wetness diagnostic must not be interpreted as the intended game eye colour.

The next discriminator is the source-complete private comparison in [the trace](source-graph-trace.md): apply the matching eye `h091` target and coordinated head/eye binds before judging the seam. If a gap persists, an observed game blink with the same saved shape can then test runtime behavior. This study does not justify changing Studio's renderer or moving an eye material into production.
