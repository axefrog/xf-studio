# Handoff: Build speed first pass (PIPE-130, PIPE-131, PIPE-133)

Branch `claude/build-speed` from main `a78931c`. Not merged. Worktree `D:/Dev/worktrees/build-speed`.

## Results (two-preset collection, both bodies' plates, development PC, WolvenKit 9.0.1, through the host service)

| | Before (main) | After |
|---|---|---|
| Warm Build | 58.8–59.7 s (3 runs) | 27.8–28.9 s (7 runs) |
| First Build (plates cut) | 115.4 s | 70.7 s |
| WolvenKit launches, warm | 14, one at a time | 8, at most two at a time |
| Peak memory of the tree | 2.2 GB | 2.9–3.0 GB |

Warm stages after: prepare 0.2 s, compose 1.7 s, convert 9.2–9.8 s, pack 2.4 s, verify 14.4 s. Before: plate serialize ×2 9.2 s, bake 1.4 s, imports ×3 10.7 s, deserialize ×3 12 s, pack 2.3 s, verify (unbundle, serialize ×3, export) 21.6 s. Each launch costs about 2.3 s before doing any work and about 1.2 GB.

Measured with scratch harnesses (host service + traced builder), not the installed app the audit used; the audit's 64–80 s was on an installed-layout app.

## What changed

- **Cached:** the eye plate cache keeps WolvenKit's JSON of each plate (`json-<id>/` in the entry, `readKeptJson`/`publishKeptJson` in `src/derived-cache.ts`), bound to the resource SHA-256 and the WolvenKit identity; new plates keep their verifying readback, older entries get it once. The builder reads it (hash-checked) instead of two serializes and falls back on any mismatch. The plate entry itself was already keyed by archive stamps. The independent verifier never reads it.
- **Batched:** one `convert deserialize` over the model/app/customization folders (flat output, then moved); one verifier `convert serialize` over members + plate inputs (copies renamed `plate-input.*`); the plate cut reads and reads back mesh+morph per launch. Imports stay one per group (import settings are process-wide env values) but run beside the deserialize via `concurrencyGate(2)`.
- **Progress (PIPE-131):** builder prints `XFS_PACKAGE_PROGRESS=`; `PackageHostService.buildProgress()`; `GET /api/package/progress` on both hosts; collection service polls every 400 ms via the host clock source; panel shows "Step 3 of 5: Converting 2 looks…" and fills the existing `progressBar` (no new controls, no library edits).
- **PIPE-133:** each plate preparation settled the route's `.xl` additions on the event loop (55–90 ms ×2 per Build); now kept per opened installation, with an early-exit `DepotIndex.has`.
- Knowledge: WolvenKit packs bodies at Kraken Normal and imports/deserializes buffers at Optimal2 (34/34 segments reproduced byte for byte); per-level costs in `knowledge/archive-format.md` §2.

## Equivalence

Resources are byte-identical to main's: all 15 files, every stored segment and raw size, across 4 branch Builds (including a fresh plate cut) against a main Build; the `.archive.xl` is identical. The archive files themselves differ run to run on main too (index timestamps). Every Build passed the independent verifier and the host result gate. Check/Build agreement unchanged (full suite).

## Tests

`tests/build-speed.test.ts` (kept-JSON invalidation, gate, batching call lists, stage lines, stdout lines, host snapshot), plus additions in `tests/eye-plate.test.ts`, `tests/collection-service.test.ts`; call-order expectations updated for batching. Full authoring suite under the guard: 3006 pass, 27 skip, 0 fail (6 GB limit, peak 3.1 GB); `tsc` clean; links and private paths clean.

## UI gate evidence (ignored, `local-evidence/build-progress/`)

`1-convert-*`, `2-verify-*`, `3-done-*` at light/dark × 300/480 px (group and row crops) from an isolated `?verify=1` server on port 4496 running a real Build (`tools/build-progress-look.ts`); `run.json` records every line shown and the progress box: 23 px high and the result area at the same top in every state, no text overflow at either width.

## Needs a call

1. **UI gate:** PIPE-131 needs the UI lead's PASS. The style guide's "Mod package progress" composition specimen (`src/studio-ui/style-guide/compositions.ts`) still shows the old line; UI track to update.
2. **Remaining PIPE-133 stall:** one 100–155 ms host stall per warm Build while two WolvenKit processes saturate the CPU. Running the Build's WolvenKit below normal priority removed it with no measurable slowdown on an idle PC, but PIPE-96 says foreground waits run at normal priority, so I left it. Maintainer's call.
3. **Next speed steps** (still ~28 s, bar is "no multi-second wait"): native resource writing with WolvenKit as verifier (the 8 launches are ~90 % of the time); verifier serialize beside texture export (−4 s, needs an async verifier API); a third concurrent WolvenKit (−3 s for +1.2 GB).
4. **Fast local-test Build:** not worth offering while WolvenKit writes resources (compression is ≤ 2 s CPU in total, the CLI has no level option).
5. Mistake to note: an unguarded trial of `WolvenKit uncook -u -s` on our archive with `-gp` uncooked the game (27 GB private, 13 GB written to scratch) before I stopped it; removed. Don't use `uncook` for verification.
