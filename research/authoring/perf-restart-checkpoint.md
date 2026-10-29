# PREV-196: warm restart preparation

Step 1 is merged at **main `19c366b7`** (MERGE review; full suite **4,875/0**, GPU **124/0**, browser/resource proofs green). It improved warm restart from **9.9–10.6 s to 5.6–7.7 s**. Step 2 is committed as **`d418e83f`** on `claude/perf-restart-2` and reaches **2.92–2.95 s warm**. The **<2 s budget remains open**. Its review verdict is **FIX**, with three Medium findings corrected in the current uncommitted follow-up; re-review and remaining gates belong to the coordinator.

## Measured critical path on `d418e83f`

Coordinator-reported warm page marks (milliseconds):

```text
ask 900–1050
loaded 1770
details:uploads 2140
details:drained 2860
frame 2920–2950
```

Before step 2, loaded was 4.1–6.2 s and blink answered at 3.9–6.1 s while creator presentation, background V resolve and archive indexes competed with facial work. The new measurement confirms the combined priority/overlap improvement; it does not isolate each change's contribution. The 720 ms uploads → drained interval still includes bake/program/link work and completion waits.

Coordinator gates on `d418e83f` before stopping for review fixes: typecheck clean; desktop **135/0**, 038 **11/0**, startup browser **6/0**, substitution **2/0**, resources **8/0**, GPU **124/0**, suite batches **1–2 green**. This is a partial gate run, not a completed full-suite result for step 2.

## 1. Host: first-frame demand uses the shared lanes

**Cause [source]:** creator presentation waited only for person jobs; poses and facial control analysis used fair slices without the shared lane policy. A whole facial preparation is not a suitable single-slot job: it later waits indefinitely for an Expressions request, and other reads depend on its rig. Holding that slot while waiting for another job would deadlock dependencies.

**Correction:** the existing scheduler now supports `cooperate(lane, work, signal)` for read work outside its single preparation slot. Those reads hold their lane while wanted and use the same injected clock, 8 ms slices, higher-lane waits and quiet periods. They neither commit nor restart a derivation. Existing person jobs/holds still pre-empt lower CPU work; unused quiet wake-ups are cancelled. No separate startup queue or ordering timer is added.

| Lane | Work |
|---|---|
| `person` | Existing V requests, installation checks and Clear; unchanged preparation/commit policy |
| `shown` | Facial rig/setup, blink bake, idle catalogue/body reads; explicitly requested expression listing retains shown priority |
| `ahead` | Creator presentation, pose catalogue, inert/control-relation analysis, existing background V resolve and upkeep; expression prefetch stays ahead |

Both host roots pass the same scheduler into the facial, idle and pose hosts; the creator already receives it. Creator and pose scan turns participate in the lane. Idle catalogue reads yield between patches/sets. The facial rig releases its shown scope before waiting for an Expressions request; blink demand holds shown priority through its bake. The in-app solver inherits the calling cooperative turn, so its many-frame control probe yields to person/shown demand.

**What “solver ready” means [source + CPU regression]:** blink waits for `rigReady`, which is resolved **before** `startSolver()` and the editor's control probe. The matching measured log was correlation under contention, not a direct promise dependency. Readiness includes `2 + 2 × controls` solved poses (controls alone and over a common context), inert-control detection, world-space displacement and relation analysis. That analysis now runs ahead. The actual setup still needs resource reads, parsing and synchronous `compileFacialRig`; a separate “Facial setup compiled in … ms” line measures that compile rather than conflating it with readiness. Individual solves, setup compilation and blink baking retain their arithmetic.

**Files** under `projects/xf-studio/authoring/`: `src/platform/api/jobs.ts`, `src/platform/core/jobs.ts`, `src/host/host-jobs.ts`; `src/character/host/cc-catalogue-service.ts`; `src/animation/host/facial-host.ts`, `idle-host.ts`, `pose-catalogue-host.ts`; `server.ts`, `desktop/server.ts` (wiring only).

**Tests:** simulated scheduler order proves person > shown > ahead, that shown reads hold back ahead jobs without occupying the person slot, and cancellation releases a priority wait. The facial-host regression serves the real synthetic blink while the ahead probe remains deferred, then observes solver readiness after releasing shown demand. Existing shared-resource priority, catalogue, pose and idle tests remain intact.

