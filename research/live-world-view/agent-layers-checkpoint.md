# Agent layers implementation checkpoint

The real-data review fixes landed in `83cf0655`, and the three Kabuki design fixes landed in the maintainer's `70209e77`. The re-review's two Medium findings are now fixed and left uncommitted for the dispatching chat. Optional `glyph` and `badge` metadata remains accepted at both content levels and draws nothing new. The dispatch brief and [glyph specification](glyphs.md) were left unchanged. No game, runtime-bridge tool, commit or merge was run by this agent.

## Re-review fixes against 70209e77

- **Off-screen targets:** [agent-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/agent-canvas.ts) treats a target with a from-line as extended geometry. Its clipped dashed segment and pick target survive even when the crosshair is outside the viewport or behind the camera. [The renderer regression](../../projects/xf-studio/authoring/tests/holotable-agent-canvas.test.ts) failed before the fix (zero strokes) and now verifies drawing and picking in both cases.
- **Concurrent standalone admission:** [layer-spool.ts](../../projects/xf-holotable/src/layer-spool.ts) holds a producer/set lock around a fresh consistency check, admission and append, releasing it in `finally`. New [set-publish-lock.ts](../../projects/xf-holotable/src/set-publish-lock.ts) shares an in-process queue across spool owners and an exclusive file beside the spools across processes. Waiting cancels or refuses after five seconds; abandoned files older than 30 seconds are recovered, while active owners remain protected. Existing per-layer publication locks remain in place. A refused candidate manifest releases its set lock before another candidate is considered.

The concurrent-publication regression in [layers.test.ts](../../projects/xf-holotable/tests/layers.test.ts) failed before the fix: both conflicting spans were accepted. It now accepts exactly one. Another regression starts two separate Bun processes together and verifies the losing span is refused and the lock file is removed. [Lock lifetime tests](../../projects/xf-holotable/tests/set-publish-lock.test.ts) cover abandoned-file recovery, cancellation while a live owner holds an aged lock, and cancellation of an in-process waiter without letting the next writer bypass the holder. README documents the operational lock bounds.

**Follow-up checks:** 35 targeted tests passed across layer validation/spool/CLI integration, set-lock lifetime and the real canvas interpreter. Both headless Holotable and Studio typechecks passed under 3 GiB memory guards; targeted tests used a 2 GiB guard (observed peak 0.5 GiB). Both requested regressions were observed failing on the original code before implementation. No captures or frame-performance runs were added for these geometry/concurrency fixes; the accepted captures and rendering allowance below remain unchanged.

The follow-up link scan passed across 480 Markdown files, privacy checking passed for all eight changed/new files, `git diff --check` passed, and the mechanical UI detector returned no findings. The temporary test publishers exited and their scratch was cleaned; no command remains running.

Layers-only sets open independently of optional solid context. Their context loads in the background within 350 m of the camera's orbit target, refreshed after the target moves more than 150 m. Recordings retain their path-based region, with context failures also tolerated. Failed session opens retain their title and plain reason in the view, with the library's Try again button. Layers-only rows appear beneath Live game and above recorder runs. Details includes the requested limits sentence.

Structure filtering now strips story fields from every item regardless of the publisher's manifest. Ingestion uses distinct-id sets and time slices, with no historical occupancy sweep. Publication, spool ingestion and validation share line/field checks. File/stdin publication stops reading immediately above 16 MiB. Running consumed-byte hashes detect rewritten prefixes. Superseded watch startups cannot schedule another timer. Spatial culling uses bounds or segments, retaining geometry that crosses the view even when its first vertex lies outside it.

The new `{ item: "places/cell" }` anchor follows a published actor, point, target or zone at the current moment, using the existing relation reference scopes. Point, target, label, actor and influence ends accept it. Forward chains resolve iteratively; missing references and cycles remain unplaced. Markers sharing a place fan out deterministically on the 12 px ring or collapse above 12 into a selectable count badge. Layers-only Show hides the four recording-only rows and restores them for replay/live. Its readout counts active items across visible layers, with correct singular wording and no text at zero; the slider alone shows day/time.

