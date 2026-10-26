# Agent layers implementation checkpoint

The real-data fixes and all seven review findings against `fddbbe41` are implemented, tested and left uncommitted for the dispatching chat. Work is checkpointed at the maintainer's restart request; final static checks and handoff cleanup remain. Optional `glyph` and `badge` metadata is accepted, preserved at both content levels and passed to the client; it draws nothing new. The dispatch brief and the maintainer's new [glyph specification](glyphs.md) were left unchanged. No game, runtime-bridge tool, commit or merge was run.

Layers-only sets open independently of optional solid context. Their context loads in the background within 350 m of the camera's orbit target, refreshed after the target moves more than 150 m. Recordings retain their path-based region, with context failures also tolerated. Failed session opens retain their title and plain reason in the view, with the library's Try again button. Layers-only rows appear beneath Live game and above recorder runs. Details includes the requested limits sentence.

Structure filtering now strips story fields from every item regardless of the publisher's manifest. Ingestion uses distinct-id sets and time slices, with no historical occupancy sweep. Publication, spool ingestion and validation share line/field checks. File/stdin publication stops reading immediately above 16 MiB. Running consumed-byte hashes detect rewritten prefixes. Superseded watch startups cannot schedule another timer. Spatial culling uses bounds or segments, retaining geometry that crosses the view even when its first vertex lies outside it.

## Files in this round

Paths in this group are under `projects/xf-holotable/`:

| File | Change |
| --- | --- |
| [src/layers.ts](../../projects/xf-holotable/src/layers.ts) | Unconditional structure filtering; optional validated glyph/badge metadata. Actor names become role or kind, relation types disappear, and unstructured agent/Story Engine citation text is removed. |
| [src/layer-line.ts](../../projects/xf-holotable/src/layer-line.ts) | New shared raw-line, JSON, manifest/item validation and O(1) distinct-id admission; 1 MiB checked before ignoring whitespace. |
| [src/bounded-input.ts](../../projects/xf-holotable/src/bounded-input.ts) | New streaming batch reader with running 16 MiB cap and immediate cancellation on overflow. |
| [src/layer-spool.ts](../../projects/xf-holotable/src/layer-spool.ts) | Async time-sliced scans, distinct-id sets, running consumed-byte hash and bounded prefix verification, common publication validation, serialized publication/read-back, responsive cancellation and watch lifetime. |
| [src/layer-validation.ts](../../projects/xf-holotable/src/layer-validation.ts) | Common line and distinct-id checks for read-only validation. |
| [src/service.ts](../../projects/xf-holotable/src/service.ts) | Awaits spool operations, preserves coded cancellation, lists standalone rows first, requests a singleton 350 m standalone region and preserves recording paths. |
| [tools/holo.ts](../../projects/xf-holotable/tools/holo.ts) | Streams file/stdin publication, preserves raw lines for validation and awaits publication. |
| [tests/layers.test.ts](../../projects/xf-holotable/tests/layers.test.ts) | Regressions for disclosure, ingestion cost/yielding, byte bounds, publish/ingest parity, rewrite detection, distinct ids, context region, cancellation and metadata. |
| [tools/capture-layers.ts](../../projects/xf-holotable/tools/capture-layers.ts) | Adapts existing synthetic captures to async publication. |
| [tools/layers-preview-client.ts](../../projects/xf-holotable/tools/layers-preview-client.ts) | Real-spool/day support and truthful reference-model banner in the isolated fixture. |
| [tools/capture-story-layers.ts](../../projects/xf-holotable/tools/capture-story-layers.ts) | New real-spool verification through the normal service/solid worker, bounded lifetime and four captures; waits for completed context to reach the client. |
| [README.md](../../projects/xf-holotable/README.md) | Current bounds, streaming/validation behavior, optional context, errors/retry and capture reproduction. |

Studio paths are under `projects/xf-studio/authoring/`:

| File | Change |
| --- | --- |
| [src/features/holotable/agent-types.ts](../../projects/xf-studio/authoring/src/features/holotable/agent-types.ts) | Optional glyph/badge protocol metadata. |
| [src/features/holotable/service.ts](../../projects/xf-studio/authoring/src/features/holotable/service.ts) | Optional background context/cancellation, movement refresh, retained errors/retry, row ordering and watch-token scheduling guards. |
| [src/features/holotable/view/agent-bounds.ts](../../projects/xf-studio/authoring/src/features/holotable/view/agent-bounds.ts) | New pure bounds/segment intersection against the view circle. |
| [src/features/holotable/view/agent-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/agent-canvas.ts) | Bounds culling and crossing-geometry rendering without inventing marker positions. |
| [src/features/holotable/view/panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/panel.ts) | Reports the camera target and composes existing empty-state/button components for open errors. |
| [src/features/holotable/view/details-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/details-panel.ts) | Adds “Solid shapes are drawn within 350 m of where you're looking.” for layers-only sets. |
| [tests/holotable-context.test.ts](../../projects/xf-studio/authoring/tests/holotable-context.test.ts) | New regressions for failed/deferred context, movement threshold, stale/hide cancellation, retry/order and late startup polls. |
| [tests/holotable-agent-canvas.test.ts](../../projects/xf-studio/authoring/tests/holotable-agent-canvas.test.ts) | New renderer regression: drawing and picking a crossing path despite its distant first vertex. |
| [tests/holotable-labels.test.ts](../../projects/xf-studio/authoring/tests/holotable-labels.test.ts) | Crossing/far paths, zones, fields and relation culling cases. |
| [tests/holotable-agents.test.ts](../../projects/xf-studio/authoring/tests/holotable-agents.test.ts) | Open-error text/library retry and client metadata preservation. |