## 2. Page: prepare parts while the blink is arriving

**Cause [source]:** the browser detail device awaited the complete scene before it loaded any parts. The scene awaited the head rig, and the rig awaited blink loading/binding. Gaze geometry must be stable for skin/eye adapters, but the blink clip does not change that geometry or those materials.

**Correction:** the motion loader announces stable gaze geometry after loading the idle/re-rigging the eyes and before waiting for the blink. The head rig exposes only that stable surface context. The scene host creates its existing character renderer/pool once and hands off a typed **preparation-only** port (`details.load`, `prepareDetails`). That port has no placement, playback or display capability. The complete scene promise still waits for the blink and establishes the same neutral motion/face bindings.

The browser device can fetch/build/upload/compile parts through that early port, then joins complete scene readiness before placing anything. A host or test without the optional handoff retains the original complete-scene path. Cancellation while joining readiness immediately releases loaded parts. The scene owns early allocations on failure and abort, restores their context along with the lighting during an early context loss, and releases every completion/upload lease. Blink fetch/fallback now receives the rig's AbortSignal and refuses late answers. Initial motion, first-frame publication, V placement, fallback behavior, saved state and data durability remain gated as before.

**Files:** `src/platform/scene/head-rig.ts`, `scene-host.ts`, `character-renderer.ts`; `src/animation/render/game-blink.ts`; `src/character/browser/browser-character-detail-device.ts`; `src/preview/browser/browser-head-attachment.ts`, `browser-viewport-device.ts`.

**Tests:** the real scene host over a recording WebGL fake loads **and prepares** real synthetic detail geometry while its motion loader holds the blink pending. Device tests cover successful placement only after full readiness, abort while awaiting it, and complete-scene failure. A renderer test makes motion access throw during preparation; loading/compilation still completes. Blink tests refuse late cancelled replies and avoid a fallback after cancellation. Existing context-loss/retry, attachment, motion and resource-release assertions pass.

## 3. GPU: overlap the strict completion barrier with linking

**Cause [source]:** `details:uploads` → `details:drained` includes layered-bake waits/work, program steps, compiled texture uploads, driver-link completion and the final drain. It is not all one fence. The final `gpuDrained` used to insert its fence only **after** links completed, paying a new quiet-context report delay. A bake's first error/readback check and program first-use reads can block behind uploads (G2), so deleting those barriers or returning upload credit on a timer would weaken protection.

**Correction:** capture the final first-use completion fence immediately after the preparation's last submission, before awaiting link readiness. Wait for its actual completion before synchronous uniform/attribute reads. The shared upload owner now exposes a monotonically increasing submission revision, advanced for both map sends and non-map renderer work. If that revision changed while links settled, refresh the completion fence at the original post-link boundary; a stale checkpoint never authorises a read behind a newer busy queue. The strict pre-bake drain, 120-frame drain bound, map window, bounded link pacer, morph-round barriers and warm-up behavior are unchanged. This overlaps useful independent work; it does not assume a quiet fence has completed after some elapsed time.

The captured fence is preparation-owned, cleaned in `finally`, and deleted immediately on character disposal even with a non-cancellable link reply pending. No observer, timeout or additional persistent owner is introduced.

**Files:** `src/platform/scene/character-renderer.ts`, `gpu-upload-budget.ts`.

**Tests:** fifteen-frame fence reports plus twenty simulated link frames take **35 frames**, rather than the former serial **50**. A draw arriving during the links requires the full renewed barrier and takes **50**; the first-use assertions check that it is not read early. A held-link cancellation deletes all live fences. Existing quiet-page window throughput remains **45 frames for 24 bands**, versus **345** under per-band barriers; continuous draws, spent-window backpressure and context-generation tests remain unchanged.

## Review follow-up on `d418e83f` (uncommitted)

1. **Cancelled placement:** `wanted()` checked the signal when resolving, but a readiness reaction could cancel before the awaiting continuation ran. `browser-character-detail-device.ts` now rechecks immediately after that await, inside the catch that releases loaded parts. The `character-detail-context` regression cancels in exactly that microtask gap and verifies zero placements and one release. It fails on `d418e83f`.

