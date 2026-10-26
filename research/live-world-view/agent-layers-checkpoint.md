# Agent layers implementation checkpoint

The agent publishing route and the expanded standalone/branch slice are implemented. This follow-up builds on `ff71594c` and addresses the design lead's six FIX findings; its edits remain uncommitted for the landing chat's code review and commit. Design review is PASS, with the requested actor-chip correction now complete. No commit, merge, game launch or runtime-bridge tool invocation was made by this agent. The dispatch brief was left unchanged. MCP publication remains outside this slice.

Agents can publish typed layers through the CLI or service, or append raw JSON lines. Studio draws all nine kinds over replay and the live fake, with producer/layer switches, item inspection, relations, facets, region fallback markers and a grouped What's here query. Standalone producer/set timelines have native recording/wall/game clocks and branch choices. Retractions use the same branch inheritance as items. Story content starts on, and switching it off removes story fields at the service boundary.

Labels now share one greedy collision layout across agent names, captions, relation types, V and event text, capped at 40 labels. Selection and hover lead, followed by related ends, actor names and available captions, targets/points, relation types and other text. Markers and their pick targets remain independent of text culling. Captions contain only the first facet's value, muted and shortened to 28 characters. Counts have correct plurals, game-clock row spans use days/hours, and relations have meaningful destination titles in both inspectors and What's here. Actor relation chips are relative to the inspected actor: outgoing `type → <to>`, incoming `<from> → type`, and mutual `type ↔ <other>`. The first standalone open fits all branches' authored extents; its draw range scales with that extent.

## Files

Paths in the first group are under `projects/xf-holotable/`:

| File | Responsibility |
| --- | --- |
| [src/layers.ts](../../projects/xf-holotable/src/layers.ts) | Shared schemas, all validation, versioned projection/semantic-tone tables, time and branch evaluation, entity and region placement, relation resolution, disclosure filtering and What's here. |
| [src/layer-spool.ts](../../projects/xf-holotable/src/layer-spool.ts) | Incremental byte reader, partial lines, rotation/truncation handling, live-item/spool/rate budgets, private refusal/rate sidecars, serialized publication and expiring watch leases. |
| [src/layer-timelines.ts](../../projects/xf-holotable/src/layer-timelines.ts) | Producer/set grouping, agreement checks, standalone sessions, branches and spatial extent. |
| [src/layer-validation.ts](../../projects/xf-holotable/src/layer-validation.ts) | Read-only file/folder validation with line-numbered refusals and set/budget checks. |
| [src/model.ts](../../projects/xf-holotable/src/model.ts) | Actor position samples, wall/game mappings, standalone metadata including framing bounds, and optional world-pack label points/cell ids. |
| [src/recording.ts](../../projects/xf-holotable/src/recording.ts) | Recorder actors adapter and replay clock mapping adapter. |
| [src/live-bridge.ts](../../projects/xf-holotable/src/live-bridge.ts) | Retains recorder.status's wall reference; keeps bridge operations read-only. |
| [src/live.ts](../../projects/xf-holotable/src/live.ts) | Carries that mapping into the live session and admits actor validity/removal samples. |
| [src/service.ts](../../projects/xf-holotable/src/service.ts) | Publishing/watch/query methods, standalone discovery/opening, geometry around layer extents, replay/live queries and position-based reports. |
| [src/report.ts](../../projects/xf-holotable/src/report.ts) | Pluralized layer counts, refusals, placement limits, content-filtered nearby items and field samples; explicitly bounded to 128 items. |
| [tools/holo.ts](../../projects/xf-holotable/tools/holo.ts) | Publish and validate commands, pluralized publication counts, standalone/branch/position reports, and service cleanup. |
| [tests/layers.test.ts](../../projects/xf-holotable/tests/layers.test.ts) | All kinds and refusal dimensions, temporal replacement/retraction, clocks, content filtering, regions/entities/relations, branches, budgets, spool lifetime and CLI-to-replay/live-fake integration. |
| [tools/layers-preview-client.ts](../../projects/xf-holotable/tools/layers-preview-client.ts) | Isolated real-panel/facade capture fixture, with existing library patterns beside Details. |
| [tools/capture-layers.ts](../../projects/xf-holotable/tools/capture-layers.ts) | Run-4/cached-world capture runner, synthetic agent content, frame measurements, optional single-case refresh, deadlines and process/scratch cleanup. |
| [README.md](../../projects/xf-holotable/README.md) | Copy-paste publishing example, validation, clocks, branches, service methods, lifetimes and reproduction instructions. |

