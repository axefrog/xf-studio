# Experiment 038: profiles persistence spikes (S1, S3)

Spikes S1 (autosave of looks through the outbox) and S3 (the `profiles-1` migration crash harness) from the [profiles, views and layouts design §9.1](../../research/authoring/profiles-views-layouts-design.md#91-spikes), run on 21 October 2026 against `main` at `385f3406`. S2 (switching the drawn view) is a separate spike and not covered here.

The prototype is evidence code: nothing here is wired into the Studio. It reuses the real library owner (`LibraryDatabase` with WAL, `synchronous=NORMAL` and the durability flush), the real `documents` table and migrations, the vendored 0.1.0-alpha.2 opening sequence, the real part registry and the real authoring core.

## Results

Environment: Windows 11, Bun 1.4.2 (SQLite 3.53.2), scratch library on the C: NVMe drive. The browser runs used Chromium 152 (the Claude desktop browser pane, in a background tab).

### S1: autosave of looks to the library, through the outbox

| Gate | Result | Numbers |
|---|---|---|
| Commit to acknowledgement, p95 ≤ 250 ms | **PASS** | Browser (localStorage outbox, `fetch`): p95 **9.4 ms** at a person's cadence (p50 6.1, max 26.5), 7.6 ms under Undo-spam stress. Bun window (file outbox): p95 5.1 ms and 5.7 ms. |
| Main-thread cost per committed edit ≤ 4 ms, outbox write included | **PASS** | Browser `commit` (value fields, coalescing, `JSON.stringify` of the outbox, `localStorage.setItem`): p95 **0.9 ms** (max 1.7). Building the look's value from the live core (`minimalLook` plus `writeMemory` with the look-level history): p95 0.51 ms. Total about **1.4 ms**. With a synchronously written file as the outbox (the desktop host file's stand-in): 2.2 + 0.5 = 2.7 ms. |
| Renderer killed at 20 points | **PASS** | 16 protocol points (after the outbox write, in flight, answer received but not yet recorded, after the acknowledgement; each at the 3rd, 8th, 15th and 23rd occurrence) plus 4 timed kills. 597 mutations logged, 0 missing at any restart, 0 false conflicts, 10 lost acknowledgements replayed through receipts, `integrity_check` ok. |
| Host killed at 20 points | **PASS** | 10 kills inside the transaction before commit and 10 after commit before the answer. 1,304 mutations logged, 0 missing, 0 false conflicts, 10 receipt replays, `integrity_check` ok. |
| Two-window scripts never overwrite silently | **PASS** | Two windows edit one look while both renderers and the host are killed (15 kills). 1,263 mutations and 577 commits were checked: 0 revisions lowered another window's sequence number, 100 real conflicts became 100 forks, and 0 mutations were missing. |
| Forced outbox-write failure shows the warning | **PASS** | The edit applies and is still sent, the window is `unprotected` and lists the document, and the warning clears on the next successful write (`tests/s1-rules.test.ts`). |
| Sol's Medium point: lost acknowledgement, and edits coalesced during an in-flight command | **PASS** | A committed command whose answer is lost is acknowledged as the window's own write, by receipt (unit tests, and 20 replays in the kill runs) or, once the receipt is purged, by its identical value. Edits made while a command is in flight go into one successor entry, which is rebased onto the acknowledged revision (unit tests). |

The spike's numbers above came from its prototype window and host (the Bun window, and a browser bench page removed in phase 1f; both at `94504437` and before). The [phase 1 gates](#phase-1-gates-chunk-1f) repeat the timing on the production code. The look used is the largest a look gets: the large workspace fixture's selected look with 16 layers and a full 80-step Undo history (`HISTORY_LIMIT`), 159,875 UTF-16 units as the library would store it. The preset is 18,710 units and the look-level history 141,144. A 4-layer look is 116,208 units. The 2K reference recipe's input is local and not in the repository. Its cost on this path depends only on the document's size: its 2K raster runs in a worker and isn't on the commit path. So the largest realistic document stands in for it.

### S3: migration crash harness

| Gate | Result | Numbers |
|---|---|---|
| Kill at every protocol step | **PASS** | 10 points, each in both variants: inside the library transaction after collections, subjects, profile, defaults and record; after commit before the answer; and in the workspace after the token, after sending, after the answer and after `done`. Every run recovered after one restart and matched the unkilled outcome. |
| Two hosts migrating concurrently, identical drafts | **PASS** | 1 profile ("My profile": 1 V, 1 collection), 1 character, 1 decoded save, 1 working copy (3 looks), 2 own defaults. Both sessions resolve to their own look. |
| Two hosts, divergent drafts | **PASS** | 1 profile with 1 V and 2 collections: the working copy and one fork "(from this browser)". The V isn't duplicated. Both sessions resolve through the ID map to their own draft's look content, whichever host committed first. |
| Released tables byte-identical | **PASS** | DDL and every row of the seven released tables hash the same before and after every migration run. |
| Re-runs idempotent | **PASS** | A finished workspace does nothing. A workspace that lost its session after the commit gets the stored result back, the `documents` table is byte-identical, and the rebuilt session is identical. |
| Downgrade, then re-upgrade | **PASS** | The newer build edits the working copy. The older build, through 0.1.0-alpha.2's own opening sequence, saves a named version and edits its draft. The re-upgrade then gives the edited working copy unchanged, plus a fork "(saved in an older version)" and a fork "(from this browser)", all in the one profile, with 1 V and 2 defaults. Rows the newer build wrote are unchanged. A second round trip with nothing edited adds only its migration record. |

The whole S3 harness takes 14 s.

### What the harnesses caught

- **Keep both made two outbox writes.** The first two-window run lost one mutation. "Keep both" first dropped the conflict (one outbox write), then recorded the fork (a second), and a kill between them lost "mine". Each conflict resolution is now one outbox write.
- **Stored conflicts weren't shown again.** A conflict recorded before a restart came back with nothing to show it. Stored conflicts are now re-raised on open.
- **The comparison depended on the commit order.** Which of two divergent drafts keeps the original collection ID depends on which host commits first. That is correct behaviour. The harness's own comparison first assumed a fixed winner.
- **A fork of a named version was left out of the profile.** The first downgrade run showed it; the fork now joins the profile.

## Harness design

```
experiments/038-profiles-spikes/
  prototype/host.ts        SpikeHost: idempotent owner commands over LibraryDatabase (receipts, revision check)
  prototype/window.ts      SpikeWindow: outbox, acknowledgement and rebasing rules A1–A7, conflicts
  prototype/storage.ts     Outbox storages: memory (forced failure), file (atomic rename)
  prototype/migration.ts   profiles-1 library transaction, rules M1–M6
  harness/host-server.ts   Host process: real library owner over HTTP; self-kill at named points (XFS_KILL)
  harness/window-proc.ts   Renderer process: scripted edits with sequence numbers; self-kill at named points
  harness/migrator-proc.ts Workspace side of the migration (token, request, session, done); self-kill points
  tools/s1-kill.ts         S1 kill harness (renderer, host, two windows)
  tools/s1-latency.ts      S1 timing gates on the production code, on a library in any folder (phase 1f)
  tools/storage-tree-kill.ts  The browser's storage commit window under a process-tree kill (phase 1f)
  tools/look-fixture.ts    The look fixture through the real core, and its build cost
  tools/s3-kill.ts         S3 crash harness and round trip
  tools/s3-migration.ts    S3 sweep on the production migration (chunk 1d-i): hosts and pages really killed
  harness/s3-migration-host.ts, harness/s3-migration-page.ts  its host and workspace processes
  tests/s1-rules.test.ts   The acknowledgement rules, lost acknowledgements, coalescing, conflicts, outbox failure
```

The workspace lease harness has its own section below.

