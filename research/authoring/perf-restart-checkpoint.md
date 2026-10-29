# PREV-196: warm restart preparation

Step 1 is merged at **main `19c366b7`** (MERGE review; full suite **4,875/0**, GPU **124/0**, browser/resource proofs green). It improved warm restart from **9.9–10.6 s to 5.6–7.7 s**. Step 2 and its first review fixes are committed through **`ef601ead`** on `claude/perf-restart-2`: the current whole V is **3.2–3.3 s warm**, typecheck clean, gates green through startup-resources **8/0** before stopping. Re-review closes the placement and facial findings but returns **FIX** for a High scheduler tail cycle. The current uncommitted change replaces async-scope priority barriers with ready CPU admission. Re-review, remaining gates and remeasurement belong to the coordinator; **<2 s remains open**.

## Measurements

The latest whole-V result is 3.2–3.3 s on `ef601ead`; no detailed marks were supplied for it. The last detailed coordinator marks are from `d418e83f` (milliseconds), whose whole V was 2.92–2.95 s:

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

**Current correction:** `cooperate(lane, work, signal)` admits a read's initial CPU work and ready continuations in lane order through the existing scheduler pump. A turn queues after the 8 ms slice, or sooner when a higher read is ready. Reads hold no permit across I/O/dependencies and never wait for jobs, tails, person holds, quiet periods or another async read to finish. Only preparation-job admission uses those barriers. There is no second startup owner or per-read timer. The reason for this separation is below.

| Lane | Work |
|---|---|
| `person` | Existing V requests, installation checks and Clear; unchanged preparation/commit policy |
| `shown` | Facial rig/setup, blink bake, idle catalogue/body reads; explicitly requested expression listing retains shown priority |
| `ahead` | Creator presentation, pose catalogue, inert/control-relation analysis, existing background V resolve and upkeep; expression prefetch stays ahead |

Both host roots pass the same scheduler into the facial, idle and pose hosts; the creator already receives it. Creator/pose scans, idle catalogue reads and the in-app control probe take cooperative turns. Ready setup/blink/idle CPU work uses shown ahead of creator/pose/control analysis in ahead. Waiting for an Expressions request or an I/O response carries no priority permit. Person requests retain their immediate start and pre-emption route; single preparation-slot, commit, tail, exclusive-Clear and job quiet-period policies remain.

**What “solver ready” means [source + CPU regression]:** blink waits for `rigReady`, which is resolved **before** `startSolver()` and the editor's control probe. The matching measured log was correlation under contention, not a direct promise dependency. Readiness includes `2 + 2 × controls` solved poses (controls alone and over a common context), inert-control detection, world-space displacement and relation analysis. That analysis now runs ahead. The actual setup still needs resource reads, parsing and synchronous `compileFacialRig`; a separate “Facial setup compiled in … ms” line measures that compile rather than conflating it with readiness. Individual solves, setup compilation and blink baking retain their arithmetic.

**Files** under `projects/xf-studio/authoring/`: `src/platform/api/jobs.ts`, `src/platform/core/jobs.ts`, `src/host/host-jobs.ts`; `src/character/host/cc-catalogue-service.ts`; `src/animation/host/facial-host.ts`, `idle-host.ts`, `pose-catalogue-host.ts`; `server.ts`, `desktop/server.ts` (wiring only).

**Tests:** simulated scheduler order proves person > shown > ahead at admission and after CPU slices. A ready shown read beats an ahead job; that shown read may then await an ahead dependency without holding it back. The facial-host regression admits the real synthetic blink before the ahead probe. Existing job priority, commit/tail, catalogue, pose and idle assertions remain intact.

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

## Scheduler review follow-up on `ef601ead` (uncommitted)

**Cause:** the first scheduler correction accounted only for an occupied slot. After cancellation, a prefetch lookup remains registered through `afterwards()`: Clear waits for that tail, while the cooperative lookup waits for queued Clear. The same whole-scope policy could also make a higher read/hold wait for a lower dependency it was blocking. Testing whether a queued job is currently admissible would fix the reported tail case but retain those dependency edges.

**Design:** the scheduler's existing event-loop pump selects between an *admissible* preparation job and ready read continuations, by `person` > `shown` > `ahead` (FIFO ties for reads). Preparation jobs alone require the slot, tails, holds and quiet periods. A cooperative read's initial callback and yielded CPU continuation are always dispatchable; an unadmissible Clear/running job cannot suppress them. Once granted, a read owns no scheduling permit. Async scopes no longer increment lane holds or wait on scheduler state; a higher read waiting for I/O/dependencies leaves lower ready work eligible. The 8 ms slice and immediate person-job route remain. Abort removes a pending continuation/listener; there is no per-read timer or new fence.

