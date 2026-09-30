# Library durability

How XF Studio's SQLite library files (`library.sqlite`, and `verification.sqlite` for isolated checks) keep their data safe, and what that costs. Implementation: `projects/xf-studio/authoring/src/platform/graph-adapters/library-durability.ts`; tests: `tests/library-durability.test.ts`; timing: `tools/bench-library-save.ts`.

## The guarantee

- **The library is never corrupted.** Not by the app crashing, being killed, or losing power partway through a save.
- **An app crash or kill loses nothing.** Every save that finished is kept.
- **A power cut or an operating-system crash loses at most the last few seconds.** A save becomes safe on disk within about 5 seconds of being made: 2 seconds after the last save, or 5 seconds after the first unflushed one while saves keep coming. Quitting the app makes everything safe at once.

That is the bar the maintainer set: losing the last few seconds is acceptable, losing the last half hour is not.

## How

Every connection that writes a library file (the look, collection, part-preset and graph stores) calls `useWriteAheadLog`:

1. `PRAGMA journal_mode=WAL`. WAL mode is stored in the file, so a library made by an earlier build in rollback-journal mode moves to WAL the first time it opens; the change is SQLite's own and atomic. Libraries have been WAL since the first release, so in practice this is a no-op.
2. `PRAGMA synchronous=NORMAL`, **only once WAL is confirmed**. A file that can't enter WAL (a file system without shared memory, say) keeps SQLite's default, `FULL`, and every commit still waits for the disk.

A commit then goes to the log file without waiting for the disk. Each store tells the file's `LibraryDurability` after it commits (`wrote()`), and the durability runs a flush: 2 s after the last write, no later than 5 s after the first unflushed write, and at once when the host stops (quit). The flush is `PRAGMA wal_checkpoint(PASSIVE)` through a short-lived connection of its own. It counts as done only when every frame in the log was checkpointed; if a reader held part of the log, or the flush failed, it runs again later (2 s, then doubling to 30 s), and the first failure of a run goes to the diagnostics log. Timers come from the host clock (`Clock.after`, cancelled by the file's `AbortSignal`), so tests drive them on simulated time.

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

Electrobun 2.0.2 gives the app `before-quit` (the flush runs through the desktop server's `stop()`), but no suspend, resume or session-end event. None is needed for the guarantee: an orderly Windows shutdown writes the file cache to disk itself, and a suspend keeps memory, so the only loss is a power cut during the few seconds before the next flush. The localhost dev server has no quit hook; stopping it is a process kill, which loses nothing.

## Cost

200 saves of the starter look through `LookLibrary` (`bun tools/bench-library-save.ts [folder]`, the body the installed-app measure posts, without the HTTP hop), two runs each:

| Drive | Before (WAL, `FULL`) | After (WAL, `NORMAL`) | The flush |
|---|---|---|---|
| D: (the dev checkout's data drive) | 17.0–23.0 s: 72–108 ms a save (p95 192–204 ms) | 0.08–0.2 s: 0.05 ms a save (one save 67–184 ms, SQLite's own checkpoint at 1,000 log pages) | 170–220 ms after one save, 0.7–0.9 s after 200 |
| C: (`%TEMP%`, where `%LOCALAPPDATA%` lives) | 0.27–0.37 s: 1.2–1.4 ms a save | 13–14 ms: 0.05 ms a save | 7–10 ms |

The disk's flush cost varies a lot between drives; the installed app's 40–100 ms per save came from a drive like D:. The flush now runs on the host's thread once, a few seconds after the saves stop, instead of inside every save. Moving it to a worker thread is the open follow-up ([performance](../backlog/performance.md)).

## Tests

`tests/library-durability.test.ts`:

- The schedule on simulated time: a flush `quietMs` after the last write and not before; later writes move it, up to `maxMs` after the first; under steady writing no write waits longer than `maxMs`; one timer at a time; retries back off and a failure is reported once per run; the end of the lifetime flushes at once, and a later write flushes as it happens.
- Every store's connection is WAL with `synchronous=1`; an in-memory database (no WAL) keeps `FULL`; a rollback-journal library moves to WAL with its rows intact.
- A flush checkpoints every committed frame (`wal_checkpoint(NOOP)` before and after); a read transaction holding the log makes it report unfinished until it ends, then the retry finishes it.
- Stopping the stores and ending the lifetime flushes the last write even while another connection keeps the log.
- Each store tells the durability of its commits, and a refused save doesn't.
- A child process (`tests/fixtures/library-writer.ts`) saving in a loop is killed three times at different points: each database passes `PRAGMA integrity_check` and holds every save the child acknowledged.
