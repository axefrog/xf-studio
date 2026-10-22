# Handoff: 4a-iv review fixes

Branch `claude/profiles-4a`. The fixes for Sol's review of 4a-iv (MERGE AFTER FIXES: six Medium findings, one Low) are in commit `636f437a`. §10 of the [experiment README](README.md#10-chunk-4a-iv-residency-and-the-superseding-subject-change-built) describes them as current truth.

## The seven findings

| # | Finding | State | Where | Regression test |
|---|---|---|---|---|
| 1 | One requester's abort cancelled a preparation another requester shared | **Done** | `preview/host/preview-core-host.ts` (`prepare(body, lease)`, `withdraw`), `preview/host/preview-core-server.ts` (the `lease` field, the `withdraw` action), `preview/preview-preparation.ts` (`ensureBody` holds a lease, joins a running preparation, and withdraws its lease on abort) | `tests/masculine-core.test.ts`: two windows hold leases on one preparation through the real endpoint. The first withdrawing leaves it running, the second stops it, and no `cancel` is ever sent. A preparation asked for outright survives a withdrawal. |
| 2 | Residency didn't bound the preview workers | **Done** | `character/choice-preview-suspension.ts` (new), `preview/browser/browser-scene-heads.ts` (suspends non-resident Vs' devices whenever the residents change), `preview/scene-residency.ts` (`wants()`) | `tests/browser-scene-heads.test.ts`: with four Vs, at most two devices are alive, and a suspended device starts again when asked. |
| 3 | A stale idle load mutated the rig after the epoch check | **Done** | `MotionPort.selectIdle(id, signal)` and `MotionActions.select` (aborted by a newer load or a release); the scene runtime and `platform/scene/head-rig.ts` check the signal before `setClips` | `tests/scene-motion.test.ts`: a stale load that *succeeds*, on a device over the real `IdleAnimation`. It fails on the old code. |
| 4 | A warm restore skipped the default clip | **Done** | `MotionActions.restore` compares the scene's clip with the clip the device plays (`deviceClip`) | `tests/scene-motion.test.ts`: Inventory, then Close-up chosen on runtime B, then back to A. It fails on the old code. |
| 5 | A pose the scene had removed survived on a warm rig | **Done** | `restore` lets go of the pose based on `posePlaying`, then selects the scene's idle once the pose is released | `tests/scene-motion.test.ts`: real `IdleAnimation`. It fails on the old code. |
| 6 | An abort couldn't interrupt a request in flight | **Done** | `PreviewTransport` takes `{ lease, signal }`, and the browser transport passes the signal to `fetch` | `tests/masculine-core.test.ts`: a held Refresh and a held Prepare are each cut off in under 200 ms, and a Prepare that was cut off still withdraws its lease. |
| 7 (Low) | The eye-shape status was wrong | **Done** | `PreviewActions.eyeShapeOptions()` returns `shown` and `fallback` (`EYE_SHAPE_FALLBACK`); `apply` shows the base shape for a missing choice; `studio-ui/panels/character.ts` selects the shown shape and shows the fallback line | `tests/trusted-preview-services.test.ts` |

## What ran

All runs were under the 3 GB guard.

- `bun run check` passes.
- The targeted tests pass: 146 files, 1,419 pass, 10 skip (real-game oracles), 0 fail, peak 1.7 GB. They include the preview-core, choice-preview and desktop server tests.
- `check_links` and `check_private_paths` are clean.

## What's next

1. **Run the affected WebGL probes, one at a time,** once available RAM is at least 19 GB. They didn't run: RAM stayed at 18.1–18.4 GB until the stop. Run:
   - `tests/webgl-renderer-device.test.ts`, which exercises the residency;
   - `tests/webgl-scene-host.test.ts`, because the scene runtime's `selectIdle` changed.

   The `head-rig.ts` change only adds a signal check before `setClips`, so no change in either probe is expected. Add their results to §10's Results table.
2. **Get the UI review for finding 7's panel change.** `studio-ui/panels/character.ts` selects the shape the head shows and adds a plain fallback line to the existing eye-shape note. It's a copy and wiring change with no new control.
3. **Send it back to Sol** for re-review, then hand it to the coordinator to merge.

## What I learned

- **Rig changes need a cancellation token, not an epoch.** `selectIdle` loads its clips, then changes the rig itself before its promise settles, so ignoring a stale completion afterwards is too late. The signal has to be checked inside the adapter, after the load and before `setClips`.
- **A warm runtime needs the device's actual state, not only the scene's.** Reconciling against the default clip assumed the device was fresh. The service now tracks what the device plays (`deviceClip`), and whether it still holds a pose (`posePlaying`).
- **Cancellation is per requester, and so is the lease.** "Did this call start it?" is the wrong question when two pages share a host job. The right one is whether anyone still holds it, so a page that finds the job already running joins it with a lease.
- **The GL-object counter keeps listing objects that died in a context loss.** A probe section that runs after a context loss must compare against its own baseline.
- **The worker is the expensive part of a choice-preview device.** The browser device already makes its worker lazily, so a suspendable wrapper that ends the device and makes a new one on next use is cheap. It reloads the subject head first.
