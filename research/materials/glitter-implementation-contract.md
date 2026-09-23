# Opt-in irregular glitter: implementation contract proposal

Follow-up: [Experiment 007](../../experiments/007-irregular-glitter/findings.md) implements the pure field/compositor and measures 4/16-sample trade-offs. No public recipe tag or production material has changed. The [quality integration audit](glitter-quality-integration.md) supersedes this proposal's older separate-worker and fixed-1K assumptions.

23 September 2026. Bounded follow-up to the [reference review](glitter-reference-review.md), based on the current `finish.ts`, `makeup-stack.ts`, recipe parser, UI, shader-hook ownership and tests. **Proposed contract only:** no production edits, no optical calibration and no promise of game parity. The active softness work may change the next available recipe version; do not reserve or overwrite its schema number.

## Smallest useful product change

Offer an explicit **Try irregular glitter** action for a glitter layer. Preserve its shape, pigment colour, opacity and existing editable history. The action changes the material distribution only, creates one Undo checkpoint and discloses that this is an experimental browser candidate. Existing recipes, including absent `flakes` parameters, continue through the unchanged old baker. Shimmer remains on its existing path for this checkpoint.

Expose separate **Flake amount**, **Flake size**, **Size variation**, **Flake colour** and **Orientation spread** controls after opting in. Amount changes count; size changes radius; neither secretly alters the other. Describe amount as a relative count, not a measured percentage of covered eyelid. Keep the layer's ordinary colour as the base pigment. This is sufficient for pale/gold flakes over purple pigment without adding multiple palette selectors, emissive sparkle or a custom lighting model.

The first candidate retains one ordinary PBR material per makeup layer. It represents locally resolved flake material replacing a fraction of the base pigment; it does not promise two independent reflection lobes within a pixel. The separate flakes/background inputs make that limitation explicit and leave room for a later adapter.

## Version and serialized data

Use a tagged union for material distribution, exported from `finish.ts` or a small project-local `flake-settings.ts`:

```ts
type LegacyFlakes = {
  cells: number; density: number; tilt: number; seed: number;
};
type IrregularFlakes = {
  model: "irregular-planar-1";
  count: number;          // integer 0..32768 candidates over the UV unit square
  radius: number;         // characteristic radius in UV, 0.0004..0.003
  spread: number;         // 0..1, bounded size variation
  tilt: number;           // 0..1, distribution parameter, not an angle in degrees
  seed: number;           // existing integer bound 0..2147483647
  color: string;          // six-digit sRGB hex, independent of Layer.color
};
type Flakes = LegacyFlakes | IrregularFlakes;
```

These are proposed initial operational bounds, not photographed material measurements. Benchmark them before accepting the maximum into an import contract. Once released, change algorithm semantics by a new model tag, not by silently changing `irregular-planar-1`.

Add the new tagged branch only in the **next available recipe schema**. The current schema during this review is `xfs/recipe-5`; softness may advance it first. Parse earlier schemas with exact existing legacy rules, migrate in memory without modifying historical SQLite revisions, and reject mixed legacy/new fields. New current-schema recipes can still contain legacy settings. Unknown model strings, arrays, non-finite values, unexpected keys and invalid colours fail atomically. An absent `flakes` object must still mean `defaultFlakes()` with its current numerical values and byte-exact output.

Do not convert `density=.65` into `count=.65*MAX_COUNT` and claim parity. The old value is occupied-grid-cell probability. The new mode has a new distribution and is explicitly a visual change. Opt-in defaults should be saved in full, not inferred from future mutable defaults. Suggested first visual study settings: count 16000, radius .0012, spread .7, tilt .35, seed 2077, pale-gold flake colour; all are test choices requiring visual adjustment. Preserve the full pre-conversion layer in Undo.

Collection/workspace outer IDs need not change if their parser already accepts the next recipe version. Update constructors and any explicit recipe-version checks consistently. Do not add appearance names or game resource IDs for this browser experiment.

## Pure deterministic field

Introduce `flake-field.ts` owning the new algorithm. Keep `bakeFlakes`' legacy branch intact; call the new branch through a narrow dispatcher. The catalogue generator takes new settings, not texture resolution, shape points, finish colour, camera or time.

For IDs `0..count-1`, use independently salted integer hashes of `(seed, id)` for centre U/V, radius variate, planar angle, aspect ratio and facet normal orientation. Centres range over the full unit square. Increasing count appends stable flakes; it must not shuffle existing positions. This removes the almost-centred one-flake-per-cell layout. A grid may index candidates but must not clip them at bucket boundaries. Bucket traversal order must not define overlap results.

Define and freeze one bounded size distribution, for example `r = radius * (1 + spread * (1.8*q² - .8))`, with `q` uniform in [0,1). At zero spread all characteristic radii match; at full spread radius is in [.2,2) times the parameter and most samples are smaller. The parameter is a characteristic radius, not an asserted statistical mean. The exact formula is a project proposal; another bounded distribution can be selected before implementation, but record it under the version tag. Aspect ratios, orientation and a convex six-vertex fragment silhouette give visible variation without radial bumps. A deterministic ellipse variant is a useful ablation, not a second public model initially.

