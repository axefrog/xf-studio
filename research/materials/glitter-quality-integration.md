# Irregular glitter integration after preview quality

23 September 2026. Read-only production audit against **`2c1d622`**, following the [candidate contract](glitter-implementation-contract.md). This document proposes the smallest safe integration after the pure irregular-flake study; it does not say that the new model is implemented or visually accepted. Separate addable softness-field controls remain on hold.

## What the quality checkpoint already solves

The older proposal's separate `flake-worker.ts`, synchronous `makeup-stack` baking warning, fixed 1024 sizing, and recipe-5 assumption are superseded. Current production uses recipe-6, supports 512/1024/2048/4096, and already has one cancellable combined mask/optical job. Extend that path; a second independent worker would add synchronization and peak allocation without a demonstrated need.

Concrete inspected sources at `2c1d622`, relative to `projects/xf-studio/authoring/` (the raster-processor and makeup-stack modules now live under `src/engines/layered-makeup/`, and the legacy `src/main.ts` shell has been retired): <!-- historical-paths -->

| Source | Established behavior | Candidate integration implication |
|---|---|---|
| `src/raster-processor.ts::createRasterProcessor` | Clones the request; drains mask work in cooperative slices, yields before optical allocation, drains optics, then publishes one complete bundle. | Add candidate phases to this state machine and check the same cancellation token between phases. Never publish only the new albedo while its normal/surface dependencies are pending. |
| `src/raster-client.ts` | Monotonic versions, one pending snapshot per slot, active-layer priority, cancellation, constructor/send recovery, exact response dimensions/types. | Preserve these invariants; extend response validation for candidate albedo and dependency keys. Slot index alone is insufficient across preset replacement. |
| `src/raster-worker.ts` | Transfers mask/normal/surface buffers, leaving worker-side arrays detached. | A cache cannot retain those transferred arrays and later read them. Cache compact independent channels or regenerate on a miss. |
| `src/makeup-stack.ts` | Owns mask texture, two optical textures, disposal and last-complete appearance. Cache key is `[finish, flakes, size]`. | Own a fourth albedo texture and separate optical/albedo dependency keys. Current whole-settings key would needlessly regenerate normals on a flake-colour edit. |
| `src/main.ts` | Always submits mask work; `needsOptics` avoids unchanged optical work. Same optical key is duplicated for startup caching. | Centralize dependency-key construction in one pure module. Shape changes should rebuild alpha/albedo, not the stationary flake field. Colour changes should reuse alpha and field when cached. |
| `src/preview-quality.ts` | Plain layers count one RGBA map; optical layers count three. One largest replacement bundle plus one mask-worker output is included. | Count irregular layers as four until an actual GPU-mask-elision optimization exists, and account for new catalogue/cache/scratch explicitly. |
| `src/uv-editor.ts` | Source-size-aware masks, display-sized tint scratch, sharp vector guides independent of texture size. | Preserve authoritative mask semantics. UV remains the shape/coverage editing view; no need to make it an optical preview. |

The current worker yields approximately every eight milliseconds of inner-loop work, but that is a scheduling target, not a cancellation-latency guarantee: allocation, job construction and an unusually expensive work unit can exceed it. New catalogue construction, raster initialization, channel extraction and albedo composition also need bounded `advance()` work. A loop surrounding an unbounded polygon/subsample operation does not establish responsiveness.

<!-- /historical-paths -->

## Version and dependency boundaries

Use the next available recipe version (currently **recipe-7**) for the tagged `irregular-planar-1` settings. Earlier versions must reject that tag rather than accidentally accepting it through permissive legacy extra keys. Continue accepting historical legacy settings with their original semantics and byte output; do not tighten old unknown-key handling incidentally. New tagged settings should have strict keys and validated limits selected from the study.

`recipe.ts` currently gates softness with `schema === "xfs/recipe-6"`; path, strength and fields then inherit through that condition. When adding recipe-7, extend that gate to both current softness-capable versions. Merely adding the schema to the allow-list would reject recipe-7 softness or mis-migrate it. Update literal current-schema constructors in `recipe.ts`, `collection-workspace.ts` and `shape-transform.ts`, plus fixtures. Back up SQLite and restart the Bun server with the new parser before browser save/reopen testing. Do not rewrite old revisions or outer collection/workspace IDs.

Define canonical keys from explicit fields rather than object property order:

| Dependency | Inputs | Changes that must not invalidate it |
|---|---|---|
| Catalogue | Model tag, count, characteristic radius, spread, tilt, seed, frozen algorithm constants | Base/flake colour, shape, opacity, preview resolution, camera/lighting/pose |
| Optical field | Catalogue key, output size and sampling version | Shape/opacity and both colours |
| Shape alpha | Path mode/points/handles, pigment strength, softness, warp fields, symmetry, opacity, output size and raster version | Names/IDs, finish, colours and flake settings |
| Albedo | Optical coverage key, shape-alpha key, base colour, flake colour, composition version | Camera/pose/lighting |