- **Kills are real process terminations** (`TerminateProcess` through `process.kill(pid, "SIGKILL")`). Protocol-point kills are the process killing itself at a named point. Timed kills come from the parent. The host's in-transaction kills leave SQLite to roll back from the WAL on the next open.
- **Presence check.** Every edit's value carries `seqs[<window>]`. The window prints `rec` after each synchronous outbox write and `ack` after each acknowledgement is recorded. At every restart and at the end, each logged sequence number must be in the library, in the document or a fork of it, or in that window's outbox.
- **Silent overwrite check.** The host appends every committed write to a log with its revision and `seqs`. Across a document's revisions, no window's sequence number may go down. Only an explicit **Keep mine** may lower it, and the script never chooses it. The script's person always picks **Keep both** 10 ms after a conflict.
- **What stood in for the renderer.** The kill harness's renderer is a Bun process with an outbox file written atomically by rename. That models a renderer crash, which `localStorage` survives in a browser. A kill of a whole browser process tree is measured separately, in a real Chrome ([phase 1 gates](#phase-1-gates-chunk-1f)).
- **S3 fixtures.** The library is written by 0.1.0-alpha.2's own statements: looks, part presets, a set, and the experiment 005 collection at revision 1. It is then opened by this build. The workspace is today's shape, normalized: the draft of that collection with a look added, `library.current` at revision 1, one V (save source, decoded save, body, voice, choices, clothing) and two saved layouts. The divergent variant renames a look. Outcomes are compared without generated IDs and without depending on which host went first.

Reproduce, each run under `tools/memory_guard.py --limit 4` (all runs peaked below 1 GB):

```
bun test tests
bun tools/look-fixture.ts <scratch>/fixtures 16
bun tools/s1-latency.ts <library-dir> <outbox-dir> <scratch>/fixtures/look-16x80.json
bun tools/storage-tree-kill.ts <scratch>/kill
bun tools/s1-kill.ts <scratch>/s1 <scratch>/fixtures/look-16x80.json
bun tools/s3-kill.ts <scratch>/s3
```

## Workspace lease harness (phase 1, chunk 1a)

The one persistence piece the spikes didn't cover: one writer per workspace, takeover only after release, and fencing at the host ([design §2.3](../../research/authoring/profiles-views-layouts-design.md#23-flush-close-and-one-writer-per-workspace)). Unlike the spikes, this is product code: `src/app/workspace/workspace-lease.ts` (the phases and the controller, injected clock), `src/app/workspace/leased-documents.ts` (the document gate and its drain), `src/app/browser/workspace-lease-device.ts` (the Web Locks and `BroadcastChannel` adapter, and the desktop stream adapter), `desktop/workspace-lease-host.ts` (the desktop host's lease and its workspace-write fence) and the generations in the library (`DocumentStore.nextLease`, `documents` rows of kind `xfs-workspace-lease`). The harness drives them:

```
harness/lease-page.ts          One window: the real lease, document gate and holder, editing while it holds the workspace
harness/lease-desktop-page.ts  A desktop page as a process, on the real desktop server (killing it ends its lease stream)
harness/lease-browser-page.ts  A localhost window as a worker, on the real library routes
harness/web-locks-model.ts     The browser's Web Locks (exclusive mode) for the worker windows, and the windows' proxy
tools/lease-harness.ts         The scenarios on both hosts; tests/lease-harness.test.ts runs them
```

Each window edits one document through the production outbox (a save every 15 ms, or every 1 ms where a write must be in flight) and writes its workspace every fourth edit, with a marker; a release drains the outbox. Results (21 October 2026; 34 checks in about 16 s, peak 0.8 GB), all **PASS**:

| Scenario | Checks |
|---|---|
| Two windows | The second opens read-only; its dispatch is refused with `unavailable` and a save it tries never reaches the host. Use it here: the holder drains, writes its workspace last and releases, then the new window is granted (desktop 10–17 ms, localhost 3 ms after asking). Every save the holder acknowledged, and its last workspace, are stored. A late write from the released window, sent past its own gate over the current revision, is refused as `superseded` (document and desktop workspace). |
| Holder killed while draining | Killed with a save in flight; the waiting window is granted when the holder's window ends (desktop 17 ms, through the end of its stream). Every acknowledged save survives, and nothing from the killed holder lands after the grant. |
| Hung holder | The holder never answers. After the 0.5 s grace the waiting window says "Waiting for the other window to finish saving. Close it to continue.", and 3.5 s later the host (or the browser) still has the hung window as holder: nothing is taken by time. Once the hung window ends, the waiting window is granted. |
| Release that can't save | The holder's last workspace write fails: nothing is released, the holder keeps the workspace and says so, and the other window keeps waiting. Try again, once writes work, stores the last write and hands over. |
| Document write failed while draining | A document write fails in transit during the drain: nothing is handed over. The document stays unsaved, and Try again writes it again before handing over; the stored document is the holder's last edit. |
| Release answer lost (desktop) | The host acts on the release but its answer is lost: the page goes `reconciling` (read-only), asks the host who holds the workspace, and settles as read-only; it is never writable after the other page's grant. |
| Release still in flight when checked (desktop) | The release's answer is lost before the host has even processed it. The status check settles that release operation as never applied (voided) in the same step, so the page keeps the lease; when the release finally arrives it is refused (409), the holder is unchanged and the other page isn't granted. Try again then hands over. |
| Late cancellation after a retried takeover (desktop) | A takeover's answer is lost and its cancellation is delayed past a retry: the cancellation names its own request and removes only that one, so the retried takeover is still queued and is granted. |
| Write stalled across a handover (desktop) | A write passes the fence on arrival, its body stalls, the lease moves, and the body then arrives: refused at the save (409), the workspace unchanged. |
| Host stream ended (desktop) | The page becomes `disconnected` at once, says so plainly, and sends nothing more. |
| No lease generation (localhost) | The host refuses to issue one: the window never becomes writable and lets the Web Lock go. |
| Takeover retried (localhost) | A takeover that gets no generation returns to read-only and withdraws its request; a second takeover succeeds. |

What stands in for what: on desktop everything is real but the WebView (a Bun process per page, on the real server and routes). On localhost the host routes, the `BroadcastChannel` and the page code are real; the Web Locks are a model of the standard's exclusive mode, held by the harness as the browser, and `localStorage` is a value it keeps (a window without the lease never wrote it). The real browser path was also run once in headless Chrome (the UI captures below): a second tab opened read-only, and Use it here took the workspace over and restarted as the holder, in light and dark. The process-tree kill that measures the storage commit window (§2.3) is a separate phase 1 gate and not part of this harness.

A release first ends any open pointer gesture or slider drag, committed as one Undo step, before it refuses edits and drains; the authoring unit tests cover that case (`tests/workspace-lease.test.ts`), since it lives in the application, not the transport.

Reproduce: `bun tools/lease-harness.ts <scratch>`, or `bun test tests/lease-harness.test.ts`, under `tools/memory_guard.py --limit 3`.

## The outbox in production (phase 1, chunk 1c-i)

The S1 prototype became product code: the outbox (`src/platform/core/document-outbox.ts`, rules A1–A7 below), idempotent `transact` with receipts on the host (`DocumentStore.transact`, routes `/api/documents/transact`, `/revisions` and `/read`), the page's storage for it (`src/app/browser/outbox-storage.ts`: `localStorage` on localhost; on desktop, this launch's WebView storage plus one host file per document key, `desktop/outbox-store.ts`), and its start on both hosts with the lease's release steps and the 10 s revision check (`src/app/browser/document-outbox-device.ts`). It is the one sync mechanism: `CharacterService`, `ProfileService` and the experiments' document holders all read a document as its acknowledged value with the outbox's entries on top, and write only by recording commands there. The S1 kill harness was ported onto it and runs on both hosts:

```
harness/s1-host.ts     Host process: localhost = the real document store and routes; desktop = the real desktop server (commands through a logging front)
harness/s1-window.ts   Renderer process: the page's real outbox, transport, storage adapter and (desktop) lease adapter; scripted edits with sequence numbers
harness/file-storage.ts The browser's or WebView's storage as a file the renderer writes synchronously (it outlives the renderer)
tools/s1-outbox.ts     The scenarios on both hosts; tests/s1-outbox.test.ts runs them
```

