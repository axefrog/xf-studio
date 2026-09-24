# Preview texture quality contract

## Layer-identity reconciliation — 25 September 2026

The editor now compares preview inputs after a layer action or recipe Undo. Names and stable IDs are identity/metadata, so renaming or undoing a rename does not queue a raster job. A move remaps completed canvas, mask texture, material and optical maps by layer ID while updating draw order. Removed layers dispose only their own GPU resources; new and changed layers render at their new indices. Pending index-based worker requests are captured by layer ID before a structural cancel and requeued at the new indices, even when an older complete canvas already exists; readiness remains *Updating* until the replacement completes. The worker's monotonic versions reject an old result after cancellation. A quality-tier change or collection/preset restore remains a full replacement.

The active point follows its surviving layer across rename, move and Undo, and is clamped when the layer has fewer points. Focused service, browser-device and Three stack tests verify this boundary; the authoring suite passed 394 tests with five failures caused by unavailable private GLB fixtures in the isolated worktree. Typecheck and browser build passed. A live `?verify=1` check with private preview assets remains for the primary checkout.

## Implementation checkpoint — 23 September 2026

The initial audit below is now implemented; this checkpoint supersedes its prospective wording.

- Persistent 512/1K/2K/4K choices appear in a collapsible lighting sibling, with progress/error status and Rebuild preview. Quality is independent of recipes, Undo and export. Native assets retain source resolution.
- Masks and optical maps share cancellable worker jobs and publish as complete bundles. Legacy flake bytes remain identical at matching sizes. Last completed layers remain visible while replacements calculate. Disabled layers immediately release large maps and use 1px placeholders.
- A conservative 1 GiB operational estimate includes generated CPU/GPU images, mip chains, one replacement bundle and worker staging. It is not available VRAM detection or an allocation guarantee; native assets and browser/driver overhead are additional. Hardware limits are checked before attaching full generated maps. Unsupported quality requests retain the old preference. If a layer edit exceeds capacity, rebuilding pauses with an error; reducing load rebuilds all cancelled slots.
- Worker constructor/send failures and malformed/stale results cannot permanently block the queue. Rebuild or another edit retries failed work without automatic retry loops. Initial optical caches are validated against current recipe/size; every published canvas is rebound, even when CPU dimensions already match.
- Browser checks verified complete 2K/4K glitter bundles, 512 downgrade, rapid size changes, capacity rejection/recovery, disabled release, panel/size reload and independent 2048 PNG export. Quality changes preserved recipe, Undo, camera and UV state. No console errors/warnings observed.
- Performance limit: a complex directional-softness/warped 4K layer was still baking when cancelled; do not claim all 4K designs are interactive. A simpler 4K glitter layer completed. Prefer 512/1K for exploratory editing; future acceleration must preserve evaluator semantics.
- Validation: 160 tests / 493,753 assertions / 38 files, typecheck/build pass. Tests cover frozen legacy optical hashes, cooperative cancellation/failure recovery and disposal. [Evidence](../../projects/xf-studio/authoring/evidence/preview-quality-2026-09-23.json).

23 September 2026. Read-only audit for Nathan's requested configurable studio texture resolution. No production changes. Scope: generated makeup masks **and** their generated optical maps; existing head/eye/detail assets remain at their actual source resolutions. This is distinct from canvas display sharpness, renderer pixel ratio and eventual export quality.

## Settings and UI

Add a collapsible **Preview quality** section beside **Head & lighting**, with four explicit choices: **512**, **1K**, **2K**, **4K**. A radio/button group makes the small fixed set visible. Add a note: “Generated makeup textures. Imported head and eye textures retain their original detail. Export quality is separate.” Show requested/effective quality and rebuild progress where they differ. Do not silently label a lower-resolution optical bake as 4K.

Use `PreviewTextureSize = 512 | 1024 | 2048 | 4096`, stored in `WorkspaceState.preview.textureSize`, default 1024 for old workspaces. Persist panel openness as `panels.previewQuality`. Validate by exact membership, rejecting/falling back from arbitrary strings, fractions, NaN and unsupported values. Keep this out of portable recipes, presets and recipe Undo: changing local preview quality is a viewing preference and must not alter someone's makeup design or export settings. Preserve selection, V, camera, idle phase, UV zoom/pan, scroll and collection identity.

Define a typed local action `setPreviewTextureSize(size)` and a state snapshot including requested size, effective size, pending layer count and resource-limit/error information. This is a useful capability for the future context menus and scripted UI; it is not a new remote API. A missing preview renderer must not prevent choosing/persisting quality or editing recipes.

## Exact source integration points

Paths below are relative to `projects/xf-studio/authoring/`, inspected before implementation:

