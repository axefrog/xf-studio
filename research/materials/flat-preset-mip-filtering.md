# Flat preset lower-mip filtering, 24 September 2026

The current `mesh-decal-flat-v1` compiler merges matte, satin and metallic recipe layers into one diffuse/coverage map and two scalar maps per preset. Its base texels preserve ordered composition in the selected installed **Cyberpunk 2077 2.31** `mesh_decal` MeshSkinned post-G-buffer program ([shader contract](mesh-decal-shader-contract.md), pixel GUID `16098255505177109230`). This is a narrow source-derived target, not a claim about other passes or the game on Nathan's mod stack.

At the selected material settings, a filtered diffuse alpha `a` yields coverage `a²`. Colour is blended in `sqrt(linear RGB)` destination encoding; roughness and metalness use their sampled red scalar. WolvenKit 8.17.4 previously generated a mip chain from source PNGs. Averaging stored `sqrt(coverage)` alpha first loses covered area: for a two-covered/two-empty 2×2 block, `(mean alpha)² = .25` instead of `mean(coverage) = .5`. Independent scalar mip averages then do not preserve the roughness/metalness contributions at the same edge. These statements follow the inspected program's arithmetic and a simple numerical counterexample; they do not reconstruct the game's full texture sampler.

## Implemented collection-fixture adapter

The existing base-level `compileFlatPreset` output is unchanged. For each lower 2×2 level, [the new packaging helper](../../experiments/005-preset-collection/mip_maps.py) averages six *premultiplied destination quantities*: three `sqrt(linear RGB) × coverage` channels, `roughness × coverage`, `metalness × coverage`, and coverage. It divides the first five by averaged coverage where nonzero, re-encodes diffuse RGB/alpha and the scalar maps, and continues from the unquantized averaged quantities. The package uses uncompressed DX10 DDS (sRGB RGBA and linear R8), then WolvenKit `GenerateMipMaps=false`, `QualityColor`/`QualityR` conversion. No game or third-party texture is embedded in the tracked helper.

An isolated input perturbation first set an entire DDS level-1 alpha to 187. After import, serialized XBM `hasMipchain=1` and exported DDS level 1 retained 186–190 decoded alpha, demonstrating that this CLI path respects the supplied chain instead of silently regenerating it. The four-preset fixture then imported all twelve authored maps and passed the [independent resource/package verifier](../../experiments/005-preset-collection/verify.py): XBM dimensions, gamma, compression and mip flags; all 11 decoded levels; mesh/morph buffer preservation; dynamic paths; and exact unpacked archive payloads. The resulting local archive SHA-256 is `6e8159e807b91d0d5dfa54535643a4bec920c00f5065833962643a1c72884c43`, 847,872 bytes. It was **not installed**.

For a direct old/new comparison, the previous PNG-import XBM chain from the same four-preset collection was decoded with the same WolvenKit version. Every decoded base mip was **byte-identical** between the old and new import paths, across all twelve maps. The table gives mean absolute coverage error over partial-coverage texels against a BOX reduction of the original base compiler contributions (old → supplied mips):

| Preset | 512² | 64² | 32² |
|---|---:|---:|---:|
| Metallic copy | .00952 → .00740 | .05657 → .02767 | .10073 → .00652 |
| Reload persistence | .00837 → .00691 | .04783 → .02238 | .08783 → .01071 |
| Collection B | .01240 → .01192 | .06472 → .02546 | .10653 → .02903 |
| Collection A | .00978 → .00802 | .06460 → .02736 | .10761 → .01296 |

The base PNG-to-XBM coverage/colour/surface checks still pass. The new verifier records per-preset coverage and premultiplied destination error for every decoded mip in [result.json](../../experiments/005-preset-collection/result.json), with focused synthetic tests for the coverage counterexample and DDS structure. Some lower-mip errors remain due to BC compression, 8-bit encoding and filtering details.

**Limit:** this construction matches ideal BOX averages at mip **texel centres**, within quantization/compression. Bilinear filtering inside a mip and trilinear interpolation between mips operate on encoded alpha before the shader squares it, so they remain nonlinear and do not exactly preserve area. Actual sampler LOD/addressing, game lighting, pose/UV deformation, plate clearance and A/B/Off behavior need the prepared batched game comparison. We did not change the live browser preview or expand the supported finish set. The generated archive and extracted game program remain ignored local research assets.

## Provenance

The arithmetic question comes from CD PROJEKT RED's installed 2.31 compiled shader and template, independently inspected in the existing [shader contract](mesh-decal-shader-contract.md). **WolvenKit** CLI 8.17.4, by the WolvenKit team and contributors, supplied DDS/XBM import, export and serialization; this study established its supplied-mip behavior by an executed round trip rather than assuming it from an API name. **NumPy** and **Pillow** were used to construct and measure project-authored pixels. This is game-resource inspection and tool/dependency use, with no adapted community code or redistributed extracted asset. The shared [community credit entry](../../docs/community-credits.md) should link this study when integrated.
