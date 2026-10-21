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

The look used is the largest a look gets: the large workspace fixture's selected look with 16 layers and a full 80-step Undo history (`HISTORY_LIMIT`), 159,875 UTF-16 units as the library would store it. The preset is 18,710 units and the look-level history 141,144. A 4-layer look is 116,208 units. The 2K reference recipe's input is local and not in the repository. Its cost on this path depends only on the document's size: its 2K raster runs in a worker and isn't on the commit path. So the largest realistic document stands in for it.

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
  harness/edit-script.ts   Timed edit script (person and stress cadences), shared by Bun and the browser page
  harness/bench-page.ts    The same in a real browser: localStorage outbox, fetch transport
  tools/s1-kill.ts         S1 kill harness (renderer, host, two windows)
  tools/s1-latency.ts      S1 timing gates (Bun window, or --browser)
  tools/look-fixture.ts    The look fixture through the real core, and its build cost
  tools/s3-kill.ts         S3 crash harness and round trip
  tests/s1-rules.test.ts   The acknowledgement rules, lost acknowledgements, coalescing, conflicts, outbox failure
```

The workspace lease harness has its own section below.

- **Kills are real process terminations** (`TerminateProcess` through `process.kill(pid, "SIGKILL")`). Protocol-point kills are the process killing itself at a named point. Timed kills come from the parent. The host's in-transaction kills leave SQLite to roll back from the WAL on the next open.
- **Presence check.** Every edit's value carries `seqs[<window>]`. The window prints `rec` after each synchronous outbox write and `ack` after each acknowledgement is recorded. At every restart and at the end, each logged sequence number must be in the library, in the document or a fork of it, or in that window's outbox.
- **Silent overwrite check.** The host appends every committed write to a log with its revision and `seqs`. Across a document's revisions, no window's sequence number may go down. Only an explicit **Keep mine** may lower it, and the script never chooses it. The script's person always picks **Keep both** 10 ms after a conflict.
- **What stood in for the renderer.** The kill harness's renderer is a Bun process with an outbox file written atomically by rename. That models a renderer crash, which `localStorage` survives in a browser. A kill of a whole browser or WebView process tree was not tested (see the design changes below).
- **S3 fixtures.** The library is written by 0.1.0-alpha.2's own statements: looks, part presets, a set, and the experiment 005 collection at revision 1. It is then opened by this build. The workspace is today's shape, normalized: the draft of that collection with a look added, `library.current` at revision 1, one V (save source, decoded save, body, voice, choices, clothing) and two saved layouts. The divergent variant renames a look. Outcomes are compared without generated IDs and without depending on which host went first.

Reproduce, each run under `tools/memory_guard.py --limit 4` (all runs peaked below 1 GB):

```
bun test tests
bun tools/look-fixture.ts <scratch>/fixtures 16
bun tools/s1-latency.ts <scratch> <scratch>/fixtures/look-16x80.json [--browser]
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

Each window edits one document (a save every 15 ms, or every 1 ms where a write must be in flight) and writes its workspace every fourth edit, with a marker. Results (21 October 2026; 34 checks in about 16 s, peak 0.8 GB), all **PASS**:

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
   - It should also repeat the latency run on the data drive. The spike rules kept these runs off D:.
6. **§2.2, an option, not required.** About 88 % of each autosave is Undo history (141K of 160K units): around 580 MB of WAL writes in an hour of editing at one commit every 2 s. Splitting the look-level history's chunks into immutable, content-addressed documents would cut it several-fold. Do it only if the data-drive run or write volume calls for it.
7. **§2.3, localhost.** "Relies on the synchronous outbox" is true for a renderer crash, because `localStorage` lives in the browser process. A kill of the whole browser or WebView process tree may lose writes made within its storage commit delay. Chromium is expected to write `localStorage` to disk with a delay; this is a hypothesis, not measured. The library has most of them within about 10 ms anyway. Phase 1's desktop harness should kill the WebView process tree once to measure that window.
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