2. **Nested scheduler dependency:** a prefetch check holds the single job slot while awaiting a cooperative catalogue build. Waiting for a queued shown job then forms a cycle: the build waits for that job, which waits for the check's slot. `platform/core/jobs.ts` now defers cooperative reads to queued higher work only while the slot is free. While occupied, running higher work, holds and quiet periods still take priority; dependent reads can finish so the slot can be released. This is the scheduler's general admission rule, with no creator-specific bypass. A simulated-time `jobs` regression reproduces the occupied-slot cycle, retains the shown quiet period, then verifies catalogue → check → shown completion. It also fails on `d418e83f`.

3. **Facial probe deadline and retry:** its 15 s wall-clock timeout counted priority waits, and the old early `probed` flag permanently suppressed a retry. `facial-host.ts` now gives each solve an AbortSignal and a monotonic work budget, pausing its deadline around cooperative turns. Oracle waits still spend the budget. Abandonment cancels in-app work even during a pending turn; deadline timers follow their owner and are cleared on success, failure, pause and release. Inert controls and relations publish together, with `probed` set only after successful analysis. A failed probe disposes the process and retries through the existing bounded restart policy, rather than publishing readiness without analysis. `facial-host` tests keep a real in-app probe healthy through a 30 s simulated person preparation, expire a genuinely stuck probe and verify complete retry, and assert immediate timer cancellation on release. `facial-solver` tests abort/dispose a solve during a pending turn and reject its late continuation.

**Files in this follow-up:** three production files above; `tests/character-detail-context.test.ts`, `jobs.test.ts`, `facial-host.test.ts`, `facial-solver.test.ts`; the performance/ledger and knowledge notes. No upload-window, GPU barrier, cache identity or authored-state policy changes.

## Validation and handoff

**150 targeted tests pass across eight files**, one Bun process under the required **4 GB guard**, peak **0.5 GB**: `jobs`, `host-jobs`, `choice-prefetch`, `cc-catalogue-service`, `character-detail-context`, `facial-host`, `facial-solver`, `facial-lifetime` (`tests/*.test.ts`). No existing assertion or timing gate is weakened. Recording WebGL fixtures execute without a browser or GPU. No browser, GPU, typecheck, desktop, full-suite, real-data oracle or latency gate ran in the follow-up.

Link checking reports **0 broken links/paths in 508 Markdown files**; the tracked-file privacy check and `git diff --check` pass. The footprint report shows **290.8 GB free on C**, this worktree **0.5 GB**, and no task scratch or new payload above 5 GB retained. Existing large folders are untouched.

The coordinator owns re-review, remaining gates and remeasurement. Exercise cancellation between scene readiness and placement, a preview-source request during another body's catalogue rebuild, and facial analysis interrupted by a long person preparation.

**Remaining path to 2 s:** the request still starts around 0.9–1.05 s, parts finish loading at 1.77 s, and preparation continues through uploads at 2.14 s and drained at 2.86 s. Core loading, setup/bakes, driver linking, necessary completion waits and hidden warm-up retain their costs. Use residual stage measurements to choose the next change; the three review fixes make no new timing claim. No game or mod-manager operation is needed for this checkpoint.

## Step 1 evidence retained

The first candidate `2e57ae9f` regressed to 20.3–20.7 s despite asking for the V at 1 s: per-band fences multiplied quiet-context reports of 200–250 ms. The window commit `da926994` reached 6.4–6.8 s, with uploads 0.4 s after loaded. Subsequent review fixed later-work admission, warm-character fence retention, the pose poll's unowned 700 ms timer and a separate one-second face poll; continuous rendering then exposed fence replacement starvation. The merged design retains pending admission barriers, grants a bounded burst on completion and carries intervening work into the next checkpoint. The shell-repaint explanation for delayed Chrome reporting remains a hypothesis. Those fixes are now MERGE-reviewed and validated by the coordinator's green full/GPU/browser/resource gates on `19c366b7`.

**Knowledge used:** [WebGL linking/uploads](../../knowledge/webgl-program-linking.md), [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [facial animation](../../knowledge/facial-animation.md), [body animation](../../knowledge/body-animation.md), [knowledge rules](../../knowledge/README.md). Updated measured step-2 progress, cancellation/admission findings and probe deadline/retry ownership; browser evidence for the review follow-up remains pending.
