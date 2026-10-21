# Profiles phase 1b: handover to 1c

Phase 1b built the profile model, the subject registry, `CharacterService` and the creator catalogue split ([design §7](../../research/authoring/profiles-views-layouts-design.md#7-de-singletoning)). Its character write path is an interim mechanism. Chunk 1c replaces it with the design's outbox (§2.2, rules A1–A7), the single document sync mechanism for every document, characters included. This note says what the interim path does, where it lives, and which reproduced races 1c's tests must cover.

Line numbers are as of the 1b branch's last commit.

## What the character write path does today

All in [character-service.ts](../../projects/xf-studio/authoring/src/character/character-service.ts) unless noted.

| Piece | Where | What it does |
|---|---|---|
| Write port | [document-commands.ts](../../projects/xf-studio/authoring/src/platform/core/document-commands.ts) `storeCommands` (line 19) | Owner commands written through the document store one document at a time, in order. Receipts last for the session only. Includes the equal-value fallback (A5). Not atomic across documents. |
| Per-character state | `Entry` (line 62) | `revision`, `commandRevision` (the revision the last command left), `sourceGen`, `preparing`, `dirty`, `failure`, `conflict`, and the queue (`tail`, `queued`, `writeQueued`). |
| One queue per character | `enqueue` (line 210) | Commands and edit write-backs run one at a time, in the order asked. |
| Edit write-back | `persist` (line 217), `writeBack` (line 231) | A context change queues one write-back; later edits join it until it starts. The context's whole form is written over `entry.revision`. `stale` marks `conflict`; a failure keeps `dirty` and records `failure`. |
| Base rule | `live` (line 134), `stillAsAsked` (line 255) | A caller's base is current anywhere from `commandRevision` to `revision`. On the queue, a command is refused if another command landed since it was asked. |
| Flush and settle | `flush` (line 189), `settle` (line 197), `drain` (line 204), `release` (line 172) | `flush` waits for the queue and for source preparations. `settle` drains the queue, rewrites unsaved changes and reports whether the library holds them. `release` drops the context only once it does. |
| Source commands | `setSource` (line 328), `requestSource` (line 338), `prepareSource` (line 264) | Every source change takes the next `sourceGen` when asked, is prepared off the queue (a save hashed), then on the queue gives way to any newer generation and commits. |
| Reflection | `requestSource` line 359 → [character-context-actions.ts](../../projects/xf-studio/authoring/src/character/character-context-actions.ts) `reflectSource` (line 1054) | After a committed source command, the context shows the source as one Undo step, unless a newer generation was asked meanwhile. |
| Context → service | `context` (line 150), `sources` port (lines 156–160); in the context, `ports.sources` (line 119), routed at lines 904, 940, 944, 951 and 1046 | Under a service, the context's source actions are sent as commands; it never changes its source by itself. |
| Undo of a source | context `historyApply` (line 401) → `moved` (service line 160) | History moves apply at once, so an Undo or Redo that shows another source only raises `sourceGen`. Its state reaches the library through the next write-back. |
| Preview leases | [choice-preview-owner.ts](../../projects/xf-studio/authoring/src/character/choice-preview-owner.ts) | One owner per character's preview device, one lease per requester. An ended lease forwards no work; the live turn is checked before and after each frame. |
| Prefetch places | [choice-prefetch.ts](../../projects/xf-studio/authoring/src/character/choice-prefetch.ts) `vacate` (line 222), `exhaust` (line 235) | One host job per requester. At most 8 run; a place belongs to the job object. The session's byte budget stops every job. |

The design-level problem 1c removes: context-local state and the saved document are two copies kept in step by hand (the queue, generations and reflection). The outbox makes the document's pending writes the one record, so the context never needs reconciling with a separate copy.

## Scenarios 1c's tests must cover

Each was reproduced in memory during the four review rounds of 1b. The ones already fixed have regression tests in [profiles-characters.test.ts](../../projects/xf-studio/authoring/tests/profiles-characters.test.ts) and [choice-prefetch.test.ts](../../projects/xf-studio/authoring/tests/choice-prefetch.test.ts). Those tests should be kept, or rewritten against the outbox with the same intent.

**Source changes and bases**
1. A source change is prepared (a save hashing) while a rename lands; the source change must not undo the rename.
2. The same, while a delete lands; the delete must not be undone.
3. A save is paused while hashing, and the masculine default is chosen meanwhile through the context. The newer choice must win in the document, the library and the context.
4. A source commit is held while a newer source is asked through the context. The newer one must win everywhere.
5. A context is opened while a source commit is in flight. Its queued publication must not write the earlier source over the command.

**Edits and write-backs**

6. An edit arrives while a command commits. It must be written after the command, over its revision, and `flush` must wait for both.
7. A write-back fails. The changes stay unsaved and are reported, never dropped. `release` refuses until they are in the library, and a later settle writes them.

**Still open; deferred to 1c**

8. Reflecting a committed source erases an edit made after it was asked.
9. A same-save no-op leaves the context and the document divergent: the command answers `ok` without changing the document, while the context keeps its own state.
10. A failed context source change disappears silently. The context never changed, but nothing tells the person why.
11. Reselecting the save already shown bypasses the source generation: the context re-applies it locally, so an older pending source change can still land after it.

**Catalogue and requesters** (fixed; keep the tests)

12. Closing one requester never ends a sibling's previews. A lease's late frame or render is refused and released.
13. Two characters' prefetch rows never supersede each other on the host. Nine or more requesters never run more than 8 jobs, and nothing is cancelled to admit them. A cancelled and recreated requester keeps its new place.
14. The session's byte budget, spent by one job, stops every job before its next batch.
15. A late catalogue answer, from a question asked before the body's answers were dropped, is neither kept nor allowed to clear the newer catalogue.
16. A disposed requester's reads are aborted. It publishes nothing late and releases its prefetch job on the host.
17. A searched row evicted with its pages is rebuilt; a kept page joins its row like a fresh one.