The Studio changes are under `projects/xf-studio/authoring/`:

| File | Responsibility |
| --- | --- |
| [src/features/holotable/agent-types.ts](../../projects/xf-studio/authoring/src/features/holotable/agent-types.ts) | Structural protocol types; no cross-project feature import. |
| [src/features/holotable/types.ts](../../projects/xf-studio/authoring/src/features/holotable/types.ts) | Layers-only recording rows and session metadata. |
| [src/features/holotable/service.ts](../../projects/xf-studio/authoring/src/features/holotable/service.ts) | Owns layer watches, cancellation, selection/place/producer/layer/branch actions, content level and query snapshots. |
| [view/agent-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/agent-canvas.ts) | Consumes the shared projection table; clipped/faded geometry, fields, arrows, relation curves, actor captions, region fan-out/clusters, picking and resumable drawing. |
| [view/agent-labels.ts](../../projects/xf-studio/authoring/src/features/holotable/view/agent-labels.ts) | Pure collision layout and priorities, caption shortening, relation titles, count wording and game-clock spans. |
| [view/place-picking.ts](../../projects/xf-studio/authoring/src/features/holotable/view/place-picking.ts) | Ground and affine collision-primitive intersections for spatial selection. |
| [view/solid-selection.ts](../../projects/xf-studio/authoring/src/features/holotable/view/solid-selection.ts) | Resumable significance selection, bounded slices and supersession; computes each candidate's camera distance once before sorting. |
| [view/solid-canvas.ts](../../projects/xf-studio/authoring/src/features/holotable/view/solid-canvas.ts) | Resumable solid drawing within the remaining frame allowance. |
| [view/projection.ts](../../projects/xf-studio/authoring/src/features/holotable/view/projection.ts) | Camera rays, explicit standalone focus and prepared-solid injection. |
| [view/panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/panel.ts) | Wires renderer adapters, prioritizes data, schedules/cancels continuation frames, adds branch choice and game-clock readouts. |
| [view/details-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/details-panel.ts) | Existing GroupSection/Toggle/property-list composition for producer/layer controls, Story content, items, facets, relations and What's here. |
| [view/recordings-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/recordings-panel.ts) | Standalone set titles and layers-only span metadata. |
| [tests/holotable-agents.test.ts](../../projects/xf-studio/authoring/tests/holotable-agents.test.ts) | Producer/layer rows, default content switch, inspector facets/relations, What's here and watch withdrawal. |
| [tests/holotable-labels.test.ts](../../projects/xf-studio/authoring/tests/holotable-labels.test.ts) | Collision priorities, hover promotion, label cap/overflow, captions, meaningful titles, counts, game spans and perspective fitting at narrow/wide sizes. |
| [tests/holotable-solid-budget.test.ts](../../projects/xf-studio/authoring/tests/holotable-solid-budget.test.ts) | Resumable significance equivalence, supersession and ground/solid picking. |
| [tests/holotable-module.test.ts](../../projects/xf-studio/authoring/tests/holotable-module.test.ts), [tests/holotable-live.test.ts](../../projects/xf-studio/authoring/tests/holotable-live.test.ts) | Updates the previous structure-default assertions while retaining disclosure-race coverage. |

The design lead's [specification](agent-layers.md) records the approved bounds: 8 ms steady state and up to 12 ms per cold-preparation frame, including resumed cold frames. Its stale “N items refused” wording was corrected to “N refused” to match the review decision. The dispatch brief remains unchanged.

