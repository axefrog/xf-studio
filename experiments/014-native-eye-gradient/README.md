# Native brown-eye gradient — source-input probe

25 September 2026. This experiment extends [native preview core](../013-native-preview-core/README.md) without changing Studio. It traces the **fixed installed Cyberpunk 2077 2.31 vanilla** `gradient_brown` eye material and normalizes the brown gradient's source stops plus its declared optical inputs. It does not produce a coloured iris texture or claim game rendering.

## Source chain and result

Experiment 013 independently verified that the female eye mesh's `gradient_brown` appearance uses `brown_eye_gradient.mi` on its eye surface (`submesh_01_LOD_1`) and that the mesh-local instance points to the brown profile. This probe follows the file-backed instance further:

`he_000_pwa_c__basehead.mesh` → mesh-local `gradient_brown` → `base/characters/common/eyes/brown_eye_gradient.mi` → `base/materials/eye_gradient.mt` and `IrisColorGradient` → `base/characters/common/eyes/gradient_profiles/eye_brown.gradient`.

The profile is a `CGradient` with three `rendGradientEntry` records. WolvenKit serializes them in the order 0.785713971, 1, 0; the probe sorts a **copy** by numeric position for stable comparison. Its resulting positions and RGBA8 values are 0 → `[22,22,22,255]`, 0.785713971 → `[129,98,78,255]`, and 1 → `[255,255,255,255]`. Sorting does not assert how REDengine samples, interpolates or converts the entries. The template declares `IrisColorGradient` as parameter type 16 and identifies itself as `RMT_Eye`. The instance also references `IrisMask`, `NormalBubble`, `Blick`, diffuse, normal and roughness inputs. Its recorded floats include `IrisSize=0.737374008`, `RefractionIndex=0.970000029`, `EyeParallaxPlane=0.0133999996`, left/right horizontal angles −5/+5, and `RoughnessScale=0.493420988`; all exact serialized values are in the **ignored** `inputs.json`. These are shader-specific inputs, not direct Three.js material settings.

| Resource | Provider archive | SHA-256 |
|---|---|---|
| `eye_brown.gradient` | `basegame_4_appearance.archive` | `a0316560105d88121dab00467ed1ff22a361db528ce9d7db019717e12fea5e04` |
| `brown_eye_gradient.mi` | `basegame_4_appearance.archive` | `3dab26626dece44d46811c00504d75a65971bbdfcf2d72871324906cb896c676` |
| `eye_gradient.mt` | `memoryresident_1_general.archive` | `348ec8d2b88288dec4fea5dca69f4d15bcc0c2c3c0b89111bf4f922fdb0f36f5` |

The appearance archive SHA-256 is `9c20370467e71d49ffb0a6415fe0415b2349ac22fe5afd38daf2783f54f2443b`; the template archive SHA-256 is `71d3d4116eee455b75309e0c36f5af5aa2fef17ecf509639c3e3a622fcf32295`. The WolvenKit CLI 8.17.4 executable SHA-256 is `fdffea5f19a13a5abf57487acf4e9cffce35e789d8f0d8ef551130021a086201`. The two related instance/profile files live in the appearance archive; the template lives in the small memoryresident archive. The filter also extracts similarly suffixed siblings, but the probe hashes and consumes **only** these exact depot paths.

## Reproduce

Use Python 3 and WolvenKit CLI 8.17.4. Each output path must be new and beneath this experiment's ignored `generated/` directory:

```powershell
python experiments/014-native-eye-gradient/probe.py --game 'PATH_TO_CYBERPUNK_2077' --wolvenkit 'PATH_TO_WOLVENKIT_CLI_EXE' --output experiments/014-native-eye-gradient/generated/run1
python experiments/014-native-eye-gradient/probe.py --game 'PATH_TO_CYBERPUNK_2077' --wolvenkit 'PATH_TO_WOLVENKIT_CLI_EXE' --output experiments/014-native-eye-gradient/generated/run2
```

The script gates both full archive hashes, its executable and all three exact resource hashes; checks the instance→template/profile references and template parameter declaration; validates finite scalar inputs and unique, bounded colour-stop positions; and removes WolvenKit's varying export timestamp and local absolute paths from the normalized report. Two independent runs on this installation produced byte-identical `inputs.json`, SHA-256 `efd90051d21f4eca531325b7caca84ae5f1d341db62771ca21d56bffddefa3e1`. Extracted binaries, serialized JSON and normalized report remain ignored. No game assets are committed or redistributed.

## Boundary for a clean-user preview

This establishes a safe **input extraction** route for a fixed vanilla brown profile. It does not establish the shader's gradient lookup coordinate, interpolation space, mask composition, refraction/cornea response, or whether a baked iris would match the game. The [eye optics audit](../../research/eye-artistry/eye-lip-optics-audit.md) established roughness R times `RoughnessScale` for a sampled compiled `eye` variant; this separate `eye_gradient` template requires its own variant check before transferring that rule. Do not simply recolour experiment 013's grey-blue eye diffuse from these stops.

The native eye GLB in experiment 013 has a 57-joint skin and tiled UVs. Studio's existing historical preview attaches rigid eyes to `l_J_eye_JNT` / `r_J_eye_JNT` from a separate facial idle rig; that path is not proof that the new native GLB and a clean user's game-derived gaze data share validated transforms. The current five-file core intake also does not include a native eye GLB, gradient profile or gaze animation. Assembly design, eye/rig pivots, source winner resolution and the [still unaccepted plate clearance](../012-native-plate-bootstrap/README.md) remain gates before a complete clean-user 3D preview. No game or MO2 files were modified and no game launch was made.

The [community credit](../../docs/community-credits.md) records WolvenKit tool use and the game's private source contribution. This is an offline source probe, not permission to redistribute the game's content.