Results (22 October 2026, after both reviews' fixes; 8 scenarios in 172 s, peak 1.0 GB), all **PASS**:

| Scenario | Localhost | Desktop |
|---|---|---|
| Renderer killed at 20 points (16 protocol points, 4 timed) | 309 mutations logged, 0 missing at any restart, 0 false conflicts, 11 lost acknowledgements replayed by receipt | 367 logged, 0 missing, 0 false conflicts, 20 receipt replays |
| Host killed at 20 points | 10 inside the transaction, 10 after commit: 660 logged, 0 missing, 0 false conflicts, 11 receipt replays | 10 after commit, 10 timed; each kill ends the app, so the page restarts as a new launch and reads its outbox from the host's files: 1,018 logged, 0 missing, 0 false conflicts, 24 receipt replays |
| Two windows, both renderers and the host killed (15 kills) | 607 logged, 583 commits checked: 0 silent overwrites, 97 real conflicts became 96 forks (a conflict re-raised after a restart counts again), 0 missing | The desktop page and a second writer on the same library: 560 logged, 274 commits checked, 0 silent overwrites, 37 conflicts, 37 forks, 0 missing |
| Forced outbox-write failure (edits 5–25) | 22 changes recorded unprotected; the warning showed, every edit still reached the library, and the warning cleared | The same (30 unprotected: on desktop a key is protected only once the host's copy lands) |

`integrity_check` was ok after every scenario. The lease harness (above) now drains the real outbox on release; it still passes 34 of 34 checks in about 15 s.

**The specification test** (`projects/xf-studio/authoring/tests/document-outbox-model.test.ts`) is the outbox's main gate. The reference is a specification in its own terms, with none of the outbox's structures: per document, the acknowledged value and version; an ordered list of pending intents with their callers; conflicts as explicit records. Seeded random runs drive the real outbox and the specification together through edits on one and several documents, immutable puts (by this window and concurrently by a second one) and commands that require them, sends, acknowledgements, stale, lost and failed answers, Keep mine, Use theirs and Keep both, revision checks whose reads come back late, storage writes that fail, clean restarts that read the keys back in a shuffled order, and kills after any number of key writes, during a step and repeatedly during the opening and repair that follow. A desktop mode runs the outbox on the desktop storage adapter: each host write is its own step that lands, fails or (from a page since restarted) is refused; renderer kills keep this launch's WebView records; and real app restarts start a new launch, which reads the host's copy alone.

After every step: visible values, pending intents and conflicts, baseline revisions and versions equal the specification's. After a kill, the state equals one the specification allows, restricted by what had reached storage: if no key had been written, the state before the step; once one had, the state after it (every key a step writes carries its decision whole), or for an acknowledgement, that state with the command still to be replayed. Every send is one the specification holds as sendable, with its base and values; no conflict is against the window's own write; every caller's outcome is the specification's, coalesced callers each counted; every immutable reference in the library resolves, Keep both copies included. Protected means recoverable, over every document: what a new launch (or a restart) would read from durable storage (memory, or the desktop host's copy) shows each protected document as the window does, and brings back no discarded command or resolved conflict for a protected document (an acknowledged command may come back: it is replayed and answered by its receipt). At the end every caller has its outcome and the window, the specification and the library agree.

CI runs 60 local and 30 desktop seeds of 400 steps, plus eight fixed seeds that found defects in deeper sweeps, in about 12 s; a sweep of 1,200 runs (about 480,000 steps) also passed. Removing the repair's or the resolutions' markers, the durable copy's markers, the marker-only record's protection, a waiter move, the rewrite of rebased successors, the superseding of replayed copies or the desktop adapter's pending announcement each makes it fail. A failing run prints its mode and seed (`XFS_OUTBOX_SEED=<seed> XFS_OUTBOX_MODE=local|desktop`, with `XFS_OUTBOX_TRACE=1` for the last steps).

**Third review of chunk 1c-i.**

- **Markers wait for the durable copy.** On desktop, a renderer reload reads the WebView's newer records, which hid a stale entry the host still held; the repair took the markers as spent and its cleanup reached the host before that key's replacement, so a new launch brought the discarded conflict back. The outbox now also reads the durable copy (`OutboxStorage.durable`): a stale entry there keeps its marker until that key is written again and the host confirms it. A record holding only markers is never treated as empty. The exact sequence is a deterministic test.
- **Found by the specification test:** after a crash left a stored copy of a command already in the library, a later command on the same document could be acknowledged first; the stored copy then stayed the "last" entry on that document, so the next edit followed it and went stale against the window's own write. An acknowledgement now supersedes an earlier stored copy's write of its documents (one left with no write is done).
- **Known limit (desktop, rare), fixed in chunk 1c-ii:** when the app died while host copies were still on their way, a new launch could read an older entry for a document the page had since written (that document was reported unprotected). The entry replayed by its receipt, and the next edit of that document then conflicted with the page's own newer write: shown as a conflict, never written over. The desktop host-kill scenario hit this once in ten runs (23 conflicts in that run, a cascade from one such document). See the next section for the fix.

**Review of chunk 1c-i.** An independent review reproduced eight defects; the fixes are structural, and each finding also has an explicit test (`tests/document-outbox.test.ts`, `tests/profiles-characters.test.ts`, "review findings"):

- **Visible state is a pure function** of the acknowledged baseline and the remaining entries, computed on every read: Use theirs on a command over several documents can no longer hide a surviving successor's value (finding 4).
- **Waiters move with their values** (`DocumentOutbox.settled`): a successor folded into a conflict, or a conflict replaced by Keep mine, carries its callers, so every save settles (finding 7).
- **Repair by stamps.** Every change of an entry raises its stamp and rewrites every key holding it (a rebased successor's copies included); on open the newest copy wins whatever order the keys are read in, and an entry the repair changed is written again everywhere (finding 6; the model test found the last part).
- **Immutable, content-addressed documents.** Decoded saves are written once, each by its own create-only command (`put`); an equal copy written elsewhere is acknowledged; a command naming one waits until it is in the library; no resolution removes one. This closes the lost decoded save after Keep both (finding 1), a save discarded by Use theirs while another V names it (finding 5), and false conflicts between two windows importing one save (finding 8).
- **Owners hear every recorded command** (`recorded` events): a profile changed by another owner's command is read fresh by the next command (finding 2).
- **Desktop reload:** this launch's copy of a key newer than the host's is given to the host at load; the key is unprotected until it lands, and a settle (the release, the close flush) waits for it. On desktop a key is protected only once the host's copy lands (finding 3).

What the port caught:

- **A receipt was forgotten before every copy of its entry was gone.** A multi-document entry is kept under each of its documents' keys. When one key's write after the acknowledgement was lost (a kill between keys, a failed write, or a desktop host copy not yet written) while the next command already told the host to forget the receipt, the copy came back after a restart as a stale command: a phantom conflict. A receipt is now forgotten only once every key that held its entry is stored without it (on desktop, once the host's copy is written).
- **A desktop launch could read an earlier launch's WebView copy.** The WebView's storage belongs to the loopback port, and a later launch can get the same port. The synchronous copy is now kept under this launch's ID, earlier launches' copies are dropped at start, and an emptied key keeps an empty record with a newer stamp until the host's copy is removed too.
- **A window with no baseline wrote over nothing.** The lease harness's windows saved without reading the document first; every command was then stale against the library and became a conflict (correctly: nothing retried it). Owners read their documents before recording changes to them.

Reproduce, under `tools/memory_guard.py --limit 4`: `bun tools/s1-outbox.ts <scratch> [payload.json|""] [localhost,desktop] [renderer,host,two,failure]`, or `bun test tests/s1-outbox.test.ts`.

## Collections and looks on the outbox (phase 1, chunk 1c-ii)

Product code: the working-copy documents (`src/library/collection-documents.ts`), the collection owner (`src/library/collection-owner.ts`), look sessions (`src/library/look-sessions.ts`), Save version on the host (`saveCollectionVersion` and its route `/api/collection-versions`, `src/library/host/collection-store.ts`), the retention job (`DocumentStore.cleanup`, `keepLibraryClean`) and the raised autocheckpoint (`WAL_AUTOCHECKPOINT_PAGES`). The running Studio still edits its one collection through the workspace; moving it here is chunk 1d.

- **Receipts know their workspace.** A receipt records the workspace and lease generation of the command that wrote it. A replay answered from its receipt, from the same workspace, also names (`own`) each written document every later revision of which that workspace wrote, at a generation no newer than the replay's, as its own receipts record. The outbox takes those as the baseline and rebases the replayed command's successors onto them. A revision with no such receipt (another workspace's write, or a receipt forgotten or purged) is never treated as its own. Deterministic regression: `tests/collection-owner.test.ts`, "the S1 desktop host-kill case" (it fails without the fix).
- **Keep both reads theirs first.** The outbox takes theirs before asking the owner for the copy, so a membership the copy is added to (a profile, a collection) is written over theirs, never over mine's version of it; a failed fork restores the conflict untouched. Keep both's copy is marked (`fork`), so a crash repair never makes it take over the conflict's successors on a membership document it also writes (that ordering made a cycle the specification test found).
- **Superseded copies are written first.** When an acknowledgement supersedes an earlier stored copy's write, the copy's keys are rewritten before the acknowledgement's own, so a kill between them can't bring the superseded write back as the document's value (found by a 600-run sweep of the extended specification test; local seed 982956, desktop 476140, now pinned).

Results (22 October 2026), each under `tools/memory_guard.py --limit 4`:

| Run | Result |
|---|---|
| S1 outbox harness, both hosts, all 8 scenarios | **PASS** in 172 s, peak 1.1 GB. Localhost: renderer 308 logged, host 660, two windows 607 (101 real conflicts, 100 forks, 0 silent overwrites), failure 22 unprotected. Desktop: renderer 356, host 1,059, two windows 560 (34 conflicts, 34 forks, 0 silent overwrites), failure 44 unprotected. 0 missing, 0 false conflicts, `integrity_check` ok everywhere. |
| Desktop host killed at 20 points, 10 runs (the 1c-i limit's regression) | **PASS** 10 of 10 in 1,207 s, peak 0.9 GB: 10,350 mutations logged, 0 missing, **0 false conflicts** in every run, 8–24 receipt replays a run, `integrity_check` ok. |
| Lease harness | **PASS** 34 of 34 checks in 15.4 s, peak 0.8 GB. |
| Specification test, deep sweep | 400 local and 200 desktop seeds of 400 steps (240,000 steps) pass in 50 s. CI runs 60 local and 30 desktop seeds plus 10 fixed in about 8 s. |

Reproduce the regression: `bun tools/s1-outbox.ts <scratch> "" desktop host 10`.

**Review of chunk 1c-ii** (seven findings, all reproduced, each with a regression test in `tests/collection-owner.test.ts`, "review of chunk 1c-ii"):

- **Recovery gate (High).** `own` used to rebase a replayed command's successors onto the later own revision, so an edit made over the recovered (older) copy could put that older content back without a conflict. Now no edit is admitted on a document with a recovered entry until the library has answered it (`OutboxRecoveringError`), `own` only becomes the baseline, and successors go over the replayed command's own revision. The gate is also what removes the 1c-i false conflict.
- **Keep mine makes membership whole (High).** Keep mine on a collection now writes, in the same command, every look its list names as live and every look its removed list names as removed (restoring tombstoned ones); looks the other window added stay listed. Snapshots and Save version refuse a collection that lists a missing or non-live look; the cleanup never purges a look a live collection lists.
- **Dependencies checked by the host (High).** A command carries what it `requires`; the host checks it inside the transaction and answers `missing`; the outbox puts the content again from what the page holds and resends.
- **Write limit (Medium).** Commands over 64 writes are refused before they are recorded (`OutboxTooLargeError`); a collection is made with at most 63 looks at once (`MAX_LOOKS_AT_CREATE`).
- **Save version's lease (Medium)** is rechecked inside the saving transaction. **Cancellation (Medium):** `settle(refs, signal)`; a snapshot's or save's wait ends with its signal, the changes are still sent. **Sessions (Low)** with no handles close once their changes reach the library.
- **The specification test** now gives each window a workspace and lease generation on every command (the host's `own` is checked against the specification's own log of who wrote each revision), purges receipts no window can replay, and crashes the desktop app with host writes still on their way (each key keeps a prefix of them; the specification adopts what was recovered). It found three more defects after such crashes, now fixed: a repaired successor no longer jumps ahead of an earlier entry on its document; sequence numbers never fall below the clock, so a launch that recovered fewer entries still orders its new commands after older ones that come back; and the harness's own command IDs could collide. A conflict on a document whose predecessor's copy was lost may still be a false one after such a crash (shown, never written over).

Results after the review fixes (22 October 2026): S1 on both hosts **PASS** (8 scenarios, 113 s; 0 missing, 0 false conflicts, 0 silent overwrites, 97 and 28 real conflicts all forked); desktop host-kill **PASS** 5 of 5 (4,727 mutations, 0 missing, 0 false conflicts); lease harness 34 of 34; specification test deep sweep of 400 local and 200 desktop seeds (244,000 steps) passes in 31 s, with 241 app crashes with host writes pending, 105 `own` adoptions and 27,097 edits refused while recovering; CI's run takes about 5 s.

**Second review of chunk 1c-ii** (three findings reproduced, plus the recovery gate's availability; regression tests in `tests/collection-owner.test.ts` "second review", `tests/profiles-characters.test.ts` and `tests/ui-polish-dom.test.ts`):

- **Recovery tells every owner (High).** An answer that changes what a document shows (a recovered copy giving way to the library's newer value, including when the baseline already held it) is announced as a change from elsewhere, so a V's context, a look's session, a profile or a collection opened during recovery replaces what it shows before the next edit; a hold that takes a newer value is announced too. While a V is being restored its context refuses changes with the reason (`not_ready`). The specification test now keeps an owner that holds every document from the moment the page opens, told only by the outbox's events, and checks after every step that it shows what the page shows; with the announcement removed it fails within a few seeds.
- **Keep mine reads its looks (Medium).** Keep mine over a collection reads every look it lists or removes from the library first, missing ones included: a look purged there is written back from this page's copy in the same command (over revision 0); one nothing holds any more refuses the resolution with a plain reason before anything is written.
- **Required content travels with the command (Medium).** An immutable document a stored command requires keeps its content in its own key's record while the command waits (`retained`), so cleanup plus a restart puts it again from there. With no copy anywhere, the command waits, `status().missing` says so, and importing the same save again sends it, or `discardWaiting` drops it. A coalesced edit's references replace the old value's when the owner names them, so changing the V's source releases the old save.
- **Availability (style guide `t-recovering`).** Restoring that takes over a second says "Restoring changes from your last session…" in the line under the header; after 5 s it offers Try again and, only where the library hadn't taken the restored change when the page read the document, Keep working on the restored version (else Export collection); a missing save offers Discard those changes. No timer unlocks anything. Captures in light and dark, narrow and wide: `generated/recovering-ui/` (`bun tools/conflict-captures.ts <out> t-recovering`).
- **Found by the extended specification test:** the recovery notice's timer kept read-only probe outboxes alive (memory grew through a sweep until the guard stopped it at 3 GB); the timer is now set only by a page that can write, and the sweep peaks at 0.4 GB. It also found that two commands recovered after such a crash could both be sent on one document; the outbox now sends commands on a document strictly one after another. The test's own model was corrected for crashes with host writes pending (an app restart lands every pending host write; bases taken from a lost answer follow the resolution of that command; a snapshot only checks this launch's own writes; `own` speaks only for documents a command still writes; a recovered command whose receipt is gone may conflict, as documented).

Results after the second review's fixes (22 October 2026): S1 on both hosts **PASS** (8 scenarios, 153 s; 0 missing, 0 false conflicts, 0 silent overwrites); desktop host-kill **PASS** 5 of 5 (5,134 mutations, 0 missing, 0 false conflicts); lease harness 34 of 34; specification test sweep of 800 local and 400 desktop seeds (484,800 steps) passes in 55 s at 0.3 GB, with 427 app crashes with host writes pending, 171 `own` adoptions, 32 allowed conflicts after such crashes and 54,536 edits refused while restoring; CI's run takes about 5 s.

**Third review of chunk 1c-ii** (three findings reproduced, and a UI review of `t-recovering`; regression tests in `tests/profiles-characters.test.ts` "third 1c-ii review", `tests/collection-owner.test.ts` "third review" and `tests/ui-polish-dom.test.ts`):

- **A save arriving refreshes every V that depends on it (High).** A decoded save becoming available here, whichever way (a put by any V, a read from the library, a copy kept with a restored command), brings every context of a V from that save up to its document with the save, before it takes another change; until it can show its save, a V's context refuses changes with the reason. The outbox reads a required document it doesn't hold whole, and announces its arrival like a change from elsewhere. The specification test's owner covers immutable documents too ("dependency arrived").
- **Importing the missing save works while restoring (Medium).** Loading the very save a V comes from while it can't show it only imports it (an immutable put): it is taken even while the V is being restored, changes nothing else, and the waiting changes go out.
- **Try again recovers a hung request (Medium).** Each attempt has a deadline (`ATTEMPT_MS`, 15 s) and its own `AbortSignal`, passed down to the page's fetch; past the deadline, or on Try again, the attempt is abandoned, the command sent again under its own ID, and the late answer ignored. The gate stays throughout. The specification test abandons attempts at random and treats their answers as lost.
- **UI review.** The missing-save line offers Import save… (the usual save import) beside Discard those changes; Keep working is now "Use restored", its full wording the tooltip; Use restored, Import save… and Discard those changes keep their labels at every width, and narrow the message takes a row of its own. Recaptured in `generated/recovering-ui/`.
- **Found by the extended specification test:** a stored copy older than its command as sent (a later edit had joined it before the send) replayed by receipt took the copy's older value as the baseline; a receipt's answer now carries what the command committed. The test also no longer lets its own retry loop starve the answers it waits for, and missing sources are looked for at the next send rather than polled.

**Fourth review of chunk 1c-ii** (two Medium findings, regression tests in `tests/collection-owner.test.ts` "fourth review" and `tests/profiles-characters.test.ts` "fourth 1c-ii review"):

- **Dependency lookups have deadlines.** A lookup of a required document this page doesn't hold is an attempt like a send: its own `AbortSignal`, the `ATTEMPT_MS` deadline, abandoned on Try again, and its late answer ignored.
- **A reload brings a waiting V its save.** The first read of an immutable document that brings its content is announced like its arrival by a lookup or a put, and `CharacterService.load` also brings every V shown without its save up to it. A V whose save isn't here records nothing from its context (it would otherwise record the stand-in default V over its source) and refuses changes until the save arrives.
- **The specification test** now leaves some immutable documents unread when the page opens and adds reloads (owners reading the library again); the owner check covers both. It also skips the own-write check for an abandoned attempt's answer. A sweep of 800 local and 400 desktop seeds passes in 56 s at 0.4 GB.

## The migration in production (phase 1, chunk 1d-i)

Product code: the library transaction and its route `/api/profiles/migrate` (`src/app/profiles/host/profiles-migrate.ts`), the workspace side (`src/app/profiles/profiles-migration.ts`, started by `startProfilesMigration` in `src/app/browser/profiles-migration-device.ts`), the snapshot, comparison and session data (`src/app/profiles/profiles-migration-data.ts`, `src/app/profiles/profile-session.ts`). The Studio runs it at start (`PROFILES_MIGRATION_ENABLED`, chunk 1d-ii), in the window holding the workspace, before the Studio is built from the profile services. Phase 1 reaches `main` as a whole.

- **The record is the host's own.** `migration` joins the host-only kinds, so no page command can write or forge a record.
- **The pre-migration copy** (`LibraryBackups.beforeMigration("profiles-1")`) is taken inside the transaction, before the library's first `profiles-1` run changes anything, and discarded if that run rolls back. Later runs (another workspace, a re-upgrade) take none.
- **Recovery drafts** become collections by the same rules as the draft (an earlier draft of the same collection forks as "(earlier draft)"). They stay in the library and don't join the profile.
- **The loose look** (a workspace with no collection yet) becomes a collection of one, "My looks", whose IDs derive from the workspace's identity, so a re-upgrade finds it again.
- **A V's decoded save** is kept even when the V no longer comes from it (the workspace still had it loaded).
- **Comparisons** use the part registry's canonical parts (`PartRegistry.canonicalParts`), so released rows in an older schema compare equal to drafts.

Fixtures (`projects/xf-studio/authoring/tests/fixtures/profiles-migration-fixtures.ts`): a library written by 0.1.0-alpha.2's own statements (a look, a part preset, a set, the workspace's collection at revision 1), and a workspace shaped like a real one: one V from a save with creator choices and a clothing setting, one collection of four looks with Undo histories and a removed look, three recovery drafts (an earlier draft of the same collection, another collection, an empty one), two views with the person's own lighting setup, the idle and a held pose, a live dock arrangement with a closed and a parked panel, and two saved layouts (the inactive one with a size class and a working state).

Results (22 October 2026), each under `tools/memory_guard.py --limit 4`:

| Run | Result |
|---|---|
| CI harness (`tests/profiles-migration-harness.test.ts`, one process: a kill is the transaction rolling back, or the answer or the page's next steps never happening) | **PASS** 23 of 23 in about 3 s, peak 0.4 GB: both variants with 10 kill points each, the two-host baseline with idempotent re-runs, and the downgrade round trip |
| Sweep (`tools/s3-migration.ts`, processes killed with `SIGKILL`), 5 rounds | **PASS** in 68 s, peak 1.3 GB: 100 kills (10 points × 5 rounds × 2 variants), each recovered after 1 restart to the unkilled outcome; re-runs byte-identical; released tables byte-identical; `integrity_check` ok; one pre-migration copy per library |
| Gates | Identical drafts: 1 profile ("My profile": 1 V, 1 collection), 1 character, 1 decoded save, 2 own defaults, both workspaces' scenes on their own look. Divergent drafts (the second browser renamed the look it shows): the draft forks "(from this browser)", both scenes resolve to their own content through the ID map, whichever host commits first. Downgrade and re-upgrade: the edited working copy unchanged, plus forks "(saved in an older version)" and "(from this browser)" in the one profile, 1 V; a second round trip adds only its record. |

A mutation check: mapping the scene's look without the ID map fails 9 of the CI harness's 23 tests.

**Review of chunk 1d-i** (five findings, each with a regression test in `tests/profiles-migration.test.ts`, "review of chunk 1d-i"; each test fails with its fix removed):

- **A deleted collection was brought back over (High).** Its tombstone hid it from the comparison, so the draft was written under its original IDs over the deleted collection and its newer looks. A collection identity is now taken whenever any row of it exists, live, removed or deleted, and a draft that would need it is recovered under fresh IDs ("(from this browser)"); no existing row changes.
- **Reuse dropped recovery data (High).** Equal live looks reused a working copy even when the draft held other removed looks or other Undo histories. Reuse now also requires that every look's history is the working copy's and every removed look the draft keeps is restorable there with the same content and history; otherwise the draft forks, so nothing it holds is lost (a draft with fewer removed looks still reuses).
- **A resend could pair a newer snapshot with an older result (High).** The request carries the snapshot's digest and the result keeps it. A result made from another snapshot (a lost answer, then edits before the resend), or a workspace changed since its capture, is migrated again under a new token before the workspace is marked done.
- **A named version brought back earlier didn't join a later run's profile (Medium).** It now joins whether this run made it or found it.
- **Closed panels' last places kept panel IDs (Medium).** `lastPlace` keys, groups and anchors are rewritten like parked places. The fixtures' dock arrangements are now made by the real dock engine (`closePanel`, `parkPanels`, `serializeDockState`).

**Accepted behaviour (the re-check):** when a resend carries an intermediate snapshot B that the person's own later state C supersedes before the run settles, B's content is never migrated on its own: the run reconciles against C, the workspace as it is. That is ordinary editing: only the latest state matters, as with any edit made over another.

**Second review of chunk 1d-i** (three findings in reuse, regression tests in `tests/profiles-migration.test.ts`, "second review of chunk 1d-i"; each fails with its fix removed): a removed look now counts only while it is restorable in the working copy (listed, and within 30 days), so an expired one no longer lets a draft that keeps it reuse the copy (High); removed looks are matched one for one, so two equal ones need two (Medium); and reuse needs the same name (a migration's own copy: the name it gave it) and the same package plan, so a difference is kept in a fork (Medium).

After the fixes: CI harness 23 of 23 in about 3 s; `tests/profiles-migration.test.ts` 25 of 25; sweep of 2 rounds **PASS** in 29 s (40 kills, each recovered after one restart), peak 1.3 GB.

Reproduce: `bun test tests/profiles-migration.test.ts tests/profiles-migration-harness.test.ts` (authoring), and `bun tools/s3-migration.ts <scratch> [rounds]` here.

## The Studio on the profile services (phase 1, chunk 1d-ii)

The running Studio is built from the profile session and its services; the workspace's pre-profiles fields (the collection draft, recovery drafts, the saved V, the character fields, views and layout) are migration input only and are written back unchanged.

- **Start.** `src/compose/studio-startup.ts` runs the migration first, loads the services (`createProfileServices` in `src/app/profiles/profile-window.ts`) and opens the session (`openProfileSession`): the workspace's `profiles.sessions` when migrated, else a transient one on the first profile. Tab 1's views, scenes and panel instances come from it (`ProfileSessionState`, `src/app/profiles/profile-session-state.ts`); the drawn view's scene names the look shown (`look`) and the V (`subject`).
- **The shown look.** `LookEditor` (`src/library/look-editor.ts`) binds the editor's document to the scene's `LookRef` through `LookSessions`: it records every change in the outbox as it is made, and the outbox stores the look's key within 250 ms, at once before Save version, Check, Build, closing and a lease takeover. A look in recovery or changed elsewhere is blocked or reloaded with its reason.
- **Collections.** `CollectionService` (`src/library/collection-service.ts`) is folded onto `CollectionOwner`: preset add, copy, rename, move, remove and restore (back where it stood) are owner commands; Save (Ctrl+S) is **Save version** through `/api/collection-versions`; opening and importing never replace anything, and Undo open shows the collection open before. The recovery-draft queue is gone: recent drafts are the library's collections never saved as a version.
- **History.** Scopes are `look:<collection>/<look>` and `character:<id>`; the look shown is the editing context and is kept in the session (`focus.editing`). There is no unqualified fallback: with no editing context Undo is unavailable, with its reason. A focused panel's own history comes first: Ctrl+Z in a 3D view names the look its scene shows (`history.undo` with `scope`), so it undoes the look even when a creator choice was changed last; the header's and History panel's Undo follow the editing context.
- **The V.** The head's character comes from `CharacterService.context(id, …)` for the scene's `subject`.
- **Save Explorer.** One session per panel instance; every `saves.*` action names its `instance` (`src/features/save-explorer/sessions.ts`).
- **Review fixes (Sol, xhigh, two rounds).** Every change of the shown look is recorded in the outbox as it is made (`commit` with `store: "soon"`): the entry is pending at once, so every way a newer value is taken (a read, a revision check, a recovered command's answer and `own`, a resolution) meets it as a conflict, and a resolution under way takes edits made during it (they join "mine"). Only storing waits: one storage write per 250 ms (`STORE_SOON_MS`), the key reported unprotected meanwhile, and at once on pagehide, closing, Save version, Check, Build and a takeover's drain; an entry is stored before it is sent. A renderer crash loses at most that interval of a continuous edit. The specification test's random runs include such edits (no kill is armed while one waits), and a deterministic class covers each adoption path. Conflicts on a collection or its presets show in the Presets panel (Conflict notice; Keep both for a preset only) and resolve through the request `resolveConflict`; Save version, Check, Build and export wait meanwhile. Removing the last preset keeps the scene naming it, so the collection and its Restore survive a restart. A collection made with the profile's membership edit leaves room for it in its first command (tested with 63, 64 and 130 looks, imports and copies). A released Save Explorer session ends with an `AbortSignal`: its folder subscription and running work stop. Each fix has its regression test.
- **The old model** (`LegacyDraftSession`, `LegacyDraftActions`) survives only as the test oracle in `tests/fixtures/legacy-draft.ts`, for the goldens and the differential parity test.

Parity evidence (22 October 2026):

| Gate | Result |
|---|---|
| Differential parity (`tests/profiles-parity.test.ts`): the same script on the old draft model and on the profile services, over the five workspace-1 fixtures | **PASS**: every step's document, history and preset list match: edits, controls, gestures, Undo, Redo, history jumps, preset add, switch, remove and restore, and a restart, the last through the migration and the library |
| Studio flows (`tests/profiles-studio.test.ts`, 10 tests) | **PASS**: the shown look edited in place and restored with its Undo history after a restart; per-look history scopes; Undo naming a scope (the 3D view's); preset commands; Save version; Check and Build on the snapshot; open, import, Save as new collection, Export collection |
| Start to restart (`tests/profiles-startup.test.ts`) | **PASS**: a workspace shaped like a real one (a V from a save with creator choices and clothing, looks with Undo histories, recovery drafts, two views) migrated into an alpha.2 library and opened as the Studio starts: the drawn scene shows the migrated V and the selected look with its content and history; a restart shows the same and makes nothing new |
| Latency (`tests/look-editor-latency.test.ts`, 16 layers and 80 Undo steps, about 112,000 UTF-16 units) | **PASS** (budget 4 ms): an edit, recording included, p95 2.0 ms; a drag frame p95 1.5 ms; storing the key p95 0.5 ms; package freshness 0.07 ms per repaint |
| `?verify=1` browser runs on an isolated server and data folder | Migrated at start; an edit and an added preset persisted; after a reload the preset list, the shown preset, the edited opacity and its Undo step returned. A second run: Save version made version 1 (chip Saved), an opacity edit turned the chip to Changed since last version, Ctrl+Z with focus in the 3D view undid it (chip Saved again), and a reload kept all of it with Undo available; no console or server errors. The 3D head was not prepared in that folder, so the V's rendering was not exercised there |
| Harnesses after the switch-over | S1 outbox sweep (`tools/s1-outbox.ts`) every scenario ok, nothing missing, no false conflicts, `integrity_check` ok, about 96 s at peak 1.1 GB; S3 sweep (`tools/s3-migration.ts`, 2 rounds) ok in 33 s at peak 1.3 GB; the specification test, the lease and migration harnesses and the 17 scenarios with the three-character test pass |

## Phase 1 gates (chunk 1f)

The gate table is [phase1-gates.md](phase1-gates.md). What chunk 1f added:

### Multi-subject service test

`tests/profiles-multi-subject.test.ts` runs phase 1's scale on the real services together:

- three Vs (two feminine, one masculine) and three looks in one profile, in a real library;
- a session of 5 views in 2 tabs, read as the workspace stores it, with three Character panels pinned to the three Vs and a Presets panel following focus;
- the window's resolver (`createTargetResolver`) over the core's view graph, the history service and the owners, and the drawn look in the look editor.

It checks that each V's choices and each look's content reach only their own document, and that each Undo acts on its own scope: a Character panel's on its V, the 3D view's on its look, the header's on the editing context. Resolution never leaves the shown tab. Captures and named actions are refused with what changed: another look, a V changed elsewhere, a deleted V, a removed look. The session stores and reads back with its tabs, pins and focus.

It found one defect: a session with two tabs lost its second tab. The resolver put every view in the shown tab, and storing the session moved every view there. A view now keeps the tab it was stored in (`ProfileSessionState.viewTab`); the test fails without the fix.

### S1 latency on the data drive

`tools/s1-latency.ts` runs on the production code: the page's `DocumentOutbox` and HTTP transport (its localStorage adapter on a file written synchronously) against the real localhost host (`harness/s1-host.ts`: the document store and its routes, WAL with the raised autocheckpoint, the library's own flush timing). The look is the 16-layer fixture with a full 80-step history (156,852 UTF-16 units, 88 % of it history). Each edit rewrites the whole row, as a real edit does. Each cadence runs twice: with the outbox stored at once (`now`, S1's gate) and as the look editor records (`soon`, stored within 250 ms). One run on C: (NVMe) and two on D: (the mechanical data drive), 22 October 2026, Windows 11, Bun 1.4.2, peak 0.5 GB:

| Run | Commit, main thread p95 | Commit to acknowledgement p50 / p95 / max | Host round trip p95 / max |
|---|---|---|---|
| C:, `now`, person (120 edits) | 2.2 ms | 2.8 / 3.8 / 9.2 ms | 2.4 / 7.3 ms |
| C:, `now`, stress (300 edits) | 2.2 ms | 3.0 / 5.6 / 7.5 ms | 3.3 / 5.2 ms |
| C:, `soon`, person; stress | 0.10; 0.07 ms | 223 / 256 / 259 ms; 144 / 255 / 257 ms | 3.3 / 4.7 ms; 2.7 / 2.9 ms |
| D:, `now`, person (two runs) | 2.3; 2.1 ms | 3.0 / 4.3 / 48.6 ms; 2.9 / 4.0 / 49.4 ms | 2.6 / 47 ms; 2.3 / 48 ms |
| D:, `now`, stress (two runs) | 1.9; 1.9 ms | 2.8 / 5.5 / 34.6 ms; 2.7 / 3.4 / 25.9 ms | 2.9 / 33 ms; 2.1 / 25 ms |
| D:, `soon`, person (two runs) | 0.11; 0.12 ms | 223 / 256 / 300 ms; 224 / 256 / 304 ms | 2.3 / 47 ms; 43 / 52 ms |
| D:, `soon`, stress (two runs) | 0.06; 0.06 ms | 140 / 255 / 301 ms; 141 / 255 / 306 ms | 2.1 / 47 ms; 2.3 / 51 ms |

- **Within budget.** Stored at once, commit to acknowledgement is p95 3.4–5.5 ms on D: (budget 250 ms), the same as on C:. The data drive adds only a tail: a host round trip that meets the flush's checkpoint takes up to about 50 ms (7 ms on C:). The raised autocheckpoint keeps checkpoints off the host's thread, and no round trip came near SQLite's own 67–184 ms checkpoint.
- **The look editor's deferred storing sets its acknowledgement.** An edit recorded with `store: "soon"` is stored and sent within `STORE_SOON_MS` (250 ms), so its acknowledgement is that wait plus the round trip: p95 255–256 ms, max 306 ms on D:. That is by design (chunk 1d-ii: one storage write per 250 ms of a continuous edit), not a drive cost. Its main-thread cost per edit drops to about 0.1 ms.
- **Main thread.** Stored at once, `commit` costs p95 1.9–2.3 ms here, most of it rewriting the stand-in outbox file (a browser's `setItem` measured 0.9 ms in the spike). That is within the 4 ms budget.
- **Write volume.** The host process wrote about 167 KB per command on both drives (Windows' process I/O counters: WAL frames, checkpoints and the flush), 84 MB for about 500 commands. At the design's one command every 2 s that is about 300 MB an hour. A person editing without pause (the `soon` person run: 2.4 commands a second) writes about 1.4 GB an hour.

**History chunks: not split** (§2.2's option). The data-drive run stays within budget by a wide margin, and the write volume is sustainable: under 1 MB/s is far below a mechanical drive's sequential rate, and a few hundred MB per hour of editing is well inside an SSD's endurance. Splitting would cut the volume several-fold, since history is 88 % of each write, but it adds a document kind, content addressing and retention for no measured need. Revisit if a look's document grows well past this fixture (more history steps or larger parts), if several looks autosave at once (phase 5), or if a round trip on the data drive passes 100 ms.

### Process-tree kill: the browser's storage commit window

`tools/storage-tree-kill.ts` runs a page in a real headless Chrome 152 (no window, so nothing takes focus). The page writes one `localStorage` key of about 100 KB every 50 ms and reports each write after `setItem` returns. The harness kills the whole browser tree by its PID (`taskkill /T /F`) after a varied time, starts Chrome again on the same profile, and reads which write survived. Two renderer kills are the control: Chrome's storage service is its own process and lives on, and the tree is killed 12 s later. 22 October 2026, about 4 minutes:

| Killed after | Last write reported | Survived | Lost |
|---|---|---|---|
| 0.8 s | 20 | none of this launch's | 1.0 s of writes |
| 2.6 s | 57 | none | 2.9 s |
| 4.3 s | 91 | none | 4.6 s |
| 6.1 s | 121 | 101 (5 s after the first write) | 1.0 s |
| 9.2 s | 290 | 202 | 4.4 s |
| 13.5 s | 477 | 302 | 8.8 s |
| 40 s | 1,107 | 402 | 35.2 s |
| 75 s | 1,907 | 1,601 | 15.3 s |
| Renderer killed (two runs) | 1,667; 1,758 | 1,667; 1,758 | nothing |

Chrome commits a page's `localStorage` to disk 5 s after its first change. While writes keep coming, it then commits about once a minute (its commit rate limit). A tree kill loses everything since the last commit: 1.0–35.2 s measured, and up to about a minute under steady editing. A renderer crash loses nothing.

**What that means for the localhost guarantee.** The outbox is a second copy, not the only one. While the dev server is up, every edit reaches the library within milliseconds of being sent (above). A browser tree kill therefore loses only what the library hadn't acknowledged: with the look editor's deferred storing, about the last 250 ms of a continuous edit. Only edits made while the library can't be reached (the dev server stopped) are held by `localStorage` alone, and a tree kill then loses up to the commit window.

**Desktop.** The desktop app's WebView2 is Chromium too, so its own storage has the same window. But every desktop outbox key is also written to the host's outbox files, written and synced at once, and a key counts as unprotected until that copy lands (the warning shows after 2 s). WebView2 can't be driven headlessly from the harness, so the desktop case is not measured.

### The harnesses in CI

The Authoring workflow's desktop (Windows) job runs this folder's `bun test tests` after the desktop tests, with `XFS_HARNESS_QUICK=1`: the lease harness, the S1 outbox kill harness with half its kills, the S3 sweep for one round, and the S1 rules. Its path filter includes this folder, and the full kill counts stay the default locally. The CI set takes about 2.5 minutes (152 s locally, peak 1.6 GB); the full S1 kill harness alone takes about 2.3 minutes. `bun run check` typechecks this folder's code.

## Acknowledgement and rebasing rules (S1, answering Sol's Medium point)

- **A1, freeze on send.** From its first send, an outbox entry's command ID, bases and values never change. Every resend, after a timeout, a host restart or a renderer restart, reuses the ID.
- **A2, successors.** A single-document edit coalesces into its document's newest entry only while that entry is unsent, or in conflict, where it updates "mine". Behind a frozen entry it opens a successor whose base is `{ after: <frozen ID> }`, and later edits coalesce there. A document therefore has at most one frozen entry and one open entry.
  - Multi-document commands never coalesce. They queue behind every earlier entry that touches any of their documents.
- **A3, acknowledgement.** The host's answer, fresh or replayed, removes the entry. Its revisions become the window's baseline, and every `{ after }` successor is rebased onto them, all in one synchronous outbox write. The command ID then goes into the next command's `forget` list.
- **A4, receipts.** `transact` takes the command ID and writes a receipt (`documents` kind `xfs-receipt`) in the same transaction. A command whose receipt exists is answered with the stored revisions and is never applied twice. That makes a committed command with a lost acknowledgement the window's own write, not a conflict.
  - Receipts are deleted when a later command names them in `forget`, and purged after 7 days at host start.
- **A5, equal-value fallback.** A replay with no receipt, whose bases no longer match but whose every target already holds exactly the replayed value, is acknowledged at the current revisions.
- **A6, stale.** A stale answer makes the entry a conflict holding the current revisions, and nothing retries.
  - Single-document successors fold into its "mine".
  - Multi-document successors stay blocked.
  - **Use theirs** rebases later entries onto the stale base, so they go stale in turn and are never sent over theirs.
  - Each resolution (**Keep mine**, **Use theirs**, **Keep both**) is one outbox write, and stored conflicts are shown again after a restart.
- **A7, revision checks.** A check skips any document with an outbox entry. A newer revision of a clean document is applied only above the baseline that A3 set, so a receipt replay never shows as an external change.

## Migration rules (S3)

- **M1, the record.** One immediate transaction per run. `migration/profiles-1:<token>` returns its stored result. It is the same idempotent-command mechanism as A4, keyed by the token.
- **M2, comparison.** Collections are compared by content: look names and parts, in order, in canonical key order, with IDs ignored.
  - The draft is compared against the working copy **and every earlier fork of the same collection** (`origin`), so a re-upgrade whose draft was already brought back reuses that fork instead of making another.
  - A divergent draft forks the **whole collection** ("(from this browser)", new collection and look IDs), and the ID map covers every look.
- **M3, named versions.** A named version newer than the working copy's `saved.revision` (with no working copy, newer than the draft's `library.current` revision) is brought back.
  - With no working copy, the working copy is made from it, and a different draft forks.
  - Otherwise it becomes a fork "(saved in an older version)" and joins the profile.
  - Named rows and drafts are both read through the part registry before hashing. Released rows are stored in the oldest schema that holds them, so their raw JSON never matches a draft's.
- **M4, subjects.** Characters are compared by their whole normalized state, and decoded saves by content hash.
- **M5, profile.** Use a profile that already holds this V and collection. If there is none: no profiles means "My profile", one profile means use it, several mean "From this browser". Without the first rule, every re-upgrade with several profiles would make another "From this browser".
- **M6, defaults.** Own defaults are deduplicated by name and dock hash.

## Design changes implied

None of the gates fails, so the design's write unit (one document per look) and its migration protocol stand. The page needs these changes; the design doc itself wasn't edited here.

1. **§1.1 Outbox row and §2.2.** Replace "newest value per document" with A1–A7. The entry becomes `{ id, seq, command, writes: { kind, id, base: number | { after }, value | tombstone }[], at, state: "queued" | "conflict", current? }`. Add the at-most-one-frozen-plus-one-open rule, the successor rebasing and the folding rules.
2. **§2.1.** `DocumentStorePort.transact` takes `{ id, command, writes, forget }` and is idempotent by `id` through receipts, which are `documents` rows: no new table, and `user_version` stays 2. Receipts are added to the §1.4 cleanup list, purged after 7 days. Note the equal-value fallback.
3. **§2.2 Conflict.** Each resolution is one outbox write, and stored conflicts are shown again after a restart.
4. **§2.2 and §2.3, outbox budget.** One look under edit is up to 160K UTF-16 units, and its outbox holds at most two entries. While the host is unreachable, every dirty look adds up to two more.
   - Store each document's entries under its own key (`xfs.outbox.<workspace>.<kind>/<id>`), so a commit rewrites only its own document's entries.
   - Count the outbox against `WORKSPACE_STORAGE_BUDGET`. A quota failure takes the warning path, which works.
5. **§2.3, host thread.** Each committed look writes about 320 KB, roughly 80 pages, into the WAL. SQLite's default autocheckpoint (1,000 pages) therefore runs on the host thread about every 12 commits. [Library durability](../../research/authoring/library-durability.md#cost) measured that checkpoint at 67–184 ms on a D:-like drive. That is still inside 250 ms, but it would set the tail.
   - Phase 1 should set the owner's `wal_autocheckpoint` well above that (or to 0), and let the worker's flush, which already runs within 5 s, do the checkpointing.
   - It should also repeat the latency run on the data drive. The spike rules kept these runs off D:. Both were done in phase 1: the autocheckpoint is raised to 16,384 pages, and the data-drive run is within budget ([phase 1 gates](#phase-1-gates-chunk-1f)).
6. **§2.2, an option, not required.** About 88 % of each autosave is Undo history (141K of 160K units): around 580 MB of WAL writes in an hour of editing at one commit every 2 s. Splitting the look-level history's chunks into immutable, content-addressed documents would cut it several-fold. Do it only if the data-drive run or write volume calls for it. Phase 1 measured about 300 MB an hour at that rate (167 KB a command, WAL and checkpoints together) and decided not to split ([phase 1 gates](#phase-1-gates-chunk-1f)).
7. **§2.3, localhost.** "Relies on the synchronous outbox" is true for a renderer crash: Chrome's storage service outlives the renderer. A kill of the whole browser process tree loses the writes made since Chrome last committed `localStorage`: phase 1 measured 5 s after the first change, then about once a minute ([phase 1 gates](#phase-1-gates-chunk-1f)). The library has every acknowledged edit anyway, within milliseconds while the host is up.
8. **§8 step 2.1.** Use M2 and M3 in place of "Each working copy that already exists… is compared", as concrete rules: compare against forks too, fork the whole collection, the named-version rule, comparison through the part registry, and the named-version fork joining the profile.
9. **§8 step 2.3.** Add M5's first rule (a profile that already holds this V and collection).
10. **§8 and §2.1, one mechanism.** Name the migration record and command receipts as one mechanism: a command ID whose stored result answers a replay.

## Refined phase 1 estimate

Same units as §9.2. The spikes retire the main persistence risk. The rules are settled, the prototype's core (outbox, receipts, migration) is about 550 lines, and the harnesses carry over to CI. They also add a few small items (receipts, per-document outbox keys, the autocheckpoint change and a data-drive run, a WebView kill test).

| Part of phase 1 | Was (inside 20–24) | Now |
|---|---|---|
| Model: profile and subject registry, `CharacterService` and catalogue split, `CollectionService` commands, working copies, snapshots | — | 7–8 |
| Autosave: outbox A1–A7, idempotent `transact` with receipts, revision checks, flush and close, warning state | — | 2.5–3 |
| Conflicts: panel states, Keep mine, Keep both, Use theirs, re-shown after restart | — | 1.5 |
| Recovery: lease, release-only takeover, host fencing (not spiked), tombstones and cleanup | — | 2–2.5 |
| Migration `profiles-1` (M1–M6) and the session build | — | 1.5–2 |
| IDs and history, focus, resolver, data contracts, the rest of the de-singletoning | — | 4–5 |
| S1 and S3 harnesses in CI, data-drive run, WebView kill | — | 0.5–1 |
| **Phase 1 total** | **20–24** | **19–23** |

The total barely moves, because the spikes mainly confirmed the design rather than removing work. What changes is the risk: no persistence redesign before phase 1, and the migration needs no protocol change, only the rules above. Lease and fencing are the remaining unspiked persistence piece, and are the first place to look if phase 1 runs over.
