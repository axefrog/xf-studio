# Agent layers implementation checkpoint

The agent publishing route and the expanded standalone/branch slice are implemented in this worktree, awaiting the landing chat's independent code and UI review. No commit, merge, game launch or runtime-bridge tool invocation was made. The dispatch brief was left unchanged. MCP publication remains outside this slice.

Agents can publish typed layers through the CLI or service, or append raw JSON lines. Studio draws all nine kinds over replay and the live fake, with producer/layer switches, item inspection, relations, facets, region fallback markers and a grouped What's here query. Standalone producer/set timelines have native recording/wall/game clocks and branch choices. Retractions use the same branch inheritance as items. Story content starts on, and switching it off removes story fields at the service boundary.

## Files

Paths in the first group are under `projects/xf-holotable/`:

| File | Responsibility |
| --- | --- |
| [src/layers.ts](../../projects/xf-holotable/src/layers.ts) | Shared schemas, all validation, versioned projection/semantic-tone tables, time and branch evaluation, entity and region placement, relation resolution, disclosure filtering and What's here. |
| [src/layer-spool.ts](../../projects/xf-holotable/src/layer-spool.ts) | Incremental byte reader, partial lines, rotation/truncation handling, live-item/spool/rate budgets, private refusal/rate sidecars, serialized publication and expiring watch leases. |
| [src/layer-timelines.ts](../../projects/xf-holotable/src/layer-timelines.ts) | Producer/set grouping, agreement checks, standalone sessions, branches and spatial extent. |
| [src/layer-validation.ts](../../projects/xf-holotable/src/layer-validation.ts) | Read-only file/folder validation with line-numbered refusals and set/budget checks. |
| [src/model.ts](../../projects/xf-holotable/src/model.ts) | Actor position samples, wall/game mappings, standalone metadata and optional world-pack label points/cell ids. |
| [src/recording.ts](../../projects/xf-holotable/src/recording.ts) | Recorder actors adapter and replay clock mapping adapter. |
| [src/live-bridge.ts](../../projects/xf-holotable/src/live-bridge.ts) | Retains recorder.status's wall reference; keeps bridge operations read-only. |
| [src/live.ts](../../projects/xf-holotable/src/live.ts) | Carries that mapping into the live session and admits actor validity/removal samples. |
| [src/service.ts](../../projects/xf-holotable/src/service.ts) | Publishing/watch/query methods, standalone discovery/opening, geometry around layer extents, replay/live queries and position-based reports. |
| [src/report.ts](../../projects/xf-holotable/src/report.ts) | Layer counts, refusals, placement limits, content-filtered nearby items and field samples; explicitly bounded to 128 items. |
| [tools/holo.ts](../../projects/xf-holotable/tools/holo.ts) | Publish and validate commands, standalone/branch/position reports, and service cleanup. |
| [tests/layers.test.ts](../../projects/xf-holotable/tests/layers.test.ts) | All kinds and refusal dimensions, temporal replacement/retraction, clocks, content filtering, regions/entities/relations, branches, budgets, spool lifetime and CLI-to-replay/live-fake integration. |
| [tools/layers-preview-client.ts](../../projects/xf-holotable/tools/layers-preview-client.ts) | Isolated real-panel/facade capture fixture, with existing library patterns beside Details. |
| [tools/capture-layers.ts](../../projects/xf-holotable/tools/capture-layers.ts) | Run-4/cached-world capture runner, synthetic agent content, frame measurements, deadlines and process/scratch cleanup. |
| [README.md](../../projects/xf-holotable/README.md) | Copy-paste publishing example, validation, clocks, branches, service methods, lifetimes and reproduction instructions. |

The Studio changes are under `projects/xf-studio/authoring/`:

