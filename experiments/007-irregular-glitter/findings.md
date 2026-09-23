# First irregular-flake measurements

23 September 2026. [Reproduction](README.md), [full inputs/hashes/results](evidence.json). This is a working pure texture generator, not a production material or game effect.

The proposed fragment field removes the old visible lattice. At 1K, the old 128-cell axial spectral power is approximately 22,100 times the nearby-frequency median; the default irregular field is 0.715. Its axial correlation at the old eight-pixel spacing is approximately zero, versus 0.35 for the old pattern. The owned diagnostic sheet confirms varied fine fragments and separate pale-gold colour over purple pigment. It does not simulate reflections or establish photographic likeness.

| Study | Coverage at 1K | Bake 1K | Bake 2K |
|---|---:|---:|---:|
| Legacy | 13.91% | 49 ms | 128 ms |
| Sparse, 6,000 | 1.44% | 62 ms | 222 ms |
| Default, 16,000 | 3.78% | 103 ms | 310 ms |
| Dense, 30,000 | 6.95% | 169 ms | 474 ms |
| Maximum count/radius/spread | 40.33% | 725 ms | 2,385 ms |

These rows use four subpixel samples. Catalogue construction adds approximately 15–69 ms in this run. Work slices of 4,096 units stayed below 2.5 ms in these measurements; browser scheduling, allocation and catalogue construction still require cooperative integration. No full supersampled atlas is allocated: overlap winners use fixed 16 KiB tile scratch, plus a catalogue/index and output maps.

Four-sample coverage is visibly quantized and is not ready to freeze as the final sampling contract. The default 1K map versus area-downsampled 2K differs by 0.00661 mean absolute coverage and 0.186 at the 99th percentile. A sixteen-sample ablation reduces those to 0.00234 and 0.0490, at 275 ms / 858 ms for 1K / 2K and 64 KiB tile scratch. Mean coverage remains close, but individual boundary pixels can differ substantially. This is coverage evidence only: filtered normals still lose angular variance, so it does not prove stable subpixel sparkle.

Tests establish convex fragments, positive-Z unit facet normals, stable ID prefixes when adding flakes, constant interior normals, highest-ID overlap against independent exhaustive sampling, exact colour/alpha composition, cooperative output parity and unchanged baseline hashes. The 169-test suite includes the concurrent handle regression; eight tests specifically cover this prototype.

Next: choose sampling based on close/normal/distant lit head comparisons before adding a public model tag. Extend the existing combined worker with dependency-aware field/alpha/colour caching and complete map publication; do not regenerate flakes for a shape or colour edit. The [quality integration audit](../../research/materials/glitter-quality-integration.md) identifies the fourth-map memory cost and transactional binding requirement. Keep the current editor and old recipes intact until that adapter is verified.
