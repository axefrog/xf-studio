# W0 sector reader and collision solids

Implemented slice, 26 October 2026, awaiting independent code and UI review and integration. It reads vanilla collision primitives offline and draws them in Holotable. No game session was run. Cooked mesh bounds, mod mutations and instance-buffer decoding remain open. The run-4 cold-open target of under 3 s remains unmet.

## Files and behavior

| File | Current behavior |
|---|---|
| [streaming-sector.ts](../../projects/xf-studio/authoring/src/native/streaming-sector.ts) | Separate bounded version-62 sector appendix, 144-byte placements and compiled collision tables. Full and collision-only entry points; typed refusals. The general resource reader is unchanged. |
| [native-sector-diff.ts](../../projects/xf-studio/authoring/tools/native-sector-diff.ts), [native-streaming-sector.test.ts](../../projects/xf-studio/authoring/tests/native-streaming-sector.test.ts) | WolvenKit JSON differential and synthetic/opt-in real-sector tests without committed game payloads. |
| [model.ts](../../projects/xf-holotable/src/model.ts), [sector-data.ts](../../projects/xf-holotable/src/sector-data.ts) | Plain primitive and provenance types, plus a bounded fixed-stride private sector-cache format. |
| [sector-worker.ts](../../projects/xf-holotable/src/sector-worker.ts), [sector-cache.ts](../../projects/xf-holotable/src/sector-cache.ts) | Three independent native archive readers, cancellable queued requests and a per-sector SQLite cache. Each entry keys on depot path, archive path/size/mtime and native/sector/cache reader versions. |
| [solids.ts](../../projects/xf-holotable/src/solids.ts), [solid-overlap.ts](../../projects/xf-holotable/src/solid-overlap.ts) | Actor/local affine pose, exact path-distance index, conservative overlap removal and bounded world-extent selection. |
| [solid-source.ts](../../projects/xf-holotable/src/solid-source.ts) | Effective vanilla mount order, all Exterior L0–L6 and Interior descriptors, exact 350 m path-to-sector-box selection, active default/persistent placements, shape census and 12,000-primitive service cap. A separate assembled-region cache makes exact repeat opens fast; individual sectors remain reusable across recordings. |
| [service.ts](../../projects/xf-holotable/src/service.ts), [bench-solids.ts](../../projects/xf-holotable/tools/bench-solids.ts) | `world.status` reports cold before `world.around`; the benchmark measures one cold and two cached opens per recording. |
| [service.ts](../../projects/xf-studio/authoring/src/features/holotable/service.ts), [details-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/details-panel.ts) | Default-on “Solid shapes” Toggle, exact approved limits note and latest-open cancellation through `AbortSignal`. |
| [projection.ts](../../projects/xf-studio/authoring/src/features/holotable/view/projection.ts), [solid-projection.ts](../../projects/xf-studio/authoring/src/features/holotable/view/solid-projection.ts), [solid-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/solid-canvas.ts), [panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/panel.ts) | 350 m whole-volume cull, projected-extent ranking, 4 px cutoff outside 30 m, 900-shape budget, far-to-near Canvas 2D beneath the SVG, clipped lines and faces, computed theme tokens and theme-change refresh. Recorded data and picking stay in the SVG. |
| [sector-cache.test.ts](../../projects/xf-holotable/tests/sector-cache.test.ts), [solids.test.ts](../../projects/xf-holotable/tests/solids.test.ts), [holotable-module.test.ts](../../projects/xf-studio/authoring/tests/holotable-module.test.ts), [holotable-solids.test.ts](../../projects/xf-studio/authoring/tests/holotable-solids.test.ts) | Cache invalidation/cancellation, significant selection, cold message/new-open cancellation, topology, clipping, ordering and projection reuse. |

## Source, selection and provenance

Game 2.31 with Phantom Liberty; vanilla effective archive precedence only. Sector streaming boxes within 350 m of the recorded 3D path are selected. Collision-shape origins must also be within 350 m of that path. Range 0, persistent range and descriptor variants enabled by default are included. This does not reconstruct live quest variants, installed world mods, terrain/quest/AlwaysLoaded collision or the game's actual simultaneous physics registration. The two recordings are run 4 of session `82068e42` (1,929 V samples, about 875 m of travel) and the largest by bytes, session `34001b6c` run 1 (8,857 samples, about 0.15 m of travel).

| Recording | Sectors | Box | Sphere | Capsule | Primitive total | Convex | Triangle mesh | Cooked total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Run 4 | 1,179 | 175,716 | 1,154 | 15,261 | 192,131 | 21,452 | 209,401 | 230,853 |
| Largest | 873 | 117,469 | 674 | 9,888 | 128,031 | 12,699 | 141,363 | 154,062 |