Each fragment has one constant tangent-space normal over its interior and bounded positive Z. Edge antialiasing represents covered area; it must not construct a deliberate radial normal dome. Resolve overlapping fragments with an explicit stable topmost-ID rule at each subsample, including normal/material identity, then aggregate covered samples into the output texel. A flat mean normal plus filtered scalar material is still an approximation at mixed texels. Keep coverage/normal statistics available for the later filtering study rather than implying that normalizing a mean preserves its distribution.

Proposed pure interfaces:

```ts
createFlakeCatalogue(settings): Catalogue;
createFlakeBakeJob(catalogue, size): { advance(workBudget): boolean; result?: MaterialMaps };
composeFlakeColour(surfaceCoverage, baseSRGB, flakeSRGB): Uint8Array;
```

The result contains normal XYZ and the existing coverage-R / roughness-G / metalness-B packed surface image. The shader has no time input. Maintain one source for browser and CLI texture studies. Set explicit candidate constants for base/flake roughness and metalness and record them in evidence; do not fold brightness into coverage or emission. Changing such constants after the algorithm becomes a saved public model needs versioning too.

## Minimal colour adapter without disturbing skinning

Prefer **standard material inputs** for this first candidate. Build an RGB colour image in linear light from base/flake colours and fractional flake coverage, convert it to sRGB bytes, and mark its Three.js texture `SRGBColorSpace`. Normals and surface maps stay data/linear. Set the candidate material's uniform colour to white so the flake colour is not multiplied by the base pigment again.

Keep the existing procedural mask canvas alpha-only and independent. There are two viable wiring options; choose one explicitly:

1. **Recommended bounded prototype:** create one candidate-only RGBA albedo canvas/texture combining the colour image with the current shape alpha. Keep the original alpha mask intact for UV controls/export, and recomposite only when its version or either colour changes. This costs one additional 1024 RGBA surface but avoids shader modification and avoids repurposing green as opacity. Use a pure pixel compositor for exact alpha and linear-colour evidence; do not assume browser 2D colour compositing has the desired mathematical encoding.
2. A separate `alphaMap` would require a coverage-in-green texture, because Three.js reads that channel. The current white-RGB/alpha mask cannot be bound directly: its green channel is always white. Copying alpha into green is another surface and another adapter contract, so it is not clearly simpler here.

The candidate's extra map replaces the material `map` binding; it must not replace the authoritative procedural-mask array. On return to legacy glitter or another finish, restore the original mask texture and `material.color=layer.color`, clear every candidate resource/uniform, and mark shader permutations changed where needed. The UV pane currently tints the masks uniformly with `Layer.color`; it may remain an explicitly labelled shape/coverage view for this prototype. It must not be presented as an optical glitter preview. If later showing flake colours there, supply the composited display image separately rather than changing mask semantics.

Avoid a custom `onBeforeCompile` colour mix for this first step. `extendSkin` currently owns that hook **and** `customProgramCacheKey` to support all skin influences. Overwriting either casually would remove deformation or share incompatible programs. Any later shader extension must compose with the existing hook and include a stable material-model suffix in its cache key. This inspection identifies a concrete integration hazard, not a reason to postpone colour separation.

## Integration files and ownership boundaries

All paths below are relative to `projects/xf-appearance-studio/authoring/`.

| File | Necessary change |
|---|---|
| `src/finish.ts` | Tagged settings exports/defaults, unchanged legacy baker, new-model dispatch and user description. |
| new `src/flake-field.ts` | Pure versioned catalogue, raster job, coverage/material result and statistics. No DOM/Three.js. |
| new `src/flake-edit.ts` | Typed opt-in/settings commands, immutable validated edits and capabilities for future context menus. |
| `src/recipe.ts` | New schema branch and strict union validation; preserve old unspecified/default legacy behavior. |
| `src/collection-workspace.ts`, `src/layer-stack.ts`, schema fixtures | Update explicit current-recipe constructors where required, without changing collection/library IDs or legacy fixtures. |
| new `src/flake-ui.ts`, `public/index.html`, `src/main.ts` | Opt-in action, labelled independent controls, one Undo gesture, save/sync hooks; remove direct untyped writes to `l.flakes[id]` for the new union. |
| new `src/flake-worker.ts` plus a bounded client | Off-main-thread catalogue/bake/composite work; latest-result checks and cancellation. Keep alpha-mask work responsive. |
| `src/makeup-stack.ts` | Own colour/normal/surface resource lifecycle and standard material bindings, with no accidental change to alpha sources or skinning. |
| `src/scene.ts` | Pass/consume any explicit mask-version or asynchronous material-ready notifications through its stack wrapper. |
| `package.json`, `server.ts` | Build/serve new worker entry; coordinate validated parser version with the running server before SQLite tests. |
| `tools/bake_finish_study.ts` | New named experiment output using the same field/bake code; preserve historical Experiment 002 hashes. |
| `src/preset-compiler.ts` | Keep glitter rejection explicit. No fabricated game export support in this checkpoint. |
| tests and isolated browser evidence | Legacy bake golden parity, migration/Undo/reload, catalogue stability, overlap/density/colour/alpha correctness, stale-worker and resource disposal checks, view/light/minification comparisons. |

