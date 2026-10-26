# W0 sector reader and collision solids

Implemented slice, 26 October 2026; **uncommitted and awaiting independent code/UI review and integration**. No game session was run. The general native resource reader is unchanged. This slice completes the appendix/placement/collision path and primitive overlay, not broader W0 instance-buffer decoding. **Cold preparation still misses the brief's few-second target** on run 4; it is not claimed as closed.

## Files and behavior

Paths in the first group are under `projects/xf-studio/authoring/`:

| File | Change |
|---|---|
| `src/native/streaming-sector.ts` | Separate bounded version-62 appendix and 144-byte placement decoder; compiled collision tables, all five types, world actor poses, typed refusals. Full oracle path plus collision-only bulk entry point. Reader version 3. |
| `tools/native-sector-diff.ts` | Settings/mount-plan driven, opt-in four-sector extraction and WolvenKit JSON differential; compares every stored appendix/placement/collision field. |
| `tests/native-streaming-sector.test.ts` | Five synthetic tests for layout, defaults, malformed indexes/counts/windows, allocation limits and the verified +infinity sentinel; four opt-in real comparisons, including bulk/full parity. No game fixtures. |
| `src/features/holotable/types.ts` | Read-only primitive geometry and omission/cap metadata on the world snapshot. |
| `src/features/holotable/service.ts` | `solids` layer, default on; existing typed layer action remains its sole control route. |
| `src/features/holotable/view/shared.ts` | Existing Show catalogue gains “Solid shapes”. |
| `src/features/holotable/view/details-panel.ts` | Reuses Toggle; approved provenance sentence, explicit omitted cooked count, preparation-cap cut count and absent game-setting explanation in the existing limits note. |
| `src/features/holotable/view/solid-projection.ts` | Twelve box edges and front-facing faint faces; perspective sphere/capsule silhouettes plus one meridian; affine actor scale; 64-shape draw cap. No invented mesh bounds. |
| `src/features/holotable/view/projection.ts` | 350 m whole-shape cull before nearest-count cap, far-to-near order, near/rectangle face and line clipping. Weak geometry-radius memo for immutable snapshots, bounded nearest heap, fewer temporary arrays; stationary trail vertices deduplicated. |
| `src/features/holotable/view/panel.ts` | Pooled geometry SVG group beneath every recorded-data layer; `--line-strong` 1 px edges and `--text` fills at 0.04 / 0.06 multiplied by the existing fade. |
| `tests/holotable-module.test.ts` | Existing layer-state expectations include the new default-on layer. |
| `tests/holotable-solids.test.ts` | Primitive topology, silhouette/meridian, layer order, nearest cap after distance culling, near-plane/screen clipping, and rejection of whole shapes crossing 350 m. |

Paths in the second group are under `projects/xf-holotable/`:

| File | Change |
|---|---|
| `src/model.ts` | Plain world primitives, raw/unique shape census, per-band counts, cross-level overlap evidence and provenance. |
| `src/solids.ts` | Actor/local affine pose composition, cached actor basis per actor; exact nearest-polyline selection through a segment box tree; preparation cap 12,000. |
| `src/solid-overlap.ts` | Geometry equality with explicit distance/dimension/rotation tolerances and neighbouring-cell lookup. Capsules compare cap radius and cylinder length separately; equal outer bounds alone are insufficient. |
| `src/solid-source.ts` | Settings and vanilla mount plan; both blocks, Exterior L0–L6 + Interior, default/persistent variants, expanded path-box selection, overlap removal, counts, bounded source jobs and disk cache. Source reader version 5. |
| `src/service.ts` | `world.around` attaches solids even without an older district/cell world pack; injectable source port; margin validation. |
| `tests/core.test.ts` | Existing service tests inject an empty source and do not read an installed game. |
| `tests/solids.test.ts` | Source stamp/version invalidation, affine composition, independent exact-path oracle, nearest cap/order and invalid margin. |
| `tests/solid-overlap.test.ts` | Millimetre comparisons across cell boundaries, stable lowest-level retention, dimension/angular/hash mismatches, and unequal capsules with equal overall bounds. |
| `tools/bench-solids.ts` | Reproducible guarded offline census, cache timing and 300/800 px three-orbit projection measurements; explicit private output folder, 120 s deadline. |

