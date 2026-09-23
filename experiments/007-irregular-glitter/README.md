# Irregular planar glitter study

First results: [measured findings](findings.md) and [versioned evidence](evidence.json). Four- versus sixteen-sample coverage exposes a meaningful quality/performance trade-off; no production material was switched.

Owned procedural texture research for the user-supplied glitter references. This experiment evaluates the proposed `irregular-planar-1` field before freezing a portable recipe contract or replacing the studio material. The current editor and historical glitter recipes remain unchanged until explicit integration.

## Reproduce

From `projects/xf-appearance-studio/authoring`:

```powershell
bun tools/glitter-study.ts
python tools/glitter-study-metrics.py
```

The Bun study uses the same pure field/baker intended for the later worker adapter. It compares legacy, sparse, default, dense and worst permitted count/radius/variation at 1024 and 2048. Generated files remain in this experiment's ignored `generated/` directory. The Python script requires NumPy and Pillow and only encodes/analyzes project-generated pixels; it does not edit the photographic references.

`manifest.json` records full inputs, channel hashes, elapsed times, maximum measured cooperative slice, work counts and radius quantiles. `metrics.json` reports covered area, axis correlations, legacy lattice-frequency power and resolution-sampling error. `coverage-colour-comparison.png` shows identical UV crops of coverage and linear-light mixed albedo, enlarged with nearest sampling to expose footprints.

## Interpretation

- The 128-cycle axial spectral probe targets the old default 128-cell layout. Normalize against nearby radial frequencies and retain both axes; this is a diagnostic for that known lattice, not a universal measure of all repetition.
- Coverage is the union of sampled fragments, not candidate count divided by atlas area. More candidates may overlap rather than increase coverage proportionally.
- The 1K versus area-downsampled 2K comparison measures base-level coverage sampling. It does not test rendered highlights, normal-distribution filtering or energy conservation.
- Maximum observed slice time includes runtime/JIT/GC noise. It is evidence about this run, not a hard latency guarantee. Cooperative work accounting needs separate structural tests.
- Static input textures cannot establish believable glitter in motion. Before adoption, use the existing head, lights, camera and idle for close/normal/distant rendered comparisons. Keep the plain PBR approximation and unknown in-game correspondence explicit.

## Provenance

The user-supplied [photographs and studio screenshot](../../research/backlog/glitter-visual-references.json) establish the visual target: irregular fine fragments, varied spacing and pale/gold reflections distinct from pigment. Photographer/makeup artist attribution remains unresolved; originals are local only and are not copied into this experiment. Distribution, fragment geometry and study code are project-authored. Existing Three.js/CDPR/WolvenKit learning informs the later adapter, as recorded in [community credits](../../docs/community-credits.md) and the [reference review](../../research/materials/glitter-reference-review.md).
