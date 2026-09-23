# Masked glossy decal: isolated offline fixture

This is an **opt-in, material-only experiment** for a clear glossy topper. It does not change the preset compiler, create an appearance, build an archive, register a selector, install anything, or establish in-game rendering. The stock `mesh_decal_blendable.mt` has an `MVF_MeshSkinned` post-G-buffer variant in the audited 2.31 template; this fixture creates one `.mi` and three `.xbm` inputs that could later be bound to the owned morph-skinned plate. It has **not** been bound to that plate.

The test mask is the checked-in studio initial layer, baked by `bake_decal_inputs.ts`. It is deterministic and is not Nathan's personal recipe. Diffuse alpha stores the square root of coverage to compensate for the inspected shader's squared coverage calculation at texel centres. The material sets `DiffuseAlpha=0`, `RoughnessMetalnessAlpha=1`, `RoughnessScale=1`, `RoughnessBias=0`, `MetalnessScale=1`, `MetalnessBias=0`, and `NormalAlpha=0`. Roughness is a constant `20/255` within the coverage mask; metalness is zero. Colour-only Fresnel contribution is disabled. The intended effect is to lower the existing surface's roughness where the mask covers it, using the game's **one ordinary lighting lobe**. It is not a clearcoat or a second reflection lobe.

The deliberately small fixture tests the `mesh_decal_blendable` route because the audited 2.31 MeshSkinned pixel program masks its surface target alpha by diffuse coverage. `mesh_decal_wet_character.mt` had a literal alpha of one on that target in the audited compilation, so using it across the full eye plate would risk unmasked surface changes. See the current-game audit in the materials research for the shader-level evidence. The earlier `mesh_decal.mt` fixture in [experiment 003](../003-decal-material-import/README.md) provides the texture import and alpha-compensation precedent.

## Reproduce locally

First extract and serialize the unmodified **Cyberpunk 2077 2.31** `base/materials/mesh_decal_blendable.mt` with WolvenKit. Keep its binary and adjacent `.json` outside Git. The script requires binary SHA-256 `ddfacaf5894b6aba9cfde35d796ccad415d5db16d6c8e4851d7f3875d8266bbe` and checks the JSON's game version, `MVF_MeshSkinned` support, pass and parameter names. Local prerequisites are WolvenKit CLI, Bun and Pillow at the paths used in [fixture.py](fixture.py).

From the repository root, explicitly run:

```powershell
python experiments/008-glossy-decal/fixture.py --build --template C:/path/to/mesh_decal_blendable.mt
python experiments/008-glossy-decal/fixture.py --verify --template C:/path/to/mesh_decal_blendable.mt
```

Outputs and CLI logs stay under ignored `generated/`. The script has no default build action. The verifier compares the `.mi` binary round-trip against every selected parameter and resource path, confirms texture size, compression, gamma and mip flags, decodes exported base-level pixels, and measures edge coverage against the original baked mask. It will fail if the template hash changes. It never packages or copies the template into the output.

## Local result and limits

On the audited 2.31 binary with WolvenKit CLI 8.17.4, the material and three textures converted and serialized successfully. The converted roughness and metalness base levels differed by **0.0 byte mean** from their constant inputs. Across 11,496 partially covered texels, decoded colour alpha squared differed from target coverage by **0.00395 mean**. The generated material SHA-256 was `26298973cd007f1f57331ec13b6e6d188744a94a02f30c7b87ae5a9a07523bda`; the compact [result](result.json) records the hashes and measured errors. These checks cover only the resource encoding and base mip.

The next coherent step is a separate, reviewed mesh/app comparison with an Off state and the exact owned plate/morph resource, then a controlled game capture of matte versus gloss under fixed pose and moving light. Test clear layering order, blink/deformation, filtered edges and lower mips before adding a Glossy adapter. A single lower-roughness target may produce a wet look but cannot retain independent skin and coat highlights. No part of this fixture is production export support.
