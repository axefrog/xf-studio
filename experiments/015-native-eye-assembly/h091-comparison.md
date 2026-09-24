# H091-aware native eye/head comparison

25 September 2026. This bounded private follow-up applies the installed eye `h091_eyes` target to **all three** native GLB chunks while retaining the saved head's exact five vertex-morph selections: `h091_eyes`, `h012_nose`, `h053_mouth`, `h054_jaw`, `h145_ear`, each at weight 1. It also reads and pairs the head and eye `h091` morph-specific bone-rig matrices. Four previously selected UI-idle frames (0, 169, 331, 490) are compared against the earlier neutral-eye/morphed-head diagnostic. This is an offline geometry and approximate-material experiment, not live game or Studio preview parity.

## Reproduce and method

The [pose sampler](sample-h091-comparison.ts) checks SHA-256 of the installed head GLB, WolvenKit-exported eye morph GLB, the head/eye base-mesh and morph JSON, the two raw morph resources, pinned body/face idle and binding. Exact input digests and output digests are in [asset-free evidence](h091-comparison-evidence.json), SHA-256 `6d5a953b197c5f1111495bfd7ca491c2ea2cd49a01e19426ce0a6435636445e5`. Its source-matrix-to-GLB coordinate check agrees within **0.210 µm** at the base joint positions and confirms all 34 shared `h091` head/eye matrices are exactly equal. The eye morph GLB and original plain eye GLB have identical base vertices; the new GLB supplies 21 source targets. The other four saved head *vertex* morphs remain unchanged from the previous study.

The sampler converts each raw inverse-bind matrix into a morph-specific world bind using the verified RED-to-GLB axis mapping, sets both skin inverse binds and the current `IdleAnimation` world bind, then samples with Three.js `SkinnedMesh.getVertexPosition`. This is one explicit **world-bind-relative** policy. Under that policy, the morph-specific bind and its inverse cancel in the final skin transform because the same world motion delta is applied to the new bind. Consequently, the measured position change here is driven by the `h091` eye/lash/wetness **vertex target**, not proof that the game evaluates morph-specific bone animation this way. The head saved positions agree with the previous sampler within 0.050 µm per coordinate; neutral surfaces across all four parts agree within 0.050 µm. They are not byte-identical because of floating-point re-composition. This study does not blend the other four targets' bone-rig matrices, whose multi-target runtime policy is unknown.

With the private experiment 013 source candidate, the extracted/serialized head and eye morph resources from [the source trace](source-graph-trace.md), and ignored CC-idle assets available:

```powershell
$env:XFS_PRIVATE_ASSETS = 'PATH_TO_PRIVATE_CC_IDLE_ASSETS'
bun experiments/015-native-eye-assembly/sample-h091-comparison.ts
python experiments/015-native-eye-assembly/analyze-clearance.py --sample h091-comparison
& 'PATH_TO_BLENDER_5_EXE' -b -t 4 --python experiments/015-native-eye-assembly/visible-clearance.py -- --sample h091-comparison
python experiments/015-native-eye-assembly/verify-clearance.py --sample h091-comparison
& 'PATH_TO_BLENDER_5_EXE' -b -t 4 --python experiments/015-native-eye-assembly/render-native-eye.py -- --sample h091-comparison --mode source
& 'PATH_TO_BLENDER_5_EXE' -b -t 4 --python experiments/015-native-eye-assembly/render-native-eye.py -- --sample h091-comparison --mode eye-only
python experiments/015-native-eye-assembly/summarize-h091-comparison.py
```

All 16 new PNGs, source resources, posed surfaces and full triangle-pair lists remain under ignored `generated/`. Both render passes use the fixed camera, lighting and source-map limits in [the visual inspection](visual-inspection.md). The private source and eye-only render manifests contain individual PNG SHA-256 values; their hashes are pinned in the safe evidence. A repeated sampler run reproduced the byte-identical sample manifest and final safe evidence. An independent separating-axis verifier confirmed all **17** exposed-contact witnesses in the new visibility report (largest maximum separating-axis gap −3.80 µm). Every private PNG hash was rechecked against its manifest.

## Geometry and visual result

The table compares **saved head** eye/head triangle contact pairs with all-opaque ray witnesses. A finite pair is a crossing of two triangles, not a defect or pixel count. The source lash/wetness geometry is included in the combined opaque visibility check. Counts on the right are from the morph-matched eye; neutral head controls are unchanged to submicron precision.

| Frame | Old finite pairs | New finite pairs | Old exposed pairs | New exposed pairs |
|---|---:|---:|---:|---:|
| 0 | 481 | 628 | 177 | **0** |
| 169, minimum lid-joint gap | 628 | 659 | 255 | **25** |
| 331, gaze extreme | 511 | 624 | 208 | **7** |
| 490, opposite gaze extreme | 482 | 628 | 165 | **0** |

The *total* finite contacts rise: the eye target moves the curved eye surface through the head and native accessory layers in different places. The exposed contact signal drops sharply, which matches the images. In the source-map render, the former large upper-eye islands at the saved blink are gone. In the eye-only cyan diagnostic, **a narrow lower eye strip remains at frame 169**; the eyelid seam has not fully closed in this offline assembly. Frames 0/331/490 lose the previous obvious upper outer wedges, though the fixed camera and opaque ray proxy still leave seven exposed pairs at 331. The source-map pass at 331 shows a few lash/wetness-looking flecks over the eye; the eye-only pass has a continuous eye surface there, so those flecks should not be classified as new eye mesh holes. Their material/alpha interpretation remains uncertain.

The source eye base diffuse is still pale/cyan without the unresolved brown gradient; the native lash uses the source strand mask in an approximate Blender hair material, and wetness is a diagnostic translucent surface. No game renderer, MO2 profile, user draft, production preview code or private asset was changed or tracked.

## Interpretation and next discriminator

The omitted native eye morph explains **most** of the earlier apparent saved-blink mismatch under this pinned idle solve. It does not establish a perfect blink or game fidelity. The remaining lower strip and 25 opaque exposed pairs may reflect live graph/state choice, how REDengine blends morph-specific bind matrices across five active customization targets, facial corrective evaluation, eye/wetness material depth, or a real geometric gap; this evidence does not choose among them. The next decisive runtime discriminator is one controlled character-creator capture of the same saved shape during an observed blink, with effective mod winners and the animation state/phase recorded if accessible. A matched offline implementation of the live morph/bind blending policy would be preferable first if that rule can be established from source. Do not change the Studio renderer based on these images.