Documentation: `knowledge/world-and-streaming.md` §1.3 now contains verified layouts, oracle hashes, all-level overlap evidence and cooked-bound limitations; `knowledge/archive-format.md` §3 documents the separate entry point without changing the general refusal contract. `docs/status.md`, `research/backlog/README.md`, `research/backlog/world-and-interactive-ideas.md`, this directory's `README.md` and `proposal.md` state the current slice and remaining work. [Asset-free measurements](w0-measurements.json) retain the census, pair counts, sample identities and timings.

## Source selection, overlap and shape census

Offline game 2.31 with Phantom Liberty; vanilla effective archive precedence only. Every Exterior level L0–L6 and Interior is eligible. Descriptor boxes overlap the recorded path's XY box expanded by 250 m; the census below counts shape **origins inside that box**, after selecting range 0, persistent range and descriptor-enabled variants. It is not a census of live loaded physics or bounds intersecting the box. Navigation's oracle sector contains no actors. Terrain, quest and AlwaysLoaded categories and live variant/mod mutations are outside this slice.

| Recording | Selected sectors | V samples | Recorded path length | XY span |
|---|---:|---:|---:|---|
| `82068e42`, run 4 | 1,054 | 1,929 | 874.93 m | 97.30 × 465.61 m |
| Largest by recorded bytes: `34001b6c`, run 1 | 758 | 8,857 | 0.15 m | 0.016 × 0.149 m |

The largest recording is 20,499,842 bytes, incomplete and nearly stationary. Largest file does not imply largest spatial region.

| Recording / stage | Box | Sphere | Capsule | Primitives | Convex | Triangle mesh | Cooked |
|---|---:|---:|---:|---:|---:|---:|---:|
| Run 4, raw | 148,722 | 888 | 12,374 | 161,984 | 18,957 | 178,139 | 197,096 |
| Run 4, retained | 146,044 | 878 | 12,100 | **159,022** | 18,128 | 174,952 | **193,080** |
| Largest, raw | 79,651 | 451 | 6,995 | 87,097 | 8,664 | 96,228 | 104,892 |
| Largest, retained | 78,793 | 445 | 6,852 | **86,090** | 8,280 | 95,238 | **103,518** |

**Real cross-level matches exist.** Run 4 has 2,063 matching shape occurrences in 1,639 later actors, including **1,632 whole actors** with all shapes matched one-to-one to one lower-level actor of equal shape count. Largest has 834 shape matches, 680 affected actors, 676 whole actors. Total removal including same-level overlaps is 6,978 / 2,381 shapes. These are measured geometry matches, not evidence that the engine registers duplicate physics bodies simultaneously.

Retention is ascending numeric level, then depot path, then stored node/actor/shape order. Compare type; origin distance ≤1 mm; full world-axis dimensions ≤1 mm; corresponding affine-axis angle ≤0.0001 radians (0.0057°). Capsules additionally match the axial cap diameter and cylinder length. Cooked shapes require identical sector hash + geometry hash and scale within 1e-6, since their dimensions are absent. This intentionally misses symmetric equivalents and cache aliases rather than inferring equality. No entire loading band is suppressed.

| Kept band → removed band (run 4) | Matching shapes |
|---|---:|
| Exterior 0 → Exterior 1 | 1,053 |
| Exterior 0 → Exterior 2 | 185 |
| Exterior 1 → Exterior 2 | 286 |
| Exterior 1 → Exterior 3 | 38 |
| Exterior 2 → Exterior 3 | 53 |
| Interior 0 → Interior 1 | 123 |
| Interior 0 → Interior 2 | 20 |
| Interior 1 → Interior 2 | 19 |
| Interior 0 → Interior 3 | 3 |
| Interior 1 → Interior 3 | 2 |
| Interior 0 → Interior 4 | 1 |
| Exterior 0 → Interior 1 / 2 | 1 / 11 |
| Exterior 1 → Interior 2 | 266 |
| Interior 1 → Exterior 2 | 2 |