## Files in this round

Paths in this group are under `projects/xf-holotable/`:

| File | Change |
| --- | --- |
| [src/layers.ts](../../projects/xf-holotable/src/layers.ts) | Unconditional structure filtering; optional validated glyph/badge metadata; item-anchor validation and indexed, iterative current-place resolution, shared with relation references. |
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
| [src/features/holotable/view/agent-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/agent-canvas.ts) | Bounds culling, crossing geometry, deterministic fan-out and count badges for markers sharing an item or region place. |
| [src/features/holotable/view/panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/panel.ts) | Camera-target requests, library open-error composition and layers-only item-count readout. |
| [src/features/holotable/view/details-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/details-panel.ts) | Limits note, applicable Show rows and shared-place cluster inspector. |
| [tests/holotable-context.test.ts](../../projects/xf-studio/authoring/tests/holotable-context.test.ts) | New regressions for failed/deferred context, movement threshold, stale/hide cancellation, retry/order and late startup polls. |
| [tests/holotable-agent-canvas.test.ts](../../projects/xf-studio/authoring/tests/holotable-agent-canvas.test.ts) | Crossing-path drawing/picking plus deterministic 12 px placement under reordered input and the above-12 selectable badge. |
| [tests/holotable-labels.test.ts](../../projects/xf-studio/authoring/tests/holotable-labels.test.ts) | Crossing/far paths, zones, fields and relation culling cases. |
| [tests/holotable-agents.test.ts](../../projects/xf-studio/authoring/tests/holotable-agents.test.ts) | Open-error retry, client metadata, recording-only switch hiding/restoration and visible-layer readout counts. |

The [agent-layer specification](agent-layers.md) records the approved disclosure rule, distinct-id contract, optional context and metadata admission. Its accepted frame allowance remains 8 ms steady state and up to 12 ms per cold/resumed preparation frame. No component-library or style-guide files changed.

## Regression evidence

| Finding | Regression |
| --- | --- |
| Publisher-declared structure leaks story text | A structure manifest with labels, details, facets, actor names, relation types and free citation text loses those fields. Role and glyph/badge metadata remain. |
| Quadratic occupancy and blocked ingestion | 8,000 replacements ingest in under 200 ms and yield to a timer; another case cancels a reader and renews a watch during ingestion. Combined runs passed the threshold, including a 31.65 ms whole-test sample with setup. |
| Unbounded CLI input | Controlled streams cancel on the first oversized chunk. A CLI child fed 17 MiB exits with the bound refusal before the writer sends EOF. |
| Publish/ingest disagreement | The same oversized raw line and field violations receive matching refusals. |
| Missed rewritten prefix | A rewritten prefix with the same final 64 bytes reloads the layer. |
| Duplicate polling loops | Hide, re-show, resolve the old startup poll: exactly one current polling timer remains. |
| First-anchor culling | Bounds/segments cover paths, zones, fields and relations; the renderer also draws and picks a crossing path. |
| Optional context fails an open | Recording context failures still open; standalone context can remain deferred or fail while layers are ready. Stale/hidden results are discarded. |
| Open error disappears | Failed title/reason and library retry dispatch are tested. |
| Standalone order/region | Sets first, one 350 m centre, preserved recording paths and 150 m refresh threshold. |
| Glyph/badge admission | Valid/unknown slugs, length/type/format refusals, both content levels and client read-back. |
| Item anchors | Allowed kinds/ends, cross-layer/producer refs, zone centroid, moving actors, forward chains, cycles, missing/hidden refs and both content levels. |
| Layers-only presentation | Four recording-only switches disappear and return for recording/live; readout counts visible layers, singular and zero. Captures assert these states. |

The maintainer simplified the contract to **at most 5,000 distinct item ids**. Replacements and retractions retain their ids; the 16 MiB spool cap bounds history. No peak-occupancy algorithm or test remains. Ingestion and publication refuse a new 5,001st id with exactly: “This layer already has 5,000 items; split it (for example by district).”