| File | Current assumption | Required behaviour |
|---|---|---|
| `src/main.ts` initial `canvases` and `replaceRecipe` | Every mask canvas starts 1024². | Allocate/rebuild from the validated preview setting, with lazy allocation for inactive work where feasible. A quality change is not a recipe replacement or history reset. |
| `src/main.ts` raster publish | `new ImageData(data,1024,1024)` and fixed “1024²” status. | Read and validate result dimensions, byte length and current generation before publication; status reflects actual completed size. |
| `src/raster-client.ts` | `size=1024` captured at construction; `request` always uses that size. | Add validated size changes or supply size per request. Reset/cancel obsolete work, preserve monotonic sequence numbers, queue fresh size snapshots. Avoid recreating a client with sequence zero while an old worker can still publish. |
| `src/raster-processor.ts` / `raster-worker.ts` | Requests include size; responses currently omit it. | Return size with complete masks (and preferably request metadata in diagnostics), retaining cancellation. A response must never be interpreted using whichever setting happens to be current later. |
| `src/recipe.ts::createRasterJob` | Already accepts integer sizes 1..4096. | The proposed choices fit this bound. Keep pixel/UV arithmetic shared with export; test cancellation and allocation at 4K. No recipe semantic change needed. |
| `src/makeup-stack.ts` | `bakeFlakes(1024,finish,params)` and cache key `[finish,params]`. | Include texture size in the optical-map key and bake at the completed preview quality. Dispose replaced maps and stage coherent colour/normal/surface/mask sets. |
| `src/finish.ts::bakeFlakes` | Explicitly rejects size >2048. | Extend the supported bound to 4096 only with bake/resource checks. Do not just lift the UI while leaving this rejection or quietly baking optical maps at 1K. |
| `src/uv-editor.ts` | `tinted` scratch canvas is 1024²; clears/fills/crops use hardcoded 1024. | Decouple display resolution from texture resolution. Remove this bottleneck; sample each mask using its own width/height. Prefer display-sized tint compositing as described below. |
| `src/scene.ts` | Wraps `makeup.setCanvases` and exposes loaded texture objects/renderer. | Thread material quality/generation through the stack wrapper and expose actual native asset dimensions separately. Check renderer texture limits before committing an unsupported size. |
| `src/workspace-state.ts` | No quality setting/panel state. | Add validated defaults and parser fields without changing existing storage keys or outer workspace schema. |
| `public/index.html`, `src/main.ts` or new `src/preview-quality-ui.ts` | Only lighting section has persisted openness. | Add sibling details panel, controls and toggle persistence; restore before initial bakes begin. |
| `src/main.ts` Export mask handler | Dedicated worker, explicitly 2048². | Leave export at its existing documented 2K setting for this feature. Preview selection must not silently alter exported PNG dimensions. A later independent export setting can change that contract. |

`tools/bake_finish_study.ts` and historical experiments also contain deliberate fixed sizes. Leave those fixtures/reproduction inputs intact; add new size cases without rewriting historical evidence. `preset-compiler.ts` currently validates 32..2048 power-of-two output separately. Do not broaden game export merely because the local preview gains 4K.

## Size-switch transaction

1. Validate choice and hardware/budget capability. Persist the request as local workspace state. Increment a quality generation, cancel obsolete mask/material work and retain the last complete preview while replacements are computed.
2. Prioritise the active visible layer, then other enabled layers. Record the requested size in each immutable worker snapshot. Avoid allocating/baking 32 disabled layers at maximum resolution merely because they exist in a preset.
3. Stage each completed layer's new canvas and optical maps together. Keep the old complete set until replacement is ready; expose “updating” state rather than mixing a 4K mask with stale 1K normal/roughness maps under a 4K label. A failed bake leaves the old set available with the failure visible.
4. Commit only if both layer/recipe identity and quality generation are current. Update the texture bindings and UV source, dispose replaced resources, then schedule the next pending layer. Confirm rapid 4K→512→2K changes and preset replacement cannot resurrect the old 4K result.

The current raster client already coalesces and cancels old work; extend it rather than restoring an unbounded worker message queue. Optical maps currently bake synchronously on the main thread in `updateLayer`; 4K multiplies their pixel work by sixteen versus 1K. Move that work to a cancellable material worker or equivalent staged background path before claiming responsive 4K glitter. Mask and material generation should not starve one another during a shape drag.

Changing a texture image's size deserves an explicit texture lifecycle decision. Creating a fresh staged `CanvasTexture` and disposing the old one after swapping is clearer than assuming an existing GPU allocation will behave identically after dimensions change. Ordinary mask updates at the same size can continue reusing their canvas/texture.

## UV display and source-image fidelity

The UV canvas now uses CSS dimensions × device pixel ratio for sharp paths and handles. Preserve that fix. It is not the source texture resolution setting: widening the sidebar should not silently change a recipe's raster quality, and lowering mask quality should not blur vector guides.

Avoid a permanent 4096² `tinted` canvas just to present a smaller pane. Resize the shared tint scratch to the UV display backing resolution, crop the mask's **actual native width/height** into it, tint with `source-in`, and draw it to the UV display rectangle. This uses the selected mask quality without a hardcoded intermediate 1K bottleneck, while memory follows visible display pixels. Keep clipping/outside-atlas handling consistent with the background image and coverage. The UV pane remains a tint/shape view, not a physically lit optical preview.