These counts are after geometry-equal overlaps were removed: 7,771 / 3,568 shapes. Of those, 2,230 / 1,198 are cross-level matches, affecting 1,789 / 961 later actors; 1,788 / 958 of those actors match wholly. Retention is lowest numeric level, then depot path, then stored order. Equality uses type, world origin within 1 mm, full dimensions within 1 mm and affine-axis direction within 0.0001 rad; cooked shapes require identical sector and geometry hashes plus equal scale. This deliberately misses symmetric equivalents and cache aliases. [World and streaming §1.3](../../knowledge/world-and-streaming.md#13-sector-files) records the evidence and limitations.

The compiled shape record gives cooked meshes a hash and pose but no dimension. WolvenKit's CLI does not expose a checked geometry-cache bound; its separate Common reader handles variable PhysX payloads. W0 therefore omits all 230,853 / 154,062 cooked shapes, carries those counts in service data and states the omission plainly in the UI. No bound is fabricated. Resolving and verifying these bounds remains a separate reader task.

The service considers each primitive within 350 m of the path. Shapes at least 2 m in largest world extent and smaller shapes within 30 m compete for the 12,000 wire slots; the largest world extent wins, then physical volume, then stable id. It reports 180,131 / 116,031 cut. The view rejects whole volumes crossing 350 m from V, ranks the rest by largest projected extent, excludes sub-4 px extents except within 30 m, and draws at most 900. The view may therefore omit smaller collision details deliberately to show building-scale volumes. All data overlays remain above the geometry.

## Cache and timing

The per-sector cache is keyed by source sector and winning archive stamp plus reader versions. An additional assembled-region cache is keyed by the path and all vanilla archive stamps, so a fresh service can open an identical recording in milliseconds. Writes are atomic; sector entries have bounded decode windows and a 512 MiB disk budget, assembled regions a 32 MiB entry limit and 128 MiB total budget. Requesters share owner jobs; the final cancellation aborts the work and prevents abandoned publication. Native sector reads are synchronous inside bounded workers, so an active worker finishes its current sector before closing.

Windows, Bun 1.4.4, shared machine, 26 October 2026. Each cold run used a fresh private cache and a 2 GiB memory guard. “Cold” means no W0 cache, not a flushed OS disk cache; it includes recording load, archive indexes, sector preparation, selection and cache writes. “Memory” is a second call in the same service; “disk” uses a fresh service process object and its persisted assembled region.

| Recording | Cold | Memory repeat | Fresh-service disk repeat | Guard peak |
|---|---:|---:|---:|---:|
| Run 4 | 5,649 ms | 31 ms | 64 ms | 1.3 GiB |
| Largest | 5,575 ms | 34 ms | 176 ms | 1.2 GiB |

Earlier cold runs before the assembled-region write were 4,846 / 3,363 ms; shared-machine variation is substantial. A combined two-recording benchmark crossed its 2 GiB guard, so the final measurements used separate bounded processes (`--run4-only` and `--largest-only`). The under-3 s run-4 target is still open. The next performance pass should profile sector decode and path assembly separately, then reduce their dominant cost without dropping distinct higher-level collision. An exact repeat now meets the milliseconds goal, including after a fresh service starts.

## Browser frame and visual review

The actual panel factories, stylesheet and Toggle pattern were rendered in an isolated `?verify=1` page, with the panel at 300 or 800 px (drawing 272 or 772 px). Playback measurements traverse the entire recording and retain 180 frames after warmup; `ms` covers projection plus Canvas drawing, excluding later SVG writes and browser composition. The largest recording is almost stationary, so its unchanged camera reuses the canvas. The service cap is 12,000; the view cap is 900.

| Recording | Panel width | Median | P95 | Drawn |
|---|---:|---:|---:|---:|
| Run 4 | 300 px | 6.1 ms | 8.7 ms | 602–900 |
| Run 4 | 800 px | 7.2 ms | 10.6 ms | 900 |
| Largest | 300 px | 0.3 ms | 0.5 ms | 659–684 |
| Largest | 800 px | 0.3 ms | 0.6 ms | 900 |

All four playback cases meet the 8 ms median / 16 ms p95 projection-plus-draw budget. Deliberately orbiting the camera every frame at run 4's 100 s point measured 8.3 ms median / 10.7 ms p95 at 800 px: it misses the playback median target by 0.3 ms under simultaneous camera interaction. Selected world volumes there all projected above 24 px, so skipping face fills under 12 px did not save time. Curved outlines use 16 segments below 64 px and 24 above it. The 900 cap is the measured quality/performance choice; box edges, faint faces, trail and labels remain legible in both themes.

Eight private captures in `local/holotable/evidence/w0/` show light and dark at 300 and 800 px, run 4 at 100 s and the largest recording at 100 s, beside the Toggle style-guide pattern. They were visually inspected for clipping, layer order, theme tokens, control states and narrow wrapping. Independent UI design-lead PASS is still required before integration.

## Differential and checks

WolvenKit source `11720772`, CLI 9.0.1. Four real sectors of different classes, including Exterior L0/L1, Interior and Navigation, have zero full-document/placement/actor/shape differences against its JSON; bulk and full native collision reads agree. Exact depot paths and SHA-256 hashes are in [world and streaming §1.3](../../knowledge/world-and-streaming.md#13-sector-files). Synthetic sphere and malformed-window cases are covered without shipping game data. The separate general CR2W refusal contract is documented in [archive format §3](../../knowledge/archive-format.md#3-cr2w-resources).

- Authoring and headless TypeScript checks: pass.
- Targeted Holotable authoring tests: 24 pass; four real-sector opt-in comparisons: pass.
- Headless service suite: 25 pass.
- Link, tracked private-path and diff-whitespace checks: pass after updating this report.
- Full authoring suite was attempted in the first pass and stopped at an existing Chrome dock-layout hook timeout; no full-suite pass is claimed.

No game test is requested for this offline slice. This work is uncommitted; the dispatching chat reviews and commits it, obtains independent code/UI reviews, and arranges integration. The supplied brief remains untouched. The remaining product limitations are cold-open time, unverified cooked bounds, mods, live variant state and broader instance-buffer decoding.

Knowledge used: [World and streaming](../../knowledge/world-and-streaming.md), [archive format](../../knowledge/archive-format.md), [architecture contract](../authoring/architecture-contract.md), [Holotable proposal](proposal.md), [world backlog](../backlog/world-and-interactive-ideas.md), [developer orientation](../../docs/developer-orientation.md).