| File | Responsibility |
| --- | --- |
| [src/features/holotable/agent-types.ts](../../projects/xf-studio/authoring/src/features/holotable/agent-types.ts) | Structural protocol types; no cross-project feature import. |
| [src/features/holotable/types.ts](../../projects/xf-studio/authoring/src/features/holotable/types.ts) | Layers-only recording rows and session metadata. |
| [src/features/holotable/service.ts](../../projects/xf-studio/authoring/src/features/holotable/service.ts) | Owns layer watches, cancellation, selection/place/producer/layer/branch actions, content level and query snapshots. |
| [view/agent-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/agent-canvas.ts) | Consumes the shared projection table; clipped/faded geometry, fields, arrows, relation curves, actor captions, region fan-out/clusters, picking and resumable drawing. |
| [view/place-picking.ts](../../projects/xf-studio/authoring/src/features/holotable/view/place-picking.ts) | Ground and affine collision-primitive intersections for spatial selection. |
| [view/solid-selection.ts](../../projects/xf-studio/authoring/src/features/holotable/view/solid-selection.ts) | Resumable significance selection, bounded slices and supersession. |
| [view/solid-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/solid-canvas.ts) | Resumable solid drawing within the remaining frame allowance. |
| [view/projection.ts](../../projects/xf-studio/authoring/src/features/holotable/view/projection.ts) | Camera rays, explicit standalone focus and prepared-solid injection. |
| [view/panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/panel.ts) | Wires renderer adapters, prioritizes data, schedules/cancels continuation frames, adds branch choice and game-clock readouts. |
| [view/details-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/details-panel.ts) | Existing GroupSection/Toggle/property-list composition for producer/layer controls, Story content, items, facets, relations and What's here. |
| [view/recordings-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/recordings-panel.ts) | Standalone set titles and layers-only span metadata. |
| [tests/holotable-agents.test.ts](../../projects/xf-studio/authoring/tests/holotable-agents.test.ts) | Producer/layer rows, default content switch, inspector facets/relations, What's here and watch withdrawal. |
| [tests/holotable-solid-budget.test.ts](../../projects/xf-studio/authoring/tests/holotable-solid-budget.test.ts) | Resumable significance equivalence, supersession and ground/solid picking. |
| [tests/holotable-module.test.ts](../../projects/xf-studio/authoring/tests/holotable-module.test.ts), [tests/holotable-live.test.ts](../../projects/xf-studio/authoring/tests/holotable-live.test.ts) | Updates the previous structure-default assertions while retaining disclosure-race coverage. |

The design lead's [specification](agent-layers.md) includes only the contract clarifications approved during this task: explicit set identity, reference scope, clock mapping fields, budget scheduling, branch inheritance and numeric validation bounds.

## Verification

- **96 targeted tests passed** across Holotable's complete tests plus Studio's Holotable module/live/agents/solid-budget files. After the final validator and watch-lifetime changes, the layer and Studio agent files passed again: **18 tests**, including the added late-watch regression. This final small run respected the quiet window; no browser or heavy run was started in it.
- **46 boundary tests passed:** architecture import boundary, Studio UI boundary and component ratchet. No component library or style-guide files changed.
- **Studio typecheck passed:** `bun x tsc --noEmit -p .` from authoring. Holotable's typecheck passed using the already installed authoring type roots.
- Markdown links: **0 broken links/source paths**. Privacy scan: **0 tracked-text private-path findings**. `git diff --check` passed. The Impeccable mechanical detector returned **no findings**.
- A supplemental scan covered all **32 changed/new candidate files**, including the untracked specification and this report: **0 privacy findings and 0 broken links/source paths**. The private dispatch brief was excluded from the candidate scan and remains unchanged.
- Heavy checks used the memory guard, at 2–3 GB limits; observed peaks stayed below the limits. The full Studio suite was deliberately left to the landing chat.
- The final footprint report found no owned worktree/output over 5 GB. Scratch was removed; retained evidence is **11.66 MiB** in its canonical ignored folder.

## Captures and frame cost

Private evidence is in `local/holotable/evidence/agent-layers/`: **24 PNGs**, `measurements.json` and a short evidence README. Captures completed before the 06:45–07:15 quiet window. No additional browser run is needed for this handoff.

The four theme/width variants (light/dark, Details at 300/480 px, beside existing library reference patterns) cover:

- all nine kinds over the actual recorded run 4, including three actors and their relation web, at full and structure content levels;
- a What's here selection, field/context read-back and the refusal row;
- a 13-marker region cluster and its inspector;
- a standalone week on each of two branches, with native game-clock readouts.

The base geometry comes from an existing local world pack and cached collision region. All agent content is synthetic. No game assets or private evidence were added to tracked source.

Across **593 measured frames, 592 were within 8 ms; one was 10 ms**. This outlier was explicitly accepted by the maintainer: the contract is the steady state and resumed-frame budget, not a hard real-time guarantee. Agent data draws first, with roughly 4 ms for its slice; cold solid selection and drawing yield to subsequent frames. The measured maximum cold completion was **30 frames**, with **144.4 ms of accumulated active preparation**. This is reported separately from per-frame cost.

## Handoff limits

The landing chat still owns independent code review, the design lead's UI PASS and the full Studio suite before integration. No in-game commissioning is claimed. Old recordings without a wall/game mapping refuse that clock as specified; the bridge's new manifest mapping fields remain a dependency for those recordings. MCP publication and the in-game interpreter are not implemented in this slice.

No source change requires a new component. All work remains uncommitted for the dispatching chat, and the maintainer's active draft and server were not used for verification.

Knowledge used: [places](../../knowledge/places.md), [world and streaming](../../knowledge/world-and-streaming.md), [layer proposal](proposal.md), [agent-layer specification](agent-layers.md), [architecture contract](../authoring/architecture-contract.md), [visual QA checklist](../authoring/ui-visual-qa-checklist.md). No game-knowledge page was found wrong; the new findings concern this implementation and its clock-source limits.