Example: `exterior_-20_21_0_0.streamingsector`, node 1395, actor 0, shape 0 matches `exterior_-10_10_0_1.streamingsector`, node 2819, actor 2, shape 0. Both paths are beneath `base\worlds\03_night_city\_compiled\default\`. Hash-based identities and further examples are in the measurement file. L4–L6 descriptor boxes are included; few or no actor origins from those bands fall inside these particular region boxes. That is a measured spatial result, not a level exclusion.

## Cooked bounds and drawing limits

Cooked shapes dominate both regions. Their sector records carry a hash and pose, no bound. The effective geometry cache has **496 archive segments, 223,805,389 stored bytes and 429,475,106 decoded bytes** (largest decoded segment 13,553,223 bytes); a whole-resource read exceeds the native 128 MiB limit. WolvenKit `Archive/Helper/BufferHelper.cs` has the two `physicsGeometryCache` buffer-reader registrations commented out. Its CLI therefore does not provide the needed decoded-bound JSON oracle. Its separate Common geometry service parses variable PhysX hull/BV4 payloads and resolves sector/hash with a sector-0 fallback.

The approved fallback is implemented: **193,080 / 103,518 cooked shapes omitted**, with their counts carried to the limits note. Drawing dashed honest bounds requires selective cache-segment I/O, the sector/hash table and fallback resolver, bounded PhysX convex/triangle/BV4 parsing and an independent oracle using WolvenKit's Common reader. No cache streaming box, fabricated radius or guessed header offset is drawn as a mesh bound.

The service returns the nearest **12,000 primitives** to the recorded 3D polyline and reports **147,022 / 74,090** cut. The view first rejects shapes whose conservative affine enclosing sphere crosses **350 m from V**, so no part of a rendered primitive exceeds that distance. It then selects the nearest **64** and paints far-to-near beneath every recorded-data layer. The conservative whole-shape boundary may reject a shape whose true surface would fit. Every edge and face passes near-plane and panel-margin clipping. In these samples the per-frame cap removes a further 11,936 eligible primitives; this is an intentionally sparse overlay, not a complete city model.

## Timings and cache policy

Windows, Bun 1.4.4, shared machine, 26 October 2026. “Cold” means no W0 region cache, **not** a flushed OS disk cache; includes recording open, archive indexes, block/sector reads, overlap census, selection and cache write. In-memory repeat includes service routing/stamp checks; disk repeat is a fresh service, including its recording load.

| Recording | Final reader v5 first open | In-memory repeat | Fresh-service disk-cache repeat |
|---|---:|---:|---:|
| Run 4 | **7,133.6 ms** | 27.5 ms | 57.0 ms |
| Largest | **4,763.6 ms** | 32.1 ms | 315.1 ms |

Earlier all-level runs with the same census measured run 4 5,513–5,828 ms and largest 3,652–5,049 ms. Final overlap hardening did not change counts. Shared-machine variability is substantial; the final measurement is retained rather than selecting the fastest run. **The first-open few-second target is not met reliably.** The CPU research found archive/decompression and collision-table decoding dominant after removing unused full placement/property work, composing actor bases once, culling origins before composing shape axes, and avoiding repeated archive-index lookups. Next performance work should reduce region preparation/allocations without dropping distinct higher-level colliders.

Cache keys include every vanilla source archive's physical path, size and precise mtime, recording path, margin and source/native/sector reader versions. Source stamps are checked again before publication. Owner jobs deduplicate per key; each requester has its own AbortSignal; the last requester cancelling aborts the owner, and abandoned work cannot publish. Per-region work refuses beyond 500,000 counted origins or 30 seconds; native allocations have their own typed limits. Writes are atomic, cache reads capped at 32 MiB, and this owner's entries pruned to 128 MiB. No source path is published in world data. This slice never invokes WolvenKit during normal opens.

Projection measurements below include all default data layers (cells off), all 12,000 returned primitives considered, whole-shape 350 m culling and the 64 draw cap. For each orbit/width: 40 time points across the recording, 120 warm-up frames then 120 timed frames; panel height 480 px. Geometry and session match the final census. Times are JS projection only, excluding SVG attribute writes and browser paint.

| Recording | Width | Top median / p95 | Tilt median / p95 | Low median / p95 |
|---|---:|---:|---:|---:|
| Run 4 | 300 | 0.84 / 2.54 ms | 1.06 / 2.65 ms | 1.04 / 2.34 ms |
| Run 4 | 800 | 1.09 / 2.67 ms | 0.80 / 2.47 ms | 1.35 / 3.21 ms |
| Largest | 300 | 0.59 / 2.07 ms | 0.80 / 2.29 ms | 0.74 / 1.98 ms |
| Largest | 800 | 1.03 / 2.35 ms | 0.55 / 1.90 ms | 0.96 / 1.90 ms |

Typical frames meet the approximately 3 ms target; run 4's wide Low p95 is 3.21 ms. Maximum observed in the final pass was 6.88 ms. This is not a hard real-time guarantee; there are allocation/GC/scheduling outliers. Larger caps (96/128) exceeded the budget. The 64 cap and stationary-trail deduplication are material to this result.

## Differential and validation

WolvenKit source **11720772**, CLI **9.0.1**, executable SHA-256 **`4e22bc953473f75e0126e40731965b56746f11b5950d8da39cf9103c3f74d7d0`**. Four different real sectors, including Exterior L0, Interior, Navigation and Exterior L1: **zero differences**, full/bulk collision parity. Exact paths, resource hashes and layout evidence are in [world and streaming §1.3](../../knowledge/world-and-streaming.md#13-sector-files) and [measurements](w0-measurements.json). Sphere decoding also has synthetic coverage; cooked bounds have no verified oracle in this slice.

- Authoring TypeScript check: PASS.
- Headless TypeScript check: PASS (its frozen-lockfile dependencies installed locally).
- Targeted authoring tests: **25 pass**, 4 real tests skipped in the ordinary command; the opt-in real run separately passes **all 4** (9 including synthetic cases).
- Headless suite: **19 pass**.
- Full authoring suite: attempted under a 6 GiB guard; existing `dock-strip-geometry.test.ts` Chrome hook timed out after 120 s, then execution was stopped during the next Chrome layout file. **No full-suite pass is claimed.** Guarded child processes were stopped, not left running.
- Impeccable detector over changed view files: **no findings**.
- Link check: **0 broken links/source paths across 470 Markdown files**. Tracked privacy check: **0 findings**; explicit scan of all **30 changed/new files** (excluding the unchanged supplied brief): **0 findings**. `git diff --check`: PASS.

Visual inspection used the actual panel factories, facade, shared component classes and production CSS in an isolated `?verify=1` harness, never the maintainer's draft. Light/dark captures at 300/480 px place the Toggle style-guide pattern beside the panels. Box edges, faint faces, sphere/capsule meridians, recorded-data ordering, narrow wrapping and default-on toggle were inspected. Turning the toggle off emptied the geometry group. A real run-4 capture shows the trail above geometry. Captures remain private at `local/holotable/evidence/w0/` (`light-300.png`, `dark-300.png`, `light-480.png`, `dark-480.png`, `light-300-off.png`, `run4-light-480.png`). **Author inspection does not replace the required independent UI design-lead PASS.** Independent code and UI reviews belong to the dispatching coordinator before integration; this brief prohibited subagents.

To reproduce: run `projects/xf-studio/authoring/tools/native-sector-diff.ts --out <private ignored folder>` under the memory guard, with game/WolvenKit configured in Settings. Set `XFS_TEST_GAME_ROOT` and `XFS_TEST_SECTOR_ORACLE` for real tests. Run `projects/xf-holotable/tools/bench-solids.ts --out <new private ignored folder>` under the guard; `HOLOTABLE_RECORDINGS` and `HOLOTABLE_WORLD_PACK` select the standard sources. A fresh output folder gives a cold region cache. Delete extracted game bytes, JSON and regenerable caches afterwards.

## Handoff

Cold-open optimisation, verified cooked bounds, broader W0 instance buffers, live variant knowledge and mods remain open. No runtime/game correctness is claimed. The maintainer need not launch the game for this offline slice; the next review is the independent code/UI review and a replay check after integration. No commit was made and the restart brief was left unchanged. Referenced private captures, two prepared region-cache files (8.75 MB total, to avoid immediate re-preparation) and asset-free measurements are preserved canonically. **Cleanup is blocked:** automatic approval review rejected recursive deletion of the verified `local/holotable/scratch/` folder, including a literal-path command, with only “blocked by policy” as the stated reason. No alternate deletion route was attempted. The coordinator must delete that disposable scratch (77 files, about 249 MiB). Two small Chrome-probe folders from the interrupted full-suite hooks are also outside this worktree's permitted edit scope; their exact names are in the private handoff. No retained task folder exceeds 5 GiB; the final footprint scan reports **313.2 GB free on C**. All own benchmark/server tool sessions have ended.

Knowledge used: [World and streaming](../../knowledge/world-and-streaming.md) (updated §1.3 and level interpretation), [archive format](../../knowledge/archive-format.md) (updated §3), [architecture contract](../authoring/architecture-contract.md), [Holotable proposal](proposal.md), [world backlog](../backlog/world-and-interactive-ideas.md), [developer orientation](../../docs/developer-orientation.md).
