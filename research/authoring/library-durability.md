# Library durability

How XF Studio's SQLite library files (`library.sqlite`, and `verification.sqlite` for isolated checks) keep their data safe, and what that costs. Implementation under the authoring `src/`: `platform/persistence/library-database.ts` (the file's owner), `library-migrations.ts` (its schema), `platform/persistence/library-durability.ts` (flushes) and `platform/persistence/backups.ts`, composed for both hosts by `library-files.ts`; tests: `tests/library-database.test.ts`, `tests/library-durability.test.ts`, `tests/library-backups.test.ts`; timing: `tools/bench-library-save.ts`.

## The guarantee

- **The library is never corrupted.** Not by the app crashing, being killed, or losing power partway through a save.
- **An app crash or kill loses nothing.** Every save that finished is kept.
- **A power cut or an operating-system crash loses at most the last few seconds.** A save becomes safe on disk within about 5 seconds of being made: 2 seconds after the last save, or 5 seconds after the first unflushed one while saves keep coming. Quitting the app makes everything safe at once.

That is the bar: losing the last few seconds is acceptable, losing the last half hour is not.

## One owner per file

Each library file has one owner, a `LibraryDatabase`, which holds the file's only connection in the host. The look, collection, part-preset and document stores take it; none opens the file. `openLibraryFiles` (`library-files.ts`) opens both files with every store, the main file's daily backups and the `/api/looks`, `/api/collections`, `/api/part-presets` and `/api/documents` routes (each also under `/api/verification`), and both hosts call it once; `close()` flushes and closes both files when the desktop quits.

- **Writes.** Every store write is `write(change)`: one immediate transaction that commits when `change` returns and rolls back when it throws. A write inside another write (a store calling a store) is a savepoint of it. The file's durability is told once, after the outermost commit, and only when the transaction changed a row (`total_changes()`), so a refused or stale write reports nothing.
- **Opening and the schema.** Opening runs the schema's steps (`LIBRARY_MIGRATIONS`): `looks-1` and `collections-2` are the released `user_version` steps (0 to 1 to 2; a version-1 library's looks become one collection, as they always did), and `part-presets-1` and `documents-1` are tables beside them. A step is pending when the migration ledger (`xfs_migrations(id, applied_at)`) doesn't name it and its own check finds the schema without it. Each pending step runs in one immediate transaction with its ledger row; the first step that writes the ledger also records the steps it finds already made (`before-ledger`). Ledger IDs from a newer build are allowed. **Opening writes nothing unless a step is pending**: a library that already has every table isn't written at all, not even the ledger.
- **Compatibility.** The published 0.1.0-alpha.2 refuses a file whose `user_version` is above 2 and inserts into its tables positionally. So `user_version` is never raised above 2 (a step that tries is refused and rolled back), and no released table (`looks`, `look_revisions`, `collections`, `collection_revisions`, `collection_preset_versions`, `part_presets`, `part_preset_sets`) or development table (`events`, `snapshots`, `node_index`) is ever altered, renamed or dropped. Later changes are new tables, recorded in the ledger only. A file from a newer build (`user_version` above 2) is refused before anything is written.
- **Steps that rewrite rows** (`rewritesRows`) run only after a consistent copy of the file (`library.pre-migration.<day>.<id>.sqlite` in `backups`, made with `VACUUM INTO` through the owner's connection before the step's transaction starts); if the copy fails, opening stops and nothing changes. No released step rewrites rows.
- **Outside processes** (tools such as `tools/backup-library.ts`) open their own connections; the owner's connection sets `busy_timeout=5000`, so a short outside lock is waited for rather than failing.

## How

The owner's connection calls `useWriteAheadLog` when it opens:

1. `PRAGMA journal_mode=WAL`. WAL mode is stored in the file, so a library made by an earlier build in rollback-journal mode moves to WAL the first time it opens; the change is SQLite's own and atomic. Libraries have been WAL since the first release, so in practice this is a no-op.
2. `PRAGMA synchronous=NORMAL`, **only once WAL is confirmed**. A file that can't enter WAL (a file system without shared memory, say) keeps SQLite's default, `FULL`, and every commit still waits for the disk.