Do not feed the new heavy material jobs into the single alpha-mask worker without scheduling analysis. A long flake bake should not delay a point drag's mask. A separate worker with one in-flight job and latest pending setting per layer is a small justified boundary. Reuse scheduling principles, not a new shared infrastructure framework.

## Memory and latency budget

At 1024², one RGBA8 image is **4 MiB** before mipmaps. The existing normal and surface arrays retain 8 MiB of CPU data per unique layer plus approximately 10.67 MiB of GPU data with a full mip chain. Its shape canvas is another nominal 4 MiB CPU plus approximately 5.33 MiB GPU. Browser canvas backing stores, copies and staging may cost more than these arithmetic lower bounds.

An extra candidate albedo surface is another 4 MiB CPU and approximately 5.33 MiB GPU if fully mipmapped. For 32 distinct glitter layers, those explicit base images and GPU chains alone are roughly **512 MiB CPU + 683 MiB GPU**, before other scene assets or temporary arrays. These are format calculations, not measured allocations; do not treat 32 layers as a validated all-glitter capacity. At 2048 each image costs four times as much. Export one layer/candidate at a time and release temporaries promptly.

Controls must not synchronously rebuild all these maps on every input event. Current `makeup-stack.ts::updateLayer` calls `bakeFlakes(1024,...)` on the main thread whenever its settings key changes. The new catalogue/polygon candidate can be more costly. Stage catalogue generation, raster work and colour composition in a cancellable worker; transfer typed arrays instead of copying them. Publish only the latest complete matching model/settings/layer generation. Preserve the last complete material while the new one is pending and show that state instead of mixing old normals with new colour.

Split cache keys by dependencies:

- **Catalogue:** model, count, radius, spread, tilt, seed; no camera/pose, base/flake colour or path points.
- **Material maps:** catalogue key plus output size and algorithm constants/version.
- **Colour:** coverage-map key plus base and flake colour.
- **Shape composition:** colour-map key plus completed alpha-mask generation.

A shape drag does not regenerate flakes. A colour edit does not regenerate positions/normals. Disabled/hidden layers need not bake before they can be shown. Identical immutable map inputs can share GPU/CPU resources with explicit reference counts; dispose them only after the last consumer releases them. Keep a small byte-bounded cache rather than an unbounded cache of every slider value. Never reuse disposed textures or retain a stale slot's material after preset replacement.

Do not allocate an array per texel or hold a 4× supersampled full atlas. Iterate flake bounding boxes, use fixed-size numeric storage and bounded tile/subsample scratch. The proposed maximum count is 32768, but cost also scales with footprint area and antialiasing samples. At radius near its upper bound, overlapping candidate visits can greatly exceed the pixel count. Benchmark the worst allowed count/radius/spread combination at 1024 and 2048 before accepting the limits. Lower initial bounds or introduce a documented coupled work budget if necessary; never silently drop particles or change their size to finish faster. Ordinary mipmapping remains a measured limitation, not a solved glitter filter.

## Required checkpoint evidence

Freeze legacy default and nondefault byte hashes before any refactor. Show exact legacy parity after opt-in mode is introduced; restore those masks/materials by Undo and reload. Verify the new settings survive local workspace, SQLite, collection export/import and schema validation. Test pale flakes over a dark saturated base so accidental uniform tinting is obvious, and prove base colour and flake colour can be changed independently without regenerating the catalogue.

Measure field identity across resolutions, bounded channels, stable overlap ordering, zero-count base material, alpha equality before/after colour composition, masked-away flakes, stale asynchronous result rejection and disposal after add/remove/reorder/preset switch. Record full render inputs for the [four-column visual study](glitter-reference-review.md#bounded-next-prototype-and-evidence). Keep matte/satin/metallic masks and export behavior unchanged. Rendered browser improvement can close the first prototype only; believable in-game glitter and subpixel filtering remain separate acceptance work.

## Provenance

This contract reuses the already credited local makeup-photo study, Three.js 0.186.0 material/channel behavior, and CDPR/WolvenKit decal findings. The additional inspected `extendSkin` hook/cache-key ownership and UV tinting code are project-authored integration facts. No new external implementation was copied. Extend the existing Three.js and unresolved-photography credits with this contract link at the parent checkpoint; the detailed source links and attribution gaps remain in [the prior review](glitter-reference-review.md#provenance-for-the-parent-checkpoint).
