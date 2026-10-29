# PREV-196: warm restart preparation

Step 1 is merged at **main `19c366b7`**. Independent re-review: **MERGE**; coordinator gates: full suite **4,875/0**, GPU **124/0**, browser and resource proofs green. Warm restart improves from **9.9–10.6 s to 5.6–7.7 s**. The **<2 s budget remains open**. Step 2 is uncommitted on `claude/perf-restart-2`, based on `19c366b7`; its browser timing, typecheck, broad gates and independent review remain coordinator-owned.

## Measured critical path on `19c366b7`

Coordinator-reported warm page marks (milliseconds; the `+` offsets are retained as reported):

```text
ask 1000
answer 1200–1600
record 1300–1800
loaded 4100–6200
details:uploads +400
details:drained +850–1200
frame 5600–7700
```

The page asks for the blink at about 1.9–2.1 s and receives it at 3.9–6.1 s. The host logs “Facial solver ready” at 4.8–6.8 s server time; the page starts about 0.9 s after the server. Creator presentation (4.0–4.8 s), background V resolve (3.6–3.9 s) and archive-index reads share the host. Step 1 made CPU work fair; it did not give the first frame priority over editor catalogues/analysis.

## 1. Host: first-frame demand uses the shared lanes

**Cause [source]:** creator presentation waited only for person jobs; poses and facial control analysis used fair slices without the shared lane policy. A whole facial preparation is not a suitable single-slot job: it later waits indefinitely for an Expressions request, and other reads depend on its rig. Holding that slot while waiting for another job would deadlock dependencies.

**Correction:** the existing scheduler now supports `cooperate(lane, work, signal)` for read work outside its single preparation slot. Those reads hold their lane while wanted and use the same injected clock, 8 ms slices, higher-lane waits and quiet periods. They neither commit nor restart a derivation. Existing person jobs/holds still pre-empt lower CPU work; unused quiet wake-ups are cancelled. No separate startup queue or ordering timer is added.

| Lane | Work |
|---|---|
| `person` | Existing V requests, installation checks and Clear; unchanged preparation/commit policy |
| `shown` | Facial rig/setup, blink bake, idle catalogue/body reads; explicitly requested expression listing retains shown priority |
| `ahead` | Creator presentation, pose catalogue, inert/control-relation analysis, existing background V resolve and upkeep; expression prefetch stays ahead |

Both host roots pass the same scheduler into the facial, idle and pose hosts; the creator already receives it. Creator and pose scan turns participate in the lane. Idle catalogue reads yield between patches/sets. The facial rig releases its shown scope before waiting for an Expressions request; blink demand holds shown priority through its bake. The in-app solver inherits the calling cooperative turn, so its many-frame control probe yields to person/shown demand.

**What “solver ready” means [source + CPU regression]:** blink waits for `rigReady`, which is resolved **before** `startSolver()` and the editor's control probe. The matching measured log is correlation under contention, not a direct promise dependency. Readiness includes `2 + 2 × controls` solved poses (controls alone and over a common context), inert-control detection, world-space displacement and relation analysis. That analysis now runs ahead. The actual setup still needs resource reads, parsing and synchronous `compileFacialRig`; a separate “Facial setup compiled in … ms” line now measures that compile rather than conflating it with readiness. Individual solves, setup compilation and blink baking retain their arithmetic. Their remaining real cost needs measurement after priority contention is removed.

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

## Validation and handoff

**181 targeted tests pass across 16 files**, one Bun process under the required **4 GB memory guard**, reported peak **0.5 GB**: `jobs`, `host-jobs`, `cc-catalogue-service`, `pose-catalogue-host`, `facial-host`, `idle-body`, `game-blink`, `game-blink-composition`, `character-detail-context`, `character-renderer`, `browser-head-attachment`, `browser-viewport-device`, `head-rig-motion`, `gpu-upload-work`, `link-pacing`, `runtime-preparation` (`tests/*.test.ts`). No existing assertion or timing gate is weakened. Recording WebGL fixtures execute without a browser or GPU. No Chrome/browser, GPU, typecheck, desktop, full-suite, real-data oracle or latency gate ran for step 2.

After the final scene-lifetime edits, the three scene/device/attachment files pass again (**21/0**, guard peak **0.0 GB**). Link and private-path checks and `git diff --check` pass. The footprint report shows **292.7 GB free on C**, this worktree **0.5 GB**; no task scratch output or new payload above 5 GB is retained. Other reported large folders belong to existing work and are untouched.

The coordinator should remeasure blink request/answer, actual facial compile/probe time, `loaded` while blink is pending, `details:uploads`, `details:drained` and first frame, then run type/broad/GPU/resource gates and independent review. Include a hairstyle change while the creator idle plays and cancellation while motion/preparation is still pending.

**Remaining path to 2 s:** the ordinary request still starts around 1 s; head/core fetch/decode and initial motion requests start later. Setup compilation/individual bakes, driver linking, necessary completion waits and hidden warm-up still cost time. The current baseline is 5.6–7.7 s, not a measured step-2 result. Determine the largest residual stage from the new marks before extending scope. No game or mod-manager operation is needed for this checkpoint.

## Step 1 evidence retained

The first candidate `2e57ae9f` regressed to 20.3–20.7 s despite asking for the V at 1 s: per-band fences multiplied quiet-context reports of 200–250 ms. The window commit `da926994` reached 6.4–6.8 s, with uploads 0.4 s after loaded. Subsequent review fixed later-work admission, warm-character fence retention, the pose poll's unowned 700 ms timer and a separate one-second face poll; continuous rendering then exposed fence replacement starvation. The merged design retains pending admission barriers, grants a bounded burst on completion and carries intervening work into the next checkpoint. The shell-repaint explanation for delayed Chrome reporting remains a hypothesis. Those fixes are now MERGE-reviewed and validated by the coordinator's green full/GPU/browser/resource gates on `19c366b7`.

**Knowledge used:** [WebGL linking/uploads](../../knowledge/webgl-program-linking.md), [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [facial animation](../../knowledge/facial-animation.md), [body animation](../../knowledge/body-animation.md), [knowledge rules](../../knowledge/README.md). Updated current loading, blink-readiness and fence-overlap findings; browser evidence for step 2 remains pending.
