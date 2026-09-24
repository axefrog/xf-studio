# Fine-glitter glint integration reference

This study tests a specific failure mode in the current fine-flake preview: an averaged normal map can erase or invent narrow facet highlights. It is a **CPU reference for one simplified reflection model**, not a production shader or a claim about REDengine rendering. [Versioned settings, hashes, timings and metrics](glint-oracle-evidence.json) come from the project-authored deterministic 350,000-ID field, with 15,760 fragments retained around the eye UVs.

## Method

- Crop: left eye UV, 40×24 pixels at 1K and the aligned 80×48 pixels at 2K, wholly inside the existing bounded study region.
- Fixed positions: 16×16 subpixels per 1K pixel. Group the *same* positions as 8×8 subpixels per 2K pixel; fragment IDs, positions and normals never change with resolution or time. In overlaps, the greatest global fragment ID wins, matching the field baker.
- For each of three fixed light/view half-vectors, compute a narrow Gaussian angular response from **each visible facet normal first**, then integrate the responses over the pixel. Angular width is 0.035 radians. Uncovered samples contribute zero flake response.
- Compare two averages. An **ideal average** uses the same dense coverage and normal samples as the reference, isolating the information lost by averaging itself. The **encoded average** decodes the real 4×4-sample 1K/2K normal and coverage maps, adding sampling and 8-bit quantization differences. Both existing surface-average and covered-average normal modes are measured.
- Threshold diagnostic: a reference or prediction above 0.02 is “bright”; a missed bright pixel has prediction below 0.005; a false bright pixel has reference below 0.005. These are analytical response units, not display brightness.

| Resolution and normal averaging | Frontal false bright, ideal → encoded | Frontal reference bright | Grazing-X missed bright, ideal → encoded | Grazing-X reference bright |
|---|---:|---:|---:|---:|
| 1K, surface average | 300 → 255 | 11 | 8 → 8 | 8 |
| 1K, covered average | 5 → 5 | 11 | 1 → 2 | 8 |
| 2K, surface average | 487 → 448 | 27 | 18 → 18 | 20 |
| 2K, covered average | 6 → 3 | 27 | 5 → 6 | 20 |

The ideal-average comparison is the most useful diagnosis. Surface averaging creates hundreds of frontal reflections that the individual facets do not produce, even with dense, unquantized input. This happens because uncovered samples pull the mean normal toward the neutral surface. Covered-only averaging greatly reduces that artifact, yet it still loses some grazing highlights: a single mean direction cannot retain every facet direction inside a pixel. The map comparison shows additional sampling and encoding differences. The two error sources should not be conflated.

This also suggests a practical next experiment: encode or evaluate a small distribution of facet directions per pixel, preserving directional highlight statistics and stable UV identity, rather than attempting to recover the lost distribution from one averaged normal. Its memory, runtime, motion stability and game-material feasibility remain to be tested. A simpler covered-only normal is a useful preview ablation but is insufficient evidence for adopting it as the finished glitter material.

## Reproduce and limits

From `projects/xf-studio/authoring`:

```powershell
bun tools/glint-oracle.ts --write-evidence
bun test tests/glint-oracle.test.ts
```

The evidence records full settings, crop/region coordinates, both resolutions' reference and map-response SHA-256 hashes, per-direction error metrics, and generation/integration/bake timings. Timings reflect one Bun 1.4.2 run; the hashes, not timings, are the deterministic check. Tests independently exercise reflection order, simple polygon overlap, identical 1K/2K sample ownership, diagnostics and the fixed-field hashes.

The reference uses a deliberately simple angular lobe in UV tangent space. It does not account for the real head's curved tangent frames, alpha mask, eyelid occlusion, light size, environment, game BRDF, texture filtering/mipmaps, screen footprint, anisotropy or temporal motion. Its 16×16 grid still approximates fragment area and can miss very small facets. The bounded catalogue is incomplete outside the declared eye regions. Thus the measured counts are evidence of this **information-loss mechanism** under explicit assumptions, not absolute sparkle quality or game fidelity.
