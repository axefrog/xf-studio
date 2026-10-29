# PREV-196: warm restart preparation

Step 1 is merged at **main `19c366b7`** (MERGE review; full suite **4,875/0**, GPU **124/0**, browser/resource proofs green). It improved warm restart from **9.9–10.6 s to 5.6–7.7 s**. Step 2 reached **3.2–3.3 s on `ef601ead`**, but its async-scope priority barriers could deadlock dependencies/tails. The cycle-free scheduler is committed as **`59e59ed0`**, typecheck clean: it regresses to **4.7–5.7 s warm** because ahead CPU fills shown I/O gaps. The current uncommitted correction protects those gaps with **bounded, non-renewable grace deadlines**, retaining progress for dependencies. Review, measurement and gates belong to the coordinator; **<2 s remains open**.

## Measurements

Latest coordinator measurements (page time unless noted):

| Candidate | Blink | Host solver-ready log | V preparation / placement / frame |
|---|---|---|---|
| `ef601ead` | Asked about 1.85 s, answered about 2.35 s (0.5 s) | About 3.8 s server time | Prepared about 3.1 s; placed about 3.15 s; frame 3.2–3.3 s |
| `59e59ed0` | Answered 4.7–5.65 s (2.8–3.6 s request duration) | 5.0–6.0 s server time; creator options read in 5.0–5.4 s | Prepared 2.8–2.9 s; placed 4.7–5.7 s; frame 4.7–5.7 s |

Parts prepare earlier on `59e59ed0`, but publication still joins full motion. That behavior remains intentional. The current correction has no runtime measurement yet. Earlier detailed marks from `d418e83f` (milliseconds), whose whole V was 2.92–2.95 s:

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

**Current correction:** `cooperate(lane, work, signal)` admits CPU work through the existing scheduler pump. Person and shown reads retain ordinary 8 ms slices and lane priority. While shown reads are in flight, ahead reads use 1 ms slices and each queued turn gets a fixed 50 ms eligibility deadline. It resumes earlier if shown work finishes or aborts. Otherwise, it becomes eligible at that deadline even if shown work awaits it. Reads hold no permit across I/O/dependencies and never wait for another operation to finish. Only preparation-job admission uses slot/tail/hold barriers. One existing scheduler wake timer serves both quiet periods and these deadlines; no per-read timer, worker or second startup owner is introduced.

| Lane | Work |
|---|---|
| `person` | Existing V requests, installation checks and Clear; unchanged preparation/commit policy |
| `shown` | Facial rig/setup, blink bake, idle catalogue/body reads; explicitly requested expression listing retains shown priority |
| `ahead` | Creator presentation, pose catalogue, inert/control-relation analysis, existing background V resolve and upkeep; expression prefetch stays ahead |

Both host roots pass the same scheduler into the facial, idle and pose hosts; the creator already receives it. Creator/pose scans, idle catalogue reads and the in-app control probe take cooperative turns. Setup/blink/idle work now retains CPU preference across short I/O gaps without requiring its completion to release dependencies. Person requests retain their immediate start and pre-emption route; single preparation-slot, commit, tail, exclusive-Clear and job quiet-period policies remain.

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

## Scheduler: bounded protection for shown I/O

**Cause:** `ef601ead` could make a lookup tail wait for queued exclusive Clear while Clear waited for that tail. `59e59ed0` removed reverse completion dependencies by dispatching only ready CPU work. However, every shown I/O gap could then admit another 8 ms ahead slice, repeatedly delaying blink's next I/O request/continuation. The coordinator's paired measurements above establish that the fairness cost is material.

**Design:** keep the cycle-free pump and add bounded grace for ahead reads while any wanted shown read is in flight. Every ahead CPU ticket records `notAfter = queuedAt + 50 ms` once. The pump admits it earlier if no shown read remains; new shown reads never move that ticket's deadline. At its deadline it competes normally by lane/FIFO, regardless of running jobs, tails, holds, dependencies or exclusivity. Ahead readers yield at 1 ms while shown reads are active, otherwise at the ordinary 8 ms. Slices remain cooperative: one indivisible scan/solve unit can overrun them. Only cooperative shown reads trigger grace, never a queued/running exclusive person job. Abort immediately withdraws a shown read's influence even if its callback has not returned; success/failure also release it in `finally`.

**Why no dependency wait-cycle can form:** a read's eligibility depends on its fixed monotonic deadline, not another operation completing. Even a shown → shared ahead lookup → stopped parent's tail → Clear chain cannot keep the lookup ineligible past that deadline. A grant holds no permit across I/O. Thus the scheduler adds no reverse completion edge to an operation waiting on the read. Finite ready work drains after bounded grace; continuously ready higher CPU work can still starve lower priority work, but a caller awaiting that dependency is not itself ready. As before, external I/O needs its owner's deadline/cancellation.