The [agent-layer specification](agent-layers.md) records the approved disclosure rule, distinct-id contract, optional context and metadata admission. Its accepted frame allowance remains 8 ms steady state and up to 12 ms per cold/resumed preparation frame. No component-library or style-guide files changed.

## Regression evidence

| Finding | Regression |
| --- | --- |
| Publisher-declared structure leaks story text | A structure manifest with labels, details, facets, actor names, relation types and free citation text loses those fields. Role and glyph/badge metadata remain. |
| Quadratic occupancy and blocked ingestion | 8,000 replacements ingest in under 200 ms and yield to a timer; another case cancels a reader and renews a watch during ingestion. The final combined run passed the threshold; its whole test, including setup, took 121.70 ms. |
| Unbounded CLI input | Controlled streams cancel on the first oversized chunk. A CLI child fed 17 MiB exits with the bound refusal before the writer sends EOF. |
| Publish/ingest disagreement | The same oversized raw line and field violations receive matching refusals. |
| Missed rewritten prefix | A rewritten prefix with the same final 64 bytes reloads the layer. |
| Duplicate polling loops | Hide, re-show, resolve the old startup poll: exactly one current polling timer remains. |
| First-anchor culling | Bounds/segments cover paths, zones, fields and relations; the renderer also draws and picks a crossing path. |
| Optional context fails an open | Recording context failures still open; standalone context can remain deferred or fail while layers are ready. Stale/hidden results are discarded. |
| Open error disappears | Failed title/reason and library retry dispatch are tested. |
| Standalone order/region | Sets first, one 350 m centre, preserved recording paths and 150 m refresh threshold. |
| Glyph/badge admission | Valid/unknown slugs, length/type/format refusals, both content levels and client read-back. |

The maintainer simplified the contract to **at most 5,000 distinct item ids**. Replacements and retractions retain their ids; the 16 MiB spool cap bounds history. No peak-occupancy algorithm or test remains. Ingestion and publication refuse a new 5,001st id with exactly: “This layer already has 5,000 items; split it (for example by district).”

## Checks

- **168 tests passed**, zero failures: 122 Holotable/Studio feature tests plus 46 architecture/UI boundary tests, across 17 files. This includes all headless Holotable tests and the targeted Studio Holotable module/live/agents/budget/labels/context/canvas files.
- **Studio and headless Holotable typechecks passed.** Studio used `bun x tsc --noEmit -p .`; headless used the installed authoring compiler/type roots.
- Heavy checks/captures used 2–3 GB memory guards, below their limits. The full Studio suite remains the landing chat's responsibility. No heavy run or browser capture started during the 06:45–07:15 quiet window.
- Final link/privacy, whitespace and mechanical UI results are added after execution. Newly added source is included in a supplemental privacy scan because the repository tools normally scan tracked files.

## Real-data captures

Private evidence in `local/holotable/evidence/story-layers/` contains `day-1-light-wide.png`, `day-1-dark-wide.png`, `day-4-light-wide.png`, `day-4-dark-wide.png`, `verification.json` and an evidence README. These replace the initial copies from this round. The normal service read the private Story Engine spool; the normal solid worker used the offline world pack and reusable sector cache. No game or runtime bridge was used. Verification used an isolated `?verify=1` fixture, not the maintainer's draft or running server.

Every capture shows **12 layers, 369 active items, zero refusals, no V and no open error**. Day 1 is game second 3,600; day 4 is 262,800. Each context request used one centre and margin 350; each completed client snapshot contained 12,000 solid shapes. Recordings order and the limits sentence are visible. Unresolved input placements remain reported as “not placed”; these are not parser refusals and were not rewritten by this task. The overview spans the authored extent, with the fixture explicitly describing the generated placements as schematic reference-model content.

The initial day-1 light and day-4 dark captures were visually inspected; the final four-capture confirmation still needs a batched visual check. Earlier accepted synthetic evidence remains under `local/holotable/evidence/agent-layers/` (24 PNGs, about 12 MiB) for its design review. New real-data evidence is under 1 MiB. The capture command exited successfully and closed its browser, service and local fixture server. Canonical ignored evidence, the private spool and reusable cache remain; the final scratch/footprint check is pending.

## Handoff limits

The earlier design PASS and accepted frame sample remain the prior round's evidence: 565 frames, ten cold/resumed frames at 9.3–11 ms and every steady frame within 8 ms. The clarified contract permits cold preparation up to 12 ms per frame. Performance work stopped at that acceptance; this round ran no further frame-performance investigation. The requested ingestion regression is separate and passes its 200 ms threshold.

The dispatching chat owns independent review of this follow-up, any new UI review and the full Studio suite before integration. This round makes no new independent design-PASS claim and no in-game commissioning claim. MCP publication, the in-game interpreter and drawing glyphs/badges remain outside this slice.

Restart checkpoint: all code fixes and regression tests are done. The final headless typecheck passed again after the capture-wait adjustment; the Studio typecheck and 168-test run passed before that tool-only change. No agent-started command remains running. On resumption, finish link/privacy scans (including untracked source), `git diff --check`, the mechanical UI detector, final capture inspection, disk-footprint/scratch cleanup and this report's final check results. No additional feature or rendering-performance work is planned.

Knowledge used: [places](../../knowledge/places.md), [world and streaming](../../knowledge/world-and-streaming.md), [layer proposal](proposal.md), [agent-layer specification](agent-layers.md), [glyph specification](glyphs.md), [architecture contract](../authoring/architecture-contract.md), [visual QA checklist](../authoring/ui-visual-qa-checklist.md). No game-knowledge page was contradicted; the findings concern implementation bounds, disclosure and async lifetime.