**Why this priority mechanism cannot form a dependency cycle:** jobs may wait for a read or its tail, but read dispatch never waits for a job, tail, hold or async scope to complete. Ready continuations merely compete for the next event-loop dispatch; no grant is held while awaiting another continuation. Thus there is no reverse completion dependency back to a job or scope waiting for the read. Finite ready work drains even behind exclusive Clear, including through a stopped parent's tails. Continuous higher ready CPU work can still starve a lower lane, by policy; that is not a dependency wait-cycle. An I/O source that never answers still needs its owner's cancellation/deadline.

**Trade-off:** ahead reads may now progress during a shown/person scope's I/O waits. Ready shown CPU work still wins over ahead, and CPU work yields on the existing slice/unit boundary. Read quiet-period sleeps are removed; no artificial startup delay is added. The change's cost or gain against 3.2–3.3 s cannot be quantified without coordinator measurement. Strict tail-before-Clear, one preparation at a time, job quiet periods, upload/fence protection and saving/cache identities are unchanged.

**Regressions:** the requested cooperative-lookup tail/stopped-parent/exclusive-Clear/later-person sequence fails on `ef601ead` with both zero and 400 ms quiet periods, and passes now. The earlier occupied-slot regression stays green. Tests also cover running parent jobs in every lane awaiting ahead reads, shown → ahead read dependencies, a person hold awaiting a read, lane order at admission/resumption, immediate person response during shown I/O, and cancellation at initial/resumed admission with no remaining wake-ups. Tests for whole-async-scope pausing were rewritten to assert the new CPU-admission contract; no existing timing gate was relaxed. The real blink still precedes the control probe; the solve-deadline regression now delays a CPU admission for 30 s, rather than relying on an async person scope blocking it.

**Files:** `src/platform/core/jobs.ts`, `src/platform/api/jobs.ts`, `tests/jobs.test.ts`, `tests/facial-host.test.ts` under `projects/xf-studio/authoring/`, plus these performance/ledger and knowledge notes. The placement recheck and cancellation/budget/retry fixes in `ef601ead` are unchanged and closed by re-review.

## Validation and handoff

**206 targeted tests pass across twelve files**, one Bun process under the required **4 GB guard**, peak **0.5 GB**: `jobs`, `host-jobs`, `choice-prefetch`, `cc-catalogue-service`, `pose-catalogue-host`, `idle-body`, `facial-host`, `facial-solver`, `facial-lifetime`, `prepared-files`, `reference-budget`, `choice-preview` (`tests/*.test.ts`). No browser, GPU, typecheck, desktop, full-suite, real-data oracle or latency gate ran in this follow-up.

Link checking reports **0 broken links/paths in 508 Markdown files**; tracked-file privacy and `git diff --check` pass. The footprint report shows **294.1 GB free on C**, this worktree **0.5 GB**. No task scratch or new payload above 5 GB is retained; other large folders are untouched.

The coordinator owns re-review, remaining gates and remeasurement. Exercise Clear during an unfinished catalogue/prefetch check, a subsequent person request, first-frame motion against creator/pose reads, and a long person preparation during facial analysis.

**Remaining path to 2 s:** the last detailed marks above still identify request start, core loading, setup/bakes, linking, completion waits and hidden warm-up as candidates. They are not new stage timings for `ef601ead` or this correction. Remeasure the 3.2–3.3 s candidate with this policy before choosing the next change. No game or mod-manager operation is needed for this checkpoint.

## Step 1 evidence retained

The first candidate `2e57ae9f` regressed to 20.3–20.7 s despite asking for the V at 1 s: per-band fences multiplied quiet-context reports of 200–250 ms. The window commit `da926994` reached 6.4–6.8 s, with uploads 0.4 s after loaded. Subsequent review fixed later-work admission, warm-character fence retention, the pose poll's unowned 700 ms timer and a separate one-second face poll; continuous rendering then exposed fence replacement starvation. The merged design retains pending admission barriers, grants a bounded burst on completion and carries intervening work into the next checkpoint. The shell-repaint explanation for delayed Chrome reporting remains a hypothesis. Those fixes are now MERGE-reviewed and validated by the coordinator's green full/GPU/browser/resource gates on `19c366b7`.

**Knowledge used:** [WebGL linking/uploads](../../knowledge/webgl-program-linking.md), [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [facial animation](../../knowledge/facial-animation.md), [body animation](../../knowledge/body-animation.md), [knowledge rules](../../knowledge/README.md). Updated current measurements and the CPU-admission/wait-cycle argument; re-review and browser evidence for this correction remain pending.