A commit then goes to the log file without waiting for the disk. The owner tells the file's `LibraryDurability` after each commit (`wrote()`), and the durability runs a flush: 2 s after the last write, no later than 5 s after the first unflushed write, and at once when the host stops (quit). The flush is `PRAGMA wal_checkpoint(PASSIVE)` through a short-lived connection of its own. A scheduled flush runs on a worker thread (`checkpointInWorker`: one worker per process, started from a Blob so the bundled desktop host needs no extra file, and never keeping the process alive), so the host's thread never waits for the disk; writes made while it runs stay pending and get a flush of their own. The flush at quit runs at once on the host's thread, and if the worker's checkpoint holds the lock at that moment it tries again for up to 2 s. A flush counts as done only when every frame in the log was checkpointed and no other checkpoint held the lock (SQLite reports a busy checkpoint's log as -1, which is not "not in WAL"); if a reader held part of the log, or the flush failed, it runs again later (2 s, then doubling to 30 s), and the first failure of a run goes to the diagnostics log. Timers come from the host clock (`Clock.after`, cancelled by the file's `AbortSignal`), so tests drive them on simulated time.

### What SQLite documents, and this relies on

Checked against [PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous), [PRAGMA wal_checkpoint](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint), [PRAGMA journal_mode](https://www.sqlite.org/pragma.html#pragma_journal_mode) and [Write-Ahead Logging](https://www.sqlite.org/wal.html) (30 September 2026; Bun 1.4.2 ships SQLite 3.53.2):

| Point | Documented |
|---|---|
| No corruption | "WAL mode is safe from corruption with synchronous=NORMAL" and "always consistent" with it. In rollback mode NORMAL is "maybe not consistent", hence the WAL check first. |
| Crashes | "Transactions are durable across application crashes regardless of the synchronous setting or journal mode." |
| Power loss | With NORMAL a WAL commit "might roll back following a power loss or system crash"; FULL adds a sync of the log after every commit, which is the cost this removes. |
| What syncs | With NORMAL "the checkpoint is the only operation to issue an I/O barrier or sync operation": the log is synced before a checkpoint copies it into the database, and the database is synced after a completed checkpoint. |
| PASSIVE | Checkpoints "as many frames as possible without waiting for any database readers or writers"; never calls the busy handler; returns the log's frame count and how many were checkpointed. |
| WAL persists | "The WAL journaling mode is persistent"; when the mode can't be changed "the original journal mode is returned". |

`synchronous` is per connection, so the flush's own connection sets `NORMAL` as well: a checkpoint on a connection with `synchronous=OFF` would not sync.

### What the host doesn't see

Electrobun 2.0.2 gives the app `before-quit` (the flush runs through the desktop server's `stop()`, which closes the library files), but no suspend, resume or session-end event. None is needed for the guarantee: an orderly Windows shutdown writes the file cache to disk itself, and a suspend keeps memory, so the only loss is a power cut during the few seconds before the next flush. The localhost dev server has no quit hook; stopping it is a process kill, which loses nothing.

## Cost

200 saves of the starter look through `LookLibrary` (`bun tools/bench-library-save.ts [folder]`, the body the installed-app measure posts, without the HTTP hop), two runs each:

| Drive | Before (WAL, `FULL`) | After (WAL, `NORMAL`) | The flush |
|---|---|---|---|
| D: (the dev checkout's data drive) | 17.0–23.0 s: 72–108 ms a save (p95 192–204 ms) | 0.08–0.2 s: 0.05 ms a save (one save 67–184 ms, SQLite's own checkpoint at 1,000 log pages) | 170–220 ms after one save, 0.7–0.9 s after 200 |
| C: (`%TEMP%`, where `%LOCALAPPDATA%` lives) | 0.27–0.37 s: 1.2–1.4 ms a save | 13–14 ms: 0.05 ms a save | 7–10 ms |

The disk's flush cost varies a lot between drives; the installed app's 40–100 ms per save came from a drive like D:. The flush runs once, a few seconds after the saves stop, instead of inside every save, and on the checkpoint worker's thread (PIPE-137), so its 170–220 ms (0.7–0.9 s after 200 saves) on a drive like D: no longer holds up the host.

## Backups

The library is the only home of the work, so it is also copied without asking (`platform/persistence/backups.ts`). The first check runs about 2 seconds after the host starts and repeats hourly, so a Studio left running still takes one copy for each day it runs. Copies go into a `backups` folder beside the library. Each is made with SQLite's `VACUUM INTO`, so it is consistent and compact, and it is written beside its final name and renamed into place so a half-made copy is never seen. Seven daily copies are kept, plus the newest copy of each of the four newest older weeks.

**Restoring** a copy first keeps the current library as a pre-restore copy (kept until removed deliberately), then swaps the chosen copy in with a single rename. It is refused while any other connection has the library open, so nobody's open library is replaced under them. The owner restores (`LibraryDatabase.restore`): it flushes, closes its connection, restores and opens the file again (migrating an older copy), so the stores keep working on the restored file; a refused restore reopens the file as it was. Nothing in the Studio offers a restore yet.

**Before a migration** that rewrites rows, a pre-migration copy is taken (above), kept like pre-restore copies until removed deliberately. The one-time move of existing presets and collections to the document store in the [profiles entry](../backlog/README.md#profiles-and-multiple-vs-after-the-beta) is such a step. A permanent delete does not reach existing backup copies; copies keep what the library held on the day they were made, until they are pruned.

## The workspace draft

The workspace draft (the open collection, its looks' Undo memory and view state) is not in the library: it lives in one file per workspace in the host's data folder, `workspace.json` and `verification-workspace.json` for `?verify`, on localhost (`data/`) and the desktop alike (`platform/persistence/workspace-file.ts`, served at `/api/workspace` on both hosts; tests `tests/workspace-file.test.ts`, `tests/host-workspace.test.ts`). Each write goes to a new file beside it, is flushed to the disk (off the host's thread) and renamed over the old one, one write per file at a time, so the file is always one whole draft. A draft whose current state can't be shown is never overwritten (the page offers Start fresh, which renames it aside, never deletes it), one holding a newer build's data is never replaced, and the version-1 file an older build wrote is kept as `workspace.v1.bak` before it is replaced.

The page (`host-workspace-device.ts`) loads the draft before the Studio builds its services and writes one draft at a time, the newest winning; a refused write shows in the status bar and is written again with the next change. Localhost kept the draft in browser storage (`xfas.workspace.v1`) before this: the first time the host has no draft at all (no file, none ever set aside), that browser draft is handed to the host once. The browser copy is never removed and never written again. The page autosaves about 180 ms after a change and at once when hidden, so closing a tab can lose at most that last moment.

## Tests

`tests/library-database.test.ts`:

- Opening is lossless on every historical shape: version 1 (looks only), a version-2 library from before part presets (the captured pre-migration golden), 0.1.0-alpha.2 with looks, a collection, part presets and a set (written by the vendored release's own statements, `fixtures/alpha-0.1.0-alpha.2/library-ddl.ts`), and a development library with the retired graph's tables. Every table's DDL and rows (`SELECT * ORDER BY rowid`) are the same after opening, apart from the tables it adds; `user_version` is 2; alpha.1's list query and alpha.2's schema check read every collection row; alpha.2's opening sequence and positional inserts still work on the result, and this build reads what it wrote. Opening again doesn't change a byte of the file; neither does opening a library with every table and no ledger.
- A fresh library gets every step and a ledger naming them; a newer build's file is refused with its bytes unchanged; newer ledger IDs are kept; a failing step or one that raises `user_version` changes nothing.
- A row-rewriting step runs only after its pre-migration copy, which holds the rows as they were, and not at all when the copy fails; pre-migration copies are never pruned.
- Writes nest as savepoints and report once; a failing nested write rolls back to its savepoint; a refused or stale write reports nothing; a closed file refuses reads.
- A backup restores through the owner, the stores working on the restored file afterwards; with another connection open it is refused and the file reopened as it was.

`tests/library-durability.test.ts`:

- The schedule on simulated time: a flush `quietMs` after the last write and not before; later writes move it, up to `maxMs` after the first; under steady writing no write waits longer than `maxMs`; one timer at a time; retries back off and a failure is reported once per run; the end of the lifetime flushes at once, and a later write flushes as it happens.
- The owner's connection is WAL with `synchronous=1` and `busy_timeout=5000`; an in-memory database (no WAL) keeps `FULL`; a rollback-journal library moves to WAL with its rows intact.
- A flush checkpoints every committed frame (`wal_checkpoint(NOOP)` before and after); a read transaction holding the log makes it report unfinished until it ends, then the retry finishes it.
- The scheduled flush runs off the host's thread (the worker, or an injected background flush), one at a time; a write made while it runs stays pending and is flushed next; quitting flushes on the host's thread at once. The worker checkpoints a real library on its own connection, and a busy checkpoint is never counted as done.
- Closing the file flushes the last write even while another connection keeps the log.
- Each store's commits reach the durability through the owner, and a refused save doesn't.
- A child process (`tests/fixtures/library-writer.ts`, opening the file through the owner as the hosts do) saving in a loop is killed three times at different points: each database passes `PRAGMA integrity_check` and holds every save the child acknowledged.