`scene.ts` loads `head-color`, `eye-color`, head normal/roughness and brow/lash maps through texture loaders; the selected modded-eye map additionally verifies manifest dimensions. Do not resample these to the chosen makeup size. Similarly, `uv-editor.ts` already crops its albedo background using `image.width`/`image.height`; retain that use of native dimensions. A native 1K image enlarged on screen or copied into a 4K canvas does not gain new detail. Report source dimensions honestly if exposing them in diagnostics. Higher generated makeup quality cannot fix low-resolution references, a wrong brow texture, missing shader effects or genuine game/browser material differences.

## Resource scaling and practical guards

These are arithmetic estimates, **not measured browser allocations**. RGBA8 base images cost four bytes per texel; complete square power-of-two mip chains add approximately one third to GPU storage. Canvas implementations, staging, multiple CPU copies, renderer targets, native assets and temporary worker output add further cost.

| Quality | One RGBA base image | GPU image with mip chain | Plain layer: one CPU mask + its GPU chain | Current flake layer: mask + normal + packed surface, CPU bases and GPU chains |
|---|---:|---:|---:|---:|
| 512 | 1 MiB | 1.33 MiB | 2.33 MiB | 7 MiB |
| 1K | 4 MiB | 5.33 MiB | 9.33 MiB | 28 MiB |
| 2K | 16 MiB | 21.33 MiB | 37.33 MiB | 112 MiB |
| 4K | 64 MiB | 85.33 MiB | 149.33 MiB | 448 MiB |

Thus 32 distinct current flake layers at 4K have a nominal **14 GiB** combined footprint before the rest of the scene. A future independent flake-colour image adds another image per layer. Even plain 32-layer 4K preview has a nominal combined ~4.67 GiB. This is a concrete reason for bounded/lazy material allocation, not a reason to label partial 1K material work “4K”.

Recommended first implementation: enable the four resolutions, inspect `renderer.capabilities.maxTextureSize`, and apply a documented aggregate resource budget to the requested enabled-layer set. Present a specific capacity message if the chosen set cannot fit; preserve the old working preview and requested setting. Do not silently change authored shapes, omit enabled layers, or lower only glitter maps. Lazy disabled-layer storage and shared immutable optical maps with identical `(size,finish,settings)` reduce avoidable cost without changing appearance. An “active layer high quality” mode could be a useful later explicit option, but it is not equivalent to this global quality request.

Keep one in-flight large result per worker and transfer buffers. Avoid holding old/new 4K sets for every layer simultaneously: stage/swap one layer at a time and dispose old resources immediately after that layer's successful commit. Per-layer progress may temporarily show mixed **completed** resolutions during rebuilding; display that honestly as pending rather than claiming the whole preview has reached the target. Cancellation should release detached/stale arrays and drop queued result references promptly.

CPU time scales approximately with pixel count for a fixed shape/flake field: 4K is sixteen times 1K work before fixed overhead and cache effects. The new cooperative mask processor yields, but an initial full-white RGB fill still performs all pixels before its first yield. Measure cancellation latency at 4K and amend initialization if it becomes visible. Existing legacy flake positions are resolution-independent in cell coordinates, but their one-pixel edge filter changes relative coverage with output size; evaluate that expected sampling difference rather than promising byte-identical downsampled appearances.

## Evidence required

- Parser/default tests and exact settings/panel reload persistence; selecting quality must not alter recipe, Undo stack, V or camera/UV state.
- For every choice, assert complete mask and optical texture dimensions, byte lengths, cache keys and UV scratch/display dimensions. Old native asset dimensions remain unchanged.
- Compare raster values against the shared scalar evaluator at representative pixels, including enabled/disabled layers, symmetry, directional softness and varying pigment. Compare optical map bakes at matching size to the pure baker.
- Test rapid quality changes, old-worker completion after a preset switch, cancelled optical bakes, failure recovery, removed layers and disposal. Verify one layer cannot publish into another slot after reorder.
- Browser checks on wide/narrow sidebars and DPR changes: sharp controls, correct picking, correct cropped texture detail and no 1K scratch bottleneck. Check 512 versus 4K close-up with actual generated-edge differences, not merely a changed label.
- Measure bake time, cancellation latency and resource counts for ordinary single-layer, several glitter layers and the maximum permitted set. Retain a visible capacity failure case rather than letting an untested 32-layer 4K combination crash the renderer.
- Verify the current mask export remains 2048² regardless of preview setting. Game compilation stays at its separately validated resolutions and supported finishes.

## Provenance

This is an audit of project-owned implementation and established texture-format arithmetic. It reuses the already credited Three.js 0.186.0 texture/material facilities and the existing local asset provenance; no new community code or external technique was copied. Extend the existing dependency entry with this contract link when implementing it. The [glitter contract](../materials/glitter-implementation-contract.md) separately records photographic inspiration and the pending optical model.
