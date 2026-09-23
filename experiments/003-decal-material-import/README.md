# Decal material import fixture

Status: **ten texture resources and ten material instances imported and checked offline**. No mesh, morph, app, CCXL registration, packaged install or runtime proof yet. Outputs are isolated under ignored `generated/archive/axefrog/appearance_studio/studies/`.

This bridges [the browser flake candidate](../002-flake-material/README.md) to the [inspected game decal shader](../../research/materials/mesh-decal-shader-contract.md), using the authoritative `base\materials\mesh_decal.mt` rather than the old priority-modified copy.

## Contents

- Four normal maps: shimmer/glitter, each with original and inverted green. BC5 (`TCM_Normalmap`), linear data, 11 mip levels at 1024-square source size.
- Four scalar maps: roughness and metalness for each finish, read from red by the game shader. Linear BC4 (`TCM_QualityR`).
- One linear BC4 normal-coverage mask and one white-RGB BC7 diffuse texture whose alpha encodes the square root of the desired shape coverage. The latter compensates for this shader's squared adjusted alpha at zero contrast/secondary influence. Normal coverage remains independent and linear.
- Two simple matte/satin materials plus eight flake variants: two finishes × two normal modes × two green-channel signs. `regular` is Satin's internal identifier. All resource filenames start with `xfas_`; this fixture does not yet generate appearance objects.

The shape is a deterministic bake of the initial editor layer, including its 85% opacity. It is test art, not the user's active recipe. Materials explicitly set blend strengths; flake instances use independent NormalAlphaTex coverage. Their selected maps/scalars survive a material binary round-trip, with ordinary float32 rounding allowed only for scalar fields. All new texture references resolve within the owned fixture. The base game material template remains an external dependency.

## Reproduce

From HQ:

```powershell
bun projects/xf-appearance-studio/authoring/tools/bake_finish_study.ts
bun projects/xf-appearance-studio/authoring/tools/bake_decal_inputs.ts
python experiments/003-decal-material-import/build_fixture.py
python experiments/003-decal-material-import/verify_pixels.py
```

`build_fixture.py --verify-only` checks existing outputs without rerunning WolvenKit. It recreates deterministic input files for comparison; it does not deploy anything. The local Python environment needs Pillow and NumPy. The CLI path is explicit in the script. Imports use per-process `XbmImportArgs__...` configuration, leaving the shared WolvenKit installation/configuration unchanged. Every output's dimensions, group, compression, linear colour-space flag and mipchain flag are checked, not inferred from filenames.

CLI caveats discovered: this build reports exit 3 after successful folder imports (`Imported N/N file(s)`), matching the inverted bool in `ImportTask.cs`; our script accepts only that exact complete-count situation and still validates every output. Some conversion/export errors instead return zero, so logged errors are also rejected. Export demands `--gamepath` even for these texture files. Material scalar serialization changes 0.88 to 0.879999995, so numerical comparison uses float32-appropriate tolerance while paths/types/other values remain exact.

## Evidence and remaining work

[Resource verification](result.json) records all import settings, texture hashes, CLI hash and material variants. [Decoded-pixel comparison](pixel-verification.json) checks actual exported channels. Base-level tilted-normal mean angular error is approximately 0.41° for shimmer and 0.67° for glitter; worst observed across these candidates is 3.40°. Those are measurements, not a perceptual quality guarantee.

At partially covered source texels, corrected colour-coverage mean error after BC7 import is 0.0040 (0.40 percentage points), versus 0.1477 for the uncompensated square. Corrected worst observed error is 0.0251. The PNG/XBM/PNG path preserves decoded row order. BC5 exports do not restore blue; the comparison reconstructs Z from red/green exactly as the selected shader does. Scalar measurements read red rather than luminance.

Lower mip behavior, tangent-space sign on the actual eye plate, UV assembly, skin-normal blending and overlapping decals remain open. Import/export can reverse row order twice and still agree, so this round-trip does not prove in-game orientation. Likewise, square-root alpha compensation and mip filtering do not commute. The two normal modes/signs belong in one upcoming game comparison, together with material appearance and geometric stacking tests. Prepare the mesh/morph/app fixture before asking Nathan to launch the game.
