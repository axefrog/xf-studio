# Recipe-driven Glossy decal: offline boundary

**Status:** concluded — a real Studio Glossy layer transfers to a stock `mesh_decal_blendable.mt` instance only as a pigmented single-lobe approximation, because the template cannot encode the browser's independent clearcoat; production Glossy export therefore stays guarded. This was offline serialization and mip measurement only, with no on-plate package or in-game test.

24 September 2026. This opt-in study feeds a **real Studio Glossy layer** into a stock `mesh_decal_blendable.mt` material instance. It reads a portable recipe with `parseRecipe`, selects one enabled Glossy layer by ID, and bakes its exact coverage with the production `raster` function. The checked-in sample is `initialRecipe()` with its first layer explicitly set to Glossy; `--recipe` and `--layer` accept another authored recipe. The historical canned-mask fixture result is preserved in [result.json](result.json). This study does not enable production Glossy export.

## Mapping and its limit

| Studio Glossy input | Stock decal candidate | Transfer |
| --- | --- | --- |
| Layer shape, point pigment, feather, warp fields, symmetry, opacity | Diffuse alpha stores `sqrt(raster coverage)`; the inspected shader squares it | Exact Studio texel-centre source coverage before XBM compression |
| Layer colour | Diffuse RGB, white instance tint, `DiffuseAlpha=1` | Pigment input; no browser/game colour calibration |
| Browser base roughness `0.16`, metalness `0` | Roughness byte `41/255`, metalness byte `0`; `RoughnessMetalnessAlpha=1` | One low-roughness surface update |
| Browser `clearcoat=1`, `clearcoatRoughness=0.08` | No corresponding independent coat lobe or coat-roughness parameter | **Cannot transfer** to this template |

The earlier clear-topper fixture set `DiffuseAlpha=0` and roughness `20/255`; it ignored layer colour. This recipe study intentionally enables diffuse colour and uses the browser's *base* roughness. It therefore tests a **pigmented single-lobe approximation**, not a clear topper. The compiled 2.31 `MeshSkinned` post-G-buffer blendable shader masks surface target alpha by coverage; this is [shader inspection](../../research/materials/glossy-decal-feasibility.md), not proof that the eye plate renders this way. The stock wet-character variant writes literal alpha one to that target and remains unsuitable for an arbitrary full-plate mask without a game test.

## Reproduce

Extract the unmodified installed Cyberpunk 2077 **2.31** `base/materials/mesh_decal_blendable.mt` with WolvenKit and serialize it to JSON. Keep both outside Git. The binary must have SHA-256 `ddfacaf5894b6aba9cfde35d796ccad415d5db16d6c8e4851d7f3875d8266bbe`; the serialized `Data` body must have canonical SHA-256 `37c35987e6a6eea23ba52834b8e36b74d38436907717f9c4a77a84ae35aa4e19` (header timestamp/path are excluded). The script also checks JSON `GameVersion: 2310`, the skinned post-G-buffer pass, blending, depth writes and parameter names. WolvenKit CLI 8.17.4, Bun and Pillow are used at the local paths in [fixture.py](fixture.py). From this repository root:

```powershell
python experiments/008-glossy-decal/fixture.py --build --template D:/private/mesh_decal_blendable.mt --template-json D:/private/mesh_decal_blendable.mt.json
python experiments/008-glossy-decal/fixture.py --verify --template D:/private/mesh_decal_blendable.mt --template-json D:/private/mesh_decal_blendable.mt.json
```

For a portable recipe, add `--recipe D:/path/to/recipe.json --layer <glossy-layer-id>`. The default `--sample` recipe is deterministic and contains no personal design. `--size` accepts powers of two from 256 to 2048. Build and verification rebake the selected recipe; verification rejects stale shape and source metadata. Custom runs write only ignored `generated/verification.json`; only the sample refreshes tracked [recipe-result.json](recipe-result.json). All binaries, decoded images, logs and game template files stay ignored under `generated/`. The script does not make a mesh, morph, app, selector, archive or installation.

## Measured checkpoint

At 1024² the sample raster has 11,496 partially covered texels. The material and three textures survived binary → JSON round trips with expected resource paths, parameters, size, mip flag, gamma and compression. Decoded diffuse RGB differs from the input by **0.334 mean byte**; roughness and metalness red differ by **0.0 mean byte**. Squared decoded base alpha differs from source coverage by **0.00394 mean** across partially covered texels. The full [recipe result](recipe-result.json) records source and resource hashes.

WolvenKit's DDS export exposes **all 11 decoded XBM mip levels**. Comparing squared decoded alpha with a BOX reduction of the source coverage gives these atlas-wide coverage retention ratios: 1024 **99.9%**, 512 **99.5%**, 256 **98.9%**, 128 **96.0%**, 64 **87.6%**, 32 **63.3%**, 16 **51.6%**, and 8 **14.2%**. The report includes the 4/2/1 levels too. BOX reducing the already square-rooted input alpha and then squaring it closely reproduces this loss, so the main mechanism is that averaging and squaring do not commute; compression adds a smaller difference at the measured levels. Constant roughness and metalness survive the entire decoded chain. These are texture data measurements, not projected-pixel, sampler/LOD, temporal, or lit results.

The browser renders Glossy with a base reflection and a separate clearcoat reflection. This template offers one surface roughness, so no value of `RoughnessTexture`, `DiffuseAlpha` or `RoughnessMetalnessAlpha` can encode the independent coat peak or preserve the original skin response beneath it. The sample is also a narrow mask on an unbound material: on-plate colour/normal response, overlapping finishes, blink clearance, selector/Off transitions and runtime mip selection remain open. The existing `UnsupportedMaterialError` for Glossy is deliberately unchanged; no game was launched or mod installed.

Provenance: `mesh_decal_blendable.mt` and the shader cache are CD PROJEKT RED game resources used only as ignored local evidence. WolvenKit by the WolvenKit project is a serialization tool. No game or third-party code, pixels or binaries are committed. The integrator should update the central [community learning record](../../docs/community-credits.md) with this experiment link when merging this independent branch.