Keep exact key strings, or a collision-safe equality representation, for correctness. A short non-cryptographic hash alone must not select a visually unrelated cache entry. Include finish in legacy optical keys because shimmer and glitter currently have different constants. An irregular model initially applies only to glitter; switching to shimmer must either retain it as dormant settings with an explicit legacy shimmer fallback, or perform a documented undoable settings conversion. It must not feed a tagged object into the old `cells/density` baker.

## Minimal scheduling and cache extension

Keep **one worker and one current layer job**. Requests remain immutable full layer snapshots, with the requested size and keys of the optical/albedo resources already owned by the receiving layer. A response must declare which dependency keys it supplies or reuses. A reuse response is valid only when the main-thread layer still owns those exact keys and dimensions. On mismatch, do not partially apply: enqueue a complete rebuild and retain the prior complete material.

The useful small cache is worker-local, byte-bounded, and keyed by content rather than slot. Retain **one-channel coverage** from the optical field and **one-channel alpha** from completed masks, plus the compact catalogue when useful. These are independent arrays created before transferring the RGBA outputs; never retain a detached view. At 4K each one-channel array is 16 MiB, versus 64 MiB for RGBA. Start with an explicit cap, such as 64 MiB total for channels/catalogues, evict least-recently-used entries before allocation, and expose actual/reserved bytes in diagnostics. The exact cap should follow measurements; it is an optimization, not a requirement that a recipe fit entirely in cache.

On a cache miss after eviction or worker recovery, compute the missing dependency from the immutable request. If the main thread already has matching normal/surface maps, the worker may regenerate coverage without transmitting/replacing those maps, but must use exactly the same field evaluator. This fallback can cost more time; it cannot change output. Do not let a cache miss force an indefinite retry handshake.

Recommended phase behavior:

1. Resolve shape alpha from the cache or run the existing mask job. Legacy/plain requests can retain the current behavior initially; the candidate's expensive colour edits should not rerasterize a complex unchanged shape when cached alpha is available.
2. Resolve catalogue and coverage. If current main-thread optical maps do not match, generate normal/surface too. A shape drag reuses the field; a colour edit changes neither positions nor normals.
3. Compose candidate RGBA albedo cooperatively: linear-light base/flake mixture using field coverage, exact procedural alpha copied into A. Do not apply shape alpha to RGB and then apply it again through material transparency. The worker does not need a second permanent RGBA colour-only image; compose directly into the outgoing albedo buffer.
4. Publish the complete current dependency set or cancel it. Transfer outgoing buffers, keep only allowed compact cache entries, and release incomplete temporary arrays on cancellation/failure.
5. Validate keys, dimensions and array lengths before touching the displayed layer. Replace one layer at a time and dispose superseded resources immediately. Startup caches must carry the same complete keys; do not invent a separate startup key formula.

Recompute the albedo after shape, opacity or colour changes. Those jobs are real texture bakes, but much cheaper than rerunning flake geometry and directional-softness sampling unnecessarily. Lighting, camera and animation require no baking. No cache of every slider value, shared GPU-reference-count infrastructure, or independent worker pool is needed for this first integration.

The current `bakeOptics` boolean is no longer sufficient to express "new mask + new albedo + reused normal/surface". Prefer a small explicit result/request contract with optional newly generated maps and exact reused dependency keys. Preserve the existing plain/legacy response path and strict rejection of missing required outputs. A failed phase leaves the failure visible until cancelled work is rebuilt, as the quality checkpoint already requires.

## Renderer adapter and material transaction

Candidate albedo uses a `DataTexture` with `SRGBColorSpace`, `flipY=false`, explicit mip generation and the same filtering/anisotropy convention as current optical maps. Use `material.map=albedo` and `material.color=white`; retain current normal and packed surface channel conventions. Leave the shape canvas as authoritative UV/export data. Switching away restores `map=mask`, `material.color=layer.color`, and disposes candidate albedo along with any obsolete optical maps.

There is a concrete current adapter trap: `setLayerCanvas()` unconditionally assigns `material.map` to the mask texture, while `updateLayer()` may early-return awaiting optics. Candidate integration must stop those two operations from exposing a mask-only intermediate appearance. Stage/validate the full candidate result first and commit it through a single stack operation, or make mask-source replacement independent of displayed map binding until the candidate commit. Similarly, the immediate `viewer.updateLayer()` called by `render()` must keep the old complete candidate colours while a new albedo is pending; changing a uniform tint is no longer an equivalent preview.

The installed Three.js 0.186.0 `map_fragment.glsl.js` multiplies the entire sampled RGBA into diffuse colour, and `alphamap_fragment.glsl.js` samples green. That confirms the prior proposal's white uniform plus RGBA albedo approach and why binding the white-RGB procedural mask directly as `alphaMap` fails. `DataTexture` defaults `generateMipmaps=false`, so set it explicitly. Do not overwrite `extendSkin`'s shader hook or cache key for this candidate.

Extend diagnostics to show mask source size, actually bound albedo size, normal/surface size, model/dependency keys and pending state. A valid mask canvas does not prove the candidate albedo is current. Extend `describeQuality()` so "Ready" requires completed candidate dependencies, not just empty queue and matching canvas width.

