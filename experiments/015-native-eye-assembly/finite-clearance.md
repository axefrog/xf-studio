# Native eye/head finite clearance and exposure follow-up

25 September 2026. This is a **source-bound, offline geometry study**, not a rendered-eye acceptance. It extends the [57-joint assembly gate](README.md) using the exact installed 2.31 bound head GLB (`0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730`) and native eye GLB (`0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba`). Both hashes are enforced before sampling. The head has 7,186 vertices and 13,186 triangles; the native GLB supplies a 668-vertex eye surface, 12,393-vertex lash chunk and 152-vertex wetness chunk. No production renderer, package, game, MO2 profile or user draft changed.

## Sample and method

The [private pose sampler](sample-clearance.ts) applies the same pinned 30 Hz body/facial idle and Studio world-bind-relative composition to both skins. Head weights are restored to the two original GLB influence sets before skinning. It samples neutral head and the previously recorded five-morph saved shape (`h091_eyes`, `h012_nose`, `h053_mouth`, `h054_jaw`, `h145_ear`); the native eye has no morph targets. Across all 663 baked phases, it selects frame 169 for the minimum central upper/lower lid-joint Y gap, 473 for the maximum, 331/490 for horizontal gaze extrema, and 27 for the largest pupil translation relative to the eye joint (0.345 mm). It also includes phase 0, the last baked phase 662 and the previously important plate-contact frames 298/299. The lid-joint gap is a **phase-selection proxy**, not measured eyelid aperture. All posed surfaces and source paths remain beneath ignored `generated/clearance/`.

The [finite checker](analyze-clearance.py) applies the existing tested spatial-grid and triangle/triangle narrow phase to every head-versus-native-chunk pair at these nine phases in both shapes. An intersection means zero finite triangle clearance; it does not mean a defect by itself because the vanilla eye/lash/wetness assembly also intersects the head. The [Blender 5.0 visibility pass](visible-clearance.py) checks actual intersection segments at their endpoints and midpoint from five head-relative views (front, ±30° horizontal, ±20° vertical). A contact is counted as geometrically exposed only when its head triangle faces the camera and the first ray hit on the head, affected native chunk **and their combined opaque surface** falls within 2 µm of the segment. The combined surface includes all three native chunks. Unsigned vertex-to-head nearest distances are also recorded, but are not penetration depths or substitutes for the triangle test. Missing witnesses remain unresolved rather than being labelled hidden.

The [numeric evidence](clearance-evidence.json) records all 54 shape/frame/chunk rows, contact counts, nearest-vertex summaries, exposure counts, ray witnesses and input hashes. Its SHA-256 is `d4eeec05412ae6515c185baa7096d171609450623690a69d0a879af0672ae540`. The ignored full pair list SHA-256 is `79da5c6bd9a17f3bed530a13b679e0ed36c14fdd1c15d906c753587053b82e52`. The [independent verifier](verify-clearance.py) checks all 45 exposed-row witnesses against a separate separating-axis calculation; the largest maximum axis gap was −0.906 µm (overlapping). It also reproduced the prior saved-head positions **exactly** at frames 0, 169 and 490 against experiment 006's independent posed archive (maximum component error 0).

## Measured contact exposure

Each table cell lists **intersection pairs with an opaque-geometry ray witness** for eye / lash / wetness. A pair count is not a count of pixels or distinct visible artifacts. The full evidence also records all intersections, including occluded ones.

| Frame and selection | Neutral | Saved five-morph |
|---|---:|---:|
| 0, phase start | 0 / 698 / 124 | 177 / 218 / 64 |
| 27, maximum relative pupil shift | 11 / 678 / 67 | 208 / 187 / 39 |
| 169, minimum lid-joint gap | 0 / 504 / 0 | 255 / 153 / 64 |
| 298, earlier plate-contact phase | 0 / 430 / 2 | 254 / 166 / 61 |
| 299, earlier plate-contact phase | 0 / 355 / 1 | 231 / 173 / 57 |
| 331, one horizontal gaze extreme | 0 / 667 / 114 | 208 / 211 / 59 |
| 473, maximum lid-joint gap | 0 / 742 / 130 | 166 / 235 / 64 |
| 490, opposite gaze extreme | 0 / 723 / 136 | 165 / 228 / 63 |
| 662, last baked phase | 0 / 704 / 125 | 173 / 228 / 63 |

The neutral native-eye surface already has **617–647** triangle contact pairs with the head across these phases, mostly behind the other native chunks under this opaque test; frame 27 has 11 exposed pairs. The saved head shape has **479–628** eye/head contact pairs, with **165–255 exposed** in every selected phase. This is a concrete geometric change near the eye opening, not evidence that every pair causes a visible game flaw. The native lash and wetness chunks intersect the head in both shapes. Their material alpha, wetness shading and draw/depth behavior are not represented by opaque BVH rays. In particular, counting visible lash geometry as a defect would be unsound without rendering its source alpha/material.

## Reproduce and limits

The two private input GLBs and idle assets are pinned in [the assembly gate](README.md). With the eye extraction under this experiment's ignored `generated/eye-export/`, Bun/Three dependencies, Python/NumPy and Blender 5.0 available:

```powershell
$env:XFS_PRIVATE_ASSETS = 'PATH_TO_EXISTING_PRIVATE_STUDIO_ASSETS'
$env:XFS_NATIVE_HEAD = 'PATH_TO_PRIVATE_BOUND_NATIVE_HEAD_GLB'
bun experiments/015-native-eye-assembly/sample-clearance.ts
python experiments/015-native-eye-assembly/analyze-clearance.py
& 'PATH_TO_BLENDER_EXE' -b -t 4 --python experiments/015-native-eye-assembly/visible-clearance.py
python experiments/015-native-eye-assembly/verify-clearance.py
```

When experiment 006's ignored 73-pose output is available, append `--reference-posed PATH_TO_006_BUILD/posed` to the verifier for the exact 0/169/490 head-position comparison. The sampler and checker assert source hashes and finite geometry; the independent check confirms every reported visible witness is a true triangle overlap. Two full repeated runs of the sampler, contact and Blender visibility chain produced byte-identical final evidence.

This tests nine discrete phases of one decoded idle and two head shapes. It does not check between-frame collision, the live game animation graph, all customization morph combinations, precise iris/cornea/gradient colour, alpha-tested appearance, skin shading or visual parity. The next useful discriminator is a **private isolated viewport** with the native eye, native lash/wetness alpha/material inputs and a matched head morph/pose, followed by a controlled game capture only if offline material and geometry checks leave a runtime question. Do not infer an acceptable clean-user preview from this numeric gate alone. No extracted resource is tracked or licensed for redistribution.
