# Irregular planar glitter study

First results: [measured findings](findings.md) and [versioned evidence](evidence.json). The [lit-head follow-up](lit-head-findings.md) compares fine fields, normal filtering and separate pigment/flake reflections. The [CPU glint reference](glint-oracle-findings.md) measures facet-response integration against averaged maps at 1K/2K. A separate [UV-cell browser pilot](uv-cell-glint-findings.md) tests fixed procedural facets under direct light. No production material was switched.

Owned procedural texture research for the user-supplied glitter references. The main editor carries an opt-in `irregular-planar-1` recipe-7 raster candidate and a separate `uv-cell-direct-1` recipe-8 browser model informed by the polygon shader pilot. Historical glitter recipes remain unchanged. [Visibility audit](visibility-audit.md) records why raster candidate IDs vastly exceed visible glints; the [direct-light checkpoint](../../research/materials/direct-glint-browser-checkpoint.md) compares the new model at 1K and 2K.

## Reproduce

From `projects/xf-appearance-studio/authoring`:

```powershell
bun tools/glitter-study.ts
python tools/glitter-study-metrics.py
```

The Bun study uses the same pure field/baker intended for the later worker adapter. It compares legacy, sparse, default, dense and worst permitted count/radius/variation at 1024 and 2048. Generated files remain in this experiment's ignored `generated/` directory. The Python script requires NumPy and Pillow and only encodes/analyzes project-generated pixels; it does not edit the photographic references.

`manifest.json` records full inputs, channel hashes, elapsed times, maximum measured cooperative slice, work counts and radius quantiles. `metrics.json` reports covered area, axis correlations, legacy lattice-frequency power and resolution-sampling error. `coverage-colour-comparison.png` shows identical UV crops of coverage and linear-light mixed albedo, enlarged with nearest sampling to expose footprints.

### Fine-field and head comparisons

The follow-up keeps complete fragments only around two explicitly declared eye-UV regions. Its 160k/350k settings describe the deterministic global field; only 7,275/15,760 fragments need retaining. The factory includes a centre halo so fragments entering the region are not lost. Outside these regions the maps are incomplete. These are study-only settings and must never use the full-atlas cache keys or be exported as general-purpose materials.

```powershell
bun tools/glitter-study.ts --fine
python tools/glitter-study-metrics.py --fine
python tools/glitter-fine-metrics.py
bun tools/glitter-study.ts --covered
python tools/glitter-study-metrics.py --covered
$studyOutput = '../../../experiments/007-irregular-glitter/generated'
New-Item -ItemType Directory -Force public/assets/glitter-study
Copy-Item "$studyOutput/*-1024-*.png", "$studyOutput/*-2048-*.png", "$studyOutput/*manifest.json" public/assets/glitter-study/
bun build tools/glitter-head-study.ts --outdir public/build --target browser
```

With the studio server running, open `http://127.0.0.1:4317/glitter-study.html`. This isolated page has no workspace/library controller. Compare candidates at 1K/2K, front/close/distant views, key-light angles, blink and actual idle. The two-reflection diagnostic separates matte pigment from flakes and exposes flake roughness and room illumination. Normal/metalness ablations distinguish coloured marks from reflective response. The `fine350k-covered` option changes normal averaging only; its coverage and colour maps are byte-identical to `fine350k`. `window.glitterStudyDiagnostics()` reports bound maps, source hashes, pose and renderer state. The derived head remains a required ignored local asset.

The `uv-cell-glints` option is a separate shader pilot over the same fixed eye mask, with direct-glint strength and angular-sharpness controls. Its 576² hashed candidate field is **not** the 350k flake catalogue; see its [method, browser observations and limits](uv-cell-glint-findings.md) and [structured evidence](uv-cell-glint-evidence.json). It must not be interpreted as a preview of a currently exportable game material.

Fine-region measurements must restrict their scope to valid regions or the verified fixed paint mask; global atlas averages and spectral probes would mostly measure the ungenerated exterior. The original unflagged study remains separate. The covered-normal ablation is also region-limited and does not establish a production normal encoding.

## Interpretation

- The 128-cycle axial spectral probe targets the old default 128-cell layout. Normalize against nearby radial frequencies and retain both axes; this is a diagnostic for that known lattice, not a universal measure of all repetition.
- Coverage is the union of sampled fragments, not candidate count divided by atlas area. More candidates may overlap rather than increase coverage proportionally.
- The 1K versus area-downsampled 2K comparison measures base-level coverage sampling. It does not test rendered highlights, normal-distribution filtering or energy conservation.
- Maximum observed slice time includes runtime/JIT/GC noise. It is evidence about this run, not a hard latency guarantee. Cooperative work accounting needs separate structural tests.
- Static input textures cannot establish believable glitter in motion. Before adoption, use the existing head, lights, camera and idle for close/normal/distant rendered comparisons. Keep the plain PBR approximation and unknown in-game correspondence explicit.

## Provenance

The user-supplied [photographs and studio screenshot](../../research/backlog/glitter-visual-references.json) establish the visual target: irregular fine fragments, varied spacing and pale/gold reflections distinct from pigment. Photographer/makeup artist attribution remains unresolved; originals are local only and are not copied into this experiment. Distribution, fragment geometry and study code are project-authored. Existing Three.js/CDPR/WolvenKit learning informs the later adapter, as recorded in [community credits](../../docs/community-credits.md) and the [reference review](../../research/materials/glitter-reference-review.md).