## Verification

- **102 targeted tests passed** across Holotable's complete tests and Studio's Holotable module/live/agents/solid-budget/labels files. The framing test includes both branches, sphere bounds, zone height, fields and influence ends. The inspector test checks meaningful relation titles in both selection and What's here. After the final design review, **9 targeted tests passed again**, including three new outgoing/incoming/mutual cases and the actor-inspector far-end regression; the Studio typecheck passed again.
- **46 boundary tests passed:** architecture import boundary, Studio UI boundary and component ratchet. No component library or style-guide files changed.
- **Studio and Holotable typechecks passed.** The Studio command was `bun x tsc --noEmit -p .`; Holotable used the already installed authoring compiler/type roots.
- Markdown links and privacy scans passed; `git diff --check` passed. The Impeccable mechanical detector returned no findings. New files are included in a supplemental candidate scan.
- Heavy checks used memory guards at 2–3 GB limits, with observed peaks below those limits. The full Studio suite remains the landing chat's responsibility.
- No headless browser, full suite or heavy run started during the **06:45–07:15** quiet window. Code and small targeted tests proceeded then; fresh captures began after **07:15 local**.

## Captures and frame cost

Private evidence in `local/holotable/evidence/agent-layers/` was replaced with **24 fresh PNGs**, `measurements.json` and the evidence README, about **12.02 MiB**. It covers actor full/structure, cluster, What's here and both standalone branches in light/dark at 300/480 px Details widths, beside the existing component-library reference. The first batched inspection confirmed collision culling, value-only captions, meaningful relation titles, count wording, days/hours and the closer standalone framing. One confirmation pass followed the bounded solid-distance sorting change. The design lead then issued PASS with one actor-chip bug: a mutual tie named the inspected actor. That bug is fixed and covered by outgoing, incoming and mutual tests. Only the eight actor full/structure theme/width captures were refreshed for that requested correction; other accepted captures were retained. Their separate sample is in `measurements-actor.json`; no further performance work was run.

All nine kinds remain over actual recorded run 4. The world pack and cached collision geometry are existing offline inputs; agent content is synthetic. The browser fixture uses `?verify=1`, and no game assets or private captures were added to tracked source.

The accepted full pass, before that final actor-chip wording correction, measured **565 frames: 555 within 8 ms, ten cold/resumed frames at 9.3–11 ms**. All **26 completed/steady frames** were within 8 ms (maximum **5.7 ms**). The largest cold completion was **37 frames**, with **171.8 ms accumulated active preparation**. These are elapsed browser measurements, including scheduling/collection variability; no hard real-time guarantee is claimed. The coordinator explicitly accepted this new sample: steady state remains within 8 ms, and cold preparation may take up to 12 ms per frame. The ten 9.3–11 ms cold/resumed frames are within that clarified allowance. Performance work stops at this accepted result.

The capture runner closed its browser and service and removed its scratch payload. Retained evidence is canonical and ignored; no owned output over 5 GB is being kept.

## Handoff limits

The landing chat still owns independent code review and the full Studio suite before integration. The design lead issued UI PASS with the far-end actor-chip correction, now implemented, tested and re-captured. No in-game commissioning is claimed. Old recordings without a wall/game mapping refuse that clock as specified; the bridge's new manifest mapping fields remain a dependency for those recordings. MCP publication and the in-game interpreter are not implemented in this slice.

No source change requires a new component. This follow-up remains uncommitted for the dispatching chat, and the maintainer's active draft and server were not used for verification.

Knowledge used: [places](../../knowledge/places.md), [world and streaming](../../knowledge/world-and-streaming.md), [layer proposal](proposal.md), [agent-layer specification](agent-layers.md), [architecture contract](../authoring/architecture-contract.md), [visual QA checklist](../authoring/ui-visual-qa-checklist.md). No game-knowledge page was found wrong; the new findings concern this implementation and its clock-source limits.