## Checks

- At checkpoint `70209e77`, **171 tests passed**, zero failures: 125 Holotable/Studio feature tests plus 46 architecture/UI boundary tests, across 17 files. This included all headless Holotable tests and the targeted Studio Holotable module/live/agents/budget/labels/context/canvas files. The current re-review follow-up's 35 targeted tests are listed above.
- **Studio and headless Holotable typechecks passed.** Studio used `bun x tsc --noEmit -p .`; headless used the installed authoring compiler/type roots.
- Heavy checks/captures used 2–3 GB memory guards, below their limits. The full Studio suite remains the landing chat's responsibility. No heavy run or browser capture started during the 06:45–07:15 quiet window.
- Link checking passed across 480 Markdown files; the full tracked privacy scan found no private paths; `git diff --check` passed. The mechanical UI detector returned no findings for all three changed view modules. This follow-up adds no untracked source; only the unchanged private dispatch brief is untracked.

## Real-data captures

Private evidence in `local/holotable/evidence/story-layers/` contains `day-1-light-wide.png`, `day-1-dark-wide.png`, `day-4-light-wide.png`, `day-4-dark-wide.png`, `verification.json` and an evidence README. These replace the initial copies from this round. The normal service read the private Story Engine spool; the normal solid worker used the offline world pack and reusable sector cache. No game or runtime bridge was used. Verification used an isolated `?verify=1` fixture, not the maintainer's draft or running server.

Every capture shows **12 layers, 369 active items, zero refusals, no V and no open error**. Day 1 is game second 3,600; day 4 is 262,800. Each context request used one centre and margin 350; each completed client snapshot contained 12,000 solid shapes. All four recording-only switches are hidden and the readout says “369 items at this moment”; the slider shows the day/time once. Recordings order and the limits sentence are visible. The private input still publishes `{ region: "unplaced" }` for 21 events and 10 stories; these remain “not placed” until the producer republishes with valid item anchors. Other unresolved input placements are director (3) and people (1). No private spool was rewritten. The overview spans the authored extent, with a truthful schematic reference-model banner.

All four refreshed captures were inspected together in light/dark at both days, beside the existing library reference. The Show rows and item readout match the requested design. Earlier accepted synthetic evidence remains under `local/holotable/evidence/agent-layers/` (24 PNGs, about 12 MiB) for its design review. Current real-data evidence totals 910,291 bytes. The capture command exited successfully and closed its browser, service and local fixture server. Only canonical ignored evidence, the private spool and reusable cache are retained after scratch cleanup.

The empty task scratch directory was removed. The wrap-up disk-footprint check reports 300.5 GiB free on C and no owned folder above 5 GiB; unrelated projects' retained outputs were left alone. No command started by this agent remains running.

## Handoff limits

The earlier design PASS and accepted frame sample remain the prior round's evidence: 565 frames, ten cold/resumed frames at 9.3–11 ms and every steady frame within 8 ms. The clarified contract permits cold preparation up to 12 ms per frame. Performance work stopped at that acceptance; this round ran no further frame-performance investigation. The requested ingestion regression is separate and passes its 200 ms threshold.

The dispatching chat owns independent review of this follow-up, any new UI review and the full Studio suite before integration. This round makes no new independent design-PASS claim and no in-game commissioning claim. MCP publication, the in-game interpreter and drawing glyphs/badges remain outside this slice.

The two re-review fixes build on `70209e77` and remain ready for the maintainer's commit. No additional feature or rendering-performance work is planned. Any input requiring item anchors must be republished by its producer; this implementation never guesses a replacement for an unknown region.

Knowledge used: [places](../../knowledge/places.md), [world and streaming](../../knowledge/world-and-streaming.md), [layer proposal](proposal.md), [agent-layer specification](agent-layers.md), [glyph specification](glyphs.md), [architecture contract](../authoring/architecture-contract.md), [visual QA checklist](../authoring/ui-visual-qa-checklist.md). No game-knowledge page was contradicted; the findings concern implementation bounds, disclosure and async lifetime.
