# Handoff: 4a-ii review fixes (Sol, MERGE AFTER FIXES)

Branch `claude/profiles-4a`, worktree `%USERPROFILE%/xfs-worktrees/profiles-4a`. The code for all three findings is in the WIP commit `7bf83ba1`, on top of `8a8fef3a` (4a-ii). What is left is documentation, `bun run check`, and a final commit.

## Status per finding

1. **Medium: a runtime still being built misses a context restore. Code done and tested.**
   - **Fix.** `createSceneRuntime` adds its hidden slot to the device before it makes anything (`scene-host.ts`, start of `assembleRuntime`). The slot's `contextRestored` calls `restoreMade`, which grows with the build: nothing, then `lighting.restore()` once the stage exists, then the full restore (lighting, features, character). The device never shows a slot until its owner calls `show`, which only happens after the build. `dispose()` removes the slot first.
   - **Test.** The device probe's step 6 loses and restores the context inside `loadCore`, after the stage has prefiltered the room. Shown, the runtime is byte-identical to the same runtime built undisturbed (`36864:dc07d1e` for both).
   - **Negative check.** Delivering the restore only once the runtime is shown fails that test, so the gate can fail.
2. **Medium: an abort during the record read surfaces as `preview_unreachable`. Code done and tested.**
   - **Fix.** `loadCoreDetail` now reads the record inside a try that rethrows `signal.reason` when the signal has aborted. `createSceneRuntime`'s catch also rethrows `signal.reason` for any step that failed after an abort, which covers injected loaders too.
   - **Audit.** `loadGameMotion` already rethrew in its catch, and checks again after the blink. `createFeatureRenderers` throws the reason through `throwIfAborted`.
   - **Tests.** `tests/scene-build-abort.test.ts` covers the core record (fetch rejection after the abort, and a 404 after the abort), the motion, and the feature renderers (3/3 pass). The device probe also has an abort step, `core-failing`: the loader aborts and then throws a `TypeError`, and the build rejects with `AbortError`.
3. **Low: B's composite never ran while hidden in the probe. Probe done; §8 wording not yet corrected.**
   - **Fix.** The probe calls B's eye makeup renderer's `beforeDraw()` while B is hidden and records the composite's `layerDraws` before and after (0 to 1). The test asserts the count rose, then checks that the canvas is unchanged and B drew zero scene frames.

## Verified at `7bf83ba1` (3 GB guard, one probe at a time)

- `webgl-renderer-device`: 7/7 pass.
- `webgl-scene-dispose`: 4/4. `webgl-scene-host`: 7/7. `webgl-body`: 6/6. `webgl-clothing`: 7/7.
- Targeted unit, parity and boundary tests: 76 files, 752 pass, 0 fail.
- Not yet run at this commit: `bun run check` and the other WebGL probes (they passed at `8a8fef3a`, and nothing they use changed).

## Next

1. In `experiments/043-scene-runtimes/README.md` §8:
   - The hidden-build bullet and the results table claim B's makeup was composited while hidden. Say that the runtime composites only in a drawn frame, and that the probe composites B ahead through its renderer's own `beforeDraw` (preparing a whole runtime ahead is 4a-v).
   - Add the restore-during-build gate and the `core-failing` abort step.
   - Add `tests/scene-build-abort.test.ts` to the gates.
   - In "What changed", note that a runtime is on the device from the start, hidden, so restores reach it while it is built.
2. Run `bun run check`, `python tools/check_links.py` and `python tools/check_private_paths.py`, then commit (amend nothing; a new commit on top).
3. Report to the coordinator.

## Learned

- A runtime-level catch that maps any failure to `signal.reason` when the signal has aborted is simpler and more complete than patching each loader's boundary.
- Python on Windows writes CRLF in text mode. Open files with `newline=''` when editing, or the source-scanning tests break.
- Free memory dips below the 16 GB floor for minutes at a time while other chats run. Check it before each probe and run probes one at a time.
