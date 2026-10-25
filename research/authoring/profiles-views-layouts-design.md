# Profiles, views and layout tabs: design

**Status:** approved design. Phase 1, scene runtimes (phase 4a), and phase 2’s P2-i through P2-vi are built and merged ([experiment 044](../../experiments/044-profile-tabs/README.md)). Feature focus and U6's Choose routes are implemented. P2-iv's synthetic timing test could not start Chrome in the sandbox; timing, captures and independent reviews remain with the coordinator, as does P2-vii's real-data G4. The design was revised after independent reviews and the spikes ([Review changes](#review-changes)); the whole proposal is pre-beta work (§9). The [architecture contract](architecture-contract.md) governs throughout, and the backlog's [profiles entry](../backlog/README.md#profiles-and-multiple-vs-after-the-beta) records the product decisions this page builds on.

**What this page supersedes in the [view graph design](view-graph-design.md).** This page is the one contract for these topics:

- the Modules menu, module visibility and saved layouts (§4.2, §4.3, §4.5);
- the main view that can't be closed (§3.3 and the Close view row of §3.4);
- mirroring the main view into legacy workspace fields (§3.5 Downgrade, and the §6.4 risk row);
- the graph storing focus (§3.8);
- routing Undo by focus in a viewport (§3.6 "Which history Undo acts on", and the §6.5 deferral).

The rest of that page stays in force: nodes, linking, rendering, and View and lighting history.

Source paths are relative to `projects/xf-studio/authoring/src/` (the layout in `docs/source-layout-plan.md`); new modules are named by the folder they will join.

## Summary

- **Plain typed data.** Entity documents carry IDs and reference one another. Small typed services sit on top, each publishing a detached snapshot and a change notification:
  - a profile service and a subject registry;
  - one owner per subject kind (characters first);
  - the collection owner;
  - one profile-session owner covering tabs, the view graph and focus;
  - a focus service;
  - a pure binding resolver;
  - constraint rules.

  There is no reactive engine.
- **Nothing is "current".** No profile, session, tab or service holds a current, primary or default V, subject, look or view. Each panel and view resolves its own target through its binding. One tab can hold three panels on three different Vs.
- **Profiles are generic.** A profile holds subjects of any registered kind (characters now; NPCs, quests and locations later) and the collections it works on. It may hold none.
- **The only limits come from the game and the implementation,** each as a named rule ([Assumptions](#assumptions)).
- **Storage follows who needs a thing and how often it changes.**
  - *Library documents* hold what windows and profiles share. Related documents change together through owner commands (one transaction each), with explicit conflicts.
  - *The workspace* holds continuous presentation and an **outbox** of every mutation the library hasn't acknowledged yet. One window writes it at a time, and a takeover waits for the holder to release.

## Assumptions

These are the only invariants the model keeps. Each holds because the game or the Studio's implementation supplies it, and each is enforced as a rule or budget with a reason a person can read, never as a structural limit.

| Invariant | Source | Rule |
|---|---|---|
| A character has exactly one body gender at a time; the voice is separate | `player_wa_*` or `player_ma_*`; a save's `isMale` and `isBrainGenderMale` ([CC file chain §7, §9](../../knowledge/cc-file-chain.md#9-male-and-female-npcs-and-later-full-body-work)) | `character.body` is one of two values. Changing it is one command that clears choices the other body's catalogue lacks. |
| Each body gender has its own creator catalogue | One `.inkcharcustomization` per body gender ([CC file chain §2](../../knowledge/cc-file-chain.md#2-the-inkcharcustomization-resource)) | Choices are validated against `(installation, body)` |
| An option holds one choice at a time, by name, not index | [CC file chain §2](../../knowledge/cc-file-chain.md#identity-and-why-indices-are-not-identity) | Stored choices are `(option, definition)` or `(region, morph)`, one per option |
| A save holds one player character | One `CharacetrCustomization_Appearances` node ([CC file chain §7](../../knowledge/cc-file-chain.md#7-how-a-save-stores-cc-choices)) | A save is a source for one character; several characters may use it |
| An exported look is a creator choice, merged by name | ArchiveXL merges on `(option, definition name)` ([CC file chain §2](../../knowledge/cc-file-chain.md#identity-and-why-indices-are-not-identity)) | Export names are unique within the option (`src/character/creator-names.ts`) |
| Released builds keep reading the library | `user_version` ≤ 2, released tables never altered ([library durability](library-durability.md)) | New data only as `documents` rows |
| localStorage is synchronous and per origin; a Web Lock is released only when its holder releases it or its window ends | Browser storage and Web Locks | The outbox and session write synchronously, and the workspace lease follows §2.3 |
| One pointer: one gesture at a time | [View graph §3.8](view-graph-design.md#38-input-routing-and-focus) | A second open gesture is refused in every view |
| One GPU context per window, with frame, raster and residency budgets | [View graph §3.7](view-graph-design.md#37-rendering-and-performance); a resident subject costs about 0.47 GB VRAM head-only and 0.7–1.2 GB whole-body ([S2 §3](../../experiments/039-view-switch-spike/README.md#memory)) | Budgets: work beyond them waits and says why, and is never refused by the model (§4.5) |
| Scene runtimes on one renderer share its global state | Three's `WebGLRenderer` holds tone mapping, exposure, render target and shadow settings for every draw (S2 §5) | Each runtime's draw sets every renderer-level setting it relies on |
| A material's shader program links on its first draw, synchronously, unless compiled ahead | WebGL program linking; S2 measured a 94 s cold link on a fresh browser profile | A view or subject is prepared before it is drawn (§4.5) |

## 1. The entity model

### 1.1 Entities

| Entity | Fields | References | Owner | Stored | Scope |
|---|---|---|---|---|---|
| **Profile** | `id` (`p-<base36>`), `name`, `subjects: SubjectRef[]`, `collections: CollectionId[]`, `createdAt` | Subjects, collections | `ProfileService` (`src/app/profiles/`) | Document `profile` | Per library |
| **Subject reference** | `{ kind: SubjectKind, id }` | One subject document | n/a | In profiles and scenes | n/a |
| **Subject kind** | `kind`, `document`, `scenes: SceneKind[]`, `label(subject)`, its flyout actions | Its owner service | `compose/subjects.ts` (new) | Code | Per build |
| **Character** (kind `character`) | `id` (`c-<base36>`), `name?`, `body`, `voice?`, `source` (default, a save with `decoded: SavedVId`, or a preset with `kept?`), `choices`, `notCarried?`, `clothing?`, `ownMakeup?` | A save reference, a decoded save | `CharacterService` (`src/character/`) | Document `character` | Per library |
| **Save reference** | `{kind:"listed", folder, modified?}` or `{kind:"file", name}` | A game save | Saves host (`features/save-explorer/host/`) | In the character | n/a |
| **Decoded save** | `SavedV` as today | n/a | `CharacterService` | Document `saved-v`, ID = content hash | Per library |
| **Collection** | `xfs/collection-2` identity (`collection.id`), name, look order, `removed` (the last 20, each with when), package plan, `saved?: { revision }` | Its looks | `CollectionService` (`src/library/collection-service.ts`) | Working copy: document `collection-working`. Named versions: the released collection tables. | Per library |
| **Look** | Parts and memory (with its Undo history); `state: "live" \| "removed"` | n/a | `CollectionService` | Document `look-working`, ID `<collection>/<look>` | Per library |
| **Look reference** | `LookRef = { collection, look }` | One look | n/a | In scenes, bindings and actions | n/a |
| **Session** | `xfs/profile-session-1`: `tabs`, `views: ViewGraphData`, `focus`, `closed: TabFragment[]` (the last 5), `seq` | Its profile | `ProfileSessions` (`src/app/profiles/`, successor of `layout-library.ts`) | Workspace `profiles.sessions[profileId]` | Per profile, per workspace |
| **Layout tab** | `id` (`t-<base36>`), `name`, `origin?`, `dock: DockState`, `panels: PanelInstance[]` | Its views (each view's `tab`) | `ProfileSessions` | In the session | Per session |
| **Panel instance** | `id` (`<type>--<base36>`, never reused), `type`, `binding?`, `state?` | Its type, its binding's target | `ProfileSessions` | In the tab | Per tab |
| **Binding** | `{ policy: "follow-focus" }` or `{ policy: "pinned", target: { view } \| { scene } \| { subject } \| { look } }` | One entity | `resolveBinding` (pure) | In the panel instance | Per instance |
| **View** | `ViewRecord` plus `tab` | Scene, camera, lights, display and tools nodes | `ViewGraph` (`platform/core/view-graph.ts`), inside `ProfileSessions` | `session.views` | Per session |
| **Scene** | Display state (motion when the runtime split lands), `subject?`, `look?` (character scenes), `gen` (raised when its subject or look changes) | A subject, a look | `ViewGraph` | Graph node | Per session |
| **Camera, Lights, Display, Tools** | As in the [view graph](view-graph-design.md#31-node-types) | n/a | `ViewGraph` | Graph nodes | Per session |
| **Focus** | `views: Record<ViewId, number>` (focus sequence), `panel?`, `editing?: EditingContext` (§3.7) | Views, panels, a history scope | `FocusService` (`platform/core/focus.ts`) | In the session | Per session |
| **Outbox** | Pending owner commands: `{ id, seq, command, writes: { kind, id, base: number \| { after }, value \| tombstone }[], at, state, current? }`; per document at most one frozen (sent) entry and one open successor (§2.2) | Documents | `DocumentOwners` (`platform/core/saved-document.ts`) | Workspace keys `xfs.outbox.<workspace>.<kind>/<id>`, written synchronously, inside the workspace budget | Per workspace |
| **Receipt** | `{ command, revisions }` for a committed command ID | The documents it wrote | `DocumentStorePort.transact` | Document `xfs-receipt` | Per library; 7 days |
| **Studio module** | The manifest, plus `defaults: DefaultLayoutContribution[]` | Panel types, tools, defaults | `compose/modules.ts` | Code | Per build |
| **Panel type** | `PanelContribution` plus `owner` (§5), `context` (what it shows, §3.1), `stateInDefaults?` | Its module | `compose/views.ts` | Code | Per build |
| **Default layout** | `id`, `name`, `description`, `owner` (a module, `shared` or `user`), `fragment` | Panel types | Feature defaults: composition. Own defaults: `LayoutDefaults` (`src/app/profiles/`). | Code; own defaults as document `layout-default` | Per build; per library |

**Which look a V shows belongs to the scene, not the character.** Two scenes of one V can show two looks. Every view of one scene shows the same look, so a shared preset still updates every V wearing it.

### 1.2 Storage tiers

| Tier | Holds | Writes |
|---|---|---|
| Library documents (`documents` table) | Profiles, subjects, decoded saves, collection and look working copies, own defaults, migration records | Only through owner commands (§2.1), each one transaction checked against base revisions |
| Released library tables | Named collection versions (Save version) | Unchanged |
| Workspace (localStorage on localhost; on desktop, the host file and its localStorage mirror) | Sessions, UI preferences, the outbox | Synchronous, one writer (§2.3) |

### 1.3 Diagram

```mermaid
flowchart TB
  subgraph LIB["Library: library.sqlite, documents table"]
    P[Profile]
    SUB["Subject: Character (V) now; NPCs, quests, locations later"]
    SV[Decoded save]
    COL["Collection working copy"]
    LK["Look working copy"]
    UD["Own default layout"]
  end
  subgraph WS["Workspace: one writer at a time"]
    OB["Outbox: unacknowledged commands"]
    S[Session]
    T[Layout tab]
    CF["Closed-tab fragments"]
    PI[Panel instance]
    F[Focus]
    V[View]
    SC[Scene]
    N["Camera, lights, display, tools"]
  end
  subgraph CODE["Build: composition data"]
    M[Studio module]
    PT[Panel type]
    FD["Feature default layout"]
    SK[Subject kind]
  end
  GS[("Game save on disk")]
  P -->|subjects| SUB
  P -->|collections| COL
  COL --> LK
  SUB -->|"source: save reference"| GS
  SUB -->|decoded| SV
  SUB -.->|kind| SK
  OB -.->|"replayed into"| LIB
  S -->|"session of"| P
  S --> T
  S --> CF
  S --> F
  T --> PI
  T -->|"owns views"| V
  T -.->|"made from"| FD
  T -.->|"made from"| UD
  PI -->|type| PT
  PI -.->|"binding: view, scene, subject or look"| V
  F -.->|"focus order"| V
  V --> SC
  V --> N
  SC -->|subject| SUB
  SC -->|look| LK
  M -->|owns| PT
  M -->|contributes| FD
  M -->|registers| SK
```

### 1.4 References, deletion and retention

- **Structural references are always valid.** View nodes, tab views and fragment keys are kept valid by `ProfileSessions` in the same commit as any edit. Only references *across* owners may dangle (a scene's subject or look, a pin, a profile's members, a tab's origin). Each such case has a defined state (§3.4) and keeps the reference, so a restore brings it back.
- **IDs are never reused.** Views, scenes, tabs and panel instances get fresh random IDs.
- **Detach and delete are different actions:**

  | Action | Effect |
  |---|---|
  | Remove subject from profile | Membership only. The document stays, and scenes keep showing it. |
  | Delete subject | Names the profiles that reference it, then writes a tombstone; references show **Restore** |
  | Delete profile | Tombstone. Subjects are detached, and its sessions are dropped when each workspace next opens. |
  | Delete own default | Tombstone, with an Undo notice. Tabs made from it keep working. |
  | Remove look | One collection command (§2.1). The look joins `removed` and its working document becomes `state: "removed"`: not bindable, and scenes showing it say "Removed" with **Restore**. When it leaves `removed` (pushed out by the 21st removal, or after 30 days), the same command that drops it writes the tombstone. |

- **Tombstones and cleanup.** A tombstone is the next revision, `{ tombstone: true, at, value }`. The host purges tombstones older than 30 days at start, in one transaction. It also purges decoded saves no character references, the look documents of purged collections, and receipts older than 7 days.
- **Retention roots:** profiles, own defaults and collections. A subject that no profile references (an orphan) is kept until deleted, and is listed under **Add a V you've used before**.

## 2. Persistence

### 2.1 Owner commands, receipts and coherent snapshots

- **Owners write; nothing else does.** Related documents change only through their owner's commands, for example:
  - `collection.addLook`, `copyLook`, `removeLook`, `restoreLook`, `reorder` and `rename`;
  - `character.create` (character plus decoded save plus profile membership);
  - `profile.addSubject`.

  Single-document edits are one-write commands.
- **Each command is one host transaction.** `DocumentStorePort.transact({ id, command, writes, forget })` takes `writes` as `{ kind, id, base, value | tombstone }[]`. All writes commit, or none do and the answer is `stale` with the current revisions.
- **Commands are idempotent by `id`** ([spike rule A4](../../experiments/038-profiles-spikes/README.md#acknowledgement-and-rebasing-rules-s1-answering-sols-medium-point)).
  - The transaction also writes a **receipt**, a `documents` row of kind `xfs-receipt` holding the resulting revisions.
  - A command whose receipt exists is answered from it and never applied twice, so a committed command whose answer was lost comes back as the window's own write, not a conflict.
  - Receipts are deleted when a later command names them in `forget`, and purged after 7 days at host start (§1.4).
- **Equal-value fallback (A5).** A replay with no receipt whose bases no longer match, but whose every target already holds exactly the replayed value, is acknowledged at the current revisions.
- **One mechanism.** The migration record (`migration/profiles-1:<token>`, §8) is the same thing: a command ID whose stored result answers a replay.
- **Coherent snapshots.** Save version and export first flush the collection's outbox entries. They then read the collection working copy and every live look in **one read transaction** (`DocumentStorePort.snapshot(refs)`). Save version writes the released tables from that snapshot in the same host transaction, and export records the snapshot's revisions in its manifest.
- **The host thread never checkpoints.**
  - A committed look writes about 320 KB (about 80 WAL pages), so SQLite's default autocheckpoint (1,000 pages) would run on the host thread about every 12 commits, at 67–184 ms on a D:-like drive.
  - The library owner raises `wal_autocheckpoint` well above that (or sets it to 0), and the worker's flush, which already runs within 5 s, does the checkpointing ([library durability](library-durability.md#how)).
  - Phase 1 repeats the S1 latency run on the data drive.

### 2.2 Outbox, recovery and conflicts

**One sync mechanism (decided 21 October, after the phase 1b reviews).** The outbox is the only way any document's local state reaches the library: looks, characters, profiles and every later kind. A service's in-memory view of a document is its acknowledged value with its outbox entries applied on top. Nothing else may keep a separate queue or reflect committed state into a context by hand. Phase 1b's hand-built character queue showed why: across four review rounds, the context and the document kept drifting apart (`experiments/038-profiles-spikes/1b-handover.md`).

**Built in phase 1c-ii.**

- **Ownership.** Collections and looks are owned by `CollectionOwner` (owner commands) and `LookSessions` (keyed by `LookRef`), as `collection-working` and `look-working` documents. The old `CollectionService` folded into them in phase 1d-ii.
- **Snapshots.** `DocumentStore.read(refs)` is the one-transaction snapshot.
- **Save version.** It flushes, refuses if anything is in conflict or unsent, and then calls the host route `/api/collection-versions`, which writes the released tables from its own snapshot in the same transaction. The window records `saved` afterwards.
- **Retention.**
  - A removed look stays restorable while it is in the last 20 and under 30 days old.
  - The command that pushes a look out of that list writes its tombstone.
  - The 30-day expiry is a window command, `collection.expire`, never a host write.
  - A host background job, one minute after start and then daily, purges tombstones after 30 days and receipts after 7 days. It purges an unreferenced decoded save after a 30-day grace.
- **Checkpoints.** `wal_autocheckpoint` is 16,384 pages, with `journal_size_limit` at 64 MB, so the background flush does the checkpointing.
- **Recovery, after the 1c-ii reviews.**
  - **Recovery gate.** While a document still has a restored entry the library hasn't answered, new edits on it are refused. `own` only sets the baseline; successors keep the replayed command's revision.
  - **Owners stay current.** Any answer that changes what a document shows is announced to every owner, including the first read of an immutable document that brings its content. Owners opened during recovery stay consistent.
  - **Required content.** Immutable content a pending command needs is kept with it. The host checks `requires` inside the transaction and answers `missing`, which triggers a re-put. If no copy exists anywhere, the restoring notice offers **Import save…** or **Discard those changes**. Re-importing the V's own save is a plain upload that changes nothing else.
  - **A V without its save** records nothing and refuses changes until the save arrives.
  - **Send attempts** and required-document lookups have a 15 s deadline. Each is cancellable and resent under the same ID, and late answers are ignored. Commands on a document are sent strictly in order. Receipt answers carry the value the command committed.
  - **The restoring notice** (`t-recovering`): after 1 s the status bar's line says "Restoring changes from your last session…" (nothing moves). After 5 s the notice under the header opens and offers Try again, plus Use restored only where it is provably safe, otherwise Export. No timer ever unlocks edits.
  - **Limits.** The outbox refuses a command over 64 writes before recording it, so a collection is created with at most 63 looks. A look listed by a live collection is never purged. Snapshots and Save version refuse an incomplete collection. Keep mine on a collection reads its looks from the library first, then restores them or refuses, in one command.
  - **Accepted limit.** After a crash that loses pending host writes, a false conflict can still occur. It is shown to the person and never written over.

**Built in phase 1c-i.** The outbox, as built and tested:

- **Visible state.** It is computed: the acknowledged baseline with the remaining entries applied. Waiters move with their values. Each entry has a stamp, and repair keeps the newest copy and rewrites anything it changed.
- **Multi-document entries.** An entry is kept under every document's key. A receipt is forgotten only once every key that holds the entry has been stored without it. An acknowledgement supersedes earlier stored copies of its documents.
- **Removal markers.** They persist until every stale copy is gone. On desktop, they persist until the host's own copy (`OutboxStorage.durable()`) confirms it. A record that holds only markers is never treated as empty.
- **Immutable, content-addressed kinds** (`saved-v`). Each is written once by its own create-only command. Commands that name it wait until it is in the library (`requires`). No resolution ever removes it, and an identical write from another window counts as acknowledged.
- **Desktop protection.** A key is unprotected while its host write is pending. The warning shows only when a write failed or has waited more than 2 s. WebView copies are filed per launch, and a failed WebView write removes the older copy there.
- **Workspace-aware receipts (phase 1c-ii).** A receipt records the writing workspace and its lease generation. A replay answered from a receipt also names the documents whose every later revision came from that same workspace (`own`). The outbox takes those as its baseline and rebases successors onto them. Another workspace's write, or a receipt that was forgotten or purged, never counts as own.
- **Keep both** takes theirs first and then forks (rolling back if the fork fails), and a copy never inherits successors. A look's resolve runs a revision check first.
- **Gate.** The model-based specification test (`tests/document-outbox-model.test.ts`) checks the outbox against an independent reference across seeded random runs with kills, restarts, failures and a second window. It runs in CI.


**Every mutation goes through the outbox first.** That covers looks, collections, characters, profiles and defaults, so **every unacknowledged durable mutation is recoverable**. The rules are the ones S1 proved ([A1–A7](../../experiments/038-profiles-spikes/README.md#acknowledgement-and-rebasing-rules-s1-answering-sols-medium-point)):

- **An entry** is `{ id, seq, command, writes: { kind, id, base: number | { after: EntryId }, value | tombstone }[], at, state: "queued" | "conflict", current? }`. It is written synchronously before anything is sent.
- **A sent entry is frozen (A1).** From its first send, its ID, bases and values never change, and every resend reuses the ID.
- **One successor per document (A2).**
  - An edit coalesces into its document's newest entry only while that entry is unsent, or in conflict (where it updates "mine").
  - Behind a frozen entry, an edit opens one successor based on `{ after: <frozen ID> }`, and later edits coalesce into it. A document holds at most one frozen entry and one open one.
  - Multi-document commands never coalesce. They queue behind every earlier entry touching any of their documents.
- **Acknowledgement (A3).** The answer, fresh or from a receipt, removes the entry. Its revisions become the window's baseline, and every `{ after }` successor is rebased onto them, **all in one synchronous outbox write**. The command ID goes into the next command's `forget`.
- **Stale (A6).** A stale answer makes the entry a `conflict` holding the current revisions, and nothing retries.
  - Single-document successors fold into its "mine"; multi-document successors stay blocked.
  - **Use other window's** (keep "theirs") rebases later entries onto the stale base, so they go stale in turn and are never sent over theirs.
- **Conflict resolution.** The owning panel shows "Changed in another window", with **Keep mine** (an explicit command over the newer revisions), **Use other window's** (keep "theirs"; never labelled "Use theirs", which suggests another person) and, for looks, **Keep both** (mine becomes a fork, "(this window)"; Use other window's on a look keeps mine as a fork too).
  - **Each resolution is one outbox write.** S1 caught a two-write Keep both losing "mine" when killed between the writes.
  - **Stored conflicts are shown again after a restart.**
- **Replay at start** (or after a host restart) resends each queued entry under its own ID. Receipts and the equal-value fallback turn lost acknowledgements into the window's own writes. A real conflict follows A6. Nothing is merged or written silently over another writer.
- **Storage and budget.**
  - Each document's entries live under their own key, `xfs.outbox.<workspace>.<kind>/<id>`, so a commit rewrites only its own document's entries.
  - The outbox counts against the workspace storage budget (`WORKSPACE_STORAGE_BUDGET`). One look under edit is up to 160K UTF-16 units, at most two entries per document, and two more for every dirty look while the host is unreachable.
- **The outbox can fail to write** (quota, or a failed host-file write). Then the window shows a persistent warning that says what could happen, "Your latest changes couldn't be backed up on this computer. If XF Studio closes before your library has them, they could be lost." (style guide t-unprotected), with **Export collection** and **Try again**. It keeps sending to the library and lists unprotected changes in the close prompt. Edits are never blocked, and nothing claims to be safe that isn't. S1 verified this path.
- **External changes (A7).**
  - *Detection:* held documents' revisions are checked against the library every 10 s while visible, on window focus and after a host restart, with one `revisions(refs)` read. The read hits SQLite directly, so writes by another host process or a tool are seen.
  - *What counts:* a check **skips every document that has an outbox entry**. For a clean document, only a revision above the baseline A3 set counts as external, so a receipt replay never looks external.
  - *Effect:* the newer revision is applied and its history scope cleared ("Changed elsewhere; Undo starts here").
- **Optional: history chunks.** About 88 % of a look's autosave is its Undo history (141K of 160K units; around 580 MB of WAL writes an hour at one commit every 2 s). Splitting the look-level history into immutable, content-addressed chunk documents would cut that several-fold. It is done only if phase 1's data-drive run or the write volume calls for it.

### 2.3 Flush, close and one writer per workspace

- **Flush.** `DocumentOwners.flush(signal)` resolves once the outbox is empty, or reports what is pending, in conflict or failed.
- **Desktop close** (`desktop/workspace-close.ts`) acknowledges `saved` only after the workspace capture and an empty flush. Otherwise the "close anyway?" prompt names what is unsaved, and says whether the outbox holds it.
- **Localhost** (development only) relies on the synchronous outbox. That holds for a renderer crash, because `localStorage` lives in the browser process. A kill of the whole browser process tree loses writes still inside the browser's storage commit delay. Phase 1 measured this window at about 5 s for the first change, then about a minute (§9.2, phase 1 gates). While the host is up, the library holds each edit within milliseconds of its deferred store, so only edits made while the host is down depend on `localStorage` alone.
- **One writer per workspace (proposed default).**
  - A second window opens read-only: "This workspace is open in another window." It offers **Use it here**. Read-only windows refuse every dispatch with `unavailable` and write nothing.
- **Takeover happens only after release.**
  - The holder is asked to release. It stops accepting edits at once, drains its outbox (flushes), stops its timers and callbacks, writes the workspace a last time, then releases the lease and confirms.
  - If the holder doesn't answer, the new window waits: "Waiting for the other window to finish saving. Close the other window to continue." The lease moves only when the holder terminates (localhost: the browser releases its Web Lock `xfs.workspace.<key>`; desktop: the host sees its page end).
  - Taking over and Waiting show the library’s indeterminate progress in the notice’s existing height. Waiting offers **Cancel**: abort the adapter request, stop asking, and return to read-only with **Use it here**. A grant racing Cancel is returned without writing; desktop requests and cancellations carry their own ID, so a cancelled request cannot acquire later or cancel a retry. A failed takeover stays in flight until the host confirms its withdrawal; only then can a retry start.
  - There is no timed steal.
- **Built in phase 1a, with these details:**
  - **The desktop app is single-instance.** A second launch brings the running window forward and quits, so two host processes never share `workspace.json`.
  - **Release order.** A release first ends any open gesture or control edit, committed as one Undo step. Then it refuses edits, drains, makes the last workspace write, and releases.
  - **What stays available.** A read-only window still reads the library and keeps diagnostics. Its UI preferences work in memory, but are never written while it is read-only.
  - **Unsupported browsers fail closed.** Without Web Locks or BroadcastChannel, localhost opens read-only with one next step: use an up-to-date browser. It offers no takeover and writes no workspace or library changes. Other lease-startup failures also retain the write guard and show the disconnected notice with Reload as the retry step. These windows still show their stored session, or Eye makeup's factory arrangement in memory when no migrated session exists, without writing it. Only an unmigrated workspace held by another window shows the updating state and watches for that holder to finish migration. The desktop stream lease owns its host workspace file; it is not a fallback for browser-local storage.
  - **Workspace identity.** On localhost the workspace key is a per-browser ID. Fencing generations and the outbox keys use the same ID.
  - **Takeover restarts the page,** until scene runtimes (phase 4a) allow switching in place.
  - **Where the read-only message shows.** It is a full-width notice under the header (style-guide pattern `t-read-only-window`). Editing controls show as unavailable, with the reason.
- **Fencing at the host, as a backstop.** Every lease carries a generation. Document commands and desktop workspace writes carry it, and the host refuses an older generation. A late write from a released window can't land.
- **The lease and takeover are the one persistence piece the spikes didn't cover.** They are phase 1's first task, with their own small harness: two windows on each host, the holder killed mid-drain, a hung holder, and a late write after release refused by fencing.

### 2.4 Compatibility

- **Library: strictly backward-safe** under [library durability](library-durability.md). There are no new tables, no altered released tables, and `user_version` stays 2. Older builds see collections only through named versions.
- **Workspace and layout data: a documented reset on downgrade.** An older build drops `profiles` when it saves. It leaves the per-document outbox keys alone, and the next upgrade replays them under A1–A7. The legacy fields are frozen at the first migration and never mirrored, so an older build opens the workspace as it was before the upgrade. The next upgrade re-runs the migration (§8).
- **Required round trip: upgrade, then edit and save in an older build, then upgrade again.**
  - Library rows the newer build wrote are unchanged.
  - The older build's named save and its edited draft come back as forks beside the working copy.
  - Nothing is lost or duplicated.
- **Forward reading** is promised only for library documents: unknown fields are kept, and unknown kinds are ignored.

## 3. Bindings, focus and history

### 3.1 Panel context and action requirements

- **A panel type declares its context:** what it shows and edits, and what it can resolve from:
  - `profile`, with no binding;
  - `view`;
  - `scene`;
  - `subject`, with its kinds;
  - `look`;
  - plus `anchor.scenes`.

  Resolution yields a **partial context** `{ view?, scene?, subject?, look? }`.
- **Each action declares its own requirements** (`requires: ["scene"]`, `["look"]`), so a panel offers each action only where its context meets them. Examples:

  | Panel | Context from a view | Pinned to a look (no scene) | Empty |
  |---|---|---|---|
  | Presets | The scene and its look; choosing runs `scene.setLook` (needs `scene`); a scene without a look lists the profile's collections | Lists the look's collection; choosing re-pins the panel to the chosen look | **Choose…** |
  | Layers and the other eye-makeup editors | The scene's look | The look | **Choose…** |
  | Character | The scene's subject | n/a (pin to a subject instead) | **Choose…** |

### 3.2 Policies (data, extensible)

| Policy | Resolves to |
|---|---|
| `follow-focus` (default) | The eligible view in the panel's own tab with the highest focus sequence. Without one, nothing: the panel shows its empty state. There is no fallback to another tab or to any "current" subject. |
| `pinned` | The named view, scene, subject or look |

### 3.3 Focus, ordering and captures

- **Ordering.** Each pointer press or keyboard focus inside a view sets `focus.views[view] = ++seq`. The counter is never truncated, and there are no ties.
- **Eligibility.** The view exists, is in the panel's tab, has a scene kind in `anchor.scenes`, shows a subject of an accepted kind, and passes the constraint rules.
- **Shown targets.** The panel header names its target whenever any of these holds:
  - the tab has more than one candidate;
  - no view in the tab shows the target;
  - the binding is pinned.

  A panel never edits an unseen subject without saying which one.
- **Focus and navigation never enter Undo.** That covers focus moves, tab switches and camera navigation.
- **Captures freeze semantic targets.** A gesture, an open menu or popover, or an asynchronous picker takes `resolver.capture(instance, signal)`. The capture records:
  - the full chain it resolved: `{ view, scene, sceneGen, subject, look }`;
  - the revision of each library document it edits.

  At dispatch the owner validates that the view still references that scene, the scene's `gen` is unchanged, and the subject and look still exist. If any check fails, the dispatch is refused with `missing_target`, for example "This view now shows another V". A capture never edits a replacement. Aborting the signal releases the capture.

### 3.4 Empty and dangling states

- **Resolution** is pure and done while painting. The presentation repaints on changes from focus, the session, profiles, subjects or looks.
- **Empty states** (no candidate, or an empty substitution slot) show the profile's choices as target-named buttons, six before a searchable **Choose…**. One chooser per missing target: its owner offers the choices (Presets for a missing look), and other panels bound to the same missing target show a quiet line linking to that owner, revealing and focusing it. Phase 2 acts on the captured scene (`scene.setSubject`, `scene.setLook`) or opens a new view in the captured tab's 3D slot, falling back to the factory head slot, shown, drawn and focused; it creates no pins (experiment 044 D4). The full binding selector and pin-based routes come in phase 3. **Open a 3D view** offers the profile's subjects. A head pane's **Show which V?** uses c-setup's centred state layout.
- **Dangling pins** keep the pin and say what is missing, offering **Follow focus**, **Choose…** and, while a tombstone or removed look exists, **Restore**. The panel never retargets silently.

**Built in P2-vi (U6)** ([experiment 044 §14](../../experiments/044-profile-tabs/README.md#14-p2-vi-as-built)). The resolver's `empty` state preserves the partial target and the missing subject/look/view. `EmptyChoices` extends `c-empty`, with zero/one/several/overflow/read-only specimens. “Show which V?” lists profile Vs then both game defaults; “Show which look?” lists live profile looks or Create a look; “Open a 3D view” lists profile Vs or one Use the default V action when none exist. The presentation port's registered `empty.choose` request checks the captured panel, tab and complete target chain; focus changes keep the original scene, and a stale scene is refused with `missing_target`. Local owner commands publish immediately, before library acknowledgement; default-V creation returns its already-synchronous local result directly. The initial head loader leaves explicitly V-less scenes empty until chosen. No game, browser or GPU evidence was gathered in this chunk; captures and independent reviews remain with the coordinator.

### 3.5 Constraint rules

Constraint rules are data: `{ id, applies, check(context): Capability }`. The resolver and picker evaluate them at bind time, and owners evaluate them again at dispatch. Every [Assumptions](#assumptions) row is one. Feature rules include, for example, "eye-makeup editors need a look with an eye-makeup part". No rule caps counts.

### 3.6 Actions name their targets

| Family | Required target | Replaces |
|---|---|---|
| `camera.*`, `preview.*`, `motion.*`, `view.*`, `pose.*` | `view` (plus `sceneGen` when it edits the scene) | The focused-view default in `src/preview/preview-actions.ts` and `src/app/view-actions.ts` |
| `scene.setSubject`, `scene.setLook` | `scene`, `sceneGen` | The draft's `selected` look |
| `character.*`, `character.setSource` (absorbs `savedV.*`) | `character`, `base` revision | `CharacterContextActions` and `SavedAppearanceActions` |
| Eye makeup's `layer.*`, `point.*`, `field.*`, `preset.*`; `collection.*` | `look: LookRef` or `collection`, `base` revision | The one live document |
| `saves.*` | `instance` | The Save Explorer's one open save |
| `tabs.*`, `profile.*` | `profile`, `tab` | The layout library's active layout |
| `history.undo`, `history.redo` | `scope` | The history service's focused scope and its `look` fallback |

Key bindings and palette commands resolve targets in the input layer, then dispatch with them named. **No application service reads focus.** A boundary test lists the families still defaulting, and the list must be empty by the end of phase 1.

### 3.7 History routing

| Scope | Holds | Persisted |
|---|---|---|
| `look:<collection>/<look>` | One look's edits | With the look's working copy |
| `character:<id>` | Creator choices, Clothing and own makeup, in order (the Clothing setting's separate Undo is retired) | Session-only |
| `view:<profileId>` | View and lighting, and session structural operations (§4.1) | Session-only |
| `doc:<id>` | Unchanged | Unchanged |

- **The editing context decides.** `focus.editing` is the scope of the last *editing* interaction: an edit, gesture or control commit in a panel or view. Focusing History, the header, a menu or another tab doesn't change it.
- **Ctrl+Z, the header's Undo and the History panel** act on the editing context and name it ("Undo layer change on Look 3"). Ctrl+Z in a 3D view undoes the look its scene shows (decided).
- **The History panel** shows the editing context's scope, with a list of the other recent scopes to switch to. It can't target itself.
- **`history-service.ts`'s unqualified `look` scope and its fallback are removed.** With no editing context, Undo is unavailable, with the reason "Nothing to undo here yet".
- **External changes clear a scope** (§2.2).

**Built in phase 1e.**

- **Focus.** `FocusService` (`platform/core/focus.ts`) owns the view order, the focused panel and the editing context. The history service records into it, and the session stores and restores it. The view graph holds no focus. `HistoryService.acting(scopes)` picks the first scope that can act.
- **Targets.**
  - Every action family names its target (§3.6), and the action registry adds `look` to feature actions. `preset.select` became `scene.setLook`.
  - Scene-editing view actions name `scene` together with `sceneGen`.
  - The presentation port is the input layer: it fills targets the UI leaves out. `StudioApplication` validates every named target in one place and refuses a stale one with `missing_target`. Dispatch and captures share one currency check (`TargetResolver.check()` and `current()`).
  - Base revisions travel in captures, not on every immediate action.
  - View actions are routed to the scene runtime that holds the view they name (phase 4a-vi, §4.5): an action naming a view no runtime draws never reaches the shown one.
- **Resolution and captures.**
  - Resolution is pure (`app/profiles/bindings.ts`), and panel contributions declare their `context` (§5).
  - Context menus capture their targets when they open.
  - Gestures and continuous controls capture their look when they begin, and refuse to continue once the editor shows another look. An open gesture or control run is settled before the document shows other content.
  - File pickers name their target when they are asked.
- **History.** The View and lighting scope is `view:<profile>`. Undo acts only on the scope it names; with no editing context it reads "Nothing to undo here yet". The Undo and Redo tooltips and the History list say "Changes to <name>".
- **Session data** (§4.1). Reading a session validates tab IDs, instance IDs (duplicates are dropped), bindings, scene references and generations, and focus.
- **Boundary test.** It lists no family that still defaults a target. It also forbids reading focus below the input layer, naming `sceneGen` without `scene`, and naming the live feature in the root. The `liveSurface` row of §7 is built as `preview/browser/scene-editors.ts` (phase 4a-vi).
- **Deferred.**
  - The History panel's list of other recent scopes waits for a UI decision (phase 3).
  - `layout.set` gives way to phase 2's `tabs.*`.
  - Shell menus other than context menus get captures in phase 3.

## 4. Layouts

**Built in phase 2.** P2-i–P2-vi implement the session owner and shared history, contributed and own defaults, explicit substitution, tab-owned arrangements, per-view editing and panes, tab-derived feature focus and the captured Choose routes. The old module/layout controls are retired and their serialized preferences round-trip unchanged. Duplicate is data-only until phase 6; recorded panel/binding operations and several controllers per type remain phase 3. [Experiment 044 §8–§15](../../experiments/044-profile-tabs/README.md#15-p2-vii-as-built) records the implementation and G4 harness. **Real-data G4 results remain pending the coordinator's run.**

### 4.1 One owner for tabs, graph and focus

`ProfileSessions` changes tabs, the graph and focus only through operations. Each operation is one commit and, except for focus, one `view:<profileId>` step, so Undo can never put views into a missing tab.

| Operation | Effect, atomically |
|---|---|
| New tab from a default | Instantiates the fragment with explicit substitution (§4.2) |
| Duplicate tab | The tab's fragment with fresh IDs everywhere, scenes included. Sharing with the original happens only by explicit substitution (§4.2). |
| Close tab | Removes the tab, its views, the nodes only they used, its instances and their focus entries. It pushes a closed-tab fragment (tab, views, value copies of every referenced node, instances, bindings) onto `closed` (the last 5). |
| Reopen closed tab | Restores a fragment under its original IDs. Nodes still present are relinked; nodes gone are recreated from their copies. |
| Reset to default | Pushes the current content as a fragment ("<name> before reset"), then instantiates the default into the tab |
| Add or remove a panel; change a binding; add, close or link a view | One operation each |

Undo reverses all of an operation, including pushing or popping a fragment. A session may hold no view and no tab, and an empty session shows **New tab ▸**.

**Built in phase 2, P2-i** ([experiment 044 §8](../../experiments/044-profile-tabs/README.md#8-p2-i-as-built)).

- **One owner, one history.** `ProfileSessions` (`src/app/profiles/profile-sessions.ts`) replaced `ProfileSessionState`. It holds the `view:<profile>` scope over the graph's values and its own (the tab order, closed fragments and shown tab; each tab's name and origin; each tab's arrangement and instances). The graph records through it (`ViewGraphOwner`), so an operation and its graph edits are one step. An Undo or Redo is checked whole: every view is in a live tab, or nothing changes.
- **Never Undo:** focus with the shown tab, a tab's arrangement and the instances the dock makes there, and what a scene shows. A step holds a tab's arrangement and instances only when it makes, closes or resets the tab (experiment 044 D15). Add or remove a panel and change a binding become recorded operations with phase 3's picker and binding selector.
- **The graph** has no required main view and no `MAX_VIEWS`; views carry their tab, and new IDs come from the session. Reset keeps the tab and pushes its content as a `reset` fragment (D16). Closed fragments keep their views' and nodes' places and the views' focus numbers, so close then Reopen is byte-identical.
- **Actions:** `tabs.show`, `rename`, `move`, `close`, `reopen`, `duplicate` and `arrange` (Duplicate at the data level only until phase 6's menu entry).
- **P2-vi's first view:** `ProfileSessions.openView` adds a view in an existing tab from the contributed baseline, with fresh identities, the chosen subject and focus in one history step, even with no other view in the graph. U6 dispatches through its captured Choose request; Undo/Redo retain the session/graph invariants.
- **Settled before anyone hears; replays keep what Undo doesn't hold.** Notifications wait until an operation, Undo or Redo has settled, and each listener is isolated. A recorded tab operation makes `view:<profile>` the editing context. A tab or fragment an Undo or Redo brings in takes its arrangement, instances, scene targets and focus numbers from what it takes away. Since P2-iii any view may close, the drawn one included: the window draws another view of the shown tab, or none (§4.5).

### 4.2 Defaults are graph fragments

```ts
type LayoutFragment = {                                         // xfs/layout-fragment-1; every key is local
  tab: { name: string; dock: DockState };                       // dock panel IDs are panel keys; view panels are `view:<key>`
  subjects: { key: string; kinds: SubjectKind[] }[];            // slots, never actual subjects
  looks: { key: string }[];                                     // slots
  nodes: { key: string; slot: ViewSlot; kind?: string; state: Record<string, unknown>; subject?: string; look?: string }[];
  views: { key: string; title?: string; scene: string; camera: string; lights: string; display: string; tools: string }[];
  panels: { key: string; type: string; binding?: { policy: "follow-focus" } | { policy: "pinned"; view?: string; scene?: string; subject?: string; look?: string }; state?: unknown }[];
};
```

- **What a default keeps:**
  - the dock in both size classes;
  - panel types and bindings, with pins as local keys;
  - panel state, for types with `stateInDefaults`;
  - view titles and camera poses;
  - lights values, including the shown setup;
  - display and tools values;
  - **scene state** (eye shape, idle choice);
  - sharing within the fragment.
- **What it doesn't keep:** subjects and looks, which become slots, and links outside the tab, which are copied as values.
- **Instantiation makes fresh keys for every node, scenes included.** A scene starts from the fragment's saved scene state, and its subject and look slots are filled by **explicit substitution**:
  - **New tab ▸ <default>** asks, per subject slot, "Show which V?": the profile's subjects of that kind, or **Leave empty**.
  - It asks, per look slot, the profile's looks or **Leave empty**.
  - Per scene, it offers **Share the scene of ▸** (the session's existing scenes, with their subject and look), which replaces the fresh scene, along with its saved state.
  - A single candidate is named in the menu entry ("Eye makeup — V · ManualSave-12 · Look 3"), so one click fills it visibly.
- **Feature defaults** are code and read-only; a later build changes only new tabs and resets.
- **Own defaults.** **Save as default…** builds a fragment, replacing actual subjects and looks with slots. **Update "<name>"** overwrites only an own default. Saving over a feature default makes an own default.
- **Reset ▸** lists the origin first.

**Built in phase 2, P2-ii** ([experiment 044 §9](../../experiments/044-profile-tabs/README.md#9-p2-ii-as-built)).

- **The fragment** is the type above, with panel state only for types marked `stateInDefaults`. It is checked on read twice: its structure, then what the build has (panel types, view tools, node states through the graph's codecs).
- **Save as default** writes canonical keys. A fragment made into a tab and saved again is the same bytes, and the panels of views the tab no longer holds are left out.
- **Substitution is data** (candidates, what is chosen, `oneClick`), with decision M2 of experiment 044: a V another tab shows shares that scene, and its lighting, by default, and New scene sits beside it. A deleted V is never offered.
- **The modules' defaults** live in each module's `defaults.ts` and are checked at composition. They are Eye makeup (today's factory arrangement) and minimal Poses, Expressions and Save Explorer defaults, marked early access.
- **Own defaults** are owned by `LayoutDefaults`, through the outbox. A newer build's own default is listed as unavailable, with the reason. Names need not be unique; the list tells defaults apart by when each was saved. An open window finds another window's new defaults at its revision checks.
- **Nothing accepted can be lost on a restart:** a fragment is read back through the session's own readers before a tab is made from it.

**Presented in P2-iv** ([experiment 044 §12](../../experiments/044-profile-tabs/README.md#12-p2-iv-as-built)). New tab groups defaults by owner, names one-click substitutions and offers a trailing Delete with an Undo notice on own defaults. Ambiguous slots open the library's choice popover: visible radio options, searchable long look lists, M2's shared scene or New scene and a plain sharing note. Choices are checked again as candidates change; a removed choice falls back to Leave empty with a note. Rename and Save as default use the value popover. Own-default names may coincide (P2-ii review decision); equal names are told apart by saved time in the menu.

### 4.3 Feature focus from the tab

- **A module is active in a tab** when one of its panel instances is in the tab's dock. That set is the view-tool filter's `modules` (`platform/api/module.ts`).
- **Content still draws.** Makeup stays on V in a Poses tab.
- **P2-v removed the Modules menu and its live preference use.** The stored legacy `UIPreferences.modules` value is kept unchanged (§2.4).

**Built in phase 2, P2-v** ([experiment 044 §13](../../experiments/044-profile-tabs/README.md#13-p2-v-as-built)). The view-tool filter follows the shown tab's docked instances in the current size class, including floating and collapsed groups. Closed or merely retained instances activate nothing. Presets and Library are Eye makeup's contribution and factories, already included in its default in both size classes. Optional experiments receive the same tab-derived visibility. Panels lists open, collapsed and closed panels in this tab, with owner headings and a folded Coming soon submenu only under research tools. The header has neither Modules nor Layouts; its crumbs keep following the drawn look, and guidance uses `tabs.strip`. The module switches, palette commands, `modules.set` and the dock's old single-size Reset routes are gone. The legacy `modules`, `layout` and `layouts` fields round-trip without interpretation.

### 4.4 What folds in from today

| Today | Becomes | Kept |
|---|---|---|
| `LayoutLibrary` (`layout-library.ts`) | Own defaults, plus tab 1 | Saved layouts as own defaults; the live arrangement as tab 1 |
| `SavedLayout.working` (inactive), `modules`, `autoSize`, `seen`, `UIPreferences.modules` | Removed or derived | Dropped |
| Parked panels | A panel removed through the picker parks at its place | Per tab |
| Factory layouts (`studio-ui/layout-defaults.ts`) | Eye makeup's feature default, with one character subject slot and one look slot | The slot arrangement |
| View graph, `MAX_VIEWS = 16` | Inside the session; each view has a `tab`; the limit goes (the workspace size budget bounds it) | Nodes, links, lighting setups |
| `main` view, `head` panel | Ordinary views and instances. `main` and `head` survive only as aliases in capture tools and evidence keys ("the most recently focused 3D view in the visible tab"). | n/a |

**Built in P2-iv:** the Layouts button, its controller/library and the preference relay are retired. Dock saves already name the rendered tab; the session is their only destination. A tab with an empty arrangement opens no factory panels. The legacy `layout`, `layouts` and `modules` values remain unchanged in preferences.

### 4.5 Scene runtimes and switching (phase 4a)

S2 ([experiment 039](../../experiments/039-view-switch-spike/README.md)) found two things:

- views of one scene already switch within budget (7–19 ms);
- a V of another subject or body fails on today's path, which releases the WebGL context, reloads the head (1.3–2.2 s warm), shows a blank pane and drops a superseding request.

Phase 4a therefore splits the scene host into one **renderer device** per window (context, scheduler, canvas, input routing) and one **scene runtime** per scene (core head, rig, character renderer, feature renderers, lighting stage). Several runtimes are resident on the device, and one view is drawn at a time. Simultaneous drawn views come later, in 4b. The rules:

- **A scene draws only when a view shows it,** including while it is being built: a runtime is created hidden. The prototype drew 2 stray frames of a bare head.
- **Prepare before switching.** A view, or a tab's views, and a resident subject are prepared while hidden: rig programs compiled asynchronously, and textures uploaded. Until the target is ready, the switch keeps the previous view drawn with progress in place, and never blocks the main thread.
- **Residency is a budget.**
  - Each subject has a measured memory cost (head only about 0.47 GB VRAM and 0.7 GB GPU-process memory; whole body about 0.7–1.2 GB VRAM).
  - Resident runtimes are the shown subject plus at most one warm one (N = 1, a tunable budget). The least recently shown is evicted first.
  - Eviction and closing a subject are ordinary disposal that **returns its memory**, with a test. The prototype leaked about 220 MB of VRAM and 200 MB of heap per disposed runtime on a shared renderer.
- **Building a runtime takes an `AbortSignal`:** the core head, rig, motion and features, not only the detail load.
- **A subject or body change never drops the person's request.** It is a per-scene subject change that supersedes any earlier one, including a reload in progress. The previous V stays drawn, with progress, until the new one is ready. It replaces `reloadHead` and its `not_ready` refusal.
- **Camera input goes to the drawn view's camera node only,** never to every runtime on the canvas.
- **Each runtime's draw sets its own renderer state** ([Assumptions](#assumptions)).

**The two defects S2 found are closed by this phase:**

- *The body switch shows the wrong V and drops the request:* closed by the superseding subject change.
- *The first-draw shader-link freeze:* closed by preparing ahead.

Both were queued as beta blockers. Phase 4a is where they are fixed and gated, so phase 2's tabs never inherit them.

**Built in phase 4a** ([experiment 043](../../experiments/043-scene-runtimes/README.md) §7–§13; G3, the gate table on real data, comes before the merge):

- **One renderer device per window, a scene runtime per (scene, subject, body)**, built hidden with an `AbortSignal`, disposed without context loss (043 §7–§8).
- **Motion in the scene node** (043 §9). **Residency** is one owner (`preview/scene-residency.ts`): the newest want wins, the shown runtime plus one warm, least recently shown evicted first; `reloadHead` and its `not_ready` refusal are gone (043 §10).
- **Prepared before shown**, with typed progress in the head pane, programs linked on the driver's threads and paced, uploads gated on the GPU process, warm-ups in pieces, and no program that ANGLE builds again at its first draw (043 §11–§12; [WebGL program linking](../../knowledge/webgl-program-linking.md)).
- **View actions routed by the view they name** (`preview/view-routes.ts`, 043 §13). The application sends camera, preview and motion actions to the runtime holding the named view, and says how it holds it. Framing (Front view, Whole body, the creator cameras, the lens) needs a device drawing the view and is refused plainly (`not_ready`) otherwise; a restore, an orbit step, Back and Forward edit the view's camera node. Preview settings are checked against the head of the view's V, a warm one included, else against the stored ranges. Motion acts only for a view whose scene is on screen. `heads.show(view)` draws a view: the head of another view of the same scene is redrawn for it.
- **Editors per view** (`preview/browser/scene-editors.ts`): the runtime owner mounts the on-head editor on the head shown for the drawn view, naming that view's look; loaders are ready per V (a head shows the V the request names). UI-boundary exception 17 is gone.
- **The S2 gate table** runs on synthetic heads as `tests/webgl-scene-runtimes.test.ts` (T2), and on real data as `measure.ts` in experiment 043 (G2, G3).

**Built in phase 2, P2-iii** ([experiment 044 §10](../../experiments/044-profile-tabs/README.md#10-p2-iii-as-built)).

- **The drawn view follows the shown tab:** the window draws its most recently focused view, else its first, else none (`drawnView`, `profile-window.ts`), and follows it when another tab is shown, another view focused, or the drawn view closed. Drawing none keeps the head shown before warm. A runtime whose scene no longer exists goes once another is shown.
- **Per-view editing** (experiment 044 decision D3): one editor document follows the drawn view's look. Drawing a view of another look settles the on-head editor, lets the head on screen hold the layers it shows, and then switches the document, so the leaving head never shows the new look's layers; going back before the takeover reconnects it. 4a-vi's cross-look refusal and phase 2's drawn-view refusals are gone.
- **A warm runtime keeps its look's makeup:** its surface's hold is tagged with its look and tier, and the preview device takes it back when the document shows that look again, so a switch back rasters, uploads and composites nothing; the hold goes with its runtime, so the residency budget bounds it.
- **A 3D view panel per view** (P2-iii-b, [experiment 044 §11](../../experiments/044-profile-tabs/README.md#11-p2-iii-b-as-built)): each view of the shown tab has its own pane, `head` for the main view and `view.<id>` otherwise, made and withdrawn as the tab's views change; the catalogue knows them, so a saved arrangement places them. The one canvas is in the pane of the view whose picture it holds, and moves there when the drawn view takes over; the drawn view's pane shows its progress while the view drawn before keeps its picture; every other view shows the "not drawn" state (U7) and draws itself on Show here, a press, keyboard focus, Enter or Space. Moving the canvas links nothing and keeps the warm runtime.

## 5. Panel ownership

The owner groups are a module's label, **Shared**, **Output** or **Tools**.

| Panel (type ID) | Owner | Context | Default binding |
|---|---|---|---|
| Presets (`presets`) | Eye makeup | scene and look (§3.1) | follow-focus |
| Layers, UV map, Colour & finish, Shape, Pigment & edge, Warp | Eye makeup | look | follow-focus |
| Library (`library`) | Eye makeup (while it holds only eye-makeup collections) | look's collection | follow-focus |
| Expression, Expression sets (`expressions.*`) | Expressions | look | follow-focus |
| Poses (`poses.library`) | Poses | scene | follow-focus |
| Save Explorer (`save-explorer.explorer`) | Save Explorer | profile (its own instance state) | none |
| 3D view (`view.<id>`; `head` alias) | Shared | is a view; its scene's subject is chosen in its header | n/a |
| Character (`character`) | Shared | subject (`character`) | follow-focus |
| Camera & light, Preview quality (`lighting`, `quality`) | Shared | view | follow-focus |
| Motion (`motion`) | Shared | scene | follow-focus |
| History (`history`) | Shared | the editing context (§3.7) | none |
| Mod package (`package`) | Output | profile's collections | none |
| Activity, Settings, Help | Tools | profile | none |
| Panels (`shell.panels`, new) | Tools | its tab | none |

## 6. Presentation

**Workspace polish.** Taking over, Waiting and Restoring use the shared progress bar in reserved space; short restores stay in the status line, long restores use the workspace notice. An unsafe long restore explains “Your library hasn’t confirmed them yet.” before offering Export. Desktop backup warnings and Settings › Privacy & diagnostics offer **Show workspace file** for the host-owned workspace file (`workspace.showInFolder`, Files registry); browser workspaces omit the controls. The desktop host chooses the normal or verification file and accepts no caller-supplied path.

**Verification.** In `?verify=1`, `xfStudioPolish4.state(name)` selects a visual specimen: `older`, `taking-over`, `waiting`, `restore-short`, `restore-safe`, `restore-unsafe`, `unprotected`, or `normal` to reset. `workspaceFile(true/false)` toggles the visual desktop capability (no folder is opened); `defaults()` adds three same-named defaults, two within one minute. The existing `xfStudioAddView("Side view")` puts a renamed view beside the unnamed one. These are visual specimens, not lease simulations; the real adapter tests cover Cancel and grant races. The coordinator runs `bun tools/polish4-look.ts <output-folder-on-C> [port=4564]` from the authoring folder: it owns fresh data and processes, dismisses all popovers/menus and closes floating panels before each state, captures light/dark at 900/1600 px, and writes `review.html` with app/guide pairs. It has not been run in the implementation sandbox (no browser/GPU).

**Names in tab menus.** Reset to default uses the wide submenu (up to 560 px within the viewport), keeping full row names in tooltips. Same-named own defaults show date and minute; only those sharing that minute add seconds. Only unnamed 3D views count towards numbering within a tab; renamed views keep their own names.

**Built in phase 2.** U1–U9 are implemented: the layout tab strip and keys; tab commands; grouped New tab defaults; substitution and naming popovers; the three captured empty-state Choose routes; not-drawn view panes; and the tab-scoped Panels menu/header. The component library and generated style guide define these patterns ([044 §3](../../experiments/044-profile-tabs/README.md#3-ui-spec-list)). P2-i–P2-vi are accepted; the real-data G4 measurement remains the coordinator’s gate. The panel picker, binding selector, profile flyout and Duplicate UI below still belong to later phases.

The UI component track builds these. This section gives behaviour, states and accessibility only; aesthetics are the track's. Everything passes the [visual QA checklist](ui-visual-qa-checklist.md) and the UI review.

### 6.1 Layout tab strip (extends the Tab strip)

- **Place.** A full-width row between the header and the dock, replacing the Layouts button.
- **Behaviour.** Click switches tab, and `+` opens **New tab ▸**. Double-click or F2 renames, drag reorders, right-click or Shift+F10 opens the menu, and overflow uses the strip's condensing stages.
- **States.** Active, inactive, renaming, dragging, overflowing, read-only.
- **Accessibility.** `tablist` with `aria-selected` and `aria-controls`, roving tabindex, and the `tabs` key scope.

### 6.2 Tab menu

The menu has these entries:

- Rename;
- Duplicate tab;
- Reset to default ▸;
- Save as default…;
- Update "<own default>";
- Close tab;
- Reopen closed tab ▸ (newest first, "before reset" named so).

Names go in the value popover. Entries that can't run are left out.

**Own-default conflicts.** Own layout defaults have no panel section for a conflict notice. The writable window's `LayoutDefaults` therefore resolves them at once, including conflicts restored at startup: a local change or rename is kept as a new own default named with the preset Keep both suffix, “(this window)” (within the 60-character limit), while the original takes the other window's version. A local deletion takes the other window's edit without making a copy. Preservation is one atomic outbox Keep both operation (Use other window's for a deletion), so repeated checks and restarts cannot duplicate a copy or lose it between writes. One ordinary info toast says what was kept. Read-only windows leave resolution to the writable window.

**Starter shapes: the second kind of contributed defaults.** A feature that draws contours contributes several, read-only, as data in its own folder (eye makeup: Lid wash, Classic wing, Crease / smoky, Lower-lash smudge and Wing (original), placed from the plate's own landmarks, [knowledge](../../knowledge/face-makeup.md)); a person saves their own from any layer (**Save shape as starter…** in the layer's menu, a name of 1 to 60 characters in the value popover). The pattern is this section's: contributed ones are frozen and listed first under the feature's label, then **Yours**; own ones are library documents (`shape-starter`) written only by one owner (`app/starters/shape-starters.ts`) through the outbox, renamed, and deleted as a tombstone with Undo's restore; a conflict keeps both at once ("(this window)"). Which starter new layers and new looks use is a workspace choice (`features["eye-makeup"].defaultStarter`), changed only by **Use for new layers** (never by use); a missing or deleted one falls back to Lid wash. A starter applies only when a layer or look is created, so existing drafts are untouched. The menu beside Add layer has the New tab menu's layout (U3: pressing a row adds a layer, the star sets the default, a Default tag marks it) with a [Shape thumbnail](../../projects/xf-studio/authoring/src/studio-ui/components/shape-thumbnail.ts) on each row.

### 6.3 Substitution menu

**New tab ▸ <default>** and **Duplicate tab** show one compact step per slot: subject, look and "share scene". Each step defaults to **Leave empty**, or to the only candidate, named. The steps are keyboard-navigable, the slot is named in each step's accessible name, and Escape cancels without creating anything.

### 6.4 Panel picker (feature-specific component: a checklist panel)

- **Place.** A floating, dockable panel opened from the header's Panels button. It replaces the Panels flyout.
- **Content.** Search, then groups: the modules, then Shared, Output and Tools. Each row has a checkbox ("in this tab"), with **Add another** and a count for further instances. Ticking adds the panel at its remembered or factory place with its type's default binding. Unticking parks it. A row a rule refuses is disabled, with the reason. Planned modules sit in a folded "Coming soon" group.
- **Accessibility.** Groups with headings, native checkboxes. Search doesn't move focus. Escape clears the search, then returns focus to the invoker.

### 6.5 Header subject slot and profile flyout (replaces the Modules button)

- **The slot shows what the window is working on now, derived, not stored.**
  - Its source is the editing context's subject (else the focused panel's), labelled by its kind ("V · Save: ManualSave-12 · Look 3").
  - With neither, it shows the profile's name.
- **Flyout.**
  - The profile, with its subjects grouped by kind. A character offers **Load another save…**, **Load a save file…**, **Use the game's default V ▸** (feminine, masculine), **Explore its save** and **Show in the focused 3D view**.
  - **Add ▸**: a V from a save, a default V, or one used before.
  - Each subject's preparation state.
  - Profiles: switch, new, rename, duplicate, delete with Undo.
- **Accessibility.** `aria-haspopup="dialog"`, and the button's accessible name is the slot's text. A non-modal popover, and Escape returns focus.

### 6.6 Binding selector (panel header)

- **The target label** names the target whenever §3.3 requires it.
- **As a menu button** it offers **Follow focus**, **Pin to ▸** (views, scenes, subjects or looks of the right kind) and **Choose…**.
- **Accessibility.** Its accessible name includes the target and the policy.

### 6.7 Keyboard

| Keys | Scope | Action |
|---|---|---|
| Alt+1 … Alt+9 | global | Tab N (Alt+9: the last) |
| Alt+PageUp / Alt+PageDown | global | Previous or next tab |
| Arrows, Home, End, Alt+Shift+arrow, Delete, F2, Shift+F10 | `tabs` | As the dock's tab strips |
| Palette | n/a | "Tab: <name>", "New tab: <default>", "Reset tab to <default>", "Save tab as default…", "Reopen closed tab", "Show/Hide <panel> in this tab", "Panels…" |

Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+PageUp/PageDown are not used, because the browser keeps them on localhost. The bindings go into `KEY_BINDINGS` (`src/app/input-bindings.ts`).

**Built in P2-iv:** U1–U5 and the tab keys above are wired through the action registry and `KEY_BINDINGS`. The strip selects optimistically, uses roving focus and announces switches and reorders; Enter or Down enters the dock. Read-only pages can switch without saving, while editing controls retain their refusal reason. The palette offers Tab, New tab, Reset, Save as default, Close and Reopen; the panel picker commands wait for phase 3. The spec-fields golden was recaptured with unchanged states and its capture history appended. The synthetic Chrome timing test is written; this sandbox could not start Chrome, so its timing gate remains for the coordinator. Captures and independent UI review are also pending.

## 7. De-singletoning

| Singleton | Replacement | Migration steps |
|---|---|---|
| `CharacterContextActions` (`src/character/character-context-actions.ts`) | **`CreatorCatalogue`** shares only installation and body data: immutable panel data, pages, swatch and icon tables, and the search index, as keyed results deduplicated in flight. **Requester state** stays per character and per panel instance: rows, search state, prefetch wants and previews. Each request carries its full character request and runs on the job scheduler with requester-scoped cancellation. **`CharacterService`** holds one `CharacterContext` per `CharacterId`. | 1. Split out the immutable data and keyed results. 2. Move rows, search, prefetch and previews to requester objects. 3. Key the context by ID. 4. Move the three stacks onto `character:<id>`. 5. Read and write the document through commands. |
| `SavedAppearanceActions` (`src/character/saved-appearance-actions.ts`) | The character's `source` and decoded save. Applying them is the work of the subject's scene runtime. | 1. `character.setSource` replaces `savedV.*` (an alias until phase 1 ends). 2. `apply` and `clear` move per scene. 3. `workspace.savedV` becomes migration input only. |
| `src/app/workspace/collection-workspace.ts`' one live look | **`LookSessions`**, keyed by `LookRef`, opened on demand and released when unused | 1. Working copies and commands in the library. 2. Look actions name `LookRef`. 3. `look` becomes `look:<collection>/<look>`. 4. `selected` becomes each scene's `look`. 5. Rastering several looks is a budget until per-look raster jobs land (phase 5). |
| `src/compose/studio-startup.ts` `liveSurface` | The root registers every layered surface. The scene feeds its look's surface, and editor adapters bind per view to its resolved look. | 1. Move the `layered` wiring into a per-scene setup (phase 1, still one drawn view). 2. Editor hooks take the captured `LookRef`. 3. A boundary test forbids naming the live feature in the root. |
| The Save Explorer's one open save | One session per panel instance | `saves.*` actions carry `instance`; a session is released on close |
| `src/preview/preview-actions.ts`, `src/app/view-actions.ts`: the focused-view default | A required `view` (and `sceneGen`), resolved by the input layer and the panels | 1. `FocusService` takes focus over from the graph. 2. Panels pass captured targets. 3. Make `view` required, with a boundary test. |

## 8. Migration into the first profile

**Read-only before migration.** The migration resolves identities and creates library documents in a transaction; it is not a pure transformation of the stored workspace. A read-only window whose holder has not migrated therefore shows a centred head-pane-family state with no layout tab: “This workspace is open in an older XF Studio window. Reload that window, or choose Use it here above.” The notice bar alone offers **Use it here**, dispatching the lease action. The centred state has no button, its body uses a 320 px measure, and the tab-strip grid row collapses to zero height. It writes no migration or session; the holder still migrates for real. While pending, a browser storage event or the desktop workspace GET route supplies fresh stored text; the read-only page reloads only once that text parses as a migrated workspace with a valid session graph.

A **resumable, atomic protocol**, `profiles-1`, runs per workspace (the normal one and `?verify=1` separately), by the lease holder:

1. **Token.** The workspace synchronously records `{ id: "profiles-1", token, state: "started" }`.
2. **One library transaction** (`/api/profiles/migrate`) takes a normalized snapshot of the workspace. A record `migration/profiles-1:<token>` returns its stored result, so a resumed run duplicates nothing (the receipt mechanism of §2.1). Otherwise it runs these steps, the rules S3 proved ([M1–M6](../../experiments/038-profiles-spikes/README.md#migration-rules-s3)):
   1. **Collections and looks first.** Identity is `collections.collection.id`; `library.selected` is legacy preset selection and is not used.
      - **Compare through the part registry (M3).** Drafts, working copies and named-version rows are all read through the part registry before comparing. Released rows are stored in the oldest schema that holds them, so their raw JSON never matches a draft's.
      - **Content, not IDs.** Collections are compared by content: look names and parts in order, in canonical key order, IDs ignored.
      - **Compare against forks too (M2).** The draft is compared against the working copy **and every earlier fork of the same collection** (`origin`), so a re-upgrade whose draft was already brought back reuses that fork rather than making another.
      - **Fork whole collections (M2).** Identical content is reused. Divergent content forks the **whole collection**, "(from this browser)", with new collection and look IDs, and an **ID map** in the result covering every look.
      - **Newer named versions come back as forks (M3).** A named version newer than the working copy's `saved.revision` (or, with no working copy, newer than the draft's `library.current` revision) is brought back.
        - With no working copy, the working copy is made from it, and a different draft forks.
        - Otherwise it becomes a fork "(saved in an older version)", which joins the profile.
      - Nothing existing is overwritten. Which of two divergent drafts keeps the original ID depends on commit order, by design.
   2. **Subjects (M4).** The whole normalized character state (source and decoded hash, body, voice, choices, kept and not-carried entries, clothing, own makeup) is compared with existing characters. Decoded saves are compared by content hash. An equal character is reused; otherwise a new one is created, with its decoded save, through `character.create`.
   3. **Profile (M5).**
      - Prefer a profile that already holds this V and collection.
      - Otherwise: with none, create "My profile"; with exactly one, use it; with several, create "From this browser".
      - Add the members. Without the first rule, each re-upgrade with several profiles would make another "From this browser".
   4. **Own defaults** from saved layouts, deduplicated by name and dock hash.
   5. **Record** the result, including the ID map, under the token.
3. **Session.** The workspace builds tab 1 and the graph from the result:
   - tab 1 holds the live arrangement, with panel IDs rewritten to instance IDs;
   - views get `tab`;
   - scenes get `subject` and `look`, through the ID map.

   It sets `state: "done"` in one synchronous write.
4. **Resume.**
   - A crash before the commit re-runs with the same token.
   - A crash after the commit returns the stored result.
   - A crash before step 3 rebuilds the session.
   - Two hosts migrating at once serialize on the library's write lock: the second sees the first's working copies and reuses or forks.
5. **Downgrade and re-upgrade.** The older build edits its frozen draft, may save a named version, and drops `profiles`. The next upgrade migrates again with a new token. It gives back:
   - the edited working copy, unchanged;
   - a fork "(saved in an older version)";
   - a fork "(from this browser)";

   all in the one profile, with one V. A second round trip with nothing edited adds only its migration record (S3).

There is no post-migration layout recovery pass or take-over receipt. Neither `v0.1.0-alpha.1` nor `v0.1.0-alpha.2` contained the saved-layout library (its module, since removed); it arrived on 21 October, so only development builds from 22–24 October could save layouts after `profiles-1`, and the one real workspace checked has no `uiPreferences.layouts`. The original one-time import above is unchanged. Legacy `uiPreferences.layouts` is still parsed and left stored; it is never silently deleted or imported a second time.

**Upgrade from phase 1.** A completed `profiles-1` mark does not mean the first tab has phase-2 layout semantics. The phase-1 writer (`3d0dabfc`) stored one tab without `focus.tab`, and a null dock meant the factory arrangement. Before opening that session, preserve its existing live dock; if it has none, use `uiPreferences.layout`, then Eye makeup's contributed default with its origin recorded. Reuse existing panel instances and add enabled modules' panels without replacing the arrangement. Keep the session's graph, scene targets and focus, and leave the legacy preferences unchanged. This is a first-tab conversion, not another import of the saved-layout library.

Phase 2 always records the shown tab in `focus.tab`. A session already saved by the buggy phase-2 upgrade has that field, and its null dock with no origin cannot be distinguished from a tab emptied deliberately. Leave it unchanged; **Reset to default** recovers it. No released build contained phase 2, so these already-converted sessions are confined to the development installation. [CORE-240](code-health.md#resolved-upgrade-defect) records the regression and its offline coverage.

| Kept | May be dropped |
|---|---|
| The V's whole state; looks, drafts, recovery drafts, look histories; the view graph, lighting setups, camera, motion, pose; saved layouts as own defaults; the live arrangement as tab 1 with parked places; UI preferences | Inactive layouts' working states; `autoSize` and `seen`; module visibility; the Character panel's session Undo and the Save Explorer's open save (never stored) |

No schema migration: every record is a `documents` row, and `user_version` stays 2.

**Built in phase 1d-i.**

- **Where it runs.** The host transaction is `profiles-migrate.ts` (in `app/profiles/host/` on the phase-1 branch), at `/api/profiles/migrate` and its verification twin. It is fenced by the lease. `migration` is a host-only kind.
- **Pre-migration copy.** The library is copied before its first `profiles-1` run only, and the copy is discarded if that run rolls back.
- **IDs never reused.** An identity taken by a deleted collection is never reused: such a draft is recovered under fresh IDs.
- **Reuse is lossless.** It requires equal live content and matching histories, and every removed look the draft keeps must be restorable in the existing working copy. Otherwise the draft forks.
- **Forks and versions.**
  - Recovery drafts fork as "(earlier draft)" and don't join the profile.
  - A loose look becomes "My looks", with IDs derived from the workspace.
  - A named version brought back joins the profile whether it was created or found.
- **Snapshot digest.** Each request carries its snapshot's digest. If the result came from a different snapshot, or the workspace changed since capture, the page migrates again under a new token before `done`. That re-run may fork an edit made in that short window; nothing is lost.
- **Session build.**
  - Tab 1 is named after the active saved layout, and its origin is that layout's own default.
  - Panel IDs, parked places and `lastPlace` keys, groups and anchors are all rewritten to instance IDs.
  - Phase 1 allowed a null `dock` to mean the factory arrangement; the phase-2 conversion above makes that arrangement explicit. In phase 2, null means empty.
  - Own defaults are `layout-default` documents holding a graph fragment with slots `v1` and `look1`.
- **Start trigger.** `PROFILES_MIGRATION_ENABLED` is on since the phase 1d-ii switch-over: every start migrates (or resumes) before the Studio builds its session.

**Built in phase 1d-ii (the switch-over).** The Studio now runs on the profile services.

- **One collection owner.** The old `CollectionService` folded into `CollectionOwner` and `LookSessions`. The session is the source of the V and the look shown, and the V comes from its `CharacterService` owner.
- **Edits are recorded as they are made.** A look edit enters the outbox in memory at once, so reads, checks and conflicts see it. Writing it to recovery storage and sending it to the library wait up to 250 ms. A renderer crash inside that window can lose that last fraction of a second, which is within the data-durability rule. Another window's version met during that delay becomes a conflict, never a silent replacement. Whenever the outbox stops (release, lease loss, a superseded answer), it first stores what was waiting, then sends nothing more.
- **Conflicts.** A conflict on a look or a collection shows the `ConflictNotice` (`t-conflict`) in the Presets panel, with typed resolution requests. Save version, Check and Build wait until it is resolved.
- **Collections.** Removing the last preset keeps the collection, across a restart. A new collection created with its profile membership stays within the 64-write limit. Restore puts a look back where it stood.
- **History.** Each look has its own history scope, and the look shown is the editing context until something else is edited; there is no unqualified look scope and no fallback. Ctrl+Z in a 3D view undoes the look that view shows (§3.7). The V's own scope replaced the history carry between heads.
- **Save Explorer.** One session per panel instance; `saves.*` actions name their instance, and a released session ends with its panel.
- **Wording.** The header button reads **Save version**.
- **Gates.** A differential parity test replays each workspace fixture's scripted session before and after the switch-over, step by step. An edit-latency gate (16 layers, 80 Undo steps) keeps p95 under 4 ms. A start-to-restart test runs on a real-shaped workspace.

## 9. Phases

The whole proposal is pre-beta. The spikes have run, and the estimate below is the post-spike one. Every phase leaves `main` green and passes the UI review where anything visible changes. The multi-subject, multi-look and multi-view service tests (3 characters of both bodies, 3 looks, 5 views, 2 tabs; three Character panels pinned to three Vs) start in phase 1 and grow with each phase.

### 9.1 Spikes

| Spike (run 21 October) | Gates | Result | Consequence |
|---|---|---|---|
| **S1** Autosave of looks to the library, with the outbox ([experiment 038](../../experiments/038-profiles-spikes/README.md)) | Commit to acknowledgement p95 ≤ 250 ms; main-thread cost per edit ≤ 4 ms; renderer and host killed at 20 points each; two windows never overwrite silently; outbox-failure warning | **Pass.** p95 9.4 ms in the browser; about 1.4 ms of main-thread work (2.7 ms with a file outbox); 0 missing mutations across about 3,100 logged; 100 real conflicts became 100 forks | The write unit (one document per look) stands. The outbox rules A1–A7 and receipts are folded into §2.1–§2.2. To come in phase 1: a data-drive latency run, the autocheckpoint change, and a process-tree kill test. |
| **S2** Switching the drawn view ([experiment 039](../../experiments/039-view-switch-spike/README.md)) | Two views of one scene: ≤ 100 ms, no reload, stable programs. Two subjects: progress shown, cancel ≤ 100 ms, no late result, warm switch ≤ 100 ms within a memory budget. | **Fail, as designed.** Views of one scene pass once their rig has been drawn (7–19 ms). Subjects fail today: a 1.3–2.2 s reload, a blank pane, a dropped request. A resident-runtime prototype passes cancel (79.5 ms) and warm switches (2.6–17 ms), but drew stray frames and leaked memory on disposal. | Phase 4 splits: **4a, scene runtimes**, moves before phase 2 (§4.5); 4b stays. A per-subject residency budget is defined. |
| **S3** Migration crash harness (experiment 038) | Kills at every step; two hosts with identical and divergent drafts; downgrade and re-upgrade; released tables byte-identical; re-runs idempotent | **Pass.** 10 kill points in both variants, concurrent hosts, the downgrade round trip, all in 14 s | The protocol stands. Rules M1–M6 are folded into §8. |

### 9.2 Phases

| # | Phase | Scope | Gates | Effort |
|---|---|---|---|---|
| 0 | Spikes | S1–S3 | Done (§9.1) | 5 (spent) |
| 1 | **Core** | **First task:** the workspace lease, release-only takeover and host fencing, with its own harness (the one unspiked persistence piece, §2.3).<br>**Model:** the profile model and subject registry; `CharacterService` and the catalogue split; `CollectionService` commands, working copies and snapshots.<br>**Persistence:** the outbox (A1–A7), idempotent `transact` with receipts, revision checks, conflicts re-shown after restart, flush and close, the warning state, tombstones and cleanup; `wal_autocheckpoint` raised.<br>**Migration:** `profiles-1` (M1–M6).<br>**IDs and history:** explicit IDs and required targets; `FocusService`, captures and the resolver; editing-context history, with the `look` fallback removed.<br>**Data contracts:** session, tab, instance and binding data, with no tab UI.<br>**De-singletoning:** every singleton in §7, with one drawn view. | The lease harness passes.<br>Single-V workflows pass scene parity and the latency budgets.<br>The multi-subject service tests pass.<br>The no-default boundary test is empty.<br>The S1 and S3 harnesses run in CI.<br>The S1 latency run on the data drive stays within budget; it decides whether history chunks are split (§2.2).<br>A WebView or browser **process-tree kill** test measures the storage commit window. | 19–23 |
| 4a | **Scene runtimes** (before phase 2) | §4.5: the renderer device and per-scene runtimes; hidden creation with an `AbortSignal`; prepare before switching, with progress; residency (shown plus one warm) and leak-free disposal; the superseding subject change replacing `reloadHead`; input to the drawn view; per-runtime renderer state | The S2 harness in CI form:<br>• warm subject switch ≤ 100 ms;<br>• cancel ≤ 100 ms;<br>• no stray frames;<br>• no late result shown;<br>• a superseding body switch shows the last choice;<br>• no main-thread link stall on a first draw;<br>• closing a subject returns its memory (test). | 7–9 |
| 2 | **Tabs and contributed defaults** | `ProfileSessions` operations with history; fragments and substitution; feature defaults; Save as default; feature focus; tab strip, tab menu and substitution menu; **Choose…** routes; Modules menu and Layouts button removed | Close, Undo and reopen restore byte-identical sessions; fragment round trip; substitution with 0, 1 and 2 candidates; **tab switch within S2's budget, on 4a's runtimes** | 8–10 |
| 3 | **Binding selector, instances, picker, empty states** | The binding selector; several instances per type; the panel picker; every empty and dangling state | Three Presets instances on three scenes edit independently; stale captures refused; picker captures in light and dark, narrow and wide | 6–7 |
| 4b | **Simultaneous views** | Several drawn views: offscreen canvas and per-view blits, per-view frame budget and timing, linking UI | View graph P4 gates; two Vs of different bodies drawn at once within budget | 5–6 |
| 5 | **Several Vs and profiles in the UI** | Add and remove subjects, the full profile flyout, profile management, several looks rastered at once | Switching profile edits nothing; two Vs wearing one look update together; raster and residency memory within budget | 6–8 |
| 6 | **Polish lane** | Tab duplication, persistent reopen history, orphan listing, tombstone, receipt and decoded-save cleanup | Cleanup purges only what the retention rules allow; duplication shares nothing implicitly | 4–5 |
| — | **Pre-beta total** | Phases 0–6 | | **60–73** (55–68 still to do) |

**Phase 1 gates, as built (1f).** Every gate passes or has a recorded measurement. The table is `experiments/038-profiles-spikes/phase1-gates.md` (merged with phase 1).
- **In CI.** The lease harness and the S1 and S3 harnesses run in CI, with reduced counts; full runs stay available locally. `bun run check` typechecks the experiment.
- **Multi-subject test.** It runs the whole scale on the real services: 3 Vs of both bodies, 3 looks, 5 views, 2 tabs and three pinned Character panels. It found one bug: a view now keeps the tab it was stored in, so resolution never leaves the shown tab.
- **Latency gate, revised.** An edit enters the outbox in memory at once. Its write to recovery storage and its store to the library are deferred by up to 250 ms by design (1d-ii), so a renderer crash can lose at most that last 250 ms. The gate is therefore p95 from store request to acknowledgement ≤ 250 ms. On the data drive (D:), p95 is 2–3 ms in most runs, with a max of 52 ms when a background flush coincides. Edit to acknowledgement (p95 about 256 ms) is the expected deferred store, not a gate.
- **History chunks are not split** (§2.2). The write volume is about 167 KB a command: about 300 MB an hour at one command every 2 s. Revisit if a look's document grows well past the 16-layer, 80-step fixture, if several looks autosave at once (phase 5), or if a request on D: passes 100 ms.
- **Process-tree kill** (§2.3). Chrome commits `localStorage` about 5 s after the first change, then about once a minute; a whole-tree kill lost 1–35 s of browser-only writes. While the host is up, the library acknowledges each edit within milliseconds, so a tree kill loses only the last deferred store (about 250 ms) of a continuous edit. On desktop, every outbox key is also written to the host's outbox files at once. WebView2 itself isn't measured.
- **Undo.** `character.undo` and `character.redo` are retired: the Character panel uses `history.*` with `character:<id>`. A V's Undo waits while no context shows it (during a reload), and keeps its steps. A scope nothing names falls back to a general line. View and lighting changes never take the editing context.

- **Order:** 1, 4a, 2, 3, 4b, 5, 6. Phase 2's tab-switch gate waits for 4a.
- **Where to look first if it runs over:** phase 1's lease and fencing, the one unspiked persistence piece.

## 10. Decisions and open questions

**Decided (21 October):**

- Tabs per workspace.
- The shipped tabs are fine; good defaults will be supplied.
- Ctrl+Z in a 3D view undoes the look.
- The Clothing setting's separate Undo is retired.
- Generic subjects, and nothing current.
- The whole proposal is pre-beta, spikes first (run: §9.1).

**Also decided (21 October, confirmed with the go-ahead for phase 1):**

- One writer per workspace, with release-only takeover (§2.3).
- The library is strictly backward-safe; the workspace is reset on downgrade, and this is documented (§2.4).
- Explicit Save stays as **Save version** (Ctrl+S): a named point that older builds can read.
- Orphaned subjects are kept until explicitly deleted. Deleted items purge after 30 days.

## Review changes

**Round 1** (13 findings, 21 October):

- `LookRef` and library working copies;
- explicit conflicts;
- one writer per workspace;
- a migration protocol;
- one session owner with closed-tab fragments;
- no immortal `main`;
- unique instance IDs;
- deterministic focus;
- fragment defaults;
- deletion and retention;
- a documented downgrade reset;
- a narrower catalogue split;
- spikes and re-estimates.

Coordination added generic subjects, nothing current, and game-sourced [Assumptions](#assumptions).

**Round 2** (re-check, 21 October):

| Point | Change |
|---|---|
| Recovery covered only the last sent look values | An outbox of every unacknowledged owner command, newest values included, written synchronously; a defined failure warning (§2.2) |
| Migration could overwrite another host's working copies | In-transaction comparison of working copies: identical reused, divergent forked with an ID map; concurrent and downgrade tests in S3 (§8) |
| Related documents lacked atomic writes | Owner commands as one host transaction (`transact`); coherent snapshots for Save version and export; the removed-look lifecycle (§1.4, §2.1) |
| Timed takeover | Takeover only after acknowledged release or holder termination; host generation fencing as a backstop (§2.3) |
| Change feed ordering, cross-host writes | The feed replaced by periodic revision checks that read SQLite, with an acknowledgement baseline (§2.2) |
| Scene identity from subject | Fresh scene keys; sharing only by explicit **Share the scene of** substitution (§4.2) |
| Captures froze only the view | Captures hold the semantic chain plus `sceneGen` and document revisions, validated at dispatch (§3.3) |
| Panel context and action needs conflated | Partial contexts and per-action requirements; **Choose…** routes ship with phase 2 (§3.1, §3.4) |
| History routing circular | Editing context; the `look` fallback removed; focus and navigation never recorded (§3.7) |
| Data contracts late; runtime gates thin | Session, tab and binding data in phase 1; S2 gates for different subjects, bodies, cancellation and late results (§9) |
| Supersession too narrow | Superseded view-graph passages listed at the top |
| Scope | The whole proposal is pre-beta, in the maintainer's order |

**Round 3** (the spikes, 21 October; [experiment 038](../../experiments/038-profiles-spikes/README.md), [experiment 039](../../experiments/039-view-switch-spike/README.md)):

| Item | Change |
|---|---|
| Outbox rules | A sent entry is frozen; one successor per document; acknowledgement removes the entry and rebases its successor in one synchronous write; stale becomes conflict; revision checks skip documents with outbox entries (§2.2) |
| Commands | `transact` takes command IDs; receipts are `documents` rows purged after 7 days; the equal-value fallback; one mechanism with the migration record (§2.1, §1.4) |
| Conflicts | Each resolution is one outbox write; stored conflicts are shown again after a restart (§2.2) |
| Outbox storage | One key per document, counted in the workspace budget (§1.1, §2.2) |
| SQLite checkpoints | `wal_autocheckpoint` raised so the worker's flush checkpoints; a data-drive latency run in phase 1 (§2.1) |
| History chunks | Optional; decided by the data-drive run (§2.2) |
| Process-tree kill | Phase 1 measures a WebView or browser process-tree kill (§2.3, §9.2) |
| Migration | Compare through the part registry, against forks too; fork whole collections; newer named versions return as their own fork; prefer an existing profile (§8) |
| S2 | Phase 4 split into 4a (before phase 2) and 4b. New rules: no drawing while hidden, prepare before switching, residency budget and memory returned, `AbortSignal` on runtime creation, a superseding subject change, input to the drawn view, per-runtime renderer state (§4.5). The two S2 defects (wrong V and a dropped request on a body switch; the first-draw link freeze) close in 4a. |
| Lease and takeover | Flagged as phase 1's first task, with its own harness (§2.3) |
| Estimates | Phase 1 is 19–23; 4a is 7–9; 4b is 5–6; the pre-beta total is 60–73 (§9.2) |
| Assumptions | Added: the residency budget, renderer state shared between runtimes, and synchronous program linking |

## Related pages

- [View graph design](view-graph-design.md) (superseded passages listed above)
- [Architecture contract](architecture-contract.md) and [presentation boundary](ui-architecture-boundary.md)
- [Library durability](library-durability.md)
- [CC file chain](../../knowledge/cc-file-chain.md): the game invariants in [Assumptions](#assumptions)
- [Feature-module platform](feature-module-platform.md) and [component library](ui-component-library.md)
- [Save editor design](../save/save-editor-design.md), [selectors design](selectors-design.md) and [input bindings](input-bindings.md)