**Alternatives and trade-off:** an indefinite shown-scope hold would require proving that no shared read inherited an ahead context; shared installation/graph ownership makes that assumption unsafe. A worker for the whole creator build would need host RPC or a second resolver, plus transfer/reconstruction of TextTable and the 135,586-choice catalogue. A narrower TweakDB-only worker avoids that graph but leaves text/catalogue/panel CPU on the host, so it does not solve the entire contention source. Neither is necessary for bounded priority. This correction adds no worker heap or data copies. It deliberately slows ahead throughput during shown demand: short I/O gaps get no new ahead slice; long gaps still allow progress, roughly a 1 ms cooperative slice per 50 ms per ready ahead reader. No measured cost/gain against 3.2–3.3 s is claimed; the coordinator must measure. Strict tail-before-Clear, one preparation at a time, job quiet periods, GPU protection, publication and saving/cache identities remain unchanged.

**Regressions:** eight 5 ms shown I/O gaps finish at 40 ms with no ahead CPU admitted; ahead starts immediately when shown ends. A long shown read allows ahead at its original 50 ms deadline despite new shown activity, then enforces the 1 ms slice; ordinary slices return after shown ends. A shared ahead lookup joined by shown work and retained through a stopped parent's `afterwards()` drains before exclusive Clear and a later person job. Failure and abort on either side leave zero wake timers, including an abandoned shown callback. Prior occupied-slot/tail cycles, dependency reads in every parent lane, person holds, immediate person response and priority tests remain green. Admission-order tests now assert bounded grace as well as order; no browser/performance timing gate was changed.

**Files:** `src/platform/core/jobs.ts`, `src/platform/api/jobs.ts`, `tests/jobs.test.ts` under `projects/xf-studio/authoring/`, plus performance/ledger and knowledge notes. No page, GPU, desktop wiring or host catalogue algorithm changes.

## Validation and handoff

**142 targeted tests pass across seven files**, with one Bun process at a time under the required **4 GB guard**, peak **0.5 GB**: `jobs` (38), then `host-jobs`, `choice-prefetch`, `cc-catalogue-service`, `pose-catalogue-host`, `idle-body`, `facial-host` (104 combined; `tests/*.test.ts`). No browser, GPU, typecheck, desktop, full-suite, real-data oracle or latency gate ran in this follow-up.

Link checking reports **0 broken links/paths in 508 Markdown files**; tracked-file privacy and `git diff --check` pass. The footprint report shows **293.9 GB free on C**, this worktree **0.5 GB**. No task scratch or new payload above 5 GB is retained; other large folders are untouched.

The coordinator owns re-review, remaining gates and remeasurement. Exercise Clear during an unfinished catalogue/prefetch check, a subsequent person request, first-frame motion against creator/pose reads, and a long person preparation during facial analysis.

**Remaining path to 2 s:** first verify that bounded grace restores the short blink response and removes the 4.7–5.7 s placement tail. Parts are already prepared at 2.8–2.9 s on `59e59ed0`, so fixing host priority alone cannot establish <2 s. Remeasure request start, core loading, setup/bakes, linking, strict completion and hidden warm-up after this change. No game or mod-manager operation is needed for this checkpoint.

## Step 1 evidence retained

The first candidate `2e57ae9f` regressed to 20.3–20.7 s despite asking for the V at 1 s: per-band fences multiplied quiet-context reports of 200–250 ms. The window commit `da926994` reached 6.4–6.8 s, with uploads 0.4 s after loaded. Subsequent review fixed later-work admission, warm-character fence retention, the pose poll's unowned 700 ms timer and a separate one-second face poll; continuous rendering then exposed fence replacement starvation. The merged design retains pending admission barriers, grants a bounded burst on completion and carries intervening work into the next checkpoint. The shell-repaint explanation for delayed Chrome reporting remains a hypothesis. Those fixes are now MERGE-reviewed and validated by the coordinator's green full/GPU/browser/resource gates on `19c366b7`.

**Knowledge used:** [WebGL linking/uploads](../../knowledge/webgl-program-linking.md), [mod loading §6](../../knowledge/mod-loading.md#6-implementation-and-reproduction), [facial animation](../../knowledge/facial-animation.md), [body animation](../../knowledge/body-animation.md), [knowledge rules](../../knowledge/README.md). Updated current measurements and the bounded-grace/wait-cycle argument; re-review and browser evidence for this correction remain pending.