## Aggregate budget and useful 4K

With the existing conservative accounting, a candidate owns four RGBA8 CPU images and four GPU mip chains. At 4096, one CPU base is 64 MiB and its GPU chain is about 85.33 MiB:

| Enabled set | Steady CPU + GPU | Largest replacement bundle | Mask worker staging | Existing-style total, before new cache/scratch |
|---|---:|---:|---:|---:|
| One legacy optical layer | 448 MiB | 448 MiB | 64 MiB | 960 MiB |
| One irregular layer | 597.33 MiB | 597.33 MiB | 64 MiB | 1,258.67 MiB |
| Two irregular layers | 1,194.67 MiB | 597.33 MiB | 64 MiB | 1,856 MiB |

Exact mip sums differ from rounded values by only a few bytes. Thus simply counting the fourth map makes **every 4K irregular layer fail the current 1 GiB guard**. Ignoring the fourth map to keep the button working is incorrect.

A reasonable bounded option is to retain the current **1 GiB default** and add an explicit local **generated-texture budget** choice of **1 or 2 GiB** to Preview quality. The 2 GiB option allows one 4K candidate with room for the proposed compact cache and scratch, and potentially two only if the actual bounded allocations fit. It is a user-selected operational ceiling, not detected free VRAM or a hardware guarantee; native assets/browser/driver overhead remain additional. Persist it independently of recipes, validate finite enumerated values, and run the same aggregate assessment before allocating. Do not silently raise it for a quality request or silently lower texture resolution on rejection. Higher broad budgets should wait for measured need.

That optional preference is simpler and more honest than pretending WebGL `maxTextureSize` reports memory. If adding a budget preference is deferred, explicit 4K rejection is correct; ship 512/1K/2K candidate support and state the limit rather than claiming all tiers work.

Update the estimate to sum **1 plain / 3 legacy optical / 4 irregular** maps, the largest relevant replacement bundle, output mask staging, maximum retained worker cache, catalogue/index allocations and bounded tile/subsample scratch. Do not reserve both a full "colour-only" atlas and final albedo when implementation only needs one. Conversely, count any full-resolution ID/sample arrays that the pure study actually creates. Measure a lower-resolution transition retaining an old 4K bundle: a target-only estimate can undercount the transient old allocation. Gate on the greater of current retained resources and target steady resources plus the actual next replacement/staging, until the old bundle is disposed.

Possible later savings: an irregular layer does not bind the procedural mask to its material, so its unused GPU mask can be omitted. That requires real lazy mask-texture ownership and lifecycle tests; it cannot merely subtract a map from the estimate while `setLayerCanvas()` still uploads/binds it. Even eliminating that GPU chain does not automatically make a conservative complete 4K replacement fit 1 GiB. Do not change channel formats or remove mipmaps as an unverified budget shortcut.

## Evidence before production acceptance

- Preserve all frozen legacy flake hashes and recipe-1 through recipe-6 mask parity. Test new-schema softness/Bézier/strength retention through transform, collection, SQLite and Undo.
- Assert cache dependency behavior: shape edit leaves field generation count unchanged; base/flake colour edit leaves field and cached mask generation counts unchanged; size/field-setting edit rebuilds appropriate dependencies; eviction/recovery produces identical bytes.
- Reject malformed/missing albedo, wrong keys/sizes, late old-preset results and mixed partial bundles. Cancel in catalogue, field, cache-channel extraction and colour-composition phases; retain active-layer priority and lazy failure recovery.
- Verify exact shape alpha in albedo, independent pale flakes over a saturated dark base, no double uniform tint, and old material restoration/disposal on finish switch, disable, removal, reorder, replacement and quality changes.
- Test memory arithmetic with the fourth map, actual scratch and cache cap; rejection/recovery; old-4K-to-new-512 transitions; and a browser 4K complete candidate only when the chosen budget permits it.
- Record idle/light/view/minification comparisons against the photograph-inspired target. Frozen deterministic bytes alone do not prove convincing glitter. Ordinary mip filtering still loses subpixel normal variance; no claim of physically solved glitter or in-game parity.
- Keep the current dedicated 2048 mask export independent of preview settings. The flat game compiler still rejects glitter until a faithful engine adapter exists.

## Provenance for the parent checkpoint

This audit primarily inspects project-authored production code at `2c1d622` and extends the already credited local glitter photographs/Three.js study. Newly rechecked installed **Three.js 0.186.0, mrdoob and contributors** sources: [map shader](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/map_fragment.glsl.js), [alpha-map shader](https://github.com/mrdoob/three.js/blob/r186/src/renderers/shaders/ShaderChunk/alphamap_fragment.glsl.js), and [DataTexture defaults](https://github.com/mrdoob/three.js/blob/r186/src/textures/DataTexture.js). Value: verified RGBA multiplication, green-channel opacity and explicit mip generation requirements. This is dependency/source learning, with no copied shader code or distributed reference asset. Parent should add this document to the existing Three.js learning entry in `docs/community-credits.md` at the checkpoint; that shared file is outside this subtask's write ownership.
