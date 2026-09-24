# Recipe-driven Shimmer decal: offline boundary

**Status:** concluded — a real Studio Shimmer layer produces a stock `mesh_decal.mt` instance and five textures that round-trip offline, but its fine facet slopes vanish by the 256 mip tier and highlight equivalence is unproven. The on-plate normal sign/mode comparison continues in [Experiment 011](../011-shimmer-plate-comparison/README.md).

24 September 2026. This is a **material-only research fixture**, not a Studio export adapter or game-rendered appearance. It takes an enabled legacy Shimmer layer from a parsed Studio recipe, uses the production `raster` and `bakeFlakes` functions, and produces one stock `mesh_decal.mt` material instance with five imported textures. The checked-in sample is a real `initialRecipe()` layer changed to Shimmer with explicit default optics; `--recipe` and `--layer` can instead select another portable recipe. It does not read Nathan's browser draft or SQLite library.

## Source and channel mapping

The selected installed **Cyberpunk 2077 2.31** `base/materials/mesh_decal.mt` binary has SHA-256 `b1b181b70fd1b16393d626281eeff1d5fc99932f24868e55248d18a1abfbc019` and WolvenKit metadata `GameVersion: 2310`. Its MeshSkinned `renderstage_post_gbuffer` pass blends targets and disables depth writes. The [inspected pixel contract](../../research/materials/mesh-decal-shader-contract.md) traces R/G normal decoding, red-only roughness/metalness, independent red normal coverage, and squared diffuse-alpha colour/surface coverage. The relevant pixel GUID is `16098255505177109230`. These are shipped compiled-material observations, not proof of the eye plate's runtime appearance.

| Studio input | Fixture input | What it tests |
| --- | --- | --- |
| Exact layer raster, including opacity, path, fields and softness | Diffuse alpha `sqrt(coverage)`; separate linear `NormalAlphaTex` | Shape coverage in the inspected decal pass |
| Layer colour | Diffuse RGB, white instance tint | Pigment input; browser/game colour-space response remains uncalibrated |
| Legacy `cells`, `density`, `tilt`, `seed` | Same `bakeFlakes` normal R/G and surface G/B | The authored optical pattern as BC5 normal and red scalar roughness/metalness maps |

The material explicitly enables colour, normal and surface weights. `NormalsBlendingMode=0` and the browser green-channel sign are fixed **trial choices**; the existing [experiment 003](../003-decal-material-import/README.md) showed both normal modes and green signs need an on-plate comparison. The same source material remains a single PBR surface update, while the browser preview shades a separate transparent layer. This fixture therefore does not establish equivalent highlights or skin preservation. Shimmer remains distinct from Matte, Satin, Metallic and Glitter in both recipe identity and optical inputs.

## Reproduce

Use the unmodified installed 2.31 template and its adjacent *locally serialized* JSON. Neither is tracked. WolvenKit CLI 8.17.4, Bun and Pillow are required at the local paths in [fixture.py](fixture.py). From the repository root:

```powershell
python experiments/010-shimmer-game-adapter/fixture.py --template D:/path/to/mesh_decal.mt --template-json D:/path/to/mesh_decal.mt.json
```

For a portable recipe, add `--recipe D:/path/to/recipe.json --layer <id>`. Outputs, CLI logs and binaries stay under ignored `generated/`; the script does not assemble a mesh, morph, app, selector, archive or installation. `--sample` is the default recipe source. The generated material and textures use new lowercase `xfs_` names and only reference this owned fixture's textures plus the shipped template.

## Measured checkpoint

At 1024², the sample has 11,496 nonzero shape texels. All five XBM textures and the `.mi` survived a binary → JSON round trip with the expected size, mip flag, gamma, compression, parameter values and local resource paths. Diffuse alpha squared differs from the source coverage by **0.00394 mean** on partially covered texels. The imported base-level normal R mean byte error is **0.296**; roughness R is **0.613**, metalness R **1.441**. The [result](result.json) records input/output hashes and all measurements. These checks are resource and base-pixel evidence, not a lit material test.

The script also exports and decodes the imported XBM's complete DDS mip chains. Within texels whose decoded shape coverage is at least half, the fraction with tangent slope ≥0.15 falls from **16.0% at 1024** to **7.4% at 512** and **0% at 256**. Independent BOX reductions of source maps show the same trend (16.3%, 6.5%, 0%). This is a warning about the current fine-facet pattern at smaller atlas tiers. The decoded mips are **not** actual sampler/LOD or screen-pixel evidence; trilinear filtering, projected plate size and temporal stability remain to be measured. The existing flat compiler's `UnsupportedMaterialError` for Shimmer is deliberately unchanged.

Before any production adapter, verify normal sign/blend on the exact plate and moving-light response at close-eye and face scale; then test overlap with other finishes, posed skin/decal clearance, A/B/Off switching and archive references in the prepared batched runtime session. No game was launched or mod installed for this fixture.

Provenance: `mesh_decal.mt` and shader cache are CD PROJEKT RED game resources used only as untracked local evidence; WolvenKit CLI by the WolvenKit project is a serialization tool. No game or third-party pixels, code, or resource binaries are included here. The central [community credits record](../../docs/community-credits.md) should gain this experiment link at integration; this branch leaves that shared file to the integrator.
